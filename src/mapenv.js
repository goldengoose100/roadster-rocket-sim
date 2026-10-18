// Map environments (2.5 maps: The Moon, Neon City).
// applyMapEnv(env, ctx) sets the time of day, then tweaks the sky, fog and lights for the map and adds
// optional extras: a star field and a far-away Earth that follow the camera.
// Everything here is wrapped so a bad value or a missing object never stops the game: the worst case is
// that the map simply keeps the normal sky.
//
// env (from the map, every field optional):
//   { gravity, tod: 'day'|'golden'|'sunset'|'night', sky: { zen: [r,g,b], hor: [r,g,b] },
//     fog: { color: '#rrggbb', density }, clouds: bool, earth: bool, stars: bool, dust: [r,g,b], wet: bool,
//     ambient: number (hemisphere light), sunIntensity: number, earthDir: [x,y,z] }
//   gravity / dust / wet are read by other parts of the game, not here.
// ctx: { THREE, scene, camera, renderer, fog, sky, skyMat, sun, hemi, setTimeOfDay, rebuildEnv? }

const NOOP = { update() {}, reapply() {}, dispose() {} };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const vec3 = (a) => (Array.isArray(a) && a.length >= 3 && num(a[0]) && num(a[1]) && num(a[2])) ? a : null;
const lum = (a) => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const warn = (msg, e) => { try { console.warn('[mapenv] ' + msg, e); } catch (_) { /* no console */ } };

// ---------- small seeded noise for the Earth texture ----------
function hash3(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi), c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi);
  const e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1), g = hash3(xi, yi + 1, zi + 1), h = hash3(xi + 1, yi + 1, zi + 1);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx, x2 = e + (f - e) * fx, x3 = g + (h - g) * fx;
  const y0 = x0 + (x1 - x0) * fy, y1 = x2 + (x3 - x2) * fy;
  return y0 + (y1 - y0) * fz;
}
function fbm(x, y, z, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return s / n;
}
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Equirectangular Earth: oceans, green/brown continents, ice caps, white clouds. DataTexture (no DOM needed).
function makeEarthTexture(THREE, W = 512, H = 256) {
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI;           // row 0 = south (flipY false)
    const cl = Math.cos(lat), sl = Math.sin(lat), alat = Math.abs(lat) * 180 / Math.PI;
    for (let i = 0; i < W; i++) {
      const lon = (i + 0.5) / W * Math.PI * 2;
      const px = cl * Math.cos(lon), py = sl, pz = cl * Math.sin(lon);
      // continents
      const e = fbm(px * 1.7 + 11.3, py * 1.7 + 4.1, pz * 1.7 - 7.7, 5);
      let r, g, b;
      if (e > 0.53) {
        const k = sstep(0.53, 0.7, e);
        const dry = sstep(0.45, 0.65, fbm(px * 4 + 3, py * 4 - 9, pz * 4 + 5, 3)) * (1 - sstep(10, 40, Math.abs(alat - 24)) * 0.4 - 0.2) + (alat < 35 && alat > 15 ? 0.25 : 0);
        const d = clamp(dry, 0, 1);
        r = 52 + (150 - 52) * d + 20 * k; g = 108 + (122 - 108) * d - 10 * k; b = 44 + (78 - 44) * d;
      } else {
        const coast = sstep(0.42, 0.53, e);
        r = 8 + 22 * coast; g = 34 + 56 * coast; b = 104 + 66 * coast;
      }
      // ice caps
      const ice = sstep(66, 74, alat + (vnoise(px * 9, py * 9, pz * 9) - 0.5) * 8);
      r += (236 - r) * ice; g += (242 - g) * ice; b += (248 - b) * ice;
      // clouds
      const cn = fbm(px * 3.2 - 21, py * 5.5 + 2, pz * 3.2 + 13, 4);
      const cloud = sstep(0.5, 0.72, cn) * 0.9;
      r += (240 - r) * cloud; g += (244 - g) * cloud; b += (250 - b) * cloud;
      const o = (j * W + i) * 4;
      data[o] = clamp(r, 0, 255); data[o + 1] = clamp(g, 0, 255); data[o + 2] = clamp(b, 0, 255); data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// soft blue ring for the atmosphere glow sprite
function makeGlowTexture(THREE, S = 64) {
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = (i + 0.5) / S * 2 - 1, dy = (j + 0.5) / S * 2 - 1;
    const r = Math.sqrt(dx * dx + dy * dy);
    // the Earth's disc covers r < ~0.77 (the middle is hidden behind the sphere anyway)
    const a = r < 0.74 ? 0.6 : Math.pow(Math.max(0, 1 - (r - 0.74) / 0.26), 2.2) * 0.6;
    const o = (j * S + i) * 4;
    data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = Math.round(clamp(a, 0, 1) * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const EARTH_VERT = `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const EARTH_FRAG = `uniform sampler2D map; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  float l = dot(n, normalize(sunDir));
  float lit = smoothstep(-0.08, 0.3, l);
  vec3 c = texture2D(map, vUv).rgb;
  vec3 col = c * (0.03 + 1.25 * lit);
  float facing = max(dot(n, normalize(cameraPosition - vW)), 0.0);
  float rim = pow(1.0 - facing, 3.0);
  col += vec3(0.22, 0.45, 1.0) * rim * (0.08 + 0.9 * lit) * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- cloud switch: adds a cloudAmt uniform to the shared sky shader ----------
// Patched in place (same material, same uniforms object) so main.js's sky and its reflection map both
// lose the clouds. The original text is kept so dispose() can put it back. If the shader text is not
// what we expect, nothing is changed.
function setClouds(skyMat, on) {
  if (!skyMat || !skyMat.uniforms) return false;
  const u = skyMat.uniforms;
  const ud = skyMat.userData || (skyMat.userData = {});
  if (ud.mapEnvOrigFrag) { if (u.cloudAmt) u.cloudAmt.value = on ? 1 : 0; return true; }
  if (on) return true;   // never patched and clouds wanted: nothing to do
  const src = skyMat.fragmentShader;
  if (typeof src !== 'string') return false;
  const re = /float\s+c\s*=\s*([^;]+);/;
  const all = src.match(/float\s+c\s*=/g);
  if (!all || all.length !== 1 || !re.test(src) || /\bcloudAmt\b/.test(src)) return false;
  const patched = 'uniform float cloudAmt;\n' + src.replace(re, 'float c = ($1) * cloudAmt;');
  u.cloudAmt = { value: 0 };
  ud.mapEnvOrigFrag = src;
  skyMat.fragmentShader = patched;
  skyMat.needsUpdate = true;
  return true;
}
function unpatchClouds(skyMat) {
  if (!skyMat || !skyMat.userData || !skyMat.userData.mapEnvOrigFrag) return;
  skyMat.fragmentShader = skyMat.userData.mapEnvOrigFrag;
  delete skyMat.userData.mapEnvOrigFrag;
  if (skyMat.uniforms) delete skyMat.uniforms.cloudAmt;
  skyMat.needsUpdate = true;
}

export function applyMapEnv(env, ctx) {
  try {
    return applyInner(env || {}, ctx || {});
  } catch (e) {
    warn('could not apply the map environment', e);
    return NOOP;
  }
}

function applyInner(env, ctx) {
  const THREE = ctx.THREE;
  if (!THREE) return NOOP;
  const { scene, fog, skyMat, sun, hemi } = ctx;
  const U = skyMat && skyMat.uniforms ? skyMat.uniforms : null;
  const owned = [];   // geometries / materials / textures to dispose

  // what the game had before, so dispose() can put it back
  const saved = {
    fogCol: fog && fog.color ? fog.color.clone() : null, fogDen: fog ? fog.density : null,
    zen: U && U.zen ? U.zen.value.clone() : null, hor: U && U.hor ? U.hor.value.clone() : null,
    night: U && U.night ? U.night.value : null, sb: U && U.sunBright ? U.sunBright.value : null,
    sunCol: sun ? sun.color.clone() : null, sunI: sun ? sun.intensity : null,
    hemiI: hemi ? hemi.intensity : null, hemiC: hemi ? hemi.color.clone() : null, hemiG: hemi && hemi.groundColor ? hemi.groundColor.clone() : null,
  };

  const tod = typeof env.tod === 'string' ? env.tod : null;
  const isNight = tod === 'night';
  const skyCfg = env.sky && typeof env.sky === 'object' ? env.sky : null;
  const zen = vec3(skyCfg && skyCfg.zen), hor = vec3(skyCfg && skyCfg.hor);
  const fogCfg = env.fog && typeof env.fog === 'object' ? env.fog : null;
  // black sky (the Moon): an Earth in the sky, stars by day, or a near-black zenith
  const blackSky = !isNight && (env.earth === true || env.stars === true || (!!zen && lum(zen) < 0.012 && (!hor || lum(hor) < 0.03)));

  // 1) clouds off before the time of day, so the reflection map main.js rebuilds has no clouds either
  if (env.clouds === false) { try { if (!setClouds(skyMat, false)) warn('sky shader not recognised, clouds left on'); } catch (e) { warn('cloud patch failed', e); } }
  else { try { setClouds(skyMat, true); } catch (_) { /* leave it */ } }

  // 2) time of day (lights, sky, exposure, car lights)
  if (tod && typeof ctx.setTimeOfDay === 'function') {
    try { ctx.setTimeOfDay(tod); } catch (e) { warn('setTimeOfDay failed', e); }
  }

  // 3) overrides on top of the time of day
  const syncParticleFog = (oldD, newD) => {
    // effects.js copies fog.density into its particle shaders once; keep them in step
    if (!scene || !scene.traverse || oldD === newD) return;
    scene.traverse((o) => {
      const u = o.material && o.material.uniforms;
      if (u && u.fogDensity && typeof u.fogDensity.value === 'number' && Math.abs(u.fogDensity.value - oldD) < 1e-9) u.fogDensity.value = newD;
    });
  };
  const setFogDensity = (d) => {
    if (!fog || !num(d)) return;
    const nd = clamp(d, 0, 0.05);
    const old = fog.density;
    fog.density = nd;
    try { syncParticleFog(old, nd); } catch (_) { /* particles keep their fog */ }
  };

  const applyOverrides = () => {
    // sky colours
    if (U) {
      if (blackSky) {
        if (U.zen) U.zen.value.set(...(zen || [0.0, 0.0, 0.0015]));
        if (U.hor) U.hor.value.set(...(hor || [0.006, 0.006, 0.008]));
        if (U.night) U.night.value = 0;          // our own stars instead of the shader's night stars
        if (U.sunBright) U.sunBright.value = 0.3; // no air: hardly any glow round the sun, the disc stays
      } else {
        if (zen && U.zen) U.zen.value.set(zen[0], zen[1], zen[2]);
        if (hor && U.hor) U.hor.value.set(hor[0], hor[1], hor[2]);
      }
    }
    // fog
    if (fog) {
      if (fogCfg && typeof fogCfg.color === 'string') { try { fog.color.set(fogCfg.color); } catch (_) { /* bad colour */ } }
      else if (fogCfg && vec3(fogCfg.color)) fog.color.setRGB(...fogCfg.color);
      else if (blackSky) fog.color.setRGB(0.004, 0.004, 0.005);
      if (fogCfg && num(fogCfg.density)) setFogDensity(fogCfg.density);
      else if (blackSky) setFogDensity(Math.min(fog.density, 0.00012));
    }
    // lights
    if (blackSky) {
      if (sun) { sun.color.set('#ffffff'); sun.intensity = num(env.sunIntensity) ? env.sunIntensity : Math.max(sun.intensity, 4.4); }
      if (hemi) {
        hemi.intensity = num(env.ambient) ? env.ambient : 0.1;
        hemi.color.set('#b8c0d0'); if (hemi.groundColor) hemi.groundColor.set('#85807a');
      }
    } else if (isNight) {
      // moody but readable: cars and roads must still show up
      if (sun) sun.intensity = num(env.sunIntensity) ? env.sunIntensity : Math.max(sun.intensity, 0.6);
      if (hemi) {
        hemi.intensity = num(env.ambient) ? env.ambient : Math.max(hemi.intensity, 0.55);
        hemi.color.set('#a99cf0'); if (hemi.groundColor) hemi.groundColor.set('#4b3d63');
      }
    } else {
      if (sun && num(env.sunIntensity)) sun.intensity = env.sunIntensity;
      if (hemi && num(env.ambient)) hemi.intensity = env.ambient;
    }
  };

  // rebuild the reflection map so cars reflect the new sky, not the one setTimeOfDay drew
  const rebuildEnv = () => {
    if (typeof ctx.rebuildEnv === 'function') { ctx.rebuildEnv(); return; }
    const renderer = ctx.renderer;
    if (!renderer || !scene || !skyMat || !THREE.PMREMGenerator) return;
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    const sg = new THREE.SphereGeometry(100, 32, 16);
    es.add(new THREE.Mesh(sg, skyMat));
    const gg = new THREE.CircleGeometry(90, 32);
    const gc = blackSky ? [0.07, 0.07, 0.07] : isNight ? [0.03, 0.025, 0.045] : [0.3, 0.25, 0.2];
    const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(gc[0], gc[1], gc[2]) });
    const ground = new THREE.Mesh(gg, gm);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -3; es.add(ground);
    const old = scene.environment;
    scene.environment = pm.fromScene(es, 0.02).texture;
    if (old && old.dispose) old.dispose();
    pm.dispose(); sg.dispose(); gg.dispose(); gm.dispose();
  };

  const reapply = () => {
    try { applyOverrides(); } catch (e) { warn('overrides failed', e); }
    if (blackSky || isNight || zen || hor || fogCfg) { try { rebuildEnv(); } catch (e) { warn('reflection rebuild failed', e); } }
  };
  reapply();

  // 4) extras that follow the camera
  let root = null, earthSpin = null;
  if (scene && (env.stars === true || env.earth === true)) {
    root = new THREE.Group();
    root.name = 'mapEnvSky';
    root.frustumCulled = false;

    if (env.stars === true) {
      try { buildStars(THREE, root, owned); } catch (e) { warn('stars failed', e); }
    }
    if (env.earth === true) {
      try { earthSpin = buildEarth(THREE, root, owned, U, env); } catch (e) { warn('earth failed', e); }
    }
    scene.add(root);
    if (ctx.camera && ctx.camera.position) root.position.copy(ctx.camera.position);
  }

  let broken = false;
  const update = (dt, camera) => {
    if (broken || !root) return;
    try {
      const cam = camera || ctx.camera;
      if (cam && cam.position) root.position.copy(cam.position);
      if (earthSpin) {
        const d = num(dt) ? clamp(dt, 0, 0.1) : 0;
        earthSpin.rotation.y = (earthSpin.rotation.y + d * 0.012) % (Math.PI * 2);
      }
    } catch (e) { broken = true; warn('update failed, extras frozen', e); }
  };

  const dispose = () => {
    try {
      if (root && root.parent) root.parent.remove(root);
      for (const o of owned) { try { o.dispose(); } catch (_) { /* already gone */ } }
      owned.length = 0; root = null; earthSpin = null;
      unpatchClouds(skyMat);
      if (fog && saved.fogCol) { fog.color.copy(saved.fogCol); setFogDensity(saved.fogDen); }
      if (U) {
        if (saved.zen && U.zen) U.zen.value.copy(saved.zen);
        if (saved.hor && U.hor) U.hor.value.copy(saved.hor);
        if (saved.night !== null && U.night) U.night.value = saved.night;
        if (saved.sb !== null && U.sunBright) U.sunBright.value = saved.sb;
      }
      if (sun && saved.sunCol) { sun.color.copy(saved.sunCol); sun.intensity = saved.sunI; }
      if (hemi && saved.hemiC) { hemi.color.copy(saved.hemiC); hemi.intensity = saved.hemiI; if (saved.hemiG && hemi.groundColor) hemi.groundColor.copy(saved.hemiG); }
    } catch (e) { warn('dispose failed', e); }
  };

  return { update, reapply, dispose };
}

// ~2500 small white points on a big sphere, mostly above the horizon. No fog, behind everything.
function buildStars(THREE, root, owned) {
  const R = 3500;
  const make = (count, size, bMin, bMax, seed) => {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    let s = seed >>> 0;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < count; i++) {
      const y = -0.04 + rnd() * 1.04;               // uniform over the sphere area above -2 degrees
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3] = Math.cos(a) * rr * R; pos[i * 3 + 1] = y * R; pos[i * 3 + 2] = Math.sin(a) * rr * R;
      const b = bMin + Math.pow(rnd(), 3) * (bMax - bMin);
      const t = rnd();                              // a few blue-ish and a few warm stars
      const tr = t < 0.15 ? 0.8 : t > 0.9 ? 1.1 : 1, tb = t < 0.15 ? 1.15 : t > 0.9 ? 0.75 : 1;
      col[i * 3] = b * tr; col[i * 3 + 1] = b; col[i * 3 + 2] = b * tb;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.01);
    const mat = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = -1; pts.matrixAutoUpdate = true;
    owned.push(geo, mat);
    root.add(pts);
  };
  make(2300, 1.4, 0.35, 1.3, 1234567);   // faint
  make(200, 2.4, 0.9, 2.2, 7654321);     // bright (these catch a little bloom)
}

// Big blue-and-white Earth ~3000 m away, ~25 degrees up, lit from the sun's direction, with a thin glow.
function buildEarth(THREE, root, owned, U, env) {
  const D = 3000, R = 260;
  const dir = new THREE.Vector3();
  const ed = vec3(env.earthDir);
  if (ed) dir.set(ed[0], ed[1], ed[2]);
  else {
    // 110 degrees round from the sun so it shows as a half-lit Earth, 25 degrees above the horizon
    const sd = U && U.sunDir && U.sunDir.value ? U.sunDir.value : new THREE.Vector3(0.5, 0.5, -0.7);
    const az = Math.atan2(sd.z, sd.x) + 110 * Math.PI / 180, el = 25 * Math.PI / 180;
    dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  }
  if (dir.lengthSq() < 1e-6) dir.set(0.5, 0.42, 0.75);
  dir.normalize();
  if (dir.y < 0.05) { dir.y = 0.05; dir.normalize(); }

  const holder = new THREE.Group();   // tilted axis
  holder.position.copy(dir).multiplyScalar(D);
  holder.rotation.z = 0.41;
  root.add(holder);

  const tex = makeEarthTexture(THREE);
  const geo = new THREE.SphereGeometry(R, 48, 32);
  // shares the sky's sunDir vector, so the lit side follows the time of day
  const sunDir = U && U.sunDir && U.sunDir.value && U.sunDir.value.isVector3 ? U.sunDir.value : new THREE.Vector3(0.5, 0.5, -0.7).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, sunDir: { value: sunDir } },
    vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG, fog: false,
  });
  const earth = new THREE.Mesh(geo, mat);
  earth.renderOrder = -1;
  earth.rotation.y = 2.2;
  earth.castShadow = false; earth.receiveShadow = false;
  holder.add(earth);
  owned.push(tex, geo, mat);

  try {
    const gtex = makeGlowTexture(THREE);
    const gmat = new THREE.SpriteMaterial({ map: gtex, color: new THREE.Color(0.35, 0.6, 1.0), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Sprite(gmat);
    glow.scale.set(R * 2.6, R * 2.6, 1);
    glow.position.copy(dir).multiplyScalar(D);
    glow.renderOrder = -1;
    root.add(glow);
    owned.push(gtex, gmat);
  } catch (e) { warn('earth glow failed', e); }

  return earth;
}
