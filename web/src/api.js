export async function api(path, { method = 'GET', body, raw, signal, headers } = {}) {
  const res = await fetch('/api' + path, {
    method, signal, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'devhub', ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, code: data.code });
  return data;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14));
export const fmtBytes = (n) => { if (n == null) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i]; };
export const fmtDate = (t) => { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null); i.click();
  });
}
export const readText = (f) => f.text();
export const readBase64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); });

/* Docs store hook: list + optimistic save/remove (saves are debounced per id) */
import { useState, useEffect, useCallback, useRef } from 'react';
export const docsChanged = (kind) => window.dispatchEvent(new CustomEvent('postern:docs-changed', { detail: kind }));
export function useDocs(kind) {
  const [items, setItems] = useState(null);
  const timers = useRef({});
  useEffect(() => {
    let on = true; const load = () => api('/docs/' + kind).then(d => on && setItems(d)).catch(() => on && setItems(p => p || []));
    load();
    const h = (e) => { if (e.detail === kind) load(); }; window.addEventListener('postern:docs-changed', h); // another screen added documents of this kind
    return () => { on = false; window.removeEventListener('postern:docs-changed', h); };
  }, [kind]);
  const save = useCallback((doc, { immediate } = {}) => {
    setItems(prev => { const rest = (prev || []).filter(x => x.id !== doc.id); return [doc, ...rest]; });
    clearTimeout(timers.current[doc.id]);
    const run = () => api(`/docs/${kind}/${doc.id}`, { method: 'PUT', body: doc }).catch(() => {});
    if (immediate) return run();
    timers.current[doc.id] = setTimeout(run, 400);
  }, [kind]);
  const remove = useCallback((id) => { setItems(p => (p || []).filter(x => x.id !== id)); return api(`/docs/${kind}/${id}`, { method: 'DELETE' }); }, [kind]);
  const clear = useCallback(() => { setItems([]); return api(`/docs/${kind}`, { method: 'DELETE' }); }, [kind]);
  const bulk = useCallback(async (list) => { await api(`/docs/${kind}/bulk`, { method: 'POST', body: { items: list } }); setItems(p => [...list, ...(p || []).filter(x => !list.some(l => l.id === x.id))]); }, [kind]);
  return { items, save, remove, clear, bulk, setItems };
}
