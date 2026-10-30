/* ANESTESIA · riverbero "ABISSO": FDN a 8 linee con matrice di Hadamard, smorzamento a 3 bande,
   diffusori allpass, prime riflessioni, modulazione, congelamento e ducking dal segnale secco. */
const LINES = [31.7, 37.3, 41.9, 47.1, 53.9, 59.3, 67.1, 73.7];
const APL = [4.77, 3.59, 12.73, 9.31], APR = [5.13, 3.91, 11.87, 8.69];
const ER = [7.1, 11.3, 15.9, 19.7, 24.3, 29.9, 35.1, 41.7, 47.3, 56.9, 63.1, 71.3];
class Abisso extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate; this.sr = sr;
    this.P = { size: .6, decay: 4, damp: .45, low: 1.1, mod: .3, diff: .75, pre: .02, width: 1, er: .3, duck: 0, rel: .25, freeze: 0, tail: 1 };
    this.port.onmessage = e => Object.assign(this.P, e.data);
    this.pdL = new Float32Array(sr * 0.6 | 0); this.pdR = new Float32Array(sr * 0.6 | 0); this.pdW = 0;
    const mk = ms => ({ b: new Float32Array(Math.ceil(ms * sr / 1000) + 2), i: 0 });
    this.apL = APL.map(mk); this.apR = APR.map(mk);
    this.maxLen = Math.ceil(LINES[7] * 2.7 * sr / 1000) + 256;
    this.lines = LINES.map((ms, k) => ({ b: new Float32Array(this.maxLen), w: 0, len: ms * sr / 1000, cur: ms * sr / 1000, ph: k * 0.77, rate: 0.11 + k * 0.067, lo: 0, md: 0 }));
    this.erBuf = new Float32Array(Math.ceil(.2 * sr)); this.erW = 0; this.erLp = [0, 0];
    this.env = 0; this.frz = 0; this.y = new Float64Array(8); this.g = { lo: new Float64Array(8), md: new Float64Array(8), hi: new Float64Array(8) };
    this.cLo = Math.exp(-2 * Math.PI * 250 / sr); this.cHi = Math.exp(-2 * Math.PI * 3200 / sr);
    this.denorm = 1e-18;
  }
  ap(d, x, g) { const b = d.b, n = b.length, y = b[d.i]; const v = x + g * y; b[d.i] = v; d.i = (d.i + 1) % n; return y - g * v; }
  process(inputs, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0]; if (!oL) return true;
    const inp = inputs[0] || [], iL = inp[0], iR = inp[1] || inp[0], key = inputs[1] || [], kL = key[0], kR = key[1] || key[0];
    const P = this.P, sr = this.sr, n = oL.length;
    // parametri per blocco
    const frzT = P.freeze ? 1 : 0; this.frz += (frzT - this.frz) * 0.08; const f = this.frz;
    const sz = 0.35 + Math.max(0, Math.min(1, P.size)) * 2.2;
    const rt = Math.max(0.15, P.decay), rtLo = rt * Math.max(0.3, P.low), rtHi = Math.max(0.08, rt * (1 - P.damp * 0.9));
    for (let k = 0; k < 8; k++) {
      const L = this.lines[k]; L.len = LINES[k] * sz * sr / 1000;
      const sec = L.cur / sr;
      const gl = Math.pow(10, -3 * sec / rtLo), gm = Math.pow(10, -3 * sec / rt), gh = Math.pow(10, -3 * sec / rtHi);
      this.g.lo[k] = gl + (0.99995 - gl) * f; this.g.md[k] = gm + (0.99995 - gm) * f; this.g.hi[k] = gh + (0.99995 - gh) * f;
    }
    const inG = 1 - f, apg = 0.45 + P.diff * 0.3, modD = P.mod * 0.0018 * sr * (0.5 + sz * 0.5) * (1 - f * 0.7), modR = (0.25 + P.mod) * 2 * Math.PI / sr;
    const pre = Math.min(this.pdL.length - 2, Math.max(1, P.pre * sr | 0)), erS = 0.4 + P.size * 1.4, erG = P.er, erC = 1 - Math.exp(-2 * Math.PI * (6500 * (1 - P.damp * 0.6)) / sr);
    const relC = Math.exp(-1 / (Math.max(0.03, P.rel) * sr)), attC = Math.exp(-1 / (0.003 * sr)), duck = P.duck, w = P.width, tail = P.tail;
    const cLo = this.cLo, cHi = this.cHi, y = this.y, lines = this.lines, eb = this.erBuf, en = eb.length;
    for (let i = 0; i < n; i++) {
      const xl = (iL ? iL[i] : 0) * inG, xr = (iR ? iR[i] : 0) * inG;
      // pre-delay
      const pw = this.pdW; this.pdL[pw] = xl; this.pdR[pw] = xr; let pr = pw - pre; if (pr < 0) pr += this.pdL.length; const pl = this.pdL[pr], prr = this.pdR[pr]; this.pdW = (pw + 1) % this.pdL.length;
      // prime riflessioni
      eb[this.erW] = (pl + prr) * 0.5; let el = 0, er = 0;
      for (let t = 0; t < 12; t++) { let r = this.erW - ((ER[t] * erS * sr / 1000) | 0); if (r < 0) r += en; const v = eb[r] * (0.9 * Math.exp(-t * 0.17)); if (t & 1) { er += v; el -= v * 0.35; } else { el += v; er -= v * 0.35; } }
      this.erW = (this.erW + 1) % en;
      this.erLp[0] += (el - this.erLp[0]) * erC; this.erLp[1] += (er - this.erLp[1]) * erC;
      // diffusione
      let dl = pl + this.erLp[0] * 0.5, dr = prr + this.erLp[1] * 0.5;
      for (let a = 0; a < 4; a++) { dl = this.ap(this.apL[a], dl, apg); dr = this.ap(this.apR[a], dr, apg); }
      // lettura linee modulate
      for (let k = 0; k < 8; k++) {
        const L = lines[k]; L.cur += (L.len - L.cur) * 0.00004; L.ph += L.rate * modR * 6.0; if (L.ph > 6.283185) L.ph -= 6.283185;
        const d = L.cur + modD * Math.sin(L.ph); let rp = L.w - d; while (rp < 0) rp += this.maxLen; const j = rp | 0, fr = rp - j, j2 = (j + 1) % this.maxLen;
        const s = L.b[j] * (1 - fr) + L.b[j2] * fr;
        L.lo = s + cLo * (L.lo - s); L.md = s + cHi * (L.md - s);
        y[k] = L.lo * this.g.lo[k] + (L.md - L.lo) * this.g.md[k] + (s - L.md) * this.g.hi[k];
      }
      // Hadamard 8x8
      for (let h = 1; h < 8; h <<= 1) for (let a = 0; a < 8; a += h << 1) for (let b = a; b < a + h; b++) { const u = y[b], v = y[b + h]; y[b] = u + v; y[b + h] = u - v; }
      const sc = 0.35355339;
      let ol = 0, orr = 0;
      for (let k = 0; k < 8; k++) {
        const L = lines[k], fb = y[k] * sc + (k & 1 ? dr : dl) * 0.5 + this.denorm; L.b[L.w] = fb; L.w = (L.w + 1) % this.maxLen;
      }
      this.denorm = -this.denorm;
      // uscite decorrelate prese dai segnali filtrati delle linee
      const a0 = y[0] * sc, a1 = y[1] * sc, a2 = y[2] * sc, a3 = y[3] * sc, a4 = y[4] * sc, a5 = y[5] * sc, a6 = y[6] * sc, a7 = y[7] * sc;
      ol = (a0 - a2 + a4 - a6) * 0.6; orr = (a1 - a3 + a5 - a7) * 0.6;
      // larghezza M/S
      const m = (ol + orr) * 0.5, sd = (ol - orr) * 0.5 * w; ol = m + sd; orr = m - sd;
      // ducking
      const kv = kL ? Math.max(Math.abs(kL[i]), Math.abs(kR[i])) : 0; this.env = kv > this.env ? kv + attC * (this.env - kv) : kv + relC * (this.env - kv);
      const dg = 1 - duck * Math.min(1, this.env * 2.5);
      oL[i] = (ol * tail + this.erLp[0] * erG) * dg; if (oR !== oL) oR[i] = (orr * tail + this.erLp[1] * erG) * dg;
    }
    return true;
  }
}
registerProcessor('abisso', Abisso);
