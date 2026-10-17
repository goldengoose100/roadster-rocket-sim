// Vehicle specs. Numbers marked (reveal) come from coverage of the Oct 15, 2026 reveal;
// numbers marked (est.) are not published by Tesla and are estimates used to make the physics work.
export const TRIMS = {
  performance: {
    id: 'performance', name: 'Performance', tag: 'Road car',
    dryMass: 1780,            // est. curb weight, no air tanks
    airMax: 0,
    rearThrust: 0, liftThrust: 0, sideThrust: 0,
    seats: 2,
    specs: [['0-60 mph', 'under 1.6 s (reveal)'], ['Top speed', '230+ mph'], ['Thrusters', 'none'], ['Fan downforce', '4,700 kg (reveal)']],
    blurb: 'Fan-assisted grip and three motors. No thrusters.',
  },
  thrust: {
    id: 'thrust', name: 'Thrust', tag: 'Rear boost',
    dryMass: 1840,
    airMax: 85,               // est. smaller tank (~200 L reported by one outlet)
    rearThrust: 7500,         // est. per rear thruster (4x)
    liftThrust: 0, sideThrust: 0,
    seats: 2,
    specs: [['0-60 mph', 'under 0.9 s (reveal)'], ['Top speed', '230+ mph'], ['Thrusters', '4 rear cold-gas'], ['Air', '~85 kg (est.)']],
    blurb: 'Rear cold-gas thrusters for launches. Cannot fly.',
  },
  rocket: {
    id: 'rocket', name: 'Rocket', tag: 'Full flight',
    dryMass: 1800,            // est.
    airMax: 250,              // 600 L composite tanks, ~250 kg air (reveal)
    rearThrust: 20000,        // 4 rear thrusters, 80+ kN combined (reveal)
    liftThrust: 15000,        // est. per lift thruster (4x)
    sideThrust: 6000,         // est. per yaw thruster (2x)
    seats: 1,
    specs: [['0-60 mph', 'under 0.59 s (reveal)'], ['Top speed', '230+ mph (reveal)'], ['Thrusters', '10 cold-gas (reveal)'], ['Air', '250 kg / 600 L (reveal)']],
    blurb: 'Single seat, 10 thrusters, real flight. Invite-only in real life.',
  },
};

export const PHYS = {
  G: 9.81,
  RHO: 1.225,
  DT: 1 / 240,
  MOTOR_FORCE: 30000,     // N at the wheels (est., ~10,000 Nm wheel torque claim)
  MOTOR_POWER: 1.25e6,    // W (est.)
  VMAX: 104,              // m/s wheel-limited (~233 mph)
  REVERSE_VMAX: 12,
  FAN_MAX: 46100,         // N (4,700 kgf, reveal demo readout)
  EXHAUST_V: 600,         // m/s cold-gas exhaust velocity (Isp ~61 s)
  TANK_PSI: 5500,         // psi when full (600 L, ~250 kg air)
  SPRING: 90000,
  DAMP: 5200,
  BUMP: 1.4e6,
  REST: 0.303,
  TRAVEL: 0.2,
  WHEEL_R: 0.36,
};

export const PAINTS = [
  { id: 'red', name: 'Red Multi-Coat', color: '#9e0f17', metal: 0.55, rough: 0.32 },
  { id: 'white', name: 'Pearl White', color: '#e9ecef', metal: 0.12, rough: 0.28 },
  { id: 'black', name: 'Solid Black', color: '#0d0e10', metal: 0.4, rough: 0.25 },
  { id: 'silver', name: 'Quicksilver', color: '#8d939a', metal: 0.85, rough: 0.22 },
  { id: 'blue', name: 'Deep Blue', color: '#12305e', metal: 0.6, rough: 0.3 },
];

export const MPH = 2.23694;
export const KMH = 3.6;
