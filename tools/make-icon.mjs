// Renders the app icon (PNG sizes) in Chromium and writes desktop/icon.ico.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const pngs = await page.evaluate(async () => {
  const draw = (S) => {
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); const k = S / 256;
    g.scale(k, k);
    const bg = g.createLinearGradient(0, 0, 0, 256); bg.addColorStop(0, '#1b2430'); bg.addColorStop(1, '#07090b');
    g.fillStyle = bg; g.beginPath(); g.roundRect(8, 8, 240, 240, 52); g.fill();
    // thruster plumes
    for (const x of [78, 178]) { const pg = g.createLinearGradient(0, 150, 0, 236); pg.addColorStop(0, 'rgba(127,227,255,.95)'); pg.addColorStop(1, 'rgba(127,227,255,0)'); g.fillStyle = pg; g.beginPath(); g.moveTo(x - 16, 150); g.lineTo(x + 16, 150); g.lineTo(x + 6, 236); g.lineTo(x - 6, 236); g.fill(); }
    // car side silhouette
    g.fillStyle = '#d0212b';
    g.beginPath(); g.moveTo(28, 150); g.bezierCurveTo(30, 128, 60, 118, 92, 112); g.bezierCurveTo(112, 84, 160, 80, 186, 104); g.bezierCurveTo(212, 108, 232, 118, 230, 150); g.closePath(); g.fill();
    g.fillStyle = '#0b1016'; g.beginPath(); g.moveTo(104, 110); g.bezierCurveTo(122, 90, 158, 88, 176, 106); g.closePath(); g.fill();
    g.fillStyle = '#0b0d10'; for (const x of [78, 178]) { g.beginPath(); g.arc(x, 150, 22, 0, 7); g.fill(); }
    g.fillStyle = '#c7ccd2'; for (const x of [78, 178]) { g.beginPath(); g.arc(x, 150, 11, 0, 7); g.fill(); }
    g.fillStyle = '#e8f4ff'; g.fillRect(34, 128, 18, 4);
    return c.toDataURL('image/png').split(',')[1];
  };
  return [256, 64, 48, 32, 16].map(draw);
});
await browser.close();
// ICO container with embedded PNGs
const bufs = pngs.map(b => Buffer.from(b, 'base64'));
const sizes = [256, 64, 48, 32, 16];
const header = Buffer.alloc(6 + 16 * bufs.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(bufs.length, 4);
let off = header.length;
bufs.forEach((b, i) => { const e = 6 + i * 16; const s = sizes[i] === 256 ? 0 : sizes[i]; header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3); header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6); header.writeUInt32LE(b.length, e + 8); header.writeUInt32LE(off, e + 12); off += b.length; });
writeFileSync(new URL('../desktop/icon.ico', import.meta.url), Buffer.concat([header, ...bufs]));
writeFileSync(new URL('../desktop/icon.png', import.meta.url), bufs[0]);
console.log('icon written');
