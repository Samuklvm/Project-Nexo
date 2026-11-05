window.__nexoPlatform = /[?&]linux/.test(location.search) ? 'linux' : 'win32';
/* Ponte simulada: permite abrir a interface num navegador comum (dev/preview.html) sem o Electron.
   Gera uma semana de histórico fictício para mostrar gráficos, rotina e análise. Não entra no instalador. */
(function () {
  const MIN = 60000;
  const now = Date.now();
  const seeded = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
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
    getHardwareSensors: async () => { const gpu = sensors.devices[1].sensors[0]; gpu.value = window.__mockGameMode ? 94 + Math.random() * 5 : 9; return { ...sensors, collectedAt: Date.now() }; },
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
    runCpuBench: async ({ mode, ms }) => { await new Promise((resolve) => setTimeout(resolve, ms > 500 ? 220 : 80)); const boost = plans.find((plan) => plan.active)?.guid === 'b' ? 1.09 : 1; return { mode, threads: mode === 'single' ? 1 : 7, ms, mopsPerSec: (mode === 'single' ? 152 : 880) * boost * (1 + (Math.random() - 0.5) * 0.024) }; },
    openDoc: async () => ({ ok: true }),
    listStartupItems: async () => [{ name: 'Discord', command: 'C:\\Users\\voce\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe' }, { name: 'SecurityHealth', command: '%windir%\\system32\\SecurityHealthSystray.exe' }, { name: 'Steam', command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent' }],
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
    startFps: async () => { fpsFrames = []; clearInterval(fpsTimer); fpsTimer = setInterval(() => { for (let i = 0; i < 75; i++) fpsFrames.push({ ms: i % 40 === 0 ? 75 : 12.5 + Math.random() }); listeners.fps.forEach((cb) => cb({ fps: 72 + Math.random() * 6, worstMs: 20, frames: fpsFrames.length })); }, 1000); return { ok: true }; },
    stopFps: async () => { clearInterval(fpsTimer); const frames = fpsFrames.map((frame) => ({ ...frame, cpuBusy: 5, gpuBusy: frame.ms * 0.97 })); return { summary: NexoFps.summarize(frames), series: NexoFps.perSecond(frames), frames: frames.length }; },
    onFpsUpdate: (cb) => { listeners.fps.add(cb); return () => listeners.fps.delete(cb); },
    onFpsError: (cb) => { listeners.fpsError.add(cb); return () => listeners.fpsError.delete(cb); },
    onFpsEnded: (cb) => { listeners.fpsEnded.add(cb); return () => listeners.fpsEnded.delete(cb); }
  });
})();
// ---- 0.5.0 (simulado): biblioteca, laboratório, Atlas, conta e segundo plano. Nomes de jogos inventados.
(function () {
  const cover = (title, hue, shape) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='900'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='hsl(${hue},70%,55%)'/><stop offset='1' stop-color='hsl(${hue + 40},60%,12%)'/></linearGradient><radialGradient id='s' cx='.7' cy='.3' r='.6'><stop offset='0' stop-color='hsl(${hue + 180},90%,75%)' stop-opacity='.9'/><stop offset='1' stop-color='hsl(${hue + 180},90%,75%)' stop-opacity='0'/></radialGradient></defs><rect width='600' height='900' fill='url(#g)'/><circle cx='420' cy='260' r='${shape}' fill='url(#s)'/><path d='M0 700 L160 560 L300 650 L460 500 L600 620 L600 900 L0 900Z' fill='hsl(${hue + 20},50%,8%)' opacity='.85'/><text x='40' y='800' font-family='Segoe UI,Arial' font-weight='800' font-size='58' fill='white'>${title}</text></svg>`)}`;
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
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  Object.assign(window.nexoDesktop, {
    scanGames: async () => { await wait(500); return games; }, listGames: async () => games, launchGame: async () => ({ ok: true }), revealGame: async () => ({ ok: true }),
    setGameCover: async () => ({ canceled: true }), addGame: async () => ({ canceled: true }), removeManualGame: async () => ({ games }), onGamesUpdated: () => () => {},
    getSettings: async () => ({ ...settings }), setSettings: async (patch) => { Object.assign(settings, patch); listeners.settings.forEach((cb) => cb({ ...settings })); return { ...settings }; },
    onSettingsChanged: (cb) => { listeners.settings.add(cb); return () => listeners.settings.delete(cb); }, onWatchGame: () => () => {}, currentWatchedGame: async () => null,
    getFpsAccess: async () => ({ platform: 'win32', inToken: false, member: false, admin: false, ready: false, needsRelogin: false }),
    grantFpsAccess: async () => ({ ok: true, changed: true, declined: false, access: { platform: 'win32', inToken: false, member: true, admin: false, ready: false, needsRelogin: true } }), revokeFpsAccess: async () => ({ ok: true }),
    getSystemFacts: async () => ({ platform: 'win32', memory: [{ speed: 3600, configured: 2666, capacity: 16e9 }, { speed: 3600, configured: 2666, capacity: 16e9 }], displays: [{ name: 'NVIDIA GeForce RTX 4060', current: 60, max: 165 }], hags: 2, gameMode: 1, capture: 1, vbs: 2, hvci: true }),
    getAccount: async () => account, signIn: async () => { await wait(600); account = { ...account, profile: { name: 'Sam Exemplo', email: 'voce@exemplo.com', signedInAt: Date.now() } }; return account; },
    signOut: async () => { account = { ...account, profile: null }; return account; }, importOAuthConfig: async () => account,
    getLabStatus: async () => ({ running: false, pending: false, platform: 'win32', space: NexoLab.SPACE }),
    labPreflight: async () => ({ platform: 'win32', onBattery: false, tempC: 47, cpuLoad: 9, pending: false, knobs: Object.fromEntries(NexoLab.SPACE.map((knob) => [knob.id, { available: knob.id !== 'boostpol', current: knob.values[0] }])) }),
    cancelLab: async () => { cancelled = true; return { ok: true }; }, recoverLab: async () => ({ recovered: false }), onLabRecovered: () => () => {},
    onLabEvent: (cb) => { listeners.lab.add(cb); return () => listeners.lab.delete(cb); },
    adoptLab: async () => ({ guid: 'x', name: 'Nexo — Ajustado (simulado)', before: { guid: 'a', name: 'Equilibrado' } }),
    runLab: async (options) => {
      cancelled = false;
      const emit = (event) => listeners.lab.forEach((cb) => cb(event));
      const log = [];
      const say = (message) => { const entry = { t: Date.now(), message }; log.push(entry); emit({ type: 'log', ...entry }); };
      const plan = [['perfepp', 33, 0, { single: 0.4, multi: 0.2, burst: 6.8 }, 1.5], ['minstate', 5, 100, { single: 0.8, multi: 0.1, burst: 9.1 }, 2.1], ['mincores', 10, 100, { single: 0.2, multi: -0.3, burst: 1.1 }, 0.4], ['boostmode', 1, 2, { single: 3.9, multi: -4.6, burst: 2.2 }, 6.5]].slice(0, options.maxArms || 4);
      const stages = [['preflight', 'Conferindo se é seguro começar'], ['ponto', 'Criando ponto de restauração do Windows'], ['preparar', 'Clonando o plano de energia'], ['aquecer', 'Aquecendo']];
      for (const [stage, detail] of stages) { emit({ type: 'stage', stage, detail }); await wait(450); }
      say('Pré-checagem ok: na tomada, 47 °C, processador 9% ocupado. Ajustes disponíveis: 6.'); say('Ponto de restauração criado.');
      say(`Ideias escolhidas para hoje: ${plan.map(([id]) => NexoLab.knob(id).label).join('; ')}.`);
      const arms = [];
      for (const [id, from, to, deltas, temp] of plan) {
        if (cancelled) break;
        const knob = NexoLab.knob(id);
        emit({ type: 'stage', stage: 'testar', detail: `${knob.label}: ${NexoLab.valueLabel(knob, from)} → ${NexoLab.valueLabel(knob, to)}` });
        for (let pair = 1; pair <= 3; pair += 1) { await wait(380); emit({ type: 'trial', arm: `${id}=${to}`, pair, pairs: 3 }); }
        const results = Object.fromEntries(Object.entries(deltas).map(([bench, delta]) => [bench, { verdict: delta > 3 ? 'melhorou' : delta < -3 ? 'piorou' : 'sem-diferenca', deltaPct: delta, noisePct: 0.9 }]));
        const combined = NexoLab.combine(results);
        const arm = { key: `${id}=${to}`, knob: id, value: to, from, label: knob.label, valueLabel: NexoLab.valueLabel(knob, to), fromLabel: NexoLab.valueLabel(knob, from), risk: knob.risk, novelty: 'inedito-aqui', results, tempDelta: temp, ...combined };
        arms.push(arm); emit({ type: 'arm', arm }); say(`${knob.label} → ${arm.valueLabel}: ${arm.verdict}.`);
      }
      let combination = null;
      if (!cancelled) {
        emit({ type: 'stage', stage: 'confirmar', detail: 'Confirmando a combinação com 5 repetições' });
        for (let pair = 1; pair <= 5; pair += 1) { await wait(260); emit({ type: 'trial', arm: 'combinacao', pair, pairs: 5 }); }
        combination = { config: { perfepp: 0, minstate: 100 }, knobs: ['minstate=100', 'perfepp=0'], replicates: 5, verdict: 'melhorou', compositeDelta: 4.1, results: {} };
        say('Combinação: melhorou (+4,1%).');
      }
      emit({ type: 'stage', stage: 'restaurar', detail: 'Voltando ao plano original' }); await wait(400); say('Plano original de volta; o clone de testes foi apagado.');
      const adopted = !cancelled && options.autonomy === 'autonomo' ? { guid: 'adj', name: 'Nexo — Ajustado (simulado)', before: { guid: 'a', name: 'Equilibrado' }, config: combination.config } : null;
      emit({ type: 'done' });
      let evidence = options.evidence || {};
      for (const arm of arms) evidence = NexoLab.updateEvidence(evidence, arm.key, { delta: arm.compositeDelta, verdict: arm.verdict });
      return { riskSession: true, startedAt: Date.now() - 8000, status: cancelled ? 'cancelled' : 'completed', autonomy: options.autonomy, restorePoint: { ok: true, created: true }, baseline: { perfepp: 33, minstate: 5 }, arms, combination, adopted, evidence, tabu: options.tabu || [], log, restoreFailed: false };
    }
  });
})();
// ---- 0.6.0 (simulado): artes largas e logos, conta Steam/Xbox/Discord, custo do app. Tudo inventado.
(function () {
  const wide = (title, hue) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='620'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue},70%,45%)'/><stop offset='1' stop-color='hsl(${hue + 50},60%,10%)'/></linearGradient><radialGradient id='s' cx='.75' cy='.35' r='.5'><stop offset='0' stop-color='hsl(${hue + 180},90%,80%)' stop-opacity='.95'/><stop offset='1' stop-color='hsl(${hue + 180},90%,80%)' stop-opacity='0'/></radialGradient></defs><rect width='1920' height='620' fill='url(#g)'/><circle cx='1400' cy='220' r='260' fill='url(#s)'/><path d='M0 520 L300 380 L620 470 L900 330 L1240 450 L1600 300 L1920 420 L1920 620 L0 620Z' fill='hsl(${hue + 20},50%,7%)' opacity='.9'/></svg>`)}`;
  const logo = (title) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='160'><text x='4' y='110' font-family='Segoe UI,Arial' font-weight='900' font-style='italic' font-size='92' fill='white' letter-spacing='-2'>${title.toUpperCase()}</text></svg>`)}`;
  const original = window.nexoDesktop.scanGames;
  const extraHero = { 'Aurora Drift': 205, 'Velvet Circuit': 300, 'Cinder Vale': 18, 'Neon Tide': 320 };
  const playtime = { 'Aurora Drift': 5240, 'Velvet Circuit': 1980, 'Cinder Vale': 640, 'Neon Tide': 3120, 'Pale Harbor': 410, 'Rift Runner': 8200, 'Hollow Signal': 95 };
  window.nexoDesktop.scanGames = async () => {
    const games = (await original()).map((game) => ({ ...game, installed: true, playtimeMin: playtime[game.name] ?? null,
      hero: extraHero[game.name] !== undefined ? wide(game.name, extraHero[game.name]) : null, logo: extraHero[game.name] !== undefined ? logo(game.name) : null }));
    const cover = games[0].cover;
    return [...games, { id: 'steam-900', name: 'Glass Orchard', source: 'steam', sourceLabel: 'Steam', hue: 90, installed: false, fromAccount: 'steam', playtimeMin: 2400, lastPlayed: Date.now() - 200 * 864e5, cover: cover.replace(/Aurora%20Drift/g, 'Glass%20Orchard'), canLaunch: true, coverSource: 'capa oficial (cache da Steam)' },
      { id: 'xboxconta-1', name: 'Tidebreak Legends', source: 'xboxconta', sourceLabel: 'Conta Xbox', hue: 30, installed: false, fromAccount: 'xbox', playtimeMin: null, lastPlayed: Date.now() - 90 * 864e5, cover: null, canLaunch: false }];
  };
  let connections = { steam: { installed: true, connected: true, steamId: '76561198000000002', personaName: 'Estrela Cadente', avatar: null, hasKey: true, owned: 214, detected: [] }, xbox: { configured: true, connected: false, titles: 0 }, discord: { configured: true, enabled: true, showGame: true, showNexo: false, ready: true }, nintendo: { available: false } };
  Object.assign(window.nexoDesktop, {
    getConnections: async () => connections, connectSteam: async () => connections, disconnectSteam: async () => connections, setSteamKey: async () => connections,
    signInXbox: async () => { connections = { ...connections, xbox: { configured: true, connected: true, gamertag: 'EstrelaNX', titles: 128 } }; return connections; }, signOutXbox: async () => connections,
    setDiscord: async (patch) => { connections = { ...connections, discord: { ...connections.discord, ...patch } }; return connections; }, updatePresence: async () => ({ ok: true }), importIntegrations: async () => connections,
    fetchGameArt: async () => ({ found: 1 }), onArtProgress: () => () => {},
    getSelfMetrics: async () => ({ cpu: 0.4 + Math.random() * 0.3, memMB: 182 + Math.random() * 6, processes: 5 }), getHardwareTier: async () => ({ cores: 16, memGB: 31.9, tier: 'forte' })
  });
})();
// ---- Revisão 0.6.0 (simulado): página completa do jogo. Textos e imagens inventados.
(function () {
  const shot = (hue, k) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='338'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue + k * 25},70%,40%)'/><stop offset='1' stop-color='hsl(${hue + k * 25 + 60},60%,10%)'/></linearGradient></defs><rect width='600' height='338' fill='url(#g)'/><circle cx='${120 + k * 70}' cy='${90 + k * 20}' r='${40 + k * 8}' fill='white' opacity='.18'/><path d='M0 280 L140 200 L260 250 L420 160 L600 240 L600 338 L0 338Z' fill='black' opacity='.45'/></svg>`)}`;
  const icon = (hue, on) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='10' fill='hsl(${hue},${on ? 70 : 5}%,${on ? 45 : 25}%)'/><path d='M32 12l6 14 15 1-12 9 4 15-13-8-13 8 4-15-12-9 15-1z' fill='white' opacity='${on ? 0.95 : 0.35}'/></svg>`)}`;
  const names = [['Primeiro passo', 'Termine o prólogo.', 92.4], ['Sem olhar para trás', 'Vença o primeiro chefe sem levar dano.', 31.2], ['Colecionador', 'Encontre 50 fragmentos de estrela.', 18.7], ['Maratonista', 'Jogue 50 horas.', 12.1], ['Lenda do céu', 'Termine no modo mais difícil.', 2.3], ['Final verdadeiro', null, 4.8]];
  Object.assign(window.nexoDesktop, {
    getGameDetails: async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const hue = 205;
      return { consent: true, appid: '900001', matched: false,
        store: { appid: '900001', name: 'Aurora Drift', description: 'Pilote uma nave-vela entre as auroras de um planeta em ruínas, desvie de chuvas de meteoros e descubra por que as estrelas pararam de cair.', about: 'Aurora Drift é um jogo de exploração e corrida com física de vento.\n\nRecursos:\nCampanha de 20 horas\nModo foto\nTrilha sonora orquestral', developers: ['Estúdio Exemplo'], publishers: ['Editora Exemplo'], genres: ['Aventura', 'Corrida', 'Indie'], categories: ['Um jogador', 'Conquistas Steam', 'Suporte total a controle', 'Nuvem Steam'], release: '12 mar. 2025', comingSoon: false, price: 'R$ 59,99', metacritic: 87, recommendations: 48210, achievementsTotal: 6, controller: 'full', header: null,
          screenshots: [0, 1, 2, 3, 4, 5].map((k) => ({ thumb: shot(hue, k), full: shot(hue, k) })),
          requirements: { minimum: 'Mínimos:\nSO: Windows 10 64 bits\nProcessador: Quad-core 3 GHz\nMemória: 8 GB de RAM\nPlaca de vídeo: GTX 1050 Ti\nArmazenamento: 25 GB', recommended: 'Recomendados:\nSO: Windows 11 64 bits\nProcessador: Ryzen 5 5600\nMemória: 16 GB de RAM\nPlaca de vídeo: RTX 3060\nArmazenamento: 25 GB em SSD' } },
        news: [{ id: '1', kind: 'atualizacao', title: 'Atualização 1.4.2: menos travadas no capítulo 3', date: Date.now() - 2 * 864e5, source: 'Anúncio oficial', summary: 'Correções\nMenos engasgos ao entrar na tempestade de meteoros.\nCarregamento 30% mais rápido em HDs.', url: null },
          { id: '2', kind: 'anuncio', title: 'Evento de inverno: céus congelados', date: Date.now() - 12 * 864e5, source: 'Anúncio oficial', summary: 'Até 10 de janeiro, novas rotas e uma vela exclusiva.', url: null },
          { id: '3', kind: 'atualizacao', title: 'Patch 1.4.0: modo foto e DLSS', date: Date.now() - 30 * 864e5, source: 'Anúncio oficial', summary: 'Modo foto completo.\nSuporte a DLSS 3 e FSR 3.', url: null }],
        achievements: { state: 'ok', unlocked: 4, total: 6, list: names.map(([name, description, percent], index) => ({ id: String(index), name, description: index === 5 ? null : description, hidden: index === 5, achieved: index < 4, unlockedAt: index < 4 ? Date.now() - (40 - index * 9) * 864e5 : null, icon: icon(hue + index * 30, index < 4), percent })) } };
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
