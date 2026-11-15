import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api.js';

export const ACTIONS = { transfer: 'Transfer (upload / download)', edit: 'Edit in built-in editor', preview: 'Preview in a new tab', ask: 'Ask every time' };
export const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const ID = 'sftp-prefs', EVT = 'devhub-prefs';
const DEF = { id: ID, assoc: {}, default: 'transfer' };
const clean = (p) => ({ id: ID, default: ACTIONS[p?.default] ? p.default : 'transfer', assoc: Object.fromEntries(Object.entries(p?.assoc || {}).filter(([k, v]) => /^[\w+-]{1,16}$/.test(k) && ACTIONS[v])) });

/* Per-file-type default actions, stored (encrypted at rest) in the user's settings docs; kept in sync across components. */
export function usePrefs() {
  const [prefs, setPrefs] = useState(DEF);
  useEffect(() => {
    let on = true;
    api('/docs/settings').then(l => on && setPrefs(clean(l.find(x => x.id === ID)))).catch(() => {});
    const h = (e) => setPrefs(e.detail); addEventListener(EVT, h);
    return () => { on = false; removeEventListener(EVT, h); };
  }, []);
  const update = useCallback((fn) => setPrefs(prev => {
    const next = clean(fn(prev));
    api(`/docs/settings/${ID}`, { method: 'PUT', body: next }).catch(() => {});
    setTimeout(() => dispatchEvent(new CustomEvent(EVT, { detail: next })));
    return next;
  }), []);
  const setAssoc = useCallback((ext, action) => update(p => { const a = { ...p.assoc }; action ? a[ext] = action : delete a[ext]; return { ...p, assoc: a }; }), [update]);
  const setDefault = useCallback((d) => update(p => ({ ...p, default: d })), [update]);
  return { prefs, setAssoc, setDefault, actionFor: (name) => prefs.assoc[extOf(name)] || prefs.default };
}
