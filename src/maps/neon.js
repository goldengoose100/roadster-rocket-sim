// Neon City (2.5): a night city with a skyway, a tunnel, a parking garage and rooftop jumps. Built from parts in ./neon/.
import * as T from './neon/terrain.js';
import { build as hq } from './neon/hq.js';
import { build as buildings } from './neon/buildings.js';
import { build as streets } from './neon/streets.js';
import { build as garage } from './neon/garage.js';
import { build as highway } from './neon/highway.js';
import { build as yard, dollSpots } from './neon/yard.js';

const PARTS = { hq, garage, highway, yard, buildings, streets };
export default {
  id: 'neon', name: 'Neon City', desc: 'Night city: tunnel, skyway, rooftop jumps', col: '#ff2bd6',
  zones: T.zones, flats: T.flats, height: T.height, paved: T.paved, color: T.color, mapColor: T.mapColor, env: T.env,
  dollSpots,
  mapDrawsPaved: true,   // the whole city is paved: the minimap uses mapColor's street grid
  // one broken part must not stop the map from loading
  build(world) { for (const [name, fn] of Object.entries(PARTS)) { try { fn(world); } catch (e) { console.warn(`neon/${name}`, e); } } },
};
