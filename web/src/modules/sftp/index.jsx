import { useSidePanel, SideResizer, SideRestore } from '../../ui.jsx';
import { useState, useEffect, useCallback } from 'react';
import { api, uid, download, pickFile } from '../../api.js';
import { Icon, Modal, useToast, Spinner } from '../../ui.jsx';
import { useDialogs } from '../../dialogs.jsx';
import Session from './Session.jsx';

const blank = () => ({ id: uid(), name: '', host: '', port: 22, username: '', authType: 'password', password: '', privateKey: '', passphrase: '', defaultPath: '', folder: '', compress: false });

/* FileZilla sitemanager.xml → Postern sites (SFTP entries only) */
function parseFileZilla(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');
  const out = [];
  doc.querySelectorAll('Server').forEach(s => {
    const g = (t) => s.querySelector(`:scope > ${t}`);
    if (g('Protocol')?.textContent !== '1') return;
    const passEl = g('Pass'); let password = passEl?.textContent || '';
    if (passEl?.getAttribute('encoding') === 'base64') { try { password = atob(password); } catch { password = ''; } }
    const folder = s.parentElement?.tagName === 'Folder' ? [...s.parentElement.childNodes].find(n => n.nodeType === 3 && n.textContent.trim())?.textContent.trim() || '' : '';
    out.push({ id: uid(), name: g('Name')?.textContent?.trim() || g('Host')?.textContent, host: g('Host')?.textContent || '', port: Number(g('Port')?.textContent) || 22, username: g('User')?.textContent || '', authType: 'password', password, folder });
  });
  return out;
}

const strip = ({ hasPassword, hasKey, hasPassphrase, _updated, hostKey, ...s }) => s;

function SiteEditor({ site, isNew, reload, onConnect, onDeleted, busy }) {
  const [draft, setDraft] = useState({ ...site, password: undefined, privateKey: undefined, passphrase: undefined });
  const [saving, setSaving] = useState(false); const toast = useToast(); const dlg = useDialogs();
  useEffect(() => { setDraft({ ...site, password: undefined, privateKey: undefined, passphrase: undefined }); }, [site.id]); // eslint-disable-line
  const set = (p) => setDraft(d => ({ ...d, ...p }));
  const save = async () => { setSaving(true); try { await api(`/sites/${draft.id}`, { method: 'PUT', body: draft }); await reload(); toast('Site saved', 'success'); return true; } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); } };
  const remove = async () => { if (await dlg.confirm('Delete site?', `“${draft.name || draft.host}” and its saved credentials will be removed.`)) { await api(`/sites/${draft.id}`, { method: 'DELETE' }); await reload(); onDeleted(); } };
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="row" style={{ marginBottom: 14 }}><h3 style={{ margin: 0 }} className="grow">{isNew ? 'New site' : draft.name || draft.host}</h3>
          {draft.hostKey && <span className="chip ok" title={draft.hostKey}><Icon n="shield" s={11} />Host key pinned</span>}</div>
        <div className="form">
          <label>Name</label><input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Production web server" />
          <label>Host</label><div className="row"><input className="grow" value={draft.host} onChange={(e) => set({ host: e.target.value })} placeholder="sftp.example.com" aria-label="Host" /><input type="number" value={draft.port} onChange={(e) => set({ port: e.target.value })} style={{ width: 80 }} aria-label="Port" /></div>
          <label>Username</label><input value={draft.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" aria-label="Username" />
          <label>Authentication</label><select value={draft.authType} onChange={(e) => set({ authType: e.target.value })}><option value="password">Password</option><option value="key">Private key</option><option value="agent">SSH agent</option><option value="interactive">Password + verification code (keyboard-interactive)</option></select>
          {draft.authType === 'agent' && <><span /><span className="muted">Uses the keys loaded in your SSH agent (ssh-agent, Pageant, or the Windows OpenSSH agent). Nothing secret is stored in Postern.</span></>}
          {draft.authType === 'interactive' && <><label>Code prompt</label><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={draft.askCode !== false} onChange={(e) => set({ askCode: e.target.checked })} />Ask for a one-time code each time I connect</label></>}
          {(draft.authType === 'password' || draft.authType === 'interactive') ? <><label>Password</label><input type="password" autoComplete="new-password" value={draft.password ?? ''} placeholder={draft.hasPassword ? '•••••••• (saved, leave blank to keep)' : ''} onChange={(e) => set({ password: e.target.value })} aria-label="Password" /></> : draft.authType === 'agent' ? null : <>
            <label>Private key</label><div className="col" style={{ gap: 6 }}><textarea rows={4} value={draft.privateKey ?? ''} onChange={(e) => set({ privateKey: e.target.value })} placeholder={draft.hasKey ? '(saved — paste to replace)' : '-----BEGIN OPENSSH PRIVATE KEY-----'} spellCheck={false} />
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { const f = await pickFile(); if (f) set({ privateKey: await f.text() }); }}>Load key file…</button></div>
            <label>Passphrase</label><input type="password" autoComplete="new-password" value={draft.passphrase ?? ''} placeholder={draft.hasPassphrase ? '(saved)' : 'optional'} onChange={(e) => set({ passphrase: e.target.value })} /></>}
          <label>Start folder</label><input value={draft.defaultPath} onChange={(e) => set({ defaultPath: e.target.value })} placeholder="/var/www (optional)" />
          <label>Group</label><input value={draft.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="optional" />
          <label>Compression</label><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!draft.compress} onChange={(e) => set({ compress: e.target.checked })} />Compress the SSH stream <span className="muted">(helps on slow links with text files; leave off on fast LANs)</span></label>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          {!isNew && <button className="btn danger" onClick={remove}><Icon n="trash" s={13} />Delete</button>}
          <span className="grow" />
          <button className="btn" onClick={save} disabled={saving || !draft.host}>Save</button>
          <button className="btn primary" disabled={busy || !draft.host || !draft.username} onClick={async () => { if (await save()) onConnect(draft.id); }}>Save & Connect</button>
        </div>
        <p className="muted" style={{ fontSize: 11.5 }}><Icon n="lock" s={11} /> Passwords, keys and passphrases are encrypted at rest (AES-256-GCM) and never sent back to the browser.</p>
      </div>
      {dlg.el}
    </div>
  );
}

function SitesSidebar({ panel, sites, editing, setEditing, connect, busy, reload, onNew, quick, setQuick, saveQuick, setSaveQuick, sessions }) {
  const toast = useToast();
  const importFile = async () => {
    const f = await pickFile('.xml,.json'); if (!f) return;
    try {
      const t = await f.text(); const items = t.trim().startsWith('<') ? parseFileZilla(t) : JSON.parse(t).sites || JSON.parse(t);
      if (!Array.isArray(items) || !items.length) throw new Error('No SFTP sites found in that file');
      await api('/sites/bulk', { method: 'POST', body: { items: items.map(s => ({ ...strip(s), id: s.id || uid() })) } });
      await reload(); toast(`Imported ${items.length} site(s)`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const exportSites = () => download('devhub-sites.json', JSON.stringify({ devhub: 'sites', note: 'Passwords and keys are not exported', sites: sites.map(strip) }, null, 2));
  const grouped = (sites || []).reduce((m, s) => ((m[s.folder || ''] ||= []).push(s), m), {});
  const live = new Set(sessions.map(s => s.siteId));
  if (panel.collapsed) return <SideRestore p={panel} />;
  return (<>
    <aside className="side" aria-label="Sites" style={{ width: panel.w }}>
      <div className="row" style={{ padding: 10 }}><b className="grow">Site Manager</b>
        <button className="icon-btn" title="Hide side panel (Ctrl+B)" aria-label="Hide side panel" onClick={panel.toggle}><Icon n="panel" /></button>
        <button className="icon-btn" title="Import (FileZilla XML / JSON)" onClick={importFile}><Icon n="upload" /></button>
        <button className="icon-btn" title="Export sites (no secrets)" onClick={exportSites} disabled={!sites?.length}><Icon n="download" /></button>
        <button className="btn sm" onClick={onNew}><Icon n="plus" s={12} />New</button></div>
      <div className="col" style={{ overflow: 'auto', padding: 6, flex: 1 }}>
        {sites === null ? <div className="skeleton" style={{ height: 40, margin: 4 }} /> : !sites.length ? <div className="muted" style={{ padding: 10 }}>No saved sites yet. Create one, or import from FileZilla.</div> :
          Object.entries(grouped).map(([folder, list]) => <div key={folder}>
            {folder && <div className="muted" style={{ padding: '8px 8px 2px', fontSize: 11 }}><Icon n="folder" s={11} /> {folder}</div>}
            {list.map(s => <div key={s.id} className={'tree-item' + (editing === s.id ? ' active' : '')} onClick={() => setEditing(s.id)} onDoubleClick={() => connect(s.id)} title="Double-click to connect" style={{ padding: '7px 8px' }}>
              <span className="dot" style={{ background: live.has(s.id) ? 'var(--ok)' : 'transparent', border: live.has(s.id) ? 0 : '1px solid var(--line)' }} />
              <div className="grow" style={{ minWidth: 0 }}><div className="ellipsis">{s.name || s.host}</div><div className="muted mono ellipsis" style={{ fontSize: 11 }}>{s.username}@{s.host}</div></div>
              <span className="acts"><button className="btn sm" disabled={busy} onClick={(e) => { e.stopPropagation(); connect(s.id); }}>Connect</button></span></div>)}</div>)}
      </div>
      <form className="col" style={{ gap: 6, padding: 10, borderTop: '1px solid var(--line)' }} onSubmit={(e) => { e.preventDefault(); connect(null, quick); }}>
        <b style={{ fontSize: 12 }}>Quick connect</b>
        <div className="row"><input className="grow" placeholder="Host" value={quick.host} onChange={(e) => setQuick({ ...quick, host: e.target.value })} aria-label="Quick host" /><input type="number" style={{ width: 62 }} value={quick.port} onChange={(e) => setQuick({ ...quick, port: e.target.value })} aria-label="Quick port" /></div>
        <input placeholder="Username" value={quick.username} onChange={(e) => setQuick({ ...quick, username: e.target.value })} autoComplete="off" aria-label="Quick username" />
        <input type="password" placeholder="Password" value={quick.password} onChange={(e) => setQuick({ ...quick, password: e.target.value })} autoComplete="off" aria-label="Quick password" />
        <label className="row" style={{ gap: 6, fontSize: 12 }}><input type="checkbox" checked={saveQuick} onChange={(e) => setSaveQuick(e.target.checked)} />Save as site (password stored encrypted)</label>
        <button className="btn primary" style={{ justifyContent: 'center' }} disabled={busy || !quick.host || !quick.username}>{busy ? <Spinner /> : 'Connect'}</button>
      </form>
    </aside>
    <SideResizer p={panel} />
  </>);
}

export default function Sftp({ active }) {
  const toast = useToast(); const dlg = useDialogs(); const panel = useSidePanel('sftp', 270, active);
  const [sites, setSites] = useState(null); const [cfg, setCfg] = useState({ localEnabled: false });
  const [sessions, setSessions] = useState([]); const [cur, setCur] = useState(null);
  const [editing, setEditing] = useState(null); const [fresh, setFresh] = useState(null); const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState({ host: '', port: 22, username: '', password: '' }); const [saveQuick, setSaveQuick] = useState(false);

  const reload = useCallback(() => api('/sites').then(setSites), []);
  useEffect(() => { reload().catch(() => setSites([])); api('/sftp/config').then(setCfg).catch(() => {}); }, [reload]);

  const connect = async (siteId, adhoc, retry = true) => {
    setBusy(true);
    try {
      if (!siteId && adhoc && saveQuick) {            // persist quick-connect as a site first; secrets are encrypted server-side
        const site = { ...blank(), name: adhoc.host, host: adhoc.host, port: Number(adhoc.port) || 22, username: adhoc.username, password: adhoc.password };
        await api(`/sites/${site.id}`, { method: 'PUT', body: site }); await reload(); setSaveQuick(false); setQuick(q => ({ ...q, password: '' })); siteId = site.id; adhoc = null;
        toast('Saved as a site (password encrypted)', 'success');
      }
      let code;
      const st = siteId && sites.find(s => s.id === siteId);
      if (st && st.authType === 'interactive' && st.askCode !== false) { code = await dlg.prompt('Verification code', '', 'One-time code from your authenticator'); if (code === null || code === undefined) { setBusy(false); return; } }
      const r = await api('/sftp/connect', { method: 'POST', body: siteId ? { siteId, code } : { adhoc } });
      setSessions(s => [...s, { ...r, siteId }]); setCur(r.sid);
      if (r.newHostKey) { toast('Host key saved (trust on first use)', 'success'); reload(); }
    } catch (e) {
      if (e.code === 'HOST_KEY_CHANGED' && siteId && retry) {
        const site = sites.find(s => s.id === siteId);
        if (await dlg.confirm('⚠ Host key changed', 'The server presented a different SSH host key than the one saved for this site. This can mean a man-in-the-middle attack — or that the server was reinstalled. Only continue if you expected this.')) {
          await api(`/sites/${siteId}`, { method: 'PUT', body: { ...site, hostKey: '' } }); await reload(); return connect(siteId, null, false);
        }
      } else toast(e.message, 'error');
    } finally { setBusy(false); }
  };
  const disconnect = async (sid) => {
    await api(`/sftp/${sid}/disconnect`, { method: 'POST' }).catch(() => {});
    setSessions(s => { const n = s.filter(x => x.sid !== sid); if (cur === sid) setCur(n[n.length - 1]?.sid || null); return n; });
  };
  const site = fresh || sites?.find(s => s.id === editing) || null;
  const pickSite = (id) => { setFresh(null); setEditing(id); setCur(null); };
  const showEditor = !cur || !sessions.length;

  return (
    <>
      <SitesSidebar panel={panel} sites={sites} editing={fresh?.id || editing} setEditing={pickSite} connect={(id, a) => { setCur(null); return connect(id, a); }} busy={busy} reload={reload} sessions={sessions}
        onNew={() => { const d = blank(); setFresh(d); setEditing(null); setCur(null); }} quick={quick} setQuick={setQuick} saveQuick={saveQuick} setSaveQuick={setSaveQuick} />
      <div className="col grow" style={{ minWidth: 0 }}>
        {sessions.length > 0 && (
          <div className="tabs" style={{ background: 'var(--panel)' }}>
            {sessions.map(s => <div key={s.sid} className={'tab' + (cur === s.sid ? ' active' : '')} onClick={() => setCur(s.sid)} style={{ cursor: 'pointer' }}>
              <Icon n="server" s={13} />{s.name}<button className="icon-btn" style={{ padding: 1 }} onClick={(e) => { e.stopPropagation(); disconnect(s.sid); }} aria-label="Disconnect"><Icon n="x" s={12} /></button></div>)}
            <button className="tab" onClick={() => setCur(null)} aria-label="Site editor" title="Back to site editor"><Icon n="gear" s={13} /></button>
          </div>)}
        {sessions.map(s => <Session key={s.sid} sess={s} localEnabled={cfg.localEnabled} active={active && cur === s.sid} onClose={() => disconnect(s.sid)} />)}
        {showEditor && (site ? <SiteEditor key={site.id} site={site} isNew={!!fresh} reload={async () => { await reload(); }} busy={busy}
          onConnect={(id) => { setFresh(null); setEditing(id); connect(id); }} onDeleted={() => { setFresh(null); setEditing(null); }} />
          : <div className="empty grow"><div><Icon n="server" s={34} c="var(--muted)" /><h3>SFTP client</h3><p className="muted" style={{ maxWidth: 420 }}>Double-click a saved site to connect, create a new one, import from FileZilla, or use Quick connect. Saved passwords are encrypted.</p></div></div>)}
      </div>
      {dlg.el}
    </>
  );
}
