import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/server/store.ts';
import {Engine} from '../src/server/engine.ts';
import {defaults, type Job, type Workflow} from '../src/shared/domain.ts';
import {planningLocked, planningSettings, saveCanvas, savePlanningSettings, stageIds, stageOf, stageStates, systemLinks} from '../src/shared/planning.ts';
import PlanningDetails, {PlanningOverview} from '../src/client/components/PlanningDetails.tsx';
import {fixture} from './fixtures.ts';

const workflow = (): Workflow => {
    const requirement = {version: 1, text: '测试需求', images: []};
    return {id: 'planning-test', title: '阶段测试', version: 1, requirement, requirements: [requirement], revisions: [], layout: {}, createdAt: '2026-11-16', updatedAt: '2026-11-16'};
};
const job = (patch: Partial<Job> = {}): Job => ({id: 'job', status: 'analyzing', stage: 'pm', requirement: workflow().requirement, settings: structuredClone(defaults), feedback: '', answers: [], questions: [], issues: [], preview: '', usage: undefined, attempt: 1, createdAt: '2026-11-16', isRegeneration: false, ...patch});
const render = (w: Workflow, stage: 'pm' | 'orchestrator') => renderToStaticMarkup(createElement(PlanningDetails, {w, stage, onUpdate: () => {}, onError: () => {}}));

test('stage states distinguish upstream waits failures cancellation interruption and storage failure', () => {
    assert.deepEqual(stageStates(), {pm: '未开始', orchestrator: '未开始'});
    assert.deepEqual(stageStates(undefined, true), {pm: '已完成', orchestrator: '已完成'});
    for (const [status, expected] of [['analyzing', '进行中'], ['waiting', '等待处理'], ['failed', '失败'], ['cancelled', '已取消'], ['interrupted', '已中断']] as const) {
        assert.deepEqual(stageStates(job({status})), {pm: expected, orchestrator: '未开始'});
    }
    for (const [status, expected] of [['orchestrating', '进行中'], ['issues', '等待处理'], ['failed', '失败'], ['cancelled', '已取消'], ['interrupted', '已中断']] as const) {
        assert.deepEqual(stageStates(job({status, stage: 'orchestrator', pm: fixture.pm})), {pm: '已完成', orchestrator: expected});
    }
    for (const status of ['complete', 'save_failed'] as const) assert.deepEqual(stageStates(job({status, stage: 'save', result: fixture})), {pm: '已完成', orchestrator: '已完成'});
});

test('system links include exactly all roots without mutating business dependencies', () => {
    const plan = structuredClone(fixture);
    plan.pm.tasks = [structuredClone(plan.pm.tasks[0]), {...structuredClone(plan.pm.tasks[0]), id: 'ROOT2'}, {...structuredClone(plan.pm.tasks[0]), id: 'CHILD'}];
    plan.pm.tasks[0].dependsOn = [];
    plan.pm.tasks[1].dependsOn = [];
    plan.pm.tasks[2].dependsOn = [plan.pm.tasks[0].id];
    const original = structuredClone(plan);
    assert.deepEqual(systemLinks(plan), [{from: stageIds.pm, to: stageIds.orchestrator}, ...plan.pm.tasks.slice(0, 2).map(t => ({from: stageIds.orchestrator, to: t.id}))]);
    assert.deepEqual(plan, original);
    plan.pm.tasks[1].dependsOn = [plan.pm.tasks[0].id];
    assert.equal(systemLinks(plan).length, 2);
    assert.equal(stageOf(stageIds.pm), 'pm');
    assert.equal(stageOf(stageIds.orchestrator), 'orchestrator');
    assert.equal(stageOf('ordinary-task'), undefined);
});

test('stage settings lock throughout generation and waits but unlock at terminal states', () => {
    const w = workflow();
    for (const status of ['analyzing', 'orchestrating', 'waiting', 'issues'] as const) {
        w.job = job({status});
        assert.equal(planningLocked(w.job), true);
        assert.throws(() => savePlanningSettings(w, defaults), /锁定/);
    }
    for (const status of ['complete', 'failed', 'cancelled', 'interrupted', 'save_failed'] as const) {
        w.job = job({status});
        assert.equal(planningLocked(w.job), false);
        savePlanningSettings(w, {...defaults, pmPrompt: 'next request'});
        assert.equal(w.job.settings.pmPrompt, defaults.pmPrompt);
    }
    assert.throws(() => savePlanningSettings(w, {...defaults, pmPrompt: ''}), /无效/);
});

test('saved plan configuration is isolated from globals history and other workflows', () => {
    const w = workflow(), other = workflow();
    const plan = {...structuredClone(fixture), settings: {...defaults, pmPrompt: 'historical prompt'}};
    w.revisions.push({id: 'r1', number: 1, plan, createdAt: w.createdAt});
    w.currentId = 'r1';
    assert.equal(planningSettings(w, {...defaults, pmPrompt: 'global change'}).pmPrompt, 'historical prompt');
    savePlanningSettings(w, {...defaults, pmPrompt: 'local next prompt', downstreamEffort: 'low'});
    assert.equal(planningSettings(w).pmPrompt, 'local next prompt');
    assert.equal(plan.settings.pmPrompt, 'historical prompt');
    assert.equal(planningSettings(other).pmPrompt, defaults.pmPrompt);
    assert.equal(planningSettings(w).downstreamEffort, plan.settings.downstreamEffort);
    const detached = planningSettings(w);
    detached.pmPrompt = 'mutated';
    assert.equal(planningSettings(w).pmPrompt, 'local next prompt');
});

test('stage positions viewport and configuration survive database reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weave-planning-')), path = join(dir, 'test.sqlite');
    let store = new Store(path);
    try {
        const w = workflow();
        saveCanvas(w, {layout: {[stageIds.pm]: {x: 12, y: 34}}, viewport: {x: 5, y: 6, zoom: .8}});
        saveCanvas(w, {layout: {[stageIds.orchestrator]: {x: 56, y: 78}}});
        savePlanningSettings(w, {...defaults, orchestratorPrompt: 'persisted local prompt'});
        store.put(w); store.db.close(); store = new Store(path);
        const reopened = store.get(w.id);
        assert.deepEqual(reopened.layout, w.layout);
        assert.deepEqual(reopened.viewport, w.viewport);
        assert.deepEqual(planningSettings(reopened), planningSettings(w));
        assert.throws(() => saveCanvas(reopened, {viewport: {x: 0, y: 0, zoom: NaN}}), /无效/);
        assert.throws(() => saveCanvas(reopened, {layout: {bad: {x: Infinity, y: 0}}}), /无效/);
    } finally {store.db.close(); rmSync(dir, {recursive: true, force: true})}
});

test('stage details show only current public preview escaped and explicitly unvalidated', () => {
    const w = workflow();
    w.job = job({preview: '<script>public-output</script>'});
    const html = render(w, 'pm');
    assert.match(html, /本轮公开输出预览 · 未校验/);
    assert.ok(html.includes('&lt;script&gt;public-output&lt;/script&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.ok(!render(w, 'orchestrator').includes('public-output'));
    w.job = job({status: 'failed', preview: 'stale preview'});
    assert.ok(!render(w, 'pm').includes('stale preview'));
    assert.match(render(w, 'pm'), /暂无本轮已校验结果/);
    w.job = job({status: 'save_failed', stage: 'save', pm: fixture.pm, result: fixture});
    assert.match(render(w, 'orchestrator'), /重试保存（不调用模型）/);
    assert.match(renderToStaticMarkup(createElement(PlanningOverview, {w})), /保存失败/);
});

test('engine freezes local stage settings and retries without absorbing later edits', async () => {
    const store = new Store(':memory:'), w = workflow(), seen: Job['settings'][] = [];
    const oldKey = process.env.DEEPSEEK_API_KEY, oldAttempts = process.env.MODEL_MAX_ATTEMPTS;
    process.env.DEEPSEEK_API_KEY = 'test-placeholder-never-network'; process.env.MODEL_MAX_ATTEMPTS = '1';
    const settle = async () => {
        for (let i = 0; i < 200; i++) {
            const next = store.get(w.id);
            if (!['analyzing', 'orchestrating'].includes(next.job?.status || '')) return next;
            await new Promise(r => setTimeout(r, 5));
        }
        throw new Error('timeout');
    };
    try {
        savePlanningSettings(w, {...defaults, pmPrompt: 'local PM', orchestratorPrompt: 'local orchestrator'});
        store.put(w); let failOnce = true;
        const engine = new Engine(store, async (j, stage) => {
            seen.push(structuredClone(j.settings));
            if (stage === 'orchestrator' && failOnce) {failOnce = false; throw new Error('test failure')}
            return {result: stage === 'pm' ? {kind: 'ready', pm: fixture.pm} : {kind: 'ready', agents: fixture.agents, assignments: fixture.pm.tasks.map(t => ({taskId: t.id, agentId: t.agentId})), rationale: fixture.rationale}, usage: undefined};
        });
        engine.start(w.id, w.version, ''); let done = await settle();
        assert.equal(done.job?.status, 'failed');
        done = store.mutate(w.id, value => savePlanningSettings(value, {...defaults, pmPrompt: 'later PM', orchestratorPrompt: 'later orchestrator'}));
        engine.retry(w.id, done.version); done = await settle();
        assert.equal(done.job?.status, 'complete');
        assert.equal(seen.length, 3);
        assert.ok(seen.every(s => s.pmPrompt === 'local PM' && s.orchestratorPrompt === 'local orchestrator'));
        engine.start(w.id, done.version, ''); done = await settle();
        assert.equal(done.job?.status, 'complete');
        assert.equal(seen[3].pmPrompt, 'later PM');
        assert.equal(seen[4].orchestratorPrompt, 'later orchestrator');
        assert.equal(done.revisions[0].plan.settings.pmPrompt, 'local PM');
    } finally {
        store.db.close();
        if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey;
        if (oldAttempts === undefined) delete process.env.MODEL_MAX_ATTEMPTS; else process.env.MODEL_MAX_ATTEMPTS = oldAttempts;
    }
});
