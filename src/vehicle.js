// Roadster rigid-body physics: raycast suspension, slip-based tires, three-motor drivetrain,
// fan suction, ten cold-gas thrusters and a flight controller (assist) that mixes them.
import * as THREE from 'three';
import { raycast, pointContact, makeHit } from './colliders.js';
import { PHYS } from './config.js';

const { G, RHO } = PHYS;
const UP = new THREE.Vector3(0, 1, 0);

// scratch
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _r = new THREE.Vector3(), _f = new THREE.Vector3(), _l = new THREE.Vector3(), _vp = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qe = new THREE.Quaternion(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _res = makeHit();

function pac(alpha, C = 1.6) { return Math.sin(C * Math.atan(10 * alpha)); }

export class Vehicle {
  constructor() {
    this.pos = new THREE.Vector3(0, 1, 0);
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.left = new THREE.Vector3(1, 0, 0);
    this.Ib = new THREE.Vector3();

    const R = PHYS.WHEEL_R;
    this.wheels = [
      { name: 'FL', mount: new THREE.Vector3(0.86, 0.15, 1.36), front: true, side: 1 },
      { name: 'FR', mount: new THREE.Vector3(-0.86, 0.15, 1.36), front: true, side: -1 },
      { name: 'RL', mount: new THREE.Vector3(0.88, 0.15, -1.34), front: false, side: 1 },
      { name: 'RR', mount: new THREE.Vector3(-0.88, 0.15, -1.34), front: false, side: -1 },
    ].map(w => Object.assign(w, {
      radius: R, comp: 0, prevComp: 0, contact: false, hit: makeHit(), steer: 0, spin: 0, spinVel: 0,
      load: 0, slipLat: 0, slipLong: 0, sliding: 0, surface: 'asphalt', contactPoint: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0),
      centerLocalY: 0.15 - PHYS.REST,
    }));

    // hull points for body contacts (local)
    this.hull = [
      [0.85, -0.27, 1.85], [-0.85, -0.27, 1.85], [0.85, -0.27, -1.85], [-0.85, -0.27, -1.85],
      [0, -0.2, 2.2], [0.55, -0.1, 2.12], [-0.55, -0.1, 2.12],
      [0.7, -0.05, -2.12], [-0.7, -0.05, -2.12], [0, 0.35, -2.15],
      [0.98, 0.0, 0], [-0.98, 0.0, 0], [0.95, 0.25, 1.4], [-0.95, 0.25, 1.4], [0.98, 0.35, -1.3], [-0.98, 0.35, -1.3],
      [0.5, 0.7, 0.1], [-0.5, 0.7, 0.1], [0, 0.73, -0.4], [0, 0.6, 0.8], [0.45, 0.45, -1.0], [-0.45, 0.45, -1.0],
      [0, -0.28, 0],
    ].map(a => new THREE.Vector3(...a));

    this.steer = 0;
    this.steerIn = 0;
    this.steerSens = 1;
    this.esc = true;
    this.hack = { grip: 1, power: 1, topSpeed: 1, thrust: 1, gravity: 1, infiniteAir: false, noFlip: false, stickyFan: false, ghost: false, rollAnyTrim: false, scale: 1 };
    this.fan = { mode: 'auto', level: 0, force: 0, seal: 0 };
    this.assist = true;
    this.flightMode = false;
    this.airborneTime = 0;
    this.groundedTime = 0;
    this.idleLowTime = 0;
    this.agl = 0;
    this.aglTimer = 0;
    this.contacts = 0;
    this.nAvg = new THREE.Vector3(0, 1, 0);
    this.gForce = new THREE.Vector2();
    this.gTotal = 1;
    this.prevVel = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.powerKW = 0;
    this.thrustN = 0;
    this.drivePowerKW = 0;
    this.wheelspin = 0;
    this.braking = false;
    this.events = [];
    this.handbrake = false;
    this.sandbox = false;
    this.air = 0;
    this.airUse = 0; // kg/s
    this.headingHold = 0;
    this.setTrim({ dryMass: 1800, airMax: 250, rearThrust: 20000, liftThrust: 15000, sideThrust: 6000 });
  }

  setTrim(trim) {
    this.trim = trim;
    this.air = trim.airMax;
    const mk = (group, pos, dir, max) => ({ group, pos: new THREE.Vector3(...pos), dir: new THREE.Vector3(...dir).normalize(), max, cmd: 0, u: 0 });
    this.thrusters = [];
    if (trim.rearThrust) {
      this.thrusters.push(
        mk('rear', [0.32, -0.12, -2.16], [0, 0, 1], trim.rearThrust), mk('rear', [-0.32, -0.12, -2.16], [0, 0, 1], trim.rearThrust),
        mk('rear', [0.62, 0.12, -2.12], [0, 0, 1], trim.rearThrust), mk('rear', [-0.62, 0.12, -2.12], [0, 0, 1], trim.rearThrust));
    }
    if (trim.liftThrust) {
      this.thrusters.push(
        mk('lift', [0.75, -0.26, 1.45], [0, 1, 0], trim.liftThrust), mk('lift', [-0.75, -0.26, 1.45], [0, 1, 0], trim.liftThrust),
        mk('lift', [0.75, -0.26, -1.45], [0, 1, 0], trim.liftThrust), mk('lift', [-0.75, -0.26, -1.45], [0, 1, 0], trim.liftThrust));
    }
    if (trim.sideThrust) {
      this.thrusters.push(
        mk('side', [0.96, 0.05, 1.75], [-1, 0, 0], trim.sideThrust), // left side, pushes right
        mk('side', [-0.96, 0.05, 1.75], [1, 0, 0], trim.sideThrust)); // right side, pushes left
    }
    this.baseThr = null;
    if (this.hack && this.hack.scale !== 1) { this.baseThr = this.thrusters.map(t => t.pos.clone()); this.thrusters.forEach(t => t.pos.multiplyScalar(this.hack.scale)); }
    this.lift = this.thrusters.filter(t => t.group === 'lift');
    this.side = this.thrusters.filter(t => t.group === 'side');
    this.rear = this.thrusters.filter(t => t.group === 'rear');
    this.updateMass();
  }

  setScale(sc) {
    if (!this.base) this.base = { mounts: this.wheels.map(w => w.mount.clone()), hull: this.hull.map(h => h.clone()) };
    this.hack.scale = sc;
    this.wheels.forEach((w, i) => w.mount.copy(this.base.mounts[i]).multiplyScalar(sc));
    this.hull.forEach((h, i) => h.copy(this.base.hull[i]).multiplyScalar(sc));
    if (!this.baseThr || this.baseThr.length !== this.thrusters.length) this.baseThr = this.thrusters.map(t => t.pos.clone());
    this.thrusters.forEach((t, i) => t.pos.copy(this.baseThr[i]).multiplyScalar(sc));
    this.updateMass();
  }

  // ghost / no-clip: free flight through everything, no physics
  ghostStep(dt, inp) {
    const yawRate = inp.steer * 1.8;
    _q.setFromAxisAngle(UP, yawRate * dt);
    const yaw = Math.atan2(this.fwd.x, this.fwd.z);
    this.quat.setFromAxisAngle(UP, yaw).premultiply(_q);
    const sp = inp.boost ? 90 : 30;
    _a.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(((inp.throttle ? 1 : 0) - (inp.brake ? 1 : 0)) * sp);
    _a.y = ((inp.lift ? 1 : 0) - (inp.descend ? 1 : 0)) * sp * 0.6;
    this.vel.lerp(_a, Math.min(1, dt * 4));
    this.pos.addScaledVector(this.vel, dt);
    this.angVel.set(0, 0, 0);
    this.contacts = 0; this.thrustN = 0; this.airUse = 0; this.fan.force = 0; this.powerKW = 0;
    for (const w of this.wheels) { w.contact = false; w.sliding = 0; }
    for (const t of this.thrusters) { t.u = 0; t.cmd = 0; }
    this.flightMode = false;
  }

  get mass() { return this.trim.dryMass + this.air; }
  get canFly() { return this.lift.length > 0; }

  updateMass() {
    const sc = this.hack ? this.hack.scale : 1, m = this.mass, L = 4.4 * sc, W = 2.0 * sc, H = 1.1 * sc, k = 0.82;
    this.Ib.set(m / 12 * (H * H + L * L) * k, m / 12 * (W * W + L * L) * k, m / 12 * (W * W + H * H) * k);
  }

  reset(pos, yaw) {
    this.pos.copy(pos);
    this.quat.setFromAxisAngle(UP, yaw);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.prevVel.set(0, 0, 0);
    this.flightMode = false; this.airborneTime = 0; this.groundedTime = 0; this.steer = 0; this.steerIn = 0; this.roll = null;
    for (const w of this.wheels) { w.comp = 0; w.prevComp = 0; w.contact = false; w.spinVel = 0; }
    for (const t of this.thrusters) { t.u = 0; t.cmd = 0; }
    this.fan.level = 0;
  }

  addForceAt(F, P) {
    this.force.add(F);
    _r.subVectors(P, this.pos);
    this.torque.x += _r.y * F.z - _r.z * F.y;
    this.torque.y += _r.z * F.x - _r.x * F.z;
    this.torque.z += _r.x * F.y - _r.y * F.x;
  }

  applyImpulse(J, P) {
    const m = this.mass;
    this.vel.addScaledVector(J, 1 / m);
    _r.subVectors(P, this.pos);
    _a.crossVectors(_r, J); // world angular impulse
    _qi.copy(this.quat).invert();
    _a.applyQuaternion(_qi);
    _a.x /= this.Ib.x; _a.y /= this.Ib.y; _a.z /= this.Ib.z;
    _a.applyQuaternion(this.quat);
    this.angVel.add(_a);
  }

  step(dt, inp) {
    const q = this.quat;
    this.fwd.set(0, 0, 1).applyQuaternion(q);
    this.up.set(0, 1, 0).applyQuaternion(q);
    this.left.set(1, 0, 0).applyQuaternion(q);
    const m = this.mass;
    const g = G * this.hack.gravity;
    this.g = g;
    if (this.hack.ghost) { this.ghostStep(dt, inp); return; }
    this.force.set(0, -m * g, 0);
    this.torque.set(0, 0, 0);
    const speedF = this.vel.dot(this.fwd);
    const speed = this.vel.length();

    // ---------- steering ----------
    // keyboard input is progressive: a tap gives a small correction, holding winds it in
    const want = inp.steer * (this.steerSens || 1);
    const reversing = this.steerIn !== 0 && want !== 0 && Math.sign(want) !== Math.sign(this.steerIn);
    const inRate = (reversing ? 9 : (want === 0 ? 7 : 3.2)) * dt;
    this.steerIn += Math.max(-inRate, Math.min(inRate, want - this.steerIn));
    // speed-aware lock: never ask for much more cornering than the tires can give
    const vs = Math.max(Math.abs(speedF), 1);
    const aLat = G * (this.hack.grip > 1.5 ? 2.2 : 1.3);
    const maxSteer = Math.min(0.56, 2.7 * aLat / (vs * vs) + 0.035);
    const steerTarget = this.steerIn * maxSteer;
    const rate = 3.0 * dt;
    this.steer += Math.max(-rate, Math.min(rate, steerTarget - this.steer));

    // ---------- drivetrain request ----------
    let driveCmd = 0, brake = 0;
    if (inp.throttle > 0) {
      if (speedF < -0.6) brake = 1; else driveCmd = inp.throttle;
    }
    if (inp.brake > 0) {
      if (speedF > 0.6) brake = Math.max(brake, inp.brake); else if (!inp.throttle) driveCmd = -0.45 * inp.brake;
    }
    this.braking = brake > 0 || (inp.handbrake && Math.abs(speedF) > 1);
    let motorForce = 0;
    if (driveCmd > 0) {
      const taper = Math.max(0, Math.min(1, (PHYS.VMAX * this.hack.topSpeed - speedF) / 4));
      motorForce = driveCmd * Math.min(PHYS.MOTOR_FORCE * this.hack.power, PHYS.MOTOR_POWER * this.hack.power * this.hack.topSpeed / Math.max(Math.abs(speedF), 0.1)) * taper;
    } else if (driveCmd < 0) {
      const taper = Math.max(0, Math.min(1, (PHYS.REVERSE_VMAX + speedF) / 2));
      motorForce = driveCmd * PHYS.MOTOR_FORCE * 0.6 * taper;
    }
    const regen = (!inp.throttle && !inp.brake && Math.abs(speedF) > 0.3) ? -Math.sign(speedF) * Math.min(4500, Math.abs(speedF) * 1400) : 0;
    const hold = !inp.throttle && !inp.brake && Math.abs(speedF) < 0.4;
    const vec = Math.max(-1, Math.min(1, this.steer / 0.4)) * 0.22;
    const split = [0.18, 0.18, 0.32 * (1 - vec), 0.32 * (1 + vec)];

    // ---------- wheels ----------
    let contacts = 0;
    let curve = null;
    this.nAvg.set(0, 0, 0);
    let drivePower = 0, spin = 0;
    const ray = _d.copy(this.up).negate();
    const sc = this.hack.scale;
    const rayLen = (PHYS.REST + PHYS.WHEEL_R) * sc;
    const loads = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      _a.copy(w.mount).applyQuaternion(q).add(this.pos);
      w.contact = raycast(_a, ray, rayLen, w.hit);
      if (!w.contact) {
        w.comp = 0; w.prevComp = 0; w.load = 0; w.sliding = 0;
        w.spinVel *= 0.995;
        if (driveCmd !== 0 && !w.front) w.spinVel += driveCmd * 60 * dt;
        continue;
      }
      contacts++;
      if (w.hit.col && w.hit.col.kind === 'curve' && w.hit.col.phiMax > 2) curve = w.hit.col;
      const n = w.hit.normal;
      this.nAvg.add(n);
      w.normal.copy(n);
      w.surface = w.hit.surface;
      const comp = rayLen - w.hit.t;
      const compRate = w.prevComp > 0 ? Math.max(-6, Math.min(6, (comp - w.prevComp) / dt)) : 0;
      w.prevComp = comp; w.comp = comp;
      let Fs = PHYS.SPRING * comp + PHYS.DAMP * compRate;
      if (comp > PHYS.TRAVEL * sc) Fs += PHYS.BUMP * (comp - PHYS.TRAVEL * sc) + PHYS.DAMP * 2 * Math.max(0, compRate);
      Fs = Math.max(0, Fs);
      loads[i] = Fs;
    }
    // anti-roll bars
    const arb = 38000;
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const wa = this.wheels[a], wb = this.wheels[b];
      if (wa.contact && wb.contact) {
        const f = (wa.comp - wb.comp) * arb;
        loads[a] = Math.max(0, loads[a] + f); loads[b] = Math.max(0, loads[b] - f);
      }
    }
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) continue;
      const n = w.hit.normal;
      const N = loads[i];
      w.load = N;
      const P = w.hit.point;
      w.contactPoint.copy(P);
      // suspension force applied along normal, slightly above contact to tame rollovers
      _b.copy(P).addScaledVector(n, 0.32 * sc);
      _c.copy(n).multiplyScalar(N);
      this.addForceAt(_c, _b);

      // tire frame
      const st = w.front ? this.steer : 0;
      w.steer = st;
      _f.copy(this.fwd).multiplyScalar(Math.cos(st)).addScaledVector(this.left, Math.sin(st));
      _f.addScaledVector(n, -_f.dot(n)).normalize();
      _l.crossVectors(n, _f);
      _r.subVectors(P, this.pos);
      _vp.crossVectors(this.angVel, _r).add(this.vel);
      const vLong = _vp.dot(_f), vLat = _vp.dot(_l);
      let mu = w.hit.grip * this.hack.grip;
      const rear = !w.front;
      let muLat = rear ? mu * 1.08 : mu;
      if (inp.handbrake && rear) muLat *= 0.42;

      // longitudinal
      let Fx = motorForce * split[i];
      if (rear) Fx += regen * 0.5;
      if (brake > 0) Fx += -Math.max(-1, Math.min(1, vLong * 3)) * brake * (w.front ? 15000 : 11000);
      if (inp.handbrake && rear) Fx += -Math.max(-1, Math.min(1, vLong * 2)) * 9000;
      if (hold) Fx += -Math.max(-1, Math.min(1, vLong * 4)) * 7000;
      const rr = w.surface === 'sand' ? 0.05 : 0.012;
      Fx += -Math.max(-1, Math.min(1, vLong * 2)) * rr * N;
      const limit = mu * N;
      let spinning = 0;
      if (Math.abs(Fx) > limit) { spinning = Math.abs(Fx) / Math.max(1, limit) - 1; Fx = Math.sign(Fx) * limit; }
      // lateral
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 3.5));
      let Fy = -muLat * N * pac(alpha, rear && !inp.handbrake ? 1.35 : 1.6);
      // friction circle
      const tot = Math.hypot(Fx, Fy);
      if (tot > limit && tot > 0) { const s = limit / tot; Fx *= s; Fy *= s; }
      _c.copy(_f).multiplyScalar(Fx).addScaledVector(_l, Fy);
      this.addForceAt(_c, _b);
      if (motorForce * split[i] > 0) drivePower += Fx * vLong;

      w.slipLat = alpha; w.slipLong = spinning;
      w.sliding = Math.min(1, Math.max(0, (Math.abs(alpha) - 0.14) * 4) * Math.min(1, Math.abs(vLat) / 3) + Math.min(1, spinning * 2) * (Math.abs(vLong) < 30 ? 1 : 0.4)
        + (brake > 0.9 && Math.abs(vLong) > 3 && N > 0 && (brake * (w.front ? 15000 : 11000)) > limit ? 0.6 : 0));
      w.spinVel = vLong / (w.radius * sc) + (spinning > 0 ? Math.sign(Fx) * Math.min(80, spinning * 40) : 0);
      if (inp.handbrake && rear) w.spinVel *= 0.1;
      spin = Math.max(spin, spinning);
    }
    this.contacts = contacts;
    if (curve) { this.curve = curve; this.curveT = 0; } else this.curveT = (this.curveT || 0) + dt;
    if (contacts) this.nAvg.normalize(); else this.nAvg.copy(UP);
    this.wheelspin = spin;
    this.drivePowerKW = (drivePower + (contacts ? regen * speedF : 0)) / 1000;

    // ---------- stability control (off while the handbrake is held) ----------
    this.escActive = 0;
    if (contacts >= 3 && !inp.handbrake && Math.abs(speedF) > 4 && this.esc) {
      const r = this.angVel.dot(this.up);
      let rRef = speedF * Math.tan(this.steer) / 2.7;
      const rMax = aLat * 1.1 / vs;
      rRef = Math.max(-rMax, Math.min(rRef, rMax));
      const err = r - rRef;
      const vLatBody = this.vel.dot(this.left);
      const beta = Math.atan2(vLatBody, Math.abs(speedF));
      // oversteer: yawing faster than the driver asked, or the body sliding sideways
      if ((Math.abs(r) > Math.abs(rRef) && Math.sign(err) === Math.sign(r)) || Math.abs(beta) > 0.04) {
        const tq = Math.max(-1, Math.min(1, err * 2.2 + beta * Math.sign(speedF) * 6)) * this.Ib.y * 9;
        this.torque.addScaledVector(this.up, -tq);
        // pull the sideways velocity back in line with the car
        this.force.addScaledVector(this.left, -Math.max(-1, Math.min(1, vLatBody * 0.8)) * this.mass * G * 0.35);
        this.escActive = Math.min(1, Math.abs(err) * 2 + Math.abs(beta) * 8);
      }
    }

    // ---------- grounded / airborne timers ----------
    if (contacts >= 2) { this.groundedTime += dt; this.airborneTime = 0; }
    else if (contacts === 0) { this.airborneTime += dt; this.groundedTime = 0; }

    // ---------- AGL (above ground level) ----------
    this.aglTimer -= dt;
    if (this.aglTimer <= 0) {
      this.aglTimer = 1 / 30;
      _a.copy(this.pos);
      this.agl = raycast(_a, _b.set(0, -1, 0), 600, _res) ? Math.max(0, _res.t - 0.45) : 600;
    }

    // ---------- fan suction ----------
    const fan = this.fan;
    let fanTarget = 0;
    if (fan.mode === 'max') fanTarget = 1;
    else if (fan.mode === 'auto') {
      const tilt = Math.max(0, Math.min(1, (0.88 - this.nAvg.y) * 2.4));
      const launch = inp.throttle > 0.5 && Math.abs(speedF) < 40 ? 0.85 : 0;
      const brk = brake > 0 && speedF > 8 ? 0.8 : 0;
      const corner = Math.min(1, Math.abs(this.gForce.x) / 1.3);
      fanTarget = Math.max(0.12, tilt, launch, brk, corner);
    }
    if (this.hack.stickyFan && fan.mode !== 'off') fanTarget = 1;
    if (inp.lift && this.canFly) fanTarget = 0;
    fan.level += (fanTarget - fan.level) * Math.min(1, dt * 7);
    fan.seal += (contacts / 4 - fan.seal) * Math.min(1, dt * 12);
    if (this.hack.stickyFan && fan.mode !== 'off') fanTarget = 1;
    fan.force = fan.level * fan.seal * PHYS.FAN_MAX * (this.hack.stickyFan ? 3 : 1);
    if (fan.force > 1) {
      _c.copy(this.nAvg).multiplyScalar(-fan.force);
      this.force.add(_c);
    }

    // ---------- aero ----------
    if (speed > 0.1) {
      const al = this.vel.dot(this.fwd) / speed;
      const CdA = 0.52 + 3.6 * (1 - al * al);
      this.force.addScaledVector(this.vel, -0.5 * RHO * CdA * speed);
      if (speedF > 0) this.force.addScaledVector(this.up, -0.5 * RHO * 0.75 * speedF * speedF);
    }
    if (contacts === 0) this.torque.addScaledVector(this.angVel, -650);

    // ---------- flight control ----------
    this.updateThrusterCommands(dt, inp, speedF);

    // ---------- thrusters ----------
    const real = !this.sandbox && !this.hack.infiniteAir;
    const avail = real ? Math.max(0, Math.min(1, this.air / Math.max(1, this.trim.airMax * 0.05))) : 1;
    let thrust = 0;
    for (const t of this.thrusters) {
      const target = t.cmd * avail;
      t.u += (target - t.u) * Math.min(1, dt / 0.035);
      if (t.u < 1e-4) { t.u = 0; continue; }
      const F = t.u * t.max * this.hack.thrust;
      thrust += F;
      _c.copy(t.dir).applyQuaternion(q).multiplyScalar(F);
      _b.copy(t.pos).applyQuaternion(q).add(this.pos);
      this.addForceAt(_c, _b);
    }
    this.thrustN = thrust;
    this.airUse = thrust / PHYS.EXHAUST_V;
    if (real && this.trim.airMax > 0) {
      this.air = Math.max(0, this.air - this.airUse * dt);
      this.updateMass();
    }

    // ---------- body contacts ----------
    let impact = 0;
    for (const hp of this.hull) {
      _a.copy(hp).applyQuaternion(q).add(this.pos);
      let d = pointContact(_a, _res);
      if (d <= 0) continue;
      d = Math.min(d, 0.4);
      const n = _res.normal;
      _r.subVectors(_a, this.pos);
      _vp.crossVectors(this.angVel, _r).add(this.vel);
      const vn = _vp.dot(n);
      let Fn = 260000 * d - 14000 * vn;
      if (Fn <= 0) continue;
      if (-vn > impact) impact = -vn;
      _c.copy(n).multiplyScalar(Fn);
      _b.copy(_vp).addScaledVector(n, -vn); // tangential vel
      const vt = _b.length();
      if (vt > 1e-3) {
        const Ff = Math.min(0.55 * Fn, vt * 9000);
        _c.addScaledVector(_b, -Ff / vt);
      }
      this.addForceAt(_c, _a);
    }
    if (impact > 7) this.events.push({ type: 'impact', speed: impact });

    // ---------- never-flip hack: always rights itself ----------
    if (this.hack.noFlip && !this.roll && this.up.y < 0.85) {
      _a.crossVectors(this.up, UP).multiplyScalar(this.Ib.z * 30);
      this.torque.add(_a).addScaledVector(this.angVel, -this.Ib.z * 4);
    }

    // ---------- integrate ----------
    this.vel.addScaledVector(this.force, dt / m);
    _qi.copy(q).invert();
    _a.copy(this.torque).applyQuaternion(_qi);              // body torque
    _b.copy(this.angVel).applyQuaternion(_qi);              // body omega
    _c.set(this.Ib.x * _b.x, this.Ib.y * _b.y, this.Ib.z * _b.z);
    _a.sub(_d.crossVectors(_b, _c));                        // gyroscopic
    _a.set(_a.x / this.Ib.x, _a.y / this.Ib.y, _a.z / this.Ib.z).applyQuaternion(q);
    this.angVel.addScaledVector(_a, dt);
    const wl = this.angVel.length();
    if (wl > 22) this.angVel.multiplyScalar(22 / wl);
    this.pos.addScaledVector(this.vel, dt);
    const wx = this.angVel.x, wy = this.angVel.y, wz = this.angVel.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w, h = 0.5 * dt;
    q.set(qx + h * (wx * qw + wy * qz - wz * qy), qy + h * (wy * qw + wz * qx - wx * qz), qz + h * (wz * qw + wx * qy - wy * qx), qw + h * (-wx * qx - wy * qy - wz * qz)).normalize();

    // ---------- telemetry ----------
    this.accel.subVectors(this.vel, this.prevVel).divideScalar(dt);
    this.prevVel.copy(this.vel);
    _a.copy(this.accel); _a.y += G; // felt acceleration
    const k = Math.min(1, dt * 10);
    this.gForce.x += (_a.dot(this.left) / G - this.gForce.x) * k;
    this.gForce.y += (_a.dot(this.fwd) / G - this.gForce.y) * k;
    this.gTotal += (_a.length() / G - this.gTotal) * k;
    this.powerKW = this.drivePowerKW + fan.level * 180 * (fan.seal > 0.1 ? 1 : 0.3);
  }

  updateThrusterCommands(dt, inp, speedF) {
    for (const t of this.thrusters) t.cmd = 0;
    const hasAir = this.sandbox || this.hack.infiniteAir || this.air > 0.5;
    for (const t of this.rear) t.cmd = inp.boost && hasAir ? 1 : 0;

    // ---------- barrel roll (Q / E in the air) ----------
    if (inp.rollTap && this.contacts === 0 && !this.roll && (this.canFly ? hasAir : this.hack.rollAnyTrim)) {
      this.roll = { dir: inp.rollTap, angle: 0, t: 0 };
      this.events.push({ type: 'barrelroll', dir: inp.rollTap });
    }
    if (this.roll) {
      const R = this.roll;
      R.t += dt;
      const w = this.angVel.dot(this.fwd);
      R.angle += w * dt * R.dir;
      if (R.angle >= Math.PI * 2 - 0.35 || R.t > 1.6 || this.contacts >= 2) this.roll = null;
    }
    if (this.roll && (!this.canFly || this.hack.rollAnyTrim && !this.canFly)) {
      // trims without lift thrusters (hack): spin the car directly
      const wCmd = this.roll.dir * 7.6;
      const err = wCmd - this.angVel.dot(this.fwd);
      this.torque.addScaledVector(this.fwd, err * this.Ib.z * 14);
      return;
    }
    if (!this.canFly) return;

    if (inp.lift && hasAir) this.flightMode = true;
    if (this.flightMode && this.contacts >= 3 && !inp.lift && this.groundedTime > 0.3 && Math.abs(this.vel.y) < 1.5) this.flightMode = false;
    if (!hasAir) this.flightMode = false;
    const airborne = this.contacts === 0 && this.airborneTime > 0.25;
    if (!this.flightMode && !(airborne && this.assist) && !this.roll) return;

    const m = this.mass, q = this.quat, up = this.up;
    const pitchIn = (inp.throttle > 0 ? 1 : 0) - (inp.brake > 0 ? 1 : 0);
    const yawIn = inp.steer;           // +1 = left
    const rollIn = inp.roll;           // +1 = right
    let Fc = 0;
    _a.set(0, 0, 0); // desired angular accel (world)

    if (this.assist) {
      // heading from forward vector
      let hx = this.fwd.x, hz = this.fwd.z;
      if (Math.hypot(hx, hz) < 0.25) { hx = -this.up.x * Math.sign(this.fwd.y || 1); hz = -this.up.z * Math.sign(this.fwd.y || 1); }
      const yaw = Math.atan2(hx, hz);
      let pitchT = 0, rollT = 0, yawRate = yawIn * 1.5;
      if (this.flightMode) {
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const vF = this.vel.x * sy + this.vel.z * cy;
        const vL = this.vel.x * cy - this.vel.z * sy;
        if (pitchIn) pitchT = pitchIn * 0.42;
        else if (!inp.boost) pitchT = Math.atan(Math.max(-4.5, Math.min(4.5, -vF * 0.55)) / G);
        if (rollIn) rollT = rollIn * 0.42;
        else rollT = -Math.atan(Math.max(-4.5, Math.min(4.5, -vL * 0.55)) / G);
      } else {
        pitchT = pitchIn * 0.6; rollT = rollIn * 0.6;
      }
      _e.set(pitchT, yaw, rollT, 'YXZ');
      _qt.setFromEuler(_e);
      _qe.copy(_qt).multiply(_qi.copy(q).invert());
      if (_qe.w < 0) { _qe.x = -_qe.x; _qe.y = -_qe.y; _qe.z = -_qe.z; _qe.w = -_qe.w; }
      const ang = 2 * Math.acos(Math.min(1, _qe.w));
      const s = Math.sqrt(Math.max(0, 1 - _qe.w * _qe.w));
      if (s > 1e-5) _a.set(_qe.x / s, _qe.y / s, _qe.z / s).multiplyScalar(ang);
      // strip the yaw part of the error (yaw is rate-controlled)
      _a.y = 0;
      const wn = this.flightMode ? 6.5 : 5, Kp = wn * wn, Kd = 2 * 0.9 * wn;
      _a.multiplyScalar(Kp);
      _b.copy(this.angVel); _b.y -= yawRate;
      _a.addScaledVector(_b, -Kd);

      if (this.flightMode) {
        let vzCmd = 0;
        const noInput = !inp.lift && !inp.descend && !pitchIn && !rollIn && !yawIn && !inp.boost;
        if (inp.lift) vzCmd = 8 * Math.min(1, Math.sqrt(this.hack.gravity));
        else if (inp.descend) vzCmd = -Math.min(7, 0.9 + this.agl * 0.5);
        if (noInput && this.agl < 2.2) { this.idleLowTime += dt; if (this.idleLowTime > 1.0) vzCmd = -1.2; } else this.idleLowTime = 0;
        if (!this.sandbox && this.air < this.trim.airMax * 0.12 && !inp.lift) vzCmd = Math.min(vzCmd, -Math.min(4, 0.8 + this.agl * 0.3));
        let az = this.g + 3.2 * (vzCmd - this.vel.y);
        az = Math.max(0, Math.min(3 * G * this.hack.thrust, az));
        Fc = up.y > 0.25 ? m * az / Math.max(up.y, 0.55) : 0;
      }
    } else {
      // manual rate mode
      _b.set(pitchIn * 2.2, yawIn * 1.8, rollIn * 2.6).applyQuaternion(q); // body rates -> world
      _a.subVectors(_b, this.angVel).multiplyScalar(8);
      if (inp.lift) Fc = 0.85 * 4 * this.trim.liftThrust * this.hack.thrust;
    }

    if (this.roll) {
      const wCmd = this.roll.dir * 7.6;
      _b.copy(this.fwd).multiplyScalar(wCmd);
      _a.subVectors(_b, this.angVel).multiplyScalar(12);
      // keep lifting only while the thrusters point roughly up
      if (this.flightMode && up.y < 0.3) Fc = 0;
    }
    // world angular accel -> body torque
    _qi.copy(q).invert();
    _a.applyQuaternion(_qi);
    const tx = _a.x * this.Ib.x, ty = _a.y * this.Ib.y, tz = _a.z * this.Ib.z;

    // mixer for the four lift thrusters
    const fmax = this.trim.liftThrust * this.hack.thrust;
    const d = [];
    let lo = -Infinity, hi = Infinity;
    for (const t of this.lift) {
      const x = t.pos.x, z = t.pos.z;
      const di = -tx * z / (4 * 1.45 * 1.45) + tz * x / (4 * 0.75 * 0.75);
      d.push(di);
    }
    let scale = 1;
    const dmax = Math.max(...d), dmin = Math.min(...d);
    if (dmax - dmin > fmax) scale = fmax / (dmax - dmin);
    for (let i = 0; i < 4; i++) { d[i] *= scale; lo = Math.max(lo, -d[i]); hi = Math.min(hi, fmax - d[i]); }
    const c = Math.max(lo, Math.min(hi, Fc / 4));
    for (let i = 0; i < 4; i++) this.lift[i].cmd = Math.max(0, Math.min(1, (c + d[i]) / fmax));
    // yaw thrusters
    const sf = this.trim.sideThrust * this.hack.thrust;
    if (ty > 0) this.side[1].cmd = Math.min(1, ty / 1.75 / sf);
    else this.side[0].cmd = Math.min(1, -ty / 1.75 / sf);
  }
}
