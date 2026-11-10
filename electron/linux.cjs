/*
 * Camada Linux do Nexo. O que no Windows vem de PowerShell/CIM/Registro aqui vem de onde o Linux expõe:
 *  - unidades: /proc/mounts + statfs;  sensores: /sys/class/hwmon, cpufreq, gpu_busy_percent (AMD) e nvidia-smi;
 *  - programas: /proc/<pid>/stat e statm;  primeiro plano: xprop (_NET_ACTIVE_WINDOW / _NET_WM_PID; X11 e XWayland);
 *  - energia: power-profiles-daemon (powerprofilesctl, sem root);  inicialização: ~/.config/autostart e /etc/xdg/autostart;
 *  - limpeza: /tmp, miniaturas antigas, relatórios do apport do próprio usuário e a Lixeira (especificação freedesktop).
 * Nada roda como root. O único caso que pede senha (pkexec) é o TRIM, montado em electron/elevate.cjs.
 */
const REAL_FS = new Set(['ext2', 'ext3', 'ext4', 'btrfs', 'xfs', 'f2fs', 'ntfs', 'ntfs3', 'fuseblk', 'vfat', 'exfat', 'zfs', 'bcachefs', 'jfs', 'reiserfs']);
const SKIP_MOUNT = /^\/(snap|boot\/efi|var\/lib\/(docker|containers)|run|proc|sys|dev)(\/|$)/;
const PROFILES = { 'power-saver': 'Economia de energia', balanced: 'Equilibrado', performance: 'Desempenho' };
const PROFILE_ORDER = ['power-saver', 'balanced', 'performance'];

/* ---------- Leitores puros (testáveis com texto) ---------- */
const unescapeMount = (value) => String(value).replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
function parseMounts(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text).split('\n')) {
    const [device, mount, type] = line.split(' ');
    if (!device || !mount || !REAL_FS.has(type)) continue;
    const point = unescapeMount(mount);
    if (SKIP_MOUNT.test(point) || seen.has(device)) continue;
    seen.add(device);
    out.push({ device, mount: point, type });
  }
  return out.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : a.mount.localeCompare(b.mount)));
}

/** /proc/<pid>/stat: o nome pode ter espaços e parênteses, então corta pelo ÚLTIMO ')'. */
function parseStat(text) {
  const value = String(text);
  const open = value.indexOf('(');
  const close = value.lastIndexOf(')');
  if (open < 0 || close < 0) return null;
  const fields = value.slice(close + 2).split(' ');
  return { pid: Number(value.slice(0, open).trim()), name: value.slice(open + 1, close).slice(0, 60), ticks: Number(fields[11]) + Number(fields[12]), rssPages: Number(fields[21]) };
}

function parseProfiles(text) {
  const list = [];
  for (const line of String(text).split('\n')) {
    const match = line.match(/^(\*?)\s*([\w-]+):\s*$/);
    if (match && PROFILES[match[2]]) list.push({ guid: match[2], name: PROFILES[match[2]], active: match[1] === '*' });
  }
  return list.sort((a, b) => PROFILE_ORDER.indexOf(a.guid) - PROFILE_ORDER.indexOf(b.guid));
}

function parseDesktop(text) {
  const entry = {};
  let inEntry = false;
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) { inEntry = trimmed === '[Desktop Entry]'; continue; }
    if (!inEntry) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) { const key = trimmed.slice(0, eq); if (!(key in entry)) entry[key] = trimmed.slice(eq + 1); }
  }
  return entry;
}

function parseActiveWindow(text) { const match = String(text).match(/window id # (0x[0-9a-f]+)/i); return match && match[1] !== '0x0' ? match[1] : null; }
function parseWmPid(text) { const match = String(text).match(/=\s*(\d+)/); return match ? Number(match[1]) : null; }

/** Tipo do "dispositivo" a partir do nome do driver hwmon (mesmos tipos que a interface já conhece). */
function hwmonType(name) {
  if (/^(coretemp|k10temp|zenpower|cpu_thermal|k8temp)$/.test(name)) return 'Cpu';
  if (name === 'amdgpu' || name === 'radeon') return 'GpuAmd';
  if (name === 'nouveau') return 'GpuNvidia';
  if (name === 'i915' || name === 'xe') return 'GpuIntel';
  if (/^(nvme|drivetemp)$/.test(name)) return 'Storage';
  if (/^(BAT\d|battery)$/i.test(name)) return 'Battery';
  if (/^(iwlwifi|r8169|mt7921)/.test(name)) return 'Network';
  return 'Motherboard';
}
const HWMON_LABEL = { coretemp: 'Processador (Intel)', k10temp: 'Processador (AMD)', zenpower: 'Processador (AMD)', amdgpu: 'Placa de vídeo AMD', nouveau: 'Placa de vídeo NVIDIA (nouveau)', i915: 'Vídeo Intel', xe: 'Vídeo Intel', nvme: 'SSD NVMe', drivetemp: 'Disco', acpitz: 'Zona térmica ACPI' };

function createLinux({ fs, path, os, run, env = process.env }) {
  const home = () => env.HOME || os.homedir();
  const read = (file) => fs.readFile(file, 'utf8').then((text) => text.trim()).catch(() => null);
  const list = (dir) => fs.readdir(dir).catch(() => []);
  const which = async (command) => (await run('sh', ['-c', `command -v ${command}`])).code === 0;
  const minmax = new Map();

  async function drives() {
    const mounts = parseMounts(await read('/proc/mounts') || '');
    const out = [];
    for (const item of mounts) {
      try {
        const stats = await fs.statfs(item.mount);
        const sizeBytes = Number(stats.blocks) * Number(stats.bsize);
        if (sizeBytes < 512 * 1024 * 1024) continue;
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        const usedBytes = Math.max(0, sizeBytes - freeBytes);
        out.push({ id: item.mount, driveLetter: item.mount, name: item.mount === '/' ? '/ (sistema)' : item.mount, fileSystem: item.type, sizeBytes, freeBytes, usedBytes, usedPercent: sizeBytes ? Math.round((usedBytes / sizeBytes) * 100) : 0, device: item.device });
      } catch { /* ponto de montagem inacessível */ }
    }
    return out;
  }

  /** Sensores no mesmo formato do coletor do Windows. Mínimo e máximo são da sessão do app. */
  async function sensors() {
    const root = '/sys/class/hwmon';
    const devices = [];
    for (const entry of await list(root)) {
      const dir = path.join(root, entry);
      const name = await read(path.join(dir, 'name')) || entry;
      const files = await list(dir);
      const sensorsList = [];
      const add = (label, type, value, unit, advanced = false) => {
        if (!Number.isFinite(value)) return;
        const key = `${entry}/${label}/${type}`;
        const range = minmax.get(key) || { min: value, max: value };
        range.min = Math.min(range.min, value); range.max = Math.max(range.max, value);
        minmax.set(key, range);
        sensorsList.push({ name: label, type, value: Math.round(value * 10) / 10, min: Math.round(range.min * 10) / 10, max: Math.round(range.max * 10) / 10, unit, advanced });
      };
      for (const file of files) {
        const match = file.match(/^(temp|fan|in|power|freq)(\d+)_(input|average)$/);
        if (!match) continue;
        const raw = Number(await read(path.join(dir, file)));
        const label = await read(path.join(dir, `${match[1]}${match[2]}_label`)) || `${match[1] === 'temp' ? 'Temperatura' : match[1] === 'fan' ? 'Ventoinha' : match[1] === 'in' ? 'Tensão' : match[1] === 'power' ? 'Potência' : 'Frequência'} ${match[2]}`;
        if (match[1] === 'temp') add(label, 'Temperature', raw / 1000, '°C');
        if (match[1] === 'fan') add(label, 'Fan', raw, 'RPM', true);
        if (match[1] === 'in') add(label, 'Voltage', raw / 1000, 'V', true);
        if (match[1] === 'power') add(label, 'Power', raw / 1e6, 'W');
        if (match[1] === 'freq') add(label, 'Clock', raw / 1e6, 'MHz');
      }
      if (name === 'amdgpu') add('GPU Core', 'Load', Number(await read(path.join(dir, 'device', 'gpu_busy_percent'))), '%');
      if (sensorsList.length) devices.push({ name: HWMON_LABEL[name] || name, type: hwmonType(name), path: `/hwmon/${entry}`, sensors: sensorsList });
    }
    // Frequência atual de cada núcleo (cpufreq) entra no dispositivo do processador.
    const cpuDir = '/sys/devices/system/cpu';
    const clocks = [];
    for (const entry of (await list(cpuDir)).filter((name) => /^cpu\d+$/.test(name)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))).slice(0, 64)) {
      const khz = Number(await read(path.join(cpuDir, entry, 'cpufreq', 'scaling_cur_freq')));
      if (Number.isFinite(khz) && khz > 0) clocks.push([entry, khz / 1000]);
    }
    if (clocks.length) {
      let cpu = devices.find((device) => device.type === 'Cpu');
      if (!cpu) { cpu = { name: os.cpus()[0]?.model || 'Processador', type: 'Cpu', path: '/cpufreq', sensors: [] }; devices.unshift(cpu); }
      cpu.name = os.cpus()[0]?.model || cpu.name;
      for (const [entry, mhz] of clocks) cpu.sensors.push({ name: `Núcleo ${Number(entry.slice(3)) + 1}`, type: 'Clock', value: Math.round(mhz), min: Math.round(mhz), max: Math.round(mhz), unit: 'MHz', advanced: false });
    }
    const count = devices.reduce((sum, device) => sum + device.sensors.length, 0);
    return { status: count ? 'ready' : 'unavailable', collectedAt: new Date().toISOString(), devices, sensorCount: count, issues: count ? [] : [{ device: 'Coletor', message: 'Este Linux não expõe sensores em /sys/class/hwmon (talvez falte o módulo do chip, como "k10temp" ou "coretemp", ou o pacote lm-sensors).' }] };
  }

  async function temperatures() {
    const zones = [];
    for (const entry of (await list('/sys/class/thermal')).filter((name) => name.startsWith('thermal_zone'))) {
      const celsius = Number(await read(path.join('/sys/class/thermal', entry, 'temp'))) / 1000;
      if (Number.isFinite(celsius) && celsius > 0 && celsius < 125) zones.push({ name: `Zona ${zones.length + 1}`, celsius });
    }
    return zones;
  }

  /** Amostra de processos: duas leituras de /proc com 1 s de intervalo. */
  async function processSample() {
    const snapshot = new Map();
    for (const pid of (await list('/proc')).filter((name) => /^\d+$/.test(name))) {
      const stat = parseStat(await read(`/proc/${pid}/stat`) || '');
      if (stat) snapshot.set(stat.pid, stat);
    }
    return snapshot;
  }
  async function topProcesses(waitMs = 1000, sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); })) {
    const before = await processSample();
    await sleep(waitMs);
    const after = await processSample();
    const cores = Math.max(1, os.cpus().length);
    const page = 4096;
    const rows = [...after.values()].map((proc) => {
      const prev = before.get(proc.pid);
      const cpuPercent = prev ? Math.max(0, ((proc.ticks - prev.ticks) / 100 / (waitMs / 1000) / cores) * 100) : 0;
      return { processId: proc.pid, name: proc.name, cpuPercent: Math.round(cpuPercent * 10) / 10, memoryBytes: proc.rssPages * page };
    });
    // Programas: processos com o mesmo nome somados (navegadores e apps Electron abrem vários).
    const groups = new Map();
    for (const row of rows) {
      const group = groups.get(row.name) || { processId: 0, name: row.name, cpuPercent: 0, memoryBytes: 0, count: 0 };
      group.cpuPercent = Math.round((group.cpuPercent + row.cpuPercent) * 10) / 10; group.memoryBytes += row.memoryBytes; group.count += 1;
      groups.set(row.name, group);
    }
    const programs = [...groups.values()];
    return {
      byCpu: [...rows].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 5), byMemory: [...rows].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 5),
      programsByCpu: [...programs].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 8), programsByMemory: [...programs].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 8)
    };
  }

  /** Programa em primeiro plano (X11/XWayland). No Wayland puro o sistema não revela a janela ativa a outros apps. */
  async function foreground() {
    const active = parseActiveWindow((await run('xprop', ['-root', '_NET_ACTIVE_WINDOW'])).stdout);
    if (!active) return null;
    const pid = parseWmPid((await run('xprop', ['-id', active, '_NET_WM_PID'])).stdout);
    if (!pid) return null;
    const [name, exe, cwd] = await Promise.all([read(`/proc/${pid}/comm`), fs.readlink(`/proc/${pid}/exe`).catch(() => null), fs.readlink(`/proc/${pid}/cwd`).catch(() => null)]);
    // Jogos pelo Proton rodam como wine; a pasta de trabalho é a do jogo, então ela também serve para reconhecer.
    return { pid, name: name || 'programa', path: exe && /wine|proton|steam-runtime|pressure-vessel/i.test(exe) && cwd ? path.join(cwd, 'jogo') : exe };
  }

  async function powerProfiles() {
    const result = await run('powerprofilesctl', ['list']);
    return result.code === 0 ? parseProfiles(result.stdout) : [];
  }
  async function setPowerProfile(id) {
    // O valor que vai para o comando sai da lista fixa (não do que chegou da tela).
    const profile = PROFILE_ORDER.find((name) => name === id);
    if (!profile) throw new Error('Perfil de energia não reconhecido.');
    const result = await run('powerprofilesctl', ['set', profile]);
    if (result.code !== 0) throw new Error('O power-profiles-daemon recusou a troca de perfil.');
  }

  async function startupItems() {
    const userDir = path.join(env.XDG_CONFIG_HOME || path.join(home(), '.config'), 'autostart');
    const byFile = new Map();
    for (const dir of ['/etc/xdg/autostart', userDir]) {
      for (const file of (await list(dir)).filter((name) => name.endsWith('.desktop'))) {
        const entry = parseDesktop(await read(path.join(dir, file)) || '');
        byFile.set(file, { ...entry, location: dir === userDir ? 'Usuário' : 'Sistema' });
      }
    }
    return [...byFile.values()].filter((entry) => entry.Name && entry.Hidden !== 'true' && entry['X-GNOME-Autostart-enabled'] !== 'false' && !entry.OnlyShowIn)
      .map((entry) => ({ name: String(entry.Name).slice(0, 80), command: String(entry.Exec || '').slice(0, 220), location: entry.location, user: '' }));
  }

  /* ---------- Lixeira (freedesktop: $XDG_DATA_HOME/Trash/files + info) ---------- */
  const trashDir = () => path.join(env.XDG_DATA_HOME || path.join(home(), '.local', 'share'), 'Trash');
  async function sizeOf(target, depth = 0) {
    let total = 0; let count = 0;
    try {
      const stats = await fs.lstat(target);
      if (!stats.isDirectory() || depth > 12) return { bytes: stats.size, count: 1 };
      for (const name of await list(target)) { const inner = await sizeOf(path.join(target, name), depth + 1); total += inner.bytes; count += inner.count; }
    } catch { /* sumiu */ }
    return { bytes: total, count };
  }
  async function scanTrash() {
    const files = path.join(trashDir(), 'files');
    let bytes = 0; let fileCount = 0;
    for (const name of await list(files)) { const item = await sizeOf(path.join(files, name)); bytes += item.bytes; fileCount += 1; }
    return { fileCount, bytes };
  }
  async function emptyTrash() {
    for (const sub of ['files', 'info']) for (const name of await list(path.join(trashDir(), sub))) await fs.rm(path.join(trashDir(), sub, name), { recursive: true, force: true }).catch(() => {});
  }

  const cleanupCategories = () => [
    { id: 'temp', label: 'Temporários antigos', description: 'Arquivos seus com mais de 7 dias na pasta temporária (sem subpastas). Arquivos de outros usuários são ignorados.', recursive: false, roots: () => [os.tmpdir()] },
    { id: 'thumbnails', label: 'Miniaturas antigas', description: 'Miniaturas de imagens e vídeos com mais de 7 dias; o gerenciador de arquivos recria quando precisar.', recursive: true, roots: () => [path.join(env.XDG_CACHE_HOME || path.join(home(), '.cache'), 'thumbnails')] },
    { id: 'crash', label: 'Relatórios de falha seus', description: 'Relatórios antigos de programas que travaram (apport), só os do seu usuário.', recursive: false, roots: () => ['/var/crash'] },
    { id: 'recycle', label: 'Lixeira', description: 'Esvazia a sua Lixeira. Os arquivos não poderão ser recuperados.', special: true }
  ];

  return { drives, sensors, temperatures, topProcesses, processSample, foreground, powerProfiles, setPowerProfile, startupItems, scanTrash, emptyTrash, cleanupCategories, which, PROFILES, PROFILE_ORDER };
}

module.exports = { createLinux, parseMounts, parseStat, parseProfiles, parseDesktop, parseActiveWindow, parseWmPid, hwmonType, PROFILES, PROFILE_ORDER };
