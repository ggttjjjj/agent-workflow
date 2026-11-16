import {current, defaults, validateSettings, type Job, type Plan, type Settings, type Workflow} from './domain.ts';

export type Stage = 'pm' | 'orchestrator';
export const stageIds = {pm: '$planning:pm', orchestrator: '$planning:orchestrator'} as const;
export const stageOf = (id: string): Stage | undefined => id === stageIds.pm ? 'pm' : id === stageIds.orchestrator ? 'orchestrator' : undefined;
export const planningLocked = (job?: Job) => !!job && ['analyzing', 'orchestrating', 'waiting', 'issues'].includes(job.status);
export type StageState = '未开始' | '进行中' | '等待处理' | '已完成' | '失败' | '已取消' | '已中断';
export function stageStates(job?: Job, saved = false): Record<Stage, StageState> {
    if (!job) return {pm: saved ? '已完成' : '未开始', orchestrator: saved ? '已完成' : '未开始'};
    if (job.result || job.status === 'complete' || job.status === 'save_failed') return {pm: '已完成', orchestrator: '已完成'};
    const end: StageState = job.status === 'cancelled' ? '已取消' : job.status === 'interrupted' ? '已中断' : '失败';
    if (job.stage === 'pm') return {pm: job.status === 'waiting' ? '等待处理' : job.status === 'analyzing' ? '进行中' : end, orchestrator: '未开始'};
    return {pm: job.pm ? '已完成' : '未开始', orchestrator: job.status === 'issues' ? '等待处理' : job.status === 'orchestrating' ? '进行中' : end};
}
export function systemLinks(plan?: Plan) {
    return [{from: stageIds.pm, to: stageIds.orchestrator}, ...(plan?.pm.tasks || []).filter(t => !t.dependsOn.length).map(t => ({from: stageIds.orchestrator, to: t.id}))];
}
export function planningSettings(w: Workflow, fallback: Settings = defaults): Settings {
    return structuredClone(w.planningSettings || current(w)?.plan.settings || w.job?.settings || w.revisions[0]?.plan.settings || fallback);
}
export function savePlanningSettings(w: Workflow, settings: Settings) {
    if (planningLocked(w.job)) throw Object.assign(new Error('本轮生成及等待处理期间配置已锁定'), {status: 409});
    if (!validateSettings(settings)) throw Object.assign(new Error('提示词或思考强度无效'), {status: 400});
    const old = planningSettings(w);
    w.planningSettings = {...old, pmPrompt: settings.pmPrompt, pmEffort: settings.pmEffort, orchestratorPrompt: settings.orchestratorPrompt, orchestratorEffort: settings.orchestratorEffort};
}
export function saveCanvas(w: Workflow, body: {layout?: Workflow['layout']; viewport?: Workflow['viewport']}) {
    const l = body.layout;
    if (l !== undefined && (!l || Array.isArray(l) || typeof l !== 'object' || Object.entries(l).some(([id, v]) => !id || !Number.isFinite(v?.x) || !Number.isFinite(v?.y)))) throw Object.assign(new Error('布局无效'), {status: 400});
    const v = body.viewport;
    if (v !== undefined && (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.zoom) || v.zoom < .1 || v.zoom > 2)) throw Object.assign(new Error('视角无效'), {status: 400});
    if (l) w.layout = {...w.layout, ...l};
    if (v) w.viewport = {...v};
}
