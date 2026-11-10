/* Dados locais: histórico de 7 dias, aprendizado (Nexo Brain), feedback e leituras ao vivo. */
(function () {
  const MIN = 60 * 1000;
  const RETENTION = 7 * 24 * 60 * MIN;
  const MAX_SAMPLES = RETENTION / MIN;
  const LIVE_LIMIT = 360; // 6 minutos de leituras a cada 1 s (no ritmo "Tempo real")
  const RANGES = { '5m': 5 * MIN, '30m': 30 * MIN, '24h': 24 * 60 * MIN, '7d': 7 * 24 * 60 * MIN };
  const IGNORED = /^(idle|system|powershell|pwsh|nexo.*|conhost|registry|memory compression|secure system)$/i;

  const brain = NexoBrain.create(readJSON(Nexo.keys.brain, null));
  const FUTURE_TOLERANCE = 5 * MIN;
  let live = [];
  let history = loadHistory();
  // Relógio que voltou no tempo ou histórico importado "do futuro" não pode travar o aprendizado (A11).
  let lastCommit = history.length ? Math.min(history[history.length - 1].timestamp, Date.now()) : 0;
  let lastProcesses = null;
  let capturing = false;
  let lastCaptureAt = 0;
  // Geração: sobe a cada "Apagar aprendizado"; captura começada antes disso é descartada quando chega (A10).
  let generation = 0;

  function loadHistory() {
    const now = Date.now();
    const cutoff = now - RETENTION;
    const stored = readJSON(Nexo.keys.history, []);
    return (Array.isArray(stored) ? stored : [])
      .map((row) => (Array.isArray(row) ? {
        timestamp: row[0], cpu: row[1], memory: row[2], disk: row[3], gpu: row[4],
        acpiTemperature: row[5], gpuTemperature: row[6], cpuSensorTemperature: row[7]
      } : null))
      // Linha "do futuro" (relógio adiantado antes, ou dado importado) não entra: pareceria atual e travaria o histórico.
      .filter((sample) => sample && Number.isFinite(sample.timestamp) && sample.timestamp >= cutoff && sample.timestamp <= now + FUTURE_TOLERANCE)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_SAMPLES);
  }

  const plausible = (value) => Number.isFinite(value) && value > 5 && value < 125;
  // Limites do fabricante (aviso/crítico) aparecem como "temperatura" nos sensores, mas não são leitura.
  const LIMIT_SENSOR = /warning|critical|limit|threshold|shutdown|t\s*j\s*max/i;

  /*
   * Leituras profundas dos sensores (LibreHardwareMonitor, ou o leitor do Linux), quando disponíveis E recentes.
   * Sensor parado (janela sem foco, coletor travado) não vale como "agora": passa a valer o nvidia-smi do snapshot.
   */
  const SENSORS_STALE_MS = 45000;
  const GPU_TYPES = ['GpuNvidia', 'GpuAmd', 'GpuIntel'];
  const NOT_RENDER = /memory|video|decode|encode|bus|copy|controller|power|board|vpu|jpeg|security|overlay/i;
  const sensorsFresh = () => {
    const snapshot = Nexo.state.sensors;
    const at = Number.isFinite(Nexo.state.sensorsAt) ? Nexo.state.sensorsAt : Date.parse(snapshot?.collectedAt || '');
    return snapshot?.status === 'ready' && Number.isFinite(at) && Date.now() - at <= SENSORS_STALE_MS && at <= Date.now() + FUTURE_TOLERANCE;
  };
  const gpuClockPeak = new Map(); // por placa: o maior clock visto com carga nesta abertura (régua quando o driver não diz)

  /** Uma placa de vídeo: carga do núcleo 3D (nunca o maior sensor de carga), clock, energia, memória e temperaturas. */
  function gpuAdapter(device) {
    const sensors = (device.sensors || []).filter((sensor) => Number.isFinite(sensor.value));
    const named = (type, pattern) => sensors.find((sensor) => sensor.type === type && pattern.test(String(sensor.name || '')))?.value ?? null;
    const generic = sensors.find((sensor) => sensor.type === 'Load' && /core|3d|graphics|render/i.test(String(sensor.name || '')) && !NOT_RENDER.test(String(sensor.name || '')));
    const core = named('Load', /^gpu core$/i) ?? named('Load', /^d3d 3d$/i) ?? generic?.value ?? null;
    const usedGB = named('Data', /memory used/i);
    const totalGB = named('Data', /memory total/i);
    const used = named('SmallData', /memory used/i) ?? (Number.isFinite(usedGB) ? usedGB * 1024 : null);
    const total = named('SmallData', /memory total/i) ?? (Number.isFinite(totalGB) ? totalGB * 1024 : null);
    const vramLoad = named('Load', /^gpu memory$/i);
    const clock = named('Clock', /^gpu core$/i) ?? named('Clock', /core|graphics|shader/i);
    const temps = sensors.filter((sensor) => sensor.type === 'Temperature' && sensor.value > 5 && sensor.value < 125 && !LIMIT_SENSOR.test(String(sensor.name || '')));
    const hot = temps.find((sensor) => /hot ?spot|junction/i.test(String(sensor.name || '')))?.value ?? null;
    const edge = temps.find((sensor) => !/hot ?spot|junction|memory|vram/i.test(String(sensor.name || '')))?.value ?? (temps.length ? Math.max(...temps.map((sensor) => sensor.value)) : null);
    const key = `${device.type}|${device.name}`;
    if (Number.isFinite(clock) && Number.isFinite(core) && core >= 50 && clock < 5000) gpuClockPeak.set(key, Math.max(gpuClockPeak.get(key) || 0, clock));
    return {
      vendor: device.type, core, engine3d: named('Load', /^d3d 3d$/i), memoryController: named('Load', /memory controller/i), video: named('Load', /video|decode/i),
      vramPct: Number.isFinite(vramLoad) ? vramLoad : Number.isFinite(used) && Number.isFinite(total) && total > 0 ? (used / total) * 100 : null,
      vramTotalMB: Number.isFinite(total) ? total : null,
      clock, clockPeak: gpuClockPeak.get(key) || null, power: named('Power', /package|board|gpu power|total/i), temp: edge, hot
    };
  }

  function deepMetrics() {
    const snapshot = Nexo.state.sensors;
    const devices = sensorsFresh() ? snapshot.devices || [] : [];
    const collect = (types, sensorType, filter = () => true) => devices
      .filter((device) => types.includes(device.type))
      .flatMap((device) => device.sensors || [])
      // Temperatura 0 °C (ou absurda) é sensor sem acesso, não leitura: sem o driver, o processador responde 0.
      .filter((sensor) => sensor.type === sensorType && Number.isFinite(sensor.value) && (sensorType !== 'Temperature' || (sensor.value > 5 && sensor.value < 125 && !LIMIT_SENSOR.test(String(sensor.name || '')))) && filter(sensor))
      .map((sensor) => sensor.value);
    const max = (values) => (values.length ? Math.max(...values) : null);
    const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
    // A placa que está trabalhando (a mais ocupada); empate fica com a dedicada.
    const adapters = devices.filter((device) => GPU_TYPES.includes(device.type)).map(gpuAdapter);
    const gpu = adapters.sort((a, b) => (b.core ?? -1) - (a.core ?? -1) || Number(a.vendor === 'GpuIntel') - Number(b.vendor === 'GpuIntel'))[0] || null;
    // Clock da CPU: MÉDIA dos núcleos (um núcleo em turbo não representa a carga em todos).
    const coreClocks = collect(['Cpu'], 'Clock', (sensor) => /core\s*#?\d+/i.test(String(sensor.name || '')) && !/bus|effective/i.test(String(sensor.name || '')));
    return {
      cpuTemperature: max(collect(['Cpu'], 'Temperature')),
      gpuTemperature: gpu?.temp ?? max(collect(GPU_TYPES, 'Temperature')),
      gpuLoad: gpu?.core ?? null,
      gpu,
      cpuClock: mean(coreClocks) ?? max(collect(['Cpu'], 'Clock', (sensor) => /core/i.test(String(sensor.name || '')) && !/bus/i.test(String(sensor.name || ''))))
    };
  }

  /** Detalhes da GPU para o "o que limitou": junta o sensor profundo com o nvidia-smi (energia, limites, clock máximo). */
  function gpuDetail(snapshot, deep) {
    const smi = snapshot?.temperatureReadings?.gpuSensors?.[0] || null;
    const g = deep.gpu || {};
    const clock = Number.isFinite(smi?.clockMhz) ? smi.clockMhz : g.clock;
    const peak = Number.isFinite(smi?.clockMaxMhz) && smi.clockMaxMhz > 0 ? smi.clockMaxMhz : g.clockPeak;
    const vramSmi = Number.isFinite(smi?.memoryUsedMb) && smi.memoryTotalMb > 0 ? (smi.memoryUsedMb / smi.memoryTotalMb) * 100 : null;
    return {
      gpu3d: g.engine3d ?? null,
      gpuClockRatio: Number.isFinite(clock) && Number.isFinite(peak) && peak > 0 ? Math.min(1.2, clock / peak) : null,
      gpuPowerPct: Number.isFinite(smi?.powerW) && smi.powerLimitW > 0 ? (smi.powerW / smi.powerLimitW) * 100 : null,
      gpuLimits: smi?.limits || null,
      gpuHot: g.hot ?? null,
      vramPct: g.vramPct ?? vramSmi,
      vramTotalMB: g.vramTotalMB ?? (Number.isFinite(smi?.memoryTotalMb) ? smi.memoryTotalMb : null)
    };
  }

  /** Transforma a leitura do sistema numa amostra do histórico (CPU, núcleo mais ocupado, memória, disco, GPU e temperaturas). */
  function makeSample(snapshot, timestamp) {
    const thermal = snapshot.temperatureReadings || {};
    const acpi = (thermal.acpiSensors || []).map((sensor) => sensor.celsius).filter(plausible);
    const gpu = thermal.gpuSensors?.[0] || null;
    const deep = deepMetrics();
    return {
      timestamp,
      cpu: snapshot.cpuUsage,
      maxCore: Number.isFinite(snapshot.cpuMaxCore) ? snapshot.cpuMaxCore : null,
      memory: snapshot.memoryPercent,
      disk: snapshot.primaryDrive?.usedPercent ?? null,
      gpu: deep.gpuLoad ?? gpu?.usagePercent ?? null,
      acpiTemperature: acpi.length ? Math.max(...acpi) : null,
      gpuTemperature: deep.gpuTemperature ?? (plausible(gpu?.temperatureCelsius) ? gpu.temperatureCelsius : null),
      cpuSensorTemperature: deep.cpuTemperature,
      cpuClock: deep.cpuClock,
      ...gpuDetail(snapshot, deep)
    };
  }

  /* ---------- O que limitou o PC, por dia (para a telemetria e para a tela "Hardware") ---------- */
  const BN_KEY = 'nexo-bottleneck-days';
  const BN_KEEP_DAYS = 8;
  const BN_MAX_ROWS = 720;
  const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  let bnDays = (() => { const v = readJSON(BN_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })();
  /** Uma amostra do "o que limitou" no formato do NexoBottleneck. */
  const bnSample = (sample) => ({ cpu: sample.cpu, maxCore: sample.maxCore, mem: sample.memory, gpu: sample.gpu, gpu3d: sample.gpu3d, gpuClockRatio: sample.gpuClockRatio, gpuPowerPct: sample.gpuPowerPct,
    gpuLimits: sample.gpuLimits, gpuTemp: sample.gpuTemperature, gpuHot: sample.gpuHot, vramPct: sample.vramPct, cpuTemp: sample.cpuSensorTemperature, cpuClockRatio: brain.clockRatio(sample.cpuClock) });
  const r1 = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
  /** Guarda o minuto (só se teve carga): os números que decidem a classe, compactos. Até 720 minutos por dia. */
  function noteBottleneck(window, now) {
    if (!window.length || typeof NexoBottleneck === 'undefined') return;
    const samples = window.map(bnSample);
    const kind = NexoBottleneck.majority(samples.map((sample) => NexoBottleneck.classify(sample)));
    if (!kind) return;
    const day = dayKey(now);
    const bucket = bnDays[day] || (bnDays[day] = { rows: [] });
    const mid = samples[Math.floor(samples.length / 2)];
    const peak = (key) => { const values = samples.map((sample) => sample[key]).filter(Number.isFinite); return values.length ? Math.max(...values) : null; };
    if (bucket.rows.length < BN_MAX_ROWS) bucket.rows.push([kind, r1(peak('cpu')), r1(peak('maxCore')), r1(peak('mem')), r1(peak('gpu')), r1(mid.gpuClockRatio), r1(mid.gpuPowerPct), r1(peak('vramPct')), r1(peak('gpuTemp')), r1(peak('cpuTemp')), r1(mid.cpuClockRatio), r1(mid.gpu3d), mid.gpuLimits?.thermal ? 1 : 0, mid.gpuLimits?.power ? 1 : 0]);
    bnDays = Object.fromEntries(Object.keys(bnDays).sort((a, b) => a.localeCompare(b)).slice(-BN_KEEP_DAYS).map((key) => [key, bnDays[key]]));
  }
  /** Resumo de um dia (formato da telemetria "bottleneck"). */
  function bottleneckDay(day) {
    const rows = bnDays[day]?.rows || [];
    if (!rows.length || typeof NexoBottleneck === 'undefined') return null;
    const samples = rows.map(([, cpu, maxCore, mem, gpu, gpuClockRatio, gpuPowerPct, vramPct, gpuTemp, cpuTemp, cpuClockRatio, gpu3d, thermal, power]) => ({ cpu, maxCore, mem, gpu, gpuClockRatio, gpuPowerPct, vramPct, gpuTemp, cpuTemp, cpuClockRatio, gpu3d, gpuLimits: { thermal: Boolean(thermal), power: Boolean(power) } }));
    const summary = NexoBottleneck.summarize(samples);
    const limiter = {};
    for (const [kind] of rows) limiter[kind] = (limiter[kind] || 0) + 1;
    return { ...summary, limiter, minutes: rows.length };
  }

  /** A amostra mais recente só vale como "agora" se for recente (depois de reiniciar o app, a última pode ser velha). */
  // Idade negativa (do futuro) também não é "agora" (A11).
  const fresh = (sample, maxAgeMs = 20000) => { const age = sample && Number.isFinite(sample.timestamp) ? Date.now() - sample.timestamp : null; return age !== null && age <= maxAgeMs && age >= -FUTURE_TOLERANCE ? sample : null; };
  const hottest = (sample) => {
    // O histórico de versões antigas pode ter 0 °C gravado (sensor sem acesso): não conta como temperatura.
    const values = [sample.cpuSensorTemperature, sample.gpuTemperature, sample.acpiTemperature].filter(plausible);
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
    const startedIn = generation;
    const capture = async () => {
      try {
        const result = await desktopBridge.getTopProcesses();
        if (startedIn !== generation) return; // o aprendizado foi apagado enquanto a captura rodava
        Nexo.state.processes = result;
        lastProcesses = { at: Date.now(), cpu: pickName(result.byCpu, 'cpuPercent', 5), memory: pickName(result.byMemory, 'memoryBytes', 0) };
        Nexo.emit('processes', result);
      } finally {
        capturing = false;
      }
    };
    // A captura é só uma pista para a análise: se falhar, a próxima lentidão tenta de novo.
    capture().catch((error) => console.warn('[processos] captura falhou', error));
  }

  /** Fecha o minuto: médias e picos das amostras, o que limitou o PC e a entrada no aprendizado. */
  function commitMinute(now) {
    const window = live.filter((sample) => sample.timestamp > now - MIN && sample.timestamp <= now + FUTURE_TOLERANCE);
    if (!window.length) return;
    try { noteBottleneck(window, now); } catch (error) { console.error('[gargalo]', error); }
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
    // Clock do minuto: a média (as leituras já são a média dos núcleos); a régua vem do próprio cérebro.
    const clock = avg('cpuClock');
    const cpuTemp = [committed.cpuSensorTemperature, committed.acpiTemperature].find(plausible) ?? null;
    brain.ingest({
      t: now, cpu: committed.cpu, mem: committed.memory, disk: committed.disk, gpu: committed.gpu,
      temp: hottest(committed), cpuTemp, clock, clockRatio: brain.clockRatio(clock), culprit
    });
    persist();
    Nexo.emit('learned');
  }

  /*
   * Grava o cérebro PRIMEIRO e separado do histórico: antes, se o histórico estourasse a cota do armazenamento, o
   * cérebro nem era tentado e o aprendizado "voltava atrás" na próxima abertura. Se o histórico não couber, os dias
   * mais antigos saem até caber (e a tela avisa).
   */
  function persist() {
    const brainOk = writeJSON(Nexo.keys.brain, brain.serialize());
    // Uma casa decimal basta para o histórico: o arquivo cai pela metade e a gravação (a cada minuto) fica mais leve.
    const r = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
    let compact = history.map((s) => [s.timestamp, r(s.cpu), r(s.memory), r(s.disk), r(s.gpu), r(s.acpiTemperature), r(s.gpuTemperature), r(s.cpuSensorTemperature)]);
    let historyOk = writeJSON(Nexo.keys.history, compact);
    for (let tries = 0; !historyOk && tries < 4 && compact.length > 60; tries += 1) { compact = compact.slice(Math.floor(compact.length / 4)); historyOk = writeJSON(Nexo.keys.history, compact); }
    writeJSON(BN_KEY, bnDays);
    if (!brainOk || !historyOk) setText('diagnosis-learning-status', brainOk ? 'O espaço local encheu: o histórico mais antigo foi descartado para o aprendizado continuar.' : 'O aprendizado local não pôde ser salvo agora (espaço cheio); a análise atual continua disponível.');
    if (!brainOk || !historyOk) console.warn('[armazenamento] cota local cheia', { cerebro: brainOk, historico: historyOk });
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
    fresh,
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
      generation += 1; // capturas em andamento são descartadas quando voltarem
      brain.reset();
      Nexo.sessions?.clear?.();
      try { localStorage.removeItem(Nexo.keys.lab); } catch { /* armazenamento indisponível */ }
      history = [];
      live = [];
      lastCommit = 0;
      // Nada do que foi observado antes fica em memória: processos, culpados e o "o que limitou".
      lastProcesses = null;
      lastCaptureAt = 0;
      Nexo.state.processes = null;
      bnDays = {};
      for (const key of [Nexo.keys.history, Nexo.keys.brain, Nexo.keys.feedback, BN_KEY]) { try { localStorage.removeItem(key); } catch { /* ignorado */ } }
      Nexo.emit('learned');
    },
    /** O que limitou o PC num dia (resumo para a telemetria e para a tela). */
    bottleneck: (day) => bottleneckDay(day),
    bottleneckDays: () => Object.keys(bnDays).sort((a, b) => a.localeCompare(b)),
    exportAll() {
      return {
        exportedAt: new Date().toISOString(), app: 'Nexo Device Care',
        history: history.map((s) => ({ ...s })), learning: brain.serialize(), feedback: Nexo.store.feedback(),
        activity: readJSON(Nexo.keys.activity, []), journal: Nexo.journal?.list?.() ?? [], sessions: Nexo.sessions?.list?.() ?? [], lab: readJSON(Nexo.keys.lab, null), profile: Nexo.profile?.id ?? null
      };
    }
  };
})();
