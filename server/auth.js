import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from './db.js';
import { hashPassword, checkPassword, signToken, verifyToken } from './security.js';
import { ALLOW_REGISTER, SECURE_COOKIE } from './config.js';

export const httpError = (status, message) => Object.assign(new Error(message), { status });
const COOKIE = 'dh_session';
const TTL = 7 * 24 * 3600 * 1000;

const cookieOpts = () => ({ httpOnly: true, sameSite: 'strict', secure: SECURE_COOKIE, maxAge: TTL, path: '/' });
const insSession = db.prepare('INSERT INTO sessions(id,user_id,expires) VALUES(?,?,?)');
const getSession = db.prepare('SELECT 1 AS ok FROM sessions WHERE id=? AND user_id=? AND expires>?');
db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()), 3600 * 1000).unref();

// Sessions are server-side records: the cookie only carries a signed id, so logout / password change truly revoke access.
function issue(res, u) {
  const sid = crypto.randomBytes(24).toString('base64url'); const e = Date.now() + TTL;
  insSession.run(sid, u.id, e);
  res.cookie(COOKIE, signToken({ s: sid, u: u.id, n: u.username, e }), cookieOpts());
  return sid;
}
const sessionOf = (req) => { const p = verifyToken(req.cookies?.[COOKIE]); return p && p.s && getSession.get(p.s, p.u, Date.now()) ? p : null; };

export function requireAuth(req, _res, next) {
  const p = sessionOf(req);
  if (!p) return next(httpError(401, 'Not signed in'));
  req.user = { id: p.u, username: p.n, sid: p.s };
  next();
}

/* CSRF defence in depth (cookie is SameSite=Strict): state-changing calls must carry a custom header */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'devhub') return next(httpError(403, 'Missing CSRF header'));
  next();
}

const attempts = new Map(); // ip|user -> {n, until}
function throttle(key) {
  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) throw httpError(429, 'Too many failed attempts. Try again in a few minutes.');
}
const fail = (key) => { const a = attempts.get(key); const n = (a && a.until > Date.now() ? a.n : 0) + 1; attempts.set(key, { n, until: Date.now() + 10 * 60 * 1000 }); };

const validName = (s) => typeof s === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(s);

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  if (!ALLOW_REGISTER) throw httpError(403, 'Registration is disabled on this server');
  const { username, password } = req.body || {};
  if (!validName(username)) throw httpError(400, 'Username must be 3-32 characters (letters, numbers, . _ -)');
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw httpError(400, 'Password must be at least 8 characters');
  const { salt, hash } = await hashPassword(password);
  try {
    const r = db.prepare('INSERT INTO users(username,salt,hash,created) VALUES(?,?,?,?)').run(username, salt, hash, Date.now());
    const user = { id: Number(r.lastInsertRowid), username };
    issue(res, user);
    res.json({ user: { username } });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw httpError(409, 'That username is taken');
    throw e;
  }
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const key = req.ip + '|' + String(username).toLowerCase();
  throttle(key);
  const row = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username=?').get(username) : null;
  // always run a hash to keep timing similar for unknown users
  const ok = row ? await checkPassword(String(password), row.salt, row.hash) : (await hashPassword(String(password)), false);
  if (!ok) { fail(key); throw httpError(401, 'Invalid username or password'); }
  attempts.delete(key);
  issue(res, { id: Number(row.id), username: row.username });
  res.json({ user: { username: row.username } });
});

authRouter.post('/logout', (req, res) => {
  const p = verifyToken(req.cookies?.[COOKIE]);
  if (p?.s) db.prepare('DELETE FROM sessions WHERE id=?').run(p.s);
  res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const p = sessionOf(req);
  res.json({ user: p ? { username: p.n } : null, registration: ALLOW_REGISTER });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof next !== 'string' || next.length < 8) throw httpError(400, 'New password must be at least 8 characters');
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!(await checkPassword(String(current), row.salt, row.hash))) throw httpError(401, 'Current password is incorrect');
  const { salt, hash } = await hashPassword(next);
  db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(req.user.id, req.user.sid); // sign out every other device
  res.json({ ok: true });
});
