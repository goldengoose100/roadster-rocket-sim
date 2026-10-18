// Shopping Cart: a giant supermarket trolley riding on the car's wheels (Good Luck menu silly body).
// A see-through chrome wire basket (wider at the top, flared at the front and back) on a low frame with
// a bottom tray, a red plastic push handle at the back, a red bumper at the front, and the flip-down
// child seat in use: a rubber duck rides in it facing the driver behind. Groceries rattle around
// inside (baguette sticking out, milk carton, cereal box, apples, carrots) and a pack of toilet rolls
// sits on the bottom tray. Looks only. Car space: +z forward, y up, ground at y = -0.45,
// wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const info = { id: 'cart', name: 'Shopping Cart' };

// ---- the basket: a bilinear box, s = 0 rear .. 1 front, t = 0 bottom .. 1 top, sx = -1 .. 1 across ----
const YB = 0.3, YT = 1.3;
function bp(s, t, sx, out) {
  const zr = -1.55 - 0.3 * t, zf = 1.72 + 0.45 * t;      // back and front both flare out going up
  const hw = (0.6 + 0.24 * t) * (1 - 0.14 * s);          // wider at the top and at the back
  return out.set(sx * hw, YB + (YT - YB) * t, zr + (zf - zr) * s);
}

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
// a straight bar from a to b (open ends for thin wires)
function rod(a, b, r, seg = 6, open = true) {
  _d.subVectors(b, a);
  const geo = new THREE.CylinderGeometry(r, r, _d.length(), seg, 1, open);
  geo.applyQuaternion(_q.setFromUnitVectors(UP, _d.normalize()));
  return geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// move / turn / scale a fresh geometry into place
function put(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  return geo.applyMatrix4(_m);
}

function wireGeometry() {
  const parts = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const W = 0.011, RIM = 0.024, POST = 0.018;
  const wire = (s0, t0, x0, s1, t1, x1, r = W, seg = 6) => parts.push(rod(bp(s0, t0, x0, A), bp(s1, t1, x1, B), r, seg));
  // sides: upright wires and three long ones
  const NS = 25;
  for (const sx of [-1, 1]) {
    for (let i = 1; i < NS; i++) wire(i / NS, 0, sx, i / NS, 1, sx);
    for (const t of [0.25, 0.5, 0.75]) wire(0, t, sx, 1, t, sx);
  }
  // front panel and the rear gate
  for (const [s, n] of [[1, 9], [0, 10]]) {
    for (let k = 1; k < n; k++) { const x = -1 + 2 * k / n; wire(s, 0, x, s, 1, x); }
    for (const t of [0.25, 0.5, 0.75]) wire(s, t, -1, s, t, 1);
  }
  // floor grid
  for (let i = 1; i < 22; i++) wire(i / 22, 0, -1, i / 22, 0, 1);
  for (const x of [-0.66, -0.33, 0, 0.33, 0.66]) wire(0, 0, x, 1, 0, x);
  // rolled top rim, bottom edges and corner posts, with balls at the top corners
  for (const sx of [-1, 1]) { wire(0, 1, sx, 1, 1, sx, RIM, 8); wire(0, 0, sx, 1, 0, sx, POST, 8); }
  for (const s of [0, 1]) {
    wire(s, 1, -1, s, 1, 1, RIM, 8); wire(s, 0, -1, s, 0, 1, POST, 8);
    for (const sx of [-1, 1]) {
      wire(s, 0, sx, s, 1, sx, POST, 8);
      bp(s, 1, sx, A); parts.push(new THREE.SphereGeometry(RIM * 1.25, 8, 6).translate(A.x, A.y, A.z));
    }
  }

  // ---- the frame: two low rails, axles out to the real wheels, posts up to the basket ----
  const FR = 0.035, FY = -0.1;
  for (const x of [-0.5, 0.5]) {
    parts.push(rod(V(x, FY, -1.62), V(x, FY, 1.8), FR, 10));
    parts.push(rod(V(x, FY, -1.55), bp(0, 0, Math.sign(x), A), 0.028, 8));   // rear post
    parts.push(rod(V(x, FY, 1.72), bp(1, 0, Math.sign(x), A), 0.028, 8));    // front post
  }
  parts.push(rod(V(-0.5, FY, -1.62), V(0.5, FY, -1.62), FR, 10));
  for (const z of [1.36, -1.34]) parts.push(rod(V(-0.84, FY, z), V(0.84, FY, z), 0.04, 10));
  // bottom tray: cross wires on the rails and long wires on top of them
  for (let i = 0; i <= 12; i++) { const z = -0.95 + 1.9 * i / 12; parts.push(rod(V(-0.5, -0.053, z), V(0.5, -0.053, z), W)); }
  for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) parts.push(rod(V(x, -0.03, -0.95), V(x, -0.03, 0.95), W));
  // handle arms from the top rear corners back to the grip
  for (const sx of [-1, 1]) parts.push(rod(bp(0, 1, sx, A), V(sx * 0.78, 1.47, -2.2), 0.026, 8));
  return mergeGeometries(parts);
}

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const mesh = (parent, geos, material, shadow = true) => {
    const m = new THREE.Mesh(Array.isArray(geos) ? mergeGeometries(geos) : geos, material);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // ---- chrome basket and frame (one mesh) ----
  mesh(g, wireGeometry(), mat('#d9dee6', 0.26, 0.85));

  // ---- red plastic: push handle grip, front bumper, the child seat (seat plate + backrest) ----
  const SEAT_Y = 0.98;
  mesh(g, [
    put(new THREE.CapsuleGeometry(0.052, 1.5, 4, 12), 0, 1.47, -2.2, 0, 0, Math.PI / 2),
    put(new THREE.CapsuleGeometry(0.07, 0.86, 4, 12), 0, -0.1, 1.86, 0, 0, Math.PI / 2),
    put(new THREE.BoxGeometry(0.84, 0.04, 0.44), 0, SEAT_Y, -1.53),
    put(new THREE.BoxGeometry(0.84, 0.36, 0.035), 0, SEAT_Y + 0.17, -1.3, -0.08),
  ], mat('#e3202b', 0.42));

  // ---- the shopping, bouncing around as one load ----
  const load = new THREE.Group();
  g.add(load);
  const white = [], blue = [], brown = [], green = [], red = [];
  // toilet rolls on the bottom tray, in a blue wrap with brown cores showing
  for (const x of [-0.12, 0.12]) for (const z of [-0.44, -0.2, 0.04]) {
    white.push(put(new THREE.CylinderGeometry(0.115, 0.115, 0.24, 14), x, 0.1, z));
    brown.push(put(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 10), x, 0.222, z));
  }
  blue.push(put(new THREE.BoxGeometry(0.49, 0.09, 0.73), 0, 0.1, -0.2));
  // milk carton: white box with a gabled top and fin, blue band and blue cap
  const MX = 0.3, MZ = 0.68, MH = 0.44, MW = 0.26;
  white.push(put(new THREE.BoxGeometry(MW, MH, MW), MX, YB + MH / 2, MZ, 0, 0.35));
  white.push(put(new THREE.CylinderGeometry(MW / Math.sqrt(3), MW / Math.sqrt(3), MW, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2),
    MX, YB + MH + 0.045, MZ, 0, 0.35, 0, 1, 0.6, 1));
  white.push(put(new THREE.BoxGeometry(MW, 0.05, 0.02), MX, YB + MH + 0.115, MZ, 0, 0.35));
  blue.push(put(new THREE.BoxGeometry(MW + 0.01, 0.13, MW + 0.01), MX, YB + MH * 0.55, MZ, 0, 0.35));
  blue.push(put(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), MX - 0.02, YB + MH + 0.06, MZ - 0.06, 0.55, 0.35));
  // apples, one stacked on the others, with stems and leaves
  const APPLES = [[0.22, -0.32], [0.42, -0.08], [0.1, -0.02], [0.4, -0.5]];
  const AR = 0.095;
  APPLES.forEach(([x, z], i) => {
    const y = YB + AR * 0.92;
    red.push(put(new THREE.SphereGeometry(AR, 12, 8), x, y, z, 0, i, 0, 1, 0.92, 1));
    brown.push(put(new THREE.CylinderGeometry(0.008, 0.01, 0.06, 5), x, y + AR * 0.92 + 0.02, z, 0.3, i));
    green.push(put(new THREE.SphereGeometry(0.03, 6, 4), x + 0.025, y + AR * 0.92 + 0.03, z, 0, i, 0.6, 1.2, 0.3, 0.6));
  });
  red.push(put(new THREE.SphereGeometry(AR, 12, 8), 0.26, YB + AR * 2.6, -0.2, 0, 2, 0, 1, 0.92, 1));
  brown.push(put(new THREE.CylinderGeometry(0.008, 0.01, 0.06, 5), 0.26, YB + AR * 3.55, -0.2, -0.3));
  // cereal box leaning on the left wall, with a red stripe
  const CB = [-0.3, YB + 0.29, 0.95, 0, 0.25, 0.1];
  const cereal = put(new THREE.BoxGeometry(0.42, 0.58, 0.14), ...CB);
  red.push(put(new THREE.BoxGeometry(0.43, 0.12, 0.15), CB[0] - 0.012, CB[1] + 0.15, CB[2], 0, 0.25, 0.1));
  // carrots in the front right corner: tips down, leafy tops up
  const carrots = [], leaves = [];
  for (const [x, z, lean] of [[0.3, 1.3, 0.25], [0.42, 1.42, 0.1], [0.24, 1.5, -0.12]]) {
    const L = 0.46, tx = x + 0.08 * Math.sin(lean), cy = YB + 0.02 + L / 2;
    carrots.push(put(new THREE.ConeGeometry(0.055, L, 9), tx, cy, z, Math.PI + 0.25, 0, lean));
    const topY = cy + L / 2 * Math.cos(0.25), topZ = z + L / 2 * Math.sin(0.25);
    for (let k = -1; k <= 1; k++) leaves.push(put(new THREE.ConeGeometry(0.025, 0.32, 5), tx + 0.06 * k, topY + 0.14, topZ + 0.03, 0.3, 0, -0.35 * k));
  }
  green.push(...leaves);

  mesh(load, white, mat('#f7f6f0', 0.6));
  mesh(load, blue, mat('#3d8fe0', 0.45));
  mesh(load, brown, mat('#7a4a22', 0.8), false);
  mesh(load, green, mat('#37b03c', 0.6));
  mesh(load, red, mat('#e8262e', 0.3));
  mesh(load, cereal, mat('#ffcc1a', 0.55));
  mesh(load, carrots, mat('#ff8a1c', 0.55));

  // baguette poking out of the basket on its own pivot so it can wobble, with pale score marks
  const bag = new THREE.Group();
  bag.position.set(-0.35, YB + 0.06, 0.0);
  load.add(bag);
  const dir = new THREE.Vector3(-0.17, 0.9, 0.4).normalize();
  bag.quaternion.setFromUnitVectors(UP, dir);
  const BL = 1.15, BR = 0.075;
  mesh(bag, put(new THREE.CapsuleGeometry(BR, BL, 4, 12), 0, BL / 2 + BR, 0, 0, 0, 0, 1, 1, 0.9), mat('#d8913a', 0.75));
  const scores = [];
  for (let k = 0; k < 5; k++) scores.push(put(new THREE.SphereGeometry(1, 8, 4), 0, 0.3 + k * 0.21, -BR * 0.86, 0, 0, 0.6, 0.032, 0.085, 0.014));
  mesh(bag, scores, mat('#f5d79a', 0.8), false);

  // ---- rubber duck in the child seat, facing the driver behind ----
  const duck = new THREE.Group();
  duck.position.set(0, SEAT_Y + 0.02, -1.5);
  g.add(duck);
  mesh(duck, [
    put(new THREE.SphereGeometry(0.2, 16, 12), 0, 0.15, 0.02, 0, 0, 0, 1, 0.78, 1.12),     // body
    put(new THREE.SphereGeometry(0.15, 14, 10), 0, 0.41, -0.1),                            // head
    put(new THREE.ConeGeometry(0.07, 0.16, 8), 0, 0.25, 0.22, -0.9),                        // tail
    put(new THREE.SphereGeometry(0.1, 8, 6), 0.17, 0.16, 0.04, 0, 0, 0, 0.35, 0.6, 1),     // wings
    put(new THREE.SphereGeometry(0.1, 8, 6), -0.17, 0.16, 0.04, 0, 0, 0, 0.35, 0.6, 1),
  ], mat('#ffd41f', 0.35));
  mesh(duck, put(new THREE.SphereGeometry(0.1, 10, 6), 0, 0.38, -0.25, 0.15, 0, 0, 0.85, 0.32, 0.8), mat('#ff7a12', 0.4), false);
  mesh(duck, [
    put(new THREE.SphereGeometry(0.026, 8, 6), 0.065, 0.47, -0.225),
    put(new THREE.SphereGeometry(0.026, 8, 6), -0.065, 0.47, -0.225),
  ], mat('#111114', 0.3), false);

  // party hat on the duck's head, googly eyes on the front of the basket
  g.userData.hat = new THREE.Vector3(0, duck.position.y + 0.41 + 0.14, duck.position.z - 0.1);
  g.userData.eyes = new THREE.Vector3(0, 0.9, 2.07);

  // ---- motion: the shopping rattles, the baguette wobbles, the duck bobs and rocks ----
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (3 + 14 * w);
    load.position.y = (0.004 + 0.016 * w) * Math.abs(Math.sin(ph * 1.9));
    load.rotation.z = 0.004 * w * Math.sin(ph * 1.3);
    bag.rotation.x = (0.02 + 0.06 * w) * Math.sin(ph * 1.1);
    bag.rotation.z = (0.015 + 0.04 * w) * Math.sin(ph * 0.8 + 1);
    duck.position.y = SEAT_Y + 0.02 + (0.006 + 0.02 * w) * Math.abs(Math.sin(ph * 1.5 + 0.7));
    duck.rotation.z = (0.03 + 0.08 * w) * Math.sin(ph * 0.9);
  };
  return g;
}
