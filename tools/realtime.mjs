// Real-time play with keyboard input (what a player sees), screenshots along the way.
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
const s = await openSim({ width: 1280, height: 760, quality: 1 });
const page = s.page;
await waitReady(page);
await page.click('#go');
await page.waitForTimeout(500);
const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
const shot = (n) => page.screenshot({ path: `${out}/rt-${n}.png` });
const st = () => page.evaluate(() => { const v = window.__sim.vehicle; return `pos=(${v.pos.x.toFixed(0)},${v.pos.y.toFixed(1)},${v.pos.z.toFixed(0)}) v=${(v.vel.length()*2.237).toFixed(0)}mph up=${v.up.y.toFixed(2)} fps=${window.__sim.G.fps.toFixed(0)}`; });
// HQ: lift off and hover
await hold(['Space'], 1500); await shot('hover-climb'); console.log('hover', await st());
await hold(['KeyW'], 1200); await shot('hover-tilt'); console.log('tilt', await st());
await page.waitForTimeout(1500); await shot('hover-hold'); console.log('hold', await st());
await hold(['KeyC'], 5000); console.log('landed', await st());
// jump park, real time
await page.keyboard.press('Digit6'); await page.waitForTimeout(600);
await page.keyboard.down('KeyW');
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(150);
  const air = await page.evaluate(() => window.__sim.vehicle.contacts === 0 && window.__sim.vehicle.pos.x < -580);
  if (air) { await shot('jump-air'); console.log('jump air', await st()); break; }
}
await page.keyboard.up('KeyW');
await page.waitForTimeout(1500); await shot('jump-landed'); console.log('after jump', await st());
// boost on drag strip
await page.keyboard.press('Digit2'); await page.waitForTimeout(600);
await hold(['KeyW', 'ShiftLeft'], 1300); await shot('drag-boost'); console.log('boost', await st());
console.log('errors:', s.errors.join('\n') || 'none');
await s.close();
