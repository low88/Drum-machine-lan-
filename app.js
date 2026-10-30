'use strict';
/* ANESTESIA · interfaccia */
const $ = id => document.getElementById(id), $$ = s => [...document.querySelectorAll(s)];
const { clamp, pct, logm } = DSP, NV = AE.NV, KEY = 'anestesia.v1';
const R = Math.random;
AE.clock.now = () => Sync.now(); AE.clock.off = () => Sync.off();

const MIXP = [
  { k: 'lvl', l: 'LIVELLO', d: .75, f: pct }, { k: 'pan', l: 'PAN', d: .5, f: v => v < .48 ? 'S ' + Math.round((.5 - v) * 200) : v > .52 ? 'D ' + Math.round((v - .5) * 200) : 'C' },
  { k: 'fil', l: 'FILTRO', d: .5, f: v => v < .47 ? 'passa-basso ' + DSP.hz(logm(v / .47, 150, 20000)) : v > .53 ? 'passa-alto ' + DSP.hz(logm((v - .53) / .47, 20, 4000)) : 'aperto' },
  { k: 'rev', l: 'SPAZIO', d: .4, f: pct }, { k: 'eco', l: 'ECO', d: 0, f: pct }, { k: 'var', l: 'VARIAZIONE', d: .3, f: pct }, { k: 'prob', l: 'PROBABILITÀ', d: 1, f: pct }];
const REVP = [
  ['CODA', [['size', 'DIMENSIONE', pct], ['decay', 'CODA', v => DSP.msf(AE.decayS(v))], ['damp', 'SMORZA ALTI', pct], ['low', 'BASSI', v => '×' + AE.lowM(v).toFixed(2)]]],
  ['CARATTERE', [['pre', 'PRE-DELAY', v => Math.round(AE.preS(v) * 1000) + ' ms'], ['diff', 'DIFFUSIONE', pct], ['mod', 'MOVIMENTO', pct], ['width', 'LARGHEZZA', v => Math.round(v * 150) + '%']]],
  ['MISCELA', [['er', 'RIFLESSIONI', pct], ['room', 'STANZA', pct], ['duck', 'RESPIRO', v => v < .02 ? 'off' : pct(v)], ['lvl', 'LIVELLO', pct]]],
  ['TONO DELLA CODA', [['lo', 'TAGLIA BASSI', v => DSP.hz(logm(v, 20, 800))], ['hi', 'TAGLIA ALTI', v => DSP.hz(logm(v, 1000, 20000))]]]];
const FXI = [['eco', 'ECO', '◎', 'lancio di eco'], ['aritmia', 'ARITMIA', '⟲', 'ripete il battito'], ['fibrilla', 'FIBRILLAZ.', '⁂', 'colpi a raffica'], ['sedativo', 'SEDATIVO', '▼', 'tutto si chiude'],
  ['adrenalina', 'ADRENALINA', '▲', 'sottile, tirato'], ['anestesia', 'ANESTESIA', '≋', 'lontano, sott’acqua'], ['vertigine', 'VERTIGINE', '∿', 'ondeggia e gira'], ['apnea', 'APNEA', '○', 'restano le code']];
const RVI = [['congela', 'CONGELA', '❄', 'coda infinita'], ['inverso', 'INVERSO', '⇋', 'al contrario'], ['abisso', 'ABISSO', '▽', 'coda enorme'], ['spasmo', 'SPASMO', '⋮', 'coda a scatti'], ['risucchio', 'RISUCCHIO', '◐', 'la coda respira']];

/* ================= stato ================= */
function defVoice(i) {
  const V = AE.VOICES[i];
  return { p: Object.fromEntries(V.params.map(q => [q.k, q.d])), m: Object.fromEntries(AE.MIC.map(q => [q.k, q.d])),
    mix: { lvl: [.8, .72, .62, .6, .64, .52][i], pan: [.5, .44, .6, .5, .36, .66][i], fil: .5, rev: [.22, .42, .52, .45, .45, .58][i], eco: [0, .1, .28, 0, .22, .32][i], var: .3, prob: [1, 1, .9, 1, .95, .85][i] },
    src: 'synth', mute: false, solo: false, seed: 0 };
}
function defState() {
  const sp = AE.SPACES.cisterna.rev;
  return { v: 1, bpm: 72, swing: .12, bars: 4, pat: Array(NV).fill('0'.repeat(64)), voices: Array.from({ length: NV }, (_, i) => defVoice(i)),
    rev: Object.assign({}, sp, { lo: .35, hi: .72, lvl: .75, duck: .2 }), space: 'cisterna', eco: { div: 2, fb: .42, col: .42, pp: .75, lvl: .6 },
    master: { vol: .82, glue: .35, heat: .18 }, tab: 'seq', sel: 0, page: 0, nudge: 0, name: 'TEL-' + Math.floor(R() * 90 + 10), shareFx: false, latch: false, click: false, seen: false };
}
let st = defState();
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) { st = Object.assign(defState(), s); st.voices = st.voices.map((v, i) => Object.assign(defVoice(i), v, { p: Object.assign(defVoice(i).p, v.p), m: Object.assign(defVoice(i).m, v.m), mix: Object.assign(defVoice(i).mix, v.mix) })); } } catch (e) {}
let saveT = 0; function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }, 300); }
AE.bind(st); AE.S.nudge = st.nudge; Sync.name = st.name;
const DB = {
  open() { return this.p || (this.p = new Promise((res, rej) => { const r = indexedDB.open('anestesia', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async get(k) { const d = await this.open(); return new Promise(res => { const q = d.transaction('s').objectStore('s').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); },
  async put(k, v) { const d = await this.open(); return new Promise(res => { const t = d.transaction('s', 'readwrite'); t.objectStore('s').put(v, k); t.oncomplete = res; t.onerror = res; }); },
};

/* ================= avvio audio ================= */
let booted = false;
function boot() {
  if (booted) { AE.ctx && AE.ctx.state !== 'running' && AE.ctx.resume(); return; }
  booted = true; AE.init(); AE.ctx.resume();
  AE.renderAll(); AE.applyAll(); AE.applySpace(st.space);
  for (let i = 0; i < NV; i++) DB.get('smp' + i).then(s => { if (s && s.data) { AE.setSample(i, s); if (st.voices[i].src === 'mic') AE.renderVoice(i); } }).catch(() => {});
}
document.addEventListener('pointerdown', () => boot(), { capture: true });

/* ================= pattern ================= */
function genBar(i) {
  const a = new Array(16).fill(0), set = (s, v) => { a[s & 15] = Math.max(a[s & 15], v); }, r = n => (R() * n) | 0;
  switch (i) {
    case 0: set(0, 3); if (R() < .75) set(R() < .5 ? 2 : 3, 2); if (R() < .4) set(8 + (R() < .5 ? 0 : 2), R() < .5 ? 2 : 1); if (R() < .25) set(R() < .5 ? 10 : 11, 1); break;
    case 1: { const o = [[6, 14], [4, 12], [7, 15], [12], [10], [6]]; o[r(o.length)].forEach(s => set(s, R() < .6 ? 2 : 1)); if (R() < .2) set(15, 1); } break;
    case 2: { const n = 2 + r(5); for (let k = 0; k < n; k++) set(r(16), R() < .25 ? 2 : 1); } break;
    case 3: if (R() < .7) set(4, 2); if (R() < .7) set(12, 2); if (R() < .3) set(8 + r(8), 1); break;
    case 4: { const n = 1 + r(4), pool = [3, 5, 7, 9, 11, 13, 14, 15, 2, 10]; for (let k = 0; k < n; k++) set(pool[r(pool.length)], R() < .4 ? 2 : 1); } break;
    case 5: if (R() < .65) set(1 + 2 * r(8), R() < .3 ? 2 : 1); if (R() < .3) set(1 + 2 * r(8), 1); break;
  }
  return a;
}
function generate(onlyBar) {
  for (let i = 0; i < NV; i++) {
    const base = genBar(i), arr = st.pat[i].split('').map(Number);
    for (let b = 0; b < st.bars; b++) {
      if (onlyBar != null && b !== onlyBar) continue;
      let bar = (b === 0 || R() < .3) ? (b === 0 ? base : genBar(i)) : base.slice();
      if (b > 0 && R() < .5) { const k = (R() * 16) | 0; bar[k] = bar[k] ? 0 : (R() < .5 ? 1 : 0); }
      if (b % 4 === 3 && (i === 2 || i === 1) && R() < .6) { const k = 12 + ((R() * 4) | 0); bar[k] = Math.max(bar[k], 1); }
      for (let s = 0; s < 16; s++) arr[b * 16 + s] = bar[s];
    }
    st.pat[i] = arr.join('');
  }
}
function resizeBars(n) {
  n = clamp(n, 1, 40); const old = st.bars; if (n === old) return;
  st.pat = st.pat.map(p => { let out = ''; for (let b = 0; b < n; b++) out += b < old ? p.slice(b * 16, b * 16 + 16) : p.slice((b % old) * 16, (b % old) * 16 + 16); return out; });
  st.bars = n; st.page = Math.min(st.page, n - 1); renderHead(); if (st.tab === 'seq') renderPanel(); save(); sharePattern(true);
}
if (st.pat.every(p => !/[1-3]/.test(p))) generate();

/* ================= randomizzazione ================= */
const hist = [];
function snap() { hist.push(JSON.stringify(st.voices.map(v => ({ p: v.p, m: v.m, mix: v.mix })))); if (hist.length > 25) hist.shift(); }
function undo() { const s = hist.pop(); if (!s) return toast('Niente da annullare'); JSON.parse(s).forEach((o, i) => Object.assign(st.voices[i], o)); for (let i = 0; i < NV; i++) { AE.renderVoice(i); AE.applyStrip(i); } renderPanel(); save(); toast('Ripristinato'); }
const LIM = { cuore: { dur: [.15, .8] }, torace: { dur: [.1, .7], rim: [0, .7] }, sinapsi: { gra: [0, .7], dur: [0, .55] }, respiro: { dur: [.1, .75], att: [0, .7] }, osso: { dur: [.05, .8] }, bisturi: { dur: [.05, .65], att: [0, .5] } };
function randomVoice(i, soft) {
  const V = AE.VOICES[i], v = st.voices[i], lim = LIM[V.key] || {};
  if (v.src === 'mic') { AE.MIC.forEach(q => { if (q.k === 'inv') v.m.inv = R() < .2 ? 1 : 0; else if (q.k === 'ini') v.m.ini = R() * .4; else v.m[q.k] = soft ? clamp(v.m[q.k] + (R() - .5) * .3, 0, 1) : .1 + R() * .8; }); }
  else V.params.forEach(q => { const [a, b] = lim[q.k] || [.04, .96]; v.p[q.k] = soft ? clamp(v.p[q.k] + (R() - .5) * .28, a, b) : a + R() * (b - a); });
  if (!soft) {
    const m = v.mix; m.rev = .12 + R() * .62; m.eco = R() < .4 ? .1 + R() * .4 : 0; m.var = .15 + R() * .45; m.pan = clamp(.5 + (R() - .5) * .6, 0, 1);
    m.fil = R() < .65 ? .5 : (R() < .6 ? .22 + R() * .24 : .54 + R() * .16); v.seed = (R() * 1000) | 0;
  } else v.seed = (R() * 1000) | 0;
  AE.renderVoice(i); AE.applyStrip(i);
}
function randomOne(i, soft) { boot(); snap(); randomVoice(i, soft); refreshPanel(); save(); AE.S.playing || AE.audition(i); toast(soft ? `${AE.VOICES[i].name} variato` : `${AE.VOICES[i].name} nuovo`); }
function randomKit() { boot(); snap(); for (let i = 0; i < NV; i++) randomVoice(i); refreshPanel(); save(); toast('Nuovo kit di suoni · ↶ per tornare indietro'); }
function randomSpace() {
  boot(); const r = st.rev; const keys = Object.keys(AE.SPACES); if (R() < .5) { st.space = keys[(R() * keys.length) | 0]; Object.assign(r, AE.SPACES[st.space].rev); AE.applySpace(st.space); }
  ['size', 'decay', 'damp', 'low', 'pre', 'diff', 'mod', 'width', 'er', 'room'].forEach(k => r[k] = clamp(r[k] + (R() - .5) * .4, .03, .97)); r.duck = R() < .5 ? R() * .6 : 0; r.lo = .15 + R() * .4; r.hi = .5 + R() * .45;
  AE.applyRev(); refreshPanel(); save(); toast('Spazio casuale');
}

/* ================= trasporto (anche condiviso) ================= */
const mode = () => Sync.S.mode;
function announce() { if (mode() === 'host') Sync.broadcast({ t: 'tr', playing: AE.S.playing, bpm: st.bpm, swing: st.swing, anchor: AE.S.anchor }); }
function play() {
  boot();
  if (mode() === 'guest') { Sync.toHost({ t: 'req', a: AE.S.playing ? 'stop' : 'play' }); $('playBtn').classList.add('wait'); return; }
  if (AE.S.playing) return stop();
  const a = mode() === 'clock' ? { s: 0, st: 0 } : AE.anchorAt(mode() === 'host' ? 380 : 40);
  AE.start(a); renderHead(); announce();
}
function stop() { if (mode() === 'guest') return Sync.toHost({ t: 'req', a: 'stop' }); AE.stop(); renderHead(); announce(); }
function setBpm(b) {
  b = clamp(Math.round(b), 40, 180); if (b === st.bpm) return;
  if (mode() === 'guest') { Sync.toHost({ t: 'req', a: 'bpm', v: b }); return; }
  const a = AE.S.playing && mode() !== 'clock' ? AE.anchorAt(mode() === 'host' ? 420 : 20) : null;
  st.bpm = b; if (mode() === 'clock') AE.retime({ s: 0, st: 0 }); else if (a) AE.retime(a); else AE.applyEco();
  renderHead(); save(); announce();
}
function setSwing(v) { if (mode() === 'guest') { Sync.toHost({ t: 'req', a: 'swing', v }); return; } st.swing = v; save(); announce(); }
$('playBtn').onclick = play;
$('barsDn').onclick = () => resizeBars(st.bars - 1); $('barsUp').onclick = () => resizeBars(st.bars + 1);
$('genBtn').onclick = () => { generate(); if (st.tab === 'seq') renderPanel(); save(); toast('Nuovo ritmo'); sharePattern(true); };
$('diceBtn').onclick = randomKit;
$('monitor').onclick = () => openSheet('TEMPO', b => {
  b.appendChild(note(mode() === 'guest' ? 'Sei collegato: il tempo lo decide il telefono capo (le tue modifiche gli vengono inviate).' : 'Tocca TAP a tempo almeno 3 volte, oppure scegli un valore.'));
  const big = div('code'); big.textContent = st.bpm; b.appendChild(big);
  const r1 = div('btns'); r1.append(btn('−5', () => { setBpm(st.bpm - 5); big.textContent = st.bpm; }), btn('−1', () => { setBpm(st.bpm - 1); big.textContent = st.bpm; }), btn('TAP', () => { tap(); big.textContent = st.bpm; }, 'hot'), btn('+1', () => { setBpm(st.bpm + 1); big.textContent = st.bpm; }), btn('+5', () => { setBpm(st.bpm + 5); big.textContent = st.bpm; })); b.appendChild(r1);
  const r2 = div('btns'); [50, 60, 66, 72, 80, 90, 100, 120].forEach(x => r2.append(btn(String(x), () => { setBpm(x); big.textContent = st.bpm; }))); b.appendChild(r2);
});
let taps = [];
function tap() { const n = performance.now(); taps = taps.filter(t => n - t < 2500); taps.push(n); if (taps.length >= 3) { const iv = []; for (let k = 1; k < taps.length; k++) iv.push(taps[k] - taps[k - 1]); setBpm(60000 / (iv.reduce((a, b) => a + b) / iv.length)); } }

/* ================= registrazione dell'uscita ================= */
$('recBtn').onclick = async () => {
  boot();
  if (!AE.recording) { if (!AE.mixStart()) return toast('Questo browser non può registrare l’uscita'); $('recBtn').setAttribute('aria-pressed', 'true'); toast('Registro l’uscita…'); return; }
  const r = await AE.mixStop(); $('recBtn').setAttribute('aria-pressed', 'false'); if (!r) return;
  const name = `anestesia-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${r.ext}`, file = new File([r.blob], name, { type: r.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'ANESTESIA' }); return; } catch (e) {} }
  const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = name; a.click(); toast(`Salvato ${Math.round(r.secs)} s`);
};

/* ================= helper UI ================= */
function div(c) { const d = document.createElement('div'); if (c) d.className = c; return d; }
function btn(t, on, cls) { const b = document.createElement('button'); b.className = 'k' + (cls ? ' ' + cls : ''); b.textContent = t; b.onclick = on; return b; }
function note(t) { const p = document.createElement('p'); p.className = 'note'; p.textContent = t; return p; }
function lbl(t) { const d = div('lbl'); d.textContent = t; return d; }
function chips(list, cur, on) { const h = div('chips'); list.forEach(([k, n, s]) => { const b = document.createElement('button'); b.className = 'chip'; b.innerHTML = n + (s ? `<small>${s}</small>` : ''); b.setAttribute('aria-pressed', cur === k); b.onclick = () => on(k); h.appendChild(b); }); return h; }
function toast(m, ms = 2400) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function openSheet(title, build) { $('sheetTitle').textContent = title; const b = $('sheetBody'); b.innerHTML = ''; build(b); $('sheet').hidden = false; }
function closeSheet() { $('sheet').hidden = true; }
$('sheetClose').onclick = closeSheet; $('sheet').addEventListener('pointerdown', e => { if (e.target === $('sheet')) closeSheet(); });
const A0 = 135, SW = 270;
function arcD(a0, a1, r = 27) { const p = a => [32 + r * Math.cos(a * Math.PI / 180), 32 + r * Math.sin(a * Math.PI / 180)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
function knob(o) {
  const w = div('knob'); w.style.setProperty('--c', o.color || '#5cf2d0'); w.tabIndex = 0; w.setAttribute('role', 'slider'); w.setAttribute('aria-label', o.label);
  w.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${arcD(A0, A0 + SW)}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="3.5" stroke-linecap="round"/><path class="arc" fill="none" stroke="var(--c)" stroke-width="3.5" stroke-linecap="round" style="filter:drop-shadow(0 0 3px var(--c))"/>
    <circle cx="32" cy="32" r="20" fill="#0a141c" stroke="#1d2f3d"/><circle cx="32" cy="32" r="14" fill="none" stroke="rgba(255,255,255,.05)"/><g class="ptr"><line x1="32" y1="14" x2="32" y2="22" stroke="var(--c)" stroke-width="2.6" stroke-linecap="round"/></g></svg><span class="kl">${o.label}</span><span class="kv"></span>`;
  const arc = w.querySelector('.arc'), ptr = w.querySelector('.ptr'), kv = w.querySelector('.kv');
  const q = v => o.steps ? Math.round(v * (o.steps - 1)) / (o.steps - 1) : v;
  const draw = () => { const v = q(o.get()), a = A0 + SW * v; arc.setAttribute('d', v > .003 ? arcD(A0, a) : ''); ptr.setAttribute('transform', `rotate(${a + 90} 32 32)`); kv.textContent = o.fmt(v); };
  const set = v => { v = q(clamp(v, 0, 1)); if (v === q(o.get())) return; o.set(v); draw(); };
  let y0 = 0, x0 = 0, v0 = 0, last = 0, moved = false;
  w.addEventListener('pointerdown', e => { e.preventDefault(); try { w.setPointerCapture(e.pointerId); } catch (er) {} w.classList.add('drag'); y0 = e.clientY; x0 = e.clientX; v0 = o.get(); moved = false; const n = performance.now(); if (n - last < 280 && o.def != null) { set(o.def); last = 0; o.done && o.done(); } else last = n; });
  w.addEventListener('pointermove', e => { if (!w.classList.contains('drag')) return; const d = (y0 - e.clientY) + (e.clientX - x0) * .6; if (Math.abs(d) > 3) moved = true; set(v0 + (o.steps ? d / (28 * (o.steps - 1)) : d / 170)); });
  const up = () => { if (!w.classList.contains('drag')) return; w.classList.remove('drag'); if (o.steps && !moved && performance.now() - last < 250) { const n = o.steps - 1; set(((Math.round(o.get() * n) + 1) % o.steps) / n); } if (moved || o.steps) o.done && o.done(); };
  w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up);
  w.addEventListener('keydown', e => { const s = o.steps ? 1 / (o.steps - 1) : .02; if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(o.get() + s); e.preventDefault(); o.done && o.done(); } if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(o.get() - s); e.preventDefault(); o.done && o.done(); } });
  w.redraw = draw; draw(); return w;
}
const rerT = {};
function reRender(i, audition) { clearTimeout(rerT[i]); rerT[i] = setTimeout(() => { AE.renderVoice(i); drawWave(); if (audition && !AE.S.playing) AE.audition(i); }, 45); }

/* ================= pannelli ================= */
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (st.tab === b.dataset.t && !document.body.classList.contains('fold')) { document.body.classList.add('fold'); return; } document.body.classList.remove('fold'); st.tab = b.dataset.t; renderPanel(); save(); });
let cells = [], names = [];
function renderPanel() {
  $$('#tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === st.tab));
  const p = $('panel'); const sc = p.scrollTop; p.innerHTML = ''; cells = []; names = [];
  ({ seq: pSeq, snd: pSnd, rev: pRev, fx: pFx, sync: pSync })[st.tab](p);
  if (refreshPanel.keep) p.scrollTop = sc; refreshPanel.keep = false;
}
function refreshPanel() { refreshPanel.keep = true; renderPanel(); }

/* ---- RITMO ---- */
function pSeq(p) {
  if (st.bars > 1) {
    const nav = div('barnav'); nav.append(btn('‹', () => goPage(st.page - 1), 'sm'));
    const bm = document.createElement('canvas'); bm.id = 'barMap'; nav.appendChild(bm); nav.append(btn('›', () => goPage(st.page + 1), 'sm')); p.appendChild(nav);
    bm.addEventListener('pointerdown', e => { const r = bm.getBoundingClientRect(), f = ev => goPage(clamp(Math.floor((ev.clientX - r.left) / r.width * st.bars), 0, st.bars - 1)); f(e); follow = false; try { bm.setPointerCapture(e.pointerId); } catch (er) {} bm.onpointermove = ev => { if (ev.buttons) f(ev); }; });
    requestAnimationFrame(drawBarMap);
  }
  const g = div('grid');
  for (let i = 0; i < NV; i++) {
    const V = AE.VOICES[i], row = div('grow'); row.style.setProperty('--c', V.color);
    const nb = document.createElement('button'); nb.className = 'vname' + (st.sel === i ? ' sel' : '') + (st.voices[i].mute ? ' mute' : ''); nb.innerHTML = `${V.name}<small>${V.sub}</small>`;
    let lt = 0, longT = null;
    nb.addEventListener('pointerdown', () => { lt = performance.now(); longT = setTimeout(() => { st.voices[i].mute = !st.voices[i].mute; AE.applyStrip(i); nb.classList.toggle('mute', st.voices[i].mute); toast(st.voices[i].mute ? `${V.name} muto` : `${V.name} attivo`); save(); longT = null; }, 520); });
    nb.addEventListener('pointerup', () => { if (longT) { clearTimeout(longT); longT = null; st.sel = i; names.forEach((n, k) => n.classList.toggle('sel', k === i)); AE.audition(i); save(); } });
    nb.addEventListener('pointerleave', () => { clearTimeout(longT); longT = null; }); nb.addEventListener('contextmenu', e => e.preventDefault());
    names.push(nb); row.appendChild(nb);
    const sg = div('steps'); cells[i] = [];
    for (let s = 0; s < 16; s++) {
      const c = document.createElement('button'); c.className = 'st'; c.setAttribute('aria-label', `${V.name} passo ${s + 1}`);
      c.onclick = () => { const idx = st.page * 16 + s, cur = +st.pat[i][idx], nx = [3, 0, 1, 2][cur]; st.pat[i] = st.pat[i].slice(0, idx) + nx + st.pat[i].slice(idx + 1); c.dataset.v = nx; if (nx && !AE.S.playing) AE.audition(i, AE.VEL[nx]); save(); sharePattern(); };
      cells[i].push(c); sg.appendChild(c);
    }
    row.appendChild(sg); g.appendChild(row);
  }
  p.appendChild(g); paintCells();
  p.appendChild(note('Tocca un passo: forte → spento → piano → medio. Tieni premuto il nome per silenziare la voce.'));
  const tools = div('btns');
  tools.append(btn('⟳ QUESTA BATTUTA', () => { generate(st.page); paintCells(); save(); sharePattern(); }, 'sm'), btn('COPIA → AVANTI', () => { if (st.page >= st.bars - 1) return toast('È l’ultima battuta'); st.pat = st.pat.map(x => x.slice(0, (st.page + 1) * 16) + x.slice(st.page * 16, st.page * 16 + 16) + x.slice((st.page + 2) * 16)); goPage(st.page + 1); save(); sharePattern(); }, 'sm'), btn('PULISCI', () => { st.pat = st.pat.map(x => x.slice(0, st.page * 16) + '0'.repeat(16) + x.slice(st.page * 16 + 16)); paintCells(); save(); sharePattern(); }, 'sm warn'));
  p.appendChild(tools);
  const kg = div('kgrid'); kg.append(knob({ label: 'SWING', def: .12, get: () => st.swing, set: v => setSwing(v), fmt: pct }));
  p.appendChild(kg);
}
function paintCells() { for (let i = 0; i < NV; i++) if (cells[i]) for (let s = 0; s < 16; s++) cells[i][s].dataset.v = st.pat[i][st.page * 16 + s]; }
function goPage(n) { st.page = clamp(n, 0, st.bars - 1); paintCells(); drawBarMap(); renderHead(); }
function drawBarMap() {
  const c = $('barMap'); if (!c) return; const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight; if (!w) return; c.width = w * dpr; c.height = h * dpr; const x = c.getContext('2d'); x.scale(dpr, dpr);
  const bw = w / st.bars; for (let b = 0; b < st.bars; b++) { let n = 0; for (let i = 0; i < NV; i++) for (let s = 0; s < 16; s++) if (st.pat[i][b * 16 + s] !== '0') n++;
    x.fillStyle = b === st.page ? 'rgba(92,242,208,.28)' : b === playBar ? 'rgba(127,216,255,.18)' : 'rgba(255,255,255,.03)'; x.fillRect(b * bw + 1, 1, bw - 2, h - 2);
    x.fillStyle = b === st.page ? '#5cf2d0' : '#4a6a7a'; const hh = Math.min(h - 6, n * 1.1); x.fillRect(b * bw + bw * .3, h - 3 - hh, bw * .4, hh); }
  if (playBar >= 0) { x.strokeStyle = '#7fd8ff'; x.lineWidth = 2; x.strokeRect(playBar * bw + 1, 1, bw - 2, h - 2); }
}

/* ---- SUONI ---- */
let waveC = null, micRec = null;
function pSnd(p) {
  const i = st.sel, V = AE.VOICES[i], v = st.voices[i];
  p.appendChild(chips(AE.VOICES.map((x, k) => [k, x.name, x.sub]), i, k => { st.sel = k; renderPanel(); save(); AE.audition(k); }));
  const r1 = div('btns');
  const seg = (k, t) => { const b = btn(t, () => { if (k === 'mic' && !hasSample(i)) { v.src = 'mic'; renderPanel(); toast('Registra un suono col microfono qui sotto'); return; } v.src = k; AE.renderVoice(i); renderPanel(); save(); AE.audition(i); }, 'sm'); b.setAttribute('aria-pressed', v.src === k); return b; };
  r1.append(seg('synth', '∿ SINTESI'), seg('mic', '🎙 MICROFONO'), btn('▶ PROVA', () => AE.audition(i), 'sm'));
  const mb = btn('MUTO', () => { v.mute = !v.mute; AE.applyStrip(i); mb.setAttribute('aria-pressed', v.mute); save(); }, 'sm'); mb.setAttribute('aria-pressed', v.mute);
  const sb = btn('SOLO', () => { v.solo = !v.solo; for (let k = 0; k < NV; k++) AE.applyStrip(k); sb.setAttribute('aria-pressed', v.solo); save(); }, 'sm'); sb.setAttribute('aria-pressed', v.solo);
  r1.append(mb, sb); p.appendChild(r1);
  const r2 = div('btns'); r2.append(btn('🎲 QUESTO SUONO', () => randomOne(i), 'sm hot'), btn('≈ VARIA', () => randomOne(i, true), 'sm'), btn('🎲 TUTTO IL KIT', randomKit, 'sm'), btn('↶', undo, 'sm'), btn('RESET', () => { snap(); const d = defVoice(i); v.p = d.p; v.m = d.m; v.mix = d.mix; v.seed = 0; AE.renderVoice(i); AE.applyStrip(i); refreshPanel(); save(); AE.audition(i); }, 'sm'));
  p.appendChild(r2);
  waveC = document.createElement('canvas'); waveC.className = 'wavebox'; waveC.style.setProperty('--c', V.color); waveC.onclick = () => AE.audition(i); p.appendChild(waveC); requestAnimationFrame(drawWave);
  if (v.src === 'mic') {
    p.appendChild(lbl('CAMPIONE DAL MICROFONO'));
    const mr = div('btns'), rb = btn(hasSample(i) ? '● REGISTRA DI NUOVO' : '● REGISTRA', null, 'sm rec');
    rb.onclick = async () => {
      boot();
      if (!micRec) { try { await AE.recStart(); micRec = { i, t0: performance.now() }; rb.textContent = '■ FERMA'; rb.setAttribute('aria-pressed', 'true'); micMeter(rb); } catch (e) { toast('Microfono non disponibile: controlla i permessi'); } return; }
      try { const s = await AE.recStop(); micRec = null; AE.setSample(i, s); DB.put('smp' + i, s); v.src = 'mic'; v.m.ini = 0; AE.renderVoice(i); renderPanel(); save(); AE.audition(i); toast('Campione pronto'); } catch (e) { micRec = null; toast('Registrazione non riuscita'); renderPanel(); }
    };
    const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'audio/*'; fi.hidden = true; fi.onchange = async () => { const f = fi.files[0]; if (!f) return; try { const s = await AE.decodeFile(f); AE.setSample(i, s); DB.put('smp' + i, s); v.src = 'mic'; AE.renderVoice(i); renderPanel(); save(); AE.audition(i); } catch (e) { toast('File audio non leggibile'); } };
    mr.append(rb, btn('📂 DA FILE', () => fi.click(), 'sm'), fi); p.appendChild(mr);
    p.appendChild(note('Batti, gratta, schiocca vicino al telefono: il silenzio iniziale viene tolto da solo. Max 6 secondi.'));
    if (hasSample(i)) { p.appendChild(lbl('FORMA DEL CAMPIONE')); const kg = div('kgrid'); AE.MIC.forEach(q => kg.appendChild(knob({ label: q.l, def: q.d, steps: q.steps || 0, color: V.color, get: () => v.m[q.k], set: x => { v.m[q.k] = x; reRender(i); }, fmt: q.f, done: () => { save(); reRender(i, true); } }))); p.appendChild(kg); }
  } else {
    p.appendChild(lbl('SUONO · ' + V.name));
    const kg = div('kgrid'); V.params.forEach(q => kg.appendChild(knob({ label: q.l, def: q.d, color: V.color, get: () => v.p[q.k], set: x => { v.p[q.k] = x; reRender(i); }, fmt: q.f, done: () => { save(); reRender(i, true); } }))); p.appendChild(kg);
  }
  p.appendChild(lbl('CANALE'));
  const mg = div('kgrid'); MIXP.forEach(q => mg.appendChild(knob({ label: q.l, def: q.d, color: V.color, get: () => v.mix[q.k], set: x => { v.mix[q.k] = x; AE.applyStrip(i); }, fmt: q.f, done: save }))); p.appendChild(mg);
}
function hasSample(i) { return !!sampleFlags[i]; }
const sampleFlags = []; { const o = AE.setSample; AE.setSample = (i, s) => { sampleFlags[i] = !!s; o(i, s); }; }
function micMeter(rb) { const f = () => { if (!micRec) return; const l = AE.micLevel(), s = ((performance.now() - micRec.t0) / 1000).toFixed(1); rb.textContent = `■ FERMA ${s}s ${'▮'.repeat(Math.round(l * 8))}`; if (performance.now() - micRec.t0 > 6500) rb.click(); else requestAnimationFrame(f); }; f(); }
function drawWave() {
  const c = waveC; if (!c || !c.isConnected || !AE.ctx) return; const b = AE._buf ? AE._buf(st.sel) : null;
  const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; const x = c.getContext('2d'); x.scale(dpr, dpr);
  x.strokeStyle = 'rgba(255,255,255,.06)'; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
  if (!b) return; const d = b.getChannelData(0), col = AE.VOICES[st.sel].color, n = d.length, step = Math.max(1, Math.floor(n / w));
  x.fillStyle = col; x.globalAlpha = .85; for (let px = 0; px < w; px++) { let mx = 0; const a = Math.floor(px * n / w); for (let k = a; k < a + step && k < n; k++) mx = Math.max(mx, Math.abs(d[k])); const hh = mx * (h / 2 - 2); x.fillRect(px, h / 2 - hh, 1, hh * 2 || 1); }
  x.globalAlpha = 1; x.fillStyle = '#6c8797'; x.font = '9px IBM Plex Mono, monospace'; x.fillText(DSP.msf(n / b.sampleRate), w - 46, 11);
}

/* ---- SPAZIO (riverbero) ---- */
function pRev(p) {
  p.appendChild(lbl('STANZA'));
  p.appendChild(chips(Object.entries(AE.SPACES).map(([k, s]) => [k, s.n, s.s]), st.space, k => { boot(); st.space = k; Object.assign(st.rev, AE.SPACES[k].rev); AE.applySpace(k); AE.applyRev(); refreshPanel(); save(); }));
  p.appendChild(lbl('CRISI DEL RIVERBERO · TIENI PREMUTO'));
  const pads = div('pads five'); RVI.forEach(f => pads.appendChild(pad(f, true))); p.appendChild(pads);
  REVP.forEach(([title, list]) => { p.appendChild(lbl(title)); const kg = div('kgrid'); list.forEach(([k, l, f]) => kg.appendChild(knob({ label: l, def: defState().rev[k], color: '#b9a6ff', get: () => st.rev[k], set: v => { st.rev[k] = v; AE.applyRev(); }, fmt: f, done: save }))); p.appendChild(kg); });
  const b = div('btns'); b.append(btn('🎲 SPAZIO CASUALE', randomSpace, 'sm'), btn('RIPRISTINA STANZA', () => { Object.assign(st.rev, AE.SPACES[st.space].rev); AE.applyRev(); refreshPanel(); save(); }, 'sm')); p.appendChild(b);
  p.appendChild(note('RESPIRO abbassa la coda mentre suonano i colpi e la fa risalire nelle pause: suono pulito anche con code lunghissime. STANZA aggiunge la risposta reale di uno spazio sopra il riverbero principale.'));
}

/* ---- EFFETTI ---- */
const padEls = {};
function pad([k, n, ic, s], rv) {
  const b = document.createElement('button'); b.className = 'pad' + (rv ? ' rv' : '') + (AE.fx[k] ? ' on' : ''); b.innerHTML = `<i></i><b>${ic}</b>${n}<small>${s}</small>`; padEls[k] = b;
  const bar = b.querySelector('i'); let y0 = 0, a0 = .75, held = false;
  const setBar = a => bar.style.height = Math.round(a * 100) + '%'; if (AE.fx[k]) setBar(AE.fx[k]);
  b.addEventListener('pointerdown', e => { e.preventDefault(); boot(); try { b.setPointerCapture(e.pointerId); } catch (er) {} y0 = e.clientY; held = true;
    if (st.latch && AE.fx[k]) { fxOn(k, false); held = false; return; } a0 = .75; fxOn(k, true, a0); setBar(a0); });
  b.addEventListener('pointermove', e => { if (!held || !AE.fx[k]) return; const a = clamp(a0 + (y0 - e.clientY) / 120, .05, 1); fxOn(k, true, a); setBar(a); });
  const end = () => { if (!held) return; held = false; if (!st.latch) fxOn(k, false); };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('contextmenu', e => e.preventDefault());
  return b;
}
let fxSendT = {};
function fxOn(k, on, a = .75, remote) {
  AE.fxSet(k, on, a); const el = padEls[k]; if (el && el.isConnected) { el.classList.toggle('on', on); if (!on) el.querySelector('i').style.height = '0'; else el.querySelector('i').style.height = Math.round(a * 100) + '%'; el.classList.toggle('ext', !!remote && on); }
  if (!remote && st.shareFx && Sync.connected) { clearTimeout(fxSendT[k]); const send = () => Sync.broadcast({ t: 'fx', k, on, a }); if (on) fxSendT[k] = setTimeout(send, 40); else send(); }
}
function pFx(p) {
  const r = div('btns'); const lb = btn(st.latch ? '🔒 BLOCCO ATTIVO: tocca per accendere/spegnere' : '🔓 TIENI PREMUTO · trascina su = più forte', () => { st.latch = !st.latch; if (!st.latch) Object.keys(AE.fx).forEach(k => fxOn(k, false)); refreshPanel(); save(); }, 'sm'); lb.setAttribute('aria-pressed', st.latch); r.append(lb); p.appendChild(r);
  const pads = div('pads'); FXI.forEach(f => pads.appendChild(pad(f))); p.appendChild(pads);
  p.appendChild(lbl('ECO A NASTRO'));
  p.appendChild(chips(AE.DIVS.map((d, k) => [k, d[0]]), st.eco.div, k => { st.eco.div = k; AE.applyEco(); refreshPanel(); save(); }));
  const kg = div('kgrid'); [['fb', 'RITORNI', pct], ['col', 'COLORE', v => DSP.hz(logm(v, 600, 12000))], ['pp', 'PING-PONG', pct], ['lvl', 'LIVELLO', pct]].forEach(([k, l, f]) => kg.appendChild(knob({ label: l, def: defState().eco[k], color: '#7fd8ff', get: () => st.eco[k], set: v => { st.eco[k] = v; AE.applyEco(); }, fmt: f, done: save }))); p.appendChild(kg);
  p.appendChild(lbl('MASTER'));
  const mg = div('kgrid'); [['vol', 'VOLUME', pct], ['glue', 'COLLA', pct], ['heat', 'CALORE', pct]].forEach(([k, l, f]) => mg.appendChild(knob({ label: l, def: defState().master[k], color: '#5cf2d0', get: () => st.master[k], set: v => { st.master[k] = v; AE.applyMaster(); }, fmt: f, done: save }))); p.appendChild(mg);
  p.appendChild(note('ECO: ogni voce manda all’eco con la sua manopola ECO (scheda SUONI). Il pad ECO lancia tutto dentro l’eco finché lo tieni.'));
}

/* ---- SYNC ---- */
function pSync(p) {
  const S = Sync.S, m = S.mode, c = div('card');
  const h = document.createElement('h3'); h.textContent = { solo: 'DA SOLO', host: 'SEI IL CAPO', guest: 'COLLEGATO', clock: 'OROLOGIO' }[m]; c.appendChild(h);
  c.appendChild(note(S.status)); if (S.err) { const e = document.createElement('p'); e.className = 'err'; e.textContent = S.err; c.appendChild(e); }
  if (m === 'host') {
    const cd = div('code'); cd.textContent = S.code; c.appendChild(cd);
    const qc = document.createElement('canvas'); qc.className = 'qrc'; qc.width = qc.height = 336; try { QR.draw(qc, joinLink()); c.appendChild(qc); } catch (e) {}
    c.appendChild(note('Sugli altri telefoni: inquadra il QR con la fotocamera, oppure apri l’app → SYNC → ENTRA e scrivi il codice.'));
    const b = div('btns'); b.append(btn('↗ CONDIVIDI LINK', shareLink, 'sm'), btn('CHIUDI SESSIONE', () => { leaveSync(); }, 'sm warn')); c.appendChild(b);
  } else if (m === 'guest') { const b = div('btns'); b.append(btn('ESCI DALLA SESSIONE', leaveSync, 'sm warn')); c.appendChild(b); }
  else if (m === 'clock') { c.appendChild(note('Nessuna connessione: ogni telefono segue la propria ora di sistema. Imposta lo STESSO BPM su tutti; il ritmo parte sempre a inizio battuta. Se senti uno scarto, correggilo con RITARDO qui sotto.')); const b = div('btns'); b.append(btn('ESCI DALL’OROLOGIO', leaveSync, 'sm warn')); c.appendChild(b); }
  if (S.list && m !== 'solo') { const pl = div('peers'); S.list.forEach(x => { const s = document.createElement('span'); s.innerHTML = `<b>${esc(x.name)}</b><em>${x.host ? 'tempo di riferimento' : x.rtt ? x.rtt + ' ms' : ''}</em>`; pl.appendChild(s); }); c.appendChild(pl); }
  if (m === 'guest' && S.rtt) c.appendChild(note(`Precisione stimata: ±${Math.max(1, Math.round(S.rtt / 4))} ms (ritardo rete ${Math.round(S.rtt)} ms)`));
  p.appendChild(c);
  if (m === 'solo') {
    p.appendChild(lbl('CON INTERNET (anche stessa Wi‑Fi)'));
    const b1 = div('btns'); b1.append(btn('◉ CREA SESSIONE', async () => { boot(); const code = await Sync.host(st.name); if (code) { toast('Sessione ' + code); } refreshPanel(); }, 'hot')); p.appendChild(b1);
    const ir = div('inrow'); const inp = document.createElement('input'); inp.placeholder = 'CODICE'; inp.maxLength = 6; inp.autocapitalize = 'characters'; inp.autocomplete = 'off'; inp.spellcheck = false;
    ir.append(inp, btn('ENTRA', () => joinCode(inp.value))); p.appendChild(ir);
    p.appendChild(lbl('SENZA RETE'));
    const b2 = div('btns'); b2.append(btn('⏱ SYNC A OROLOGIO', () => { boot(); restartIfPlaying(() => Sync.clock()); refreshPanel(); renderHead(); })); p.appendChild(b2);
    p.appendChild(note('Bluetooth: i browser non permettono di collegare due telefoni via Bluetooth. Senza internet usa SYNC A OROLOGIO, oppure fai da hotspot con un telefono e collega gli altri: con internet attivo sull’hotspot la sessione resta in rete locale.'));
  }
  if (m !== 'solo') {
    p.appendChild(lbl('CONDIVIDI CON GLI ALTRI'));
    const b = div('btns'); b.append(btn('⇪ INVIA IL MIO RITMO', () => { sharePattern(true, true); }, 'sm'), btn('⇪ INVIA I MIEI SUONI', shareKit, 'sm'));
    const fb = btn('EFFETTI CONDIVISI', () => { st.shareFx = !st.shareFx; fb.setAttribute('aria-pressed', st.shareFx); save(); }, 'sm'); fb.setAttribute('aria-pressed', st.shareFx); b.append(fb);
    const ub = btn('RITMO IN UNISONO', () => { st.unison = !st.unison; ub.setAttribute('aria-pressed', !!st.unison); save(); if (st.unison) sharePattern(true); }, 'sm'); ub.setAttribute('aria-pressed', !!st.unison); b.append(ub);
    p.appendChild(b);
    p.appendChild(note('RITMO IN UNISONO: ogni modifica al ritmo arriva subito a tutti. EFFETTI CONDIVISI: i pad degli effetti si accendono su tutti i telefoni che lo hanno attivo.'));
  }
  p.appendChild(lbl('QUESTO TELEFONO'));
  const nr = div('inrow'); const ni = document.createElement('input'); ni.className = 'name'; ni.value = st.name; ni.maxLength = 14; ni.onchange = () => { st.name = ni.value.trim() || st.name; Sync.name = st.name; save(); }; nr.append(ni); p.appendChild(nr);
  const nd = div('nudge'), val = document.createElement('b'), upd = () => { val.textContent = (st.nudge > 0 ? '+' : '') + st.nudge + ' ms'; };
  const nb = d => btn(d > 0 ? '+' + d : String(d), () => { st.nudge = clamp(st.nudge + d, -300, 400); AE.S.nudge = st.nudge; upd(); save(); }, 'sm');
  nd.append(nb(-10), nb(-1), val, nb(1), nb(10)); upd(); p.appendChild(lbl('RITARDO DA COMPENSARE')); p.appendChild(nd);
  const pr = div('btns'); pr.append(btn('ALTOPARLANTE · 0', () => { st.nudge = 0; AE.S.nudge = 0; upd(); save(); }, 'sm'), btn('CASSA BLUETOOTH · 180', () => { st.nudge = 180; AE.S.nudge = 180; upd(); save(); }, 'sm'));
  const ck = btn('CLICK DI PROVA', () => { st.click = !st.click; ck.setAttribute('aria-pressed', st.click); save(); }, 'sm'); ck.setAttribute('aria-pressed', !!st.click); pr.append(ck); p.appendChild(pr);
  p.appendChild(note('Se questo telefono suona in ritardo (es. cassa o cuffie Bluetooth) aumenta il valore finché i click coincidono con gli altri. Il click di prova suona sui quarti.'));
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function joinLink() { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('s', Sync.S.code); return u.toString(); }
async function shareLink() { const url = joinLink(); if (navigator.share) { try { await navigator.share({ title: 'ANESTESIA · sessione ' + Sync.S.code, url }); return; } catch (e) {} } try { await navigator.clipboard.writeText(url); toast('Link copiato'); } catch (e) { toast(url, 5000); } }
async function joinCode(code) { boot(); if (AE.S.playing) AE.stop(); const ok = await Sync.join(code, st.name); refreshPanel(); renderHead(); return ok; }
function leaveSync() { restartIfPlaying(() => Sync.leave()); Object.keys(AE.fx).forEach(k => padEls[k] && padEls[k].classList.contains('ext') && fxOn(k, false, 0, true)); refreshPanel(); renderHead(); }
function restartIfPlaying(fn) { const was = AE.S.playing; AE.stop(); fn(); if (was) { const a = mode() === 'clock' ? { s: 0, st: 0 } : { s: Sync.now() + 60, st: 0 }; AE.start(a); } renderHead(); }

/* ================= messaggi di rete ================= */
let lastTr = 0;
Sync.onStatus = S => { renderHead(); if (st.tab === 'sync') { clearTimeout(pSync.t); pSync.t = setTimeout(refreshPanel, 120); } };
Sync.onMsg = (m, P) => {
  if (m.t === 'joined') { toast(`${m.name || 'Un telefono'} è entrato`); announce(); if (st.unison) sharePattern(true); return; }
  if (m.t === 'connected') { toast('Collegato! Il tempo arriva dal capo'); return; }
  if (m.t === 'hello') { return; }
  if (m.t === 'tr' && mode() === 'guest') {
    lastTr = performance.now(); $('playBtn').classList.remove('wait');
    const bpmCh = m.bpm !== st.bpm; st.bpm = m.bpm; st.swing = m.swing;
    if (m.playing) { boot(); if (!AE.S.playing) AE.start(m.anchor); else AE.retime(m.anchor); } else if (AE.S.playing) AE.stop();
    if (bpmCh) AE.applyEco(); renderHead(); save(); return;
  }
  if (m.t === 'req' && mode() === 'host') {
    if (m.a === 'play' && !AE.S.playing) play(); else if (m.a === 'stop' && AE.S.playing) stop(); else if (m.a === 'bpm') setBpm(m.v); else if (m.a === 'swing') { st.swing = m.v; save(); announce(); }
    else announce(); return;
  }
  if (m.t === 'pat') { st.bars = m.bars; st.pat = m.pat.slice(0, NV); st.page = Math.min(st.page, st.bars - 1); if (st.tab === 'seq') refreshPanel(); renderHead(); save(); if (m.loud) toast(`Ritmo ricevuto da ${m.from || 'un telefono'}`); return; }
  if (m.t === 'kit') { snap(); m.voices.forEach((x, i) => { if (!st.voices[i]) return; Object.assign(st.voices[i], { p: x.p, mix: x.mix, seed: x.seed || 0 }); if (st.voices[i].src === 'mic' && x.src !== 'mic') st.voices[i].src = 'synth'; }); if (m.rev) { st.rev = m.rev; st.space = m.space; st.eco = m.eco; } if (booted) { AE.renderAll(); AE.applyAll(); AE.applySpace(st.space); } refreshPanel(); save(); toast(`Suoni ricevuti da ${m.from || 'un telefono'} · ↶ per annullare`); return; }
  if (m.t === 'fx' && st.shareFx) { boot(); fxOn(m.k, m.on, m.a, true); return; }
};
let patT = 0;
function sharePattern(force, loud) { if (!Sync.connected) return; if (!st.unison && !force) return; clearTimeout(patT); patT = setTimeout(() => Sync.broadcast({ t: 'pat', bars: st.bars, pat: st.pat, loud: !!loud }), 120); if (loud) toast('Ritmo inviato'); }
function shareKit() { if (!Sync.connected) return toast('Nessun telefono collegato'); Sync.broadcast({ t: 'kit', voices: st.voices.map(v => ({ p: v.p, mix: v.mix, seed: v.seed, src: v.src })), rev: st.rev, space: st.space, eco: st.eco }); toast('Suoni inviati a tutti'); }
setInterval(() => { if (mode() === 'host' && Sync.connected) announce(); }, 3000);

/* ================= testata & monitor ================= */
let playBar = -1, follow = true, curLoc = -1;
function renderHead() {
  $('bpmTxt').textContent = st.bpm; $('barsN').textContent = st.bars; $('playBtn').classList.toggle('on', AE.S.playing);
  const bar = curLoc >= 0 && AE.S.playing ? Math.floor(curLoc / 16) + 1 : st.page + 1;
  $('barsTxt').textContent = `BATT ${String(bar).padStart(2, '0')}/${String(st.bars).padStart(2, '0')}`;
  const S = Sync.S, chip = $('syncTxt'); const n = S.list ? S.list.length : S.peers.size + 1;
  chip.textContent = { solo: '● SOLO', host: `◉ CAPO · ${n}`, guest: Sync.connected ? `◉ SYNC · ${n}` : '◌ COLLEGO…', clock: '⏱ OROLOGIO' }[S.mode];
  chip.className = 'sync-chip' + (S.mode === 'solo' ? '' : (S.mode === 'guest' && !Sync.connected) ? ' warn' : ' on');
}
const scope = $('scope'), sx = scope.getContext('2d'); let sdpr = 1, cols = 0, lanes = [], revHist = [], lastF = performance.now(), scrollAcc = 0;
const envCache = new WeakMap();
function envOf(b) { let e = envCache.get(b); if (e) return e; const d = b.getChannelData(0), hop = Math.round(b.sampleRate / 200), n = Math.ceil(d.length / hop); e = new Float32Array(n); for (let k = 0; k < n; k++) { let m = 0; for (let j = k * hop; j < Math.min(d.length, (k + 1) * hop); j++) m = Math.max(m, Math.abs(d[j])); e[k] = m; } envCache.set(b, e); return e; }
function resize() { sdpr = Math.min(2, devicePixelRatio || 1); const w = scope.clientWidth, h = scope.clientHeight; if (!w || !h) return; scope.width = Math.round(w * sdpr); scope.height = Math.round(h * sdpr); cols = Math.ceil(w / 2); lanes = Array.from({ length: NV }, () => new Float32Array(cols)); revHist = new Float32Array(cols); drawBarMap(); drawWave(); }
window.addEventListener('resize', resize); new ResizeObserver(resize).observe(scope);
const active = [];
function frame(now) {
  requestAnimationFrame(frame); const dt = Math.min(.1, (now - lastF) / 1000); lastF = now;
  const ctx = AE.ctx, t = ctx ? ctx.currentTime : 0;
  // eventi audio → monitor
  while (AE.events.length && ctx && AE.events[0].t <= t + .01) { const e = AE.events.shift(); active.push({ v: e.v, t: e.t, vel: e.vel, env: envOf(e.b), ph: Math.random() * 6 }); if (e.v === 0) { const pu = $('pulse'); pu.style.transform = 'scale(1.8)'; setTimeout(() => pu.style.transform = '', 90); } }
  // passo attuale
  let loc = -1; if (ctx && AE.S.playing) { for (const s of AE.steps) if (s.t <= t + .005) loc = s.loc; }
  if (loc !== curLoc) { curLoc = loc; onStep(loc); }
  if (!lanes.length) return;
  const W = scope.width / sdpr, H = scope.height / sdpr;
  scrollAcc += dt * 70; let shift = Math.floor(scrollAcc / 2); scrollAcc -= shift * 2; shift = Math.min(shift, cols);
  const vals = new Float32Array(NV);
  for (let k = active.length - 1; k >= 0; k--) { const a = active[k], age = t - a.t, idx = Math.floor(age * 200); if (idx >= a.env.length) { active.splice(k, 1); continue; } if (idx >= 0) vals[a.v] = Math.max(vals[a.v], a.env[idx] * a.vel); }
  const rl = AE.revLevel();
  if (shift > 0) { for (let i = 0; i < NV; i++) { lanes[i].copyWithin(0, shift); for (let k = cols - shift; k < cols; k++) lanes[i][k] = vals[i]; } revHist.copyWithin(0, shift); for (let k = cols - shift; k < cols; k++) revHist[k] = rl; }
  // disegno
  const c = sx; c.setTransform(sdpr, 0, 0, sdpr, 0, 0); c.fillStyle = '#010407'; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(92,242,208,.05)'; c.lineWidth = 1; c.beginPath(); for (let x = W; x > 0; x -= 24) { c.moveTo(x + .5, 0); c.lineTo(x + .5, H); } for (let y = 0; y < H; y += 24) { c.moveTo(0, y + .5); c.lineTo(W, y + .5); } c.stroke();
  const top = 14, revH = Math.max(14, H * .2), laneH = (H - top - revH - 4) / NV;
  for (let i = 0; i < NV; i++) {
    const V = AE.VOICES[i], yb = top + laneH * (i + .5), amp = laneH * .48, v = st.voices[i];
    c.strokeStyle = V.color; c.globalAlpha = v.mute ? .2 : .9; c.lineWidth = 1.2; c.beginPath();
    for (let k = 0; k < cols; k++) { const a = Math.pow(lanes[i][k], .55), x = k * 2, y = yb - Math.sin(k * (.9 + i * .37) + i) * a * amp * 1.6 - (k % 7 === 0 ? .4 : 0); k ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.shadowColor = V.color; c.shadowBlur = 6; c.lineWidth = 1.4; c.stroke(); c.shadowBlur = 0; c.globalAlpha = .55; c.fillStyle = V.color; c.font = '8px IBM Plex Mono, monospace'; c.fillText(V.name, 4, yb - amp * .55 + 3); c.globalAlpha = 1;
  }
  // energia del riverbero
  const yb = H - 3; c.beginPath(); c.moveTo(0, yb); for (let k = 0; k < cols; k++) c.lineTo(k * 2, yb - Math.min(1, revHist[k] * 9) * revH); c.lineTo(W, yb); c.closePath();
  const gr = c.createLinearGradient(0, yb - revH, 0, yb); gr.addColorStop(0, 'rgba(185,166,255,.55)'); gr.addColorStop(1, 'rgba(185,166,255,.04)'); c.fillStyle = gr; c.fill();
  c.fillStyle = 'rgba(185,166,255,.7)'; c.font = '8px IBM Plex Mono, monospace'; c.fillText('SPAZIO', 4, yb - revH + 9);
  // passi in alto
  const sw = (W - 8) / 16; for (let s = 0; s < 16; s++) { const on = curLoc >= 0 && (curLoc % 16) === s; c.fillStyle = on ? '#5cf2d0' : s % 4 === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.07)'; c.fillRect(4 + s * sw + 1, 4, sw - 2, 3); }
  // effetti attivi
  const fxa = Object.keys(AE.fx); if (fxa.length) { c.font = '9px IBM Plex Mono, monospace'; c.textAlign = 'right'; c.fillStyle = '#7fd8ff'; c.fillText(fxa.map(k => ([...FXI, ...RVI].find(f => f[0] === k) || [0, k])[1]).join(' · ') + ' ●', W - 5, 18); c.textAlign = 'left'; }
  if (AE.recording) { c.fillStyle = '#ff6b7a'; c.font = '9px IBM Plex Mono, monospace'; c.fillText('● REC ' + Math.floor((performance.now() - AE.mixT0) / 1000) + 's', W - 70, H - revH - 6); }
}
function onStep(loc) {
  if (loc < 0) { for (const r of cells) r && r.forEach(c => c.classList.remove('now')); playBar = -1; renderHead(); drawBarMap(); return; }
  const bar = Math.floor(loc / 16); if (bar !== playBar) { playBar = bar; if (follow && st.tab === 'seq' && bar !== st.page) { st.page = bar; paintCells(); } drawBarMap(); renderHead(); }
  for (const r of cells) r && r.forEach((c, s) => c.classList.toggle('now', st.page * 16 + s === loc));
}
requestAnimationFrame(frame);

/* ================= installazione & avvio ================= */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('instBtn').hidden = false; });
$('instBtn').onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) {} deferredInstall = null; $('instBtn').hidden = true; };
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
function intro() {
  openSheet('ANESTESIA', b => {
    [['▶', 'Premi play: il ritmo è già pronto. ⟳ GENERA ne crea uno nuovo, 🎲 KIT cambia tutti i suoni.'], ['RITMO', 'Tocca i passi per accendere i colpi (forte, piano, medio). 6 voci, da 1 a 40 battute.'],
     ['SUONI', 'Ogni voce ha le sue manopole, il suo 🎲 casuale e il ≈ VARIA. Puoi anche registrarla col microfono.'], ['SPAZIO', 'Il riverbero: 5 stanze, 14 manopole e 5 crisi da tenere premute.'],
     ['EFFETTI', '8 pad da tenere premuti, trascinando in su per aumentarli.'], ['SYNC', 'Collega più telefoni: suonano a tempo insieme.']].forEach(([t, d]) => { const p = document.createElement('p'); p.innerHTML = `<b style="color:var(--mint);font-family:var(--mono)">${t}</b> · ${d}`; b.appendChild(p); });
    if (/iphone|ipad/i.test(navigator.userAgent)) b.appendChild(note('Per installarla su iPhone: Condividi → Aggiungi alla schermata Home. Togli il silenzioso per sentire l’audio.'));
    const go = btn('INIZIA', () => { boot(); st.seen = true; save(); closeSheet(); }, 'hot'); b.appendChild(go);
  });
}
renderHead(); renderPanel();
const qcode = new URLSearchParams(location.search).get('s');
if (qcode) { st.tab = 'sync'; renderPanel(); joinCode(qcode).then(() => { history.replaceState(null, '', location.pathname); }); openSheet('SESSIONE ' + qcode.toUpperCase(), b => { b.appendChild(note('Ti stai collegando alla sessione. Tocca il pulsante per attivare l’audio.')); b.appendChild(btn('ENTRA E ASCOLTA', () => { boot(); st.seen = true; save(); closeSheet(); }, 'hot')); }); }
else if (!st.seen) intro();
window.__an = { st, AE, Sync, generate, randomKit, randomOne, fxOn, joinCode, play, setBpm, refreshPanel };
