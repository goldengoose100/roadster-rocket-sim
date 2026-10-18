// Silly car bodies for the Good Luck menu (2.3). Looks only: the car under them drives exactly the same.
// Each body lives in src/silly/<id>.js and is built the first time it is picked.
import * as THREE from 'three';
import * as banana from './silly/banana.js';
import * as hotdog from './silly/hotdog.js';
import * as duck from './silly/duck.js';
import * as toilet from './silly/toilet.js';
import * as cart from './silly/cart.js';
import * as couch from './silly/couch.js';
import * as cheese from './silly/cheese.js';
import * as pizza from './silly/pizza.js';
import * as watermelon from './silly/watermelon.js';
import * as bathtub from './silly/bathtub.js';
import * as sneaker from './silly/sneaker.js';
import * as burger from './silly/burger.js';

const ICONS = { banana: '🍌', hotdog: '🌭', duck: '🦆', toilet: '🚽', cart: '🛒', couch: '🛋️', cheese: '🧀', pizza: '🍕', watermelon: '🍉', bathtub: '🛁', sneaker: '👟', burger: '🍔' };
export const SILLY = [banana, hotdog, duck, toilet, cart, couch, cheese, pizza, watermelon, bathtub, sneaker, burger]
  .map(m => ({ id: m.info.id, name: m.info.name, icon: ICONS[m.info.id] || '🎲', build: m.build }));

const cache = new Map();
// the body as a Group in car space, with its bounding box (for the hat and googly eyes)
export function sillyBody(id) {
  if (cache.has(id)) return cache.get(id);
  const def = SILLY.find(s => s.id === id);
  if (!def) return null;
  const g = def.build();
  g.name = 'silly-' + id;
  g.updateMatrixWorld(true);
  g.userData.box = new THREE.Box3().setFromObject(g);
  cache.set(id, g);
  return g;
}
