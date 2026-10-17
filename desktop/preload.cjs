// Bridge between the game page and the desktop shell (versions + updater). Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('get-info');
contextBridge.exposeInMainWorld('desktop', {
  gameVersion: info.gameVersion,
  shellVersion: info.shellVersion,
  booted: () => ipcRenderer.send('booted'),
  checkForUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  openDownloadPage: () => ipcRenderer.send('open-download'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, i) => cb(i)),
  onProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onNotice: (cb) => ipcRenderer.on('notice', (_e, n) => cb(n)),
});
