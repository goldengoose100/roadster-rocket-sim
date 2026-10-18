// Hot Dog: a giant hot dog riding on the car's wheels (Good Luck menu silly body).
// Two soft golden bun halves along z hug a juicy sausage that pokes out at both ends (the ends
// curl up a little), with a wiggly yellow mustard zigzag and a red ketchup wave piped on top.
// The sausage jiggles and wags in its bun and the bun halves flap open a little with speed.
// Looks only. Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';

export const info = { id: 'hotdog', name: 'Hot Dog' };

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// bun halves: loaf-shaped rolls along z (half length, cross-section radii, centre, outward lean)
const BUN_L = 1.95, BUN_RX = 0.36, BUN_RY = 0.4, BUN_X = 0.35, BUN_Y = 0.15, BUN_LEAN = 0.2, BUN_P = 2.6;
const HINGE_Y = -0.15;   // the halves open around this line under the sausage
// sausage: half length, radius, centre height in the middle, and how much the ends curl up
const SL = 2.3, SR = 0.25, SY = 0.43, BEND = 0.028;
const sausY = z => SY + BEND * z * z;
const sausDY = z => 2 * BEND * z;

// a closed tube from rings of points (wrapped, no seam) with a pole at each end; optional vertex colours
function sweep(n, m, point, start, end, colours) {
  const pos = new Float32Array((n * m + 2) * 3), col = colours ? new Float32Array((n * m + 2) * 3) : null, idx = [];
  const v = new THREE.Vector3(), c = new THREE.Color();
  let o = 0;
  const put = () => {
    pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
    if (col) { col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; }
    o += 3;
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { point(i, j, v, c); put(); }
  const id = (i, j) => i * m + (j % m);
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) idx.push(id(i, j), id(i, j + 1), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j));
  const ps = n * m, pe = ps + 1;
  start(v, c); put(); end(v, c); put();
  for (let j = 0; j < m; j++) idx.push(ps, id(0, j + 1), id(0, j), pe, id(n - 1, j), id(n - 1, j + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// one bun half around its own centre: a loaf with a flatter cut face on the inner side (towards x = 0),
// golden crust toasted darker on top and at the ends, soft cream bread on the cut face
function bunGeometry(side) {
  const N = 26, M = 18;
  const crust = new THREE.Color('#f2b45c'), toast = new THREE.Color('#c8772c'), bread = new THREE.Color('#fde6b6');
  const lat = i => -Math.PI / 2 + Math.PI * (i + 1) / (N + 1);   // rings bunch up towards the rounded ends
  const loaf = s => Math.pow(1 - Math.pow(Math.abs(s), BUN_P), 1 / BUN_P);
  return sweep(N, M, (i, j, v, c) => {
    const s = Math.sin(lat(i)), f = loaf(s), psi = (j / M) * Math.PI * 2;
    const cx = Math.cos(psi), cy = Math.sin(psi), inward = -side * cx;
    v.set(BUN_RX * f * cx * (inward > 0 ? 0.78 : 1), BUN_RY * f * cy * (cy < 0 ? 0.9 : 1), BUN_L * s);
    const cut = ss(0.2, 0.6, inward) * (1 - ss(0.6, 0.92, cy)) * (1 - ss(0.8, 0.97, Math.abs(s)));
    c.copy(crust).lerp(toast, Math.min(1, 0.75 * ss(-0.1, 0.95, cy) + 0.45 * ss(0.7, 1, Math.abs(s)))).lerp(bread, cut);
  }, (v, c) => { v.set(0, 0, -BUN_L); c.copy(toast); }, (v, c) => { v.set(0, 0, BUN_L); c.copy(toast); }, true);
}

// the sausage: a long capsule along z whose ends curl up, browned on top and at the tips
function sausageGeometry() {
  const CAP = SR * 1.15, K = 7, MID = 30, M = 16;
  const rings = [];   // [z, radius]
  for (let k = 1; k <= K; k++) { const a = (k / K) * Math.PI / 2; rings.push([-(SL - CAP) - CAP * Math.cos(a), SR * Math.sin(a)]); }
  for (let k = 1; k < MID; k++) rings.push([-(SL - CAP) + 2 * (SL - CAP) * k / MID, SR]);
  for (let k = K; k >= 1; k--) { const a = (k / K) * Math.PI / 2; rings.push([(SL - CAP) + CAP * Math.cos(a), SR * Math.sin(a)]); }
  const base = new THREE.Color('#d4532f'), brown = new THREE.Color('#a53a20'), tip = new THREE.Color('#7e2a18');
  const T = new THREE.Vector3(), U = new THREE.Vector3();
  return sweep(rings.length, M, (i, j, v, c) => {
    const [z, r] = rings[i], th = (j / M) * Math.PI * 2;
    T.set(0, sausDY(z), 1).normalize();
    U.set(0, T.z, -T.y);
    v.set(r * Math.cos(th), sausY(z), z).addScaledVector(U, r * Math.sin(th));
    c.copy(base).lerp(brown, 0.55 * ss(0.2, 1, Math.sin(th))).lerp(tip, 0.8 * ss(SL - CAP * 1.1, SL, Math.abs(z)));
  }, (v, c) => { v.set(0, sausY(-SL), -SL); c.copy(tip); }, (v, c) => { v.set(0, sausY(SL), SL); c.copy(tip); }, true);
}

// a line of sauce piped onto the sausage along a path in x(z), sitting on the sausage's surface,
// slightly flattened against it and rounded off at both ends
function sauceGeometry(pathX, z0, z1, n, rw, rh, lift) {
  const P = [], T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i <= n + 1; i++) {   // samples 0 and n + 1 are the poles
    const u = i / (n + 1), z = z0 + (z1 - z0) * u, x = pathX(z);
    P.push(new THREE.Vector3(x, sausY(z) + Math.sqrt(Math.max(0, SR * SR - x * x)) + lift, z));
  }
  const END = 0.03;
  return sweep(n, 6, (i, j, v) => {
    const k = i + 1, u = k / (n + 1), p = P[k];
    T.subVectors(P[k + 1], P[k - 1]).normalize();
    Nn.set(p.x, p.y - lift - sausY(p.z), 0).normalize();   // outward from the sausage
    Nn.addScaledVector(T, -Nn.dot(T)).normalize();
    B.crossVectors(T, Nn);
    const e = Math.min(u, 1 - u) / END, f = e >= 1 ? 1 : Math.sqrt(1 - (1 - e) * (1 - e));
    const th = (j / 6) * Math.PI * 2;
    v.copy(p).addScaledVector(Nn, rh * f * Math.cos(th)).addScaledVector(B, rw * f * Math.sin(th));
  }, v => v.copy(P[0]), v => v.copy(P[n + 1]), false);
}

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const vc = roughness => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness, metalness: 0 });

  // ---- the bun: two halves hinged under the sausage, tops leaning out ----
  const bunMat = vc(0.78);
  const pivots = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, HINGE_Y, 0);
    pivot.userData.side = side;
    g.add(pivot);
    const half = new THREE.Mesh(bunGeometry(side), bunMat);
    half.position.set(side * BUN_X, BUN_Y - HINGE_Y, 0);
    half.rotation.z = -side * BUN_LEAN;
    half.castShadow = true; half.receiveShadow = true;
    pivot.add(half);
    pivots.push(pivot);
  }

  // ---- the sausage with mustard and ketchup (they jiggle together) ----
  const dog = new THREE.Group();
  g.add(dog);
  const sausage = new THREE.Mesh(sausageGeometry(), vc(0.38));
  sausage.castShadow = true; sausage.receiveShadow = true;
  dog.add(sausage);

  // ketchup: a lazy wave underneath, mustard: a bouncy zigzag on top
  const ketchup = new THREE.Mesh(sauceGeometry(z => 0.075 * Math.sin(z * 5.4 + 0.6), -1.92, 1.92, 70, 0.04, 0.03, 0.0),
    mat('#e5161d', 0.25));
  ketchup.castShadow = true;
  dog.add(ketchup);
  const zig = (z) => {   // smooth zigzag: rounded peaks every 0.3 m
    const q = (z + 2) / 0.3;
    return 0.15 * Math.sin(q * Math.PI) * (1.15 - 0.15 * Math.cos(2 * q * Math.PI));
  };
  const mustard = new THREE.Mesh(sauceGeometry(zig, -1.98, 1.98, 120, 0.055, 0.045, 0.03), mat('#ffcc12', 0.3));
  mustard.castShadow = true;
  dog.add(mustard);

  // ---- go-kart axles so the wheels look attached to something ----
  const metal = mat('#3b3f45', 0.45, 0.7);
  const axleGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10).rotateZ(Math.PI / 2);
  for (const z of [1.36, -1.34]) {
    const a = new THREE.Mesh(axleGeo, metal);
    a.position.set(0, -0.1, z);
    g.add(a);
  }

  // party hat in the middle of the top, googly eyes on the sausage's front tip
  g.userData.hat = new THREE.Vector3(0, sausY(0) + SR + 0.07, 0);
  g.userData.eyes = new THREE.Vector3(0, sausY(SL) + 0.05, SL - 0.01);

  // ---- motion: the sausage jiggles and wags, the bun halves flap open a little with speed ----
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (3 + 10 * w);
    dog.position.y = 0.014 * (0.35 + w) * Math.sin(ph * 1.3);
    dog.rotation.y = 0.012 * (0.4 + w) * Math.sin(ph * 0.8);
    for (const p of pivots) p.rotation.z = -p.userData.side * (0.01 + 0.045 * w) * (0.5 + 0.5 * Math.sin(ph * 1.7 + p.userData.side));
  };
  return g;
}
