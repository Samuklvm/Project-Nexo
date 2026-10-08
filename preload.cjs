const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexoDesktop', {
  getSystemSnapshot: () => ipcRenderer.invoke('system:snapshot'),
  getTopProcesses: () => ipcRenderer.invoke('system:top-processes'),
  openTaskManager: () => ipcRenderer.invoke('system:task-manager'),
  listDrives: () => ipcRenderer.invoke('drives:list'),
  optimizeDrive: (driveLetter) => ipcRenderer.invoke('drives:optimize', driveLetter),
  getCleanupPreview: () => ipcRenderer.invoke('cleanup:preview'),
  cleanupTempFiles: () => ipcRenderer.invoke('cleanup:run'),
  repairSystemFiles: () => ipcRenderer.invoke('system:repair'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  }
});
