import {createContext, useContext, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useExiting} from './Presence';

const NoticeViewport = createContext<HTMLDivElement | null>(null);

export function NoticeProvider({children}: {children: ReactNode}) {
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
    return <NoticeViewport.Provider value={viewport}>
        {children}
        <div className="notice-viewport" ref={setViewport} aria-label="消息通知"/>
    </NoticeViewport.Provider>
}

export default function FloatingNotice({children, onClose, tone = 'info'}: {
    children: ReactNode;
    onClose: () => void;
    tone?: 'info' | 'error' | 'success';
}) {
    const viewport = useContext(NoticeViewport);
    const exiting = useExiting();
    if (!viewport) return null;
    return createPortal(<div className={`floating-notice ${tone}`} data-exiting={exiting || undefined} role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true">
        <span className="notice-indicator" aria-hidden="true">{tone === 'error' ? '!' : tone === 'success' ? '✓' : 'i'}</span>
        <div className="notice-content">{children}</div>
        <button className="notice-close" aria-label="关闭提示" onClick={onClose}>×</button>
    </div>, viewport)
}
