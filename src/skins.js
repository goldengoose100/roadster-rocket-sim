// Skins + cases (2.2). Five rarities (grey, green, blue, purple, gold) won from two cases, plus 50 secret
// Dev skins that only the mod menu unlocks. A skin is two colours + a pattern drawn by the paint shader
// (carModel.js), with its own metalness / roughness and optional glow.
export const RARITY = {
  grey: { name: 'Common', col: '#9aa3ad', value: 300 },
  green: { name: 'Uncommon', col: '#46f07a', value: 700 },
  blue: { name: 'Rare', col: '#4aa8ff', value: 1600 },
  purple: { name: 'Epic', col: '#b14cff', value: 4000 },
  gold: { name: 'Legendary', col: '#ffc83d', value: 10000 },
  dev: { name: 'Secret Dev', col: '#ff3df2', value: 0 },
};
// patterns: 0 paint, 1 two-tone, 2 racing stripes, 3 bands, 4 checker, 5 fade, 6 camo, 7 glow lines,
// 8 rainbow, 9 chrome, 10 glitch, 11 hologram, 12 lava, 13 matrix, 14 galaxy
const S = (id, name, rarity, a, b, pattern, metal = 0.5, rough = 0.3, glow = 0) => ({ id, name, rarity, a, b, pattern, metal, rough, glow });

export const SKINS = [
  // grey: plain colours
  S('g-sand', 'Desert Sand', 'grey', '#c2a878', '#c2a878', 1, 0.2, 0.5), S('g-olive', 'Olive Drab', 'grey', '#59603a', '#59603a', 1, 0.2, 0.6),
  S('g-slate', 'Slate', 'grey', '#4b5560', '#4b5560', 1, 0.4, 0.4), S('g-brick', 'Brick', 'grey', '#8a3b2a', '#8a3b2a', 1, 0.2, 0.5),
  S('g-mint', 'Mint', 'grey', '#9fd8c0', '#9fd8c0', 1, 0.2, 0.4), S('g-cream', 'Cream', 'grey', '#e8dcc0', '#e8dcc0', 1, 0.1, 0.35),
  S('g-navy', 'Navy', 'grey', '#1b2a4a', '#1b2a4a', 1, 0.4, 0.35), S('g-rust', 'Rust', 'grey', '#7a4020', '#5a2a14', 6, 0.3, 0.8),
  S('g-steel', 'Brushed Steel', 'grey', '#8e959c', '#7b8188', 3, 0.9, 0.45), S('g-primer', 'Primer Grey', 'grey', '#6e7073', '#6e7073', 1, 0, 0.9),
  // green: two-tone
  S('n-panda', 'Panda', 'green', '#f2f2f2', '#111214', 1, 0.3, 0.3), S('n-police', 'Interceptor', 'green', '#f4f4f4', '#0d1a3a', 1, 0.4, 0.3),
  S('n-taxi', 'Taxi', 'green', '#f2c230', '#111214', 4, 0.3, 0.35), S('n-race', 'Le Mans', 'green', '#12305e', '#f2f2f2', 2, 0.6, 0.3),
  S('n-gulf', 'Gulf', 'green', '#8ac7ea', '#f08a24', 2, 0.4, 0.3), S('n-army', 'Desert Camo', 'green', '#b9a27a', '#6f5c3c', 6, 0.1, 0.8),
  S('n-forest', 'Forest Camo', 'green', '#3e5a34', '#1f2a1a', 6, 0.1, 0.8), S('n-sunset', 'Sunset Fade', 'green', '#ff8a3a', '#7a1f6a', 5, 0.5, 0.3),
  S('n-ocean', 'Ocean Fade', 'green', '#1fd0c0', '#0b2a6a', 5, 0.5, 0.3),
  // blue: metallic, stripes, checker
  S('b-cobalt', 'Cobalt Stripe', 'blue', '#1550c8', '#e9ecef', 2, 0.85, 0.2), S('b-check', 'Chequered Flag', 'blue', '#f2f2f2', '#0e0f11', 4, 0.4, 0.3),
  S('b-carbon', 'Full Carbon', 'blue', '#1a1c20', '#2a2e34', 4, 0.6, 0.35), S('b-candy', 'Candy Apple', 'blue', '#c40a1e', '#600010', 5, 0.9, 0.12),
  S('b-ice', 'Glacier', 'blue', '#d8f4ff', '#5fb8e8', 5, 0.8, 0.15), S('b-tiger', 'Tiger', 'blue', '#ff8a1a', '#120c06', 3, 0.4, 0.35),
  S('b-zebra', 'Zebra', 'blue', '#f4f4f4', '#0b0b0c', 3, 0.3, 0.35), S('b-urban', 'Urban Camo', 'blue', '#a8adb3', '#3a3e44', 6, 0.3, 0.6),
  // purple: glowing and animated
  S('p-neon', 'Neon Runner', 'purple', '#0d0d18', '#ff2bd6', 7, 0.5, 0.3, 2.2), S('p-tron', 'Grid Racer', 'purple', '#06121a', '#3df2ff', 7, 0.6, 0.25, 2.4),
  S('p-toxic', 'Toxic', 'purple', '#1a2410', '#7dff3a', 7, 0.4, 0.35, 2.0), S('p-plasma', 'Plasma Fade', 'purple', '#ff2bd6', '#2b6bff', 5, 0.8, 0.2, 0.6),
  S('p-holo', 'Hologram', 'purple', '#4af0ff', '#b14cff', 11, 0.7, 0.2, 1.4), S('p-ember', 'Ember', 'purple', '#2a0a04', '#ff5a1a', 12, 0.3, 0.6, 1.8),
  // gold: chrome and rainbow
  S('o-gold', 'Solid Gold', 'gold', '#ffcf5a', '#c99a3a', 9, 1, 0.08), S('o-rainbow', 'Spectrum', 'gold', '#ffffff', '#ffffff', 8, 0.6, 0.2, 0.5),
  S('o-galaxy', 'Galaxy', 'gold', '#0a0618', '#6a3aff', 14, 0.5, 0.3, 1.6), S('o-chrome', 'Liquid Chrome', 'gold', '#e8eef4', '#9aa6b2', 9, 1, 0.03),
];
// 50 secret Dev skins, built from the special patterns
const DEV_NAMES = ['Dev Matrix', 'Glitch', 'Void', 'Lava Core', 'Overclock', 'Kernel Panic', 'Root Access', 'Null Pointer', 'Stack Overflow', 'Segfault',
  'Debug Mode', 'Wireframe', 'Hex Dump', 'Bit Flip', 'Zero Day', 'Firewall', 'Blue Screen', 'Hotfix', 'Patch Notes', 'Source Code',
  'Dark Matter', 'Supernova', 'Event Horizon', 'Quasar', 'Nebula', 'Pulsar', 'Antimatter', 'Singularity', 'Starfield', 'Cosmic Dust',
  'Molten', 'Magma Vein', 'Hellfire', 'Obsidian', 'Phoenix', 'Inferno', 'Cinder', 'Volcano', 'Brimstone', 'Solar Flare',
  'Spectral', 'Phantom', 'Prism', 'Aurora', 'Mirage', 'Neon Ghost', 'Cyber Pink', 'Hyperdrive', 'Quantum', 'Developer Edition'];
const DEV_COLS = [['#001a00', '#3dff6a'], ['#100018', '#ff3df2'], ['#000000', '#6a3aff'], ['#1a0400', '#ff6a1a'], ['#00101a', '#3df2ff'],
  ['#1a1a00', '#ffe23d'], ['#0a0a0a', '#ffffff'], ['#18000a', '#ff2a5a'], ['#000a1a', '#2a7aff'], ['#0a1a10', '#3dffc0']];
const DEV_PATS = [13, 10, 14, 12, 11];
DEV_NAMES.forEach((name, i) => {
  const c = DEV_COLS[i % DEV_COLS.length], pat = i === 49 ? 8 : DEV_PATS[Math.floor(i / 10)];
  SKINS.push(S('dev-' + (i + 1), name, 'dev', c[0], c[1], pat, 0.5 + (i % 3) * 0.2, 0.2 + (i % 4) * 0.1, 1.2 + (i % 5) * 0.4));
});
export const findSkin = (id) => SKINS.find(s => s.id === id) || null;

export const CASES = [
  { id: 'street', name: 'Street Case', price: 1500, col: '#4aa8ff', odds: { grey: 55, green: 28, blue: 12, purple: 4, gold: 1 } },
  { id: 'elite', name: 'Elite Case', price: 5000, col: '#ffc83d', odds: { grey: 0, green: 30, blue: 40, purple: 22, gold: 8 } },
];
export function rollRarity(c, rnd = Math.random) {
  let r = rnd() * 100;
  for (const k of ['gold', 'purple', 'blue', 'green', 'grey']) { r -= c.odds[k]; if (r < 0) return k; }
  return 'grey';
}
export function rollSkin(c, rnd = Math.random) {
  const rar = rollRarity(c, rnd);
  const pool = SKINS.filter(s => s.rarity === rar);
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}
// a tile background showing the skin's two colours
export const swatchCss = (s) => s.pattern === 8 ? 'linear-gradient(90deg,#f33,#fd3,#3f6,#3cf,#a3f)' : `linear-gradient(135deg, ${s.a} 0 50%, ${s.b} 50% 100%)`;
