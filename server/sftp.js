import { getNet } from './netconf.js';
import { Router } from 'express';
import SftpClient from 'ssh2-sftp-client';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { docs } from './db.js';
import { encrypt, decrypt } from './security.js';
import { httpError } from './auth.js';
import { LOCAL_ROOT } from './config.js';
import { createHash } from 'node:crypto';
import { pipelinedDownload, pipelinedUpload } from './transfer.js';

const posix = path.posix;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); // ~8x faster than localeCompare on big folders
const SECRET_FIELDS = ['password', 'privateKey', 'passphrase'];

/* ---------------- Saved sites (credentials encrypted at rest) ---------------- */
export const sitesRouter = Router();
const publicSite = (s) => {
  const { secrets, ...rest } = s;
  let has = {};
  try { const o = JSON.parse(decrypt(s._uid, secrets)); has = { hasPassword: !!o.password, hasKey: !!o.privateKey, hasPassphrase: !!o.passphrase }; } catch { /* ignore */ }
  delete rest._uid;
  return { ...rest, ...has };
};
function loadSite(uid, id) {
  const s = docs.get(uid, 'site', id);
  if (!s) throw httpError(404, 'Site not found');
  s.sec = s.secrets ? JSON.parse(decrypt(uid, s.secrets)) : {};
  return s;
}
function storeSite(uid, id, input, prev) {
  const prevSec = prev?.sec || {};
  const sec = {};
  for (const f of SECRET_FIELDS) sec[f] = input[f] === undefined ? prevSec[f] : input[f]; // undefined = keep, '' = clear
  const rec = {
    name: String(input.name || input.host || 'Untitled').slice(0, 100),
    host: String(input.host || '').trim(), port: Number(input.port) || 22,
    username: String(input.username || ''), authType: ['key', 'agent', 'interactive'].includes(input.authType) ? input.authType : 'password',
    folder: String(input.folder || '').slice(0, 60), defaultPath: String(input.defaultPath || ''), compress: !!input.compress, askCode: input.askCode !== false,
    hostKey: input.hostKey !== undefined ? input.hostKey : prev?.hostKey || '',
    secrets: encrypt(uid, JSON.stringify(sec)),
  };
  if (!rec.host) throw httpError(400, 'Host is required');
  docs.put(uid, 'site', id, rec);
}

sitesRouter.get('/', (req, res) => res.json(docs.list(req.user.id, 'site').map(s => publicSite({ ...s, _uid: req.user.id }))));
sitesRouter.put('/:id', (req, res) => {
  if (!/^[\w.-]{1,64}$/.test(req.params.id)) throw httpError(400, 'Bad id');
  const prev = docs.get(req.user.id, 'site', req.params.id);
  if (prev?.secrets) prev.sec = JSON.parse(decrypt(req.user.id, prev.secrets));
  storeSite(req.user.id, req.params.id, req.body || {}, prev);
  res.json({ ok: true });
});
sitesRouter.post('/bulk', (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 2000) throw httpError(400, 'items must be an array');
  docs.tx(() => items.forEach(it => storeSite(req.user.id, String(it.id || crypto.randomUUID()), it, null)));
  res.json({ ok: true, count: items.length });
});
sitesRouter.delete('/:id', (req, res) => { docs.del(req.user.id, 'site', req.params.id); res.json({ ok: true }); });

/* ---------------- Live SFTP sessions ---------------- */
const sessions = new Map(); // sid -> { uid, client, last, chain, siteName }
const jobs = new Map();     // jobId -> job
const MAX_SESSIONS = 10;
setInterval(() => {
  for (const [sid, s] of sessions) if (Date.now() - s.last > 15 * 60 * 1000 && !s.busy) { s.client.end().catch(() => {}); sessions.delete(sid); }
  for (const [id, j] of jobs) if (j.finished && Date.now() - j.finished > 10 * 60 * 1000) jobs.delete(id);
}, 60 * 1000).unref();

function sess(req) {
  const s = sessions.get(req.params.sid);
  if (!s || s.uid !== req.user.id) throw httpError(404, 'Session expired — reconnect');
  s.last = Date.now();
  return s;
}
const rpath = (p) => posix.normalize('/' + String(p ?? '/')).replace(/\/+$/, '') || '/';
const rpathKeepRel = (p) => { p = String(p ?? '.'); return p.includes('\0') ? (() => { throw httpError(400, 'Bad path'); })() : p; };

function friendly(e) {
  const m = String(e.message || e);
  if (e.level === 'client-authentication' || /All configured authentication methods failed/i.test(m)) return 'Authentication failed — check username and password/key';
  if (e.code === 'ENOTFOUND') return 'Host not found';
  if (e.code === 'ECONNREFUSED') return 'Connection refused — is the SFTP server running on that port?';
  if (/Timed out while waiting for handshake|ETIMEDOUT/i.test(m)) return 'Connection timed out';
  if (/passphrase/i.test(m)) return 'Private key is encrypted — passphrase missing or wrong';
  if (/Cannot parse privateKey/i.test(m)) return 'Could not parse private key';
  return m;
}

export const sftpRouter = Router();

sftpRouter.get('/config', (_req, res) => res.json({ localEnabled: !!LOCAL_ROOT }));

const connectLog = new Map(); // uid -> timestamps (limits use of DevHub as a credential-guessing relay)
sftpRouter.post('/connect', async (req, res) => {
  const uid = req.user.id;
  const now = Date.now(); const recent = (connectLog.get(uid) || []).filter(t => now - t < 60000);
  if (recent.length >= 20) throw httpError(429, 'Too many connection attempts — wait a minute');
  connectLog.set(uid, [...recent, now]);
  if ([...sessions.values()].filter(s => s.uid === uid).length >= MAX_SESSIONS) throw httpError(429, 'Too many open connections');
  let site = null, cfg;
  if (req.body.siteId) { site = loadSite(uid, req.body.siteId); cfg = { ...site, ...site.sec }; }
  else cfg = req.body.adhoc || {};
  if (!cfg.host || !cfg.username) throw httpError(400, 'Host and username are required');

  const nc = getNet(uid);
  let seen = '', mismatch = false;
  const conn = {
    host: cfg.host, port: Number(cfg.port) || 22, username: cfg.username,
    readyTimeout: nc.sftpConnectTimeoutSec * 1000, keepaliveInterval: nc.sftpKeepaliveSec * 1000, hostHash: 'sha256',
    hostVerifier: (h) => { seen = h; if (site?.hostKey && site.hostKey !== h) { mismatch = true; return false; } return true; },
  };
  if (cfg.compress) conn.algorithms = { compress: ['zlib@openssh.com', 'none'] }; // opt-in: helps text-heavy transfers on slow links
  if (cfg.authType === 'key') { conn.privateKey = cfg.privateKey; if (cfg.passphrase) conn.passphrase = cfg.passphrase; }
  else if (cfg.authType === 'agent') { // keys held by ssh-agent / Pageant / the Windows OpenSSH agent; nothing secret is stored here
    conn.agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '');
    if (!conn.agent) throw httpError(400, 'No SSH agent found. Start one (ssh-agent) and add your key with ssh-add, then try again.');
  } else if (cfg.authType === 'interactive') { conn.tryKeyboard = true; } // password + one-time code prompts are answered below
  else conn.password = cfg.password;
  const code = typeof req.body.code === 'string' ? req.body.code.slice(0, 256) : '';

  const client = new SftpClient();
  client.on('error', () => {});
  if (cfg.authType === 'interactive') client.client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
    finish(prompts.map(p => (/pass(word)?\b/i.test(p.prompt) && !/(code|token|verification|otp)/i.test(p.prompt)) ? String(cfg.password || '') : code));
  });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await client.connect(conn); break; }
      catch (e) { if (mismatch || attempt >= nc.sftpRetries || /Authentication|auth/i.test(String(e.message))) throw e; await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); }
    }
  }
  catch (e) {
    if (mismatch) throw Object.assign(httpError(409, `Host key for ${cfg.host} has CHANGED since you first connected. This could be a man-in-the-middle attack. Connection refused.`), { code: 'HOST_KEY_CHANGED' });
    throw httpError(502, friendly(e));
  }
  let newHostKey = false;
  if (site && !site.hostKey && seen) { // trust on first use
    storeSite(uid, site.id, { ...site, ...site.sec, hostKey: seen }, site); newHostKey = true;
  }
  const sid = crypto.randomUUID();
  const s = { uid, client, last: Date.now(), chain: Promise.resolve(), name: site?.name || `${cfg.username}@${cfg.host}` };
  sessions.set(sid, s);
  client.on('close', () => sessions.delete(sid));
  client.on('end', () => sessions.delete(sid));
  let cwd = '/';
  try { cwd = await client.cwd(); } catch { try { cwd = await client.realPath('.'); } catch { /* keep / */ } }
  res.json({ sid, name: s.name, cwd: site?.defaultPath || cwd, home: cwd, fingerprint: seen, newHostKey });
});

sftpRouter.post('/:sid/disconnect', async (req, res) => {
  const s = sess(req); sessions.delete(req.params.sid);
  await s.client.end().catch(() => {});
  res.json({ ok: true });
});

sftpRouter.get('/:sid/list', async (req, res) => {
  const s = sess(req); const p = rpath(req.query.path);
  const list = await s.client.list(p).catch(e => { throw httpError(e.code === 2 ? 404 : e.code === 3 ? 403 : 500, e.code === 3 ? 'Permission denied' : e.code === 2 ? 'No such directory' : e.message); });
  const items = list.map(f => ({
    name: f.name, type: f.type === 'd' ? 'dir' : f.type === 'l' ? 'link' : 'file',
    size: f.size, mtime: f.modifyTime, perm: (f.longname || '').slice(0, 10), owner: String(f.owner ?? ''), group: String(f.group ?? ''),
  }));
  await Promise.all(items.filter(i => i.type === 'link').map(async i => {
    try { const st = await s.client.stat(posix.join(p, i.name)); if (st.isDirectory) i.type = 'dir'; i.link = true; } catch { i.broken = true; }
  }));
  items.sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? collator.compare(a.name, b.name) : a.type === 'dir' ? -1 : 1);
  res.json({ path: p, items });
});

sftpRouter.post('/:sid/mkdir', async (req, res) => { await sess(req).client.mkdir(rpath(req.body.path), true); res.json({ ok: true }); });
sftpRouter.post('/:sid/rename', async (req, res) => { await sess(req).client.rename(rpath(req.body.from), rpath(req.body.to)); res.json({ ok: true }); });
sftpRouter.post('/:sid/chmod', async (req, res) => {
  const mode = String(req.body.mode || '');
  if (!/^[0-7]{3,4}$/.test(mode)) throw httpError(400, 'Mode must be octal, e.g. 644');
  await sess(req).client.chmod(rpath(req.body.path), parseInt(mode, 8));
  res.json({ ok: true });
});
sftpRouter.post('/:sid/delete', async (req, res) => {
  const s = sess(req); const paths = req.body.paths;
  if (!Array.isArray(paths) || !paths.length || paths.length > 500) throw httpError(400, 'paths required');
  for (const raw of paths) {
    const p = rpath(raw); if (p === '/') throw httpError(400, 'Refusing to delete root');
    const t = await s.client.exists(p);
    if (t === 'd') await s.client.rmdir(p, true); else if (t) await s.client.delete(p);
  }
  res.json({ ok: true });
});

/* Browser <-> server streaming (no temp files, constant memory) */
sftpRouter.put('/:sid/upload', async (req, res) => {
  const s = sess(req); const p = rpath(req.query.path);
  s.busy = true;
  try {
    const sent = await pipelinedUpload(s.client.sftp, p, req);
    const st = await s.client.stat(p); // data-quality guard: what the server stored must equal what we streamed
    if (st.size !== sent) throw httpError(502, `Upload verification failed (sent ${sent} bytes, server has ${st.size})`);
  } finally { s.busy = false; }
  res.json({ ok: true });
});
sftpRouter.get('/:sid/download', async (req, res) => {
  const s = sess(req); const p = rpath(req.query.path);
  const st = await s.client.stat(p).catch(() => { throw httpError(404, 'File not found'); });
  if (st.isDirectory) throw httpError(400, 'Cannot download a directory this way');
  let start = 0; const m = /^bytes=(\d+)-/.exec(req.get('range') || '');
  if (m) start = Math.min(Number(m[1]), st.size);
  res.status(start ? 206 : 200);
  res.set({
    'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes',
    'Content-Length': st.size - start,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(posix.basename(p))}`,
    'X-Content-Type-Options': 'nosniff',
  });
  if (start) res.set('Content-Range', `bytes ${start}-${st.size - 1}/${st.size}`);
  if (st.size - start <= 0) return res.end();
  s.busy = true; let aborted = false;
  res.on('close', () => { aborted = true; });
  try { await pipelinedDownload(s.client.sftp, p, start, st.size, res, () => aborted); if (!aborted) res.end(); }
  catch { res.destroy(); }
  finally { s.busy = false; }
});
sftpRouter.get('/:sid/text', async (req, res) => {
  const s = sess(req); const p = rpath(req.query.path);
  const st = await s.client.stat(p).catch(() => { throw httpError(404, 'File not found'); });
  if (st.size > 2 * 1024 * 1024) throw httpError(413, 'File is larger than 2 MB — download it instead');
  const buf = await s.client.get(p);
  if (buf.subarray(0, 4096).includes(0)) throw httpError(415, 'This looks like a binary file');
  res.json({ text: buf.toString('utf8'), size: st.size });
});
sftpRouter.put('/:sid/text', async (req, res) => {
  const s = sess(req);
  if (typeof req.body?.text !== 'string') throw httpError(400, 'text required');
  await s.client.put(Buffer.from(req.body.text, 'utf8'), rpath(req.query.path));
  res.json({ ok: true });
});

/* ---------------- Local pane (optional) + server-side transfers ---------------- */
function localAbs(p) {
  if (!LOCAL_ROOT) throw httpError(403, 'Local pane is disabled on this server');
  const abs = path.resolve(LOCAL_ROOT, '.' + posix.normalize('/' + String(p ?? '/')));
  if (abs !== LOCAL_ROOT && !abs.startsWith(LOCAL_ROOT + path.sep)) throw httpError(403, 'Outside the allowed folder');
  return abs;
}
async function localSafe(p) { // also defeats symlink escapes
  const abs = localAbs(p);
  const real = await fsp.realpath(abs).catch(() => abs);
  if (real !== LOCAL_ROOT && !real.startsWith(LOCAL_ROOT + path.sep)) throw httpError(403, 'Outside the allowed folder');
  return abs;
}
export const localRouter = Router();
localRouter.get('/list', async (req, res) => {
  const abs = await localSafe(req.query.path);
  const ents = await fsp.readdir(abs, { withFileTypes: true }).catch(e => { throw httpError(e.code === 'ENOENT' ? 404 : 403, e.code === 'ENOENT' ? 'No such directory' : 'Permission denied'); });
  const items = (await Promise.all(ents.map(async d => {
    try {
      const st = await fsp.stat(path.join(abs, d.name));
      return { name: d.name, type: st.isDirectory() ? 'dir' : 'file', size: st.size, mtime: st.mtimeMs };
    } catch { return null; }
  }))).filter(Boolean);
  items.sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? collator.compare(a.name, b.name) : a.type === 'dir' ? -1 : 1);
  res.json({ path: posix.normalize('/' + String(req.query.path ?? '/')).replace(/\/+$/, '') || '/', items });
});
localRouter.post('/mkdir', async (req, res) => { await fsp.mkdir(await localSafe(req.body.path), { recursive: true }); res.json({ ok: true }); });
localRouter.post('/rename', async (req, res) => { await fsp.rename(await localSafe(req.body.from), await localSafe(req.body.to)); res.json({ ok: true }); });
localRouter.post('/delete', async (req, res) => {
  for (const p of req.body.paths || []) {
    const abs = await localSafe(p); if (abs === LOCAL_ROOT) throw httpError(400, 'Refusing to delete the root');
    await fsp.rm(abs, { recursive: true, force: true });
  }
  res.json({ ok: true });
});


/* ---------------- Safe inline preview ("View") ---------------- */
const TEXT_EXT = new Set(['txt','log','md','markdown','json','js','mjs','cjs','ts','jsx','tsx','css','scss','html','htm','xml','yml','yaml','csv','tsv','ini','conf','cfg','sh','bash','py','rb','php','java','c','h','cpp','hpp','go','rs','sql','env','toml','properties','gitignore','dockerfile','makefile','lock']);
const MEDIA = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', pdf: 'application/pdf',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac' };
export function viewType(name) {
  const ext = posix.extname(name).slice(1).toLowerCase() || name.toLowerCase();
  if (MEDIA[ext]) return MEDIA[ext];
  if (TEXT_EXT.has(ext)) return 'text/plain; charset=utf-8'; // html/xml/js are shown as source, never executed
  return null;
}
function viewHeaders(res, name, type) {
  res.set({
    'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`, 'Referrer-Policy': 'no-referrer',
    // sandbox => even an SVG or a mislabelled file cannot run script with our origin. (PDFs need the browser's own viewer.)
    'Content-Security-Policy': type === 'application/pdf' ? "default-src 'none'" : "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
  });
}
function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || ''); if (!m || (!m[1] && !m[2])) return null;
  let a = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])); let b = m[1] && m[2] ? Number(m[2]) : size - 1;
  b = Math.min(b, size - 1); return a > b || a >= size ? 'bad' : [a, b];
}
sftpRouter.get('/:sid/view', async (req, res) => {
  const s = sess(req); const p = rpath(req.query.path); const name = posix.basename(p);
  const type = viewType(name); if (!type) throw httpError(415, 'No safe preview for this file type — download it instead');
  const st = await s.client.stat(p).catch(() => { throw httpError(404, 'File not found'); });
  if (st.isDirectory) throw httpError(400, 'That is a folder');
  const r = parseRange(req.get('range'), st.size);
  if (r === 'bad') return res.status(416).set('Content-Range', `bytes */${st.size}`).end();
  const [a, b] = r || [0, st.size - 1];
  viewHeaders(res, name, type);
  res.status(r ? 206 : 200).set('Content-Length', Math.max(0, b - a + 1));
  if (r) res.set('Content-Range', `bytes ${a}-${b}/${st.size}`);
  if (st.size === 0) return res.end();
  let aborted = false; res.on('close', () => { aborted = true; }); s.busy = true;
  try { await pipelinedDownload(s.client.sftp, p, a, b + 1, res, () => aborted); if (!aborted) res.end(); } catch { res.destroy(); } finally { s.busy = false; }
});
localRouter.get('/view', async (req, res) => {
  const abs = await localSafe(req.query.path); const name = path.basename(abs);
  const type = viewType(name); if (!type) throw httpError(415, 'No safe preview for this file type');
  const st = await fsp.stat(abs).catch(() => { throw httpError(404, 'File not found'); });
  if (!st.isFile()) throw httpError(400, 'Not a file');
  const r = parseRange(req.get('range'), st.size);
  if (r === 'bad') return res.status(416).set('Content-Range', `bytes */${st.size}`).end();
  const [a, b] = r || [0, st.size - 1];
  viewHeaders(res, name, type);
  res.status(r ? 206 : 200).set('Content-Length', Math.max(0, b - a + 1));
  if (r) res.set('Content-Range', `bytes ${a}-${b}/${st.size}`);
  if (st.size === 0) return res.end();
  fs.createReadStream(abs, { start: a, end: b }).on('error', () => res.destroy()).pipe(res);
});

async function walkLocal(abs, rel = '') {
  const st = await fsp.stat(abs);
  if (!st.isDirectory()) return [{ rel, abs, size: st.size }];
  const out = [{ rel, dir: true }];
  for (const d of await fsp.readdir(abs)) out.push(...await walkLocal(path.join(abs, d), posix.join(rel, d)));
  return out;
}
async function walkRemote(client, p, rel = '') {
  const out = [{ rel, dir: true }];
  for (const f of await client.list(p)) {
    if (f.type === 'd') out.push(...await walkRemote(client, posix.join(p, f.name), posix.join(rel, f.name)));
    else if (f.type === '-') out.push({ rel: posix.join(rel, f.name), size: f.size });
  }
  return out;
}


/* Data-quality checks for server-side transfers: always compare sizes; optionally compare SHA-256 end to end. */
async function sha256Local(file) { const h = createHash('sha256'); for await (const c of fs.createReadStream(file)) h.update(c); return h.digest('hex'); }
async function sha256Remote(sftp, file, size) {
  const h = createHash('sha256'); const sink = { write: (b) => { h.update(b); return true; }, once() { return sink; } };
  await pipelinedDownload(sftp, file, 0, size, sink, () => false); return h.digest('hex');
}
async function verifyTransfer(client, localFile, remoteFile, verify) {
  const [ls, rs] = [await fsp.stat(localFile), await client.stat(remoteFile)];
  if (ls.size !== rs.size) throw new Error(`Verification failed: local ${ls.size} bytes vs remote ${rs.size} bytes`);
  if (verify && ls.size > 0) { const [a, b] = await Promise.all([sha256Local(localFile), sha256Remote(client.sftp, remoteFile, rs.size)]); if (a !== b) throw new Error('Verification failed: SHA-256 mismatch'); }
}

async function runJob(job, s) {
  const NC = getNet(job.uid);
  job.state = 'running'; job.started = Date.now();
  try {
    const { client } = s;
    if (job.dir === 'up') {
      const base = await localSafe(job.local); const entries = await walkLocal(base);
      job.total = entries.reduce((a, e) => a + (e.size || 0), 0);
      const root = job.remote;
      for (const e of entries) {
        if (job.cancel) throw new Error('cancelled');
        const target = e.rel ? posix.join(root, e.rel) : root;
        if (e.dir) { await client.mkdir(target, true); continue; }
        if (!entries[0].dir) { /* single file: remote is full target path */ }
        let last = 0;
        await client.fastPut(e.abs, target, { concurrency: NC.sftpConcurrency, chunkSize: NC.sftpChunkKB * 1024, step: (t) => { job.done += t - last; last = t; } });
        await verifyTransfer(client, e.abs, target, job.verify);
        job.files++;
      }
    } else {
      const entries = await (async () => {
        const st = await client.stat(job.remote);
        if (st.isDirectory) return walkRemote(client, job.remote);
        return [{ rel: '', size: st.size }];
      })();
      job.total = entries.reduce((a, e) => a + (e.size || 0), 0);
      const base = await localSafe(job.local);
      for (const e of entries) {
        if (job.cancel) throw new Error('cancelled');
        const target = e.rel ? path.join(base, ...e.rel.split('/')) : base;
        if (e.dir) { await fsp.mkdir(target, { recursive: true }); continue; }
        await fsp.mkdir(path.dirname(target), { recursive: true });
        let last = 0;
        await client.fastGet(e.rel ? posix.join(job.remote, e.rel) : job.remote, target, { concurrency: NC.sftpConcurrency, chunkSize: NC.sftpChunkKB * 1024, step: (t) => { job.done += t - last; last = t; } });
        await verifyTransfer(client, target, e.rel ? posix.join(job.remote, e.rel) : job.remote, job.verify);
        job.files++;
      }
    }
    job.state = 'done';
  } catch (e) {
    job.state = job.cancel ? 'cancelled' : 'error'; job.error = job.cancel ? '' : friendly(e);
  } finally { job.finished = Date.now(); }
}

sftpRouter.post('/:sid/transfer', (req, res) => {
  const s = sess(req); const { dir, local, remote, verify } = req.body || {};
  if (!['up', 'down'].includes(dir)) throw httpError(400, 'dir must be up or down');
  localAbs(local); // validates + enforces enabled
  const job = { id: crypto.randomUUID(), uid: req.user.id, sid: req.params.sid, dir, local, remote: rpath(remote),
    name: posix.basename(dir === 'up' ? String(local) : rpath(remote)) || '/', total: 0, done: 0, files: 0, state: 'queued', error: '', verify: !!verify };
  jobs.set(job.id, job);
  s.chain = s.chain.then(() => runJob(job, s)); // one at a time per connection
  res.json({ id: job.id });
});
sftpRouter.get('/jobs', (req, res) => {
  res.json([...jobs.values()].filter(j => j.uid === req.user.id).map(({ uid, ...j }) => j));
});
sftpRouter.post('/jobs/:id/cancel', (req, res) => {
  const j = jobs.get(req.params.id);
  if (j && j.uid === req.user.id) { j.cancel = true; if (j.state === 'queued') { j.state = 'cancelled'; } }
  res.json({ ok: true });
});
