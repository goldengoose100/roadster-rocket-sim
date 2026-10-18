// Neon City: where everything goes. A street grid with a 100 m pitch: streets 20 m wide centred on
// x = k*100 and z = k*100 (k = -7..7), city blocks in between (e.g. x 10..90). Ground height 0 everywhere
// in the city. Every part builds only inside its own area.
export const PITCH = 100, STREET = 20, CITY = 700;   // blocks fill -700..700
export const ZONES = {
  hq:      { name: 'Neon Garage HQ',    x: 0,    z: 0,    r: 100, tip: 'Park on the glowing pad to refill air. Number keys 1-8 teleport.' },
  drag:    { name: 'Drag Avenue',       x: 410,  z: -150, r: 330, tip: 'Stop on the line, hold Shift + W. 0-60 and 1/4 mile are timed.' },
  garage:  { name: 'Parking Garage',    x: 250,  z: 150,  r: 70,  tip: 'Drive up the ramps to the roof.' },
  roof:    { name: 'Rooftop Jump',      x: 400,  z: 150,  r: 110, tip: 'Launch off the garage roof across the street.' },
  tunnel:  { name: 'Neon Tunnel',       x: -300, z: 350,  r: 260, tip: 'Floor it through the tunnel.' },
  skyway:  { name: 'Skyway',            x: 0,    z: 400,  r: 620, tip: 'The elevated highway. Ramps at both ends.' },
  yard:    { name: 'Demolition Yard',   x: 500,  z: -500, r: 230, tip: 'Drive through a launcher to pick it up, then wreck the place.' },
  rings:   { name: 'Skyscraper Rings',  x: 100,  z: 600,  r: 220, tip: 'Fly through the rings between the towers.' },
};
export const KEYS = { 1: 'hq', 2: 'drag', 3: 'garage', 4: 'roof', 5: 'tunnel', 6: 'skyway', 7: 'yard', 8: 'rings' };
// reserved areas (rect cx, cz, hw, hd): generic city buildings (buildings.js) must not overlap these
export const RESERVED = {
  hq:     { cx: 0, cz: 0, hw: 92, hd: 92 },            // hq.js: plaza, air pad, neon garage building
  drag:   { cx: 410, cz: -150, hw: 360, hd: 28 },      // hq.js: avenue paint + start lights (NO colliders in x 90..720, z -168..-132)
  garage: { cx: 350, cz: 150, hw: 145, hd: 42 },       // garage.js: garage block x 210..290 + jump target buildings x 310..490
  yard:   { cx: 500, cz: -500, hw: 200, hd: 200 },     // yard.js: x 300..700, z -700..-300
  rings:  { cx: 100, cz: 600, hw: 12, hd: 220 },       // hq.js: ring course flies along street x = 100 (keep the street open, rings 30-60 m up)
};
// streets owned by highway.js (it builds structures ON these streets; nobody else puts colliders there)
export const TUNNEL = { x: -300, z0: 120, z1: 600 };  // a box tunnel along street x = -300
export const SKYWAY = { z: 400, x0: -600, x1: 600, h: 10 };   // elevated highway along street z = 400, deck 10 m up, ramps down at both ends
// helper: is (x, z) on a street (not inside a block)?
export const onStreet = (x, z) => {
  const m = (v) => ((v % PITCH) + PITCH) % PITCH;
  return m(x) < STREET / 2 || m(x) > PITCH - STREET / 2 || m(z) < STREET / 2 || m(z) > PITCH - STREET / 2;
};
// helper: list of city blocks {cx, cz, hw, hd} inside the city
export function blocks() {
  const out = [];
  for (let i = -CITY; i < CITY; i += PITCH) for (let j = -CITY; j < CITY; j += PITCH) out.push({ cx: i + PITCH / 2, cz: j + PITCH / 2, hw: (PITCH - STREET) / 2, hd: (PITCH - STREET) / 2 });
  return out;
}
export const overlaps = (a, b) => Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cz - b.cz) < a.hd + b.hd;
export const reservedAt = (r) => Object.values(RESERVED).some(x => overlaps(r, x));
