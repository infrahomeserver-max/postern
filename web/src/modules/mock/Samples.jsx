import { useState } from 'react';
import { useDocs, docsChanged } from '../../api.js';
import { Icon, useToast, Spinner } from '../../ui.jsx';

const ROOT = `${location.origin}/sample/workday`;
const ENDPOINTS = [
  ['Periods', 'periods', 'Fiscal calendar, status Open/Closed'],
  ['Transactions', 'journals · transactions', 'Journals with lines, or flat transaction lines'],
  ['Balances', 'balances', 'Trial balance by company, account and period'],
  ['FX', 'fx-rates', 'Spot (daily), Average and Closing (monthly)'],
  ['Fixed assets', 'assets · asset-depreciation', 'Register with NBV, and monthly depreciation'],
];

export default function Samples() {
  const toast = useToast(); const cols = useDocs('collection'); const envs = useDocs('environment');
  const [busy, setBusy] = useState(false);
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copied', 'success'));
  const setup = async () => {
    setBusy(true);
    try {
      const { fromPostman, envFromPostman, importText } = await import('../api/convert.js');
      const get = async (u, text) => { const r = await fetch(u); if (!r.ok) throw new Error('Could not load ' + u); return text ? r.text() : r.json(); };
      const rest = fromPostman(await get(`${ROOT}/postman/collection.json?soap=0`));
      rest.name = 'Workday-style dummy ERP (REST + reports)';
      const wsdlUrl = `${ROOT}/ccx/service/dummy/Financial_Management/v1`;
      const soap = (await importText(await get(wsdlUrl, true), { baseUrl: wsdlUrl })).data;
      soap.name = 'Workday-style dummy ERP (SOAP)';
      const withAuth = (items) => items.forEach(it => { if (it.type === 'folder') withAuth(it.items); else it.auth = { ...(it.auth || {}), type: 'basic', basic: { username: '{{clientId}}', password: '{{clientSecret}}' } }; });
      withAuth(soap.items);
      const env = envFromPostman(await get(`${ROOT}/postman/environment.json`));
      await cols.save(rest, { immediate: true }); await cols.save(soap, { immediate: true }); await envs.save(env, { immediate: true }); docsChanged('collection'); docsChanged('environment');
      try { localStorage.setItem('dh.env', env.id); const m = JSON.parse(localStorage.getItem('dh.envByColl') || '{}'); m[rest.id] = env.id; m[soap.id] = env.id; localStorage.setItem('dh.envByColl', JSON.stringify(m)); } catch { /* private mode */ } dispatchEvent(new CustomEvent('postern:env-chosen', { detail: env.id })); // pick it so {{baseUrl}} etc. resolve straight away
      toast('Added 2 collections and an environment. The environment is already selected: run “Get token”, then any request.', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="grow" style={{ overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 4px' }}>Workday-style dummy ERP</h2>
        <p className="muted" style={{ marginTop: 0 }}>A ready-made test server with <b>generated dummy data</b> (no real data, not Workday) for building and testing extractors: REST, report (RaaS-style) and SOAP, each with optional pagination.</p>
        <div className="row" style={{ gap: 8, margin: '12px 0' }}>
          <button className="btn primary" onClick={setup} disabled={busy}>{busy ? <Spinner /> : <Icon n="plus" s={13} />} Add to my workspace</button>
          <a className="btn" style={{ textDecoration: 'none', color: 'inherit' }} href={`${ROOT}/postman/collection.json`} download="workday-dummy.postman_collection.json"><Icon n="download" s={13} />Postman collection</a>
          <a className="btn" style={{ textDecoration: 'none', color: 'inherit' }} href={`${ROOT}/ccx/service/dummy/Financial_Management/v1`} target="_blank" rel="noreferrer"><Icon n="code" s={13} />WSDL</a>
        </div>
        <div className="row" style={{ gap: 8, marginBottom: 14 }}><span className="muted">Base URL</span><code className="mono chip">{ROOT}</code><button className="btn sm ghost" onClick={() => copy(ROOT)}>Copy</button></div>
        <section style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <b>Extractors</b>
          <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}><tbody>{ENDPOINTS.map(([a, b, c]) => <tr key={a}><td style={{ padding: '4px 0', width: 110 }}><b>{a}</b></td><td className="mono muted" style={{ width: 230 }}>{b}</td><td>{c}</td></tr>)}</tbody></table>
        </section>
        <section style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 14, lineHeight: 1.7 }}>
          <b>How to call it</b>
          <div className="muted">Sign-in: <code>POST /ccx/oauth2/&lt;tenant&gt;/token</code> with <code>grant_type=client_credentials</code> and any client id/secret returns a Bearer token. Basic auth with any credentials also works; SOAP also accepts a WS-Security UsernameToken.</div>
          <div className="muted">REST: <code>/ccx/api/v1/&lt;tenant&gt;/periods | journals | transactions | balances | fx-rates | assets | asset-depreciation</code>, returns <code>{'{ total, data }'}</code>.</div>
          <div className="muted">Reports: <code>/ccx/service/customreport2/&lt;tenant&gt;/&lt;owner&gt;/&lt;Report&gt;?format=json|csv|simplexml</code>.</div>
          <div className="muted">SOAP: <code>/ccx/service/&lt;tenant&gt;/Financial_Management/v1</code> (GET for the WSDL). Operations: Get_Periods, Get_Journals, Get_Journal_Lines, Get_Trial_Balance, Get_Currency_Rates, Get_Assets, Get_Asset_Depreciation.</div>
          <div className="muted"><b>Pagination is optional.</b> REST/reports: <code>limit</code> + <code>offset</code> (or <code>page</code>). SOAP: <code>Response_Filter</code> with <code>Page</code>/<code>Count</code>, results report Total_Results and Total_Pages. Leave them off to get everything.</div>
          <div className="muted">Filters: <code>period</code> (2026-03 or FY2026-P03), <code>company</code> (US01, UK01, DE01, IN01), <code>status</code>, <code>from</code>/<code>to</code>, <code>account</code>, <code>rateType</code>, <code>quote</code>, <code>asOf</code>, <code>assetClass</code>.</div>
          <div className="muted">Test helpers: <code>rows=N</code> sets the data volume (10–20000 journals), <code>simulate=429|500|503|401|timeout</code> and <code>latency=ms</code> exercise retry and timeout handling. Data is deterministic, so repeated runs give the same results.</div>
        </section>
        <p className="muted">The shapes follow Workday's public conventions but are not guaranteed to match your tenant; compare with your real WSDL and reports before relying on field names.</p>
      </div>
    </div>
  );
}
