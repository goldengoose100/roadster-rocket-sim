// Packages the offline game as a desktop app.
//   node tools/package.mjs           -> desktop/out/Roadster Rocket Sim-win32-x64 (+ zip)
//   node tools/package.mjs --linux   -> also a linux build (used for automated testing)
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desk = resolve(root, 'desktop');
const out = resolve(desk, 'out');
const stage = resolve(desk, 'stage');

execFileSync('node', [resolve(root, 'tools/build.mjs'), '--offline'], { stdio: 'inherit' });
// stage only what the app needs
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ['package.json', 'main.cjs', 'preload.cjs', 'updater.html', 'app']) cpSync(resolve(desk, f), resolve(stage, f), { recursive: true });

const platforms = ['win32', ...(process.argv.includes('--linux') ? ['linux'] : [])];
for (const platform of platforms) {
  const [dir] = await packager({
    dir: stage, out, platform, arch: 'x64', electronVersion: '33.2.1', overwrite: true,
    name: 'Roadster Rocket Sim', executableName: platform === 'win32' ? 'Roadster Rocket Sim' : 'roadster-rocket-sim',
    asar: true, prune: false, quiet: true,
  });
  console.log('packaged', dir);
  if (platform === 'win32') {
    // set the icon and file details on the .exe (pure JS, no Wine needed)
    const exePath = resolve(dir, 'Roadster Rocket Sim.exe');
    const exe = ResEdit.NtExecutable.from(readFileSync(exePath));
    const res = ResEdit.NtExecutableResource.from(exe);
    const icoPath = resolve(desk, 'icon.ico');
    if (existsSync(icoPath)) {
      const ico = ResEdit.Data.IconFile.from(readFileSync(icoPath));
      const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
      for (const g of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map(i => i.data));
    }
    const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
    const lang = { lang: 1033, codepage: 1200 };
    vi.setStringValues(lang, { ProductName: 'Roadster Rocket Sim', FileDescription: 'Roadster Rocket Sim', CompanyName: 'Fan-made', OriginalFilename: 'Roadster Rocket Sim.exe', InternalName: 'Roadster Rocket Sim', LegalCopyright: 'Unofficial fan project' });
    const [a1, a2, a3] = JSON.parse(readFileSync(resolve(desk, 'package.json'), 'utf8')).version.split('.').map(Number);
    vi.setFileVersion(a1, a2, a3, 0, 1033); vi.setProductVersion(a1, a2, a3, 0, 1033);
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    writeFileSync(exePath, Buffer.from(exe.generate()));
    // zip for download
    const ver = JSON.parse(readFileSync(resolve(desk, 'package.json'), 'utf8')).version;
    const zip = resolve(out, `Roadster-Rocket-Sim-Windows-v${ver}.zip`);
    rmSync(zip, { force: true });
    execFileSync('zip', ['-qr9', zip, 'Roadster Rocket Sim-win32-x64'], { cwd: out });
    console.log('zip', zip, (readFileSync(zip).length / 1e6).toFixed(1), 'MB');
  }
}
