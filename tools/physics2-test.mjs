// Headless checks for Physics 2.0 (and that Classic still gives the 1.1.5 numbers). Run: node tools/physics2-test.mjs
import * as THREE from 'three';
import { buildHeights, heightAt } from '../src/terrain.js';
import { addCollider, OBB } from '../src/colliders.js';
import { Vehicle } from '../src/vehicle.js';
import { TRIMS, PHYS, MPH } from '../src/config.js';
import { env, liftArea, draftFactor, tireTempGrip, GAS, AMBIENT_C } from '../src/physics2.js';
import { frontRadius, arrivalTime, SOUND_SPEED } from '../src/shockwave.js';
buildHeights();
const DT = PHYS.DT;
const blank = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: false, descend: false, roll: 0 });
const res = []; const check = (n, ok, info) => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`); };
const make = (trim = 'rocket', x = 0, z = 0, yaw = 0, phys2 = true) => {
  const v = new Vehicle(); v.phys2 = phys2; v.setTrim(TRIMS[trim]);
  v.reset(new THREE.Vector3(x, heightAt(x, z) + 0.5, z), yaw);
  for (let i = 0; i < 360; i++) v.step(DT, blank());
  return v;
};
const run = (v, sec, c = {}) => { const inp = Object.assign(blank(), c); for (let i = 0; i < sec * 240; i++) { v.step(DT, inp); inp.rollTap = 0; } };
const z60 = (v, boost) => { const inp = Object.assign(blank(), { throttle: 1, boost }); let t = 0; while (t < 5) { v.step(DT, inp); t += DT; if (v.vel.length() >= 26.8224) return t; } return t; };

// ---------- Classic = version 1.1.5 ----------
{
  const got = ['performance', 'thrust', 'rocket'].map(t => z60(make(t, 150, -150, Math.PI / 2, false), t !== 'performance'));
  check('Classic 0-60 times match 1.1.5', got.map(x => x.toFixed(2)).join() === '1.64,0.88,0.52', got.map(x => x.toFixed(2)).join(' / ') + ' s');
  const v = make('rocket', 0, 0, 0, false); run(v, 2.5, { lift: true }); run(v, 4);
  check('Classic hover air use matches 1.1.5', v.air.toFixed(1) === '43.5', `${v.air.toFixed(1)} kg left (1.1.5: 43.5)`);
}
// ---------- tires ----------
{
  const v = make('performance', 150, -150, Math.PI / 2);
  check('parked tires: ambient temperature, full grip', v.wheels.every(w => w.temp < AMBIENT_C + 0.1 && Math.abs(w.gripF - 1) < 1e-4), `${v.wheels[0].temp.toFixed(2)} °C, grip ${v.wheels[0].gripF.toFixed(4)}`);
  v.esc = false; v.fan.mode = 'off';
  run(v, 2, { throttle: 1 }); run(v, 5, { throttle: 1, steer: 1, handbrake: true });
  const hot = Math.max(...v.wheels.map(w => w.temp)), wear = Math.max(...v.wheels.map(w => w.wear));
  check('drifting heats and wears the tires', hot > 70 && wear > 0.001, `hottest ${hot.toFixed(0)} °C, wear ${(wear * 100).toFixed(1)}%, pressure ${v.wheels[2].psi.toFixed(1)} psi`);
  run(v, 25);
  check('tires cool down again', Math.max(...v.wheels.map(w => w.temp)) < hot - 20, `${Math.max(...v.wheels.map(w => w.temp)).toFixed(0)} °C after 25 s`);
  check('grip peaks warm and drops when overheated', tireTempGrip(90) > 1.04 && tireTempGrip(200) < 0.8, `90 °C ${tireTempGrip(90)}, 200 °C ${tireTempGrip(200).toFixed(2)}`);
  const u = make('performance', 150, -150, Math.PI / 2); u.esc = false; u.fan.mode = 'off'; u.hack.noTireHeat = true;
  run(u, 2, { throttle: 1 }); run(u, 5, { throttle: 1, steer: 1, handbrake: true });
  check('tire heat off (mod) keeps them at ambient', u.wheels.every(w => w.temp === AMBIENT_C), `${u.wheels[2].temp} °C`);
  const t3 = make('performance', 150, -150, Math.PI / 2); t3.tune.heat = 0.55; t3.esc = false; t3.fan.mode = 'off';
  run(t3, 2, { throttle: 1 }); run(t3, 5, { throttle: 1, steer: 1, handbrake: true });
  check('tire upgrade L3 runs cooler', Math.max(...t3.wheels.map(w => w.temp)) < hot - 10, `${Math.max(...t3.wheels.map(w => w.temp)).toFixed(0)} °C vs ${hot.toFixed(0)} °C stock`);
}
// ---------- crash damage ----------
{
  addCollider(new OBB(new THREE.Vector3(0, 3, 360), new THREE.Quaternion(), new THREE.Vector3(30, 3, 1), { surface: 'concrete' }));
  const hit = (mph, yaw = 0, z = 330) => { const v = make('rocket', 0, z, yaw); v.vel.set(0, 0, mph / MPH); run(v, 2); return v; };
  const slow = hit(15);
  check('15 mph bump: no damage', slow.damage.hits === 0, `hits ${slow.damage.hits}`);
  const fast = hit(65);
  check('65 mph head-on: front crushed, car pulls', fast.damage.zones.front > 0.5 && fast.damage.condition(fast) < 0.8, `front ${fast.damage.zones.front.toFixed(2)}, condition ${(fast.damage.condition(fast) * 100).toFixed(0)}%`);
  const side = hit(85, Math.PI / 2, 353);
  check('85 mph side impact: a wheel breaks off', side.wheels.some(w => w.broken), `wheels ${side.wheels.map(w => w.broken ? 'X' : w.bend.toFixed(2)).join(' ')}`);
  side.repairAll();
  check('repair restores everything', side.damage.hits === 0 && side.wheels.every(w => !w.broken && w.bend === 0 && w.wear === 0) && side.damage.condition(side) === 1, 'ok');
  const nd = make('rocket', 0, 330); nd.hack.noDamage = true; nd.vel.set(0, 0, 30); run(nd, 2);
  check('damage off (mod)', nd.damage.hits === 0, `hits ${nd.damage.hits}`);
  const drop = make('rocket', 0, 0); drop.pos.y += 10; drop.sandbox = true; run(drop, 3);
  check('10 m drop onto the wheels: no damage', drop.damage.hits === 0, `hits ${drop.damage.hits}`);
}
// ---------- aerodynamics, slipstream, wind ----------
{
  check('level car: same downforce as Classic', liftArea(0) === -0.75 && liftArea(0.4) > 0, `CL·A level ${liftArea(0)}, nose up 23° ${liftArea(0.4).toFixed(2)}`);
  const wake = { pos: new THREE.Vector3(0, 0, 20), vel: new THREE.Vector3(0, 0, 50), hw: 1 };
  const d1 = draftFactor(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, 50), [wake]);
  const d2 = draftFactor(new THREE.Vector3(6, 0, 10), new THREE.Vector3(0, 0, 50), [wake]);
  check('slipstream: big right behind a car, none off to the side', d1 > 0.3 && d2 < 0.05, `behind ${(d1 * 100).toFixed(0)}%, 6 m to the side ${(d2 * 100).toFixed(0)}%`);
  env.wind.scale = 0;
  const a = make('rocket', 150, -150, Math.PI / 2), b = make('rocket', 150, -150, Math.PI / 2);
  run(a, 6, { throttle: 1 });
  env.wakes.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), hw: 1 });
  const k = env.wakes[0];
  const inp = Object.assign(blank(), { throttle: 1 });
  for (let i = 0; i < 6 * 240; i++) { k.vel.copy(b.vel); k.pos.copy(b.pos).addScaledVector(b.vel.clone().normalize(), 10); b.step(DT, inp); }
  env.wakes.length = 0; env.wind.scale = 1;
  check('drafting car is faster', b.vel.length() > a.vel.length() + 0.5, `${(a.vel.length() * MPH).toFixed(0)} mph alone, ${(b.vel.length() * MPH).toFixed(0)} mph drafting`);
  env.wind.t = 500;
  const w = env.wind.sample(0, 0, 0, new THREE.Vector3());
  check('wind blows', w.length() > 1 && w.length() < 25, `${w.length().toFixed(1)} m/s`);
  const h = make('rocket', 0, 0); h.sandbox = true; run(h, 2.5, { lift: true }); run(h, 6);
  check('hover holds against the wind', h.up.y > 0.99 && Math.hypot(h.vel.x, h.vel.z) < 1.5, `drift ${Math.hypot(h.vel.x, h.vel.z).toFixed(2)} m/s`);
}
// ---------- air tank ----------
{
  const v = make('rocket', 0, 0);
  run(v, 0.1);
  check('full tank reads 5,500 psi at ambient', Math.abs(v.tankPsi - GAS.psiFull) < 1, `${v.tankPsi.toFixed(0)} psi`);
  run(v, 2.5, { lift: true }); run(v, 3);
  check('blowdown: gas gets cold, pressure falls faster than mass', v.tankT < 273 && v.tankPsi / GAS.psiFull < v.air / 250, `${(v.tankT - 273.15).toFixed(0)} °C, ${v.tankPsi.toFixed(0)} psi, ${v.air.toFixed(0)} kg`);
  const c = make('rocket', 0, 0, 0, false), p = make('rocket', 0, 0);
  const endure = (x) => { run(x, 2, { lift: true }); let t = 0; while (x.air > 0.3 && t < 30) { x.step(DT, blank()); t += DT; } return t + 2; };
  const tc = endure(c), tp = endure(p);
  check('hover time about the same as Classic', Math.abs(tp - tc) / tc < 0.12, `Classic ${tc.toFixed(1)} s, 2.0 ${tp.toFixed(1)} s`);
  const r = make('rocket', 0, 0); r.air = 20; r.updateMass(); r.tankT = 200; r.addAir(150);
  check('refilling warms the tank', r.tankT > 230, `${(r.tankT - 273.15).toFixed(0)} °C after a fast fill`);
  const l = make('rocket', 0, 0); l.damage.tankLeak = 0.5; run(l, 5);
  check('a cracked tank leaks', l.air < 245, `${l.air.toFixed(0)} kg after 5 s`);
}
// ---------- valves ----------
{
  const v = make('rocket', 0, 0); v.sandbox = true;
  const inp = Object.assign(blank(), { boost: true });
  v.step(DT, inp); const u1 = v.rear[0].u;
  for (let i = 0; i < 24; i++) v.step(DT, inp);
  const u25 = v.rear.map(t => t.u);
  check('valves: short delay, then open at slightly different speeds', u1 === 0 && Math.min(...u25) > 0.7 && new Set(u25.map(x => x.toFixed(4))).size > 1, `after 1 step ${u1}, after 0.1 s ${u25.map(x => x.toFixed(2)).join(' ')}`);
}
// ---------- shockwave ----------
{
  check('shockwave travels at the speed of sound', Math.abs(arrivalTime(9, 343 + 10.8) - 1) < 0.01 && frontRadius(9, 0.01) > SOUND_SPEED * 0.01, `reaches 354 m after ${arrivalTime(9, 353.8).toFixed(3)} s`);
}
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
