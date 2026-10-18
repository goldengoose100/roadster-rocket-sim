// Rubber Duck: a giant squeaky bath duck riding on the car's wheels (Good Luck menu silly body).
// Looks only. Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';

export const info = { id: 'duck', name: 'Rubber Duck' };

const BODY_Y = 0.27, BODY_Z = -0.22;          // centre of the body egg
const NECK = new THREE.Vector3(0, 0.66, 0.8);   // the head nods around this point
const HEAD_R = 0.55, HEAD_C = new THREE.Vector3(0, 1.04, 0.92);

// squashed egg: flat belly, back sweeping up toward the tail, a little wider at the rear
function bodyGeometry() {
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let Y = y * (y >= 0 ? 0.68 : 0.52);
    if (z < 0) Y += 0.22 * z * z * Math.max(0, y + 0.3);
    p.setXYZ(i, x * 0.92 * (1 - 0.05 * z), Y + BODY_Y, z * 1.65 + BODY_Z);
  }
  geo.computeVertexNormals();
  return geo;
}

// pointy upturned tail, revolved around y (base at y = 0, tip at y = 0.9)
function tailGeometry() {
  const pts = [[0.34, 0], [0.335, 0.15], [0.3, 0.32], [0.23, 0.5], [0.15, 0.66], [0.08, 0.79], [0.025, 0.875], [0, 0.9]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 16);
}

export function build() {
  const g = new THREE.Group();
  const duck = new THREE.Group(); // bobs on the "water"
  g.add(duck);

  const mat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const yellow = mat('#ffd21f', 0.3);
  const wingYellow = mat('#ffc20e', 0.34);
  const orange = mat('#ff7a12', 0.32);
  const white = mat('#ffffff', 0.22);
  const black = mat('#121212', 0.12);
  const blush = mat('#ff8aa0', 0.6);
  const metal = mat('#3b3f45', 0.45, 0.7);

  const add = (parent, geo, material, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };

  // body
  const body = add(duck, bodyGeometry(), yellow, 0, 0, 0);
  body.receiveShadow = true;

  // wings: raised teardrops on the flanks, rear tips flicked up
  const wingGeo = new THREE.SphereGeometry(1, 16, 10);
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = add(duck, wingGeo, wingYellow, sx * 0.84, 0.48, -0.45);
    w.scale.set(0.13, 0.3, 0.7);
    w.rotation.set(0.28, 0, 0.22 * sx);
    w.userData.sx = sx;
    wings.push(w);
  }

  // tail
  const tail = add(duck, tailGeometry(), yellow, 0, 0.55, -1.42);
  tail.scale.set(1, 1, 0.55);
  tail.rotation.x = -0.85;

  // go-kart axles so the wheels look attached to something
  const axleGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10).rotateZ(Math.PI / 2);
  add(g, axleGeo, metal, 0, -0.1, 1.36, false);
  add(g, axleGeo, metal, 0, -0.1, -1.34, false);
  add(g, new THREE.CylinderGeometry(0.04, 0.04, 0.72, 8).rotateX(Math.PI / 2), metal, 0, -0.1, 1.1, false);

  // head group (nods)
  const head = new THREE.Group();
  head.position.copy(NECK);
  duck.add(head);
  const L = (v) => v.clone().sub(NECK); // world -> head-local
  const hc = L(HEAD_C);
  const skull = add(head, new THREE.SphereGeometry(1, 26, 16), yellow, hc.x, hc.y, hc.z);
  skull.scale.set(HEAD_R, HEAD_R * 0.96, HEAD_R);

  // beak: wide flat upper bill smiling upward, lower bill on a hinge so it can quack
  const beakGeo = new THREE.SphereGeometry(1, 18, 10);
  const upper = add(head, beakGeo, orange, 0, HEAD_C.y - 0.06 - NECK.y, 1.52 - NECK.z);
  upper.scale.set(0.32, 0.105, 0.38);
  upper.rotation.x = -0.12;
  const jaw = new THREE.Group();
  jaw.position.set(0, HEAD_C.y - 0.115 - NECK.y, 1.3 - NECK.z);
  head.add(jaw);
  const lower = add(jaw, beakGeo, orange, 0, -0.01, 0.2);
  lower.scale.set(0.26, 0.07, 0.31);
  jaw.rotation.x = 0.05;

  // eyes: white balls with flat black pupils looking ahead, plus a sparkle
  const eyeGeo = new THREE.SphereGeometry(0.14, 14, 10);
  const pupilGeo = new THREE.SphereGeometry(1, 12, 8);
  const sparkGeo = new THREE.SphereGeometry(0.028, 6, 4);
  const Z = new THREE.Vector3(0, 0, 1);
  for (const sx of [-1, 1]) {
    const d = new THREE.Vector3(0.52 * sx, 0.4, 0.75).normalize();
    const eyeW = HEAD_C.clone().addScaledVector(d, HEAD_R - 0.045);
    const pd = d.clone().lerp(new THREE.Vector3(0.22 * sx, 0.12, 1).normalize(), 0.45).normalize();
    const e = L(eyeW);
    add(head, eyeGeo, white, e.x, e.y, e.z);
    const pc = e.clone().addScaledVector(pd, 0.12);
    const pupil = add(head, pupilGeo, black, pc.x, pc.y, pc.z);
    pupil.scale.set(0.085, 0.095, 0.042);
    pupil.quaternion.setFromUnitVectors(Z, pd);
    const sc = pc.clone().addScaledVector(pd, 0.035).add(new THREE.Vector3(0.025 * sx, 0.035, 0));
    add(head, sparkGeo, white, sc.x, sc.y, sc.z, false);
    // rosy cheek just behind the beak
    const cd = new THREE.Vector3(0.6 * sx, -0.02, 0.8).normalize();
    const cc = L(HEAD_C.clone().addScaledVector(cd, HEAD_R - 0.03));
    const cheek = add(head, pupilGeo, blush, cc.x, cc.y, cc.z, false);
    cheek.scale.set(0.1, 0.065, 0.04);
    cheek.quaternion.setFromUnitVectors(Z, cd);
  }

  // little curl of hair on top
  const tuft = add(head, new THREE.TorusGeometry(0.075, 0.027, 6, 12, Math.PI * 1.4).rotateY(Math.PI / 2), yellow,
    0, HEAD_C.y + HEAD_R * 0.96 + 0.035 - NECK.y, HEAD_C.z - 0.04 - NECK.z);
  tuft.rotation.x = 0.5;

  // bob on the water, nod, quack every few seconds, flap faster the faster we go, wag the tail
  let lastT = 0, flap = 0;
  g.userData.tick = (t, speed) => {
    const s = Math.min(1, Math.abs(speed || 0) / 30);
    const dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    flap += dt * (5 + 14 * s);
    duck.position.y = 0.035 * Math.sin(t * 2.4);
    duck.rotation.z = 0.03 * Math.sin(t * 1.7);
    duck.rotation.x = 0.02 * Math.sin(t * 2.4 + 0.8) - 0.03 * s;
    head.rotation.x = 0.06 * Math.sin(t * 2.4 + 1.6);
    const q = t % 3.1;
    jaw.rotation.x = 0.05 + (q < 0.4 ? 0.42 * Math.sin((q / 0.4) * Math.PI) : 0);
    const f = 0.5 + 0.5 * Math.sin(flap);
    for (const w of wings) w.rotation.y = -w.userData.sx * (0.04 + (0.06 + 0.12 * s) * f);
    tail.rotation.z = 0.12 * Math.sin(t * 5.5);
  };
  return g;
}
