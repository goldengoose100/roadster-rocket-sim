// The Moon: where everything goes. Every part of the map builds only inside its own area.
// Coordinates in metres; +z = north on the big map. Ground height 0 on flats.
export const ZONES = {
  hq:     { name: 'Lunar Base',        x: 0,    z: 0,    r: 110, tip: 'Park on the glowing pad to refill air. Number keys 1-8 teleport. Gravity is 1/6 of Earth!' },
  drag:   { name: 'Lunar Runway',      x: 405,  z: -150, r: 330, tip: 'Stop on the line, hold Shift + W. Low gravity: easy on the throttle.' },
  jump:   { name: 'Low-G Jump Zone',   x: -500, z: 250,  r: 260, tip: 'Hit the ramps flat out. On the Moon you fly for ages.' },
  mega:   { name: 'Mega Ramp',         x: 250,  z: 330,  r: 150, tip: 'The biggest ramp on the Moon. Full boost, then hover down.' },
  mine:   { name: 'Moon Rock Mine',    x: 600,  z: -650, r: 250, tip: 'Drive through a launcher to pick it up. Blow up the mine, the fuel tanks and the rovers.' },
  canyon: { name: 'Crater Canyon',     x: -700, z: -650, r: 330, tip: 'Fly through the rings in order. Land on the crater rims.' },
  lander: { name: 'Crashed Lander',    x: 520,  z: 520,  r: 130, tip: 'Somebody parked badly.' },
  crater: { name: 'Big Crater',        x: 0,    z: 760,  r: 260, tip: 'Drive down the slope and launch off the far rim.' },
};
// teleport keys (1..8) -> zone key; the part that owns the zone pushes the teleport
export const KEYS = { 1: 'hq', 2: 'drag', 3: 'jump', 4: 'mine', 5: 'canyon', 6: 'lander', 7: 'crater', 8: 'mega' };
// areas each part owns (stay inside; rect = cx, cz, hw, hd)
export const AREAS = {
  base:   { cx: 0, cz: 0, hw: 105, hd: 105 },          // base.js: HQ, air pad, modules, dish, solar panels
  runway: { cx: 405, cz: -150, hw: 330, hd: 30 },      // base.js: runway paint + start lights (NO colliders in x 90..720, z -168..-132)
  jump:   { cx: -500, cz: 250, hw: 260, hd: 230 },     // stunts.js
  mega:   { cx: 250, cz: 330, hw: 130, hd: 140 },      // stunts.js
  mine:   { cx: 600, cz: -650, hw: 230, hd: 180 },     // range.js
  canyon: { cx: -700, cz: -650, hw: 320, hd: 320 },    // scenery.js: rings + rim pads
  lander: { cx: 520, cz: 520, hw: 120, hd: 120 },      // scenery.js: wreck
  crater: { cx: 0, cz: 760, hw: 260, hd: 260 },        // scenery.js: signs/markers only (the bowl itself is terrain)
};
// big terrain features terrain.js must make (others are free to place small craters anywhere outside flats)
export const BIG_CRATERS = [
  { x: 0, z: 760, r: 220, depth: 34, rim: 12 },        // Big Crater
  { x: -700, z: -650, r: 260, depth: 45, rim: 22 },    // Crater Canyon bowl (rings fly over/through it)
  { x: -430, z: 250, r: 70, depth: 14, rim: 7 },       // jump zone gap 1 (ramps on its south rim, landing north)
  { x: -610, z: 300, r: 55, depth: 12, rim: 6 },       // jump zone gap 2
  { x: 330, z: 300, r: 60, depth: 12, rim: 5 },        // landing bowl after the Mega Ramp
];
// paved (graded regolith) flats: terrain.js adds these plus loose (unpaved) flats for the stunt areas
export const PADS = [
  { type: 'circle', cx: 0, cz: 0, r: 100, paved: true, blend: 45 },                       // base
  { type: 'rect', cx: 405, cz: -150, hw: 330, hd: 18, paved: true, blend: 50 },           // runway
  { type: 'rect', cx: 600, cz: -470, hw: 60, hd: 30, paved: true, blend: 40 },            // mine entrance
  { type: 'rect', cx: 600, cz: -680, hw: 220, hd: 150, paved: false, blend: 50 },         // mine floor
  { type: 'rect', cx: -500, cz: 120, hw: 200, hd: 40, paved: true, blend: 40 },           // jump zone run-up
  { type: 'rect', cx: 250, cz: 230, hw: 40, hd: 60, paved: true, blend: 40 },             // mega ramp run-up
];
export const ROADS = [
  [0, -100, 0, -150], [0, -150, 75, -150],     // base -> runway
  [80, -60, 560, -440],                        // base -> mine
  [-90, 40, -330, 120],                        // base -> jump zone
  [60, 90, 230, 180],                          // base -> mega ramp
  [-70, -70, -470, -420],                      // base -> canyon
  [90, 50, 460, 160], [460, 160, 500, 410],    // base -> lander (around the Mega Ramp landing bowl)
  [0, 100, 0, 520],                            // base -> big crater
];
