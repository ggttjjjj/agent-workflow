import type {Plan} from '../shared/domain';

export type Dependency = {from: string; to: string};
export function updateDependency(plan: Plan, previous: Dependency, next?: Dependency): {plan: Plan; error?: string} {
    const tasks = plan.pm.tasks;
    if (!tasks.some(t => t.id === previous.to && t.dependsOn.includes(previous.from))) return {plan, error: '原依赖关系已不存在，请重新选择箭头'};
    if (next && (!tasks.some(t => t.id === next.from) || !tasks.some(t => t.id === next.to))) return {plan, error: '请选择仍然存在的任务'};
    if (next?.from === previous.from && next?.to === previous.to) return {plan};
    const removed = tasks.map(t => t.id === previous.to ? {...t, dependsOn: t.dependsOn.filter(id => id !== previous.from)} : t);
    if (next) {
        if (next.from === next.to) return {plan, error: '不能建立自环依赖'};
        if (removed.find(t => t.id === next.to)!.dependsOn.includes(next.from)) return {plan, error: '该依赖关系已存在'};
        const visited = new Set<string>();
        const reaches = (id: string): boolean => {
            if (id === next.to) return true;
            if (visited.has(id)) return false;
            visited.add(id);
            return (removed.find(t => t.id === id)?.dependsOn || []).some(reaches);
        };
        if (reaches(next.from)) return {plan, error: '不能建立循环依赖'};
    }
    return {plan: {...plan, pm: {...plan.pm, tasks: removed.map(t => next && t.id === next.to ? {...t, dependsOn: [...t.dependsOn, next.from]} : t)}}};
}
