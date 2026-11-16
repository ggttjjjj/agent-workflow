import {useState} from 'react';
import {current, type Workflow} from '../../shared/domain';

/**
 * Regeneration lives in its own tab so the top requirement bar stays read-only.
 * The saved revision is the baseline; a successful run produces a candidate.
 */
export default function Regenerate({w, busy, configured, onGenerate}: {
    w: Workflow;
    busy: boolean;
    configured: boolean;
    onGenerate: (feedback: string) => Promise<Workflow | undefined>
}) {
    const [feedback, setFeedback] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const revision = current(w);
    if (!revision) return <p className="hint">当前还没有已保存方案，完成一次生成后才能重新生成。</p>;

    const generating = ['analyzing', 'orchestrating'].includes(w.job?.status || '');
    const pending = ['waiting', 'issues'].includes(w.job?.status || '');
    const confirmed = !!revision.confirmedAt && revision.plan.requirementVersion === w.requirement.version;
    const stale = revision.plan.requirementVersion !== w.requirement.version;
    const blocked = submitting || busy || generating || !!w.candidate || !configured;
    const label = generating
        ? '生成进行中…'
        : w.candidate
            ? '请先处理候选稿'
            : !configured
                ? '尚未配置密钥'
                : submitting || busy
                    ? '处理中…'
                    : 'AI 重生成';

    async function submit() {
        if (blocked) return;
        setSubmitting(true);
        try {
            const next = await onGenerate(feedback);
            if (next) setFeedback('')
        } finally {
            setSubmitting(false)
        }
    }

    return <section className="regenerate">
        <header className="regenerate-head">
            <div>
                <h2>重新生成方案</h2>
                <p>重新执行 PM 分析与 AI 编排，基于最新需求和已保存的 r{revision.number}
                    生成候选稿。当前方案会保留，只有采用候选后才替换。</p>
            </div>
            <span className="tag">需求 v{w.requirement.version}</span>
        </header>
        <div className="regenerate-grid">
            <div className="regenerate-form">
                <label className="field">本次重生成意见（可选）
                    <textarea rows={6} value={feedback} disabled={generating}
                              placeholder="例如：合并相近角色、调整任务顺序、补充验收说明…"
                              onChange={e => setFeedback(e.target.value)}/></label>
                <div className="regenerate-actions">
                    <button className="primary" disabled={blocked} onClick={() => void submit()}>{label}</button>
                    {generating && <span className="pulse">正在生成，可在上方进度面板查看与取消</span>}
                </div>
                <p className="hint">意见只影响本次生成；需求级验收条件的调整请使用顶部「查看 / 修改需求」。</p>
            </div>
            <aside className="regenerate-status">
                <h3>当前基线</h3>
                <dl className="regen-facts">
                    <div><dt>修订</dt><dd>r{revision.number}</dd></div>
                    <div><dt>需求版本</dt><dd>v{w.requirement.version}</dd></div>
                    <div><dt>确认状态</dt><dd className={confirmed ? 'success' : 'muted'}>{confirmed ? '已确认' : '待审查'}</dd></div>
                    <div><dt>保存于</dt><dd>{new Date(revision.createdAt).toLocaleString()}</dd></div>
                    {w.job?.feedback && <div><dt>提交意见</dt><dd className="regen-feedback">{w.job.feedback}</dd></div>}
                </dl>
                {!configured && <p className="warning">尚未配置密钥：在项目 .env 设置 DEEPSEEK_API_KEY 后重启服务。</p>}
                {w.candidate && <p className="warning">存在候选稿，请先在「版本与候选」中采用或放弃；生成按钮暂不可用。</p>}
                {stale && <p className="warning">当前方案对应旧需求 v{revision.plan.requirementVersion}；重新生成会基于最新需求
                    v{w.requirement.version} 进行。</p>}
                {pending && <p className="warning">当前还有待回答的问题；重新生成会丢弃这些问题，建议先在上方处理。</p>}
                {confirmed && !w.candidate && <p className="hint">当前方案已确认；采用新候选后需要重新确认。</p>}
                <p className="hint">重新生成只参考已保存方案；本地未保存草稿会保留，不会自动纳入。</p>
            </aside>
        </div>
    </section>
}
