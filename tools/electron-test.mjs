// Launches the packaged desktop app (linux build of the same code) and checks the game runs inside it.
import { _electron } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
const out = process.argv[2] || '/tmp';
const app = await _electron.launch({ executablePath: fileURLToPath(new URL('../desktop/out/Roadster Rocket Sim-linux-x64/roadster-rocket-sim', import.meta.url)), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const win = await app.firstWindow();
win.setDefaultTimeout(180000);
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(960, 600); });
const errors = [];
win.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
win.on('pageerror', e => errors.push('pageerror ' + e.message));
await win.waitForFunction(() => window.__sim && document.getElementById('loading').hidden, null, { timeout: 120000 });
const info = await win.evaluate(() => ({
  title: document.title,
  fonts: document.fonts.check('800 40px "Barlow Condensed"') && document.fonts.check('400 16px "Barlow"'),
  url: location.protocol,
  size: [innerWidth, innerHeight],
}));
console.log('window:', JSON.stringify(info), 'electron title:', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()));
await win.screenshot({ path: `${out}/e-start.png` });
await win.click('#go');
await win.waitForTimeout(500);
// keyboard input reaches the game inside the app
await win.keyboard.down('KeyW'); await win.waitForTimeout(2500); await win.keyboard.up('KeyW');
const sp = await win.evaluate(() => window.__sim.vehicle.vel.length());
console.log('speed after holding W:', (sp * 2.237).toFixed(1), 'mph');
// physics + rockets + destruction inside the app
const r = await win.evaluate(() => { const S = window.__sim; S.teleport(8); S.step(240); S.fireAt(560, 2, -697); S.step(480); return { destroyed: S.destruction.blocks.filter(b => b.state !== 'static').length, errors: S.G.errors }; });
console.log('weapons in app:', JSON.stringify(r));
// settings persist across restarts (localStorage)
await win.evaluate(() => localStorage.setItem('rrs.persist-test', '1'));
await win.screenshot({ path: `${out}/e-play.png` });
await app.close();
const app2 = await _electron.launch({ executablePath: fileURLToPath(new URL('../desktop/out/Roadster Rocket Sim-linux-x64/roadster-rocket-sim', import.meta.url)), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const w2 = await app2.firstWindow();
w2.setDefaultTimeout(180000);
await w2.waitForFunction(() => window.__sim, null, { timeout: 120000 });
console.log('localStorage persists after restart:', await w2.evaluate(() => localStorage.getItem('rrs.persist-test') === '1'));
await app2.close();
console.log('errors:', errors.length ? errors.join('\n') : 'none');
