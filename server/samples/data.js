// Deterministic dummy finance data for the Workday-style sample server. Nothing here is real or derived from any real tenant.
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export const COMPANIES = [
  { company_id: 'US01', name: 'Acme Holdings Inc', country: 'US', currency: 'USD' },
  { company_id: 'UK01', name: 'Acme UK Ltd', country: 'GB', currency: 'GBP' },
  { company_id: 'DE01', name: 'Acme GmbH', country: 'DE', currency: 'EUR' },
  { company_id: 'IN01', name: 'Acme India Pvt Ltd', country: 'IN', currency: 'INR' },
];
const CUR_SCALE = { USD: 1, GBP: 0.8, EUR: 0.9, INR: 80 };
export const ACCOUNTS = [
  ['1000', 'Cash and Equivalents', 'Asset', 'D'], ['1100', 'Accounts Receivable', 'Asset', 'D'], ['1200', 'Prepaid Expenses', 'Asset', 'D'],
  ['1500', 'Fixed Assets - Cost', 'Asset', 'D'], ['1590', 'Accumulated Depreciation', 'Asset', 'C'], ['2000', 'Accounts Payable', 'Liability', 'C'],
  ['2100', 'Accrued Expenses', 'Liability', 'C'], ['2200', 'Tax Payable', 'Liability', 'C'], ['2300', 'Payroll Liabilities', 'Liability', 'C'],
  ['3000', 'Retained Earnings', 'Equity', 'C'], ['4000', 'Product Revenue', 'Revenue', 'C'], ['4100', 'Service Revenue', 'Revenue', 'C'],
  ['5000', 'Cost of Goods Sold', 'Expense', 'D'], ['6000', 'Salaries and Wages', 'Expense', 'D'], ['6100', 'Rent', 'Expense', 'D'],
  ['6200', 'Software and Subscriptions', 'Expense', 'D'], ['6300', 'Travel and Entertainment', 'Expense', 'D'], ['6400', 'Professional Fees', 'Expense', 'D'],
  ['6500', 'Depreciation Expense', 'Expense', 'D'], ['6900', 'FX Gain/Loss', 'Expense', 'D'],
].map(([account_id, name, type, normal_side]) => ({ account_id, name, type, normal_side }));
const ACC = Object.fromEntries(ACCOUNTS.map(a => [a.account_id, a]));
const CC = ['CC100', 'CC200', 'CC300', 'CC400'];
export const COST_CENTERS = { CC100: 'Sales', CC200: 'Engineering', CC300: 'General & Admin', CC400: 'Operations' };

/* ---- periods: monthly, FY = calendar year, FY2024..FY2026 ---- */
export const PERIODS = [];
for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  const end = iso(y, m, lastDay(y, m)); const idx = (y - 2024) * 12 + m;
  PERIODS.push({ period_id: `FY${y}-P${pad(m)}`, key: `${y}-${pad(m)}`, name: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`,
    fiscal_year: y, period_number: m, quarter: `Q${Math.ceil(m / 3)}`, start_date: iso(y, m, 1), end_date: end,
    status: idx <= 32 ? 'Closed' : idx <= 34 ? 'Open' : 'Not Opened' });
}
const ACTIVE = PERIODS.filter(p => p.status !== 'Not Opened'); // journals exist through Oct 2026
export const periodByRef = (ref) => PERIODS.find(p => p.period_id === ref || p.key === ref) || null;

/* ---- FX: USD base, daily spot + monthly average/closing ---- */
const FX_BASE = { EUR: 0.92, GBP: 0.79, INR: 83, JPY: 148, CAD: 1.35, AUD: 1.52 };
let fxCache = null;
export function fxRates() {
  if (fxCache) return fxCache;
  const rnd = mulberry(7), rows = [], byMonth = {};
  for (const [q, base] of Object.entries(FX_BASE)) {
    let r = base; const start = Date.UTC(2024, 0, 1), end = Date.UTC(2026, 9, 31);
    for (let t = start; t <= end; t += 86400000) {
      r = Math.max(base * 0.8, Math.min(base * 1.2, r * (1 + (rnd() - 0.5) * 0.008)));
      const d = new Date(t), date = iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), pk = date.slice(0, 7);
      const dp = Number(r.toFixed(q === 'JPY' || q === 'INR' ? 3 : 5));
      rows.push({ rate_type: 'Spot', base_currency: 'USD', quote_currency: q, rate_date: date, period: pk, rate: dp, inverse_rate: Number((1 / dp).toFixed(6)) });
      (byMonth[q + pk] ||= []).push(dp);
    }
  }
  for (const [k, v] of Object.entries(byMonth)) {
    const q = k.slice(0, 3), pk = k.slice(3), [y, m] = pk.split('-').map(Number), d = iso(y, m, lastDay(y, m));
    const avg = Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(5)), cl = v[v.length - 1];
    rows.push({ rate_type: 'Average', base_currency: 'USD', quote_currency: q, rate_date: d, period: pk, rate: avg, inverse_rate: Number((1 / avg).toFixed(6)) });
    rows.push({ rate_type: 'Closing', base_currency: 'USD', quote_currency: q, rate_date: d, period: pk, rate: cl, inverse_rate: Number((1 / cl).toFixed(6)) });
  }
  rows.sort((a, b) => a.rate_date.localeCompare(b.rate_date) || a.quote_currency.localeCompare(b.quote_currency) || a.rate_type.localeCompare(b.rate_type));
  return (fxCache = rows);
}
const avgRate = (cur, pk) => { if (cur === 'USD') return 1; const r = fxRates().find(x => x.rate_type === 'Average' && x.quote_currency === cur && x.period === pk); return r ? r.rate : 1; };

/* ---- journals ---- */
const SOURCES = ['Manual Journal', 'Supplier Invoice', 'Customer Invoice', 'Payroll', 'Expense Report', 'Asset Depreciation', 'Accrual', 'Intercompany'];
const TEMPLATES = [
  { memo: 'Customer invoice', src: 'Customer Invoice', w: 24, lines: (a) => [['1100', a, 0], ['4000', 0, a * 0.7], ['4100', 0, a * 0.2], ['2200', 0, a * 0.1]] },
  { memo: 'Customer receipt', src: 'Customer Invoice', w: 14, lines: (a) => [['1000', a, 0], ['1100', 0, a]] },
  { memo: 'Supplier invoice', src: 'Supplier Invoice', w: 18, lines: (a) => [['6400', a * 0.4, 0], ['6200', a * 0.5, 0], ['2200', a * 0.1, 0], ['2000', 0, a]] },
  { memo: 'Supplier payment', src: 'Supplier Invoice', w: 12, lines: (a) => [['2000', a, 0], ['1000', 0, a]] },
  { memo: 'Payroll run', src: 'Payroll', w: 8, lines: (a) => [['6000', a, 0], ['2300', 0, a * 0.25], ['1000', 0, a * 0.75]] },
  { memo: 'Expense report', src: 'Expense Report', w: 8, lines: (a) => [['6300', a, 0], ['2100', 0, a]] },
  { memo: 'Rent', src: 'Accrual', w: 5, lines: (a) => [['6100', a, 0], ['1200', 0, a]] },
  { memo: 'Cost of goods', src: 'Manual Journal', w: 6, lines: (a) => [['5000', a, 0], ['1200', 0, a]] },
  { memo: 'Monthly depreciation', src: 'Asset Depreciation', w: 3, lines: (a) => [['6500', a, 0], ['1590', 0, a]] },
  { memo: 'FX revaluation', src: 'Manual Journal', w: 2, lines: (a) => [['6900', a * 0.05, 0], ['1100', 0, a * 0.05]] },
];
const TOTAL_W = TEMPLATES.reduce((s, t) => s + t.w, 0);
const cache = new Map();
const lru = (key, make) => { if (cache.has(key)) return cache.get(key); const v = make(); cache.set(key, v); if (cache.size > 4) cache.delete(cache.keys().next().value); return v; };

export function journals(count = 600) {
  return lru('j' + count, () => {
    const rnd = mulberry(42), out = [];
    for (let i = 1; i <= count; i++) {
      const comp = COMPANIES[Math.floor(rnd() ** 1.6 * COMPANIES.length)], per = ACTIVE[Math.floor(rnd() * ACTIVE.length)];
      let pick = rnd() * TOTAL_W, tpl = TEMPLATES[0]; for (const t of TEMPLATES) { if ((pick -= t.w) < 0) { tpl = t; break; } }
      const amt = r2((200 + rnd() * rnd() * 90000) * CUR_SCALE[comp.currency]);
      const raw = tpl.lines(amt).map(([acct, d, c]) => [acct, r2(d), r2(c)]);
      const dr = r2(raw.reduce((s, l) => s + l[1], 0)), cr = r2(raw.reduce((s, l) => s + l[2], 0));
      const diff = r2(dr - cr); if (diff !== 0) { const l = raw.find(x => (diff > 0 ? x[2] : x[1]) > 0 && x[0] !== '2200') || raw[raw.length - 1]; if (diff > 0) l[2] = r2(l[2] + diff); else l[1] = r2(l[1] - diff); }
      const day = 1 + Math.floor(rnd() * lastDay(per.fiscal_year, per.period_number)), st = rnd();
      const status = per.status === 'Open' ? (st < 0.7 ? 'Posted' : st < 0.88 ? 'Approved' : 'In Progress') : (st < 0.96 ? 'Posted' : 'Approved');
      const jid = 'JE-' + pad(i, 6), date = iso(per.fiscal_year, per.period_number, day), cc = CC[Math.floor(rnd() * CC.length)];
      const lines = raw.map(([a, d, c], n) => ({ line_number: n + 1, account_id: a, account_name: ACC[a].name, debit: d, credit: c, cost_center: ACC[a].type === 'Expense' ? cc : '', memo: `${tpl.memo} ${jid}` }));
      out.push({ journal_id: jid, company_id: comp.company_id, ledger: 'Actuals', period_id: per.period_id, accounting_date: date, status, source: tpl.src, currency: comp.currency,
        memo: `${tpl.memo} ${jid}`, total_debit: r2(lines.reduce((s, l) => s + l.debit, 0)), total_credit: r2(lines.reduce((s, l) => s + l.credit, 0)), line_count: lines.length, created_by: 'dummy.user' + (1 + Math.floor(rnd() * 5)), lines });
    }
    out.sort((a, b) => a.accounting_date.localeCompare(b.accounting_date) || a.journal_id.localeCompare(b.journal_id));
    return out;
  });
}
export function journalLines(count) {
  return lru('jl' + count, () => journals(count).flatMap(j => j.lines.map(l => ({ journal_id: j.journal_id, company_id: j.company_id, ledger: j.ledger, period_id: j.period_id, accounting_date: j.accounting_date, status: j.status, source: j.source, currency: j.currency, ...l }))));
}

/* ---- trial balance (posted journals only), by company / account / period ---- */
export function balances(count) {
  return lru('b' + count, () => {
    const act = new Map(); // company|acct|period -> [dr, cr]
    for (const j of journals(count)) if (j.status === 'Posted') for (const l of j.lines) { const k = `${j.company_id}|${l.account_id}|${j.period_id}`; const v = act.get(k) || [0, 0]; v[0] += l.debit; v[1] += l.credit; act.set(k, v); }
    const rows = [];
    for (const comp of COMPANIES) {
      const open = Object.fromEntries(ACCOUNTS.map(a => [a.account_id, 0])); // signed: debit - credit
      for (const p of ACTIVE) {
        if (p.period_number === 1) { // year end: P&L accounts close into Retained Earnings
          for (const a of ACCOUNTS) if (a.type === 'Revenue' || a.type === 'Expense') { open['3000'] += open[a.account_id]; open[a.account_id] = 0; }
        }
        for (const a of ACCOUNTS) {
          const [dr, cr] = act.get(`${comp.company_id}|${a.account_id}|${p.period_id}`) || [0, 0];
          const o = open[a.account_id], close = o + dr - cr;
          if (dr || cr || Math.abs(o) > 0.004) {
            const rate = avgRate(comp.currency, p.key);
            rows.push({ company_id: comp.company_id, currency: comp.currency, period_id: p.period_id, fiscal_year: p.fiscal_year, account_id: a.account_id, account_name: a.name, account_type: a.type,
              opening_balance: r2(o), debit: r2(dr), credit: r2(cr), closing_balance: r2(close), usd_rate: Number((1 / rate).toFixed(6)), closing_balance_usd: r2(close / (comp.currency === 'USD' ? 1 : rate)) });
          }
          open[a.account_id] = close;
        }
      }
    }
    return rows;
  });
}

/* ---- fixed assets ---- */
const CLASSES = [
  { c: 'Buildings', life: 480, lo: 400000, hi: 3000000, salv: 0.1, names: ['Office building', 'Warehouse', 'Leasehold improvements'] },
  { c: 'Machinery', life: 120, lo: 20000, hi: 400000, salv: 0.05, names: ['CNC machine', 'Packaging line', 'Forklift', 'Generator'] },
  { c: 'Computers', life: 36, lo: 800, hi: 6000, salv: 0, names: ['Laptop', 'Workstation', 'Server', 'Network switch'] },
  { c: 'Vehicles', life: 60, lo: 15000, hi: 90000, salv: 0.15, names: ['Delivery van', 'Company car', 'Truck'] },
  { c: 'Furniture', life: 84, lo: 300, hi: 15000, salv: 0, names: ['Desk set', 'Conference table', 'Office chairs'] },
];
const PRE = { fiscal_year: 2023, period_number: 12, end_date: '2023-12-31' }; // the period before the first one
const monthsBetween = (y1, m1, y2, m2) => (y2 - y1) * 12 + (m2 - m1);
export function assets(count) {
  const n = Math.max(20, Math.min(5000, Math.round(count * 0.4)));
  return lru('a' + n, () => {
    const rnd = mulberry(99), out = [];
    for (let i = 1; i <= n; i++) {
      const cl = CLASSES[Math.floor(rnd() ** 1.4 * CLASSES.length)], comp = COMPANIES[Math.floor(rnd() * COMPANIES.length)];
      const y = 2019 + Math.floor(rnd() * 8), m = 1 + Math.floor(rnd() * 12); const yy = y === 2026 && m > 8 ? 8 : y;
      const cost = r2((cl.lo + rnd() * (cl.hi - cl.lo)) * CUR_SCALE[comp.currency]), salvage = r2(cost * cl.salv);
      const disp = rnd() < 0.06 ? 1 + Math.floor(rnd() * 24) : 0; // disposed N months after in-service
      const d = 1 + Math.floor(rnd() * 27), name = cl.names[Math.floor(rnd() * cl.names.length)];
      const a = { asset_id: 'FA-' + pad(i, 5), description: `${name} #${i}`, asset_class: cl.c, company_id: comp.company_id, currency: comp.currency, cost_center: CC[Math.floor(rnd() * CC.length)],
        acquisition_date: iso(yy, m, d), in_service_date: iso(yy, m, d), cost, salvage_value: salvage, useful_life_months: cl.life, depreciation_method: 'Straight Line', location: ['HQ', 'Plant 1', 'Branch', 'Warehouse'][Math.floor(rnd() * 4)], disposal_date: '' };
      if (disp) { const t = new Date(Date.UTC(yy, m - 1 + disp, d)); if (t <= Date.UTC(2026, 8, 30)) a.disposal_date = iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
      out.push(a);
    }
    return out;
  });
}
/* depreciation as of the END of a period (monthly, first full month after in-service) */
export function depreciation(a, per) {
  const [y, m] = a.in_service_date.split('-').map(Number);
  let months = monthsBetween(y, m, per.fiscal_year, per.period_number); // full months elapsed through end of `per`
  if (a.disposal_date) { const [dy, dm] = a.disposal_date.split('-').map(Number); months = Math.min(months, monthsBetween(y, m, dy, dm)); }
  months = Math.max(0, Math.min(months, a.useful_life_months));
  const perMonth = (a.cost - a.salvage_value) / a.useful_life_months;
  const accumulated = r2(perMonth * months);
  const disposed = a.disposal_date && a.disposal_date <= per.end_date;
  const status = disposed ? 'Disposed' : months >= a.useful_life_months ? 'Fully Depreciated' : months > 0 || a.in_service_date <= per.end_date ? 'In Service' : 'Not In Service';
  return { months, monthly: r2(perMonth), accumulated, nbv: disposed ? 0 : r2(a.cost - accumulated), status };
}
export function assetsAsOf(count, per) {
  return assets(count).filter(a => a.in_service_date <= per.end_date).map(a => { const d = depreciation(a, per); return { ...a, as_of_period: per.period_id, accumulated_depreciation: d.accumulated, net_book_value: d.nbv, status: d.status }; });
}
export function assetDepreciationRows(count, per) {
  return assets(count).filter(a => a.in_service_date <= per.end_date).map(a => {
    const cur = depreciation(a, per), prevPer = PERIODS[PERIODS.indexOf(per) - 1], prev = prevPer ? depreciation(a, prevPer) : { accumulated: 0 };
    return { asset_id: a.asset_id, description: a.description, asset_class: a.asset_class, company_id: a.company_id, currency: a.currency, cost_center: a.cost_center, period_id: per.period_id,
      depreciation_expense: r2(cur.accumulated - prev.accumulated), accumulated_depreciation: cur.accumulated, net_book_value: cur.nbv, status: cur.status };
  });
}
export function depreciationSchedule(a) {
  const [y, m] = a.in_service_date.split('-').map(Number); let prev = depreciation(a, PRE).accumulated; const out = [];
  for (const p of PERIODS) {
    if (monthsBetween(y, m, p.fiscal_year, p.period_number) <= 0) continue;
    const d = depreciation(a, p), exp = r2(d.accumulated - prev); prev = d.accumulated;
    if (exp > 0) out.push({ asset_id: a.asset_id, period_id: p.period_id, depreciation_expense: exp, accumulated_depreciation: d.accumulated, net_book_value: d.nbv, status: d.status });
  }
  return out;
}
