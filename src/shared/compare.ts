import type {Plan, Requirement} from './domain.ts';

export interface Change {
    label: string;
    kind: 'added' | 'removed' | 'changed';
    before?: unknown;
    after?: unknown
}
export interface ChangeGroup {title: string; changes: Change[]}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function comparePlans(before: Plan, after: Plan, oldRequirement?: Requirement, newRequirement?: Requirement): ChangeGroup[] {
    const groups: ChangeGroup[] = [];
    function group(title: string) {
        const changes: Change[] = [];
        groups.push({title, changes});
        return (label: string, a: unknown, b: unknown) => {
            if (!same(a, b)) changes.push({label, kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed', before: a, after: b})
        }
    }
    function entities<T extends {id: string}>(title: string, a: T[], b: T[], project: (item: T) => unknown = x => x) {
        const change = group(title);
        for (const id of new Set([...a.map(x => x.id), ...b.map(x => x.id)])) {
            const prev = a.find(x => x.id === id), next = b.find(x => x.id === id);
            change(id, prev === undefined ? undefined : project(prev), next === undefined ? undefined : project(next))
        }
    }
    const source = group('需求原文与版本');
    source('需求版本', before.requirementVersion, after.requirementVersion);
    source('原始文本', oldRequirement?.text, newRequirement?.text);
    // Compare original image contents too, but never dump base64 into the UI.
    for (const id of new Set([...(oldRequirement?.images || []).map(x => x.id), ...(newRequirement?.images || []).map(x => x.id)])) {
        const a = oldRequirement?.images.find(x => x.id === id), b = newRequirement?.images.find(x => x.id === id);
        if (!same(a, b)) source(`图片 ${id}`, a ? {id, name: a.name, content: b && a.data !== b.data ? '原图片内容' : '图片'} : undefined, b ? {id, name: b.name, content: a && a.data !== b.data ? '新图片内容' : '图片'} : undefined)
    }
    const requirement = group('需求分析');
    for (const [key, name] of Object.entries({goal: '目标', audience: '受众', deliverables: '交付物', constraints: '约束', exclusions: '排除项', assumptions: '假设'}) as [keyof typeof before.pm, string][]) requirement(name, before.pm[key], after.pm[key]);
    entities('验收条件', before.pm.criteria, after.pm.criteria);
    entities('任务', before.pm.tasks, after.pm.tasks, ({dependsOn: _deps, agentId: _agent, ...task}) => task);
    const edges = (p: Plan) => p.pm.tasks.flatMap(t => t.dependsOn.map(from => ({id: `${from} → ${t.id}`})));
    entities('依赖', edges(before), edges(after));
    entities('Agent 定义', before.agents, after.agents);
    entities('任务分配', before.pm.tasks, after.pm.tasks, t => ({agentId: t.agentId}));
    const config = group('默认配置与分工理由');
    config('下游模型', before.model, after.model);
    config('下游思考强度', before.effort, after.effort);
    config('生成设置快照', before.settings, after.settings);
    config('分工理由', before.rationale, after.rationale);
    const answers = group('澄清与异议问答');
    answers('原始问答上下文', before.answers || [], after.answers || []);
    return groups
}
