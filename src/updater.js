// Sparkle Cleaner — Copyright (c) 2026 Harshal Patil. MIT License (see LICENSE).
// Self-update helper: verify a release zip, unpack it in memory and write it into the extension folder
// the user picked (File System Access API). Chrome can't let an extension overwrite its own files any
// other way. Nothing is written until the zip's SHA-256, manifest name and version have all been checked.
const Updater = (() => {
  const MAX_ZIP = 50 * 1024 * 1024, MAX_FILE = 20 * 1024 * 1024, MAX_TOTAL = 60 * 1024 * 1024;
  const u16 = (d, o) => d[o] | d[o + 1] << 8;
  const u32 = (d, o) => (d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24) >>> 0;
  const dec = new TextDecoder();

  const parseVer = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n) || 0);
  const newer = (a, b) => { const x = parseVer(a), y = parseVer(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

  async function sha256Hex(buf) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function inflateRaw(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // Minimal zip reader (stored + deflate, no zip64, no encryption) driven by the central directory.
  async function unzip(buf) {
    const d = new Uint8Array(buf);
    let e = -1;
    for (let i = d.length - 22; i >= Math.max(0, d.length - 22 - 65557); i--) if (u32(d, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Not a zip file');
    const n = u16(d, e + 10); let p = u32(d, e + 16);
    if (n === 0xFFFF || p === 0xFFFFFFFF) throw new Error('Zip64 archives are not supported');
    const files = []; let total = 0;
    for (let k = 0; k < n; k++) {
      if (u32(d, p) !== 0x02014b50) throw new Error('Corrupt zip directory');
      const flag = u16(d, p + 8), method = u16(d, p + 10), csize = u32(d, p + 20), usize = u32(d, p + 24);
      const nl = u16(d, p + 28), xl = u16(d, p + 30), cl = u16(d, p + 32), lo = u32(d, p + 42);
      const name = dec.decode(d.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;
      if (flag & 1) throw new Error('Encrypted zip entries are not supported');
      if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF) throw new Error('Zip64 entries are not supported');
      if (usize > MAX_FILE || (total += usize) > MAX_TOTAL) throw new Error('Zip is too large to be this extension');
      if (u32(d, lo) !== 0x04034b50) throw new Error('Corrupt zip entry: ' + name);
      const ds = lo + 30 + u16(d, lo + 26) + u16(d, lo + 28);
      const raw = d.subarray(ds, ds + csize);
      let data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = await inflateRaw(raw);
      else throw new Error('Unsupported compression method ' + method + ' for ' + name);
      if (data.length !== usize) throw new Error('Size mismatch for ' + name);
      files.push({ name, data });
    }
    return files;
  }

  // Drop OS junk, strip one wrapping folder if manifest.json lives inside it, and reject unsafe paths.
  function normalize(files) {
    files = files.filter(f => !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(f.name));
    if (!files.some(f => f.name === 'manifest.json')) {
      const top = new Set(files.map(f => f.name.split('/')[0]));
      if (top.size === 1) {
        const pre = [...top][0] + '/';
        if (files.some(f => f.name === pre + 'manifest.json')) files = files.map(f => ({ ...f, name: f.name.slice(pre.length) }));
      }
    }
    const seen = new Set();
    for (const f of files) {
      const segs = f.name.split('/');
      if (!f.name || f.name.startsWith('/') || f.name.includes('\\') || /^[a-zA-Z]:/.test(f.name) || segs.some(s => s === '' || s === '.' || s === '..'))
        throw new Error('Unsafe path in zip: ' + f.name);
      if (seen.has(f.name)) throw new Error('Duplicate file in zip: ' + f.name);
      seen.add(f.name);
    }
    return files;
  }

  // `current` = the running manifest; `expected` = version the feed promised.
  function validate(files, current, expected) {
    const m = files.find(f => f.name === 'manifest.json');
    if (!m) throw new Error('Zip has no manifest.json');
    let man; try { man = JSON.parse(dec.decode(m.data)); } catch (_) { throw new Error('Zip manifest.json is not valid JSON'); }
    if (man.name !== current.name) throw new Error(`Zip is for "${man.name}", not "${current.name}"`);
    if (!man.version) throw new Error('Zip manifest has no version');
    if (expected && man.version !== expected) throw new Error(`Zip is version ${man.version}, but the feed announced ${expected}`);
    if (!newer(man.version, current.version)) throw new Error(`Zip version ${man.version} is not newer than ${current.version}`);
    return man;
  }

  async function readText(dir, name) {
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }

  // The picked folder must be the copy that's actually loaded (same name + version in its manifest).
  async function checkFolder(dir, current) {
    let man;
    try { man = JSON.parse(await readText(dir, 'manifest.json')); } catch (_) { throw new Error('That folder has no readable manifest.json — pick the extension folder.'); }
    if (man.name !== current.name || man.version !== current.version)
      throw new Error(`That folder holds "${man.name}" ${man.version}, but the loaded extension is "${current.name}" ${current.version}. Pick the folder you loaded in chrome://extensions.`);
  }

  async function writeAll(dir, files) {
    const ordered = [...files.filter(f => f.name !== 'manifest.json'), ...files.filter(f => f.name === 'manifest.json')]; // manifest last
    for (const f of ordered) {
      const segs = f.name.split('/'); let h = dir;
      for (const s of segs.slice(0, -1)) h = await h.getDirectoryHandle(s, { create: true });
      const w = await (await h.getFileHandle(segs[segs.length - 1], { create: true })).createWritable();
      await w.write(f.data); await w.close();
    }
    return ordered.length;
  }

  async function fetchZip(url, sha256) {
    if (!/^[0-9a-f]{64}$/i.test(sha256 || '')) throw new Error('The update feed has no valid "sha256" — refusing to install an unverified zip.');
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('Download failed: HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_ZIP) throw new Error('Download is too large');
    const got = await sha256Hex(buf);
    if (got !== sha256.toLowerCase()) throw new Error('Checksum mismatch — the download is not what the feed announced. Nothing was changed.');
    return buf;
  }

  // Full pipeline. Throws before touching the folder if anything is off.
  async function apply({ dir, current, zipUrl, sha256, version, onStep = () => {} }) {
    onStep('Checking folder…'); await checkFolder(dir, current);
    onStep('Downloading…'); const buf = await fetchZip(zipUrl, sha256);
    onStep('Verifying…'); const files = normalize(await unzip(buf)); const man = validate(files, current, version);
    onStep('Writing files…'); const n = await writeAll(dir, files);
    return { version: man.version, files: n };
  }

  return { unzip, normalize, validate, checkFolder, writeAll, sha256Hex, newer, apply };
})();
if (typeof module !== 'undefined') module.exports = Updater;
