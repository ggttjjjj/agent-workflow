import {useEffect, useState} from 'react';
import {api} from '../api';
import type {Settings} from '../../shared/domain';
import Dialog, {useConfirm} from './Dialog';

export default function SettingsPanel({onClose}: { onClose: () => void }) {
    const [s, setS] = useState<Settings>(), [defaults, setDefaults] = useState<Settings>(), [message, setMessage] = useState('');
    const [saved, setSaved] = useState(''), [tab, setTab] = useState('model'), [busy, setBusy] = useState(false);
    const ask = useConfirm();
    const close = async () => {
        if (busy) return;
        if (s && JSON.stringify(s) !== saved && !await ask('设置尚未保存，关闭后将放弃这些修改。', {title: '放弃设置修改？', confirmLabel: '放弃修改'})) return;
        onClose()
    };
    useEffect(() => {
        api<{ settings: Settings; defaults: Settings }>('/settings').then(x => {
            setS(x.settings);
            setSaved(JSON.stringify(x.settings));
            setDefaults(x.defaults)
        }).catch(e => setMessage(e.message))
    }, []);
    return <Dialog title="系统设置" description="配置模型与默认提示词，仅对后续新生成生效" className="settings-dialog" onClose={() => void close()}
        footer={<><span className="dialog-feedback" role="status">{message}</span><button disabled={!s || busy} onClick={() => {setS(defaults); setMessage('默认内容已填入，点击保存生效')}}>恢复默认内容</button>
            <button className="primary" disabled={!s || busy || JSON.stringify(s) === saved || !s.pmPrompt.trim() || !s.orchestratorPrompt.trim()} onClick={async () => {
                if (!s || busy) return; setBusy(true);
                try {await api('/settings', 'PUT', s); setSaved(JSON.stringify(s)); setMessage('设置已保存')}
                catch (e) {setMessage((e as Error).message)} finally {setBusy(false)}
            }}>{busy ? '保存中…' : '保存设置'}</button></>}>
        <div className="settings-layout"><nav className="settings-nav" aria-label="设置分类">
            <button aria-current={tab === 'model' ? 'page' : undefined} onClick={() => setTab('model')}>模型与思考强度</button>
            <button aria-current={tab === 'prompts' ? 'page' : undefined} onClick={() => setTab('prompts')}>默认提示词</button>
        </nav><div className="settings-content">
            {!s && <p role="status">{message || '正在加载设置…'}</p>}
            {s && <fieldset disabled={busy}><div hidden={tab !== 'model'}><h3>模型与思考强度</h3>
                <div className="model-band">deepseek-flash</div>
                <div
                    className="efforts">{(['pmEffort', 'orchestratorEffort', 'downstreamEffort'] as const).map((k, i) =>
                    <label className="field" key={k}>{['PM 思考强度', '编排器思考强度', '下游统一默认强度'][i]}<select
                        value={s[k]} onChange={e => setS({...s, [k]: e.target.value})}>{['low', 'high', 'max'].map(x =>
                        <option key={x}>{x}</option>)}</select></label>)}</div>
                </div><div hidden={tab !== 'prompts'}><h3>默认提示词</h3><p>分别配置需求分析与编排阶段的默认行为。</p>
                {(['pmPrompt', 'orchestratorPrompt'] as const).map((k, i) => <label className="field"
                                                                                    key={k}>{i ? '编排器默认提示词' : 'PM 默认提示词'}<textarea
                    rows={6} value={s[k]} onChange={e => setS({...s, [k]: e.target.value})}/></label>)}
                </div></fieldset>}
        </div></div>
    </Dialog>
}
