import {useEffect, useState} from 'react';
import {current, validatePlan, type Workflow, type Plan, type Agent} from '../../shared/domain';
import Graph, {positions} from './Graph';
import Inspector from './Inspector';
import {api} from '../api';

export default function Editor({w, onUpdate, onError}: {
    w: Workflow;
    onUpdate: (w: Workflow) => void;
    onError: (e: string) => void
}) {
    const revision = current(w)!;
    const key = 'weave-draft-' + w.id;
    const [draft, setDraft] = useState<Plan>(() => {
        try {
            const d = JSON.parse(localStorage.getItem(key) || 'null');
            return d?.plan || structuredClone(revision.plan)
        } catch {
            return structuredClone(revision.plan)
        }
    });
    const [base, setBase] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(key) || 'null')?.base || revision.id
        } catch {
            return revision.id
        }
    });
    const [past, setPast] = useState<Plan[]>([]), [future, setFuture] = useState<Plan[]>([]), [tab, setTab] = useState('graph'), [selected, setSelected] = useState(draft.pm.tasks[0]?.id || ''), [stored, setStored] = useState(''), [layout, setLayout] = useState(w.layout), [busy, setBusy] = useState(false);
    const dirty = JSON.stringify(draft) !== JSON.stringify(revision.plan), conflict = base !== revision.id;
    const req = w.requirements.find(x => x.version === draft.requirementVersion) || w.requirement,
        findings = validatePlan(draft, req);
    const active = ['analyzing', 'orchestrating'].includes(w.job?.status || '');
    useEffect(() => {
        try {
            if (dirty || conflict) {
                localStorage.setItem(key, JSON.stringify({base, plan: draft}));
                setStored('草稿已保留')
            } else {
                localStorage.removeItem(key);
                setStored('已保存')
            }
        } catch {
            setStored('草稿保留失败，请勿关闭页面')
        }
    }, [draft, base, key, dirty, conflict]);
    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (dirty) {
                e.preventDefault();
                e.returnValue = ''
            }
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty]);

    function change(p: Plan) {
        setPast(v => [...v.slice(-49), draft]);
        setFuture([]);
        setDraft(p)
    }

    function taskChange(t: Plan['pm']['tasks'][number]) {
        change({...draft, pm: {...draft.pm, tasks: draft.pm.tasks.map(x => x.id === t.id ? t : x)}})
    }

    function reset(plan = revision.plan, id = revision.id) {
        setDraft(structuredClone(plan));
        setBase(id);
        setPast([]);
        setFuture([]);
        localStorage.removeItem(key)
    }

    async function action(path: string, body: unknown, clear = false) {
        setBusy(true);
        try {
            const next = await api<Workflow>(`/workflows/${w.id}/${path}`, 'POST', body);
            if (clear) {
                const r = current(next)!;
                reset(r.plan, r.id)
            }
            onUpdate(next)
        } catch (e) {
            onError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    function adopt() {
        if (dirty && !confirm('采用候选将替换当前编辑草稿，旧的已保存方案仍保留。继续？')) return;
        void action('candidate', {expectedVersion: w.version, accept: true}, true)
    }

    const agentChange = (a: Agent) => change({...draft, agents: draft.agents.map(x => x.id === a.id ? a : x)});
    return <div className="editor">
        <div className="editor-head">
            <div><h1>{w.title}</h1><span
                className="tag">{revision.confirmedAt && !dirty ? '已确认' : '未确认'} · r{revision.number}</span><small
                className={stored.includes('失败') ? 'error' : ''}>{stored}{dirty ? ' · 有未保存业务修改' : ''}</small>
            </div>
            <div className="actions">
                <button disabled={busy || active || conflict || !dirty || findings.some(f => f.level === 'error')}
                        onClick={() => action('save', {
                            expectedVersion: w.version,
                            baseId: base,
                            plan: draft
                        }, true)}>保存方案
                </button>
                <button className="primary"
                        disabled={busy || active || dirty || conflict || !!w.candidate || !!findings.length || draft.requirementVersion !== w.requirement.version || ['waiting', 'issues'].includes(w.job?.status || '')}
                        onClick={() => {
                            if (confirm('我已审查当前已保存方案。确认不代表下游任务已执行。')) void action('confirm', {
                                expectedVersion: w.version,
                                revisionId: revision.id,
                                requirementVersion: w.requirement.version
                            })
                        }}>确认方案
                </button>
            </div>
        </div>
        {conflict && <div className="warning">草稿基础版本与当前方案冲突，双方内容均保留。
            <button onClick={() => {
                if (confirm('丢弃本地草稿并加载当前已保存方案？')) reset()
            }}>使用已保存方案
            </button>
            <button onClick={() => {
                const blob = new Blob([JSON.stringify(draft, null, 2)], {type: 'application/json'}),
                    url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = '保留的草稿.json';
                a.click();
                URL.revokeObjectURL(url)
            }}>导出草稿备份
            </button>
        </div>}
        {draft.requirementVersion !== w.requirement.version &&
            <div className="warning">本方案对应旧需求 v{draft.requirementVersion}，最新为
                v{w.requirement.version}。请根据最新需求重生成后再确认。</div>}
        {w.candidate && <section className="candidate">
            <div><strong>新的候选方案等待审查</strong><p>当前需求 v{revision.plan.requirementVersion} → 候选
                v{w.candidate.requirementVersion} · 任务 {draft.pm.tasks.length} → {w.candidate.pm.tasks.length} ·
                Agent {draft.agents.length} → {w.candidate.agents.length}</p></div>
            <button onClick={() => setTab('compare')}>比较差异</button>
            <button disabled={busy}
                    onClick={() => action('candidate', {expectedVersion: w.version, accept: false})}>放弃候选
            </button>
            <button className="primary" disabled={busy || w.candidate.requirementVersion !== w.requirement.version}
                    onClick={adopt}>采用候选
            </button>
        </section>}
        <nav
            className="tabs">{[['graph', '编排画布'], ['agents', 'Agent 定义'], ['coverage', '需求覆盖'], ['compare', '版本与候选']].map(([id, name]) =>
            <button key={id} className={tab === id ? 'active' : ''}
                    onClick={() => setTab(id)}>{name}{id === 'coverage' && findings.length > 0 ? ' · ' + findings.length : ''}</button>)}</nav>
        {tab === 'graph' && <>
            <div className="toolbar">
                <button onClick={() => {
                    const id = 'T-' + crypto.randomUUID().slice(0, 6);
                    change({
                        ...draft,
                        pm: {
                            ...draft.pm,
                            tasks: [...draft.pm.tasks, {
                                id,
                                title: '新任务',
                                goal: '',
                                inputs: [{kind: 'requirement', ref: 'spec'}],
                                outputs: ['result'],
                                done: [],
                                criteria: [],
                                dependsOn: [],
                                agentId: ''
                            }]
                        }
                    });
                    setSelected(id)
                }}>＋ 新增任务
                </button>
                <button disabled={!past.length} onClick={() => {
                    setFuture(f => [draft, ...f]);
                    setDraft(past[past.length - 1]);
                    setPast(p => p.slice(0, -1))
                }}>↶ 撤销
                </button>
                <button disabled={!future.length} onClick={() => {
                    setPast(p => [...p, draft]);
                    setDraft(future[0]);
                    setFuture(f => f.slice(1))
                }}>↷ 重做
                </button>
                <button onClick={() => {
                    const l = positions(draft);
                    setLayout(l);
                    api<Workflow>(`/workflows/${w.id}/layout`, 'PUT', {layout: l}).then(onUpdate).catch(e => onError(e.message))
                }}>整理布局
                </button>
                <span>拖动端口建立依赖 · 双击连线删除</span></div>
            <div className="workspace"><Graph plan={draft} layout={layout} selected={selected} onSelect={setSelected}
                                              onLayout={l => {
                                                  setLayout(l);
                                                  api<Workflow>(`/workflows/${w.id}/layout`, 'PUT', {layout: l}).then(onUpdate).catch(e => onError(e.message))
                                              }} onConnect={c => {
                if (!c.source || !c.target) return;
                const target = draft.pm.tasks.find(t => t.id === c.target)!;
                const p = {
                    ...draft,
                    pm: {
                        ...draft.pm,
                        tasks: draft.pm.tasks.map(t => t.id === c.target ? {
                            ...t,
                            dependsOn: [...new Set([...t.dependsOn, c.source!])]
                        } : t)
                    }
                };
                if (c.source === c.target || validatePlan(p, req).some(f => f.path === 'edges')) {
                    onError('不能建立自环或循环依赖');
                    return
                }
                taskChange({...target, dependsOn: [...new Set([...target.dependsOn, c.source])]})
            }} onDeleteEdge={(from, to) => taskChange({
                ...draft.pm.tasks.find(t => t.id === to)!,
                dependsOn: draft.pm.tasks.find(t => t.id === to)!.dependsOn.filter(x => x !== from)
            })}/><Inspector plan={draft} req={req} task={draft.pm.tasks.find(t => t.id === selected)}
                            onChange={taskChange} onDelete={() => {
                const dependents = draft.pm.tasks.filter(t => t.dependsOn.includes(selected));
                if (confirm(`删除任务？${dependents.length}项下游的依赖将移除；输入引用保留并提示修复，不能直接保存无效图。`)) {
                    change({
                        ...draft,
                        pm: {
                            ...draft.pm,
                            tasks: draft.pm.tasks.filter(t => t.id !== selected).map(t => ({
                                ...t,
                                dependsOn: t.dependsOn.filter(x => x !== selected)
                            }))
                        }
                    });
                    setSelected('')
                }
            }}/></div>
        </>}
        {tab === 'agents' && <div className="scroll-content">
            <div className="section-title"><p>角色由编排器按需求生成。能力仅为未来声明，尚未接入或执行。</p>
                <button onClick={() => change({
                    ...draft,
                    agents: [...draft.agents, {
                        id: 'A-' + crypto.randomUUID().slice(0, 6),
                        name: '新 Agent',
                        responsibility: '',
                        prompt: '',
                        capabilities: []
                    }]
                })}>＋ 添加 Agent
                </button>
            </div>
            <div className="agent-grid">{draft.agents.map(a => <article className="agent-card" key={a.id}>
                <small>{a.id} · {draft.model} / {draft.effort}</small>{(['name', 'responsibility', 'prompt'] as const).map(k =>
                <label className="field" key={k}>{({name: '角色名称', responsibility: '职责', prompt: '系统提示词'})[k]}<textarea
                    rows={k === 'prompt' ? 5 : 2} value={a[k]}
                    onChange={e => agentChange({...a, [k]: e.target.value})}/></label>)}<label className="field">未来能力需求（每行一项）<textarea
                value={a.capabilities.join('\n')}
                onChange={e => agentChange({...a, capabilities: e.target.value.split('\n').filter(Boolean)})}/></label>
                <p>负责任务：{draft.pm.tasks.filter(t => t.agentId === a.id).map(t => t.title).join('、') || '未分配任务'}</p>
                <button className="danger" onClick={() => {
                    if (confirm('删除该 Agent 会使相关任务未分配，请重新分配后保存。')) change({
                        ...draft,
                        agents: draft.agents.filter(x => x.id !== a.id),
                        pm: {...draft.pm, tasks: draft.pm.tasks.map(t => t.agentId === a.id ? {...t, agentId: ''} : t)}
                    })
                }}>删除 Agent
                </button>
            </article>)}</div>
        </div>}
        {tab === 'coverage' && <div className="scroll-content"><h2>{draft.pm.goal}</h2><p>受众：{draft.pm.audience}</p>
            <div
                className="summary-grid">{(['deliverables', 'constraints', 'exclusions', 'assumptions'] as const).map((k, i) =>
                <section key={k}><h3>{['交付物', '约束', '不包含', '关键假设'][i]}</h3>
                    <ul>{draft.pm[k].map((s, j) => <li key={j}>{s}</li>)}</ul>
                </section>)}</div>
            <h3>全部验收条件均为必需项</h3>{draft.pm.criteria.map(c => <div className="coverage-row" key={c.id}>
                <strong>{c.id} · {c.text}</strong><span>{draft.pm.tasks.filter(t => t.criteria.includes(c.id)).map(t => t.title).join(' / ') || '⚠ 未覆盖'}</span>
            </div>)}<p className="hint">关联表示规划覆盖，不代表业务目标已实现。需求级修改请通过“修改需求”提交。</p>
            <h3>校验结果</h3>{findings.length ? findings.map((f, i) => <button className="finding" key={i}
                                                                               onClick={() => {
                                                                                   if (f.path.startsWith('task:')) {
                                                                                       setSelected(f.path.slice(5));
                                                                                       setTab('graph')
                                                                                   }
                                                                               }}>{f.path}：{f.message}</button>) :
                <p className="success">结构与覆盖检查通过，仍需人工审查分工的语义充分性。</p>}<h3>编排理由</h3>
            <p>{draft.rationale}</p></div>}
        {tab === 'compare' && <div className="scroll-content"><h2>版本与候选比较</h2>
            <p>所有历史确认仅对应原需求与原方案，采用候选不会执行任何任务。</p>
            <div className="compare-grid">
                <section><h3>当前已保存 r{revision.number}</h3>
                    <pre>{JSON.stringify(revision.plan, null, 2)}</pre>
                </section>
                <section><h3>候选方案 {w.candidate ? '' : '（暂无）'}</h3>
                    <pre>{w.candidate ? JSON.stringify(w.candidate, null, 2) : '重新生成后可在此比较需求、验收、任务、角色、分配与配置。'}</pre>
                </section>
            </div>
            <h3>保存历史</h3>{w.revisions.map(r => <details key={r.id}>
                <summary>r{r.number} · 需求
                    v{r.plan.requirementVersion} · {new Date(r.createdAt).toLocaleString()} {r.confirmedAt ? '· 已确认' : ''}</summary>
                <pre>{JSON.stringify(r.plan, null, 2)}</pre>
            </details>)}</div>}
        <div className="editor-footer"><span>ⓘ 仅规划与审查 · 下游 Agent 尚未执行</span>{findings.length > 0 &&
            <button onClick={() => setTab('coverage')}>{findings.filter(f => f.level === 'error').length} 项结构错误
                · {findings.filter(f => f.level === 'coverage').length} 项覆盖遗漏</button>}</div>
    </div>
}
