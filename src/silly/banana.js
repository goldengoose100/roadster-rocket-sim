// Silly body: a giant banana on a little go-kart frame.
// Curved yellow peel (smile seen from the side), sugar spots, a blue sticker, a green-brown stem
// sticking up at the back, and a half-peeled nose: the cream fruit pokes out at the front and three
// peel flaps fold back along the banana and flap in the wind (yellow side up, so the chase camera
// sees them). Car space: +z forward, y up, ground at y = -0.45.
// The banana is modelled with the peeled end at -z and then turned around (rotation.y = PI).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const info = { id: 'banana', name: 'Banana' };

// ---- spine (model space, before the turn): z from the peeled rim (ZR) to the stem end (ZF) ----
const ZR = -1.8, ZF = 2.18, YM = 0.31;
const KR = 0.34 / (ZR * ZR), KF = 0.52 / (ZF * ZF);   // peeled end lifts 0.34, stem end 0.52
const spineY = z => YM + (z < 0 ? KR : KF) * z * z;
const spineDY = z => 2 * (z < 0 ? KR : KF) * z;
// centre c, tangent T (towards the front) and up-ish axis U = T x X for the ring at z; X is +x
function frame(z, c, T, U) {
  c.set(0, spineY(z), z);
  T.set(0, spineDY(z), 1).normalize();
  U.set(0, T.z, -T.y);
}
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const R0 = 0.34; // radius of the peel at the open rim
// cross-section size at u (0 = peeled rim, 1 = stem end)
function prof(u, out) {
  const neck = ss(0.66, 0.96, u);
  const full = ss(0, 0.32, u) * (1 - neck);
  out.r = (R0 + 0.17 * ss(0, 0.32, u)) * (1 - neck) + 0.115 * neck;
  out.sx = 1 + 0.22 * full;      // a bit wider than tall in the middle
  out.sy = 1 - 0.04 * full;
  out.k = 0.045 * full;          // five soft ridges, like a real banana
  return out;
}
const ridge = (k, th) => 1 + k * Math.cos(5 * (th - Math.PI / 2));

// a closed tube from rings of points (wrapped, no seam) with a pole at each end, vertex colours
function sweep(n, m, point, start, end) {
  const pos = new Float32Array((n * m + 2) * 3), col = new Float32Array((n * m + 2) * 3), idx = [];
  const v = new THREE.Vector3(), c = new THREE.Color();
  let o = 0;
  const put = () => { pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z; col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; o += 3; };
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { point(i, j, v, c); put(); }
  const id = (i, j) => i * m + (j % m);
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) idx.push(id(i, j), id(i, j + 1), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j));
  const ps = n * m, pe = ps + 1;
  start(v, c); put(); end(v, c); put();
  for (let j = 0; j < m; j++) idx.push(ps, id(0, j + 1), id(0, j), pe, id(n - 1, j), id(n - 1, j + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// one peel flap, in a frame where z' points out of the banana, y' is outward at the flap centre and
// x' runs across it; the hinge (on the rim) is at the origin. Two layers: yellow outside, cream inside.
function petalGeometry(cYellow, cCream, cBrown) {
  const L = 0.55, NS = 12, NW = 6, BETA = 0.95, TH = 0.018;
  const alpha = s => 0.15 + 2.55 * ss(0, 0.45, s) + 0.08 * s;   // how far the flap has folded back
  const per = (NW + 1), nv = (NS + 1) * per;
  const pos = new Float32Array(nv * 6), col = new Float32Array(nv * 6), idx = [];
  const c = new THREE.Color();
  let cy = R0, cz = 0;
  for (let k = 0; k <= NS; k++) {
    const s = k / NS;
    if (k > 0) for (let q = 0; q < 6; q++) {   // integrate the centre line
      const sm = (k - 1 + (q + 0.5) / 6) / NS, a = alpha(sm), ds = L / NS / 6;
      cy += Math.sin(a) * ds; cz += Math.cos(a) * ds;
    }
    const a = alpha(s), ny = Math.cos(a), nz = -Math.sin(a);
    const ws = Math.sqrt(Math.max(0, 1 - s * s * s)) * (1 - 0.15 * s), fl = 1 - 0.65 * ss(0, 0.6, s);
    for (let l = 0; l <= NW; l++) {
      const th = -BETA + 2 * BETA * l / NW, e = Math.abs(th) / BETA;
      const lat = R0 * Math.sin(th) * ws, off = R0 * (Math.cos(th) - 1) * ws * fl;
      const x = lat, y = cy + off * ny - R0, z = cz + off * nz;
      const io = (k * per + l) * 3, ii = io + nv * 3;
      pos[io] = x; pos[io + 1] = y; pos[io + 2] = z;
      pos[ii] = x; pos[ii + 1] = y - TH * ny; pos[ii + 2] = z - TH * nz;
      c.copy(cYellow).lerp(cBrown, Math.min(1, ss(0.62, 1, s) * 0.9 + 0.3 * ss(0.7, 1, e)));
      col[io] = c.r; col[io + 1] = c.g; col[io + 2] = c.b;
      c.copy(cCream).lerp(cBrown, 0.55 * ss(0.75, 1, s));
      col[ii] = c.r; col[ii + 1] = c.g; col[ii + 2] = c.b;
    }
  }
  for (let k = 0; k < NS; k++) for (let l = 0; l < NW; l++) {
    const a = k * per + l, b = a + per, c1 = a + 1, d = b + 1;
    idx.push(a, b, c1, b, d, c1);                               // outside
    idx.push(a + nv, c1 + nv, b + nv, b + nv, c1 + nv, d + nv); // inside (faces the fruit)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function build() {
  const g = new THREE.Group();
  const body = new THREE.Group();   // the banana: bobs on the kart frame, which stays put
  body.rotation.y = Math.PI;        // stem to the back, peeled nose to the front
  g.add(body);

  const yellow = new THREE.Color('#ffd21a'), ridgeCol = new THREE.Color('#f0b400');
  const green = new THREE.Color('#9db82a'), brown = new THREE.Color('#5c3b16');
  const cream = new THREE.Color('#fbefc6');
  const vcMat = (rough) => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: rough, metalness: 0 });
  const peelMat = vcMat(0.42);

  // ---- the peel ----
  const NB = 44, M = 20;      // body rings, ring segments
  const c = new THREE.Vector3(), T = new THREE.Vector3(), U = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  const pr = { r: 0, sx: 1, sy: 1, k: 0 };
  // ring 0: inner edge of the cut, 1: the rim facing backwards (both cream), then the body from
  // ring 2 (u = 0, same spot as ring 1 so the cut edge stays crisp) to the stem end
  const NR = NB + 2;
  const peel = sweep(NR, M, (i, j, v, col) => {
    const th = (j / M) * Math.PI * 2;
    if (i < 2) {
      frame(ZR, c, T, U);
      const r = i === 0 ? R0 * 0.88 : R0;
      v.copy(c).addScaledVector(X, r * Math.cos(th)).addScaledVector(U, r * Math.sin(th));
      if (i === 0) v.addScaledVector(T, 0.012);
      col.copy(cream);
      return;
    }
    const uu = (i - 2) / (NB - 1);
    const z = ZR + uu * (ZF - ZR);
    frame(z, c, T, U); prof(uu, pr);
    const rr = pr.r * ridge(pr.k, th);
    v.copy(c).addScaledVector(X, rr * pr.sx * Math.cos(th)).addScaledVector(U, rr * pr.sy * Math.sin(th));
    const crest = Math.pow(Math.max(0, Math.cos(5 * (th - Math.PI / 2))), 6) * pr.k / 0.045;
    col.copy(yellow).lerp(ridgeCol, 0.35 * crest).lerp(green, ss(0.78, 0.97, uu) * 0.85).lerp(brown, ss(0.965, 1, uu) * 0.8);
  }, (v, col) => { frame(ZR, c, T, U); v.copy(c).addScaledVector(T, 0.02); col.copy(cream); },
  (v, col) => { frame(ZF, c, T, U); v.copy(c).addScaledVector(T, 0.05); col.copy(brown); });
  const peelMesh = new THREE.Mesh(peel, peelMat);
  peelMesh.castShadow = true; peelMesh.receiveShadow = true;
  body.add(peelMesh);

  // point + outward normal on the peel at (u, th), for spots and the sticker
  const surf = (u, th, P, N) => {
    const z = ZR + u * (ZF - ZR);
    frame(z, c, T, U); prof(u, pr);
    const rr = pr.r * ridge(pr.k, th);
    P.copy(c).addScaledVector(X, rr * pr.sx * Math.cos(th)).addScaledVector(U, rr * pr.sy * Math.sin(th));
    N.copy(X).multiplyScalar(Math.cos(th) / pr.sx).addScaledVector(U, Math.sin(th) / pr.sy).normalize();
    return T;
  };
  const P = new THREE.Vector3(), N = new THREE.Vector3(), Z = new THREE.Vector3(), m4 = new THREE.Matrix4();
  // a flattened blob lying on the peel: long along the banana, thin along the normal
  const onPeel = (geo, u, th, along, across, thick, lift) => {
    const t = surf(u, th, P, N);
    Z.crossVectors(t, N);
    m4.makeBasis(t, N, Z).scale(new THREE.Vector3(along, thick, across)).setPosition(P.addScaledVector(N, lift));
    return geo.clone().applyMatrix4(m4);
  };

  // ---- sugar spots ----
  const blob = new THREE.SphereGeometry(1, 8, 5);
  const SPOTS = [[0.22, 1.25, 0.065], [0.35, 2.2, 0.05], [0.5, 0.95, 0.055], [0.58, 1.95, 0.075],
    [0.31, 0.5, 0.045], [0.66, 2.7, 0.05], [0.44, 1.6, 0.035]];
  const spots = new THREE.Mesh(mergeGeometries(SPOTS.map(([u, th, s]) => onPeel(blob, u, th, s * 1.35, s, 0.02, 0))),
    new THREE.MeshStandardMaterial({ color: '#6b4413', roughness: 0.8, metalness: 0 }));
  body.add(spots);

  // ---- the sticker: blue oval with a white border ----
  const disc = new THREE.CylinderGeometry(1, 1, 1, 20);
  const stickerRim = new THREE.Mesh(onPeel(disc, 0.47, 0.38, 0.17, 0.12, 0.012, 0.006),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0 }));
  const sticker = new THREE.Mesh(onPeel(disc, 0.47, 0.38, 0.145, 0.097, 0.012, 0.012),
    new THREE.MeshStandardMaterial({ color: '#1f5fd6', roughness: 0.35, metalness: 0 }));
  body.add(stickerRim, sticker);

  // ---- stem at the stem end (the back of the car), bending further up, with a dark cut end ----
  frame(ZF, c, T, U);
  const ang = Math.atan2(T.y, T.z) + 0.52;
  const sd = new THREE.Vector3(0, Math.sin(ang), Math.cos(ang));
  const stemGeo = new THREE.CylinderGeometry(0.062, 0.088, 0.38, 7);
  const stemMat = new THREE.MeshStandardMaterial({ color: '#7c8a2c', roughness: 0.75, metalness: 0 });
  const cutMat = new THREE.MeshStandardMaterial({ color: '#4a3016', roughness: 0.9, metalness: 0 });
  const stem = new THREE.Mesh(stemGeo, [stemMat, cutMat, stemMat]);
  stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sd);
  stem.position.copy(c).addScaledVector(sd, 0.19 - 0.07);
  stem.castShadow = true;
  body.add(stem);

  // ---- peeled nose: the fruit pokes out, three flaps fold back around it ----
  frame(ZR, c, T, U);
  const rim = c.clone(), out = T.clone().negate(), up = U.clone();
  const fruit = new THREE.Mesh(new THREE.CapsuleGeometry(0.285, 0.42, 5, 14),
    new THREE.MeshStandardMaterial({ color: '#f8e9b0', roughness: 0.7, metalness: 0 }));
  fruit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
  fruit.position.copy(rim).addScaledVector(out, 0.44 - 0.21 - 0.285);
  fruit.castShadow = true;
  body.add(fruit);

  const petalGeo = petalGeometry(yellow, cream, brown);
  const PSI = [Math.PI / 2, Math.PI / 2 + 2.094, Math.PI / 2 - 2.094];   // top, then the two lower flaps
  const BASE = [-0.42, -0.05, -0.05];
  const petals = [], q0 = [];
  const D = new THREE.Vector3(), W = new THREE.Vector3(), mb = new THREE.Matrix4();
  for (let k = 0; k < 3; k++) {
    D.copy(X).multiplyScalar(Math.cos(PSI[k])).addScaledVector(up, Math.sin(PSI[k]));
    W.crossVectors(D, out);
    const p = new THREE.Mesh(petalGeo, peelMat);
    p.position.copy(rim).addScaledVector(D, R0);
    q0.push(new THREE.Quaternion().setFromRotationMatrix(mb.makeBasis(W, D, out)));
    p.quaternion.copy(q0[k]).multiply(new THREE.Quaternion().setFromAxisAngle(X, BASE[k]));
    p.castShadow = true;
    petals.push(p); body.add(p);
  }

  // ---- go-kart frame: a plank under the banana and two axles out to the real wheels ----
  const frameMat = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.5, metalness: 0.6 });
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 2.95), frameMat);
  plank.position.set(0, -0.13, 0);
  plank.castShadow = true;
  g.add(plank);
  const axleGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.62, 8);
  for (const z of [1.36, -1.34]) {
    const a = new THREE.Mesh(axleGeo, frameMat);
    a.rotation.z = Math.PI / 2; a.position.set(0, -0.1, z);
    a.castShadow = true;
    g.add(a);
  }

  // ---- motion: the flaps lift and flap in the wind, the banana bobs on its frame ----
  const qa = new THREE.Quaternion();
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (4 + 12 * w);
    for (let k = 0; k < 3; k++) {
      qa.setFromAxisAngle(X, BASE[k] + 0.12 * w + (0.04 + 0.12 * w) * Math.sin(ph + k * 2.1));
      petals[k].quaternion.copy(q0[k]).multiply(qa);
    }
    body.position.y = 0.012 * (0.3 + w) * Math.sin(ph * 0.55);
  };
  return g;
}
