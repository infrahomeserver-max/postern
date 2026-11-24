'use strict';
// Deliberately minimal: the page gets no Node and no native API. It only reports user activity for the idle timer.
const { ipcRenderer } = require('electron');
let last = 0;
for (const ev of ['mousemove', 'mousedown', 'wheel', 'touchstart']) {
  window.addEventListener(ev, () => { const n = Date.now(); if (n - last > 5000) { last = n; ipcRenderer.send('postern:activity'); } }, { passive: true, capture: true });
}

// Narrow bridge for the native menu: the page can say whether someone is signed in, and receive a fixed set of menu commands.
const { contextBridge } = require('electron');
const CMDS = new Set(['nav:api', 'nav:sftp', 'nav:mock', 'nav:settings', 'newTab', 'closeTab', 'toggleSide', 'theme', 'signout', 'shortcuts', 'focusUrl']);
contextBridge.exposeInMainWorld('posternShell', {
  setAuth: (v) => ipcRenderer.send('postern:auth', v === true),
  getPort: () => ipcRenderer.invoke('postern:get-port'),
  setPort: (n) => ipcRenderer.invoke('postern:set-port', Number(n) || 0),
  onCommand: (cb) => { const h = (_e, c) => { if (CMDS.has(c)) cb(c); }; ipcRenderer.on('postern:cmd', h); return () => ipcRenderer.removeListener('postern:cmd', h); },
});
