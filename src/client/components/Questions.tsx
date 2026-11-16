import {useState} from 'react';
import type {Question} from '../../shared/domain';
import {MAX_QUESTION_OPTIONS} from '../../shared/domain';

const CUSTOM = -1;
const letter = (index: number) => String.fromCharCode(65 + index);

export default function Questions({questions, busy, disabled, onSubmit}: {
    questions: Question[];
    busy: boolean;
    disabled?: boolean;
    onSubmit: (answer: string) => void
}) {
    // Older saved questions may still contain more choices than the current limit.
    questions = questions.map(q => ({...q, options: q.options?.slice(0, MAX_QUESTION_OPTIONS)}));
    const [picked, setPicked] = useState<Record<string, number[]>>({});
    const [custom, setCustom] = useState<Record<string, string>>({});
    const [notes, setNotes] = useState('');

    const complete = questions.every(q => {
        const options = q.options || [], selected = picked[q.id] || [];
        if (!options.length) return !!custom[q.id]?.trim();
        return selected.length > 0 && selected.every(i => i !== CUSTOM || !!custom[q.id]?.trim())
    });

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

    function answerOf(q: Question) {
        const options = q.options || [], selected = picked[q.id] || [];
        if (!options.length) return custom[q.id]?.trim() || '';
        const answers = selected.filter(i => i !== CUSTOM).sort((a, b) => a - b).map(i => letter(i) + '. ' + options[i]);
        if (selected.includes(CUSTOM)) answers.push('自定义：' + (custom[q.id]?.trim() || ''));
        return answers.join('；')
    }

    function compose() {
        const lines = questions.map((q, i) => `${i + 1}. ${q.text}\n回答：${answerOf(q)}`);
        if (notes.trim()) lines.push(`补充说明：${notes.trim()}`);
        return lines.join('\n')
    }

    return <div className="questions">
        {questions.map((q, qi) => {
            const options = q.options || [], selected = picked[q.id] || [], multi = q.multi === true;
            return <section className="question" key={q.id}>
                <strong>
                    <span className="q-index">{qi + 1}</span>
                    <span className="q-text">{q.text}</span>
                    {options.length > 0 &&
                        <span className={'q-mode' + (multi ? ' multi' : '')}>{multi ? '多选' : '单选'}</span>}
                </strong>
                {q.reason && <p>{q.reason}</p>}
                {options.length > 0 ? <>
                    <div className="choices" role="group" aria-label={q.text + (multi ? '（多选）' : '（单选）')}>
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
        <label className="field">补充说明（可选）<textarea rows={2} value={notes}
                                                         placeholder="还有其他背景、约束或偏好？"
                                                         onChange={e => setNotes(e.target.value)}/></label>
        <button className="primary" disabled={busy || disabled || !complete} onClick={() => onSubmit(compose())}>
            提交回答并继续分析
        </button>
    </div>
}
