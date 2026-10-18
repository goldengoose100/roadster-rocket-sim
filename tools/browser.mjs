// Shared Playwright setup: serves dist/, maps the three.js CDN to the local copy,
// and collects console errors. Used by the test scripts in tools/.
// APP=1 runs the same tests inside the packaged desktop app instead of a browser
// (needs `node tools/package.mjs --linux-only` first; the linux build runs the same game file as the .exe).
import { chromium, _electron } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THREE_DIR = resolve(root, 'node_modules/three');
export const APP_EXE = resolve(root, 'desktop/out/Roadster Rocket Sim-linux-x64/roadster-rocket-sim');

async function openApp({ width, height, quality }) {
  const home = mkdtempSync(join(tmpdir(), 'rrs-app-'));
  const app = await _electron.launch({ executablePath: APP_EXE, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    env: { ...process.env, XDG_CONFIG_HOME: home, ROADSTER_UPDATE_URL: 'http://localhost:9/' } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(600000);   // swiftshader on a small machine can take minutes per frame
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(w, h); }, [width, height]);
  if (quality !== undefined) {
    await page.waitForFunction(() => window.__sim, null, { timeout: 180000 });
    await page.evaluate((q) => localStorage.setItem('rrs.settings', JSON.stringify({ quality: q })), quality);
    await page.reload();
  }
  return { page, app, errors, close: async () => { await app.close(); } };
}

export async function openSim({ width = 1440, height = 900, quality, touch = false } = {}) {
  if (process.env.APP === '1') return openApp({ width, height, quality });
  const offline = process.env.OFFLINE === '1';
  const distDir = offline ? 'desktop/app' : 'dist';
  const server = createServer((req, res) => {
    const p = resolve(root, distDir, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': extname(p) === '.html' ? 'text/html; charset=utf-8' : 'application/javascript' });
    res.end(readFileSync(p));
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  if (offline) await page.route((url) => !url.hostname.startsWith('localhost'), (route) => { errors.push('[network] blocked ' + route.request().url()); route.abort(); });
  else await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (route) => {
    const url = route.request().url();
    const rel = url.split('three@0.160.0/')[1];
    const file = resolve(THREE_DIR, rel);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'nf' });
    route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(file) });
  });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  if (quality !== undefined) await page.addInitScript((q) => { localStorage.setItem('rrs.settings', JSON.stringify({ quality: q })); }, quality);
  await page.goto(`http://localhost:${port}/index.html`);
  return { page, browser, server, errors, close: async () => { await browser.close(); server.close(); } };
}

export async function waitReady(page, timeout = 120000) {
  await page.waitForFunction(() => window.__sim && document.getElementById('loading').hidden, null, { timeout });
}
