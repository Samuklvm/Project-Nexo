/*
 * Orquestra a verificação completa em 10 etapas, com no mínimo 10 minutos (MIN_TOTAL_MS). Cada etapa examina de verdade:
 * peças, teste de estabilidade da memória, placa de vídeo sob carga, gravação no disco, drivers, 30 dias de eventos,
 * um minuto medindo a rede, o que roda por trás, o teste de carga do processador e, no fim, as pistas cruzadas para
 * achar a causa provável. A cada passo emite um retrato do progresso para a tela desenhar a constelação.
 * Nada é alterado no PC: os testes gravam só arquivos temporários do próprio app (apagados no fim) e nada é encerrado.
 * O relatório e o histórico ficam só neste PC (analise-profunda.json na pasta de dados do app).
 */
const Hardware = require('../src/hardware-kb.js');
const Deep = require('../src/deep-analysis.js');
const Scan = require('./deep-scan.cjs');

const HISTORY_LIMIT = 20;
// Durações dos testes da verificação completa (cada etapa tem também o seu tempo mínimo em Deep.STAGES).
const MEMTEST_MS = 100000;
const GPU_STRESS_MS = 45000;
const LOAD_MULTI_MS = 75000;
const LOAD_SINGLE_MS = 15000;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });

function createDeepAnalysis(deps) {
  const {
    platform = process.platform, now = Date.now, sleep = wait,
    runPowerShellCode, spawnFn, linuxCollector = null, linuxProcesses = null, linuxSystem = null,
    sensors = async () => null, nvidia = async () => [], bench = async () => null, cancelBench = () => {}, facts = async () => null,
    startup = async () => null, drives = async () => [], screenDisplays = () => [], selfPids = () => new Set(),
    match = null, classify = null, onBattery = () => false, gpuWake = () => {}, emit = () => {}, store = null, memoryTotal = () => null,
    // Testes da verificação completa (cada um recebe { signal, onProgress } e devolve o resultado, ou null).
    memtest = async () => null, diskTest = async () => null, netQuality = async () => null, freeMemory = () => null
  } = deps;
  let current = null;

  /* ---------------- estado do progresso ---------------- */
  function snapshot(state) {
    return {
      runId: state.id, status: state.status, stageIndex: state.stageIndex, total: Deep.STAGES.length,
      stages: Deep.STAGES.map((stage, index) => ({ id: stage.id, label: stage.label, state: index < state.stageIndex ? 'done' : index === state.stageIndex && state.status === 'running' ? 'active' : state.status === 'done' ? 'done' : 'pending' })),
      nodes: { ...state.nodes }, names: { ...(state.names || {}) }, action: state.action, facts: state.facts.slice(-5), elapsedMs: now() - state.startedAt, minMs: Deep.MIN_TOTAL_MS,
      extended: state.extended, observed: state.observed, error: state.error || null
    };
  }
  const push = (state) => { try { emit(snapshot(state)); } catch { /* tela fechada */ } };
  const setAction = (state, text) => { state.action = text; push(state); };
  const node = (state, id, value) => {
    const order = { pending: 0, seen: 1, active: 2, done: 3, warn: 3 };
    // O veredito de uma etapa (algo para ajustar) fica: o teste de carga reacende a peça, mas ela volta amarela.
    if (value === 'warn') state.verdicts[id] = 'warn';
    const next = value === 'done' && state.verdicts[id] === 'warn' ? 'warn' : value;
    if (next === 'active' || (order[next] || 0) >= (order[state.nodes[id]] || 0) || state.nodes[id] === 'active') state.nodes[id] = next;
  };
  const fact = (state, nodeId, text, level = 'info') => { if (text) { state.facts.push({ node: nodeId, text: String(text).slice(0, 160), level }); push(state); } };
  const cancelled = (state) => state.cancel === true;
  /** Espera um passo, mas volta na hora se a análise for cancelada (o passo termina sozinho em segundo plano). */
  const until = (state, promise) => Promise.race([Promise.resolve(promise).catch(() => null), state.aborted]);

  /** Espera o resto do tempo mínimo da etapa, mostrando as descobertas aos poucos (cancelável). */
  async function pace(state, stageStart, minMs, reveal = []) {
    const items = reveal.filter(Boolean);
    const step = items.length ? Math.max(500, (minMs - (now() - stageStart)) / (items.length + 1)) : 0;
    for (const item of items) {
      if (cancelled(state)) return;
      await until(state, sleep(Math.min(step, Math.max(0, minMs - (now() - stageStart)))));
      if (typeof item === 'function') item(); else fact(state, item.node, item.text, item.level);
    }
    while (!cancelled(state) && now() - stageStart < minMs) await sleep(Math.min(400, minMs - (now() - stageStart)));
  }

  /* ---------------- coleta ---------------- */
  async function collectInventory() {
    if (platform === 'linux' && linuxCollector) return linuxCollector.inventory();
    if (platform !== 'win32') return null;
    const result = await runPowerShellCode(Scan.INVENTORY_SCRIPT, 60000);
    return Scan.parseInventory(result.stdout);
  }
  async function collectHealth() {
    if (platform === 'linux' && linuxCollector) return linuxCollector.health();
    if (platform !== 'win32') return null;
    const result = await runPowerShellCode(Scan.HEALTH_SCRIPT, 60000);
    return Scan.parseHealth(result.stdout);
  }
  const quiet = (promise) => Promise.resolve(promise).catch(() => null);

  /** Observação do que roda por trás: no Windows, o PowerShell residente; no Linux, /proc a cada 3 s. */
  async function observe(state) {
    const ticks = [];
    const procs = new Map();
    let services = new Map();
    let probePid = null;
    let cores = null;
    // Verificação completa: 30 leituras (~90 s), até 40 quando algo acabou de aparecer e precisa ser confirmado.
    const baseTicks = 30;
    const maxTicks = 40;
    const stageStart = now();
    if (platform === 'win32') {
      let resolveEnd;
      const ended = new Promise((resolve) => { resolveEnd = resolve; });
      let limit = baseTicks;
      const stream = Scan.streamScript({
        spawnFn, script: Scan.OBSERVE_SCRIPT, env: { NEXO_TICKS: String(maxTicks), NEXO_WAIT_MS: '3000' }, timeoutMs: 220000,
        onLine: (line) => {
          const parsed = Scan.parseObserveLine(line);
          if (!parsed) return;
          if (parsed.kind === 'meta') {
            services = parsed.services; probePid = parsed.self; cores = parsed.cores;
            for (const [pid, info] of parsed.procs) { procs.set(pid, info); }
            return;
          }
          if (parsed.kind === 'end') { resolveEnd(); return; }
          if (parsed.kind !== 'tick') return;
          for (const [pid, info] of parsed.fresh) procs.set(pid, info);
          ticks.push(parsed);
          const done = ticks.filter((tick) => tick.i !== 0).length;
          state.observed = { done, of: limit, seconds: Math.round((now() - stageStart) / 1000) };
          liveObservation(state, ticks, procs, services, probePid, cores);
          if (done >= limit) {
            const reason = limit < maxTicks ? Deep.needsMoreTime(ticks, (limit - baseTicks) / 5) : null;
            if (reason) { limit += 5; state.extended = reason; fact(state, null, reason, 'info'); state.observed.of = limit; push(state); }
            else resolveEnd();
          }
        }
      });
      const flags = { finished: false };
      const watchdog = (async () => {
        while (!cancelled(state) && !flags.finished) { await sleep(300); }
        resolveEnd();
      })();
      await Promise.race([ended, stream.done]);
      flags.finished = true;
      stream.stop();
      await watchdog;
    } else if (platform === 'linux' && linuxProcesses) {
      let previous = null;
      let previousCpu = null;
      let limit = baseTicks;
      for (let i = 0; i <= maxTicks && !cancelled(state); i += 1) {
        const at = now();
        const [sample, system] = await until(state, Promise.all([quiet(linuxProcesses()), quiet(linuxSystem ? linuxSystem() : null)])) || [];
        if (cancelled(state)) break;
        const rows = [];
        if (previous && sample) {
          const seconds = Math.max(0.5, (at - previous.at) / 1000);
          const count = Math.max(1, cores || require('os').cpus().length);
          for (const proc of sample.values()) {
            const before = previous.map.get(proc.pid);
            if (!before) continue;
            const pct = ((proc.ticks - before.ticks) / 100 / seconds / count) * 100;
            if (pct > 0.2 || proc.rssPages > 50000) rows.push({ pid: proc.pid, cpu: Math.round(pct * 100) / 100, io: 0, mem: proc.rssPages * 4096 });
          }
        }
        if (sample) for (const proc of sample.values()) if (!procs.has(proc.pid)) procs.set(proc.pid, { name: proc.name, path: null, window: false });
        const cpuNow = system?.cpu || null;
        let cpuTick = { total: null, dpc: null, irq: null };
        if (previousCpu && cpuNow) {
          const total = cpuNow.total - previousCpu.total;
          if (total > 0) cpuTick = { total: (1 - (cpuNow.idle - previousCpu.idle) / total) * 100, dpc: ((cpuNow.softirq - previousCpu.softirq) / total) * 100, irq: ((cpuNow.irq - previousCpu.irq) / total) * 100 };
        }
        previousCpu = cpuNow;
        previous = sample ? { map: sample, at } : previous;
        ticks.push({ kind: 'tick', i, t: at, procs: rows.sort((a, b) => b.cpu - a.cpu).slice(0, 40), gpu: [], cpu: cpuTick, mem: { availMB: system?.availMB ?? null, hardFaults: system?.majorFaults ?? null }, disk: { busy: system?.diskBusy ?? null }, sys: {}, psi: system?.psi || null });
        const done = ticks.filter((tick) => tick.i !== 0).length;
        state.observed = { done, of: limit, seconds: Math.round((now() - stageStart) / 1000) };
        liveObservation(state, ticks, procs, services, probePid, cores);
        if (done >= limit) {
          const reason = limit < maxTicks ? Deep.needsMoreTime(ticks, (limit - baseTicks) / 5) : null;
          if (!reason) break;
          limit += 5; state.extended = reason; fact(state, null, reason, 'info');
        }
        await until(state, sleep(3000));
      }
    }
    return { ticks, procs, services, probePid, cores };
  }

  /** Descobertas ao vivo durante a observação: jogo reconhecido e quem está pesando. */
  function liveObservation(state, ticks, procs, services, probePid, cores) {
    const summary = Deep.summarizeObservation({ ticks, procs, services, probePid, selfPids: state.selfPids, match, classify, cores, memoryTotalBytes: memoryTotal() });
    state.liveSummary = summary;
    for (const game of summary.games) if (!state.announced.has(`g:${game.label}`)) { state.announced.add(`g:${game.label}`); fact(state, null, `${game.label} aberto: é o jogo, fica fora da lista de culpados`, 'info'); }
    for (const program of summary.background.filter((item) => item.impact === 'alto' || item.impact === 'medio')) {
      if (state.announced.has(`b:${program.label}`)) continue;
      state.announced.add(`b:${program.label}`);
      const what = program.cpuAvg >= 1 ? `${String(program.cpuAvg).replace('.', ',')}% do processador` : program.ioAvg >= 1048576 ? `${Math.round(program.ioAvg / 1048576)} MB/s de disco` : `${String(program.gpuAvg).replace('.', ',')}% da placa de vídeo`;
      const who = program.kind === 'desconhecido' ? program.label : `${program.label} (${program.name})`;
      fact(state, null, `${who}: ${what}`, 'warn');
    }
    const done = state.observed?.done || 0;
    setAction(state, `observando o que roda por trás: leitura ${done} de ${state.observed?.of || 30}`);
  }

  /** Teste de carga do processador: todos os núcleos por 75 s e um só por 15 s, com sensores a cada 3 s. */
  async function loadTest(state, gpuRead) {
    const phases = {};
    const sensorReads = [];
    const ticks = [];
    const linuxFreq = [];
    const benchOut = {};
    const readSensors = async (phase) => { const snapshotValue = await until(state, quiet(sensors())); if (snapshotValue) sensorReads.push({ phase, snapshot: snapshotValue }); };
    const idleSensors = await until(state, quiet(sensors()));
    let stream = null;
    if (platform === 'win32') stream = Scan.streamScript({ spawnFn, script: Scan.LOAD_SCRIPT, env: { NEXO_TICKS: '110' }, timeoutMs: 160000, onLine: (line) => { const parsed = Scan.parseLoadLine(line); if (parsed?.kind === 'tick') ticks.push(parsed); } });
    const freq = { on: true };
    const freqLoop = platform === 'linux' && linuxCollector ? (async () => {
      while (freq.on && !cancelled(state)) {
        const values = await until(state, quiet(linuxCollector.frequencies()));
        const at = now();
        const phase = Object.entries(phases).find(([, range]) => at >= range.start && (!range.end || at <= range.end))?.[0] || 'idle';
        if (values) linuxFreq.push({ phase, values });
        await sleep(1000);
      }
    })() : null;
    try {
      await sleep(1500);
      if (cancelled(state)) return null;
      node(state, 'cpu', 'active');
      phases.multi = { start: now() };
      const multi = bench('multi', LOAD_MULTI_MS);
      const multiSensors = (async () => {
        for (let i = 0; i < LOAD_MULTI_MS / 3000 && !cancelled(state); i += 1) {
          await sleep(3000);
          await readSensors('multi');
          const cpu = Deep.summarizeLoad({ sensors: sensorReads.slice(-1) }).temps;
          const left = Math.max(0, Math.round((LOAD_MULTI_MS - (now() - phases.multi.start)) / 1000));
          setAction(state, `todos os núcleos no máximo${Number.isFinite(cpu?.cpuPeak) ? ` · ${Math.round(cpu.cpuPeak)} °C` : ''} · faltam ${left} s`);
        }
      })();
      setAction(state, `todos os núcleos no máximo por ${Math.round(LOAD_MULTI_MS / 1000)} segundos…`);
      const multiResult = await until(state, quiet(multi));
      await until(state, multiSensors);
      phases.multi.end = now();
      benchOut.multi = multiResult?.mopsPerSec ?? null;
      benchOut.threads = multiResult?.threads ?? null;
      if (cancelled(state)) return null;
      setAction(state, 'um núcleo só, para ver o turbo…');
      phases.single = { start: now() };
      const single = bench('single', LOAD_SINGLE_MS);
      await sleep(2500);
      await readSensors('single');
      const singleResult = await until(state, quiet(single));
      phases.single.end = now();
      benchOut.single = singleResult?.mopsPerSec ?? null;
      node(state, 'cpu', 'done');
    } finally {
      freq.on = false;
      stream?.stop();
      if (freqLoop) await until(state, freqLoop);
      if (cancelled(state)) cancelBench();
    }
    // A placa de vídeo já foi medida acordada na etapa de vídeo (link PCIe, clock e motivo do clock baixo).
    for (const entry of gpuRead?.sensors || []) sensorReads.push(entry);
    return Deep.summarizeLoad({ ticks, phases, sensors: sensorReads, bench: benchOut, nvidia: gpuRead?.nvidia || [], links: gpuRead?.links || [], idleSensors, platform, linuxFreq });
  }

  /** Placa de vídeo sob carga (~45 s): a tela desenha um sombreador pesado e o Nexo lê temperatura, clock e energia. */
  async function gpuStress(state) {
    const samples = [];
    const sensorEntries = [];
    let nvidiaRows = [];
    let links = [];
    const started = now();
    try { gpuWake(GPU_STRESS_MS); } catch { /* sem janela: só o que os sensores mostrarem */ }
    await until(state, sleep(2500));
    let linkDone = false;
    while (!cancelled(state) && now() - started < GPU_STRESS_MS) {
      const [rows, snap, linkOut] = await until(state, Promise.all([quiet(nvidia()), quiet(sensors()), !linkDone && platform === 'win32' ? quiet(runPowerShellCode(Scan.LINK_SCRIPT, 20000)) : null])) || [];
      if (cancelled(state)) break;
      if (linkOut && !linkDone) { linkDone = true; links = Scan.parseLinks(linkOut.stdout).map((item) => ({ name: Hardware.cleanName(item.name), link: Hardware.decodeLink(item.link) })); }
      const nv = Array.isArray(rows) ? rows.find((row) => row && Number.isFinite(row.temp)) || rows[0] : null;
      if (Array.isArray(rows) && rows.length) nvidiaRows = rows;
      if (snap) sensorEntries.push({ phase: 'gpu', snapshot: snap });
      const sensorTemp = snap ? Deep.summarizeLoad({ sensors: [{ phase: 'gpu', snapshot: snap }] }).temps?.gpuPeak : null;
      const sample = { t: now() - started, temp: Number.isFinite(nv?.temp) ? nv.temp : sensorTemp ?? null, clock: nv?.clock ?? null, power: nv?.power ?? null, powerLimit: nv?.powerLimit ?? null, limits: nv?.limits || null };
      if (Number.isFinite(sample.temp) || Number.isFinite(sample.clock)) samples.push(sample);
      const parts = [Number.isFinite(sample.temp) ? `${Math.round(sample.temp)} °C` : null, Number.isFinite(sample.clock) ? `${sample.clock} MHz` : null, Number.isFinite(sample.power) ? `${Math.round(sample.power)} W` : null].filter(Boolean);
      const left = Math.max(0, Math.round((GPU_STRESS_MS - (now() - started)) / 1000));
      setAction(state, `placa de vídeo trabalhando${parts.length ? ` · ${parts.join(' · ')}` : ''} · faltam ${left} s`);
      await until(state, sleep(3000));
    }
    try { gpuWake(0); } catch { /* já parou */ }
    const vendor = (state.profile?.gpus || []).find((item) => item.discrete)?.vendor || null;
    return { stress: Deep.summarizeGpuStress({ samples, seconds: Math.round((now() - started) / 1000), vendor }), nvidia: nvidiaRows, links, sensors: sensorEntries };
  }

  /** Script com parâmetro (sempre por variável de ambiente, nunca montando código a partir de texto). */
  function scriptWithEnv(script, env, timeoutMs) {
    const lines = [];
    const stream = Scan.streamScript({ spawnFn, script, env, timeoutMs, onLine: (line) => lines.push(line) });
    return stream.done.then(() => lines.join('\n'));
  }

  /** Throttle do texto de ação vindo dos testes (o worker manda progresso várias vezes por segundo). */
  const actionEvery = (state, ms = 900) => { let last = 0; return (text) => { const at = now(); if (at - last >= ms) { last = at; setAction(state, text); } }; };

  /* ---------------- etapas ---------------- */
  const AREA_NODE = { processador: 'cpu', memoria: 'memory', video: 'gpu', disco: 'disk', windows: 'windows', energia: 'windows', fundo: 'windows', rede: 'network' };
  const levelOf = (findings, areas) => {
    const relevant = findings.filter((item) => areas.includes(item.area));
    if (relevant.some((item) => item.severity === 'alta' || item.severity === 'media')) return 'warn';
    return 'done';
  };
  const topLine = (findings, areas) => findings.filter((item) => areas.includes(item.area) && (item.severity === 'alta' || item.severity === 'media')).slice(0, 2).map((item) => ({ text: item.title, level: 'warn' }));
  const okLine = (findings, areas) => findings.filter((item) => areas.includes(item.area) && item.severity === 'ok').slice(0, 1).map((item) => ({ text: item.title, level: 'ok' }));
  const monthYear = (iso) => { const at = Date.parse(iso || ''); return Number.isFinite(at) ? new Date(at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '') : null; };

  async function run() {
    if (current) throw new Error('A análise profunda já está rodando.');
    const state = { id: `${now().toString(36)}`, status: 'running', startedAt: now(), stageIndex: 0, nodes: Object.fromEntries(Deep.NODES.map((item) => [item.id, 'pending'])), action: 'começando…', facts: [], extended: null, observed: null, cancel: false, announced: new Set(), selfPids: new Set(), verdicts: {} };
    state.aborted = new Promise((resolve) => { state.onAbort = () => resolve(null); });
    state.abort = typeof AbortController === 'function' ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
    current = state;
    const stage = (index, text) => { state.stageIndex = index; push(state); if (text) setAction(state, text); return now(); };
    try {
      state.selfPids = selfPids() || new Set();
      push(state);
      // Saúde, fatos, inicialização, discos e drivers correm em paralelo desde já; cada etapa usa o seu quando chega a vez.
      const healthP = quiet(collectHealth());
      const factsP = quiet(facts());
      const startupP = quiet(startup());
      const drivesP = quiet(drives());
      const driversP = platform === 'win32' ? quiet(runPowerShellCode(Scan.DRIVERS_SCRIPT, 90000).then((out) => Scan.parseDrivers(out.stdout))) : Promise.resolve(null);
      const battery = Boolean(onBattery());
      const signal = state.abort.signal;

      // 1. Peças
      let stageStart = now();
      node(state, 'board', 'active'); node(state, 'cpu', 'active');
      setAction(state, 'lendo processador, placa-mãe, memória, vídeo, discos e rede…');
      const inventory = await until(state, quiet(collectInventory()));
      if (cancelled(state)) return finishCancelled(state);
      if (inventory && Array.isArray(inventory.displays)) {
        // No Linux o modo atual vem do Electron (o /sys só tem a lista de modos). A ordem das telas difere entre os
        // dois, então o casamento é pela resolução nativa, e só quando uma única tela do Electron bate.
        const electron = screenDisplays() || [];
        for (const display of inventory.displays) {
          if (display.hz || !display.maxWidth) continue;
          const same = electron.filter((item) => item.width === display.maxWidth && item.height === display.maxHeight);
          if (same.length === 1) Object.assign(display, { hz: same[0].hz, width: same[0].width, height: same[0].height });
        }
      }
      const profile = Hardware.identify(inventory || {}, { now: now() });
      state.profile = profile;
      try { state.names = Hardware.shortNames(profile); } catch { state.names = {}; }
      const lines = Hardware.factLines(profile);
      const cpuText = lines.find((line) => line.node === 'cpu')?.text;
      const boardText = lines.find((line) => line.node === 'board')?.text;
      const chip = profile.board?.chipset;
      await pace(state, stageStart, Deep.STAGES[0].minMs, [
        cpuText && { node: 'cpu', text: cpuText },
        () => { node(state, 'cpu', 'done'); setAction(state, 'decodificando o chipset da placa-mãe…'); },
        boardText && { node: 'board', text: boardText },
        chip && { node: 'board', text: `${chip.id}: ${chip.pcie || chip.ddr}${chip.cpuOc === false ? '; sem overclock do processador' : ''}` },
        () => {
          node(state, 'board', 'done');
          for (const id of ['memory', 'gpu', 'disk', 'network', 'windows']) { node(state, id, 'seen'); }
          push(state);
        }
      ]);
      if (cancelled(state)) return finishCancelled(state);
      const [health, factsValue, drivesValue] = await until(state, Promise.all([healthP, factsP, drivesP])) || [];
      if (cancelled(state)) return finishCancelled(state);
      const systemLetter = String(process.env.SystemDrive || 'C:').slice(0, 1).toUpperCase();
      const drivesMarked = (drivesValue || []).map((drive) => ({ ...drive, system: platform === 'win32' ? drive.driveLetter === systemLetter : drive.driveLetter === '/' || drive.id === '/' }));
      const tests = { memtest: null, gpuStress: null, diskTest: null, drivers: null, network: null, during: null };
      const provisional = (extra = {}) => Deep.buildFindings({ profile, health, facts: factsValue, drives: drivesMarked, startup: null, onBattery: battery, now: now(), ...tests, ...extra });

      // 2. Memória: o teste de estabilidade (padrões gravados e conferidos em boa parte da memória livre)
      stageStart = stage(1, 'conferindo pentes, canais e a velocidade nominal…'); node(state, 'memory', 'active');
      const memoryText = lines.find((line) => line.node === 'memory')?.text || (profile.memory?.totalBytes ? `${Hardware.gbText(profile.memory.totalBytes)} de memória${platform === 'linux' ? ' (os pentes só aparecem para o administrador no Linux)' : ''}` : null);
      const rated = profile.memory?.modules?.find((module) => module.ratedSource === 'código do pente');
      if (memoryText) fact(state, 'memory', memoryText);
      if (rated) fact(state, 'memory', `${rated.part}: vendido para ${rated.rated}${rated.cl ? ' CL' + rated.cl : ''}${rated.jedec ? ' (padrão, sem perfil XMP)' : ''}`);
      const free = Number(freeMemory()) || 0;
      const testMB = Math.max(64, Math.min(2048, Math.floor((free / 1048576) * 0.35)));
      const memAction = actionEvery(state);
      const memResult = await until(state, quiet(memtest({ totalMB: testMB, ms: MEMTEST_MS, signal, onProgress: (p) => memAction(`teste de estabilidade da memória: passada ${p.pass} (${p.pattern}) em ${Hardware.gbText(p.testedMB * 1048576)}${p.errors ? ` · ${p.errors} erro(s)!` : ' · nenhum erro'}`) })));
      if (cancelled(state)) return finishCancelled(state);
      tests.memtest = memResult && memResult.testedMB ? memResult : null;
      if (tests.memtest) fact(state, 'memory', tests.memtest.errors ? `${tests.memtest.errors} erro(s) no teste de memória` : `${Hardware.gbText(tests.memtest.testedMB * 1048576)} testados em ${tests.memtest.passes} passadas: nenhum erro`, tests.memtest.errors ? 'warn' : 'ok');
      let findings = provisional();
      await pace(state, stageStart, Deep.STAGES[1].minMs, [
        () => setAction(state, 'conferindo o arquivo de paginação e a memória livre…'),
        ...[...topLine(findings, ['memoria']), ...okLine(findings, ['memoria'])].filter((line) => !/teste/.test(line.text)).map((line) => ({ node: 'memory', ...line })),
        () => node(state, 'memory', levelOf(findings, ['memoria']))
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 3. Vídeo e tela: placas, monitores e a placa sob carga
      stageStart = stage(2, 'lendo placas de vídeo, drivers e monitores…'); node(state, 'gpu', 'active');
      for (const line of lines.filter((item) => item.node === 'gpu').slice(0, 3)) fact(state, 'gpu', line.text);
      const gpuRead = await gpuStress(state);
      if (cancelled(state)) return finishCancelled(state);
      tests.gpuStress = gpuRead.stress;
      if (Number.isFinite(tests.gpuStress?.tempPeak)) fact(state, 'gpu', `sob carga: ${tests.gpuStress.tempPeak} °C${Number.isFinite(tests.gpuStress.clockEnd) ? `, ${tests.gpuStress.clockEnd} MHz` : ''}`);
      findings = provisional();
      await pace(state, stageStart, Deep.STAGES[2].minMs, [
        () => setAction(state, 'comparando a taxa do monitor com o máximo que ele aceita…'),
        ...[...topLine(findings, ['video']), ...okLine(findings, ['video'])].map((line) => ({ node: 'gpu', ...line })),
        () => node(state, 'gpu', levelOf(findings, ['video']))
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 4. Disco: gravação de verdade e gravações pequenas confirmadas
      stageStart = stage(3, 'conferindo tipo, saúde e link dos discos…'); node(state, 'disk', 'active');
      for (const line of lines.filter((item) => item.node === 'disk').slice(0, 3)) fact(state, 'disk', line.text);
      const diskAction = actionEvery(state);
      const diskResult = await until(state, quiet(diskTest({ signal, onProgress: (p) => diskAction(p.phase === 'seq' ? `gravando no disco: ${p.mb} MB…` : `gravações pequenas confirmadas: ${p.done}…`) })));
      if (cancelled(state)) return finishCancelled(state);
      tests.diskTest = diskResult?.ok ? diskResult : null;
      if (tests.diskTest) fact(state, 'disk', `gravação: ${Math.round(tests.diskTest.seqWriteMBs)} MB/s${tests.diskTest.latency ? ` · resposta ${String(tests.diskTest.latency.p50Ms).replace('.', ',')} ms` : ''}`);
      findings = provisional();
      await pace(state, stageStart, Deep.STAGES[3].minMs, [
        ...topLine(findings, ['disco']).map((line) => ({ node: 'disk', ...line })),
        ...okLine(findings, ['disco']).map((line) => ({ node: 'disk', ...line })),
        () => node(state, 'disk', levelOf(findings, ['disco']))
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 5. Drivers
      stageStart = stage(4, 'lendo os drivers instalados de cada peça…'); node(state, 'board', 'active');
      const driverList = await until(state, driversP);
      if (cancelled(state)) return finishCancelled(state);
      tests.drivers = Array.isArray(driverList) && driverList.length ? Deep.summarizeDrivers(driverList, now()) : null;
      const driverLine = (label, item) => item && { node: 'board', text: `${label}: ${item.name}${item.version ? ` ${item.version}` : ''}${monthYear(item.date) ? ` (${monthYear(item.date)})` : ''}` };
      findings = provisional();
      await pace(state, stageStart, Deep.STAGES[4].minMs, [
        driverLine('vídeo', tests.drivers?.groups.gpu.find((item) => !/microsoft/i.test(item.provider || '')) || tests.drivers?.groups.gpu[0]),
        driverLine('rede', tests.drivers?.groups.net[0]),
        driverLine('áudio', tests.drivers?.groups.audio[0]),
        tests.drivers && { node: 'board', text: `${tests.drivers.total} drivers conferidos` },
        ...findings.filter((item) => item.id.startsWith('driver-')).slice(0, 2).map((item) => ({ node: 'board', text: item.title, level: 'warn' })),
        () => node(state, 'board', 'done')
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 6. Windows: 30 dias de eventos
      stageStart = stage(5, 'lendo 30 dias de eventos do sistema…'); node(state, 'windows', 'active');
      const startupValue = await until(state, startupP);
      if (cancelled(state)) return finishCancelled(state);
      findings = provisional({ startup: startupValue });
      const events = health?.events || {};
      const codes = (health?.bugCodes || []).map((item) => Deep.bugcheckOf(item.code)).filter((item) => item?.name).map((item) => item.name);
      const eventsText = health ? (platform === 'win32' ? [events.bugcheck?.count ? `${events.bugcheck.count} tela(s) azul(is)` : 'nenhuma tela azul', events.tdr?.count ? `${events.tdr.count} travada(s) do driver de vídeo` : null, (health.wheaIds || []).length ? 'erros de hardware (WHEA)' : null].filter(Boolean).join(', ') : health.journalReadable ? 'diário do kernel lido' : 'o diário do kernel exige permissão neste Linux') : null;
      await pace(state, stageStart, Deep.STAGES[5].minMs, [
        profile.os?.name && { node: 'windows', text: profile.os.name },
        eventsText && { node: 'windows', text: `30 dias: ${eventsText}` },
        codes.length && { node: 'windows', text: `códigos: ${[...new Set(codes)].slice(0, 3).join(', ')}`, level: 'warn' },
        () => setAction(state, 'conferindo reinício pendente, inicialização e plano de energia…'),
        ...topLine(findings, ['windows', 'energia']).map((line) => ({ node: 'windows', ...line })),
        () => node(state, 'windows', levelOf(findings, ['windows', 'energia']))
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 7. Rede: um minuto medindo roteador, internet e DNS
      stageStart = stage(6, 'medindo a rede: roteador, internet e DNS…'); node(state, 'network', 'active');
      for (const line of lines.filter((item) => item.node === 'network').slice(0, 2)) fact(state, 'network', line.text);
      const netAction = actionEvery(state);
      const net = await until(state, quiet(netQuality({ signal, onProgress: (p) => netAction(p.text || 'medindo a rede…') })));
      if (cancelled(state)) return finishCancelled(state);
      tests.network = net || null;
      if (net?.internet) fact(state, 'network', `internet: ${String(net.internet.ms ?? '—').replace('.', ',')} ms · oscila ${String(net.internet.jitter ?? '—').replace('.', ',')} ms · perdeu ${String(net.internet.loss ?? 0).replace('.', ',')}%`);
      findings = provisional({ startup: startupValue });
      await pace(state, stageStart, Deep.STAGES[6].minMs, [
        ...[...topLine(findings, ['rede']), ...okLine(findings, ['rede'])].map((line) => ({ node: 'network', ...line })),
        () => node(state, 'network', levelOf(findings, ['rede']))
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 8. O que roda por trás
      stageStart = stage(7, 'observando o que roda por trás (o próprio Nexo, jogos e launchers ficam de fora)…');
      const observed = await observe(state);
      const observation = Deep.summarizeObservation({ ...observed, selfPids: state.selfPids, match, classify, memoryTotalBytes: memoryTotal() });
      if (platform === 'linux') observation.system.psi = observed.ticks.map((tick) => tick.psi).filter(Boolean).pop() || null;
      await pace(state, stageStart, Deep.STAGES[7].minMs, []);
      if (cancelled(state)) return finishCancelled(state);

      // 9. Teste de carga do processador
      stageStart = stage(8, 'preparando o teste de carga…');
      const load = await loadTest(state, gpuRead);
      if (cancelled(state)) return finishCancelled(state);
      if (load?.temps?.cpuPeak) {
        const clockText = load.clock?.allCoreMHz ? `, ${load.clock.allCoreMHz} MHz em todos os núcleos` : '';
        fact(state, 'cpu', `sob carga: ${Math.round(load.temps.cpuPeak)} °C${clockText}`, 'info');
      }
      await pace(state, stageStart, Deep.STAGES[8].minMs, []);
      if (cancelled(state)) return finishCancelled(state);

      // 10. Juntando as pistas: erros que apareceram durante os testes e a causa provável
      stageStart = stage(9, 'conferindo se algo errou durante os testes…');
      if (platform === 'win32') {
        const out = await until(state, quiet(scriptWithEnv(Scan.DURING_SCRIPT, { NEXO_SINCE: String(Math.round(state.startedAt)) }, 40000)));
        tests.during = out ? Scan.parseDuring(out) : null;
      }
      if (cancelled(state)) return finishCancelled(state);
      const draftAll = Deep.buildFindings({ profile, health, facts: factsValue, observation, load, drives: drivesMarked, startup: startupValue, onBattery: battery, now: now(), ...tests });
      const causes = draftAll.filter((item) => item.id.startsWith('causa-'));
      const serious = draftAll.filter((item) => item.severity === 'alta' || item.severity === 'media').length;
      await pace(state, stageStart, Deep.STAGES[9].minMs, [
        () => setAction(state, `relacionando ${draftAll.length} pistas de todas as etapas…`),
        tests.during && (tests.during.whea || tests.during.tdr || tests.during.disk) ? { node: null, text: 'erro registrado durante os testes', level: 'warn' } : { node: null, text: 'nenhum erro de hardware durante os testes', level: 'ok' },
        ...causes.slice(0, 2).map((item) => ({ node: AREA_NODE[item.area] || null, text: item.title, level: 'warn' })),
        !causes.length && { node: null, text: serious ? `${serious} ponto(s) para ajustar, sem sinal de defeito` : 'nada de grave: o PC está saudável', level: serious ? 'info' : 'ok' }
      ]);
      while (!cancelled(state) && now() - state.startedAt < Deep.MIN_TOTAL_MS) { setAction(state, 'juntando tudo…'); await sleep(500); }
      if (cancelled(state)) return finishCancelled(state);

      // Relatório
      setAction(state, 'montando o relatório…');
      const history = (await quiet(store?.load())) || { runs: [] };
      const at = now();
      const draft = Deep.buildFindings({ profile, health, facts: factsValue, observation, load, drives: drivesMarked, startup: startupValue, onBattery: battery, now: at, ...tests });
      const record = Deep.runRecord({ at, durationMs: at - state.startedAt, profile, load, findings: draft, observation, onBattery: battery });
      const previous = (history.runs || []).filter((run) => run && run.at < at).sort((a, b) => b.at - a.at)[0] || null;
      const comparison = Deep.compareRuns(record, previous);
      const finalFindings = comparison ? Deep.buildFindings({ profile, health, facts: factsValue, observation, load, drives: drivesMarked, startup: startupValue, comparison, onBattery: battery, now: at, ...tests }) : draft;
      record.findings = finalFindings.map((item) => ({ id: item.id, severity: item.severity, title: item.title }));
      record.score = Deep.healthScore(finalFindings);
      const report = {
        id: state.id, at, durationMs: at - state.startedAt, platform, onBattery: battery,
        profile: publicProfile(profile), lines, health: publicHealth(health), observation, load, findings: finalFindings,
        tests: publicTests(tests),
        score: record.score, comparison, history: [...(history.runs || []), record].filter((run) => run.fingerprint === record.fingerprint).slice(-8).map(({ at: when, scores, temps, score }) => ({ at: when, scores, temps, score: Number.isFinite(score) ? score : null }))
      };
      const runs = [...(history.runs || []), record].slice(-HISTORY_LIMIT);
      await quiet(store?.save({ version: 1, runs, last: report }));
      state.status = 'done'; state.stageIndex = Deep.STAGES.length;
      // A constelação final mostra o veredito completo, inclusive o que só o teste de carga revelou.
      for (const item of finalFindings) if ((item.severity === 'alta' || item.severity === 'media') && AREA_NODE[item.area]) state.verdicts[AREA_NODE[item.area]] = 'warn';
      for (const id of Object.keys(state.nodes)) state.nodes[id] = state.verdicts[id] === 'warn' || state.nodes[id] === 'warn' ? 'warn' : 'done';
      setAction(state, 'pronto');
      return report;
    } catch (error) {
      state.status = 'error';
      state.error = String(error?.message || error).slice(0, 200);
      push(state);
      throw error;
    } finally {
      try { gpuWake(0); } catch { /* nada desenhando */ }
      current = null;
    }
  }

  function finishCancelled(state) {
    state.status = 'cancelled';
    setAction(state, 'análise cancelada');
    return { cancelled: true };
  }

  function cancel() {
    if (!current) return { ok: false };
    current.cancel = true;
    current.onAbort?.();
    try { current.abort?.abort(); } catch { /* testes já terminaram */ }
    try { gpuWake(0); } catch { /* nada desenhando */ }
    try { cancelBench(); } catch { /* nada rodando */ }
    return { ok: true };
  }

  return { run, cancel, isRunning: () => Boolean(current), status: () => (current ? snapshot(current) : null), last: async () => (await quiet(store?.load()))?.last || null };
}

/** O que vai para a tela: sem nada que não seja da peça (nenhum caminho, nenhum nome de usuário). */
function publicProfile(profile) {
  return { ...profile, memory: { ...profile.memory, modules: (profile.memory?.modules || []).map(({ slot, bank, channel, capacityBytes, maker, part, type, configured, rated, ratedSource, cl, jedec, formFactor }) => ({ slot, bank, channel, capacityBytes, maker, part, type, configured, rated, ratedSource, cl, jedec, formFactor })) } };
}
function publicHealth(health) {
  if (!health) return null;
  const { platform, events, wheaIds, tdrDrivers, crashes, rebootPending, fastStartup, lastBoot, problemDevices, failedUnits, journalReadable, swap, bugCodes, powerLoss } = health;
  return { platform, events, wheaIds, tdrDrivers, crashes, rebootPending, fastStartup, lastBoot, problemDevices, failedUnits, journalReadable, swap, bugCodes, powerLoss };
}
/** Resultados dos testes que vão para a tela (e para a página de Drivers): sem caminhos, só medidas e nomes. */
function publicTests(tests) {
  const drivers = tests.drivers ? Object.fromEntries(Object.entries(tests.drivers.groups).map(([key, list]) => [key, list.slice(0, 12).map(({ name, provider, version, date, ids, ageDays, generic }) => ({ name, provider, version, date, ids, ageDays, generic }))])) : null;
  return {
    memtest: tests.memtest ? { testedMB: tests.memtest.testedMB, passes: tests.memtest.passes, errors: tests.memtest.errors, bandwidthMBs: tests.memtest.bandwidthMBs } : null,
    gpuStress: tests.gpuStress || null, diskTest: tests.diskTest ? { sizeMB: tests.diskTest.sizeMB, seqWriteMBs: tests.diskTest.seqWriteMBs, latency: tests.diskTest.latency } : null,
    drivers, network: tests.network ? { gateway: tests.network.gateway || null, internet: tests.network.internet || null, checks: (tests.network.doctor?.checks || []).map(({ id, level, title }) => ({ id, level, title })) } : null,
    during: tests.during || null
  };
}

/** Linha do /proc/stat e afins para a observação no Linux. */
function createLinuxSystemReader({ fs }) {
  let previousFaults = null;
  let previousDisk = null;
  return async function read() {
    const [stat, meminfo, vmstat, diskstats, mounts] = await Promise.all(['/proc/stat', '/proc/meminfo', '/proc/vmstat', '/proc/diskstats', '/proc/mounts'].map((file) => fs.readFile(file, 'utf8').catch(() => '')));
    const cpuLine = stat.split('\n').find((line) => line.startsWith('cpu '));
    const values = cpuLine ? cpuLine.trim().split(/\s+/).slice(1).map(Number) : [];
    const cpu = values.length >= 7 ? { total: values.slice(0, 8).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), idle: values[3] + values[4], irq: values[5], softirq: values[6] } : null;
    const availKB = Number((meminfo.match(/MemAvailable:\s*(\d+)/) || [])[1]);
    const faults = Number((vmstat.match(/^pgmajfault\s+(\d+)/m) || [])[1]);
    const at = Date.now();
    let majorFaults = null;
    if (previousFaults && Number.isFinite(faults)) majorFaults = Math.max(0, (faults - previousFaults.value) / Math.max(0.5, (at - previousFaults.at) / 1000));
    if (Number.isFinite(faults)) previousFaults = { value: faults, at };
    const rootDev = String((mounts.split('\n').find((line) => line.split(' ')[1] === '/') || '').split(' ')[0] || '').replace('/dev/', '').replace(/p?\d+$/, '');
    const diskLine = diskstats.split('\n').map((line) => line.trim().split(/\s+/)).find((parts) => parts[2] === rootDev);
    let diskBusy = null;
    if (diskLine) {
      const ioTicks = Number(diskLine[12]);
      if (previousDisk && Number.isFinite(ioTicks)) diskBusy = Math.min(100, Math.max(0, ((ioTicks - previousDisk.value) / Math.max(1, at - previousDisk.at)) * 100));
      if (Number.isFinite(ioTicks)) previousDisk = { value: ioTicks, at };
    }
    const psi = {};
    for (const kind of ['cpu', 'memory', 'io']) {
      const text = await fs.readFile(`/proc/pressure/${kind}`, 'utf8').catch(() => '');
      const some = text.match(/some avg10=([\d.]+)/);
      psi[kind] = some ? Number(some[1]) : null;
    }
    return { cpu, availMB: Number.isFinite(availKB) ? availKB / 1024 : null, majorFaults, diskBusy, psi };
  };
}

module.exports = { createDeepAnalysis, createLinuxSystemReader, publicProfile, publicHealth, publicTests, HISTORY_LIMIT, MEMTEST_MS, GPU_STRESS_MS };
