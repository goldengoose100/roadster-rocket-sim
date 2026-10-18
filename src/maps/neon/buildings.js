// Neon City skyline (buildings.js): every city block that is not RESERVED gets 1-4 buildings with lit
// windows (deterministic from the block position, no Math.random), taller toward the centre, plus a
// few landmark towers, rooftop details (water tanks, AC units, blinking antennas, helipads), neon edge
// strips, vertical blade signs and rooftop billboards. Partly reserved blocks (the drag avenue row) are
// built only in the parts that stay clear of the reserved rectangle.
// Visuals are merged per material and chunk (~160 meshes in total, ~95k triangles); every building section
// and every rooftop prop the car can hit gets its own axis-aligned OBB collider.
import * as THREE from 'three';
import { addCollider, OBB, GRIP } from '../../colliders.js';
import { blocks, RESERVED, CITY } from './layout.js';

const FLOOR = 3.5;              // storey height (one window row)
const COLS = 32, ROWS = 32;     // window cells in the shared texture
const TEX = 1024, CELL = TEX / COLS;
const ROOF_U = (CELL / 2) / TEX, ROOF_V = 1 - (CELL / 2) / TEX;   // the plain roof swatch (cell 0,0)
const EDGE = 5;                 // sidewalk: keep 5 m between the block edge and any building
const GAP = 0.5;                // clearance to RESERVED rectangles
const ALLEY = 4;                // gap between buildings in a block
const CHUNKS = 4;               // facades merge per 350 m chunk (4 x 4), everything else per 700 m chunk (2 x 2)
const NEON = { pink: '#ff2bd6', cyan: '#3df2ff', purple: '#9b5cff', yellow: '#ffd23d' };
const NEON_KEYS = ['pink', 'cyan', 'purple', 'yellow'];
const WORDS = [['TURBO', 'yellow'], ['NOODLES', 'pink'], ['ARCADE', 'purple'], ['HOTEL', 'cyan'], ['SUSHI', 'pink'], ['CYBER', 'cyan'], ['24/7', 'yellow']];
const VWORDS = [['HOTEL', 'cyan'], ['SUSHI', 'pink'], ['ARCADE', 'purple'], ['NOODLES', 'yellow']];
// facade looks; all share ONE window texture (cw = window spacing in metres)
const FACADES = [
  { color: '#9aa3b5', emissive: '#ffffff', ei: 1.15, rough: 0.85, metal: 0.05, cw: 3 },   // grey concrete
  { color: '#b39482', emissive: '#fff1dc', ei: 1.05, rough: 0.9, metal: 0.0, cw: 3 },     // warm brick
  { color: '#7896c0', emissive: '#d8ecff', ei: 1.25, rough: 0.3, metal: 0.5, cw: 2 },     // blue glass
  { color: '#8d7cc0', emissive: '#efe2ff', ei: 1.2, rough: 0.35, metal: 0.4, cw: 2 },     // purple glass
  { color: '#5d6476', emissive: '#ffffff', ei: 0.95, rough: 0.7, metal: 0.2, cw: 3 },     // dark slate
];
// landmark towers (block centres; all are free blocks): roof height in metres
const LANDMARKS = [
  { cx: -150, cz: -50, h: 213 }, { cx: 150, cz: 50, h: 178 }, { cx: -250, cz: 250, h: 164 },
  { cx: 50, cz: 550, h: 199 }, { cx: 150, cz: 350, h: 157 }, { cx: 250, cz: -250, h: 189 }, { cx: -350, cz: -250, h: 150 },
];
const MAX_BILLBOARDS = 36, MAX_HELIPADS = 30;

// ---------- deterministic random ----------
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (x, z, s = 0) => (Math.imul(Math.round(x) | 0, 73856093) ^ Math.imul(Math.round(z) | 0, 19349663) ^ Math.imul(s + 7, 83492791)) | 0;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const snapUp = (v, s) => Math.ceil(v / s - 1e-6) * s;
const snapDown = (v, s) => Math.floor(v / s + 1e-6) * s;
const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];

// ---------- textures (created inside build) ----------
function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function finishTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// one shared texture of lit windows: dark facade, random warm / cool lit windows, floors of varying busyness
function windowTexture() {
  const [c, g] = canvas(TEX, TEX);
  const r = mulberry(20240611);
  g.fillStyle = '#0a0c11'; g.fillRect(0, 0, TEX, TEX);
  const warm = ['#ffcf87', '#ffb867', '#ffe2b0', '#ffd79a', '#fff0d0'];
  const cool = ['#a8d8ff', '#cfe9ff', '#8fc4ff', '#e6f4ff'];
  const odd = ['#ff9be8', '#b8ffd0', '#c8a8ff'];
  for (let row = 0; row < ROWS; row++) {
    const p = pick(r, [0.08, 0.28, 0.42, 0.6, 0.78]);   // how busy this floor is
    const warmFloor = r() < 0.62;
    for (let col = 0; col < COLS; col++) {
      const x = col * CELL, y = row * CELL;
      const lit = r() < p;
      let colr;
      if (lit) {
        const k = r();
        colr = k < 0.06 ? pick(r, odd) : ((k < 0.8) === warmFloor ? pick(r, warm) : pick(r, cool));
      } else colr = r() < 0.5 ? '#141a26' : '#1a2130';
      g.fillStyle = colr;
      g.fillRect(x + 4, y + 6, CELL - 8, CELL - 12);
      if (lit && r() < 0.3) { g.fillStyle = '#1a1f2a'; g.fillRect(x + 4, y + 6, CELL - 8, Math.round((CELL - 12) * (0.3 + r() * 0.4))); }   // half-closed blinds
      g.fillStyle = '#0a0c11'; g.fillRect(x + CELL / 2 - 1, y + 6, 2, CELL - 12);   // mullion
    }
  }
  g.fillStyle = '#2a2e36'; g.fillRect(0, 0, CELL, CELL);   // roof swatch, sampled by every roof face
  return finishTex(c, true);
}
function wordTexture(word, color, vertical) {
  const W = vertical ? 128 : 512, H = vertical ? 512 : 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#05060a'; g.fillRect(0, 0, W, H);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(9, 9, W - 18, H - 18);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = (s) => `900 ${s}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  const draw = (txt, x, y) => {
    g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color; g.fillText(txt, x, y);
    g.shadowBlur = 0; g.globalAlpha = 0.55; g.fillStyle = '#ffffff'; g.fillText(txt, x, y); g.globalAlpha = 1;
  };
  if (!vertical) {
    let size = 92;
    g.font = font(size);
    const m = g.measureText(word);
    const mw = (m && m.width) || 0;
    if (mw > W - 70) size = Math.max(30, Math.floor(size * (W - 70) / mw));
    g.font = font(size);
    draw(word, W / 2, H / 2 + 4);
  } else {
    const n = word.length, step = (H - 44) / n;
    g.font = font(Math.floor(Math.min(96, step * 0.92)));
    for (let i = 0; i < n; i++) draw(word[i], W / 2, 22 + step * (i + 0.5) + 3);
  }
  return finishTex(c, false);
}

// ---------- geometry merging ----------
function mergeAll(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = p.count;
    pos.set(p.array.subarray(0, c * 3), vo * 3);
    if (n) nrm.set(n.array.subarray(0, c * 3), vo * 3);
    if (u) uv.set(u.array.subarray(0, c * 2), vo * 2);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo; io += a.length; }
    else { for (let i = 0; i < c; i++) idx[io + i] = vo + i; io += c; }
    vo += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

export function build(world) {
  const scene = world.scene;
  const stats = { buildings: 0, landmarks: 0, colliders: 0, meshes: 0, billboards: 0, helipads: 0, antennas: 0, tanks: 0, blades: 0 };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const QI = new THREE.Quaternion();
  const collide = (cx, cy, cz, hx, hy, hz, surface = 'concrete') => {
    if (!(hx > 0.05 && hy > 0.05 && hz > 0.05)) return;
    addCollider(new OBB(V(cx, cy, cz), QI, V(hx, hy, hz), { grip: surface === 'metal' ? GRIP.metal : GRIP.concrete, surface }));
    stats.colliders++;
  };

  // ---------- shared materials (created once) ----------
  const winTex = windowTexture();
  const facadeMats = FACADES.map(f => new THREE.MeshStandardMaterial({ color: f.color, map: winTex, emissive: f.emissive, emissiveMap: winTex, emissiveIntensity: f.ei, roughness: f.rough, metalness: f.metal }));
  const neon = {};
  for (const k of NEON_KEYS) neon[k] = new THREE.MeshStandardMaterial({ color: '#111114', emissive: NEON[k], emissiveIntensity: 2.6, roughness: 0.5 });
  const pulse = {
    pink: new THREE.MeshStandardMaterial({ color: '#111114', emissive: NEON.pink, emissiveIntensity: 2.6, roughness: 0.5 }),
    cyan: new THREE.MeshStandardMaterial({ color: '#111114', emissive: NEON.cyan, emissiveIntensity: 2.6, roughness: 0.5 }),
  };
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.55, metalness: 0.6 });
  const acMat = new THREE.MeshStandardMaterial({ color: '#6a7078', roughness: 0.6, metalness: 0.4 });
  const tankMat = new THREE.MeshStandardMaterial({ color: '#5b4636', roughness: 0.9 });
  const padMat = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.85 });
  const paintMat = new THREE.MeshStandardMaterial({ color: '#e8e8e0', emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.7 });
  const blink = new THREE.MeshStandardMaterial({ color: '#300806', emissive: '#ff2a1a', emissiveIntensity: 3 });
  const wordMat = (tex) => new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1.8, roughness: 0.6 });
  const words = WORDS.map(([w, c]) => ({ word: w, color: c, mat: wordMat(wordTexture(w, NEON[c], false)) }));
  const vwords = VWORDS.map(([w, c]) => ({ word: w, color: c, mat: wordMat(wordTexture(w, NEON[c], true)) }));
  const facadeSet = new Set(facadeMats);
  const noShadow = new Set([...Object.values(neon), ...Object.values(pulse), blink, paintMat, ...words.map(w => w.mat), ...vwords.map(w => w.mat)]);

  // ---------- buckets: geometry merged per (material, chunk) ----------
  const buckets = new Map();
  const put = (mat, geo) => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const x = (bb.min.x + bb.max.x) / 2, z = (bb.min.z + bb.max.z) / 2;
    const n = facadeSet.has(mat) ? CHUNKS : CHUNKS / 2, size = 2 * CITY / n;
    const ci = clamp(Math.floor((x + CITY) / size), 0, n - 1), cj = clamp(Math.floor((z + CITY) / size), 0, n - 1);
    const key = mat.id * 64 + ci * 8 + cj;
    let b = buckets.get(key);
    if (!b) { b = { mat, geos: [] }; buckets.set(key, b); }
    b.geos.push(geo);
  };
  const boxG = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  const box = (mat, w, h, d, x, y, z) => put(mat, boxG(w, h, d, x, y, z));

  // a facade box with windows: UVs come from world coordinates, so windows stay cw x 3.5 m apart and line up
  // with the building edges (footprints are snapped to the window grid)
  const facade = (fi, x0, x1, z0, z1, y0, y1, uo, vo) => {
    const F = FACADES[fi], w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const g = boxG(w, h, d, cx, cy, cz);
    const p = g.attributes.position, uv = g.attributes.uv;
    const su = 1 / (F.cw * COLS), sv = 1 / (FLOOR * ROWS);
    for (let i = 0; i < p.count; i++) {
      const face = i >> 2;   // BoxGeometry order: +x, -x, +y, -y, +z, -z (4 vertices each)
      if (face === 2 || face === 3) uv.setXY(i, ROOF_U, ROOF_V);
      else uv.setXY(i, uo + (face < 2 ? p.getZ(i) : p.getX(i)) * su, vo + p.getY(i) * sv);
    }
    put(facadeMats[fi], g);
    collide(cx, cy, cz, w / 2, h / 2, d / 2);
  };

  // ---------- neon accents ----------
  const band = (mat, x0, x1, z0, z1, y, th, out) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box(mat, w + 2 * out, th, 2 * out, cx, y, z0); box(mat, w + 2 * out, th, 2 * out, cx, y, z1);
    box(mat, 2 * out, th, d, x0, y, cz); box(mat, 2 * out, th, d, x1, y, cz);
  };
  const corners = (mat, x0, x1, z0, z1, yb, yt) => {
    for (const x of [x0, x1]) for (const z of [z0, z1]) box(mat, 0.4, yt - yb, 0.4, x, (yb + yt) / 2, z);
  };
  const accents = (r, mat, x0, x1, z0, z1, yb, yt, tall) => {
    const k = r();
    const crown = tall ? k < 0.62 : k < 0.3;
    if (crown) band(mat, x0, x1, z0, z1, yt - 0.35, 0.45, 0.18);
    if (r() < (tall ? 0.35 : 0.2)) corners(mat, x0, x1, z0, z1, Math.max(yb, 0), yt);
    else if (!crown && r() < 0.3) {
      const every = (3 + Math.floor(r() * 4)) * FLOOR;
      let n = 0;
      for (let y = Math.max(yb, 0) + every; y < yt - FLOOR && n < 8; y += every, n++) band(mat, x0, x1, z0, z1, y, 0.25, 0.15);
    }
  };

  // ---------- faces that look onto open space (street / reserved area) ----------
  // lot sides are tagged 'street' (sidewalk + street beyond), 'res' (a reserved area beyond) or 'alley'
  const openFaces = (lot, x0, x1, z0, z1) => {
    const f = [
      { n: [-1, 0], tag: lot.s.w, room: x0 - lot.x0 },
      { n: [1, 0], tag: lot.s.e, room: lot.x1 - x1 },
      { n: [0, -1], tag: lot.s.s, room: z0 - lot.z0 },
      { n: [0, 1], tag: lot.s.n, room: lot.z1 - z1 },
    ];
    for (const s of f) s.room += s.tag === 'street' ? EDGE : s.tag === 'res' ? GAP : ALLEY / 2;
    // faces onto a reserved area first (the drag avenue: show it the neon), then street faces
    return f.filter(s => s.tag !== 'alley').sort((a, b) => (a.tag === b.tag ? 0 : a.tag === 'res' ? -1 : 1));
  };
  // face geometry helper: plane coordinate + extent along the face
  const faceInfo = (face, x0, x1, z0, z1) => face.n[0] !== 0
    ? { alongX: false, c: face.n[0] < 0 ? x0 : x1, a0: z0, a1: z1 }
    : { alongX: true, c: face.n[1] < 0 ? z0 : z1, a0: x0, a1: x1 };

  const storefront = (r, face, x0, x1, z0, z1) => {
    const fi = faceInfo(face, x0, x1, z0, z1), len = fi.a1 - fi.a0 - 1, mid = (fi.a0 + fi.a1) / 2;
    if (len < 3) return;
    const mat = neon[pick(r, NEON_KEYS)];
    if (fi.alongX) box(mat, len, 0.35, 0.4, mid, 4.2, fi.c); else box(mat, 0.4, 0.35, len, fi.c, 4.2, mid);
  };
  // vertical blade sign sticking out of a facade (plain neon, or stacked neon letters)
  const blade = (r, face, x0, x1, z0, z1, h) => {
    const fi = faceInfo(face, x0, x1, z0, z1);
    const text = r() < 0.55;
    const bd = text ? 2.4 : 1.6, L = text ? 9.6 : 7 + Math.floor(r() * 8);
    if (face.room < bd + 0.4 || h < L + 9 || fi.a1 - fi.a0 < 8) return;
    const along = fi.a0 + (r() < 0.5 ? 0.22 : 0.78) * (fi.a1 - fi.a0);
    const yb = 5.2, yc = yb + L / 2;
    const out = fi.c + (face.n[0] + face.n[1]) * (bd / 2 + 0.05);   // centre of the blade, outside the face
    const x = fi.alongX ? along : out, z = fi.alongX ? out : along;
    // blade local frame: protrusion along x, thickness along z, text faces +-z; rotate so x -> face normal
    const yaw = face.n[0] > 0 ? 0 : face.n[0] < 0 ? Math.PI : face.n[1] > 0 ? -Math.PI / 2 : Math.PI / 2;
    const place = (g) => { g.rotateY(yaw); g.translate(x, yc, z); return g; };
    if (text) {
      const vw = pick(r, vwords);
      put(metal, place(new THREE.BoxGeometry(bd, L, 0.3)));
      const f1 = new THREE.PlaneGeometry(bd - 0.1, L - 0.1); f1.translate(0, 0, 0.16); put(vw.mat, place(f1));
      const f2 = new THREE.PlaneGeometry(bd - 0.1, L - 0.1); f2.rotateY(Math.PI); f2.translate(0, 0, -0.16); put(vw.mat, place(f2));
      const nm = neon[vw.color];
      const e1 = new THREE.BoxGeometry(0.16, L + 0.2, 0.4); e1.translate(bd / 2, 0, 0); put(nm, place(e1));
      const e2 = new THREE.BoxGeometry(bd, 0.16, 0.4); e2.translate(0, L / 2 + 0.08, 0); put(nm, place(e2));
      const e3 = new THREE.BoxGeometry(bd, 0.16, 0.4); e3.translate(0, -L / 2 - 0.08, 0); put(nm, place(e3));
    } else {
      put(metal, place(new THREE.BoxGeometry(bd, L, 0.25)));
      const glow = new THREE.BoxGeometry(bd - 0.3, L - 0.3, 0.4); put(neon[pick(r, NEON_KEYS)], place(glow));
    }
    const hx = fi.alongX ? 0.22 : bd / 2, hz = fi.alongX ? bd / 2 : 0.22;
    collide(x, yc, z, hx, L / 2, hz, 'metal');
    stats.blades++;
  };

  // ---------- rooftop details ----------
  const tank = (x, z, y, rad) => {
    const legH = 1.6, tH = 4;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(metal, 0.25, legH, 0.25, x + dx * rad * 0.6, y + legH / 2, z + dz * rad * 0.6);
    const c = new THREE.CylinderGeometry(rad, rad, tH, 14); c.translate(x, y + legH + tH / 2, z); put(tankMat, c);
    const cone = new THREE.ConeGeometry(rad * 1.06, 1.3, 14); cone.translate(x, y + legH + tH + 0.65, z); put(tankMat, cone);
    collide(x, y + (legH + tH + 1.3) / 2, z, rad, (legH + tH + 1.3) / 2, rad, 'wood');
    stats.tanks++;
  };
  const acUnits = (r, x, z, y, room) => {
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const w = Math.min(room - 0.2, 1.6 + r() * 1.2), h = 1.1 + r() * 0.6, d = Math.min(room - 0.2, 1.4 + r() * 1.0);
      const ox = (r() - 0.5) * Math.max(0, room - w), oz = (r() - 0.5) * Math.max(0, room - d);
      box(acMat, w, h, d, x + ox, y + h / 2, z + oz);
      box(metal, w * 0.6, 0.12, d * 0.6, x + ox, y + h + 0.06, z + oz);
      collide(x + ox, y + h / 2, z + oz, w / 2, h / 2, d / 2, 'metal');
    }
  };
  const antenna = (x, z, y, L) => {
    box(metal, 1.2, 0.6, 1.2, x, y + 0.3, z);
    const m = new THREE.CylinderGeometry(0.12, 0.25, L, 6); m.translate(x, y + 0.6 + L / 2, z); put(metal, m);
    const s = new THREE.SphereGeometry(0.45, 8, 6); s.translate(x, y + 0.6 + L + 0.2, z); put(blink, s);
    collide(x, y + (0.6 + L) / 2, z, 0.6, (0.6 + L) / 2, 0.6, 'metal');
    stats.antennas++;
  };
  const helipad = (x, z, y, R) => {
    const disc = new THREE.CylinderGeometry(R, R, 0.15, 28); disc.translate(x, y + 0.075, z); put(padMat, disc);
    const ring = new THREE.RingGeometry(R - 1.0, R - 0.6, 28); ring.rotateX(-Math.PI / 2); ring.translate(x, y + 0.17, z); put(paintMat, ring);
    const s = R * 0.45;
    box(paintMat, 0.9, 0.04, s * 2, x - s * 0.55, y + 0.17, z);
    box(paintMat, 0.9, 0.04, s * 2, x + s * 0.55, y + 0.17, z);
    box(paintMat, s * 1.1, 0.04, 0.9, x, y + 0.17, z);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      box(neon.yellow, 0.4, 0.3, 0.4, x + Math.cos(a) * (R - 0.3), y + 0.3, z + Math.sin(a) * (R - 0.3));
    }
    stats.helipads++;
  };
  // billboard on the roof edge of an open face, facing out (readable from the street), text on both sides
  const billboard = (r, face, x0, x1, z0, z1, y) => {
    const fi = faceInfo(face, x0, x1, z0, z1);
    const E = fi.a1 - fi.a0;
    const bw = Math.min(E - 2, 12 + r() * 8), bh = bw / 4, lift = 1.6;
    if (bw < 9) return false;
    const wd = words[stats.billboards % words.length];
    const mid = (fi.a0 + fi.a1) / 2;
    const inC = fi.c - (face.n[0] + face.n[1]) * 1.6;   // 1.6 m in from the roof edge
    const x = fi.alongX ? mid : inC, z = fi.alongX ? inC : mid;
    const yaw = face.n[1] > 0 ? 0 : face.n[1] < 0 ? Math.PI : face.n[0] > 0 ? Math.PI / 2 : -Math.PI / 2;
    const place = (g) => { g.rotateY(yaw); g.translate(x, y, z); return g; };
    const nm = neon[wd.color];
    for (const s of [-1, 1]) { const p = new THREE.BoxGeometry(0.35, lift + bh, 0.35); p.translate(s * (bw / 2 - 1), (lift + bh) / 2, 0); put(metal, place(p)); }
    const back = new THREE.BoxGeometry(bw, bh, 0.3); back.translate(0, lift + bh / 2, 0); put(metal, place(back));
    const f1 = new THREE.PlaneGeometry(bw - 0.1, bh - 0.1); f1.translate(0, lift + bh / 2, 0.16); put(wd.mat, place(f1));
    const f2 = new THREE.PlaneGeometry(bw - 0.1, bh - 0.1); f2.rotateY(Math.PI); f2.translate(0, lift + bh / 2, -0.16); put(wd.mat, place(f2));
    for (const yy of [lift - 0.1, lift + bh + 0.1]) { const e = new THREE.BoxGeometry(bw + 0.3, 0.2, 0.36); e.translate(0, yy, 0); put(nm, place(e)); }
    for (const s of [-1, 1]) { const e = new THREE.BoxGeometry(0.2, bh, 0.36); e.translate(s * (bw / 2 + 0.05), lift + bh / 2, 0); put(nm, place(e)); }
    const hx = fi.alongX ? bw / 2 + 0.15 : 0.2, hz = fi.alongX ? 0.2 : bw / 2 + 0.15;
    collide(x, y + (lift + bh + 0.2) / 2, z, hx, (lift + bh + 0.2) / 2, hz, 'metal');
    stats.billboards++;
    return true;
  };
  const roofDetails = (r, faces, x0, x1, z0, z1, y, h) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (w >= 21 && d >= 21 && h >= 45 && stats.helipads < MAX_HELIPADS && r() < 0.2) {
      helipad(cx, cz, y, Math.min(w, d) / 2 - 1.5);
      return;
    }
    let blocked = null;   // the roof half a billboard took
    if (faces.length && h >= 18 && h <= 80 && stats.billboards < MAX_BILLBOARDS && r() < (faces[0].tag === 'res' ? 0.25 : 0.065)) {
      if (billboard(r, faces[0], x0, x1, z0, z1, y)) blocked = faces[0].n;
    }
    const q = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([sx, sz]) => !blocked || (sx * blocked[0] + sz * blocked[1]) <= 0);
    // deterministic shuffle
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = q[i]; q[i] = q[j]; q[j] = t; }
    const qh = Math.min(w, d) / 4 - 0.4;   // half size of a roof quadrant
    const at = (k) => [cx + q[k][0] * w / 4, cz + q[k][1] * d / 4];
    let k = 0;
    if (k < q.length && qh >= 1.3 && r() < 0.4) { const [x, z] = at(k++); tank(x, z, y, Math.min(2.6, qh - 0.2)); }
    if (k < q.length && qh >= 1.4 && r() < 0.55) { const [x, z] = at(k++); acUnits(r, x, z, y, qh * 2); }
    if (k < q.length && r() < 0.2 + h / 260) { const [x, z] = at(k++); antenna(x, z, y, 6 + r() * (6 + h * 0.12)); }
  };

  // ---------- one generic building in a lot ----------
  const building = (r, lot, cityX, cityZ) => {
    const lw = lot.x1 - lot.x0, ld = lot.z1 - lot.z0;
    const dist = Math.hypot(cityX, cityZ);
    const t = Math.min(1, dist / 850);
    let h = (115 - 92 * Math.pow(t, 0.85)) * (0.5 + r() * 0.6);
    if (r() < 0.07) h *= 1.45;
    const lcx = (lot.x0 + lot.x1) / 2, lcz = (lot.z0 + lot.z1) / 2;
    const ringCourse = Math.abs(lcx - 100) < 45 && lcz > 320 && lcz < 700;   // towers along the ring course street
    if (ringCourse) h = Math.max(h, 85 + r() * 35);
    const minDim = Math.min(lw, ld);
    h = Math.min(h, Math.max(15, minDim * (ringCourse ? 8 : 6)));
    h = clamp(h, 15, 120);
    const floors = clamp(Math.round(h / FLOOR), 5, 34);
    h = floors * FLOOR;
    const k = r();
    const fi = h > 70 ? (k < 0.4 ? 2 : k < 0.7 ? 3 : k < 0.85 ? 4 : 0) : (k < 0.35 ? 0 : k < 0.6 ? 1 : k < 0.75 ? 4 : k < 0.9 ? 2 : 3);
    const cw = FACADES[fi].cw;
    // footprint: inset from the lot, snapped to the window grid (narrow lots, e.g. along the drag avenue,
    // keep their full depth instead and live with a cut window at the corners)
    const narrowX = lw < 14, narrowZ = ld < 14;
    const ins = (narrow) => (narrow ? 0.25 : 0.5 + r() * 1.5);
    const x0 = narrowX ? lot.x0 + ins(true) : snapUp(lot.x0 + ins(false), cw), x1 = narrowX ? lot.x1 - ins(true) : snapDown(lot.x1 - ins(false), cw);
    const z0 = narrowZ ? lot.z0 + ins(true) : snapUp(lot.z0 + ins(false), cw), z1 = narrowZ ? lot.z1 - ins(true) : snapDown(lot.z1 - ins(false), cw);
    if (x1 - x0 < 4 || z1 - z0 < 4) return;
    const uo = Math.floor(r() * COLS) / COLS, vo = Math.floor(r() * ROWS) / ROWS;
    const nmat = neon[pick(r, NEON_KEYS)];
    const faces = openFaces(lot, x0, x1, z0, z1);
    let tx0 = x0, tx1 = x1, tz0 = z0, tz1 = z1;
    if (h > 55 && Math.min(x1 - x0, z1 - z0) >= 18 && r() < 0.6) {
      // setback: lower block, then a slimmer upper block
      const h1 = clamp(Math.round(h * (0.55 + r() * 0.2) / FLOOR), 4, floors - 3) * FLOOR;
      const s = Math.max(cw, snapDown(3 + r() * 3, cw));
      facade(fi, x0, x1, z0, z1, -1, h1, uo, vo);
      tx0 = x0 + s; tx1 = x1 - s; tz0 = z0 + s; tz1 = z1 - s;
      facade(fi, tx0, tx1, tz0, tz1, h1, h, uo, vo);
      if (r() < 0.6) band(nmat, x0, x1, z0, z1, h1 - 0.3, 0.4, 0.18);
      accents(r, nmat, tx0, tx1, tz0, tz1, h1, h, true);
    } else {
      facade(fi, x0, x1, z0, z1, -1, h, uo, vo);
      accents(r, nmat, x0, x1, z0, z1, -1, h, h > 60);
    }
    if (faces.length) {
      if (r() < (h < 50 ? 0.45 : 0.25)) storefront(r, faces[0], x0, x1, z0, z1);
      if (r() < 0.24) blade(r, faces[0], x0, x1, z0, z1, h);
    }
    roofDetails(r, faces, tx0, tx1, tz0, tz1, h, h);
    stats.buildings++;
  };

  // ---------- landmark towers: podium + 3 stepped sections + spire ----------
  const landmark = (r, p, H) => {
    const fi = r() < 0.5 ? 2 : 3, cw = FACADES[fi].cw, pf = r() < 0.5 ? 0 : 4;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const span = Math.min(p.x1 - p.x0, p.z1 - p.z0) / 2;
    const rect = (half, s) => [snapUp(cx - half, s), snapDown(cx + half, s), snapUp(cz - half, s), snapDown(cz + half, s)];
    const uo = Math.floor(r() * COLS) / COLS, vo = Math.floor(r() * ROWS) / ROWS;
    const ph = 6 * FLOOR;
    const [px0, px1, pz0, pz1] = rect(Math.min(span - 1, 33), FACADES[pf].cw);
    facade(pf, px0, px1, pz0, pz1, -1, ph, uo, vo);
    const c1 = r() < 0.5 ? 'pink' : 'cyan', c2 = c1 === 'pink' ? 'cyan' : 'pink';
    band(neon[c1], px0, px1, pz0, pz1, ph - 0.35, 0.45, 0.18);
    band(neon.purple, px0, px1, pz0, pz1, 4.2, 0.35, 0.2);
    const tops = [Math.round(H * 0.6 / FLOOR) * FLOOR, Math.round(H * 0.82 / FLOOR) * FLOOR, Math.round(H / FLOOR) * FLOOR];
    const halves = [Math.min(span - 6, 22), Math.min(span - 9, 16), Math.min(span - 12, 11)];
    let yb = ph, last = null;
    for (let i = 0; i < 3; i++) {
      const [x0, x1, z0, z1] = rect(halves[i], cw);
      if (x1 - x0 < 6 || z1 - z0 < 6 || tops[i] <= yb) break;
      facade(fi, x0, x1, z0, z1, yb, tops[i], uo, vo);
      band(i === 2 ? pulse[c1] : neon[i ? c2 : c1], x0, x1, z0, z1, tops[i] - 0.35, 0.5, 0.2);
      corners(i === 1 ? neon.purple : neon[c2], x0, x1, z0, z1, yb, tops[i]);
      yb = tops[i]; last = [x0, x1, z0, z1];
    }
    if (last) {
      const [x0, x1, z0, z1] = last;
      // crown frame + spire with a blinking light
      band(pulse[c2], x0, x1, z0, z1, yb + 1.2, 0.3, 0.05);
      for (const x of [x0, x1]) for (const z of [z0, z1]) box(metal, 0.3, 1.5, 0.3, x, yb + 0.75, z);
      const L = 18 + r() * 14;
      box(metal, 3, 2, 3, cx, yb + 1, cz);
      const sp = new THREE.CylinderGeometry(0.15, 0.7, L, 8); sp.translate(cx, yb + 2 + L / 2, cz); put(metal, sp);
      const ring = new THREE.CylinderGeometry(0.9, 0.9, 0.4, 12); ring.translate(cx, yb + 2 + L * 0.35, cz); put(neon[c1], ring);
      const s = new THREE.SphereGeometry(0.6, 8, 6); s.translate(cx, yb + 2 + L + 0.3, cz); put(blink, s);
      collide(cx, yb + 1, cz, 1.5, 1, 1.5, 'metal');
      collide(cx, yb + 2 + L / 2, cz, 0.7, L / 2, 0.7, 'metal');
      stats.antennas++;
    }
    stats.landmarks++; stats.buildings++;
  };

  // ---------- block pieces clear of RESERVED (with side tags) ----------
  const reserved = Object.values(RESERVED).map(R => ({ x0: R.cx - R.hw - GAP, x1: R.cx + R.hw + GAP, z0: R.cz - R.hd - GAP, z1: R.cz + R.hd + GAP }));
  const pieces = (b) => {
    let rects = [{ x0: b.cx - b.hw + EDGE, x1: b.cx + b.hw - EDGE, z0: b.cz - b.hd + EDGE, z1: b.cz + b.hd - EDGE, s: { w: 'street', e: 'street', s: 'street', n: 'street' } }];
    for (const R of reserved) {
      const next = [];
      for (const q of rects) {
        if (q.x1 <= R.x0 || q.x0 >= R.x1 || q.z1 <= R.z0 || q.z0 >= R.z1) { next.push(q); continue; }
        if (q.z0 < R.z0) next.push({ x0: q.x0, x1: q.x1, z0: q.z0, z1: R.z0, s: { ...q.s, n: 'res' } });
        if (q.z1 > R.z1) next.push({ x0: q.x0, x1: q.x1, z0: R.z1, z1: q.z1, s: { ...q.s, s: 'res' } });
        const mz0 = Math.max(q.z0, R.z0), mz1 = Math.min(q.z1, R.z1);
        const ms = { s: q.z0 < R.z0 ? 'alley' : q.s.s, n: q.z1 > R.z1 ? 'alley' : q.s.n };
        if (q.x0 < R.x0) next.push({ x0: q.x0, x1: R.x0, z0: mz0, z1: mz1, s: { w: q.s.w, e: 'res', ...ms } });
        if (q.x1 > R.x1) next.push({ x0: R.x1, x1: q.x1, z0: mz0, z1: mz1, s: { w: 'res', e: q.s.e, ...ms } });
      }
      rects = next;
    }
    return rects.filter(q => q.x1 - q.x0 >= 6 && q.z1 - q.z0 >= 6);
  };
  // split a piece into n lots (largest lot cut across its long side, an alley in between)
  const lotsFor = (piece, n, r) => {
    const lots = [piece];
    const MIN = 9;
    for (let guard = 0; lots.length < n && guard < 8; guard++) {
      let bi = 0;
      for (let i = 1; i < lots.length; i++) if ((lots[i].x1 - lots[i].x0) * (lots[i].z1 - lots[i].z0) > (lots[bi].x1 - lots[bi].x0) * (lots[bi].z1 - lots[bi].z0)) bi = i;
      const L = lots[bi], w = L.x1 - L.x0, d = L.z1 - L.z0, alongX = w >= d, len = alongX ? w : d;
      if (len < 2 * MIN + ALLEY) break;
      const cutLen = clamp(len * (0.35 + r() * 0.3), MIN, len - MIN - ALLEY);
      const a = { ...L, s: { ...L.s } }, b = { ...L, s: { ...L.s } };
      if (alongX) { a.x1 = L.x0 + cutLen; b.x0 = a.x1 + ALLEY; a.s.e = 'alley'; b.s.w = 'alley'; }
      else { a.z1 = L.z0 + cutLen; b.z0 = a.z1 + ALLEY; a.s.n = 'alley'; b.s.s = 'alley'; }
      lots.splice(bi, 1, a, b);
    }
    return lots;
  };

  // ---------- the city ----------
  for (const b of blocks()) {
    try {
      const ps = pieces(b);
      if (!ps.length) continue;
      const full = ps.length === 1 && Math.abs((ps[0].x1 - ps[0].x0) - (2 * (b.hw - EDGE))) < 0.01 && Math.abs((ps[0].z1 - ps[0].z0) - (2 * (b.hd - EDGE))) < 0.01;
      const lm = full && LANDMARKS.find(L => L.cx === b.cx && L.cz === b.cz);
      if (lm) { landmark(mulberry(seedOf(b.cx, b.cz, 99)), ps[0], lm.h); continue; }
      ps.forEach((p, i) => {
        const r = mulberry(seedOf(b.cx, b.cz, i));
        const w = p.x1 - p.x0, d = p.z1 - p.z0;
        const n = Math.min(w, d) < 24 ? clamp(Math.floor(Math.max(w, d) / (13 + r() * 9)), 1, 4) : 1 + Math.floor(r() * 4);
        for (const lot of lotsFor(p, n, r)) building(r, lot, b.cx, b.cz);
      });
    } catch (e) { console.warn('neon buildings: block', b.cx, b.cz, e); }
  }

  // ---------- flush merged meshes ----------
  for (const { mat, geos } of buckets.values()) {
    try {
      const mesh = new THREE.Mesh(mergeAll(geos), mat);
      mesh.castShadow = !noShadow.has(mat); mesh.receiveShadow = !noShadow.has(mat);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      scene.add(mesh);
      stats.meshes++;
    } catch (e) { console.warn('neon buildings: merge', e); }
    for (const g of geos) g.dispose();
  }
  buckets.clear();

  // ---------- animation: blinking aviation lights, pulsing landmark crowns ----------
  if (Array.isArray(world.anim)) {
    world.anim.push((t) => {
      blink.emissiveIntensity = (t % 1.5) < 0.35 ? 4 : 0.12;
      pulse.pink.emissiveIntensity = 2.2 + Math.sin(t * 2.1) * 1.1;
      pulse.cyan.emissiveIntensity = 2.2 + Math.sin(t * 2.1 + 2) * 1.1;
    });
  }
  return stats;
}
