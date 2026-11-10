// Sparkle Cleaner — Copyright (c) 2026 Harshal Patil. MIT License (see LICENSE).
const UI_DEFAULTS = { enabled: true, autoRemoval: true, floatButton: true, flow: true, skipPreview: false,
  notify: true, autoDownload: true, dark: false };

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(['ui']);
  await chrome.storage.local.set({ ui: { ...UI_DEFAULTS, ...(cur.ui || {}) } });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  scheduleUpdates(); checkUpdates(false);
});
chrome.runtime.onStartup.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await scheduleUpdates();
  const { updates } = await chrome.storage.local.get('updates');
  if (!updates?.lastCheck || Date.now() - updates.lastCheck > UPDATE_MIN * 60000) checkUpdates(false);
});

// ---- Update checker: every 15 days -------------------------------------------------------------
// Watches the upstream projects our code/templates came from, plus an optional feed for this tool.
const UPDATE_MIN = 15 * 24 * 60;
const UPSTREAM = {
  'allenk/GeminiWatermarkTool': { sha: '7c6a99f2c3df97eb3c430ef87a0c962aea5cb80e', tag: 'v0.3.2', used: 'sparkle alpha maps / detection ideas' },
  'Vanilagy/mp4-muxer': { sha: '0ab3652250f12e97dde4927b4ddcb2c2f2891197', tag: 'v5.2.2', used: 'MP4 export for cleaned videos (bundled mp4-muxer.js)' },
  'GargantuaX/gemini-watermark-remover': { sha: '4fb1433649e01e626b7cae3c7ae02721e0ab0e65', tag: 'v1.0.46', used: 'Veo text-mark detector & alpha templates' }
};
async function scheduleUpdates() {
  if (!(await chrome.alarms.get('wm-update'))) chrome.alarms.create('wm-update', { delayInMinutes: UPDATE_MIN, periodInMinutes: UPDATE_MIN });
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'wm-update') checkUpdates(false); });

const ghJson = async url => { const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' }); if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status); return r.json(); };
const newer = (a, b) => { const p = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n) || 0); const x = p(a), y = p(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

async function checkUpdates(manual) {
  const st = await chrome.storage.local.get(['updates', 'updateFeed', 'ui']);
  const u = st.updates || { upstream: {}, pending: [] };
  const found = [], errors = [];
  for (const [repo, base] of Object.entries(UPSTREAM)) {
    try {
      const known = u.upstream[repo] || base;
      const c = (await ghJson(`https://api.github.com/repos/${repo}/commits?per_page=1`))[0];
      let tag = null; try { tag = (await ghJson(`https://api.github.com/repos/${repo}/releases/latest`)).tag_name; } catch (_) {}
      if (c && c.sha !== known.sha) {
        found.push({ kind: 'upstream', repo, used: base.used, from: known.tag || known.sha.slice(0, 7), to: tag || c.sha.slice(0, 7),
          url: tag ? `https://github.com/${repo}/releases/tag/${tag}` : `https://github.com/${repo}/compare/${known.sha}...${c.sha}` });
        u.upstream[repo] = { sha: c.sha, tag: tag || known.tag };  // remembered so the same change isn't announced twice
      } else u.upstream[repo] = known;
    } catch (e) { errors.push(String(e.message || e)); }
  }
  if (st.updateFeed) {
    try {
      const f = await (await fetch(st.updateFeed, { cache: 'no-store' })).json();
      const cur = chrome.runtime.getManifest().version;
      if (f.version && newer(f.version, cur)) found.push({ kind: 'self', from: cur, to: f.version, url: f.url || st.updateFeed, notes: f.notes || '', zip: f.zip || '', sha256: f.sha256 || '' });
    } catch (e) { errors.push('Update feed: ' + (e.message || e)); }
  }
  u.lastCheck = Date.now(); u.errors = errors;
  // keep unread findings, replace duplicates
  u.pending = [...(u.pending || []).filter(p => !found.some(f => f.kind === p.kind && f.repo === p.repo)), ...found];
  await chrome.storage.local.set({ updates: u });
  chrome.action.setBadgeText({ text: u.pending.length ? 'NEW' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#0f9d8f' });
  if (found.length && st.ui?.notify !== false) {
    const self = found.some(f => f.kind === 'self');
    chrome.notifications.create('wm-upd', {
      type: 'basic', iconUrl: 'icons/128.png', requireInteraction: true,
      title: self ? 'Sparkle Cleaner update available' : 'Watermark-removal source updated',
      message: found.map(f => f.kind === 'self' ? `Sparkle Cleaner ${f.from} → ${f.to}` : `${f.repo.split('/')[1]} ${f.from} → ${f.to}`).join('\n'),
      buttons: [{ title: 'Reload extension' }, { title: 'Details' }]
    });
  }
  return { found, errors, lastCheck: u.lastCheck };
}
chrome.notifications.onButtonClicked.addListener((id, i) => {
  if (id !== 'wm-upd') return;
  if (i === 0) chrome.runtime.reload();
  else chrome.sidePanel.open ? chrome.windows.getCurrent(w => chrome.sidePanel.open({ windowId: w.id }).catch(() => {})) : 0;
});
chrome.notifications.onClicked.addListener(id => { if (id === 'wm-upd') chrome.windows.getCurrent(w => chrome.sidePanel.open({ windowId: w.id }).catch(() => {})); });

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
    justification: 'Process downloaded images/videos locally (canvas + video decoding)'
  });
}
const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type === 'wm-ensure') { ensureOffscreen().then(() => send({ ok: true }), e => send({ ok: false, error: String(e) })); return true; }
  if (msg?.type === 'wm-check-updates') { checkUpdates(true).then(r => send({ ok: true, ...r }), e => send({ ok: false, error: String(e) })); return true; }
  if (msg?.type === 'wm-reload') { chrome.runtime.reload(); return false; }
  if (msg?.type === 'wm-fetch') {
    (async () => {
      const r = await fetch(msg.url, { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      send({ ok: true, dataUrl: await toDataUrl(await r.blob()) });
    })().catch(e => send({ ok: false, error: String(e) }));
    return true;
  }
  return false; // wm-process is answered by the offscreen document
});
