// Loaded on demand (import / export / code generation) — keeps the main API chunk small.
import { uid, api } from '../../api.js';
import { newRequest, newSoapRequest } from './engine.js';

const kv = (arr = []) => arr.map(x => ({ key: x.key ?? '', value: x.value ?? '', enabled: !x.disabled }));
const execToStr = (e) => Array.isArray(e?.exec) ? e.exec.join('\n') : (e?.exec || '');

/* ---------------- Postman v2.x ---------------- */
function pmAuth(a) {
  const out = newRequest().auth;
  if (!a) return out;
  const get = (arr, k) => (arr || []).find(x => x.key === k)?.value ?? '';
  if (a.type === 'bearer') { out.type = 'bearer'; out.bearer.token = get(a.bearer, 'token'); }
  else if (a.type === 'basic') { out.type = 'basic'; out.basic = { username: get(a.basic, 'username'), password: get(a.basic, 'password') }; }
  else if (a.type === 'apikey') { out.type = 'apikey'; out.apikey = { key: get(a.apikey, 'key'), value: get(a.apikey, 'value'), in: get(a.apikey, 'in') === 'query' ? 'query' : 'header' }; }
  else if (a.type === 'oauth1') { out.type = 'oauth1'; const g = (k) => get(a.oauth1, k); out.oauth1 = { ...out.oauth1, consumerKey: g('consumerKey'), consumerSecret: g('consumerSecret'), token: g('token'), tokenSecret: g('tokenSecret'), signatureMethod: g('signatureMethod') || 'HMAC-SHA1', realm: g('realm'), timestamp: g('timestamp'), nonce: g('nonce'), version: g('version') || '1.0', addTo: String(g('addParamsToHeader')) === 'false' ? 'query' : 'header' }; }
  else if (a.type === 'oauth2') { out.type = 'oauth2'; out.oauth2.accessToken = get(a.oauth2, 'accessToken'); out.oauth2.tokenUrl = get(a.oauth2, 'accessTokenUrl'); out.oauth2.clientId = get(a.oauth2, 'clientId'); out.oauth2.clientSecret = get(a.oauth2, 'clientSecret'); out.oauth2.scope = get(a.oauth2, 'scope'); }
  return out;
}
function pmItem(it) {
  if (it.item) return { id: uid(), type: 'folder', name: it.name || 'Folder', items: it.item.map(pmItem) };
  const r = it.request || {};
  const url = typeof r.url === 'string' ? r.url : r.url?.raw || '';
  const q = typeof r.url === 'object' ? kv(r.url.query) : [];
  const b = r.body || {};
  const body = newRequest().body;
  if (b.mode === 'raw') { body.mode = 'raw'; body.raw = b.raw || ''; const l = b.options?.raw?.language; body.rawType = ['json', 'xml', 'html', 'javascript', 'text'].includes(l) ? (l === 'javascript' ? 'js' : l) : 'text'; }
  else if (b.mode === 'urlencoded') { body.mode = 'urlencoded'; body.urlencoded = kv(b.urlencoded); }
  else if (b.mode === 'formdata') { body.mode = 'formdata'; body.formdata = (b.formdata || []).map(x => ({ key: x.key, value: x.value ?? '', type: x.type === 'file' ? 'text' : 'text', enabled: !x.disabled })); }
  else if (b.mode === 'graphql') { body.mode = 'graphql'; body.graphql = { query: b.graphql?.query || '', variables: b.graphql?.variables || '' }; }
  const ev = (n) => execToStr((it.event || []).find(e => e.listen === n)?.script);
  const headers = Array.isArray(r.header) ? kv(r.header) : [];
  return newRequest({ name: it.name || 'Request', method: (r.method || 'GET').toUpperCase(), url: url.split('?')[0] + (q.length ? '?' + q.filter(p => p.enabled).map(p => `${p.key}=${p.value}`).join('&') : (url.includes('?') ? '?' + url.split('?')[1] : '')), params: q.length ? q : paramsOf(url), headers, auth: pmAuth(r.auth), body, preScript: ev('prerequest'), tests: ev('test') });
}
const paramsOf = (url) => { const i = url.indexOf('?'); return i < 0 ? [] : url.slice(i + 1).split('&').filter(Boolean).map(s => { const j = s.indexOf('='); return { key: j < 0 ? s : s.slice(0, j), value: j < 0 ? '' : s.slice(j + 1), enabled: true }; }); };

export function fromPostman(json) {
  return { id: uid(), name: json.info?.name || 'Imported collection', items: (json.item || []).map(pmItem), description: json.info?.description || '' };
}
export function envFromPostman(json) {
  return { id: uid(), name: json.name || 'Imported environment', values: (json.values || []).map(v => ({ key: v.key, value: v.value ?? '', enabled: v.enabled !== false, secret: v.type === 'secret' })) };
}

/* ---------------- cURL ---------------- */
function tokenize(s) {
  const out = []; let cur = '', q = null, has = false;
  s = s.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) { cur += s[++i]; } else cur += c; }
    else if (c === '"' || c === "'") { q = c; has = true; }
    else if (c === '$' && s[i + 1] === "'") { q = "'"; has = true; i++; }
    else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else if (c === '\\' && i + 1 < s.length) cur += s[++i];
    else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}
export function fromCurl(cmd) {
  const t = tokenize(cmd.trim()); if (t[0] !== 'curl') throw new Error('Not a curl command');
  let method = '', url = '', data = [], form = [], user = '', headers = [], get = false, insecure = false;
  for (let i = 1; i < t.length; i++) {
    const a = t[i], next = () => t[++i];
    if (a === '-X' || a === '--request') method = next().toUpperCase();
    else if (a === '-H' || a === '--header') { const h = next(); const j = h.indexOf(':'); if (j > 0) headers.push({ key: h.slice(0, j).trim(), value: h.slice(j + 1).trim(), enabled: true }); }
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'].includes(a)) data.push(next());
    else if (a === '-F' || a === '--form') form.push(next());
    else if (a === '-u' || a === '--user') user = next();
    else if (a === '--url') url = next();
    else if (a === '-G' || a === '--get') get = true;
    else if (a === '-k' || a === '--insecure') insecure = true;
    else if (a === '-A' || a === '--user-agent') headers.push({ key: 'User-Agent', value: next(), enabled: true });
    else if (a === '-b' || a === '--cookie') headers.push({ key: 'Cookie', value: next(), enabled: true });
    else if (a === '-e' || a === '--referer') headers.push({ key: 'Referer', value: next(), enabled: true });
    else if (a === '-I' || a === '--head') method = 'HEAD';
    else if (a.startsWith('-')) { if (['-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out'].includes(a)) next(); }
    else if (!url) url = a;
  }
  const r = newRequest({ name: url.replace(/^https?:\/\//, '').slice(0, 60) || 'cURL request', url, headers });
  r.settings.verifySsl = !insecure;
  if (get && data.length) { r.url += (url.includes('?') ? '&' : '?') + data.join('&'); data = []; }
  r.params = paramsOf(r.url);
  if (user) { const j = user.indexOf(':'); r.auth.type = 'basic'; r.auth.basic = { username: j < 0 ? user : user.slice(0, j), password: j < 0 ? '' : user.slice(j + 1) }; }
  const ct = headers.find(h => h.key.toLowerCase() === 'content-type')?.value || '';
  if (form.length) { r.body.mode = 'formdata'; r.body.formdata = form.map(f => { const j = f.indexOf('='); return { key: f.slice(0, j), value: f.slice(j + 1), type: 'text', enabled: true }; }); }
  else if (data.length) {
    const raw = data.join('&');
    if (/x-www-form-urlencoded/i.test(ct)) { r.body.mode = 'urlencoded'; r.body.urlencoded = paramsOf('?' + raw).map(p => ({ ...p, value: decodeURIComponent(p.value.replace(/\+/g, ' ')) })); }
    else { r.body.mode = 'raw'; r.body.raw = raw; r.body.rawType = /json/i.test(ct) || /^\s*[{[]/.test(raw) ? 'json' : /xml/i.test(ct) ? 'xml' : 'text'; r.headers = headers.filter(h => h.key.toLowerCase() !== 'content-type' || !/json|xml|text/.test(h.value)); }
  }
  r.method = method || (form.length || data.length ? 'POST' : 'GET');
  return r;
}

/* ---------------- OpenAPI 3 / Swagger 2 ---------------- */
function sample(schema, spec, depth = 0) {
  if (!schema || depth > 4) return null;
  if (schema.$ref) { const p = schema.$ref.replace(/^#\//, '').split('/'); let o = spec; for (const k of p) o = o?.[k]; return sample(o, spec, depth + 1); }
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  const t = schema.type || (schema.properties ? 'object' : schema.items ? 'array' : 'string');
  if (t === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, sample(v, spec, depth + 1)]));
  if (t === 'array') return [sample(schema.items, spec, depth + 1)];
  if (t === 'integer' || t === 'number') return 0;
  if (t === 'boolean') return false;
  return schema.format === 'date-time' ? '2024-01-01T00:00:00Z' : 'string';
}
export function fromOpenApi(spec) {
  const server = spec.servers?.[0]?.url || (spec.host ? `${spec.schemes?.[0] || 'https'}://${spec.host}${spec.basePath || ''}` : '{{baseUrl}}');
  const folders = new Map();
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const [m, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m)) continue;
      const params = [...(ops.parameters || []), ...(op.parameters || [])];
      const r = newRequest({ name: op.summary || op.operationId || `${m.toUpperCase()} ${p}`, method: m.toUpperCase(), url: '{{baseUrl}}' + p.replace(/\{(\w+)\}/g, '{{$1}}') });
      r.params = params.filter(x => x.in === 'query').map(x => ({ key: x.name, value: String(x.example ?? x.schema?.default ?? ''), enabled: !!x.required }));
      r.headers = params.filter(x => x.in === 'header').map(x => ({ key: x.name, value: String(x.example ?? ''), enabled: !!x.required }));
      if (r.params.some(x => x.enabled)) r.url += '?' + r.params.filter(x => x.enabled).map(x => `${x.key}=${x.value}`).join('&');
      const rb = op.requestBody?.content?.['application/json'];
      if (rb) { r.body.mode = 'raw'; r.body.rawType = 'json'; r.body.raw = JSON.stringify(rb.example ?? sample(rb.schema, spec), null, 2); }
      const tag = op.tags?.[0] || 'default';
      if (!folders.has(tag)) folders.set(tag, { id: uid(), type: 'folder', name: tag, items: [] });
      folders.get(tag).items.push(r);
    }
  }
  return { collection: { id: uid(), name: spec.info?.title || 'OpenAPI import', items: [...folders.values()] }, baseUrl: server };
}

/* ---------------- FileZilla-independent detect ---------------- */
export function detect(text) {
  const t = text.trim();
  if (/^curl\s/i.test(t)) return { kind: 'request', data: fromCurl(t) };
  let j; try { j = JSON.parse(t); } catch { throw new Error('Unrecognised file. Supported: WSDL (SOAP), Postman collection/environment, OpenAPI/Swagger JSON, cURL, Postern backup.'); }
  if (j.devhub === 'backup') return { kind: 'backup', data: j };
  if (j.info?.schema?.includes('postman') || (j.info && Array.isArray(j.item))) return { kind: 'collection', data: fromPostman(j) };
  if (Array.isArray(j.values) && (j._postman_variable_scope || j.name)) return { kind: 'environment', data: envFromPostman(j) };
  if (j.openapi || j.swagger) { const { collection, baseUrl } = fromOpenApi(j); return { kind: 'collection', data: collection, baseUrl }; }
  throw new Error('Unrecognised JSON format.');
}

/* ---------------- SOAP / WSDL ---------------- */
export async function fetchViaProxy(url) { // goes through the Postern server so the SSRF guard applies
  const r = await api('/http/send', { method: 'POST', body: { method: 'GET', url, headers: [['Accept', 'text/xml, application/xml, */*']], body: { mode: 'none' } } });
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  if (!r.isText) throw new Error('not a text document');
  return r.bodyText;
}
export function wsdlToCollection(model, wsdlKey, wsdlUrl) {
  const folders = model.endpoints.map(ep => ({
    id: uid(), type: 'folder', name: model.endpoints.length > 1 ? `${ep.service} · ${ep.port} (SOAP ${ep.version})` : `${ep.service} (SOAP ${ep.version})`,
    items: ep.operations.map(op => newSoapRequest({ name: op.name, url: ep.address, soap: { version: ep.version, action: op.action, operation: op.name, wsdl: wsdlUrl || '', wsdlKey, service: ep.service, port: ep.port, ops: ep.operations.length <= 60 ? ep.operations.map(o => o.name) : [], opCount: ep.operations.length }, body: { raw: op.envelope } })),
  }));
  return { id: uid(), name: model.title, items: model.endpoints.length === 1 ? folders[0].items : folders };
}
/* Async front door for the Import dialog: WSDL (XML) or anything detect() understands */
export async function importText(src, { baseUrl = '' } = {}) {
  const t = src.trim();
  if (t.startsWith('<')) {
    const { parseWsdl, cacheModel } = await import('./wsdl.js');
    const model = await parseWsdl(t, { baseUrl, fetchText: fetchViaProxy });
    const key = baseUrl || 'file:' + uid(); cacheModel(key, model);
    return { kind: 'collection', data: wsdlToCollection(model, key, baseUrl), warnings: model.warnings };
  }
  return detect(src);
}

/* ---------------- Exporters ---------------- */
function toPmItem(it) {
  if (it.type === 'folder') return { name: it.name, item: it.items.map(toPmItem) };
  const b = it.body, a = it.auth;
  const body = b.mode === 'raw' ? { mode: 'raw', raw: b.raw, options: { raw: { language: b.rawType === 'js' ? 'javascript' : b.rawType } } }
    : b.mode === 'urlencoded' ? { mode: 'urlencoded', urlencoded: b.urlencoded.map(x => ({ key: x.key, value: x.value, disabled: x.enabled === false })) }
    : b.mode === 'formdata' ? { mode: 'formdata', formdata: b.formdata.map(x => ({ key: x.key, value: x.value, type: 'text', disabled: x.enabled === false })) }
    : b.mode === 'graphql' ? { mode: 'graphql', graphql: b.graphql } : undefined;
  const auth = a.type === 'bearer' ? { type: 'bearer', bearer: [{ key: 'token', value: a.bearer.token, type: 'string' }] }
    : a.type === 'basic' ? { type: 'basic', basic: [{ key: 'username', value: a.basic.username }, { key: 'password', value: a.basic.password }] }
    : a.type === 'oauth1' ? { type: 'oauth1', oauth1: [['consumerKey', a.oauth1.consumerKey], ['consumerSecret', a.oauth1.consumerSecret], ['token', a.oauth1.token], ['tokenSecret', a.oauth1.tokenSecret], ['signatureMethod', a.oauth1.signatureMethod], ['realm', a.oauth1.realm], ['addParamsToHeader', a.oauth1.addTo !== 'query'], ['version', a.oauth1.version]].map(([key, value]) => ({ key, value })) }
    : a.type === 'apikey' ? { type: 'apikey', apikey: [{ key: 'key', value: a.apikey.key }, { key: 'value', value: a.apikey.value }, { key: 'in', value: a.apikey.in }] } : undefined;
  const event = [];
  if (it.preScript) event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: it.preScript.split('\n') } });
  if (it.tests) event.push({ listen: 'test', script: { type: 'text/javascript', exec: it.tests.split('\n') } });
  return {
    name: it.name, event: event.length ? event : undefined,
    request: { method: it.method, header: it.headers.map(h => ({ key: h.key, value: h.value, disabled: h.enabled === false })), body, auth, url: { raw: it.url, query: it.params.map(p => ({ key: p.key, value: p.value, disabled: p.enabled === false })) } },
  };
}
export const toPostman = (c) => ({ info: { name: c.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: c.items.map(toPmItem) });
export const envToPostman = (e) => ({ name: e.name, values: e.values.map(v => ({ key: v.key, value: v.value, enabled: v.enabled !== false, type: v.secret ? 'secret' : 'default' })), _postman_variable_scope: 'environment' });

/* ---------------- Code generation (from a prepared wire request) ---------------- */
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export function codegen(lang, p) {
  let comment = '';
  const bodyStr = p.body.mode === 'raw' ? p.body.raw : p.body.mode === 'urlencoded' ? p.body.pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  if (p.oauth1 && lang) comment = '# OAuth 1.0: the signature is computed by Postern at send time; recompute timestamp/nonce/signature when running this elsewhere.\n';
  if (lang === 'curl') {
    let s = `curl -X ${p.method} ${sq(p.url)}`;
    p.headers.forEach(([k, v]) => { s += ` \\\n  -H ${sq(`${k}: ${v}`)}`; });
    if (p.body.mode === 'formdata') p.body.parts.forEach(x => { s += ` \\\n  -F ${sq(`${x.key}=${x.type === 'file' ? '@' + x.fileName : x.value}`)}`; });
    else if (bodyStr) s += ` \\\n  --data-raw ${sq(bodyStr)}`;
    return comment + s;
  }
  if (lang === 'fetch') {
    const o = { method: p.method, headers: Object.fromEntries(p.headers) };
    if (bodyStr) o.body = bodyStr;
    return `const res = await fetch(${JSON.stringify(p.url)}, ${JSON.stringify(o, null, 2)});\nconst data = await res.text();\nconsole.log(res.status, data);`;
  }
  if (lang === 'python') {
    return `import requests\n\nres = requests.request(\n    ${JSON.stringify(p.method)},\n    ${JSON.stringify(p.url)},\n    headers=${JSON.stringify(Object.fromEntries(p.headers), null, 4).replace(/\n/g, '\n    ')},\n${bodyStr ? `    data=${JSON.stringify(bodyStr)},\n` : ''})\nprint(res.status_code, res.text)`;
  }
  return '';
}
