import {MAX_QUESTION_OPTIONS, type Question, type Workflow} from '../shared/domain';

export type QuestionDraft = {picked: Record<string, number[]>; custom: Record<string, string>; notes: string; step: number};
export const emptyQuestionDraft = (): QuestionDraft => ({picked: {}, custom: {}, notes: '', step: 0});
export const normalizeQuestions = (questions: Question[]) => questions.map(q => ({...q, options: q.options?.slice(0, MAX_QUESTION_OPTIONS)}));
export const questionComplete = (q: Question, draft: QuestionDraft) => {
    const selected = draft.picked[q.id] || [];
    if (!q.options?.length) return !!draft.custom[q.id]?.trim();
    return selected.length > 0 && selected.every(i => i === -1 ? !!draft.custom[q.id]?.trim() : i >= 0 && i < q.options!.length)
};
export function composeAnswers(questions: Question[], draft: QuestionDraft) {
    const lines = questions.map((q, index) => {
        const selected = draft.picked[q.id] || [];
        const answers = selected.filter(i => i >= 0).sort((a, b) => a - b).map(i => String.fromCharCode(65 + i) + '. ' + q.options![i]);
        if (selected.includes(-1)) answers.push('自定义：' + (draft.custom[q.id]?.trim() || ''));
        return `${index + 1}. ${q.text}\n回答：${q.options?.length ? answers.join('；') : draft.custom[q.id]?.trim() || ''}`
    });
    if (draft.notes.trim()) lines.push(`补充说明：${draft.notes.trim()}`);
    return lines.join('\n')
}
export function questionRoundKey(w: Workflow) {
    const job = w.job;
    return job ? JSON.stringify([w.id, job.id, job.stage, job.requirement.version, job.answers.length, job.questions, job.issues]) : ''
}
const sessions = new Map<string, QuestionDraft>();
export const readQuestionDraft = (key?: string) => key && sessions.get(key) || emptyQuestionDraft();
export function retainQuestionDraft(key: string, value: QuestionDraft) {
    sessions.set(key, value);
    if (sessions.size > 30) sessions.delete(sessions.keys().next().value!)
}
