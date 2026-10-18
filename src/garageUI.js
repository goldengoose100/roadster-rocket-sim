// Garage screen: trim picker, Upgrades / Style / Builds tabs and the live stats card.
// All changes go through the Profile; ctx.apply() pushes them onto the car.
import { TRIMS } from './config.js';
import { UPGRADES, PRICES, COSMETICS, KIND_NAMES, findItem, carStats } from './garage.js';
import { SKINS, CASES, RARITY, rollSkin, swatchCss } from './skins.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const STAT_ROWS = [
  ['z60', '0-60 mph', (v) => v.toFixed(2) + ' s', (a, b) => b < a - 0.005, 0.4, 1.8, true],
  ['top', 'Top speed', (v) => Math.round(v) + ' mph', (a, b) => b > a + 0.5, 200, 270],
  ['gripFan', 'Grip (with fan)', (v) => v.toFixed(1) + ' g', (a, b) => b > a + 0.02, 1, 4.6],
  ['down', 'Fan downforce', (v) => fmt(v) + ' kg', (a, b) => b > a + 1, 0, 6500],
  ['thrust', 'Total thrust', (v) => Math.round(v) + ' kN', (a, b) => b > a + 0.5, 0, 180],
  ['air', 'Air', (v) => Math.round(v) + ' kg', (a, b) => b > a + 0.5, 0, 400],
  ['hover', 'Hover time', (v) => v ? v.toFixed(1) + ' s' : 'no lift', (a, b) => b > a + 0.05, 0, 12],
];

export class GarageUI {
  constructor(profile, ctx) {
    this.p = profile; this.ctx = ctx;
    this.tab = 'up';
    this.preview = null;     // { kind, id } of a locked part being tried on
    this.statsCache = new Map();
    for (const [id, tab] of [['gt-up', 'up'], ['gt-style', 'style'], ['gt-skins', 'skins'], ['gt-builds', 'builds']]) $(id).onclick = () => { if (this.spinning) return; this.clearPreview(); this.tab = tab; this.render(); };
    $('g-done').onclick = () => ctx.close();
    const tr = $('g-trims');
    for (const t of Object.values(TRIMS)) {
      const b = document.createElement('button'); b.id = 'g-trim-' + t.id; b.textContent = t.name;
      b.onclick = () => { ctx.setTrim(t.id); this.render(); };
      tr.appendChild(b);
    }
  }
  open() { this.isOpen = true; this.statsCache.clear(); this.render(); }
  close() { this.isOpen = false; this.clearPreview(); if (this.ticker) { clearInterval(this.ticker); this.ticker = null; } }
  clearPreview() { if (this.preview) { this.preview = null; this.ctx.apply(); } }

  render() {
    const p = this.p;
    $('g-cr').textContent = p.cheats.unlimited ? '∞' : fmt(p.credits);
    for (const t of Object.values(TRIMS)) $('g-trim-' + t.id).setAttribute('aria-pressed', String(t.id === this.ctx.trimId()));
    for (const [id, tab] of [['gt-up', 'up'], ['gt-style', 'style'], ['gt-skins', 'skins'], ['gt-builds', 'builds']]) $(id).setAttribute('aria-pressed', String(tab === this.tab));
    const body = $('g-body');
    body.innerHTML = '';
    if (this.tab === 'up') this.renderUpgrades(body);
    else if (this.tab === 'style') this.renderStyle(body);
    else if (this.tab === 'skins') this.renderSkins(body);
    else this.renderBuilds(body);
    this.renderStats();
    const c = this.ctx.condition();
    $('g-cond').innerHTML = c.text;
    $('g-cond').dataset.bad = c.bad ? '1' : '0';
  }

  renderUpgrades(body) {
    const p = this.p;
    for (const u of UPGRADES) {
      const owned = p.owned(u.id), lvl = p.level(u.id), next = owned + 1;
      const row = document.createElement('div'); row.className = 'gup'; row.id = 'gu-' + u.id;
      const pips = [0, 1, 2, 3].map(l => `<button class="pip" data-l="${l}" aria-label="${u.name} level ${l}" aria-pressed="${l === lvl}" ${l > owned ? 'disabled' : ''}>${l ? 'L' + l : 'Stock'}</button>`).join('');
      const price = next <= 3 ? PRICES[next] : 0;
      const buy = next <= 3
        ? `<button class="btn gbuy" id="gb-${u.id}" ${p.canAfford(price) ? '' : 'data-poor="1"'}>Buy L${next} · ${p.cheats.unlimited ? 'free' : fmt(price) + ' CR'}</button>`
        : '<span class="gmax">MAXED</span>';
      row.innerHTML = `<div class="gun"><b>${u.name}</b><span>${u.tag}</span></div><div class="gpips">${pips}</div>${buy}<p class="gtx">${u.text(lvl)}</p>`;
      row.querySelectorAll('.pip').forEach(b => { b.onclick = () => { p.setLevel(u.id, +b.dataset.l); this.ctx.apply(); this.ctx.sound.click(); this.render(); }; });
      const bb = row.querySelector('.gbuy');
      if (bb) {
        bb.onclick = () => {
          if (p.buyUpgrade(u.id)) { this.ctx.apply(); this.ctx.sound.pickup(); this.ctx.toast(`${u.name} L${next} fitted`, 'good', 1800); }
          else { this.ctx.sound.warn(); this.ctx.toast(`Not enough credits: ${u.name} L${next} costs ${fmt(price)} CR`, 'warn', 2200); }
          this.render();
        };
        // preview the next level in the stats card
        const levels = () => ({ ...p.levels(), [u.id]: next });
        bb.onmouseenter = bb.onfocus = () => this.renderStats(levels());
        bb.onmouseleave = bb.onblur = () => this.renderStats();
      }
      body.appendChild(row);
    }
  }

  renderStyle(body) {
    const p = this.p, look = p.look();
    for (const kind of Object.keys(COSMETICS)) {
      const sec = document.createElement('div'); sec.className = 'gsec';
      const cur = this.preview && this.preview.kind === kind ? this.preview.id : look[kind];
      const swatch = kind === 'paint' || kind === 'glow' || kind === 'smoke';
      let html = `<h3>${KIND_NAMES[kind]} <span>${esc(findItem(kind, cur).name)}</span></h3><div class="${swatch ? 'gsw' : 'gchips'}">`;
      for (const it of COSMETICS[kind]) {
        const has = p.hasPart(kind, it.id);
        const col = it.color || 'transparent';
        const lock = has ? '' : `<i class="lock">${fmt(it.price)}</i>`;
        html += swatch
          ? `<button class="sw${it.color ? '' : ' none'}" data-id="${it.id}" title="${esc(it.name)}${has ? '' : ' · ' + fmt(it.price) + ' CR'}" aria-label="${esc(it.name)}" aria-pressed="${it.id === cur}" style="background:${col}">${lock}</button>`
          : `<button class="chip2" data-id="${it.id}" aria-pressed="${it.id === cur}">${esc(it.name)}${lock}</button>`;
      }
      html += '</div>';
      if (this.preview && this.preview.kind === kind) {
        const it = findItem(kind, this.preview.id);
        html += `<div class="gprev">Trying on <b>${esc(it.name)}</b> <button class="btn gbuy" id="gpb-${kind}" ${p.canAfford(it.price) ? '' : 'data-poor="1"'}>Buy · ${p.cheats.unlimited ? 'free' : fmt(it.price) + ' CR'}</button></div>`;
      }
      sec.innerHTML = html;
      sec.querySelectorAll('button[data-id]').forEach(b => {
        b.onclick = () => {
          const id = b.dataset.id;
          if (p.hasPart(kind, id)) { this.preview = null; p.setPart(kind, id); if (kind === 'paint') p.setSkin(null); this.ctx.apply(); }
          else { this.preview = { kind, id }; this.ctx.apply({ [kind]: id }); }
          this.ctx.sound.click(); this.render();
        };
      });
      const pb = sec.querySelector('#gpb-' + kind);
      if (pb) pb.onclick = () => {
        const it = findItem(kind, this.preview.id);
        if (p.buyPart(kind, it.id)) { this.preview = null; if (kind === 'paint') p.setSkin(null); this.ctx.apply(); this.ctx.sound.pickup(); this.ctx.toast(`${it.name} bought`, 'good', 1600); }
        else { this.ctx.sound.warn(); this.ctx.toast(`Not enough credits: ${it.name} costs ${fmt(it.price)} CR`, 'warn', 2200); }
        this.render();
      };
      body.appendChild(sec);
    }
  }

  renderSkins(body) {
    const p = this.p;
    const fmtOdds = (c) => Object.entries(c.odds).filter(([, v]) => v).map(([k, v]) => `<i style="color:${RARITY[k].col}">${v}%</i>`).join(' ');
    let html = '<div class="gcases">';
    for (const c of CASES) html += `<div class="gcase" style="--cc:${c.col}"><div class="gcase-box"></div><b>${c.name}</b><span class="godds">${fmtOdds(c)}</span>
      <button class="btn gbuy" id="gopen-${c.id}" ${p.canAfford(c.price) ? '' : 'data-poor="1"'}>Open · ${p.cheats.unlimited ? 'free' : fmt(c.price) + ' CR'}</button></div>`;
    html += '</div><div class="greel" id="greel" hidden><div class="greel-strip" id="greel-strip"></div><i class="greel-mark"></i></div><div id="gwin" class="gwin" hidden></div>';
    const col = p.collection();
    html += `<h3 class="gcol">Your skins <span>${col.have}/${col.total} collected · ${p.d.opened} cases opened</span></h3><div class="gskins">`;
    const cur = p.skin() ? p.skin().id : null;   // the skin actually fitted (a Dev skin drops off when its cheat is off)
    html += `<button class="gskin" data-id="" aria-pressed="${!cur}" style="--rc:#5d6873"><i style="background:${findItem('paint', p.look().paint).color}"></i><span>Plain paint</span></button>`;
    const show = SKINS.filter(s => p.hasSkin(s.id));
    for (const s of show) html += `<button class="gskin${s.rarity === 'dev' ? ' dev' : ''}" data-id="${s.id}" aria-pressed="${s.id === cur}" style="--rc:${RARITY[s.rarity].col}" title="${esc(RARITY[s.rarity].name)}"><i style="background:${swatchCss(s)}"></i><span>${esc(s.name)}</span></button>`;
    html += '</div>';
    if (!show.length) html += '<p class="gtx">Open a case to win your first skin. Grey is common, gold is legendary.</p>';
    body.innerHTML = html;
    body.querySelectorAll('.gskin').forEach(b => { b.onclick = () => { if (this.spinning) return; p.setSkin(b.dataset.id || null); this.ctx.apply(); this.ctx.sound.click(); this.render(); }; });
    for (const c of CASES) $('gopen-' + c.id).onclick = () => this.openCase(c);
  }
  // spin a reel of skins and land on the one the case gave
  openCase(c) {
    if (this.spinning) return;
    const res = this.p.openCase(c.id);
    if (!res) { this.ctx.sound.warn(); this.ctx.toast(`Not enough credits: ${c.name} costs ${fmt(c.price)} CR`, 'warn', 2200); return; }
    this.spinning = true;
    $('g-cr').textContent = this.p.cheats.unlimited ? '∞' : fmt(this.p.credits);
    const strip = $('greel-strip'), N = 46, WIN = 40;
    let tiles = '';
    for (let i = 0; i < N; i++) {
      const s = i === WIN ? res.skin : rollSkin(c);
      tiles += `<div class="gtile" style="--rc:${RARITY[s.rarity].col}"><i style="background:${swatchCss(s)}"></i><span>${esc(s.name)}</span></div>`;
    }
    strip.innerHTML = tiles;
    $('greel').hidden = false; $('gwin').hidden = true;
    strip.style.transition = 'none'; strip.style.transform = 'translateX(0)';
    void strip.offsetWidth;
    const tileW = 112, reelW = $('greel').clientWidth || 440;
    const x = -(WIN * tileW + tileW / 2 - reelW / 2) + (Math.random() - 0.5) * 60;
    strip.style.transition = 'transform 4.2s cubic-bezier(.12,.75,.1,1)';
    strip.style.transform = `translateX(${x}px)`;
    let tick = 0;
    this.ticker = setInterval(() => { tick++; if (tick % Math.ceil(1 + tick / 8) === 0) this.ctx.sound.click(); }, 60);
    setTimeout(() => {
      if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
      this.spinning = false;
      // garage closed mid-spin: keep the skin, repaint the car, no fanfare and no trim reset during the drive
      if (!this.isOpen) { if (!res.dup) { this.p.setSkin(res.skin.id); this.ctx.look(); } return; }
      const r = RARITY[res.skin.rarity];
      const w = $('gwin');
      if (!w) return;
      w.hidden = false; w.style.setProperty('--rc', r.col);
      w.innerHTML = `<span>${r.name}</span><b>${esc(res.skin.name)}</b>${res.dup ? `<em>Duplicate · +${fmt(res.refund)} CR back</em>` : '<em>New skin! Equipped.</em>'}`;
      if (!res.dup) { this.p.setSkin(res.skin.id); this.ctx.apply(); }
      this.ctx.sound.record();
      if (res.skin.rarity === 'gold' || res.skin.rarity === 'purple') this.ctx.toast(`${r.name}: ${res.skin.name}!`, 'good', 3000);
      setTimeout(() => { if (this.tab === 'skins' && !this.spinning) this.render(); }, 2600);
    }, 4400);
  }

  renderBuilds(body) {
    const p = this.p;
    const intro = document.createElement('p'); intro.className = 'gtx';
    intro.textContent = 'A build remembers the trim, upgrade levels and looks. Loading only fits parts you own.';
    body.appendChild(intro);
    p.d.builds.forEach((b, i) => {
      const card = document.createElement('div'); card.className = 'gbuild'; card.id = 'gbuild-' + i;
      const sum = b ? `${TRIMS[b.trim] ? TRIMS[b.trim].name : b.trim} · ` + UPGRADES.map(u => `${u.name.split(' ')[0]} ${b.levels[u.id] ? 'L' + b.levels[u.id] : '-'}`).join(' · ') : 'Empty slot';
      const paint = b ? findItem('paint', b.paint) : null;
      card.innerHTML = `<div class="gbh">${paint ? `<i class="dot" style="background:${paint.color}"></i>` : ''}<b>Build ${i + 1}</b>${b ? `<span>${esc(findItem('wheels', b.wheels).name)} · ${esc(findItem('wing', b.wing).name)}</span>` : ''}</div><p>${esc(sum)}</p>
        <div class="btnrow"><button class="btn" data-a="save">Save current here</button>${b ? '<button class="btn primary" data-a="load">Load</button>' : ''}</div>`;
      card.querySelector('[data-a=save]').onclick = () => { p.saveBuild(i, this.ctx.trimId()); this.ctx.toast(`Saved as build ${i + 1}`, 'good', 1500); this.ctx.sound.click(); this.render(); };
      const lb = card.querySelector('[data-a=load]');
      if (lb) lb.onclick = () => { const bb = p.loadBuild(i); if (bb && TRIMS[bb.trim]) this.ctx.setTrim(bb.trim, true); this.ctx.apply(); this.ctx.toast(`Build ${i + 1} loaded`, 'ice', 1500); this.ctx.sound.click(); this.render(); };
      body.appendChild(card);
    });
  }

  stats(levels) {
    const key = this.ctx.trimId() + '|' + JSON.stringify(levels) + '|' + this.ctx.phys2();
    if (!this.statsCache.has(key)) this.statsCache.set(key, carStats(TRIMS[this.ctx.trimId()], this.p, levels, this.ctx.phys2()));
    return this.statsCache.get(key);
  }
  renderStats(previewLevels) {
    const p = this.p, base = { motor: 0, tires: 0, fan: 0, thrust: 0, tank: 0 };
    const cur = this.stats(p.levels()), stock = this.stats(base), next = previewLevels ? this.stats(previewLevels) : null;
    let html = '<h3>Live stats <span>measured on a test drive</span></h3>';
    for (const [k, name, f, better, lo, hi, invert] of STAT_ROWS) {
      const v = (next || cur)[k];
      const frac = Math.max(0.02, Math.min(1, (invert ? hi - v : v - lo) / (hi - lo)));
      const sFrac = Math.max(0.02, Math.min(1, (invert ? hi - stock[k] : stock[k] - lo) / (hi - lo)));
      const delta = next && better(cur[k], next[k]) ? ' up' : (!next && better(stock[k], cur[k]) ? ' gain' : '');
      html += `<div class="gst${delta}" id="gs-${k}"><span>${name}</span><div class="gbar"><i class="s" style="width:${(sFrac * 100).toFixed(1)}%"></i><i class="c" style="width:${(frac * 100).toFixed(1)}%"></i></div><b class="num">${f(v)}</b></div>`;
    }
    $('g-stats').innerHTML = html;
  }
}
