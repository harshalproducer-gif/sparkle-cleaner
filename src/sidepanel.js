// Sparkle Cleaner — Copyright (c) 2026 Harshal Patil. MIT License (see LICENSE).
const $ = s => document.querySelector(s);
const SPEC = [
  { k: 'maskScale', label: 'Mask size ×', sub: 'grow the treated area', tip: 'Scales the removal mask. Raise slightly if a faint outline remains.', min: 0.5, max: 2, step: 0.05, fmt: v => v.toFixed(2) + '×' },
  { k: 'gain', label: 'Alpha gain', sub: '1.00 = auto-measured opacity', tip: 'Multiplies the (auto-measured) logo opacity that is subtracted. Lower if the area looks too dark, raise if a ghost remains.', min: 0.2, max: 2, step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'prior', label: 'Trust auto-position if match ≥', tip: 'Minimum match to trust the width-relative default position. (re-detects)', min: 0, max: 1, step: 0.01, fmt: v => v.toFixed(2), detect: true },
  { k: 'minNcc', label: 'Min match to accept detection', tip: 'Correlation needed before anything is removed. Higher = safer, lower = catches faint logos. (re-detects)', min: 0, max: 1, step: 0.01, fmt: v => v.toFixed(2), detect: true },
  { k: 'stride', label: 'Scan stride (px)', tip: 'Step of the position search. Lower is slower but finer. (re-detects)', min: 1, max: 12, step: 1, fmt: v => String(v), detect: true },
  { k: 'refine', label: 'Refine radius (px)', tip: 'How far the final position is refined around the best hit. (re-detects)', min: 0, max: 12, step: 1, fmt: v => String(v), detect: true },
  { k: 'skipBelow', label: 'Skip pixels below α', tip: 'Ignore logo pixels fainter than this opacity.', min: 0, max: 0.05, step: 0.001, fmt: v => v.toFixed(3) },
  { k: 'alphaCeil', label: 'Alpha ceiling', tip: 'Cap on opacity used for the inverse (avoids dividing by ~0).', min: 0.5, max: 1, step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'logoLuma', label: 'Logo luma', tip: 'Brightness of the logo colour (255 = white).', min: 0, max: 255, step: 1, fmt: v => String(v) },
  { k: 'cleanup', label: 'Edge cleanup', tip: 'Strength of the repair along the logo outline. Above ~0.8 can soften thin tips.', min: 0, max: 1, step: 0.05, fmt: v => v.toFixed(2) }
];
const DETECT_KEYS = new Set(['logo', ...SPEC.filter(c => c.detect).map(c => c.k)]);
const UI_DEFAULTS = { enabled: true, autoRemoval: true, floatButton: true, flow: true, skipPreview: false, notify: true, autoDownload: true, dark: false };
const VN = { 48: 'standard 48', 96: 'standard 96', '96b': '2026 variant' };
let S = { ...WM.DEFAULTS }, ui = { ...UI_DEFAULTS };

// ---- state ----
let file = null, isVideo = false, plan = null, hint = null, corner = null, pv = null;
let origCv = null, work = null, done = null, token = 0, imgBmp = null;
const cv = $('#cv'), vid = $('#vid'), cctx = cv.getContext('2d');
const nextPaint = () => new Promise(r => setTimeout(r, 20));
function setStatus(t) { $('#status').textContent = t; }
function busy(t) { $('#busy').hidden = !t; $('#busyText').textContent = t || ''; }
function enableSettings(on) { $('#controls').classList.toggle('disabled', !on); $('#hint').hidden = on; }

// ---- controls ----
function buildControls() {
  const box = $('#controls');
  box.innerHTML = `<div class="ctl"><div class="lab">Watermark logo <small>(2026 = updated Gemini sparkle)</small></div>
    <select id="logo"><option value="auto">Auto-detect</option><option value="48">Standard 48px</option><option value="96">Standard 96px</option><option value="96b">2026 updated sparkle</option></select></div>`;
  for (const c of SPEC) {
    const d = document.createElement('div'); d.className = 'ctl';
    d.innerHTML = `<div class="lab">${c.label} ${c.sub ? `<small>(${c.sub})</small>` : ''}<span class="q" title="${c.tip}">?</span><span class="sp"></span>
      <button class="step" data-d="-1">−</button><span class="val"></span><button class="step" data-d="1">+</button></div>
      <input type="range" min="${c.min}" max="${c.max}" step="${c.step}">`;
    const r = d.querySelector('input'), val = d.querySelector('.val');
    const set = v => { v = Math.min(c.max, Math.max(c.min, +(+v).toFixed(4))); S[c.k] = v; r.value = v; val.textContent = c.fmt(v); r.style.setProperty('--p', ((v - c.min) / (c.max - c.min) * 100) + '%'); };
    d._set = set; d.dataset.k = c.k;
    r.oninput = () => { set(r.value); changed(c.k); };
    d.querySelectorAll('.step').forEach(b => b.onclick = () => { set(S[c.k] + b.dataset.d * c.step); changed(c.k); });
    box.appendChild(d);
  }
  $('#logo').onchange = e => { S.logo = e.target.value; changed('logo'); };
  syncControls();
}
function syncControls() { $('#logo').value = S.logo; document.querySelectorAll('#controls .ctl[data-k]').forEach(d => d._set(S[d.dataset.k])); }

let rafPending = false, detTimer = null;
function changed(key) {
  if (!origCv) return;
  invalidateDone();
  if (DETECT_KEYS.has(key)) { clearTimeout(detTimer); detTimer = setTimeout(async () => { await redetect(); }, 350); }
  if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; render(); }); }
}

// ---- detection + live render ----
async function detect() {
  if (isVideo) {
    plan = await WM.detectVideo(pv, S, hint, corner);
    return plan ? (plan.kind === 'veo' ? `Veo text mark found at ${plan.x},${plan.y} (${plan.w}×${plan.h}, match ${plan.ncc.toFixed(2)}, opacity ${plan.g.toFixed(2)}).` : `Sparkle found at ${plan.f.x},${plan.f.y} (${plan.f.n}×${plan.f.h || plan.f.n}px, ${VN[plan.f.s.id]}, match ${plan.f.ncc.toFixed(2)}, auto opacity ×${plan.f.g.toFixed(2)}).`)
                : 'No watermark detected. Click the sparkle on the preview, or lower “Min match”.';
  }
  const c = origCv.getContext('2d', { willReadFrequently: true });
  const f = WM.findSparkle(c, origCv.width, origCv.height, S, hint);
  if (f && f.ncc >= f.min) { f.g = WM.estimateGain(c, f); plan = { kind: 'sparkle', f }; return `Sparkle found at ${f.x},${f.y} (${f.n}×${f.h || f.n}px, ${VN[f.s.id]}, match ${f.ncc.toFixed(2)}, auto opacity ×${f.g.toFixed(2)}).`; }
  plan = null; return `No Gemini sparkle detected (best match ${f ? f.ncc.toFixed(2) : '0'}). Click the sparkle on the preview, or lower “Min match”.`;
}
async function redetect() {
  const t = ++token; busy('Detecting…'); await nextPaint();
  try { const note = await detect(); if (t !== token) return; setStatus(note); } catch (e) { setStatus('Error: ' + (e.message || e)); }
  busy(null); render();
}
function render() {
  if (!origCv) return;
  if (!work || work.width !== origCv.width || work.height !== origCv.height) work = WM.canvasOf(origCv.width, origCv.height);
  const wc = work.getContext('2d', { willReadFrequently: true });
  wc.drawImage(origCv, 0, 0); WM.applyPlan(wc, plan, S);
  if (cv.width !== work.width) { cv.width = work.width; cv.height = work.height; }
  cctx.drawImage(work, 0, 0);
  drawZoom();
  updateMainButton();
}
function drawZoom() {
  const box = $('#zoomBox'); box.hidden = false;
  const W = origCv.width, H = origCv.height;
  let cx = W - 90, cy = H - 90, side = 200;
  if (plan) { const f = plan.kind === 'veo' ? { x: plan.x, y: plan.y, n: Math.max(plan.w, plan.h) } : plan.f; cx = f.x + (plan.kind === 'veo' ? plan.w : f.n) / 2; cy = f.y + (plan.kind === 'veo' ? plan.h : f.n) / 2; side = Math.round(Math.max(f.n, f.h || f.n) * 2.2); }
  side = Math.max(60, Math.min(side, W, H)); const sx = Math.max(0, Math.min(W - side, Math.round(cx - side / 2))), sy = Math.max(0, Math.min(H - side, Math.round(cy - side / 2)));
  for (const [id, src] of [['#zb', origCv], ['#za', work]]) { const z = $(id).getContext('2d'); z.imageSmoothingEnabled = false; z.clearRect(0, 0, 180, 180); z.drawImage(src, sx, sy, side, side, 0, 0, 180, 180); }
}

// ---- main button (image: Download | video: Process video → Download) ----
function updateMainButton() {
  const b = $('#download'), t = $('#dlText');
  if (isVideo) { t.textContent = done ? 'Download' : 'Process video'; b.disabled = !plan && !done; }
  else { t.textContent = 'Download'; b.disabled = !plan; }
}
function invalidateDone() { if (done) { done = null; vid.pause(); vid.hidden = true; cv.hidden = false; updateMainButton(); } }
function saveBlob(blob, ext) {
  const base = (file.name || 'file').replace(/\.[^.]+$/, ''), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${base}-clean.${ext}`; a.click();
}
$('#download').onclick = async () => {
  if (!origCv) return;
  if (!isVideo) {
    const type = ['image/jpeg', 'image/webp'].includes(file.type) ? file.type : 'image/png';
    const blob = await new Promise(r => work.toBlob(r, type, 0.97)); return saveBlob(blob, type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png');
  }
  if (done) return saveBlob(done.blob, done.ext);
  const t = ++token; busy('Processing video… (plays in real time)'); $('#download').disabled = true;
  try {
    const r = await WM.processVideo(file, S, p => { if (t === token) $('#busyText').textContent = `Processing video… ${p}%`; }, plan);
    busy(null); if (t !== token) return;
    if (!r.found) return setStatus(r.note);
    done = r; setStatus(r.note + ' Preview below — press Download to save.');
    vid.src = URL.createObjectURL(r.blob); vid.hidden = false; cv.hidden = true; vid.play(); updateMainButton();
    if (ui.autoDownload) saveBlob(r.blob, r.ext);
  } catch (e) { busy(null); setStatus('Error: ' + (e.message || e)); updateMainButton(); }
};

// ---- loading ----
async function load(f) {
  const t = ++token; file = f; isVideo = f.type.startsWith('video/'); plan = null; hint = null; corner = null; done = null; work = null;
  if (pv && pv._url) URL.revokeObjectURL(pv._url); pv = null; vid.hidden = true; cv.hidden = false;
  $('#previewBox').hidden = false; $('#hold').hidden = true; $('#scrubRow').hidden = !isVideo; enableSettings(true);
  busy(isVideo ? 'Analysing video…' : 'Detecting…'); await nextPaint();
  try {
    if (isVideo) {
      pv = await WM.loadVideo(f); corner = await WM.sampleCorner(pv);
      $('#scrub').value = 400; await grabFrame(0.4);
    } else {
      const bmp = await createImageBitmap(f); origCv = WM.canvasOf(bmp.width, bmp.height); origCv.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
    }
    const note = await detect(); if (t !== token) return; setStatus(note);
  } catch (e) { setStatus('Error: ' + (e.message || e)); }
  busy(null); render(); $('#hold').hidden = false;
}
async function grabFrame(frac) {
  await WM.seek(pv, pv.duration * frac);
  if (!origCv || origCv.width !== pv.videoWidth) origCv = WM.canvasOf(pv.videoWidth, pv.videoHeight);
  origCv.getContext('2d', { willReadFrequently: true }).drawImage(pv, 0, 0);
  const s = pv.duration * frac; $('#tcode').textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
let scrubT = null;
$('#scrub').oninput = () => { clearTimeout(scrubT); scrubT = setTimeout(async () => { if (!pv) return; invalidateDone(); await grabFrame($('#scrub').value / 1000); render(); }, 60); };

// ---- preview interactions ----
cv.onclick = async e => {
  if (plan || !origCv) return;
  const r = cv.getBoundingClientRect();
  hint = { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
  await redetect(); if (!plan) hint = null;
};
const hold = $('#hold');
hold.onmousedown = () => { if (origCv && !cv.hidden) cctx.drawImage(origCv, 0, 0); };
hold.onmouseup = hold.onmouseleave = () => { if (work && !cv.hidden) cctx.drawImage(work, 0, 0); };

// ---- file input ----
const drop = $('#drop'), fi = $('#file');
fi.onchange = () => fi.files[0] && load(fi.files[0]);
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); };

// ---- footer + header + settings view ----
$('#reset').onclick = () => { S = { ...WM.DEFAULTS }; syncControls(); changed('logo'); };
$('#save').onclick = async () => { await chrome.storage.local.set({ settings: S }); const b = $('#save'); const t = b.lastChild.textContent; b.lastChild.textContent = 'Saved ✓'; setTimeout(() => (b.lastChild.textContent = t), 1200); };
$('#guideBtn').onclick = () => { $('#guide').hidden = !$('#guide').hidden; };
function applyUi() {
  document.documentElement.dataset.theme = ui.dark ? 'dark' : 'light';
  $('#power').classList.toggle('on', ui.enabled);
  document.querySelectorAll('[data-ui]').forEach(i => (i.checked = !!ui[i.dataset.ui]));
}
async function setUi(patch) { ui = { ...ui, ...patch }; applyUi(); await chrome.storage.local.set({ ui }); }
$('#power').onclick = () => setUi({ enabled: !ui.enabled });
$('#moon').onclick = () => setUi({ dark: !ui.dark });
$('#gear').onclick = () => { $('#viewMain').hidden = true; $('#viewSettings').hidden = false; $('#tabTitle').textContent = 'Settings'; };
$('#back').onclick = () => { $('#viewMain').hidden = false; $('#viewSettings').hidden = true; $('#tabTitle').textContent = 'Remove watermark'; };
document.querySelectorAll('[data-ui]').forEach(i => (i.onchange = () => setUi({ [i.dataset.ui]: i.checked })));
$('#resetAll').onclick = async () => { S = { ...WM.DEFAULTS }; await chrome.storage.local.set({ settings: S }); syncControls(); await setUi({ ...UI_DEFAULTS }); };
$('#ver').textContent = chrome.runtime.getManifest().version;

(async () => {
  const st = await chrome.storage.local.get(['settings', 'ui']);
  S = { ...WM.DEFAULTS, ...(st.settings || {}) }; ui = { ...UI_DEFAULTS, ...(st.ui || {}) };
  buildControls(); applyUi(); enableSettings(false);
})();

// ---- updates ----
const fmtAgo = t => { const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'today' : d + ' day' + (d > 1 ? 's' : '') + ' ago'; };
async function renderUpdates() {
  const { updates, updateFeed } = await chrome.storage.local.get(['updates', 'updateFeed']);
  $('#updFeed').value = updateFeed || '';
  $('#updInfo').textContent = updates?.lastCheck ? 'Last checked ' + fmtAgo(updates.lastCheck) + (updates.errors?.length ? ' (some sources unreachable)' : '') : 'Not checked yet';
  const box = $('#updList'); box.textContent = '';
  for (const p of updates?.pending || []) {
    const d = document.createElement('div'); d.className = 'row';
    const s = document.createElement('div');
    s.textContent = p.kind === 'self' ? `Sparkle Cleaner ${p.from} → ${p.to}` : `${p.repo} ${p.from} → ${p.to}`;
    const a = document.createElement('a'); a.href = p.url; a.target = '_blank'; a.textContent = 'View'; a.className = 'link';
    d.append(s, a);
    if (p.kind === 'self') {
      const ap = document.createElement('button'); ap.className = 'btn mid'; ap.style.cssText = 'flex:none;padding:0 12px'; ap.textContent = 'Apply update';
      ap.onclick = () => applyUpdate(p, ap); d.append(ap);
    }
    box.append(d);
  }
  if (updates?.pending?.length) { const b = document.createElement('button'); b.className = 'link'; b.textContent = 'Mark all as seen';
    b.onclick = async () => { updates.pending = []; await chrome.storage.local.set({ updates }); chrome.action.setBadgeText({ text: '' }); renderUpdates(); }; box.append(b); }
}
$('#updNow').onclick = async () => { $('#updInfo').textContent = 'Checking…'; await chrome.runtime.sendMessage({ type: 'wm-check-updates' }); renderUpdates(); };
$('#updFeed').onchange = e => chrome.storage.local.set({ updateFeed: e.target.value.trim() });
$('#reloadExt').onclick = () => chrome.runtime.sendMessage({ type: 'wm-reload' });

// ---- apply update: write the new release into the extension folder the user picked, then reload ----
// Chrome can't let an extension rewrite its own files, so the user grants access to the folder once.
const idb = (mode, fn) => new Promise((res, rej) => {
  const o = indexedDB.open('sparkle-updater', 1);
  o.onupgradeneeded = () => o.result.createObjectStore('kv');
  o.onerror = () => rej(o.error);
  o.onsuccess = () => { const tx = o.result.transaction('kv', mode), r = fn(tx.objectStore('kv')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); };
});
const getDir = () => idb('readonly', s => s.get('extDir')).catch(() => null);
const setUpdStatus = (t, err) => { const el = $('#updStatus'); el.textContent = t; el.style.color = err ? '#d93025' : ''; };
async function renderDir() {
  const h = await getDir();
  $('#dirInfo').textContent = h ? 'Folder: ' + h.name : 'Not chosen — needed to apply updates';
}
$('#pickDir').onclick = async () => {
  try {
    const h = await showDirectoryPicker({ id: 'sparkle-ext', mode: 'readwrite' });
    await Updater.checkFolder(h, chrome.runtime.getManifest());
    await idb('readwrite', s => s.put(h, 'extDir'));
    setUpdStatus('Folder saved: ' + h.name); renderDir();
  } catch (e) { if (e.name !== 'AbortError') setUpdStatus(e.message || String(e), true); }
};
async function applyUpdate(p, btn) {
  btn.disabled = true;
  try {
    if (!p.zip || !p.sha256) throw new Error('This update has no zip + sha256 in the feed, so it can\'t be applied automatically. Use "View" instead.');
    const dir = await getDir();
    if (!dir) throw new Error('Choose the extension folder first (the one you loaded in chrome://extensions).');
    // both prompts need the click's user gesture, so ask before any slow work
    if (await dir.queryPermission({ mode: 'readwrite' }) !== 'granted' && await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Folder access was not granted.');
    const u = new URL(p.zip);
    if (u.protocol !== 'https:') throw new Error('The update zip must be served over https.');
    const origins = [u.origin + '/*'];
    if (u.hostname === 'github.com') origins.push('https://objects.githubusercontent.com/*', 'https://release-assets.githubusercontent.com/*');
    if (!(await chrome.permissions.contains({ origins })) && !(await chrome.permissions.request({ origins }))) throw new Error('Download permission for ' + u.origin + ' was not granted.');
    const r = await Updater.apply({ dir, current: chrome.runtime.getManifest(), zipUrl: p.zip, sha256: p.sha256, version: p.to, onStep: s => setUpdStatus(s) });
    const { updates } = await chrome.storage.local.get('updates');
    if (updates) { updates.pending = (updates.pending || []).filter(x => x.kind !== 'self'); await chrome.storage.local.set({ updates }); }
    chrome.action.setBadgeText({ text: '' });
    setUpdStatus(`Updated to ${r.version} (${r.files} files). Reloading…`);
    setTimeout(() => chrome.runtime.sendMessage({ type: 'wm-reload' }), 1200);
  } catch (e) { setUpdStatus('Update not applied: ' + (e.message || e), true); btn.disabled = false; }
}
renderDir();
renderUpdates();
