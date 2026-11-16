import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {loadConfig} from '../src/server/config.ts';

function setup(t: test.TestContext) {
    const root = mkdtempSync(resolve(tmpdir(), 'weave-config-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    return root;
}

test('configuration defaults to port 3000 without an env file', t => {
    const root = setup(t);
    assert.deepEqual(loadConfig(root, {}), {port: 3000, dataPath: resolve(root, 'data/weave.sqlite')});
});

test('project env loads API key, port, and model settings', t => {
    const root = setup(t), env: NodeJS.ProcessEnv = {};
    writeFileSync(resolve(root, '.env'), 'DEEPSEEK_API_KEY=local-test-key\nPORT=8080\nDATA_PATH=custom/workflows.sqlite\nMODEL_TIMEOUT_MS=60000\n');
    assert.deepEqual(loadConfig(root, env), {port: 8080, dataPath: resolve(root, 'custom/workflows.sqlite')});
    assert.equal(env.DEEPSEEK_API_KEY, 'local-test-key');
    assert.equal(env.MODEL_TIMEOUT_MS, '60000');
});

test('explicit process environment takes precedence over env file', t => {
    const root = setup(t);
    writeFileSync(resolve(root, '.env'), 'DEEPSEEK_API_KEY=file-test-key\nPORT=8080\n');
    const env = {DEEPSEEK_API_KEY: 'shell-test-key', PORT: '3001', DATA_PATH: ':memory:'};
    assert.deepEqual(loadConfig(root, env), {port: 3001, dataPath: ':memory:'});
    assert.equal(env.DEEPSEEK_API_KEY, 'shell-test-key');
});

test('configuration resolves env from the supplied root, not the working directory', t => {
    const root = setup(t), elsewhere = setup(t);
    writeFileSync(resolve(root, '.env'), 'DEEPSEEK_API_KEY=project-test-key\nPORT=8080\n');
    writeFileSync(resolve(elsewhere, '.env'), 'DEEPSEEK_API_KEY=wrong-test-key\nPORT=9000\n');
    const previousCwd = process.cwd(), env: NodeJS.ProcessEnv = {};
    try {
        process.chdir(elsewhere);
        assert.deepEqual(loadConfig(root, env), {port: 8080, dataPath: resolve(root, 'data/weave.sqlite')});
        assert.equal(env.DEEPSEEK_API_KEY, 'project-test-key');
    } finally {
        process.chdir(previousCwd);
    }
});

test('invalid ports fail with a clear configuration error', t => {
    const root = setup(t);
    for (const PORT of ['not-a-port', '0', '-1', '65536', '3000.5', ' ']) {
        assert.throws(() => loadConfig(root, {PORT}), /PORT 必须是 1 到 65535 之间的整数/);
    }
});

test('env read errors are not silently ignored', t => {
    const root = setup(t);
    mkdirSync(resolve(root, '.env'));
    assert.throws(() => loadConfig(root, {}));
});
