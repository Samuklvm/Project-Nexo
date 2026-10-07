const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexoDesktop', {
  listDrives: () => ipcRenderer.invoke('drives:list'),
  optimizeDrive: (driveId, action) => ipcRenderer.invoke('drives:optimize', { driveId, action }),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install')
});
