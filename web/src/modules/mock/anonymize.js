// Turn a real JSON/XML sample into a mock body with the SAME STRUCTURE and FAKE VALUES.
// Pure functions, no network, no DOM: runs in the browser so the real sample never leaves the page.
//
//   anonymize(text, { keep: ['status','currency'], maxItems: 3 }) -> { kind, output, stats, leaks }
//
// Rules
//  * Keys / element names / structure are kept (that is what a mock needs). Values are replaced.
//  * Same real value -> same fake value inside one run, so ids that link records still link.
//  * Format is kept: 4-digit stays 4-digit, "AB-123" stays "XX-999", dates stay dates, emails stay emails.
//  * Booleans / null / xmlns / xsi: attributes / the "keep" fields are left alone.
//  * Arrays are cut to `maxItems`; XML comments are dropped.
//  * A leak check then searches the output for every original value (len >= 4) and reports any that survived.

const WORDS = 'account balance billing budget client contract coverage credit customer delivery department expense invoice ledger payment payroll period policy product project purchase quarterly receipt region report review service shipment standard supplier support tax transfer vendor warehouse annual approved central corporate current domestic general global internal monthly national primary regional regular revised scheduled special pending final open'.split(' ');
const FIRST = ['Olivia', 'Liam', 'Priya', 'Mateo', 'Aisha', 'Noah', 'Mei', 'Lucas', 'Sofia', 'Arjun', 'Emma', 'Omar', 'Hannah', 'Diego', 'Yuki', 'Daniel'];
const LAST = ['Smith', 'Patel', 'Garcia', 'Nguyen', 'Johnson', 'Kim', 'Rossi', 'Okafor', 'Schmidt', 'Silva', 'Brown', 'Khan', 'Martin', 'Tanaka', 'Anderson', 'Lopez'];
const COMPANY = ['Acme Corporation', 'Globex Ltd', 'Initech Systems', 'Umbrella Logistics', 'Hooli Inc', 'Stark Industries', 'Wayne Supplies', 'Soylent GmbH', 'Northwind Traders', 'Contoso Ltd', 'Fabrikam Inc', 'Tailspin Toys'];
const LABELS = ['Operating Expenses', 'Corporate Marketing', 'Travel and Entertainment', 'Professional Services', 'Cloud Hosting', 'Office Supplies', 'Regional Sales', 'Customer Support', 'Research and Development', 'Facilities', 'Software Licences', 'Accounts Payable'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'CAD', 'AUD', 'CHF', 'SGD', 'SEK', 'NOK', 'DKK', 'NZD', 'ZAR', 'BRL', 'MXN', 'CNY', 'HKD', 'AED', 'PLN'];
const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'IN', 'CA', 'AU', 'JP', 'NL', 'SE', 'ES', 'IT', 'BR', 'SG', 'IE', 'CH'];
const PREFIX = [[/invoice|bill/, ['INV']], [/order|sales/, ['SO']], [/purchase|po\b/, ['PO']], [/journal/, ['JE']], [/employee|worker|person|staff/, ['EMP']], [/supplier|vendor/, ['SUP']], [/customer|client/, ['CUS']], [/company|entity/, ['COMP']], [/account|ledger/, ['ACC']], [/asset/, ['FA']], [/project/, ['PRJ']], [/ticket|incident|case/, ['INC']]];
const CITY = ['Springfield', 'Rivertown', 'Lakeside', 'Fairview', 'Oakdale', 'Maplewood'];

function rng(seed) { // small deterministic PRNG so output is repeatable for the same input
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function makeFaker(salt) {
  const memo = new Map();
  const mem = (kind, orig, make) => {
    const k = kind + '\u0000' + orig;
    if (!memo.has(k)) { let v; for (let t = 0; t < 8; t++) { v = make(rng(hash(k + salt + t))); if (String(v).toLowerCase() !== String(orig).toLowerCase()) break; } memo.set(k, v); }   // never hand back the real value
    return memo.get(k);
  };
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const digit = (r) => String(Math.floor(r() * 10));
  const hex = (r, n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
  const letter = (r, up) => { const c = String.fromCharCode(97 + Math.floor(r() * 26)); return up ? c.toUpperCase() : c; };

  // same shape: digits->digits, letters->letters (case kept), everything else kept
  const shape = (r, s) => s.replace(/[0-9]/g, () => digit(r)).replace(/[a-z]/g, () => letter(r, false)).replace(/[A-Z]/g, () => letter(r, true));
  // words of similar length for free text
  const text = (r, s) => s.replace(/[A-Za-zÀ-ɏ]+/g, (w) => {
    const c = WORDS.filter(x => Math.abs(x.length - w.length) <= 2); let o = pick(r, c.length ? c : WORDS);
    if (w === w.toUpperCase() && w.length > 1) o = o.toUpperCase(); else if (w[0] === w[0].toUpperCase()) o = o[0].toUpperCase() + o.slice(1);
    return o;
  }).replace(/[0-9]/g, () => digit(r));

  const isDateish = (s) => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  function str(orig, hint = '') {
    const s = String(orig); if (!s.trim()) return s;
    const h = hint.toLowerCase();
    return mem('s', s, (r) => {
      if (/^[0-9a-f]{32}$/i.test(s) || /(^|[^a-z])wid([^a-z]|$)/.test(h)) return hex(r, 32);      // Workday WID: 32 hex characters
      if (/^[A-Z]{3}$/.test(s) && (/(curr|ccy)/.test(h) || CURRENCIES.includes(s))) return pick(r, CURRENCIES); // real ISO 4217 codes stay real
      if (/^[A-Z]{2}$/.test(s) && (/(country|nation|region)/.test(h) || COUNTRIES.includes(s))) return pick(r, COUNTRIES);
      if (/^[A-Za-z]{2,6}[-_/]\d{2,}$/.test(s) && !/(token|secret)/.test(h)) { // "FVB-190" -> "INV-48210": a plausible prefix for the field, same digit count
        const pre = (PREFIX.find(([re]) => re.test(h)) || [null, ['REF', 'DOC', 'TXN', 'ID']])[1]; const sep = s.match(/[-_/]/)[0];
        return pick(r, pre) + sep + s.split(/[-_/]/)[1].replace(/\d/g, (c, k) => (k === 0 ? String(1 + Math.floor(r() * 9)) : digit(r))); }
      if (/(descriptor|display.?name|refname)/.test(h) && /^[\p{L}][\p{L}.'-]+( [\p{L}][\p{L}.'-]+){1,2}$/u.test(s) && !/\d/.test(s)) return /^[A-Z][a-z]+ [A-Z][a-z'-]+$/.test(s) ? `${pick(r, FIRST)} ${pick(r, LAST)}` : pick(r, LABELS);   // Workday / NetSuite label: a person or a business label
      if (/(object|account|ledger|cost.?center|department|organi[sz]ation|project|product|item|position|job|location|category|group|label|title)/.test(h) && !/(first|last|user|employee|worker|person|customer)/.test(h) && /^[\p{L}0-9 &.,'()/-]+$/u.test(s) && s.length < 70 && /\s|^[A-Z][a-z]/.test(s) && !/id$/.test(h)) return pick(r, LABELS);
      if (isUuid(s)) return [hex(r, 8), hex(r, 4), '4' + hex(r, 3), '8' + hex(r, 3), hex(r, 12)].join('-');
      if (isDateish(s)) { // keep the exact format, move to a random valid day in 2020-2024 and a valid time
        const p = (n) => String(n).padStart(2, '0');
        const m = /^\d{4}-\d{2}-\d{2}(?:([T ])\d{2}:\d{2}(?::\d{2})?(\.\d+)?(.*))?$/.exec(s);
        let o = `${2020 + Math.floor(r() * 5)}-${p(1 + Math.floor(r() * 12))}-${p(1 + Math.floor(r() * 28))}`;
        if (m[1]) { const hasSec = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(s); o += m[1] + p(Math.floor(r() * 24)) + ':' + p(Math.floor(r() * 60)) + (hasSec ? ':' + p(Math.floor(r() * 60)) : '') + (m[2] ? m[2].replace(/\d/g, () => digit(r)) : '') + (m[3] || ''); }
        return o;
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `${pick(r, FIRST).toLowerCase()}.${hex(r, 3)}@example.com`;
      if (/^https?:\/\//i.test(s)) { const u = s.match(/^(https?):\/\/[^/?#]+(.*)$/i); return `${u[1]}://example.com` + (u[2] ? shape(r, u[2]) : ''); }
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return `192.0.2.${1 + Math.floor(r() * 253)}`;
      if (/^[+()\d][\d\s().-]{6,}$/.test(s)) return shape(r, s); // phone-like
      if (/^(eyJ[\w-]+\.){2}[\w-]*$/.test(s)) return 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJtb2NrIn0.'; // JWT
      if (/(^|[^a-z])(e?mail)/.test(h)) return `${pick(r, FIRST).toLowerCase()}.${hex(r, 3)}@example.com`;
      if (/(first.?name|given)/.test(h)) return pick(r, FIRST);
      if (/(^|[^a-z])(country|nation)/.test(h) && /^[A-Za-z .]{3,}$/.test(s)) return pick(r, ['United States', 'Germany', 'India', 'Canada', 'Japan', 'France', 'Australia', 'Brazil']);
      if (/(last.?name|surname|family)/.test(h)) return pick(r, LAST);
      if (/(^|[^a-z])(name|fullname|employee|manager|user|owner|contact|customer|person|author)([^a-z]|$)/.test(h) && /^[\p{L} .'-]+$/u.test(s) && s.length < 60) return `${pick(r, FIRST)} ${pick(r, LAST)}`;
      if (/(company|org|vendor|supplier|tenant|employer|legal.?entity|client)/.test(h) && !/id$/.test(h)) return pick(r, COMPANY);
      if (/(city|town)/.test(h)) return pick(r, CITY);
      if (/(street|address|addr)/.test(h)) return `${1 + Math.floor(r() * 998)} ${pick(r, WORDS)} street`.replace(/^(\d+) (\w)/, (_, n, c) => n + ' ' + c.toUpperCase());
      if (/(token|secret|password|passwd|apikey|api.?key|signature|hash)/.test(h)) return 'REDACTED-' + hex(r, 8);
      if (/^[A-Za-z0-9+/=_-]{24,}$/.test(s) && !/\s/.test(s)) return shape(r, s); // opaque tokens / ids
      if (/\s/.test(s) || /^[A-Za-zÀ-ɏ]+$/.test(s)) return text(r, s);
      return shape(r, s); // ids, codes, mixed alphanumerics
    });
  }
  function num(orig) {
    const s = typeof orig === 'number' ? numToStr(orig) : String(orig);
    if (/^-?\d$/.test(s) || /^-?0(\.0+)?$/.test(s)) return orig; // single digits / zero are structural (flags, counts), keep
    return mem('n', s, (r) => {
      const out = s.replace(/\d/g, (c, i) => (i === 0 || s[i - 1] === '-' ? String(1 + Math.floor(r() * 9)) : digit(r)));
      return typeof orig === 'number' ? Number(out) : out;
    });
  }
  return { str, num };
}
// JS may print 1e21 etc.; keep plain digits for the shape logic
const numToStr = (n) => (Math.abs(n) < 1e21 ? String(n) : n.toFixed(0));

/* ---------- JSON ---------- */
function walkJson(v, f, ctx, key = '') {
  if (Array.isArray(v)) return v.slice(0, ctx.maxItems).map(x => walkJson(x, f, ctx, key));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walkJson(x, f, ctx, k); return o; }
  if (typeof v === 'string') { if (ctx.keep.has(key.toLowerCase()) || ctx.keep.has(v.toLowerCase())) return v; collect(ctx, v); return f.str(v, key); }
  if (typeof v === 'number') { if (ctx.keep.has(key.toLowerCase()) || ctx.keep.has(String(v))) return v; collect(ctx, String(v)); return f.num(v); }
  return v; // boolean / null
}
const collect = (ctx, s) => { if (s.length >= 4 && /[^\s]/.test(s)) ctx.originals.add(s); };

/* ---------- XML (tokenizer — no DOM, no entity expansion) ---------- */
// XML attributes that describe the data rather than hold it (wd:type="WID", wd:version="v41.0", xml:lang ...): kept so the mock still validates
const STRUCT_ATTRS = new Set(['type', 'version', 'lang', 'encoding', 'format', 'kind', 'schemaversion', 'schemalocation']);
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

function walkXml(src, f, ctx) {
  let out = '', i = 0; const stack = [], hints = [];   // hints: the wd:type of the open element (WID, Currency_ID ...) tells what its text is
  const hint = () => hints[hints.length - 1] || stack[stack.length - 1] || '';
  const n = src.length;
  while (i < n) {
    if (src[i] !== '<') {
      let j = src.indexOf('<', i); if (j < 0) j = n;
      const t = src.slice(i, j);
      out += anonText(t, stack[stack.length - 1] || '', f, ctx, false, hint()); i = j; continue;
    }
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; } // comments dropped
    if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i + 9); const body = src.slice(i + 9, e < 0 ? n : e); out += '<![CDATA[' + anonText(body, stack[stack.length - 1] || '', f, ctx, true) + ']]>'; i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i + 2); const t = src.slice(i, e < 0 ? n : e + 2); out += t; i = e < 0 ? n : e + 2; continue; }
    if (src.startsWith('<!', i)) { const e = src.indexOf('>', i); i = e < 0 ? n : e + 1; continue; } // DOCTYPE dropped (no entity tricks)
    // tag, with quote-aware end
    let j = i + 1, q = '';
    for (; j < n; j++) { const c = src[j]; if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; }
    const raw = src.slice(i + 1, j); i = j + 1;
    if (raw[0] === '/') { stack.pop(); hints.pop(); out += '<' + raw + '>'; continue; }
    const self = raw.endsWith('/');
    const m = /^([^\s/>]+)([\s\S]*?)(\/?)$/.exec(raw);
    const name = m[1]; const local = name.replace(/^.*:/, '');
    const attrs = m[2].replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (all, an, _q, dv, sv) => {
      const val = dv ?? sv;
      if (/^xmlns(:|$)/.test(an) || /^xsi:/.test(an) || an === 'xml:lang') return all;
      const plain = unesc(val);
      const local = an.replace(/^.*:/, '').toLowerCase();
      if (ctx.keep.has(local) || ctx.keep.has(plain.toLowerCase()) || STRUCT_ATTRS.has(local)) return all;
      collect(ctx, plain);
      return `${an}="${escAttr(f.str(plain, an))}"`;
    });
    out += '<' + name + attrs + (self ? '/' : '') + '>';
    if (!self) { stack.push(local); hints.push((/(?:^|[\s:])type\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[2]) || []).slice(1).find(Boolean) || ''); }
  }
  return out;
}
function anonText(t, tag, f, ctx, raw = false, hint = '') {
  if (!t.trim()) return t;
  const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0]; const core = t.slice(lead.length, t.length - trail.length);
  const plain = raw ? core : unesc(core);
  if (ctx.keep.has(tag.toLowerCase()) || ctx.keep.has(plain.toLowerCase())) return t;
  collect(ctx, plain);
  const v = /^-?\d+(\.\d+)?$/.test(plain) ? String(f.num(plain)) : f.str(plain, hint || tag);
  return lead + (raw ? v : esc(v)) + trail;
}

/* ---------- entry point ---------- */
export function detect(text) { const t = String(text).trimStart(); return t.startsWith('<') ? 'xml' : /^[{["\d\-tfn]/.test(t) ? 'json' : 'text'; }

export function anonymize(text, opts = {}) {
  const keep = new Set((opts.keep || []).map(s => String(s).trim().toLowerCase()).filter(Boolean));
  const maxItems = Math.max(1, Math.min(1000, Number(opts.maxItems) || 3));
  const ctx = { keep, maxItems, originals: new Set() };
  const f = makeFaker(opts.salt ?? 'postern'); // memo is per call
  const kind = detect(text);
  if (opts.verbatim) {   // built-in templates: the values are already fictional, so keep them exactly as written
    let output = String(text).trim();
    if (kind === 'json') { try { output = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { throw new Error('That isn’t valid JSON: ' + e.message); } }
    return { kind, output, stats: { checked: 0, kept: [] }, leaks: [], verbatim: true };
  }
  let output;
  if (kind === 'json') {
    let v; try { v = JSON.parse(text); } catch (e) { throw new Error('That isn’t valid JSON: ' + e.message); }
    output = JSON.stringify(walkJson(v, f, ctx), null, 2);
  } else if (kind === 'xml') {
    if (!/<[A-Za-z_]/.test(text)) throw new Error('That doesn’t look like XML.');
    output = walkXml(String(text), f, ctx);
  } else throw new Error('Paste a JSON or XML sample.');

  // leak check: no original value of 4+ chars may appear among the OUTPUT VALUES (field names are structure and are ignored)
  const vals = outputValues(output, kind).join('\u0000').toLowerCase(); const leaks = [];
  for (const o of ctx.originals) { if (vals.includes(o.toLowerCase())) leaks.push(o); if (leaks.length >= 20) break; }
  return { kind, output, stats: { checked: ctx.originals.size, kept: [...keep] }, leaks };
}
function outputValues(output, kind) {
  const vals = [];
  if (kind === 'json') { const w = (v) => { if (Array.isArray(v)) v.forEach(w); else if (v && typeof v === 'object') Object.values(v).forEach(w); else if (v !== null && typeof v !== 'boolean') vals.push(String(v)); }; w(JSON.parse(output)); }
  else {
    for (const m of output.matchAll(/>([^<]+)</g)) vals.push(unesc(m[1]));
    for (const m of output.matchAll(/\s[^\s=]+="([^"]*)"/g)) vals.push(unesc(m[1]));
    for (const m of output.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) vals.push(m[1]);
  }
  return vals;
}
