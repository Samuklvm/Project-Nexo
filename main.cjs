const { app, BrowserWindow, ipcMain, shell, Menu, powerMonitor, dialog, Tray, Notification, nativeImage, net, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile, spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const readline = require('readline');
const { Worker } = require('worker_threads');
const { createProbe } = require('./electron/probe.cjs');
const { createFpsRunner } = require('./electron/fps-runner.cjs');
const { createElevator, toolLauncher, PAWNIO } = require('./electron/elevate.cjs');
const { decodeConsole } = require('./electron/console-text.cjs');
const { createSensorService } = require('./electron/sensor-service.cjs');
const { createLabSystem, parseList: parseLabPlanList } = require('./electron/lab-system.cjs');
const LabParsers = { parseList: parseLabPlanList };
const { createLibrary } = require('./electron/games.cjs');
const { createWatcher } = require('./electron/watcher.cjs');
const Account = require('./electron/account.cjs');
const NexoLab = require('./src/lab.js');
const Steam = require('./electron/steam-account.cjs');
const Covers = require('./electron/covers.cjs');
const { createCoverResolver } = Covers;
const { createSteamDetails } = require('./electron/steam-details.cjs');
const Xbox = require('./electron/xbox.cjs');
const DiscordRpc = require('./electron/discord.cjs');
const { createDiscord } = DiscordRpc;
const nodeNet = require('net');
const http = require('http');
const { createLinux } = require('./electron/linux.cjs');
const { createLinuxLabSystem } = require('./electron/lab-linux.cjs');
const { createMangoRunner, launchOption: mangoLaunchOption } = require('./electron/mangohud.cjs');
const { createLinuxProbe } = require('./electron/probe.cjs');
const { createLinuxWatcher } = require('./electron/watcher.cjs');
const { linuxPrivileged } = require('./electron/elevate.cjs');
const IS_LINUX = process.platform === 'linux';

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

/** Saída do PowerShell em UTF-8: sem isso, nomes com acento (rótulos de disco, programas, planos) chegam quebrados. */
const PS_UTF8_OUTPUT = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ';
function runPowerShell(script, timeout = 15000) {
  if (process.platform !== 'win32') {
    throw new Error('Esta operação está disponível somente no Windows.');
  }

  return execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    PS_UTF8_OUTPUT + script
  ], {
    windowsHide: true,
    timeout,
    maxBuffer: 2 * 1024 * 1024
  });
}

/** Igual ao runPowerShell, mas nunca lança: devolve { code, stdout } (o laboratório decide o que fazer com o código). */
function runPowerShellCode(script, timeout = 15000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ code: -1, stdout: '' }); return; }
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS_UTF8_OUTPUT + script], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}
function runCode(file, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}

const linux = createLinux({ fs, path, os, run: (file, args) => runCode(file, args) });

function getCpuSample() {
  return os.cpus().reduce((sample, cpu) => {
    sample.total += Object.values(cpu.times).reduce((total, value) => total + value, 0);
    sample.idle += cpu.times.idle;
    return sample;
  }, { total: 0, idle: 0 });
}

// Leitura contínua: compara com a amostra anterior em vez de esperar 250 ms a cada chamada. Assim o painel pode ler
// a cada segundo sem custo extra (só a primeira chamada, ou uma depois de muito tempo parado, espera um pouco).
let lastCpuSample = null;
async function getCpuUsage() {
  const reusable = lastCpuSample && Date.now() - lastCpuSample.at >= 400 && Date.now() - lastCpuSample.at < 10000;
  const before = reusable ? lastCpuSample : { ...getCpuSample(), at: Date.now() };
  if (!reusable) await new Promise((resolve) => setTimeout(resolve, 250));
  const after = { ...getCpuSample(), at: Date.now() };
  lastCpuSample = after;
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
  if (IS_LINUX) return linux.drives();
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
  if (process.platform !== 'win32' && !IS_LINUX) return { acpiSensors: [], gpuSensors: [] };

  const [acpiSensors, gpuSensors] = await Promise.all([
    (async () => {
      if (IS_LINUX) return linux.temperatures();
      const script = String.raw`
$sensors = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object {
  $celsius = [Math]::Round(([double]$_.CurrentTemperature / 10) - 273.15, 1)
  if ($celsius -gt 5 -and $celsius -le 125) {  # 0 °C (2732 décimos de kelvin) = zona sem sensor de verdade
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
      sensorRequestPending.resolve({ status: 'unavailable', devices: [], sensorCount: 0, issues: [{ device: 'Coletor', message: 'O coletor de sensores não foi encontrado nesta instalação. Reinstale o Nexo pela última versão no GitHub.' }] });
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
  if (IS_LINUX) {
    const [readings, temps] = await Promise.all([linux.sensors(), getCachedTemperatureReadings().catch(() => ({ gpuSensors: [] }))]);
    temps.gpuSensors.forEach((gpu, index) => {
      const sensors = [];
      if (Number.isFinite(gpu.temperatureCelsius)) sensors.push({ name: 'GPU Core', type: 'Temperature', value: gpu.temperatureCelsius, min: gpu.temperatureCelsius, max: gpu.temperatureCelsius, unit: '°C', advanced: false });
      if (Number.isFinite(gpu.usagePercent)) sensors.push({ name: 'GPU Core', type: 'Load', value: gpu.usagePercent, min: gpu.usagePercent, max: gpu.usagePercent, unit: '%', advanced: false });
      if (sensors.length) readings.devices.push({ name: `NVIDIA GPU ${index + 1}`, type: 'GpuNvidia', path: `/nvidia/${index}`, sensors });
    });
    readings.sensorCount = readings.devices.reduce((sum, device) => sum + device.sensors.length, 0);
    if (readings.sensorCount) { readings.status = 'ready'; readings.issues = []; }
    return readings;
  }
  if (process.platform !== 'win32') {
    return { status: 'unsupported', collectedAt: new Date().toISOString(), devices: [], sensorCount: 0, issues: [] };
  }
  // Primeiro o serviço (com o driver PawnIO, lê a temperatura do processador); se não houver, o coletor comum.
  if (sensorService && (serviceReadable || Date.now() - serviceCheckedAt > 60000)) {
    const fromService = await sensorService.read();
    serviceCheckedAt = Date.now();
    if (fromService && typeof fromService.status === 'string') {
      serviceReadable = true;
      if (sensorHost) { sensorHost.kill(); sensorHost = null; }
      return fromService;
    }
    serviceReadable = false;
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
  if (IS_LINUX) return linux.topProcesses();
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
const CLEANUP_CATEGORIES = IS_LINUX ? linux.cleanupCategories() : [
  { id: 'temp', label: 'Temporários antigos', description: 'Arquivos com mais de 7 dias na pasta temporária do usuário (sem subpastas).', recursive: false, roots: () => [os.tmpdir()] },
  { id: 'crashdumps', label: 'Relatórios de falha de programas', description: 'Despejos de memória (.dmp) de programas que travaram, com mais de 7 dias.', recursive: true, roots: () => [path.join(LOCAL_APPDATA, 'CrashDumps')] },
  { id: 'wer', label: 'Relatórios de erro do Windows', description: 'Relatórios antigos, enviados ou pendentes, do Relatório de Erros do Windows.', recursive: true,
    roots: () => [path.join(LOCAL_APPDATA, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(LOCAL_APPDATA, 'Microsoft', 'Windows', 'WER', 'ReportQueue')] },
  { id: 'recycle', label: 'Lixeira', description: 'Esvazia a sua Lixeira, em todas as unidades. Os arquivos não poderão ser recuperados.', special: true }
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
    for (const file of files) {
      // Linux: pastas como /tmp e /var/crash são compartilhadas; só entram arquivos do próprio usuário.
      if (IS_LINUX && typeof process.getuid === 'function') { const stats = await fs.lstat(file.path).catch(() => null); if (!stats || stats.uid !== process.getuid()) continue; }
      found.push({ ...file, root });
    }
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
  if (IS_LINUX) return linux.scanTrash();
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

/** Notas da versão em todo estado da atualização (baixando, erro…): sem isso a tela mostrava "sem notas" no meio do download. */
const releaseFields = () => ({ releaseName: updateReleaseInfo?.releaseName, releaseDate: updateReleaseInfo?.releaseDate, releaseNotes: updateReleaseInfo?.releaseNotes });
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
    ...releaseFields(),
    version: updateAvailableVersion
  });
});
autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  updateAvailableVersion = info.version;
  // O evento de download costuma vir sem as notas: mantém as que chegaram em "update-available".
  updateReleaseInfo = { ...info, releaseNotes: info.releaseNotes || updateReleaseInfo?.releaseNotes || null, releaseName: info.releaseName || updateReleaseInfo?.releaseName, releaseDate: info.releaseDate || updateReleaseInfo?.releaseDate };
  info = updateReleaseInfo;
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
      sandbox: true,
      // Sessões e laboratório medem a 1 Hz mesmo com um jogo em tela cheia por cima da janela.
      backgroundThrottling: false
    }
  });

  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow?.show(); });
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
  if (settings.tray && tray) { mainWindow?.hide(); notifyOnce('tray', 'O Nexo continua na bandeja', 'Ele segue observando seus jogos. Clique no ícone perto do relógio para abrir ou sair.'); }
  else mainWindow?.close();
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
  if (IS_LINUX) {
    const drive = (await linux.drives()).find((item) => item.driveLetter === driveLetter);
    if (!drive) throw new Error('Unidade inválida.');
    const [file, args] = linuxPrivileged('fstrim', drive.driveLetter);
    const result = await runCode(file, args, 60 * 60 * 1000);
    if (result.code === 126 || result.code === 127) throw new Error('A senha de administrador foi recusada (ou o pkexec não está instalado).');
    if (result.code !== 0) throw new Error('O sistema não aceitou o TRIM nesta unidade (HD comum ou sistema de arquivos sem suporte).');
    return { ok: true, driveLetter: drive.driveLetter, detail: result.stdout.trim().slice(0, 200) };
  }
  if (process.platform !== 'win32') {
    throw new Error('A otimização de unidades está disponível somente no Windows.');
  }
  if (typeof driveLetter !== 'string' || !/^[A-Z]$/i.test(driveLetter)) {
    throw new Error('Unidade inválida.');
  }

  const letter = driveLetter.toUpperCase();
  // runPowerShell lançaria "Command failed: powershell.exe …" (o script inteiro) como mensagem para a pessoa.
  const result = await runPowerShellCode(toolLauncher('defrag', letter), 60 * 60 * 1000);
  if (result.code === 1223) throw new Error('Você recusou a permissão do Windows; nada foi feito.');
  if (result.code !== 0) throw new Error(`O Windows não concluiu a otimização de ${letter}: (código ${result.code}). A unidade pode não aceitar otimização.`);
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
      if (IS_LINUX) await linux.emptyTrash();
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
    throw new Error('O SFC é do Windows. No Linux, a verificação do sistema de arquivos é feita pelo próprio sistema na inicialização (fsck).');
  }

  const result = await runPowerShellCode(toolLauncher('sfc'), 60 * 60 * 1000);
  if (result.code === 1223) throw new Error('Você recusou a permissão do Windows; nada foi feito.');
  // O SFC devolve código diferente de 0 quando encontra (e às vezes corrige) problemas: não é falha do Nexo.
  return { ok: true, code: result.code };
});

const downloadedStatus = () => ({ state: 'downloaded', version: updateAvailableVersion, currentVersion: app.getVersion(), releaseName: updateReleaseInfo?.releaseName, releaseDate: updateReleaseInfo?.releaseDate, releaseNotes: updateReleaseInfo?.releaseNotes });
registerIpcHandler('updates:check', async () => {
  if (!app.isPackaged) return { state: 'development', version: app.getVersion() };
  if (updateDownloaded) return downloadedStatus();
  if (updateDownloadInProgress) return { state: 'downloading', version: updateAvailableVersion, ...releaseFields(), ...updateProgress };
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
    if (updateDownloaded) return downloadedStatus();
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
  if (updateDownloaded) return downloadedStatus();
  if (updateCheckInProgress) return { state: 'checking', currentVersion: app.getVersion() };
  if (!updateAvailableVersion) return { state: 'current', version: app.getVersion() };
  if (updateDownloadInProgress) return { state: 'downloading', version: updateAvailableVersion, ...releaseFields(), ...updateProgress };

  updateDownloadInProgress = true;
  updateProgress = { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 };
  publishUpdateStatus('downloading', { version: updateAvailableVersion, ...releaseFields(), ...updateProgress });
  try {
    await autoUpdater.downloadUpdate();
    // O evento "update-downloaded" já publicou o estado com as notas; a resposta precisa ser igual, senão sobrescreve a tela sem elas.
    return updateDownloaded ? downloadedStatus() : { state: 'downloading', version: updateAvailableVersion, ...releaseFields(), ...updateProgress };
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

/** Nomes dos planos padrão do Windows (a saída do powercfg vem na página de código do console e estraga acentos). */
const KNOWN_PLANS = { '381b4222-f694-41f0-9685-ff5bb260df2e': 'Equilibrado', '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': 'Alto desempenho', 'a1841308-3541-4fab-bc81-f71556f20b4a': 'Economia de energia', 'e9a42b02-d5df-448d-aa00-03f14749eb61': 'Desempenho máximo' };
async function listPowerPlans() {
  if (process.platform !== 'win32') return [];
  let plans = [];
  try {
    const script = UTF8_PS + String.raw`$p=@(Get-CimInstance -Namespace root\cimv2\power -ClassName Win32_PowerPlan | ForEach-Object { [pscustomobject]@{ guid = ([string]$_.InstanceID -replace '.*\{|\}.*',''); name = [string]$_.ElementName; active = [bool]$_.IsActive } }); ConvertTo-Json -InputObject $p -Compress`;
    const { stdout } = await runPowerShell(script, 10000);
    if (stdout.trim()) {
      const parsed = JSON.parse(stdout);
      plans = (Array.isArray(parsed) ? parsed : [parsed]).filter((plan) => GUID_PATTERN.test(plan?.guid || ''))
        .map((plan) => ({ guid: plan.guid.toLowerCase(), name: String(plan.name || 'Plano'), active: Boolean(plan.active) }));
    }
  } catch { /* em alguns PCs o CIM de energia não responde; o powercfg abaixo resolve */ }
  if (plans.length) return plans;
  // Alternativa: o próprio powercfg (lista independente do idioma; nomes conhecidos traduzidos pelo GUID).
  // Bytes crus: a saída vem na página de código do console (CP850), e lida como UTF-8 estragava os acentos ("M�ximo").
  const { stdout } = await execFileAsync('powercfg', ['/list'], { windowsHide: true, timeout: 10000, encoding: 'buffer' }).catch(() => ({ stdout: Buffer.alloc(0) }));
  return LabParsers.parseList(decodeConsole(stdout)).filter((plan) => GUID_PATTERN.test(plan.guid)).map((plan) => ({ ...plan, name: KNOWN_PLANS[plan.guid] || plan.name }));
}

registerIpcHandler('power:list', async () => (IS_LINUX ? linux.powerProfiles() : listPowerPlans()));

registerIpcHandler('power:set', async (_event, guid) => {
  if (labState.running) throw new Error('O laboratório está usando o plano de energia agora; espere ele terminar.');
  if (IS_LINUX) { await linux.setPowerProfile(String(guid)); return { ok: true, plans: await linux.powerProfiles() }; }
  const plans = await listPowerPlans();
  const target = plans.find((plan) => plan.guid === String(guid || '').toLowerCase());
  if (!target) throw new Error('Plano de energia não reconhecido.');
  await execFileAsync('powercfg', ['/setactive', target.guid], { windowsHide: true, timeout: 10000 });
  return { ok: true, plans: await listPowerPlans() };
});

registerIpcHandler('startup:list', async () => {
  if (IS_LINUX) return linux.startupItems();
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

// ---- Benchmark curto de CPU (experimento A/B do plano de energia) ----
// Carga determinística de inteiros; mede iterações por segundo em cada worker. Sempre iniciado pelo usuário.
const BENCH_WORKER = String.raw`
const { parentPort, workerData } = require('worker_threads');
let x = 0x9e3779b9 | 0;
let iterations = 0;
const started = performance.now();
const end = started + workerData.ms;
while (performance.now() < end) {
  for (let i = 0; i < 100000; i += 1) {
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x ^= x >>> 12;
    x = Math.imul(x, 0x297a2d39);
    x ^= x >>> 15;
  }
  iterations += 100000;
}
parentPort.postMessage({ iterations, seconds: (performance.now() - started) / 1000, checksum: x >>> 0 });
`;
// Rajadas: 30 ms de trabalho depois de 70 ms parado, repetido. Mede o quão rápido o processador "acorda" e acelera,
// que é o que planos e políticas de energia mais mudam (resposta a cliques, carregamentos curtos, quadros irregulares).
const BURST_WORKER = String.raw`
const { parentPort, workerData } = require('worker_threads');
const pause = new Int32Array(new SharedArrayBuffer(4));
let x = 0x9e3779b9 | 0;
let iterations = 0;
let busy = 0;
const end = performance.now() + workerData.ms;
while (performance.now() < end) {
  Atomics.wait(pause, 0, 0, 70);
  const start = performance.now();
  while (performance.now() - start < 30) {
    for (let i = 0; i < 20000; i += 1) { x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d); x ^= x >>> 12; }
    iterations += 20000;
  }
  busy += performance.now() - start;
}
parentPort.postMessage({ iterations, seconds: busy / 1000, checksum: x >>> 0 });
`;
/*
 * Latência para acordar um núcleo: um trabalhador dorme (Atomics.wait sem prazo) e o outro o acorda depois de uma pausa
 * de 0,5 a 3 ms, medindo a ida e volta no próprio relógio. Isso é o que estados ociosos, estacionamento de núcleos e
 * dicas de latência mudam (e não depende da resolução do timer do Windows, porque o acordar vem de um aviso, não do relógio).
 * Pontuação: quanto maior, mais rápido (1.000.000 / média do percentil 50 e 90 em µs).
 */
const LATENCY_WORKER = String.raw`
const { parentPort, workerData } = require('worker_threads');
const flags = new Int32Array(workerData.buffer);
if (workerData.role === 'sleeper') {
  let seen = 0;
  for (;;) {
    Atomics.wait(flags, 0, seen);
    seen = Atomics.load(flags, 0);
    if (seen < 0) break;
    Atomics.store(flags, 1, seen);
  }
  parentPort.postMessage({ done: true });
} else {
  const latencies = [];
  const end = performance.now() + workerData.ms;
  let seed = 12345;
  for (let i = 1; performance.now() < end; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const gapEnd = performance.now() + 0.5 + (seed / 2147483647) * 2.5;
    while (performance.now() < gapEnd) { /* pausa: o outro núcleo tem tempo de dormir */ }
    const start = performance.now();
    Atomics.store(flags, 0, i);
    Atomics.notify(flags, 0);
    const limit = start + 50;
    while (Atomics.load(flags, 1) !== i && performance.now() < limit) { /* espera a resposta */ }
    latencies.push((performance.now() - start) * 1000);
  }
  Atomics.store(flags, 0, -1);
  Atomics.notify(flags, 0);
  latencies.sort((a, b) => a - b);
  const pick = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] || 0;
  parentPort.postMessage({ samples: latencies.length, p50: pick(0.5), p90: pick(0.9) });
}
`;
/*
 * Disco: gravações de 4 KB com fsync (a gravação só termina quando o disco confirma) num arquivo de 4 MB do próprio
 * laboratório, com pausas de 3, 30 e 150 ms entre elas, para o SSD/link ter tempo de entrar em economia. Mede o que as
 * opções de energia de SATA, NVMe e PCI Express mudam: o atraso da primeira operação depois de uma pausa.
 * Pontuação: 1.000.000 / média em µs. O arquivo é apagado no fim da sessão.
 */
const DISK_WORKER = String.raw`
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const SIZE = 4 * 1024 * 1024;
const fd = fs.openSync(workerData.file, fs.existsSync(workerData.file) ? 'r+' : 'w+');
try {
  if (fs.fstatSync(fd).size < SIZE) fs.ftruncateSync(fd, SIZE);
  const block = Buffer.alloc(4096, 7);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const gaps = [3, 30, 150];
  const times = [];
  const end = performance.now() + workerData.ms;
  let seed = 777;
  for (let i = 0; performance.now() < end; i += 1) {
    Atomics.wait(pause, 0, 0, gaps[i % gaps.length]);
    seed = (seed * 16807) % 2147483647;
    const offset = (seed % (SIZE / 4096)) * 4096;
    block.writeUInt32LE(i, 0);
    const start = performance.now();
    fs.writeSync(fd, block, 0, block.length, offset);
    fs.fsyncSync(fd);
    times.push((performance.now() - start) * 1000);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
  parentPort.postMessage({ samples: times.length, meanUs: mean, p50: times[Math.floor(times.length / 2)] || 0 });
} finally { fs.closeSync(fd); }
`;
let activeBench = null;

function runWorker(source, workerData, state) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData });
    state.workers.push(worker);
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', () => { if (state.cancelled) reject(new Error('Teste cancelado.')); });
  });
}

/** Testes extras do laboratório. A pontuação segue a regra dos outros: maior é melhor. */
async function runLabBench(mode, ms) {
  if (mode !== 'latency' && mode !== 'disk') return runCpuBench(mode, ms);
  if (activeBench) throw new Error('Já existe um teste em andamento.');
  const state = { workers: [], cancelled: false };
  activeBench = state;
  try {
    if (mode === 'latency') {
      const buffer = new SharedArrayBuffer(8);
      const sleeper = runWorker(LATENCY_WORKER, { role: 'sleeper', buffer }, state);
      const waker = await runWorker(LATENCY_WORKER, { role: 'waker', buffer, ms }, state);
      await sleeper;
      const us = Math.max(0.05, (waker.p50 + waker.p90) / 2);
      return { mode, threads: 2, ms, mopsPerSec: 1e6 / us, detail: waker };
    }
    const dir = path.join(app.getPath('userData'), 'lab');
    await fs.mkdir(dir, { recursive: true });
    const result = await runWorker(DISK_WORKER, { file: path.join(dir, 'disk-probe.bin'), ms }, state);
    return { mode, threads: 1, ms, mopsPerSec: 1e6 / Math.max(1, result.meanUs), detail: result };
  } finally {
    activeBench = null;
    for (const worker of state.workers) worker.terminate();
  }
}

/** Processador híbrido (núcleos P e E): os sensores mostram "P-Core"/"E-Core"; sem sensores, o modelo da Intel entrega. */
async function isHybridCpu() {
  const sensors = await getHardwareSensors().catch(() => null);
  const names = (sensors?.devices || []).filter((device) => device.type === 'Cpu').flatMap((device) => (device.sensors || []).map((sensor) => sensor.name));
  if (names.some((name) => /\bE-Core\b/i.test(name))) return true;
  if (names.some((name) => /\bCore #\d+/i.test(name))) {
    const model = os.cpus()[0]?.model || '';
    return /Core\(TM\) Ultra|1[2-4]th Gen Intel|i[3579]-1[2-4]\d{3}/i.test(model) ? true : false;
  }
  return null;
}

async function runCpuBench(mode, ms) {
  if (activeBench) throw new Error('Já existe um teste em andamento.');
  const threads = mode === 'multi' ? Math.max(1, os.cpus().length - 1) : 1;
  const state = { workers: [], cancelled: false };
  activeBench = state;
  try {
    const results = await Promise.all(Array.from({ length: threads }, () => new Promise((resolve, reject) => {
      const worker = new Worker(mode === 'burst' ? BURST_WORKER : BENCH_WORKER, { eval: true, workerData: { ms } });
      state.workers.push(worker);
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', () => { if (state.cancelled) reject(new Error('Teste cancelado.')); });
    })));
    const mopsPerSec = results.reduce((sum, item) => sum + item.iterations / item.seconds, 0) / 1e6;
    return { mode, threads, ms, mopsPerSec };
  } finally {
    activeBench = null;
    for (const worker of state.workers) worker.terminate();
  }
}

registerIpcHandler('bench:cpu', async (_event, options) => {
  const mode = options?.mode;
  if (!['single', 'multi', 'burst'].includes(mode)) throw new Error('Modo de teste inválido.');
  if (labState.running) throw new Error('O laboratório está medindo agora; espere ele terminar.');
  const ms = Math.min(3000, Math.max(200, Math.round(Number(options.ms) || 1200)));
  return runCpuBench(mode, ms);
});
registerIpcHandler('bench:cancel', async () => {
  if (activeBench) {
    activeBench.cancelled = true;
    for (const worker of activeBench.workers) worker.terminate();
  }
  return { ok: true };
});
registerIpcHandler('system:power-source', async () => ({ onBattery: Boolean(powerMonitor?.isOnBatteryPower?.()) }));

// ---- Sessões de observação: amostra do sistema, sonda de programas e medição de FPS ----
const sendToWindow = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};
const probe = IS_LINUX ? createLinuxProbe({ linux, emit: (sample) => sendToWindow('session:probe', sample), match: (exePath) => library.matchPath(exePath) }) : createProbe({ emit: (sample) => sendToWindow('session:probe', sample), match: (exePath) => library.matchPath(exePath) });
const MANGO_DIR = () => path.join(app.getPath('userData'), 'mangohud');
const fpsRunner = IS_LINUX ? createMangoRunner({ fs, path, dir: MANGO_DIR(), emit: (channel, payload) => sendToWindow(channel, payload) }) : createFpsRunner({ emit: (channel, payload) => sendToWindow(channel, payload) });

let previousCores = null;
/** Uso por núcleo desde a chamada anterior; a primeira chamada só marca o ponto de partida. */
function sampleCores() {
  const current = os.cpus().map((cpu) => ({ idle: cpu.times.idle, total: Object.values(cpu.times).reduce((sum, value) => sum + value, 0) }));
  let perCore = [];
  if (previousCores && previousCores.length === current.length) {
    perCore = current.map((core, index) => {
      const total = core.total - previousCores[index].total;
      const idle = core.idle - previousCores[index].idle;
      return total > 0 ? Math.min(100, Math.max(0, (1 - idle / total) * 100)) : 0;
    });
  }
  previousCores = current;
  return perCore;
}

registerIpcHandler('session:sample', async () => {
  const perCore = sampleCores();
  const cores = Math.max(1, os.cpus().length);
  const metrics = typeof app.getAppMetrics === 'function' ? app.getAppMetrics() : [];
  const appCpu = metrics.reduce((sum, item) => sum + (item.cpu?.percentCPUUsage || 0), 0) / cores;
  const appMemMB = metrics.reduce((sum, item) => sum + (item.memory?.workingSetSize || 0), 0) / 1024;
  return {
    t: Date.now(),
    cpu: perCore.length ? perCore.reduce((sum, value) => sum + value, 0) / perCore.length : null,
    maxCore: perCore.length ? Math.max(...perCore) : null,
    mem: (1 - os.freemem() / os.totalmem()) * 100,
    appCpu, appMemMB
  };
});
registerIpcHandler('session:probe-start', async () => probe.start());
registerIpcHandler('session:probe-stop', async () => probe.stop());
registerIpcHandler('session:probe-test', async () => probe.test());

const PRESENTMON_PATH_FILE = () => path.join(app.getPath('userData'), 'presentmon.path');
const isFile = (target) => fs.stat(target).then((stats) => stats.isFile()).catch(() => false);

/** 1) executável escolhido pelo usuário; 2) o que o instalador embutiu (se a versão fixada foi baixada na build). */
async function presentMonLocation() {
  try {
    const chosen = (await fs.readFile(PRESENTMON_PATH_FILE(), 'utf8')).trim();
    if (chosen && await isFile(chosen)) return { path: chosen, source: 'escolhido' };
  } catch { /* nada escolhido */ }
  const bundled = app.isPackaged ? path.join(process.resourcesPath, 'tools', 'PresentMon.exe') : path.join(__dirname, 'third-party', 'bin', 'PresentMon.exe');
  return (await isFile(bundled)) ? { path: bundled, source: 'embutido' } : null;
}
async function fpsStatus() {
  const location = await presentMonLocation();
  return { available: Boolean(location), source: location?.source || null, name: location ? path.basename(location.path) : null, platform: process.platform };
}

registerIpcHandler('fps:status', async () => {
  if (IS_LINUX) return { available: await linux.which('mangohud'), source: 'mangohud', name: 'MangoHud', platform: 'linux', launchOption: mangoLaunchOption(MANGO_DIR()) };
  return fpsStatus();
});
registerIpcHandler('fps:choose', async () => {
  if (IS_LINUX) throw new Error('No Linux o FPS vem do MangoHud: instale pelo gerenciador de pacotes e use a opção de inicialização mostrada.');
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Escolha o PresentMon', properties: ['openFile'], filters: [{ name: 'PresentMon', extensions: ['exe'] }] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, ...(await fpsStatus()) };
  const chosen = result.filePaths[0];
  if (!/^presentmon.*\.exe$/i.test(path.basename(chosen))) throw new Error('Escolha o executável do PresentMon (um arquivo PresentMon….exe).');
  await fs.writeFile(PRESENTMON_PATH_FILE(), chosen, 'utf8');
  return fpsStatus();
});
registerIpcHandler('fps:clear', async () => { await fs.rm(PRESENTMON_PATH_FILE(), { force: true }); return fpsStatus(); });
registerIpcHandler('fps:start', async (_event, options) => {
  if (IS_LINUX) return fpsRunner.start();
  const location = await presentMonLocation();
  return fpsRunner.start({ exe: location?.path, pid: Number(options?.pid) });
});
registerIpcHandler('fps:stop', async () => fpsRunner.stop());


const SETTINGS_PAGES = { startup: 'ms-settings:startupapps', power: 'ms-settings:powersleep', storage: 'ms-settings:storagesense', graphics: 'ms-settings:display-advancedgraphics',
  gamemode: 'ms-settings:gaming-gamemode', display: 'ms-settings:display-advanced', captures: 'ms-settings:gaming-gamedvr', recovery: 'ms-settings:recovery', coreisolation: 'windowsdefender://coreisolation' };
registerIpcHandler('system:open-settings', async (_event, page) => {
  if (IS_LINUX) throw new Error('Esta tela é das Configurações do Windows; no Linux, use as configurações do seu ambiente (GNOME, KDE…).');
  const uri = SETTINGS_PAGES[page];
  if (!uri) throw new Error('Página de configurações não permitida.');
  await shell.openExternal(uri);
  return { ok: true };
});

registerIpcHandler('app:open-doc', async (_event, url) => {
  if (typeof url !== 'string' || !/^https:\/\/(learn|support)\.microsoft\.com\/[\w\-./()%?=&#]*$/.test(url)) throw new Error('Link não permitido.');
  await shell.openExternal(url);
  return { ok: true };
});

const EXTERNAL_LINKS = {
  repo: 'https://github.com/Samuklvm/Project-Nexo',
  presentmon: 'https://github.com/GameTechDev/PresentMon/releases',
  steamkey: 'https://steamcommunity.com/dev/apikey',
  steamprivacy: 'https://steamcommunity.com/my/edit/settings',
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
const PRIVACY_FILE = () => path.join(app.getPath('userData'), 'privacy.json');
registerIpcHandler('privacy:get', async () => {
  if (IS_LINUX) { try { return { shareWithCreator: JSON.parse(await fs.readFile(PRIVACY_FILE(), 'utf8')).shareWithCreator === true }; } catch { return { shareWithCreator: false }; } }
  if (process.platform !== 'win32') return { shareWithCreator: false };
  try {
    const { stdout } = await execFileAsync('reg', ['query', PRIVACY_KEY, '/v', 'DeveloperTelemetryOptIn'], { windowsHide: true, timeout: 5000 });
    return { shareWithCreator: /0x1\b/i.test(stdout) };
  } catch { return { shareWithCreator: false }; }
});
registerIpcHandler('privacy:set', async (_event, enabled) => {
  if (IS_LINUX) { await fs.writeFile(PRIVACY_FILE(), JSON.stringify({ shareWithCreator: Boolean(enabled) }), 'utf8'); return { shareWithCreator: Boolean(enabled) }; }
  if (process.platform !== 'win32') return { shareWithCreator: false };
  await execFileAsync('reg', ['add', PRIVACY_KEY, '/v', 'DeveloperTelemetryOptIn', '/t', 'REG_DWORD', '/d', enabled ? '1' : '0', '/f'], { windowsHide: true, timeout: 5000 });
  return { shareWithCreator: Boolean(enabled) };
});

// ---- Preferências do processo principal (bandeja, início com o Windows, observador, capas online) ----
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'nexo-settings.json');
const SETTINGS_DEFAULTS = { autoSession: false, tray: false, openAtLogin: false, onlineCovers: false };
let settings = { ...SETTINGS_DEFAULTS };
let tray = null;
const startHidden = process.argv.includes('--hidden');
const shownOnce = new Set();
function notifyOnce(key, title, body) {
  if (shownOnce.has(key) || !Notification.isSupported()) return;
  shownOnce.add(key);
  new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
}
async function loadSettings() {
  try { settings = { ...SETTINGS_DEFAULTS, ...JSON.parse(await fs.readFile(SETTINGS_FILE(), 'utf8')) }; } catch { settings = { ...SETTINGS_DEFAULTS }; }
  for (const key of Object.keys(settings)) if (!(key in SETTINGS_DEFAULTS) || typeof settings[key] !== 'boolean') delete settings[key];
  settings = { ...SETTINGS_DEFAULTS, ...settings };
}
function showWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Abrir o Nexo', click: showWindow },
    { label: 'Gravar sessões de jogo sozinho', type: 'checkbox', checked: settings.autoSession, click: (item) => applySettings({ autoSession: item.checked }) },
    { type: 'separator' },
    { label: 'Sair do Nexo', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
}
function applyTray() {
  if (settings.tray && !tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
    tray.setToolTip('Nexo Device Care');
    tray.on('click', showWindow);
  }
  if (!settings.tray && tray) { tray.destroy(); tray = null; }
  tray?.setContextMenu(buildTrayMenu());
}
async function applySettings(patch) {
  for (const [key, value] of Object.entries(patch || {})) if (key in SETTINGS_DEFAULTS && typeof value === 'boolean') settings[key] = value;
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings), 'utf8');
  if (process.platform === 'win32' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, name: 'NexoDeviceCare', args: ['--hidden'] });
  if (IS_LINUX && app.isPackaged) await setLinuxAutostart(settings.openAtLogin);
  applyTray();
  if (settings.autoSession) { if (!library.list().length) await library.scan().catch(() => []); watcher.start(); } else watcher.stop();
  sendToWindow('settings:changed', { ...settings });
  return { ...settings, packaged: app.isPackaged, platform: process.platform };
}
/** Linux: o Electron não cria entrada de inicialização; o Nexo grava o .desktop padrão do freedesktop. */
const AUTOSTART_FILE = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'nexo-device-care.desktop');
async function setLinuxAutostart(enabled) {
  if (!enabled) { await fs.rm(AUTOSTART_FILE(), { force: true }); return; }
  const exec = process.env.APPIMAGE || process.execPath;
  await fs.mkdir(path.dirname(AUTOSTART_FILE()), { recursive: true });
  await fs.writeFile(AUTOSTART_FILE(), `[Desktop Entry]\nType=Application\nName=Nexo Device Care\nExec="${exec.replace(/"/g, '')}" --hidden\nIcon=nexo-device-care\nX-GNOME-Autostart-enabled=true\nComment=Inicia o Nexo escondido na bandeja\n`, 'utf8');
}
registerIpcHandler('settings:get', async () => ({ ...settings, packaged: app.isPackaged, platform: process.platform }));
registerIpcHandler('settings:set', async (_event, patch) => applySettings(patch));

// ---- Elevação centralizada (UAC) ----
const elevate = createElevator({ runPowerShell: runPowerShellCode, fs, path, dir: path.join(app.getPath('userData'), 'elevate') });

// ---- Serviço de sensores (temperatura do processador com o driver PawnIO) ----
const sensorService = process.platform === 'win32' ? createSensorService({
  net: nodeNet, fs, path, crypto: require('crypto'), run: (file, args) => runCode(file, args, 8000), fetchBuffer: fetchBytes, elevate,
  userData: app.getPath('userData'), pawnio: PAWNIO,
  hostDir: app.isPackaged ? path.join(process.resourcesPath, 'sensor-host') : path.join(__dirname, 'sensor-host', 'publish')
}) : null;
let serviceReadable = true;
let serviceCheckedAt = 0;
let sensorSetupRunning = false;
const SENSOR_SETUP_FILE = () => path.join(app.getPath('userData'), 'sensor-setup.json');
async function runSensorSetup(trigger) {
  if (!sensorService || sensorSetupRunning) return { ok: false, note: 'indisponível' };
  sensorSetupRunning = true;
  sendToWindow('sensors:setup', { phase: 'start', trigger });
  try {
    const result = await sensorService.install().catch((error) => ({ ok: false, note: error.message }));
    await fs.writeFile(SENSOR_SETUP_FILE(), JSON.stringify({ at: Date.now(), declined: Boolean(result.declined), ok: Boolean(result.ok) }), 'utf8').catch(() => {});
    if (result.ok) { serviceReadable = true; serviceCheckedAt = 0; temperatureCache.expiresAt = 0; }
    sendToWindow('sensors:setup', { phase: 'done', trigger, ...result });
    return result;
  } finally { sensorSetupRunning = false; }
}
/** Sempre ativo: na primeira abertura (e quando o serviço muda de versão) o Nexo instala o serviço; o Windows pede a permissão. */
async function autoSensorSetup() {
  if (!sensorService || !app.isPackaged) return;
  const state = await sensorService.status().catch(() => null);
  if (!state?.needsInstall) return;
  const last = JSON.parse(await fs.readFile(SENSOR_SETUP_FILE(), 'utf8').catch(() => '{}'));
  if (last.declined && Date.now() - (Number(last.at) || 0) < 3 * 86400e3) return;
  await runSensorSetup('auto');
}
registerIpcHandler('sensors:service-status', async () => (sensorService ? { supported: true, setupRunning: sensorSetupRunning, ...(await sensorService.status()) } : { supported: false }));
registerIpcHandler('sensors:service-install', async () => runSensorSetup('manual'));

// ---- Acesso ao FPS: grupo "Performance Log Users" (SID S-1-5-32-559), automático com a permissão da pessoa ----
const ACCESS_SCRIPT = String.raw`$id=[Security.Principal.WindowsIdentity]::GetCurrent(); $pr=New-Object Security.Principal.WindowsPrincipal($id); $in=[bool](@($id.Groups | Where-Object { $_.Value -eq 'S-1-5-32-559' }).Count); $member=$false; try { $member=[bool](@(Get-LocalGroupMember -SID 'S-1-5-32-559' -ErrorAction Stop | Where-Object { $_.SID.Value -eq $id.User.Value }).Count) } catch {}; [pscustomobject]@{ sid=$id.User.Value; inToken=$in; member=$member; admin=$pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress`;
async function readAccess() {
  if (IS_LINUX) return { platform: 'linux', inToken: true, member: false, admin: false, sid: null };
  if (process.platform !== 'win32') return { platform: process.platform, inToken: false, member: false, admin: false, sid: null };
  const result = await runPowerShellCode(ACCESS_SCRIPT, 15000);
  try { const parsed = JSON.parse(result.stdout); return { platform: 'win32', inToken: Boolean(parsed.inToken), member: Boolean(parsed.member) || Boolean(parsed.inToken), admin: Boolean(parsed.admin), sid: parsed.sid }; }
  catch { return { platform: 'win32', inToken: false, member: false, admin: false, sid: null }; }
}
const publicAccess = ({ sid, ...rest }) => ({ ...rest, ready: rest.inToken || rest.admin, needsRelogin: rest.member && !rest.inToken && !rest.admin });
registerIpcHandler('fps:access', async () => publicAccess(await readAccess()));
for (const [channel, action] of [['fps:grant', 'add'], ['fps:revoke', 'remove']]) {
  registerIpcHandler(channel, async () => {
    const before = await readAccess();
    if (!before.sid) throw new Error('Não consegui identificar o seu usuário do Windows.');
    const elevated = await elevate('perf-log-users', { action, sid: before.sid });
    const after = await readAccess();
    return { declined: elevated.declined, ok: Boolean(elevated.result?.ok), changed: Boolean(elevated.result?.changed), note: String(elevated.result?.note || '').slice(0, 200), access: publicAccess(after) };
  });
}

// ---- Fatos do sistema (somente leitura) para o Atlas de opções ----
const FACTS_SCRIPT = UTF8_PS + String.raw`
$mem = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ speed = [int]$_.Speed; configured = [int]$_.ConfiguredClockSpeed; capacity = [double]$_.Capacity } })
$disp = @(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; current = [int]$_.CurrentRefreshRate; max = [int]$_.MaxRefreshRate } })
$hags = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -Name HwSchMode).HwSchMode
$gm = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\GameBar' -Name AutoGameModeEnabled).AutoGameModeEnabled
$cap = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' -Name AppCaptureEnabled).AppCaptureEnabled
$hist = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' -Name HistoricalCaptureEnabled).HistoricalCaptureEnabled
$dg = Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard
$vbs = $null; $hvci = $null
if ($dg) { $vbs = [int]$dg.VirtualizationBasedSecurityStatus; $hvci = [bool](@($dg.SecurityServicesRunning) -contains 2) }
[pscustomobject]@{ memory = $mem; displays = $disp; hags = $hags; gameMode = $gm; capture = $cap; historical = $hist; vbs = $vbs; hvci = $hvci } | ConvertTo-Json -Depth 4 -Compress`;
registerIpcHandler('system:facts', async () => {
  if (IS_LINUX) {
    const [profiles, mangohud, gamemode, governor] = await Promise.all([linux.powerProfiles(), linux.which('mangohud'), linux.which('gamemoded'), fs.readFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'utf8').then((text) => text.trim()).catch(() => null)]);
    return { platform: 'linux', session: process.env.XDG_SESSION_TYPE || null, kernel: os.release(), powerProfile: profiles.find((profile) => profile.active)?.guid || null, ppd: profiles.length > 0, mangohud, gamemode, governor };
  }
  if (process.platform !== 'win32') return { platform: process.platform };
  const result = await runPowerShellCode(FACTS_SCRIPT, 20000);
  try { return { platform: 'win32', ...JSON.parse(result.stdout) }; } catch { return { platform: 'win32' }; }
});

// ---- Conexões (Steam deste PC, Xbox, Discord) e capas oficiais ----
const CONNECTIONS_FILE = () => path.join(app.getPath('userData'), 'connections.bin');
let connections = { steam: null, xbox: null, discord: { enabled: false, showGame: true, showNexo: false } };
async function loadConnections() {
  try {
    const raw = await fs.readFile(CONNECTIONS_FILE());
    const parsed = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
    connections = { ...connections, ...parsed, discord: { ...connections.discord, ...(parsed.discord || {}) } };
  } catch { /* nada conectado */ }
}
async function saveConnections() {
  const text = JSON.stringify(connections);
  await fs.writeFile(CONNECTIONS_FILE(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8'));
}
async function integrationConfig() {
  const config = { discordAppId: process.env.NEXO_DISCORD_APP_ID || null, xboxClientId: process.env.NEXO_XBOX_CLIENT_ID || null };
  const files = [path.join(app.getPath('userData'), 'integrations.json'), app.isPackaged ? path.join(process.resourcesPath, 'config', 'integrations.json') : path.join(__dirname, 'config', 'integrations.json')];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!config.discordAppId && DiscordRpc.APP_ID.test(String(parsed.discordAppId || ''))) config.discordAppId = String(parsed.discordAppId);
      if (!config.xboxClientId && Xbox.CLIENT_ID.test(String(parsed.xboxClientId || ''))) config.xboxClientId = String(parsed.xboxClientId);
    } catch { /* próximo */ }
  }
  if (!config.discordAppId) config.discordAppId = DiscordRpc.OFFICIAL_APP_ID;
  return config;
}
const withTimeout = (ms) => (typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);
async function fetchBytes(url) {
  const response = await net.fetch(url, { signal: withTimeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function fetchJson(url) {
  const response = await net.fetch(url, { signal: withTimeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
/** Reduz a imagem para a largura exibida (capas 360 px, fundos 1600 px). Menos RAM e decodificação mais rápida. */
function shrink(image, width, asPng) {
  if (image.isEmpty()) return null;
  const size = image.getSize();
  const out = size.width > width ? image.resize({ width, quality: 'good' }) : image;
  return asPng ? out.toPNG() : out.toJPEG(86);
}
const COVERS_DIR = () => path.join(app.getPath('userData'), 'covers');
const covers = createCoverResolver({
  fetchBytes, fetchJson,
  save: async (id, kind, bytes) => {
    const png = kind === 'logo';
    const data = shrink(nativeImage.createFromBuffer(bytes), kind === 'hero' ? 1600 : kind === 'logo' ? 640 : 360, png) || bytes;
    const file = path.join(COVERS_DIR(), `off-${id}-${kind}.${png ? 'png' : 'jpg'}`);
    await fs.mkdir(COVERS_DIR(), { recursive: true });
    await fs.writeFile(file, data);
    return file;
  }
});
const steamAccount = Steam.createSteamAccount({ fs, path, fetchJson });
let ownedCache = { at: 0, key: null, games: [] };
const discord = createDiscord({ connect: (pipe) => nodeNet.createConnection(pipe) });

// ---- Biblioteca de jogos ----
const library = createLibrary({
  fs, path, runPowerShell: runPowerShellCode,
  getFileIcon: (file) => app.getFileIcon(file, { size: 'large' }).then((image) => image.toDataURL()),
  coversDir: COVERS_DIR(),
  manualFile: path.join(app.getPath('userData'), 'games-manual.json'),
  downscale: async (source, target, width) => { const data = shrink(nativeImage.createFromPath(source), width, target.endsWith('.png')); if (!data) return false; await fs.writeFile(target, data); return true; },
  resolveOnline: (game) => covers.resolve(game),
  extras: async (steamRoot) => {
    const out = { xboxTitles: connections.xbox?.titles || [] };
    const steam = connections.steam;
    if (steam?.steamId) {
      out.steamPlaytime = await steamAccount.playtime(steamRoot, steam.steamId);
      if (steam.apiKey) {
        const fresh = ownedCache.key === steam.steamId && Date.now() - ownedCache.at < 6 * 3600 * 1000;
        if (!fresh) ownedCache = { at: Date.now(), key: steam.steamId, games: await steamAccount.ownedGames(steam.apiKey, steam.steamId).catch(() => ownedCache.games) };
        out.steamOwned = ownedCache.games;
      }
    }
    return out;
  }
});
const fileUrl = (file, tag = '') => (file ? `${pathToFileURL(file).href}?v=${encodeURIComponent(tag)}` : null);
const coverUrl = (list) => list.map((game) => ({ ...game, cover: fileUrl(game.cover, game.coverSource || ''), hero: fileUrl(game.hero, 'h'), logo: fileUrl(game.logo, 'l'), header: fileUrl(game.header, 'c') }));
let artRunning = false;
async function fetchOfficialArt(force = false) {
  if (artRunning) return 0;
  artRunning = true;
  try {
    const found = await library.fetchOfficialArt({ force, onProgress: (done, total) => sendToWindow('games:art-progress', { done, total }) });
    sendToWindow('games:updated', coverUrl(library.list()));
    return found;
  } finally { artRunning = false; sendToWindow('games:art-progress', null); }
}
registerIpcHandler('games:scan', async () => {
  const list = await library.scan();
  if (settings.onlineCovers) fetchOfficialArt().catch(() => {});
  return coverUrl(list);
});
registerIpcHandler('games:fetch-art', async (_event, options) => {
  if (!settings.onlineCovers) await applySettings({ onlineCovers: true });
  return { found: await fetchOfficialArt(Boolean(options?.force)) };
});
// Dados completos do jogo (loja, novidades e conquistas da Steam). Só com o conteúdo online permitido.
const steamDetails = createSteamDetails({ fetchJson, fs, path, cacheDir: path.join(app.getPath('userData'), 'details') });
registerIpcHandler('games:details', async (_event, id) => {
  const game = library.get(String(id));
  if (!game) throw new Error('Jogo não encontrado; atualize a biblioteca.');
  if (!settings.onlineCovers) return { consent: false };
  let appid = game.appid || null;
  let matched = false;
  if (!appid) { appid = await steamDetails.findAppid(game.name, Covers.exactSteamMatch).catch(() => null); matched = Boolean(appid); }
  if (!appid) return { consent: true, appid: null };
  const steam = connections.steam;
  const [store, news, achievements] = await Promise.all([
    steamDetails.store(appid).catch(() => null),
    steamDetails.news(appid).catch(() => []),
    game.source === 'steam' ? steamDetails.achievements(appid, steam?.steamId, steam?.apiKey).catch(() => ({ state: 'error', unlocked: 0, total: 0, list: [] })) : Promise.resolve({ state: 'other-store', unlocked: 0, total: 0, list: [] })
  ]);
  return { consent: true, appid, matched, store, news, achievements };
});
const STORE_URL = /^https:\/\/(store\.steampowered\.com|steamcommunity\.com|steamstore-a\.akamaihd\.net)\/[\w\-./?=&%#:]*$/;
registerIpcHandler('app:open-store-url', async (_event, url) => {
  if (typeof url !== 'string' || !STORE_URL.test(url)) throw new Error('Link não permitido.');
  await shell.openExternal(url);
  return { ok: true };
});
registerIpcHandler('games:list', async () => coverUrl(library.list()));
const LAUNCH_SCHEMES = /^(steam:\/\/(rungameid|install)\/\d+|com\.epicgames\.launcher:\/\/apps\/[\w%.-]+\?action=launch&silent=true|uplay:\/\/launch\/\d+\/0)$/;
registerIpcHandler('games:launch', async (_event, id) => {
  const game = library.get(String(id));
  if (!game) throw new Error('Jogo não encontrado; atualize a biblioteca.');
  if (game.launchUri && LAUNCH_SCHEMES.test(game.launchUri)) { await shell.openExternal(game.launchUri); return { ok: true, via: 'launcher' }; }
  if (game.exe && /\.exe$/i.test(game.exe) && await isFile(game.exe)) { const error = await shell.openPath(game.exe); if (error) throw new Error(error); return { ok: true, via: 'executável' }; }
  throw new Error('Este jogo precisa ser aberto pelo próprio launcher.');
});
registerIpcHandler('games:reveal', async (_event, id) => {
  const game = library.get(String(id));
  if (!game?.installDir) throw new Error('Pasta do jogo desconhecida.');
  const error = await shell.openPath(game.installDir);
  if (error) throw new Error(error);
  return { ok: true };
});
registerIpcHandler('games:set-cover', async (_event, id) => {
  const game = library.get(String(id));
  if (!game) throw new Error('Jogo não encontrado.');
  const picked = await dialog.showOpenDialog(mainWindow, { title: `Capa de ${game.name}`, properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
  const bytes = await fs.readFile(picked.filePaths[0]);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Use uma imagem de até 8 MB.');
  const extension = detectImageExtension(bytes);
  if (!extension) throw new Error('Use uma imagem PNG, JPEG ou WebP.');
  const dir = path.join(app.getPath('userData'), 'covers');
  await fs.mkdir(dir, { recursive: true });
  for (const name of await fs.readdir(dir)) if (name.startsWith(`custom-${game.id}.`)) await fs.rm(path.join(dir, name), { force: true });
  await fs.writeFile(path.join(dir, `custom-${game.id}.${extension}`), bytes);
  return { games: coverUrl(await library.scan()) };
});
const MANUAL_FILE = () => path.join(app.getPath('userData'), 'games-manual.json');
registerIpcHandler('games:add', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, { title: 'Escolha o executável do jogo', properties: ['openFile'], filters: [{ name: 'Programas', extensions: ['exe'] }] });
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
  let list = [];
  try { list = JSON.parse(await fs.readFile(MANUAL_FILE(), 'utf8')); } catch { list = []; }
  const exe = picked.filePaths[0];
  if (!list.some((item) => item.exe === exe)) list.push({ name: path.basename(exe, path.extname(exe)), exe });
  await fs.writeFile(MANUAL_FILE(), JSON.stringify(list.slice(-200)), 'utf8');
  return { games: coverUrl(await library.scan()) };
});
registerIpcHandler('games:remove-manual', async (_event, id) => {
  const game = library.get(String(id));
  if (!game || game.source !== 'manual') throw new Error('Só jogos adicionados por você podem ser removidos daqui.');
  let list = [];
  try { list = JSON.parse(await fs.readFile(MANUAL_FILE(), 'utf8')); } catch { list = []; }
  await fs.writeFile(MANUAL_FILE(), JSON.stringify(list.filter((item) => item.exe !== game.exe)), 'utf8');
  return { games: coverUrl(await library.scan()) };
});

// ---- Observador de jogos (sessão automática; opcional) ----
const watcher = (IS_LINUX ? (options) => createLinuxWatcher({ linux, ...options }) : createWatcher)({
  match: (exePath) => library.matchPath(exePath),
  onStart: (game) => {
    sendToWindow('watch:game', { type: 'start', name: game.name, gameId: game.gameId, pid: game.pid });
    if (!mainWindow?.isVisible() && Notification.isSupported()) new Notification({ title: `Gravando a sessão de ${game.name}`, body: 'O Nexo começou a observar o desempenho. O relatório fica pronto quando o jogo fechar.', icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  },
  onEnd: (game) => sendToWindow('watch:game', { type: 'end', name: game.name, gameId: game.gameId, pid: game.pid })
});
registerIpcHandler('watch:current', async () => watcher.current());

// ---- Laboratório (Otimização extrema, beta) ----
function maxTemperature(readings) {
  const values = [];
  for (const device of readings?.devices || []) {
    if (!/cpu/i.test(String(device.type))) continue;
    for (const sensor of device.sensors || []) if (sensor.type === 'Temperature' && Number.isFinite(sensor.value) && sensor.value > 5 && sensor.value < 125) values.push(sensor.value);
  }
  return values.length ? Math.max(...values) : null;
}
async function readCpuTemperature() {
  const detailed = maxTemperature(await getHardwareSensors().catch(() => null));
  if (Number.isFinite(detailed)) return detailed;
  const acpi = (await getTemperatureReadings().catch(() => ({ acpiSensors: [] }))).acpiSensors.map((sensor) => sensor.celsius).filter((value) => Number.isFinite(value) && value > 5 && value < 125);
  return acpi.length ? Math.max(...acpi) : null;
}
const labState = { running: false, signal: null };
const labBench = (mode) => runLabBench(mode, mode === 'disk' ? 2400 : 1200);
const labSystem = IS_LINUX ? createLinuxLabSystem({ linux, run: runCode, bench: (mode) => runCpuBench(['single', 'multi', 'burst'].includes(mode) ? mode : 'burst', 1200), readTemp: () => readCpuTemperature(), cpuLoad: getCpuUsage, onBattery: async () => Boolean(powerMonitor?.isOnBatteryPower?.()), fs, path, dir: path.join(app.getPath('userData'), 'lab') }) : createLabSystem({
  run: runCode, runPowerShell: runPowerShellCode,
  bench: labBench, isHybrid: isHybridCpu,
  readTemp: readCpuTemperature, cpuLoad: getCpuUsage, onBattery: async () => Boolean(powerMonitor?.isOnBatteryPower?.()),
  elevate, fs, path, dir: path.join(app.getPath('userData'), 'lab'), exePath: process.execPath, isPackaged: app.isPackaged
});
registerIpcHandler('lab:status', async () => ({ running: labState.running, pending: await labSystem.hasPendingLock(), platform: process.platform, space: NexoLab.spaceFor(process.platform).map(({ id, group, label, values, risk, novelty, hidden, what, unit, names, affects, hybrid }) => ({ id, group, label, values, risk, novelty, hidden, what, unit, names, affects, hybrid })) }));
registerIpcHandler('lab:preflight', async () => {
  if (labState.running) throw new Error('O laboratório já está rodando.');
  const pre = await labSystem.preflight();
  return { ...pre, activeGuid: undefined };
});
registerIpcHandler('lab:run', async (_event, options) => {
  if (labState.running) throw new Error('O laboratório já está rodando.');
  if (activeBench) throw new Error('Há um teste de desempenho em andamento.');
  const memory = NexoLab.sanitizeMemory(options?.evidence, options?.tabu);
  labState.running = true;
  labState.signal = { cancelled: false };
  try {
    return await NexoLab.run(labSystem, {
      consent: { acknowledged: options?.consent?.acknowledged === true, phrase: String(options?.consent?.phrase || '').slice(0, 40) },
      autonomy: options?.autonomy === 'autonomo' ? 'autonomo' : 'assistido',
      allowRisk: ['baixo', 'moderado', 'alto'].includes(options?.allowRisk) ? options.allowRisk : 'moderado',
      maxArms: Math.max(1, Math.min(48, Math.round(Number(options?.maxArms) || 4))),
      goal: ['jogos', 'geral', 'pesado', 'resposta'].includes(options?.goal) ? options.goal : 'geral',
      combos: Math.max(0, Math.min(8, Math.round(Number(options?.combos) || 0))),
      wild: options?.wild === true,
      limits: { budgetMs: Math.max(5, Math.min(120, Math.round(Number(options?.budgetMin) || 20))) * 60 * 1000 },
      requireRestorePoint: options?.requireRestorePoint !== false,
      evidence: memory.evidence, tabu: memory.tabu, signal: labState.signal,
      emit: (event) => sendToWindow('lab:event', event.type === 'done' ? { type: 'done' } : event)
    });
  } finally { labState.running = false; labState.signal = null; }
});
registerIpcHandler('lab:cancel', async () => { if (labState.signal) labState.signal.cancelled = true; return { ok: true }; });
registerIpcHandler('lab:recover', async () => labSystem.recover());
registerIpcHandler('lab:adopt', async (_event, config) => {
  if (labState.running) throw new Error('O laboratório está rodando.');
  const clean = {};
  for (const [id, value] of Object.entries(config && typeof config === 'object' ? config : {})) if (NexoLab.knob(id) && Number.isInteger(value)) clean[id] = value;
  return labSystem.adoptCurrent(clean);
});

// ---- Conexões: IPC ----
async function connectionsView() {
  const config = await integrationConfig();
  const steamRoot = library.steamRoot();
  const detected = await steamAccount.detect(steamRoot).catch(() => ({ users: [] }));
  const steam = connections.steam;
  const steamUser = steam ? detected.users.find((user) => user.steamId === steam.steamId) : null;
  return {
    steam: { installed: Boolean(steamRoot), connected: Boolean(steam), steamId: steam?.steamId || null, personaName: steam?.personaName || null, avatar: fileUrl(steamUser?.avatarFile, 'a'), hasKey: Boolean(steam?.apiKey), owned: ownedCache.key === steam?.steamId ? ownedCache.games.length : null,
      detected: detected.users.map((user) => ({ steamId: user.steamId, personaName: user.personaName, avatar: fileUrl(user.avatarFile, 'a'), mostRecent: user.mostRecent })) },
    xbox: { configured: Boolean(config.xboxClientId), connected: Boolean(connections.xbox), gamertag: connections.xbox?.gamertag || null, avatar: fileUrl(connections.xbox?.pictureFile, 'x'), titles: connections.xbox?.titles?.length || 0, at: connections.xbox?.at || null },
    discord: { configured: Boolean(config.discordAppId), ...connections.discord, ready: discord.isReady() }
  };
}
registerIpcHandler('connections:get', connectionsView);
registerIpcHandler('steam:connect', async (_event, steamId) => {
  const detected = await steamAccount.detect(library.steamRoot());
  const user = detected.users.find((item) => item.steamId === String(steamId));
  if (!user) throw new Error('Essa conta não entrou na Steam deste PC.');
  connections.steam = { steamId: user.steamId, personaName: user.personaName, apiKey: connections.steam?.steamId === user.steamId ? connections.steam.apiKey : null, at: Date.now() };
  await saveConnections();
  return connectionsView();
});
registerIpcHandler('steam:disconnect', async () => { connections.steam = null; ownedCache = { at: 0, key: null, games: [] }; await saveConnections(); return connectionsView(); });
registerIpcHandler('steam:set-key', async (_event, key) => {
  if (!connections.steam) throw new Error('Conecte a conta Steam primeiro.');
  const clean = String(key || '').trim();
  if (!clean) { connections.steam.apiKey = null; ownedCache = { at: 0, key: null, games: [] }; await saveConnections(); return connectionsView(); }
  const games = await steamAccount.ownedGames(clean, connections.steam.steamId);
  connections.steam.apiKey = clean.toUpperCase();
  ownedCache = { at: Date.now(), key: connections.steam.steamId, games };
  await saveConnections();
  return connectionsView();
});
let xboxBusy = false;
registerIpcHandler('xbox:sign-in', async () => {
  if (xboxBusy) throw new Error('Já existe um login da Microsoft em andamento no navegador.');
  const config = await integrationConfig();
  xboxBusy = true;
  try {
    const result = await Xbox.signIn({ clientId: config.xboxClientId, createServer: http.createServer, openExternal: (url) => shell.openExternal(url), fetch: (url, init) => net.fetch(url, init) });
    let pictureFile = null;
    if (result.profile.picture) {
      try { const bytes = await fetchBytes(`${result.profile.picture}&w=128`.replace(/\?&/, '?')); if (detectImageExtension(bytes)) { await fs.mkdir(ACCOUNT_DIR(), { recursive: true }); pictureFile = path.join(ACCOUNT_DIR(), `xbox.${detectImageExtension(bytes)}`); await fs.writeFile(pictureFile, bytes); } } catch { /* sem foto */ }
    }
    connections.xbox = { gamertag: result.profile.gamertag, pictureFile, titles: result.titles, at: Date.now() };
    await saveConnections();
    mainWindow?.show(); mainWindow?.focus();
    return connectionsView();
  } finally { xboxBusy = false; }
});
registerIpcHandler('xbox:sign-out', async () => {
  if (connections.xbox?.pictureFile) await fs.rm(connections.xbox.pictureFile, { force: true });
  connections.xbox = null; await saveConnections(); return connectionsView();
});
let presence = null;
async function pushPresence() {
  const config = await integrationConfig();
  if (!config.discordAppId) return;
  const prefs = connections.discord;
  if (!prefs.enabled) { await discord.clear(config.discordAppId).catch(() => {}); return; }
  if (presence?.kind === 'game' && prefs.showGame) await discord.setActivity(config.discordAppId, { details: `Jogando ${presence.name}`, state: 'Desempenho medido pelo Nexo', startedAt: presence.startedAt });
  else if (prefs.showNexo) await discord.setActivity(config.discordAppId, { details: 'Cuidando do PC com o Nexo', state: presence?.kind === 'lab' ? 'Laboratório em ação' : undefined });
  else await discord.clear(config.discordAppId);
}
registerIpcHandler('discord:set', async (_event, patch) => {
  for (const key of ['enabled', 'showGame', 'showNexo']) if (typeof patch?.[key] === 'boolean') connections.discord[key] = patch[key];
  await saveConnections();
  try { await pushPresence(); } catch (error) { if (connections.discord.enabled) throw error; }
  return connectionsView();
});
registerIpcHandler('presence:update', async (_event, state) => {
  presence = state && ['game', 'lab'].includes(state.kind) ? { kind: state.kind, name: String(state.name || '').slice(0, 80), startedAt: Number(state.startedAt) || Date.now() } : null;
  await pushPresence().catch(() => {});
  return { ok: true };
});
registerIpcHandler('integrations:import', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, { title: 'Configuração das integrações (JSON)', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (picked.canceled || !picked.filePaths[0]) return connectionsView();
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(picked.filePaths[0], 'utf8')); } catch { throw new Error('Arquivo JSON inválido.'); }
  const clean = {};
  if (DiscordRpc.APP_ID.test(String(parsed.discordAppId || ''))) clean.discordAppId = String(parsed.discordAppId);
  if (Xbox.CLIENT_ID.test(String(parsed.xboxClientId || ''))) clean.xboxClientId = String(parsed.xboxClientId);
  if (!Object.keys(clean).length) throw new Error('Esperado: { "discordAppId": "…", "xboxClientId": "…" }.');
  await fs.writeFile(path.join(app.getPath('userData'), 'integrations.json'), JSON.stringify(clean), 'utf8');
  return connectionsView();
});

// ---- Custo do próprio Nexo e nível do hardware (para o modo leve automático) ----
registerIpcHandler('app:self-metrics', async () => {
  const metrics = typeof app.getAppMetrics === 'function' ? app.getAppMetrics() : [];
  const cores = Math.max(1, os.cpus().length);
  return { cpu: metrics.reduce((sum, item) => sum + (item.cpu?.percentCPUUsage || 0), 0) / cores, memMB: metrics.reduce((sum, item) => sum + (item.memory?.workingSetSize || 0), 0) / 1024, processes: metrics.length };
});
registerIpcHandler('system:tier', async () => {
  const cores = os.cpus().length;
  const memGB = os.totalmem() / 1024 ** 3;
  const tier = cores <= 4 || memGB < 7.5 ? 'fraco' : cores <= 8 || memGB < 15 ? 'medio' : 'forte';
  return { cores, memGB: Math.round(memGB * 10) / 10, tier };
});

// ---- Conta Google (opcional) ----
const ACCOUNT_DIR = () => path.join(app.getPath('userData'), 'account');
async function googleConfig() {
  if (process.env.NEXO_GOOGLE_CLIENT_ID) return Account.parseClientConfig({ clientId: process.env.NEXO_GOOGLE_CLIENT_ID, clientSecret: process.env.NEXO_GOOGLE_CLIENT_SECRET });
  const candidates = [path.join(app.getPath('userData'), 'google-oauth.json'), app.isPackaged ? path.join(process.resourcesPath, 'config', 'google-oauth.json') : path.join(__dirname, 'config', 'google-oauth.json')];
  for (const file of candidates) {
    try { const parsed = Account.parseClientConfig(JSON.parse(await fs.readFile(file, 'utf8'))); if (parsed) return { ...parsed, source: file.startsWith(app.getPath('userData')) ? 'importado' : 'build' }; } catch { /* próximo */ }
  }
  return null;
}
async function readProfile() {
  const dir = ACCOUNT_DIR();
  try {
    const raw = await fs.readFile(path.join(dir, 'profile.bin'));
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    return JSON.parse(text);
  } catch { return null; }
}
async function accountView() {
  const [config, profile] = await Promise.all([googleConfig(), readProfile()]);
  let avatar = null;
  if (profile?.avatarFile) { try { const stats = await fs.stat(profile.avatarFile); avatar = `${pathToFileURL(profile.avatarFile).href}?v=${Math.round(stats.mtimeMs)}`; } catch { /* sem foto */ } }
  return { configured: Boolean(config), configSource: config?.source || null, encrypted: safeStorage.isEncryptionAvailable(), profile: profile ? { name: profile.name, email: profile.email, signedInAt: profile.signedInAt } : null, avatar };
}
registerIpcHandler('account:get', accountView);
let signingIn = false;
registerIpcHandler('account:sign-in', async () => {
  if (signingIn) throw new Error('Já existe um login em andamento no navegador.');
  const config = await googleConfig();
  if (!config) throw new Error('O login com Google ainda não foi configurado nesta build.');
  signingIn = true;
  try {
    const { profile, avatar } = await Account.signIn({ config, createServer: http.createServer, openExternal: (url) => shell.openExternal(url), fetch: (url, init) => net.fetch(url, init) });
    const dir = ACCOUNT_DIR();
    await fs.mkdir(dir, { recursive: true });
    let avatarFile = null;
    const extension = avatar ? detectImageExtension(avatar) : null;
    if (extension && avatar.length < 2 * 1024 * 1024) { avatarFile = path.join(dir, `avatar.${extension}`); await fs.writeFile(avatarFile, avatar); }
    const record = JSON.stringify({ sub: profile.sub, name: profile.name, email: profile.email, avatarFile, signedInAt: Date.now() });
    await fs.writeFile(path.join(dir, 'profile.bin'), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(record) : Buffer.from(record, 'utf8'));
    mainWindow?.show(); mainWindow?.focus();
    return accountView();
  } finally { signingIn = false; }
});
registerIpcHandler('account:sign-out', async () => { await fs.rm(ACCOUNT_DIR(), { recursive: true, force: true }); return accountView(); });
registerIpcHandler('account:import-config', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, { title: 'Credenciais OAuth do Google Cloud (JSON)', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (picked.canceled || !picked.filePaths[0]) return accountView();
  let parsed = null;
  try { parsed = Account.parseClientConfig(JSON.parse(await fs.readFile(picked.filePaths[0], 'utf8'))); } catch { parsed = null; }
  if (!parsed) throw new Error('Esse arquivo não parece o JSON de um cliente OAuth "App para computador" do Google Cloud.');
  await fs.writeFile(path.join(app.getPath('userData'), 'google-oauth.json'), JSON.stringify({ installed: { client_id: parsed.clientId, client_secret: parsed.clientSecret } }), 'utf8');
  return accountView();
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
Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'NexoDeviceCare' -Force
Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' -Name 'NexoDeviceCare' -Force
Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name 'NexoLabRecovery' -Force
# Planos de energia criados pelo laboratório: volta ao Equilibrado se um deles estiver ativo e apaga todos
$active = (powercfg /getactivescheme | Out-String)
foreach ($line in (powercfg /list)) { if ($line -match 'Nexo (Lab|.{1,3}Ajustado)' -and $line -match '([0-9a-fA-F]{8}-[0-9a-fA-F-]{27})') { $g = $Matches[1]; if ($active -match $g) { powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e | Out-Null }; powercfg /delete $g | Out-Null } }

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
  if (IS_LINUX && app.isPackaged) {
    // Apaga dados, inicialização, a própria AppImage (se for o caso) ou remove o pacote .deb (pkexec pede a senha).
    const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
    const removePackage = !process.env.APPIMAGE && process.execPath.startsWith('/opt/') ? linuxPrivileged('remove-deb') : null;
    const script = [`while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
      `rm -rf ${quote(app.getPath('userData'))} ${quote(path.join(os.homedir(), '.cache', 'nexo-device-care'))} ${quote(path.join(os.homedir(), '.cache', 'nexo-device-care-updater'))} ${quote(AUTOSTART_FILE())}`,
      process.env.APPIMAGE ? `rm -f ${quote(process.env.APPIMAGE)}` : '',
      removePackage ? removePackage.map(quote).join(' ') : ''].filter(Boolean).join('; ');
    spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
    await labSystem.recover().catch(() => {});
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  }
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
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--lab-recover')) { labSystem.recover().catch(() => {}); return; }
    showWindow();
  });

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.samuklvm.nexo');
    Menu.setApplicationMenu(null);
    // Se um teste do laboratório ficou pela metade (queda de energia, travamento), volta ao plano original antes de tudo.
    const recovered = await labSystem.recover().catch(() => ({ recovered: false }));
    if (process.argv.includes('--lab-recover')) { app.quit(); return; }
    await loadSettings();
    await loadConnections();
    createWindow();
    if (recovered.recovered) mainWindow.webContents.once('did-finish-load', () => sendToWindow('lab:recovered', recovered));
    applyTray();
    if (process.platform === 'win32' && app.isPackaged) setTimeout(() => autoSensorSetup().catch(() => {}), 5000);
    if (settings.autoSession) library.scan().catch(() => []).finally(() => watcher.start());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  app.isQuitting = true;
  discord.close();
  if (labState.running) {
    // Nunca sair com o clone do laboratório ativo: cancela, espera a restauração e sai.
    event.preventDefault();
    labState.signal.cancelled = true;
    const wait = setInterval(() => { if (!labState.running) { clearInterval(wait); app.quit(); } }, 300);
    return;
  }
  watcher.stop();
  probe.stop();
  fpsRunner.stop();
  sensorHost?.kill();
});
