const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile, spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const readline = require('readline');

const execFileAsync = promisify(execFile);
const CLEANUP_MAX_FILES = 5000;
const WALLPAPER_MAX_BYTES = 12 * 1024 * 1024;
const CLEANUP_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DRIVE_CACHE_TTL_MS = 30 * 1000;
const TEMPERATURE_CACHE_TTL_MS = 15 * 1000;
const trustedDocumentUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
let mainWindow;
let updateDownloaded = false;
let updateAvailableVersion = null;
let updateDownloadInProgress = false;
let updateCheckInProgress = false;
let updateReleaseInfo = null;
let updateProgress = null;
let driveCache = { expiresAt: 0, value: null, pending: null };
let temperatureCache = { expiresAt: 0, value: null, pending: null };
let sensorHost = null;
let sensorRequestPending = null;
let sensorHostStatus = 'starting';

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
  const usage = (1 - (after.idle - before.idle) / totalDelta) * 100;
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

function startSensorHost() {
  if (sensorHost) return sensorHost;
  if (process.platform !== 'win32') {
    sensorHostStatus = 'unsupported';
    return null;
  }

  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'sensor-host', 'Nexo.SensorHost.exe')
    : path.join(__dirname, 'sensor-host', 'publish', 'Nexo.SensorHost.exe');
  const spawnedHost = spawn(helperPath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  sensorHost = spawnedHost;
  sensorHostStatus = 'starting';
  const output = readline.createInterface({ input: spawnedHost.stdout });
  output.on('line', (line) => {
    if (sensorHost !== spawnedHost) return;
    if (!sensorRequestPending) return;
    try {
      sensorRequestPending.resolve(JSON.parse(line));
    } catch {
      sensorRequestPending.resolve({ status: 'error', devices: [], sensorCount: 0, issues: [{ device: 'Coletor', message: 'Resposta de sensor inválida.' }] });
    }
    clearTimeout(sensorRequestPending.timeout);
    sensorRequestPending = null;
  });
  spawnedHost.once('error', () => {
    if (sensorHost !== spawnedHost) return;
    sensorHostStatus = 'unavailable';
    sensorHost = null;
    if (sensorRequestPending) {
      clearTimeout(sensorRequestPending.timeout);
      sensorRequestPending.resolve({ status: 'unavailable', devices: [], sensorCount: 0, issues: [{ device: 'Coletor', message: 'O coletor de sensores não está instalado. Gere o app com o SDK .NET 10.' }] });
      sensorRequestPending = null;
    }
  });
  spawnedHost.once('exit', () => {
    if (sensorHost !== spawnedHost) return;
    sensorHostStatus = 'unavailable';
    sensorHost = null;
    if (sensorRequestPending) {
      clearTimeout(sensorRequestPending.timeout);
      sensorRequestPending.resolve({ status: 'unavailable', devices: [], sensorCount: 0, issues: [{ device: 'Coletor', message: 'O coletor de sensores foi encerrado.' }] });
      sensorRequestPending = null;
    }
  });
  return spawnedHost;
}

async function getHardwareSensors() {
  if (process.platform !== 'win32') {
    return { status: 'unsupported', collectedAt: new Date().toISOString(), devices: [], sensorCount: 0, issues: [] };
  }
  if (sensorRequestPending) return sensorRequestPending.promise;
  const host = startSensorHost();
  if (!host) return { status: sensorHostStatus, collectedAt: new Date().toISOString(), devices: [], sensorCount: 0, issues: [] };

  let resolvePending;
  const promise = new Promise((resolve) => { resolvePending = resolve; });
  const pending = { promise, resolve: resolvePending, timeout: null };
  sensorRequestPending = pending;
  pending.timeout = setTimeout(() => {
    if (sensorRequestPending !== pending) return;
    sensorRequestPending = null;
    sensorHost?.kill();
    sensorHost = null;
    pending.resolve({ status: 'timeout', collectedAt: new Date().toISOString(), devices: [], sensorCount: 0, issues: [{ device: 'Coletor', message: 'A leitura de sensores demorou demais e foi interrompida.' }] });
  }, 20000);
  host.stdin.write('{"command":"sample"}\n', (error) => {
    if (!error || sensorRequestPending !== pending) return;
    clearTimeout(pending.timeout);
    sensorRequestPending = null;
    pending.resolve({ status: 'unavailable', collectedAt: new Date().toISOString(), devices: [], sensorCount: 0, issues: [{ device: 'Coletor', message: 'Não foi possível iniciar a leitura detalhada.' }] });
  });
  return promise;
}

async function getSystemSnapshot() {
  const [cpuUsage, drives, temperatureReadings] = await Promise.all([
    getCpuUsage(),
    getCachedDrives().catch(() => []),
    getCachedTemperatureReadings()
  ]);
  const memoryTotalBytes = os.totalmem();
  const cpuInformation = os.cpus();
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
    cpuModel: cpuInformation[0]?.model || 'Processador',
    logicalCpuCount: cpuInformation.length,
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

const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const CLEANUP_CATEGORIES = [
  { id: 'temp', label: 'Temporários antigos', description: 'Arquivos com mais de 7 dias na pasta temporária do usuário (sem subpastas).', recursive: false, roots: () => [os.tmpdir()] },
  { id: 'crashdumps', label: 'Relatórios de falha de programas', description: 'Despejos de memória (.dmp) de programas que travaram, com mais de 7 dias.', recursive: true, roots: () => [path.join(LOCAL_APPDATA, 'CrashDumps')] },
  { id: 'wer', label: 'Relatórios de erro do Windows', description: 'Relatórios antigos, enviados ou pendentes, do Relatório de Erros do Windows.', recursive: true,
    roots: () => [path.join(LOCAL_APPDATA, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(LOCAL_APPDATA, 'Microsoft', 'Windows', 'WER', 'ReportQueue')] },
  { id: 'recycle', label: 'Lixeira', description: 'Esvazia a Lixeira de todas as unidades. Os arquivos não poderão ser recuperados.', special: true }
];

async function walkFiles(root, recursive, cutoff, limit, depth = 0, out = []) {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (out.length >= limit) break;
    const full = path.join(root, entry.name);
    try {
      const stats = await fs.lstat(full);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        if (recursive && depth < 4) await walkFiles(full, recursive, cutoff, limit, depth + 1, out);
        continue;
      }
      if (stats.isFile() && stats.mtimeMs < cutoff) out.push({ path: full, size: stats.size });
    } catch { continue; }
  }
  return out;
}

async function collectCategoryFiles(category) {
  const cutoff = Date.now() - CLEANUP_MIN_AGE_MS;
  const found = [];
  for (const candidate of category.roots()) {
    let root;
    try { root = await fs.realpath(path.resolve(candidate)); } catch { continue; }
    const files = await walkFiles(root, category.recursive, cutoff, CLEANUP_MAX_FILES - found.length);
    for (const file of files) found.push({ ...file, root });
    if (found.length >= CLEANUP_MAX_FILES) break;
  }
  return found;
}

async function collectOldTempFiles() {
  const files = await collectCategoryFiles(CLEANUP_CATEGORIES[0]);
  return { root: files[0]?.root || os.tmpdir(), files };
}

async function pruneEmptyDirectories(root, depth = 0) {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || depth >= 4) continue;
    const full = path.join(root, entry.name);
    await pruneEmptyDirectories(full, depth + 1);
    try { await fs.rmdir(full); } catch { /* não está vazia ou está em uso */ }
  }
}

async function scanRecycleBin() {
  if (process.platform !== 'win32') return { fileCount: 0, bytes: 0 };
  try {
    const { stdout } = await runPowerShell(String.raw`$ErrorActionPreference='SilentlyContinue'; $items=@((New-Object -ComObject Shell.Application).Namespace(0xA).Items()); $b=[int64]0; foreach($i in $items){ $b += [int64]$i.Size }; '{0};{1}' -f $items.Count, $b`, 12000);
    const [count, bytes] = stdout.trim().split(';').map(Number);
    return { fileCount: Number.isFinite(count) ? count : 0, bytes: Number.isFinite(bytes) ? bytes : 0 };
  } catch { return { fileCount: 0, bytes: 0 }; }
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
autoUpdater.on('checking-for-update', () => publishUpdateStatus('checking', { currentVersion: app.getVersion() }));
autoUpdater.on('update-available', (info) => {
  updateAvailableVersion = info.version;
  updateReleaseInfo = info;
  updateDownloaded = false;
  updateProgress = null;
  publishUpdateStatus('available', {
    version: info.version,
    currentVersion: app.getVersion(),
    releaseName: info.releaseName,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes
  });
});
autoUpdater.on('update-not-available', () => {
  updateAvailableVersion = null;
  updateReleaseInfo = null;
  updateProgress = null;
  publishUpdateStatus('current', { version: app.getVersion(), currentVersion: app.getVersion() });
});
autoUpdater.on('download-progress', (progress) => {
  updateProgress = {
    percent: Math.round(progress.percent),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond
  };
  publishUpdateStatus('downloading', {
    ...updateProgress,
    version: updateAvailableVersion
  });
});
autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  updateAvailableVersion = info.version;
  updateReleaseInfo = info;
  updateProgress = { percent: 100, transferred: null, total: null, bytesPerSecond: 0 };
  publishUpdateStatus('downloaded', {
    version: info.version,
    currentVersion: app.getVersion(),
    releaseName: info.releaseName,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes
  });
});
autoUpdater.on('update-cancelled', () => {
  updateDownloadInProgress = false;
  publishUpdateStatus('available', {
    version: updateAvailableVersion,
    releaseName: updateReleaseInfo?.releaseName,
    releaseDate: updateReleaseInfo?.releaseDate,
    releaseNotes: updateReleaseInfo?.releaseNotes
  });
});
autoUpdater.on('error', (error) => publishUpdateStatus('error', {
  message: error.message,
  version: updateAvailableVersion,
  releaseName: updateReleaseInfo?.releaseName,
  releaseDate: updateReleaseInfo?.releaseDate,
  releaseNotes: updateReleaseInfo?.releaseNotes,
  percent: updateProgress?.percent || 0,
  transferred: updateProgress?.transferred,
  total: updateProgress?.total,
  bytesPerSecond: updateProgress?.bytesPerSecond || 0,
  canRetry: Boolean(updateAvailableVersion)
}));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    show: false,
    backgroundColor: '#060919',
    title: 'Nexo Device Care',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
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

registerIpcHandler('sensors:snapshot', getHardwareSensors);

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

registerIpcHandler('cleanup:scan', async () => {
  const categories = [];
  for (const category of CLEANUP_CATEGORIES) {
    const base = { id: category.id, label: category.label, description: category.description, destructive: Boolean(category.special) };
    if (category.special) {
      categories.push({ ...base, ...(await scanRecycleBin()) });
      continue;
    }
    const files = await collectCategoryFiles(category);
    categories.push({ ...base, fileCount: files.length, bytes: files.reduce((total, file) => total + file.size, 0) });
  }
  return { categories, minAgeDays: CLEANUP_MIN_AGE_MS / (24 * 60 * 60 * 1000), maxFiles: CLEANUP_MAX_FILES };
});

// Usado pela limpeza automática: somente a categoria "temp", como descrito no consentimento.
registerIpcHandler('cleanup:preview', async () => {
  const { files } = await collectOldTempFiles();
  return {
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    minAgeDays: CLEANUP_MIN_AGE_MS / (24 * 60 * 60 * 1000),
    maxFiles: CLEANUP_MAX_FILES
  };
});

registerIpcHandler('cleanup:run', async (_event, ids) => {
  const known = new Map(CLEANUP_CATEGORIES.map((category) => [category.id, category]));
  const selected = [...new Set(Array.isArray(ids) && ids.length ? ids : ['temp'])].filter((id) => known.has(id));
  const results = [];
  for (const id of selected) {
    const category = known.get(id);
    let removedCount = 0;
    let bytesFreed = 0;
    if (category.special) {
      const before = await scanRecycleBin();
      if (process.platform === 'win32') {
        try { await runPowerShell("Clear-RecycleBin -Force -ErrorAction SilentlyContinue", 60000); } catch { /* o Windows pode recusar itens em uso */ }
      }
      const after = await scanRecycleBin();
      removedCount = Math.max(0, before.fileCount - after.fileCount);
      bytesFreed = Math.max(0, before.bytes - after.bytes);
    } else {
      const files = await collectCategoryFiles(category);
      for (const file of files) {
        if (!isInsideDirectory(file.root, file.path)) continue;
        try {
          const stats = await fs.lstat(file.path);
          if (!stats.isFile() || stats.isSymbolicLink() || stats.mtimeMs >= Date.now() - CLEANUP_MIN_AGE_MS) continue;
          await fs.unlink(file.path);
          removedCount += 1;
          bytesFreed += stats.size;
        } catch { continue; }
      }
      if (category.recursive) {
        for (const root of new Set(files.map((file) => file.root))) await pruneEmptyDirectories(root);
      }
    }
    results.push({ id, removedCount, bytesFreed });
  }
  return {
    results,
    removedCount: results.reduce((total, item) => total + item.removedCount, 0),
    bytesFreed: results.reduce((total, item) => total + item.bytesFreed, 0)
  };
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
  if (updateDownloaded) return { state: 'downloaded', version: updateAvailableVersion, currentVersion: app.getVersion() };
  if (updateDownloadInProgress) return { state: 'downloading', version: updateAvailableVersion, ...updateProgress };
  if (updateCheckInProgress) return { state: 'checking', currentVersion: app.getVersion() };

  updateCheckInProgress = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable) {
      updateAvailableVersion = result.updateInfo.version;
      updateReleaseInfo = result.updateInfo;
      return {
        state: 'available',
        version: updateAvailableVersion,
        currentVersion: app.getVersion(),
        releaseName: result.updateInfo.releaseName,
        releaseDate: result.updateInfo.releaseDate,
        releaseNotes: result.updateInfo.releaseNotes
      };
    }
    if (updateDownloaded) return { state: 'downloaded', version: updateAvailableVersion, currentVersion: app.getVersion() };
    updateAvailableVersion = null;
    updateReleaseInfo = null;
    return {
      state: 'current',
      version: app.getVersion(),
      currentVersion: app.getVersion(),
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return { state: 'error', message: error.message };
  } finally {
    updateCheckInProgress = false;
  }
});

registerIpcHandler('updates:download', async () => {
  if (!app.isPackaged) return { state: 'development', version: app.getVersion() };
  if (updateDownloaded) return { state: 'downloaded', version: updateAvailableVersion };
  if (updateCheckInProgress) return { state: 'checking', currentVersion: app.getVersion() };
  if (!updateAvailableVersion) return { state: 'current', version: app.getVersion() };
  if (updateDownloadInProgress) return { state: 'downloading', version: updateAvailableVersion, ...updateProgress };

  updateDownloadInProgress = true;
  updateProgress = { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 };
  publishUpdateStatus('downloading', { version: updateAvailableVersion, ...updateProgress });
  try {
    await autoUpdater.downloadUpdate();
    return {
      state: updateDownloaded ? 'downloaded' : 'downloading',
      version: updateAvailableVersion,
      ...updateProgress
    };
  } catch (error) {
    return {
      state: 'error',
      message: error.message,
      version: updateAvailableVersion,
      releaseName: updateReleaseInfo?.releaseName,
      releaseDate: updateReleaseInfo?.releaseDate,
      releaseNotes: updateReleaseInfo?.releaseNotes,
      percent: updateProgress?.percent || 0,
      transferred: updateProgress?.transferred,
      total: updateProgress?.total,
      bytesPerSecond: updateProgress?.bytesPerSecond || 0,
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

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTF8_PS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'; ";

async function listPowerPlans() {
  if (process.platform !== 'win32') return [];
  const script = UTF8_PS + String.raw`$p=@(Get-CimInstance -Namespace root\cimv2\power -ClassName Win32_PowerPlan | ForEach-Object { [pscustomobject]@{ guid = ([string]$_.InstanceID -replace '.*\{|\}.*',''); name = [string]$_.ElementName; active = [bool]$_.IsActive } }); ConvertTo-Json -InputObject $p -Compress`;
  const { stdout } = await runPowerShell(script, 10000);
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((plan) => GUID_PATTERN.test(plan.guid))
    .map((plan) => ({ guid: plan.guid.toLowerCase(), name: String(plan.name || 'Plano'), active: Boolean(plan.active) }));
}

registerIpcHandler('power:list', listPowerPlans);

registerIpcHandler('power:set', async (_event, guid) => {
  const plans = await listPowerPlans();
  const target = plans.find((plan) => plan.guid === String(guid || '').toLowerCase());
  if (!target) throw new Error('Plano de energia não reconhecido.');
  await execFileAsync('powercfg', ['/setactive', target.guid], { windowsHide: true, timeout: 10000 });
  return { ok: true, plans: await listPowerPlans() };
});

registerIpcHandler('startup:list', async () => {
  if (process.platform !== 'win32') return [];
  const script = UTF8_PS + String.raw`$s=@(Get-CimInstance Win32_StartupCommand | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; command = [string]$_.Command; location = [string]$_.Location; user = [string]$_.User } }); ConvertTo-Json -InputObject $s -Compress`;
  const { stdout } = await runPowerShell(script, 12000);
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
    name: String(item.name || 'Programa').slice(0, 80),
    command: String(item.command || '').slice(0, 220),
    location: String(item.location || '').slice(0, 120),
    user: String(item.user || '').slice(0, 60)
  }));
});

const SETTINGS_PAGES = { startup: 'ms-settings:startupapps', power: 'ms-settings:powersleep', storage: 'ms-settings:storagesense' };
registerIpcHandler('system:open-settings', async (_event, page) => {
  const uri = SETTINGS_PAGES[page];
  if (!uri) throw new Error('Página de configurações não permitida.');
  await shell.openExternal(uri);
  return { ok: true };
});

const EXTERNAL_LINKS = {
  repo: 'https://github.com/Samuklvm/Project-Nexo',
  privacy: 'https://github.com/Samuklvm/Project-Nexo/blob/main/PRIVACIDADE.md',
  creator: 'https://github.com/Samuklvm',
  issues: 'https://github.com/Samuklvm/Project-Nexo/issues',
  releases: 'https://github.com/Samuklvm/Project-Nexo/releases'
};
registerIpcHandler('app:open-link', async (_event, key) => {
  const url = EXTERNAL_LINKS[key];
  if (!url) throw new Error('Link não permitido.');
  await shell.openExternal(url);
  return { ok: true };
});

async function directorySize(directory) {
  let total = 0;
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else if (entry.isFile()) { try { total += (await fs.stat(full)).size; } catch { /* ignorado */ } }
  }
  return total;
}

registerIpcHandler('app:info', async () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  platform: process.platform,
  userDataPath: app.getPath('userData'),
  userDataBytes: await directorySize(app.getPath('userData'))
}));

// ---- Wallpaper personalizado: arquivo em userData em vez de base64 no localStorage ----
const WALLPAPER_EXTENSIONS = ['webp', 'png', 'jpg'];
const wallpaperFile = (extension) => path.join(app.getPath('userData'), `wallpaper.${extension}`);

function detectImageExtension(bytes) {
  if (bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function currentWallpaperUrl() {
  for (const extension of WALLPAPER_EXTENSIONS) {
    try {
      const stats = await fs.stat(wallpaperFile(extension));
      return `${pathToFileURL(wallpaperFile(extension)).href}?v=${Math.round(stats.mtimeMs)}`;
    } catch { /* tenta a próxima extensão */ }
  }
  return null;
}

registerIpcHandler('wallpaper:get', async () => ({ url: await currentWallpaperUrl() }));

registerIpcHandler('wallpaper:set', async (_event, data) => {
  const bytes = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  if (!bytes.length || bytes.length > WALLPAPER_MAX_BYTES) throw new Error('Escolha uma imagem de até 12 MB.');
  const extension = detectImageExtension(bytes);
  if (!extension) throw new Error('Use uma imagem PNG, JPEG ou WebP.');
  for (const other of WALLPAPER_EXTENSIONS) await fs.rm(wallpaperFile(other), { force: true });
  await fs.writeFile(wallpaperFile(extension), bytes);
  return { url: await currentWallpaperUrl() };
});

registerIpcHandler('wallpaper:reset', async () => {
  for (const extension of WALLPAPER_EXTENSIONS) await fs.rm(wallpaperFile(extension), { force: true });
  return { url: null };
});

// ---- Preferência de compartilhamento opcional (Registro do Windows, como no instalador) ----
const PRIVACY_KEY = 'HKCU\\Software\\NexoDeviceCare\\Privacy';
registerIpcHandler('privacy:get', async () => {
  if (process.platform !== 'win32') return { shareWithCreator: false };
  try {
    const { stdout } = await execFileAsync('reg', ['query', PRIVACY_KEY, '/v', 'DeveloperTelemetryOptIn'], { windowsHide: true, timeout: 5000 });
    return { shareWithCreator: /0x1\b/i.test(stdout) };
  } catch { return { shareWithCreator: false }; }
});
registerIpcHandler('privacy:set', async (_event, enabled) => {
  if (process.platform !== 'win32') return { shareWithCreator: false };
  await execFileAsync('reg', ['add', PRIVACY_KEY, '/v', 'DeveloperTelemetryOptIn', '/t', 'REG_DWORD', '/d', enabled ? '1' : '0', '/f'], { windowsHide: true, timeout: 5000 });
  return { shareWithCreator: Boolean(enabled) };
});

// ---- Desinstalação completa ----
// A lista de alvos abaixo precisa ficar alinhada com `customUnInstall` em installer/installer.nsh.
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function buildRemovalScript({ installDir, uninstaller, pid }) {
  return String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Wait-Process -Id ${pid} -Timeout 60
Start-Sleep -Milliseconds 800
Get-Process -Name 'Nexo.SensorHost' | Stop-Process -Force
$dir = ${psQuote(installDir)}
$un = ${psQuote(uninstaller)}
$env:NEXO_PURGE = '1'
Remove-Item -LiteralPath 'Env:\NEXO_KEEP' -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $un) { Start-Process -FilePath $un -ArgumentList '/S', ('_?=' + $dir) -Wait }
Remove-Item -LiteralPath $un -Force
if ($dir.Length -gt 15) { Remove-Item -LiteralPath $dir -Recurse -Force }

$roaming = $env:APPDATA; $local = $env:LOCALAPPDATA
$targets = @(
  (Join-Path $roaming 'nexo-device-care'), (Join-Path $roaming 'Nexo Device Care'),
  (Join-Path $local 'nexo-device-care'), (Join-Path $local 'nexo-device-care-updater'),
  (Join-Path $roaming 'Microsoft\Windows\Start Menu\Programs\Nexo Device Care'),
  (Join-Path $roaming 'Microsoft\Windows\Start Menu\Programs\Nexo Device Care.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nexo Device Care.lnk')
)
foreach ($t in $targets) { Remove-Item -LiteralPath $t -Recurse -Force }
Get-ChildItem -LiteralPath (Join-Path $roaming 'Microsoft\Windows\Recent') -Filter 'Nexo*' | Remove-Item -Force
Remove-Item -LiteralPath 'HKCU:\Software\NexoDeviceCare' -Recurse -Force

# Caches do próprio Windows que guardam o caminho do programa
$caches = @(
  'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache',
  'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store',
  'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers'
)
foreach ($k in $caches) {
  $item = Get-Item -LiteralPath $k
  if ($item) { foreach ($n in $item.GetValueNames()) { if ($n.StartsWith($dir, 'OrdinalIgnoreCase')) { Remove-ItemProperty -LiteralPath $k -Name $n -Force } } }
}
foreach ($guid in (Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist')) {
  $count = Join-Path $guid.PSPath 'Count'
  $key = Get-Item -LiteralPath $count
  if ($key) {
    foreach ($n in $key.GetValueNames()) {
      $decoded = -join ($n.ToCharArray() | ForEach-Object { if ($_ -cmatch '[a-z]') { [char]((([int][char]$_ - 97 + 13) % 26) + 97) } elseif ($_ -cmatch '[A-Z]') { [char]((([int][char]$_ - 65 + 13) % 26) + 65) } else { $_ } })
      if ($decoded -like '*Nexo Device Care*') { Remove-ItemProperty -LiteralPath $count -Name $n -Force }
    }
  }
}

$left = @()
foreach ($t in (@($dir) + $targets + @('HKCU:\Software\NexoDeviceCare'))) { if (Test-Path -LiteralPath $t) { $left += $t } }
Add-Type -AssemblyName PresentationFramework
if ($left.Count -eq 0) {
  [void][System.Windows.MessageBox]::Show('O Nexo Device Care foi removido por completo: programa, dados, atalhos e entradas do Registro.', 'Nexo Device Care')
} else {
  [void][System.Windows.MessageBox]::Show(('O Nexo foi removido, mas estes itens não puderam ser apagados:' + [Environment]::NewLine + ($left -join [Environment]::NewLine)), 'Nexo Device Care')
}
`;
}

registerIpcHandler('app:uninstall', async () => {
  if (process.platform !== 'win32' || !app.isPackaged) {
    throw new Error('A desinstalação completa só está disponível na versão instalada do Nexo.');
  }
  const installDir = path.dirname(process.execPath);
  const names = await fs.readdir(installDir);
  const uninstallerName = names.find((name) => /^Uninstall .*\.exe$/i.test(name));
  if (!uninstallerName) throw new Error('Não encontrei o desinstalador desta instalação.');
  const script = buildRemovalScript({ installDir, uninstaller: path.join(installDir, uninstallerName), pid: process.pid });
  const helper = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
    detached: true, stdio: 'ignore', windowsHide: true
  });
  helper.unref();
  setTimeout(() => app.quit(), 400);
  return { ok: true };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.samuklvm.nexo');
    Menu.setApplicationMenu(null);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  sensorHost?.kill();
});
