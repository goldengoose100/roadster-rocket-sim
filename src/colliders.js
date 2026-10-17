// Static collision world: terrain + oriented boxes + curved shells (ramps / loops).
// All queries are analytic, so they are fast and exact.
import * as THREE from 'three';
import { heightAt, normalAt, isPaved } from './terrain.js';

const CELL = 10;
const grid = new Map();
export const colliders = [];
let stamp = 1;
const key = (ix, iz) => ((ix + 2048) << 12) | (iz + 2048);

const _v = new THREE.Vector3();

export const GRIP = { asphalt: 1.18, sand: 0.82, metal: 1.05, concrete: 1.12, wood: 0.9 };

// ---------- OBB ----------
export class OBB {
  constructor(center, quat, half, opts = {}) {
    this.kind = 'obb';
    this.c = center.clone();
    this.q = quat.clone();
    this.h = half.clone();
    this.ax = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    this.ay = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    this.az = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
    this.grip = opts.grip ?? GRIP.concrete;
    this.surface = opts.surface ?? 'concrete';
    this.alive = true;
    this.owner = opts.owner || null; // destructible block / target ref
    this.stamp = 0;
    this.computeAABB();
  }
  computeAABB() {
    const ex = Math.abs(this.ax.x) * this.h.x + Math.abs(this.ay.x) * this.h.y + Math.abs(this.az.x) * this.h.z;
    const ey = Math.abs(this.ax.y) * this.h.x + Math.abs(this.ay.y) * this.h.y + Math.abs(this.az.y) * this.h.z;
    const ez = Math.abs(this.ax.z) * this.h.x + Math.abs(this.ay.z) * this.h.y + Math.abs(this.az.z) * this.h.z;
    this.min = new THREE.Vector3(this.c.x - ex, this.c.y - ey, this.c.z - ez);
    this.max = new THREE.Vector3(this.c.x + ex, this.c.y + ey, this.c.z + ez);
  }
  // returns {t, nx, ny, nz} or null
  raycast(o, d, maxT, out) {
    const px = o.x - this.c.x, py = o.y - this.c.y, pz = o.z - this.c.z;
    const A = [this.ax, this.ay, this.az], hh = [this.h.x, this.h.y, this.h.z];
    let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
    for (let k = 0; k < 3; k++) {
      const a = A[k];
      const ol = px * a.x + py * a.y + pz * a.z;
      const dl = d.x * a.x + d.y * a.y + d.z * a.z;
      if (Math.abs(dl) < 1e-9) { if (Math.abs(ol) > hh[k]) return false; continue; }
      let t1 = (-hh[k] - ol) / dl, t2 = (hh[k] - ol) / dl, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = k; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (axis < 0 || tmin < 0 || tmin > maxT) return false;
    const a = A[axis];
    out.t = tmin; out.nx = a.x * sign; out.ny = a.y * sign; out.nz = a.z * sign;
    return true;
  }
  // penetration of a point; returns depth > 0 and fills normal
  penetrate(p, out) {
    const px = p.x - this.c.x, py = p.y - this.c.y, pz = p.z - this.c.z;
    const lx = px * this.ax.x + py * this.ax.y + pz * this.ax.z;
    const ly = px * this.ay.x + py * this.ay.y + pz * this.ay.z;
    const lz = px * this.az.x + py * this.az.y + pz * this.az.z;
    const dx = this.h.x - Math.abs(lx), dy = this.h.y - Math.abs(ly), dz = this.h.z - Math.abs(lz);
    if (dx <= 0 || dy <= 0 || dz <= 0) return 0;
    let a, s, d;
    if (dy <= dx && dy <= dz) { a = this.ay; s = Math.sign(ly) || 1; d = dy; }
    else if (dx <= dz) { a = this.ax; s = Math.sign(lx) || 1; d = dx; }
    else { a = this.az; s = Math.sign(lz) || 1; d = dz; }
    out.nx = a.x * s; out.ny = a.y * s; out.nz = a.z * s;
    return d;
  }
  containsPoint(p, margin = 0) {
    const px = p.x - this.c.x, py = p.y - this.c.y, pz = p.z - this.c.z;
    return Math.abs(px * this.ax.x + py * this.ax.y + pz * this.ax.z) < this.h.x + margin &&
      Math.abs(px * this.ay.x + py * this.ay.y + pz * this.ay.z) < this.h.y + margin &&
      Math.abs(px * this.az.x + py * this.az.y + pz * this.az.z) < this.h.z + margin;
  }
}

// ---------- Curved shell (inside of a cylinder), optionally helical ----------
// Local frame: axis along local X, bottom of curve tangent to local origin, climbing toward +Z.
// Surface point S(phi) = (xc(phi), R - R cos phi, R sin phi); xc = shift * phi / 2pi.
export class Curve {
  constructor(origin, yaw, R, halfWidth, phiMax, opts = {}) {
    this.kind = 'curve';
    this.o = origin.clone();
    this.yaw = yaw;
    this.R = R; this.hw = halfWidth; this.phiMax = phiMax;
    this.shift = opts.shift || 0;
    this.th = opts.thickness || 0.8;
    this.grip = opts.grip ?? GRIP.metal;
    this.surface = 'metal';
    this.alive = true;
    this.stamp = 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // local X axis, local Z axis in world (Y is world up)
    this.ax = new THREE.Vector3(c, 0, -s);
    this.az = new THREE.Vector3(s, 0, c);
    // AABB
    const pts = [];
    const xs = [Math.min(-halfWidth, this.shift - halfWidth) - 1, Math.max(halfWidth, this.shift + halfWidth) + 1];
    for (const x of xs) for (const y of [-1, 2 * R + this.th + 1]) for (const z of [-R - this.th - 1, R + this.th + 1]) pts.push(this.toWorld(x, y, z, new THREE.Vector3()));
    this.min = new THREE.Vector3(Infinity, Infinity, Infinity); this.max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) { this.min.min(p); this.max.max(p); }
  }
  toWorld(x, y, z, out) {
    out.set(this.o.x + this.ax.x * x + this.az.x * z, this.o.y + y, this.o.z + this.ax.z * x + this.az.z * z);
    return out;
  }
  local(p) {
    const dx = p.x - this.o.x, dz = p.z - this.o.z;
    return [dx * this.ax.x + dz * this.ax.z, p.y - this.o.y, dx * this.az.x + dz * this.az.z];
  }
  xc(phi) { return this.shift * phi / (Math.PI * 2); }
  validPhi(phi, lx) {
    // returns the phi (possibly +2pi) whose lane contains lx, or NaN
    if (phi >= -0.001 && phi <= this.phiMax && Math.abs(lx - this.xc(phi)) <= this.hw) return phi;
    const p2 = phi + Math.PI * 2;
    if (p2 <= this.phiMax && Math.abs(lx - this.xc(p2)) <= this.hw) return p2;
    return NaN;
  }
  normalWorld(ly, lz, out) {
    // inward normal in local (0, (R - y)/R, -z/R)
    const ny = (this.R - ly), nz = -lz;
    const l = Math.hypot(ny, nz) || 1;
    out.x = (this.az.x * nz) / l; out.y = ny / l; out.z = (this.az.z * nz) / l;
    return out;
  }
  raycast(o, d, maxT, out, twoSided = false) {
    const [ox, oy, oz] = this.local(o);
    const dx = d.x * this.ax.x + d.z * this.ax.z, dy = d.y, dz = d.x * this.az.x + d.z * this.az.z;
    const R = this.R;
    const a = dy * dy + dz * dz;
    if (a < 1e-10) return false;
    const by = oy - R;
    const b = 2 * (by * dy + oz * dz);
    const c = by * by + oz * oz - R * R;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    const cands = c < 0 ? [t2] : (twoSided ? [t1] : []);
    for (const t of cands) {
      if (t < 0 || t > maxT) continue;
      const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
      const phi = Math.atan2(hz, R - hy);
      if (Number.isNaN(this.validPhi(phi, hx))) continue;
      out.t = t;
      const n = this.normalWorld(hy, hz, _v);
      if (c >= 0) { n.multiplyScalar(-1); }
      out.nx = n.x; out.ny = n.y; out.nz = n.z;
      return true;
    }
    return false;
  }
  penetrate(p, out) {
    const [lx, ly, lz] = this.local(p);
    const dy = ly - this.R;
    const r = Math.hypot(dy, lz);
    if (r <= this.R || r >= this.R + this.th) return 0;
    const phi = Math.atan2(lz, this.R - ly);
    if (Number.isNaN(this.validPhi(phi, lx))) return 0;
    const n = this.normalWorld(ly, lz, _v);
    let depth = r - this.R;
    if (depth > this.th * 0.6) { depth = this.R + this.th - r; n.multiplyScalar(-1); }
    out.nx = n.x; out.ny = n.y; out.nz = n.z;
    return depth;
  }
}

// ---------- Wedge (jump ramp) ----------
// Local frame: origin at the low entry edge centre on the ground, +Z up the slope, top surface y = z*H/L.
export class Wedge {
  constructor(origin, yaw, halfWidth, length, height, opts = {}) {
    this.kind = 'wedge';
    this.o = origin.clone(); this.yaw = yaw;
    this.hw = halfWidth; this.L = length; this.H = height;
    this.grip = opts.grip ?? GRIP.concrete;
    this.surface = opts.surface ?? 'concrete';
    this.alive = true; this.stamp = 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.ax = new THREE.Vector3(c, 0, -s);
    this.az = new THREE.Vector3(s, 0, c);
    const a = Math.atan2(height, length);
    this.cosA = Math.cos(a); this.sinA = Math.sin(a);
    this.min = new THREE.Vector3(Infinity, this.o.y - 0.5, Infinity); this.max = new THREE.Vector3(-Infinity, this.o.y + height, -Infinity);
    for (const x of [-halfWidth, halfWidth]) for (const z of [0, length]) {
      const wx = this.o.x + this.ax.x * x + this.az.x * z, wz = this.o.z + this.ax.z * x + this.az.z * z;
      this.min.x = Math.min(this.min.x, wx); this.max.x = Math.max(this.max.x, wx);
      this.min.z = Math.min(this.min.z, wz); this.max.z = Math.max(this.max.z, wz);
    }
  }
  local(p) {
    const dx = p.x - this.o.x, dz = p.z - this.o.z;
    return [dx * this.ax.x + dz * this.ax.z, p.y - this.o.y, dx * this.az.x + dz * this.az.z];
  }
  setN(out, lx, ly, lz) { // local dir -> world
    out.nx = this.ax.x * lx + this.az.x * lz; out.ny = ly; out.nz = this.ax.z * lx + this.az.z * lz;
  }
  penetrate(p, out) {
    const [x, y, z] = this.local(p);
    if (Math.abs(x) >= this.hw || z <= 0 || z >= this.L || y <= -0.5) return 0;
    const ys = z * this.H / this.L;
    if (y >= ys) return 0;
    const dTop = (ys - y) * this.cosA, dSide = this.hw - Math.abs(x), dBack = this.L - z;
    if (dTop <= dSide && dTop <= dBack) { this.setN(out, 0, this.cosA, -this.sinA); return dTop; }
    if (dSide <= dBack) { this.setN(out, Math.sign(x), 0, 0); return dSide; }
    this.setN(out, 0, 0, 1); return dBack;
  }
  raycast(o, d, maxT, out) {
    const [ox, oy, oz] = this.local(o);
    const dx = d.x * this.ax.x + d.z * this.ax.z, dy = d.y, dz = d.x * this.az.x + d.z * this.az.z;
    let best = maxT, hit = false, nx = 0, ny = 0, nz = 0;
    // top plane: n = (0, cosA, -sinA), passes through origin
    const dn = dy * this.cosA - dz * this.sinA;
    if (dn < -1e-9) {
      const t = -(oy * this.cosA - oz * this.sinA) / dn;
      if (t >= 0 && t <= best) {
        const hx = ox + dx * t, hz = oz + dz * t;
        if (Math.abs(hx) <= this.hw && hz >= 0 && hz <= this.L) { best = t; hit = true; nx = 0; ny = this.cosA; nz = -this.sinA; }
      }
    }
    // sides
    for (const sgn of [-1, 1]) {
      if (dx * sgn >= 0) continue;
      const t = (sgn * this.hw - ox) / dx;
      if (t < 0 || t > best) continue;
      const hy = oy + dy * t, hz = oz + dz * t;
      if (hz > 0 && hz < this.L && hy > 0 && hy < hz * this.H / this.L) { best = t; hit = true; nx = sgn; ny = 0; nz = 0; }
    }
    // back face z = L
    if (dz < 0) {
      const t = (this.L - oz) / dz;
      if (t >= 0 && t <= best) {
        const hx = ox + dx * t, hy = oy + dy * t;
        if (Math.abs(hx) < this.hw && hy > 0 && hy < this.H) { best = t; hit = true; nx = 0; ny = 0; nz = 1; }
      }
    }
    if (!hit) return false;
    out.t = best; this.setN(out, nx, ny, nz);
    return true;
  }
}

// ---------- grid ----------
export function addCollider(col) {
  colliders.push(col);
  const x0 = Math.floor(col.min.x / CELL), x1 = Math.floor(col.max.x / CELL);
  const z0 = Math.floor(col.min.z / CELL), z1 = Math.floor(col.max.z / CELL);
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
    const k = key(ix, iz);
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(col);
  }
  return col;
}
export function removeCollider(col) {
  col.alive = false;
}

const _list = [];
function gather(minx, minz, maxx, maxz) {
  stamp++;
  _list.length = 0;
  const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
  const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
    const arr = grid.get(key(ix, iz));
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c.stamp === stamp || !c.alive) continue;
      c.stamp = stamp;
      _list.push(c);
    }
  }
  return _list;
}

// ---------- queries ----------
const _hit = { t: 0, nx: 0, ny: 0, nz: 0 };
const _tn = new THREE.Vector3();

// Terrain raycast by marching + bisection
function terrainRay(o, d, maxT, out) {
  const f = (t) => (o.y + d.y * t) - heightAt(o.x + d.x * t, o.z + d.z * t);
  let t0 = 0, f0 = f(0);
  if (f0 < 0) { // origin below ground: hit immediately
    if (f0 > -2) { out.t = 0; normalAt(o.x, o.z, _tn); out.nx = _tn.x; out.ny = _tn.y; out.nz = _tn.z; return true; }
    return false;
  }
  const steps = Math.max(2, Math.ceil(maxT / 1.5));
  const dt = maxT / steps;
  for (let s = 1; s <= steps; s++) {
    const t1 = s * dt, f1 = f(t1);
    if (f1 <= 0) {
      let a = t0, b = t1;
      for (let k = 0; k < 10; k++) { const m = (a + b) * 0.5; if (f(m) > 0) a = m; else b = m; }
      out.t = (a + b) * 0.5;
      normalAt(o.x + d.x * out.t, o.z + d.z * out.t, _tn);
      out.nx = _tn.x; out.ny = _tn.y; out.nz = _tn.z;
      return true;
    }
    t0 = t1; f0 = f1;
  }
  return false;
}

// Result object reused by callers
export function makeHit() { return { t: 0, normal: new THREE.Vector3(), point: new THREE.Vector3(), grip: 1, surface: 'sand', col: null }; }

export function raycast(o, d, maxT, res, opts = {}) {
  let best = maxT, found = false;
  if (terrainRay(o, d, maxT, _hit) && _hit.t <= best) {
    best = _hit.t; found = true;
    res.normal.set(_hit.nx, _hit.ny, _hit.nz); res.col = null;
  }
  const ex = o.x + d.x * maxT, ez = o.z + d.z * maxT;
  const list = gather(Math.min(o.x, ex) - 0.5, Math.min(o.z, ez) - 0.5, Math.max(o.x, ex) + 0.5, Math.max(o.z, ez) + 0.5);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (opts.skipOwned && c.owner) continue;
    const ok = c.kind === 'curve' ? c.raycast(o, d, best, _hit, opts.twoSided) : c.raycast(o, d, best, _hit);
    if (ok && _hit.t <= best) {
      best = _hit.t; found = true;
      res.normal.set(_hit.nx, _hit.ny, _hit.nz); res.col = c;
    }
  }
  if (!found) return false;
  res.t = best;
  res.point.copy(d).multiplyScalar(best).add(o);
  if (res.col) { res.grip = res.col.grip; res.surface = res.col.surface; }
  else { const paved = isPaved(res.point.x, res.point.z); res.grip = paved ? GRIP.asphalt : GRIP.sand; res.surface = paved ? 'asphalt' : 'sand'; }
  return true;
}

// Deepest penetration of point p into static world. Returns depth (0 = none), fills res.normal/grip/col.
const _pen = { nx: 0, ny: 0, nz: 0 };
export function pointContact(p, res) {
  let best = 0;
  const h = heightAt(p.x, p.z);
  if (p.y < h) {
    normalAt(p.x, p.z, _tn);
    best = (h - p.y) * _tn.y;
    res.normal.copy(_tn); res.col = null; res.grip = 0.6; res.surface = 'ground';
  }
  const list = gather(p.x - 0.1, p.z - 0.1, p.x + 0.1, p.z + 0.1);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (p.y < c.min.y - 0.1 || p.y > c.max.y + 0.1) continue;
    const d = c.penetrate(p, _pen);
    if (d > best) { best = d; res.normal.set(_pen.nx, _pen.ny, _pen.nz); res.col = c; res.grip = 0.6; res.surface = c.surface; }
  }
  return best;
}

// Colliders near an AABB (for debris / rockets)
export function queryBox(minx, minz, maxx, maxz) {
  return gather(minx, minz, maxx, maxz);
}

// Height of the highest surface under a point (for AGL / camera); uses a downward ray.
const _down = new THREE.Vector3(0, -1, 0);
const _gh = makeHit();
export function groundBelow(p, maxDist = 400) {
  if (raycast(p, _down, maxDist, _gh)) return _gh.t;
  return Infinity;
}
