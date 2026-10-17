// Headless checks for the barrel roll and the physics hacks.
import * as THREE from 'three';
import { buildHeights, heightAt } from '../src/terrain.js';
import { Vehicle } from '../src/vehicle.js';
// PHYSICS=classic runs the pre-2.0 physics (must match the old numbers exactly)
if (process.env.PHYSICS === 'classic') Vehicle.defaults.phys2 = false;
import { TRIMS, PHYS, MPH } from '../src/config.js';
buildHeights();
const DT = PHYS.DT;
const blank = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: false, descend: false, roll: 0 });
const res = []; const check = (n, ok, info) => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`); };
const make = (trim = 'rocket', x = 0, z = 0, yaw = 0) => { const v = new Vehicle(); v.setTrim(TRIMS[trim]); v.sandbox = true; v.reset(new THREE.Vector3(x, heightAt(x, z) + 0.6, z), yaw); for (let i = 0; i < 360; i++) v.step(DT, blank()); return v; };
const run = (v, sec, c = {}) => { const inp = Object.assign(blank(), c); for (let i = 0; i < sec * 240; i++) { v.step(DT, inp); inp.rollTap = 0; } };
// barrel roll right (E) and left (Q) while hovering
for (const dir of [1, -1]) {
  const v = make(); run(v, 2.5, { lift: true }); run(v, 1);
  const y0 = v.pos.y; let total = 0, minUp = 1;
  const inp = Object.assign(blank(), { rollTap: dir });
  for (let i = 0; i < 240 * 2.5; i++) { v.step(DT, inp); inp.rollTap = 0; total += v.angVel.dot(v.fwd) * DT; minUp = Math.min(minUp, v.up.y); }
  check(`barrel roll ${dir > 0 ? 'right (E)' : 'left (Q)'}`, Math.abs(total) > 5.8 && Math.sign(total) === dir && minUp < -0.9 && v.up.y > 0.97 && !v.roll, `rotated ${(total * 180 / Math.PI).toFixed(0)}°, went inverted (up ${minUp.toFixed(2)}), recovered up ${v.up.y.toFixed(3)}, altitude change ${(v.pos.y - y0).toFixed(1)} m`);
}
// roll does nothing on the ground
{ const v = make(); run(v, 0.5, { rollTap: 1 }); check('no barrel roll on the ground', !v.roll && v.up.y > 0.99, `up ${v.up.y.toFixed(3)}`); }
// hacks
{ const v = make('rocket', 150, -150, Math.PI / 2); v.hack.power = 4; v.hack.topSpeed = 3; run(v, 12, { throttle: 1 }); check('speed hack 3x top speed', v.vel.length() * MPH > 400, `${(v.vel.length() * MPH).toFixed(0)} mph after 12 s (drag-limited)`); }
{ const v = make(); v.hack.gravity = 0.165; run(v, 2.5, { lift: true }); const a = v.pos.y; run(v, 2); check('moon gravity hover', Number.isFinite(v.pos.y) && v.up.y > 0.98 && Math.abs(v.vel.y) < 0.5, `alt ${a.toFixed(1)} -> ${v.pos.y.toFixed(1)}`); }
{ const v = make(); v.hack.thrust = 5; run(v, 2.5, { lift: true }); check('5x thrust stays stable', v.up.y > 0.97 && Number.isFinite(v.pos.y), `alt ${v.pos.y.toFixed(1)} up ${v.up.y.toFixed(3)}`); }
{ const v = make(); v.sandbox = false; v.hack.infiniteAir = true; run(v, 15, { lift: true }); check('infinite air', v.air === TRIMS.rocket.airMax && v.flightMode, `air ${v.air} kg after 15 s of climbing`); }
{ const v = make(); v.quat.setFromEuler(new THREE.Euler(0, 0, Math.PI)); v.pos.y += 1.5; v.hack.noFlip = true; run(v, 3); check('never-flip rights the car', v.up.y > 0.95, `up ${v.up.y.toFixed(2)}`); }
{ const v = make('performance', 150, -150, Math.PI / 2); v.hack.grip = 0.25; run(v, 3, { throttle: 1 }); run(v, 1, { throttle: 1, steer: 1 }); check('ice mode slides', Number.isFinite(v.pos.x), `speed ${(v.vel.length() * MPH).toFixed(0)} mph`); }
{ const v = make(); v.hack.ghost = true; const p0 = v.pos.clone(); run(v, 3, { throttle: 1, lift: true }); v.hack.ghost = false; check('ghost mode flies through', v.pos.distanceTo(p0) > 50 && v.pos.y > 10, `moved ${v.pos.distanceTo(p0).toFixed(0)} m, alt ${v.pos.y.toFixed(0)}`); }
for (const sc of [0.5, 3]) {
  const v = make(); v.setScale(sc); v.reset(new THREE.Vector3(0, heightAt(0, 0) + 0.6 * sc + 0.2, 0), 0); run(v, 2);
  const settledY = v.pos.y; run(v, 3, { throttle: 1 });
  check(`car size ${sc}x drives`, v.contacts >= 3 && v.up.y > 0.95 && v.vel.length() > 10, `rest height ${settledY.toFixed(2)} m, speed ${(v.vel.length() * MPH).toFixed(0)} mph`);
}
{ const v = make('performance'); v.hack.rollAnyTrim = true; v.pos.y += 8; v.vel.set(0, 6, 0); let tot = 0; const inp = Object.assign(blank(), { rollTap: 1 }); v.step(DT, inp); inp.rollTap = 0; for (let i = 0; i < 240; i++) { v.step(DT, inp); tot += v.angVel.dot(v.fwd) * DT; } check('barrel roll on any trim (hack)', tot > 4.5, `rotated ${(tot * 180 / Math.PI).toFixed(0)}° in 1 s`); }
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
