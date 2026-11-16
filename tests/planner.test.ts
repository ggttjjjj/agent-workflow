import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.ts';
import {Engine} from '../server/engine.ts';
import {readStream} from '../server/model.ts';
import {defaults, validatePlan, current, type Plan, type Workflow} from '../shared/domain.ts';
import {fixture} from './fixtures.ts';

function setup() {
    const store = new Store(':memory:');
    const req = {version: 1, text: '测试需求', images: []};
    const w: Workflow = {
        id: randomUUID(),
        title: '测试',
        version: 1,
        requirement: req,
        requirements: [req],
        revisions: [],
        layout: {},
        createdAt: '2026-11-16',
        updatedAt: '2026-11-16'
    };
    store.put(w);
    return {store, w}
}

const response = (stage: string) => ({
    result: stage === 'pm' ? {kind: 'ready', pm: fixture.pm} : {
        kind: 'ready',
        agents: fixture.agents,
        assignments: fixture.pm.tasks.map(t => ({taskId: t.id, agentId: t.agentId})),
        rationale: fixture.rationale
    }, usage: {total_tokens: 10}
});

async function settle(store: Store, id: string) {
    for (let n = 0; n < 100; n++) {
        const w = store.get(id);
        if (!['analyzing', 'orchestrating'].includes(w.job?.status || '')) return w;
        await new Promise(r => setTimeout(r, 10))
    }
    throw new Error('timeout')
}

process.env.DEEPSEEK_API_KEY = 'test-placeholder-never-network';
test('valid structure, cycle, dangling assignment and coverage are distinguished', () => {
    assert.deepEqual(validatePlan(fixture, {version: 1, text: 'x', images: []}), []);
    const p = structuredClone(fixture);
    p.pm.tasks[0].dependsOn = ['T4'];
    p.pm.tasks[1].agentId = 'missing';
    p.pm.criteria.push({id: 'C3', text: 'uncovered'});
    const es = validatePlan(p, {version: 1, text: 'x', images: []});
    assert.ok(es.some(e => e.path === 'edges'));
    assert.ok(es.some(e => e.message.includes('Agent')));
    assert.ok(es.some(e => e.level === 'coverage'))
});
test('stream handles final content, usage, reasoning omission and [DONE]', async () => {
    const text = 'data: ' + JSON.stringify({
        choices: [{
            delta: {reasoning_content: 'private'},
            finish_reason: null
        }]
    }) + '\n\ndata: ' + JSON.stringify({
        choices: [{delta: {content: '{"ok":true}'}, finish_reason: 'stop'}],
        usage: {total_tokens: 5}
    }) + '\n\ndata: [DONE]\n\n';
    let preview = '';
    const r = await readStream(new Response(text), s => preview = s);
    assert.deepEqual(r.result, {ok: true});
    assert.deepEqual(r.usage, {total_tokens: 5});
    assert.equal(preview, '{"ok":true}')
});
test('whitespace and truncated stream never succeed', async () => {
    await assert.rejects(readStream(new Response('data: {"choices":[{"delta":{"content":"  "},"finish_reason":"stop"}]}\n\ndata: [DONE]\n'), () => {
    }), /空白/);
    await assert.rejects(readStream(new Response('data: {"choices":[{"delta":{"content":"{}"}}]}\n'), () => {
    }), /中断/)
});
test('two real logical stages only, generation persists valid revision', async () => {
    const {store, w} = setup();
    const calls: string[] = [];
    const engine = new Engine(store, async (_j, s) => {
        calls.push(s);
        return response(s)
    });
    engine.start(w.id, 1, '');
    const done = await settle(store, w.id);
    assert.equal(done.job?.status, 'complete');
    assert.deepEqual(calls, ['pm', 'orchestrator']);
    assert.ok(current(done));
    assert.equal(current(done)?.confirmedAt, undefined)
});
test('orchestration issues stop without auto-loop and resume with original settings', async () => {
    const {store, w} = setup();
    let issue = true;
    const snapshots: string[] = [];
    const engine = new Engine(store, async (j, s) => {
        snapshots.push(j.settings.pmPrompt);
        return s === 'orchestrator' && issue ? {
            result: {
                kind: 'issues',
                issues: ['需要明确范围'],
                questions: [{id: 'Q1', text: '范围？', reason: '必要'}]
            }, usage: null
        } : response(s)
    });
    engine.start(w.id, 1, '');
    let done = await settle(store, w.id);
    assert.equal(done.job?.status, 'issues');
    assert.equal(snapshots.length, 2);
    store.saveSettings({...defaults, pmPrompt: 'NEW'});
    issue = false;
    engine.retry(w.id, done.version, '明确范围');
    done = await settle(store, w.id);
    assert.equal(done.job?.status, 'complete');
    assert.ok(snapshots.every(x => x === defaults.pmPrompt))
});
test('failed orchestration retry reuses PM and frozen settings', async () => {
    const {store, w} = setup();
    let broken = true;
    const calls: string[] = [];
    const engine = new Engine(store, async (j, s) => {
        calls.push(s);
        assert.equal(j.settings.pmEffort, 'high');
        if (s === 'orchestrator' && broken) throw new Error('temporary');
        return response(s)
    });
    engine.start(w.id, 1, '');
    let done = await settle(store, w.id);
    assert.equal(done.job?.status, 'failed');
    store.saveSettings({...defaults, pmEffort: 'max'});
    broken = false;
    engine.retry(w.id, done.version);
    done = await settle(store, w.id);
    assert.equal(done.job?.status, 'complete');
    assert.deepEqual(calls, ['pm', 'orchestrator', 'orchestrator'])
});
test('cancel rejects late result without invoking downstream stage', async () => {
    const {store, w} = setup();
    let resolve: any;
    let count = 0;
    const engine = new Engine(store, async () => {
        count++;
        return await new Promise(r => resolve = r)
    });
    engine.start(w.id, 1, '');
    engine.cancel(w.id);
    resolve(response('pm'));
    await new Promise(r => setTimeout(r, 20));
    assert.equal(store.get(w.id).job?.status, 'cancelled');
    assert.equal(count, 1);
    assert.equal(store.get(w.id).revisions.length, 0)
});
test('regeneration is candidate, never overwrites saved plan', async () => {
    const {store, w} = setup();
    const engine = new Engine(store, async (_j, s) => response(s));
    engine.start(w.id, 1, '');
    let done = await settle(store, w.id);
    const original = done.currentId;
    engine.start(w.id, done.version, 'replan');
    done = await settle(store, w.id);
    assert.equal(done.currentId, original);
    assert.ok(done.candidate)
});
test('new requirement makes old retry invalid', async () => {
    const {store, w} = setup();
    const engine = new Engine(store, async () => {
        throw new Error('failed')
    });
    engine.start(w.id, 1, '');
    await settle(store, w.id);
    const changed = store.mutate(w.id, x => x.requirement.version++);
    assert.throws(() => engine.retry(w.id, changed.version), /过期/)
});
test('CAS prevents overwrites and restart marks active generation interrupted', () => {
    const {store, w} = setup();
    store.mutate(w.id, x => {
        x.title = 'changed'
    });
    assert.throws(() => store.mutate(w.id, x => x.title = 'bad', 1), /版本/);
    assert.equal(store.get(w.id).title, 'changed');
    store.mutate(w.id, x => {
        x.job = {
            id: 'j',
            status: 'analyzing',
            stage: 'pm',
            requirement: x.requirement,
            settings: defaults,
            feedback: '',
            answers: [],
            questions: [],
            issues: [],
            preview: '',
            usage: null,
            attempt: 1,
            createdAt: 'x',
            isRegeneration: false
        }
    });
    new Engine(store);
    assert.equal(store.get(w.id).job?.status, 'interrupted')
});
