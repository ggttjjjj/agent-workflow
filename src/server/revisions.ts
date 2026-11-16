import {randomUUID} from 'node:crypto';
import {current, requirementAnalysis, requirementBaseline, validatePlan, type Workflow} from '../shared/domain.ts';
import {active} from './engine.ts';

function reject(message: string, status = 400): never {
    throw Object.assign(new Error(message), {status})
}

export function acceptCandidate(w: Workflow) {
    const plan = w.candidate;
    if (!plan) reject('没有候选稿');
    if (plan.requirementVersion !== w.requirement.version) reject('候选对应旧需求，请放弃后重新生成', 409);
    const errors = validatePlan(plan, w.requirement, true, requirementBaseline(w));
    if (errors.length) reject('候选校验失败：' + errors.map(e => e.message).join('; '));
    const rev = {id: randomUUID(), number: w.revisions.length + 1, plan, createdAt: new Date().toISOString()};
    w.revisions.push(rev);
    w.currentId = rev.id;
    const analysis = requirementAnalysis(plan.pm);
    w.requirement.analysis = analysis;
    const req = w.requirements.find(r => r.version === plan.requirementVersion);
    if (req) req.analysis = analysis;
    w.candidate = undefined
}

export function confirmRevision(w: Workflow, revisionId: string, requirementVersion: number) {
    const rev = current(w);
    if (!rev || rev.id !== revisionId || w.requirement.version !== requirementVersion || rev.plan.requirementVersion !== w.requirement.version) reject('方案或需求版本已变化', 409);
    if (w.candidate || active(w.job) || ['waiting', 'issues'].includes(w.job?.status || '')) reject('请先处理生成、问题或候选稿', 409);
    const errors = validatePlan(rev.plan, w.requirement, true, requirementBaseline(w));
    if (errors.length) reject(errors.map(x => x.message).join('\n'));
    rev.confirmedAt = new Date().toISOString()
}
