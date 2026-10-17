// End-to-end gameplay checks in a real browser. Run: node tools/play-test.mjs <screenshot dir>
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
const only = process.argv[3];
const s = await openSim({ width: 1280, height: 800, quality: 2 });
const page = s.page;
const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info ?? ''}`); };
await waitReady(page);
await page.evaluate(() => window.__sim.startGame());
// the test drives the physics itself; pause the game's own loop so screenshots taken mid-stunt
// don't add seconds of 'no keys pressed' physics on slow machines
await page.evaluate(() => { window.__sim.freeze = true; });

const step = (sec, c) => page.evaluate(([sec, c]) => { window.__sim.step(Math.round(sec * 240), c); }, [sec, c]);
const state = () => page.evaluate(() => {
  const v = window.__sim.vehicle;
  return { x: v.pos.x, y: v.pos.y, z: v.pos.z, vx: v.vel.x, vy: v.vel.y, vz: v.vel.z, speed: v.vel.length(), upY: v.up.y, contacts: v.contacts, air: v.air, flight: v.flightMode,
    fwdX: v.fwd.x, fwdZ: v.fwd.z, agl: v.agl, ok: Number.isFinite(v.pos.x + v.pos.y + v.pos.z + v.quat.w + v.vel.x) };
});
const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}.png` }); };
const tp = (k) => page.evaluate((k) => window.__sim.teleport(k), k);
const want = (n) => !only || only.split(',').includes(n);

// --- every teleport settles cleanly ---
if (want('tp')) {
  for (let k = 1; k <= 9; k++) {
    await tp(k);
    await step(2);
    const st = await state();
    check(`teleport ${k} settles`, st.ok && st.contacts >= 3 && st.speed < 0.6 && st.upY > 0.95, `contacts=${st.contacts} speed=${st.speed.toFixed(2)} up=${st.upY.toFixed(3)} y=${st.y.toFixed(2)}`);
    await shot(`tp-${k}`);
  }
}

// --- drag strip: 0-60 and quarter mile with boost ---
if (want('drag')) {
  await tp(2); await step(1.5);
  await step(7, { throttle: 1, boost: true });
  const t = await page.evaluate(() => ({ z60: window.__sim.G.timers.last060, qm: window.__sim.G.timers.lastQM }));
  const st = await state();
  check('0-60 timed on drag strip (Rocket)', t.z60 > 0.4 && t.z60 < 0.65, `0-60=${t.z60.toFixed(3)} s, 1/4=${t.qm ? t.qm.toFixed(2) : '-'} s, speed=${(st.speed * 2.237).toFixed(0)} mph, air left=${st.air.toFixed(0)} kg`);
  await step(6, { brake: 1 });
  await shot('drag-after');
}

// --- demo ramp: drive up past vertical, assist flips and lands ---
if (want('demo')) {
  await tp(3); await step(1);
  let minUp = 1, maxY = 0, landedUpright = false;
  for (let i = 0; i < 140; i++) {
    await step(0.1, { throttle: 1 });
    const st = await state();
    minUp = Math.min(minUp, st.upY); maxY = Math.max(maxY, st.y);
    if (st.upY < -0.6) break;
  }
  await shot('demo-inverted');
  // let go: flight assist flips upright; hold Space briefly to hover like the demo
  await step(0.8, {});
  await step(1.2, { lift: true });
  await shot('demo-hover');
  await step(6, { descend: true });
  await step(1, {});   // let the springs settle (Physics 2.0 touches down a fraction later)
  const st = await state();
  landedUpright = st.contacts >= 3 && st.upY > 0.95;
  check('demo ramp: inverted at the top, then flips and lands', minUp < -0.5 && landedUpright, `minUp=${minUp.toFixed(2)} maxY=${maxY.toFixed(1)} final up=${st.upY.toFixed(2)} contacts=${st.contacts}`);
}

// --- loop of death ---
if (want('loop')) {
  await tp(4); await step(1);
  let minUp = 1, maxY = 0;
  for (let i = 0; i < 200; i++) {
    const st0 = await state();
    await step(0.1, { throttle: st0.speed < 30 ? 1 : 0.3 });
    const st = await state();
    minUp = Math.min(minUp, st.upY); maxY = Math.max(maxY, st.y);
    if (st.z > 330) break;
    if (st.y > 20 && !globalThis.loopShot) { globalThis.loopShot = 1; await page.evaluate(() => window.__sim.setCam(1)); await shot('loop-mid'); await page.evaluate(() => window.__sim.setCam(0)); }
  }
  const st = await state();
  check('loop of death completed', minUp < -0.9 && maxY > 25 && st.z > 300 && st.upY > 0.9 && st.contacts >= 3, `minUp=${minUp.toFixed(2)} maxY=${maxY.toFixed(1)} end=(${st.x.toFixed(1)}, ${st.z.toFixed(1)}) up=${st.upY.toFixed(2)}`);
}

// --- wall ride ---
if (want('wall')) {
  await tp(5); await step(1);
  await step(1.5, { throttle: 1 });
  let maxY = 0, sideways = 0, shotDone = false, onWall = false;
  for (let i = 0; i < 140; i++) {
    const st = await state();
    const v = await page.evaluate(() => ({ fy: window.__sim.vehicle.fwd.y, fx: window.__sim.vehicle.fwd.x, fz: window.__sim.vehicle.fwd.z }));
    let steer;
    if (!onWall && st.y < 2) {
      // phase 1: hold a 35 degree heading into the quarter pipe
      const yaw = Math.atan2(v.fx, v.fz), want = Math.atan2(Math.cos(0.6), Math.sin(0.6));
      steer = Math.max(-1, Math.min(1, (want - yaw) * 3));
    } else {
      onWall = true;
      // phase 2: hold ~15 m up the wall by steering the nose up / down
      const desired = Math.max(-0.3, Math.min(0.35, (15 - st.y) * 0.06));
      steer = Math.max(-1, Math.min(1, -(desired - v.fy) * 5));
    }
    await step(0.1, { throttle: st.speed < 30 ? 1 : 0.4, steer });
    const s2 = await state();
    maxY = Math.max(maxY, s2.y);
    if (s2.y > 10 && Math.abs(s2.upY) < 0.3) { sideways += 0.1; if (!shotDone && sideways > 1) { shotDone = true; await page.evaluate(() => window.__sim.setCam(1)); await shot('wall-ride'); await page.evaluate(() => window.__sim.setCam(0)); } }
    if (s2.x > 965) break;
  }
  const st = await state();
  check('wall ride: car rides the vertical wall', maxY > 10 && sideways > 0.5, `maxY=${maxY.toFixed(1)} time on wall=${sideways.toFixed(1)} s ok=${st.ok}`);
  await step(4, {});
}

// --- lineup jump ---
if (want('jump')) {
  await tp(6); await step(1);
  let airborne = 0, maxY = 0;
  for (let i = 0; i < 70; i++) {
    const st = await state();
    await step(0.1, { throttle: st.speed < 34 ? 1 : 0.2 });
    const s2 = await state();
    if (s2.contacts === 0) airborne += 0.1;
    maxY = Math.max(maxY, s2.y);
    if (s2.x < -700) break;
    if (s2.x < -585 && s2.x > -600 && s2.contacts === 0) await shot('jump-over-lineup');
  }
  const st = await state();
  const blasted = await page.evaluate(() => window.__sim.destruction.targets.filter(t => t.state !== 'static').length);
  check('lineup jump clears the cars and the Semi', airborne > 0.8 && st.x < -615 && st.ok && st.upY > 0.9 && blasted === 0, `air=${airborne.toFixed(1)} s maxY=${maxY.toFixed(1)} x=${st.x.toFixed(1)} up=${st.upY.toFixed(2)} (driving never destroys: ${blasted} moved)`);
}

// --- flight in the canyon ---
if (want('flight')) {
  await tp(7); await step(1);
  await page.evaluate(() => { window.__sim.vehicle.sandbox = true; });
  await step(3, { lift: true });
  const a = await state();
  await step(4, { throttle: 1 });
  const b = await state();
  await shot('flight-canyon');
  await step(6, {});
  const c = await state();
  check('flight: climbs, tilts forward, brakes to a level hover', a.y > 15 && Math.hypot(b.vx, b.vz) > 5 && c.upY > 0.99 && Math.abs(c.vy) < 1 && Math.hypot(c.vx, c.vz) < 1.5, `climb y=${a.y.toFixed(1)} fwd speed=${Math.hypot(b.vx, b.vz).toFixed(1)} hover vy=${c.vy.toFixed(2)} up=${c.upY.toFixed(3)} drift=${Math.hypot(c.vx, c.vz).toFixed(2)}`);
  await step(14, { descend: true });
  const d = await state();
  check('flight: soft landing with C', d.contacts >= 3 && !d.flight && d.upY > 0.95, `contacts=${d.contacts} flight=${d.flight}`);
  await page.evaluate(() => { window.__sim.vehicle.sandbox = window.__sim.settings.sandbox; });
}

// --- weapons + destruction ---
if (want('weapons')) {
  await tp(8); await step(1.5);
  // drive into a launcher pickup at (610, -575)
  await page.evaluate(() => { const v = window.__sim.vehicle; v.pos.set(610, 0.5, -575); });
  await step(1.5, {});
  const eq = await page.evaluate(() => window.__sim.weapons.equipped);
  check('launcher pickup equips the rocket pod', eq, `equipped=${eq}`);
  const before = await page.evaluate(() => window.__sim.destruction.blocks.filter(b => b.state === 'static').length);
  const targets = [[560, 2, -697], [560, 4, -700], [640, 3, -768], [560, 6, -800], [600, 1, -640], [588, 0.5, -692], [620, 1, -690]];
  for (const t of targets) {
    await page.evaluate(() => { window.__sim.weapons.cooldown = 0; window.__sim.weapons.reload = 0; window.__sim.weapons.ammo = 4; });
    const fired = await page.evaluate((t) => window.__sim.fireAt(...t), t);
    if (!fired) console.log('  (could not fire at', t, ')');
    await step(1.2, {});
  }
  await page.evaluate(() => window.__sim.setCam(1));
  await page.evaluate(() => { window.__sim.camOverride = { pos: [600, 25, -625], look: [600, 2, -720], fov: 55 }; });
  await shot('destruction-1');
  const after = await page.evaluate(() => ({ stat: window.__sim.destruction.blocks.filter(b => b.state === 'static').length, live: window.__sim.destruction.liveCount(), barrels: window.__sim.destruction.barrels.filter(b => b.state !== 'static').length, cars: window.__sim.destruction.targets.filter(t => t.state !== 'static').length }));
  check('rockets destroy blocks, collapse structures, chain barrels', before - after.stat > 60 && after.barrels >= 2, `blocks knocked out=${before - after.stat}, live bodies=${JSON.stringify(after.live)}, barrels gone=${after.barrels}, cars thrown=${after.cars}`);
  await step(15, {});   // with the game loop paused this is the only settling time (classic and 2.0 both < 10 awake by now)
  const settled = await page.evaluate(() => window.__sim.destruction.liveCount());
  const bad = await page.evaluate(() => window.__sim.destruction.bodies.filter(b => !Number.isFinite(b.pos.x + b.pos.y + b.pos.z)).length);
  await shot('destruction-settled');
  await page.evaluate(() => { window.__sim.camOverride = null; });
  check('debris settles and stays finite', bad === 0 && settled.awake < 60, `awake=${settled.awake} asleep=${settled.asleep} NaN=${bad}`);
  // timing of a big blast
  const ms = await page.evaluate(() => { const t0 = performance.now(); window.__sim.fireAt(725, 2, -710); window.__sim.step(240, {}); return performance.now() - t0; });
  check('physics cost during destruction (1 s of sim)', ms < 900, `${ms.toFixed(0)} ms for 240 physics steps`);
  // rebuild
  await page.evaluate(() => window.__sim.destruction.rebuild());
  const reb = await page.evaluate(() => window.__sim.destruction.blocks.filter(b => b.state !== 'static').length + window.__sim.destruction.targets.filter(t => t.state !== 'static').length);
  check('rebuild restores everything', reb === 0, `non-static after rebuild=${reb}`);
}

// --- random input fuzz ---
if (want('fuzz')) {
  let nan = 0;
  const keys = ['throttle', 'brake', 'steer', 'boost', 'lift', 'descend', 'roll', 'handbrake'];
  for (let k = 1; k <= 9; k++) {
    await tp(k);
    for (let i = 0; i < 25; i++) {
      const c = {};
      for (const key of keys) if (Math.random() < 0.35) c[key] = key === 'steer' || key === 'roll' ? (Math.random() < 0.5 ? -1 : 1) : (key === 'throttle' || key === 'brake' ? 1 : true);
      await step(0.25, c);
      const st = await state();
      if (!st.ok) nan++;
    }
  }
  const errs = await page.evaluate(() => window.__sim.G.errors);
  check('random input fuzz across all zones', nan === 0 && errs === 0, `NaN frames=${nan} runtime errors=${errs}`);
}

// real-time rendering for a few seconds to catch render-path errors
await page.evaluate(() => { window.__sim.freeze = false; });
await page.evaluate(() => window.__sim.teleport(1));
await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
await page.keyboard.press('KeyV'); await page.waitForTimeout(400); await page.keyboard.press('KeyV'); await page.waitForTimeout(400);
await page.keyboard.press('KeyM'); await page.waitForTimeout(300); await shot('bigmap'); await page.keyboard.press('KeyM');
await page.keyboard.press('KeyH'); await page.waitForTimeout(300); await shot('help'); await page.keyboard.press('KeyH');
await page.keyboard.press('KeyP'); await page.waitForTimeout(300); await shot('menu'); await page.keyboard.press('KeyP');

const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
console.log('console errors/warnings:', s.errors.length ? '\n' + [...new Set(s.errors)].slice(0, 20).join('\n') : 'none');
await s.close();
