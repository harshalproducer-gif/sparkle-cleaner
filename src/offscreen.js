// Sparkle Cleaner — Copyright (c) 2026 Harshal Patil. MIT License (see LICENSE).
const dataUrlToBlob = async u => (await fetch(u)).blob();
const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type !== 'wm-process') return false;
  (async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const blob = await dataUrlToBlob(msg.dataUrl);
    const res = blob.type.startsWith('video/') ? await WM.processVideo(blob, settings || {}) : await WM.processImage(blob, settings || {});
    send({ ok: true, found: res.found, note: res.note, ext: res.ext, mime: res.blob.type, dataUrl: res.found ? await toDataUrl(res.blob) : null });
  })().catch(e => send({ ok: false, error: String(e && e.message || e) }));
  return true;
});
