const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexoDesktop', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  onWindowState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },
  getSystemSnapshot: () => ipcRenderer.invoke('system:snapshot'),
  getTopProcesses: () => ipcRenderer.invoke('system:top-processes'),
  openTaskManager: () => ipcRenderer.invoke('system:task-manager'),
  listDrives: () => ipcRenderer.invoke('drives:list'),
  optimizeDrive: (driveLetter) => ipcRenderer.invoke('drives:optimize', driveLetter),
  getCleanupPreview: () => ipcRenderer.invoke('cleanup:preview'),
  cleanupTempFiles: () => ipcRenderer.invoke('cleanup:run'),
  repairSystemFiles: () => ipcRenderer.invoke('system:repair'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  }
});
