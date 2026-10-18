// Silly car bodies for the Good Luck menu (2.3). Looks only: the car under them drives exactly the same.
// Each body lives in src/silly/<id>.js and is built the first time it is picked.
import * as THREE from 'three';
import * as banana from './silly/banana.js';
import * as hotdog from './silly/hotdog.js';
import * as duck from './silly/duck.js';
import * as watermelon from './silly/watermelon.js';

const ICONS = { banana: '🍌', hotdog: '🌭', duck: '🦆', toilet: '🚽', cart: '🛒', couch: '🛋️', cheese: '🧀', pizza: '🍕', watermelon: '🍉', bathtub: '🛁', sneaker: '👟', burger: '🍔' };
export const SILLY = [banana, hotdog, duck, watermelon]
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
  findAnchors(g);
  cache.set(id, g);
  return g;
}

// where the party hat and googly eyes go: a body can set userData.hat / userData.eyes itself,
// otherwise the hat sits on the highest point along the middle and the eyes on the front face
const _rc = new THREE.Raycaster(), _o = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0), _back = new THREE.Vector3(0, 0, -1);
function findAnchors(g) {
  const meshes = []; g.traverse(o => { if (o.isMesh && o.visible) meshes.push(o); });
  const box = g.userData.box, h = box.max.y - box.min.y;
  let hat = null;
  for (let i = 0; i <= 16; i++) {
    const z = box.min.z + (box.max.z - box.min.z) * (0.15 + 0.7 * i / 16);
    _rc.set(_o.set(0, box.max.y + 1, z), _down);
    const hit = _rc.intersectObjects(meshes, false)[0];
    if (hit && (!hat || hit.point.y > hat.y + 0.02)) hat = hit.point.clone();
  }
  _rc.set(_o.set(0, box.min.y + h * 0.6, box.max.z + 1), _back);
  const eye = _rc.intersectObjects(meshes, false)[0];
  g.userData.hatAt = g.userData.hat || hat || new THREE.Vector3(0, box.max.y, (box.min.z + box.max.z) / 2);
  g.userData.eyesAt = g.userData.eyes || (eye ? eye.point.clone() : new THREE.Vector3(0, box.min.y + h * 0.6, box.max.z));
}
