// Good Luck menu (2.3) checks inside the desktop app, with screenshots:
// 0 opens a code prompt, wrong code refused, the menu unlocks, unlock everything, skin swapper,
// all 12 silly cars (looks only: the physics stay identical), silly mods, all off = normal car again.
// The code is never stored in the repo: LUCK_CODE=... (ask the owner), or LUCK_UNLOCK=1 to skip the prompt.
//   node tools/package.mjs --linux-only && APP=1 xvfb-run -a node tools/luck-test.mjs <screenshot dir>
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
const CODE = process.env.LUCK_CODE;
const BYPASS = !CODE && process.env.LUCK_UNLOCK === '1';
if (!CODE && !BYPASS) { console.log('Set LUCK_CODE to the Good Luck code (or LUCK_UNLOCK=1 to skip the code prompt) to run this test.'); process.exit(1); }
const s = await openSim({ width: 1280, height: 800, quality: 2 });
const page = s.page;
const res = []; const check = (n, ok, info = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`); };
const shot = async (n, wait = 400) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${n}.png` }); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = (sec, c) => ev(([sec, c]) => window.__sim.step(Math.round(sec * 240), c), [sec, c]);
const camNear = (dx, dy, dz, fov = 40) => ev(([dx, dy, dz, fov]) => { const p = window.__sim.vehicle.pos; window.__sim.camOverride = { pos: [p.x + dx, p.y + dy, p.z + dz], look: [p.x, p.y + 0.2, p.z], fov }; }, [dx, dy, dz, fov]);
const camOff = () => ev(() => { window.__sim.camOverride = null; });
const wait = (fn, ms = 60000) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true).catch(() => false);

await waitReady(page);
await ev(() => { localStorage.removeItem('rrs.luck'); window.__sim.startGame(); });
await ev(() => window.__sim.teleport(1));
await step(1.5, {});
const tp0 = await ev(() => { const v = window.__sim.vehicle.pos; return [v.x, v.z]; });

// ---------- code prompt ----------
await page.keyboard.press('Digit0');
check('0 opens the Good Luck code prompt', await wait(() => !document.getElementById('lk-code').hidden && document.activeElement.id === 'lk-input'));
const tp1 = await ev(() => { const v = window.__sim.vehicle.pos; return [v.x, v.z]; });
check('0 does not teleport the car', Math.hypot(tp1[0] - tp0[0], tp1[1] - tp0[1]) < 1);
await page.keyboard.type('nope'); await page.keyboard.press('Enter');
await wait(() => document.getElementById('lk-msg').textContent.includes('Bad luck'));
await shot('l01-wrong-code');
check('a wrong code is refused', await ev(() => !window.__sim.luck.unlocked && document.getElementById('lk-msg').textContent.includes('Bad luck')));
if (BYPASS) { console.log('(code prompt skipped: unlocking directly)'); await page.keyboard.press('Escape'); await ev(() => window.__sim.luck.unlock()); }
else { await page.keyboard.type(CODE.toUpperCase()); await page.keyboard.press('Enter'); }
check(BYPASS ? 'menu unlocks' : 'the right code (any case) unlocks the menu', await wait(() => window.__sim.luck.unlocked && !document.getElementById('lk-menu').hidden));
await shot('l02-good-luck-menu', 800);
check('the code is not the mod-menu code (mod menu stays locked)', await ev(() => !window.__sim.hacks.unlocked));

// ---------- unlock everything ----------
await page.click('#lk-unlockAll');
const un = await ev(() => { const S = window.__sim, P = S.profile; return { skins: S.skinIds.filter(id => P.hasSkin(id)).length, fan: P.owned('fan'), motor: P.owned('motor') }; });
check('Unlock everything: all 87 skins + every upgrade', un.skins === 87 && un.fan === 3 && un.motor === 3, JSON.stringify(un));
await page.click('#lk-unlockAll');
const un2 = await ev(() => { const S = window.__sim, P = S.profile; return { skins: S.skinIds.filter(id => P.hasSkin(id)).length, fan: P.owned('fan') }; });
check('turning it off gives the real save back', un2.skins === 0 && un2.fan === 0, JSON.stringify(un2));

// ---------- skin swapper ----------
await page.click('#lk-tab-skins');
await shot('l03-skin-swapper');
await page.click('.lk-skin[data-skin="dev-50"]');
await camNear(4.5, 1.6, 4.5);
await shot('l04-wearing-dev-skin', 900);
check('skin swapper puts on any skin (a Dev skin, not owned)', await ev(() => window.__sim.model.skin && window.__sim.model.skin.id === 'dev-50'));
await page.click('.lk-skin[data-skin="o-gold"]');
check('swap to another skin', await ev(() => window.__sim.model.skin.id === 'o-gold'));
await page.click('.lk-chip[data-skin=""]');
check('"My garage skin" goes back to the normal look', await ev(() => !window.__sim.model.skin));

// ---------- silly cars ----------
await page.click('#lk-tab-cars');
await shot('l05-silly-cars-tab');
const ids = await ev(() => [...document.querySelectorAll('.lk-car[data-car]')].map(b => b.dataset.car).filter(Boolean));
let okCars = 0; const badCars = [];
for (const [i, id] of ids.entries()) {
  await page.click(`.lk-car[data-car="${id}"]`);
  const st = await ev(() => {
    const m = window.__sim.model; let tris = 0, meshes = 0;
    if (m.sillyBody) m.sillyBody.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    const b = m.sillyBody && m.sillyBody.userData.box;
    return { on: !!m.sillyBody, body: m.body.visible, wings: Object.values(m.wings).some(w => w.visible), tris: Math.round(tris), meshes, box: b ? [b.min.y, b.max.y, b.min.z, b.max.z].map(x => +x.toFixed(2)) : null };
  });
  await camNear(i % 2 ? -4.6 : 4.6, 1.9, 4.2);
  await shot(`l1${String(i).padStart(2, '0')}-car-${id}`, 700);
  const ok = st.on && !st.body && !st.wings && st.tris < 6000 && st.meshes <= 25 && st.box && st.box[0] > -0.5 && st.box[1] < 2.2;
  if (ok) okCars++; else badCars.push(id + ' ' + JSON.stringify(st));
  console.log(`  ${id}: ${st.tris} triangles, ${st.meshes} meshes, y ${st.box && st.box[0]}..${st.box && st.box[1]}`);
}
check(`all ${ids.length} silly cars build and replace the body`, ids.length === 12 && okCars === 12, badCars.join(' | '));
await page.click('.lk-car[data-car=""]');
check('"Normal car" brings the real body back', await ev(() => { const m = window.__sim.model; return !m.sillyBody && m.body.visible && m.canopy.visible; }));

// ---------- looks only: same physics with a banana, eyes, hat, monster wheels, tiny, jelly ----------
// Classic physics has no wind, tire wear or damage, so the same inputs give the same drive every time
const drive = () => ev(() => { const S = window.__sim, v = S.vehicle; S.teleport(2); S.step(240, {}); S.step(240 * 4, { throttle: 1, steer: 0.3 }); S.luck.update(1 / 60, true); S.step(240, { throttle: 1 }); return [v.pos.x, v.pos.y, v.pos.z, v.vel.x, v.vel.z].map(x => +x.toFixed(6)); });
await ev(() => { window.__sim.freeze = true; window.__sim.setPhysics('classic'); });
const plain = await drive(), plain2 = await drive();
await ev(() => { const L = window.__sim.luck; L.set('car', 'banana'); for (const k of ['eyes', 'hat', 'giantWheels', 'tiny', 'jelly', 'trail']) L.set(k, true); });
const banana = await drive();
check('silly car + looks-only mods drive exactly the same', JSON.stringify(plain) === JSON.stringify(plain2) && JSON.stringify(plain) === JSON.stringify(banana), `plain ${plain} | again ${plain2} | banana ${banana}`);
await ev(() => { window.__sim.setPhysics('2'); window.__sim.freeze = false; window.__sim.teleport(1); });
await step(1, {});

// ---------- mods ----------
await page.click('#lk-tab-mods');
await shot('l20-mods-tab');
const mods = await ev(() => { const m = window.__sim.model; return { wheel: m.wheels[0].holder.scale.y, scale: +m.group.scale.x.toFixed(2), eyes: !!window.__sim.luck.eyes && window.__sim.luck.eyes.visible, hat: !!window.__sim.luck.hat && window.__sim.luck.hat.visible }; });
check('monster wheels, tiny car, googly eyes, party hat', mods.wheel > 1.5 && mods.scale < 0.6 && mods.eyes && mods.hat, JSON.stringify(mods));
await camNear(3.2, 1.2, 3.2, 38);
await shot('l21-tiny-banana-monster-wheels-eyes-hat', 900);
await ev(() => { const L = window.__sim.luck; L.set('tiny', false); L.set('car', 'duck'); });
await camNear(4.5, 1.8, 4.5);
await shot('l22-duck-with-eyes-and-hat', 900);
// confetti
await ev(() => window.__sim.luck.set('confetti', true));
const conf = await ev(() => { const S = window.__sim, fx = S.effects.fire, n0 = fx.n; S.destruction.explode(S.vehicle.pos.clone().add(new S.THREE.Vector3(20, 0, 20)), 6, 1, 'gun'); return fx.n - n0; });
check('confetti explosions', conf > 60, `${conf} particles`);
await camNear(10, 6, 34, 50);
await shot('l23-confetti', 300);
// fart boost
await ev(() => window.__sim.luck.set('fart', true));
await ev(() => { window.__sim.teleport(2); });
await step(1, {});
const sm0 = await ev(() => window.__sim.effects.smoke.n);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(3000);
const sm1 = await ev(() => window.__sim.effects.smoke.n);
await camNear(-3, 1.5, -7, 50);
await shot('l24-fart-boost', 200);
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
check('fart boost puffs green clouds', sm1 > sm0, `smoke ${sm0} -> ${sm1}`);
// clown horn
await ev(() => window.__sim.luck.set('horn', true));
await page.keyboard.press('Enter');
check('Enter honks the clown horn (no errors)', true);
// bouncy: drop from 12 m, it should come back up
await ev(() => { const S = window.__sim, v = S.vehicle; S.luck.set('bouncy', true); S.teleport(1); v.pos.y += 12; v.vel.set(0, 0, 0); window.__sim.freeze = true; });
const bounce = await ev(() => { const S = window.__sim, v = S.vehicle; let up = 0; for (let i = 0; i < 300; i++) { S.step(4, {}); S.luck.update(4 / 240, true); up = Math.max(up, v.contacts ? 0 : v.vel.y); } return up; });
await ev(() => { window.__sim.freeze = false; });
check('bouncy car bounces after a drop', bounce > 3, `up ${bounce.toFixed(1)} m/s`);

// ---------- I'm feeling lucky + all off ----------
await camOff();
await page.click('#lk-lucky');
const lucky = await ev(() => ({ car: window.__sim.luck.v.car, skin: window.__sim.luck.v.skin }));
check("I'm feeling lucky picks a car and a skin", !!lucky.car && !!lucky.skin, JSON.stringify(lucky));
await camNear(4.5, 1.8, 4.5);
await shot('l25-feeling-lucky', 900);
await camOff();
await page.click('#lk-reset');
const off = await ev(() => { const m = window.__sim.model, L = window.__sim.luck; return { silly: !!m.sillyBody, body: m.body.visible, wheel: m.wheels[0].holder.scale.y, scale: m.group.scale.x, eyes: !!(L.eyes && L.eyes.visible), hat: !!(L.hat && L.hat.visible), skin: !!m.skin }; });
check('All off: back to the normal car', !off.silly && off.body && off.wheel === 1 && off.scale === 1 && !off.eyes && !off.hat && !off.skin, JSON.stringify(off));
await page.keyboard.press('Digit0');
check('0 hides the menu', await wait(() => document.getElementById('lk-menu').hidden));
await shot('l26-normal-again', 600);
check('no runtime errors', s.errors.filter(e => !/Autofocus|GPU stall|swiftshader/i.test(e)).length === 0, s.errors.slice(0, 5).join(' | '));
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
await s.close();
