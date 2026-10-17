// Smoke test: boot, start, drive a bit, screenshot.
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
const t0 = Date.now();
const s = await openSim({ quality: Number(process.env.Q ?? 2) });
try {
  await waitReady(s.page);
  console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await s.page.screenshot({ path: `${out}/01-start.png` });
  await s.page.evaluate(() => window.__sim.startGame());
  await s.page.waitForTimeout(1500);
  await s.page.screenshot({ path: `${out}/02-hq.png` });
  console.log(JSON.stringify(await s.page.evaluate(() => window.__sim.stats())));
} catch (e) { console.log('FAIL', e.message); }
console.log('errors:', s.errors.length ? '\n' + s.errors.slice(0, 30).join('\n') : 'none');
await s.close();
