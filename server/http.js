import { getNet, proxyFor, customAgent } from './netconf.js';
import { Router } from 'express';
import dns from 'node:dns';
import dnsp from 'node:dns/promises';
import net from 'node:net';
import { fetch, Agent, FormData } from 'undici';
import { httpError } from './auth.js';
import { BLOCK_PRIVATE } from './config.js';
import { sign as oauth1Sign, authorizationHeader } from './oauth1.js';
import { parseChallenge, digestHeader, awsSign, jwtSign } from './authsig.js';

// Connect-time DNS with a short, *validated* cache: every address is checked against the private-range blocklist
// (when DEVHUB_BLOCK_PRIVATE=1) before it is cached, so caching can't be used to skip the check.
const dnsCache = new Map(); const DNS_TTL = 30_000;
const safeLookup = (host, opts, cb) => {
  const key = host + '|' + (opts.family || 0); const hit = dnsCache.get(key);
  const reply = (list) => opts.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  if (hit && hit.exp > Date.now()) return reply(hit.list);
  dns.lookup(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    if (BLOCK_PRIVATE && list.some(a => isPrivate(a.address))) return cb(Object.assign(new Error('Requests to private addresses are blocked on this server'), { code: 'EBLOCKED' }));
    if (dnsCache.size > 500) dnsCache.clear();
    dnsCache.set(key, { list, exp: Date.now() + DNS_TTL });
    reply(list);
  });
};
// Keep-alive pools (TLS sessions are reused) + HTTP/2 multiplexing when the server offers it via ALPN.
const pool = { allowH2: true, connections: 64, keepAliveTimeout: 30_000, keepAliveMaxTimeout: 120_000 };
const agents = {
  verify: new Agent({ ...pool, connect: { timeout: 15000, lookup: safeLookup } }),
  insecure: new Agent({ ...pool, connect: { timeout: 15000, rejectUnauthorized: false, lookup: safeLookup } }),
};
const MAX_BYTES = 20 * 1024 * 1024;
const TEXT_RE = /(json|text|xml|javascript|html|x-www-form-urlencoded|csv|yaml|graphql|svg)/i;

const blocked = new net.BlockList();
for (const [n, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4]]) blocked.addSubnet(n, p, 'ipv4');
for (const [n, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(n, p, 'ipv6');
function isPrivate(ip) {
  ip = ip.replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return blocked.check(ip, 'ipv4');
  if (!net.isIPv6(ip)) return false;
  const m = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip); // IPv4-mapped
  if (m) { const v4 = m[1] || [parseInt(m[2], 16) >> 8, parseInt(m[2], 16) & 255, parseInt(m[3], 16) >> 8, parseInt(m[3], 16) & 255].join('.'); return blocked.check(v4, 'ipv4'); }
  return blocked.check(ip, 'ipv6');
}

export const httpRouter = Router();

httpRouter.post('/send', async (req, res) => {
  const net0 = getNet(req.user.id); // Settings → Network supplies every default a request leaves unset
  const { method = 'GET', url, headers = [], body = { mode: 'none' }, oauth1, sig } = req.body || {};
  const timeoutMs = req.body?.timeoutMs ?? net0.timeoutMs, followRedirects = req.body?.followRedirects ?? net0.followRedirects, verifySsl = req.body?.verifySsl ?? net0.verifySsl;
  const maxBytes = net0.maxResponseMB * 1024 * 1024;
  let u;
  try { u = new URL(url); } catch { throw httpError(400, 'Invalid URL — include http:// or https://'); }
  if (!/^https?:$/.test(u.protocol)) throw httpError(400, 'Only http and https URLs are supported');
  if (BLOCK_PRIVATE) {
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(bare) ? [{ address: bare }] : await dnsp.lookup(bare, { all: true }).catch(() => []);
    if (addrs.some(a => isPrivate(a.address))) throw httpError(403, 'Requests to private addresses are blocked on this server');
  }
  const m = String(method).toUpperCase();
  const h = {};
  if (net0.userAgent) h['User-Agent'] = net0.userAgent;
  for (const [k, v] of headers) if (k) h[k] = h[k] ? h[k] + ', ' + v : v;
  let payload;
  if (!['GET', 'HEAD'].includes(m)) {
    if (body.mode === 'raw') payload = body.raw ?? '';
    else if (body.mode === 'urlencoded') {
      payload = new URLSearchParams((body.pairs || []).map(p => [p[0], p[1]])).toString();
      if (!Object.keys(h).some(k => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body.mode === 'formdata') {
      const fd = new FormData();
      for (const p of body.parts || []) {
        if (p.type === 'file') fd.append(p.key, new Blob([Buffer.from(p.base64 || '', 'base64')]), p.fileName || 'file');
        else fd.append(p.key, p.value ?? '');
      }
      payload = fd;
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'content-type') delete h[k];
    } else if (body.mode === 'binary') payload = Buffer.from(body.base64 || '', 'base64');
  }

  if (oauth1 && typeof oauth1 === 'object') {
    const { params } = oauth1Sign({ method: m, url: u.href, bodyParams: body.mode === 'urlencoded' ? (body.pairs || []) : [], o: oauth1 });
    if (oauth1.addTo === 'query') for (const [k, v] of params) u.searchParams.append(k, v);
    else h.Authorization = authorizationHeader(params, oauth1.realm);
  }

  // Server-side signing (needs the final URL and body): AWS SigV4 and JWT are applied now, Digest after the 401 challenge.
  const sigStr = (x) => (typeof x === 'string' ? x : '');
  if (sig && typeof sig === 'object') {
    try {
      if (sig.type === 'aws') {
        const raw = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : '';
        Object.assign(h, awsSign({ method: m, url: u.href, headers: h, payload: raw, unsignedPayload: payload instanceof FormData,
          accessKey: sigStr(sig.accessKey), secretKey: sigStr(sig.secretKey), sessionToken: sigStr(sig.sessionToken) || undefined, region: sigStr(sig.region) || 'us-east-1', service: sigStr(sig.service) }));
      } else if (sig.type === 'jwt') {
        let payloadObj; try { payloadObj = JSON.parse(sigStr(sig.payload) || '{}'); } catch { throw httpError(400, 'JWT payload is not valid JSON'); }
        const now = Math.floor(Date.now() / 1000);
        if (sig.autoIat) payloadObj.iat ??= now; if (Number(sig.expSeconds) > 0) payloadObj.exp ??= now + Number(sig.expSeconds);
        const token = jwtSign({ payload: payloadObj, secret: sigStr(sig.secret), alg: sigStr(sig.alg) || 'HS256', secretIsBase64: !!sig.secretIsBase64 });
        if (sig.addTo === 'query') u.searchParams.set(sigStr(sig.queryName) || 'token', token);
        else h[sigStr(sig.headerName) || 'Authorization'] = (sigStr(sig.prefix ?? 'Bearer') ? sigStr(sig.prefix ?? 'Bearer') + ' ' : '') + token;
      }
    } catch (e) { throw e.status ? e : httpError(400, e.message); }
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.min(Number(timeoutMs) || 30000, 300000));
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const t0 = performance.now();
  try {
    const dispatcher = customAgent(net0, verifySsl, proxyFor(net0, u), safeLookup) || (verifySsl ? agents.verify : agents.insecure);
    const go = (hh) => fetch(u, { method: m, headers: hh, body: payload, signal: ac.signal, redirect: followRedirects ? 'follow' : 'manual', dispatcher });
    let r = await go(h);
    if (sig?.type === 'digest' && r.status === 401) {
      const ch = parseChallenge(r.headers.get('www-authenticate'));
      if (ch) {
        await r.body?.cancel?.().catch(() => {});
        const raw = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('latin1') : '';
        r = await go({ ...h, Authorization: digestHeader({ challenge: ch, username: sigStr(sig.username), password: sigStr(sig.password), method: m, uri: u.pathname + u.search, body: raw }) });
      }
    }
    const ttfb = performance.now() - t0;
    const chunks = []; let size = 0; let truncated = false;
    if (r.body) {
      for await (const c of r.body) {
        size += c.length;
        if (size > maxBytes) { truncated = true; break; }
        chunks.push(c);
      }
    }
    const buf = Buffer.concat(chunks);
    const ct = r.headers.get('content-type') || '';
    const looksText = TEXT_RE.test(ct) || (!ct && !buf.subarray(0, 2048).includes(0));
    const rh = [...r.headers].filter(([k]) => k !== 'set-cookie');
    for (const c of r.headers.getSetCookie?.() || []) rh.push(['set-cookie', c]);
    res.json({
      status: r.status, statusText: r.statusText, url: r.url, redirected: r.redirected,
      headers: rh, contentType: ct, size, truncated,
      timeMs: Math.round(performance.now() - t0), ttfbMs: Math.round(ttfb),
      isText: looksText,
      bodyText: looksText ? buf.toString('utf8') : undefined,
      bodyBase64: !looksText && buf.length <= 8 * 1024 * 1024 ? buf.toString('base64') : undefined,
    });
  } catch (e) {
    const code = e.cause?.code || e.code;
    const msg = e.name === 'AbortError' ? `Request timed out after ${timeoutMs} ms`
      : code === 'ECONNREFUSED' ? `Connection refused (${u.host})`
      : code === 'EBLOCKED' ? 'Requests to private addresses are blocked on this server'
      : code === 'ENOTFOUND' ? `Could not resolve host ${u.hostname}`
      : /certificate|self.signed|SSL/i.test(String(e.cause?.message || code)) ? `TLS error: ${e.cause?.message || code}. Disable "Verify SSL" to continue.`
      : (e.cause?.message || e.message);
    throw httpError(502, msg);
  } finally { clearTimeout(timer); }
});
