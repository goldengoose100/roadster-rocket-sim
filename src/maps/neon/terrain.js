// Neon City terrain: a flat, wet street grid (|x|, |z| < 720) with gentle dark hills outside and a
// mountain ring for r > 1330 (like the desert) so nobody drives off the map.
// Named exports are spread into the map definition by the integrator (see src/terrain.js useMap).
// No import of src/terrain.js here (import cycle): height() gets its noise through the `n` argument.
import { PITCH, STREET } from './layout.js';
export { ZONES as zones } from './layout.js';

// city edge: blocks fill -700..700, the outer streets are centred on +-700
const EDGE = 700;

// ---------- flats (forced to height 0) ----------
// The rect covers the whole street grid including its corners (r up to ~1020); the circle rounds the
// edges off and keeps the drag avenue (x up to 770) flat.
export const flats = [
  { type: 'rect', cx: 0, cz: 0, hw: 720, hd: 720, yaw: 0, paved: true, blend: 120 },
  { type: 'circle', cx: 0, cz: 0, r: 800, paved: true, blend: 120 },
];

// ---------- local helpers (same maths as src/terrain.js, used for colour + as a fallback) ----------
function hash(i, j) {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbmL(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, t = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, z * f); t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}
const smoothL = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// sRGB hex -> linear [r, g, b] (THREE.Color stores linear values)
function lin(hex) {
  const c = parseInt(hex.slice(1), 16);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
}

// ---------- natural height (before flats) ----------
export function height(x, z, n) {
  const fbm = (n && n.fbm) || fbmL, smooth = (n && n.smooth) || smoothL;
  const ax = Math.abs(x), az = Math.abs(z);
  // distance outside the city square; the hills fade in from the city edge so the city itself is
  // flat even before the flats are applied
  const qx = ax - EDGE, qz = az - EDGE;
  const d = qx > 0 ? (qz > 0 ? Math.hypot(qx, qz) : qx) : (qz > 0 ? qz : 0);
  if (d <= 0) return 0;
  const r = Math.hypot(x, z);
  let h = (fbm(x * 0.0032 + 11, z * 0.0032 - 7) - 0.5) * 10 + (fbm(x * 0.018, z * 0.018, 3) - 0.5) * 1.4;
  const hw = smooth(850, 1300, r);
  if (hw > 0) h += hw * fbm(x * 0.0045 - 4, z * 0.0045 + 9, 4) * 36;
  h *= smooth(0, 140, d);
  // mountain ring (same as the desert)
  const mw = smooth(1330, 1800, r);
  if (mw > 0) h += mw * (110 + 180 * fbm(x * 0.0022 + 3, z * 0.0022 + 5, 5)) + mw * mw * 60;
  return Number.isFinite(h) ? h : 0;
}

// ---------- grip: asphalt everywhere in the city (called per wheel ray, keep it trivial) ----------
export function paved(x, z) {
  return (x < 725 && x > -725 && z < 725 && z > -725) || x * x + z * z < 688900;   // 830^2
}

// ---------- vertex colour ----------
const C = {
  street: lin('#2c3039'), puddle: lin('#1f2430'), inter: lin('#383c47'),
  walk: lin('#56585e'), block: lin('#45474d'), gravel: lin('#4a433a'),
  lot: lin('#36363a'), grass: lin('#26331f'), grassDark: lin('#1b2516'), dirt: lin('#3a3329'),
  rock: lin('#3e3b3c'), rockDark: lin('#29272a'),
};
const HALF_ST = STREET / 2, WALK = HALF_ST + 5, FW = 8;   // sidewalks 5 m; FW = vertex spacing (box filter width)
// distance from v to the nearest street centre line (0..PITCH/2)
const dStreet = (v) => { const m = ((v % PITCH) + PITCH) % PITCH; return m > PITCH / 2 ? PITCH - m : m; };
// how much of [d - FW/2, d + FW/2] lies inside [a, b] (0..1)
const cover = (d, a, b) => { const o = Math.min(d + FW / 2, b) - Math.max(d - FW / 2, a); return o > 0 ? o / FW : 0; };

const inDrag = (x, z) => x > 40 && x < 775 && z > -182 && z < -118;
const inYard = (x, z) => x > 300 && x < 700 && z > -700 && z < -300;

let R = 0, G = 0, B = 0;   // scratch result of cityRGB / wildRGB
function cityRGB(x, z) {
  const dx = dStreet(x), dz = dStreet(z);
  const sx = clamp01((HALF_ST + FW / 2 - dx) / FW), sz = clamp01((HALF_ST + FW / 2 - dz) / FW);
  let st = sx > sz ? sx : sz;
  if (inDrag(x, z)) { const sd = clamp01((28 + FW / 2 - Math.abs(z + 150)) / FW); if (sd > st) st = sd; }   // drag avenue: 56 m of asphalt
  let wk = Math.max(cover(dx, HALF_ST, WALK) * (1 - sz), cover(dz, HALF_ST, WALK) * (1 - sx)) * 1.4;
  if (wk > 1 - st) wk = 1 - st;
  const bl = 1 - st - wk;
  // wet asphalt: slight variation + darker bluish puddles; intersections a bit lighter (worn paint)
  const p = vnoise(x * 0.035 + 3.1, z * 0.035 - 7.7), v = 0.92 + 0.16 * vnoise(x * 0.11, z * 0.11 + 40);
  const pw = p > 0.58 ? Math.min(1, (p - 0.58) * 4) : 0, iw = sx * sz * 0.55;
  const sr = (C.street[0] + (C.puddle[0] - C.street[0]) * pw + (C.inter[0] - C.street[0]) * iw) * v;
  const sg = (C.street[1] + (C.puddle[1] - C.street[1]) * pw + (C.inter[1] - C.street[1]) * iw) * v;
  const sb = (C.street[2] + (C.puddle[2] - C.street[2]) * pw + (C.inter[2] - C.street[2]) * iw) * v;
  // each block a slightly different shade of concrete
  const bv = 0.86 + 0.24 * hash(Math.floor(x / PITCH) + 31, Math.floor(z / PITCH) - 17);
  R = sr * st + C.walk[0] * wk * v + C.block[0] * bl * bv;
  G = sg * st + C.walk[1] * wk * v + C.block[1] * bl * bv;
  B = sb * st + C.walk[2] * wk * v + C.block[2] * bl * bv;
  if (inYard(x, z)) {   // demolition yard: dusty gravel lot, streets barely showing through
    const gv = 0.8 + 0.4 * vnoise(x * 0.07 - 9, z * 0.07 + 2), t = 0.75;
    R += (C.gravel[0] * gv - R) * t; G += (C.gravel[1] * gv - G) * t; B += (C.gravel[2] * gv - B) * t;
  }
}
function wildRGB(x, z, h, ny, fm) {
  const n1 = vnoise(x * 0.012, z * 0.012), n2 = vnoise(x * 0.06 + 50, z * 0.06);
  let r = C.grass[0] + (C.grassDark[0] - C.grass[0]) * n1;
  let g = C.grass[1] + (C.grassDark[1] - C.grass[1]) * n1;
  let b = C.grass[2] + (C.grassDark[2] - C.grass[2]) * n1;
  const dw = n2 > 0.55 ? Math.min(1, (n2 - 0.55) * 1.6) : 0;
  r += (C.dirt[0] - r) * dw; g += (C.dirt[1] - g) * dw; b += (C.dirt[2] - b) * dw;
  if (fm < 1) { const t = (1 - fm) * 0.75; r += (C.lot[0] - r) * t; g += (C.lot[1] - g) * t; b += (C.lot[2] - b) * t; }
  let rk = smoothL(0.18, 0.45, 1 - ny) + (h > 35 ? smoothL(35, 120, h) * 0.7 : 0);
  if (rk > 0) {
    if (rk > 1) rk = 1;
    const kr = C.rock[0] + (C.rockDark[0] - C.rock[0]) * n2 * 0.6;
    const kg = C.rock[1] + (C.rockDark[1] - C.rock[1]) * n2 * 0.6;
    const kb = C.rock[2] + (C.rockDark[2] - C.rock[2]) * n2 * 0.6;
    r += (kr - r) * rk; g += (kg - g) * rk; b += (kb - b) * rk;
  }
  R = r; G = g; B = b;
}

export function color(x, z, h, out, nrm, fm) {
  // tolerate (x, z, h, nrm, out) argument order too
  if (out && out.r === undefined && nrm && nrm.r !== undefined) { const t = out; out = nrm; nrm = t; }
  let ny = 1;
  if (nrm && Number.isFinite(nrm.y)) { const l = nrm.x * nrm.x + nrm.y * nrm.y + nrm.z * nrm.z; if (l > 0.25) ny = nrm.y / Math.sqrt(l); }
  if (!Number.isFinite(fm)) fm = paved(x, z) ? 0 : 1;
  if (!Number.isFinite(h)) h = 0;
  const e = Math.max(Math.abs(x), Math.abs(z));
  const w = clamp01((EDGE + 18 - e) / FW);   // 1 inside the street grid, fades to 0 just past the outer sidewalk
  let r, g, b;
  if (w >= 1) { cityRGB(x, z); r = R; g = G; b = B; }
  else {
    wildRGB(x, z, h, ny, fm); r = R; g = G; b = B;
    if (w > 0) { cityRGB(x, z); r += (R - r) * w; g += (G - g) * w; b += (B - b) * w; }
    else if (x > EDGE && inDrag(x, z) && Math.abs(z + 150) < 28) { cityRGB(x, z); r = R; g = G; b = B; }   // drag avenue past the grid
  }
  if (out) {
    out.r = Number.isFinite(r) ? r : 0.03;
    out.g = Number.isFinite(g) ? g : 0.03;
    out.b = Number.isFinite(b) ? b : 0.035;
  }
  return out;
}

// ---------- minimap pixel (0..255; the caller multiplies by a slope shade ~0.75 on flat ground) ----------
export function mapColor(x, z, h) {
  if (!Number.isFinite(h)) h = 0;
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax < EDGE + 12 && az < EDGE + 12) {
    if (inYard(x, z)) return [118, 100, 82];
    const st = dStreet(x) < HALF_ST || dStreet(z) < HALF_ST || (inDrag(x, z) && Math.abs(z + 150) < 28);
    return st ? [52, 54, 66] : [112, 114, 124];
  }
  if (inDrag(x, z) && Math.abs(z + 150) < 28) return [52, 54, 66];
  if (x * x + z * z < 640000) return [80, 80, 84];   // flat lot around the city (r < 800)
  const t = h > 15 ? Math.min(1, (h - 15) / 120) : 0;   // hills -> rock on the mountains
  return [Math.round(58 + 50 * t), Math.round(76 + 26 * t), Math.round(60 + 46 * t)];
}

// ---------- environment suggestions ----------
export const env = { gravity: 1, tod: 'night', sky: { zen: [0.01, 0.01, 0.04], hor: [0.12, 0.04, 0.18] }, fog: { color: '#1a0f2a', density: 0.0009 }, clouds: false, earth: false, stars: true, dust: [0.25, 0.25, 0.3], wet: true };
