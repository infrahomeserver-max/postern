import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Icon, useContextMenu } from '../../ui.jsx';
import { fmtBytes, fmtDate } from '../../api.js';

const ROW = 26;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* Windowed list: only the rows in view are in the DOM, so 100k-entry directories stay smooth. */
export default function Pane({ kind, title, path, items, loading, error, onGo, onAction, onDropItems, onDropFiles, menuFor, selection, setSelection, onStatus }) {
  const [sort, setSort] = useState({ by: 'name', dir: 1 });
  const [scroll, setScroll] = useState(0); const [h, setH] = useState(400);
  const [filter, setFilter] = useState(''); const [addr, setAddr] = useState(path); const [over, setOver] = useState(false);
  const box = useRef(); const last = useRef(null);
  const [ctx, ctxEl] = useContextMenu();

  useEffect(() => setAddr(path), [path]);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setH(el.clientHeight)); ro.observe(el); setH(el.clientHeight); return () => ro.disconnect(); }, []);
  useEffect(() => { if (box.current) box.current.scrollTop = 0; setFilter(''); }, [path]);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (items || []).filter(i => !f || i.name.toLowerCase().includes(f));
    const k = sort.by, d = sort.dir;
    return list.sort((a, b) => {
      if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
      const r = k === 'name' ? collator.compare(a.name, b.name) : (a[k] ?? 0) - (b[k] ?? 0);
      return r * d;
    });
  }, [items, sort, filter]);

  const start = Math.max(0, Math.floor(scroll / ROW) - 8), end = Math.min(rows.length, Math.ceil((scroll + h) / ROW) + 8);
  const sel = selection;
  const click = (e, it, i) => {
    let n = new Set(sel);
    if (e.shiftKey && last.current != null) { n = new Set(); const [a, b] = [Math.min(last.current, i), Math.max(last.current, i)]; for (let j = a; j <= b; j++) n.add(rows[j].name); }
    else if (e.ctrlKey || e.metaKey) { n.has(it.name) ? n.delete(it.name) : n.add(it.name); last.current = i; }
    else { n = new Set([it.name]); last.current = i; }
    setSelection(n);
  };
  const selected = rows.filter(r => sel.has(r.name));
  useEffect(() => { onStatus?.({ count: rows.length, selected: selected.length, bytes: selected.reduce((a, b) => a + (b.type === 'file' ? b.size : 0), 0) }); }, [rows.length, sel]); // eslint-disable-line

  const open = (it) => it.type === 'dir' ? onGo(join(path, it.name)) : onAction('dblclick', [it]);
  const keys = (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter' && selected.length === 1) open(selected[0]);
    else if (e.key === 'Delete' && selected.length) onAction('delete', selected);
    else if (e.key === 'F2' && selected.length === 1) onAction('rename', selected);
    else if (e.key === 'Backspace') onGo(parent(path));
    else if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); setSelection(new Set(rows.map(r => r.name))); }
    else if (e.key === 'F5') { e.preventDefault(); onAction('refresh', []); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); const i = rows.findIndex(r => r.name === [...sel].pop()); const n = Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (rows[n]) { setSelection(new Set([rows[n].name])); last.current = n; const el = box.current; if (n * ROW < el.scrollTop) el.scrollTop = n * ROW; else if ((n + 1) * ROW > el.scrollTop + h) el.scrollTop = (n + 1) * ROW - h; }
    }
  };
  const sortBy = (by) => setSort(s => ({ by, dir: s.by === by ? -s.dir : 1 }));
  const arrow = (by) => sort.by === by ? (sort.dir > 0 ? ' ▲' : ' ▼') : '';

  const dragStart = (e, it) => {
    const names = sel.has(it.name) ? [...sel] : [it.name];
    if (!sel.has(it.name)) setSelection(new Set([it.name]));
    e.dataTransfer.setData('application/x-devhub', JSON.stringify({ kind, path, names }));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const drop = (e) => {
    e.preventDefault(); setOver(false);
    const raw = e.dataTransfer.getData('application/x-devhub');
    if (raw) { const d = JSON.parse(raw); if (d.kind !== kind) onDropItems(d); }
    else if (e.dataTransfer.files?.length && onDropFiles) onDropFiles([...e.dataTransfer.files]);
  };

  return (
    <div className={'pane' + (over ? ' dropping' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }} onDrop={drop}>
      <div className="pane-bar">
        <span className="chip" style={{ maxWidth: 150 }}><span className="ellipsis">{title}</span></span>
        <button className="icon-btn" title="Parent folder" onClick={() => onGo(parent(path))} disabled={path === '/'} aria-label="Parent folder"><Icon n="up" s={15} /></button>
        <button className="icon-btn" title="Refresh (F5)" onClick={() => onAction('refresh', [])} aria-label="Refresh"><Icon n="refresh" s={15} /></button>
        <input className="grow mono" style={{ padding: '4px 8px', fontSize: 12 }} value={addr} onChange={(e) => setAddr(e.target.value)} aria-label={title + ' path'}
          onKeyDown={(e) => e.key === 'Enter' && onGo(addr || '/')} onBlur={() => setAddr(path)} spellCheck={false} />
        <button className="icon-btn" title="New folder" onClick={() => onAction('mkdir', [])} aria-label="New folder"><Icon n="plus" s={15} /></button>
      </div>
      <div className="pane-bar" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {kind === 'remote' ? <>
          <button className="btn sm" disabled={!selected.length} onClick={() => onAction('download', selected)}><Icon n="download" s={13} />Download</button>
          <button className="btn sm" onClick={() => onAction('uploadPick', [])}><Icon n="upload" s={13} />Upload</button></>
          : <button className="btn sm" disabled={!selected.length} onClick={() => onAction('upload', selected)}><Icon n="upload" s={13} />Upload →</button>}
        <button className="btn sm" disabled={selected.length !== 1} onClick={() => onAction('rename', selected)}><Icon n="edit" s={13} />Rename</button>
        <button className="btn sm danger" disabled={!selected.length} onClick={() => onAction('delete', selected)}><Icon n="trash" s={13} />Delete</button>
        <span className="grow" />
        <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 110, padding: '3px 8px', fontSize: 12 }} aria-label="Filter files" />
      </div>
      <div className="fl-head"><span onClick={() => sortBy('name')}>Name{arrow('name')}</span><span onClick={() => sortBy('size')} style={{ textAlign: 'right' }}>Size{arrow('size')}</span><span onClick={() => sortBy('mtime')}>Modified{arrow('mtime')}</span><span>{kind === 'remote' ? 'Perms' : ''}</span></div>
      <div ref={box} tabIndex={0} onKeyDown={keys} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} style={{ flex: 1, overflow: 'auto', position: 'relative', outline: 'none' }}
        onContextMenu={(e) => { if (e.target === e.currentTarget || e.target.dataset.fill) ctx(e, menuFor(null, [])); }} onClick={(e) => { if (e.target === e.currentTarget || e.target.dataset.fill) setSelection(new Set()); }}>
        {loading && !items && [...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: 16, margin: '5px 10px', width: `${40 + (i * 13) % 50}%` }} />)}
        {error && <div className="empty" role="alert"><div><div className="chip err" style={{ marginBottom: 8 }}>{error}</div></div></div>}
        {!error && items && !rows.length && <div className="empty">{filter ? 'No matches' : 'This folder is empty'}</div>}
        <div data-fill="1" style={{ height: rows.length * ROW, position: 'relative', opacity: loading && items ? 0.55 : 1, transition: 'opacity .15s' }}>
          {rows.slice(start, end).map((it, k) => {
            const i = start + k;
            return (
              <div key={it.name} className={'fl-row' + (sel.has(it.name) ? ' sel' : '')} style={{ top: i * ROW }} draggable onDragStart={(e) => dragStart(e, it)}
                onClick={(e) => click(e, it, i)} onDoubleClick={() => open(it)}
                onContextMenu={(e) => { if (!sel.has(it.name)) setSelection(new Set([it.name])); ctx(e, menuFor(it, sel.has(it.name) ? selected : [it])); }}>
                <span className="row ellipsis" style={{ gap: 7 }}><Icon n={it.type === 'dir' ? 'folder' : it.link ? 'link' : 'file'} s={14} c={it.type === 'dir' ? 'var(--warn)' : 'var(--muted)'} /><span className="ellipsis" title={it.name}>{it.name}</span></span>
                <span className="muted" style={{ textAlign: 'right' }}>{it.type === 'file' ? fmtBytes(it.size) : ''}</span>
                <span className="muted ellipsis">{fmtDate(it.mtime)}</span>
                <span className="muted mono" style={{ fontSize: 11 }}>{it.perm}</span>
              </div>);
          })}
        </div>
      </div>
      {ctxEl}
    </div>
  );
}

export const join = (a, b) => (a.endsWith('/') ? a : a + '/') + b;
export const parent = (p) => { const s = p.replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); };
