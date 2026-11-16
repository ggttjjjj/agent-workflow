import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Questions from '../src/client/components/Questions.tsx';

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
