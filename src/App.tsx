import {useEffect, useState} from 'react';
import {api} from './api';
import InputPanel from './components/InputPanel';
import SettingsPanel from './components/SettingsPanel';
import Questions from './components/Questions';
import Editor from './components/Editor';
import {current, type Workflow, type Picture} from '../shared/domain';

const states: Record<string, string> = {
    analyzing: 'PM 正在分析与拆解',
    orchestrating: 'AI 正在定义角色与分配任务',
    waiting: '等待澄清回答',
    issues: '编排器提出调整问题',
    complete: '方案生成完成',
    failed: '生成失败',
    cancelled: '生成已取消',
    interrupted: '生成已中断',
    save_failed: '结果保存失败'
};
export default function App() {
    const [list, setList] = useState<{
        id: string;
        title: string;
        confirmed: boolean;
        updatedAt: string
    }[]>([]), [w, setW] = useState<Workflow>(), [id, setId] = useState(''), [settings, setSettings] = useState(false), [meta, setMeta] = useState({
        configured: false,
        model: 'deepseek-flash'
    }), [error, setError] = useState(''), [busy, setBusy] = useState(false), [requirementOpen, setRequirementOpen] = useState(false), [feedback, setFeedback] = useState(''), [search, setSearch] = useState('');
    const refresh = () => api<typeof list>('/workflows').then(setList).catch(e => setError(e.message));
    useEffect(() => {
        void refresh();
        api<typeof meta>('/meta').then(setMeta).catch(e => setError(e.message))
    }, []);
    useEffect(() => {
        if (!id) {
            setW(undefined);
            return
        }
        setW(undefined);
        const stream = new EventSource(`/api/workflows/${id}/events`);
        stream.onmessage = e => {
            const next: Workflow = JSON.parse(e.data);
            setW(old => !old || next.version >= old.version ? next : old)
        };
        stream.onerror = () => {
            setError('连接暂时中断，正在重连；不会重复启动 AI 调用。')
        };
        return () => stream.close()
    }, [id]);
    const update = (next: Workflow) => {
        setW(old => !old || next.version >= old.version ? next : old);
        void refresh()
    };

    async function invoke(action: () => Promise<Workflow>) {
        setBusy(true);
        setError('');
        try {
            const next = await action();
            update(next);
            return next
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function create(text: string, images: Picture[]) {
        const next = await invoke(() => api<Workflow>('/workflows', 'POST', {text, images}));
        if (next) {
            setId(next.id);
            if (meta.configured) await invoke(() => api<Workflow>(`/workflows/${next.id}/generate`, 'POST', {expectedVersion: next.version}))
        }
    }

    const generating = !!w && ['analyzing', 'orchestrating'].includes(w.job?.status || '');

    async function generate() {
        if (!w) return;
        const draft = localStorage.getItem('weave-draft-' + w.id);
        if (draft && !confirm('本地人工草稿将保留。重生成参考已保存方案；如需纳入修改，请先保存。继续？')) return;
        await invoke(() => api<Workflow>(`/workflows/${w.id}/generate`, 'POST', {
            expectedVersion: w.version,
            feedback
        }));
        setFeedback('')
    }

    return <div className="app">
        <aside className="sidebar"><a className="brand" href="#" onClick={e => {
            e.preventDefault();
            setId('')
        }}><b>〃</b><span>织序 / WEAVE<small>本地 AI 工作流规划</small></span></a>
            <div className="section-title"><h3>我的方案</h3>
                <button className="small" onClick={() => {
                    setId('');
                    setError('')
                }}>＋ 新建
                </button>
            </div>
            <input aria-label="搜索方案" className="search" placeholder="搜索方案…" value={search}
                   onChange={e => setSearch(e.target.value)}/>
            <div className="project-list">{list.filter(x => x.title.includes(search)).map(x => <button key={x.id}
                                                                                                       className={id === x.id ? 'selected' : ''}
                                                                                                       onClick={() => {
                                                                                                           setId(x.id);
                                                                                                           setError('')
                                                                                                       }}>
                <strong>{x.title}</strong><span>{x.confirmed ? '已确认' : '待审查'} · {new Date(x.updatedAt).toLocaleDateString()}</span>
            </button>)}{!list.length && <p className="hint">你的编排方案将保存在这里。</p>}</div>
            {w && <div className="generation"><h3>方案生成进度</h3>
                <div className="step"><i>{w.job?.pm ? '✓' : '1'}</i>
                    <div><strong>PM 分析</strong><small>需求、验收与任务依赖</small></div>
                </div>
                <div className="step"><i>{w.job?.status === 'complete' ? '✓' : '2'}</i>
                    <div><strong>AI 编排</strong><small>动态角色与任务分工</small></div>
                </div>
                <p className={generating ? 'pulse' : ''}>{states[w.job?.status || ''] || '等待开始规划'}</p>{w.job?.elapsedMs &&
                    <small>耗时 {(w.job.elapsedMs / 1000).toFixed(1)} 秒</small>}<small>用量：{w.job?.usage ? JSON.stringify(w.job.usage) : '未知'}</small>
            </div>}
            <div className="sidebar-bottom">
                <button onClick={() => setSettings(true)}>⚙ 设置与默认提示词</button>
                <span
                    className={meta.configured ? 'success' : 'muted'}>{meta.configured ? '● DeepSeek 已配置' : '○ 等待配置 DeepSeek 密钥'}</span>
            </div>
        </aside>
        <main>{error && <div role="alert" className="global-error"><span>{error}</span>
            <button onClick={() => setError('')}>×</button>
        </div>}
            {!id ? <div className="welcome">
                <div className="welcome-heading">
                    <div className="line-symbol">〃</div>
                    <h1>把想法，编排成方案。</h1><p>从一份需求出发，让 AI 拆解任务、组织角色，<br/>再由你审查和决定。</p>
                </div>
                {!meta.configured && <div className="warning">尚未配置密钥：在项目 .env 中设置 DEEPSEEK_API_KEY
                    后重启服务。需求仍可先保存。</div>}<InputPanel onSubmit={create} busy={busy}
                                                                 label={meta.configured ? '开始 AI 规划' : '保存需求'}/>
                <div className="welcome-foot"><span>01 分析需求</span><span>02 编排角色</span><span>03 人工确认</span>
                </div>
            </div> : !w ? <div className="empty">正在打开方案…</div> : <>
                <div className="requirement-bar">
                    <span>需求 v{w.requirement.version} · {w.requirement.images.length} 张图片</span>
                    <button onClick={() => setRequirementOpen(true)}>查看 / 修改需求</button>
                    <input aria-label="重生成反馈" placeholder="重生成意见，例如：合并相近角色" value={feedback}
                           onChange={e => setFeedback(e.target.value)} disabled={generating}/>
                    <button disabled={busy || generating || !!w.candidate || !meta.configured}
                            onClick={generate}>{current(w) ? 'AI 重生成' : '开始规划'}</button>
                    {generating && <button className="danger"
                                           onClick={() => invoke(() => api(`/workflows/${w.id}/cancel`, 'POST', {}))}>取消生成</button>}
                </div>
                {w.job && <section className={'job-panel ' + (generating ? 'working' : '')} aria-live="polite">
                    <div className="section-title">
                        <strong>{states[w.job.status]}</strong>{['failed', 'interrupted', 'cancelled', 'save_failed'].includes(w.job.status) &&
                        <button disabled={busy || w.job.requirement.version !== w.requirement.version}
                                onClick={() => invoke(() => api(`/workflows/${w.id}/retry`, 'POST', {expectedVersion: w.version}))}>{w.job.result ? '重试保存（不调用模型）' : w.job.pm ? '重试编排（复用 PM）' : '重试 PM 分析'}</button>}
                    </div>
                    {w.job.error &&
                        <p className="error">{w.job.error}</p>}{w.job.requirement.version !== w.requirement.version &&
                    <p className="warning">本次请求对应旧需求，结果不会覆盖最新方案；请针对最新需求重生成。</p>}{w.job.issues.map((x, i) =>
                    <p key={i} className="warning">{x}</p>)}{['waiting', 'issues'].includes(w.job.status) &&
                    <Questions key={w.job.id} questions={w.job.questions} busy={busy}
                               disabled={w.job.requirement.version !== w.requirement.version}
                               onSubmit={answer => {
                                   void invoke(() => api(`/workflows/${w.id}/retry`, 'POST', {
                                       expectedVersion: w.version,
                                       answer
                                   }))
                               }}/>}{generating && <details>
                    <summary>查看流式结果预览（尚未校验）</summary>
                    <pre>{w.job.preview || '正在等待模型输出；不展示内部思考内容。'}</pre>
                </details>}</section>}
                {current(w) ? <Editor key={w.id} w={w} onUpdate={update} onError={setError}/> : <div className="empty">
                    <div className="empty-graph">◇ → ◇ → ◇</div>
                    <h2>{generating ? '正在组织你的工作流' : '从需求到清晰的分工'}</h2><p>PM 完成分析后，编排器将自动创建任务与
                    Agent 定义。</p><p className="hint">下游 Agent 仅作为方案定义，不会执行。</p>{w.candidate && <>
                    <p>候选对应需求 v{w.candidate.requirementVersion}，请先处理候选。</p>
                    <button onClick={() => invoke(() => api(`/workflows/${w.id}/candidate`, 'POST', {
                        expectedVersion: w.version,
                        accept: false
                    }))}>放弃旧候选
                    </button>
                </>}</div>}
            </>}
        </main>
        {settings && <SettingsPanel onClose={() => setSettings(false)}/>}{requirementOpen && w &&
        <div className="modal-back">
            <section className="modal">
                <header>
                    <div><h2>需求与参考资料</h2><p>修改后建立新需求版本，旧方案保留，需明确重生成。</p></div>
                    <button onClick={() => setRequirementOpen(false)}>×</button>
                </header>
                <InputPanel initial={w.requirement} busy={busy} label="提交需求新修订"
                            onSubmit={async (text, images) => {
                                const next = await invoke(() => api(`/workflows/${w.id}/requirements`, 'POST', {
                                    text,
                                    images,
                                    expectedVersion: w.version
                                }));
                                if (next) setRequirementOpen(false)
                            }}/></section>
        </div>}</div>
}
