import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const P = {
  api: 'M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4',
  transfer: 'M7 20V5M3 9l4-4 4 4M17 4v15M13 15l4 4 4-4',
  mock: 'M6 20V10a6 6 0 0112 0v10l-2.5-2-2 2L12 18l-1.5 2-2-2zM10 11h.01M14 11h.01',
  pulse: 'M4 12h4l2-6 4 12 2-6h4',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  collapse: 'M7 9l5-5 5 5M7 15l5 5 5-5', panel: 'M3 5h18v14H3zM9 5v14', expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5', chevl: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  send: 'M4 12l16-8-6 17-3-7z', save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v2l-2 1 1 3 2-.5L7.5 19l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
  term: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h4', db: 'M5 6c0-1.5 3-3 7-3s7 1.5 7 3-3 3-7 3-7-1.5-7-3zM5 6v12c0 1.5 3 3 7 3s7-1.5 7-3V6M5 12c0 1.5 3 3 7 3s7-1.5 7-3',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01', sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14A8 8 0 1110 4a7 7 0 0010 10z', copy: 'M9 9h11v11H9zM5 15V5h10', download: 'M12 3v12M7 10l5 5 5-5M5 20h14', upload: 'M12 17V5M7 10l5-5 5 5M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', chev: 'M9 6l6 6-6 6', chevd: 'M6 9l6 6 6-6', play: 'M7 4l13 8-13 8z', search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  logout: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9', hist: 'M3 12a9 9 0 109-9 9 9 0 00-7 3.5M3 4v4h4M12 8v4l3 2', code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16', check: 'M5 12l5 5 9-10',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10', globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
};
const BIG = new Set(['0,3', '1,2', '2,1', '3,0', '1,0', '2,0', '3,1', '3,2']);
export const Logo = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 64 64" style={{ flex: 'none' }}>
    {[0, 1, 2, 3].flatMap(i => [0, 1, 2, 3].map(j => { const b = BIG.has(i + ',' + j); return <circle key={i + ',' + j} cx={11 + 14 * i} cy={11 + 14 * j} r={b ? 5.6 : 2.6} fill={b ? 'var(--brand)' : 'var(--muted)'} opacity={b ? 1 : 0.7} />; }))}
  </svg>
);
export const Icon = ({ n, s = 16, c }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={P[n]} /></svg>
);

/* toasts */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((msg, kind = 'info') => {
    const id = Math.random();
    setList(l => [...l.slice(-3), { id, msg, kind }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts">{list.map(t => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}</div></ToastCtx.Provider>;
}

export function Modal({ title, onClose, children, footer, wide, expandable }) {
  const [full, setFull] = useState(false);
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '') + (full ? ' full' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><span className="grow">{title}</span>{expandable && <button className="icon-btn" onClick={() => setFull(!full)} aria-label={full ? 'Shrink window' : 'Expand window'} title={full ? 'Shrink window' : 'Expand window'}><Icon n={full ? 'shrink' : 'expand'} /></button>}<button className="icon-btn" onClick={onClose} aria-label="Close"><Icon n="x" /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="tabs" role="tablist">
    {tabs.map(t => <button key={t.id} role="tab" aria-selected={value === t.id} className={'tab' + (value === t.id ? ' active' : '')} onClick={() => onChange(t.id)}>
      {t.label}{t.badge ? <span className="badge">{t.badge}</span> : null}{t.dot ? <span className="dot" /> : null}</button>)}
  </div>
);

/* HTTP method picker: custom menu so every verb keeps its colour on every OS */
export function MethodSelect({ value, onChange, methods }) {
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { if (!open) return; const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); }; const k = (e) => e.key === 'Escape' && setOpen(false); addEventListener('mousedown', h); addEventListener('keydown', k); return () => { removeEventListener('mousedown', h); removeEventListener('keydown', k); }; }, [open]);
  return (
    <div className="mpick" ref={ref}>
      <button type="button" className={'btn m-' + value} aria-haspopup="listbox" aria-expanded={open} aria-label="Method" onClick={() => setOpen(o => !o)}>{value}<Icon n="chevd" s={12} c="var(--muted)" /></button>
      {open && <div className="mpick-menu" role="listbox">{methods.map(m => <button key={m} role="option" aria-selected={m === value} className={'m-' + m + (m === value ? ' on' : '')} onClick={() => { onChange(m); setOpen(false); }}>{m}</button>)}</div>}
    </div>);
}

/* key/value editor (params, headers, form fields).
   The last, empty row is only a placeholder: it has no checkbox/delete until you type in it, so
   unticking or clearing rows never leaves a stray ticked row behind. Every real row can be removed. */
export function KVEditor({ rows, onChange, keyPh = 'Key', valPh = 'Value', secretValues }) {
  const edit = (i, patch) => onChange(i >= rows.length ? [...rows, { key: '', value: '', enabled: true, ...patch }] : rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  const list = [...rows, null]; // null = the placeholder row; same React key as the row it becomes, so typing keeps focus
  return (
    <table className="kv"><thead><tr><th></th><th>{keyPh}</th><th>{valPh}</th>{secretValues && <th style={{ width: 30 }}></th>}<th></th></tr></thead>
      <tbody>{list.map((r, i) => r ? (
        <tr key={i} className={r.enabled === false ? 'off' : ''}>
          <td className="chk"><input type="checkbox" checked={r.enabled !== false} onChange={(e) => edit(i, { enabled: e.target.checked })} aria-label="enabled" /></td>
          <td><input value={r.key} placeholder={keyPh} spellCheck={false} onChange={(e) => edit(i, { key: e.target.value })} /></td>
          <td><input value={r.value} type={secretValues && r.secret ? 'password' : 'text'} placeholder={valPh} spellCheck={false} onChange={(e) => edit(i, { value: e.target.value })} /></td>
          {secretValues && <td className="del">{(r.key || r.value) && <button className="icon-btn" title={r.secret ? 'Secret (masked): click to reveal' : 'Mask this value'} aria-label="toggle secret" onClick={() => edit(i, { secret: !r.secret })}><Icon n="lock" s={13} c={r.secret ? 'var(--accent2)' : undefined} /></button>}</td>}
          <td className="del"><button className="icon-btn" title="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="remove"><Icon n="x" s={13} /></button></td>
        </tr>) : (
        <tr key={i} className="ph">
          <td className="chk"><input type="checkbox" disabled checked={false} aria-hidden="true" tabIndex={-1} /></td>
          <td><input value="" placeholder={keyPh} spellCheck={false} aria-label={keyPh + ' (new row)'} onChange={(e) => edit(i, { key: e.target.value })} /></td>
          <td><input value="" type="text" placeholder={valPh} spellCheck={false} aria-label={valPh + ' (new row)'} onChange={(e) => edit(i, { value: e.target.value })} /></td>
          {secretValues && <td className="del" />}<td className="del" />
        </tr>))}
      </tbody></table>
  );
}

/* tiny, fast JSON highlighter (no dependency) */
export function highlightJson(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc(text).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, str, colon, lit) => str ? (colon ? `<span class="tok-k">${str}</span>${colon}` : `<span class="tok-s">${str}</span>`) : lit ? `<span class="tok-b">${m}</span>` : `<span class="tok-n">${m}</span>`);
}

export function useContextMenu() {
  const [menu, setMenu] = useState(null);
  useEffect(() => { if (!menu) return; const h = () => setMenu(null); addEventListener('click', h); addEventListener('blur', h); addEventListener('scroll', h, true); return () => { removeEventListener('click', h); removeEventListener('blur', h); removeEventListener('scroll', h, true); }; }, [menu]);
  const el = menu && (
    <div className="ctx" style={{ left: Math.min(menu.x, innerWidth - 190), top: Math.max(4, Math.min(menu.y, innerHeight - menu.items.length * 30 - 20)) }} onClick={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => it === '-' ? <hr key={i} /> : it.sub ? (
        <div key={i} className="has-sub"><button disabled={it.disabled}>{it.label}<span style={{ float: 'right', opacity: .6 }}>›</span></button>
          <div className={'ctx ctx-sub' + (menu.x > innerWidth - 400 ? ' flip' : '')}>{it.sub.map((s, j) => s === '-' ? <hr key={j} /> : <button key={j} disabled={s.disabled} onClick={() => { setMenu(null); s.run(); }}>{s.checked ? '✓ ' : '\u00a0\u00a0 '}{s.label}</button>)}</div></div>
      ) : <button key={i} disabled={it.disabled} onClick={() => { setMenu(null); it.run(); }}>{it.label}</button>)}
    </div>);
  return [(e, items) => { e.preventDefault(); e.stopPropagation?.(); setMenu({ x: e.clientX, y: e.clientY, items }); }, el];
}

export function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/* Side panel that can be dragged to any width (240-700 px), hidden with Ctrl+B and remembered between sessions. */
export function useSidePanel(key, def = 290, active = true) {
  const kw = 'dh.sideW.' + key, kc = 'dh.sideC.' + key;
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const [w, setW] = useState(() => { let n = 0; try { n = Number(localStorage.getItem(kw)); } catch { /* */ } return n >= 240 && n <= 700 ? n : def; });
  const [c, setC] = useState(() => { let v = null; try { v = localStorage.getItem(kc); } catch { /* */ } return v === null ? innerWidth < 780 : v === '1'; });
  const toggle = useCallback(() => setC(x => { save(kc, x ? '0' : '1'); return !x; }), [kc]);
  useEffect(() => {
    if (!active) return;
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggle(); } };
    addEventListener('keydown', h); return () => removeEventListener('keydown', h);
  }, [active, toggle]);
  const clamp = (n) => Math.round(Math.min(Math.max(240, n), Math.min(700, innerWidth * 0.7)));
  const startDrag = (e) => {
    e.preventDefault(); const x0 = e.clientX, w0 = w; let last = w; document.body.classList.add('resizing-x');
    const mv = (ev) => { last = clamp(w0 + ev.clientX - x0); setW(last); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); document.body.classList.remove('resizing-x'); save(kw, String(last)); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const n = clamp(w + (e.key === 'ArrowRight' ? 16 : -16)); setW(n); save(kw, String(n)); }
    else if (e.key === 'Enter') toggle();
  };
  return { w, collapsed: c, toggle, startDrag, onKey };
}
export const SideResizer = ({ p }) => <div className="side-resizer" onMouseDown={p.startDrag} onDoubleClick={p.toggle} onKeyDown={p.onKey} tabIndex={0} role="separator" aria-orientation="vertical" aria-label="Resize side panel" title="Drag to resize · double-click to hide" />;
export const SideRestore = ({ p }) => <div className="side-collapsed"><button className="icon-btn" onClick={p.toggle} title="Show side panel (Ctrl+B)" aria-label="Show side panel"><Icon n="panel" /></button></div>;

export const Spinner = () => <span className="spin" role="status" aria-label="Loading" />;
export const ModuleLoading = () => <div className="empty"><div className="col" style={{ gap: 10, alignItems: 'center' }}><Spinner /><span>Loading module…</span></div></div>;
