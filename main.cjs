const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#090a12',
    title: 'Nexo Device Care',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('drives:list', async () => {
  return [
    { id: 'nvme', name: 'C: NVMe SSD', type: 'ssd' },
    { id: 'hdd', name: 'D: Disco rígido', type: 'hdd' }
  ];
});

ipcMain.handle('drives:optimize', async (_event, payload) => {
  return {
    ok: true,
    driveId: payload?.driveId || 'unknown',
    action: payload?.action || 'optimize',
    message: 'Otimização iniciada com confirmação do usuário.'
  };
});

ipcMain.handle('updates:check', async () => {
  return {
    available: false,
    version: app.getVersion(),
    message: 'Sem atualizações pendentes.'
  };
});

ipcMain.handle('updates:install', async () => {
  autoUpdater.quitAndInstall();
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
