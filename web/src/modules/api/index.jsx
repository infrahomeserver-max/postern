import { loadUi } from '../../prefs.js';
import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { setJob, setLast } from '../../status.js';
import { useDocs, uid, api, download } from '../../api.js';
import { Icon, useToast, Spinner, useContextMenu, useSidePanel } from '../../ui.jsx';
import { useDialogs } from '../../dialogs.jsx';
import { newRequest, newSoapRequest, execute, envToVars, mapTree, filterTree, prepare, resolve } from './engine.js';
import Sidebar from './Sidebar.jsx';
import Editor from './Editor.jsx';
import Response from './Response.jsx';
import EnvEditor from './EnvEditor.jsx';
import VarHover from './VarHover.jsx';

// Dialogs are separate chunks, fetched only when first opened.
const lz = (n) => lazy(() => import('./Modals.jsx').then(m => ({ default: m[n] })));
const ImportModal = lz('ImportModal'), CodeModal = lz('CodeModal'), SaveModal = lz('SaveModal'), RunnerModal = lz('RunnerModal');

const mkEnvTab = (envId) => ({ tid: uid(), kind: 'env', envId, req: null, src: null, dirty: false });
const mkTab = (req = newRequest(), src = null) => ({ tid: uid(), req, src, dirty: false, resp: null, tests: [], logs: [], running: false, error: '', prepared: null });
const clone = (o) => structuredClone(o);
const insertAfter = (items, id, node) => items.flatMap(it => it.id === id ? [it, node] : it.type === 'folder' ? [{ ...it, items: insertAfter(it.items, id, node) }] : [it]);
const reId = (it) => ({ ...it, id: uid(), ...(it.items ? { items: it.items.map(reId) } : {}) });

export default function ApiTester({ active }) {
  const toast = useToast(); const dlg = useDialogs();
  const coll = useDocs('collection'), envs = useDocs('environment'), hist = useDocs('history');
  const panel = useSidePanel('api', 290, active);
  const [activeEnvId, setActiveEnvId] = useState(() => localStorage.getItem('dh.env') || '');
  const readMap = () => { try { return JSON.parse(localStorage.getItem('dh.envByColl') || '{}'); } catch { return {}; } };
  const [envByColl, setEnvByColl] = useState(readMap);   // each collection remembers the environment you last used with it
  const dragTab = useRef(null); const [dropAt, setDropAt] = useState(null);
  const [pending, setPending] = useState(null); const [left, setLeft] = useState(0); const sendRef = useRef(); // confirm-before-send countdown
  useEffect(() => { const h = (e) => { setActiveEnvId(e.detail || ''); setEnvByColl(readMap()); }; addEventListener('postern:env-chosen', h); return () => removeEventListener('postern:env-chosen', h); }, []);
  const [globals, setGlobalsState] = useState(() => { try { return JSON.parse(localStorage.getItem('dh.globals') || '{}'); } catch { return {}; } });
  const [tabs, setTabs] = useState(() => [mkTab()]);
  const [tid, setTid] = useState(() => null);
  const [modal, setModal] = useState(null);
  const [view, setView] = useState('collections');
  const [split, setSplit] = useState(52);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const ctrls = useRef({}); const box = useRef(); const [newMenu, newMenuEl] = useContextMenu();

  const cur = tabs.find(t => t.tid === tid) || tabs[0] || { tid: '', kind: 'none' };
  useEffect(() => { if (!tid && tabs[0]) setTid(tabs[0].tid); }, [tid, tabs]);
  const env = envs.items?.find(e => e.id === activeEnvId);
  const isEnvTab = cur.kind === 'env';
  const vars = { ...globals, ...envToVars(env) };

  const setGlobals = (g) => { setGlobalsState(g); localStorage.setItem('dh.globals', JSON.stringify(g)); };
  const rememberEnv = (cid, id) => setEnvByColl(m => { const n = { ...m, [cid]: id }; try { localStorage.setItem('dh.envByColl', JSON.stringify(n)); } catch { /* private mode */ } return n; });
  const chooseEnv = (id) => { setActiveEnvId(id); try { localStorage.setItem('dh.env', id); } catch { /* private mode */ } if (cur.src?.cid) rememberEnv(cur.src.cid, id); };
  // opening a request from a collection switches to the environment last used with that collection ("No environment" if none yet)
  useEffect(() => {
    const cid = cur.src?.cid; if (!cid || cur.kind === 'env') return;
    const want = envByColl[cid] ?? ''; setActiveEnvId(want); try { localStorage.setItem('dh.env', want); } catch { /* private mode */ }
  }, [cur.tid, cur.src?.cid]); // eslint-disable-line
  // the side panel follows the active tab: environment tab -> Environments list, saved request -> its place in Collections
  useEffect(() => { if (!cur.tid) return; if (cur.kind === 'env') setView('environments'); else if (cur.src) setView('collections'); }, [cur.tid]); // eslint-disable-line
  const lookupVar = (k) => {
    const ev = env?.values.find(v => v.key === k && v.enabled !== false); if (ev) return { scope: 'env', label: env.name, value: ev.value, secret: !!ev.secret };
    if (Object.prototype.hasOwnProperty.call(globals, k)) return { scope: 'global', label: 'Globals', value: String(globals[k]) };
    return { scope: null };
  };
  const saveVar = (k, value, scope) => {   // scope: 'global' | 'env' (the active one) | 'env:<id>' (any existing environment)
    const target = scope === 'env' ? env : scope.startsWith('env:') ? envs.items?.find(e => e.id === scope.slice(4)) : null;
    if (target) { const has = target.values.some(v => v.key === k); envs.save({ ...target, values: has ? target.values.map(v => v.key === k ? { ...v, value } : v) : [...target.values, { key: k, value, enabled: true }] }, { immediate: true }); }
    else setGlobals({ ...globals, [k]: value });
  };
  const patch = useCallback((id, fn) => setTabs(ts => ts.map(t => t.tid === id ? { ...t, ...(typeof fn === 'function' ? fn(t) : fn) } : t)), []);
  const setReq = (p) => cur.req && patch(cur.tid, t => ({ req: { ...t.req, ...p }, dirty: true }));
  const openTab = (t) => { setTabs(ts => [...ts, t]); setTid(t.tid); };

  const updateColl = (cid, fn) => { const c = coll.items.find(x => x.id === cid); if (c) coll.save({ ...c, items: fn(c.items) }); };

  /* write script/env changes back to the active environment (or globals) */
  const syncScope = (before, afterEnv, afterGlobals) => {
    const changed = Object.keys({ ...before, ...afterEnv }).some(k => before[k] !== afterEnv[k]);
    let g = afterGlobals;
    if (changed) {
      if (env) {
        let values = env.values.filter(v => !v.key || v.key in afterEnv || !(v.key in before)).map(v => v.key in afterEnv ? { ...v, value: String(afterEnv[v.key]) } : v);
        for (const [k, v] of Object.entries(afterEnv)) if (!values.some(x => x.key === k)) values.push({ key: k, value: String(v), enabled: true });
        envs.save({ ...env, values });
      } else g = { ...g, ...Object.fromEntries(Object.entries(afterEnv).filter(([k, v]) => before[k] !== v)) };
    }
    if (JSON.stringify(g) !== JSON.stringify(globals)) setGlobals(g);
  };

  const send = async (id = cur.tid) => {
    const t = tabsRef.current.find(x => x.tid === id); if (!t || !t.req || t.running) return;
    if (!t.req.url.trim()) return toast('Enter a URL first', 'error');
    const ctrl = new AbortController(); ctrls.current[id] = ctrl;
    patch(id, { running: true, error: '' }); setJob('api:' + id, { label: `Sending ${t.req.soap ? 'SOAP' : t.req.method} ${t.req.url}` });
    const scope = { env: envToVars(env), globals: { ...globals }, vars: {} }; const before = { ...scope.env };
    try {
      const r = await execute(t.req, scope, { signal: ctrl.signal });
      patch(id, { resp: r.resp, tests: r.tests, logs: r.logs, prepared: r.prepared, running: false });
      syncScope(before, scope.env, scope.globals);
      setLast({ ok: r.resp.status < 400, text: `${r.prepared.method} ${r.resp.status} · ${Math.round(r.resp.timeMs)} ms` });
      if (loadUi().keepHistory) hist.save({ id: uid(), at: Date.now(), method: r.prepared.method, url: r.prepared.url, status: r.resp.status, timeMs: r.resp.timeMs, size: r.resp.size, req: t.req }, { immediate: true });
    } catch (e) {
      patch(id, { running: false, error: e.name === 'AbortError' ? 'Request cancelled' : e.message, resp: null, tests: [], logs: [] });
      setLast({ ok: false, text: e.name === 'AbortError' ? 'Request cancelled' : 'Request failed' });
    } finally { setJob('api:' + id, null); }
  };

  sendRef.current = send;
  /* With an environment active, ask first: Cancel / Send now, or it goes by itself after a few seconds (Settings -> Requests & history) */
  const trySend = (id = cur.tid) => {
    const t = tabsRef.current.find(x => x.tid === id); if (!t?.req || t.running) return;
    const u = loadUi();
    if (u.confirmSend && env) {
      if (pending?.tid === id) { setPending(null); return send(id); }       // pressing Send again = send now
      if (!t.req.url.trim()) return toast('Enter a URL first', 'error');
      const ms = Math.max(0, Number(u.confirmSendSecs) || 0) * 1000;
      setPending({ tid: id, start: Date.now(), ms }); setLeft(ms); return;
    }
    send(id);
  };
  useEffect(() => {
    if (!pending || !pending.ms) return;
    const iv = setInterval(() => { const l = pending.ms - (Date.now() - pending.start); if (l <= 0) { clearInterval(iv); setPending(null); sendRef.current(pending.tid); } else setLeft(l); }, 100);
    return () => clearInterval(iv);
  }, [pending]);
  useEffect(() => { setPending(p => (p && p.tid !== cur.tid) ? null : p); }, [cur.tid]);   // switching tabs cancels
  useEffect(() => { setPending(null); }, [activeEnvId]);

  /* Operation dropdown: regenerate envelope + SOAPAction from the WSDL (cached from import, or re-downloaded from its URL) */
  const switchOp = async (name) => {
    const so = cur.req.soap;
    try {
      const { cachedModel, cacheModel, parseWsdl } = await import('./wsdl.js'); const { fetchViaProxy } = await import('./convert.js');
      let m = cachedModel(so.wsdlKey || so.wsdl);
      if (!m && so.wsdl) { m = await parseWsdl(await fetchViaProxy(so.wsdl), { baseUrl: so.wsdl, fetchText: fetchViaProxy }); cacheModel(so.wsdl, m); }
      if (!m) return toast('Re-import the WSDL file to switch operations (it isn’t kept in memory after a reload)', 'error');
      const ep = m.endpoints.find(e => e.service === so.service && e.port === so.port) || m.endpoints[0];
      const op = ep.operations.find(o => o.name === name); if (!op) return toast(`Operation ${name} no longer exists in the WSDL`, 'error');
      setReq({ soap: { ...so, operation: name, action: op.action }, body: { ...cur.req.body, raw: op.envelope } });
    } catch (e) { toast('Couldn’t load the WSDL: ' + e.message, 'error'); }
  };

  /* big WSDLs don't store the operation list in every request: load it from the WSDL URL when the dropdown is opened */
  const loadOps = async () => {
    const so = cur.req.soap; if (!so?.wsdl) return;
    try {
      const { cachedModel, cacheModel, parseWsdl } = await import('./wsdl.js'); const { fetchViaProxy } = await import('./convert.js');
      let m = cachedModel(so.wsdlKey || so.wsdl);
      if (!m) { m = await parseWsdl(await fetchViaProxy(so.wsdl), { baseUrl: so.wsdl, fetchText: fetchViaProxy }); cacheModel(so.wsdl, m); }
      const ep = m.endpoints.find(e => e.service === so.service && e.port === so.port) || m.endpoints[0];
      patch(cur.tid, t => ({ req: { ...t.req, soap: { ...t.req.soap, ops: ep.operations.map(o => o.name) } } })); // not marked dirty
    } catch (e) { toast('Couldn’t load operations: ' + e.message, 'error'); }
  };

  const doSave = (id = cur.tid) => {
    const t = tabsRef.current.find(x => x.tid === id);
    if (!t || !t.req) return;
    if (t.src) { updateColl(t.src.cid, items => mapTree(items, it => it.id === t.src.rid ? { ...t.req, id: t.src.rid } : it)); patch(id, { dirty: false }); toast('Saved', 'success'); }
    else setModal({ type: 'save', id });
  };

  const closeTab = async (id, force) => {
    const t = tabs.find(x => x.tid === id); if (!t) return;
    if (!force && t.dirty && t.req && loadUi().confirmClose && !(await dlg.confirm('Discard changes?', `“${t.req.name}” has unsaved changes.`))) return;
    ctrls.current[id]?.abort();
    const rest = tabs.filter(x => x.tid !== id);
    setTabs(rest); if (tid === id) setTid(rest[Math.max(0, tabs.findIndex(x => x.tid === id) - 1)]?.tid || null);
  };

  const cmdApi = useRef(); cmdApi.current = (c) => { if (!active) return; if (c === 'newTab') openTab(mkTab()); else if (c === 'closeTab' && cur.tid) closeTab(cur.tid); else if (c === 'focusUrl') document.querySelector('input[aria-label="Request URL"]')?.focus(); };
  useEffect(() => { const h = (e) => cmdApi.current(e.detail); addEventListener('postern:cmd', h); return () => removeEventListener('postern:cmd', h); }, []);
  useEffect(() => {
    if (!active) return;
    const h = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
      else if (mod && e.key === 'Enter') { e.preventDefault(); trySend(); }
      else if (e.key === 'Escape' && pending) setPending(null);
      else if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); openTab(mkTab()); }
    };
    addEventListener('keydown', h); return () => removeEventListener('keydown', h);
  });
  useEffect(() => { const h = (e) => { if (tabsRef.current.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ''; } }; addEventListener('beforeunload', h); return () => removeEventListener('beforeunload', h); }, []);

  /* sidebar actions */
  const act = async (name, cid, item) => {
    const c = coll.items?.find(x => x.id === cid);
    switch (name) {
      case 'newColl': { const n = await dlg.prompt('New collection', 'My Collection'); if (n) coll.save({ id: uid(), name: n, items: [] }, { immediate: true }); break; }
      case 'renameColl': { const n = await dlg.prompt('Rename collection', c.name); if (n) coll.save({ ...c, name: n }); break; }
      case 'deleteColl': if (await dlg.confirm('Delete collection?', `“${c.name}” and all its requests will be deleted.`)) coll.remove(cid); break;
      case 'addReq': { const n = await dlg.prompt('New request', 'New Request'); if (!n) break; const r = newRequest({ name: n }); updateColl(cid, items => item ? mapTree(items, it => it.id === item.id ? { ...it, items: [...it.items, r] } : it) : [...items, r]); openTab(mkTab(clone(r), { cid, rid: r.id })); break; }
      case 'addSoap': { const n = await dlg.prompt('New SOAP request', 'New SOAP request'); if (!n) break; const r = newSoapRequest({ name: n }); updateColl(cid, items => item ? mapTree(items, it => it.id === item.id ? { ...it, items: [...it.items, r] } : it) : [...items, r]); openTab(mkTab(clone(r), { cid, rid: r.id })); break; }
      case 'addFolder': { const n = await dlg.prompt('New folder', 'New Folder'); if (!n) break; const f = { id: uid(), type: 'folder', name: n, items: [] }; updateColl(cid, items => item ? mapTree(items, it => it.id === item.id ? { ...it, items: [...it.items, f] } : it) : [...items, f]); break; }
      case 'rename': { const n = await dlg.prompt('Rename', item.name); if (!n) break; updateColl(cid, items => mapTree(items, it => it.id === item.id ? { ...it, name: n } : it)); setTabs(ts => ts.map(t => t.src?.rid === item.id ? { ...t, req: { ...t.req, name: n } } : t)); break; }
      case 'delete': if (await dlg.confirm('Delete?', `“${item.name}” will be deleted.`)) { updateColl(cid, items => filterTree(items, it => it.id !== item.id)); setTabs(ts => { const r = ts.filter(t => t.src?.rid !== item.id); return r.length ? r : [mkTab()]; }); } break;
      case 'dup': { const copy = { ...reId(item), name: item.name + ' copy' }; updateColl(cid, items => insertAfter(items, item.id, copy)); break; }
      case 'open': { const ex = tabs.find(t => t.src?.rid === item.id); if (ex) setTid(ex.tid); else openTab(mkTab(clone(item), { cid, rid: item.id })); break; }
      case 'run': setModal({ type: 'run', cid }); break;
      case 'export': { const { toPostman } = await import('./convert.js'); download(`${c.name}.postman_collection.json`, JSON.stringify(toPostman(c), null, 2)); break; }
      case 'import': setModal({ type: 'import' }); break;
      case 'openEnv': { const ex = tabs.find(t => t.kind === 'env' && t.envId === cid); if (ex) setTid(ex.tid); else openTab(mkEnvTab(cid)); break; }
      case 'activateEnv': chooseEnv(cid); toast('Environment activated', 'success'); break;
      case 'newEnv': { const n = await dlg.prompt('New environment', 'Local'); if (n) { const e = { id: uid(), name: n, values: [] }; await envs.save(e, { immediate: true }); openTab(mkEnvTab(e.id)); } break; }
    }
  };

  const applyImport = async ({ kind, data, baseUrl }) => {
    if (kind === 'collection') { await coll.save(data, { immediate: true }); toast(`Imported collection “${data.name}”`, 'success'); if (baseUrl && !globals.baseUrl) setGlobals({ ...globals, baseUrl }); }
    else if (kind === 'environment') { await envs.save(data, { immediate: true }); toast(`Imported environment “${data.name}”`, 'success'); }
    else if (kind === 'request') { openTab(mkTab(data)); toast('cURL imported into a new tab', 'success'); }
    else if (kind === 'backup') {
      const b = data;
      if (b.collections?.length) await coll.bulk(b.collections); if (b.environments?.length) await envs.bulk(b.environments);
      if (b.sites?.length) await api('/sites/bulk', { method: 'POST', body: { items: b.sites } });
      toast('Backup restored', 'success');
    }
  };

  /* drag the splitter */
  const drag = (e) => {
    e.preventDefault(); const r = box.current.getBoundingClientRect();
    const mv = (ev) => setSplit(Math.min(80, Math.max(20, ((ev.clientY - r.top) / r.height) * 100)));
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  };

  const runColl = modal?.type === 'run' ? coll.items?.find(c => c.id === modal.cid) : null;
  return (
    <>
      <Sidebar panel={panel} collections={coll.items} history={hist.items} envs={envs.items} activeEnvId={activeEnvId} activeEnvTab={isEnvTab ? cur.envId : null} view={view} setView={setView} act={act} activeId={cur.src?.rid}
        onHistory={(h) => openTab(mkTab(clone(h.req)))} onClearHistory={() => hist.clear()} />
      <div className="col grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)', paddingRight: 10 }}>
          <div className="tabs tabstrip" style={{ borderBottom: 0 }}>
            {tabs.map(t => (
              <div key={t.tid} draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.tid); dragTab.current = t.tid; }}
                onDragOver={(e) => { if (!dragTab.current) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt({ tid: t.tid, after: e.clientX > r.left + r.width / 2 }); }}
                onDragLeave={() => setDropAt(null)} onDragEnd={() => { dragTab.current = null; setDropAt(null); }}
                onDrop={(e) => { e.preventDefault(); const from = dragTab.current; dragTab.current = null; const at = dropAt; setDropAt(null); if (!from || !at || from === at.tid) return;
                  setTabs(ts => { const m = ts.find(x => x.tid === from); const rest = ts.filter(x => x.tid !== from); let i = rest.findIndex(x => x.tid === at.tid); if (at.after) i++; rest.splice(i, 0, m); return rest; }); }}
                className={'tab' + (t.tid === cur.tid ? ' active' : '') + (dragTab.current === t.tid ? ' dragging' : '') + (dropAt?.tid === t.tid ? (dropAt.after ? ' dropafter' : ' dropbefore') : '')} onClick={() => setTid(t.tid)} onAuxClick={(e) => e.button === 1 && closeTab(t.tid)} style={{ cursor: 'pointer', maxWidth: 220 }}>
                {t.kind === 'env' ? <><Icon n={t.envId === '__globals' ? 'globe' : 'gear'} s={13} c="var(--accent2)" /><span className="ellipsis">{t.envId === '__globals' ? 'Globals' : envs.items?.find(e => e.id === t.envId)?.name || 'Environment'}</span></> : <>
                <span className={'method m-' + (t.req.soap ? 'SOAP' : t.req.method)} style={{ width: 'auto' }}>{t.req.soap ? 'SOAP' : t.req.method === 'DELETE' ? 'DEL' : t.req.method}</span>
                <span className="ellipsis">{t.req.name === 'New Request' && t.req.url ? t.req.url.replace(/^https?:\/\//, '') : t.req.name}</span></>}
                {t.running ? <Spinner /> : t.dirty ? <span className="dot" title="Unsaved" /> : null}
                <button className="icon-btn" style={{ padding: 1 }} onClick={(e) => { e.stopPropagation(); closeTab(t.tid); }} aria-label="Close tab"><Icon n="x" s={12} /></button>
              </div>))}
            <button className="icon-btn" onClick={(e) => newMenu(e, [{ label: 'REST request', run: () => openTab(mkTab()) }, { label: 'SOAP request', run: () => openTab(mkTab(newSoapRequest())) }])} title="New tab (Ctrl+T)" aria-label="New tab"><Icon n="plus" /></button>{newMenuEl}
          </div>
          <div className="envbar">{envs.items?.length > 0 && <select value={env ? activeEnvId : ''} onChange={(e) => { if (e.target.value === '__manage') { setView('environments'); act('openEnv', activeEnvId || envs.items?.[0]?.id || '__globals'); } else chooseEnv(e.target.value); }} aria-label="Environment" style={{ maxWidth: 190 }}>
            <option value="">No environment</option>{envs.items?.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}<option disabled>──────────</option><option value="__manage">Manage environments…</option></select>}</div>
        </div>
        {cur.kind === 'none' ? (
          <div className="empty grow"><div><Icon n="send" s={34} c="var(--muted)" /><h3>No open requests</h3><p className="muted">Open one from Collections, or start a new one.</p>
            <button className="btn primary" onClick={() => openTab(mkTab())}><Icon n="plus" s={13} />New request <span className="muted">Ctrl+T</span></button></div></div>
        ) : isEnvTab ? (() => {
          const isG = cur.envId === '__globals';
          const e = isG ? { id: '__globals', name: 'Globals', values: Object.entries(globals).map(([key, value]) => ({ key, value, enabled: true })) } : envs.items?.find(x => x.id === cur.envId);
          if (!e) return <div className="empty">This environment no longer exists</div>;
          return <EnvEditor key={cur.tid} env={e} isGlobals={isG} isActive={!isG && activeEnvId === e.id}
            onChange={(values) => isG ? setGlobals(Object.fromEntries(values.filter(v => v.key).map(v => [v.key, v.value]))) : envs.save({ ...e, values })}
            onRename={(name) => envs.save({ ...e, name })} onSetActive={() => chooseEnv(activeEnvId === e.id ? '' : e.id)}
            onDelete={async () => { if (await dlg.confirm('Delete environment?', `“${e.name}” will be deleted.`)) { if (activeEnvId === e.id) chooseEnv(''); envs.remove(e.id); closeTab(cur.tid, true); } }} />;
        })() : (
        <>
        {pending?.tid === cur.tid && env && (() => { let u = cur.req.url; try { const pr = prepare(cur.req, vars); u = `${pr.method} ${pr.url}`; } catch { /* show raw url */ } const prod = /prod|live/i.test(env.name);
          return <div className={'confirm-send' + (prod ? ' warn' : '')} role="alertdialog" aria-label="Confirm sending">
            <Icon n="send" s={15} /><div className="grow" style={{ minWidth: 0 }}><div><b>Send to “{env.name}”?</b> <span className="muted">{pending.ms ? `Sending in ${Math.ceil(left / 1000)}s` : 'Waiting for your OK'}</span></div><div className="mono ellipsis muted" style={{ fontSize: 12 }}>{u}</div></div>
            <button className="btn sm" onClick={() => setPending(null)}>Cancel</button>
            <button className="btn sm primary" autoFocus onClick={() => { setPending(null); send(cur.tid); }}>Send now</button>
            {pending.ms > 0 && <span className="cs-bar" style={{ width: Math.max(0, Math.min(100, (left / pending.ms) * 100)) + '%' }} />}
          </div>; })()}
        <div className="split-v" ref={box}>
          <div className="col" style={{ height: split + '%', minHeight: 0 }}>
            <Editor key={cur.tid} tab={cur} set={setReq} onSend={() => trySend()} onCancel={() => ctrls.current[cur.tid]?.abort()} onSave={() => doSave()} running={cur.running} vars={vars}
              onSwitchOp={switchOp} onLoadOps={loadOps} onCode={() => { setModal({ type: 'code', prepared: prepare(cur.req, vars) }); }} />
          </div>
          <div className="resizer" onMouseDown={drag} role="separator" aria-orientation="horizontal" />
          <div className="col" style={{ height: (100 - split) + '%', minHeight: 0 }}><Response tab={cur} onClear={() => patch(cur.tid, { resp: null, error: null, tests: [], logs: [] })} onExample={(r) => { const ex = { name: `${r.status} ${r.statusText || ''}`.trim(), status: r.status, headers: r.headers.filter(([k]) => !/^(set-cookie|content-length|content-encoding|transfer-encoding|connection|date|server)$/i.test(k)).map(([key, value]) => ({ key, value, enabled: true })), body: (r.bodyText || '').slice(0, 200000) }; setReq({ examples: [...(cur.req.examples || []).filter(e => e.name !== ex.name), ex] }); toast(cur.src ? `Example saved — press Save to keep it` : 'Example added — Save the request to keep it', 'success'); }} /></div>
        </div></>)}
      </div>
      <VarHover active={!!active && !isEnvTab && cur.kind !== 'none'} lookup={lookupVar} save={saveVar} hasEnv={!!env} envName={env?.name} envList={envs.items || []} activeEnvId={env?.id || ''} />
      {dlg.el}
      <Suspense fallback={null}>
        {modal?.type === 'import' && <ImportModal onClose={() => setModal(null)} onApply={applyImport} />}
        {modal?.type === 'code' && <CodeModal prepared={modal.prepared} onClose={() => setModal(null)} />}
        {modal?.type === 'save' && <SaveModal collections={coll.items || []} name={tabs.find(t => t.tid === modal.id)?.req.name || 'New Request'} onClose={() => setModal(null)}
          onSave={(name, cid, newName) => {
            const t = tabs.find(x => x.tid === modal.id); const req = { ...t.req, name };
            if (cid === '__new') { cid = uid(); coll.save({ id: cid, name: newName || 'My Collection', items: [req] }, { immediate: true }); }
            else updateColl(cid, items => [...items, req]);
            rememberEnv(cid, activeEnvId); patch(modal.id, { req, src: { cid, rid: req.id }, dirty: false }); setModal(null); toast('Saved', 'success');
          }} />}
        {runColl && <RunnerModal collection={runColl} env={env} globals={globals} onClose={() => setModal(null)}
          onEnvChanged={(e, g) => syncScope(envToVars(env), e, g)} />}
      </Suspense>
    </>
  );
}
