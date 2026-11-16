import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatUsage} from '../src/client/usage.ts';

test('usage summary is compact and hides the raw provider payload', () => {
    assert.equal(formatUsage({
        prompt_tokens: 470,
        completion_tokens: 1030,
        total_tokens: 1500,
        prompt_tokens_details: {cached_tokens: 0},
        completion_tokens_details: {reasoning_tokens: 806},
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 470
    }), '输入 470 · 输出 1,030 · 合计 1,500 tokens');
});

test('usage summary derives missing totals and falls back to unknown', () => {
    assert.equal(formatUsage({prompt_tokens: 470, completion_tokens: 30}), '输入 470 · 输出 30 · 合计 500 tokens');
    assert.equal(formatUsage({total_tokens: 10}), '合计 10 tokens');
    assert.equal(formatUsage({prompt_tokens: 0, completion_tokens: 0, total_tokens: 0}), '输入 0 · 输出 0 · 合计 0 tokens');
    assert.equal(formatUsage(null), '未知');
    assert.equal(formatUsage(undefined), '未知');
    assert.equal(formatUsage('{"total_tokens":10}'), '未知');
    assert.equal(formatUsage({prompt_tokens: '470', total_tokens: -1}), '未知');
});
