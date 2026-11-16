import {config} from 'dotenv';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function loadConfig(root = projectRoot, env: NodeJS.ProcessEnv = process.env) {
    const result = config({path: resolve(root, '.env'), processEnv: env, quiet: true});
    if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') throw result.error;

    const port = Number(env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('PORT 必须是 1 到 65535 之间的整数');
    }
    const dataPath = env.DATA_PATH === ':memory:' ? ':memory:' : resolve(root, env.DATA_PATH || 'data/weave.sqlite');
    return {port, dataPath};
}
