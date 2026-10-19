// APP=1 xvfb-run -a node tools/map-switch-test.mjs  (desktop app: picking a map restarts the game on it)
// desktop app: pick a map on the start screen, the game restarts on it; then pick the desert again
import { openSim, waitReady } from './browser.mjs';
const s = await openSim({ width: 1280, height: 800 });
await waitReady(s.page, 300000);
const where = () => s.page.evaluate(() => ({ map: window.__sim && window.__sim.world && window.__sim.world.map ? window.__sim.world.map.id : 'desert', tps: window.__sim && window.__sim.world ? window.__sim.world.teleports.map(t => t.name).slice(0, 3).join(', ') : '', fps: window.__sim ? Math.round(window.__sim.stats().fps) : 0, gen: window.__rrsGen }));
console.log('start:', JSON.stringify(await where()));
for (const id of ['moon', 'neon', 'desert']) {
  await s.page.click(`.mp-card[data-map="${id}"]`);
  await s.page.waitForTimeout(3000);
  await s.page.waitForFunction((id) => window.__sim && window.__sim.world && document.getElementById('loading').hidden && ((window.__sim.world.map && window.__sim.world.map.id) || 'desert') === id, id, { timeout: 120000 }).catch(() => {});
  await s.page.waitForTimeout(3000);
  console.log('picked', id, '->', JSON.stringify(await where()));
}
await s.page.evaluate(() => window.__sim.startGame());
await s.page.waitForTimeout(3000);
console.log('playing:', JSON.stringify(await where()));
console.log('errors:', s.errors.filter(e => !/Multiple instances of Three/.test(e)).slice(0, 8).join(' | ') || 'none');
await s.close();
