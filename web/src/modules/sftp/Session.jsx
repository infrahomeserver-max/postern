import { useState, useEffect, useRef, useCallback } from 'react';
import { setJob } from '../../status.js';
import { api, uid, fmtBytes, pickFile } from '../../api.js';
import { Icon, Modal, useToast, Spinner } from '../../ui.jsx';
import { useDialogs } from '../../dialogs.jsx';
import Pane, { join } from './Pane.jsx';
import { usePrefs, ACTIONS, extOf } from './prefs.js';

const dirCache = new Map(); // `${key}:${path}` → items; shown instantly while the fresh listing loads (stale-while-revalidate)
function useDir(fetcher, initial, key) {
  const [s, setS] = useState({ path: initial, items: null, loading: true, error: '' });
  const seq = useRef(0);
  const go = useCallback(async (path) => {
    const n = ++seq.current; const hit = dirCache.get(key + ':' + path);
    setS(p => ({ path: hit ? path : p.path, items: hit || p.items, loading: true, error: '' }));
    try {
      const r = await fetcher(path);
      if (dirCache.size > 200) dirCache.delete(dirCache.keys().next().value);
      dirCache.set(key + ':' + r.path, r.items);
      if (n === seq.current) setS({ path: r.path, items: r.items, loading: false, error: '' });
    } catch (e) { if (n === seq.current) { dirCache.delete(key + ':' + path); setS(p => ({ ...p, loading: false, error: e.message })); } }
  }, [fetcher, key]);
  return [s, go];
}

function Editor({ sid, path, onClose }) {
  const [text, setText] = useState(null); const [orig, setOrig] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const toast = useToast();
  useEffect(() => { api(`/sftp/${sid}/text?path=${encodeURIComponent(path)}`).then(r => { setText(r.text); setOrig(r.text); }).catch(e => setErr(e.message)); }, [sid, path]);
  const save = async () => { setBusy(true); try { await api(`/sftp/${sid}/text?path=${encodeURIComponent(path)}`, { method: 'PUT', body: { text } }); setOrig(text); toast('Saved to server', 'success'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  return (
    <Modal wide title={`Edit ${path}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={busy || text === orig || text === null} onClick={save}>{busy ? <Spinner /> : 'Save'}</button></>}>
      {err ? <div className="err-text">{err}</div> : text === null ? <Spinner /> :
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} style={{ width: '100%', height: 380 }}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (text !== orig) save(); } }} />}
    </Modal>
  );
}

function ChooseAction({ ctx, localEnabled, onClose, onPick }) {
  const [always, setAlways] = useState(false); const ext = extOf(ctx.it.name);
  const acts = ctx.kind === 'remote' ? [['transfer', localEnabled ? 'Download to local pane' : 'Download'], ['edit', ACTIONS.edit], ['preview', ACTIONS.preview]] : [['transfer', 'Upload to server'], ['preview', ACTIONS.preview]];
  return (
    <Modal title={`Open ${ctx.it.name} with…`} onClose={onClose}>
      <div className="col" style={{ gap: 6 }}>{acts.map(([a, l]) => <button key={a} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => onPick(a, always)}>{l}</button>)}</div>
      {ext && <label className="row" style={{ gap: 6, marginTop: 12 }}><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />Always use this for <b>.{ext}</b> files</label>}
    </Modal>);
}

export default function Session({ sess, localEnabled, active, onClose }) {
  const { sid } = sess;
  const toast = useToast(); const dlg = useDialogs();
  const remoteFetch = useCallback((p) => api(`/sftp/${sid}/list?path=${encodeURIComponent(p)}`), [sid]);
  const localFetch = useCallback((p) => api(`/local/list?path=${encodeURIComponent(p)}`), []);
  const [remote, goRemote] = useDir(remoteFetch, sess.cwd, sid);
  const [local, goLocal] = useDir(localFetch, '/', 'local');
  const [selR, setSelR] = useState(new Set()); const [selL, setSelL] = useState(new Set());
  const [statusR, setStatusR] = useState({}); const [queue, setQueue] = useState([]); const [editing, setEditing] = useState(null);
  const { prefs, setAssoc, actionFor } = usePrefs(); const [verify, setVerify] = useState(false); const [choose, setChoose] = useState(null);
  const remoteRef = useRef(remote); remoteRef.current = remote; const localRef = useRef(local); localRef.current = local;

  useEffect(() => { goRemote(sess.cwd); }, []); // eslint-disable-line
  useEffect(() => { if (localEnabled) goLocal('/'); }, [localEnabled]); // eslint-disable-line
  const go = (setSel, fn) => (p) => { setSel(new Set()); fn(p); };

  /* ---- transfer queue ---- */
  const upd = (id, patch) => setQueue(q => q.map(x => x.id === id ? { ...x, ...patch } : x));
  const pool = useRef({ running: 0, wait: [] });
  const runLimited = (fn) => new Promise((res) => {
    const p = pool.current; const go = () => { p.running++; fn().finally(() => { p.running--; p.wait.shift()?.(); res(); }); };
    p.running < 2 ? go() : p.wait.push(go);
  });
  const uploadBrowser = (file, dir) => {
    const id = uid(); const target = join(dir, file.name);
    setQueue(q => [...q, { id, name: file.name, dir: 'up', via: 'browser', done: 0, total: file.size, state: 'queued', t: Date.now() }]);
    return runLimited(() => new Promise((resolve) => {
      const x = new XMLHttpRequest(); const t0 = Date.now();
      x.open('PUT', `/api/sftp/${sid}/upload?path=${encodeURIComponent(target)}`);
      x.setRequestHeader('X-Requested-With', 'devhub'); x.setRequestHeader('Content-Type', 'application/octet-stream');
      upd(id, { state: 'running' });
      x.upload.onprogress = (e) => upd(id, { done: e.loaded, total: e.total, speed: e.loaded / Math.max(0.2, (Date.now() - t0) / 1000) });
      x.onload = () => { const ok = x.status < 300; let msg = ''; try { msg = JSON.parse(x.responseText).error; } catch { /* */ } upd(id, { state: ok ? 'done' : 'error', error: msg || '', done: ok ? file.size : 0 }); resolve(); };
      x.onerror = () => { upd(id, { state: 'error', error: 'Network error' }); resolve(); };
      x.send(file);
    })).then(() => { if (remoteRef.current.path === dir) goRemote(dir); });
  };
  const serverJob = async (dir, local, remotePath, name) => {
    try { const { id } = await api(`/sftp/${sid}/transfer`, { method: 'POST', body: { dir, local, remote: remotePath, verify } }); setQueue(q => [...q, { id, name, dir, via: 'server', done: 0, total: 0, state: 'queued', t: Date.now() }]); }
    catch (e) { toast(e.message, 'error'); }
  };

  // poll server-side jobs only while any is active
  const activeJobs = queue.some(q => q.via === 'server' && ['queued', 'running'].includes(q.state));
  useEffect(() => {
    if (!activeJobs) return;
    const iv = setInterval(async () => {
      try {
        const list = await api('/sftp/jobs'); const m = new Map(list.map(j => [j.id, j]));
        setQueue(q => q.map(x => { const j = m.get(x.id); if (!j || x.via !== 'server') return x; const speed = (j.done - x.done) / 0.6; return { ...x, done: j.done, total: j.total, state: j.state, error: j.error, speed: j.state === 'running' ? Math.max(0, speed) : 0 }; }));
        list.forEach(j => { const prev = queue.find(x => x.id === j.id); if (prev && ['queued', 'running'].includes(prev.state) && ['done', 'error', 'cancelled'].includes(j.state)) { j.dir === 'up' ? goRemote(remoteRef.current.path) : goLocal(localRef.current.path); } });
      } catch { /* ignore */ }
    }, 600);
    return () => clearInterval(iv);
  }, [activeJobs, queue]); // eslint-disable-line

  useEffect(() => { // publish running transfers to the global status bar
    const act = queue.filter(q => ['queued', 'running'].includes(q.state));
    setJob('sftp:' + sid, act.length ? { label: act.length === 1 ? `${act[0].dir === 'up' ? 'Uploading' : 'Downloading'} ${act[0].name}` : `${act.length} transfers running`, done: act.reduce((a, x) => a + (x.done || 0), 0), total: act.reduce((a, x) => a + (x.total || 0), 0) } : null);
  }, [queue, sid]);
  useEffect(() => () => setJob('sftp:' + sid, null), [sid]);

  /* ---- actions ---- */
  const refresh = (which) => { if (which !== 'local') goRemote(remoteRef.current.path); if (which !== 'remote' && localEnabled) goLocal(localRef.current.path); };
  const dlOne = (path) => { const a = document.createElement('a'); a.href = `/api/sftp/${sid}/download?path=${encodeURIComponent(path)}`; a.click(); };
  const remoteAction = async (name, items) => {
    const dir = remoteRef.current.path;
    switch (name) {
      case 'refresh': return goRemote(dir);
      case 'mkdir': { const n = await dlg.prompt('New remote folder', ''); if (n) api(`/sftp/${sid}/mkdir`, { method: 'POST', body: { path: join(dir, n) } }).then(() => goRemote(dir)).catch(e => toast(e.message, 'error')); return; }
      case 'rename': { const n = await dlg.prompt('Rename', items[0].name); if (n && n !== items[0].name) api(`/sftp/${sid}/rename`, { method: 'POST', body: { from: join(dir, items[0].name), to: join(dir, n) } }).then(() => goRemote(dir)).catch(e => toast(e.message, 'error')); return; }
      case 'delete': { if (await dlg.confirm('Delete from server?', items.length === 1 ? `“${items[0].name}” will be permanently deleted${items[0].type === 'dir' ? ' with everything inside it' : ''}.` : `${items.length} items will be permanently deleted.`)) api(`/sftp/${sid}/delete`, { method: 'POST', body: { paths: items.map(i => join(dir, i.name)) } }).then(() => { setSelR(new Set()); goRemote(dir); }).catch(e => toast(e.message, 'error')); return; }
      case 'chmod': { const m = await dlg.prompt('Permissions (octal)', '644', 'e.g. 644 or 755'); if (m) api(`/sftp/${sid}/chmod`, { method: 'POST', body: { path: join(dir, items[0].name), mode: m } }).then(() => goRemote(dir)).catch(e => toast(e.message, 'error')); return; }
      case 'edit': return setEditing(join(dir, items[0].name));
      case 'preview': return window.open(`/api/sftp/${sid}/view?path=${encodeURIComponent(join(dir, items[0].name))}`, '_blank', 'noopener');
      case 'dblclick': return runFile('remote', items[0], actionFor(items[0].name));
      case 'copyPath': navigator.clipboard?.writeText(join(dir, items[0].name)); return toast('Path copied', 'success');
      case 'uploadPick': { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.onchange = () => [...i.files].forEach(f => uploadBrowser(f, dir)); i.click(); return; }
      case 'download':
        for (const it of items) {
          if (localEnabled) serverJob('down', localRef.current.path, join(dir, it.name), it.name).then(() => {});
          else if (it.type === 'file') dlOne(join(dir, it.name));
          else toast('Folder download needs the Local pane — set DEVHUB_LOCAL_ROOT on the server', 'error');
        }
        if (localEnabled) { /* local dest is the folder itself for single files */ }
    }
  };
  // for server downloads the "local" target must be a full path: fix up by wrapping serverJob
  const downloadServer = (items) => items.forEach(it => serverJob('down', join(localRef.current.path, it.name), join(remoteRef.current.path, it.name), it.name));
  const localAction = async (name, items) => {
    const dir = localRef.current.path;
    switch (name) {
      case 'refresh': return goLocal(dir);
      case 'mkdir': { const n = await dlg.prompt('New local folder', ''); if (n) api('/local/mkdir', { method: 'POST', body: { path: join(dir, n) } }).then(() => goLocal(dir)).catch(e => toast(e.message, 'error')); return; }
      case 'rename': { const n = await dlg.prompt('Rename', items[0].name); if (n && n !== items[0].name) api('/local/rename', { method: 'POST', body: { from: join(dir, items[0].name), to: join(dir, n) } }).then(() => goLocal(dir)).catch(e => toast(e.message, 'error')); return; }
      case 'delete': { if (await dlg.confirm('Delete local items?', `${items.length} item(s) will be permanently deleted.`)) api('/local/delete', { method: 'POST', body: { paths: items.map(i => join(dir, i.name)) } }).then(() => { setSelL(new Set()); goLocal(dir); }).catch(e => toast(e.message, 'error')); return; }
      case 'upload': return items.forEach(it => serverJob('up', join(dir, it.name), join(remoteRef.current.path, it.name), it.name));
      case 'dblclick': return runFile('local', items[0], actionFor(items[0].name));
    }
  };
  /* double-click / Open with: resolve the action for this file type (per-extension default → global default) */
  const runFile = (kind, it, act) => {
    if (act === 'ask') return setChoose({ kind, it });
    if (kind === 'remote') {
      if (act === 'edit') return remoteAction('edit', [it]);
      if (act === 'preview') return remoteAction('preview', [it]);
      return onRemoteAction('download', [it]);
    }
    if (act === 'preview') return window.open(`/api/local/view?path=${encodeURIComponent(join(localRef.current.path, it.name))}`, '_blank', 'noopener');
    return localAction('upload', [it]);   // local pane has no editor: "edit" falls back to upload
  };
  const onRemoteAction = (n, items) => n === 'download' && localEnabled ? downloadServer(items) : remoteAction(n, items);
  const dropToRemote = (d) => d.names.forEach(n => serverJob('up', join(d.path, n), join(remoteRef.current.path, n), n));
  const dropToLocal = (d) => d.names.forEach(n => serverJob('down', join(localRef.current.path, n), join(d.path, n), n));

  const openWith = (kind, it) => {
    const ext = extOf(it.name), cur = prefs.assoc[ext];
    const acts = kind === 'remote' ? ['transfer', 'edit', 'preview'] : ['transfer', 'preview'];
    const label = (a) => a === 'transfer' ? (kind === 'remote' ? (localEnabled ? 'Download to local pane' : 'Download') : 'Upload to server') : ACTIONS[a];
    const items = acts.map(a => ({ label: label(a), run: () => runFile(kind, it, a) }));
    if (!ext) return { label: 'Open with', sub: items };
    return { label: 'Open with', sub: [...items, '-', ...[...acts, 'ask'].map(a => ({ label: `Always: ${a === 'ask' ? 'ask me' : label(a)} for .${ext}`, checked: cur === a, run: () => setAssoc(ext, a) })), { label: `Reset .${ext} to default (${prefs.default})`, disabled: !cur, run: () => setAssoc(ext, null) }] };
  };
  const menu = (kind) => (it, items) => {
    if (kind === 'remote') return it ? [
      it.type === 'dir' ? { label: 'Open', run: () => goRemote(join(remoteRef.current.path, it.name)) } : { label: 'Open (default action)', run: () => runFile('remote', it, actionFor(it.name)) },
      ...(it.type === 'file' && items.length === 1 ? [openWith('remote', it)] : []),
      { label: localEnabled ? 'Download to local pane' : 'Download', run: () => onRemoteAction('download', items) }, '-',
      { label: 'Rename', disabled: items.length !== 1, run: () => remoteAction('rename', items) }, { label: 'Permissions…', disabled: items.length !== 1, run: () => remoteAction('chmod', items) },
      { label: 'Copy path', disabled: items.length !== 1, run: () => remoteAction('copyPath', items) }, '-', { label: 'Delete', run: () => remoteAction('delete', items) }]
      : [{ label: 'New folder', run: () => remoteAction('mkdir', []) }, { label: 'Upload files…', run: () => remoteAction('uploadPick', []) }, { label: 'Refresh', run: () => goRemote(remoteRef.current.path) }];
    return it ? [it.type === 'dir' ? { label: 'Open', run: () => goLocal(join(localRef.current.path, it.name)) } : { label: 'Open (default action)', run: () => runFile('local', it, actionFor(it.name)) },
      ...(it.type === 'file' && items.length === 1 ? [openWith('local', it)] : []),
      { label: 'Upload to server', run: () => localAction('upload', items) }, '-', { label: 'Rename', disabled: items.length !== 1, run: () => localAction('rename', items) }, { label: 'Delete', run: () => localAction('delete', items) }]
      : [{ label: 'New folder', run: () => localAction('mkdir', []) }, { label: 'Refresh', run: () => goLocal(localRef.current.path) }];
  };

  const cancel = (x) => api(`/sftp/jobs/${x.id}/cancel`, { method: 'POST' }).then(() => upd(x.id, { state: 'cancelled' }));
  const finished = queue.filter(q => ['done', 'error', 'cancelled'].includes(q.state));

  return (
    <div className="col" style={{ flex: 1, minWidth: 0, display: active ? 'flex' : 'none' }}>
      <div className="row" style={{ flex: 1, minHeight: 0, padding: 10, gap: 10, alignItems: 'stretch' }}>
        {localEnabled && <Pane kind="local" title="Local" {...local} onGo={go(setSelL, goLocal)} onAction={localAction} selection={selL} setSelection={setSelL} menuFor={menu('local')} onDropItems={dropToLocal} />}
        <Pane kind="remote" title={sess.name} {...remote} onGo={go(setSelR, goRemote)} onAction={onRemoteAction} selection={selR} setSelection={setSelR} menuFor={menu('remote')}
          onDropItems={dropToRemote} onDropFiles={(files) => files.forEach(f => uploadBrowser(f, remoteRef.current.path))} onStatus={setStatusR} />
      </div>
      {queue.length > 0 && (
        <div className="queue" aria-label="Transfer queue">
          <div className="row" style={{ padding: '4px 12px', background: 'var(--panel2)', position: 'sticky', top: 0 }}>
            <b>Transfers</b><span className="muted">{queue.length - finished.length} active · {finished.length} finished</span><span className="grow" />
            {finished.length > 0 && <button className="btn sm ghost" onClick={() => setQueue(q => q.filter(x => !finished.includes(x)))}>Clear finished</button>}
          </div>
          {queue.map(x => (
            <div key={x.id} className="q-row">
              <Icon n={x.dir === 'up' ? 'upload' : 'download'} s={14} c={x.dir === 'up' ? 'var(--info)' : 'var(--ok)'} />
              <span className="ellipsis" title={x.name}>{x.name}{x.error && <span style={{ color: 'var(--err)' }}> — {x.error}</span>}</span>
              <div><div className="progress"><div style={{ width: (x.state === 'done' ? 100 : x.total ? (x.done / x.total) * 100 : 0) + '%', background: x.state === 'error' ? 'var(--err)' : x.state === 'done' ? 'var(--ok)' : undefined }} /></div></div>
              <span className="muted" style={{ fontSize: 11.5 }}>{x.state === 'running' ? `${fmtBytes(x.done)} / ${fmtBytes(x.total)}` : x.state === 'done' ? fmtBytes(x.total || x.done) : x.state}{x.state === 'running' && x.speed ? ` · ${fmtBytes(x.speed)}/s` : ''}</span>
              <span style={{ textAlign: 'right' }}>{x.via === 'server' && ['queued', 'running'].includes(x.state) && <button className="btn sm ghost" onClick={() => cancel(x)}>Cancel</button>}</span>
            </div>))}
        </div>)}
      <div className="statusbar">
        <span><span className="dot" style={{ background: 'var(--ok)' }} /> Connected to {sess.name}</span>
        <span>{statusR.count ?? 0} items</span>{statusR.selected > 0 && <span>{statusR.selected} selected · {fmtBytes(statusR.bytes)}</span>}
        <span className="grow" /><label className="row" style={{ gap: 4 }} title="After each transfer, compare SHA-256 of both copies (size is always checked)"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />Verify checksums</label><span title={sess.fingerprint}>Host key SHA-256: {(sess.fingerprint || '').slice(0, 16)}…</span>
        <button className="btn sm ghost" onClick={onClose}>Disconnect</button>
      </div>
      {dlg.el}
      {choose && <ChooseAction ctx={choose} localEnabled={localEnabled} onClose={() => setChoose(null)} onPick={(a, always) => { const { kind, it } = choose; setChoose(null); if (always && extOf(it.name)) setAssoc(extOf(it.name), a); runFile(kind, it, a); }} />}
      {editing && <Editor sid={sid} path={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
