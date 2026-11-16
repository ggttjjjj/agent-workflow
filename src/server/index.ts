import {savePlanningSettings, saveCanvas} from '../shared/planning.ts';
import {loadConfig, projectRoot} from './config.ts';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {Store} from './store.ts';
import {Engine, active} from './engine.ts';
import {acceptCandidate, confirmRevision} from './revisions.ts';
import {defaults, current, requirementBaseline, planSummary, cleanTitle, validatePlan, validateSettings, MAX_PLAN_TITLE, TRASH_CONFIRM, type Picture, type Workflow} from '../shared/domain.ts';

const {port, dataPath} = loadConfig();
const app = express(), store = new Store(dataPath),
    engine = new Engine(store);
app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== `http://${req.get('host')}`) return res.status(403).json({error: '仅允许本地同源请求'});
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next()
});
app.use(express.json({limit: '40mb'}));

function bad(m: string, status = 400): never {
    throw Object.assign(new Error(m), {status})
}

const lists = () => ({plans: store.all().map(planSummary), trash: store.all(true).map(planSummary)});

async function requirement(body: any, version: number) {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length > 100000) bad('文本过长，请控制在 10 万字符内');
    if (!Array.isArray(body.images) || body.images.length > 12) bad('最多上传12张图片');
    const images: Picture[] = [];
    for (const pic of body.images) {
        if (typeof pic.data !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(pic.data)) bad('图片格式无效，仅支持 PNG/JPEG/WebP/GIF');
        const b = Buffer.from(pic.data.split(',')[1], 'base64');
        if (b.length > 10 * 1024 * 1024) bad('单张图片不能超过10MB');
        try {
            const metadata = await sharp(b, {limitInputPixels: 24000000}).metadata();
            if ((metadata.pages || 1) > 1) bad('请将动画图片转为静态图片');
            const result = await sharp(b, {limitInputPixels: 24000000}).png().toBuffer();
            if (result.length > 10 * 1024 * 1024) bad('解码后的图片超过10MB，请压缩后上传');
            images.push({
                id: typeof pic.id === 'string' ? pic.id : randomUUID(),
                name: String(pic.name || '图片').slice(0, 200),
                data: 'data:image/png;base64,' + result.toString('base64')
            })
        } catch {
            bad('图片损坏、尺寸过大或不支持，请重新上传')
        }
    }
    if (!text && !images.length) bad('请提供文本或图片需求');
    if (new Set(images.map(i => i.id)).size !== images.length) bad('图片ID重复');
    return {version, text, images};
}

app.use('/api/workflows/:id', (q, _r, next) => {
    if (q.method === 'POST' && !q.path.endsWith('/cancel') && !q.path.endsWith('/trash') && (!Number.isInteger(q.body?.expectedVersion) || q.body.expectedVersion < 1)) return next(Object.assign(new Error('缺少有效版本号'), {status: 400}));
    next()
});
app.get('/api/meta', (_q, r) => r.json({configured: !!process.env.DEEPSEEK_API_KEY, model: 'deepseek-flash'}));
app.get('/api/settings', (_q, r) => r.json({settings: store.settings(), defaults}));
app.put('/api/settings', (q, r) => {
    if (!validateSettings(q.body)) bad('提示词或思考强度无效');
    r.json(store.saveSettings(q.body))
});
app.get('/api/workflows', (_q, r) => r.json(lists()));
app.post('/api/workflows', async (q, r) => {
    const req = await requirement(q.body, 1);
    const w: Workflow = {
        id: randomUUID(),
        title: cleanTitle([...(req.text || req.images[0].name)].slice(0, 32).join('')) || '未命名方案',
        version: 1,
        requirement: req,
        requirements: [req],
        revisions: [],
        planningSettings: store.settings(),
        layout: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    store.put(w);
    r.json(w)
});
app.patch('/api/workflows/:id', (q, r) => {
    const title = cleanTitle(q.body?.title);
    if (!title) bad(`方案标题需为 1–${MAX_PLAN_TITLE} 个字符`);
    store.rename(String(q.params.id), title, Number.isInteger(q.body?.expectedVersion) ? q.body.expectedVersion : undefined);
    r.json(lists())
});
app.post('/api/workflows/:id/duplicate', (q, r) => {
    const copy = store.duplicate(String(q.params.id));
    r.json({...lists(), id: copy.id})
});
app.post('/api/workflows/:id/trash', (q, r) => {
    engine.trash(String(q.params.id));
    r.json(lists())
});
app.post('/api/workflows/:id/restore', (q, r) => {
    store.restore(String(q.params.id), q.body.expectedVersion);
    r.json(lists())
});
// Static route precedes :id so DELETE /api/workflows/trash never resolves as a plan id.
app.delete('/api/workflows/trash', (q, r) => {
    if (q.body?.confirm !== TRASH_CONFIRM) bad(`请输入「${TRASH_CONFIRM}」以确认清空`);
    store.emptyTrash(q.body?.expectedCount);
    r.json(lists())
});
app.delete('/api/workflows/:id', (q, r) => {
    const id = String(q.params.id), w = store.get(id, true);
    if (!w.trashedAt) bad('请先将方案移入回收站', 409);
    if (typeof q.body?.title !== 'string' || q.body.title.trim() !== w.title.trim()) bad('标题不一致，未执行彻底删除');
    store.purge(id);
    r.json(lists())
});
app.get('/api/workflows/:id', (q, r) => r.json(store.get(String(q.params.id))));
app.post('/api/workflows/:id/requirements', async (q, r) => {
    const id = String(q.params.id), old = store.get(id), req = await requirement(q.body, old.requirement.version + 1);
    r.json(store.mutate(id, w => {
        w.requirement = req;
        w.requirements.push(req)
    }, q.body.expectedVersion))
});
app.post('/api/workflows/:id/generate', (q, r) => r.json(engine.start(String(q.params.id), q.body.expectedVersion, String(q.body.feedback || ''))));
app.post('/api/workflows/:id/cancel', (q, r) => r.json(engine.cancel(String(q.params.id))));
app.post('/api/workflows/:id/retry', (q, r) => r.json(engine.retry(String(q.params.id), q.body.expectedVersion, q.body.answer)));
app.post('/api/workflows/:id/save', (q, r) => r.json(store.mutate(String(q.params.id), w => {
    if (active(w.job)) bad('生成期间请保留草稿，结束后保存', 409);
    const old = current(w);
    if (!old || old.id !== q.body.baseId) bad('方案基线已变化', 409);
    const plan = q.body.plan;
    if (JSON.stringify(plan?.pm?.criteria) !== JSON.stringify(old.plan.pm.criteria) || plan?.requirementVersion !== old.plan.requirementVersion || JSON.stringify(plan?.settings) !== JSON.stringify(old.plan.settings) || JSON.stringify(plan?.answers) !== JSON.stringify(old.plan.answers) || plan?.model !== old.plan.model || plan?.effort !== old.plan.effort) bad('需求验收、问答与默认模型配置只能通过重生成更新');
    for (const k of ['goal', 'audience', 'deliverables', 'constraints', 'exclusions', 'assumptions'] as const) if (JSON.stringify(plan.pm[k]) !== JSON.stringify(old.plan.pm[k])) bad('需求级内容请通过修改需求更新');
    const req = w.requirements.find(x => x.version === plan.requirementVersion)!;
    const errors = validatePlan(plan, req, true, requirementBaseline(w, plan.requirementVersion)).filter(x => x.level === 'error');
    if (errors.length) bad(errors.map(e => e.path + ': ' + e.message).join('\n'));
    const rev = {id: randomUUID(), number: w.revisions.length + 1, plan, createdAt: new Date().toISOString()};
    w.revisions.push(rev);
    w.currentId = rev.id
}, q.body.expectedVersion)));
app.post('/api/workflows/:id/candidate', (q, r) => r.json(store.mutate(String(q.params.id), w => {
    if (!w.candidate) bad('没有候选稿');
    if (q.body.accept) acceptCandidate(w);
    w.candidate = undefined
}, q.body.expectedVersion)));
app.post('/api/workflows/:id/confirm', (q, r) => r.json(store.mutate(String(q.params.id), w => {
    confirmRevision(w, q.body.revisionId, q.body.requirementVersion)
}, q.body.expectedVersion)));
app.put('/api/workflows/:id/planning-settings', (q, r) => r.json(store.mutate(String(q.params.id), w => {
    savePlanningSettings(w, q.body.settings)
}, q.body.expectedVersion)));
app.put('/api/workflows/:id/layout', (q, r) => r.json(store.mutate(String(q.params.id), w => {
    saveCanvas(w, q.body)
})));
app.get('/api/workflows/:id/events', (q, r) => {
    store.get(String(q.params.id));
    r.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive'});
    r.flushHeaders();
    let snapshot = '';
    const send = () => {
        try {
            const w = store.get(String(q.params.id));
            // A recovery checkpoint can expose save_failed even while every
            // SQLite write is failing, so that transition has no new DB version.
            const next = `${w.version}:${w.job?.id || ''}:${w.job?.status || ''}`;
            if (next !== snapshot) {
                snapshot = next;
                r.write(`id: ${w.version}\ndata: ${JSON.stringify(w)}\n\n`)
            } else r.write(': heartbeat\n\n')
        } catch {
            r.end()
        }
    };
    send();
    const timer = setInterval(send, 700);
    q.on('close', () => clearInterval(timer))
});
app.use('/api', (_q, _r, next) => next(Object.assign(new Error('接口不存在'), {status: 404})));
if (process.argv.includes('--production')) {
    app.use(express.static(resolve(projectRoot, 'dist')));
    app.get('/{*path}', (_q, r) => r.sendFile(resolve(projectRoot, 'dist/index.html')))
} else {
    const {createServer} = await import('vite');
    const vite = await createServer({root: projectRoot, server: {middlewareMode: true}, appType: 'spa'});
    app.use(vite.middlewares)
}
app.use((e: any, _q: express.Request, r: express.Response, _n: express.NextFunction) => {
    r.status(e.status || 500).json({error: e.status ? e.message : '操作失败，原方案仍保留；请重试或检查本地存储'})
});
app.listen(port, '127.0.0.1', () => console.log(`织序 / WEAVE: http://127.0.0.1:${port}`));
