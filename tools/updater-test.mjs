// End-to-end updater test with the packaged desktop app (linux build of the same code, run under xvfb).
// Since app 1.2.0 an available update opens its own window before the game. Checks: update window ->
// install -> game on the new version, settings kept, restart stays updated; broken update rolls back and
// is never offered again; corrupted download is refused and you can still play; offline start is silent
// and a manual check explains; app-shell changes ask for a full download; an update published while
// playing closes the game, opens the update window and installs. Exits 1 if any check fails.
//   node tools/package.mjs --linux && xvfb-run -a node tools/updater-test.mjs out/
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
const V1 = `${MA}.${MI}.${PA + 1}`, V2 = `${MA}.${MI}.${PA + 2}`, V3 = `${MA}.${MI}.${PA + 3}`, V4 = `${MA}.${MI}.${PA + 4}`, VSHELL = `${MA + 1}.0.0`;

async function launch(env = {}) {
  const app = await _electron.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    env: { ...process.env, XDG_CONFIG_HOME: home, ROADSTER_UPDATE_URL: URL_BASE, ...env } });
  const first = await app.firstWindow();
  first.setDefaultTimeout(240000);
  await first.waitForLoadState('domcontentloaded');
  return { app, first, isUpdater: (await first.title()).includes('Update') };
}
// the update window closes and the game window opens
const nextGame = async (app) => { const w = await app.waitForEvent('window', { timeout: 240000 }); w.setDefaultTimeout(240000); return w; };
const ready = (win) => win.waitForFunction(() => window.__sim && document.getElementById('loading').hidden, null, { timeout: 240000 });
const version = (win) => win.evaluate(() => [window.desktop && window.desktop.gameVersion, document.querySelector('meta[name=test-build]')?.content || 'bundled']);
const noUpdateWindow = async (app) => { await new Promise(r => setTimeout(r, 6000)); return app.windows().every(w => !w.isClosed() && !w.url().includes('updater.html')); };

// 0. no update published: the game opens straight away on the bundled version; save a setting
let { app, first, isUpdater } = await launch();
await ready(first);
check('starts straight into the game on the bundled version', !isUpdater && (await version(first)).join() === `${BUNDLED},bundled`, (await version(first)).join());
await first.evaluate(() => localStorage.setItem('rrs.updater-test', 'kept'));
await app.close();

// 1. update published: its window comes first, Update now installs it and the game opens on it
publish(V1, marked(V1));
({ app, first, isUpdater } = await launch());
const offer = isUpdater ? await first.evaluate(() => ({ ver: document.getElementById('ver').textContent, notes: document.getElementById('notes').textContent })) : null;
check('update window appears before the game', isUpdater && offer.ver.includes(V1) && offer.notes.includes(V1), JSON.stringify(offer));
await first.screenshot({ path: resolve(work, '..', 'u-window.png') });
let game = nextGame(app);
await first.click('#go');
let win = await game; await ready(win);
check('update installs and the game opens on the new version', (await version(win)).join() === `${V1},${V1}`, (await version(win)).join());
check('saved settings survive the update', await win.evaluate(() => localStorage.getItem('rrs.updater-test') === 'kept'));
await app.close();

// 2. restart keeps the new version, nothing offered
({ app, first, isUpdater } = await launch());
await ready(first);
check('restart stays on the installed update', !isUpdater && (await version(first)).join() === `${V1},${V1}`);
check('no update window when already up to date', await noUpdateWindow(app));
await app.close();

// 3. broken update rolls back automatically
publish(V2, '<!doctype html><title>broken</title><p>this build never starts</p>');
({ app, first, isUpdater } = await launch({ ROADSTER_BOOT_TIMEOUT: '8000' }));
game = nextGame(app);
await first.click('#go');
win = await game;
await ready(win);
const toast = await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes("didn't start")), null, { timeout: 60000 }).then(() => true).catch(() => false);
const after = await version(win);
check('broken update rolls back to the last working version', isUpdater && after.join() === `${V1},${V1}` && toast, `${after.join()} toast=${toast}`);
await app.close();
({ app, first, isUpdater } = await launch());
await ready(first);
check('the broken version is not offered again', !isUpdater && await noUpdateWindow(app));
await app.close();

// 4. corrupted download is refused, you can still play
publish(V3, marked(V3));
const man = JSON.parse(readFileSync(resolve(srv, 'latest.json'), 'utf8')); man.sha256 = '0'.repeat(64); writeFileSync(resolve(srv, 'latest.json'), JSON.stringify(man));
({ app, first, isUpdater } = await launch());
await first.click('#go');
await first.waitForFunction(() => document.getElementById('st').textContent.includes('failed'), null, { timeout: 120000 }).catch(() => {});
const st = await first.evaluate(() => document.getElementById('st').textContent);
game = nextGame(app);
await first.click('#skip');
win = await game; await ready(win);
check('corrupted download is refused, game still opens on the working version', isUpdater && st.includes('corrupted') && (await version(win)).join() === `${V1},${V1}`, st);
await app.close();

// 5. offline: silent start, manual check explains
({ app, first, isUpdater } = await launch({ ROADSTER_UPDATE_URL: 'http://localhost:9/' }));
await ready(first);
await first.evaluate(() => { window.__sim.startGame(); document.getElementById('upd-check').click(); });
const offlineToast = await first.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Could not check')), null, { timeout: 60000 }).then(() => true).catch(() => false);
check('offline start is silent, manual check explains', !isUpdater && offlineToast);
await app.close();

// 6. shell change needs a full download
publish(VSHELL, marked(VSHELL), { minShell: VSHELL });
({ app, first, isUpdater } = await launch());
const full = isUpdater ? await first.evaluate(() => [document.getElementById('st').textContent, document.getElementById('go').textContent]) : ['', ''];
check('app-shell updates ask for a full download', full[0].includes('new download') && full[1].includes('download page'), full.join(' | '));
game = nextGame(app);
await first.click('#skip');
win = await game; await ready(win);
check('"Play without updating" opens the game', (await version(win)).join() === `${V1},${V1}`);
await app.close();

// 7. update published while playing: the game closes, the update window pops up, Update now installs it
publish(V1, marked(V1)); // nothing newer than the installed version at launch
({ app, first, isUpdater } = await launch({ ROADSTER_CHECK_EVERY: '8000' }));
let appClosed = false; app.on('close', () => { appClosed = true; });
await ready(first);
let gameClosed = false; first.on('close', () => { gameClosed = true; });
check('starts into the game when nothing new is published', !isUpdater && (await version(first)).join() === `${V1},${V1}`);
publish(V4, marked(V4));
const pop = await app.waitForEvent('window', { timeout: 60000 }).catch(() => null);
const popped = !!pop && (await pop.title()).includes('Update') && (await pop.textContent('#ver')).includes(V4);
check('update published while playing closes the game and opens the update window', popped && gameClosed && !appClosed, `popped=${popped} gameClosed=${gameClosed} appClosed=${appClosed}`);
if (popped) {
  game = nextGame(app);
  await pop.click('#go');
  win = await game; await ready(win);
  check('Update now reopens the game on the new version', (await version(win)).join() === `${V4},${V4}` && !appClosed, (await version(win)).join());
}
await app.close();

server.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
process.exit(res.every(Boolean) ? 0 : 1);
