import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/server/store.ts';
import {Engine} from '../src/server/engine.ts';
import {
    cleanTitle,
    copyTitle,
    current,
    defaults,
    MAX_PLAN_TITLE,
    planSummary,
    type Job,
    type Plan,
    type Workflow
} from '../src/shared/domain.ts';
import {fixture} from './fixtures.ts';

process.env.DEEPSEEK_API_KEY = 'test-placeholder-never-network';

function workflow(title = '测试方案'): Workflow {
    const req = {version: 1, text: '为社区策划亲子阅读活动', images: []};
    return {
        id: randomUUID(),
        title,
        version: 1,
        requirement: req,
        requirements: [req],
        revisions: [],
        layout: {},
        createdAt: '2026-11-16T10:00:00.000Z',
        updatedAt: '2026-11-16T10:00:00.000Z'
    }
}

function saved(store: Store, title = '测试方案', confirmed = false) {
    const w = workflow(title);
    store.put(w);
    const plan: Plan = structuredClone(fixture);
    store.mutate(w.id, x => {
        x.revisions.push({
            id: 'r1',
            number: 1,
            plan,
            createdAt: '2026-11-16T10:00:00.000Z',
            confirmedAt: confirmed ? '2026-11-16T11:00:00.000Z' : undefined
        });
        x.currentId = 'r1';
        x.layout = {T1: {x: 10, y: 20}}
    });
    return store.get(w.id);
}

test('cleanTitle trims, collapses whitespace and enforces the code-point limit', () => {
    assert.equal(cleanTitle('  客户   门户  '), '客户 门户');
    assert.equal(cleanTitle('\n月度 规划\t'), '月度 规划');
    for (const bad of ['', '   ', undefined, null, 42, 'a'.repeat(MAX_PLAN_TITLE + 1)]) {
        assert.equal(cleanTitle(bad), '');
    }
    assert.equal(cleanTitle('字'.repeat(MAX_PLAN_TITLE)), '字'.repeat(MAX_PLAN_TITLE));
    assert.equal(cleanTitle('😀'.repeat(MAX_PLAN_TITLE)), '😀'.repeat(MAX_PLAN_TITLE));
});

test('copyTitle keeps the suffix and never exceeds the title limit', () => {
    assert.equal(copyTitle('活动方案'), '活动方案（副本）');
    const long = copyTitle('字'.repeat(MAX_PLAN_TITLE));
    assert.equal([...long].length, MAX_PLAN_TITLE);
    assert.ok(long.endsWith('（副本）'));
});

test('planSummary exposes list metadata and confirmation against the latest requirement', () => {
    const store = new Store(':memory:');
    const w = saved(store, '阅读活动', true);
    const summary = planSummary(w);
    assert.equal(summary.title, '阅读活动');
    assert.equal(summary.confirmed, true);
    assert.equal(summary.revisions, 1);
    assert.equal(summary.requirements, 1);
    assert.equal(summary.tasks, 4);
    assert.equal(summary.agents, 3);
    assert.equal(summary.generating, false);
    assert.equal(summary.candidate, false);
    assert.match(summary.summary, /亲子阅读/);

    const changed = store.mutate(w.id, x => {
        x.requirement = {...x.requirement, version: 2};
        x.requirements.push(x.requirement)
    });
    assert.equal(planSummary(changed).confirmed, false, 'confirmation belongs to the old requirement');

    const job: Job = {
        id: 'j',
        status: 'analyzing',
        stage: 'pm',
        requirement: changed.requirement,
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
    };
    assert.equal(planSummary({...changed, job}).generating, true);
    assert.equal(planSummary({...changed, trashedAt: '2026-11-17T00:00:00.000Z'}).trashedAt, '2026-11-17T00:00:00.000Z');
});

test('trash hides a plan from reads, lists and mutations, then restore returns it', () => {
    const store = new Store(':memory:');
    const w = saved(store);
    const moved = store.trash(w.id);
    assert.ok(moved.trashedAt);
    assert.deepEqual(store.all(), []);
    assert.deepEqual(store.all(true).map(x => x.id), [w.id]);
    assert.throws(() => store.get(w.id), /回收站/);
    assert.throws(() => store.mutate(w.id, x => {
        x.title = '不应写入'
    }), /回收站/);

    const restored = store.restore(w.id, moved.version);
    assert.equal(restored.trashedAt, undefined);
    assert.equal(store.get(w.id).title, '测试方案');
    assert.equal(store.all().length, 1);
    assert.equal(store.all(true).length, 0);
});

test('stale or invalid deletion requests cannot silently target another version', () => {
    const store = new Store(':memory:');
    const w = saved(store);
    assert.throws(() => store.trash(w.id, 999), /版本/);
    assert.equal(store.get(w.id).trashedAt, undefined);

    const moved = store.trash(w.id);
    assert.throws(() => store.restore(w.id, 1), /刷新/);
    assert.equal(store.all(true).length, 1, 'failed restore leaves the plan in the trash');
    store.restore(w.id, moved.version);
    assert.equal(store.all().length, 1);
});

test('purge only works after trashing and empty trash is guarded by the displayed count', () => {
    const store = new Store(':memory:');
    const a = saved(store, '甲'), b = saved(store, '乙');
    assert.throws(() => store.purge(a.id), /回收站/);
    store.trash(a.id);
    store.trash(b.id);
    assert.throws(() => store.emptyTrash(1), /变化/);
    assert.equal(store.all(true).length, 2, 'a mismatched count must not delete anything');

    store.purge(a.id);
    assert.equal(store.all(true).length, 1);
    assert.throws(() => store.get(a.id, true), /不存在/);
    assert.equal(store.emptyTrash(1), 1);
    assert.equal(store.all(true).length, 0);
});

test('duplicate copies revisions independently and drops generation state and confirmation', () => {
    const store = new Store(':memory:');
    const w = saved(store, '原始方案', true);
    store.mutate(w.id, x => {
        x.candidate = structuredClone(fixture);
        x.job = {
            id: 'j',
            status: 'waiting',
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
    const copy = store.duplicate(w.id);
    assert.notEqual(copy.id, w.id);
    assert.equal(copy.title, '原始方案（副本）');
    assert.equal(copy.revisions.length, 1);
    assert.equal(copy.currentId, 'r1');
    assert.equal(copy.candidate, undefined);
    assert.equal(copy.job, undefined);
    assert.equal(copy.revisions[0].confirmedAt, undefined, 'a new plan record has not been confirmed');
    assert.ok(store.get(w.id).revisions[0].confirmedAt, 'the original confirmation is untouched');
    assert.deepEqual(copy.layout, {T1: {x: 10, y: 20}});
    assert.equal(store.all().length, 2);

    store.mutate(copy.id, x => {
        x.title = '副本改名'
    });
    assert.equal(store.get(w.id).title, '原始方案');
    assert.equal(store.get(copy.id).title, '副本改名');
});

test('recovery remains available in active and trash lists without leaking trashed plans', () => {
    const store = new Store(':memory:');
    try {
        const w = saved(store);
        store.mutate(w.id, x => {
            x.job = {id: 'recovery-job', status: 'failed', stage: 'save', requirement: x.requirement,
                settings: defaults, feedback: '', answers: [], questions: [], issues: [], preview: '',
                usage: null, attempt: 1, createdAt: x.createdAt, isRegeneration: true}
        });
        store.prepareResult(w.id, 'recovery-job', fixture, null);
        store.failPreparedResult(w.id, 'recovery-job');
        assert.equal(store.get(w.id).job?.status, 'save_failed');
        assert.equal(store.all()[0].job?.status, 'save_failed');
        assert.deepEqual(store.all()[0].job?.result, fixture);
        store.trash(w.id);
        assert.equal(store.all().length, 0);
        assert.equal(store.all(true)[0].job?.status, 'save_failed');
        assert.throws(() => store.get(w.id), /回收站/);
        store.restore(w.id);
        assert.deepEqual(store.get(w.id).job?.result, fixture);
    } finally {store.db.close()}
});

test('trashing a pending planning stage cancels it and keeps it cancelled after restore', () => {
    const store = new Store(':memory:');
    try {
        const engine = new Engine(store);
        for (const status of ['waiting', 'issues'] as const) {
            const w = saved(store);
            store.mutate(w.id, x => {
                x.job = {id: status, status, stage: 'pm', requirement: x.requirement,
                    settings: defaults, feedback: '', answers: [], questions: [], issues: [], preview: '',
                    usage: null, attempt: 1, createdAt: x.createdAt, isRegeneration: true}
            });
            const moved = engine.trash(w.id);
            assert.equal(moved.job?.status, 'cancelled');
            assert.equal(store.restore(w.id).job?.status, 'cancelled');
        }
    } finally {store.db.close()}
});

test('deleting while generating cancels the run and late model output cannot persist', async () => {
    const store = new Store(':memory:');
    const w = saved(store);
    let resolve!: (value: any) => void;
    let calls = 0;
    const engine = new Engine(store, async () => {
        calls++;
        return await new Promise<any>(r => resolve = r)
    });
    engine.start(w.id, w.version, '');
    assert.equal(store.get(w.id).job?.status, 'analyzing');
    const moved = engine.trash(w.id);
    assert.equal(moved.job?.status, 'cancelled');
    assert.match(moved.job?.error || '', /回收站/);
    assert.ok(moved.trashedAt);
    assert.equal(store.all().length, 0);

    resolve({result: {kind: 'ready', pm: fixture.pm}, usage: {total_tokens: 1}});
    await new Promise(r => setTimeout(r, 25));
    const after = store.all(true)[0];
    assert.equal(calls, 1);
    assert.equal(after.revisions.length, 1, 'the late result never becomes a new revision');
    assert.equal(after.revisions[0].id, 'r1');
    assert.equal(after.job?.status, 'cancelled');
    assert.equal(current(after)?.id, 'r1');
});
