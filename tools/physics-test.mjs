// Headless physics checks (no rendering). Run: node tools/physics-test.mjs
import * as THREE from 'three';
import { buildHeights, heightAt } from '../src/terrain.js';
import { addCollider, Curve, OBB } from '../src/colliders.js';
import { Vehicle } from '../src/vehicle.js';
import { TRIMS, PHYS, MPH } from '../src/config.js';

buildHeights();
const DT = PHYS.DT;
const blank = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: false, descend: false, roll: 0 });

function spawn(trim, x, z, yaw = 0, sandbox = false) {
  const v = new Vehicle();
  v.setTrim(TRIMS[trim]);
  v.sandbox = sandbox;
  v.reset(new THREE.Vector3(x, heightAt(x, z) + 0.5, z), yaw);
  const inp = blank();
  for (let i = 0; i < 240 * 1.5; i++) v.step(DT, inp);
  return v;
}
function bad(v) { return !Number.isFinite(v.pos.x + v.pos.y + v.pos.z + v.vel.x + v.quat.w); }

// 1. settle
{
  const v = spawn('rocket', 0, 0);
  console.log('settle: y=%s speed=%s contacts=%d comp=%s', v.pos.y.toFixed(3), v.vel.length().toFixed(3), v.contacts, v.wheels.map(w => w.comp.toFixed(3)).join(','));
}
// 2. 0-60 per trim (on drag strip, heading +x => yaw = +90deg)
for (const trim of ['performance', 'thrust', 'rocket']) {
  const v = spawn(trim, 150, -150, Math.PI / 2);
  const inp = blank(); inp.throttle = 1; inp.boost = trim !== 'performance';
  let t = 0, t60 = null, tq = null, x0 = v.pos.x, trap = 0, top = 0;
  while (t < 40) {
    v.step(DT, inp); t += DT;
    const s = v.vel.length() * MPH;
    top = Math.max(top, s);
    if (t60 === null && s >= 60) t60 = t;
    if (tq === null && v.pos.x - x0 >= 402.34) { tq = t; trap = s; }
    if (v.pos.x > 1100) break;
    if (!v.sandbox && v.air <= 0) inp.boost = false;
  }
  console.log(`${trim}: 0-60 ${t60?.toFixed(2)} s, 1/4 mi ${tq?.toFixed(2)} s @ ${trap.toFixed(0)} mph, top ${top.toFixed(0)} mph, air left ${v.air.toFixed(1)} kg, bad=${bad(v)}`);
}
// 2b. top speed without boost
{
  const v = spawn('rocket', 150, -150, Math.PI / 2, true);
  const inp = blank(); inp.throttle = 1;
  let t = 0, top = 0; while (t < 30 && v.pos.x < 1150) { v.step(DT, inp); t += DT; top = Math.max(top, v.vel.length() * MPH); }
  console.log(`top speed (wheels only) ${top.toFixed(0)} mph after ${t.toFixed(1)} s`);
}
// 3. hover test
{
  const v = spawn('rocket', 0, 0, 0, false);
  const inp = blank(); inp.lift = true;
  let t = 0;
  for (; t < 2.5; t += DT) v.step(DT, inp);
  const yA = v.pos.y;
  inp.lift = false;
  let maxDrift = 0, ys = [];
  const p0 = v.pos.clone();
  for (let k = 0; k < 240 * 4; k++) { v.step(DT, inp); ys.push(v.pos.y); }
  console.log(`hover: after climb y=${yA.toFixed(2)}; after 4s hold y=${v.pos.y.toFixed(2)} vy=${v.vel.y.toFixed(2)} drift=${v.pos.clone().sub(p0).setY(0).length().toFixed(2)} m, up.y=${v.up.y.toFixed(3)}, air=${v.air.toFixed(1)} kg, flight=${v.flightMode}`);
  inp.descend = true;
  let landT = 0, maxImpact = 0;
  for (let k = 0; k < 240 * 12; k++) { v.step(DT, inp); for (const e of v.events) maxImpact = Math.max(maxImpact, e.speed); v.events.length = 0; if (!v.flightMode && v.contacts >= 3) { landT = k * DT; break; } }
  console.log(`landing: landed after ${landT.toFixed(2)} s, contacts=${v.contacts}, impact=${maxImpact.toFixed(2)}, air=${v.air.toFixed(1)}`);
}
// 3b. hover endurance (real air)
{
  const v = spawn('rocket', 0, 0, 0, false);
  const inp = blank(); inp.lift = true;
  let t = 0; for (; t < 1.5; t += DT) v.step(DT, inp);
  inp.lift = false;
  while (v.air > 0.1 && t < 60) { v.step(DT, inp); t += DT; }
  console.log(`endurance: air empty at t=${t.toFixed(1)} s, alt=${v.pos.y.toFixed(1)}`);
}
// 4. flight: forward tilt, yaw, roll
{
  const v = spawn('rocket', 0, 0, 0, true);
  const inp = blank(); inp.lift = true;
  for (let k = 0; k < 240 * 2; k++) v.step(DT, inp);
  inp.lift = false; inp.throttle = 1;
  for (let k = 0; k < 240 * 3; k++) v.step(DT, inp);
  const vf = v.vel.dot(new THREE.Vector3(0, 0, 1));
  inp.throttle = 0; inp.steer = 1;
  for (let k = 0; k < 240 * 2; k++) v.step(DT, inp);
  const yaw = Math.atan2(v.fwd.x, v.fwd.z);
  inp.steer = 0; inp.boost = true;
  for (let k = 0; k < 240 * 1; k++) v.step(DT, inp);
  console.log(`flight: fwd speed after W 3s=${vf.toFixed(1)} m/s; yaw after A 2s=${(yaw * 180 / Math.PI).toFixed(0)} deg; speed after 1s boost=${(v.vel.length() * MPH).toFixed(0)} mph alt=${v.pos.y.toFixed(1)} up.y=${v.up.y.toFixed(2)}`);
}
// 5. flip recovery: start upside down in air
{
  const v = new Vehicle(); v.setTrim(TRIMS.rocket); v.sandbox = true;
  v.reset(new THREE.Vector3(0, 30, 0), 0);
  v.quat.setFromEuler(new THREE.Euler(0.3, 0, Math.PI - 0.2));
  const inp = blank();
  for (let k = 0; k < 240 * 2; k++) v.step(DT, inp);
  console.log(`flip recovery (assist, airborne): up.y after 2s = ${v.up.y.toFixed(3)}, y=${v.pos.y.toFixed(1)}`);
}
// 6. loop: curve collider with helical shift
{
  const R = 14;
  addCollider(new Curve(new THREE.Vector3(0, 0, 0), 0, R, 4.5, Math.PI * 2, { shift: -10 }));
  const beta = Math.atan2(-10 / (2 * Math.PI * R), 1); // approach along the helix angle
  const v = spawn('rocket', -60 * Math.tan(beta), -60, beta, true);
  const inp = blank(); inp.throttle = 1;
  let maxY = 0, minUp = 1, t = 0;
  while (t < 12) { v.step(DT, inp); t += DT; maxY = Math.max(maxY, v.pos.y); minUp = Math.min(minUp, v.up.y); if (v.pos.z > 40) break; if (v.vel.length() * MPH > 75 && v.pos.z < -5) inp.throttle = 0.2; }
  console.log(`loop: maxY=${maxY.toFixed(1)} (2R=${2 * R}) min up.y=${minUp.toFixed(2)} final x=${v.pos.x.toFixed(1)} z=${v.pos.z.toFixed(1)} up.y=${v.up.y.toFixed(2)} speed=${(v.vel.length() * MPH).toFixed(0)} bad=${bad(v)}`);
}
