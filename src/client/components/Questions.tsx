import {useEffect, useRef, useState} from 'react';
import type {Question} from '../../shared/domain';
import {composeAnswers, normalizeQuestions, questionComplete, readQuestionDraft, retainQuestionDraft} from '../questionState';

const CUSTOM = -1;
const letter = (index: number) => String.fromCharCode(65 + index);

export default function Questions({questions, busy, disabled, onSubmit, sessionKey}: {
    questions: Question[];
    busy: boolean;
    disabled?: boolean;
    sessionKey?: string;
    onSubmit: (answer: string) => void
}) {
    // Older saved questions may still contain more choices than the current limit.
    questions = normalizeQuestions(questions);
    const [draft, setDraft] = useState(() => readQuestionDraft(sessionKey));
    const {picked, custom, notes} = draft;
    const step = Math.min(draft.step, Math.max(0, questions.length - 1)), last = step === questions.length - 1;
    const heading = useRef<HTMLDivElement>(null);
    useEffect(() => {if (sessionKey) retainQuestionDraft(sessionKey, draft)}, [sessionKey, draft]);
    useEffect(() => {heading.current?.focus()}, [step]);
    const setPicked = (fn: (value: Record<string, number[]>) => Record<string, number[]>) => setDraft(old => ({...old, picked: fn(old.picked)}));
    const setCustom = (fn: (value: Record<string, string>) => Record<string, string>) => setDraft(old => ({...old, custom: fn(old.custom)}));
    const setNotes = (notes: string) => setDraft(old => ({...old, notes}));

    const complete = questions.every(q => questionComplete(q, draft));

    function choose(q: Question, index: number) {
        setPicked(state => {
            const selected = state[q.id] || [];
            if (q.multi) return {
                ...state,
                [q.id]: selected.includes(index) ? selected.filter(x => x !== index) : [...selected, index]
            };
            return {...state, [q.id]: [index]}
        })
    }

    if (!questions.length) return <p>暂无需要回答的问题。</p>;
    return <div className="questions question-wizard">
        <div className="question-progress" ref={heading} tabIndex={-1} role="status">问题 {step + 1} / {questions.length}<progress value={step + 1} max={questions.length}/></div>
        <fieldset disabled={busy || disabled}>
        {questions.slice(step, step + 1).map((q) => {
            const options = q.options || [], selected = picked[q.id] || [], multi = q.multi === true;
            return <section className="question" key={q.id}>
                <strong>
                    <span className="q-index">{step + 1}</span>
                    <span className="q-text">{q.text}</span>
                    {options.length > 0 &&
                        <span className={'q-mode' + (multi ? ' multi' : '')}>{multi ? '多选' : '单选'}</span>}
                </strong>
                {q.reason && <p>{q.reason}</p>}
                {options.length > 0 ? <>
                    <div className="choices" role={multi ? 'group' : 'radiogroup'} aria-label={q.text + (multi ? '（多选）' : '（单选）')}>
                        {options.map((option, i) => {
                            const active = selected.includes(i);
                            return <button type="button" key={i} role={multi ? 'checkbox' : 'radio'}
                                           aria-checked={active} className={'choice' + (active ? ' selected' : '')}
                                           onClick={() => choose(q, i)}>
                                <b>{letter(i)}</b><span>{option}</span>
                            </button>
                        })}
                        <button type="button" role={multi ? 'checkbox' : 'radio'}
                                aria-checked={selected.includes(CUSTOM)}
                                className={'choice custom' + (selected.includes(CUSTOM) ? ' selected' : '')}
                                onClick={() => choose(q, CUSTOM)}>
                            <b>{letter(options.length)}</b><span>自定义回答</span>
                        </button>
                    </div>
                    {selected.includes(CUSTOM) &&
                        <textarea autoFocus aria-label={q.text + ' 的自定义回答'} rows={2} placeholder="输入你的回答…"
                                  value={custom[q.id] || ''}
                                  onChange={e => setCustom(s => ({...s, [q.id]: e.target.value}))}/>}
                </> : <label className="field question-free">回答<textarea
                    aria-label={q.text + ' 的回答'} rows={2} placeholder="输入你的回答…" value={custom[q.id] || ''}
                    onChange={e => setCustom(s => ({...s, [q.id]: e.target.value}))}/></label>}
            </section>
        })}
        {last && <label className="field">补充说明（可选）<textarea rows={2} value={notes}
                                                         placeholder="还有其他背景、约束或偏好？"
                                                         onChange={e => setNotes(e.target.value)}/></label>}
        </fieldset>
        <div className="question-actions"><span>关闭后保留本轮回答</span><button disabled={busy || step === 0} onClick={() => setDraft(old => ({...old, step: step - 1}))}>上一步</button>
            {last ? <button className="primary" disabled={busy || disabled || !complete} onClick={() => onSubmit(composeAnswers(questions, draft))}>{busy ? '提交中…' : '提交回答并继续分析'}</button>
                : <button className="primary" disabled={busy || disabled || !questionComplete(questions[step], draft)} onClick={() => setDraft(old => ({...old, step: step + 1}))}>下一步</button>}
        </div>
    </div>
}
