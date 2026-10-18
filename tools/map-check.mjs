// Headless safety net for the 2.5 maps (no browser, no Electron, no build needed).
// Loads a map, builds its terrain and world the same way the game does, then looks for crashes and
// broken layouts: missing teleports, things spawning inside walls, a blocked drag strip, NaNs, slow
// paved() checks, rings nobody can fly through, dummies that never appear, cars that fall through.
//
//   node tools/map-check.mjs              all new maps (moon, neon)
//   node tools/map-check.mjs moon         one map
//   node tools/map-check.mjs desert       the original map with the same rules (a baseline, not part of "all")
//   --no-drive                            skip the car / explosion simulations (faster)
//
// Every map runs in its own child process: colliders.js keeps one global grid, so two maps in one
// process would mix their colliders. A map that takes longer than MAP_CHECK_TIMEOUT seconds (default
// 300) to check is reported as an endless loop. Exit code 1 if anything FAILs.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const MAP_IDS = ['moon', 'neon'];
const KNOWN = [...MAP_IDS, 'desert'];
// part order used when a map has to be assembled from its parts (same order as src/maps/<id>.js)
const DEFAULT_PARTS = { moon: ['base', 'stunts', 'range', 'scenery'], neon: ['hq', 'garage', 'highway', 'yard', 'buildings', 'streets'] };
const DRAG = { x0: 90, x1: 720, z0: -168, z1: -132 };   // the strip must be flat, paved and free of colliders
const PLAY_R = 1300;                                    // teleports, pickups etc. must be inside this radius
const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('-'));
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

// ======================================================================================
// parent: one child process per map
// ======================================================================================
if (!flags.includes('--child')) {
  const want = args.find(a => !a.startsWith('-')) || 'all';
  const ids = want === 'all' ? MAP_IDS : [want];
  if (!ids.every(id => KNOWN.includes(id))) {
    console.error(`usage: node tools/map-check.mjs [${MAP_IDS.join('|')}|all|desert] [--no-drive]`);
    process.exit(2);
  }
  const timeout = Number(process.env.MAP_CHECK_TIMEOUT || 180) * 1000;
  const summary = [];
  for (const id of ids) {
    // fd 3 carries progress ("which part is building now"), so a hang can name the part that hung
    const r = spawnSync(process.execPath, [SELF, '--child', id, ...flags.filter(f => f !== '--child')], {
      stdio: ['inherit', 'inherit', 'inherit', 'pipe'], timeout, cwd: ROOT, maxBuffer: 64 << 20, env: { ...process.env, MAP_CHECK_FD: '3' },
    });
    const progress = r.output && r.output[3] ? String(r.output[3]).trim().split('\n').filter(Boolean) : [];
    const last = progress[progress.length - 1];
    let verdict;
    if (r.error && r.error.code === 'ETIMEDOUT') verdict = `FAIL (no answer after ${timeout / 1000} s, an endless loop? last activity: ${last || 'none'})`;
    else if (r.error) verdict = `FAIL (could not start the check: ${r.error.message})`;
    else if (r.status === 0) verdict = 'PASS';
    else if (r.status === 1) verdict = 'FAIL';
    else verdict = `FAIL (the check process died: ${r.signal || 'exit ' + r.status}; last activity: ${last || 'none'})`;
    summary.push([id, verdict]);
    if (verdict.startsWith('FAIL (')) console.log(`\n${paint('31;1', 'FAIL')}  ${id}: ${verdict.slice(6, -1)}`);
  }
  if (ids.length > 1) {
    console.log('\n=== map-check summary ===');
    for (const [id, v] of summary) console.log(`  ${v === 'PASS' ? paint('32;1', 'PASS') : paint('31;1', 'FAIL')}  ${id}${v.length > 4 ? '  ' + v.slice(5) : ''}`);
  }
  process.exit(summary.every(([, v]) => v === 'PASS') ? 0 : 1);
}

// ======================================================================================
// child: check one map
// ======================================================================================
const ID = args.find(a => !a.startsWith('-'));
const DESERT = ID === 'desert';
const DRIVE = !flags.includes('--no-drive');
Error.stackTraceLimit = 30;

// ---------- reporting ----------
const results = [];
const TAGS = { PASS: '32;1', WARN: '33;1', FAIL: '31;1', INFO: '36' };
const relPath = (s) => String(s).split(pathToFileURL(ROOT).href + '/').join('').split(ROOT + path.sep).join('');
function report(status, name, detail = '') {
  results.push({ status, name, detail });
  const lines = String(detail).split('\n');
  console.log(`  ${paint(TAGS[status], status)}  ${name}${lines[0] ? ': ' + lines[0] : ''}`);
  for (const l of lines.slice(1)) console.log(`          ${l}`);
}
const pass = (n, d) => report('PASS', n, d), warn = (n, d) => report('WARN', n, d), fail = (n, d) => report('FAIL', n, d), info = (n, d) => report('INFO', n, d);
const section = (t) => console.log(`\n-- ${t}`);
const f1 = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const fin = (...v) => v.every(Number.isFinite);
const finV = (p) => !!p && fin(p.x, p.y, p.z);
const list = (arr, n = 6) => arr.slice(0, n).join('\n') + (arr.length > n ? `\n... and ${arr.length - n} more` : '');
function fmtErr(e, max = 6) {
  if (e === null || e === undefined || typeof e !== 'object') return String(e);
  const lines = String(e.stack || `${e.name}: ${e.message}`).split('\n');
  const head = [], frames = [];
  for (const l of lines) { if (/^\s+at /.test(l)) frames.push(l.trim()); else if (!frames.length && l.trim()) head.push(l); }
  if (!head.some(l => l.includes(e.message))) head.push(`${e.name}: ${e.message}`);
  const keep = frames.filter(fr => !fr.includes('node:internal') && !fr.includes('map-check.mjs')).slice(0, max);
  return relPath([...head.slice(0, 6), ...keep.map(fr => '  ' + fr)].join('\n'));
}
// a step of the checker that crashes is reported, and the other checks still run
async function step(name, fn) {
  try { return await fn(); } catch (e) { fail(`${name} (crashed)`, fmtErr(e)); return undefined; }
}

// ---------- which map part is running? (from the call stack) ----------
const PART_RE = DESERT ? /at World\.(build\w+)/ : new RegExp(`src[\\\\/]maps[\\\\/]${ID}[\\\\/]([\\w-]+)\\.js`);
const partInStack = (stack) => { const m = PART_RE.exec(String(stack || '')); return m ? m[1] : null; };
function callerPart() {
  const o = {};
  Error.captureStackTrace(o, callerPart);
  return partInStack(o.stack) || 'engine';
}

// ---------- what node lacks: document, canvas 2D, Image ----------
const canvases = [];
function noop() {}
function makeCtx(canvas) {
  const grad = { addColorStop: noop };
  const img = (w, h) => {
    if (w && typeof w === 'object') { h = w.height; w = w.width; }
    w = Math.max(1, Math.floor(Math.abs(w) || 1)); h = Math.max(1, Math.floor(Math.abs(h) || 1));
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' };
  };
  const own = {
    canvas,
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
    createImageData: img, getImageData: (x, y, w, h) => img(w, h),
    createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad, createPattern: () => grad,
    getLineDash: () => [], isPointInPath: () => false, isPointInStroke: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, is2D: true, isIdentity: true }),
  };
  return new Proxy(own, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
}
function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), nodeName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], width: 300, height: 150,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    getContext() { return this._ctx || (this._ctx = makeCtx(this)); },
    toDataURL: () => 'data:,', toBlob: (cb) => cb && cb(null),
    addEventListener: noop, removeEventListener: noop, appendChild: (c) => c, removeChild: (c) => c, append: noop, remove: noop,
    setAttribute: noop, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 150, top: 0, left: 0, right: 300, bottom: 150 }),
  };
  if (el.tagName === 'CANVAS') canvases.push(el);
  return el;
}
function installStubs() {
  if (!globalThis.document) {
    globalThis.document = {
      createElement: makeElement, createElementNS: (ns, tag) => makeElement(tag), body: makeElement('body'), head: makeElement('head'), documentElement: makeElement('html'),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop,
      fonts: { load: async () => [], ready: Promise.resolve(), add: noop },
    };
  }
  if (!globalThis.Image) {
    globalThis.Image = class Image {
      constructor(w = 0, h = 0) { this.width = w; this.height = h; this.complete = false; this.onload = null; this.onerror = null; }
      addEventListener() {} removeEventListener() {} decode() { return Promise.resolve(); }
      set src(v) { this._src = v; } get src() { return this._src; }
    };
  }
  if (!globalThis.window) {   // a few browser globals a part might read while building (never used by node itself)
    globalThis.window = globalThis;
    for (const [k, v] of Object.entries({ devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener: noop, removeEventListener: noop, requestAnimationFrame: () => 0, cancelAnimationFrame: noop })) if (!(k in globalThis)) globalThis[k] = v;
  }
}

// ======================================================================================
const T0 = performance.now();
installStubs();
const THREE = await import('three');
const T = await import('../src/terrain.js');
const Cm = await import('../src/colliders.js');
const Y = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
let def = null, layout = null, partNames = [];

console.log(`\n=== map-check: ${ID} ===`);

// ---------- 1. the map definition ----------
section('Definition');
await step('definition', async () => {
  if (DESERT) { info('baseline', 'the original desert, checked with the 2.5 rules (it was never built to them, so some FAILs are expected)'); return; }
  const lp = `src/maps/${ID}/layout.js`;
  if (existsSync(path.join(ROOT, lp))) {
    try { layout = await import(`../${lp}`); } catch (e) { fail('layout loads', `${lp}\n${fmtErr(e)}`); }
  } else warn('layout', `${lp} is missing`);
  // part names and files, read from src/maps/<id>.js (falls back to the planned list)
  const file = `src/maps/${ID}.js`, abs = path.join(ROOT, file);
  partNames = (DEFAULT_PARTS[ID] || []).map(n => ({ alias: n, file: n }));
  if (existsSync(abs)) {
    const src = readFileSync(abs, 'utf8');
    const files = {};
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/[\w-]+\/([\w-]+)\.js['"]/g)) {
      const a = /\bbuild\s+as\s+(\w+)/.exec(m[1]); if (a) files[a[1]] = m[2]; else if (/\bbuild\b/.test(m[1])) files.build = m[2];
    }
    const pm = /const\s+PARTS\s*=\s*\{([^}]*)\}/.exec(src);
    if (pm) {
      const names = pm[1].split(',').map(s => s.trim()).filter(Boolean).map(s => { const [k, v] = s.split(':').map(x => x.trim()); return { alias: k, file: files[v || k] || k }; });
      if (names.length) partNames = names;
    }
    try {
      const m = await import(`../${file}`);
      def = m.default;
      if (!def || typeof def !== 'object') fail('definition loads', `${file} has no default export`);
      else pass('definition loads', `${file} (parts: ${partNames.map(p => p.file).join(', ')})`);
    } catch (e) {
      fail('definition loads', `${file} failed to import. The game would not start at all (main.js imports every map)\n${fmtErr(e)}`);
      def = null;
    }
  } else warn('definition file', `${file} is not written yet: assembling the map from its parts`);
  if (!def) def = await assemble();
  // maps/index.js: the game finds maps here
  const ip = 'src/maps/index.js';
  if (existsSync(path.join(ROOT, ip))) {
    try {
      const { MAPS } = await import(`../${ip}`);
      if (!MAPS || !MAPS[ID]) fail('listed in maps/index.js', `MAPS.${ID} is missing, so the map picker cannot offer it`);
      else if (!def.assembled && MAPS[ID] !== def) warn('listed in maps/index.js', `MAPS.${ID} is not the default export of src/maps/${ID}.js`);
      else pass('listed in maps/index.js');
    } catch (e) { fail('maps/index.js loads', `the game would not start at all\n${fmtErr(e)}`); }
  } else warn('maps/index.js', 'missing');
  // shape
  const need = ['height', 'paved', 'color', 'mapColor', 'build'];
  const missing = need.filter(k => typeof def[k] !== 'function');
  if (missing.length) fail('definition shape', `missing functions: ${missing.join(', ')}`);
  const shapeIssues = [];
  if (def.id !== ID) shapeIssues.push(`id is ${JSON.stringify(def.id)}, expected "${ID}"`);
  if (typeof def.name !== 'string' || !def.name) shapeIssues.push('no name');
  if (!def.zones || typeof def.zones !== 'object') shapeIssues.push('no zones');
  else if (!def.zones.hq) shapeIssues.push('zones has no "hq" (main.js uses ZONES.hq after a reset)');
  if (!Array.isArray(def.flats)) shapeIssues.push('flats is not an array');
  if (shapeIssues.length) fail('definition shape', shapeIssues.join('; '));
  else if (!missing.length) pass('definition shape', `${def.name}: ${Object.keys(def.zones).length} zones, ${def.flats.length} flats`);
  // env
  const env = def.env;
  if (!env || typeof env !== 'object') warn('env', 'no env object: the map gets the desert sky and gravity');
  else {
    const g = env.gravity;
    if (g !== undefined && !(Number.isFinite(g) && g > 0 && g <= 2)) fail('env.gravity', `must be a number in 0..2, got ${g}`);
    else if (ID === 'moon' && !(g < 0.5)) warn('env.gravity', `the Moon should have low gravity (about 0.165), got ${g ?? 'none (Earth gravity)'}`);
    else pass('env', `gravity ${g ?? 1}; keys: ${Object.keys(env).join(', ')}`);
  }
  // dollSpots
  const ds = def.dollSpots;
  if (ds === undefined) warn('dollSpots', 'none: this map has no target dummies');
  else if (!Array.isArray(ds)) fail('dollSpots', 'is not an array (ragdolls.populate() would crash)');
  else {
    const bad = ds.filter(s => !Array.isArray(s) || !fin(s[0], s[1]));
    if (bad.length) fail('dollSpots format', `each spot must be [x, z] or [x, z, 'boss'] (populate() destructures arrays); bad: ${JSON.stringify(bad.slice(0, 3))}`);
    else pass('dollSpots format', `${ds.length} spots${ds.some(s => s[2] === 'boss') ? ' incl. a boss' : ''}`);
  }
  // zones
  if (def.zones) {
    const zs = Object.entries(def.zones), issues = [];
    const names = zs.map(([, z]) => z && z.name);
    for (const [k, z] of zs) {
      if (!z || typeof z.name !== 'string') { issues.push(`${k}: no name`); continue; }
      if (!fin(z.x, z.z, z.r) || z.r <= 0) issues.push(`${k}: bad x/z/r`);
      else if (Math.hypot(z.x, z.z) > PLAY_R) issues.push(`${k}: centre outside r ${PLAY_R}`);
      if (names.filter(n => n === z.name).length > 1) issues.push(`${k}: name "${z.name}" used twice`);
    }
    if (issues.length) fail('zones', issues.join('; ')); else pass('zones', zs.map(([, z]) => z.name).join(', '));
  }
});

async function assemble() {
  const dir = `src/maps/${ID}`;
  const parts = []; let dollSpots, terr = null;
  const tp = `${dir}/terrain.js`;
  if (existsSync(path.join(ROOT, tp))) { try { terr = await import(`../${tp}`); } catch (e) { fail('part terrain imports', fmtErr(e)); } }
  else fail('part file missing', tp);
  for (const { alias, file } of partNames) {
    const rel = `${dir}/${file}.js`;
    if (!existsSync(path.join(ROOT, rel))) { fail('part file missing', rel); continue; }
    try {
      const m = await import(`../${rel}`);
      if (typeof m.build !== 'function') fail(`part ${file}`, 'has no build(world) export');
      else parts.push([alias, m.build]);
      if (m.dollSpots) dollSpots = m.dollSpots;
    } catch (e) { fail(`part ${file} imports`, fmtErr(e)); }
  }
  const t = terr || {};
  if (!terr) warn('terrain', 'no terrain part: using flat stand-in terrain so the other parts can still be checked');
  info('assembled', `built from ${parts.length} part(s) found on disk: ${parts.map(p => p[0]).join(', ') || 'none'}`);
  return {
    id: ID, name: `${ID} (assembled by map-check)`, assembled: true,
    zones: t.zones || (layout && layout.ZONES) || {}, flats: t.flats || (layout && layout.PADS) || [],
    height: t.height || (() => 0), paved: t.paved || (() => true),
    color: t.color || ((x, z, h, out) => { if (out && out.setRGB) out.setRGB(0.3, 0.3, 0.3); return out; }),
    mapColor: t.mapColor || (() => [90, 90, 90]), env: t.env || {}, dollSpots,
    build(world) { for (const [name, fn] of parts) { try { fn(world); } catch (e) { console.warn(`${ID}/${name}`, e); } } },
  };
}

// ---------- 2. terrain ----------
section('Terrain');
let pavedFn = T.isPaved;
await step('terrain setup', async () => {
  if (DESERT) return;
  // flat shapes must be ones sdfShape() understands, or they silently do nothing
  const bad = [];
  (def.flats || []).forEach((s, i) => {
    const ok = s && (s.type === 'circle' ? fin(s.cx, s.cz, s.r) : s.type === 'rect' ? fin(s.cx, s.cz, s.hw, s.hd) && (s.yaw === undefined || fin(s.yaw)) : s.type === 'seg' ? fin(s.ax, s.az, s.bx, s.bz, s.hw) : false);
    if (!ok || (s.blend !== undefined && !(s.blend > 0))) bad.push(`#${i} ${JSON.stringify(s)}`);
  });
  if (bad.length) fail('flat shapes', `type must be rect {cx,cz,hw,hd}, circle {cx,cz,r} or seg {ax,az,bx,bz,hw}, blend > 0:\n${list(bad, 4)}`);
  else pass('flat shapes', `${def.flats.length} valid`);
  if (typeof T.useMap !== 'function') { fail('useMap', 'src/terrain.js has no useMap(def): the terrain would stay the desert'); pavedFn = (x, z) => !!def.paved(x, z); return; }
  try { T.useMap(def); } catch (e) { fail('useMap(def) threw', fmtErr(e)); return; }
  const zk = Object.keys(T.ZONES).sort().join(), dk = Object.keys(def.zones || {}).sort().join();
  if (zk !== dk) fail('useMap', `terrain ZONES (${zk}) do not match the map zones (${dk}): the HUD would show the wrong zone names`);
  else pass('useMap', 'terrain switched to the map (zones, flats, height, paved, colours)');
});
await step('buildHeights', () => {
  const t0 = performance.now();
  try { T.buildHeights(); } catch (e) { fail('buildHeights() threw', fmtErr(e)); return; }
  const ms = performance.now() - t0;
  (ms > 4000 ? warn : info)('buildHeights', `${f1(ms, 0)} ms${ms > 4000 ? ' (slow: adds to the loading screen)' : ''}`);
});
await step('height grid', () => {
  let bad = 0, first = null, lo = Infinity, hi = -Infinity, plo = Infinity, phi = -Infinity;
  for (let z = -2000; z <= 2000; z += 4) for (let x = -2000; x <= 2000; x += 4) {
    const h = T.heightAt(x, z);
    if (!Number.isFinite(h)) { bad++; if (!first) first = `(${x}, ${z}) = ${h}`; continue; }
    if (h < lo) lo = h; if (h > hi) hi = h;
    if (x * x + z * z < PLAY_R * PLAY_R) { if (h < plo) plo = h; if (h > phi) phi = h; }
  }
  if (bad) fail('heightAt finite', `${bad} of 1M samples are not finite, first at ${first}`);
  else pass('heightAt finite', `1M samples; play area ${f1(plo)}..${f1(phi)} m, whole map ${f1(lo)}..${f1(hi)} m`);
  // steep spots in the play area (walls the car slides off; fine on crater rims, odd elsewhere)
  const nrm = new THREE.Vector3(), steep = [];
  for (let z = -1250; z <= 1250; z += 8) for (let x = -1250; x <= 1250; x += 8) {
    if (x * x + z * z > 1250 * 1250) continue;
    T.normalAt(x + 2, z + 5, nrm);
    if (nrm.y < 0.5) steep.push(`(${x}, ${z}) ${f1(Math.acos(Math.min(1, nrm.y)) * 180 / Math.PI, 0)}°`);
  }
  info('steep ground', steep.length ? `${steep.length} spots steeper than 60° in the play area, e.g. ${steep.slice(0, 4).join(', ')}` : 'nothing steeper than 60° in the play area');
});
await step('flats are flat', () => {
  if (DESERT) return;
  const off = [];
  (def.flats || []).forEach((s, i) => {
    const pts = s.type === 'circle' ? [[s.cx, s.cz], [s.cx + s.r * 0.9, s.cz], [s.cx, s.cz - s.r * 0.9]]
      : s.type === 'rect' ? [[0, 0], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]].map(([a, b]) => { const c = Math.cos(s.yaw || 0), sn = Math.sin(s.yaw || 0), lx = a * s.hw, lz = b * s.hd; return [s.cx + c * lx + sn * lz, s.cz - sn * lx + c * lz]; })
        : s.type === 'seg' ? [[s.ax, s.az], [(s.ax + s.bx) / 2, (s.az + s.bz) / 2], [s.bx, s.bz]] : [];
    for (const [x, z] of pts) { const h = T.heightAt(x, z); if (!(Math.abs(h) < 0.05)) { off.push(`#${i} ${s.type} at (${f1(x)}, ${f1(z)}): h = ${f1(h, 2)}`); break; } }
  });
  if (off.length) warn('flats are flat', list(off, 4)); else pass('flats are flat', 'every flat shape is at height 0');
});
await step('drag strip terrain', () => {
  let notFlat = 0, notPaved = 0, n = 0, worst = 0, wAt = '', pAt = '';
  const e = 0.05;   // a pad that ends exactly on the rectangle's edge counts (sdf = 0 there is "not paved")
  const xs = [], zs = [];
  for (let x = DRAG.x0; x <= DRAG.x1; x += 2) xs.push(Math.min(DRAG.x1 - e, Math.max(DRAG.x0 + e, x)));
  for (let z = DRAG.z0; z <= DRAG.z1; z += 2) zs.push(Math.min(DRAG.z1 - e, Math.max(DRAG.z0 + e, z)));
  for (const x of xs) for (const z of zs) {
    n++;
    const h = T.heightAt(x, z);
    if (!(Math.abs(h) < 0.05)) { notFlat++; if (!(Math.abs(h) <= Math.abs(worst))) { worst = h; wAt = `(${x}, ${z})`; } }
    if (!pavedFn(x, z)) { notPaved++; if (!pAt) pAt = `(${x}, ${z})`; }
  }
  const where = `x ${DRAG.x0}..${DRAG.x1}, z ${DRAG.z0}..${DRAG.z1}`;
  if (notFlat) fail('drag strip flat', `${notFlat}/${n} samples off by more than 5 cm, worst ${f1(worst, 2)} m at ${wAt}`);
  else pass('drag strip flat', where);
  if (notPaved) fail('drag strip paved', `${notPaved}/${n} samples not paved, first at ${pAt}`);
  else pass('drag strip paved', where);
});
await step('HQ terrain', () => {
  let worst = 0, at = '';
  for (let z = -20; z <= 20; z++) for (let x = -20; x <= 20; x++) {
    if (x * x + z * z > 400) continue;
    const h = T.heightAt(x, z);
    if (!(Math.abs(h) <= Math.abs(worst))) { worst = h; at = `(${x}, ${z})`; }
  }
  if (!(Math.abs(worst) < 0.05)) fail('HQ flat', `ground within 20 m of (0, 0) is off by ${f1(worst, 2)} m at ${at}`);
  else pass('HQ flat', 'within 20 m of (0, 0)');
  if (!pavedFn(0, 0)) warn('HQ paved', '(0, 0) is not paved (low grip on the air pad)');
});
await step('paved() speed', () => {
  const N = 100000, xs = new Float64Array(N), zs = new Float64Array(N);
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) { xs[i] = (rnd() - 0.5) * 3000; zs[i] = (rnd() - 0.5) * 3000; }
  const fn = pavedFn;
  let yes = 0, nonBool = 0;
  for (let i = 0; i < 20000; i++) { const v = fn(xs[i], zs[i]); if (typeof v !== 'boolean') nonBool++; }
  let best = Infinity;
  for (let r = 0; r < 3; r++) {
    let c = 0; const t0 = performance.now();
    for (let i = 0; i < N; i++) if (fn(xs[i], zs[i])) c++;
    best = Math.min(best, performance.now() - t0); yes = c;
  }
  const msg = `${f1(best, 1)} ms for 100k calls (best of 3; ${f1(yes / N * 100, 0)}% of the map paved)`;
  if (best >= 50) fail('paved() speed', `${msg}: too slow, it runs for every wheel every physics step`); else pass('paved() speed', msg);
  if (nonBool) warn('paved() result', `${nonBool}/20000 calls returned a non-boolean`);
});
await step('terrain colours', () => {
  if (!DESERT) {
    // minimap colour: terrain.js destructures [r, g, b], so anything that is not an array crashes the loading screen
    const bad = [];
    for (let z = -1500; z <= 1500; z += 25) for (let x = -1500; x <= 1500; x += 25) {
      const h = T.heightAt(x, z);
      let v; try { v = def.mapColor(x, z, h); } catch (e) { bad.push(`(${x}, ${z}) threw ${e.message}`); continue; }
      if (!v || typeof v[Symbol.iterator] !== 'function') { bad.push(`(${x}, ${z}) returned ${JSON.stringify(v)}`); continue; }
      const [r, g, b] = v;
      if (!fin(r, g, b)) bad.push(`(${x}, ${z}) returned ${JSON.stringify(v)}`);
    }
    if (bad.length) fail('mapColor()', `must return [r, g, b] numbers:\n${list(bad, 3)}`); else pass('mapColor()', '[r, g, b] everywhere');
  }
  let t0 = performance.now(), mesh;
  try { mesh = T.buildTerrainMesh(); } catch (e) { fail('buildTerrainMesh() threw (terrain colours)', fmtErr(e)); }
  const msMesh = performance.now() - t0;
  if (mesh) {
    let n = 0, bad = 0, sum = 0, first = '';
    mesh.traverse(o => {
      const c = o.geometry && o.geometry.getAttribute('color'), p = o.geometry && o.geometry.getAttribute('position');
      if (!c) return;
      for (let i = 0; i < c.array.length; i += 3) {
        const r = c.array[i], g = c.array[i + 1], b = c.array[i + 2];
        n++;
        if (!(r >= 0 && g >= 0 && b >= 0 && r <= 4 && g <= 4 && b <= 4)) { bad++; if (!first) first = `vertex at (${f1(p.array[i])}, ${f1(p.array[i + 2])}) = ${r}, ${g}, ${b}`; } else sum += r + g + b;
      }
    });
    if (bad) fail('terrain colour', `${bad}/${n} vertex colours are NaN or out of range, first ${first}`);
    else pass('terrain colour', `${n} vertices, average brightness ${f1(sum / n / 3, 3)}; built in ${f1(msMesh, 0)} ms`);
    if (msMesh > 4000) warn('terrain mesh speed', `${f1(msMesh, 0)} ms: color() is slow (it runs for ~150k vertices while loading)`);
    mesh.traverse(o => o.geometry && o.geometry.dispose());
  }
  t0 = performance.now();
  try { T.buildMapImage(512); pass('minimap image', `built in ${f1(performance.now() - t0, 0)} ms`); } catch (e) { fail('buildMapImage() threw (minimap)', fmtErr(e)); }
});

// ---------- 3. build the world ----------
section('World build');
const { World } = await import('../src/world.js');
const { Destruction } = await import('../src/destruction.js');
const scene = new THREE.Scene();
const partOf = new WeakMap();      // scene object / collider / pushed item -> part name
const origPush = Array.prototype.push;
{
  const add = scene.add;
  scene.add = function (...objs) { const p = callerPart(); for (const o of objs) if (o && typeof o === 'object' && !partOf.has(o)) partOf.set(o, p); return add.apply(this, objs); };
  Cm.colliders.push = function (...cs) { const p = callerPart(); for (const c of cs) if (c && typeof c === 'object') partOf.set(c, p); return origPush.apply(this, cs); };
}
let d = null, world = null, built = false;
const buildIssues = [];
await step('world', () => {
  d = new Destruction(scene);
  for (const k of ['structure', 'block', 'barrel', 'target', 'prop']) {
    const fn = d[k]; if (typeof fn !== 'function') continue;
    d[k] = function (...a) { const r = fn.apply(this, a); if (r && typeof r === 'object') partOf.set(r, callerPart()); return r; };
  }
  world = new World(scene, d);
  for (const k of ['teleports', 'rings', 'pickups', 'refuelPads', 'landingPads', 'anim']) {
    const a = world[k];
    if (Array.isArray(a)) a.push = function (...xs) { const p = callerPart(); for (const x of xs) if (x && (typeof x === 'object' || typeof x === 'function')) partOf.set(x, p); return origPush.apply(this, xs); };
  }
  if (!DESERT) world.map = def;
  const ow = console.warn, oe = console.error;
  console.warn = (...a) => buildIssues.push({ level: 'warn', a, part: callerPart() });
  console.error = (...a) => buildIssues.push({ level: 'error', a, part: callerPart() });
  const t0 = performance.now();
  try {
    const dispatches = /this\.map\b/.test(World.prototype.build.toString());
    if (DESERT || dispatches) world.build();
    else { ow('  (world.build() does not dispatch to world.map yet: calling def.build(world) directly)'); def.build(world); if (world.flushBatches) world.flushBatches(); }
    built = true;
  } catch (e) {
    console.warn = ow; console.error = oe;
    fail('world.build() threw', `the whole map failed to load${partInStack(e.stack) ? ` (in part ${partInStack(e.stack)})` : ''}\n${fmtErr(e)}`);
  }
  const msBuild = performance.now() - t0;
  try { d.finalize(); } catch (e) { console.warn = ow; console.error = oe; fail('destruction.finalize() threw', `${partInStack(e.stack) ? `part ${partInStack(e.stack)}: ` : ''}${fmtErr(e)}`); }
  console.warn = ow; console.error = oe;
  // errors that a part threw (src/maps/<id>.js catches them and console.warns, so the game keeps loading)
  const seen = new Map();
  for (const it of buildIssues) {
    const err = it.a.find(x => x && typeof x === 'object' && typeof x.message === 'string' && 'stack' in x);
    const label = typeof it.a[0] === 'string' && /^[\w-]+\/[\w-]+$/.test(it.a[0]) ? it.a[0].split('/')[1] : null;
    if (err) { const part = label || partInStack(err.stack) || it.part; fail(`part ${part} crashed while building`, `the rest of this part is missing in the game\n${fmtErr(err)}`); continue; }
    const text = it.a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (_) { return String(x); } })())).join(' ').slice(0, 300);
    const key = `${it.part}|${text}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, n] of seen) { const [part, text] = key.split(/\|(.*)/s); warn(`console.warn while building (${part})`, `${text}${n > 1 ? `  (x${n})` : ''}`); }
  if (built) (msBuild > 5000 ? warn : pass)('world.build()', `${f1(msBuild, 0)} ms${msBuild > 5000 ? ' (slow: adds to the loading screen)' : ''}`);
});
// per-part totals
const colPart = (c) => { const p = partOf.get(c); if (p && p !== 'engine') return p; const o = c && c.owner; return (o && partOf.get(o)) || p || '?'; };
await step('per-part totals', () => {
  if (!world) return;
  const per = new Map(), get = (p) => { if (!per.has(p)) per.set(p, { meshes: 0, tris: 0, cols: 0, blocks: 0, items: 0 }); return per.get(p); };
  for (const top of scene.children) {
    const p = partOf.get(top) || 'engine';
    top.traverse(o => { if (o.isMesh) { const s = get(p); s.meshes++; s.tris += triCount(o); } });
  }
  for (const c of Cm.colliders) get(colPart(c)).cols++;
  for (const b of d.blocks) get(partOf.get(b) || '?').blocks++;
  for (const k of ['teleports', 'rings', 'pickups', 'refuelPads']) for (const x of world[k] || []) get(partOf.get(x) || '?').items++;
  const names = DESERT ? [...per.keys()].filter(k => k.startsWith('build')) : partNames.map(p => p.file);
  for (const n of names) {
    const s = per.get(n);
    if (!s || (s.meshes === 0 && s.cols === 0 && s.blocks === 0 && s.items === 0)) warn(`part ${n}`, 'built nothing (missing, crashed at the start, or returned early)');
    else info(`part ${n}`, `${s.meshes} meshes, ${fmtK(s.tris)} triangles, ${s.cols} colliders, ${s.blocks} destructible blocks`);
  }
  const eng = per.get('engine');
  if (eng) info('engine (shared)', `${eng.meshes} meshes, ${fmtK(eng.tris)} triangles, ${eng.cols} colliders (world helpers, destruction pools)`);
});
function triCount(o) {
  const g = o.geometry; if (!g) return 0;
  const idx = g.index, pos = g.getAttribute && g.getAttribute('position');
  const t = idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
  return t * (o.isInstancedMesh ? o.count : 1);
}
function fmtK(n) { return n >= 1e6 ? `${f1(n / 1e6, 2)}M` : n >= 1e3 ? `${f1(n / 1e3, 1)}k` : String(Math.round(n)); }

// ---------- overlap queries (colliders.js grid + exact tests) ----------
function queryOBB(cx, cy, cz, hx, hy, hz, yaw = 0) {
  return new Cm.OBB(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromAxisAngle(Y, yaw), new THREE.Vector3(hx, hy, hz));
}
const _t = new THREE.Vector3(), _L = new THREE.Vector3();
function satDepth(a, b) {   // OBB vs OBB: penetration depth (0 = apart)
  const A = [a.ax, a.ay, a.az], B = [b.ax, b.ay, b.az], ha = [a.h.x, a.h.y, a.h.z], hb = [b.h.x, b.h.y, b.h.z];
  _t.subVectors(b.c, a.c);
  const axes = [...A, ...B];
  for (const u of A) for (const v of B) { const c = new THREE.Vector3().crossVectors(u, v); if (c.lengthSq() > 1e-8) axes.push(c.normalize()); }
  let depth = Infinity;
  for (const L of axes) {
    const ra = ha[0] * Math.abs(A[0].dot(L)) + ha[1] * Math.abs(A[1].dot(L)) + ha[2] * Math.abs(A[2].dot(L));
    const rb = hb[0] * Math.abs(B[0].dot(L)) + hb[1] * Math.abs(B[1].dot(L)) + hb[2] * Math.abs(B[2].dot(L));
    const pen = ra + rb - Math.abs(_t.dot(L));
    if (pen <= 0.02) return 0;
    if (pen < depth) depth = pen;
  }
  return depth;
}
function sampleDepth(q, c) {   // wedge / curve / anything with penetrate(): sample points inside the query box
  if (typeof c.penetrate !== 'function') return 0.1;
  const out = { nx: 0, ny: 0, nz: 0 }, p = new THREE.Vector3();
  const n = [q.h.x, q.h.y, q.h.z].map(h => Math.max(2, Math.ceil(h * 2 / 0.35)));
  let best = 0;
  for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) {
    const lx = -q.h.x + (i + 0.5) * 2 * q.h.x / n[0], ly = -q.h.y + (j + 0.5) * 2 * q.h.y / n[1], lz = -q.h.z + (k + 0.5) * 2 * q.h.z / n[2];
    p.copy(q.c).addScaledVector(q.ax, lx).addScaledVector(q.ay, ly).addScaledVector(q.az, lz);
    const dd = c.penetrate(p, out); if (dd > best) best = dd;
  }
  return best > 0.02 ? best : 0;
}
function overlaps(q, skip) {
  const near = Cm.queryBox(q.min.x, q.min.z, q.max.x, q.max.z).slice();
  const out = [];
  for (const c of near) {
    if (skip && skip(c)) continue;
    if (!(c.min.x < q.max.x && c.max.x > q.min.x && c.min.z < q.max.z && c.max.z > q.min.z && c.min.y < q.max.y && c.max.y > q.min.y)) continue;
    const depth = c.kind === 'obb' ? satDepth(q, c) : sampleDepth(q, c);
    if (depth > 0) out.push({ c, depth });
  }
  return out;
}
function descCol(c) {
  const cx = (c.min.x + c.max.x) / 2, cy = (c.min.y + c.max.y) / 2, cz = (c.min.z + c.max.z) / 2;
  const o = c.owner && c.owner.type ? ` (destructible ${c.owner.type})` : '';
  return `${colPart(c)}: ${c.kind}${o} at (${f1(cx)}, ${f1(cy)}, ${f1(cz)}) size ${f1(c.max.x - c.min.x)} x ${f1(c.max.y - c.min.y)} x ${f1(c.max.z - c.min.z)}`;
}
const _hit = Cm.makeHit();
function surfaceBelow(x, y, z) { return Cm.raycast(new THREE.Vector3(x, y, z), DOWN, Math.max(5, y - T.heightAt(x, z) + 5), _hit) ? _hit.point.y : T.heightAt(x, z); }
// a car-sized box resting on the ground at (x, ground, z)
const carBox = (x, ground, z, yaw = 0, round = false) => (round ? queryOBB(x, ground + 0.95, z, 2.3, 0.6, 2.3) : queryOBB(x, ground + 0.95, z, 1.05, 0.6, 2.35, yaw));

// ---------- 4. teleports ----------
section('Teleports');
const zoneByName = new Map(Object.values((DESERT ? T.ZONES : def.zones) || {}).filter(z => z && z.name).map(z => [z.name, z]));
let sortedTp = [];
await step('teleports', () => {
  if (!world) return;
  const tps = world.teleports || [];
  sortedTp = tps.slice().sort((a, b) => (a.key || 99) - (b.key || 99));
  const keyIssues = [];
  for (let k = 1; k <= 8; k++) {
    const n = tps.filter(t => t.key === k).length;
    if (n === 0) keyIssues.push(`key ${k} missing`); else if (n > 1) keyIssues.push(`key ${k} used ${n} times`);
  }
  if (keyIssues.length) fail('teleport keys 1-8', keyIssues.join(', ')); else pass('teleport keys 1-8', 'all present, each once');
  const extra = tps.filter(t => !(t.key >= 1 && t.key <= 8));
  if (extra.length) warn('extra teleports', extra.map(t => `key ${t.key} "${t.name}"${t.key === 0 ? ' (0 opens the Good Luck menu, never teleports)' : ''}`).join(', '));
  if (sortedTp[0] && sortedTp[0].key !== 1) fail('start spawn', `the game starts at teleports[0] after sorting, which is key ${sortedTp[0].key} "${sortedTp[0].name}"`);
  const KEYS = layout && layout.KEYS;
  for (const t of tps) {
    const tag = `teleport ${t.key} "${t.name}"`, part = partOf.get(t) || '?';
    const problems = [], notes = [];
    if (!zoneByName.has(t.name)) problems.push(`name is not a zone name (zones: ${[...zoneByName.keys()].join(', ')})`);
    if (!fin(t.x, t.z, t.yaw)) problems.push(`position/yaw not finite: x ${t.x}, z ${t.z}, yaw ${t.yaw}`);
    else if (Math.hypot(t.x, t.z) > PLAY_R) problems.push(`outside r ${PLAY_R} (r = ${f1(Math.hypot(t.x, t.z), 0)})`);
    if (problems.length) { fail(tag, `(${part}) ${problems.join('; ')}`); continue; }
    if (KEYS && def.zones && KEYS[t.key] && def.zones[KEYS[t.key]] && def.zones[KEYS[t.key]].name !== t.name) notes.push(`layout.js says key ${t.key} is "${def.zones[KEYS[t.key]].name}"`);
    const z = zoneByName.get(t.name);
    if (z && Math.hypot(t.x - z.x, t.z - z.z) > z.r) notes.push(`${f1(Math.hypot(t.x - z.x, t.z - z.z), 0)} m from its zone centre (zone r ${z.r})`);
    const g = T.heightAt(t.x, t.z), nrm = T.normalAt(t.x, t.z, new THREE.Vector3());
    if (nrm.y < 0.94) notes.push(`ground slopes ${f1(Math.acos(nrm.y) * 180 / Math.PI, 0)}°`);
    // the car spawns at terrain height + 0.6 (main.js spawnAt), facing yaw
    const hits = overlaps(carBox(t.x, g, t.z, t.yaw));
    if (hits.length) { fail(`${tag} spawn blocked`, `(${part}) the car would spawn inside:\n${list(hits.map(h => descCol(h.c) + `, ${f1(h.depth, 2)} m deep`), 4)}`); continue; }
    const above = surfaceBelow(t.x, g + 60, t.z);
    if (above > g + 2.5) notes.push(`spawns under a structure (its top at ${f1(above - g)} m)`);
    if (notes.length) warn(tag, `(${part}) at (${f1(t.x)}, ${f1(t.z)}): ${notes.join('; ')}`);
    else pass(tag, `(${part}) at (${f1(t.x)}, ${f1(t.z)}), spawn clear`);
  }
  const unreached = [...zoneByName.keys()].filter(n => !tps.some(t => t.name === n));
  if (unreached.length) warn('zones without a teleport', unreached.join(', '));
});

// ---------- 5. pads, pickups, rings ----------
section('Pads, pickups, rings');
await step('refuel pads', () => {
  if (!world) return;
  const pads = world.refuelPads || [];
  const hq = pads.filter(p => p.name === 'HQ');
  if (hq.length !== 1) fail('HQ air pad', `${hq.length} refuel pads are named 'HQ' (need exactly one: it also repairs the car)`);
  else if (!(Math.hypot(hq[0].x, hq[0].z) < 0.5)) fail('HQ air pad', `is at (${f1(hq[0].x)}, ${f1(hq[0].z)}), expected (0, 0)`);
  else pass('HQ air pad', `at (0, 0), r ${hq[0].r}`);
  const bad = [];
  for (const p of pads) {
    const part = partOf.get(p) || '?';
    if (!fin(p.x, p.y, p.z, p.r) || p.r <= 1) { bad.push(`"${p.name}" (${part}) bad x/y/z/r`); continue; }
    if (Math.hypot(p.x, p.z) > PLAY_R + 100) bad.push(`"${p.name}" (${part}) outside the map`);
    const s = surfaceBelow(p.x, p.y + 2.5, p.z);
    if (Math.abs(s + 0.55 - p.y) > 2.5) bad.push(`"${p.name}" (${part}) at y ${f1(p.y)} but the surface under it is at ${f1(s)}: refuelling needs the car within 3 m of the pad height`);
    const hits = overlaps(carBox(p.x, s, p.z, 0, true));
    if (hits.length) bad.push(`"${p.name}" (${part}) is covered by ${descCol(hits[0].c)}`);
  }
  if (bad.length) fail('refuel pads usable', list(bad)); else pass('refuel pads usable', `${pads.length}: ${pads.map(p => p.name).join(', ')}`);
  if ((world.landingPads || []).length) info('landing pads', `${world.landingPads.length}: ${world.landingPads.map(p => p.name).join(', ')}`);
});
await step('pickups', () => {
  if (!world) return;
  const ps = world.pickups || [];
  if (!ps.length) { fail('weapon pickups', 'none: the rocket launcher cannot be picked up on this map'); return; }
  const bad = [];
  for (const p of ps) {
    const part = partOf.get(p) || '?', at = `(${f1(p.x)}, ${f1(p.z)}) (${part})`;
    if (!fin(p.x, p.y, p.z)) { bad.push(`${at}: x/y/z not finite`); continue; }
    if (Math.hypot(p.x, p.z) > PLAY_R) bad.push(`${at}: outside r ${PLAY_R}`);
    const s = surfaceBelow(p.x, p.y + 1, p.z);
    if (Math.abs(s + 0.55 - p.y) > 3.5) bad.push(`${at}: y ${f1(p.y)} is out of reach from the surface at ${f1(s)} (the car must get within 4 m)`);
    const hits = overlaps(carBox(p.x, s, p.z, 0, true));
    if (hits.length) bad.push(`${at}: covered by ${descCol(hits[0].c)}`);
  }
  if (bad.length) fail('weapon pickups', list(bad)); else pass('weapon pickups', `${ps.length}, all reachable`);
});
await step('rings', () => {
  if (!world) return;
  const rings = world.rings || [];
  if (!rings.length) { fail('rings', 'no rings: the ring course zone has nothing to fly through'); return; }
  const bad = [], soft = [];
  rings.forEach((r, i) => {
    const tag = `ring ${i + 1} (${partOf.get(r) || '?'})`;
    if (!finV(r.pos) || !finV(r.normal) || !(r.r > 0)) { bad.push(`${tag}: pos/normal/r not finite`); return; }
    if (!r.mat || !r.mat.emissive || typeof r.mat.emissive.set !== 'function') bad.push(`${tag}: mat.emissive is missing (main.js sets it every frame: crash)`);
    else if (typeof r.mat.emissiveIntensity !== 'number') bad.push(`${tag}: mat.emissiveIntensity is not a number`);
    const nl = Math.hypot(r.normal.x, r.normal.y, r.normal.z);
    if (nl < 0.5) bad.push(`${tag}: normal has length ${f1(nl, 2)} (the pass-through test can never fire)`);
    else if (Math.abs(nl - 1) > 0.01) soft.push(`${tag}: normal is not unit length (${f1(nl, 3)})`);
    if (r.index !== undefined && r.index !== i) soft.push(`${tag}: index ${r.index} but it is number ${i + 1} in world.rings`);
    if (Math.hypot(r.pos.x, r.pos.z) > PLAY_R) bad.push(`${tag}: outside r ${PLAY_R}`);
    const g = T.heightAt(r.pos.x, r.pos.z);
    if (r.pos.y < g) bad.push(`${tag}: centre is underground`); else if (r.pos.y - r.r < g) soft.push(`${tag}: dips into the ground`);
    if (overlaps(queryOBB(r.pos.x, r.pos.y, r.pos.z, 0.4, 0.4, 0.4)).length) bad.push(`${tag}: centre is inside ${descCol(overlaps(queryOBB(r.pos.x, r.pos.y, r.pos.z, 0.4, 0.4, 0.4))[0].c)}`);
    else {
      const n = new THREE.Vector3(r.normal.x, r.normal.y, r.normal.z).normalize();
      const u = Math.abs(n.y) < 0.9 ? new THREE.Vector3().crossVectors(n, Y).normalize() : new THREE.Vector3(1, 0, 0);
      const v = new THREE.Vector3().crossVectors(n, u);
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2, p = new THREE.Vector3(r.pos.x, r.pos.y, r.pos.z).addScaledVector(u, Math.cos(a) * r.r * 0.75).addScaledVector(v, Math.sin(a) * r.r * 0.75);
        const h = overlaps(queryOBB(p.x, p.y, p.z, 0.3, 0.3, 0.3));
        if (h.length) { soft.push(`${tag}: partly blocked by ${descCol(h[0].c)}`); break; }
      }
    }
    if (r.mesh && r.mesh.geometry && r.mesh.geometry.type === 'TorusGeometry') {
      const ax = new THREE.Vector3(0, 0, 1).applyQuaternion(r.mesh.getWorldQuaternion(new THREE.Quaternion()));
      const n = new THREE.Vector3(r.normal.x, r.normal.y, r.normal.z).normalize();
      if (Math.abs(ax.dot(n)) < 0.95) soft.push(`${tag}: the drawn ring faces a different way from its pass-through normal`);
    }
    if (i > 0 && finV(rings[i - 1].pos)) {
      const a = new THREE.Vector3().copy(rings[i - 1].pos), b = new THREE.Vector3().copy(r.pos), dir = b.clone().sub(a), dist = dir.length();
      if (dist > 600) soft.push(`${tag}: ${f1(dist, 0)} m after the previous ring (the course times out 60 s after a ring)`);
      if (dist > 1) {
        dir.normalize();
        if (Cm.raycast(a, dir, dist - rings[i - 1].r, _hit)) soft.push(`${tag}: the straight line from ring ${i} is blocked by ${_hit.col ? descCol(_hit.col) : 'terrain'} (fine if you are meant to fly around it)`);
      }
    }
  });
  if (bad.length) fail('rings valid', list(bad)); else pass('rings valid', `${rings.length} rings`);
  if (soft.length) warn('ring course', list(soft));
});

// ---------- 6. colliders ----------
section('Colliders');
await step('colliders', () => {
  if (!world) return;
  const all = Cm.colliders, kinds = {};
  for (const c of all) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  info('colliders added', `${all.length} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})`);
  const broken = [], huge = [], buried = [], far = [];
  const cells = new Map();
  for (const c of all) {
    const okBox = c.min && c.max && fin(c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z);
    const okKind = c.kind === 'obb' ? finV(c.h) && c.h.x > 0 && c.h.y > 0 && c.h.z > 0 : c.kind === 'wedge' ? c.L > 0 && c.H > 0 && c.hw > 0 : c.kind === 'curve' ? c.R > 0 && c.hw > 0 : typeof c.penetrate === 'function';
    if (!okBox || !okKind || !Number.isFinite(c.grip)) { broken.push(`${colPart(c)}: ${c.kind} with ${!okBox ? 'NaN bounds (it is silently missing from the grid)' : !okKind ? 'zero/NaN size' : 'NaN grip (physics NaN)'}`); continue; }
    const sx = c.max.x - c.min.x, sz = c.max.z - c.min.z, cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
    if (sx > 1500 || sz > 1500) huge.push(descCol(c));
    if (Math.hypot(cx, cz) > 1450) far.push(descCol(c));
    const g = Math.min(T.heightAt(cx, cz), T.heightAt(c.min.x, c.min.z), T.heightAt(c.max.x, c.max.z), T.heightAt(c.min.x, c.max.z), T.heightAt(c.max.x, c.min.z));
    if (c.max.y < g - 0.3) buried.push(descCol(c));
    const x0 = Math.floor(c.min.x / 10), x1 = Math.floor(c.max.x / 10), z0 = Math.floor(c.min.z / 10), z1 = Math.floor(c.max.z / 10);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) < 40000) for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const k = ix * 100000 + iz; cells.set(k, (cells.get(k) || 0) + 1); }
  }
  if (broken.length) fail('colliders valid', list(broken)); else pass('colliders valid', 'finite bounds, sizes and grip');
  if (huge.length) warn('huge colliders', list(huge, 3));
  if (buried.length) warn('colliders under the ground', `${buried.length} (useless, or placed at y = 0 on raised ground):\n${list(buried, 4)}`);
  if (far.length) warn('colliders outside the map', list(far, 3));
  let worst = 0, wk = 0; for (const [k, n] of cells) if (n > worst) { worst = n; wk = k; }
  const wx = Math.round(wk / 100000) * 10, wz = (wk - Math.round(wk / 100000) * 100000) * 10;
  (worst > 250 ? warn : info)('collider density', `busiest 10 m cell has ${worst} colliders, near (${wx}, ${wz})${worst > 250 ? ': physics queries there will be slow' : ''}`);
  // the drag strip must be free of colliders (start lights, signs etc. go beside it)
  const q = queryOBB((DRAG.x0 + DRAG.x1) / 2, 30, (DRAG.z0 + DRAG.z1) / 2, (DRAG.x1 - DRAG.x0) / 2, 35, (DRAG.z1 - DRAG.z0) / 2);
  const inStrip = overlaps(q);
  if (inStrip.length) fail('drag strip clear', `${inStrip.length} collider(s) inside x ${DRAG.x0}..${DRAG.x1}, z ${DRAG.z0}..${DRAG.z1}:\n${list(inStrip.map(h => descCol(h.c)), 8)}`);
  else pass('drag strip clear', 'no colliders in the strip rectangle');
});

// ---------- 7. scene ----------
section('Scene');
await step('scene', () => {
  if (!world) return;
  scene.updateMatrixWorld(true);
  let meshes = 0, instanced = 0, tris = 0, other = 0;
  const lights = [], geos = new Map(), mats = new Set(), noMat = [], noGeo = [], nanMat = [], nanInst = [], far = [], buried = [];
  const topPart = new Map();
  for (const top of scene.children) { const p = partOf.get(top) || 'engine'; top.traverse(o => topPart.set(o, p)); }
  const box = new THREE.Box3(), e = new THREE.Matrix4();
  scene.traverse(o => {
    const part = topPart.get(o) || 'engine', name = `${part}: ${o.type}${o.name ? ` "${o.name}"` : ''}`;
    if (o.isLight) { lights.push([o, part]); return; }
    if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
    if (o.isMesh) meshes++; else other++;
    if (!o.matrixWorld.elements.every(Number.isFinite)) nanMat.push(name);
    const m = o.material;
    if (!m || (Array.isArray(m) && (m.length === 0 || m.some(x => !x)))) noMat.push(name); else (Array.isArray(m) ? m : [m]).forEach(x => mats.add(x));
    const g = o.geometry;
    if (!o.isSprite && (!g || !g.getAttribute || !g.getAttribute('position'))) { noGeo.push(name); return; }
    if (g && !geos.has(g)) geos.set(g, name);
    if (o.isMesh) tris += triCount(o);
    if (o.isInstancedMesh) {
      instanced++;
      if (o.count > o.instanceMatrix.count) nanInst.push(`${name}: count ${o.count} > capacity ${o.instanceMatrix.count}`);
      else { const a = o.instanceMatrix.array; for (let i = 0; i < o.count * 16; i++) if (!Number.isFinite(a[i])) { nanInst.push(`${name}: instance ${Math.floor(i / 16)} has a NaN matrix`); break; } }
      return;
    }
    const wx = o.matrixWorld.elements[12], wz = o.matrixWorld.elements[14];
    if (Math.abs(wx) > 2000 || Math.abs(wz) > 2000) far.push(`${name} at (${f1(wx, 0)}, ${f1(wz, 0)})`);
    if (o.isMesh && g && g.getAttribute('position')) {
      if (!g.boundingBox) g.computeBoundingBox();
      box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      if (fin(box.min.x, box.max.x, box.max.y, box.min.z, box.max.z) && box.max.x - box.min.x < 300 && box.max.z - box.min.z < 300) {
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        const gmin = Math.min(T.heightAt(cx, cz), T.heightAt(box.min.x, box.min.z), T.heightAt(box.max.x, box.max.z), T.heightAt(box.min.x, box.max.z), T.heightAt(box.max.x, box.min.z));
        if (box.max.y < gmin - 0.25) buried.push(`${name} top at ${f1(box.max.y)}, ground ${f1(gmin)} near (${f1(cx, 0)}, ${f1(cz, 0)})`);
      }
    }
  });
  // geometry contents: NaN vertices or indices past the end break the renderer
  const badGeo = [];
  let verts = 0;
  for (const [g, name] of geos) {
    const p = g.getAttribute('position'); if (!p) continue;
    verts += p.count;
    let nan = false;
    if (p.isInterleavedBufferAttribute) { for (let i = 0; i < p.count && !nan; i++) if (!fin(p.getX(i), p.getY(i), p.getZ(i))) nan = true; }
    else { const a = p.array; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { nan = true; break; } }
    if (nan) { badGeo.push(`${name}: NaN vertex positions`); continue; }
    if (g.index) { const ia = g.index.array; let mx = 0; for (let i = 0; i < ia.length; i++) if (ia[i] > mx) mx = ia[i]; if (mx >= p.count) badGeo.push(`${name}: index ${mx} past the last vertex (${p.count})`); }
  }
  if (noMat.length) fail('materials', `meshes without a material (crash when drawn):\n${list(noMat, 4)}`);
  if (noGeo.length) fail('geometry', `objects without geometry/positions (crash when drawn):\n${list(noGeo, 4)}`);
  if (badGeo.length) fail('geometry contents', list(badGeo, 5));
  if (nanMat.length) fail('object transforms', `NaN position/rotation/scale:\n${list(nanMat, 4)}`);
  if (nanInst.length) fail('instanced meshes', list(nanInst, 4));
  if (!noMat.length && !noGeo.length && !badGeo.length && !nanMat.length && !nanInst.length) pass('scene objects valid', `${geos.size} geometries (${fmtK(verts)} vertices), ${mats.size} materials`);
  const meshMsg = `${meshes} meshes (${instanced} instanced), ${other} lines/points/sprites, ${fmtK(tris)} triangles`;
  if (meshes > 3000) warn('mesh count', `${meshMsg}: over 3000 meshes means too many draw calls (merge or instance them)`);
  else pass('mesh count', meshMsg);
  if (tris > 4e6) warn('triangle count', `${fmtK(tris)} triangles is a lot for a laptop GPU`);
  const dyn = lights.filter(([l]) => l.isPointLight || l.isSpotLight || l.isRectAreaLight), shadow = lights.filter(([l]) => l.castShadow);
  const lmsg = `${lights.length} light(s) added by the map${lights.length ? ': ' + Object.entries(lights.reduce((a, [l, p]) => { const k = `${l.type} (${p})`; a[k] = (a[k] || 0) + 1; return a; }, {})).map(([k, n]) => `${n} ${k}`).join(', ') : ''}`;
  if (dyn.length > 6 || shadow.length) warn('lights', `${lmsg}. ${dyn.length > 6 ? 'Every point/spot light slows down every material; use emissive materials and bloom instead. ' : ''}${shadow.length ? `${shadow.length} cast shadows (very expensive).` : ''}`);
  else info('lights', lmsg);
  let px = 0; for (const c of canvases) px += (c.width || 0) * (c.height || 0);
  const mb = px * 4 * 1.33 / 1048576;
  (mb > 300 ? warn : info)('canvas textures', `${canvases.length} canvases, about ${f1(mb, 0)} MB of texture memory${mb > 300 ? ' (too much: reuse textures)' : ''}`);
  if (far.length) warn('objects outside the map', list(far, 3));
  if (buried.length) warn('meshes under the ground', `${buried.length} (placed at y = 0 on raised ground?):\n${list(buried, 4)}`);
});

// ---------- 8. destruction ----------
section('Destruction');
await step('destruction', () => {
  if (!d) return;
  const byMat = {}; for (const b of d.blocks) byMat[b.mat] = (byMat[b.mat] || 0) + 1;
  info('destruction stats', `${d.structures.length} structures, ${d.blocks.length} blocks (${Object.entries(byMat).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}), ${d.barrels.length} barrels, ${d.targets.length} targets, ${d.props.length} props, ${(d.glass && d.glass.panes && d.glass.panes.length) || 0} glass panes`);
  const bad = d.blocks.filter(b => !finV(b.pos) || !finV(b.half) || !(b.half.x > 0 && b.half.y > 0 && b.half.z > 0));
  if (bad.length) fail('blocks valid', `${bad.length} blocks with NaN/zero size or position, first from ${partOf.get(bad[0]) || '?'}`);
  const floating = d.blocks.filter(b => !b.grounded && b.neighbors && b.neighbors.length === 0);
  if (floating.length) warn('floating blocks', `${floating.length} blocks touch nothing and are not on the ground:\n${list(floating.map(b => `${partOf.get(b) || '?'}: ${b.mat} at (${f1(b.pos.x)}, ${f1(b.pos.y)}, ${f1(b.pos.z)})`), 4)}`);
  // block() puts a whole structure on the ground height at its centre: on slopes, edges float or sink
  const uneven = [];
  for (const s of d.structures) {
    const g0 = T.heightAt(s.cx, s.cz); let worst = 0;
    for (const b of s.blocks) if (b.grounded && b.col) for (const [x, z] of [[b.col.min.x, b.col.min.z], [b.col.max.x, b.col.max.z], [b.col.min.x, b.col.max.z], [b.col.max.x, b.col.min.z]]) worst = Math.max(worst, Math.abs(T.heightAt(x, z) - g0));
    if (worst > 0.6) uneven.push(`${partOf.get(s) || '?'}: structure at (${f1(s.cx)}, ${f1(s.cz)}) on ground that varies ${f1(worst)} m`);
  }
  if (uneven.length) warn('structures on uneven ground', list(uneven, 4));
  const bb = d.barrels.filter(b => !finV(b.pos)), bt = d.targets.filter(t => !t.col || !finV(t.col.c));
  if (bb.length || bt.length) fail('barrels/targets valid', `${bb.length} barrels, ${bt.length} targets with NaN positions`);
  if (!bad.length && !bb.length && !bt.length) pass('destructibles valid');
});

// ---------- 9. animation + dummies ----------
section('Animation and dummies');
await step('world.update', () => {
  if (!world) return;
  const anim = world.anim || [];
  const notFn = anim.filter(a => typeof a !== 'function');
  if (notFn.length) { fail('world.anim', `${notFn.length} entries are not functions (main.js calls each one every frame: crash)`); return; }
  for (const t of [0, 0.016, 0.5, 1.3, 2.7, 9.9, 61.7, 3600.25]) {
    try { world.update(t); } catch (e) { fail('world.update(t) threw', `every frame would crash${partInStack(e.stack) ? ` (part ${partInStack(e.stack)})` : ''}\n${fmtErr(e)}`); return; }
  }
  scene.updateMatrixWorld(true);
  let nan = 0; scene.traverse(o => { if (!o.matrixWorld.elements.every(Number.isFinite)) nan++; });
  if (nan) fail('animations', `${nan} objects have NaN transforms after world.update()`);
  else pass('world.update(t)', `${anim.length} animations ran`);
});
let ragdolls = null;
await step('dummies', async () => {
  if (!world) return;
  const { Ragdolls, setDollGravity } = await import('../src/ragdoll.js');
  const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any), apply: () => any });
  const fx = { smoke: { spawn: noop }, fire: { spawn: noop }, sparks: { spawn: noop }, debris: { spawn: noop }, blood: { spawn: noop }, explosion: noop };
  const g = (def && def.env && def.env.gravity) || 1;
  if (setDollGravity) setDollGravity(g);
  ragdolls = new Ragdolls(scene, new Proxy(fx, { get: (t, k) => (k in t ? t[k] : any) }), { blood: true });
  d.extraHit = (p, r) => ragdolls.hit(p, r);
  const spots = DESERT ? undefined : (def.dollSpots || []);
  if (DESERT) ragdolls.populate(); else ragdolls.populate(spots);
  const n = ragdolls.dolls.length;
  if (!DESERT) {
    const skipped = [];
    for (const s of spots) {
      if (!Array.isArray(s)) continue;
      const [x, z] = s;
      if (!fin(x, z)) continue;
      const near = Cm.queryBox(x - 1.4, z - 1.4, x + 1.4, z + 1.4).slice();
      if (!near.length) continue;
      const g0 = T.heightAt(x, z), hit = overlaps(queryOBB(x, g0 + 1, z, 0.5, 0.95, 0.5));
      skipped.push(`(${f1(x)}, ${f1(z)})${s[2] ? ' ' + s[2] : ''}: ${hit.length ? 'inside ' + descCol(hit[0].c) : `a collider shares its 10 m grid cell (${descCol(near[0])})`}`);
    }
    if (spots.length && !n) fail('dummies placed', `none of the ${spots.length} doll spots got a dummy (populate() skips any spot with a collider in the same 10 m grid cell):\n${list(skipped, 5)}`);
    else if (skipped.length) warn('dummies placed', `${n}/${spots.length}; populate() skipped ${skipped.length}:\n${list(skipped, 5)}`);
    else if (spots.length) pass('dummies placed', `${n}/${spots.length}`);
    const far = spots.filter(s => Array.isArray(s) && fin(s[0], s[1]) && Math.hypot(s[0], s[1]) > PLAY_R);
    if (far.length) fail('doll spots', `${far.length} outside r ${PLAY_R}`);
  } else info('dummies placed', `${n} (desert default spots)`);
  if (!n) return;
  for (let i = 0; i < 150; i++) ragdolls.update(1 / 60, null);
  const broken = ragdolls.dolls.filter(dl => !dl.p.every(finV));
  const moved = ragdolls.dolls.filter(dl => dl.p.every(finV) && dl.home && dl.stand && Math.hypot(dl.pelvis.x - dl.stand.position.x, dl.pelvis.z - dl.stand.position.z) > 1.5);
  if (broken.length) fail('dummies settle', `${broken.length} dummies went NaN after 2.5 s`);
  else if (moved.length) warn('dummies settle', `${moved.length} dummies left their stand without being hit (spawned inside something, or on a slope)`);
  else pass('dummies settle', `${n} dummies stand still for 2.5 s at gravity ${g}`);
});

// ---------- 10. driving ----------
if (DRIVE) {
  section('Driving');
  await step('driving', async () => {
    if (!world || !sortedTp.length) return;
    const { Vehicle } = await import('../src/vehicle.js');
    const { TRIMS, PHYS, MPH } = await import('../src/config.js');
    const DT = PHYS.DT, g = (def && def.env && def.env.gravity) || 1;
    const blank = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: false, descend: false, roll: 0 });
    const mk = (trim, x, z, yaw) => {
      const v = new Vehicle(); v.mapG = g; v.setTrim(TRIMS[trim] || TRIMS.rocket); v.sandbox = true;
      v.reset(new THREE.Vector3(x, T.heightAt(x, z) + 0.6, z), yaw);
      return v;
    };
    const finite = (v) => fin(v.pos.x, v.pos.y, v.pos.z, v.vel.x, v.vel.y, v.vel.z, v.quat.w);
    const settleT = Math.min(4, 1.5 / Math.sqrt(g));
    for (const tp of sortedTp.filter(t => t.key >= 1 && t.key <= 8 && fin(t.x, t.z, t.yaw))) {
      const tag = `car at teleport ${tp.key} "${tp.name}"`;
      const v = mk('rocket', tp.x, tp.z, tp.yaw), inp = blank();
      for (let t = 0; t < settleT; t += DT) v.step(DT, inp);
      if (!finite(v)) { fail(tag, 'the car went NaN while standing still'); continue; }
      const g0 = T.heightAt(v.pos.x, v.pos.z), drift = Math.hypot(v.pos.x - tp.x, v.pos.z - tp.z);
      if (v.pos.y < g0 - 2) { fail(tag, `the car fell through the ground (y ${f1(v.pos.y)}, ground ${f1(g0)})`); continue; }
      const notes = [];
      if (v.contacts < 3) notes.push(`only ${v.contacts} wheels on the ground after ${f1(settleT)} s`);
      if (v.up.y < 0.85) notes.push(`tilted ${f1(Math.acos(Math.max(-1, Math.min(1, v.up.y))) * 180 / Math.PI, 0)}°`);
      if (drift > 3) notes.push(`slid ${f1(drift)} m`);
      if (v.pos.y > g0 + 3) notes.push(`resting ${f1(v.pos.y - g0)} m above the ground (on top of something?)`);
      inp.throttle = 1;
      const p0 = v.pos.clone();
      for (let t = 0; t < 3; t += DT) v.step(DT, inp);
      if (!finite(v)) { fail(tag, 'the car went NaN when driving off'); continue; }
      const moved = Math.hypot(v.pos.x - p0.x, v.pos.z - p0.z);
      if (moved < 8) notes.push(`only moved ${f1(moved)} m in 3 s at full throttle (facing a wall?)`);
      if (notes.length) warn(tag, notes.join('; ')); else pass(tag, `settles, drives off (${f1(moved, 0)} m in 3 s)`);
    }
    // a quarter mile down the drag strip from teleport 2
    const tp = sortedTp.find(t => t.key === 2);
    if (tp && fin(tp.x, tp.z, tp.yaw)) {
      const inStrip = tp.x >= DRAG.x0 && tp.x <= DRAG.x1 && tp.z >= DRAG.z0 && tp.z <= DRAG.z1;
      if (!inStrip) warn('drag start', `teleport 2 (${f1(tp.x)}, ${f1(tp.z)}) is not on the strip`);
      else if (Math.sin(tp.yaw) < 0.9) warn('drag start', `teleport 2 faces yaw ${f1(tp.yaw, 2)}, not down the strip (+x, yaw ${f1(Math.PI / 2, 2)})`);
      const v = mk('performance', tp.x, tp.z, tp.yaw), inp = blank();
      for (let t = 0; t < settleT; t += DT) v.step(DT, inp);
      inp.throttle = 1;
      const x0 = v.pos.x; let t = 0, tq = null, zmin = Infinity, zmax = -Infinity, prev = 0, bumps = 0, top = 0;
      while (t < 40 && tq === null) {
        v.step(DT, inp); t += DT;
        if (!finite(v)) break;
        zmin = Math.min(zmin, v.pos.z); zmax = Math.max(zmax, v.pos.z);
        const sp = v.vel.length(); top = Math.max(top, sp);
        if (prev - sp > 2.5 * DT * 60 && t > 1) bumps++;
        prev = sp;
        if (v.pos.x - x0 >= 402.34) tq = t;
      }
      if (!finite(v)) fail('drag run', 'the car went NaN on the drag strip');
      else if (tq === null) warn('drag run', `did not cover a quarter mile in 40 s (got ${f1(v.pos.x - x0, 0)} m)`);
      else {
        const off = zmin < DRAG.z0 || zmax > DRAG.z1;
        const msg = `1/4 mile in ${f1(tq, 2)} s, ${f1(top * MPH, 0)} mph (performance trim, gravity ${g}), z ${f1(zmin)}..${f1(zmax)}`;
        if (off || bumps) warn('drag run', `${msg}${off ? '; drifted off the strip' : ''}${bumps ? `; ${bumps} sudden slow-downs (hit something?)` : ''}`);
        else pass('drag run', msg);
      }
    }
  });

  // ---------- 11. explosions ----------
  section('Explosions');
  await step('explosions', () => {
    if (!d) return;
    const targets = [];
    for (const s of d.structures.slice(0, 3)) targets.push(new THREE.Vector3(s.cx, T.heightAt(s.cx, s.cz) + 1.5, s.cz));
    if (d.barrels[0]) targets.push(d.barrels[0].pos.clone());
    if (d.targets[0] && d.targets[0].col) targets.push(d.targets[0].col.c.clone());
    if (!targets.length) { info('explosions', 'nothing destructible on this map'); return; }
    let n = 0;
    for (const p of targets) n += d.explode(p, 7, 1.2) || 0;
    for (let i = 0; i < 180; i++) { d.step(1 / 60); if (ragdolls) ragdolls.update(1 / 60, null); }
    d.sync();
    const nan = d.bodies.filter(b => b.alive && !finV(b.pos));
    if (nan.length) { fail('explosions', `${nan.length} debris bodies went NaN`); return; }
    d.rebuild();
    pass('explosions', `${targets.length} blasts broke ${n} blocks, 3 s of debris, then rebuilt (Backspace) without errors`);
  });
}

// ---------- recap ----------
const count = (s) => results.filter(r => r.status === s).length;
const failed = count('FAIL');
console.log(`\n== ${ID}: ${count('PASS')} PASS, ${count('WARN')} WARN, ${failed} FAIL  =>  ${failed ? paint('31;1', 'FAIL') : paint('32;1', 'PASS')}  (${f1((performance.now() - T0) / 1000, 1)} s)`);
for (const r of results.filter(x => x.status === 'FAIL' || x.status === 'WARN')) console.log(`   ${paint(TAGS[r.status], r.status)}  ${r.name}${r.detail ? ': ' + String(r.detail).split('\n')[0] : ''}`);
process.exit(failed ? 1 : 0);
