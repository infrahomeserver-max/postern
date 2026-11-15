// POSTERN_* names are the public ones; the older DEVHUB_* names keep working.
for (const k of Object.keys(process.env)) {
  if (k.startsWith('POSTERN_') && k !== 'POSTERN_DATA' && k !== 'POSTERN_BROWSER' && k !== 'POSTERN_BROWSER_ARGS') {
    const old = 'DEVHUB_' + k.slice(8);
    if (process.env[old] === undefined) process.env[old] = process.env[k];
  }
}
