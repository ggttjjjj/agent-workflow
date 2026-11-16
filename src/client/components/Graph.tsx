import {memo, useEffect, useState} from 'react';
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
import type {Plan} from '../../shared/domain';

const Card = memo(({data, selected}: NodeProps) => <div className={'task-node ' + (selected ? 'selected' : '')}><Handle
    type="target"
    position={Position.Left}/><small>{String(data.id)}</small><strong>{String(data.title)}</strong><span>♧ {String(data.agent)}</span><Handle
    type="source" position={Position.Right}/></div>);
const nodeTypes = {task: Card};
const edgeKey = (edge: { from: string; to: string }) => edge.from + '->' + edge.to;

export function positions(plan: Plan) {
    const result: Record<string, { x: number; y: number }> = {}, depths = new Map<string, number>();

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
        result[t.id] = {x: d * 290, y: r * 180 + 60}
    }
    return result
}

export default function Graph({plan, layout, onLayout, selected, onSelect, onConnect, onDeleteEdge, onDeleteNode}: {
    plan: Plan;
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
    useEffect(() => {
        const auto = positions(plan);
        setNodes(plan.pm.tasks.map(t => ({
            id: t.id,
            type: 'task',
            position: layout[t.id] || auto[t.id],
            selected: t.id === selected,
            data: {id: t.id, title: t.title, agent: plan.agents.find(a => a.id === t.agentId)?.name || '未分配 Agent'}
        })))
    }, [plan, layout, selected]);
    useEffect(() => {
        if (selected) setPicked(null)
    }, [selected]);
    useEffect(() => {
        if (picked && !plan.pm.tasks.some(t => t.id === picked.to && t.dependsOn.includes(picked.from))) setPicked(null)
    }, [plan, picked]);
    const pickedKey = picked ? edgeKey(picked) : '';
    const edges: Edge[] = plan.pm.tasks.flatMap(t => t.dependsOn.map(d => {
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
    useEffect(() => {
        const remove = (e: KeyboardEvent) => {
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
            if (selected) {
                e.preventDefault();
                onDeleteNode(selected)
            }
        };
        window.addEventListener('keydown', remove);
        return () => window.removeEventListener('keydown', remove)
    }, [picked, selected, onDeleteEdge, onDeleteNode]);

    return <div className="graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
                                             onNodesChange={c => setNodes(n => applyNodeChanges(c, n))}
                                             onNodeClick={(_, n) => {
                                                 setPicked(null);
                                                 onSelect(n.id)
                                             }}
                                             onNodeDragStop={(_, n) => onLayout({...layout, [n.id]: n.position})}
                                             onConnect={onConnect}
                                             onEdgeClick={(_, e) => {
                                                 setPicked({from: e.source, to: e.target});
                                                 onSelect('')
                                             }}
                                             onEdgeDoubleClick={(_, e) => {
                                                 setPicked(null);
                                                 onDeleteEdge(e.source, e.target)
                                             }}
                                             onPaneClick={() => {
                                                 setPicked(null);
                                                 onSelect('')
                                             }}
                                             fitView fitViewOptions={{padding: .2}} deleteKeyCode={null} minZoom={.25}
                                             maxZoom={1.5}><Background gap={22}
                                                                      size={1}
                                                                      color="#d9dce7"/><Controls/><MiniMap
        nodeColor="#a4a0e9" pannable zoomable/></ReactFlow></div>
}
