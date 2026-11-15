import test from 'node:test'; import assert from 'node:assert/strict';
import { digestHeader, parseChallenge, awsSign, jwtSign } from '../server/authsig.js';

test('Digest: RFC 2617 example response', () => {
  const c = parseChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  const h = digestHeader({ challenge: c, username: 'Mufasa', password: 'Circle Of Life', method: 'GET', uri: '/dir/index.html', cnonce: '0a4f113b' });
  assert.match(h, /response="6629fae49393a05397450978507c4ef1"/); assert.match(h, /qop=auth/); assert.match(h, /nc=00000001/); assert.match(h, /opaque="5ccc069c403ebaf9f0171e9517f40e41"/);
});
test('Digest: no qop (RFC 2069 style) and rejects unknown algorithm', () => {
  const c = parseChallenge('Digest realm="r", nonce="n"'); const h = digestHeader({ challenge: c, username: 'u', password: 'p', method: 'GET', uri: '/' });
  assert.ok(!/qop=/.test(h)); assert.throws(() => digestHeader({ challenge: { ...c, algorithm: 'FOO' }, username: 'u', password: 'p', method: 'GET', uri: '/' }));
  assert.equal(parseChallenge('Basic realm="x"'), null);
});
test('AWS SigV4: official get-vanilla test vector', () => {
  const o = awsSign({ method: 'GET', url: 'https://example.amazonaws.com/', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', date: new Date('2015-08-30T12:36:00Z') });
  assert.equal(o['X-Amz-Date'], '20150830T123600Z');
  assert.equal(o.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});
test('AWS SigV4: s3 adds the payload hash header; session token is signed', () => {
  const o = awsSign({ method: 'PUT', url: 'https://b.s3.amazonaws.com/k', payload: 'hi', accessKey: 'A', secretKey: 'S', sessionToken: 'T', region: 'eu-west-1', service: 's3', date: new Date('2020-01-02T03:04:05Z') });
  assert.equal(o['X-Amz-Content-Sha256'], '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4'); assert.match(o.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token/);
});
test('JWT HS256: jwt.io reference token', () => {
  const t = jwtSign({ payload: { sub: '1234567890', name: 'John Doe', iat: 1516239022 }, secret: 'your-256-bit-secret' });
  assert.equal(t, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  assert.throws(() => jwtSign({ payload: {}, secret: 'x', alg: 'none' }));
});
