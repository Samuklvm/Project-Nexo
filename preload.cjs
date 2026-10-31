const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('nexoDesktop', {
  // Janela
  minimizeWindow: () => call('window:minimize'),
  toggleMaximizeWindow: () => call('window:toggle-maximize'),
  closeWindow: () => call('window:close'),
  getWindowState: () => call('window:get-state'),
  onWindowState: subscribe('window:state'),
  // Sistema e sensores
  getSystemSnapshot: () => call('system:snapshot'),
  getHardwareSensors: () => call('sensors:snapshot'),
  getTopProcesses: () => call('system:top-processes'),
  openTaskManager: () => call('system:task-manager'),
  listDrives: () => call('drives:list'),
  optimizeDrive: (driveLetter) => call('drives:optimize', driveLetter),
  repairSystemFiles: () => call('system:repair'),
  // Limpeza
  scanCleanup: () => call('cleanup:scan'),
  getCleanupPreview: () => call('cleanup:preview'),
  runCleanup: (ids) => call('cleanup:run', ids),
  cleanupTempFiles: () => call('cleanup:run', ['temp']),
  // Energia, inicialização e configurações do Windows
  listPowerPlans: () => call('power:list'),
  setPowerPlan: (guid) => call('power:set', guid),
  listStartupItems: () => call('startup:list'),
  openWindowsSettings: (page) => call('system:open-settings', page),
  // Aplicativo
  getAppInfo: () => call('app:info'),
  openLink: (key) => call('app:open-link', key),
  getWallpaper: () => call('wallpaper:get'),
  setWallpaper: (bytes) => call('wallpaper:set', bytes),
  resetWallpaper: () => call('wallpaper:reset'),
  getPrivacy: () => call('privacy:get'),
  setPrivacy: (enabled) => call('privacy:set', enabled),
  uninstallApp: () => call('app:uninstall'),
  // Atualizações
  checkForUpdates: () => call('updates:check'),
  downloadUpdate: () => call('updates:download'),
  installUpdate: () => call('updates:install'),
  onUpdateStatus: subscribe('updates:status')
});
