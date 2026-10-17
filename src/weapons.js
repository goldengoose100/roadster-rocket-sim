// Roof-mounted rocket launcher: pickups, aiming turret, rockets with smoke trails,
// collision against world + debris, explosions handed to the destruction system.
import * as THREE from 'three';
import { raycast, makeHit } from './colliders.js';
import { heightAt } from './terrain.js';

const _hit = makeHit();
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

function makeRocketMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), new THREE.MeshStandardMaterial({ color: '#d8dce0', roughness: 0.4, metalness: 0.5 }));
  body.rotation.x = Math.PI / 2; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 10), new THREE.MeshStandardMaterial({ color: '#c41e24', roughness: 0.5 }));
  nose.rotation.x = Math.PI / 2; nose.position.z = 0.44; g.add(nose);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.14), new THREE.MeshStandardMaterial({ color: '#333' }));
    f.position.z = -0.3; f.rotation.z = i * Math.PI / 2; f.position.x = Math.cos(i * Math.PI / 2) * 0.07; f.position.y = Math.sin(i * Math.PI / 2) * 0.07;
    g.add(f);
  }
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8) }));
  flame.scale.z = 2.2; flame.position.z = -0.48; g.add(flame);
  return g;
}

export class Weapons {
  constructor(scene, fx, destruction) {
    this.scene = scene; this.fx = fx; this.d = destruction;
    this.equipped = false;
    this.mag = 4; this.ammo = 4; this.reload = 0; this.cooldown = 0;
    this.reloadTime = 1.6;
    this.rockets = [];
    this.pool = [];
    for (let i = 0; i < 48; i++) { const m = makeRocketMesh(); m.visible = false; scene.add(m); this.pool.push(m); }
    this.hack = { infiniteAmmo: false, rapidFire: false, blast: 1, homing: false, cluster: false };
    this.pendingBlasts = [];
    this.muzzleI = 0;
    this.fired = 0;
    this.onFire = null; this.onPickup = null;
  }

  checkPickups(pickups, carPos) {
    if (this.equipped) return false;
    for (const p of pickups) {
      if (Math.hypot(carPos.x - p.x, carPos.z - p.z) < 4 && Math.abs(carPos.y - p.y) < 4) {
        this.equip();
        return true;
      }
    }
    return false;
  }
  equip() {
    this.equipped = true; this.ammo = this.mag; this.reload = 0;
    if (this.onPickup) this.onPickup();
  }

  // aim the turret on the car toward a world point
  aim(model, target, snap = 0.35) {
    const L = model.launcher;
    L.group.updateWorldMatrix(true, false);
    _p.copy(target);
    L.group.worldToLocal(_p);
    const yaw = Math.atan2(_p.x, _p.z);
    const pitch = Math.atan2(_p.y - 0.18, Math.hypot(_p.x, _p.z));
    L.yaw.rotation.y += (yaw - L.yaw.rotation.y) * snap;
    L.pitch.rotation.x += (-Math.max(-0.35, Math.min(0.9, pitch)) - L.pitch.rotation.x) * snap;
  }

  tryFire(model, vehicle, target) {
    if (!this.equipped || this.cooldown > 0 || this.reload > 0 || this.ammo <= 0) return false;
    const L = model.launcher;
    // use the physics state, not last frame's render transform
    model.group.position.copy(vehicle.pos);
    model.group.quaternion.copy(vehicle.quat);
    model.group.updateMatrixWorld(true);
    this.aim(model, target, 1);
    model.group.updateMatrixWorld(true);
    const muzzle = L.muzzles[this.muzzleI++ % L.muzzles.length];
    const pos = new THREE.Vector3().setFromMatrixPosition(muzzle.matrixWorld);
    const dir = new THREE.Vector3().subVectors(target, pos);
    if (dir.lengthSq() < 4) dir.copy(vehicle.fwd);
    dir.normalize();
    const mesh = this.pool.find(m => !m.userData.busy);
    if (!mesh) return false;
    mesh.visible = true; mesh.userData.busy = true;
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const vel = dir.clone().multiplyScalar(65).add(vehicle.vel);
    const rk = { pos, vel, dir, life: 0, mesh, trail: 0 };
    if (this.hack.homing) rk.target = this.findTarget(pos, dir);
    this.rockets.push(rk);
    this.fired++;
    this.cooldown = this.hack.rapidFire ? 0.06 : 0.2;
    if (!this.hack.infiniteAmmo) { this.ammo--; if (this.ammo <= 0) this.reload = this.reloadTime; }
    // muzzle blast
    for (let i = 0; i < 8; i++) this.fx.smoke.spawn(pos.x, pos.y, pos.z, -dir.x * 4 + (Math.random() - 0.5) * 3, -dir.y * 4 + Math.random() * 2, -dir.z * 4 + (Math.random() - 0.5) * 3, 1.2, 0.4, 2.2, 0.7, 0.7, 0.7, 0.5);
    this.fx.fire.spawn(pos.x, pos.y, pos.z, dir.x * 6, dir.y * 6, dir.z * 6, 0.08, 0.8, 1.4, 1, 0.75, 0.4, 1);
    // recoil
    vehicle.applyImpulse(dir.clone().multiplyScalar(-900), pos);
    if (this.onFire) this.onFire(pos);
    return true;
  }

  // nearest destructible thing inside a 25 degree cone ahead
  findTarget(from, dir) {
    let best = null, bestScore = Infinity;
    const consider = (p, obj) => {
      _p.subVectors(p, from); const d = _p.length(); if (d < 5 || d > 600) return;
      const cos = _p.dot(dir) / d; if (cos < 0.9) return;
      const score = d * (2 - cos);
      if (score < bestScore) { bestScore = score; best = obj; }
    };
    for (const b of this.d.blocks) if (b.state === 'static') consider(b.pos, { pos: b.pos });
    for (const t of this.d.targets) consider(t.col.c, { pos: t.col.c, live: t });
    for (const b of this.d.barrels) if (b.state === 'static') consider(b.pos, { pos: b.pos });
    return best;
  }
  // rockets falling from the sky onto a point
  airstrike(at, n = 14) {
    for (let i = 0; i < n; i++) {
      const mesh = this.pool.find(m => !m.userData.busy);
      if (!mesh) break;
      mesh.userData.busy = true;
      const tgt = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
      const pos = tgt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, 120 + i * 12, (Math.random() - 0.5) * 40));
      const dir = tgt.clone().sub(pos).normalize();
      mesh.visible = true; mesh.position.copy(pos);
      this.rockets.push({ pos, vel: dir.clone().multiplyScalar(90), dir, life: -i * 0.12, mesh, trail: 0, strike: true });
    }
  }

  update(dt) {
    for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
      const b = this.pendingBlasts[i];
      b.t -= dt;
      if (b.t <= 0) { this.pendingBlasts.splice(i, 1); this.d.explode(b.pos, b.r, b.power, 'cluster'); }
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reload > 0) { this.reload -= dt; if (this.reload <= 0) { this.reload = 0; this.ammo = this.mag; } }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life += dt;
      // homing: steer toward the locked target
      if (r.target) {
        const tp = r.target.live && r.target.live.body ? r.target.live.body.pos : r.target.pos;
        _p.subVectors(tp, r.pos).normalize();
        const turn = Math.min(1, dt * 4);
        r.dir.lerp(_p, turn).normalize();
        const spd = r.vel.length();
        r.vel.copy(r.dir).multiplyScalar(spd);
      }
      // motor
      const sp = r.vel.length();
      if (r.life < 0) { r.mesh.visible = false; continue; }
      r.mesh.visible = true;
      if (sp < 175) r.vel.addScaledVector(r.dir, 260 * dt);
      r.vel.y -= 1.5 * dt;
      const step = r.vel.length() * dt;
      _d.copy(r.vel).normalize();
      let exploded = false;
      let at = null;
      if (raycast(r.pos, _d, step + 0.3, _hit, { twoSided: true })) at = _hit.point.clone().addScaledVector(_d, -0.35);
      // loose debris (sub-sample the segment)
      if (!at) {
        for (let k = 1; k <= 3; k++) {
          _p.copy(r.pos).addScaledVector(_d, step * k / 3);
          if (this.d.bodyHit(_p, 0.35)) { at = _p.clone().addScaledVector(_d, -0.3); break; }
        }
      }
      if (at || r.life > (r.strike ? 8 : 5)) {
        const pos = at || r.pos.clone();
        const gh = heightAt(pos.x, pos.z);
        if (pos.y < gh + 0.3) pos.y = gh + 0.3;
        const k = this.hack.blast;
        this.d.explode(pos, 9 * k, 1.0 * k, 'rocket');
        if (this.hack.cluster && !r.strike) {
          for (let c = 0; c < 6; c++) {
            const a = c / 6 * Math.PI * 2 + Math.random() * 0.5, d = 6 + Math.random() * 6;
            const p = pos.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d));
            p.y = Math.max(p.y, heightAt(p.x, p.z) + 0.4);
            this.pendingBlasts.push({ pos: p, t: 0.25 + c * 0.08 + Math.random() * 0.15, r: 6 * k, power: 0.8 * k });
          }
        }
        exploded = true;
      }
      if (exploded) { r.mesh.visible = false; r.mesh.userData.busy = false; this.rockets.splice(i, 1); continue; }
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      r.mesh.quaternion.setFromUnitVectors(_p.set(0, 0, 1), _d);
      // trail
      r.trail += dt;
      while (r.trail > 0.008) {
        r.trail -= 0.008;
        const back = r.pos.clone().addScaledVector(_d, -0.55 - Math.random() * step);
        this.fx.smoke.spawn(back.x, back.y, back.z, (Math.random() - 0.5) * 0.8, (Math.random() - 0.2) * 0.8, (Math.random() - 0.5) * 0.8, 1.6 + Math.random(), 0.35, 1.8, 0.82, 0.82, 0.84, 0.42, { drag: 1.2, grav: -0.3 });
      }
      this.fx.fire.spawn(r.pos.x - _d.x * 0.55, r.pos.y - _d.y * 0.55, r.pos.z - _d.z * 0.55, -_d.x * 8, -_d.y * 8, -_d.z * 8, 0.08, 0.5, 0.2, 1, 0.7, 0.35, 0.9);
    }
  }

  clear() {
    for (const r of this.rockets) { r.mesh.visible = false; r.mesh.userData.busy = false; }
    this.pendingBlasts.length = 0;
    this.rockets.length = 0;
  }
}
