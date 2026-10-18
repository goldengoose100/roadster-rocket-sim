// Neon City part: Neon Garage HQ (plaza around the air pad), Drag Avenue (timed strip) and the
// Skyscraper Rings course along street x = 100. Static decoration is merged into a few meshes per
// material; everything the car can hit gets an OBB collider. Nothing solid goes in the drag strip.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, OBB, GRIP } from '../../colliders.js';
import { heightAt } from '../../terrain.js';
import { ZONES, KEYS } from './layout.js';

// the drag strip: flat and collider-free (0-60 and the quarter mile are timed here)
const STRIP = { x0: 90, x1: 720, z0: -168, z1: -132 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

function groundY(x, z) {
  let h = 0;
  try { h = heightAt(x, z); } catch (e) { h = 0; }
  return Number.isFinite(h) ? h : 0;
}
function keyFor(id, fallback) { for (const k in KEYS) if (KEYS[k] === id) return Number(k); return fallback; }
function zoneName(id, fallback) { return (ZONES && ZONES[id] && ZONES[id].name) || fallback; }
const hitsStrip = (minX, maxX, minZ, maxZ) => maxX > STRIP.x0 && minX < STRIP.x1 && maxZ > STRIP.z0 && minZ < STRIP.z1;
// distance to the nearest cross street centre line (streets every 100 m)
const crossStreet = (x) => Math.abs(x - Math.round(x / 100) * 100);

// OBB collider (centre cx, cy, cz; half extents), refused inside the drag strip
function collideBox(cx, cy, cz, hx, hy, hz, yaw = 0, opts = {}) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const ex = c * hx + s * hz, ez = s * hx + c * hz;
  if (hitsStrip(cx - ex, cx + ex, cz - ez, cz + ez)) { console.warn('[neon/hq] collider refused inside the drag strip', cx, cz); return null; }
  const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw || 0);
  return addCollider(new OBB(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(hx, hy, hz), { grip: opts.grip ?? GRIP.concrete, surface: opts.surface || 'concrete' }));
}

// collects geometry per material and merges it into one mesh per material
class Merger {
  constructor(scene, cast = true) { this.scene = scene; this.cast = cast; this.lists = new Map(); }
  // geo must be a fresh geometry (it is transformed in place); rotation is yaw (ry) after pitch (rx) and roll (rz)
  add(mat, geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    if (!geo || !mat) return;
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z);
    geo.applyMatrix4(_m.compose(_p, _q, _one));
    let l = this.lists.get(mat);
    if (!l) { l = []; this.lists.set(mat, l); }
    l.push(geo);
  }
  box(mat, x, y, z, w, h, d, ry = 0, rx = 0, rz = 0) { this.add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, ry, rx, rz); }
  flush() {
    for (const [mat, geos] of this.lists) {
      if (!geos.length) continue;
      let merged = null;
      if (geos.length === 1) merged = geos[0];
      else { try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; } }
      if (merged) {
        this.mesh(merged, mat);
        if (geos.length > 1) for (const g of geos) g.dispose();
      } else for (const g of geos) this.mesh(g, mat);
    }
    this.lists.clear();
  }
  mesh(g, mat) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = this.cast; m.receiveShadow = true;
    this.scene.add(m);
  }
}
// solid box: y is the bottom; merged visual + collider
function solid(mg, mat, x, y, z, w, h, d, yaw = 0, surface = 'concrete') {
  mg.box(mat, x, y + h / 2, z, w, h, d, yaw);
  collideBox(x, y + h / 2, z, w / 2, h / 2, d / 2, yaw, { surface, grip: surface === 'metal' ? GRIP.metal : GRIP.concrete });
}
// flat ground plane (horizontal), UVs in metres / uvScale
function flatPlane(hw, hd, uvScale = 8) {
  const g = new THREE.PlaneGeometry(hw * 2, hd * 2);
  g.rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * hw * 2 / uvScale, uv.getY(i) * hd * 2 / uvScale);
  return g;
}
// vertical plane facing +z with UVs mapped onto one atlas cell [u0, v0, u1, v1]
function labelPlane(w, h, r) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  return g;
}

// ---------- textures (created inside build) ----------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// same look as the desert's text boards (ring numbers, signs)
function textTex(lines, opts = {}) {
  const w = opts.w || 1024, h = opts.h || 256;
  return canvasTex(w, h, (g) => {
    g.fillStyle = opts.bg || '#101418'; g.fillRect(0, 0, w, h);
    if (opts.stripe) { g.fillStyle = opts.stripe; g.fillRect(0, h - 18, w, 18); }
    g.fillStyle = opts.fg || '#f4f6f8';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const sizes = opts.sizes || [h * 0.42, h * 0.2];
    let y = lines.length === 1 ? h / 2 : h * 0.38;
    lines.forEach((ln, i) => {
      g.font = `${i === 0 ? 800 : 600} ${sizes[i] || sizes[1]}px ${FONT}`;
      g.fillStyle = i === 0 ? (opts.fg || '#f4f6f8') : (opts.fg2 || '#9fb3c2');
      g.fillText(ln, w / 2, y, w - 24);
      y += h * 0.32;
    });
  }, false);
}
function tileTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1d1f29'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#252836'; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.035)';
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
    g.strokeStyle = '#0b0c12'; g.lineWidth = 4;
    for (const v of [2, w / 2]) {
      g.beginPath(); g.moveTo(v, 0); g.lineTo(v, h); g.stroke();
      g.beginPath(); g.moveTo(0, v); g.lineTo(w, v); g.stroke();
    }
  });
}
function neonSignTex(text) {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#07060d'; g.fillRect(0, 0, w, h);
    g.shadowColor = '#3ef0ff'; g.shadowBlur = 18; g.strokeStyle = '#7ff6ff'; g.lineWidth = 7;
    g.strokeRect(16, 16, w - 32, h - 32);
    g.font = `900 150px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ff2bd6'; g.shadowBlur = 34; g.fillStyle = '#ffd6f6';
    g.fillText(text, w / 2, h / 2 + 6, w - 100);
    g.shadowBlur = 12; g.lineWidth = 3; g.strokeStyle = '#ff2bd6';
    g.strokeText(text, w / 2, h / 2 + 6, w - 100);
  }, false);
}
// one texture for every small label: 2 x 8 cells of 512 x 128. aspect = width/height of the plane it is shown on
const LABELS = [
  { text: 'START', aspect: 12, fg: '#ffffff', glow: '#3ef0ff' },
  { text: '1/8 MILE', aspect: 12, fg: '#bff8ff', glow: '#3ef0ff' },
  { text: '1/4 MILE', aspect: 12, fg: '#bff8ff', glow: '#3ef0ff' },
  { text: 'FINISH', aspect: 12, fg: '#ffd6f6', glow: '#ff2bd6' },
  { text: 'DRAG AVENUE', aspect: 12, fg: '#bff8ff', glow: '#3ef0ff' },
  { text: '100 m', aspect: 2.5, fg: '#ffffff', glow: '#ffe14a' },
  { text: '200 m', aspect: 2.5, fg: '#ffffff', glow: '#ffe14a' },
  { text: '300 m', aspect: 2.5, fg: '#ffffff', glow: '#ffe14a' },
  { text: '400 m', aspect: 2.5, fg: '#ffffff', glow: '#ffe14a' },
  { text: '500 m', aspect: 2.5, fg: '#ffffff', glow: '#ffe14a' },
  { text: 'TACOS', aspect: 4.125, fg: '#fff3b0', glow: '#ffe14a' },
  { text: 'NOODLES', aspect: 4.125, fg: '#ffd6f6', glow: '#ff2bd6' },
  { text: 'DONUTS', aspect: 4.125, fg: '#bff8ff', glow: '#3ef0ff' },
];
const LBL = { start: 0, eighth: 1, quarter: 2, finish: 3, avenue: 4, m100: 5, tacos: 10 };
function makeAtlas(labels) {
  const COLS = 2, ROWS = 8, CW = 512, CH = 128, W = CW * COLS, H = CH * ROWS;
  const tex = canvasTex(W, H, (g) => {
    g.fillStyle = '#0a0b14'; g.fillRect(0, 0, W, H);
    labels.forEach((L, i) => {
      const x0 = (i % COLS) * CW, y0 = Math.floor(i / COLS) * CH;
      const A = L.aspect || 4, sx = 4 / A;
      g.fillStyle = L.glow || '#ff2bd6'; g.fillRect(x0 + 8, y0 + CH - 18, CW - 16, 8);
      g.save();
      g.translate(x0 + CW / 2, y0 + CH * 0.44);
      g.scale(sx, 1);
      g.font = `800 ${L.size || 86}px ${FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = L.glow || '#ffffff'; g.shadowBlur = 14;
      g.fillStyle = L.fg || '#ffffff';
      g.fillText(L.text, 0, 0, (CW - 28) / sx);
      g.restore();
    });
  }, false);
  const pad = 3;
  const uvOf = (i) => {
    const c = i % COLS, r = Math.floor(i / COLS);
    return [(c * CW + pad) / W, 1 - ((r + 1) * CH - pad) / H, ((c + 1) * CW - pad) / W, 1 - (r * CH + pad) / H];
  };
  return { tex, uvOf };
}

// shared materials for the whole part (created once per build)
function makeKit(world) {
  const M = world.mats || {};
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const glow = (c, i = 2.2, extra = {}) => std({ color: '#0b0b12', emissive: c, emissiveIntensity: i, roughness: 0.4, ...extra });
  const flatOff = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
  const atlas = makeAtlas(LABELS);
  return {
    M,
    darkSteel: M.darkSteel || std({ color: '#3b4148', roughness: 0.5, metalness: 0.7 }),
    steel: M.steel || std({ color: '#9ea4ab', roughness: 0.35, metalness: 0.85 }),
    rubber: M.rubber || std({ color: '#16171a', roughness: 0.9 }),
    wall: std({ color: '#1c1e2b', roughness: 0.8, metalness: 0.15 }),
    trim: std({ color: '#2b2e40', roughness: 0.5, metalness: 0.6 }),
    red: std({ color: '#b3122e', roughness: 0.45, metalness: 0.5 }),
    white: std({ color: '#d9dce6', roughness: 0.5, metalness: 0.2 }),
    pink: glow('#ff2bd6', 2.4), cyan: glow('#3ef0ff', 2.2), purple: glow('#a35cff', 2.4),
    green: glow('#3dff7a', 2.2), yellow: glow('#ffe14a', 2.2), amber: M.glowAmber || glow('#ffb547', 2.2),
    linePink: glow('#ff2bd6', 2.0, flatOff), lineCyan: glow('#3ef0ff', 1.8, flatOff), runway: glow('#ffe14a', 1.8, flatOff),
    trunk: glow('#b04cff', 1.3),
    frond: std({ color: '#0e3527', emissive: '#19e68c', emissiveIntensity: 0.35, roughness: 0.75 }),
    bench: std({ color: '#30344a', roughness: 0.55, metalness: 0.5 }),
    atlas,
    atlasMat: std({ map: atlas.tex, emissive: '#ffffff', emissiveMap: atlas.tex, emissiveIntensity: 1.1, roughness: 0.6 }),
  };
}

function run(name, fn) {
  try { fn(); } catch (e) { console.error(`[neon/hq] ${name} failed`, e); }
}

export function build(world) {
  // teleports first, so they exist even if a later step throws
  world.teleports.push({ key: keyFor('hq', 1), name: zoneName('hq', 'Neon Garage HQ'), x: 0, z: 0, yaw: Math.PI });
  world.teleports.push({ key: keyFor('drag', 2), name: zoneName('drag', 'Drag Avenue'), x: 150, z: -150, yaw: Math.PI / 2 });
  world.teleports.push({ key: keyFor('rings', 8), name: zoneName('rings', 'Skyscraper Rings'), x: 100, z: 330, yaw: 0 });
  world.airPad(0, 0, 13, 'HQ');   // refuel + repair
  let K = null;
  run('kit', () => { K = makeKit(world); });
  if (!K) return;
  run('hq', () => buildHQ(world, K));
  run('drag', () => buildDrag(world, K));
  run('rings', () => buildRings(world, K));
  // painted markings (world.quad with paint/yellow) are batched; merge what is pending now (safe to flush again later)
  run('flush', () => { if (typeof world.flushBatches === 'function') world.flushBatches(); });
}

// ======================= Neon Garage HQ =======================
function buildHQ(world, K) {
  const scene = world.scene, d = world.d, M = K.M;
  const S = new Merger(scene, true), G = new Merger(scene, false), F = new Merger(scene, false);
  const quad = (...a) => world.quad(...a);

  // ---- plaza paving in the four corner blocks (streets x = 0 / z = 0 stay open) + glowing curbs ----
  const plazaMat = new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.38, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * 50, cz = sz * 50, y = groundY(cx, cz);
    F.add(plazaMat, flatPlane(40, 40, 8), cx, y + 0.02, cz);
    for (const s of [-1, 1]) {
      F.add(K.lineCyan, flatPlane(39.6, 0.14, 1), cx, y + 0.05, cz + s * 39.4);
      F.add(K.lineCyan, flatPlane(0.14, 39.6, 1), cx + s * 39.4, y + 0.05, cz);
    }
  }

  // ---- the Neon Garage: south-west block, open front facing the z = 0 street (+z) ----
  const GX0 = -84, GX1 = -30, GZB = -82, GZF = -30, GH = 13, T = 1;
  const gcx = (GX0 + GX1) / 2, gcz = (GZB + GZF) / 2, GW = GX1 - GX0, GD = GZF - GZB;
  const gy = groundY(gcx, gcz);
  solid(S, K.wall, gcx, gy, GZB + T / 2, GW, GH, T);                  // back wall
  solid(S, K.wall, GX0 + T / 2, gy, gcz, T, GH, GD);                  // west wall
  solid(S, K.wall, GX1 - T / 2, gy, gcz, T, GH, GD);                  // east wall
  solid(S, K.wall, gcx, gy + 10, GZF - T / 2, GW, GH - 10, T);        // header over the 10 m opening
  solid(S, K.trim, gcx, gy + GH, gcz, GW + 0.6, 0.8, GD + 0.6);       // roof slab (top at 13.8)
  // glossy floor + bay lines
  const floorMat = new THREE.MeshStandardMaterial({ color: '#15161e', roughness: 0.2, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  F.add(floorMat, flatPlane(GW / 2 - 1, GD / 2 - 0.5, 6), gcx, gy + 0.03, gcz + 0.5);
  for (const x of [-79.5, -70.5, -61.5, -52.5, -43.5]) quad(x, -51, 0.1, 15, 0, M.paint, gy + 0.05, 1);
  quad(-61.5, -36.2, 18, 0.12, 0, M.yellow, gy + 0.05, 1);
  // neon outline: pink on the front, cyan around the roof and back corners
  const rt = gy + GH + 0.4, o = 0.45;
  for (const x of [GX0 - 0.2, GX1 + 0.2]) G.box(K.pink, x, gy + GH / 2, GZF + 0.2, 0.3, GH, 0.3);
  G.box(K.pink, gcx, gy + 9.85, GZF + 0.2, GW, 0.3, 0.3);
  G.box(K.pink, gcx, rt, GZF + o, GW + 1.2, 0.3, 0.3);
  G.box(K.cyan, gcx, rt, GZB - o, GW + 1.2, 0.3, 0.3);
  for (const x of [GX0 - o, GX1 + o]) G.box(K.cyan, x, rt, gcz, 0.3, 0.3, GD + 1.2);
  for (const x of [GX0 - 0.2, GX1 + 0.2]) G.box(K.cyan, x, gy + GH / 2, GZB - 0.2, 0.3, GH, 0.3);
  // ceiling tubes
  for (const x of [-77, -67, -57, -47, -37]) G.box(K.cyan, x, gy + GH - 0.3, gcz, 0.25, 0.2, GD - 8);
  // big "NEON GARAGE" sign on the roof edge
  const sy = gy + GH + 0.8;
  solid(S, K.darkSteel, gcx, sy, GZF - 1.2, 37, 9.6, 0.5, 0, 'metal');
  for (const x of [-72, -57, -42]) {
    S.box(K.darkSteel, x, sy + 4.5, GZF - 3.2, 0.35, 9, 0.35);
    S.box(K.darkSteel, x, sy + 7, GZF - 2.3, 0.3, 0.3, 1.8);
  }
  const signTex = neonSignTex('NEON GARAGE');
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 1.5, roughness: 0.6 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(36, 9), signMat);
  sign.position.set(gcx, sy + 4.8, GZF - 0.93);
  scene.add(sign);
  for (const yy of [sy + 0.15, sy + 9.55]) G.box(K.pink, gcx, yy, GZF - 0.85, 37.4, 0.3, 0.3);
  for (const s of [-1, 1]) G.box(K.pink, gcx + s * 18.65, sy + 4.8, GZF - 0.85, 0.3, 9.6, 0.3);
  world.anim.push((t) => { signMat.emissiveIntensity = (t % 7.3) < 0.12 || ((t % 7.3) > 0.25 && (t % 7.3) < 0.32) ? 0.35 : 1.5; });
  // two-post car lifts along the back wall
  for (const lx of [-74, -60]) {
    for (const s of [-1, 1]) {
      solid(S, K.steel, lx + s * 2.6, gy, -72, 0.6, 4.2, 0.6, 0, 'metal');
      G.box(K.purple, lx + s * 2.6, gy + 2.1, -71.65, 0.1, 3.6, 0.1);
    }
    S.box(K.steel, lx, gy + 4.4, -72, 5.8, 0.4, 0.6);
  }
  // tool chests on the west wall + tyre stacks
  for (const z of [-66, -60, -54]) {
    solid(S, K.red, -82.45, gy, z, 0.9, 1.3, 2.2, 0, 'metal');
    G.box(K.amber, -81.98, gy + 1.22, z, 0.05, 0.08, 2.0);
  }
  for (const [x, z] of [[-81.6, -78.6], [-79.4, -79.8], [-81.6, -76.2]]) {
    for (let i = 0; i < 4; i++) S.add(K.rubber, new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14), x, gy + 0.15 + i * 0.31, z);
    collideBox(x, gy + 0.62, z, 0.42, 0.62, 0.42, 0, { surface: 'concrete' });
  }
  // glass-fronted office in the back corner (its windows break)
  solid(S, K.trim, -35.5, gy, -76.5, 9, 4, 9);
  G.box(K.pink, -35.5, gy + 4.05, -71.95, 9, 0.12, 0.12);
  if (d && typeof d.paneAt === 'function') {
    for (const x of [-38, -35.5, -33]) d.paneAt(new THREE.Vector3(x, gy + 2.2, -71.97), 0, 2.2, 1.8);
    for (const z of [-78.5, -74.5]) d.paneAt(new THREE.Vector3(-40.03, gy + 2.2, z), Math.PI / 2, 2.6, 1.8);
  }

  // ---- palm trees with glowing trunks along the two plaza streets ----
  const trunkT = new THREE.CylinderGeometry(0.26, 0.42, 9, 8); trunkT.translate(0, 4.5, 0);
  const frondT = new THREE.BoxGeometry(0.9, 0.07, 4.6); frondT.translate(0, 0, 2.3);
  const palm = (x, z, i) => {
    const y = groundY(x, z), lean = 0.05 + (i % 3) * 0.035, la = i * 2.1;
    S.add(K.trunk, trunkT.clone(), x, y, z, la, lean);
    const tx = 9 * Math.sin(lean) * Math.sin(la), ty = 9 * Math.cos(lean), tz = 9 * Math.sin(lean) * Math.cos(la);
    for (let k = 0; k < 7; k++) S.add(K.frond, frondT.clone(), x + tx, y + ty, z + tz, la + k * Math.PI * 2 / 7, 0.4 + (k % 2) * 0.2);
    collideBox(x, y + 4.5, z, 0.4, 4.5, 0.4, 0, { surface: 'wood', grip: GRIP.wood });
  };
  let pi = 0;
  for (const dd of [32, 58, 84]) for (const a of [-1, 1]) for (const b of [-1, 1]) {
    palm(a * 14, b * dd, pi++);                                     // along street x = 0
    const px = a * dd, pz = b * 14;                                 // along street z = 0
    if (px < -25 && pz < 0) continue;                               // keep the garage forecourt clear
    palm(px, pz, pi++);
  }
  // ---- neon light poles at the pad corners ----
  for (const [x, z] of [[22, 22], [-22, 22], [22, -22], [-22, -22]]) {
    const y = groundY(x, z);
    S.add(K.darkSteel, new THREE.CylinderGeometry(0.16, 0.22, 10, 8), x, y + 5, z);
    G.box(K.pink, x, y + 5, z, 0.52, 8.5, 0.07, Math.atan2(x, z));
    G.add(K.cyan, new THREE.TorusGeometry(0.8, 0.09, 6, 24), x, y + 10.1, z, 0, Math.PI / 2);
    G.add(K.cyan, new THREE.SphereGeometry(0.28, 10, 6), x, y + 10.25, z);
    collideBox(x, y + 5, z, 0.25, 5, 0.25, 0, { surface: 'metal', grip: GRIP.metal });
  }

  // ---- food trucks (north-east block), pushable/launchable targets ----
  const truck = buildTruckGeos();
  const truckPaint = [new THREE.MeshStandardMaterial({ color: '#2b2f6b', roughness: 0.35, metalness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: '#c93a7a', roughness: 0.35, metalness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: '#e8b32a', roughness: 0.35, metalness: 0.5 })];
  const awnings = [new THREE.MeshStandardMaterial({ color: '#ffe14a', roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: '#3ef0ff', roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: '#ff5fd8', roughness: 0.6 })];
  const truckGlow = [K.yellow, K.cyan, K.pink];
  [[30, 72], [52, 72], [74, 72]].forEach(([x, z], i) => {
    const g = new THREE.Group();
    const parts = [[truck.paint, truckPaint[i], true], [truck.dark, K.rubber, true], [truck.awning, awnings[i], true], [truck.glow, truckGlow[i], false]];
    for (const [geo, mat, cast] of parts) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); }
    const r = K.atlas.uvOf(LBL.tacos + i);
    const lp = [];
    for (const s of [-1, 1]) { const p = labelPlane(3.3, 0.8, r); p.rotateY(s * Math.PI / 2); p.translate(s * 0.09, 3.5, -0.95); lp.push(p); }
    let lg = null;
    try { lg = mergeGeometries(lp, false); } catch (e) { lg = null; }
    if (lg) g.add(new THREE.Mesh(lg, K.atlasMat));
    g.position.set(x, groundY(x, z), z);
    g.rotation.y = Math.PI / 2;     // long axis along x, serving hatch faces -z (the benches and the pad)
    scene.add(g);
    if (d && typeof d.target === 'function') d.target(g, new THREE.Vector3(1.25, 1.6, 3.65), 3500, 1.6);
    else collideBox(x, groundY(x, z) + 1.6, z, 1.25, 1.6, 3.65, Math.PI / 2, { surface: 'metal', grip: GRIP.metal });
  });

  // ---- neon fountain (north-west block) ----
  {
    const fx = -50, fz = 50, y = groundY(fx, fz);
    S.add(K.trim, new THREE.CylinderGeometry(4.5, 4.7, 0.7, 32), fx, y + 0.35, fz);
    collideBox(fx, y + 0.35, fz, 4.1, 0.35, 4.1, 0, { surface: 'concrete' });
    const waterMat = new THREE.MeshStandardMaterial({ color: '#04121a', emissive: '#3ef0ff', emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.3 });
    G.add(waterMat, new THREE.CircleGeometry(4.15, 32), fx, y + 0.62, fz, 0, -Math.PI / 2);
    G.add(K.pink, new THREE.TorusGeometry(4.6, 0.12, 6, 40), fx, y + 0.72, fz, 0, Math.PI / 2);
    G.add(K.purple, new THREE.CylinderGeometry(0.3, 0.5, 3.6, 12), fx, y + 2.4, fz);
    G.add(K.cyan, new THREE.SphereGeometry(0.6, 14, 8), fx, y + 4.4, fz);
    collideBox(fx, y + 2.1, fz, 0.5, 2.1, 0.5, 0, { surface: 'metal', grip: GRIP.metal });
    world.anim.push((t) => { waterMat.emissiveIntensity = 0.8 + Math.sin(t * 2.1) * 0.3; });
  }

  // ---- benches (pushable props) ----
  const benchGeo = buildBenchGeo();
  const benchAt = (x, z, yaw) => {
    const m = new THREE.Mesh(benchGeo, K.bench);
    m.position.set(x, groundY(x, z), z); m.rotation.y = yaw;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    if (d && typeof d.prop === 'function') d.prop(m, new THREE.Vector3(0.9, 0.5, 0.3), 45);
    else collideBox(x, m.position.y + 0.5, z, 0.9, 0.5, 0.3, yaw, { surface: 'metal' });
  };
  for (const x of [28, 44, 60, 76]) benchAt(x, 52, 0);                                  // facing the food trucks
  benchAt(-50, 41, 0); benchAt(-50, 59, Math.PI); benchAt(-59, 50, Math.PI / 2); benchAt(-41, 50, -Math.PI / 2);   // round the fountain
  for (const x of [30, 52]) benchAt(x, -46, Math.atan2(-x, 46));                        // facing the pad

  // ---- chargers + parking bays (south-east block) ----
  for (let x = 25; x <= 85; x += 10) quad(x, -78, 0.1, 6, 0, M.paint, groundY(x, -78) + 0.045, 1);
  for (let x = 30; x <= 80; x += 10) {
    const y = groundY(x, -86);
    solid(S, K.white, x, y, -86, 0.6, 1.8, 0.5, 0, 'metal');
    G.box(K.green, x, y + 1.55, -85.73, 0.4, 0.5, 0.05);
  }
  if (typeof world.sign === 'function') world.sign(40, -24, 0, ['NEON CITY', 'keys 1-8 teleport · M for the map'], { w: 16, h: 4, stripe: '#ff2bd6' });

  S.flush(); G.flush(); F.flush();
}

// food truck geometry, local: long axis z, serving hatch on +x, origin at ground centre
function buildTruckGeos() {
  const mk = (list) => {
    const geos = list.map(([geo, x, y, z, rx = 0, ry = 0, rz = 0]) => {
      _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z);
      return geo.applyMatrix4(_m.compose(_p, _q, _one));
    });
    let g = null;
    try { g = mergeGeometries(geos, false); } catch (e) { g = null; }
    return g || geos[0];
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const zs = -0.55;   // centre the whole truck on its collision box
  const paint = mk([[B(2.4, 2.5, 6.2), 0, 1.8, 0 + zs], [B(2.3, 1.5, 1.1), 0, 1.3, 3.65 + zs], [B(2.0, 0.08, 4.4), 0, 3.09, -0.4 + zs]]);
  const wheels = [];
  for (const [x, z] of [[1.1, 2.1], [-1.1, 2.1], [1.1, -2.1], [-1.1, -2.1]]) wheels.push([new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14), x, 0.45, z + zs, 0, 0, Math.PI / 2]);
  const dark = mk([[B(2.42, 0.7, 1.42), 0, 2.45, 2.4 + zs], [B(0.06, 1.1, 3.0), 1.21, 2.1, -0.8 + zs], [B(0.45, 0.08, 3.0), 1.42, 1.55, -0.8 + zs],
    [B(0.16, 0.9, 3.4), 0, 3.5, -0.4 + zs], ...wheels]);
  const awning = mk([[B(1.2, 0.06, 3.4), 1.8, 2.95, -0.8 + zs, 0, 0, -0.28]]);
  const glow = mk([[B(0.2, 0.08, 3.5), 0, 3.98, -0.4 + zs], [B(2.44, 0.07, 6.0), 0, 0.62, 0 + zs], [B(2.44, 0.07, 0.07), 0, 3.0, 3.07 + zs]]);
  return { paint, dark, awning, glow };
}
function buildBenchGeo() {
  const parts = [];
  const add = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g); };
  add(1.8, 0.08, 0.5, 0, 0.46, 0);
  add(1.8, 0.45, 0.06, 0, 0.78, -0.24);
  for (const x of [-0.78, 0.78]) add(0.08, 0.42, 0.46, x, 0.21, 0);
  let g = null;
  try { g = mergeGeometries(parts, false); } catch (e) { g = null; }
  return g || parts[0];
}

// ======================= Drag Avenue =======================
function buildDrag(world, K) {
  const scene = world.scene, M = K.M;
  const S = new Merger(scene, true), G = new Merger(scene, false), F = new Merger(scene, false);
  const quad = (...a) => world.quad(...a);
  const z0 = -150, xs = 150, y0 = groundY(410, z0);
  const q8 = xs + 201.168, q4 = xs + 402.336;

  // avenue surface (x 50..770, z -178..-122), wet dark asphalt
  const aMap = M.asphalt && M.asphalt.map ? M.asphalt.map : null;
  const aveMat = new THREE.MeshStandardMaterial({ map: aMap, color: aMap ? '#8a8c98' : '#2a2c34', roughness: 0.5, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  F.add(aveMat, flatPlane(360, 28, 8), 410, y0 + 0.022, z0);

  // ---- paint (batched by world.quad) ----
  quad(410, z0, 350, 0.12, 0, M.paint, y0 + 0.045, 1);                                  // centre line
  for (const s of [-1, 1]) quad(410, z0 + s * 14, 350, 0.15, 0, M.paint, y0 + 0.045, 1);   // lane edges
  for (const s of [-1, 1]) quad(410, z0 + s * 25.5, 355, 0.15, 0, M.yellow, y0 + 0.045, 1); // avenue edges
  for (const x of [xs, q8, q4]) quad(x, z0, 0.4, 14.5, 0, M.paint, y0 + 0.046, 1);          // start, 1/8, 1/4
  for (let i = 0; i < 29; i++) quad(xs - 1.2 - (i % 2) * 0.8, z0 - 14 + i, 0.4, 0.5, 0, M.paint, y0 + 0.047, 1);   // checkered start
  for (let i = 0; i < 29; i++) quad(720 + (i % 2) * 0.8, z0 - 14 + i, 0.4, 0.5, 0, M.paint, y0 + 0.047, 1);         // checkered finish
  for (const s of [-1, 1]) quad(xs + 18.29, z0 + s * 15.5, 0.2, 1.2, 0, M.yellow, y0 + 0.046, 1);                      // 60 ft
  for (let dd = 50; xs + dd < 715; dd += 50) {
    const big = dd % 100 === 0;
    for (const s of [-1, 1]) quad(xs + dd, z0 + s * 19.5, big ? 0.45 : 0.22, big ? 4.5 : 2.5, 0, M.yellow, y0 + 0.046, 1);
  }
  // brake-zone chevrons after the quarter mile
  for (let x = q4 + 35; x < 712; x += 26) for (const zc of [z0 - 7, z0 + 7]) for (const s of [-1, 1]) {
    const dx = 2.5, dz = -s * 3.5, len = Math.hypot(dx, dz);
    quad(x - 1.25, zc + s * 1.75, 0.3, len / 2, Math.atan2(dx, dz), M.yellow, y0 + 0.046, 1);
  }

  // ---- neon lining: glowing curb strips, runway lights, bollards, light poles ----
  F.add(K.linePink, flatPlane(358, 0.22, 1), 410, y0 + 0.05, -176.6);
  F.add(K.lineCyan, flatPlane(358, 0.22, 1), 410, y0 + 0.05, -123.4);
  for (let x = 92; x <= 718; x += 10) for (const z of [-169, -131]) F.add(K.runway, flatPlane(0.3, 0.3, 1), x, y0 + 0.055, z);
  const busy = [xs, xs + 6, q8, q4, 720, 250, 350, 450, 550, 650, 180, 280, 380, 480, 580, 680];
  for (let x = 60; x <= 762; x += 20) {
    if (crossStreet(x) < 13 || busy.some(b => Math.abs(b - x) < 4)) continue;
    for (const z of [-177.2, -122.8]) {
      const y = groundY(x, z);
      solid(S, K.darkSteel, x, y, z, 0.3, 0.9, 0.3, 0, 'metal');
      G.box(z < z0 ? K.pink : K.cyan, x, y + 0.98, z, 0.34, 0.16, 0.34);
    }
  }
  [180, 280, 380, 480, 580, 680].forEach((x, i) => {
    for (const z of [-177, -123]) {
      const y = groundY(x, z), toStrip = z < z0 ? 1 : -1;
      S.add(K.darkSteel, new THREE.CylinderGeometry(0.18, 0.25, 11, 8), x, y + 5.5, z);
      S.box(K.darkSteel, x, y + 10.85, z + toStrip * 2.25, 0.25, 0.25, 4.5);
      G.box(i % 2 ? K.cyan : K.pink, x, y + 10.66, z + toStrip * 2.4, 0.18, 0.1, 4.0);
      G.box(i % 2 ? K.pink : K.cyan, x, y + 5.2, z + toStrip * 0.26, 0.08, 9, 0.08);
      collideBox(x, y + 5.5, z, 0.25, 5.5, 0.25, 0, { surface: 'metal', grip: GRIP.metal });
    }
  });

  // ---- timing tree beside the start line (lamps face the driver) ----
  {
    const tx = xs + 6, tz = -127, ty = groundY(tx, tz);
    const tree = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), K.darkSteel); pole.position.y = 2; pole.castShadow = true; tree.add(pole);
    const lampGeo = new THREE.SphereGeometry(0.16, 12, 8);
    const lamps = [];
    for (let i = 0; i < 5; i++) {
      const col = i < 3 ? '#ffb547' : (i === 3 ? '#3dff7a' : '#ff3b2f');
      const m = new THREE.MeshStandardMaterial({ color: '#111', emissive: col, emissiveIntensity: 0.15 });
      const l = new THREE.Mesh(lampGeo, m);
      l.position.set(0, 3.6 - i * 0.42, 0.2); tree.add(l); lamps.push(m);
    }
    tree.position.set(tx, ty, tz); tree.rotation.y = -Math.PI / 2;
    scene.add(tree);
    world.dragTree = lamps;
    world.dragStart = { x: xs, z: z0 };
    collideBox(tx, ty + 2, tz, 0.3, 2, 0.3, 0, { surface: 'metal', grip: GRIP.metal });
    // attract-mode light sequence (decoration only)
    world.anim.push((t) => {
      const c = t % 8;
      for (let i = 0; i < 3; i++) lamps[i].emissiveIntensity = (c >= i * 0.5 && c < i * 0.5 + 0.5) ? 2.4 : 0.15;
      lamps[3].emissiveIntensity = (c >= 1.5 && c < 3.5) ? 2.6 : 0.15;
    });
  }

  // ---- gantries (posts outside the strip) ----
  const atlas = K.atlas, T = new Merger(scene, false);
  for (const [x, li] of [[xs, LBL.start], [q8, LBL.eighth], [q4, LBL.quarter]]) {
    const y = groundY(x, z0);
    for (const z of [-171, -129]) solid(S, K.darkSteel, x, groundY(x, z), z, 0.6, 9, 0.6, 0, 'metal');
    S.box(K.darkSteel, x, y + 8, z0, 0.8, 2.2, 43);
    G.box(K.pink, x, y + 6.84, z0, 0.3, 0.12, 42);
    G.box(K.cyan, x, y + 9.16, z0, 0.3, 0.12, 42);
    for (const s of [-1, 1]) T.add(K.atlasMat, labelPlane(24, 2, atlas.uvOf(li)), x + s * 0.42, y + 8, z0, s * Math.PI / 2);
  }
  // ---- distance boards (south side, facing the approaching driver) ----
  for (let k = 0; k < 5; k++) {
    const x = xs + (k + 1) * 100, z = -175, y = groundY(x, z);
    for (const s of [-1, 1]) solid(S, K.darkSteel, x, y, z + s * 1.7, 0.2, 3.0, 0.2, 0, 'metal');
    S.box(K.darkSteel, x, y + 2.2, z, 0.2, 1.6, 4);
    T.add(K.atlasMat, labelPlane(4, 1.6, atlas.uvOf(LBL.m100 + k)), x - 0.11, y + 2.2, z, -Math.PI / 2);
    G.box(K.yellow, x - 0.12, y + 3.05, z, 0.08, 0.08, 4);
  }
  // ---- glowing finish arch at x = 720 (posts 8 m clear of the strip) ----
  {
    const ax = 720, y = groundY(ax, z0);
    for (const z of [-177, -123]) {
      solid(S, K.darkSteel, ax, groundY(ax, z), z, 1.4, 14, 1.4, 0, 'metal');
      G.box(K.pink, ax, y + 5.6, z + (z < z0 ? 0.75 : -0.75), 0.3, 11.2, 0.12);
    }
    S.box(K.darkSteel, ax, y + 12.6, z0, 1.8, 2.8, 56);
    for (const s of [-1, 1]) {
      G.box(K.cyan, ax + s * 0.95, y + 11.25, z0, 0.12, 0.14, 54);
      G.box(K.cyan, ax + s * 0.95, y + 13.95, z0, 0.12, 0.14, 54);
      T.add(K.atlasMat, labelPlane(26, 2.2, atlas.uvOf(s < 0 ? LBL.finish : LBL.avenue)), ax + s * 0.92, y + 12.6, z0, s * Math.PI / 2);
    }
    // neon peak above the beam
    const dz = 27, dy = 6, len = Math.hypot(dz, dy), a = Math.atan2(dy, dz);
    G.box(K.pink, ax, y + 14 + dy / 2, z0 - dz / 2, 0.3, 0.3, len, 0, -a);
    G.box(K.pink, ax, y + 14 + dy / 2, z0 + dz / 2, 0.3, 0.3, len, 0, a);
    G.add(K.cyan, new THREE.SphereGeometry(0.7, 14, 8), ax, y + 14 + dy, z0);
  }

  S.flush(); G.flush(); F.flush(); T.flush();
}

// ======================= Skyscraper Rings =======================
function buildRings(world, K) {
  const scene = world.scene;
  // weaving along street x = 100 between the towers, 30-60 m up (well above the 10 m skyway at z = 400)
  const pts = [
    [100, 30, 420], [97, 37, 462], [103, 45, 504], [100, 54, 546], [97, 47, 588],
    [103, 39, 630], [100, 31, 672], [97, 41, 714], [103, 51, 756], [100, 60, 798],
  ];
  const ringGeo = new THREE.TorusGeometry(7, 0.55, 12, 48);
  const accentGeo = new THREE.TorusGeometry(7.85, 0.16, 8, 48);
  const accents = [K.pink, K.purple, K.green, K.yellow];
  const base = world.rings.length;
  pts.forEach((p, i) => {
    const pos = new THREE.Vector3(p[0], Math.max(p[1], groundY(p[0], p[2]) + 14), p[2]);
    const prev = i > 0 ? new THREE.Vector3(...pts[i - 1]) : pos.clone().add(new THREE.Vector3(0, 0, -40));
    const next = i < pts.length - 1 ? new THREE.Vector3(...pts[i + 1]) : pos.clone().add(pos.clone().sub(prev));
    const dir = next.clone().sub(prev); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const mat = new THREE.MeshStandardMaterial({ color: '#06151a', emissive: '#7fe3ff', emissiveIntensity: 0.6, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    scene.add(m);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: textTex([String(base + i + 1)], { bg: 'rgba(0,0,0,0)', fg: '#ffffff', w: 256, h: 128, sizes: [110] }), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    num.position.set(0, 9, 0); m.add(num);
    m.add(new THREE.Mesh(accentGeo, accents[i % accents.length]));   // fixed neon halo (main.js recolours the ring itself)
    world.rings.push({ pos, normal: dir, r: 7, mesh: m, mat, index: base + i });
  });
  // floating course banner over the street, facing the teleport spot (z = 330)
  const tex = textTex(['SKYSCRAPER RINGS', `fly up between the towers · rings 1-${pts.length}`], { w: 1024, h: 256, bg: '#0b0c16', fg: '#ffd6f6', fg2: '#bff8ff', stripe: '#ff2bd6' });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.6 }));
  banner.position.set(100, groundY(100, 392) + 17.5, 392); banner.rotation.y = Math.PI;
  scene.add(banner);
}
