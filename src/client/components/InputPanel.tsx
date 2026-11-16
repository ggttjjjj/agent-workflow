import {useState} from 'react';
import type {Picture, Requirement} from '../../shared/domain';
import Icon from './Icon';

const examples = [
    {title: '策划一场活动', text: '为社区策划一场90分钟的亲子阅读活动，需要活动流程、场地安排和预算方案。'},
    {title: '拆解产品需求', text: '为一款个人阅读管理应用拆解产品需求，规划核心功能、开发任务和验收标准。'},
    {title: '制定学习计划', text: '制定一份为期4周的前端入门学习计划，每天投入1小时，需要阶段目标、练习任务和成果检查。'}
];

export default function InputPanel({initial, onSubmit, busy, label = '开始 AI 规划'}: {
    initial?: Requirement;
    onSubmit: (text: string, images: Picture[]) => void;
    busy: boolean;
    label?: string
}) {
    const [text, setText] = useState(initial?.text || ''), [images, setImages] = useState<Picture[]>(initial?.images || []), [error, setError] = useState('');

    async function add(files: File[]) {
        try {
            const result: Picture[] = [];
            for (const f of files) {
                if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.type) || f.size > 10 * 1024 * 1024) throw new Error('仅支持10MB以内的PNG、JPEG、WebP、GIF');
                const data = await new Promise<string>((r, j) => {
                    const reader = new FileReader();
                    reader.onload = () => r(String(reader.result));
                    reader.onerror = j;
                    reader.readAsDataURL(f)
                });
                result.push({id: crypto.randomUUID(), name: f.name, data})
            }
            setImages(old => [...old, ...result]);
            setError('')
        } catch (e) {
            setError((e as Error).message)
        }
    }

    return <div className="input-panel">
        <form className="composer" onSubmit={e => {
            e.preventDefault();
            if (!busy && (text.trim() || images.length)) onSubmit(text, images)
        }} onPaste={e => {
        const files = [...e.clipboardData.items].filter(i => i.kind === 'file').map(i => i.getAsFile()!).filter(Boolean);
        if (files.length) {
            e.preventDefault();
            void add(files)
        }
    }}>
        <label className="field composer-field"><span className="sr-only">你的需求</span><textarea aria-label="需求描述" rows={4}
                 placeholder="描述你想完成的事，或粘贴需求与参考资料…"
                 onKeyDown={e => {if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {e.preventDefault(); e.currentTarget.form?.requestSubmit()}}}
                 value={text} onChange={e => setText(e.target.value)}/></label>
        {images.length > 0 && <div className="pictures">{images.map(i => <div key={i.id}><img src={i.data} alt={i.name}/>
            <button type="button" aria-label={'移除' + i.name} onClick={() => setImages(images.filter(x => x.id !== i.id))}>×</button>
            <small>{i.name}</small></div>)}</div>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="composer-toolbar">
        <div className="upload-row"><label className="button upload"><Icon name="image" size={17}/> <span>参考图片</span><input aria-label="添加参考图片" type="file"
                                                                                          accept="image/png,image/jpeg,image/webp,image/gif"
                                                                                          multiple onChange={e => {
            void add([...e.target.files || []]);
            e.target.value = ''
        }}/></label></div>
        <button type="submit" className="primary composer-submit" disabled={busy || (!text.trim() && !images.length)}
                aria-label={busy ? '正在提交…' : label}><span>{busy ? '正在提交…' : label}</span><Icon name="arrow" size={19}/></button>
        </div>
        </form>
        {!initial && <div className="starter-prompts" aria-label="需求灵感">{examples.map(example => <button type="button" key={example.title} disabled={busy} onClick={() => {setText(example.text); document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()}}><Icon name="plus" size={15}/>{example.title}</button>)}</div>}
    </div>
}
