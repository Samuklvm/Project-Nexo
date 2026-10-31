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

  let tick = 0;
  const wave = (base, amp, speed) => Math.max(1, Math.min(99, base + Math.sin(tick / speed) * amp + (Math.random() - 0.5) * 4));
  const drives = [{ driveLetter: 'C', name: 'Windows (NVMe)', fileSystem: 'NTFS', sizeBytes: 953e9, usedBytes: 786e9, freeBytes: 167e9, usedPercent: 82 }, { driveLetter: 'D', name: 'Jogos', fileSystem: 'NTFS', sizeBytes: 1e12, usedBytes: 410e9, freeBytes: 590e9, usedPercent: 41 }];
  const sensors = { status: 'ready', collectedAt: Date.now(), sensorCount: 6, issues: [], devices: [
    { name: 'AMD Ryzen 7 5700X', type: 'Cpu', path: '/amdcpu/0', sensors: [
      { name: 'Core #1', type: 'Clock', value: 4620, min: 3400, max: 4650, unit: 'MHz', advanced: false },
      { name: 'CPU Package', type: 'Temperature', value: 61, min: 38, max: 79, unit: '°C', advanced: false },
      { name: 'CPU Total', type: 'Load', value: 18, min: 2, max: 100, unit: '%', advanced: false }] },
    { name: 'NVIDIA GeForce RTX 4060', type: 'GpuNvidia', path: '/gpu-nvidia/0', sensors: [
      { name: 'GPU Core', type: 'Load', value: 9, min: 0, max: 98, unit: '%', advanced: false },
      { name: 'GPU Core', type: 'Temperature', value: 47, min: 33, max: 71, unit: '°C', advanced: false },
      { name: 'GPU Fan', type: 'Fan', value: 0, min: 0, max: 2100, unit: 'RPM', advanced: true }] }] };
  window.nexoDesktop = {
    getSystemSnapshot: async () => { tick += 1; return {
      hostname: 'DESKTOP-NEXO', operatingSystem: 'Windows_NT 10.0.26100', cpuModel: 'AMD Ryzen 7 5700X', logicalCpuCount: 16,
      cpuUsage: wave(22, 14, 5), memoryTotalBytes: 32e9, memoryUsedBytes: 17.6e9, memoryPercent: Math.round(wave(55, 3, 9)),
      networkConnected: true, uptimeSeconds: 3 * 86400 + 4 * 3600, drives, primaryDrive: drives[0], version: '0.2.0',
      temperatureReadings: { acpiSensors: [{ celsius: 41 }], gpuSensors: [{ temperatureCelsius: 47, usagePercent: 9 }] } }; },
    getHardwareSensors: async () => sensors,
    getTopProcesses: async () => ({ byCpu: [{ processId: 4120, name: 'chrome', cpuPercent: 31, memoryBytes: 2.1e9, memoryPercent: 6 }, { processId: 912, name: 'Code', cpuPercent: 9, memoryBytes: 1.1e9, memoryPercent: 3 }], byMemory: [{ processId: 4120, name: 'chrome', cpuPercent: 31, memoryBytes: 2.1e9, memoryPercent: 6 }, { processId: 77, name: 'dwm', cpuPercent: 3, memoryBytes: 0.4e9, memoryPercent: 1 }] }),
    scanCleanup: async () => ({ categories: [
      { id: 'temp', label: 'Temporários antigos', description: 'Arquivos com mais de 7 dias na pasta temporária do usuário (sem subpastas).', fileCount: 842, bytes: 1.9e9, destructive: false },
      { id: 'crashdumps', label: 'Relatórios de falha de programas', description: 'Despejos de memória (.dmp) de programas que travaram, com mais de 7 dias.', fileCount: 6, bytes: 640e6, destructive: false },
      { id: 'wer', label: 'Relatórios de erro do Windows', description: 'Relatórios antigos, enviados ou pendentes, do Relatório de Erros do Windows.', fileCount: 0, bytes: 0, destructive: false },
      { id: 'recycle', label: 'Lixeira', description: 'Esvazia a Lixeira de todas as unidades. Os arquivos não poderão ser recuperados.', fileCount: 31, bytes: 3.2e9, destructive: true }] }),
    getCleanupPreview: async () => ({ fileCount: 842, bytes: 1.9e9 }),
    runCleanup: async () => ({ results: [], removedCount: 848, bytesFreed: 2.5e9 }),
    cleanupTempFiles: async () => ({ removedCount: 0, bytesFreed: 0 }),
    listPowerPlans: async () => [{ guid: 'a', name: 'Equilibrado', active: true }, { guid: 'b', name: 'Alto desempenho', active: false }, { guid: 'c', name: 'Economia de energia', active: false }],
    setPowerPlan: async () => ({ ok: true, plans: [] }),
    listStartupItems: async () => [{ name: 'Discord', command: 'C:\\Users\\voce\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe' }, { name: 'SecurityHealth', command: '%windir%\\system32\\SecurityHealthSystray.exe' }, { name: 'Steam', command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent' }],
    openWindowsSettings: async () => ({ ok: true }), getAppInfo: async () => ({ version: '0.2.0', packaged: false, userDataPath: 'C:\\Users\\voce\\AppData\\Roaming\\nexo-device-care', userDataBytes: 1.4e6 }),
    getWallpaper: async () => ({ url: null }), getPrivacy: async () => ({ shareWithCreator: false }), setPrivacy: async () => ({}),
    listDrives: async () => drives, optimizeDrive: async () => ({}), repairSystemFiles: async () => ({}), openTaskManager: async () => ({}), openLink: async () => ({}),
    checkForUpdates: async () => ({ state: 'current' }), onUpdateStatus: () => () => {}, getWindowState: async () => ({ maximized: false }), onWindowState: () => () => {},
    minimizeWindow() {}, toggleMaximizeWindow() {}, closeWindow() {}
  };
})();
