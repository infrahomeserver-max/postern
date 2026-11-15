// OAuth 1.0a request signing (RFC 5849). Runs server-side so secrets and signatures never depend on browser crypto.
import crypto from 'node:crypto';

export const pct = (s) => encodeURIComponent(String(s ?? '')).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function baseStringUri(u) {
  const url = new URL(u);
  const def = (url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443');
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.port && !def ? ':' + url.port : ''}${url.pathname}`;
}

export function sign({ method, url, bodyParams = [], o }) {
  const sm = ['HMAC-SHA1', 'HMAC-SHA256', 'PLAINTEXT'].includes(o.signatureMethod) ? o.signatureMethod : 'HMAC-SHA1';
  const oauth = [
    ['oauth_consumer_key', o.consumerKey || ''],
    ['oauth_nonce', o.nonce || crypto.randomBytes(16).toString('hex')],
    ['oauth_signature_method', sm],
    ['oauth_timestamp', o.timestamp || String(Math.floor(Date.now() / 1000))],
    ['oauth_version', o.version || '1.0'],
  ];
  if (o.token) oauth.push(['oauth_token', o.token]);
  if (o.callback) oauth.push(['oauth_callback', o.callback]);
  if (o.verifier) oauth.push(['oauth_verifier', o.verifier]);
  const u = new URL(url);
  const all = [...u.searchParams.entries(), ...bodyParams, ...oauth].map(([k, v]) => [pct(k), pct(v)]);
  all.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  const normalized = all.map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), pct(baseStringUri(url)), pct(normalized)].join('&');
  const key = `${pct(o.consumerSecret)}&${pct(o.tokenSecret)}`;
  const signature = sm === 'PLAINTEXT' ? key : crypto.createHmac(sm === 'HMAC-SHA256' ? 'sha256' : 'sha1', key).update(base).digest('base64');
  return { params: [...oauth, ['oauth_signature', signature]], base, signature };
}

export const authorizationHeader = (params, realm) =>
  'OAuth ' + [realm ? ['realm', realm] : null, ...params].filter(Boolean).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
