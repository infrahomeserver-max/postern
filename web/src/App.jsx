import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { api, docsChanged } from './api.js';
import { NAME, VERSION } from './brand.js';
import { useAppearance } from './theme.js';
import { useStatus } from './status.js';
import { Logo, Icon, ToastProvider, ModuleLoading, Spinner } from './ui.jsx';

// Each module is a separate chunk: downloaded only the first time it is opened.
const ApiTester = lazy(() => import('./modules/api/index.jsx'));
const Sftp = lazy(() => import('./modules/sftp/index.jsx'));
const Mock = lazy(() => import('./modules/mock/index.jsx'));
const Settings = lazy(() => import('./modules/Settings.jsx'));

const MODULES = [
  { id: 'api', label: 'Requests', icon: 'api', C: ApiTester },
  { id: 'sftp', label: 'Transfer', icon: 'transfer', C: Sftp },
  { id: 'mock', label: 'Mocks', icon: 'mock', C: Mock },
  { id: 'settings', label: 'Settings', icon: 'gear', C: Settings },
];
function UserMenu({ user, theme, setTheme, logout }) {
  const [o, setO] = useState(false); const ref = useRef();
  useEffect(() => { if (!o) return; const h = (e) => { if (!ref.current?.contains(e.target)) setO(false); }; const k = (e) => { if (e.key === 'Escape') setO(false); }; addEventListener('mousedown', h); addEventListener('keydown', k); return () => { removeEventListener('mousedown', h); removeEventListener('keydown', k); }; }, [o]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="avatar" onClick={() => setO(!o)} title={'Signed in as ' + user.username} aria-label="Account menu" aria-expanded={o}>{(user.username || '?')[0].toUpperCase()}</button>
      {o && <div className="user-pop" role="menu">
        <div className="muted" style={{ padding: '6px 10px', fontSize: 12 }}>Signed in as <b style={{ color: 'var(--text)' }}>{user.username}</b></div>
        <button role="menuitem" className="mi" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setO(false); }}><Icon n={theme === 'dark' ? 'sun' : 'moon'} s={15} />{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
        <button role="menuitem" className="mi" onClick={() => { setO(false); logout(); }}><Icon n="logout" s={15} />Sign out</button>
      </div>}
    </div>);
}

const SOON = [{ label: 'SSH', icon: 'term' }, { label: 'Database', icon: 'db' }];

function AuthScreen({ onAuth, registration }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api('/auth/' + mode, { method: 'POST', body: f }); onAuth(r.user); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <aside className="auth-brand" aria-hidden="true">
        <div className="row" style={{ gap: 12 }}><div className="logo" style={{ width: 40, height: 40, margin: 0 }}><Logo s={24} /></div><b style={{ fontSize: 18 }}>{NAME}</b></div>
        <div>
          <h2>API, SOAP and SFTP<br />in one workspace.</h2>
          <p className="muted" style={{ fontSize: 14, margin: '0 0 26px' }}>Self-hosted, with everything you save encrypted at rest.</p>
          {[['api', 'Requests', 'REST and SOAP calls, collections, environments and tests'], ['transfer', 'Transfer', 'SFTP with a site manager and a transfer queue'], ['mock', 'Mocks', 'Stand-in servers for REST and SOAP']].map(([i, t, d]) => (
            <div key={t} className="auth-feat"><span><Icon n={i} s={18} /></span><div><b>{t}</b><div className="muted">{d}</div></div></div>))}
        </div>
        <div className="auth-art"><Logo s={460} /></div>
        <span className="muted" style={{ fontSize: 11.5 }}>{NAME} {VERSION}</span>
      </aside>
      <div className="auth-side">
      <form className="auth-card" onSubmit={submit}>
        <div className="logo auth-logo" style={{ width: 44, height: 44 }}><Logo s={26} /></div>
        <h1>{NAME}</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>{mode === 'login' ? 'Sign in to your API, SOAP & SFTP workspace' : 'Create your private workspace'}</p>
        <input autoFocus placeholder="Username" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input type="password" placeholder={mode === 'register' ? 'Password (min 8 characters)' : 'Password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {err && <div className="err-text" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy || !f.username || !f.password}>{busy ? <Spinner /> : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        {registration && <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}>
          {mode === 'login' ? 'New here? ' : 'Have an account? '}
          <a href="#" style={{ color: 'var(--accent2)' }} onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</a>
        </p>}
        <p className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginBottom: 0, marginTop: 14 }}><Icon n="lock" s={11} /> Credentials are encrypted at rest (AES-256-GCM)</p>
      </form>
      </div>
    </div>
  );
}

const fmtBytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
function StatusBar({ user }) {
  const { jobs, last } = useStatus(); const list = Object.values(jobs); const j = list[0];
  const total = list.reduce((a, x) => a + (x.total || 0), 0), done = list.reduce((a, x) => a + (x.done || 0), 0);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <footer className="statusbar" role="status" aria-label="Status bar">
      <span className={'sdot' + (j ? ' busy' : '')} />
      {j ? <>
        <span className="ellipsis" style={{ maxWidth: '40%' }}>{j.label}{list.length > 1 ? ` (+${list.length - 1} more)` : ''}</span>
        <span className={'sbar' + (pct === null ? ' ind' : '')}><div style={pct === null ? undefined : { width: pct + '%' }} /></span>
        {pct !== null && <span>{pct}% · {fmtBytes(done)} of {fmtBytes(total)}</span>}
      </> : <span>Ready</span>}
      <span className="grow" />
      {last && <span className="ellipsis" style={{ color: last.ok ? 'var(--ok)' : 'var(--err)' }}>{last.text}</span>}
      <span>{NAME} {VERSION}</span>
    </footer>);
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [registration, setReg] = useState(true);
  const [active, setActive] = useState(() => localStorage.getItem('dh.module') || 'api');
  useEffect(() => { // fetch other module chunks when the browser is idle, so switching is instant (they still mount lazily)
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    const h = idle(() => { import('./modules/sftp/index.jsx'); import('./modules/mock/index.jsx'); import('./modules/Settings.jsx'); });
    return () => (window.cancelIdleCallback || clearTimeout)(h);
  }, []);
  const [visited, setVisited] = useState(() => new Set([localStorage.getItem('dh.module') || 'api']));
  const [look, setLook] = useAppearance(); const theme = look.mode; const setTheme = (mode) => setLook({ mode });
  useEffect(() => { const beat = () => fetch('/api/ping').catch(() => {}); beat(); const iv = setInterval(beat, 30000); return () => clearInterval(iv); }, []); // keeps a desktop-mode server alive while the page is open
  useEffect(() => { api('/auth/me').then(r => { setUser(r.user); setReg(r.registration); }).catch(() => setUser(null)); }, []);
  // The sample ERP's URLs contain this app's address. If the desktop app started on another port than last time, point them at the current one.
  useEffect(() => {
    if (!user) return; let alive = true;
    (async () => {
      const re = /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/sample\//g, now = location.origin + '/sample/'; let changed = false;
      for (const kind of ['environment', 'collection']) {
        try { for (const d of await api('/docs/' + kind)) { const j = JSON.stringify(d); if (!alive || !re.test(j)) { re.lastIndex = 0; continue; } re.lastIndex = 0;
          const fixed = j.replace(re, (m) => (m === now ? m : now)); if (fixed !== j) { await api(`/docs/${kind}/${d.id}`, { method: 'PUT', body: JSON.parse(fixed) }); changed = true; docsChanged(kind); } } } catch { /* offline */ }
      }
      if (changed && alive) window.dispatchEvent(new CustomEvent('postern:docs-changed', { detail: 'environment' }));
    })();
    return () => { alive = false; };
  }, [user]);
  useEffect(() => { try { window.posternShell?.setAuth(!!user); } catch { /* not the desktop app */ } }, [user]);
  const open = (id) => { setActive(id); setVisited(v => new Set(v).add(id)); localStorage.setItem('dh.module', id); };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); setVisited(new Set([active])); };
  const cmdRef = useRef(); cmdRef.current = (c) => {   // commands from the desktop app's native menu
    if (c.startsWith('nav:')) return open(c.slice(4));
    if (c === 'theme') return setTheme(theme === 'dark' ? 'light' : 'dark');
    if (c === 'signout') return logout();
    if (c === 'shortcuts') { try { localStorage.setItem('dh.settingsTab', 'shortcuts'); } catch { /* private mode */ } open('settings'); return dispatchEvent(new CustomEvent('postern:settings-tab', { detail: 'shortcuts' })); }
    if (c === 'newTab' || c === 'focusUrl') open('api');
    setTimeout(() => dispatchEvent(new CustomEvent('postern:cmd', { detail: c })), 80);
  };
  useEffect(() => { const off = window.posternShell?.onCommand?.((c) => cmdRef.current(c)); return () => off?.(); }, []);

  if (user === undefined) return <div className="empty" style={{ height: '100%' }}><Spinner /></div>;
  return (
    <ToastProvider>
      {!user ? <AuthScreen onAuth={setUser} registration={registration} /> : (
        <div className="shell">
          <nav className="rail" aria-label="Modules">
            <button className="logo" onClick={() => open('api')} title="Postern — go to Requests" aria-label="Postern home"><Logo s={20} /></button>
            {MODULES.filter(m => m.id !== 'settings').map(m => <button key={m.id} className={'nav' + (active === m.id ? ' active' : '')} onClick={() => open(m.id)} title={m.label}><Icon n={m.icon} s={20} />{m.label}</button>)}
            <div className="grow" />
            {SOON.map(m => <button key={m.label} className="nav" disabled title={m.label + ' — coming soon'}><Icon n={m.icon} s={20} />{m.label}</button>)}
            <UserMenu user={user} theme={theme} setTheme={setTheme} logout={logout} />
            {MODULES.filter(m => m.id === 'settings').map(m => <button key={m.id} className={'nav' + (active === m.id ? ' active' : '')} onClick={() => open(m.id)} title="Settings (Ctrl+,)"><Icon n={m.icon} s={20} />{m.label}</button>)}
          </nav>
          <div className="main">
            <div className="content">
              {MODULES.filter(m => visited.has(m.id)).map(m => (
                <div key={m.id} className={'module' + (active === m.id ? '' : ' hidden')}>
                  <Suspense fallback={<ModuleLoading />}><m.C active={active === m.id} user={user} /></Suspense>
                </div>))}
            </div>
            <StatusBar user={user} />
          </div>
        </div>)}
    </ToastProvider>
  );
}
