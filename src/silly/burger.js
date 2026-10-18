// Burger: a giant cheeseburger riding on the car's wheels (Good Luck menu silly body).
// A toasted bottom bun, a big juicy patty with ketchup drips down its side, a cheese slice whose
// corners melt down over the edge, a frilly lettuce leaf, a red tomato layer and a tall shiny top bun
// covered in sesame seeds. Stretched a bit along z so it fits the car; the bottom bun is kept narrow
// so the wheels show. The top bun bobs and the lettuce flutters. Looks only.
// Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const info = { id: 'burger', name: 'Burger' };

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// plan shape of every layer: a round burger stretched along z, a little squarer than an ellipse
const PE = 2.25;
const pw = c => Math.sign(c) * Math.pow(Math.abs(c), 2 / PE);
// layer sizes [half-width along x, half-length along z]
const BUN0 = [0.8, 1.7], PATTY = [0.92, 1.82], TOMATO = [0.9, 1.79], BUN1 = [0.93, 1.85];
// profiles [r, y]: r from 0 at the centre to 1 at the rim, from the bottom centre round to the top centre
const BOT_PROF = [[0, -0.25], [0.6, -0.25], [0.82, -0.236], [0.93, -0.2], [0.99, -0.13], [1, -0.04], [0.98, 0.06], [0.94, 0.13],
  [0.88, 0.17], [0.6, 0.185], [0, 0.19]];
const PATTY_PROF = [[0, 0.17], [0.72, 0.17], [0.9, 0.18], [0.97, 0.215], [1, 0.3], [0.98, 0.385], [0.93, 0.43], [0.75, 0.452], [0, 0.458]];
const TOM_PROF = [[0, 0.5], [0.92, 0.5], [0.98, 0.51], [1, 0.525], [0.98, 0.54], [0.92, 0.55], [0, 0.55]];
const TOP_PROF = [[0, 0.565], [0.7, 0.565], [0.92, 0.58], [0.99, 0.625], [1, 0.7], [0.98, 0.86], [0.92, 1.03], [0.81, 1.2],
  [0.64, 1.35], [0.42, 1.46], [0.18, 1.52], [0, 1.535]];
// the top side of a profile (from the rim in to the centre), and its height at r
const PATTY_TOP = PATTY_PROF.slice(4), DOME = TOP_PROF.slice(4);
function heightAt(top, r) {
  r = Math.min(1, Math.max(0, r));
  for (let k = 0; k < top.length - 1; k++) {
    const [r0, y0] = top[k], [r1, y1] = top[k + 1];
    if (r <= r0 && r >= r1) return y0 + (y1 - y0) * (r0 - r) / (r0 - r1);
  }
  return top[top.length - 1][1];
}
// how far out (x, z) is in a layer's plan: 1 on its rim
const planR = (x, z, [W, L]) => Math.pow(Math.pow(Math.abs(x) / W, PE) + Math.pow(Math.abs(z) / L, PE), 1 / PE);

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

// one layer: its profile spun round the oval plan; paint(r, y, angle, colour), optional bump(r, y, angle) on the radius
function oval(prof, [W, L], m, paint, bump) {
  const ends = (k, v, c) => { v.set(0, prof[k][1], 0); if (paint) paint(0, prof[k][1], 0, c); };
  return sweep(prof.length - 2, m, (i, j, v, c) => {
    const [r0, y] = prof[i + 1], ph = (j / m) * Math.PI * 2, r = r0 * (bump ? bump(r0, y, ph) : 1);
    v.set(W * r * pw(Math.cos(ph)), y, -L * r * pw(Math.sin(ph)));
    if (paint) paint(r0, y, ph, c);
  }, (v, c) => ends(0, v, c), (v, c) => ends(prof.length - 1, v, c), !!paint);
}

// the cheese slice: a square-cornered sheet lying on the patty whose corners melt down over the edge
function cheeseGeometry() {
  const AX = 0.86, AZ = 1.7, NX = 10, NZ = 16, EDGE = 0.93;
  const pos = [], idx = [];
  for (let i = 0; i <= NZ; i++) for (let j = 0; j <= NX; j++) {
    // grid lines bunch up towards the edges, where the corners bend
    let x = AX * Math.sin((j / NX - 0.5) * Math.PI), z = AZ * Math.sin((i / NZ - 0.5) * Math.PI);
    const r = planR(x, z, PATTY), d = Math.max(0, r - EDGE);
    let y = heightAt(PATTY_TOP, Math.min(r, EDGE)) + 0.015;
    if (d > 0) {
      y -= 1.1 * Math.pow(d, 1.5);                 // droop
      const k = (EDGE + 0.75 * d) / r;             // and hang a bit inwards as it bends down
      x *= k; z *= k;
    }
    pos.push(x, y, z);
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NX; j++) {
    const a = i * (NX + 1) + j, b = a + NX + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// the lettuce: a frilly band poking out all round under the tomato, drooping and waving at its edge
function lettuceGeometry() {
  const A = 96, T = [0, 0.45, 0.8, 1], [W, L] = BUN1;
  const inner = new THREE.Color('#3da62c'), edge = new THREE.Color('#93e35a'), c = new THREE.Color();
  const pos = [], col = [], idx = [];
  for (const t of T) for (let a = 0; a < A; a++) {
    const ph = (a / A) * Math.PI * 2;
    const r = (0.7 + 0.37 * t) * (1 + 0.03 * t * Math.sin(7 * ph + 0.5));
    const y = 0.49 - 0.06 * t * t + 0.035 * t * t * Math.sin(18 * ph) + 0.01 * t * Math.sin(5 * ph + 1);
    pos.push(W * r * pw(Math.cos(ph)), y, -L * r * pw(Math.sin(ph)));
    c.copy(inner).lerp(edge, t * t);
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < T.length - 1; i++) for (let a = 0; a < A; a++) {
    const p = i * A + a, q = i * A + (a + 1) % A;
    idx.push(p, p + A, q, q, p + A, q + A);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, extra) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  const vc = (roughness, extra) => mat('#ffffff', roughness, { vertexColors: true, ...extra });
  const shade = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const C = s => new THREE.Color(s);

  // ---- bottom bun: toasted underneath, golden sides ----
  const toast = C('#c8772e'), crust = C('#eca24c'), light = C('#f6c36d'), cream = C('#fbe3b0');
  g.add(shade(new THREE.Mesh(oval(BOT_PROF, BUN0, 40, (r, y, ph, c) => {
    c.copy(crust).lerp(toast, 1 - ss(-0.24, -0.1, y)).lerp(light, 0.6 * ss(0.0, 0.15, y));
    if (y > 0.175 && r < 0.9) c.copy(cream);
  }), vc(0.75))));

  // ---- the patty: lumpy edge, grilled dark patches ----
  const beef = C('#6e3c1f'), char = C('#3f200f');
  g.add(shade(new THREE.Mesh(oval(PATTY_PROF, PATTY, 48, (r, y, ph, c) => {
    const n = 0.5 + 0.5 * Math.sin(5.3 * ph + 17 * y) * Math.sin(3.1 * ph - 9 * y + 1);
    c.copy(beef).lerp(char, 0.65 * n + 0.2 * ss(0.44, 0.458, y));
  }, (r, y, ph) => 1 + ss(0.85, 1, r) * (0.02 * Math.sin(7 * ph + 1.3) + 0.012 * Math.sin(13 * ph + 8 * y))), vc(0.85))));

  // ketchup drips running down the patty's side (away from the cheese corners)
  const drop = new THREE.SphereGeometry(1, 7, 5), drips = [];
  for (const [ph, len] of [[0.12, 0.12], [1.62, 0.13], [3.05, 0.1], [4.75, 0.11], [6.05, 0.09]]) {
    const [W, L] = PATTY, x = W * pw(Math.cos(ph)), z = -L * pw(Math.sin(ph));
    const nx = Math.sign(x) * Math.pow(Math.abs(x) / W, PE - 1) / W, nz = Math.sign(z) * Math.pow(Math.abs(z) / L, PE - 1) / L, nl = Math.hypot(nx, nz);
    drips.push(drop.clone().scale(0.065, len, 0.065).translate(x + 0.015 * nx / nl, 0.45 - len, z + 0.015 * nz / nl));
  }
  g.add(shade(new THREE.Mesh(mergeGeometries(drips), mat('#e3161c', 0.25))));

  // ---- cheese, lettuce and the tomato layer ----
  g.add(shade(new THREE.Mesh(cheeseGeometry(), mat('#ffbf1f', 0.45, { side: THREE.DoubleSide }))));
  const lettuce = shade(new THREE.Mesh(lettuceGeometry(), vc(0.6, { side: THREE.DoubleSide })));
  g.add(lettuce);
  // eight slices' worth of scalloped edge
  g.add(shade(new THREE.Mesh(oval(TOM_PROF, TOMATO, 64, null, (r, y, ph) => 1 + ss(0.9, 1, r) * 0.04 * (Math.abs(Math.sin(4 * ph)) - 0.6)),
    mat('#e5392b', 0.35))));

  // ---- top bun with sesame seeds (they ride along when it bobs) ----
  const lid = new THREE.Group();
  g.add(lid);
  const gold = C('#e7963c'), top = C('#cf7a2a'), rim = C('#f7c56c');
  lid.add(shade(new THREE.Mesh(oval(TOP_PROF, BUN1, 48, (r, y, ph, c) => {
    c.copy(rim).lerp(gold, ss(0.6, 0.9, y)).lerp(top, 0.55 * ss(1.0, 1.52, y));
    if (y < 0.6 && r < 0.95) c.copy(cream);
  }), mat('#ffffff', 0.5, { vertexColors: true }))));

  const domeY = (x, z) => heightAt(DOME, planR(x, z, BUN1));
  const SEEDS = 52, seeds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 3), mat('#fff3d2', 0.6), SEEDS);
  let seed = 1234567;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), spin = new THREE.Quaternion(), n = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let k = 0; k < SEEDS; k++) {
    const r = 0.84 * Math.sqrt((k + 0.5) / SEEDS) * (0.96 + 0.08 * rnd()), ph = k * 2.39996 + 0.3 * rnd();
    const x = BUN1[0] * r * pw(Math.cos(ph)), z = -BUN1[1] * r * pw(Math.sin(ph)), e = 0.01;
    n.set(-(domeY(x + e, z) - domeY(x - e, z)) / (2 * e), 1, -(domeY(x, z + e) - domeY(x, z - e)) / (2 * e)).normalize();
    q.setFromUnitVectors(Y, n).multiply(spin.setFromAxisAngle(Y, rnd() * Math.PI));
    p.set(x, domeY(x, z), z).addScaledVector(n, 0.012);
    seeds.setMatrixAt(k, m4.compose(p, q, sc.set(0.055, 0.022, 0.03).multiplyScalar(0.9 + 0.2 * rnd())));
  }
  seeds.instanceMatrix.needsUpdate = true;
  seeds.computeBoundingSphere();
  lid.add(seeds);

  // ---- axles out to the real wheels (mostly hidden inside the bottom bun) ----
  const axle = new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10).rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(mergeGeometries([axle.clone().translate(0, -0.1, 1.36), axle.translate(0, -0.1, -1.34)]),
    mat('#3b3f45', 0.45, { metalness: 0.7 })));

  // party hat on the very top of the bun, googly eyes on its front
  g.userData.hat = new THREE.Vector3(0, TOP_PROF[TOP_PROF.length - 1][1], 0);
  g.userData.eyes = new THREE.Vector3(0, 0.8, 1.86);

  // ---- motion: the top bun bobs and tips up a touch at speed, the lettuce flutters ----
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (3 + 9 * w);
    lid.position.y = 0.012 * (0.4 + w) * Math.sin(ph * 1.5);
    lid.rotation.x = -0.008 * w * (0.6 + 0.4 * Math.sin(ph * 0.9));
    lettuce.rotation.y = 0.018 * (0.3 + w) * Math.sin(ph * 2.1);
  };
  return g;
}
