import {memo, useEffect, useRef, useState, type ReactNode} from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    NodeToolbar,
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    Panel,
    Handle,
    Position,
    MarkerType,
    applyNodeChanges,
    type Node,
    type Edge,
    type EdgeProps,
    type NodeProps,
    type Connection,
    type ReactFlowInstance
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {Job, Plan, Workflow} from '../../shared/domain';
import {stageIds, stageOf, stageStates, systemLinks} from '../../shared/planning';
import Icon from './Icon';
import Dialog from './Dialog';
import Presence, {useExiting} from './Presence';
import type {Dependency} from '../dependencies';

function NodeActions({children}: {children: ReactNode}) {
    const exiting = useExiting();
    return <div className="node-action-bar" data-exiting={exiting || undefined}>{children}</div>
}

const Card = memo(({data, selected}: NodeProps) => <div className={'task-node ' + (selected ? 'selected' : '')}>
    <Presence>{selected && <NodeToolbar isVisible position={Position.Top}><NodeActions>
        <button aria-label="编辑此节点" onClick={() => (data.onEdit as () => void)()}><Icon name="edit" size={15}/>编辑</button>
        {!data.readOnly && <><button aria-label="复制此节点" onClick={() => (data.onDuplicate as () => void)()}><Icon name="copy" size={15}/>复制</button><button className="node-delete" aria-label="删除此节点" onClick={() => (data.onDelete as () => void)()}><Icon name="trash" size={15}/></button></>}
    </NodeActions></NodeToolbar>}</Presence><Handle
    type="target"
    position={Position.Left}/><div className="node-card-heading"><small>{String(data.id)}</small><span className="node-kind">任务</span></div><strong>{String(data.title)}</strong><span className="node-agent">{String(data.agent)}</span><span className="node-status"><i/>尚未执行</span><Handle
    type="source" position={Position.Right}/></div>);
const StageCard = memo(({data, selected}: NodeProps) => <div className={'stage-node ' + (selected ? 'selected' : '')}>
    <Handle type="target" position={Position.Left} isConnectable={false}/><small>系统规划阶段 · 实际运行</small>
    <strong>{String(data.title)}</strong><span className={data.state === '进行中' ? 'pulse' : ''}>{String(data.state)}</span>
    <Handle type="source" position={Position.Right} isConnectable={false}/></div>);
const nodeTypes = {task: Card, stage: StageCard};
type DependencyEdgeData = {onEdit: () => void; onReverse: () => void; onDelete: () => void; label: string; error: string};
const DependencyEdge = memo((props: EdgeProps<Edge<DependencyEdgeData>>) => {
    const [path, x, y] = getBezierPath(props);
    return <>
        <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={props.interactionWidth}/>
        <EdgeLabelRenderer><Presence>{props.selected && props.data && <div className="edge-toolbar-anchor nodrag nopan" style={{transform:`translate(-50%, -100%) translate(${x}px, ${y}px)`}}>
            <div className="node-action-bar edge-action-bar" role="toolbar" aria-label={`依赖关系：${props.data.label}`}>
                <button aria-label="编辑此箭头" onClick={props.data.onEdit}><Icon name="edit" size={15}/>编辑</button>
                <button aria-label="反转此箭头" onClick={props.data.onReverse}>⇄ 反转</button>
                <button className="node-delete" aria-label="删除此箭头" onClick={props.data.onDelete}><Icon name="trash" size={15}/></button>
            </div>
            {props.data.error && <p className="edge-error" role="alert">{props.data.error}</p>}
        </div>}</Presence></EdgeLabelRenderer>
    </>
});
const edgeTypes = {dependency: DependencyEdge};
const edgeKey = (edge: { from: string; to: string }) => edge.from + '->' + edge.to;

export function positions(plan: Plan) {
    const result: Record<string, { x: number; y: number }> = {[stageIds.pm]: {x: 0, y: 60}, [stageIds.orchestrator]: {x: 290, y: 60}}, depths = new Map<string, number>();

    function depth(id: string, seen = new Set<string>()): number {
        if (depths.has(id)) return depths.get(id)!;
        if (seen.has(id)) return 0;
        seen.add(id);
        const d = Math.max(-1, ...(plan.pm.tasks.find(t => t.id === id)?.dependsOn || []).map(x => depth(x, new Set(seen)))) + 1;
        depths.set(id, d);
        return d
    }

    const rows = new Map<number, number>();
    for (const t of plan.pm.tasks) {
        const d = depth(t.id), r = rows.get(d) || 0;
        rows.set(d, r + 1);
        result[t.id] = {x: (d + 2) * 320, y: r * 240 + 60}
    }
    return result
}

export default function Graph({plan, layout, onLayout, selected, onSelect, onConnect, onDeleteEdge, onUpdateEdge, validationNotice, onDeleteNode, onEdit, onDuplicate, job, viewport, onViewport, readOnly = false}: {
    validationNotice?: ReactNode;
    onUpdateEdge: (previous: Dependency, next: Dependency) => string | undefined;
    plan?: Plan;
    job?: Job;
    viewport?: Workflow['viewport'];
    onViewport?: (v: NonNullable<Workflow['viewport']>) => void;
    readOnly?: boolean;
    onEdit: (id: string) => void;
    onDuplicate: (id: string) => void;
    layout: Record<string, { x: number; y: number }>;
    onLayout: (l: Record<string, { x: number; y: number }>) => void;
    selected: string;
    onSelect: (id: string) => void;
    onConnect: (c: Connection) => void;
    onDeleteEdge: (from: string, to: string) => void;
    onDeleteNode: (id: string) => void
}) {
    const [nodes, setNodes] = useState<Node[]>([]);
    const [flow, setFlow] = useState<ReactFlowInstance>(), [zoom, setZoom] = useState(viewport?.zoom || 1), [mapOpen, setMapOpen] = useState(false);
    const initialViewport = useRef(viewport), framed = useRef(false);
    const callbacks = useRef({onEdit, onDuplicate, onDeleteNode});
    callbacks.current = {onEdit, onDuplicate, onDeleteNode};
    const [picked, setPicked] = useState<{ from: string; to: string } | null>(null);
    const [editing, setEditing] = useState<Dependency | null>(null), [edgeError, setEdgeError] = useState('');
    const edgeExists = !!picked && !!plan?.pm.tasks.some(t => t.id === picked.to && t.dependsOn.includes(picked.from));
    useEffect(() => {
        if (!edgeExists || readOnly || selected) {setPicked(null); setEditing(null); setEdgeError('')}
    }, [edgeExists, readOnly, selected]);
    const beginEdit = (edge: Dependency) => {setPicked(edge); setEditing({...edge}); setEdgeError(''); onSelect('')};
    const applyEdge = (next: Dependency) => {
        if (!picked) return;
        const error = onUpdateEdge(picked, next);
        setEdgeError(error || '');
        if (!error) {setPicked(next); setEditing(null)}
    };
    const taskLabel = (id: string) => `${id} · ${plan?.pm.tasks.find(t => t.id === id)?.title || '任务不存在'}`;
    const previousLayout = useRef(layout);
    useEffect(() => {
        const moved = previousLayout.current !== layout;
        previousLayout.current = layout;
        const auto = plan ? positions(plan) : {[stageIds.pm]: {x: 0, y: 60}, [stageIds.orchestrator]: {x: 290, y: 60}};
        const states = stageStates(job, !!plan);
        setNodes(previous => {
            const keep = (id: string) => moved ? layout[id] || auto[id] : previous.find(n => n.id === id)?.position || layout[id] || auto[id];
            return [
                ...(['pm', 'orchestrator'] as const).map(stage => ({
                    id: stageIds[stage], type: 'stage', position: keep(stageIds[stage]), selected: selected === stageIds[stage],
                    deletable: false, connectable: false, draggable: !readOnly,
                    data: {title: stage === 'pm' ? '需求分析' : 'AI 编排', state: states[stage]}
                })),
                ...(plan?.pm.tasks || []).map(t => ({
                    id: t.id, type: 'task', position: keep(t.id), selected: selected === t.id,
                    deletable: !readOnly, connectable: !readOnly, draggable: !readOnly,
                    data: {id: t.id, title: t.title, agent: plan?.agents.find(a => a.id === t.agentId)?.name || '未分配 Agent', readOnly,
                        onEdit: () => callbacks.current.onEdit(t.id), onDuplicate: () => callbacks.current.onDuplicate(t.id), onDelete: () => callbacks.current.onDeleteNode(t.id)}
                }))
            ];
        })
    }, [plan, layout, selected, job, readOnly]);
    useEffect(() => {
        if (!flow || !nodes.length || initialViewport.current || framed.current) return;
        let second = 0;
        const first = requestAnimationFrame(() => {second = requestAnimationFrame(() => {
            void flow.fitView({padding:.15, minZoom:.55, maxZoom:1});
            framed.current = true
        })});
        return () => {cancelAnimationFrame(first); cancelAnimationFrame(second)}
    }, [flow, nodes.length]);
    useEffect(() => {
        if (selected) setPicked(null)
    }, [selected]);
    useEffect(() => {
        if (picked && !plan?.pm.tasks.some(t => t.id === picked.to && t.dependsOn.includes(picked.from))) setPicked(null)
    }, [plan, picked]);
    const pickedKey = picked ? edgeKey(picked) : '';
    const edges: Edge[] = (plan?.pm.tasks || []).flatMap(t => t.dependsOn.map(d => {
        const id = edgeKey({from: d, to: t.id}), active = id === pickedKey;
        return {
            id,
            source: d,
            target: t.id,
            type: 'dependency',
            data: {
                label: `${taskLabel(d)} → ${taskLabel(t.id)}`,
                onEdit: () => beginEdit({from:d,to:t.id}),
                onReverse: () => applyEdge({from:t.id,to:d}),
                onDelete: () => {onDeleteEdge(d,t.id);setPicked(null);setEdgeError('')},
                error: active && !editing ? edgeError : ''
            },
            selected: active,
            interactionWidth: 28,
            style: {
                stroke: active ? '#4d6bfe' : '#a2aec2',
                strokeWidth: active ? 3 : 1.5,
                filter: active ? 'drop-shadow(0 0 4px #4d6bfe44)' : undefined,
                transition: 'stroke .15s, stroke-width .15s'
            },
            markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 15,
                height: 15,
                color: active ? '#4d6bfe' : '#a2aec2'
            }
        }
    }));
    edges.push(...systemLinks(plan).map(({from, to}) => ({id: '$system:' + from + '->' + to, source: from, target: to,
        deletable: false, selectable: false, reconnectable: false, type: 'default',
        style: {stroke: '#007e80', strokeWidth: 2, strokeDasharray: '6 4'}, markerEnd: {type: MarkerType.ArrowClosed, color: '#007e80'}})));
    const editableEdge = (e: Edge) => !readOnly && !e.id.startsWith('$system:');
    useEffect(() => {
        const remove = (e: KeyboardEvent) => {
            if (readOnly) return;
            if (e.key === 'Escape' && !document.querySelector('.modal-back')) {setPicked(null); setEdgeError(''); return}
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
            if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            if (document.querySelector('.modal-back')) return;
            const focus = document.activeElement as HTMLElement | null;
            if (focus && focus !== document.body && !focus.closest('.graph')) return;
            if (picked) {
                e.preventDefault();
                setPicked(null);
                onDeleteEdge(picked.from, picked.to);
                return
            }
            if (selected && !stageOf(selected)) {
                e.preventDefault();
                onDeleteNode(selected)
            }
        };
        window.addEventListener('keydown', remove);
        return () => window.removeEventListener('keydown', remove)
    }, [picked, selected, onDeleteEdge, onDeleteNode, readOnly]);

    return <div className="graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={setFlow}
                                             onNodeDoubleClick={(_, n) => onEdit(n.id)}
                                             onNodesChange={c => setNodes(n => applyNodeChanges(c.filter(x => x.type !== 'remove'), n))}
                                             onNodeClick={(_, n) => {
                                                 setPicked(null);
                                                 onSelect(n.id)
                                             }}
                                             onNodeDragStop={(_, n) => onLayout({...layout, [n.id]: n.position})}
                                             onConnect={c => {if (!readOnly && !stageOf(c.source) && !stageOf(c.target)) onConnect(c)}} edgesReconnectable={false}
                                             onEdgeClick={(_, e) => {
                                                 if (!editableEdge(e)) return;
                                                 setPicked({from: e.source, to: e.target});
                                                 onSelect('')
                                             }}
                                              onEdgeDoubleClick={(_, e) => {
                                                  if (editableEdge(e)) beginEdit({from: e.source, to: e.target})
                                             }}
                                             onPaneClick={() => {
                                                 setPicked(null);
                                                 onSelect('')
                                             }}
                                             defaultViewport={viewport} onMove={(_, v) => setZoom(v.zoom)} onMoveEnd={(_, v) => onViewport?.(v)}
                                             zoomOnDoubleClick={false} fitView={!viewport} fitViewOptions={{padding: .18, minZoom:.65, maxZoom:1}} deleteKeyCode={null} minZoom={.1}
                                             maxZoom={1.5}><Background gap={22}
                                                                      size={1}
                                                                      color="#dde2eb"/><Controls showInteractive={false}/>
        <Panel position="top-left"><div className="canvas-label"><Icon name="sparkles" size={15}/><strong>编排画布</strong><span>WORKFLOW</span></div></Panel>
        <Panel position="top-right" className="canvas-overlays"><Presence>{validationNotice}</Presence></Panel>
        <Panel position="bottom-center"><div className="canvas-zoom"><button onClick={() => void flow?.zoomOut() } aria-label="缩小画布">−</button><button title="恢复 100%" onClick={() => void flow?.zoomTo(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => void flow?.zoomIn()} aria-label="放大画布">＋</button><i/><button onClick={() => void flow?.fitView({padding:.15})}>适应画布</button><button disabled={!selected} onClick={() => void flow?.fitView({nodes:[{id:selected}],padding:.6,maxZoom:1})}>定位节点</button><button aria-pressed={mapOpen} onClick={() => setMapOpen(!mapOpen)}>导航图</button></div></Panel>
        <Presence>{mapOpen && <MiniMap nodeColor={n => n.type === 'stage' ? '#a5c9c9' : '#8ba1f5'} pannable zoomable/>}</Presence></ReactFlow>
        <Presence>{editing && picked && edgeExists && <Dialog title="依赖关系详情" description="后续任务依赖前置任务完成；修改后应用到方案草稿。" className="node-dialog edge-dialog" onClose={() => {setEditing(null); setEdgeError('')}} footer={<><span className="dialog-feedback">修改应用后保留到草稿，正式保存请返回工作台</span><button onClick={() => {setEditing(null); setEdgeError('')}}>取消</button><button className="primary" onClick={() => applyEdge(editing)}>应用修改</button></>}>
            <div className="edge-endpoints">
                <section className="edge-endpoint"><span className="edge-endpoint-kind">起点 · 前置任务</span><strong>{taskLabel(editing.from)}</strong><label className="field">选择前置任务<select value={editing.from} onChange={e => {setEditing({...editing,from:e.target.value});setEdgeError('')}}>{plan?.pm.tasks.map(t => <option key={t.id} value={t.id}>{taskLabel(t.id)}</option>)}</select></label></section>
                <span className="edge-direction" aria-hidden="true">→</span>
                <section className="edge-endpoint"><span className="edge-endpoint-kind">终点 · 后续任务</span><strong>{taskLabel(editing.to)}</strong><label className="field">选择后续任务<select value={editing.to} onChange={e => {setEditing({...editing,to:e.target.value});setEdgeError('')}}>{plan?.pm.tasks.map(t => <option key={t.id} value={t.id}>{taskLabel(t.id)}</option>)}</select></label></section>
            </div>
            {edgeError && <p className="edge-error" role="alert">{edgeError}</p>}
        </Dialog>}</Presence>
    </div>
}
