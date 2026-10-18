// Neon City: the Demolition Yard (zone 'yard', teleport key 7). A fenced lot (x 312..688, z -688..-312)
// inside RESERVED.yard with a wide entrance gap in the north fence facing the z = -300 street.
// Launcher pickups at the entrance, a jump ramp, destructible apartment blocks with glass, brick walls,
// a crate tower, a water tower, barrels, junk cars and crushed-car stacks (all through world.d), a static
// tower crane with a hanging wrecking ball, emissive floodlights and a neon "DEMOLITION YARD" gate sign.
// Static decoration is merged into one mesh per material; only emissive materials glow (no real lights).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, OBB, GRIP } from '../../colliders.js';
import { heightAt } from '../../terrain.js';
import { makeLauncherModel } from '../../world.js';
import { ZONES, KEYS } from './layout.js';

// lot bounds (fence line) and the entrance gap in the north fence
const X0 = 312, X1 = 688, Z0 = -688, Z1 = -312, GAP0 = 470, GAP1 = 530;
const FH = 3.2;   // fence height

// Ragdoll target dummies (placed by the integrator). Every spot sits in the middle of a 10 m collider
// grid cell (x, z ending in 5) whose whole cell is free of colliders, because Ragdolls.populate() skips a
// spot when queryBox() (cell-granular) finds anything in that cell.
export const dollSpots = [
  [495, -445], [515, -455], [485, -465], [505, -485, 'boss'], [465, -425], [395, -475], [605, -475],
  [595, -565], [405, -575], [500, -625], [565, -615], [435, -615], [625, -415], [375, -395],
];

// scratch objects (no textures or materials at import time)
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), ZAX = new THREE.Vector3(0, 0, 1);

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
// transform a geometry into place (Euler angles, default order XYZ) and add it to a merge list
function put(list, geo, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  _e.set(rx, ry, rz, order); _q.setFromEuler(_e);
  _m4.compose(_v.set(x, y, z), _q, ONE);
  geo.applyMatrix4(_m4);
  list.push(geo);
  return geo;
}
// a square bar of thickness t from a to b
function strut(list, ax, ay, az, bx, by, bz, t) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  if (len < 1e-3) return;
  const g = new THREE.BoxGeometry(t, t, len);
  _q.setFromUnitVectors(ZAX, _v.set(dx / len, dy / len, dz / len));
  _m4.compose(_v.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, ONE);
  g.applyMatrix4(_m4);
  list.push(g);
}
// brick-row helper (same as world.js layRow)
function layRow(a0, a1, offset, fn, unit = 1.0) {
  let a = a0;
  let first = offset > 0 ? Math.min(offset, a1 - a0) : unit;
  while (a < a1 - 0.01) {
    const b = Math.min(a1, a + first);
    fn(a, b);
    a = b; first = unit;
  }
}
const yawQ = (yaw) => new THREE.Quaternion().setFromAxisAngle(UP, yaw);
// structure-local (lx, lz) to world (same maths as Destruction.block)
const toWorld = (cx, cz, yaw, lx, lz) => [cx + Math.cos(yaw) * lx + Math.sin(yaw) * lz, cz - Math.sin(yaw) * lx + Math.cos(yaw) * lz];

export function build(world) {
  const scene = world.scene, d = world.d, M = world.mats || {};
  const warn = (what, e) => { try { console.warn('neon/yard ' + what, e); } catch (_) { /* ignore */ } };
  const safe = (what, fn) => { try { fn(); } catch (e) { warn(what, e); } };

  // teleport first so key 7 works even if a later section fails
  const key = Number(Object.keys(KEYS).find(k => KEYS[k] === 'yard')) || 7;
  world.teleports.push({ key, name: (ZONES.yard && ZONES.yard.name) || 'Demolition Yard', x: 500, z: -310, yaw: Math.PI });

  // ---------- shared materials (created once) ----------
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const darkSteel = M.darkSteel || std({ color: '#3b4148', roughness: 0.5, metalness: 0.7 });
  const concrete = M.concrete || std({ color: '#c7c2b6', roughness: 0.92 });
  const glassMat = M.glass || std({ color: '#1b2a38', roughness: 0.08, metalness: 0.9 });
  const rubber = M.rubber || std({ color: '#16171a', roughness: 0.9 });
  const glowAmber = M.glowAmber || std({ color: '#201405', emissive: '#ffb547', emissiveIntensity: 2.2 });
  const glowRed = M.glowRed || std({ color: '#200505', emissive: '#ff3b2f', emissiveIntensity: 2.4 });
  const craneYellow = std({ color: '#e8a90c', roughness: 0.55, metalness: 0.35 });
  const neonPink = std({ color: '#1a0414', emissive: '#ff2bd6', emissiveIntensity: 2.6 });
  const neonCyan = std({ color: '#04161a', emissive: '#3ff2ff', emissiveIntensity: 2.4 });
  const lampMat = std({ color: '#202428', emissive: '#eaf4ff', emissiveIntensity: 3.2, side: THREE.DoubleSide });

  // merge lists: one mesh per material at the end
  const L = { dark: [], yellow: [], concrete: [], pink: [], cyan: [], lamp: [], red: [], glass: [], fence: [], cones: [], pools: [], containers: [], ball: [] };
  const flush = (list, mat, cast = true, receive = true) => {
    if (!list.length) return null;
    let g = null;
    try { g = mergeGeometries(list, false); } catch (e) { g = null; }
    if (!g) { // fallback: individual meshes (never lose the visuals)
      for (const x of list) { const m = new THREE.Mesh(x, mat); m.castShadow = cast; m.receiveShadow = receive; scene.add(m); }
      list.length = 0;
      return null;
    }
    for (const x of list) x.dispose();
    list.length = 0;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    scene.add(m);
    return m;
  };
  const obb = (x, y, z, hx, hy, hz, yaw = 0, surface = 'metal', grip = GRIP.metal) =>
    addCollider(new OBB(new THREE.Vector3(x, y, z), yawQ(yaw), new THREE.Vector3(hx, hy, hz), { surface, grip }));

  // ---------- lot surface (gravel) and paint ----------
  safe('lot', () => {
    const tex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#3d3a35'; g.fillRect(0, 0, w, h);
      const img = g.getImageData(0, 0, w, h);
      if (img && img.data) {
        for (let i = 0; i < img.data.length; i += 4) {
          const n = (Math.random() - 0.5) * 46 + (Math.random() < 0.05 ? 30 : 0);
          img.data[i] += n; img.data[i + 1] += n * 0.95; img.data[i + 2] += n * 0.85;
        }
        g.putImageData(img, 0, 0);
      }
      g.globalAlpha = 0.12;
      for (let i = 0; i < 18; i++) { g.fillStyle = Math.random() < 0.6 ? '#0c0b0a' : '#6a6458'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 8 + Math.random() * 40, 0, 7); g.fill(); }
      g.globalAlpha = 1;
    });
    const lotMat = std({ map: tex, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const W = X1 - X0, D = Z1 - Z0;
    const geo = new THREE.PlaneGeometry(W, D);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 10, uv.getY(i) * D / 10);
    const lot = new THREE.Mesh(geo, lotMat);
    lot.position.set((X0 + X1) / 2, 0.05, (Z0 + Z1) / 2);
    lot.receiveShadow = true;
    scene.add(lot);
    // dashed guide line from the gate to the ramp (batched yellow paint)
    if (typeof world.quad === 'function' && M.yellow) {
      for (let z = -330; z > -380; z -= 12) world.quad(500, z, 0.25, 3, 0, M.yellow, 0.07, 1);
      for (const x of [GAP0 + 1, GAP1 - 1]) world.quad(x, -318, 0.4, 5, 0, M.yellow, 0.07, 1);
    }
  });

  // ---------- chain-link fence (merged visuals, one collider per straight segment) ----------
  safe('fence', () => {
    const linkTex = canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#d0d6dc'; g.lineWidth = 3.2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h);
      g.moveTo(-w / 2, h / 2); g.lineTo(w / 2, -h / 2); g.moveTo(w / 2, h * 1.5); g.lineTo(w * 1.5, h / 2); g.stroke();
    });
    const fenceMat = std({ map: linkTex, color: '#b8c0c8', alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
    const segs = [[X0, Z1, GAP0, Z1], [GAP1, Z1, X1, Z1], [X0, Z0, X1, Z0], [X0, Z0, X0, Z1], [X1, Z0, X1, Z1]];
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len, phi = Math.atan2(-uz, ux);   // local +x along the segment
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const pg = new THREE.PlaneGeometry(len, FH - 0.1);
      const uv = pg.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.7, uv.getY(i) * (FH - 0.1) / 0.7);
      put(L.fence, pg, mx, 0.05 + (FH - 0.1) / 2, mz, 0, phi, 0);
      put(L.dark, new THREE.BoxGeometry(len, 0.07, 0.07), mx, FH, mz, 0, phi, 0);
      const n = Math.max(1, Math.ceil(len / 4));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        put(L.dark, new THREE.BoxGeometry(0.12, FH + 0.2, 0.12), ax + dx * t, (FH + 0.2) / 2, az + dz * t);
      }
      obb(mx, FH / 2, mz, len / 2, FH / 2, 0.3, phi, 'metal', GRIP.metal);
    }
    flush(L.fence, fenceMat, false, false);
  });

  // ---------- entrance gantry with the neon sign ----------
  safe('gate', () => {
    const gz = Z1, PH = 14;
    for (const x of [GAP0 - 4, GAP1 + 4]) {
      put(L.dark, new THREE.BoxGeometry(1.2, PH, 1.2), x, PH / 2, gz);
      for (const s of [-1, 1]) put(L.pink, new THREE.BoxGeometry(0.14, PH - 2, 0.14), x + s * 0.45, PH / 2, gz + 0.65);
      put(L.cyan, new THREE.BoxGeometry(1.3, 0.16, 1.3), x, 2.2, gz);
      obb(x, PH / 2, gz, 0.6, PH / 2, 0.6);
    }
    const span = (GAP1 + 4) - (GAP0 - 4) + 1.2;
    put(L.dark, new THREE.BoxGeometry(span, 1.2, 1.2), 500, 12.6, gz);
    put(L.dark, new THREE.BoxGeometry(38, 5.2, 0.4), 500, 15.8, gz);
    // neon tube frame on both faces
    for (const s of [-1, 1]) {
      const fz = gz + s * 0.27;
      put(L.pink, new THREE.BoxGeometry(37.6, 0.16, 0.12), 500, 18.2, fz);
      put(L.pink, new THREE.BoxGeometry(37.6, 0.16, 0.12), 500, 13.4, fz);
      put(L.pink, new THREE.BoxGeometry(0.16, 4.8, 0.12), 500 - 18.8, 15.8, fz);
      put(L.pink, new THREE.BoxGeometry(0.16, 4.8, 0.12), 500 + 18.8, 15.8, fz);
      put(L.cyan, new THREE.BoxGeometry(span - 1.4, 0.12, 0.1), 500, 12.0, gz + s * 0.62);
    }
    obb(500, 15.5, gz, span / 2, 3, 0.6);
    // text: canvas with a pink glow; black parts emit nothing
    const text = 'DEMOLITION YARD';
    const tex = canvasTex(2048, 256, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const font = (px) => `800 ${px}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
      let px = 196; g.font = font(px);
      const mw = (g.measureText && (g.measureText(text) || {}).width) || 0;
      if (mw > w * 0.9) { px = Math.floor(px * w * 0.9 / mw); g.font = font(px); }
      g.shadowColor = '#ff2bd6'; g.shadowBlur = 42;
      g.strokeStyle = '#ff2bd6'; g.lineWidth = 12; g.strokeText(text, w / 2, h / 2 + 6);
      g.shadowBlur = 14; g.fillStyle = '#ffe2fa'; g.fillText(text, w / 2, h / 2 + 6);
    }, false);
    const textMat = std({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 2.3, roughness: 0.6 });
    const tg = [];
    put(tg, new THREE.PlaneGeometry(36.4, 4.55), 500, 15.8, gz + 0.21);               // faces the street (+z)
    put(tg, new THREE.PlaneGeometry(36.4, 4.55), 500, 15.8, gz - 0.21, 0, Math.PI, 0); // faces the yard
    const textMesh = flush(tg, textMat, false, false);
    if (textMesh) world.anim.push((t) => { const k = t % 9; textMat.emissiveIntensity = (k > 4.0 && k < 4.08) || (k > 4.16 && k < 4.22) ? 0.5 : 2.3; });
    // info board beside the entrance (inside the fence, west of the gap)
    if (typeof world.sign === 'function') world.sign(440, -332, 0, ['DEMOLITION YARD', 'drive through a launcher · click or B to fire'], { w: 12, h: 3, stripe: '#ff2bd6' });
  });

  // ---------- launcher pickups at the entrance (same as buildWeaponsRange) ----------
  safe('pickups', () => {
    const pedGeo = new THREE.CylinderGeometry(1.4, 1.6, 0.6, 24), ringGeo = new THREE.TorusGeometry(1.6, 0.06, 8, 40);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#ffb547', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beamGeo = new THREE.CylinderGeometry(1.2, 1.2, 30, 24, 1, true);
    for (const x of [485, 515]) {
      const z = -342;
      const y = heightAt(x, z);
      const ped = new THREE.Mesh(pedGeo, darkSteel);
      ped.position.set(x, y + 0.3, z); ped.receiveShadow = true; scene.add(ped);
      const ring = new THREE.Mesh(ringGeo, glowAmber);
      ring.rotation.x = Math.PI / 2; ring.position.set(x, y + 0.62, z); scene.add(ring);
      const g = makeLauncherModel();
      g.position.set(x, y + 1.6, z); scene.add(g);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(x, y + 15, z); scene.add(beam);
      world.pickups.push({ x, y, z, obj: g, beam, ring });
      world.anim.push((t) => { g.rotation.y = t * 1.5; g.position.y = y + 1.6 + Math.sin(t * 2.2) * 0.25; });
    }
  });

  // ---------- jump ramp on the line from the gate (rises toward -z) ----------
  safe('ramp', () => { if (typeof world.wedge === 'function') world.wedge(500, -385, Math.PI, 4.5, 14, 3.2); });

  // ---------- floodlights (emissive heads, fake light cones and pools) ----------
  safe('floodlights', () => {
    const FLOODS = [[322, -322], [678, -322], [322, -678], [678, -678], [322, -500], [678, -500], [500, -678]];
    const cx = 500, cz = -500, PH = 18;
    for (const [px, pz] of FLOODS) {
      const dx = cx - px, dz = cz - pz, dist = Math.hypot(dx, dz) || 1;
      const k = Math.min(0.4, 55 / dist);
      const tx = px + dx * k, tz = pz + dz * k;
      const aimYaw = Math.atan2(dx, dz);
      const hd = Math.hypot(tx - px, tz - pz);
      const pitch = Math.atan2(PH, hd);
      const sx = Math.sin(aimYaw), sz = Math.cos(aimYaw), rx = Math.cos(aimYaw), rz = -Math.sin(aimYaw);
      put(L.dark, new THREE.CylinderGeometry(0.2, 0.3, PH, 10), px, PH / 2, pz);
      put(L.dark, new THREE.BoxGeometry(4.6, 0.25, 0.25), px, PH, pz, 0, aimYaw, 0);
      for (const o of [-1.5, 0, 1.5]) {
        const hx = px + rx * o + sx * 0.35, hz = pz + rz * o + sz * 0.35;
        put(L.dark, new THREE.BoxGeometry(1.2, 0.85, 0.4), hx, PH + 0.35, hz, pitch, aimYaw, 0, 'YXZ');
        const face = new THREE.PlaneGeometry(1.04, 0.7); face.translate(0, 0, 0.21);
        put(L.lamp, face, hx, PH + 0.35, hz, pitch, aimYaw, 0, 'YXZ');
      }
      // light cone from the lamp bar to the ground
      const ax = px + sx * 0.6, ay = PH + 0.2, az = pz + sz * 0.6;
      const bx = tx, by = 0.1, bz = tz;
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const cg = new THREE.ConeGeometry(len * 0.28, len, 20, 1, true);
      cg.translate(0, -len / 2, 0);
      _q.setFromUnitVectors(DOWN, _v.set((bx - ax) / len, (by - ay) / len, (bz - az) / len));
      _m4.compose(_v.set(ax, ay, az), _q, ONE);
      cg.applyMatrix4(_m4); L.cones.push(cg);
      // pool of light on the ground
      const pool = new THREE.CircleGeometry(len * 0.3, 32);
      pool.rotateX(-Math.PI / 2); pool.translate(tx, 0.1, tz);
      L.pools.push(pool);
      obb(px, PH / 2, pz, 0.35, PH / 2, 0.35);
    }
    const coneTex = canvasTex(4, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#555555'); gr.addColorStop(1, '#000000');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, false);
    const coneMat = new THREE.MeshBasicMaterial({ color: '#cfe2ff', alphaMap: coneTex, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const poolTex = canvasTex(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, false);
    const poolMat = new THREE.MeshBasicMaterial({ color: '#9fb8d8', map: poolTex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const cones = flush(L.cones, coneMat, false, false); if (cones) cones.renderOrder = 4;
    const pools = flush(L.pools, poolMat, false, false); if (pools) pools.renderOrder = 2;
  });

  // ---------- tower crane (static) with a wrecking ball ----------
  safe('crane', () => {
    const CX = 630, CZ = -625, Hm = 38, LJ = 42, TR = 25;
    const cyaw = Math.atan2(-500 - CZ, -(500 - CX));   // jib (local -x) points at the yard centre
    const cm = new THREE.Matrix4().compose(new THREE.Vector3(CX, 0, CZ), yawQ(cyaw), ONE);
    const cy = [], cd = [], cc = [], cgl = [], cr = [];
    put(cc, new THREE.BoxGeometry(8, 1.5, 8), 0, 0.75, 0);
    const B = 1.5, T = B + Hm;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(cy, new THREE.BoxGeometry(0.24, Hm, 0.24), lx, B + Hm / 2, lz);
    let flip = 1;
    for (let y = B; y < T - 0.5; y += 3, flip = -flip) {
      const y1 = Math.min(T, y + 3);
      for (const f of [-1, 1]) {
        put(cy, new THREE.BoxGeometry(2, 0.12, 0.12), 0, y1, f);
        put(cy, new THREE.BoxGeometry(0.12, 0.12, 2), f, y1, 0);
        strut(cy, -flip, y, f, flip, y1, f, 0.1);
        strut(cy, f, y, -flip, f, y1, flip, 0.1);
      }
    }
    put(cd, new THREE.BoxGeometry(2.8, 1.2, 2.8), 0, T + 0.6, 0);
    put(cgl, new THREE.BoxGeometry(1.6, 1.8, 1.8), 0.3, T + 0.5, 2.3);
    put(cd, new THREE.BoxGeometry(1.8, 0.12, 2.0), 0.3, T + 1.46, 2.3);
    const J0 = T + 1.3;
    // jib (triangular lattice along local -x)
    for (const s of [-1, 1]) put(cy, new THREE.BoxGeometry(LJ, 0.2, 0.2), -LJ / 2, J0, s * 0.8);
    put(cy, new THREE.BoxGeometry(LJ, 0.2, 0.2), -LJ / 2, J0 + 1.5, 0);
    for (let x = 0; x < LJ - 0.1; x += 3) {
      put(cy, new THREE.BoxGeometry(0.12, 0.12, 1.6), -x, J0, 0);
      for (const s of [-1, 1]) {
        strut(cy, -x, J0, s * 0.8, -x - 1.5, J0 + 1.5, 0, 0.09);
        strut(cy, -x - 1.5, J0 + 1.5, 0, -x - 3, J0, s * 0.8, 0.09);
      }
    }
    // counter-jib with concrete counterweights
    for (const s of [-1, 1]) put(cy, new THREE.BoxGeometry(14, 0.25, 0.25), 7, J0, s * 0.8);
    put(cd, new THREE.BoxGeometry(14, 0.08, 1.6), 7, J0 - 0.1, 0);
    for (let i = 0; i < 3; i++) put(cc, new THREE.BoxGeometry(0.9, 2.4, 2.0), 10.6 + i * 1.0, J0 - 1.3, 0);
    // cat head + ties
    const AY = J0 + 7;
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) strut(cy, lx, J0 - 0.1, lz, 0, AY, 0, 0.22);
    strut(cd, 0, AY, 0, -28, J0 + 1.5, 0, 0.08);
    strut(cd, 0, AY, 0, -14, J0 + 1.5, 0, 0.08);
    for (const s of [-1, 1]) strut(cd, 0, AY, 0, 13.5, J0 + 0.1, s * 0.8, 0.08);
    put(cr, new THREE.SphereGeometry(0.35, 12, 8), 0, AY + 0.35, 0);
    put(cr, new THREE.SphereGeometry(0.35, 12, 8), -LJ, J0 + 1.85, 0);
    // trolley
    put(cd, new THREE.BoxGeometry(1.6, 0.5, 1.8), -TR, J0 - 0.35, 0);
    for (const [src, dst] of [[cy, L.yellow], [cd, L.dark], [cc, L.concrete], [cgl, L.glass], [cr, L.red]]) for (const g of src) { g.applyMatrix4(cm); dst.push(g); }
    // wrecking ball on a cable (hangs high above the cars; it only sways a little)
    const pivot = new THREE.Group();
    pivot.position.set(CX - Math.cos(cyaw) * TR, J0 - 0.6, CZ + Math.sin(cyaw) * TR);
    pivot.rotation.y = cyaw;
    const ballTop = 13, cable = J0 - 0.6 - ballTop;
    put(L.ball, new THREE.BoxGeometry(0.07, cable, 0.07), 0, -cable / 2, 0);
    put(L.ball, new THREE.BoxGeometry(0.5, 0.7, 0.35), 0, -cable + 0.1, 0);
    put(L.ball, new THREE.SphereGeometry(1.1, 20, 14), 0, -cable - 1.1, 0);
    const bg = mergeGeometries(L.ball, false); L.ball.length = 0;
    if (bg) {
      const ball = new THREE.Mesh(bg, darkSteel); ball.castShadow = true; pivot.add(ball);
      scene.add(pivot);
      world.anim.push((t) => { pivot.rotation.z = Math.sin(t * 0.55) * 0.035; pivot.rotation.x = Math.sin(t * 0.41 + 1) * 0.025; });
    }
    // colliders: concrete base and the mast
    obb(CX, 0.75, CZ, 4, 0.75, 4, cyaw, 'concrete', GRIP.concrete);
    obb(CX, B + Hm / 2, CZ, 1.15, Hm / 2, 1.15, cyaw);
  });

  // ---------- shipping containers along the fences (static, colliders) ----------
  safe('containers', () => {
    const corr = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) { g.fillStyle = '#9a9a9a'; g.fillRect(x, 0, 3, h); }
      g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
    });
    const contMat = std({ map: corr, vertexColors: true, roughness: 0.7, metalness: 0.3 });
    const cols = ['#8a2f22', '#1f4f7a', '#2f6b3a', '#c56a1d', '#6b6f75', '#7a2f5a', '#a88a2a'];
    const CONT = [[318, -360, 0, 2], [318, -378, 0, 1], [682, -575, 0, 2], [682, -592, 0, 1], [400, -682, Math.PI / 2, 2], [416, -682, Math.PI / 2, 1]];
    const CW = 2.44, CHt = 2.59, CL = 12.19, col = new THREE.Color();
    let ci = 0;
    for (const [x, z, yaw, levels] of CONT) {
      for (let l = 0; l < levels; l++) {
        const g = new THREE.BoxGeometry(CW, CHt, CL);
        col.set(cols[ci++ % cols.length]);
        const n = g.getAttribute('position').count, ca = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
        put(L.containers, g, x, CHt / 2 + l * CHt, z, 0, yaw + (l ? 0.04 : 0), 0);
      }
      obb(x, levels * CHt / 2, z, CW / 2, levels * CHt / 2, CL / 2, yaw);
    }
    flush(L.containers, contMat);
  });

  // ---------- tyre stacks ----------
  safe('tyres', () => {
    const STACKS = [[344, -655], [345.3, -655], [344.65, -656.15], [660, -345], [661.3, -345], [660.65, -346.15]];
    const geo = new THREE.TorusGeometry(0.36, 0.15, 8, 16);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, rubber, STACKS.length * 5);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let k = 0;
    for (const [x, z] of STACKS) for (let i = 0; i < 5; i++) {
      q.setFromAxisAngle(UP, (i * 1.7) % 6.28);
      m.compose(_v.set(x + (i % 2) * 0.04, 0.15 + i * 0.3, z), q, ONE);
      mesh.setMatrixAt(k++, m);
    }
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    obb(344.65, 0.75, -655.4, 1.25, 0.75, 1.2, 0, 'concrete', 0.9);
    obb(660.65, 0.75, -345.4, 1.25, 0.75, 1.2, 0, 'concrete', 0.9);
  });

  // ---------- destructibles (world.d, same API use as buildWeaponsRange) ----------
  // glass via d.paneAt in world space (structure-local -> world, like Destruction.pane)
  const paneL = (s, yaw, lx, ly, lz, w, h, localYaw = 0) => {
    const [x, z] = toWorld(s.cx, s.cz, yaw, lx, lz);
    d.paneAt(new THREE.Vector3(x, heightAt(s.cx, s.cz) + ly, z), yaw + localYaw, w, h);
  };
  // small apartment block: floors of brick-laid concrete, window openings with glass, a door, slabs
  const building = (cx, cz, yaw, W, D, floors) => {
    const s = d.structure(cx, cz, yaw);
    const bh = 0.8, bt = 0.4, rowsPerFloor = 4, floorH = rowsPerFloor * bh;
    for (let f = 0; f < floors; f++) {
      for (let r = 0; r < rowsPerFloor; r++) {
        const y = f * (floorH + 0.3) + r * bh;
        const off = (r % 2) * 0.5;
        for (const wz of [-D / 2 + bt / 2, D / 2 - bt / 2]) {
          layRow(-W / 2, W / 2, off, (a, b) => {
            const mid = (a + b) / 2;
            const isWin = (r === 1 || r === 2) && Math.abs(((mid + W / 2) % 3) - 1.5) < 0.6 && Math.abs(mid) < W / 2 - 1;
            const isDoor = f === 0 && wz < 0 && r < 3 && Math.abs(mid) < 1.0;
            if (isWin || isDoor) return;
            d.block(s, mid, y, wz, b - a, bh, bt, 'concrete');
          });
        }
        for (const wx of [-W / 2 + bt / 2, W / 2 - bt / 2]) {
          layRow(-D / 2 + bt, D / 2 - bt, off, (a, b) => {
            const mid = (a + b) / 2;
            if ((r === 1 || r === 2) && Math.abs(mid) < 0.8) return;
            d.block(s, wx, y, mid, bt, bh, b - a, 'concrete');
          });
        }
      }
      const wy = f * (floorH + 0.3) + 1.6;
      for (const wz of [-D / 2 + bt / 2, D / 2 - bt / 2]) {
        for (let x = -W / 2 + 1.5; x < W / 2 - 1; x += 3) {
          if (f === 0 && wz < 0 && Math.abs(x) < 1.0) continue; // door
          paneL(s, yaw, x, wy, wz, 1.1, 1.5);
        }
      }
      for (const wx of [-W / 2 + bt / 2, W / 2 - bt / 2]) paneL(s, yaw, wx, wy, 0, 1.5, 1.5, Math.PI / 2);
      const sy = f * (floorH + 0.3) + floorH;
      for (let x = -W / 2; x < W / 2 - 0.01; x += 2) for (let z = -D / 2; z < D / 2 - 0.01; z += 2) {
        const sx = Math.min(2, W / 2 - x), sz = Math.min(2, D / 2 - z);
        d.block(s, x + sx / 2, sy, z + sz / 2, sx, 0.3, sz, 'concrete');
      }
    }
  };
  const wall = (cx, cz, yaw, L, rows) => {
    const s = d.structure(cx, cz, yaw);
    for (let r = 0; r < rows; r++) layRow(-L / 2, L / 2, (r % 2) * 0.4, (a, b) => d.block(s, (a + b) / 2, r * 0.4, 0, b - a, 0.4, 0.45, 'brick'), 0.8);
  };
  const crates = (cx, cz, yaw) => {
    const s = d.structure(cx, cz, yaw);
    for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - l; i++) for (let j = 0; j < 2; j++) d.block(s, (i - (2 - l) / 2) * 1.25, l * 1.2, j * 1.25, 1.2, 1.2, 1.2, 'crate');
  };
  const crateTower = (cx, cz, yaw, levels) => {
    const s = d.structure(cx, cz, yaw);
    for (let l = 0; l < levels; l++) for (const [x, z] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) d.block(s, x, l * 1.2, z, 1.2, 1.2, 1.2, 'crate');
    d.block(s, 0, levels * 1.2, 0, 1.2, 1.2, 1.2, 'crate');
  };
  const waterTower = (cx, cz, yaw) => {
    const s = d.structure(cx, cz, yaw);
    for (const [x, z] of [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]]) for (let l = 0; l < 6; l++) d.block(s, x, l * 1.2, z, 0.5, 1.2, 0.5, 'wood');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) d.block(s, -1.875 + i * 1.25, 7.2, -1.875 + j * 1.25, 1.25, 0.3, 1.25, 'wood');
    const R = 1.9, n = 12;
    for (let l = 0; l < 3; l++) for (let i = 0; i < n; i++) {
      const a = (i + (l % 2) * 0.5) / n * Math.PI * 2;
      d.block(s, Math.cos(a) * R, 7.5 + l * 1.0, Math.sin(a) * R, 1.05, 1.0, 0.3, 'wood', -a + Math.PI / 2);
    }
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) d.block(s, i * 1.3, 10.5, j * 1.3, 1.3, 0.25, 1.3, 'wood');
    d.block(s, 0, 10.75, 0, 1.2, 0.6, 1.2, 'wood');
  };
  safe('buildings', () => {
    building(420, -455, Math.PI + 0.1, 10, 7, 3);     // doors face the entrance (north)
    building(585, -450, Math.PI - 0.15, 10, 7, 2);
    building(500, -585, Math.PI, 9, 7, 2);
  });
  safe('walls', () => { wall(440, -395, 0.25, 16, 8); wall(565, -400, -0.25, 12, 7); });
  safe('crates', () => { crateTower(640, -530, 0.2, 6); crates(370, -540, 0.3); });
  safe('watertower', () => waterTower(380, -615, 0.2));
  safe('barrels', () => {
    const B = [[431, -466], [432.2, -467.1], [430.5, -467.6], [574, -440], [575.2, -439.2], [573.4, -438.6],
      toWorld(440, -395, 0.25, -3, -1.6), toWorld(440, -395, 0.25, 0, -1.6), toWorld(440, -395, 0.25, 3, -1.6),
      toWorld(565, -400, -0.25, -2, -1.6), toWorld(565, -400, -0.25, 2, -1.6),
      [508, -576.5], [509.2, -577.3], [491, -577], [566, -540], [567.1, -540.8], [387, -609], [388.1, -609.8],
      [634.5, -525], [635.6, -524.2], [619, -612], [617.9, -612.8], [477, -500], [602, -507]];
    for (const [x, z] of B) d.barrel(x, z);
  });

  // ---------- junk cars and crushed-car stacks (d.target) ----------
  safe('cars', () => {
    // one shared merged geometry (paint / glass / dark groups) instead of 8 meshes per car
    const paintParts = [], glassParts = [], darkParts = [];
    put(paintParts, new THREE.BoxGeometry(1.86, 0.65, 4.7), 0, 0.62, 0);
    put(paintParts, new THREE.BoxGeometry(1.5, 0.08, 2.0), 0, 1.5, -0.3);
    put(glassParts, new THREE.BoxGeometry(1.6, 0.55, 2.5), 0, 1.2, -0.2);
    for (const [x, z] of [[0.82, 1.45], [-0.82, 1.45], [0.82, -1.45], [-0.82, -1.45]]) put(darkParts, new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), x, 0.34, z, 0, 0, Math.PI / 2);
    const carGeo = mergeGeometries([mergeGeometries(paintParts, false), mergeGeometries(glassParts, false), mergeGeometries(darkParts, false)], true);
    if (!carGeo) return;
    const carGlass = std({ color: '#111820', roughness: 0.15, metalness: 0.8 });
    const carDark = std({ color: '#141518', roughness: 0.85 });
    const paints = ['#6a5d4d', '#3c5260', '#704030', '#556b2f', '#7a7466', '#5b2f3a'].map(c => std({ color: c, roughness: 0.85, metalness: 0.2 }));
    const mk = (x, y, z, yaw, ci, crushed) => {
      const car = new THREE.Mesh(carGeo, [paints[ci % paints.length], carGlass, carDark]);
      car.position.set(x, y, z); car.rotation.y = yaw;
      if (crushed) car.scale.set(1.04, 0.42, 0.98);
      car.castShadow = true; car.receiveShadow = true;
      scene.add(car);
      return car;
    };
    const JUNK = [[470, -505, 0.4], [538, -508, -0.7], [395, -505, 1.3], [608, -500, 2.0], [650, -422, 0.2], [360, -430, -1.0], [530, -645, 1.5], [455, -652, 0.8]];
    JUNK.forEach(([x, z, yaw], i) => {
      const car = mk(x, heightAt(x, z), z, yaw, i, false);
      d.target(car, new THREE.Vector3(0.95, 0.72, 2.45), 1600, 0.72);
    });
    // crushed stacks: when a lower car is blown away, the cars above it drop (launched gently)
    const stacks = [];
    for (const [sx, sz, syaw, n, c0] of [[560, -545, 0.3, 4, 1], [445, -545, -0.2, 3, 3]]) {
      const y0 = heightAt(sx, sz), list = [];
      for (let k = 0; k < n; k++) {
        const j = ((k * 7) % 5 - 2) * 0.06;
        const car = mk(sx + j, y0 + k * 0.66, sz - j, syaw + j * 1.5, c0 + k, true);
        list.push(d.target(car, new THREE.Vector3(0.97, 0.33, 2.4), 1100, 0.33));
      }
      stacks.push({ list, at: new THREE.Vector3(sx, y0, sz) });
    }
    if (typeof d.launchTarget === 'function') {
      world.anim.push(() => {
        for (const st of stacks) {
          const ls = st.list;
          for (let i = 1; i < ls.length; i++) {
            const lo = ls[i - 1], up = ls[i];
            if (lo && up && up.state === 'static' && lo.state !== 'static' && up.col) {
              try { d.launchTarget(up, st.at, 0.05); } catch (e) { /* never break the frame loop */ }
            }
          }
        }
      });
    }
  });

  // ---------- merge static decoration ----------
  safe('flush', () => {
    flush(L.dark, darkSteel, true, true);
    flush(L.yellow, craneYellow, true, true);
    flush(L.concrete, concrete, true, true);
    flush(L.glass, glassMat, false, false);
    flush(L.pink, neonPink, false, false);
    flush(L.cyan, neonCyan, false, false);
    flush(L.lamp, lampMat, false, false);
    const red = flush(L.red, glowRed, false, false);
    if (red) world.anim.push((t) => { red.visible = (t % 1.6) < 0.6; });
  });
}
