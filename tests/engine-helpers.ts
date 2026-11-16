import {randomUUID} from 'node:crypto';
import {Store} from '../src/server/store.ts';
import type {Plan, Workflow} from '../src/shared/domain.ts';
import {fixture} from './fixtures.ts';

export function setup(path = ':memory:') {
    const store = new Store(path);
    const req = {version: 1, text: '测试需求', images: []};
    const w: Workflow = {id: randomUUID(), title: '测试', version: 1, requirement: req, requirements: [req], revisions: [], layout: {}, createdAt: '2026-11-16', updatedAt: '2026-11-16'};
    store.put(w);
    return {store, w}
}

type ReadyResult =
    | {kind: 'ready'; pm: Plan['pm']}
    | {kind: 'ready'; agents: Plan['agents']; assignments: {taskId: string; agentId: string}[]; rationale: string};

export const response = (stage: string, pm = fixture.pm): {result: ReadyResult; usage: {total_tokens: number}} => ({
    result: stage === 'pm' ? {kind: 'ready', pm} : {kind: 'ready', agents: fixture.agents, assignments: pm.tasks.map(t => ({taskId: t.id, agentId: t.agentId})), rationale: fixture.rationale},
    usage: {total_tokens: 10}
});

export async function settle(store: Store, id: string) {
    for (let n = 0; n < 200; n++) {
        const w = store.get(id);
        if (!['analyzing', 'orchestrating'].includes(w.job?.status || '')) return w;
        await new Promise(r => setTimeout(r, 10))
    }
    throw new Error('timeout')
}
