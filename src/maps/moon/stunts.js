// The Moon: Low-G Jump Zone (teleport 3) and Mega Ramp (teleport 8).
// Gravity is 0.165 g, so a car leaving a ramp flies a long way: the landing hills are wide
// tabletops (gentle up face toward the jump, flat deck, long gentle down slope) with no walls to hit.
import * as THREE from 'three';
import { addCollider, OBB, Wedge, GRIP } from '../../colliders.js';
import { heightAt } from '../../terrain.js';
import { ZONES } from './layout.js';

const PI = Math.PI;

export function build(world) {
  const scene = world.scene, M = world.mats || {};
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...extra });

  // ---------- shared materials (created once) ----------
  const darkSteel = M.darkSteel || std('#3b4148', { roughness: 0.5, metalness: 0.7 });
  const steel = M.steel || std('#9ea4ab', { roughness: 0.35, metalness: 0.85 });
  const yellow = M.yellow || std('#f2c230', { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const paint = M.paint || std('#f2f2ee', { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const amber = M.glowAmber || std('#201405', { emissive: '#ffb547', emissiveIntensity: 2.2 });
  const glowRed = M.glowRed || std('#200505', { emissive: '#ff3b2f', emissiveIntensity: 2.4 });
  const lipGlow = glowRed.clone();                                 // pulsing strips on the launch lips
  const megaGlow = (M.glowCyan || std('#0a1a20', { emissive: '#7fe3ff', emissiveIntensity: 2.2 })).clone();
  const rampMat = {
    white: std('#dfe3e8'), orange: std('#ff7a2a'), cyan: std('#36c4ff'),
    magenta: std('#e04bd8'), lime: std('#9be15d'), gold: std('#ffc53d'),
  };
  const deckMat = std('#4b5159', { roughness: 0.75, metalness: 0.35 });
  const flagMats = ['#ff3b5c', '#2fd6ff', '#ffd23f', '#3dff8a', '#d94bff', '#ff8a1f'].map(c =>
    new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.6, side: THREE.DoubleSide }));

  const Y0 = (x, z) => { const h = heightAt(x, z); return Number.isFinite(h) ? h : 0; };
  const batch = (mesh) => world.batch(mesh);                       // merged into one mesh per material at the end

  // ---------- helpers ----------
  // A wedge at an explicit base height (world.wedge always uses the ground at its start).
  // Rises from (x, y0, z) along yaw over L to height H; solid prism underneath.
  const stripeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), yellow);
  function wedgeAt(x, y0, z, yaw, hw, L, H, mat = rampMat.white, opts = {}) {
    const w = addCollider(new Wedge(new THREE.Vector3(x, y0, z), yaw, hw, L, H, { grip: GRIP.concrete }));
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(L, 0); shape.lineTo(L, H); shape.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: hw * 2, bevelEnabled: false });
    g.translate(0, 0, -hw);
    g.rotateY(-PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y0, z); m.rotation.y = yaw;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    w.mesh = m;
    const a = Math.atan2(H, L), len = Math.hypot(L, H), s = Math.sin(yaw), c = Math.cos(yaw);
    const onSlope = (t, mesh, wdt, dep, lift) => {
      mesh.geometry = new THREE.PlaneGeometry(wdt, dep);
      mesh.rotation.set(-PI / 2 - a, yaw, 0, 'YXZ');
      const lz = t * L;
      mesh.position.set(x + s * lz, y0 + t * H + lift, z + c * lz);
      batch(mesh);
    };
    if (opts.stripes !== false) {
      const n = Math.floor(len / 4);
      for (let i = 0; i < n; i++) onSlope((i + 0.5) * 4 / len, stripeMesh, hw * 1.6, 0.5, 0.03);
    }
    if (opts.lip) onSlope(Math.max(0, (len - 0.9) / len), new THREE.Mesh(undefined, lipGlow), hw * 1.9, 0.7, 0.05);
    return w;
  }

  // Ramp on the ground: starts flush with the ground at (x, z). Where the ground falls away under it
  // (crater rims, dips) a solid skirt fills the gap so it never floats.
  function ramp(x, z, yaw, hw, L, H, mat, opts = {}) {
    const y0 = Y0(x, z);
    wedgeAt(x, y0, z, yaw, hw, L, H, mat, opts);
    const s = Math.sin(yaw), c = Math.cos(yaw);
    let gmin = Infinity;
    for (let i = 1; i <= 8; i++) {
      const l = L * i / 8;
      for (const k of [-0.95, 0, 0.95]) gmin = Math.min(gmin, Y0(x + s * l + c * k * hw, z + c * l - s * k * hw));
    }
    if (gmin < y0 - 0.4) {
      world.box(x + s * L / 2, gmin - 0.5, z + c * L / 2, hw * 2, y0 - gmin + 0.5, L, deckMat, { yaw, surface: 'metal' });
    }
    return y0;
  }

  // Landing tabletop centred on (cx, cz), jump arriving along yaw: up face, flat deck, long down face.
  // Each slope starts flush with the ground at its low end; the deck box reaches down to the lowest
  // ground under it, and ramp() skirts any gap under the slopes, so nothing floats. Returns the deck top.
  function tabletop(cx, cz, yaw, hw, Lup, Ldeck, Ldown, h, mat) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const a0 = -(Ldeck / 2 + Lup), a1 = Ldeck / 2 + Ldown;
    const ux = cx + s * a0, uz = cz + c * a0, dx = cx + s * a1, dz = cz + c * a1;
    let dmin = Infinity, dmax = -Infinity;
    for (let i = 0; i <= 6; i++) {
      const l = -Ldeck / 2 + Ldeck * i / 6;
      for (const k of [-0.95, 0, 0.95]) {
        const g = Y0(cx + s * l + c * k * hw, cz + c * l - s * k * hw);
        dmin = Math.min(dmin, g); dmax = Math.max(dmax, g);
      }
    }
    const yTop = Math.max(Y0(ux, uz), Y0(dx, dz), dmax - h * 0.5) + h;
    ramp(ux, uz, yaw, hw, Lup, Math.max(0.5, yTop - Y0(ux, uz)), mat);
    ramp(dx, dz, yaw + PI, hw, Ldown, Math.max(0.5, yTop - Y0(dx, dz)), mat);
    const yb = Math.min(dmin, yTop - h) - 1;
    world.box(cx, yb, cz, hw * 2, yTop - yb, Ldeck, deckMat, { yaw, surface: 'concrete' });
    // landing target paint on the deck
    const top = yTop + 0.03;
    world.quad(cx, cz, hw * 0.9, 0.5, yaw, yellow, top, 1);
    world.quad(cx, cz, 0.5, Ldeck * 0.42, yaw, yellow, top + 0.005, 1);
    for (const k of [-1, 1]) world.quad(cx + c * k * hw * 0.92, cz - s * k * hw * 0.92, 0.35, Ldeck / 2 - 0.4, yaw, paint, top, 1);
    return yTop;
  }

  // Double-sided kicker (roller): rises to a peak at (px, pz) along yaw over Lf, falls over Lr. No walls.
  function roller(px, pz, yaw, Lf, Lr, h, hw, mat) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const yb = Math.min(Y0(px - s * Lf, pz - c * Lf), Y0(px, pz), Y0(px + s * Lr, pz + c * Lr));
    wedgeAt(px - s * Lf, yb, pz - c * Lf, yaw, hw, Lf, h, mat);
    wedgeAt(px + s * Lr, yb, pz + c * Lr, yaw + PI, hw, Lr, h, mat);
  }

  // Light pole (merged geometry, one collider)
  function lamp(x, z, h = 12, lampMat = amber) {
    const y0 = Y0(x, z);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, h, 8), darkSteel);
    p.position.set(x, y0 + h / 2, z); batch(p);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.6), darkSteel);
    head.position.set(x, y0 + h, z); batch(head);
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.5), lampMat);
    l.position.set(x, y0 + h - 0.13, z); batch(l);
    addCollider(new OBB(new THREE.Vector3(x, y0 + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(0.22, h / 2, 0.22), { surface: 'metal' }));
  }

  // Stiff "moon flag" on a post with a top bar (no wind up here). Decoration only: no collider.
  let flagN = 0;
  function flag(x, z, yaw = 0, h = 5) {
    const y0 = Y0(x, z), c = Math.cos(yaw), s = Math.sin(yaw);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, h, 6), darkSteel);
    post.position.set(x, y0 + h / 2, z); batch(post);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 0.06), darkSteel);
    bar.position.set(x + c * 1.15, y0 + h - 0.05, z - s * 1.15); bar.rotation.y = yaw; batch(bar);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.35), flagMats[flagN++ % flagMats.length]);
    f.position.set(x + c * 1.15, y0 + h - 0.75, z - s * 1.15); f.rotation.y = yaw; batch(f);
  }

  // Distance boards: one canvas atlas, all boards merged. Face south (toward the jumps).
  const LABELS = ['100 m', '150 m', '200 m', '250 m', '300 m', 'LAND', 'GAP 1', 'GAP 2'];
  let boardMat = null;
  try {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
    const g = cv.getContext('2d');
    for (let i = 0; i < LABELS.length; i++) {
      const cx = (i % 2) * 256, cy = Math.floor(i / 2) * 128;
      g.fillStyle = i < 5 ? '#101418' : '#2a0c30'; g.fillRect(cx, cy, 256, 128);
      g.fillStyle = i < 5 ? '#ffd23f' : '#ff7ae8'; g.fillRect(cx, cy + 116, 256, 12);
      g.fillStyle = '#f4f6f8'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '800 70px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      g.fillText(LABELS[i], cx + 128, cy + 58);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    boardMat = new THREE.MeshBasicMaterial({ map: tex });
  } catch (e) { boardMat = null; }
  function board(x, z, label, post = 5) {
    const i = LABELS.indexOf(label);
    const y0 = Y0(x, z);
    post += Math.max(0, -y0);            // inside a crater: tall enough to be seen from the rim
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, post, 0.18), darkSteel);
    p.position.set(x, y0 + post / 2, z + 0.12); batch(p);
    const back = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 0.1), darkSteel);
    back.position.set(x, y0 + post + 1.05, z + 0.1); batch(back);
    if (!boardMat || i < 0) return;
    const pg = new THREE.PlaneGeometry(4, 2);
    const uv = pg.getAttribute('uv'), col = i % 2, row = Math.floor(i / 2);
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / 2, 1 - (row + 1 - uv.getY(k)) / 4);
    const f = new THREE.Mesh(pg, boardMat);
    f.position.set(x, y0 + post + 1.05, z + 0.03); f.rotation.y = PI;   // faces -z (south)
    batch(f);
  }

  const ringOfFlags = (cx, cz, r, n, skip) => {
    for (let i = 0; i < n; i++) {
      const ang = (i + 0.5) / n * PI * 2, x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
      if (skip && skip(x, z)) continue;
      flag(x, z, -ang);
    }
  };

  // =====================================================================
  // LOW-G JUMP ZONE  (area x -760..-240, z 20..480; paved run-up x -700..-300, z 80..160 at y 0)
  // =====================================================================
  // Lanes run north across the run-up:
  //   lane B  x -610  -> GAP 2 (crater -610,300 r55)      teleport 3 starts here
  //   lane M  x -458  -> GAP 1 medium line (crater -430,250 r70)
  //   lane A  x -425  -> GAP 1 big line
  // West of lane B: skate park (half-pipe pair, spine, steep quarter). Between lanes B and M: fun box + hips.
  // East of lane A: a row of double-sided kickers (also greets cars arriving on the road from the base).

  // --- GAP 1: big + medium launch ramps on the crater's south side, landing tabletop past the north rim
  ramp(-425, 132, 0, 8, 32, 10, rampMat.orange, { lip: true });     // lip z 164, 10 m
  ramp(-458, 138, 0, 6, 24, 6, rampMat.cyan, { lip: true });        // lip z 162, 6 m
  tabletop(-441, 412, 0, 26, 18, 30, 34, 6, rampMat.white);         // z 379..461, 52 m wide
  // --- GAP 2: launch ramp just off the run-up, landing tabletop past the north rim
  ramp(-610, 164, 0, 7, 28, 8, rampMat.magenta, { lip: true });     // lip z 192, 8 m
  tabletop(-610, 423, 0, 22, 16, 26, 26, 5, rampMat.white);         // z 394..462, 44 m wide

  // lane paint on the run-up (paved, y 0)
  for (const [lx, z1] of [[-610, 160], [-458, 136], [-425, 130]]) {
    for (let z = 86; z < z1 - 3; z += 9) world.quad(lx, z, 0.22, 2.2, 0, paint, 0.045, 1);
  }
  world.quad(-610, 96, 6, 0.35, 0, yellow, 0.046, 1);                // start line in front of the teleport
  for (const z of [110, 140]) {                                      // arrows up lane B
    for (const k of [-1, 1]) world.quad(-610 + k * 1.8, z, 0.28, 2.6, -k * 0.8, yellow, 0.047, 1);
  }

  // distance boards beside the flight paths (metres from the lip)
  [[264, '100 m'], [314, '150 m'], [364, '200 m'], [414, '250 m'], [464, '300 m']].forEach(([z, l]) => board(-400, z, l));
  [[292, '100 m'], [342, '150 m'], [392, '200 m'], [442, '250 m']].forEach(([z, l]) => board(-582, z, l));
  board(-404, 176, 'GAP 1', 4);
  board(-634, 200, 'GAP 2', 4);
  board(-441, 372, 'LAND', 3);
  board(-610, 387, 'LAND', 3);

  // flags: around both crater rims (open on the launch side) and at the launch lips + tabletop corners
  ringOfFlags(-430, 250, 76, 14, (x, z) => z < 205 && x > -480 && x < -400);
  ringOfFlags(-610, 300, 61, 12, (x, z) => z < 260 && Math.abs(x + 610) < 25);
  for (const [x, z] of [[-436, 164], [-414, 164], [-467, 162], [-449, 162], [-620, 192], [-600, 192]]) flag(x, z, 0, 4);
  for (const [x, z] of [[-469, 379], [-413, 379], [-469, 461], [-413, 461], [-634, 394], [-586, 394], [-634, 462], [-586, 462]]) flag(x, z, 0, 6);

  // --- kicker row (double-sided rollers), east block, heading west
  roller(-346, 100, -PI / 2, 6, 8, 1.6, 5, rampMat.lime);
  roller(-372, 100, -PI / 2, 8, 10, 2.5, 5, rampMat.gold);
  roller(-400, 100, -PI / 2, 10, 12, 3.5, 5, rampMat.orange);

  // --- skate park (west block x -700..-622)
  // half-pipe-ish pair of facing steep wedges along z, with decks behind
  ramp(-668, 108, PI, 12, 9, 6, rampMat.cyan);                     // south wall, top at z 99
  world.box(-668, 0, 94.5, 24, 6, 9, deckMat, { surface: 'concrete' });
  ramp(-668, 132, 0, 12, 9, 6, rampMat.cyan);                      // north wall, top at z 141
  world.box(-668, 0, 145.5, 24, 6, 9, deckMat, { surface: 'concrete' });
  roller(-640, 120, 0, 9, 9, 3, 6, rampMat.magenta);               // spine
  ramp(-684, 120, -PI / 2, 10, 10, 7, rampMat.gold);               // steep quarter kicker, launches west
  // --- fun box + hips (middle block x -598..-470)
  world.box(-540, 0, 120, 14, 3, 14, deckMat, { surface: 'concrete' });
  ramp(-540, 103, 0, 7, 10, 3, rampMat.lime);
  ramp(-540, 137, PI, 7, 10, 3, rampMat.lime);
  ramp(-557, 120, PI / 2, 7, 10, 3, rampMat.lime);
  ramp(-523, 120, -PI / 2, 7, 10, 3, rampMat.lime);
  ramp(-584, 88, PI / 4, 4, 8, 2.2, rampMat.orange);
  ramp(-496, 88, -PI / 4, 4, 8, 2.2, rampMat.orange);

  // light poles (kept off the lanes)
  for (const x of [-690, -560, -500, -380, -320]) lamp(x, 76, 12);
  for (const [x, z] of [[-628, 186], [-592, 196], [-476, 160], [-405, 162], [-700, 166], [-540, 166]]) lamp(x, z, 12);
  // signs
  world.sign(-290, 142, PI / 2, ['LOW-G JUMP ZONE', 'gap jumps · kickers · skate park'], { w: 14, h: 4, stripe: '#ff7ae8' });
  world.sign(-640, 72, 0, ['SKATE PARK', 'half-pipe · spine · fun box'], { w: 10, h: 3, stripe: '#2fd6ff' });
  world.sign(-392, 150, 0, ['GAP 1', 'big 10 m · medium 6 m · 50+ mph'], { w: 9, h: 3, stripe: '#ff7a2a' });
  world.sign(-578, 176, 0, ['GAP 2', '8 m lip · land on the table'], { w: 9, h: 3, stripe: '#e04bd8' });

  // teleport 3: start of lane B on the paved run-up, facing the GAP 2 ramp (north)
  world.teleports.push({ key: 3, name: ZONES.jump.name, x: -610, z: 90, yaw: 0 });

  // =====================================================================
  // MEGA RAMP  (area x 120..380, z 190..470; paved run-up x 210..290, z 170..290 at y 0)
  // =====================================================================
  const mx = 250, mz = 292, mHW = 10, mL = 60, mH = 26;
  const my0 = ramp(mx, mz, 0, mHW, mL, mH, rampMat.orange, { lip: true });   // z 292..352, 26 m tall, 23 deg
  {
    const a = Math.atan2(mH, mL), len = Math.hypot(mL, mH), railH = 1.2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-a, 0, 0, 'YXZ'));
    const ny = Math.cos(a), nz = -Math.sin(a);                      // slope normal (yaw 0)
    for (const k of [-1, 1]) {
      const cx = mx + k * (mHW - 0.25);
      const cy = my0 + mH / 2 + ny * railH / 2, cz = mz + mL / 2 + nz * railH / 2;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, railH, len), steel);
      rail.position.set(cx, cy, cz); rail.quaternion.copy(q); batch(rail);
      addCollider(new OBB(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(0.25, railH / 2, len / 2), { surface: 'metal', grip: GRIP.metal }));
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, len), megaGlow);
      strip.position.set(cx, cy + ny * (railH / 2 + 0.06), cz + nz * (railH / 2 + 0.06)); strip.quaternion.copy(q); batch(strip);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), lipGlow);
      beacon.position.set(cx, my0 + mH + railH + 0.6, mz + mL - 0.3); batch(beacon);
    }
    // warning strip across the tall back face
    const back = new THREE.Mesh(new THREE.PlaneGeometry(mHW * 2, 0.6), glowRed);
    back.position.set(mx, my0 + mH - 0.6, mz + mL + 0.04); batch(back);
  }
  // landing tabletop in front of the north edge of the area (most full-speed jumps fly well past it)
  tabletop(250, 428, 0, 30, 16, 26, 26, 6, rampMat.white);          // z 399..467, 60 m wide

  // run-up paint, edge lights and poles
  world.quad(mx, 192, 12, 0.4, 0, yellow, 0.046, 1);                 // start line
  for (let z = 198; z < 288; z += 9) world.quad(mx, z, 0.25, 2.4, 0, paint, 0.045, 1);
  for (const k of [-1, 1]) world.quad(mx + k * 10, 241, 0.2, 49, 0, paint, 0.045, 1);
  for (const z of [215, 245, 275]) for (const k of [-1, 1]) world.quad(mx + k * 2.2, z, 0.3, 3, -k * 0.8, yellow, 0.047, 1);
  for (let z = 196; z <= 286; z += 15) for (const x of [212, 288]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.6), amber);
    l.position.set(x, 0.08, z); batch(l);
  }
  for (const z of [200, 235, 270]) { lamp(204, z, 12); lamp(296, z, 12); }
  lamp(232, 305, 16, megaGlow); lamp(268, 305, 16, megaGlow);
  lamp(232, 340, 32, megaGlow); lamp(268, 340, 32, megaGlow);
  lamp(214, 398, 12); lamp(286, 398, 12);
  for (const [x, z] of [[220, 399], [280, 399], [220, 467], [280, 467]]) flag(x, z, 0, 6);
  // flags around the small landing bowl east of the ramp (inside the area only)
  ringOfFlags(330, 300, 64, 12, (x, z) => x > 377 || x < 270 || z < 193 || z > 467);
  world.sign(190, 205, 0, ['MEGA RAMP', '26 m · full boost, then hover down'], { w: 12, h: 3.5, stripe: '#ff7a2a' });

  // teleport 8: south end of the paved run-up, facing the ramp
  world.teleports.push({ key: 8, name: ZONES.mega.name, x: 250, z: 180, yaw: 0 });

  // ---------- animation: pulsing lips and rail lights (no allocations) ----------
  world.anim.push((t) => {
    lipGlow.emissiveIntensity = 1.8 + Math.sin(t * 4) * 1.2;
    megaGlow.emissiveIntensity = 1.8 + Math.sin(t * 2.5) * 0.8;
  });
}
