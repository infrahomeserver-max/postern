import { useSidePanel, SideResizer, SideRestore } from '../../ui.jsx';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api, useDocs, fmtBytes } from '../../api.js';
import { Icon, Modal, useToast, Spinner } from '../../ui.jsx';
import { pickFile } from '../../api.js';
import { useDialogs } from '../../dialogs.jsx';
import Samples from './Samples.jsx';
import { anonymize } from './anonymize.js';

const METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const newId = () => { const b = crypto.getRandomValues(new Uint8Array(16)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const rid = () => Math.random().toString(36).slice(2, 9);
const base = (id) => `${location.origin}/mock/${id}`;

/* "{{baseUrl}}/users/{{id}}?x=1" → "/users/:id" */
export const toRoutePath = (url) => {
  let u = String(url || '').split('?')[0].replace(/^(https?:\/\/[^/]+|\{\{[^}]+\}\})/, '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, ':$1');
  return u.startsWith('/') ? u : '/' + u;
};

export function routesFromCollection(col) {
  const out = [];
  const walk = (items) => items.forEach(it => {
    if (it.type === 'folder') return walk(it.items);
    const exs = it.examples?.length ? it.examples : [null];
    exs.slice(0, 3).forEach((ex, i) => out.push({
      id: rid(), enabled: true, method: it.soap ? 'POST' : it.method, path: it.soap ? '/' : toRoutePath(it.url), name: it.name + (ex && exs.length > 1 ? ` (${ex.name || ex.status})` : ''),
      ...(it.soap ? { soapOperation: it.soap.operation || it.name, soapAction: it.soap.action || '' } : {}),
      status: ex?.status || 200, headers: ex?.headers?.length ? ex.headers : [{ key: 'Content-Type', value: it.soap ? (it.soap.version === '1.2' ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8') : 'application/json', enabled: true }], body: ex?.body ?? (it.soap ? '<?xml version="1.0"?>\n<soapenv:Envelope xmlns:soapenv="' + (it.soap.version === '1.2' ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/') + '">\n   <soapenv:Body>\n      \n   </soapenv:Body>\n</soapenv:Envelope>' : '{\n  "ok": true\n}'), delay: 0, skipDup: i > 0,
    }));
  });
  walk(col.items);
  // later duplicates of the same method+path are kept but placed after the first (first match wins)
  return out.map(({ skipDup, ...r }) => r);
}

function Logs({ mock, active }) {
  const [logs, setLogs] = useState(null); const [open, setOpen] = useState(null);
  const load = useCallback(() => api(`/mocks/${mock.id}/logs`).then(setLogs).catch(() => setLogs([])), [mock.id]);
  useEffect(() => { setLogs(null); setOpen(null); load(); if (!active) return; const t = setInterval(load, 2000); return () => clearInterval(t); }, [load, active]);
  return (
    <div className="col" style={{ minHeight: 0, flex: 1 }}>
      <div className="row" style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)' }}>
        <b>Request log</b><span className="muted">live · last 100</span><span className="grow" />
        <button className="btn sm ghost" onClick={() => api(`/mocks/${mock.id}/logs`, { method: 'DELETE' }).then(load)}>Clear</button>
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {logs === null ? <div className="empty"><Spinner /></div> : !logs.length ? <div className="empty">No requests yet.<br />Call <span className="mono">{base(mock.id)}/…</span> from anywhere.</div> : logs.map((l, i) => (
          <div key={l.t + '-' + i} style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="tree-item" onClick={() => setOpen(open === i ? null : i)} style={{ borderRadius: 0 }}>
              <span className="muted mono" style={{ fontSize: 11, width: 62 }}>{new Date(l.t).toLocaleTimeString([], { hour12: false })}</span>
              <span className={'method m-' + l.method}>{l.method}</span><span className="grow ellipsis mono" style={{ fontSize: 12 }}>{l.path}</span>
              <span className={'chip ' + (l.matched ? (l.status < 400 ? 'ok' : 'warn') : 'err')} style={{ padding: '0 6px' }}>{l.status}</span><span className="muted" style={{ fontSize: 11, width: 44, textAlign: 'right' }}>{l.ms} ms</span>
            </div>
            {open === i && <div style={{ padding: '4px 12px 10px', background: 'var(--panel2)' }}>
              {!l.matched && <div className="chip err" style={{ marginBottom: 6 }}>No route matched</div>}
              <pre className="code" style={{ padding: 0, fontSize: 11.5 }}>{Object.entries(l.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}{l.body ? '\n\n' + l.body : ''}</pre></div>}
          </div>))}
      </div>
    </div>
  );
}

function RouteEditor({ route, onChange }) {
  const set = (p) => onChange({ ...route, ...p });
  const hs = route.headers || [];
  return (
    <div className="col" style={{ gap: 10, padding: 14, overflow: 'auto', flex: 1 }}>
      <div className="row"><select value={route.method} onChange={(e) => set({ method: e.target.value })} className={'m-' + route.method} style={{ fontWeight: 700, width: 100 }} aria-label="Route method">{METHODS.map(m => <option key={m}>{m}</option>)}</select>
        <input className="grow mono" value={route.path} onChange={(e) => set({ path: e.target.value })} placeholder="/users/:id   or   /files/*" aria-label="Route path" />
        <label className="row" title="Status code"><span className="muted">Status</span><input type="number" min="100" max="599" value={route.status} onChange={(e) => set({ status: +e.target.value })} style={{ width: 74 }} /></label>
        <label className="row" title="Delay before responding (max 10 s)"><span className="muted">Delay ms</span><input type="number" min="0" max="10000" value={route.delay || 0} onChange={(e) => set({ delay: +e.target.value })} style={{ width: 80 }} /></label></div>
      <input value={route.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="Description (optional)" />
      <div className="row"><span className="muted" title="Match SOAP requests by the operation element inside Body and/or the SOAPAction header">SOAP match</span>
        <input className="grow mono" value={route.soapOperation || ''} onChange={(e) => set({ soapOperation: e.target.value })} placeholder="operation, e.g. GetUser (optional)" aria-label="SOAP operation" spellCheck={false} />
        <input className="grow mono" value={route.soapAction || ''} onChange={(e) => set({ soapAction: e.target.value })} placeholder="SOAPAction (optional)" aria-label="SOAPAction match" spellCheck={false} /></div>
      <div className="muted" style={{ fontSize: 12 }}>Response headers</div>
      <table className="kv"><tbody>
        {[...hs, { key: '', value: '' }].map((h, i) => <tr key={i}><td><input placeholder="Header" value={h.key} onChange={(e) => { const n = [...hs]; n[i] = { ...(n[i] || { enabled: true }), key: e.target.value, value: n[i]?.value || '' }; set({ headers: n }); }} /></td>
          <td><input placeholder="Value" value={h.value} onChange={(e) => { const n = [...hs]; n[i] = { ...(n[i] || { enabled: true, key: '' }), value: e.target.value }; set({ headers: n.filter(x => x.key || x.value) }); }} /></td>
          <td className="del">{h.key && <button className="icon-btn" onClick={() => set({ headers: hs.filter((_, j) => j !== i) })}><Icon n="x" s={12} /></button>}</td></tr>)}</tbody></table>
      <div className="muted" style={{ fontSize: 12 }}>Response body — templating: <code>{'{{params.id}} {{query.q}} {{headers.x-token}} {{body.name}} {{xml.tagName}} {{soap.operation}} {{$guid}} {{$timestamp}} {{$randomInt}} {{$randomName}} {{$randomEmail}}'}</code></div>
      <textarea className="grow" style={{ minHeight: 180, width: '100%' }} spellCheck={false} value={route.body} onChange={(e) => set({ body: e.target.value })} />
    </div>
  );
}

export function routesFromWsdl(ep) {
  const ct = ep.version === '1.2' ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8';
  return ep.operations.map(op => ({ id: rid(), enabled: true, method: 'POST', path: '/', name: op.name, soapOperation: op.name, soapAction: op.action, status: 200, headers: [{ key: 'Content-Type', value: ct, enabled: true }], body: op.responseEnvelope || '', delay: 0 }));
}

function FromWsdl({ onClose, onCreate }) {
  const [url, setUrl] = useState(''); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [model, setModel] = useState(null); const [ei, setEi] = useState(0);
  const parse = async (src, base = '') => {
    setBusy(true); setErr('');
    try { const { parseWsdl } = await import('../api/wsdl.js'); const { fetchViaProxy } = await import('../api/convert.js'); const m = await parseWsdl(src, { baseUrl: base, fetchText: fetchViaProxy }); setModel(m); setEi(0); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const fromUrl = async () => { setBusy(true); setErr(''); try { const { fetchViaProxy } = await import('../api/convert.js'); const t = await fetchViaProxy(url.trim()); await parse(t, url.trim()); } catch (e) { setErr('Couldn’t download that URL: ' + e.message); setBusy(false); } };
  return (
    <Modal title="Create SOAP mock from a WSDL" onClose={onClose} footer={model ? <><button className="btn" onClick={() => setModel(null)}>Back</button><button className="btn primary" onClick={() => onCreate(model, model.endpoints[ei])}>Create mock</button></> : <button className="btn" onClick={onClose}>Cancel</button>}>
      {!model ? <>
        <p className="muted" style={{ marginTop: 0 }}>Every operation becomes a route that answers with a sample response envelope. Clients POST to the mock URL; the right response is picked by operation name / SOAPAction.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) fromUrl(); }}><input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/service?wsdl" aria-label="WSDL URL" spellCheck={false} /><button className="btn primary" disabled={!url.trim() || busy}>{busy ? <Spinner /> : 'Load'}</button></form>
        <div className="muted" style={{ margin: '10px 0 6px' }}>…or <button className="btn sm" onClick={async () => { const f = await pickFile('.wsdl,.xml'); if (f) parse(await f.text()); }}>choose a .wsdl file</button> or paste it</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', height: 110 }} spellCheck={false} placeholder="<wsdl:definitions …>" aria-label="WSDL text" />
        <button className="btn" style={{ marginTop: 8 }} disabled={!text.trim() || busy} onClick={() => parse(text)}>Parse pasted WSDL</button>
        {err && <div className="err-text" role="alert" style={{ marginTop: 8 }}>{err}</div>}</>
      : <>
        <div style={{ marginBottom: 8 }}><b>{model.title}</b> <span className="muted">— {model.endpoints.length} endpoint(s)</span></div>
        <select value={ei} onChange={(e) => setEi(+e.target.value)} style={{ width: '100%', marginBottom: 8 }} aria-label="Endpoint">{model.endpoints.map((e, i) => <option key={i} value={i}>{e.service} · {e.port} (SOAP {e.version}) — {e.operations.length} operations</option>)}</select>
        <div className="muted">{model.endpoints[ei].operations.map(o => o.name).join(', ')}</div>
        {model.warnings.length > 0 && <div className="chip warn" style={{ marginTop: 8, display: 'block', whiteSpace: 'normal' }}>{model.warnings[0]}</div>}</>}
    </Modal>
  );
}


/* Preview: generated mock next to the original sample, with search and changed-line marks */
const normLines = (t, xml) => (xml ? t.replace(/<!--[\s\S]*?-->/g, '') : t).split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
function Preview({ res, original }) {
  const [mode, setMode] = useState('mock'); const [q, setQ] = useState(''); const [at, setAt] = useState(0);
  const xml = res.kind === 'xml';
  const mock = useMemo(() => normLines(res.output, xml), [res]);
  const orig = useMemo(() => { let t = original; if (res.kind === 'json') { try { t = JSON.stringify(JSON.parse(original), null, 2); } catch { /* raw */ } } return normLines(t, xml); }, [original, res]);
  const aligned = mock.length === orig.length;
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => { if (!needle) return []; const h = []; [['m', mock], ['o', orig]].forEach(([side, ls]) => { if (side === 'o' && mode === 'mock') return; ls.forEach((l, i) => { if (l.toLowerCase().includes(needle)) h.push(side + i); }); }); return h; }, [needle, mock, orig, mode]);
  useEffect(() => { setAt(0); }, [needle, mode]);
  const cur = hits[at]; const box = useRef();
  useEffect(() => { if (cur) box.current?.querySelector('[data-hit="' + cur + '"]')?.scrollIntoView({ block: 'center' }); }, [cur, mode]);
  const mark = (line) => { if (!needle) return line; const out = []; let i = 0; const lo = line.toLowerCase(); for (;;) { const j = lo.indexOf(needle, i); if (j < 0) break; out.push(line.slice(i, j), <mark key={j}>{line.slice(j, j + needle.length)}</mark>); i = j + needle.length; } out.push(line.slice(i)); return out; };
  const pane = (side, ls, other) => <pre className="code cmp-pane" onScroll={mode === 'cmp' ? (e) => { const o = box.current?.querySelectorAll('.cmp-pane')[side === 'm' ? 1 : 0]; if (o && Math.abs(o.scrollTop - e.target.scrollTop) > 1) { o.scrollTop = e.target.scrollTop; o.scrollLeft = e.target.scrollLeft; } } : undefined}>
    {ls.map((l, i) => <div key={i} data-hit={side + i} className={'cmp-line' + (aligned && l !== other[i] ? ' chg' : '') + (cur === side + i ? ' cur' : '')}><span className="ln">{i + 1}</span><span>{mark(l) || ' '}</span></div>)}</pre>;
  return <div className="preview">
    {res.leaks.length ? <div className="chip err" style={{ display: 'block', whiteSpace: 'normal', marginBottom: 8 }}>{res.leaks.length} original value(s) still appear in the output — not safe to use: {res.leaks.slice(0, 5).map(l => l.slice(0, 20)).join(', ')}. Report this.</div>
      : <div className="chip ok" style={{ display: 'block', whiteSpace: 'normal', marginBottom: 8 }}>Leak check passed: none of the {res.stats.checked} original values appear in the output{res.stats.kept.length ? ` (kept on purpose: ${res.stats.kept.join(', ')})` : ''}.</div>}
    <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
      <div className="seg" role="tablist"><button role="tab" aria-selected={mode === 'mock'} className={mode === 'mock' ? 'on' : ''} onClick={() => setMode('mock')}>Mock</button><button role="tab" aria-selected={mode === 'cmp'} className={mode === 'cmp' ? 'on' : ''} onClick={() => setMode('cmp')}>Compare with sample</button></div>
      <div className="grow row" style={{ position: 'relative', minWidth: 160 }}><Icon n="search" s={14} /><input className="grow" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits.length) setAt((at + (e.shiftKey ? hits.length - 1 : 1)) % hits.length); }} placeholder="Search in the preview…" aria-label="Search preview" spellCheck={false} /></div>
      {needle && <><span className="muted" style={{ fontSize: 12 }}>{hits.length ? `${at + 1} / ${hits.length}` : 'no match'}</span><button className="btn sm" disabled={!hits.length} onClick={() => setAt((at + hits.length - 1) % hits.length)} aria-label="Previous match">↑</button><button className="btn sm" disabled={!hits.length} onClick={() => setAt((at + 1) % hits.length)} aria-label="Next match">↓</button></>}
    </div>
    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{mode === 'cmp' ? (aligned ? 'Highlighted lines differ from your sample; plain lines were kept as they are (structure, names, type/version codes).' : 'Lists were shortened, so lines are not matched one-to-one.') + ' Left: your sample (stays on this screen, never saved). Right: the mock.' : <>Field and tag <b>names</b> are kept as structure. If a name itself is confidential, rename it after creating.</>}</div>
    <div ref={box} className={mode === 'cmp' ? 'cmp two' : 'cmp'}>{mode === 'cmp' && pane('o', orig, mock)}{pane('m', mock, orig)}</div>
  </div>;
}

function FromSample({ onClose, onCreate, hasMock }) {
  const [text, setText] = useState(''); const [keep, setKeep] = useState(''); const [items, setItems] = useState(3);
  const [method, setMethod] = useState('GET'); const [path, setPath] = useState('/records'); const [status, setStatus] = useState(200); const [target, setTarget] = useState(hasMock ? 'add' : 'new');
  const [res, setRes] = useState(null); const [err, setErr] = useState('');
  const run = () => { setErr(''); try { setRes(anonymize(text, { keep: keep.split(/[,\s]+/), maxItems: items })); } catch (e) { setRes(null); setErr(e.message); } };
  return (
    <Modal title="Generate a mock response from a sample" onClose={onClose} expandable wide={!!res} footer={res
      ? <><button className="btn" onClick={() => setRes(null)}>Back</button><button className="btn primary" disabled={res.leaks.length > 0} onClick={() => onCreate({ method, path, status, body: res.output, kind: res.kind, target })}>{target === 'add' ? 'Add route to this mock' : 'Create mock'}</button></>
      : <button className="btn" onClick={onClose}>Cancel</button>}>
      {!res ? <>
        <p className="muted" style={{ marginTop: 0 }}>Paste or choose a real JSON or XML response. You get the <b>same structure with fake values</b>: names, ids, amounts, dates and e-mails are replaced, nothing from your sample is stored or sent anywhere. Everything runs in this window.</p>
        <div className="row" style={{ marginBottom: 8 }}><button className="btn sm" onClick={async () => { const f = await pickFile('.json,.xml,.txt'); if (f) setText(await f.text()); }}>Choose a file…</button><span className="muted">or paste below</span></div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', height: 150 }} spellCheck={false} placeholder='{ "employees": [ { "id": "E-1001", "name": "…" } ] }   or   <Response>…</Response>' aria-label="Sample response" />
        <div className="row" style={{ margin: '8px 0', flexWrap: 'wrap' }}>
          <label className="row"><span className="muted" title="If the sample has a list with more entries, only this many are kept in the mock">Max items per list</span><input type="number" min="1" max="1000" value={items} onChange={(e) => setItems(+e.target.value)} style={{ width: 64 }} aria-label="Max items per list" /></label>
          <label className="row grow"><span className="muted">Keep these values as-is</span><input className="grow" value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="field names or exact values, e.g. status, USD, WID" spellCheck={false} /></label></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>“Keep” is for harmless codes (status, currency): type a field name or an exact value, separated by commas. XML attributes like <code>type</code> and <code>version</code> are always kept. Leave it empty if unsure.</div>
        <div className="row" style={{ flexWrap: 'wrap' }}><span className="muted" title="The mock answers this method + path">Route</span><select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 96 }} aria-label="Method">{METHODS.map(m => <option key={m}>{m}</option>)}</select>
          <input className="grow mono" value={path} onChange={(e) => setPath(e.target.value)} aria-label="Route path" /><input type="number" value={status} onChange={(e) => setStatus(+e.target.value)} style={{ width: 70 }} aria-label="Status" title="HTTP status the mock returns (200 = OK, 201 = created, 404 = not found, 500 = server error)" /></div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>The route is what a client calls (method + path); the number on the right is the HTTP status the mock replies with (200 = OK).</div>
        {hasMock && <div className="row" style={{ marginTop: 8 }}><label className="row"><input type="radio" checked={target === 'add'} onChange={() => setTarget('add')} />Add to the open mock</label><label className="row"><input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} />New mock</label></div>}
        {err && <div className="err-text" role="alert" style={{ marginTop: 8 }}>{err}</div>}
        <button className="btn primary" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={run}>Generate preview</button></>
      : <>
        <Preview res={res} original={text} /></>}
    </Modal>
  );
}

function FromCollection({ onClose, onCreate }) {
  const cols = useDocs('collection');
  return (
    <Modal title="Create mock from a collection" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Every request becomes a route. Saved <b>examples</b> (Response → “Save as example”, or imported from Postman/OpenAPI) are used as the responses.</p>
      {cols.items === null ? <Spinner /> : !cols.items.length ? <div className="muted">No collections yet — create or import one in the API module.</div> :
        cols.items.map(c => <div key={c.id} className="tree-item" style={{ padding: '8px 10px' }} onClick={() => onCreate(c)}><Icon n="box" s={15} c="var(--accent2)" /><b className="grow">{c.name}</b><span className="muted">Create mock</span></div>)}
    </Modal>
  );
}

export default function MockModule({ active }) {
  const mocks = useDocs('mock'); const toast = useToast(); const dlg = useDialogs();
  const [sel, setSel] = useState(null); const [rsel, setRsel] = useState(null); const [pick, setPick] = useState(false); const [smp, setSmp] = useState(false); const [wsdl, setWsdl] = useState(false);
  const panel = useSidePanel('mock', 270, active);
  const mock = mocks.items?.find(m => m.id === sel) || null;
  useEffect(() => { if (!sel && mocks.items?.length) setSel(mocks.items[0].id); }, [mocks.items, sel]);
  useEffect(() => { setRsel(mock?.routes?.[0]?.id || null); }, [sel]); // eslint-disable-line
  const save = (m) => mocks.save(m);
  const create = async (name, routes = []) => { const m = { id: newId(), name, enabled: true, cors: true, requireKey: false, key: '', fallback: { status: 404, body: '{"error":"No mock route matches {{method}} {{path}}"}' }, routes }; await mocks.save(m, { immediate: true }); setSel(m.id); return m; };
  const route = mock?.routes?.find(r => r.id === rsel);
  const setRoute = (r) => save({ ...mock, routes: mock.routes.map(x => x.id === r.id ? r : x) });
  const addRoute = () => { const r = { id: rid(), enabled: true, method: 'GET', path: '/new', name: '', status: 200, headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }], body: '{\n  "message": "hello"\n}', delay: 0 }; save({ ...mock, routes: [...(mock.routes || []), r] }); setRsel(r.id); };
  const url = mock ? base(mock.id) : '';
  const copy = (t, msg = 'Copied') => navigator.clipboard?.writeText(t).then(() => toast(msg, 'success'));
  const rotate = async () => { if (!(await dlg.confirm('Generate a new access key?', 'Clients using the old key will get 401 until updated.', false))) return; const r = await api(`/mocks/${mock.id}/rotate-key`, { method: 'POST' }); mocks.setItems(p => p.map(x => x.id === mock.id ? { ...x, key: r.key, requireKey: true } : x)); toast('New key generated', 'success'); };
  const ordered = useMemo(() => mock?.routes || [], [mock]);

  return (
    <>
      {panel.collapsed ? <SideRestore p={panel} /> : <><aside className="side" style={{ width: panel.w }}>
        <div className="row" style={{ padding: 10 }}><b className="grow">Mock servers</b>
          <button className="icon-btn" title="Hide side panel (Ctrl+B)" aria-label="Hide side panel" onClick={panel.toggle}><Icon n="panel" /></button>
          <button className="btn sm" onClick={async () => { const n = await dlg.prompt('New mock server', 'My API mock'); if (n) create(n); }}><Icon n="plus" s={12} />New</button></div>
        <div className="col" style={{ overflow: 'auto', padding: 6, flex: 1 }}>
          {mocks.items === null ? <div className="skeleton" style={{ height: 40, margin: 4 }} /> : mocks.items.map(m => (
            <div key={m.id} className={'tree-item' + (sel === m.id ? ' active' : '')} onClick={() => setSel(m.id)} style={{ padding: '8px 8px' }}>
              <span className="dot" style={{ background: m.enabled === false ? 'var(--muted)' : 'var(--ok)' }} />
              <div className="grow" style={{ minWidth: 0 }}><div className="ellipsis">{m.name}</div><div className="muted" style={{ fontSize: 11 }}>{m.routes?.length || 0} routes</div></div></div>))}
          <div className={'tree-item' + (sel === '__samples' ? ' active' : '')} onClick={() => setSel('__samples')} style={{ padding: '8px 8px', marginTop: 6 }}><Icon n="box" s={14} c="var(--accent2)" /><div className="grow" style={{ minWidth: 0 }}><div className="ellipsis">Sample: Workday-style ERP</div><div className="muted" style={{ fontSize: 11 }}>dummy data · REST + SOAP</div></div></div>
          {mocks.items?.length === 0 && <div className="empty"><div><Icon n="server" s={28} c="var(--muted)" /><p>Fake an API while the real one is being built.</p></div></div>}
        </div>
        <div style={{ padding: 10, borderTop: '1px solid var(--line)' }}><div className="col" style={{ gap: 6 }}><button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setPick(true)}><Icon n="box" s={13} />From a collection…</button>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setWsdl(true)}><Icon n="code" s={13} />From a WSDL (SOAP)…</button>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setSmp(true)} title="Fake data with the structure of a real JSON/XML response"><Icon n="shield" s={13} />From a sample (anonymised)…</button></div></div>
      </aside><SideResizer p={panel} /></>}

      {sel === '__samples' ? <Samples /> : !mock ? <div className="empty grow"><div><Icon n="server" s={34} c="var(--muted)" /><h3>Mock servers</h3><p className="muted" style={{ maxWidth: 420 }}>Create a mock to get a public URL that answers with the responses you define — with path parameters, templating, delays and a live request log.</p>
        <button className="btn primary" onClick={() => setPick(true)}>Create from a collection</button> <button className="btn" onClick={async () => { const n = await dlg.prompt('New mock server', 'My API mock'); if (n) create(n); }}>Blank mock</button></div></div> : (
        <div className="col grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', gap: 10, flexWrap: 'wrap' }}>
            <input value={mock.name} onChange={(e) => save({ ...mock, name: e.target.value })} style={{ fontWeight: 650, fontSize: 14, width: 220 }} aria-label="Mock name" />
            <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={mock.enabled !== false} onChange={(e) => save({ ...mock, enabled: e.target.checked })} />Enabled</label>
            <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={mock.cors !== false} onChange={(e) => save({ ...mock, cors: e.target.checked })} />CORS</label>
            <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={!!mock.requireKey} onChange={async (e) => { if (e.target.checked && !mock.key) { const r = await api(`/mocks/${mock.id}/rotate-key`, { method: 'POST' }).catch(() => null); if (r) return mocks.setItems(p => p.map(x => x.id === mock.id ? { ...x, key: r.key, requireKey: true } : x)); } save({ ...mock, requireKey: e.target.checked }); }} />Require key</label>
            {mock.requireKey && <><code className="mono chip" title="Send as X-Mock-Key header or ?mockKey=">{mock.key}</code><button className="btn sm ghost" onClick={() => copy(mock.key, 'Key copied')}><Icon n="copy" s={12} /></button><button className="btn sm ghost" onClick={rotate}>Rotate</button></>}
            <span className="grow" />
            <button className="btn danger sm" onClick={async () => { if (await dlg.confirm('Delete mock server?', `“${mock.name}” and its URL will stop working.`)) { await mocks.remove(mock.id); setSel(null); } }}><Icon n="trash" s={12} />Delete</button>
          </div>
          <div className="row" style={{ padding: '8px 14px', background: 'var(--panel2)', borderBottom: '1px solid var(--line)' }}>
            <span className="muted">Base URL</span><code className="mono grow ellipsis" style={{ fontSize: 12.5 }}>{url}</code>
            {ordered.some(r => r.soapOperation || r.soapAction) && <span className="chip" style={{ background: 'rgba(167,139,250,.16)', color: '#a78bfa' }} title="POST SOAP requests to the Base URL itself">SOAP endpoint</span>}
            <button className="btn sm" onClick={() => copy(url, 'URL copied')}><Icon n="copy" s={12} />Copy URL</button>
            <button className="btn sm" onClick={() => copy(`curl ${mock.requireKey ? `-H 'X-Mock-Key: ${mock.key}' ` : ''}'${url}${(ordered.find(r => r.enabled !== false && (r.method === 'GET' || r.method === 'ANY'))?.path || '/').replace(/:(\w+)/g, '1').replace('*', 'x')}'`, 'cURL copied')}>cURL</button>
          </div>
          <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
            <div className="col" style={{ width: 300, borderRight: '1px solid var(--line)', minHeight: 0 }}>
              <div className="row" style={{ padding: '8px 10px' }}><b className="grow">Routes</b><button className="btn sm" onClick={addRoute}><Icon n="plus" s={12} />Add route</button></div>
              <div style={{ overflow: 'auto', flex: 1, padding: '0 6px 6px' }}>
                {ordered.map(r => (
                  <div key={r.id} className={'tree-item' + (rsel === r.id ? ' active' : '')} onClick={() => setRsel(r.id)} style={{ opacity: r.enabled === false ? .5 : 1 }}>
                    <input type="checkbox" checked={r.enabled !== false} onClick={(e) => e.stopPropagation()} onChange={(e) => setRoute({ ...r, enabled: e.target.checked })} aria-label="route enabled" />
                    <span className={'method m-' + (r.soapOperation || r.soapAction ? 'SOAP' : r.method)} style={{ width: 44 }}>{r.soapOperation || r.soapAction ? 'SOAP' : r.method}</span><span className="grow ellipsis mono" style={{ fontSize: 12 }} title={r.name}>{r.soapOperation || r.soapAction ? (r.soapOperation || r.soapAction) : r.path}</span>
                    <span className={'chip ' + (r.status < 400 ? 'ok' : 'warn')} style={{ padding: '0 6px' }}>{r.status}</span>
                    <span className="acts"><button className="icon-btn" title="Delete route" onClick={(e) => { e.stopPropagation(); save({ ...mock, routes: ordered.filter(x => x.id !== r.id) }); }}><Icon n="trash" s={12} /></button></span></div>))}
                {!ordered.length && <div className="muted" style={{ padding: 10 }}>No routes yet. Add one, or import a collection.</div>}
                <div className="muted" style={{ padding: '10px 6px', fontSize: 11.5 }}>Routes are matched top to bottom; the first match wins. Unmatched requests get the fallback response.</div>
              </div>
            </div>
            <div className="col grow" style={{ minWidth: 0 }}>
              <div className="col" style={{ flex: 3, minHeight: 0 }}>{route ? <RouteEditor key={route.id} route={route} onChange={setRoute} /> : <div className="empty">Select a route to edit its response</div>}</div>
              <div style={{ flex: 2, minHeight: 0, borderTop: '1px solid var(--line)' }} className="col"><Logs mock={mock} active={active} /></div>
            </div>
          </div>
        </div>)}
      {wsdl && <FromWsdl onClose={() => setWsdl(false)} onCreate={async (m, ep) => { setWsdl(false); const x = await create(`${m.title} (SOAP mock)`, routesFromWsdl(ep)); toast(`Created ${x.routes.length} SOAP routes — POST to the mock URL`, 'success'); }} />}
      {smp && <FromSample hasMock={!!mock && sel !== '__samples'} onClose={() => setSmp(false)} onCreate={async (o) => {
        setSmp(false);
        const xml = o.kind === 'xml';
        const r = { id: rid(), enabled: true, method: o.method, path: o.path.startsWith('/') ? o.path : '/' + o.path, name: 'From sample', status: o.status || 200, headers: [{ key: 'Content-Type', value: xml ? 'text/xml; charset=utf-8' : 'application/json', enabled: true }], body: o.body, delay: 0 };
        if (o.target === 'add' && mock) { await mocks.save({ ...mock, routes: [...(mock.routes || []), r] }, { immediate: true }); setRsel(r.id); toast('Route added with anonymised data', 'success'); }
        else { const m = await create('Mock from sample', [r]); toast('Mock created with anonymised data', 'success'); }
      }} />}
      {pick && <FromCollection onClose={() => setPick(false)} onCreate={async (c) => { setPick(false); const m = await create(c.name + ' (mock)', routesFromCollection(c)); toast(`Created ${m.routes.length} routes from “${c.name}”`, 'success'); }} />}
      {dlg.el}
    </>
  );
}
