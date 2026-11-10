// Sparkle Cleaner — Copyright (c) 2026 Harshal Patil. MIT License (see LICENSE).
// Shared watermark engine (side panel + offscreen document). Runs fully locally.
const WM = (() => {
  const DEFAULTS = {
    logo: 'auto',      // auto | 48 | 96 | 96b
    maskScale: 1,      // grow/shrink treated area
    gain: 1,           // alpha gain
    prior: 0.5,        // min match to trust the width-relative position
    minNcc: 0.6,       // min match to accept a detection
    stride: 3,         // scan stride (px)
    refine: 3,         // refine radius (px)
    skipBelow: 0.002,  // skip pixels with alpha below this
    alphaCeil: 0.99,   // alpha ceiling
    logoLuma: 255,     // logo value (255 = white)
    cleanup: 0.7       // edge repair strength
  };
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const SETS = [
    { id: '48', size: 48, m: 32, a: b64(ALPHA48_B64) },
    { id: '96', size: 96, m: 64, a: b64(ALPHA96_B64) },
    { id: '96b', size: 96, m: 64, a: b64(ALPHA96B_B64) }
  ];
  const setsFor = S => S.logo === 'auto' ? SETS : SETS.filter(s => s.id === S.logo);

  function resampleAlpha(src, base, nw, nh = nw) {
    const out = new Float32Array(nw * nh);
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      const fx = Math.min(base - 1, (i + 0.5) * base / nw - 0.5), fy = Math.min(base - 1, (j + 0.5) * base / nh - 0.5);
      const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(base - 1, x0 + 1), y1 = Math.min(base - 1, y0 + 1);
      const tx = Math.max(0, fx - x0), ty = Math.max(0, fy - y0);
      out[j * nw + i] = ((src[y0 * base + x0] * (1 - tx) + src[y0 * base + x1] * tx) * (1 - ty)
        + (src[y1 * base + x0] * (1 - tx) + src[y1 * base + x1] * tx) * ty) / 255;
    }
    return out;
  }

  // Find the sparkle in the bottom-right corner (or around `hint`) by luma correlation. Sizes and margins
  // are searched relative to the logo itself, so any resolution / aspect ratio works. Exports place the
  // logo with equal right and bottom margins, so the first pass only walks that diagonal (fast, and few
  // false positives); if it finds nothing, a free 2-D search follows.
  function findSparkleOne(c, W, H, S, hint, near) {
    const sets = setsFor(S), rr = Math.max(0, S.refine | 0), stride = Math.max(1, S.stride | 0);
    const freeSets = sets.length === 1 ? sets : sets.filter(s => s.id !== '48');
    const sh = Math.min(W, H), nMin = Math.max(20, Math.round(0.02 * sh)), nMax = Math.max(60, Math.min(400, Math.round(0.16 * sh))), maxWin = c.maxWin || Infinity;
    const cache = new Map();
    const tmpl = (s, n, nh = n) => {
      const key = s.id + ':' + n + 'x' + nh; if (cache.has(key)) return cache.get(key);
      const al = resampleAlpha(s.a, s.size, n, nh), idx = [], tv = []; let st = 0;
      for (let i = 0; i < al.length; i++) if (al[i] > 0.02) { idx.push(i); tv.push(al[i]); st += al[i]; }
      const mt = st / (idx.length || 1); let et = 0;
      for (let k = 0; k < tv.length; k++) { tv[k] -= mt; et += tv[k] * tv[k]; }
      const t = { al, idx, tv, et }; cache.set(key, t); return t;
    };
    const win = (cx0, cy0, cw, ch) => {
      cw = Math.min(cw, W, maxWin); ch = Math.min(ch, H, maxWin);
      cx0 = Math.max(0, Math.min(W - cw, Math.round(cx0))); cy0 = Math.max(0, Math.min(H - ch, Math.round(cy0)));
      const d = c.getImageData(cx0, cy0, cw, ch).data, L = new Float32Array(cw * ch);
      for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[i*4] + 0.7152 * d[i*4+1] + 0.0722 * d[i*4+2];
      return { L, cw, ch, cx0, cy0 };
    };
    // Texture-robust statistic: ratios (in - out) / (t * (255 - out)) over pairs straddling the logo edge.
    // A real logo gives consistently positive ratios (~ its opacity) all round the outline.
    const pairsOf = (s, n) => {
      const key = 'p' + s.id + ':' + n; if (cache.has(key)) return cache.get(key);
      const t = tmpl(s, n).al; let tmax = 0; for (let i = 0; i < t.length; i++) if (t[i] > tmax) tmax = t[i];
      const D = Math.max(2, Math.round(n / 24)), P = [], T = (x, y) => (x >= 0 && y >= 0 && x < n && y < n ? t[y * n + x] : 0);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const tp = t[y * n + x]; if (tp < 0.6 * tmax) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const qx = x + dx * 2 * D, qy = y + dy * 2 * D;
          if (T(qx, qy) > 0.02 || T(x + dx * D, y + dy * D) < 0.02) continue;
          P.push(x, y, qx, qy, tp);
        }
      }
      cache.set(key, P); return P;
    };
    const pairStat = (wn, s, n, x, y) => {
      if (n < 20) return null; const P = pairsOf(s, n), { L, cw, ch } = wn; let sum = 0, sum2 = 0, N = 0;
      for (let k = 0; k < P.length; k += 5) {
        const X = x + P[k+2], Y = y + P[k+3]; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue;
        const vq = L[Y * cw + X]; if (255 - vq < 40) continue;
        let r = (L[(y + P[k+1]) * cw + x + P[k]] - vq) / (P[k+4] * (255 - vq)); r = r < -1.5 ? -1.5 : r > 3.5 ? 3.5 : r;
        sum += r; sum2 += r * r; N++;
      }
      if (N < 30) return null;
      const mean = sum / N, sd = Math.sqrt(Math.max(1e-6, sum2 / N - mean * mean));
      return { mean, sd, N, snr: mean / (sd + 1e-6), t: mean / (sd / Math.sqrt(Math.min(N, 240) / 8) + 1e-6) };
    };
    let pbest = null;
    const sizeW = n => { const f = n / sh; return f <= 0.10 ? 1 : Math.max(0.4, 1 - 0.6 * (f - 0.10) / 0.06); };
    const pscore = (wn, s, n, x, y) => {
      const p = pairStat(wn, s, n, x, y); if (p) p.t *= sizeW(n); if (p && (!pbest || p.t > pbest.t)) pbest = { ...p, s, n, wn, lx: x, ly: y, x: x + wn.cx0, y: y + wn.cy0 };
    };
    let best = null, stage = null; const sb = {};
    const score = (wn, s, n, x, y, nh = n) => {
      if (n < 20 || nh < 20) return;
      const t = tmpl(s, n, nh); if (t.idx.length < 20 || x < 0 || y < 0 || x + n > wn.cw || y + nh > wn.ch) return;
      const { idx, tv, et } = t, { L, cw } = wn; let su = 0;
      for (let k = 0; k < idx.length; k++) { const p = idx[k]; su += L[(y + (p / n | 0)) * cw + x + p % n]; }
      const mu = su / idx.length; let num = 0, eu = 0;
      for (let k = 0; k < idx.length; k++) { const p = idx[k], q = L[(y + (p / n | 0)) * cw + x + p % n] - mu; num += q * tv[k]; eu += q * q; }
      const ncc = eu > 0 ? num / Math.sqrt(eu * et) : 0;
      const r = { x: x + wn.cx0, y: y + wn.cy0, n, h: nh, ncc, s, wn, lx: x, ly: y };
      if (!best || ncc > best.ncc) best = r;
      if (stage && (!sb[stage] || ncc > sb[stage].ncc)) sb[stage] = r;
    };
    const refine = (r, radius) => { for (let dn = -radius; dn <= radius; dn++) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) score(r.wn, r.s, r.n + dn, r.lx + dx, r.ly + dy); };

    // Exports that were stretched/cropped give a non-square logo: fit width and height separately.
    const aspect = r => {
      if (!r || !ASPECT_SEARCH) return r;
      const n0 = r.n, st = Math.max(1, Math.round(n0 / 40)), rng = Math.round(n0 * 0.18), sh = Math.max(4, Math.round(n0 / 12));
      const prevStage = stage; stage = 'asp'; sb.asp = null;
      for (let nw = n0 - rng; nw <= n0 + rng; nw += st) for (let nh = n0 - rng; nh <= n0 + rng; nh += st) {
        const ar = nw / nh; if (ar < 0.8 || ar > 1.25) continue;
        for (let dy = -sh; dy <= sh; dy += 2) for (let dx = -sh; dx <= sh; dx += 2) score(r.wn, r.s, nw, r.lx + dx, r.ly + dy, nh);
      }
      if (sb.asp) { const a = sb.asp; for (let dw = -2; dw <= 2; dw++) for (let dh = -2; dh <= 2; dh++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) score(a.wn, a.s, a.n + dw, a.lx + dx, a.ly + dy, a.h + dh); }
      stage = prevStage;
      const a = sb.asp; if (a && a.ncc > (r.ncc || 0) + 0.005) { a.min = r.min; a.viaPairs = r.viaPairs; a.viaHint = r.viaHint; return a; }
      return r;
    };

    if (near) { // local re-fit of this variant around a location found with another variant
      const nhh = near.h || near.n, side = Math.round(Math.max(near.n, nhh) * 3.2), wn = win(near.x + near.n / 2 - side / 2, near.y + nhh / 2 - side / 2, side, side);
      const nx = near.x - wn.cx0, ny = near.y - wn.cy0;
      for (const s of sets) for (let dn = -4; dn <= 4; dn++) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) score(wn, s, near.n + dn, nx + dx, ny + dy, Math.round((near.n + dn) * (near.h || near.n) / near.n));
      if (best) best.min = near.min;
      return best;
    }
    if (hint) { // user clicked the sparkle: size and position are chosen with the texture-robust statistic
      const side = Math.round(nMax * 2.4), wn = win(hint.x - side / 2, hint.y - side / 2, side, side);
      const hx = hint.x - wn.cx0, hy = hint.y - wn.cy0;
      for (const s of freeSets) for (let n = nMin; n <= nMax; n += 2) {
        const tol = Math.max(14, Math.round(0.3 * n)), stp = Math.max(2, Math.round(n / 40));
        for (let y = Math.round(hy - n / 2) - tol; y <= hy - n / 2 + tol; y += stp)
          for (let x = Math.round(hx - n / 2) - tol; x <= hx - n / 2 + tol; x += stp) pscore(wn, s, n, x, y);
      }
      if (!pbest) return null;
      { const r = Math.max(3, Math.round(pbest.n / 25)); for (let dn = -r; dn <= r; dn++) { const n2 = pbest.n + dn; if (n2 < nMin || n2 > nMax) continue; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) pscore(wn, pbest.s, n2, pbest.lx + dx, pbest.ly + dy); } }
      score(wn, pbest.s, pbest.n, pbest.lx, pbest.ly); // fills `best` with the NCC of the chosen spot
      const f = best || { x: pbest.x, y: pbest.y, n: pbest.n, ncc: 0, s: pbest.s, wn, lx: pbest.lx, ly: pbest.ly };
      f.min = -1; f.viaHint = true; return aspect(f);
    }

    // pass 1: equal right/bottom margins, any size, any margin
    stage = 'diag';
    const side = Math.min(W, H, nMax * 4, maxWin), dw = win(W - side, H - side, side, side);
    for (const s of freeSets) for (let n = nMin; n <= nMax; n += 3) {
      const mMax = Math.min(Math.round(3.2 * n), dw.cw - n - 1, dw.ch - n - 1);
      for (let m = 4; m <= mMax; m += 3) { const x = dw.cw - m - n, y = dw.ch - m - n; score(dw, s, n, x, y); pscore(dw, s, n, x, y); }
    }
    if (S._dbg) { S._dbg.pbest = pbest; S._dbg.diag = sb.diag; }
    if (sb.diag) refine(sb.diag, Math.max(3, rr));
    if (sb.diag && sb.diag.ncc >= S.prior) { sb.diag.min = S.prior; return aspect(sb.diag); }
    if (pbest && pbest.t >= 14 && pbest.snr >= 2.5 && pbest.mean >= 0.25 && pbest.mean <= 2.6) { // faint logo on a busy background
      stage = 'pair'; for (let dn = -3; dn <= 3; dn++) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) pscore(pbest.wn, pbest.s, pbest.n + dn, pbest.lx + dx, pbest.ly + dy);
      score(pbest.wn, pbest.s, pbest.n, pbest.lx, pbest.ly);
      const f = sb.pair || { x: pbest.x, y: pbest.y, n: pbest.n, ncc: 0, s: pbest.s, wn: pbest.wn, lx: pbest.lx, ly: pbest.ly };
      f.min = -1; f.viaPairs = true; return aspect(f);
    }

    // pass 2: free 2-D search (unequal margins / other layouts)
    stage = 'free';
    const cw = Math.min(W, 300), ch = Math.min(H, 300), fw = win(W - cw, H - ch, cw, ch);
    for (const s of sets) { // native-scale standard anchors
      const bx = fw.cw - s.m - s.size, by = fw.ch - s.m - s.size;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) score(fw, s, s.size, bx + dx, by + dy);
    }
    for (const s of freeSets) for (let n = 20; n <= 150; n += 4)
      for (let y = 0; y + n <= fw.ch; y += stride) for (let x = 0; x + n <= fw.cw; x += stride) score(fw, s, n, x, y);
    if (sb.free) refine(sb.free, rr);
    const fbest = sb.free || sb.diag; if (fbest) fbest.min = Math.max(S.minNcc, 0.75); // unusual layouts: be strict, clicking the logo is the fallback
    return fbest && fbest.ncc >= fbest.min ? aspect(fbest) : fbest || null;
  }

  // Auto mode tries every logo variant and keeps the one that leaves the least outline behind after
  // removal (correlation alone can't tell the 2026 sparkle from the standard one).
  function findSparkle(c, W, H, S, hint) {
    if (S.logo !== 'auto') { const f = findSparkleOne(c, W, H, S, hint); return f && ok(f) ? alignFit(c, f) : f; }
    // 1) locate with one variant (full search), 2) re-fit the others around that spot, 3) pick by outline residue
    let base = findSparkleOne(c, W, H, { ...S, logo: '96' }, hint);
    if (!ok(base)) { const alt = findSparkleOne(c, W, H, { ...S, logo: '96b' }, hint); if (alt && (!base || alt.ncc > base.ncc)) base = alt; }
    if (!base) return null;
    if (!ok(base)) return base;
    const cands = [base];
    for (const s of SETS) if (s.id !== base.s.id) { const f = findSparkleOne(c, W, H, { ...S, logo: s.id }, hint, base); if (f) cands.push(f); }
    const top = Math.max(...cands.map(f => f.ncc)), good = cands.filter(f => ok(f) && f.ncc >= top - 0.15);
    for (const f of good) { f.g = estimateGain(c, f); f.E = edgeEnergy(c, f, f.g); }
    return alignFit(c, good.sort((a, b) => a.E - b.E)[0]);
  }

  // Reverse alpha blending + repair of the thin outline band.
  function removeMap(c, x, y, w, h, alpha, S, full) {
    const W = c.canvas.width, H = c.canvas.height;
    x = Math.max(0, Math.min(W - w, x)); y = Math.max(0, Math.min(H - h, y));
    const id = c.getImageData(x, y, w, h), d = id.data, L = S.logoLuma;
    for (let i = 0; i < alpha.length; i++) {
      const a = Math.min(alpha[i] * S.gain, S.alphaCeil); if (a < S.skipBelow) continue;
      for (let k = 0; k < 3; k++) {
        const v = (d[i * 4 + k] - a * L) / (1 - a);
        d[i * 4 + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    c.putImageData(id, x, y);
    const strength = S.cleanup; if (!(strength > 0)) return;
    const nsz = Math.max(w, h), Rout = 2, Rin = full ? 2 : Math.max(2, Math.min(5, Math.round(nsz / 22)));
    const P = Rout + 2, rx = Math.max(0, x - P), ry = Math.max(0, y - P);
    const rw = Math.min(W, x + w + P) - rx, rh = Math.min(H, y + h + P) - ry;
    const reg = c.getImageData(rx, ry, rw, rh), px = reg.data;
    let amax = 0; for (let i = 0; i < alpha.length; i++) if (alpha[i] > amax) amax = alpha[i];
    const sup = (i, j) => { const ax = rx + i - x, ay = ry + j - y; return ax >= 0 && ay >= 0 && ax < w && ay < h && alpha[ay * w + ax] >= 0.02; };
    const band = [];
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      let any = false, all = true;
      for (let dj = -Rout; dj <= Rout && !any; dj++) for (let di = -Rout; di <= Rout; di++) if (sup(i + di, j + dj)) { any = true; break; }
      if (any && !full) {
        for (let dj = -Rin; dj <= Rin && all; dj++) for (let di = -Rin; di <= Rin; di++) if (!sup(i + di, j + dj)) { all = false; break; }
      } else if (full) all = false;
      const ax = rx + i - x, ay = ry + j - y;
      const soft = ax >= 0 && ay >= 0 && ax < w && ay < h && alpha[ay * w + ax] >= 0.02 && alpha[ay * w + ax] < 0.3 * amax;
      if ((any && !all) || soft) band.push(j * rw + i);
    }
    const cur = Float32Array.from(px);
    for (let it = 0; it < (full ? 80 : 30); it++) for (const p of band) {
      const i = p % rw, j = (p / rw) | 0;
      const l = j * rw + Math.max(0, i - 1), r = j * rw + Math.min(rw - 1, i + 1);
      const u = Math.max(0, j - 1) * rw + i, dn = Math.min(rh - 1, j + 1) * rw + i;
      for (let k = 0; k < 3; k++) cur[p * 4 + k] = (cur[l * 4 + k] + cur[r * 4 + k] + cur[u * 4 + k] + cur[dn * 4 + k]) / 4;
    }
    let sig = 0;
    if (full) { // keep the natural grain: measure it outside the repaired area and add it back
      const inBand = new Uint8Array(rw * rh); for (const p of band) inBand[p] = 1;
      let s = 0, cnt = 0;
      for (let j = 1; j < rh - 1; j++) for (let i = 1; i < rw - 1; i++) { const p = j * rw + i; if (inBand[p]) continue;
        const l = (o) => 0.2126 * px[o * 4] + 0.7152 * px[o * 4 + 1] + 0.0722 * px[o * 4 + 2];
        s += Math.abs(l(p) - (l(p - 1) + l(p + 1) + l(p - rw) + l(p + rw)) / 4); cnt++; }
      sig = cnt ? 1.6 * s / cnt : 0;
    }
    let seed = (x * 73856093) ^ (y * 19349663) ^ ((Math.random() * 1e9) | 0);
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) | 0) >>> 8) / 8388608 - 1;
    for (const p of band) { const nz = sig ? rnd() * sig : 0;
      for (let k = 0; k < 3; k++) { const v = px[p * 4 + k] * (1 - strength) + (cur[p * 4 + k] + nz) * strength; px[p * 4 + k] = v < 0 ? 0 : v > 255 ? 255 : v; } }
    c.putImageData(reg, rx, ry);
  }

  // The logo's real opacity differs between sources (images ~0.5, some Flow/Veo videos ~0.3).
  // Fit v = bg + g * t * (255 - bg) over the logo window (t = template alpha, 0 outside).
  // Only trusted on smooth backgrounds (high r2); on busy textures the template opacity (g = 1) is kept.
  function estimateGainMap(c, x, y, n, m, t, info, minR2 = WM_GAIN_R2) {
    const W = c.canvas.width, H = c.canvas.height, pad = 10;
    const x0 = Math.max(0, x - pad), y0 = Math.max(0, y - pad), x1 = Math.min(W, x + n + pad), y1 = Math.min(H, y + m + pad);
    const w = x1 - x0, h = y1 - y0, d = c.getImageData(x0, y0, w, h).data;
    let N = 0, st = 0, sv = 0, stt = 0, stv = 0, svv = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const tx = x0 + i - x, ty = y0 + j - y, tv = tx >= 0 && ty >= 0 && tx < n && ty < m ? t[ty * n + tx] : 0;
      const k = (j * w + i) * 4, v = 0.2126 * d[k] + 0.7152 * d[k+1] + 0.0722 * d[k+2];
      N++; st += tv; sv += v; stt += tv * tv; stv += tv * v; svv += v * v;
    }
    const vt = N * stt - st * st, vv = N * svv - sv * sv; if (vt <= 0 || vv <= 0) return null;
    const slope = (N * stv - st * sv) / vt, bg = (sv - slope * st) / N, r2 = slope * slope * vt / vv, g = slope / (255 - bg);
    if (info) { info.r2 = r2; info.raw = g; }
    if (255 - bg < 25 || r2 < minR2 || g <= 0) return null;
    return g;
  }
  // Second opinion on the opacity: median of the logo's plateau vs median of a ring just outside it.
  function ringGain(c, f) {
    const n = f.n, nh = f.h || f.n, t = resampleAlpha(f.s.a, f.s.size, n, nh); let tmax = 0; for (let i = 0; i < t.length; i++) if (t[i] > tmax) tmax = t[i];
    const W = c.canvas.width, H = c.canvas.height, pad = Math.round(n * 0.9), x0 = Math.max(0, f.x - pad), y0 = Math.max(0, f.y - pad), x1 = Math.min(W, f.x + n + pad), y1 = Math.min(H, f.y + nh + pad);
    const w = x1 - x0, h = y1 - y0, d = c.getImageData(x0, y0, w, h).data, cx = f.x + n / 2 - x0, cy = f.y + nh / 2 - y0, m8 = Math.max(3, Math.round(n * 0.08));
    const T = (i, j) => { const tx = x0 + i - f.x, ty = y0 + j - f.y; return tx >= 0 && ty >= 0 && tx < n && ty < nh ? t[ty * n + tx] : 0; };
    const inside = [], tin = [], ring = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4, v = 0.2126 * d[k] + 0.7152 * d[k+1] + 0.0722 * d[k+2], tv = T(i, j), r = Math.hypot(i - cx, j - cy);
      if (tv >= 0.85 * tmax && r < 0.4 * n) { inside.push(v); tin.push(tv); continue; }
      if (tv > 0.02 || r <= 0.62 * n || r >= 0.95 * n) continue;
      let near = false; for (let dj = -m8; dj <= m8 && !near; dj += m8) for (let di = -m8; di <= m8; di += m8) if (T(i + di, j + dj) > 0.02) { near = true; break; }
      if (!near) ring.push(v);
    }
    if (inside.length < 20 || ring.length < 40) return null;
    ring.sort((a, b) => a - b); inside.sort((a, b) => a - b); tin.sort((a, b) => a - b);
    const bg = ring[ring.length >> 1], vin = inside[inside.length >> 1], ti = tin[tin.length >> 1];
    if (255 - bg < 80) return null; // bright backgrounds hide the logo: no reliable reading
    const g = (vin - bg) / (ti * (255 - bg)); return g > 0.1 ? g : null;
  }

  // Opacity of the logo relative to the stored template. Robust to texture: for many pairs of
  // (pixel inside the logo, pixel just outside it) the ratio (in - out) / (t * (255 - out)) is computed and
  // the median taken. Falls back to a regression fit, then to 1.
  function estimateGain(c, f, info) {
    const n = f.n, nh = f.h || f.n, t = resampleAlpha(f.s.a, f.s.size, n, nh), W = c.canvas.width, H = c.canvas.height;
    let tmax = 0; for (let i = 0; i < t.length; i++) if (t[i] > tmax) tmax = t[i];
    const pad = Math.max(8, 4 * Math.max(2, Math.round(n / 24)) + 2), x0 = Math.max(0, f.x - pad), y0 = Math.max(0, f.y - pad), x1 = Math.min(W, f.x + n + pad), y1 = Math.min(H, f.y + nh + pad);
    const w = x1 - x0, h = y1 - y0, d = c.getImageData(x0, y0, w, h).data, V = new Float32Array(w * h), T = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4, tx = x0 + i - f.x, ty = y0 + j - f.y;
      V[j * w + i] = 0.2126 * d[k] + 0.7152 * d[k+1] + 0.0722 * d[k+2]; T[j * w + i] = tx >= 0 && ty >= 0 && tx < n && ty < nh ? t[ty * n + tx] : 0;
    }
    // pixel pairs well inside / well outside the logo edge (>= D px each side), so edge blur does not bias the ratio
    const D = Math.max(2, Math.round(Math.min(n, nh) / 24)), ratios = [], dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const Tat = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? -1 : T[j * w + i]);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const p = j * w + i; if (T[p] < 0.75 * tmax) continue;
      for (const [dx, dy] of dirs) {
        if (Tat(i + dx * D, j + dy * D) < 0.75 * tmax) continue;        // p is at least D inside the edge
        const t3 = Tat(i + dx * 3 * D, j + dy * 3 * D), q4 = Tat(i + dx * 4 * D, j + dy * 4 * D);
        if (t3 < 0 || t3 > 0.02 || q4 < 0 || q4 > 0.02) continue;      // edge lies within (p+D, p+3D], q is >= D outside it
        const vq = V[(j + dy * 4 * D) * w + i + dx * 4 * D]; if (255 - vq < 40) continue;
        ratios.push((V[p] - vq) / (T[p] * (255 - vq)));
      }
    }
    if (ratios.length >= 40) {
      ratios.sort((a, b) => a - b);
      const g = ratios[ratios.length >> 1], iqr = ratios[(ratios.length * 3) >> 2] - ratios[ratios.length >> 2];
      const relSE = (iqr / 1.35 / Math.sqrt(ratios.length / 8)) / Math.max(g, 0.05); // texture-aware standard error of the median
      if (info) { info.raw = g; info.relSE = relSE; info.pairs = ratios.length; }
      if (g > 0.1 && relSE < 0.35) {
        const gr = ringGain(c, f); // when both readings agree, average them (each has its own small bias)
        return Math.min(2.5, Math.max(0.2, gr != null && Math.abs(gr - g) / g < 0.25 ? (g + gr) / 2 : g));
      }
      if (g > 0.1 && relSE < 0.8 && f.viaHint) return Math.min(2.5, Math.max(0.2, g)); // user-confirmed logo: trust a noisier estimate rather than assuming 1
    }
    const g = estimateGainMap(c, f.x, f.y, n, nh, t, info);
    return g == null ? 1 : Math.min(2.5, Math.max(0.2, g));
  }
  const ASPECT_SEARCH = false; // non-square logo fit: tested, gave noisier results than the square fit, so off
  const WM_GAIN_R2 = 0.8;

  // Mean edge gradient left along the logo outline after inverting the blend with gain g.
  // Lower = the outline has disappeared more completely (the variant/opacity fits the data better).
  function edgeEnergy(c, f, g) {
    const W = c.canvas.width, H = c.canvas.height, fh = f.h || f.n, t = resampleAlpha(f.s.a, f.s.size, f.n, fh), pad = 6;
    let tmax = 0; for (let i = 0; i < t.length; i++) if (t[i] > tmax) tmax = t[i];
    const x0 = Math.max(0, f.x - pad), y0 = Math.max(0, f.y - pad), x1 = Math.min(W, f.x + f.n + pad), y1 = Math.min(H, f.y + fh + pad);
    const w = x1 - x0, h = y1 - y0, d = c.getImageData(x0, y0, w, h).data, R = new Float32Array(w * h), T = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const tx = x0 + i - f.x, ty = y0 + j - f.y, k = (j * w + i) * 4, p = j * w + i;
      const a = Math.min((tx >= 0 && ty >= 0 && tx < f.n && ty < fh ? t[ty * f.n + tx] : 0) * g, 0.99); T[p] = a;
      const v = 0.2126 * d[k] + 0.7152 * d[k+1] + 0.0722 * d[k+2]; R[p] = a > 0 ? (v - a * 255) / (1 - a) : v;
    }
    let E = 0, N = 0;
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const p = j * w + i, mn = Math.min(T[p], T[p-1], T[p+1], T[p-w], T[p+w]), mx = Math.max(T[p], T[p-1], T[p+1], T[p-w], T[p+w]);
      if (mx - mn > 0.2 * tmax * g) { E += Math.abs(R[p+1] - R[p-1]) + Math.abs(R[p+w] - R[p-w]); N++; }
    }
    return N ? E / N : Infinity;
  }

  // Fine alignment: nudge position/size (a few px) to where inverting the blend leaves the smallest outline.
  function alignFit(c, f) {
    const g0 = f.g || estimateGain(c, f); let best = f, bestE = edgeEnergy(c, f, g0); const fh = f.h || f.n;
    for (let dn = -2; dn <= 2; dn++) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (!dn && !dy && !dx) continue;
      const cand = { ...f, x: f.x + dx, y: f.y + dy, n: f.n + dn, h: fh + dn };
      if (cand.n < 20 || cand.h < 20 || cand.x < 0 || cand.y < 0 || cand.x + cand.n > c.canvas.width || cand.y + cand.h > c.canvas.height) continue;
      const E = edgeEnergy(c, cand, g0); if (E < bestE * 0.97) { best = cand; bestE = E; }
    }
    if (best !== f) { best.g = undefined; best.g = estimateGain(c, best); }
    return best;
  }

  // Apply a found sparkle (honours mask size; opacity auto-calibrated unless f.g is preset).
  function removeSparkle(c, f, S) {
    const g = f.g || (f.g = estimateGain(c, f));
    const fh = f.h || f.n, n2 = Math.max(8, Math.round(f.n * S.maskScale)), h2 = Math.max(8, Math.round(fh * S.maskScale));
    removeMap(c, f.x - Math.round((n2 - f.n) / 2), f.y - Math.round((h2 - fh) / 2), n2, h2, resampleAlpha(f.s.a, f.s.size, n2, h2), { ...S, gain: S.gain * g });
  }

  const canvasOf = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
  const ok = f => f && f.ncc >= f.min;

  // ---- images ----
  async function processImage(blob, S, hint) {
    S = { ...DEFAULTS, ...S };
    const bmp = await createImageBitmap(blob), W = bmp.width, H = bmp.height;
    const cv = canvasOf(W, H), c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(bmp, 0, 0);
    const f = findSparkle(c, W, H, S, hint);
    if (!ok(f)) return { found: false, blob, note: `No Gemini sparkle found (best match ${f ? f.ncc.toFixed(2) : '0'}).`, canvas: cv, W, H };
    removeSparkle(c, f, S);
    const type = ['image/jpeg', 'image/webp'].includes(blob.type) ? blob.type : 'image/png';
    const out = await new Promise(r => cv.toBlob(r, type, 0.97));
    return { found: true, blob: out, ext: type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png',
      note: `Removed at ${f.x},${f.y} (${f.n}×${f.h || f.n}px, match ${f.ncc.toFixed(2)}, variant ${f.s.id}, opacity ×${(f.g || 1).toFixed(2)}).`, canvas: cv, W, H, hit: f };
  }

  // ---- video ----
  const seek = (v, t) => new Promise(r => { const to = setTimeout(() => { v.onseeked = null; r(); }, 2500); v.onseeked = () => { clearTimeout(to); v.onseeked = null; r(); }; v.currentTime = t; });
  async function loadVideo(blob) {
    const url = URL.createObjectURL(blob), v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto'; v.src = url; v._url = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Cannot decode this video')); });
    return v;
  }
  async function detectVeo(v, W, H) {
    if (typeof Veo === 'undefined') return null;
    const cw = Math.min(W, 320), ch = Math.min(H, 220), t = canvasOf(cw, ch), tc = t.getContext('2d', { willReadFrequently: true }), frames = [];
    for (const f of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
      await seek(v, v.duration * f);
      tc.drawImage(v, W - cw, H - ch, cw, ch, 0, 0, cw, ch);
      frames.push({ timestamp: v.currentTime, imageData: tc.getImageData(0, 0, cw, ch) });
    }
    const det = Veo.detectFromFrames({ frames, width: cw, height: ch, marginRadiusX: 50, marginRadiusY: 50 }); // margins vary between exports
    if (!det.isConfident) return null;
    const p = det.position;
    return { kind: 'veo', x: W - cw + p.x, y: H - ch + p.y, w: p.width, h: p.height, t: Float32Array.from(det.alphaMap, v => v / 0.18), g: 0.18, id: det.template.id, ncc: det.summary.best.meanNcc };
  }
  // Mean of the bottom-right corner over many frames: content moves, the fixed logo stays, so it
  // becomes far easier to detect and its opacity easier to measure. Returns a virtual "ctx".
  async function sampleCorner(v, samples = 10) {
    const W = v.videoWidth, H = v.videoHeight, CS = Math.max(420, Math.round(0.25 * Math.min(W, H))), CW = Math.min(W, CS), CH = Math.min(H, CS);
    const t = canvasOf(CW, CH), tc = t.getContext('2d', { willReadFrequently: true }), acc = new Float32Array(CW * CH * 4);
    for (let i = 0; i < samples; i++) {
      await seek(v, v.duration * (0.04 + 0.92 * i / (samples - 1)));
      tc.drawImage(v, W - CW, H - CH, CW, CH, 0, 0, CW, CH);
      const d = tc.getImageData(0, 0, CW, CH).data; for (let k = 0; k < d.length; k++) acc[k] += d[k];
    }
    const mean = new Uint8ClampedArray(acc.length); for (let k = 0; k < acc.length; k++) mean[k] = acc[k] / samples;
    return { canvas: { width: W, height: H }, maxWin: Math.min(CW, CH), getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4), ox = W - CW, oy = H - CH;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const sx = x + i - ox, sy = y + j - oy; if (sx < 0 || sy < 0 || sx >= CW || sy >= CH) continue;
        const s = (sy * CW + sx) * 4, o = (j * w + i) * 4; out[o] = mean[s]; out[o+1] = mean[s+1]; out[o+2] = mean[s+2]; out[o+3] = 255;
      }
      return { data: out, width: w, height: h };
    } };
  }
  // Decide what to remove from a video: a Veo text mark, or the sparkle (found on the multi-frame mean).
  async function detectVideo(v, S, hint, corner) {
    S = { ...DEFAULTS, ...S }; const W = v.videoWidth, H = v.videoHeight;
    corner = corner || await sampleCorner(v);
    if (!hint) {
      const veo = await detectVeo(v, W, H);
      if (veo) { // measure the real opacity of the text mark on the multi-frame mean (falls back to the template default)
        const info = {}, g = estimateGainMap(corner, veo.x, veo.y, veo.w, veo.h, veo.t, info, 0.5);
        if (g != null) veo.g = Math.min(1, Math.max(0.05, g * 0.97));
        veo.info = info; return veo;
      }
    }
    const f = findSparkle(corner, W, H, S, hint);
    if (!ok(f)) return null;
    f.g = estimateGain(corner, f);
    return { kind: 'sparkle', f };
  }
  function applyPlan(c, plan, S) {
    S = { ...DEFAULTS, ...S }; if (!plan) return;
    if (plan.kind === 'veo') removeMap(c, plan.x, plan.y, plan.w, plan.h, plan._a && plan._g === plan.g ? plan._a : (plan._g = plan.g, plan._a = Float32Array.from(plan.t, v => v * plan.g)), { ...S, cleanup: S.cleanup > 0 ? Math.min(1, S.cleanup + 0.3) : 0 }, true); // text strokes need a stronger repair than the sparkle outline
    else removeSparkle(c, plan.f, S);
  }


  // Constant-frame-rate H.264 + AAC MP4 (opens in DaVinci Resolve / Premiere). Frame-accurate: seeks every frame.
  async function detectFps(v) {
    const times = [];
    v.muted = true; await seek(v, 0);
    await new Promise(res => {
      const t0 = setTimeout(res, 3000);
      const cb = (now, m) => { times.push(m.mediaTime); if (times.length >= 14) { clearTimeout(t0); res(); } else v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb); v.play().catch(res);
    });
    v.pause();
    const d = times.slice(1).map((t, i) => t - times[i]).filter(x => x > 0.004).sort((a, b) => a - b);
    if (!d.length) return 30;
    const fps = 1 / d[d.length >> 1];
    const known = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60];
    const best = known.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));
    return Math.abs(best - fps) / best < 0.03 ? best : Math.round(fps * 100) / 100;
  }
  async function encodeCFR(v, blob, cv, c, apply, plan, onProgress) {
    const W = v.videoWidth & ~1, H = v.videoHeight & ~1, dur = v.duration;
    if (!W || !H || !isFinite(dur)) return null;
    const fps = await detectFps(v), N = Math.max(1, Math.round(dur * fps));
    const srcBps = blob.size * 8 / dur, bitrate = Math.round(Math.min(40e6, Math.max(8e6, srcBps * 1.5)));
    const level = W * H > 1920 * 1088 ? '640034' : '640028';
    let vcfg = null;
    for (const codec of ['avc1.' + level, 'avc1.4d0028', 'avc1.42001f']) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) { vcfg = cfg; break; }
    }
    if (!vcfg) return null;
    // audio: decode whole track, re-encode as AAC
    let pcm = null;
    try {
      const ac = new AudioContext({ sampleRate: 48000 });
      const buf = await ac.decodeAudioData(await blob.arrayBuffer()); ac.close();
      if (buf.length && buf.numberOfChannels) pcm = buf;
    } catch { /* no audio track */ }
    let acfg = null;
    if (pcm) {
      const ch = Math.min(2, pcm.numberOfChannels);
      const cfg = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: ch, bitrate: 192000 };
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) acfg = cfg; else pcm = null;
    }
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: 'avc', width: W, height: H, frameRate: fps },
      ...(acfg ? { audio: { codec: 'aac', numberOfChannels: acfg.numberOfChannels, sampleRate: 48000 } } : {}) });
    let err = null;
    const venc = new VideoEncoder({ output: (ch, m) => muxer.addVideoChunk(ch, m), error: e => (err = e) });
    venc.configure(vcfg);
    const step = 1e6 / fps, gop = Math.max(1, Math.round(fps * 2));
    for (let i = 0; i < N; i++) {
      if (err) throw err;
      await seek(v, Math.min(dur - 0.001, (i + 0.5) / fps));
      c.drawImage(v, 0, 0, W, H, 0, 0, W, H); apply();
      const f = new VideoFrame(cv, { timestamp: Math.round(i * step), duration: Math.round(step) });
      venc.encode(f, { keyFrame: i % gop === 0 }); f.close();
      while (venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
      if (i % 3 === 0) onProgress(Math.min(99, Math.round(i / N * 100)));
    }
    await venc.flush(); venc.close();
    if (acfg) {
      const aenc = new AudioEncoder({ output: (ch, m) => muxer.addAudioChunk(ch, m), error: e => (err = e) });
      aenc.configure(acfg);
      const chn = acfg.numberOfChannels, CH = 4096, total = Math.min(pcm.length, Math.round(dur * 48000));
      for (let o = 0; o < total; o += CH) {
        const n = Math.min(CH, total - o), data = new Float32Array(n * chn);
        for (let k = 0; k < chn; k++) data.set(pcm.getChannelData(k).subarray(o, o + n), k * n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: chn, timestamp: Math.round(o / 48000 * 1e6), data });
        aenc.encode(ad); ad.close();
        while (aenc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 4));
      }
      await aenc.flush(); aenc.close();
    }
    if (err) throw err;
    muxer.finalize(); onProgress(100);
    return { found: true, blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4',
      note: `${plan.kind === 'veo' ? 'Veo text' : 'Sparkle'} removed · ${fps} fps H.264${acfg ? ' + AAC' : ' (no audio)'} MP4, editor-friendly.` };
  }

  async function processVideo(blob, S, onProgress = () => {}, plan) {
    S = { ...DEFAULTS, ...S };
    const v = await loadVideo(blob);
    try {
      const W = v.videoWidth, H = v.videoHeight, cv = canvasOf(W, H), c = cv.getContext('2d', { willReadFrequently: true });
      if (!plan) plan = await detectVideo(v, S);
      if (!plan) return { found: false, blob, note: 'No watermark found in this video.' };
      const apply = () => applyPlan(c, plan, S);
      if (typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof Mp4Muxer !== 'undefined') {
        try { const r = await encodeCFR(v, blob, cv, c, apply, plan, onProgress); if (r) return r; }
        catch (e) { console.warn('CFR export failed, falling back to real-time recording', e); await seek(v, 0); }
      }
      let hasAudio = true, ac = null, dest = null;
      try { ac = new AudioContext(); const s = ac.createMediaElementSource(v); dest = ac.createMediaStreamDestination(); s.connect(dest); await ac.resume(); if (ac.state !== 'running') hasAudio = false; } catch { hasAudio = false; }
      const stream = cv.captureStream(30);
      if (dest && hasAudio) dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
      const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      const done = new Promise(r => (rec.onstop = r)), ended = new Promise(r => (v.onended = r));
      let lastT = -1;
      const draw = () => { c.drawImage(v, 0, 0, W, H); apply(); onProgress(Math.min(100, v.currentTime / v.duration * 100 | 0)); };
      const loop = () => { if (v.currentTime !== lastT) { lastT = v.currentTime; draw(); } if (!v.ended && v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop); };
      const timer = setInterval(() => { if (v.currentTime !== lastT) { lastT = v.currentTime; draw(); } }, 33); // fallback when rVFC is throttled
      await seek(v, 0); draw();
      rec.start();
      try { await v.play(); } catch { v.muted = true; hasAudio = false; await v.play(); }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop);
      await ended; draw(); await new Promise(r => setTimeout(r, 150)); clearInterval(timer); rec.stop(); await done;
      if (ac) ac.close();
      const out = new Blob(chunks, { type: mime.split(';')[0] });
      return { found: true, blob: out, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm',
        note: `${plan.kind === 'veo' ? 'Veo text' : 'Sparkle'} removed${hasAudio ? '' : ' (audio could not be kept)'}.` };
    } finally { URL.revokeObjectURL(v._url); }
  }

  return { DEFAULTS, processImage, processVideo, loadVideo, sampleCorner, detectVideo, applyPlan, findSparkle, removeSparkle, estimateGain, edgeEnergy, canvasOf, seek };
})();
