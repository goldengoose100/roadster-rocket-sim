// End-to-end updater test with the packaged desktop app (linux build of the same code, run under xvfb):
// update offered -> installed -> survives restart; broken update rolls back; corrupted download refused;
// offline start is silent; app-shell changes ask for a full download.
import { _electron } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const exe = resolve(root, 'desktop/out/Roadster Rocket Sim-linux-x64/roadster-rocket-sim');
const work = resolve(process.argv[2] || '/tmp', 'updater-test');
rmSync(work, { recursive: true, force: true });
const srv = resolve(work, 'server'); mkdirSync(srv, { recursive: true });
const home = resolve(work, 'home'); mkdirSync(home, { recursive: true });
const res = []; const check = (n, ok, info = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`); };

const server = createServer((req, r) => {
  const f = resolve(srv, '.' + req.url.split('?')[0]);
  if (!f.startsWith(srv) || !existsSync(f)) { r.writeHead(404); r.end(); return; }
  const b = readFileSync(f); r.writeHead(200, { 'content-length': b.length }); r.end(b);
});
await new Promise(r => server.listen(0, r));
const URL_BASE = `http://localhost:${server.address().port}/`;
const base = readFileSync(resolve(root, 'desktop/app/index.html'), 'utf8');
const publish = (version, html, extra = {}) => {
  const file = `game-${version}.html`;
  writeFileSync(resolve(srv, file), html);
  const sha = createHash('sha256').update(Buffer.from(html)).digest('hex');
  writeFileSync(resolve(srv, 'latest.json'), JSON.stringify({ version, file, sha256: sha, size: Buffer.byteLength(html), minShell: '1.1.0', notes: [`Test notes for ${version}`], ...extra }));
};
const marked = (v) => base.replace('<title>', `<meta name="test-build" content="${v}"><title>`);
// test versions are just above whatever version is bundled in the app
const BUNDLED = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const [MA, MI, PA] = BUNDLED.split('.').map(Number);
const V1 = `${MA}.${MI}.${PA + 1}`, V2 = `${MA}.${MI}.${PA + 2}`, V3 = `${MA}.${MI}.${PA + 3}`, VSHELL = `${MA + 1}.0.0`;

async function launch(env = {}) {
  const app = await _electron.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    env: { ...process.env, XDG_CONFIG_HOME: home, ROADSTER_UPDATE_URL: URL_BASE, ...env } });
  const win = await app.firstWindow();
  win.setDefaultTimeout(180000);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(900, 560); });
  return { app, win };
}
const ready = (win) => win.waitForFunction(() => window.__sim && document.getElementById('loading').hidden, null, { timeout: 180000 });
const version = (win) => win.evaluate(() => [window.desktop && window.desktop.gameVersion, document.querySelector('meta[name=test-build]')?.content || 'bundled']);

// 1. update offered and installed
publish(V1, marked(V1));
let { app, win } = await launch();
await ready(win);
check('starts on the bundled version', (await version(win)).join() === `${BUNDLED},bundled`, (await version(win)).join());
await win.evaluate(() => localStorage.setItem('rrs.updater-test', 'kept'));
await win.waitForFunction(() => !document.getElementById('upd').hidden, null, { timeout: 60000 }).catch(() => {});
const modal = await win.evaluate(() => ({ shown: !document.getElementById('upd').hidden, title: document.getElementById('upd-title').textContent, ver: document.getElementById('upd-ver').textContent, notes: document.getElementById('upd-notes').textContent }));
check('update popup appears on launch', modal.shown && modal.notes.includes(V1), JSON.stringify(modal));
await win.screenshot({ path: resolve(work, '..', 'u-popup.png') });
await win.click('#upd-go');
await win.waitForFunction(() => document.querySelector('meta[name=test-build]'), null, { timeout: 120000 }).catch(() => {});
await ready(win);
check('update installs and reloads into the new version', (await version(win)).join() === `${V1},${V1}`, (await version(win)).join());
check('saved settings survive the update', await win.evaluate(() => localStorage.getItem('rrs.updater-test') === 'kept'));
await app.close();

// 2. restart keeps the new version, nothing offered
({ app, win } = await launch());
await ready(win);
check('restart stays on the installed update', (await version(win)).join() === `${V1},${V1}`);
await win.waitForTimeout(6000);
check('no popup when already up to date', await win.evaluate(() => document.getElementById('upd').hidden));
await app.close();

// 3. broken update rolls back automatically
publish(V2, '<!doctype html><title>broken</title><p>this build never starts</p>');
({ app, win } = await launch({ ROADSTER_BOOT_TIMEOUT: '8000' }));
await ready(win);
await win.waitForFunction(() => !document.getElementById('upd').hidden, null, { timeout: 60000 }).catch(() => {});
await win.click('#upd-go');
await win.waitForTimeout(3000);
await win.waitForFunction(() => window.__sim && document.getElementById('loading').hidden, null, { timeout: 120000 }).catch(() => {});
const after = await version(win);
const toast = await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes("didn't start")), null, { timeout: 20000 }).then(() => true).catch(() => false);
check('broken update rolls back to the last working version', after.join() === `${V1},${V1}` && toast, `${after.join()} toast=${toast}`);
await app.close();
({ app, win } = await launch());
await ready(win); await win.waitForTimeout(6000);
check('the broken version is not offered again', await win.evaluate(() => document.getElementById('upd').hidden));
await app.close();

// 4. corrupted download is refused
publish(V3, marked(V3));
const man = JSON.parse(readFileSync(resolve(srv, 'latest.json'), 'utf8')); man.sha256 = '0'.repeat(64); writeFileSync(resolve(srv, 'latest.json'), JSON.stringify(man));
({ app, win } = await launch());
await ready(win);
await win.waitForFunction(() => !document.getElementById('upd').hidden, null, { timeout: 60000 }).catch(() => {});
await win.click('#upd-go');
await win.waitForFunction(() => document.getElementById('upd-status').textContent.includes('failed'), null, { timeout: 60000 }).catch(() => {});
const st = await win.evaluate(() => document.getElementById('upd-status').textContent);
check('corrupted download is refused, game keeps working', st.includes('corrupted') && (await version(win)).join() === `${V1},${V1}`, st);
await app.close();

// 5. offline: silent start, manual check reports it
({ app, win } = await launch({ ROADSTER_UPDATE_URL: 'http://localhost:9/' }));
await ready(win); await win.waitForTimeout(5000);
const silent = await win.evaluate(() => document.getElementById('upd').hidden);
await win.evaluate(() => { window.__sim.startGame(); document.getElementById('upd-check').click(); });
const offlineToast = await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Could not check')), null, { timeout: 30000 }).then(() => true).catch(() => false);
check('offline start is silent, manual check explains', silent && offlineToast);
await app.close();

// 6. shell change needs a full download
publish(VSHELL, marked(VSHELL), { minShell: VSHELL });
({ app, win } = await launch());
await ready(win);
await win.waitForFunction(() => !document.getElementById('upd').hidden, null, { timeout: 60000 }).catch(() => {});
const full = await win.evaluate(() => [document.getElementById('upd-title').textContent, document.getElementById('upd-go').textContent]);
check('app-shell updates ask for a full download', full[0].includes('full download') && full[1].includes('download page'), full.join(' | '));
await app.close();

server.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
