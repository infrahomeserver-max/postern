// Mock servers: public, unguessable-URL endpoints that answer from routes the owner defines.
//   <origin>/mock/<mockId>/<path>
import express, { Router } from 'express';
import crypto from 'node:crypto';
import { docs } from './db.js';
import { httpError } from './auth.js';

const LOG_MAX = 100;
const logs = new Map();      // mockId -> [entries]
const cache = new Map();     // mockId -> { at, hit }
const rate = new Map();      // mockId -> { sec, n }

function lookup(id) {
  const c = cache.get(id);
  if (c && Date.now() - c.at < 1500) return c.hit;
  const hit = /^[\w-]{8,64}$/.test(id) ? docs.getAny('mock', id) : null;
  cache.set(id, { at: Date.now(), hit });
  if (cache.size > 2000) cache.clear();
  return hit;
}

/* ---- route matching: /users/:id, /files/*, exact paths; method ANY matches everything ---- */
const segs = (p) => String(p).split('?')[0].split('/').filter(Boolean);
function match(pattern, path) {
  const ps = segs(pattern), xs = segs(path), params = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i] === '*') { params['*'] = xs.slice(i).join('/'); return params; }
    if (xs[i] === undefined) return null;
    if (ps[i].startsWith(':')) { try { params[ps[i].slice(1)] = decodeURIComponent(xs[i]); } catch { params[ps[i].slice(1)] = xs[i]; } }
    else if (ps[i] !== xs[i]) return null;
  }
  return xs.length === ps.length ? params : null;
}

/* ---- SOAP: find the operation (first element inside Body) and SOAPAction without a full XML parse.
   Bounded manual scan of the first 64 KB: no backtracking regexes, so hostile bodies can't cause slowdowns, and no entity expansion. ---- */
const E11 = 'http://schemas.xmlsoap.org/soap/envelope/', E12 = 'http://www.w3.org/2003/05/soap-envelope';
function soapInfo(req, raw) {
  const head = raw.slice(0, 65536);
  const ct = req.get('content-type') || '';
  const hdrAct = req.get('soapaction'); const ctAct = /action\s*=\s*"?([^";]*)"?/i.exec(ct);
  const action = (hdrAct != null ? hdrAct : ctAct ? ctAct[1] : '').replace(/^"|"$/g, '').trim();
  const version = head.includes(E12) ? '1.2' : head.includes(E11) ? '1.1' : /soap\+xml/i.test(ct) ? '1.2' : '1.1';
  let operation = '';
  const bm = /<(?:[\w.-]+:)?Body[\s>\/]/.exec(head);
  if (bm) {
    let i = head.indexOf('>', bm.index) + 1;
    for (let guard = 0; guard < 50 && i > 0 && i < head.length; guard++) {
      while (i < head.length && /\s/.test(head[i])) i++;
      if (head.startsWith('<!--', i)) { const e = head.indexOf('-->', i + 4); if (e < 0) break; i = e + 3; continue; }
      if (head.startsWith('<?', i)) { const e = head.indexOf('?>', i + 2); if (e < 0) break; i = e + 2; continue; }
      const m = /^<(?:[\w.-]+:)?([\w.-]+)/.exec(head.slice(i, i + 200)); if (m) operation = m[1]; break;
    }
  }
  const isSoap = !!bm || hdrAct != null || /soap/i.test(ct) || head.includes(E11) || head.includes(E12);
  return { action, operation, version, isSoap };
}
const xmlTag = (raw, name) => { if (!/^[\w.-]{1,64}$/.test(name)) return undefined; const m = new RegExp('<(?:[\\w.-]+:)?' + name.replace(/\./g, '\\.') + '(?:\\s[^>]*)?>([^<]*)<').exec(raw.slice(0, 262144)); return m ? m[1] : undefined; };
const soapFault = (v, msg) => v === '1.2'
  ? `<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="${E12}"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Sender</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="en">${msg}</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>`
  : `<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="${E11}"><soap:Body><soap:Fault><faultcode>soap:Client</faultcode><faultstring>${msg}</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
const escXml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---- templating: {{params.id}} {{query.q}} {{headers.x-foo}} {{body.user.name}} {{$guid}} ... ---- */
const NAMES = ['Ada', 'Alan', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken'];
function dynamic(k) {
  switch (k) {
    case '$guid': case '$randomUUID': return crypto.randomUUID();
    case '$timestamp': return String(Math.floor(Date.now() / 1000));
    case '$isoTimestamp': return new Date().toISOString();
    case '$randomInt': return String(crypto.randomInt(0, 1000));
    case '$randomName': return NAMES[crypto.randomInt(0, NAMES.length)];
    case '$randomEmail': return `${NAMES[crypto.randomInt(0, NAMES.length)].toLowerCase()}${crypto.randomInt(0, 999)}@example.com`;
    default: return '';
  }
}
function path(obj, p) { return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function render(tpl, ctx, mode) { // mode: 'json' | 'xml' | falsy — keeps bodies valid when values contain quotes / markup
  return String(tpl ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, k) => {
    let v = k.startsWith('$') ? dynamic(k) : path(ctx, k);
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v);
    if (mode === 'json') return JSON.stringify(v).slice(1, -1);
    if (mode === 'xml') return k.startsWith('xml.') ? v : escXml(v); // xml.* values are copied from the request as-is (already escaped)
    return v;
  });
}

const SENSITIVE = new Set(['authorization', 'cookie', 'x-mock-key', 'proxy-authorization']);
function record(id, e) {
  const l = logs.get(id) || []; l.unshift(e); if (l.length > LOG_MAX) l.length = LOG_MAX; logs.set(id, l);
  if (logs.size > 2000) logs.delete(logs.keys().next().value);
}

/* ---------------- public endpoint ---------------- */
export const mockRouter = Router();
mockRouter.use(express.raw({ type: () => true, limit: '1mb' }));

mockRouter.all(['/:id', '/:id/*rest'], async (req, res) => {
  const t0 = Date.now(); const id = req.params.id;
  // Responses are user-authored content served from our origin: neutralise anything active.
  res.set({ 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  const found = lookup(id);
  const mock = found?.doc;
  if (!mock || mock.enabled === false) return res.status(404).json({ error: 'Mock server not found or disabled' });

  const sec = Math.floor(t0 / 1000); const r = rate.get(id) || { sec, n: 0 };
  if (r.sec !== sec) { r.sec = sec; r.n = 0; } r.n++; rate.set(id, r);
  if (r.n > 200) return res.status(429).json({ error: 'Mock rate limit (200 req/s) exceeded' });

  if (mock.cors !== false) {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': req.get('access-control-request-headers') || '*', 'Access-Control-Max-Age': '600' });
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  if (mock.requireKey && mock.key) {
    const given = req.get('x-mock-key') || req.query.mockKey || '';
    const a = Buffer.from(String(given)), b = Buffer.from(String(mock.key));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Missing or invalid X-Mock-Key' });
  }

  const sub = '/' + (req.params.rest ? [].concat(req.params.rest).join('/') : '');
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  let body = rawBody;
  if (/json/i.test(req.get('content-type') || '')) { try { body = JSON.parse(rawBody); } catch { /* keep string */ } }
  else if (/x-www-form-urlencoded/i.test(req.get('content-type') || '')) body = Object.fromEntries(new URLSearchParams(rawBody));

  const soap = req.method === 'POST' ? soapInfo(req, rawBody) : { action: '', operation: '', version: '1.1', isSoap: false };
  let route = null, params = {};
  for (const rt of mock.routes || []) {
    if (rt.enabled === false) continue;
    if (rt.method && rt.method !== 'ANY' && rt.method !== req.method) continue;
    if (rt.soapOperation || rt.soapAction) { // SOAP route: match by operation element name and/or SOAPAction
      if (!soap.isSoap) continue;
      if (rt.soapOperation && rt.soapOperation !== soap.operation) continue;
      if (rt.soapAction && soap.action && rt.soapAction !== soap.action) continue;
    }
    const m = match(rt.path || '/', sub); if (m) { route = rt; params = m; break; }
  }
  const ctx = { params, query: req.query, headers: Object.fromEntries(Object.entries(req.headers)), body, method: req.method, path: sub,
    soap: { operation: soap.operation, action: soap.action, version: soap.version },
    xml: new Proxy({}, { get: (_, k) => typeof k === 'string' ? xmlTag(rawBody, k) : undefined }) };
  const unmatchedSoap = !route && soap.isSoap;
  const resp = route || (unmatchedSoap ? { status: 500, headers: [{ key: 'Content-Type', value: soap.version === '1.2' ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8' }], body: soapFault(soap.version, `No mock operation matches ${soap.operation ? escXml(soap.operation) : 'this request'}`) } : mock.fallback || { status: 404, body: '{"error":"No mock route matches {{method}} {{path}}"}' });
  const status = Math.min(599, Math.max(100, Number(resp.status) || 200));
  const bodyText = resp.body ?? '';
  const isJson = /^\s*[{[]/.test(bodyText) || /json/i.test(JSON.stringify(resp.headers || [])) || !resp.headers?.length;

  if (resp.delay) await new Promise(r => setTimeout(r, Math.min(Math.max(Number(resp.delay) || 0, 0), 10000)));
  let hasCt = false;
  for (const h of resp.headers || []) {
    if (!h.key || h.enabled === false || /[\r\n]/.test(h.key + h.value)) continue;
    if (/^(content-length|transfer-encoding|connection|set-cookie|content-security-policy)$/i.test(h.key)) continue;
    if (h.key.toLowerCase() === 'content-type') hasCt = true;
    try { res.set(h.key, render(h.value, ctx, false)); } catch { /* invalid header value */ }
  }
  const mode = /^\s*</.test(bodyText) ? 'xml' : /^\s*[{[]/.test(bodyText) ? 'json' : false;
  if (!hasCt) res.type(mode === 'json' ? 'application/json; charset=utf-8' : mode === 'xml' ? 'text/xml; charset=utf-8' : 'text/plain; charset=utf-8');
  const out = render(bodyText, ctx, mode).slice(0, 1_000_000);
  res.status(status).send(req.method === 'HEAD' ? undefined : out);

  const hdr = {}; for (const [k, v] of Object.entries(req.headers)) hdr[k] = SENSITIVE.has(k) ? '••••' : String(v).slice(0, 300);
  record(id, { t: t0, method: req.method, path: sub + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''), status, ms: Date.now() - t0, route: route?.id || null, matched: !!route, headers: hdr, body: rawBody.slice(0, 2000), ip: req.ip });
});

/* ---------------- owner API (authenticated) ---------------- */
export const mockApi = Router();
const owned = (req) => { const m = docs.get(req.user.id, 'mock', req.params.id); if (!m) throw httpError(404, 'Mock not found'); return m; };
mockApi.get('/:id/logs', (req, res) => { owned(req); res.json(logs.get(req.params.id) || []); });
mockApi.delete('/:id/logs', (req, res) => { owned(req); logs.delete(req.params.id); res.json({ ok: true }); });
mockApi.post('/:id/rotate-key', (req, res) => {
  const m = owned(req); const { _updated, id, ...rest } = m; const key = crypto.randomBytes(18).toString('base64url');
  docs.put(req.user.id, 'mock', id, { ...rest, key }); cache.delete(id); res.json({ key });
});
