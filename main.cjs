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
const { systemTool, nvidiaSmi } = require('./electron/system-path.cjs');
const { createSensorService } = require('./electron/sensor-service.cjs');
const { createLabSystem, parseList: parseLabPlanList } = require('./electron/lab-system.cjs');
const { createSystemScan, validateChange: validateScanChange } = require('./electron/system-scan.cjs');
const { createRebootTest } = require('./electron/reboot-test.cjs');
const { DISK_MODEL_SCRIPT, parseDiskModels } = require('./electron/disk-models.cjs');
const APP_LAUNCHED_AT = Date.now();
const LabParsers = { parseList: parseLabPlanList };
const { createLibrary } = require('./electron/games.cjs');
const { createWatcher } = require('./electron/watcher.cjs');
const Account = require('./electron/account.cjs');
const NexoLab = require('./src/lab.js');
const Steam = require('./electron/steam-account.cjs');
const SteamLogin = require('./electron/steam-login.cjs');
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

// ---- Registro de erros local (fica neste PC; enviar é escolha da pessoa) ----
const { createErrorLog } = require('./electron/error-log.cjs');
const errorLog = createErrorLog({
  fs, path, dir: path.join(app.getPath('userData'), 'logs'), version: app.getVersion(), home: os.homedir(),
  user: (() => { try { return os.userInfo().username; } catch { return ''; } })()
});
// Diagnóstico do app por dia (canais IPC, quedas, travadas, erros por origem): só sai com a telemetria ligada.
// O diag usa a API síncrona do fs (o flush do before-quit precisa terminar antes de o app fechar); `fs` aqui é o de promessas.
const { createDiag } = require('./electron/diag.cjs');
const recordRaw = errorLog.record.bind(errorLog);
const diagErrorsSeen = new Set();
const diag = createDiag({
  fs: require('fs'), path, file: path.join(app.getPath('userData'), 'diag.json'),
  // Uma vez por tipo e por sessão, direto no registro (sem passar pela contagem do diag, para não entrar em laço).
  onError: (kind, error) => { if (diagErrorsSeen.has(kind)) { return; } diagErrorsSeen.add(kind); try { recordRaw({ source: 'principal', level: 'aviso', message: `Diagnóstico do app: falha ao ${kind} (${error?.code || error?.message || error})`, context: { etapa: `diag.${kind}` } }); } catch { /* registro indisponível */ } }
});
setInterval(() => diag.flush(), 5 * 60 * 1000).unref?.();
/*
 * Trilha (breadcrumbs): as últimas ações do app (canal IPC, resultado e tempo; telas; energia), só nomes fixos.
 * Vai junto com cada ERRO no contexto ("trilha"), para dar para reconstruir o que levou a ele. Nada do conteúdo.
 */
const trail = [];
function crumb(kind, name, extra = '') {
  trail.push(`${Math.round((Date.now() - APP_LAUNCHED_AT) / 1000)}s ${kind} ${String(name).slice(0, 40)}${extra ? ` ${String(extra).slice(0, 30)}` : ''}`);
  if (trail.length > 30) trail.splice(0, trail.length - 30);
}
errorLog.record = (entry = {}) => {
  diag.count(`erro.${String(entry.source || 'outro').replace(/[^a-z]/gi, '') || 'outro'}`);
  if (entry.level !== 'aviso' && (entry.context === undefined || (entry.context && typeof entry.context === 'object' && !Array.isArray(entry.context)))) {
    entry = { ...entry, context: { ...(entry.context || {}), trilha: trail.slice(-12) } };
  }
  return recordRaw(entry);
};
/** Interrupção que não foi a pessoa que pediu (guarda, prazo, falha de serviço): vai para o registro como erro. */
const INTERRUPTION_LABEL = { laboratorio: 'Otimização extrema', 'teste-com-reinicio': 'Teste com reinício', sensores: 'Leitura de sensores', powershell: 'Comando do Windows', atualizacao: 'Atualização do app', 'observador-de-jogos': 'Observador de jogos' };
function noteInterruption(what, reason, context = {}, level = 'erro') {
  crumb('parou', what);
  diag.count(`interrompido.${what}`);
  errorLog.record({ source: 'servico', level, message: `${INTERRUPTION_LABEL[what] || what} interrompido(a): ${String(reason || 'motivo desconhecido').slice(0, 300)}`, context: { etapa: what, ...context } });
}
/** Erro de programação (TypeError, ReferenceError…) é bug nosso; recusa do UAC, cancelamento e rede, não. */
const isBug = (error) => ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError'].includes(error?.name) || error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError;
/*
 * Ação lenta vira aviso no registro. Limite por canal (ms); Infinity = espera a pessoa (login, UAC) ou é longa por natureza.
 * O resto usa 30 s. Só o nome do canal e o tempo vão para o registro.
 */
const SLOW_IPC_MS = {
  'system:snapshot': 15000, 'sensors:snapshot': 15000, 'watch:current': 5000, 'cloud:status': 8000, 'app:self-metrics': 5000, 'settings:get': 5000, 'privacy:get': 5000,
  'window:minimize': 3000, 'window:toggle-maximize': 3000, 'window:close': 3000, 'window:get-state': 3000, 'games:scan': 120000, 'games:fetch-art': 90000, 'scan:run': 120000,
  'cleanup:scan': 120000, 'cleanup:preview': 90000, 'net:diagnose': 90000, 'lab:preflight': 60000, 'updates:check': 60000, 'session:probe-test': 60000, 'steam:connect': 60000
};
for (const channel of ['bench:cpu', 'lab:run', 'lab:adopt', 'lab:recover', 'reboot:start', 'reboot:continue', 'reboot:restart', 'account:sign-in', 'steam:sign-in', 'xbox:sign-in', 'cloud:connect', 'net:fix', 'scan:apply',
  'cleanup:run', 'drives:optimize', 'system:repair', 'updates:download', 'updates:install', 'sensors:service-install', 'fps:access', 'fps:choose', 'app:uninstall', 'account:import-config', 'integrations:import', 'games:add', 'games:set-cover']) SLOW_IPC_MS[channel] = Infinity;
const slowSeen = new Map();
function noteSlowIpc(channel, ms) {
  const hour = Math.floor(Date.now() / 3600000);
  if (slowSeen.get(channel) === hour) return; // uma vez por canal por hora
  slowSeen.set(channel, hour);
  diag.count(`lento.${channel}`);
  errorLog.record({ source: 'ipc', level: 'aviso', message: `Ação lenta: ${channel} levou ${(ms / 1000).toFixed(1)} s`, context: { acao: channel, ms: Math.round(ms), limite: SLOW_IPC_MS[channel] ?? 30000 } });
}
/* Processo principal travado (laço de eventos parado): mede o atraso e registra trechos acima de 1,5 s. */
try {
  const { monitorEventLoopDelay } = require('perf_hooks');
  const loop = monitorEventLoopDelay({ resolution: 50 });
  loop.enable();
  setInterval(() => {
    const maxMs = loop.max / 1e6;
    if (maxMs >= 1500) {
      diag.count('principalTravou');
      errorLog.record({ source: 'principal', level: 'aviso', message: `O processo principal ficou travado por ${(maxMs / 1000).toFixed(1)} s`, context: { p99ms: Math.round(loop.percentile(99) / 1e6), trilha: trail.slice(-8) } });
    }
    loop.reset();
  }, 60000).unref?.();
} catch { /* sem perf_hooks: segue sem essa medida */ }
process.on('uncaughtException', (error) => { errorLog.record({ source: 'principal', message: error?.message || String(error), stack: error?.stack }); });
process.on('unhandledRejection', (reason) => { errorLog.record({ source: 'principal', message: reason?.message || String(reason), stack: reason?.stack }); });
app.on('render-process-gone', (_event, _contents, details) => { diag.count('telaFechou'); errorLog.record({ source: 'processo', message: `A tela do Nexo fechou sozinha (${details?.reason || 'motivo desconhecido'})`, context: { codigo: details?.exitCode } }); });
app.on('child-process-gone', (_event, details) => { if (details?.reason !== 'clean-exit') { diag.count(details?.type === 'GPU' ? 'gpuCaiu' : 'processoCaiu'); } if (details?.reason !== 'clean-exit') errorLog.record({ source: 'processo', level: details?.type === 'GPU' ? 'aviso' : 'erro', message: `Processo ${details?.type || '?'} do Nexo caiu (${details?.reason || 'motivo desconhecido'})`, context: { codigo: details?.exitCode, nome: details?.name } }); });
let updateDownloaded = false;
let updateAvailableVersion = null;
let updateDownloadInProgress = false;
let updateCheckInProgress = false;
let updateReleaseInfo = null;
let updateProgress = null;
const driveCache = { expiresAt: 0, value: null, pending: null };
const temperatureCache = { expiresAt: 0, value: null, pending: null };
let sensorHost = null;
let sensorRequestPending = null;
let sensorHostStatus = 'starting';

/** Saída do PowerShell em UTF-8: sem isso, nomes com acento (rótulos de disco, programas, planos) chegam quebrados. */
const PS_UTF8_OUTPUT = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ';
/** Nome curto do comando para o registro (o primeiro cmdlet do script): nunca o script inteiro. */
const scriptLabel = (script) => (/\b(?:Get|Set|Start|Stop|Invoke|New|Remove|Test|Optimize|Repair|Clear|Disable|Enable|Restart)-[A-Za-z]+/.exec(String(script)) || ['powershell'])[0];
/** PowerShell que estourou o prazo (o Windows matou o processo): é lentidão, vai para o registro. */
function notePowerShellTimeout(error, script, timeout) {
  if (!error?.killed && error?.signal !== 'SIGTERM') return;
  noteInterruption('powershell', `${scriptLabel(script)} passou de ${Math.round(timeout / 1000)} s e foi encerrado`, { comando: scriptLabel(script), prazoS: Math.round(timeout / 1000) }, 'aviso');
}
function runPowerShell(script, timeout = 15000) {
  if (process.platform !== 'win32') {
    throw new Error('Esta operação está disponível somente no Windows.');
  }

  return execFileAsync(systemTool('powershell.exe'), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    PS_UTF8_OUTPUT + script
  ], {
    windowsHide: true,
    timeout,
    maxBuffer: 2 * 1024 * 1024
  }).catch((error) => { notePowerShellTimeout(error, script, timeout); throw error; });
}

/** Igual ao runPowerShell, mas nunca lança: devolve { code, stdout } (o laboratório decide o que fazer com o código). */
function runPowerShellCode(script, timeout = 15000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ code: -1, stdout: '' }); return; }
    execFile(systemTool('powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS_UTF8_OUTPUT + script], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) notePowerShellTimeout(error, script, timeout);
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}
function runCode(file, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(systemTool(file), args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}

const linux = createLinux({ fs, path, os, run: (file, args) => runCode(file, args) });

function getCpuSample() {
  return os.cpus().reduce((sample, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    sample.total += total;
    sample.idle += cpu.times.idle;
    sample.cores.push([total, cpu.times.idle]);
    return sample;
  }, { total: 0, idle: 0, cores: [] });
}
/** Núcleo mais ocupado na última leitura (%): mostra jogo/programa preso numa thread mesmo com a CPU total baixa. */
let lastMaxCore = null;

// Leitura contínua: compara com a amostra anterior em vez de esperar 250 ms a cada chamada. Assim o painel pode ler
// a cada segundo sem custo extra (só a primeira chamada, ou uma depois de muito tempo parado, espera um pouco).
let lastCpuSample = null;
async function getCpuUsage() {
  const reusable = lastCpuSample && Date.now() - lastCpuSample.at >= 400 && Date.now() - lastCpuSample.at < 10000;
  const before = reusable ? lastCpuSample : { ...getCpuSample(), at: Date.now() };
  if (!reusable) await new Promise((resolve) => { setTimeout(resolve, 250); });
  const after = { ...getCpuSample(), at: Date.now() };
  lastCpuSample = after;
  const totalDelta = after.total - before.total;
  if (before.cores?.length === after.cores.length) {
    let busiest = 0;
    after.cores.forEach(([total, idle], index) => { const dt = total - before.cores[index][0]; if (dt > 0) busiest = Math.max(busiest, (1 - (idle - before.cores[index][1]) / dt) * 100); });
    lastMaxCore = Math.round(Math.max(0, Math.min(100, busiest)) * 10) / 10;
  }

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
    usedPercent: sizeBytes ? Math.round((usedBytes / sizeBytes) * 100) : 0,
    // Modelo do disco físico (para achar a temperatura do SSD nos sensores) e tipo de conexão.
    model: typeof item.model === 'string' && item.model.trim() ? item.model.trim().slice(0, 80) : null,
    bus: typeof item.bus === 'string' && item.bus ? item.bus.slice(0, 20) : null,
    media: typeof item.media === 'string' && item.media ? item.media.slice(0, 20) : null
  };
}

/* Letra → disco físico. Muda quase nunca e a consulta custa caro: fica guardada por 10 minutos e nunca atrasa a leitura. */
const DISK_MODEL_TTL_MS = 10 * 60 * 1000;
const diskModels = { value: null, at: 0, pending: null };

function refreshDiskModels() {
  if (process.platform !== 'win32' || diskModels.pending) return diskModels.pending;
  diskModels.pending = runPowerShellCode(DISK_MODEL_SCRIPT, 20000).then(({ stdout }) => {
    diskModels.value = parseDiskModels(stdout);
    diskModels.at = Date.now();
    return diskModels.value;
  }).finally(() => { diskModels.pending = null; });
  return diskModels.pending;
}
function cachedDiskModels() {
  if (!diskModels.value || Date.now() - diskModels.at > DISK_MODEL_TTL_MS) refreshDiskModels()?.catch(() => {});
  return diskModels.value || {};
}

async function listDrives() {
  if (IS_LINUX) return linux.drives();
  if (process.platform === 'win32') {
    const script = "$drives = Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object @{Name='letter';Expression={$_.DeviceID.Substring(0,1)}}, @{Name='label';Expression={$_.VolumeName}}, @{Name='fileSystem';Expression={$_.FileSystem}}, @{Name='sizeBytes';Expression={[double]$_.Size}}, @{Name='freeBytes';Expression={[double]$_.FreeSpace}}; $drives | ConvertTo-Json -Compress";
    const { stdout } = await runPowerShell(script);
    if (!stdout.trim()) return [];

    const result = JSON.parse(stdout);
    const models = cachedDiskModels();
    return (Array.isArray(result) ? result : [result]).map((item) => normalizeDrive({ ...item, ...(models[String(item.letter || '').toUpperCase()] || {}) }));
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

const NVIDIA_FULL_QUERY = 'temperature.gpu,utilization.gpu,memory.used,memory.total,clocks.gr,clocks.max.gr,power.draw,power.limit,clocks_throttle_reasons.active,utilization.memory';
let nvidiaQueryMode = null;
let nvidiaSmiFile; // undefined = ainda não procurado; null = este PC não tem o nvidia-smi
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
      // Consulta completa (clock, energia e o MOTIVO do clock baixo: limite de energia, calor…); driver antigo que não
      // conhece algum campo cai para a consulta básica, e o modo que funcionou fica guardado.
      if (nvidiaSmiFile === undefined) nvidiaSmiFile = nvidiaSmi();
      if (!nvidiaSmiFile) return [];
      const run = (fields) => execFileAsync(nvidiaSmiFile, [`--query-gpu=${fields}`, '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024 });
      const num = (value) => { const n = Number(String(value ?? '').trim()); return Number.isFinite(n) ? n : null; };
      try {
        let stdout = '';
        if (nvidiaQueryMode !== 'basic') {
          try { ({ stdout } = await run(NVIDIA_FULL_QUERY)); nvidiaQueryMode = 'full'; } catch (error) { if (error?.code === 'ENOENT') { throw error; } nvidiaQueryMode = 'basic'; }
        }
        if (nvidiaQueryMode === 'basic') ({ stdout } = await run('temperature.gpu,utilization.gpu,memory.used,memory.total'));
        return stdout.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
          const [temperature, usage, memoryUsed, memoryTotal, clock, clockMax, powerDraw, powerLimit, reasons, memUtil] = line.split(',');
          const reasonBits = /^0x[0-9a-f]+$/i.test(String(reasons || '').trim()) ? Number.parseInt(String(reasons).trim(), 16) : null;
          return {
            name: `GPU ${index + 1}`,
            temperatureCelsius: num(temperature),
            usagePercent: num(usage) === null ? null : Math.max(0, Math.min(100, num(usage))),
            memoryUsedMb: num(memoryUsed),
            memoryTotalMb: num(memoryTotal),
            clockMhz: num(clock), clockMaxMhz: num(clockMax), powerW: num(powerDraw), powerLimitW: num(powerLimit), memoryBusyPercent: num(memUtil),
            // Bits do nvidia-smi: 0x4 limite de energia (software), 0x8 desaceleração de hardware, 0x20/0x40 calor, 0x80 freio de energia.
            limits: reasonBits === null ? null : { power: Boolean(reasonBits & 0x4 || reasonBits & 0x80), thermal: Boolean(reasonBits & 0x20 || reasonBits & 0x40), hardware: Boolean(reasonBits & 0x8), idle: Boolean(reasonBits & 0x1) }
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
    noteInterruption('sensores', 'a leitura detalhada passou de 20 s e foi interrompida', { fonte: 'coletor' }, 'aviso');
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
    cpuMaxCore: lastMaxCore,
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
$programs = @($samples | Group-Object name | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_.Name
    count = [int]$_.Count
    cpuPercent = [Math]::Round([double](($_.Group | Measure-Object cpuPercent -Sum).Sum), 1)
    memoryBytes = [long](($_.Group | Measure-Object memoryBytes -Sum).Sum)
  }
})
$result = [pscustomobject]@{
  byCpu = @($samples | Sort-Object cpuPercent -Descending | Select-Object -First 5)
  byMemory = @($samples | Sort-Object memoryBytes -Descending | Select-Object -First 5)
  programsByCpu = @($programs | Sort-Object cpuPercent -Descending | Select-Object -First 8)
  programsByMemory = @($programs | Sort-Object memoryBytes -Descending | Select-Object -First 8)
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

  // Programas: todos os processos com o mesmo nome somados (o Chrome e o Discord abrem dezenas).
  const programs = (items) => normalize(items).map((item, index) => ({ ...item, processId: 0, count: Math.max(1, Number((Array.isArray(items) ? items : [items])[index]?.count) || 1) }));
  return {
    byCpu: normalize(result.byCpu),
    byMemory: normalize(result.byMemory),
    programsByCpu: programs(result.programsByCpu),
    programsByMemory: programs(result.programsByMemory)
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
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.senderFrame?.url !== trustedDocumentUrl) {
      throw new Error('Origem não autorizada para esta operação.');
    }
    const started = performance.now();
    let result;
    let failure = null;
    try { result = await handler(event, ...args); } catch (error) { failure = error || new Error('Falha sem detalhe.'); }
    // Instrumentação isolada: diag e registro nunca trocam o resultado (nem o erro original) da ação.
    const ms = performance.now() - started;
    diag.ipc(channel, ms, !failure);
    try {
      if (!/^(window|app:self-metrics|system:snapshot|sensors:snapshot|watch:current|session:sample)/.test(channel)) crumb('ipc', channel, `${failure ? 'falhou' : 'ok'} ${Math.round(ms)}ms`);
      if (ms > (SLOW_IPC_MS[channel] ?? 30000)) noteSlowIpc(channel, ms);
    } catch { /* instrumentação nunca atrapalha */ }
    if (failure) {
      // Falha de uma ação: aviso quando é esperada (recusar o UAC, cancelar, sem rede); ERRO quando é bug nosso
      // (TypeError e afins) — esse vai para o painel. A tela recebe o erro original igual.
      try { errorLog.record({ source: 'ipc', level: isBug(failure) ? 'erro' : 'aviso', message: failure?.message || String(failure), stack: failure?.stack, context: { acao: channel, ms: Math.round(ms) } }); } catch { /* registro indisponível */ }
      throw failure;
    }
    return result;
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
autoUpdater.on('error', (error) => { noteInterruption('atualizacao', error?.message || error, { versao: updateAvailableVersion || null }, 'aviso'); });
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
  // Travada da tela: registra quanto tempo durou (quando ela volta) e o que vinha acontecendo antes.
  let frozenAt = 0;
  mainWindow.on('unresponsive', () => { diag.count('janelaTravou'); frozenAt = Date.now(); crumb('tela', 'travou'); });
  mainWindow.on('responsive', () => {
    if (!frozenAt) return;
    const seconds = Math.round((Date.now() - frozenAt) / 1000);
    frozenAt = 0;
    errorLog.record({ source: 'interface', level: seconds >= 10 ? 'erro' : 'aviso', message: `A janela do Nexo parou de responder por ${seconds} s`, context: { tela: 'janela', segundos: seconds, trilha: trail.slice(-10) } });
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => { if (isMainFrame) errorLog.record({ source: 'interface', message: `A tela não carregou (${code} ${description})`, context: { codigo: code, principal: Boolean(isMainFrame), alvo: String(url || '').startsWith('file:') ? 'arquivo do app' : 'outro' } }); });
  mainWindow.webContents.on('preload-error', (_event, _path, error) => errorLog.record({ source: 'interface', message: `Falha no preload: ${error?.message || error}`, stack: error?.stack }));
  mainWindow.on('maximize', publishWindowState);
  mainWindow.on('unmaximize', publishWindowState);
  mainWindow.loadURL(trustedDocumentUrl);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Registro de erros: a interface manda os erros dela; a tela de Ajustes lista, copia, abre a pasta e limpa.
ipcMain.on('log:report', (event, payload) => {
  if (event.senderFrame?.url !== trustedDocumentUrl || !payload || typeof payload !== 'object') return;
  errorLog.record({ source: 'interface', level: payload.level === 'aviso' ? 'aviso' : 'erro', message: String(payload.message || '').slice(0, 600), stack: String(payload.stack || '').slice(0, 4000), context: payload.context && typeof payload.context === 'object' ? payload.context : undefined });
});
// Trilha vinda da tela: troca de tela e ações com nome fixo (nada digitado).
ipcMain.on('log:crumb', (event, payload) => {
  if (event.senderFrame?.url !== trustedDocumentUrl || !payload || typeof payload !== 'object') return;
  const kind = /^[a-z]{2,10}$/.test(String(payload.kind)) ? payload.kind : 'tela';
  const name = String(payload.name || '').replace(/[^\w.:-]/g, '').slice(0, 40);
  if (name) crumb(kind, name);
});
registerIpcHandler('log:list', async (_event, options) => errorLog.list({ limit: Math.min(500, Number(options?.limit) || 100) }));
registerIpcHandler('log:export', async () => errorLog.exportText());
registerIpcHandler('log:clear', async () => errorLog.clear());
registerIpcHandler('log:open-folder', async () => { await fs.mkdir(errorLog.dir, { recursive: true }); const problem = await shell.openPath(errorLog.dir); return { ok: !problem }; });

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
    const taskManager = spawn(systemTool('taskmgr'), [], { detached: true, stdio: 'ignore' });
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
  const { stdout } = await execFileAsync(systemTool('powercfg'), ['/list'], { windowsHide: true, timeout: 10000, encoding: 'buffer' }).catch(() => ({ stdout: Buffer.alloc(0) }));
  return LabParsers.parseList(decodeConsole(stdout)).filter((plan) => GUID_PATTERN.test(plan.guid)).map((plan) => ({ ...plan, name: KNOWN_PLANS[plan.guid] || plan.name }));
}

registerIpcHandler('power:list', async () => (IS_LINUX ? linux.powerProfiles() : listPowerPlans()));

registerIpcHandler('power:set', async (_event, guid) => {
  if (labState.running) throw new Error('O laboratório está usando o plano de energia agora; espere ele terminar.');
  if (IS_LINUX) { await linux.setPowerProfile(String(guid)); return { ok: true, plans: await linux.powerProfiles() }; }
  const plans = await listPowerPlans();
  const target = plans.find((plan) => plan.guid === String(guid || '').toLowerCase());
  if (!target) throw new Error('Plano de energia não reconhecido.');
  await execFileAsync(systemTool('powercfg'), ['/setactive', target.guid], { windowsHide: true, timeout: 10000 });
  return { ok: true, plans: await listPowerPlans() };
});

async function listStartupItems() {
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
}
registerIpcHandler('startup:list', listStartupItems);

/*
 * Trabalhos de medição em arquivos próprios (electron/workers/*.cjs), nunca código montado em texto (nada de eval).
 * Ficam fora do app.asar (asarUnpack no package.json) porque o worker_threads lê o arquivo direto do disco.
 */
const workerFile = (name) => path.join(__dirname, 'electron', 'workers', name).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
// ---- Benchmark curto de CPU (experimento A/B do plano de energia) ----
// Carga determinística de inteiros; mede iterações por segundo em cada worker. Sempre iniciado pelo usuário.
const BENCH_WORKER = workerFile('bench.cjs');
// Rajadas: 30 ms de trabalho depois de 70 ms parado, repetido. Mede o quão rápido o processador "acorda" e acelera,
// que é o que planos e políticas de energia mais mudam (resposta a cliques, carregamentos curtos, quadros irregulares).
const BURST_WORKER = workerFile('burst.cjs');
/*
 * Latência para acordar um núcleo: um trabalhador dorme (Atomics.wait sem prazo) e o outro o acorda depois de uma pausa
 * de 0,5 a 3 ms, medindo a ida e volta no próprio relógio. Isso é o que estados ociosos, estacionamento de núcleos e
 * dicas de latência mudam (e não depende da resolução do timer do Windows, porque o acordar vem de um aviso, não do relógio).
 * Pontuação: quanto maior, mais rápido (1.000.000 / média do percentil 50 e 90 em µs).
 */
const LATENCY_WORKER = workerFile('latency.cjs');
/*
 * Disco: gravações de 4 KB com fsync (a gravação só termina quando o disco confirma) num arquivo de 4 MB do próprio
 * laboratório, com pausas de 3, 30 e 150 ms entre elas, para o SSD/link ter tempo de entrar em economia. Mede o que as
 * opções de energia de SATA, NVMe e PCI Express mudam: o atraso da primeira operação depois de uma pausa.
 * Pontuação: 1.000.000 / média em µs. O arquivo é apagado no fim da sessão.
 */
const DISK_WORKER = workerFile('disk.cjs');
/*
 * Ritmo de quadros: simula um jogo a 60 quadros por segundo. Cada quadro faz a mesma quantidade de trabalho e depois
 * espera o próximo quadro (o processador fica livre e pode baixar a frequência, como num jogo de verdade).
 * Pontuação: 1000 / percentil 95 do tempo de trabalho por quadro em ms (os quadros lentos é que dão engasgo).
 */
const FRAMES_WORKER = workerFile('frames.cjs');
/* Precisão do timer: pede para dormir 1 ms e mede quanto passou de verdade. Pontuação: 1000 / (atraso médio + p95) em ms. */
const TIMER_WORKER = workerFile('timer.cjs');
/* Latência da memória: percorre 32 MB em ordem aleatória (cada leitura depende da anterior, sem ajuda do cache). Pontuação: leituras por µs. */
const MEMORY_WORKER = workerFile('memory.cjs');
let activeBench = null;
let framesWork = 0;

/* Rede: o tempo para abrir uma conexão com o próprio roteador (só rede local, IP privado), com pausas entre as tentativas
   para o Wi-Fi poder cochilar. Nada sai da sua casa: é o roteador respondendo. */
const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}(\.\d{1,3})?$/;
let gatewayProbe = null;
async function findGateway() {
  if (gatewayProbe) return gatewayProbe;
  gatewayProbe = (async () => {
    if (process.platform !== 'win32') return null;
    const result = await runCode('route', ['print', '-4', '0.0.0.0']).catch(() => ({ stdout: '' }));
    const line = String(result.stdout).split(/\r?\n/).map((row) => row.trim().split(/\s+/)).find((cols) => cols[0] === '0.0.0.0' && cols[1] === '0.0.0.0' && PRIVATE_IP.test(cols[2] || ''));
    if (!line) return null;
    for (const port of [80, 443, 53]) if (Number.isFinite(await connectTime(line[2], port))) return { host: line[2], port };
    return null;
  })();
  const found = await gatewayProbe;
  if (!found) gatewayProbe = null; // sem roteador agora: tenta de novo na próxima vez
  return found;
}
function connectTime(host, port) {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = nodeNet.connect({ host, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(800, () => done(null));
    socket.once('connect', () => done((performance.now() - start) * 1000));
    socket.once('error', () => done(null));
  });
}

function runWorker(source, workerData, state) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { workerData });
    state.workers.push(worker);
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', () => { if (state.cancelled) reject(new Error('Teste cancelado.')); });
  });
}

/** Testes extras do laboratório. A pontuação segue a regra dos outros: maior é melhor. */
async function runLabBench(mode, ms) {
  if (!['latency', 'disk', 'frames', 'timer', 'memory', 'network'].includes(mode)) return runCpuBench(mode, ms);
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
    if (mode === 'frames') {
      // Trabalho fixo por quadro (~5 ms neste PC): calibrado uma vez e igual em todas as medições da sessão.
      if (!framesWork) framesWork = Math.max(20000, Math.round((await runWorker(FRAMES_WORKER, { calibrate: true }, state)).perMs * 5));
      const result = await runWorker(FRAMES_WORKER, { ms, work: framesWork }, state);
      return { mode, threads: 1, ms, mopsPerSec: 1000 / Math.max(0.01, result.p95), detail: result };
    }
    if (mode === 'timer') {
      const result = await runWorker(TIMER_WORKER, { ms }, state);
      return { mode, threads: 1, ms, mopsPerSec: 1000 / Math.max(0.01, result.meanMs + result.p95), detail: result };
    }
    if (mode === 'memory') {
      const result = await runWorker(MEMORY_WORKER, { ms }, state);
      return { mode, threads: 1, ms, mopsPerSec: result.readsPerUs, detail: result };
    }
    if (mode === 'network') {
      const target = await findGateway();
      if (!target) throw new Error('Sem roteador na rede local para medir.');
      const times = [];
      const end = performance.now() + ms;
      while (performance.now() < end && !state.cancelled) {
        const value = await connectTime(target.host, target.port);
        if (Number.isFinite(value)) times.push(value);
        await new Promise((resolve) => { setTimeout(resolve, 120); });
      }
      times.sort((a, b) => a - b);
      if (times.length < 3) throw new Error('O roteador parou de responder.');
      const p50 = times[Math.floor(times.length / 2)];
      const p90 = times[Math.min(times.length - 1, Math.floor(times.length * 0.9))];
      return { mode, threads: 0, ms, mopsPerSec: 1e6 / Math.max(1, (p50 + p90) / 2), detail: { samples: times.length, p50, p90 } };
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
      const worker = new Worker(mode === 'burst' ? BURST_WORKER : BENCH_WORKER, { workerData: { ms } });
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
const probeMatch = Object.assign((exePath) => library.matchPath(exePath), { byName: (name) => library.matchName(name) });
const probe = IS_LINUX ? createLinuxProbe({ linux, emit: (sample) => sendToWindow('session:probe', sample), match: probeMatch }) : createProbe({ emit: (sample) => sendToWindow('session:probe', sample), match: probeMatch });
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
  gamemode: 'ms-settings:gaming-gamemode', display: 'ms-settings:display-advanced', captures: 'ms-settings:gaming-gamedvr', recovery: 'ms-settings:recovery', coreisolation: 'windowsdefender://coreisolation',
  windowsupdate: 'ms-settings:windowsupdate' };
registerIpcHandler('system:open-settings', async (_event, page) => {
  if (IS_LINUX) throw new Error('Esta tela é das Configurações do Windows; no Linux, use as configurações do seu ambiente (GNOME, KDE…).');
  const uri = Object.hasOwn(SETTINGS_PAGES, String(page)) ? SETTINGS_PAGES[page] : null;
  if (!uri) throw new Error('Página de configurações não permitida.');
  await shell.openExternal(uri);
  return { ok: true };
});

/**
 * Links externos conferidos pela API de URL (não só por regex): https, sem usuário/senha nem porta, host exatamente
 * igual a um da lista. Devolve o endereço normalizado que vai para o navegador, ou null.
 */
function safeExternalUrl(value, hosts) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!hosts.includes(url.hostname.toLowerCase())) return null;
  return url.href;
}
const DOC_HOSTS = ['learn.microsoft.com', 'support.microsoft.com'];
const STORE_HOSTS = ['store.steampowered.com', 'steamcommunity.com', 'steamstore-a.akamaihd.net'];
registerIpcHandler('app:open-doc', async (_event, url) => {
  const safe = safeExternalUrl(url, DOC_HOSTS);
  if (!safe) throw new Error('Link não permitido.');
  await shell.openExternal(safe);
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
  const url = Object.hasOwn(EXTERNAL_LINKS, String(key)) ? EXTERNAL_LINKS[key] : null;
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
/** A caixa "Ajudar a melhorar o Nexo" do instalador (Windows) ou a escolha guardada (Linux). */
async function readSharePreference() {
  if (IS_LINUX) { try { return { shareWithCreator: JSON.parse(await fs.readFile(PRIVACY_FILE(), 'utf8')).shareWithCreator === true }; } catch { return { shareWithCreator: false }; } }
  if (process.platform !== 'win32') return { shareWithCreator: false };
  try {
    const { stdout } = await execFileAsync(systemTool('reg'), ['query', PRIVACY_KEY, '/v', 'DeveloperTelemetryOptIn'], { windowsHide: true, timeout: 5000 });
    return { shareWithCreator: /0x1\b/i.test(stdout) };
  } catch { return { shareWithCreator: false }; }
}
async function writeSharePreference(enabled) {
  if (IS_LINUX) { await fs.writeFile(PRIVACY_FILE(), JSON.stringify({ shareWithCreator: Boolean(enabled) }), 'utf8'); return { shareWithCreator: Boolean(enabled) }; }
  if (process.platform !== 'win32') return { shareWithCreator: false };
  await execFileAsync(systemTool('reg'), ['add', PRIVACY_KEY, '/v', 'DeveloperTelemetryOptIn', '/t', 'REG_DWORD', '/d', enabled ? '1' : '0', '/f'], { windowsHide: true, timeout: 5000 });
  return { shareWithCreator: Boolean(enabled) };
}
registerIpcHandler('privacy:get', async () => readSharePreference());
registerIpcHandler('privacy:set', async (_event, enabled) => writeSharePreference(enabled));

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
  if (settings.autoSession) { if (!library.list().length) { await library.scan().catch(() => []); } watcher.start(); } else watcher.stop();
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
async function readSystemFacts() {
  if (IS_LINUX) {
    const [profiles, mangohud, gamemode, governor] = await Promise.all([linux.powerProfiles(), linux.which('mangohud'), linux.which('gamemoded'), fs.readFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'utf8').then((text) => text.trim()).catch(() => null)]);
    return { platform: 'linux', session: process.env.XDG_SESSION_TYPE || null, kernel: os.release(), powerProfile: profiles.find((profile) => profile.active)?.guid || null, ppd: profiles.length > 0, mangohud, gamemode, governor };
  }
  if (process.platform !== 'win32') return { platform: process.platform };
  const result = await runPowerShellCode(FACTS_SCRIPT, 20000);
  try { return { platform: 'win32', ...JSON.parse(result.stdout) }; } catch { return { platform: 'win32' }; }
}
registerIpcHandler('system:facts', readSystemFacts);

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
  downscale: async (source, target, width) => { const data = shrink(nativeImage.createFromPath(source), width, target.endsWith('.png')); if (!data) { return false; } await fs.writeFile(target, data); return true; },
  resolveOnline: (game) => covers.resolve(game),
  extras: async (steamRoot) => {
    const out = { xboxTitles: connections.xbox?.titles || [] };
    const steam = connections.steam;
    if (steam?.steamId) {
      out.steamPlaytime = await steamAccount.playtime(steamRoot, steam.steamId);
      const fresh = ownedCache.key === steam.steamId && Date.now() - ownedCache.at < 6 * 3600 * 1000;
      if (steam.apiKey) {
        if (!fresh) ownedCache = { at: Date.now(), key: steam.steamId, games: await steamAccount.ownedGames(steam.apiKey, steam.steamId).catch(() => ownedCache.games) };
        out.steamOwned = ownedCache.games;
      } else if (steam.pass) {
        // Entrou com a Steam: os jogos da conta vêm pelo servidor do Nexo (chave do criador), sem chave da pessoa.
        if (!fresh) ownedCache = { at: Date.now(), key: steam.steamId, games: await steamServerLibrary().catch(() => (ownedCache.key === steam.steamId ? ownedCache.games : [])) };
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
    game.source === 'steam' ? steamDetails.achievements(appid, steam?.steamId, steam?.apiKey, steam?.pass ? (id) => steamServer(`/v1/steam/achievements?appid=${id}`) : null).catch(() => ({ state: 'error', unlocked: 0, total: 0, list: [] })) : Promise.resolve({ state: 'other-store', unlocked: 0, total: 0, list: [] })
  ]);
  return { consent: true, appid, matched, store, news, achievements };
});
const STORE_URL = /^https:\/\/(store\.steampowered\.com|steamcommunity\.com|steamstore-a\.akamaihd\.net)\/[\w\-./?=&%#:]*$/;
registerIpcHandler('app:open-store-url', async (_event, url) => {
  const safe = typeof url === 'string' && STORE_URL.test(url) ? safeExternalUrl(url, STORE_HOSTS) : null;
  if (!safe) throw new Error('Link não permitido.');
  await shell.openExternal(safe);
  return { ok: true };
});
registerIpcHandler('games:list', async () => coverUrl(library.list()));
const LAUNCH_SCHEMES = /^(steam:\/\/(rungameid|install)\/\d+|com\.epicgames\.launcher:\/\/apps\/[\w%.-]+\?action=launch&silent=true|uplay:\/\/launch\/\d+\/0)$/;
registerIpcHandler('games:launch', async (_event, id) => {
  const game = library.get(String(id));
  if (!game) throw new Error('Jogo não encontrado; atualize a biblioteca.');
  if (game.launchUri && LAUNCH_SCHEMES.test(game.launchUri)) { await shell.openExternal(game.launchUri); return { ok: true, via: 'launcher' }; }
  if (game.exe && /\.exe$/i.test(game.exe) && await isFile(game.exe)) { const error = await shell.openPath(game.exe); if (error) { throw new Error(error); } return { ok: true, via: 'executável' }; }
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
// Jogo pelo caminho; sem caminho (anticheat, loja), pelo nome do processo conhecido da biblioteca.
const matchGame = Object.assign((exePath) => library.matchPath(exePath), { byName: (name) => library.matchName(name) });
const watcher = (IS_LINUX ? (options) => createLinuxWatcher({ linux, ...options }) : createWatcher)({
  match: matchGame,
  onProblem: (kind, reason) => noteInterruption('observador-de-jogos', `${kind}: ${reason}`, { motivo: kind }, kind === 'desistiu' ? 'erro' : 'aviso'),
  onStart: (game) => {
    sendToWindow('watch:game', { type: 'start', name: game.name, gameId: game.gameId, pid: game.pid });
    if (!mainWindow?.isVisible() && Notification.isSupported()) new Notification({ title: `Gravando a sessão de ${game.name}`, body: 'O Nexo começou a observar o desempenho. O relatório fica pronto quando o jogo fechar.', icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  },
  onEnd: (game) => sendToWindow('watch:game', { type: 'end', name: game.name, gameId: game.gameId, pid: game.pid })
});
registerIpcHandler('watch:current', async () => watcher.current());

// ---- Laboratório (Otimização extrema, beta) ----
/**
 * Maior temperatura do processador nas leituras do LibreHardwareMonitor. Ficam de fora os sensores que não são
 * leitura de temperatura: limites e distâncias ("Tj Max", "Distance to TjMax", "warning", "critical", "shutdown").
 */
function maxTemperature(readings) {
  const values = [];
  for (const device of readings?.devices || []) {
    if (!/cpu/i.test(String(device.type))) continue;
    for (const sensor of device.sensors || []) if (sensor.type === 'Temperature' && Number.isFinite(sensor.value) && sensor.value > 5 && sensor.value < 125 && !/warning|critical|limit|threshold|shutdown|t\s*j\s*max/i.test(String(sensor.name || ''))) values.push(sensor.value);
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
const LAB_BENCH_MS = { disk: 2400, network: 2400, frames: 1500, memory: 1000 };
const labBench = (mode) => runLabBench(mode, LAB_BENCH_MS[mode] || 1200);
const labBenchSupport = async () => ({ network: Boolean(await findGateway().catch(() => null)) });
const labSystem = IS_LINUX ? createLinuxLabSystem({ linux, run: runCode, bench: (mode) => runCpuBench(['single', 'multi', 'burst'].includes(mode) ? mode : 'burst', 1200), readTemp: () => readCpuTemperature(), cpuLoad: getCpuUsage, onBattery: async () => Boolean(powerMonitor?.isOnBatteryPower?.()), fs, path, dir: path.join(app.getPath('userData'), 'lab') }) : createLabSystem({
  run: runCode, runPowerShell: runPowerShellCode,
  bench: labBench, isHybrid: isHybridCpu, benchSupport: labBenchSupport,
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
  if (await rebootTest.active()) throw new Error('Há um teste com reinício em andamento; termine ou cancele ele antes (as medidas se misturariam).');
  if (activeBench) throw new Error('Há um teste de desempenho em andamento.');
  if (deepAnalysis.isRunning()) throw new Error('A análise profunda está rodando; espere ela terminar.');
  const memory = NexoLab.sanitizeMemory(options?.evidence, options?.tabu);
  labState.running = true;
  labState.signal = { cancelled: false };
  try {
    const result = await NexoLab.run(labSystem, {
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
    // Guardas e falhas do laboratório vão para o registro (cancelar pela pessoa, não).
    if (result.status === 'aborted') noteInterruption('laboratorio', result.reason, { guarda: result.guard || 'erro', ajustes: result.arms.length, aquecimento: result.thermal?.idle ?? null, referencia: Math.max(0, ...Object.values(result.thermal?.reference || {}).filter(Number.isFinite)) || null });
    if (result.restoreFailed) noteInterruption('laboratorio', 'não consegui voltar ao plano de energia original (a recuperação tenta de novo na próxima abertura)', { etapa: 'restaurar' });
    if (result.noisy) crumb('lab', 'medicoes-ruidosas', String(result.noisy));
    return result;
  } finally { labState.running = false; labState.signal = null; }
});
// ---- Análise profunda: 7 etapas, no mínimo 60 s, tudo somente leitura (electron/deep-run.cjs) ----
const NexoSessionRules = require('./src/session.js');
const DeepScan = require('./electron/deep-scan.cjs');
const { createDeepAnalysis, createLinuxSystemReader } = require('./electron/deep-run.cjs');
const DEEP_FILE = () => path.join(app.getPath('userData'), 'analise-profunda.json');
/** nvidia-smi com a placa acordada: link PCIe (atual, o da placa e o do slot), clock, energia, motivo do clock baixo e BAR1. */
async function deepNvidia() {
  if (nvidiaSmiFile === undefined) nvidiaSmiFile = nvidiaSmi();
  if (!nvidiaSmiFile) return [];
  const query = (fields) => execFileAsync(nvidiaSmiFile, [`--query-gpu=${fields}`, '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 }).then((out) => String(out.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((cell) => cell.trim()))).catch(() => []);
  const value = (cell) => { const n = Number(cell); return Number.isFinite(n) ? n : null; };
  const [main, extra, memory] = await Promise.all([
    query('pcie.link.gen.current,pcie.link.gen.max,pcie.link.width.current,pcie.link.width.max,clocks.gr,clocks.max.gr,temperature.gpu,power.draw,power.limit,clocks_throttle_reasons.active,memory.total'),
    query('pcie.link.gen.gpumax,pcie.link.gen.hostmax'),
    execFileAsync(nvidiaSmiFile, ['-q', '-d', 'MEMORY'], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 }).then((out) => String(out.stdout || '')).catch(() => '')
  ]);
  const bar1 = DeepScan.parseBar1(memory);
  return main.map((cells, index) => {
    const bits = /^0x[0-9a-f]+$/i.test(cells[9] || '') ? Number.parseInt(cells[9], 16) : null;
    return {
      pcieGen: value(cells[0]), pcieGenSlotMax: value(cells[1]), pcieWidth: value(cells[2]), pcieWidthMax: value(cells[3]), clock: value(cells[4]), clockMax: value(cells[5]), temp: value(cells[6]), power: value(cells[7]), powerLimit: value(cells[8]),
      limits: bits === null ? null : { power: Boolean(bits & 0x4 || bits & 0x80), thermal: Boolean(bits & 0x20 || bits & 0x40), hardware: Boolean(bits & 0x8) },
      vramMB: value(cells[10]), pcieGenMax: value(extra[index]?.[0]), pcieGenHostMax: value(extra[index]?.[1]) ?? value(cells[1]), bar1MB: index === 0 ? bar1 : null
    };
  });
}
const deepAnalysis = createDeepAnalysis({
  platform: process.platform, runPowerShellCode, spawnFn: spawn,
  linuxCollector: IS_LINUX ? DeepScan.createLinuxCollector({ fs, path, os, run: (file, args) => runCode(file, args) }) : null,
  linuxProcesses: IS_LINUX ? () => linux.processSample() : null,
  linuxSystem: IS_LINUX ? createLinuxSystemReader({ fs }) : null,
  sensors: () => getHardwareSensors(), nvidia: deepNvidia,
  bench: (mode, ms) => runCpuBench(mode, ms),
  cancelBench: () => { if (activeBench) { activeBench.cancelled = true; for (const worker of activeBench.workers) worker.terminate(); } },
  facts: readSystemFacts, startup: listStartupItems, drives: listDrives,
  screenDisplays: () => { try { return require('electron').screen.getAllDisplays().map((display) => ({ hz: Math.round(display.displayFrequency || 0) || null, width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor), internal: display.internal === true })); } catch { return []; } },
  selfPids: () => new Set([process.pid, ...(typeof app.getAppMetrics === 'function' ? app.getAppMetrics().map((metric) => metric.pid) : []), probe.pid?.()].filter(Boolean)),
  match: (exePath) => library.matchPath(exePath), classify: NexoSessionRules.classifyForeground,
  onBattery: () => Boolean(powerMonitor?.isOnBatteryPower?.()),
  gpuWake: (ms) => sendToWindow('analysis:gpu-wake', { ms }),
  emit: (progress) => sendToWindow('analysis:progress', progress),
  memoryTotal: () => os.totalmem(),
  store: {
    load: async () => JSON.parse(await fs.readFile(DEEP_FILE(), 'utf8')),
    save: async (data) => { const file = DEEP_FILE(); await fs.writeFile(`${file}.tmp`, JSON.stringify(data)); await fs.rename(`${file}.tmp`, file); }
  }
});
registerIpcHandler('analysis:deep-run', async () => {
  if (labState.running) throw new Error('O laboratório está medindo agora; espere ele terminar.');
  if (activeBench) throw new Error('Há um teste de desempenho em andamento; espere ele terminar.');
  if (await rebootTest.active()) throw new Error('Há um teste com reinício em andamento; termine ou cancele ele antes (as medidas se misturariam).');
  const result = await deepAnalysis.run();
  crumb('analise', result?.cancelled ? 'profunda-cancelada' : 'profunda', result?.findings ? String(result.findings.length) : '');
  return result;
});
registerIpcHandler('analysis:deep-cancel', async () => deepAnalysis.cancel());
registerIpcHandler('analysis:deep-status', async () => deepAnalysis.status());
registerIpcHandler('analysis:deep-last', async () => deepAnalysis.last());

// ---- Diagnóstico de rede ("a internet está boa, mas os sites demoram") ----
const NetDoctor = require('./electron/net-doctor.cjs');
const netDoctor = NetDoctor.createNetDoctor({
  dns: require('dns'), net: nodeNet, https: require('https'), os, fs, platform: process.platform, runPowerShell: runPowerShellCode,
  resolveProxy: (url) => { try { return require('electron').session.defaultSession.resolveProxy(url); } catch { return Promise.resolve(null); } }
});
let netBusy = false;
registerIpcHandler('net:diagnose', async () => {
  if (netBusy) throw new Error('O diagnóstico de rede já está rodando.');
  netBusy = true;
  try {
    const measured = await netDoctor.measure();
    const result = NetDoctor.analyze(measured);
    const info = measured.info || {};
    return { ...result, at: Date.now(), platform: process.platform,
      context: { ifIndex: Number(info.ifIndex) || null, adapter: info.adapter?.name || null, dnsV4: (info.dnsV4 || []).slice(0, 4), staticDns: [...(info.staticV4 || []), ...(info.staticV6 || [])].slice(0, 6), disabledComponents: info.disabledComponents ?? null, proxyEnable: info.proxyEnable ?? null, proxyServer: info.proxyServer || null, autoDetect: info.autoDetect ?? null } };
  } finally { netBusy = false; }
});
const INTERNET_SETTINGS = String.raw`HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings`;
/** Liga ou desliga o bit "Detectar configurações automaticamente" (byte 8, valor 8) do DefaultConnectionSettings. */
const autoDetectScript = (on) => String.raw`
$k = '${INTERNET_SETTINGS}\Connections'
$b = (Get-ItemProperty -LiteralPath $k -Name DefaultConnectionSettings -ErrorAction Stop).DefaultConnectionSettings
if ($b.Length -le 8) { throw 'formato desconhecido' }
$b[8] = if (${on ? '$true' : '$false'}) { $b[8] -bor 8 } else { $b[8] -band (255 -bxor 8) }
$b[4] = [byte](($b[4] + 1) % 256)
Set-ItemProperty -LiteralPath $k -Name DefaultConnectionSettings -Value ([byte[]]$b) -ErrorAction Stop
'ok'`;
registerIpcHandler('net:fix', async (_event, request) => {
  const id = String(request?.id || '');
  if (labState.running) throw new Error('O laboratório está medindo agora; espere ele terminar.');
  const windowsOnly = ['dns-publico', 'dns-voltar', 'preferir-ipv4', 'ipv4-voltar', 'desligar-proxy', 'proxy-voltar', 'desligar-autodetect', 'autodetect-voltar', 'abrir-proxy', 'reparo-profundo'];
  if (process.platform !== 'win32' && windowsOnly.includes(id)) throw new Error('Esta correção é só para Windows.');
  const declined = (answer) => (answer.declined ? { declined: true } : null);
  if (id === 'limpar-dns') {
    if (process.platform === 'win32') {
      const plain = await runCode('ipconfig.exe', ['/flushdns'], 20000);
      if (plain.code === 0) return { ok: true };
      const answer = await elevate('net-flush', {});
      return declined(answer) || { ok: Boolean(answer.result?.ok), note: answer.result?.note || '' };
    }
    const flushed = await runCode('resolvectl', ['flush-caches'], 20000);
    return { ok: flushed.code === 0, note: flushed.code === 0 ? '' : 'Este Linux não tem um cache de DNS do sistema para limpar (ou ele pede senha).' };
  }
  if (id === 'abrir-proxy') { await shell.openExternal('ms-settings:network-proxy'); return { ok: true }; }
  if (id === 'dns-publico') {
    const provider = NetDoctor.PUBLIC[request?.provider] ? request.provider : 'cloudflare';
    const info = await netDoctor.systemInfo();
    const ifIndex = Number(info.ifIndex);
    if (!ifIndex) throw new Error('Não achei a placa de rede que leva à internet.');
    const before = { ifIndex, adapter: info.adapter?.name || null, dhcp: !(info.staticV4 || []).length && !(info.staticV6 || []).length, servers: [...(info.staticV4 || []), ...(info.staticV6 || [])].slice(0, 6) };
    const servers = [...NetDoctor.PUBLIC[provider].v4, ...NetDoctor.PUBLIC[provider].v6];
    const answer = await elevate('net-dns', { ifIndex, servers });
    if (answer.declined) return { declined: true };
    if (!answer.result?.ok) throw new Error(answer.result?.note || 'O Windows não aceitou trocar o DNS.');
    return { ok: true, before, after: { provider, label: NetDoctor.PUBLIC[provider].label, servers } };
  }
  if (id === 'dns-voltar') {
    const before = request?.before || {};
    const ifIndex = Number(before.ifIndex);
    const servers = Array.isArray(before.servers) ? before.servers.map(String).filter((ip) => nodeNet.isIP(ip)).slice(0, 6) : [];
    const answer = await elevate('net-dns', before.dhcp || !servers.length ? { ifIndex, reset: true } : { ifIndex, servers });
    if (answer.declined) return { declined: true };
    if (!answer.result?.ok) throw new Error(answer.result?.note || 'O Windows não aceitou voltar o DNS.');
    return { ok: true };
  }
  if (id === 'preferir-ipv4' || id === 'ipv4-voltar') {
    const info = await netDoctor.systemInfo();
    const current = Number.isInteger(info.disabledComponents) ? info.disabledComponents : null;
    const value = id === 'preferir-ipv4' ? ((current || 0) | 0x20) : (request?.before?.value === null || request?.before?.value === undefined ? null : Number(request.before.value));
    const answer = await elevate('net-ipv6', { value });
    if (answer.declined) return { declined: true };
    if (!answer.result?.ok) throw new Error(answer.result?.note || 'O Windows não aceitou a mudança.');
    return { ok: true, restart: true, before: { value: current }, after: { value } };
  }
  if (id === 'desligar-proxy' || id === 'proxy-voltar') {
    const on = id === 'proxy-voltar';
    const result = await runPowerShellCode(`Set-ItemProperty -LiteralPath '${INTERNET_SETTINGS}' -Name ProxyEnable -Value ${on ? 1 : 0} -ErrorAction Stop; 'ok'`, 15000);
    if (!/ok/.test(result.stdout)) throw new Error('O Windows não aceitou a mudança do proxy.');
    return { ok: true, before: { proxyEnable: on ? 0 : 1 }, after: { proxyEnable: on ? 1 : 0 } };
  }
  if (id === 'desligar-autodetect' || id === 'autodetect-voltar') {
    const on = id === 'autodetect-voltar';
    const result = await runPowerShellCode(autoDetectScript(on), 15000);
    if (!/ok/.test(result.stdout)) throw new Error('O Windows não aceitou a mudança da detecção de proxy.');
    return { ok: true, before: { autoDetect: !on }, after: { autoDetect: on } };
  }
  if (id === 'reparo-profundo') {
    const answer = await elevate('net-reset', {});
    if (answer.declined) return { declined: true };
    return { ok: Boolean(answer.result?.ok), restart: true, note: answer.result?.note || '' };
  }
  throw new Error('Correção desconhecida.');
});
// ---- Raio-X do PC (registro e sistema) ----
const systemScan = createSystemScan({ runPowerShell: runPowerShellCode, run: runCode, elevate: (task, args) => elevate(task, args) });
registerIpcHandler('scan:run', async () => systemScan.scan());
registerIpcHandler('scan:apply', async (_event, changes) => {
  if (labState.running) throw new Error('O laboratório está medindo agora; espere ele terminar.');
  if (await rebootTest.active()) throw new Error('Há um teste com reinício em andamento; termine ou cancele ele antes de mudar outros ajustes.');
  const clean = (Array.isArray(changes) ? changes : []).slice(0, 160).map((change) => ({
    id: String(change?.id || '').slice(0, 48),
    values: Array.isArray(change?.values) ? change.values.slice(0, 8).map((value) => (value === null || typeof value === 'number' || typeof value === 'string' ? value : undefined)) : [],
    revert: change?.revert === true
  }));
  return systemScan.apply(clean);
});
// ---- Teste com reinício (mede A/B atravessando reinícios; troca os valores pelo Raio-X) ----
const rebootTest = createRebootTest({
  fs, path, dir: path.join(app.getPath('userData'), 'reboot-test'),
  run: runCode, runPowerShell: runPowerShellCode, apply: (changes) => systemScan.apply(changes), validate: validateScanChange,
  bench: labBench, cpuLoad: getCpuUsage, memory: () => ({ total: os.totalmem(), free: os.freemem() }), onBattery: async () => Boolean(powerMonitor?.isOnBatteryPower?.()),
  uptime: () => os.uptime(), exePath: process.execPath, isPackaged: app.isPackaged, emit: (channel, payload) => sendToWindow(channel, payload),
  onProblem: (kind, message) => noteInterruption('teste-com-reinicio', message, { motivo: kind })
});
const cleanRebootValue = (value) => (value === null || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 200) ? value : undefined);
registerIpcHandler('reboot:status', async () => rebootTest.status());
registerIpcHandler('reboot:start', async (_event, options) => {
  if (labState.running) throw new Error('O laboratório está medindo agora; espere ele terminar.');
  const changes = (Array.isArray(options?.changes) ? options.changes : []).slice(0, 160).map((change) => ({
    id: String(change?.id || '').slice(0, 48), label: String(change?.label || '').slice(0, 120), beforeLabel: String(change?.beforeLabel || '').slice(0, 80), afterLabel: String(change?.afterLabel || '').slice(0, 80),
    before: Array.isArray(change?.before) ? change.before.slice(0, 8).map(cleanRebootValue) : [], after: Array.isArray(change?.after) ? change.after.slice(0, 8).map(cleanRebootValue) : [],
    reboot: ['nao', 'sessao', 'reiniciar'].includes(change?.reboot) ? change.reboot : 'reiniciar', admin: change?.admin === true
  }));
  return rebootTest.start({ changes, protocol: String(options?.protocol || 'completo'), goal: String(options?.goal || 'jogos'), auto: options?.auto === true });
});
registerIpcHandler('reboot:continue', async () => rebootTest.tick({}));
registerIpcHandler('reboot:restart', async () => rebootTest.restart(15));
registerIpcHandler('reboot:abort-restart', async () => rebootTest.abortRestart());
registerIpcHandler('reboot:cancel', async () => rebootTest.cancel());
registerIpcHandler('reboot:ack', async (_event, id) => rebootTest.ack(String(id || '').slice(0, 40)));
/** Ao abrir (inclusive pelo RunOnce depois de reiniciar): se há teste rodando, mostra a janela e continua. */
async function resumeRebootTest(viaRunOnce, launchedAt) {
  if (process.platform !== 'win32') return;
  const current = await rebootTest.status().catch(() => null);
  if (current?.state?.status !== 'running') return;
  showWindow();
  sendToWindow('reboot:show', {});
  const result = await rebootTest.tick({ viaRunOnce, launchedAt }).catch(() => null);
  if (result) sendToWindow('reboot:status', result);
}
registerIpcHandler('lab:cancel', async () => { if (labState.signal) { labState.signal.cancelled = true; } return { ok: true }; });
registerIpcHandler('lab:recover', async () => labSystem.recover());
registerIpcHandler('lab:adopt', async (_event, config) => {
  if (labState.running) throw new Error('O laboratório está rodando.');
  const clean = {};
  for (const [id, value] of Object.entries(config && typeof config === 'object' ? config : {})) if (NexoLab.knob(id) && Number.isInteger(value)) clean[id] = value;
  return labSystem.adoptCurrent(clean);
});

// ---- Otimizar este PC: o plano sai da análise profunda; uma permissão do Windows para tudo (electron/optimizer-system.cjs) ----
const NexoOptimizer = require('./src/optimizer.js');
const NexoDeepRules = require('./src/deep-analysis.js');
const OptimizerActions = require('./electron/optimizer-actions.cjs');
const { createOptimizerSystem } = require('./electron/optimizer-system.cjs');
const optimizerSystem = createOptimizerSystem({
  runPowerShell: runPowerShellCode, run: (file, args) => runCode(file, args, 15000), elevate, systemScan, fs, path, platform: process.platform,
  storeFile: path.join(app.getPath('userData'), 'otimizacoes.json'), connectTime, findGateway,
  labPreflight: () => labSystem.preflight(), powerPlans: listPowerPlans,
  setPowerPlan: (guid) => execFileAsync(systemTool('powercfg'), ['/setactive', guid], { windowsHide: true, timeout: 10000 }),
  library: () => library.list(), deepLast: () => deepAnalysis.last()
});
const optState = { running: false, signal: null, plan: null };
/** O plano da análise (BIOS, laboratório) é refeito a partir do perfil: o relatório guardado não traz ele. */
function deepPlanOf(report) { try { return NexoDeepRules.plan(report.profile, report.findings || []); } catch { return []; } }
function stopBench() { if (activeBench) { activeBench.cancelled = true; for (const worker of activeBench.workers) worker.terminate(); } }
const PLAN_TTL_MS = 30 * 60 * 1000;
/** O que vai para a tela: sem os dados internos de cada mudança (a interface devolve só os ids marcados). */
const publicPlan = (plan) => ({ ...plan, steps: plan.steps.map(({ change, ...step }) => ({ ...step, changes: change?.kind === 'reboot-test' ? change.changes : undefined, node: change?.kind === 'pagefile' ? 'memory' : undefined })) });
const publicRun = (result) => ({ ...result, records: (result.records || []).map(({ id, stepId, kind, title, category, risk, reboot, undone }) => ({ id, stepId, kind, title, category, risk, reboot, undone: Boolean(undone) })) });
async function optimizerBusy() {
  if (labState.running) return 'O laboratório está medindo agora; espere ele terminar.';
  if (deepAnalysis.isRunning()) return 'A análise profunda está rodando; espere ela terminar.';
  if (activeBench) return 'Há um teste de desempenho em andamento; espere ele terminar.';
  if (await rebootTest.active()) return 'Há um teste com reinício em andamento; termine ou cancele ele antes (as medidas se misturariam).';
  return null;
}
registerIpcHandler('opt:games', async () => optimizerSystem.games());
registerIpcHandler('opt:plan', async (_event, options) => {
  if (process.platform !== 'win32') return { supported: false };
  if (optState.running) throw new Error('A otimização já está rodando.');
  const report = await deepAnalysis.last();
  if (!report?.profile) throw new Error('Faça a análise profunda primeiro: o plano sai dela.');
  const gameKey = typeof options?.game === 'string' ? options.game.slice(0, 120) : '';
  const game = gameKey ? await optimizerSystem.resolveGame(gameKey) : null;
  if (gameKey && !game) throw new Error('Não achei o executável desse jogo. Abra o jogo uma vez e tente de novo.');
  const allowRisk = ['baixo', 'moderado', 'alto'].includes(options?.allowRisk) ? options.allowRisk : 'moderado';
  const [scan, startup, nics, power, pre] = await Promise.all([systemScan.scan().catch(() => null), optimizerSystem.readStartup().catch(() => []), optimizerSystem.readNics().catch(() => []), optimizerSystem.readPower().catch(() => null), labSystem.preflight().catch(() => null)]);
  const sensors = Number.isFinite(pre?.tempC);
  const plan = NexoOptimizer.buildPlan({ report: { ...report, plan: deepPlanOf(report) }, scan, startup, nics, game, power, nicTweaks: OptimizerActions.NIC_TWEAKS, allowRisk, sensors });
  optState.plan = { ...plan, at: Date.now(), game };
  return { supported: true, plan: publicPlan(plan), sensors, onBattery: Boolean(pre?.onBattery), reportAt: report.at, startupCount: startup.filter((item) => item.enabled).length };
});
registerIpcHandler('opt:run', async (_event, options) => {
  if (optState.running) throw new Error('A otimização já está rodando.');
  const busy = await optimizerBusy();
  if (busy) throw new Error(busy);
  const stored = optState.plan;
  if (!stored || Date.now() - stored.at > PLAN_TTL_MS) throw new Error('O plano ficou velho; monte de novo para o Nexo ler o PC como está agora.');
  const picked = new Set((Array.isArray(options?.selected) ? options.selected : []).slice(0, 400).map(String));
  const plan = { ...stored, steps: stored.steps.map((step) => ({ ...step, selected: picked.has(step.id) && !['manual', 'testar'].includes(step.method) && !step.blocked })) };
  const consent = { acknowledged: options?.consent?.acknowledged === true, phrase: String(options?.consent?.phrase || '').slice(0, 40) };
  const memory = NexoLab.sanitizeMemory(options?.labMemory?.evidence, options?.labMemory?.tabu);
  const allowRisk = ['baixo', 'moderado', 'alto'].includes(options?.allowRisk) ? options.allowRisk : 'moderado';
  const signal = { cancelled: false };
  optState.running = true;
  optState.signal = signal;
  let restore = null;
  const system = {
    now: () => Date.now(),
    preflight: async () => ({ ...(await labSystem.preflight()), busy: await optimizerBusy() }),
    bench: async (name) => (await labBench(name)).mopsPerSec,
    ping: () => optimizerSystem.ping(),
    apply: async (changes, extra) => { const outcome = await optimizerSystem.execute(changes, { ...extra, game: stored.game }); restore = outcome.restore; return outcome; },
    revert: (records) => optimizerSystem.execute(records, { revert: true }),
    waitNetwork: () => optimizerSystem.waitNetwork(),
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    /* O laboratório dentro da otimização: o ponto de restauração já foi criado no lote (sem pedir outro UAC). */
    lab: async (labOptions) => {
      labState.running = true;
      labState.signal = signal;
      try {
        const labRunner = { ...labSystem, createRestorePoint: async () => restore || { ok: false, created: false, note: 'criado só quando há ajustes de sistema' } };
        return await NexoLab.run(labRunner, {
          consent: labOptions.consent, autonomy: 'autonomo', allowRisk: labOptions.allowRisk, maxArms: labOptions.maxArms, goal: labOptions.goal, combos: 1, wild: false,
          limits: { budgetMs: labOptions.budgetMin * 60 * 1000 }, requireRestorePoint: false, evidence: memory.evidence, tabu: memory.tabu, signal,
          emit: (event) => sendToWindow('opt:event', { type: 'lab', event: event.type === 'done' ? { type: 'done' } : event })
        });
      } finally { labState.running = false; labState.signal = null; }
    }
  };
  try {
    const result = await NexoOptimizer.run(system, plan, { consent, allowRisk, goal: 'jogos', signal, emit: (event) => sendToWindow('opt:event', event) });
    const id = `opt-${result.startedAt.toString(36)}`;
    if (result.records.length) await optimizerSystem.saveRun({ id, at: result.startedAt, game: stored.game ? stored.game.name : null, records: result.records }).catch(() => {});
    if (result.status === 'aborted') noteInterruption('otimizacao', result.reason, { codigo: result.code || 'erro', passos: plan.steps.filter((step) => step.selected).length });
    crumb('otimizacao', result.status, String(result.records.length));
    return { ...publicRun(result), id, summary: NexoOptimizer.summarize(result, plan) };
  } finally { optState.running = false; optState.signal = null; }
});
registerIpcHandler('opt:cancel', async () => { if (optState.signal) optState.signal.cancelled = true; stopBench(); return { ok: true }; });
registerIpcHandler('opt:status', async () => ({ running: optState.running }));
registerIpcHandler('opt:revert', async (_event, options) => {
  if (optState.running) throw new Error('A otimização está rodando; espere ela terminar.');
  const runId = String(options?.runId || '').slice(0, 40);
  const ids = Array.isArray(options?.ids) ? options.ids.slice(0, 400).map((value) => String(value).slice(0, 8)) : null;
  return optimizerSystem.revertRun(runId, ids);
});
registerIpcHandler('opt:runs', async () => (await optimizerSystem.loadStore()).runs.map((run) => ({ id: run.id, at: run.at, game: run.game, total: run.records.filter((record) => record.ok).length, active: run.records.filter((record) => record.ok && !record.undone).length })));

// ---- Conexões: IPC ----
async function connectionsView() {
  const config = await integrationConfig();
  const steamRoot = library.steamRoot();
  const detected = await steamAccount.detect(steamRoot).catch(() => ({ users: [] }));
  const steam = connections.steam;
  const steamUser = steam ? detected.users.find((user) => user.steamId === steam.steamId) : null;
  return {
    steam: { installed: Boolean(steamRoot), connected: Boolean(steam), steamId: steam?.steamId || null, personaName: steam?.personaName || null, avatar: fileUrl(steamUser?.avatarFile || steam?.avatarFile, 'a'), hasKey: Boolean(steam?.apiKey), owned: ownedCache.key === steam?.steamId ? ownedCache.games.length : null,
      signedIn: Boolean(steam?.pass), visible: steam?.visible ?? null, loginAvailable: Boolean(await serverUrl().catch(() => null)),
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
  const same = connections.steam?.steamId === user.steamId ? connections.steam : null;
  connections.steam = { steamId: user.steamId, personaName: user.personaName, apiKey: same?.apiKey || null, pass: same?.pass || null, avatarFile: same?.avatarFile || null, visible: same?.visible ?? null, at: Date.now() };
  await saveConnections();
  return connectionsView();
});
registerIpcHandler('steam:disconnect', async () => {
  if (connections.steam?.avatarFile) await fs.rm(connections.steam.avatarFile, { force: true }).catch(() => {});
  connections.steam = null; ownedCache = { at: 0, key: null, games: [] }; await saveConnections(); return connectionsView();
});

// ---- Entrar com a Steam (login oficial pelo servidor do Nexo; jogos e conquistas pela chave do criador) ----
let steamLoginBusy = false;
async function steamServer(route) {
  const steam = connections.steam;
  if (!steam?.pass) throw new Error('Entre com a Steam primeiro.');
  const base = await serverUrl();
  try {
    return await SteamLogin.api({ serverUrl: base, fetchImpl: (url, init) => net.fetch(url, init), pass: steam.pass, route, version: app.getVersion() });
  } catch (error) {
    // Passe vencido ou recusado: volta a ser a conta lida deste PC, e a tela pede para entrar de novo.
    if (error.status === 401 && connections.steam === steam) { steam.pass = null; await saveConnections(); }
    throw error;
  }
}
async function steamServerLibrary() {
  const data = await steamServer('/v1/steam/library');
  if (connections.steam) connections.steam.visible = data.visible === true;
  return (Array.isArray(data.games) ? data.games : []).filter((game) => /^\d{1,9}$/.test(String(game.appid)) && game.name).map((game) => ({
    appid: String(game.appid), name: String(game.name).slice(0, 120), playtimeMin: Number(game.playtimeMin) || 0, lastPlayed: Number(game.lastPlayed) || null, twoWeeksMin: Number(game.twoWeeksMin) || 0
  }));
}
registerIpcHandler('steam:sign-in', async () => {
  if (steamLoginBusy) throw new Error('Já existe um login da Steam aberto no navegador.');
  const base = await serverUrl();
  if (!base) throw new Error('O servidor do Nexo não está configurado nesta versão.');
  steamLoginBusy = true;
  try {
    const { pass, steamId } = await SteamLogin.signIn({ serverUrl: base, createServer: http.createServer, openExternal: (url) => shell.openExternal(url) });
    const same = connections.steam?.steamId === steamId ? connections.steam : null;
    connections.steam = { steamId, personaName: same?.personaName || 'Steam', apiKey: same?.apiKey || null, pass, avatarFile: same?.avatarFile || null, visible: null, at: Date.now() };
    ownedCache = { at: 0, key: null, games: [] };
    try {
      const profile = await steamServer('/v1/steam/me');
      if (profile.personaName) connections.steam.personaName = String(profile.personaName).slice(0, 64);
      if (profile.avatar) {
        const bytes = await fetchBytes(profile.avatar);
        const ext = detectImageExtension(bytes);
        if (ext) { await fs.mkdir(ACCOUNT_DIR(), { recursive: true }); const file = path.join(ACCOUNT_DIR(), `steam.${ext}`); await fs.writeFile(file, bytes); connections.steam.avatarFile = file; }
      }
    } catch { /* sem perfil agora: fica o nome da Steam deste PC, se houver */ }
    const local = (await steamAccount.detect(library.steamRoot()).catch(() => ({ users: [] }))).users.find((user) => user.steamId === steamId);
    if (local && connections.steam.personaName === 'Steam') connections.steam.personaName = local.personaName;
    await saveConnections();
    try { ownedCache = { at: Date.now(), key: steamId, games: await steamServerLibrary() }; await saveConnections(); } catch { /* a Biblioteca tenta de novo */ }
    mainWindow?.show(); mainWindow?.focus();
    return connectionsView();
  } finally { steamLoginBusy = false; }
});
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
let freshIdToken = null;

// ---- Servidor do Nexo: sincronização e telemetria (desligadas por padrão) e relatórios de erro (sempre ligados) ----
async function serverUrl() {
  if (process.env.NEXO_SERVER_URL) return process.env.NEXO_SERVER_URL;
  const candidates = [path.join(app.getPath('userData'), 'server.json'), app.isPackaged ? path.join(process.resourcesPath, 'config', 'server.json') : path.join(__dirname, 'config', 'server.json')];
  for (const file of candidates) { try { const url = JSON.parse(await fs.readFile(file, 'utf8')).url; if (typeof url === 'string' && url) return url; } catch { /* próximo */ } }
  return null;
}
const { createCloud, fitTelemetry } = require('./electron/cloud.cjs');
// E-mail da conta Google entrada no app: vai com os erros (marcado como "informado pelo app") quando a pessoa marcou
// "incluir meu e-mail" e não ligou a sincronização (sem ela o servidor não tem como confirmar o e-mail).
const accountEmail = async () => { const profile = await readProfile().catch(() => null); return profile?.email || null; };
let cloud = createCloud({ fs, path, dir: app.getPath('userData'), serverUrl: null, fetchImpl: (url, init) => net.fetch(url, init), safeStorage, version: app.getVersion(), errorLog, accountEmail });
const cloudReady = serverUrl().then(async (url) => {
  cloud = createCloud({ fs, path, dir: app.getPath('userData'), serverUrl: url, fetchImpl: (url2, init) => net.fetch(url2, init), safeStorage, version: app.getVersion(), errorLog, accountEmail });
  // Quem marcou "Ajudar a melhorar o Nexo" no instalador já respondeu: liga a telemetria e o app não pergunta de novo.
  // (Os relatórios de erro são sempre enviados desde a 0.11.1; não dependem dessa caixa.)
  const status = await cloud.status();
  if (status.configured && !status.asked && (await readSharePreference()).shareWithCreator) await cloud.setOptions({ telemetry: true, asked: true });
  return cloud;
}).catch(() => {});
const withCloud = async () => { await cloudReady; return cloud; };
/**
 * Telemetria: o que dá para saber do PC sem nada pessoal. Hardware (fabricante e modelo do processador e da placa
 * de vídeo, núcleos, memória), monitores (resolução, escala e taxa de atualização), discos (quantos e tamanho) e o
 * estado dos sensores. Nada de nome do PC, do usuário, de pastas ou de programas.
 */
async function telemetryHardware() {
  const cpus = os.cpus();
  const model = String(cpus[0]?.model || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  let gpuVendor = null;
  let gpuModels = [];
  let sensors = null;
  try {
    const readings = await getHardwareSensors();
    const devices = readings?.devices || [];
    const types = devices.map((device) => String(device.type));
    gpuVendor = types.includes('GpuNvidia') ? 'NVIDIA' : types.includes('GpuAmd') ? 'AMD' : types.includes('GpuIntel') ? 'Intel' : null;
    gpuModels = [...new Set(devices.filter((device) => /^Gpu/.test(String(device.type))).map((device) => String(device.name || '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean))].slice(0, 3);
    const temps = devices.flatMap((device) => (device.sensors || []).filter((sensor) => sensor.type === 'Temperature' && Number.isFinite(sensor.value)).map(() => String(device.type)));
    sensors = { status: String(readings?.status || 'desconhecido').slice(0, 20), source: String(readings?.source || '').slice(0, 20) || null, count: Number(readings?.sensorCount) || 0, devices: devices.length, cpuTemp: temps.includes('Cpu'), gpuTemp: temps.some((type) => /^Gpu/.test(type)), storageTemp: temps.includes('Storage') };
  } catch { gpuVendor = null; }
  let displays = [];
  try {
    const { screen } = require('electron');
    displays = screen.getAllDisplays().slice(0, 4).map((display) => ({ w: Math.round(display.size.width * display.scaleFactor), h: Math.round(display.size.height * display.scaleFactor), scale: Math.round(display.scaleFactor * 100) / 100, hz: Math.round(display.displayFrequency || 0) || null }));
  } catch { displays = []; }
  let drives = null;
  try {
    const snapshot = await getSystemSnapshot();
    const list = Array.isArray(snapshot?.drives) ? snapshot.drives : [];
    drives = { count: list.length, totalGB: Math.round(list.reduce((sum, drive) => sum + (Number(drive.sizeBytes) || 0), 0) / 1024 ** 3), systemUsedPct: Number.isFinite(snapshot?.primaryDrive?.usedPercent) ? Math.round(snapshot.primaryDrive.usedPercent) : null };
  } catch { drives = null; }
  return {
    hw: { cpuVendor: /amd|ryzen/i.test(model) ? 'AMD' : /intel/i.test(model) ? 'Intel' : model ? 'Outro' : null, cpuModel: model || null, cores: cpus.length, ramGB: Math.round(os.totalmem() / 1024 ** 3), gpuVendor, gpuModels, osBuild: os.release(), arch: process.arch, displays, drives },
    sensors,
    system: { locale: String(app.getLocale?.() || '').slice(0, 12), electron: process.versions.electron, channel: IS_LINUX ? (process.env.APPIMAGE ? 'appimage' : 'deb') : app.isPackaged ? 'instalador' : 'dev', autostart: Boolean(settings.openAtLogin), tray: Boolean(settings.tray), autoSession: Boolean(settings.autoSession), onlineCovers: Boolean(settings.onlineCovers), uptimeH: Math.round(os.uptime() / 3600) }
  };
}
/** Só as partes conhecidas do resumo que a interface montou (o servidor confere de novo). */
const TELEMETRY_PARTS = ['usage', 'features', 'app', 'perf', 'health', 'settings', 'library', 'lab', 'feats', 'bottleneck'];
registerIpcHandler('cloud:status', async () => {
  const target = await withCloud();
  // Entrou ou saiu da equipe do painel depois do login: confere sem segurar a tela e avisa se mudou.
  target.refreshRole().then((changed) => {
    if (changed) { sendToWindow('cloud:changed', {}); }
    return changed;
  }).catch(() => {});
  return target.status();
});
registerIpcHandler('cloud:set', async (_event, options) => {
  const status = await (await withCloud()).setOptions({ telemetry: options?.telemetry, errorEmail: options?.errorEmail, sync: options?.sync, asked: options?.asked });
  // O Registro acompanha a escolha, para o instalador mostrar a caixa certa numa reinstalação.
  if (typeof options?.telemetry === 'boolean') writeSharePreference(status.telemetry).catch(() => {});
  return status;
});
/** Liga a sincronização: usa o login recente ou abre o login do Google de novo. */
registerIpcHandler('cloud:connect', async () => {
  const target = await withCloud();
  if (!target.configured) throw new Error('O servidor do Nexo não está configurado nesta versão.');
  if ((await target.status()).connected) return target.setOptions({ sync: true });
  if (!freshIdToken || Date.now() - freshIdToken.at > 50 * 60 * 1000) {
    if (signingIn) throw new Error('Já existe um login em andamento no navegador.');
    const config = await googleConfig();
    if (!config) throw new Error('O login com Google ainda não foi configurado nesta build.');
    signingIn = true;
    try { const result = await Account.signIn({ config, createServer: http.createServer, openExternal: (url) => shell.openExternal(url), fetch: (url, init) => net.fetch(url, init) }); freshIdToken = result.idToken ? { value: result.idToken, at: Date.now() } : null; }
    finally { signingIn = false; mainWindow?.show(); mainWindow?.focus(); }
  }
  const token = freshIdToken?.value;
  freshIdToken = null; // uso único
  return target.connect(token);
});
registerIpcHandler('cloud:disconnect', async () => (await withCloud()).disconnect());
registerIpcHandler('cloud:delete-remote', async () => (await withCloud()).deleteRemote());
registerIpcHandler('cloud:push', async (_event, sections) => {
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) throw new Error('Nada para sincronizar.');
  const clean = {};
  for (const [name, value] of Object.entries(sections).slice(0, 12)) if (/^[a-z][a-z0-9]{1,23}$/.test(name)) clean[name] = value;
  // Preferências do processo principal vão junto (só as que fazem sentido em outro PC).
  clean.preferenciasapp = { tray: settings.tray, autoSession: settings.autoSession, onlineCovers: settings.onlineCovers };
  return (await withCloud()).push({ name: os.hostname(), sections: clean });
});
registerIpcHandler('cloud:devices', async () => (await withCloud()).devices());
registerIpcHandler('cloud:pull', async (_event, deviceId, only) => {
  const data = await (await withCloud()).pull(String(deviceId || ''), Array.isArray(only) ? only.map(String).slice(0, 12) : []);
  // Preferências do app vêm aplicadas aqui; o resto a interface aplica (ela é quem guarda).
  const prefs = data?.sections?.preferenciasapp;
  if (prefs && typeof prefs === 'object') {
    const patch = {};
    for (const key of ['tray', 'autoSession', 'onlineCovers']) if (typeof prefs[key] === 'boolean') patch[key] = prefs[key];
    await applySettings(patch).catch(() => {});
  }
  return data;
});
registerIpcHandler('cloud:forget', async (_event, deviceId) => (await withCloud()).forget(String(deviceId || '')));
registerIpcHandler('cloud:telemetry', async (_event, packet) => {
  const target = await withCloud();
  const status = await target.status();
  if (!status.telemetry) return { skipped: true };
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(packet?.day || '')) ? packet.day : null;
  if (!day) throw new Error('Dia inválido.');
  const partial = packet?.partial === true;
  const summary = packet?.data && typeof packet.data === 'object' && !Array.isArray(packet.data) ? packet.data : {};
  const data = Object.fromEntries(TELEMETRY_PARTS.filter((key) => summary[key] && typeof summary[key] === 'object').map((key) => [key, summary[key]]));
  const extra = await telemetryHardware();
  diag.flush();
  // Cabe no limite do servidor: se passar, saem primeiro os detalhes menos importantes (antes o pacote todo era recusado).
  const fitted = fitTelemetry({ ...data, hw: extra.hw, sensors: extra.sensors, system: extra.system, diag: diag.summary(day) || undefined });
  try { return await target.sendTelemetry(fitted.data, day, { partial }); }
  catch (error) {
    // Telemetria que não chega precisa aparecer no registro: 4xx = algo errado no pacote (vai como erro); sem rede = aviso.
    errorLog.record({ source: 'servico', level: error?.offline || error?.status === 429 ? 'aviso' : 'erro', message: `Telemetria não foi enviada: ${error?.message || error}`, context: { etapa: 'telemetria', status: error?.status || null, bytes: fitted.bytes, cortado: fitted.trimmed.join(',') || null, parcial: partial } });
    throw error;
  }
});
registerIpcHandler('cloud:send-errors', async () => (await withCloud()).sendErrors());
/** Envio periódico dos relatórios: falha de rede é esperada (aviso local), recusa do servidor é erro de verdade. */
async function sendErrorsQuietly() {
  try { await (await withCloud()).sendErrors(); }
  catch (error) { if (!error?.offline) errorLog.record({ source: 'servico', level: 'aviso', message: `Relatórios de erro não foram enviados: ${error?.message || error}`, context: { etapa: 'relatorios', status: error?.status || null } }); }
}
registerIpcHandler('cloud:admin', async () => {
  const link = await (await withCloud()).adminLink();
  if (!/^https:\/\/[A-Za-z0-9.-]+\/painel\/entrar\?c=[A-Za-z0-9_-]+$/.test(String(link?.url || ''))) throw new Error('O servidor devolveu um link estranho; não abri.');
  await shell.openExternal(link.url);
  return { ok: true };
});
// Relatórios de erro (se ligados): 2 minutos depois de abrir e a cada 30 minutos.
setTimeout(sendErrorsQuietly, 2 * 60 * 1000).unref?.();
setInterval(sendErrorsQuietly, 30 * 60 * 1000).unref?.();

registerIpcHandler('account:sign-in', async () => {
  if (signingIn) throw new Error('Já existe um login em andamento no navegador.');
  const config = await googleConfig();
  if (!config) throw new Error('O login com Google ainda não foi configurado nesta build.');
  signingIn = true;
  try {
    const { profile, avatar, idToken } = await Account.signIn({ config, createServer: http.createServer, openExternal: (url) => shell.openExternal(url), fetch: (url, init) => net.fetch(url, init) });
    // Guardado só na memória por 50 minutos: se a pessoa ligar a sincronização logo depois, não precisa entrar de novo.
    freshIdToken = idToken ? { value: idToken, at: Date.now() } : null;
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
registerIpcHandler('account:sign-out', async () => { await cloud.disconnect().catch(() => {}); freshIdToken = null; await fs.rm(ACCOUNT_DIR(), { recursive: true, force: true }); return accountView(); });
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
    spawn(systemTool('sh'), ['-c', script], { detached: true, stdio: 'ignore' }).unref();
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
  const helper = spawn(systemTool('powershell.exe'), ['-NoLogo', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
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
    if (argv.includes('--reboot-test')) resumeRebootTest(true, Date.now()).catch(() => {});
  });

  app.whenReady().then(async () => {
    // Suspender/voltar, bloquear, bateria: entram na trilha (explicam muitos erros "do nada" depois de dormir).
    try { for (const name of ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'on-ac', 'on-battery', 'shutdown']) powerMonitor.on(name, () => crumb('energia', name)); } catch { /* sem powerMonitor */ }
    if (process.platform === 'win32') app.setAppUserModelId('com.samuklvm.nexo');
    Menu.setApplicationMenu(null);
    // Se um teste do laboratório ficou pela metade (queda de energia, travamento), volta ao plano original antes de tudo.
    const recovered = await labSystem.recover().catch(() => ({ recovered: false }));
    if (process.argv.includes('--lab-recover')) { app.quit(); return; }
    // Aberto pelo RunOnce de um teste que já terminou ou foi cancelado: não há o que fazer, fecha quieto.
    if (process.argv.includes('--reboot-test') && (await rebootTest.status().catch(() => null))?.state?.status !== 'running') { app.quit(); return; }
    await loadSettings();
    await loadConnections();
    createWindow();
    if (recovered.recovered) mainWindow.webContents.once('did-finish-load', () => sendToWindow('lab:recovered', recovered));
    if (process.platform === 'win32') mainWindow.webContents.once('did-finish-load', () => { setTimeout(() => resumeRebootTest(process.argv.includes('--reboot-test'), APP_LAUNCHED_AT).catch(() => {}), 1500); });
    applyTray();
    if (process.platform === 'win32' && app.isPackaged) setTimeout(() => autoSensorSetup().catch(() => {}), 5000);
    if (settings.autoSession) library.scan().catch(() => []).then(() => watcher.start()).catch((error) => console.error('[observador de jogos]', error));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    return true;
  }).catch((error) => {
    // Falha ao abrir: fica no registro de erros (vai no próximo envio) e o app fecha em vez de ficar sem janela.
    errorLog.record({ source: 'principal', message: `O Nexo não conseguiu abrir: ${error?.message || error}`, stack: error?.stack });
    errorLog.idle?.().catch(() => {}).finally(() => app.quit());
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => diag.flush());
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
  // stop() do FPS é assíncrono: a falha ao fechar não pode virar rejeição sem tratamento na saída do app.
  Promise.resolve(fpsRunner.stop()).catch(() => {});
  sensorHost?.kill();
});
