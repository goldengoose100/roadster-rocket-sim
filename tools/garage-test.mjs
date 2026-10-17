// Headless checks for the garage: credits, buying, cheats, builds, and that upgrades really change the car.
// Run: node tools/garage-test.mjs
import { buildHeights } from '../src/terrain.js';
import { TRIMS } from '../src/config.js';
import { Profile, PRICES, UPGRADES, measure060, carStats, EARN } from '../src/garage.js';
import { Rewards } from '../src/rewards.js';
buildHeights();
const res = []; const check = (n, ok, info = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`); };
// a fake localStorage-backed store
const mem = {};
const store = { get: (k, d) => k in mem ? JSON.parse(mem[k]) : d, set: (k, v) => { mem[k] = JSON.stringify(v); } };

const p = new Profile(store);
check('new profile: 0 credits, stock car', p.credits === 0 && UPGRADES.every(u => p.level(u.id) === 0), JSON.stringify(p.levels()));
check('stock tune is exactly 1 everywhere', Object.values(p.tune()).every(x => x === 1));
check('stock trim numbers are untouched', JSON.stringify(p.effectiveTrim(TRIMS.rocket)) === JSON.stringify({ ...TRIMS.rocket }));
check('cannot buy without credits', !p.buyUpgrade('motor') && p.owned('motor') === 0);
p.earn(5000);
check('buying L1 costs 1,000', p.buyUpgrade('motor') && p.credits === 4000 && p.level('motor') === 1);
check('L2 costs 3,000', p.buyUpgrade('motor') && p.credits === 1000 && p.level('motor') === 2);
check('L3 needs 7,500', !p.buyUpgrade('motor') && p.credits === 1000);
p.setLevel('motor', 0);
check('owned levels can be switched back to stock', p.level('motor') === 0 && p.owned('motor') === 2);
p.setLevel('motor', 2);
check('cosmetic purchase', !p.buyPart('wing', 'fin') && p.earn(3000) && p.buyPart('wing', 'gt') && p.look().wing === 'gt', `credits ${p.credits}`);
// cheats only while on
p.cheats.unlimited = true; p.cheats.unlockAll = true;
check('unlimited credits: buying is free', p.buyUpgrade('fan') && p.buyPart('paint', 'gold') && p.credits === 2500, `credits ${p.credits}`);
p.setLevel('tank', 3);
check('unlock all: every level usable', p.level('tank') === 3);
p.cheats.unlimited = false; p.cheats.unlockAll = false;
check('cheats off: back to what you really own', p.level('tank') === 0 && p.owned('fan') === 1 && p.credits === 2500, JSON.stringify(p.levels()));
// builds
p.saveBuild(1, 'thrust');
p.setLevel('motor', 0); p.setPart('wing', 'duck');
const b = p.loadBuild(1);
check('builds save and load', b.trim === 'thrust' && p.level('motor') === 2 && p.look().wing === 'gt');
// saved to storage and loaded again
const q = new Profile(store);
check('profile survives a restart', q.credits === p.credits && q.owned('motor') === 2 && q.look().wing === 'gt' && q.d.builds[1].trim === 'thrust');
// upgrades change the physics
const stock = { motor: 0, tires: 0, fan: 0, thrust: 0, tank: 0 };
const full = { motor: 3, tires: 3, fan: 3, thrust: 3, tank: 3 };
const s0 = carStats(TRIMS.rocket, q, stock, true), s3 = carStats(TRIMS.rocket, q, full, true);
check('stock live stats match the stock car', Math.abs(s0.z60 - 0.54) < 0.02 && Math.round(s0.top) >= 229 && Math.round(s0.top) <= 232 && s0.air === 250, `0-60 ${s0.z60.toFixed(2)} s, ${s0.top.toFixed(0)} mph, ${s0.air} kg`);
check('maxed car: quicker, faster, more grip, thrust and air', s3.z60 < s0.z60 && s3.top > s0.top + 15 && s3.gripFan > s0.gripFan && s3.thrust > s0.thrust && s3.air === 375 && s3.hover > s0.hover,
  `0-60 ${s3.z60.toFixed(2)} s, ${s3.top.toFixed(0)} mph, grip ${s3.gripFan.toFixed(1)} g, ${s3.thrust.toFixed(0)} kN, ${s3.air} kg, hover ${s3.hover.toFixed(1)} s`);
const perf0 = measure060(q.effectiveTrim(TRIMS.performance, stock), q.tune(stock), true);
const perf3 = measure060(q.effectiveTrim(TRIMS.performance, { ...stock, motor: 3 }), q.tune({ ...stock, motor: 3 }), true);
check('Motor L3 makes the Performance trim quicker', perf3 < perf0 - 0.05, `${perf0.toFixed(2)} s -> ${perf3.toFixed(2)} s`);
// rewards
const paid = [];
const r = new Rewards(new Profile(null), (t, n) => paid.push([t, n]));
const fakeV = { up: { y: 1 } };
r.air.pitch = Math.PI * 2; r.air.roll = -Math.PI * 4;
const land = r.land(fakeV);
check('a flip and two barrel rolls pay 450 on a clean landing', land.credits === 3 * EARN.flip, land.text);
r.air.roll = Math.PI * 2; fakeV.up.y = 0.2;
check('no pay when you land upside down', r.land(fakeV).credits === 0);
const d = { score: { blocks: 0, barrels: 0, targets: 0 } };
r.destruction(d, 0.1); d.score.blocks = 40; d.score.barrels = 2; d.score.targets = 1;
for (let i = 0; i < 20; i++) r.destruction(d, 0.1);
check('destruction pays once the dust settles', paid.length === 1 && paid[0][1] === 40 * EARN.block + 2 * EARN.barrel + EARN.car, paid.map(x => x.join(' ')).join(' | '));
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
