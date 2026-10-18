// Bathtub: a giant clawfoot bathtub riding on the car's wheels (Good Luck menu silly body).
// A white roll-top tub with both ends raised, standing on four golden claw-and-ball feet next to the
// wheels, golden hot and cold taps (red and blue caps) on the front rim with a shower riser arching
// back over the tub and dripping into the water. Blue bath water full of foam bubbles, and a little
// yellow rubber duck bobbing in it, facing the driver behind. Looks only.
// Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const info = { id: 'bathtub', name: 'Bathtub' };

const N = 2.5;          // superellipse power of the tub's plan: an oval with fuller, squarer ends
const RAISE = 0.2;      // how much higher the rim gets at the two ends
const WATER_Y = 0.74;
const DUCK = new THREE.Vector3(0, WATER_Y, -0.25);
const SHOWER = new THREE.Vector3(0, 1.46, 1.62);   // centre of the shower head's face
// tub cross-sections, from the outside bottom, over the rolled rim, down the inside to under the water:
// [half-width x, half-length z, height y, share of the raised ends]
const RINGS = [
  [0.4, 1.48, -0.05, 0], [0.5, 1.6, -0.02, 0], [0.58, 1.72, 0.08, 0], [0.66, 1.86, 0.28, 0.1],
  [0.74, 1.98, 0.52, 0.4], [0.8, 2.07, 0.76, 0.8], [0.84, 2.13, 0.92, 1], [0.865, 2.155, 0.99, 1],
  [0.86, 2.15, 1.05, 1], [0.83, 2.12, 1.085, 1], [0.79, 2.08, 1.08, 1], [0.765, 2.055, 1.04, 1],
  [0.75, 2.04, 0.98, 1], [0.7, 1.94, 0.8, 0.6], [0.6, 1.76, 0.55, 0.2], [0.48, 1.56, 0.35, 0],
];

// point on a superellipse of half-sizes a (x) and b (z) at angle th; also returns |z| / b in out.zn
function se(th, a, b, out) {
  const c = Math.cos(th), s = Math.sin(th);
  out.x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / N);
  out.zn = Math.pow(Math.abs(s), 2 / N);
  out.z = b * Math.sign(s) * out.zn;
  return out;
}

// a closed tube from rings of points (wrapped, no seam) with a pole at each end
function sweep(n, m, point, start, end) {
  const pos = new Float32Array((n * m + 2) * 3), idx = [];
  const v = new THREE.Vector3();
  let o = 0;
  const put = () => { pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z; o += 3; };
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { point(i, j, v); put(); }
  const id = (i, j) => i * m + (j % m);
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) idx.push(id(i, j), id(i, j + 1), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j));
  const ps = n * m, pe = ps + 1;
  start(v); put(); end(v); put();
  for (let j = 0; j < m; j++) idx.push(ps, id(0, j + 1), id(0, j), pe, id(n - 1, j), id(n - 1, j + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tubGeometry() {
  const M = 36, p = { x: 0, z: 0, zn: 0 };
  return sweep(RINGS.length, M, (i, j, v) => {
    const [a, b, y, r] = RINGS[i];
    se(-(j / M) * Math.PI * 2, a, b, p);   // clockwise seen from above, so the faces point out
    v.set(p.x, y + RAISE * r * p.zn * p.zn * p.zn, p.z);
  }, v => v.set(0, -0.06, 0), v => v.set(0, 0.33, 0));
}

// the water surface: a flat superellipse a little bigger than the inside of the tub at water level
function waterGeometry() {
  const geo = new THREE.CircleGeometry(1, 48), pa = geo.attributes.position, p = { x: 0, z: 0, zn: 0 };
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), rr = Math.hypot(x, y);
    se(Math.atan2(y, x), 0.69, 1.92, p);
    pa.setXYZ(i, p.x * rr, p.z * rr, 0);
  }
  return geo.rotateX(-Math.PI / 2);
}

// one golden claw foot: a knobbly ankle under the tub, a splayed leg, and three claws gripping a ball
function footGeometry(sx, sz) {
  const A = new THREE.Vector3(0.36 * sx, 0.12, 1.5 * sz), B = new THREE.Vector3(0.46 * sx, -0.19, 1.86 * sz);
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), q = new THREE.Quaternion();
  const parts = [];
  parts.push(new THREE.SphereGeometry(0.1, 8, 6).scale(1, 0.8, 1.2).translate(A.x, A.y, A.z));
  d.subVectors(A, B);
  const len = d.length();
  q.setFromUnitVectors(up, d.normalize());
  parts.push(new THREE.CylinderGeometry(0.075, 0.05, len, 8).applyQuaternion(q)
    .translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2));
  parts.push(new THREE.SphereGeometry(0.075, 8, 6).translate(B.x, B.y, B.z));
  const out = Math.atan2(sz, sx * 0.6);   // claws spread over the side of the ball facing away from the tub
  for (let k = -1; k <= 1; k++) {
    const phi = out + k * 0.9, cx = Math.cos(phi), cz = Math.sin(phi);
    q.setFromUnitVectors(up, d.set(cx * 0.55, -1, cz * 0.55).normalize());
    parts.push(new THREE.ConeGeometry(0.028, 0.11, 5).applyQuaternion(q).translate(B.x + cx * 0.065, B.y + 0.025, B.z + cz * 0.065));
  }
  return mergeGeometries(parts);
}

// a bent pipe along a few points
const pipe = (pts, r, seg) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), seg, r, 8, false);

// the little rubber duck, built facing +z: round body with a perky tail, head, orange beak, black eyes
function duckParts() {
  const body = new THREE.SphereGeometry(1, 14, 10), pa = body.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    pa.setXYZ(i, x * 0.21, y * 0.15 + 0.06 + (z < 0 && y > -0.3 ? 0.13 * z * z * (y + 0.3) : 0), z * 0.27);
  }
  body.computeVertexNormals();
  const head = new THREE.SphereGeometry(0.13, 12, 9).translate(0, 0.29, 0.12);
  const beak = new THREE.SphereGeometry(1, 10, 6).scale(0.075, 0.032, 0.08).translate(0, 0.265, 0.25);
  const eye = new THREE.SphereGeometry(0.024, 6, 4);
  const eyes = mergeGeometries([eye.clone().translate(0.065, 0.33, 0.22), eye.clone().translate(-0.065, 0.33, 0.22)]);
  return { yellow: mergeGeometries([body, head]), beak, eyes };
}

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const add = (geo, m, parent = g, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = shadow; o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const gold = mat('#ffc53a', 0.28, 0.8);

  // ---- the tub ----
  add(tubGeometry(), mat('#fbfcff', 0.2));

  // ---- bath water with foam bubbles on it (they bob together) ----
  const bath = new THREE.Group();
  g.add(bath);
  add(waterGeometry(), mat('#36b4ff', 0.08, 0.1), bath, false).position.y = WATER_Y;
  const BUBBLES = [
    [-0.38, 1.25, 0.15], [-0.22, 1.38, 0.11], [-0.45, 1.05, 0.09], [-0.28, 1.12, 0.08],
    [0.36, 0.55, 0.13], [0.47, 0.72, 0.08], [0.25, 0.42, 0.07], [-0.05, 0.25, 0.06],
    [-0.35, -0.85, 0.14], [-0.48, -0.65, 0.09], [-0.2, -1.0, 0.08], [0.5, -0.4, 0.06],
    [0.32, -1.3, 0.12], [0.18, -1.48, 0.09], [0.45, -1.1, 0.07], [-0.1, -1.68, 0.1],
    [0.3, 1.5, 0.08], [-0.52, 0.2, 0.07],
  ];
  const ball = new THREE.SphereGeometry(1, 8, 6);
  add(mergeGeometries(BUBBLES.map(([x, z, r]) => ball.clone().scale(r, r * 0.75, r).translate(x, WATER_Y + r * 0.3, z))),
    mat('#ffffff', 0.55), bath);

  // ---- the rubber duck, facing the chase camera ----
  const duck = new THREE.Group();
  duck.position.copy(DUCK);
  duck.rotation.y = Math.PI;
  g.add(duck);
  const dp = duckParts();
  add(dp.yellow, mat('#ffd60a', 0.35), duck);
  add(dp.beak, mat('#ff8a1c', 0.4), duck);
  add(dp.eyes, mat('#141414', 0.3), duck, false);

  // ---- gold: claw feet, the taps on the front rim, the spout and the shower riser ----
  const TZ = 2.08, TY = 1.4;   // the tap bar along the top of the front rim
  const goldParts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) goldParts.push(footGeometry(sx, sz));
  goldParts.push(new THREE.CylinderGeometry(0.045, 0.045, 0.56, 10).rotateZ(Math.PI / 2).translate(0, TY, TZ));
  for (const sx of [-1, 1]) {
    goldParts.push(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 8).translate(0.22 * sx, TY - 0.08, TZ));      // leg into the rim
    goldParts.push(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 6).translate(0.22 * sx, TY + 0.06, TZ));   // handle stem
    goldParts.push(new THREE.BoxGeometry(0.2, 0.03, 0.03).translate(0.22 * sx, TY + 0.1, TZ));             // cross handle
    goldParts.push(new THREE.BoxGeometry(0.03, 0.03, 0.2).translate(0.22 * sx, TY + 0.1, TZ));
  }
  goldParts.push(pipe([[0, TY, TZ], [0, TY + 0.02, 1.95], [0, TY - 0.03, 1.86], [0, TY - 0.1, 1.82]], 0.04, 10));
  goldParts.push(pipe([[0, TY, TZ], [0, 1.52, 2.1], [0, 1.58, 1.98], [0, 1.58, 1.78], [0, SHOWER.y + 0.07, SHOWER.z]], 0.033, 20));
  goldParts.push(new THREE.CylinderGeometry(0.06, 0.17, 0.08, 18).translate(SHOWER.x, SHOWER.y + 0.04, SHOWER.z));
  add(mergeGeometries(goldParts), gold);
  // hot and cold caps on the handles, and the sprinkler face under the shower head
  const capGeo = new THREE.SphereGeometry(0.04, 8, 6);
  add(capGeo.clone().translate(0.22, TY + 0.13, TZ), mat('#ff3434', 0.35));
  add(capGeo.clone().translate(-0.22, TY + 0.13, TZ), mat('#2f86ff', 0.35));
  add(new THREE.CircleGeometry(0.16, 18).rotateX(Math.PI / 2).translate(SHOWER.x, SHOWER.y - 0.002, SHOWER.z),
    mat('#fff1b0', 0.4, 0.3), g, false);

  // ---- shower drips falling into the bath ----
  const dropGeo = new THREE.SphereGeometry(1, 6, 4).scale(0.022, 0.04, 0.022);
  const dropMat = mat('#9fe0ff', 0.1);
  const drops = [];
  for (let k = 0; k < 6; k++) {
    const a = k * 2.4;
    const d = add(dropGeo, dropMat, g, false);
    d.userData.x = SHOWER.x + 0.1 * Math.cos(a); d.userData.z = SHOWER.z + 0.1 * Math.sin(a);
    d.position.set(d.userData.x, SHOWER.y - 0.05 - 0.1 * k, d.userData.z);
    drops.push(d);
  }

  // ---- go-kart axles so the wheels look attached to something ----
  const axle = new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10).rotateZ(Math.PI / 2);
  add(mergeGeometries([axle.clone().translate(0, -0.1, 1.36), axle.clone().translate(0, -0.1, -1.34)]),
    mat('#3b3f45', 0.45, 0.7), g, false);

  // party hat on the duck's head, googly eyes on the front end of the tub
  g.userData.hat = new THREE.Vector3(DUCK.x, DUCK.y + 0.42, DUCK.z - 0.12);
  g.userData.eyes = new THREE.Vector3(0, 0.55, 1.96);

  // ---- motion: the water sloshes up and down, the duck bobs and rocks, the shower drips ----
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (2 + 6 * w);
    const slosh = 0.008 * (0.4 + w) * Math.sin(ph * 1.6);
    bath.position.y = slosh;
    duck.position.y = DUCK.y + slosh + 0.012 * (0.5 + w) * Math.sin(ph * 2.3);
    duck.rotation.z = 0.06 * (0.4 + w) * Math.sin(ph * 1.3);
    duck.rotation.x = 0.05 * (0.4 + w) * Math.sin(ph * 1.7 + 1);
    for (let k = 0; k < drops.length; k++) {
      const f = (t * 1.3 + k / drops.length) % 1;
      drops[k].position.set(drops[k].userData.x, SHOWER.y - 0.04 - 0.68 * f * f, drops[k].userData.z - 0.3 * w * f);
    }
  };
  return g;
}
