import { useState, useEffect } from 'react';
import { api, download, pickFile, useDocs } from '../api.js';
import { Icon, useToast } from '../ui.jsx';
import { useDialogs } from '../dialogs.jsx';
import { usePrefs, ACTIONS } from './sftp/prefs.js';
import { useAppearance, BRANDS, DEFAULTS } from '../theme.js';
import { useUi, UI_DEFAULTS } from '../prefs.js';

const Card = ({ icon, title, children }) => (
  <section style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
    <h3 style={{ margin: '0 0 12px', display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}><Icon n={icon} s={16} c="var(--accent2)" />{title}</h3>{children}
  </section>
);

const Seg = ({ value, onChange, options, label }) => (
  <span className="seg" role="group" aria-label={label}>{options.map(([v, t]) => <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{t}</button>)}</span>
);
function Appearance() {
  const [a, set] = useAppearance();
  return (
    <div className="form" style={{ maxWidth: 560, rowGap: 12 }}>
      <label>Mode</label><div><Seg label="Mode" value={a.mode} onChange={(mode) => set({ mode })} options={[['dark', 'Dark'], ['light', 'Light']]} /></div>
      <label>Theme colour</label>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(BRANDS).map(([n, c]) => <button key={n} type="button" className={'swatch' + (a.brand.toLowerCase() === c ? ' on' : '')} style={{ background: c }} title={n} aria-label={'Theme colour ' + n} onClick={() => set({ brand: c })} />)}
        <input type="color" value={a.brand} onChange={(e) => set({ brand: e.target.value })} aria-label="Custom theme colour" title="Custom colour" style={{ width: 34, height: 28, padding: 2 }} />
        <span className="muted">Used for the logo, selection, active tab and progress.</span>
      </div>
      <label>Selection tint</label><div><Seg label="Selection tint" value={a.selection} onChange={(selection) => set({ selection })} options={[['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']]} /></div>
      <label>Text contrast</label><div><Seg label="Text contrast" value={a.contrast} onChange={(contrast) => set({ contrast })} options={[['soft', 'Soft'], ['standard', 'Standard'], ['high', 'High']]} /></div>
      <label>Buttons</label><div><Seg label="Buttons" value={a.buttons} onChange={(buttons) => set({ buttons })} options={[['standard', 'Standard blue'], ['theme', 'Theme colour']]} /></div>
      <span /><div><button type="button" className="btn sm" onClick={() => set({ ...DEFAULTS, mode: a.mode })}>Reset to defaults</button></div>
    </div>);
}

function FileTypes() {
  const { prefs, setAssoc, setDefault } = usePrefs(); const [ext, setExt] = useState('');
  const rows = Object.entries(prefs.assoc).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="col" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>What double-clicking a file in the SFTP browser does. Set a default for every type, then override per extension (also available from a file's right-click → Open with).</p>
      <label className="row" style={{ gap: 8 }}><span style={{ width: 120 }}>Default for all files</span><select value={prefs.default} onChange={(e) => setDefault(e.target.value)} aria-label="Default file action">{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {rows.map(([x, a]) => <div key={x} className="row" style={{ gap: 8 }}><code className="mono" style={{ width: 120 }}>.{x}</code>
        <select value={a} onChange={(e) => setAssoc(x, e.target.value)} aria-label={'Action for .' + x}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn sm ghost" onClick={() => setAssoc(x, null)}>Remove</button></div>)}
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); const v = ext.trim().replace(/^\./, '').toLowerCase(); if (/^[\w+-]{1,16}$/.test(v)) { setAssoc(v, prefs.default === 'edit' ? 'preview' : 'edit'); setExt(''); } }}>
        <input placeholder="Add file type, e.g. log" value={ext} onChange={(e) => setExt(e.target.value)} style={{ width: 200 }} aria-label="New file type" /><button className="btn sm">Add</button></form>
    </div>);
}


const NET_DEFAULTS = { timeoutMs: 30000, followRedirects: true, verifySsl: true, maxResponseMB: 20, userAgent: '', proxyMode: 'none', proxyUrl: '', proxyUser: '', proxyPass: '', proxyBypass: 'localhost,127.0.0.1', caPem: '', clientCertPem: '', clientKeyPem: '', clientKeyPass: '', sftpConnectTimeoutSec: 15, sftpKeepaliveSec: 20, sftpRetries: 0, sftpConcurrency: 64, sftpChunkKB: 64 };
function Network() {
  const docs = useDocs('settings');
  const saved = docs.items?.find(d => d.id === 'network');
  const [n, setN] = useState(null);
  useEffect(() => { if (docs.items && !n) setN({ ...NET_DEFAULTS, ...(saved || {}), id: 'network' }); }, [docs.items]); // eslint-disable-line
  if (!n) return <div className="skeleton" style={{ height: 120 }} />;
  const set = (p) => { const next = { ...n, ...p }; setN(next); docs.save(next); };
  const num = (k, lo, hi) => (e) => set({ [k]: e.target.value === '' ? NET_DEFAULTS[k] : Math.min(hi, Math.max(lo, Number(e.target.value))) });
  const Sub = ({ children }) => <div style={{ gridColumn: '1 / -1', fontWeight: 650, marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>{children}</div>;
  const File = ({ k, label }) => <><label>{label}</label><div className="row" style={{ gap: 8 }}><button className="btn sm" type="button" onClick={async () => { const f = await pickFile('.pem,.crt,.cer,.key,.txt'); if (f) set({ [k]: await f.text() }); }}>Choose file…</button><span className="muted">{n[k] ? (n[k] === '__keep__' ? 'saved' : 'loaded') : 'none'}</span>{n[k] && <button className="btn sm ghost" type="button" onClick={() => set({ [k]: '' })}>Remove</button>}</div></>;
  return (
    <div className="form" style={{ maxWidth: 600, rowGap: 12 }}>
      <Sub>Requests (REST &amp; SOAP) — defaults, each request can override</Sub>
      <label>Timeout (ms)</label><input type="number" min="100" max="300000" value={n.timeoutMs} onChange={num('timeoutMs', 100, 300000)} />
      <label>Follow redirects</label><input type="checkbox" checked={n.followRedirects} onChange={(e) => set({ followRedirects: e.target.checked })} />
      <label>Verify SSL certificates</label><input type="checkbox" checked={n.verifySsl} onChange={(e) => set({ verifySsl: e.target.checked })} />
      <label>Max response size (MB)</label><input type="number" min="1" max="200" value={n.maxResponseMB} onChange={num('maxResponseMB', 1, 200)} />
      <label>User-Agent</label><input value={n.userAgent} placeholder="(default)" onChange={(e) => set({ userAgent: e.target.value })} />
      <Sub>Proxy</Sub>
      <label>Use proxy</label><Seg label="Proxy" value={n.proxyMode} onChange={(proxyMode) => set({ proxyMode })} options={[['none', 'None'], ['system', 'System (env)'], ['custom', 'Custom']]} />
      {n.proxyMode === 'custom' && <>
        <label>Proxy URL</label><input value={n.proxyUrl} placeholder="http://proxy.corp:8080" onChange={(e) => set({ proxyUrl: e.target.value })} />
        <label>Username</label><input value={n.proxyUser} autoComplete="off" onChange={(e) => set({ proxyUser: e.target.value })} />
        <label>Password</label><input type="password" autoComplete="new-password" value={n.proxyPass === '__keep__' ? '' : n.proxyPass} placeholder={n.proxyPass === '__keep__' ? '(saved — type to replace)' : ''} onChange={(e) => set({ proxyPass: e.target.value })} />
        <label>No proxy for</label><input value={n.proxyBypass} placeholder="localhost,127.0.0.1,.internal" onChange={(e) => set({ proxyBypass: e.target.value })} />
      </>}
      {n.proxyMode === 'system' && <><span /><span className="muted">Uses HTTP_PROXY / HTTPS_PROXY / NO_PROXY from the environment Postern was started in.</span></>}
      <Sub>Certificates</Sub>
      <File k="caPem" label="Extra CA certificate" />
      <File k="clientCertPem" label="Client certificate (mTLS)" />
      <File k="clientKeyPem" label="Client private key" />
      {n.clientKeyPem && <><label>Key passphrase</label><input type="password" autoComplete="new-password" value={n.clientKeyPass === '__keep__' ? '' : n.clientKeyPass} placeholder={n.clientKeyPass === '__keep__' ? '(saved)' : '(none)'} onChange={(e) => set({ clientKeyPass: e.target.value })} /></>}
      <Sub>SFTP</Sub>
      <label>Connect timeout (s)</label><input type="number" min="3" max="120" value={n.sftpConnectTimeoutSec} onChange={num('sftpConnectTimeoutSec', 3, 120)} />
      <label>Keep-alive every (s, 0 = off)</label><input type="number" min="0" max="300" value={n.sftpKeepaliveSec} onChange={num('sftpKeepaliveSec', 0, 300)} />
      <label>Connect retries</label><input type="number" min="0" max="5" value={n.sftpRetries} onChange={num('sftpRetries', 0, 5)} />
      <label>Parallel transfer requests</label><input type="number" min="1" max="128" value={n.sftpConcurrency} onChange={num('sftpConcurrency', 1, 128)} />
      <label>Transfer chunk size (KB)</label><input type="number" min="16" max="1024" value={n.sftpChunkKB} onChange={num('sftpChunkKB', 16, 1024)} />
      <span /><span className="muted">Changes apply to the next request or connection. Proxy passwords and keys are stored encrypted on the server and never shown again. Certificates apply to all hosts.</span>
    </div>
  );
}

const SECTIONS = [['appearance', 'sun', 'Appearance'], ['interface', 'edit', 'Interface'], ['requests', 'send', 'Requests & history'], ['network', 'globe', 'Network'], ['files', 'file', 'File types'], ['backup', 'save', 'Backup & restore'], ['account', 'lock', 'Account'], ['security', 'shield', 'Security & privacy'], ['shortcuts', 'code', 'Shortcuts'], ['about', 'box', 'About']];

const Toggle = ({ label, hint, checked, onChange }) => (
  <label className="set-toggle"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span><b>{label}</b>{hint && <span className="muted"> {hint}</span>}</span></label>
);
function Interface() {
  const [u, set] = useUi();
  return (
    <div className="form" style={{ maxWidth: 560, rowGap: 12 }}>
      <label>Zoom</label>
      <div className="row" style={{ gap: 10 }}><input type="range" min="80" max="150" step="5" value={u.zoom} onChange={(e) => set({ zoom: +e.target.value })} aria-label="Interface zoom" style={{ width: 220 }} /><b>{u.zoom}%</b><span className="muted">Scales the whole window.</span></div>
      <label>Density</label><div><Seg label="Density" value={u.density} onChange={(density) => set({ density })} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} /></div>
      <label>Motion</label><div><Toggle label="Reduce animations" hint="(spinners and transitions stay minimal)" checked={u.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} /></div>
      <span /><div><button type="button" className="btn sm" onClick={() => set({ zoom: UI_DEFAULTS.zoom, density: UI_DEFAULTS.density, reduceMotion: UI_DEFAULTS.reduceMotion })}>Reset</button></div>
    </div>);
}
function RequestPrefs() {
  const [u, set] = useUi(); const hist = useDocs('history'); const toast = useToast();
  return (
    <div className="col" style={{ gap: 12, maxWidth: 600 }}>
      <Toggle label="Warn before closing a tab with unsaved changes" checked={u.confirmClose} onChange={(confirmClose) => set({ confirmClose })} />
      <Toggle label="Wrap long lines in responses" hint="(JSON, XML and text bodies)" checked={u.wrapLines} onChange={(wrapLines) => set({ wrapLines })} />
      <Toggle label="Keep request history" hint="(every sent request is listed under History)" checked={u.keepHistory} onChange={(keepHistory) => set({ keepHistory })} />
      <div className="row" style={{ gap: 8 }}><button className="btn sm" disabled={!hist.items?.length} onClick={async () => { await hist.clear(); toast('History cleared', 'success'); }}>Clear history{hist.items?.length ? ` (${hist.items.length})` : ''}</button>
        <span className="muted">Timeouts, redirects, proxy and certificates are under Network.</span></div>
    </div>);
}
const SHORTCUTS = [['Ctrl/⌘ + Enter', 'Send the request'], ['Ctrl/⌘ + S', 'Save the request to a collection'], ['Ctrl/⌘ + T', 'New request tab'], ['Middle-click a tab', 'Close the tab'], ['Drag a tab', 'Reorder tabs'], ['Esc', 'Close a menu or dialog'], ['Double-click a file (SFTP)', 'Run its default action (see File types)'], ['Right-click', 'Context menu on collections, requests and files']];
const Shortcuts = () => (<table className="kv" style={{ maxWidth: 560 }}><tbody>{SHORTCUTS.map(([k, d]) => <tr key={k}><td style={{ width: 230 }}><code className="mono">{k}</code></td><td>{d}</td></tr>)}</tbody></table>);
function About() {
  const plat = /Mac/i.test(navigator.platform) ? '~/Library/Application Support/Postern' : /Win/i.test(navigator.platform) ? '%APPDATA%\\Postern' : '~/.local/share/postern';
  return (
    <div className="form" style={{ maxWidth: 600, rowGap: 10 }}>
      <label>Version</label><b>{typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}</b>
      <label>Your data</label><span><code className="mono">{plat}</code> <span className="muted">(desktop and lite builds share it)</span></span>
      <label>Source & issues</label><span className="muted">github.com/infrahomeserver-max/postern</span>
      <label>Licence</label><span className="muted">See the LICENSE file in the repository.</span>
    </div>);
}

export default function Settings({ user }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('dh.settingsTab') || 'appearance'; } catch { return 'appearance'; } });
  const pickTab = (t) => { setTab(t); try { localStorage.setItem('dh.settingsTab', t); } catch { /* ignore */ } };
  const toast = useToast(); const dlg = useDialogs();
  const [pw, setPw] = useState({ current: '', next: '' }); const [busy, setBusy] = useState(false);

  const backup = async () => {
    const [collections, environments, sites] = await Promise.all([api('/docs/collection'), api('/docs/environment'), api('/sites')]);
    const strip = ({ _updated, ...x }) => x;
    // Saved SFTP passwords / keys are never included in exports.
    const clean = sites.map(({ hasPassword, hasKey, hasPassphrase, _updated, hostKey, ...s }) => s);
    download(`postern-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ devhub: 'backup', version: 1, collections: collections.map(strip), environments: environments.map(strip), sites: clean }, null, 2));
    toast('Backup downloaded (SFTP secrets are excluded)', 'success');
  };
  const restore = async () => {
    const f = await pickFile('.json'); if (!f) return;
    try {
      const b = JSON.parse(await f.text()); if (b.devhub !== 'backup') throw new Error('Not a Postern backup file');
      if (b.collections?.length) await api('/docs/collection/bulk', { method: 'POST', body: { items: b.collections } });
      if (b.environments?.length) await api('/docs/environment/bulk', { method: 'POST', body: { items: b.environments } });
      if (b.sites?.length) await api('/sites/bulk', { method: 'POST', body: { items: b.sites } });
      toast(`Restored ${b.collections?.length || 0} collections, ${b.environments?.length || 0} environments, ${b.sites?.length || 0} sites. Reload to see them.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const changePw = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/auth/password', { method: 'POST', body: pw }); setPw({ current: '', next: '' }); toast('Password updated', 'success'); }
    catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="set-wrap">
      <nav className="set-nav" aria-label="Settings sections">
        {SECTIONS.map(([id, icon, label]) => <button key={id} className={'set-item' + (tab === id ? ' active' : '')} aria-current={tab === id ? 'page' : undefined} onClick={() => pickTab(id)}><Icon n={icon} s={16} />{label}</button>)}
      </nav>
      <div className="set-body">
      <div style={{ maxWidth: 720 }}>
        {tab === 'appearance' && (<>
        <Card icon="sun" title="Appearance"><Appearance /></Card>
        </>)}
        {tab === 'interface' && (<><Card icon="edit" title="Interface"><Interface /></Card></>)}
        {tab === 'requests' && (<><Card icon="send" title="Requests & history"><RequestPrefs /></Card></>)}
        {tab === 'network' && (<>
        <Card icon="globe" title="Network"><Network /></Card>
        </>)}
        {tab === 'files' && (<>
        <Card icon="file" title="File types (SFTP double-click & Open with)"><FileTypes /></Card>
        </>)}
        {tab === 'backup' && (<>
      <Card icon="save" title="Backup & restore">
          <p className="muted" style={{ marginTop: 0 }}>Export all collections, environments and SFTP site definitions to one JSON file. Saved passwords and private keys are <b>never</b> exported.</p>
          <div className="row"><button className="btn primary" onClick={backup}><Icon n="download" s={14} />Download backup</button><button className="btn" onClick={restore}><Icon n="upload" s={14} />Restore from file</button></div>
        </Card>
        </>)}
        {tab === 'account' && (<>
        <Card icon="lock" title="Account">
          <form onSubmit={changePw} className="form" style={{ maxWidth: 440 }}>
            <label>Signed in as</label><b>{user.username}</b>
            <label>Current password</label><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <label>New password</label><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="min 8 characters" />
            <span /><div><button className="btn" disabled={busy || !pw.current || pw.next.length < 8}>Change password</button></div>
          </form>
        </Card>
        </>)}
        {tab === 'shortcuts' && (<><Card icon="code" title="Keyboard shortcuts"><Shortcuts /></Card></>)}
        {tab === 'about' && (<><Card icon="box" title="About Postern"><About /></Card></>)}
        {tab === 'security' && (<>
        <Card icon="shield" title="Security & privacy">
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>Passwords hashed with scrypt; sessions are signed, httpOnly, SameSite=Strict cookies.</li>
            <li>SFTP passwords, keys and passphrases are encrypted at rest with AES-256-GCM (per-user key).</li>
            <li>SSH host keys are pinned on first connect; a changed key blocks the connection.</li>
            <li>Request scripts run in an isolated sandbox with no network or storage access.</li>
          </ul>
        </Card>
        </>)}
      </div>
      </div>
      {dlg.el}
    </div>
  );
}
