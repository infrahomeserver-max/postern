/* Interface preferences (per browser/profile): zoom, density, confirm-on-close, history, wrapping. */
import { useState, useEffect } from 'react';
const KEY = 'dh.ui';
export const UI_DEFAULTS = { zoom: 100, density: 'comfortable', confirmClose: true, keepHistory: true, confirmSend: true, confirmSendSecs: 3, wrapLines: false, reduceMotion: false };
export const loadUi = () => { try { return { ...UI_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...UI_DEFAULTS }; } };
export function applyUi(p = loadUi()) {
  const r = document.documentElement;
  const z = Math.min(150, Math.max(80, Number(p.zoom) || 100));
  r.style.zoom = z === 100 ? '' : String(z / 100);
  r.dataset.density = p.density === 'compact' ? 'compact' : 'comfortable';
  r.dataset.wrap = p.wrapLines ? '1' : '0';
  r.dataset.motion = p.reduceMotion ? 'reduce' : 'normal';
}
export function setUi(patch) {
  const n = { ...loadUi(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ }
  applyUi(n); dispatchEvent(new Event('postern:ui')); return n;
}
export function useUi() {
  const [p, setP] = useState(loadUi);
  useEffect(() => { const h = () => setP(loadUi()); addEventListener('postern:ui', h); return () => removeEventListener('postern:ui', h); }, []);
  return [p, setUi];
}
applyUi();
