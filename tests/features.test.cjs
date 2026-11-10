/*
 * Recursos das telas: carrega src/features.js e os src/feats-*.js num contexto isolado (sem Electron nem DOM real)
 * e confere que cada tela tem pelo menos 30 recursos em cada sistema, que nada se repete e que TODO cálculo
 * roda sem erro com o PC vazio (primeira abertura) e com um PC cheio de dados.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const VIEWS = ['home', 'analysis', 'hardware', 'maintenance', 'optimize', 'sessions', 'library', 'atlas', 'lab', 'activity', 'settings', 'updates'];
const FEATURE_FILES = ['features.js', 'feats-1.js', 'feats-2.js', 'feats-3.js', 'feats-4.js', 'novidades.js'];
const MIN = 60e3;
const DAY = 24 * 60 * MIN;

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), key: (i) => [...data.keys()][i] ?? null, get length() { return data.size; } };
}

function load(platform, { full = false } = {}) {
  const now = Date.now();
  const sample = (t, i) => ({ timestamp: t, cpu: 20 + (i % 50), memory: 40 + (i % 30), disk: 70 + i / 5000, gpu: 10 + (i % 80), acpiTemperature: null, gpuTemperature: 45 + (i % 20), cpuSensorTemperature: 50 + (i % 30), cpuClock: 3600 + (i % 900) });
  const history = full ? Array.from({ length: 7 * 24 * 60 / 2 }, (_, i) => sample(now - (7 * 24 * 60 - i * 2) * MIN, i)) : [];
  const live = full ? Array.from({ length: 120 }, (_, i) => sample(now - (120 - i) * 3000, i)) : [];
  const brainLib = require('../src/brain.js');
  const brain = brainLib.create(null);
  if (full) for (const s of history) brain.ingest({ t: s.timestamp, cpu: s.cpu, mem: s.memory, disk: s.disk, gpu: s.gpu, temp: s.cpuSensorTemperature, clock: s.cpuClock, procs: null });
  const sensors = full ? { status: 'ready', devices: [
    { name: 'AMD Ryzen 7 5700X', type: 'Cpu', sensors: [{ name: 'Core #1', type: 'Clock', value: 4620, min: 3400, max: 4650 }, { name: 'Core (Tctl/Tdie)', type: 'Temperature', value: 61, min: 38, max: 79 }, { name: 'Package', type: 'Power', value: 65.2, max: 88 }, { name: 'Core #1', type: 'Load', value: 33 }, { name: 'Tj Max', type: 'Temperature', value: 95 }] },
    { name: 'NVIDIA GeForce RTX 4060', type: 'GpuNvidia', sensors: [{ name: 'GPU Core', type: 'Temperature', value: 47, max: 71 }, { name: 'GPU Hot Spot', type: 'Temperature', value: 58 }, { name: 'GPU Core', type: 'Clock', value: 2460, max: 2700 }, { name: 'GPU Memory Used', type: 'SmallData', value: 3100 }, { name: 'GPU Memory Total', type: 'SmallData', value: 8188 }, { name: 'GPU Package', type: 'Power', value: 95 }, { name: 'GPU', type: 'Fan', value: 0 }] },
    { name: 'Samsung SSD 980 1TB', type: 'Storage', sensors: [{ name: 'Composite Temperature', type: 'Temperature', value: 44 }, { name: 'Percentage Used', type: 'Level', value: 3 }, { name: 'Data Written', type: 'Data', value: 12000 }, { name: 'Warning Temperature', type: 'Temperature', value: 82 }] },
    { name: 'ASUS TUF B550', type: 'Motherboard', sensors: [] }, { name: 'Nuvoton NCT6798D', type: 'SuperIO', sensors: [{ name: 'Fan #2', type: 'Fan', value: 980 }, { name: 'Vcore', type: 'Voltage', value: 1.25 }] },
    { name: 'Generic Memory', type: 'Memory', sensors: [{ name: 'Virtual Memory Used', type: 'Data', value: 20.1 }, { name: 'Virtual Memory Available', type: 'Data', value: 14.2 }] },
    { name: 'Ethernet', type: 'Network', sensors: [{ name: 'Upload Speed', type: 'Throughput', value: 12000 }, { name: 'Download Speed', type: 'Throughput', value: 250000 }] },
    { name: 'Battery', type: 'Battery', sensors: [{ name: 'Charge Level', type: 'Level', value: 81 }] }] } : null;
  const drives = [{ driveLetter: 'C', name: 'C: Windows', fileSystem: 'NTFS', sizeBytes: 1e12, freeBytes: 2e11, usedBytes: 8e11, usedPercent: 80, model: 'Samsung SSD 980 1TB', bus: 'NVMe', media: 'SSD' }, { driveLetter: 'D', name: 'D: Jogos', fileSystem: 'NTFS', sizeBytes: 2e12, freeBytes: 1e11, usedBytes: 1.9e12, usedPercent: 95, media: 'HDD' }];
  const snapshot = full ? { hostname: 'PC', operatingSystem: 'Windows_NT 10.0.26100', cpuModel: 'AMD Ryzen 7 5700X 8-Core Processor', logicalCpuCount: 16, cpuUsage: 31, memoryTotalBytes: 32e9, memoryUsedBytes: 18e9, memoryPercent: 56, networkConnected: true, temperatureReadings: { acpiSensors: [], gpuSensors: [{ memoryUsedMb: 3000, memoryTotalMb: 8188 }] }, uptimeSeconds: 9 * 86400, drives, primaryDrive: drives[0], version: '0.10.0' } : null;
  const session = (i) => ({ id: `s${i}`, name: i % 2 ? 'Aurora Drift' : 'Neon Tide', startedAt: now - i * DAY, auto: i % 2 === 0, profile: 'jogos', gameId: 'steam-1', report: { meta: { durationS: 3600 + i * 60 }, summary: { cpu: { avg: 40, max: 90 }, gpu: { avg: 85 }, temp: { max: 78 } }, findings: [{ severity: 'warn', title: 'GPU no limite', id: 'gpu' }], background: { cpu: [{ name: 'chrome' }] }, game: { name: i % 2 ? 'Aurora Drift' : 'Neon Tide' }, fps: { avgFps: 80 + i, p1LowFps: 55, frames: 20000, stutterCount: 4, hasBusy: true, gpuBoundShare: 0.9, cpuBoundShare: 0.05 }, overhead: { cpuAvg: 0.8 }, conclusion: 'ok' } });
  const ls = storage(full ? {
    'nexo-sessions-v1': JSON.stringify(Array.from({ length: 6 }, (_, i) => session(i))),
    'nexo-activity': JSON.stringify([{ title: 'Limpeza segura', detail: '1 GB', timestamp: now - DAY, count: 2 }, { title: 'Análise inteligente', detail: '', timestamp: now - 3600e3 }, { title: 'Raio-X do PC', detail: '3 ajustes', timestamp: now - 2 * DAY }]),
    'nexo-journal-v1': JSON.stringify([{ id: 'j1', at: now - DAY, actionId: 'registry-tweak', title: 'Desligar gravação', risk: 'moderado', reversible: true, status: 'applied', riskSession: true }, { id: 'j2', at: now - 2 * DAY, title: 'Plano de energia', risk: 'baixo', reversible: true, status: 'reverted', revertedAt: now - DAY }]),
    'nexo-lab-v1': JSON.stringify({ evidence: { 'epp:20': { n: 3, mean: 4.2, wins: 3, losses: 0, guards: 0 }, 'boost:2': { n: 2, mean: -1, wins: 0, losses: 2, guards: 1 }, 'combo:a|b': { n: 1 } }, tabu: ['x'], runs: [{ at: now - DAY, headline: 'EPP 20 deixou o núcleo 4% mais rápido', verdict: 'melhorou', arms: 3, combos: 1, autonomy: 'autonomo', adopted: true }] }),
    'nexo-auto-clean': 'true', 'nexo-auto-clean-last-run': String(now - 3 * DAY),
    'nexo-versions-seen': JSON.stringify([{ version: '0.9.0', at: now - 3 * DAY }, { version: '0.10.0', at: now - DAY }]),
    'nexo-recommendation-feedback': JSON.stringify([{ category: 'cpu', helpful: true, timestamp: now }])
  } : {});
  const games = [{ id: 'g1', name: 'Aurora Drift', source: 'steam', sourceLabel: 'Steam', sizeBytes: 60e9, lastPlayed: now - DAY, installed: true, playtimeMin: 600 }, { id: 'g2', name: 'Velho', source: 'epic', sourceLabel: 'Epic', sizeBytes: 20e9, lastPlayed: now - 300 * DAY, installed: true }, { id: 'g3', name: 'Da conta', source: 'steam', sourceLabel: 'Steam', installed: false, playtimeMin: 30 }, { id: 'a1', name: 'Servidor', kind: 'app', source: 'steam', installed: true }];
  const resolved = full ? {
    getSystemFacts: platform === 'linux' ? { platform, session: 'wayland', kernel: '6.8.0', powerProfile: 'balanced', ppd: true, mangohud: true, gamemode: false, governor: 'powersave' } : { platform, memory: [{ speed: 3600, configured: 2133, capacity: 16e9 }, { speed: 3600, configured: 2133, capacity: 16e9 }], displays: [{ name: 'RTX 4060', current: 60, max: 165 }], hags: 2, gameMode: 1, capture: 1, historical: 1, vbs: 2, hvci: true },
    getPowerSource: { onBattery: false }, getSelfMetrics: { cpu: 1.2, memMB: 320000, processes: 6 }, listGames: games,
    listErrors: { total: 3, groups: [{ level: 'erro', message: 'Falhou', source: 'ipc', count: 2, lastAt: now - DAY }, { level: 'aviso', message: 'Recusado', source: 'ipc', count: 1, lastAt: now }] },
    cloudStatus: { configured: true, connected: true, email: 'pessoa@exemplo.com', sync: true, telemetry: true, errors: true, errorEmail: true, admin: true, lastSyncAt: now - 600e3, lastTelemetryDay: '2026-11-06', lastErrorsAt: now - DAY },
    getAppInfo: { version: '0.10.0', packaged: true, userDataBytes: 5e7, userDataPath: 'C:\\Users\\x\\AppData' },
    getConnections: { steam: { installed: true, connected: true, personaName: 'Sam', hasKey: true, owned: 120 }, discord: { enabled: true } },
    getSettings: { autoSession: true, tray: false, openAtLogin: true, onlineCovers: true },
    getLabStatus: { running: false, pending: false, space: [{ id: 'epp', group: 'processador', risk: 'baixo', hidden: true, novelty: true }, { id: 'boost', group: 'processador', risk: 'moderado', hybrid: true }] },
    listStartupItems: [{ name: 'Steam', location: 'HKCU\\Run' }, { name: 'Discord', location: 'HKLM\\Run' }],
    listPowerPlans: [{ guid: 'a', name: 'Equilibrado', active: true }, { guid: 'b', name: 'Alto desempenho', active: false }],
    getHardwareTier: { cores: 16, memGB: 31.9, tier: 'forte' }, getSensorService: { installed: true, running: true },
    getFpsStatus: { available: true, name: 'PresentMon', launchOption: 'MANGOHUD=1 %command%' }, getFpsAccess: { inToken: true, member: true },
    rebootStatus: { state: null, history: [{ finishedAt: now - DAY }] }, getAccount: { profile: { name: 'Sam', email: 'pessoa@exemplo.com' } },
    getPrivacy: { shareWithCreator: true }, getWallpaper: { url: null }, currentWatchedGame: { name: 'Aurora Drift' },
    getTopProcesses: { byCpu: [{ name: 'chrome', cpuPercent: 30, memoryBytes: 2e9 }, { name: 'Idle', cpuPercent: 90 }], byMemory: [{ name: 'chrome', memoryBytes: 2e9 }] }
  } : {};
  const bridge = new Proxy({}, { get: (_t, name) => (resolved[name] !== undefined ? () => Promise.resolve(resolved[name]) : undefined) });
  const listeners = {};
  const context = {
    console, Date, Math, JSON, Intl, Promise, Map, Set, URL, Blob: class {}, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}, performance: { now: () => Date.now() },
    localStorage: ls, navigator: { userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Electron/38.0.0', language: 'pt-BR', clipboard: { writeText: async () => {} } },
    screen: { width: 2560, height: 1440 }, devicePixelRatio: 1.25, innerWidth: 1600, innerHeight: 900,
    matchMedia: () => ({ matches: false }), document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { dataset: {} } },
    escapeHtml: (v) => String(v), showToast() {}, readJSON: (k, f) => { try { const v = ls.getItem(k); return v === null ? f : JSON.parse(v); } catch { return f; } },
    desktopBridge: bridge, NexoAtlas: require('../src/atlas.js'), NexoBrain: brainLib, NexoProfiles: require('../src/profiles.js'),
    NexoLab: { BENCHES: ['single', 'multi'], GOALS: { geral: { label: 'Geral' } } }
  };
  context.window = context;
  context.Nexo = {
    platform, keys: { activity: 'nexo-activity', autoClean: 'nexo-auto-clean', autoCleanLastRun: 'nexo-auto-clean-last-run', history: 'nexo-performance-history', sessions: 'nexo-sessions-v1', journal: 'nexo-journal-v1', profile: 'nexo-profile', feedback: 'nexo-recommendation-feedback' },
    state: { snapshot, sensors, view: 'home', cleanupTotals: full ? { bytes: 6e9, fileCount: 1200 } : null }, profile: { id: full ? 'jogos' : null },
    on: (event, fn) => { (listeners[event] ||= []).push(fn); }, emit() {}, isIdle: () => false, effectsLite: false, liveRate: 'realtime', accent: 'estrela', accents: [{ id: 'estrela', label: 'Estrela' }],
    skyHour: () => 'noite', sky: { stats: () => ({ stars: 90, fireflies: 20, fps: 30, budget: 100 }), prefs: () => ({ density: 'normal' }) },
    updateState: () => (full ? { state: 'downloading', version: '0.11.0', percent: 40, total: 1.2e8, bytesPerSecond: 3e6, checkedAt: Date.now() } : {}),
    journal: { list: () => context.readJSON('nexo-journal-v1', []) },
    sessions: { list: () => context.readJSON('nexo-sessions-v1', []), isRecording: () => false, current: () => null },
    store: { live: () => live, history: () => history, deepMetrics: () => (full ? { cpuClock: 4600, cpuTemperature: 61, gpuTemperature: 47, gpuLoad: 9 } : {}), brain, feedback: () => context.readJSON('nexo-recommendation-feedback', []), lastProcesses: () => null, brainHistory: () => history.map((s) => ({ t: s.timestamp, disk: s.disk, cpu: s.cpu })), hottest: (s) => { const v = [s.cpuSensorTemperature, s.gpuTemperature].filter(Number.isFinite); return v.length ? Math.max(...v) : null; } }
  };
  vm.createContext(context);
  for (const file of FEATURE_FILES) vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), context, { filename: file });
  return context;
}

const settle = () => new Promise((resolve) => { setImmediate(resolve); });

for (const platform of ['win32', 'linux']) {
  test(`recursos (${platform}): pelo menos 30 por tela, sem repetir, com título, ícone e tipo válidos`, () => {
    const ctx = load(platform);
    const icons = new Set([...fs.readFileSync(path.join(root, 'src', 'features.js'), 'utf8').match(/const ICONS = \{([\s\S]*?)\n  \};/)[1].matchAll(/^\s+([a-z]+):/gm)].map((m) => m[1]));
    for (const view of VIEWS) {
      const list = ctx.NexoFeatures.forView(view);
      assert.ok(list.length >= 30, `${view}: só ${list.length} recursos no ${platform}`);
      assert.equal(new Set(list.map((d) => d.id)).size, list.length, `${view}: id repetido`);
      for (const def of list) {
        assert.ok(def.title.length >= 4 && def.title.length <= 60, `${view}/${def.id}: título`);
        assert.ok(['leitura', 'ferramenta', 'acao'].includes(def.kind), `${view}/${def.id}: tipo ${def.kind}`);
        assert.ok(icons.has(def.icon), `${view}/${def.id}: ícone ${def.icon} não existe`);
        if (def.kind !== 'leitura') assert.ok(def.action, `${view}/${def.id}: ferramenta/ação sem botão`);
        for (const need of def.needs || []) assert.ok(ctx.NexoFeatures.sources[need], `${view}/${def.id}: fonte ${need} não existe`);
      }
    }
  });

  for (const full of [false, true]) {
    test(`recursos (${platform}): todo cálculo roda sem erro com ${full ? 'um PC cheio de dados' : 'o PC vazio (primeira abertura)'}`, async () => {
      const ctx = load(platform, { full });
      ctx.NexoFeatures.makeContext().src; // garante a API
      // Primeira passada dispara as fontes; a segunda usa o que chegou.
      for (let round = 0; round < 2; round += 1) {
        const c = ctx.NexoFeatures.makeContext();
        for (const view of VIEWS) for (const def of ctx.NexoFeatures.forView(view)) {
          for (const need of def.needs || []) c.src(need);
          let out;
          assert.doesNotThrow(() => { out = def.compute(c); }, `${view}/${def.id} quebrou`);
          if (out) {
            assert.ok(out.value !== undefined, `${view}/${def.id}: resultado sem valor`);
            assert.ok(!/NaN|undefined|Infinity|\[object/.test(`${out.value} ${out.unit || ''} ${out.detail || ''}`), `${view}/${def.id}: texto estranho → ${out.value} ${out.unit || ''} · ${out.detail || ''}`);
            if (out.bar !== undefined) assert.ok(Number.isFinite(out.bar), `${view}/${def.id}: barra inválida`);
            for (const row of out.list || []) assert.ok(!/NaN|undefined/.test(row.join(' ')), `${view}/${def.id}: lista com ${row}`);
          }
          if (def.action && typeof def.action.label === 'function') assert.equal(typeof def.action.label(c, out), 'string');
          if (def.action?.when) assert.doesNotThrow(() => def.action.when(c, out), `${view}/${def.id}: condição do botão quebrou`);
        }
        await settle();
      }
      if (full) {
        const c = ctx.NexoFeatures.makeContext();
        const filled = VIEWS.flatMap((view) => ctx.NexoFeatures.forView(view).map((def) => def.compute(c))).filter((out) => out && out.value !== null && out.value !== undefined).length;
        const total = VIEWS.reduce((sum, view) => sum + ctx.NexoFeatures.forView(view).length, 0);
        assert.ok(filled / total > 0.9, `com dados, ${filled} de ${total} recursos mostraram algo`);
      }
    });
  }
}

test('novidades: a versão do package.json tem notas, com emojis, seções e itens', () => {
  const ctx = load('win32');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const versions = ctx.NexoNovidades.versions;
  const entry = versions.find((v) => v.version === version);
  assert.ok(entry, `falta a entrada da ${version} em src/novidades.js`);
  assert.equal(versions[0].version, version, 'a versão mais nova vem primeiro');
  for (const v of versions) {
    assert.match(v.version, /^\d+\.\d+\.\d+$/);
    assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(v.title && v.emoji && v.sections.length, v.version);
    for (const s of v.sections) { assert.ok(['new', 'up', 'fix'].includes(s.tone), `${v.version}: tom ${s.tone}`); assert.ok(s.items.length > 0); for (const item of s.items) assert.ok(item.emoji && item.title && item.text, `${v.version}: item incompleto`); }
  }
});
