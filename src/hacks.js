// Mod menu: press "-" to show the access-code prompt, type the code, watch the loader,
// then toggle hacks live. Only a SHA-256 fingerprint of the code is stored here.
import * as THREE from 'three';

const CODE_HASH = 'f3cfc66fb36fbbd1253693bd6c810645a637539eebc41b3b65a857b657f3f9f9';
const $ = (id) => document.getElementById(id);

// small SHA-256 (works without a secure context)
function sha256(str) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = Array.from(new TextEncoder().encode(str));
  const l = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (l >>> (i * 8)) & 0xff);
  let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < bytes.length; o += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) w[i] = (bytes[o + i * 4] << 24) | (bytes[o + i * 4 + 1] << 16) | (bytes[o + i * 4 + 2] << 8) | bytes[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h = h.map((v, i) => (v + [a, b, c, d, e, f, g, hh][i]) | 0);
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

const GRAVITY = [['Earth', 1], ['Mars', 0.38], ['Moon', 0.165], ['Zero-G', 0], ['Jupiter', 2.5]];
const TOD = [['Day', 'day'], ['Golden hour', 'golden'], ['Sunset', 'sunset'], ['Night', 'night']];
const SPAWNS = [['Crate tower', 'crates'], ['Concrete tower', 'tower'], ['Brick wall', 'wall'], ['Barrel pile', 'barrels'], ['Car', 'car'], ['Semi', 'semi'], ['Jump ramp', 'ramp']];

// every option in the menu
const DEFS = [
  { tab: 'Car', id: 'power', label: 'Engine power', type: 'slider', min: 1, max: 10, step: 0.5, def: 1, unit: '×' },
  { tab: 'Car', id: 'topSpeed', label: 'Top speed limit', type: 'slider', min: 1, max: 5, step: 0.25, def: 1, unit: '×' },
  { tab: 'Car', id: 'grip', label: 'Tire grip (ice ↔ glue)', type: 'slider', min: 0.2, max: 3, step: 0.1, def: 1, unit: '×' },
  { tab: 'Car', id: 'gravity', label: 'Gravity', type: 'select', options: GRAVITY, def: 1 },
  { tab: 'Car', id: 'scale', label: 'Car size', type: 'slider', min: 0.5, max: 3, step: 0.25, def: 1, unit: '×' },
  { tab: 'Car', id: 'noFlip', label: 'Never flip', type: 'toggle', def: false },
  { tab: 'Car', id: 'stickyFan', label: 'Super-sticky fan (3×)', type: 'toggle', def: false },
  { tab: 'Car', id: 'driftMode', label: 'Drift mode (stability control off)', type: 'toggle', def: false },
  { tab: 'Car', id: 'wrecking', label: 'Wrecking ball (ram to destroy)', type: 'toggle', def: false },
  { tab: 'Flight', id: 'infiniteAir', label: 'Infinite air', type: 'toggle', def: false },
  { tab: 'Flight', id: 'thrust', label: 'Thruster power', type: 'slider', min: 1, max: 5, step: 0.25, def: 1, unit: '×' },
  { tab: 'Flight', id: 'ghost', label: 'Ghost mode (no-clip)', type: 'toggle', def: false },
  { tab: 'Flight', id: 'rollAnyTrim', label: 'Barrel roll on any trim', type: 'toggle', def: false },
  { tab: 'Flight', id: 'jumpPower', label: 'Moon jump height [J]', type: 'slider', min: 5, max: 60, step: 5, def: 15, unit: ' m/s' },
  { tab: 'Weapons', id: 'alwaysLauncher', label: 'Launcher always equipped', type: 'toggle', def: false },
  { tab: 'Weapons', id: 'infiniteAmmo', label: 'Infinite rockets', type: 'toggle', def: false },
  { tab: 'Weapons', id: 'rapidFire', label: 'Machine-gun fire rate', type: 'toggle', def: false },
  { tab: 'Weapons', id: 'blast', label: 'Explosion size', type: 'slider', min: 1, max: 5, step: 0.25, def: 1, unit: '×' },
  { tab: 'Weapons', id: 'homing', label: 'Homing rockets', type: 'toggle', def: false },
  { tab: 'Weapons', id: 'cluster', label: 'Cluster rockets', type: 'toggle', def: false },
  { tab: 'Weapons', id: 'doNuke', label: 'Drop a nuke at the crosshair [K]', type: 'button', text: 'NUKE' },
  { tab: 'Weapons', id: 'doStrike', label: 'Airstrike at the crosshair [L]', type: 'button', text: 'CALL IN' },
  { tab: 'World', id: 'timeScale', label: 'Game speed (bullet time [Y])', type: 'slider', min: 0.1, max: 2, step: 0.05, def: 1, unit: '×' },
  { tab: 'World', id: 'tod', label: 'Time of day', type: 'select', options: TOD, def: 'day' },
  { tab: 'World', id: 'spawnKind', label: 'Spawn at crosshair [U]', type: 'select', options: SPAWNS, def: 'crates', button: 'SPAWN' },
  { tab: 'World', id: 'doDetonate', label: 'Detonate every barrel', type: 'button', text: 'BOOM' },
  { tab: 'World', id: 'doCollapse', label: 'Collapse every building', type: 'button', text: 'COLLAPSE' },
  { tab: 'World', id: 'doRebuild', label: 'Rebuild the world', type: 'button', text: 'REBUILD' },
  { tab: 'World', id: 'floatDebris', label: 'Zero-G debris', type: 'toggle', def: false },
  { tab: 'World', id: 'mapAnywhere', label: 'Map click teleports anywhere', type: 'toggle', def: false },
  { tab: 'Visual', id: 'paint', label: 'Paint color', type: 'color', def: '' },
  { tab: 'Visual', id: 'rainbow', label: 'Rainbow paint', type: 'toggle', def: false },
  { tab: 'Visual', id: 'underglow', label: 'Neon underglow', type: 'toggle', def: false },
  { tab: 'Visual', id: 'glowColor', label: 'Underglow color', type: 'color', def: '#b14cff' },
  { tab: 'Visual', id: 'smoke', label: 'Thruster smoke color', type: 'color', def: '#eef7ff' },
  { tab: 'Visual', id: 'disco', label: 'Disco mode', type: 'toggle', def: false },
  { tab: 'Visual', id: 'fov', label: 'Field of view', type: 'slider', min: -20, max: 40, step: 1, def: 0, unit: '°' },
  { tab: 'Visual', id: 'xray', label: 'Physics X-ray', type: 'toggle', def: false },
  { tab: 'Visual', id: 'fps', label: 'FPS / performance counter', type: 'toggle', def: false },
  { tab: 'Visual', id: 'freeCam', label: 'Free camera [I]', type: 'toggle', def: false },
  { tab: 'Visual', id: 'photo', label: 'Photo mode, hide HUD [O]', type: 'toggle', def: false },
];
const TABS = ['Car', 'Flight', 'Weapons', 'World', 'Visual', 'Keys'];
const KEYS = [['-', 'Show / hide this menu'], ['J', 'Moon jump'], ['T', 'Teleport to the crosshair'], ['K', 'Nuke the crosshair'], ['L', 'Airstrike the crosshair'], ['U', 'Spawn the selected object'], ['Y', 'Bullet time on / off'], ['I', 'Free camera'], ['O', 'Photo mode'], ['Q / E', 'Barrel roll (in the air)']];
const BOOT_LINES = [
  'connecting to roadster ECU', 'bypassing fan limiter', 'unlocking 10x thrusters', 'patching gravity.dll',
  'injecting rocket_pod.sys', 'disabling speed governor', 'overclocking cold-gas valves', 'spoofing air tank sensor',
];

export class Hacks {
  constructor(api) {
    this.api = api;
    this.unlocked = false;
    this.open = false;
    this.busy = false;
    this.tab = 'Car';
    this.v = {};
    for (const d of DEFS) if ('def' in d) this.v[d.id] = d.def;
    try { Object.assign(this.v, JSON.parse(localStorage.getItem('rrs.hacks') || '{}')); } catch (_) { /* storage blocked */ }
    this.bulletPrev = null;
    this.hue = 0;
    this.buildDom();
  }
  save() { try { localStorage.setItem('rrs.hacks', JSON.stringify(this.v)); } catch (_) { /* storage blocked */ } }

  // ---------- "-" key ----------
  toggle() {
    if (this.busy) return;
    if (!this.unlocked) { this.showCode(); return; }
    this.setOpen(!this.open);
  }
  setOpen(on) {
    this.open = on;
    $('hk-menu').hidden = !on;
    if (on) { $('hk-menu').classList.remove('in'); void $('hk-menu').offsetWidth; $('hk-menu').classList.add('in'); }
  }
  showCode() {
    const box = $('hk-code');
    if (!box.hidden) { this.hideCode(); return; }
    box.hidden = false;
    const inp = $('hk-input');
    inp.value = ''; $('hk-msg').textContent = '';
    inp.focus();
  }
  hideCode() { $('hk-code').hidden = true; $('hk-input').blur(); document.getElementById('gl').focus(); }

  submit() {
    const val = $('hk-input').value.trim().toLowerCase();
    if (sha256(val) === CODE_HASH) {
      this.hideCode();
      this.boot();
    } else {
      const b = $('hk-code').querySelector('.hk-box');
      b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      $('hk-msg').textContent = 'ACCESS DENIED';
      $('hk-input').value = '';
      this.api.sound.warn();
    }
  }

  // ---------- loading animation ----------
  boot() {
    this.busy = true;
    const load = $('hk-load'), pre = $('hk-lines'), bar = $('hk-bar'), pct = $('hk-pct');
    load.hidden = false; load.classList.remove('done');
    pre.textContent = '';
    const total = 2600, start = performance.now();
    let shown = 0;
    const lines = BOOT_LINES.map(l => `> ${l} ${'.'.repeat(Math.max(3, 34 - l.length))} `);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / total);
      const want = Math.floor(t * (lines.length + 0.999));
      while (shown < want && shown < lines.length) { pre.textContent += lines[shown] + 'OK\n'; shown++; this.api.sound.click(); }
      const p = Math.floor(100 * (1 - Math.pow(1 - t, 2)));
      bar.style.width = p + '%'; pct.textContent = p + '%';
      if (t < 1) requestAnimationFrame(tick);
      else {
        pre.textContent += '\nACCESS GRANTED';
        load.classList.add('done');
        this.api.sound.record();
        setTimeout(() => { load.hidden = true; this.busy = false; this.unlocked = true; this.applyAll(); this.setOpen(true); this.api.toast('Mod menu unlocked · press - to hide', 'ice'); }, 700);
      }
    };
    requestAnimationFrame(tick);
  }

  // ---------- menu DOM ----------
  buildDom() {
    $('hk-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape' || e.key === '-') { e.preventDefault(); this.hideCode(); }
      e.stopPropagation();
    });
    const tabs = $('hk-tabs');
    for (const t of TABS) {
      const b = document.createElement('button');
      b.textContent = t; b.id = 'hk-tab-' + t;
      b.onclick = () => { this.tab = t; this.renderBody(); };
      tabs.appendChild(b);
    }
    $('hk-reset').onclick = () => {
      for (const d of DEFS) if ('def' in d) this.v[d.id] = d.def;
      this.save(); this.applyAll(); this.renderBody(); this.api.toast('All hacks off', '');
    };
    $('hk-close').onclick = () => this.setOpen(false);
    this.renderBody();
  }
  renderBody() {
    for (const t of TABS) $('hk-tab-' + t).setAttribute('aria-pressed', String(t === this.tab));
    const body = $('hk-body');
    body.innerHTML = '';
    if (this.tab === 'Keys') {
      for (const [k, d] of KEYS) {
        const row = document.createElement('div'); row.className = 'hk-row';
        row.innerHTML = `<span>${d}</span><kbd>${k}</kbd>`;
        body.appendChild(row);
      }
      return;
    }
    for (const d of DEFS.filter(x => x.tab === this.tab)) {
      const row = document.createElement('div'); row.className = 'hk-row';
      const label = document.createElement('span'); label.textContent = d.label; row.appendChild(label);
      const id = 'hkc-' + d.id;
      if (d.type === 'toggle') {
        const b = document.createElement('button'); b.className = 'hk-sw'; b.id = id;
        b.setAttribute('aria-pressed', String(!!this.v[d.id])); b.setAttribute('aria-label', d.label);
        b.onclick = () => { this.set(d.id, !this.v[d.id]); b.setAttribute('aria-pressed', String(!!this.v[d.id])); };
        row.appendChild(b);
      } else if (d.type === 'slider') {
        const wrap = document.createElement('div'); wrap.className = 'hk-sl';
        const r = document.createElement('input'); r.type = 'range'; r.id = id; r.min = d.min; r.max = d.max; r.step = d.step; r.value = this.v[d.id];
        const out = document.createElement('output'); out.textContent = fmt(this.v[d.id], d);
        r.oninput = () => { this.set(d.id, +r.value); out.textContent = fmt(+r.value, d); };
        wrap.append(r, out); row.appendChild(wrap);
      } else if (d.type === 'select') {
        const wrap = document.createElement('div'); wrap.className = 'hk-sl';
        const sel = document.createElement('select'); sel.id = id;
        for (const [name, val] of d.options) { const o = document.createElement('option'); o.value = String(val); o.textContent = name; if (String(val) === String(this.v[d.id])) o.selected = true; sel.appendChild(o); }
        sel.onchange = () => { const opt = d.options.find(o => String(o[1]) === sel.value); this.set(d.id, opt[1]); sel.blur(); };
        wrap.appendChild(sel);
        if (d.button) { const b = document.createElement('button'); b.className = 'hk-btn'; b.textContent = d.button; b.onclick = () => this.action('doSpawn'); wrap.appendChild(b); }
        row.appendChild(wrap);
      } else if (d.type === 'color') {
        const c = document.createElement('input'); c.type = 'color'; c.id = id; c.value = this.v[d.id] || '#9e0f17';
        c.oninput = () => this.set(d.id, c.value);
        row.appendChild(c);
      } else if (d.type === 'button') {
        const b = document.createElement('button'); b.className = 'hk-btn'; b.id = id; b.textContent = d.text;
        b.onclick = () => this.action(d.id);
        row.appendChild(b);
      }
      body.appendChild(row);
    }
  }

  set(id, val) {
    this.v[id] = val;
    this.save();
    this.apply(id);
  }
  applyAll() { for (const d of DEFS) if ('def' in d) this.apply(d.id); }

  // push one setting into the game
  apply(id) {
    if (!this.unlocked) return;
    const a = this.api, v = a.vehicle, h = v.hack, val = this.v[id];
    switch (id) {
      case 'power': case 'topSpeed': case 'grip': case 'thrust': case 'noFlip': case 'stickyFan': case 'infiniteAir': case 'rollAnyTrim': h[id] = val; break;
      case 'gravity': h.gravity = val; a.destruction.gravityScale = this.v.floatDebris ? 0 : val; break;
      case 'floatDebris': a.destruction.gravityScale = val ? 0 : this.v.gravity; for (const b of a.destruction.bodies) b.wake(); break;
      case 'scale': if (h.scale !== val) { v.setScale(val); a.model.group.scale.setScalar(val); a.rig.carScale = val; v.pos.y += Math.max(0, (val - 1) * 0.5); } break;
      case 'driftMode': v.esc = !val; break;
      case 'ghost': h.ghost = val; if (!val) { v.vel.set(0, 0, 0); } break;
      case 'alwaysLauncher': if (val && !a.weapons.equipped) a.weapons.equip(); break;
      case 'infiniteAmmo': case 'rapidFire': case 'homing': case 'cluster': a.weapons.hack[id] = val; break;
      case 'blast': a.weapons.hack.blast = val; break;
      case 'timeScale': a.G.timeScale = val; this.bulletPrev = null; break;
      case 'tod': a.setTimeOfDay(val); break;
      case 'paint': if (val) a.model.setPaint({ color: val, metal: 0.5, rough: 0.3 }); break;
      case 'smoke': { const c = new THREE.Color(val); a.effects.vapor = [c.r, c.g, c.b]; break; }
      case 'underglow': case 'glowColor': a.model.underglow.visible = !!this.v.underglow; a.model.underglow.material.color.set(this.v.glowColor); break;
      case 'fov': a.rig.fovAdd = val; break;
      case 'xray': a.setXray(val); break;
      case 'fps': $('hk-fps').hidden = !val; break;
      case 'freeCam': a.setFreeCam(val); break;
      case 'photo': a.setPhoto(val); break;
      case 'rainbow': case 'disco': if (!this.v.rainbow && !this.v.disco) a.restorePaint(this.v.paint); break;
      default: break;
    }
  }

  action(id) {
    if (!this.unlocked) return;
    const a = this.api;
    const aim = a.aimPoint();
    switch (id) {
      case 'doNuke': a.nuke(aim); break;
      case 'doStrike': a.weapons.airstrike(aim); a.toast('Airstrike inbound', 'warn', 1500); break;
      case 'doSpawn': a.spawn(this.v.spawnKind, aim); break;
      case 'doDetonate': a.toast(`${a.destruction.detonateAll()} barrels armed`, 'warn', 1800); break;
      case 'doCollapse': a.toast(`${a.destruction.collapseAll()} blocks knocked loose`, 'warn', 1800); break;
      case 'doRebuild': a.rebuild(); break;
      default: break;
    }
  }

  // hotkeys (only after unlocking); returns true if the key was used
  key(code) {
    if (!this.unlocked) return false;
    const a = this.api;
    switch (code) {
      case 'KeyJ': a.vehicle.vel.y = Math.max(a.vehicle.vel.y, 0) + this.v.jumpPower; a.vehicle.pos.y += 0.05; return true;
      case 'KeyT': { const p = a.aimPoint(); a.teleportTo(p); return true; }
      case 'KeyK': this.action('doNuke'); return true;
      case 'KeyL': this.action('doStrike'); return true;
      case 'KeyU': this.action('doSpawn'); return true;
      case 'KeyY': {
        if (this.bulletPrev === null) { this.bulletPrev = a.G.timeScale; a.G.timeScale = 0.25; a.toast('Bullet time', 'ice', 900); }
        else { a.G.timeScale = this.bulletPrev; this.bulletPrev = null; a.toast('Normal speed', '', 900); }
        return true;
      }
      case 'KeyI': this.set('freeCam', !this.v.freeCam); this.renderBody(); return true;
      case 'KeyO': this.set('photo', !this.v.photo); this.renderBody(); return true;
      default: return false;
    }
  }

  // per-frame visuals
  update(dt, stats) {
    if (!this.unlocked) return;
    const a = this.api;
    if (this.v.rainbow || this.v.disco) {
      this.hue = (this.hue + dt * (this.v.disco ? 0.9 : 0.15)) % 1;
      const c = new THREE.Color().setHSL(this.hue, 0.85, 0.5);
      a.model.mats.paint.color.copy(c);
      if (this.v.disco) {
        a.model.underglow.visible = true;
        a.model.underglow.material.color.setHSL((this.hue + 0.5) % 1, 1, 0.55);
        a.effects.vapor = [c.r, c.g, c.b];
      }
    }
    if (this.v.alwaysLauncher && !a.weapons.equipped) a.weapons.equip();
    if (this.v.fps) {
      this.fpsT = (this.fpsT || 0) - dt;
      if (this.fpsT <= 0) {
        this.fpsT = 0.25;
        $('hk-fps').textContent = `${Math.round(stats.fps)} FPS · physics ${stats.physMs.toFixed(1)} ms · draw calls ${stats.calls} · debris ${stats.awake}/${stats.bodies}`;
      }
    }
  }
}
function fmt(v, d) { return (d.unit === '×' ? (+v).toFixed(2).replace(/\.?0+$/, '') : v) + d.unit; }
