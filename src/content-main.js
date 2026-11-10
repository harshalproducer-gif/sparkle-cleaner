// Sparkle Cleaner — Copyright (c) 2026 Harshal Patil. MIT License (see LICENSE).
// Runs in the page's own JS world: intercepts Gemini/Flow download clicks and hands the file to the
// extension (content-bridge.js) to be cleaned before it is saved.
(() => {
  if (window.__scHooked) return; window.__scHooked = true;
  let cfg = { enabled: true, autoRemoval: true };
  const pending = new Map(), bypass = new WeakSet(), busy = new Set();
  let seq = 0;
  const origClick = HTMLAnchorElement.prototype.click;

  window.addEventListener('message', e => {
    const d = e.data; if (e.source !== window || !d || !d.__sc) return;
    if (d.__sc === 'cfg') cfg = d.cfg;
    else if (d.__sc === 'res' && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  });
  window.postMessage({ __sc: 'need-cfg' }, '*');

  const looksMedia = a => {
    const h = a.href || ''; if (!h) return false;
    if (h.startsWith('blob:') || h.startsWith('data:image') || h.startsWith('data:video')) return true;
    try { const u = new URL(h); return /googleusercontent\.com$|storage\.googleapis\.com$/.test(u.hostname) || /\.(png|jpe?g|webp|mp4)(\?|$)/i.test(u.pathname); } catch { return false; }
  };
  const should = a => cfg.enabled && cfg.autoRemoval && !bypass.has(a) && looksMedia(a) && (a.hasAttribute('download') || (a.href || '').startsWith('blob:'));

  async function intercept(a) {
    const href = a.href, name = a.getAttribute('download') || '';
    if (busy.has(href)) return; busy.add(href);
    const proceed = () => { bypass.add(a); origClick.call(a); setTimeout(() => busy.delete(href), 1000); };
    let blob = null;
    try { if (/^(blob:|data:)/.test(href)) blob = await (await fetch(href)).blob(); } catch { return proceed(); }
    const id = ++seq;
    const res = await new Promise(r => { pending.set(id, r); window.postMessage({ __sc: 'req', id, kind: 'download', href, name, blob }, '*'); setTimeout(() => { if (pending.delete(id)) r({ action: 'proceed' }); }, 10 * 60 * 1000); });
    busy.delete(href);
    if (res.action === 'proceed') { bypass.add(a); origClick.call(a); }
  }

  HTMLAnchorElement.prototype.click = function () {
    if (!should(this)) return origClick.apply(this, arguments);
    intercept(this);
  };
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || !should(a)) return;
    e.preventDefault(); e.stopImmediatePropagation(); intercept(a);
  }, true);
})();
