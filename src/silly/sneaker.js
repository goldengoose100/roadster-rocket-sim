// Giant Sneaker: a huge comfy trainer riding on the car's wheels (Good Luck menu silly body).
// A thick white sole with a blue tread layer and a curled-up toe, a red upper with a white rubber
// toe bumper, a yellow zigzag flash down each side, chunky white laces criss-crossing between silver
// eyelets up to a bow, a padded yellow collar round the dark ankle opening, the tongue sticking up at
// the back-top and a little pull loop on the heel. The bow's lace ends flap in the wind and the
// tongue wobbles. Looks only. Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const info = { id: 'sneaker', name: 'Giant Sneaker' };

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bell = (x, m, s) => Math.exp(-((x - m) / s) * ((x - m) / s));
// 1 along the middle, rounding off like a circle over the last r0 metres before z0 and r1 before z1
function roundEnds(z, z0, z1, r0, r1) {
  let f = 1;
  if (z < z0 + r0) { const q = (z0 + r0 - z) / r0; f *= Math.sqrt(Math.max(0, 1 - q * q)); }
  if (z > z1 - r1) { const q = (z - z1 + r1) / r1; f *= Math.sqrt(Math.max(0, 1 - q * q)); }
  return f;
}
// smooth curve through [z, y] knots (cubic Hermite, slopes taken from the neighbours)
function spline(k) {
  const m = k.map((p, i) => { const a = k[Math.max(0, i - 1)], b = k[Math.min(k.length - 1, i + 1)]; return (b[1] - a[1]) / (b[0] - a[0]); });
  return z => {
    if (z <= k[0][0]) return k[0][1];
    if (z >= k[k.length - 1][0]) return k[k.length - 1][1];
    let i = 0;
    while (z > k[i + 1][0]) i++;
    const h = k[i + 1][0] - k[i][0], t = (z - k[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * k[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (3 * t2 - 2 * t3) * k[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}
// ring positions along z, bunched up towards both ends so the round heel and toe stay smooth
const ringZ = (i, n, z0, z1) => (z0 + z1) / 2 + (z1 - z0) / 2 * Math.sin(-Math.PI / 2 + Math.PI * (i + 1) / (n + 1));

// ---- sole: heel at SH, toe at ST, widest across the ball of the foot, a slight waist under the arch ----
const SH = -2.24, ST = 2.3;
const soleBaseW = z => 0.6 + 0.07 * bell(z, 1.0, 0.75) - 0.045 * bell(z, -0.2, 0.6);
const soleW = z => soleBaseW(z) * roundEnds(z, SH, ST, 0.5, 0.7);
const spring = z => { const q = Math.max(0, (z - 1.15) / 1.15); return 0.22 * q * q; };   // the toe curls up
const soleBot = z => { const q = Math.max(0, (-1.8 - z) / 0.44); return -0.25 + spring(z) + 0.05 * q * q; };
const soleTop = z => 0.05 + 0.04 * ss(0.5, -1.5, z) + 0.9 * spring(z);   // a little thicker under the heel
// sole cross-section (u across, v up), counter-clockwise seen from the front: flat tread, rounded
// bottom edge, blue outsole up to v = 0.3, then a bulging white midsole
const SP = [[0, 0], [0.7, 0], [0.9, 0.04], [0.98, 0.13], [1, 0.24], [1, 0.3], [1, 0.33], [1.02, 0.6], [0.98, 0.86], [0.88, 0.98], [0.6, 1], [0, 1]];
const SOLE_PROF = SP.concat(SP.slice(1, -1).reverse().map(([u, v]) => [-u, v]));

// ---- upper: heel at UH, toe at UT; superellipse cross-sections, flatter on top round the ankle ----
const UH = -2.17, UT = 2.22;
const upW = z => (soleBaseW(z) - 0.06) * roundEnds(z, UH, UT, 0.45, 0.66);
const upY0 = z => soleTop(z) - 0.05;
const upP = z => 2.6 + 1.2 * ss(-0.5, -1.3, z);
// height of the top above the sole: collar at the back, laces sloping down, then the round toe box
const upH = spline([[-2.17, 0.9], [-1.9, 0.88], [-1.4, 0.84], [-0.85, 0.88], [-0.4, 0.8], [0.4, 0.64], [1.1, 0.5],
  [1.55, 0.44], [1.9, 0.36], [2.1, 0.26], [2.22, 0.16]]);
const upTop = z => soleTop(z) + upH(z);
// height of the upper's surface above (x, z), and its normal
function surfY(x, z) {
  const w = upW(z), y0 = upY0(z), H = upTop(z) - y0, p = upP(z);
  const a = Math.min(1, Math.abs(x) / Math.max(1e-4, w));
  return y0 + H * Math.pow(1 - Math.pow(a, p), 1 / p);
}
function surfN(x, z, out) {
  const e = 0.005;
  return out.set(-(surfY(x + e, z) - surfY(x - e, z)) / (2 * e), 1, -(surfY(x, z + e) - surfY(x, z - e)) / (2 * e)).normalize();
}

// laces: eyelet rows from the toe end up to the top, and the knot of the bow
const EZ = [0.95, 0.65, 0.35, 0.05, -0.25, -0.55], ZK = -0.63;
// zigzag flash down each side: [z, height on the side (0 bottom .. 1 top), half-height]; pointed at the front
const FLASH = [[-1.95, 0.5, 0.11], [-1.2, 0.66, 0.1], [-0.6, 0.4, 0.09], [0.2, 0.62, 0.075], [0.8, 0.4, 0.055], [1.5, 0.48, 0]];
// ankle opening (an oval on top at the back) and the tongue's root
const CZ = -1.42, CAX = 0.4, CAZ = 0.62, TZ = -0.8, TL = 0.62;

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

function soleGeometry(white, blue) {
  const N = 24;
  const mid = z => (soleBot(z) + soleTop(z)) / 2;
  return sweep(N, SOLE_PROF.length, (i, j, v, c) => {
    const z = ringZ(i, N, SH, ST), [u, t] = SOLE_PROF[j], yb = soleBot(z), yt = soleTop(z);
    v.set(soleW(z) * u, yb + (yt - yb) * t, z);
    c.copy(t <= 0.3 ? blue : white);
  }, (v, c) => { v.set(0, mid(SH), SH); c.copy(white); }, (v, c) => { v.set(0, mid(ST), ST); c.copy(white); }, true);
}

// the upper: mostly top half (17 points over the top, 3 tucked down into the sole), white toe bumper
function upperGeometry(red, white) {
  const N = 36, ANG = [];
  for (let k = 0; k <= 16; k++) ANG.push(Math.PI * k / 16);
  for (let k = 1; k <= 3; k++) ANG.push(Math.PI + Math.PI * k / 4);
  const mid = z => (upY0(z) + upTop(z)) / 2;
  return sweep(N, ANG.length, (i, j, v, c) => {
    const z = ringZ(i, N, UH, UT), w = upW(z), y0 = upY0(z), H = upTop(z) - y0, e = 2 / upP(z);
    const cs = Math.cos(ANG[j]), sn = Math.sin(ANG[j]);
    v.set(w * Math.sign(cs) * Math.pow(Math.abs(cs), e), sn >= 0 ? y0 + H * Math.pow(sn, e) : y0 + 0.03 * sn, z);
    c.copy(red).lerp(white, ss(1.86, 1.96, z));
  }, (v, c) => { v.set(0, mid(UH), UH); c.copy(red); }, (v, c) => { v.set(0, mid(UT), UT); c.copy(white); }, true);
}

// point on the upper's side at height fraction f, lifted off the surface along its normal
function sidePoint(z, f, side, lift, out) {
  const w = upW(z), y0 = upY0(z), H = upTop(z) - y0, p = upP(z);
  const a = Math.pow(1 - Math.pow(f, p), 1 / p);   // x / w at that height
  const nx = Math.pow(a, p - 1) / w, ny = Math.pow(f, p - 1) / H, nl = Math.hypot(nx, ny);
  return out.set(side * (w * a + lift * nx / nl), y0 + H * f + lift * ny / nl, z);
}

// the zigzag flash as a ribbon just off the side (three rows across so it hugs the curve)
function flashGeometry(side) {
  const SUB = 8, S = [];
  for (let s = 0; s < FLASH.length - 1; s++) for (let k = 0; k < SUB; k++) {
    const a = FLASH[s], b = FLASH[s + 1], t = k / SUB;
    S.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  S.push(FLASH[FLASH.length - 1]);
  const pos = [], idx = [], v = new THREE.Vector3();
  for (const [z, f, h] of S) for (let r = 0; r < 3; r++) { sidePoint(z, f + (r - 1) * h, side, 0.012, v); pos.push(v.x, v.y, v.z); }
  for (let i = 0; i < S.length - 1; i++) for (let r = 0; r < 2; r++) {
    const a = i * 3 + r, b = a + 3, c = a + 1, d = b + 1;
    if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// the dark ankle opening: an oval patch hugging the top inside the collar, darker towards the middle
function openingGeometry() {
  const R = 4, A = 24, pos = [], col = [], idx = [];
  const rim = new THREE.Color('#4a4366'), deep = new THREE.Color('#15121f'), c = new THREE.Color();
  const put = (x, z, t) => { pos.push(x, surfY(x, z) + 0.015, z); c.copy(deep).lerp(rim, t * t); col.push(c.r, c.g, c.b); };
  put(0, CZ, 0);
  for (let r = 1; r <= R; r++) for (let a = 0; a < A; a++) {
    const ph = (a / A) * Math.PI * 2;
    put(CAX * (r / R) * Math.sin(ph), CZ + CAZ * (r / R) * Math.cos(ph), r / R);
  }
  const id = (r, a) => 1 + (r - 1) * A + (a % A);
  for (let a = 0; a < A; a++) idx.push(0, id(1, a), id(1, a + 1));
  for (let r = 1; r < R; r++) for (let a = 0; a < A; a++) idx.push(id(r, a), id(r + 1, a), id(r + 1, a + 1), id(r, a), id(r + 1, a + 1), id(r, a + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// the tongue: a padded flap with a rounded top, leaning back a little; built along z, then stood up
function tongueGeometry() {
  const N = 14, M = 16;
  const sp = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);
  return sweep(N, M, (i, j, v) => {
    const u = Math.sin((Math.PI / 2) * (i / N)), th = (j / M) * Math.PI * 2;
    const q = (u - 0.5) / 0.5, top = u > 0.5 ? Math.sqrt(Math.max(0, 1 - q * q)) : 1;
    const w = 0.3 * (1 - 0.15 * u) * top, t = 0.055 * (1 - 0.35 * u) * (0.4 + 0.6 * top);
    v.set(w * sp(Math.cos(th), 2 / 3), 0.1 * u + 0.08 * u * u + t * sp(Math.sin(th), 2 / 3), u * TL);
  }, v => v.set(0, 0, -0.01), v => v.set(0, 0.18, TL), false).rotateX(-Math.PI / 2);
}

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const vc = roughness => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness, metalness: 0 });
  const shade = (m, receive = true) => { m.castShadow = true; m.receiveShadow = receive; return m; };
  const RED = new THREE.Color('#ee3340'), WHITE = new THREE.Color('#fbfaf5'), BLUE = new THREE.Color('#2f6fe0');
  const yellow = mat('#ffd21f', 0.55), laceMat = mat('#ffffff', 0.75), blueMat = mat('#2f6fe0', 0.45);

  // ---- sole, upper and the zigzag flashes ----
  g.add(shade(new THREE.Mesh(soleGeometry(WHITE, BLUE), vc(0.6))));
  g.add(shade(new THREE.Mesh(upperGeometry(RED, WHITE), vc(0.62))));
  g.add(new THREE.Mesh(mergeGeometries([flashGeometry(1), flashGeometry(-1)]), yellow));

  // ---- silver eyelets and the criss-cross laces ----
  const P = new THREE.Vector3(), N = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const q = new THREE.Quaternion(), m4 = new THREE.Matrix4();
  const eyelet = (k, s) => { const x = s * (0.23 + 0.016 * k), z = EZ[k]; P.set(x, surfY(x, z), z); surfN(x, z, N); return P; };
  const ringGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.024, 8), eyeletGeos = [];
  for (let k = 0; k < EZ.length; k++) for (const s of [-1, 1]) {
    eyelet(k, s);
    eyeletGeos.push(ringGeo.clone().applyMatrix4(m4.compose(P.clone().addScaledVector(N, 0.004), q.setFromUnitVectors(Y, N), one)));
  }
  g.add(new THREE.Mesh(mergeGeometries(eyeletGeos), mat('#d7dbe2', 0.3, 0.7)));

  const laceAt = (k, s) => eyelet(k, s).clone().addScaledVector(N, 0.01);
  const K = new THREE.Vector3(0, surfY(0, ZK) + 0.07, ZK);
  const laceGeos = [];
  const lace = (A, B, lift) => {   // arcs up over the top between two points
    const x = (A.x + B.x) / 2, z = (A.z + B.z) / 2;
    const C = new THREE.Vector3(x, surfY(x, z) + lift, z).multiplyScalar(2).addScaledVector(A, -0.5).addScaledVector(B, -0.5);
    laceGeos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(A, C, B), 6, 0.034, 5, false));
  };
  lace(laceAt(0, -1), laceAt(0, 1), 0.04);   // straight bar across at the toe end
  for (let k = 0; k < EZ.length - 1; k++) {
    lace(laceAt(k, -1), laceAt(k + 1, 1), 0.075);   // this one always goes over
    lace(laceAt(k, 1), laceAt(k + 1, -1), 0.045);
  }
  lace(laceAt(EZ.length - 1, -1), K.clone(), 0.06);
  lace(laceAt(EZ.length - 1, 1), K.clone(), 0.06);
  g.add(shade(new THREE.Mesh(mergeGeometries(laceGeos), laceMat), false));

  // ---- the bow: knot and two loops, plus two lace ends with blue tips that flap ----
  const bow = new THREE.Group();
  bow.position.copy(K);
  g.add(bow);
  const loopGeo = new THREE.TorusGeometry(0.12, 0.032, 5, 12).rotateX(Math.PI / 2).scale(1.3, 1, 0.8);
  const bowGeos = [new THREE.SphereGeometry(0.06, 8, 6)];
  for (const s of [-1, 1]) bowGeos.push(loopGeo.clone().rotateZ(-s * 0.35).translate(s * 0.18, -0.01, 0.03));
  bow.add(shade(new THREE.Mesh(mergeGeometries(bowGeos), laceMat), false));
  const tips = [];
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([[0, 0, 0], [0.17, 0.01, -0.03], [0.34, -0.06, -0.07], [0.46, -0.19, -0.12], [0.53, -0.35, -0.17]]
      .map(([x, y, z]) => new THREE.Vector3(s * x, y, z)));
    const end = curve.getPoint(1), tan = curve.getTangent(1);
    const aglet = new THREE.CylinderGeometry(0.038, 0.038, 0.11, 6)
      .applyMatrix4(m4.compose(end.addScaledVector(tan, 0.035), q.setFromUnitVectors(Y, tan), one));
    const pivot = new THREE.Group();
    pivot.userData.side = s;
    pivot.add(shade(new THREE.Mesh(mergeGeometries([new THREE.TubeGeometry(curve, 10, 0.032, 5, false), aglet], true), [laceMat, blueMat]), false));
    bow.add(pivot);
    tips.push(pivot);
  }

  // ---- padded collar round the dark ankle opening ----
  const ring = [];
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2, x = CAX * Math.sin(a), z = CZ + CAZ * Math.cos(a);
    ring.push(new THREE.Vector3(x, surfY(x, z) + 0.035, z));
  }
  g.add(shade(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 36, 0.075, 6, true), yellow)));
  g.add(new THREE.Mesh(openingGeometry(), vc(0.95)));

  // ---- the tongue sticking up out of the opening, with a plain white label on its back ----
  const tongue = new THREE.Group();
  tongue.position.set(0, surfY(0, TZ) - 0.14, TZ);
  g.add(tongue);
  tongue.add(shade(new THREE.Mesh(tongueGeometry(), mat('#ee3340', 0.62))));
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.016), mat('#fbfaf5', 0.5));
  label.position.set(0, 0.62 * TL, -0.141);
  label.rotation.x = -0.31;
  tongue.add(label);

  // ---- pull loop on the heel, leaning back ----
  const tab = shade(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.028, 5, 10, Math.PI), blueMat), false);
  tab.position.set(0, upTop(-2.13) - 0.03, -2.13);
  tab.rotation.x = -0.6;
  g.add(tab);

  // ---- axles out to the real wheels (mostly hidden inside the sole) ----
  const axle = new THREE.CylinderGeometry(0.045, 0.045, 1.62, 8).rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(mergeGeometries([axle.clone().translate(0, -0.1, 1.36), axle.translate(0, -0.1, -1.34)]), mat('#3b3f45', 0.45, 0.7)));

  // party hat on top of the toe box, googly eyes peeking over the toe
  g.userData.hat = new THREE.Vector3(0, upTop(1.45), 1.45);
  g.userData.eyes = new THREE.Vector3(0, 0.43, 2.21);

  // ---- motion: lace ends flap and trail back, the bow jiggles, the tongue wobbles in the wind ----
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (4 + 12 * w);
    for (let k = 0; k < 2; k++) {
      const p = tips[k], s = p.userData.side;
      p.rotation.z = s * (0.05 + 0.5 * w + (0.04 + 0.12 * w) * Math.sin(ph * 1.9 + k * 1.7));   // lift up into the wind
      p.rotation.y = s * (0.12 * w + (0.03 + 0.08 * w) * Math.sin(ph * 1.3 + k));               // and trail back a little
    }
    bow.rotation.z = (0.03 + 0.05 * w) * Math.sin(ph * 2.2);
    tongue.rotation.x = -(0.03 + 0.1 * w) + (0.02 + 0.05 * w) * Math.sin(ph * 1.1);
  };
  return g;
}
