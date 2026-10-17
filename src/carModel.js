// Procedural Roadster model: lofted body with fender bulges and wheel arches, glass canopy,
// thin-spoke wheels, light bars, thruster nozzles + plumes and an optional roof rocket pod.
// Garage cosmetics: wheel styles and rear wings are built once and switched with setLook().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GROUND = -0.45; // local y of the ground at rest (physics origin = centre of mass)

// station table: z, bottom, centre-top, half-width  (heights above ground)
const ST = [
  [2.25, 0.33, 0.42, 0.22],
  [2.2, 0.24, 0.49, 0.62],
  [2.1, 0.19, 0.56, 0.82],
  [1.9, 0.17, 0.63, 0.93],
  [1.6, 0.16, 0.68, 0.98],
  [1.36, 0.16, 0.71, 0.995],
  [1.0, 0.16, 0.75, 0.98],
  [0.6, 0.16, 0.79, 0.95],
  [0.0, 0.16, 0.83, 0.94],
  [-0.6, 0.16, 0.86, 0.975],
  [-1.0, 0.16, 0.88, 1.02],
  [-1.34, 0.17, 0.9, 1.04],
  [-1.75, 0.2, 0.915, 1.0],
  [-2.02, 0.26, 0.905, 0.92],
  [-2.14, 0.34, 0.885, 0.8],
  [-2.2, 0.44, 0.85, 0.56],
];
function interp(z, col) {
  // Catmull-Rom over descending z
  let i = 0;
  while (i < ST.length - 2 && z < ST[i + 1][0]) i++;
  const p0 = ST[Math.max(0, i - 1)][col], p1 = ST[i][col], p2 = ST[i + 1][col], p3 = ST[Math.min(ST.length - 1, i + 2)][col];
  const t = (ST[i][0] - z) / (ST[i][0] - ST[i + 1][0]);
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
const WHEELS_Z = [1.36, -1.34];
function bulge(z) { return 0.13 * Math.exp(-(((z - 1.36) / 0.5) ** 2)) + 0.115 * Math.exp(-(((z + 1.36) / 0.58) ** 2)); }

// cross-section point at station z and angle th (0 = right side? -> +x = left side of car)
function section(z, th, out) {
  const yb = interp(z, 1), yt = interp(z, 2), w = interp(z, 3);
  const yc = (yb + yt) * 0.5 + 0.03, hh = (yt - yb) * 0.5;
  const s = Math.sin(th), c = Math.cos(th);
  const n = s >= 0 ? 2.7 : 7;
  let X = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  let Y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  if (s > 0) {
    X *= 1 - 0.1 * s * s;
    const xn = Math.abs(X) / w;
    Y += bulge(z) * Math.exp(-(((xn - 0.74) / 0.2) ** 2)) * Math.pow(s, 0.6);
    // cowl dip in the middle of the hood
    Y -= 0.025 * Math.exp(-((xn / 0.35) ** 2)) * (z > 0.9 ? 1 : 0) * s;
  } else X *= 1 - 0.06 * s * s;
  out.set(X, Y + GROUND, z);
  return out;
}

export function makeBodyGeometry() {
  const NZ = 190, NT = 112;
  const z0 = 2.25, z1 = -2.2;
  const pos = [], col = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < NZ; i++) {
    // denser near ends
    const u = i / (NZ - 1);
    const uu = 0.5 - 0.5 * Math.cos(u * Math.PI);
    const z = z0 + (z1 - z0) * (0.35 * u + 0.65 * uu);
    for (let j = 0; j < NT; j++) {
      const th = j / NT * Math.PI * 2;
      section(z, th, p);
      const hy = p.y - GROUND;
      let dark = 0;
      // wheel arches
      for (const wz of WHEELS_Z) {
        const d = Math.hypot(p.z - wz, hy - 0.36);
        const R = 0.46;
        if (d < R + 0.05 && Math.abs(p.x) > 0.5) {
          const k = Math.min(1, Math.max(0, (R + 0.05 - d) / 0.07));
          const ks = k * k * (3 - 2 * k);
          const ax = Math.abs(p.x);
          p.x = Math.sign(p.x) * (ax + (Math.min(ax, 0.66) - ax) * ks);
          dark = Math.max(dark, ks > 0.5 ? 1 : ks * 1.2);
        }
      }
      // lower carbon skirt / diffuser / splitter
      if (hy < 0.27) dark = Math.max(dark, 0.9);
      if (p.z < -2.0 && hy < 0.5) dark = Math.max(dark, 0.95);
      // side intake behind the door
      if (Math.abs(p.x) > 0.7) {
        const e = Math.hypot((p.z + 0.62) / 0.36, (hy - 0.47 - (p.z + 0.62) * -0.12) / 0.1);
        if (e < 1.15) dark = Math.max(dark, Math.min(1, (1.15 - e) / 0.25));
      }
      // front intake
      if (p.z > 2.08 && hy < 0.36 && Math.abs(p.x) < 0.7) dark = 1;
      pos.push(p.x, p.y, p.z);
      const v = dark ? 1 - dark * 0.965 : 1;
      col.push(v, v, v);
    }
  }
  for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NT; j++) {
    const a = i * NT + j, b = i * NT + (j + 1) % NT, c = (i + 1) * NT + j, d = (i + 1) * NT + (j + 1) % NT;
    idx.push(a, c, b, b, c, d);
  }
  // caps
  const capF = pos.length / 3; section(z0, 0, p); pos.push(0, interp(z0, 1) * 0.5 + interp(z0, 2) * 0.5 + GROUND, z0 + 0.01); col.push(0.05, 0.05, 0.05);
  for (let j = 0; j < NT; j++) idx.push(capF, j, (j + 1) % NT);
  const capB = pos.length / 3; pos.push(0, interp(z1, 1) * 0.5 + interp(z1, 2) * 0.5 + GROUND, z1 - 0.01); col.push(0.05, 0.05, 0.05);
  const last = (NZ - 1) * NT;
  for (let j = 0; j < NT; j++) idx.push(capB, last + (j + 1) % NT, last + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeCanopyGeometry() {
  const NZ = 60, NT = 40;
  const prof = [[1.08, 0.0, 0.5], [0.85, 0.2, 0.58], [0.5, 0.32, 0.62], [0.05, 0.36, 0.62], [-0.4, 0.34, 0.6], [-0.8, 0.24, 0.55], [-1.08, 0.04, 0.46]];
  const at = (z, k) => {
    let i = 0; while (i < prof.length - 2 && z < prof[i + 1][0]) i++;
    const t = (prof[i][0] - z) / (prof[i][0] - prof[i + 1][0]);
    const s = t * t * (3 - 2 * t);
    return prof[i][k] + (prof[i + 1][k] - prof[i][k]) * (k === 1 ? Math.sin(t * Math.PI / 2) * 0 + s : s);
  };
  const pos = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < NZ; i++) {
    const z = 1.08 - 2.16 * i / (NZ - 1);
    section(z, Math.PI / 2, p);
    const base = p.y - 0.02;
    const h = at(z, 1), w = at(z, 2);
    for (let j = 0; j <= NT; j++) {
      const th = j / NT * Math.PI;
      const c = Math.cos(th), s = Math.sin(th);
      const X = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / 2.6);
      const Y = base + (h + 0.02) * Math.pow(s, 2 / 2.6);
      pos.push(X, Y, z);
    }
  }
  for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NT; j++) {
    const a = i * (NT + 1) + j, b = a + 1, c = a + NT + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function surf(z, th) { const p = new THREE.Vector3(); return section(z, th, p); }

function gradientTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// spoke sets for the garage wheel styles, merged into one mesh each
function spokeStyles(rimR, hw, mats) {
  const styles = {};
  const merged = (geos, mat) => { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = true; return m; };
  const at = (g, rx, x) => { g.rotateX(rx); g.translate(x, 0, 0); return g; };
  // Aero (stock): ten pairs of thin spokes
  const aero = [];
  for (let i = 0; i < 10; i++) for (const off of [-0.07, 0.07]) {
    const g = new THREE.BoxGeometry(0.018, rimR - 0.055, 0.016); g.translate(0, (rimR - 0.055) / 2 + 0.05, 0);
    aero.push(at(g, (i / 10) * Math.PI * 2 + off, hw - 0.035));
  }
  styles.aero = merged(aero, mats.rim);
  // Five-spoke: chunky
  const five = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(0.035, rimR - 0.06, 0.075); g.translate(0, (rimR - 0.06) / 2 + 0.05, 0);
    five.push(at(g, (i / 5) * Math.PI * 2, hw - 0.04));
  }
  styles.five = merged(five, mats.rim);
  // Turbine: twisted blades
  const tur = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.BoxGeometry(0.012, rimR - 0.06, 0.06); g.rotateY(0.7); g.translate(0, (rimR - 0.06) / 2 + 0.05, 0);
    tur.push(at(g, (i / 14) * Math.PI * 2, hw - 0.035));
  }
  styles.turbine = merged(tur, mats.rim);
  // Carbon disc: flat aero cover
  const disc = new THREE.CylinderGeometry(rimR - 0.008, rimR - 0.008, 0.016, 40); disc.rotateZ(Math.PI / 2); disc.translate(hw - 0.022, 0, 0);
  const ring = new THREE.TorusGeometry(rimR * 0.62, 0.008, 6, 40); ring.rotateY(Math.PI / 2); ring.translate(hw - 0.012, 0, 0);
  styles.disc = new THREE.Group();
  styles.disc.add(merged([disc], mats.carbon), merged([ring], mats.rim));
  for (const k in styles) { styles[k].visible = k === 'aero'; }
  return styles;
}

function makeWheel(mats, front) {
  const width = front ? 0.27 : 0.31;
  const R = 0.36, rimR = 0.262;
  const spinG = new THREE.Group();
  // tire (lathe around Y then rotate so axle = X)
  const hw = width / 2;
  const pts = [];
  pts.push(new THREE.Vector2(rimR - 0.01, -hw + 0.015));
  pts.push(new THREE.Vector2(R - 0.035, -hw));
  pts.push(new THREE.Vector2(R - 0.008, -hw + 0.018));
  pts.push(new THREE.Vector2(R, -hw + 0.045));
  pts.push(new THREE.Vector2(R, hw - 0.045));
  pts.push(new THREE.Vector2(R - 0.008, hw - 0.018));
  pts.push(new THREE.Vector2(R - 0.035, hw));
  pts.push(new THREE.Vector2(rimR - 0.01, hw - 0.015));
  const tireMat = mats.tire.clone();
  const tire = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  spinG.add(tire);
  // rim barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width - 0.04, 40, 1, true), mats.rimInner);
  barrel.rotation.z = Math.PI / 2;
  spinG.add(barrel);
  // lip
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.004, 0.009, 8, 48), mats.rim);
  lip.rotation.y = Math.PI / 2; lip.position.x = hw - 0.02;
  spinG.add(lip);
  const styles = spokeStyles(rimR, hw, mats);
  for (const k in styles) spinG.add(styles[k]);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 20), mats.rim);
  hub.rotation.z = Math.PI / 2; hub.position.x = hw - 0.04;
  spinG.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16), mats.dark);
  cap.rotation.z = Math.PI / 2; cap.position.x = hw - 0.012;
  spinG.add(cap);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 36), mats.disc);
  disc.rotation.z = Math.PI / 2; disc.position.x = -0.02;
  spinG.add(disc);
  const holder = new THREE.Group();
  holder.add(spinG);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.09), mats.caliper);
  caliper.position.set(0.0, 0.14, 0.09);
  caliper.rotation.x = -0.6;
  holder.add(caliper);
  return { holder, spinG, tireMat, styles };
}

export function buildCar(paint) {
  const group = new THREE.Group();
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paint.color, metalness: paint.metal, roughness: paint.rough, clearcoat: 1, clearcoatRoughness: 0.04, vertexColors: true, envMapIntensity: 1.25,
  });
  const mats = {
    paint: paintMat,
    glass: new THREE.MeshPhysicalMaterial({ color: '#0b0e13', metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.86, envMapIntensity: 1.8, clearcoat: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.86, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: '#c7ccd2', roughness: 0.22, metalness: 0.95 }),
    rimInner: new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.4, metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: '#0e0f11', roughness: 0.55, metalness: 0.3 }),
    carbon: new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.38, metalness: 0.5 }),
    disc: new THREE.MeshStandardMaterial({ color: '#7d8084', roughness: 0.35, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: '#c41e24', roughness: 0.35, metalness: 0.3 }),
    head: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f4ff', emissiveIntensity: 3.2 }),
    tail: new THREE.MeshStandardMaterial({ color: '#330000', emissive: '#ff1a1a', emissiveIntensity: 2.2 }),
    nozzle: new THREE.MeshStandardMaterial({ color: '#8b9097', roughness: 0.3, metalness: 1 }),
    nozzleGlow: new THREE.MeshStandardMaterial({ color: '#0b1014', emissive: '#7fe3ff', emissiveIntensity: 0 }),
  };

  const body = new THREE.Mesh(makeBodyGeometry(), paintMat);
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  const canopy = new THREE.Mesh(makeCanopyGeometry(), mats.glass);
  canopy.castShadow = true;
  group.add(canopy);

  // underbody
  const under = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 3.5), mats.carbon);
  under.position.set(0, GROUND + 0.17, -0.05);
  group.add(under);
  // front splitter
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.025, 0.25), mats.carbon);
  const split = splitter;
  split.position.set(0, GROUND + 0.16, 2.12);
  group.add(split);

  // headlight strips (pop-down style slits), one material per side so each can break
  mats.headL = mats.head; mats.headR = mats.head.clone();
  const heads = [];
  for (const sgn of [1, -1]) {
    const a = surf(1.98, sgn > 0 ? 0.62 : Math.PI - 0.62), b = surf(1.84, sgn > 0 ? 0.42 : Math.PI - 0.42);
    const len = a.distanceTo(b);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, len + 0.12), sgn > 0 ? mats.headL : mats.headR);
    heads.push(hl);
    hl.position.copy(a).add(b).multiplyScalar(0.5); hl.position.y += 0.005;
    hl.lookAt(b.x, b.y + 0.005, b.z);
    group.add(hl);
  }
  // full-width tail light bar following the rear outline in plan view
  const tailPts = [];
  const tailY = 0.76;
  for (let k = 0; k <= 40; k++) {
    const x = -0.82 + 1.64 * k / 40;
    let z = -2.2;
    for (; z < -1.6; z += 0.004) { if (interp(z, 3) * 0.97 >= Math.abs(x)) break; }
    tailPts.push(new THREE.Vector3(x, tailY + GROUND, z - 0.008));
  }
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tailPts), 60, 0.02, 6, false), mats.tail);
  tail.scale.y = 0.7;
  group.add(tail);
  // ducktail spoiler (active)
  const spoiler = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.022, 0.26), paintMat);
  wing.position.set(0, 0.0, -0.1);
  wing.castShadow = true;
  spoiler.add(wing);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.035, 0.03), mats.carbon);
  lip.position.set(0, 0.0, -0.23);
  spoiler.add(lip);
  spoiler.position.set(0, surf(-1.95, Math.PI / 2).y + 0.012, -1.95);
  group.add(spoiler);
  // garage rear wings (looks only)
  const deckY = surf(-1.75, Math.PI / 2).y;
  const wings = { duck: spoiler };
  {
    const gt = new THREE.Group();
    const plane = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.035, 0.34), mats.carbon); plane.position.set(0, 0.42, -0.05); plane.rotation.x = 0.12; gt.add(plane);
    for (const s of [-1, 1]) {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.16), mats.carbon); up.position.set(s * 0.45, 0.2, 0); gt.add(up);
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.4), paintMat); ep.position.set(s * 0.81, 0.43, -0.05); gt.add(ep);
    }
    gt.position.set(0, deckY, -1.85); wings.gt = gt;
    const sw = new THREE.Group();
    const plane2 = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.03, 0.38), paintMat); plane2.position.set(0, 0.55, -0.12); plane2.rotation.x = 0.16; sw.add(plane2);
    for (const s of [-1, 1]) {
      const neck = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.022, 6, 16, Math.PI * 0.75), mats.carbon); neck.rotation.y = Math.PI / 2; neck.rotation.z = Math.PI * 0.12; neck.position.set(s * 0.4, 0.28, 0.05); sw.add(neck);
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.44), mats.carbon); ep.position.set(s * 0.88, 0.56, -0.12); sw.add(ep);
    }
    sw.position.set(0, deckY, -1.8); wings.swan = sw;
    const fin = new THREE.Group();
    const finShape = new THREE.Shape(); finShape.moveTo(0, 0); finShape.lineTo(-0.55, 0); finShape.lineTo(-0.72, 0.62); finShape.lineTo(-0.5, 0.62); finShape.lineTo(0, 0);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.025, bevelEnabled: false }); finGeo.rotateY(Math.PI / 2); finGeo.translate(-0.0125, 0, 0.1);
    const finM = new THREE.Mesh(finGeo, paintMat); fin.add(finM);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.025, 0.2), mats.carbon); tip.position.set(0, 0.62, -0.52); fin.add(tip);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), mats.nozzleGlow); glow.position.set(0, 0.3, -0.3); glow.rotation.x = -0.35; fin.add(glow);
    fin.position.set(0, deckY, -1.5); wings.fin = fin;
    for (const k of ['gt', 'swan', 'fin']) { wings[k].visible = false; wings[k].traverse(o => { if (o.isMesh) o.castShadow = true; }); group.add(wings[k]); }
  }
  // mirrors
  const mirrors = [];
  for (const sgn of [1, -1]) {
    const mg = new THREE.Group();
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.04), mats.carbon);
    stalk.position.set(sgn * 0.86, GROUND + 0.93, 0.82);
    mg.add(stalk);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), paintMat);
    m.scale.set(1.1, 0.55, 0.75);
    m.position.set(sgn * 0.95, GROUND + 0.94, 0.8);
    mg.add(m);
    group.add(mg);
    mirrors.push(mg);
  }
  // simple interior (seen through glass / cockpit cam)
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.3), mats.dark);
  dash.position.set(0, GROUND + 0.86, 0.72);
  group.add(dash);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#16324a', emissiveIntensity: 1.6 }));
  screen.position.set(0.18, GROUND + 0.98, 0.62); screen.rotation.x = -0.5; screen.rotation.y = 0.15;
  group.add(screen);
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 24, Math.PI * 1.2), mats.carbon);
  yoke.position.set(0.0, GROUND + 0.95, 0.48); yoke.rotation.set(0.25, 0, Math.PI * -0.1 + Math.PI);
  group.add(yoke);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.12), mats.carbon);
  seat.position.set(0, GROUND + 0.75, -0.45); seat.rotation.x = -0.25;
  group.add(seat);

  // wheels
  const wheelObjs = [];
  const wheelPos = [[0.86, 1.36, true], [-0.86, 1.36, true], [0.88, -1.34, false], [-0.88, -1.34, false]];
  for (const [x, z, front] of wheelPos) {
    const { holder, spinG, tireMat, styles } = makeWheel(mats, front);
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.15, z);
    if (x < 0) holder.scale.x = -1;
    pivot.add(holder);
    group.add(pivot);
    wheelObjs.push({ pivot, spin: spinG, holder, tireMat, styles });
  }

  // thruster nozzles + plumes
  const gradTex = gradientTexture();
  const plumeMat = new THREE.MeshBasicMaterial({ map: gradTex, color: '#d9f6ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const plumeGeo = new THREE.ConeGeometry(0.16, 1, 20, 1, true);
  plumeGeo.translate(0, 0.5, 0); // base at nozzle, tip extends along +y (exhaust)
  const makeNozzle = (pos, exhaustDir, r) => {
    const g = new THREE.Group();
    g.position.copy(pos);
    // orient +y of group along exhaust direction
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), exhaustDir.clone().normalize());
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, 0.08, 18, 1, true), mats.nozzle);
    bell.position.y = 0.0;
    g.add(bell);
    const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.75, 18), mats.nozzleGlow);
    core.rotation.x = -Math.PI / 2; core.position.y = -0.03;
    g.add(core);
    const plume = new THREE.Mesh(plumeGeo, plumeMat.clone());
    plume.scale.set(r / 0.16, 0.001, r / 0.16);
    plume.visible = false;
    g.add(plume);
    group.add(g);
    return { group: g, plume, r };
  };
  const nozzles = { rear: [], lift: [], side: [] };
  for (const [x, y] of [[0.32, -0.12], [-0.32, -0.12], [0.62, 0.12], [-0.62, 0.12]]) nozzles.rear.push(makeNozzle(new THREE.Vector3(x, y, -2.17), new THREE.Vector3(0, 0, -1), 0.075));
  for (const [x, z] of [[0.75, 1.45], [-0.75, 1.45], [0.75, -1.45], [-0.75, -1.45]]) nozzles.lift.push(makeNozzle(new THREE.Vector3(x, GROUND + 0.15, z), new THREE.Vector3(0, -1, 0), 0.09));
  for (const sgn of [1, -1]) nozzles.side.push(makeNozzle(new THREE.Vector3(sgn * 0.97, 0.02, 1.75), new THREE.Vector3(sgn, 0, 0), 0.05));

  // roof rocket pod (hidden until picked up)
  const launcher = new THREE.Group();
  launcher.position.set(0, GROUND + 1.0, -1.25);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 20), mats.carbon);
  launcher.add(base);
  const yawG = new THREE.Group(); yawG.position.y = 0.06; launcher.add(yawG);
  const pitchG = new THREE.Group(); pitchG.position.y = 0.12; yawG.add(pitchG);
  const podMat = new THREE.MeshStandardMaterial({ color: '#2a2f35', roughness: 0.5, metalness: 0.6 });
  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.75), podMat);
  pitchG.add(pod);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.04, 0.2), new THREE.MeshStandardMaterial({ color: '#ffb547', emissive: '#ff8a00', emissiveIntensity: 0.6 }));
  stripe.position.z = -0.2; pitchG.add(stripe);
  const muzzles = [];
  for (const [x, y] of [[-0.11, 0.07], [0.11, 0.07], [-0.11, -0.07], [0.11, -0.07]]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 14, 1, true), mats.nozzle);
    tube.rotation.x = Math.PI / 2; tube.position.set(x, y, 0.38);
    pitchG.add(tube);
    const m = new THREE.Object3D(); m.position.set(x, y, 0.45); pitchG.add(m); muzzles.push(m);
  }
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), mats.carbon);
  post.position.y = 0.04; yawG.add(post);
  launcher.visible = false;
  group.add(launcher);

  // neon underglow (hack menu)
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  const gg = gc.getContext('2d');
  const grd = gg.createRadialGradient(64, 64, 8, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = grd; gg.fillRect(0, 0, 128, 128);
  const underglow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), color: '#b14cff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  underglow.rotation.x = -Math.PI / 2; underglow.position.y = GROUND + 0.04; underglow.visible = false; underglow.renderOrder = 4;
  group.add(underglow);
  // headlights (switched on at sunset / night)
  const headlights = [];
  for (const sgn of [1, -1]) {
    const L = new THREE.SpotLight('#e8f2ff', 0, 160, 0.5, 0.7, 1.2);
    L.position.set(sgn * 0.62, GROUND + 0.55, 2.0);
    L.target.position.set(sgn * 1.2, GROUND - 1.5, 26);
    group.add(L); group.add(L.target);
    headlights.push(L);
  }

  group.traverse(o => { if (o.isMesh && o !== canopy) o.castShadow = o.castShadow || false; });
  const glass0 = { color: mats.glass.color.clone(), roughness: mats.glass.roughness };
  const model = {
    group, mats, wheels: wheelObjs, nozzles, spoiler, canopy, underglow, headlights, body, mirrors, heads, tail, wings, splitter,
    launcher: { group: launcher, yaw: yawG, pitch: pitchG, muzzles },
    look: { wheels: 'aero', wing: 'duck' },
    lights: 0,           // headlight level from the time of day (0 day .. 1 night)
    broken: {},          // damaged parts: mirrorL, mirrorR, spoiler, headL, headR, tail
    setPaint(p) { paintMat.color.set(p.color); paintMat.metalness = p.metal; paintMat.roughness = p.rough; paintMat.clearcoat = p.clearcoat ?? 1; },
    // garage cosmetics
    setLook(look) {
      Object.assign(model.look, look);
      for (const w of wheelObjs) for (const k in w.styles) w.styles[k].visible = k === model.look.wheels;
      model.refreshParts();
    },
    // show / hide parts after damage or repair, and dim broken lights
    refreshParts() {
      const b = model.broken;
      for (const k in wings) wings[k].visible = k === model.look.wing && !b.spoiler;
      mirrors[0].visible = !b.mirrorL; mirrors[1].visible = !b.mirrorR; splitter.visible = !b.splitter;
      model.updateLights();
    },
    updateLights() {
      const b = model.broken, on = model.lights ? 6 : 3.2;
      mats.headL.emissiveIntensity = b.headL ? 0 : on; mats.headR.emissiveIntensity = b.headR ? 0 : on;
      heads[0].visible = !b.headL; heads[1].visible = !b.headR;
      headlights[0].intensity = b.headL ? 0 : model.lights * 320; headlights[1].intensity = b.headR ? 0 : model.lights * 320;
    },
    // cracked canopy glass after a hard hit
    setGlassCracked(k) { mats.glass.color.copy(glass0.color).lerp(new THREE.Color('#5c6a76'), k * 0.6); mats.glass.roughness = glass0.roughness + k * 0.45; },
  };
  return model;
}
