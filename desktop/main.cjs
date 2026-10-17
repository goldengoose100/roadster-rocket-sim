// Desktop shell: opens the game in its own window (F11 = fullscreen) and keeps it up to date.
// Updates are just the game file (~1 MB) downloaded from GitHub, checked with SHA-256, stored in
// the user's app-data folder, and rolled back automatically if a new version fails to start.
const { app, BrowserWindow, Menu, shell, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REPO = 'goldengoose100/roadster-rocket-sim';
const UPDATE_BASE = process.env.ROADSTER_UPDATE_URL || `https://raw.githubusercontent.com/${REPO}/main/updates/`;
const DOWNLOAD_PAGE = `https://github.com/${REPO}#download`;
const BOOT_TIMEOUT = Number(process.env.ROADSTER_BOOT_TIMEOUT) || 45000;
const SHELL_VERSION = app.getVersion();

app.commandLine.appendSwitch('force_high_performance_gpu');
Menu.setApplicationMenu(null);

// ---------- versions on disk ----------
const bundledDir = path.join(__dirname, 'app');
const bundled = { version: JSON.parse(fs.readFileSync(path.join(bundledDir, 'version.json'), 'utf8')).version, file: path.join(bundledDir, 'index.html'), bundled: true };
let storeDir, statePath;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const validVersion = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function readState() { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return { installed: null, previous: null, bad: [] }; } }
function writeState(s) { fs.mkdirSync(storeDir, { recursive: true }); fs.writeFileSync(statePath + '.tmp', JSON.stringify(s, null, 2)); fs.renameSync(statePath + '.tmp', statePath); }
function usable(entry, state) {
  if (!entry || !validVersion(entry.version) || state.bad.includes(entry.version)) return false;
  try { return sha256(fs.readFileSync(entry.file)) === entry.sha256; } catch (_) { return false; }
}
// newest working version: a downloaded update, or the one that shipped with the app
function pickGame() {
  const state = readState();
  if (usable(state.installed, state) && cmp(state.installed.version, bundled.version) > 0) return state.installed;
  return bundled;
}

let win = null, current = null, booted = false, bootTimer = null, notice = null, latest = null, upWin = null;
const CHECK_EVERY = 20 * 60 * 1000;

function load(entry) {
  current = entry; booted = false;
  clearTimeout(bootTimer);
  win.loadFile(entry.file);
  // a downloaded version that never finishes starting gets rolled back
  if (!entry.bundled) bootTimer = setTimeout(() => rollback('it did not finish starting'), BOOT_TIMEOUT);
}
function rollback(reason) {
  if (!current || current.bundled || booted) return;
  const state = readState();
  const badVer = current.version;
  if (!state.bad.includes(badVer)) state.bad.push(badVer);
  const prev = state.previous && state.previous.version !== badVer && usable(state.previous, state) ? state.previous : null;
  try { if (state.installed && state.installed.version === badVer) fs.rmSync(state.installed.file, { force: true }); } catch (_) { /* ignore */ }
  state.installed = prev; state.previous = null;
  writeState(state);
  const next = pickGame();
  notice = `Update ${badVer} didn't start (${reason}), so the game went back to version ${next.version}.`;
  load(next);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 600,
    backgroundColor: '#07090b', title: 'Roadster Rocket Sim', show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', () => { if (!booted) rollback('it crashed'); });
  win.webContents.on('did-fail-load', () => { if (!booted) rollback('it failed to load'); });
  load(pickGame());
}

// ---------- update check / install ----------
async function fetchWithTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await net.fetch(url, { signal: ctrl.signal, cache: 'no-store' }); } finally { clearTimeout(t); }
}
async function checkForUpdates() {
  try {
    const res = await fetchWithTimeout(UPDATE_BASE + 'latest.json?t=' + Date.now());
    if (!res.ok) return { error: `server said ${res.status}` };
    const m = await res.json();
    if (!validVersion(m.version) || !/^game-[\d.]+\.html$/.test(m.file || '') || !/^[0-9a-f]{64}$/.test(m.sha256 || '')) return { error: 'the update info is malformed' };
    const state = readState();
    if (cmp(m.version, current.version) <= 0 || state.bad.includes(m.version)) return { available: false };
    latest = m;
    const needsFullDownload = !!m.minShell && validVersion(m.minShell) && cmp(m.minShell, SHELL_VERSION) > 0;
    return { available: true, version: m.version, notes: Array.isArray(m.notes) ? m.notes.slice(0, 12).map(String) : [], size: Number(m.size) || 0, needsFullDownload };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timed out' : 'no connection' };
  }
}
async function installUpdate() {
  const m = latest;
  if (!m) return { ok: false, error: 'no update selected' };
  try {
    const res = await fetchWithTimeout(UPDATE_BASE + m.file + '?t=' + Date.now(), 120000);
    if (!res.ok) return { ok: false, error: `download failed (${res.status})` };
    const total = Number(res.headers.get('content-length')) || Number(m.size) || 0;
    const reader = res.body.getReader();
    const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value)); got += value.length;
      if (total) for (const w of [win, upWin]) if (w) w.webContents.send('update-progress', Math.min(1, got / total));
    }
    const buf = Buffer.concat(parts);
    if (sha256(buf) !== m.sha256) return { ok: false, error: 'the download was corrupted (fingerprint mismatch)' };
    fs.mkdirSync(storeDir, { recursive: true });
    const file = path.join(storeDir, m.file);
    fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file);
    const state = readState();
    state.previous = state.installed && usable(state.installed, state) ? state.installed : null;
    state.installed = { version: m.version, file, sha256: m.sha256 };
    writeState(state);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'download timed out' : 'connection lost' };
  }
}

ipcMain.on('get-info', (e) => { e.returnValue = { gameVersion: current ? current.version : bundled.version, shellVersion: SHELL_VERSION }; });
ipcMain.on('booted', async () => {
  booted = true; clearTimeout(bootTimer);
  if (notice && win) { win.webContents.send('notice', notice); notice = null; }
  // keep the previous version around only until the new one has started once
  if (!current.bundled) { const s = readState(); if (s.installed && s.installed.version === current.version) { s.verified = current.version; writeState(s); } }
});
ipcMain.handle('check-updates', () => checkForUpdates());
ipcMain.handle('install-update', async () => { const r = await installUpdate(); if (r.ok) setTimeout(() => load(pickGame()), 1200); return r; });

// ---------- separate update window: shown at launch, or the game closes when an update appears ----------
function showUpdater(info) {
  if (upWin) return;
  if (win) { const w = win; win = null; w.destroy(); }
  upWin = new BrowserWindow({
    width: 520, height: 420, resizable: false, maximizable: false, backgroundColor: '#07090b', title: 'Roadster Rocket Sim · Update', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  upWin.loadFile(path.join(__dirname, 'updater.html'), { query: { info: JSON.stringify({ ...info, current: current ? current.version : bundled.version }) } });
  upWin.on('closed', () => { upWin = null; if (!win) startGame(); });
}
ipcMain.handle('updater-install', async () => {
  const r = await installUpdate();
  if (r.ok) setTimeout(() => { if (upWin) upWin.close(); }, 900);
  return r;
});
ipcMain.on('updater-skip', () => { if (upWin) upWin.close(); });
function startGame() { if (!win) createWindow(); }
async function launchCheck() {
  current = pickGame();
  const r = await Promise.race([checkForUpdates(), new Promise(res => setTimeout(() => res({}), 5000))]);
  if (r.available) showUpdater(r); else startGame();
}
setInterval(async () => { if (!win || !booted) return; const r = await checkForUpdates(); if (r.available) showUpdater(r); }, CHECK_EVERY);
ipcMain.on('open-download', () => shell.openExternal(DOWNLOAD_PAGE));

app.whenReady().then(() => {
  storeDir = path.join(app.getPath('userData'), 'game-updates');
  statePath = path.join(storeDir, 'state.json');
  launchCheck();
});
app.on('window-all-closed', () => { if (!upWin && !win) app.quit(); });
