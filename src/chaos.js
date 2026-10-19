// Chaos Menu (2.6): press ` (the key left of 1) for crazy features. Each feature lives in src/features/<id>.js
// and is created the first time it's switched on, so the normal game is untouched until then.
import { FEATURES } from './features/index.js';

const $ = (id) => document.getElementById(id);
const CSS = `
#cx-menu { position: absolute; left: 50%; top: 90px; transform: translateX(-50%); width: min(720px, calc(100vw - 32px)); max-height: calc(100% - 200px);
  display: flex; flex-direction: column; z-index: 9; border-radius: 14px; overflow: hidden; background: rgba(14, 6, 6, .95);
  border: 2px solid #ff4d2e; box-shadow: 0 0 40px rgba(255, 77, 46, .35), 0 14px 40px rgba(0, 0, 0, .6); }
#cx-menu.in { animation: cxIn .35s cubic-bezier(.2, 1.3, .35, 1); }
@keyframes cxIn { from { opacity: 0; transform: translateX(-50%) scale(.92) rotate(-1deg); } }
.cx-head { padding: 12px 16px; text-align: center; background: linear-gradient(120deg, #4a0d05, #1a0606 60%, #3a1205); border-bottom: 1px solid rgba(255, 77, 46, .4); }
.cx-head b { display: block; font: 900 1.6rem/1 var(--f-display, system-ui); letter-spacing: .08em; background: linear-gradient(90deg, #ffd23d, #ff4d2e, #ff2bd6); -webkit-background-clip: text; background-clip: text; color: transparent; }
.cx-head small { display: block; margin-top: 5px; font: 600 .66rem/1.3 var(--f-display, system-ui); letter-spacing: .2em; color: #d9a08f; text-transform: uppercase; }
#cx-body { overflow-y: auto; padding: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.cx-card { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; padding: 10px; border-radius: 10px; text-align: left;
  border: 1px solid rgba(255, 255, 255, .12); background: rgba(255, 255, 255, .04); color: #f3e6e2; cursor: pointer; }
.cx-card em { grid-row: span 2; font-style: normal; font-size: 1.8rem; line-height: 1; }
.cx-card b { font: 800 .86rem/1.1 var(--f-display, system-ui); }
.cx-card span { font-size: .7rem; color: #c9b0a8; line-height: 1.25; }
.cx-card kbd { font: 700 .62rem/1 var(--f-display, system-ui); padding: 2px 4px; border-radius: 3px; background: rgba(255, 255, 255, .12); margin-left: 4px; }
.cx-card[aria-pressed="true"] { border-color: #ffd23d; background: rgba(255, 120, 40, .18); box-shadow: 0 0 12px rgba(255, 120, 40, .35); }
.cx-card:hover { transform: translateY(-1px); }
.cx-foot { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid rgba(255, 255, 255, .08); font: 600 .7rem/1.3 var(--f-display, system-ui); color: #c9b0a8; }
.cx-foot .btn { padding: 6px 10px; font-size: .78rem; }
body.photo #cx-menu { display: none !important; }
`;

export class Chaos {
  constructor(api) {
    this.api = api; this.open = false;
    this.inst = new Map();      // id -> created feature instance
    this.on = new Set();        // ids of toggles that are on
    this.buildDom();
  }
  feature(id) { return FEATURES.find(f => f.id === id); }
  // create on first use; a feature that throws while being created is skipped (never breaks the game)
  get(id) {
    if (this.inst.has(id)) return this.inst.get(id);
    const f = this.feature(id);
    let x = null;
    try { x = f.create(this.api) || {}; } catch (e) { console.warn('[chaos] ' + id, e); this.api.toast(`${f.name} could not start`, 'warn', 2000); }
    this.inst.set(id, x);
    return x;
  }
  call(id, fn, ...args) { const x = this.get(id); if (x && typeof x[fn] === 'function') { try { return x[fn](...args); } catch (e) { console.warn(`[chaos] ${id}.${fn}`, e); } } }
  activate(id) {
    const f = this.feature(id); if (!f) return;
    if (f.kind === 'button') { this.call(id, 'trigger'); this.api.toast(`${f.icon} ${f.name}!`, 'warn', 1600); }
    else {
      const on = !this.on.has(id);
      if (on) this.on.add(id); else this.on.delete(id);
      this.call(id, 'setOn', on);
      this.api.toast(`${f.icon} ${f.name} ${on ? 'ON' : 'off'}`, on ? 'warn' : '', 1400);
    }
    this.api.sound.click();
    this.render();
  }
  toggleMenu() { this.open = !this.open; $('cx-menu').hidden = !this.open; if (this.open) { const m = $('cx-menu'); m.classList.remove('in'); void m.offsetWidth; m.classList.add('in'); this.render(); } }
  // keys: feature hotkeys (F1..F10) go to their feature; returns true if used
  key(code, down) {
    for (const f of FEATURES) {
      if (f.key !== code) continue;
      if (f.kind === 'toggle' && !this.on.has(f.id)) { if (down) this.api.toast(`${f.name} is off · switch it on in the Chaos Menu (\`)`, '', 1800); return true; }
      if (f.kind === 'button' && down && !this.inst.has(f.id)) { this.activate(f.id); return true; }
      this.call(f.id, 'onKey', code, down);
      return true;
    }
    return false;
  }
  update(dt, sdt) { for (const [id, x] of this.inst) if (x && x.update) { try { x.update(dt, sdt); } catch (e) { console.warn(`[chaos] ${id}.update`, e); this.inst.set(id, null); } } }
  onExplode(pos, r, power) { for (const [id, x] of this.inst) if (x && x.onExplode) { try { x.onExplode(pos, r, power); } catch (e) { console.warn(`[chaos] ${id}.onExplode`, e); } } }
  // Backspace / rebuild: every feature cleans up
  reset() { for (const [id, x] of this.inst) if (x && x.reset) { try { x.reset(); } catch (e) { console.warn(`[chaos] ${id}.reset`, e); } } }
  allOff() { for (const id of [...this.on]) { this.on.delete(id); this.call(id, 'setOn', false); } this.reset(); this.render(); this.api.toast('Chaos off', '', 1200); }

  buildDom() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const m = document.createElement('div'); m.id = 'cx-menu'; m.hidden = true;
    m.innerHTML = `<div class="cx-head"><b>🔥 CHAOS MENU 🔥</b><small>crazy stuff · press \` to hide</small></div><div id="cx-body"></div>
      <div class="cx-foot"><span>Toggles stay on until you switch them off · F-keys work while a feature is on</span><span><button class="btn" id="cx-off">All off</button> <button class="btn" id="cx-close">Hide <kbd>\`</kbd></button></span></div>`;
    document.body.appendChild(m);
    $('cx-close').onclick = () => this.toggleMenu();
    $('cx-off').onclick = () => this.allOff();
    m.addEventListener('click', () => { const gl = $('gl'); if (gl) gl.focus(); });
  }
  render() {
    if (!this.open) return;
    const body = $('cx-body');
    body.innerHTML = FEATURES.map(f => `<button class="cx-card" data-id="${f.id}" aria-pressed="${this.on.has(f.id)}"><em>${f.icon}</em><b>${f.name}${f.key ? `<kbd>${f.key}</kbd>` : ''}</b><span>${f.desc}</span></button>`).join('');
    body.querySelectorAll('.cx-card').forEach(b => { b.onclick = () => this.activate(b.dataset.id); });
  }
}
