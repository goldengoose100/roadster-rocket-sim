// Beauty shots of the car model from several angles.
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
const s = await openSim({ width: 1200, height: 750, quality: 2 });
await waitReady(s.page);
await s.page.evaluate(() => { window.__sim.startGame(); });
await s.page.waitForTimeout(800);
const views = [
  ['car-front34', [5.5, 1.6, 5.5], [0, 0.1, 0]],
  ['car-rear34', [-5, 1.8, -5.5], [0, 0.1, 0]],
  ['car-side', [7.5, 0.9, 0.2], [0, 0.2, 0]],
  ['car-top', [0.01, 9, 0.5], [0, 0, 0]],
  ['car-front', [0, 1.0, 7], [0, 0.2, 0]],
];
for (const [name, p, l] of views) {
  await s.page.evaluate(([p, l]) => {
    const v = window.__sim.vehicle;
    const yaw = Math.atan2(v.fwd.x, v.fwd.z), c = Math.cos(yaw), sn = Math.sin(yaw);
    const w = (a) => [v.pos.x + a[0] * c + a[2] * sn, v.pos.y + a[1], v.pos.z - a[0] * sn + a[2] * c];
    window.__sim.camOverride = { pos: w(p), look: w(l), fov: 38 };
  }, [p, l]);
  await s.page.waitForTimeout(400);
  await s.page.screenshot({ path: `${out}/${name}.png` });
}
console.log('errors:', s.errors.join('\n') || 'none');
await s.close();
