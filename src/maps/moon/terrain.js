// The Moon: terrain part (natural height, flats, paved test, colours, environment).
// No THREE import and no terrain.js import (terrain.js imports the map, a cycle otherwise):
// fbm/smooth for the heights come in through the `n` argument of height().
import { ZONES, AREAS, BIG_CRATERS, PADS, ROADS } from './layout.js';

export const zones = ZONES;

// ---------- flats (forced to height 0, blended into the natural height) ----------
export const flats = [
  ...PADS.map(p => ({ ...p })),
  ...ROADS.map(([ax, az, bx, bz]) => ({ type: 'seg', ax, az, bx, bz, hw: 7, paved: true, blend: 30 })),
  // loose (unpaved) graded regolith for the stunt landings and the wreck
  { type: 'rect', cx: -520, cz: 430, hw: 170, hd: 35, paved: false, blend: 40 },   // jump zone landing strip (north of the gaps)
  { type: 'rect', cx: 250, cz: 430, hw: 110, hd: 30, paved: false, blend: 40 },    // mega ramp landing apron (north)
  { type: 'circle', cx: 520, cz: 520, r: 45, paved: false, blend: 50 },             // crashed lander
];

// ---------- local noise (same algorithm as terrain.js; used by color/mapColor and as a fallback) ----------
function hash(i, j) {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function hash3(i, j, k) {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function lfbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, t = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, z * f); t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}
function sm(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// ---------- features ----------
// a few lunar hills in open ground (away from every zone and road)
const HILLS = [
  { x: 1000, z: 0, r: 220, h: 38 },
  { x: -1000, z: 100, r: 200, h: 42 },
  { x: 0, z: -900, r: 190, h: 34 },
  { x: -600, z: 950, r: 230, h: 46 },
  { x: 750, z: 950, r: 200, h: 40 },
  { x: 300, z: -1050, r: 160, h: 30 },
  { x: -1150, z: -250, r: 150, h: 28 },
].map(o => ({ ...o, r2: o.r * o.r }));

// big craters from the layout plus a few medium ones in open ground; rays only on the big two
const MEDIUM = [
  { x: 250, z: -420, r: 45, depth: 9, rim: 4 },
  { x: -300, z: -150, r: 38, depth: 8, rim: 3.5 },
  { x: -140, z: 420, r: 40, depth: 8, rim: 3.5 },
  { x: 950, z: -720, r: 50, depth: 10, rim: 4.5 },
  { x: 820, z: 280, r: 40, depth: 8, rim: 3.5 },
];
const OUT = 1.6; // rim falls off between r and OUT*r
const CRATERS = [...BIG_CRATERS, ...MEDIUM].map((c, i) => ({
  x: c.x, z: c.z, r: c.r, depth: c.depth, rim: c.rim,
  R2: (c.r * OUT) * (c.r * OUT),
  rays: c.r >= 150, rayR2: (c.r * 3) * (c.r * 3),
  k1: 7 + (i % 3) * 2, k2: 11 + (i % 2) * 2, p: 1.3 + i * 2.17,
}));

// stunt / wreck areas get calmer ground (smaller bumps) and no random small craters
const CALM = [AREAS.jump, AREAS.mega, AREAS.lander].filter(Boolean);

// small craters: hash grid, cell 60 m, at most one crater per cell, radius 10..30 m (influence < 48 m < cell)
const CELL = 60, OFF = 36, NC = 73;
let SC = null; // Float32Array NC*NC*4: cx, cz, r (0 = none), depth
function smallExcluded(cx, cz, r) {
  if (cx * cx + cz * cz > 1300 * 1300) return true;
  const infl = r * OUT;
  for (const c of CRATERS) {
    const lim = c.r * 1.75 + infl, dx = cx - c.x, dz = cz - c.z;
    if (dx * dx + dz * dz < lim * lim) return true;
  }
  for (const k in AREAS) {
    const a = AREAS[k];
    if (Math.abs(cx - a.cx) < a.hw + infl + 15 && Math.abs(cz - a.cz) < a.hd + infl + 15) return true;
  }
  return false;
}
function buildSmall() {
  const t = new Float32Array(NC * NC * 4);
  for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
    const gi = ci - OFF, gj = cj - OFF;
    if (hash3(gi, gj, 1) > 0.42) continue;
    const cx = (gi + 0.1 + 0.8 * hash3(gi, gj, 2)) * CELL, cz = (gj + 0.1 + 0.8 * hash3(gi, gj, 3)) * CELL;
    const u = hash3(gi, gj, 4), r = 10 + 20 * u * u;
    if (smallExcluded(cx, cz, r)) continue;
    const k = (cj * NC + ci) * 4;
    t[k] = cx; t[k + 1] = cz; t[k + 2] = r; t[k + 3] = r * (0.17 + 0.1 * hash3(gi, gj, 5));
  }
  SC = t;
}

// crater height at (x, z); also leaves the bowl / rim factors (0..1) in _bowl / _rim for color()
let _bowl = 0, _rim = 0;
function craterH(x, z, rimNoise) {
  let h = 0, bowl = 0, rim = 0;
  for (let i = 0; i < CRATERS.length; i++) {
    const c = CRATERS[i], dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz;
    if (d2 >= c.R2) continue;
    const t = Math.sqrt(d2) / c.r, rh = c.rim * rimNoise;
    if (t < 1) {
      const tt = t * t;
      h += -c.depth + (c.depth + rh) * tt;
      const b = 1 - tt; if (b > bowl) bowl = b;
      if (t > 0.8) { const q = (t - 0.8) * 5; if (q > rim) rim = q; }
    } else {
      const q = 1 - (t - 1) / (OUT - 1), qq = q * q;
      h += rh * qq;
      if (qq > rim) rim = qq;
    }
  }
  if (SC === null) buildSmall();
  const gi = Math.floor(x / CELL), gj = Math.floor(z / CELL);
  for (let b = -1; b <= 1; b++) {
    const cj = gj + b + OFF;
    if (cj < 0 || cj >= NC) continue;
    for (let a = -1; a <= 1; a++) {
      const ci = gi + a + OFF;
      if (ci < 0 || ci >= NC) continue;
      const k = (cj * NC + ci) * 4, r = SC[k + 2];
      if (r === 0) continue;
      const dx = x - SC[k], dz = z - SC[k + 1], d2 = dx * dx + dz * dz, R = r * OUT;
      if (d2 >= R * R) continue;
      const t = Math.sqrt(d2) / r, depth = SC[k + 3], rh = r * 0.09 * rimNoise;
      if (t < 1) {
        const tt = t * t;
        h += -depth + (depth + rh) * tt;
        const bb = (1 - tt) * 0.8; if (bb > bowl) bowl = bb;
        if (t > 0.8) { const q = (t - 0.8) * 5; if (q > rim) rim = q; }
      } else {
        const q = 1 - (t - 1) / (OUT - 1), qq = q * q;
        h += rh * qq;
        if (qq > rim) rim = qq;
      }
    }
  }
  _bowl = bowl; _rim = rim;
  return h;
}

function calmAmp(x, z) {
  let amp = 1;
  for (let i = 0; i < CALM.length; i++) {
    const a = CALM[i];
    const d = Math.max(Math.abs(x - a.cx) - a.hw, Math.abs(z - a.cz) - a.hd);
    if (d < 60) { const v = 0.3 + 0.7 * sm(-20, 60, d); if (v < amp) amp = v; }
  }
  return amp;
}

// ---------- natural height ----------
export function height(x, z, n) {
  const fbm = (n && n.fbm) || lfbm, smooth = (n && n.smooth) || sm;
  const nb = fbm(x * 0.0028 + 17.3, z * 0.0028 - 9.1, 3);
  const n2 = fbm(x * 0.017 + 3.7, z * 0.017 + 1.3, 2);
  // gentle rolling regolith (about +-3 m), calmer in the stunt areas
  let h = ((nb - 0.5) * 8 + (n2 - 0.5) * 1.4) * calmAmp(x, z);
  // lunar hills
  for (let i = 0; i < HILLS.length; i++) {
    const hl = HILLS[i], dx = x - hl.x, dz = z - hl.z, d2 = dx * dx + dz * dz;
    if (d2 >= hl.r2) continue;
    const b = smooth(hl.r, 0, Math.sqrt(d2) + (nb - 0.5) * 50);
    if (b > 0) h += b * (hl.h * (0.85 + 0.3 * nb) + (n2 - 0.5) * 8);
  }
  // craters (bowl below 0, raised rim that falls off outside)
  h += craterH(x, z, 0.8 + 0.4 * nb);
  // mountain rim so nobody drives off the map
  const r = Math.sqrt(x * x + z * z);
  if (r > 1330) {
    const mw = smooth(1330, 1800, r);
    h += mw * (110 + 180 * fbm(x * 0.0022 + 3, z * 0.0022 + 5, 5)) + mw * mw * 60;
  }
  return Number.isFinite(h) ? h : 0;
}

// ---------- paved test (per wheel ray, 240 Hz): a handful of cheap shape tests ----------
const P_CIRC = [], P_RECT = [], P_SEG = [];
for (const s of flats) {
  if (s.paved === false) continue;
  if (s.type === 'circle') P_CIRC.push({ cx: s.cx, cz: s.cz, r2: s.r * s.r });
  else if (s.type === 'rect') P_RECT.push({ cx: s.cx, cz: s.cz, hw: s.hw, hd: s.hd, c: Math.cos(s.yaw || 0), s: Math.sin(s.yaw || 0), yaw: !!s.yaw });
  else if (s.type === 'seg') {
    const bx = s.bx - s.ax, bz = s.bz - s.az, L2 = bx * bx + bz * bz;
    P_SEG.push({
      ax: s.ax, az: s.az, bx, bz, inv: L2 > 0 ? 1 / L2 : 0, hw2: s.hw * s.hw,
      x0: Math.min(s.ax, s.bx) - s.hw, x1: Math.max(s.ax, s.bx) + s.hw,
      z0: Math.min(s.az, s.bz) - s.hw, z1: Math.max(s.az, s.bz) + s.hw,
    });
  }
}
export function paved(x, z) {
  for (let i = 0; i < P_CIRC.length; i++) {
    const p = P_CIRC[i], dx = x - p.cx, dz = z - p.cz;
    if (dx * dx + dz * dz < p.r2) return true;
  }
  for (let i = 0; i < P_RECT.length; i++) {
    const p = P_RECT[i];
    let dx = x - p.cx, dz = z - p.cz;
    if (p.yaw) { const lx = p.c * dx - p.s * dz, lz = p.s * dx + p.c * dz; dx = lx; dz = lz; }
    if (Math.abs(dx) < p.hw && Math.abs(dz) < p.hd) return true;
  }
  for (let i = 0; i < P_SEG.length; i++) {
    const p = P_SEG[i];
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
    const px = x - p.ax, pz = z - p.az;
    let t = (px * p.bx + pz * p.bz) * p.inv;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const ex = px - p.bx * t, ez = pz - p.bz * t;
    if (ex * ex + ez * ez < p.hw2) return true;
  }
  return false;
}

// ---------- colours ----------
function rays(x, z, mott) {
  let ray = 0;
  for (let i = 0; i < CRATERS.length; i++) {
    const c = CRATERS[i];
    if (!c.rays) continue;
    const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz;
    if (d2 >= c.rayR2) continue;
    const t = Math.sqrt(d2) / c.r;
    if (t < 0.9) continue;
    const ang = Math.atan2(dz, dx);
    const s = Math.sin(ang * c.k1 + c.p) * 0.6 + Math.sin(ang * c.k2 + c.p * 2.3) * 0.4;
    if (s <= 0.3) continue;
    const q = (s - 0.3) / 0.7;
    const v = q * q * (1 - sm(1.05, 3, t)) * sm(0.9, 1.05, t) * (0.6 + 0.8 * mott);
    if (v > ray) ray = v;
  }
  return ray > 1 ? 1 : ray;
}

// out: THREE.Color (linear 0..1). nrm: surface normal. fm: flat mask (0 on flats .. 1 natural).
export function color(x, z, h, out, nrm, fm) {
  const ny = nrm && Number.isFinite(nrm.y) ? nrm.y : 1;
  const f = Number.isFinite(fm) ? fm : 1;
  const hh = Number.isFinite(h) ? h : 0;
  const mott = lfbm(x * 0.011 + 5.1, z * 0.011 + 8.7, 2);
  const maria = sm(0.47, 0.62, lfbm(x * 0.0009 + 40.5, z * 0.0009 - 30.2, 3));
  let v = 0.34 * (0.86 + 0.28 * mott);                    // grey regolith
  v += (0.15 * (0.9 + 0.2 * mott) - v) * maria;            // dark basalt maria
  v += (0.5 - v) * sm(5, 40, hh) * 0.7;                    // lighter highlands / hills / mountains
  v *= 1 - sm(0.12, 0.5, 1 - ny) * 0.3;                    // steep rock a bit darker
  craterH(x, z, 1);
  v *= 1 - 0.28 * _bowl;                                   // crater bowls darker
  v += (0.56 - v) * _rim * 0.55;                           // fresh rims lighter
  const ray = rays(x, z, mott);
  if (ray > 0) v += (0.6 - v) * ray * 0.5;                 // ejecta rays
  const fl = 1 - f;
  if (fl > 0) v += (0.44 * (0.97 + 0.06 * mott) - v) * fl * 0.9;  // graded flats / roads: smooth light grey
  if (!(v >= 0)) v = 0.3;
  out.r = v; out.g = v * 0.985; out.b = v * 0.965 + maria * 0.006;
  return out;
}

// minimap pixel [r, g, b] 0..255 (the system shades it and draws paved areas on top)
export function mapColor(x, z, h) {
  const hh = Number.isFinite(h) ? h : 0;
  const maria = sm(0.47, 0.62, lfbm(x * 0.0009 + 40.5, z * 0.0009 - 30.2, 3));
  let v = 150 - 58 * maria;
  v += (195 - v) * sm(5, 60, hh);
  v -= 35 * sm(-1, -20, hh);
  return [v, v * 0.99, v * 0.97];
}

export const env = { gravity: 0.165, tod: 'day', sky: { zen: [0, 0, 0], hor: [0.02, 0.02, 0.03] }, fog: { color: '#000000', density: 0.00008 }, clouds: false, earth: true, stars: true, dust: [0.55, 0.55, 0.57] };
