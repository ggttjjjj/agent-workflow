export type Effort = 'low' | 'high' | 'max';

export interface Settings {
    pmPrompt: string;
    orchestratorPrompt: string;
    pmEffort: Effort;
    orchestratorEffort: Effort;
    downstreamEffort: Effort
}

export const defaults: Settings = {
    pmEffort: 'high',
    orchestratorEffort: 'high',
    downstreamEffort: 'high',
    pmPrompt: '你是跨领域需求分析与任务拆解的 PM agent。依据文本、图片和回答明确目标、受众、交付物、约束、排除项、假设及验收条件。只针对影响规划的必要信息提问，不重复询问，不臆造。所有验收条件均必需；不得擅自删除、降级或实质改变用户明确要求，必要时先澄清。充分时拆解任务、依赖、输入、预期输出、完成条件及验收关联。只规划，不执行任务。',
    orchestratorPrompt: '你是跨领域 AI 编排器。根据 PM 的需求和任务动态设计 Agent，定义角色名、职责、系统提示词和未来能力需求，每个任务一个主要负责者，一个角色可负责多个任务。说明分工理由。不改变 PM 的需求与任务；有矛盾时返回需要调整的问题并等待用户。能力只是未来声明，不代表已接入。只规划，不执行下游 Agent。'
};

export interface Picture {
    id: string;
    name: string;
    data: string
}

export interface Requirement {
    version: number;
    text: string;
    images: Picture[]
}

export interface Criterion {
    id: string;
    text: string
}

export interface InputRef {
    kind: 'requirement' | 'image' | 'task';
    ref: string;
    output?: string
}

export interface Task {
    id: string;
    title: string;
    goal: string;
    inputs: InputRef[];
    outputs: string[];
    done: string[];
    criteria: string[];
    dependsOn: string[];
    agentId: string
}

export interface Agent {
    id: string;
    name: string;
    responsibility: string;
    prompt: string;
    capabilities: string[]
}

export interface PM {
    goal: string;
    audience: string;
    deliverables: string[];
    constraints: string[];
    exclusions: string[];
    assumptions: string[];
    criteria: Criterion[];
    tasks: Task[]
}

export interface Plan {
    pm: PM;
    agents: Agent[];
    rationale: string;
    model: 'deepseek-flash';
    effort: Effort;
    requirementVersion: number;
    settings: Settings
}

export interface Revision {
    id: string;
    number: number;
    plan: Plan;
    createdAt: string;
    confirmedAt?: string
}

export interface Question {
    id: string;
    text: string;
    reason: string
}

export interface Job {
    id: string;
    status: 'analyzing' | 'orchestrating' | 'waiting' | 'issues' | 'complete' | 'failed' | 'cancelled' | 'interrupted' | 'save_failed';
    stage: 'pm' | 'orchestrator' | 'save';
    requirement: Requirement;
    settings: Settings;
    base?: Plan;
    feedback: string;
    answers: { questions: Question[]; answer: string }[];
    questions: Question[];
    issues: string[];
    pm?: PM;
    result?: Plan;
    preview: string;
    usage: unknown;
    error?: string;
    attempt: number;
    createdAt: string;
    elapsedMs?: number;
    isRegeneration: boolean
}

export interface Workflow {
    id: string;
    title: string;
    version: number;
    requirement: Requirement;
    requirements: Requirement[];
    revisions: Revision[];
    currentId?: string;
    candidate?: Plan;
    job?: Job;
    layout: Record<string, { x: number; y: number }>;
    createdAt: string;
    updatedAt: string
}

export interface Finding {
    path: string;
    message: string;
    level: 'error' | 'coverage'
}

export const current = (w: Workflow) => w.revisions.find(r => r.id === w.currentId);
const list = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string' && v.trim().length > 0);
const nonempty = (x: unknown) => typeof x === 'string' && x.trim().length > 0;

export function validatePlan(plan: Plan, req: Requirement, assign = true): Finding[] {
    const e: Finding[] = [];
    const err = (path: string, message: string, level: Finding['level'] = 'error') => e.push({path, message, level});
    if (!plan?.pm || !Array.isArray(plan.pm.tasks) || !Array.isArray(plan.pm.criteria) || !Array.isArray(plan.agents)) return [{
        path: 'plan',
        message: '方案结构不完整',
        level: 'error'
    }];
    const p = plan.pm;
    if (!nonempty(p.goal) || !nonempty(p.audience)) err('pm', '目标与受众不能为空');
    for (const k of ['deliverables', 'constraints', 'exclusions', 'assumptions'] as const) if (!list(p[k])) err(`pm.${k}`, '需要文本数组（可为空）');
    const ts = p.tasks, ids = new Set<string>(), cs = new Set<string>(), as = new Set<string>();
    if (!p.criteria.length) err('criteria', '至少一个必需验收条件');
    if (!ts.length) err('tasks', '至少一个任务');
    for (const c of p.criteria) {
        if (!nonempty(c.id) || cs.has(c.id) || !nonempty(c.text)) err('criteria', '验收 ID 必须唯一且有内容');
        cs.add(c.id)
    }
    for (const a of plan.agents) {
        if (!a || !nonempty(a.id) || as.has(a.id) || !nonempty(a.name) || !nonempty(a.responsibility) || !nonempty(a.prompt) || !list(a.capabilities)) err(`agent:${a?.id}`, 'Agent ID、名称、职责、提示词和能力格式不合法');
        as.add(a?.id)
    }
    for (const t of ts) {
        if (!t || !nonempty(t.id) || ids.has(t.id)) err('tasks', '任务 ID 必须唯一');
        ids.add(t?.id)
    }
    for (const t of ts) {
        const path = `task:${t?.id}`;
        if (!t) {
            err(path, '任务无效');
            continue
        }
        if (!nonempty(t.title) || !nonempty(t.goal) || !list(t.outputs) || !t.outputs.length || !list(t.done) || !t.done.length) err(path, '任务标题、目标、预期输出与完成条件不能为空');
        if (!list(t.dependsOn) || !list(t.criteria) || !Array.isArray(t.inputs) || !t.inputs.length) {
            err(path, '依赖、验收关联或输入格式错误');
            continue
        }
        if (new Set(t.outputs).size !== t.outputs.length) err(path, '预期输出名称不能重复');
        if (assign && !as.has(t.agentId)) err(path, '必须分配一个存在的主要 Agent');
        for (const d of t.dependsOn) if (!ids.has(d) || d === t.id) err(path, `非法依赖：${d}`);
        if (new Set(t.dependsOn).size !== t.dependsOn.length) err(path, '不能重复依赖');
        for (const c of t.criteria) if (!cs.has(c)) err(path, `未知验收条件：${c}`);
        for (const input of t.inputs) {
            if (!input || !['requirement', 'image', 'task'].includes(input.kind)) {
                err(path, '输入来源类型无效');
                continue
            }
            if (input.kind === 'requirement' && input.ref !== 'spec' && !cs.has(input.ref)) err(path, '需求输入引用不存在');
            if (input.kind === 'image' && !req.images.some(i => i.id === input.ref)) err(path, '图片输入引用不存在');
            if (input.kind === 'task') {
                const from = ts.find(x => x.id === input.ref);
                if (!from || !t.dependsOn.includes(input.ref) || !from.outputs?.includes(input.output || '')) err(path, '前置输入须引用直接依赖任务的有效输出')
            }
        }
    }
    const visited = new Set<string>(), active = new Set<string>();
    let cycle = false;

    function visit(id: string) {
        if (active.has(id)) {
            cycle = true;
            return
        }
        if (visited.has(id)) return;
        active.add(id);
        for (const d of ts.find(t => t?.id === id)?.dependsOn || []) if (ids.has(d)) visit(d);
        active.delete(id);
        visited.add(id)
    }

    for (const id of ids) visit(id);
    if (cycle) err('edges', '任务依赖存在循环');
    for (const c of p.criteria) if (!ts.some(t => t?.criteria?.includes(c.id))) err(`criterion:${c.id}`, `未覆盖：${c.text}`, 'coverage');
    return e;
}

export function semantic(plan: Plan) {
    return JSON.stringify(plan)
}

export function validateSettings(s: Settings) {
    return !!s && nonempty(s.pmPrompt) && nonempty(s.orchestratorPrompt) && ['pmEffort', 'orchestratorEffort', 'downstreamEffort'].every(k => ['low', 'high', 'max'].includes(s[k as keyof Settings]))
}
