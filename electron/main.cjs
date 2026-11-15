'use strict';
// Postern desktop shell. The window is a locked-down Chromium that can only talk to the bundled local server.
const { app, BrowserWindow, Menu, shell, session, dialog, powerMonitor, ipcMain, net: enet } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const APP_DIR = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(__dirname, '..');
// Same data folder as the lite build, so switching between them keeps your data.
const os = require('node:os');
const dataRoot = process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
  : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
app.setPath('userData', process.env.POSTERN_DATA || path.join(dataRoot, process.platform === 'linux' ? 'postern' : 'Postern'));
const DATA = app.getPath('userData');
const CONF = path.join(DATA, 'shell.json');
const readConf = () => { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch { return {}; } };
const writeConf = (c) => { fs.mkdirSync(DATA, { recursive: true, mode: 0o700 }); fs.writeFileSync(CONF, JSON.stringify(c), { mode: 0o600 }); };

if (!app.requestSingleInstanceLock()) { app.quit(); }

const token = crypto.randomBytes(32).toString('hex');
let port = 0, srv = null, win = null, origin = '';

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const ping = (p) => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: p, path: '/api/ping', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  port = await freePort(); origin = `http://127.0.0.1:${port}`;
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(DATA, 'postern.log'), 'a');
  srv = spawn(process.execPath, [path.join(APP_DIR, 'server', 'index.js')], {
    cwd: APP_DIR, stdio: ['ignore', log, log], windowsHide: true,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
      HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY,
      ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DEVHUB_DATA: DATA, DEVHUB_DESKTOP: '1', DEVHUB_IDLE_EXIT: '240', POSTERN_TOKEN: token, // engine also self-exits if the window stops pinging (shell crashed / was killed)
     
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning' },
  });
  srv.on('exit', (code) => { srv = null; if (!quitting) { dialog.showErrorBox('Postern', `The local engine stopped unexpectedly (code ${code}). See ${path.join(DATA, 'postern.log')}`); app.quit(); } });
  for (let i = 0; i < 80; i++) { if (await ping(port)) return; await sleep(150); }
  throw new Error('Engine did not start. See ' + path.join(DATA, 'postern.log'));
}

let quitting = false;
const stopServer = () => { if (srv) { try { srv.kill(); } catch { /* gone */ } } };

function hardenSession(ses) {
  // Inject the app token only on requests to our own origin; nothing else is ever allowed from the window.
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (d, cb) => {
    if (d.url.startsWith(origin + '/')) d.requestHeaders['X-Postern-Token'] = token;
    cb({ requestHeaders: d.requestHeaders });
  });
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (d, cb) => {
    const ok = d.url.startsWith(origin + '/') || d.url.startsWith('devtools://') ;
    if (!ok && process.env.POSTERN_DEBUG) console.error('[blocked]', d.url);
    cb({ cancel: !ok });
  });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler?.(() => false);
  ses.on('will-download', (_e, item) => { /* downloads stay user-initiated (Save As) */ item.setSaveDialogOptions?.({ title: 'Save file' }); });
}

function createWindow() {
  const b = readConf().bounds || { width: 1360, height: 860 };
  win = new BrowserWindow({
    ...b, minWidth: 900, minHeight: 600, title: 'Postern', backgroundColor: '#14161a', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged || process.env.POSTERN_DEVTOOLS === '1', webviewTag: false, navigateOnDragDrop: false },
  });
  win.once('ready-to-show', () => win.show());
  const wc = win.webContents;
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(origin + '/')) { e.preventDefault(); openExternal(url); } });
  wc.on('will-redirect', (e, url) => { if (!url.startsWith(origin + '/')) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.on('render-process-gone', () => { win && win.reload(); });
  win.on('close', () => { if (!win.isMinimized() && !win.isMaximized()) writeConf({ ...readConf(), bounds: win.getBounds() }); });
  win.on('closed', () => { win = null; });
  win.loadURL(origin + '/');
}

function openExternal(url) { try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href); } catch { /* ignore */ } }

// ---- auto-lock: sign the user out after N idle minutes (0 = off) ----
let lockTimer = null;
const lockMinutes = () => Number(readConf().autoLockMin || 0);
async function lockNow() {
  if (!win) return;
  // net.fetch uses the window's session, so the sign-in cookie is sent and the server ends that session.
  try { await enet.fetch(origin + '/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'devhub' } }); } catch { /* ignore */ }
  try { await session.defaultSession.clearStorageData({ storages: ['cookies'] }); } catch { /* ignore */ }
  win.webContents.reload();
}
function armLock() {
  clearTimeout(lockTimer); const m = lockMinutes(); if (!m) return;
  lockTimer = setTimeout(lockNow, m * 60 * 1000);
}
function setAutoLock(m) { writeConf({ ...readConf(), autoLockMin: m }); armLock(); buildMenu(); }

function buildMenu() {
  const m = lockMinutes();
  const isMac = process.platform === 'darwin';
  const lockItems = [0, 5, 15, 30, 60].map((v) => ({ label: v ? `After ${v} minutes idle` : 'Off', type: 'radio', checked: m === v, click: () => setAutoLock(v) }));
  const t = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Sign out now', accelerator: 'CmdOrCtrl+L', click: lockNow }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    { label: 'Security', submenu: [{ label: 'Auto sign-out', submenu: lockItems }, { label: 'Open data folder', click: () => shell.openPath(DATA) }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: `Postern ${app.getVersion()}`, enabled: false }, { label: 'Project page', click: () => openExternal('https://github.com/infrahomeserver-max/postern') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('web-contents-created', (_e, wc) => { wc.on('will-attach-webview', (ev) => ev.preventDefault()); });
app.on('before-quit', () => { quitting = true; stopServer(); });
app.on('window-all-closed', () => app.quit());
process.on('exit', stopServer);
for (const sg of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sg, () => { quitting = true; stopServer(); app.quit(); });

app.whenReady().then(async () => {
  try { await startServer(); } catch (e) { dialog.showErrorBox('Postern', String(e.message || e)); app.quit(); return; }
  hardenSession(session.defaultSession);
  buildMenu(); createWindow(); armLock();
  // activity resets the idle timer; OS-level lock/suspend signs out immediately when auto sign-out is on
  const reset = () => armLock();
  win.webContents.on('before-input-event', reset);
  ipcMain.on('postern:activity', reset);
  const sys = () => { if (lockMinutes()) lockNow(); };
  powerMonitor.on('lock-screen', sys); powerMonitor.on('suspend', sys);
  app.on('activate', () => { if (!win) createWindow(); });
}).catch((e) => { dialog.showErrorBox('Postern', String(e)); app.quit(); });
