// Map picker (2.5): a "MAP" row on the start screen with one card per map (name, one-line
// description and a small CSS-drawn picture). Clicking a different map shows "Loading <name>…"
// and calls onPick(id); main.js saves the choice and reloads the game.
// Built to never throw: if the start screen markup is missing, the row is simply not shown.

export const DEFAULT_MAPS = [
  { id: 'desert', name: 'Desert Test Site', desc: 'The original: ramps, loop, canyon, weapons range', col: '#ffb547' },
  { id: 'moon', name: 'The Moon', desc: '1/6 gravity, craters, Earth in the sky', col: '#cfd6e6' },
  { id: 'neon', name: 'Neon City', desc: 'Night city: tunnels, skyway, rooftop jumps', col: '#ff2bd6' },
];

const NAMES = new Map(DEFAULT_MAPS.map(m => [m.id, m.name]));

// Name of a map for labels such as the pause menu ("Map: The Moon").
export function mapLabel(id) {
  try {
    const k = id == null || id === '' ? DEFAULT_MAPS[0].id : String(id);
    if (NAMES.has(k)) return NAMES.get(k);
    return k.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch (_) { return DEFAULT_MAPS[0].name; }
}

// picture layers per map (each one is an <i> styled below); unknown maps get a plain colour wash
const ART = {
  desert: ['sun', 'mesa', 'dune1', 'dune2'],
  moon: ['stars', 'earth', 'ground', 'crater c1', 'crater c2', 'crater c3'],
  neon: ['glow', 'b b1', 'b b2', 'b b3', 'b b4', 'b b5', 'b b6', 'floor'],
};
const ICE = '#7fe3ff';
const STYLE_ID = 'mp-style';
const ROW_ID = 'mp-row';
const PICK_DELAY = 60;      // ms: lets the "Loading…" state paint before onPick does heavy work
const LOAD_TIMEOUT = 8000;  // ms: a page reload normally replaces everything long before this

const warn = (...a) => { try { console.warn('[mappicker]', ...a); } catch (_) { /* no console */ } };
const safeCol = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%]+\))$/i.test(c.trim()) ? c.trim() : ICE);
function rgba(col, a) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(col);
  if (!m) return `rgba(127,227,255,${a})`;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function normalize(maps) {
  const out = [], seen = new Set();
  for (const m of Array.isArray(maps) ? maps : []) {
    if (!m || typeof m !== 'object' || m.id == null || m.id === '') continue;
    const id = String(m.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: m.name ? String(m.name) : mapLabel(id), desc: m.desc ? String(m.desc) : '', col: safeCol(m.col) });
  }
  return out.length ? out : DEFAULT_MAPS.map(m => ({ ...m }));
}
function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

const F = 'var(--f-display, "Barlow Condensed", "Arial Narrow", sans-serif)';
const CSS = `
.mp-row { display: grid; gap: 6px; min-width: 0; }
.mp-head { display: flex; align-items: baseline; gap: 10px; min-height: .75rem; }
.mp-label { font: 600 .68rem/1 ${F}; letter-spacing: .14em; text-transform: uppercase; color: var(--muted, #8d9aa6); }
.mp-status { font: 700 .7rem/1 ${F}; letter-spacing: .1em; text-transform: uppercase; color: var(--ice, ${ICE}); }
.mp-status.mp-err { color: var(--red, #ff4d4d); }
.mp-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mp-card { position: relative; display: grid; grid-template-rows: auto 1fr; gap: 7px; align-content: start; min-width: 0; margin: 0; padding: 8px; border-radius: 10px; border: 1px solid var(--line, rgba(196,220,235,.13)); background: rgba(255,255,255,.035); color: var(--ink, #eef2f5); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s, background-color .15s, opacity .2s; }
.mp-card:hover { background: rgba(255,255,255,.07); border-color: rgba(196,220,235,.3); }
.mp-card[aria-pressed="true"] { border-color: var(--mp-c, ${ICE}); background: var(--mp-bg, rgba(127,227,255,.08)); box-shadow: inset 0 0 0 1px var(--mp-g, rgba(127,227,255,.35)); }
.mp-card:focus-visible { outline: 2px solid var(--ice, ${ICE}); outline-offset: 2px; }
.mp-busy .mp-card:not(.mp-loading) { opacity: .45; cursor: default; }
.mp-txt { display: grid; gap: 3px; min-width: 0; padding: 0 2px 2px; }
.mp-name { font: 800 1.08rem/1.05 ${F}; letter-spacing: .05em; text-transform: uppercase; overflow-wrap: anywhere; }
.mp-desc { font-size: .74rem; line-height: 1.3; color: #b7c3cc; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.mp-art { position: relative; display: block; height: 52px; border-radius: 7px; overflow: hidden; background: #0d1014; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
.mp-art i { position: absolute; display: block; }
.mp-tick { position: absolute; z-index: 3; top: 5px; left: 5px; display: none; padding: 3px 5px; border-radius: 4px; background: rgba(5,7,9,.74); color: var(--mp-c, ${ICE}); font: 700 .58rem/1 ${F}; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.mp-card[aria-pressed="true"] .mp-tick { display: block; }
.mp-loading .mp-art::after { content: ""; position: absolute; inset: 0; z-index: 2; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.3) 50%, transparent 70%) 0 0 / 220% 100%; animation: mpSweep 1s linear infinite; }
@keyframes mpSweep { from { background-position: 120% 0; } to { background-position: -120% 0; } }

/* desert: warm sky, sun, a mesa and two dunes */
.mp-a-desert { background: linear-gradient(180deg, #ff8f4f 0%, #ffbd73 50%, #ffe0a6 78%); }
.mp-a-desert .sun { right: 16%; top: 8px; width: 17px; height: 17px; border-radius: 50%; background: radial-gradient(circle at 40% 40%, #fffbe6, #ffe08a 60%, #ffc35a); box-shadow: 0 0 10px 4px rgba(255,226,140,.55); }
.mp-a-desert .mesa { left: 8%; bottom: 40%; width: 26%; height: 30%; background: #c4703a; opacity: .85; clip-path: polygon(0 100%, 14% 18%, 22% 0, 70% 0, 82% 30%, 100% 100%); }
.mp-a-desert .dune1 { left: -20%; width: 90%; bottom: -60%; height: 110%; border-radius: 50%; background: linear-gradient(#eaa457, #c97a35 60%); }
.mp-a-desert .dune2 { left: 32%; width: 100%; bottom: -70%; height: 116%; border-radius: 50%; background: linear-gradient(#d68b3f, #a85c25 60%); }

/* moon: black sky, stars, blue Earth, grey ground with craters */
.mp-a-moon { background: linear-gradient(180deg, #02030a 0%, #070a16 70%); }
.mp-a-moon .stars { left: 0; top: 0; width: 1px; height: 1px; box-shadow: 12px 6px #fff, 34px 15px rgba(255,255,255,.6), 58px 4px #fff, 80px 20px rgba(255,255,255,.55), 104px 9px rgba(255,255,255,.85), 132px 22px rgba(255,255,255,.5), 150px 5px #fff, 24px 25px rgba(255,255,255,.45), 186px 17px rgba(255,255,255,.7), 212px 7px #fff, 70px 11px rgba(255,255,255,.4); }
.mp-a-moon .earth { right: 15%; top: 6px; width: 17px; height: 17px; border-radius: 50%; background: radial-gradient(circle at 34% 40%, #7be08a 0 17%, transparent 19%), radial-gradient(circle at 62% 66%, #6fd37f 0 13%, transparent 15%), radial-gradient(circle at 40% 35%, #6cc6ff, #2a6fd6 70%, #17408a); box-shadow: 0 0 8px 2px rgba(90,170,255,.45), inset -5px -2px 0 rgba(0,0,12,.55); }
.mp-a-moon .ground { left: -10%; right: -10%; bottom: -40%; height: 85%; border-radius: 50% 50% 0 0 / 30% 30% 0 0; background: linear-gradient(#bcc3cf, #7e8694); }
.mp-a-moon .crater { border-radius: 50%; background: radial-gradient(closest-side, #5f6674 0 50%, #8b93a1 68%, #dde2ea 86%, transparent 100%); }
.mp-a-moon .c1 { left: 12%; bottom: 14%; width: 26px; height: 8px; }
.mp-a-moon .c2 { left: 50%; bottom: 5%; width: 34px; height: 10px; }
.mp-a-moon .c3 { left: 76%; bottom: 27%; width: 16px; height: 5px; }

/* neon city: night sky, pink/cyan skyline, glowing street grid */
.mp-a-neon { background: linear-gradient(180deg, #0b0418 0%, #24093a 62%, #4a0f55 100%); }
.mp-a-neon .glow { left: 0; right: 0; bottom: 14%; height: 45%; background: radial-gradient(60% 100% at 50% 100%, rgba(255,43,214,.5), transparent 72%); }
.mp-a-neon .b { bottom: 14%; border-top: 2px solid #ff2bd6; background: radial-gradient(circle, rgba(255,220,250,.7) 0 .7px, transparent 1.1px) 1px 3px / 4px 5px, #160a26; box-shadow: 0 -1px 6px rgba(255,43,214,.7); }
.mp-a-neon .b1, .mp-a-neon .b3, .mp-a-neon .b5 { border-top-color: #3df2ff; box-shadow: 0 -1px 6px rgba(61,242,255,.7); }
.mp-a-neon .b1 { left: 2%; width: 14%; height: 46%; }
.mp-a-neon .b2 { left: 17%; width: 11%; height: 68%; }
.mp-a-neon .b3 { left: 30%; width: 18%; height: 52%; }
.mp-a-neon .b4 { left: 50%; width: 12%; height: 80%; }
.mp-a-neon .b5 { left: 64%; width: 17%; height: 58%; }
.mp-a-neon .b6 { left: 83%; width: 15%; height: 40%; }
.mp-a-neon .floor { left: 0; right: 0; bottom: 0; height: 14%; background: linear-gradient(90deg, #ff2bd6, #3df2ff) 0 0 / 100% 1px no-repeat, repeating-linear-gradient(90deg, rgba(61,242,255,.35) 0 1px, transparent 1px 10px), #12051f; }

.mp-a-gen { background: linear-gradient(135deg, var(--mp-c, ${ICE}), #0b0e12 85%); }

@media (max-width: 520px) {
  .mp-cards { grid-template-columns: 1fr; gap: 8px; }
  .mp-card { grid-template-columns: 92px minmax(0, 1fr); grid-template-rows: none; align-items: center; gap: 10px; padding: 7px; }
  .mp-art { height: 46px; }
}
@media (max-height: 860px) and (min-width: 761px) {
  .mp-card { gap: 5px; padding: 7px; }
  .mp-art { height: 40px; }
  .mp-desc { -webkit-line-clamp: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .mp-card { transition: none; }
  .mp-loading .mp-art::after { animation: none; background: rgba(255,255,255,.14); }
}
`;

function injectStyle() {
  if (document.getElementById && document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  const host = document.head || document.body || document.documentElement;
  if (host) host.appendChild(s);
}

export class MapPicker {
  constructor({ maps, current, onPick } = {}) {
    this.maps = normalize(maps);
    for (const m of this.maps) NAMES.set(m.id, m.name);
    const cur = current == null ? '' : String(current);
    this.current = this.maps.some(m => m.id === cur) ? cur : this.maps[0].id;
    this.onPick = typeof onPick === 'function' ? onPick : null;
    this.busy = false;
    this.el = null;
    this.cards = new Map();
    this.ticks = new Map();
    this._timer = 0;
    this._msgTimer = 0;
    try { this.build(); } catch (err) { warn('could not build the map picker', err); this.el = null; }
  }

  build() {
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') return;
    injectStyle();
    const old = document.getElementById && document.getElementById(ROW_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);   // constructed twice: keep one row

    const row = mk('div', 'mp-row');
    row.id = ROW_ID;
    const head = mk('div', 'mp-head');
    const label = mk('span', 'mp-label', 'Map');
    label.id = 'mp-label';
    const status = mk('span', 'mp-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    head.appendChild(label);
    head.appendChild(status);
    const grid = mk('div', 'mp-cards');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-labelledby', 'mp-label');
    for (const m of this.maps) grid.appendChild(this.buildCard(m));
    row.appendChild(head);
    row.appendChild(grid);
    this.el = row;
    this.statusEl = status;
    this.sync();
    this.mount();
  }

  buildCard(m) {
    const b = mk('button', 'mp-card');
    b.setAttribute('type', 'button');
    b.setAttribute('data-map', m.id);
    b.setAttribute('aria-pressed', 'false');
    b.title = m.desc ? `${m.name}: ${m.desc}` : m.name;
    if (b.style && typeof b.style.setProperty === 'function') {
      b.style.setProperty('--mp-c', m.col);
      b.style.setProperty('--mp-g', rgba(m.col, 0.35));
      b.style.setProperty('--mp-bg', rgba(m.col, 0.08));
    }
    const layers = ART[m.id];
    const art = mk('span', 'mp-art ' + (layers ? 'mp-a-' + m.id : 'mp-a-gen'));
    art.setAttribute('aria-hidden', 'true');
    for (const cls of layers || []) art.appendChild(mk('i', cls));
    const tick = mk('span', 'mp-tick', 'Selected');
    art.appendChild(tick);
    const txt = mk('span', 'mp-txt');
    txt.appendChild(mk('span', 'mp-name', m.name));
    if (m.desc) txt.appendChild(mk('span', 'mp-desc', m.desc));
    b.appendChild(art);
    b.appendChild(txt);
    b.addEventListener('click', () => this.pick(m.id));
    b.addEventListener('keydown', (e) => this.onKey(e, m.id));
    this.cards.set(m.id, b);
    this.ticks.set(m.id, tick);
    return b;
  }

  // Put the row just above the "Start driving" button row; fall back to the end of the start panel.
  mount() {
    if (!this.el || !document.getElementById) return false;
    const start = document.getElementById('start');
    if (!start) { warn('#start not found; map picker not shown'); return false; }
    const go = document.getElementById('go');
    let anchor = null;
    if (go && go !== start && within(go, start)) anchor = go.parentNode && go.parentNode !== start ? go.parentNode : go;
    if (anchor && anchor.parentNode && typeof anchor.parentNode.insertBefore === 'function') {
      anchor.parentNode.insertBefore(this.el, anchor);
    } else {
      const wrap = typeof start.querySelector === 'function' ? start.querySelector('.wrap') : null;
      (wrap || start).appendChild(this.el);
    }
    return true;
  }

  onKey(e, id) {
    try {
      const k = e.key, c = e.code;
      if (k === 'Enter' || k === ' ' || c === 'Enter' || c === 'NumpadEnter' || c === 'Space') {
        // the start screen starts the game on Enter: picking a different map must not do that too
        if (this.busy || id !== this.current) e.stopPropagation();
        return;
      }
      const ids = this.maps.map(m => m.id);
      let i = ids.indexOf(id);
      if (k === 'ArrowRight' || k === 'ArrowDown') i = (i + 1) % ids.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') i = (i - 1 + ids.length) % ids.length;
      else if (k === 'Home') i = 0;
      else if (k === 'End') i = ids.length - 1;
      else return;
      if (e.preventDefault) e.preventDefault();
      const next = this.cards.get(ids[i]);
      if (next && typeof next.focus === 'function') next.focus();
    } catch (err) { warn('key handling failed', err); }
  }

  pick(id) {
    try {
      if (this.busy) return;
      const m = this.maps.find(x => x.id === String(id));
      if (!m || m.id === this.current) return;
      const prev = this.current;
      this.busy = true;
      this.current = m.id;
      this.sync();
      const card = this.cards.get(m.id);
      if (card) { card.classList.add('mp-loading'); card.setAttribute('aria-busy', 'true'); }
      const tick = this.ticks.get(m.id);
      if (tick) tick.textContent = 'Loading…';
      if (this.el) this.el.classList.add('mp-busy');
      this.setStatus(`Loading ${m.name}…`);
      setTimeout(() => this.fire(m.id, prev), PICK_DELAY);
    } catch (err) {
      warn('pick failed', err);
      this.busy = false;
    }
  }

  fire(id, prev) {
    let r;
    try {
      r = this.onPick ? this.onPick(id) : undefined;
    } catch (err) {
      warn('onPick failed', err);
      this.finish(prev, `Couldn't load ${mapLabel(id)}`);
      return;
    }
    if (r && typeof r.then === 'function') {
      r.then(() => this.finish(id), (err) => { warn('onPick failed', err); this.finish(prev, `Couldn't load ${mapLabel(id)}`); });
    } else {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.finish(id), LOAD_TIMEOUT);
    }
  }

  // end the loading state, with `id` as the highlighted map (and an optional error note)
  finish(id, msg = '') {
    try {
      clearTimeout(this._timer);
      this.busy = false;
      if (this.maps.some(m => m.id === id)) this.current = id;
      for (const card of this.cards.values()) { card.classList.remove('mp-loading'); card.removeAttribute('aria-busy'); }
      if (this.el) this.el.classList.remove('mp-busy');
      this.sync();
      this.setStatus(msg, !!msg);
      if (msg) {
        clearTimeout(this._msgTimer);
        this._msgTimer = setTimeout(() => this.setStatus(''), 3500);
      }
    } catch (err) { warn('finish failed', err); }
  }

  // for main.js if it switches maps without a page reload
  setCurrent(id) { this.finish(id == null ? this.current : String(id)); }

  sync() {
    for (const [id, card] of this.cards) card.setAttribute('aria-pressed', String(id === this.current));
    for (const [id, tick] of this.ticks) if (!(this.busy && id === this.current)) tick.textContent = 'Selected';
  }

  setStatus(text, isErr = false) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text || '';
    if (this.statusEl.classList) this.statusEl.classList.toggle('mp-err', !!isErr);
  }

  destroy() {
    try {
      clearTimeout(this._timer); clearTimeout(this._msgTimer);
      if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
      this.el = null;
    } catch (_) { /* already gone */ }
  }
}

function within(el, root) {
  if (typeof root.contains === 'function') { try { return root.contains(el); } catch (_) { /* fall through */ } }
  for (let n = el; n; n = n.parentNode) if (n === root) return true;
  return false;
}
