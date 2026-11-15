import { Router } from 'express';
import { docs } from './db.js';
import { dropNetCache } from './netconf.js';
import { httpError } from './auth.js';
import { docs as store } from './db.js';

const KINDS = new Set(['collection', 'environment', 'history', 'settings', 'mock']);
const LIMITS = { history: 200 };
const ID = /^[\w.-]{1,64}$/;

export const docsRouter = Router();

docsRouter.use('/:kind', (req, _res, next) => {
  if (!KINDS.has(req.params.kind)) return next(httpError(404, 'Unknown document type'));
  next();
});

const SECRET_FIELDS = ['proxyPass', 'clientKeyPem', 'clientKeyPass']; // never sent back to the browser; '__keep__' on save means "unchanged"
const maskSettings = (d) => { const o = { ...d }; for (const f of SECRET_FIELDS) if (o[f]) o[f] = '__keep__'; return o; };
docsRouter.get('/:kind', (req, res) => {
  if (req.params.kind === 'settings') return res.json(docs.list(req.user.id, 'settings').map(maskSettings));
  res.type('json').send(docs.listJson(req.user.id, req.params.kind, LIMITS[req.params.kind] || 5000));
});

docsRouter.put('/:kind/:id', (req, res) => {
  const { kind, id } = req.params;
  if (!ID.test(id)) throw httpError(400, 'Bad id');
  if (kind === 'mock') { // public URLs: ids must be long random strings and globally unique
    if (!/^[\w-]{20,64}$/.test(id)) throw httpError(400, 'Mock ids must be 20-64 random characters');
    const other = store.getAny('mock', id); if (other && other.uid !== req.user.id) throw httpError(409, 'Mock id already in use');
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw httpError(400, 'Body must be an object');
  const { _updated, ...data } = req.body;
  if (kind === 'settings') { const prev = docs.get(req.user.id, 'settings', id) || {}; for (const f of SECRET_FIELDS) if (data[f] === '__keep__') data[f] = prev[f] || ''; }
  docs.put(req.user.id, kind, id, data); if (kind === 'settings') dropNetCache(req.user.id);
  if (LIMITS[kind]) docs.trim(req.user.id, kind, LIMITS[kind]);
  res.json({ ok: true });
});

docsRouter.post('/:kind/bulk', (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 5000) throw httpError(400, 'items must be an array (max 5000)');
  docs.tx(() => items.forEach(({ _updated, ...it }) => {
    if (!ID.test(String(it.id))) throw httpError(400, 'Bad id in bulk import');
    docs.put(req.user.id, req.params.kind, it.id, it);
  }));
  res.json({ ok: true, count: items.length });
});

docsRouter.delete('/:kind', (req, res) => { docs.clear(req.user.id, req.params.kind); res.json({ ok: true }); });
docsRouter.delete('/:kind/:id', (req, res) => { docs.del(req.user.id, req.params.kind, req.params.id); res.json({ ok: true }); });
