'use strict';
// Deliberately minimal: the page gets no Node and no native API. It only reports user activity for the idle timer.
const { ipcRenderer } = require('electron');
let last = 0;
for (const ev of ['mousemove', 'mousedown', 'wheel', 'touchstart']) {
  window.addEventListener(ev, () => { const n = Date.now(); if (n - last > 5000) { last = n; ipcRenderer.send('postern:activity'); } }, { passive: true, capture: true });
}
