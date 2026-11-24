// Workday-style DUMMY ERP for testing extractors: REST, report (RaaS-style) and SOAP endpoints over generated finance data.
// Modelled loosely on Workday's public conventions; it is NOT Workday and never touches real data. Disable with DEVHUB_SAMPLES=0.
import express, { Router } from 'express';
import crypto from 'node:crypto';
import * as D from './data.js';

export const workdayRouter = Router();
const SECRET = crypto.randomBytes(32);
const BASE = '/sample/workday';
const TNS = 'urn:com.workday/bsvc';
const DEFAULT_PERIOD = '2026-08';

/* ---------------- naming ---------------- */
const camel = (k) => k.replace(/_(\w)/g, (_, c) => c.toUpperCase());
const pascal = (k) => k.split('_').map(w => (w === 'id' ? 'ID' : w === 'usd' ? 'USD' : w[0].toUpperCase() + w.slice(1))).join('_');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/* ---------------- resources: fields drive REST, report, SOAP and the WSDL from one place ---------------- */
const F = {
  periods: [['period_id', 'string'], ['name', 'string'], ['fiscal_year', 'int'], ['period_number', 'int'], ['quarter', 'string'], ['start_date', 'date'], ['end_date', 'date'], ['status', 'string']],
  journals: [['journal_id', 'string'], ['company_id', 'string'], ['ledger', 'string'], ['period_id', 'string'], ['accounting_date', 'date'], ['status', 'string'], ['source', 'string'], ['currency', 'string'], ['memo', 'string'], ['total_debit', 'decimal'], ['total_credit', 'decimal'], ['line_count', 'int'], ['created_by', 'string']],
  lines: [['line_number', 'int'], ['account_id', 'string'], ['account_name', 'string'], ['debit', 'decimal'], ['credit', 'decimal'], ['cost_center', 'string'], ['memo', 'string']],
  journalLines: [['journal_id', 'string'], ['company_id', 'string'], ['ledger', 'string'], ['period_id', 'string'], ['accounting_date', 'date'], ['status', 'string'], ['source', 'string'], ['currency', 'string'], ['line_number', 'int'], ['account_id', 'string'], ['account_name', 'string'], ['debit', 'decimal'], ['credit', 'decimal'], ['cost_center', 'string'], ['memo', 'string']],
  balances: [['company_id', 'string'], ['currency', 'string'], ['period_id', 'string'], ['fiscal_year', 'int'], ['account_id', 'string'], ['account_name', 'string'], ['account_type', 'string'], ['opening_balance', 'decimal'], ['debit', 'decimal'], ['credit', 'decimal'], ['closing_balance', 'decimal'], ['usd_rate', 'decimal'], ['closing_balance_usd', 'decimal']],
  fx: [['rate_type', 'string'], ['base_currency', 'string'], ['quote_currency', 'string'], ['rate_date', 'date'], ['period', 'string'], ['rate', 'decimal'], ['inverse_rate', 'decimal']],
  assets: [['asset_id', 'string'], ['description', 'string'], ['asset_class', 'string'], ['company_id', 'string'], ['currency', 'string'], ['cost_center', 'string'], ['location', 'string'], ['acquisition_date', 'date'], ['in_service_date', 'date'], ['disposal_date', 'string'], ['cost', 'decimal'], ['salvage_value', 'decimal'], ['useful_life_months', 'int'], ['depreciation_method', 'string'], ['as_of_period', 'string'], ['accumulated_depreciation', 'decimal'], ['net_book_value', 'decimal'], ['status', 'string']],
  depreciation: [['asset_id', 'string'], ['description', 'string'], ['asset_class', 'string'], ['company_id', 'string'], ['currency', 'string'], ['cost_center', 'string'], ['period_id', 'string'], ['depreciation_expense', 'decimal'], ['accumulated_depreciation', 'decimal'], ['net_book_value', 'decimal'], ['status', 'string']],
  companies: [['company_id', 'string'], ['name', 'string'], ['country', 'string'], ['currency', 'string']],
  accounts: [['account_id', 'string'], ['name', 'string'], ['type', 'string'], ['normal_side', 'string']],
};
class BadRequest extends Error {}
const per = (ref) => { const p = D.periodByRef(ref); if (!p) throw new BadRequest(`Unknown period "${ref}". Use an id like FY2025-P03 or a month like 2025-03 (FY2024-FY2026).`); return p; };
const lc = (v) => String(v ?? '').toLowerCase();
const date = (v, name) => { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequest(`${name} must be YYYY-MM-DD`); return v; };

/* One query function per resource; q = plain filter object (REST query string or SOAP Request_Criteria), n = journal volume */
const QUERY = {
  periods: (q) => D.PERIODS.filter(p => (!q.period || p === per(q.period)) && (!q.fiscal_year || String(p.fiscal_year) === String(q.fiscal_year)) && (!q.status || lc(p.status) === lc(q.status))),
  companies: () => D.COMPANIES, accounts: () => D.ACCOUNTS,
  journals: (q, n) => { const pid = q.period && per(q.period).period_id, f = date(q.from, 'from'), t = date(q.to, 'to');
    return D.journals(n).filter(j => (!pid || j.period_id === pid) && (!q.company || j.company_id === q.company) && (!q.status || lc(j.status) === lc(q.status)) && (!q.source || lc(j.source) === lc(q.source)) && (!f || j.accounting_date >= f) && (!t || j.accounting_date <= t)); },
  journalLines: (q, n) => { const pid = q.period && per(q.period).period_id, f = date(q.from, 'from'), t = date(q.to, 'to');
    return D.journalLines(n).filter(l => (!pid || l.period_id === pid) && (!q.company || l.company_id === q.company) && (!q.status || lc(l.status) === lc(q.status)) && (!q.account || l.account_id === q.account) && (!f || l.accounting_date >= f) && (!t || l.accounting_date <= t)); },
  balances: (q, n) => { const pid = q.period && per(q.period).period_id; return D.balances(n).filter(b => (!pid || b.period_id === pid) && (!q.company || b.company_id === q.company) && (!q.account || b.account_id === q.account) && (!q.fiscal_year || String(b.fiscal_year) === String(q.fiscal_year))); },
  fx: (q) => { const f = date(q.from, 'from'), t = date(q.to, 'to'), pk = q.period && per(q.period).key;
    return D.fxRates().filter(r => (!q.rate_type || lc(r.rate_type) === lc(q.rate_type)) && (!q.quote || r.quote_currency === String(q.quote).toUpperCase()) && (!pk || r.period === pk) && (!f || r.rate_date >= f) && (!t || r.rate_date <= t)); },
  assets: (q, n) => D.assetsAsOf(n, per(q.as_of || DEFAULT_PERIOD)).filter(a => (!q.company || a.company_id === q.company) && (!q.asset_class || lc(a.asset_class) === lc(q.asset_class)) && (!q.status || lc(a.status) === lc(q.status))),
  depreciation: (q, n) => D.assetDepreciationRows(n, per(q.period || DEFAULT_PERIOD)).filter(a => (!q.company || a.company_id === q.company) && (!q.asset_class || lc(a.asset_class) === lc(q.asset_class))),
};

/* ---------------- shared helpers ---------------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rowsParam = (q) => Math.max(10, Math.min(20000, parseInt(q.rows, 10) || 600));
const slice = (rows, limit, offset) => (limit ? rows.slice(offset, offset + limit) : rows);
function pageParams(q) { // optional: nothing given = everything
  const limit = q.limit === undefined ? 0 : Math.max(1, Math.min(1000, parseInt(q.limit, 10) || 100));
  let offset = Math.max(0, parseInt(q.offset, 10) || 0); if (limit && q.page) offset = (Math.max(1, parseInt(q.page, 10) || 1) - 1) * limit;
  return { limit, offset };
}
const bearerOk = (h) => { // issued by /oauth2/<tenant>/token
  const m = /^Bearer\s+(\S+)$/i.exec(h || ''); if (!m) return false; const [body, sig] = m[1].split('.'); if (!body || !sig) return false;
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now(); } catch { return false; }
};
const authed = (req, raw = '') => bearerOk(req.get('authorization')) || /^Basic\s+\S+/i.test(req.get('authorization') || '') || (/UsernameToken/.test(raw) && /<(?:[\w.-]+:)?Username>[^<]+</.test(raw));

/* simulate=401|403|404|429|500|503|timeout and latency=<ms>, on every data endpoint, to exercise an extractor's retry/timeout handling */
async function simulate(req, res) {
  const lat = Math.min(5000, parseInt(req.query.latency, 10) || 0); if (lat) await sleep(lat);
  const s = String(req.query.simulate || ''); if (!s) return false;
  if (s === 'timeout') { await sleep(65000); return !res.writableEnded; }
  const code = parseInt(s, 10); if (![401, 403, 404, 429, 500, 502, 503, 504].includes(code)) return false;
  if (code === 429) res.set('Retry-After', '1');
  res.status(code); return { code };
}

workdayRouter.use((req, res, next) => {
  if (process.env.DEVHUB_SAMPLES === '0') return res.status(404).json({ error: 'Sample servers are disabled' });
  res.set({ 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
const hits = new Map(); // per client: cheap requests 300/s, large-volume requests (rows > 2000) 4/s, so a public instance can't be used to burn CPU
workdayRouter.use((req, res, next) => {
  const sec = Math.floor(Date.now() / 1000), k = req.ip; let h = hits.get(k); if (!h || h.sec !== sec) { h = { sec, n: 0, big: 0 }; hits.set(k, h); if (hits.size > 5000) hits.clear(); }
  h.n++; if (parseInt(req.query.rows, 10) > 2000) h.big++;
  if (h.n > 300 || h.big > 4) return res.status(429).set('Retry-After', '1').json({ error: 'rate_limited', error_description: 'Sample server rate limit exceeded' });
  next();
});
workdayRouter.use(express.text({ type: () => true, limit: '1mb' }));

/* ---------------- OAuth 2.0 token ---------------- */
workdayRouter.post('/ccx/oauth2/:tenant/token', (req, res) => {
  const form = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : {};
  const grant = form.grant_type;
  if (!['client_credentials', 'refresh_token', 'password'].includes(grant)) return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Use client_credentials, refresh_token or password' });
  const basic = /^Basic\s+(\S+)/i.exec(req.get('authorization') || '');
  if (!basic && !form.client_id) return res.status(401).json({ error: 'invalid_client', error_description: 'Send client credentials (Basic auth or client_id/client_secret). Any non-empty values work.' });
  const body = Buffer.from(JSON.stringify({ t: req.params.tenant, exp: Date.now() + 3600e3, n: crypto.randomUUID() })).toString('base64url');
  const tok = body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  res.json({ access_token: tok, token_type: 'Bearer', expires_in: 3600, refresh_token: 'dummy-refresh-' + crypto.randomBytes(8).toString('hex') });
});

/* ---------------- REST ---------------- */
const toCamel = (row, sub, fields) => { const o = {}; for (const [k, v] of Object.entries(row)) { if (fields && !fields.some(f => f[0] === k) && !(sub && k === sub.key)) continue; o[camel(k)] = (sub && k === sub.key) ? v.map(r => toCamel(r, null, F.lines)) : v; } return o; };
const REST = { periods: 'periods', companies: 'companies', accounts: 'accounts', journals: 'journals', transactions: 'journalLines', balances: 'balances', 'fx-rates': 'fx', assets: 'assets', 'asset-depreciation': 'depreciation' };
const REST_PARAM = { as_of: 'asOf', rate_type: 'rateType', asset_class: 'assetClass', fiscal_year: 'fiscalYear' };
const restQuery = (q) => { const o = { ...q }; for (const [k, v] of Object.entries(REST_PARAM)) if (q[v] !== undefined) o[k] = q[v]; return o; };

workdayRouter.get('/ccx/api/v1/:tenant/:resource{/:id}{/:sub}', async (req, res) => {
  const sim = await simulate(req, res); if (sim === true) return;
  if (sim) return res.json({ error: 'simulated_' + sim.code, errors: [{ error: 'Simulated failure', code: sim.code }] });
  if (!authed(req)) return res.status(401).set('WWW-Authenticate', 'Bearer realm="dummy"').json({ error: 'invalid_token', error_description: 'Send Authorization: Bearer <token> (from the token endpoint) or Basic.' });
  const res_ = REST[req.params.resource];
  if (!res_) return res.status(404).json({ error: 'not_found', error_description: `Unknown resource. Available: ${Object.keys(REST).join(', ')}` });
  try {
    const q = restQuery(req.query), n = rowsParam(req.query), { id, sub } = req.params;
    const fields = res_ === 'journals' ? F.journals : F[res_ === 'journalLines' ? 'journalLines' : res_];
    void fields;
    if (id && id !== 'depreciation') { // detail
      let row;
      if (res_ === 'periods') row = D.periodByRef(id);
      else if (res_ === 'journals') row = D.journals(n).find(j => j.journal_id === id);
      else if (res_ === 'assets') {
        const a = D.assets(n).find(x => x.asset_id === id);
        if (a && sub === 'depreciation') { const rows = D.depreciationSchedule(a); const { limit, offset } = pageParams(req.query); return res.json({ total: rows.length, ...(limit ? { limit, offset } : {}), data: slice(rows, limit, offset).map(r => toCamel(r)) }); }
        row = a && D.assetsAsOf(n, per(q.as_of || DEFAULT_PERIOD)).find(x => x.asset_id === id);
      } else if (res_ === 'companies') row = D.COMPANIES.find(c => c.company_id === id);
      else if (res_ === 'accounts') row = D.ACCOUNTS.find(c => c.account_id === id);
      if (!row) return res.status(404).json({ error: 'not_found', error_description: `${req.params.resource}/${id} does not exist` });
      return res.json(toCamel(row, res_ === 'journals' ? { key: 'lines' } : null, F[res_]));
    }
    const rows = QUERY[res_](q, n), { limit, offset } = pageParams(req.query);
    const out = { total: rows.length, ...(limit ? { limit, offset } : {}), data: slice(rows, limit, offset).map(r => toCamel(r, res_ === 'journals' ? { key: 'lines' } : null, F[res_])) };
    res.json(out);
  } catch (e) { if (e instanceof BadRequest) return res.status(400).json({ error: 'invalid_request', error_description: e.message }); throw e; }
});

/* ---------------- custom reports (RaaS-style) ---------------- */
const REPORTS = { Periods: 'periods', Journal_Lines: 'journalLines', Trial_Balance: 'balances', FX_Rates: 'fx', Fixed_Assets: 'assets', Asset_Depreciation: 'depreciation', Companies: 'companies', Ledger_Accounts: 'accounts' };
const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
workdayRouter.get('/ccx/service/customreport2/:tenant/:owner/:report', async (req, res) => {
  const sim = await simulate(req, res); if (sim === true) return;
  if (sim) return res.json({ error: 'simulated_' + sim.code });
  if (!authed(req)) return res.status(401).set('WWW-Authenticate', 'Basic realm="dummy"').type('text/plain').send('Authentication required (Basic or Bearer; any non-empty Basic credentials work).');
  const name = Object.keys(REPORTS).find(k => lc(k) === lc(req.params.report));
  if (!name) return res.status(404).type('text/plain').send(`Unknown report. Available: ${Object.keys(REPORTS).join(', ')}`);
  try {
    const kind = REPORTS[name], q = restQuery(req.query), n = rowsParam(req.query), { limit, offset } = pageParams(req.query);
    const rows = slice(QUERY[kind](q, n), limit, offset), fields = F[kind];
    const fmt = lc(req.query.format || 'simplexml');
    const rec = (r) => Object.fromEntries(fields.map(([k]) => [pascal(k), r[k]]));
    if (fmt === 'json') return res.json({ Report_Entry: rows.map(rec) });
    if (fmt === 'csv') return res.type('text/csv; charset=utf-8').send([fields.map(([k]) => pascal(k)).join(','), ...rows.map(r => fields.map(([k]) => csvCell(r[k])).join(','))].join('\r\n') + '\r\n');
    const xml = rows.map(r => '<wd:Report_Entry>' + fields.map(([k]) => `<wd:${pascal(k)}>${esc(r[k])}</wd:${pascal(k)}>`).join('') + '</wd:Report_Entry>').join('');
    res.type('text/xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?>\n<wd:Report_Data xmlns:wd="urn:com.workday.report/${name}">${xml}</wd:Report_Data>`);
  } catch (e) { if (e instanceof BadRequest) return res.status(400).type('text/plain').send(e.message); throw e; }
});

/* ---------------- SOAP ---------------- */
const XT = { string: 'xsd:string', int: 'xsd:int', decimal: 'xsd:decimal', date: 'xsd:date' };
const OPS = {
  Get_Periods: { kind: 'periods', item: 'Period', fields: F.periods, crit: [['Fiscal_Year', 'int', 'fiscal_year'], ['Status', 'string', 'status'], ['Period', 'string', 'period']] },
  Get_Journals: { kind: 'journals', item: 'Journal', fields: F.journals, sub: { key: 'lines', item: 'Journal_Line', fields: F.lines }, crit: [['Period', 'string', 'period'], ['Company', 'string', 'company'], ['Status', 'string', 'status'], ['Source', 'string', 'source'], ['From_Date', 'date', 'from'], ['To_Date', 'date', 'to']] },
  Get_Journal_Lines: { kind: 'journalLines', item: 'Transaction_Line', fields: F.journalLines, crit: [['Period', 'string', 'period'], ['Company', 'string', 'company'], ['Status', 'string', 'status'], ['Account', 'string', 'account'], ['From_Date', 'date', 'from'], ['To_Date', 'date', 'to']] },
  Get_Trial_Balance: { kind: 'balances', item: 'Balance', fields: F.balances, crit: [['Period', 'string', 'period'], ['Company', 'string', 'company'], ['Account', 'string', 'account'], ['Fiscal_Year', 'int', 'fiscal_year']] },
  Get_Currency_Rates: { kind: 'fx', item: 'Currency_Rate', fields: F.fx, crit: [['Rate_Type', 'string', 'rate_type'], ['Quote_Currency', 'string', 'quote'], ['Period', 'string', 'period'], ['From_Date', 'date', 'from'], ['To_Date', 'date', 'to']] },
  Get_Assets: { kind: 'assets', item: 'Asset', fields: F.assets, crit: [['Company', 'string', 'company'], ['Asset_Class', 'string', 'asset_class'], ['Status', 'string', 'status'], ['As_Of_Period', 'string', 'as_of']] },
  Get_Asset_Depreciation: { kind: 'depreciation', item: 'Asset_Depreciation_Line', fields: F.depreciation, crit: [['Period', 'string', 'period'], ['Company', 'string', 'company'], ['Asset_Class', 'string', 'asset_class']] },
};
const E11 = 'http://schemas.xmlsoap.org/soap/envelope/';
const fault = (res, status, code, msg) => res.status(status).type('text/xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?>\n<SOAP-ENV:Envelope xmlns:SOAP-ENV="${E11}" xmlns:wd="${TNS}"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:${code}</faultcode><faultstring>${esc(msg)}</faultstring><detail><wd:Validation_Fault><wd:Message>${esc(msg)}</wd:Message></wd:Validation_Fault></detail></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`);
const tag = (raw, name) => { const m = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)<`).exec(raw.slice(0, 200000)); return m ? m[1].trim() : ''; };
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlItem = (name, fields, row, sub) => `<wd:${name}>` + fields.map(([k]) => `<wd:${pascal(k)}>${esc(row[k])}</wd:${pascal(k)}>`).join('') + (sub ? row[sub.key].map(r => xmlItem(sub.item, sub.fields, r)).join('') : '') + `</wd:${name}>`;

workdayRouter.post('/ccx/service/:tenant/Financial_Management/:ver', async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : '';
  const sim = await simulate(req, res); if (sim === true) return;
  if (sim) return fault(res, sim.code, 'Server', 'Simulated failure ' + sim.code);
  if (!authed(req, raw)) return res.status(401).set('WWW-Authenticate', 'Basic realm="dummy"').type('text/xml; charset=utf-8').send(`<?xml version="1.0"?>\n<SOAP-ENV:Envelope xmlns:SOAP-ENV="${E11}"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Client</faultcode><faultstring>Authentication required: send a WS-Security UsernameToken, or an Authorization header</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`);
  const om = /<(?:[\w.-]+:)?Body(?:\s[^>]*)?>\s*(?:<!--[\s\S]{0,2000}?-->\s*)*<(?:[\w.-]+:)?([\w.-]+)/.exec(raw.slice(0, 65536));
  const opName = om ? om[1] : '';
  const opKey = Object.keys(OPS).find(k => opName === k + '_Request');
  if (!opKey) return fault(res, 500, 'Client', opName ? `Unknown operation "${opName}". Available: ${Object.keys(OPS).map(k => k + '_Request').join(', ')}` : 'No SOAP Body operation found');
  const op = OPS[opKey]; const q = {};
  for (const [name, , key] of op.crit) { const v = unesc(tag(raw, name)); if (v && !['string', '?', '0'].includes(v)) q[key] = v; } // sample placeholders from a generated envelope mean "no filter"
  const pg = parseInt(tag(raw, 'Page'), 10), cnt = parseInt(tag(raw, 'Count'), 10); const paged = Number.isFinite(cnt) && cnt > 0;
  const count = paged ? Math.min(1000, cnt) : 0, page = paged ? Math.max(1, pg || 1) : 1;
  try {
    const rows = QUERY[op.kind](q, rowsParam(req.query)); const total = rows.length, pages = paged ? Math.max(1, Math.ceil(total / count)) : 1;
    const data = paged ? rows.slice((page - 1) * count, page * count) : rows;
    if (paged && page > pages) return fault(res, 500, 'Client', `Page ${page} is out of range (Total_Pages ${pages})`);
    res.type('text/xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?>\n<SOAP-ENV:Envelope xmlns:SOAP-ENV="${E11}"><SOAP-ENV:Body><wd:${opKey}_Response xmlns:wd="${TNS}" wd:version="v1">` +
      (paged ? `<wd:Response_Filter><wd:Page>${page}</wd:Page><wd:Count>${count}</wd:Count></wd:Response_Filter>` : '') +
      `<wd:Response_Results><wd:Total_Results>${total}</wd:Total_Results><wd:Total_Pages>${pages}</wd:Total_Pages><wd:Page_Results>${data.length}</wd:Page_Results><wd:Page>${page}</wd:Page></wd:Response_Results>` +
      `<wd:Response_Data>${data.map(r => xmlItem(op.item, op.fields, r, op.sub)).join('')}</wd:Response_Data></wd:${opKey}_Response></SOAP-ENV:Body></SOAP-ENV:Envelope>`);
  } catch (e) { if (e instanceof BadRequest) return fault(res, 500, 'Client', e.message); throw e; }
});

/* WSDL generated from the same field lists */
const elType = (fields, item, sub) => `<xsd:element name="${item}" minOccurs="0" maxOccurs="unbounded"><xsd:complexType><xsd:sequence>` +
  fields.map(([k, t]) => `<xsd:element name="${pascal(k)}" type="${XT[t]}" minOccurs="0"/>`).join('') +
  (sub ? `<xsd:element name="${sub.item}" minOccurs="0" maxOccurs="unbounded"><xsd:complexType><xsd:sequence>${sub.fields.map(([k, t]) => `<xsd:element name="${pascal(k)}" type="${XT[t]}" minOccurs="0"/>`).join('')}</xsd:sequence></xsd:complexType></xsd:element>` : '') +
  `</xsd:sequence></xsd:complexType></xsd:element>`;
export function wsdl(location) {
  const types = Object.entries(OPS).map(([n, o]) => `
      <xsd:element name="${n}_Request"><xsd:complexType><xsd:sequence>
        <xsd:element name="Request_Criteria" minOccurs="0"><xsd:complexType><xsd:sequence>${o.crit.map(([c, t]) => `<xsd:element name="${c}" type="${XT[t]}" minOccurs="0"/>`).join('')}</xsd:sequence></xsd:complexType></xsd:element>
        <xsd:element name="Response_Filter" type="wd:Response_FilterType" minOccurs="0"/>
      </xsd:sequence></xsd:complexType></xsd:element>
      <xsd:element name="${n}_Response"><xsd:complexType><xsd:sequence>
        <xsd:element name="Response_Filter" type="wd:Response_FilterType" minOccurs="0"/>
        <xsd:element name="Response_Results" type="wd:Response_ResultsType"/>
        <xsd:element name="Response_Data"><xsd:complexType><xsd:sequence>${elType(o.fields, o.item, o.sub)}</xsd:sequence></xsd:complexType></xsd:element>
      </xsd:sequence></xsd:complexType></xsd:element>`).join('');
  const names = Object.keys(OPS);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Dummy Workday-style Financial Management service for testing. Not a Workday WSDL. -->
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:wd="${TNS}" targetNamespace="${TNS}" name="Financial_Management">
  <wsdl:types><xsd:schema targetNamespace="${TNS}" elementFormDefault="qualified">
    <xsd:complexType name="Response_FilterType"><xsd:sequence><xsd:element name="Page" type="xsd:int" minOccurs="0"/><xsd:element name="Count" type="xsd:int" minOccurs="0"/></xsd:sequence></xsd:complexType>
    <xsd:complexType name="Response_ResultsType"><xsd:sequence><xsd:element name="Total_Results" type="xsd:int"/><xsd:element name="Total_Pages" type="xsd:int"/><xsd:element name="Page_Results" type="xsd:int"/><xsd:element name="Page" type="xsd:int"/></xsd:sequence></xsd:complexType>${types}
  </xsd:schema></wsdl:types>
${names.map(n => `  <wsdl:message name="${n}_InputMsg"><wsdl:part name="parameters" element="wd:${n}_Request"/></wsdl:message>\n  <wsdl:message name="${n}_OutputMsg"><wsdl:part name="parameters" element="wd:${n}_Response"/></wsdl:message>`).join('\n')}
  <wsdl:portType name="Financial_ManagementPort">
${names.map(n => `    <wsdl:operation name="${n}"><wsdl:input message="wd:${n}_InputMsg"/><wsdl:output message="wd:${n}_OutputMsg"/></wsdl:operation>`).join('\n')}
  </wsdl:portType>
  <wsdl:binding name="Financial_ManagementBinding" type="wd:Financial_ManagementPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
${names.map(n => `    <wsdl:operation name="${n}"><soap:operation soapAction="${TNS}/${n}"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>`).join('\n')}
  </wsdl:binding>
  <wsdl:service name="Financial_Management"><wsdl:port name="Financial_ManagementPort" binding="wd:Financial_ManagementBinding"><soap:address location="${esc(location)}"/></wsdl:port></wsdl:service>
</wsdl:definitions>`;
}
workdayRouter.get('/ccx/service/:tenant/Financial_Management/:ver', (req, res) => {
  const loc = `${req.protocol}://${req.get('host')}${BASE}/ccx/service/${encodeURIComponent(req.params.tenant)}/Financial_Management/${encodeURIComponent(req.params.ver)}`;
  res.type('text/xml; charset=utf-8').send(wsdl(loc));
});

/* ---------------- ready-made Postman collection + environment (importable here and in real Postman) ---------------- */
function postman(origin, withSoap = true) {
  const hdr = [{ key: 'Authorization', value: 'Bearer {{token}}' }];
  const rest = (name, path, query = [], test) => ({ name, event: test ? [{ listen: 'test', script: { type: 'text/javascript', exec: test } }] : undefined,
    request: { method: 'GET', header: hdr, url: { raw: `{{baseUrl}}/ccx/api/v1/{{tenant}}/${path}`, host: ['{{baseUrl}}'], path: ['ccx', 'api', 'v1', '{{tenant}}', ...path.split('/')], query: query.map(([key, value, disabled]) => ({ key, value, disabled: !!disabled })) } } });
  const raas = (name, report, fmt = 'json', query = []) => ({ name, request: { method: 'GET', header: hdr, url: { raw: `{{baseUrl}}/ccx/service/customreport2/{{tenant}}/dummy_owner/${report}`, host: ['{{baseUrl}}'], path: ['ccx', 'service', 'customreport2', '{{tenant}}', 'dummy_owner', report], query: [['format', fmt], ...query].map(([key, value, disabled]) => ({ key, value, disabled: !!disabled })) } } });
  const ok = ['pm.test("200 OK", () => pm.response.to.have.status(200));', 'pm.test("has total and data", () => { const j = pm.response.json(); pm.expect(j).to.have.property("total"); pm.expect(j.data).to.be.an("array"); });'];
  const pg = [['limit', '100', true], ['offset', '0', true]];
  const soap = (op, crit, page) => `<soapenv:Envelope xmlns:soapenv="${E11}" xmlns:wd="${TNS}">\n  <soapenv:Header/>\n  <soapenv:Body>\n    <wd:${op}_Request>\n${crit.length ? `      <wd:Request_Criteria>\n${crit.map(([k, v]) => `        <wd:${k}>${v}</wd:${k}>`).join('\n')}\n      </wd:Request_Criteria>\n` : ''}${page ? '      <wd:Response_Filter><wd:Page>1</wd:Page><wd:Count>100</wd:Count></wd:Response_Filter>\n' : ''}    </wd:${op}_Request>\n  </soapenv:Body>\n</soapenv:Envelope>`;
  const sreq = (name, op, crit, page) => ({ name, request: { method: 'POST', header: [{ key: 'Content-Type', value: 'text/xml; charset=utf-8' }, { key: 'SOAPAction', value: '' }, { key: 'Authorization', value: 'Bearer {{token}}' }],
    body: { mode: 'raw', raw: soap(op, crit, page), options: { raw: { language: 'xml' } } }, url: { raw: '{{baseUrl}}/ccx/service/{{tenant}}/Financial_Management/v1', host: ['{{baseUrl}}'], path: ['ccx', 'service', '{{tenant}}', 'Financial_Management', 'v1'] } } });
  return {
    info: { name: 'Workday-Mock ERP', description: 'Dummy finance data. Run "Get token" first (sets {{token}}). Add limit/offset (REST) or Response_Filter (SOAP) to paginate; leave them off for everything.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      { name: 'Auth', item: [{ name: 'Get token (client credentials)', event: [{ listen: 'test', script: { type: 'text/javascript', exec: ['const j = pm.response.json();', 'pm.environment.set("token", j.access_token);', 'pm.test("token issued", () => pm.expect(j.access_token).to.be.a("string"));'] } }],
        request: { method: 'POST', header: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }], body: { mode: 'urlencoded', urlencoded: [{ key: 'grant_type', value: 'client_credentials' }, { key: 'client_id', value: '{{clientId}}' }, { key: 'client_secret', value: '{{clientSecret}}' }] }, url: { raw: '{{baseUrl}}/ccx/oauth2/{{tenant}}/token', host: ['{{baseUrl}}'], path: ['ccx', 'oauth2', '{{tenant}}', 'token'] } } }] },
      { name: 'REST', item: [
        rest('Periods', 'periods', [['fiscalYear', '2025', true], ['status', 'Closed', true], ...pg], ok),
        rest('Companies (reference)', 'companies'), rest('Ledger accounts (reference)', 'accounts'),
        rest('Journals', 'journals', [['period', '2026-03', true], ['company', 'US01', true], ['status', 'Posted', true], ['from', '2026-01-01', true], ['to', '2026-03-31', true], ['limit', '50'], ['offset', '0']], ok),
        rest('Journal by id', 'journals/JE-000001'),
        rest('Transactions (journal lines)', 'transactions', [['period', '2026-03', true], ['company', 'US01', true], ['account', '1000', true], ['limit', '100'], ['offset', '0']], ok),
        rest('Trial balance', 'balances', [['period', '2026-03'], ['company', 'US01', true], ['account', '1000', true], ...pg], ok),
        rest('FX rates', 'fx-rates', [['rateType', 'Spot'], ['quote', 'EUR', true], ['from', '2026-01-01'], ['to', '2026-03-31'], ...pg], ok),
        rest('Fixed assets (as of period)', 'assets', [['asOf', '2026-08'], ['company', 'US01', true], ['assetClass', 'Computers', true], ['limit', '100'], ['offset', '0']], ok),
        rest('Asset depreciation (period)', 'asset-depreciation', [['period', '2026-08'], ['company', 'US01', true], ...pg], ok),
        rest('Asset depreciation schedule', 'assets/FA-00001/depreciation', pg),
        rest('Simulate 429 (retry test)', 'periods', [['simulate', '429']]), rest('Simulate slow response', 'periods', [['latency', '2000']]),
      ] },
      { name: 'Reports (RaaS-style)', item: [raas('Periods (JSON)', 'Periods'), raas('Journal lines (CSV)', 'Journal_Lines', 'csv', [['period', '2026-03', true], ['limit', '100', true], ['offset', '0', true]]), raas('Trial balance (JSON)', 'Trial_Balance', 'json', [['period', '2026-03']]), raas('FX rates (XML)', 'FX_Rates', 'simplexml', [['rateType', 'Closing']]), raas('Fixed assets (JSON)', 'Fixed_Assets', 'json', [['asOf', '2026-08']]), raas('Asset depreciation (CSV)', 'Asset_Depreciation', 'csv', [['period', '2026-08']])] },
      ...(!withSoap ? [] : [{ name: 'SOAP (Financial_Management v1)', item: [
        sreq('Get_Periods', 'Get_Periods', [['Fiscal_Year', '2025']], false), sreq('Get_Journals (paged)', 'Get_Journals', [['Period', '2026-03'], ['Company', 'US01']], true),
        sreq('Get_Journal_Lines', 'Get_Journal_Lines', [['Period', '2026-03']], true), sreq('Get_Trial_Balance', 'Get_Trial_Balance', [['Period', '2026-03']], false),
        sreq('Get_Currency_Rates', 'Get_Currency_Rates', [['Rate_Type', 'Closing'], ['Quote_Currency', 'EUR']], true), sreq('Get_Assets', 'Get_Assets', [['As_Of_Period', '2026-08']], true), sreq('Get_Asset_Depreciation', 'Get_Asset_Depreciation', [['Period', '2026-08']], true),
      ] }]),
    ],
  };
}
workdayRouter.get('/postman/collection.json', (req, res) => res.json(postman(`${req.protocol}://${req.get('host')}`, req.query.soap !== '0')));
workdayRouter.get('/postman/environment.json', (req, res) => res.json({ name: 'Workday-Mock ERP', values: [
  { key: 'baseUrl', value: `${req.protocol}://${req.get('host')}${BASE}`, enabled: true }, { key: 'tenant', value: 'dummy', enabled: true },
  { key: 'clientId', value: 'dummy-client', enabled: true }, { key: 'clientSecret', value: 'dummy-secret', enabled: true, type: 'secret' }, { key: 'token', value: '', enabled: true }], _postman_variable_scope: 'environment' }));

workdayRouter.get('/', (req, res) => {
  const o = `${req.protocol}://${req.get('host')}${BASE}`;
  res.json({ name: 'Workday-Mock ERP (test data, not Workday)', tenant: 'any name, e.g. "dummy"', auth: { token: `POST ${o}/ccx/oauth2/dummy/token (grant_type=client_credentials, any client id/secret)`, or: 'Basic with any credentials; SOAP also accepts a WS-Security UsernameToken' },
    rest: Object.keys(REST).map(r => `${o}/ccx/api/v1/dummy/${r}`), reports: Object.keys(REPORTS).map(r => `${o}/ccx/service/customreport2/dummy/owner/${r}?format=json|csv|simplexml`),
    soap: { endpoint: `${o}/ccx/service/dummy/Financial_Management/v1`, wsdl: `${o}/ccx/service/dummy/Financial_Management/v1` + ' (GET)', operations: Object.keys(OPS) },
    options: { pagination: 'REST/reports: limit, offset (or page); SOAP: Response_Filter Page/Count; omit for everything', rows: 'rows=N sets journal volume (10-20000, default 600)', simulate: 'simulate=401|403|404|429|500|503|timeout, latency=ms' },
    downloads: { collection: `${o}/postman/collection.json`, environment: `${o}/postman/environment.json` } });
});
