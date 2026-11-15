import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PORT } from './config.js';
import { authRouter, requireAuth, csrfGuard } from './auth.js';
import { docsRouter } from './docs.js';
import { httpRouter } from './http.js';
import { sftpRouter, sitesRouter, localRouter } from './sftp.js';
import { mockRouter, mockApi } from './mock.js';
import { workdayRouter } from './samples/workday.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.DEVHUB_TRUST_PROXY === '1');

// Desktop-app hardening: only the app window (which holds a random per-launch token) may use the UI/API, and the
// Host header must be loopback (blocks DNS-rebinding). Mocks, sample ERP and /api/ping stay open for test clients.
const APP_TOKEN = process.env.POSTERN_TOKEN || '';
if (APP_TOKEN) {
  const want = Buffer.from(APP_TOKEN);
  const open = /^\/(mock|sample)(\/|$)|^\/api\/ping$/;
  const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  app.use((req, res, next) => {
    if (!loopbackHost.test(req.headers.host || '')) return res.status(403).type('text').send('Forbidden host');
    if (open.test(req.path)) return next();
    const got = Buffer.from(String(req.get('x-postern-token') || ''));
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(403).type('text').send('Forbidden');
    next();
  });
}

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(compression({ level: 4, threshold: 1024 })); // level 4: ~3x less CPU than default for a few % larger output
app.use(cookieParser());

app.use('/sample/workday', workdayRouter); // dummy ERP for testing extractors (public, fake data)
app.use('/mock', mockRouter); // public, unguessable-URL mock endpoints (no session, no CSRF header)

const api = express.Router();
// Liveness ping (no session). In desktop mode the page pings while it is open; see the idle exit below.
let lastPing = Date.now();
api.get('/ping', (_req, res) => { lastPing = Date.now(); res.set('Cache-Control', 'no-store').json({ app: 'postern' }); });
api.use(csrfGuard);
// Raw streaming upload must bypass the JSON parser.
api.use(express.json({ limit: '25mb' }));
api.use('/auth', authRouter);
api.use('/docs', requireAuth, docsRouter);
api.use('/http', requireAuth, httpRouter);
api.use('/sites', requireAuth, sitesRouter);
api.use('/sftp', requireAuth, sftpRouter);
api.use('/local', requireAuth, localRouter);
api.use('/mocks', requireAuth, mockApi);
api.use((_req, _res, next) => next(Object.assign(new Error('Not found'), { status: 404 })));
app.use('/api', api);

// The script sandbox page gets its own, stricter CSP: no network, inline script + eval only.
app.use('/sandbox', (_req, res, next) => {
  res.set({ 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'", 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(dist, { maxAge: 0, index: false }));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.type === 'entity.too.large' ? 413 : err.status || 500;
  if (status >= 500 && status !== 502) console.error(err);
  if (res.headersSent) return res.destroy();
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message, code: err.code });
});

const host = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, host, () => console.log(`Postern listening on http://${host}:${server.address().port}`));
const shutdown = () => { server.close(() => process.exit(0)); server.closeAllConnections?.(); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
// Desktop fallback (no app window to wait on): exit once the page has stopped pinging for DEVHUB_IDLE_EXIT seconds.
const idle = Number(process.env.DEVHUB_IDLE_EXIT || 0);
if (idle > 0) setInterval(() => { if (Date.now() - lastPing > idle * 1000) { console.log('No open window: shutting down'); shutdown(); } }, Math.min(idle * 250, 15000)).unref();
