import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Regenerate from '../src/client/components/Regenerate.tsx';
import {defaults, type Job, type Workflow} from '../src/shared/domain.ts';
import {fixture} from './fixtures.ts';

function saved(): Workflow {
    const req = {version: 1, text: '为社区策划亲子阅读活动', images: []};
    return {
        id: 'w',
        title: '重新生成测试',
        version: 2,
        requirement: req,
        requirements: [req],
        revisions: [{
            id: 'r1',
            number: 1,
            plan: structuredClone(fixture),
            createdAt: '2026-11-16T10:00:00.000Z'
        }],
        currentId: 'r1',
        layout: {},
        createdAt: '2026-11-16T09:00:00.000Z',
        updatedAt: '2026-11-16T10:00:00.000Z'
    }
}

function job(status: Job['status'], feedback = ''): Job {
    return {
        id: 'j',
        status,
        stage: 'pm',
        requirement: {version: 1, text: '测试需求', images: []},
        settings: defaults,
        feedback,
        answers: [],
        questions: [],
        issues: [],
        preview: '',
        usage: null,
        attempt: 1,
        createdAt: '2026-11-16T10:00:00.000Z',
        isRegeneration: true
    }
}

const render = (w = saved(), configured = true, busy = false) => renderToStaticMarkup(createElement(Regenerate, {
    w,
    busy,
    configured,
    onGenerate: async () => undefined
}));

test('regeneration tab shows the feedback form, saved baseline and primary action', () => {
    const html = render();
    assert.match(html, /重新生成方案/);
    assert.match(html, /本次重生成意见/);
    assert.match(html, /AI 重生成/);
    assert.match(html, /当前基线/);
    assert.match(html, /r1/);
    assert.ok(!html.includes('disabled'), 'idle and configured: action is available');
});

test('an active run disables the action and states that generation is in progress', () => {
    const w = saved();
    w.job = {...job('analyzing'), requirement: w.requirement};
    const html = render(w);
    assert.match(html, /生成进行中/);
    assert.match(html, /正在生成/);
    assert.match(html, /disabled/);
});

test('a candidate blocks a new run until it is accepted or discarded', () => {
    const w = saved();
    w.candidate = structuredClone(fixture);
    const html = render(w);
    assert.match(html, /请先处理候选稿/);
    assert.match(html, /存在候选稿/);
    assert.match(html, /disabled/);
});

test('missing credentials block the action with a clear reason', () => {
    const html = render(saved(), false);
    assert.match(html, /尚未配置密钥/);
    assert.match(html, /disabled/);
});

test('confirmation and requirement version changes are reported against the saved baseline', () => {
    const w = saved();
    w.revisions[0].confirmedAt = '2026-11-16T11:00:00.000Z';
    let html = render(w);
    assert.match(html, /已确认/);
    assert.match(html, /当前方案已确认/);

    w.requirement = {...w.requirement, version: 2, text: '更新后的需求'};
    w.requirements.push(w.requirement);
    html = render(w);
    assert.match(html, /对应旧需求 v1/);
    assert.doesNotMatch(html, /当前方案已确认/);
});

test('pending planning stages block regeneration until answered or cancelled', () => {
    for (const status of ['waiting', 'issues'] as const) {
        const w = saved();
        w.job = {...job(status), requirement: w.requirement};
        const html = render(w);
        assert.match(html, /待回答的问题/);
        assert.match(html, /请先回答或取消本轮生成/);
        assert.match(html, /disabled/);
        assert.doesNotMatch(html, /重新生成会丢弃/);
    }
});

test('the previous submitted feedback is visible next to the baseline', () => {
    const w = saved();
    w.job = {...job('complete', '合并相近角色'), requirement: w.requirement};
    const html = render(w);
    assert.match(html, /提交意见/);
    assert.match(html, /合并相近角色/);
});
