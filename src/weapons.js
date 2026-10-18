// Roof-mounted rocket launcher: pickups, aiming turret, rockets with smoke trails,
// collision against world + debris, explosions handed to the destruction system.
// Tab cycles the other weapons: railgun, grapple, mines, tractor beam, EMP, orbital laser, black-hole bomb.
import * as THREE from 'three';
import { raycast, makeHit, queryBox, groundBelow } from './colliders.js';
import { heightAt } from './terrain.js';

const _hit = makeHit();
export const MODES = ['rocket', 'rail', 'grapple', 'mine', 'tractor', 'emp', 'laser', 'blackhole'];
export const MODE_NAMES = { rocket: 'Rockets', rail: 'Railgun', grapple: 'Grapple', mine: 'Mines', tractor: 'Tractor beam', emp: 'EMP', laser: 'Orbital laser', blackhole: 'Black hole' };
export const MODE_HINTS = {
  rocket: 'Rocket launcher', rail: 'Railgun · pierces buildings · click or B',
  grapple: 'Grapple · hook a wall to swing and reel in, or hook debris · fire again to let go',
  mine: 'Mines · drop behind the car · they arm after a second', tractor: 'Tractor beam · lift debris or a car · fire again to throw it',
  emp: 'EMP · pulse around the car · stalls cars and fries mines', laser: 'Orbital laser · burns down through buildings · follows the crosshair',
  blackhole: 'Black-hole bomb · pulls everything in, then blasts it out',
};
// recharge times (s) of the weapons that have one; machine-gun fire rate cuts them to a tenth
const CHARGE = { mine: 0.4, emp: 6, laser: 12, blackhole: 10 };
const MAX_MINES = 8;
const _up = new THREE.Vector3(0, 1, 0), _down = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const glowMat = (color, opacity = 0) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
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
    // railgun: instant beam that pierces buildings (Tab switches weapon)
    this.mode = 'rocket';
    this.railCharge = 0; this.railTime = 1.5;
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.visible = false; this.beam.frustumCulled = false; scene.add(this.beam);
    this.beamT = 0;
    // the other weapons on the Tab wheel
    this.charge = { mine: 0, emp: 0, laser: 0, blackhole: 0 };
    this.lastAim = new THREE.Vector3();
    this.vehicle = null;
    this.onEmp = null;        // (center, radius) => void, set by the game (stalls the pace car)
    this.rope = null;         // grapple: { anchor | body + local, len }
    this.ropeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.6, metalness: 0.6 }));
    this.ropeMesh.visible = false; this.ropeMesh.frustumCulled = false; scene.add(this.ropeMesh);
    this.held = null;         // tractor beam: { body }
    this.thrown = [];         // bodies thrown by the tractor beam that smash what they hit
    this.tractorMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1.4, 1, 16, 1, true), glowMat('#22ff7a'));
    this.tractorMesh.visible = false; this.tractorMesh.frustumCulled = false; scene.add(this.tractorMesh);
    this.mines = [];
    this.minePool = [];
    for (let i = 0; i < MAX_MINES; i++) {
      const g = new THREE.Group();
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.12, 16), new THREE.MeshStandardMaterial({ color: '#3b4046', roughness: 0.5, metalness: 0.6 }));
      disk.castShadow = true; g.add(disk);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.15) }));
      led.position.y = 0.08; g.add(led); g.userData.led = led;
      g.visible = false; scene.add(g); this.minePool.push(g);
    }
    this.emp = null;          // last pulse: { pos, r, t } (future traffic and drones can ask empStalled)
    this.empMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), glowMat('#7fd8ff'));
    this.empMesh.visible = false; this.empMesh.frustumCulled = false; scene.add(this.empMesh);
    this.empRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 96), glowMat('#9fe6ff'));
    this.empRing.rotation.x = Math.PI / 2; this.empRing.visible = false; this.empRing.frustumCulled = false; scene.add(this.empRing);
    this.laser = null;        // { x, z, t, tick, boom, r }
    this.laserCore = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 12, 1, true), glowMat(new THREE.Color(3, 2.4, 2.2)));
    this.laserGlow = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1, 16, 1, true), glowMat('#ff3a2a'));
    for (const m of [this.laserCore, this.laserGlow]) { m.visible = false; m.frustumCulled = false; scene.add(m); }
    this.hole = null;         // black hole: { pos, vel, phase: 'fly' | 'pull', t, tick }
    this.holeCore = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: '#000' }));
    this.holeDisk = new THREE.Mesh(new THREE.RingGeometry(1.3, 3.2, 48), glowMat('#8a3dff'));
    this.holeDisk.material.side = THREE.DoubleSide;
    for (const m of [this.holeCore, this.holeDisk]) { m.visible = false; m.frustumCulled = false; scene.add(m); }
  }
  toggleMode(step = 1) {
    this.release();
    this.mode = MODES[(MODES.indexOf(this.mode) + step + MODES.length) % MODES.length];
    return this.mode;
  }
  // charge left as 0..1 for the HUD (0 = ready)
  chargeLeft(mode = this.mode) {
    if (mode === 'rail') return this.railCharge / this.railTime;
    return CHARGE[mode] ? this.charge[mode] / this.chargeTime(mode) : 0;
  }
  chargeTime(mode) { return CHARGE[mode] * (this.hack.rapidFire ? 0.1 : 1); }

  // muzzle position and aim direction from the physics state
  muzzle(model, vehicle, target) {
    const L = model.launcher;
    model.group.position.copy(vehicle.pos); model.group.quaternion.copy(vehicle.quat); model.group.updateMatrixWorld(true);
    this.aim(model, target, 1); model.group.updateMatrixWorld(true);
    const from = new THREE.Vector3().setFromMatrixPosition(L.muzzles[0].matrixWorld);
    const dir = new THREE.Vector3().subVectors(target, from);
    if (dir.lengthSq() < 4) dir.copy(vehicle.fwd);
    dir.normalize();
    return { from, dir };
  }

  fireRail(model, vehicle, target) {
    if (this.railCharge > 0) return false;
    const { from, dir } = this.muzzle(model, vehicle, target);
    const d = this.d, touched = new Set(), p = new THREE.Vector3();
    let end = 400;
    // march along the beam: everything it passes through breaks; only the ground stops it
    for (let s = 2; s <= 400; s += 0.5) {
      p.copy(from).addScaledVector(dir, s);
      if (p.y < heightAt(p.x, p.z)) { end = s; break; }
      for (const c of queryBox(p.x - 1, p.z - 1, p.x + 1, p.z + 1)) {
        const o = c.owner;
        if (!o || o.state !== 'static' || !c.alive || !c.containsPoint(p, 0.35)) continue;
        if (o.type === 'block') { d.shatter(o, p, 1.4); touched.add(o.struct); }
        else if (o.type === 'barrel' && !d.pending.includes(o)) { o.fuse = 0.05; d.pending.push(o); }
        else if (o.type === 'target') d.launchTarget(o, p.clone().addScaledVector(dir, -2), 1.3);
      }
      const b = d.bodyHit(p, 0.3);
      if (b) { b.wake(); b.applyImpulse(dir.clone().multiplyScalar(b.mass * 12), p); }
    }
    for (const st of touched) d.collapse(st);
    const hit = from.clone().addScaledVector(dir, end);
    if (end < 400) d.explode(hit, 4, 0.8, 'rail');
    // beam visual
    this.beam.position.copy(from).addScaledVector(dir, end / 2);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.beam.scale.set(1, end, 1); this.beam.visible = true; this.beamT = 0.45;
    for (let i = 0; i < 40; i++) { const q = from.clone().addScaledVector(dir, Math.random() * end); this.fx.fire.spawn(q.x, q.y, q.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.4, 0.5, 0.1, 0.6, 0.9, 1, 0.8); }
    vehicle.applyImpulse(dir.clone().multiplyScalar(-2500), from);
    this.railCharge = this.hack.rapidFire ? 0.15 : this.railTime;
    this.fired++;
    if (this.onFire) this.onFire(from, 'rail');
    return true;
  }

  // ---------- grapple ----------
  // hook the first thing along the aim line; a loose body is dragged, anything else is a fixed anchor
  fireGrapple(model, vehicle, target) {
    if (this.rope) { this.release(); return true; }
    const { from, dir } = this.muzzle(model, vehicle, target);
    const range = 150;
    const tHit = raycast(from, dir, range, _hit, { twoSided: true }) ? _hit.t : Infinity;
    const col = tHit < Infinity ? _hit.col : null, point = tHit < Infinity ? _hit.point.clone() : null;
    let body = null, at = null;
    for (let s = 1; s < Math.min(tHit, range); s += 0.5) {
      _p.copy(from).addScaledVector(dir, s);
      body = this.d.bodyHit(_p, 0.4);
      if (body) { at = _p.clone(); break; }
    }
    if (!body && point) {
      const o = col && col.owner;
      if (o && o.type === 'target' && o.state === 'static') { this.d.launchTarget(o, point, 0.0001); body = o.body; }
      at = point;
    }
    if (!at) return false;
    const rope = { len: Math.max(3, at.distanceTo(from)) };
    if (body) { body.wake(); rope.body = body; rope.local = at.clone().sub(body.pos).applyQuaternion(_q.copy(body.quat).invert()); }
    else rope.anchor = at;
    this.rope = rope;
    this.fired++;
    if (this.onFire) this.onFire(from, 'grapple');
    return true;
  }
  ropeEnd(out) {
    const r = this.rope;
    return r.body ? out.copy(r.local).applyQuaternion(r.body.quat).add(r.body.pos) : out.copy(r.anchor);
  }

  // ---------- tractor beam ----------
  fireTractor(model, vehicle, target) {
    const { from, dir } = this.muzzle(model, vehicle, target);
    if (this.held) {
      // throw it at the crosshair; heavy things fly slower
      const b = this.held.body;
      const sp = 55 * Math.max(0.45, Math.min(1.4, Math.pow(2500 / b.mass, 0.25)));
      const td = _a.subVectors(target, b.pos);
      if (td.lengthSq() < 4) td.copy(dir);
      td.normalize();
      b.wake(); b.vel.copy(vehicle.vel).addScaledVector(td, sp);
      b.angVel.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
      this.thrown.push({ body: b, t: 0 });
      vehicle.applyImpulse(td.clone().multiplyScalar(-Math.min(6000, b.mass * sp * 0.25)), vehicle.pos);
      this.held = null;
      this.fired++;
      if (this.onFire) this.onFire(from, 'throw');
      return true;
    }
    const range = 90;
    const tHit = raycast(from, dir, range, _hit, { twoSided: true }) ? _hit.t : range;
    const col = tHit < range ? _hit.col : null, point = _hit.point.clone();
    let body = null;
    for (let s = 1; s < tHit + 1; s += 0.75) {
      _p.copy(from).addScaledVector(dir, s);
      body = this.d.bodyHit(_p, 1.2);
      if (body) break;
    }
    if (!body && col && col.owner && col.owner.state === 'static') {
      const o = col.owner;
      if (o.type === 'target') { this.d.launchTarget(o, point, 0.0001); body = o.body; }
      else if (o.type === 'block') { body = this.d.makeBlockBody(o); this.d.collapse(o.struct); }
    }
    if (!body && tHit < range) {
      // nothing on the line: grab the nearest loose piece near where it landed
      let best = 9;
      for (const b of this.d.bodies) { if (!b.alive) continue; const d2 = b.pos.distanceToSquared(point); if (d2 < best) { best = d2; body = b; } }
    }
    if (!body || body.mass > 12000) return false;
    body.wake();
    this.held = { body };
    this.fired++;
    if (this.onFire) this.onFire(from, 'tractor');
    return true;
  }
  holdPoint(vehicle, out) {
    const b = this.held.body;
    _c.subVectors(this.lastAim, vehicle.pos); _c.y = 0;
    if (_c.lengthSq() < 1) _c.copy(vehicle.fwd);
    _c.normalize();
    return out.copy(vehicle.pos).addScaledVector(_up, 3 + b.half.y).addScaledVector(_c, 6 + b.radius);
  }

  // ---------- mines ----------
  dropMine(vehicle) {
    if (this.charge.mine > 0) return false;
    if (this.mines.length >= MAX_MINES) { const old = this.mines.shift(); this.fizzle(old); }
    const mesh = this.minePool.find(m => !m.userData.busy);
    if (!mesh) return false;
    mesh.userData.busy = true; mesh.visible = true;
    const pos = vehicle.pos.clone().addScaledVector(vehicle.fwd, -2.7 * (vehicle.hack.scale || 1)).addScaledVector(vehicle.up, -0.1);
    const vel = vehicle.vel.clone().multiplyScalar(0.5).addScaledVector(vehicle.fwd, -2);
    this.mines.push({ pos, vel, mesh, landed: false, t: 0, fuse: 0 });
    mesh.position.copy(pos);
    this.charge.mine = this.chargeTime('mine');
    this.fired++;
    if (this.onFire) this.onFire(pos, 'mine');
    return true;
  }
  fizzle(m) {
    m.mesh.visible = false; m.mesh.userData.busy = false;
    for (let i = 0; i < 8; i++) this.fx.fire.spawn(m.pos.x, m.pos.y + 0.1, m.pos.z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.3, 0.15, 0.04, 0.6, 0.85, 1, 1);
  }
  // explosions set off nearby mines (called by the game for every explosion)
  chain(pos, radius) {
    for (const m of this.mines) if (!m.fuse && m.pos.distanceTo(pos) < radius * 0.9) m.fuse = 0.1 + Math.random() * 0.2;
  }

  // ---------- EMP ----------
  fireEmp(vehicle) {
    if (this.charge.emp > 0) return false;
    const pos = vehicle.pos.clone(), r = 60 * Math.sqrt(this.hack.blast);
    this.emp = { pos, r, t: 0 };
    // mines in range short out, rockets in flight lose their motors
    for (let i = this.mines.length - 1; i >= 0; i--) if (this.mines[i].pos.distanceTo(pos) < r) { this.fizzle(this.mines[i]); this.mines.splice(i, 1); }
    for (const rk of this.rockets) if (rk.pos.distanceTo(pos) < r) rk.dead = true;
    // parked cars jolt as their electrics fry
    for (const t of this.d.targets) {
      if (t.state !== 'static' || !t.col || t.col.c.distanceTo(pos) > r) continue;
      t.wobble = { t: 0, amp: 0.035, dir: Math.random() * Math.PI * 2 };
      const c = t.col.c;
      for (let i = 0; i < 6; i++) this.fx.fire.spawn(c.x + (Math.random() - 0.5) * 2, c.y + 0.6, c.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, 0.35, 0.18, 0.04, 0.55, 0.85, 1, 1);
    }
    if (this.onEmp) this.onEmp(pos, r);
    this.charge.emp = this.chargeTime('emp');
    this.fired++;
    if (this.onFire) this.onFire(pos, 'emp');
    return true;
  }
  // is a point inside a pulse that is still stalling things? (for traffic and drones)
  empStalled(pos, seconds = 5) { return !!this.emp && this.emp.t < seconds && pos.distanceTo(this.emp.pos) < this.emp.r; }

  // ---------- orbital laser ----------
  orbital(at) {
    this.laser = { x: at.x, z: at.z, t: -1, tick: 0, boom: 0, follow: true, r: 2.2 * Math.sqrt(this.hack.blast), hit: new THREE.Vector3(at.x, at.y, at.z) };
    if (this.onFire) this.onFire(this.laser.hit, 'laser');
  }
  fireLaser(target) {
    if (this.charge.laser > 0 || this.laser) return false;
    this.orbital(target);
    this.charge.laser = this.chargeTime('laser');
    this.fired++;
    return true;
  }

  // ---------- black-hole bomb ----------
  blackHoleAt(at) {
    const p = at.clone(); p.y = Math.max(p.y, heightAt(p.x, p.z)) + 2;
    this.hole = { pos: p, vel: new THREE.Vector3(), phase: 'pull', t: 0, tick: 0 };
    if (this.onFire) this.onFire(p, 'blackhole');
  }
  fireBlackHole(model, vehicle, target) {
    if (this.charge.blackhole > 0 || this.hole) return false;
    const { from, dir } = this.muzzle(model, vehicle, target);
    this.hole = { pos: from.clone(), vel: dir.clone().multiplyScalar(45).add(vehicle.vel), phase: 'fly', t: 0, tick: 0 };
    this.charge.blackhole = this.chargeTime('blackhole');
    this.fired++;
    if (this.onFire) this.onFire(from, 'throw');
    return true;
  }

  // let go of whatever the grapple or tractor beam holds
  release() {
    if (this.rope) { this.rope = null; this.ropeMesh.visible = false; }
    if (this.held) { this.held.body.wake(); this.held = null; this.tractorMesh.visible = false; }
  }
  // drop everything in the world (rebuild)
  clearSpecials() {
    this.release();
    for (const m of this.mines) { m.mesh.visible = false; m.mesh.userData.busy = false; }
    this.mines.length = 0; this.thrown.length = 0;
    this.laser = null; this.laserCore.visible = this.laserGlow.visible = false;
    this.hole = null; this.holeCore.visible = this.holeDisk.visible = false;
  }

  // grapple and tractor beam run every physics step so the rope stays stiff
  physStep(dt, vehicle) {
    this.vehicle = vehicle;
    if (this.rope) {
      const r = this.rope, b = r.body;
      if (b && !b.alive) { this.rope = null; this.ropeMesh.visible = false; }
    }
    if (this.rope) {
      const r = this.rope, b = r.body;
      const P = _a.copy(vehicle.pos).addScaledVector(vehicle.up, 0.35);
      const A = this.ropeEnd(_b);
      _c.subVectors(A, P);
      let dist = _c.length();
      _c.divideScalar(dist || 1);
      if (dist > 220) { this.rope = null; this.ropeMesh.visible = false; dist = 0; }
      r.len = Math.max(4, r.len - 5 * dt); // reel in
      if (dist > r.len && this.rope) {
        const stretch = (b ? _c.dot(b.vel) : 0) - _c.dot(vehicle.vel); // > 0 while pulling apart
        const mEff = b ? 1 / (1 / vehicle.mass + 1 / b.mass) : vehicle.mass;
        const J = Math.min(mEff * 25, mEff * Math.max(0, stretch + 4 * (dist - r.len)));
        if (J > 0) {
          vehicle.applyImpulse(_p.copy(_c).multiplyScalar(J), P);
          if (b) { b.wake(); b.applyImpulse(_p.copy(_c).multiplyScalar(-J), A); }
        }
      }
    }
    if (this.held) {
      const b = this.held.body;
      if (!b.alive || b.pos.distanceTo(vehicle.pos) > 60) { this.held = null; this.tractorMesh.visible = false; }
    }
    if (this.held) {
      const b = this.held.body;
      b.wake();
      const H = this.holdPoint(vehicle, _a);
      _b.subVectors(H, b.pos).multiplyScalar(5);
      if (_b.length() > 40) _b.setLength(40);
      _b.add(vehicle.vel);
      b.vel.lerp(_b, Math.min(1, dt * 10));
      b.angVel.multiplyScalar(Math.exp(-3 * dt));
    }
    const d = this.d;
    // thrown pieces knock out whatever they fly into
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const th = this.thrown[i], b = th.body;
      th.t += dt;
      const sp = b.vel.length();
      if (!b.alive || th.t > 4 || (th.t > 0.3 && sp < 8)) { this.thrown.splice(i, 1); continue; }
      const r = b.radius + 0.4, touched = new Set();
      for (const c of queryBox(b.pos.x - r, b.pos.z - r, b.pos.x + r, b.pos.z + r)) {
        const o = c.owner;
        if (!o || o.state !== 'static' || !c.alive || !c.containsPoint(b.pos, b.radius)) continue;
        if (o.type === 'block') { d.detach(o, b.pos.clone().addScaledVector(b.vel, -0.05), Math.min(2, sp / 25)); touched.add(o.struct); }
        else if (o.type === 'barrel' && !d.pending.includes(o)) { o.fuse = 0.05; d.pending.push(o); }
        else if (o.type === 'target') d.launchTarget(o, b.pos.clone(), Math.min(1.5, sp / 30));
      }
      for (const st of touched) d.collapse(st);
    }
    // armed mines go off when the car rolls over them (once it has driven clear of them)
    for (const m of this.mines) {
      const near = Math.hypot(vehicle.pos.x - m.pos.x, vehicle.pos.z - m.pos.z) < 2.2 && Math.abs(vehicle.pos.y - m.pos.y) < 2;
      if (!near && m.pos.distanceTo(vehicle.pos) > 5) m.clear = true;
      if (near && m.clear && m.landed && m.t > 1 && !m.fuse) m.fuse = 0.05;
    }
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
    this.lastAim.copy(target);
    L.group.updateWorldMatrix(true, false);
    _p.copy(target);
    L.group.worldToLocal(_p);
    const yaw = Math.atan2(_p.x, _p.z);
    const pitch = Math.atan2(_p.y - 0.18, Math.hypot(_p.x, _p.z));
    L.yaw.rotation.y += (yaw - L.yaw.rotation.y) * snap;
    L.pitch.rotation.x += (-Math.max(-0.35, Math.min(0.9, pitch)) - L.pitch.rotation.x) * snap;
  }

  tryFire(model, vehicle, target) {
    if (this.equipped && this.mode !== 'rocket') {
      this.vehicle = vehicle;
      switch (this.mode) {
        case 'rail': return this.fireRail(model, vehicle, target);
        case 'grapple': return this.fireGrapple(model, vehicle, target);
        case 'mine': return this.dropMine(vehicle);
        case 'tractor': return this.fireTractor(model, vehicle, target);
        case 'emp': return this.fireEmp(vehicle);
        case 'laser': return this.fireLaser(target);
        case 'blackhole': return this.fireBlackHole(model, vehicle, target);
        default: return false;
      }
    }
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
    if (this.railCharge > 0) this.railCharge = Math.max(0, this.railCharge - dt);
    if (this.beamT > 0) { this.beamT -= dt; this.beam.material.opacity = Math.max(0, this.beamT / 0.45) * 0.9; this.beam.scale.x = this.beam.scale.z = 1 + (0.45 - this.beamT) * 3; if (this.beamT <= 0) this.beam.visible = false; }
    if (this.reload > 0) { this.reload -= dt; if (this.reload <= 0) { this.reload = 0; this.ammo = this.mag; } }
    for (const k in this.charge) if (this.charge[k] > 0) this.charge[k] = Math.max(0, this.charge[k] - dt);
    this.updateSpecials(dt);
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
      if (r.dead) r.vel.y -= 9.8 * dt; // fried by an EMP: falls like a stone
      else { if (sp < 175) r.vel.addScaledVector(r.dir, 260 * dt); r.vel.y -= 1.5 * dt; }
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

  // per-frame part of the Tab weapons: visuals, mines, laser, black hole
  updateSpecials(dt) {
    const d = this.d, v = this.vehicle, fx = this.fx;
    // grapple rope
    if (this.rope && v) {
      const P = _a.copy(v.pos).addScaledVector(v.up, 0.35), A = this.ropeEnd(_b);
      this.stretchMesh(this.ropeMesh, P, A);
    }
    // tractor beam cone from the roof to what it holds
    if (this.held && v) {
      const P = _a.copy(v.pos).addScaledVector(v.up, 0.9), A = _b.copy(this.held.body.pos);
      this.stretchMesh(this.tractorMesh, P, A);
      this.tractorMesh.material.opacity = 0.22 + Math.sin(performance.now() * 0.02) * 0.06;
      if (Math.random() < 0.5) fx.fire.spawn(A.x + (Math.random() - 0.5) * 2, A.y - 1, A.z + (Math.random() - 0.5) * 2, 0, 2.5, 0, 0.5, 0.18, 0.05, 0.4, 1, 0.7, 0.7);
    }
    // mines
    const blink = (performance.now() % 600) < 120;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.t += dt;
      if (!m.landed) {
        m.vel.y -= 9.8 * dt;
        _p.copy(m.pos); _p.y += 0.6;
        const g = groundBelow(_p, 400);
        const gy = g === Infinity ? heightAt(m.pos.x, m.pos.z) : _p.y - g;
        m.pos.addScaledVector(m.vel, dt);
        if (m.pos.y <= gy + 0.06) { m.pos.y = gy + 0.06; m.vel.set(0, 0, 0); m.landed = true; m.t = 0; }
      }
      const armed = m.landed && m.t > 1;
      if (armed && !m.fuse) {
        _p.copy(m.pos); _p.y += 0.4;
        const b = d.bodyHit(_p, 0.9);
        if (b && b.vel.lengthSq() > 1) m.fuse = 0.05;
      }
      if (m.fuse) {
        m.fuse -= dt;
        if (m.fuse <= 0) {
          this.mines.splice(i, 1); m.mesh.visible = false; m.mesh.userData.busy = false;
          const k = this.hack.blast;
          d.explode(m.pos.clone().add(_p.set(0, 0.4, 0)), 7 * k, 1.2 * k, 'mine');
          continue;
        }
      }
      m.mesh.position.copy(m.pos);
      m.mesh.userData.led.visible = armed ? blink || !!m.fuse : (performance.now() % 1000) < 500;
    }
    // EMP ring
    if (this.emp) {
      const e = this.emp;
      e.t += dt;
      const k = Math.min(1, e.t / 0.6);
      this.empMesh.visible = this.empRing.visible = k < 1;
      if (k < 1) {
        const rr = Math.max(0.1, e.r * k);
        this.empMesh.position.copy(e.pos); this.empMesh.scale.setScalar(rr);
        this.empMesh.material.opacity = 0.12 * (1 - k);
        this.empRing.position.set(e.pos.x, heightAt(e.pos.x, e.pos.z) + 0.4, e.pos.z); this.empRing.scale.setScalar(rr);
        this.empRing.material.opacity = 0.9 * (1 - k);
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2, rr = e.r * k;
          fx.fire.spawn(e.pos.x + Math.cos(a) * rr, Math.max(e.pos.y, heightAt(e.pos.x + Math.cos(a) * rr, e.pos.z + Math.sin(a) * rr) + 0.5), e.pos.z + Math.sin(a) * rr, 0, 1, 0, 0.3, 0.6, 0.1, 0.55, 0.85, 1, 0.9);
        }
      }
    }
    // orbital laser: aims for a second, then burns straight down for 4 s, following the crosshair
    if (this.laser) {
      const L = this.laser;
      L.t += dt;
      _c.set(this.lastAim.x - L.x, 0, this.lastAim.z - L.z);
      const step = Math.min(_c.length(), 14 * dt);
      if (step > 0.001 && L.follow && this.equipped) { _c.setLength(step); L.x += _c.x; L.z += _c.z; }
      _p.set(L.x, heightAt(L.x, L.z) + 400, L.z);
      if (raycast(_p, _down, 420, _hit)) L.hit.copy(_hit.point); else L.hit.set(L.x, heightAt(L.x, L.z), L.z);
      const top = _b.set(L.x, L.hit.y + 400, L.z);
      this.stretchMesh(this.laserCore, L.hit, top); this.stretchMesh(this.laserGlow, L.hit, top);
      if (L.t < 0) {
        // targeting: a thin flickering beam
        this.laserCore.visible = true; this.laserGlow.visible = false;
        this.laserCore.scale.x = this.laserCore.scale.z = 0.12;
        this.laserCore.material.opacity = 0.4 + 0.4 * Math.sin(L.t * 40);
      } else if (L.t < 4) {
        this.laserCore.visible = this.laserGlow.visible = true;
        const w = L.r / 2.2 * (1 + 0.08 * Math.sin(L.t * 50));
        this.laserCore.scale.x = this.laserCore.scale.z = w; this.laserGlow.scale.x = this.laserGlow.scale.z = w;
        this.laserCore.material.opacity = 0.95; this.laserGlow.material.opacity = 0.45;
        L.tick -= dt; L.boom -= dt;
        if (L.tick <= 0) {
          L.tick = 0.08;
          const r = L.r, touched = new Set();
          for (const c of queryBox(L.x - r - 1, L.z - r - 1, L.x + r + 1, L.z + r + 1)) {
            const o = c.owner;
            if (!o || o.state !== 'static' || !c.alive) continue;
            if (o.type === 'block') {
              if (Math.hypot(o.pos.x - L.x, o.pos.z - L.z) > r + Math.max(o.half.x, o.half.z) || o.pos.y < L.hit.y - 1.5 || o.pos.y > L.hit.y + 2) continue;
              d.shatter(o, _p.set(L.x, o.pos.y + 1, L.z), 0.5); touched.add(o.struct);
            } else if (o.type === 'barrel' && !d.pending.includes(o) && o.pos.distanceTo(L.hit) < r + 1) { o.fuse = 0.05; d.pending.push(o); }
            else if (o.type === 'target' && o.col.c.distanceTo(L.hit) < r + 2) d.launchTarget(o, L.hit.clone(), 0.9);
          }
          for (const st of touched) d.collapse(st);
        }
        if (L.boom <= 0) { L.boom = 0.5; const k = this.hack.blast; d.explode(L.hit.clone().add(_p.set(0, 0.5, 0)), 3.5 * Math.sqrt(k), 0.5 * k, 'laser'); }
        for (let i = 0; i < 5; i++) fx.fire.spawn(L.hit.x, L.hit.y + 0.3, L.hit.z, (Math.random() - 0.5) * 10, Math.random() * 8, (Math.random() - 0.5) * 10, 0.4, 0.5, 0.08, 1, 0.55, 0.3, 1, { grav: 9 });
        if (Math.random() < 0.6) fx.smoke.spawn(L.hit.x, L.hit.y + 1, L.hit.z, (Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2, 2.5, 1.5, 5, 0.2, 0.18, 0.17, 0.5, { drag: 0.8, grav: -1 });
      } else { this.laser = null; this.laserCore.visible = this.laserGlow.visible = false; }
    }
    // black hole: flies like a grenade, then pulls everything in for 4 s and blasts it back out
    if (this.hole) {
      const H = this.hole, k = this.hack.blast;
      H.t += dt;
      if (H.phase === 'fly') {
        H.vel.y -= 9.8 * 0.5 * dt;
        const sp = H.vel.length(), step = sp * dt;
        _d.copy(H.vel).normalize();
        let at = null;
        if (raycast(H.pos, _d, step + 0.3, _hit, { twoSided: true })) at = _hit.point.clone().addScaledVector(_d, -0.4);
        else if (d.bodyHit(_p.copy(H.pos).addScaledVector(_d, step), 0.4)) at = _p.clone();
        if (at || H.t > 4) { H.pos.copy(at || H.pos); H.pos.y = Math.max(H.pos.y, heightAt(H.pos.x, H.pos.z)) + 2; H.phase = 'pull'; H.t = 0; if (this.onFire) this.onFire(H.pos, 'blackhole'); }
        else H.pos.addScaledVector(H.vel, dt);
        this.holeCore.visible = true; this.holeDisk.visible = true;
        this.holeCore.position.copy(H.pos); this.holeCore.scale.setScalar(0.35);
        this.holeDisk.position.copy(H.pos); this.holeDisk.scale.setScalar(0.3);
        fx.fire.spawn(H.pos.x, H.pos.y, H.pos.z, 0, 0, 0, 0.25, 0.6, 0.1, 0.7, 0.3, 1, 0.8);
      } else if (H.t < 4) {
        const R = 50 * Math.sqrt(k), grow = Math.min(1, H.t / 1.5), C = H.pos;
        // loose bodies spiral in and clump at the centre
        for (const b of d.bodies) {
          if (!b.alive) continue;
          _c.subVectors(C, b.pos); const dist = _c.length();
          if (dist > R || dist < 0.01) continue;
          b.wake();
          _c.divideScalar(dist);
          const acc = (12 + 70 * (1 - dist / R)) * grow;
          b.vel.addScaledVector(_c, acc * dt);
          b.vel.addScaledVector(_a.crossVectors(_up, _c), acc * 0.35 * dt);
          b.vel.y += 9.8 * d.gravityScale * 0.9 * dt;
          if (dist < 3) b.vel.multiplyScalar(Math.exp(-4 * dt));
        }
        // the car feels it too
        if (v) { _c.subVectors(C, v.pos); const dist = _c.length(); if (dist < R && dist > 1) v.applyImpulse(_c.multiplyScalar(v.mass * (8 + 25 * (1 - dist / R)) * grow * dt / dist), v.pos); }
        // walls near the hole tear loose, parked cars get sucked off the ground
        H.tick -= dt;
        if (H.tick <= 0) {
          H.tick = 0.15;
          const rs = (6 + 10 * grow) * Math.sqrt(k), touched = new Set();
          for (const c of queryBox(C.x - rs * 1.3, C.z - rs * 1.3, C.x + rs * 1.3, C.z + rs * 1.3)) {
            const o = c.owner;
            if (!o || o.state !== 'static' || !c.alive) continue;
            if (o.type === 'block' && o.pos.distanceTo(C) < rs && Math.random() < 0.35) { d.makeBlockBody(o); touched.add(o.struct); }
            else if (o.type === 'target' && o.col.c.distanceTo(C) < rs * 1.3) d.launchTarget(o, C, 0.0001);
            else if (o.type === 'barrel' && o.pos.distanceTo(C) < 5 && !d.pending.includes(o)) { o.fuse = 0.2; d.pending.push(o); }
          }
          for (const st of touched) d.collapse(st);
        }
        const s = 0.6 + 1.6 * grow + 0.1 * Math.sin(H.t * 30);
        this.holeCore.position.copy(C); this.holeCore.scale.setScalar(s);
        this.holeDisk.position.copy(C); this.holeDisk.scale.setScalar(s * 1.1);
        this.holeDisk.rotation.set(Math.PI / 2 + 0.35, H.t * 3, 0);
        this.holeDisk.material.opacity = 0.55;
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 1.2, rr = 10 + Math.random() * 8;
          _p.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).multiplyScalar(rr);
          fx.smoke.spawn(C.x + _p.x, C.y + _p.y, C.z + _p.z, -_p.x * 1.3, -_p.y * 1.3, -_p.z * 1.3, 0.75, 1.2, 0.2, 0.35, 0.15, 0.5, 0.5, { drag: 0 });
        }
      } else {
        // collapse: everything it swallowed is thrown back out
        d.explode(H.pos.clone(), 24 * k, 2.4 * k, 'blackhole');
        this.hole = null; this.holeCore.visible = this.holeDisk.visible = false;
      }
    }
  }
  // stretch a unit-height cylinder between two points
  stretchMesh(mesh, a, b) {
    _p.subVectors(b, a); const len = _p.length() || 0.01;
    mesh.position.copy(a).addScaledVector(_p, 0.5);
    mesh.quaternion.setFromUnitVectors(_up, _p.divideScalar(len));
    mesh.scale.y = len; mesh.visible = true;
  }

  clear() {
    for (const r of this.rockets) { r.mesh.visible = false; r.mesh.userData.busy = false; }
    this.pendingBlasts.length = 0;
    this.rockets.length = 0;
  }
}
