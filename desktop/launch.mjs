#!/usr/bin/env node
/* Postern desktop launcher: start the server on a free local port, open the app window,
   and stop the server (freeing the port) when the window closes. Runs as the logged-in user. */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http';

const APP = path.resolve(import.meta.dirname, '..');
const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  const v = (() => { try { return fs.readFileSync(path.join(APP, 'VERSION'), 'utf8').trim(); } catch { return JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version; } })();
  console.log('postern ' + v); process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  console.log('postern [--version]\n  Opens the Postern app window; the server stops when the window closes.\n  Env: POSTERN_DATA, POSTERN_BROWSER (path or none), POSTERN_BROWSER_ARGS');
  process.exit(0);
}
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const dataRoot = () => WIN ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
  : MAC ? path.join(os.homedir(), 'Library', 'Application Support')
  : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
const DATA = process.env.POSTERN_DATA || path.join(dataRoot(), WIN || MAC ? 'Postern' : 'postern');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const LOCK = path.join(DATA, 'desktop.json');
const PREFERRED = Array.from({ length: 20 }, (_, i) => 3210 + i); // same port when free, so browser-side settings persist

const onPath = (b) => (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, WIN ? b + '.exe' : b)).find((f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } }) || '';
const firstFile = (list) => list.filter(Boolean).find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || '';
const findBrowser = () => {
  if (process.env.POSTERN_BROWSER) return process.env.POSTERN_BROWSER === 'none' ? '' : process.env.POSTERN_BROWSER;
  if (WIN) {
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA];
    const rel = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Chromium\\Application\\chrome.exe'];
    return firstFile(rel.flatMap((r) => roots.filter(Boolean).map((d) => path.join(d, r))));
  }
  if (MAC) {
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Brave Browser.app/Contents/MacOS/Brave Browser', 'Chromium.app/Contents/MacOS/Chromium'];
    return firstFile(apps.flatMap((a) => ['/Applications', path.join(os.homedir(), 'Applications')].map((d) => path.join(d, a))));
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge', 'microsoft-edge-stable'].map(onPath).find(Boolean) || '';
};
const ping = (port) => new Promise((res) => {
  const r = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 800 }, (x) => { let b = ''; x.on('data', (d) => (b += d)); x.on('end', () => res(b.includes('"postern"'))); });
  r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
});
const isFree = (port) => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const freePort = async () => { for (const p of PREFERRED) if (await isFree(p)) return p; return isFree(0); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = findBrowser();
const openWindow = (port) => {
  const url = `http://localhost:${port}`;
  if (browser) {
    const extra = (process.env.POSTERN_BROWSER_ARGS || '').split(' ').filter(Boolean);
    return spawn(browser, [`--app=${url}`, '--class=postern', '--name=postern', `--user-data-dir=${path.join(DATA, 'window')}`, '--no-first-run', '--no-default-browser-check', ...extra], { stdio: 'ignore', windowsHide: true });
  }
  const [opener, oargs] = WIN ? ['cmd', ['/c', 'start', '', url]] : MAC ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener, oargs, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => console.log(`Open ${url} in your browser`)).unref();
  return null;
};

let lock = null; try { lock = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch { /* not running */ }
if (lock && await ping(lock.port)) { openWindow(lock.port); process.exit(0); } // already running: just show it

const port = await freePort();
const log = fs.openSync(path.join(DATA, 'postern.log'), 'a');
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(APP, 'server', 'index.js')], {
  cwd: APP, stdio: ['ignore', log, log], windowsHide: true,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DEVHUB_DATA: DATA, DEVHUB_DESKTOP: '1', DEVHUB_IDLE_EXIT: browser ? '0' : (process.env.DEVHUB_IDLE_EXIT || '600') },
});
const cleanup = () => { try { if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === srv.pid) fs.unlinkSync(LOCK); } catch { /* gone */ } };
const stop = () => { if (srv.exitCode === null) srv.kill(WIN ? undefined : 'SIGTERM'); }; // on Windows the server also exits by itself via the idle timeout if this is skipped
srv.on('exit', (code) => { cleanup(); process.exit(code || 0); });
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, stop);
fs.writeFileSync(LOCK, JSON.stringify({ port, pid: srv.pid }), { mode: 0o600 });

let up = false; for (let i = 0; i < 60 && !(up = await ping(port)); i++) await sleep(150);
if (!up) { console.error(`Postern did not start. See ${path.join(DATA, 'postern.log')}`); stop(); }
else {
  const win = openWindow(port);
  if (win) { win.on('exit', stop); win.on('error', (e) => { console.error('Could not open the window:', e.message); stop(); }); }
  // without a Chromium-family browser the server exits by itself once the page has been closed for a while (DEVHUB_IDLE_EXIT seconds)
}
