// Hologram pace car (mod menu): drives straight ahead at a set speed so you can tuck in behind it and
// feel the slipstream. It is see-through and can't be hit; it leaves a wake the physics drafts in.
import * as THREE from 'three';
import { makeBodyGeometry, makeCanopyGeometry } from './carModel.js';
import { groundBelow } from './colliders.js';

const VERT = `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(normalMatrix * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = `uniform float time; uniform vec3 col; varying vec3 vN; varying vec3 vW;
  void main(){ float f = pow(1.0 - abs(vN.z), 2.0); float scan = 0.55 + 0.45 * step(0.5, fract(vW.y * 9.0 - time * 2.0));
  gl_FragColor = vec4(col * (0.35 + 1.6 * f) * scan, 0.18 + 0.6 * f); }`;

export class PaceCar {
  constructor(scene) {
    this.scene = scene; this.active = false; this.group = null;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.dir = new THREE.Vector3();
    this.speed = 0; this.target = 50; this.t = 0; this.stallT = 0;
    this.wake = { pos: this.pos, vel: this.vel, hw: 1.0 };
  }
  build() {
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { time: { value: 0 }, col: { value: new THREE.Color('#5fe4ff') } } });
    this.group = new THREE.Group();
    this.group.add(new THREE.Mesh(makeBodyGeometry(), this.mat), new THREE.Mesh(makeCanopyGeometry(), this.mat));
    for (const [x, z] of [[0.86, 1.36], [-0.86, 1.36], [0.88, -1.34], [-0.88, -1.34]]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 20), this.mat); w.rotation.y = Math.PI / 2; w.position.set(x, -0.08, z); this.group.add(w);
    }
    this.group.traverse(o => { o.renderOrder = 6; });
  }
  // start 22 m ahead of the car on its heading
  spawn(vehicle, mph) {
    if (!this.group) this.build();
    const yaw = Math.atan2(vehicle.fwd.x, vehicle.fwd.z);
    this.dir.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.pos.copy(vehicle.pos).addScaledVector(this.dir, 22);
    this.speed = Math.max(0, vehicle.vel.dot(this.dir));
    this.target = mph / 2.23694;
    this.t = 0; this.active = true;
    this.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.scene.add(this.group);
  }
  // EMP: the motor cuts out and it coasts to a stop, then drives on
  stall(sec) { this.stallT = sec; }
  despawn() { this.active = false; if (this.group) this.scene.remove(this.group); }
  // called every physics step so it stays in sync with the car
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    if (this.stallT > 0) this.stallT -= dt;
    const want = this.stallT > 0 ? 0 : this.target;
    this.speed += Math.max(-8 * dt, Math.min(7 * dt, want - this.speed));
    this.pos.addScaledVector(this.dir, this.speed * dt);
    const probe = this.pos.clone(); probe.y += 4;
    const d = groundBelow(probe, 30);
    if (d !== Infinity) this.pos.y = probe.y - d + 0.44;
    this.vel.copy(this.dir).multiplyScalar(this.speed);
    this.group.position.copy(this.pos);
    this.mat.uniforms.time.value = this.t;
    this.mat.uniforms.col.value.set(this.stallT > 0 && Math.random() < 0.5 ? '#1b3a44' : '#5fe4ff');
    if (this.t > 90 || Math.hypot(this.pos.x, this.pos.z) > 1700) this.despawn();
  }
}
