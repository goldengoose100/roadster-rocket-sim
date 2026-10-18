// The Moon: Crater Canyon (ring course + rim landing pads), the Crashed Lander, Big Crater rim markers
// and launch ramp, plus map-wide decoration (boulders, road marker flags, an abandoned rover) that stays
// outside every other part's area, every flat pad and every road.
// Everything is placed from heightAt(), so it follows whatever the moon terrain turns out to be.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, OBB, GRIP } from '../../colliders.js';
import { heightAt } from '../../terrain.js';
import { ZONES, KEYS, AREAS, PADS, ROADS, BIG_CRATERS } from './layout.js';

const ROAD_HW = 8;      // assumed half width of the graded roads
const MARGIN = 15;      // keep scattered decoration this far from other areas, pads and roads
const MAP_R = 1400;     // scatter radius
const MAX_ROCK_OBBS = 40;

// ---------- small helpers ----------
function keyOf(zone, fallback) { for (const k in KEYS) if (KEYS[k] === zone) return Number(k); return fallback; }
function zoneName(zone, fallback) { return (ZONES[zone] && ZONES[zone].name) || fallback; }
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function segDist(x, z, ax, az, bx, bz) {
  const px = x - ax, pz = z - az, dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const h = l2 > 0 ? Math.min(1, Math.max(0, (px * dx + pz * dz) / l2)) : 0;
  return Math.hypot(px - dx * h, pz - dz * h);
}
function roadDist(x, z) { let d = Infinity; for (const r of ROADS) d = Math.min(d, segDist(x, z, r[0], r[1], r[2], r[3])); return d; }
function inRect(x, z, a, m) { return Math.abs(x - a.cx) < a.hw + m && Math.abs(z - a.cz) < a.hd + m; }
function inPads(x, z, m) {
  for (const p of PADS) {
    if (p.type === 'circle') { if (Math.hypot(x - p.cx, z - p.cz) < p.r + m) return true; }
    else if (Math.abs(x - p.cx) < p.hw + m && Math.abs(z - p.cz) < p.hd + m) return true;
  }
  return false;
}
// clear of every area (except the ones in `allow`), every flat pad and every road, by margin m
function clearOf(x, z, m, allow) {
  for (const k in AREAS) { if (allow && allow.includes(k)) continue; if (inRect(x, z, AREAS[k], m)) return false; }
  if (inPads(x, z, m)) return false;
  if (roadDist(x, z) < ROAD_HW + m) return false;
  return true;
}
// height spread around a point (0 = perfectly flat)
function flatness(x, z, r) {
  const h0 = heightAt(x, z); let mn = h0, mx = h0;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const h = heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (h < mn) mn = h; if (h > mx) mx = h;
  }
  return mx - mn;
}
function groundRange(x, z, hw, hd) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    const h = heightAt(x - hw + 2 * hw * i / 6, z - hd + 2 * hd * j / 6);
    if (h < mn) mn = h; if (h > mx) mx = h;
  }
  return { min: mn, max: mx };
}
function groundMax(x, z, r) { return groundRange(x, z, r, r).max; }
function pickFlat(cands, r, tol) {
  let best = cands[0], bf = Infinity;
  for (const c of cands) {
    const f = flatness(c[0], c[1], r);
    if (f < tol) return c;
    if (f < bf) { bf = f; best = c; }
  }
  return best;
}
function nearestCrater(x, z) {
  let best = null, bd = Infinity;
  for (const c of BIG_CRATERS || []) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } }
  return best && bd < 60 ? best : null;
}
// radius of the rim crest (highest point) along angle a from (cx, cz)
function crestRadius(cx, cz, a, r0, r1, fallback) {
  const c = Math.cos(a), s = Math.sin(a);
  let best = fallback, bh = -Infinity, lo = Infinity;
  for (let r = r0; r <= r1; r += 3) {
    const h = heightAt(cx + c * r, cz + s * r);
    if (h > bh) { bh = h; best = r; }
    if (h < lo) lo = h;
  }
  return bh - lo < 1.5 ? fallback : best;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function mat4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}
// merge geometries safely (mixed indexed / non-indexed, missing uv)
function mergeParts(parts) {
  if (!parts.length) return null;
  const anyNonIndexed = parts.some(g => !g.index);
  const list = parts.map(g => {
    const h = anyNonIndexed && g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(h.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') h.deleteAttribute(name);
    if (!h.attributes.normal) h.computeVertexNormals();
    if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    return h;
  });
  return mergeGeometries(list, false);
}
// collects geometry per material, then makes one mesh per material
class Parts {
  constructor() { this.map = new Map(); }
  add(mat, geo, matrix) { if (matrix) geo.applyMatrix4(matrix); if (!this.map.has(mat)) this.map.set(mat, []); this.map.get(mat).push(geo); return geo; }
  strut(mat, a, b, r, seg = 8) {
    const len = a.distanceTo(b);
    if (len < 1e-3) return;
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    this.add(mat, g);
  }
  build(parent, shadow = true) {
    const out = [];
    for (const [mat, geos] of this.map) {
      const g = mergeParts(geos);
      if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadow; m.receiveShadow = true;
      parent.add(m); out.push(m);
    }
    this.map.clear();
    return out;
  }
}
// ground-hugging ribbon: path [{x, z, w}], profile [[offset, dy, colourIndex]]
function drapeGeo(path, prof, colors) {
  const n = path.length, k = prof.length;
  const pos = new Float32Array(n * k * 3), col = new Float32Array(n * k * 3);
  for (let i = 0; i < n; i++) {
    const p = path[i], q0 = path[Math.max(0, i - 1)], q1 = path[Math.min(n - 1, i + 1)];
    let tx = q1.x - q0.x, tz = q1.z - q0.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = tz, nz = -tx, s = p.w ?? 1;
    for (let j = 0; j < k; j++) {
      const [off, dy, ci] = prof[j];
      const x = p.x + nx * off * s, z = p.z + nz * off * s;
      const o = (i * k + j) * 3;
      pos[o] = x; pos[o + 1] = heightAt(x, z) + 0.07 + dy * s; pos[o + 2] = z;
      const c = colors[ci] || colors[0];
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < k - 1; j++) { const a = i * k + j, b = a + k; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function sign(world, x, z, yaw, lines, opts) { if (typeof world.sign === 'function') world.sign(x, z, yaw, lines, opts); }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texFrom(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function labelTex(text) {
  const c = canvas(256, 128), g = c.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 110px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.fillText(text, 128, 64);
  return texFrom(c, false);
}
function foilTex() {
  const c = canvas(256, 256), g = c.getContext('2d');
  const rng = mulberry(91);
  g.fillStyle = '#c99a32'; g.fillRect(0, 0, 256, 256);
  const tones = ['#e8c25a', '#a87a22', '#f4d77a', '#8c641c', '#d8ac40'];
  for (let i = 0; i < 220; i++) {
    g.globalAlpha = 0.25 + rng() * 0.35;
    g.fillStyle = tones[(rng() * tones.length) | 0];
    const x = rng() * 256, y = rng() * 256, s = 8 + rng() * 26;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * (rng() - 0.3), y + s * rng()); g.lineTo(x - s * rng(), y + s * (rng() - 0.2)); g.closePath(); g.fill();
  }
  g.globalAlpha = 0.35; g.strokeStyle = '#5e4210'; g.lineWidth = 1;
  for (let i = 0; i < 26; i++) { g.beginPath(); const x = rng() * 256, y = rng() * 256; g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 90, y + (rng() - 0.5) * 90); g.stroke(); }
  g.globalAlpha = 1;
  return texFrom(c, true);
}
function padTex() {
  const c = canvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#3b3e43'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#f2c230'; g.lineWidth = 10; g.strokeRect(8, 8, 240, 240);
  g.strokeStyle = '#eef0f2'; g.lineWidth = 9; g.beginPath(); g.arc(128, 128, 88, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#eef0f2'; g.fillRect(84, 78, 20, 100); g.fillRect(152, 78, 20, 100); g.fillRect(84, 118, 88, 20);
  return texFrom(c, false);
}

// ---------- build ----------
export function build(world) {
  const M = world.mats || {};
  // shared materials (made once per map load)
  const R = {
    gold: new THREE.MeshStandardMaterial({ map: foilTex(), color: '#ffffff', metalness: 0.8, roughness: 0.36 }),
    silver: new THREE.MeshStandardMaterial({ color: '#c3c7cc', metalness: 0.55, roughness: 0.45 }),
    dark: M.darkSteel || new THREE.MeshStandardMaterial({ color: '#3b4148', roughness: 0.5, metalness: 0.7 }),
    black: new THREE.MeshStandardMaterial({ color: '#0d1014', metalness: 0.9, roughness: 0.15 }),
    bell: new THREE.MeshStandardMaterial({ color: '#43484f', metalness: 0.75, roughness: 0.4, side: THREE.DoubleSide }),
    plinth: new THREE.MeshStandardMaterial({ color: '#a7a6a0', roughness: 0.92 }),
    padTop: new THREE.MeshStandardMaterial({ map: padTex(), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    rock: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0, flatShading: true }),
    debris: new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.6, roughness: 0.45 }),
    ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }),
    blinkCyan: new THREE.MeshStandardMaterial({ color: '#0a1a20', emissive: '#7fe3ff', emissiveIntensity: 2.2 }),
    blinkRed: new THREE.MeshStandardMaterial({ color: '#200505', emissive: '#ff3b2f', emissiveIntensity: 2.4 }),
    amber: new THREE.MeshStandardMaterial({ color: '#201405', emissive: '#ffb547', emissiveIntensity: 2.0 }),
    flag: new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.7, side: THREE.DoubleSide }),
    ramp: M.ramp || new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.45, metalness: 0.6 }),
    stripe: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    // beacons collected by every section, instanced at the end: [x, groundY, z, poleHeight]
    beacons: { cyan: [], red: [], amber: [] },
    flags: [],         // [x, y, z, yaw]
    keepOut: [],       // [x, z, r] spots the boulders must avoid
  };
  const run = (name, fn) => { try { fn(); } catch (e) { console.warn(`moon scenery: ${name} failed`, e); } };
  run('canyon', () => buildCanyon(world, R));
  run('lander', () => buildLander(world, R));
  run('crater', () => buildBigCrater(world, R));
  run('rover', () => buildRover(world, R));
  run('road markers', () => buildRoadMarkers(world, R));
  run('boulders', () => buildBoulders(world, R));
  run('beacons', () => buildBeacons(world, R));
  // blinking lights (shared materials, no allocations)
  const cyan = R.blinkCyan, red = R.blinkRed;
  if (Array.isArray(world.anim)) world.anim.push((t) => {
    cyan.emissiveIntensity = (t % 1.4) < 0.55 ? 2.6 : 0.35;
    red.emissiveIntensity = ((t + 0.5) % 1.0) < 0.4 ? 2.8 : 0.3;
  });
}

// ---------- Crater Canyon: ring course over and through the bowl, landing pads on the rim ----------
function buildCanyon(world, R) {
  const A = AREAS.canyon, cx = A.cx, cz = A.cz;
  const bowl = nearestCrater(cx, cz);
  const BR = bowl ? bowl.r : 260;
  const S = BR / 260;
  const crest = (a) => crestRadius(cx, cz, a, BR * 0.8, BR * 1.25, BR);
  // teleport: flat ground on the east rim, facing the bowl
  const cands = [];
  for (const da of [0, 0.06, -0.06, 0.12, -0.12, 0.2, -0.2]) {
    const rc = crest(da);
    for (const dr of [0, 5, -5, 10, 18, 28, 40, 55]) {
      const x = cx + Math.cos(da) * (rc + dr), z = cz + Math.sin(da) * (rc + dr);
      if (inRect(x, z, A, -8)) cands.push([x, z]);
    }
  }
  if (!cands.length) cands.push([cx + BR * 0.9, cz]);
  const tp = pickFlat(cands, 3, 0.6);
  const tpYaw = Math.atan2(cx - tp[0], cz - tp[1]);
  world.teleports.push({ key: keyOf('canyon', 5), name: zoneName('canyon', 'Crater Canyon'), x: tp[0], z: tp[1], yaw: tpYaw });
  R.keepOut.push([tp[0], tp[1], 40]);

  // ring course (same ring objects and visuals as the desert's Flight Canyon)
  const course = [
    [190, 0, 20], [120, 110, 32], [0, 170, 18], [-130, 130, 45], [-200, 0, 24],
    [-120, -120, 15], [0, -60, 30], [80, 60, 55], [120, -150, 38], [40, -250, 22],
  ];
  const pts = course.map(([dx, dz, off]) => {
    const x = cx + dx * S, z = cz + dz * S;
    const y = Math.max(heightAt(x, z) + off, groundMax(x, z, 9) + 10);
    return [x, y, z];
  });
  const ringGeo = new THREE.TorusGeometry(7, 0.55, 12, 48);
  const numGeo = new THREE.PlaneGeometry(4, 2);
  const start = new THREE.Vector3(tp[0], heightAt(tp[0], tp[1]) + 2, tp[1]);
  pts.forEach((p, i) => {
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    const prev = i > 0 ? new THREE.Vector3(...pts[i - 1]) : start.clone();
    const next = i < pts.length - 1 ? new THREE.Vector3(...pts[i + 1]) : pos.clone().add(pos.clone().sub(prev));
    const dir = next.clone().sub(prev); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const mat = new THREE.MeshStandardMaterial({ color: '#06151a', emissive: '#7fe3ff', emissiveIntensity: 0.6, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    world.scene.add(m);
    const num = new THREE.Mesh(numGeo, new THREE.MeshBasicMaterial({ map: labelTex(String(i + 1)), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    num.position.set(0, 9, 0); m.add(num);
    world.rings.push({ pos, normal: dir, r: 7, mesh: m, mat, index: i });
  });

  // landing pads on the rim: three plain box pads + one air pad (south rim, next to the last ring)
  const pads = [
    { a: Math.PI / 2, name: 'Canyon North Rim' },
    { a: Math.PI, name: 'Canyon West Rim' },
    { a: Math.PI * 1.25, name: 'Canyon South-West Rim' },
    { a: Math.PI * 1.5, name: 'Canyon South Rim', air: true },
  ];
  for (const pd of pads) {
    const hw = pd.air ? 12 : 9;
    let r = crest(pd.a);
    let x = cx + Math.cos(pd.a) * r, z = cz + Math.sin(pd.a) * r;
    for (let k = 0; k < 30 && !inRect(x, z, A, -(hw + 3)); k++) { r -= 4; x = cx + Math.cos(pd.a) * r; z = cz + Math.sin(pd.a) * r; }
    const gr = groundRange(x, z, hw, hw);
    const top = gr.max + 0.35, bottom = gr.min - 0.6;
    world.box(x, bottom, z, hw * 2, top - bottom, hw * 2, R.plinth, { surface: 'concrete', grip: GRIP.concrete });
    if (pd.air && typeof world.airPad === 'function') {
      // air pad on top of the plinth: build it, then lift what it added onto the plinth top
      const before = world.scene.children.length, nPads = world.refuelPads.length;
      world.airPad(x, z, 10, pd.name);
      const lift = top - heightAt(x, z);
      for (let i = before; i < world.scene.children.length; i++) world.scene.children[i].position.y += lift;
      for (let i = nPads; i < world.refuelPads.length; i++) world.refuelPads[i].y += lift;
    } else {
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 0.6, hw * 2 - 0.6), R.padTop);
      deck.rotation.x = -Math.PI / 2; deck.position.set(x, top + 0.02, z); deck.receiveShadow = true;
      world.scene.add(deck);
      if (pd.air) world.refuelPads.push({ x, y: top, z, r: 10, name: pd.name });
    }
    if (Array.isArray(world.landingPads)) world.landingPads.push({ x, z, y: top, name: pd.name });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) R.beacons.cyan.push([x + sx * (hw - 0.8), top, z + sz * (hw - 0.8), 1.4]);
    R.keepOut.push([x, z, hw * 1.5 + 15]);
  }

  // sign ahead and to the right of the teleport, facing it
  const fx = Math.sin(tpYaw), fz = Math.cos(tpYaw), lx = Math.cos(tpYaw), lz = -Math.sin(tpYaw);
  const sx = tp[0] + fx * 12 + lx * 16, sz = tp[1] + fz * 12 + lz * 16;
  sign(world, sx, sz, Math.atan2(tp[0] - sx, tp[1] - sz), ['CRATER CANYON', `rings 1-${pts.length} · the south rim pad refills air`], { w: 16, h: 4 });
  R.keepOut.push([sx, sz, 20]);
}

// ---------- Crashed Lander: wreck on its side, skid trench, debris ----------
function buildLander(world, R) {
  const A = AREAS.lander, cx = A.cx, cz = A.cz;
  const scene = world.scene;
  // teleport ≈ (430, 440), facing the wreck
  const cands = [[430, 440], [426, 434], [436, 446], [440, 432], [422, 448], [446, 452], [432, 456], [414, 430], [450, 440]]
    .filter(([x, z]) => inRect(x, z, A, -4));
  const tp = pickFlat(cands.length ? cands : [[cx - 90, cz - 80]], 3, 0.6);
  const tpYaw = Math.atan2(cx - tp[0], cz - tp[1]);
  world.teleports.push({ key: keyOf('lander', 6), name: zoneName('lander', 'Crashed Lander'), x: tp[0], z: tp[1], yaw: tpYaw });

  const view = new THREE.Vector2(cx - tp[0], cz - tp[1]).normalize();          // teleport -> wreck
  const td = new THREE.Vector2(-view.y, view.x);                               // wreck's top points sideways
  const slide = new THREE.Vector2(1, 0.35).normalize();                         // trench runs back this way
  const sp = new THREE.Vector2(-slide.y, slide.x);                              // across the trench
  const trenchLen = Math.min(105, Math.max(30, (A.cx + A.hw - 12 - cx) / Math.max(0.2, slide.x)));

  // --- the lander (built upright in local space, then laid on its side) ---
  const parts = new Parts();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // descent stage: gold octagon with a dark deck and black foil panels
  parts.add(R.gold, new THREE.CylinderGeometry(4.6, 4.6, 4.2, 8), mat4(0, 0, 0, 0, Math.PI / 8));
  parts.add(R.dark, new THREE.CylinderGeometry(4.75, 4.75, 0.3, 8), mat4(0, 2.25, 0, 0, Math.PI / 8));
  parts.add(R.dark, new THREE.CylinderGeometry(4.75, 4.75, 0.3, 8), mat4(0, -2.25, 0, 0, Math.PI / 8));
  for (const a of [0, Math.PI * 0.75, Math.PI * 1.25]) parts.add(R.black, new THREE.BoxGeometry(2.6, 2.6, 0.08), mat4(Math.sin(a) * 4.27, 0.2, Math.cos(a) * 4.27, 0, a));
  // torn thruster mount under the body (the bell itself broke off)
  parts.add(R.bell, new THREE.CylinderGeometry(0.9, 1.15, 0.9, 16, 1, true), mat4(0, -2.85, 0));
  // ascent stage: silver hex cabin, windows, hatch, docking tunnel, antenna, thruster quads
  parts.add(R.silver, new THREE.CylinderGeometry(3.0, 3.1, 3.4, 6), mat4(0, 4.1, 0, 0, Math.PI / 6));
  parts.add(R.dark, new THREE.CylinderGeometry(3.12, 3.12, 0.35, 6), mat4(0, 3.1, 0, 0, Math.PI / 6));
  parts.add(R.gold, new THREE.BoxGeometry(2.2, 1.6, 1.6), mat4(-2.9, 4.4, -0.6));
  for (const s of [-1, 1]) parts.add(R.black, new THREE.BoxGeometry(0.9, 0.7, 0.12), mat4(s * 0.7, 4.9, 2.62, -0.25));
  parts.add(R.dark, new THREE.BoxGeometry(1.1, 1.1, 0.12), mat4(0, 3.6, 2.62));
  parts.add(R.silver, new THREE.CylinderGeometry(0.9, 0.9, 1.1, 16), mat4(0, 6.35, 0));
  parts.strut(R.dark, V(1.6, 5.7, -1.2), V(2.5, 7.4, -1.9), 0.08, 6);
  parts.add(R.silver, new THREE.SphereGeometry(0.85, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), mat4(2.5, 7.4, -1.9, 0.5, 0, -0.4));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    parts.add(R.dark, new THREE.BoxGeometry(0.5, 0.5, 0.5), mat4(Math.sin(a) * 3.3, 5.4, Math.cos(a) * 3.3, 0, a));
  }
  // legs: two intact (local +x side ends up in the air), one crushed stub; the fourth lies in the debris field
  for (const [a, kind] of [[Math.PI * 0.25, 'full'], [Math.PI * 0.75, 'full'], [Math.PI * 1.25, 'stub']]) {
    const c = Math.sin(a), s = Math.cos(a);
    const top = V(c * 4.3, -0.6, s * 4.3), foot = kind === 'full' ? V(c * 8.2, -3.6, s * 8.2) : V(c * 5.6, -1.7, s * 5.6);
    parts.strut(R.dark, top, foot, 0.2);
    parts.strut(R.silver, V(c * 4.3, 1.5, s * 4.3), kind === 'full' ? V(c * 7.0, -2.6, s * 7.0) : V(c * 5.0, 0.2, s * 5.0), 0.12);
    if (kind === 'full') parts.add(R.dark, new THREE.CylinderGeometry(1.0, 1.15, 0.3, 12), mat4(foot.x, foot.y - 0.2, foot.z));
  }
  const wreck = new THREE.Group();
  const meshes = parts.build(wreck);
  const tilt = 1.38, yawL = Math.atan2(td.y, -td.x);
  wreck.rotation.set(0, yawL, tilt);
  wreck.updateMatrixWorld(true);
  let minY = Infinity;
  for (const m of meshes) {
    const pa = m.geometry.getAttribute('position');
    for (let i = 0; i < pa.count; i++) { _p.fromBufferAttribute(pa, i).applyMatrix4(wreck.matrixWorld); if (_p.y < minY) minY = _p.y; }
  }
  if (!isFinite(minY)) minY = -4.5;
  const gWreck = groundRange(cx, cz, 7, 7).min;
  wreck.position.set(cx, gWreck - minY - 0.7, cz);
  scene.add(wreck);
  wreck.updateMatrixWorld(true);
  for (const [c, h] of [[V(0, 0, 0), V(4.4, 2.4, 4.4)], [V(0, 4.2, 0), V(2.8, 1.9, 2.7)]]) {
    addCollider(new OBB(c.clone().applyMatrix4(wreck.matrixWorld), wreck.quaternion, h, { surface: 'metal', grip: GRIP.metal }));
  }
  for (const [a, b] of [[16, 0], [-16, -6]]) {
    const x = cx + td.x * a + view.x * b, z = cz + td.y * a + view.y * b;
    R.beacons.red.push([x, heightAt(x, z), z, 1.8]);
  }

  // --- skid trench running back from the wreck ---
  const path = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N, d = 4 + t * trenchLen;
    const wob = Math.sin(t * 5.2) * 1.6 * t;
    path.push({ x: cx + slide.x * d + sp.x * wob, z: cz + slide.y * d + sp.y * wob, w: 1 - t * 0.55 });
  }
  const cFloor = new THREE.Color('#55565a'), cBerm = new THREE.Color('#9d9c97'), cEdge = new THREE.Color('#7b7b78');
  const trench = new THREE.Mesh(drapeGeo(path, [
    [-6.4, 0, 2], [-5.0, 0.75, 1], [-3.7, 0.25, 2], [-2.4, 0, 0], [0, 0, 0], [2.4, 0, 0], [3.7, 0.25, 2], [5.0, 0.75, 1], [6.4, 0, 2],
  ], [cFloor, cBerm, cEdge]), R.ground);
  trench.receiveShadow = true;
  scene.add(trench);

  // --- big debris pieces (merged per material, colliders on the big ones) ---
  const at = (along, across) => {
    const x = cx + slide.x * along + sp.x * across, z = cz + slide.y * along + sp.y * across;
    return [x, heightAt(x, z), z];
  };
  const slideYaw = Math.atan2(slide.x, slide.y);
  const big = new Parts();
  {
    // torn gold panel leaning on the ground (drive up it)
    const [x, g, z] = at(Math.min(34, trenchLen * 0.35), 9);
    const lean = 0.42;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, slideYaw + 0.5, 0, 'YXZ'));
    const c = new THREE.Vector3(x, g + Math.sin(lean) * 1.6 - 0.05, z);
    big.add(R.gold, new THREE.BoxGeometry(4.6, 0.18, 3.2), new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
    addCollider(new OBB(c, q, new THREE.Vector3(2.3, 0.09, 1.6), { surface: 'metal', grip: GRIP.metal }));
  }
  {
    // spherical tank, half buried
    const [x, g, z] = at(Math.min(55, trenchLen * 0.55), -8);
    big.add(R.gold, new THREE.SphereGeometry(1.4, 14, 10), mat4(x, g + 0.9, z));
    big.add(R.dark, new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8), mat4(x + 0.6, g + 2.0, z, 0, 0, -0.5));
    addCollider(new OBB(new THREE.Vector3(x, g + 1.15, z), new THREE.Quaternion(), new THREE.Vector3(1.2, 1.15, 1.2), { surface: 'metal', grip: GRIP.metal }));
  }
  {
    // the leg that broke off, lying in the dirt
    const [x1, g1, z1] = at(Math.min(72, trenchLen * 0.7), 4);
    const [x2, g2, z2] = at(Math.min(72, trenchLen * 0.7) + 5.5, 6.5);
    big.strut(R.dark, new THREE.Vector3(x1, g1 + 0.25, z1), new THREE.Vector3(x2, g2 + 0.25, z2), 0.2);
    big.strut(R.silver, new THREE.Vector3(x1 + 0.4, g1 + 0.2, z1 - 0.3), new THREE.Vector3((x1 + x2) / 2, (g1 + g2) / 2 + 0.2, (z1 + z2) / 2 + 0.8), 0.12);
    big.add(R.dark, new THREE.CylinderGeometry(1.0, 1.15, 0.3, 12), mat4(x2 + 0.6, g2 + 0.5, z2, 0.2, 0, 1.25));
  }
  big.build(scene);

  // --- broken thruster bell: knocked about by explosions (destruction target) ---
  {
    const [x, g, z] = at(18, -6);
    const bell = new THREE.Group();
    const bp = new Parts();
    bp.add(R.bell, new THREE.CylinderGeometry(0.45, 1.5, 2.4, 20, 1, true));
    bp.add(R.bell, new THREE.TorusGeometry(0.47, 0.12, 6, 18), mat4(0, 1.2, 0, Math.PI / 2));
    bp.add(R.bell, new THREE.CylinderGeometry(0.3, 0.42, 0.5, 10), mat4(0, 1.45, 0));
    const inner = new THREE.Group(); inner.rotation.z = Math.PI / 2 - 0.12; inner.position.y = 1.35;
    bp.build(inner);
    bell.add(inner);
    bell.position.set(x, g, z); bell.rotation.y = slideYaw + 1.1;
    scene.add(bell);
    if (world.d && typeof world.d.target === 'function') world.d.target(bell, new THREE.Vector3(1.5, 1.45, 1.55), 600, 1.35);
    else addCollider(new OBB(new THREE.Vector3(x, g + 1.35, z), bell.quaternion, new THREE.Vector3(1.5, 1.45, 1.55), { surface: 'metal' }));
  }
  // --- spilled supply crates (destructible blocks) ---
  if (world.d && typeof world.d.structure === 'function') {
    const x = cx - td.x * 12 + view.x * 5, z = cz - td.y * 12 + view.y * 5;
    const s = world.d.structure(x, z, slideYaw);
    for (const [lx, lz] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) world.d.block(s, lx, 0, lz, 1.2, 1.2, 1.2, 'crate');
    world.d.block(s, 0, 1.2, 0, 1.2, 1.2, 1.2, 'crate');
    const s2 = world.d.structure(x + slide.x * 4, z + slide.y * 4, slideYaw + 0.6);
    world.d.block(s2, 0, 0, 0, 1.2, 1.2, 1.2, 'crate');
  }

  // --- small debris (instanced, no colliders): along the trench and around the wreck ---
  const rng = mulberry(520);
  const items = [];
  for (let i = 0; i < 50; i++) {
    const along = 6 + rng() * trenchLen;
    const across = rng() < 0.3 ? (rng() - 0.5) * 6 : (rng() < 0.5 ? -1 : 1) * (7 + rng() * 11);
    items.push(at(along, across));
  }
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2, r = 9 + rng() * 22;
    const dx = Math.cos(a), dz = Math.sin(a);
    if (dx * -view.x + dz * -view.y > 0.82) continue;                   // keep the view from the teleport clear
    const x = cx + dx * r, z = cz + dz * r;
    items.push([x, heightAt(x, z), z]);
  }
  const deb = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), R.debris, items.length);
  const cGold = new THREE.Color('#d4a640'), cSilver = new THREE.Color('#b9bdc2'), cDark = new THREE.Color('#3c4148'), col = new THREE.Color();
  items.forEach(([x, g, z], i) => {
    const sx = 0.3 + rng() * 1.5, sy = 0.04 + rng() * 0.14, sz = 0.3 + rng() * 1.1;
    _e.set((rng() - 0.5) * 0.9, rng() * 6.28, (rng() - 0.5) * 0.9); _q.setFromEuler(_e);
    _m4.compose(_p.set(x, g + sy * 0.5 + 0.05, z), _q, _s.set(sx, sy, sz));
    deb.setMatrixAt(i, _m4);
    const r = rng();
    deb.setColorAt(i, col.copy(r < 0.5 ? cGold : r < 0.8 ? cSilver : cDark).multiplyScalar(0.85 + rng() * 0.3));
  });
  deb.castShadow = true; deb.receiveShadow = true;
  scene.add(deb);

  // sign on the left, facing the teleport
  const fx = Math.sin(tpYaw), fz = Math.cos(tpYaw), lx = Math.cos(tpYaw), lz = -Math.sin(tpYaw);
  const sx = tp[0] + fx * 16 - lx * 15, sz = tp[1] + fz * 16 - lz * 15;
  sign(world, sx, sz, Math.atan2(tp[0] - sx, tp[1] - sz), ['CRASHED LANDER', 'somebody parked badly · mind the debris'], { w: 15, h: 4, stripe: '#e0b040' });
}

// ---------- Big Crater: rim beacons, signs, a launch ramp on the far rim ----------
function buildBigCrater(world, R) {
  const A = AREAS.crater, cx = A.cx, cz = A.cz;
  const bowl = nearestCrater(cx, cz);
  const BR = bowl ? bowl.r : 220;
  const crest = (a) => crestRadius(cx, cz, a, BR * 0.8, BR * 1.3, BR * 1.05);
  // teleport at the end of the road on the south rim, facing +z
  const tp = pickFlat([[0, 520], [0, 512], [0, 505], [0, 528], [0, 496], [5, 515], [-5, 515], [0, 488]], 3, 0.5);
  world.teleports.push({ key: keyOf('crater', 7), name: zoneName('crater', 'Big Crater'), x: tp[0], z: tp[1], yaw: 0 });
  sign(world, tp[0] + 18, tp[1] + 14, Math.atan2(-18, -14), ['BIG CRATER', 'drive down the slope · launch off the far rim'], { w: 15, h: 4 });

  // launch ramp: its lip sits on the north rim crest, steeper than the inner slope
  const rN = crest(Math.PI / 2);
  const lipZ = Math.min(cz + rN + 2, cz + A.hd - 6);
  const L = 22, hw = 7;
  const z0 = lipZ - L;
  const dH = heightAt(cx, lipZ) - heightAt(cx, z0);
  const H = Math.max(dH + 2.5, Math.min(dH + L * 0.32, dH + 9));
  const w = world.wedge(cx, z0, 0, hw, L, H, { mat: R.ramp, noStripes: true });
  // own chevrons (do not rely on the batched paint)
  {
    const y0 = heightAt(cx, z0), a = Math.atan2(H, L), len = Math.hypot(L, H);
    const sp = new Parts();
    for (let i = 0; i < Math.floor(len / 4); i++) {
      const t = (i + 0.5) * 4 / len;
      const g = new THREE.PlaneGeometry(hw * 1.6, 0.5);
      sp.add(R.stripe, g, mat4(cx, y0 + t * H + 0.04, z0 + t * L, -Math.PI / 2 - a, 0, 0));
    }
    sp.build(world.scene, false);
  }
  void w;
  for (const s of [-1, 1]) R.beacons.cyan.push([cx + s * (hw + 2.5), heightAt(cx + s * (hw + 2.5), lipZ - 1), lipZ - 1, 2.2]);
  sign(world, cx + hw + 9, z0 - 10, Math.PI, ['LAUNCH RAMP', 'full throttle · hold Space to boost'], { w: 12, h: 3.4 });

  // guide lights across the bowl from the teleport to the ramp
  for (let z = tp[1] + 40; z < z0 - 12; z += 45) for (const s of [-1, 1]) R.beacons.amber.push([cx + s * 11, heightAt(cx + s * 11, z), z, 1.2]);
  // marker beacons around the rim crest
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2;
    const r = crest(a);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (Math.hypot(x - tp[0], z - tp[1]) < 30 || roadDist(x, z) < ROAD_HW + 6) continue;
    if (Math.abs(x - cx) < hw + 14 && z > cz) continue;                 // keep the ramp lip clear
    if (!inRect(x, z, A, -3)) continue;
    R.beacons.cyan.push([x, heightAt(x, z), z, 3]);
  }
}

// ---------- abandoned rover next to the canyon road, with tyre tracks ----------
function buildRover(world, R) {
  const cands = [];
  const road = ROADS.find(r => Math.hypot(r[2] - AREAS.canyon.cx, r[3] - AREAS.canyon.cz) < 400) || ROADS[0];
  if (road) {
    const [ax, az, bx, bz] = road, len = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    for (const t of [0.55, 0.45, 0.65, 0.35, 0.75]) for (const off of [34, -34, 46, -46]) cands.push([ax + (bx - ax) * t + tz * off, az + (bz - az) * t - tx * off, Math.atan2(tx, tz) + (off > 0 ? 0.7 : -0.7)]);
  }
  cands.push([-247, -271, 2.9], [-300, -150, 1], [250, -420, 0]);
  const spot = cands.find(([x, z]) => clearOf(x, z, MARGIN, []) && Math.hypot(x, z) < MAP_R);
  if (!spot) return;
  const [x, z, yaw] = spot;
  const p = new Parts();
  p.add(R.silver, new THREE.BoxGeometry(1.9, 0.18, 3.1), mat4(0, 0.78, 0));
  p.add(R.dark, new THREE.BoxGeometry(1.7, 0.08, 2.6), mat4(0, 0.68, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.add(R.dark, new THREE.CylinderGeometry(0.42, 0.42, 0.28, 14), mat4(sx * 1.12, 0.42, sz * 1.05, 0, 0, Math.PI / 2));
    p.add(R.silver, new THREE.BoxGeometry(0.44, 0.05, 1.05), mat4(sx * 1.12, 0.92, sz * 1.05));
  }
  for (const sx of [-1, 1]) {
    p.add(R.dark, new THREE.BoxGeometry(0.6, 0.1, 0.6), mat4(sx * 0.45, 0.92, -0.2));
    p.add(R.dark, new THREE.BoxGeometry(0.6, 0.6, 0.08), mat4(sx * 0.45, 1.25, -0.52, -0.15));
  }
  p.add(R.gold, new THREE.BoxGeometry(1.2, 0.5, 0.45), mat4(0, 1.12, 1.15));
  p.add(R.silver, new THREE.BoxGeometry(1.4, 0.3, 0.6), mat4(0, 1.02, -1.35));
  p.strut(R.dark, new THREE.Vector3(-0.6, 0.9, 1.35), new THREE.Vector3(-0.6, 2.3, 1.35), 0.04, 6);
  p.add(R.silver, new THREE.SphereGeometry(0.55, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.8), mat4(-0.6, 2.25, 1.35, 0.6, 0, 0));
  p.strut(R.dark, new THREE.Vector3(0.6, 0.9, 1.35), new THREE.Vector3(0.6, 1.65, 1.35), 0.04, 6);
  p.add(R.black, new THREE.BoxGeometry(0.28, 0.2, 0.32), mat4(0.6, 1.75, 1.35));
  const rover = new THREE.Group();
  const inner = new THREE.Group(); inner.rotation.set(0.03, 0, 0.06);
  p.build(inner);
  rover.add(inner);
  rover.position.set(x, heightAt(x, z), z); rover.rotation.y = yaw;
  world.scene.add(rover);
  if (world.d && typeof world.d.target === 'function') world.d.target(rover, new THREE.Vector3(1.35, 0.8, 1.7), 320, 0.85);
  else addCollider(new OBB(new THREE.Vector3(x, rover.position.y + 0.85, z), rover.quaternion, new THREE.Vector3(1.35, 0.8, 1.7), { surface: 'metal' }));
  // tyre tracks behind it
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const geos = [];
  const tc = new THREE.Color('#5f5f5d');
  for (const side of [-1, 1]) {
    const path = [];
    for (let s = 1.4; s <= 46; s += 1.5) {
      const wob = Math.sin(s / 14) * 5 * (s / 46);
      path.push({ x: x - fx * s + rx * (side * 1.12 + wob), z: z - fz * s + rz * (side * 1.12 + wob) });
    }
    geos.push(drapeGeo(path, [[-0.17, -0.03, 0], [0.17, -0.03, 0]], [tc]));
  }
  const tracks = new THREE.Mesh(mergeParts(geos), R.ground);
  tracks.receiveShadow = true;
  world.scene.add(tracks);
  R.keepOut.push([x, z, 22], [x - fx * 24, z - fz * 24, 26]);
}

// ---------- small marker flags along the roads ----------
function buildRoadMarkers(world, R) {
  for (const [ax, az, bx, bz] of ROADS) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 30) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len, nx = tz, nz = -tx;
    const n = Math.max(1, Math.floor(len / 45));
    for (let i = 0; i <= n; i++) {
      const t = i * len / n, side = i % 2 ? 1 : -1;
      const x = ax + tx * t + nx * 12 * side, z = az + tz * t + nz * 12 * side;
      let ok = roadDist(x, z) > 10.5 && !inPads(x, z, 4) && Math.hypot(x, z) < MAP_R;
      for (const k in AREAS) if (ok && inRect(x, z, AREAS[k], 4)) ok = false;
      if (!ok) continue;
      const g = heightAt(x, z);
      R.beacons.amber.push([x, g, z, 2.4]);
      R.flags.push([x, g + 2.1, z, Math.atan2(-tz, tx) + (side > 0 ? Math.PI : 0)]);
    }
  }
}

// ---------- boulders and pebbles (instanced) ----------
function buildBoulders(world, R) {
  const rng = mulberry(4242);
  const kept = (x, z) => { for (const [kx, kz, kr] of R.keepOut) if (Math.hypot(x - kx, z - kz) < kr) return true; return false; };
  const ok = (x, z) => Math.hypot(x, z) < MAP_R && clearOf(x, z, MARGIN, ['canyon']) && !kept(x, z);
  const NB = 340, NS = 650;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), R.rock, NB);
  const pebbles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), R.rock, NS);
  const col = new THREE.Color();
  let k = 0, tries = 0, obbs = 0;
  const roads = ROADS.filter(r => Math.hypot(r[2] - r[0], r[3] - r[1]) > 60);
  while (k < NB && tries < NB * 30) {
    tries++;
    // the first few are big boulders with colliders beside the roads, the rest small ones anywhere
    const bigOne = obbs < MAX_ROCK_OBBS - 6 && tries < 2000 && roads.length > 0;
    let x, z;
    if (bigOne) {
      const rd = roads[(rng() * roads.length) | 0], t = rng();
      const dx = rd[2] - rd[0], dz = rd[3] - rd[1], l = Math.hypot(dx, dz), off = (rng() < 0.5 ? -1 : 1) * (ROAD_HW + MARGIN + 3 + rng() * 55);
      x = rd[0] + dx * t + dz / l * off; z = rd[1] + dz * t - dx / l * off;
    } else { x = (rng() - 0.5) * 2 * MAP_R; z = (rng() - 0.5) * 2 * MAP_R; }
    if (!ok(x, z)) continue;
    let r = 0.45 + Math.pow(rng(), 1.5) * 0.95, solid = false;
    if (bigOne && !inRect(x, z, AREAS.canyon, 0)) { r = 2.2 + rng() * 2.4; solid = true; }
    else if (bigOne) continue;
    const yaw = rng() * Math.PI * 2;
    const g = Math.min(heightAt(x, z), heightAt(x + r * 0.8, z), heightAt(x - r * 0.8, z), heightAt(x, z + r * 0.8), heightAt(x, z - r * 0.8));
    _p.set(x, g + r * 0.7 * 0.3, z);
    if (solid) _q.setFromAxisAngle(UP, yaw);
    else { _e.set((rng() - 0.5) * 0.5, yaw, (rng() - 0.5) * 0.5); _q.setFromEuler(_e); }
    _s.set(r, r * 0.7, r * 1.1);
    rocks.setMatrixAt(k, _m4.compose(_p, _q, _s));
    const v = 0.42 + rng() * 0.22;
    rocks.setColorAt(k, col.setRGB(v, v, v * 0.97));
    k++;
    if (solid) {
      obbs++;
      addCollider(new OBB(_p, _q, new THREE.Vector3(r * 0.75, r * 0.55, r * 0.8), { surface: 'rock', grip: 0.9 }));
    }
  }
  rocks.count = k;
  rocks.castShadow = true; rocks.receiveShadow = true;
  world.scene.add(rocks);
  k = 0; tries = 0;
  while (k < NS && tries < NS * 30) {
    tries++;
    const x = (rng() - 0.5) * 2 * MAP_R, z = (rng() - 0.5) * 2 * MAP_R;
    if (!ok(x, z)) continue;
    const r = 0.12 + rng() * 0.33;
    _p.set(x, heightAt(x, z) - r * 0.2, z);
    _e.set(rng() * 0.6, rng() * 6.28, rng() * 0.6); _q.setFromEuler(_e);
    _s.set(r, r * 0.65, r * 1.15);
    pebbles.setMatrixAt(k, _m4.compose(_p, _q, _s));
    const v = 0.38 + rng() * 0.25;
    pebbles.setColorAt(k, col.setRGB(v, v, v));
    k++;
  }
  pebbles.count = k;
  pebbles.receiveShadow = true;
  world.scene.add(pebbles);
}

// ---------- every beacon / marker light on the map, instanced ----------
function buildBeacons(world, R) {
  const all = [...R.beacons.cyan, ...R.beacons.red, ...R.beacons.amber];
  if (all.length) {
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 1, 6); poleGeo.translate(0, 0.5, 0);
    const poles = new THREE.InstancedMesh(poleGeo, R.dark, all.length);
    all.forEach(([x, y, z, h], i) => poles.setMatrixAt(i, _m4.compose(_p.set(x, y - 0.1, z), _q.identity(), _s.set(1, h + 0.1, 1))));
    poles.castShadow = true;
    world.scene.add(poles);
  }
  const headGeo = new THREE.SphereGeometry(0.2, 10, 6);
  for (const [list, mat] of [[R.beacons.cyan, R.blinkCyan], [R.beacons.red, R.blinkRed], [R.beacons.amber, R.amber]]) {
    if (!list.length) continue;
    const heads = new THREE.InstancedMesh(headGeo, mat, list.length);
    list.forEach(([x, y, z, h], i) => heads.setMatrixAt(i, _m4.compose(_p.set(x, y + h + 0.1, z), _q.identity(), _s.set(1, 1, 1))));
    world.scene.add(heads);
  }
  if (R.flags.length) {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.25, 0, 0.75, 0, 0, 0, -0.25, 0], 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    fg.setIndex([0, 2, 1]);
    const flags = new THREE.InstancedMesh(fg, R.flag, R.flags.length);
    R.flags.forEach(([x, y, z, yaw], i) => { _q.setFromAxisAngle(UP, yaw); flags.setMatrixAt(i, _m4.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1))); });
    world.scene.add(flags);
  }
}
