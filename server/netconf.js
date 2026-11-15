// Per-user network defaults (Settings → Network). Stored as the encrypted doc settings/network, read here so that secrets
// such as the proxy password never travel back to the browser.
import { Agent, ProxyAgent } from 'undici';
import crypto from 'node:crypto';
import { docs } from './db.js';

export const NET_DEFAULTS = {
  timeoutMs: 30000, followRedirects: true, verifySsl: true, maxResponseMB: 20, userAgent: '',
  proxyMode: 'none',           // none | system (HTTP(S)_PROXY / NO_PROXY env) | custom
  proxyUrl: '', proxyUser: '', proxyPass: '', proxyBypass: 'localhost,127.0.0.1',
  caPem: '', clientCertPem: '', clientKeyPem: '', clientKeyPass: '',
  sftpConnectTimeoutSec: 15, sftpKeepaliveSec: 20, sftpRetries: 0, sftpConcurrency: 64, sftpChunkKB: 64,
};
const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

const cache = new Map();
export function getNet(uid) {
  const c = cache.get(uid); if (c && Date.now() - c.at < 2000) return c.v;
  const raw = docs.get(uid, 'settings', 'network') || {};
  const v = { ...NET_DEFAULTS, ...raw };
  v.timeoutMs = clampN(v.timeoutMs, 100, 300000, 30000);
  v.maxResponseMB = clampN(v.maxResponseMB, 1, 200, 20);
  v.sftpConnectTimeoutSec = clampN(v.sftpConnectTimeoutSec, 3, 120, 15);
  v.sftpKeepaliveSec = clampN(v.sftpKeepaliveSec, 0, 300, 20);
  v.sftpRetries = clampN(v.sftpRetries, 0, 5, 0);
  v.sftpConcurrency = clampN(v.sftpConcurrency, 1, 128, 64);
  v.sftpChunkKB = clampN(v.sftpChunkKB, 16, 1024, 64);
  cache.set(uid, { at: Date.now(), v }); if (cache.size > 500) cache.clear();
  return v;
}
export const dropNetCache = (uid) => cache.delete(uid);

const bypassed = (host, list) => String(list || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  .some(p => p === '*' || host === p.replace(/^\*?\./, '') || host.endsWith('.' + p.replace(/^\*?\./, '')));

/* The proxy to use for this URL, or null. 'system' mode follows the usual environment variables. */
export function proxyFor(net, u) {
  const host = u.hostname.toLowerCase();
  if (net.proxyMode === 'custom' && net.proxyUrl) {
    if (bypassed(host, net.proxyBypass)) return null;
    let url = /^[a-z]+:\/\//i.test(net.proxyUrl) ? net.proxyUrl : 'http://' + net.proxyUrl;
    return { url, user: net.proxyUser, pass: net.proxyPass };
  }
  if (net.proxyMode === 'system') {
    const env = process.env, url = u.protocol === 'https:' ? (env.HTTPS_PROXY || env.https_proxy) : (env.HTTP_PROXY || env.http_proxy);
    if (!url || bypassed(host, env.NO_PROXY || env.no_proxy)) return null;
    return { url, user: '', pass: '' };
  }
  return null;
}

const agentCache = new Map();
/* Dispatcher honouring proxy, extra CA and client certificate. Returns null when plain defaults suffice (callers use their shared pools). */
export function customAgent(net, verifySsl, proxy, lookup) {
  const tls = {};
  if (net.caPem) tls.ca = [net.caPem];
  if (net.clientCertPem && net.clientKeyPem) { tls.cert = net.clientCertPem; tls.key = net.clientKeyPem; if (net.clientKeyPass) tls.passphrase = net.clientKeyPass; }
  if (!verifySsl) tls.rejectUnauthorized = false;
  if (!proxy && !Object.keys(tls).length) return null;
  const key = crypto.createHash('sha256').update(JSON.stringify([tls, proxy])).digest('hex');
  let a = agentCache.get(key);
  if (!a) {
    if (agentCache.size > 20) { for (const old of agentCache.values()) old.close().catch(() => {}); agentCache.clear(); }
    const pool = { allowH2: true, connections: 32, keepAliveTimeout: 30_000, keepAliveMaxTimeout: 120_000 };
    if (proxy) {
      const token = proxy.user ? 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass || ''}`).toString('base64') : undefined;
      a = new ProxyAgent({ uri: proxy.url, token, requestTls: tls, ...pool });
    } else a = new Agent({ ...pool, connect: { timeout: 15000, lookup, ...tls } });
    agentCache.set(key, a);
  }
  return a;
}
