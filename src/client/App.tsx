import {useEffect, useState} from 'react';
import {api} from './api';
import InputPanel from './components/InputPanel';
import SettingsPanel from './components/SettingsPanel';
import Presence from './components/Presence';
import Editor from './components/Editor';
import PlanPanel from './components/PlanPanel';
import Regenerate from './components/Regenerate';
import Icon from './components/Icon';
import FloatingNotice from './components/FloatingNotice';
import Dialog, {useConfirm} from './components/Dialog';
import {current, type Workflow, type Picture, type PlanLists} from '../shared/domain';

export default function App() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const ask = useConfirm();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {try {return localStorage.getItem('weave-sidebar-collapsed') === 'true'} catch {return false}});
    useEffect(() => {try {localStorage.setItem('weave-sidebar-collapsed', String(sidebarCollapsed))} catch {/* optional preference */}}, [sidebarCollapsed]);
    const [lists, setLists] = useState<PlanLists>({plans: [], trash: []}), [w, setW] = useState<Workflow>(), [id, setId] = useState(''), [settings, setSettings] = useState(false), [meta, setMeta] = useState({
        configured: false,
        model: 'deepseek-flash'
    }), [error, setError] = useState(''), [busy, setBusy] = useState(false), [requirementOpen, setRequirementOpen] = useState(false);
    const refresh = () => api<PlanLists>('/workflows').then(setLists).catch(e => setError(e.message));
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
        let live = true;
        stream.onopen = () => {
            if (live) setError(previous => previous === '连接暂时中断，正在重连…' ? '' : previous)
        };
        stream.onmessage = e => {
            if (!live) return;
            const next: Workflow = JSON.parse(e.data);
            setW(old => !old || next.version >= old.version ? next : old);
            if (next.job && !['analyzing', 'orchestrating'].includes(next.job.status)) void refresh()
        };
        stream.onerror = () => {
            if (!live) return;
            setError('连接暂时中断，正在重连…');
            void api<PlanLists>('/workflows').then(next => {
                if (!live) return;
                setLists(next);
                if (!next.plans.some(p => p.id === id)) {
                    setId('');
                    setError('该方案已被删除或移入回收站')
                }
            }).catch(() => {})
        };
        return () => {
            live = false;
            stream.close()
        }
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

    function forget(deleted: string) {
        if (deleted !== id) return;
        setId('');
        setW(undefined);
        setRequirementOpen(false)
    }

    const generating = !!w && ['analyzing', 'orchestrating', 'waiting', 'issues'].includes(w.job?.status || '');

    async function generate(feedback = '') {
        if (!w) return;
        let draft: string | null = null;
        try {
            draft = localStorage.getItem('weave-draft-' + w.id)
        } catch {/* storage unavailable: nothing to protect */}
        if (draft && !await ask('本地人工草稿将保留。重生成参考已保存方案；如需纳入修改，请先保存。继续？', {title: '重新生成方案？'})) return;
        if (generating) return;
        return invoke(() => api<Workflow>(`/workflows/${w.id}/generate`, 'POST', {
            expectedVersion: w.version,
            feedback
        }))
    }

    return <div className={`app${sidebarOpen ? ' sidebar-open' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <Presence>{sidebarOpen && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setSidebarOpen(false)}/>}</Presence>
        <aside className="sidebar" id="app-sidebar" aria-label="方案导航"><button className="sidebar-collapse" aria-label="收起侧边栏" onClick={() => {setSidebarCollapsed(true); setSidebarOpen(false)}}><Icon name="panel"/></button><a className="brand" href="#" onClick={e => {
            e.preventDefault();
            setId('')
        }}><b>〃</b><span>织序 <em>weave</em></span></a>
            <PlanPanel lists={lists} currentId={id} onLists={setLists} onDeleted={forget}
                       onSelect={next => {setId(next); setError(''); setSidebarOpen(false)}}
                       onCreate={() => {setId(''); setError(''); setSidebarOpen(false)}}/>
            {id && w && <button className="sidebar-requirement" onClick={() => {
                setRequirementOpen(true);
                setSidebarOpen(false)
            }} aria-label={`查看或修改需求 v${w.requirement.version}，${w.requirement.images.length} 张图片`}>
                <Icon name="edit" size={17}/>
                <span><strong>需求与参考资料</strong><small>需求 v{w.requirement.version} · {w.requirement.images.length} 张图片</small></span>
                <span className="requirement-entry-arrow" aria-hidden="true">↗</span>
            </button>}
            <div className="sidebar-bottom">
                <button onClick={() => setSettings(true)}><Icon name="settings" size={18}/> 设置</button>
                <span className={meta.configured ? 'success' : 'muted'}>{meta.configured ? '● 已配置' : '○ 未配置'}</span>
            </div>
        </aside>
        <main>
            <header className="app-topbar">
                <div className="navigation-capsule" aria-label="快捷导航">
                    <button aria-label="展开侧边栏" aria-expanded={!sidebarCollapsed} aria-controls="app-sidebar" onClick={() => setSidebarCollapsed(false)}><Icon name="panel"/></button>
                    <button aria-label="新建方案" onClick={() => {setId(''); setError('')}}><Icon name="plus"/></button>
                </div>
                <button className="mobile-menu" aria-label="切换方案导航" aria-expanded={sidebarOpen} aria-controls="app-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="menu"/></button>
                <span className="topbar-title">{id ? '方案工作台' : '新建方案'}</span>
                {id && w && !current(w) && <button className="topbar-plan-action" disabled={busy || generating || !!w.candidate || !meta.configured}
                                                                 onClick={() => void generate()}>开始规划</button>}
            </header>
            <Presence>{error && <FloatingNotice tone="error" onClose={() => setError('')}>{error}</FloatingNotice>}</Presence>
            {!id ? <div className="welcome">
                <div className="welcome-heading">
                    <h1>嗨，今天想规划些什么？</h1><p>说说你的想法，织序帮你拆解任务、编排角色。</p>
                </div>
                {!meta.configured && <div className="warning">尚未配置密钥：在项目 .env 中设置 DEEPSEEK_API_KEY 后重启服务。</div>}
                <InputPanel onSubmit={create} busy={busy} label={meta.configured ? '开始 AI 规划' : '保存需求'}/>
            </div> : !w ? <div className="empty">正在打开方案…</div> : <>
                <Editor key={w.id} w={w} onUpdate={update} onError={setError}
                        regenerate={<Regenerate w={w} busy={busy} configured={meta.configured} onGenerate={generate}/>}/>
            </>}
        </main>
        <Presence>{settings && <SettingsPanel onClose={() => setSettings(false)}/>}</Presence>
        <Presence>{requirementOpen && w && <Dialog title="需求与参考资料" description="修改后建立新需求版本，旧方案保留，需明确重生成。" onClose={() => {if (!busy) setRequirementOpen(false)}}>
                <InputPanel initial={w.requirement} busy={busy} label="提交需求新修订"
                            onSubmit={async (text, images) => {
                                const next = await invoke(() => api(`/workflows/${w.id}/requirements`, 'POST', {text, images, expectedVersion: w.version}));
                                if (next) setRequirementOpen(false)
                            }}/>
        </Dialog>}</Presence>
    </div>
}
