'use strict';
/* ANESTESIA · DSP puro: ogni suono viene sintetizzato in un buffer stereo (alta qualità, niente note musicali). */
const DSP = (() => {
const clamp = (x, a, b) => x < a ? a : x > b ? b : x, lerp = (a, b, t) => a + (b - a) * t, TAU = Math.PI * 2;
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const logm = (v, a, b) => a * Math.pow(b / a, v);

function bqc(type, f, q, sr) {
  const w = TAU * clamp(f, 5, sr * .45) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q); let b0, b1, b2; const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function bq(x, type, f, q, sr) { const [b0, b1, b2, a1, a2] = bqc(type, f, q, sr); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let n = 0; n < x.length; n++) { const xn = x[n], y = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xn; y2 = y1; y1 = y; x[n] = y; } return x; }
function op(x, f, sr) { const a = Math.exp(-TAU * f / sr); let y = 0; for (let n = 0; n < x.length; n++) { y = x[n] + a * (y - x[n]); x[n] = y; } return x; }
/* risonatore a due poli: un impulso unitario produce una sinusoide di ampiezza ~g che decade di 60 dB in t60 */
function reson(ex, out, f, t60, sr, g, glide = 0, gT = .05, exLen = ex.length) {
  const r = Math.exp(-6.91 / (Math.max(.002, t60) * sr)), r2 = r * r, n = out.length; let y1 = 0, y2 = 0, w, c, s;
  const upd = t => { w = TAU * clamp(f * (1 + glide * Math.exp(-t / gT)), 10, sr * .45) / sr; c = 2 * r * Math.cos(w); s = Math.sin(w) * g; };
  upd(0); const stop = Math.min(n, Math.ceil(t60 * 1.15 * sr) + exLen);
  for (let i = 0; i < stop; i++) { if (glide && (i & 15) === 0) upd(i / sr); const x = i < exLen ? ex[i] * s : 0, y = x + c * y1 - r2 * y2; y2 = y1; y1 = y; out[i] += y; }
}
function pulse(len, width, sr, R, noise = 0) { const ex = new Float32Array(len), w = Math.max(2, Math.round(width * sr)); for (let i = 0; i < w && i < len; i++) { const h = .5 - .5 * Math.cos(TAU * i / w); ex[i] = h * (1 - noise) + h * noise * (R() * 2 - 1); } return ex; }
function finish(L, Rr, peak, sr) {
  let pk = 1e-9; for (let i = 0; i < L.length; i++) { const a = Math.abs(L[i]), b = Math.abs(Rr[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  const k = peak / pk, fo = Math.min(L.length, Math.round(sr * .006));
  for (let i = 0; i < L.length; i++) { L[i] *= k; Rr[i] *= k; }
  for (let i = 0; i < fo; i++) { const g = i / fo; L[L.length - 1 - i] *= g; Rr[Rr.length - 1 - i] *= g; }
  return { L, R: Rr };
}
const N = (sec, sr) => Math.max(64, Math.ceil(sec * sr));

/* ---------- CUORE · cassa morbida ---------- */
function cuore(p, sr, R) {
  const f0 = 32 + p.alt * 58, ratio = 1 + p.cad * 4.5, tS = .012 + p.cad * .045, T = .14 + p.dur * p.dur * 1.6, len = N(T * 1.05 + .03, sr), o = new Float32Array(len);
  let ph = 0; const att = .0012 + p.mor * .004;
  for (let i = 0; i < len; i++) { const t = i / sr, f = f0 * (1 + (ratio - 1) * Math.exp(-t / tS)); ph += TAU * f / sr; const env = Math.min(1, t / att) * Math.exp(-t * 6.91 / T) * (1 - .25 * Math.exp(-t / .02) * p.mor); o[i] = Math.sin(ph) * env; }
  const ck = (1 - p.mor) * .55; if (ck > .01) { const nb = new Float32Array(len), w = Math.round(sr * .0035); for (let i = 0; i < w; i++) nb[i] = (R() * 2 - 1) * (1 - i / w) ** 2; bq(nb, 'bp', 1800 + (1 - p.mor) * 2500, .8, sr); for (let i = 0; i < len; i++) o[i] += nb[i] * ck * 3; }
  if (p.sof > .01) { const nb = new Float32Array(len), Ts = .03 + T * .45; for (let i = 0; i < len; i++) { const t = i / sr; nb[i] = (R() * 2 - 1) * Math.min(1, t / .006) * Math.exp(-t * 6.91 / Ts); } op(op(nb, 450 + p.sof * 600, sr), 900, sr); for (let i = 0; i < len; i++) o[i] += nb[i] * p.sof * 1.6; }
  const d = 1 + p.cal * 4.5, td = Math.tanh(d); for (let i = 0; i < len; i++) o[i] = Math.tanh(o[i] * d) / td;
  bq(o, 'hp', 24, .7, sr);
  return finish(o, Float32Array.from(o), .92, sr);
}
/* ---------- TORACE · tamburo a cornice / membrana ---------- */
const MEM = [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501], MEMA = [1, .72, .52, .46, .36, .3, .22, .18];
function torace(p, sr, R) {
  const f0 = 52 + p.alt * 170, T = .16 + p.dur * p.dur * 1.9, len = N(T * 1.1 + .06, sr), L = new Float32Array(len), Rr = new Float32Array(len);
  const w = .0045 - p.bat * .0039, ex = pulse(len, w, sr, R, .15 + p.bat * .35);
  if (p.rim > .03) { const d = Math.round(sr * (.018 + (1 - p.rim) * .03)); for (let k = 1; k <= 2; k++) { const at = d * k + Math.round(R() * sr * .004), a = p.rim * (k === 1 ? .55 : .25), pw = Math.round(w * sr); for (let i = 0; i < pw && at + i < len; i++) ex[at + i] += a * (.5 - .5 * Math.cos(TAU * i / pw)); } }
  MEM.forEach((r, k) => { const Tk = T * Math.pow(1 / (1 + k * .9), .35 + p.smo * 1.3), g = MEMA[k] * (k ? .35 + .65 * p.bat : 1); reson(ex, L, f0 * r * (1 - .0025), Tk, sr, g, .045, .06); reson(ex, Rr, f0 * r * (1 + .0025), Tk * .97, sr, g, .045, .06); });
  if (p.pel > .01) { const nb = new Float32Array(len), Tp = .04 + p.dur * .25; for (let i = 0; i < len; i++) nb[i] = (R() * 2 - 1) * Math.exp(-i / sr * 6.91 / Tp); bq(nb, 'bp', f0 * 5 + 500, .9, sr); let pk = 0; for (const x of L) pk = Math.max(pk, Math.abs(x)); for (let i = 0; i < len; i++) { const v = nb[i] * p.pel * pk * 1.6; L[i] += v; Rr[i] += v * .9; } }
  bq(L, 'hp', 30, .7, sr); bq(Rr, 'hp', 30, .7, sr);
  return finish(L, Rr, .9, sr);
}
/* ---------- SINAPSI · click e micro-scariche ---------- */
function sinapsi(p, sr, R) {
  const fc = logm(p.fre, 600, 9000), n = 1 + Math.round(p.gra * 13), dis = .002 + p.dis * p.dis * .16, ring = .0015 + p.dur * p.dur * .03, pol = p.pol;
  const len = N(dis + ring * 1.3 + .02 + (pol > .02 ? .25 + pol * .45 : 0), sr), L = new Float32Array(len), Rr = new Float32Array(len);
  for (let g = 0; g < n; g++) {
    const at = g ? Math.round(Math.pow(R(), 1.6) * dis * sr) : 0, a = g ? .25 + .6 * R() : 1, f = fc * (1 + (R() - .5) * .6), pan = g ? (R() * 2 - 1) * .85 : (R() - .5) * .3;
    const wl = (.00006 + (1 - p.dur2) * .0006), ex = pulse(Math.round(ring * 1.2 * sr) + 64, wl, sr, R, .3);
    const tmp = new Float32Array(ex.length); reson(ex, tmp, f, ring * (.7 + R() * .6), sr, 1);
    for (let i = 0; i < ex.length; i++) tmp[i] += ex[i] * p.dur2 * .9;
    const gl = a * Math.sqrt((1 - pan) / 2), gr = a * Math.sqrt((1 + pan) / 2);
    for (let i = 0; i < tmp.length && at + i < len; i++) { L[at + i] += tmp[i] * gl; Rr[at + i] += tmp[i] * gr; }
  }
  if (pol > .02) { const c = Math.round(4 + pol * 50), t0 = dis + .01, span = .2 + pol * .45; for (let k = 0; k < c; k++) { const u = Math.pow(R(), 1.5), at = Math.round((t0 + u * span) * sr), a = (1 - u) * (.08 + .3 * R()) * pol, pan = R(); if (at + 2 < len) { L[at] += a * (1 - pan); Rr[at] += a * pan; L[at + 1] -= a * .5 * (1 - pan); Rr[at + 1] -= a * .5 * pan; } } }
  bq(L, 'hp', 180, .7, sr); bq(Rr, 'hp', 180, .7, sr);
  return finish(L, Rr, .82, sr);
}
/* ---------- RESPIRO · spazzola, sabbia, soffio ---------- */
function respiro(p, sr, R) {
  const fc = logm(p.col, 300, 8000), D = .04 + p.dur * p.dur * 1.5, A = .0008 + p.att * p.att * .45, len = N(A + D * 1.05 + .02, sr), L = new Float32Array(len), Rr = new Float32Array(len);
  const wid = p.lar, sweep = (p.spa - .5) * 2, gra = p.gra, dens = 120 + gra * 380; let gs = 0;
  const filt = [{ a: 0, b: 0 }, { a: 0, b: 0 }], k = 1 / 1.3; let a1 = 0, a2 = 0, a3 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr; if ((i & 15) === 0) { const f = clamp(fc * Math.pow(2, sweep * 2 * Math.min(1, t / (A + D))), 80, sr * .4); const g = Math.tan(Math.PI * f / sr); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
    const env = (t < A ? Math.pow(t / A, 2) : Math.exp(-(t - A) * 6.91 / D));
    if (R() < dens / sr) gs = .4 + R() * .6; gs *= Math.exp(-1 / (sr * .0018)); const gm = (1 - gra) + gra * gs * 2.4;
    const c = R() * 2 - 1, nl = (R() * 2 - 1) * wid + c * (1 - wid), nr = (R() * 2 - 1) * wid + c * (1 - wid);
    [nl, nr].forEach((x, ch) => { const s = filt[ch], v3 = x - s.b, v1 = a1 * s.a + a2 * v3, v2 = s.b + a2 * s.a + a3 * v3; s.a = 2 * v1 - s.a; s.b = 2 * v2 - s.b; (ch ? Rr : L)[i] = v1 * env * gm; });
  }
  return finish(L, Rr, .78, sr);
}
/* ---------- OSSO · legno, osso, pietra ---------- */
const MAT = [[1, 2.32, 4.25, 6.63, 9.38], [1, 1.47, 2.09, 2.56, 3.39], [1, 1.81, 2.95, 4.12, 5.7]], MATA = [1, .55, .35, .22, .14];
function osso(p, sr, R) {
  const f0 = 240 + p.alt * p.alt * 1400, T = .02 + p.dur * p.dur * .28, len = N(Math.max(T, p.cav * T * 2.2) * 1.15 + .03, sr), L = new Float32Array(len), Rr = new Float32Array(len);
  const m = p.mat * 2, a = Math.min(1, Math.floor(m)), b = Math.min(2, a + 1), t = m - a, ratios = MAT[0].map((_, k) => lerp(MAT[a][k], MAT[b][k], t));
  const ex = pulse(len, .0013 - p.bat * .0011, sr, R, .1 + p.bat * .3);
  ratios.forEach((r, k) => { const Tk = T / (1 + k * 1.2), g = MATA[k] * (k ? .3 + .7 * p.bat : 1); reson(ex, L, f0 * r * .998, Tk, sr, g); reson(ex, Rr, f0 * r * 1.002, Tk * .96, sr, g); });
  if (p.cav > .02) { const tmp = new Float32Array(len); reson(ex, tmp, f0 * .31, T * (1.2 + p.cav), sr, p.cav * 1.4); for (let i = 0; i < len; i++) { L[i] += tmp[i]; Rr[i] += tmp[i]; } }
  if (p.ruv > .02) { const w = Math.round(sr * (.004 + p.ruv * .012)); for (let i = 0; i < w && i < len; i++) { const e = (1 - i / w) ** 2 * p.ruv * .7; L[i] += (R() * 2 - 1) * e; Rr[i] += (R() * 2 - 1) * e; } }
  bq(L, 'hp', 90, .7, sr); bq(Rr, 'hp', 90, .7, sr);
  return finish(L, Rr, .85, sr);
}
/* ---------- BISTURI · metallo chirurgico ---------- */
const MET = [1, 1.71, 2.53, 3.18, 3.94, 5.37, 6.12, 7.81], METJ = [0, .13, -.21, .34, -.08, .27, -.31, .19];
function bisturi(p, sr, R) {
  const f0 = 850 + p.alt * p.alt * 4800, T = .015 + p.dur * p.dur * .55, len = N(T * 1.1 + (p.att > .02 ? .05 : 0) + .02, sr), L = new Float32Array(len), Rr = new Float32Array(len);
  const ex = pulse(len, .0006 - p.bat * .00052, sr, R, .25);
  MET.forEach((r0, k) => { const r = 1 + (r0 - 1) * (.55 + p.dis * .9) + METJ[k] * p.dis, Tk = T * Math.pow(1 / (k + 1), .3 + p.smo * 1.4), g = (1 - k * .08) * (k ? .4 + .6 * p.bat : 1); reson(ex, k % 2 ? Rr : L, f0 * r, Tk, sr, g); reson(ex, k % 2 ? L : Rr, f0 * r * 1.003, Tk * .8, sr, g * .45); });
  if (p.att > .02) { const w = Math.round(sr * (.008 + p.att * .04)); for (let i = 0; i < w && i < len; i++) { const e = Math.sin(Math.PI * i / w) * p.att * .35; L[i] += (R() * 2 - 1) * e; Rr[i] += (R() * 2 - 1) * e; } }
  bq(L, 'hp', 400, .7, sr); bq(Rr, 'hp', 400, .7, sr);
  return finish(L, Rr, .66, sr);
}
/* ---------- campione dal microfono ---------- */
function campione(p, sr, R, smp) {
  if (!smp) return finish(new Float32Array(256), new Float32Array(256), .1, sr);
  const src = smp.data, ssr = smp.sr, rate = Math.pow(2, (p.alt - .5) * 2) * ssr / sr, st = Math.floor(p.ini * .9 * src.length);
  const avail = (src.length - st) / rate, lenS = Math.max(64, Math.min(avail, (.03 + p.lun * p.lun * 3) * sr)) | 0, D = .03 + p.dec * p.dec * 3;
  const o = new Float32Array(lenS), inv = p.inv > .5;
  for (let i = 0; i < lenS; i++) { const x = st + i * rate, j = x | 0, f = x - j, s = (src[j] || 0) * (1 - f) + (src[j + 1] || 0) * f; o[i] = s * Math.exp(-i / sr * 6.91 / D); }
  if (inv) o.reverse();
  const at = Math.min(lenS, Math.round(sr * .002)); for (let i = 0; i < at; i++) o[i] *= i / at;
  if (p.sat > .02) { const d = 1 + p.sat * 6, td = Math.tanh(d); for (let i = 0; i < lenS; i++) o[i] = Math.tanh(o[i] * d) / td; }
  if (p.ton < .48) bq(o, 'lp', logm(p.ton / .48, 300, 20000), .7, sr); else if (p.ton > .52) bq(o, 'hp', logm((p.ton - .52) / .48, 20, 3000), .7, sr);
  return finish(o, Float32Array.from(o), .9, sr);
}

const pct = v => Math.round(v * 100) + '%', msf = s => s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s', hz = f => f < 1000 ? Math.round(f) + ' Hz' : (f / 1000).toFixed(1) + ' kHz';
const VOICES = [
  { key: 'cuore', name: 'CUORE', sub: 'cassa morbida', color: '#ff6b7a', fn: cuore, params: [
    { k: 'alt', l: 'ALTEZZA', d: .3, f: v => hz(32 + v * 58) }, { k: 'cad', l: 'CADUTA', d: .45, f: pct }, { k: 'dur', l: 'DURATA', d: .5, f: v => msf(.14 + v * v * 1.6) },
    { k: 'mor', l: 'MORBIDO', d: .72, f: pct }, { k: 'cal', l: 'CALORE', d: .3, f: pct }, { k: 'sof', l: 'FELTRO', d: .25, f: pct }] },
  { key: 'torace', name: 'TORACE', sub: 'membrana', color: '#ffb35c', fn: torace, params: [
    { k: 'alt', l: 'ALTEZZA', d: .3, f: v => hz(52 + v * 170) }, { k: 'dur', l: 'DURATA', d: .45, f: v => msf(.16 + v * v * 1.9) }, { k: 'bat', l: 'BATTENTE', d: .35, f: v => v < .33 ? 'feltro' : v < .66 ? 'legno' : 'duro' },
    { k: 'pel', l: 'PELLE', d: .3, f: pct }, { k: 'smo', l: 'SMORZO', d: .45, f: pct }, { k: 'rim', l: 'RIMBALZO', d: 0, f: pct }] },
  { key: 'sinapsi', name: 'SINAPSI', sub: 'click', color: '#5cf2d0', fn: sinapsi, params: [
    { k: 'fre', l: 'FREQUENZA', d: .55, f: v => hz(logm(v, 600, 9000)) }, { k: 'gra', l: 'SCARICHE', d: .15, f: v => String(1 + Math.round(v * 13)) }, { k: 'dis', l: 'DISPERSIONE', d: .3, f: v => msf(.002 + v * v * .16) },
    { k: 'dur', l: 'RISONANZA', d: .25, f: pct }, { k: 'dur2', l: 'SECCO', d: .55, f: pct }, { k: 'pol', l: 'POLVERE', d: .15, f: pct }] },
  { key: 'respiro', name: 'RESPIRO', sub: 'spazzola', color: '#8fb7ff', fn: respiro, params: [
    { k: 'col', l: 'COLORE', d: .55, f: v => hz(logm(v, 300, 8000)) }, { k: 'dur', l: 'DURATA', d: .4, f: v => msf(.04 + v * v * 1.5) }, { k: 'att', l: 'ATTACCO', d: .15, f: v => msf(.0008 + v * v * .45) },
    { k: 'gra', l: 'GRANA', d: .45, f: pct }, { k: 'spa', l: 'SPAZZATA', d: .5, f: v => v < .47 ? '↓ ' + pct((.5 - v) * 2) : v > .53 ? '↑ ' + pct((v - .5) * 2) : 'ferma' }, { k: 'lar', l: 'LARGHEZZA', d: .6, f: pct }] },
  { key: 'osso', name: 'OSSO', sub: 'legno', color: '#e9d5a0', fn: osso, params: [
    { k: 'alt', l: 'ALTEZZA', d: .35, f: v => hz(240 + v * v * 1400) }, { k: 'dur', l: 'DURATA', d: .35, f: v => msf(.02 + v * v * .28) }, { k: 'mat', l: 'MATERIA', d: .2, f: v => v < .33 ? 'legno' : v < .66 ? 'osso' : 'pietra' },
    { k: 'bat', l: 'BATTENTE', d: .5, f: pct }, { k: 'cav', l: 'CAVO', d: .3, f: pct }, { k: 'ruv', l: 'RUVIDO', d: .2, f: pct }] },
  { key: 'bisturi', name: 'BISTURI', sub: 'metallo', color: '#c7b8ff', fn: bisturi, params: [
    { k: 'alt', l: 'ALTEZZA', d: .4, f: v => hz(850 + v * v * 4800) }, { k: 'dur', l: 'TINTINNIO', d: .3, f: v => msf(.015 + v * v * .55) }, { k: 'bat', l: 'BATTENTE', d: .5, f: pct },
    { k: 'dis', l: 'DISSONANZA', d: .55, f: pct }, { k: 'smo', l: 'SMORZO', d: .5, f: pct }, { k: 'att', l: 'ATTRITO', d: .1, f: pct }] },
];
const MIC = [
  { k: 'ini', l: 'INIZIO', d: 0, f: pct }, { k: 'lun', l: 'LUNGHEZZA', d: .5, f: v => msf(.03 + v * v * 3) }, { k: 'alt', l: 'VELOCITÀ', d: .5, f: v => '×' + Math.pow(2, (v - .5) * 2).toFixed(2) },
  { k: 'dec', l: 'CODA', d: .5, f: v => msf(.03 + v * v * 3) }, { k: 'ton', l: 'TONO', d: .5, f: v => v < .48 ? 'scuro' : v > .52 ? 'sottile' : 'neutro' }, { k: 'sat', l: 'SATURA', d: 0, f: pct },
  { k: 'inv', l: 'AL CONTRARIO', d: 0, steps: 2, f: v => v > .5 ? 'sì' : 'no' }];
function render(vi, p, sr, seed, smp) { const R = rng(seed); return smp ? campione(p, sr, R, smp) : VOICES[vi].fn(p, sr, R); }

/* ---------- risposte all'impulso per gli spazi (convoluzione) ---------- */
function makeIR(o, sr, seed = 7) {
  const R = rng(seed), len = N(o.len, sr), L = new Float32Array(len), Rr = new Float32Array(len);
  const tLo = o.rt * (o.lo || 1.2), tMid = o.rt, tHi = o.rt * (o.hi || .45), fade = Math.round((o.fade || .004) * sr);
  [L, Rr].forEach(ch => {
    const lo = new Float32Array(len), md = new Float32Array(len), hi = new Float32Array(len);
    for (let i = 0; i < len; i++) { const t = i / sr, n1 = R() * 2 - 1; lo[i] = n1 * Math.exp(-t * 6.91 / tLo); md[i] = n1 * Math.exp(-t * 6.91 / tMid); hi[i] = n1 * Math.exp(-t * 6.91 / tHi); }
    op(lo, 280, sr); const m2 = Float32Array.from(md); op(m2, 3200, sr); op(md, 280, sr); for (let i = 0; i < len; i++) md[i] = m2[i] - md[i]; const h2 = Float32Array.from(hi); op(h2, 3200, sr); for (let i = 0; i < len; i++) hi[i] -= h2[i];
    for (let i = 0; i < len; i++) ch[i] = lo[i] * 1.4 + md[i] + hi[i] * (o.bright || .7);
    for (let k = 0; k < (o.er || 0); k++) { const at = Math.round((.004 + R() * o.erT) * sr), a = (R() < .5 ? -1 : 1) * (.6 - k / o.er * .45); if (at < len) ch[at] += a * 3; }
    for (let i = 0; i < fade && i < len; i++) ch[i] *= i / fade;
    if (o.dark) op(ch, o.dark, sr);
  });
  if (o.reverse) { L.reverse(); Rr.reverse(); }
  let e = 0; for (let i = 0; i < len; i++) e += L[i] * L[i] + Rr[i] * Rr[i]; const k = .6 / Math.sqrt(e / 2 / 1); for (let i = 0; i < len; i++) { L[i] *= k; Rr[i] *= k; }
  return { L, R: Rr };
}
return { VOICES, MIC, render, makeIR, rng, clamp, lerp, logm, pct, msf, hz };
})();
if (typeof module !== 'undefined') module.exports = DSP;
