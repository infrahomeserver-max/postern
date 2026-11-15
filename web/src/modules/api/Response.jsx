import { useState, useMemo } from 'react';
import { Icon, Tabs, highlightJson, Spinner, useToast } from '../../ui.jsx';
import { fmtBytes, download } from '../../api.js';
import { prettyXml } from './xml.js';

const HL_LIMIT = 300 * 1024, SHOW_LIMIT = 512 * 1024, PRETTY_LIMIT = 512 * 1024;

function BodyView({ resp }) {
  const [mode, setMode] = useState('pretty'); const [full, setFull] = useState(false); const [forcePretty, setForce] = useState(false);
  const toast = useToast();
  const ct = resp.contentType || '';
  const isJson = /json/i.test(ct) || (resp.isText && /^\s*[{[]/.test(resp.bodyText || ''));
  const isXml = !isJson && resp.isText && (/xml/i.test(ct) || /^\s*<\?xml|^\s*<[\w:-]+[\s>]/.test(resp.bodyText || '')) && !/html/i.test(ct);
  const isHtml = /html/i.test(ct); const isImg = /^image\//i.test(ct);
  const shown = useMemo(() => {
    let t = resp.bodyText || '';
    if (mode === 'pretty' && isJson && t.length < 5e6 && (t.length < PRETTY_LIMIT || forcePretty)) { try { t = JSON.stringify(JSON.parse(t), null, 2); } catch { /* keep raw */ } }
    if (mode === 'pretty' && isXml && t.length < PRETTY_LIMIT) { try { t = prettyXml(t); } catch { /* keep raw */ } }
    return t;
  }, [resp, mode, isJson, isXml, forcePretty]);
  const bigRaw = mode === 'pretty' && isJson && (resp.bodyText || '').length >= PRETTY_LIMIT && !forcePretty;
  const cut = !full && shown.length > SHOW_LIMIT;
  const text = cut ? shown.slice(0, SHOW_LIMIT) : shown;
  const html = useMemo(() => mode === 'pretty' && isJson && text.length < HL_LIMIT ? highlightJson(text) : null, [text, mode, isJson]);
  const copy = () => navigator.clipboard?.writeText(resp.bodyText || '').then(() => toast('Copied', 'success'));
  const save = () => {
    const ext = isJson ? 'json' : isHtml ? 'html' : isXml || /xml/.test(ct) ? 'xml' : 'txt';
    if (resp.isText) download('response.' + ext, resp.bodyText, ct || 'text/plain');
    else if (resp.bodyBase64) { const a = document.createElement('a'); a.href = `data:${ct || 'application/octet-stream'};base64,${resp.bodyBase64}`; a.download = 'response.bin'; a.click(); }
  };
  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div className="row" style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>
        {resp.isText && ['pretty', 'raw', ...(isHtml ? ['preview'] : [])].map(m => <button key={m} className={'btn sm ' + (mode === m ? '' : 'ghost')} onClick={() => setMode(m)} style={mode === m ? { background: 'var(--sel)' } : {}}>{m[0].toUpperCase() + m.slice(1)}</button>)}
        <span className="grow" />
        <button className="icon-btn" onClick={copy} title="Copy body" aria-label="Copy body"><Icon n="copy" s={15} /></button>
        <button className="icon-btn" onClick={save} title="Save response to file" aria-label="Save response"><Icon n="download" s={15} /></button>
      </div>
      {bigRaw && <div className="row" style={{ padding: '6px 12px', background: 'var(--panel2)' }}><span className="muted">Large response ({fmtBytes(resp.size)}) — shown as-is to keep the app fast.</span><button className="btn sm" onClick={() => setForce(true)}>Pretty-print anyway</button></div>}
      {resp.truncated && <div className="chip warn" style={{ margin: 8, alignSelf: 'flex-start' }}>Response exceeded 20 MB and was truncated</div>}
      {!resp.isText && isImg && resp.bodyBase64 ? <div style={{ padding: 16, overflow: 'auto' }}><img src={`data:${ct};base64,${resp.bodyBase64}`} alt="response" style={{ maxWidth: '100%' }} /></div>
        : !resp.isText ? <div className="empty">Binary response ({fmtBytes(resp.size)}) — use the download button to save it.</div>
        : mode === 'preview' ? <iframe title="preview" sandbox="" srcDoc={resp.bodyText} style={{ flex: 1, border: 0, background: '#fff' }} />
        : <>{html ? <pre className="code" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="code">{text}</pre>}
          {cut && <div className="row" style={{ padding: 8, borderTop: '1px solid var(--line)' }}><span className="muted">Showing first 512 KB of {fmtBytes(shown.length)}.</span><button className="btn sm" onClick={() => setFull(true)}>Show all</button></div>}</>}
    </div>
  );
}

export default function Response({ tab, onExample, onClear }) {
  const [sub, setSub] = useState('body');
  const r = tab.resp;
  if (tab.running) return <div className="empty"><div className="col" style={{ alignItems: 'center', gap: 10 }}><Spinner />Sending request…</div></div>;
  if (tab.error) return <div className="empty"><div><div className="chip err" style={{ marginBottom: 10 }}>Request failed</div><div style={{ maxWidth: 480 }}>{tab.error}</div></div></div>;
  if (!r) return <div className="empty"><div><Icon n="send" s={30} c="var(--muted)" /><div style={{ marginTop: 10 }}>Enter a URL and press <b>Send</b> (Ctrl+Enter) to get a response</div></div></div>;
  const cls = 's' + Math.min(5, Math.max(2, Math.floor(r.status / 100)));
  const passed = tab.tests.filter(t => t.pass).length;
  const cookies = r.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => { const [nv, ...attrs] = v.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), attrs: attrs.join(';').trim() }; });
  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div className="row" style={{ padding: '6px 12px', gap: 12, flexWrap: 'wrap' }}>
        <span className={'chip ' + cls} title="HTTP status">{r.status} {r.statusText}</span>
        <span className="muted" title={`Time to first byte: ${r.ttfbMs} ms`}>{r.timeMs} ms</span>
        <span className="muted">{fmtBytes(r.size)}</span>
        {r.redirected && <span className="chip info" title={r.url}>redirected</span>}
        <span className="grow" />
        {onExample && r.isText !== false && <button className="btn sm ghost" title="Keep this response as a named example (used by Mock servers)" onClick={() => onExample(r)}><Icon n="save" s={12} />Save as example</button>}
        {onClear && <button className="btn sm ghost" title="Clear this response" onClick={onClear}><Icon n="x" s={12} />Clear</button>}
      </div>
      {r.url && <div className="row" style={{ padding: '0 12px 6px', gap: 6 }}><span className="muted" style={{ fontSize: 11.5 }}>Sent to</span><span className="muted ellipsis mono grow" style={{ fontSize: 12 }} title={r.url}>{r.url}</span></div>}
      {r.fault && <div className="row" role="alert" style={{ padding: '6px 12px', background: 'rgba(248,113,113,.12)', borderBottom: '1px solid var(--line)', gap: 8, alignItems: 'baseline' }}>
        <span className="chip err">SOAP Fault</span><b>{r.fault.code}</b><span className="grow">{r.fault.message}</span>{r.fault.detail && <span className="muted ellipsis" style={{ maxWidth: 260 }} title={r.fault.detail}>{r.fault.detail}</span>}</div>}
      <Tabs value={sub} onChange={setSub} tabs={[
        { id: 'body', label: 'Body' }, { id: 'headers', label: 'Headers', badge: r.headers.length },
        { id: 'cookies', label: 'Cookies', badge: cookies.length || null },
        { id: 'tests', label: tab.tests.length ? `Tests (${passed}/${tab.tests.length})` : 'Tests' }, { id: 'console', label: 'Console', badge: tab.logs.length || null }]} />
      {sub === 'body' && <BodyView resp={r} />}
      {sub === 'headers' && <div style={{ overflow: 'auto' }}><table className="kv"><tbody>{r.headers.map(([k, v], i) => <tr key={i}><td style={{ padding: '5px 10px', width: 220, fontWeight: 600 }}>{k}</td><td className="mono" style={{ padding: '5px 10px', wordBreak: 'break-all' }}>{v}</td></tr>)}</tbody></table></div>}
      {sub === 'cookies' && (cookies.length ? <div style={{ overflow: 'auto' }}><table className="kv"><thead><tr><th>Name</th><th>Value</th><th>Attributes</th></tr></thead><tbody>{cookies.map((c, i) => <tr key={i}><td style={{ padding: '5px 10px' }}>{c.name}</td><td className="mono" style={{ padding: '5px 10px' }}>{c.value}</td><td className="muted" style={{ padding: '5px 10px' }}>{c.attrs}</td></tr>)}</tbody></table></div> : <div className="empty">No cookies were set</div>)}
      {sub === 'tests' && (tab.tests.length ? <div style={{ overflow: 'auto', padding: 10 }}>{tab.tests.map((t, i) => <div key={i} className="row" style={{ padding: '5px 4px', alignItems: 'flex-start' }}><span className={'chip ' + (t.pass ? 'ok' : 'err')}>{t.pass ? 'PASS' : 'FAIL'}</span><div><div>{t.name}</div>{t.error && <div className="muted mono" style={{ fontSize: 12 }}>{t.error}</div>}</div></div>)}</div> : <div className="empty">No tests ran. Add them in the request's <b>Tests</b> tab.</div>)}
      {sub === 'console' && (tab.logs.length ? <pre className="code">{tab.logs.map(l => `[${l.src || 'script'}] ${l.level}: ${l.text}`).join('\n')}</pre> : <div className="empty">Nothing logged</div>)}
    </div>
  );
}
