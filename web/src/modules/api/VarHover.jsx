import { useEffect, useRef, useState } from 'react';
import { Icon, useToast } from '../../ui.jsx';

/* Hover a {{variable}} anywhere in the request editor: see its current value, change it, or define it.
   Works over plain <input>/<textarea>: a hidden mirror element (same font, padding, wrapping and scroll) tells which token is under the pointer. */
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'textIndent', 'tabSize', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'textAlign'];

export function tokenAt(el, x, y) {
  const text = el.value; if (!text || !text.includes('{{')) return null;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el), m = document.createElement('div'), st = m.style, multi = el.tagName === 'TEXTAREA';
  for (const k of COPY) st[k] = cs[k];
  const bw = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  Object.assign(st, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: (el.clientWidth + bw) + 'px', height: r.height + 'px', boxSizing: 'border-box', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none', borderStyle: 'solid', borderColor: 'transparent', whiteSpace: multi ? 'pre-wrap' : 'pre', overflowWrap: multi ? 'break-word' : 'normal', wordBreak: 'normal' });
  let last = 0;
  text.replace(TOKEN, (all, name, idx) => { m.append(text.slice(last, idx)); const sp = document.createElement('span'); sp.textContent = all; sp.dataset.name = name; m.append(sp); last = idx + all.length; return all; });
  m.append(text.slice(last));
  document.body.append(m); m.scrollLeft = el.scrollLeft; m.scrollTop = el.scrollTop;
  let hit = null;
  for (const sp of m.querySelectorAll('span')) {
    for (const q of sp.getClientRects()) if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) { hit = { name: sp.dataset.name, rect: { left: q.left, right: q.right, top: q.top, bottom: q.bottom } }; break; }
    if (hit) break;
  }
  m.remove(); return hit;
}

export default function VarHover({ active, lookup, save, hasEnv, envName }) {
  const [pop, setPop] = useState(null);
  const openT = useRef(0), closeT = useRef(0), cur = useRef(''), popRef = useRef(null);
  const keepOpen = () => popRef.current && popRef.current.contains(document.activeElement);
  const scheduleClose = () => { clearTimeout(openT.current); clearTimeout(closeT.current); closeT.current = setTimeout(() => { if (!keepOpen()) { cur.current = ''; setPop(null); } }, 320); };

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const mv = (e) => {
      if (raf) return; const { clientX: x, clientY: y, target } = e;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (target.closest?.('.var-pop')) return;
        const ok = (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.type !== 'password' && target.closest('.split-v');
        const hit = ok ? tokenAt(target, x, y) : null;
        if (!hit) { if (cur.current) scheduleClose(); else clearTimeout(openT.current); return; }
        const key = hit.name + '@' + Math.round(hit.rect.left) + ',' + Math.round(hit.rect.top);
        clearTimeout(closeT.current);
        if (key === cur.current) return;
        cur.current = key; clearTimeout(openT.current);
        openT.current = setTimeout(() => setPop({ key, name: hit.name, rect: hit.rect }), 260);
      });
    };
    const esc = (e) => { if (e.key === 'Escape') { cur.current = ''; setPop(null); } };
    addEventListener('mousemove', mv, { passive: true }); addEventListener('keydown', esc);
    return () => { removeEventListener('mousemove', mv); removeEventListener('keydown', esc); cancelAnimationFrame(raf); clearTimeout(openT.current); clearTimeout(closeT.current); };
  }, [active]); // eslint-disable-line
  useEffect(() => { if (!active) setPop(null); }, [active]);
  if (!pop) return null;
  return <Pop key={pop.key} pop={pop} lookup={lookup} save={save} hasEnv={hasEnv} envName={envName} popRef={popRef}
    onEnter={() => clearTimeout(closeT.current)} onLeave={scheduleClose} onClose={() => { cur.current = ''; setPop(null); }} />;
}

function Pop({ pop, lookup, save, hasEnv, envName, popRef, onEnter, onLeave, onClose }) {
  const toast = useToast();
  const name = pop.name, dyn = name.startsWith('$'), info = lookup(name);
  const [val, setVal] = useState(info.value ?? ''); const [show, setShow] = useState(false);
  const [scope, setScope] = useState(hasEnv ? 'env' : 'global');
  const left = Math.max(8, Math.min(pop.rect.left, innerWidth - 340)); const below = pop.rect.bottom + 6; const flip = below + 190 > innerHeight;
  const go = () => { const sc = info.scope || scope; save(name, val, sc); toast(`${'{{' + name + '}}'} saved in ${sc === 'env' ? (info.scope ? info.label : envName) : 'Globals'}`, 'success'); onClose(); };
  const changed = val !== (info.value ?? '') || !info.scope;
  return (
    <div className="var-pop" ref={popRef} style={{ left, ...(flip ? { bottom: innerHeight - pop.rect.top + 6 } : { top: below }) }} role="dialog" aria-label={`Variable ${name}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="row" style={{ gap: 8 }}><code className="mono grow ellipsis" title={name}>{'{{' + name + '}}'}</code>
        <span className={'chip ' + (dyn ? 's3' : info.scope ? 'ok' : 's4')}>{dyn ? 'dynamic' : info.scope ? info.label : 'not defined'}</span></div>
      {dyn ? <p className="muted" style={{ margin: '8px 0 0' }}>A built-in value generated fresh each time the request is sent.</p> : <>
        <label className="muted" style={{ fontSize: 11.5, display: 'block', margin: '8px 0 3px' }}>{info.scope ? 'Current value' : 'Set a value'}</label>
        <div className="row" style={{ gap: 4 }}>
          <input className="grow mono" type={info.secret && !show ? 'password' : 'text'} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && changed) go(); }} spellCheck={false} aria-label={`Value of ${name}`} />
          {info.secret && <button className="icon-btn" title={show ? 'Hide' : 'Show'} aria-label={show ? 'Hide value' : 'Show value'} onClick={() => setShow(!show)}><Icon n="lock" s={13} /></button>}
        </div>
        {!info.scope && <label className="row" style={{ gap: 6, marginTop: 8, fontSize: 12 }}><span className="muted">Save in</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Where to save">{hasEnv && <option value="env">{envName}</option>}<option value="global">Globals</option></select></label>}
        <div className="row" style={{ marginTop: 8, gap: 8 }}><span className="muted grow" style={{ fontSize: 11.5 }}>{info.scope === 'global' ? 'Applies to every request' : info.scope ? 'Active environment' : 'Used when the request is sent'}</span>
          <button className="btn sm primary" disabled={!changed} onClick={go}>{info.scope ? 'Update' : 'Save'}</button></div></>}
    </div>);
}
