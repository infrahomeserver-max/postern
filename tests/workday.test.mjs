// Run with: npm test   (starts the real server on a free port with a temporary data folder)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

let proc, base, dir, tok;
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'postern-test-')); const port = await freePort(); base = `http://127.0.0.1:${port}/sample/workday`;
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DEVHUB_DATA: dir, NODE_ENV: 'production' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/ping`)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
  const r = await fetch(`${base}/ccx/oauth2/t/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&client_id=a&client_secret=b' });
  tok = (await r.json()).access_token;
});
after(() => { proc?.kill(); rmSync(dir, { recursive: true, force: true }); });
const get = (p, q = {}) => fetch(`${base}/ccx/api/v1/t/${p}?${new URLSearchParams(q)}`, { headers: { Authorization: `Bearer ${tok}` } });
const soap = (op, crit = '', page = '') => fetch(`${base}/ccx/service/t/Financial_Management/v1`, { method: 'POST', headers: { 'Content-Type': 'text/xml', Authorization: `Bearer ${tok}` },
  body: `<e:Envelope xmlns:e="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc"><e:Body><wd:${op}_Request>${crit ? `<wd:Request_Criteria>${crit}</wd:Request_Criteria>` : ''}${page}</wd:${op}_Request></e:Body></e:Envelope>` }).then(async r => ({ status: r.status, text: await r.text() }));
const num = (t, n) => Number(new RegExp(`<wd:${n}>(\\d+)<`).exec(t)?.[1]);

test('requires authentication', async () => {
  assert.equal((await fetch(`${base}/ccx/api/v1/t/periods`)).status, 401);
  assert.equal((await fetch(`${base}/ccx/api/v1/t/periods`, { headers: { Authorization: 'Bearer forged.token' } })).status, 401);
});
test('periods: 36, filters work', async () => {
  const j = await (await get('periods')).json(); assert.equal(j.total, 36); assert.equal(j.limit, undefined);
  assert.equal((await (await get('periods', { fiscalYear: 2025, status: 'Closed' })).json()).total, 12);
});
test('every journal balances and paging returns each exactly once', async () => {
  const all = (await (await get('journals')).json()).data; assert.equal(all.length, 600);
  for (const j of all) { assert.ok(Math.abs(j.totalDebit - j.totalCredit) < 0.011); assert.equal(j.lineCount, j.lines.length); }
  const ids = []; for (let off = 0; off < 600; off += 70) ids.push(...(await (await get('journals', { limit: 70, offset: off })).json()).data.map(x => x.journalId));
  assert.deepEqual(ids, all.map(x => x.journalId));
});
test('trial balance nets to zero per company and period', async () => {
  const rows = (await (await get('balances')).json()).data, sums = {};
  for (const r of rows) sums[r.companyId + r.periodId] = (sums[r.companyId + r.periodId] || 0) + r.closingBalance;
  for (const v of Object.values(sums)) assert.ok(Math.abs(v) < 0.05);
});
test('fx, assets and depreciation are served', async () => {
  const fx = await (await get('fx-rates')).json(); assert.deepEqual([...new Set(fx.data.map(r => r.rateType))].sort(), ['Average', 'Closing', 'Spot']);
  assert.ok((await (await get('assets')).json()).total > 200); assert.ok((await (await get('asset-depreciation', { period: '2026-08' })).json()).total > 100);
});
test('bad input gives 400, not a crash', async () => {
  assert.equal((await get('journals', { period: '1999-01' })).status, 400); assert.equal((await get('journals', { from: 'x' })).status, 400);
});
test('SOAP: unpaged vs paged totals and Total_Pages', async () => {
  const all = await soap('Get_Journals'); assert.equal(all.status, 200); assert.equal(num(all.text, 'Total_Results'), 600); assert.equal(all.text.split('<wd:Journal>').length - 1, 600);
  const p = await soap('Get_Journals', '', '<wd:Response_Filter><wd:Page>2</wd:Page><wd:Count>100</wd:Count></wd:Response_Filter>');
  assert.equal(num(p.text, 'Total_Pages'), 6); assert.equal(num(p.text, 'Page'), 2); assert.equal(num(p.text, 'Page_Results'), 100);
  assert.equal((await soap('Get_Journals', '', '<wd:Response_Filter><wd:Page>99</wd:Page><wd:Count>100</wd:Count></wd:Response_Filter>')).status, 500);
});
test('SOAP: every operation answers, placeholders mean no filter, bad period faults', async () => {
  for (const op of ['Get_Periods', 'Get_Journals', 'Get_Journal_Lines', 'Get_Trial_Balance', 'Get_Currency_Rates', 'Get_Assets', 'Get_Asset_Depreciation']) assert.equal((await soap(op)).status, 200, op);
  assert.equal(num((await soap('Get_Journals', '<wd:Period>string</wd:Period>')).text, 'Total_Results'), 600);
  const f = await soap('Get_Journals', '<wd:Period>1999-01</wd:Period>'); assert.equal(f.status, 500); assert.match(f.text, /<faultstring>/);
});
test('report formats', async () => {
  const h = { headers: { Authorization: 'Basic YTpi' } };
  assert.match(await (await fetch(`${base}/ccx/service/customreport2/t/o/Trial_Balance?format=csv&period=2026-03`, h)).text(), /^Company_ID,/);
  assert.ok((await (await fetch(`${base}/ccx/service/customreport2/t/o/Periods?format=json&limit=3`, h)).json()).Report_Entry.length === 3);
  assert.match(await (await fetch(`${base}/ccx/service/customreport2/t/o/FX_Rates?format=simplexml&limit=1`, h)).text(), /<wd:Report_Entry>/);
});
test('simulate=429 sends Retry-After', async () => { assert.equal((await get('periods', { simulate: 429 })).headers.get('retry-after'), '1'); });
test('WSDL is served and well-formed', async () => {
  const t = await (await fetch(`${base}/ccx/service/t/Financial_Management/v1`)).text(); assert.match(t, /<wsdl:definitions/); assert.equal((t.match(/<wsdl:operation name="Get_/g) || []).length, 14);
});
