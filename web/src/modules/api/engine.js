import { api, uid } from '../../api.js';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const newRequest = (over = {}) => ({
  id: uid(), type: 'request', name: 'New Request', method: 'GET', url: '',
  params: [], headers: [],
  auth: { type: 'none', basic: { username: '', password: '' }, bearer: { token: '' }, apikey: { key: '', value: '', in: 'header' }, oauth2: { tokenUrl: '', clientId: '', clientSecret: '', scope: '', accessToken: '' },
    oauth1: { consumerKey: '', consumerSecret: '', token: '', tokenSecret: '', signatureMethod: 'HMAC-SHA1', addTo: 'header', realm: '', callback: '', verifier: '', timestamp: '', nonce: '', version: '1.0' } },
  body: { mode: 'none', rawType: 'json', raw: '', urlencoded: [], formdata: [], graphql: { query: '', variables: '' }, binary: null },
  soap: null, preScript: '', tests: '', settings: {}, // empty = use the defaults from Settings → Network
  ...over,
});

export const SOAP_NS = { '1.1': 'http://schemas.xmlsoap.org/soap/envelope/', '1.2': 'http://www.w3.org/2003/05/soap-envelope' };
export const soapTemplate = (v = '1.1') => `<soapenv:Envelope xmlns:soapenv="${SOAP_NS[v]}">\n   <soapenv:Header/>\n   <soapenv:Body>\n      \n   </soapenv:Body>\n</soapenv:Envelope>`;
export const newSoapRequest = (over = {}) => {
  const { soap, body, ...rest } = over; const r = newRequest({ name: 'New SOAP request', method: 'POST', ...rest });
  r.soap = { version: '1.1', action: '', operation: '', wsdl: '', service: '', port: '', ops: [], assertions: [{ id: uid(), type: 'nofault', enabled: true }], ...soap };
  r.body = { ...r.body, mode: 'raw', rawType: 'xml', raw: body?.raw ?? soapTemplate(r.soap.version) };
  return r;
};
export const isSoap = (r) => !!r?.soap;

const dyn = (k) => {
  switch (k) {
    case '$timestamp': return String(Math.floor(Date.now() / 1000));
    case '$isoTimestamp': return new Date().toISOString();
    case '$guid': case '$randomUUID': return crypto.randomUUID ? crypto.randomUUID() : uid();
    case '$randomInt': return String(Math.floor(Math.random() * 1000));
    default: return null;
  }
};
export function resolve(str, vars) {
  if (typeof str !== 'string' || !str.includes('{{')) return str;
  return str.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => k.startsWith('$') ? (dyn(k) ?? m) : k in vars ? String(vars[k]) : m);
}
export const envToVars = (env) => Object.fromEntries((env?.values || []).filter(v => v.enabled !== false && v.key).map(v => [v.key, v.value]));

/* URL <-> params sync (enabled params live in the URL, disabled ones stay in the table) */
export function urlFromParams(url, params) {
  const base = url.split('?')[0].split('#')[0];
  const q = params.filter(p => p.enabled !== false && (p.key || p.value)).map(p => `${p.key}${p.value !== '' || p.key === '' ? '=' + p.value : ''}`).join('&');
  return q ? `${base}?${q}` : base;
}
export function paramsFromUrl(url, prev) {
  const i = url.indexOf('?');
  const q = i < 0 ? '' : url.slice(i + 1).split('#')[0];
  const enabled = q ? q.split('&').filter(Boolean).map(s => { const j = s.indexOf('='); return { key: j < 0 ? s : s.slice(0, j), value: j < 0 ? '' : s.slice(j + 1), enabled: true }; }) : [];
  return [...enabled, ...prev.filter(p => p.enabled === false)];
}

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/* Turn a saved request + variables into the exact wire request */
export function prepare(req, vars, extraHeaders = []) {
  const R = (s) => resolve(s, vars);
  const base = R(req.url.split('?')[0]);
  const qs = req.params.filter(p => p.enabled !== false && p.key).map(p => [R(p.key), R(p.value)]);
  const headers = req.headers.filter(h => h.enabled !== false && h.key).map(h => [R(h.key), R(h.value)]);
  for (const h of extraHeaders) if (h?.key) headers.push([R(h.key), R(h.value)]);
  const has = (n) => headers.some(([k]) => k.toLowerCase() === n.toLowerCase());
  if (req.soap) { // SOAP over HTTP is always POST; Content-Type and SOAPAction follow the SOAP version
    const act = R(req.soap.action || '');
    if (req.soap.version === '1.2') { if (!has('content-type')) headers.push(['Content-Type', `application/soap+xml; charset=utf-8${act ? `; action="${act}"` : ''}`]); }
    else { if (!has('content-type')) headers.push(['Content-Type', 'text/xml; charset=utf-8']); if (!has('soapaction')) headers.push(['SOAPAction', `"${act}"`]); }
    if (!has('accept')) headers.push(['Accept', 'text/xml, application/soap+xml, */*']);
  }
  const a = req.auth || { type: 'none' };
  if (a.type === 'basic') headers.push(['Authorization', 'Basic ' + btoa(unescape(encodeURIComponent(`${R(a.basic.username)}:${R(a.basic.password)}`)))]);
  else if (a.type === 'bearer' && a.bearer.token) headers.push(['Authorization', 'Bearer ' + R(a.bearer.token)]);
  else if (a.type === 'oauth2' && a.oauth2.accessToken) headers.push(['Authorization', 'Bearer ' + R(a.oauth2.accessToken)]);
  else if (a.type === 'apikey' && a.apikey.key) { if (a.apikey.in === 'query') qs.push([R(a.apikey.key), R(a.apikey.value)]); else headers.push([R(a.apikey.key), R(a.apikey.value)]); }

  let oauth1;
  if (a.type === 'oauth1' && a.oauth1) { // signed server-side at send time (timestamp/nonce are fresh on every call)
    const o = a.oauth1; oauth1 = { signatureMethod: o.signatureMethod, addTo: o.addTo, version: o.version || '1.0' };
    for (const k of ['consumerKey', 'consumerSecret', 'token', 'tokenSecret', 'realm', 'callback', 'verifier', 'timestamp', 'nonce']) if (o[k]) oauth1[k] = R(o[k]);
  }
  const b = req.body || { mode: 'none' };
  let body = { mode: 'none' };
  if (b.mode === 'raw') {
    body = { mode: 'raw', raw: R(b.raw) };
    if (!has('content-type')) headers.push(['Content-Type', { json: 'application/json', text: 'text/plain', xml: 'application/xml', html: 'text/html', js: 'application/javascript' }[b.rawType] || 'text/plain']);
  } else if (b.mode === 'graphql') {
    let variables; try { variables = b.graphql.variables?.trim() ? JSON.parse(R(b.graphql.variables)) : undefined; } catch { variables = undefined; }
    body = { mode: 'raw', raw: JSON.stringify({ query: R(b.graphql.query), variables }) };
    if (!has('content-type')) headers.push(['Content-Type', 'application/json']);
  } else if (b.mode === 'urlencoded') body = { mode: 'urlencoded', pairs: b.urlencoded.filter(p => p.enabled !== false && p.key).map(p => [R(p.key), R(p.value)]) };
  else if (b.mode === 'formdata') body = { mode: 'formdata', parts: b.formdata.filter(p => p.enabled !== false && p.key).map(p => p.type === 'file' ? { type: 'file', key: R(p.key), fileName: p.fileName, base64: p.base64 } : { type: 'text', key: R(p.key), value: R(p.value) }) };
  else if (b.mode === 'binary' && b.binary) body = { mode: 'binary', base64: b.binary.base64 };

  const qstr = qs.map(([k, v]) => `${encodeURIComponent(safeDecode(k))}=${encodeURIComponent(safeDecode(v))}`).join('&');
  let url = base.trim();
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;
  if (qstr) url += (url.includes('?') ? '&' : '?') + qstr;
  let sig;
  if (a.type === 'digest' && a.digest) sig = { type: 'digest', username: R(a.digest.username), password: R(a.digest.password) };
  else if (a.type === 'aws' && a.aws) sig = { type: 'aws', accessKey: R(a.aws.accessKey), secretKey: R(a.aws.secretKey), sessionToken: R(a.aws.sessionToken || ''), region: R(a.aws.region || 'us-east-1'), service: R(a.aws.service || 'execute-api') };
  else if (a.type === 'jwt' && a.jwt) { const j = a.jwt; sig = { type: 'jwt', alg: j.alg || 'HS256', secret: R(j.secret), secretIsBase64: !!j.secretIsBase64, payload: R(j.payload || '{}'), autoIat: j.autoIat !== false, expSeconds: Number(j.expSeconds) || 0, addTo: j.addTo || 'header', headerName: R(j.headerName || 'Authorization'), prefix: j.prefix ?? 'Bearer', queryName: R(j.queryName || 'token') }; }
  return { method: req.soap ? 'POST' : req.method, url, headers, body, oauth1, sig };
}

/* ---- sandbox (opaque-origin iframe; CSP forbids all network access) ---- */
let frame, ready, pendingRuns = new Map();
function ensureSandbox() {
  if (ready) return ready;
  ready = new Promise((resolveReady) => {
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.display = 'none'; frame.src = '/sandbox/runner.html';
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow) return;
      if (e.data?.ready) return resolveReady();
      const p = pendingRuns.get(e.data?.id); if (p) { pendingRuns.delete(e.data.id); clearTimeout(p.t); p.resolve(e.data); }
    };
    addEventListener('message', onMsg);
    document.body.appendChild(frame);
  });
  return ready;
}
function resetSandbox() { frame?.remove(); frame = null; ready = null; for (const p of pendingRuns.values()) p.resolve({ tests: [], logs: [], error: 'Script timed out (5s)', env: {}, globals: {}, vars: {}, headers: [] }); pendingRuns.clear(); }

export async function runScript(script, ctx) {
  if (!script?.trim()) return { tests: [], logs: [], error: '', env: {}, globals: {}, vars: {}, headers: [] };
  await ensureSandbox();
  return new Promise((resolveRun) => {
    const id = uid();
    const t = setTimeout(() => { resetSandbox(); }, 5000);
    pendingRuns.set(id, { resolve: resolveRun, t });
    frame.contentWindow.postMessage({ id, script, ctx }, '*');
  });
}

/* Full pipeline: pre-request script → resolve → send → tests. `scope` holds env + globals and is mutated by scripts. */
export async function execute(req, scope, { signal } = {}) {
  const apply = (r) => {
    for (const [k, v] of Object.entries(r.env)) { if (v === null) delete scope.env[k]; else scope.env[k] = v; }
    for (const [k, v] of Object.entries(r.globals)) { if (v === null) delete scope.globals[k]; else scope.globals[k] = v; }
    Object.assign(scope.vars, Object.fromEntries(Object.entries(r.vars).filter(([, v]) => v !== null)));
  };
  const logs = [];
  const pre = await runScript(req.preScript, { env: scope.env, globals: scope.globals, vars: scope.vars, request: { name: req.name, url: req.url, method: req.method, headers: req.headers.map(h => [h.key, h.value]) } });
  apply(pre); logs.push(...pre.logs.map(l => ({ ...l, src: 'pre-request' })));
  if (pre.error) logs.push({ level: 'error', text: 'Pre-request script: ' + pre.error });
  const vars = { ...scope.globals, ...scope.env, ...scope.vars };
  const prepared = prepare(req, vars, pre.headers);
  const s = req.settings || {};
  const resp = await api('/http/send', { method: 'POST', signal, body: { ...prepared, timeoutMs: s.timeoutMs, followRedirects: s.followRedirects, verifySsl: s.verifySsl } });
  let tests = [];
  if (req.soap) {
    const { runSoapAssertions, parseFault, looksXml } = await import('./xml.js');
    try { resp.fault = looksXml(resp) ? parseFault(resp.bodyText) : null; } catch { resp.fault = null; }
    tests.push(...runSoapAssertions(req.soap.assertions, resp, (x) => resolve(x, { ...scope.globals, ...scope.env, ...scope.vars }), (k, v) => { scope.env[k] = v; }));
  }
  if (req.tests?.trim()) {
    const r = await runScript(req.tests, { env: scope.env, globals: scope.globals, vars: scope.vars, response: resp, request: { name: req.name, url: prepared.url, method: prepared.method, headers: prepared.headers } });
    apply(r); tests = [...tests, ...r.tests]; logs.push(...r.logs.map(l => ({ ...l, src: 'tests' })));
    if (r.error) { tests.push({ name: 'Script error', pass: false, error: r.error }); }
  }
  return { resp, tests, logs, prepared };
}

export async function fetchOAuthToken(o, vars) {
  const R = (s) => resolve(s, vars);
  const grant = o.grant || 'client_credentials';
  const pairs = [['grant_type', grant]];
  if (grant === 'password') pairs.push(['username', R(o.username || '')], ['password', R(o.password || '')]);
  if (grant === 'refresh_token') pairs.push(['refresh_token', R(o.refreshToken || '')]);
  const headers = [['Accept', 'application/json']];
  if (o.clientAuth === 'basic') headers.push(['Authorization', 'Basic ' + btoa(unescape(encodeURIComponent(`${R(o.clientId)}:${R(o.clientSecret)}`)))]);
  else { if (o.clientId) pairs.push(['client_id', R(o.clientId)]); if (o.clientSecret) pairs.push(['client_secret', R(o.clientSecret)]); }
  if (o.scope) pairs.push(['scope', R(o.scope)]);
  if (o.audience) pairs.push(['audience', R(o.audience)]);
  const r = await api('/http/send', { method: 'POST', body: { method: 'POST', url: R(o.tokenUrl), headers, body: { mode: 'urlencoded', pairs } } });
  let j = {}; try { j = JSON.parse(r.bodyText || '{}'); } catch { /* not JSON */ }
  if (r.status >= 400) throw new Error(`Token endpoint returned ${r.status}${j.error_description || j.error ? ': ' + (j.error_description || j.error) : ''}`);
  if (!j.access_token) throw new Error('No access_token in response');
  return { accessToken: j.access_token, refreshToken: j.refresh_token || '' };
}

/* Collection tree helpers */
export const walk = (items, fn, trail = []) => items.forEach(it => { fn(it, trail); if (it.type === 'folder') walk(it.items, fn, [...trail, it]); });
export const mapTree = (items, fn) => items.map(it => { const n = fn(it); return n.type === 'folder' ? { ...n, items: mapTree(n.items, fn) } : n; });
export const filterTree = (items, pred) => items.filter(it => pred(it)).map(it => it.type === 'folder' ? { ...it, items: filterTree(it.items, pred) } : it);
export const countRequests = (items) => items.reduce((n, it) => n + (it.type === 'folder' ? countRequests(it.items) : 1), 0);
export const flatRequests = (items) => { const out = []; walk(items, (it, t) => it.type === 'request' && out.push({ req: it, path: t.map(x => x.name).join(' / ') })); return out; };
