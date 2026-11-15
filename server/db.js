import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { encrypt, decrypt } from './security.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'devhub.db'));
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  salt BLOB NOT NULL, hash BLOB NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS docs(
  user_id INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
  data TEXT NOT NULL, updated INTEGER NOT NULL,
  PRIMARY KEY(user_id, kind, id));
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS docs_by_id ON docs(kind, id);
CREATE INDEX IF NOT EXISTS docs_kind ON docs(user_id, kind, updated DESC);
`);

/* Every document is encrypted at rest (AES-256-GCM, per-user key). Rows written by older versions are plaintext JSON
   and are transparently read, then encrypted by the migration below. */
const PFX = 'e1:';
const seal = (uid, text) => PFX + encrypt(uid, text);
const open = (uid, text) => text.startsWith(PFX) ? decrypt(uid, text.slice(PFX.length)) : text;

const upsertStmt = db.prepare(`INSERT INTO docs(user_id,kind,id,data,updated) VALUES(?,?,?,?,?)
  ON CONFLICT(user_id,kind,id) DO UPDATE SET data=excluded.data, updated=excluded.updated`);
const getStmt = db.prepare('SELECT data, updated FROM docs WHERE user_id=? AND kind=? AND id=?');
const listStmt = db.prepare('SELECT id, data, updated FROM docs WHERE user_id=? AND kind=? ORDER BY updated DESC LIMIT ?');
const delStmt = db.prepare('DELETE FROM docs WHERE user_id=? AND kind=? AND id=?');
const clearStmt = db.prepare('DELETE FROM docs WHERE user_id=? AND kind=?');
const trimStmt = db.prepare(`DELETE FROM docs WHERE user_id=? AND kind=? AND id NOT IN
  (SELECT id FROM docs WHERE user_id=? AND kind=? ORDER BY updated DESC LIMIT ?)`);

export const docs = {
  put: (uid, kind, id, obj) => upsertStmt.run(uid, kind, id, seal(uid, JSON.stringify(obj)), Date.now()),
  get: (uid, kind, id) => { const r = getStmt.get(uid, kind, id); return r ? { ...JSON.parse(open(uid, r.data)), id, _updated: r.updated } : null; },
  list: (uid, kind, limit = 5000) => listStmt.all(uid, kind, limit).map(r => ({ ...JSON.parse(open(uid, r.data)), id: r.id, _updated: r.updated })),
  // Fast path for large lists: splice id/_updated into the stored JSON text instead of parse + re-stringify.
  listJson: (uid, kind, limit = 5000) => '[' + listStmt.all(uid, kind, limit).map(r => {
    const meta = `"id":${JSON.stringify(r.id)},"_updated":${r.updated}`;
    const data = open(uid, r.data);
    return data.length <= 2 ? `{${meta}}` : data.slice(0, -1) + ',' + meta + '}';
  }).join(',') + ']',
  // Public lookup (mock servers are called without a session): returns the owning user + document.
  getAny: (kind, id) => { const r = db.prepare('SELECT user_id, data, updated FROM docs WHERE kind=? AND id=? LIMIT 1').get(kind, id); return r ? { uid: Number(r.user_id), doc: { ...JSON.parse(open(Number(r.user_id), r.data)), id, _updated: r.updated } } : null; },
  del: (uid, kind, id) => delStmt.run(uid, kind, id),
  clear: (uid, kind) => clearStmt.run(uid, kind),
  trim: (uid, kind, keep) => trimStmt.run(uid, kind, uid, kind, keep),
  tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
};

// One-time migration of plaintext rows from earlier versions.
{
  const rows = db.prepare("SELECT user_id, kind, id, data FROM docs WHERE data NOT LIKE 'e1:%'").all();
  if (rows.length) {
    const up = db.prepare('UPDATE docs SET data=? WHERE user_id=? AND kind=? AND id=?');
    docs.tx(() => rows.forEach(r => up.run(seal(Number(r.user_id), r.data), r.user_id, r.kind, r.id)));
    console.log(`Encrypted ${rows.length} existing record(s) at rest`);
  }
}
