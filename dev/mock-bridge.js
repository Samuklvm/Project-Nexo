window.__nexoPlatform = /[?&]linux/.test(location.search) ? 'linux' : 'win32';
/* Ponte simulada: permite abrir a interface num navegador comum (dev/preview.html) sem o Electron.
   Gera uma semana de histórico fictício para mostrar gráficos, rotina e análise. Não entra no instalador. */
(function () {
  const MIN = 60000;
  const now = Date.now();
  const seeded = (() => {
    let s = 11;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  })();
  const history = [];
  const brainSeed = NexoBrain.create();
  for (let i = 7 * 24 * 60; i > 0; i -= 1) {
    const t = now - i * MIN; const d = new Date(t); const h = d.getHours();
    let cpu = 10 + seeded() * 12; let mem = 48 + seeded() * 5; let culprit = null;
    if (h >= 20 && h < 23) { cpu = 55 + seeded() * 20; mem = 62 + seeded() * 4; }
    if (d.getDay() === 2 && h === 14 && d.getMinutes() < 22) { cpu = 94 + seeded() * 5; culprit = 'chrome'; }
    if (d.getDay() === 4 && h === 10 && d.getMinutes() < 16) { cpu = 92 + seeded() * 6; culprit = 'chrome'; }
    const disk = 78 + ((7 * 1440 - i) / 1440) * 1.3 + seeded() * 0.1;
    const temp = 48 + cpu * 0.35 + seeded() * 3;
    history.push([t, cpu, mem, disk, 6 + seeded() * 10, 40 + seeded() * 2, 44 + seeded() * 5, temp]);
    brainSeed.ingest({ t, cpu, mem, disk, gpu: null, temp, culprit });
  }
  localStorage.setItem('nexo-performance-history', JSON.stringify(history));
  localStorage.setItem('nexo-brain-v1', JSON.stringify(brainSeed.serialize()));

  const plans = [{ guid: 'a', name: 'Equilibrado', active: true }, { guid: 'b', name: 'Alto desempenho', active: false }, { guid: 'c', name: 'Economia de energia', active: false }];
  let tick = 0;
  const wave = (base, amp, speed) => Math.max(1, Math.min(99, base + Math.sin(tick / speed) * amp + (Math.random() - 0.5) * 4));
  const drives = [{ driveLetter: 'C', name: 'Windows (NVMe)', fileSystem: 'NTFS', sizeBytes: 953e9, usedBytes: 786e9, freeBytes: 167e9, usedPercent: 82 }, { driveLetter: 'D', name: 'Jogos', fileSystem: 'NTFS', sizeBytes: 1e12, usedBytes: 410e9, freeBytes: 590e9, usedPercent: 41 }];
  const sensors = { status: 'ready', collectedAt: Date.now(), sensorCount: 6, issues: [], devices: [
    { name: 'AMD Ryzen 7 5700X', type: 'Cpu', path: '/amdcpu/0', sensors: [
      { name: 'Core #1', type: 'Clock', value: 4620, min: 3400, max: 4650, unit: 'MHz', advanced: false },
      { name: 'CPU Package', type: 'Temperature', value: 61, min: 38, max: 79, unit: '°C', advanced: false },
      { name: 'CPU Total', type: 'Load', value: 18, min: 2, max: 100, unit: '%', advanced: false }] },
    { name: 'NVIDIA GeForce RTX 4060', type: 'GpuNvidia', path: '/gpu-nvidia/0', sensors: [
      { name: 'GPU Core', type: 'Load', value: window.__mockGameMode ? 97 : 9, min: 0, max: 98, unit: '%', advanced: false },
      { name: 'GPU Core', type: 'Temperature', value: 47, min: 33, max: 71, unit: '°C', advanced: false },
      { name: 'GPU Fan', type: 'Fan', value: 0, min: 0, max: 2100, unit: 'RPM', advanced: true }] }] };
  window.nexoDesktop = {
    getSystemSnapshot: async () => { tick += 1; return {
      hostname: 'DESKTOP-NEXO', operatingSystem: 'Windows_NT 10.0.26100', cpuModel: 'AMD Ryzen 7 5700X', logicalCpuCount: 16,
      cpuUsage: wave(22, 14, 5), memoryTotalBytes: 32e9, memoryUsedBytes: 17.6e9, memoryPercent: Math.round(wave(55, 3, 9)),
      networkConnected: true, uptimeSeconds: 3 * 86400 + 4 * 3600, drives, primaryDrive: drives[0], version: '0.5.0',
      temperatureReadings: { acpiSensors: [{ celsius: 41 }], gpuSensors: [{ temperatureCelsius: 47, usagePercent: 9 }] } }; },
    getHardwareSensors: async () => { const [gpu] = sensors.devices[1].sensors; gpu.value = window.__mockGameMode ? 94 + Math.random() * 5 : 9; return { ...sensors, collectedAt: Date.now() }; },
    getTopProcesses: async () => ({ byCpu: [{ processId: 4120, name: 'chrome', cpuPercent: 31, memoryBytes: 2.1e9, memoryPercent: 6 }, { processId: 912, name: 'Code', cpuPercent: 9, memoryBytes: 1.1e9, memoryPercent: 3 }], byMemory: [{ processId: 4120, name: 'chrome', cpuPercent: 31, memoryBytes: 2.1e9, memoryPercent: 6 }, { processId: 77, name: 'dwm', cpuPercent: 3, memoryBytes: 0.4e9, memoryPercent: 1 }] }),
    scanCleanup: async () => ({ categories: [
      { id: 'temp', label: 'Temporários antigos', description: 'Arquivos com mais de 7 dias na pasta temporária do usuário (sem subpastas).', fileCount: 842, bytes: 1.9e9, destructive: false },
      { id: 'crashdumps', label: 'Relatórios de falha de programas', description: 'Despejos de memória (.dmp) de programas que travaram, com mais de 7 dias.', fileCount: 6, bytes: 640e6, destructive: false },
      { id: 'wer', label: 'Relatórios de erro do Windows', description: 'Relatórios antigos, enviados ou pendentes, do Relatório de Erros do Windows.', fileCount: 0, bytes: 0, destructive: false },
      { id: 'recycle', label: 'Lixeira', description: 'Esvazia a Lixeira de todas as unidades. Os arquivos não poderão ser recuperados.', fileCount: 31, bytes: 3.2e9, destructive: true }] }),
    getCleanupPreview: async () => ({ fileCount: 842, bytes: 1.9e9 }),
    runCleanup: async () => ({ results: [], removedCount: 848, bytesFreed: 2.5e9 }),
    cleanupTempFiles: async () => ({ removedCount: 0, bytesFreed: 0 }),
    listPowerPlans: async () => plans.map((plan) => ({ ...plan })),
    setPowerPlan: async (guid) => { plans.forEach((plan) => { plan.active = plan.guid === guid; }); return { ok: true, plans: plans.map((plan) => ({ ...plan })) }; },
    getPowerSource: async () => ({ onBattery: false }),
    cancelCpuBench: async () => ({ ok: true }),
    runCpuBench: async ({ mode, ms }) => { await new Promise((resolve) => { setTimeout(resolve, ms > 500 ? 220 : 80); }); const boost = plans.find((plan) => plan.active)?.guid === 'b' ? 1.09 : 1; return { mode, threads: mode === 'single' ? 1 : 7, ms, mopsPerSec: (mode === 'single' ? 152 : 880) * boost * (1 + (Math.random() - 0.5) * 0.024) }; },
    openDoc: async () => ({ ok: true }),
    listStartupItems: async () => [{ name: 'Discord', command: 'C:\\Users\\voce\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe' }, { name: 'SecurityHealth', command: '%windir%\\system32\\SecurityHealthSystray.exe' }, { name: 'Steam', command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent' }, { name: 'GoogleDriveFS', command: '"C:\\Program Files\\Google\\Drive File Stream\\129.0.1.0\\GoogleDriveFS.exe" --startup_mode --some-very-long-argument-that-keeps-going-and-going-forever' }],
    openWindowsSettings: async () => ({ ok: true }), getAppInfo: async () => ({ version: '0.5.0', packaged: false, userDataPath: 'C:\\Users\\voce\\AppData\\Roaming\\nexo-device-care', userDataBytes: 1.4e6 }),
    getWallpaper: async () => ({ url: null }), getPrivacy: async () => ({ shareWithCreator: false }), setPrivacy: async () => ({}),
    listDrives: async () => drives, optimizeDrive: async () => ({}), repairSystemFiles: async () => ({}), openTaskManager: async () => ({}), openLink: async () => ({}),
    checkForUpdates: async () => ({ state: 'current' }), onUpdateStatus: () => () => {}, getWindowState: async () => ({ maximized: false }), onWindowState: () => () => {},
    minimizeWindow() {}, toggleMaximizeWindow() {}, closeWindow() {}
  };
  // ---- sessões de observação (simulado)
  const listeners = { probe: new Set(), fps: new Set(), fpsError: new Set(), fpsEnded: new Set() };
  let probeTimer = null; let fpsTimer = null; let fpsFrames = [];
  Object.assign(window.nexoDesktop, {
    sampleSession: async () => ({ t: Date.now(), cpu: window.__mockGameMode ? 31 + Math.random() * 4 : 18 + Math.random() * 8, maxCore: window.__mockGameMode ? 58 + Math.random() * 12 : 35 + Math.random() * 10, mem: 57 + Math.random() * 2, appCpu: 0.6, appMemMB: 190 }),
    startProbe: async () => { clearInterval(probeTimer); probeTimer = setInterval(() => { const sample = { t: Date.now(), fg: { pid: 4242, name: window.__mockGameMode ? 'eldenring' : 'Code', isGame: Boolean(window.__mockGameMode) }, cpu: [{ pid: 4242, name: 'eldenring', cpu: 16 }, { pid: 77, name: 'chrome', cpu: 21 }], gpu: [{ pid: 4242, name: 'eldenring', util: 94 }], self: { cpu: 0.7, memMB: 88 } }; listeners.probe.forEach((cb) => cb(sample)); }, 1000); return { ok: true }; },
    stopProbe: async () => { clearInterval(probeTimer); return { ok: true }; },
    testProbe: async () => ({ ok: true, sample: { t: Date.now(), fg: { pid: 1, name: 'Code', isGame: false }, cpu: [{ name: 'chrome', cpu: 12 }], gpu: [], self: { cpu: 0.5, memMB: 84 } } }),
    onProbe: (cb) => { listeners.probe.add(cb); return () => listeners.probe.delete(cb); },
    getFpsStatus: async () => ({ available: true, source: 'escolhido', name: 'PresentMon-2.6.0-x64.exe', platform: 'win32' }),
    chooseFps: async () => ({ canceled: false, available: true, source: 'escolhido', name: 'PresentMon-2.6.0-x64.exe', platform: 'win32' }),
    clearFps: async () => ({ available: false, source: null, name: null, platform: 'win32' }),
    startFps: async () => { fpsFrames = []; clearInterval(fpsTimer); fpsTimer = setInterval(() => { for (let i = 0; i < 75; i += 1) { fpsFrames.push({ ms: i % 40 === 0 ? 75 : 12.5 + Math.random() }); } listeners.fps.forEach((cb) => cb({ fps: 72 + Math.random() * 6, worstMs: 20, frames: fpsFrames.length })); }, 1000); return { ok: true }; },
    stopFps: async () => { clearInterval(fpsTimer); const frames = fpsFrames.map((frame) => ({ ...frame, cpuBusy: 5, gpuBusy: frame.ms * 0.97 })); return { summary: NexoFps.summarize(frames), series: NexoFps.perSecond(frames), frames: frames.length }; },
    onFpsUpdate: (cb) => { listeners.fps.add(cb); return () => listeners.fps.delete(cb); },
    onFpsError: (cb) => { listeners.fpsError.add(cb); return () => listeners.fpsError.delete(cb); },
    onFpsEnded: (cb) => { listeners.fpsEnded.add(cb); return () => listeners.fpsEnded.delete(cb); }
  });
})();
// ---- 0.5.0 (simulado): biblioteca, laboratório, Atlas, conta e segundo plano. Nomes de jogos inventados.
(function () {
  const cover = (title, hue, shape) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='900'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='hsl(${hue},70%,55%)'/><stop offset='1' stop-color='hsl(${hue + 40},60%,12%)'/></linearGradient><radialGradient id='s' cx='.7' cy='.3' r='.6'><stop offset='0' stop-color='hsl(${hue + 180},90%,75%)' stop-opacity='.9'/><stop offset='1' stop-color='hsl(${hue + 180},90%,75%)' stop-opacity='0'/></radialGradient></defs><rect width='600' height='900' fill='url(#g)'/><circle cx='420' cy='260' r='${shape}' fill='url(#s)'/><path d='M0 700 L160 560 L300 650 L460 500 L600 620 L600 900 L0 900Z' fill='hsl(${hue + 20},50%,8%)' opacity='.85'/><text x='40' y='800' font-family='Segoe UI,Arial' font-weight='800' font-size='58' fill='white'>${title}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };
  const day = 86400000; const now = Date.now();
  const games = [
    ['Aurora Drift', 'steam', 'Steam', 205, 140, 1], ['Cinder Vale', 'steam', 'Steam', 18, 200, 3], ['Hollow Signal', 'epic', 'Epic Games', 280, 0, 6], ['Neon Tide', 'steam', 'Steam', 320, 180, 9],
    ['Lumen Protocol', 'xbox', 'Xbox', 160, 160, 0], ['Starfall Tactics', 'gog', 'GOG', 45, 0, 14], ['Pale Harbor', 'steam', 'Steam', 190, 120, 30], ['Ironbloom', 'ea', 'EA', 10, 0, 0],
    ['Velvet Circuit', 'steam', 'Steam', 300, 220, 2], ['Rift Runner', 'riot', 'Riot', 0, 0, 1], ['Moss & Meteor', 'manual', 'Adicionado por você', 110, 0, 0], ['Echoes of Kaur', 'ubisoft', 'Ubisoft', 25, 150, 60]
  ].map(([name, source, sourceLabel, hue, shape, daysAgo], index) => ({ id: `${source}-${index}`, name, source, sourceLabel, hue, sizeBytes: (8 + index * 7) * 1e9, lastPlayed: daysAgo ? now - daysAgo * day : null,
    cover: shape ? cover(name, hue, shape) : null, icon: null, canLaunch: source !== 'xbox', coverSource: shape ? (source === 'steam' ? 'cache local da Steam' : 'pasta do jogo') : null }));
  const sessions = JSON.parse(localStorage.getItem('nexo-sessions-v1') || '[]');
  if (!sessions.length) {
    const t = now - 2 * day;
    localStorage.setItem('nexo-sessions-v1', JSON.stringify([{ id: 's1', name: 'Aurora Drift', gameId: 'steam-0', auto: true, startedAt: t, endedAt: t + 3600e3, profile: 'jogos', timeline: [{ s: 0, cpu: 30, maxCore: 60, mem: 55, gpu: 96 }, { s: 3600, cpu: 32, maxCore: 64, mem: 57, gpu: 97 }], fpsSeries: [88, 91, 86, 90],
      report: { conclusion: 'A placa de vídeo foi o limite em 94% do tempo: o processador tem folga.', findings: [], game: { name: 'Aurora Drift' }, fps: { avgFps: 89, p1LowFps: 61, p01LowFps: 48, frameMs: { p50: 11.2, p99: 16.4 }, stutterCount: 3, hasBusy: true, gpuBoundShare: 0.94, cpuBoundShare: 0.04 }, meta: { durationS: 3600, hasFps: true, hasGpuSensor: true }, foreground: [], background: {}, limits: 'Simulado.' } }]));
  }
  const listeners = { lab: new Set(), settings: new Set() };
  const settings = { autoSession: false, tray: false, openAtLogin: false, onlineCovers: false, packaged: true, platform: 'win32' };
  let account = { configured: true, configSource: 'build', encrypted: true, profile: null, avatar: null };
  let cancelled = false;
  const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const reboot = { state: null, history: [], listeners: new Set(), busy: false };
  const rebootView = () => {
    const { state } = reboot;
    const action = state && state.status === 'running' ? NexoRebootTest.nextAction(state, { bootAt: state.armedAt - 1, now: Date.now() }).type : 'idle';
    return { supported: true, state, action, busy: reboot.busy, restartAt: null, permissions: state ? NexoRebootTest.permissionCount(state.order, state.admin) : 0, preview: state && state.boots.length >= 2 ? NexoRebootTest.verdict(state) : null, history: reboot.history };
  };
  /** Prévia: simula um boot do teste com reinício (etapas, medição e veredito) sem reiniciar nada. */
  async function simulateBoot() {
    let { state } = reboot;
    if (!state || state.status !== 'running') return;
    reboot.busy = true;
    const config = state.order[state.step];
    const steps = ['Esperando o Windows terminar de ligar (120 s)', 'Esperando o processador sossegar (12%)', 'Medindo o processador em repouso', 'Teste ritmo de quadros (rodada 2 de 3)', 'Teste disco (rodada 3 de 3)'];
    for (const [index, text] of steps.entries()) {
      reboot.listeners.forEach((cb) => cb({ stage: 'medindo', text, pct: Math.round((index / steps.length) * 100), step: state.step, steps: state.order.length, config }));
      // eslint-disable-next-line no-await-in-loop -- simula as etapas uma depois da outra, como no teste real
      await wait(500);
    }
    const gain = config === 'B' ? 1.06 : 1;
    const jitter = () => 1 + (Math.random() - 0.5) * 0.02;
    const metrics = { desktop: 9.4 / gain * jitter(), boot: 21 * jitter(), idleCpu: 2.4 / gain * jitter(), memUsed: 4.1 / (config === 'B' ? 1.04 : 1) * jitter(), processes: Math.round((config === 'B' ? 196 : 214) * jitter()), services: Math.round((config === 'B' ? 92 : 104) * jitter()) };
    for (const mode of NexoRebootTest.BENCHES) metrics[mode] = (mode === 'frames' || mode === 'latency' ? 1000 * gain : 1000) * jitter();
    state = NexoRebootTest.recordBoot(state, { bootAt: Date.now() - 200000, metrics, rounds: {}, quiet: true, viaRunOnce: true }, Date.now());
    const next = NexoRebootTest.nextAction(state, { bootAt: 0, now: Date.now() });
    if (next.type === 'switch') state = NexoRebootTest.markSwitched(state, next.config, Date.now());
    if (next.type === 'finish') {
      const result = NexoRebootTest.verdict(state);
      state = { ...state, status: 'done', phase: 'done', result, kept: result.keep, applied: result.keep, finishedAt: Date.now() };
      reboot.history.unshift(state);
    }
    reboot.state = { ...state, armedAt: Date.now() };
    reboot.busy = false;
    reboot.listeners.forEach((cb) => cb({ stage: next.type === 'finish' ? 'pronto' : 'aguardando', text: '', pct: 100 }));
  }
  // Contas: Steam encontrada neste PC; "Entrar com a Steam" simula o login oficial.
  const conn = { steam: { installed: true, connected: false, steamId: null, personaName: null, avatar: null, hasKey: false, owned: null, signedIn: false, visible: null, loginAvailable: true,
    detected: [{ steamId: '76561198000000001', personaName: 'Viajante', avatar: null, mostRecent: true }] }, xbox: { configured: false, connected: false }, discord: { configured: true, enabled: false, showGame: true, showNexo: false, ready: false } };
  Object.assign(window.nexoDesktop, {
    getConnections: async () => JSON.parse(JSON.stringify(conn)),
    connectSteam: async (id) => { Object.assign(conn.steam, { connected: true, steamId: id, personaName: 'Viajante' }); return JSON.parse(JSON.stringify(conn)); },
    disconnectSteam: async () => { Object.assign(conn.steam, { connected: false, signedIn: false, steamId: null, personaName: null, owned: null, visible: null }); return JSON.parse(JSON.stringify(conn)); },
    signInSteam: async () => { await wait(800); Object.assign(conn.steam, { connected: true, signedIn: true, steamId: '76561198000000001', personaName: 'Viajante', owned: 214, visible: true }); return JSON.parse(JSON.stringify(conn)); },
    setSteamKey: async () => JSON.parse(JSON.stringify(conn)),
    scanGames: async () => { await wait(500); return games; }, listGames: async () => games, launchGame: async () => ({ ok: true }), revealGame: async () => ({ ok: true }),
    setGameCover: async () => ({ canceled: true }), addGame: async () => ({ canceled: true }), removeManualGame: async () => ({ games }), onGamesUpdated: () => () => {},
    getSettings: async () => ({ ...settings }), setSettings: async (patch) => { Object.assign(settings, patch); listeners.settings.forEach((cb) => cb({ ...settings })); return { ...settings }; },
    onSettingsChanged: (cb) => { listeners.settings.add(cb); return () => listeners.settings.delete(cb); }, onWatchGame: () => () => {}, currentWatchedGame: async () => null,
    // Página do jogo: loja, conquistas e novidades de exemplo (o formato que o processo principal devolve).
    getGameDetails: async (id) => {
      if (!settings.onlineCovers) return { consent: false };
      await wait(300);
      const game = games.find((item) => item.id === id) || games[0];
      const shot = (hue) => cover(game.name, hue, 120);
      return {
        consent: true, appid: 1234560, matched: game.source !== 'steam',
        store: { appid: 1234560, description: `${game.name} é um jogo de exemplo da prévia.`, about: 'Texto longo da loja, só para a prévia.', developers: ['Estúdio Exemplo'], publishers: ['Editora Exemplo'], release: '12 de mar. de 2024', comingSoon: false,
          genres: ['Ação', 'Aventura', 'Indie', 'RPG'], price: 'R$ 59,99', recommendations: 12345, achievementsTotal: 3, controller: 'partial', screenshots: [{ thumb: shot(30), full: shot(30) }, { thumb: shot(200), full: shot(200) }],
          categories: ['Um jogador', 'Conquistas da Steam'], requirements: { minimum: 'SO: Windows 10\nMemória: 8 GB', recommended: 'SO: Windows 11\nMemória: 16 GB' }, header: shot(260), metacritic: 64 },
        achievements: { state: 'ok', unlocked: 1, total: 3, list: [
          { name: 'Primeiros passos', description: 'Termine o tutorial.', icon: shot(120), achieved: true, unlockedAt: Date.now() - 3 * 86400000, percent: 71.5, hidden: false },
          { name: 'Raridade', description: 'Algo difícil.', icon: null, achieved: false, unlockedAt: null, percent: 2.4, hidden: false },
          { name: 'Segredo', description: '', icon: null, achieved: false, unlockedAt: null, percent: null, hidden: true }] },
        news: [{ kind: 'atualizacao', date: Date.now() - 86400000, source: 'Steam', title: 'Atualização 1.2', summary: 'Correções e desempenho.', url: 'https://store.steampowered.com/news/' },
          { kind: 'noticia', date: null, source: 'Blog', title: 'Notícia', summary: 'Algo aconteceu.', url: null }]
      };
    },
    getFpsAccess: async () => ({ platform: 'win32', inToken: false, member: false, admin: false, ready: false, needsRelogin: false }),
    grantFpsAccess: async () => ({ ok: true, changed: true, declined: false, access: { platform: 'win32', inToken: false, member: true, admin: false, ready: false, needsRelogin: true } }), revokeFpsAccess: async () => ({ ok: true }),
    getSystemFacts: async () => ({ platform: 'win32', memory: [{ speed: 3600, configured: 2666, capacity: 16e9 }, { speed: 3600, configured: 2666, capacity: 16e9 }], displays: [{ name: 'NVIDIA GeForce RTX 4060', current: 60, max: 165 }], hags: 2, gameMode: 1, capture: 1, vbs: 2, hvci: true }),
    getAccount: async () => account, signIn: async () => { await wait(600); account = { ...account, profile: { name: 'Sam Exemplo', email: 'voce@exemplo.com', signedInAt: Date.now() } }; return account; },
    signOut: async () => { account = { ...account, profile: null }; return account; }, importOAuthConfig: async () => account,
    getLabStatus: async () => ({ running: false, pending: false, platform: 'win32', space: NexoLab.SPACE }),
    scanSystem: async () => { await wait(500); return { supported: true, scannedAt: Date.now(), ...window.__scanPreview }; },
    reportError: (payload) => { (window.__errors = window.__errors || []).push(payload); },
    listErrors: async () => ({ total: 3, dir: 'C:\\Users\\<usuário>\\AppData\\Roaming\\nexo-device-care\\logs', groups: [
      { signature: 'a1', level: 'erro', source: 'interface', message: "Cannot read properties of undefined (reading 'devices')", context: '{"tela":"hardware"}', count: 2, firstAt: Date.now() - 3600000, lastAt: Date.now() - 60000, versions: ['0.8.1'], stack: "TypeError: Cannot read properties of undefined (reading 'devices')\n    at renderSensorExplorer (view-hardware.js:62:20)" },
      { signature: 'b2', level: 'aviso', source: 'ipc', message: 'Você recusou a permissão do Windows; os ajustes do sistema não foram aplicados.', context: '{"acao":"scan:apply"}', count: 1, firstAt: Date.now() - 7200000, lastAt: Date.now() - 7200000, versions: ['0.8.1'], stack: '' }] }),
    exportErrors: async () => 'Nexo Device Care 0.8.1 (win32) · 3 ocorrência(s)',
    // Servidor do Nexo na prévia: sincronização e telemetria desligadas até a pessoa ligar, erros sempre ligados; um "outro PC" de exemplo para trazer dados.
    ...(() => {
      const cloud = { sync: false, telemetry: false, errors: true, errorEmail: true, asked: false, connected: false, admin: false, lastSyncAt: null };
      const view = () => ({ configured: true, ...cloud, email: cloud.connected ? account.profile?.email || null : null, deviceId: 'pc-previa0001' });
      const other = { deviceId: 'pc-notebook01', name: 'NOTEBOOK-SALA', sections: ['atividade', 'perfil', 'preferencias', 'preferenciasapp', 'sessoes'], size: 48210, appVersion: '0.9.0', updatedAt: Date.now() - 5 * 3600000, current: false };
      return {
        cloudStatus: async () => view(),
        cloudSet: async (patch) => { for (const key of ['telemetry', 'errorEmail', 'asked']) if (typeof patch[key] === 'boolean') { cloud[key] = patch[key]; } return view(); },
        cloudConnect: async () => { if (!account.profile) { throw new Error('Entre com o Google primeiro.'); } await wait(700); Object.assign(cloud, { connected: true, sync: true, admin: new URLSearchParams(location.search).has('admin') }); return view(); },
        cloudDisconnect: async () => { Object.assign(cloud, { connected: false, sync: false, admin: false }); return view(); },
        cloudDeleteRemote: async () => { await wait(400); Object.assign(cloud, { connected: false, sync: false, admin: false, lastSyncAt: null }); return view(); },
        cloudPush: async (sections) => { await wait(300); cloud.lastSyncAt = Date.now(); window.__pushed = sections; return { ok: true, size: JSON.stringify(sections).length }; },
        cloudDevices: async () => ({ devices: [{ ...other }, { deviceId: 'pc-previa0001', name: 'ESTE-PC', sections: ['atividade', 'perfil', 'preferencias', 'sessoes'], size: 12000, appVersion: '0.9.0', updatedAt: cloud.lastSyncAt || Date.now(), current: true }] }),
        cloudPull: async (_id, only) => { await wait(500); const all = { perfil: 'jogos', preferencias: { effects: 'full', liveRate: 'balanced' }, atividade: [{ title: 'Raio-X aplicado', detail: '3 ajustes no NOTEBOOK-SALA', timestamp: Date.now() - 4 * 3600000 }], sessoes: [] }; return { deviceId: other.deviceId, name: other.name, sections: Object.fromEntries(Object.entries(all).filter(([name]) => !only?.length || only.includes(name))) }; },
        cloudForget: async () => ({ ok: true }),
        cloudTelemetry: async (usage) => { window.__telemetry = usage; return { sent: cloud.telemetry }; },
        cloudSendErrors: async () => ({ sent: 0 }),
        cloudAdmin: async () => ({ ok: true })
      };
    })(),
    clearErrors: async () => ({ ok: true }), openErrorFolder: async () => ({ ok: true }),
    applyTweaks: async () => { await wait(600); return { ok: true, failed: [], after: null }; },
    // Teste com reinício na prévia: o motor de verdade (src/reboot-test.js); "reiniciar" simula um boot medido.
    rebootStatus: async () => rebootView(),
    rebootStart: async (options) => { reboot.state = NexoRebootTest.createPlan({ ...options, now: Date.now() - 10 }); return rebootView(); },
    rebootRestart: async () => { simulateBoot(); return { ok: true }; },
    rebootAbortRestart: async () => ({ ok: true }),
    rebootContinue: async () => rebootView(),
    rebootCancel: async () => { if (reboot.state) { reboot.state = { ...reboot.state, status: 'cancelled', kept: 'A', applied: 'A', finishedAt: Date.now(), result: reboot.state.boots.length >= 2 ? NexoRebootTest.verdict(reboot.state) : null }; reboot.history.unshift(reboot.state); } return rebootView(); },
    rebootAck: async () => { if (reboot.state) { reboot.state.journaled = true; } return { ok: true }; },
    onRebootProgress: (cb) => { reboot.listeners.add(cb); return () => reboot.listeners.delete(cb); },
    onRebootStatus: () => () => {}, onRebootShow: () => () => {},
    labPreflight: async () => ({ platform: 'win32', onBattery: false, tempC: 47, cpuLoad: 9, pending: false, knobs: Object.fromEntries(NexoLab.SPACE.map((knob) => [knob.id, { available: knob.id !== 'boostpol', current: knob.values[0] }])) }),
    cancelLab: async () => { cancelled = true; return { ok: true }; }, recoverLab: async () => ({ recovered: false }), onLabRecovered: () => () => {},
    onLabEvent: (cb) => { listeners.lab.add(cb); return () => listeners.lab.delete(cb); },
    adoptLab: async () => ({ guid: 'x', name: 'Nexo — Ajustado (simulado)', before: { guid: 'a', name: 'Equilibrado' } }),
    // Prévia: o motor de verdade (src/lab.js) com um PC simulado, rápido, para ver a interface como ela é.
    runLab: async (options) => {
      cancelled = false;
      const emit = (event) => listeners.lab.forEach((cb) => cb(event));
      const baseline = Object.fromEntries(NexoLab.SPACE.map((knob) => [knob.id, knob.values[knob.values.length - 1]]));
      let config = { ...baseline };
      let seed = 3;
      const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.012; };
      const effect = (bench) => {
        let gain = 1;
        if (['burst', 'latency'].includes(bench) && config.minstate === 100) gain *= 1.07;
        if (bench === 'latency' && config.idlestatemax === 1) gain *= 1.12;
        if (bench === 'disk' && config.aspm === 0) gain *= 1.09;
        if (bench === 'single' && config.boostmode === 2) gain *= 1.04;
        if (bench === 'multi' && config.boostmode === 2) gain *= 0.95;
        return gain;
      };
      const system = {
        now: () => Date.now(), sleep: (ms) => wait(Math.min(ms, 30)),
        preflight: async () => ({ platform: 'win32', onBattery: false, tempC: 47, cpuLoad: 9, pending: false, hybrid: false, knobs: Object.fromEntries(NexoLab.SPACE.map((knob) => [knob.id, { available: true, current: baseline[knob.id] }])) }),
        createRestorePoint: async () => { await wait(300); return { ok: true, created: true }; },
        begin: async () => { await wait(200); }, readConfig: async () => ({ ...baseline }),
        apply: async (changes) => { for (const change of changes) config[change.id] = change.value; },
        bench: async (bench) => { await wait(25); if (cancelled) { throw new NexoLab.GuardError('cancelado', 'Você cancelou o teste.'); } return 100 * effect(bench) * (1 + noise()); },
        sample: async () => ({ tempC: 55, onBattery: false, cpuLoad: 20 }), errorEventsSince: async () => 0,
        restore: async () => { config = { ...baseline }; await wait(200); return { ok: true }; },
        adopt: async (cfg) => ({ guid: 'adj', name: 'Nexo — Ajustado (simulado)', before: { guid: 'a', name: 'Equilibrado' }, config: cfg }),
        finish: async () => {}
      };
      const result = await NexoLab.run(system, { ...options, limits: { budgetMs: (options.budgetMin || 30) * 60000 }, emit: (event) => emit(event.type === 'done' ? { type: 'done' } : event) });
      return result;
    },
    openStoreUrl: async () => ({ ok: true })
  });
})();
// ---- Linux (simulado): abra dev/preview.html?linux
if (window.__nexoPlatform === 'linux') {
  Object.assign(window.nexoDesktop, {
    getLabStatus: async () => ({ running: false, pending: false, platform: 'linux', space: NexoLab.LINUX_SPACE }),
    getFpsStatus: async () => ({ available: true, source: 'mangohud', name: 'MangoHud', platform: 'linux', launchOption: 'MANGOHUD_CONFIG="output_folder=/home/voce/.config/Nexo Device Care/mangohud,autostart_log=1,log_interval=0" mangohud %command%' }),
    getFpsAccess: async () => ({ platform: 'linux', ready: true, inToken: true, member: false, admin: false, needsRelogin: false }),
    listPowerPlans: async () => [{ guid: 'power-saver', name: 'Economia de energia', active: false }, { guid: 'balanced', name: 'Equilibrado', active: true }, { guid: 'performance', name: 'Desempenho', active: false }],
    getSystemFacts: async () => ({ platform: 'linux', session: 'wayland', kernel: '6.11.5', powerProfile: 'balanced', ppd: true, mangohud: true, gamemode: false, governor: 'powersave' }),
    listDrives: async () => [{ driveLetter: '/', name: '/ (sistema)', fileSystem: 'btrfs', sizeBytes: 953e9, usedBytes: 512e9, freeBytes: 441e9, usedPercent: 54 }, { driveLetter: '/mnt/Jogos', name: '/mnt/Jogos', fileSystem: 'ext4', sizeBytes: 2e12, usedBytes: 1.1e12, freeBytes: 0.9e12, usedPercent: 55 }]
  });
}
// ---- Análise profunda (simulada com os módulos de verdade: NexoHardware + NexoDeep) ----
// Prévia acelerada (~16 s); dev/preview.html?deep=real roda no tempo real (60 s ou mais).
(function () {
  const speed = /[?&]deep=real/.test(location.search) ? 1 : 0.22;
  const progressListeners = new Set();
  const wakeListeners = new Set();
  const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms * speed); });
  let state = null;
  let saved = null;
  const GB = 1024 ** 3;
  const inventory = {
    platform: 'win32',
    cpu: { name: 'AMD Ryzen 7 5700X3D 8-Core Processor', manufacturer: 'AuthenticAMD', cores: 8, threads: 16, baseMHz: 3000 },
    board: { manufacturer: 'ASUSTeK COMPUTER INC.', product: 'TUF GAMING B550M-PLUS (WI-FI)' }, bios: { vendor: 'American Megatrends Inc.', version: '3404', date: '2024-02-21' },
    system: { manufacturer: 'System manufacturer', model: 'System Product Name', chassis: [3] },
    memory: { modules: [{ capacity: 8 * GB, speed: 2133, configured: 2133, manufacturer: 'G Skill Intl', part: 'F4-3600C16-8GVKC', type: 26, formFactor: 8, locator: 'DIMM_A2', bank: 'BANK 1' }, { capacity: 8 * GB, speed: 2133, configured: 2133, manufacturer: 'G Skill Intl', part: 'F4-3600C16-8GVKC', type: 26, formFactor: 8, locator: 'DIMM_B2', bank: 'BANK 3' }], slots: 4 },
    gpus: [{ name: 'NVIDIA GeForce RTX 4060 Ti', vendorId: '10DE', deviceId: '2803', driverVersion: '32.0.15.8180', driverDate: '2026-09-18', vramBytes: 8 * GB, link: { curSpeed: 1, maxSpeed: 4, curWidth: 8, maxWidth: 8 } }],
    nvme: [{ name: 'Controlador NVM Express padrão', link: { curSpeed: 3, maxSpeed: 4, curWidth: 4, maxWidth: 4 } }],
    displays: [{ adapter: 'NVIDIA GeForce RTX 4060 Ti', name: 'LG ULTRAGEAR', output: 'DisplayPort', width: 2560, height: 1440, hz: 165, maxHz: 165, primary: true }],
    disks: [{ model: 'KINGSTON SNV2S1000G', media: 'SSD', bus: 'NVMe', size: 1e12, health: 'Healthy', system: true }, { model: 'ST2000DM008-2FR102', media: 'HDD', bus: 'SATA', size: 2e12, health: 'Healthy', rpm: 7200 }],
    network: [{ name: 'Wi-Fi', description: 'Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter', up: true, linkMbps: 960, kind: 'wifi', wifi: { signal: 82, standard: '802.11ax', band: 5 } }],
    os: { platform: 'win32', caption: 'Microsoft Windows 11 Pro', build: 26100 }
  };
  const procs = new Map([[4100, { name: 'RobloxPlayerBeta', path: 'C:\\Users\\voce\\AppData\\Local\\Roblox\\Versions\\v\\RobloxPlayerBeta.exe', window: true }], [4200, { name: 'steamwebhelper' }], [4300, { name: 'chrome' }], [4301, { name: 'chrome' }], [4400, { name: 'Discord' }], [4500, { name: 'wallpaper64' }], [4600, { name: 'MsMpEng' }], [4700, { name: 'Nexo Device Care' }], [4800, { name: 'svchost' }]]);
  const services = new Map([[4800, ['DoSvc']]]);
  const ticks = Array.from({ length: 11 }, (_, i) => ({ kind: 'tick', i, t: Date.now() + i * 3000,
    procs: [{ pid: 4100, cpu: 24, io: 2e5, mem: 1.9e9 }, { pid: 4200, cpu: 1.2, io: 0, mem: 4e8 }, { pid: 4300, cpu: i % 3 ? 3.2 : 11, io: 1e5, mem: 1.4e9 }, { pid: 4301, cpu: 1.1, io: 0, mem: 6e8 }, { pid: 4400, cpu: 2.6, io: 0, mem: 5e8 }, { pid: 4500, cpu: 0.8, io: 0, mem: 2e8 }, { pid: 4600, cpu: 0.4, io: 0, mem: 2e8 }, { pid: 4700, cpu: 1.4, io: 0, mem: 3e8 }, { pid: 4800, cpu: 1.6, io: 6e6, mem: 6e7 }],
    gpu: [{ pid: 4100, util: 78, engine: '3D', d3: 78 }, { pid: 4400, util: 4, engine: '3D', d3: 4 }, { pid: 4500, util: 6, engine: '3D', d3: 6 }],
    cpu: { total: 36, dpc: 0.6, irq: 0.2, maxFreq: 100, limit: 0 }, mem: { availMB: 6100, hardFaults: 12, commit: 14e9, limit: 26e9 }, disk: { busy: 14, queue: 0.1 }, sys: { queue: 0.4 } }));
  const push = () => { const copy = JSON.parse(JSON.stringify(state)); progressListeners.forEach((cb) => cb(copy)); };
  const facts = (node, text, level = 'info') => { state.facts.push({ node, text, level }); state.facts = state.facts.slice(-5); push(); };
  const go = (index, action) => { state.stageIndex = index; state.action = action; push(); };
  const nodes = (map) => { Object.assign(state.nodes, map); push(); };
  Object.assign(window.nexoDesktop, {
    onAnalysisProgress: (cb) => { progressListeners.add(cb); return () => progressListeners.delete(cb); },
    onGpuWake: (cb) => { wakeListeners.add(cb); return () => wakeListeners.delete(cb); },
    getDeepAnalysisStatus: async () => (state && state.status === 'running' ? JSON.parse(JSON.stringify(state)) : null),
    getLastDeepAnalysis: async () => saved,
    cancelDeepAnalysis: async () => { if (state) state.cancel = true; return { ok: true }; },
    runDeepAnalysis: async () => {
      const startedAt = Date.now();
      state = { status: 'running', stageIndex: 0, total: NexoDeep.STAGES.length, nodes: Object.fromEntries(NexoDeep.NODES.map((n) => [n.id, 'pending'])), facts: [], action: 'começando…', elapsedMs: 0, minMs: NexoDeep.MIN_TOTAL_MS };
      const tick = setInterval(() => { state.elapsedMs = (Date.now() - startedAt) / speed; }, 250);
      const stop = () => { clearInterval(tick); state.status = 'cancelled'; push(); return { cancelled: true }; };
      const profile = NexoHardware.identify(inventory);
      const lines = NexoHardware.factLines(profile);
      state.names = NexoHardware.shortNames(profile);
      const pick = (node) => lines.filter((line) => line.node === node);
      nodes({ cpu: 'active', board: 'active' }); go(0, 'lendo processador, placa-mãe, memória, vídeo, discos e rede…');
      await wait(2500); facts('cpu', pick('cpu')[0].text); nodes({ cpu: 'done' });
      await wait(1800); go(0, 'decodificando o chipset da placa-mãe…'); facts('board', pick('board')[0].text);
      await wait(1500); facts('board', 'B550: PCIe 4.0 no slot da placa de vídeo e no primeiro M.2; 3.0 nos demais'); nodes({ board: 'done', memory: 'seen', gpu: 'seen', disk: 'seen', network: 'seen', windows: 'seen' });
      if (state.cancel) return stop();
      // Memória: o teste de estabilidade.
      nodes({ memory: 'active' }); go(1, 'conferindo pentes, canais e a velocidade nominal…');
      await wait(1500); facts('memory', pick('memory')[0].text);
      await wait(1500); facts('memory', 'F4-3600C16-8GVKC: vendido para 3600 CL16');
      const patterns = ['endereço', 'xadrez', 'xadrez inverso', 'aleatório', 'bits andando'];
      for (let pass = 1; pass <= 10; pass += 1) { if (state.cancel) return stop(); go(1, `teste de estabilidade da memória: passada ${pass} (${patterns[(pass - 1) % 5]}) em 2 GB · nenhum erro`); await wait(1000); }
      facts('memory', '2 GB testados em 10 passadas: nenhum erro', 'ok');
      await wait(1200); facts('memory', 'Memória abaixo da velocidade da caixa: 2133 em vez de 3600', 'warn'); nodes({ memory: 'warn' });
      if (state.cancel) return stop();
      // Vídeo: a placa sob carga.
      nodes({ gpu: 'active' }); go(2, 'lendo placas de vídeo, drivers e monitores…');
      await wait(1600); facts('gpu', pick('gpu')[0].text);
      wakeListeners.forEach((cb) => cb({ ms: 8000 }));
      for (let i = 0; i < 6; i += 1) { if (state.cancel) return stop(); go(2, `placa de vídeo trabalhando · ${58 + i * 3} °C · ${1815 + i * 6} MHz · ${150 + i * 4} W · faltam ${45 - i * 7} s`); await wait(1300); }
      facts('gpu', 'sob carga: 73 °C, 1.845 MHz');
      await wait(1200); go(2, 'comparando a taxa do monitor com o máximo que ele aceita…'); facts('gpu', 'Monitor na taxa máxima (165 Hz)', 'ok'); nodes({ gpu: 'done' });
      // Disco: gravação de verdade.
      nodes({ disk: 'active' }); go(3, 'conferindo tipo, saúde e link dos discos…');
      await wait(1400); facts('disk', pick('disk')[0].text);
      for (let mb = 32; mb <= 256; mb += 64) { go(3, `gravando no disco: ${mb} MB…`); await wait(700); }
      go(3, 'gravações pequenas confirmadas: 150…'); await wait(1200);
      facts('disk', 'gravação: 2.140 MB/s · resposta 0,4 ms', 'ok'); nodes({ disk: 'done' });
      if (state.cancel) return stop();
      // Drivers.
      nodes({ board: 'active' }); go(4, 'lendo os drivers instalados de cada peça…');
      await wait(1500); facts('board', 'vídeo: NVIDIA GeForce RTX 3060 32.0.15.6094 (ago de 2026)');
      await wait(1300); facts('board', 'rede: Realtek RTL8852BE WiFi 6 6001.15.152.100 (fev de 2022)');
      await wait(1300); facts('board', '118 drivers conferidos'); nodes({ board: 'done' });
      // Windows: eventos.
      nodes({ windows: 'active' }); go(5, 'lendo 30 dias de eventos do sistema…');
      await wait(1700); facts('windows', 'Windows 11 24H2');
      await wait(1600); facts('windows', '30 dias: nenhuma tela azul', 'ok');
      await wait(1400); go(5, 'conferindo reinício pendente, inicialização e plano de energia…'); facts('windows', 'O Windows está esperando reiniciar', 'warn'); nodes({ windows: 'warn' });
      if (state.cancel) return stop();
      // Rede: um minuto medindo.
      nodes({ network: 'active' }); go(6, 'medindo a rede: roteador, internet e DNS…');
      await wait(1200); facts('network', pick('network')[0].text);
      for (let i = 0; i <= 90; i += 15) { go(6, `medindo a rede: ${i} de 90 pacotes até a internet…`); await wait(700); }
      go(6, 'conferindo DNS, proxy e a abertura de um site…'); await wait(1400);
      facts('network', 'internet: 14 ms · oscila 2,1 ms · perdeu 0%', 'ok'); nodes({ network: 'done' });
      // O que roda por trás.
      go(7, 'observando o que roda por trás (o próprio Nexo, jogos e launchers ficam de fora)…');
      for (let i = 1; i <= 10; i += 1) {
        if (state.cancel) return stop();
        await wait(1500);
        state.observed = { done: i * 3, of: 30, seconds: i * 9 };
        if (i === 1) facts(null, 'Roblox aberto: é o jogo, fica fora da lista de culpados');
        if (i === 3) facts(null, 'Navegador (chrome): 5,6% do processador', 'warn');
        go(7, `observando o que roda por trás: leitura ${i * 3} de 30`);
      }
      // Teste de carga.
      nodes({ cpu: 'active' });
      for (let left = 75; left > 0; left -= 15) { if (state.cancel) return stop(); go(8, `todos os núcleos no máximo · ${62 + (75 - left) / 5} °C · faltam ${left} s`); await wait(1500); }
      go(8, 'um núcleo só, para ver o turbo…'); await wait(2500); nodes({ cpu: 'done' });
      facts('cpu', 'sob carga: 71 °C, 4.080 MHz em todos os núcleos');
      // Juntando as pistas.
      go(9, 'conferindo se algo errou durante os testes…'); await wait(1500);
      go(9, 'relacionando 31 pistas de todas as etapas…'); facts(null, 'nenhum erro de hardware durante os testes', 'ok');
      await wait(1800); facts(null, '3 ponto(s) para ajustar, sem sinal de defeito', 'info');
      await wait(1200);
      clearInterval(tick);
      const observation = NexoDeep.summarizeObservation({ ticks, procs, services, selfPids: new Set([4700]), classify: NexoSession.classifyForeground, memoryTotalBytes: 16 * GB });
      const load = { multiSeconds: 10, bench: { multi: 4120, single: 612, threads: 15 }, clock: { allCoreMHz: 4080, singleMHz: 4110, startMHz: 4090, endMHz: 4070, dropPct: 0.5 }, limits: { maxFreqAvg: 100, perfLimitPeak: 0 }, temps: { cpuIdle: 42, cpuPeak: 71, gpuPeak: 58 }, gpu: { pcieGen: 4, pcieGenMax: 4, pcieGenHostMax: 4, pcieWidth: 8, pcieWidthMax: 8, clockMHz: 2655, clockMaxMHz: 2655, bar1MB: 8192, vramMB: 8188 }, links: [] };
      const health = { platform: 'win32', events: { bugcheck: { count: 0 }, unexpected: { count: 0 }, tdr: { count: 0 }, disk: { count: 0 }, storReset: { count: 0 }, ntfs: { count: 0 }, firmwareLimit: { count: 0 }, appCrash: { count: 2 }, updateFail: { count: 0 } }, wheaIds: [], crashes: [], rebootPending: { update: true }, fastStartup: true, lastBoot: new Date(Date.now() - 3 * 86400e3).toISOString(), pagefile: { automatic: true, files: [] }, software: ['AMD Chipset Software'], vcacheService: false, gameBar: true };
      // ?crash na prévia: um PC com telas azuis, para ver a causa provável (memória errando no teste).
      const crashy = /[?&]crash/.test(location.search);
      if (crashy) Object.assign(health, { events: { ...health.events, bugcheck: { count: 3, last: new Date(Date.now() - 2 * 86400e3).toISOString() } }, bugCodes: [{ code: '0x0000001a', count: 2 }, { code: '0x0000003b', count: 1 }], powerLoss: { bugcheck: 3, button: 2, silent: 0, sleep: 0 } });
      const tests = {
        memtest: { testedMB: 2048, passes: 10, errors: crashy ? 6 : 0, samples: crashy ? [{ bits: 1 }] : [], bandwidthMBs: 8800 },
        gpuStress: NexoDeep.summarizeGpuStress({ samples: [58, 61, 64, 67, 70, 73].map((temp, i) => ({ temp, clock: 1815 + i * 6, power: 150 + i * 4, powerLimit: 170, limits: { power: i > 3, thermal: false } })), seconds: 45 }),
        diskTest: { ok: true, sizeMB: 256, seqWriteMBs: 2140, latency: { p50Ms: 0.4, p99Ms: 1.9, maxMs: 7.2 } },
        drivers: NexoDeep.summarizeDrivers([{ name: 'NVIDIA GeForce RTX 3060', cls: 'DISPLAY', provider: 'NVIDIA', version: '32.0.15.6094', date: '2026-08-12', signed: true }, { name: 'Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter', cls: 'NET', provider: 'Realtek Semiconductor Corp.', maker: 'Realtek', version: '6001.15.152.100', date: '2022-02-10', signed: true }, { name: 'Realtek High Definition Audio', cls: 'MEDIA', provider: 'Realtek', version: '6.0.9235.1', date: '2021-09-01', signed: true }], Date.now()),
        network: { gateway: NexoDeep.summarizePings([3.1, 2.9, 3.4, 3.0, 6.2, 3.1], 0), internet: NexoDeep.summarizePings([14, 15, 13.8, 14.6, 21, 14.2], 0), doctor: null },
        during: { whea: 0, tdr: 0, disk: 0, gpu: 0 }
      };
      const findings = NexoDeep.buildFindings({ profile, health, facts: { hags: 2, historical: 0, gameMode: 1 }, observation, load, drives: [{ driveLetter: 'C', system: true, sizeBytes: 1e12, freeBytes: 3.1e11 }], startup: Array.from({ length: 9 }, (_, i) => ({ name: `App ${i}` })), ...tests });
      const report = { id: 'mock', at: Date.now(), durationMs: Math.max(NexoDeep.MIN_TOTAL_MS, (Date.now() - startedAt) / speed), platform: 'win32', onBattery: false, profile, lines, health, observation, load, findings, tests: { ...tests, drivers: tests.drivers.groups }, score: NexoDeep.healthScore(findings), history: [{ at: Date.now() - 20 * 86400e3, score: 52 }, { at: Date.now() - 9 * 86400e3, score: 58 }, { at: Date.now(), score: NexoDeep.healthScore(findings) }], comparison: saved ? NexoDeep.compareRuns(NexoDeep.runRecord({ at: Date.now(), profile, load, findings, observation }), NexoDeep.runRecord({ at: saved.at, profile, load: { ...load, bench: { multi: 4300, single: 620 } }, findings: saved.findings, observation })) : null };
      state.status = 'done'; state.stageIndex = NexoDeep.STAGES.length; push();
      saved = report;
      return report;
    }
  });

  /* Otimizar este PC (prévia): o plano e a execução usam o motor de verdade (src/optimizer.js) com um PC simulado. */
  const optListeners = new Set();
  const optEmit = (event) => optListeners.forEach((cb) => cb(event));
  const opt = (id, label, current, currentKind, options, extra = {}) => ({ id, label, available: true, values: options.find((o) => o.label === current)?.values || [null], current, currentKind, options, evidence: 'medido', risk: 'baixo', reboot: 'nao', admin: false, ...extra });
  const O = (label, values, kind = 'alternativa') => ({ label, values, kind });
  function mockDrivers() {
    const d = (name, cls, provider, version, date, ids) => ({ name, cls, provider, maker: provider, version, date, ids: ids || null, signed: true });
    return {
      platform: 'win32', at: Date.now(),
      devices: [
        d('NVIDIA GeForce RTX 4070 SUPER', 'DISPLAY', 'NVIDIA', '32.0.15.6614', '2025-10-30', '10DE:2783'),
        d('Intel(R) UHD Graphics 770', 'DISPLAY', 'Intel Corporation', '31.0.101.4502', '2023-06-10', '8086:4680'),
        d('Realtek Gaming 2.5GbE Family Controller', 'NET', 'Realtek', '10.50.511.2021', '2021-05-11', '10EC:8125'),
        d('Intel(R) Wi-Fi 6E AX211 160MHz', 'NET', 'Microsoft', '22.0.0.1', '2022-01-01', '8086:51F1'),
        d('WAN Miniport (IP)', 'NET', 'Microsoft', '10.0.22621.1', '2006-06-21'),
        d('Realtek(R) Audio', 'MEDIA', 'Realtek Semiconductor Corp.', '6.0.9235.1', '2021-09-01'),
        d('NVIDIA High Definition Audio', 'MEDIA', 'NVIDIA', '1.4.0.1', '2024-01-01'),
        d('Intel(R) Management Engine Interface #1', 'SYSTEM', 'Intel', '2229.1.4.0', '2022-07-18'),
        d('Intel(R) SMBus - 7AA3', 'SYSTEM', 'INTEL', '10.1.18793.8276', '2018-03-15'),
        d('Intel(R) Serial IO I2C Host Controller - 7AF8', 'SYSTEM', 'Intel Corporation', '30.100.2221.20', '2022-05-30'),
        d('Standard NVM Express Controller', 'SCSIADAPTER', 'Microsoft', '10.0.22621.3672', '2006-06-21'),
        d('Intel(R) Wireless Bluetooth(R)', 'BLUETOOTH', 'Intel Corporation', '23.60.0.1', '2024-06-20'),
        d('Elgato HD60 X', 'MEDIA', 'Elgato', '1.4.0.0', '2023-11-02', '0FD9:0082'),
        d('Parsec Virtual Display Adapter', 'DISPLAY', 'Parsec Cloud, Inc.', '0.45.0.0', '2023-02-10')
      ],
      others: [
        d('Logitech G502 HERO Gaming Mouse', 'MOUSE', 'Logitech', '1.1.48.0', '2024-03-12', '046D:C08B'),
        d('Razer Huntsman Mini', 'KEYBOARD', 'Razer Inc', '3.5.1.0', '2019-08-20', '1532:0257'),
        d('8BitDo Ultimate Controller', 'HIDCLASS', '8BitDo', '1.0.2.0', '2023-11-02', '2DC8:3106'),
        d('EPSON L3250 Series', 'PRINTER', 'EPSON', '3.1.0.0', '2022-02-15', '04B8:1188'),
        d('Wacom Tablet', 'HIDCLASS', 'Wacom Technology', '6.4.5.4', '2024-09-01', '056A:0374')
      ],
      generic: 94,
      runtimes: {
        os: { build: 22631, name: 'Windows 11 Pro', display: '23H2' },
        board: { maker: 'ASUSTeK COMPUTER INC.', product: 'TUF GAMING B760M-PLUS WIFI', systemMaker: 'System manufacturer', model: 'System Product Name', mobile: false },
        vc: { x64: '14.44.35211.00', x86: null, arm64: null },
        uninstall: [{ name: 'Microsoft Visual C++ 2010  x64 Redistributable - 10.0.40219', version: '10.0.40219' }, { name: 'Microsoft Visual C++ 2013 Redistributable (x64) - 12.0.40664', version: '12.0.40664' }, { name: 'NVIDIA PhysX System Software 9.23.1019', version: '9.23.1019' }],
        dx: { d3dx9: false, xinput13: true, x3daudio: true }, netfx: 533320, desktop: ['8.0.11', '9.0.6'], vulkan: '1.4.303.0', amd: null,
        missing: [{ name: 'Dispositivo PCI', code: 28, cls: '', ids: '8086:7AE8' }]
      },
      latest: {
        nvidia: { modern: { version: '621.14', date: '2026-11-04', name: 'GeForce Game Ready Driver', details: 'https://www.nvidia.com/en-us/drivers/details/283968/', size: '1.04 GB' } },
        dotnet: { '9.0': { latest: '9.0.23', phase: 'eol', eol: '2026-11-10' }, '8.0': { latest: '8.0.34', phase: 'eol', eol: '2026-11-10' } }
      }
    };
  }
  const mockScan = { items: [
    opt('gamedvr', 'Gravação em segundo plano', 'Ligada', 'padrao', [O('Ligada', [1, 1], 'padrao'), O('Desligada', [0, 0], 'recomendado')], { reboot: 'sessao' }),
    opt('gamemode', 'Modo de Jogo', 'Desligado', 'alternativa', [O('Ligado', [1], 'recomendado'), O('Desligado', [0])]),
    opt('deliveryopt', 'Otimização de Entrega', 'Também de outros PCs', 'padrao', [O('Também de outros PCs', [null], 'padrao'), O('Só da Microsoft', [0], 'recomendado')], { admin: true }),
    opt('powerthrottling', 'Limitação de energia em segundo plano', 'Padrão do Windows', 'padrao', [O('Padrão do Windows', [null], 'padrao'), O('Desligada', [1])], { admin: true, reboot: 'reiniciar' }),
    opt('lastaccess', 'Data de último acesso (NTFS)', 'Ligada', 'padrao', [O('Ligada', [2147483650], 'padrao'), O('Desligada', [2147483649], 'recomendado')], { admin: true, reboot: 'reiniciar' }),
    opt('edgebg', 'Edge rodando escondido', 'Roda escondido', 'padrao', [O('Roda escondido', [null], 'padrao'), O('Não roda escondido', [0, 0], 'recomendado')], { admin: true }),
    opt('suggestions', 'Sugestões e dicas do Windows', 'Ligadas', 'padrao', [O('Ligadas', [1, 1], 'padrao'), O('Desligadas', [0, 0], 'recomendado')], { reboot: 'sessao' }),
    opt('sysresp', 'Reserva para tarefas de fundo', '20%', 'padrao', [O('20%', [20], 'padrao'), O('Mínima (10%)', [10])], { evidence: 'controverso', admin: true, reboot: 'reiniciar' }),
    opt('netthrottle', 'Limite de rede para multimídia', '10 pacotes/ms', 'padrao', [O('10 pacotes/ms', [10], 'padrao'), O('Sem limite', [4294967295])], { evidence: 'controverso', admin: true, reboot: 'reiniciar' })
  ] };
  const mockStartup = [
    { source: 'user-run', name: 'Steam', exe: 'steam.exe', description: 'Steam', enabled: true },
    { source: 'user-run', name: 'EpicGamesLauncher', exe: 'EpicGamesLauncher.exe', description: 'Epic Games Launcher', enabled: true },
    { source: 'user-run', name: 'Discord', exe: 'Update.exe', description: 'Discord', enabled: true },
    { source: 'machine-run', name: 'SecurityHealth', exe: 'SecurityHealthSystray.exe', enabled: true, elevated: true },
    { source: 'user-run', name: 'Spotify', exe: 'Spotify.exe', description: 'Spotify', enabled: true },
    { source: 'machine-run', name: 'RtkAudUService', exe: 'RtkAudUService64.exe', description: 'Realtek HD Audio Universal Service', enabled: true, elevated: true },
    { source: 'user-run', name: 'com.squirrel.Teams.Teams', exe: 'Update.exe', description: 'Microsoft Teams', enabled: true },
    { source: 'user-folder', name: 'iCUE.lnk', exe: 'iCUE.exe', description: 'iCUE', company: 'Corsair', enabled: true }
  ];
  const mockNics = [{ guid: '{11111111-2222-3333-4444-555555555555}', name: 'Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter', media: 'wifi', props: [{ keyword: 'RoamAggressiveness', value: '2', display: 'Médio', valid: ['0', '1', '2', '3', '4'] }, { keyword: 'RoamingPreferredBandType', value: '0', display: 'Sem preferência', valid: ['0', '1', '2'] }] }];
  const mockNicTweaks = [
    { keyword: 'RoamAggressiveness', media: 'wifi', target: '0', from: ['2', '3', '4'], risk: 'moderado', evidence: 'varia', label: 'Busca por outro roteador (roaming)', why: 'Com o roaming alto, o Wi-Fi para de tempos em tempos para procurar outro ponto de acesso, e o ping dá picos.' },
    { keyword: 'RoamingPreferredBandType', media: 'wifi', target: '2', from: ['0', '1'], risk: 'baixo', evidence: 'varia', label: 'Preferir 5 GHz', why: 'Em 5 GHz há menos interferência de vizinhos e de aparelhos da casa.' }
  ];
  let optPlan = null;
  const publicPlan = (plan) => ({ ...plan, steps: plan.steps.map(({ change, ...step }) => ({ ...step, changes: change?.kind === 'reboot-test' ? change.changes : undefined })) });
  const buildMockPlan = (options = {}) => {
    const game = options.game === 'roblox' ? { name: 'Roblox', exe: 'C:\\Users\\voce\\AppData\\Local\\Roblox\\Versions\\v\\RobloxPlayerBeta.exe', exeName: 'RobloxPlayerBeta.exe' } : null;
    optPlan = NexoOptimizer.buildPlan({ report: { ...saved, plan: NexoDeep.plan(saved.profile, saved.findings) }, scan: mockScan, startup: mockStartup, nics: mockNics, game, power: { active: '381b4222-f694-41f0-9685-ff5bb260df2e' }, nicTweaks: mockNicTweaks, allowRisk: options.allowRisk || 'moderado', sensors: true });
    return optPlan;
  };
  Object.assign(window.nexoDesktop, {
    optimizerGames: async () => [{ key: 'roblox', name: 'Roblox', exeName: 'RobloxPlayerBeta.exe', source: 'roblox' }, { key: 'lib:cs2', name: 'Counter-Strike 2', exeName: 'cs2.exe', source: 'steam' }, { key: 'lib:val', name: 'VALORANT', exeName: 'VALORANT.exe', source: 'riot' }],
    planOptimization: async (options) => { if (!saved) throw new Error('Faça a análise profunda primeiro: o plano sai dela.'); await wait(900); const plan = buildMockPlan(options); return { supported: true, plan: publicPlan(plan), sensors: true, onBattery: false, reportAt: saved.at, startupCount: 8 }; },
    onOptimizerEvent: (cb) => { optListeners.add(cb); return () => optListeners.delete(cb); },
    getOptimizationStatus: async () => ({ running: false }),
    cancelOptimization: async () => { if (window.__optSignal) window.__optSignal.cancelled = true; return { ok: true }; },
    runOptimization: async (options) => {
      const picked = new Set(options.selected || []);
      const plan = { ...optPlan, steps: optPlan.steps.map((step) => ({ ...step, selected: picked.has(step.id) })) };
      const signal = { cancelled: false }; window.__optSignal = signal;
      let phase = 0;
      const system = {
        now: () => Date.now(), preflight: async () => ({ platform: 'win32', onBattery: false, cpuLoad: 8, tempC: 46 }),
        bench: async (name) => { await wait(140); const base = { single: 612, multi: 4120, burst: 900, frames: 1500, latency: 800 }[name] || 1000; return base * (phase ? 1.045 : 1) * (1 + Math.random() * 0.01); },
        ping: async () => { await wait(300); return { gatewayMs: phase ? 2.1 : 3.4 + Math.random() * 0.1, gatewayJitter: phase ? 0.5 : 1.6, internetMs: 18 + Math.random() * 0.3, internetJitter: 1.1 }; },
        apply: async (changes) => { await wait(1500); phase = 1; return { records: changes.map((change, i) => ({ id: 'c' + (i + 1), stepId: change.stepId, ok: true })), restore: { ok: true, created: true, note: '' } }; },
        revert: async (records) => ({ records: records.map((record) => ({ id: record.id, ok: true })) }),
        lab: async () => { for (let i = 1; i <= 6; i += 1) { await wait(700); optEmit({ type: 'lab', event: { type: 'trial', pair: i, pairs: 6 } }); } return { status: 'completed', adopted: { name: 'Nexo — Ajustado', guid: 'x', before: {} }, combination: { compositeDelta: 4.2 }, evidence: {}, tabu: [] }; },
        waitNetwork: async () => { await wait(800); return true; }
      };
      const result = await NexoOptimizer.run(system, plan, { consent: options.consent, allowRisk: options.allowRisk, signal, rounds: 2, emit: optEmit });
      return { ...result, id: 'opt-mock', summary: NexoOptimizer.summarize(result, plan) };
    },
    fixFinding: async ({ ids }) => { await wait(900); const steps = (optPlan || buildMockPlan()).steps.filter((step) => ids.includes(step.id)); return { id: 'fix-mock', status: 'completed', steps: Object.fromEntries(steps.map((step) => [step.id, { status: 'feito', note: '' }])), records: steps.map((step, i) => ({ id: 'c' + i, stepId: step.id, kind: step.kind, title: step.title, risk: step.risk, reboot: step.reboot || 'nao' })) }; },
    revertOptimization: async () => ({ reverted: 1, failed: 0, declined: false, remaining: 0 }),
    restartComputer: async () => ({ ok: true, seconds: 15 }), abortRestart: async () => ({ ok: true }),
    openVendorPage: async () => ({ ok: true }), openMemoryTest: async () => ({ ok: true }),
    // Página de Drivers: um desktop com NVIDIA + vídeo Intel, rede Realtek, Wi-Fi Intel genérico e componentes de jogo.
    scanDrivers: async () => { await wait(1200); return mockDrivers(); },
    // Na prévia não há internet: os ícones oficiais (que o app busca no site de cada fabricante) não aparecem.
    vendorIcons: async () => ({}),
    afterBootStatus: async () => null,
    runAfterBoot: async () => ({ status: 'completed', comparison: {}, undone: [], rebootAgain: false, log: [] })
  });
})();
