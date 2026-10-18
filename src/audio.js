// Synthesized sound (no audio files): electric motor whine, cold-gas thruster hiss/roar,
// fan, tire squeal, wind, explosions, impacts, rocket launches and UI chimes.
export class Sound {
  constructor() { this.ctx = null; this.volume = 0.7; this.muted = false; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // brown noise for rumbles
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }

    const loopNoise = (buf, type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { f, g };
    };
    // motor: two detuned oscillators through a lowpass
    this.m1 = ctx.createOscillator(); this.m1.type = 'sawtooth';
    this.m2 = ctx.createOscillator(); this.m2.type = 'sine';
    this.mf = ctx.createBiquadFilter(); this.mf.type = 'lowpass'; this.mf.frequency.value = 1200; this.mf.Q.value = 2;
    this.mg = ctx.createGain(); this.mg.gain.value = 0;
    this.m1.connect(this.mf); this.m2.connect(this.mf); this.mf.connect(this.mg); this.mg.connect(this.master);
    this.m1.start(); this.m2.start();
    this.thr = loopNoise(this.noise, 'bandpass', 1400, 0.5);
    this.roar = loopNoise(this.brown, 'lowpass', 500, 0.7);
    this.fan = loopNoise(this.noise, 'highpass', 2500, 0.7);
    this.wind = loopNoise(this.noise, 'lowpass', 350, 0.5);
    this.tire = loopNoise(this.noise, 'bandpass', 950, 6);
    this.hiss = loopNoise(this.noise, 'highpass', 4000, 0.5);
    this.scrape = loopNoise(this.noise, 'bandpass', 2600, 3);
    this.leak = loopNoise(this.noise, 'highpass', 6000, 0.7);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05); }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }

  update(s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, k = 0.06;
    const sp = Math.abs(s.speed);
    const load = Math.min(1, Math.abs(s.powerKW) / 900);
    this.m1.frequency.setTargetAtTime(60 + sp * 11, t, k);
    this.m2.frequency.setTargetAtTime(120 + sp * 22, t, k);
    this.mf.frequency.setTargetAtTime(500 + sp * 30 + load * 1500, t, k);
    this.mg.gain.setTargetAtTime(s.paused ? 0 : (0.012 + load * 0.05) * Math.min(1, 0.25 + sp / 15), t, k);
    const thrust = Math.min(1, s.liftN / 60000), boost = Math.min(1, s.rearN / 80000);
    this.thr.g.gain.setTargetAtTime(s.paused ? 0 : thrust * 0.35 + boost * 0.25, t, 0.03);
    this.thr.f.frequency.setTargetAtTime(900 + thrust * 900 + boost * 600, t, 0.05);
    this.roar.g.gain.setTargetAtTime(s.paused ? 0 : boost * 0.9 + thrust * 0.35, t, 0.03);
    this.fan.g.gain.setTargetAtTime(s.paused ? 0 : s.fan * 0.05, t, 0.1);
    this.fan.f.frequency.setTargetAtTime(2000 + s.fan * 2500, t, 0.1);
    this.wind.g.gain.setTargetAtTime(s.paused ? 0 : Math.min(0.5, (sp / 90) ** 2 * 0.5), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(250 + sp * 8, t, 0.1);
    this.tire.g.gain.setTargetAtTime(s.paused ? 0 : Math.min(0.22, s.slip * 0.22), t, 0.05);
    this.hiss.g.gain.setTargetAtTime(s.paused ? 0 : (s.refill ? 0.08 : 0), t, 0.1);
    this.scrape.g.gain.setTargetAtTime(s.paused ? 0 : Math.min(0.25, (s.scrape || 0) * 0.25), t, 0.04);
    this.leak.g.gain.setTargetAtTime(s.paused ? 0 : Math.min(0.12, (s.leak || 0) * 0.1), t, 0.1);
  }

  oneShot(buf, type, freq, gain, dur, opts = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buf;
    if (opts.rate) src.playbackRate.value = opts.rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g);
    if (opts.pan !== undefined && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = opts.pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }
  tone(freq, dur, gain = 0.15, type = 'sine', when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  // maxDelay: Physics 2.0 lets the boom arrive with the shockwave (up to 3 s away)
  explosion(dist, pan = 0, maxDelay = 0.6) {
    if (!this.ctx) return;
    const a = Math.min(1, 40 / Math.max(10, dist));
    const delay = Math.min(maxDelay, dist / 343);
    setTimeout(() => {
      this.oneShot(this.brown, 'lowpass', 900, 1.6 * a, 2.2, { sweep: 120, pan });
      this.oneShot(this.noise, 'lowpass', 3000, 0.7 * a, 0.5, { sweep: 300, pan });
      if (this.ctx) {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
        const g = this.ctx.createGain(); g.gain.setValueAtTime(0.9 * a, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.9);
      }
    }, delay * 1000);
  }
  // metal crumpling in a crash
  crunch(sev) {
    this.oneShot(this.brown, 'lowpass', 300, Math.min(1.4, 0.4 + sev), 0.5);
    this.oneShot(this.noise, 'bandpass', 1100, Math.min(0.6, 0.2 + sev * 0.4), 0.35, { sweep: 400 });
    this.oneShot(this.noise, 'highpass', 3500, Math.min(0.25, sev * 0.2), 0.25);
  }
  glass(dist, n = 12) {
    if (!this.ctx) return;
    const a = Math.min(1, 25 / Math.max(5, dist));
    this.oneShot(this.noise, 'highpass', 5000, 0.5 * a, 0.5);
    for (let i = 0; i < Math.min(6, n / 3); i++) this.tone(2400 + Math.random() * 3000, 0.15 + Math.random() * 0.2, 0.03 * a, 'triangle', Math.random() * 0.25);
  }
  // sounds for the 2.2 arsenal
  gun(kind) {
    if (!this.ctx) return;
    switch (kind) {
      case 'minigun': this.oneShot(this.noise, 'bandpass', 1800, 0.25, 0.06); break;
      case 'shotgun': this.oneShot(this.noise, 'lowpass', 1500, 0.8, 0.35); this.oneShot(this.brown, 'lowpass', 300, 0.6, 0.3); break;
      case 'grenade': case 'clusterbomb': this.oneShot(this.noise, 'lowpass', 700, 0.5, 0.25, { sweep: 200 }); break;
      case 'flame': this.oneShot(this.noise, 'lowpass', 600, 0.12, 0.12); break;
      case 'laser': this.tone(1600 + Math.random() * 200, 0.07, 0.03, 'sawtooth'); break;
      case 'plasma': this.tone(220, 0.5, 0.15, 'square'); this.oneShot(this.noise, 'bandpass', 900, 0.4, 0.5, { sweep: 3000 }); break;
      case 'sniper': this.oneShot(this.noise, 'highpass', 2000, 0.9, 0.3); this.oneShot(this.brown, 'lowpass', 400, 0.9, 0.6); break;
      case 'mines': this.tone(900, 0.08, 0.06, 'square'); break;
      case 'blackhole': this.tone(60, 1.5, 0.3, 'sine'); this.tone(90, 1.5, 0.15, 'sawtooth'); break;
      case 'tesla': for (let i = 0; i < 4; i++) this.tone(2000 + Math.random() * 2000, 0.05, 0.05, 'square', i * 0.03); this.oneShot(this.noise, 'highpass', 4000, 0.4, 0.3); break;
      case 'orbital': this.tone(120, 1.4, 0.2, 'sawtooth'); this.tone(240, 1.4, 0.1, 'sine'); break;
      case 'meteor': this.oneShot(this.brown, 'lowpass', 500, 0.5, 1.5, { sweep: 80 }); break;
      case 'hammer': this.oneShot(this.brown, 'lowpass', 200, 1.4, 0.6); this.oneShot(this.noise, 'bandpass', 500, 0.6, 0.5, { sweep: 120 }); break;
      default: this.launch();
    }
  }
  impact(intensity) { this.oneShot(this.brown, 'lowpass', 400, Math.min(1.2, intensity * 0.12), 0.35); this.oneShot(this.noise, 'bandpass', 1800, Math.min(0.3, intensity * 0.02), 0.12); }
  launch() { this.oneShot(this.noise, 'bandpass', 600, 0.6, 0.7, { sweep: 3000 }); this.oneShot(this.brown, 'lowpass', 300, 0.6, 0.4); }
  pickup() { this.tone(523, 0.15, 0.12, 'triangle'); this.tone(784, 0.25, 0.12, 'triangle', 0.08); this.tone(1046, 0.35, 0.1, 'triangle', 0.16); }
  ring() { this.tone(880, 0.2, 0.12, 'sine'); this.tone(1320, 0.3, 0.1, 'sine', 0.06); }
  record() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 0.1, 'triangle', i * 0.07)); }
  whoosh() { this.oneShot(this.noise, 'bandpass', 500, 0.5, 0.9, { sweep: 2600 }); }
  // Good Luck menu silly sounds
  sweep(f0, f1, dur, gain, type = 'sine', when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  honk() { this.sweep(520, 760, 0.16, 0.16, 'square'); this.sweep(760, 470, 0.22, 0.16, 'square', 0.17); }
  fart() { const p = 0.8 + Math.random() * 0.5; this.sweep(95 * p, 55 * p, 0.42, 0.22, 'sawtooth'); this.oneShot(this.brown, 'lowpass', 260 * p, 0.5, 0.4, { sweep: 90 }); }
  boing() { this.sweep(180, 620, 0.28, 0.14, 'sine'); this.sweep(240, 900, 0.22, 0.05, 'triangle', 0.03); }
  click() { this.tone(1400, 0.05, 0.05, 'square'); }
  warn() { this.tone(440, 0.12, 0.08, 'square'); this.tone(440, 0.12, 0.08, 'square', 0.18); }
}
