'use strict';
/* Generatore QR minimale (modalità byte, correzione M, versioni 1-10). Restituisce una matrice di booleani. */
const QR = (() => {
const BLK = [null, [[1, 26, 16]], [[1, 44, 28]], [[1, 70, 44]], [[2, 50, 32]], [[2, 67, 43]], [[4, 43, 27]], [[4, 49, 31]], [[2, 60, 38], [2, 61, 39]], [[3, 58, 36], [2, 59, 37]], [[4, 69, 43], [1, 70, 44]]];
const ALN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
function rsGen(n) { let p = [1]; for (let i = 0; i < n; i++) { const q = new Array(p.length + 1).fill(0); for (let j = 0; j < p.length; j++) { q[j] ^= p[j]; q[j + 1] ^= mul(p[j], EXP[i]); } p = q; } return p; }
function rsRem(data, n) { const gen = rsGen(n), r = data.concat(new Array(n).fill(0)); for (let i = 0; i < data.length; i++) { const c = r[i]; if (c) for (let j = 0; j < gen.length; j++) r[i + j] ^= mul(gen[j], c); } return r.slice(data.length); }
const bchDig = d => { let n = 0; while (d) { n++; d >>>= 1; } return n; };
function bch(d, g, shift) { let x = d << shift; while (bchDig(x) - bchDig(g) >= 0) x ^= g << (bchDig(x) - bchDig(g)); return (d << shift) | x; }
const MASK = [(i, j) => (i + j) % 2 === 0, i => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0, (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => (i * j) % 2 + (i * j) % 3 === 0, (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0, (i, j) => ((i * j) % 3 + (i + j) % 2) % 2 === 0];

function encode(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let v = 1; for (; v <= 10; v++) { const cap = BLK[v].reduce((a, [n, , d]) => a + n * d, 0), cc = v < 10 ? 8 : 16; if (4 + cc + bytes.length * 8 <= cap * 8) break; }
  if (v > 10) throw new Error('testo troppo lungo');
  const cap = BLK[v].reduce((a, [n, , d]) => a + n * d, 0), bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let k = 0; data.length < cap; k++) data.push(k % 2 ? 0x11 : 0xEC);
  // blocchi + correzione errori, interlacciati
  const blocks = []; let off = 0; BLK[v].forEach(([n, tot, d]) => { for (let b = 0; b < n; b++) { const dd = data.slice(off, off + d); off += d; blocks.push({ d: dd, e: rsRem(dd, tot - d) }); } });
  const cw = []; const maxD = Math.max(...blocks.map(b => b.d.length)); for (let i = 0; i < maxD; i++) blocks.forEach(b => i < b.d.length && cw.push(b.d[i]));
  const ne = blocks[0].e.length; for (let i = 0; i < ne; i++) blocks.forEach(b => cw.push(b.e[i]));
  const size = 17 + 4 * v;
  const base = () => { const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const y = r + i, x = c + j; if (y < 0 || x < 0 || y >= size || x >= size) continue; m[y][x] = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6)) || (i >= 2 && i <= 4 && j >= 2 && j <= 4); } };
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    const al = ALN[v]; for (const r of al) for (const c of al) { if (m[r][c] !== null) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) m[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1; }
    for (let i = 8; i < size - 8; i++) { if (m[i][6] === null) m[i][6] = i % 2 === 0; if (m[6][i] === null) m[6][i] = i % 2 === 0; }
    return m; };
  const place = (m, mask) => {
    const fmt = bch((0 << 3) | mask, 0x537, 10) ^ 0x5412;
    for (let i = 0; i < 15; i++) { const b = ((fmt >> i) & 1) === 1;
      if (i < 6) m[i][8] = b; else if (i < 8) m[i + 1][8] = b; else m[size - 15 + i][8] = b;
      if (i < 8) m[8][size - i - 1] = b; else if (i < 9) m[8][15 - i - 1 + 1] = b; else m[8][15 - i - 1] = b; }
    m[size - 8][8] = true;
    if (v >= 7) { const vb = bch(v, 0x1F25, 12); for (let i = 0; i < 18; i++) { const b = ((vb >> i) & 1) === 1; m[Math.floor(i / 3)][i % 3 + size - 11] = b; m[i % 3 + size - 11][Math.floor(i / 3)] = b; } }
  };
  const fill = (m, mask) => {
    let inc = -1, row = size - 1, bit = 7, byte = 0; const fn = MASK[mask];
    for (let col = size - 1; col > 0; col -= 2) { if (col === 6) col--;
      for (;;) { for (let c = 0; c < 2; c++) { if (m[row][col - c] === null) { let dark = byte < cw.length && ((cw[byte] >>> bit) & 1) === 1; if (fn(row, col - c)) dark = !dark; m[row][col - c] = dark; if (--bit < 0) { byte++; bit = 7; } } }
        row += inc; if (row < 0 || row >= size) { row -= inc; inc = -inc; break; } } }
  };
  const penalty = m => { let p = 0; const n = size;
    for (let r = 0; r < n; r++) for (const dir of [0, 1]) { let run = 1; for (let c = 1; c <= n; c++) { const a = c < n ? (dir ? m[c][r] : m[r][c]) : null, b = dir ? m[c - 1][r] : m[r][c - 1]; if (a === b) run++; else { if (run >= 5) p += run - 2; run = 1; } } }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const a = m[r][c]; if (a === m[r + 1][c] && a === m[r][c + 1] && a === m[r + 1][c + 1]) p += 3; }
    let dark = 0; for (const row of m) for (const x of row) if (x) dark++; p += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10; return p; };
  let best = null, bp = Infinity;
  for (let mask = 0; mask < 8; mask++) { const m = base(); place(m, mask); fill(m, mask); const p = penalty(m); if (p < bp) { bp = p; best = m; } }
  return best;
}
function draw(canvas, text, fg = '#0b1210', bg = '#e8fff7') {
  const m = encode(text), n = m.length, q = 4, px = Math.max(2, Math.floor(Math.min(canvas.width, canvas.height) / (n + q * 2))), off = Math.floor((canvas.width - px * (n + q * 2)) / 2), c = canvas.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, canvas.width, canvas.height); c.fillStyle = fg;
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (m[r][k]) c.fillRect(off + (k + q) * px, off + (r + q) * px, px, px);
}
return { encode, draw };
})();
if (typeof module !== 'undefined') module.exports = QR;
