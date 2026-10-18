// Cheese Wedge: a giant wedge of Swiss cheese riding on the car's wheels (Good Luck menu silly body).
// From the side it is the classic cartoon wedge. The tall end is at the front and the slope runs
// down to a blunt point at the back, so the chase camera looks straight onto the holey slope (a
// slope rising towards the back would face away from it). Round tunnels go right through the
// sides, two bites are missing from the top edge, darker dimples dot the slope and the front face,
// and a little grey mouse rides on top nibbling a crumb, its pink tail draped down the slope
// (the tail swishes, the ears flap in the wind, the whiskers twitch). Looks only.
// Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const info = { id: 'cheese', name: 'Cheese Wedge' };

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// side profile (z along the car, y up) before the bevel rounds every edge off by BEV
const ZF = 2.2, ZB = -2.16, YB = -0.21, YT = 0.9, YTIP = -0.09, HALF = 0.72, BEV = 0.04;
const K = (YT - YTIP) / (ZF - ZB);                         // rise of the slope per metre
const topY = z => YTIP + K * (z - ZB);
const surfY = z => topY(z) + BEV * Math.sqrt(1 + K * K);   // the slope's surface after the bevel
// round tunnels right through the cheese (z, y, r), and bites out of the top edge
// (distance down the slope from the front corner, r)
const HOLES = [[1.55, 0.42, 0.19], [0.75, 0.08, 0.13], [1.95, -0.02, 0.09], [-0.25, 0.08, 0.1],
  [-1.15, -0.06, 0.06], [0.05, 0.12, 0.07], [2.0, 0.6, 0.08]];
const BITES = [[2.0, 0.13], [3.1, 0.1]];
const SLEN = Math.hypot(ZB - ZF, YTIP - YT), UZ = (ZB - ZF) / SLEN, UY = (YTIP - YT) / SLEN;   // down the slope
const BITE_C = BITES.map(([d, r]) => [ZF + UZ * d, YT + UY * d, r]);
// the mouse sits on the slope near the front
const MZ = 1.62;

function profile() {
  const s = new THREE.Shape();
  s.moveTo(ZB, YB); s.lineTo(ZF, YB); s.lineTo(ZF, YT);
  const a0 = Math.atan2(-UY, -UZ);   // pointing back up the slope; half a turn clockwise dips into the cheese
  for (const [cz, cy, r] of BITE_C) {
    for (let k = 0; k <= 10; k++) { const a = a0 - Math.PI * k / 10; s.lineTo(cz + r * Math.cos(a), cy + r * Math.sin(a)); }
  }
  s.lineTo(ZB, YTIP);
  for (const [z, y, r] of HOLES) { const h = new THREE.Path(); h.absarc(z, y, r, 0, Math.PI * 2, true); s.holes.push(h); }
  return s;
}

// the wedge: the profile extruded across the car, coloured per face (flat-shaded facets):
// bright sides, a deeper rind on the tall front, darker insides of the tunnels and bites
function wedgeGeometry() {
  const geo = new THREE.ExtrudeGeometry(profile(), {
    depth: 2 * HALF, steps: 1, curveSegments: 12, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 2,
  });
  geo.rotateY(-Math.PI / 2).translate(HALF, 0, 0);   // profile x -> car z, extrusion -> across the car
  const SIDE = new THREE.Color('#ffd23f'), TOP = new THREE.Color('#ffc53a'), RIND = new THREE.Color('#f7ab2b');
  const HOLE = new THREE.Color('#e8961a');
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const col = new Float32Array(n * 3), c = new THREE.Color();
  const near = (list, y, z) => list.some(([hz, hy, r]) => Math.hypot(z - hz, y - hy) < r + 0.004);
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i), z = pos.getZ(i), nx = nrm.getX(i), nz = nrm.getZ(i);
    if (Math.abs(nx) > 0.95) c.copy(SIDE);
    else if (near(HOLES, y, z) || near(BITE_C, y, z)) c.copy(HOLE);
    else if (nz > 0.8) c.copy(RIND);
    else c.copy(TOP);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// dimples: dark round dents on the surface, darker towards local +y (the rim that shades them)
function dimplesGeometry() {
  const DARK = new THREE.Color('#b8680a'), MID = new THREE.Color('#e39516');
  const circ = new THREE.CircleGeometry(1, 20), c = new THREE.Color();
  const L = Math.sqrt(1 + K * K);
  const X = new THREE.Vector3(1, 0, 0);
  const slopeY = new THREE.Vector3(0, -K / L, -1 / L), slopeN = new THREE.Vector3(0, 1 / L, -K / L);   // down the slope, out of it
  const frontY = new THREE.Vector3(0, 1, 0), frontN = new THREE.Vector3(0, 0, 1);
  const m4 = new THREE.Matrix4(), at = new THREE.Vector3(), sc = new THREE.Vector3();
  const one = (r, Y, N) => {
    const g = circ.clone(), p = g.attributes.position, cc = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      c.copy(DARK).lerp(MID, ss(-0.2, 1, (1 - p.getY(i)) / 2));
      cc[i * 3] = c.r; cc[i * 3 + 1] = c.g; cc[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    return g.applyMatrix4(m4.makeBasis(X, Y, N).scale(sc.set(r, r, 1)).setPosition(at));
  };
  const parts = [];
  // on the slope (x, z, r): clear of the mouse, its tail and the bites
  for (const [x, z, r] of [[-0.4, 1.15, 0.13], [0.42, 0.62, 0.11], [-0.2, -0.25, 0.16], [0.38, -0.45, 0.08],
    [0.3, -1.35, 0.12], [-0.42, -1.25, 0.07], [-0.05, -1.75, 0.06], [0.45, 1.6, 0.08]]) {
    at.set(x, surfY(z), z).addScaledVector(slopeN, 0.006);
    parts.push(one(r, slopeY, slopeN));
  }
  // on the tall front face (x, y, r): clear of where the googly eyes go
  for (const [x, y, r] of [[-0.52, 0.0, 0.1], [0.5, 0.12, 0.13], [0.12, -0.06, 0.07], [-0.5, 0.76, 0.07], [0.56, 0.78, 0.06]]) {
    at.set(x, y, ZF + BEV + 0.006);
    parts.push(one(r, frontY, frontN));
  }
  return mergeGeometries(parts);
}

// the mouse's tail in its own frame lying on the slope (local y = up out of the slope, -z = down it):
// rises out of the mouse, runs down the slope and curls to one side, tapering to a round tip
function tailGeometry() {
  const curve = new THREE.CatmullRomCurve3([[0, 0.1, 0], [0.01, 0.045, -0.12], [0.03, 0.026, -0.3], [0.07, 0.024, -0.47],
    [0.15, 0.024, -0.58], [0.23, 0.024, -0.52], [0.23, 0.024, -0.42], [0.16, 0.024, -0.41]].map(p => new THREE.Vector3(...p)));
  const TS = 30, RS = 6, R0 = 0.024;
  const tube = new THREE.TubeGeometry(curve, TS, R0, RS, false);
  const p = tube.attributes.position, ctr = new THREE.Vector3();
  for (let i = 0; i <= TS; i++) {
    curve.getPointAt(i / TS, ctr);
    const f = 1 - 0.55 * (i / TS);
    for (let j = 0; j <= RS; j++) {
      const k = i * (RS + 1) + j;
      p.setXYZ(k, ctr.x + (p.getX(k) - ctr.x) * f, ctr.y + (p.getY(k) - ctr.y) * f, ctr.z + (p.getZ(k) - ctr.z) * f);
    }
  }
  tube.computeVertexNormals();
  curve.getPointAt(1, ctr);
  const tip = new THREE.SphereGeometry(R0 * 0.45, 8, 6).translate(ctr.x, ctr.y, ctr.z);
  return mergeGeometries([tube, tip]);
}

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const vc = roughness => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness, metalness: 0 });

  // ---- the cheese ----
  const wedge = new THREE.Mesh(wedgeGeometry(), vc(0.55));
  wedge.castShadow = true; wedge.receiveShadow = true;
  g.add(wedge);
  const dimples = new THREE.Mesh(dimplesGeometry(), vc(0.7));
  dimples.receiveShadow = true;
  g.add(dimples);

  // ---- axles out to the real wheels ----
  const metal = mat('#3b3f45', 0.45, 0.7);
  const axleGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.62, 10).rotateZ(Math.PI / 2);
  for (const z of [1.36, -1.34]) {
    const a = new THREE.Mesh(axleGeo, metal);
    a.position.set(0, -0.1, z);
    a.castShadow = true;
    g.add(a);
  }

  // ---- the mouse, sitting up on the slope facing forward (origin on the slope under its middle) ----
  const fur = mat('#a3a9b2', 0.85), pale = mat('#dfe2e6', 0.85), pink = mat('#ff9fb6', 0.6);
  const mouse = new THREE.Group();
  mouse.position.set(0, surfY(MZ), MZ);
  g.add(mouse);
  const add = (geo, m, x, y, z, shadow = false) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = shadow; mouse.add(o); return o;
  };
  const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
  add(sph(0.2), fur, 0, 0.18, 0, true).scale.set(1, 1.05, 1.1);           // body
  add(sph(0.15, 14, 10), pale, 0, 0.17, 0.1).scale.set(0.95, 1.05, 0.6);  // belly
  const HY = 0.42, HZ = 0.06, HR = 0.16;
  add(sph(HR), fur, 0, HY, HZ, true);                                    // head
  add(sph(0.085, 14, 10), fur, 0, 0.38, 0.2).scale.set(0.85, 0.8, 1.35); // snout
  add(mergeGeometries([sph(0.03, 8, 6).translate(-0.07, 0.46, 0.19), sph(0.03, 8, 6).translate(0.07, 0.46, 0.19)]),
    mat('#141416', 0.25), 0, 0, 0);                                      // eyes
  // nose, front paws (holding the crumb) and feet
  add(mergeGeometries([sph(0.035, 8, 6).translate(0, 0.39, 0.32),
    sph(0.04, 8, 6).translate(-0.075, 0.25, 0.24), sph(0.04, 8, 6).translate(0.075, 0.25, 0.24),
    sph(0.05, 8, 6).scale(1, 0.6, 1.5).translate(-0.1, 0.02, 0.16), sph(0.05, 8, 6).scale(1, 0.6, 1.5).translate(0.1, 0.02, 0.16)]),
  pink, 0, 0, 0);
  // the crumb: a tiny cheese wedge of its own
  const crumb = add(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 3), mat('#ffcf3a', 0.55), 0, 0.25, 0.25);
  crumb.rotation.set(Math.PI / 2, 0, 0.3);
  // whiskers: three a side, fanned out from the snout
  const wh = [];
  for (const sd of [-1, 1]) for (const a of [-0.22, 0, 0.22]) {
    wh.push(new THREE.CylinderGeometry(0.004, 0.004, 0.17, 4).rotateZ(Math.PI / 2 + sd * a).rotateY(sd * 0.35)
      .translate(sd * 0.115, 0, -0.03));
  }
  const whiskers = new THREE.Group();
  whiskers.position.set(0, 0.38, 0.27);
  whiskers.add(new THREE.Mesh(mergeGeometries(wh), mat('#3a3a3e', 0.5)));
  mouse.add(whiskers);
  // big round ears, pink inside, sticking out to the sides
  const earGeo = new THREE.CylinderGeometry(0.105, 0.105, 0.025, 20).rotateX(Math.PI / 2);
  const innerGeo = new THREE.CylinderGeometry(0.072, 0.072, 0.01, 20).rotateX(Math.PI / 2).translate(0, 0, 0.016);
  const ears = [];
  for (const sd of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(sd * 0.17, HY + 0.07, HZ - 0.02);
    e.rotation.z = -sd * 0.45;
    e.userData.side = sd;
    const outer = new THREE.Mesh(earGeo, fur); outer.castShadow = true;
    e.add(outer, new THREE.Mesh(innerGeo, pink));
    mouse.add(e); ears.push(e);
  }
  // tail: in a frame tilted to lie along the slope, swishing about the slope's normal
  const tailBase = new THREE.Group();
  tailBase.position.set(0, -K * 0.17, -0.17);
  tailBase.rotation.x = -Math.atan(K);
  mouse.add(tailBase);
  const tailSway = new THREE.Group();
  tailBase.add(tailSway);
  const tail = new THREE.Mesh(tailGeometry(), pink);
  tail.castShadow = true;
  tailSway.add(tail);

  // party hat on the mouse's head, googly eyes on the cheese's tall front face
  g.userData.hat = new THREE.Vector3(0, surfY(MZ) + HY + HR, MZ + HZ);
  g.userData.eyes = new THREE.Vector3(0, 0.48, ZF + BEV);

  // ---- motion: the tail swishes, the ears flap back in the wind, the whiskers twitch ----
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (2.5 + 7 * w);
    tailSway.rotation.y = (0.22 + 0.12 * w) * Math.sin(ph);
    for (const e of ears) e.rotation.x = -(0.06 + 0.4 * w) + (0.03 + 0.08 * w) * Math.sin(ph * 2.3 + e.userData.side);
    whiskers.rotation.x = 0.06 * Math.sin(ph * 3.7);
  };
  return g;
}
