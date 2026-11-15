import { useSyncExternalStore } from 'react';
/* Tiny global activity store: modules publish running work, the bottom status bar shows it. */
let state = { jobs: {}, last: null };
const subs = new Set();
const emit = () => subs.forEach(f => f());
export function setJob(key, job) { const jobs = { ...state.jobs }; if (job) jobs[key] = job; else delete jobs[key]; state = { ...state, jobs }; emit(); }
export function setLast(last) { state = { ...state, last }; emit(); }
export function useStatus() { return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => state); }
