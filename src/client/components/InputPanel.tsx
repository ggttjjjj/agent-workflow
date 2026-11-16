import {useState} from 'react';
import type {Picture, Requirement} from '../../shared/domain';

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

    return <div className="input-panel" onPaste={e => {
        const files = [...e.clipboardData.items].filter(i => i.kind === 'file').map(i => i.getAsFile()!).filter(Boolean);
        if (files.length) {
            e.preventDefault();
            void add(files)
        }
    }}>
        <label className="field">你的需求<textarea aria-label="需求描述" rows={8}
                                                                 placeholder="描述你的目标、交付物和约束。例如：为社区策划一场90分钟的亲子阅读活动，需要活动流程、场地安排和预算方案。"
                                                                 value={text} onChange={e => setText(e.target.value)}/></label>
        <div className="upload-row"><label className="button upload">＋ 添加参考图片<input type="file"
                                                                                          accept="image/png,image/jpeg,image/webp,image/gif"
                                                                                          multiple onChange={e => {
            void add([...e.target.files || []]);
            e.target.value = ''
        }}/></label><span>也可直接粘贴图片 · 最多12张</span></div>
        <div className="pictures">{images.map(i => <div key={i.id}><img src={i.data} alt={i.name}/>
            <button aria-label={'移除' + i.name} onClick={() => setImages(images.filter(x => x.id !== i.id))}>×</button>
            <small>{i.name}</small></div>)}</div>
        {error && <p role="alert" className="error">{error}</p>}<p className="hint">文本与图片将发送给 DeepSeek
        分析。</p>
        <button className="primary" disabled={busy || (!text.trim() && !images.length)}
                onClick={() => onSubmit(text, images)}>{busy ? '正在提交…' : label + ' →'}</button>
    </div>
}
