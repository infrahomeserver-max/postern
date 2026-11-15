import './env.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from './config.js';

const scrypt = promisify(crypto.scrypt);

function loadMaster() {
  if (process.env.DEVHUB_MASTER_KEY) return Buffer.from(process.env.DEVHUB_MASTER_KEY, 'hex');
  const f = path.join(DATA_DIR, 'master.key');
  if (fs.existsSync(f)) return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  const k = crypto.randomBytes(32);
  fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 });
  return k;
}
const master = loadMaster();
const keyCache = new Map();
const derive = (label) => {
  let k = keyCache.get(label);
  if (!k) { k = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), label, 32)); keyCache.set(label, k); }
  return k;
};

/* Passwords: scrypt with per-user salt */
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export async function hashPassword(password, salt = crypto.randomBytes(16)) {
  return { salt, hash: await scrypt(password, salt, 64, SCRYPT) };
}
export async function checkPassword(password, salt, hash) {
  const { hash: h } = await hashPassword(password, Buffer.from(salt));
  return crypto.timingSafeEqual(h, Buffer.from(hash));
}

/* Session tokens: HMAC-signed, httpOnly cookie */
const mac = (body) => crypto.createHmac('sha256', derive('sign')).update(body).digest();
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + mac(body).toString('base64url');
}
export function verifyToken(t) {
  if (typeof t !== 'string') return null;
  const [body, sig] = t.split('.');
  if (!body || !sig) return null;
  const got = Buffer.from(sig, 'base64url'); const exp = mac(body);
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.e > Date.now() ? p : null; } catch { return null; }
}

/* Per-user AES-256-GCM encryption for stored credentials */
export function encrypt(uid, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', derive('enc:' + uid), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decrypt(uid, b64) {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', derive('enc:' + uid), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
