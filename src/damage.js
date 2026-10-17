// Crash damage (Physics 2.0). DamageState is pure bookkeeping used by the physics: which panels are
// crushed, bent / broken wheels, a bent frame, a leaking air tank, damaged thrusters and parts that
// snapped off. CarDamageVisual crumples the car mesh to match, and LooseWheels rolls broken-off wheels.
import * as THREE from 'three';
import { raycast, makeHit } from './colliders.js';

export const DMG = {
  vth: 9,          // m/s impact speed before panels dent (~20 mph)
  vthBottom: 13,   // underbody is built for hard landings
  scale: 22,       // m/s above the threshold for a full-strength hit
  wheelLand: 14,   // m/s vertical wheel landing speed before the suspension bends
};
// car-local reference points (+x = left side, +y = up, +z = forward, origin = centre of mass)
const PARTS = {
  mirrorL: [0.95, 0.49, 0.8], mirrorR: [-0.95, 0.49, 0.8], spoiler: [0, 0.42, -1.95],
  headL: [0.62, 0.05, 1.95], headR: [-0.62, 0.05, 1.95], tail: [0, 0.31, -2.2],
};
const _v = new THREE.Vector3(), _f = new THREE.Vector3();

export class DamageState {
  constructor() { this.reset(); }
  reset() {
    this.zones = { front: 0, rear: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.frame = 0; this.frameSide = 1;
    this.tankLeak = 0;
    this.parts = { mirrorL: true, mirrorR: true, spoiler: true, headL: true, headR: true, tail: true };
    this.hits = 0;
  }
  // how much of the fan's downforce still works (skirts and underbody)
  fanFactor() { const z = this.zones; return (1 - 0.6 * z.bottom) * (1 - 0.1 * (z.left + z.right)); }
  dragAdd() { return 0.35 * this.zones.front; }
  // toe angle of a wheel from a bent wheel / frame (pulls the car to one side)
  toe(i, w) { return w.bend * 0.05 * (i % 2 ? -1 : 1) + this.frame * 0.02 * this.frameSide; }
  // 0..1 overall condition for the HUD / garage
  condition(v) {
    const z = this.zones;
    let d = (z.front + z.rear + z.left + z.right + z.top + z.bottom) / 6 * 0.6 + this.frame * 0.15 + this.tankLeak * 0.05;
    for (const w of v.wheels) d += (w.broken ? 1 : w.bend * 0.5) * 0.05;
    return Math.max(0, 1 - d);
  }
  isDamaged(v) { return this.hits > 0 || v.wheels.some(w => w.broken || w.bend > 0 || w.flat > 0); }

  // a hull point hit something. lp = local point, ln = local push direction (from the obstacle into the car)
  impact(v, lp, ln, speed, events) {
    const bottom = ln.y > 0.6;
    const sev = Math.min(1.5, Math.max(0, (speed - (bottom ? DMG.vthBottom : DMG.vth)) / DMG.scale));
    if (sev <= 0) return 0;
    this.apply(v, lp, ln, sev, events);
    return sev;
  }
  // explosion next to the car: dir = local direction from the blast to the car
  blast(v, dir, strength, events) {
    const sev = Math.min(1.2, strength);
    if (sev < 0.05) return;
    _v.set(-dir.x * 0.95, -dir.y * 0.5, -dir.z * 2.1);
    this.apply(v, _v, dir, sev, events, true);
  }
  apply(v, lp, ln, sev, events, blast = false) {
    this.hits++;
    const z = this.zones, face = _f.copy(ln).negate(); // the side of the car that was hit
    const w2 = (a) => a * a;
    const add = (k, a) => { if (a > 0) z[k] = Math.min(1, z[k] + sev * 0.55 * a); };
    add('front', face.z > 0 ? w2(face.z) : 0); add('rear', face.z < 0 ? w2(face.z) : 0);
    add('left', face.x > 0 ? w2(face.x) : 0); add('right', face.x < 0 ? w2(face.x) : 0);
    add('top', face.y > 0 ? w2(face.y) : 0); add('bottom', face.y < 0 ? w2(face.y) : 0);
    events.push({ type: 'dent', p: lp.clone(), n: ln.clone(), sev, blast });
    // wheels close to the hit get bent; a big enough hit breaks one off
    if (!blast || sev > 0.6) v.wheels.forEach((w, i) => {
      if (w.broken) return;
      const d = Math.hypot(lp.x - w.mount.x, lp.z - w.mount.z);
      if (d > 0.8 || face.y > 0.7) return;
      w.bend = Math.min(1.2, w.bend + sev * 0.85 * (1 - d / 0.8));
      if (sev > 0.4) w.flat = Math.min(1, w.flat + (sev - 0.4) * 0.8);
      if (w.bend >= 1) { w.broken = true; w.contact = false; events.push({ type: 'wheelOff', i }); }
    });
    if (sev > 0.8) { this.frame = Math.min(1, this.frame + (sev - 0.8) * 0.7); this.frameSide = Math.sign(lp.x || face.x || 1); }
    if (v.trim.airMax > 0 && sev > 0.45 && (face.y < -0.4 || face.z < -0.4)) this.tankLeak = Math.min(1, this.tankLeak + (sev - 0.45) * 0.9);
    for (const t of v.thrusters) {
      const d = t.pos.distanceTo(lp);
      if (d < 0.9 && sev > 0.25) t.health = Math.max(0, t.health - sev * 0.7 * (1 - d / 0.9));
    }
    for (const id in PARTS) {
      if (!this.parts[id]) continue;
      const p = PARTS[id];
      const d = Math.hypot(lp.x - p[0], lp.y - p[1], lp.z - p[2]);
      const lim = id === 'spoiler' ? (z.rear > 0.55 || (d < 0.7 && sev > 0.3)) : id === 'tail' ? (z.rear > 0.45 && d < 1.2) : id.startsWith('head') ? (d < 0.8 && sev > 0.25) : (d < 0.7 && sev > 0.15);
      if (lim) { this.parts[id] = false; events.push({ type: 'part', id }); }
    }
  }
  // a wheel slammed into the ground (huge landing)
  wheelLanding(v, i, speed, events) {
    const w = v.wheels[i];
    if (w.broken || speed <= DMG.wheelLand) return;
    w.bend = Math.min(1.2, w.bend + (speed - DMG.wheelLand) / DMG.wheelLand * 0.6);
    this.hits++;
    if (w.bend >= 1) { w.broken = true; w.contact = false; events.push({ type: 'wheelOff', i }); }
  }
}

// ---------- visuals: crumple the body mesh where it was hit ----------
const hash = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
export class CarDamageVisual {
  constructor(model) {
    this.model = model;
    this.meshes = [model.body, model.canopy].map(m => {
      const g = m.geometry, pos = g.getAttribute('position'), col = g.getAttribute('color');
      return { m, g, pos, col, p0: Float32Array.from(pos.array), c0: col ? Float32Array.from(col.array) : null, dirty: false };
    });
    this.normalT = 0;
    this.repairing = false;
  }
  // push the surface in along n (local) around point p
  dent(p, n, sev) {
    const R = 0.45 + sev * 0.55, R2 = R * R, depth = 0.05 + sev * 0.17;
    for (const M of this.meshes) {
      const a = M.pos.array, c = M.col && M.col.array;
      for (let i = 0, k = 0; k < a.length; i++, k += 3) {
        const dx = a[k] - p.x, dy = a[k + 1] - p.y, dz = a[k + 2] - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R2) continue;
        const f = 1 - d2 / R2, fall = f * f;
        const amt = depth * fall * (0.65 + 0.6 * hash(i));
        a[k] += n.x * amt; a[k + 1] += n.y * amt; a[k + 2] += n.z * amt;
        // never crush more than 0.32 m from the original shape
        const ox = a[k] - M.p0[k], oy = a[k + 1] - M.p0[k + 1], oz = a[k + 2] - M.p0[k + 2], ol = Math.hypot(ox, oy, oz);
        if (ol > 0.32) { const s = 0.32 / ol; a[k] = M.p0[k] + ox * s; a[k + 1] = M.p0[k + 1] + oy * s; a[k + 2] = M.p0[k + 2] + oz * s; }
        if (c) { const dk = 1 - 0.35 * fall * Math.min(1, sev * 1.5); c[k] *= dk; c[k + 1] *= dk; c[k + 2] *= dk; }
      }
      M.pos.needsUpdate = true; if (M.col) M.col.needsUpdate = true; M.dirty = true;
    }
  }
  // gradually restore the original shape (k = 0..1 of the remaining difference per call)
  restore(k) {
    for (const M of this.meshes) {
      const a = M.pos.array;
      for (let i = 0; i < a.length; i++) a[i] += (M.p0[i] - a[i]) * k;
      if (M.col) { const c = M.col.array; for (let i = 0; i < c.length; i++) c[i] += (M.c0[i] - c[i]) * k; M.col.needsUpdate = true; }
      M.pos.needsUpdate = true; M.dirty = true;
    }
  }
  resetShape() { this.restore(1); }
  update(dt) {
    this.normalT -= dt;
    if (this.normalT > 0) return;
    for (const M of this.meshes) if (M.dirty) { M.g.computeVertexNormals(); M.dirty = false; this.normalT = 0.12; }
  }
}

// ---------- wheels that broke off: roll, wobble and fall over ----------
const _hit = makeHit(), _down = new THREE.Vector3(0, -1, 0), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
export class LooseWheels {
  constructor(scene) { this.scene = scene; this.list = []; }
  spawn(obj, pos, vel, axle) {
    obj.position.copy(pos);
    this.scene.add(obj);
    this.list.push({ obj, pos: pos.clone(), vel: vel.clone(), axle: axle.clone().normalize(), spin: 0, tilt: 0, age: 0, ground: false, wob: Math.random() * 6 });
    if (this.list.length > 8) this.remove(this.list[0]);
  }
  remove(w) { this.scene.remove(w.obj); this.list.splice(this.list.indexOf(w), 1); }
  clear() { while (this.list.length) this.remove(this.list[0]); }
  update(dt) {
    if (dt <= 0) return;
    for (const w of this.list.slice()) {
      w.age += dt;
      if (w.age > 40) { this.remove(w); continue; }
      w.vel.y -= 9.81 * dt;
      w.pos.addScaledVector(w.vel, dt);
      const r = 0.36;
      const lying = w.tilt > 1.2;
      const reach = lying ? 0.16 : r * Math.cos(w.tilt) + 0.15 * Math.sin(w.tilt);
      _x.copy(w.pos); _x.y += 2;
      w.ground = false;
      if (raycast(_x, _down, 2 + reach + 0.5, _hit)) {
        const gy = _hit.point.y;
        if (w.pos.y - gy < reach) {
          w.pos.y = gy + reach;
          if (w.vel.y < 0) w.vel.y = -w.vel.y * (Math.abs(w.vel.y) > 3 ? 0.35 : 0);
          w.ground = true;
        }
      }
      const hs = Math.hypot(w.vel.x, w.vel.z);
      if (w.ground) {
        // rolling: axle turns across the direction of travel, speed bleeds off, then it topples
        const dec = (lying ? 6 : 0.9) * dt;
        const k = hs > dec ? (hs - dec) / hs : 0;
        w.vel.x *= k; w.vel.z *= k;
        if (hs > 0.5) { _z.set(w.vel.x, 0, w.vel.z).normalize(); _y.set(-_z.z, 0, _z.x); if (_y.dot(w.axle) < 0) _y.negate(); w.axle.lerp(_y, Math.min(1, dt * 4)).normalize(); }
        if (!lying) w.spin += hs / r * dt * (w.axle.dot(_x.set(-w.vel.z, 0, w.vel.x)) > 0 ? 1 : -1);
        if (hs < 2.5) w.tilt = Math.min(Math.PI / 2, w.tilt + dt * (0.6 + w.tilt * 2.5));
      } else w.spin += dt * 9;
      // orientation: local X = axle, then tilt it toward vertical, then spin around it
      _x.copy(w.axle); _x.y = 0; if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); _x.normalize();
      _z.set(0, 1, 0).cross(_x).normalize();
      _y.crossVectors(_z, _x);
      _m.makeBasis(_x, _y, _z);
      w.obj.quaternion.setFromRotationMatrix(_m);
      w.obj.quaternion.multiply(_q.setFromAxisAngle(_z.set(0, 0, 1), w.tilt * (1 + 0.04 * Math.sin(w.wob + w.age * 7))));
      w.obj.quaternion.multiply(_q.setFromAxisAngle(_y.set(1, 0, 0), w.spin));
      w.obj.position.copy(w.pos);
    }
  }
}
