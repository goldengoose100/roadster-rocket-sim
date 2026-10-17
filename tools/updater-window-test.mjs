// Launch with an update waiting: the update window must appear before the game, then start the new version.
import { _electron } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const work = resolve(process.argv[2] || '/tmp', 'upwin'); rmSync(work, { recursive: true, force: true });
const srv = resolve(work, 's'); mkdirSync(srv, { recursive: true });
const html = readFileSync(resolve(root, 'desktop/app/index.html'), 'utf8').replace('<title>', '<meta name="test-build" content="9.9.9"><title>');
writeFileSync(resolve(srv, 'game-9.9.9.html'), html);
writeFileSync(resolve(srv, 'latest.json'), JSON.stringify({ version: '9.9.9', file: 'game-9.9.9.html', sha256: createHash('sha256').update(html).digest('hex'), size: html.length, minShell: '1.1.0', notes: ['Window test'] }));
const server = createServer((q, r) => { const f = resolve(srv, '.' + q.url.split('?')[0]); if (!existsSync(f)) { r.writeHead(404); r.end(); return; } const b = readFileSync(f); r.writeHead(200, { 'content-length': b.length }); r.end(b); });
await new Promise(r => server.listen(0, r));
const app = await _electron.launch({ executablePath: resolve(root, 'desktop/out/Roadster Rocket Sim-linux-x64/roadster-rocket-sim'), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: { ...process.env, XDG_CONFIG_HOME: resolve(work, 'h'), ROADSTER_UPDATE_URL: `http://localhost:${server.address().port}/` } });
const up = await app.firstWindow();
console.log('first window:', await up.title(), '|', await up.textContent('#ver'));
await up.screenshot({ path: resolve(work, '..', 'upwin.png') });
await up.click('#go');
const game = await app.waitForEvent('window', { timeout: 60000 });
game.setDefaultTimeout(180000);
await game.waitForFunction(() => window.__sim && document.getElementById('loading').hidden);
console.log('game opened on:', await game.evaluate(() => window.desktop.gameVersion + ' / ' + (document.querySelector('meta[name=test-build]')?.content || 'bundled')));
await app.close(); server.close();
