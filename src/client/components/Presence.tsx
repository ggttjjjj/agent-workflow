import {createContext, useContext, useLayoutEffect, useState, type ReactNode} from 'react';

const ExitContext = createContext(false);
export const useExiting = () => useContext(ExitContext);

// Keep the last rendered content alive while its exit transition finishes.
// Portals receive the same state through context, without moving focus early.
export default function Presence({children}: {children: ReactNode}) {
    const visible = children !== null && children !== undefined && children !== false && children !== '';
    const [retained, setRetained] = useState<ReactNode>(visible ? children : null);
    useLayoutEffect(() => {
        if (visible) {setRetained(children); return}
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {setRetained(null); return}
        const timer = window.setTimeout(() => setRetained(null), 160);
        return () => window.clearTimeout(timer)
    }, [children, visible]);
    return <ExitContext.Provider value={!visible}>
        <div className="presence" data-exiting={!visible || undefined}>{visible ? children : retained}</div>
    </ExitContext.Provider>
}
