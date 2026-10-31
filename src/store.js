/* Dados locais: histórico de 7 dias, aprendizado (Nexo Brain), feedback e leituras ao vivo. */
(function () {
  const MIN = 60 * 1000;
  const RETENTION = 7 * 24 * 60 * MIN;
  const MAX_SAMPLES = RETENTION / MIN;
  const LIVE_LIMIT = 60; // 5 minutos a cada 5 s
  const RANGES = { '5m': 5 * MIN, '30m': 30 * MIN, '24h': 24 * 60 * MIN, '7d': 7 * 24 * 60 * MIN };
  const IGNORED = /^(idle|system|powershell|pwsh|nexo.*|conhost|registry|memory compression|secure system)$/i;

  const brain = NexoBrain.create(readJSON(Nexo.keys.brain, null));
  let live = [];
  let history = loadHistory();
  let lastCommit = history.length ? history[history.length - 1].timestamp : 0;
  let lastProcesses = null;
  let capturing = false;
  let lastCaptureAt = 0;

  function loadHistory() {
    const cutoff = Date.now() - RETENTION;
    const stored = readJSON(Nexo.keys.history, []);
    return (Array.isArray(stored) ? stored : [])
      .map((row) => (Array.isArray(row) ? {
        timestamp: row[0], cpu: row[1], memory: row[2], disk: row[3], gpu: row[4],
        acpiTemperature: row[5], gpuTemperature: row[6], cpuSensorTemperature: row[7]
      } : null))
      .filter((sample) => sample && Number.isFinite(sample.timestamp) && sample.timestamp >= cutoff)
      .slice(-MAX_SAMPLES);
  }

  /** Leituras profundas dos sensores (LibreHardwareMonitor), quando disponíveis. */
  function deepMetrics() {
    const snapshot = Nexo.state.sensors;
    const devices = snapshot?.status === 'ready' ? snapshot.devices || [] : [];
    const collect = (types, sensorType, filter = () => true) => devices
      .filter((device) => types.includes(device.type))
      .flatMap((device) => device.sensors || [])
      .filter((sensor) => sensor.type === sensorType && Number.isFinite(sensor.value) && filter(sensor))
      .map((sensor) => sensor.value);
    const max = (values) => (values.length ? Math.max(...values) : null);
    const gpuTypes = ['GpuNvidia', 'GpuAmd', 'GpuIntel'];
    return {
      cpuTemperature: max(collect(['Cpu'], 'Temperature')),
      gpuTemperature: max(collect(gpuTypes, 'Temperature')),
      gpuLoad: max(collect(gpuTypes, 'Load')),
      cpuClock: max(collect(['Cpu'], 'Clock', (sensor) => /core/i.test(sensor.name) && !/bus/i.test(sensor.name)))
    };
  }

  function makeSample(snapshot, timestamp) {
    const thermal = snapshot.temperatureReadings || {};
    const acpi = (thermal.acpiSensors || []).map((sensor) => sensor.celsius).filter(Number.isFinite);
    const gpu = thermal.gpuSensors?.[0] || null;
    const deep = deepMetrics();
    return {
      timestamp,
      cpu: snapshot.cpuUsage,
      memory: snapshot.memoryPercent,
      disk: snapshot.primaryDrive?.usedPercent ?? null,
      gpu: deep.gpuLoad ?? gpu?.usagePercent ?? null,
      acpiTemperature: acpi.length ? Math.max(...acpi) : null,
      gpuTemperature: deep.gpuTemperature ?? gpu?.temperatureCelsius ?? null,
      cpuSensorTemperature: deep.cpuTemperature,
      cpuClock: deep.cpuClock
    };
  }

  const hottest = (sample) => {
    const values = [sample.cpuSensorTemperature, sample.gpuTemperature, sample.acpiTemperature].filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  };

  function pickName(list, key, minimum) {
    return (list || []).find((item) => item && !IGNORED.test(String(item.name)) && (Number(item[key]) || 0) >= minimum)?.name || null;
  }

  /** Captura os maiores consumidores só quando algo está pesado, no máximo a cada 2 minutos. */
  function maybeCaptureProcesses(snapshot) {
    const heavy = snapshot.cpuUsage >= 80 || snapshot.memoryPercent >= 90;
    if (!heavy || capturing || Date.now() - lastCaptureAt < 2 * MIN || !desktopBridge?.getTopProcesses) return;
    capturing = true;
    lastCaptureAt = Date.now();
    desktopBridge.getTopProcesses().then((result) => {
      Nexo.state.processes = result;
      lastProcesses = { at: Date.now(), cpu: pickName(result.byCpu, 'cpuPercent', 5), memory: pickName(result.byMemory, 'memoryBytes', 0) };
      Nexo.emit('processes', result);
    }).catch(() => {}).finally(() => { capturing = false; });
  }

  function commitMinute(now) {
    const window = live.filter((sample) => sample.timestamp > now - MIN);
    if (!window.length) return;
    const avg = (key) => {
      const values = window.map((sample) => sample[key]).filter(Number.isFinite);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    const maxOf = (key) => {
      const values = window.map((sample) => sample[key]).filter(Number.isFinite);
      return values.length ? Math.max(...values) : null;
    };
    const committed = {
      timestamp: now, cpu: avg('cpu'), memory: avg('memory'), disk: window[window.length - 1].disk, gpu: avg('gpu'),
      acpiTemperature: maxOf('acpiTemperature'), gpuTemperature: maxOf('gpuTemperature'), cpuSensorTemperature: maxOf('cpuSensorTemperature')
    };
    history.push(committed);
    history = history.filter((sample) => sample.timestamp >= now - RETENTION).slice(-MAX_SAMPLES);
    lastCommit = now;

    const recent = lastProcesses && now - lastProcesses.at < 3 * MIN ? lastProcesses : null;
    const culprit = recent ? (committed.cpu >= 60 ? recent.cpu : committed.memory >= 85 ? recent.memory : null) : null;
    const clock = maxOf('cpuClock');
    brain.ingest({
      t: now, cpu: committed.cpu, mem: committed.memory, disk: committed.disk, gpu: committed.gpu,
      temp: hottest(committed), clock, clockRatio: brain.clockRatio(clock), culprit
    });
    persist();
    Nexo.emit('learned');
  }

  function persist() {
    const compact = history.map((s) => [s.timestamp, s.cpu, s.memory, s.disk, s.gpu, s.acpiTemperature, s.gpuTemperature, s.cpuSensorTemperature]);
    const ok = writeJSON(Nexo.keys.history, compact) && writeJSON(Nexo.keys.brain, brain.serialize());
    if (!ok) setText('diagnosis-learning-status', 'O histórico local não pôde ser salvo; a análise atual continua disponível.');
  }

  Nexo.on('snapshot', (snapshot) => {
    const now = Date.now();
    live.push(makeSample(snapshot, now));
    live = live.filter((sample) => sample.timestamp > now - 6 * MIN).slice(-LIVE_LIMIT - 12);
    maybeCaptureProcesses(snapshot);
    if (now - lastCommit >= MIN) commitMinute(now);
  });

  Nexo.store = {
    brain,
    live: () => live,
    /** Últimos minutos: histórico por minuto até a primeira leitura ao vivo, seguido das leituras de 5 s. */
    recent() {
      const firstLive = live.length ? live[0].timestamp : Date.now();
      return [...history.filter((sample) => sample.timestamp >= Date.now() - 6 * MIN && sample.timestamp < firstLive), ...live];
    },
    history: () => history,
    /** Série para um período do gráfico. */
    range(key) {
      const span = RANGES[key] || RANGES['5m'];
      const to = Date.now();
      const source = key === '5m' ? Nexo.store.recent() : history;
      return { from: to - span, to, samples: source.filter((sample) => sample.timestamp >= to - span) };
    },
    /** Histórico no formato do motor de análise. */
    brainHistory() {
      return history.map((s) => ({ t: s.timestamp, cpu: s.cpu, mem: s.memory, disk: s.disk, gpu: s.gpu, temp: hottest(s) }));
    },
    hottest,
    deepMetrics,
    feedback: () => (Array.isArray(readJSON(Nexo.keys.feedback, [])) ? readJSON(Nexo.keys.feedback, []) : []),
    addFeedback(category, helpful) {
      const entries = Nexo.store.feedback();
      entries.push({ category, helpful, timestamp: Date.now() });
      const ok = writeJSON(Nexo.keys.feedback, entries.slice(-100));
      showToast(ok ? 'Obrigado! O Nexo ajusta a confiança desse tipo de sugestão, só neste computador.' : 'Não foi possível salvar o feedback local.');
      Nexo.emit('learned');
    },
    lastProcesses: () => lastProcesses,
    eraseLearning() {
      brain.reset();
      history = [];
      live = [];
      lastCommit = 0;
      for (const key of [Nexo.keys.history, Nexo.keys.brain, Nexo.keys.feedback]) { try { localStorage.removeItem(key); } catch { /* ignorado */ } }
      Nexo.emit('learned');
    },
    exportAll() {
      return {
        exportedAt: new Date().toISOString(), app: 'Nexo Device Care',
        history: history.map((s) => ({ ...s })), learning: brain.serialize(), feedback: Nexo.store.feedback(),
        activity: readJSON(Nexo.keys.activity, [])
      };
    }
  };
})();
