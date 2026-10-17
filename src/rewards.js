// Credits for stunts: flips and barrel rolls (paid on a clean landing), the Loop of Death, the demo-ramp
// flip, wall rides, and destruction (paid in one lump once the dust settles). Jumps, 0-60, the quarter
// mile and rings are paid where main.js already times them.
import { EARN } from './garage.js';

const TWO_PI = Math.PI * 2;

export class Rewards {
  constructor(profile, notify) {
    this.p = profile;
    this.notify = notify;    // (text, credits) => void
    this.reset();
    this.paid = { blocks: 0, barrels: 0, targets: 0 };
    this.dT = 0;
  }
  reset() {
    this.air = { pitch: 0, roll: 0 };
    this.loop = null; this.demo = null; this.wall = 0; this.wallGap = 0;
  }
  // every physics step
  step(v, dt) {
    if (v.contacts === 0) {
      this.air.pitch += v.angVel.dot(v.left) * dt;
      this.air.roll += v.angVel.dot(v.fwd) * dt;
    }
    // loop / demo ramp: watch the car while it is on the big curves
    const c = v.curve && v.curveT < 0.1 ? v.curve : null;
    if (c && c.phiMax > 5) { if (!this.loop) this.loop = { minUp: 1 }; this.loop.minUp = Math.min(this.loop.minUp, v.up.y); }
    else if (this.loop && v.curveT > 0.8) {
      if (this.loop.minUp < -0.9 && v.contacts >= 3 && v.up.y > 0.8) this.pay(EARN.loop, 'Loop of Death');
      this.loop = null;
    }
    if (c && c.phiMax > 2 && c.phiMax <= 5) { this.demo = { minUp: Math.min(this.demo ? this.demo.minUp : 1, v.up.y), left: 0 }; }
    else if (this.demo) {
      this.demo.left += dt;
      if (this.demo.minUp < -0.5 && v.contacts >= 3 && v.up.y > 0.9 && this.demo.left > 0.5) { this.pay(EARN.demo, 'Demo-ramp flip'); this.demo = null; }
      else if (this.demo.left > 15 || (this.demo.minUp >= -0.5 && this.demo.left > 1)) this.demo = null;
    }
    // wall ride: wheels on a vertical surface at speed
    if (!c && v.contacts >= 2 && Math.abs(v.up.y) < 0.4 && v.vel.length() > 8) { this.wall += dt; this.wallGap = 0; }
    else if (this.wall > 0) {
      this.wallGap += dt;
      if (this.wallGap > 0.4 || v.up.y > 0.8) {
        if (this.wall > 1.5) this.pay(EARN.wallPerS * this.wall, `Wall ride ${this.wall.toFixed(1)} s`);
        this.wall = 0;
      }
    }
  }
  // landing after a jump or flight: count full flips / rolls; clean landing pays
  land(v) {
    const flips = Math.floor((Math.abs(this.air.pitch) + 0.6) / TWO_PI), rolls = Math.floor((Math.abs(this.air.roll) + 0.6) / TWO_PI);
    this.air.pitch = 0; this.air.roll = 0;
    const n = flips + rolls;
    if (!n) return { credits: 0, text: '' };
    const parts = [];
    if (flips) parts.push(flips === 1 ? 'flip' : `${flips} flips`);
    if (rolls) parts.push(rolls === 1 ? 'barrel roll' : `${rolls} barrel rolls`);
    if (v.up.y < 0.7) return { credits: 0, text: ` · ${parts.join(' + ')} (bailed)` };
    return { credits: n * EARN.flip, text: ' · ' + parts.join(' + ') };
  }
  // destruction: pay once nothing new has broken for a moment
  destruction(d, dt) {
    const s = d.score, pd = this.paid;
    const nb = s.blocks - pd.blocks, nr = s.barrels - pd.barrels, nt = s.targets - pd.targets;
    if (nb < 0 || nr < 0 || nt < 0) { Object.assign(pd, s); return; }
    if (!nb && !nr && !nt) { this.dT = 0; return; }
    if (this.last !== nb + nr * 1000 + nt * 1e6) { this.last = nb + nr * 1000 + nt * 1e6; this.dT = 0; return; }
    this.dT += dt;
    if (this.dT < 1.2) return;
    Object.assign(pd, { blocks: s.blocks, barrels: s.barrels, targets: s.targets });
    this.last = 0;
    const bits = [];
    if (nb) bits.push(`${nb} block${nb > 1 ? 's' : ''}`);
    if (nr) bits.push(`${nr} barrel${nr > 1 ? 's' : ''}`);
    if (nt) bits.push(`${nt} car${nt > 1 ? 's' : ''}`);
    this.pay(nb * EARN.block + nr * EARN.barrel + nt * EARN.car, 'Destruction: ' + bits.join(' · '));
  }
  pay(n, text) { const got = this.p.earn(n); if (got) this.notify(text, got); return got; }
}
