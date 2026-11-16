import {useEffect, useRef, useState, type MouseEvent} from 'react';
import {api} from '../api';
import FloatingNotice from './FloatingNotice';
import {cleanTitle, MAX_PLAN_TITLE, TRASH_CONFIRM, type PlanLists, type PlanSummary} from '../../shared/domain';

type Dialog = {kind: 'trash' | 'purge' | 'rename'; id: string} | {kind: 'empty'};
type Menu = {id: string; top: number; left: number};
type Toast = {message: string; label?: string; run?: () => void};

const draftKey = (id: string) => 'weave-draft-' + id;

function hasDraft(id: string) {
    try {
        return !!localStorage.getItem(draftKey(id))
    } catch {
        return false
    }
}

const day = (value: string) => new Date(value).toLocaleDateString();
const meta = (p: PlanSummary) => [p.confirmed ? '已确认' : '待审查', p.revisions ? `r${p.revisions}` : '未生成', day(p.updatedAt)].join(' · ');

export default function PlanPanel({lists, currentId, onSelect, onCreate, onLists, onDeleted}: {
    lists: PlanLists;
    currentId: string;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onLists: (lists: PlanLists) => void;
    onDeleted: (id: string) => void
}) {
    const [tab, setTab] = useState<'plans' | 'trash'>('plans');
    const [search, setSearch] = useState('');
    const [menu, setMenu] = useState<Menu>();
    const [dialog, setDialog] = useState<Dialog>();
    const [title, setTitle] = useState('');
    const [confirm, setConfirm] = useState('');
    const [note, setNote] = useState('');
    const [working, setWorking] = useState(false);
    const [toast, setToast] = useState<Toast>();
    const busy = useRef(false);

    const target = dialog && 'id' in dialog ? [...lists.plans, ...lists.trash].find(p => p.id === dialog.id) : undefined;
    const menuPlan = menu ? lists.plans.find(p => p.id === menu.id) : undefined;
    const keyword = search.trim().toLowerCase();
    const match = (p: PlanSummary) => !keyword || (p.title + ' ' + p.summary).toLowerCase().includes(keyword);
    const plans = lists.plans.filter(match), trash = lists.trash.filter(match);

    useEffect(() => {
        if (dialog && 'id' in dialog && !target) setDialog(undefined)
    }, [dialog, target]);

    useEffect(() => {
        if (!menu) return;
        const pointer = (e: PointerEvent) => {
            const el = e.target as HTMLElement | null;
            if (el?.closest('.plan-menu') || el?.closest('[data-plan-menu]')) return;
            setMenu(undefined)
        };
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenu(undefined)
        };
        const close = () => setMenu(undefined);
        document.addEventListener('pointerdown', pointer);
        document.addEventListener('keydown', key);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            document.removeEventListener('pointerdown', pointer);
            document.removeEventListener('keydown', key);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close)
        }
    }, [menu]);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(undefined), toast.label ? 10000 : 5000);
        return () => clearTimeout(timer)
    }, [toast]);

    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy.current) setDialog(undefined)
        };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key)
    }, []);

    async function manage<T>(fn: () => Promise<T>, done: (value: T) => void, inline = false) {
        if (busy.current) return;
        busy.current = true;
        setWorking(true);
        setNote('');
        try {
            done(await fn())
        } catch (e) {
            const message = (e as Error).message;
            if (inline) setNote(message); else setToast({message});
            void api<PlanLists>('/workflows').then(onLists).catch(() => {})
        } finally {
            busy.current = false;
            setWorking(false)
        }
    }

    function closeDialog() {
        if (!busy.current) setDialog(undefined)
    }

    function openTrash(plan: PlanSummary) {
        setMenu(undefined);
        setToast(undefined);
        setNote('');
        setDialog({kind: 'trash', id: plan.id})
    }

    function openRename(plan: PlanSummary) {
        setMenu(undefined);
        setToast(undefined);
        setNote('');
        setTitle(plan.title);
        setDialog({kind: 'rename', id: plan.id})
    }

    function openPurge(plan: PlanSummary) {
        setMenu(undefined);
        setToast(undefined);
        setNote('');
        setConfirm('');
        setDialog({kind: 'purge', id: plan.id})
    }

    function openMenu(plan: PlanSummary, e: MouseEvent<HTMLButtonElement>) {
        if (menu?.id === plan.id) {
            setMenu(undefined);
            return
        }
        const r = e.currentTarget.getBoundingClientRect(), width = 150;
        setMenu({
            id: plan.id,
            top: Math.max(8, Math.min(r.bottom + 4, innerHeight - 154)),
            left: Math.max(8, Math.min(r.right - width, innerWidth - width - 8))
        })
    }

    function trashPlan(plan: PlanSummary) {
        void manage(() => api<PlanLists>(`/workflows/${plan.id}/trash`, 'POST'), next => {
            try {
                localStorage.removeItem(draftKey(plan.id))
            } catch {/* private mode: nothing to clear */}
            onLists(next);
            setDialog(undefined);
            if (plan.id === currentId) onDeleted(plan.id);
            const moved = next.trash.find(p => p.id === plan.id);
            setToast({
                message: `「${plan.title}」已移入回收站`,
                label: moved ? '撤销' : undefined,
                run: moved ? () => restorePlan(moved, true) : undefined
            })
        }, true)
    }

    function restorePlan(plan: PlanSummary, fromToast = false) {
        if (busy.current) return;
        if (fromToast) setToast(undefined);
        void manage(() => api<PlanLists>(`/workflows/${plan.id}/restore`, 'POST', {expectedVersion: plan.version}), next => {
            onLists(next);
            setToast({message: `「${plan.title}」已恢复`})
        })
    }

    function renamePlan(plan: PlanSummary) {
        const value = cleanTitle(title);
        if (!value) {
            setNote(`方案名称需为 1–${MAX_PLAN_TITLE} 个字符`);
            return
        }
        if (value === plan.title) {
            setDialog(undefined);
            return
        }
        void manage(() => api<PlanLists>(`/workflows/${plan.id}`, 'PATCH', {title: value}), next => {
            onLists(next);
            setDialog(undefined);
            setToast({message: '方案已重命名'})
        }, true)
    }

    function duplicatePlan(plan: PlanSummary) {
        setMenu(undefined);
        void manage(() => api<PlanLists & { id: string }>(`/workflows/${plan.id}/duplicate`, 'POST', {expectedVersion: plan.version}), next => {
            onLists(next);
            onSelect(next.id);
            setToast({message: '已创建方案副本'})
        })
    }

    function purgePlan(plan: PlanSummary) {
        if (confirm.trim() !== plan.title.trim()) return;
        void manage(() => api<PlanLists>(`/workflows/${plan.id}`, 'DELETE', {title: confirm.trim()}), next => {
            onLists(next);
            setDialog(undefined);
            if (plan.id === currentId) onDeleted(plan.id);
            setToast({message: `「${plan.title}」已彻底删除`})
        }, true)
    }

    function emptyTrash() {
        if (confirm.trim() !== TRASH_CONFIRM) return;
        const count = lists.trash.length;
        void manage(() => api<PlanLists>('/workflows/trash', 'DELETE', {
            confirm: TRASH_CONFIRM,
            expectedCount: count
        }), next => {
            onLists(next);
            setDialog(undefined);
            setToast({message: `回收站已清空（${count} 个方案）`})
        }, true)
    }

    const backdrop = (e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) closeDialog()
    };

    return <div className="plan-panel">
        <div className="section-title"><h3>我的方案</h3>
            <button className="small" onClick={() => {
                setTab('plans');
                setMenu(undefined);
                onCreate()
            }}>＋ 新建
            </button>
        </div>
        <div className="plan-tabs" role="tablist" aria-label="方案视图">
            <button role="tab" aria-selected={tab === 'plans'} className={tab === 'plans' ? 'active' : ''}
                    onClick={() => {
                        setTab('plans');
                        setMenu(undefined)
                    }}>方案<span>{lists.plans.length}</span></button>
            <button role="tab" aria-selected={tab === 'trash'} className={tab === 'trash' ? 'active' : ''}
                    onClick={() => {
                        setTab('trash');
                        setMenu(undefined)
                    }}>回收站<span>{lists.trash.length}</span></button>
        </div>
        <input aria-label={tab === 'plans' ? '搜索方案' : '搜索回收站'} className="search"
               placeholder={tab === 'plans' ? '搜索方案…' : '搜索回收站…'} value={search}
               onChange={e => setSearch(e.target.value)}/>
        <div className="project-list">
            {tab === 'plans' ? (plans.length ? plans.map(p => <div
                key={p.id} className={'plan-item' + (p.id === currentId ? ' selected' : '')}>
                <button className="plan-open" aria-current={p.id === currentId ? 'true' : undefined}
                        onClick={() => {
                            setMenu(undefined);
                            onSelect(p.id)
                        }}>
                    <strong title={p.title}>{p.title || '未命名方案'}</strong>
                    <span>{meta(p)}</span>{p.generating && <em>生成中</em>}
                </button>
                <button className="plan-more" data-plan-menu aria-haspopup="menu" aria-expanded={menu?.id === p.id}
                        aria-label={`管理「${p.title}」`} title="管理方案"
                        onClick={e => openMenu(p, e)}>⋯</button>
            </div>) : <p className="hint">{keyword ? '没有匹配的方案。' : '你的编排方案将保存在这里。'}</p>) : (trash.length ? trash.map(p => <div
                key={p.id} className="plan-item trash">
                <div className="plan-open"><strong title={p.title}>{p.title}</strong>
                    <span>移入于 {day(p.trashedAt || p.updatedAt)} · {p.revisions ? `r${p.revisions}` : '无修订'}</span></div>
                <div className="trash-actions">
                    <button className="small" disabled={working} onClick={() => restorePlan(p)}>恢复</button>
                    <button className="small danger" disabled={working} onClick={() => openPurge(p)}>彻底删除</button>
                </div>
            </div>) : <p className="hint">{keyword ? '没有匹配的回收站方案。' : '回收站为空。删除的方案会先移到这里，可以恢复。'}</p>)}
        </div>
        {tab === 'trash' && lists.trash.length > 0 && <button className="plan-empty-trash danger" onClick={() => {
            setMenu(undefined);
            setToast(undefined);
            setNote('');
            setConfirm('');
            setDialog({kind: 'empty'})
        }}>清空回收站（{lists.trash.length}）</button>}
        {menuPlan && menu && <div className="plan-menu" role="menu" style={{top: menu.top, left: menu.left}}>
            <button role="menuitem" onClick={() => openRename(menuPlan)}>重命名</button>
            <button role="menuitem" onClick={() => duplicatePlan(menuPlan)}>创建副本</button>
            <button role="menuitem" className="danger" onClick={() => openTrash(menuPlan)}>移入回收站…</button>
        </div>}
        {dialog?.kind === 'rename' && target && <div className="modal-back" onMouseDown={backdrop}>
            <section className="modal plan-modal" role="dialog" aria-modal="true" aria-label="重命名方案">
                <header>
                    <div><h2>重命名方案</h2><p>只修改名称，不影响需求、方案内容与确认记录。</p></div>
                    <button onClick={closeDialog} aria-label="关闭" disabled={working}>×</button>
                </header>
                <label className="field">方案名称<input autoFocus value={title} maxLength={MAX_PLAN_TITLE}
                                                       onChange={e => setTitle(e.target.value)}
                                                       onKeyDown={e => {
                                                           if (e.key === 'Enter') renamePlan(target)
                                                       }}/></label>
                <p className="hint">{[...title.trim()].length}/{MAX_PLAN_TITLE}</p>
                {note && <p className="error" role="alert">{note}</p>}
                <footer>
                    <button onClick={closeDialog} disabled={working}>取消</button>
                    <button className="primary" disabled={working || !cleanTitle(title) || cleanTitle(title) === target.title}
                            onClick={() => renamePlan(target)}>{working ? '保存中…' : '保存名称'}</button>
                </footer>
            </section>
        </div>}
        {dialog?.kind === 'trash' && target && <div className="modal-back" onMouseDown={backdrop}>
            <section className="modal plan-modal" role="dialog" aria-modal="true" aria-label="删除方案">
                <header>
                    <div><h2>删除方案</h2><p>「{target.title}」将被移入回收站，可撤销或稍后恢复。</p></div>
                    <button onClick={closeDialog} aria-label="关闭" disabled={working}>×</button>
                </header>
                <dl className="plan-facts">
                    <div><dt>状态</dt><dd>{target.confirmed ? '已确认' : '待审查'} · {target.revisions ? `r${target.revisions}` : '暂无修订'} · 需求 v{target.requirementVersion}</dd></div>
                    <div><dt>内容</dt><dd>{target.tasks} 个任务 · {target.agents} 个 Agent · {target.images} 张图片{target.candidate ? ' · 1 份候选稿' : ''}</dd></div>
                    <div><dt>历史</dt><dd>{target.revisions} 个保存修订 · {target.requirements} 个需求版本 · 生成记录（如有）与画布布局</dd></div>
                    {target.generating && <div><dt>生成中</dt><dd className="warning">本次生成将立即取消，迟到的模型结果不会再写入。</dd></div>}
                    {hasDraft(target.id) && <div><dt>本地草稿</dt><dd className="warning">该方案有未保存的编辑草稿；移入回收站会清除草稿，撤销无法恢复。</dd></div>}
                </dl>
                {note && <p className="error" role="alert">{note}</p>}
                <footer>
                    <button onClick={closeDialog} disabled={working}>取消</button>
                    <button className="danger-solid" disabled={working}
                            onClick={() => trashPlan(target)}>{working ? '处理中…' : '移入回收站'}</button>
                </footer>
            </section>
        </div>}
        {dialog?.kind === 'purge' && target && <div className="modal-back" onMouseDown={backdrop}>
            <section className="modal plan-modal" role="dialog" aria-modal="true" aria-label="彻底删除方案">
                <header>
                    <div><h2>彻底删除方案</h2><p>此操作不可撤销：方案、全部修订、确认记录、需求图片与画布布局将从本地数据库移除。</p></div>
                    <button onClick={closeDialog} aria-label="关闭" disabled={working}>×</button>
                </header>
                <p>请输入方案标题以确认删除：</p>
                <p className="confirm-title">「{target.title}」</p>
                <input autoFocus aria-label="输入方案标题以确认删除" className="confirm-input" value={confirm}
                       placeholder="输入完整标题" onChange={e => setConfirm(e.target.value)}
                       onKeyDown={e => {
                           if (e.key === 'Enter') purgePlan(target)
                       }}/>
                {note && <p className="error" role="alert">{note}</p>}
                <footer>
                    <button onClick={closeDialog} disabled={working}>取消</button>
                    <button className="danger-solid" disabled={working || confirm.trim() !== target.title.trim()}
                            onClick={() => purgePlan(target)}>{working ? '删除中…' : '彻底删除'}</button>
                </footer>
            </section>
        </div>}
        {dialog?.kind === 'empty' && lists.trash.length > 0 && <div className="modal-back" onMouseDown={backdrop}>
            <section className="modal plan-modal" role="dialog" aria-modal="true" aria-label="清空回收站">
                <header>
                    <div><h2>清空回收站</h2><p>回收站中的 {lists.trash.length} 个方案及其修订、确认记录和图片将被永久删除，无法恢复。</p></div>
                    <button onClick={closeDialog} aria-label="关闭" disabled={working}>×</button>
                </header>
                <p>请输入「{TRASH_CONFIRM}」以确认：</p>
                <input autoFocus aria-label="输入清空回收站以确认" className="confirm-input" value={confirm}
                       placeholder={TRASH_CONFIRM} onChange={e => setConfirm(e.target.value)}
                       onKeyDown={e => {
                           if (e.key === 'Enter') emptyTrash()
                       }}/>
                {note && <p className="error" role="alert">{note}</p>}
                <footer>
                    <button onClick={closeDialog} disabled={working}>取消</button>
                    <button className="danger-solid" disabled={working || confirm.trim() !== TRASH_CONFIRM}
                            onClick={emptyTrash}>{working ? '清空中…' : `清空 ${lists.trash.length} 个方案`}</button>
                </footer>
            </section>
        </div>}
        {toast && <FloatingNotice onClose={() => setToast(undefined)}>
            <span>{toast.message}</span>
            {toast.label && <button onClick={() => toast.run?.()}>{toast.label}</button>}
        </FloatingNotice>}
    </div>
}
