// Visual effects: GPU-instanced billboard particles (fire, smoke, dust, vapor, sparks),
// explosions with flash lights and shockwaves, scorch marks and skid marks.
import * as THREE from 'three';
import { heightAt, normalAt } from './terrain.js';
import { frontRadius } from './shockwave.js';

function softTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  if (kind === 'glow') {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  } else {
    // puffy smoke: several soft blobs
    for (let i = 0; i < 14; i++) {
      const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 24 + Math.random() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    // radial mask
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

const VERT = `
attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSR;
varying vec2 vUv; varying vec4 vCol; varying float vFog;
uniform float fogDensity;
void main(){
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSR.y), s = sin(iSR.y);
  vec2 p = position.xy * iSR.x;
  mv.xy += vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  gl_Position = projectionMatrix * mv;
  vUv = uv; vCol = iCol;
  float d = -mv.z;
  vFog = 1.0 - exp(-fogDensity*fogDensity*d*d);
}`;
const FRAG = `
uniform sampler2D map; uniform vec3 fogColor; uniform float additive;
varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main(){
  vec4 t = texture2D(map, vUv);
  float a = t.a * vCol.a;
  if (a < 0.003) discard;
  vec3 col = vCol.rgb * mix(1.0, t.r, 0.0);
  if (additive > 0.5) { gl_FragColor = vec4(col * a * (1.0 - vFog) * 1.7, 1.0); }
  else { gl_FragColor = vec4(mix(col, fogColor, vFog), a); }
}`;

class ParticleSystem {
  constructor(scene, cap, additive, texture, fog) {
    this.cap = cap; this.n = 0;
    const f = (k) => new Float32Array(cap * k);
    this.px = f(1); this.py = f(1); this.pz = f(1); this.vx = f(1); this.vy = f(1); this.vz = f(1);
    this.age = f(1); this.life = f(1); this.s0 = f(1); this.s1 = f(1); this.rot = f(1); this.rv = f(1);
    this.r0 = f(1); this.g0 = f(1); this.b0 = f(1); this.r1 = f(1); this.g1 = f(1); this.b1 = f(1); this.a = f(1);
    this.drag = f(1); this.grav = f(1);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iCol', this.aCol); geo.setAttribute('iSR', this.aSR);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: texture }, fogColor: { value: fog.color }, fogDensity: { value: fog.density }, additive: { value: additive ? 1 : 0 } },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
    scene.add(this.mesh);
    this.budget = 1;
    this.wind = null;   // {x, z} drift (Physics 2.0); particles relax toward it instead of to rest
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, o = {}) {
    if (this.n >= this.cap) return;
    if (this.budget < 1 && Math.random() > this.budget) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.r0[i] = r; this.g0[i] = g; this.b0[i] = b;
    this.r1[i] = o.r1 ?? r; this.g1[i] = o.g1 ?? g; this.b1[i] = o.b1 ?? b; this.a[i] = a;
    this.drag[i] = o.drag ?? 1.5; this.grav[i] = o.grav ?? 0;
    this.rot[i] = Math.random() * 6.28; this.rv[i] = (Math.random() - 0.5) * (o.spin ?? 1);
  }
  update(dt) {
    let w = 0;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSR.array;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      // compact
      if (w !== i) {
        for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 's0', 's1', 'rot', 'rv', 'r0', 'g0', 'b0', 'r1', 'g1', 'b1', 'a', 'drag', 'grav']) this[k][w] = this[k][i];
      }
      this.age[w] = age;
      const dr = Math.exp(-this.drag[w] * dt);
      if (this.wind) { const wx = this.wind.x, wz = this.wind.z; this.vx[w] = wx + (this.vx[w] - wx) * dr; this.vz[w] = wz + (this.vz[w] - wz) * dr; }
      else { this.vx[w] *= dr; this.vz[w] *= dr; }
      this.vy[w] = this.vy[w] * dr - this.grav[w] * dt;
      this.px[w] += this.vx[w] * dt; this.py[w] += this.vy[w] * dt; this.pz[w] += this.vz[w] * dt;
      this.rot[w] += this.rv[w] * dt;
      const t = age / this.life[w];
      const fade = Math.min(1, t * 10) * (1 - t) * (1 - t * 0.3);
      P[w * 3] = this.px[w]; P[w * 3 + 1] = this.py[w]; P[w * 3 + 2] = this.pz[w];
      C[w * 4] = this.r0[w] + (this.r1[w] - this.r0[w]) * t; C[w * 4 + 1] = this.g0[w] + (this.g1[w] - this.g0[w]) * t; C[w * 4 + 2] = this.b0[w] + (this.b1[w] - this.b0[w]) * t;
      C[w * 4 + 3] = this.a[w] * fade;
      S[w * 2] = this.s0[w] + (this.s1[w] - this.s0[w]) * Math.sqrt(t); S[w * 2 + 1] = this.rot[w];
      w++;
    }
    this.n = w;
    this.geo.instanceCount = w;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSR.needsUpdate = true;
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
}

class SkidMarks {
  constructor(scene, cap = 4000) {
    this.cap = cap; this.i = 0; this.count = 0;
    const pos = new Float32Array(cap * 4 * 3), col = new Float32Array(cap * 4 * 4);
    const idx = new Uint32Array(cap * 6);
    for (let k = 0; k < cap; k++) { const b = k * 4; idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], k * 6); }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('color', this.col); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.last = [null, null, null, null];
  }
  add(wi, p, n, side, alpha, rgb) {
    const last = this.last[wi];
    if (!last || last.p.distanceToSquared(p) > 9) { this.last[wi] = { p: p.clone(), s: side.clone() }; return; }
    if (last.p.distanceToSquared(p) < 0.09) return;
    const k = this.i; this.i = (this.i + 1) % this.cap; this.count = Math.min(this.cap, this.count + 1);
    const w = 0.13, lift = 0.025;
    const P = this.pos.array, C = this.col.array;
    const put = (vi, q, s, sg) => { P[vi * 3] = q.x + s.x * w * sg + n.x * lift; P[vi * 3 + 1] = q.y + s.y * w * sg + n.y * lift; P[vi * 3 + 2] = q.z + s.z * w * sg + n.z * lift; };
    put(k * 4, last.p, last.s, -1); put(k * 4 + 1, last.p, last.s, 1); put(k * 4 + 2, p, side, -1); put(k * 4 + 3, p, side, 1);
    for (let v = 0; v < 4; v++) { C[(k * 4 + v) * 4] = rgb[0]; C[(k * 4 + v) * 4 + 1] = rgb[1]; C[(k * 4 + v) * 4 + 2] = rgb[2]; C[(k * 4 + v) * 4 + 3] = alpha; }
    last.p.copy(p); last.s.copy(side);
    this.pos.needsUpdate = true; this.col.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.count * 6);
  }
  break(wi) { this.last[wi] = null; }
  clear() { this.count = 0; this.i = 0; this.mesh.geometry.setDrawRange(0, 0); this.last = [null, null, null, null]; }
}

export class Effects {
  constructor(scene, fog) {
    this.scene = scene;
    const glow = softTexture('glow'), puff = softTexture('puff');
    this.smoke = new ParticleSystem(scene, 9000, false, puff, fog);
    this.fire = new ParticleSystem(scene, 5000, true, glow, fog);
    this.skids = new SkidMarks(scene);
    this.trauma = 0;
    // flash lights
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight('#ffb466', 0, 90, 2);
      scene.add(l); // always visible at intensity 0: toggling lights recompiles every shader (freeze)
      this.lights.push({ l, t: 0, max: 0 });
    }
    // shockwave rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.85, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffe2b0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; scene.add(m);
      this.rings.push({ m, t: 1, r: 1 });
    }
    // Physics 2.0: faint pressure shells that grow with the real shock front
    this.shells = [];
    const shellGeo = new THREE.SphereGeometry(1, 32, 16);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ color: '#fff4e0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: false }));
      m.visible = false; m.renderOrder = 12; scene.add(m);
      this.shells.push({ m, s: null });
    }
    this.shockFronts = true;  // set false in Classic
    // scorch decals
    const sc = document.createElement('canvas'); sc.width = sc.height = 128;
    const g = sc.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(10,8,6,0.95)'); gr.addColorStop(0.5, 'rgba(20,14,10,0.6)'); gr.addColorStop(1, 'rgba(20,14,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const scTex = new THREE.CanvasTexture(sc);
    const decGeo = new THREE.PlaneGeometry(1, 1); decGeo.rotateX(-Math.PI / 2);
    this.decals = [];
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(decGeo, new THREE.MeshBasicMaterial({ map: scTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
      m.visible = false; m.renderOrder = 3; scene.add(m);
      this.decals.push(m);
    }
    this.decalI = 0;
    this.quality = 1;
    this.emitters = [];
    this.vapor = [0.93, 0.97, 1.0];
  }
  setQuality(q) { this.quality = q; this.smoke.budget = q; this.fire.budget = q; }

  explosion(pos, radius, power = 1) {
    const s = radius / 9;
    this.trauma = Math.min(1, this.trauma + 0.0);
    // flash
    this.fire.spawn(pos.x, pos.y, pos.z, 0, 0, 0, 0.14, radius * 0.8, radius * 1.7, 1, 0.75, 0.45, 0.85);
    // fireball
    for (let i = 0; i < 30; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.15, Math.random() - 0.5).normalize().multiplyScalar((6 + Math.random() * 16) * s);
      this.fire.spawn(pos.x, pos.y, pos.z, d.x, d.y + 2, d.z, 0.45 + Math.random() * 0.55, (1.5 + Math.random() * 2.5) * s, (4 + Math.random() * 4) * s,
        1.0, 0.32 + Math.random() * 0.2, 0.06, 0.5, { r1: 0.4, g1: 0.06, b1: 0.02, drag: 3.2, grav: -3 });
    }
    // smoke
    for (let i = 0; i < 40; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).normalize().multiplyScalar((3 + Math.random() * 9) * s);
      const v = 0.07 + Math.random() * 0.08;
      this.smoke.spawn(pos.x + d.x * 0.2, pos.y + d.y * 0.2, pos.z + d.z * 0.2, d.x, d.y + 2.5, d.z, 3 + Math.random() * 4, (3 + Math.random() * 3) * s, (9 + Math.random() * 7) * s,
        v, v * 0.95, v * 0.9, 0.75, { r1: 0.32, g1: 0.3, b1: 0.28, drag: 1.4, grav: -0.6, spin: 0.6 });
    }
    // sparks / embers
    for (let i = 0; i < 50; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar((10 + Math.random() * 28) * s);
      this.fire.spawn(pos.x, pos.y, pos.z, d.x, d.y + 4, d.z, 0.8 + Math.random() * 1.4, 0.25, 0.08, 1, 0.7, 0.3, 1, { r1: 1, g1: 0.3, b1: 0.05, drag: 0.6, grav: 12 });
    }
    // ground dust
    const gh = heightAt(pos.x, pos.z);
    if (pos.y - gh < radius * 0.6) {
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2, sp = (10 + Math.random() * 12) * s;
        this.smoke.spawn(pos.x, gh + 0.5, pos.z, Math.cos(a) * sp, 0.6 + Math.random(), Math.sin(a) * sp, 1.6 + Math.random() * 1.6, 2 * s, 7 * s, 0.5, 0.42, 0.32, 0.4, { drag: 2.2 });
      }
      const m = this.decals[this.decalI++ % this.decals.length];
      m.visible = true;
      m.position.set(pos.x, gh + 0.06, pos.z);
      const sz = radius * (1.1 + Math.random() * 0.4);
      m.scale.set(sz, 1, sz); m.rotation.y = Math.random() * 6;
      const r = this.rings.find(r => r.t >= 1) || this.rings[0];
      r.t = 0; r.r = radius * 3.2; r.m.visible = true; r.m.position.set(pos.x, gh + 0.3, pos.z);
      r.shock = this.shockFronts ? { radius, age: 0, maxR: radius * 7 * Math.sqrt(Math.max(1, power)), gh } : null;
    }
    if (this.shockFronts) {
      const sh = this.shells.find(x => !x.s) || this.shells[0];
      sh.s = { radius, age: 0, maxR: radius * 7 * Math.sqrt(Math.max(1, power)), a: Math.min(0.35, 0.06 + 0.05 * power * radius / 9) };
      sh.m.position.copy(pos); sh.m.visible = true;
    }
    const L = this.lights.find(l => l.t <= 0) || this.lights[0];
    L.l.position.copy(pos); L.l.position.y += 1.5; L.t = 0.45; L.max = 22000 * power * s * s;
  }

  // nuke: big flash, fireball, rising stem and a mushroom cap
  nuke(pos) {
    this.explosion(pos, 30, 3);
    this.fire.spawn(pos.x, pos.y + 10, pos.z, 0, 0, 0, 0.6, 60, 160, 1, 0.95, 0.8, 1);
    const gh = heightAt(pos.x, pos.z);
    for (let i = 0; i < 2; i++) {
      const r = this.rings.find(rr => rr.t >= 1) || this.rings[i];
      r.t = -i * 0.25; r.r = 220; r.m.visible = true; r.m.position.set(pos.x, gh + 0.5, pos.z);
      r.shock = this.shockFronts && i === 0 ? { radius: 38, age: 0, maxR: 38 * 7 * Math.sqrt(3.5), gh } : null;
    }
    this.emitters.push({ t: 0, dur: 6, fn: (t, dt) => {
      const top = Math.min(t, 3) * 28;
      const n = Math.ceil(dt * 160);
      for (let i = 0; i < n; i++) {
        const y = pos.y + Math.random() * top, a = Math.random() * 6.28, rr = 4 + Math.random() * 5;
        this.smoke.spawn(pos.x + Math.cos(a) * rr, y, pos.z + Math.sin(a) * rr, Math.cos(a), 6 + Math.random() * 4, Math.sin(a), 3 + Math.random() * 2, 6, 14, 0.25, 0.2, 0.17, 0.55, { drag: 0.8, grav: -1 });
        if (t < 2.5) this.fire.spawn(pos.x + Math.cos(a) * rr * 0.6, y, pos.z + Math.sin(a) * rr * 0.6, 0, 8, 0, 0.8, 6, 3, 1, 0.45, 0.1, 0.6, { drag: 1 });
        const ca = Math.random() * 6.28, cr = 10 + Math.random() * (8 + t * 7);
        this.smoke.spawn(pos.x + Math.cos(ca) * cr, pos.y + top + (Math.random() - 0.3) * 10, pos.z + Math.sin(ca) * cr, Math.cos(ca) * 5, 3, Math.sin(ca) * 5, 5 + Math.random() * 3, 12, 26, 0.32, 0.26, 0.22, 0.6, { drag: 0.6, grav: -0.5 });
        if (t < 3) this.fire.spawn(pos.x + Math.cos(ca) * cr * 0.7, pos.y + top, pos.z + Math.sin(ca) * cr * 0.7, Math.cos(ca) * 6, 2, Math.sin(ca) * 6, 1, 14, 6, 1, 0.35, 0.08, 0.45, { drag: 1 });
      }
    } });
    const L = this.lights[0];
    L.l.position.set(pos.x, pos.y + 25, pos.z); L.t = 1.6; L.max = 2.5e6; L.l.distance = 900;
    this.trauma = 1;
  }

  update(dt) {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += dt;
      if (dt > 0) e.fn(e.t, dt);
      if (e.t >= e.dur) this.emitters.splice(i, 1);
    }
    this.smoke.update(dt);
    this.fire.update(dt);
    for (const L of this.lights) {
      if (L.t > 0) { L.t -= dt; L.l.intensity = L.max * Math.max(0, Math.min(1, L.t / 0.45)) ** 2; if (L.t <= 0) { L.l.intensity = 0; L.l.distance = 90; } }
    }
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      if (r.shock) {
        // ring rides the real shock front; dust kicks up where it passes
        const sk = r.shock; sk.age += dt;
        const R = frontRadius(sk.radius, sk.age), k = R / sk.maxR;
        r.t = k >= 1 ? 1 : 0;
        r.m.scale.set(R, 1, R);
        r.m.material.opacity = Math.max(0, 1 - k) * 0.8;
        if (dt > 0 && R < 220) {
          const n = Math.min(8, dt * 90 * (1 - k));
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, x = r.m.position.x + Math.cos(a) * R, z = r.m.position.z + Math.sin(a) * R;
            this.smoke.spawn(x, heightAt(x, z) + 0.4, z, Math.cos(a) * 6, 0.8 + Math.random(), Math.sin(a) * 6, 1.2 + Math.random(), 1.2, 4, 0.6, 0.52, 0.42, 0.35 * (1 - k), { drag: 2.5 });
          }
        }
      } else {
        r.t = Math.min(1, r.t + dt * (r.r > 100 ? 0.6 : 2.2));
        const s = r.r * (0.15 + Math.max(0, r.t));
        r.m.scale.set(s, 1, s);
        r.m.material.opacity = r.t < 0 ? 0 : (1 - r.t) * 0.8;
      }
      if (r.t >= 1) r.m.visible = false;
    }
    for (const sh of this.shells) {
      if (!sh.s) continue;
      sh.s.age += dt;
      const R = frontRadius(sh.s.radius, sh.s.age), k = R / sh.s.maxR;
      sh.m.scale.setScalar(R);
      sh.m.material.opacity = sh.s.a * Math.max(0, 1 - k) ** 3;
      if (k >= 1) { sh.s = null; sh.m.visible = false; }
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.2);
  }

  // bright sparks from metal scraping
  sparks(x, y, z, vx, vy, vz, n) {
    for (let i = 0; i < n; i++) {
      this.fire.spawn(x, y, z, vx * 0.6 + (Math.random() - 0.5) * 5, Math.random() * 4 + 1, vz * 0.6 + (Math.random() - 0.5) * 5,
        0.25 + Math.random() * 0.35, 0.12, 0.04, 1, 0.75, 0.35, 1, { r1: 1, g1: 0.35, b1: 0.05, drag: 1.2, grav: 14 });
    }
  }

  clear() {
    this.emitters.length = 0;
    this.smoke.clear(); this.fire.clear(); this.skids.clear();
    for (const d of this.decals) d.visible = false;
  }
}
