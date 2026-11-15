/* Request signing helpers: HTTP Digest (RFC 7616/2617), AWS Signature Version 4, JWT (HS256/384/512).
   Pure functions so they can be unit-tested against published vectors. */
import crypto from 'node:crypto';

const hash = (alg, s) => crypto.createHash(alg).update(s).digest('hex');
const hmac = (key, s, enc) => crypto.createHmac('sha256', key).update(s).digest(enc);

/* ---- Digest ---- */
export function parseChallenge(header) {
  const m = /(?:^|,\s*)Digest\s+(.*)$/is.exec(header || ''); if (!m) return null;
  const out = {}; const re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi; let x;
  while ((x = re.exec(m[1]))) out[x[1].toLowerCase()] = x[2] !== undefined ? x[2].replace(/\\(.)/g, '$1') : x[3];
  return out.nonce ? out : null;
}
export function digestHeader({ challenge: c, username, password, method, uri, body = '', nc = 1, cnonce = crypto.randomBytes(8).toString('hex') }) {
  const algName = String(c.algorithm || 'MD5').toUpperCase();
  const sess = algName.endsWith('-SESS'); const base = algName.replace('-SESS', '');
  const alg = { MD5: 'md5', SHA: 'sha1', 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-512-256': 'sha512-256' }[base];
  if (!alg) throw new Error('Unsupported Digest algorithm: ' + c.algorithm);
  const H = (s) => hash(alg, s);
  const qops = String(c.qop || '').split(',').map(s => s.trim()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : qops.includes('auth-int') ? 'auth-int' : '';
  const ncs = String(nc).padStart(8, '0');
  let ha1 = H(`${username}:${c.realm || ''}:${password}`);
  if (sess) ha1 = H(`${ha1}:${c.nonce}:${cnonce}`);
  const ha2 = H(`${method}:${uri}` + (qop === 'auth-int' ? ':' + H(body) : ''));
  const response = qop ? H(`${ha1}:${c.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${c.nonce}:${ha2}`);
  const q = (s) => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';
  const f = [`username=${q(username)}`, `realm=${q(c.realm || '')}`, `nonce=${q(c.nonce)}`, `uri=${q(uri)}`, `algorithm=${algName}`, `response=${q(response)}`];
  if (qop) f.push(`qop=${qop}`, `nc=${ncs}`, `cnonce=${q(cnonce)}`);
  if (c.opaque) f.push(`opaque=${q(c.opaque)}`);
  return 'Digest ' + f.join(', ');
}

/* ---- AWS Signature Version 4 ---- */
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
export function awsSign({ method, url, headers = {}, payload = '', accessKey, secretKey, sessionToken, region, service, date = new Date(), unsignedPayload = false }) {
  const u = new URL(url);
  const amz = date.toISOString().replace(/[:-]|\.\d{3}/g, ''); const day = amz.slice(0, 8);
  const payloadHash = unsignedPayload ? 'UNSIGNED-PAYLOAD' : hash('sha256', payload);
  const h = { host: u.host, 'x-amz-date': amz };
  for (const [k, v] of Object.entries(headers)) { const lk = k.toLowerCase(); if (!['authorization', 'x-amz-date', 'host', 'x-amz-content-sha256', 'x-amz-security-token', 'connection', 'content-length', 'user-agent'].includes(lk)) h[lk] = String(v).trim().replace(/\s+/g, ' '); }
  if (sessionToken) h['x-amz-security-token'] = sessionToken;
  if (service === 's3') h['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(h).sort();
  const canonPath = service === 's3' ? (u.pathname || '/') : (u.pathname || '/').split('/').map(seg => enc(decodeURIComponent(seg))).join('/');
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method.toUpperCase(), canonPath, query, names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amz, scope, hash('sha256', canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secretKey, day), region), service), 'aws4_request');
  const signature = hmac(kSigning, sts, 'hex');
  const out = { 'X-Amz-Date': amz, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
  if (sessionToken) out['X-Amz-Security-Token'] = sessionToken;
  if (service === 's3') out['X-Amz-Content-Sha256'] = payloadHash;
  return out;
}

/* ---- JWT (HMAC) ---- */
const b64u = (b) => Buffer.from(b).toString('base64url');
export function jwtSign({ payload, secret, alg = 'HS256', header = {}, secretIsBase64 = false }) {
  const a = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg]; if (!a) throw new Error('Unsupported JWT algorithm: ' + alg);
  const h = b64u(JSON.stringify({ alg, typ: 'JWT', ...header })); const p = b64u(JSON.stringify(payload));
  const key = secretIsBase64 ? Buffer.from(secret, 'base64') : secret;
  return `${h}.${p}.${crypto.createHmac(a, key).update(`${h}.${p}`).digest('base64url')}`;
}
