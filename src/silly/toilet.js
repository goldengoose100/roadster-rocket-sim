// Toilet: a giant porcelain toilet riding on the car's wheels (Good Luck menu silly body).
// A shiny white bowl at the front with a pool of bright blue water inside, a white seat on the rim and
// the lid propped open like a big mouth (it chatters faster the quicker you go), a chunky water tank
// at the back with a silver flush lever on its left side, and a spare toilet roll on a chrome peg on
// the right whose loose end flutters in the wind. Looks only.
// Car space: +z forward, y up, ground at y = -0.45, wheels at x ±0.87, z +1.36 / -1.34.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const info = { id: 'toilet', name: 'Toilet' };

// the round parts (bowl, seat, lid, water) are lathed round the y axis, then stretched along z
const SZ = 1.6, ZC = 0.82;
const RIM_Y = 0.65, SEAT_Y = 0.725, WATER_Y = 0.45;
const LID_R = 0.81;                                  // lid half-width (half-length LID_R * SZ)
const HINGE_Z = ZC - LID_R * SZ;                     // the lid hinges at the back of the seat
const TANK_Z = -1.67;                                // centre of the water tank
const ROLL = new THREE.Vector3(0.84, 0.98, -1.85);   // spare toilet roll (axis along x)
const ROLL_R = 0.17, PAPER_L = 0.2;

const v2 = pts => pts.map(([r, y]) => new THREE.Vector2(r, y));
const lathe = (pts, seg) => new THREE.LatheGeometry(v2(pts), seg).scale(1, 1, SZ).translate(0, 0, ZC);

// bowl: a foot that pinches in at the waist, flares out to a rounded rim, then dips inside to the water
function bowlGeometry() {
  return lathe([
    [0, -0.25], [0.36, -0.25], [0.41, -0.235], [0.42, -0.2], [0.4, -0.1], [0.385, 0], [0.41, 0.1],
    [0.5, 0.22], [0.62, 0.35], [0.72, 0.47], [0.775, 0.56], [0.785, 0.615], [0.77, 0.645], [0.73, RIM_Y],
    [0.66, 0.648], [0.62, 0.63], [0.59, 0.58], [0.55, 0.48], [0.5, 0.38], [0.4, 0.28], [0.22, 0.22], [0, 0.2],
  ], 36);
}

// seat: a closed rounded ring sitting on the rim
function seatGeometry() {
  return lathe([
    [0.565, 0.67], [0.585, 0.652], [0.77, 0.652], [0.8, 0.668], [0.805, 0.695], [0.785, 0.718],
    [0.75, SEAT_Y], [0.61, SEAT_Y], [0.575, 0.715], [0.56, 0.69], [0.565, 0.67],
  ], 40);
}

// lid, built lying closed with its back edge on the hinge (origin): a low dome with a flat underside
function lidGeometry() {
  const dome = new THREE.SphereGeometry(1, 40, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(LID_R, 0.065, LID_R * SZ);
  const under = new THREE.CircleGeometry(1, 40).rotateX(Math.PI / 2).scale(LID_R, 1, LID_R * SZ);
  return mergeGeometries([dome, under]).translate(0, 0, LID_R * SZ);
}

export function build() {
  const g = new THREE.Group();
  const mat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const porcelain = mat('#eef3f8', 0.16), white = mat('#ffffff', 0.32);
  const chrome = mat('#e2e6ec', 0.18, 0.9);
  const add = (geo, m, parent = g, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = shadow; o.receiveShadow = true;
    parent.add(o);
    return o;
  };

  // ---- porcelain: bowl, the base under it, the back block, the tank and its lid (one mesh) ----
  const base = new RoundedBoxGeometry(0.76, 0.3, 1.2, 2, 0.12).translate(0, -0.1, 0.25);
  const back = new RoundedBoxGeometry(1.0, 0.9, 1.75, 2, 0.16).translate(0, 0.2, -1.2);
  const tank = new RoundedBoxGeometry(1.36, 0.8, 1.0, 3, 0.1).translate(0, 1.02, TANK_Z);
  const tankLid = new RoundedBoxGeometry(1.46, 0.1, 1.1, 2, 0.045).translate(0, 1.465, TANK_Z);
  add(mergeGeometries([bowlGeometry().toNonIndexed(), base, back, tank, tankLid]), porcelain);   // rounded boxes have no index

  // ---- water in the bowl ----
  const water = add(new THREE.CircleGeometry(0.545, 36).rotateX(-Math.PI / 2).scale(1, 1, SZ),
    mat('#2fb2ff', 0.06, 0.1), g, false);
  water.position.set(0, WATER_Y, ZC);

  // ---- seat, and the lid propped open on its hinge ----
  add(seatGeometry(), white);
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, SEAT_Y, HINGE_Z);
  lidPivot.rotation.x = -0.2;
  g.add(lidPivot);
  add(lidGeometry(), white, lidPivot);

  // ---- chrome: hinge barrel, two hinge bolt caps and the toilet-roll peg ----
  const cap = new THREE.SphereGeometry(0.06, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1);
  add(mergeGeometries([
    new THREE.CylinderGeometry(0.04, 0.04, 0.72, 12).rotateZ(Math.PI / 2).translate(0, SEAT_Y + 0.01, HINGE_Z - 0.02),
    cap.clone().translate(0.36, RIM_Y, HINGE_Z - 0.12),
    cap.clone().translate(-0.36, RIM_Y, HINGE_Z - 0.12),
    new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8).rotateZ(Math.PI / 2).translate(0.84, ROLL.y, ROLL.z),
  ]), chrome);

  // ---- flush lever on the left side of the tank, near the front (it wobbles on bumps) ----
  const lever = new THREE.Group();
  lever.position.set(-0.7, 1.24, -1.4);
  g.add(lever);
  add(mergeGeometries([
    new THREE.CylinderGeometry(0.075, 0.075, 0.04, 16).rotateZ(Math.PI / 2),
    new THREE.CapsuleGeometry(0.032, 0.3, 3, 8).rotateX(Math.PI / 2).translate(-0.05, 0, 0.17),
  ]), chrome, lever);

  // ---- the spare toilet roll: white open tube with ring ends and a cardboard core ----
  const RW = 0.26;
  const roll = mergeGeometries([
    new THREE.CylinderGeometry(ROLL_R, ROLL_R, RW, 24, 1, true).rotateZ(Math.PI / 2),
    new THREE.RingGeometry(0.065, ROLL_R, 24).rotateY(Math.PI / 2).translate(RW / 2, 0, 0),
    new THREE.RingGeometry(0.065, ROLL_R, 24).rotateY(-Math.PI / 2).translate(-RW / 2, 0, 0),
  ]).translate(ROLL.x, ROLL.y, ROLL.z);
  const paperMat = mat('#ffffff', 0.95);
  add(roll, paperMat);
  add(new THREE.CylinderGeometry(0.065, 0.065, RW - 0.012, 14).rotateZ(Math.PI / 2).translate(ROLL.x, ROLL.y, ROLL.z),
    mat('#b07a45', 0.85));

  // the loose end: three strips hanging off the back of the roll, each hinged on the one above
  const stripGeo = new THREE.BoxGeometry(RW - 0.02, PAPER_L, 0.008).translate(0, -PAPER_L / 2, 0);
  const paper = [];
  let parent = g;
  for (let k = 0; k < 3; k++) {
    const p = new THREE.Group();
    if (k === 0) p.position.set(ROLL.x, ROLL.y, ROLL.z - ROLL_R - 0.004);
    else p.position.set(0, -PAPER_L, 0);
    parent.add(p);
    add(stripGeo, paperMat, p);
    paper.push(p);
    parent = p;
  }

  // ---- go-kart axles so the wheels look attached to something ----
  const axle = new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10).rotateZ(Math.PI / 2);
  add(mergeGeometries([axle.clone().translate(0, -0.1, 1.36), axle.clone().translate(0, -0.1, -1.34)]),
    mat('#3b3f45', 0.45, 0.7), g, false);

  // party hat on the tank lid, googly eyes on the front of the bowl
  g.userData.hat = new THREE.Vector3(0, 1.515, TANK_Z);
  g.userData.eyes = new THREE.Vector3(0, 0.4, ZC + 0.665 * SZ);

  // ---- motion: the lid chatters, the paper streams back in the wind, the lever and water jiggle ----
  let last = -1, ph = 0;
  g.userData.tick = (t, speed) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const w = Math.min(1, (speed || 0) / 35);
    ph += dt * (3 + 9 * w);
    lidPivot.rotation.x = -(0.2 + 0.08 * w + (0.015 + 0.045 * w) * Math.sin(ph * 1.8));
    lever.rotation.x = (0.03 + 0.12 * w) * Math.sin(ph * 1.3);
    paper[0].rotation.x = 1.1 * w + (0.04 + 0.12 * w) * Math.sin(ph * 2.6);
    paper[1].rotation.x = (0.05 + 0.25 * w) * Math.sin(ph * 2.6 - 1.1);
    paper[2].rotation.x = (0.08 + 0.35 * w) * Math.sin(ph * 2.6 - 2.2);
    water.position.y = WATER_Y + 0.006 * (0.3 + w) * Math.sin(ph * 1.7);
  };
  return g;
}
