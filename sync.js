'use strict';
/* ANESTESIA · sincronizzazione tra più telefoni.
   - SESSIONE: un telefono crea un codice, gli altri entrano. Segnalazione tramite il server pubblico PeerJS,
     poi collegamento diretto WebRTC (sulla stessa Wi-Fi il traffico resta in rete locale).
   - OROLOGIO: nessuna connessione, i telefoni si allineano all'ora di sistema (sincronizzata dalla rete).
   Il tempo condiviso è in millisecondi: shared = performance.now() + offset. */
const Sync = (() => {
const qs = new URLSearchParams(location.search);
const SIG = qs.get('sig') || 'wss://0.peerjs.com:443/peerjs';
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }];
const PFX = 'anestesia-', ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const S = { mode: 'solo', code: '', status: 'Da solo', peers: new Map(), off: 0, rtt: 0, err: '', hostName: '' };
let sig = null, hb = null, onMsg = () => {}, onStatus = () => {}, pingT = null, samples = [], wallT = null, myName = 'TEL';
const now = () => performance.now() + S.off;
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ABC[b % ABC.length]).join('');

function status(s, err) { S.status = s; if (err !== undefined) S.err = err; onStatus(S); }

/* --- client del protocollo PeerJS (solo segnalazione) --- */
function connectSig(id) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${SIG}?key=peerjs&id=${encodeURIComponent(id)}&token=${rid(10)}&version=1.5.4`);
    let opened = false; const to = setTimeout(() => { if (!opened) { try { ws.close(); } catch (e) {} rej(new Error('timeout')); } }, 9000);
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (er) { return; }
      if (m.type === 'OPEN') { opened = true; clearTimeout(to); res(ws); return; }
      if (m.type === 'ID-TAKEN') { clearTimeout(to); rej(new Error('taken')); return; }
      if (m.type === 'ERROR') { clearTimeout(to); rej(new Error((m.payload && m.payload.msg) || 'errore server')); return; }
      if (ws.onsig) ws.onsig(m);
    };
    ws.onerror = () => { if (!opened) { clearTimeout(to); rej(new Error('rete')); } };
    ws.onclose = () => { clearInterval(ws.hb); if (opened && ws.onlost) ws.onlost(); };
    ws.hb = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'HEARTBEAT' })); }, 5000);
    ws.id = id; ws.out = (type, dst, payload) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type, dst, payload })); };
  });
}
function closeSig() { if (sig) { sig.onlost = null; try { sig.close(); } catch (e) {} sig = null; } }

/* --- collegamento WebRTC --- */
function makePeer(remoteId, initiator, name) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const P = { id: remoteId, name: name || '?', pc, dc: null, open: false, pend: [], rtt: 0 };
  pc.onicecandidate = e => { if (e.candidate && sig) sig.out('CANDIDATE', remoteId, { a: 'anst', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) drop(P); };
  const wire = dc => { P.dc = dc; dc.onopen = () => { P.open = true; opened(P); }; dc.onclose = () => drop(P); dc.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (er) { return; } recv(P, m); }; };
  if (initiator) wire(pc.createDataChannel('anst', { ordered: true })); else pc.ondatachannel = e => wire(e.channel);
  S.peers.set(remoteId, P); return P;
}
async function addCand(P, c) { if (!c) return; if (!P.pc.remoteDescription) { P.pend.push(c); return; } try { await P.pc.addIceCandidate(c); } catch (e) {} }
async function flush(P) { const p = P.pend; P.pend = []; for (const c of p) try { await P.pc.addIceCandidate(c); } catch (e) {} }
function drop(P) {
  if (!S.peers.has(P.id)) return; S.peers.delete(P.id); try { P.pc.close(); } catch (e) {}
  if (S.mode === 'host') { broadcastPeers(); status(`Sessione ${S.code} · ${S.peers.size + 1} telefoni`); }
  else if (S.mode === 'guest') { status('Collegamento perso · ritento…', ''); retry(); }
}
function send(P, m) { if (P.open && P.dc && P.dc.readyState === 'open') try { P.dc.send(JSON.stringify(m)); } catch (e) {} }

/* --- HOST --- */
async function host(name) {
  leave(); myName = name || myName; S.mode = 'host'; S.off = 0; status('Creo la sessione…', '');
  for (let tries = 0; tries < 4; tries++) {
    const code = rid(4);
    try { sig = await connectSig(PFX + code); S.code = code; break; } catch (e) { if (e.message !== 'taken') { S.mode = 'solo'; status('Da solo', msgErr(e)); return false; } }
  }
  if (!sig) { S.mode = 'solo'; status('Da solo', 'Server occupato, riprova'); return false; }
  hostWire(); status(`Sessione ${S.code} · aspetto altri telefoni`); return S.code;
}
function hostWire() {
  sig.onsig = async m => {
    const pl = m.payload || {}; if (pl.a !== 'anst') return;
    if (m.type === 'OFFER') {
      let P = S.peers.get(m.src); if (P) { try { P.pc.close(); } catch (e) {} S.peers.delete(m.src); }
      P = makePeer(m.src, false, pl.name);
      await P.pc.setRemoteDescription(pl.sdp); await flush(P);
      const ans = await P.pc.createAnswer(); await P.pc.setLocalDescription(ans);
      sig.out('ANSWER', m.src, { a: 'anst', sdp: P.pc.localDescription, name: myName });
    } else if (m.type === 'CANDIDATE') { const P = S.peers.get(m.src); if (P) addCand(P, pl.c); }
  };
  sig.onlost = () => { sig = null; if (S.mode === 'host') { status(`Sessione ${S.code} · riconnetto al server…`); reHost(0); } };
}
async function reHost(n) {
  if (S.mode !== 'host') return;
  try { sig = await connectSig(PFX + S.code); hostWire(); status(`Sessione ${S.code} · ${S.peers.size + 1} telefoni`); }
  catch (e) { sig = null; if (n < 20) setTimeout(() => reHost(n + 1), 3000); else status('Server perso', 'Chi è già collegato continua a suonare; nuovi telefoni non possono entrare.'); }
}
function opened(P) {
  if (S.mode === 'host') { send(P, { t: 'hello', name: myName, code: S.code }); broadcastPeers(); status(`Sessione ${S.code} · ${S.peers.size + 1} telefoni`); onMsg({ t: 'joined', name: P.name }, P); }
  else { status(`Collegato a ${S.code}`, ''); startPing(); onMsg({ t: 'connected' }, P); }
}
function broadcastPeers() { const list = [{ name: myName + ' (capo)', host: true }, ...[...S.peers.values()].map(p => ({ name: p.name, rtt: Math.round(p.rtt) }))]; S.list = list; for (const P of S.peers.values()) send(P, { t: 'peers', list }); onStatus(S); }

/* --- OSPITE --- */
let joinCode = '', retryN = 0, retryT = null;
async function join(code, name) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.length < 4) { status(S.status, 'Codice non valido'); return false; }
  leave(); myName = name || myName; joinCode = code; S.mode = 'guest'; S.code = code; retryN = 0; return connectGuest();
}
async function connectGuest() {
  status(`Mi collego a ${joinCode}…`, '');
  try { sig = await connectSig(PFX + 'g-' + rid(8)); } catch (e) { status('Non collegato', msgErr(e)); retry(); return false; }
  const hostId = PFX + joinCode, P = makePeer(hostId, true, 'capo');
  sig.onsig = async m => {
    const pl = m.payload || {};
    if (m.type === 'EXPIRE' || m.type === 'LEAVE') { if (m.src === hostId || m.dst === hostId || !m.src) { status('Sessione non trovata', 'Controlla il codice o che il capo sia ancora aperto'); } return; }
    if (pl.a !== 'anst' || m.src !== hostId) return;
    if (m.type === 'ANSWER') { P.name = pl.name || 'capo'; S.hostName = P.name; await P.pc.setRemoteDescription(pl.sdp); await flush(P); }
    else if (m.type === 'CANDIDATE') addCand(P, pl.c);
  };
  const off = await P.pc.createOffer(); await P.pc.setLocalDescription(off);
  sig.out('OFFER', hostId, { a: 'anst', sdp: P.pc.localDescription, name: myName });
  setTimeout(() => { if (S.mode === 'guest' && !P.open) { status('Nessuna risposta dal capo', 'Codice giusto? Il telefono capo deve avere l’app aperta.'); try { P.pc.close(); } catch (e) {} S.peers.delete(hostId); retry(); } }, 15000);
  return true;
}
function retry() { if (S.mode !== 'guest' || retryN > 20) return; clearTimeout(retryT); retryT = setTimeout(() => { if (S.mode !== 'guest' || [...S.peers.values()].some(p => p.open)) return; retryN++; closeSig(); connectGuest(); }, 3000); }

/* --- orologio condiviso (stima dell'offset con il ping) --- */
function startPing() {
  clearInterval(pingT); samples = []; let n = 0;
  const ping = () => { const P = [...S.peers.values()][0]; if (P) send(P, { t: 'ping', a: performance.now() }); n++; if (n === 12) { clearInterval(pingT); pingT = setInterval(ping, 2500); } };
  ping(); pingT = setInterval(ping, 350);
}
function onPong(P, m) {
  const t1 = performance.now(), rtt = t1 - m.a, est = m.h - (m.a + t1) / 2;
  samples.push({ rtt, est }); if (samples.length > 16) samples.shift();
  const best = samples.reduce((a, b) => b.rtt < a.rtt ? b : a);
  if (samples.length < 3 || Math.abs(best.est - S.off) > 40) S.off = best.est; else S.off += (best.est - S.off) * .3;
  S.rtt = best.rtt; P.rtt = rtt; send(P, { t: 'rtt', v: Math.round(rtt) }); onStatus(S);
}
function recv(P, m) {
  if (m.t === 'ping' && S.mode === 'host') return send(P, { t: 'pong', a: m.a, h: performance.now() });
  if (m.t === 'pong') return onPong(P, m);
  if (m.t === 'rtt') { P.rtt = m.v; return; }
  if (m.t === 'peers') { S.list = m.list; onStatus(S); return; }
  if (S.mode === 'host' && m.relay) { m.from = m.from || P.name; for (const Q of S.peers.values()) if (Q !== P) send(Q, m); }
  onMsg(m, P);
}
/* invia a tutti (il capo inoltra) */
function broadcast(m) { if (S.mode === 'host') { for (const P of S.peers.values()) send(P, m); } else if (S.mode === 'guest') { const P = [...S.peers.values()][0]; if (P) send(P, Object.assign({ relay: true, from: myName }, m)); } }
function toHost(m) { const P = [...S.peers.values()][0]; if (S.mode === 'guest' && P) send(P, m); }

/* --- modalità orologio --- */
function clock() {
  leave(); S.mode = 'clock'; const upd = () => { const o = Date.now() - performance.now(); if (Math.abs(o - S.off) > 25) S.off = o; else S.off += (o - S.off) * .1; };
  S.off = Date.now() - performance.now(); wallT = setInterval(upd, 1000); status('Sincronizzato all’orologio', ''); return true;
}
function leave() {
  clearInterval(pingT); clearInterval(wallT); clearTimeout(retryT); closeSig();
  for (const P of S.peers.values()) try { P.pc.close(); } catch (e) {} S.peers.clear();
  const wasNet = S.mode !== 'solo'; S.mode = 'solo'; S.code = ''; S.list = null; S.rtt = 0;
  // torna al tempo locale senza salti bruschi: l'app riancora il trasporto
  S.off = 0; if (wasNet) status('Da solo', '');
}
function msgErr(e) { const m = e && e.message; if (m === 'timeout' || m === 'rete') return 'Server di collegamento non raggiungibile: serve internet (anche dati mobili) per creare/entrare in una sessione.'; return m || 'errore'; }

return { S, now, off: () => S.off, host, join, leave, clock, broadcast, toHost, set onMsg(f) { onMsg = f; }, set onStatus(f) { onStatus = f; }, get name() { return myName; }, set name(v) { myName = v; }, get connected() { return [...S.peers.values()].some(p => p.open); } };
})();
