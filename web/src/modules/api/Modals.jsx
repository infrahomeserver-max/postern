import { useState, useEffect, useRef } from 'react';
import { Modal, Tabs, KVEditor, Icon, useToast, Spinner } from '../../ui.jsx';
import { uid, download, pickFile, api } from '../../api.js';
import { execute, flatRequests, prepare, envToVars } from './engine.js';

/* ---------- Environments ---------- */
export function EnvModal({ envs, globals, setGlobals, onSave, onRemove, onClose, activeEnvId, setActiveEnvId }) {
  const [sel, setSel] = useState(activeEnvId || '__globals');
  const toast = useToast();
  const isG = sel === '__globals';
  const env = isG ? { id: '__globals', name: 'Globals', values: Object.entries(globals).map(([key, value]) => ({ key, value, enabled: true })) } : envs.find(e => e.id === sel);
  const setValues = (values) => isG ? setGlobals(Object.fromEntries(values.filter(v => v.key).map(v => [v.key, v.value]))) : onSave({ ...env, values });
  const add = () => { const e = { id: uid(), name: 'New environment', values: [] }; onSave(e, true); setSel(e.id); };
  const exp = () => download(`${env.name}.postman_environment.json`, JSON.stringify({ name: env.name, values: env.values.map(v => ({ key: v.key, value: v.value, enabled: v.enabled !== false, type: v.secret ? 'secret' : 'default' })), _postman_variable_scope: 'environment' }, null, 2));
  return (
    <Modal wide title="Manage environments" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="row" style={{ alignItems: 'stretch', gap: 16, minHeight: 320 }}>
        <div className="col" style={{ width: 210, gap: 2 }}>
          <div className={'tree-item' + (isG ? ' active' : '')} onClick={() => setSel('__globals')}><Icon n="globe" s={14} />Globals</div>
          {envs.map(e => <div key={e.id} className={'tree-item' + (sel === e.id ? ' active' : '')} onClick={() => setSel(e.id)}>
            <span className="grow ellipsis">{e.name}</span>{activeEnvId === e.id && <span className="chip ok" style={{ padding: '0 6px' }}>active</span>}</div>)}
          <button className="btn sm" style={{ marginTop: 8 }} onClick={add}><Icon n="plus" s={12} />New environment</button>
        </div>
        <div className="grow col" style={{ gap: 10 }}>
          {env ? <>
            <div className="row">
              {!isG && <input value={env.name} onChange={(e) => onSave({ ...env, name: e.target.value })} style={{ fontWeight: 600, width: 260 }} aria-label="Environment name" />}
              {isG && <b>Global variables</b>}
              <span className="grow" />
              {!isG && <button className="btn sm" onClick={() => { setActiveEnvId(env.id); toast(`"${env.name}" is now active`, 'success'); }}>Set active</button>}
              {!isG && <button className="btn sm" onClick={exp}><Icon n="download" s={12} />Export</button>}
              {!isG && <button className="btn sm danger" onClick={() => { onRemove(env.id); setSel('__globals'); if (activeEnvId === env.id) setActiveEnvId(''); }}><Icon n="trash" s={12} />Delete</button>}
            </div>
            <div style={{ overflow: 'auto', maxHeight: 340 }}><KVEditor rows={env.values} onChange={setValues} keyPh="Variable" valPh="Value" secretValues /></div>
            {!isG && <p className="muted" style={{ margin: 0 }}>Use <code>{'{{variable}}'}</code> anywhere in a request. Scripts can update them with <code>pm.environment.set()</code>.</p>}
          </> : null}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Import ---------- */
export function ImportModal({ onClose, onApply }) {
  const [text, setText] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false); const [url, setUrl] = useState('');
  const toast = useToast();
  const run = async (src, baseUrl = '') => {
    setBusy(true); setErr('');
    try { const { importText } = await import('./convert.js'); const res = await importText(src, { baseUrl }); await onApply(res); if (res.warnings?.length) toast(`Imported with ${res.warnings.length} warning(s): ${res.warnings[0]}`, 'info'); onClose(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const fromUrl = async () => {
    setBusy(true); setErr('');
    try { const u = url.trim(); const { fetchViaProxy } = await import('./convert.js'); const src = await fetchViaProxy(u); setBusy(false); await run(src, u); }
    catch (e) { setErr('Couldn’t download that URL: ' + e.message); setBusy(false); }
  };
  const files = async (list) => { for (const f of list) await run(await f.text()); };
  return (
    <Modal title="Import" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!text.trim() || busy} onClick={() => run(text)}>{busy ? <Spinner /> : 'Import'}</button></>}>
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); files([...e.dataTransfer.files]); }}
        style={{ border: `2px dashed ${drag ? 'var(--accent)' : 'var(--line)'}`, borderRadius: 10, padding: 22, textAlign: 'center', marginBottom: 12 }}>
        <Icon n="upload" s={24} c="var(--muted)" />
        <div style={{ margin: '8px 0' }}>Drop files here, or <button className="btn sm" onClick={async () => { const f = await pickFile('.json,.txt,.wsdl,.xml'); if (f) files([f]); }}>choose a file</button></div>
        <div className="muted">WSDL (SOAP) · Postman collections & environments (v2.x) · OpenAPI 3 / Swagger JSON · Postern backups</div>
      </div>
      <div className="muted" style={{ marginBottom: 6 }}>…or a URL (WSDL, e.g. <code>https://host/service?wsdl</code>, or an OpenAPI JSON)</div>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); if (url.trim()) fromUrl(); }}>
        <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/service?wsdl" aria-label="Import URL" spellCheck={false} /><button className="btn" disabled={!url.trim() || busy}>Import from URL</button></form>
      <div className="muted" style={{ marginBottom: 6 }}>…or paste a cURL command / JSON / WSDL XML</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{"a":1}'`} style={{ width: '100%', height: 110 }} spellCheck={false} />
      {err && <div className="err-text" role="alert" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}

/* ---------- Code generation ---------- */
export function CodeModal({ prepared, onClose }) {
  const [lang, setLang] = useState('curl'); const [code, setCode] = useState(''); const toast = useToast();
  useEffect(() => { import('./convert.js').then(m => setCode(m.codegen(lang, prepared))); }, [lang, prepared]);
  return (
    <Modal wide title="Generate code" onClose={onClose} footer={<button className="btn" onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Copied', 'success'))}><Icon n="copy" s={13} />Copy</button>}>
      <Tabs value={lang} onChange={setLang} tabs={[{ id: 'curl', label: 'cURL' }, { id: 'fetch', label: 'JavaScript (fetch)' }, { id: 'python', label: 'Python (requests)' }]} />
      <pre className="code" style={{ background: 'var(--input)', borderRadius: 8, marginTop: 10, maxHeight: 360 }}>{code}</pre>
    </Modal>
  );
}

/* ---------- Save to collection ---------- */
export function SaveModal({ collections, name: n0, onSave, onClose }) {
  const [name, setName] = useState(n0); const [cid, setCid] = useState(collections[0]?.id || '__new'); const [newName, setNewName] = useState('My Collection');
  return (
    <Modal title="Save request" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), cid, newName.trim())}>Save</button></>}>
      <div className="form"><label>Name</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <label>Collection</label><select value={cid} onChange={(e) => setCid(e.target.value)}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ New collection…</option></select>
        {cid === '__new' && <><label>New name</label><input value={newName} onChange={(e) => setNewName(e.target.value)} /></>}</div>
    </Modal>
  );
}

/* ---------- Collection runner ---------- */
export function RunnerModal({ collection, env, globals, onClose, onEnvChanged }) {
  const [rows, setRows] = useState([]); const [state, setState] = useState('idle'); const [delay, setDelay] = useState(0); const [iter, setIter] = useState(1);
  const stop = useRef(false);
  const list = flatRequests(collection.items);
  const start = async () => {
    stop.current = false; setState('running'); setRows([]);
    const scope = { env: envToVars(env), globals: { ...globals }, vars: {} };
    for (let n = 0; n < iter && !stop.current; n++) {
      for (const { req, path } of list) {
        if (stop.current) break;
        const row = { key: uid(), name: (path ? path + ' / ' : '') + req.name, method: req.method, n: n + 1 };
        try { const r = await execute(req, scope); Object.assign(row, { status: r.resp.status, ms: r.resp.timeMs, tests: r.tests }); }
        catch (e) { Object.assign(row, { error: e.message, tests: [] }); }
        setRows(p => [...p, row]);
        if (delay) await new Promise(r => setTimeout(r, delay));
      }
    }
    onEnvChanged?.(scope.env, scope.globals);
    setState('done');
  };
  const total = rows.reduce((a, r) => a + r.tests.length, 0), pass = rows.reduce((a, r) => a + r.tests.filter(t => t.pass).length, 0);
  const failedReq = rows.filter(r => r.error || r.tests.some(t => !t.pass)).length;
  return (
    <Modal wide title={`Run “${collection.name}”`} onClose={() => { stop.current = true; onClose(); }}
      footer={<>{rows.length > 0 && <button className="btn" onClick={() => download(`${collection.name}-run.json`, JSON.stringify(rows, null, 2))}><Icon n="download" s={13} />Export results</button>}
        {state === 'running' ? <button className="btn danger" onClick={() => { stop.current = true; }}>Stop</button> : <button className="btn primary" onClick={start}><Icon n="play" s={12} />{state === 'done' ? 'Run again' : 'Run'}</button>}</>}>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="chip">{list.length} requests</span><span className="chip">Env: {env?.name || 'none'}</span>
        <label className="row">Iterations <input type="number" min="1" max="100" value={iter} onChange={(e) => setIter(Math.max(1, +e.target.value || 1))} style={{ width: 64 }} /></label>
        <label className="row">Delay (ms) <input type="number" min="0" max="10000" value={delay} onChange={(e) => setDelay(Math.max(0, +e.target.value || 0))} style={{ width: 76 }} /></label>
        <span className="grow" />
        {rows.length > 0 && <><span className={'chip ' + (failedReq ? 'err' : 'ok')}>{rows.length - failedReq}/{rows.length} requests OK</span>{total > 0 && <span className={'chip ' + (pass === total ? 'ok' : 'err')}>{pass}/{total} tests passed</span>}</>}
      </div>
      <table className="kv"><thead><tr><th>#</th><th>Request</th><th>Status</th><th>Time</th><th>Tests</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.key}>
          <td style={{ padding: '5px 8px' }} className="muted">{r.n}</td>
          <td style={{ padding: '5px 8px' }}><span className={'method m-' + r.method}>{r.method}</span> {r.name}</td>
          <td style={{ padding: '5px 8px' }}>{r.error ? <span className="chip err" title={r.error}>error</span> : <span className={'chip ' + (r.status < 400 ? 'ok' : 'err')}>{r.status}</span>}</td>
          <td style={{ padding: '5px 8px' }}>{r.ms != null ? r.ms + ' ms' : ''}</td>
          <td style={{ padding: '5px 8px' }}>{r.error ? <span className="muted">{r.error}</span> : r.tests.length ? <>{r.tests.filter(t => t.pass).length}/{r.tests.length}{r.tests.filter(t => !t.pass).map((t, i) => <div key={i} className="muted" style={{ color: 'var(--err)' }}>✗ {t.name}: {t.error}</div>)}</> : <span className="muted">—</span>}</td></tr>)}
          {state === 'running' && <tr><td colSpan="5" style={{ padding: 8 }}><Spinner /> Running…</td></tr>}
          {!rows.length && state === 'idle' && <tr><td colSpan="5" className="muted" style={{ padding: 16, textAlign: 'center' }}>Press Run to execute every request in order. Scripts can pass variables between requests.</td></tr>}</tbody></table>
    </Modal>
  );
}
