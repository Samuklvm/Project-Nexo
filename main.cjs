const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CLEANUP_MAX_DEPTH = 2;
const CLEANUP_MAX_FILES = 5000;
const CLEANUP_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let mainWindow;
let updateDownloaded = false;

function runPowerShell(script, timeout = 15000) {
  if (process.platform !== 'win32') {
    throw new Error('Esta operação está disponível somente no Windows.');
  }

  return execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ], {
    windowsHide: true,
    timeout,
    maxBuffer: 2 * 1024 * 1024
  });
}

function getCpuTimes() {
  return os.cpus().reduce((total, cpu) => {
    for (const value of Object.values(cpu.times)) total += value;
    return total;
  }, 0);
}

async function getCpuUsage() {
  const beforeTotal = getCpuTimes();
  const beforeIdle = os.cpus().reduce((total, cpu) => total + cpu.times.idle, 0);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const cpus = os.cpus();
  const afterTotal = cpus.reduce((total, cpu) => {
    for (const value of Object.values(cpu.times)) total += value;
    return total;
  }, 0);
  const afterIdle = cpus.reduce((total, cpu) => total + cpu.times.idle, 0);
  const totalDelta = afterTotal - beforeTotal;

  if (totalDelta <= 0) return 0;
  return Math.round((1 - (afterIdle - beforeIdle) / totalDelta) * 100);
}

function normalizeDrive(item) {
  const driveLetter = String(item.letter || '').toUpperCase();
  const sizeBytes = Math.max(0, Number(item.sizeBytes) || 0);
  const freeBytes = Math.min(sizeBytes, Math.max(0, Number(item.freeBytes) || 0));
  const usedBytes = Math.max(0, sizeBytes - freeBytes);
  const label = String(item.label || '').trim();

  return {
    id: driveLetter,
    driveLetter,
    name: `${driveLetter}: ${label || 'Unidade local'}`,
    fileSystem: String(item.fileSystem || 'Desconhecido'),
    sizeBytes,
    freeBytes,
    usedBytes,
    usedPercent: sizeBytes ? Math.round((usedBytes / sizeBytes) * 100) : 0
  };
}

async function listDrives() {
  if (process.platform === 'win32') {
    const script = "$drives = Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object @{Name='letter';Expression={$_.DeviceID.Substring(0,1)}}, @{Name='label';Expression={$_.VolumeName}}, @{Name='fileSystem';Expression={$_.FileSystem}}, @{Name='sizeBytes';Expression={[double]$_.Size}}, @{Name='freeBytes';Expression={[double]$_.FreeSpace}}; $drives | ConvertTo-Json -Compress";
    const { stdout } = await runPowerShell(script);
    if (!stdout.trim()) return [];

    const result = JSON.parse(stdout);
    return (Array.isArray(result) ? result : [result]).map(normalizeDrive);
  }

  const root = path.parse(os.homedir()).root || path.parse(process.cwd()).root;
  const stats = await fs.statfs(root, { bigint: true });
  return [normalizeDrive({
    letter: root || '/',
    label: 'Volume principal',
    fileSystem: 'Desconhecido',
    sizeBytes: Number(stats.blocks * stats.bsize),
    freeBytes: Number(stats.bavail * stats.bsize)
  })];
}

async function getSystemSnapshot() {
  const [cpuUsage, drives] = await Promise.all([
    getCpuUsage(),
    listDrives().catch(() => [])
  ]);
  const memoryTotalBytes = os.totalmem();
  const memoryFreeBytes = os.freemem();
  const memoryUsedBytes = memoryTotalBytes - memoryFreeBytes;
  const addresses = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  const networkConnected = addresses.some((address) =>
    !address.internal && (address.family === 'IPv4' || address.family === 4)
  );
  const systemDrive = process.platform === 'win32' ? `${path.parse(os.homedir()).root[0].toUpperCase()}` : '';
  const primaryDrive = drives.find((drive) => drive.driveLetter === systemDrive) || drives[0] || null;

  return {
    hostname: os.hostname(),
    operatingSystem: `${os.type()} ${os.release()}`,
    cpuUsage,
    memoryTotalBytes,
    memoryUsedBytes,
    memoryPercent: memoryTotalBytes ? Math.round((memoryUsedBytes / memoryTotalBytes) * 100) : 0,
    networkConnected,
    uptimeSeconds: os.uptime(),
    drives,
    primaryDrive,
    version: app.getVersion()
  };
}

async function collectOldTempFiles() {
  const root = path.resolve(os.tmpdir());
  const cutoff = Date.now() - CLEANUP_MIN_AGE_MS;
  const files = [];

  async function visit(directory, depth) {
    if (depth > CLEANUP_MAX_DEPTH || files.length >= CLEANUP_MAX_FILES) return;

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= CLEANUP_MAX_FILES) break;
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stats = await fs.stat(entryPath);
          if (stats.mtimeMs < cutoff) files.push({ path: entryPath, size: stats.size });
        } catch {
          continue;
        }
      }
    }
  }

  await visit(root, 0);
  return { root, files };
}

function isInsideDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function publishUpdateStatus(state, details = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updates:status', { state, ...details });
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => publishUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => publishUpdateStatus('downloading', { version: info.version }));
autoUpdater.on('update-not-available', () => publishUpdateStatus('current'));
autoUpdater.on('download-progress', (progress) => publishUpdateStatus('downloading', { percent: Math.round(progress.percent) }));
autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  publishUpdateStatus('downloaded', { version: info.version });
});
autoUpdater.on('error', (error) => publishUpdateStatus('error', { message: error.message }));

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('system:snapshot', getSystemSnapshot);

ipcMain.handle('drives:list', listDrives);

ipcMain.handle('drives:optimize', async (_event, driveLetter) => {
  if (process.platform !== 'win32') {
    throw new Error('A otimização de unidades está disponível somente no Windows.');
  }
  if (typeof driveLetter !== 'string' || !/^[A-Z]$/i.test(driveLetter)) {
    throw new Error('Unidade inválida.');
  }

  const letter = driveLetter.toUpperCase();
  const script = `$process = Start-Process -FilePath 'defrag.exe' -ArgumentList @('${letter}:', '/O', '/U', '/V') -Verb RunAs -Wait -PassThru; exit $process.ExitCode`;
  await runPowerShell(script, 60 * 60 * 1000);
  return { ok: true, driveLetter: letter };
});

ipcMain.handle('cleanup:preview', async () => {
  const { files } = await collectOldTempFiles();
  return {
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    minAgeDays: CLEANUP_MIN_AGE_MS / (24 * 60 * 60 * 1000),
    maxFiles: CLEANUP_MAX_FILES
  };
});

ipcMain.handle('cleanup:run', async () => {
  const { root, files } = await collectOldTempFiles();
  let removedCount = 0;
  let bytesFreed = 0;

  for (const file of files) {
    if (!isInsideDirectory(root, file.path)) continue;
    try {
      const stats = await fs.lstat(file.path);
      if (!stats.isFile() || stats.mtimeMs >= Date.now() - CLEANUP_MIN_AGE_MS) continue;
      await fs.unlink(file.path);
      removedCount += 1;
      bytesFreed += stats.size;
    } catch {
      continue;
    }
  }

  return { removedCount, bytesFreed };
});

ipcMain.handle('system:repair', async () => {
  if (process.platform !== 'win32') {
    throw new Error('A verificação de arquivos do sistema está disponível somente no Windows.');
  }

  await runPowerShell("$process = Start-Process -FilePath 'sfc.exe' -ArgumentList '/scannow' -Verb RunAs -Wait -PassThru; exit $process.ExitCode", 60 * 60 * 1000);
  return { ok: true };
});

ipcMain.handle('updates:check', async () => {
  if (!app.isPackaged) return { state: 'development', version: app.getVersion() };

  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      state: result?.isUpdateAvailable ? 'downloading' : 'current',
      version: result?.updateInfo?.version || app.getVersion()
    };
  } catch (error) {
    return { state: 'error', message: error.message };
  }
});

ipcMain.handle('updates:install', async () => {
  if (!updateDownloaded) throw new Error('Nenhuma atualização foi baixada ainda.');
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
