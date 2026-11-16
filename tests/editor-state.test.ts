import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmState, saveState, type ConfirmContext, type SaveContext} from '../src/client/editorState.ts';

const base: ConfirmContext = {
    confirmed: false,
    confirming: false,
    busy: false,
    active: false,
    dirty: false,
    conflict: false,
    candidate: false,
    findings: [],
    requirementVersion: 1,
    revisionRequirementVersion: 1
};

test('a clean unconfirmed revision can be confirmed', () => {
    const state = confirmState(base);
    assert.equal(state.disabled, false);
    assert.equal(state.label, '确认方案');
    assert.equal(state.reason, '');
});

test('an already confirmed revision is disabled and labelled as confirmed', () => {
    const state = confirmState({...base, confirmed: true});
    assert.equal(state.disabled, true);
    assert.equal(state.label, '已确认');
    assert.equal(state.reason, '当前修订已确认');
});

test('unsaved edits take precedence over the confirmed label', () => {
    const state = confirmState({...base, confirmed: true, dirty: true});
    assert.equal(state.disabled, true);
    assert.equal(state.label, '确认方案');
    assert.match(state.reason, /未保存修改/);
});

test('candidate, structure and coverage blockers explain why confirmation is unavailable', () => {
    assert.match(confirmState({...base, candidate: true}).reason, /候选稿/);
    assert.match(confirmState({
        ...base,
        findings: [{path: 'task:T1', message: '依赖无效', level: 'error'}]
    }).reason, /结构错误/);
    assert.match(confirmState({
        ...base,
        findings: [{path: 'criterion:C1', message: '未覆盖', level: 'coverage'}]
    }).reason, /全部覆盖/);
});

test('an old requirement and pending questions block confirmation', () => {
    assert.match(confirmState({...base, requirementVersion: 2}).reason, /旧需求/);
    assert.match(confirmState({...base, jobStatus: 'waiting'}).reason, /待回答/);
    assert.match(confirmState({...base, jobStatus: 'issues'}).reason, /待回答/);
});

test('submission and other busy actions are distinguished', () => {
    const submitting = confirmState({...base, confirming: true, busy: true});
    assert.equal(submitting.label, '确认中…');
    assert.match(submitting.reason, /正在提交确认/);

    const busy = confirmState({...base, busy: true});
    assert.equal(busy.label, '确认方案');
    assert.match(busy.reason, /其他操作/);

    const active = confirmState({...base, active: true});
    assert.match(active.reason, /生成进行中/);
});

test('conflicts and draft base disagreements block confirmation', () => {
    assert.match(confirmState({...base, conflict: true}).reason, /冲突/);
});

const saveBase: SaveContext = {
    saving: false,
    busy: false,
    active: false,
    conflict: false,
    dirty: true,
    findings: []
};

test('save is available for an edited, structurally valid draft and reads as saved when clean', () => {
    const dirty = saveState(saveBase);
    assert.equal(dirty.disabled, false);
    assert.equal(dirty.label, '保存方案');
    assert.equal(dirty.reason, '');

    const clean = saveState({...saveBase, dirty: false});
    assert.equal(clean.disabled, true);
    assert.equal(clean.label, '已保存');
    assert.match(clean.reason, /没有未保存/);
});

test('coverage gaps allow saving but structural errors do not', () => {
    const coverage = saveState({
        ...saveBase,
        findings: [{path: 'criterion:C1', message: '未覆盖', level: 'coverage'}]
    });
    assert.equal(coverage.disabled, false);
    assert.equal(coverage.label, '保存方案');

    const structural = saveState({
        ...saveBase,
        findings: [{path: 'task:T1', message: '依赖无效', level: 'error'}]
    });
    assert.equal(structural.disabled, true);
    assert.match(structural.reason, /结构错误/);
});

test('saving, active generation and base conflicts block saving with distinct reasons', () => {
    const saving = saveState({...saveBase, saving: true});
    assert.equal(saving.disabled, true);
    assert.equal(saving.label, '保存中…');
    assert.match(saving.reason, /正在保存/);

    assert.match(saveState({...saveBase, active: true}).reason, /生成进行中/);
    assert.match(saveState({...saveBase, conflict: true}).reason, /冲突/);
    assert.equal(saveState({...saveBase, conflict: true}).label, '保存方案');
});
