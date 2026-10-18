// The Moon (2.5): 1/6 gravity, craters, a lunar base and Earth in the sky. Built from parts in ./moon/.
import * as T from './moon/terrain.js';
import { build as base } from './moon/base.js';
import { build as stunts } from './moon/stunts.js';
import { build as range, dollSpots } from './moon/range.js';
import { build as scenery } from './moon/scenery.js';
import { build as ambient } from './moon/ambient.js';

const PARTS = { base, stunts, range, scenery, ambient };
export default {
  id: 'moon', name: 'The Moon', desc: '1/6 gravity, craters, Earth in the sky', col: '#cfd6e6',
  zones: T.zones, flats: T.flats, height: T.height, paved: T.paved, color: T.color, mapColor: T.mapColor, env: T.env,
  dollSpots,
  // one broken part must not stop the map from loading
  build(world) { for (const [name, fn] of Object.entries(PARTS)) { try { fn(world); } catch (e) { console.warn(`moon/${name}`, e); } } },
};
