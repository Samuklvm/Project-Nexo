const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nexo', {
  info: () => ipcRenderer.invoke('info'),
  notices: () => ipcRenderer.invoke('notices'),
  openLink: key => ipcRenderer.invoke('open-link', key),
  pickDir: () => ipcRenderer.invoke('pick-dir'),
  install: o => ipcRenderer.invoke('install', o),
  openApp: () => ipcRenderer.invoke('open-app'),
  minimize: () => ipcRenderer.send('win', 'min'),
  close: () => ipcRenderer.send('win', 'close'),
  onProgress: cb => ipcRenderer.on('progress', (_e, p) => cb(p))
});
