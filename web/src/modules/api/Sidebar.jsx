import { useState, useMemo, memo, useEffect } from 'react';
import { Icon, useContextMenu, useDebounced } from '../../ui.jsx';
import { countRequests } from './engine.js';
import { fmtDate } from '../../api.js';

const kindOk = (it, f) => f === 'all' || (f === 'soap') === !!it.soap;
const matches = (it, q, f = 'all') => it.type === 'folder' ? it.items.some(c => matches(c, q, f)) || (f === 'all' && it.name.toLowerCase().includes(q)) : kindOk(it, f) && (it.name + ' ' + it.url + ' ' + it.method + (it.soap ? ' soap ' + it.soap.operation : '')).toLowerCase().includes(q);
const Badge = ({ it }) => it.soap ? <span className="method m-SOAP">SOAP</span> : <span className={'method m-' + it.method}>{it.method === 'DELETE' ? 'DEL' : it.method}</span>;

const Node = memo(function Node({ it, cid, depth, open, toggle, q, act, activeId, f }) {
  const [ctx, ctxEl] = useContextMenu();
  if ((q || f !== 'all') && !matches(it, q, f)) return null;
  const pad = 8 + depth * 14;
  if (it.type === 'folder') {
    const isOpen = q || f !== 'all' || open.has(it.id);
    return <>
      <div className="tree-item" style={{ paddingLeft: pad }} onClick={() => toggle(it.id)} onContextMenu={(e) => ctx(e, [
        { label: 'Add request', run: () => act('addReq', cid, it) }, { label: 'Add SOAP request', run: () => act('addSoap', cid, it) }, { label: 'Add folder', run: () => act('addFolder', cid, it) }, '-',
        { label: 'Rename', run: () => act('rename', cid, it) }, { label: 'Delete', run: () => act('delete', cid, it) }])}>
        <Icon n={isOpen ? 'chevd' : 'chev'} s={12} /><Icon n="folder" s={14} c="var(--warn)" /><span className="grow ellipsis">{it.name}</span>
        <span className="acts"><button className="icon-btn" title="Add request" onClick={(e) => { e.stopPropagation(); act('addReq', cid, it); }}><Icon n="plus" s={13} /></button></span>
        {ctxEl}
      </div>
      {isOpen && it.items.map(c => <Node key={c.id} it={c} cid={cid} depth={depth + 1} open={open} toggle={toggle} q={q} act={act} activeId={activeId} f={f} />)}
    </>;
  }
  return (
    <div className={'tree-item' + (activeId === it.id ? ' active' : '')} style={{ paddingLeft: pad + 16 }} onClick={() => act('open', cid, it)}
      onContextMenu={(e) => ctx(e, [{ label: 'Open', run: () => act('open', cid, it) }, { label: 'Duplicate', run: () => act('dup', cid, it) }, { label: 'Rename', run: () => act('rename', cid, it) }, '-', { label: 'Delete', run: () => act('delete', cid, it) }])}>
      <Badge it={it} /><span className="grow ellipsis">{it.name}</span>{ctxEl}
    </div>);
});

function Collection({ c, open, toggle, q, act, activeId, f }) {
  const [ctx, ctxEl] = useContextMenu();
  const isOpen = q || f !== 'all' || open.has(c.id);
  if ((q || f !== 'all') && !c.items.some(i => matches(i, q, f))) return null;
  return <>
    <div className="tree-item" onClick={() => toggle(c.id)} onContextMenu={(e) => ctx(e, [
      { label: 'Add request', run: () => act('addReq', c.id, null) }, { label: 'Add SOAP request', run: () => act('addSoap', c.id, null) }, { label: 'Add folder', run: () => act('addFolder', c.id, null) }, '-',
      { label: 'Run collection', run: () => act('run', c.id) }, { label: 'Export (Postman v2.1)', run: () => act('export', c.id) }, '-',
      { label: 'Rename', run: () => act('renameColl', c.id) }, { label: 'Delete', run: () => act('deleteColl', c.id) }])}>
      <Icon n={isOpen ? 'chevd' : 'chev'} s={12} /><Icon n="box" s={14} c="var(--accent2)" /><b className="grow ellipsis">{c.name}</b>
      <span className="muted" style={{ fontSize: 11 }}>{countRequests(c.items)}</span>
      <span className="acts"><button className="icon-btn" title="Run collection" onClick={(e) => { e.stopPropagation(); act('run', c.id); }}><Icon n="play" s={12} /></button>
        <button className="icon-btn" title="Add request" onClick={(e) => { e.stopPropagation(); act('addReq', c.id, null); }}><Icon n="plus" s={13} /></button></span>
      {ctxEl}
    </div>
    {isOpen && (c.items.length ? c.items.map(it => <Node key={it.id} it={it} cid={c.id} depth={1} open={open} toggle={toggle} q={q} act={act} activeId={activeId} f={f} />) : <div className="muted" style={{ padding: '4px 34px' }}>Empty — add a request</div>)}
  </>;
}

export default function Sidebar({ collections, history, envs, activeEnvId, activeEnvTab, act, activeId, onHistory, onClearHistory, view, setView }) {
  const [open, setOpen] = useState(new Set());
  const [kind, setKind] = useState('all'); const [search, setSearch] = useState(''); const q = useDebounced(search.trim().toLowerCase(), 150);
  // reveal the active request in the tree
  useEffect(() => {
    if (!activeId || !collections) return;
    const trail = (items, path) => { for (const it of items) { if (it.id === activeId) return path; if (it.type === 'folder') { const r = trail(it.items, [...path, it.id]); if (r) return r; } } return null; };
    for (const c of collections) { const r = trail(c.items, [c.id]); if (r) { setOpen(s => r.every(x => s.has(x)) ? s : new Set([...s, ...r])); break; } }
  }, [activeId, collections === null]); // reveal when the active request changes, not on every save (so "Collapse all" stays collapsed)
  const toggle = (id) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const hist = useMemo(() => { const g = {}; (history || []).forEach(h => { const d = new Date(h.at).toDateString(); (g[d] ||= []).push(h); }); return Object.entries(g); }, [history]);
  return (
    <aside className="side" aria-label="Collections">
      <div className="row" style={{ padding: 8, gap: 6 }}>
        <div className="grow row" style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 8, color: 'var(--muted)' }}><Icon n="search" s={13} /></span>
          <input style={{ width: '100%', paddingLeft: 28 }} placeholder="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
        <button className="icon-btn" title="Collapse all folders" aria-label="Collapse all" onClick={() => setOpen(new Set())}><Icon n="collapse" /></button>
        <button className="icon-btn" title="New collection" onClick={() => act('newColl')}><Icon n="plus" /></button>
        <button className="icon-btn" title="Import" onClick={() => act('import')}><Icon n="upload" /></button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" className={'tab' + (view === 'collections' ? ' active' : '')} onClick={() => setView('collections')}><Icon n="box" s={13} />Collections</button>
        <button role="tab" className={'tab' + (view === 'environments' ? ' active' : '')} onClick={() => setView('environments')}><Icon n="globe" s={13} />Environments</button>
        <button role="tab" className={'tab' + (view === 'history' ? ' active' : '')} onClick={() => setView('history')}><Icon n="hist" s={13} />History</button>
      </div>
      <div className="col" style={{ flex: 1, overflow: 'auto', padding: 6 }}>
        {view === 'collections' && collections?.length > 0 && <div className="seg" role="group" aria-label="Request type filter" style={{ alignSelf: 'flex-start', margin: '2px 4px 6px' }}>
          {[['all', 'All'], ['rest', 'REST'], ['soap', 'SOAP']].map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} aria-pressed={kind === k}>{l}</button>)}</div>}
        {view === 'collections' && (collections === null ? [1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 24, margin: 4 }} />)
          : collections.length ? collections.map(c => <Collection key={c.id} c={c} open={open} toggle={toggle} q={q} act={act} activeId={activeId} f={kind} />)
          : <div className="empty"><div><Icon n="box" s={28} c="var(--muted)" /><p>No collections yet</p><button className="btn primary" onClick={() => act('newColl')}>Create collection</button> <button className="btn" onClick={() => act('import')}>Import</button></div></div>)}
        {view === 'environments' && <>
          <div className={'tree-item' + (activeEnvTab === '__globals' ? ' active' : '')} onClick={() => act('openEnv', '__globals')}><Icon n="globe" s={14} c="var(--info)" /><span className="grow">Globals</span></div>
          {envs === null ? <div className="skeleton" style={{ height: 24, margin: 4 }} /> : envs.map(e => (
            <div key={e.id} className={'tree-item' + (activeEnvTab === e.id ? ' active' : '')} onClick={() => act('openEnv', e.id)}>
              <Icon n="gear" s={14} c="var(--accent2)" /><span className="grow ellipsis">{e.name}</span>
              <span className="muted" style={{ fontSize: 11 }}>{e.values.filter(v => v.key).length}</span>
              {activeEnvId === e.id ? <span className="chip ok" style={{ padding: '0 6px' }}>active</span> : <button className="btn sm ghost acts" onClick={(ev) => { ev.stopPropagation(); act('activateEnv', e.id); }}>Use</button>}
            </div>))}
          <div className="row" style={{ padding: 8, gap: 6 }}><button className="btn sm" onClick={() => act('newEnv')}><Icon n="plus" s={12} />New environment</button><button className="btn sm" onClick={() => act('import')}><Icon n="upload" s={12} />Import</button></div>
          {envs?.length === 0 && <div className="muted" style={{ padding: '4px 10px' }}>Create an environment to hold variables like <code>{'{{baseUrl}}'}</code> per stage (dev, staging, prod).</div>}
        </>}
        {view === 'history' && (hist.length ? <>
          <button className="btn sm ghost" style={{ alignSelf: 'flex-end' }} onClick={onClearHistory}>Clear all</button>
          {hist.map(([day, list]) => <div key={day}><div className="muted" style={{ padding: '6px 8px', fontSize: 11 }}>{day === new Date().toDateString() ? 'Today' : day}</div>
            {list.filter(h => !q || (h.url + h.method).toLowerCase().includes(q)).map(h => <div key={h.id} className="tree-item" onClick={() => onHistory(h)} title={fmtDate(h.at)}>
              <span className={'method m-' + (h.req?.soap ? 'SOAP' : h.method)}>{h.req?.soap ? 'SOAP' : h.method}</span><span className="grow ellipsis mono" style={{ fontSize: 12 }}>{h.url.replace(/^https?:\/\//, '')}</span>
              <span className={'chip s' + Math.min(5, Math.max(2, Math.floor(h.status / 100)))} style={{ padding: '0 6px' }}>{h.status}</span></div>)}</div>)}</>
          : <div className="empty">Requests you send will appear here</div>)}
      </div>
    </aside>
  );
}
