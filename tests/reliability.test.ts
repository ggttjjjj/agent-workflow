import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/server/store.ts';
import {Engine} from '../src/server/engine.ts';
import {callModel} from '../src/server/model.ts';
import {current, defaults, requirementAnalysis, requirementBaseline, validatePlan, type Job} from '../src/shared/domain.ts';
import {fixture} from './fixtures.ts';
import {setup, response, settle} from './engine-helpers.ts';
process.env.DEEPSEEK_API_KEY = 'test-placeholder-never-network';
process.env.MODEL_MAX_ATTEMPTS = '1';

test('same-version regeneration cannot delete, rewrite or renumber established criteria', async t => {
    for (const mode of ['delete', 'rewrite', 'renumber'] as const) await t.test(mode, async () => {
        const {store, w} = setup();
        let changed = false;
        const engine = new Engine(store, async (_j, s) => {
            const pm = structuredClone(fixture.pm);
            if (changed) {
                if (mode === 'delete') {
                    pm.criteria.pop();
                    pm.tasks.forEach(t => { t.criteria = t.criteria.filter(c => c !== 'C2') })
                } else if (mode === 'rewrite') pm.criteria[1].text = '可选：以后再处理';
                else {
                    pm.criteria[1].id = 'C99';
                    pm.tasks.forEach(t => {t.criteria = t.criteria.map(c => c === 'C2' ? 'C99' : c)})
                }
            }
            return response(s, pm)
        });
        engine.start(w.id, 1, '');
        let done = await settle(store, w.id);
        const original = structuredClone(current(done));
        changed = true;
        engine.start(w.id, done.version, '删掉员工分类处理以简化');
        done = await settle(store, w.id);
        assert.equal(done.job?.status, 'failed');
        assert.match(done.job!.error!, /不能删除或改变/);
        assert.equal(done.candidate, undefined);
        assert.deepEqual(current(done), original);
        store.db.close()
    })
});

test('integrity guards all explicit requirement fields and legacy baseline, while allowing additions', () => {
    const {store, w} = setup();
    store.mutate(w.id, w => {w.revisions.push({id: 'r1', number: 1, plan: structuredClone(fixture), createdAt: 'now'}); w.currentId = 'r1'});
    const baseline = requirementBaseline(store.get(w.id));
    for (const key of ['goal', 'audience', 'deliverables', 'constraints', 'exclusions'] as const) {
        const plan = structuredClone(fixture);
        if (key === 'goal' || key === 'audience') plan.pm[key] = 'changed';
        else plan.pm[key] = [];
        assert.ok(validatePlan(plan, w.requirement, true, baseline).some(e => e.level === 'error'))
    }
    const plan = structuredClone(fixture);
    plan.pm.constraints.push('本地部署');
    assert.deepEqual(validatePlan(plan, w.requirement, true, baseline), []);
    // A malicious already-existing candidate cannot become its own baseline.
    plan.pm.criteria.pop();
    store.mutate(w.id, w => {w.candidate = plan});
    assert.equal(requirementBaseline(store.get(w.id))?.criteria.length, 2);
    store.db.close()
});

test('explicit new requirement version permits reviewed requirement changes', async () => {
    const {store, w} = setup();
    let changed = false;
    const engine = new Engine(store, async (_j, s) => {
        const pm = structuredClone(fixture.pm);
        if (changed) {pm.goal = '新的明确目标'; pm.criteria.pop(); pm.tasks.forEach(t => {t.criteria = ['C1']})}
        return response(s, pm)
    });
    engine.start(w.id, 1, '');
    let done = await settle(store, w.id);
    done = store.mutate(w.id, w => {w.requirement = {version: 2, text: '取消员工处理，只规划客户功能', images: []}; w.requirements.push(w.requirement)});
    changed = true;
    engine.start(w.id, done.version, '');
    done = await settle(store, w.id);
    assert.equal(done.job?.status, 'complete');
    assert.equal(done.candidate?.pm.criteria.length, 1);
    assert.equal(done.candidate?.requirementVersion, 2);
    assert.equal(current(done)?.plan.pm.criteria.length, 2);
    assert.equal(done.requirements[0].analysis?.criteria.length, 2);
    store.db.close()
});

test('Q&A survives regeneration, candidate discard, restart and is snapshotted per revision', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'weave-qa-'));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    const path = join(dir, 'test.sqlite');
    let {store, w} = setup(path);
    let clarify = true;
    const snapshots: Job[] = [];
    const provider: typeof callModel = async (j, s) => {
        snapshots.push(structuredClone(j));
        if (clarify && s === 'pm') {
            clarify = false;
            return {result: {kind: 'clarify', questions: [{id: 'Q1', text: '部署在哪里？', reason: '约束', options: ['本地', '云端'], multi: false}]}, usage: null}
        }
        return response(s)
    };
    let engine = new Engine(store, provider);
    engine.start(w.id, 1, '');
    let done = await settle(store, w.id);
    engine.retry(w.id, done.version, '部署在本地');
    done = await settle(store, w.id);
    const original = structuredClone(current(done));
    assert.ok(original);
    assert.equal(done.answers?.[0].answer, '部署在本地');
    assert.equal(original?.plan.answers?.[0].questions[0].text, '部署在哪里？');
    store.db.close();
    store = new Store(path);
    engine = new Engine(store, provider);
    done = store.get(w.id);
    engine.start(w.id, done.version, '重新分工');
    done = await settle(store, w.id);
    assert.equal(done.job?.status, 'complete');
    assert.equal(done.currentId, original.id);
    assert.deepEqual(current(done), original);
    assert.ok(done.candidate);
    for (const j of snapshots.slice(-2)) assert.equal(j.answers[0].answer, '部署在本地');
    assert.equal(done.job?.answers[0].requirementVersion, 1);
    assert.equal(done.candidate?.answers?.[0].stage, 'pm');
    done = store.mutate(w.id, w => {w.candidate = undefined});
    assert.deepEqual(current(done), original);
    assert.equal(done.answers?.[0].answer, '部署在本地');
    store.db.close()
});

test('legacy job-only answers migrate before start replaces the old job', async () => {
    const {store, w} = setup();
    const engine = new Engine(store, async (_j, s) => response(s));
    engine.start(w.id, 1, '');
    await settle(store, w.id);
    const done = store.mutate(w.id, w => {w.job!.answers = [{questions: [], answer: '原回答：本地部署'}]; delete w.answers});
    engine.start(w.id, done.version, '');
    const next = await settle(store, w.id);
    assert.equal(next.answers?.[0].answer, '原回答：本地部署');
    assert.equal(next.candidate?.answers?.[0].answer, '原回答：本地部署');
    store.db.close()
});

test('first result write and final commit failures retry only storage, including after restart', async t => {
    for (const phase of ['first-result', 'final-commit', 'persistent'] as const) await t.test(phase, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'weave-save-'));
        t.after(() => rmSync(dir, {recursive: true, force: true}));
        const path = join(dir, 'test.sqlite');
        let {store, w} = setup(path);
        let calls = 0, injected = false;
        const provider: typeof callModel = async (_j, s) => {calls++; return response(s)};
        let engine = new Engine(store, provider);
        const put = store.put.bind(store);
        store.put = value => {
            const shouldFail = phase === 'persistent' ? calls === 2 : phase === 'first-result' ? !!value.job?.result : value.job?.status === 'complete';
            if (shouldFail && (!injected || phase === 'persistent')) {injected = true; throw new Error('injected SQLite write failure')}
            return put(value)
        };
        engine.start(w.id, 1, '');
        let done = await settle(store, w.id);
        assert.equal(done.job?.status, 'save_failed');
        assert.ok(done.job?.result);
        assert.equal(done.currentId, undefined);
        assert.equal(calls, 2);
        store.db.close();
        store = new Store(path);
        engine = new Engine(store, provider);
        done = store.get(w.id);
        assert.equal(done.job?.status, 'save_failed');
        assert.ok(done.job?.result);
        engine.retry(w.id, done.version);
        done = await settle(store, w.id);
        assert.equal(done.job?.status, 'complete');
        assert.equal(done.revisions.length, 1);
        assert.equal(calls, 2);
        assert.deepEqual(validatePlan(current(done)!.plan, done.requirement), []);
        store.db.close()
    })
});

test('recovery checkpoint cannot resurrect a cancelled or newer request', () => {
    const {store, w} = setup();
    store.mutate(w.id, w => {w.job = {id: 'old', status: 'cancelled', stage: 'orchestrator', requirement: w.requirement, settings: defaults, feedback: '', answers: [], questions: [], issues: [], preview: '', usage: null, attempt: 1, createdAt: 'now', isRegeneration: false}});
    store.prepareResult(w.id, 'old', fixture, null);
    store.failPreparedResult(w.id, 'old');
    assert.equal(store.get(w.id).job?.status, 'cancelled');
    store.mutate(w.id, w => {w.job!.id = 'new'; w.job!.status = 'analyzing'});
    assert.equal(store.get(w.id).job?.result, undefined);
    store.db.close()
});

test('real request serialization includes persisted answers and protection baseline in both stages', async t => {
    const {store, w} = setup();
    const engine = new Engine(store, async (_j, s) => response(s));
    engine.start(w.id, 1, '');
    const done = await settle(store, w.id);
    const job = done.job!;
    job.answers = [{questions: [], answer: '本地部署', requirementVersion: 1}];
    job.baseline = requirementAnalysis(fixture.pm);
    const fetch = globalThis.fetch;
    t.after(() => {globalThis.fetch = fetch; store.db.close()});
    let requests = 0;
    globalThis.fetch = async (_url, init) => {
        requests++;
        const payload = JSON.parse(String(init?.body));
        const context = JSON.parse(payload.messages[1].content[0].text);
        assert.equal(context.answers[0].answer, '本地部署');
        assert.equal(context.establishedRequirements.criteria.length, 2);
        return new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    };
    for (const stage of ['pm', 'orchestrator'] as const) await callModel(job, stage, new AbortController().signal, () => {});
    assert.equal(requests, 2)
});

test('model requests use the model output maximum unless explicitly overridden', async t => {
    const {store, w} = setup();
    t.after(() => store.db.close());
    const engine = new Engine(store, async (_j, s) => response(s));
    engine.start(w.id, 1, '');
    const job = (await settle(store, w.id)).job!;
    const originalLimit = process.env.MODEL_MAX_TOKENS;
    t.after(() => {
        if (originalLimit === undefined) delete process.env.MODEL_MAX_TOKENS;
        else process.env.MODEL_MAX_TOKENS = originalLimit
    });
    let requests = 0, expected = 393216;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
        requests++;
        assert.equal(JSON.parse(String(init?.body)).max_tokens, expected);
        return new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    });
    for (const configured of [undefined, '', '   ', '1', '12000', ' 24000 ', '393216']) {
        if (configured === undefined) delete process.env.MODEL_MAX_TOKENS;
        else process.env.MODEL_MAX_TOKENS = configured;
        expected = configured?.trim() ? Number(configured) : 393216;
        for (const stage of ['pm', 'orchestrator'] as const) {
            await callModel(job, stage, new AbortController().signal, () => {})
        }
    }
    assert.equal(requests, 14);
    for (const configured of ['0', '-1', '1.5', 'NaN', 'Infinity', 'invalid', '393217']) {
        process.env.MODEL_MAX_TOKENS = configured;
        await assert.rejects(callModel(job, 'pm', new AbortController().signal, () => {}), /MODEL_MAX_TOKENS.*整数/)
    }
    assert.equal(requests, 14, 'invalid overrides must fail before contacting the provider')
});

test('repeated regeneration retains the full output budget and saves large streamed JSON', async t => {
    const {acceptCandidate} = await import('../src/server/revisions.ts');
    const {store, w} = setup();
    t.after(() => store.db.close());
    const originalLimit = process.env.MODEL_MAX_TOKENS;
    delete process.env.MODEL_MAX_TOKENS;
    t.after(() => {
        if (originalLimit === undefined) delete process.env.MODEL_MAX_TOKENS;
        else process.env.MODEL_MAX_TOKENS = originalLimit
    });
    const longPrompt = '保持任务职责、验收条件和交接约束。'.repeat(6000);
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
        requests++;
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.max_tokens, 393216);
        const context = JSON.parse(payload.messages[1].content[0].text);
        if (requests > 2) assert.equal(context.previousPlan.agents[0].prompt, longPrompt);
        const stage = context.pm ? 'orchestrator' : 'pm';
        const result = structuredClone(response(stage).result);
        if ('agents' in result && result.agents) result.agents[0].prompt = longPrompt;
        const json = JSON.stringify(result);
        const events: string[] = [];
        for (let i = 0; i < json.length; i += 8192) {
            events.push('data: ' + JSON.stringify({choices: [{delta: {content: json.slice(i, i + 8192)}}]}) + '\n\n')
        }
        events.push('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
            start(controller) {
                for (const event of events) controller.enqueue(encoder.encode(event));
                controller.close()
            }
        }))
    });
    const engine = new Engine(store);
    let done = w;
    for (let round = 0; round < 3; round++) {
        engine.start(w.id, done.version, round ? '保留需求并优化分工' : '');
        done = await settle(store, w.id);
        assert.equal(done.job?.status, 'complete', done.job?.error);
        if (round) {
            assert.equal(done.candidate?.agents[0].prompt, longPrompt);
            done = store.mutate(w.id, acceptCandidate)
        }
        assert.equal(current(done)?.plan.agents[0].prompt, longPrompt);
        assert.deepEqual(validatePlan(current(done)!.plan, done.requirement), [])
    }
    assert.equal(requests, 6);
    assert.equal(done.revisions.length, 3)
});

test('candidate adoption and confirmation share the immutable guard, including legacy documents', async () => {
    const {acceptCandidate, confirmRevision} = await import('../src/server/revisions.ts');
    const {store, w} = setup();
    const original = structuredClone(fixture);
    store.mutate(w.id, w => {
        w.revisions = [{id: 'r1', number: 1, plan: original, createdAt: 'now'}];
        w.currentId = 'r1';
        const weakened = structuredClone(fixture);
        weakened.pm.criteria.pop();
        weakened.pm.tasks.forEach(t => {t.criteria = ['C1']});
        w.candidate = weakened
    });
    assert.throws(() => store.mutate(w.id, acceptCandidate), /候选校验失败/);
    let done = store.get(w.id);
    assert.equal(done.revisions.length, 1);
    assert.ok(done.candidate);
    store.mutate(w.id, w => {
        const weakened = w.candidate!;
        w.candidate = undefined;
        w.revisions.push({id: 'legacy-weakened', number: 2, plan: weakened, createdAt: 'now'});
        w.currentId = 'legacy-weakened'
    });
    assert.throws(() => store.mutate(w.id, w => confirmRevision(w, 'legacy-weakened', 1)), /不能删除或改变/);
    assert.equal(current(store.get(w.id))?.confirmedAt, undefined);
    store.mutate(w.id, w => {
        w.candidate = structuredClone(fixture);
        w.candidate.pm.constraints.push('部署在本地')
    });
    done = store.mutate(w.id, acceptCandidate);
    assert.equal(done.candidate, undefined);
    assert.equal(done.requirement.analysis?.constraints.at(-1), '部署在本地');
    done = store.mutate(w.id, w => confirmRevision(w, done.currentId!, 1));
    assert.ok(current(done)?.confirmedAt);
    assert.deepEqual(done.revisions[0].plan, original);
    store.db.close()
});

test('cancelled late orchestration cannot create a recovery checkpoint or saved plan', async () => {
    const {store, w} = setup();
    let release: ((result: ReturnType<typeof response>) => void) | undefined;
    let checkpoints = 0;
    const prepare = store.prepareResult.bind(store);
    store.prepareResult = (...args) => {checkpoints++; prepare(...args)};
    const engine = new Engine(store, async (_j, stage) => stage === 'pm' ? response(stage) : await new Promise(r => {release = r}));
    engine.start(w.id, 1, '');
    for (let i = 0; !release && i < 100; i++) await new Promise(r => setTimeout(r, 5));
    assert.ok(release);
    engine.cancel(w.id);
    release(response('orchestrator'));
    await new Promise(r => setTimeout(r, 15));
    const done = store.get(w.id);
    assert.equal(done.job?.status, 'cancelled');
    assert.equal(checkpoints, 0);
    assert.equal(done.currentId, undefined);
    assert.equal(done.job?.result, undefined);
    store.db.close()
});

test('old-version save recovery stays stale and never calls the provider', async () => {
    const {store, w} = setup();
    let calls = 0, injected = false;
    const engine = new Engine(store, async (_j, stage) => {calls++; return response(stage)});
    const put = store.put.bind(store);
    store.put = value => {
        if (!injected && value.job?.result) {injected = true; throw new Error('write failed')}
        return put(value)
    };
    engine.start(w.id, 1, '');
    let done = await settle(store, w.id);
    assert.equal(done.job?.status, 'save_failed');
    done = store.mutate(w.id, w => {w.requirement = {version: 2, text: '最新需求', images: []}; w.requirements.push(w.requirement)});
    assert.throws(() => engine.retry(w.id, done.version), /过期/);
    assert.equal(calls, 2);
    assert.equal(store.get(w.id).currentId, undefined);
    store.db.close()
});

test('regeneration save failure keeps the saved revision and restores the frozen candidate without model calls', async () => {
    const {acceptCandidate} = await import('../src/server/revisions.ts');
    const {store, w} = setup();
    let calls = 0;
    const engine = new Engine(store, async (_j, stage) => {calls++; return response(stage)});
    engine.start(w.id, 1, '');
    let done = await settle(store, w.id);
    const original = structuredClone(current(done));
    const put = store.put.bind(store);
    let injected = false;
    store.put = value => {
        if (!injected && value.job?.isRegeneration && value.job.result) {injected = true; throw new Error('candidate save failed')}
        return put(value)
    };
    engine.start(w.id, done.version, '调整分工');
    done = await settle(store, w.id);
    assert.equal(done.job?.status, 'save_failed');
    assert.equal(done.candidate, undefined);
    assert.deepEqual(current(done), original);
    assert.equal(calls, 4);
    store.saveSettings({...defaults, pmPrompt: 'LATER SETTINGS'});
    engine.retry(w.id, done.version);
    done = await settle(store, w.id);
    assert.equal(done.job?.status, 'complete');
    assert.equal(calls, 4);
    assert.equal(done.candidate?.settings.pmPrompt, defaults.pmPrompt);
    assert.deepEqual(current(done), original);
    const candidate = structuredClone(done.candidate);
    done = store.mutate(w.id, acceptCandidate);
    assert.deepEqual(current(done)?.plan, candidate);
    assert.deepEqual(done.revisions[0], original);
    store.db.close()
});

test('unadopted candidate additions do not silently change the saved requirement baseline', async () => {
    const {store, w} = setup();
    let additions = false;
    const engine = new Engine(store, async (_j, stage) => {
        const pm = structuredClone(fixture.pm);
        if (additions) pm.constraints.push('候选特有约束');
        return response(stage, pm)
    });
    engine.start(w.id, 1, '');
    let done = await settle(store, w.id);
    additions = true;
    engine.start(w.id, done.version, '增加约束');
    done = await settle(store, w.id);
    assert.ok(done.candidate?.pm.constraints.includes('候选特有约束'));
    assert.ok(!requirementBaseline(done)?.constraints.includes('候选特有约束'));
    done = store.mutate(w.id, w => {w.candidate = undefined});
    additions = false;
    engine.start(w.id, done.version, '放弃候选后再生成');
    done = await settle(store, w.id);
    assert.equal(done.job?.status, 'complete');
    assert.ok(!done.candidate?.pm.constraints.includes('候选特有约束'));
    store.db.close()
});
