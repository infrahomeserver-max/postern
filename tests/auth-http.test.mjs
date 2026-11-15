// Signed-request flows through the real server: Digest challenge/retry, AWS SigV4, JWT.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { parseChallenge, digestHeader } from '../server/authsig.js';

let proc, dir, api, cookie, echo, echoPort; const seen = [];
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'postern-test-')); const port = await freePort(); api = `http://127.0.0.1:${port}/api`;
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DEVHUB_DATA: dir, NODE_ENV: 'production' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${api}/ping`)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
  const r = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'devhub' }, body: JSON.stringify({ username: 'tester', password: 'correct-horse-9' }) });
  cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  echoPort = await freePort();
  echo = http.createServer((req, res) => { // /digest demands Digest auth (user "alice" / "wonder"); everything else echoes headers
    seen.push({ url: req.url, headers: req.headers });
    if (req.url.startsWith('/digest')) {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Digest ')) { res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="t", qop="auth", nonce="abc123", opaque="op"' }); return res.end('no'); }
      const get = (k) => new RegExp(`${k}="?([^",]+)"?`).exec(auth)?.[1];
      const want = digestHeader({ challenge: { realm: 't', qop: 'auth', nonce: 'abc123', opaque: 'op' }, username: 'alice', password: 'wonder', method: req.method, uri: get('uri'), cnonce: get('cnonce') });
      res.writeHead(auth.includes(want.match(/response="[0-9a-f]+"/)[0]) ? 200 : 403); return res.end('digest ok');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ headers: req.headers, url: req.url }));
  }).listen(echoPort, '127.0.0.1');
});
after(() => { proc?.kill(); echo?.close(); rmSync(dir, { recursive: true, force: true }); });
const send = (body) => fetch(`${api}/http/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'devhub', Cookie: cookie }, body: JSON.stringify({ method: 'GET', headers: [], body: { mode: 'none' }, ...body }) }).then(async r => ({ status: r.status, j: await r.json() }));
const url = (p) => `http://127.0.0.1:${echoPort}${p}`;

test('Digest: server retries after the 401 challenge and succeeds', async () => {
  const r = await send({ url: url('/digest?x=1'), sig: { type: 'digest', username: 'alice', password: 'wonder' } });
  assert.equal(r.j.status, 200); assert.equal(r.j.bodyText, 'digest ok'); assert.equal(seen.filter(s => s.url.startsWith('/digest')).length, 2);
});
test('Digest: wrong password is rejected, and a server without a challenge is left alone', async () => {
  assert.equal((await send({ url: url('/digest'), sig: { type: 'digest', username: 'alice', password: 'nope' } })).j.status, 403);
  assert.equal((await send({ url: url('/plain'), sig: { type: 'digest', username: 'a', password: 'b' } })).j.status, 200);
});
test('AWS SigV4: Authorization and X-Amz-Date reach the target', async () => {
  const r = await send({ url: url('/aws?b=2&a=1'), sig: { type: 'aws', accessKey: 'AKIDEXAMPLE', secretKey: 'secret', region: 'eu-west-1', service: 'execute-api' } });
  const h = JSON.parse(r.j.bodyText).headers;
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/execute-api\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/); assert.match(h['x-amz-date'], /^\d{8}T\d{6}Z$/);
});
test('JWT: header token verifies with the secret; claims added; query mode works', async () => {
  const r = await send({ url: url('/jwt'), sig: { type: 'jwt', alg: 'HS256', secret: 's3cret', payload: '{"sub":"u1"}', autoIat: true, expSeconds: 60, addTo: 'header', headerName: 'Authorization', prefix: 'Bearer' } });
  const tok = JSON.parse(r.j.bodyText).headers.authorization.replace('Bearer ', ''); const [h, p, s] = tok.split('.');
  assert.equal(s, crypto.createHmac('sha256', 's3cret').update(`${h}.${p}`).digest('base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url')); assert.equal(claims.sub, 'u1'); assert.equal(claims.exp - claims.iat, 60);
  const q = await send({ url: url('/jwt'), sig: { type: 'jwt', secret: 'x', payload: '{}', addTo: 'query', queryName: 'jwt' } });
  assert.match(JSON.parse(q.j.bodyText).url, /^\/jwt\?jwt=[\w-]+\.[\w-]+\.[\w-]+$/);
});
test('JWT: invalid payload JSON gives a clear 400', async () => {
  const r = await fetch(`${api}/http/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'devhub', Cookie: cookie }, body: JSON.stringify({ method: 'GET', url: url('/x'), sig: { type: 'jwt', secret: 's', payload: '{oops' } }) });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /not valid JSON/);
});
