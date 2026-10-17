// Bundles src/ into a single self-contained HTML page.
//   npm run build            -> dist/index.html (three.js and fonts load from CDNs)
//   npm run build:offline    -> desktop/app/index.html (three.js and fonts built in, no internet needed)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const offline = process.argv.includes('--offline');
const VERSION = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const res = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  write: false,
  external: offline ? [] : ['three', 'three/addons/*'],
  target: 'es2020',
  minify: offline,
  legalComments: 'none',
  logLevel: 'warning',
});
let js = res.outputFiles[0].text;
if (js.includes('</script')) js = js.replace(/<\/script/g, '<\\/script');
let html = readFileSync(resolve(root, 'tools/template.html'), 'utf8');

if (offline) {
  // no CDN: drop the import map and Google Fonts links, inline the font files instead
  html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
  html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/, '');
  const faces = readFileSync(resolve(root, 'desktop/fonts/latin.css'), 'utf8')
    .replace(/FONT:([\w-]+\.woff2)/g, (_, f) => 'data:font/woff2;base64,' + readFileSync(resolve(root, 'desktop/fonts', f)).toString('base64'));
  html = html.replace('<style>', '<style>\n' + faces + '\n');
} else {
  // shows a clear message if the 3D engine cannot be downloaded
  const watchdog = `<script>setTimeout(function(){if(!window.__booted){var l=document.getElementById('loading');if(l){l.classList.add('err');document.getElementById('load-s').textContent='Could not load the 3D engine (three.js) from the CDN. Check your internet connection and reload.';}}},20000);</script>\n`;
  html = html.replace('<script type="importmap">', watchdog + '<script type="importmap">');
}
html = html.replace('/*__BUNDLE__*/', () => js).replace(/__VERSION__/g, VERSION);
const out = offline ? resolve(root, 'desktop/app/index.html') : resolve(root, 'dist/index.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, offline ? '<!doctype html>\n<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1">\n' + html + '\n</html>' : html);
if (offline) writeFileSync(resolve(dirname(out), 'version.json'), JSON.stringify({ version: VERSION }) + '\n');
console.log(`${out.replace(root + '/', '')}  v${VERSION}  ${(html.length / 1024).toFixed(0)} KB`);
