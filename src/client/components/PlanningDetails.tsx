import {useEffect, useState} from 'react';
import {current, requirementAnalysis, type Settings, type Workflow} from '../../shared/domain';
import {planningLocked, planningSettings, stageStates, type Stage} from '../../shared/planning';
import {api} from '../api';
import Questions from './Questions';

export default function PlanningDetails({w, stage, onUpdate, onError}: {w: Workflow; stage: Stage; onUpdate: (w: Workflow) => void; onError: (message: string) => void}) {
    const config = planningSettings(w), signature = JSON.stringify(config), job = w.job;
    const [draft, setDraft] = useState<Settings>(config), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
    useEffect(() => {setDraft(JSON.parse(signature)); setNotice('')}, [w.id, signature]);
    const locked = planningLocked(job), stale = !!job && job.requirement.version !== w.requirement.version;
    const prompt = stage === 'pm' ? 'pmPrompt' : 'orchestratorPrompt', effort = stage === 'pm' ? 'pmEffort' : 'orchestratorEffort';
    const owner = job?.stage === 'pm' ? 'pm' : 'orchestrator';
    async function action(path: string, method: string, body: unknown) {
        setBusy(true); setNotice('');
        try {onUpdate(await api<Workflow>(`/workflows/${w.id}/${path}`, method, body)); setNotice('操作已保存')}
        catch (e) {onError((e as Error).message)} finally {setBusy(false)}
    }
    const saved = current(w), result = job ? (stage === 'pm' ? job.pm && requirementAnalysis(job.pm) : job.result && {agents: job.result.agents, assignments: job.result.pm.tasks.map(t => ({taskId: t.id, agentId: t.agentId})), rationale: job.result.rationale, issues: job.issues}) : undefined;
    const answers = (job?.answers || w.answers || saved?.plan.answers || []).filter(a => (a.stage || 'pm') === stage);
    return <aside className="inspector planning-details">
        <h3>{stage === 'pm' ? '需求分析' : 'AI 编排'} <small>系统规划阶段</small></h3>
        <p role="status">{stageStates(job, !!saved)[stage]} · {job ? `本轮第 ${job.attempt} 次尝试 / 需求 v${job.requirement.version}` : '暂无本轮请求'}</p>
        {job?.status === 'save_failed' && <p className="warning">两阶段已校验，保存失败；不代表生成成功。重试只保存。</p>}
        {owner === stage && job?.error && <p className="error">{job.error}</p>}
        {stale && <p className="warning">本轮对应旧需求，不可回答或重试，请先取消未结束的旧请求，再主动重生成。</p>}
        <h4>下次主动重生成配置</h4><p className="hint">仅影响当前方案，不修改全局默认或历史结果。回答和重试始终使用原请求快照。</p>
        <label className="field">提示词<textarea disabled={locked || busy} rows={6} value={draft[prompt]} onChange={e => setDraft({...draft, [prompt]: e.target.value})}/></label>
        <label className="field">思考强度<select disabled={locked || busy} value={draft[effort]} onChange={e => setDraft({...draft, [effort]: e.target.value})}>
            <option value="low">低</option><option value="high">高</option><option value="max">最高</option></select></label>
        <button disabled={locked || busy || JSON.stringify(draft) === signature || !draft[prompt].trim()} onClick={() => action('planning-settings', 'PUT', {expectedVersion: w.version, settings: {...config, [prompt]: draft[prompt], [effort]: draft[effort]}})}>保存节点配置</button>
        {locked && <p className="hint">本轮配置已锁定（含等待处理）。结束后解锁。</p>}{notice && <p role="status">{notice}</p>}
        {job && <details><summary>本轮冻结的生成配置（只读）</summary><pre>{JSON.stringify({prompt: job.settings[prompt], effort: job.settings[effort]}, null, 2)}</pre></details>}
        {owner === stage && job && <>
            {locked && <button className="danger" disabled={busy} onClick={() => action('cancel', 'POST', {})}>取消本轮生成</button>}
            {['failed', 'cancelled', 'interrupted', 'save_failed'].includes(job.status) && <button disabled={busy || stale} onClick={() => action('retry', 'POST', {expectedVersion: w.version})}>{job.result ? '重试保存（不调用模型）' : job.pm ? '重试编排（复用需求分析）' : '重试需求分析'}</button>}
            {job.issues.map((issue, i) => <p className="warning" key={i}>{issue}</p>)}
            {['waiting', 'issues'].includes(job.status) && <Questions key={job.id} questions={job.questions} busy={busy} disabled={stale} onSubmit={answer => {void action('retry', 'POST', {expectedVersion: w.version, answer})}}/>}
            {['analyzing', 'orchestrating'].includes(job.status) && <section aria-label="本轮公开输出预览（未校验）">
                <h4>本轮公开输出预览 · 未校验</h4>
                <p className="hint">以下仅为模型公开输出，尚未校验或保存，不代表正式方案；不展示内部思考或可编辑任务预览。</p>
                {job.preview ? <pre>{job.preview}</pre> : <p>等待本阶段公开输出…</p>}
            </section>}
        </>}
        <h4>本轮公开结果摘要</h4>
        {result ? <><p>{stage === 'pm' ? job!.pm!.goal : `${job!.result!.agents.length} 个 Agent 定义 · ${job!.result!.pm.tasks.length} 项分配 · 尚未执行`}</p>
            {stage === 'pm' && job?.pm && <dl>{(['goal', 'audience', 'deliverables', 'constraints', 'exclusions', 'assumptions', 'criteria'] as const).map((key, i) => <div key={key}><dt>{['目标', '受众', '交付物', '约束', '排除项', '假设', '验收条件'][i]}</dt><dd>{typeof job.pm![key] === 'string' ? String(job.pm![key]) : <pre>{JSON.stringify(job.pm![key], null, 2)}</pre>}</dd></div>)}</dl>}
            <details><summary>已校验的结构化公开结果（非内部思考）</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></> : <p>暂无本轮已校验结果。</p>}
        <h4>澄清问答 / 异议处理记录</h4>{answers.length ? answers.map((a, i) => <article key={i}><small>需求 v{a.requirementVersion ?? '?'} · {a.stage === 'orchestrator' ? '编排' : '分析'}</small>{a.questions.map(q => <p key={q.id}>{q.text}</p>)}{a.issues?.map((issue, n) => <p key={n}>{issue}</p>)}<p>{a.answer}</p></article>) : <p>暂无问答。</p>}
        {saved && <details><summary>历史参考：当前已保存 r{saved.number}（不是本轮结果）</summary><pre>{JSON.stringify({
            configuration: {prompt: saved.plan.settings[prompt], effort: saved.plan.settings[effort]},
            result: stage === 'pm' ? requirementAnalysis(saved.plan.pm) : {agents: saved.plan.agents, rationale: saved.plan.rationale, assignments: saved.plan.pm.tasks.map(t => ({taskId: t.id, agentId: t.agentId}))}
        }, null, 2)}</pre></details>}
    </aside>
}
