// Silly body: a comfy couch driving around on a magic living-room rug (Good Luck menu silly body).
// A chunky teal sofa with rolled arms, three seat cushions, three back cushions and two throw pillows,
// a giant red-and-white striped popcorn bucket on the middle seat (kernels keep popping out of it),
// a TV remote lying on the left arm, a fringed floor lamp glowing behind the couch, and at the front a
// retro orange TV on a wooden cabinet facing the couch, with rabbit-ear antennas and a cartoon ball
// bouncing on its screen (it flips channels every few seconds). Everything rides on a purple rug that
// sits between the real wheels. Looks only. Car space: +z forward, y up, ground at y = -0.45,
// wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const info = { id: 'couch', name: 'Couch' };

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
// move / turn / scale a fresh geometry into place
function put(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  return geo.applyMatrix4(_m);
}
// a straight bar from a to b
function rod(a, b, r, seg = 6) {
  _d.subVectors(b, a);
  const geo = new THREE.CylinderGeometry(r, r, _d.length(), seg, 1, true);
  geo.applyQuaternion(_q.setFromUnitVectors(UP, _d.normalize()));
  return geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// non-indexed copy with one flat vertex colour, for the multi-coloured meshes
function tint(geo, hex) {
  const q = geo.index ? geo.toNonIndexed() : geo;
  const n = q.attributes.position.count, c = new THREE.Color(hex), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  q.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return q;
}
const rbox = (w, h, d, seg, r) => new RoundedBoxGeometry(w, h, d, seg, r);
const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  // RoundedBoxGeometry has no index, so merge everything as plain triangle lists when it is mixed in
  const merge = geos => mergeGeometries(geos.some(q => !q.index) ? geos.map(q => (q.index ? q.toNonIndexed() : q)) : geos);
  const mesh = (parent, geos, material, shadow = true) => {
    const m = new THREE.Mesh(Array.isArray(geos) ? merge(geos) : geos, material);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const vcMat = mat('#ffffff', 0.6, 0, { vertexColors: true });
  const vc = [];   // static multi-coloured bits: pillows, rug fringe and pattern, remote buttons, TV knobs, spilled popcorn
  const dark = [], wood = [];

  // ---- the rug: yellow border, purple middle, cream fringe, pink diamonds; axles out to the wheels ----
  const RUG_Y = -0.158;
  mesh(g, put(new THREE.BoxGeometry(1.4, 0.04, 4.36), 0, -0.18, 0), mat('#ffc61a', 0.85));
  mesh(g, put(new THREE.BoxGeometry(1.18, 0.042, 4.14), 0, -0.179, 0), mat('#7b3fd1', 0.9));
  for (const zs of [-1, 1]) for (let i = 0; i <= 8; i++) {
    vc.push(tint(put(new THREE.BoxGeometry(0.03, 0.014, 0.1), -0.56 + i * 0.14, -0.18, zs * 2.22), '#fff4d6'));
  }
  for (const z of [-1.78, 0.78]) vc.push(tint(put(new THREE.BoxGeometry(0.4, 0.004, 0.4), 0, RUG_Y + 0.002, z, 0, Math.PI / 4), '#ff6fae'));
  for (const z of [1.36, -1.34]) dark.push(put(new THREE.CylinderGeometry(0.045, 0.045, 1.62, 8), 0, -0.1, z, 0, 0, Math.PI / 2));

  // ---- the couch frame: seat base, two rolled arms, backrest with a rolled top ----
  const CZ = -0.27;   // middle of the couch along the car
  mesh(g, [
    put(rbox(1.56, 0.3, 1.22, 1, 0.05), 0, 0.15, CZ),
    put(rbox(0.24, 0.6, 1.3, 1, 0.06), 0.87, 0.3, CZ),
    put(rbox(0.24, 0.6, 1.3, 1, 0.06), -0.87, 0.3, CZ),
    put(new THREE.CylinderGeometry(0.13, 0.13, 1.3, 12), 0.87, 0.62, CZ, Math.PI / 2),
    put(new THREE.CylinderGeometry(0.13, 0.13, 1.3, 12), -0.87, 0.62, CZ, Math.PI / 2),
    put(rbox(1.98, 0.84, 0.24, 1, 0.06), 0, 0.42, -0.8),
    put(new THREE.CylinderGeometry(0.125, 0.125, 1.98, 16), 0, 0.86, -0.8, 0, 0, Math.PI / 2),
  ], mat('#1fa89c', 0.8));
  // stubby wooden legs standing on the rug
  for (const x of [-0.62, 0.62]) for (const z of [-0.8, 0.26]) wood.push(put(new THREE.CylinderGeometry(0.045, 0.03, 0.16, 8), x, -0.08, z));

  // ---- cushions (they squish up and down a little as the couch drives) ----
  const XS = [-0.505, 0, 0.505], TILT = [0.03, -0.02, -0.035];
  const cushions = mesh(g, [
    ...XS.map(x => put(rbox(0.5, 0.2, 1.0, 2, 0.07), x, 0.38, -0.17)),
    ...XS.map((x, i) => put(rbox(0.5, 0.5, 0.22, 2, 0.09), x, 0.73, -0.56, -0.14, 0, TILT[i])),
  ], mat('#4fd6c8', 0.85));
  // throw pillows propped in the corners: pink on the left, yellow on the right
  vc.push(tint(put(rbox(0.36, 0.36, 0.12, 1, 0.05), -0.55, 0.71, -0.38, -0.3, 0.35, 0.6), '#ff6fae'));
  vc.push(tint(put(rbox(0.36, 0.36, 0.12, 1, 0.05), 0.55, 0.71, -0.38, -0.3, -0.35, -0.6), '#ffd23f'));

  // ---- TV remote lying on the left arm ----
  const RM = new THREE.Matrix4().compose(new THREE.Vector3(-0.87, 0.7675, -0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.3, 0)), new THREE.Vector3(1, 1, 1));
  dark.push(rbox(0.1, 0.035, 0.32, 1, 0.015).applyMatrix4(RM));
  const btn = (x, z, r, hex) => vc.push(tint(new THREE.CylinderGeometry(r, r, 0.012, 8).translate(x, 0.019, z).applyMatrix4(RM), hex));
  btn(0, 0.11, 0.018, '#ff2a2a');
  [['#2f7bff', '#3ccf4e'], ['#ffd23f', '#ffffff'], ['#ff8a1c', '#c86bff']].forEach((row, j) =>
    row.forEach((hex, i) => btn(-0.022 + 0.044 * i, 0.045 - 0.05 * j, 0.012, hex)));

  // ---- giant popcorn bucket on the middle seat, kernels popping out ----
  const pop = new THREE.Group();
  pop.position.set(0, 0.48, -0.12);
  g.add(pop);
  const bucket = new THREE.CylinderGeometry(0.2, 0.14, 0.38, 16, 1, true).translate(0, 0.19, 0).toNonIndexed();
  {
    const n = bucket.attributes.position.count, a = new Float32Array(n * 3);
    const red = new THREE.Color('#e8262e'), white = new THREE.Color('#ffffff');
    for (let i = 0; i < n; i++) { const c = Math.floor(i / 6) % 2 ? white : red; a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    bucket.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  mesh(pop, [bucket, tint(put(new THREE.TorusGeometry(0.2, 0.018, 6, 20), 0, 0.38, 0, Math.PI / 2), '#ffffff')],
    mat('#ffffff', 0.45, 0, { vertexColors: true, side: THREE.DoubleSide }));
  const kernel = (r, x, y, z, i) => put(new THREE.IcosahedronGeometry(r, 0), x, y, z, i, i * 2, 0);
  const corn = [put(new THREE.SphereGeometry(0.195, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.37, 0, 0, 0, 0, 1, 0.55, 1)];
  const NK = 20;
  for (let i = 0; i < NK; i++) {
    const r = 0.17 * Math.sqrt((i + 0.5) / NK), a = i * 2.39996;
    const y = 0.38 + 0.107 * Math.sqrt(Math.max(0, 1 - (r / 0.195) ** 2)) + 0.015;
    corn.push(kernel(0.045 + 0.02 * hash(i), r * Math.cos(a), y, r * Math.sin(a), i));
  }
  const popMat = mat('#fff1c2', 0.75);
  mesh(pop, corn, popMat);
  const POPS = [[0.04, 0.03], [-0.06, 0.04], [0.02, -0.07]];
  const poppers = POPS.map(([x, z], k) => {
    const m = mesh(pop, new THREE.IcosahedronGeometry(0.05, 0), popMat, false);
    m.position.set(x, 0.47, z); m.rotation.set(k, k * 2, 0);
    return m;
  });
  // a few kernels spilled on the seat and the rug
  for (const [x, y, z] of [[-0.3, 0.5, 0.1], [0.27, 0.5, 0.18], [0.12, 0.5, 0.28], [-0.2, RUG_Y + 0.03, 0.6], [0.3, RUG_Y + 0.03, 0.9]]) {
    vc.push(tint(new THREE.IcosahedronGeometry(0.045, 0).translate(x, y, z), '#fff1c2'));
  }

  // ---- retro TV on a wooden cabinet at the front, facing the couch ----
  wood.push(put(rbox(1.0, 0.5, 0.62, 1, 0.04), 0, 0.1, 1.62));
  vc.push(tint(put(new THREE.SphereGeometry(0.03, 8, 6), -0.12, 0.12, 1.31), '#ffd23f'));
  vc.push(tint(put(new THREE.SphereGeometry(0.03, 8, 6), 0.12, 0.12, 1.31), '#ffd23f'));
  mesh(g, [put(rbox(0.86, 0.6, 0.5, 1, 0.07), 0, 0.65, 1.6), put(rbox(0.62, 0.44, 0.3, 1, 0.07), 0, 0.64, 1.95)], mat('#ff8c1a', 0.45));
  const SX = 0.07, SY = 0.66;   // screen centre
  dark.push(put(new THREE.BoxGeometry(0.64, 0.48, 0.03), SX, SY, 1.345));
  for (const y of [0.74, 0.57]) vc.push(tint(put(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), -0.33, y, 1.34, Math.PI / 2), '#f2f2f2'));
  const CH = ['#3aa8ff', '#ff5fb0', '#44d36b', '#b46bff'].map(h => new THREE.Color(h));
  const screenMat = mat('#111111', 0.3, 0, { emissive: CH[0].clone(), emissiveIntensity: 0.9 });
  mesh(g, put(new THREE.BoxGeometry(0.56, 0.4, 0.02), SX, SY, 1.325), screenMat, false);
  const ball = mesh(g, put(new THREE.CylinderGeometry(0.04, 0.04, 0.006, 12), 0, 0, 0, Math.PI / 2),
    mat('#ffe14d', 0.4, 0, { emissive: '#ffd21a', emissiveIntensity: 0.6 }), false);
  ball.position.set(SX, SY, 1.311);
  // rabbit-ear antennas on a little dome, they wobble
  dark.push(put(new THREE.SphereGeometry(0.07, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.95, 1.72));
  const ant = new THREE.Group();
  ant.position.set(0, 0.97, 1.72);
  g.add(ant);
  const antParts = [];
  for (const s of [-1, 1]) {
    const tip = new THREE.Vector3(s * 0.3, 0.46, 0.08);
    antParts.push(rod(new THREE.Vector3(s * 0.03, 0, 0), tip, 0.01, 6));
    antParts.push(new THREE.SphereGeometry(0.028, 8, 6).translate(tip.x, tip.y, tip.z));
  }
  mesh(ant, antParts, mat('#d4dbe3', 0.25, 0.85));

  // ---- floor lamp behind the couch: brass pole, glowing yellow shade with pink pom-pom trim ----
  const lamp = new THREE.Group();
  lamp.position.set(-0.5, RUG_Y, -1.32);
  g.add(lamp);
  mesh(lamp, [put(new THREE.CylinderGeometry(0.14, 0.16, 0.04, 16), 0, 0.02, 0), put(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 8), 0, 0.74, 0)],
    mat('#d6a93a', 0.35, 0.6));
  mesh(lamp, put(new THREE.CylinderGeometry(0.13, 0.25, 0.3, 18, 1, true), 0, 1.52, 0),
    mat('#ffe066', 0.7, 0, { side: THREE.DoubleSide, emissive: '#ffc93a', emissiveIntensity: 0.25 }));
  const trim = [put(new THREE.TorusGeometry(0.25, 0.02, 4, 18), 0, 1.37, 0, Math.PI / 2)];
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.2; trim.push(new THREE.SphereGeometry(0.028, 6, 4).translate(0.25 * Math.cos(a), 1.32, 0.25 * Math.sin(a))); }
  mesh(lamp, trim, mat('#ff6fae', 0.7), false);
  mesh(lamp, new THREE.SphereGeometry(0.065, 10, 8).translate(0, 1.44, 0), mat('#fff6cc', 0.3, 0, { emissive: '#ffe9a0', emissiveIntensity: 1.3 }), false);

  // ---- the merged static meshes ----
  mesh(g, dark, mat('#2a2b33', 0.5, 0.4));
  mesh(g, wood, mat('#b8733d', 0.7));
  mesh(g, vc, vcMat);

  // party hat on the middle of the backrest, googly eyes on the back of the TV
  g.userData.hat = new THREE.Vector3(0, 0.985, -0.8);
  g.userData.eyes = new THREE.Vector3(0, 0.68, 2.1);

  // ---- motion: popcorn pops and the bucket jiggles, cushions squish, the lamp and antennas wobble,
  // a ball bounces on the TV and the channel changes every few seconds ----
  let last = -1, ph = 0, chT = 0, ch = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (3 + 12 * w);
    pop.position.y = 0.48 + (0.003 + 0.016 * w) * Math.abs(Math.sin(ph * 1.7));
    pop.rotation.z = 0.04 * w * Math.sin(ph * 1.2);
    for (let k = 0; k < 3; k++) {
      const u = ph * 0.3 + k * 0.37, f = u - Math.floor(u), p = poppers[k];
      p.position.set(POPS[k][0] * (1 + 1.5 * f), 0.47 + (0.12 + 0.25 * w) * 4 * f * (1 - f), POPS[k][1] * (1 + 1.5 * f));
      p.rotation.x = k + f * 6;
    }
    cushions.position.y = (0.002 + 0.008 * w) * Math.abs(Math.sin(ph * 1.3 + 0.5));
    lamp.rotation.x = -0.04 * w + (0.015 + 0.04 * w) * Math.sin(ph * 0.9);
    lamp.rotation.z = (0.01 + 0.03 * w) * Math.sin(ph * 0.7 + 1);
    ant.rotation.z = (0.03 + 0.08 * w) * Math.sin(ph * 1.4);
    const u = t * 0.35, tri = 2 * Math.abs(2 * (u - Math.floor(u + 0.5))) - 1;
    ball.position.x = SX + 0.22 * tri;
    ball.position.y = SY - 0.155 + 0.29 * Math.abs(Math.sin(t * 3.2));
    chT += dt;
    if (chT > 2.6) { chT = 0; ch = (ch + 1) % CH.length; screenMat.emissive.copy(CH[ch]); }
  };
  return g;
}
