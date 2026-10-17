// Builds every zone on the map: paved areas, ramps, loop, wall ride, jump park, launch site,
// canyon rings + mesa pads, weapons range structures, props and scenery.
import * as THREE from 'three';
import { OBB, Curve, Wedge, addCollider, GRIP } from './colliders.js';
import { heightAt, ZONES, ROAD_SEGS, MESAS, fbm, isPaved } from './terrain.js';

const Y = new THREE.Vector3(0, 1, 0);

// ---------- textures ----------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function asphaltTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4a4c50'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 34 + (Math.random() < 0.03 ? 40 : 0);
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 2;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.03;
    for (let i = 0; i < 40; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#888'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 60, 0, 7); g.fill(); }
  });
}
function concreteTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#9a9890'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 22;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.025;
    for (let i = 0; i < 30; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(40,38,34,0.55)'; g.lineWidth = 3;
    for (const x of [1.5, w / 2]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(w, x); g.stroke(); }
  });
}
function textTex(lines, opts = {}) {
  const w = opts.w || 1024, h = opts.h || 256;
  return canvasTex(w, h, (g) => {
    g.fillStyle = opts.bg || '#101418'; g.fillRect(0, 0, w, h);
    if (opts.stripe) { g.fillStyle = opts.stripe; g.fillRect(0, h - 18, w, 18); }
    g.fillStyle = opts.fg || '#f4f6f8';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const sizes = opts.sizes || [h * 0.42, h * 0.2];
    let y = lines.length === 1 ? h / 2 : h * 0.38;
    lines.forEach((ln, i) => {
      g.font = `${i === 0 ? 800 : 600} ${sizes[i] || sizes[1]}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
      g.fillStyle = i === 0 ? (opts.fg || '#f4f6f8') : (opts.fg2 || '#9fb3c2');
      g.fillText(ln, w / 2, y);
      y += h * 0.32;
    });
  }, false);
}

export class World {
  constructor(scene, destruction) {
    this.scene = scene;
    this.d = destruction;
    this.refuelPads = [];   // {x, y, z, r, name}
    this.rings = [];
    this.pickups = [];
    this.teleports = [];
    this.anim = [];         // per-frame animated things
    this.landingPads = [];
    this.mats = {
      asphalt: new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      pad: new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      paint: new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      yellow: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      steel: new THREE.MeshStandardMaterial({ color: '#9ea4ab', roughness: 0.35, metalness: 0.85 }),
      darkSteel: new THREE.MeshStandardMaterial({ color: '#3b4148', roughness: 0.5, metalness: 0.7 }),
      ramp: new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.45, metalness: 0.6 }),
      rampTop: new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g) => { g.fillStyle = '#5a6068'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#6c737c'; for (let i = 0; i < 256; i += 32) { g.fillRect(0, i, 256, 3); } g.fillStyle = '#f2c230'; g.fillRect(0, 0, 14, 256); g.fillRect(242, 0, 14, 256); }), roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
      concrete: new THREE.MeshStandardMaterial({ color: '#c7c2b6', roughness: 0.92 }),
      white: new THREE.MeshStandardMaterial({ color: '#eef0f2', roughness: 0.5, metalness: 0.1 }),
      glass: new THREE.MeshStandardMaterial({ color: '#1b2a38', roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6 }),
      glowCyan: new THREE.MeshStandardMaterial({ color: '#0a1a20', emissive: '#7fe3ff', emissiveIntensity: 2.2 }),
      glowRed: new THREE.MeshStandardMaterial({ color: '#200505', emissive: '#ff3b2f', emissiveIntensity: 2.4 }),
      glowAmber: new THREE.MeshStandardMaterial({ color: '#201405', emissive: '#ffb547', emissiveIntensity: 2.2 }),
      rubber: new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.9 }),
      orange: new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.6 }),
    };
  }

  build() {
    this.buildPaved();
    this.buildHQ();
    this.buildDragStrip();
    this.buildHandling();
    this.buildLaunchSite();
    this.buildDemoRamp();
    this.buildLoop();
    this.buildWallRide();
    this.buildJumpPark();
    this.buildCanyon();
    this.buildWeaponsRange();
    this.buildScenery();
    this.buildSigns();
    this.flushBatches();
  }

  // ---------- helpers ----------
  quad(cx, cz, hw, hd, yaw, mat, y = 0.02, uvScale = 8) {
    const g = new THREE.PlaneGeometry(hw * 2, hd * 2);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * hw * 2 / uvScale, uv.getY(i) * hd * 2 / uvScale);
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx, y, cz); m.rotation.y = yaw || 0;
    m.receiveShadow = true;
    // painted markings are merged into one mesh per material at the end of build()
    if (mat === this.mats.paint || mat === this.mats.yellow) { this.batch(m); return m; }
    this.scene.add(m);
    return m;
  }
  batch(m) {
    m.updateMatrix();
    const g = m.geometry.clone().applyMatrix4(m.matrix);
    if (!this.batches) this.batches = new Map();
    if (!this.batches.has(m.material)) this.batches.set(m.material, []);
    this.batches.get(m.material).push(g);
  }
  flushBatches() {
    if (!this.batches) return;
    for (const [mat, geos] of this.batches) {
      const mesh = new THREE.Mesh(mergeGeos(geos, true), mat);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    this.batches = null;
  }
  box(x, y, z, w, h, d, mat, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    if (opts.yaw) m.rotation.y = opts.yaw;
    m.castShadow = opts.shadow !== false; m.receiveShadow = true;
    this.scene.add(m);
    if (opts.collide !== false) addCollider(new OBB(m.position, m.quaternion, new THREE.Vector3(w / 2, h / 2, d / 2), { grip: opts.grip ?? GRIP.concrete, surface: opts.surface || 'concrete' }));
    return m;
  }
  cyl(x, y, z, r, h, mat, opts = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(opts.rTop ?? r, r, h, opts.seg || 32), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    if (opts.collide !== false) addCollider(new OBB(m.position, new THREE.Quaternion(), new THREE.Vector3(r * 0.9, h / 2, r * 0.9), { surface: 'metal' }));
    return m;
  }
  wedge(x, z, yaw, hw, L, H, opts = {}) {
    const y0 = heightAt(x, z);
    const w = addCollider(new Wedge(new THREE.Vector3(x, y0, z), yaw, hw, L, H, { grip: GRIP.concrete }));
    // visual: prism
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(L, 0); shape.lineTo(L, H); shape.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: hw * 2, bevelEnabled: false });
    g.translate(0, 0, -hw);
    // map shape (x=along, y=up, z=width) into wedge local (z along, y up, x width)
    g.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(g, opts.mat || this.mats.ramp);
    m.position.set(x, y0, z); m.rotation.y = yaw;
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    w.mesh = m;
    if (opts.noStripes) return w;
    // chevrons on top
    const a = Math.atan2(H, L), len = Math.hypot(L, H);
    for (let i = 0; i < Math.floor(len / 4); i++) {
      const t = (i + 0.5) * 4 / len;
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.6, 0.5), this.mats.yellow);
      stripe.rotation.order = 'YXZ';
      stripe.rotation.set(-Math.PI / 2 - a, yaw, 0, 'YXZ');
      const lz = t * L, ly = t * H + 0.03;
      stripe.position.set(x + Math.sin(yaw) * lz, y0 + ly, z + Math.cos(yaw) * lz);
      this.batch(stripe);
    }
    return w;
  }
  sign(x, z, yaw, lines, opts = {}) {
    const y0 = heightAt(x, z);
    const w = opts.w || 10, h = opts.h || 2.6, post = opts.post ?? 3.5;
    const th = 256, tw = Math.max(256, Math.round(th * w / h / 64) * 64);
    const tex = textTex(lines, { ...opts, stripe: opts.stripe || '#7fe3ff', w: tw, h: th, sizes: opts.sizes || [th * 0.4, th * 0.19] });
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25), [this.mats.darkSteel, this.mats.darkSteel, this.mats.darkSteel, this.mats.darkSteel,
      new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.22, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.22, roughness: 0.7 })]);
    board.position.set(x, y0 + post + h / 2, z); board.rotation.y = yaw;
    board.castShadow = true;
    this.scene.add(board);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, post + h, 0.25), this.mats.darkSteel);
      p.position.set(x + Math.cos(yaw) * s * (w / 2 - 0.6), y0 + (post + h) / 2, z - Math.sin(yaw) * s * (w / 2 - 0.6));
      p.castShadow = true;
      this.scene.add(p);
      addCollider(new OBB(p.position, p.quaternion, new THREE.Vector3(0.15, (post + h) / 2, 0.15), { surface: 'metal' }));
    }
    return board;
  }
  lightPole(x, z, h = 12) {
    const y0 = heightAt(x, z);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, h, 10), this.mats.darkSteel);
    p.position.set(x, y0 + h / 2, z); p.castShadow = true; this.scene.add(p);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.5), this.mats.darkSteel);
    head.position.set(x, y0 + h, z); this.scene.add(head);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.4), this.mats.glowAmber);
    lamp.position.set(x, y0 + h - 0.11, z); this.scene.add(lamp);
    addCollider(new OBB(p.position, p.quaternion, new THREE.Vector3(0.18, h / 2, 0.18), { surface: 'metal' }));
  }
  airPad(x, z, r, name) {
    const y = heightAt(x, z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 64), new THREE.MeshStandardMaterial({ color: '#2d3238', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, y + 0.03, z); disc.receiveShadow = true;
    this.scene.add(disc);
    const ringMat = this.mats.glowCyan.clone();
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.6, r - 0.2, 64), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.05, z);
    this.scene.add(ring);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.1, r * 0.55), new THREE.MeshBasicMaterial({
      map: textTex(['AIR'], { bg: 'rgba(0,0,0,0)', fg: '#7fe3ff', w: 512, h: 256, sizes: [200] }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    }));
    label.rotation.x = -Math.PI / 2;
    const lg = new THREE.Group(); lg.position.set(x, y + 0.06, z); lg.rotation.y = -0.44 + Math.PI; lg.add(label);
    this.scene.add(lg);
    this.refuelPads.push({ x, y, z, r, name, ringMat });
    this.anim.push((t) => { ringMat.emissiveIntensity = 1.6 + Math.sin(t * 3) * 0.6; });
  }

  // ---------- paved areas ----------
  buildPaved() {
    const rects = [
      [0, 0, 95, 95, 'pad'], [625, -150, 540, 15, 'asphalt'], [-330, -210, 150, 120, 'pad'], [-170, 360, 90, 90, 'pad'],
      [250, 205, 30, 130, 'asphalt'], [548, 210, 34, 150, 'asphalt'], [860, 400, 170, 60, 'pad'], [-620, 170, 170, 150, 'pad'], [640, -560, 70, 40, 'pad'],
    ];
    rects.forEach(([cx, cz, hw, hd, m], i) => this.quad(cx, cz, hw, hd, 0, this.mats[m], 0.02 + i * 0.002));
    for (const r of ROAD_SEGS) {
      const dx = r.bx - r.ax, dz = r.bz - r.az, len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      this.quad((r.ax + r.bx) / 2, (r.az + r.bz) / 2, r.hw, len / 2 + r.hw, yaw, this.mats.asphalt, 0.015);
      // dashed centre line
      const n = Math.floor(len / 9);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        this.quad(r.ax + dx * t, r.az + dz * t, 0.12, 1.6, yaw, this.mats.yellow, 0.04, 1);
      }
    }
  }

  // ---------- HQ ----------
  buildHQ() {
    this.airPad(0, 0, 13, 'HQ');
    // hangar
    const hx = -52, hz = 52;
    this.box(hx, 0, hz, 44, 14, 30, this.mats.white);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(32, 11), this.mats.darkSteel);
    door.position.set(hx, 5.5, hz - 15.02); door.rotation.y = Math.PI; this.scene.add(door);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.5, 44, 32, 1, false, 0, Math.PI), this.mats.steel);
    roof.rotation.z = Math.PI / 2; roof.rotation.y = 0; roof.scale.set(1, 1, 0.35); roof.position.set(hx, 14, hz);
    roof.castShadow = true; this.scene.add(roof);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(44.2, 0.4, 0.3), this.mats.glowCyan);
    strip.position.set(hx, 12.4, hz - 15.1); this.scene.add(strip);
    // ops building + tower
    this.box(58, 0, 58, 22, 7, 16, this.mats.concrete);
    this.box(64, 7, 62, 6, 16, 6, this.mats.concrete);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(5, 4, 4, 8), this.mats.glass);
    cab.position.set(64, 25, 62); cab.castShadow = true; this.scene.add(cab);
    const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.6, 8), this.mats.darkSteel);
    cabRoof.position.set(64, 27.3, 62); this.scene.add(cabRoof);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), this.mats.glowRed);
    beacon.position.set(64, 28.2, 62); this.scene.add(beacon);
    this.anim.push((t) => { beacon.visible = (t % 1.4) < 0.5; });
    addCollider(new OBB(new THREE.Vector3(64, 25, 62), new THREE.Quaternion(), new THREE.Vector3(5, 2.6, 5), { surface: 'metal' }));
    for (const [x, z] of [[-30, -30], [30, -30], [-30, 30], [30, 30]]) this.lightPole(x, z, 12);
    // parked lineup of chargers
    for (let i = 0; i < 6; i++) {
      const x = -80 + i * 6, z = -60;
      this.box(x, 0, z, 0.5, 1.8, 0.5, this.mats.white, { surface: 'metal' });
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), this.mats.glowRed); glow.position.set(x, 1.6, z); this.scene.add(glow);
    }
    this.teleports.push({ key: 1, name: 'Air Station HQ', x: 0, z: 0, yaw: -0.44 });
  }

  // ---------- drag strip ----------
  buildDragStrip() {
    const z0 = -150, xs = 150;
    // lane lines
    this.quad(625, z0, 540, 0.12, 0, this.mats.paint, 0.045, 1);
    for (const s of [-1, 1]) this.quad(625, z0 + s * 14, 540, 0.15, 0, this.mats.paint, 0.045, 1);
    // start / 1/8 / 1/4 lines
    const lines = [[xs, 'START'], [xs + 201.17, '1/8 MILE'], [xs + 402.34, '1/4 MILE'], [xs + 804.67, '1/2 MILE']];
    for (const [x] of lines) this.quad(x, z0, 0.4, 14.5, 0, this.mats.paint, 0.046, 1);
    // checkered start
    for (let i = 0; i < 29; i++) if (i % 2 === 0) this.quad(xs - 1.2, z0 - 14 + i, 0.4, 0.5, 0, this.mats.paint, 0.047, 1);
    // timing tree
    const tree = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), this.mats.darkSteel); pole.position.y = 2; tree.add(pole);
    const lamps = [];
    for (let i = 0; i < 5; i++) {
      const col = i < 3 ? '#ffb547' : (i === 3 ? '#3dff7a' : '#ff3b2f');
      const m = new THREE.MeshStandardMaterial({ color: '#111', emissive: col, emissiveIntensity: 0.15 });
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), m);
      l.position.set(0, 3.6 - i * 0.42, 0.2); tree.add(l); lamps.push(m);
    }
    tree.position.set(xs - 4, 0, z0 + 16.5); tree.rotation.y = -Math.PI / 2;
    this.scene.add(tree);
    this.dragTree = lamps;
    addCollider(new OBB(new THREE.Vector3(xs - 4, 2, z0 + 16.5), new THREE.Quaternion(), new THREE.Vector3(0.3, 2, 0.3), { surface: 'metal' }));
    // gantries
    for (const [x, label] of lines) {
      for (const s of [-1, 1]) this.box(x, 0, z0 + s * 17, 0.6, 9, 0.6, this.mats.darkSteel, { surface: 'metal' });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 35), this.mats.darkSteel);
      beam.position.set(x, 8, z0); beam.castShadow = true; this.scene.add(beam);
      for (const s of [-1, 1]) {
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(30, 1.9), new THREE.MeshStandardMaterial({ map: textTex([label], { w: 1024, h: 128, sizes: [96] }), emissive: '#ffffff', emissiveIntensity: 0.4, emissiveMap: null }));
        pl.material.emissiveMap = pl.material.map;
        pl.position.set(x + s * 0.42, 8, z0); pl.rotation.y = s * Math.PI / 2; this.scene.add(pl);
      }
    }
    // distance boards along the side
    for (let d = 100; d <= 900; d += 100) this.sign(xs + d, z0 - 22, Math.PI / 2, [`${d} m`], { w: 4, h: 1.6, post: 1.5, sizes: [150] });
    this.teleports.push({ key: 2, name: 'Drag Strip', x: xs, z: z0 - 6, yaw: Math.PI / 2 });
    this.dragStart = { x: xs, z: z0 };
  }

  // ---------- handling pad ----------
  buildHandling() {
    const cx = -400, cz = -200, R = 42;
    // skidpad ring lines
    for (const r of [R - 6, R + 6]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.15, r + 0.15, 128), this.mats.paint);
      ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.05, cz); this.scene.add(ring);
    }
    // slalom cones
    const coneGeo = new THREE.ConeGeometry(0.22, 0.7, 14); coneGeo.translate(0, 0.35, 0);
    const coneMat = this.mats.orange;
    const addCone = (x, z) => {
      const m = new THREE.Mesh(coneGeo, coneMat); m.castShadow = true;
      m.position.set(x, heightAt(x, z), z);
      this.scene.add(m);
      this.d.prop(m, new THREE.Vector3(0.2, 0.35, 0.2), 5);
    };
    for (let i = 0; i < 14; i++) { const x = -440 + i * 14, z = -300 + (i % 2 ? 3 : -3); addCone(x, z); }
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; addCone(cx + Math.cos(a) * (R - 6.5), cz + Math.sin(a) * (R - 6.5)); }
    // lane change box
    for (let i = 0; i < 6; i++) { addCone(-260 + i * 4, -120); addCone(-260 + i * 4, -126); addCone(-232 + i * 4, -116); addCone(-232 + i * 4, -110); }
    this.teleports.push({ key: 0, name: 'Handling Pad', x: -250, z: -210, yaw: -Math.PI / 2 });
  }

  // ---------- launch site ----------
  buildLaunchSite() {
    const tx = -195, tz = 400;
    // lattice tower (visual frame + solid collider core)
    const towerH = 120;
    const frame = new THREE.Group();
    const leg = new THREE.BoxGeometry(0.9, towerH, 0.9);
    for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { const m = new THREE.Mesh(leg, this.mats.darkSteel); m.position.set(x, towerH / 2, z); m.castShadow = true; frame.add(m); }
    const brace = new THREE.BoxGeometry(12.5, 0.4, 0.4);
    for (let y = 4; y < towerH; y += 6) {
      for (const [x, z, r] of [[0, -6, 0], [0, 6, 0], [-6, 0, Math.PI / 2], [6, 0, Math.PI / 2]]) {
        const b = new THREE.Mesh(brace, this.mats.darkSteel); b.position.set(x, y, z); b.rotation.y = r; frame.add(b);
        const d = new THREE.Mesh(brace, this.mats.darkSteel); d.position.set(x, y + 3, z); d.rotation.y = r; d.rotation.z = r ? 0 : 0.45; d.rotation.x = r ? 0.45 : 0; frame.add(d);
      }
    }
    // merge the lattice into a single mesh
    const parts = [];
    frame.updateMatrixWorld(true);
    frame.children.forEach(ch => { ch.updateMatrix(); parts.push(ch.geometry.clone().applyMatrix4(ch.matrix)); });
    const lattice = new THREE.Mesh(mergeGeos(parts), this.mats.darkSteel);
    lattice.position.set(tx, 0, tz); lattice.castShadow = true; lattice.receiveShadow = true;
    this.scene.add(lattice);
    addCollider(new OBB(new THREE.Vector3(tx, towerH / 2, tz), new THREE.Quaternion(), new THREE.Vector3(6.4, towerH / 2, 6.4), { surface: 'metal' }));
    // catch arms
    for (const s of [-1, 1]) {
      const arm = this.box(tx + 18, 92, tz + s * 5.5, 24, 1.6, 1.6, this.mats.steel, { surface: 'metal' });
      arm.rotation.y = 0;
    }
    const topLight = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), this.mats.glowRed);
    topLight.position.set(tx, towerH + 1, tz); this.scene.add(topLight);
    this.anim.push((t) => { topLight.visible = (t % 2) < 0.8; });
    // launch mount
    const mx = -150, mz = 400;
    this.box(mx, 0, mz, 26, 2, 26, this.mats.concrete);
    for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) this.box(mx + x, 2, mz + z, 3, 18, 3, this.mats.concrete);
    this.box(mx, 20, mz, 24, 2.5, 24, this.mats.darkSteel, { surface: 'metal' });
    // rocket (booster + ship), stainless steel
    const steel = new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.28, metalness: 0.92 });
    const booster = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 70, 48), steel);
    booster.position.set(mx, 22.5 + 35, mz); booster.castShadow = true; this.scene.add(booster);
    const ship = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 40, 48), steel);
    ship.position.set(mx, 22.5 + 70 + 20, mz); ship.castShadow = true; this.scene.add(ship);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(4.5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), steel);
    nose.scale.y = 2.4; nose.position.set(mx, 22.5 + 110, mz); nose.castShadow = true; this.scene.add(nose);
    const heat = new THREE.Mesh(new THREE.CylinderGeometry(4.52, 4.52, 40, 48, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.7 }));
    heat.position.copy(ship.position); this.scene.add(heat);
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 10, 5), steel);
      fin.position.set(mx + s * 5.5, 22.5 + 74, mz); fin.rotation.z = s * 0.1; this.scene.add(fin);
      const fin2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 3), steel);
      fin2.position.set(mx + s * 5.2, 22.5 + 112, mz); this.scene.add(fin2);
    }
    for (let i = 0; i < 4; i++) { // grid fins
      const a = i * Math.PI / 2;
      const gf = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 0.3), this.mats.darkSteel);
      gf.position.set(mx + Math.cos(a) * 5.8, 22.5 + 66, mz + Math.sin(a) * 5.8); gf.rotation.y = -a + Math.PI / 2; this.scene.add(gf);
    }
    addCollider(new OBB(new THREE.Vector3(mx, 22.5 + 60, mz), new THREE.Quaternion(), new THREE.Vector3(4.3, 60, 4.3), { surface: 'metal' }));
    // tank farm
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 22, 24), this.mats.white);
      t.rotation.z = Math.PI / 2; t.position.set(-230 + 0, 3.2, 300 + i * 7); t.castShadow = true; this.scene.add(t);
      addCollider(new OBB(t.position, new THREE.Quaternion(), new THREE.Vector3(11, 2.6, 2.6), { surface: 'metal' }));
    }
    this.lightPole(-110, 320, 16); this.lightPole(-230, 440, 16);
    this.teleports.push({ key: 0, name: 'Launch Site', x: -170, z: 300, yaw: 0 });
  }

  // curved ribbon mesh for a Curve collider
  curveMesh(c, segs, mat, rails = true) {
    const pos = [], uv = [], idx = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      const phi = c.phiMax * i / segs;
      const xc = c.xc(phi);
      for (let j = 0; j <= 1; j++) {
        const lx = xc + (j ? c.hw : -c.hw);
        c.toWorld(lx, c.R - c.R * Math.cos(phi) + 0.0, c.R * Math.sin(phi), p);
        pos.push(p.x, p.y + 0.02 * Math.cos(phi), p.z);
        uv.push(j, phi * c.R / 8);
      }
    }
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    if (rails) {
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= segs; i++) {
          const phi = c.phiMax * i / segs;
          const R2 = c.R - 0.5;
          pts.push(c.toWorld(c.xc(phi) + side * (c.hw + 0.15), c.R - R2 * Math.cos(phi), R2 * Math.sin(phi), new THREE.Vector3()));
        }
        if (!this.mats.rail) this.mats.rail = new THREE.MeshStandardMaterial({ color: '#2a1a05', emissive: '#ffb547', emissiveIntensity: 0.9 });
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, 0.18, 8), this.mats.rail);
        this.scene.add(tube);
      }
      // outer shell (back side) in steel
      const back = m.clone(); back.material = this.mats.darkSteel; back.scale.set(1, 1, 1);
      const bg = g.clone(); const bp = bg.getAttribute('position');
      for (let i = 0; i <= segs; i++) {
        const phi = c.phiMax * i / segs;
        for (let j = 0; j <= 1; j++) {
          const k = i * 2 + j;
          const lx = c.xc(phi) + (j ? c.hw : -c.hw);
          const R2 = c.R + 0.5;
          c.toWorld(lx, c.R - R2 * Math.cos(phi), R2 * Math.sin(phi), p);
          bp.setXYZ(k, p.x, p.y, p.z);
        }
      }
      bg.computeVertexNormals();
      back.geometry = bg;
      back.material = new THREE.MeshStandardMaterial({ color: '#2f343a', roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide });
      this.scene.add(back);
    }
    return m;
  }

  // ---------- demo ramp (170 degrees) ----------
  buildDemoRamp() {
    const ox = 250, oz = 300, R = 12;
    const c = addCollider(new Curve(new THREE.Vector3(ox, 0, oz), 0, R, 6, 170 * Math.PI / 180, { thickness: 0.9 }));
    this.curveMesh(c, 90, this.mats.rampTop);
    // support tower behind + top truss
    this.box(ox, 0, oz + R + 3.2, 14, 26, 4.6, this.mats.darkSteel, { surface: 'metal' });
    for (const s of [-1, 1]) {
      this.box(ox + s * 6.6, 0, oz + 6, 0.8, 25, 0.8, this.mats.steel, { surface: 'metal' });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 14), this.mats.steel);
      beam.position.set(ox + s * 6.6, 25, oz + 7); this.scene.add(beam);
    }
    // telemetry board like the reveal event
    this.sign(ox - 24, oz - 10, Math.PI / 2 - 0.5, ['DEMO RAMP', '170° · fan suction · flip + hover'], { w: 14, h: 4 });
    // runway arrows
    for (let i = 0; i < 6; i++) this.quad(ox, 120 + i * 28, 0.3, 6, 0, this.mats.paint, 0.045, 1);
    this.teleports.push({ key: 3, name: 'Demo Ramp 170°', x: ox, z: 110, yaw: 0 });
  }

  // ---------- full loop ----------
  buildLoop() {
    const ox = 548, oz = 260, R = 14, shift = -11;
    const c = addCollider(new Curve(new THREE.Vector3(ox, 0, oz), 0, R, 5, Math.PI * 2, { shift, thickness: 0.9 }));
    this.curveMesh(c, 160, this.mats.rampTop);
    // A-frame supports
    for (const s of [-1, 1]) {
      const lx = s > 0 ? 8 : -19;
      for (const dz of [-6, 6]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 30, 0.7), this.mats.steel);
        leg.position.set(ox + lx, 15, oz + R * 0 + dz * 0.7); leg.rotation.x = dz > 0 ? -0.2 : 0.2; leg.castShadow = true; this.scene.add(leg);
      }
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(28, 0.8, 0.8), this.mats.steel);
    top.position.set(ox - 5.5, 29.5, oz); this.scene.add(top);
    for (const lx of [8, -19]) addCollider(new OBB(new THREE.Vector3(ox + lx, 15, oz), new THREE.Quaternion(), new THREE.Vector3(0.6, 15, 1.2), { surface: 'metal' }));
    // guide line on the approach (helix angle)
    const beta = Math.atan2(shift / (2 * Math.PI * R), 1);
    for (let z = 80; z < oz - 4; z += 8) {
      const x = ox + (z - oz) * Math.tan(beta);
      this.quad(x, z, 0.25, 2.5, beta, this.mats.yellow, 0.045, 1);
    }
    for (let z = oz + 6; z < 355; z += 8) {
      const x = ox + shift + (z - oz) * Math.tan(beta);
      this.quad(x, z, 0.25, 2.5, beta, this.mats.yellow, 0.045, 1);
    }
    this.sign(ox + 30, oz - 40, -Math.PI / 2 + 0.4, ['LOOP OF DEATH', 'follow the yellow line · 50+ mph'], { w: 14, h: 4 });
    const zStart = 120;
    this.teleports.push({ key: 4, name: 'Loop of Death', x: ox + (zStart - oz) * Math.tan(beta), z: zStart, yaw: beta });
    this.loopInfo = { ox, oz, beta };
  }

  // ---------- wall ride ----------
  buildWallRide() {
    const ox = 860, oz = 445, R = 10, hw = 110;
    const c = addCollider(new Curve(new THREE.Vector3(ox, 0, oz), 0, R, hw, Math.PI / 2, { thickness: 0.9 }));
    this.curveMesh(c, 40, this.mats.rampTop, false);
    // vertical wall above the curve
    const wallH = 18;
    const wall = this.box(ox, R, oz + R + 0.45, hw * 2, wallH, 0.9, this.mats.rampTop, { surface: 'metal', grip: GRIP.metal });
    // solid fill behind the quarter pipe
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.05); sh.lineTo(R + 2, -0.05); sh.lineTo(R + 2, R); sh.lineTo(R, R);
    for (let i = 1; i <= 24; i++) { const ph = Math.PI / 2 * (1 - i / 24); sh.lineTo(R * Math.sin(ph) + 0.05, R - R * Math.cos(ph) - 0.05); }
    const fg = new THREE.ExtrudeGeometry(sh, { depth: hw * 2, bevelEnabled: false });
    fg.translate(0, 0, -hw); fg.rotateY(-Math.PI / 2);
    const fill = new THREE.Mesh(fg, this.mats.darkSteel);
    fill.position.set(ox, 0, oz); fill.receiveShadow = true; fill.castShadow = true; this.scene.add(fill);
    addCollider(new OBB(new THREE.Vector3(ox, R / 2, oz + R + 1.5), new THREE.Quaternion(), new THREE.Vector3(hw, R / 2, 1), { surface: 'metal' }));
    // lights along the top
    for (let x = -hw; x <= hw; x += 20) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 0.3), this.mats.glowCyan);
      l.position.set(ox + x, R + wallH - 0.4, oz + R - 0.05); this.scene.add(l);
    }
    // height markers on the wall
    for (let h = 5; h <= 25; h += 5) {
      const mk = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 0.25), this.mats.yellow);
      if (h > R) { mk.position.set(ox, h, oz + R - 0.02); mk.rotation.y = Math.PI; this.scene.add(mk); }
    }
    this.sign(ox - hw - 18, 380, Math.PI / 2, ['WALL RIDE', 'angle in fast · fan keeps you on'], { w: 14, h: 4 });
    this.teleports.push({ key: 5, name: 'Wall Ride', x: ox - hw - 10, z: 395, yaw: Math.PI / 2 });
  }

  // ---------- jump park ----------
  buildJumpPark() {
    const cx = -620, cz = 170;
    // lineup jump: approach heading -x
    const jz = 230;
    this.wedge(-560, jz, -Math.PI / 2, 7, 22, 4.4);
    // lineup: 6 cars + Semi, side by side
    const colors = ['#e9ecef', '#141518', '#9e0f17', '#8d939a', '#12305e', '#e9ecef'];
    let x = -590;
    colors.forEach((col) => {
      const car = makeSedan(col);
      car.position.set(x, heightAt(x, jz), jz); car.rotation.y = 0;
      this.scene.add(car);
      this.d.target(car, new THREE.Vector3(0.95, 0.72, 2.45), 1800, 0.72);
      x -= 2.4;
    });
    x -= 1.2;
    const semi = makeSemi();
    semi.position.set(x - 1.4, heightAt(x, jz), jz); this.scene.add(semi);
    this.d.target(semi, new THREE.Vector3(1.35, 2.0, 8.5), 9000, 2.0);
    // landing ramp (descends away from the lineup)
    this.wedge(-646, jz, Math.PI / 2, 7, 26, 4.4);
    // mega ramp (approach heading +z)
    this.wedge(-760, 150, 0, 8, 46, 13);
    this.sign(-778, 120, Math.PI / 2, ['MEGA RAMP', '13 m kicker'], { w: 9, h: 3 });
    // kickers
    for (let i = 0; i < 3; i++) this.wedge(-520 + i * 26, 70, Math.PI, 4, 9, 1.6 + i * 0.9);
    // landing distance markers beyond mega ramp
    for (let d = 20; d <= 120; d += 20) this.quad(-760, 196 + d, 8, 0.3, 0, this.mats.paint, 0.045, 1);
    this.sign(-520, 270, -Math.PI / 2, ['LINEUP JUMP', '6 cars + Semi'], { w: 10, h: 3 });
    this.teleports.push({ key: 6, name: 'Jump Park', x: -470, z: jz, yaw: -Math.PI / 2 });
  }

  // ---------- canyon ----------
  buildCanyon() {
    const pts = [
      [-600, 25, -480], [-720, 35, -520], [-800, 50, -585], [-850, 60, -655], [-780, 42, -720],
      [-700, 30, -765], [-640, 45, -720], [-560, 90, -700], [-480, 60, -760], [-470, 32, -900],
    ];
    const ringGeo = new THREE.TorusGeometry(7, 0.55, 12, 48);
    pts.forEach((p, i) => {
      const pos = new THREE.Vector3(p[0], Math.max(p[1], heightAt(p[0], p[2]) + 14), p[2]);
      const prev = i > 0 ? new THREE.Vector3(...pts[i - 1]) : pos.clone().add(new THREE.Vector3(30, 0, 40));
      const next = i < pts.length - 1 ? new THREE.Vector3(...pts[i + 1]) : pos.clone().add(pos.clone().sub(prev));
      const dir = next.clone().sub(prev); dir.y = 0; dir.normalize();
      const mat = new THREE.MeshStandardMaterial({ color: '#06151a', emissive: '#7fe3ff', emissiveIntensity: 0.6, transparent: true, opacity: 0.95 });
      const m = new THREE.Mesh(ringGeo, mat);
      m.position.copy(pos);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.scene.add(m);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: textTex([String(i + 1)], { bg: 'rgba(0,0,0,0)', fg: '#ffffff', w: 256, h: 128, sizes: [110] }), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      num.position.set(0, 9, 0); m.add(num);
      this.rings.push({ pos, normal: dir, r: 7, mesh: m, mat, index: i });
    });
    for (const m of MESAS) {
      const h = heightAt(m.x, m.z);
      this.airPad(m.x, m.z, 10, m.name);
      this.landingPads.push({ x: m.x, z: m.z, y: h, name: m.name });
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), this.mats.darkSteel);
      beacon.position.set(m.x + 12, h + 3, m.z); this.scene.add(beacon);
      const bl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), this.mats.glowCyan);
      bl.position.set(m.x + 12, h + 6.3, m.z); this.scene.add(bl);
    }
    this.sign(-575, -440, Math.PI * 0.8, ['FLIGHT CANYON', 'rings 1-10 · mesa landing pads refill air'], { w: 16, h: 4 });
    this.teleports.push({ key: 7, name: 'Flight Canyon', x: -560, z: -420, yaw: Math.atan2(-40, -60) });
  }

  // ---------- weapons range ----------
  buildWeaponsRange() {
    const d = this.d;
    // launcher pickups at the entrance
    for (const x of [610, 670]) {
      const z = -575;
      const y = heightAt(x, z);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.6, 24), this.mats.darkSteel);
      ped.position.set(x, y + 0.3, z); ped.receiveShadow = true; this.scene.add(ped);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.06, 8, 40), this.mats.glowAmber);
      ring.rotation.x = Math.PI / 2; ring.position.set(x, y + 0.62, z); this.scene.add(ring);
      const g = makeLauncherModel();
      g.position.set(x, y + 1.6, z); this.scene.add(g);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb547', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(x, y + 15, z); this.scene.add(beam);
      this.pickups.push({ x, y, z, obj: g, beam, ring });
      this.anim.push((t) => { g.rotation.y = t * 1.5; g.position.y = y + 1.6 + Math.sin(t * 2.2) * 0.25; });
    }
    this.sign(640, -530, Math.PI, ['WEAPONS RANGE', 'drive through a launcher · click or B to fire'], { w: 16, h: 4, stripe: '#ffb547' });

    // building with floors, windows and a door
    const building = (cx, cz, yaw, W, D, floors) => {
      const s = d.structure(cx, cz, yaw);
      const bh = 0.8, bt = 0.4, rowsPerFloor = 4, floorH = rowsPerFloor * bh;
      for (let f = 0; f < floors; f++) {
        for (let r = 0; r < rowsPerFloor; r++) {
          const y = f * (floorH + 0.3) + r * bh;
          const off = (r % 2) * 0.5;
          // walls along x (front z=-D/2, back z=+D/2)
          for (const wz of [-D / 2 + bt / 2, D / 2 - bt / 2]) {
            layRow(-W / 2, W / 2, off, (a, b) => {
              const mid = (a + b) / 2;
              const isWin = (r === 1 || r === 2) && Math.abs(((mid + W / 2) % 3) - 1.5) < 0.6 && Math.abs(mid) < W / 2 - 1;
              const isDoor = f === 0 && wz < 0 && r < 3 && Math.abs(mid) < 1.0;
              if (isWin || isDoor) return;
              d.block(s, mid, y, wz, b - a, bh, bt, 'concrete');
            });
          }
          // walls along z (left/right) between front & back
          for (const wx of [-W / 2 + bt / 2, W / 2 - bt / 2]) {
            layRow(-D / 2 + bt, D / 2 - bt, off, (a, b) => {
              const mid = (a + b) / 2;
              if ((r === 1 || r === 2) && Math.abs(mid) < 0.8) return;
              d.block(s, wx, y, mid, bt, bh, b - a, 'concrete');
            });
          }
        }
        // slab on top of this floor
        const sy = f * (floorH + 0.3) + floorH;
        for (let x = -W / 2; x < W / 2 - 0.01; x += 2) for (let z = -D / 2; z < D / 2 - 0.01; z += 2) {
          const sx = Math.min(2, W / 2 - x), sz = Math.min(2, D / 2 - z);
          d.block(s, x + sx / 2, sy, z + sz / 2, sx, 0.3, sz, 'concrete');
        }
      }
    };
    const wall = (cx, cz, yaw, L, rows) => {
      const s = d.structure(cx, cz, yaw);
      for (let r = 0; r < rows; r++) layRow(-L / 2, L / 2, (r % 2) * 0.4, (a, b) => d.block(s, (a + b) / 2, r * 0.4, 0, b - a, 0.4, 0.45, 'brick'), 0.8);
    };
    const silo = (cx, cz, R, levels) => {
      const s = d.structure(cx, cz, 0);
      const n = Math.round(2 * Math.PI * R / 1.15);
      for (let l = 0; l < levels; l++) for (let i = 0; i < n; i++) {
        const a = (i + (l % 2) * 0.5) / n * Math.PI * 2;
        d.block(s, Math.cos(a) * R, l * 0.9, Math.sin(a) * R, 1.2, 0.9, 0.5, 'concrete', -a + Math.PI / 2);
      }
    };
    const tower = (cx, cz) => {
      const s = d.structure(cx, cz, 0.3);
      for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) for (let l = 0; l < 6; l++) d.block(s, x, l * 1.2, z, 0.5, 1.2, 0.5, 'wood');
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) d.block(s, x * 1.25, 7.2, z * 1.25, 1.25, 0.25, 1.25, 'wood');
      for (const [x, z, w, dd] of [[0, -1.8, 3.8, 0.15], [0, 1.8, 3.8, 0.15], [-1.8, 0, 0.15, 3.4], [1.8, 0, 0.15, 3.4]]) d.block(s, x, 7.45, z, w, 1.0, dd, 'wood');
      for (let x = -1; x <= 1; x += 2) for (let z = -1; z <= 1; z += 2) d.block(s, x * 1.6, 8.45, z * 1.6, 0.3, 1.6, 0.3, 'wood');
      d.block(s, 0, 10.05, 0, 4.2, 0.3, 4.2, 'wood');
    };
    const crates = (cx, cz, yaw) => {
      const s = d.structure(cx, cz, yaw);
      for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - l; i++) for (let j = 0; j < 2; j++) d.block(s, (i - (2 - l) / 2) * 1.25, l * 1.2, j * 1.25, 1.2, 1.2, 1.2, 'crate');
    };
    building(560, -700, 0, 9, 7, 2);
    building(725, -710, 0.4, 8, 6, 2);
    building(640, -770, -0.2, 6, 6, 3);
    silo(560, -800, 3, 14);
    tower(740, -800);
    wall(600, -640, 0, 12, 8);
    wall(690, -645, 0.15, 12, 8);
    wall(780, -660, Math.PI / 2, 10, 7);
    crates(500, -720, 0.2); crates(760, -760, -0.4); crates(650, -660, 0);
    for (const [x, z] of [[585, -690], [588, -693], [583, -694], [705, -690], [702, -686], [662, -742], [665, -745], [520, -780], [523, -783], [745, -790], [600, -650], [697, -650], [580, -805], [536, -722], [540, -725]]) d.barrel(x, z);
    // junk cars
    for (const [x, z, yaw, col] of [[620, -690, 0.7, '#6a5d4d'], [690, -740, -0.3, '#3c5260'], [540, -760, 1.2, '#704030'], [760, -720, 2.1, '#556b2f']]) {
      const car = makeSedan(col, true);
      car.position.set(x, heightAt(x, z), z); car.rotation.y = yaw;
      this.scene.add(car);
      d.target(car, new THREE.Vector3(0.95, 0.72, 2.45), 1600, 0.72);
    }
    // berm behind the range
    this.teleports.push({ key: 8, name: 'Weapons Range', x: 640, z: -545, yaw: Math.PI });
  }

  // ---------- scenery ----------
  buildScenery() {
    // instanced desert scrub, cacti and rocks on natural ground
    const rng = mulberry(7);
    const bushGeo = new THREE.IcosahedronGeometry(1, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: '#7d8350', roughness: 1, flatShading: true });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#8f6a52', roughness: 0.95, flatShading: true });
    const cactusGeo = makeCactusGeo();
    const cactusMat = new THREE.MeshStandardMaterial({ color: '#4f6b3a', roughness: 0.85 });
    const NB = 2600, NR = 900, NC = 260;
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, NB), rocks = new THREE.InstancedMesh(rockGeo, rockMat, NR), cacti = new THREE.InstancedMesh(cactusGeo, cactusMat, NC);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const place = (mesh, n, minS, maxS, sink, yScale) => {
      let k = 0, tries = 0;
      while (k < n && tries < n * 20) {
        tries++;
        const x = (rng() - 0.5) * 2700, z = (rng() - 0.5) * 2700;
        if (Math.hypot(x, z) > 1350) continue;
        if (isPaved(x, z)) continue;
        if (nearFlat(x, z)) continue;
        const sc = minS + rng() * (maxS - minS);
        p.set(x, heightAt(x, z) - sink * sc, z);
        e.set(rng() * 0.3, rng() * 6.28, rng() * 0.3); q.setFromEuler(e);
        s.set(sc, sc * yScale, sc);
        mesh.setMatrixAt(k++, m.compose(p, q, s));
      }
      mesh.count = k;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    place(bushes, NB, 0.4, 1.1, 0.25, 0.6);
    place(rocks, NR, 0.2, 0.55, 0.3, 0.7);
    place(cacti, NC, 0.8, 1.5, 0, 1);
    // big boulders with colliders near canyon / dunes edges
    for (let i = 0; i < 40; i++) {
      const x = (rng() - 0.5) * 2400, z = (rng() - 0.5) * 2400;
      if (isPaved(x, z) || nearFlat(x, z) || Math.hypot(x, z) > 1250) continue;
      const r = 2 + rng() * 3;
      const b = new THREE.Mesh(rockGeo, rockMat);
      b.scale.set(r, r * 0.7, r * 1.1); b.rotation.y = rng() * 6;
      b.position.set(x, heightAt(x, z) + r * 0.2, z);
      b.castShadow = true; b.receiveShadow = true;
      this.scene.add(b);
      addCollider(new OBB(b.position, b.quaternion, new THREE.Vector3(r * 0.75, r * 0.55, r * 0.8), { surface: 'rock', grip: 0.9 }));
    }
    // power line poles along the HQ->dunes road
    for (let z = 140; z < 420; z += 40) {
      const y = heightAt(14, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 10, 8), this.mats.rubber);
      pole.position.set(14, y + 5, z); pole.castShadow = true; this.scene.add(pole);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 0.15), this.mats.rubber); bar.position.set(14, y + 9.5, z); this.scene.add(bar);
    }
  }

  buildSigns() {
    this.sign(0, 90, Math.PI, ['ROADSTER TEST SITE', 'Unofficial sim · press M for the map'], { w: 18, h: 4.4 });
    this.sign(-22, 420, 0, ['DUNES', 'off-road · low grip'], { w: 9, h: 3, stripe: '#e6c391' });
    this.sign(-150, -95, -Math.PI / 2 - 0.5, ['HANDLING PAD', 'skidpad · slalom · lane change'], { w: 12, h: 3.4 });
  }

  update(t) { for (const f of this.anim) f(t); }
}

// ---------- helpers ----------
function layRow(a0, a1, offset, fn, unit = 1.0) {
  let a = a0;
  let first = offset > 0 ? Math.min(offset, a1 - a0) : unit;
  while (a < a1 - 0.01) {
    const b = Math.min(a1, a + first);
    fn(a, b);
    a = b; first = unit;
  }
}
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function nearFlat(x, z) {
  for (const k in ZONES) { const zn = ZONES[k]; if (k === 'dunes' || k === 'canyon' || k === 'drag') continue; if (Math.hypot(x - zn.x, z - zn.z) < zn.r * 0.9) return true; }
  if (Math.abs(z + 150) < 30 && x > 60 && x < 1180) return true;
  return false;
}
function makeCactusGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.26, 3, 8); trunk.translate(0, 1.5, 0); parts.push(trunk);
  const arm1 = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8); arm1.translate(0.55, 1.9, 0); parts.push(arm1);
  const arm1b = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8); arm1b.rotateZ(Math.PI / 2); arm1b.translate(0.32, 1.35, 0); parts.push(arm1b);
  const arm2 = new THREE.CylinderGeometry(0.14, 0.14, 0.9, 8); arm2.translate(-0.5, 2.2, 0); parts.push(arm2);
  const arm2b = new THREE.CylinderGeometry(0.14, 0.14, 0.45, 8); arm2b.rotateZ(Math.PI / 2); arm2b.translate(-0.3, 1.8, 0); parts.push(arm2b);
  return mergeGeos(parts);
}
export function mergeGeos(geos, withUv = false) {
  let total = 0, itotal = 0;
  const ng = geos;
  for (const g of ng) { total += g.getAttribute('position').count; itotal += g.index.count; }
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), idx = new Uint32Array(itotal);
  const uvs = withUv ? new Float32Array(total * 2) : null;
  let vo = 0, io = 0;
  for (const g of ng) {
    pos.set(g.getAttribute('position').array, vo * 3); nrm.set(g.getAttribute('normal').array, vo * 3);
    if (uvs) uvs.set(g.getAttribute('uv').array, vo * 2);
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo;
    vo += g.getAttribute('position').count; io += ix.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); out.setIndex(new THREE.BufferAttribute(idx, 1));
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return out;
}

export function makeSedan(color, junk = false) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: junk ? 0.8 : 0.3, metalness: junk ? 0.2 : 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#111820', roughness: 0.1, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.65, 4.7), paint); body.position.y = 0.62; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.5), glass); cab.position.set(0, 1.2, -0.2); g.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 2.0), paint); roof.position.set(0, 1.5, -0.3); g.add(roof);
  for (const [x, z] of [[0.82, 1.45], [-0.82, 1.45], [0.82, -1.45], [-0.82, -1.45]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16), dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.34, z); g.add(w);
  }
  const tl = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: '#300', emissive: '#ff2020', emissiveIntensity: junk ? 0 : 1.2 })); tl.position.set(0, 0.85, -2.36); g.add(tl);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeSemi() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.35, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: '#111820', roughness: 0.1, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.8 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.2, 3.2), white); cab.position.set(0, 2.1, 6.6); g.add(cab);
  const ws = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 0.1), glass); ws.position.set(0, 3.0, 8.22); ws.rotation.x = -0.35; g.add(ws);
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 12.5), white); trailer.position.set(0, 2.4, -1.6); g.add(trailer);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.3, 12.4), new THREE.MeshStandardMaterial({ color: '#1a1c20' })); stripe.position.set(0, 1.0, -1.6); g.add(stripe);
  for (const z of [7.2, 4.6, 3.3, -6.2, -7.4]) for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16), dark); w.rotation.z = Math.PI / 2; w.position.set(s * 1.05, 0.5, z); g.add(w);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // centre the group on its box
  g.children.forEach(c => { c.position.z -= 0.3; });
  return g;
}
export function makeLauncherModel() {
  const g = new THREE.Group();
  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 1.2), new THREE.MeshStandardMaterial({ color: '#2a2f35', roughness: 0.4, metalness: 0.6 }));
  g.add(pod);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: '#ffb547', emissive: '#ff8a00', emissiveIntensity: 1.2 }));
  stripe.position.z = -0.3; g.add(stripe);
  for (const [x, y] of [[-0.16, 0.1], [0.16, 0.1], [-0.16, -0.1], [0.16, -0.1]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 14), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ff5a1a', emissiveIntensity: 0.8 }));
    t.rotation.x = Math.PI / 2; t.position.set(x, y, 0.6); g.add(t);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
