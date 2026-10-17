// Garage (Session 1): credits, 5 upgrades with 3 levels each, cosmetics, 3 saved builds, live stats
// measured with a real test drive, and the showroom with a turntable. Saved in localStorage.
import * as THREE from 'three';
import { TRIMS, PAINTS, PHYS, MPH } from './config.js';
import { Vehicle } from './vehicle.js';
import { heightAt } from './terrain.js';

// ---------- what can be bought ----------
export const PRICES = [0, 1000, 3000, 7500];
export const UPGRADES = [
  { id: 'motor', name: 'Motor', tag: 'power + rev limit', values: { motor: [1, 1.08, 1.16, 1.25], vmax: [1, 1.03, 1.06, 1.1] },
    text: (l) => l ? `+${[0, 8, 16, 25][l]}% power, ${Math.round(233 * [1, 1.03, 1.06, 1.1][l])} mph rev limit` : 'Stock: 3 motors, 233 mph' },
  { id: 'tires', name: 'Tires', tag: 'grip, heat, wear', values: { grip: [1, 1.04, 1.08, 1.12], heat: [1, 0.85, 0.7, 0.55], wear: [1, 0.8, 0.6, 0.4] },
    text: (l) => l ? `+${[0, 4, 8, 12][l]}% grip, heat up ${[0, 15, 30, 45][l]}% slower, wear ${[0, 20, 40, 60][l]}% slower` : 'Stock street tires' },
  { id: 'fan', name: 'Fan', tag: 'downforce', values: { fan: [1, 1.1, 1.2, 1.3] },
    text: (l) => `${Math.round(4700 * [1, 1.1, 1.2, 1.3][l]).toLocaleString('en-US')} kg of fan downforce` },
  { id: 'thrust', name: 'Thrust', tag: 'all 10 thrusters', values: { thrust: [1, 1.08, 1.16, 1.25] },
    text: (l) => l ? `+${[0, 8, 16, 25][l]}% thrust on every thruster` : 'Stock cold-gas thrusters' },
  { id: 'tank', name: 'Air tank', tag: 'more air', values: { air: [1, 1.15, 1.3, 1.5] },
    text: (l) => `${Math.round(250 * [1, 1.15, 1.3, 1.5][l])} kg of air (Rocket), same 5,500 psi` },
];
const lvlVal = (up, key, l) => UPGRADES.find(u => u.id === up).values[key][l];

export const COSMETICS = {
  paint: [
    ...PAINTS.map(p => ({ ...p, price: 0 })),
    { id: 'lava', name: 'Lava Orange', color: '#d9471a', metal: 0.5, rough: 0.3, price: 600 },
    { id: 'acid', name: 'Acid Green', color: '#62b818', metal: 0.45, rough: 0.3, price: 600 },
    { id: 'ice', name: 'Ice Blue', color: '#6fc8ec', metal: 0.5, rough: 0.25, price: 800 },
    { id: 'plasma', name: 'Plasma Purple', color: '#5a22c4', metal: 0.65, rough: 0.28, price: 800 },
    { id: 'pink', name: 'Hot Pink', color: '#e8337f', metal: 0.5, rough: 0.3, price: 800 },
    { id: 'matte', name: 'Matte Stealth', color: '#1c1d20', metal: 0.15, rough: 0.72, clearcoat: 0.05, price: 1200 },
    { id: 'gold', name: 'Gold Chrome', color: '#c99a3a', metal: 1, rough: 0.14, price: 2500 },
  ],
  wheels: [
    { id: 'aero', name: 'Aero', price: 0 }, { id: 'five', name: 'Five-spoke', price: 800 },
    { id: 'turbine', name: 'Turbine', price: 1200 }, { id: 'disc', name: 'Carbon disc', price: 1500 },
  ],
  wing: [
    { id: 'duck', name: 'Active ducktail', price: 0 }, { id: 'gt', name: 'GT wing', price: 1500 },
    { id: 'swan', name: 'Swan-neck', price: 2000 }, { id: 'fin', name: 'Rocket fin', price: 2500 },
  ],
  glow: [
    { id: 'off', name: 'Off', color: null, price: 0 }, { id: 'violet', name: 'Violet', color: '#b14cff', price: 600 },
    { id: 'cyan', name: 'Cyan', color: '#3df2ff', price: 600 }, { id: 'red', name: 'Red', color: '#ff2a3a', price: 600 },
    { id: 'green', name: 'Green', color: '#3dff7a', price: 600 }, { id: 'amber', name: 'Amber', color: '#ffb547', price: 600 },
    { id: 'white', name: 'White', color: '#eef6ff', price: 600 },
  ],
  smoke: [
    { id: 'clean', name: 'Clean white', color: '#eef7ff', price: 0 }, { id: 'ice', name: 'Ice blue', color: '#7fd8ff', price: 400 },
    { id: 'red', name: 'Red', color: '#ff4d4d', price: 400 }, { id: 'green', name: 'Green', color: '#6dff8a', price: 400 },
    { id: 'violet', name: 'Violet', color: '#c77dff', price: 400 }, { id: 'gold', name: 'Gold', color: '#ffd36b', price: 400 },
  ],
};
export const KIND_NAMES = { paint: 'Paint', wheels: 'Wheels', wing: 'Rear wing', glow: 'Underglow', smoke: 'Thruster smoke' };
export const findItem = (kind, id) => COSMETICS[kind].find(x => x.id === id) || COSMETICS[kind][0];

// credits paid for each thing you do
export const EARN = { z60: 50, z60best: 200, qm: 75, ring: 25, course: 500, courseBest: 250, flip: 150, loop: 300, demo: 250, wallPerS: 40, block: 2, barrel: 25, car: 100, jumpPerM: 2, jumpPerS: 25 };

// ---------- saved profile ----------
const blankSetup = () => ({ levels: { motor: 0, tires: 0, fan: 0, thrust: 0, tank: 0 }, paint: 'red', wheels: 'aero', wing: 'duck', glow: 'off', smoke: 'clean' });
export class Profile {
  constructor(store) {
    this.store = store;
    const d = store ? store.get('garage', null) : null;
    this.d = Object.assign({ v: 1, credits: 0, earned: 0, owned: { motor: 0, tires: 0, fan: 0, thrust: 0, tank: 0 }, parts: [], setup: blankSetup(), builds: [null, null, null] }, d || {});
    this.d.owned = Object.assign({ motor: 0, tires: 0, fan: 0, thrust: 0, tank: 0 }, this.d.owned);
    this.d.setup = Object.assign(blankSetup(), this.d.setup);
    this.d.setup.levels = Object.assign(blankSetup().levels, this.d.setup.levels);
    this.cheats = { unlimited: false, unlockAll: false };
    this.onChange = null;
  }
  save() { if (this.store) this.store.set('garage', this.d); if (this.onChange) this.onChange(); }
  get credits() { return this.d.credits; }
  earn(n) { n = Math.max(0, Math.round(n)); if (!n) return 0; this.d.credits += n; this.d.earned += n; this.save(); return n; }
  canAfford(price) { return this.cheats.unlimited || this.d.credits >= price; }
  pay(price) { if (!this.canAfford(price)) return false; if (!this.cheats.unlimited) this.d.credits -= price; return true; }
  owned(up) { return this.cheats.unlockAll ? 3 : this.d.owned[up]; }
  hasPart(kind, id) { const it = findItem(kind, id); return it.price === 0 || this.cheats.unlockAll || this.d.parts.includes(kind + ':' + id); }
  buyUpgrade(up) {
    const next = this.d.owned[up] + 1;
    if (next > 3 || this.cheats.unlockAll && next > 3) return false;
    if (!this.pay(PRICES[next])) return false;
    this.d.owned[up] = next; this.d.setup.levels[up] = next;
    this.save(); return true;
  }
  buyPart(kind, id) {
    if (this.hasPart(kind, id)) return true;
    if (!this.pay(findItem(kind, id).price)) return false;
    this.d.parts.push(kind + ':' + id); this.d.setup[kind] = id;
    this.save(); return true;
  }
  setLevel(up, l) { this.d.setup.levels[up] = Math.max(0, Math.min(this.owned(up), l)); this.save(); }
  setPart(kind, id) { if (!this.hasPart(kind, id)) return false; this.d.setup[kind] = id; this.save(); return true; }
  // what is actually fitted (levels and parts you no longer have fall back)
  level(up) { return Math.min(this.d.setup.levels[up], this.owned(up)); }
  look() { const s = this.d.setup, o = {}; for (const k of Object.keys(COSMETICS)) o[k] = this.hasPart(k, s[k]) ? s[k] : COSMETICS[k][0].id; return o; }
  levels() { const o = {}; for (const u of UPGRADES) o[u.id] = this.level(u.id); return o; }
  tune(levels = this.levels()) {
    return { motor: lvlVal('motor', 'motor', levels.motor), vmax: lvlVal('motor', 'vmax', levels.motor), grip: lvlVal('tires', 'grip', levels.tires),
      heat: lvlVal('tires', 'heat', levels.tires), wear: lvlVal('tires', 'wear', levels.tires), fan: lvlVal('fan', 'fan', levels.fan) };
  }
  effectiveTrim(base, levels = this.levels()) {
    const th = lvlVal('thrust', 'thrust', levels.thrust), air = lvlVal('tank', 'air', levels.tank);
    return { ...base, airMax: Math.round(base.airMax * air), rearThrust: base.rearThrust * th, liftThrust: base.liftThrust * th, sideThrust: base.sideThrust * th };
  }
  // builds
  saveBuild(i, trim) { this.d.builds[i] = { trim, levels: { ...this.d.setup.levels }, ...this.look(), at: Date.now() }; this.save(); }
  loadBuild(i) {
    const b = this.d.builds[i];
    if (!b) return null;
    for (const u of UPGRADES) this.d.setup.levels[u.id] = Math.min(b.levels[u.id] || 0, this.owned(u.id));
    for (const k of Object.keys(COSMETICS)) if (this.hasPart(k, b[k])) this.d.setup[k] = b[k];
    this.save();
    return b;
  }
}

// ---------- live stats ----------
// 0-60 is measured: a hidden copy of your car does a launch on the drag strip with the real physics
export function measure060(trim, tune, phys2) {
  const v = new Vehicle();
  v.phys2 = phys2; v.noWind = true;
  v.setTrim(trim); v.tune = tune;
  const x = 150, z = -150;
  v.reset(new THREE.Vector3(x, heightAt(x, z) + 0.5, z), Math.PI / 2);
  const inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: false, descend: false, roll: 0 };
  for (let i = 0; i < 300; i++) v.step(PHYS.DT, inp);
  inp.throttle = 1; inp.boost = v.rear.length > 0;
  let t = 0;
  while (t < 6) { v.step(PHYS.DT, inp); t += PHYS.DT; if (v.vel.length() >= 26.8224) return t; }
  return t;
}
// top speed where motor force (after the rev-limit taper) balances drag + rolling resistance
export function topSpeed(tune) {
  const vmax = PHYS.VMAX * tune.vmax;
  let v = vmax - 1;
  for (let i = 0; i < 40; i++) {
    const motor = Math.min(PHYS.MOTOR_FORCE * tune.motor, PHYS.MOTOR_POWER * tune.motor / v);
    const resist = 0.5 * PHYS.RHO * 0.52 * v * v + 0.012 * (1800 * 9.81 + 0.5 * PHYS.RHO * 0.75 * v * v + 0.12 * PHYS.FAN_MAX * tune.fan);
    const taper = Math.min(1, resist / motor);
    v += ((vmax - 4 * taper) - v) * 0.5;
  }
  return v;
}
export function carStats(baseTrim, profile, levels, phys2) {
  const tune = profile.tune(levels), trim = profile.effectiveTrim(baseTrim, levels);
  const mFull = trim.dryMass + trim.airMax;
  const mu = 1.18 * tune.grip;
  return {
    z60: measure060(trim, tune, phys2),
    top: topSpeed(tune) * MPH,
    grip: mu,
    gripFan: mu * (mFull * 9.81 + PHYS.FAN_MAX * tune.fan) / (mFull * 9.81),
    down: PHYS.FAN_MAX * tune.fan / 9.81,
    thrust: (trim.rearThrust * 4 + trim.liftThrust * 4 + trim.sideThrust * 2) / 1000,
    air: trim.airMax,
    hover: trim.liftThrust ? trim.airMax / (mFull * 9.81 / 650) : 0,
  };
}

// ---------- showroom ----------
export class Showroom {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070a');
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    this.angle = 0.6; this.spin = 0.22; this.zoom = 1; this.time = 0;
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#9fb6c8', '#1a1410', 0.5));
    const key = new THREE.SpotLight('#fff3e6', 900, 40, 0.55, 0.6, 1.6);
    key.position.set(5, 9, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004;
    s.add(key); s.add(key.target);
    const rim = new THREE.SpotLight('#7fe3ff', 500, 40, 0.7, 0.7, 1.6); rim.position.set(-7, 5, -6); s.add(rim); s.add(rim.target);
    const fill = new THREE.PointLight('#ffb47a', 30, 20, 2); fill.position.set(-4, 2, 5); s.add(fill);
    // polished floor, turntable with a glowing edge, curved backdrop, light strips
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: '#0d1014', roughness: 0.22, metalness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    this.table = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.14, 72), new THREE.MeshStandardMaterial({ color: '#1b2026', roughness: 0.35, metalness: 0.8 }));
    disc.position.y = 0.07; disc.receiveShadow = true; this.table.add(disc);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.025, 8, 96), new THREE.MeshStandardMaterial({ color: '#06141a', emissive: '#7fe3ff', emissiveIntensity: 2.6 }));
    edge.rotation.x = Math.PI / 2; edge.position.y = 0.135; this.table.add(edge);
    const lines = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.23, 72), new THREE.MeshBasicMaterial({ color: '#2a3a46' }));
    lines.rotation.x = -Math.PI / 2; lines.position.y = 0.142; this.table.add(lines);
    s.add(this.table);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 12, 64, 1, true, Math.PI * 0.55, Math.PI * 0.9), new THREE.MeshStandardMaterial({ color: '#0b0e12', roughness: 0.9, side: THREE.BackSide }));
    back.position.y = 6; s.add(back);
    const stripMat = new THREE.MeshStandardMaterial({ color: '#05080a', emissive: '#dff4ff', emissiveIntensity: 2.2 });
    for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.18), stripMat); b.position.set(0, 8.5, -6 + i * 3); s.add(b); }
    for (const x of [-9, 9]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6, 0.08), new THREE.MeshStandardMaterial({ color: '#05080a', emissive: '#e0242f', emissiveIntensity: 2 })); b.position.set(x, 3, -10); s.add(b); }
    this.key = key;
  }
  // studio reflections, built the first time the garage opens
  buildEnv() {
    if (this.scene.environment) return;
    const pm = new THREE.PMREMGenerator(this.renderer);
    const es = new THREE.Scene();
    es.background = new THREE.Color('#06080b');
    const panel = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (const [x, y, z, w, h] of [[0, 9, 0, 14, 1.2], [8, 4, -6, 1, 6], [-8, 4, -6, 1, 6], [0, 3, 10, 12, 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), panel); m.position.set(x, y, z); m.lookAt(0, 1, 0); es.add(m);
    }
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: '#15181c' })); gnd.rotation.x = -Math.PI / 2; es.add(gnd);
    this.scene.environment = pm.fromScene(es, 0.03).texture;
    pm.dispose();
  }
  open(model) {
    this.buildEnv();
    this.model = model;
    this.table.add(model.group);
    model.group.position.set(0, 0.14 + 0.442, 0);
    model.group.quaternion.identity();
    for (const w of model.wheels) { w.pivot.position.y = -0.082; w.pivot.rotation.y = 0; }
    model.launcherWasVisible = model.launcher.group.visible;
    for (const g of ['rear', 'lift', 'side']) for (const n of model.nozzles[g]) n.plume.visible = false;
    model.mats.nozzleGlow.emissiveIntensity = 0;
  }
  close(scene) { if (this.model) scene.add(this.model.group); this.model = null; }
  drag(dx) { this.spin = 0; this.angle -= dx * 0.008; this.dragT = this.time; }
  wheel(d) { this.zoom = Math.max(0.7, Math.min(1.5, this.zoom * (d > 0 ? 1.08 : 0.92))); }
  update(dt, w, h, offset) {
    this.time += dt;
    if (this.time - (this.dragT ?? -10) > 2.5) this.spin += (0.22 - this.spin) * Math.min(1, dt);
    this.angle += this.spin * dt;
    this.table.rotation.y = this.angle;
    const cam = this.camera, d = 9.2 * this.zoom;
    cam.position.set(Math.sin(0.5) * d, 2.3 + Math.sin(this.time * 0.3) * 0.1, Math.cos(0.5) * d);
    cam.lookAt(0, 0.75, 0);
    cam.aspect = w / h;
    if (offset) cam.setViewOffset(w, h, -w * 0.22, 0, w, h); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
}
