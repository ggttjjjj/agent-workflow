import {memo, useEffect, useState} from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Handle,
    Position,
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

export default function Graph({plan, layout, onLayout, selected, onSelect, onConnect, onDeleteEdge}: {
    plan: Plan;
    layout: Record<string, { x: number; y: number }>;
    onLayout: (l: Record<string, { x: number; y: number }>) => void;
    selected: string;
    onSelect: (id: string) => void;
    onConnect: (c: Connection) => void;
    onDeleteEdge: (from: string, to: string) => void
}) {
    const [nodes, setNodes] = useState<Node[]>([]);
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
    const edges: Edge[] = plan.pm.tasks.flatMap(t => t.dependsOn.map(d => ({
        id: d + '->' + t.id,
        source: d,
        target: t.id,
        type: 'default',
        style: {stroke: '#a2a8bb', strokeWidth: 1.5}
    })));
    return <div className="graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
                                             onNodesChange={c => setNodes(n => applyNodeChanges(c, n))}
                                             onNodeClick={(_, n) => onSelect(n.id)}
                                             onNodeDragStop={(_, n) => onLayout({...layout, [n.id]: n.position})}
                                             onConnect={onConnect} onEdgeDoubleClick={(_, e) => {
        if (confirm(`删除 ${e.source} → ${e.target} 依赖？关联输入需另行处理。`)) onDeleteEdge(e.source, e.target)
    }} fitView fitViewOptions={{padding: .2}} deleteKeyCode={null} minZoom={.25} maxZoom={1.5}><Background gap={22}
                                                                                                           size={1}
                                                                                                           color="#d9dce7"/><Controls/><MiniMap
        nodeColor="#a4a0e9" pannable zoomable/></ReactFlow></div>
}
