// Physics 2.0 building blocks used by the car (and the tests): tire heat / wear / pressure,
// angle-dependent aerodynamics, wind gusts, slipstream wakes, the air tank as a real gas and
// per-thruster valve behaviour. The Classic switch (vehicle.phys2 = false) bypasses all of it.
import * as THREE from 'three';

export const AMBIENT_C = 28;                 // desert air and road temperature
export const AMBIENT_K = AMBIENT_C + 273.15;

// ---------- tires ----------
export const TIRE = {
  C: 2200,          // J/K, effective heat capacity of tread + carcass
  heatShare: 0.45,  // share of sliding power that ends up in the tire (the rest heats the road)
  roll: 0.0075,     // flexing heat while rolling, as a share of load x speed
  hA0: 37,          // W/K convective cooling when standing still
  hAv: 3.7,         // W/K extra cooling per m/s of speed
  road: 25,         // W/K conduction into the road while touching it
  wearK: 1.2e-7,    // tread used per joule of sliding
  coldPsi: 36,
};

// grip vs tread temperature: 1.0 at ambient, best (+5 %) from 70 to 110 °C, slippery when overheated
export function tireTempGrip(T) {
  if (T <= AMBIENT_C) return Math.max(0.9, 1 - (AMBIENT_C - T) * 0.002);
  if (T < 70) return 1 + 0.05 * (T - AMBIENT_C) / (70 - AMBIENT_C);
  if (T <= 110) return 1.05;
  if (T < 140) return 1.05 - 0.09 * (T - 110) / 30;
  if (T < 180) return 0.96 - 0.14 * (T - 140) / 40;
  return Math.max(0.68, 0.82 - 0.12 * (T - 180) / 50);
}
export const tireWearGrip = (wear) => 1 - 0.25 * Math.pow(wear, 1.5);
// pressure follows the gas law with tread temperature; only over-inflation costs grip
export const tirePressure = (T) => TIRE.coldPsi * (T + 273.15) / AMBIENT_K;
export const tirePressureGrip = (psi) => 1 - 0.003 * Math.max(0, psi - 42);

export function freshTire(w) {
  w.temp = AMBIENT_C; w.wear = 0; w.psi = TIRE.coldPsi; w.flat = 0; w.bend = 0; w.broken = false;
  w.gripF = 1; w.slipPower = 0; w.vLong = 0;
}

// one tire's heat, wear and pressure for this step; w.slipPower and w.load were set by the force code
export function updateTire(w, dt, speed, heatMul, wearMul, noHeat) {
  const T = w.temp;
  if (noHeat) w.temp = AMBIENT_C;
  else {
    const Q = w.contact ? TIRE.heatShare * w.slipPower + TIRE.roll * w.load * Math.abs(w.vLong) : 0;
    const hA = TIRE.hA0 + TIRE.hAv * speed + (w.contact ? TIRE.road : 0);
    w.temp += (Q * heatMul - hA * (T - AMBIENT_C)) * dt / TIRE.C;
  }
  const hot = Math.max(0, (T - 120) / 40);
  w.wear = Math.min(1, w.wear + w.slipPower * TIRE.wearK * wearMul * (1 + hot * hot) * dt);
  w.psi = tirePressure(w.temp) * (1 - w.flat);
  w.gripF = tireTempGrip(w.temp) * tireWearGrip(w.wear) * tirePressureGrip(w.psi) * (1 - 0.45 * w.flat) * (1 - 0.25 * Math.min(1, w.bend));
}

// ---------- aerodynamics ----------
export const AERO = {
  cdFront: 0.52,    // CdA m², nose into the wind (same as Classic)
  cdSide: 4.12,     // broadside (same as Classic)
  cdTop: 5.2,       // falling flat
  cla0: 0.75,       // downforce CL·A when level (same as Classic)
  claSlope: 2.6,    // how fast downforce turns into lift as the nose rises
  xcp: 0.2,         // m ahead of the centre of mass where the extra lift acts
  damp: 10,         // N·m·s per (m/s · rad/s): pitch / yaw damping from the airflow while airborne
};
// lift (+) or downforce (-) area for an angle of attack (rad, nose up = +)
export function liftArea(alpha) {
  const c = Math.cos(alpha), s = Math.sin(alpha);
  return -AERO.cla0 * c * c + AERO.claSlope * s * c;
}

// ---------- wind ----------
// A steady breeze whose direction drifts, plus gust fronts carried along by it. Pure function of
// position and time (frozen turbulence), so it is smooth, the same everywhere and costs nothing.
export class Wind {
  constructor() { this.t = 0; this.scale = 1; this.dir = 0.7; this.base = 3; this.gustMax = 9; }
  update(dt) { this.t += dt; }
  sample(x, z, agl, out) {
    const t = this.t;
    if (this.scale <= 0) return out.set(0, 0, 0);
    const dir = this.dir + 0.6 * Math.sin(t * 0.011) + 0.25 * Math.sin(t * 0.037 + 1.3);
    const base = this.base + 1.2 * Math.sin(t * 0.05 + 0.4);
    const cx = Math.sin(dir), cz = Math.cos(dir);
    // gust pattern drifts downwind
    const X = x - cx * base * t, Z = z - cz * base * t;
    const s = 0.5 * Math.sin(0.021 * X + 0.4 * Math.sin(0.013 * Z) + 0.17 * t)
      + 0.35 * Math.sin(0.034 * Z - 0.023 * X + 0.29 * t + 1.3)
      + 0.25 * Math.sin(0.057 * (X + Z) + 0.51 * t + 2.1);
    const k = Math.max(0, Math.min(1, (s - 0.35) / 0.65));
    const gust = this.gustMax * k * k * (3 - 2 * k);
    const ga = dir + 0.4 * Math.sin(0.009 * X + t * 0.2);
    const h = 1 + 0.12 * Math.log(1 + Math.max(0, agl) / 3);
    out.set((cx * base + Math.sin(ga) * gust) * h * this.scale, 0, (cz * base + Math.cos(ga) * gust) * h * this.scale);
    return out;
  }
  // 0..1 how gusty it is right now at a point (for dust effects / HUD)
  gustiness(x, z) { const v = this.sample(x, z, 0, _w); return Math.max(0, Math.min(1, (v.length() / this.scale - this.base - 1) / this.gustMax)); }
}
const _w = new THREE.Vector3();

// shared world state the car reads: wind and the wakes of moving cars (slipstream)
export const env = { wind: new Wind(), wakes: [] };

// ---------- slipstream ----------
// wake = { pos, vel, hw } of a moving car. Returns how much of the frontal drag disappears (0..0.45).
const _d = new THREE.Vector3();
export function draftFactor(pos, vel, wakes) {
  let best = 0;
  const sp = vel.length();
  if (sp < 5 || !wakes.length) return 0;
  for (const k of wakes) {
    const ks = k.vel.length();
    if (ks < 5) continue;
    const dx = k.vel.x / ks, dy = k.vel.y / ks, dz = k.vel.z / ks;
    _d.subVectors(pos, k.pos);
    const behind = -(_d.x * dx + _d.y * dy + _d.z * dz);
    const len = 8 + ks * 0.6;
    if (behind < 1.5 || behind > len) continue;
    const lx = _d.x + dx * behind, ly = _d.y + dy * behind, lz = _d.z + dz * behind;
    const lat = Math.hypot(lx, ly * 1.5, lz);
    const wr = (k.hw || 1) * (1 + behind / 25);
    const along = (vel.x * dx + vel.y * dy + vel.z * dz) / sp;   // only helps when going the same way
    const f = Math.exp(-((lat / wr) ** 2)) * (1 - behind / len) * Math.min(1, ks / 20) * Math.max(0, along);
    if (f > best) best = f;
  }
  return Math.min(0.45, 0.5 * best);
}

// ---------- air tank as a real gas ----------
export const GAS = {
  R: 287, gamma: 1.4,
  Zk: 0.00042,       // compressibility: real air at 5,500 psi is ~16 % stiffer than ideal
  psiFull: 5500,     // reveal spec, full tank at ambient temperature
  PSI: 6894.76,
  regPsi: 300,       // thruster feed regulator: below this tank pressure, thrust fades (last ~10 %)
  wallTau: 5,        // s, how fast the tank walls warm the gas back up
  Tmin: 180,         // K, gas can't get colder than this in practice (-93 °C)
  fillT: 262,        // K, effective temperature of air pumped in (compression heats the tank)
  ve0: 650,          // m/s exhaust velocity of air at ambient temperature (Isp ~66 s)
};
// density of a full tank (solves P = Z·ρ·R·T with Z = 1 + Zk·ρ)
const PF = GAS.psiFull * GAS.PSI / (GAS.R * AMBIENT_K);
export const RHO_FULL = (-1 + Math.sqrt(1 + 4 * GAS.Zk * PF)) / (2 * GAS.Zk);
export const tankVolume = (airMax) => airMax / RHO_FULL;
export function tankPressure(m, T, V) {
  if (V <= 0) return 0;
  const rho = m / V;
  return (1 + GAS.Zk * rho) * rho * GAS.R * T;
}
export const exhaustVelocity = (T) => GAS.ve0 * Math.sqrt(T / AMBIENT_K);

// ---------- thruster valves ----------
// open / close time constants (s); bigger valves are slower. Each unit differs a little.
export const VALVE = { rear: [0.045, 0.03], lift: [0.034, 0.024], side: [0.022, 0.018], spread: 0.12, gainSpread: 0.02 };
export function setupValve(t, i) {
  const v = VALVE[t.group];
  const r1 = ((i * 0.6180339 + 0.31) % 1) * 2 - 1, r2 = ((i * 0.4142136 + 0.77) % 1) * 2 - 1;
  t.tauO = v[0] * (1 + VALVE.spread * r1);
  t.tauC = v[1] * (1 + VALVE.spread * r2);
  t.gain = 1 + VALVE.gainSpread * r2;
  t.hist = [0, 0];      // ~8 ms transport delay (2 physics steps)
  t.health = 1;
}
