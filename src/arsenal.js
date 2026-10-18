// Arsenal (2.2): 14 extra roof-pod weapons on top of rockets and the railgun. Tab cycles through them.
// One small projectile system (instanced glowing orbs) plus hitscan beams; everything breaks things
// through the destruction system, so credits, shockwaves and glass all work as usual.
import * as THREE from 'three';
import { raycast, makeHit, queryBox } from './colliders.js';
import { heightAt } from './terrain.js';

// cd = seconds between shots, col = tracer colour
export const ARSENAL = [
  { id: 'minigun', name: 'Minigun', cd: 0.05, col: '#ffd36b', tip: 'hold fire: a stream of explosive rounds' },
  { id: 'shotgun', name: 'Shotgun', cd: 0.7, col: '#ffb547', tip: '10 pellets in a wide blast' },
  { id: 'grenade', name: 'Grenade launcher', cd: 0.6, col: '#7dff8a', tip: 'arcing grenades, 2 s fuse' },
  { id: 'flame', name: 'Flamethrower', cd: 0.04, col: '#ff7a2a', tip: 'short-range fire that eats walls' },
  { id: 'laser', name: 'Laser', cd: 0.06, col: '#ff3b5c', tip: 'hold fire: a continuous cutting beam' },
  { id: 'plasma', name: 'Plasma cannon', cd: 1.2, col: '#b14cff', tip: 'slow orb, huge blast' },
  { id: 'sniper', name: 'Sniper', cd: 1.0, col: '#eef6ff', tip: '800 m, hits hard' },
  { id: 'mines', name: 'Mines', cd: 0.5, col: '#ff4d4d', tip: 'dropped behind the car, armed after 1 s' },
  { id: 'clusterbomb', name: 'Cluster bomb', cd: 1.0, col: '#ffe066', tip: 'splits into 10 bomblets' },
  { id: 'blackhole', name: 'Black hole', cd: 4.0, col: '#6a2bd8', tip: 'pulls debris in for 3 s, then blows it all out' },
  { id: 'tesla', name: 'Tesla coil', cd: 1.1, col: '#7fe3ff', tip: 'lightning jumps between up to 8 targets' },
  { id: 'orbital', name: 'Orbital laser', cd: 5.0, col: '#ff6a3a', tip: 'marks the crosshair; a beam from space follows' },
  { id: 'meteor', name: 'Meteor shower', cd: 6.0, col: '#ffa040', tip: '14 meteors around the crosshair' },
  { id: 'hammer', name: 'Gravity hammer', cd: 1.5, col: '#9fe8ff', tip: 'a cone of force that flings everything ahead' },
];

const _hit = makeHit(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();

export class Arsenal {
  constructor(scene, fx, d, hack) {
    this.scene = scene; this.fx = fx; this.d = d; this.hack = hack;
    this.shots = []; this.mines = []; this.holes = []; this.strikes = [];
    this.cap = 400;
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), this.cap);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set('#ffffff'));   // create the colour buffer now (avoids a shader rebuild mid-game)
    scene.add(this.mesh);
    // beams (laser, sniper, tesla, orbital): short-lived thick lines
    this.beams = [];
    for (let i = 0; i < 64; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      b.visible = false; b.frustumCulled = false; scene.add(b); this.beams.push({ m: b, t: 0, life: 1 });
    }
    this.time = 0;
  }
  beam(a, b, col, width, life) {
    const B = this.beams.find(x => x.t <= 0) || this.beams.reduce((a, x) => (x.t < a.t ? x : a));
    _d.subVectors(b, a); const len = _d.length(); if (len < 0.01) return;
    B.m.position.copy(a).addScaledVector(_d, 0.5);
    B.m.quaternion.setFromUnitVectors(_p.set(0, 1, 0), _d.normalize());
    B.m.scale.set(width, len, width); B.m.material.color.set(col); B.m.visible = true; B.t = life; B.life = life; B.w = width;
  }
  boom(p, r, power) { const k = this.hack.blast || 1; this.d.explode(p.clone(), r * k, power * k, 'gun'); }
  shoot(pos, vel, o) {
    if (this.shots.length >= this.cap - 40) return;   // full: drop the new shot (keeps room to draw mines + holes)
    this.shots.push(Object.assign({ pos: pos.clone(), vel: vel.clone(), life: 0, max: 5, grav: 0, size: 0.12, r: 2, power: 0.4, col: '#ffffff' }, o));
  }
  // first thing along a ray: world collider or loose debris
  trace(from, dir, range) {
    let end = range;
    if (raycast(from, dir, range, _hit, { twoSided: true })) end = _hit.t;
    for (let s = 2; s < end; s += 1) { _p.copy(from).addScaledVector(dir, s); if (this.d.bodyHit(_p, 0.3)) { end = s; break; } }
    return end;
  }

  fire(id, from, dir, vehicle, target) {
    const V = vehicle.vel, rnd = () => (Math.random() - 0.5);
    const noG = this.hack.noGravity, big = this.hack.bigShots ? 2.5 : 1, ex = this.hack.explosiveRounds ? 1.8 : 1;
    const g = (x) => noG ? 0 : x;
    switch (id) {
      case 'minigun': {
        const d = dir.clone().add(_p.set(rnd() * 0.03, rnd() * 0.03, rnd() * 0.03)).normalize();
        this.shoot(from, d.multiplyScalar(320).add(V), { col: '#ffd36b', size: 0.08 * big, r: 1.6 * ex, power: 0.25 * ex, max: 2.5 });
        break;
      }
      case 'shotgun':
        for (let i = 0; i < 10; i++) { const d = dir.clone().add(_p.set(rnd() * 0.16, rnd() * 0.12, rnd() * 0.16)).normalize(); this.shoot(from, d.multiplyScalar(230).add(V), { col: '#ffb547', size: 0.07 * big, r: 1.6 * ex, power: 0.3 * ex, max: 1.5 }); }
        break;
      case 'grenade': this.shoot(from, dir.clone().multiplyScalar(42).add(_p.set(0, 8, 0)).add(V), { col: '#7dff8a', size: 0.18 * big, grav: g(9.81), bounce: true, fuse: 2, r: 7 * ex, power: 1 * ex }); break;
      case 'flame':
        for (let i = 0; i < 3; i++) { const d = dir.clone().add(_p.set(rnd() * 0.15, rnd() * 0.1, rnd() * 0.15)).normalize(); this.shoot(from, d.multiplyScalar(34 + Math.random() * 8).add(V), { col: '#ff7a2a', size: 0.25 * big, grav: g(-2), max: 0.8, r: 1.4, power: 0.18, flame: true }); }
        break;
      case 'laser': {
        const end = this.trace(from, dir, 250);
        const hit = from.clone().addScaledVector(dir, end);
        this.beam(from, hit, '#ff3b5c', 0.05 * big, 0.08);
        if (end < 250 && Math.random() < 0.5) this.boom(hit, 1.6 * ex, 0.3 * ex);
        this.fx.fire.spawn(hit.x, hit.y, hit.z, rnd() * 3, Math.random() * 3, rnd() * 3, 0.25, 0.4, 0.1, 1, 0.3, 0.3, 1);
        break;
      }
      case 'plasma': this.shoot(from, dir.clone().multiplyScalar(48).add(V), { col: '#b14cff', size: 0.7 * big, r: 13 * ex, power: 1.7 * ex, max: 6, glow: true }); break;
      case 'sniper': {
        const end = this.trace(from, dir, 800);
        const hit = from.clone().addScaledVector(dir, end);
        this.beam(from, hit, '#eef6ff', 0.03 * big, 0.3);
        if (end < 800) this.boom(hit, 3.5 * ex, 1.3 * ex);
        vehicle.applyImpulse(dir.clone().multiplyScalar(-1800), from);
        break;
      }
      case 'mines': {
        const back = vehicle.pos.clone().addScaledVector(vehicle.fwd, -2.8);
        const top = back.clone().setY(vehicle.pos.y + 1);
        back.y = raycast(top, _p.set(0, -1, 0), 8, _hit) ? _hit.point.y + 0.15 : heightAt(back.x, back.z) + 0.15;
        this.mines.push({ pos: back, t: 0, clear: false });
        if (this.mines.length > 30) this.mines.shift();
        break;
      }
      case 'clusterbomb': this.shoot(from, dir.clone().multiplyScalar(40).add(_p.set(0, 10, 0)).add(V), { col: '#ffe066', size: 0.3 * big, grav: g(9.81), split: 1.1, r: 5 * ex, power: 0.8 * ex }); break;
      case 'blackhole': this.shoot(from, dir.clone().multiplyScalar(26).add(V), { col: '#6a2bd8', size: 0.6 * big, max: 2.2, hole: true, glow: true }); break;
      case 'tesla': this.tesla(from, target, ex); break;
      case 'orbital': this.strikes.push({ pos: target.clone(), t: -1.4, kind: 'orbital' }); this.fx.fire.spawn(target.x, target.y + 0.5, target.z, 0, 0, 0, 1.4, 3, 6, 1, 0.3, 0.2, 0.9); break;
      case 'meteor': for (let i = 0; i < 14; i++) this.strikes.push({ pos: target.clone().add(_p.set(rnd() * 50, 0, rnd() * 50)), t: -i * 0.18, kind: 'meteor' }); break;
      case 'hammer': this.hammer(vehicle, dir); break;
    }
  }

  // chain lightning: hops to the nearest standing thing it hasn't hit, up to 8 times
  tesla(from, target, ex) {
    let a = from.clone(), at = target.clone();
    const hit = new Set();
    for (let k = 0; k < 8; k++) {
      this.zap(a, at);
      this.boom(at, 2.5 * ex, 0.6 * ex);
      a = at.clone();
      let best = null, bd = 40;
      for (const c of queryBox(a.x - 40, a.z - 40, a.x + 40, a.z + 40)) {
        const o = c.owner;
        if (!o || o.state !== 'static' || hit.has(o) || !c.alive) continue;
        const dd = c.c.distanceTo(a);
        if (dd > 3 && dd < bd) { bd = dd; best = o; at = c.c.clone(); }
      }
      if (!best) break;
      hit.add(best);
    }
  }
  zap(a, b) {
    // jagged bolt from a few beam segments
    let p = a.clone();
    for (let i = 1; i <= 6; i++) {
      const q = a.clone().lerp(b, i / 6);
      if (i < 6) q.add(_s.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2));
      this.beam(p, q, '#bff4ff', 0.06, 0.18);
      p = q;
    }
  }
  hammer(vehicle, dir) {
    const d = this.d, o = vehicle.pos, flat = _d.copy(dir).setY(0).normalize();
    const touched = new Set();
    for (const b of d.bodies) {
      if (!b.alive) continue;
      _p.subVectors(b.pos, o); const dist = _p.length();
      if (dist > 45 || _p.normalize().dot(flat) < 0.6) continue;
      b.wake(); b.applyImpulse(_p.clone().add(_s.set(0, 0.5, 0)).normalize().multiplyScalar(b.mass * (22 - dist * 0.35)), b.pos);
    }
    for (const t of d.targets) if (t.state === 'static') { _p.subVectors(t.col.c, o); const dist = _p.length(); if (dist < 40 && _p.normalize().dot(flat) > 0.6) d.launchTarget(t, o, 1.8 - dist / 30); }
    for (const b of d.blocks) if (b.state === 'static') { _p.subVectors(b.pos, o); const dist = _p.length(); if (dist < 18 && _p.normalize().dot(flat) > 0.7) { d.detach(b, o, 1.2); touched.add(b.struct); } }
    for (const s of touched) d.collapse(s);
    for (let i = 0; i < 40; i++) { const q = o.clone().addScaledVector(flat, 3 + Math.random() * 25).add(_s.set((Math.random() - 0.5) * 10, Math.random() * 2, (Math.random() - 0.5) * 10)); this.fx.smoke.spawn(q.x, q.y, q.z, flat.x * 25, 2, flat.z * 25, 1, 1, 4, 0.75, 0.9, 1, 0.35, { drag: 2 }); }
    vehicle.applyImpulse(flat.clone().multiplyScalar(-6000), o);
  }

  update(dt, vehicle) {
    if (dt <= 0) return;
    this.time += dt;
    const d = this.d;
    // projectiles (bomblets from cluster splits are added after the loop)
    const spawn = [];
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life += dt;
      s.vel.y -= s.grav * dt;
      const sp = s.vel.length(), step = sp * dt;
      _d.copy(s.vel).divideScalar(sp || 1);
      let at = null, n = null;
      if (raycast(s.pos, _d, step + 0.2, _hit, { twoSided: true })) { at = _hit.point.clone().addScaledVector(_d, -0.2); n = _hit.normal; }
      if (!at) for (let k = 1; k <= 2; k++) { _p.copy(s.pos).addScaledVector(_d, step * k / 2); if (d.bodyHit(_p, s.size + 0.2)) { at = _p.clone(); n = _s.copy(_d).negate(); break; } }
      if (at && s.bounce && s.life < s.fuse) { s.vel.reflect(n).multiplyScalar(0.45); if (s.vel.dot(n) < 0) s.vel.addScaledVector(n, -s.vel.dot(n)); at = null; }
      if (s.flame && Math.random() < dt * 30) this.fx.fire.spawn(s.pos.x, s.pos.y, s.pos.z, s.vel.x * 0.3, 1, s.vel.z * 0.3, 0.35, 0.6, 1.8, 1, 0.45, 0.1, 0.6, { r1: 0.5, g1: 0.1, b1: 0.02, drag: 2 });
      const expired = s.life > (s.fuse || s.max) || (s.split && s.life > s.split);
      if (at || expired) {
        const p = at || s.pos.clone();
        const gh = heightAt(p.x, p.z); if (p.y < gh + 0.3) p.y = gh + 0.3;
        if (s.split) { for (let k = 0; k < 10; k++) spawn.push([p, new THREE.Vector3((Math.random() - 0.5) * 16, 4 + Math.random() * 6, (Math.random() - 0.5) * 16).addScaledVector(s.vel, 0.3), { col: '#ffe066', size: 0.14, grav: s.grav, r: s.r, power: s.power, max: 4 }]); }
        else if (s.hole) this.holes.push({ pos: p, t: 0 });
        else if (s.flame) { if (at && Math.random() < 0.35) this.boom(p, s.r, s.power); }
        else this.boom(p, s.r, s.power);
        this.shots.splice(i, 1); continue;
      }
      s.pos.addScaledVector(s.vel, dt);
    }
    for (const a of spawn) this.shoot(...a);
    // mines: armed after 1 s, go off when the car or debris comes close
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]; m.t += dt;
      const dc = vehicle.pos.distanceTo(m.pos);
      if (dc > 3.6) m.clear = true;
      if (m.t < 1) continue;
      const near = (m.clear && dc < 3.2) || d.bodyHit(m.pos, 2.5) || m.t > 60;
      if (near) { this.boom(m.pos, 8, 1.3); this.mines.splice(i, 1); }
    }
    // black holes: 3 s of pull, then a big blast
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i]; h.t += dt;
      for (const b of d.bodies) {
        if (!b.alive) continue;
        _p.subVectors(h.pos, b.pos); const dist = _p.length();
        if (dist > 30 || dist < 0.5) continue;
        b.wake(); b.vel.addScaledVector(_p.normalize(), dt * 60 / Math.max(1, dist * 0.3));
      }
      if (Math.random() < dt * 4) for (const c of queryBox(h.pos.x - 9, h.pos.z - 9, h.pos.x + 9, h.pos.z + 9)) {
        const o = c.owner;
        if (o && o.type === 'block' && o.state === 'static' && o.pos.distanceTo(h.pos) < 9 && Math.random() < 0.3) { const body = d.makeBlockBody(o); body.vel.set(0, 2, 0); d.collapse(o.struct); }
      }
      for (let k = 0; k < 3; k++) { const a = Math.random() * 6.28, r = 4 + Math.random() * 10; this.fx.smoke.spawn(h.pos.x + Math.cos(a) * r, h.pos.y + (Math.random() - 0.5) * 6, h.pos.z + Math.sin(a) * r, -Math.cos(a) * r * 2, 0, -Math.sin(a) * r * 2, 0.5, 1.5, 0.2, 0.25, 0.1, 0.45, 0.6, { drag: 0.5 }); }
      if (h.t > 3) { this.boom(h.pos, 15, 2.2); this.holes.splice(i, 1); }
    }
    // orbital strikes and meteors
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i]; s.t += dt;
      if (s.t < 0) { if (s.kind === 'orbital' && Math.random() < dt * 20) this.beam(s.pos.clone().setY(s.pos.y + 400), s.pos, '#ff6a3a', 0.08, 0.05); continue; }
      if (s.kind === 'orbital') {
        if (!s.fired) { s.fired = true; this.boom(s.pos, 20, 2.5); }
        this.beam(s.pos.clone().setY(s.pos.y + 500), s.pos, '#ffd0a0', 2.5 - s.t * 2, 0.06);
        if (s.t > 1) this.strikes.splice(i, 1);
      } else {
        this.shoot(s.pos.clone().add(_p.set(30, 160, 20)), _p.set(-30, -160, -20).normalize().multiplyScalar(110), { col: '#ffa040', size: 1.2, r: 8, power: 1.2, max: 4, glow: true, meteor: true });
        this.strikes.splice(i, 1);
      }
    }
    for (const B of this.beams) if (B.t > 0) { B.t -= dt; B.m.material.opacity = Math.max(0, B.t / B.life); if (B.t <= 0) B.m.visible = false; }
    this.draw();
  }
  draw() {
    let n = 0;
    const rainbow = this.hack.rainbowTracers;
    for (const s of this.shots) {
      if (n >= this.cap) break;
      const pulse = s.glow ? 1 + 0.2 * Math.sin(this.time * 20) : 1;
      this.mesh.setMatrixAt(n, _m.compose(s.pos, _q.identity(), _s.setScalar(s.size * pulse)));
      if (rainbow) _c.setHSL((this.time * 0.8 + n * 0.07) % 1, 1, 0.6); else _c.set(s.col);
      this.mesh.setColorAt(n, _c.multiplyScalar(2));
      if (s.meteor && Math.random() < 0.5) this.fx.fire.spawn(s.pos.x, s.pos.y, s.pos.z, 0, 0, 0, 0.6, 2, 0.5, 1, 0.5, 0.1, 0.8);
      n++;
    }
    for (const m of this.mines) { if (n >= this.cap) break; this.mesh.setMatrixAt(n, _m.compose(m.pos, _q.identity(), _s.set(0.35, 0.12, 0.35))); this.mesh.setColorAt(n, _c.set(m.t > 1 && (this.time * 3 % 1) < 0.5 ? '#ff2a2a' : '#552222')); n++; }
    for (const h of this.holes) { if (n >= this.cap) break; this.mesh.setMatrixAt(n, _m.compose(h.pos, _q.identity(), _s.setScalar(1.2 + h.t * 0.6))); this.mesh.setColorAt(n, _c.set('#000000')); n++; }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.shots.length = 0; this.mines.length = 0; this.holes.length = 0; this.strikes.length = 0; this.mesh.count = 0; }
}
