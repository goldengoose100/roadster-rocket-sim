// Neon City: street-level dressing across the whole grid.
// Lane paint (double yellow centre lines + dashed lane lines), zebra crosswalks + stop lines, sidewalk
// curbs (visual only), street lights on the main streets, traffic lights at a few intersections,
// neon arches over a few streets, glowing steam vents, parked cars (destructible targets) and
// freestanding neon billboards on street corners.
// Stays out of: the drag avenue, HQ plaza, yard, parking garage, tunnel street, skyway street and the
// ring street (see EX below). No teleports.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, OBB, GRIP } from '../../colliders.js';
import { heightAt } from '../../terrain.js';
import { makeSedan } from '../../world.js';
import { PITCH, STREET, CITY, RESERVED, TUNNEL, SKYWAY } from './layout.js';

const P = PITCH || 100;
const HALF = (STREET || 20) / 2;                 // 10: street half width
const N = Math.round((CITY || 700) / P);         // 7: streets k = -N..N
const LINES = [];
for (let k = -N; k <= N; k++) LINES.push(k * P);
const STREETS = [];                              // alongZ: street centred on x = c running along z
for (const c of LINES) { STREETS.push({ alongZ: true, c }); STREETS.push({ alongZ: false, c }); }

// ---------- areas other parts own (axis-aligned rects x0..x1, z0..z1) ----------
const RS = RESERVED || {};
const rectOf = (r, fb) => { const q = r && Number.isFinite(r.cx) && Number.isFinite(r.hw) ? r : fb; return { x0: q.cx - q.hw, x1: q.cx + q.hw, z0: q.cz - q.hd, z1: q.cz + q.hd }; };
const TUN = TUNNEL && Number.isFinite(TUNNEL.x) ? TUNNEL : { x: -300, z0: 120, z1: 600 };
const SKY = SKYWAY && Number.isFinite(SKYWAY.z) ? SKYWAY : { z: 400, x0: -600, x1: 600 };
const EX = [
  rectOf(RS.drag, { cx: 410, cz: -150, hw: 360, hd: 28 }),      // drag avenue x 50..770, z -178..-122
  rectOf(RS.hq, { cx: 0, cz: 0, hw: 92, hd: 92 }),              // HQ plaza
  rectOf(RS.yard, { cx: 500, cz: -500, hw: 200, hd: 200 }),     // demolition yard
  rectOf(RS.garage, { cx: 350, cz: 150, hw: 145, hd: 42 }),     // parking garage + jump targets
  { x0: TUN.x - HALF, x1: TUN.x + HALF, z0: Math.min(100, TUN.z0 - 20), z1: Math.max(620, TUN.z1 + 20) },   // tunnel street
  { x0: Math.min(-620, SKY.x0 - 20), x1: Math.max(620, SKY.x1 + 20), z0: SKY.z - HALF, z1: SKY.z + HALF },  // skyway street
  { x0: 100 - HALF, x1: 100 + HALF, z0: 380, z1: 820 },        // ring street
];
// the garage measures 0-60 here: never a collider inside (checked again in solid())
const DRAG_STRICT = { x0: 90, x1: 720, z0: -168, z1: -132 };

function hits(x0, x1, z0, z1, m = 0) {
  for (const r of EX) if (x1 > r.x0 - m && x0 < r.x1 + m && z1 > r.z0 - m && z0 < r.z1 + m) return true;
  return false;
}
const hitsC = (cx, cz, hw, hd, m = 0) => hits(cx - hw, cx + hw, cz - hd, cz + hd, m);

// A straight run along z (alongZ) or x covering p0..p1 across and a0..a1 along, minus the excluded rects.
function clipRun(alongZ, p0, p1, a0, a1, m, minLen) {
  let segs = [[a0, a1]];
  for (const r of EX) {
    const q0 = alongZ ? r.x0 : r.z0, q1 = alongZ ? r.x1 : r.z1;
    if (!(p1 > q0 - m && p0 < q1 + m)) continue;
    const c0 = (alongZ ? r.z0 : r.x0) - m, c1 = (alongZ ? r.z1 : r.x1) + m;
    const out = [];
    for (const s of segs) {
      if (s[1] <= c0 || s[0] >= c1) { out.push(s); continue; }
      if (s[0] < c0) out.push([s[0], c0]);
      if (s[1] > c1) out.push([c1, s[1]]);
    }
    segs = out;
  }
  return segs.filter(s => s[1] - s[0] >= minLen);
}
// street-local (u along, v across) -> world
const W = (st, u, v) => (st.alongZ ? [st.c + v, u] : [u, st.c + v]);
// street-local ranges -> world rect [x0, x1, z0, z1]
const rectUV = (st, u0, u1, v0, v1) => (st.alongZ ? [st.c + v0, st.c + v1, u0, u1] : [u0, u1, st.c + v0, st.c + v1]);

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gy(x, z) { try { const h = heightAt(x, z); return Number.isFinite(h) ? h : 0; } catch (_) { return 0; } }
const warn = (...a) => { try { console.warn('[neon/streets]', ...a); } catch (_) { /* no console */ } };

// ---------- quad accumulator (flat or vertical quads -> one BufferGeometry) ----------
class Quads {
  constructor(withColor = false) { this.p = []; this.n = []; this.uv = []; this.i = []; this.c = withColor ? [] : null; }
  get count() { return this.i.length / 6; }
  // horizontal rect facing up; texture v runs along x (vAlongX) or z, u across it
  rect(x0, x1, z0, z1, y, vAlongX = false, uRep = 1, vRep = 1) {
    const b = this.p.length / 3;
    const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (const [x, z] of pts) {
      const tx = (x - x0) / (x1 - x0), tz = (z - z0) / (z1 - z0);
      this.p.push(x, y, z); this.n.push(0, 1, 0);
      if (vAlongX) this.uv.push(tz * uRep, tx * vRep); else this.uv.push(tx * uRep, tz * vRep);
      if (this.c) this.c.push(1, 1, 1);
    }
    this.i.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  // vertical quad centred at (cx, cy, cz) facing the horizontal unit normal (nx, nz)
  vert(cx, cy, cz, nx, nz, w, h, u0, u1, v0, v1, cb = 1, ct = 1) {
    const b = this.p.length / 3;
    const rx = nz * w / 2, rz = -nx * w / 2, hh = h / 2;
    this.p.push(cx - rx, cy - hh, cz - rz, cx + rx, cy - hh, cz + rz, cx + rx, cy + hh, cz + rz, cx - rx, cy + hh, cz - rz);
    for (let k = 0; k < 4; k++) this.n.push(nx, 0, nz);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    if (this.c) this.c.push(cb, cb, cb, cb, cb, cb, ct, ct, ct, ct, ct, ct);
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  geometry() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

function mergeSafe(list) {
  if (!list.length) return null;
  let g = null;
  try { g = mergeGeometries(list, false); } catch (e) { g = null; }
  if (!g) warn('merge failed for', list.length, 'parts');
  for (const x of list) { try { x.dispose(); } catch (_) { /* ignore */ } }
  if (g) g.computeBoundingSphere();
  return g;
}

function canvasTex(w, h, draw, opts = {}) {
  try {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext && c.getContext('2d');
    if (!g) return null;
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = opts.repS ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.wrapT = opts.repT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.anisotropy = opts.aniso || 4;
    return t;
  } catch (e) { warn('texture failed', e); return null; }
}
const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

// billboard / arch sign atlas: 6 billboard panels 512x256 (2 x 3) + 2 wide arch panels 1024x128
const BOARD_PANELS = [
  ['NOODLES', 'open late', '#ff2bd6'],
  ['ARCADE', 'high scores nightly', '#2be8ff'],
  ['HOTEL', 'vacancy', '#b36bff'],
  ['KARAOKE', 'private rooms', '#ff5a8a'],
  ['RAMEN', 'hot · fast · cheap', '#ffb547'],
  ['OPEN 24H', 'parts · tyres · nitro', '#3dff9a'],
];
const ARCH_PANELS = [['NEON CITY', '#ff2bd6'], ['DOWNTOWN', '#2be8ff']];
const ATLAS = 1024;
function panelUV(i) {   // [u0, u1, v0, v1] (CanvasTexture flipY: v = 1 - y / H)
  if (i < 6) { const px = (i % 2) * 512, py = Math.floor(i / 2) * 256; return [px / ATLAS, (px + 512) / ATLAS, 1 - (py + 256) / ATLAS, 1 - py / ATLAS]; }
  const py = 768 + (i - 6) * 128;
  return [0, 1, 1 - (py + 128) / ATLAS, 1 - py / ATLAS];
}
function drawAtlas(g) {
  const fit = (txt, size, maxW, weight) => {
    let s = size;
    g.font = `${weight} ${s}px ${FONT}`;
    for (let k = 0; k < 8; k++) {
      const m = g.measureText && g.measureText(txt);
      const w = m && Number.isFinite(m.width) ? m.width : 0;
      if (w <= maxW) break;
      s = Math.floor(s * 0.88); g.font = `${weight} ${s}px ${FONT}`;
    }
  };
  const glowText = (txt, x, y, col) => {
    g.shadowColor = col; g.shadowBlur = 26; g.fillStyle = col; g.fillText(txt, x, y);
    g.shadowBlur = 8; g.fillText(txt, x, y);
    g.shadowBlur = 0; g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.75)'; g.strokeText(txt, x, y);
  };
  g.fillStyle = '#06030b'; g.fillRect(0, 0, ATLAS, ATLAS);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  BOARD_PANELS.forEach(([title, sub, col], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    g.save();
    g.fillStyle = '#0a0612'; g.fillRect(x + 4, y + 4, 504, 248);
    g.shadowColor = col; g.shadowBlur = 16; g.strokeStyle = col; g.lineWidth = 7; g.strokeRect(x + 16, y + 16, 480, 224);
    g.shadowBlur = 0;
    fit(title, 128, 440, 800); glowText(title, x + 256, y + 108, col);
    fit(sub, 44, 420, 600); g.fillStyle = '#e9e4ff'; g.fillText(sub, x + 256, y + 196);
    g.restore();
  });
  ARCH_PANELS.forEach(([title, col], i) => {
    const y = 768 + i * 128;
    g.save();
    g.fillStyle = '#0a0612'; g.fillRect(4, y + 4, 1016, 120);
    g.shadowColor = col; g.shadowBlur = 12; g.strokeStyle = col; g.lineWidth = 5; g.strokeRect(12, y + 12, 1000, 104);
    g.shadowBlur = 0;
    fit(title, 96, 900, 800); glowText(title, 512, y + 66, col);
    g.restore();
  });
}

// ---------- placements ----------
const MAIN_X = [-500, -200, 200, 500];           // main streets along z (street lights)
const MAIN_Z = [-400, 200];                      // main streets along x
const TRAFFIC = [[-500, -400], [-200, -400], [200, -400], [-500, 200], [-200, 200], [500, -200]];
const ARCHES = [
  { alongZ: true, c: -200, u: -570, panel: 6 },
  { alongZ: true, c: -500, u: 30, panel: 7 },
  { alongZ: false, c: -400, u: -430, panel: 7 },
  { alongZ: false, c: 200, u: -370, panel: 6 },
  { alongZ: true, c: 500, u: 330, panel: 7 },
  { alongZ: true, c: 200, u: -270, panel: 6 },
];
// [intersection x, z, corner sx, sz, panel]
const BOARDS = [[-400, -300, 1, 1, 0], [-100, -500, -1, 1, 1], [-600, 500, 1, -1, 2], [-100, 300, 1, 1, 3], [400, 300, -1, 1, 4], [600, 0, 1, 1, 5]];
const CAR_COLORS = ['#e9ecef', '#141518', '#9e0f17', '#12305e', '#8d939a', '#2b2f36', '#d8c9a0', '#ff2bd6', '#2be8ff', '#5b1a8c', '#e9ecef', '#141518'];
const MAX_CARS = 18, MAX_LIGHTS = 80;

export function build(world) {
  const scene = world && world.scene;
  if (!scene) { warn('no scene'); return; }
  const M = world.mats || {};
  const anim = Array.isArray(world.anim) ? world.anim : null;
  const steelMat = M.darkSteel || new THREE.MeshStandardMaterial({ color: '#3b4148', roughness: 0.5, metalness: 0.7 });
  const stats = { meshes: 0, colliders: 0, lights: 0, traffic: 0, arches: 0, boards: 0, vents: 0, cars: 0, paintQuads: 0, crosswalks: 0, curbs: 0 };
  const Y = new THREE.Vector3(0, 1, 0);

  // shared materials (created once per build)
  const neonMagenta = new THREE.MeshStandardMaterial({ color: '#1a0414', emissive: '#ff2bd6', emissiveIntensity: 2.4, roughness: 0.4 });
  const neonCyan = new THREE.MeshStandardMaterial({ color: '#04161a', emissive: '#2be8ff', emissiveIntensity: 2.2, roughness: 0.4 });

  // static merged lists
  const steel = [], tubeM = [], tubeC = [];
  const signQuads = new Quads();

  const add = (obj) => { if (obj) { scene.add(obj); stats.meshes++; } return obj; };
  const meshOf = (geo, mat, shadow = false) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    return add(m);
  };
  const solid = (cx, cy, cz, hx, hy, hz, yaw = 0) => {
    const e = Math.max(hx, hz) * 1.5;
    if (cx + e > DRAG_STRICT.x0 && cx - e < DRAG_STRICT.x1 && cz + e > DRAG_STRICT.z0 && cz - e < DRAG_STRICT.z1) return null;
    try {
      const c = addCollider(new OBB(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromAxisAngle(Y, yaw), new THREE.Vector3(hx, hy, hz), { surface: 'metal', grip: GRIP.metal }));
      stats.colliders++;
      return c;
    } catch (e2) { warn('collider failed', e2); return null; }
  };
  // box in world coords (yaw about its centre)
  const boxW = (list, cx, cy, cz, w, h, d, yaw = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (yaw) g.rotateY(yaw);
    g.translate(cx, cy, cz);
    list.push(g);
  };
  // box in street-local coords: sa = size across the street, sb = size along it
  const boxL = (list, st, u, v, y, sa, h, sb) => {
    const [x, z] = W(st, u, v);
    if (st.alongZ) boxW(list, x, y, z, sa, h, sb); else boxW(list, x, y, z, sb, h, sa);
    return [x, z];
  };
  const safe = (name, fn) => { try { fn(); } catch (e) { warn(name + ' failed', e); } };

  // ======================= lane markings =======================
  safe('markings', () => {
    const own = new Map();   // fallback when world.quad is missing
    const paintRect = (mat, x0, x1, z0, z1, y) => {
      if (mat && typeof world.quad === 'function') { world.quad((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, mat, y, 1); stats.paintQuads++; return; }
      const key = mat || 'paint';
      if (!own.has(key)) own.set(key, new Quads());
      own.get(key).rect(x0, x1, z0, z1, y);
    };
    const yellow = M.yellow, white = M.paint;
    const dashTex = canvasTex(4, 64, (g) => { g.clearRect(0, 0, 4, 64); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 4, 26); }, { repS: true, repT: true });
    const zebraTex = canvasTex(64, 4, (g) => { g.clearRect(0, 0, 64, 4); g.fillStyle = '#ffffff'; g.fillRect(16, 0, 32, 4); }, { repS: true, repT: true });
    const flatOpts = { color: '#e8eaee', roughness: 0.7, alphaTest: 0.45, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
    const dashMat = new THREE.MeshStandardMaterial({ ...flatOpts, map: dashTex });
    const zebraMat = new THREE.MeshStandardMaterial({ ...flatOpts, map: zebraTex });
    const dash = new Quads(), zebra = new Quads();
    const DASH = 9;   // m per dash period (3.6 m paint, 5.4 m gap)

    for (const st of STREETS) {
      for (let j = -N; j < N; j++) {
        const a0 = j * P + 17, a1 = (j + 1) * P - 17;
        // double yellow centre line
        for (const off of [-0.22, 0.22]) {
          for (const [a, b] of clipRun(st.alongZ, st.c + off - 0.07, st.c + off + 0.07, a0, a1, 1, 6)) {
            const [x0, x1, z0, z1] = rectUV(st, a, b, off - 0.07, off + 0.07);
            paintRect(yellow, x0, x1, z0, z1, 0.042);
          }
        }
        // dashed white lane lines between the two lanes of each direction
        for (const off of [-5, 5]) {
          for (const [a, b] of clipRun(st.alongZ, st.c + off - 0.08, st.c + off + 0.08, a0, a1, 1, 6)) {
            const [x0, x1, z0, z1] = rectUV(st, a, b, off - 0.08, off + 0.08);
            dash.rect(x0, x1, z0, z1, 0.04, !st.alongZ, 1, (b - a) / DASH);
          }
        }
      }
    }
    // crosswalks + stop lines on every arm of every intersection that is ours
    for (const X of LINES) for (const Z of LINES) {
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const alongZ = dx === 0;
        const st = alongZ ? { alongZ: true, c: X } : { alongZ: false, c: Z };
        const base = alongZ ? Z : X, sgn = alongZ ? dz : dx;
        if (Math.abs(base + sgn * 17) > CITY) continue;     // arm leaves the city
        const cw = rectUV(st, Math.min(base + sgn * 11, base + sgn * 15), Math.max(base + sgn * 11, base + sgn * 15), -8, 8);
        if (!hits(cw[0], cw[1], cw[2], cw[3], 0)) { zebra.rect(cw[0], cw[1], cw[2], cw[3], 0.043, !alongZ, 13, 1); stats.crosswalks++; }
        // stop line across the lanes heading into the intersection (right-hand traffic)
        const rv = alongZ ? dz : -dx;
        const sl = rectUV(st, Math.min(base + sgn * 16, base + sgn * 16.5), Math.max(base + sgn * 16, base + sgn * 16.5), Math.min(rv * 0.5, rv * 9.4), Math.max(rv * 0.5, rv * 9.4));
        if (!hits(sl[0], sl[1], sl[2], sl[3], 0.5)) paintRect(white, sl[0], sl[1], sl[2], sl[3], 0.044);
      }
    }
    meshOf(dash.geometry(), dashMat);
    meshOf(zebra.geometry(), zebraMat);
    for (const [mat, q] of own) meshOf(q.geometry(), mat === 'paint' ? new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }) : mat);
    // safety net: painted quads are merged by world.flushBatches(); if nobody flushed them by the first
    // frame, do it here so the paint never goes missing (no-op once flushed)
    if (anim) anim.push(() => {
      if (world.batches && typeof world.flushBatches === 'function') { try { world.flushBatches(); } catch (e) { world.batches = null; } }
    });
  });

  // ======================= sidewalk curbs (visual only, no colliders) =======================
  safe('curbs', () => {
    const CW = 0.3, CH = 0.16;
    const geos = [];
    const curb = (x0, x1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, CH, z1 - z0); g.translate((x0 + x1) / 2, CH / 2, (z0 + z1) / 2); geos.push(g); stats.curbs++; };
    const bw = P / 2 - HALF;   // 40: block half size
    for (let i = -CITY; i < CITY; i += P) for (let j = -CITY; j < CITY; j += P) {
      const cx = i + P / 2, cz = j + P / 2;
      const x0 = cx - bw, x1 = cx + bw, z0 = cz - bw, z1 = cz + bw;
      for (const [p0, p1] of [[x0, x0 + CW], [x1 - CW, x1]]) for (const [a, b] of clipRun(true, p0, p1, z0, z1, 0, 1.5)) curb(p0, p1, a, b);
      for (const [q0, q1] of [[z0, z0 + CW], [z1 - CW, z1]]) for (const [a, b] of clipRun(false, q0, q1, x0 + CW, x1 - CW, 0, 1.5)) curb(a, b, q0, q1);
    }
    const mat = new THREE.MeshStandardMaterial({ color: '#7d8089', roughness: 0.85 });
    meshOf(mergeSafe(geos), mat);
  });

  // ======================= street lights (instanced) + light pools =======================
  safe('street lights', () => {
    const H = 9, ARM = 3.8, OFF = HALF + 0.5;
    const spots = [];
    const mains = MAIN_X.map(c => ({ alongZ: true, c })).concat(MAIN_Z.map(c => ({ alongZ: false, c })));
    for (const st of mains) {
      for (let j = -N; j < N && spots.length < MAX_LIGHTS; j++) {
        const u = j * P + P / 2;
        const pref = (((j % 2) + 2) % 2) ? 1 : -1;
        for (const s of [pref, -pref]) {
          const [x, z] = W(st, u, s * OFF);
          if (hitsC(x, z, 1.5, 1.5, 4)) continue;
          const yaw = st.alongZ ? (s > 0 ? Math.PI : 0) : s * Math.PI / 2;   // arm (local +x) points at the street centre
          spots.push({ st, u, s, x, z, yaw });
          break;
        }
      }
    }
    if (!spots.length) return;
    const pole = new THREE.CylinderGeometry(0.13, 0.2, H, 10); pole.translate(0, H / 2, 0);
    const arm = new THREE.BoxGeometry(ARM, 0.14, 0.14); arm.translate(ARM / 2, H - 0.3, 0);
    const head = new THREE.BoxGeometry(1.3, 0.22, 0.55); head.translate(ARM, H - 0.3, 0);
    const bodyGeo = mergeSafe([pole, arm, head]);
    const lampGeo = new THREE.BoxGeometry(1.1, 0.06, 0.42); lampGeo.translate(ARM, H - 0.44, 0);
    const lampMat = new THREE.MeshStandardMaterial({ color: '#101418', emissive: '#dff6ff', emissiveIntensity: 2.6 });
    if (!bodyGeo) return;
    const bodies = new THREE.InstancedMesh(bodyGeo, steelMat, spots.length);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const pools = new Quads();
    spots.forEach((s, i) => {
      const y0 = gy(s.x, s.z);
      q.setFromAxisAngle(Y, s.yaw); p.set(s.x, y0, s.z);
      m4.compose(p, q, one);
      bodies.setMatrixAt(i, m4); lamps.setMatrixAt(i, m4);
      solid(s.x, y0 + H / 2, s.z, 0.18, H / 2, 0.18);
      // soft light pool on the wet road under the lamp, stretched along the street
      const v = s.s * (OFF - ARM);
      const r = rectUV(s.st, s.u - 7.5, s.u + 7.5, v - 2.6, v + 2.6);
      pools.rect(r[0], r[1], r[2], r[3], 0.03, !s.st.alongZ, 1, 1);
    });
    for (const im of [bodies, lamps]) { im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; }
    bodies.castShadow = true; bodies.receiveShadow = true;
    add(bodies); add(lamps);
    stats.lights = spots.length;
    const poolTex = canvasTex(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 2, 64, 64, 63);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.clearRect(0, 0, 128, 128); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
    if (poolTex) {
      const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: '#8fdcff', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
      const pm = meshOf(pools.geometry(), poolMat);
      if (pm) pm.renderOrder = 1;
    }
  });

  // ======================= traffic lights (shared animated lamp materials) =======================
  safe('traffic lights', () => {
    const lampMat = (hex) => new THREE.MeshStandardMaterial({ color: '#0b0b0b', emissive: hex, emissiveIntensity: 0.06, roughness: 0.4 });
    const L = { nsR: lampMat('#ff2a20'), nsA: lampMat('#ffb020'), nsG: lampMat('#20ff6a'), ewR: lampMat('#ff2a20'), ewA: lampMat('#ffb020'), ewG: lampMat('#20ff6a') };
    const G = { nsR: [], nsA: [], nsG: [], ewR: [], ewA: [], ewG: [] };
    const PH = 6.6, ARM = 7, AY = 6.2;
    // corner (sx, sz) and arm direction (ax, az): x-street arms carry the NS heads, z-street arms the EW heads
    const corners = [[1, 1, -1, 0], [-1, -1, 1, 0], [-1, 1, 0, -1], [1, -1, 0, 1]];
    let n = 0;
    for (const [X, Z] of TRAFFIC) {
      for (const [sx, sz, ax, az] of corners) {
        const px = X + sx * (HALF + 0.6), pz = Z + sz * (HALF + 0.6);
        const ex = px + ax * ARM, ez = pz + az * ARM;   // arm end
        if (hits(Math.min(px, ex) - 1, Math.max(px, ex) + 1, Math.min(pz, ez) - 1, Math.max(pz, ez) + 1, 2)) continue;
        const y0 = gy(px, pz);
        const pole = new THREE.CylinderGeometry(0.16, 0.2, PH, 10); pole.translate(px, y0 + PH / 2, pz); steel.push(pole);
        solid(px, y0 + PH / 2, pz, 0.2, PH / 2, 0.2);
        const acx = px + ax * ARM / 2, acz = pz + az * ARM / 2;
        boxW(steel, acx, y0 + AY, acz, ax ? ARM : 0.22, 0.22, az ? ARM : 0.22);
        solid(acx, y0 + AY, acz, ax ? ARM / 2 : 0.11, 0.11, az ? ARM / 2 : 0.11);
        // signal head hanging near the arm end, lamps poke out of both faces
        const hx = px + ax * (ARM - 0.6), hz = pz + az * (ARM - 0.6), hy = y0 + AY - 0.9;
        const ns = ax !== 0;   // arm across the x-street: faces NS traffic
        boxW(steel, hx, hy, hz, ns ? 0.55 : 0.45, 1.5, ns ? 0.45 : 0.55);
        boxW(steel, hx, y0 + AY - 0.08, hz, 0.08, 0.2, 0.08);
        const pre = ns ? 'ns' : 'ew';
        [['R', 0.45], ['A', 0], ['G', -0.45]].forEach(([c, dy]) => boxW(G[pre + c], hx, hy + dy, hz, ns ? 0.32 : 0.52, 0.32, ns ? 0.52 : 0.32));
        n++;
      }
    }
    if (!n) return;
    for (const k of Object.keys(G)) meshOf(mergeSafe(G[k]), L[k]);
    stats.traffic = n;
    const ON = 2.8, OFF = 0.06, CYC = 21;
    if (anim) anim.push((t) => {
      const c = Number.isFinite(t) ? ((t % CYC) + CYC) % CYC : 0;
      const nsG = c < 8, nsA = c >= 8 && c < 10, ewG = c >= 10.5 && c < 18.5, ewA = c >= 18.5 && c < 20.5;
      L.nsG.emissiveIntensity = nsG ? ON : OFF; L.nsA.emissiveIntensity = nsA ? ON : OFF; L.nsR.emissiveIntensity = (nsG || nsA) ? OFF : ON;
      L.ewG.emissiveIntensity = ewG ? ON : OFF; L.ewA.emissiveIntensity = ewA ? ON : OFF; L.ewR.emissiveIntensity = (ewG || ewA) ? OFF : ON;
    });
  });

  // ======================= neon arches over a few streets (8.6 m clearance) =======================
  safe('arches', () => {
    const PX = HALF + 0.6, POST_H = 9.6, BEAM_Y = 9.1, SPAN = 2 * PX + 0.9;
    for (const a of ARCHES) {
      const st = { alongZ: a.alongZ, c: a.c };
      const r = rectUV(st, a.u - 1, a.u + 1, -PX - 1, PX + 1);
      if (hits(r[0], r[1], r[2], r[3], 4) || Math.abs(a.u) > CITY - 20) continue;
      const [cx, cz] = W(st, a.u, 0);
      const y0 = gy(cx, cz);
      for (const s of [-1, 1]) {
        const [x, z] = boxL(steel, st, a.u, s * PX, y0 + POST_H / 2, 0.9, POST_H, 0.9);
        solid(x, y0 + POST_H / 2, z, 0.45, POST_H / 2, 0.45);
        boxL(tubeC, st, a.u, s * (PX - 0.52), y0 + 4.4, 0.12, 8.0, 0.12);      // neon on the inner faces
      }
      boxL(steel, st, a.u, 0, y0 + BEAM_Y, SPAN, 1.0, 0.8);
      solid(cx, y0 + BEAM_Y, cz, a.alongZ ? SPAN / 2 : 0.4, 0.5, a.alongZ ? 0.4 : SPAN / 2);
      boxL(tubeC, st, a.u, 0, y0 + BEAM_Y - 0.56, 2 * PX - 1.2, 0.12, 0.12);     // neon under the beam
      // sign board on top of the beam, text on both faces
      boxL(steel, st, a.u, 0, y0 + 10.7, 14.4, 2.1, 0.3);
      const [u0, u1, v0, v1] = panelUV(a.panel);
      for (const s of [-1, 1]) {
        const nx = a.alongZ ? 0 : s, nz = a.alongZ ? s : 0;
        signQuads.vert(cx + nx * 0.17, y0 + 10.7, cz + nz * 0.17, nx, nz, 14, 1.75, u0, u1, v0, v1);
      }
      // magenta neon arc over the gate
      const arc = new THREE.TorusGeometry(PX, 0.16, 6, 36, Math.PI);
      arc.scale(1, 0.36, 1);
      if (!a.alongZ) arc.rotateY(Math.PI / 2);
      arc.translate(cx, y0 + POST_H, cz);
      tubeM.push(arc);
      stats.arches++;
    }
  });

  // ======================= corner billboards on poles =======================
  safe('billboards', () => {
    const D = HALF + 2.8, PH = 7.2, BW = 7.4, BH = 3.8;
    BOARDS.forEach(([X, Z, sx, sz, panel], i) => {
      const px = X + sx * D, pz = Z + sz * D;
      if (hitsC(px, pz, 4, 4, 2)) return;
      const y0 = gy(px, pz);
      const yaw = Math.atan2(-sx, -sz), nx = Math.sin(yaw), nz = Math.cos(yaw);
      const pole = new THREE.CylinderGeometry(0.32, 0.38, PH, 12); pole.translate(px, y0 + PH / 2, pz); steel.push(pole);
      solid(px, y0 + PH / 2, pz, 0.36, PH / 2, 0.36);
      const by = y0 + PH + BH / 2 - 0.1;
      boxW(steel, px, by, pz, BW, BH, 0.45, yaw);
      solid(px, by, pz, BW / 2, BH / 2, 0.24, yaw);
      const front = panelUV(panel), back = panelUV((panel + 3) % 6);
      signQuads.vert(px + nx * 0.235, by, pz + nz * 0.235, nx, nz, BW - 0.4, BH - 0.4, front[0], front[1], front[2], front[3]);
      signQuads.vert(px - nx * 0.235, by, pz - nz * 0.235, -nx, -nz, BW - 0.4, BH - 0.4, back[0], back[1], back[2], back[3]);
      // neon trim along the top and bottom edges (front and back)
      const list = i % 2 ? tubeC : tubeM;
      for (const s of [-1, 1]) for (const dy of [-BH / 2 - 0.05, BH / 2 + 0.05]) boxW(list, px + s * nx * 0.26, by + dy, pz + s * nz * 0.26, BW, 0.1, 0.1, yaw);
      stats.boards++;
    });
  });

  // ======================= steam vents (glowing grates + faint scrolling steam) =======================
  safe('vents', () => {
    const rng = mulberry(91);
    const spots = [];
    let tries = 0;
    while (spots.length < 28 && tries++ < 800) {
      const st = STREETS[Math.floor(rng() * STREETS.length)];
      const j = -N + Math.floor(rng() * 2 * N);
      const u = j * P + 24 + rng() * 52;
      const v = (rng() < 0.5 ? -1 : 1) * (rng() < 0.6 ? 2.5 : 6.5);
      const [x, z] = W(st, u, v);
      if (Math.abs(x) > CITY || Math.abs(z) > CITY || hitsC(x, z, 2, 2, 3)) continue;
      if (spots.some(p => Math.abs(p.x - x) + Math.abs(p.z - z) < 60)) continue;
      spots.push({ x, z, alongZ: st.alongZ });
    }
    if (!spots.length) return;
    const grates = new Quads(), steam = new Quads(true);
    spots.forEach((s, i) => {
      const hx = s.alongZ ? 0.55 : 0.95, hz = s.alongZ ? 0.95 : 0.55;
      grates.rect(s.x - hx, s.x + hx, s.z - hz, s.z + hz, 0.05, !s.alongZ, 1, 1);
      if (i % 2 === 0) {
        const y = gy(s.x, s.z) + 3.1;
        steam.vert(s.x, y, s.z, 1, 0, 2.4, 6, 0, 1, 0, 1.3, 1, 0);
        steam.vert(s.x, y, s.z, 0, 1, 2.4, 6, 0, 1, 0.4, 1.7, 1, 0);
      }
    });
    stats.vents = spots.length;
    const grateTex = canvasTex(64, 32, (g) => {
      g.fillStyle = '#140904'; g.fillRect(0, 0, 64, 32);
      g.fillStyle = '#ffb070'; for (let k = 0; k < 7; k++) g.fillRect(5 + k * 8, 5, 4, 22);
      g.strokeStyle = '#3a2418'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 61, 29);
    });
    const grateMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: grateTex, emissive: '#ff7a2a', emissiveMap: grateTex, emissiveIntensity: grateTex ? 1.6 : 0.6, roughness: 0.6, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    meshOf(grates.geometry(), grateMat);
    const steamTex = canvasTex(64, 128, (g) => {
      g.clearRect(0, 0, 64, 128);
      const r2 = mulberry(5);
      for (let k = 0; k < 16; k++) {
        const x = 22 + r2() * 20, y = r2() * 128, rad = 9 + r2() * 12;
        for (const oy of [-128, 0, 128]) {
          const gr = g.createRadialGradient(x, y + oy, 0, x, y + oy, rad);
          gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.fillRect(x - rad, y + oy - rad, rad * 2, rad * 2);
        }
      }
    }, { repT: true });
    if (steamTex && steam.count) {
      const steamMat = new THREE.MeshBasicMaterial({ map: steamTex, color: '#d8dcff', vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const sm = meshOf(steam.geometry(), steamMat);
      if (sm) sm.renderOrder = 2;
      if (anim) anim.push((t) => { if (Number.isFinite(t)) steamTex.offset.y = -((t * 0.18) % 1); });
    }
  });

  // ======================= parked cars (destructible targets) =======================
  safe('parked cars', () => {
    if (typeof makeSedan !== 'function') return;
    const rng = mulberry(4242);
    const mainKey = new Set(MAIN_X.map(c => 'x' + c).concat(MAIN_Z.map(c => 'z' + c)));
    const cands = [];
    for (const st of STREETS) {
      if (mainKey.has((st.alongZ ? 'x' : 'z') + st.c)) continue;
      for (let j = -N; j < N; j++) for (const s of [-1, 1]) cands.push({ st, j, s });
    }
    for (let i = cands.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); const t = cands[i]; cands[i] = cands[k]; cands[k] = t; }
    const spots = [];
    for (const cd of cands) {
      if (spots.length >= MAX_CARS) break;
      const n = Math.min(MAX_CARS - spots.length, 2 + Math.floor(rng() * 2));
      const base = cd.j * P + 28 + rng() * 10;
      const row = [];
      for (let i = 0; i < n; i++) {
        const [x, z] = W(cd.st, base + i * 6.6, cd.s * (HALF - 1.4));
        if (Math.abs(x) > CITY || Math.abs(z) > CITY || hitsC(x, z, 2.6, 2.6, 4)) { row.length = 0; break; }
        const yaw = cd.st.alongZ ? (cd.s > 0 ? Math.PI : 0) : cd.s * Math.PI / 2;
        row.push({ x, z, yaw });
      }
      if (!row.length) continue;
      if (spots.some(p => Math.hypot(p.x - row[0].x, p.z - row[0].z) < 140)) continue;
      spots.push(...row);
    }
    const matCache = new Map();
    const share = (m) => {
      if (!m || !m.color) return m;
      const key = [m.type, m.color.getHexString(), m.emissive ? m.emissive.getHexString() : '', m.emissiveIntensity, m.roughness, m.metalness].join('|');
      if (!matCache.has(key)) matCache.set(key, m);
      return matCache.get(key);
    };
    const d = world.d;
    spots.forEach((s, i) => {
      let car;
      try { car = makeSedan(CAR_COLORS[i % CAR_COLORS.length]); } catch (e) { warn('makeSedan failed', e); return; }
      compactCar(car, share);
      car.position.set(s.x, gy(s.x, s.z), s.z);
      car.rotation.y = s.yaw;
      car.updateMatrixWorld(true);
      scene.add(car); stats.meshes += car.children.length;
      const half = new THREE.Vector3(0.95, 0.72, 2.45);
      if (d && typeof d.target === 'function') { d.target(car, half, 1800, 0.72); }
      else solid(s.x, car.position.y + 0.72, s.z, half.x, half.y, half.z, s.yaw);
      stats.cars++;
    });
  });

  // ======================= flush merged static meshes =======================
  safe('flush', () => {
    meshOf(mergeSafe(steel), steelMat, true);
    meshOf(mergeSafe(tubeM), neonMagenta);
    meshOf(mergeSafe(tubeC), neonCyan);
    if (signQuads.count) {
      const atlas = canvasTex(ATLAS, ATLAS, drawAtlas, { aniso: 8 });
      const signMat = new THREE.MeshBasicMaterial({ map: atlas, color: atlas ? '#ffffff' : '#ff2bd6' });
      meshOf(signQuads.geometry(), signMat);
    }
  });

  world.neonStreetsStats = stats;
  return stats;
}

// Merge a makeSedan() group into one multi-material mesh (same look, 1 object instead of 8).
// Leaves the group untouched if anything goes wrong.
function compactCar(g, share) {
  try {
    const byMat = new Map();
    for (const ch of g.children) {
      if (!ch.isMesh || Array.isArray(ch.material)) return g;
      ch.updateMatrix();
      const geo = ch.geometry.clone().applyMatrix4(ch.matrix);
      const m = share(ch.material);
      if (!byMat.has(m)) byMat.set(m, []);
      byMat.get(m).push(geo);
    }
    if (byMat.size < 1) return g;
    const mats = [], parts = [];
    for (const [m, list] of byMat) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) return g;
      mats.push(m); parts.push(merged);
    }
    const all = mergeGeometries(parts, true);
    if (!all) return g;
    for (const ch of [...g.children]) { g.remove(ch); try { ch.geometry.dispose(); } catch (_) { /* ignore */ } }
    const mesh = new THREE.Mesh(all, mats);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
  } catch (e) { warn('compactCar failed', e); }
  return g;
}
