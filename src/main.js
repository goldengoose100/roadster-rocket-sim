// Roadster Rocket Sim: boots the renderer and world, runs the fixed-step physics loop,
// and connects input, vehicle, destruction, weapons, effects, camera, HUD and sound.
// v2: garage + credits, Physics 2.0 (tires, crash damage, aero, wind, slipstream, real-gas tank,
// shockwaves) with a Classic switch, and the mod-menu extras that go with them.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildHeights, buildTerrainMesh, buildMapImage, heightAt, ZONES, useMap } from './terrain.js';
import { raycast, makeHit, groundBelow } from './colliders.js';
import { Vehicle } from './vehicle.js';
import { buildCar } from './carModel.js';
import { World, makeSedan, makeSemi } from './world.js';
import { Hacks } from './hacks.js';
import { Luck } from './luck.js';
import { Ragdolls, setDollGravity } from './ragdoll.js';
import { MAPS } from './maps/index.js';
import { applyMapEnv } from './mapenv.js';
import { MapPicker } from './mappicker.js';
import { Destruction } from './destruction.js';
import { Effects } from './effects.js';
import { Weapons, WEAPON_LIST } from './weapons.js';
import { CameraRig, CAMERA_MODES } from './camera.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { TRIMS, PAINTS, PHYS, MPH } from './config.js';
import { env } from './physics2.js';
import { CarDamageVisual, LooseWheels } from './damage.js';
import { arrivalTime } from './shockwave.js';
import { Profile, Showroom, COSMETICS, findItem, EARN } from './garage.js';
import { GarageUI } from './garageUI.js';
import { Rewards } from './rewards.js';
import { PaceCar } from './pacecar.js';
import { findSkin, SKINS } from './skins.js';

const $ = (id) => document.getElementById(id);
const DT = PHYS.DT;
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------- persistent settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('rrs.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('rrs.' + k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
};

async function boot(hotData = {}) {
  const loadS = $('load-s'), loadBar = $('load-bar');
  const progress = async (msg, f) => { loadS.textContent = msg; loadBar.style.width = (f * 100) + '%'; await tick(); };
  window.__booted = true;
  try { await Promise.race([document.fonts.load('800 40px "Barlow Condensed"'), new Promise(r => setTimeout(r, 1500))]); } catch (_) { /* fonts optional */ }

  const settings = Object.assign({ trim: 'rocket', paint: 'red', sandbox: false, units: 'mph', volume: 0.7, quality: 2, assist: true, steerSens: 1, physics: '2', blood: true, map: 'desert' }, store.get('settings', {}), hotData.settings || {});
  const profile = new Profile(store);
  // older saves kept the paint in settings
  if (!store.get('garage', null) && settings.paint) profile.d.setup.paint = settings.paint;
  const best = store.get('best', {});
  const saveSettings = () => store.set('settings', settings);

  // ---------- renderer ----------
  await progress('Starting renderer', 0.05);
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.2, 9000);
  const fog = new THREE.FogExp2(0xffffff, 0.00028);
  fog.color.setRGB(0.62, 0.62, 0.6);
  scene.fog = fog;

  // sky
  const sunDir = new THREE.Vector3(0.5, 0.5, -0.7).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir }, time: { value: 0 }, fogCol: { value: fog.color }, zen: { value: new THREE.Vector3(0.035, 0.15, 0.48) }, hor: { value: new THREE.Vector3(0.42, 0.56, 0.74) }, night: { value: 0 }, sunBright: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir; uniform float time; uniform vec3 fogCol; uniform vec3 zen; uniform vec3 hor; uniform float night; uniform float sunBright;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(hor, zen, pow(max(h, 0.0), 0.5));
        col = mix(fogCol, col, smoothstep(-0.02, 0.1, h));
        float sd = max(dot(d, sunDir), 0.0);
        col += (vec3(1.0, 0.8, 0.55) * pow(sd, 6.0) * 0.25 + vec3(1.0, 0.88, 0.7) * pow(sd, 90.0) * 0.8) * sunBright;
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.08) * 1.2 + vec2(time * 0.004, 0.0);
          float n = fbm(uv * 1.3);
          float c = smoothstep(0.52, 0.78, n) * smoothstep(0.0, 0.2, h);
          vec3 cc = mix(vec3(0.85, 0.82, 0.78), vec3(1.15, 1.08, 0.98), pow(sd, 3.0));
          col = mix(col, cc * mix(1.0, 0.04, night), c * 0.7);
          if (night > 0.0) { vec2 sp = floor(d.xz / (h + 0.3) * 260.0); float st = step(0.9975, h2(sp)); col += vec3(st) * night * smoothstep(0.05, 0.3, h) * (0.6 + 0.4 * sin(time * 3.0 + h2(sp + 7.0) * 40.0)); }
        }
        col += mix(vec3(40.0, 34.0, 26.0), vec3(6.0, 6.5, 7.5), night) * smoothstep(0.99955, 0.99985, sd);
        if (h < 0.0) col = mix(fogCol, fogCol * 0.85, smoothstep(0.0, -0.3, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  // lights
  const sun = new THREE.DirectionalLight('#fff2de', 3.9);
  sun.castShadow = true;
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55; sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight('#a9c8e8', '#7a5c40', 0.45);
  scene.add(hemi);

  // environment reflections from the sky
  await progress('Lighting the desert', 0.1);
  const envGround = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.38, 0.3, 0.22) });
  const rebuildEnv = () => {
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat);
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32), envGround);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -3; envScene.add(ground);
    const old = scene.environment;
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    if (old) old.dispose();
    pm.dispose();
  };
  rebuildEnv();

  // ---------- world ----------
  // which map (2.5): the desert unless the player picked another one on the start screen
  const MAP = MAPS[settings.map] || null;
  if (MAP) useMap(MAP);
  await progress(MAP ? `Landing on ${MAP.name}` : 'Shaping 16 km² of terrain', 0.18);
  buildHeights();
  await progress('Paving roads', 0.35);
  const terrain = buildTerrainMesh();
  scene.add(terrain);
  await progress('Building ramps, loop and launch tower', 0.5);
  const destruction = new Destruction(scene);
  const world = new World(scene, destruction);
  world.map = MAP;
  world.build();
  if (MAP) world.teleports.sort((a, b) => a.key - b.key);   // spawn = key 1 (the HQ) on the new maps
  await progress('Stacking destructible buildings', 0.7);
  destruction.finalize();
  const mapImg = buildMapImage(512);
  const effects = new Effects(scene, fog);
  const weapons = new Weapons(scene, effects, destruction);
  await progress('Assembling the Roadster', 0.85);

  // ---------- car ----------
  const paint = findItem('paint', profile.look().paint);
  const model = buildCar(paint);
  model.spoiler.userData.y0 = model.spoiler.position.y;
  scene.add(model.group);
  const vehicle = new Vehicle();
  const mapG = (MAP && MAP.env && MAP.env.gravity) || 1;   // the Moon: 0.165
  vehicle.mapG = mapG; destruction.mapG = mapG; setDollGravity(mapG);
  vehicle.phys2 = settings.physics !== 'classic';
  vehicle.tune = profile.tune();
  vehicle.setTrim(profile.effectiveTrim(TRIMS[settings.trim] || TRIMS.rocket));
  weapons.vehicle = vehicle;
  const dmgVis = new CarDamageVisual(model);
  const looseWheels = new LooseWheels(scene);
  const showroom = new Showroom(renderer);
  const paceCar = new PaceCar(scene);
  vehicle.sandbox = settings.sandbox;
  vehicle.assist = settings.assist;
  vehicle.steerSens = settings.steerSens;

  const rig = new CameraRig(camera);
  const hud = new HUD();
  hud.units = settings.units;
  const input = new Input(canvas);
  const sound = new Sound();
  sound.volume = settings.volume;

  // ---------- post processing ----------
  let composer = null, bloom = null, renderPass = null;
  const setupPost = () => {
    const w = innerWidth, h = innerHeight;
    if (composer) { composer.dispose?.(); composer = null; }
    if (settings.quality >= 1) {
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: settings.quality >= 2 ? 4 : 0 });
      composer = new EffectComposer(renderer, rt);
      renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);
      bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.5, 0.55, 1.0);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    }
  };
  const applyQuality = () => {
    const q = settings.quality;
    const pr = q === 0 ? 1 : (q === 1 ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 1.75));
    renderer.setPixelRatio(pr);
    renderer.shadowMap.enabled = q > 0;
    sun.castShadow = q > 0;
    const ms = q === 2 ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    effects.setQuality(q === 0 ? 0.45 : (q === 1 ? 0.75 : 1));
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    setupPost();
    resize();
    for (let i = 0; i < 3; i++) $('q-' + i).setAttribute('aria-pressed', String(i === q));
  };
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  };
  addEventListener('resize', resize);

  // ---------- game state ----------
  const G = {
    state: 'start', paused: false, overlay: null,
    acc: 0, steps: 0, time: 0,
    timers: { state: 'idle', t: 0, dist: 0, got60: false, last060: 0, best060: 0, lastQM: 0, top: 0, running: false },
    jump: { active: false, t: 0, start: new THREE.Vector3(), maxAlt: 0, flight: false },
    rings: { next: 0, total: world.rings.length, active: false, time: 0, last: 0, lastPassT: 0 },
    zone: null, refilling: false, warnedEmpty: false, fullToast: false,
    aim: new THREE.Vector3(), xhX: 0, xhY: 0,
    fps: 60, fpsT: 0, fpsN: 0, lowFpsT: 0, autoDropped: 0,
    errors: 0, hudT: 0, canvasT: 0,
    timeScale: 1, rollTap: 0, physMs: 0,
    repair: 0, shakes: [], crashCam: null, garageFrom: null,
  };
  const loadBest = () => { const b = best[vehicle.trim.id] || {}; G.timers.best060 = b.z60 || 0; };
  loadBest();

  const spawnAt = (tp) => {
    const y = heightAt(tp.x, tp.z);
    vehicle.reset(new THREE.Vector3(tp.x, y + 0.6 + (vehicle.hack.scale - 1) * 0.6, tp.z), tp.yaw);
    vehicle.fillTank();
    effects.skids.clear();
    rig.snap();
    G.timers.state = 'idle';
    G.jump.active = false;
  };
  const teleports = world.teleports.slice().sort((a, b) => (a.key || 99) - (b.key || 99));
  const teleport = (tp) => {
    spawnAt(tp);
    const z = Object.values(ZONES).find(zz => zz.name === tp.name);
    if (z) { hud.showZone(z); G.zone = z; }
  };
  spawnAt(teleports[0]);

  const resetUpright = () => {
    const yaw = Math.atan2(vehicle.fwd.x, vehicle.fwd.z);
    const p = vehicle.pos.clone();
    p.y += 3;
    const d = groundBelow(p, 60);
    const gy = d === Infinity ? heightAt(p.x, p.z) : p.y - d;
    vehicle.reset(new THREE.Vector3(p.x, gy + 0.9, p.z), yaw);
    effects.skids.clear();
    hud.toast('Car reset', '', 1200);
  };

  // ---------- events ----------
  const _tmp = new THREE.Vector3();
  destruction.onExplode = (pos, radius, power, kind) => {
    effects.explosion(pos, radius, power);
    if (luck) luck.onExplode(pos, radius);
    ragdolls.explode(pos, radius, power);
    const dist = camera.position.distanceTo(pos);
    _tmp.copy(pos).sub(camera.position).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const shake = Math.max(0, 1 - dist / 140) * 0.85;
    if (vehicle.phys2) {
      // the boom and the shake arrive with the shockwave; the flash is instant
      const at = arrivalTime(radius, dist);
      sound.explosion(dist, Math.max(-1, Math.min(1, _tmp.dot(right))), Math.min(3, at));
      if (shake > 0) G.shakes.push({ t: at, amt: shake });
    } else {
      sound.explosion(dist, Math.max(-1, Math.min(1, _tmp.dot(right))));
      rig.trauma = Math.min(1, rig.trauma + shake);
    }
    if (dist < 35) G.flash = Math.max(G.flash || 0, 0.5 * (1 - dist / 35));
    // blast pushes the car (rocket jumps!)
    const cd = vehicle.pos.distanceTo(pos);
    if (cd < radius * 1.4) {
      const f = 1 - cd / (radius * 1.4);
      const dir = vehicle.pos.clone().sub(pos); dir.y = Math.max(dir.y, 0.4); dir.normalize();
      vehicle.applyImpulse(dir.multiplyScalar(f * power * 16000), vehicle.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)));
      vehicle.blastHit(pos, f * power * 0.55);
    }
  };
  // the shockwave reaching the car beyond the direct blast zone gives it a shove
  destruction.shock.vehicle = vehicle;
  destruction.shock.onCar = (f, dist, s) => {
    const dir = vehicle.pos.clone().sub(f.pos); dir.y = Math.max(dir.y, 0.15); dir.normalize();
    vehicle.applyImpulse(dir.multiplyScalar(Math.min(14000, s * 9000)), vehicle.pos.clone().add(new THREE.Vector3(0, 0.3, 0)));
  };
  destruction.glass.onShatter = (p, n) => sound.glass(camera.position.distanceTo(p), n);
  destruction.onImpact = (pos, speed) => { if (camera.position.distanceTo(pos) < 60) sound.impact(Math.min(8, speed * 0.6)); };
  weapons.onFire = (p, kind) => { if (kind && kind !== 'rail' && kind !== 'rocket') { sound.gun(kind); return; } if (kind === 'rail') { sound.tone(180, 0.5, 0.25, 'sawtooth'); sound.oneShot(sound.noise, 'highpass', 3000, 0.7, 0.4); rig.trauma = Math.min(1, rig.trauma + 0.3); rig.fovKick -= 4; } else { sound.launch(); rig.fovKick -= 1.5; } };
  weapons.onPickup = () => {
    model.launcher.group.visible = true;
    sound.pickup();
    hud.toast('Rocket launcher equipped · click or B to fire, drag to aim', 'warn', 4200);
  };

  // ---------- UI wiring ----------
  const show = (id, on) => { $(id).hidden = !on; };
  const setOverlay = (name) => {
    if (G.overlay === 'garage' && name !== 'garage') closeGarage();
    G.overlay = name;
    show('menu', name === 'menu'); show('help', name === 'help'); show('bigmap', name === 'map'); show('garage', name === 'garage');
    G.paused = !!name && G.state === 'play';
    if (name === 'map') hud.drawBigMap($('bigmapc'), mapImg, vehicle, mapZones(), { markers: markers() });
    if (name === 'menu') { $('m-resume').focus(); }
  };
  const mapZones = () => teleports.map(t => ({ name: t.name, x: t.x, z: t.z, key: t.key }));
  const markers = () => {
    const m = [];
    for (const p of world.refuelPads) m.push({ x: p.x, z: p.z, color: '#7fe3ff', r: 6 });
    for (const p of world.pickups) m.push({ x: p.x, z: p.z, color: '#ffb547', r: 7 });
    const r = world.rings[G.rings.next];
    if (r) m.push({ x: r.pos.x, z: r.pos.z, color: '#ffffff', r: 9, label: String(G.rings.next + 1) });
    return m;
  };

  // trims
  const trimsEl = $('trims');
  for (const t of Object.values(TRIMS)) {
    const b = document.createElement('button');
    b.className = 'trim'; b.id = 'trim-' + t.id;
    b.setAttribute('aria-pressed', String(t.id === settings.trim));
    b.innerHTML = `<span class="tt">${t.tag}</span><span class="tn">${t.name}</span><dl>${t.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl><p>${t.blurb}</p>`;
    b.addEventListener('click', () => setTrimId(t.id));
    trimsEl.appendChild(b);
  }
  // a different trim is a different (fresh) car; same trim keeps its damage
  const setTrimId = (id) => {
    const changed = settings.trim !== id;
    settings.trim = id; saveSettings();
    trimsEl.querySelectorAll('.trim').forEach(x => x.setAttribute('aria-pressed', String(x.id === 'trim-' + id)));
    applyTrim();
    if (changed) vehicle.repairAll();
  };
  // garage upgrades -> physics (stock levels give exactly the stock car)
  const applyTrim = () => {
    const sameTrim = vehicle.trim && vehicle.trim.id === settings.trim;
    const health = vehicle.thrusters.map(t => t.health);
    vehicle.tune = profile.tune();
    vehicle.setTrim(profile.effectiveTrim(TRIMS[settings.trim]));
    if (sameTrim && health.length === vehicle.thrusters.length) vehicle.thrusters.forEach((t, i) => { t.health = health[i]; });
    vehicle.sandbox = settings.sandbox;
    hud.buildThrusterDots(vehicle);
    $('h-trim').textContent = vehicle.trim.name.toUpperCase();
    const hasLift = vehicle.canFly, hasRear = vehicle.rear.length > 0;
    for (const n of model.nozzles.lift) n.group.visible = hasLift;
    for (const n of model.nozzles.side) n.group.visible = hasLift;
    for (const n of model.nozzles.rear) n.group.visible = hasRear;
    $('air-real').textContent = vehicle.trim.airMax ? `Real · ${vehicle.trim.airMax} kg` : 'Real';
    loadBest();
  };
  const paintsEl = $('paints');
  const syncPaints = () => { const cur = profile.look().paint; paintsEl.querySelectorAll('.sw').forEach(x => x.setAttribute('aria-pressed', String(x.id === 'paint-' + cur))); };
  for (const p of PAINTS) {
    const b = document.createElement('button');
    b.className = 'sw'; b.id = 'paint-' + p.id; b.title = p.name; b.setAttribute('aria-label', p.name);
    b.style.background = p.color;
    b.addEventListener('click', () => { settings.paint = p.id; saveSettings(); profile.setPart('paint', p.id); profile.setSkin(null); applyLook(); syncPaints(); });
    paintsEl.appendChild(b);
  }
  syncPaints();
  // looks: garage cosmetics, with mod-menu visual overrides on top; preview = parts being tried on
  let hacks = null, luck = null;
  const vaporOf = (hex) => hex === '#eef7ff' ? [0.93, 0.97, 1.0] : (c => [c.r, c.g, c.b])(new THREE.Color(hex));
  const applyLook = (preview = {}) => {
    const L = Object.assign(profile.look(), preview);
    const hv = hacks && hacks.unlocked ? hacks.v : null;
    const lucky = luck ? luck.skinOverride() : undefined;   // Good Luck skin swapper wins over the garage
    const skin = preview.paint !== undefined ? null : preview.skin !== undefined ? findSkin(preview.skin) : lucky !== undefined ? lucky : profile.skin();   // garage try-ons first
    if (hv && hv.paint) { model.setSkin(null); model.setPaint({ color: hv.paint, metal: 0.5, rough: 0.3 }); }
    else if (skin && !(hv && (hv.rainbow || hv.disco))) model.setSkin(skin);
    else model.setSkin(null, findItem('paint', L.paint));
    model.setLook({ wheels: L.wheels, wing: L.wing });
    const glow = findItem('glow', L.glow), hackGlow = hv && hv.underglow;
    model.underglow.visible = !!(hackGlow || glow.color);
    model.underglow.material.color.set(hackGlow ? hv.glowColor : (glow.color || '#b14cff'));
    effects.vapor = vaporOf(hv && hv.smoke && hv.smoke !== '#eef7ff' ? hv.smoke : findItem('smoke', L.smoke).color);
  };
  const setPhysics = (mode) => {
    settings.physics = mode; saveSettings();
    const on = mode !== 'classic';
    vehicle.phys2 = on;
    destruction.shock.enabled = on; if (!on) destruction.shock.clear();
    effects.shockFronts = on;
    env.wind.scale = on ? 1 : 0;
    effects.smoke.wind = effects.fire.wind = on ? effectsWind : null;
    if (!on) { vehicle.repairAll(); vehicle.tankT = 301.15; }
    $('ph-2').setAttribute('aria-pressed', String(on)); $('ph-c').setAttribute('aria-pressed', String(!on));
  };
  const effectsWind = { x: 0, z: 0 };
  $('ph-2').onclick = () => { setPhysics('2'); hud.toast('Physics 2.0: tire heat, crash damage, aero, wind, real air tank, shockwaves', 'ice', 3200); };
  $('ph-c').onclick = () => { setPhysics('classic'); hud.toast('Classic physics: exactly like version 1', '', 2600); };
  const setSandbox = (on) => {
    settings.sandbox = on; vehicle.sandbox = on; saveSettings();
    if (on) vehicle.fillTank();
    for (const [id, v] of [['air-real', !on], ['air-sand', on], ['m-real', !on], ['m-sand', on]]) $(id).setAttribute('aria-pressed', String(v));
  };
  $('air-real').onclick = () => setSandbox(false);
  $('air-sand').onclick = () => setSandbox(true);
  $('m-real').onclick = () => setSandbox(false);
  $('m-sand').onclick = () => setSandbox(true);
  const setAssist = (on) => { settings.assist = on; vehicle.assist = on; saveSettings(); $('m-as-on').setAttribute('aria-pressed', String(on)); $('m-as-off').setAttribute('aria-pressed', String(!on)); };
  $('m-as-on').onclick = () => setAssist(true);
  $('m-as-off').onclick = () => setAssist(false);
  const setUnits = (u) => { settings.units = u; hud.units = u; saveSettings(); $('u-mph').setAttribute('aria-pressed', String(u === 'mph')); $('u-kmh').setAttribute('aria-pressed', String(u === 'kmh')); };
  $('u-mph').onclick = () => setUnits('mph');
  $('u-kmh').onclick = () => setUnits('kmh');
  for (let i = 0; i < 3; i++) $('q-' + i).onclick = () => { settings.quality = i; saveSettings(); applyQuality(); };
  $('steer-sens').value = settings.steerSens;
  $('steer-sens').oninput = (e) => { settings.steerSens = +e.target.value; vehicle.steerSens = settings.steerSens; saveSettings(); };
  $('vol').value = settings.volume;
  $('vol').oninput = (e) => { settings.volume = +e.target.value; sound.setVolume(settings.volume); saveSettings(); };
  $('m-resume').onclick = () => setOverlay(null);
  $('m-help').onclick = () => setOverlay('help');
  $('h-close').onclick = () => setOverlay(G.state === 'play' ? null : null);
  $('bm-close').onclick = () => setOverlay(null);
  $('m-rebuild').onclick = () => { rebuild(); setOverlay(null); };
  $('m-garage').onclick = () => { setOverlay(null); goGarage(); };
  const tpEl = $('tp'), bmList = $('bm-list');
  for (const t of teleports) {
    for (const [root, close] of [[tpEl, true], [bmList, true]]) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.innerHTML = t.key ? `<kbd>${t.key}</kbd> ${t.name}` : `<kbd>·</kbd> ${t.name}`;
      b.onclick = () => { teleport(t); if (close) setOverlay(null); };
      root.appendChild(b);
    }
  }
  $('bigmapc').addEventListener('click', (e) => {
    const r = e.target.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width - 0.5) * mapImg.span, z = ((e.clientY - r.top) / r.height - 0.5) * mapImg.span;
    let bestT = null, bd = 1e9;
    for (const t of teleports) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; bestT = t; } }
    if (hacks.unlocked && hacks.v.mapAnywhere) { teleportTo(new THREE.Vector3(x, heightAt(x, z), z)); setOverlay(null); return; }
    if (bestT && bd < 250) { teleport(bestT); setOverlay(null); }
  });

  const startGame = () => {
    sound.init();
    sound.setVolume(settings.volume);
    if (G.overlay === 'garage') setOverlay(null);
    G.state = 'play';
    show('start', false); show('hud', true);
    if (rig.mode === 4) rig.mode = 0;
    rig.snap();
    spawnAt(teleports[0]);
    // a new drive starts with a fresh car
    vehicle.repairAll(); looseWheels.clear(); paceCar.despawn();
    hud.showZone(ZONES.hq); G.zone = ZONES.hq;
    hud.toast(`${vehicle.trim.name} trim · ${settings.sandbox ? 'Sandbox air' : 'Real air'} · press H for controls`, 'ice', 4000);
    canvas.focus();
  };
  const goGarage = () => {
    G.state = 'start';
    show('hud', false); show('start', true);
    rig.mode = 4; rig.snap();
    spawnAt(teleports[0]);
  };
  $('go').onclick = startGame;

  // ---------- garage ----------
  const garageUI = new GarageUI(profile, {
    apply: (preview) => { applyTrim(); applyLook(preview || {}); },
    look: () => applyLook(),
    setTrim: (id) => setTrimId(id),
    trimId: () => settings.trim,
    phys2: () => vehicle.phys2,
    close: () => setOverlay(null),
    toast: (m, k, ms) => hud.toast(m, k, ms),
    sound,
    condition: () => {
      if (!vehicle.phys2) return { text: 'Classic physics: no damage or tire wear.', bad: false };
      const c = vehicle.damage.condition(vehicle), wear = Math.max(...vehicle.wheels.map(w => w.wear));
      if (c > 0.995 && wear < 0.05) return { text: 'Car in perfect condition.', bad: false };
      return { text: `Car condition ${Math.round(c * 100)}% · tires ${Math.round((1 - wear) * 100)}% tread. Repairs happen on the HQ pad (teleport 1, park on the glowing pad).`, bad: true };
    },
  });
  const openGarage = () => {
    sound.init();
    G.garageFrom = G.state;
    if (G.state === 'start') show('start', false);
    setOverlay('garage');
    show('hud', false); show('cine', false);
    showroom.open(model);
    garageUI.open();
    document.querySelector('.gpanel').scrollTop = 0;
  };
  const closeGarage = () => {
    garageUI.close();
    showroom.close(scene);
    applyTrim(); applyLook();
    if (G.garageFrom === 'start') { show('start', true); updateStartCredits(); } else show('hud', true);
    if (renderPass) { renderPass.scene = scene; renderPass.camera = camera; }
  };
  const updateStartCredits = () => { $('start-cr').textContent = profile.cheats.unlimited ? 'unlimited credits' : `${Math.round(profile.credits).toLocaleString('en-US')} credits`; };
  profile.onChange = () => { updateStartCredits(); hud.credits(profile.credits, profile.cheats.unlimited); };
  updateStartCredits();
  $('go-garage').onclick = openGarage;
  $('m-shop').onclick = openGarage;

  const spawnedRamps = [];
  const rebuild = () => {
    destruction.rebuild();
    for (const r of spawnedRamps) { r.alive = false; r.mesh.parent && r.mesh.parent.remove(r.mesh); }
    spawnedRamps.length = 0;
    for (const d of effects.decals) d.visible = false;
    ragdolls.reset();
    hud.toast('All targets rebuilt', 'good');
  };

  if (('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches) {
    show('touch', true);
    document.body.classList.add('touch');
    input.buildTouch($('touch'), (code) => input.pressed.push(code));
  }

  // ---------- key handling ----------
  const handleKeys = () => {
    for (const code of input.take()) {
      if (G.overlay === 'garage') { if (code === 'Escape' || code === 'KeyG') setOverlay(null); continue; }
      if (G.state === 'start') {
        if (code === 'Enter' || code === 'NumpadEnter') startGame();
        if (code === 'KeyH') setOverlay(G.overlay === 'help' ? null : 'help');
        if (code === 'KeyG' && !G.overlay) openGarage();
        continue;
      }
      if (code === 'Escape' || code === 'KeyP') { setOverlay(G.overlay ? null : 'menu'); continue; }
      if (code === 'KeyH') { setOverlay(G.overlay === 'help' ? null : 'help'); continue; }
      if (code === 'KeyM') { setOverlay(G.overlay === 'map' ? null : 'map'); continue; }
      if (G.overlay) continue;
      if (code === 'Minus' || code === 'NumpadSubtract' || code === 'Digit0' || code === 'Numpad0') continue; // handled instantly below
      if (luck.key(code)) continue;
      if (hacks.key(code)) continue;
      if (code === 'KeyQ' || code === 'KeyE') { G.rollTap = code === 'KeyE' ? 1 : -1; continue; }
      if ((code === 'Tab' || code === 'ShiftTab') && weapons.equipped) { weapons.toggleMode(code === 'ShiftTab'); const w = weapons.weapon; hud.toast(`${w.name}${w.tip ? ' · ' + w.tip : w.id === 'rail' ? ' · pierces buildings' : ''} · Tab next`, 'warn', 1800); continue; }
      if (code === 'KeyV') hud.toast(CAMERA_MODES[rig.mode = (rig.mode + 1) % CAMERA_MODES.length] + ' camera', '', 1200), rig.snap();
      else if (code === 'KeyR') resetUpright();
      else if (code === 'KeyF') { const m = ['auto', 'max', 'off']; vehicle.fan.mode = m[(m.indexOf(vehicle.fan.mode) + 1) % 3]; hud.toast('Fan suction ' + vehicle.fan.mode.toUpperCase(), 'ice', 1400); }
      else if (code === 'KeyG') { setAssist(!vehicle.assist); hud.toast(vehicle.assist ? 'Flight assist ON (release keys to hover)' : 'Manual flight: no auto-level', vehicle.assist ? 'ice' : 'warn', 2200); }
      else if (code === 'KeyN') { const m = sound.toggleMute(); hud.toast(m ? 'Sound off' : 'Sound on', '', 1200); }
      else if (code === 'Backspace') rebuild();
      else if (code.startsWith('Digit')) {
        const k = +code.slice(5);
        const t = teleports.find(tt => tt.key === k);
        if (t) teleport(t);
      } else if (code === 'Space' && !vehicle.canFly && G.state === 'play') {
        if (!G.noFlyToast || G.time - G.noFlyToast > 6) { G.noFlyToast = G.time; hud.toast(`${vehicle.trim.name} trim has no lift thrusters. Pick Rocket in the menu (P) to fly.`, 'warn', 3200); }
      }
    }
  };

  // ---------- credits, crash damage, repair ----------
  const rewards = new Rewards(profile, (text, cr) => { hud.toast(`${text} · +${cr} CR`, 'good', 2600); sound.ring(); });
  // ragdoll target dummies in the Weapons Range (2.4)
  const ragdolls = new Ragdolls(scene, effects, { blood: settings.blood !== false });
  ragdolls.populate(...(MAP ? [MAP.dollSpots || []] : []));
  ragdolls.onReward = (text, cr) => { const got = profile.earn(cr); if (got) { hud.toast(`${text} · +${got} CR`, 'good', 2600); sound.ring(); } };
  destruction.extraHit = (p, r) => ragdolls.hit(p, r);
  const setBlood = (on) => { settings.blood = on; saveSettings(); ragdolls.setBlood(on); $('bl-on').setAttribute('aria-pressed', String(on)); $('bl-off').setAttribute('aria-pressed', String(!on)); };
  $('bl-on').onclick = () => setBlood(true); $('bl-off').onclick = () => setBlood(false);
  setBlood(settings.blood !== false);
  const needsRepair = () => vehicle.damage.isDamaged(vehicle) || vehicle.wheels.some(w => w.wear > 0.02) || vehicle.thrusters.some(t => t.health < 1);
  const _ev = new THREE.Vector3(), _ev2 = new THREE.Vector3();
  const toWorld = (lp, out) => out.copy(lp).applyQuaternion(vehicle.quat).add(vehicle.pos);
  const paintColor = () => model.skin ? new THREE.Color(model.skin.a) : new THREE.Color().copy(model.mats.paint.color);
  const startCrashCam = () => {
    if (G.crashCam || freeCam.on || !(hacks && hacks.unlocked && hacks.v.crashCam) || G.state !== 'play') return;
    const off = camera.position.clone().sub(vehicle.pos);
    G.crashCam = { t: 0, prev: G.timeScale, yaw: Math.atan2(off.x, off.z) };
    G.timeScale = Math.min(G.timeScale, 0.2);
    show('cine', true); show('hud', false);
  };
  const updateCrashCam = (dt) => {
    const C = G.crashCam;
    C.t += dt;
    const a = C.yaw + C.t * 0.55, r = 7 - C.t * 0.6;
    const p = vehicle.pos;
    camera.position.set(p.x + Math.sin(a) * r, Math.max(heightAt(p.x, p.z) + 0.6, p.y + 1.1 + C.t * 0.25), p.z + Math.cos(a) * r);
    camera.up.set(0, 1, 0); camera.lookAt(p.x, p.y + 0.3, p.z);
    camera.fov = 48; camera.updateProjectionMatrix();
    if (C.t > 3) { G.timeScale = C.prev; G.crashCam = null; show('cine', false); show('hud', G.state === 'play' && G.overlay !== 'garage'); rig.snap(); }
  };
  let crashToastT = -10;
  const handleCarEvents = () => {
    const sc = vehicle.hack.scale || 1;
    for (const e of vehicle.events) {
      if (e.type === 'dent') {
        dmgVis.dent(_ev.copy(e.p).divideScalar(sc), e.n, e.sev);
        sound.crunch(e.sev);
        toWorld(e.p, _ev2);
        effects.sparks(_ev2.x, _ev2.y, _ev2.z, vehicle.vel.x, vehicle.vel.y, vehicle.vel.z, Math.round(6 + e.sev * 20));
        // chips of paint and carbon fly off a hard hit
        if (e.sev > 0.5) for (let i = 0; i < Math.min(3, e.sev * 3); i++) {
          const b = destruction.spawnFragment(_ev2.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4)), vehicle.quat, new THREE.Vector3(0.12 + Math.random() * 0.12, 0.015, 0.1 + Math.random() * 0.1), 4, i ? paintColor() : new THREE.Color('#15171a'));
          if (b) { b.vel.copy(vehicle.vel).multiplyScalar(0.6).add(new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6)); b.angVel.set(Math.random() * 10, Math.random() * 10, Math.random() * 10); }
        }
        const z = vehicle.damage.zones;
        model.setGlassCracked(Math.min(1, Math.max(0, (Math.max(z.top, z.front * 0.8) - 0.35) * 2)));
      } else if (e.type === 'crash') {
        if (e.sev > 0.35) startCrashCam();
        if (e.sev > 0.5 && G.time - crashToastT > 6) { crashToastT = G.time; hud.toast(`Big crash · car ${Math.round(vehicle.damage.condition(vehicle) * 100)}% · repair on the HQ pad (press 1)`, 'warn', 3200); }
      } else if (e.type === 'wheelOff') {
        const o = model.wheels[e.i];
        o.pivot.visible = false;
        const w = vehicle.wheels[e.i];
        const obj = o.holder.clone(true);
        obj.scale.multiplyScalar(sc);
        o.pivot.updateWorldMatrix(true, false);
        const pos = new THREE.Vector3().setFromMatrixPosition(o.pivot.matrixWorld);
        const out = new THREE.Vector3(w.side, 0, 0).applyQuaternion(vehicle.quat);
        looseWheels.spawn(obj, pos, vehicle.vel.clone().addScaledVector(out, 3 + Math.random() * 3).add(new THREE.Vector3(0, 2.5, 0)), out);
        sound.crunch(1);
        startCrashCam();
        if (G.state === 'play') hud.toast('A wheel broke off! Repair on the HQ pad (press 1, then park on the pad)', 'warn', 4200);
      } else if (e.type === 'part') {
        model.broken[e.id] = true; model.refreshParts();
        if (e.id === 'mirrorL' || e.id === 'mirrorR' || e.id === 'spoiler' || e.id === 'splitter') {
          const src = e.id === 'spoiler' ? model.wings[model.look.wing] : e.id === 'splitter' ? model.splitter : model.mirrors[e.id === 'mirrorL' ? 0 : 1];
          const p = new THREE.Vector3(); src.updateWorldMatrix(true, true);
          new THREE.Box3().setFromObject(src).getCenter(p);
          const big = e.id === 'spoiler' || e.id === 'splitter';
          const half = big ? new THREE.Vector3(0.6, 0.02, 0.13) : new THREE.Vector3(0.08, 0.04, 0.05);
          const b = destruction.spawnFragment(p, vehicle.quat, half, big ? 8 : 2, e.id === 'splitter' || (e.id === 'spoiler' && model.look.wing !== 'duck') ? new THREE.Color('#16181b') : paintColor());
          if (b) { b.vel.copy(vehicle.vel).multiplyScalar(0.7).add(new THREE.Vector3(0, 3, 0)); b.angVel.set(6, 4, 8); }
        }
      } else if (e.type === 'repaired') {
        dmgVis.resetShape();
        model.broken = {}; model.refreshParts(); model.setGlassCracked(0);
        for (const o of model.wheels) o.pivot.visible = true;
        looseWheels.clear();
        G.repair = 0;
      }
    }
    vehicle.events.length = 0;
  };

  // ---------- simulation step ----------
  let controls = input.controls();
  const _hit = makeHit();
  const stepOnce = () => {
    // slipstream wakes: the pace car and cars thrown through the air
    paceCar.update(DT);
    if (vehicle.phys2 && G.steps % 8 === 0) {
      env.wakes.length = 0;
      if (paceCar.active) env.wakes.push(paceCar.wake);
      for (const b of destruction.bodies) if (b.kind === 'target' && b.alive && !b.sleeping && b.vel.lengthSq() > 100) env.wakes.push({ pos: b.pos, vel: b.vel, hw: 1.2 });
    }
    vehicle.step(DT, controls);
    controls.rollTap = 0;
    G.steps++;
    // debris runs at 120 Hz, or 60 Hz while a lot of it is moving
    const every = (destruction.awake || 0) > 160 ? 4 : 2;
    if (G.steps % every === 0) {
      destruction.step(DT * every);
      destruction.pushFromCar(vehicle);
      if (hacks.unlocked && hacks.v.wrecking) destruction.smashFromCar(vehicle);
    }
    // 0-60 + quarter mile timing
    const tm = G.timers;
    const sp = vehicle.vel.length();
    if (vehicle.contacts >= 3 && sp < 0.25 && !controls.throttle) { tm.state = 'armed'; tm.t = 0; tm.dist = 0; tm.got60 = false; }
    if (tm.state === 'armed' && sp > 0.3) tm.state = 'running';
    if (tm.state === 'running') {
      tm.t += DT; tm.dist += sp * DT;
      if (!tm.got60 && sp >= 26.8224 && tm.t < 0.3) tm.state = 'idle'; // thrown to speed, not a launch
      else if (!tm.got60 && sp >= 26.8224) {
        tm.got60 = true; tm.last060 = tm.t;
        const isBest = !tm.best060 || tm.t < tm.best060;
        if (isBest) { tm.best060 = tm.t; best[vehicle.trim.id] = Object.assign(best[vehicle.trim.id] || {}, { z60: tm.t }); store.set('best', best); }
        const cr = G.state === 'play' ? profile.earn(EARN.z60 + (isBest ? EARN.z60best : 0)) : 0;
        G.pendingToast = [`0-60 mph in ${tm.t.toFixed(2)} s${isBest ? ' · new best' : ''}${cr ? ` · +${cr} CR` : ''}`, isBest ? 'good' : ''];
      }
      if (tm.dist >= 402.336) {
        tm.lastQM = tm.t;
        const cr = G.state === 'play' ? profile.earn(EARN.qm) : 0;
        G.pendingToast = [`1/4 mile ${tm.t.toFixed(2)} s @ ${Math.round(sp * MPH)} mph${cr ? ` · +${cr} CR` : ''}`, 'good']; tm.state = 'idle';
      }
      if (tm.t > 40 || (tm.t > 0.5 && sp < 0.3)) tm.state = 'idle';
    }
    tm.running = tm.state === 'running' && !tm.got60;
    if (vehicle.contacts > 0) tm.top = Math.max(tm.top, sp);
    if (G.state === 'play') rewards.step(vehicle, DT);
  };

  // ---------- per-frame gameplay ----------
  const prevPos = new THREE.Vector3().copy(vehicle.pos);
  const gameplay = (dt) => {
    // impacts
    for (const e of vehicle.events) {
      if (e.type === 'impact') { rig.trauma = Math.min(1, rig.trauma + Math.min(0.6, e.speed / 30)); sound.impact(e.speed); }
      if (e.type === 'barrelroll') sound.whoosh();
    }
    handleCarEvents();
    // jumps / flights
    const J = G.jump;
    if (vehicle.contacts === 0) {
      if (!J.active) { J.active = true; J.t = 0; J.start.copy(vehicle.pos); J.maxAlt = 0; J.flight = vehicle.flightMode; }
      J.t += dt; J.maxAlt = Math.max(J.maxAlt, vehicle.agl); if (vehicle.flightMode) J.flight = true;
    } else if (J.active && vehicle.contacts >= 2) {
      J.active = false;
      const dist = Math.hypot(vehicle.pos.x - J.start.x, vehicle.pos.z - J.start.z);
      const fl = rewards.land(vehicle);
      if (J.flight && J.t > 2) { const cr = profile.earn(fl.credits); hud.toast(`Flight ${J.t.toFixed(1)} s · ${Math.round(dist)} m · max alt ${Math.round(J.maxAlt)} m${fl.text}${cr ? ` · +${cr} CR` : ''}`, 'ice'); }
      else if (!J.flight && J.t > 0.7 && dist > 8) {
        const cr = profile.earn(Math.min(dist, 250) * EARN.jumpPerM + Math.min(J.t, 8) * EARN.jumpPerS + fl.credits);
        hud.toast(`Jump ${Math.round(dist)} m · ${J.t.toFixed(1)} s air · ${J.maxAlt.toFixed(1)} m high${fl.text} · +${cr} CR`, 'good');
      } else if (fl.text) { const cr = profile.earn(fl.credits); hud.toast(fl.text.slice(3) + (cr ? ` · +${cr} CR` : ''), cr ? 'good' : 'warn'); }
    }
    // refuel pads
    G.refilling = false;
    let repairing = false;
    for (const p of world.refuelPads) {
      if (Math.hypot(vehicle.pos.x - p.x, vehicle.pos.z - p.z) < p.r && Math.abs(vehicle.pos.y - p.y) < 3 && vehicle.vel.length() < 4 && (vehicle.contacts >= 2 || (vehicle.contacts >= 1 && vehicle.wheels.some(w => w.broken)))) {
        if (vehicle.trim.airMax && vehicle.air < vehicle.trim.airMax - 0.01 && !settings.sandbox) {
          vehicle.addAir(70 * dt);
          G.refilling = true; G.fullToast = true;
        } else if (G.fullToast) { G.fullToast = false; hud.toast('Air tank full', 'ice', 1500); }
        // the HQ pad also repairs the car and fits new tires (about 3 s)
        if (p.name === 'HQ' && vehicle.phys2 && needsRepair()) {
          repairing = true;
          if (!G.repair) hud.toast('Repairing on the HQ pad…', 'ice', 1800);
          G.repair += dt / 3;
          dmgVis.restore(Math.min(1, dt * 1.6));
          if (G.repair >= 1) { G.repair = 0; vehicle.repairAll(); vehicle.fillTank(); sound.record(); hud.toast('Car repaired · new tires fitted', 'good', 2400); }
        }
      }
    }
    if (repairing) { hud.el.cond.hidden = false; hud.lastText.cond = ''; hud.el.cond.textContent = `REPAIRING ${Math.round(G.repair * 100)}%`; }
    rewards.destruction(destruction, dt);
    if (!settings.sandbox && vehicle.trim.airMax && vehicle.air <= 0.5) {
      if (!G.warnedEmpty) { G.warnedEmpty = true; sound.warn(); hud.toast('Out of air. Refill on an AIR pad, or switch to Sandbox in the menu (P).', 'warn', 4500); }
    } else if (vehicle.air > vehicle.trim.airMax * 0.3) G.warnedEmpty = false;
    // rings
    const R = G.rings;
    if (R.active) { R.time += dt; if (R.time - R.lastPassT > 60) { R.active = false; R.next = 0; hud.toast('Ring course timed out', 'warn'); } }
    const ring = world.rings[R.next];
    if (ring) {
      const a = _tmp.copy(prevPos).sub(ring.pos).dot(ring.normal), b = vehicle.pos.clone().sub(ring.pos).dot(ring.normal);
      if (a < 0 && b >= 0) {
        const lateral = vehicle.pos.clone().sub(ring.pos).addScaledVector(ring.normal, -b).length();
        if (lateral < ring.r + 0.8) {
          if (R.next === 0) { R.active = true; R.time = 0; }
          R.lastPassT = R.time;
          R.next++;
          sound.ring();
          if (R.next >= R.total) {
            R.active = false; R.last = R.time;
            const bk = best[vehicle.trim.id] || {};
            const isBest = !bk.rings || R.time < bk.rings;
            if (isBest) { best[vehicle.trim.id] = Object.assign(bk, { rings: R.time }); store.set('best', best); sound.record(); }
            const cr = profile.earn(EARN.ring + EARN.course + (isBest ? EARN.courseBest : 0));
            hud.toast(`Ring course done in ${R.time.toFixed(1)} s${isBest ? ' · new best' : ''} · +${cr} CR`, 'good', 4000);
            R.next = 0;
          } else { const cr = profile.earn(EARN.ring); hud.toast(`Ring ${R.next}/${R.total} · +${cr} CR`, 'ice', 900); }
        }
      }
    }
    world.rings.forEach((r, i) => {
      const target = i === R.next ? 1.5 + Math.sin(G.time * 6) * 0.4 : (i < R.next && R.active ? 0.15 : 0.6);
      r.mat.emissiveIntensity += (target - r.mat.emissiveIntensity) * 0.2;
      r.mat.emissive.set(i === R.next ? '#ffd88a' : '#7fe3ff');
    });
    prevPos.copy(vehicle.pos);
    // zones
    let cur = null;
    for (const z of Object.values(ZONES)) if (Math.hypot(vehicle.pos.x - z.x, vehicle.pos.z - z.z) < z.r * 0.75) { if (!cur || z.r < cur.r) cur = z; }
    if (cur && cur !== G.zone) hud.showZone(cur);
    G.zone = cur || G.zone;
    // pickups
    if (weapons.checkPickups(world.pickups, vehicle.pos)) { /* toast via callback */ }
    // out of bounds
    if (Math.hypot(vehicle.pos.x, vehicle.pos.z) > 1750 || vehicle.pos.y < heightAt(vehicle.pos.x, vehicle.pos.z) - 30 || !Number.isFinite(vehicle.pos.x + vehicle.pos.y + vehicle.pos.z + vehicle.quat.w)) {
      teleport(teleports[0]);
      hud.toast('Back to HQ', 'warn');
    }
    if (G.pendingToast) { hud.toast(G.pendingToast[0], G.pendingToast[1], 3200); if (G.pendingToast[1] === 'good') sound.record(); G.pendingToast = null; }
  };

  // ---------- visuals ----------
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
  const ndcAim = new THREE.Vector2(0, 0.2);
  const raycaster = new THREE.Raycaster();
  const updateAim = () => {
    const aimY = rig.mode === 2 ? 0 : 0.2;
    ndcAim.set(0, aimY);
    raycaster.setFromCamera(ndcAim, camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    // start the ray past the car so we never aim at ourselves
    const start = o.clone().addScaledVector(d, Math.max(0, d.dot(_v.copy(vehicle.pos).sub(o))) + 3);
    if (raycast(start, d, 900, _hit, { twoSided: true })) G.aim.copy(_hit.point);
    else G.aim.copy(start).addScaledVector(d, 600);
    G.xhX = innerWidth / 2; G.xhY = innerHeight / 2 - aimY * innerHeight / 2;
  };

  const emitVehicleFX = (dt) => {
    const q = vehicle.quat;
    // thruster vapor
    let anyLift = 0;
    for (const t of vehicle.thrusters) {
      if (t.u < 0.03) continue;
      _v.copy(t.pos).applyQuaternion(q).add(vehicle.pos);
      _v2.copy(t.dir).applyQuaternion(q).negate(); // exhaust direction
      const n = t.u * dt * (t.group === 'rear' ? 160 : 110);
      for (let i = 0; i < n || Math.random() < n - i; i++) {
        const sp = 18 + Math.random() * 14;
        effects.smoke.spawn(_v.x, _v.y, _v.z, vehicle.vel.x + _v2.x * sp + (Math.random() - 0.5) * 3, vehicle.vel.y + _v2.y * sp + (Math.random() - 0.5) * 3, vehicle.vel.z + _v2.z * sp + (Math.random() - 0.5) * 3,
          0.35 + Math.random() * 0.3, 0.25, 1.8 + t.u, effects.vapor[0], effects.vapor[1], effects.vapor[2], 0.32 * t.u + 0.08, { drag: 4.5 });
        if (n - i < 1) break;
      }
      if (t.group === 'lift') anyLift = Math.max(anyLift, t.u);
    }
    // ground dust from lift thrusters
    if (anyLift > 0.1 && vehicle.agl < 7) {
      const gy = vehicle.pos.y - vehicle.agl - 0.45;
      const k = anyLift * (1 - vehicle.agl / 7) * dt * 70;
      for (let i = 0; i < k; i++) {
        const a = Math.random() * Math.PI * 2, sp = 8 + Math.random() * 10;
        effects.smoke.spawn(vehicle.pos.x + Math.cos(a) * 1.5, gy + 0.3, vehicle.pos.z + Math.sin(a) * 1.5, Math.cos(a) * sp, 0.6 + Math.random(), Math.sin(a) * sp, 1.2 + Math.random(), 0.8, 4, 0.72, 0.6, 0.45, 0.45, { drag: 2.5 });
      }
    }
    // tires
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i];
      if (!w.contact) { effects.skids.break(i); continue; }
      const P = w.contactPoint;
      const side = _v2.copy(vehicle.left);
      const sand = w.surface === 'sand';
      const spd = vehicle.vel.length();
      // Physics 2.0: hot tires smoke more and thicker, even when only sliding a little
      const hot = vehicle.phys2 && !sand ? Math.max(0, Math.min(1, (w.temp - 110) / 80)) : 0;
      if (w.sliding > 0.25 || (hot > 0.3 && w.sliding > 0.1)) {
        if (!sand) effects.skids.add(i, P, w.normal, side, Math.min(0.75, w.sliding * 0.8), [0.04, 0.04, 0.045]);
        if (Math.random() < w.sliding * dt * 60 * (1 + hot * 2)) {
          const c = sand ? [0.7, 0.58, 0.42] : [0.86, 0.86, 0.88];
          effects.smoke.spawn(P.x, P.y + 0.25, P.z, (Math.random() - 0.5) * 2 + vehicle.vel.x * 0.2, 0.8 + Math.random(), (Math.random() - 0.5) * 2 + vehicle.vel.z * 0.2, 1.4 + Math.random() * 1.6 + hot * 2, 0.6, 3.2 + hot * 3, c[0], c[1], c[2], 0.5 + hot * 0.2, { drag: 1.6, grav: -0.3 });
        }
      } else if (sand && spd > 2) {
        effects.skids.add(i, P, w.normal, side, 0.18, [0.42, 0.33, 0.22]);
      } else effects.skids.break(i);
      if (sand && spd > 6 && Math.random() < dt * spd * 0.8) {
        effects.smoke.spawn(P.x, P.y + 0.2, P.z, -vehicle.vel.x * 0.15 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, -vehicle.vel.z * 0.15 + (Math.random() - 0.5) * 2, 1.4 + Math.random(), 0.7, 3.5, 0.74, 0.62, 0.46, 0.4, { drag: 1.5 });
      }
    }
    if (!vehicle.phys2) return;
    // metal scraping the ground (a broken-off wheel, sliding on the roof) throws sparks
    for (const sc of vehicle.scrapes) effects.sparks(sc.x, sc.y, sc.z, sc.vx, sc.vy, sc.vz, Math.min(4, 1 + dt * 120));
    // a cracked tank hisses out a jet of cold vapor under the tail
    if (vehicle.leakRate > 0.01 && vehicle.air > 0.5 && !settings.sandbox) {
      _v.set(0.25, -0.3, -1.6).applyQuaternion(q).add(vehicle.pos);
      _v2.set(0.4, -1, -0.6).applyQuaternion(q);
      for (let i = 0; i < Math.min(6, vehicle.leakRate * dt * 60); i++) {
        effects.smoke.spawn(_v.x, _v.y, _v.z, vehicle.vel.x + _v2.x * 9 + (Math.random() - 0.5) * 2, vehicle.vel.y + _v2.y * 9, vehicle.vel.z + _v2.z * 9 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.4, 0.15, 1.2, 0.95, 0.97, 1, 0.35, { drag: 3 });
      }
    }
  };
  // blowing dust in gusts (Physics 2.0)
  const envFX = (dt) => {
    if (!vehicle.phys2 || dt <= 0) return;
    const cx = camera.position.x, cz = camera.position.z;
    const g = env.wind.gustiness(cx, cz);
    if (g < 0.25) return;
    const n = Math.min(4, g * dt * 40);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 50;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      effects.smoke.spawn(x, heightAt(x, z) + 0.3 + Math.random(), z, effectsWind.x, 0.3, effectsWind.z, 2 + Math.random() * 2, 1.5, 5, 0.72, 0.6, 0.45, 0.22 * g, { drag: 0.5 });
    }
  };

  const _tireWorn = new THREE.Color('#3a3b3e');
  const updateCarModel = (dt) => {
    model.group.position.copy(vehicle.pos);
    model.group.quaternion.copy(vehicle.quat);
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i], o = model.wheels[i];
      // worn tires look smooth and grey, overheated ones glow faintly
      const wk = Math.round(w.wear * 20) + Math.round(Math.max(0, w.temp - 150) / 10) * 100;
      if (o.tk !== wk) {
        o.tk = wk;
        o.tireMat.color.set('#141516').lerp(_tireWorn, w.wear * 0.8);
        o.tireMat.roughness = 0.86 - w.wear * 0.4;
        o.tireMat.emissive.setRGB(Math.min(0.25, Math.max(0, w.temp - 150) / 400), 0.02 * Math.min(1, Math.max(0, w.temp - 150) / 100), 0);
      }
      const target = w.mount.y - PHYS.REST + (w.contact ? w.comp : 0) - (w.flat ? 0.07 * w.flat : 0);
      o.pivot.position.y += (target - o.pivot.position.y) * Math.min(1, dt * 30);
      o.pivot.rotation.y = w.steer;
      o.spin.rotation.x += w.spinVel * dt;
      if (o.spin.rotation.x > 1000) o.spin.rotation.x -= Math.PI * 2 * 150;
    }
    let maxU = 0;
    const groups = { rear: model.nozzles.rear, lift: model.nozzles.lift, side: model.nozzles.side };
    const idx = { rear: 0, lift: 0, side: 0 };
    for (const t of vehicle.thrusters) {
      const n = groups[t.group][idx[t.group]++];
      if (!n) continue;
      maxU = Math.max(maxU, t.u);
      const on = t.u > 0.02;
      n.plume.visible = on;
      if (on) {
        const len = (t.group === 'rear' ? 1.6 : t.group === 'lift' ? 1.3 : 0.7) * (0.4 + t.u) * (0.9 + Math.random() * 0.2);
        const wdt = n.r / 0.16 * (1 + t.u * 0.4);
        n.plume.scale.set(wdt, len, wdt);
        n.plume.material.opacity = 0.25 + t.u * 0.55;
      }
    }
    model.mats.nozzleGlow.emissiveIntensity = maxU * 4;
    model.mats.tail.emissiveIntensity = model.broken.tail ? 0 : (vehicle.braking ? 7 : 2.2);
    // a bent frame leaves the body sitting crooked
    const bend = vehicle.damage.frame * 0.05 * vehicle.damage.frameSide;
    model.body.rotation.z = model.canopy.rotation.z = bend;
    const sp = vehicle.vel.dot(vehicle.fwd);
    const up = sp > 30 || (vehicle.braking && sp > 15);
    model.spoiler.rotation.x += ((up ? -0.3 : 0) - model.spoiler.rotation.x) * Math.min(1, dt * 5);
    model.spoiler.position.y += ((up ? model.spoiler.userData.y0 + 0.07 : model.spoiler.userData.y0) - model.spoiler.position.y) * Math.min(1, dt * 5);
  };

  // ---------- time of day ----------
  const TOD = {
    day: { sun: [0.5, 0.5, -0.7], sunCol: '#fff2de', sunI: 3.9, hemi: 0.45, zen: [0.035, 0.15, 0.48], hor: [0.42, 0.56, 0.74], fog: [0.62, 0.62, 0.6], exp: 1.05, night: 0, lights: 0, sb: 1 },
    golden: { sun: [0.78, 0.17, -0.6], sunCol: '#ffc98e', sunI: 3.3, hemi: 0.34, zen: [0.05, 0.12, 0.36], hor: [0.85, 0.6, 0.42], fog: [0.78, 0.6, 0.46], exp: 1.1, night: 0, lights: 0, sb: 1.2 },
    sunset: { sun: [0.8, 0.035, -0.6], sunCol: '#ff8a50', sunI: 1.7, hemi: 0.22, zen: [0.045, 0.06, 0.2], hor: [0.9, 0.4, 0.24], fog: [0.5, 0.3, 0.24], exp: 1.25, night: 0.25, lights: 0.6, sb: 1.4 },
    night: { sun: [-0.35, 0.55, 0.55], sunCol: '#9db4ff', sunI: 0.45, hemi: 0.1, zen: [0.003, 0.006, 0.02], hor: [0.02, 0.03, 0.055], fog: [0.02, 0.025, 0.04], exp: 1.5, night: 1, lights: 1, sb: 0.15 },
  };
  const setTimeOfDay = (k) => {
    const t = TOD[k] || TOD.day;
    sunDir.set(...t.sun).normalize();
    sun.color.set(t.sunCol); sun.intensity = t.sunI;
    hemi.intensity = t.hemi;
    skyMat.uniforms.zen.value.set(...t.zen); skyMat.uniforms.hor.value.set(...t.hor);
    skyMat.uniforms.night.value = t.night; skyMat.uniforms.sunBright.value = t.sb;
    fog.color.setRGB(...t.fog);
    envGround.color.setRGB(0.38 * t.sunI / 3.9 + 0.02, 0.3 * t.sunI / 3.9 + 0.02, 0.22 * t.sunI / 3.9 + 0.03);
    renderer.toneMappingExposure = t.exp;
    model.lights = t.lights; model.updateLights();
    rebuildEnv();
  };

  // ---------- free camera / photo mode / physics x-ray ----------
  const freeCam = { on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  const setFreeCam = (on) => {
    freeCam.on = on;
    if (on) {
      freeCam.pos.copy(camera.position);
      const d = new THREE.Vector3(); camera.getWorldDirection(d);
      freeCam.yaw = Math.atan2(d.x, d.z); freeCam.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
      hud.toast('Free camera: WASD move, drag to look, Space/C up/down, Shift fast · I to exit', 'ice', 3500);
    } else rig.snap();
  };
  const updateFreeCam = (dt) => {
    const sp = (input.has('ShiftLeft', 'ShiftRight') ? 70 : 18) * dt;
    const f = new THREE.Vector3(Math.sin(freeCam.yaw) * Math.cos(freeCam.pitch), Math.sin(freeCam.pitch), Math.cos(freeCam.yaw) * Math.cos(freeCam.pitch));
    const r = new THREE.Vector3(-Math.cos(freeCam.yaw), 0, Math.sin(freeCam.yaw));
    if (input.has('KeyW', 'ArrowUp')) freeCam.pos.addScaledVector(f, sp);
    if (input.has('KeyS', 'ArrowDown')) freeCam.pos.addScaledVector(f, -sp);
    if (input.has('KeyD', 'ArrowRight')) freeCam.pos.addScaledVector(r, sp);
    if (input.has('KeyA', 'ArrowLeft')) freeCam.pos.addScaledVector(r, -sp);
    if (input.has('Space')) freeCam.pos.y += sp;
    if (input.has('KeyC')) freeCam.pos.y -= sp;
    freeCam.pos.y = Math.max(freeCam.pos.y, heightAt(freeCam.pos.x, freeCam.pos.z) + 0.5);
    camera.position.copy(freeCam.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(freeCam.pos.clone().add(f));
    camera.fov = 62 + (rig.fovAdd || 0); camera.updateProjectionMatrix();
  };
  const setPhoto = (on) => document.body.classList.toggle('photo', on);
  const xray = { on: false, group: new THREE.Group(), arrows: [] };
  scene.add(xray.group);
  const mkArrow = (col) => { const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, col, 0.3, 0.18); a.line.material.depthTest = false; a.cone.material.depthTest = false; a.renderOrder = 20; xray.group.add(a); xray.arrows.push(a); return a; };
  const setXray = (on) => {
    xray.on = on; xray.group.visible = on;
    if (on && !xray.arrows.length) {
      xray.vel = mkArrow('#46f0a0'); xray.fan = mkArrow('#7fe3ff');
      xray.wheels = [0, 1, 2, 3].map(() => mkArrow('#5c8cff'));
      xray.thr = Array.from({ length: 10 }, () => mkArrow('#ffffff'));
    }
  };
  const _xa = new THREE.Vector3(), _xb = new THREE.Vector3();
  const updateXray = () => {
    const sp = vehicle.vel.length();
    xray.vel.position.copy(vehicle.pos); xray.vel.setDirection(_xa.copy(vehicle.vel).normalize()); xray.vel.setLength(Math.max(0.5, sp * 0.15), 0.4, 0.25);
    xray.fan.visible = vehicle.fan.force > 500;
    xray.fan.position.copy(vehicle.pos); xray.fan.setDirection(_xa.copy(vehicle.nAvg).negate()); xray.fan.setLength(vehicle.fan.force / 8000 + 0.3, 0.35, 0.22);
    vehicle.wheels.forEach((w, i) => { const a = xray.wheels[i]; a.visible = w.contact; if (!w.contact) return; a.position.copy(w.contactPoint); a.setDirection(w.normal); a.setLength(w.load / 4000 + 0.2, 0.25, 0.15); });
    xray.thr.forEach((a, i) => { const t = vehicle.thrusters[i]; a.visible = !!t && t.u > 0.02; if (!a.visible) return; a.position.copy(t.pos).applyQuaternion(vehicle.quat).add(vehicle.pos); a.setDirection(_xb.copy(t.dir).applyQuaternion(vehicle.quat).negate()); a.setLength(t.u * 2.5 + 0.2, 0.25, 0.15); });
  };

  // ---------- hack-menu helpers ----------
  const aimPoint = () => { updateAim(); return G.aim.clone(); };
  const teleportTo = (p) => {
    const yaw = Math.atan2(vehicle.fwd.x, vehicle.fwd.z);
    vehicle.reset(new THREE.Vector3(p.x, p.y + 1.2 + (vehicle.hack.scale - 1) * 0.6, p.z), yaw);
    effects.skids.clear(); rig.snap();
  };
  const nuke = (p) => {
    effects.nuke(p);
    destruction.explode(p, 38, 3.5, 'nuke');
    sound.explosion(camera.position.distanceTo(p) * 0.5, 0); setTimeout(() => sound.explosion(40, 0), 250);
    G.flash = 1;
    hud.toast('☢ Nuke detonated', 'warn', 2000);
  };
  const spawnThing = (kind, p) => {
    const yaw = Math.atan2(vehicle.fwd.x, vehicle.fwd.z);
    if (kind === 'car' || kind === 'semi') {
      const obj = kind === 'car' ? makeSedan(['#e9ecef', '#141518', '#9e0f17', '#12305e'][Math.floor(Math.random() * 4)]) : makeSemi();
      obj.position.set(p.x, heightAt(p.x, p.z), p.z); obj.rotation.y = yaw + Math.PI / 2;
      scene.add(obj);
      if (kind === 'car') destruction.spawnTarget(obj, new THREE.Vector3(0.95, 0.72, 2.45), 1800, 0.72);
      else destruction.spawnTarget(obj, new THREE.Vector3(1.35, 2.0, 8.5), 9000, 2.0);
    } else if (kind === 'pace') {
      paceCar.spawn(vehicle, hacks.v.paceSpeed || 120);
      hud.toast(`Pace car at ${hacks.v.paceSpeed || 120} mph · tuck in behind it to draft`, 'ice', 2600);
      return;
    } else if (kind === 'doll') {
      ragdolls.spawn(p, yaw + Math.PI);
    } else if (kind === 'ramp') {
      const w = world.wedge(p.x, p.z, yaw, 6, 20, 4.5, { noStripes: true });
      spawnedRamps.push(w);
    } else {
      const n = destruction.spawn(kind, p, yaw);
      if (!n) { hud.toast('Spawn limit reached · use Rebuild the world to clear', 'warn'); return; }
    }
    hud.toast('Spawned ' + kind, '', 1000);
  };
  const instantRepair = () => { vehicle.repairAll(); hud.toast('Instant repair', 'ice', 1200); };
  const onCheats = () => { applyTrim(); applyLook(); profile.onChange(); if (G.overlay === 'garage') garageUI.render(); };
  // garage cheats can come from the mod menu or the Good Luck menu ("unlock everything")
  const syncCheats = () => {
    const h = hacks && hacks.unlocked ? hacks.v : {}, l = luck && luck.unlocked ? luck.v : {};
    profile.cheats.unlimited = !!h.unlimitedCredits;
    profile.cheats.unlockAll = !!(h.unlockAll || l.unlockAll);
    profile.cheats.unlockSkins = !!(h.unlockSkins || l.unlockAll);
    profile.cheats.devSkins = !!(h.devSkins || l.unlockAll);
  };
  hacks = new Hacks({
    vehicle, weapons, destruction, effects, model, rig, G, sound, world,
    toast: (m, k, ms) => hud.toast(m, k, ms),
    setTimeOfDay, aimPoint, teleportTo, nuke, spawn: spawnThing, rebuild: () => rebuild(), setXray, setFreeCam, setPhoto, applyLook,
    profile, onCheats, syncCheats, repair: instantRepair,
    onSkins: () => { applyLook(); if (G.overlay === 'garage') garageUI.render(); },
  });
  luck = new Luck({
    vehicle, model, rig, effects, sound, profile, applyLook, syncCheats, onCheats,
    toast: (m, k, ms) => hud.toast(m, k, ms),
    boosting: () => G.state === 'play' && controls.boost && vehicle.rear.length > 0 && vehicle.thrustN > 1000,
  });
  // "0" opens the Good Luck menu (its own code), handled instantly like the mod menu
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Digit0' && e.code !== 'Numpad0') return;
    if (G.state !== 'play' || G.overlay || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    e.preventDefault();
    if (!e.repeat) luck.toggle();
  });

  // "-" opens the mod menu immediately (not on the next frame) so nothing typed leaks into the game
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Minus' && e.code !== 'NumpadSubtract') return;
    if (G.state !== 'play' || G.overlay || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    e.preventDefault();
    if (!e.repeat) hacks.toggle();
  });

  // shown once after updating to that exact version (a bugfix release without an entry shows nothing)
  const WHATS_NEW = { '2.5.0': ['Two new maps! Pick The Moon or Neon City on the start screen', 'The Moon: 1/6 gravity, craters, a lunar base, giant jumps and Earth in the sky', 'Neon City: a night city with skyscrapers, a neon tunnel, an elevated skyway and a demolition yard'], '2.4.1': ['8 more silly cars in the Good Luck menu: toilet, bathtub, shopping cart, couch, cheese wedge, pizza slice, giant sneaker and burger', 'Ragdolls fly the same at any frame rate, knocked-down dummies climb back on their stands, and other fixes'], '2.4.0': ['Ragdoll dummies in the Weapons Range: 7 kinds with HP bars, including a giant BOSS', 'Limbs come off where you hit them (Blood can be turned off in the pause menu)', 'Earn credits for every knockout'], '2.3.0': ['A secret Good Luck menu (you need its code): silly cars like a banana, a rubber duck and a hot dog, a skin swapper and silly mods'], '2.2.0': ['Car skin cases: Street and Elite, with 5 rarities (Garage → Skins)', '14 new guns. Press Tab / Shift+Tab to switch, hold the mouse for auto-fire', 'Loads of new mod-menu cheats, including 50 secret Dev skins', 'A new in-game update screen and this What\'s new screen'] };
  // ---------- desktop app updater (only inside the .exe) ----------
  const desk = window.desktop;
  if (desk) {
    $('upd-row').hidden = false;
    $('ver-text').textContent = desk.gameVersion;
    let pending = null;
    const showUpdate = (info) => {
      pending = info;
      $('upd-title').textContent = info.needsFullDownload ? 'New version needs a full download' : 'Update available';
      $('upd-ver').textContent = `Version ${info.version} · you have ${desk.gameVersion}${info.size ? ` · ${(info.size / 1e6).toFixed(1)} MB` : ''}`;
      $('upd-notes').innerHTML = (info.notes || []).map(n => `<li>${String(n).replace(/</g, '&lt;')}</li>`).join('');
      $('upd-status').textContent = info.needsFullDownload ? 'This update changes the app itself. Download the new zip from the GitHub page.' : '';
      $('upd-go').textContent = info.needsFullDownload ? 'Open download page' : 'Update now';
      $('upd-barw').hidden = true; $('upd-go').disabled = false;
      $('upd').hidden = false;
      G.paused = G.state === 'play';
    };
    desk.onUpdateAvailable(showUpdate);
    // "What's new" splash, once per installed version (reuses the update window)
    try {
      if (localStorage.getItem('rrs-seen-ver') !== desk.gameVersion) {
        const first = localStorage.getItem('rrs-seen-ver') === null && !localStorage.getItem('rrs.garage');
        localStorage.setItem('rrs-seen-ver', desk.gameVersion);
        const news = WHATS_NEW[desk.gameVersion];
        if (!first && news) setTimeout(() => {
          if (!$('upd').hidden) return;
          pending = null;
          $('upd-title').textContent = "What's new";
          $('upd-ver').textContent = `Version ${desk.gameVersion}`;
          $('upd-notes').innerHTML = news.map(n => `<li>${n}</li>`).join('');
          $('upd-status').textContent = ''; $('upd-barw').hidden = true;
          $('upd-go').textContent = "Let's go"; $('upd-go').disabled = false;
          $('upd-go').addEventListener('click', () => { if (!pending) $('upd-later').click(); }, { once: true });
          $('upd').hidden = false;
        }, 1500);
      }
    } catch (e) { /* storage blocked: skip the splash */ }
    desk.onNotice((n) => hud.toast(n, 'warn', 7000));
    desk.onProgress((p) => { $('upd-barw').hidden = false; $('upd-bar').style.width = (p * 100).toFixed(0) + '%'; $('upd-status').textContent = `Downloading… ${(p * 100).toFixed(0)}%`; });
    $('upd-go').onclick = async () => {
      if (!pending) return;
      if (pending.needsFullDownload) { desk.openDownloadPage(); return; }
      $('upd-go').disabled = true;
      $('upd-status').textContent = 'Downloading…';
      const r = await desk.installUpdate();
      if (!r.ok) { $('upd-status').textContent = 'Update failed: ' + r.error + '. Your current version still works.'; $('upd-go').disabled = false; }
      else $('upd-status').textContent = 'Installed. Restarting…';
    };
    $('upd-later').onclick = () => { $('upd').hidden = true; G.paused = !!G.overlay && G.state === 'play'; };
    $('upd-check').onclick = async () => {
      $('upd-check').disabled = true; $('upd-check').textContent = 'Checking…';
      const r = await desk.checkForUpdates();
      $('upd-check').disabled = false; $('upd-check').textContent = 'Check for updates';
      if (r.error) hud.toast('Could not check for updates: ' + r.error, 'warn', 3500);
      else if (!r.available) hud.toast(`You have the latest version (${desk.gameVersion})`, 'good', 2500);
      else { setOverlay(null); showUpdate(r); }
    };
  }

  // ---------- map look (sky, fog, stars, Earth) and the map picker (2.5) ----------
  let mapEnv = null;
  if (MAP && MAP.env) { try { mapEnv = applyMapEnv(MAP.env, { THREE, scene, camera, renderer, fog, sky, skyMat, sun, hemi, setTimeOfDay }); } catch (e) { console.warn('map look', e); } }
  try {
    new MapPicker({
      maps: [{ id: 'desert', name: 'Desert Test Site', desc: 'The original: ramps, loop, canyon, weapons range', col: '#ffb547' }, ...Object.values(MAPS).map(m => ({ id: m.id, name: m.name, desc: m.desc, col: m.col }))],
      current: MAP ? MAP.id : 'desert',
      onPick: (id) => { settings.map = id; saveSettings(); setTimeout(() => location.reload(), 150); },
    });
  } catch (e) { console.warn('map picker', e); }

  // ---------- main loop ----------
  applyTrim(); applyLook();
  applyQuality();
  setSandbox(settings.sandbox); setAssist(settings.assist); setUnits(settings.units); setPhysics(settings.physics);
  hud.credits(profile.credits, false);
  rig.mode = 4;
  await progress('Ready', 1);
  $('loading').hidden = true;
  show('start', true);
  if (desk) desk.booted();

  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const rawDt = Math.max(0, (now - last) / 1000);
    let dt = Math.min(0.1, rawDt); last = now;
    try {
      handleKeys();
      const running = !G.paused && (G.state === 'play' || G.state === 'start') && !(window.__sim && window.__sim.freeze);
      if (running) {
        controls = G.state === 'play' && !freeCam.on ? input.controls() : { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: false, descend: false, roll: 0, fire: false };
        controls.rollTap = G.rollTap; G.rollTap = 0;
        if (G.state === 'play') {
          // fire
          const fire = input.clicks > 0 || controls.fire || (input.leftDown && weapons.isAuto());
          input.clicks = 0;
          if (fire && weapons.equipped) weapons.tryFire(model, vehicle, G.aim);
        }
        const sdt = dt * G.timeScale;
        if (vehicle.phys2) {
          env.wind.update(sdt);
          const w = env.wind.sample(camera.position.x, camera.position.z, 2, _v);
          effectsWind.x = w.x * 0.85; effectsWind.z = w.z * 0.85;
          // camera shake when the shockwave reaches the camera
          for (let i = G.shakes.length - 1; i >= 0; i--) { const sh = G.shakes[i]; sh.t -= sdt; if (sh.t <= 0) { rig.trauma = Math.min(1, rig.trauma + sh.amt); G.shakes.splice(i, 1); } }
        }
        G.acc += sdt;
        let n = 0;
        const t0 = performance.now();
        while (G.acc >= DT && n < 30) { stepOnce(); G.acc -= DT; n++; }
        if (n >= 30) G.acc = 0;
        G.physMs += (performance.now() - t0 - G.physMs) * 0.1;
        G.time += sdt;
        weapons.update(sdt);
        ragdolls.update(sdt, G.state === 'play' ? vehicle : null);
        if (G.state === 'play') gameplay(sdt);
        destruction.sync();
      } else { input.clicks = 0; }
      const [dx, dy] = input.consumeDrag();
      const inGarage = G.overlay === 'garage';
      if (inGarage) { if (dx) showroom.drag(dx); if (input.wheel) { showroom.wheel(input.wheel); input.wheel = 0; } }
      else {
        if (dx || dy) rig.drag(dx, dy);
        if (input.wheel) { rig.wheel(input.wheel); input.wheel = 0; }
      }
      handleCarEvents();
      dmgVis.update(dt);
      model.tickSkin(performance.now() / 1000);
      looseWheels.update(running ? dt * G.timeScale : 0);

      if (!inGarage) { updateCarModel(dt); luck.update(dt, running && G.state === 'play'); }
      else model.group.scale.setScalar(rig.carScale || 1);   // the showroom always shows the full-size car
      if (running) { emitVehicleFX(dt); envFX(dt * G.timeScale); }
      effects.update(running ? dt * G.timeScale : 0);
      world.update(G.time);
      skyMat.uniforms.time.value = G.time;
      rig.trauma = Math.max(rig.trauma, effects.trauma);
      if (freeCam.on) updateFreeCam(dt); else if (G.crashCam) updateCrashCam(dt); else rig.update(dt, vehicle);
      const co = window.__sim && window.__sim.camOverride;
      if (co) { camera.position.set(...co.pos); camera.up.set(0, 1, 0); camera.lookAt(...co.look); camera.fov = co.fov || 40; camera.updateProjectionMatrix(); }
      if (controls.boost && vehicle.rear.length && vehicle.thrustN > 1000) rig.fovKick = Math.min(rig.fovKick + dt * 30, 9);
      sky.position.copy(camera.position);
      if (mapEnv) mapEnv.update(dt, camera);
      // shadow camera follows the car (snapped to texels to avoid shimmer)
      const tx = Math.round(vehicle.pos.x / 2) * 2, tz = Math.round(vehicle.pos.z / 2) * 2;
      sun.target.position.set(tx, vehicle.pos.y, tz);
      sun.position.set(tx + sunDir.x * 200, vehicle.pos.y + sunDir.y * 200, tz + sunDir.z * 200);
      // weapons aim
      if (weapons.equipped) { updateAim(); weapons.aim(model, G.aim); }
      hacks.update(dt, { fps: G.fps, physMs: G.physMs, calls: renderer.info.render.calls, awake: destruction.awake || 0, bodies: destruction.bodies.length });
      if (xray.on) updateXray();
      // flash
      if (G.flash) { G.flash = Math.max(0, G.flash - dt * 2.5); hud.flash(G.flash); }
      // sound
      sound.update({ speed: vehicle.vel.length(), powerKW: vehicle.powerKW, liftN: vehicle.lift.reduce((s, t) => s + t.u * t.max, 0) + vehicle.side.reduce((s, t) => s + t.u * t.max, 0), rearN: vehicle.rear.reduce((s, t) => s + t.u * t.max, 0),
        fan: vehicle.fan.level * (vehicle.contacts ? 1 : 0.2), slip: Math.max(...vehicle.wheels.map(w => w.contact ? w.sliding : 0)), refill: G.refilling, paused: G.paused || G.state !== 'play',
        scrape: vehicle.phys2 && vehicle.scrapes.length ? Math.min(1, vehicle.vel.length() / 20) : 0, leak: vehicle.phys2 && !settings.sandbox && vehicle.air > 0.5 ? Math.min(1, (vehicle.leakRate || 0) * 2) : 0 });
      // HUD
      if (G.state === 'play') {
        G.hudT -= dt; G.canvasT -= dt;
        if (G.hudT <= 0) {
          G.hudT = 1 / 20;
          hud.update(1 / 20, { vehicle, phys2: vehicle.phys2, sandbox: settings.sandbox, refilling: G.refilling, weapons, timers: G.timers, rings: G.rings, airtime: G.jump.active ? G.jump.t : 0, camName: CAMERA_MODES[rig.mode], camMode: rig.mode, xhX: G.xhX, xhY: G.xhY });
        }
        if (G.canvasT <= 0) { G.canvasT = 1 / 30; hud.drawADI(vehicle); hud.drawMinimap(mapImg, vehicle, { markers: markers() }); }
      }
      // start screen: shift the view so the car sits to the right of the menu
      const wantOffset = G.state === 'start' && innerWidth > 760;
      if (wantOffset) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.2, 0, innerWidth, innerHeight);
      else if (camera.view && camera.view.enabled) camera.clearViewOffset();
      // render (the garage draws its own showroom instead of the world)
      if (inGarage) {
        showroom.update(dt, innerWidth, innerHeight, innerWidth > 760);
        if (composer) { renderPass.scene = showroom.scene; renderPass.camera = showroom.camera; bloom.strength = 0.22; composer.render(); bloom.strength = 0.5; renderPass.scene = scene; renderPass.camera = camera; }
        else renderer.render(showroom.scene, showroom.camera);
      } else if (composer) composer.render(); else renderer.render(scene, camera);
      // fps monitor + automatic quality drop
      G.fpsN++; G.fpsT += rawDt;
      if (G.fpsT >= 1) {
        G.fps = G.fpsN / G.fpsT; G.fpsN = 0; G.fpsT = 0;
        if (G.state === 'play' && !G.paused && G.fps < 32 && settings.quality > 0 && G.autoDropped < 2) {
          G.lowFpsT++;
          if (G.lowFpsT >= 4) { G.lowFpsT = 0; G.autoDropped++; settings.quality--; saveSettings(); applyQuality(); hud.toast(`Graphics lowered to ${['Low', 'Medium', 'High'][settings.quality]} to keep it smooth (change in P menu)`, '', 3500); }
        } else G.lowFpsT = 0;
      }
    } catch (err) {
      G.errors++;
      console.error(err);
      if (G.errors <= 3) hud.toast('Recovered from an error: ' + (err && err.message), 'warn', 4000);
    }
  };
  requestAnimationFrame(frame);

  // hot-update snapshot for open viewers
  window.claude?.hot?.snapshot?.(() => ({ settings }));

  // ---------- test hooks ----------
  window.__sim = {
    THREE, vehicle, destruction, weapons, world, model, effects, rig, G, settings, teleports, hacks, setTimeOfDay,
    profile, garageUI, showroom, openGarage, rewards, paceCar, env, dmgVis, looseWheels, setPhysics,
    startGame, teleport: (i) => teleport(teleports.find(t => t.key === i) || teleports[0]),
    step(n, c) { controls = Object.assign({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: false, descend: false, roll: 0, fire: false }, c || {}); for (let i = 0; i < n; i++) stepOnce(); weapons.update(n * DT); ragdolls.update(n * DT, vehicle, 100000); destruction.sync(); gameplay(n * DT); },
    weaponList: WEAPON_LIST, skinIds: SKINS.map(s => s.id),
    get luck() { return luck; }, ragdolls,
    fireAt(x, y, z) { if (!weapons.equipped) weapons.equip(); return weapons.tryFire(model, vehicle, new THREE.Vector3(x, y, z)); },
    setCam(m) { rig.mode = m; rig.snap(); },
    renderInfo() { renderer.info.autoReset = false; renderer.info.reset(); const t = performance.now(); renderer.render(scene, camera); const ms = performance.now() - t; const r = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ms }; renderer.info.autoReset = true; let meshes = 0; scene.traverse(o => { if (o.isMesh) meshes++; }); r.meshes = meshes; return r; },
    programs: () => renderer.info.programs.length,
    stats: () => ({ fps: G.fps, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, bodies: destruction.liveCount(), errors: G.errors }),
  };
}

const startBoot = (data) => boot(data || {}).catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) { l.classList.add('err'); l.hidden = false; document.getElementById('load-s').textContent = 'Could not start: ' + (err && err.message ? err.message : err) + '. Reload the page to try again.'; }
});
if (window.claude?.hot?.ready) window.claude.hot.ready(startBoot); else startBoot(window.claude?.hot?.data ?? {});
