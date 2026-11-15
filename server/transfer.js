// Pipelined SFTP streaming. The stock stream helpers issue one request per round-trip (~1-5 MB/s);
// keeping a window of requests in flight gets close to wire speed while memory stays bounded
// (window x chunk = 2 MB per transfer).
const CHUNK = 32 * 1024;   // safe for every SFTP server (OpenSSH caps reads at 64 KB)
const WINDOW = 96;         // ~3 MB in flight; SSH channel flow-control is the real ceiling per connection

const call = (fn) => new Promise((res, rej) => fn((err, ...a) => err ? rej(err) : res(a)));

export async function pipelinedDownload(sftp, path, start, size, res, isAborted) {
  const [handle] = await call(cb => sftp.open(path, 'r', cb));
  try {
    const readAt = async (pos, len) => {
      const buf = Buffer.allocUnsafe(len); let got = 0;
      while (got < len) {
        const [n] = await call(cb => sftp.read(handle, buf, got, len - got, pos + got, cb));
        if (!n) break; // EOF
        got += n;
      }
      return got === len ? buf : buf.subarray(0, got);
    };
    let next = start; const q = [];
    while ((q.length || next < size) && !isAborted()) {
      while (q.length < WINDOW && next < size) { const len = Math.min(CHUNK, size - next); q.push(readAt(next, len)); next += len; }
      const buf = await q.shift();
      if (!buf.length) break;
      if (!res.write(buf)) await new Promise(r => res.once('drain', r).once('close', r));
    }
    await Promise.allSettled(q);
  } finally { sftp.close(handle, () => {}); }
}

export async function pipelinedUpload(sftp, path, readable) {
  const [handle] = await call(cb => sftp.open(path, 'w', cb));
  let pos = 0, pending = 0, failure = null, wake = null;
  const signal = () => { const w = wake; wake = null; w?.(); };
  try {
    for await (const chunk of readable) {
      for (let off = 0; off < chunk.length; off += CHUNK) {
        const piece = chunk.subarray(off, off + CHUNK);
        while (pending >= WINDOW && !failure) await new Promise(r => { wake = r; });
        if (failure) throw failure;
        pending++;
        sftp.write(handle, piece, 0, piece.length, pos, (err) => { pending--; if (err) failure = err; signal(); });
        pos += piece.length;
      }
    }
    while (pending > 0) await new Promise(r => { wake = r; });
    if (failure) throw failure;
    return pos;
  } finally {
    while (pending > 0) await new Promise(r => { wake = r; }); // never close the handle with writes in flight
    sftp.close(handle, () => {});
  }
}
