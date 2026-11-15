/* XML helpers for SOAP: pretty printer, XPath evaluation, SOAP Fault parsing. Browser only (DOMParser / document.evaluate). */
const NS = { env11: 'http://schemas.xmlsoap.org/soap/envelope/', env12: 'http://www.w3.org/2003/05/soap-envelope', xsd: 'http://www.w3.org/2001/XMLSchema' };

const TOKEN = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[^>]+>|[^<]+/g;
export function prettyXml(xml, indent = '  ') {
  const toks = xml.match(TOKEN) || [xml]; const out = []; let depth = 0;
  const isOpen = (t) => /^<[^!?\/][^>]*[^\/]>$|^<[^!?\/>]>$/.test(t), isClose = (t) => /^<\//.test(t);
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    if (!t.startsWith('<')) { t = t.trim(); if (t) out.push(indent.repeat(depth) + t); continue; }
    if (isClose(t)) { depth = Math.max(0, depth - 1); out.push(indent.repeat(depth) + t); continue; }
    if (isOpen(t)) {
      const txt = toks[i + 1], nxt = toks[i + 2]; // <a>text</a> stays on one line
      if (txt !== undefined && !txt.startsWith('<') && nxt && isClose(nxt)) { out.push(indent.repeat(depth) + t + txt.trim() + nxt); i += 2; continue; }
      out.push(indent.repeat(depth) + t); depth++; continue;
    }
    out.push(indent.repeat(depth) + t);
  }
  return out.join('\n');
}

const parseXml = (text) => {
  if (/<!ENTITY/i.test(text)) throw new Error('Responses declaring XML entities are not evaluated');
  if (text.length > 5 * 1024 * 1024) throw new Error('Response too large to evaluate (over 5 MB)');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Response is not well-formed XML');
  return doc;
};
const collectNs = (doc) => {
  const map = { soapenv: NS.env11, soap: NS.env11, s: NS.env11, soap12: NS.env12, xsi: 'http://www.w3.org/2001/XMLSchema-instance', xsd: NS.xsd };
  const walk = (el) => { for (const a of el.attributes || []) { if (a.name === 'xmlns') map.d ??= a.value; else if (a.name.startsWith('xmlns:')) map[a.name.slice(6)] = a.value; } for (const c of el.children || []) walk(c); };
  walk(doc.documentElement); return map;
};

/* → { kind: 'nodes'|'string'|'number'|'boolean', value (string), values: string[], count } */
export function xpathEval(xmlText, expr, doc = parseXml(xmlText)) {
  const nsmap = collectNs(doc);
  let r;
  try { r = doc.evaluate(expr, doc, (p) => nsmap[p] || null, XPathResult.ANY_TYPE, null); }
  catch (e) { throw new Error('Invalid XPath: ' + (e.message || '').replace(/^.*?:\s*/, '').slice(0, 120)); }
  if (r.resultType === XPathResult.NUMBER_TYPE) return { kind: 'number', value: String(r.numberValue), values: [String(r.numberValue)], count: 1 };
  if (r.resultType === XPathResult.BOOLEAN_TYPE) return { kind: 'boolean', value: String(r.booleanValue), values: [String(r.booleanValue)], count: 1 };
  if (r.resultType === XPathResult.STRING_TYPE) return { kind: 'string', value: r.stringValue, values: [r.stringValue], count: 1 };
  const values = []; for (let n = r.iterateNext(); n; n = r.iterateNext()) { values.push(n.nodeType === 2 ? n.value : (n.textContent ?? '')); if (values.length >= 1000) break; }
  return { kind: 'nodes', value: values[0] ?? '', values, count: values.length };
}

export function parseFault(xmlText, doc) {
  if (!/Fault/.test(xmlText)) return null;
  try {
    doc ||= parseXml(xmlText);
    const f = [...doc.getElementsByTagNameNS('*', 'Fault')].find(x => x.namespaceURI === NS.env11 || x.namespaceURI === NS.env12);
    if (!f) return null;
    const t = (ns, name) => { const e = [...f.getElementsByTagNameNS(ns || '*', name)][0]; return e?.textContent?.trim() || ''; };
    if (f.namespaceURI === NS.env12) return { version: '1.2', code: t('*', 'Value'), message: t('*', 'Text'), detail: t('*', 'Detail') };
    return { version: '1.1', code: [...f.children].find(c => c.localName === 'faultcode')?.textContent?.trim() || '', message: [...f.children].find(c => c.localName === 'faultstring')?.textContent?.trim() || '', detail: [...f.children].find(c => c.localName === 'detail')?.textContent?.trim() || '' };
  } catch { return null; }
}

export const looksXml = (resp) => resp?.isText && (/xml/i.test(resp.contentType || '') || /^\s*</.test(resp.bodyText || ''));

/* Run the SOAP assertions of a request against a response → [{name, pass, error?}]. `extract` sets variables via setVar. */
export function runSoapAssertions(assertions, resp, resolveVars, setVar) {
  const out = []; let doc = null, docErr = null;
  const getDoc = () => { if (doc || docErr) { if (docErr) throw docErr; return doc; } try { doc = parseXml(resp.bodyText || ''); return doc; } catch (e) { docErr = e; throw e; } };
  for (const a of assertions || []) {
    if (a.enabled === false) continue;
    const exp = resolveVars(a.value ?? '');
    try {
      if (a.type === 'status') { const ok = String(resp.status) === String(exp || '200'); out.push({ name: `HTTP status is ${exp || 200}`, pass: ok, error: ok ? '' : `got ${resp.status}` }); }
      else if (a.type === 'time') { const ok = resp.timeMs <= Number(exp); out.push({ name: `Response time ≤ ${exp} ms`, pass: ok, error: ok ? '' : `took ${resp.timeMs} ms` }); }
      else if (a.type === 'nofault') { const f = looksXml(resp) ? parseFault(resp.bodyText, getDoc()) : null; out.push({ name: 'No SOAP Fault', pass: !f, error: f ? `${f.code}: ${f.message}` : '' }); }
      else if (a.type === 'fault') { const f = looksXml(resp) ? parseFault(resp.bodyText, getDoc()) : null; const ok = !!f && (!exp || (f.message + ' ' + f.code).includes(exp)); out.push({ name: exp ? `SOAP Fault contains “${exp}”` : 'Response is a SOAP Fault', pass: ok, error: ok ? '' : f ? `fault was ${f.code}: ${f.message}` : 'no Fault in response' }); }
      else if (a.type === 'wellformed') { getDoc(); out.push({ name: 'Response is well-formed XML', pass: true }); }
      else if (a.type === 'xpath' || a.type === 'extract') {
        const xp = resolveVars(a.xpath || ''); if (!xp.trim()) throw new Error('XPath is empty');
        const r = xpathEval(resp.bodyText || '', xp, getDoc());
        if (a.type === 'extract') { const ok = r.count > 0 && r.value !== ''; if (ok) setVar(a.value, r.value); out.push({ name: `Extract ${xp} → {{${a.value}}}`, pass: ok, error: ok ? '' : 'XPath matched nothing' }); continue; }
        const label = `${xp} ${a.op || 'equals'}${['exists', 'notexists'].includes(a.op) ? '' : ' “' + exp + '”'}`;
        let ok, got = r.value;
        switch (a.op || 'equals') {
          case 'equals': ok = r.count > 0 && r.value === exp; break;
          case 'notequals': ok = r.value !== exp; break;
          case 'contains': ok = r.values.some(v => v.includes(exp)); break;
          case 'regex': { if (exp.length > 300 || /\([^)]*[+*][^)]*\)[+*{]/.test(exp)) throw new Error('Regular expression rejected (too long, or nested quantifiers that could hang the app)'); const re = new RegExp(exp); ok = r.values.some(v => re.test(v.slice(0, 100000))); break; }
          case 'exists': ok = r.kind === 'nodes' ? r.count > 0 : r.value !== '' && r.value !== 'false'; break;
          case 'notexists': ok = r.kind === 'nodes' ? r.count === 0 : r.value === '' || r.value === 'false'; break;
          case 'count': ok = String(r.kind === 'nodes' ? r.count : r.value) === exp; got = String(r.kind === 'nodes' ? r.count : r.value); break;
          default: ok = false;
        }
        out.push({ name: label, pass: ok, error: ok ? '' : r.count === 0 && r.kind === 'nodes' ? 'XPath matched nothing' : `got “${String(got).slice(0, 80)}”` });
      }
    } catch (e) { out.push({ name: a.type === 'extract' ? `Extract ${a.xpath}` : `${a.type}: ${a.xpath || a.value || ''}`, pass: false, error: e.message }); }
  }
  return out;
}
