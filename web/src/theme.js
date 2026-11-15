import { useSyncExternalStore } from 'react';
/* Appearance preferences (per browser): mode, theme colour, selection strength, contrast, button colour. */
export const BRANDS = { Rose: '#e11d48', Blue: '#2563eb', Violet: '#7c3aed', Teal: '#0d9488', Orange: '#ea580c', Slate: '#64748b' };
export const DEFAULTS = { mode: 'dark', brand: BRANDS.Rose, selection: 'light', contrast: 'standard', buttons: 'standard' };
const MIX = { light: '10%', medium: '18%', strong: '28%' };
const load = () => { try { return { ...DEFAULTS, mode: localStorage.getItem('dh.theme') || 'dark', ...JSON.parse(localStorage.getItem('dh.appearance') || '{}') }; } catch { return { ...DEFAULTS }; } };
let prefs = load();
const subs = new Set();
export function applyAppearance(p = prefs) {
  const r = document.documentElement;
  r.dataset.theme = p.mode === 'light' ? 'light' : 'dark';
  r.dataset.contrast = ['soft', 'high'].includes(p.contrast) ? p.contrast : 'standard';
  const brand = /^#[0-9a-f]{6}$/i.test(p.brand) ? p.brand : DEFAULTS.brand;
  r.style.setProperty('--brand', brand);
  r.style.setProperty('--selmix', MIX[p.selection] || MIX.light);
  if (p.buttons === 'theme') r.style.setProperty('--accent', brand); else r.style.removeProperty('--accent');
}
export function setAppearance(patch) {
  prefs = { ...prefs, ...patch };
  localStorage.setItem('dh.appearance', JSON.stringify(prefs)); localStorage.setItem('dh.theme', prefs.mode);
  applyAppearance(); subs.forEach(f => f());
}
export function useAppearance() { return [useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => prefs), setAppearance]; }
applyAppearance();
