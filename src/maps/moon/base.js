// The Moon: Lunar Base (HQ, air pad, habitat modules, radar dish, solar arrays, landing pad with a
// parked lunar module, flag, supply crates) and the Lunar Runway (paint, gantries, start lights).
// Owns AREAS.base and AREAS.runway, zones 'hq' (key 1) and 'drag' (key 2).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, OBB, GRIP } from '../../colliders.js';
import { heightAt } from '../../terrain.js';
import { ZONES, KEYS } from './layout.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- static geometry merger: one mesh per material ----------
class Merger {
  constructor() {
    this.map = new Map();
    this.frame = new THREE.Matrix4();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3();
  }
  // later adds are placed relative to (x, y, z) turned by yaw
  setFrame(x, y, z, yaw = 0) {
    this._q.setFromAxisAngle(Y_AXIS, yaw);
    this.frame.compose(this._p.set(x, y, z), this._q, this._s.set(1, 1, 1));
    return this;
  }
  clearFrame() { this.frame.identity(); return this; }
  push(geo, mat) {
    let arr = this.map.get(mat);
    if (!arr) { arr = []; this.map.set(mat, arr); }
    arr.push(geo);
  }
  // rotation order YXZ: roll (z), then tilt (x), then yaw (y); scale is applied first, in local space
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    this._e.set(rx, ry, rz, 'YXZ');
    this._q.setFromEuler(this._e);
    this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz)).premultiply(this.frame);
    geo.applyMatrix4(this._m);
    this.push(geo, mat);
    return geo;
  }
  // a round bar between two points (current frame)
  beam(mat, a, b, r, seg = 8) {
    const len = a.distanceTo(b);
    if (!(len > 1e-4)) return;
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    this._d.subVectors(b, a).normalize();
    this._q.setFromUnitVectors(Y_AXIS, this._d);
    this._m.compose(this._p.copy(a).add(b).multiplyScalar(0.5), this._q, this._s.set(1, 1, 1)).premultiply(this.frame);
    g.applyMatrix4(this._m);
    this.push(g, mat);
  }
  flush(parent, shadows = true) {
    for (const [mat, geos] of this.map) {
      let merged = null;
      try { merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false); } catch (e) { merged = null; }
      const list = merged ? [merged] : geos;   // fall back to one mesh per piece if merging fails
      for (const g of list) {
        const m = new THREE.Mesh(g, mat);
        m.castShadow = shadows; m.receiveShadow = true;
        parent.add(m);
      }
      if (merged && geos.length > 1) for (const g of geos) g.dispose();
    }
    this.map.clear();
  }
}

// ---------- colliders ----------
const _cq = new THREE.Quaternion();
function obb(x, y, z, hx, hy, hz, yaw = 0, surface = 'metal') {
  _cq.setFromAxisAngle(Y_AXIS, yaw);
  addCollider(new OBB(V(x, y, z), _cq, V(hx, hy, hz), { surface, grip: surface === 'metal' ? GRIP.metal : GRIP.concrete }));
}
// round thing standing on the ground: two crossed boxes (0 and 45 degrees)
function cylCol(x, y, z, r, h) {
  obb(x, y + h / 2, z, r * 0.74, h / 2, r * 0.74, 0);
  obb(x, y + h / 2, z, r * 0.74, h / 2, r * 0.74, Math.PI / 4);
}

// ---------- canvas textures (made inside build, never at import) ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function panelTex() {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#c3c9cf'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#132650'; g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#2e4f90';
    for (let i = 1; i < 8; i++) g.fillRect(6 + i * (w - 12) / 8 - 1, 6, 2, h - 12);
    for (let j = 1; j < 4; j++) g.fillRect(6, 6 + j * (h - 12) / 4 - 1, w - 12, 2);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(6, 6, w - 12, (h - 12) * 0.35);
  });
}
function crateTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#b9bec4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff6a1a'; g.fillRect(0, 52, w, 22);
    g.fillStyle = '#20252b'; g.fillRect(50, 56, 28, 14);
    g.strokeStyle = '#4b525a'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.lineWidth = 3; g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.stroke();
  });
}
// our own flag: checkered hoist, orange band, a white rocket roadster on navy
function flagTex() {
  return canvasTex(512, 320, (g, w, h) => {
    g.fillStyle = '#14243c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#111317' : '#f2f2ee'; g.fillRect(i * 40, j * 40, 40, 40); }
    g.fillStyle = '#ff6a1a'; g.fillRect(120, 0, 16, h);
    g.fillStyle = '#ffb547';
    g.beginPath(); g.moveTo(196, 186); g.lineTo(148, 202); g.lineTo(196, 214); g.closePath(); g.fill();
    g.fillStyle = '#f2f2ee';
    g.beginPath();
    g.moveTo(190, 216); g.lineTo(198, 186); g.lineTo(262, 176); g.lineTo(302, 142); g.lineTo(372, 138);
    g.lineTo(410, 172); g.lineTo(470, 182); g.lineTo(480, 216); g.closePath(); g.fill();
    for (const x of [236, 434]) {
      g.fillStyle = '#f2f2ee'; g.beginPath(); g.arc(x, 218, 24, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#14243c'; g.beginPath(); g.arc(x, 218, 14, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#7fe3ff'; g.fillRect(300, 150, 70, 16);
    g.fillStyle = '#f2f2ee';
    for (const [x, y] of [[180, 60], [260, 40], [350, 80], [440, 50], [480, 110], [220, 110]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  });
}
function labelTex(text) {
  return canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#101418'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7fe3ff'; g.fillRect(0, h - 12, w, 12);
    g.fillStyle = '#f4f6f8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 92px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    g.fillText(text, w / 2, h / 2 - 4);
  });
}

// ---------- painted 7-segment digits (text "up" = +x, "right" = +z, read by a driver heading +x) ----------
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function paintDigit(world, ch, x, z, H, W, s, mat, y) {
  const segs = SEG[ch] || '';
  for (const c of segs) {
    if (c === 'a') world.quad(x + H / 2 - s / 2, z, s / 2, W / 2, 0, mat, y, 1);
    else if (c === 'g') world.quad(x, z, s / 2, W / 2, 0, mat, y, 1);
    else if (c === 'd') world.quad(x - H / 2 + s / 2, z, s / 2, W / 2, 0, mat, y, 1);
    else if (c === 'b') world.quad(x + H / 4, z + W / 2 - s / 2, H / 4, s / 2, 0, mat, y, 1);
    else if (c === 'c') world.quad(x - H / 4, z + W / 2 - s / 2, H / 4, s / 2, 0, mat, y, 1);
    else if (c === 'e') world.quad(x - H / 4, z - W / 2 + s / 2, H / 4, s / 2, 0, mat, y, 1);
    else if (c === 'f') world.quad(x + H / 4, z - W / 2 + s / 2, H / 4, s / 2, 0, mat, y, 1);
  }
}
function paintNumber(world, str, x, z, mat) {
  const H = 4, W = 2.2, s = 0.36, pitch = 3.0;
  const y = heightAt(x, z) + 0.046;
  for (let i = 0; i < str.length; i++) paintDigit(world, str[i], x, z + (i - (str.length - 1) / 2) * pitch, H, W, s, mat, y);
}
// long line along x, split so each piece follows the ground height
function paintLine(world, x0, x1, z, hd, mat) {
  const n = Math.max(1, Math.ceil((x1 - x0) / 45)), seg = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const cx = x0 + seg * (i + 0.5);
    world.quad(cx, z, seg / 2, hd, 0, mat, heightAt(cx, z) + 0.045, 1);
  }
}
// chevron pointing +x with its tip at (x, z)
function paintChevron(world, x, z, mat) {
  const y = heightAt(x, z) + 0.046;
  world.quad(x - 1.5, z + 1.5, 2.12, 0.3, Math.PI / 4, mat, y, 1);
  world.quad(x - 1.5, z - 1.5, 2.12, 0.3, -Math.PI / 4, mat, y, 1);
}

export function build(world) {
  const M = world.mats;
  const scene = world.scene;

  // teleports and the air pad first, so they exist even if decoration below has a problem
  world.teleports.push({ key: 1, name: ZONES[KEYS[1]].name, x: 0, z: 0, yaw: Math.PI });
  world.teleports.push({ key: 2, name: ZONES[KEYS[2]].name, x: 150, z: -150, yaw: Math.PI / 2 });
  world.airPad(0, 0, 13, 'HQ');

  // shared materials for this part (created once)
  const mats = {
    win: new THREE.MeshStandardMaterial({ color: '#1a1408', emissive: '#ffd89a', emissiveIntensity: 1.25, roughness: 0.25, metalness: 0.2 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d2a23c', roughness: 0.32, metalness: 0.85 }),
    lmGrey: new THREE.MeshStandardMaterial({ color: '#c4c8cc', roughness: 0.5, metalness: 0.45 }),
    dish: new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }),
    green: new THREE.MeshStandardMaterial({ color: '#052010', emissive: '#3dff7a', emissiveIntensity: 2.2 }),
    panel: new THREE.MeshStandardMaterial({ map: panelTex(), roughness: 0.28, metalness: 0.55 }),
    flag: new THREE.MeshStandardMaterial({ map: flagTex(), roughness: 0.85, side: THREE.DoubleSide }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex(), roughness: 0.75, metalness: 0.15 }),
  };

  const B = new Merger();   // base statics
  const R = new Merger();   // runway statics
  const safe = (name, fn) => { try { fn(); } catch (e) { console.error(`moon/base: ${name} failed`, e); } };

  try {
    safe('habitat', () => buildHabitat(world, B, M, mats));
    safe('ops', () => buildOps(world, B, M));
    safe('radar', () => buildRadar(world, B, M, mats));
    safe('solar', () => buildSolar(B, M, mats));
    safe('lander', () => buildLanderPad(world, B, M, mats));
    safe('flag', () => buildFlag(B, M, mats));
    safe('crates', () => buildCrates(world, mats));
    safe('poles', () => { for (const [x, z] of [[30.1, 10.9], [14.5, -28.5], [-31.5, -5.6], [-17.4, 26.8]]) world.lightPole(x, z, 12); });
    safe('base sign', () => world.sign(-20, -48, Math.PI, ['LUNAR BASE', 'air pad · repairs · keys 1-8 teleport'], { w: 9, h: 3, stripe: '#7fe3ff' }));
    safe('runway', () => buildRunway(world, R, M, mats));
  } finally {
    B.flush(scene);
    R.flush(scene);
  }
  // paint quads are batched by the World; flush what we (and earlier parts) queued so the runway
  // paint shows even if the loader forgets. Later parts simply start a new batch.
  if (typeof world.flushBatches === 'function') safe('flush paint', () => world.flushBatches());
}

// ---------- habitat complex (east of the pad) ----------
function buildHabitat(world, B, M, mats) {
  const scene = world.scene;
  const dome = (x, z, r, wallH, windows) => {
    const y0 = heightAt(x, z);
    B.add(new THREE.CylinderGeometry(r + 0.35, r + 0.5, 0.4, 40), M.darkSteel, x, y0 + 0.2, z);
    B.add(new THREE.CylinderGeometry(r, r, wallH, 40), M.white, x, y0 + wallH / 2, z);
    B.add(new THREE.SphereGeometry(r, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.white, x, y0 + wallH, z);
    B.add(new THREE.TorusGeometry(r + 0.04, 0.13, 6, 64), M.glowCyan, x, y0 + wallH - 0.2, z, Math.PI / 2);
    const lat = 0.55;
    B.add(new THREE.TorusGeometry(r * Math.cos(lat) + 0.03, 0.12, 6, 64), M.glowCyan, x, y0 + wallH + r * Math.sin(lat), z, Math.PI / 2);
    for (const a of windows) B.add(new THREE.BoxGeometry(1.7, 1.0, 0.3), mats.win, x + Math.sin(a) * (r - 0.05), y0 + wallH * 0.55, z + Math.cos(a) * (r - 0.05), 0, a);
    cylCol(x, y0, z, r, wallH + 0.5 * r);
    cylCol(x, y0 + wallH + 0.5 * r, z, 0.68 * r, 0.3 * r);
    cylCol(x, y0 + wallH + 0.8 * r, z, 0.45 * r, 0.18 * r);
    return y0;
  };
  // horizontal module along yaw, its far end capped
  const module = (cx, cz, yaw, len, r, yC, winStep) => {
    const y0 = heightAt(cx, cz), s = Math.sin(yaw), c = Math.cos(yaw);
    const sx = c, sz = -s;   // side direction
    B.add(new THREE.CylinderGeometry(r, r, len, 28), M.white, cx, y0 + yC, cz, Math.PI / 2, yaw);
    B.add(new THREE.SphereGeometry(r, 24, 12), M.white, cx + s * len / 2, y0 + yC, cz + c * len / 2, 0, yaw, 0, 1, 1, 0.42);
    for (let t = -len / 2 + 3; t < len / 2 - 1; t += 5) B.add(new THREE.TorusGeometry(r + 0.05, 0.1, 6, 40), M.darkSteel, cx + s * t, y0 + yC, cz + c * t, 0, yaw);
    for (let t = -len / 2 + 4; t <= len / 2 - 2; t += winStep) for (const side of [-1, 1]) {
      B.add(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 14), mats.win, cx + s * t + sx * side * (r - 0.03), y0 + yC, cz + c * t + sz * side * (r - 0.03), 0, yaw, Math.PI / 2);
    }
    for (const side of [-1, 1]) {
      B.add(new THREE.BoxGeometry(0.22, 0.16, len - 1.5), M.glowCyan, cx + sx * side * r * 0.866, y0 + yC + r * 0.5, cz + sz * side * r * 0.866, 0, yaw);
    }
    const sh = yC - r + 0.6;
    for (const t of [-len * 0.3, len * 0.3]) B.add(new THREE.BoxGeometry(2 * r + 0.6, sh, 1.0), M.darkSteel, cx + s * t, y0 + sh / 2, cz + c * t, 0, yaw);
    obb(cx + s * 0.6, y0 + (yC + r) / 2, cz + c * 0.6, r - 0.1, (yC + r) / 2, len / 2 + 0.6, yaw);
  };
  // connecting tube between two ground points
  const tube = (ax, az, bx, bz, r, yC) => {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, y0 = heightAt(cx, cz), s = dx / len, c = dz / len;
    B.add(new THREE.CylinderGeometry(r, r, len, 18, 1, true), M.white, cx, y0 + yC, cz, Math.PI / 2, yaw);
    for (const e of [-1, 1]) B.add(new THREE.TorusGeometry(r + 0.06, 0.1, 6, 28), M.darkSteel, cx + s * e * (len / 2 - 0.8), y0 + yC, cz + c * e * (len / 2 - 0.8), 0, yaw);
    B.add(new THREE.BoxGeometry(0.25, 0.12, len - 1.8), M.glowCyan, cx, y0 + yC + r - 0.02, cz, 0, yaw);
    const sh = yC - r * 0.7;
    B.add(new THREE.BoxGeometry(r * 1.6, sh, 0.6), M.darkSteel, cx, y0 + sh / 2, cz, 0, yaw);
    obb(cx, y0 + (yC + r) / 2, cz, r + 0.1, (yC + r) / 2, len / 2, yaw);
  };

  // hub dome
  const hy = dome(66, 0, 11, 3, [0.44, 0.96, 2.18, 2.7, 3.58, 4.1, 5.76]);
  // airlock facing the pad
  B.add(new THREE.BoxGeometry(5, 3.6, 4.4), M.white, 53.8, hy + 1.8, 0);
  B.add(new THREE.BoxGeometry(5.2, 0.3, 4.6), M.darkSteel, 53.8, hy + 3.7, 0);
  B.add(new THREE.BoxGeometry(0.12, 2.6, 2.0), M.darkSteel, 51.25, hy + 1.3, 0);
  B.add(new THREE.BoxGeometry(0.1, 0.16, 2.6), M.glowCyan, 51.22, hy + 2.95, 0);
  obb(53.8, hy + 1.8, 0, 2.5, 1.8, 2.2);
  // north tower with mast + blinking beacon
  const ty = heightAt(66, 26);
  B.add(new THREE.CylinderGeometry(5.35, 5.5, 0.4, 32), M.darkSteel, 66, ty + 0.2, 26);
  B.add(new THREE.CylinderGeometry(5, 5, 10, 32), M.white, 66, ty + 5, 26);
  B.add(new THREE.SphereGeometry(5, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, 66, ty + 10, 26);
  for (const h of [3, 7.8]) B.add(new THREE.TorusGeometry(5.04, 0.12, 6, 48), M.glowCyan, 66, ty + h, 26, Math.PI / 2);
  for (const a of [0.4, 1.4, 2.4, -0.4, -1.4, -2.4]) {
    B.add(new THREE.BoxGeometry(1.4, 1.2, 0.3), mats.win, 66 + Math.sin(a) * 4.97, ty + 5.4, 26 + Math.cos(a) * 4.97, 0, a);
    B.add(new THREE.BoxGeometry(1.4, 1.2, 0.3), mats.win, 66 + Math.sin(a + 0.5) * 4.97, ty + 9.0, 26 + Math.cos(a + 0.5) * 4.97, 0, a + 0.5);
  }
  B.beam(M.steel, V(66, ty + 14.5, 26), V(66, ty + 18.4, 26), 0.09);
  B.beam(M.steel, V(64.8, ty + 16.6, 26), V(67.2, ty + 16.6, 26), 0.05);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), M.glowRed);
  beacon.position.set(66, ty + 18.6, 26); scene.add(beacon);
  world.anim.push((t) => { beacon.visible = (t % 1.6) < 0.45; });
  cylCol(66, ty, 26, 5, 12.5);
  cylCol(66, ty + 12.5, 26, 3.4, 2.2);
  // small dome west of the hub
  dome(44, 16, 6, 2, [0.17, 1.22, 3.32, 4.36, 5.41]);
  // tubes + modules
  tube(66, 10, 66, 22, 1.6, 2.2);
  tube(44 + 0.8088 * 5, 16 - 0.5882 * 5, 44 + 0.8088 * 16.7, 16 - 0.5882 * 16.7, 1.5, 2.1);
  module(66, -19.5, Math.PI, 21, 3.4, 3.8, 3);
  module(86, 0, Math.PI / 2, 22, 3.4, 3.8, 3);
}

// ---------- ops building with breakable windows (west of the pad) ----------
function buildOps(world, B, M) {
  const x = -52, z = 0, y0 = heightAt(x, z);
  B.add(new THREE.BoxGeometry(12, 5, 8), M.white, x, y0 + 2.5, z);
  B.add(new THREE.BoxGeometry(12.4, 0.4, 8.4), M.darkSteel, x, y0 + 5.2, z);
  B.add(new THREE.BoxGeometry(2, 0.8, 1.6), M.steel, x - 3, y0 + 5.8, z + 1.5);
  B.beam(M.steel, V(x + 3.5, y0 + 5.4, z - 2), V(x + 3.5, y0 + 9, z - 2), 0.07);
  B.add(new THREE.BoxGeometry(0.1, 0.2, 8), M.glowCyan, x + 6.05, y0 + 4.4, z);
  B.add(new THREE.BoxGeometry(12, 0.2, 0.1), M.glowCyan, x, y0 + 4.4, z - 4.05);
  for (const dz of [-2.6, 0, 2.6]) {
    B.add(new THREE.BoxGeometry(0.06, 1.8, 2.2), M.glass, x + 6.02, y0 + 2.9, z + dz);
    world.d.paneAt(V(x + 6.07, y0 + 2.9, z + dz), Math.PI / 2, 2.2, 1.8);
  }
  for (const dx of [-4, 4]) {
    B.add(new THREE.BoxGeometry(2.4, 1.8, 0.06), M.glass, x + dx, y0 + 2.9, z - 4.02);
    world.d.paneAt(V(x + dx, y0 + 2.9, z - 4.07), 0, 2.4, 1.8);
  }
  B.add(new THREE.BoxGeometry(1.8, 2.5, 0.12), M.darkSteel, x, y0 + 1.25, z - 4.04);
  obb(x, y0 + 2.5, z, 6, 2.5, 4, 0, 'concrete');
}

// ---------- radar dish (slowly turning) ----------
function buildRadar(world, B, M, mats) {
  const x = -72, z = -16, y0 = heightAt(x, z);
  B.add(new THREE.BoxGeometry(7, 2, 7), M.concrete, x, y0 + 1, z);
  B.add(new THREE.CylinderGeometry(0.9, 1.3, 9, 16), M.white, x, y0 + 6.5, z);
  B.add(new THREE.TorusGeometry(1.0, 0.1, 6, 24), M.glowCyan, x, y0 + 10.6, z, Math.PI / 2);
  obb(x, y0 + 1, z, 3.5, 1, 3.5, 0, 'concrete');
  obb(x, y0 + 6.5, z, 1.1, 4.5, 1.1);

  const head = new THREE.Group();
  head.position.set(x, y0 + 11, z);
  world.scene.add(head);
  const H = new Merger();
  H.add(new THREE.CylinderGeometry(1.7, 1.7, 0.7, 20), M.darkSteel, 0, 0.35, 0);
  for (const s of [-1, 1]) H.add(new THREE.BoxGeometry(0.4, 2.4, 1.0), M.darkSteel, s * 1.5, 1.7, 0);
  H.add(new THREE.CylinderGeometry(0.25, 0.25, 3.4, 10), M.steel, 0, 2.4, 0, 0, 0, Math.PI / 2);
  const tilt = 0.96;   // dish looks 35 degrees above the horizon
  const bowl = new THREE.SphereGeometry(12, 36, 6, 0, Math.PI * 2, 0, 0.5);
  bowl.rotateX(Math.PI); bowl.translate(0, 12.4, 0);
  H.add(bowl, mats.dish, 0, 2.4, 0, tilt);
  const back = new THREE.CylinderGeometry(1.2, 0.6, 0.8, 12); back.translate(0, 0.1, 0);
  H.add(back, M.darkSteel, 0, 2.4, 0, tilt);
  const feed = new THREE.CylinderGeometry(0.25, 0.4, 0.8, 12); feed.translate(0, 6.2, 0);
  H.add(feed, M.darkSteel, 0, 2.4, 0, tilt);
  const pivot = V(0, 2.4, 0), focus = V(0, 6.0, 0).applyAxisAngle(X_AXIS, tilt).add(pivot);
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3;
    const rim = V(Math.sin(a) * 5.4, 1.75, Math.cos(a) * 5.4).applyAxisAngle(X_AXIS, tilt).add(pivot);
    H.beam(M.steel, rim, focus, 0.07, 6);
  }
  H.flush(head);
  world.anim.push((t) => { head.rotation.y = t * 0.15; });
}

// ---------- solar arrays (north-west) ----------
function buildSolar(B, M, mats) {
  const rows = [[52, [-62, -55, -48, -41, -34, -27, -20]], [63, [-62, -55, -48, -41, -34, -27, -20]], [74, [-55, -48, -41, -34, -27, -20]]];
  for (const [z, xs] of rows) {
    const x0 = xs[0], x1 = xs[xs.length - 1], cx = (x0 + x1) / 2, hw = (x1 - x0) / 2 + 3.1;
    const yr = heightAt(cx, z);
    B.add(new THREE.CylinderGeometry(0.12, 0.12, hw * 2 - 0.4, 8), M.darkSteel, cx, yr + 2.2, z, 0, 0, Math.PI / 2);
    for (const x of xs) {
      const y0 = heightAt(x, z);
      B.add(new THREE.BoxGeometry(6.2, 0.12, 3.2), mats.panel, x, y0 + 2.3, z, -0.55);
      B.add(new THREE.CylinderGeometry(0.1, 0.13, 2.3, 8), M.darkSteel, x, y0 + 1.15, z);
      B.add(new THREE.BoxGeometry(0.6, 0.16, 0.6), M.concrete, x, y0 + 0.08, z);
    }
    obb(cx, yr + 1.65, z, hw, 1.65, 1.5);
  }
}

// ---------- landing pad with a parked lunar module (south-east) ----------
function buildLanderPad(world, B, M, mats) {
  const px = 34, pz = -64, padYaw = 0.5, y0 = heightAt(px, pz);
  const rot = (lx, lz, yaw) => [px + lx * Math.cos(yaw) + lz * Math.sin(yaw), pz - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
  world.quad(px, pz, 11, 11, padYaw, M.pad, y0 + 0.03, 8);
  const yl = y0 + 0.046;
  for (const s of [-1, 1]) {
    let [x, z] = rot(0, s * 10.2, padYaw); world.quad(x, z, 10.5, 0.3, padYaw, M.yellow, yl, 1);
    [x, z] = rot(s * 10.2, 0, padYaw); world.quad(x, z, 0.3, 10.5, padYaw, M.yellow, yl, 1);
  }
  for (let k = 0; k < 12; k++) {
    const th = k * Math.PI / 6;
    world.quad(px + Math.sin(th) * 7.8, pz + Math.cos(th) * 7.8, 2.19, 0.25, th, M.yellow, yl, 1);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [x, z] = rot(sx * 10.9, sz * 10.9, padYaw);
    B.add(new THREE.BoxGeometry(0.5, 0.15, 0.5), M.glowAmber, x, y0 + 0.075, z, 0, padYaw);
  }

  // lunar module (generic two-stage lander)
  const lmYaw = 0.9;
  B.setFrame(px, y0, pz, lmYaw);
  B.add(new THREE.CylinderGeometry(2.3, 2.3, 1.8, 8), mats.gold, 0, 2.6, 0, 0, Math.PI / 8);
  for (const h of [1.72, 3.48]) B.add(new THREE.CylinderGeometry(2.36, 2.36, 0.16, 8), M.darkSteel, 0, h, 0, 0, Math.PI / 8);
  B.add(new THREE.CylinderGeometry(0.45, 0.95, 1.1, 16, 1, true), M.darkSteel, 0, 1.15, 0);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, sa = Math.sin(a), ca = Math.cos(a);
    const foot = V(sa * 4.3, 0.42, ca * 4.3);
    B.beam(M.steel, V(sa * 2.1, 3.0, ca * 2.1), foot, 0.11);
    B.beam(M.steel, foot, V(Math.sin(a + 0.6) * 2.25, 1.8, Math.cos(a + 0.6) * 2.25), 0.06);
    B.beam(M.steel, foot, V(Math.sin(a - 0.6) * 2.25, 1.8, Math.cos(a - 0.6) * 2.25), 0.06);
    B.beam(M.steel, foot, V(sa * 4.35, 0.14, ca * 4.35), 0.09);
    B.add(new THREE.CylinderGeometry(0.55, 0.65, 0.16, 14), M.steel, sa * 4.35, 0.08, ca * 4.35);
  }
  B.add(new THREE.BoxGeometry(2.8, 2.0, 2.2), mats.lmGrey, 0, 4.5, 0.15);
  B.add(new THREE.BoxGeometry(2.2, 1.3, 0.7), mats.lmGrey, 0, 4.85, 1.4, -0.32);
  for (const s of [-1, 1]) B.add(new THREE.BoxGeometry(0.62, 0.5, 0.08), M.glass, s * 0.55, 5.12, 1.8, -0.32);
  B.add(new THREE.BoxGeometry(0.85, 1.0, 0.1), M.darkSteel, 0, 3.95, 1.3);
  B.add(new THREE.BoxGeometry(2.2, 1.5, 1.1), mats.gold, 0, 4.35, -1.45);
  B.add(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 14), M.darkSteel, 0, 5.75, 0.1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(new THREE.BoxGeometry(0.32, 0.32, 0.32), M.darkSteel, sx * 1.55, 5.3, 0.15 + sz * 1.0);
  B.beam(M.steel, V(1.0, 5.5, -0.5), V(1.35, 6.7, -0.85), 0.04);
  B.add(new THREE.CylinderGeometry(0.5, 0.06, 0.22, 14), M.white, 1.38, 6.85, -0.88);
  B.clearFrame();
  obb(px, y0 + 1.75, pz, 2.1, 1.75, 2.1, lmYaw);
  obb(px, y0 + 1.75, pz, 2.1, 1.75, 2.1, lmYaw + Math.PI / 4);
  {
    const [x, z] = rot(0, -0.4, lmYaw);
    obb(x, y0 + 4.5, z, 1.45, 1.05, 1.65, lmYaw);
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const [x, z] = rot(Math.sin(a) * 4.35, Math.cos(a) * 4.35, lmYaw);
    obb(x, y0 + 0.3, z, 0.6, 0.3, 0.6, lmYaw);
  }
}

// ---------- flag (our own design) ----------
function buildFlag(B, M, mats) {
  const x = 31.5, z = -6, y0 = heightAt(x, z);
  B.add(new THREE.BoxGeometry(1.2, 0.4, 1.2), M.concrete, x, y0 + 0.2, z);
  B.add(new THREE.CylinderGeometry(0.07, 0.09, 7.2, 10), M.steel, x, y0 + 3.6, z);
  B.add(new THREE.CylinderGeometry(0.035, 0.035, 3.15, 8), M.steel, x, y0 + 7.0, z + 1.55, Math.PI / 2);
  const g = new THREE.PlaneGeometry(3, 2, 12, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const px = p.getX(i); p.setZ(i, 0.07 * Math.sin(px * 4.2 + 0.5) + 0.03 * Math.sin(px * 9.1)); }
  g.computeVertexNormals();
  B.add(g, mats.flag, x, y0 + 6.0, z + 1.6, 0, -Math.PI / 2);
  obb(x, y0 + 3.6, z, 0.2, 3.6, 0.2);
}

// ---------- supply crates (pushable props) ----------
function buildCrates(world, mats) {
  const geo = new THREE.BoxGeometry(1.4, 1.2, 1.4); geo.translate(0, 0.6, 0);
  const spots = [[17.5, -51.5, 0.2], [19.4, -54.2, -0.3], [16.2, -54.8, 0.6], [48.5, -17, 0.1], [50.6, -19.3, 0.5], [47.4, -20.2, -0.2], [-42.5, -9, 0.3], [-40.4, -11.4, -0.4]];
  for (const [x, z, yaw] of spots) {
    const m = new THREE.Mesh(geo, mats.crate);
    m.position.set(x, heightAt(x, z), z); m.rotation.y = yaw;
    m.castShadow = true; m.receiveShadow = true;
    world.scene.add(m);
    world.d.prop(m, V(0.7, 0.6, 0.7), 45);
  }
}

// ---------- Lunar Runway: paint, gantries, start lights (no colliders in x 90..720, z -168..-132) ----------
function buildRunway(world, R, M, mats) {
  const z0 = -150, xs = 150, P = M.paint, Yw = M.yellow;
  // lane lines
  paintLine(world, 90, 720, z0, 0.12, P);
  for (const s of [-1, 1]) paintLine(world, 90, 720, z0 + s * 14, 0.15, P);
  for (const s of [-1, 1]) paintLine(world, 90, 720, z0 + s * 17.2, 0.12, Yw);
  // start / 1/8 / 1/4 mile lines
  const x8 = xs + 201.17, x4 = xs + 402.34;
  for (const x of [xs, x8, x4]) world.quad(x, z0, 0.4, 14.5, 0, P, heightAt(x, z0) + 0.046, 1);
  // checkered bands behind the start line and after the 1/4 mile line
  for (let i = 0; i < 28; i++) for (let r = 0; r < 2; r++) {
    if ((i + r) % 2) continue;
    const zz = z0 - 14 + 0.5 + i;
    world.quad(xs - 0.9 - r, zz, 0.5, 0.5, 0, P, heightAt(xs, zz) + 0.047, 1);
    world.quad(x4 + 0.9 + r, zz, 0.5, 0.5, 0, P, heightAt(x4, zz) + 0.047, 1);
  }
  // lane numbers before the start, staging arrows
  paintNumber(world, '1', xs - 14, z0 - 7, P);
  paintNumber(world, '2', xs - 14, z0 + 7, P);
  for (const x of [108, 124]) for (const s of [-1, 1]) paintChevron(world, x, z0 + s * 7, Yw);
  // distance markers every 100 m from the start line
  for (let d = 100; d <= 500; d += 100) {
    const x = xs + d;
    for (const s of [-1, 1]) {
      paintNumber(world, String(d), x - 4, z0 + s * 7, P);
      world.quad(x, z0 + s * 14, 0.3, 1.6, 0, Yw, heightAt(x, z0 + s * 14) + 0.047, 1);
    }
  }
  // braking zone + end of runway
  for (let x = 590; x <= 680; x += 30) for (const s of [-1, 1]) paintChevron(world, x, z0 + s * 7, Yw);
  for (const x of [708, 712]) world.quad(x, z0, 0.6, 17, 0, Yw, heightAt(x, z0) + 0.047, 1);

  // flush edge lights (visual only, no colliders)
  for (let x = 95; x <= 716; x += 31) for (const s of [-1, 1]) {
    const z = z0 + s * 16.6;
    R.add(new THREE.BoxGeometry(0.45, 0.1, 0.45), M.glowCyan, x, heightAt(x, z) + 0.05, z);
  }
  for (let i = 0; i < 8; i++) {
    const z = z0 - 14 + i * 4;
    R.add(new THREE.BoxGeometry(0.5, 0.1, 0.5), mats.green, 92, heightAt(92, z) + 0.05, z);
    R.add(new THREE.BoxGeometry(0.5, 0.1, 0.5), M.glowRed, 718, heightAt(718, z) + 0.05, z);
  }

  // overhead gantries: posts beside the strip (z -171 / -129), beam overhead without a collider
  for (const [x, label] of [[xs, 'START'], [x8, '1/8 MILE'], [x4, '1/4 MILE']]) {
    for (const s of [-1, 1]) {
      const z = z0 + s * 21, y = heightAt(x, z);
      R.add(new THREE.BoxGeometry(0.6, 9, 0.6), M.darkSteel, x, y + 4.5, z);
      R.add(new THREE.BoxGeometry(1.4, 0.3, 1.4), M.concrete, x, y + 0.15, z);
      obb(x, y + 4.5, z, 0.35, 4.5, 0.35);
    }
    const y0 = heightAt(x, z0);
    R.add(new THREE.BoxGeometry(0.8, 2.2, 43), M.darkSteel, x, y0 + 8, z0);
    const tex = labelTex(label);
    const lm = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.4, roughness: 0.7 });
    for (const s of [-1, 1]) R.add(new THREE.PlaneGeometry(30, 1.9), lm, x + s * 0.42, y0 + 8, z0, 0, s * Math.PI / 2);
  }

  // drag-race start lights: one tree on each side of the strip, just past the line, turned to the car
  const lampCols = ['#ffb547', '#ffb547', '#ffb547', '#3dff7a', '#ff3b2f'];
  const lampMats = lampCols.map(c => new THREE.MeshStandardMaterial({ color: '#111111', emissive: c, emissiveIntensity: 0.15 }));
  for (const tz of [-173, -127]) {
    const tx = 160, ty = heightAt(tx, tz);
    const face = Math.atan2(xs - tx, z0 - tz);
    R.setFrame(tx, ty, tz, face);
    R.add(new THREE.BoxGeometry(1.2, 0.4, 1.2), M.concrete, 0, 0.2, 0);
    R.add(new THREE.BoxGeometry(0.35, 6.2, 0.35), M.darkSteel, 0, 3.1, 0);
    R.add(new THREE.BoxGeometry(1.0, 3.8, 0.5), M.darkSteel, 0, 4.3, 0.25);
    for (let i = 0; i < 5; i++) R.add(new THREE.SphereGeometry(0.27, 14, 10), lampMats[i], 0, 5.8 - i * 0.7, 0.6);
    R.clearFrame();
    obb(tx, ty + 3.1, tz, 0.6, 3.1, 0.6);
  }
  world.anim.push((t) => {
    const ph = t % 7;
    for (let i = 0; i < 3; i++) lampMats[i].emissiveIntensity = (ph >= 3 + i * 0.5 && ph < 4.5) ? 2.6 : 0.15;
    lampMats[3].emissiveIntensity = (ph >= 4.5 && ph < 6.5) ? 2.8 : 0.15;
    lampMats[4].emissiveIntensity = ph < 2.6 ? 1.8 : 0.15;
  });
  world.dragTree = lampMats;
  world.dragStart = { x: xs, z: z0 };

  // signs beside the strip (posts outside z -168..-132)
  world.sign(108, -176, -Math.PI / 2, ['LUNAR RUNWAY', 'stop on the line · Shift + W'], { w: 8, h: 2.6 });
  for (let d = 100; d <= 500; d += 100) world.sign(xs + d, z0 - 24, Math.PI / 2, [`${d} m`], { w: 4, h: 1.6, post: 1.5, sizes: [150] });
}
