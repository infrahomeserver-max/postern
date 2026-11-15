/* WSDL 1.1 reader + sample SOAP envelope generator.
   Only uses the standard DOM API (localName / namespaceURI / lookupNamespaceURI), so the same code runs in the browser and in Node tests (xmldom).
   Security: DTDs / entity declarations are refused, external schema/WSDL imports are fetched only through the caller-supplied fetcher
   (Postern's server proxy, which applies the SSRF guard) and are bounded in count, depth and size. */

export const NS = {
  wsdl: 'http://schemas.xmlsoap.org/wsdl/', soap11: 'http://schemas.xmlsoap.org/wsdl/soap/', soap12: 'http://schemas.xmlsoap.org/wsdl/soap12/',
  xsd: 'http://www.w3.org/2001/XMLSchema', env11: 'http://schemas.xmlsoap.org/soap/envelope/', env12: 'http://www.w3.org/2003/05/soap-envelope',
  wsdl2: 'http://www.w3.org/ns/wsdl',
};
const MAX_DOCS = 20, MAX_DEPTH = 4, MAX_BYTES = 5 * 1024 * 1024, MAX_NODES = 4000, MAX_SAMPLE_DEPTH = 9;

const els = (el, ns, name) => [...el.childNodes].filter(n => n.nodeType === 1 && (!ns || n.namespaceURI === ns) && (!name || n.localName === name));
const el1 = (el, ns, name) => els(el, ns, name)[0] || null;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

export function defaultParse(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The document is not well-formed XML');
  return doc;
}

/* QName "tns:Foo" → { ns, local } using the in-scope namespaces of `el` */
function qn(el, value) {
  if (!value) return null;
  const i = value.indexOf(':');
  const prefix = i < 0 ? null : value.slice(0, i), local = i < 0 ? value : value.slice(i + 1);
  return { ns: el.lookupNamespaceURI(prefix) || '', local };
}
const key = (q) => q ? `{${q.ns}}${q.local}` : '';
const schemaOf = (el) => { let n = el; while (n && !(n.localName === 'schema' && n.namespaceURI === NS.xsd)) n = n.parentNode; return n; };

/* ---------- loading (wsdl:import, xsd:import, xsd:include) ---------- */
async function loadAll(rootText, baseUrl, fetchText, parse, warnings) {
  const docs = []; const seen = new Set(); let bytes = 0;
  const add = async (text, url, depth) => {
    if (docs.length >= MAX_DOCS) { warnings.push('Too many imported documents — the rest were skipped'); return; }
    bytes += text.length; if (bytes > MAX_BYTES) throw new Error('WSDL and its imports are larger than 5 MB');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTDs and entity declarations are not allowed in WSDL/XSD files');
    const doc = parse(text); docs.push({ doc, url });
    if (depth >= MAX_DEPTH) return;
    const refs = [];
    const scan = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue;
      if ((c.namespaceURI === NS.wsdl && c.localName === 'import' && c.getAttribute('location')) || (c.namespaceURI === NS.xsd && (c.localName === 'import' || c.localName === 'include') && c.getAttribute('schemaLocation')))
        refs.push(c.getAttribute('location') || c.getAttribute('schemaLocation'));
      else if (c.localName === 'types' || c.localName === 'schema' || c.localName === 'definitions') scan(c); } };
    scan(doc.documentElement);
    for (const r of refs) {
      let abs; try { abs = new URL(r, url || undefined).href; } catch { warnings.push(`Skipped import “${r}” (relative path and no base URL — import the WSDL from its URL to follow it)`); continue; }
      if (!/^https?:/i.test(abs) || seen.has(abs)) continue; seen.add(abs);
      try { await add(await fetchText(abs), abs, depth + 1); } catch (e) { warnings.push(`Couldn’t load import ${abs}: ${e.message}`); }
    }
  };
  if (baseUrl) seen.add(baseUrl);
  await add(rootText, baseUrl || '', 0);
  return docs;
}

/* ---------- XSD sample generation ---------- */
const BUILTIN = {
  string: 'string', normalizedString: 'string', token: 'string', anyURI: 'http://example.com', QName: 'string', ID: 'id1', IDREF: 'id1', language: 'en', NMTOKEN: 'string', Name: 'string', NCName: 'string',
  int: '0', integer: '0', long: '0', short: '0', byte: '0', nonNegativeInteger: '0', unsignedInt: '0', unsignedLong: '0', unsignedShort: '0', unsignedByte: '0', positiveInteger: '1', negativeInteger: '-1', nonPositiveInteger: '0',
  decimal: '0.0', float: '0.0', double: '0.0', boolean: 'false', dateTime: '2024-01-01T00:00:00Z', date: '2024-01-01', time: '00:00:00', duration: 'P1D', gYear: '2024', gYearMonth: '2024-01', base64Binary: 'AAAA', hexBinary: '00',
};

function buildIndex(docs) {
  const ix = { elements: new Map(), types: new Map(), groups: new Map(), attrGroups: new Map(), attrs: new Map() };
  for (const { doc } of docs) {
    const types = el1(doc.documentElement, NS.wsdl, 'types');
    const schemas = doc.documentElement.localName === 'schema' ? [doc.documentElement] : types ? els(types, NS.xsd, 'schema') : [];
    for (const s of schemas) {
      const tns = s.getAttribute('targetNamespace') || '';
      for (const c of els(s, NS.xsd)) {
        const name = c.getAttribute('name'); if (!name) continue;
        const k = `{${tns}}${name}`;
        if (c.localName === 'element') ix.elements.set(k, c);
        else if (c.localName === 'complexType' || c.localName === 'simpleType') ix.types.set(k, c);
        else if (c.localName === 'group') ix.groups.set(k, c);
        else if (c.localName === 'attributeGroup') ix.attrGroups.set(k, c);
        else if (c.localName === 'attribute') ix.attrs.set(k, c);
      }
    }
  }
  return ix;
}

/* tree node: { ns, name, attrs: [{ns,name,value}], children: [], text } */
function mkGen(ix, warnings) {
  let count = 0;
  const tnsOf = (el) => schemaOf(el)?.getAttribute('targetNamespace') || '';
  const qualifiedLocal = (decl) => { const f = decl.getAttribute('form'); return f ? f === 'qualified' : schemaOf(decl)?.getAttribute('elementFormDefault') === 'qualified'; };

  function simpleSample(t, stack) {
    // t: QName | simpleType element
    if (!t) return 'string';
    if (t.localName) { // simpleType declaration
      const r = el1(t, NS.xsd, 'restriction');
      if (r) {
        const en = els(r, NS.xsd, 'enumeration')[0]; if (en) return en.getAttribute('value');
        const min = el1(r, NS.xsd, 'minInclusive') || el1(r, NS.xsd, 'minExclusive'); if (min) return min.getAttribute('value');
        const base = r.getAttribute('base');
        if (base) return simpleSample(qn(r, base), stack);
        const inner = el1(r, NS.xsd, 'simpleType'); if (inner) return simpleSample(inner, stack);
      }
      const l = el1(t, NS.xsd, 'list'); if (l) { const it = l.getAttribute('itemType'); return it ? simpleSample(qn(l, it), stack) : 'string'; }
      const u = el1(t, NS.xsd, 'union'); if (u) { const m = (u.getAttribute('memberTypes') || '').split(/\s+/)[0]; return m ? simpleSample(qn(u, m), stack) : 'string'; }
      return 'string';
    }
    if (t.ns === NS.xsd) return BUILTIN[t.local] ?? 'string';
    const d = ix.types.get(key(t)); if (!d || stack.includes(key(t))) return 'string';
    return d.localName === 'simpleType' ? simpleSample(d, [...stack, key(t)]) : 'string';
  }

  /* contents of a complexType (or an inline one): fills node.attrs / node.children / node.text */
  function fillComplex(ct, node, stack, depth) {
    const cc = el1(ct, NS.xsd, 'complexContent'), sc = el1(ct, NS.xsd, 'simpleContent');
    if (cc) {
      const ext = el1(cc, NS.xsd, 'extension') || el1(cc, NS.xsd, 'restriction');
      if (ext) {
        const base = qn(ext, ext.getAttribute('base'));
        if (ext.localName === 'extension' && base && base.ns !== NS.xsd) fillType(base, node, stack, depth);
        particles(ext, node, stack, depth); attrsOf(ext, node);
      }
      return;
    }
    if (sc) {
      const ext = el1(sc, NS.xsd, 'extension') || el1(sc, NS.xsd, 'restriction');
      if (ext) { node.text = simpleSample(qn(ext, ext.getAttribute('base')), stack); attrsOf(ext, node); }
      return;
    }
    particles(ct, node, stack, depth); attrsOf(ct, node);
    if (ct.getAttribute('mixed') === 'true' && !node.children.length) node.text = 'string';
  }

  function attrsOf(parent, node) {
    for (const a of els(parent, NS.xsd)) {
      if (a.localName === 'attribute') {
        if (a.getAttribute('use') === 'prohibited') continue;
        let decl = a, name = a.getAttribute('name'), ns = a.getAttribute('form') === 'qualified' ? tnsOf(a) : '';
        const ref = a.getAttribute('ref');
        if (ref) { const q = qn(a, ref); decl = ix.attrs.get(key(q)) || a; name = q.local; ns = q.ns; }
        if (!name) continue;
        const fixed = a.getAttribute('fixed') || a.getAttribute('default');
        const tAttr = decl.getAttribute('type'); const inline = el1(decl, NS.xsd, 'simpleType');
        node.attrs.push({ ns, name, value: fixed ?? (inline ? simpleSample(inline, []) : simpleSample(tAttr ? qn(decl, tAttr) : null, [])) });
      } else if (a.localName === 'attributeGroup' && a.getAttribute('ref')) {
        const g = ix.attrGroups.get(key(qn(a, a.getAttribute('ref')))); if (g) attrsOf(g, node);
      }
    }
  }

  function particles(parent, node, stack, depth) {
    for (const p of els(parent, NS.xsd)) {
      if (p.getAttribute('maxOccurs') === '0') continue;
      switch (p.localName) {
        case 'sequence': case 'all': particles(p, node, stack, depth); break;
        case 'choice': { const first = els(p, NS.xsd).find(x => ['element', 'sequence', 'choice', 'group'].includes(x.localName)); if (first) particlesOne(first, node, stack, depth); break; }
        case 'group': { const g = ix.groups.get(key(qn(p, p.getAttribute('ref')))); if (g) particles(g, node, stack, depth); break; }
        case 'element': particlesOne(p, node, stack, depth); break;
        default: break; // any, annotation, attributes handled elsewhere
      }
    }
  }
  function particlesOne(p, node, stack, depth) {
    if (p.localName === 'element') { const c = buildElement(p, stack, depth + 1); if (c) node.children.push(c); }
    else if (p.localName === 'sequence' || p.localName === 'all') particles(p, node, stack, depth);
    else if (p.localName === 'choice') { const first = els(p, NS.xsd).find(x => ['element', 'sequence', 'choice', 'group'].includes(x.localName)); if (first) particlesOne(first, node, stack, depth); }
    else if (p.localName === 'group') { const g = ix.groups.get(key(qn(p, p.getAttribute('ref')))); if (g) particles(g, node, stack, depth); }
  }

  function fillType(q, node, stack, depth) {
    if (!q) { node.text = 'string'; return; }
    if (q.ns === NS.xsd) { node.text = q.local === 'anyType' ? '?' : (BUILTIN[q.local] ?? 'string'); return; }
    const k = key(q), d = ix.types.get(k);
    if (!d) { node.text = 'string'; warnings.push(`Type ${q.local} not found in the schema`); return; }
    if (stack.includes(k) || depth > MAX_SAMPLE_DEPTH) return; // recursive type: stop
    const st = [...stack, k];
    if (d.localName === 'simpleType') node.text = simpleSample(d, st); else fillComplex(d, node, st, depth);
  }

  function buildElement(decl, stack = [], depth = 0) {
    if (++count > MAX_NODES) return null;
    let d = decl, ns, name = decl.getAttribute('name');
    const ref = decl.getAttribute('ref');
    if (ref) { const q = qn(decl, ref); d = ix.elements.get(key(q)); if (!d) { warnings.push(`Element ${q.local} not found in the schema`); return { ns: q.ns, name: q.local, attrs: [], children: [], text: 'string' }; } name = q.local; ns = q.ns; }
    else ns = d.parentNode?.localName === 'schema' ? tnsOf(d) : (qualifiedLocal(d) ? tnsOf(d) : '');
    const node = { ns, name, attrs: [], children: [], text: null };
    const type = d.getAttribute('type'); const inlineC = el1(d, NS.xsd, 'complexType'), inlineS = el1(d, NS.xsd, 'simpleType');
    const fixed = d.getAttribute('fixed') ?? d.getAttribute('default');
    if (type) fillType(qn(d, type), node, stack, depth);
    else if (inlineC) { if (depth <= MAX_SAMPLE_DEPTH) fillComplex(inlineC, node, stack, depth); }
    else if (inlineS) node.text = simpleSample(inlineS, stack);
    else node.text = '?';
    if (fixed != null && !node.children.length) node.text = fixed;
    if (node.children.length) node.text = null;
    return node;
  }
  return { buildElement, fillType, reset: () => { count = 0; } };
}

/* ---------- serialisation ---------- */
function serialise(nodes, envNs) {
  const prefixes = new Map(); // ns → prefix
  const prefix = (ns) => { if (!ns) return ''; if (ns === envNs) return 'soapenv'; if (!prefixes.has(ns)) prefixes.set(ns, 'ns' + (prefixes.size + 1)); return prefixes.get(ns); };
  const q = (ns, name) => { const p = prefix(ns); return p ? `${p}:${name}` : name; };
  const one = (n, ind) => {
    const a = n.attrs.map(x => ` ${x.ns ? q(x.ns, x.name) : x.name}="${escAttr(x.value)}"`).join('');
    const tag = q(n.ns, n.name), pad = '   '.repeat(ind);
    if (n.children.length) return `${pad}<${tag}${a}>\n${n.children.map(c => one(c, ind + 1)).join('\n')}\n${pad}</${tag}>`;
    if (n.text == null || n.text === '') return `${pad}<${tag}${a}/>`;
    return `${pad}<${tag}${a}>${esc(n.text)}</${tag}>`;
  };
  const body = nodes.map(n => one(n, 2)).join('\n');
  const decl = [...prefixes].map(([ns, p]) => ` xmlns:${p}="${escAttr(ns)}"`).join('');
  return `<soapenv:Envelope xmlns:soapenv="${envNs}"${decl}>\n   <soapenv:Header/>\n   <soapenv:Body>\n${body}\n   </soapenv:Body>\n</soapenv:Envelope>`;
}

/* ---------- WSDL model ---------- */
export async function parseWsdl(text, { baseUrl = '', fetchText = async () => { throw new Error('no fetcher'); }, parse = defaultParse } = {}) {
  const warnings = [];
  if (text.length > MAX_BYTES) throw new Error('WSDL is larger than 5 MB');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTDs and entity declarations are not allowed in WSDL/XSD files');
  const root = parse(text).documentElement;
  if (root.namespaceURI === NS.wsdl2 && root.localName === 'description') throw new Error('This is a WSDL 2.0 file. Postern supports WSDL 1.1 (the format used by almost all SOAP services). Most servers also publish a 1.1 version.');
  if (!(root.namespaceURI === NS.wsdl && root.localName === 'definitions')) throw new Error('This is not a WSDL 1.1 document (expected a wsdl:definitions root element)');
  const docs = await loadAll(text, baseUrl, fetchText, parse, warnings);
  const ix = buildIndex(docs), gen = mkGen(ix, warnings);

  const msgs = new Map(), portTypes = new Map(), bindings = new Map(), services = [];
  for (const { doc } of docs) {
    const d = doc.documentElement; if (!(d.namespaceURI === NS.wsdl && d.localName === 'definitions')) continue;
    const tns = d.getAttribute('targetNamespace') || '';
    for (const m of els(d, NS.wsdl, 'message')) msgs.set(`{${tns}}${m.getAttribute('name')}`, els(m, NS.wsdl, 'part').map(p => ({ name: p.getAttribute('name'), element: qn(p, p.getAttribute('element')), type: qn(p, p.getAttribute('type')) })));
    for (const pt of els(d, NS.wsdl, 'portType')) portTypes.set(`{${tns}}${pt.getAttribute('name')}`, els(pt, NS.wsdl, 'operation').map(o => ({ name: o.getAttribute('name'), input: qn(o, el1(o, NS.wsdl, 'input')?.getAttribute('message')), output: qn(o, el1(o, NS.wsdl, 'output')?.getAttribute('message')) })));
    for (const b of els(d, NS.wsdl, 'binding')) {
      const sb = el1(b, NS.soap11, 'binding') || el1(b, NS.soap12, 'binding'); if (!sb) continue;
      const ops = new Map();
      for (const o of els(b, NS.wsdl, 'operation')) {
        const so = el1(o, NS.soap11, 'operation') || el1(o, NS.soap12, 'operation');
        const bodyOf = (dir) => { const x = el1(o, NS.wsdl, dir); return x ? (el1(x, NS.soap11, 'body') || el1(x, NS.soap12, 'body')) : null; };
        const body = (dir) => { const e = bodyOf(dir); return e ? { ns: e.getAttribute('namespace') || '', parts: e.getAttribute('parts') } : { ns: '', parts: null }; };
        ops.set(o.getAttribute('name'), { action: so?.getAttribute('soapAction') || '', style: so?.getAttribute('style') || sb.getAttribute('style') || 'document', input: body('input'), output: body('output') });
      }
      bindings.set(`{${tns}}${b.getAttribute('name')}`, { type: qn(b, b.getAttribute('type')), version: sb.namespaceURI === NS.soap12 ? '1.2' : '1.1', ops, tns });
    }
    for (const s of els(d, NS.wsdl, 'service')) services.push({ name: s.getAttribute('name'), el: s, tns });
  }

  const envelope = (op, binding, pt, dir) => {
    const msgQ = dir === 'input' ? pt.input : pt.output; if (!msgQ) return null;
    gen.reset(); // the node budget is per envelope, not per WSDL
    const parts = msgs.get(key(msgQ)) || []; const bi = binding.ops.get(pt.name); const bb = dir === 'input' ? bi.input : bi.output;
    const use = bb.parts ? parts.filter(p => bb.parts.split(/\s+/).includes(p.name)) : parts;
    const nodes = [];
    if (bi.style === 'rpc') {
      const wrap = { ns: bb.ns || binding.tns, name: dir === 'input' ? pt.name : pt.name + 'Response', attrs: [], children: [], text: null };
      for (const p of use) {
        if (p.element) { const e = ix.elements.get(key(p.element)); if (e) { const n = gen.buildElement(e); if (n) wrap.children.push(n); } }
        else { const n = { ns: '', name: p.name, attrs: [], children: [], text: null }; gen.fillType(p.type, n, [], 0); wrap.children.push(n); }
      }
      nodes.push(wrap);
    } else for (const p of use) {
      if (p.element) { const e = ix.elements.get(key(p.element)); if (e) { const n = gen.buildElement(e); if (n) nodes.push(n); } else warnings.push(`Element ${p.element.local} not found for ${pt.name}`); }
      else { const n = { ns: '', name: p.name, attrs: [], children: [], text: null }; gen.fillType(p.type, n, [], 0); nodes.push(n); }
    }
    return serialise(nodes, binding.version === '1.2' ? NS.env12 : NS.env11);
  };

  const endpoints = [];
  for (const s of services) {
    for (const port of els(s.el, NS.wsdl, 'port')) {
      const addr = el1(port, NS.soap11, 'address') || el1(port, NS.soap12, 'address'); if (!addr) continue;
      const bq = qn(port, port.getAttribute('binding')); const binding = bindings.get(key(bq)); if (!binding) { warnings.push(`Binding ${bq?.local} of port ${port.getAttribute('name')} is not a SOAP binding`); continue; }
      const pt = portTypes.get(key(binding.type)) || [];
      const operations = [];
      for (const o of pt) { const bi = binding.ops.get(o.name); if (!bi) continue;
        operations.push({ name: o.name, action: bi.action, style: bi.style, envelope: envelope(o, binding, o, 'input') || '', responseEnvelope: envelope(o, binding, o, 'output') || '' }); }
      endpoints.push({ service: s.name, port: port.getAttribute('name'), address: addr.getAttribute('location'), version: binding.version, operations });
    }
  }
  if (!endpoints.length) throw new Error('No SOAP service endpoints found in this WSDL (it may only define abstract operations, or use an HTTP/other binding)');
  const title = root.getAttribute('name') || services[0]?.name || 'SOAP service';
  return { title, targetNamespace: root.getAttribute('targetNamespace') || '', endpoints, warnings: [...new Set(warnings)] };
}

/* in-memory model cache so the Operation dropdown can switch without re-downloading */
const cache = new Map();
export const cacheModel = (k, m) => { if (cache.size > 20) cache.delete(cache.keys().next().value); cache.set(k, m); };
export const cachedModel = (k) => cache.get(k);
