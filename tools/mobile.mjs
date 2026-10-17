// Phone-width layout check with touch controls.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { openSim, waitReady } from './browser.mjs';
const out = process.argv[2] || '/tmp';
const s = await openSim({ width: 400, height: 860, quality: 0, touch: process.env.TOUCH === '1' });
await waitReady(s.page);
await s.page.screenshot({ path: `${out}/m-start.png` });
const sw = await s.page.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.getElementById('start').scrollWidth]);
console.log('scrollWidth/innerWidth/start', sw);
await s.page.evaluate(() => window.__sim.startGame());
await s.page.waitForTimeout(1200);
await s.page.screenshot({ path: `${out}/m-hud${process.env.TOUCH === '1' ? '-touch' : ''}.png` });
console.log('errors:', s.errors.join('\n') || 'none');
await s.close();
