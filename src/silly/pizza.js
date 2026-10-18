// Pizza Slice: a giant slice of pepperoni pizza riding on a little go-kart frame (Good Luck menu
// silly body). The slice lies flat just above the wheels with its point at the front, drooping a
// little the way a real slice does: golden dough with a red sauce rim, a gooey cheese layer with
// a wavy edge that drips over both sides, pepperoni and basil on top, and a fat puffy crust along
// the back arc. While driving the floppy tip bobs up and down (faster with speed). Looks only.
// Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const info = { id: 'pizza', name: 'Pizza Slice' };

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// plan view: the point at the front (ZT); the crust runs along an arc of radius R around the point
const ZT = 2.28, R = 4.25, HW = 0.86;           // HW: half width of the slice at the crust
const TH = Math.asin(HW / R), TAN = Math.tan(TH);
const ZC = ZT - R * Math.cos(TH);               // the crust line at the corners
const halfW = z => Math.max(0, (ZT - z) * TAN);
// heights: underside at the back just clears the wheel tops (y 0.26), layer thicknesses
const Y0 = 0.31, DOUGH = 0.11, CHEESE = 0.05;
const ZS = -0.2, DROOP = 0.26;                  // the tip droops from ZS forward
const bend = z => z <= ZS ? 0 : -DROOP * ((z - ZS) / (ZT - ZS)) ** 2;
const bendD = z => z <= ZS ? 0 : -2 * DROOP * (z - ZS) / ((ZT - ZS) ** 2);
const cheeseTop = z => Y0 + bend(z) + DOUGH + CHEESE - 0.02;
const ZH = 0.3;                                 // the floppy part (moves in tick) starts here
const flopW = z => z <= ZH ? 0 : ((z - ZH) / (ZT - ZH)) ** 2;
// cheese drips over the sides: side, z, length, width
const DRIPS = [[-1, -1.7, 0.2, 0.045], [-1, -0.45, 0.24, 0.05], [-1, 0.75, 0.17, 0.04],
  [1, -0.75, 0.21, 0.048], [1, 0.4, 0.23, 0.045], [1, 1.45, 0.14, 0.035]];
// pepperoni: x, z, r
const PEPS = [[-0.4, -1.5, 0.19], [0.4, -1.3, 0.18], [-0.1, -0.62, 0.18], [0.3, -0.05, 0.14],
  [-0.48, -0.95, 0.12], [-0.12, 0.85, 0.11], [0.02, 1.4, 0.08]];
// basil leaves: x, z, turn
const BASIL = [[0.12, -0.95, 0.6], [-0.32, -0.25, -0.5], [0.14, 0.62, 1.1]];

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

// a flat layer along z with a rounded-rectangle (superellipse) cross-section: half widths per side
// hw(z, side), underside height y(z), thickness; colour(c, ey, z) gets the height around the ring (-1..1)
function layer(n, m, z0, z1, hw, yBot, thick, p, colour) {
  const e = 2 / p;
  return sweep(n, m, (i, j, v, c) => {
    const z = z0 + (z1 - z0) * i / (n - 1), th = (j / m) * Math.PI * 2;
    const cs = Math.cos(th), sn = Math.sin(th);
    const ex = Math.sign(cs) * Math.pow(Math.abs(cs), e), ey = Math.sign(sn) * Math.pow(Math.abs(sn), e);
    v.set(hw(z, cs >= 0 ? 1 : -1) * ex, yBot(z) + thick * (0.5 + 0.5 * ey), z);
    colour(c, ey, z, v.x);
  }, (v, c) => { v.set(0, yBot(z0) + thick / 2, z0 - 0.005); colour(c, 0, z0, 0); },
  (v, c) => { v.set(0, yBot(z1) + thick / 2, z1 + 0.012); colour(c, 0, z1, 0); });
}

// how far the cheese edge sits in from the dough edge: a lazy wave that reaches the edge at each drip
function cheeseInset(z, side) {
  let k = 0.075 + 0.018 * Math.sin(z * 9.3 + side * 1.7);
  for (const [s, zd] of DRIPS) if (s === side) k -= 0.085 * Math.exp(-(((z - zd) / 0.2) ** 2));
  return k;
}

// the crust: a puffy tube along the back arc, toasted on top, with rounded ends
function crustGeometry() {
  const RC = 0.17, RY = 0.92, YC = Y0 + 0.11, KC = 5, MID = 24, M = 14;
  const gold = new THREE.Color('#eab25a'), toast = new THREE.Color('#c27326'), pale = new THREE.Color('#f5d28f');
  const PH = TH, PE = TH + RC / R;   // main part between the slice corners, caps beyond
  const rings = [];                  // [angle along the arc, ring scale]
  for (let k = 1; k <= KC; k++) { const a = (k / KC) * Math.PI / 2; rings.push([-(PH + (RC / R) * Math.cos(a)), Math.sin(a)]); }
  for (let k = 1; k < MID; k++) rings.push([-PH + 2 * PH * k / MID, 1]);
  for (let k = KC; k >= 1; k--) { const a = (k / KC) * Math.PI / 2; rings.push([PH + (RC / R) * Math.cos(a), Math.sin(a)]); }
  const puff = f => 1 + 0.07 * Math.sin(f / PH * Math.PI * 3.5) + 0.03 * Math.sin(f / PH * 11.3);
  const at = (f, v) => v.set(R * Math.sin(f), YC, ZT - R * Math.cos(f));
  return sweep(rings.length, M, (i, j, v, c) => {
    const [f, s] = rings[i], a = (j / M) * Math.PI * 2, r = RC * s * puff(f);
    at(f, v);
    const ca = Math.cos(a), sa = Math.sin(a);   // ca: up, sa: forward (the arc's inward normal)
    v.x += -Math.sin(f) * r * sa; v.z += Math.cos(f) * r * sa; v.y += r * RY * ca;
    c.copy(gold).lerp(toast, 0.8 * ss(0.15, 0.95, ca) * (0.75 + 0.25 * Math.sin(f * 37))).lerp(pale, 0.6 * ss(-0.3, -0.95, ca));
  }, (v, c) => { at(-PE, v); c.copy(gold); }, (v, c) => { at(PE, v); c.copy(gold); });
}

// a cheese drip hanging down the side of the dough: a teardrop with a fat round end
function dripGeometry(L, w) {
  const pts = [];
  for (let k = 7; k >= 0; k--) {   // bottom to top, so the faces point outwards
    const t = k / 7;
    const bulb = 0.75 - 0.15 * t + 0.4 * Math.exp(-(((t - 0.76) / 0.13) ** 2));
    const cap = t > 0.78 ? Math.sqrt(Math.max(0, 1 - ((t - 0.78) / 0.22) ** 2)) : 1;
    pts.push(new THREE.Vector2(Math.max(0.001, w * bulb * cap), -L * t));
  }
  return new THREE.LatheGeometry(pts, 7);
}

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const vc = roughness => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness, metalness: 0 });

  // ---- dough: golden sides, toasted underside, red sauce on top (it shows as a rim round the cheese) ----
  const doughC = new THREE.Color('#f0c47a'), under = new THREE.Color('#cf8d3f'), sauce = new THREE.Color('#d8321f');
  const dough = new THREE.Mesh(layer(26, 24, ZC - 0.04, ZT - 0.015, z => halfW(z), z => Y0 + bend(z), DOUGH, 8,
    (c, ey) => c.copy(doughC).lerp(under, ss(-0.4, -0.95, ey)).lerp(sauce, ss(0.75, 0.95, ey))), vc(0.75));
  dough.castShadow = true; dough.receiveShadow = true;
  g.add(dough);

  // ---- cheese: a wavy-edged layer on the sauce, with a few toasty patches ----
  const cheeseC = new THREE.Color('#ffd84a'), toasty = new THREE.Color('#f4ac38');
  const cheese = new THREE.Mesh(layer(36, 20, ZC + 0.02, ZT - 0.13,
    (z, sd) => { const h = halfW(z); return Math.max(0.3 * h, h - cheeseInset(z, sd)); },
    z => Y0 + bend(z) + DOUGH - 0.02, CHEESE, 5,
    (c, ey, z, x) => c.copy(cheeseC).lerp(toasty, 0.55 * ss(0.55, 1, Math.sin(z * 5.1 + x * 7.3) * Math.sin(z * 2.3 - x * 4.1 + 1)))), vc(0.42));
  cheese.castShadow = true; cheese.receiveShadow = true;
  g.add(cheese);

  // ---- drips over the sides ----
  const drips = new THREE.Mesh(mergeGeometries(DRIPS.map(([sd, z, L, w]) =>
    dripGeometry(L, w).translate(sd * (halfW(z) + 0.012), cheeseTop(z) - 0.004, z))), mat('#ffd84a', 0.4));
  drips.castShadow = true;
  g.add(drips);

  // ---- pepperoni: darker towards the rim, lying on the cheese and following the droop ----
  const pepIn = new THREE.Color('#d63a2c'), pepOut = new THREE.Color('#99201a'), c = new THREE.Color();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), tp = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const peps = PEPS.map(([x, z, r], k) => {
    const geo = new THREE.CylinderGeometry(r, r, 0.03, 18);
    const p = geo.attributes.position, cc = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      c.copy(pepIn).lerp(pepOut, ss(0.5, 1, Math.hypot(p.getX(i), p.getZ(i)) / r));
      cc[i * 3] = c.r; cc[i * 3 + 1] = c.g; cc[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    e.set(Math.atan(-bendD(z)), 0, 0.05 * Math.sin(k * 2.7));
    return geo.applyMatrix4(m4.compose(tp.set(x, cheeseTop(z) + 0.008, z), q.setFromEuler(e), one));
  });
  const pepperoni = new THREE.Mesh(mergeGeometries(peps), vc(0.45));
  pepperoni.castShadow = true;
  g.add(pepperoni);

  // ---- basil leaves ----
  const basil = new THREE.Mesh(mergeGeometries(BASIL.map(([x, z, a]) => {
    e.set(Math.atan(-bendD(z)), a, 0);
    return new THREE.SphereGeometry(1, 8, 6).scale(0.07, 0.012, 0.12)
      .applyMatrix4(m4.compose(tp.set(x, cheeseTop(z) + 0.004, z), q.setFromEuler(e), one));
  })), mat('#2f9b3a', 0.5));
  g.add(basil);

  // ---- crust ----
  const crust = new THREE.Mesh(crustGeometry(), vc(0.8));
  crust.castShadow = true; crust.receiveShadow = true;
  g.add(crust);

  // ---- go-kart frame: a plank, two posts holding the slice up, axles out to the real wheels ----
  const metal = mat('#2b2e33', 0.5, 0.6);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 2.95), metal);
  plank.position.set(0, -0.13, 0);
  plank.castShadow = true;
  g.add(plank);
  const posts = new THREE.Mesh(mergeGeometries([-1.0, 0.8].map(z => {
    const top = Y0 + bend(z) + 0.01, h = top + 0.1;
    return new THREE.CylinderGeometry(0.05, 0.06, h, 10).translate(0, -0.1 + h / 2, z);
  })), metal);
  posts.castShadow = true;
  g.add(posts);
  const axleGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.62, 10).rotateZ(Math.PI / 2);
  for (const z of [1.36, -1.34]) {
    const a = new THREE.Mesh(axleGeo, metal);
    a.position.set(0, -0.1, z);
    a.castShadow = true;
    g.add(a);
  }

  // party hat on top of the crust; googly eyes standing on the slice, looking where it's going
  g.userData.hat = new THREE.Vector3(0, Y0 + 0.11 + 0.17 * 0.92, ZT - R);
  g.userData.eyes = new THREE.Vector3(0, cheeseTop(0.3) + 0.14, 0.3);

  // ---- motion: the floppy front of the slice bobs (everything on it bends with it) ----
  const flop = [dough, cheese, drips, pepperoni, basil].map(mesh => {
    const attr = mesh.geometry.attributes.position, base = attr.array.slice(), ids = [], wts = [];
    for (let i = 0; i < attr.count; i++) { const w = flopW(base[i * 3 + 2]); if (w > 0) { ids.push(i); wts.push(w); } }
    return { attr, base, ids: Int32Array.from(ids), wts: Float32Array.from(wts) };
  });
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (3 + 9 * w);
    const amp = -0.015 * w + (0.012 + 0.05 * w) * Math.sin(ph);
    for (const f of flop) {
      const a = f.attr.array, b = f.base, ids = f.ids, wts = f.wts;
      for (let k = 0; k < ids.length; k++) { const o = ids[k] * 3 + 1; a[o] = b[o] + amp * wts[k]; }
      f.attr.needsUpdate = true;
    }
  };
  return g;
}
