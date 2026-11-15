import { useState, useCallback, useRef } from 'react';
import { Modal } from './ui.jsx';

/* Promise-based prompt / confirm dialogs (no blocking window.prompt) */
export function useDialogs() {
  const [d, setD] = useState(null);
  const resolver = useRef(null);
  const close = useCallback((v) => { resolver.current?.(v); resolver.current = null; setD(null); }, []);
  const prompt = useCallback((title, initial = '', placeholder = '') => new Promise(res => { resolver.current = res; setD({ kind: 'prompt', title, initial, placeholder }); }), []);
  const confirm = useCallback((title, body, danger = true) => new Promise(res => { resolver.current = res; setD({ kind: 'confirm', title, body, danger }); }), []);
  const el = d && <DialogView d={d} onClose={close} />;
  return { prompt, confirm, el };
}

function DialogView({ d, onClose }) {
  const [v, setV] = useState(d.initial || '');
  if (d.kind === 'confirm') return (
    <Modal title={d.title} onClose={() => onClose(false)} footer={<><button className="btn" onClick={() => onClose(false)}>Cancel</button><button autoFocus className={'btn ' + (d.danger ? 'danger' : 'primary')} onClick={() => onClose(true)}>Confirm</button></>}>
      <div>{d.body}</div>
    </Modal>);
  return (
    <Modal title={d.title} onClose={() => onClose(null)} footer={<><button className="btn" onClick={() => onClose(null)}>Cancel</button><button className="btn primary" disabled={!v.trim()} onClick={() => onClose(v.trim())}>OK</button></>}>
      <input autoFocus style={{ width: '100%' }} value={v} placeholder={d.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && onClose(v.trim())} onFocus={(e) => e.target.select()} />
    </Modal>);
}
