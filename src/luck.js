// Good Luck menu (2.3): press 0, enter its own access code (only its SHA-256 is stored here), then
// unlock everything, wear any skin, swap the car for a banana or a toilet and switch on silly mods.
// Everything is off by default; turning it all off gives the normal game back.
import * as THREE from 'three';
import { sha256 } from './hacks.js';
import { SKINS, RARITY, swatchCss, findSkin } from './skins.js';
import { SILLY, sillyBody } from './silly.js';

const CODE_HASH = 'c3227ef0df35f786cb71ef02106bcc7aa104ed206b310723b0ad58209930203a';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const MODS = [
  { id: 'giantWheels', icon: '🛞', name: 'Monster wheels' },
  { id: 'tiny', icon: '🐜', name: 'Tiny car' },
  { id: 'eyes', icon: '👀', name: 'Googly eyes' },
  { id: 'hat', icon: '🥳', name: 'Party hat' },
  { id: 'jelly', icon: '🍮', name: 'Wobbly jelly car' },
  { id: 'trail', icon: '🌈', name: 'Rainbow trail' },
  { id: 'confetti', icon: '🎉', name: 'Confetti explosions' },
  { id: 'fart', icon: '💨', name: 'Fart boost' },
  { id: 'horn', icon: '🤡', name: 'Clown horn (Enter)' },
  { id: 'bouncy', icon: '🏀', name: 'Bouncy car' },
];
const TABS = [['luck', '🍀 Luck'], ['skins', '🎨 Skins'], ['cars', '🍌 Cars'], ['mods', '🤪 Mods']];
const DEFAULTS = { unlockAll: false, skin: '', car: '', ...Object.fromEntries(MODS.map(m => [m.id, false])) };
const WHEEL_R = 0.36, _v = new THREE.Vector3(), _c = new THREE.Color();

export class Luck {
  constructor(api) {
    this.api = api;
    this.unlocked = false;
    this.open = false;
    this.tab = 'luck';
    this.v = { ...DEFAULTS };
    try { Object.assign(this.v, JSON.parse(localStorage.getItem('rrs.luck') || '{}')); } catch (_) { /* storage blocked */ }
    this.t = 0; this.wob = 0; this.wobV = 0; this.prevVel = new THREE.Vector3(); this.airVy = 0; this.fartT = 0; this.trailHue = 0;
    this.eyes = null; this.hat = null;
    this.buildDom();
  }
  save() { try { localStorage.setItem('rrs.luck', JSON.stringify(this.v)); } catch (_) { /* storage blocked */ } }

  // ---------- 0 key ----------
  toggle() {
    if (!this.unlocked) { this.showCode(); return; }
    this.setOpen(!this.open);
  }
  setOpen(on) {
    this.open = on;
    $('lk-menu').hidden = !on;
    if (on) { const m = $('lk-menu'); m.classList.remove('in'); void m.offsetWidth; m.classList.add('in'); this.render(); }
  }
  showCode() {
    const box = $('lk-code');
    if (!box.hidden) { this.hideCode(); return; }
    box.hidden = false;
    $('lk-input').value = ''; $('lk-msg').textContent = '';
    $('lk-input').focus();
  }
  hideCode() { $('lk-code').hidden = true; $('lk-input').blur(); const gl = $('gl'); if (gl) gl.focus(); }
  submit() {
    const val = $('lk-input').value.trim().toLowerCase();
    if (sha256(val) === CODE_HASH) {
      this.hideCode();
      this.unlock();
    } else {
      const b = $('lk-code').querySelector('.lk-box');
      b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      $('lk-msg').textContent = 'Bad luck! Try again';
      $('lk-input').value = '';
      this.api.sound.warn();
    }
  }
  unlock() {
    this.unlocked = true;
    this.applyAll();
    this.setOpen(true);
    this.api.sound.record();
    this.api.toast('🍀 Good Luck menu unlocked · press 0 to hide', 'good', 2600);
    this.confettiBurst(this.api.vehicle.pos, 120);
  }

  // ---------- settings ----------
  set(id, val) { this.v[id] = val; this.save(); this.apply(id); this.render(); }
  applyAll() { for (const k of Object.keys(DEFAULTS)) this.apply(k); }
  apply(id) {
    if (!this.unlocked) return;
    const a = this.api, v = this.v;
    switch (id) {
      case 'unlockAll': a.syncCheats(); a.onCheats(); break;
      case 'skin': a.applyLook(); break;
      case 'car': this.fitCar(); break;
      case 'giantWheels': this.fitWheels(); break;
      case 'tiny': this.fitScale(); break;
      case 'eyes': case 'hat': this.fitExtras(); break;
      case 'jelly': if (!v.jelly) this.resetJelly(); break;
      default: break;
    }
  }
  // skin the swapper asks for: undefined = no override, null = plain paint, else a skin
  skinOverride() {
    if (!this.unlocked || !this.v.skin) return undefined;
    return this.v.skin === 'plain' ? null : findSkin(this.v.skin);
  }
  fitCar() {
    const m = this.api.model;
    this.resetJelly();
    m.setSilly(this.unlocked && this.v.car ? sillyBody(this.v.car) : null);
    this.fitExtras();
  }
  fitWheels() {
    const s = this.unlocked && this.v.giantWheels ? 1.7 : 1;
    for (const w of this.api.model.wheels) {
      w.holder.scale.set(Math.sign(w.holder.scale.x) * s, s, s);
      w.holder.position.y = WHEEL_R * (s - 1);   // bottom of the tire stays on the ground
    }
  }
  fitScale() { this.api.model.group.scale.setScalar(this.visualScale()); }
  visualScale() { return (this.api.rig.carScale || 1) * (this.unlocked && this.v.tiny ? 0.45 : 1); }
  // box around whatever body is showing, in car space
  bodyBox() {
    const m = this.api.model;
    if (m.sillyBody) return m.sillyBody.userData.box;
    if (!this.carBox) { m.body.geometry.computeBoundingBox(); this.carBox = m.body.geometry.boundingBox.clone(); m.canopy.geometry.computeBoundingBox(); this.carBox.union(m.canopy.geometry.boundingBox); }
    return this.carBox;
  }
  fitExtras() {
    const m = this.api.model, box = this.bodyBox(), on = this.unlocked;
    if (on && this.v.eyes && !this.eyes) { this.eyes = makeEyes(); m.group.add(this.eyes); }
    if (on && this.v.hat && !this.hat) { this.hat = makeHat(); m.group.add(this.hat); }
    if (this.eyes) {
      this.eyes.visible = on && this.v.eyes;
      // on the default car the eyes sit on the hood; on a silly body, high on its front face
      if (m.sillyBody) this.eyes.position.set(0, box.min.y + (box.max.y - box.min.y) * 0.62, box.max.z - 0.02);
      else this.eyes.position.set(0, 0.16, 1.62);
      this.eyes.rotation.x = m.sillyBody ? 0 : -0.35;
    }
    if (this.hat) {
      this.hat.visible = on && this.v.hat;
      this.hat.position.set(0, box.max.y - 0.04, m.sillyBody ? (box.min.z + box.max.z) / 2 : -0.25);
    }
  }
  resetJelly() {
    this.wob = 0; this.wobV = 0;
    const m = this.api.model;
    m.body.scale.set(1, 1, 1); m.canopy.scale.set(1, 1, 1);
    if (m.sillyBody) m.sillyBody.scale.set(1, 1, 1);   // called before every car swap, so no body keeps a squash
  }

  // ---------- per frame (after the car model is placed) ----------
  update(dt, running) {
    if (!this.unlocked) return;
    const a = this.api, m = a.model, veh = a.vehicle, v = this.v;
    this.t += dt;
    // tiny car: shrink around the centre of mass, then drop it so the tires touch the ground
    if (v.tiny) {
      const k = this.visualScale();
      m.group.scale.setScalar(k);
      _v.set(0, -0.45 * ((a.rig.carScale || 1) - k), 0).applyQuaternion(m.group.quaternion);
      m.group.position.add(_v);
    }
    // acceleration felt by the car (drives the wobble, eyes and bounce)
    const acc = _v.copy(veh.vel).sub(this.prevVel).divideScalar(Math.max(dt, 1e-3));
    this.prevVel.copy(veh.vel);
    if (!running) acc.set(0, 0, 0);
    const kick = Math.min(30, acc.length());
    if (v.jelly) {
      this.wobV += (-this.wob * 140 - this.wobV * 4) * dt + kick * dt * 0.9;
      this.wob += this.wobV * dt;
      this.wob = Math.max(-0.35, Math.min(0.35, this.wob));
      const w = this.wob + 0.03 * Math.sin(this.t * 9);
      const tgt = m.sillyBody ? [m.sillyBody] : [m.body, m.canopy];
      for (const o of tgt) o.scale.set(1 + w * 0.5, 1 - w, 1 + w * 0.5);
    }
    if (this.eyes && this.eyes.visible) {
      for (const p of this.eyes.userData.pupils) {
        p.userData.vx += (-p.position.x * 60 - p.userData.vx * 3) * dt + (Math.random() - 0.5) * kick * dt * 0.8;
        p.userData.vy += (-(p.position.y + 0.02) * 60 - p.userData.vy * 3) * dt - kick * dt * 0.3;
        p.position.x = Math.max(-0.045, Math.min(0.045, p.position.x + p.userData.vx * dt));
        p.position.y = Math.max(-0.045, Math.min(0.045, p.position.y + p.userData.vy * dt));
      }
    }
    if (m.sillyBody && m.sillyBody.userData.tick) m.sillyBody.userData.tick(this.t, veh.vel.length());
    if (!running) return;
    // bouncy car: a hard landing throws it back up (boing)
    if (v.bouncy) {
      if (!veh.contacts) this.airVy = Math.min(this.airVy, veh.vel.y);
      else {
        if (this.airVy < -4) { veh.vel.y = -this.airVy * 0.72; a.sound.boing(); }
        this.airVy = 0;
      }
    }
    const fx = a.effects, back = _v.copy(veh.fwd).multiplyScalar(-2.3 * this.visualScale()).add(veh.pos);
    const speed = veh.vel.length();
    if (v.trail && speed > 3) {
      this.trailHue = (this.trailHue + dt * 0.6) % 1;
      for (let i = 0; i < 3; i++) {
        _c.setHSL((this.trailHue + i * 0.08) % 1, 1, 0.55);
        fx.fire.spawn(back.x + (Math.random() - 0.5) * 0.8, back.y + 0.1 + Math.random() * 0.3, back.z + (Math.random() - 0.5) * 0.8, 0, 0.4, 0, 1.2, 0.5, 0.15, _c.r, _c.g, _c.b, 0.8, { drag: 3 });
      }
    }
    if (v.fart && a.boosting()) {
      for (let i = 0; i < 2; i++) fx.smoke.spawn(back.x, back.y + 0.2, back.z, -veh.fwd.x * 6 + (Math.random() - 0.5) * 2, 0.5 + Math.random(), -veh.fwd.z * 6 + (Math.random() - 0.5) * 2, 1.6, 0.6, 2.6, 0.45, 0.75, 0.2, 0.55, { drag: 2 });
      this.fartT -= dt;
      if (this.fartT <= 0) { a.sound.fart(); this.fartT = 0.45 + Math.random() * 0.5; }
    }
  }
  key(code) {
    if (!this.unlocked) return false;
    if ((code === 'Enter' || code === 'NumpadEnter') && this.v.horn) { this.api.sound.honk(); return true; }
    return false;
  }
  onExplode(pos, radius) {
    if (this.unlocked && this.v.confetti) this.confettiBurst(pos, Math.min(220, 40 + radius * 12));
  }
  confettiBurst(pos, n) {
    const fx = this.api.effects;
    for (let i = 0; i < n; i++) {
      _c.setHSL(Math.random(), 1, 0.6);
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 14;
      fx.fire.spawn(pos.x, pos.y + 1, pos.z, Math.cos(a) * s, 6 + Math.random() * 14, Math.sin(a) * s, 2.2 + Math.random(), 0.22, 0.18, _c.r, _c.g, _c.b, 1, { drag: 1.2, grav: 9, spin: 8 });
    }
  }
  // "I'm feeling lucky": random car, skin and a few mods
  feelingLucky() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    this.v.car = pick(SILLY).id;
    this.v.skin = pick(SKINS).id;
    for (const m of MODS) this.v[m.id] = m.id !== 'tiny' && m.id !== 'bouncy' && Math.random() < 0.4;
    this.save(); this.applyAll(); this.render();
    this.confettiBurst(this.api.vehicle.pos, 120);
    this.api.sound.record();
    this.api.toast(`🍀 ${SILLY.find(s => s.id === this.v.car).name} with ${findSkin(this.v.skin).name}!`, 'good', 2400);
  }
  resetAll() {
    this.v = { ...DEFAULTS };
    this.save(); this.applyAll(); this.render();
    this.api.toast('Good Luck menu: everything off', '', 1600);
  }

  // ---------- DOM ----------
  buildDom() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="lk-menu" hidden>
        <div class="lk-head"><b>🍀 GOOD LUCK MENU 🍀</b><small>v__VERSION__ · press 0 to hide</small></div>
        <div id="lk-tabs">${TABS.map(([id, label]) => `<button id="lk-tab-${id}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="lk-body"></div>
        <div class="lk-foot"><button class="btn" id="lk-lucky">🎲 I'm feeling lucky</button><span><button class="btn" id="lk-reset">All off</button> <button class="btn" id="lk-close">Hide <kbd>0</kbd></button></span></div>
      </div>
      <div id="lk-code" hidden>
        <div class="lk-box">
          <div class="t">🍀 GOOD LUCK 🍀</div>
          <div class="s">Enter the lucky code</div>
          <input id="lk-input" type="password" autocomplete="off" spellcheck="false" maxlength="24" aria-label="Good Luck code">
          <div id="lk-msg" aria-live="polite"></div>
          <div class="s">Enter to submit · Esc to cancel</div>
        </div>
      </div>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
    // the version label is filled at build time in the template; here we copy it from the mod menu
    const ver = document.querySelector('.hk-head small');
    const m = ver && ver.textContent.match(/v[\d.]+/);
    document.querySelector('.lk-head small').textContent = `${m ? m[0] : ''} · feeling lucky? · press 0 to hide`;
    $('lk-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.hideCode(); }
      e.stopPropagation();
    });
    for (const [id] of TABS) $('lk-tab-' + id).onclick = () => { this.tab = id; this.api.sound.click(); this.render(); };
    $('lk-close').onclick = () => this.setOpen(false);
    $('lk-reset').onclick = () => this.resetAll();
    $('lk-lucky').onclick = () => this.feelingLucky();
    // give the keyboard back to the game after any click, so Enter (clown horn) or Space never re-press a button
    $('lk-menu').addEventListener('click', () => { const gl = $('gl'); if (gl) gl.focus(); else if (document.activeElement) document.activeElement.blur(); });
  }
  render() {
    if (!this.open) return;
    for (const [id] of TABS) $('lk-tab-' + id).setAttribute('aria-pressed', String(id === this.tab));
    const body = $('lk-body'), v = this.v;
    let html = '';
    if (this.tab === 'luck') {
      html += `<div class="lk-big"><div><b>Unlock everything</b><span>Every upgrade, part, case skin and all 50 secret Dev skins</span></div><button class="lk-sw" id="lk-unlockAll" aria-pressed="${!!v.unlockAll}"><i></i></button></div>`;
      html += `<p class="lk-tip">🎲 <b>I'm feeling lucky</b> (below) picks a random silly car, skin and mods.</p>`;
      html += `<p class="lk-tip">🎨 <b>Skins</b>: wear any of the ${SKINS.length} skins, no case needed.<br>🍌 <b>Cars</b>: turn into a banana, a toilet, a hot dog… It still drives and flies the same.<br>🤪 <b>Mods</b>: monster wheels, googly eyes, fart boost and more.</p>`;
    } else if (this.tab === 'skins') {
      html += `<div class="lk-row"><button class="lk-chip" data-skin="" aria-pressed="${!v.skin}">My garage skin</button><button class="lk-chip" data-skin="plain" aria-pressed="${v.skin === 'plain'}">Plain paint</button><button class="lk-chip" id="lk-rskin">🎲 Random</button></div><div class="lk-skins">`;
      for (const s of SKINS) html += `<button class="lk-skin" data-skin="${s.id}" aria-pressed="${v.skin === s.id}" style="--rc:${RARITY[s.rarity].col}" title="${esc(s.name)} · ${esc(RARITY[s.rarity].name)}"><i style="background:${swatchCss(s)}"></i><span>${esc(s.name)}</span></button>`;
      html += '</div>';
    } else if (this.tab === 'cars') {
      html += `<div class="lk-cars"><button class="lk-car" data-car="" aria-pressed="${!v.car}"><em>🏎️</em><span>Normal car</span></button>`;
      for (const s of SILLY) html += `<button class="lk-car" data-car="${s.id}" aria-pressed="${v.car === s.id}"><em>${s.icon}</em><span>${esc(s.name)}</span></button>`;
      html += '</div><p class="lk-tip">Looks only: the car underneath drives, flies and crashes exactly the same.</p>';
    } else {
      html += '<div class="lk-mods">';
      for (const md of MODS) html += `<button class="lk-mod" data-mod="${md.id}" aria-pressed="${!!v[md.id]}"><em>${md.icon}</em><span>${esc(md.name)}</span><i></i></button>`;
      html += '</div>';
    }
    body.innerHTML = html;
    const ua = $('lk-unlockAll'); if (ua) ua.onclick = () => this.set('unlockAll', !v.unlockAll);
    body.querySelectorAll('[data-skin]').forEach(b => { b.onclick = () => { this.set('skin', b.dataset.skin); this.api.sound.click(); }; });
    const rs = $('lk-rskin'); if (rs) rs.onclick = () => { this.set('skin', SKINS[Math.floor(Math.random() * SKINS.length)].id); this.api.sound.click(); };
    body.querySelectorAll('[data-car]').forEach(b => { b.onclick = () => { this.set('car', b.dataset.car); this.api.sound.pickup(); }; });
    body.querySelectorAll('[data-mod]').forEach(b => { b.onclick = () => { this.set(b.dataset.mod, !v[b.dataset.mod]); this.api.sound.click(); }; });
  }
}

// two googly eyes facing +z; pupils wobble with the car
function makeEyes() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.4 });
  const eyeGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.06, 24), pupilGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.03, 18);
  g.userData.pupils = [];
  for (const x of [-0.24, 0.24]) {
    const e = new THREE.Group(); e.position.set(x, 0, 0); e.rotation.x = Math.PI / 2;
    const ball = new THREE.Mesh(eyeGeo, white); ball.castShadow = true; e.add(ball);
    const holder = new THREE.Group(); holder.position.y = 0.04; holder.rotation.x = -Math.PI / 2; e.add(holder);   // pupil plane facing +z
    const p = new THREE.Mesh(pupilGeo, black); p.rotation.x = Math.PI / 2; p.userData.vx = 0; p.userData.vy = 0;
    holder.add(p); g.userData.pupils.push(p);
    g.add(e);
  }
  return g;
}
// striped cone party hat with a pom-pom
function makeHat() {
  const g = new THREE.Group();
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let map = null;
  if (cv) {
    cv.width = 64; cv.height = 64; const x = cv.getContext('2d');
    const cols = ['#ff3d7f', '#ffd23d', '#3dd6ff', '#7dff6a'];
    for (let i = 0; i < 8; i++) { x.fillStyle = cols[i % 4]; x.fillRect(0, i * 8, 64, 8); }
    map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
  }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.62, 24), new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.6 }));
  cone.position.y = 0.31; cone.castShadow = true; g.add(cone);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }));
  pom.position.y = 0.64; g.add(pom);
  g.rotation.z = 0.18;
  return g;
}
