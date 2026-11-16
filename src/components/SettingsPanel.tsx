import {useEffect, useState} from 'react';
import {api} from '../api';
import type {Settings} from '../../shared/domain';

export default function SettingsPanel({onClose}: { onClose: () => void }) {
    const [s, setS] = useState<Settings>(), [defaults, setDefaults] = useState<Settings>(), [message, setMessage] = useState('');
    useEffect(() => {
        api<{ settings: Settings; defaults: Settings }>('/settings').then(x => {
            setS(x.settings);
            setDefaults(x.defaults)
        }).catch(e => setMessage(e.message))
    }, []);
    return <div className="modal-back">
        <section className="modal settings">
            <header>
                <div><h2>模型与提示词设置</h2><p>新生成生效 · 正在进行的请求保持原设置</p></div>
                <button onClick={onClose} aria-label="关闭设置">×</button>
            </header>
            {s && <>
                <div className="model-band">deepseek-flash <span>思考模式开启 · 密钥仅在后端 .env 配置</span></div>
                <div
                    className="efforts">{(['pmEffort', 'orchestratorEffort', 'downstreamEffort'] as const).map((k, i) =>
                    <label className="field" key={k}>{['PM 思考强度', '编排器思考强度', '下游统一默认强度'][i]}<select
                        value={s[k]} onChange={e => setS({...s, [k]: e.target.value})}>{['low', 'high', 'max'].map(x =>
                        <option key={x}>{x}</option>)}</select></label>)}</div>
                {(['pmPrompt', 'orchestratorPrompt'] as const).map((k, i) => <label className="field"
                                                                                    key={k}>{i ? '编排器默认提示词' : 'PM 默认提示词'}<textarea
                    rows={6} value={s[k]} onChange={e => setS({...s, [k]: e.target.value})}/></label>)}
                <footer>
                    <button onClick={() => {
                        setS(defaults);
                        setMessage('默认内容已填入，点击保存生效')
                    }}>恢复默认内容
                    </button>
                    <button className="primary"
                            onClick={() => api('/settings', 'PUT', s).then(() => setMessage('设置已保存')).catch(e => setMessage(e.message))}>保存设置
                    </button>
                </footer>
            </>}<p role="status">{message}</p></section>
    </div>
}
