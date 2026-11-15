import { useState } from 'react';
import { Icon, Tabs, KVEditor, MethodSelect, useToast } from '../../ui.jsx';
import { METHODS, urlFromParams, paramsFromUrl, resolve, fetchOAuthToken, SOAP_NS } from './engine.js';
import { uid } from '../../api.js';
import { pickFile, readBase64 } from '../../api.js';

const tabKey = (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const t = e.target, s = t.selectionStart;
  t.setRangeText('  ', s, t.selectionEnd, 'end');
  t.dispatchEvent(new Event('input', { bubbles: true }));
};
const Area = ({ value, onChange, placeholder, style }) => (
  <textarea className="grow" spellCheck={false} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={tabKey}
    style={{ width: '100%', height: '100%', borderRadius: 0, border: 0, padding: 12, ...style }} />
);
const Field = ({ label, children }) => <><label>{label}</label><div>{children}</div></>;

const AUTH_DESC = {
  none: 'The request is sent without any credentials.',
  basic: 'Sends your username and password in an Authorization header, base64-encoded. Only safe over HTTPS.',
  bearer: 'Sends a token you already have in an Authorization: Bearer header. Used by most modern APIs.',
  apikey: 'Sends a static key as a header or a query parameter, as the API documents (for example X-API-Key).',
  jwt: 'Builds a signed JSON Web Token (HMAC) from your secret and payload on every send, then adds it as a header or query parameter.',
  digest: 'Challenge-response login: Postern first sends the request, reads the server’s 401 challenge, then retries with a hashed answer. The password is never sent.',
  aws: 'Signs the request with AWS Signature Version 4 using your keys, region and service (API Gateway, S3, SQS and others). The signature changes on every send.',
  oauth1: 'Signs each request with consumer and token secrets (OAuth 1.0a). Timestamp and nonce are generated fresh on every send.',
  oauth2: 'Requests an access token from the token URL (client credentials, password or refresh-token grant), then sends it as a Bearer token. Browser-based grants (authorization code, implicit) are not supported yet.',
};
const AUTH_NOTE = {
  basic: 'Values can use {{variables}}.', bearer: 'Values can use {{variables}}.', apikey: 'Values can use {{variables}}.', jwt: 'Secret and payload can use {{variables}}. Code generation (cURL etc.) cannot include a signed token because it is created at send time.',
  digest: 'Code generation cannot include the digest answer because it depends on the server’s challenge.', aws: 'Code generation cannot include the signature because it depends on the send time.', oauth2: 'Click “Get new access token”, then send. The token is saved in this request.',
};

function AuthPane({ req, set, vars }) {
  const a = req.auth; const toast = useToast();
  const up = (patch) => set({ auth: { ...a, ...patch } });
  const [busy, setBusy] = useState(false);
  const getToken = async () => {
    setBusy(true);
    try { const t = await fetchOAuthToken(a.oauth2, vars); up({ oauth2: { ...a.oauth2, accessToken: t.accessToken, ...(t.refreshToken ? { refreshToken: t.refreshToken } : {}) } }); toast('Access token received', 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div style={{ padding: 16, overflow: 'auto' }}>
      <div className="form" style={{ maxWidth: 640 }}>
        <Field label="Type">
          <select value={a.type} onChange={(e) => up({ type: e.target.value })}>
            <option value="none">No auth</option>
            <optgroup label="Simple"><option value="basic">Basic auth</option><option value="bearer">Bearer token</option><option value="apikey">API key</option><option value="jwt">JWT bearer (HMAC)</option></optgroup>
            <optgroup label="Challenge / signature"><option value="digest">Digest auth</option><option value="aws">AWS Signature v4</option><option value="oauth1">OAuth 1.0</option></optgroup>
            <optgroup label="OAuth 2.0"><option value="oauth2">OAuth 2.0 (token request)</option></optgroup>
          </select>
        </Field>
        {AUTH_DESC[a.type] && <><span /><p className="auth-desc">{AUTH_DESC[a.type]}</p></>}
        {a.type === 'basic' && <>
          <Field label="Username"><input style={{ width: '100%' }} value={a.basic.username} onChange={(e) => up({ basic: { ...a.basic, username: e.target.value } })} /></Field>
          <Field label="Password"><input type="password" style={{ width: '100%' }} value={a.basic.password} onChange={(e) => up({ basic: { ...a.basic, password: e.target.value } })} /></Field></>}
        {a.type === 'bearer' && <Field label="Token"><input style={{ width: '100%' }} className="mono" value={a.bearer.token} onChange={(e) => up({ bearer: { token: e.target.value } })} placeholder="{{token}}" /></Field>}
        {a.type === 'apikey' && <>
          <Field label="Key"><input style={{ width: '100%' }} value={a.apikey.key} onChange={(e) => up({ apikey: { ...a.apikey, key: e.target.value } })} placeholder="X-API-Key" /></Field>
          <Field label="Value"><input style={{ width: '100%' }} value={a.apikey.value} onChange={(e) => up({ apikey: { ...a.apikey, value: e.target.value } })} /></Field>
          <Field label="Add to"><select value={a.apikey.in} onChange={(e) => up({ apikey: { ...a.apikey, in: e.target.value } })}><option value="header">Header</option><option value="query">Query params</option></select></Field></>}
        {a.type === 'oauth1' && (() => { const o = a.oauth1 || {}; const u1 = (k, v) => up({ oauth1: { ...o, [k]: v } }); return <>
          <Field label="Signature method"><select value={o.signatureMethod} onChange={(e) => u1('signatureMethod', e.target.value)}><option>HMAC-SHA1</option><option>HMAC-SHA256</option><option>PLAINTEXT</option></select></Field>
          <Field label="Consumer key"><input style={{ width: '100%' }} className="mono" value={o.consumerKey} onChange={(e) => u1('consumerKey', e.target.value)} /></Field>
          <Field label="Consumer secret"><input style={{ width: '100%' }} type="password" value={o.consumerSecret} onChange={(e) => u1('consumerSecret', e.target.value)} /></Field>
          <Field label="Access token"><input style={{ width: '100%' }} className="mono" value={o.token} onChange={(e) => u1('token', e.target.value)} /></Field>
          <Field label="Token secret"><input style={{ width: '100%' }} type="password" value={o.tokenSecret} onChange={(e) => u1('tokenSecret', e.target.value)} /></Field>
          <Field label="Add to"><select value={o.addTo} onChange={(e) => u1('addTo', e.target.value)}><option value="header">Authorization header</option><option value="query">Request URL / query</option></select></Field>
          <Field label="Realm"><input style={{ width: '100%' }} value={o.realm} onChange={(e) => u1('realm', e.target.value)} placeholder="optional" /></Field>
          <Field label="Callback / verifier"><div className="row"><input className="grow" value={o.callback} onChange={(e) => u1('callback', e.target.value)} placeholder="oauth_callback" /><input className="grow" value={o.verifier} onChange={(e) => u1('verifier', e.target.value)} placeholder="oauth_verifier" /></div></Field>
          <Field label="Timestamp / nonce"><div className="row"><input className="grow" value={o.timestamp} onChange={(e) => u1('timestamp', e.target.value)} placeholder="auto" /><input className="grow" value={o.nonce} onChange={(e) => u1('nonce', e.target.value)} placeholder="auto" /></div></Field></>; })()}
        {a.type === 'digest' && (() => { const d = a.digest || {}; const u1 = (k, v) => up({ digest: { ...d, [k]: v } }); return <>
          <Field label="Username"><input style={{ width: '100%' }} value={d.username || ''} onChange={(e) => u1('username', e.target.value)} /></Field>
          <Field label="Password"><input type="password" style={{ width: '100%' }} value={d.password || ''} onChange={(e) => u1('password', e.target.value)} /></Field></>; })()}
        {a.type === 'aws' && (() => { const w = { region: 'us-east-1', service: 'execute-api', ...(a.aws || {}) }; const u1 = (k, v) => up({ aws: { ...w, [k]: v } }); return <>
          <Field label="Access key"><input style={{ width: '100%' }} className="mono" value={w.accessKey || ''} onChange={(e) => u1('accessKey', e.target.value)} placeholder="AKIA…" /></Field>
          <Field label="Secret key"><input type="password" style={{ width: '100%' }} value={w.secretKey || ''} onChange={(e) => u1('secretKey', e.target.value)} /></Field>
          <Field label="Session token"><input style={{ width: '100%' }} className="mono" value={w.sessionToken || ''} onChange={(e) => u1('sessionToken', e.target.value)} placeholder="optional (temporary credentials)" /></Field>
          <Field label="Region"><input style={{ width: '100%' }} value={w.region} onChange={(e) => u1('region', e.target.value)} placeholder="us-east-1" /></Field>
          <Field label="Service"><input style={{ width: '100%' }} value={w.service} onChange={(e) => u1('service', e.target.value)} placeholder="execute-api, s3, sqs…" /></Field></>; })()}
        {a.type === 'jwt' && (() => { const j = { alg: 'HS256', addTo: 'header', headerName: 'Authorization', prefix: 'Bearer', queryName: 'token', autoIat: true, expSeconds: 0, payload: '{\n  "sub": "user"\n}', ...(a.jwt || {}) }; const u1 = (k, v) => up({ jwt: { ...j, [k]: v } }); return <>
          <Field label="Algorithm"><select value={j.alg} onChange={(e) => u1('alg', e.target.value)}><option>HS256</option><option>HS384</option><option>HS512</option></select></Field>
          <Field label="Secret"><input type="password" style={{ width: '100%' }} value={j.secret || ''} onChange={(e) => u1('secret', e.target.value)} placeholder="{{jwtSecret}}" /></Field>
          <Field label="Payload (JSON)"><textarea className="mono" rows={5} style={{ width: '100%', padding: 8 }} value={j.payload} onChange={(e) => u1('payload', e.target.value)} spellCheck={false} /></Field>
          <Field label="Claims"><div className="row" style={{ gap: 14, flexWrap: 'wrap' }}><label className="row" style={{ gap: 5 }}><input type="checkbox" checked={j.autoIat !== false} onChange={(e) => u1('autoIat', e.target.checked)} />add <code>iat</code></label>
            <label className="row" style={{ gap: 5 }}>expires in<input type="number" min="0" style={{ width: 80 }} value={j.expSeconds || 0} onChange={(e) => u1('expSeconds', Number(e.target.value))} />seconds (0 = no <code>exp</code>)</label></div></Field>
          <Field label="Add to"><select value={j.addTo} onChange={(e) => u1('addTo', e.target.value)}><option value="header">Header</option><option value="query">Query parameter</option></select></Field>
          {j.addTo === 'query' ? <Field label="Parameter"><input style={{ width: '100%' }} value={j.queryName} onChange={(e) => u1('queryName', e.target.value)} /></Field>
            : <Field label="Header / prefix"><div className="row"><input className="grow" value={j.headerName} onChange={(e) => u1('headerName', e.target.value)} /><input style={{ width: 110 }} value={j.prefix} onChange={(e) => u1('prefix', e.target.value)} placeholder="Bearer" /></div></Field>}</>; })()}
        {a.type === 'oauth2' && (() => { const o = { grant: 'client_credentials', clientAuth: 'body', ...a.oauth2 }; const u2 = (k, v) => up({ oauth2: { ...o, [k]: v } }); return <>
          <Field label="Grant type"><select value={o.grant} onChange={(e) => u2('grant', e.target.value)}><option value="client_credentials">Client credentials</option><option value="password">Password</option><option value="refresh_token">Refresh token</option></select></Field>
          <Field label="Token URL"><input style={{ width: '100%' }} value={o.tokenUrl || ''} onChange={(e) => u2('tokenUrl', e.target.value)} /></Field>
          <Field label="Client ID"><input style={{ width: '100%' }} value={o.clientId || ''} onChange={(e) => u2('clientId', e.target.value)} /></Field>
          <Field label="Client secret"><input style={{ width: '100%' }} type="password" value={o.clientSecret || ''} onChange={(e) => u2('clientSecret', e.target.value)} /></Field>
          {o.grant === 'password' && <><Field label="Username"><input style={{ width: '100%' }} value={o.username || ''} onChange={(e) => u2('username', e.target.value)} /></Field>
            <Field label="Password"><input style={{ width: '100%' }} type="password" value={o.password || ''} onChange={(e) => u2('password', e.target.value)} /></Field></>}
          {o.grant === 'refresh_token' && <Field label="Refresh token"><input style={{ width: '100%' }} className="mono" value={o.refreshToken || ''} onChange={(e) => u2('refreshToken', e.target.value)} /></Field>}
          <Field label="Scope"><input style={{ width: '100%' }} value={o.scope || ''} onChange={(e) => u2('scope', e.target.value)} /></Field>
          <Field label="Audience"><input style={{ width: '100%' }} value={o.audience || ''} onChange={(e) => u2('audience', e.target.value)} placeholder="optional" /></Field>
          <Field label="Send client credentials"><select value={o.clientAuth} onChange={(e) => u2('clientAuth', e.target.value)}><option value="body">In the request body</option><option value="basic">As a Basic auth header</option></select></Field>
          <Field label="Access token"><input style={{ width: '100%' }} className="mono" value={o.accessToken || ''} onChange={(e) => u2('accessToken', e.target.value)} /></Field>
          <span /><div><button className="btn primary" onClick={getToken} disabled={busy || !o.tokenUrl}>Get new access token</button></div></>; })()}
      </div>
      {AUTH_NOTE[a.type] && <p className="muted" style={{ marginTop: 18, maxWidth: 640 }}>{AUTH_NOTE[a.type]}</p>}
    </div>
  );
}

function BodyPane({ req, set }) {
  const b = req.body; const up = (patch) => set({ body: { ...b, ...patch } });
  const modes = [['none', 'none'], ['raw', 'raw'], ['urlencoded', 'x-www-form-urlencoded'], ['formdata', 'form-data'], ['graphql', 'GraphQL'], ['binary', 'binary']];
  const beautify = () => { try { up({ raw: JSON.stringify(JSON.parse(b.raw), null, 2) }); } catch { /* not JSON */ } };
  const pickBin = async () => { const f = await pickFile(); if (f) up({ binary: { name: f.name, base64: await readBase64(f) } }); };
  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div className="row" style={{ padding: '8px 12px', flexWrap: 'wrap', gap: 14 }}>
        {modes.map(([k, l]) => <label key={k} className="row" style={{ gap: 5, cursor: 'pointer' }}><input type="radio" checked={b.mode === k} onChange={() => up({ mode: k })} />{l}</label>)}
        <span className="grow" />
        {b.mode === 'raw' && <>
          <select value={b.rawType} onChange={(e) => up({ rawType: e.target.value })}>{['json', 'text', 'xml', 'html', 'js'].map(t => <option key={t}>{t}</option>)}</select>
          {b.rawType === 'json' && <button className="btn sm" onClick={beautify}>Beautify</button>}</>}
      </div>
      <div className="col" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {b.mode === 'none' && <div className="empty">This request has no body</div>}
        {b.mode === 'raw' && <Area value={b.raw} onChange={(v) => up({ raw: v })} placeholder={b.rawType === 'json' ? '{\n  "hello": "{{name}}"\n}' : ''} />}
        {b.mode === 'urlencoded' && <KVEditor rows={b.urlencoded} onChange={(r) => up({ urlencoded: r })} />}
        {b.mode === 'formdata' && <>
          <KVEditor rows={b.formdata} onChange={(r) => up({ formdata: r })} />
          <div className="row" style={{ padding: 8 }}><button className="btn sm" onClick={async () => { const f = await pickFile(); if (f) up({ formdata: [...b.formdata, { key: 'file', type: 'file', fileName: f.name, value: f.name, base64: await readBase64(f), enabled: true }] }); }}><Icon n="upload" s={13} />Add file field</button>
            <span className="muted">File fields are kept for this session only.</span></div></>}
        {b.mode === 'graphql' && <div className="col" style={{ flex: 1, minHeight: 0 }}>
          <div className="muted" style={{ padding: '4px 12px' }}>Query</div>
          <div style={{ flex: 2, minHeight: 0 }}><Area value={b.graphql.query} onChange={(v) => up({ graphql: { ...b.graphql, query: v } })} placeholder="query { viewer { login } }" /></div>
          <div className="muted" style={{ padding: '4px 12px', borderTop: '1px solid var(--line)' }}>Variables (JSON)</div>
          <div style={{ flex: 1, minHeight: 0 }}><Area value={b.graphql.variables} onChange={(v) => up({ graphql: { ...b.graphql, variables: v } })} placeholder="{}" /></div></div>}
        {b.mode === 'binary' && <div style={{ padding: 16 }}><button className="btn" onClick={pickBin}><Icon n="upload" s={14} />Select file</button> <span className="muted" style={{ marginLeft: 8 }}>{b.binary?.name || 'No file selected'}</span></div>}
      </div>
    </div>
  );
}


const A_TYPES = [['nofault', 'No SOAP Fault'], ['xpath', 'XPath'], ['extract', 'Extract to variable'], ['status', 'HTTP status'], ['time', 'Response time (ms) ≤'], ['fault', 'Is a SOAP Fault'], ['wellformed', 'Well-formed XML']];
const OPS = [['equals', 'equals'], ['notequals', 'does not equal'], ['contains', 'contains'], ['regex', 'matches regex'], ['exists', 'exists'], ['notexists', 'does not exist'], ['count', 'count equals']];

function AssertionsPane({ req, set }) {
  const list = req.soap.assertions || []; const upd = (a) => set({ soap: { ...req.soap, assertions: a } });
  const patch = (id, p) => upd(list.map(x => x.id === id ? { ...x, ...p } : x));
  const add = (type) => upd([...list, { id: uid(), type, enabled: true, ...(type === 'xpath' ? { xpath: '', op: 'equals', value: '' } : type === 'extract' ? { xpath: '', value: '' } : type === 'status' ? { value: '200' } : type === 'time' ? { value: '2000' } : {}) }]);
  return (
    <div className="col" style={{ flex: 1, overflow: 'auto', padding: 12, gap: 8 }}>
      <div className="muted" style={{ fontSize: 12 }}>Checked after every send; results appear in the response’s Tests tab (and in collection runs). XPath 1.0 — prefixes declared in the response work as-is, a default namespace is available as <code>d</code> (e.g. <code>//d:AddResult</code>), or use <code>//*[local-name()='AddResult']</code> to ignore namespaces. Values may use <code>{'{{variables}}'}</code>.</div>
      {list.map(a => (
        <div key={a.id} className="row" style={{ gap: 6, alignItems: 'center', opacity: a.enabled === false ? .5 : 1 }}>
          <input type="checkbox" checked={a.enabled !== false} onChange={(e) => patch(a.id, { enabled: e.target.checked })} aria-label="Assertion enabled" />
          <select value={a.type} onChange={(e) => patch(a.id, { type: e.target.value })} aria-label="Assertion type" style={{ width: 170 }}>{A_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {(a.type === 'xpath' || a.type === 'extract') && <input className="grow mono" value={a.xpath || ''} onChange={(e) => patch(a.id, { xpath: e.target.value })} placeholder="//ns1:AddResult" aria-label="XPath" spellCheck={false} />}
          {a.type === 'xpath' && <select value={a.op || 'equals'} onChange={(e) => patch(a.id, { op: e.target.value })} aria-label="Operator" style={{ width: 130 }}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
          {a.type === 'xpath' && !['exists', 'notexists'].includes(a.op) && <input className="mono" style={{ width: 150 }} value={a.value ?? ''} onChange={(e) => patch(a.id, { value: e.target.value })} placeholder="expected" aria-label="Expected value" />}
          {a.type === 'extract' && <><span className="muted">→</span><input className="mono" style={{ width: 150 }} value={a.value ?? ''} onChange={(e) => patch(a.id, { value: e.target.value })} placeholder="variable name" aria-label="Variable name" /></>}
          {['status', 'time', 'fault'].includes(a.type) && <input className="mono" style={{ width: 150 }} value={a.value ?? ''} onChange={(e) => patch(a.id, { value: e.target.value })} placeholder={a.type === 'fault' ? 'text (optional)' : 'value'} aria-label="Assertion value" />}
          <span className="grow" />
          <button className="icon-btn" onClick={() => upd(list.filter(x => x.id !== a.id))} aria-label="Remove assertion"><Icon n="trash" s={13} /></button>
        </div>))}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => add('xpath')}><Icon n="plus" s={12} />XPath assertion</button>
        <button className="btn sm" onClick={() => add('extract')}><Icon n="plus" s={12} />Extract to variable</button>
        <button className="btn sm" onClick={() => add('status')}>HTTP status</button>
        <button className="btn sm" onClick={() => add('nofault')}>No SOAP Fault</button>
        <button className="btn sm" onClick={() => add('time')}>Response time</button>
      </div>
    </div>
  );
}

function EnvelopePane({ req, set }) {
  const toast = useToast();
  const fmt = async () => { try { const { prettyXml } = await import('./xml.js'); set({ body: { ...req.body, raw: prettyXml(req.body.raw) } }); } catch { toast('Couldn’t format XML', 'error'); } };
  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div className="row" style={{ padding: '6px 12px', gap: 8 }}><span className="muted" style={{ fontSize: 12 }}>SOAP envelope (XML) — <code>{'{{variables}}'}</code> are replaced when sent</span><span className="grow" /><button className="btn sm" onClick={fmt}>Format XML</button></div>
      <div className="col" style={{ flex: 1, minHeight: 0 }}><Area value={req.body.raw} onChange={(v) => set({ body: { ...req.body, raw: v } })} placeholder="<soapenv:Envelope …>" /></div>
    </div>
  );
}

function SoapBar({ req, set, onSwitchOp, onLoadOps }) {
  const so = req.soap; const up = (p) => set({ soap: { ...so, ...p } });
  const setVersion = (v) => { const raw = req.body.raw.split(SOAP_NS[so.version]).join(SOAP_NS[v]); set({ soap: { ...so, version: v }, body: { ...req.body, raw } }); };
  return (
    <div className="row" style={{ padding: '0 14px 8px', gap: 8, flexWrap: 'wrap' }}>
      <label className="row" style={{ gap: 5 }}><span className="muted">SOAP</span>
        <select value={so.version} onChange={(e) => setVersion(e.target.value)} aria-label="SOAP version"><option value="1.1">1.1</option><option value="1.2">1.2</option></select></label>
      <label className="row grow" style={{ gap: 5, minWidth: 220 }}><span className="muted">Operation</span>
        {so.ops?.length || (so.wsdl && so.opCount) ? <select className="grow" value={so.operation} onChange={(e) => onSwitchOp(e.target.value)} onFocus={() => !so.ops?.length && onLoadOps()} aria-label="Operation">
          {(so.ops?.includes(so.operation) ? so.ops : [so.operation, ...(so.ops || [])]).map(n => <option key={n} value={n}>{n || '—'}</option>)}</select>
          : <input className="grow" value={so.operation} onChange={(e) => up({ operation: e.target.value })} placeholder="optional label" aria-label="Operation" />}</label>
      <label className="row grow" style={{ gap: 5, minWidth: 220 }}><span className="muted">SOAPAction</span>
        <input className="grow mono" value={so.action} onChange={(e) => up({ action: e.target.value })} placeholder="http://example.com/Action" aria-label="SOAPAction" spellCheck={false} /></label>
    </div>
  );
}

export default function Editor({ tab, set, onSend, onSave, onCode, running, vars, onCancel, onSwitchOp, onLoadOps }) {
  const req = tab.req; const soap = !!req.soap; const [sub, setSub] = useState(soap ? 'body' : 'params');
  const onUrl = (url) => set({ url, params: paramsFromUrl(url, req.params) });
  const onParams = (params) => set({ params, url: urlFromParams(req.url, params) });
  const nEn = (a) => a.filter(x => x.enabled !== false && x.key).length;
  const unresolved = [...new Set([req.url, ...req.headers.map(h => h.value), req.body.raw].join(' ').match(/\{\{\s*[^{}$]+?\s*\}\}/g) || [])]
    .map(s => s.replace(/[{}\s]/g, '')).filter(k => !(k in vars));
  const s = req.settings;
  return (
    <div className="col" style={{ minHeight: 0, flex: 1 }}>
      <div className="urlbar">
        {soap ? <span className="soap-badge" title="SOAP requests are always sent with HTTP POST">SOAP · POST</span>
          : <MethodSelect value={req.method} methods={METHODS} onChange={(m) => set({ method: m })} />}
        <input value={req.url} placeholder={soap ? 'SOAP endpoint — e.g. https://host/service' : "Enter URL or paste cURL — e.g. https://api.example.com/users/{{id}}"} spellCheck={false} aria-label="Request URL"
          onChange={(e) => onUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSend()} />
        {running ? <button className="btn danger" onClick={onCancel}>Cancel</button> : <button className="btn primary" onClick={onSend} style={{ paddingInline: 22 }}><Icon n="send" s={14} />Send</button>}
        <button className="btn" onClick={onSave} title="Save (Ctrl+S)"><Icon n="save" s={14} />Save</button>
        <button className="btn" onClick={onCode} title="Generate code"><Icon n="code" s={14} /></button>
      </div>
      {unresolved.length > 0 && <div style={{ padding: '0 14px 6px', fontSize: 12 }} className="muted"><span style={{ color: 'var(--warn)' }}>⚠ Unresolved variables:</span> {unresolved.map(u => <code key={u} style={{ marginRight: 6 }}>{`{{${u}}}`}</code>)} — select an environment or define them.</div>}
      {soap && <SoapBar req={req} set={set} onSwitchOp={onSwitchOp} onLoadOps={onLoadOps} />}
      <Tabs value={sub} onChange={setSub} tabs={soap ? [
        { id: 'body', label: 'Envelope' }, { id: 'headers', label: 'Headers', badge: nEn(req.headers) || null }, { id: 'auth', label: 'Auth', dot: req.auth.type !== 'none' },
        { id: 'assert', label: 'Assertions', badge: (req.soap.assertions || []).filter(a => a.enabled !== false).length || null },
        { id: 'pre', label: 'Pre-request', dot: !!req.preScript }, { id: 'tests', label: 'Tests', dot: !!req.tests }, { id: 'settings', label: 'Settings' }] : [
        { id: 'params', label: 'Params', badge: nEn(req.params) || null }, { id: 'auth', label: 'Auth', dot: req.auth.type !== 'none' },
        { id: 'headers', label: 'Headers', badge: nEn(req.headers) || null }, { id: 'body', label: 'Body', dot: req.body.mode !== 'none' },
        { id: 'pre', label: 'Pre-request', dot: !!req.preScript }, { id: 'tests', label: 'Tests', dot: !!req.tests }, { id: 'settings', label: 'Settings' }]} />
      <div className="col" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {sub === 'params' && <KVEditor rows={req.params} onChange={onParams} keyPh="Query param" />}
        {sub === 'headers' && <KVEditor rows={req.headers} onChange={(headers) => set({ headers })} keyPh="Header" />}
        {sub === 'auth' && <AuthPane req={req} set={set} vars={vars} />}
        {sub === 'body' && (soap ? <EnvelopePane req={req} set={set} /> : <BodyPane req={req} set={set} />)}
        {sub === 'assert' && soap && <AssertionsPane req={req} set={set} />}
        {sub === 'pre' && <div className="col" style={{ flex: 1 }}><div className="muted" style={{ padding: '8px 12px' }}>Runs before the request in an isolated sandbox. Use <code>pm.environment.set(k, v)</code>, <code>pm.variables.set</code>, <code>pm.request.headers.add({'{key, value}'})</code>.</div><div style={{ flex: 1, minHeight: 0 }}><Area value={req.preScript} onChange={(v) => set({ preScript: v })} placeholder={"pm.environment.set('ts', Date.now());"} /></div></div>}
        {sub === 'tests' && <div className="col" style={{ flex: 1 }}><div className="muted" style={{ padding: '8px 12px' }}>Postman-style tests: <code>pm.test</code>, <code>pm.expect</code>, <code>pm.response.json()</code>, <code>pm.response.to.have.status(200)</code>.</div><div style={{ flex: 1, minHeight: 0 }}><Area value={req.tests} onChange={(v) => set({ tests: v })} placeholder={"pm.test('status is 200', () => pm.response.to.have.status(200));"} /></div></div>}
        {sub === 'settings' && <div style={{ padding: 16 }}><div className="form" style={{ maxWidth: 520 }}>
          <div className="muted" style={{ gridColumn: '1 / -1', marginBottom: 4 }}>Leave on “Default” to use Settings → Network.</div>
          <Field label="Follow redirects"><select value={s.followRedirects === undefined ? '' : String(s.followRedirects)} onChange={(e) => set({ settings: { ...s, followRedirects: e.target.value === '' ? undefined : e.target.value === 'true' } })}><option value="">Default</option><option value="true">Yes</option><option value="false">No</option></select></Field>
          <Field label="Verify SSL"><select value={s.verifySsl === undefined ? '' : String(s.verifySsl)} onChange={(e) => set({ settings: { ...s, verifySsl: e.target.value === '' ? undefined : e.target.value === 'true' } })}><option value="">Default</option><option value="true">Yes</option><option value="false">No</option></select></Field>
          <Field label="Timeout (ms)"><input type="number" value={s.timeoutMs ?? ''} placeholder="Default" min="100" max="300000" onChange={(e) => set({ settings: { ...s, timeoutMs: e.target.value === '' ? undefined : Number(e.target.value) } })} /></Field></div></div>}
      </div>
    </div>
  );
}
