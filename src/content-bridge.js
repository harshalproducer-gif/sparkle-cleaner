// Sparkle Cleaner — Copyright (c) 2026 Harshal Patil. MIT License (see LICENSE).
// Isolated content script: settings bridge, processing requests, toasts/preview, and the floating
// "Clean" button on image/video tiles in Gemini, AI Studio and Flow.
(() => {
  if (window.__scBridge) return; window.__scBridge = true;
  let ui = { enabled: true, autoRemoval: true, floatButton: true, flow: true, skipPreview: false, notify: true };
  const isFlow = location.hostname === 'labs.google';
  const active = () => ui.enabled && (!isFlow || ui.flow);

  const pushCfg = () => window.postMessage({ __sc: 'cfg', cfg: { enabled: active(), autoRemoval: ui.autoRemoval } }, '*');
  chrome.storage.local.get('ui').then(r => { ui = { ...ui, ...(r.ui || {}) }; pushCfg(); refreshPills(); });
  chrome.storage.onChanged.addListener(ch => { if (ch.ui) { ui = { ...ui, ...ch.ui.newValue }; pushCfg(); refreshPills(); } });

  // ---------- toast + preview ----------
  const root = () => { let r = document.getElementById('sc-root'); if (!r) { r = document.createElement('div'); r.id = 'sc-root'; (document.body || document.documentElement).appendChild(r); } return r; };
  function toast(text, { sticky = false, kind = '' } = {}) {
    if (!ui.notify && !sticky) return { set() {}, close() {} };
    const el = document.createElement('div'); el.className = 'sc-toast ' + kind; el.textContent = text; root().appendChild(el);
    const close = () => el.remove(); if (!sticky) setTimeout(close, 3500);
    return { set: (t, k = '') => { el.textContent = t; el.className = 'sc-toast ' + k; if (!sticky) setTimeout(close, 3500); }, close };
  }
  const preview = (blob, isVideo) => new Promise(res => {
    const url = URL.createObjectURL(blob), m = document.createElement('div'); m.className = 'sc-modal';
    m.innerHTML = `<div class="sc-card"><div class="sc-title">Watermark removed — review</div><div class="sc-media"></div>
      <div class="sc-row"><button class="sc-btn ghost" data-a="no">Cancel</button><button class="sc-btn" data-a="yes">Download</button></div></div>`;
    const el = document.createElement(isVideo ? 'video' : 'img'); el.src = url; if (isVideo) { el.controls = true; el.muted = true; el.loop = true; el.autoplay = true; }
    m.querySelector('.sc-media').appendChild(el); root().appendChild(m);
    m.addEventListener('click', e => { const a = e.target.dataset && e.target.dataset.a; if (!a && e.target !== m) return; m.remove(); URL.revokeObjectURL(url); res(a === 'yes'); });
  });

  // ---------- processing ----------
  const blobToDataUrl = b => new Promise((r, j) => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = j; f.readAsDataURL(b); });
  const dataUrlToBlob = async u => (await fetch(u)).blob();
  const OKTYPE = /^(image\/(png|jpeg|webp)|video\/mp4)$/;

  async function getBlob(url) {
    if (/^(blob:|data:)/.test(url)) return (await fetch(url)).blob();
    try { const r = await fetch(url, { credentials: 'include' }); if (r.ok) return await r.blob(); } catch {}
    const r = await chrome.runtime.sendMessage({ type: 'wm-fetch', url });
    if (!r?.ok) throw new Error(r?.error || 'fetch failed');
    return dataUrlToBlob(r.dataUrl);
  }
  const fullRes = u => { try { const x = new URL(u); if (/googleusercontent\.com$/.test(x.hostname)) return u.replace(/=[swh]\d[^/?#]*$/i, '=s0'); } catch {} return u; };
  const nameFor = (name, url, ext) => {
    let n = name || ''; if (!n) { try { n = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || ''); } catch {} }
    n = (n || 'image').replace(/\.[a-z0-9]{2,4}$/i, ''); return `${n.slice(0, 80) || 'image'}.${ext}`;
  };
  function save(blob, filename) {
    const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  // Returns 'done' when the cleaned file was handled, 'proceed' to let the original download happen.
  async function cleanAndSave({ blob, url, name }) {
    const t = toast('Removing watermark…', { sticky: true });
    try {
      if (!blob) blob = await getBlob(url);
      if (!OKTYPE.test(blob.type)) { t.close(); return 'proceed'; }
      const isVideo = blob.type.startsWith('video/');
      if (isVideo) t.set('Removing watermark from video — this takes about as long as the clip…');
      await chrome.runtime.sendMessage({ type: 'wm-ensure' });
      const r = await chrome.runtime.sendMessage({ type: 'wm-process', dataUrl: await blobToDataUrl(blob) });
      t.close();
      if (!r?.ok) { toast('Error: ' + (r?.error || 'processing failed'), { kind: 'err' }); return 'proceed'; }
      if (!r.found) { toast(r.note + ' Downloading original.', { kind: 'warn' }); return 'proceed'; }
      const out = await dataUrlToBlob(r.dataUrl);
      if (!ui.skipPreview && !(await preview(out, isVideo))) return 'done';
      save(out, nameFor(name, url, r.ext)); toast('Watermark removed — saved.', { kind: 'ok' });
      return 'done';
    } catch (e) { t.close(); toast('Error: ' + (e.message || e), { kind: 'err' }); return 'proceed'; }
  }

  window.addEventListener('message', async e => {
    const d = e.data; if (e.source !== window || !d || !d.__sc) return;
    if (d.__sc === 'need-cfg') pushCfg();
    else if (d.__sc === 'req' && d.kind === 'download') {
      const action = await cleanAndSave({ blob: d.blob, url: d.href, name: d.name });
      window.postMessage({ __sc: 'res', id: d.id, action }, '*');
    }
  });

  // ---------- floating button on media tiles ----------
  const pills = new Map(); // element -> pill
  let layer = null, dirty = true;
  const getLayer = () => layer || (layer = Object.assign(document.createElement('div'), { id: 'sc-layer' }), (document.body || document.documentElement).appendChild(layer), layer);
  const candidate = el => { const r = el.getBoundingClientRect(); return r.width >= 120 && r.height >= 120 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const srcOf = el => el.currentSrc || el.src || '';

  function makePill(el) {
    const b = document.createElement('button'); b.className = 'sc-pill'; b.type = 'button';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg><span>Clean</span>';
    b.title = 'Remove watermark and download';
    b.addEventListener('click', async ev => {
      ev.preventDefault(); ev.stopPropagation();
      const url = fullRes(srcOf(el)); if (!url) return toast('No media source found on this item.', { kind: 'warn' });
      b.classList.add('busy'); await cleanAndSave({ url }); b.classList.remove('busy');
    }, true);
    getLayer().appendChild(b); return b;
  }
  function refreshPills() {
    const show = active() && ui.floatButton;
    for (const [el, p] of pills) {
      if (!show || !el.isConnected || !candidate(el)) { p.style.display = 'none'; if (!el.isConnected) { p.remove(); pills.delete(el); } continue; }
      const r = el.getBoundingClientRect(); p.style.display = ''; p.style.left = Math.max(4, r.left + 8) + 'px'; p.style.top = Math.max(4, r.top + 8) + 'px';
    }
    dirty = false;
  }
  function scan() {
    if (!(active() && ui.floatButton)) return refreshPills();
    document.querySelectorAll('img, video').forEach(el => {
      if (pills.has(el) || el.closest('#sc-root, #sc-layer')) return;
      if (candidate(el) && srcOf(el)) pills.set(el, makePill(el));
    });
    refreshPills();
  }
  const mark = () => { dirty = true; };
  addEventListener('scroll', mark, true); addEventListener('resize', mark);
  new MutationObserver(mark).observe(document, { childList: true, subtree: true });
  setInterval(() => { if (document.body) { scan(); } }, 800);
  (function loop() { if (dirty) refreshPills(); requestAnimationFrame(loop); })();
})();
