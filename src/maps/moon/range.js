// The Moon: Moon Rock Mine (zone 'mine', teleport key 4). The Moon's weapons range.
// Entrance pad with launcher pickups and a gateway sign, then a big loose-ground mine floor:
// destructible storage sheds, a conveyor tower, an ore silo, ore-crate walls, fuel tanks,
// lunar rovers to blow up, a mine office with glass windows, an excavator and rock piles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, OBB } from '../../colliders.js';
import { heightAt } from '../../terrain.js';
import { ZONES, KEYS } from './layout.js';

// Ragdoll target dummies go here (the integrator places them). All open, flat and at least
// 2 m from every collider this file places (the boss spot has over 5 m of room).
export const dollSpots = [
  [565, -552], [600, -560], [635, -552],
  [548, -585], [585, -592], [618, -594], [665, -600],
  [600, -632, 'boss'],
  [540, -645], [668, -635], [710, -610], [500, -625],
  [575, -690], [720, -690],
];

const AX_Y = new THREE.Vector3(0, 1, 0), AX_X = new THREE.Vector3(1, 0, 0);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

// move a geometry into place (rotation order Y, then X, then Z)
function placeGeo(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  _m4.compose(_v.set(x, y, z), _q, _one);
  return g.applyMatrix4(_m4);
}
// merge any built-in geometries (indexed or not) into one; keeps position / normal / uv only
function mergeSafe(list) {
  const out = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    out.push(g);
  }
  return (out.length && mergeGeometries(out, false)) || out[0] || new THREE.BoxGeometry(0.01, 0.01, 0.01);
}
function layRow(a0, a1, offset, fn, unit = 1.0) {
  let a = a0;
  let first = offset > 0 ? Math.min(offset, a1 - a0) : unit;
  while (a < a1 - 0.01) {
    const b = Math.min(a1, a + first);
    fn(a, b);
    a = b; first = unit;
  }
}
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// run one section; a bug in one part of the mine never stops the map from loading
function safe(name, fn) {
  try { fn(); } catch (err) { console.warn('[moon/range] ' + name + ' failed', err); }
}

export function build(world) {
  const d = world.d;
  const scene = world.scene;
  const WM = world.mats || {};
  const std = (o) => new THREE.MeshStandardMaterial(o);
  // shared materials (created once per build)
  const mat = {
    darkSteel: WM.darkSteel || std({ color: '#3b4148', roughness: 0.5, metalness: 0.7 }),
    steel: WM.steel || std({ color: '#9ea4ab', roughness: 0.35, metalness: 0.85 }),
    concrete: WM.concrete || std({ color: '#c7c2b6', roughness: 0.92 }),
    rubber: WM.rubber || std({ color: '#16171a', roughness: 0.9 }),
    glowRed: WM.glowRed || std({ color: '#200505', emissive: '#ff3b2f', emissiveIntensity: 2.4 }),
    glowAmber: WM.glowAmber || std({ color: '#201405', emissive: '#ffb547', emissiveIntensity: 2.2 }),
    glowCyan: WM.glowCyan || std({ color: '#0a1a20', emissive: '#7fe3ff', emissiveIntensity: 2.2 }),
    machine: std({ color: '#d9a21b', roughness: 0.55, metalness: 0.3 }),
    cabGlass: std({ color: '#1b2a38', roughness: 0.1, metalness: 0.85 }),
    roverBody: std({ color: '#e4e6e9', roughness: 0.45, metalness: 0.25 }),
    panel: std({ color: '#1a3566', roughness: 0.25, metalness: 0.6, emissive: '#0a1a3a', emissiveIntensity: 0.5 }),
    rock: std({ color: '#8d8b87', roughness: 1, flatShading: true }),
    ore: std({ color: '#6a645c', roughness: 1, flatShading: true }),
    timber: std({ color: '#6b4a2b', roughness: 0.85 }),
    shaft: std({ color: '#050506', roughness: 1 }),
    pod: std({ color: '#2a2f35', roughness: 0.4, metalness: 0.6 }),
    podStripe: std({ color: '#ffb547', emissive: '#ff8a00', emissiveIntensity: 1.2 }),
    podTube: std({ color: '#111111', emissive: '#ff5a1a', emissiveIntensity: 0.8 }),
    beam: new THREE.MeshBasicMaterial({ color: '#ffb547', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  const addMesh = (geo, m, shadow = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const obb = (x, y, z, hx, hy, hz, yaw = 0, pitch = 0, surface = 'metal', grip) => {
    const q = new THREE.Quaternion().setFromAxisAngle(AX_Y, yaw);
    if (pitch) q.multiply(new THREE.Quaternion().setFromAxisAngle(AX_X, pitch));
    const opts = { surface };
    if (grip !== undefined) opts.grip = grip;
    return addCollider(new OBB(new THREE.Vector3(x, y, z), q, new THREE.Vector3(hx, hy, hz), opts));
  };
  // static model from parts in model space (x right, y up, z forward), merged into one mesh per material
  const staticModel = (x, z, yaw, parts, surface = 'metal') => {
    const y0 = heightAt(x, z);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AX_Y, yaw);
    const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y0, z), qYaw, new THREE.Vector3(1, 1, 1));
    const byMat = new Map();
    for (const p of parts) {
      if (!byMat.has(p.mat)) byMat.set(p.mat, []);
      byMat.get(p.mat).push(p.geo);
      if (p.box) {
        const [cx, cy, cz, hx, hy, hz, pitch = 0] = p.box;
        const c = new THREE.Vector3(cx, cy, cz).applyMatrix4(M);
        const q = qYaw.clone();
        if (pitch) q.multiply(new THREE.Quaternion().setFromAxisAngle(AX_X, pitch));
        addCollider(new OBB(c, q, new THREE.Vector3(hx, hy, hz), { surface }));
      }
    }
    for (const [m, geos] of byMat) addMesh(mergeSafe(geos).applyMatrix4(M), m);
  };
  // a box part: size w,h,d centred at (x,y,z), pitched about x; collide adds a matching OBB
  const part = (m, w, h, dd, x, y, z, pitch = 0, collide = true) => ({
    mat: m, geo: placeGeo(new THREE.BoxGeometry(w, h, dd), x, y, z, pitch),
    box: collide ? [x, y, z, w / 2, h / 2, dd / 2, pitch] : null,
  });

  // ---------- entrance: launcher pickups, gateway sign, lights, teleport ----------
  safe('entrance', () => {
    const tubeGeo = mergeSafe([[-0.16, 0.1], [0.16, 0.1], [-0.16, -0.1], [0.16, -0.1]].map(([x, y]) => placeGeo(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 14), x, y, 0.6, Math.PI / 2)));
    const podGeo = new THREE.BoxGeometry(0.7, 0.45, 1.2), stripeGeo = new THREE.BoxGeometry(0.72, 0.08, 0.3);
    const pedGeo = new THREE.CylinderGeometry(1.4, 1.6, 0.6, 24), ringGeo = new THREE.TorusGeometry(1.6, 0.06, 8, 40);
    const beamGeo = new THREE.CylinderGeometry(1.2, 1.2, 30, 24, 1, true);
    for (const x of [588, 612]) {
      const z = -482;
      const y = heightAt(x, z);
      const ped = new THREE.Mesh(pedGeo, mat.darkSteel);
      ped.position.set(x, y + 0.3, z); ped.receiveShadow = true; scene.add(ped);
      const ring = new THREE.Mesh(ringGeo, mat.glowAmber);
      ring.rotation.x = Math.PI / 2; ring.position.set(x, y + 0.62, z); scene.add(ring);
      const g = new THREE.Group();
      const pod = new THREE.Mesh(podGeo, mat.pod); g.add(pod);
      const stripe = new THREE.Mesh(stripeGeo, mat.podStripe); stripe.position.z = -0.3; g.add(stripe);
      const tubes = new THREE.Mesh(tubeGeo, mat.podTube); g.add(tubes);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.position.set(x, y + 1.6, z); scene.add(g);
      const beam = new THREE.Mesh(beamGeo, mat.beam);
      beam.position.set(x, y + 15, z); scene.add(beam);
      world.pickups.push({ x, y, z, obj: g, beam, ring });
      world.anim.push((t) => { g.rotation.y = t * 1.5; g.position.y = y + 1.6 + Math.sin(t * 2.2) * 0.25; });
    }
    // gateway sign over the drive in (posts at x 592.6 and 607.4, board 3.5 m up)
    if (typeof world.sign === 'function') world.sign(600, -496, Math.PI, ['MOON ROCK MINE', 'drive through a launcher · click or B to fire'], { w: 16, h: 4, stripe: '#ffb547' });
    if (typeof world.lightPole === 'function') {
      for (const [x, z] of [[548, -492], [652, -492], [525, -555], [745, -585], [560, -760], [720, -790]]) world.lightPole(x, z, 12);
    }
    const key = Number(Object.keys(KEYS).find(k => KEYS[k] === 'mine')) || 4;
    world.teleports.push({ key, name: ZONES.mine.name, x: 600, z: -460, yaw: Math.PI });
  });

  // ---------- mine office: static concrete block with glass windows (like the HQ ops building) ----------
  safe('office', () => {
    const ox = 705, oz = -562, W = 22, D = 14, H = 7;    // spans x 694..716, z -569..-555
    const y0 = heightAt(ox, oz);
    if (typeof world.box === 'function') world.box(ox, y0, oz, W, H, D, mat.concrete);
    else { addMesh(placeGeo(new THREE.BoxGeometry(W, H, D), ox, y0 + H / 2, oz), mat.concrete); obb(ox, y0 + H / 2, oz, W / 2, H / 2, D / 2, 0, 0, 'concrete'); }
    const north = oz + D / 2 + 0.03, west = ox - W / 2 - 0.03;
    for (let i = 0; i < 4; i++) d.paneAt(new THREE.Vector3(697 + i * 4.2, y0 + 3.6, north), 0, 2.6, 2.0);
    for (let i = 0; i < 4; i++) d.paneAt(new THREE.Vector3(west, y0 + 3.6, -566.8 + i * 3.2), Math.PI / 2, 2.4, 2.0);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3), mat.darkSteel);
    door.position.set(713.5, y0 + 1.5, north + 0.01); scene.add(door);
    addMesh(placeGeo(new THREE.BoxGeometry(W + 0.2, 0.3, 0.2), ox, y0 + 6.2, north + 0.08), mat.glowCyan, false);
    // roof: antenna mast, dish and a blinking beacon
    addMesh(mergeSafe([
      placeGeo(new THREE.CylinderGeometry(0.12, 0.16, 6, 8), 712, y0 + H + 3, -566),
      placeGeo(new THREE.CylinderGeometry(0.2, 0.3, 1.2, 10), 700, y0 + H + 0.6, -563),
      placeGeo(new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), 700, y0 + H + 1.1, -563, -0.9, 0.6),
    ]), mat.steel);
    const beacon = addMesh(new THREE.SphereGeometry(0.3, 10, 8), mat.glowRed, false);
    beacon.position.set(712, y0 + H + 6.3, -566);
    world.anim.push((t) => { beacon.visible = (t % 1.4) < 0.5; });
  });

  // ---------- destructible storage sheds (same block layout as the desert range buildings) ----------
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
          if (f === 0 && wz < 0 && Math.abs(x) < 1.0) continue;
          d.pane(s, x, wy, wz, 1.1, 1.5);
        }
      }
      for (const wx of [-W / 2 + bt / 2, W / 2 - bt / 2]) d.pane(s, wx, wy, 0, 1.5, 1.5, Math.PI / 2);
      const sy = f * (floorH + 0.3) + floorH;
      for (let x = -W / 2; x < W / 2 - 0.01; x += 2) for (let z = -D / 2; z < D / 2 - 0.01; z += 2) {
        const sx = Math.min(2, W / 2 - x), sz = Math.min(2, D / 2 - z);
        d.block(s, x + sx / 2, sy, z + sz / 2, sx, 0.3, sz, 'concrete');
      }
    }
  };
  safe('sheds', () => {
    building(455, -590, -Math.PI / 2 + 0.2, 10, 7, 1);    // doors face east, toward the yard
    building(470, -675, -Math.PI / 2 - 0.1, 9, 7, 2);
  });

  // ---------- ore silo (ring of concrete blocks with a steel lid) ----------
  safe('silo', () => {
    const cx = 775, cz = -650, R = 3, levels = 12;
    const s = d.structure(cx, cz, 0);
    const n = Math.round(2 * Math.PI * R / 1.15);
    for (let l = 0; l < levels; l++) for (let i = 0; i < n; i++) {
      const a = (i + (l % 2) * 0.5) / n * Math.PI * 2;
      d.block(s, Math.cos(a) * R, l * 0.9, Math.sin(a) * R, 1.2, 0.9, 0.5, 'concrete', -a + Math.PI / 2);
    }
    d.block(s, 0, levels * 0.9, 0, 6, 0.3, 6, 'metal');
  });

  // ---------- conveyor tower: steel legs, deck, ore hopper and a stepped belt down to the ore heap ----------
  safe('conveyor', () => {
    const s = d.structure(770, -735, 0);       // belt runs west (local -x) to x ~752
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) for (let l = 0; l < 6; l++) d.block(s, x, l * 1.2, z, 0.5, 1.2, 0.5, 'metal');
    for (const z of [-1.6, 1.6]) d.block(s, 0, 3.6, z, 2.7, 0.25, 0.25, 'metal');
    for (const x of [-1.6, 1.6]) d.block(s, x, 3.6, 0, 0.25, 0.25, 2.7, 'metal');
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) d.block(s, x * 1.25, 7.2, z * 1.25, 1.25, 0.25, 1.25, 'metal');
    for (const x of [-0.62, 0.62]) for (const z of [-0.62, 0.62]) d.block(s, x, 7.45, z, 1.2, 1.2, 1.2, 'crate');
    d.block(s, 0, 8.65, 0, 2.6, 0.25, 2.6, 'metal');
    for (let i = 0; i < 8; i++) {
      const lx = -2.85 - i * 2.0, yb = 6.4 - i * 0.8;
      for (const z of [-0.5, 0.5]) d.block(s, lx, 0, z, 0.22, yb, 0.22, 'metal');
      d.block(s, lx, yb, 0, 2.0, 0.25, 1.1, 'metal');
    }
  });

  // ---------- walls and stacks of ore crates ----------
  safe('crates', () => {
    const crateWall = (cx, cz, yaw, n, rows) => {
      const s = d.structure(cx, cz, yaw);
      for (let r = 0; r < rows; r++) {
        const k = n - (r % 2);
        for (let i = 0; i < k; i++) d.block(s, (i - (k - 1) / 2) * 1.22, r * 1.2, 0, 1.2, 1.2, 1.2, 'crate');
      }
    };
    const crates = (cx, cz, yaw) => {
      const s = d.structure(cx, cz, yaw);
      for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - l; i++) for (let j = 0; j < 2; j++) d.block(s, (i - (2 - l) / 2) * 1.25, l * 1.2, j * 1.25, 1.2, 1.2, 1.2, 'crate');
    };
    crateWall(600, -700, 0, 8, 3);
    crateWall(690, -650, 0.5, 6, 3);
    crateWall(525, -660, -0.4, 6, 3);
    crates(430, -630, 0.2); crates(655, -775, -0.4); crates(735, -600, 0.3);
  });

  // ---------- fuel tanks (explosive barrels) ----------
  safe('barrels', () => {
    for (const [x, z] of [
      [768, -632], [770.5, -630.5], [766, -629.5],            // by the silo
      [755, -725], [757.5, -723.5], [753, -722.5],            // by the conveyor
      [689, -578], [689, -581], [686.5, -579.5],              // by the office
      [630, -665], [632.5, -666.5], [628, -667.5], [631, -669.5], // fuel depot in the yard
      [480, -600], [482, -602.5],                             // by the sheds
      [520, -780], [522.5, -781.5],                           // by the excavator
      [560, -720], [562, -722],
    ]) d.barrel(x, z);
  });

  // ---------- lunar rovers (targets that get thrown by blasts) ----------
  safe('rovers', () => {
    const wheels = [];
    for (const x of [-1.2, 1.2]) for (const z of [-1.3, 0, 1.3]) wheels.push(placeGeo(new THREE.CylinderGeometry(0.45, 0.45, 0.32, 14), x, 0.45, z, 0, 0, Math.PI / 2));
    const geos = {
      body: mergeSafe([
        placeGeo(new THREE.BoxGeometry(2.0, 0.55, 3.4), 0, 0.95, 0),
        placeGeo(new THREE.BoxGeometry(1.5, 0.5, 1.2), 0, 1.47, -0.8),
      ]),
      wheels: mergeSafe(wheels),
      metal: mergeSafe([
        placeGeo(new THREE.BoxGeometry(0.12, 0.12, 3.0), -1.2, 0.72, 0),
        placeGeo(new THREE.BoxGeometry(0.12, 0.12, 3.0), 1.2, 0.72, 0),
        placeGeo(new THREE.BoxGeometry(2.3, 0.1, 0.1), 0, 0.72, 0),
        placeGeo(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), -0.6, 1.57, 0.6),
        placeGeo(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), 0.6, 1.57, 0.6),
        placeGeo(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), -0.6, 2.42, -1.1),
        placeGeo(new THREE.SphereGeometry(0.08, 8, 6), -0.6, 3.14, -1.1),
        placeGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), 0.5, 2.17, -1.3),
        placeGeo(new THREE.BoxGeometry(0.45, 0.25, 0.25), 0.5, 2.7, -1.3),
      ]),
      panel: placeGeo(new THREE.BoxGeometry(2.4, 0.06, 1.8), 0, 1.95, 0.6),
    };
    const half = new THREE.Vector3(1.38, 1.0, 1.78);
    for (const [x, z, yaw] of [[642, -578, 0.6], [556, -622, -0.4], [690, -705, 1.8], [520, -735, 0.3], [640, -735, -1.0], [600, -775, 2.4], [745, -680, 0.9]]) {
      const g = new THREE.Group();
      for (const [geo, m] of [[geos.body, mat.roverBody], [geos.wheels, mat.rubber], [geos.metal, mat.darkSteel], [geos.panel, mat.panel]]) {
        const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
      }
      g.position.set(x, heightAt(x, z), z); g.rotation.y = yaw;
      scene.add(g);
      d.target(g, half, 1100, 1.0);
    }
  });

  // ---------- mining excavator (static, solid) digging at the south face ----------
  safe('excavator', () => {
    const P = [];
    for (const x of [-1.7, 1.7]) P.push(part(mat.darkSteel, 1.1, 1.2, 6.0, x, 0.6, 0));
    P.push(part(mat.darkSteel, 2.4, 0.9, 3.0, 0, 0.75, 0));      // undercarriage between the tracks
    P.push(part(mat.darkSteel, 4.4, 0.5, 4.4, 0, 1.45, 0));      // slewing ring
    P.push(part(mat.machine, 4.2, 2.0, 4.8, 0, 2.7, -0.4));
    P.push(part(mat.darkSteel, 4.0, 1.4, 1.2, 0, 2.4, -3.3));
    P.push(part(mat.machine, 1.6, 1.9, 1.9, -1.2, 4.65, 1.0));
    P.push(part(mat.cabGlass, 1.5, 1.0, 0.06, -1.2, 4.9, 1.97, 0, false));
    // boom: from (0.6, 3.2, 2.0), 7.5 m long, 40 degrees up; stick 5 m angled down; bucket
    const a1 = 40 * Math.PI / 180, L1 = 7.5, a2 = 60 * Math.PI / 180, L2 = 5;
    const p1 = [0.6, 3.2 + Math.sin(a1) * L1, 2.0 + Math.cos(a1) * L1];
    P.push(part(mat.machine, 0.8, 0.9, L1, 0.6, 3.2 + Math.sin(a1) * L1 / 2, 2.0 + Math.cos(a1) * L1 / 2, -a1));
    P.push(part(mat.machine, 0.6, 0.7, L2, 0.6, p1[1] - Math.sin(a2) * L2 / 2, p1[2] + Math.cos(a2) * L2 / 2, a2));
    const p2 = [0.6, p1[1] - Math.sin(a2) * L2, p1[2] + Math.cos(a2) * L2];
    P.push(part(mat.darkSteel, 2.0, 1.3, 1.4, 0.6, p2[1] - 0.8, p2[2] + 0.3, 0.3));
    P.push(part(mat.steel, 0.25, 0.25, 4.0, 1.15, 3.6 + Math.sin(a1) * 1.4, 2.4 + Math.cos(a1) * 1.4, -a1 + 0.15, false));
    staticModel(500, -790, Math.PI, P);
  });

  // ---------- mine shaft portal at the south wall ----------
  safe('portal', () => {
    staticModel(690, -824, 0, [
      part(mat.timber, 1.5, 7, 1.5, -6, 3.5, 0.5),
      part(mat.timber, 1.5, 7, 1.5, 6, 3.5, 0.5),
      part(mat.timber, 14, 1.6, 1.8, 0, 7.8, 0.5),
      part(mat.shaft, 10.5, 7, 1.0, 0, 3.5, -1.2),
    ], 'wood');
  });

  // ---------- rock piles, ore heaps and boulders ----------
  safe('rocks', () => {
    const rng = mulberry(4417);
    // ore heaps (cones) with a solid core inside each
    const heaps = [[500, -813, 8, 5], [620, -815, 7, 4], [745, -735, 5, 3], [430, -805, 6, 3.5]];
    addMesh(mergeSafe(heaps.map(([x, z, r, h]) => placeGeo(new THREE.ConeGeometry(r, h, 9, 1), x, heightAt(x, z) + h / 2 - 0.1, z, 0, rng() * 6))), mat.ore);
    for (const [x, z, r, h] of heaps) obb(x, heightAt(x, z) + h * 0.28, z, r * 0.3, h * 0.28, r * 0.3, 0, 0, 'rock', 0.9);
    // boulders with colliders near the edges of the floor
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const boulders = [[392, -560, 2.4], [388, -650, 2.8], [395, -760, 2.2], [810, -575, 2.5], [812, -700, 3.0], [805, -790, 2.2], [560, -826, 2.0], [450, -545, 2.0]];
    const bm = new THREE.InstancedMesh(rockGeo, mat.rock, boulders.length);
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), m4 = new THREE.Matrix4();
    boulders.forEach(([x, z, r], i) => {
      const yaw = rng() * 6;
      q.setFromAxisAngle(AX_Y, yaw); sc.set(r, r * 0.7, r * 1.1); p.set(x, heightAt(x, z) + r * 0.2, z);
      bm.setMatrixAt(i, m4.compose(p, q, sc));
      addCollider(new OBB(p, q, new THREE.Vector3(r * 0.75, r * 0.55, r * 0.8), { surface: 'rock', grip: 0.9 }));
    });
    bm.castShadow = true; bm.receiveShadow = true; scene.add(bm);
    // loose rubble (no colliders) in clusters along the walls and around the heaps
    const clusters = [[395, -600], [392, -700], [398, -790], [812, -620], [815, -740], [810, -815], [455, -822], [560, -818], [650, -825], [760, -822], [742, -748], [500, -803], [620, -803], [440, -795], [730, -545], [470, -545]];
    const N = clusters.length * 10;
    const rm = new THREE.InstancedMesh(rockGeo, mat.rock, N);
    let k = 0;
    for (const [cx, cz] of clusters) for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2, rr = 1 + rng() * 7;
      const x = Math.min(826, Math.max(374, cx + Math.cos(a) * rr)), z = Math.min(-474, Math.max(-828, cz + Math.sin(a) * rr));
      const s = 0.25 + rng() * 0.8;
      q.setFromAxisAngle(AX_Y, rng() * 6); sc.set(s, s * 0.6, s * (0.8 + rng() * 0.5)); p.set(x, heightAt(x, z) - s * 0.15, z);
      rm.setMatrixAt(k++, m4.compose(p, q, sc));
    }
    rm.count = k; rm.castShadow = true; rm.receiveShadow = true; scene.add(rm);
  });
}
