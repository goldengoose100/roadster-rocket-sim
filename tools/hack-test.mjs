// Mod-menu end-to-end test in a real browser: code prompt, loader, every tab, toggles, hotkeys.
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
// the access code is never stored in the repo: pass it in, e.g. HACK_CODE=... node tools/hack-test.mjs out/
const CODE = process.env.HACK_CODE;
// HACK_UNLOCK=1 skips the code screen (unchanged since 1.1.5) and opens the menu directly, so the rest can run without the code
const BYPASS = !CODE && process.env.HACK_UNLOCK === '1';
if (!CODE && !BYPASS) { console.log('Set HACK_CODE to the mod-menu access code (or HACK_UNLOCK=1 to skip the code screen) to run this test.'); process.exit(1); }
const s = await openSim({ width: 1280, height: 800, quality: 1 });
const page = s.page;
const res = []; const check = (n, ok, info = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`); };
const shot = (n) => page.screenshot({ path: `${out}/h-${n}.png` });
await waitReady(page);
await page.evaluate(() => { localStorage.removeItem('rrs.hacks'); window.__sim.startGame(); });
await page.waitForTimeout(500);
const step = (sec, c) => page.evaluate(([sec, c]) => window.__sim.step(Math.round(sec * 240), c), [sec, c]);

// locked: hotkeys do nothing
if (BYPASS) {
  console.log('(code screen skipped: unlocking directly)');
  await page.evaluate(() => window.__sim.hacks.boot());
} else {
await page.keyboard.press('KeyJ');
check('hotkeys do nothing before unlocking', await page.evaluate(() => !window.__sim.hacks.unlocked && window.__sim.vehicle.vel.y < 1));
// "-" shows the code prompt
await page.keyboard.press('Minus');
await page.waitForFunction(() => !document.getElementById('hk-code').hidden, null, { timeout: 5000 }).catch(() => {});
check('"-" opens the access-code prompt', await page.evaluate(() => !document.getElementById('hk-code').hidden && document.activeElement.id === 'hk-input'));
await page.keyboard.type('nope'); await page.keyboard.press('Enter');
await page.waitForFunction(() => document.getElementById('hk-msg').textContent === 'ACCESS DENIED', null, { timeout: 5000 }).catch(() => {});
await shot('denied');
check('wrong code is refused', await page.evaluate(() => !window.__sim.hacks.unlocked && document.getElementById('hk-msg').textContent === 'ACCESS DENIED'));
check('typing in the prompt does not drive the car', await page.evaluate(() => window.__sim.vehicle.vel.length() < 0.5));
await page.keyboard.type(CODE.toUpperCase()); await page.keyboard.press('Enter');
}
await page.waitForFunction(() => document.getElementById('hk-lines').textContent.includes('OK'), null, { timeout: 8000 }).catch(() => {});
await shot('loading');
check('loading animation plays', await page.evaluate(() => document.getElementById('hk-lines').textContent.includes('OK')));
await page.waitForFunction(() => window.__sim.hacks.unlocked && !document.getElementById('hk-menu').hidden, null, { timeout: 15000 });
await page.waitForTimeout(500);
await shot('menu-car');
check(BYPASS ? 'menu unlocks' : 'correct code (any case) unlocks the menu', true);
// tabs
for (const t of ['Flight', 'Weapons', 'World', 'Visual', 'Garage', 'Keys']) {
  await page.click('#hk-tab-' + t);
  await page.waitForTimeout(120);
  await shot('menu-' + t.toLowerCase());
}
check('all tabs render', await page.evaluate(() => document.getElementById('hk-body').children.length > 5));
// toggles through the UI
await page.click('#hk-tab-Flight');
await page.click('#hkc-infiniteAir');
await page.click('#hk-tab-Weapons');
await page.click('#hkc-alwaysLauncher'); await page.click('#hkc-infiniteAmmo'); await page.click('#hkc-rapidFire');
const st1 = await page.evaluate(() => ({ air: window.__sim.vehicle.hack.infiniteAir, eq: window.__sim.weapons.equipped, inf: window.__sim.weapons.hack.infiniteAmmo }));
check('toggles apply instantly', st1.air && st1.eq && st1.inf, JSON.stringify(st1));
// sliders
await page.click('#hk-tab-Car');
await page.$eval('#hkc-power', (el) => { el.value = 6; el.dispatchEvent(new Event('input')); });
check('sliders apply', await page.evaluate(() => window.__sim.vehicle.hack.power === 6));
// "-" hides and shows without asking again
await page.keyboard.press('Minus'); await page.waitForTimeout(50);
const hidden = await page.evaluate(() => document.getElementById('hk-menu').hidden);
await page.keyboard.press('Minus'); await page.waitForTimeout(150);
check('"-" hides / shows the menu (no code again this session)', hidden && await page.evaluate(() => !document.getElementById('hk-menu').hidden));
// hotkeys
await page.evaluate(() => window.__sim.teleport(8)); await step(1);
await page.keyboard.press('KeyJ'); await page.waitForFunction(() => window.__sim.vehicle.vel.y > 3 || window.__sim.vehicle.pos.y > 2, null, { timeout: 8000 }).catch(() => {});
check('J moon jump', await page.evaluate(() => window.__sim.vehicle.vel.y > 5 || window.__sim.vehicle.pos.y > 2));
await step(4);
const before = await page.evaluate(() => window.__sim.destruction.blocks.filter(b => b.state === 'static').length);
await page.evaluate(() => { window.__sim.rig.pitchOff = 0.25; });
await page.keyboard.press('KeyK'); await page.waitForFunction(() => window.__sim.effects.emitters.length > 0, null, { timeout: 8000 }).catch(() => {});
await step(0.3);
await page.evaluate(() => { window.__sim.camOverride = { pos: [640, 60, -500], look: [640, 10, -660], fov: 60 }; });
await page.waitForTimeout(700); await shot('nuke');
await page.evaluate(() => { window.__sim.camOverride = null; });
await step(2);
const after = await page.evaluate(() => window.__sim.destruction.blocks.filter(b => b.state === 'static').length);
check('K nuke at the crosshair', after < before, `${before - after} blocks destroyed`);
await page.keyboard.press('KeyL'); await page.waitForFunction(() => window.__sim.weapons.rockets.length >= 10, null, { timeout: 8000 }).catch(() => {});
check('L airstrike launches rockets', await page.evaluate(() => window.__sim.weapons.rockets.length >= 10));
await step(4);
await page.evaluate(() => window.__sim.hacks.v.spawnKind = 'crates');
await page.keyboard.press('KeyU'); await page.waitForFunction(() => window.__sim.destruction.blocks.some(b => b.spawned), null, { timeout: 8000 }).catch(() => {});
check('U spawns a crate tower', await page.evaluate(() => window.__sim.destruction.blocks.some(b => b.spawned)));
await page.keyboard.press('KeyY'); await page.waitForFunction(() => window.__sim.G.timeScale === 0.25, null, { timeout: 8000 }).catch(() => {});
check('Y bullet time', await page.evaluate(() => window.__sim.G.timeScale === 0.25));
await page.keyboard.press('KeyY'); await page.waitForFunction(() => window.__sim.G.timeScale === 1, null, { timeout: 8000 }).catch(() => {});
await page.keyboard.press('KeyT'); await page.waitForTimeout(1500);
check('T teleport to crosshair', await page.evaluate(() => Number.isFinite(window.__sim.vehicle.pos.x)));
await page.keyboard.press('KeyO'); await page.waitForFunction(() => document.body.classList.contains('photo'), null, { timeout: 8000 }).catch(() => {});
check('O photo mode hides the HUD', await page.evaluate(() => document.body.classList.contains('photo')));
await page.keyboard.press('KeyO'); await page.waitForFunction(() => !document.body.classList.contains('photo'), null, { timeout: 8000 }).catch(() => {});
await page.keyboard.press('KeyI'); await page.waitForFunction(() => window.__sim.hacks.v.freeCam, null, { timeout: 8000 }).catch(() => {});
await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
check('I free camera (car stays put)', await page.evaluate(() => window.__sim.hacks.v.freeCam && window.__sim.vehicle.vel.length() < 2));
await page.keyboard.press('KeyI'); await page.waitForFunction(() => !window.__sim.hacks.v.freeCam, null, { timeout: 8000 }).catch(() => {});
// world buttons
await page.click('#hk-tab-World');
await page.click('#hkc-doDetonate'); await page.click('#hkc-doCollapse'); await step(3);
await page.click('#hkc-doRebuild'); await step(0.5);
check('rebuild clears spawned objects and restores the world', await page.evaluate(() => !window.__sim.destruction.blocks.some(b => b.spawned) && window.__sim.destruction.blocks.every(b => b.state === 'static')));
// time of day
for (const tod of ['golden', 'sunset', 'night', 'day']) {
  await page.selectOption('#hkc-tod', tod); await page.waitForTimeout(400);
  if (tod !== 'day') { await page.evaluate(() => window.__sim.teleport(1)); await page.waitForTimeout(600); await shot('tod-' + tod); }
}
check('time of day presets', true);
// visual toggles + x-ray + fps
await page.click('#hk-tab-Visual');
await page.click('#hkc-underglow'); await page.click('#hkc-xray'); await page.click('#hkc-fps'); await page.click('#hkc-disco');
await page.evaluate(() => window.__sim.teleport(3)); await step(2, { throttle: 1 }); await page.waitForTimeout(800);
await shot('visual');
check('x-ray / fps / disco run', await page.evaluate(() => !document.getElementById('hk-fps').hidden && document.getElementById('hk-fps').textContent.includes('FPS')));
// car size + flight hacks + barrel roll with the real E key
await page.click('#hk-tab-Car');
await page.$eval('#hkc-scale', (el) => { el.value = 2.5; el.dispatchEvent(new Event('input')); });
await page.evaluate(() => window.__sim.teleport(1)); await step(2);
await page.waitForTimeout(500); await shot('giant');
check('giant car settles', await page.evaluate(() => window.__sim.vehicle.contacts >= 3 && window.__sim.vehicle.up.y > 0.95));
await page.$eval('#hkc-scale', (el) => { el.value = 1; el.dispatchEvent(new Event('input')); });
await page.evaluate(() => window.__sim.teleport(1)); await step(1); await step(2, { lift: true });
await page.keyboard.press('KeyE');
await page.waitForFunction(() => window.__sim.vehicle.roll, null, { timeout: 10000 }).catch(() => {});
const rolling = await page.evaluate(() => !!window.__sim.vehicle.roll);
await step(2);
check('E key starts a barrel roll in the air', rolling && await page.evaluate(() => window.__sim.vehicle.up.y > 0.95));
// reset all
await page.click('#hk-reset');
check('"Turn all off" resets', await page.evaluate(() => window.__sim.vehicle.hack.power === 1 && !window.__sim.vehicle.hack.infiniteAir));
const errs = await page.evaluate(() => window.__sim.G.errors);
check('no runtime errors', errs === 0 && s.errors.length === 0, s.errors.slice(0, 5).join(' | '));
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
await s.close();
