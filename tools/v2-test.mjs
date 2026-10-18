// v2 feature checks inside the desktop app (APP=1) with screenshots of each feature:
// garage + credits, tires, crash damage + HQ repair, shockwaves + glass, slipstream, wind,
// real-gas tank, mod-menu extras and the Classic switch.
//   node tools/package.mjs --linux-only && APP=1 node tools/v2-test.mjs <screenshot dir> [only,these]
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
const only = process.argv[3];
const s = await openSim({ width: 1280, height: 800, quality: 2 });
const page = s.page;
const results = [];
const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info ?? ''}`); };
const want = (n) => !only || only.split(',').includes(n);
const shot = async (name, wait = 450) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
const step = (sec, c) => page.evaluate(([sec, c]) => window.__sim.step(Math.round(sec * 240), c), [sec, c]);
const ev = (fn, arg) => page.evaluate(fn, arg);
const cam = (pos, look, fov = 45) => ev(([pos, look, fov]) => { window.__sim.camOverride = { pos, look, fov }; }, [pos, look, fov]);
const camOff = () => ev(() => { window.__sim.camOverride = null; });
const camNear = (dx, dy, dz, fov = 42) => ev(([dx, dy, dz, fov]) => { const p = window.__sim.vehicle.pos; window.__sim.camOverride = { pos: [p.x + dx, p.y + dy, p.z + dz], look: [p.x, p.y + 0.2, p.z], fov }; }, [dx, dy, dz, fov]);
// put the car somewhere with a heading and speed (m/s along the heading)
const place = (x, z, yaw, speed = 0) => ev(([x, z, yaw, speed]) => { const S = window.__sim, v = S.vehicle; const T = S.THREE; v.reset(new T.Vector3(x, 0.6, z), yaw); v.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed); }, [x, z, yaw, speed]);
const cr = () => ev(() => window.__sim.profile.credits);
// freeze the action so a screenshot shows exactly this moment (particles stay put too)
const freeze = () => ev(() => { window.__sim.G.timeScale = 0; });
const unfreeze = () => ev(() => { window.__sim.G.timeScale = 1; });
const hudShot = (name, clip) => page.screenshot({ path: `${out}/${name}.png`, clip });

await waitReady(page);
await shot('01-start-screen', 1200);

// ---------- garage ----------
if (want('garage')) {
  await ev(() => window.__sim.profile.earn(20000));
  await ev(() => window.__sim.openGarage());
  await shot('02-garage-upgrades', 1500);
  const before = await ev(() => ({ z60: document.getElementById('gs-z60').textContent, top: document.getElementById('gs-top').textContent, cr: window.__sim.profile.credits }));
  await page.click('#gb-motor');
  await page.click('#gb-motor');
  await page.waitForTimeout(400);
  const after = await ev(() => ({ z60: document.getElementById('gs-z60').textContent, top: document.getElementById('gs-top').textContent, cr: window.__sim.profile.credits, tune: window.__sim.vehicle.tune.motor }));
  check('buying Motor L1+L2 costs credits and changes the live stats', after.cr === before.cr - 4000 && after.tune === 1.16 && after.top !== before.top, `credits ${before.cr} -> ${after.cr}, top ${before.top} -> ${after.top}, 0-60 ${before.z60} -> ${after.z60}`);
  await page.hover('#gb-fan'); await shot('03-garage-preview-next-level', 300);
  await page.click('#gt-style'); await shot('04-garage-style', 600);
  await page.click('.gsec:nth-child(3) button[data-id=gt]'); await page.waitForTimeout(200);
  await page.click('#gpb-wing'); await page.waitForTimeout(200);
  await page.click('.gsec:nth-child(2) button[data-id=turbine]'); await page.click('#gpb-wheels');
  await page.click('.gsec:nth-child(1) button[data-id=gold]'); await page.click('#gpb-paint');
  await page.click('.gsec:nth-child(4) button[data-id=cyan]'); await page.click('#gpb-glow');
  await ev(() => window.__sim.showroom.wheel(-1));
  await shot('05-garage-gold-gt-wing-turbine', 900);
  const look = await ev(() => ({ ...window.__sim.profile.look(), cr: window.__sim.profile.credits }));
  check('cosmetics can be bought and are fitted', look.wing === 'gt' && look.wheels === 'turbine' && look.paint === 'gold' && look.glow === 'cyan', JSON.stringify(look));
  await page.click('#gt-builds');
  await page.click('#gbuild-0 [data-a=save]');
  await shot('06-garage-builds', 500);
  // change looks, then load the build back
  await page.click('#gt-style'); await page.click('.gsec:nth-child(1) button[data-id=red]'); await page.click('.gsec:nth-child(3) button[data-id=duck]');
  await page.click('#gt-builds'); await page.click('#gbuild-0 [data-a=load]');
  const loaded = await ev(() => window.__sim.profile.look());
  check('a saved build loads back', loaded.paint === 'gold' && loaded.wing === 'gt', JSON.stringify(loaded));
  for (const [i, ang] of [[7, 2.2], [8, 3.6]]) { await ev((a) => { window.__sim.showroom.angle = a; window.__sim.showroom.spin = 0; }, ang); await shot(`0${i}-garage-turntable-${i - 6}`, 600); }
  await page.click('#gt-style'); await page.click('.gsec:nth-child(3) button[data-id=fin]'); await page.waitForTimeout(200);
  await shot('09-garage-try-rocket-fin', 500);
  // skins + cases
  await ev(() => window.__sim.profile.earn(12000));
  await page.click('#gt-skins'); await shot('09b-skins-cases', 600);
  const cr0 = await ev(() => window.__sim.profile.credits);
  await page.click('#gopen-street'); await shot('09c-case-reel-spinning', 1500);
  await page.waitForFunction(() => !document.getElementById('gwin').hidden, null, { timeout: 15000 }).catch(() => {});
  await shot('09d-case-win', 500);
  const won = await ev(() => ({ n: window.__sim.profile.d.skins.length, cr: window.__sim.profile.credits }));
  check('opening a Street case costs 1500 and gives a skin', won.n === 1 && won.cr <= cr0 - 1500 + 5000, JSON.stringify(won));
  await page.click('#gopen-elite'); await page.waitForFunction(() => !document.getElementById('gwin').hidden && window.__sim.profile.d.opened === 2, null, { timeout: 15000 }).catch(() => {});
  await page.click('.gskin[data-id^="' + await ev(() => window.__sim.profile.d.skins[0]) + '"]');
  await shot('09e-skin-equipped', 900);
  check('a won skin can be equipped', await ev(() => window.__sim.profile.skin()?.id === window.__sim.profile.d.skins[0]));
  // picking a paint takes the skin off (try-on preview + buy keep working with a skin fitted)
  await page.click('#gt-style'); await page.click('.gsec:nth-child(1) button[data-id=red]'); await page.waitForTimeout(200);
  const painted = await ev(() => ({ skin: window.__sim.profile.skin(), fitted: window.__sim.model.skin, col: window.__sim.model.mats.paint.color.getHexString() }));
  check('picking a paint replaces the skin', !painted.skin && !painted.fitted && painted.col !== 'ffffff', JSON.stringify(painted));
  await page.click('#gt-skins');
  await page.click('#g-done');
  check('garage closes back to the start screen', await ev(() => !document.getElementById('start').hidden && document.getElementById('garage').hidden));
}

await ev(() => window.__sim.startGame());
await page.waitForTimeout(500);

// ---------- credits for driving ----------
if (want('credits')) {
  let c0 = await cr();
  await ev(() => window.__sim.teleport(2)); await step(1.5);
  await step(7, { throttle: 1, boost: true });
  await shot('10-drag-strip-credits', 200);
  let c1 = await cr();
  check('0-60 and 1/4 mile pay credits', c1 - c0 >= 125, `+${c1 - c0} CR`);
  await step(6, { brake: 1 });
  c0 = await cr();
  await ev(() => window.__sim.teleport(6)); await step(1);
  for (let i = 0; i < 70; i++) { const sp = await ev(() => window.__sim.vehicle.vel.length()); await step(0.1, { throttle: sp < 34 ? 1 : 0.2 }); if (await ev(() => window.__sim.vehicle.pos.x < -700)) break; }
  c1 = await cr();
  check('a jump pays credits', c1 - c0 > 50, `+${c1 - c0} CR`);
  c0 = await cr();
  await ev(() => window.__sim.teleport(4)); await step(1);
  for (let i = 0; i < 200; i++) { const st = await ev(() => ({ sp: window.__sim.vehicle.vel.length(), z: window.__sim.vehicle.pos.z })); await step(0.1, { throttle: st.sp < 30 ? 1 : 0.3 }); if (st.z > 330) break; }
  await step(1.5);
  c1 = await cr();
  check('Loop of Death pays 300 credits', c1 - c0 >= 300, `+${c1 - c0} CR`);
  await shot('11-loop-credit-toast', 200);
}

// ---------- tires ----------
if (want('tires')) {
  // drift circles on the HQ apron with stability control and the fan off
  await ev(() => window.__sim.teleport(1)); await step(1);
  await place(30, -40, 0.3, 0);
  await ev(() => { const v = window.__sim.vehicle; v.esc = false; v.fan.mode = 'off'; });
  await step(2, { throttle: 1 });
  await step(5, { throttle: 1, steer: 1, handbrake: true });
  const t = await ev(() => window.__sim.vehicle.wheels.map(w => Math.round(w.temp)));
  // keep drifting in real time (keyboard) so the game draws smoke and skid marks
  for (const k of ['KeyW', 'KeyA', 'KeyX']) await page.keyboard.down(k);
  await page.waitForTimeout(9000);
  await freeze();
  for (const k of ['KeyW', 'KeyA', 'KeyX']) await page.keyboard.up(k);
  await camNear(7, 3, 7, 55);
  await shot('12-drift-hot-tires-smoke', 900);
  await camOff();
  await shot('13a-drift-chase-view', 700);
  await hudShot('13b-hud-tire-temperatures', { x: 0, y: 560, width: 300, height: 240 });
  await unfreeze();
  check('hard drifting heats the tires', Math.max(...t) > 70, `tire temps ${t.join(', ')} °C`);
  await step(2, {});
  await ev(() => { const v = window.__sim.vehicle; v.esc = true; v.fan.mode = 'auto'; });
}

// ---------- crash damage + HQ repair ----------
if (want('crash')) {
  await ev(() => window.__sim.teleport(1)); await step(1);
  await place(-52, 8, 0, 30);           // head-on into the hangar at ~67 mph
  await step(1.2, {});
  await place(-30, 14, 0.9, 0); await step(1.2, {});
  const d1 = await ev(() => { const v = window.__sim.vehicle; return { z: v.damage.zones, c: v.damage.condition(v), parts: v.damage.parts }; });
  check('head-on crash crumples the front', d1.z.front > 0.5 && d1.c < 0.8, `front ${d1.z.front.toFixed(2)}, condition ${(d1.c * 100).toFixed(0)}%, splitter ${d1.parts.splitter ? 'on' : 'off'}`);
  await camNear(3.2, 1.3, 5.2, 40); await shot('14-crash-front-crumpled', 700);
  await camNear(-4, 1.6, -1, 45); await shot('15-crash-side-view', 500);
  await camOff();
  // side swipe into the wall hard enough to tear a wheel off
  await place(-40, 31, Math.PI / 2, 0);
  await ev(() => { const v = window.__sim.vehicle; v.vel.set(0, 0, 38); });
  await step(1.5, {});
  const w = await ev(() => window.__sim.vehicle.wheels.map(w => w.broken));
  check('a big side impact breaks a wheel off', w.some(Boolean), `broken wheels: ${w.map((b, i) => b ? ['FL', 'FR', 'RL', 'RR'][i] : '').filter(Boolean).join(', ')}`);
  await ev(() => { const L = window.__sim.looseWheels.list[0]; if (L) window.__sim.camOverride = { pos: [L.pos.x + 4, L.pos.y + 2, L.pos.z - 5], look: [L.pos.x, L.pos.y, L.pos.z], fov: 45 }; });
  await step(0.4, {});
  await shot('16-wheel-broke-off', 500);
  await camNear(4, 1.5, -4.5, 45); await shot('17-car-on-three-wheels', 400);
  await camOff();
  await hudShot('18-hud-damage-diagram', { x: 0, y: 560, width: 300, height: 240 });
  // drive home: teleport to HQ, sit on the pad
  await ev(() => window.__sim.teleport(1));
  await step(1.5, {}); await shot('19-repairing-on-hq-pad', 300);
  await step(2.5, {});
  const r = await ev(() => { const v = window.__sim.vehicle; return { c: v.damage.condition(v), broken: v.wheels.some(w => w.broken), hits: v.damage.hits, vis: window.__sim.model.wheels.every(o => o.pivot.visible) }; });
  check('parking on the HQ pad repairs everything', r.c === 1 && !r.broken && r.hits === 0 && r.vis, JSON.stringify(r));
  await camNear(4, 1.4, 5, 40); await shot('20-repaired-like-new', 600); await camOff();
  // normal stunts do no damage (run in one go so nothing else moves the car in between)
  const demo = await ev(() => {
    const S = window.__sim, v = S.vehicle, run = (n, c) => { for (let i = 0; i < n; i++) S.step(1, c); };
    S.teleport(3); run(240, {});
    for (let k = 0; k < 140 * 24; k++) { S.step(1, { throttle: 1 }); if (v.up.y < -0.6) break; }
    run(192, {}); run(288, { lift: true }); run(1440, { descend: true });
    return { hits: v.damage.hits, up: v.up.y, contacts: v.contacts };
  });
  check('demo ramp stunt (flip, hover, land) causes no damage', demo.hits === 0 && demo.up > 0.95 && demo.contacts >= 2, JSON.stringify(demo));
}

// ---------- shockwaves + glass ----------
if (want('shock')) {
  await ev(() => { window.__sim.destruction.rebuild(); window.__sim.teleport(8); });
  await step(1.5, {});
  const panes0 = await ev(() => window.__sim.destruction.glass.panes.filter(p => p.alive).length);
  await cam([548, 9, -672], [560, 3, -700], 55);
  await shot('21-windows-before', 600);
  await ev(() => window.__sim.fireAt(566, 2, -697));
  await page.waitForTimeout(80);
  await ev(() => window.__sim.step(Math.round(240 * 1.1), {}));
  await ev(() => window.__sim.step(Math.round(240 * 0.12), {}));
  await shot('22-rocket-shockwave', 60);
  await ev(() => window.__sim.step(240 * 1.2, {}));
  await shot('23-windows-shattered', 300);
  const panes1 = await ev(() => window.__sim.destruction.glass.panes.filter(p => p.alive).length);
  const shards = await ev(() => window.__sim.destruction.glass.shards.length);
  check('a rocket blast shatters nearby windows', panes1 < panes0 && shards > 10, `panes ${panes0} -> ${panes1}, ${shards} shards`);
  // a big blast far away: the shockwave arrives later, at the speed of sound
  const timing = await ev(() => {
    const S = window.__sim, T = S.THREE, v = S.vehicle;
    v.reset(new T.Vector3(640, 0.6, -545), Math.PI); S.step(240);
    const p0 = v.pos.clone(), at = new T.Vector3(640, 1, -595);
    S.destruction.explode(at, 9, 1, 'rocket');
    let moved = -1;
    for (let i = 1; i <= 240; i++) { S.step(1); if (moved < 0 && v.vel.length() > 0.2) moved = i / 240; }
    return { dist: p0.distanceTo(at), moved };
  });
  check('shockwave reaches the car at about the speed of sound', timing.moved > 0 && Math.abs(timing.moved - timing.dist / 343) < 0.06, `${timing.dist.toFixed(0)} m away, jolt after ${timing.moved.toFixed(3)} s (sound would take ${(timing.dist / 343).toFixed(3)} s)`);
  // the pressure ring in slow motion: a barrel-sized blast in the open, seen from above
  await ev(() => { const S = window.__sim; S.destruction.rebuild(); S.vehicle.reset(new S.THREE.Vector3(640, 0.6, -545), Math.PI); S.step(120); });
  await cam([600, 45, -560], [600, 0, -610], 60);
  await page.waitForTimeout(800);
  await ev(() => { const S = window.__sim, T = S.THREE; S.G.timeScale = 0.03; S.destruction.explode(new T.Vector3(600, 1, -610), 9, 1, 'rocket'); });
  await page.waitForFunction(() => window.__sim.effects.rings.some(r => r.shock && r.shock.age > 0.012), null, { timeout: 60000 });
  await freeze(); await shot('23a-shockwave-ring-slow-motion', 600);
  await ev(() => { window.__sim.G.timeScale = 0.03; });
  await page.waitForFunction(() => window.__sim.effects.rings.some(r => r.shock && r.shock.age > 0.05), null, { timeout: 60000 });
  await freeze(); await shot('23b-shockwave-spreading', 600); await unfreeze();
  await ev(() => window.__sim.step(240 * 2, {}));
  await camOff();
  await ev(() => window.__sim.destruction.rebuild());
}

// ---------- railgun ----------
if (want('rail')) {
  await ev(() => { const S = window.__sim; S.destruction.rebuild(); S.teleport(8); });
  await step(1.5, {});
  await ev(() => { const S = window.__sim; S.weapons.equip(); });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__sim.weapons.mode === 'rail', null, { timeout: 30000 }).catch(() => {});
  const mode = await ev(() => window.__sim.weapons.mode);
  const before = await ev(() => window.__sim.destruction.blocks.filter(b => b.state === 'static').length);
  await cam([600, 14, -610], [560, 2, -705], 55);
  const fired = await ev(() => window.__sim.fireAt(560, 2.5, -705));
  await page.waitForTimeout(150);
  await freeze(); await shot('31-railgun-beam', 500); await unfreeze();
  await ev(() => window.__sim.step(240 * 2, {}));
  const again = await ev(() => window.__sim.fireAt(640, 3, -770));
  await ev(() => window.__sim.step(240 * 2, {}));
  await shot('32-railgun-through-building', 600);
  const after = await ev(() => window.__sim.destruction.blocks.filter(b => b.state === 'static').length);
  check('Tab switches to the railgun and the beam pierces walls', mode === 'rail' && fired && before - after > 4, `mode ${mode}, blocks broken ${before - after}`);
  check('railgun can\'t fire again while recharging', await ev(() => { const w = window.__sim.weapons; w.railCharge = 1; return !window.__sim.fireAt(640, 3, -770); }), '');
  await ev(() => { window.__sim.weapons.railCharge = 0; });
  await ev(() => { window.__sim.step(240 * 2, {}); });
  check('railgun recharged and fires again', await ev(() => window.__sim.fireAt(640, 3, -770)), '');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__sim.weapons.mode === 'minigun', null, { timeout: 30000 }).catch(() => {});
  await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(() => window.__sim.weapons.mode === 'rail', null, { timeout: 30000 }).catch(() => {});
  await page.keyboard.press('Shift+Tab');
  check('Tab to the next gun, Shift+Tab back to rockets', await page.waitForFunction(() => window.__sim.weapons.mode === 'rocket', null, { timeout: 30000 }).then(() => true).catch(() => false));
  await camOff();
  await ev(() => window.__sim.destruction.rebuild());
}

// ---------- 14 new guns ----------
if (want('guns')) {
  const ids = await ev(() => window.__sim.weaponList.map(w => w.id).filter(id => id !== 'rocket' && id !== 'rail'));
  let ok = 0; const bad = [];
  for (const [i, id] of ids.entries()) {
    await ev(() => { window.__sim.destruction.rebuild(); window.__sim.teleport(1); });
    await ev((id) => { const w = window.__sim.weapons; w.equip(); w.mode = id; w.armCds = {}; }, id);
    await cam([600, 16, -600], [560, 2, -705], 60);
    const fired = await ev(() => { let n = 0; for (let k = 0; k < 6; k++) { window.__sim.weapons.armCds = {}; if (window.__sim.fireAt(560, 2.5, -705)) n++; window.__sim.step(12, {}); } return n; });
    await ev(() => window.__sim.step(240 * 1.2, {}));
    await shot(`40-gun-${String(i + 1).padStart(2, '0')}-${id}`, 250);
    if (fired > 0) ok++; else bad.push(id);
  }
  check(`all ${ids.length} new guns fire`, ids.length === 14 && ok === ids.length, bad.join(','));
  // each gun has its own cooldown: a meteor shower doesn't lock out the minigun
  const swap = await ev(() => { const S = window.__sim, w = S.weapons; w.armCds = {}; w.mode = 'meteor'; const a = S.fireAt(560, 2.5, -705); w.mode = 'minigun'; const b = S.fireAt(560, 2.5, -705); w.mode = 'meteor'; const c = S.fireAt(560, 2.5, -705); return [a, b, c]; });
  check('switching from a slow gun fires straight away (own cooldowns)', swap[0] && swap[1] && !swap[2], JSON.stringify(swap));
  // a mine dropped by a parked car doesn't blow the car up
  await ev(() => { const S = window.__sim; S.destruction.rebuild(); S.teleport(1); S.weapons.armCds = {}; S.weapons.mode = 'mines'; S.fireAt(560, 2.5, -705); });
  const mine = await ev(() => { const S = window.__sim, p0 = S.vehicle.pos.clone(); S.step(240 * 3, {}); return { moved: S.vehicle.pos.distanceTo(p0), left: S.weapons.arsenal.mines.length, hits: S.vehicle.damage ? S.vehicle.damage.hits : 0 }; });
  check('a mine dropped while parked stays put and leaves the car alone', mine.left === 1 && mine.moved < 0.5, JSON.stringify(mine));
  await ev(() => window.__sim.weapons.arsenal.clear());
  await camOff(); await ev(() => { window.__sim.weapons.mode = 'rocket'; window.__sim.destruction.rebuild(); });
}

// ---------- slipstream (pace car) ----------
if (want('draft')) {
  await ev(() => window.__sim.teleport(2)); await step(1);
  await step(3, { throttle: 1 });
  await ev(() => window.__sim.paceCar.spawn(window.__sim.vehicle, 150));
  let best = 0, shotTaken = false;
  for (let i = 0; i < 30; i++) {
    const st = await ev(() => { const S = window.__sim, v = S.vehicle, p = S.paceCar; const gap = p.pos.clone().sub(v.pos).dot(p.dir); return { gap, draft: v.draft, sp: v.vel.length() }; });
    best = Math.max(best, st.draft);
    if (!shotTaken && st.draft > 0.25) {
      shotTaken = true;
      await freeze();
      await ev(() => { const S = window.__sim; S.rig.mode = 1; S.rig.snap(); });
      await shot('24-slipstream-behind-pace-car', 900);
      await ev(() => { const S = window.__sim; S.rig.mode = 0; S.rig.snap(); });
      await shot('24b-slipstream-chase-cam', 900);
      await unfreeze();
    }
    await step(0.2, { throttle: st.gap < 9 ? 0 : 1 });
  }
  check('driving behind the pace car cuts drag (slipstream)', best > 0.15, `best drag reduction ${(best * 100).toFixed(0)}%`);
  await ev(() => window.__sim.paceCar.despawn());
  await step(5, { brake: 1 });
}

// ---------- air tank + wind ----------
if (want('gas')) {
  await ev(() => window.__sim.teleport(7)); await step(1);
  await step(2.5, { lift: true }); await step(3, {});
  const g = await ev(() => { const v = window.__sim.vehicle; return { T: v.tankT - 273.15, psi: v.tankPsi, air: v.air, wind: Math.hypot(v.wind.x, v.wind.z) }; });
  await ev(() => { const S = window.__sim; S.rig.mode = 1; S.rig.snap(); });
  await freeze();
  await shot('25-hover-cold-tank-wind', 700);
  await hudShot('25b-hud-cold-air-tank', { x: 0, y: 560, width: 300, height: 240 });
  await unfreeze();
  check('hovering empties the tank and the gas gets cold', g.T < 0 && g.psi < 2500, `tank ${g.T.toFixed(0)} °C, ${g.psi.toFixed(0)} psi, ${g.air.toFixed(0)} kg left, wind ${g.wind.toFixed(1)} m/s`);
  await step(10, { descend: true });
  await ev(() => { const S = window.__sim; S.rig.mode = 0; S.rig.snap(); });
}

// ---------- mod menu extras ----------
if (want('mods')) {
  await ev(() => { window.__sim.teleport(1); window.__sim.hacks.boot(); });
  await page.waitForFunction(() => window.__sim.hacks.unlocked && !document.getElementById('hk-menu').hidden, null, { timeout: 20000 });
  await page.click('#hk-tab-Garage');
  await shot('26-mod-menu-garage-tab', 400);
  await page.click('#hkc-unlimitedCredits'); await page.click('#hkc-unlockAll');
  const ch = await ev(() => ({ cr: document.getElementById('h-cr').textContent, owned: window.__sim.profile.owned('fan') }));
  check('unlimited credits + unlock all', ch.cr.startsWith('∞') && ch.owned === 3, JSON.stringify(ch));
  await page.click('#hkc-unlockSkins'); await page.click('#hkc-devSkins');
  check('mod menu unlocks all 87 skins incl. 50 Dev skins', await ev(() => window.__sim.skinIds.filter(id => window.__sim.profile.hasSkin(id)).length) === 87);
  await page.click('#hk-tab-Weapons'); await shot('27b-mod-menu-weapons-tab', 400);
  await ev(() => window.__sim.teleport(1));
  await page.click('#hkc-doMeteor'); await ev(() => window.__sim.step(240 * 3, {}));
  await page.click('#hkc-doArmageddon'); await ev(() => window.__sim.step(240 * 2, {}));
  await shot('27c-armageddon', 600);
  await page.click('#hk-tab-Garage'); await page.click('#hkc-unlockSkins'); await page.click('#hkc-devSkins');
  await page.click('#hk-tab-Car');
  await shot('27-mod-menu-car-tab', 300);
  await page.click('#hkc-noDamage');
  await ev(() => window.__sim.vehicle.repairAll());
  await place(-52, 8, 0, 32); await step(1.2, {});
  const nd = await ev(() => window.__sim.vehicle.damage.hits);
  check('damage off: crashing does nothing', nd === 0, `hits ${nd}`);
  await page.click('#hkc-noDamage');
  await page.click('#hkc-noTireHeat');
  await ev(() => window.__sim.teleport(2)); await step(1);
  await ev(() => { window.__sim.vehicle.esc = false; window.__sim.vehicle.fan.mode = 'off'; });
  await step(4, { throttle: 1, steer: 1, handbrake: true });
  const th = await ev(() => Math.max(...window.__sim.vehicle.wheels.map(w => w.temp)));
  check('tire heat off keeps tires cool', th < 30, `${th.toFixed(1)} °C`);
  await page.click('#hkc-noTireHeat');
  await ev(() => { window.__sim.vehicle.esc = true; window.__sim.vehicle.fan.mode = 'auto'; });
  await page.click('#hk-tab-Visual');
  await page.click('#hkc-crashCam');
  await shot('28-mod-menu-visual-tab', 300);
  await page.keyboard.press('Minus');
  await ev(() => window.__sim.teleport(1)); await step(1);
  await place(-52, 6, 0, 34);
  await ev(() => window.__sim.step(Math.round(240 * 0.9), {}));
  await page.waitForTimeout(500);
  const cc = await ev(() => ({ on: !!window.__sim.G.crashCam, ts: window.__sim.G.timeScale }));
  await shot('29-slow-motion-crash-cam', 300);
  check('slow-motion crash cam kicks in on a big crash', cc.on && cc.ts <= 0.2, JSON.stringify(cc));
  // 3 s of real time; the cloud test machine renders at ~1-2 fps, so allow plenty
  await page.waitForFunction(() => !window.__sim.G.crashCam, null, { timeout: 120000 });
  await ev(() => { window.__sim.G.timeScale = 0; });   // freeze the wreck so nothing new happens
  const before = await ev(() => window.__sim.vehicle.damage.hits);
  await page.keyboard.press('KeyZ');
  const rz = await page.waitForFunction(() => window.__sim.vehicle.damage.hits === 0, null, { timeout: 30000 }).then(() => 0).catch(() => -1);
  await ev(() => { window.__sim.G.timeScale = 1; });
  check('Z instant repair', before > 0 && rz === 0, `hits ${before} -> ${rz === 0 ? 0 : 'not repaired'}`);
  await page.keyboard.press('Minus'); await page.click('#hk-tab-Garage');
  await page.click('#hkc-unlimitedCredits'); await page.click('#hkc-unlockAll');
  const back = await ev(() => ({ owned: window.__sim.profile.owned('fan'), cr: window.__sim.profile.credits }));
  check('turning the cheats off restores the real save', back.owned === 0, JSON.stringify(back));
  await page.keyboard.press('Minus');
}

// ---------- classic switch ----------
if (want('classic')) {
  await ev(() => window.__sim.setPhysics('classic'));
  await ev(() => window.__sim.teleport(1)); await step(1);
  await place(-52, 8, 0, 32); await step(1.2, {});
  const c = await ev(() => ({ hits: window.__sim.vehicle.damage.hits, phys2: window.__sim.vehicle.phys2 }));
  check('Classic physics: no damage, like version 1', !c.phys2 && c.hits === 0, JSON.stringify(c));
  await ev(() => window.__sim.setPhysics('2'));
  await page.keyboard.press('KeyP'); await shot('30-pause-menu-physics-switch', 400); await page.keyboard.press('KeyP');
}

const errs = await ev(() => window.__sim.G.errors);
check('no runtime errors', errs === 0 && s.errors.length === 0, s.errors.slice(0, 5).join(' | '));
console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`);
await s.close();
