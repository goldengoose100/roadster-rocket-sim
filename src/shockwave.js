// Shockwaves (Physics 2.0): every explosion sends out a pressure front that travels at the speed of
// sound (faster right next to the blast). As it passes it shoves debris and cones, rocks or flips parked
// cars, knocks blocks loose (only for very big blasts), shatters glass and jolts the player's car.
// Glass: window panes on buildings that break into shards when a wave or the wall around them goes.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

export const SOUND_SPEED = 343;
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// radius of the front t seconds after the blast: supersonic near field, then the speed of sound
export const frontRadius = (radius, t) => SOUND_SPEED * t + 1.2 * radius * (1 - Math.exp(-t / 0.02));
export function arrivalTime(radius, dist) {
  let lo = 0, hi = dist / SOUND_SPEED + 0.01;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (frontRadius(radius, mid) < dist) lo = mid; else hi = mid; }
  return hi;
}
// overpressure strength at a distance (1 = edge of the blast radius for a power-1 explosion)
export const strengthAt = (radius, power, r) => power * Math.pow(radius / Math.max(r, radius * 0.5), 1.3);

export class Shockwaves {
  constructor(destruction) {
    this.d = destruction;
    this.enabled = true;
    this.fronts = [];
    this.vehicle = null;       // the player's car (gets pushed beyond the direct blast zone)
    this.onCar = null;         // (front, dist, strength) => void
    this.push = 600;           // shove on loose debris per unit of strength (N·s per m² of side area)
    this.maxDv = 4;            // m/s: outside the blast radius rubble gets nudged, not thrown
  }
  spawn(pos, radius, power) {
    if (!this.enabled) return;
    this.fronts.push({ pos: pos.clone(), radius, power, t: 0, r: 0, maxR: radius * 7 * Math.sqrt(Math.max(1, power)) });
    if (this.fronts.length > 24) this.fronts.shift();
  }
  clear() { this.fronts.length = 0; }
  step(dt) {
    const d = this.d;
    for (let i = this.fronts.length - 1; i >= 0; i--) {
      const f = this.fronts[i];
      f.t += dt;
      const r0 = f.r, r1 = frontRadius(f.radius, f.t);
      f.r = r1;
      if (r0 > f.maxR) { this.fronts.splice(i, 1); continue; }
      const crossing = (p) => { const dd = p.distanceTo(f.pos); return dd > r0 && dd <= r1 ? dd : -1; };
      // loose bodies outside the blast radius get a shove (inside it explode() already threw them)
      for (const b of d.bodies) {
        if (!b.alive) continue;
        const dist = crossing(b.pos);
        if (dist < 0 || dist <= f.radius) continue;
        const s = strengthAt(f.radius, f.power, dist);
        if (s < 0.03 || b.age < 0.3) continue;   // fresh debris was already thrown by the blast itself
        const area = 4 * (b.half.x * b.half.y + b.half.y * b.half.z + b.half.x * b.half.z) / 3;
        const dv = Math.min(this.maxDv, s * this.push * area / b.mass);
        if (dv < 0.3) continue;
        b.wake();
        _n.subVectors(b.pos, f.pos).normalize(); _n.y += 0.25; _n.normalize();
        _p.copy(b.pos).add(_s.set((Math.random() - 0.5) * b.half.x, (Math.random() - 0.5) * b.half.y, (Math.random() - 0.5) * b.half.z));
        b.applyImpulse(_n.multiplyScalar(dv * b.mass), _p);
      }
      // parked cars: a strong wave flips them, a weaker one rocks them on their springs
      for (const t of d.targets) {
        if (t.state !== 'static') continue;
        const dist = crossing(t.col.c);
        if (dist < 0) continue;
        const s = strengthAt(f.radius, f.power, dist);
        if (s > 0.45) d.launchTarget(t, f.pos, Math.min(1.5, s * 0.55));
        else if (s > 0.08) t.wobble = { t: 0, amp: Math.min(0.12, s * 0.3), dir: Math.atan2(t.col.c.x - f.pos.x, t.col.c.z - f.pos.z) };
      }
      // only huge blasts knock whole blocks out of standing walls
      if (f.power >= 2) {
        const touched = new Set();
        for (const b of d.blocks) {
          if (b.state !== 'static') continue;
          const dist = crossing(b.pos);
          if (dist < 0 || dist <= f.radius) continue;
          const s = strengthAt(f.radius, f.power, dist);
          if (s > 0.9 && Math.random() < Math.min(0.8, s - 0.6)) { d.detach(b, f.pos, s * 0.35); touched.add(b.struct); }
        }
        for (const st of touched) d.collapse(st);
      }
      // windows
      for (const pane of d.glass.panes) {
        if (!pane.alive) continue;
        const dist = crossing(pane.pos);
        if (dist >= 0 && strengthAt(f.radius, f.power, dist) > 0.12) d.glass.shatter(pane, f.pos, strengthAt(f.radius, f.power, dist));
      }
      // the player's car, beyond the zone where explode() pushes it directly
      if (this.vehicle && this.onCar) {
        const dist = crossing(this.vehicle.pos);
        if (dist > f.radius * 1.4) this.onCar(f, dist, strengthAt(f.radius, f.power, dist));
      }
    }
  }
}

// ---------- glass ----------
export class Glass {
  constructor(scene) {
    this.scene = scene;
    this.panes = [];
    this.shards = [];
    this.onShatter = null;     // (pos, n) => void (sound)
    this.checkT = 0;
  }
  // pane centre / rotation / size; neighbours are found in finalize()
  add(pos, quat, w, h) { this.panes.push({ pos: pos.clone(), quat: quat.clone(), w, h, alive: true, neighbors: [], index: this.panes.length }); }
  finalize(blocks) {
    const n = Math.max(1, this.panes.length);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#9fc4dc', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.38, envMapIntensity: 1.8, depthWrite: false }), n);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.scene.add(this.mesh);
    for (const p of this.panes) {
      for (const b of blocks) if (b.pos.distanceTo(p.pos) < Math.max(p.w, p.h) * 0.5 + 0.7) p.neighbors.push(b);
      this.place(p);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    // shard pool
    this.shardCap = 700;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.4, 0, 0.5, -0.5, 0, 0.1, 0.6, 0], 3));
    sg.computeVertexNormals();
    this.shardMesh = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: '#cfe6f5', roughness: 0.05, metalness: 0.7, side: THREE.DoubleSide, envMapIntensity: 2 }), this.shardCap);
    this.shardMesh.frustumCulled = false;
    for (let i = 0; i < this.shardCap; i++) this.shardMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.scene.add(this.shardMesh);
    this.shardFree = []; for (let i = this.shardCap - 1; i >= 0; i--) this.shardFree.push(i);
  }
  place(p) {
    _m.compose(p.pos, p.quat, _s.set(p.w, p.h, 0.04));
    this.mesh.setMatrixAt(p.index, p.alive ? _m : _m.makeScale(0, 0, 0));
  }
  shatter(p, from, strength = 0.5) {
    if (!p.alive) return;
    p.alive = false; this.place(p); this.mesh.instanceMatrix.needsUpdate = true;
    _n.set(0, 0, 1).applyQuaternion(p.quat);
    if (from && _n.dot(_p.subVectors(p.pos, from)) < 0) _n.negate();   // blown away from the blast
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quat);
    const count = Math.round(10 + Math.min(10, strength * 10));
    for (let i = 0; i < count; i++) {
      const idx = this.shardFree.pop();
      if (idx === undefined) break;
      const u = (Math.random() - 0.5) * p.w, v = (Math.random() - 0.5) * p.h;
      const sp = 2 + strength * 10 * Math.random();
      this.shards.push({
        idx, pos: p.pos.clone().addScaledVector(ax, u).add(_s.set(0, v, 0)),
        vel: new THREE.Vector3().copy(_n).multiplyScalar(sp).add(_s.set((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), spin: new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20),
        size: 0.06 + Math.random() * 0.14, age: 0, rest: false,
      });
    }
    if (this.onShatter) this.onShatter(p.pos, count);
  }
  update(dt) {
    if (!this.mesh) return;
    // a pane goes when the wall around it breaks
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.1;
      for (const p of this.panes) if (p.alive && p.neighbors.some(b => b.state !== 'static')) this.shatter(p, null, 0.2);
    }
    if (!this.shards.length || dt <= 0) return;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.age += dt;
      if (s.age > 25) { this.shardMesh.setMatrixAt(s.idx, _m.makeScale(0, 0, 0)); this.shardFree.push(s.idx); this.shards.splice(i, 1); continue; }
      if (!s.rest) {
        s.vel.y -= 9.81 * dt; s.vel.multiplyScalar(Math.exp(-0.4 * dt));
        s.pos.addScaledVector(s.vel, dt);
        s.rot.x += s.spin.x * dt; s.rot.y += s.spin.y * dt; s.rot.z += s.spin.z * dt;
        const gy = heightAt(s.pos.x, s.pos.z) + 0.02;
        if (s.pos.y < gy) {
          s.pos.y = gy;
          if (Math.abs(s.vel.y) > 1.5) { s.vel.y = -s.vel.y * 0.25; s.vel.x *= 0.5; s.vel.z *= 0.5; s.spin.multiplyScalar(0.5); }
          else { s.rest = true; s.rot.x = Math.PI / 2; }
        }
      }
      _q.setFromEuler(_e.copy(s.rot));
      this.shardMesh.setMatrixAt(s.idx, _m.compose(s.pos, _q, _s.setScalar(s.size)));
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;
  }
  rebuild() {
    for (const p of this.panes) { p.alive = true; this.place(p); }
    if (this.mesh) this.mesh.instanceMatrix.needsUpdate = true;
    for (const s of this.shards) { this.shardMesh.setMatrixAt(s.idx, _m.makeScale(0, 0, 0)); this.shardFree.push(s.idx); }
    this.shards.length = 0;
    if (this.shardMesh) this.shardMesh.instanceMatrix.needsUpdate = true;
  }
}
