// Ragdolls (2.4): target dummies in the Weapons Range. Verlet particles + distance constraints; every body
// part (head, torso, upper arm, forearm, thigh, shin) has its own health and is joined to its parent by a
// joint that breaks when that part's health runs out, so limbs come off where they were hit.
// Blood (or oil, straw, splinters) sprays from both sides of a broken joint and pools on the ground.
// The dolls are light and never push back on the car, so driving is unchanged.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { queryBox } from './colliders.js';
import { DOLL_TYPES } from './dolltypes.js';

const SUB = 1 / 120, ITER = 6;
let G = 9.81;
export const setDollGravity = (k) => { G = 9.81 * k; };
const UP = new THREE.Vector3(0, 1, 0);
// standing pose for size 1 (feet at y = 0); x = the doll's left, z = the way it faces
const TORSO = [[0, 1.45, 0], [0, 0.97, 0], [0.2, 1.4, 0], [-0.2, 1.4, 0], [0.1, 0.95, 0], [-0.1, 0.95, 0]];   // neck, pelvis, shL, shR, hipL, hipR
// segments: attach = torso particle or parent segment's far end; a / b = its two ends; r = thickness
const SEGS = [
  { id: 'head', attach: 0, a: [0, 1.45, 0], b: [0, 1.76, 0], r: 0.06, mat: 'head', hp: 0.35 },
  { id: 'armL', attach: 2, a: [0.2, 1.4, 0], b: [0.25, 1.12, 0.02], r: 0.055, mat: 'arm', hp: 0.45 },
  { id: 'foreL', parent: 'armL', a: [0.25, 1.12, 0.02], b: [0.28, 0.84, 0.07], r: 0.045, mat: 'hand', hp: 0.3 },
  { id: 'armR', attach: 3, a: [-0.2, 1.4, 0], b: [-0.25, 1.12, 0.02], r: 0.055, mat: 'arm', hp: 0.45 },
  { id: 'foreR', parent: 'armR', a: [-0.25, 1.12, 0.02], b: [-0.28, 0.84, 0.07], r: 0.045, mat: 'hand', hp: 0.3 },
  { id: 'thighL', attach: 4, a: [0.1, 0.95, 0], b: [0.11, 0.52, 0.02], r: 0.075, mat: 'leg', hp: 0.55 },
  { id: 'shinL', parent: 'thighL', a: [0.11, 0.52, 0.02], b: [0.11, 0.08, 0], r: 0.058, mat: 'shin', hp: 0.4 },
  { id: 'thighR', attach: 5, a: [-0.1, 0.95, 0], b: [-0.11, 0.52, 0.02], r: 0.075, mat: 'leg', hp: 0.55 },
  { id: 'shinR', parent: 'thighR', a: [-0.11, 0.52, 0.02], b: [-0.11, 0.08, 0], r: 0.058, mat: 'shin', hp: 0.4 },
];
const GORE = {
  blood: { col: [0.42, 0.02, 0.02], stump: '#5a0306', pool: '#4a0204', drip: true, grav: 9.8, size: 0.07 },
  oil: { col: [0.04, 0.04, 0.05], stump: '#121316', pool: '#0b0b0d', drip: true, grav: 9.8, size: 0.07 },
  straw: { col: [0.85, 0.68, 0.28], stump: '#c9a24a', pool: null, drip: false, grav: 3, size: 0.09 },
  splinter: { col: [0.6, 0.4, 0.2], stump: '#b98a52', pool: null, drip: false, grav: 9.8, size: 0.06 },
  stuffing: { col: [0.95, 0.95, 0.92], stump: '#efeee8', pool: null, drip: false, grav: 2, size: 0.1 },
};
// spots in the Weapons Range (checked against buildings when the range is filled)
const SPOTS = [[590, -600], [615, -606], [665, -606], [690, -600], [715, -610], [740, -618], [565, -612], [545, -640], [640, -628, 'boss'],
  [520, -690], [620, -700], [680, -720], [760, -700], [600, -760], [700, -770], [650, -660]];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _inv = new THREE.Quaternion();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

// distance from point p to segment a-b
function segDist(p, a, b) {
  _d.subVectors(b, a); const l2 = _d.lengthSq();
  const t = l2 > 0 ? Math.max(0, Math.min(1, _c.subVectors(p, a).dot(_d) / l2)) : 0;
  return _c.copy(a).addScaledVector(_d, t).distanceTo(p);
}

class Doll {
  constructor(mgr, type, x, z, yaw, home) {
    this.mgr = mgr; this.type = type; this.home = home; this.yaw = yaw;
    this.base = new THREE.Vector3(x, heightAt(x, z), z);
    const s = this.s = type.size;
    this.group = new THREE.Group(); mgr.scene.add(this.group);
    const mats = type.mats();
    this.mats = mats;
    // particles: 6 torso + 2 per segment
    this.n = 6 + SEGS.length * 2;
    this.p = []; this.o = []; this.w = [];
    for (let i = 0; i < this.n; i++) { this.p.push(new THREE.Vector3()); this.o.push(new THREE.Vector3()); this.w.push(i < 6 ? 0.5 : 1); }
    this.cons = [];   // [i, j, len, kind] kind 0 = rigid, 1 = joint (breakable), 2 = min distance
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) this.cons.push([i, j, 0, 0]);
    this.segs = SEGS.map((d, k) => ({ ...d, k, ia: 6 + k * 2, ib: 7 + k * 2, on: true, hp: 0, max: type.hp * d.hp }));
    for (const g of this.segs) {
      g.parentSeg = g.parent ? this.segs.find(x => x.id === g.parent) : null;
      g.attachI = g.parentSeg ? g.parentSeg.ib : g.attach;
      this.cons.push([g.ia, g.ib, 0, 0]);
      g.joint = this.cons.length; this.cons.push([g.ia, g.attachI, 0, 1]);
    }
    // keep knees and elbows from folding through themselves, and the head out of the chest
    const seg = (id) => this.segs.find(x => x.id === id);
    for (const [c, p, min] of [['foreL', 'armL', 0.3], ['foreR', 'armR', 0.3], ['shinL', 'thighL', 0.45], ['shinR', 'thighR', 0.45]]) this.cons.push([seg(c).ib, seg(p).ia, min * s, 2, seg(c)]);
    this.cons.push([seg('head').ib, 1, 0.7 * s, 2, seg('head')]);
    // meshes
    const torso = new THREE.Group();
    const tm = new THREE.Mesh(mgr.geo(`t${s}`, () => new THREE.CapsuleGeometry(0.15 * s, 0.48 * s, 4, 10)), mats.torso);
    tm.scale.set(1.2, 1, 0.8); tm.castShadow = true; torso.add(tm);
    if (type.decorateTorso) type.decorateTorso(torso, s);
    this.torso = torso; this.group.add(torso);
    for (const g of this.segs) {
      if (g.id === 'head') {
        const h = new THREE.Group();
        const hm = new THREE.Mesh(mgr.geo(`h${s}`, () => new THREE.SphereGeometry(0.13 * s, 16, 12)), mats.head); hm.castShadow = true; h.add(hm);
        if (type.decorateHead) type.decorateHead(h, s);
        g.mesh = h; this.head = g;
        g.neck = new THREE.Mesh(mgr.geo(`n${s}`, () => new THREE.CylinderGeometry(0.05 * s, 0.055 * s, 0.14 * s, 8)), mats.hand);
        this.group.add(g.neck);
      } else {
        g.len = 0;
        g.mesh = new THREE.Mesh(mgr.geo(`${g.id}${s}`, () => {
          const a = new THREE.Vector3(...g.a), b = new THREE.Vector3(...g.b);
          return new THREE.CapsuleGeometry(g.r * s, a.distanceTo(b) * s, 3, 8);
        }), mats[g.mat]);
        g.mesh.castShadow = true;
      }
      this.group.add(g.mesh);
    }
    // stand: a post the dummy hangs on until it gets hit
    if (home) {
      const st = new THREE.Group();
      const post = new THREE.Mesh(mgr.geo('post', () => new THREE.CylinderGeometry(0.05, 0.06, 1.5, 8)), mgr.standMat);
      post.position.set(0, 0.75, -0.18); post.scale.y = s; post.position.y *= s;
      const foot = new THREE.Mesh(mgr.geo('foot', () => new THREE.CylinderGeometry(0.45, 0.5, 0.08, 16)), mgr.standMat);
      foot.position.set(0, 0.04, -0.18); foot.scale.set(s, 1, s);
      st.add(post, foot); st.traverse(o => { o.castShadow = true; });
      st.position.copy(this.base); st.rotation.y = yaw;
      mgr.scene.add(st); this.stand = st;
    }
    // HP bar
    this.cv = document.createElement('canvas'); this.cv.width = 256; this.cv.height = 64;
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.bar.scale.set(1.5 * Math.max(1, s * 0.8), 0.375 * Math.max(1, s * 0.8), 1); this.bar.renderOrder = 5;
    mgr.scene.add(this.bar);
    this.stumps = [];
    this.reset();
  }
  // back on the stand, good as new
  reset() {
    const s = this.s;
    _q.setFromAxisAngle(UP, this.yaw);
    const put = (i, v) => { this.p[i].set(v[0] * s, v[1] * s, v[2] * s).applyQuaternion(_q).add(this.base); this.o[i].copy(this.p[i]); };
    TORSO.forEach((v, i) => put(i, v));
    for (const g of this.segs) { put(g.ia, g.a); put(g.ib, g.b); g.on = true; g.hp = g.max; g.mesh.visible = true; this.cons[g.joint][3] = 1; }
    this.head.neck.visible = true;
    for (const c of this.cons) if (c[3] !== 2) c[2] = this.p[c[0]].distanceTo(this.p[c[1]]);
    for (const st of this.stumps) { st.mesh.parent && st.mesh.parent.remove(st.mesh); }
    this.stumps.length = 0;
    this.hp = this.type.hp; this.dead = false; this.deadT = 0; this.limbs = 0; this.koPay = 0; this.ramT = 0; this.downT = 0; this.torsoHp = this.type.hp * 1.3; this.burst = false;
    this.state = 'stand'; this.still = 0; this.dirty = true; this.shownHp = -1;
    this.bar.visible = true;
    this.draw(); this.drawBar();
  }
  get pelvis() { return this.p[1]; }
  joined(g) { return g.on && (!g.parentSeg || this.joined(g.parentSeg)); }
  wake() { if (this.state !== 'rag') { this.state = 'rag'; } this.still = 0; }
  addVel(i, v) { this.o[i].addScaledVector(v, -SUB); }
  // nearest body part to a point (and its distance)
  nearest(pt) {
    let best = null, bd = Infinity;
    const td = segDist(pt, this.p[0], this.p[1]) - 0.17 * this.s;
    if (td < bd) { bd = td; best = null; }
    for (const g of this.segs) {
      if (!this.joined(g)) continue;
      const d = (g.id === 'head' ? this.p[g.ia].distanceTo(pt) - 0.2 * this.s : segDist(pt, this.p[g.ia], this.p[g.ib]) - g.r * this.s);
      if (d < bd) { bd = d; best = g; }
    }
    return { seg: best, d: bd };
  }
  // damage one part (null = torso)
  hurt(g, dmg) {
    if (dmg <= 0) return;
    this.wake();
    if (g) {
      g.hp -= dmg;
      this.hp -= dmg * (g.id === 'head' ? 1.4 : 0.45);
      if (g.hp <= 0 && g.on) {
        if (g.id === 'head') this.hp = 0;   // headshot
        this.sever(g);
      }
    } else {
      this.hp -= dmg; this.torsoHp -= dmg;
      // torso blown apart (a direct big hit on the body): everything comes off
      if (this.torsoHp <= 0 && !this.burst) { this.burst = true; for (const s of this.segs) if (s.on && !s.parentSeg) this.sever(s); }
    }
    if (this.hp <= 0 && !this.dead) this.ko();
    this.drawBar();
  }
  sever(g) {
    g.on = false;
    const c = this.cons[g.joint]; c[3] = 3;   // joint broken
    this.limbs++;
    const gore = this.mgr.goreOf(this.type);
    const at = this.p[g.ia], from = this.p[g.attachI];
    _a.subVectors(at, from).normalize();
    this.mgr.spray(at, _a, 26, gore);
    this.mgr.spray(from, _b.copy(_a).negate(), 18, gore);
    this.addStump(g.ia, g.ib, g.r * this.s * 1.05, gore);
    this.addStump(g.attachI, g.parentSeg ? g.parentSeg.ia : 1, g.r * this.s * 1.05, gore);
    if (gore.drip) { this.mgr.bleed(this, g.ia, gore); this.mgr.bleed(this, g.attachI, gore); }
    if (gore.pool) this.mgr.pool(at, 0.35 + Math.random() * 0.3, gore);
    if (g.id === 'head') this.head.neck.visible = false;
    // a flying limb gets a kick away from the body
    _c.copy(_a).multiplyScalar(2 + Math.random() * 3).add(_d.set(0, 2.5, 0));
    this.addVel(g.ia, _c); this.addVel(g.ib, _c);
    this.mgr.onLimb(this, g);
  }
  addStump(i, toward, r, gore) {
    const m = new THREE.Mesh(this.mgr.geo('stump', () => new THREE.SphereGeometry(1, 10, 8)), this.mgr.stumpMat(gore));
    m.scale.setScalar(r);
    this.group.add(m);
    this.stumps.push({ mesh: m, i, toward });
  }
  ko() {
    this.dead = true; this.deadT = 0;
    const gore = this.mgr.goreOf(this.type);
    if (gore.pool) this.mgr.pool(this.pelvis, 0.7 + Math.random() * 0.4, gore, 2.5);
    this.koPay = 0.4;   // pay a moment later so every limb from the same blast counts
  }
  step(dt) {
    const p = this.p, o = this.o, g2 = G * dt * dt;
    let moved = 0;
    for (let i = 0; i < this.n; i++) {
      const vx = (p[i].x - o[i].x) * 0.995, vy = (p[i].y - o[i].y) * 0.995, vz = (p[i].z - o[i].z) * 0.995;
      o[i].copy(p[i]);
      p[i].x += vx; p[i].y += vy - g2; p[i].z += vz;
      moved = Math.max(moved, vx * vx + vy * vy + vz * vz);
    }
    for (let it = 0; it < ITER; it++) {
      for (const c of this.cons) {
        if (c[3] === 3 || (c[4] && !c[4].on)) continue;
        const a = p[c[0]], b = p[c[1]];
        _a.subVectors(b, a);
        const d = _a.length() || 1e-6;
        if (c[3] === 2 && d >= c[2]) continue;
        const wa = this.w[c[0]], wb = this.w[c[1]], k = (d - c[2]) / d / (wa + wb);
        a.addScaledVector(_a, k * wa); b.addScaledVector(_a, -k * wb);
      }
    }
    // ground with friction
    for (let i = 0; i < this.n; i++) {
      const r = 0.06 * this.s, h = heightAt(p[i].x, p[i].z) + r;
      if (p[i].y < h) {
        p[i].y = h;
        o[i].x = p[i].x - (p[i].x - o[i].x) * 0.55; o[i].z = p[i].z - (p[i].z - o[i].z) * 0.55;
        if (o[i].y < p[i].y) o[i].y = p[i].y - (p[i].y - o[i].y) * 0.2;
      }
    }
    return moved;
  }
  draw() {
    const p = this.p, s = this.s;
    // torso frame from its particles
    _y.subVectors(p[0], p[1]).normalize();
    _x.subVectors(p[2], p[3]); _x.addScaledVector(_y, -_x.dot(_y)).normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    this.torso.quaternion.setFromRotationMatrix(_m);
    this.torso.position.addVectors(p[0], p[1]).multiplyScalar(0.5);
    const fwd = _c.copy(_z);
    for (const g of this.segs) {
      const a = p[g.ia], b = p[g.ib];
      if (g.id === 'head') {
        _y.subVectors(b, a).normalize();
        _z.copy(fwd).addScaledVector(_y, -fwd.dot(_y)); if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1); _z.normalize();
        _x.crossVectors(_y, _z);
        _m.makeBasis(_x, _y, _z);
        g.mesh.quaternion.setFromRotationMatrix(_m);
        g.mesh.position.copy(a).addScaledVector(_y, 0.17 * s);
        g.neck.position.copy(a).addScaledVector(_y, 0.03 * s); g.neck.quaternion.setFromUnitVectors(UP, _y);
      } else {
        g.mesh.position.addVectors(a, b).multiplyScalar(0.5);
        g.mesh.quaternion.setFromUnitVectors(UP, _a.subVectors(b, a).normalize());
      }
    }
    for (const st of this.stumps) { st.mesh.position.copy(p[st.i]); }
    this.bar.position.copy(p[this.head.ib]).y += 0.42 * Math.max(1, s * 0.8);
    if (!this.head.on) this.bar.position.copy(p[0]).y += 0.55 * s;
  }
  drawBar() {
    const v = Math.max(0, Math.round(this.hp));
    if (v === this.shownHp) return;
    this.shownHp = v;
    const x = this.cv.getContext('2d'), W = 256, H = 64, f = Math.max(0, this.hp / this.type.hp);
    x.clearRect(0, 0, W, H);
    x.font = '700 22px system-ui, sans-serif'; x.textAlign = 'center';
    x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,.75)'; x.fillStyle = this.type.id === 'boss' ? '#ffd23d' : '#ffffff';
    x.strokeText(this.type.name, W / 2, 22); x.fillText(this.type.name, W / 2, 22);
    x.fillStyle = 'rgba(0,0,0,.7)'; x.fillRect(16, 32, W - 32, 22);
    x.fillStyle = f > 0.5 ? '#46f07a' : f > 0.25 ? '#ffd23d' : '#ff3d3d';
    x.fillRect(19, 35, (W - 38) * f, 16);
    x.font = '700 14px system-ui, sans-serif'; x.fillStyle = '#fff'; x.fillText(v > 0 ? `${v} HP` : 'K.O.', W / 2, 49);
    this.tex.needsUpdate = true;
  }
  dispose() {
    this.mgr.scene.remove(this.group); this.mgr.scene.remove(this.bar);
    if (this.stand) this.mgr.scene.remove(this.stand);
    this.tex.dispose(); this.bar.material.dispose();
    const shared = new Set(this.mgr.geos.values()), sharedMats = new Set([this.mgr.standMat, ...this.mgr.stumpMats.values()]);
    this.group.traverse(o => {
      if (!o.isMesh) return;
      if (!shared.has(o.geometry)) o.geometry.dispose();
      for (const m of [].concat(o.material)) if (!sharedMats.has(m)) m.dispose();
    });
  }
}

export class Ragdolls {
  constructor(scene, effects, opts = {}) {
    this.scene = scene; this.fx = effects;
    this.dolls = []; this.bleeders = []; this.pools = [];
    this.blood = opts.blood !== false;
    this.onReward = null;   // (text, credits)
    this.geos = new Map();
    this.standMat = new THREE.MeshStandardMaterial({ color: '#6b5a44', roughness: 0.85 });
    this.stumpMats = new Map();
    // ground pools: one instanced mesh of flat discs
    this.poolCap = 80;
    this.poolMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }), this.poolCap);
    this.poolMesh.count = 0; this.poolMesh.frustumCulled = false;
    this.poolMesh.setColorAt(0, new THREE.Color('#ffffff'));
    scene.add(this.poolMesh);
    this.spotsDone = false;
  }
  geo(key, make) { if (!this.geos.has(key)) this.geos.set(key, make()); return this.geos.get(key); }
  stumpMat(g) { if (!this.stumpMats.has(g.stump)) this.stumpMats.set(g.stump, new THREE.MeshStandardMaterial({ color: g.stump, roughness: 0.5 })); return this.stumpMats.get(g.stump); }
  goreOf(type) { return GORE[type.gore === 'blood' && !this.blood ? 'stuffing' : type.gore] || GORE.stuffing; }
  // fill the Weapons Range (skips spots where a building stands)
  populate(spots = SPOTS) {
    const types = DOLL_TYPES.filter(t => t.id !== 'boss'), boss = DOLL_TYPES.find(t => t.id === 'boss');
    let k = 0;
    for (const [x, z, tag] of spots) {
      if (queryBox(x - 1.4, z - 1.4, x + 1.4, z + 1.4).length) continue;
      const type = tag === 'boss' && boss ? boss : types[k++ % types.length];
      this.dolls.push(new Doll(this, type, x, z, (Math.random() - 0.5) * 0.6, true));
    }
  }
  spawn(pos, yaw, typeId) {
    const list = DOLL_TYPES.filter(t => t.id !== 'boss');
    const type = DOLL_TYPES.find(t => t.id === typeId) || list[Math.floor(Math.random() * list.length)];
    const own = this.dolls.filter(d => !d.home);
    if (own.length >= 20) { own[0].dispose(); this.dolls.splice(this.dolls.indexOf(own[0]), 1); }
    const d = new Doll(this, type, pos.x, pos.z, yaw, false);
    this.dolls.push(d);
    return d;
  }
  // Backspace: everyone back on their stand, spawned ones gone, pools cleaned
  reset() {
    for (const d of this.dolls.filter(d => !d.home)) d.dispose();
    this.dolls = this.dolls.filter(d => d.home);
    for (const d of this.dolls) d.reset();
    this.bleeders.length = 0; this.pools.length = 0; this.poolMesh.count = 0;
  }
  setBlood(on) { this.blood = on; }

  // ---------- hits ----------
  explode(pos, radius, power) {
    const R = radius * 0.9 + 0.5;   // tight, so the parts nearest the hit take the damage
    for (const d of this.dolls) {
      if (d.pelvis.distanceTo(pos) > R + 2 * d.s) continue;
      // damage each part by how close it is: the nearest parts take the most
      const td = segDist(pos, d.p[0], d.p[1]);
      const ft = Math.max(0, 1 - td / R);
      for (const g of d.segs) {
        const dist = g.id === 'head' ? d.p[g.ia].distanceTo(pos) : segDist(pos, d.p[g.ia], d.p[g.ib]);
        const f = Math.max(0, 1 - dist / R);
        if (f > 0) d.hurt(g, power * 110 * f * f);
      }
      if (ft > 0) d.hurt(null, power * 70 * ft * ft);
      // push every particle away (and a bit up)
      for (let i = 0; i < d.n; i++) {
        _a.subVectors(d.p[i], pos); const dist = _a.length();
        const f = Math.max(0, 1 - dist / R);
        if (f <= 0) continue;
        _a.normalize().y += 0.5;
        d.addVel(i, _a.multiplyScalar(power * 18 * Math.sqrt(f) / Math.sqrt(d.s)));
      }
    }
  }
  // a point hit for bodyHit callers (railgun, bullets, mines): a stand-in body
  hit(pt, r) {
    for (const d of this.dolls) {
      if (d.pelvis.distanceTo(pt) > 1.4 * d.s + r) continue;
      const n = d.nearest(pt);
      if (n.d > r) continue;
      const doll = this, seg = n.seg;
      return { mass: 80, pos: pt.clone(), doll: d, wake() { d.wake(); }, applyImpulse(J, at) { doll.punch(d, seg, J, at || pt); }, penetrate() { return 0; } };
    }
    return null;
  }
  punch(d, seg, J, at) {
    const dmg = J.length() / 8;
    d.hurt(seg, dmg);
    const gore = this.goreOf(d.type);
    this.spray(at, _a.copy(J).normalize(), 8, gore);
    const i = seg ? seg.ib : 0;
    d.addVel(i, _b.copy(J).multiplyScalar(1 / 40 / d.s));
    if (seg) d.addVel(seg.ia, _b.multiplyScalar(0.5));
  }
  // the car knocks dolls over (they don't push back)
  ram(veh) {
    const sp = veh.vel.length();
    if (sp < 1.5) return;
    _inv.copy(veh.quat).invert();
    for (const d of this.dolls) {
      if (d.pelvis.distanceTo(veh.pos) > 4 + d.s) continue;
      const close = _c.subVectors(d.p[1], d.o[1]).multiplyScalar(-1 / SUB).add(veh.vel).length();
      let hits = 0;
      for (let i = 0; i < d.n; i++) {
        _a.subVectors(d.p[i], veh.pos).applyQuaternion(_inv);
        if (Math.abs(_a.x) > 1.05 || Math.abs(_a.z) > 2.35 || _a.y < -0.5 || _a.y > 0.8) continue;
        // out through the nearest side, moving with the car
        const ex = 1.05 - Math.abs(_a.x), ez = 2.35 - Math.abs(_a.z), ey = 0.8 - _a.y;
        if (ez <= ex && ez <= ey) _a.z = Math.sign(_a.z) * 2.4; else if (ex <= ey) _a.x = Math.sign(_a.x) * 1.1; else _a.y = 0.85;
        d.p[i].copy(_a.applyQuaternion(veh.quat)).add(veh.pos);
        d.o[i].copy(d.p[i]).addScaledVector(veh.vel, -SUB * 1.1); d.o[i].y -= SUB * sp * 0.25;
        hits++;
      }
      if (hits) {
        d.wake();
        const dmg = Math.max(0, close - 5) * 3.5;
        if (dmg > 0 && d.ramT <= 0) { d.ramT = 0.4; const n = d.nearest(veh.pos); d.hurt(n.seg, dmg); d.hurt(null, dmg * 0.5); }
      }
    }
  }

  // ---------- gore ----------
  spray(at, dir, n, gore) {
    const fx = this.fx.smoke, [r, g, b] = gore.col;
    for (let i = 0; i < n; i++) {
      const s = 1.5 + Math.random() * 4;
      fx.spawn(at.x, at.y, at.z, dir.x * s + (Math.random() - 0.5) * 3, dir.y * s + Math.random() * 3, dir.z * s + (Math.random() - 0.5) * 3,
        0.7 + Math.random() * 0.6, gore.size, gore.size * 1.4, r, g, b, 0.95, { drag: 0.4, grav: gore.grav });
    }
  }
  bleed(d, i, gore) { this.bleeders.push({ d, i, gore, t: 2.5 + Math.random() * 1.5 }); if (this.bleeders.length > 40) this.bleeders.shift(); }
  pool(at, r, gore, grow = 1.5) {
    if (!gore.pool) return;
    if (this.pools.length >= this.poolCap) this.pools.shift();
    this.pools.push({ x: at.x + (Math.random() - 0.5) * 0.3, z: at.z + (Math.random() - 0.5) * 0.3, r, t: 0, grow, col: new THREE.Color(gore.pool) });
  }
  onLimb(d) { /* credits are paid on the knockout */ }
  onKO(d) {
    const cr = d.type.id === 'boss' ? 500 : 40 + d.limbs * 10;
    if (this.onReward) this.onReward(`${d.type.name} K.O.${d.limbs ? ` · ${d.limbs} limb${d.limbs > 1 ? 's' : ''} off` : ''}`, cr);
  }

  update(dt, veh, maxSub = 6) {
    if (dt <= 0) return;
    if (veh) this.ram(veh);
    this.acc = Math.min((this.acc || 0) + dt, maxSub * SUB);
    let steps = 0;
    while (this.acc >= SUB) { this.acc -= SUB; steps++; }
    for (const d of this.dolls) {
      if (d.ramT > 0) d.ramT -= dt;
      if (d.state === 'rag') {
        let mv = 0;
        for (let k = 0; k < steps; k++) mv = d.step(SUB);
        if (steps) { if (mv < 1e-7) { d.still += dt; if (d.still > 1.5) d.state = 'sleep'; } else d.still = 0; }
        d.draw();
      }
      // knocked off its stand but still standing a chance: back on the stand after a while
      if (d.home && !d.dead && d.state === 'sleep') { d.downT += dt; if (d.downT > 20) d.reset(); } else d.downT = 0;
      if (d.koPay > 0) { d.koPay -= dt; if (d.koPay <= 0) this.onKO(d); }
      if (d.dead) {
        d.deadT += dt;
        if (d.deadT > 2) d.bar.visible = false;
        if (d.home && d.deadT > 15) { d.reset(); this.fx.smoke.spawn(d.base.x, d.base.y + 1, d.base.z, 0, 1, 0, 1.2, 0.8, 2.5, 0.9, 0.9, 0.9, 0.5, { drag: 2 }); }
      }
    }
    // stumps keep dripping for a few seconds
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i]; b.t -= dt;
      if (b.t <= 0 || !this.dolls.includes(b.d)) { this.bleeders.splice(i, 1); continue; }
      if (Math.random() < dt * 25) { const p = b.d.p[b.i]; this.spray(p, _a.set(0, -0.3, 0), 1, b.gore); }
      if (Math.random() < dt * 0.6) this.pool(b.d.p[b.i], 0.15 + Math.random() * 0.2, b.gore);
    }
    // pools spread, then fade after a while
    let n = 0;
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const q = this.pools[i]; q.t += dt;
      if (q.t > 60) { this.pools.splice(i, 1); continue; }
    }
    for (const q of this.pools) {
      const k = Math.min(1, q.t / q.grow), r = q.r * (0.2 + 0.8 * Math.sqrt(k)) * (q.t > 50 ? Math.max(0, (60 - q.t) / 10) : 1);
      _m.compose(_a.set(q.x, heightAt(q.x, q.z) + 0.015, q.z), _q.identity(), _b.set(r, 1, r * 0.85));
      this.poolMesh.setMatrixAt(n, _m); this.poolMesh.setColorAt(n, q.col); n++;
    }
    this.poolMesh.count = n;
    this.poolMesh.instanceMatrix.needsUpdate = true;
    if (this.poolMesh.instanceColor) this.poolMesh.instanceColor.needsUpdate = true;
  }
}
