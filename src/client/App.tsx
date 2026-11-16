import {useEffect, useState} from 'react';
import {api} from './api';
import InputPanel from './components/InputPanel';
import SettingsPanel from './components/SettingsPanel';
import Editor from './components/Editor';
import {current, type Workflow, type Picture} from '../shared/domain';

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
            setError('连接暂时中断，正在重连…')
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

    const generating = !!w && ['analyzing', 'orchestrating', 'waiting', 'issues'].includes(w.job?.status || '');

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
            <div className="sidebar-bottom">
                <button onClick={() => setSettings(true)}>⚙ 设置</button>
                <span
                    className={meta.configured ? 'success' : 'muted'}>{meta.configured ? '● 已配置' : '○ 未配置'}</span>
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
                    后重启服务。</div>}<InputPanel onSubmit={create} busy={busy}
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
                </div>
                <Editor key={w.id} w={w} onUpdate={update} onError={setError}/>

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
