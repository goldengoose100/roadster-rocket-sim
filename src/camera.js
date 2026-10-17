// Camera modes: chase, far chase, cockpit, cinematic trackside, free orbit.
// Mouse drag orbits; wheel zooms; trauma-based shake for explosions and hard landings.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _look = new THREE.Vector3();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export const CAMERA_MODES = ['Chase', 'Far chase', 'Cockpit', 'Cinematic', 'Orbit'];

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 0;
    this.yaw = 0; this.yawOff = 0; this.pitchOff = 0; this.zoom = 1;
    this.lastDrag = -10; this.time = 0;
    this.cine = new THREE.Vector3(); this.cineT = 0;
    this.trauma = 0; this.fovKick = 0;
    this.smoothPos = new THREE.Vector3();
    this.first = true;
    this.stuntBlend = 0;
  }
  next() { this.mode = (this.mode + 1) % CAMERA_MODES.length; this.first = true; this.yawOff = 0; this.pitchOff = 0; return CAMERA_MODES[this.mode]; }
  drag(dx, dy) { this.yawOff -= dx * 0.006; this.pitchOff = Math.max(-0.5, Math.min(1.1, this.pitchOff + dy * 0.004)); this.lastDrag = this.time; }
  wheel(d) { this.zoom = Math.max(0.55, Math.min(2.6, this.zoom * (d > 0 ? 1.1 : 0.9))); }
  snap() { this.first = true; }

  update(dt, v, opts = {}) {
    this.time += dt;
    const cam = this.cam;
    const speed = v.vel.length();
    // heading from the car's forward vector (fallback to velocity when pointing straight up/down)
    let hx = v.fwd.x, hz = v.fwd.z;
    if (Math.hypot(hx, hz) < 0.3) { hx = v.vel.x; hz = v.vel.z; }
    if (v.up.y < -0.3 && v.contacts === 0) { hx = v.vel.x || hx; hz = v.vel.z || hz; }
    const targetYaw = Math.atan2(hx, hz);
    if (this.first) { this.yaw = targetYaw; }
    this.yaw += wrap(targetYaw - this.yaw) * (1 - Math.exp(-dt * (v.contacts ? 5 : 2.2)));
    if (this.mode !== 4 && this.time - this.lastDrag > 2.2) {
      this.yawOff *= Math.exp(-dt * 2.5); this.pitchOff *= Math.exp(-dt * 2.5);
    }
    cam.up.set(0, 1, 0);
    let fov = 60;
    if (this.mode === 0 || this.mode === 1 || this.mode === 4) {
      const far = this.mode === 1;
      const cs = this.carScale || 1;
      let dist = (far ? 15 : 7.4) * this.zoom * cs, height = (far ? 4.6 : 2.1) * cs;
      if (this.mode === 4) { dist = 11 * this.zoom; height = 2; if (this.time - this.lastDrag > 4) this.yawOff += dt * 0.15; }
      const yaw = this.yaw + this.yawOff + Math.PI;
      const pitch = (far ? 0.16 : 0.1) + this.pitchOff;
      _v.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + height, Math.cos(yaw) * Math.cos(pitch) * dist);
      _w.copy(v.pos).add(_v);
      // stunt camera: on the loop / demo ramp swing out to a side view of the whole curve
      const stunt = v.curve && v.curveT < 2.2 && this.mode !== 4 && this.time - this.lastDrag > 1;
      this.stuntBlend += ((stunt ? 1 : 0) - this.stuntBlend) * (1 - Math.exp(-dt * 2.2));
      if (this.stuntBlend > 0.001 && v.curve) {
        const c = v.curve;
        const lx = c.hw + c.R * 1.15 + 7;
        c.toWorld(lx, c.R * 0.95, c.R * 0.15, _look);
        _w.lerp(_look, this.stuntBlend);
      }
      // keep above terrain
      const gh = heightAt(_w.x, _w.z) + 0.7;
      if (_w.y < gh) _w.y = gh;
      if (this.first) this.smoothPos.copy(_w);
      this.smoothPos.lerp(_w, 1 - Math.exp(-dt * 14));
      // velocity feed-forward so fast motion doesn't lag
      cam.position.copy(this.smoothPos);
      _look.copy(v.pos); _look.y += 0.75;
      _look.x += Math.sin(this.yaw) * 2 * (1 - this.stuntBlend); _look.z += Math.cos(this.yaw) * 2 * (1 - this.stuntBlend);
      if (this.stuntBlend > 0.001 && v.curve) { const c = v.curve; c.toWorld(0, c.R, c.R * 0.1, _v); _look.lerp(_v, this.stuntBlend * 0.2); }
      cam.lookAt(_look);
      fov = 62 + Math.min(20, speed * 0.16) * (1 - this.stuntBlend) + this.stuntBlend * 8;
    } else if (this.mode === 2) {
      _v.set(0, 0.42, -0.18).applyQuaternion(v.quat);
      cam.position.copy(v.pos).add(_v);
      cam.up.copy(v.up);
      _look.copy(v.fwd).multiplyScalar(10).add(cam.position);
      // allow looking around with drag
      if (this.yawOff || this.pitchOff) {
        _w.copy(v.fwd).applyAxisAngle(v.up, this.yawOff);
        _w.applyAxisAngle(_v.copy(v.left), -this.pitchOff * 0.6);
        _look.copy(_w).multiplyScalar(10).add(cam.position);
      }
      cam.lookAt(_look);
      fov = 72 + Math.min(14, speed * 0.1);
    } else {
      // cinematic: trackside camera ahead of the car
      this.cineT -= dt;
      const d = cam.position.distanceTo(v.pos);
      if (this.first || this.cineT <= 0 || d > 90) {
        _v.copy(v.vel); _v.y = 0;
        if (_v.lengthSq() < 4) _v.copy(v.fwd).setY(0).multiplyScalar(10);
        const ahead = Math.min(70, 8 + speed * 1.6);
        _v.normalize();
        const side = new THREE.Vector3(-_v.z, 0, _v.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 8));
        this.cine.copy(v.pos).addScaledVector(_v, ahead).add(side);
        this.cine.y = Math.max(heightAt(this.cine.x, this.cine.z) + 1.2 + Math.random() * 4, v.pos.y - 2 + Math.random() * 3);
        this.cineT = 5 + Math.random() * 3;
      }
      cam.position.copy(this.cine);
      _look.copy(v.pos); _look.y += 0.5;
      cam.lookAt(_look);
      fov = Math.max(18, Math.min(60, 1400 / Math.max(15, d)));
    }
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    if (s > 0.001) {
      const t = this.time * 38;
      cam.position.x += Math.sin(t * 1.3) * s * 0.5; cam.position.y += Math.sin(t * 1.7 + 1) * s * 0.4; cam.position.z += Math.sin(t * 1.1 + 2) * s * 0.5;
      cam.rotation.z += Math.sin(t * 0.9) * s * 0.03;
    }
    this.fovKick *= Math.exp(-dt * 3);
    const targetFov = fov + this.fovKick + (this.fovAdd || 0);
    cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt * 6));
    cam.near = this.mode === 2 ? 0.05 : 0.2;
    cam.updateProjectionMatrix();
    this.first = false;
  }
}
