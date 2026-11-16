import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Questions from '../src/client/components/Questions.tsx';
import {composeAnswers, emptyQuestionDraft, normalizeQuestions, questionComplete, readQuestionDraft, retainQuestionDraft, questionRoundKey} from '../src/client/questionState.ts';
import type {Workflow} from '../src/shared/domain.ts';

// Cover both supported boundaries and legacy overflow without a full mode/count matrix.
for (const {count, multi} of [
    {count: 2, multi: false},
    {count: 3, multi: true},
    {count: 5, multi: true},
]) {
    test(`question UI shows at most three of ${count} choices plus one custom answer`, () => {
        const options = Array.from({length: count}, (_, i) => `候选答案${i + 1}`);
        const savedOptions = [...options];
        const question = {id: 'Q1', text: '范围？', reason: '必要', multi, options};
        const html = renderToStaticMarkup(createElement(Questions, {
            questions: [question], busy: false, onSubmit: () => {},
        }));
        const visibleCount = Math.min(count, 3);
        assert.equal((html.match(new RegExp(`role="${multi ? 'checkbox' : 'radio'}"`, 'g')) || []).length, visibleCount + 1);
        assert.equal((html.match(/class="choice custom"/g) || []).length, 1);
        for (let i = 0; i < count; i++) {
            assert.equal(html.includes(options[i]), i < visibleCount);
        }
        assert.deepEqual(question.options, savedOptions, 'rendering must not mutate saved questions');
    });
}

test('legacy questions without choices still allow a free-text answer', () => {
    const html = renderToStaticMarkup(createElement(Questions, {
        questions: [{id: 'Q1', text: '范围？', reason: '必要'}],
        busy: false, onSubmit: () => {},
    }));
    assert.ok(html.includes('aria-label="范围？ 的回答"'));
});

test('wizard renders only the current question and requires an answer before continuing', () => {
    const html = renderToStaticMarkup(createElement(Questions, {questions: [
        {id: 'first', text: '第一题', options: ['选项一', '选项二'], reason: ''},
        {id: 'second', text: '第二题', options: ['下一题选项'], reason: ''},
    ], busy: false, onSubmit: () => {}}));
    assert.ok(html.includes('第一题'));
    assert.ok(!html.includes('第二题'));
    assert.match(html, /disabled="">下一步/);
    assert.ok(!html.includes('提交回答并继续分析'));
});

test('question drafts validate custom responses and preserve answer format', () => {
    const questions = normalizeQuestions([
        {id: 'a', text: '范围？', reason: '', multi: true, options: ['客户', '员工', '访客', '旧选项']},
        {id: 'b', text: '补充？', reason: ''},
    ]);
    const draft = emptyQuestionDraft();
    assert.equal(questionComplete(questions[0], draft), false);
    draft.picked.a = [1, 0, -1];
    assert.equal(questionComplete(questions[0], draft), false);
    draft.custom.a = ' 管理员 '; draft.custom.b = ' 使用中文 '; draft.notes = ' 优先移动端 ';
    assert.equal(questionComplete(questions[0], draft), true);
    assert.equal(questionComplete(questions[1], draft), true);
    assert.equal(composeAnswers(questions, draft), '1. 范围？\n回答：A. 客户；B. 员工；自定义：管理员\n2. 补充？\n回答：使用中文\n补充说明：优先移动端');
    draft.picked.a = [3];
    assert.equal(questionComplete(questions[0], draft), false);
});

test('question sessions survive reopen but separate workflow job and question rounds', () => {
    const w = {id: 'w', job: {id: 'job', stage: 'pm', requirement: {version: 1}, answers: [], questions: [], issues: [], attempt: 1}} as unknown as Workflow;
    const key = questionRoundKey(w), draft = {...emptyQuestionDraft(), step: 1, notes: '保留'};
    retainQuestionDraft(key, draft);
    assert.equal(readQuestionDraft(key).step, 1);
    assert.equal(questionRoundKey({...w, job: {...w.job!, attempt: 2}}), key, 'retrying the same pending questions preserves answers');
    assert.notEqual(questionRoundKey({...w, id: 'another'}), key);
    assert.notEqual(questionRoundKey({...w, job: {...w.job!, id: 'new'}}), key);
    const next = questionRoundKey({...w, job: {...w.job!, questions: [{id: 'q', text: '新问题', reason: ''}]}});
    assert.notEqual(next, key);
    assert.equal(readQuestionDraft(next).step, 0);
});
