import test from 'node:test';
import assert from 'node:assert/strict';
import type {Plan} from '../src/shared/domain.ts';
import {updateDependency} from '../src/client/dependencies.ts';

const plan = () => ({pm:{tasks:[
    {id:'A',dependsOn:[]},{id:'B',dependsOn:['A']},{id:'C',dependsOn:['B']},{id:'D',dependsOn:[]}
]}} as unknown as Plan);
const edge = {from:'A',to:'B'};
test('dependency endpoint replacements are immutable and atomic', () => {
    const original = plan();
    const source = updateDependency(original,edge,{from:'D',to:'B'});
    assert.equal(source.error,undefined);
    assert.deepEqual(source.plan.pm.tasks[1].dependsOn,['D']);
    const target = updateDependency(original,edge,{from:'A',to:'D'});
    assert.deepEqual(target.plan.pm.tasks[1].dependsOn,[]);
    assert.deepEqual(target.plan.pm.tasks[3].dependsOn,['A']);
    assert.deepEqual(original.pm.tasks[1].dependsOn,['A']);
});
test('reversal removes the old dependency before checking for cycles', () => {
    const result = updateDependency(plan(),edge,{from:'B',to:'A'});
    assert.equal(result.error,undefined);
    assert.deepEqual(result.plan.pm.tasks[0].dependsOn,['B']);
    assert.deepEqual(result.plan.pm.tasks[1].dependsOn,[]);
});
test('invalid edits preserve the exact original plan', () => {
    const original = plan();
    for (const [next,message] of [
        [{from:'A',to:'A'},'自环'],[{from:'B',to:'C'},'已存在'],
        [{from:'C',to:'B'},'循环'],[{from:'missing',to:'B'},'存在']
    ] as const) {
        const result = updateDependency(original,edge,next);
        assert.match(result.error!,new RegExp(message));
        assert.equal(result.plan,original);
    }
});
test('deletion is immutable, no-op keeps identity, and stale edges are rejected', () => {
    const original = plan();
    assert.equal(updateDependency(original,edge,edge).plan,original);
    const removed = updateDependency(original,edge);
    assert.equal(removed.error,undefined);
    assert.deepEqual(removed.plan.pm.tasks[1].dependsOn,[]);
    const stale = updateDependency(removed.plan,edge,{from:'D',to:'B'});
    assert.match(stale.error!,/已不存在/);
    assert.equal(stale.plan,removed.plan);
});
