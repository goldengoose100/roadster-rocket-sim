// Silly body: a giant watermelon on wheels.
// A long, light green melon with wavy dark green stripes that meet at the ends, sliced open at the
// back (the cut leans back a little so the chase camera sees it): red flesh with black seeds, a white
// rind ring and a dark green skin line. A stem at the nose with a leaf and a curly tendril, and while
// driving it spits seeds out of the back. Looks only.
// Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const info = { id: 'watermelon', name: 'Watermelon' };

// ---- the melon: elliptical rings along z, superellipse profile (a bit fuller than an egg) ----
const A = 0.95, B = 0.84, C = 2.35, Z0 = -0.2, P = 2.1;
const Y0 = B - 0.25;                    // belly just above the axles
const ZC = -1.95, TILT = 0.2;           // the cut: a plane through (0, Y0, ZC), leaning back by TILT
const rad = u => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), P)), 1 / P);
// superellipse angle psi (-PI/2 back pole .. PI/2 front pole) -> u along the melon and ring size r
const uOf = psi => Math.sign(psi) * Math.pow(Math.abs(Math.sin(psi)), 2 / P);
const rOf = psi => Math.pow(Math.max(0, Math.cos(psi)), 2 / P);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// where the cut plane meets the skin at ring angle th: the psi of that point (bisection on u)
function cutPsi(th) {
  const k = B * Math.sin(th) * Math.tan(TILT);
  let lo = -1, hi = 0;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Z0 + C * m - ZC - k * rad(m) > 0) hi = m; else lo = m; }
  return -Math.asin(Math.pow(-(lo + hi) / 2, P / 2));
}
function skinPoint(psi, th, v) {
  const r = rOf(psi);
  return v.set(A * r * Math.cos(th), Y0 + B * r * Math.sin(th), Z0 + C * uOf(psi));
}
function skinNormal(psi, th, n) {
  const r = rOf(psi), u = uOf(psi), rp = Math.pow(r, P - 1);
  return n.set(rp * Math.cos(th) / A, rp * Math.sin(th) / B, Math.sign(u) * Math.pow(Math.abs(u), P - 1) / C).normalize();
}

// ---- stripes: NS dark bands with wavy, slightly ragged edges; s runs 0 (cut) .. 1 (front pole) ----
const NS = 10, HW = 0.15, SEG = 2;   // stripes, half width (radians), segments across each band
const edge = (k, side, s) => 2 * Math.PI * k / NS + Math.PI / 2 + side * HW
  + 0.05 * Math.sin(14 * s + k * 1.9 + side) + 0.022 * Math.sin(37 * s + k * 3.1 + side * 2);

function skinGeometry(light, dark, NU) {
  const cols = 2 * NS * (SEG + 1);
  const pos = [], nor = [], col = [], idx = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < NU; i++) {
    const s = i / NU;
    for (let k = 0; k < NS; k++) {
      const L = edge(k, -1, s), R = edge(k, 1, s), L2 = edge(k + 1, -1, s);
      for (const [a, b, c] of [[L, R, dark], [R, L2, light]]) {
        for (let q = 0; q <= SEG; q++) {
          const th = a + (b - a) * q / SEG;
          const ps = cutPsi(th), psi = ps + (Math.PI / 2 - ps) * s;
          skinPoint(psi, th, v); skinNormal(psi, th, n);
          pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const per = SEG + 1;
  for (let i = 0; i < NU - 1; i++) for (let band = 0; band < 2 * NS; band++) for (let q = 0; q < SEG; q++) {
    const a = i * cols + band * per + q, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  // front pole: a light green spot where the stripes meet (the stem covers it)
  const pole = pos.length / 3;
  skinPoint(Math.PI / 2, 0, v);
  pos.push(v.x, v.y, v.z); nor.push(0, 0, 1); col.push(light.r, light.g, light.b);
  const last = (NU - 1) * cols;
  for (let band = 0; band < 2 * NS; band++) for (let q = 0; q < SEG; q++) {
    const a = last + band * per + q;
    idx.push(a, a + 1, pole);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// ---- the cut face: concentric zones (skin line, rind, flesh), flat, facing back and a bit up ----
const FN = new THREE.Vector3(0, Math.sin(TILT), -Math.cos(TILT));   // outward normal of the cut
const FO = new THREE.Vector3(0, Y0, ZC);                             // centre of the cut
const FACE_SEG = 40;
const faceEdge = (th, v) => { const ps = cutPsi(th); return skinPoint(ps, th, v); };

function faceGeometry(zones) {
  const pos = [], col = [], idx = [];
  const v = new THREE.Vector3(), e = [];
  for (let j = 0; j < FACE_SEG; j++) e.push(faceEdge((j / FACE_SEG) * Math.PI * 2, new THREE.Vector3()));
  const ring = (f, c) => {
    const start = pos.length / 3;
    for (let j = 0; j < FACE_SEG; j++) {
      v.copy(e[j]).sub(FO).multiplyScalar(f).add(FO);
      pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b);
    }
    return start;
  };
  for (const z of zones) {
    if (z.to > 0) {
      const a = ring(z.from, z.c0), b = ring(z.to, z.c1);
      for (let j = 0; j < FACE_SEG; j++) {
        const j1 = (j + 1) % FACE_SEG;
        idx.push(a + j, b + j, a + j1, a + j1, b + j, b + j1);
      }
    } else {   // fan to the centre
      const a = ring(z.from, z.c0), o = pos.length / 3;
      pos.push(FO.x, FO.y, FO.z); col.push(z.c1.r, z.c1.g, z.c1.b);
      for (let j = 0; j < FACE_SEG; j++) idx.push(o, a + (j + 1) % FACE_SEG, a + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => [FN.x, FN.y, FN.z][i % 3]), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// a seed: unit teardrop, pointy end towards +y
function seedGeometry() {
  const geo = new THREE.SphereGeometry(1, 7, 5);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = y > 0 ? 1 - 0.6 * y : 1;
    p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// a leaf: a cupped, curled grid, base at the origin, growing along +y, hollow side towards -z
function leafGeometry(L, W, light, dark) {
  const NSL = 9, NT = 4, pos = [], col = [], idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= NSL; i++) {
    const s = i / NSL, w = W * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.8);
    for (let j = 0; j <= NT; j++) {
      const t = (j / NT) * 2 - 1, x = t * w;
      pos.push(x, L * s, -0.35 * x * x / W - 0.22 * L * s * s);   // cupped and curled towards -z
      c.copy(light).lerp(dark, Math.min(1, Math.abs(t) * 1.6));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NSL; i++) for (let j = 0; j < NT; j++) {
    const a = i * (NT + 1) + j, b = a + 1, d = a + NT + 1, e = d + 1;
    idx.push(a, b, d, b, e, d);
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
  const body = new THREE.Group();   // the melon wobbles a little on its axles
  g.add(body);

  const light = new THREE.Color('#8fdc58'), dark = new THREE.Color('#1f7f36');
  const vcMat = (rough) => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: rough, metalness: 0 });

  // ---- skin ----
  const skin = new THREE.Mesh(skinGeometry(light, dark, 30), vcMat(0.33));
  skin.castShadow = true; skin.receiveShadow = true;
  body.add(skin);

  // ---- cut face ----
  const C3 = s => new THREE.Color(s);
  const face = new THREE.Mesh(faceGeometry([
    { from: 1.004, to: 0.945, c0: dark, c1: dark },                       // thin dark green skin line
    { from: 0.945, to: 0.83, c0: C3('#c9ef9c'), c1: C3('#f6fde8') },     // pale rind, greenish to white
    { from: 0.83, to: 0.5, c0: C3('#f21d43'), c1: C3('#ff3f5c') },       // red flesh, brighter inside
    { from: 0.5, to: 0, c0: C3('#ff3f5c'), c1: C3('#ff6175') },
  ]), vcMat(0.6));
  face.castShadow = true;
  body.add(face);

  // ---- seeds on the cut face: an outer ring and an inner ring, pointy ends towards the middle ----
  const seedGeo = seedGeometry();
  const SEED = new THREE.Vector3(0.034, 0.062, 0.017);
  const E = new THREE.Vector3(), Rd = new THREE.Vector3(), Tg = new THREE.Vector3(), m4 = new THREE.Matrix4();
  const seedAt = (th, f) => {
    faceEdge(th, E);
    Rd.copy(E).sub(FO);
    const p = FO.clone().addScaledVector(Rd, f).addScaledVector(FN, 0.005);
    Rd.normalize().negate();                 // pointy end towards the centre
    Tg.crossVectors(Rd, FN);
    m4.makeBasis(Tg, Rd, FN).scale(SEED).setPosition(p);
    return seedGeo.clone().applyMatrix4(m4);
  };
  const faceSeeds = [];
  for (let k = 0; k < 10; k++) faceSeeds.push(seedAt(0.25 + k * Math.PI * 2 / 10 + 0.12 * Math.sin(k * 2.7), 0.56 + 0.05 * Math.sin(k * 1.3)));
  for (let k = 0; k < 5; k++) faceSeeds.push(seedAt(0.9 + k * Math.PI * 2 / 5, 0.28));
  const seedMat = new THREE.MeshStandardMaterial({ color: '#1b1410', roughness: 0.25, metalness: 0 });
  const seeds = new THREE.Mesh(mergeGeometries(faceSeeds), seedMat);
  body.add(seeds);

  // ---- stem at the nose, a leaf standing up from it and a curly tendril ----
  const pole = skinPoint(Math.PI / 2, 0, new THREE.Vector3());
  const stemDir = new THREE.Vector3(0, 0.9, 0.44).normalize();
  const stemMat = new THREE.MeshStandardMaterial({ color: '#6e8a2a', roughness: 0.7, metalness: 0 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.22, 7), stemMat);
  stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), stemDir);
  stem.position.copy(pole).addScaledVector(stemDir, 0.06);
  stem.castShadow = true;
  body.add(stem);
  const tip = pole.clone().addScaledVector(stemDir, 0.15);

  const leafPivot = new THREE.Group();   // flutters in the wind
  leafPivot.position.copy(tip);
  body.add(leafPivot);
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  const leaf = new THREE.Mesh(leafGeometry(0.6, 0.22, new THREE.Color('#a6e86a'), new THREE.Color('#2f9a33')), leafMat);
  leaf.rotation.set(-0.25, 0, -0.5);     // leans back over the melon and out to the right
  leaf.castShadow = true;
  leafPivot.add(leaf);

  const curl = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = t * Math.PI * 5.5, r = 0.075 * (1 - 0.55 * t) * ss(0, 0.12, t);
    curl.push(new THREE.Vector3(-0.1 * ss(0, 0.2, t) + r * Math.cos(a) - 0.03 * t, tip.y + 0.5 * t, tip.z - 0.08 * ss(0, 0.2, t) + r * Math.sin(a)));
  }
  const tendril = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curl), 56, 0.016, 5, false), stemMat);
  tendril.castShadow = true;
  body.add(tendril);

  // ---- axles out to the real wheels ----
  const frameMat = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.5, metalness: 0.6 });
  const axleGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.62, 8).rotateZ(Math.PI / 2);
  for (const z of [1.36, -1.34]) {
    const a = new THREE.Mesh(axleGeo, frameMat);
    a.position.set(0, -0.1, z);
    a.castShadow = true;
    g.add(a);
  }

  // ---- seeds spat out of the back while driving (hidden on the face until launched) ----
  const NF = 5, LIFE = 0.7;
  const fly = [], age = new Float32Array(NF).fill(LIFE), vel = new Float32Array(NF * 3), org = new Float32Array(NF * 3);
  for (let i = 0; i < NF; i++) {
    const s = new THREE.Mesh(seedGeo, seedMat);
    s.scale.copy(SEED).multiplyScalar(1.25);
    s.position.copy(FO);
    s.visible = false;
    fly.push(s); g.add(s);
  }

  // ---- motion: wobble, leaf flutter, ptoo-ptoo seeds ----
  let last = -1, ph = 0, next = 0, shot = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (3 + 10 * w);
    body.position.y = 0.012 * (0.4 + w) * Math.sin(ph * 0.6);
    body.rotation.z = 0.01 * (0.3 + w) * Math.sin(ph * 0.45);
    leafPivot.rotation.x = -(0.08 + 0.2 * w) * (0.5 + 0.5 * Math.sin(ph * 1.7));
    leafPivot.rotation.z = (0.05 + 0.1 * w) * Math.sin(ph * 1.1);

    next -= dt;
    if ((speed || 0) > 4 && next <= 0) {
      const i = shot % NF, j = shot * 2.39996;   // golden-angle spread so no two shots look alike
      const r = 0.12 + 0.1 * ((shot * 0.618) % 1);
      age[i] = 0;
      org[i * 3] = r * Math.cos(j); org[i * 3 + 1] = FO.y + body.position.y + 0.8 * r * Math.sin(j); org[i * 3 + 2] = FO.z;
      vel[i * 3] = 0.9 * Math.cos(j) * r * 4; vel[i * 3 + 1] = 1.6 + 0.6 * Math.sin(j * 1.7); vel[i * 3 + 2] = -2.6 - 1.4 * w;
      fly[i].visible = true;
      shot++;
      next = 0.55 - 0.3 * w;
    }
    for (let i = 0; i < NF; i++) {
      if (age[i] >= LIFE) continue;
      age[i] += dt;
      const a = age[i], s = fly[i];
      if (a >= LIFE) { s.visible = false; s.position.copy(FO); continue; }
      s.position.set(org[i * 3] + vel[i * 3] * a, org[i * 3 + 1] + vel[i * 3 + 1] * a - 4.9 * a * a, org[i * 3 + 2] + vel[i * 3 + 2] * a);
      s.rotation.set(a * 14 + i, a * 9, 0);
    }
  };
  return g;
}
