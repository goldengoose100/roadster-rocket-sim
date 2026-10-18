// Ragdoll target dummy types for the shooting range.
// Each type gives the colours (materials) for the body capsules drawn by src/ragdoll.js,
// plus a few small decorations glued to the head and torso.
//
// Head frame:  origin = head centre, +y up, +z = where the face looks, +x = dummy's left.
//              The head sphere has radius 0.13*s.
// Torso frame: origin = middle of torso, +y up the spine, +z = chest, +x = left.
//              The torso capsule has radius 0.15*s and half-height 0.24*s.
// All decoration sizes below are written for s = 1 and scaled by s when added.
import * as THREE from 'three';

const PI = Math.PI;

// ---------- small helpers ----------

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...opts });
}

function glow(color, emissive, intensity, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity: intensity, roughness: 0.4, metalness: 0, ...opts,
  });
}

// Add one mesh to g. Position/size are for s = 1; o: { rx, ry, rz, sx, sy, sz, shadow }.
function put(g, s, geo, mat, x, y, z, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x * s, y * s, z * s);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  m.scale.set((o.sx ?? 1) * s, (o.sy ?? 1) * s, (o.sz ?? 1) * s);
  m.castShadow = !!o.shadow;
  m.receiveShadow = false;
  g.add(m);
  return m;
}

// A flat disc facing +z whose triangles are coloured by pickColor(triangleIndex).
// One mesh, no textures (used for the crash-test markers and the wooden target).
function paintedCircle(r, segs, pickColor) {
  const geo = new THREE.CircleGeometry(r, segs).toNonIndexed();
  return colourTris(geo, pickColor);
}
function paintedRing(r, segs, rings, pickColor) {
  const geo = new THREE.RingGeometry(r * 0.001, r, segs, rings).toNonIndexed();
  return colourTris(geo, (t) => pickColor(Math.floor(t / (2 * segs))));
}
function colourTris(geo, pickColor) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let t = 0; t < n / 3; t++) {
    const c = pickColor(t);
    for (let k = 0; k < 3; k++) {
      col[(t * 3 + k) * 3] = c.r;
      col[(t * 3 + k) * 3 + 1] = c.g;
      col[(t * 3 + k) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Tiny cached canvas textures (only in a browser; in node they are simply skipped).
const texCache = {};
function canvasTex(key, w, h, draw, repeatX = 1, repeatY = 1) {
  if (typeof document === 'undefined') return null;
  if (texCache[key]) return texCache[key];
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    texCache[key] = t;
    return t;
  } catch (e) {
    return null;
  }
}

function polkaTex() {
  return canvasTex('polka', 64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ff4fa3';
    ctx.fillRect(0, 0, w, h);
    const dots = [['#ffe14a', 16, 16], ['#4ad8ff', 48, 16], ['#7dff5a', 32, 48], ['#ffe14a', 0, 48], ['#ffe14a', 64, 48]];
    for (const [c, x, y] of dots) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, PI * 2); ctx.fill();
    }
  }, 4, 2);
}

function plaidTex() {
  return canvasTex('plaid', 32, 32, (ctx, w, h) => {
    ctx.fillStyle = '#b3322b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(30,10,10,0.55)';
    ctx.fillRect(0, 10, w, 6);
    ctx.fillRect(10, 0, 6, h);
    ctx.fillStyle = 'rgba(255,220,200,0.35)';
    ctx.fillRect(0, 26, w, 2);
    ctx.fillRect(26, 0, 2, h);
  }, 5, 3);
}

function saleTex() {
  return canvasTex('sale', 64, 32, (ctx, w, h) => {
    ctx.fillStyle = '#d8262e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SALE', w / 2, h / 2 + 1);
  });
}

// A crown band with 5 points on top (one open cylinder whose top ring is zig-zagged).
function crownGeometry(rBottom, rTop, h, points) {
  const segs = points * 2;
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, segs, 1, true);
  const pos = geo.attributes.position;
  // Top row is the first segs+1 vertices (index 0..segs, seam duplicated).
  for (let i = 0; i <= segs; i++) {
    if (i % 2 === 0) pos.setY(i, pos.getY(i) + h * 0.9);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

const YELLOW = new THREE.Color(0xffc400);
const BLACK = new THREE.Color(0x111111);
const RED = new THREE.Color(0xd42a22);
const WHITE = new THREE.Color(0xf4f0e8);

// ---------- the 7 types ----------

export const DOLL_TYPES = [
  {
    id: 'crash',
    name: 'Crash Test Dummy',
    hp: 120,
    size: 1,
    gore: 'blood',
    mats() {
      const yellow = std(0xf2c218, { roughness: 0.45 });
      return {
        head: yellow,
        torso: yellow,
        arm: yellow,
        hand: std(0x1d1d1d, { roughness: 0.6 }),
        leg: yellow,
        shin: std(0x2e2b26, { roughness: 0.6 }),
      };
    },
    decorateHead(g, s) {
      // Black/yellow quarter-circle markers on both sides of the head.
      const mat = std(0xffffff, { vertexColors: true, roughness: 0.5 });
      const quarters = (t) => (Math.floor(t / 4) % 2 ? BLACK : YELLOW);
      put(g, s, paintedCircle(0.05, 16, quarters), mat, 0.133, 0.02, 0, { ry: PI / 2 });
      put(g, s, paintedCircle(0.05, 16, quarters), mat, -0.133, 0.02, 0, { ry: -PI / 2 });
    },
    decorateTorso(g, s) {
      const mat = std(0xffffff, { vertexColors: true, roughness: 0.5 });
      const quarters = (t) => (Math.floor(t / 4) % 2 ? BLACK : YELLOW);
      put(g, s, paintedCircle(0.055, 16, quarters), mat, 0, 0.08, 0.153);
      const black = std(0x1a1a1a, { roughness: 0.5 });
      // Black waist band and black shoulder joints.
      put(g, s, new THREE.TorusGeometry(0.152, 0.018, 6, 18), black, 0, -0.17, 0, { rx: PI / 2, shadow: true });
      const joint = new THREE.SphereGeometry(0.06, 10, 8);
      put(g, s, joint, black, 0.16, 0.22, 0, { shadow: true });
      put(g, s, joint, black, -0.16, 0.22, 0, { shadow: true });
    },
  },

  {
    id: 'wood',
    name: 'Training Dummy',
    hp: 80,
    size: 1,
    gore: 'splinter',
    mats() {
      return {
        head: std(0xdcb787, { roughness: 0.9 }),
        torso: std(0xcc9f66, { roughness: 0.9 }),
        arm: std(0xd6ab76, { roughness: 0.9 }),
        hand: std(0xbb8a5b, { roughness: 0.9 }),
        leg: std(0xcc9f66, { roughness: 0.9 }),
        shin: std(0xb48252, { roughness: 0.9 }),
      };
    },
    decorateHead(g, s) {
      // Simple carved face: two dark holes and a slot mouth.
      const dark = std(0x3b2614, { roughness: 1 });
      const eye = new THREE.SphereGeometry(0.018, 8, 6);
      put(g, s, eye, dark, 0.045, 0.03, 0.115, { sz: 0.6 });
      put(g, s, eye, dark, -0.045, 0.03, 0.115, { sz: 0.6 });
      put(g, s, new THREE.BoxGeometry(0.07, 0.012, 0.02), dark, 0, -0.045, 0.12);
    },
    decorateTorso(g, s) {
      // Rope bands wrapped round the torso and a painted target on the chest.
      const rope = std(0x5c3f22, { roughness: 1 });
      const band = new THREE.TorusGeometry(0.153, 0.016, 6, 18);
      put(g, s, band, rope, 0, 0.13, 0, { rx: PI / 2, shadow: true });
      put(g, s, band, rope, 0, -0.14, 0, { rx: PI / 2, shadow: true });
      const target = std(0xffffff, { vertexColors: true, roughness: 0.8 });
      put(g, s, paintedRing(0.065, 12, 3, (j) => (j % 2 ? WHITE : RED)), target, 0, 0.0, 0.152);
    },
  },

  {
    id: 'robot',
    name: 'Robot',
    hp: 260,
    size: 1.05,
    gore: 'oil',
    mats() {
      const metal = { roughness: 0.35, metalness: 0.8 };
      return {
        head: std(0x8c98aa, metal),
        torso: std(0x5a6a84, metal),
        arm: std(0x8c98aa, metal),
        hand: std(0x3a4250, metal),
        leg: std(0x5a6a84, metal),
        shin: std(0x3a4250, metal),
      };
    },
    decorateHead(g, s) {
      // Glowing cyan visor across the face.
      const visor = glow(0x003b46, 0x00e5ff, 2.2, { side: THREE.DoubleSide, roughness: 0.2 });
      put(g, s, new THREE.CylinderGeometry(0.137, 0.137, 0.045, 10, 1, true, -1.0, 2.0), visor, 0, 0.025, 0);
      // Antenna with a red glowing tip.
      const steel = std(0x9aa3ae, { roughness: 0.3, metalness: 0.9 });
      put(g, s, new THREE.CylinderGeometry(0.006, 0.008, 0.11, 5), steel, 0.03, 0.175, -0.02);
      put(g, s, new THREE.SphereGeometry(0.018, 8, 6), glow(0x660000, 0xff2020, 2.5), 0.03, 0.235, -0.02);
      // Ear bolts.
      const bolt = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8);
      const dark = std(0x2f3642, { roughness: 0.4, metalness: 0.8 });
      put(g, s, bolt, dark, 0.13, 0, 0, { rz: PI / 2 });
      put(g, s, bolt, dark, -0.13, 0, 0, { rz: PI / 2 });
    },
    decorateTorso(g, s) {
      // Curved chest panel with a glowing light.
      const panel = std(0x2a3240, { roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide });
      put(g, s, new THREE.CylinderGeometry(0.158, 0.158, 0.12, 8, 1, true, -0.55, 1.1), panel, 0, 0.09, 0, { shadow: true });
      put(g, s, new THREE.SphereGeometry(0.022, 8, 6), glow(0x0a3320, 0x40ff90, 2.5), 0, 0.1, 0.162, { sz: 0.5 });
    },
  },

  {
    id: 'mannequin',
    name: 'Mannequin',
    hp: 100,
    size: 1,
    gore: 'blood',
    mats() {
      const gloss = { roughness: 0.18, metalness: 0 };
      return {
        head: std(0xf4ece2, gloss),
        torso: std(0xf1e6d8, gloss),
        arm: std(0xf4ece2, gloss),
        hand: std(0xece0cf, gloss),
        leg: std(0xf1e6d8, gloss),
        shin: std(0xece0cf, gloss),
      };
    },
    decorateHead(g, s) {
      // No face, only a subtle nose bump.
      const plastic = std(0xf4ece2, { roughness: 0.18 });
      put(g, s, new THREE.SphereGeometry(0.022, 8, 6), plastic, 0, -0.005, 0.124, { sx: 0.7, sy: 1.2 });
    },
    decorateTorso(g, s) {
      // A sale tag hanging from a string at the left shoulder.
      const tex = saleTex();
      const tag = tex ? std(0xffffff, { map: tex, roughness: 0.8 }) : std(0xd8262e, { roughness: 0.8 });
      put(g, s, new THREE.CylinderGeometry(0.002, 0.002, 0.08, 4), std(0x222222), 0.09, 0.21, 0.13, { rz: 0.25 });
      put(g, s, new THREE.BoxGeometry(0.06, 0.032, 0.004), tag, 0.1, 0.16, 0.148, { rz: -0.15 });
    },
  },

  {
    id: 'scarecrow',
    name: 'Scarecrow',
    hp: 70,
    size: 1,
    gore: 'straw',
    mats() {
      const plaid = plaidTex();
      const shirt = (c) => (plaid ? std(0xffffff, { map: plaid, roughness: 0.95 }) : std(c, { roughness: 0.95 }));
      return {
        head: std(0xc4a26a, { roughness: 1 }), // burlap sack
        torso: shirt(0xa8302a),                // flannel shirt
        arm: shirt(0xa8302a),
        hand: std(0xe3c565, { roughness: 1 }), // straw sticking out of the sleeves
        leg: std(0x3a5a94, { roughness: 0.9 }), // jeans
        shin: std(0x2f4a7c, { roughness: 0.9 }),
      };
    },
    decorateHead(g, s) {
      // Straw hat: wide brim + crown.
      const straw = std(0xd9b85c, { roughness: 1, side: THREE.DoubleSide });
      put(g, s, new THREE.CylinderGeometry(0.22, 0.22, 0.012, 14), straw, 0, 0.1, 0, { shadow: true });
      put(g, s, new THREE.CylinderGeometry(0.09, 0.11, 0.1, 10), straw, 0, 0.15, 0, { shadow: true });
      // Button eyes and a stitched mouth.
      const button = std(0x1c1c22, { roughness: 0.5 });
      const eye = new THREE.CylinderGeometry(0.02, 0.02, 0.008, 8);
      put(g, s, eye, button, 0.045, 0.02, 0.122, { rx: PI / 2 });
      put(g, s, eye, button, -0.045, 0.02, 0.122, { rx: PI / 2 });
      put(g, s, new THREE.BoxGeometry(0.075, 0.006, 0.012), std(0x3a2a18, { roughness: 1 }), 0, -0.05, 0.12);
    },
    decorateTorso(g, s) {
      // Straw poking out of the collar, a rope belt and a patch on the shirt.
      const straw = std(0xe3c565, { roughness: 1, side: THREE.DoubleSide });
      put(g, s, new THREE.CylinderGeometry(0.16, 0.09, 0.07, 7, 1, true), straw, 0, 0.27, 0, { shadow: true });
      put(g, s, new THREE.TorusGeometry(0.153, 0.014, 6, 18), std(0x8a6a3a, { roughness: 1 }), 0, -0.2, 0, { rx: PI / 2 });
      put(g, s, new THREE.BoxGeometry(0.06, 0.06, 0.01), std(0x6b4e2e, { roughness: 1 }), -0.06, 0.05, 0.14, { rz: 0.2, ry: -0.35 });
    },
  },

  {
    id: 'clown',
    name: 'Clown Dummy',
    hp: 110,
    size: 1,
    gore: 'blood',
    mats() {
      const dots = polkaTex();
      return {
        head: std(0xfafafa, { roughness: 0.5 }), // white face paint
        torso: dots ? std(0xffffff, { map: dots, roughness: 0.6 }) : std(0xff4fa3, { roughness: 0.6 }),
        arm: std(0x2fb8ff, { roughness: 0.6 }),
        hand: std(0xffffff, { roughness: 0.5 }), // white gloves
        leg: std(0xffd21f, { roughness: 0.6 }),
        shin: std(0xe02424, { roughness: 0.5 }), // big red shoes
      };
    },
    decorateHead(g, s) {
      // Red ball nose.
      put(g, s, new THREE.SphereGeometry(0.032, 10, 8), glow(0xe01010, 0x550000, 1, { roughness: 0.3 }), 0, -0.005, 0.135);
      // Rainbow curly hair tufts on both sides.
      const tuft = new THREE.SphereGeometry(0.055, 8, 6);
      put(g, s, tuft, std(0xff3030), 0.115, 0.03, -0.03, { shadow: true });
      put(g, s, tuft, std(0xffd400), 0.095, 0.1, -0.05, { shadow: true });
      put(g, s, tuft, std(0x30d040), -0.115, 0.03, -0.03, { shadow: true });
      put(g, s, tuft, std(0x3070ff), -0.095, 0.1, -0.05, { shadow: true });
    },
    decorateTorso(g, s) {
      // Big bow tie under the chin.
      const bow = std(0x8a2cff, { roughness: 0.5 });
      const wing = new THREE.ConeGeometry(0.05, 0.09, 6);
      put(g, s, wing, bow, -0.045, 0.22, 0.155, { rz: -PI / 2, sx: 1, sz: 0.5, shadow: true });
      put(g, s, wing, bow, 0.045, 0.22, 0.155, { rz: PI / 2, sx: 1, sz: 0.5, shadow: true });
      put(g, s, new THREE.SphereGeometry(0.022, 8, 6), std(0xffd400, { roughness: 0.5 }), 0, 0.22, 0.165);
    },
  },

  {
    id: 'boss',
    name: 'BOSS DUMMY',
    hp: 900,
    size: 2.1,
    gore: 'blood',
    mats() {
      const armour = { roughness: 0.35, metalness: 0.75 };
      return {
        head: std(0x18181c, armour),
        torso: std(0x24242a, armour),
        arm: std(0x18181c, armour),
        hand: std(0x9a1414, armour),
        leg: std(0x24242a, armour),
        shin: std(0x7a1010, armour),
      };
    },
    decorateHead(g, s) {
      // Gold crown with five points.
      const gold = std(0xffc83a, { roughness: 0.25, metalness: 1, emissive: 0x332200, emissiveIntensity: 0.6, side: THREE.DoubleSide });
      put(g, s, crownGeometry(0.105, 0.112, 0.05, 5), gold, 0, 0.105, 0, { shadow: true });
      // Angry glowing red eyes (slanted down towards the nose).
      const eyeMat = glow(0x400000, 0xff1a00, 3);
      const eye = new THREE.BoxGeometry(0.045, 0.015, 0.012);
      put(g, s, eye, eyeMat, 0.045, 0.025, 0.122, { rz: 0.35 });
      put(g, s, eye, eyeMat, -0.045, 0.025, 0.122, { rz: -0.35 });
    },
    decorateTorso(g, s) {
      // Spiked shoulder pads and a red chest plate.
      const pad = std(0x111114, { roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide });
      const red = std(0xa01818, { roughness: 0.35, metalness: 0.6 });
      const dome = new THREE.SphereGeometry(0.1, 10, 5, 0, PI * 2, 0, PI / 2);
      put(g, s, dome, pad, 0.17, 0.2, 0, { rz: -0.35, sy: 0.75, sz: 1.15, shadow: true });
      put(g, s, dome, pad, -0.17, 0.2, 0, { rz: 0.35, sy: 0.75, sz: 1.15, shadow: true });
      const spike = new THREE.ConeGeometry(0.025, 0.08, 6);
      put(g, s, spike, red, 0.2, 0.3, 0, { rz: -0.35, shadow: true });
      put(g, s, spike, red, -0.2, 0.3, 0, { rz: 0.35, shadow: true });
      put(g, s, new THREE.CylinderGeometry(0.162, 0.162, 0.18, 8, 1, true, -0.6, 1.2),
        std(0x8a1212, { roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide }), 0, 0.06, 0, { shadow: true });
    },
  },
];
