// Terrain: a precomputed height grid shared by rendering and physics.
// Physics samples the exact same triangles that are drawn, so wheels never float or sink.
import * as THREE from 'three';

export const TERRAIN_SIZE = 4000;
export const TERRAIN_RES = 8;
const HALF = TERRAIN_SIZE / 2;
const N = TERRAIN_SIZE / TERRAIN_RES + 1;
const H = new Float32Array(N * N);

// ---------- noise ----------
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
export function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, t = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, z * f); t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------- map layout (flat / paved shapes) ----------
// type: 'rect' {cx,cz,hw,hd,yaw}, 'circle' {cx,cz,r}, 'seg' {ax,az,bx,bz,hw}
export const FLAT_SHAPES = [];
export const PAVED_SHAPES = [];
function addShape(s, paved = true, blend = 45) { s.blend = blend; FLAT_SHAPES.push(s); if (paved) PAVED_SHAPES.push(s); }

export function sdfShape(s, x, z) {
  if (s.type === 'circle') return Math.hypot(x - s.cx, z - s.cz) - s.r;
  if (s.type === 'rect') {
    let dx = x - s.cx, dz = z - s.cz;
    if (s.yaw) { const c = Math.cos(s.yaw), sn = Math.sin(s.yaw); const lx = c * dx - sn * dz; const lz = sn * dx + c * dz; dx = lx; dz = lz; }
    const qx = Math.abs(dx) - s.hw, qz = Math.abs(dz) - s.hd;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  }
  // segment (capsule)
  const px = x - s.ax, pz = z - s.az, bx = s.bx - s.ax, bz = s.bz - s.az;
  const h = Math.min(1, Math.max(0, (px * bx + pz * bz) / (bx * bx + bz * bz)));
  return Math.hypot(px - bx * h, pz - bz * h) - s.hw;
}

// Zone layout. Everything in the world references these so the map stays consistent.
export const ZONES = {
  hq:       { name: 'Air Station HQ',   x: 0,    z: 0,    r: 110, tip: 'Park on the glowing pad to refill air. Number keys 1-9 teleport.' },
  drag:     { name: 'Drag Strip',       x: 620,  z: -150, r: 560, tip: 'Stop on the line, hold Shift + W. 0-60 and 1/4 mile are timed.' },
  handling: { name: 'Handling Pad',     x: -330, z: -210, r: 170, tip: 'Skidpad and slalom. Hold X to drift.' },
  launch:   { name: 'Launch Site',      x: -170, z: 360,  r: 120, tip: 'Fly around the tower. Space to lift off.' },
  demo:     { name: 'Demo Ramp 170°',   x: 250,  z: 260,  r: 120, tip: 'Floor it up the curve. At the top press Space to flip and hover down.' },
  loop:     { name: 'Loop of Death',    x: 540,  z: 260,  r: 120, tip: 'Hit it at 50+ mph. The fan suction keeps you stuck to the track.' },
  wall:     { name: 'Wall Ride',        x: 860,  z: 430,  r: 180, tip: 'Angle into the curve at speed and ride the vertical wall.' },
  jump:     { name: 'Jump Park',        x: -620, z: 170,  r: 220, tip: 'Launch over the car lineup and the Semi. Jump stats show on landing.' },
  canyon:   { name: 'Flight Canyon',    x: -720, z: -650, r: 330, tip: 'Fly through the rings in order. Land on the mesa pads.' },
  weapons:  { name: 'Weapons Range',    x: 640,  z: -640, r: 260, tip: 'Drive through a launcher to pick it up. Click or B to fire rockets.' },
  dunes:    { name: 'Dunes',            x: 0,    z: 850,  r: 430, tip: 'Off-road sand. Grip is lower here.' },
};

// paved areas
addShape({ type: 'rect', cx: 0, cz: 0, hw: 95, hd: 95 });                       // HQ apron
addShape({ type: 'rect', cx: 625, cz: -150, hw: 540, hd: 15 }, true, 50);       // drag strip
addShape({ type: 'rect', cx: -330, cz: -210, hw: 150, hd: 120 });               // handling pad
addShape({ type: 'rect', cx: -170, cz: 360, hw: 90, hd: 90 });                  // launch site pad
addShape({ type: 'rect', cx: 250, cz: 205, hw: 30, hd: 130 });                  // demo ramp runway
addShape({ type: 'rect', cx: 548, cz: 210, hw: 34, hd: 150 });                  // loop runway
addShape({ type: 'rect', cx: 860, cz: 400, hw: 170, hd: 60 });                  // wall ride pad
addShape({ type: 'rect', cx: -620, cz: 170, hw: 170, hd: 150 }, true, 50);      // jump park
addShape({ type: 'rect', cx: 640, cz: -560, hw: 70, hd: 40 });                  // weapons range entrance pad
// dirt (flat, not paved)
addShape({ type: 'rect', cx: 640, cz: -680, hw: 230, hd: 170 }, false, 50);     // weapons range field
// roads (paved, 14 m wide)
const ROADS = [
  [0, -95, 0, -150],  [0, -150, 85, -150],                  // HQ -> drag strip start
  [-95, -60, -200, -150],                                   // HQ -> handling
  [-60, 95, -150, 270],                                     // HQ -> launch site
  [60, 95, 250, 75],                                        // HQ -> demo ramp
  [250, 75, 548, 60],                                       // demo -> loop
  [548, 60, 700, 400],                                      // loop -> wall ride
  [-95, 60, -450, 140],                                     // HQ -> jump park
  [-450, -260, -600, -480],                                 // handling -> canyon
  [400, -150, 640, -520],                                   // drag strip -> weapons
  [0, 95, 0, 420],                                          // HQ -> dunes edge
];
export const ROAD_SEGS = ROADS.map(([ax, az, bx, bz]) => ({ type: 'seg', ax, az, bx, bz, hw: 7 }));
for (const r of ROAD_SEGS) addShape(r, true, 30);

// ---------- other maps (2.5) ----------
// useMap(def) switches the terrain to another map before buildHeights(). Without it, the desert is
// built exactly as before.
let MAP = null;
const NOISE = { fbm, smooth };
export function useMap(def) {
  MAP = def;
  FLAT_SHAPES.length = 0; PAVED_SHAPES.length = 0;
  for (const s of def.flats || []) { const { paved = true, blend = 45, ...shape } = s; addShape(shape, paved, blend); }
  for (const k of Object.keys(ZONES)) delete ZONES[k];
  Object.assign(ZONES, def.zones || {});
}
export const currentMap = () => MAP;

export const MESAS = [
  { x: -640, z: -600, r: 75, h: 55, name: 'Mesa A' },
  { x: -860, z: -470, r: 60, h: 85, name: 'Mesa B' },
  { x: -560, z: -840, r: 62, h: 68, name: 'Mesa C' },
  { x: -920, z: -760, r: 95, h: 42, name: 'Mesa D' },
];

// ---------- natural height (used only while building the grid) ----------
function naturalHeight(x, z) {
  let h = (fbm(x * 0.0035 + 11, z * 0.0035 - 7) - 0.5) * 9;
  h += (fbm(x * 0.02, z * 0.02, 3) - 0.5) * 1.2;
  // dunes (north)
  const dw = smooth(520, 260, Math.hypot(x - ZONES.dunes.x, (z - ZONES.dunes.z) * 0.8));
  if (dw > 0) {
    const n = fbm(x * 0.006, z * 0.006, 3);
    const d = Math.sin((x * 0.55 + z * 0.83) * 0.04 + n * 6);
    h += dw * (Math.pow(1 - Math.abs(d), 1.6) * 9 + n * 3);
  }
  // mesas (canyon)
  for (const m of MESAS) {
    const dist = Math.hypot(x - m.x, z - m.z) + (fbm(x * 0.03, z * 0.03, 3) - 0.5) * 22;
    const t = smooth(m.r + 30, m.r - 4, dist);
    if (t > 0) {
      const terr = Math.round(t * 4) / 4;
      h = Math.max(h, m.h * (t * 0.75 + terr * 0.25));
    }
  }
  // mountain rim
  const r = Math.hypot(x, z);
  const mw = smooth(1330, 1800, r);
  if (mw > 0) h += mw * (110 + 180 * fbm(x * 0.0022 + 3, z * 0.0022 + 5, 5)) + mw * mw * 60;
  return h;
}

function flatMask(x, z) {
  let m = 1;
  for (const s of FLAT_SHAPES) {
    const d = sdfShape(s, x, z);
    if (d < s.blend) m = Math.min(m, smooth(0, s.blend, d));
    if (m === 0) break;
  }
  // mesa pads stay flat on top: handled by mesa shape itself
  return m;
}

export function buildHeights() {
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * TERRAIN_RES;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * TERRAIN_RES;
      const m = flatMask(x, z);
      H[j * N + i] = m === 0 ? 0 : (MAP ? MAP.height(x, z, NOISE) : naturalHeight(x, z)) * m;
    }
  }
}

// ---------- queries ----------
export function heightAt(x, z) {
  let gx = (x + HALF) / TERRAIN_RES, gz = (z + HALF) / TERRAIN_RES;
  if (gx < 0) gx = 0; else if (gx > N - 1.001) gx = N - 1.001;
  if (gz < 0) gz = 0; else if (gz > N - 1.001) gz = N - 1.001;
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
  const k = j * N + i;
  const h00 = H[k], h10 = H[k + 1], h01 = H[k + N], h11 = H[k + N + 1];
  return fx > fz ? h00 + fx * (h10 - h00) + fz * (h11 - h10) : h00 + fz * (h01 - h00) + fx * (h11 - h01);
}
export function normalAt(x, z, out) {
  let gx = (x + HALF) / TERRAIN_RES, gz = (z + HALF) / TERRAIN_RES;
  if (gx < 0) gx = 0; else if (gx > N - 1.001) gx = N - 1.001;
  if (gz < 0) gz = 0; else if (gz > N - 1.001) gz = N - 1.001;
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
  const k = j * N + i;
  const h00 = H[k], h10 = H[k + 1], h01 = H[k + N], h11 = H[k + N + 1];
  let dx, dz;
  if (fx > fz) { dx = (h10 - h00) / TERRAIN_RES; dz = (h11 - h10) / TERRAIN_RES; }
  else { dz = (h01 - h00) / TERRAIN_RES; dx = (h11 - h01) / TERRAIN_RES; }
  out.set(-dx, 1, -dz).normalize();
  return out;
}
export function isPaved(x, z) {
  if (MAP) return MAP.paved(x, z);
  for (const s of PAVED_SHAPES) if (sdfShape(s, x, z) < 0) return true;
  return false;
}

// ---------- mesh ----------
function makeDetailTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    // tileable noise via periodic sampling
    const n = 0.55 * tileNoise(x, y, 16) + 0.3 * tileNoise(x, y, 32) + 0.15 * Math.random();
    const v = 185 + n * 70;
    const k = (y * 256 + x) * 4;
    img.data[k] = v; img.data[k + 1] = v; img.data[k + 2] = v; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function tileNoise(x, y, period) {
  const fx = x / 256 * period, fy = y / 256 * period;
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const h = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

function terrainColor(x, z, h, c, nrm, cols) {
  normalAt(x + 0.1, z + 0.2, nrm);
  const slope = 1 - nrm.y;
  const n1 = fbm(x * 0.01, z * 0.01, 3), n2 = fbm(x * 0.07 + 50, z * 0.07, 2);
  c.copy(cols.sand).lerp(cols.sandDark, n1 * 0.9);
  c.lerp(cols.scrub, Math.max(0, n2 - 0.55) * 1.4);
  const dw = smooth(520, 300, Math.hypot(x - ZONES.dunes.x, (z - ZONES.dunes.z) * 0.8));
  c.lerp(cols.dune, dw * 0.6);
  const fm = flatMask(x, z);
  if (fm < 1) c.lerp(cols.flat, (1 - fm) * 0.5);
  const rk = smooth(0.18, 0.45, slope) + (h > 30 ? smooth(30, 70, h) * 0.5 : 0);
  if (rk > 0) { c.lerp(cols.rock, Math.min(1, rk)); c.lerp(cols.rockDark, Math.min(1, rk) * n2 * 0.6); }
  if (h > 25) { const band = 0.5 + 0.5 * Math.sin(h * 0.9 + n1 * 2); c.multiplyScalar(0.88 + band * 0.16); }
  return c;
}

// Builds one grid patch. step = vertex spacing in grid cells; skip(i, j) drops interior cells.
function terrainPatch(i0, i1, j0, j1, step, drop, skip) {
  const nx = Math.floor((i1 - i0) / step) + 1, nz = Math.floor((j1 - j0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  const nrm = new THREE.Vector3(), c = new THREE.Color();
  const cols = { sand: new THREE.Color('#d9b98a'), sandDark: new THREE.Color('#b8925f'), rock: new THREE.Color('#9a5a3a'), rockDark: new THREE.Color('#6e3f2b'), scrub: new THREE.Color('#a39a6a'), dune: new THREE.Color('#e6c391'), flat: new THREE.Color('#c9ad80') };
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) {
    const i = i0 + a * step, j = j0 + b * step, k = b * nx + a;
    const x = -HALF + i * TERRAIN_RES, z = -HALF + j * TERRAIN_RES, h = H[j * N + i];
    pos[k * 3] = x; pos[k * 3 + 1] = h - drop; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 9; uv[k * 2 + 1] = z / 9;
    if (MAP) { normalAt(x + 0.1, z + 0.2, nrm); MAP.color(x, z, h, c, nrm, flatMask(x, z)); } else terrainColor(x, z, h, c, nrm, cols);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx = [];
  for (let b = 0; b < nz - 1; b++) for (let a = 0; a < nx - 1; a++) {
    if (skip && skip(i0 + a * step, j0 + b * step)) continue;
    const p0 = b * nx + a, p1 = p0 + 1, p3 = p0 + nx, p2 = p3 + 1;
    idx.push(p0, p2, p1, p0, p3, p2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildTerrainMesh() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: makeDetailTexture(), roughness: 0.96, metalness: 0 });
  const group = new THREE.Group();
  // full-resolution core (exactly matches physics) and a coarse outer ring for the distant mountains
  const core = 1480, ci0 = Math.round((HALF - core) / TERRAIN_RES), ci1 = Math.round((HALF + core) / TERRAIN_RES);
  const inner = new THREE.Mesh(terrainPatch(ci0, ci1, ci0, ci1, 1, 0), mat);
  inner.receiveShadow = true;
  group.add(inner);
  const step = 4, margin = step * 2;
  const outer = new THREE.Mesh(terrainPatch(0, N - 1, 0, N - 1, step, 0.6,
    (i, j) => i >= ci0 + margin && i + step <= ci1 - margin && j >= ci0 + margin && j + step <= ci1 - margin), mat);
  group.add(outer);
  return group;
}

// Low-res image of the map for the minimap / big map.
export function buildMapImage(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const span = 3000; // map shows -1500..1500
  const nrm = new THREE.Vector3();
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = -span / 2 + (px + 0.5) / size * span, z = -span / 2 + (py + 0.5) / size * span;
    const h = heightAt(x, z);
    normalAt(x, z, nrm);
    const shade = Math.max(0.35, Math.min(1.2, 0.75 + (nrm.x * -0.6 + nrm.z * -0.5) * 2.2));
    let r = 196, gg = 168, b = 124;
    if (MAP) [r, gg, b] = MAP.mapColor(x, z, h);
    else if (h > 20) { const t = Math.min(1, (h - 20) / 80); r = 196 - 60 * t; gg = 168 - 80 * t; b = 124 - 60 * t; }
    if (isPaved(x, z)) { r = 70; gg = 72; b = 78; }
    const k = (py * size + px) * 4;
    img.data[k] = r * shade; img.data[k + 1] = gg * shade; img.data[k + 2] = b * shade; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, span };
}
