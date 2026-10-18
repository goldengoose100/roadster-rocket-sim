// Neon City: the Neon Tunnel (a box tunnel along street x = -300) and the Skyway (an elevated highway
// along street z = 400, deck 10 m up, ramps down to the street at both ends).
// Everything static is merged into one mesh per material (about 12 meshes in total). Colliders are OBBs
// plus two Wedges that fill the lower half of each ramp (so nothing can get wedged under it).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, OBB, Wedge, GRIP } from '../../colliders.js';
import { ZONES, KEYS, TUNNEL, SKYWAY } from './layout.js';

// ---------- tunnel dimensions ----------
const TX = TUNNEL.x;                 // street centre line (-300)
const TZ0 = TUNNEL.z0;               // south portal (120)
const TZ1 = TUNNEL.z1 - 10;          // north portal (590): keeps the z = 600 intersection clear
const IW = 8;                        // inner half width (16 m inside)
const WT = 1.5;                      // wall thickness (outer faces at x = -309.5 / -290.5, inside the 20 m street)
const TH = 7;                        // inner height
const RT = 0.8;                      // roof thickness (roof top 7.8 m, under the skyway deck bottom at 9 m)
// ---------- skyway dimensions ----------
const SZ = SKYWAY.z;                 // street centre line (400)
const SX0 = SKYWAY.x0, SX1 = SKYWAY.x1;   // deck ends (-600 / 600)
const DH = SKYWAY.h;                 // deck top (10 m)
const DW = 9.5;                      // deck half width (19 m wide, 0.5 m inside the street edges)
const DT = 1.0;                      // deck thickness
const BT = 1.0;                      // barrier thickness
const BH = 1.2;                      // barrier height above the road
const RUN = 60;                      // ramp horizontal run: 10 m over 60 m = 9.5 degrees, ends at x = +-660
const EXT = 2;                       // ramp slab continues this far (along the slope) under the ground

const _o = new THREE.Object3D();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function neonText(g, w, h, text, core, glow) {
  g.fillStyle = '#05060a'; g.fillRect(0, 0, w, h);
  g.strokeStyle = glow; g.lineWidth = 7; g.strokeRect(10, 10, w - 20, h - 20);
  g.font = `800 ${Math.round(h * 0.6)}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = glow; g.shadowBlur = 30;
  g.fillStyle = glow; g.fillText(text, w / 2, h * 0.54);
  g.shadowBlur = 0;
  g.fillStyle = core; g.fillText(text, w / 2, h * 0.54);
}
// box geometry already moved into world space (rotation order XYZ: z first, then y)
function boxG(w, h, d, x, y, z, rz = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  _o.position.set(x, y, z); _o.rotation.set(0, ry, rz); _o.scale.set(1, 1, 1); _o.updateMatrix();
  return g.applyMatrix4(_o.matrix);
}
function obb(x, y, z, hx, hy, hz, rz = 0, opts = {}) {
  _e.set(0, opts.ry || 0, rz); _q.setFromEuler(_e);
  return addCollider(new OBB(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(hx, hy, hz),
    { grip: opts.grip ?? GRIP.concrete, surface: opts.surface || 'concrete' }));
}
// road surface plane (u along the road, one texture repeat per 20 m; v across the full width)
function roadG(len, width, x, y, z, rz) {
  const g = new THREE.PlaneGeometry(len, width);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 20);
  g.rotateX(-Math.PI / 2);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}
// vertical light strip on a wall face (normal +-x), u runs along z (reversed when flip)
function stripG(x, nx, y0, y1, z0, z1, uLen, flip) {
  const u1 = (z1 - z0) / uLen;
  const ua = flip ? u1 : 0, ub = flip ? 0 : u1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x, y0, z0, x, y0, z1, x, y1, z0, x, y1, z1], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0, 0, nx, 0, 0, nx, 0, 0, nx, 0, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([ua, 0, ub, 0, ua, 1, ub, 1], 2));
  g.setIndex(nx > 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 2, 1, 3]);
  return g;
}
const keyOf = (zone, fallback) => {
  const k = Object.keys(KEYS || {}).find(n => KEYS[n] === zone);
  return k !== undefined ? Number(k) : fallback;
};

export function build(world) {
  const scene = world.scene;
  const mats = world.mats || {};

  // ---------- textures + materials (created once, shared) ----------
  const roadTex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#1f2127'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 20 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgba(${v},${v},${v + 6},0.55)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    const px = h / (2 * DW);                     // pixels per metre across the road
    const line = (m, col, wpx = 3, dash = 0) => { g.fillStyle = col; g.fillRect(0, Math.round(m * px - wpx / 2), dash || w, wpx); };
    const edge = BT + 0.35, lane = (edge + DW) / 2;
    line(edge, '#e8f4f8'); line(2 * DW - edge, '#e8f4f8');
    line(DW - 0.22, '#f2c230'); line(DW + 0.22, '#f2c230');
    line(lane, '#e8f4f8', 3, 200); line(2 * DW - lane, '#e8f4f8', 3, 200);
  }, true);
  const chaseTex = canvasTex(256, 16, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#04202a'); gr.addColorStop(0.55, '#0a5f78'); gr.addColorStop(0.8, '#6ff2ff');
    gr.addColorStop(0.86, '#ffffff'); gr.addColorStop(0.9, '#ff4fd8'); gr.addColorStop(1, '#04202a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, true);
  const tunnelTex = canvasTex(1024, 160, (g, w, h) => neonText(g, w, h, 'TUNNEL', '#ffe3fa', '#ff2fd0'), false);
  const skyTex = canvasTex(1024, 192, (g, w, h) => neonText(g, w, h, 'SKYWAY', '#e6fdff', '#22e6ff'), false);

  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.5, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#5a5e68', roughness: 0.85, metalness: 0.05 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: '#8b909a', roughness: 0.7 });
  const steelMat = mats.darkSteel || new THREE.MeshStandardMaterial({ color: '#3b4148', roughness: 0.5, metalness: 0.7 });
  const wallMat = new THREE.MeshStandardMaterial({ color: '#23262e', roughness: 0.55, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#0c2230', roughness: 0.08, metalness: 0.7, transparent: true, opacity: 0.38, depthWrite: false });
  const cyanMat = new THREE.MeshStandardMaterial({ color: '#03161c', emissive: '#22e6ff', emissiveIntensity: 2.2 });
  const pinkMat = new THREE.MeshStandardMaterial({ color: '#1c0318', emissive: '#ff2fd0', emissiveIntensity: 2.2 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#111418', emissive: '#e4f6ff', emissiveIntensity: 2.6 });
  const chaseMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: chaseTex, emissiveIntensity: 2.0, roughness: 0.6 });
  const tunnelSignMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tunnelTex, emissiveIntensity: 2.2, roughness: 0.7 });
  const skySignMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: skyTex, emissiveIntensity: 2.0, roughness: 0.7 });

  // geometry bins: one merged mesh per material at the end
  const bins = new Map();
  const put = (mat, geo) => { let a = bins.get(mat); if (!a) bins.set(mat, a = []); a.push(geo); };
  const solid = (mat, w, h, d, x, y, z, rz = 0, opts = {}) => { put(mat, boxG(w, h, d, x, y, z, rz)); obb(x, y, z, w / 2, h / 2, d / 2, rz, opts); };

  // =====================================================================
  // NEON TUNNEL (street x = -300, z TZ0..TZ1)
  // =====================================================================
  const TL = TZ1 - TZ0, TC = (TZ0 + TZ1) / 2;
  for (const s of [-1, 1]) solid(wallMat, WT, TH, TL, TX + s * (IW + WT / 2), TH / 2, TC);
  // roof: tinted glass so the chase camera still shows the car when it rises above it
  put(glassMat, boxG(2 * (IW + WT), RT, TL, TX, TH + RT / 2, TC));
  obb(TX, TH + RT / 2, TC, IW + WT, RT / 2, TL / 2, 0, { surface: 'metal', grip: GRIP.metal });
  // headwalls above both portals (carry the TUNNEL signs)
  const HWH = 2.6, hwY = TH + RT + HWH / 2;
  solid(wallMat, 2 * (IW + WT), HWH, 1.0, TX, hwY, TZ0 + 0.5);
  solid(wallMat, 2 * (IW + WT), HWH, 1.0, TX, hwY, TZ1 - 0.5);
  {
    const south = new THREE.PlaneGeometry(15, 2.3); south.rotateY(Math.PI); south.translate(TX, hwY, TZ0 - 0.03);
    const north = new THREE.PlaneGeometry(15, 2.3); north.translate(TX, hwY, TZ1 + 0.03);
    put(tunnelSignMat, south); put(tunnelSignMat, north);
  }
  // neon frame around both portal openings
  for (const [z, off] of [[TZ0, -0.07], [TZ1, 0.07]]) {
    for (const s of [-1, 1]) put(cyanMat, boxG(0.3, TH, 0.12, TX + s * (IW + 0.25), TH / 2, z + off));
    put(cyanMat, boxG(2 * IW + 0.8, 0.3, 0.12, TX, TH + 0.25, z + off));
  }
  // ceiling ribs under the glass, each with a pink glow line underneath (visual only)
  for (let z = TZ0 + 5; z <= TZ1 - 5 + 0.01; z += 10) {
    put(steelMat, boxG(2 * IW, 0.35, 0.5, TX, TH - 0.175, z));
    put(pinkMat, boxG(2 * IW - 0.4, 0.05, 0.2, TX, TH - 0.375, z));
  }
  // chase light strips on both inner walls: lower ones run north, upper ones run south
  for (const s of [-1, 1]) {
    const x = TX + s * (IW - 0.03), nx = -s;
    put(chaseMat, stripG(x, nx, 0.9, 1.25, TZ0 + 0.5, TZ1 - 0.5, 24, false));
    put(chaseMat, stripG(x, nx, 5.6, 5.95, TZ0 + 0.5, TZ1 - 0.5, 24, true));
  }

  // =====================================================================
  // SKYWAY (street z = 400, deck x SX0..SX1 at DH, ramps to the ground beyond both ends)
  // =====================================================================
  const DL = SX1 - SX0, DC = (SX0 + SX1) / 2;
  // deck slab (one collider for the whole length so there are no seams to catch on)
  put(deckMat, boxG(DL, DT, 2 * DW, DC, DH - DT / 2, SZ));
  obb(DC, DH - DT / 2, SZ, DL / 2, DT / 2, DW, 0, { surface: 'asphalt', grip: GRIP.asphalt });
  put(roadMat, roadG(DL, 2 * DW, DC, DH + 0.005, SZ, 0));
  // barriers + glow strip on top + glowing fascia line along the outer edge
  for (const k of [-1, 1]) {
    const bz = SZ + k * (DW - BT / 2 - 0.02);
    solid(barrierMat, DL + 0.8, BH + 0.4, BT, DC, DH + (BH - 0.4) / 2, bz);
    put(cyanMat, boxG(DL + 0.8, 0.08, 0.25, DC, DH + BH + 0.04, bz));
    put(cyanMat, boxG(DL, 0.25, 0.1, DC, DH - 0.35, SZ + k * (DW + 0.05)));
  }
  // ramps: a full-length inclined slab (the drivable top) + a wedge filling its lower half
  const a = Math.atan2(DH, RUN), ca = Math.cos(a), sa = Math.sin(a);
  const RL = Math.hypot(RUN, DH), Ls = RL + EXT;
  const rampPillars = [];
  for (const s of [-1, 1]) {
    const xTop = s > 0 ? SX1 : SX0, xBot = xTop + s * RUN;
    const dx = s * ca, dy = -sa;            // down the slope, outward
    const nx = s * sa, ny = ca;             // surface normal
    const rz = -s * a;
    const tcx = xTop + dx * Ls / 2, tcy = DH + dy * Ls / 2;   // centre of the top surface
    const scx = tcx - nx * DT / 2, scy = tcy - ny * DT / 2;
    put(deckMat, boxG(Ls, DT, 2 * DW, scx, scy, SZ, rz));
    obb(scx, scy, SZ, Ls / 2, DT / 2, DW, rz, { surface: 'asphalt', grip: GRIP.asphalt });
    put(roadMat, roadG(Ls, 2 * DW, tcx + nx * 0.005, tcy + ny * 0.005, SZ, rz));
    // solid fill under the lower half: collider is a Wedge with the same top plane as the slab
    addCollider(new Wedge(new THREE.Vector3(xBot, 0, SZ), -s * Math.PI / 2, DW, RUN / 2, DH / 2, { grip: GRIP.asphalt, surface: 'asphalt' }));
    {
      const xm = xTop + s * RUN / 2, sink = 0.3, xe = xBot - s * sink * RUN / DH;
      const sh = new THREE.Shape();
      sh.moveTo(xm, 0); sh.lineTo(xe, 0); sh.lineTo(xm, DH / 2 - sink); sh.lineTo(xm, 0);
      const fg = new THREE.ExtrudeGeometry(sh, { depth: 2 * DW - 0.1, bevelEnabled: false });
      fg.translate(0, 0, SZ - DW + 0.05);
      put(deckMat, fg);
    }
    // barriers following the slope
    for (const k of [-1, 1]) {
      const bz = SZ + k * (DW - BT / 2 - 0.02);
      const off = (BH - 0.4) / 2;
      solid(barrierMat, Ls, BH + 0.4, BT, tcx + nx * off, tcy + ny * off, bz, rz);
      put(cyanMat, boxG(Ls, 0.08, 0.25, tcx + nx * (BH + 0.04), tcy + ny * (BH + 0.04), bz, rz));
      const fl = RL - 1, fo = 0.35;
      put(cyanMat, boxG(fl, 0.25, 0.1, xTop + dx * fl / 2 - nx * fo, DH + dy * fl / 2 - ny * fo, SZ + k * (DW + 0.05), rz));
    }
    // one pillar under the upper (open) half of the ramp; its top is buried in the slab
    const px = xTop + s * 15;
    const bottom = DH - 15 * DH / RUN - DT / ca;
    rampPillars.push([px, bottom + 0.25]);
    // entrance gantry with a SKYWAY sign, 15 m beyond the foot of the ramp
    const gx = xBot + s * 15;
    for (const k of [-1, 1]) solid(steelMat, 0.6, 10, 0.6, gx, 5, SZ + k * 9.4, 0, { surface: 'metal', grip: GRIP.metal });
    solid(steelMat, 0.5, 0.8, 18.2, gx, 7.2, SZ, 0, { surface: 'metal', grip: GRIP.metal });
    solid(steelMat, 0.3, 2.4, 12, gx, 8.8, SZ, 0, { surface: 'metal', grip: GRIP.metal });
    for (const f of [-1, 1]) {
      const p = new THREE.PlaneGeometry(11.6, 2.2); p.rotateY(f * Math.PI / 2); p.translate(gx + f * 0.17, 8.8, SZ);
      put(skySignMat, p);
    }
    put(cyanMat, boxG(0.12, 0.12, 18.2, gx + s * 0.27, 6.85, SZ));
  }
  // pillars on the street centre line, every 50 m, mid-block (never in an intersection: the tunnel at
  // x = -300 and the ring street at x = 100 stay clear below the deck)
  const PR = 1.3;
  const pillars = [];
  for (let x = SX0 + 25; x <= SX1 - 25 + 0.01; x += 50) {
    const m = ((x % 100) + 100) % 100;
    if (Math.min(m, 100 - m) < 16) continue;                 // keep every cross street open
    if (Math.abs(x - TX) < IW + WT + 6) continue;            // never inside / against the tunnel
    pillars.push(x);
  }
  for (const x of pillars) {
    const ph = DH - DT;
    const c = new THREE.CylinderGeometry(PR, PR, ph, 20); c.translate(x, ph / 2, SZ);
    put(deckMat, c);
    obb(x, ph / 2, SZ, PR * 0.95, ph / 2, PR * 0.95);
    solid(deckMat, 3.2, 1.0, 13, x, ph - 0.5, SZ);           // pier cap under the deck
    const ring = new THREE.CylinderGeometry(PR + 0.06, PR + 0.06, 0.35, 20, 1, true); ring.translate(x, 2.6, SZ);
    put(pinkMat, ring);
  }
  for (const [x, top] of rampPillars) {
    const c = new THREE.CylinderGeometry(PR, PR, top, 20); c.translate(x, top / 2, SZ);
    put(deckMat, c);
    obb(x, top / 2, SZ, PR * 0.95, top / 2, PR * 0.95);
    const ring = new THREE.CylinderGeometry(PR + 0.06, PR + 0.06, 0.35, 20, 1, true); ring.translate(x, 2.6, SZ);
    put(pinkMat, ring);
  }
  // street lamps on both barriers every 60 m, arms over the road
  const postH = 7, postY = DH + BH;
  for (let x = SX0 + 30; x <= SX1 - 30 + 0.01; x += 60) {
    for (const k of [-1, 1]) {
      const z = SZ + k * (DW - BT / 2 - 0.02);
      const p = new THREE.CylinderGeometry(0.12, 0.18, postH, 8); p.translate(x, postY + postH / 2, z);
      put(steelMat, p);
      put(steelMat, boxG(0.18, 0.18, 2.8, x, postY + postH - 0.1, z - k * 1.4));
      put(lampMat, boxG(0.5, 0.14, 1.3, x, postY + postH - 0.27, z - k * 2.6));
      obb(x, postY + postH / 2, z, 0.2, postH / 2, 0.2, 0, { surface: 'metal', grip: GRIP.metal });
    }
  }

  // ---------- merge and add ----------
  let meshes = 0;
  const flush = (mat, cast, receive) => {
    const geos = bins.get(mat);
    if (!geos || !geos.length) return;
    bins.delete(mat);
    const list = geos.some(g => !g.index) ? geos.map(g => (g.index ? g.toNonIndexed() : g)) : geos;
    let merged = null;
    try { merged = mergeGeometries(list, false); } catch (e) { merged = null; }
    const add = (g) => {
      const m = new THREE.Mesh(g, mat);
      m.castShadow = cast; m.receiveShadow = receive;
      m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m); meshes++;
    };
    if (merged) add(merged); else list.forEach(add);
  };
  flush(roadMat, false, true);
  flush(deckMat, true, true);
  flush(barrierMat, true, true);
  flush(steelMat, true, true);
  flush(wallMat, true, true);
  flush(glassMat, false, false);
  flush(cyanMat, false, false);
  flush(pinkMat, false, false);
  flush(lampMat, false, false);
  flush(chaseMat, false, false);
  flush(tunnelSignMat, false, false);
  flush(skySignMat, false, false);
  for (const mat of [...bins.keys()]) flush(mat, false, true);   // safety net (nothing expected)

  // ---------- animation: light chase in the tunnel + gently pulsing signs (no allocations) ----------
  if (Array.isArray(world.anim)) {
    world.anim.push((t) => {
      const ph = (t * 0.9) % 1;
      chaseTex.offset.x = Number.isFinite(ph) ? -ph : 0;
      tunnelSignMat.emissiveIntensity = 2.1 + 0.25 * Math.sin(t * 2.3);
    });
  }

  // ---------- teleports ----------
  if (Array.isArray(world.teleports)) {
    // just south of the tunnel's south portal, facing in (+z)
    world.teleports.push({ key: keyOf('tunnel', 5), name: ZONES.tunnel.name, x: TX, z: TZ0 - 20, yaw: 0 });
    // on the flat street at the foot of the west ramp, facing up it (+x)
    world.teleports.push({ key: keyOf('skyway', 6), name: ZONES.skyway.name, x: SX0 - RUN - 30, z: SZ, yaw: Math.PI / 2 });
  }
  return { meshes };
}
