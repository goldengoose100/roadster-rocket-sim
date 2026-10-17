// Release check: an app exactly like the ones players have installed (current shell, previous game version)
// finds the update in updates/, installs it from a local copy of the update server and starts it.
// Run after tools/release.mjs:  xvfb-run -a node tools/release-check.mjs <screenshot dir> [previous version]
import { _electron } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] || '/tmp';
const latest = JSON.parse(readFileSync(resolve(root, 'updates/latest.json'), 'utf8'));
const prev = process.argv[3] || readdirSync(resolve(root, 'updates')).filter(f => /^game-[\d.]+\.html$/.test(f) && f !== latest.file).map(f => f.slice(5, -5)).sort().pop();
const work = resolve(out, 'release-check'); rmSync(work, { recursive: true, force: true });
const appDir = resolve(work, 'app'); mkdirSync(resolve(appDir, 'app'), { recursive: true });
for (const f of ['package.json', 'main.cjs', 'preload.cjs', 'updater.html']) copyFileSync(resolve(root, 'desktop', f), resolve(appDir, f));
copyFileSync(resolve(root, `updates/game-${prev}.html`), resolve(appDir, 'app/index.html'));
writeFileSync(resolve(appDir, 'app/version.json'), JSON.stringify({ version: prev }));
const res = []; const check = (n, ok, info = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`); };

// local copy of the update server (serves the repo's updates/ folder)
const srv = resolve(root, 'updates');
const server = createServer((q, r) => { const f = resolve(srv, '.' + q.url.split('?')[0]); if (!f.startsWith(srv) || !existsSync(f)) { r.writeHead(404); r.end(); return; } const b = readFileSync(f); r.writeHead(200, { 'content-length': b.length }); r.end(b); });
await new Promise(r => server.listen(0, r));
const app = await _electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron'), args: [appDir, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: { ...process.env, XDG_CONFIG_HOME: resolve(work, 'home'), ROADSTER_UPDATE_URL: `http://localhost:${server.address().port}/` } });
const errors = [];
const up = await app.firstWindow();
await up.waitForSelector('#go', { timeout: 60000 });
const offer = await up.evaluate(() => ({ title: document.title, ver: document.getElementById('ver').textContent, notes: document.getElementById('notes').textContent }));
await up.screenshot({ path: resolve(out, 'u1-update-window.png') });
check(`a ${prev} app is offered ${latest.version}`, offer.ver.includes(latest.version) && offer.ver.includes(prev), `${offer.ver} | ${offer.notes}`);
const next = app.waitForEvent('window', { timeout: 180000 });
await up.click('#go');
const game = await next; game.setDefaultTimeout(240000);
game.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
game.on('pageerror', (e) => errors.push(e.message));
await game.waitForFunction(() => window.__sim && document.getElementById('loading').hidden);
await game.waitForTimeout(1500);
await game.screenshot({ path: resolve(out, 'u2-updated-start-screen.png') });
const v = await game.evaluate(() => ({ version: window.desktop.gameVersion, garage: !!document.getElementById('go-garage'), sim: !!window.__sim.profile }));
check(`update installs and the game starts on ${latest.version}`, v.version === latest.version && v.garage && v.sim, JSON.stringify(v));
// pause menu shows the new version
await game.evaluate(() => window.__sim.startGame());
await game.keyboard.press('KeyP'); await game.waitForTimeout(800);
await game.screenshot({ path: resolve(out, 'u3-pause-menu-version.png') });
check('pause menu shows the new version', (await game.evaluate(() => document.getElementById('ver-text').textContent)) === latest.version);
check('no errors after updating', errors.length === 0, errors.slice(0, 3).join(' | '));
await app.close();
server.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
