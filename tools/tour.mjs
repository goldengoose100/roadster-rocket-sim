// Frozen-moment screenshots of each feature for visual review.
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
const only = process.argv[3];
const s = await openSim({ width: 1280, height: 760, quality: 2 });
const page = s.page;
await waitReady(page);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/t-start.png` });
await page.evaluate(() => window.__sim.startGame());
const step = (sec, c) => page.evaluate(([sec, c]) => window.__sim.step(Math.round(sec * 240), c), [sec, c]);
const freezeShot = async (name, settle = 1500) => {
  await page.evaluate(() => { window.__sim.freeze = true; });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}/t-${name}.png` });
  await page.evaluate(() => { window.__sim.freeze = false; });
};
const want = (n) => !only || only.split(',').includes(n);
if (want('hq')) { await step(1); await freezeShot('hq'); }
if (want('loop')) {
  await page.evaluate(() => window.__sim.teleport(4)); await step(1);
  for (let i = 0; i < 200; i++) { const y = await page.evaluate(() => window.__sim.vehicle.pos.y); if (y > 22) break; await step(0.05, { throttle: 1 }); }
  await freezeShot('loop', 2500);
}
if (want('demo')) {
  await page.evaluate(() => window.__sim.teleport(3)); await step(1);
  for (let i = 0; i < 300; i++) { const u = await page.evaluate(() => window.__sim.vehicle.up.y); if (u < -0.6) break; await step(0.05, { throttle: 1 }); }
  await freezeShot('demo-top', 2500);
  await step(1.0, {}); await step(0.6, { lift: true });
  await freezeShot('demo-hover', 2000);
}
if (want('boom')) {
  await page.evaluate(() => { window.__sim.teleport(8); window.__sim.step(240); window.__sim.fireAt(560, 2, -697); });
  for (let i = 0; i < 60; i++) { const n = await page.evaluate(() => window.__sim.weapons.rockets.length); if (!n) break; await step(0.02, {}); }
  await step(0.12, {});
  await page.evaluate(() => { window.__sim.camOverride = { pos: [585, 9, -665], look: [560, 3, -700], fov: 50 }; });
  await freezeShot('boom', 1500);
  await step(2.5, {});
  await freezeShot('boom-after', 1200);
  await page.evaluate(() => { window.__sim.camOverride = null; });
}
if (want('flight')) {
  await page.evaluate(() => { window.__sim.teleport(7); window.__sim.vehicle.sandbox = true; }); await step(1);
  await step(2.5, { lift: true }); await step(2, { throttle: 1, boost: true }); await step(0.4, { throttle: 1 });
  await freezeShot('flight', 2000);
}
if (want('wall')) {
  await page.evaluate(() => window.__sim.teleport(5)); await step(1);
  await step(1.5, { throttle: 1 });
  let onWall = false;
  for (let i = 0; i < 140; i++) {
    const v = await page.evaluate(() => { const v = window.__sim.vehicle; return { y: v.pos.y, fy: v.fwd.y, fx: v.fwd.x, fz: v.fwd.z, sp: v.vel.length(), up: v.up.y }; });
    let steer;
    if (!onWall && v.y < 2) { const yaw = Math.atan2(v.fx, v.fz), want = Math.atan2(Math.cos(0.6), Math.sin(0.6)); steer = Math.max(-1, Math.min(1, (want - yaw) * 3)); }
    else { onWall = true; const d = Math.max(-0.3, Math.min(0.35, (15 - v.y) * 0.06)); steer = Math.max(-1, Math.min(1, -(d - v.fy) * 5)); }
    await step(0.1, { throttle: v.sp < 30 ? 1 : 0.4, steer });
    if (v.y > 12 && Math.abs(v.up) < 0.3) break;
  }
  await freezeShot('wall', 2500);
}
if (want('jump')) {
  await page.evaluate(() => window.__sim.teleport(6)); await step(1);
  for (let i = 0; i < 300; i++) { const st = await page.evaluate(() => ({ c: window.__sim.vehicle.contacts, x: window.__sim.vehicle.pos.x, sp: window.__sim.vehicle.vel.length() })); if (st.c === 0 && st.x < -592) break; await step(0.03, { throttle: st.sp < 34 ? 1 : 0.2 }); }
  await freezeShot('jump', 2500);
}
if (want('ui')) {
  await page.keyboard.press('KeyM'); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/t-map.png` }); await page.keyboard.press('KeyM');
  await page.keyboard.press('KeyH'); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/t-help.png` }); await page.keyboard.press('KeyH');
  await page.keyboard.press('KeyP'); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/t-menu.png` }); await page.keyboard.press('KeyP');
}
console.log('errors:', s.errors.join('\n') || 'none');
await s.close();
