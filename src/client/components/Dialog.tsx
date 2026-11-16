import {createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import Presence, {useExiting} from './Presence';

const layers: symbol[] = [];
const focusable = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
export const dialogIsOpen = () => layers.length > 0;

export function ModalLayer({children, onClose}: {children: ReactNode; onClose: () => void}) {
    const exiting = useExiting();
    const host = useRef<HTMLDivElement>(null), close = useRef(onClose);
    close.current = onClose;
    useLayoutEffect(() => {
        const token = Symbol(), previous = document.activeElement as HTMLElement | null;
        const root = document.getElementById('root'), oldOverflow = document.body.style.overflow;
        layers.push(token);
        document.body.style.overflow = 'hidden';
        if (root) root.inert = true;
        const element = host.current!;
        element.style.zIndex = String(200 + layers.length * 2);
        const panel = element.querySelector<HTMLElement>('section') || element;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.tabIndex = -1;
        const heading = panel.querySelector('h2');
        if (heading && !panel.hasAttribute('aria-label') && !panel.hasAttribute('aria-labelledby')) {
            heading.id ||= `dialog-heading-${crypto.randomUUID()}`;
            panel.setAttribute('aria-labelledby', heading.id)
        }
        const controls = () => Array.from(element.querySelectorAll<HTMLElement>(focusable)).filter(e => e.getClientRects().length > 0 && !e.closest('[hidden]'));
        (element.querySelector<HTMLElement>('[autofocus]') || controls()[0] || panel).focus();
        const key = (event: KeyboardEvent) => {
            if (layers.at(-1) !== token) return;
            if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); close.current(); return}
            if (event.key !== 'Tab') return;
            const items = controls(), first = items[0], last = items.at(-1);
            if (!first) {event.preventDefault(); panel.focus()}
            else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {event.preventDefault(); last!.focus()}
            else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {event.preventDefault(); first.focus()}
        };
        const focus = (event: FocusEvent) => {
            if (layers.at(-1) === token && !element.contains(event.target as Node)) (controls()[0] || panel).focus()
        };
        document.addEventListener('keydown', key, true);
        document.addEventListener('focusin', focus);
        window.dispatchEvent(new Event('weave-dialog-change'));
        return () => {
            document.removeEventListener('keydown', key, true);
            document.removeEventListener('focusin', focus);
            layers.splice(layers.indexOf(token), 1);
            if (!layers.length) {document.body.style.overflow = ''; if (root) root.inert = false}
            else document.body.style.overflow = oldOverflow;
            if (previous?.isConnected && !previous.closest('[inert]')) previous.focus();
            window.dispatchEvent(new Event('weave-dialog-change'))
        }
    }, []);
    return createPortal(<div ref={host} className="modal-back dialog-layer" data-exiting={exiting || undefined}>{children}</div>, document.body)
}

export default function Dialog({title, description, children, footer, onClose, className = ''}: {
    title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; className?: string
}) {
    const titleId = useId();
    return <ModalLayer onClose={onClose}><section className={`modal app-dialog ${className}`} aria-labelledby={titleId}>
        <header className="dialog-header"><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div>
            <button className="dialog-close" onClick={onClose} aria-label="关闭弹窗">×</button></header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
    </section></ModalLayer>
}

type ConfirmOptions = {title?: string; confirmLabel?: string; danger?: boolean};
type Ask = (message: string, options?: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);
export const useConfirm = () => {
    const ask = useContext(ConfirmContext);
    if (!ask) throw new Error('Confirmation provider is missing');
    return ask
};

export function ConfirmProvider({children}: {children: ReactNode}) {
    const [request, setRequest] = useState<{message: string; options: ConfirmOptions; resolve: (value: boolean) => void}>();
    const pending = useRef(false);
    const ask: Ask = (message, options = {}) => new Promise(resolve => {
        if (pending.current) {resolve(false); return}
        pending.current = true; setRequest({message, options, resolve})
    });
    const finish = (value: boolean) => {request?.resolve(value); pending.current = false; setRequest(undefined)};
    return <ConfirmContext.Provider value={ask}>{children}<Presence>{request && <Dialog className="confirm-dialog"
        title={request.options.title || '请确认操作'} onClose={() => finish(false)}
        footer={<><button onClick={() => finish(false)}>取消</button><button className={request.options.danger ? 'danger-solid' : 'primary'} onClick={() => finish(true)}>{request.options.confirmLabel || '确认继续'}</button></>}>
        <p>{request.message}</p>
    </Dialog>}</Presence></ConfirmContext.Provider>
}
