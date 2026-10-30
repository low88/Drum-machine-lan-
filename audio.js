'use strict';
/* ANESTESIA · motore audio: voci, mixer, eco a nastro, riverbero ABISSO + stanze a convoluzione, master, effetti, sequencer sincronizzabile */
const AE = (() => {
const { VOICES, MIC, clamp, logm, rng } = DSP;
const NV = VOICES.length, VEL = [0, .36, .66, 1], LOOK = 140;
let ctx = null, st = null, worklet = null, workletP = null, streamDest = null, an = null, ranR = null;
const M = {}, RV = {}, EC = {}, strips = [], bufs = Array.from({ length: NV }, () => []), samples = [];
const S = { playing: false, anchor: { s: 0, st: 0 }, next: 0, nudge: 0, map: null };
const clock = { now: () => performance.now(), off: () => 0 };
const events = [], steps = [];
const fx = {};
const R = rng(Date.now() & 0xffff);

const DIVS = [['1/16', .25], ['1/8', .5], ['3/16', .75], ['1/4', 1], ['3/8', 1.5], ['1/2', 2]];
const decayS = v => .3 * Math.pow(73.33, v), lowM = v => .5 * Math.pow(4, v), preS = v => v * .25;
const SPACES = {
  sala: { n: 'SALA OP.', s: 'piastrelle', rev: { size: .25, decay: .32, damp: .2, low: .4, pre: .05, diff: .85, mod: .12, width: .7, er: .65, room: .3 }, ir: { len: 1.6, rt: 1.1, er: 18, erT: .025, bright: 1, lo: 1 } },
  corridoio: { n: 'CORRIDOIO', s: 'lungo', rev: { size: .6, decay: .54, damp: .45, low: .55, pre: .15, diff: .45, mod: .25, width: .9, er: .5, room: .35 }, ir: { len: 3.5, rt: 2.6, er: 10, erT: .12, bright: .6 } },
  iperbarica: { n: 'IPERBARICA', s: 'metallo', rev: { size: .42, decay: .6, damp: .15, low: .35, pre: .08, diff: .3, mod: .05, width: .8, er: .4, room: .45 }, ir: { len: 3.5, rt: 3.2, er: 6, erT: .02, bright: 1.1 } },
  cisterna: { n: 'CISTERNA', s: 'buia', rev: { size: .8, decay: .72, damp: .72, low: .7, pre: .2, diff: .85, mod: .35, width: .75, er: .3, room: .4 }, ir: { len: 6, rt: 5.5, er: 8, erT: .09, bright: .35, dark: 2500 } },
  cattedrale: { n: 'CATTEDRALE', s: 'immensa', rev: { size: 1, decay: .84, damp: .55, low: .6, pre: .28, diff: .92, mod: .45, width: .75, er: .25, room: .35 }, ir: { len: 6, rt: 6, er: 12, erT: .14, bright: .5 } },
};
const FXN = ['eco', 'aritmia', 'fibrilla', 'sedativo', 'adrenalina', 'anestesia', 'vertigine', 'apnea', 'congela', 'inverso', 'abisso', 'spasmo', 'risucchio'];

function g(v) { const n = ctx.createGain(); n.gain.value = v; return n; }
function bq(type, f, q = .707) { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; }
function ramp(param, v, tc = .04) { if (!ctx) return; param.cancelScheduledValues(ctx.currentTime); param.setTargetAtTime(v, ctx.currentTime, tc); }
function shaper(drive) { const w = ctx.createWaveShaper(), n = 2048, c = new Float32Array(n), td = Math.tanh(drive); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * drive) / td; } w.curve = c; w.oversample = '4x'; return w; }

function init() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  // ---- master
  M.dry = g(1); M.sum = g(1); M.lp = bq('lowpass', 20000, .5); M.hp = bq('highpass', 12, .5);
  M.vIn = g(1); M.vDry = g(1); M.vDel = ctx.createDelay(.1); M.vDel.delayTime.value = .012; M.vWet = g(0); M.vOut = g(1);
  M.lfo = ctx.createOscillator(); M.lfo.frequency.value = .37; M.lfoG = g(.002); M.lfo.connect(M.lfoG).connect(M.vDel.delayTime); M.lfo.start();
  M.pan = ctx.createStereoPanner(); M.panLfo = ctx.createOscillator(); M.panLfo.frequency.value = .21; M.panG = g(0); M.panLfo.connect(M.panG).connect(M.pan.pan); M.panLfo.start();
  M.hDry = g(1); M.hWet = g(0); M.heat = shaper(2.6); M.hOut = g(1);
  M.glue = ctx.createDynamicsCompressor(); M.mk = g(1);
  M.lim = ctx.createDynamicsCompressor(); Object.assign(M.lim, {}); M.lim.threshold.value = -2; M.lim.knee.value = 0; M.lim.ratio.value = 20; M.lim.attack.value = .002; M.lim.release.value = .12;
  M.out = g(.8); M.clip = shaper(1.2);
  M.dry.connect(M.sum); M.sum.connect(M.lp).connect(M.hp).connect(M.vIn);
  M.vIn.connect(M.vDry).connect(M.vOut); M.vIn.connect(M.vDel).connect(M.vWet).connect(M.vOut);
  M.vOut.connect(M.pan); M.pan.connect(M.hDry).connect(M.hOut); M.pan.connect(M.heat).connect(M.hWet).connect(M.hOut);
  M.hOut.connect(M.glue).connect(M.mk).connect(M.lim).connect(M.out).connect(M.clip).connect(ctx.destination);
  an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = .6; M.clip.connect(an);
  try { streamDest = ctx.createMediaStreamDestination(); M.clip.connect(streamDest); } catch (e) {}
  // ---- riverbero
  RV.in = g(1); RV.hp = bq('highpass', 90, .6); RV.in.connect(RV.hp);
  RV.pre = ctx.createDelay(1); RV.conv = ctx.createConvolver(); RV.convG = g(.35); RV.hp.connect(RV.pre).connect(RV.conv).connect(RV.convG);
  RV.rconv = ctx.createConvolver(); RV.revG = g(0); RV.hp.connect(RV.rconv).connect(RV.revG);
  RV.fdnG = g(1); RV.ret = g(1); RV.lo = bq('highpass', 120, .6); RV.hi = bq('lowpass', 9000, .6); RV.gate = g(1); RV.out = g(.8);
  RV.convG.connect(RV.ret); RV.revG.connect(RV.ret); RV.fdnG.connect(RV.ret);
  RV.ret.connect(RV.lo).connect(RV.hi).connect(RV.gate).connect(RV.out).connect(M.sum);
  RV.an = ctx.createAnalyser(); RV.an.fftSize = 512; RV.out.connect(RV.an);
  setIR(RV.rconv, { len: 2.4, rt: 2.2, reverse: true, bright: .6 });
  // ---- eco a nastro
  EC.in = g(1); EC.hp = bq('highpass', 160, .6); EC.dl = ctx.createDelay(5); EC.dr = ctx.createDelay(5);
  EC.inR = g(0); EC.lpL = bq('lowpass', 3500, .6); EC.lpR = bq('lowpass', 3500, .6); EC.shL = shaper(1.6); EC.shR = shaper(1.6);
  EC.selfL = g(0); EC.selfR = g(0); EC.xLR = g(0); EC.xRL = g(0); EC.mg = ctx.createChannelMerger(2); EC.out = g(.6); EC.toRev = g(.3);
  EC.in.connect(EC.hp); EC.hp.connect(EC.dl); EC.hp.connect(EC.inR).connect(EC.dr);
  EC.dl.connect(EC.lpL).connect(EC.shL); EC.shL.connect(EC.selfL).connect(EC.dl); EC.shL.connect(EC.xLR).connect(EC.dr);
  EC.dr.connect(EC.lpR).connect(EC.shR); EC.shR.connect(EC.selfR).connect(EC.dr); EC.shR.connect(EC.xRL).connect(EC.dl);
  EC.dl.connect(EC.mg, 0, 0); EC.dr.connect(EC.mg, 0, 1); EC.mg.connect(EC.out).connect(M.sum); EC.out.connect(EC.toRev).connect(RV.in);
  EC.wow = ctx.createOscillator(); EC.wow.frequency.value = .53; EC.wowG = g(.0012); EC.wow.connect(EC.wowG); EC.wowG.connect(EC.dl.delayTime); EC.wowG.connect(EC.dr.delayTime); EC.wow.start();
  EC.throw = g(0); M.dry.connect(EC.throw).connect(EC.in);
  // ---- canali
  for (let i = 0; i < NV; i++) {
    const s = { inp: g(1), filt: bq('lowpass', 22000, .9), pan: ctx.createStereoPanner(), out: g(.8), rs: g(.3), es: g(0) };
    s.inp.connect(s.filt).connect(s.pan).connect(s.out); s.out.connect(M.dry); s.out.connect(s.rs).connect(RV.in); s.out.connect(s.es).connect(EC.in);
    strips.push(s);
  }
  workletP = ctx.audioWorklet ? ctx.audioWorklet.addModule('reverb-worklet.js').then(() => {
    worklet = new AudioWorkletNode(ctx, 'abisso', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2], channelCountMode: 'explicit', channelCount: 2 });
    RV.hp.connect(worklet, 0, 0); M.dry.connect(worklet, 0, 1); worklet.connect(RV.fdnG); applyRev();
  }).catch(e => { console.warn('worklet', e); RV.convG.gain.value = 1; }) : Promise.resolve();
  startTimer();
  return ctx;
}
function setIR(node, o) { const ir = DSP.makeIR(o, ctx.sampleRate), b = ctx.createBuffer(2, ir.L.length, ctx.sampleRate); b.copyToChannel(ir.L, 0); b.copyToChannel(ir.R, 1); node.normalize = false; node.buffer = b; }

/* ---------- stato & suoni ---------- */
function bind(state) { st = state; }
function voiceSeed(i, k) { return 1000 + i * 97 + k * 13; }
function renderVoice(i) {
  if (!ctx) return; const v = st.voices[i], sr = ctx.sampleRate, out = [];
  const smp = v.src === 'mic' ? samples[i] : null;
  const p = smp ? v.m : v.p, nVar = smp ? 1 : 3;
  for (let k = 0; k < nVar; k++) { const o = DSP.render(i, p, sr, voiceSeed(i, k) + (v.seed || 0), smp ? { data: smp.data, sr: smp.sr } : null), b = ctx.createBuffer(2, o.L.length, sr); b.copyToChannel(o.L, 0); b.copyToChannel(o.R, 1); out.push(b); }
  bufs[i] = out;
}
function renderAll() { for (let i = 0; i < NV; i++) renderVoice(i); }
function setSample(i, s) { samples[i] = s; }
function applyStrip(i) {
  if (!ctx) return; const s = strips[i], v = st.voices[i], p = v.mix, solo = st.voices.some(x => x.solo);
  const on = !v.mute && (!solo || v.solo);
  ramp(s.out.gain, on ? p.lvl * p.lvl * 1.35 : 0, .02); ramp(s.pan.pan, (p.pan - .5) * 2, .03);
  ramp(s.rs.gain, p.rev * p.rev * 1.6, .03); ramp(s.es.gain, p.eco * p.eco * 1.2, .03);
  const f = p.fil; if (f < .47) { s.filt.type = 'lowpass'; ramp(s.filt.frequency, logm(f / .47, 150, 20000), .03); } else if (f > .53) { s.filt.type = 'highpass'; ramp(s.filt.frequency, logm((f - .53) / .47, 20, 4000), .03); } else { s.filt.type = 'lowpass'; ramp(s.filt.frequency, 22000, .03); }
}
function applyAll() { for (let i = 0; i < NV; i++) applyStrip(i); applyRev(); applyEco(); applyMaster(); }
function applySpace(key) { const sp = SPACES[key]; if (!sp || !ctx) return; setIR(RV.conv, sp.ir); }
function applyRev() {
  if (!ctx) return; const r = st.rev, a = x => fx[x] || 0;
  const ab = a('abisso');
  const P = { size: Math.max(r.size, ab ? .85 + ab * .15 : 0), decay: decayS(r.decay) * (1 + ab * 5), damp: clamp(r.damp + ab * .25, 0, 1), low: lowM(r.low), mod: r.mod, diff: r.diff, pre: preS(r.pre), width: r.width * 1.5, er: r.er * 1.4, duck: Math.max(r.duck, a('risucchio')), rel: a('risucchio') ? .45 : .08 + r.duck * .3, freeze: a('congela') ? 1 : 0, tail: 1 };
  if (worklet) worklet.port.postMessage(P);
  RV.pre.delayTime.setTargetAtTime(P.pre, ctx.currentTime, .05);
  ramp(RV.convG.gain, worklet ? r.room * r.room * 1.6 * (a('congela') ? .3 : 1) : 1.2, .08);
  ramp(RV.revG.gain, a('inverso') * 1.6, .06);
  ramp(RV.lo.frequency, logm(r.lo, 20, 800), .05); ramp(RV.hi.frequency, logm(r.hi, 1000, 20000) * (a('anestesia') ? .5 : 1), .05);
  ramp(RV.out.gain, r.lvl * r.lvl * 1.5 * (1 + a('anestesia') * 2 + a('apnea') * 1.6), .06);
}
function applyEco() {
  if (!ctx) return; const e = st.eco, a = x => fx[x] || 0, beat = 60 / st.bpm, t = clamp(DIVS[e.div][1] * beat, .02, 4.5);
  EC.dl.delayTime.setTargetAtTime(t, ctx.currentTime, .08); EC.dr.delayTime.setTargetAtTime(e.pp > .5 ? t : t * 1.02, ctx.currentTime, .08);
  const fb = Math.max(e.fb * .9, a('eco') ? .62 + a('eco') * .3 : 0), pp = e.pp;
  ramp(EC.selfL.gain, fb * (1 - pp)); ramp(EC.selfR.gain, fb * (1 - pp)); ramp(EC.xLR.gain, fb * pp); ramp(EC.xRL.gain, fb * pp); ramp(EC.inR.gain, 1 - pp);
  const lp = logm(e.col, 600, 12000); ramp(EC.lpL.frequency, lp); ramp(EC.lpR.frequency, lp);
  ramp(EC.out.gain, e.lvl * e.lvl * 1.3 * (1 + a('anestesia') * .6)); ramp(EC.throw.gain, a('eco') * 1.1, .03);
}
function applyMaster() {
  if (!ctx) return; const m = st.master, a = x => fx[x] || 0;
  const se = a('sedativo'), ad = a('adrenalina'), an_ = a('anestesia'), ve = a('vertigine'), ap = a('apnea');
  let lp = 20000 * Math.pow(260 / 20000, se * .95); if (an_) lp = Math.min(lp, 20000 * Math.pow(1800 / 20000, an_)); ramp(M.lp.frequency, lp, .12); ramp(M.lp.Q, .5 + se * 3, .1);
  ramp(M.hp.frequency, 12 * Math.pow(60, ad), .1);
  ramp(M.dry.gain, (1 - an_ * .62) * (1 - ap * .92), .05);
  const w = Math.sqrt(ve); ramp(M.vDry.gain, 1 - w * .85, .08); ramp(M.vWet.gain, w, .08); ramp(M.lfoG.gain, .0015 + ve * .006, .1); ramp(M.panG.gain, ve * .8, .2);
  const heat = clamp(m.heat + ad * .6, 0, 1); ramp(M.hDry.gain, 1 - heat * .6, .05); ramp(M.hWet.gain, heat * .9, .05);
  const gl = m.glue; M.glue.threshold.value = -4 - gl * 24; M.glue.ratio.value = 1.4 + gl * 3; M.glue.knee.value = 10; M.glue.attack.value = .025; M.glue.release.value = .3; ramp(M.mk.gain, 1 + gl * .9, .05);
  ramp(M.out.gain, m.vol * m.vol * 1.1, .05);
}
function fxSet(name, on, amt = .75) {
  if (on) fx[name] = clamp(amt, .05, 1); else delete fx[name];
  if (name === 'aritmia') rep = on ? { s0: S.next, n: amt < .34 ? 4 : amt < .67 ? 2 : 1, base: null } : null;
  if (name === 'spasmo' && !on && ctx) { RV.gate.gain.cancelScheduledValues(ctx.currentTime); RV.gate.gain.setTargetAtTime(1, ctx.currentTime, .02); }
  if (['congela', 'inverso', 'abisso', 'risucchio', 'anestesia', 'apnea'].includes(name)) applyRev();
  if (['eco', 'anestesia'].includes(name)) applyEco();
  if (['sedativo', 'adrenalina', 'anestesia', 'vertigine', 'apnea'].includes(name)) applyMaster();
}
let rep = null;

/* ---------- suonare ---------- */
function hit(i, t, vel = 1, opt = {}) {
  if (!ctx) return; const b = bufs[i]; if (!b || !b.length) return; const v = st.voices[i], mix = v.mix, va = mix.var;
  const src = ctx.createBufferSource(); src.buffer = b[(R() * b.length) | 0];
  src.playbackRate.value = (1 + (R() - .5) * va * .08) * (opt.rate || 1);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(700 + Math.pow(vel, 1.6) * 19000 * (1 - va * .35 * R()), 400, 21000); lp.Q.value = .5;
  const gn = ctx.createGain(); gn.gain.value = Math.pow(vel, 1.3) * (1 - va * .25 * R());
  src.connect(lp).connect(gn).connect(strips[i].inp); src.start(t); src.onended = () => { try { gn.disconnect(); } catch (e) {} };
  events.push({ v: i, t, vel, b: src.buffer }); if (events.length > 200) events.splice(0, 100);
}
function audition(i, vel = .85) { init(); ctx.resume(); hit(i, ctx.currentTime + .015, vel); }

/* ---------- tempo condiviso ---------- */
const stepMs = () => 60000 / st.bpm / 4;
function gridTime(s) { return S.anchor.s + (s - S.anchor.st) * stepMs(); }
function stepShared(s) { return gridTime(s) + ((s & 1) ? st.swing * .5 * stepMs() : 0); }
function updMap() {
  let m = null; try { const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp(); if (ts && ts.performanceTime > 0 && ts.contextTime > 0) m = ts.contextTime - ts.performanceTime / 1000; } catch (e) {}
  if (m == null) m = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - performance.now() / 1000;
  if (S.map == null || Math.abs(m - S.map) > .03) S.map = m; else S.map += (m - S.map) * .02;
}
function toCtx(sharedMs) { return (sharedMs - clock.off()) / 1000 + S.map - S.nudge / 1000; }
function sharedAtCtx(t) { return (t + S.nudge / 1000 - S.map) * 1000 + clock.off(); }
const mod = (a, n) => ((a % n) + n) % n;
function sched() {
  if (!ctx || !S.playing || !st) return; updMap();
  const horizon = clock.now() + LOOK; let guard = 0;
  while (guard++ < 64) {
    const ts = stepShared(S.next); if (ts > horizon) break;
    const t = toCtx(ts); if (t >= ctx.currentTime - .006) playStep(S.next, Math.max(t, ctx.currentTime + .001));
    S.next++;
  }
}
function playStep(s, t) {
  const L = st.bars * 16; let loc = mod(s, L);
  if (rep && fx.aritmia) { if (rep.base == null) rep.base = mod(rep.s0 - rep.n, L); loc = mod(rep.base + mod(s - rep.s0, rep.n), L); }
  steps.push({ s, loc, t }); if (steps.length > 64) steps.splice(0, 32);
  const sd = stepMs() / 1000;
  for (let i = 0; i < NV; i++) {
    const v = st.voices[i], d = st.pat[i].charCodeAt(loc) - 48; if (!(d > 0)) continue;
    if (R() > v.mix.prob) continue;
    const vel = VEL[d]; hit(i, t, vel);
    const fb = fx.fibrilla; if (fb && R() < .35 + fb * .6) { const n = 2 + Math.floor(fb * 2.99); for (let k = 1; k < n; k++) hit(i, t + k * sd / n, vel * (1 - k * .22)); }
  }
  if (st.click && mod(s, 4) === 0) { const o = ctx.createOscillator(), gg = ctx.createGain(); o.frequency.value = mod(s, 16) === 0 ? 2400 : 1600; gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(.3, t + .001); gg.gain.exponentialRampToValueAtTime(.001, t + .025); o.connect(gg).connect(M.mk); o.start(t); o.stop(t + .03); }
  if (fx.spasmo) { const gg = RV.gate.gain, on = (s & 1) === 0; gg.setTargetAtTime(on ? 1 : .02 + (1 - fx.spasmo) * .3, t, .004); }
}
function start(anchor) {
  init(); ctx.resume(); updMap(); S.anchor = { s: anchor.s, st: anchor.st };
  const k = Math.ceil((clock.now() + 2 - anchor.s) / stepMs()); S.next = anchor.st + Math.max(0, k); S.playing = true; if (fx.aritmia && rep) rep.s0 = S.next; sched();
}
function retime(anchor) { S.anchor = { s: anchor.s, st: anchor.st }; if (S.playing) { const k = Math.ceil((clock.now() + LOOK + 1 - anchor.s) / stepMs()); const n = anchor.st + Math.max(0, k); if (n > S.next || S.next - n > 2) S.next = Math.max(n, anchor.st); } applyEco(); }
function stop() { S.playing = false; }
/* propone un ancoraggio futuro (per avvii e cambi di tempo condivisi) */
function anchorAt(delayMs) { const now = clock.now(); if (!S.playing) return { s: now + delayMs, st: 0 }; const sm = stepMs(); let s = Math.max(S.next, Math.ceil((now + delayMs - S.anchor.s) / sm) + S.anchor.st); return { s: gridTime(s), st: s }; }
let timer = null;
function startTimer() {
  if (timer) return;
  try { const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),20)'], { type: 'text/javascript' }))); w.onmessage = sched; timer = w; } catch (e) { timer = setInterval(sched, 20); }
}

/* ---------- microfono & registrazione ---------- */
let mic = null;
async function recStart() {
  init(); await ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = ctx.createMediaStreamSource(stream), a = ctx.createAnalyser(); a.fftSize = 1024; src.connect(a);
  const mr = new MediaRecorder(stream), chunks = []; mr.ondataavailable = e => e.data.size && chunks.push(e.data); mr.start(100);
  mic = { stream, mr, chunks, a, buf: new Float32Array(1024) }; return true;
}
function micLevel() { if (!mic) return 0; mic.a.getFloatTimeDomainData(mic.buf); let m = 0; for (const x of mic.buf) m = Math.max(m, Math.abs(x)); return m; }
function trim(buf, maxSec) {
  const n = buf.length, ch = buf.numberOfChannels, mono = new Float32Array(n); for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
  let pk = 0; for (const x of mono) pk = Math.max(pk, Math.abs(x)); const th = pk * .06; let a = 0, b = n - 1; while (a < n && Math.abs(mono[a]) < th) a++; while (b > a && Math.abs(mono[b]) < th * .5) b--;
  a = Math.max(0, a - Math.round(buf.sampleRate * .004)); b = Math.min(n - 1, b + Math.round(buf.sampleRate * .05), a + Math.round(buf.sampleRate * maxSec));
  const out = mono.slice(a, b); const k = pk > 1e-4 ? .95 / pk : 1; for (let i = 0; i < out.length; i++) out[i] *= k; return { data: out, sr: buf.sampleRate };
}
function recStop() { return new Promise((res, rej) => { if (!mic) return rej(new Error('no mic')); const m = mic; mic = null; m.mr.onstop = async () => { m.stream.getTracks().forEach(t => t.stop()); try { const ab = await new Blob(m.chunks, { type: m.mr.mimeType }).arrayBuffer(); res(trim(await ctx.decodeAudioData(ab), 6)); } catch (e) { rej(e); } }; m.mr.stop(); }); }
async function decodeFile(f) { init(); return trim(await ctx.decodeAudioData(await f.arrayBuffer()), 6); }
let mixRec = null;
function mixStart() { if (!streamDest || !window.MediaRecorder) return false; const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || ''; const mr = new MediaRecorder(streamDest.stream, type ? { mimeType: type, audioBitsPerSecond: 256000 } : undefined), chunks = []; mr.ondataavailable = e => e.data.size && chunks.push(e.data); mr.start(250); mixRec = { mr, chunks, t0: performance.now() }; return true; }
function mixStop() { return new Promise(res => { if (!mixRec) return res(null); const m = mixRec; mixRec = null; m.mr.onstop = () => { const type = m.mr.mimeType || 'audio/webm'; res({ blob: new Blob(m.chunks, { type }), ext: type.includes('mp4') ? 'm4a' : 'webm', secs: (performance.now() - m.t0) / 1000 }); }; m.mr.stop(); }); }
function level() { if (!an) return 0; const b = level.b || (level.b = new Float32Array(1024)); an.getFloatTimeDomainData(b); let m = 0; for (let i = 0; i < b.length; i += 2) m = Math.max(m, Math.abs(b[i])); return m; }
function wave(arr) { if (an) an.getFloatTimeDomainData(arr); }
function revLevel() { if (!RV.an) return 0; const b = revLevel.b || (revLevel.b = new Float32Array(512)); RV.an.getFloatTimeDomainData(b); let m = 0; for (let i = 0; i < b.length; i += 4) m += b[i] * b[i]; return Math.sqrt(m / 128); }

return { NV, VOICES, MIC, VEL, S, SPACES, DIVS, FXN, clock, events, steps, fx, bind, init, renderVoice, renderAll, setSample, applyStrip, applyAll, applyRev, applyEco, applyMaster, applySpace, fxSet,
  hit, audition, start, stop, retime, anchorAt, stepMs, gridTime, toCtx, sharedAtCtx, updMap, recStart, recStop, micLevel, decodeFile, mixStart, mixStop, level, wave, revLevel, decayS, lowM, preS,
  _buf: i => bufs[i] && bufs[i][0], get ctx() { return ctx; }, get ready() { return workletP; }, get recording() { return !!mixRec; }, get mixT0() { return mixRec ? mixRec.t0 : 0; }, get hasWorklet() { return !!worklet; } };
})();
