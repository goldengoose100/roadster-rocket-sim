// Dashboard + overlays: speed cluster, thruster diagram, air tank, attitude indicator,
// minimap, big map, timers, zone banners and toasts.
import { MPH, KMH, PHYS } from './config.js';
import { ZONES } from './terrain.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

// thruster diagram positions (svg units, front = up)
const DOT_POS = {
  rear: [[10, 74], [-10, 74], [20, 70], [-20, 70]],
  lift: [[-26, -50], [26, -50], [-26, 50], [26, 50]],
  side: [[-37, -60], [37, -60]],
};
// note: car local +x = left side of the car, which is drawn on the left (negative svg x)

export class HUD {
  constructor() {
    this.units = 'mph';
    this.el = {};
    for (const id of ['spd', 'unit', 'kw', 'gg', 'kn', 'pwr', 'regen', 'air-ring', 'air-kg', 'air-sub', 'air-hover', 'fan-kg', 'fan-bar', 'h-mode', 'h-trim',
      'c-assist', 'c-fan', 'c-air', 'c-cam', 'c-gun', 'f-alt', 'f-vs', 'f-pitch', 'f-roll', 'f-air', 'ammo', 'xh', 't-060', 't-060b', 't-qm', 't-top', 't-ringw', 't-ring', 't-ringt',
      'z-name', 'z-tip', 'zone', 'compass', 'flash']) this.el[id] = $(id);
    this.gears = { P: $('g-P'), R: $('g-R'), N: $('g-N'), D: $('g-D') };
    this.mini = $('minimap').getContext('2d');
    this.adi = $('adi').getContext('2d');
    this.toasts = $('toasts');
    this.zoneTimer = 0;
    this.t = 0;
    this.dots = [];
    this.lastText = {};
  }

  setText(id, v) { if (this.lastText[id] !== v) { this.lastText[id] = v; this.el[id].textContent = v; } }

  buildThrusterDots(vehicle) {
    const g = $('tdots');
    g.innerHTML = '';
    this.dots = [];
    const counters = { rear: 0, lift: 0, side: 0 };
    for (const t of vehicle.thrusters) {
      const [x, y] = DOT_POS[t.group][counters[t.group]++];
      const halo = document.createElementNS(SVGNS, 'circle');
      halo.setAttribute('cx', x); halo.setAttribute('cy', y); halo.setAttribute('r', 9);
      halo.setAttribute('fill', '#7fe3ff'); halo.setAttribute('opacity', 0);
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', t.group === 'side' ? 3.5 : 4.5);
      dot.setAttribute('class', 'tdot');
      g.appendChild(halo); g.appendChild(dot);
      this.dots.push({ t, dot, halo, last: -1 });
    }
    if (!vehicle.thrusters.length) {
      const tx = document.createElementNS(SVGNS, 'text');
      tx.setAttribute('x', 0); tx.setAttribute('y', 4); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('fill', '#5d6873'); tx.setAttribute('font-size', '9');
      tx.setAttribute('font-family', 'Barlow Condensed, sans-serif'); tx.textContent = 'NO THRUSTERS';
      g.appendChild(tx);
    }
  }

  toast(msg, kind = '', ms = 2600) {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = msg;
    this.toasts.prepend(d);
    while (this.toasts.children.length > 4) this.toasts.lastChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, ms);
  }

  showZone(z) {
    this.el['z-name'].textContent = z.name;
    this.el['z-tip'].textContent = z.tip;
    this.el.zone.classList.add('show');
    this.zoneTimer = 4.5;
  }

  flash(a) { this.el.flash.style.opacity = a; }

  update(dt, s) {
    this.t += dt;
    const v = s.vehicle;
    if (this.zoneTimer > 0) { this.zoneTimer -= dt; if (this.zoneTimer <= 0) this.el.zone.classList.remove('show'); }
    const conv = this.units === 'mph' ? MPH : KMH;
    const speed = v.vel.length();
    this.setText('spd', String(Math.round(speed * conv)));
    this.setText('unit', this.units === 'mph' ? 'MPH' : 'KM/H');
    const sf = v.vel.dot(v.fwd);
    const gear = speed < 0.3 && v.contacts >= 3 ? 'P' : (v.contacts === 0 ? 'N' : (sf < -0.3 ? 'R' : 'D'));
    for (const k in this.gears) this.gears[k].dataset.on = k === gear ? '1' : '0';
    const kw = v.powerKW;
    this.el.pwr.style.width = Math.max(0, Math.min(78, kw / 1500 * 78)) + '%';
    this.el.regen.style.width = Math.max(0, Math.min(22, -kw / 300 * 22)) + '%';
    this.setText('kw', String(Math.round(kw)));
    this.setText('gg', v.gTotal.toFixed(1));
    this.setText('kn', (v.thrustN / 1000).toFixed(0));

    // thrusters
    for (const d of this.dots) {
      const u = Math.round(d.t.u * 20) / 20;
      if (u === d.last) continue;
      d.last = u;
      d.dot.style.fill = u > 0.02 ? `rgba(127,227,255,${0.35 + u * 0.65})` : '';
      d.halo.setAttribute('opacity', u * 0.45);
      d.halo.setAttribute('r', 6 + u * 7);
    }
    // air
    const max = v.trim.airMax;
    if (max > 0) {
      const frac = s.sandbox ? 1 : v.air / max;
      this.el['air-ring'].style.strokeDashoffset = String(276.5 * (1 - frac));
      this.el['air-ring'].style.stroke = frac < 0.15 ? '#ff4d4d' : (frac < 0.35 ? '#ffb547' : '#7fe3ff');
      this.setText('air-kg', s.sandbox ? '∞' : String(Math.round(v.air)));
      this.setText('air-sub', s.sandbox ? 'SANDBOX' : `KG · ${Math.round(PHYS.TANK_PSI * frac)} PSI`);
      const hoverKgS = v.mass * PHYS.G / PHYS.EXHAUST_V;
      const hov = v.canFly ? (s.sandbox ? 'unlimited air' : (s.refilling ? 'refilling…' : `hover ≈ ${(v.air / hoverKgS).toFixed(1)} s`)) : (s.sandbox ? 'unlimited air' : `boost ≈ ${(v.air / (v.trim.rearThrust * 4 / PHYS.EXHAUST_V)).toFixed(1)} s`);
      this.setText('air-hover', hov);
    } else {
      this.el['air-ring'].style.strokeDashoffset = '276.5';
      this.setText('air-kg', '0'); this.setText('air-sub', 'NO TANK'); this.setText('air-hover', 'fan + motors only');
    }
    const fanKg = v.fan.force / PHYS.G;
    this.setText('fan-kg', String(Math.round(fanKg)));
    this.el['fan-bar'].style.width = Math.min(100, fanKg / 4700 * 100) + '%';

    // mode + chips
    const mode = v.flightMode ? 'flight' : (v.contacts === 0 ? 'air' : 'drive');
    if (this.el['h-mode'].dataset.m !== mode) { this.el['h-mode'].dataset.m = mode; this.el['h-mode'].textContent = mode === 'flight' ? 'FLIGHT' : (mode === 'air' ? 'AIRBORNE' : 'DRIVE'); }
    this.setText('c-assist', v.assist ? 'ASSIST ON' : 'MANUAL FLIGHT');
    this.el['c-assist'].dataset.on = v.assist ? '1' : '0';
    this.setText('c-fan', 'FAN ' + v.fan.mode.toUpperCase());
    this.el['c-fan'].dataset.on = v.fan.mode !== 'off' ? '1' : '0';
    this.setText('c-air', s.sandbox ? 'AIR SANDBOX' : 'AIR REAL');
    this.setText('c-cam', s.camName.toUpperCase() + ' CAM');
    this.el['c-gun'].hidden = !s.weapons.equipped;

    // flight data
    const alt = v.agl;
    this.setText('f-alt', alt > 500 ? '500+ m' : `${alt.toFixed(alt < 10 ? 1 : 0)} m`);
    this.setText('f-vs', (v.vel.y >= 0 ? '+' : '') + v.vel.y.toFixed(1));
    const pitch = Math.asin(Math.max(-1, Math.min(1, v.fwd.y))) * 180 / Math.PI;
    const roll = Math.atan2(-v.left.y, v.up.y) * 180 / Math.PI;
    this.setText('f-pitch', `${Math.round(pitch)}°`);
    this.setText('f-roll', `${Math.round(roll)}°`);
    this.setText('f-air', `${s.airtime.toFixed(1)} s`);

    // weapons
    const w = s.weapons;
    const am = this.el.ammo;
    am.hidden = !w.equipped;
    if (w.equipped) {
      const key = w.ammo + '|' + (w.reload > 0);
      if (am.dataset.k !== key) {
        am.dataset.k = key;
        am.innerHTML = w.reload > 0 ? 'RELOADING' : 'ROCKETS ' + Array.from({ length: w.mag }, (_, i) => `<i class="${i < w.ammo ? '' : 'used'}"></i>`).join('');
      }
    }
    this.el.xh.hidden = !w.equipped || s.camMode === 2 && false;
    if (w.equipped) {
      this.el.xh.style.left = s.xhX + 'px'; this.el.xh.style.top = s.xhY + 'px';
      this.el.xh.classList.toggle('reload', w.reload > 0);
    }

    // timers
    const tm = s.timers;
    this.setText('t-060', tm.last060 ? tm.last060.toFixed(2) + ' s' : (tm.running ? (tm.t).toFixed(2) : '--'));
    this.setText('t-060b', tm.best060 ? tm.best060.toFixed(2) + ' s' : '--');
    this.setText('t-qm', tm.lastQM ? `${tm.lastQM.toFixed(2)} s` : '--');
    this.setText('t-top', String(Math.round(tm.top * conv)));
    const rc = s.rings;
    this.el['t-ringw'].hidden = !rc.active && !rc.last;
    this.setText('t-ring', `${rc.next}/${rc.total}`);
    this.setText('t-ringt', rc.active ? rc.time.toFixed(1) + ' s' : (rc.last ? rc.last.toFixed(1) + ' s' : ''));

    // compass
    const hdg = ((Math.atan2(v.fwd.x, -v.fwd.z) * 180 / Math.PI) + 360) % 360;
    const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hdg / 45) % 8];
    this.setText('compass', `${card} ${String(Math.round(hdg)).padStart(3, '0')}°`);
  }

  drawADI(v) {
    const g = this.adi, W = 240, R = 120;
    const pitch = Math.asin(Math.max(-1, Math.min(1, v.fwd.y)));
    const roll = Math.atan2(-v.left.y, v.up.y);
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip();
    g.translate(R, R);
    g.rotate(-roll);
    const off = pitch * 180 / Math.PI * 2.4;
    g.fillStyle = '#1b5f86'; g.fillRect(-W, -W * 2 + off, W * 2, W * 2);
    g.fillStyle = '#6b4a2e'; g.fillRect(-W, off, W * 2, W * 2);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-W, off); g.lineTo(W, off); g.stroke();
    g.lineWidth = 1.5; g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 15px Barlow Condensed, sans-serif'; g.textAlign = 'left';
    for (let p = -60; p <= 60; p += 10) {
      if (!p) continue;
      const y = off - p * 2.4, w = p % 20 === 0 ? 34 : 18;
      g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
      if (p % 20 === 0) g.fillText(String(Math.abs(p)), w + 4, y + 5);
    }
    g.restore();
    // fixed reticle
    g.save(); g.translate(R, R);
    g.strokeStyle = '#ffb547'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-60, 0); g.lineTo(-20, 0); g.lineTo(-12, 10); g.moveTo(60, 0); g.lineTo(20, 0); g.lineTo(12, 10); g.stroke();
    g.fillStyle = '#ffb547'; g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R - 3, 0, 7); g.stroke();
    g.restore();
  }

  drawMinimap(map, v, extra) {
    const g = this.mini, S = 352, R = S / 2;
    const scale = S / 700; // px per meter (700 m across)
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2a241c'; g.fillRect(0, 0, S, S);
    const hdg = Math.atan2(v.fwd.x, v.fwd.z);
    g.translate(R, R);
    g.rotate(hdg + Math.PI);
    const k = map.canvas.width / map.span;
    const px = (v.pos.x + map.span / 2) * k, pz = (v.pos.z + map.span / 2) * k;
    g.scale(scale / k, scale / k);
    g.globalAlpha = 0.9;
    g.drawImage(map.canvas, -px, -pz);
    g.globalAlpha = 1;
    g.restore();
    // markers (rotated positions)
    const toScreen = (x, z) => {
      const dx = (x - v.pos.x) * scale, dz = (z - v.pos.z) * scale;
      const c = Math.cos(hdg + Math.PI), s2 = Math.sin(hdg + Math.PI);
      return [R + dx * c - dz * s2, R + dx * s2 + dz * c];
    };
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.font = '700 20px Barlow Condensed, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const m of extra.markers) {
      let [x, y] = toScreen(m.x, m.z);
      const d = Math.hypot(x - R, y - R);
      if (d > R - 16) { x = R + (x - R) / d * (R - 16); y = R + (y - R) / d * (R - 16); }
      g.fillStyle = m.color; g.beginPath(); g.arc(x, y, m.r || 8, 0, 7); g.fill();
      if (m.label) { g.fillStyle = '#06090c'; g.fillText(m.label, x, y + 1); }
    }
    g.restore();
    // car arrow (always centre, pointing up)
    g.save(); g.translate(R, R);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#06090c'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.stroke(); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 2; g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.stroke();
    g.fillStyle = '#eef2f5'; g.font = '700 22px Barlow Condensed, sans-serif'; g.textAlign = 'center';
    const [nx, ny] = toScreen(v.pos.x, v.pos.z - 1000);
    const nd = Math.hypot(nx - R, ny - R);
    g.fillText('N', R + (nx - R) / nd * (R - 18), R + (ny - R) / nd * (R - 18) + 7);
  }

  drawBigMap(cnv, map, v, zones, extra) {
    const g = cnv.getContext('2d'), S = cnv.width;
    g.clearRect(0, 0, S, S);
    g.drawImage(map.canvas, 0, 0, S, S);
    const toS = (x, z) => [(x + map.span / 2) / map.span * S, (z + map.span / 2) / map.span * S];
    g.font = '700 20px Barlow Condensed, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const m of extra.markers) { const [x, y] = toS(m.x, m.z); g.fillStyle = m.color; g.beginPath(); g.arc(x, y, (m.r || 8) * 0.8, 0, 7); g.fill(); }
    const placed = [];
    for (const z of zones) {
      let [x, y] = toS(z.x, z.z);
      const w = g.measureText(z.name).width + 32;
      // nudge labels that would overlap an earlier one
      for (let k = 0; k < 6; k++) {
        const hit = placed.find(p => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < 30);
        if (!hit) break;
        y = hit.y + (y >= hit.y ? 31 : -31);
      }
      placed.push({ x, y, w });
      g.fillStyle = 'rgba(6,9,12,.8)';
      g.fillRect(x - w / 2, y - 14, w, 28);
      g.fillStyle = '#7fe3ff'; g.fillText(z.key ? `${z.key}` : '•', x - w / 2 + 11, y + 1);
      g.fillStyle = '#eef2f5'; g.fillText(z.name, x + 8, y + 1);
    }
    const [cx, cy] = toS(v.pos.x, v.pos.z);
    const a = Math.atan2(v.fwd.x, v.fwd.z);
    g.save(); g.translate(cx, cy); g.rotate(-a + Math.PI);
    g.fillStyle = '#e0242f'; g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -18); g.lineTo(12, 13); g.lineTo(0, 6); g.lineTo(-12, 13); g.closePath(); g.stroke(); g.fill();
    g.restore();
    g.fillStyle = '#eef2f5'; g.font = '700 26px Barlow Condensed, sans-serif'; g.fillText('N', S / 2, 22);
  }
}
