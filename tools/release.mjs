// Publishes a game update for the desktop app's updater.
//   node tools/release.mjs "What changed" "Another change"
// Builds the offline game, copies it into <repo>/updates/game-<version>.html and writes updates/latest.json.
// Commit and push the repo afterwards; every installed copy picks it up on its next launch.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.RELEASE_DIR || root;
const notes = process.argv.slice(2);
execFileSync('node', [resolve(root, 'tools/build.mjs'), '--offline'], { stdio: 'inherit' });
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const shell = JSON.parse(readFileSync(resolve(root, 'desktop/package.json'), 'utf8'));
const html = readFileSync(resolve(root, 'desktop/app/index.html'));
const dir = resolve(repo, 'updates');
mkdirSync(dir, { recursive: true });
const file = `game-${version}.html`;
// keep the two newest game files so people mid-update can still finish
const old = readdirSync(dir).filter(f => /^game-[\d.]+\.html$/.test(f) && f !== file).sort((a, b) => {
  const v = (f) => f.slice(5, -5).split('.').map(Number);
  const x = v(a), y = v(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0;
});
for (const f of old.slice(1)) rmSync(resolve(dir, f));
copyFileSync(resolve(root, 'desktop/app/index.html'), resolve(dir, file));
const manifest = {
  version, file, sha256: createHash('sha256').update(html).digest('hex'), size: html.length,
  minShell: shell.minShellForUpdates || '1.1.0',
  date: new Date().toISOString().slice(0, 10),
  notes: notes.length ? notes : [`Version ${version}`],
};
writeFileSync(resolve(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`updates/${file} + latest.json written for v${version} (${(html.length / 1e6).toFixed(2)} MB)`);
