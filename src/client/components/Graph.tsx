import {memo, useEffect, useRef, useState} from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Handle,
    Position,
    MarkerType,
    applyNodeChanges,
    type Node,
    type Edge,
    type NodeProps,
    type Connection
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {Job, Plan, Workflow} from '../../shared/domain';
import {stageIds, stageOf, stageStates, systemLinks} from '../../shared/planning';

const Card = memo(({data, selected}: NodeProps) => <div className={'task-node ' + (selected ? 'selected' : '')}><Handle
    type="target"
    position={Position.Left}/><small>{String(data.id)}</small><strong>{String(data.title)}</strong><span>任务定义 · 尚未执行</span><span>♧ {String(data.agent)}</span><Handle
    type="source" position={Position.Right}/></div>);
const StageCard = memo(({data, selected}: NodeProps) => <div className={'stage-node ' + (selected ? 'selected' : '')}>
    <Handle type="target" position={Position.Left} isConnectable={false}/><small>系统规划阶段 · 实际运行</small>
    <strong>{String(data.title)}</strong><span className={data.state === '进行中' ? 'pulse' : ''}>{String(data.state)}</span>
    <Handle type="source" position={Position.Right} isConnectable={false}/></div>);
const nodeTypes = {task: Card, stage: StageCard};
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
        result[t.id] = {x: (d + 2) * 290, y: r * 180 + 60}
    }
    return result
}

export default function Graph({plan, layout, onLayout, selected, onSelect, onConnect, onDeleteEdge, onDeleteNode, job, viewport, onViewport, readOnly = false}: {
    plan?: Plan;
    job?: Job;
    viewport?: Workflow['viewport'];
    onViewport?: (v: NonNullable<Workflow['viewport']>) => void;
    readOnly?: boolean;
    layout: Record<string, { x: number; y: number }>;
    onLayout: (l: Record<string, { x: number; y: number }>) => void;
    selected: string;
    onSelect: (id: string) => void;
    onConnect: (c: Connection) => void;
    onDeleteEdge: (from: string, to: string) => void;
    onDeleteNode: (id: string) => void
}) {
    const [nodes, setNodes] = useState<Node[]>([]);
    const [picked, setPicked] = useState<{ from: string; to: string } | null>(null);
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
                    data: {id: t.id, title: t.title, agent: plan?.agents.find(a => a.id === t.agentId)?.name || '未分配 Agent'}
                }))
            ];
        })
    }, [plan, layout, selected, job, readOnly]);
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
            type: 'default',
            selected: active,
            interactionWidth: 28,
            style: {
                stroke: active ? '#4536d6' : '#a2a8bb',
                strokeWidth: active ? 3 : 1.5,
                filter: active ? 'drop-shadow(0 0 4px #4536d688)' : undefined,
                transition: 'stroke .15s, stroke-width .15s'
            },
            markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 15,
                height: 15,
                color: active ? '#4536d6' : '#a2a8bb'
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

    return <div className="graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
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
                                                 setPicked(null);
                                                 editableEdge(e) && onDeleteEdge(e.source, e.target)
                                             }}
                                             onPaneClick={() => {
                                                 setPicked(null);
                                                 onSelect('')
                                             }}
                                             defaultViewport={viewport} onMoveEnd={(_, v) => onViewport?.(v)}
                                             fitView={!viewport} fitViewOptions={{padding: .2}} deleteKeyCode={null} minZoom={.1}
                                             maxZoom={1.5}><Background gap={22}
                                                                      size={1}
                                                                      color="#d9dce7"/><Controls/><MiniMap
        nodeColor="#a4a0e9" pannable zoomable/></ReactFlow></div>
}
