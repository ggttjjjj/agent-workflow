import type {Finding} from '../shared/domain';

export interface ConfirmContext {
    confirmed: boolean;
    confirming: boolean;
    busy: boolean;
    active: boolean;
    dirty: boolean;
    conflict: boolean;
    candidate: boolean;
    findings: Finding[];
    requirementVersion: number;
    revisionRequirementVersion: number;
    jobStatus?: string
}

export interface ConfirmState {
    disabled: boolean;
    label: string;
    reason: string
}

/**
 * Confirm accepts a saved revision. It is only meaningful for an unconfirmed,
 * saved, structurally valid revision whose coverage is complete, whose
 * requirement is current and whose pending decisions are resolved.
 */
export function confirmState(c: ConfirmContext): ConfirmState {
    const errors = c.findings.filter(f => f.level === 'error').length;
    const reason = c.confirming ? '正在提交确认…'
        : c.busy ? '正在处理其他操作，请稍候'
            : c.active ? '生成进行中，请等待完成'
                : c.dirty ? '有未保存修改，请先保存方案'
                    : c.conflict ? '草稿基础版本冲突，请先处理'
                        : c.candidate ? '存在候选稿，请先采用或放弃'
                            : errors ? '存在结构错误，请先处理'
                                : c.findings.length ? '验收条件尚未全部覆盖，请先补齐'
                                    : c.revisionRequirementVersion !== c.requirementVersion ? '方案对应旧需求，请重新生成'
                                        : ['waiting', 'issues'].includes(c.jobStatus || '') ? '请先处理待回答的问题'
                                            : c.confirmed ? '当前修订已确认' : '';
    return {
        disabled: !!reason,
        label: c.confirming ? '确认中…' : c.confirmed && !c.dirty ? '已确认' : '确认方案',
        reason
    }
}

export interface SaveContext {
    saving: boolean;
    busy: boolean;
    active: boolean;
    conflict: boolean;
    dirty: boolean;
    findings: Finding[]
}

export interface SaveState {
    disabled: boolean;
    label: string;
    reason: string
}

/**
 * Save persists the edited draft as a new working revision. Unlike confirm,
 * coverage gaps do not block saving: a structurally valid plan may be saved for
 * later completion, while confirmation still requires full coverage.
 */
export function saveState(c: SaveContext): SaveState {
    const errors = c.findings.some(f => f.level === 'error');
    const reason = c.saving ? '正在保存…'
        : c.busy ? '正在处理其他操作，请稍候'
            : c.active ? '生成进行中，请等待完成'
                : c.conflict ? '草稿基础版本冲突，请先处理'
                    : !c.dirty ? '没有未保存的修改'
                        : errors ? '存在结构错误，请先处理'
                            : '';
    return {
        disabled: !!reason,
        label: c.saving ? '保存中…' : !c.dirty && !c.conflict ? '已保存' : '保存方案',
        reason
    }
}
