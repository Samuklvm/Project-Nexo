const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile, spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { pathToFileURL } = require('url');

const execFileAsync = promisify(execFile);
const CLEANUP_MAX_FILES = 5000;
const CLEANUP_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DRIVE_CACHE_TTL_MS = 30 * 1000;
const TEMPERATURE_CACHE_TTL_MS = 15 * 1000;
const trustedDocumentUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
let mainWindow;
let updateDownloaded = false;
let updateAvailableVersion = null;
let updateDownloadInProgress = false;
let driveCache = { expiresAt: 0, value: null, pending: null };
let temperatureCache = { expiresAt: 0, value: null, pending: null };

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

function getCpuSample() {
  return os.cpus().reduce((sample, cpu) => {
    sample.total += Object.values(cpu.times).reduce((total, value) => total + value, 0);
    sample.idle += cpu.times.idle;
    return sample;
  }, { total: 0, idle: 0 });
}

async function getCpuUsage() {
  const before = getCpuSample();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = getCpuSample();
  const totalDelta = after.total - before.total;

  if (totalDelta <= 0) return 0;
  const usage = Math.round((1 - (after.idle - before.idle) / totalDelta) * 100);
  return Math.round(Math.max(0, Math.min(100, usage)) * 10) / 10;
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

async function getCachedDrives() {
  if (driveCache.value && Date.now() < driveCache.expiresAt) return driveCache.value;
  if (driveCache.pending) return driveCache.pending;

  driveCache.pending = listDrives().then((drives) => {
    driveCache.value = drives;
    driveCache.expiresAt = Date.now() + DRIVE_CACHE_TTL_MS;
    return drives;
  }).finally(() => {
    driveCache.pending = null;
  });
  return driveCache.pending;
}

async function getTemperatureReadings() {
  if (process.platform !== 'win32') return { acpiSensors: [], gpuSensors: [] };

  const [acpiSensors, gpuSensors] = await Promise.all([
    (async () => {
      const script = String.raw`
$sensors = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object {
  $celsius = [Math]::Round(([double]$_.CurrentTemperature / 10) - 273.15, 1)
  if ($celsius -ge 0 -and $celsius -le 125) {
    [pscustomobject]@{ name = [string]$_.InstanceName; celsius = $celsius }
  }
})
$sensors | ConvertTo-Json -Compress
`;
      try {
        const { stdout } = await runPowerShell(script, 5000);
        if (!stdout.trim()) return [];
        const result = JSON.parse(stdout);
        return (Array.isArray(result) ? result : [result]).map((sensor, index) => ({
          name: `Zona ACPI ${index + 1}`,
          celsius: Number(sensor.celsius)
        })).filter((sensor) => Number.isFinite(sensor.celsius));
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        const { stdout } = await execFileAsync('nvidia-smi', [
          '--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total',
          '--format=csv,noheader,nounits'
        ], { windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024 });
        return stdout.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
          const [temperature, usage, memoryUsed, memoryTotal] = line.split(',').map((value) => Number(value.trim()));
          return {
            name: `GPU ${index + 1}`,
            temperatureCelsius: Number.isFinite(temperature) ? temperature : null,
            usagePercent: Number.isFinite(usage) ? Math.max(0, Math.min(100, usage)) : null,
            memoryUsedMb: Number.isFinite(memoryUsed) ? memoryUsed : null,
            memoryTotalMb: Number.isFinite(memoryTotal) ? memoryTotal : null
          };
        });
      } catch {
        return [];
      }
    })()
  ]);

  return { acpiSensors, gpuSensors };
}

async function getCachedTemperatureReadings() {
  if (temperatureCache.value && Date.now() < temperatureCache.expiresAt) return temperatureCache.value;
  if (temperatureCache.pending) return temperatureCache.pending;

  temperatureCache.pending = getTemperatureReadings().then((readings) => {
    temperatureCache.value = readings;
    temperatureCache.expiresAt = Date.now() + TEMPERATURE_CACHE_TTL_MS;
    return readings;
  }).finally(() => {
    temperatureCache.pending = null;
  });
  return temperatureCache.pending;
}

async function getSystemSnapshot() {
  const [cpuUsage, drives, temperatureReadings] = await Promise.all([
    getCpuUsage(),
    getCachedDrives().catch(() => []),
    getCachedTemperatureReadings()
  ]);
  const memoryTotalBytes = os.totalmem();
  const memoryFreeBytes = os.freemem();
  const memoryUsedBytes = memoryTotalBytes - memoryFreeBytes;
  const addresses = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  const networkConnected = addresses.some((address) =>
    !address.internal && (address.family === 'IPv4' || address.family === 4)
  );
  const systemDrive = process.platform === 'win32'
    ? String(process.env.SystemDrive || path.parse(process.execPath).root || 'C:').slice(0, 1).toUpperCase()
    : '';
  const primaryDrive = drives.find((drive) => drive.driveLetter === systemDrive) || drives[0] || null;

  return {
    hostname: os.hostname(),
    operatingSystem: `${os.type()} ${os.release()}`,
    cpuUsage,
    memoryTotalBytes,
    memoryUsedBytes,
    memoryPercent: memoryTotalBytes ? Math.round((memoryUsedBytes / memoryTotalBytes) * 100) : 0,
    networkConnected,
    temperatureReadings,
    uptimeSeconds: os.uptime(),
    drives,
    primaryDrive,
    version: app.getVersion()
  };
}

async function getTopProcesses() {
  if (process.platform !== 'win32') return { byCpu: [], byMemory: [] };

  const script = String.raw`
$cpuCount = [Math]::Max(1, [Environment]::ProcessorCount)
$first = @{}
Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  if ($null -ne $_.CPU) { $first[[int]$_.Id] = [double]$_.CPU }
}
Start-Sleep -Milliseconds 1000
$samples = Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  $cpuSeconds = 0.0
  if ($null -ne $_.CPU) { $cpuSeconds = [double]$_.CPU }
  $previous = $first[[int]$_.Id]
  $cpuPercent = 0.0
  if ($null -ne $previous) { $cpuPercent = [Math]::Max(0, (($cpuSeconds - $previous) * 100 / $cpuCount)) }
  [pscustomobject]@{
    processId = [int]$_.Id
    name = [string]$_.ProcessName
    cpuPercent = [Math]::Round($cpuPercent, 1)
    memoryBytes = [long]$_.WorkingSet64
  }
}
$result = [pscustomobject]@{
  byCpu = @($samples | Sort-Object cpuPercent -Descending | Select-Object -First 5)
  byMemory = @($samples | Sort-Object memoryBytes -Descending | Select-Object -First 5)
}
$result | ConvertTo-Json -Depth 3 -Compress
`;
  const { stdout } = await runPowerShell(script, 15000);
  const result = stdout.trim() ? JSON.parse(stdout) : {};
  const normalize = (items) => (Array.isArray(items) ? items : items ? [items] : []).map((item) => ({
    processId: Number(item.processId) || 0,
    name: String(item.name || 'Processo'),
    cpuPercent: Math.max(0, Number(item.cpuPercent) || 0),
    memoryBytes: Math.max(0, Number(item.memoryBytes) || 0),
    memoryPercent: os.totalmem() ? Math.round((Number(item.memoryBytes) || 0) / os.totalmem() * 100) : 0
  }));

  return {
    byCpu: normalize(result.byCpu),
    byMemory: normalize(result.byMemory)
  };
}

async function collectOldTempFiles() {
  const root = await fs.realpath(path.resolve(os.tmpdir()));
  const cutoff = Date.now() - CLEANUP_MIN_AGE_MS;
  const files = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (files.length >= CLEANUP_MAX_FILES) break;
    if (!entry.isFile()) continue;

    const entryPath = path.join(root, entry.name);
    try {
      const stats = await fs.lstat(entryPath);
      if (stats.isFile() && !stats.isSymbolicLink() && stats.mtimeMs < cutoff) {
        files.push({ path: entryPath, size: stats.size });
      }
    } catch {
      continue;
    }
  }

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

function registerIpcHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.senderFrame?.url !== trustedDocumentUrl) {
      throw new Error('Origem não autorizada para esta operação.');
    }
    return handler(event, ...args);
  });
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('checking-for-update', () => publishUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => {
  updateAvailableVersion = info.version;
  updateDownloaded = false;
  publishUpdateStatus('available', { version: info.version, currentVersion: app.getVersion() });
});
autoUpdater.on('update-not-available', () => {
  updateAvailableVersion = null;
  publishUpdateStatus('current', { version: app.getVersion() });
});
autoUpdater.on('download-progress', (progress) => publishUpdateStatus('downloading', {
  percent: Math.round(progress.percent),
  version: updateAvailableVersion
}));
autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  updateAvailableVersion = info.version;
  publishUpdateStatus('downloaded', { version: info.version });
});
autoUpdater.on('error', (error) => publishUpdateStatus('error', {
  message: error.message,
  version: updateAvailableVersion,
  canRetry: Boolean(updateAvailableVersion)
}));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    frame: false,
    backgroundColor: '#090a12',
    title: 'Nexo Device Care',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== trustedDocumentUrl) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const publishWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on('maximize', publishWindowState);
  mainWindow.on('unmaximize', publishWindowState);
  mainWindow.loadURL(trustedDocumentUrl);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

registerIpcHandler('window:minimize', () => {
  mainWindow?.minimize();
  return { ok: true };
});

registerIpcHandler('window:toggle-maximize', () => {
  if (!mainWindow) return { maximized: false };
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return { maximized: mainWindow.isMaximized() };
});

registerIpcHandler('window:close', () => {
  mainWindow?.close();
  return { ok: true };
});

registerIpcHandler('window:get-state', () => ({ maximized: mainWindow?.isMaximized() || false }));

registerIpcHandler('system:snapshot', getSystemSnapshot);

registerIpcHandler('system:top-processes', getTopProcesses);

registerIpcHandler('system:task-manager', async () => {
  if (process.platform !== 'win32') {
    throw new Error('O Gerenciador de Tarefas está disponível somente no Windows.');
  }

  await new Promise((resolve, reject) => {
    const taskManager = spawn('taskmgr.exe', [], { detached: true, stdio: 'ignore' });
    taskManager.once('spawn', () => {
      taskManager.unref();
      resolve();
    });
    taskManager.once('error', reject);
  });
  return { ok: true };
});

registerIpcHandler('drives:list', listDrives);

registerIpcHandler('drives:optimize', async (_event, driveLetter) => {
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

registerIpcHandler('cleanup:preview', async () => {
  const { files } = await collectOldTempFiles();
  return {
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    minAgeDays: CLEANUP_MIN_AGE_MS / (24 * 60 * 60 * 1000),
    maxFiles: CLEANUP_MAX_FILES
  };
});

registerIpcHandler('cleanup:run', async () => {
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

registerIpcHandler('system:repair', async () => {
  if (process.platform !== 'win32') {
    throw new Error('A verificação de arquivos do sistema está disponível somente no Windows.');
  }

  await runPowerShell("$process = Start-Process -FilePath 'sfc.exe' -ArgumentList '/scannow' -Verb RunAs -Wait -PassThru; exit $process.ExitCode", 60 * 60 * 1000);
  return { ok: true };
});

registerIpcHandler('updates:check', async () => {
  if (!app.isPackaged) return { state: 'development', version: app.getVersion() };

  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable) {
      updateAvailableVersion = result.updateInfo.version;
      return {
        state: 'available',
        version: updateAvailableVersion,
        currentVersion: app.getVersion()
      };
    }
    updateAvailableVersion = null;
    return {
      state: 'current',
      version: app.getVersion()
    };
  } catch (error) {
    return { state: 'error', message: error.message };
  }
});

registerIpcHandler('updates:download', async () => {
  if (!app.isPackaged) return { state: 'development', version: app.getVersion() };
  if (updateDownloaded) return { state: 'downloaded', version: updateAvailableVersion };
  if (!updateAvailableVersion) return { state: 'current', version: app.getVersion() };
  if (updateDownloadInProgress) return { state: 'downloading', version: updateAvailableVersion };

  updateDownloadInProgress = true;
  try {
    await autoUpdater.downloadUpdate();
    return {
      state: updateDownloaded ? 'downloaded' : 'downloading',
      version: updateAvailableVersion
    };
  } catch (error) {
    return {
      state: 'error',
      message: error.message,
      version: updateAvailableVersion,
      canRetry: true
    };
  } finally {
    updateDownloadInProgress = false;
  }
});

registerIpcHandler('updates:install', async () => {
  if (!updateDownloaded) throw new Error('Nenhuma atualização foi baixada ainda.');
  autoUpdater.quitAndInstall(true, true);
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
