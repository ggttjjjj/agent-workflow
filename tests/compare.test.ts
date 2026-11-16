import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {comparePlans} from '../src/shared/compare.ts';
import PlanComparison from '../src/client/components/PlanComparison.tsx';
import {fixture} from './fixtures.ts';

test('structured review covers requirement, criterion, task, edge, Agent, assignment and config changes', () => {
    const next = structuredClone(fixture);
    next.requirementVersion = 2;
    next.pm.goal = '新目标';
    next.pm.criteria.pop();
    next.pm.criteria[0].text = '新的明确验收条件';
    next.pm.criteria.push({id: 'C3', text: '新增要求'});
    next.pm.tasks[0].title = '新任务名';
    next.pm.tasks[1].dependsOn = [];
    next.pm.tasks[1].agentId = 'A3';
    next.agents[0].responsibility = '更新职责';
    next.agents.pop();
    next.effort = 'max';
    const before = {version: 1, text: '原需求全文', images: [{id: 'img1', name: '原图', data: 'SECRET_BASE64_OLD'}]};
    const after = {version: 2, text: '新需求全文', images: [{id: 'img1', name: '原图', data: 'SECRET_BASE64_NEW'}]};
    const groups = comparePlans(fixture, next, before, after);
    for (const g of groups.filter(g => g.title !== '澄清与异议问答')) assert.ok(g.changes.length > 0, g.title);
    const criteria = groups.find(g => g.title === '验收条件')!.changes;
    assert.deepEqual(criteria.map(c => [c.label, c.kind]), [['C1', 'changed'], ['C2', 'removed'], ['C3', 'added']]);
    assert.ok(groups.find(g => g.title === '依赖')!.changes.some(c => c.kind === 'removed'));
    const markup = renderToStaticMarkup(createElement(PlanComparison, {before: fixture, after: next, oldRequirement: before, newRequirement: after}));
    for (const text of ['原需求全文', '新需求全文', '删除', '新增', '修改', 'C2', '任务分配', '需求分析', 'Agent 定义']) assert.ok(markup.includes(text), text);
    assert.ok(!markup.includes('SECRET_BASE64'))
});

test('unchanged plans show no changes, task and Agent removal remain explicit', () => {
    assert.ok(comparePlans(fixture, structuredClone(fixture)).every(g => g.changes.length === 0));
    const next = structuredClone(fixture);
    next.pm.tasks.pop();
    next.agents.pop();
    const groups = comparePlans(fixture, next);
    for (const title of ['任务', '依赖', 'Agent 定义', '任务分配']) assert.ok(groups.find(g => g.title === title)?.changes.some(c => c.kind === 'removed'), title)
});
