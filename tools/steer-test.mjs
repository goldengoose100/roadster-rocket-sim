// Steering stability checks (headless). Run: node tools/steer-test.mjs
import * as THREE from 'three';
import { buildHeights, heightAt } from '../src/terrain.js';
import { Vehicle } from '../src/vehicle.js';
// PHYSICS=classic runs the pre-2.0 physics (must match the old numbers exactly)
if (process.env.PHYSICS === 'classic') Vehicle.defaults.phys2 = false;
import { TRIMS, PHYS, MPH } from '../src/config.js';

buildHeights();
const DT = PHYS.DT;
const blank = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: false, descend: false, roll: 0 });
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

// car on the drag strip heading +x, brought up to a target speed
function atSpeed(mph, trim = 'rocket') {
  const v = new Vehicle(); v.setTrim(TRIMS[trim]); v.sandbox = true;
  v.reset(new THREE.Vector3(150, heightAt(150, -150) + 0.5, -150), Math.PI / 2);
  const inp = blank();
  for (let i = 0; i < 240; i++) v.step(DT, inp);
  inp.throttle = 1;
  while (v.vel.length() * MPH < mph) v.step(DT, inp);
  return v;
}
const slip = (v) => { const vf = v.vel.dot(v.fwd), vl = v.vel.dot(v.left); return Math.abs(Math.atan2(vl, Math.max(1, Math.abs(vf)))) * 180 / Math.PI; };
const yawOf = (v) => Math.atan2(v.fwd.x, v.fwd.z);

function run(v, seq) { // seq: [[seconds, input], ...]; tracks peak slip angle and yaw rate
  let peak = 0, peakYaw = 0, t = 0;
  for (const [sec, inp] of seq) {
    const c = Object.assign(blank(), inp);
    for (let i = 0; i < sec * 240; i++) { v.step(DT, c); peak = Math.max(peak, slip(v)); peakYaw = Math.max(peakYaw, Math.abs(v.angVel.y)); t += DT; }
  }
  return { peak, peakYaw };
}

for (const mph of [30, 60, 100]) {
  // a quick tap should nudge, not slide
  let v = atSpeed(mph);
  const y0 = yawOf(v);
  let r = run(v, [[0.15, { throttle: 1, steer: 1 }], [1.5, { throttle: 1 }]]);
  const dYaw = Math.abs(yawOf(v) - y0) * 180 / Math.PI;
  check(`tap A at ${mph} mph`, r.peak < 4 && dYaw < 12, `peak slip ${r.peak.toFixed(1)}°, heading change ${dYaw.toFixed(1)}°`);
  // holding the key turns without spinning out
  v = atSpeed(mph);
  r = run(v, [[1.2, { throttle: 1, steer: 1 }], [2, { throttle: 1 }]]);
  check(`hold A 1.2 s at ${mph} mph`, r.peak < 9 && v.up.y > 0.9, `peak slip ${r.peak.toFixed(1)}°, peak yaw rate ${r.peakYaw.toFixed(2)} rad/s, final slip ${slip(v).toFixed(1)}°`);
  // quick left-right lane change
  v = atSpeed(mph);
  r = run(v, [[0.35, { throttle: 1, steer: 1 }], [0.35, { throttle: 1, steer: -1 }], [1.5, { throttle: 1 }]]);
  check(`lane change at ${mph} mph`, r.peak < 7 && slip(v) < 2, `peak slip ${r.peak.toFixed(1)}°, settles to ${slip(v).toFixed(1)}°`);
}
// slow tight turn still works (parking-lot U-turn)
{
  const v = atSpeed(10);
  const y0 = yawOf(v);
  run(v, [[3, { throttle: 0.4, steer: 1 }]]);
  let d = (yawOf(v) - y0) * 180 / Math.PI; d = ((d % 360) + 360) % 360;
  check('low-speed U-turn still tight', d > 120, `turned ${d.toFixed(0)}° in 3 s at ~10 mph`);
}
// handbrake drifts are still possible on purpose
{
  const v = atSpeed(45);
  const r = run(v, [[0.4, { steer: 1 }], [0.8, { steer: 1, handbrake: true }], [0.6, { throttle: 1, steer: 1 }]]);
  check('handbrake drift still works', r.peak > 15, `peak slip ${r.peak.toFixed(1)}°`);
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
