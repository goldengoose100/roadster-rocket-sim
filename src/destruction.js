// Destruction physics. Structures are made of blocks that stay static (and solid) until an
// explosion hits them. Then blocks detach or shatter into fragments, unsupported blocks collapse,
// barrels chain-react and target vehicles get thrown. Only explosions can destroy anything.
import * as THREE from 'three';
import { OBB, addCollider, pointContact, queryBox, makeHit } from './colliders.js';
import { heightAt } from './terrain.js';

const G = 9.81;
const _p = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _hit = makeHit();
const _bi = new THREE.Vector3();
const _rp = new THREE.Vector3(), _rn = new THREE.Vector3(), _rA = new THREE.Vector3(), _rB = new THREE.Vector3(), _vA = new THREE.Vector3(), _vB = new THREE.Vector3();
const _rJ = new THREE.Vector3(), _rvt = new THREE.Vector3(), _rk = new THREE.Vector3();
const SIGNS = [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]];

function blockTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) { const v = 200 + Math.random() * 55; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  const gr = g.createLinearGradient(0, 0, 128, 0);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 6; g.strokeRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 14; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function barrelTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b3201b'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f2c230'; g.fillRect(0, 50, 128, 28);
  g.fillStyle = '#111';
  for (let x = -20; x < 140; x += 22) { g.beginPath(); g.moveTo(x, 78); g.lineTo(x + 11, 50); g.lineTo(x + 22, 50); g.lineTo(x + 11, 78); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 18, 128, 5); g.fillRect(0, 105, 128, 5);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const MATERIALS = {
  concrete: { color: '#b9b4aa', density: 1300 },
  brick: { color: '#a5523a', density: 1500 },
  wood: { color: '#8a6038', density: 450 },
  crate: { color: '#b08850', density: 160 },
  metal: { color: '#6f7780', density: 900 },
};

class Body {
  constructor(pos, quat, half, mass, render) {
    this.pos = pos.clone(); this.quat = quat.clone(); this.half = half.clone();
    this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.setMass(mass);
    this.render = render; // {mesh, index} | {obj}
    this.sleeping = false; this.sleepT = 0; this.alive = true; this.age = 0;
    this.ax = new THREE.Vector3(); this.ay = new THREE.Vector3(); this.az = new THREE.Vector3();
    this.radius = half.length();
    this.updateAxes();
  }
  setMass(m) {
    this.mass = m; this.invMass = 1 / m;
    const h = this.half, x = 2 * h.x, y = 2 * h.y, z = 2 * h.z;
    this.invI = new THREE.Vector3(12 / (m * (y * y + z * z)), 12 / (m * (x * x + z * z)), 12 / (m * (x * x + y * y)));
  }
  updateAxes() {
    this.ax.set(1, 0, 0).applyQuaternion(this.quat);
    this.ay.set(0, 1, 0).applyQuaternion(this.quat);
    this.az.set(0, 0, 1).applyQuaternion(this.quat);
  }
  // world inverse inertia times v (in place)
  invIWorld(v) {
    const ax = this.ax, ay = this.ay, az = this.az;
    const lx = v.dot(ax) * this.invI.x, ly = v.dot(ay) * this.invI.y, lz = v.dot(az) * this.invI.z;
    v.set(ax.x * lx + ay.x * ly + az.x * lz, ax.y * lx + ay.y * ly + az.y * lz, ax.z * lx + ay.z * ly + az.z * lz);
    return v;
  }
  applyImpulse(J, P) {
    this.vel.addScaledVector(J, this.invMass);
    _bi.subVectors(P, this.pos).cross(J);
    this.angVel.add(this.invIWorld(_bi));
  }
  wake() { this.sleeping = false; this.sleepT = 0; }
  corner(i, out) {
    const s = SIGNS[i], h = this.half;
    return out.copy(this.pos).addScaledVector(this.ax, s[0] * h.x).addScaledVector(this.ay, s[1] * h.y).addScaledVector(this.az, s[2] * h.z);
  }
  penetrate(p, outN) {
    const dx = p.x - this.pos.x, dy = p.y - this.pos.y, dz = p.z - this.pos.z;
    const lx = dx * this.ax.x + dy * this.ax.y + dz * this.ax.z;
    const ly = dx * this.ay.x + dy * this.ay.y + dz * this.ay.z;
    const lz = dx * this.az.x + dy * this.az.y + dz * this.az.z;
    const h = this.half;
    const ex = h.x - Math.abs(lx), ey = h.y - Math.abs(ly), ez = h.z - Math.abs(lz);
    if (ex <= 0 || ey <= 0 || ez <= 0) return 0;
    if (ey <= ex && ey <= ez) { outN.copy(this.ay).multiplyScalar(Math.sign(ly) || 1); return ey; }
    if (ex <= ez) { outN.copy(this.ax).multiplyScalar(Math.sign(lx) || 1); return ex; }
    outN.copy(this.az).multiplyScalar(Math.sign(lz) || 1); return ez;
  }
}

export class Destruction {
  constructor(scene) {
    this.scene = scene;
    this.blocks = [];
    this.structures = [];
    this.bodies = [];
    this.barrels = [];
    this.targets = [];
    this.props = [];
    this.pending = [];       // barrel fuses
    this.onExplode = null;   // set by game: (pos, radius, power, kind) => void
    this.onImpact = null;    // debris impact for sound: (pos, speed)
    this.hash = new Map();
    this.tex = blockTexture();
    this.meshes = {};
    this.counts = {};
    this.stats = { destroyed: 0 };
    this.fragBodies = [];
    this.gravityScale = 1;
    this.spare = { concrete: 300, brick: 300, wood: 120, crate: 400, metal: 50 };
  }

  // ---------- building API (call before finalize) ----------
  structure(cx, cz, yaw) {
    const s = { cx, cz, yaw, blocks: [], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), cos: Math.cos(yaw), sin: Math.sin(yaw) };
    this.structures.push(s);
    return s;
  }
  // add block in structure-local coords (lx, ly = bottom, lz), size (sx, sy, sz), local yaw
  block(s, lx, ly, lz, sx, sy, sz, mat, localYaw = 0) {
    const c = s.cos, sn = s.sin;
    const wx = s.cx + c * lx + sn * lz, wz = s.cz - sn * lx + c * lz;
    const ground = heightAt(s.cx, s.cz);
    const pos = new THREE.Vector3(wx, ground + ly + sy / 2, wz);
    const q = s.q.clone();
    if (localYaw) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), localYaw));
    const half = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
    // local AABB (for adjacency)
    const ca = Math.abs(Math.cos(localYaw)), sa = Math.abs(Math.sin(localYaw));
    const ex = ca * half.x + sa * half.z, ez = sa * half.x + ca * half.z;
    const b = {
      type: 'block', struct: s, mat, pos, quat: q, half, home: { pos: pos.clone(), quat: q.clone() },
      lmin: [lx - ex, ly, lz - ez], lmax: [lx + ex, ly + sy, lz + ez], grounded: ly < 0.05, neighbors: [], state: 'static', body: null,
      mass: Math.max(15, sx * sy * sz * MATERIALS[mat].density), index: 0, col: null,
    };
    this.counts[mat] = (this.counts[mat] || 0) + 1;
    s.blocks.push(b); this.blocks.push(b);
    return b;
  }
  barrel(x, z) {
    const y = heightAt(x, z);
    const b = { type: 'barrel', pos: new THREE.Vector3(x, y + 0.45, z), state: 'static', index: this.barrels.length, col: null, fuse: 0 };
    this.barrels.push(b);
    return b;
  }
  // target: an Object3D whose box (half extents, centre offset) becomes a dynamic body when blasted
  target(obj, half, mass, centerY) {
    const t = { type: 'target', obj, half: half.clone(), mass, centerY, state: 'static', col: null, body: null,
      home: { pos: obj.position.clone(), quat: obj.quaternion.clone() } };
    this.targets.push(t);
    return t;
  }
  prop(obj, half, mass) { // pushable object (cones): starts as sleeping body
    const body = new Body(obj.position, obj.quaternion, half, mass, { obj, offsetY: -half.y });
    body.pos.y += half.y; body.sleeping = true; body.kind = 'prop';
    body.home = { pos: body.pos.clone(), quat: body.quat.clone() };
    this.props.push(body); this.bodies.push(body);
    return body;
  }

  finalize() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const mat of Object.keys(MATERIALS)) this.counts[mat] = this.counts[mat] || 0;
    for (const mat of Object.keys(this.counts)) {
      const cap = this.counts[mat] + (this.spare[mat] || 0);
      const m = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: this.tex, color: MATERIALS[mat].color, roughness: 0.9, metalness: mat === 'metal' ? 0.5 : 0 }), cap);
      for (let i = 0; i < cap; i++) m.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      m.userData.free = [];
      for (let i = cap - 1; i >= this.counts[mat]; i--) m.userData.free.push(i);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes[mat] = m; this.scene.add(m);
      m.userData.n = 0;
    }
    const col = new THREE.Color();
    for (const b of this.blocks) {
      const m = this.meshes[b.mat];
      b.index = m.userData.n++;
      col.set(MATERIALS[b.mat].color).multiplyScalar(0.86 + Math.random() * 0.24);
      m.setColorAt(b.index, col);
      this.setBlockMatrix(b, b.pos, b.quat);
      b.col = addCollider(new OBB(b.pos, b.quat, b.half, { owner: b, grip: 0.9, surface: 'concrete' }));
    }
    for (const m of Object.values(this.meshes)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // adjacency per structure (local AABB touch test)
    for (const s of this.structures) {
      const bl = s.blocks;
      for (let i = 0; i < bl.length; i++) for (let j = i + 1; j < bl.length; j++) {
        const a = bl[i], b = bl[j];
        let touch = true, gapAxes = 0;
        for (let k = 0; k < 3; k++) {
          const overlap = Math.min(a.lmax[k], b.lmax[k]) - Math.max(a.lmin[k], b.lmin[k]);
          if (overlap < -0.07) { touch = false; break; }
          if (overlap < 0.03) gapAxes++;
        }
        if (touch && gapAxes <= 1) { a.neighbors.push(b); b.neighbors.push(a); }
      }
    }
    // fragments pool
    this.fragCap = 520;
    this.fragMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9 }), this.fragCap);
    this.fragMesh.castShadow = true; this.fragMesh.frustumCulled = false;
    this.fragMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fragFree = [];
    for (let i = this.fragCap - 1; i >= 0; i--) { this.fragFree.push(i); this.fragMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); this.fragMesh.setColorAt(i, col.set('#888')); }
    this.scene.add(this.fragMesh);
    // barrels
    {
      const geo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 18);
      this.barrelCap = this.barrels.length + 120;
      this.barrelMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: barrelTexture(), roughness: 0.5, metalness: 0.3 }), this.barrelCap);
      for (let i = 0; i < this.barrelCap; i++) this.barrelMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.barrelMesh.castShadow = true; this.barrelMesh.frustumCulled = false;
      for (const b of this.barrels) {
        this.barrelMesh.setMatrixAt(b.index, _m.makeTranslation(b.pos.x, b.pos.y, b.pos.z));
        b.col = addCollider(new OBB(b.pos, new THREE.Quaternion(), new THREE.Vector3(0.3, 0.45, 0.3), { owner: b, surface: 'metal' }));
      }
      this.scene.add(this.barrelMesh);
    }
    for (const t of this.targets) {
      const c = t.obj.position.clone(); c.y += t.centerY;
      t.col = addCollider(new OBB(c, t.obj.quaternion, t.half, { owner: t, surface: 'metal', grip: 1.0 }));
    }
  }

  setBlockMatrix(b, pos, quat) {
    _s.copy(b.half).multiplyScalar(2);
    _m.compose(pos, quat, _s);
    this.meshes[b.mat].setMatrixAt(b.index, _m);
  }

  // ---------- explosions ----------
  explode(pos, radius, power, kind = 'rocket') {
    if (this.onExplode) this.onExplode(pos, radius, power, kind);
    const list = queryBox(pos.x - radius - 2, pos.z - radius - 2, pos.x + radius + 2, pos.z + radius + 2).slice();
    const touched = new Set();
    let n = 0;
    for (const c of list) {
      const o = c.owner;
      if (!o) continue;
      if (o.type === 'block' && o.state === 'static') {
        const d = Math.max(0, o.pos.distanceTo(pos) - Math.min(o.half.x, o.half.y, o.half.z));
        if (d >= radius) continue;
        const f = 1 - d / radius;
        touched.add(o.struct);
        if (f > 0.5 && Math.random() < 0.85) this.shatter(o, pos, power * f);
        else this.detach(o, pos, power * f);
        n++;
      } else if (o.type === 'barrel' && o.state === 'static') {
        if (o.pos.distanceTo(pos) < radius + 0.5 && !this.pending.includes(o)) { o.fuse = 0.08 + Math.random() * 0.18; this.pending.push(o); }
      } else if (o.type === 'target' && o.state === 'static') {
        const d = o.col.c.distanceTo(pos) - Math.min(o.half.x, o.half.z);
        if (d < radius) this.launchTarget(o, pos, power * (1 - Math.max(0, d) / radius));
      }
    }
    // dynamic bodies
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const d = b.pos.distanceTo(pos);
      if (d < radius + b.radius) this.blast(b, pos, power * (1 - Math.max(0, d - b.radius * 0.5) / radius));
    }
    for (const s of touched) this.collapse(s);
    this.stats.destroyed += n;
    return n;
  }

  blast(b, center, strength) {
    if (strength <= 0) return;
    b.wake();
    _n.subVectors(b.pos, center);
    const dist = _n.length() || 1;
    _n.divideScalar(dist); _n.y += 0.45; _n.normalize();
    const J = Math.min(36 * b.mass, strength * 9000);
    _t.copy(_n).multiplyScalar(J);
    // off-centre application for spin
    _p.copy(b.pos).add(_u.set((Math.random() - 0.5) * b.half.x, (Math.random() - 0.5) * b.half.y, (Math.random() - 0.5) * b.half.z));
    b.applyImpulse(_t, _p);
  }

  makeBlockBody(b) {
    b.state = 'dynamic';
    b.col.alive = false;
    const body = new Body(b.pos, b.quat, b.half, b.mass, { mesh: this.meshes[b.mat], block: b });
    body.kind = 'block';
    b.body = body;
    this.bodies.push(body);
    return body;
  }
  detach(b, center, strength) {
    const body = this.makeBlockBody(b);
    this.blast(body, center, strength);
  }
  shatter(b, center, strength) {
    b.state = 'gone';
    b.col.alive = false;
    _m.makeScale(0, 0, 0);
    this.meshes[b.mat].setMatrixAt(b.index, _m);
    this.meshes[b.mat].instanceMatrix.needsUpdate = true;
    const col = new THREE.Color(MATERIALS[b.mat].color);
    const h = b.half;
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(b.quat), ay = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quat), az = new THREE.Vector3(0, 0, 1).applyQuaternion(b.quat);
    // split in half along the two longest axes -> 4 chunks
    const dims = [h.x, h.y, h.z];
    const keep = dims.indexOf(Math.min(...dims));
    for (let i = 0; i < 8; i++) {
      const s = SIGNS[i];
      if (s[keep] > 0) continue;
      const f = [0.42 + Math.random() * 0.12, 0.42 + Math.random() * 0.12, 0.42 + Math.random() * 0.12];
      f[keep] = 0.85;
      const hh = new THREE.Vector3(h.x * f[0], h.y * f[1], h.z * f[2]);
      const k = [0.5, 0.5, 0.5]; k[keep] = 0;
      const p = b.pos.clone().addScaledVector(ax, s[0] * h.x * k[0]).addScaledVector(ay, s[1] * h.y * k[1]).addScaledVector(az, s[2] * h.z * k[2]);
      const body = this.spawnFragment(p, b.quat, hh, b.mass / 4 * 0.8, col);
      if (body) this.blast(body, center, strength * 1.2);
    }
  }
  spawnFragment(p, q, half, mass, color) {
    let idx = this.fragFree.pop();
    if (idx === undefined) {
      // recycle the oldest fragment
      const old = this.fragBodies.shift();
      if (!old) return null;
      old.alive = false;
      idx = old.render.index;
    }
    const body = new Body(p, q, half, Math.max(4, mass), { mesh: this.fragMesh, index: idx, frag: true });
    body.kind = 'frag';
    _u.copy(color);
    this.fragMesh.setColorAt(idx, new THREE.Color(color.r, color.g, color.b).multiplyScalar(0.8 + Math.random() * 0.3));
    this.fragMesh.instanceColor.needsUpdate = true;
    this.fragBodies.push(body);
    this.bodies.push(body);
    return body;
  }
  launchTarget(t, center, strength) {
    t.state = 'dynamic';
    t.col.alive = false;
    const p = t.col.c.clone();
    const body = new Body(p, t.obj.quaternion, t.half, t.mass, { obj: t.obj, offsetY: -t.centerY });
    body.kind = 'target';
    t.body = body;
    this.bodies.push(body);
    this.blast(body, center, strength * 1.6);
    _w.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
    body.angVel.add(_w);
  }

  // blocks no longer connected to the ground fall
  collapse(s) {
    const seen = new Set();
    const queue = [];
    for (const b of s.blocks) if (b.state === 'static' && b.grounded) { seen.add(b); queue.push(b); }
    while (queue.length) {
      const b = queue.pop();
      for (const nb of b.neighbors) if (nb.state === 'static' && !seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
    for (const b of s.blocks) if (b.state === 'static' && !seen.has(b)) {
      const body = this.makeBlockBody(b);
      body.angVel.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
    }
  }

  // ---------- simulation ----------
  step(dt) {
    // barrel fuses
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const b = this.pending[i];
      b.fuse -= dt;
      if (b.fuse <= 0) {
        this.pending.splice(i, 1);
        if (b.state !== 'static') continue;
        b.state = 'gone'; b.col.alive = false;
        this.barrelMesh.setMatrixAt(b.index, _m.makeScale(0, 0, 0));
        this.barrelMesh.instanceMatrix.needsUpdate = true;
        this.explode(b.pos.clone(), 8, 1.35, 'barrel');
      }
    }
    // spatial hash of all live bodies
    const hash = this.hash; hash.clear();
    const bodies = this.bodies;
    let w = 0;
    for (let i = 0; i < bodies.length; i++) { const b = bodies[i]; if (b.alive) bodies[w++] = b; }
    bodies.length = w;
    for (const b of bodies) {
      const k = (Math.floor(b.pos.x / 4) + 2048) * 4096 + (Math.floor(b.pos.z / 4) + 2048);
      let arr = hash.get(k); if (!arr) { arr = []; hash.set(k, arr); } arr.push(b);
    }
    // keep the number of simultaneously simulated pieces bounded
    let awake = 0;
    for (const b of bodies) if (!b.sleeping) awake++;
    if (awake > 380) {
      const cand = bodies.filter(b => !b.sleeping && b.contacts > 0).sort((a, c) => a.vel.lengthSq() - c.vel.lengthSq());
      for (let i = 0; i < Math.min(cand.length, awake - 380); i++) { cand[i].sleeping = true; cand[i].vel.set(0, 0, 0); cand[i].angVel.set(0, 0, 0); }
    }
    this.awake = awake;
    for (const b of bodies) {
      if (b.sleeping) continue;
      b.age += dt;
      // integrate
      b.vel.y -= G * this.gravityScale * dt;
      b.vel.multiplyScalar(Math.exp(-0.04 * dt));
      b.angVel.multiplyScalar(Math.exp(-0.5 * dt));
      b.pos.addScaledVector(b.vel, dt);
      const q = b.quat, wx = b.angVel.x, wy = b.angVel.y, wz = b.angVel.z, h = 0.5 * dt;
      q.set(q.x + h * (wx * q.w + wy * q.z - wz * q.y), q.y + h * (wy * q.w + wz * q.x - wx * q.z), q.z + h * (wz * q.w + wx * q.y - wy * q.x), q.w + h * (-wx * q.x - wy * q.y - wz * q.z)).normalize();
      b.updateAxes();
      // contacts with static world
      let contacts = 0;
      for (let i = 0; i < 8; i++) {
        b.corner(i, _p);
        const d = pointContact(_p, _hit);
        if (d > 0) { contacts++; this.resolve(b, null, _p, _hit.normal, Math.min(d, 0.5), 0.6); }
      }
      // centre safety (fell through)
      const gh = heightAt(b.pos.x, b.pos.z);
      if (b.pos.y < gh - 0.5) { b.pos.y = gh + b.half.y; b.vel.y = Math.abs(b.vel.y) * 0.2; }
      // contacts with other bodies
      const cx = Math.floor(b.pos.x / 4), cz = Math.floor(b.pos.z / 4);
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const arr = hash.get((ix + 2048) * 4096 + (iz + 2048));
        if (!arr) continue;
        for (const o of arr) {
          if (o === b) continue;
          if (o.pos.distanceToSquared(b.pos) > (o.radius + b.radius) ** 2) continue;
          for (let i = 0; i < 8; i++) {
            b.corner(i, _p);
            const d = o.penetrate(_p, _n);
            if (d > 0) { contacts++; this.resolve(b, o, _p, _n, Math.min(d, 0.4), 0.5); }
          }
          if (!o.sleeping) continue; // awake pairs are handled from both sides
          for (let i = 0; i < 8; i++) {
            o.corner(i, _p);
            const d = b.penetrate(_p, _n);
            if (d > 0) { contacts++; _n.negate(); this.resolve(b, o, _p, _n, Math.min(d, 0.4), 0.5); }
          }
        }
      }
      // contact damping (rolling resistance) helps piles settle
      if (contacts > 0) {
        b.angVel.multiplyScalar(Math.exp(-2.5 * dt));
        const vy = b.vel.y; b.vel.multiplyScalar(Math.exp(-1.2 * dt)); b.vel.y = vy;
      }
      // sleep
      const lv = b.vel.lengthSq(), av = b.angVel.lengthSq();
      b.contacts = contacts;
      if (lv < 0.2 && av < 0.35 && contacts > 0) { b.sleepT += dt; if (b.sleepT > 0.35) { b.sleeping = true; b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0); } }
      else b.sleepT = Math.max(0, b.sleepT - dt * 0.5);
      if (b.age > 12 && contacts > 0 && lv < 1.5) { b.sleeping = true; b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0); }
    }
  }

  // impulse contact between body a and (optional) body o; n points from o/world toward a
  resolve(a, o, pIn, nIn, depth, mu) {
    const p = _rp.copy(pIn), n = _rn.copy(nIn);
    const corr = Math.max(0, depth - 0.004) * 0.45;
    if (o && !o.sleeping) {
      const wa = a.invMass / (a.invMass + o.invMass);
      a.pos.addScaledVector(n, corr * wa); o.pos.addScaledVector(n, -corr * (1 - wa));
    } else a.pos.addScaledVector(n, corr);
    _rA.subVectors(p, a.pos);
    const vRel = _vA.crossVectors(a.angVel, _rA).add(a.vel);
    if (o) {
      _rB.subVectors(p, o.pos);
      _vB.crossVectors(o.angVel, _rB).add(o.vel);
      vRel.sub(_vB);
    }
    const vn = vRel.dot(n);
    if (vn >= 0) return;
    if (vn < -4 && this.onImpact && Math.random() < 0.08) this.onImpact(p.clone(), -vn, a);
    const k = (body, r) => { _rk.crossVectors(r, n); body.invIWorld(_rk); return body.invMass + _rk.cross(r).dot(n); };
    let K = k(a, _rA);
    if (o) { K += k(o, _rB); if (-vn > 0.8) o.wake(); }
    const e = vn < -3 ? 0.2 : 0;
    const jn = -(1 + e) * vn / K;
    const J = _rJ.copy(n).multiplyScalar(jn);
    a.applyImpulse(J, p);
    if (o) { J.negate(); o.applyImpulse(J, p); }
    // friction
    const vt = _rvt.copy(vRel).addScaledVector(n, -vn);
    const vtl = vt.length();
    if (vtl > 1e-4) {
      vt.divideScalar(vtl);
      const jt = Math.min(mu * jn, vtl / K);
      J.copy(vt).multiplyScalar(-jt);
      a.applyImpulse(J, p);
      if (o) { J.negate(); o.applyImpulse(J, p); }
    }
  }

  // two-way contact between the player's car and loose bodies
  pushFromCar(v) {
    const carHalf = _s.set(1.0, 0.58, 2.25);
    const q = v.quat; _qi.copy(q).invert();
    const cx = Math.floor(v.pos.x / 4), cz = Math.floor(v.pos.z / 4);
    const cc = new THREE.Vector3(0, 0.08, 0).applyQuaternion(q).add(v.pos);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const arr = this.hash.get((ix + 2048) * 4096 + (iz + 2048));
      if (!arr) continue;
      for (const b of arr) {
        if (b.pos.distanceToSquared(cc) > (b.radius + 2.6) ** 2) continue;
        for (let i = 0; i < 9; i++) {
          if (i < 8) b.corner(i, _p); else _p.copy(b.pos);
          _t.subVectors(_p, cc).applyQuaternion(_qi);
          const ex = carHalf.x - Math.abs(_t.x), ey = carHalf.y - Math.abs(_t.y), ez = carHalf.z - Math.abs(_t.z);
          if (ex <= 0 || ey <= 0 || ez <= 0) continue;
          let depth;
          if (ex <= ey && ex <= ez) { _n.set(Math.sign(_t.x) || 1, 0, 0); depth = ex; }
          else if (ez <= ey) { _n.set(0, 0, Math.sign(_t.z) || 1); depth = ez; }
          else { _n.set(0, Math.sign(_t.y) || 1, 0); depth = ey; }
          _n.applyQuaternion(q); // points from car to body
          b.wake();
          b.pos.addScaledVector(_n, Math.min(depth, 0.3));
          _r.subVectors(_p, v.pos);
          const vc = _u.crossVectors(v.angVel, _r).add(v.vel);
          _w.subVectors(_p, b.pos);
          const vb = _t.crossVectors(b.angVel, _w).add(b.vel);
          const vn = vb.sub(vc).dot(_n);
          if (vn < 0) {
            const jn = -1.25 * vn / (b.invMass + 1 / v.mass);
            const J = _w.copy(_n).multiplyScalar(jn);
            b.applyImpulse(J, _p);
            J.multiplyScalar(-1);
            v.applyImpulse(J, _p);
            if (jn > 3000 && this.onImpact) this.onImpact(_p.clone(), -vn, b);
          }
          break;
        }
      }
    }
  }

  // ---------- hack tools ----------
  // add a block after the world is built (spawned objects)
  addSpawnedBlock(s, lx, ly, lz, sx, sy, sz, mat) {
    const m = this.meshes[mat];
    const idx = m.userData.free.pop();
    if (idx === undefined) return null;
    this.counts[mat]--; // block() increments the count; spare slots are tracked separately
    const b = this.block(s, lx, ly, lz, sx, sy, sz, mat);
    b.index = idx; b.spawned = true;
    const col = new THREE.Color(MATERIALS[mat].color).multiplyScalar(0.86 + Math.random() * 0.24);
    m.setColorAt(idx, col); if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.setBlockMatrix(b, b.pos, b.quat); m.instanceMatrix.needsUpdate = true;
    b.col = addCollider(new OBB(b.pos, b.quat, b.half, { owner: b, grip: 0.9, surface: 'concrete' }));
    return b;
  }
  linkStructure(s) {
    const bl = s.blocks;
    for (let i = 0; i < bl.length; i++) for (let j = i + 1; j < bl.length; j++) {
      const a = bl[i], b = bl[j];
      let touch = true, gap = 0;
      for (let k = 0; k < 3; k++) { const o = Math.min(a.lmax[k], b.lmax[k]) - Math.max(a.lmin[k], b.lmin[k]); if (o < -0.07) { touch = false; break; } if (o < 0.03) gap++; }
      if (touch && gap <= 1) { a.neighbors.push(b); b.neighbors.push(a); }
    }
  }
  spawn(kind, pos, yaw) {
    const s = this.structure(pos.x, pos.z, yaw);
    s.spawned = true;
    let n = 0;
    const add = (...a) => { if (this.addSpawnedBlock(s, ...a)) n++; };
    if (kind === 'crates') { for (let l = 0; l < 5; l++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) add((i - 1) * 1.25, l * 1.2, (j - 1) * 1.25, 1.2, 1.2, 1.2, 'crate'); }
    else if (kind === 'wall') { for (let r = 0; r < 8; r++) { let a = -6 + (r % 2) * 0.4; while (a < 6 - 0.01) { const b = Math.min(6, a + 0.8); add((a + b) / 2, r * 0.4, 0, b - a, 0.4, 0.45, 'brick'); a = b; } } }
    else if (kind === 'tower') { for (let l = 0; l < 14; l++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) add((i - 0.5) * 1.05, l * 1.0, (j - 0.5) * 1.05, 1.0, 1.0, 1.0, 'concrete'); }
    else if (kind === 'barrels') {
      for (let i = 0; i < 9; i++) {
        if (this.barrels.length >= this.barrelCap) break;
        const x = pos.x + (i % 3 - 1) * 0.75, z = pos.z + (Math.floor(i / 3) - 1) * 0.75;
        const b = this.barrel(x, z); b.spawned = true;
        this.barrelMesh.setMatrixAt(b.index, _m.makeTranslation(b.pos.x, b.pos.y, b.pos.z));
        b.col = addCollider(new OBB(b.pos, new THREE.Quaternion(), new THREE.Vector3(0.3, 0.45, 0.3), { owner: b, surface: 'metal' }));
        n++;
      }
      this.barrelMesh.instanceMatrix.needsUpdate = true;
    }
    this.linkStructure(s);
    return n;
  }
  spawnTarget(obj, half, mass, centerY) {
    const t = this.target(obj, half, mass, centerY);
    t.spawned = true;
    const c = obj.position.clone(); c.y += centerY;
    t.col = addCollider(new OBB(c, obj.quaternion, half, { owner: t, surface: 'metal', grip: 1.0 }));
    return t;
  }
  detonateAll() {
    let n = 0;
    for (const b of this.barrels) if (b.state === 'static' && !this.pending.includes(b)) { b.fuse = 0.1 + Math.random() * 2.5; this.pending.push(b); n++; }
    return n;
  }
  collapseAll() {
    let n = 0;
    for (const s of this.structures) {
      for (const b of s.blocks) if (b.state === 'static' && b.lmin[1] < 0.9) { const body = this.makeBlockBody(b); body.vel.set((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3); n++; }
      this.collapse(s);
    }
    return n;
  }
  // wrecking-ball hack: ramming at speed knocks blocks loose
  smashFromCar(v) {
    const sp = v.vel.length();
    if (sp < 10) return 0;
    const q = v.quat; _qi.copy(q).invert();
    const list = queryBox(v.pos.x - 5, v.pos.z - 5, v.pos.x + 5, v.pos.z + 5).slice();
    const touched = new Set();
    let n = 0;
    const sc = v.hack.scale || 1;
    for (const c of list) {
      const o = c.owner;
      if (!o || o.state !== 'static') continue;
      _t.subVectors(c.c, v.pos).applyQuaternion(_qi);
      const r = o.half ? Math.max(o.half.x, o.half.y, o.half.z) : 0.5;
      if (Math.abs(_t.x) > 1.2 * sc + r || Math.abs(_t.y) > 0.9 * sc + r || Math.abs(_t.z) > 2.6 * sc + r) continue;
      if (o.type === 'block') {
        const body = this.makeBlockBody(o);
        body.vel.copy(v.vel).multiplyScalar(0.8).add(_u.set((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4));
        body.angVel.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
        touched.add(o.struct); n++;
      } else if (o.type === 'target') { this.launchTarget(o, v.pos.clone().addScaledVector(v.vel, -0.1), Math.min(2, sp / 25)); n++; }
      else if (o.type === 'barrel' && !this.pending.includes(o)) { o.fuse = 0.02; this.pending.push(o); }
    }
    for (const s of touched) this.collapse(s);
    return n;
  }

  // ---------- rendering ----------
  sync() {
    const dirty = new Set();
    for (const b of this.bodies) {
      if (!b.alive) continue;
      if (b.sleeping && b.synced) continue;
      b.synced = b.sleeping;
      const r = b.render;
      if (r.mesh) {
        _s.copy(b.half).multiplyScalar(2);
        _m.compose(b.pos, b.quat, _s);
        r.mesh.setMatrixAt(r.block ? r.block.index : r.index, _m);
        dirty.add(r.mesh);
      } else if (r.obj) {
        r.obj.quaternion.copy(b.quat);
        _p.set(0, r.offsetY || 0, 0).applyQuaternion(b.quat);
        r.obj.position.copy(b.pos).add(_p);
      }
    }
    // recycled fragments that died
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
  }

  // sphere hit test for rockets against loose bodies
  bodyHit(p, r = 0.3) {
    const cx = Math.floor(p.x / 4), cz = Math.floor(p.z / 4);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const arr = this.hash.get((ix + 2048) * 4096 + (iz + 2048));
      if (!arr) continue;
      for (const b of arr) if (b.penetrate(p, _n) > 0 || b.pos.distanceToSquared(p) < (Math.min(b.half.x, b.half.y, b.half.z) + r) ** 2) return b;
    }
    return null;
  }

  liveCount() { let a = 0, s = 0; for (const b of this.bodies) { if (!b.alive) continue; if (b.sleeping) s++; else a++; } return { awake: a, asleep: s }; }

  rebuild() {
    // remove everything spawned from the hack menu and give the slots back
    for (const b of this.blocks) if (b.spawned) {
      if (b.body) b.body.alive = false;
      b.col.alive = false;
      this.meshes[b.mat].setMatrixAt(b.index, _m.makeScale(0, 0, 0));
      this.meshes[b.mat].userData.free.push(b.index);
    }
    this.blocks = this.blocks.filter(b => !b.spawned);
    this.structures = this.structures.filter(s => !s.spawned);
    for (const b of this.barrels) if (b.spawned) { b.col.alive = false; this.barrelMesh.setMatrixAt(b.index, _m.makeScale(0, 0, 0)); }
    this.barrels = this.barrels.filter(b => !b.spawned);
    for (const t of this.targets) if (t.spawned) { if (t.body) t.body.alive = false; t.col.alive = false; t.obj.parent && t.obj.parent.remove(t.obj); }
    this.targets = this.targets.filter(t => !t.spawned);
    for (const b of this.blocks) {
      if (b.body) { b.body.alive = false; b.body = null; }
      b.state = 'static'; b.col.alive = true;
      b.pos.copy(b.home.pos); b.quat.copy(b.home.quat);
      this.setBlockMatrix(b, b.pos, b.quat);
    }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
    for (const f of this.fragBodies) f.alive = false;
    this.fragBodies.length = 0;
    this.fragFree.length = 0;
    for (let i = this.fragCap - 1; i >= 0; i--) { this.fragFree.push(i); this.fragMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); }
    this.fragMesh.instanceMatrix.needsUpdate = true;
    for (const b of this.barrels) {
      b.state = 'static'; b.col.alive = true;
      this.barrelMesh.setMatrixAt(b.index, _m.makeTranslation(b.pos.x, b.pos.y, b.pos.z));
    }
    if (this.barrelMesh) this.barrelMesh.instanceMatrix.needsUpdate = true;
    this.pending.length = 0;
    for (const t of this.targets) {
      if (t.body) { t.body.alive = false; t.body = null; }
      t.state = 'static'; t.col.alive = true;
      t.obj.position.copy(t.home.pos); t.obj.quaternion.copy(t.home.quat);
    }
    for (const p of this.props) {
      p.alive = true; p.pos.copy(p.home.pos); p.quat.copy(p.home.quat); p.vel.set(0, 0, 0); p.angVel.set(0, 0, 0); p.sleeping = true; p.synced = false; p.updateAxes();
    }
    this.bodies = this.bodies.filter(b => b.alive && b.kind === 'prop');
    this.stats.destroyed = 0;
    this.sync();
  }
}
