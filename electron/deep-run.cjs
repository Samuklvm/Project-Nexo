/*
 * Orquestra a Análise profunda em 7 etapas, com no mínimo 60 s (MIN_TOTAL_MS) e mais tempo quando precisa confirmar
 * algo (um pico que acabou de aparecer). A cada passo emite um retrato completo do progresso para a tela desenhar a
 * constelação: etapa atual, estado de cada peça, o que está fazendo agora e as últimas descobertas.
 * Tudo somente leitura; nada é encerrado nem alterado. O teste de carga dura uns 20 s e respeita o laboratório.
 * O relatório e o histórico ficam só neste PC (analise-profunda.json na pasta de dados do app).
 */
const Hardware = require('../src/hardware-kb.js');
const Deep = require('../src/deep-analysis.js');
const Scan = require('./deep-scan.cjs');

const HISTORY_LIMIT = 20;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });

function createDeepAnalysis(deps) {
  const {
    platform = process.platform, now = Date.now, sleep = wait,
    runPowerShellCode, spawnFn, linuxCollector = null, linuxProcesses = null, linuxSystem = null,
    sensors = async () => null, nvidia = async () => [], bench = async () => null, cancelBench = () => {}, facts = async () => null,
    startup = async () => null, drives = async () => [], screenDisplays = () => [], selfPids = () => new Set(),
    match = null, classify = null, onBattery = () => false, gpuWake = () => {}, emit = () => {}, store = null, memoryTotal = () => null
  } = deps;
  let current = null;

  /* ---------------- estado do progresso ---------------- */
  function snapshot(state) {
    return {
      runId: state.id, status: state.status, stageIndex: state.stageIndex, total: Deep.STAGES.length,
      stages: Deep.STAGES.map((stage, index) => ({ id: stage.id, label: stage.label, state: index < state.stageIndex ? 'done' : index === state.stageIndex && state.status === 'running' ? 'active' : state.status === 'done' ? 'done' : 'pending' })),
      nodes: { ...state.nodes }, action: state.action, facts: state.facts.slice(-5), elapsedMs: now() - state.startedAt, minMs: Deep.MIN_TOTAL_MS,
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
    const baseTicks = 10;
    const maxTicks = 20;
    const stageStart = now();
    if (platform === 'win32') {
      let resolveEnd;
      const ended = new Promise((resolve) => { resolveEnd = resolve; });
      let limit = baseTicks;
      const stream = Scan.streamScript({
        spawnFn, script: Scan.OBSERVE_SCRIPT, env: { NEXO_TICKS: String(maxTicks), NEXO_WAIT_MS: '3000' }, timeoutMs: 150000,
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
    setAction(state, `observando o que roda por trás: leitura ${done} de ${state.observed?.of || 10}`);
  }

  /** Teste de carga: processador (todos os núcleos e um só), sensores e a placa de vídeo acordada. */
  async function loadTest(state, profile) {
    const phases = {};
    const sensorReads = [];
    const ticks = [];
    const linuxFreq = [];
    const benchOut = {};
    let nvidiaRows = [];
    let links = [];
    const readSensors = async (phase) => { const snapshotValue = await until(state, quiet(sensors())); if (snapshotValue) sensorReads.push({ phase, snapshot: snapshotValue }); };
    const idleSensors = await until(state, quiet(sensors()));
    let stream = null;
    if (platform === 'win32') stream = Scan.streamScript({ spawnFn, script: Scan.LOAD_SCRIPT, env: { NEXO_TICKS: '30' }, timeoutMs: 60000, onLine: (line) => { const parsed = Scan.parseLoadLine(line); if (parsed?.kind === 'tick') ticks.push(parsed); } });
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
      setAction(state, 'todos os núcleos no máximo por 10 segundos…');
      phases.multi = { start: now() };
      const multi = bench('multi', 10000);
      const multiSensors = (async () => { for (let i = 0; i < 3 && !cancelled(state); i += 1) { await sleep(3000); await readSensors('multi'); } })();
      const multiResult = await until(state, quiet(multi));
      await until(state, multiSensors);
      phases.multi.end = now();
      benchOut.multi = multiResult?.mopsPerSec ?? null;
      benchOut.threads = multiResult?.threads ?? null;
      if (cancelled(state)) return null;
      setAction(state, 'um núcleo só, para ver o turbo…');
      phases.single = { start: now() };
      const single = bench('single', 3000);
      await sleep(1500);
      await readSensors('single');
      const singleResult = await until(state, quiet(single));
      phases.single.end = now();
      benchOut.single = singleResult?.mopsPerSec ?? null;
      node(state, 'cpu', 'done');
      if (cancelled(state)) return null;
      node(state, 'gpu', 'active');
      setAction(state, 'acordando a placa de vídeo para medir o link PCIe…');
      phases.gpu = { start: now() };
      try { gpuWake(6000); } catch { /* sem janela */ }
      await sleep(2500);
      const [nv, linkOut] = await until(state, Promise.all([quiet(nvidia()), platform === 'win32' ? quiet(runPowerShellCode(Scan.LINK_SCRIPT, 20000)) : null])) || [];
      nvidiaRows = Array.isArray(nv) ? nv : [];
      if (platform === 'win32' && linkOut) links = Scan.parseLinks(linkOut.stdout).map((item) => ({ name: Hardware.cleanName(item.name), link: Hardware.decodeLink(item.link) }));
      await readSensors('gpu');
      if (cancelled(state)) return null;
      await sleep(Math.max(0, 6000 - (now() - phases.gpu.start)));
      phases.gpu.end = now();
      node(state, 'gpu', 'done');
    } finally {
      freq.on = false;
      stream?.stop();
      if (freqLoop) await until(state, freqLoop);
      if (cancelled(state)) cancelBench();
    }
    return Deep.summarizeLoad({ ticks, phases, sensors: sensorReads, bench: benchOut, nvidia: nvidiaRows, links, idleSensors, platform, linuxFreq });
  }

  /* ---------------- etapas ---------------- */
  const AREA_NODE = { processador: 'cpu', memoria: 'memory', video: 'gpu', disco: 'disk', windows: 'windows', energia: 'windows', fundo: 'windows', rede: 'network' };
  const levelOf = (findings, areas) => {
    const relevant = findings.filter((item) => areas.includes(item.area));
    if (relevant.some((item) => item.severity === 'alta' || item.severity === 'media')) return 'warn';
    return 'done';
  };
  const topLine = (findings, areas) => findings.filter((item) => areas.includes(item.area) && (item.severity === 'alta' || item.severity === 'media')).slice(0, 2).map((item) => ({ text: item.title, level: 'warn' }));
  const okLine = (findings, areas) => findings.filter((item) => areas.includes(item.area) && item.severity === 'ok').slice(0, 1).map((item) => ({ text: item.title, level: 'ok' }));

  async function run() {
    if (current) throw new Error('A análise profunda já está rodando.');
    const state = { id: `${now().toString(36)}`, status: 'running', startedAt: now(), stageIndex: 0, nodes: Object.fromEntries(Deep.NODES.map((item) => [item.id, 'pending'])), action: 'começando…', facts: [], extended: null, observed: null, cancel: false, announced: new Set(), selfPids: new Set(), verdicts: {} };
    state.aborted = new Promise((resolve) => { state.onAbort = () => resolve(null); });
    current = state;
    try {
      state.selfPids = selfPids() || new Set();
      push(state);
      // Saúde, fatos, inicialização e discos correm em paralelo desde já; cada etapa usa o seu quando chega a vez.
      const healthP = quiet(collectHealth());
      const factsP = quiet(facts());
      const startupP = quiet(startup());
      const drivesP = quiet(drives());
      const battery = Boolean(onBattery());

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
      const provisional = () => Deep.buildFindings({ profile, health, facts: factsValue, drives: drivesMarked, startup: null, onBattery: battery, now: now() });

      // 2. Memória
      state.stageIndex = 1; stageStart = now(); node(state, 'memory', 'active');
      setAction(state, 'conferindo pentes, canais e a velocidade nominal…');
      let findings = provisional();
      const memoryText = lines.find((line) => line.node === 'memory')?.text || (profile.memory?.totalBytes ? `${Hardware.gbText(profile.memory.totalBytes)} de memória${platform === 'linux' ? ' (os pentes só aparecem para o administrador no Linux)' : ''}` : null);
      const rated = profile.memory?.modules?.find((module) => module.ratedSource === 'código do pente');
      await pace(state, stageStart, Deep.STAGES[1].minMs, [
        memoryText && { node: 'memory', text: memoryText },
        rated && { node: 'memory', text: `${rated.part}: vendido para ${rated.rated}${rated.cl ? ' CL' + rated.cl : ''}${rated.jedec ? ' (padrão, sem perfil XMP)' : ''}` },
        () => setAction(state, 'conferindo o arquivo de paginação e a memória livre…'),
        ...[...topLine(findings, ['memoria']), ...okLine(findings, ['memoria'])].map((line) => ({ node: 'memory', ...line })),
        () => node(state, 'memory', levelOf(findings, ['memoria']))
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 3. Vídeo e tela
      state.stageIndex = 2; stageStart = now(); node(state, 'gpu', 'active');
      setAction(state, 'lendo placas de vídeo, drivers e monitores…');
      const gpuLines = lines.filter((line) => line.node === 'gpu');
      findings = provisional();
      await pace(state, stageStart, Deep.STAGES[2].minMs, [
        ...gpuLines.slice(0, 4).map((line) => ({ node: 'gpu', text: line.text })),
        () => setAction(state, 'comparando a taxa do monitor com o máximo que ele aceita…'),
        ...[...topLine(findings, ['video']), ...okLine(findings, ['video'])].map((line) => ({ node: 'gpu', ...line })),
        () => node(state, 'gpu', levelOf(findings, ['video']))
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 4. Disco
      state.stageIndex = 3; stageStart = now(); node(state, 'disk', 'active');
      setAction(state, 'conferindo tipo, saúde e link dos discos…');
      findings = provisional();
      await pace(state, stageStart, Deep.STAGES[3].minMs, [
        ...lines.filter((line) => line.node === 'disk').slice(0, 3).map((line) => ({ node: 'disk', text: line.text })),
        ...topLine(findings, ['disco']).map((line) => ({ node: 'disk', ...line })),
        () => node(state, 'disk', levelOf(findings, ['disco']))
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 5. Windows e rede
      state.stageIndex = 4; stageStart = now(); node(state, 'windows', 'active'); node(state, 'network', 'active');
      setAction(state, 'lendo 30 dias de eventos do sistema…');
      const startupValue = await until(state, startupP);
      if (cancelled(state)) return finishCancelled(state);
      findings = Deep.buildFindings({ profile, health, facts: factsValue, drives: drivesMarked, startup: startupValue, onBattery: battery, now: now() });
      const events = health?.events || {};
      const eventsText = health ? (platform === 'win32' ? [events.bugcheck?.count ? `${events.bugcheck.count} tela(s) azul(is)` : 'nenhuma tela azul', events.tdr?.count ? `${events.tdr.count} travada(s) do driver de vídeo` : null, (health.wheaIds || []).length ? 'erros de hardware (WHEA)' : null].filter(Boolean).join(', ') : health.journalReadable ? 'diário do kernel lido' : 'o diário do kernel exige permissão neste Linux') : null;
      await pace(state, stageStart, Deep.STAGES[4].minMs, [
        profile.os?.name && { node: 'windows', text: profile.os.name },
        eventsText && { node: 'windows', text: `30 dias: ${eventsText}` },
        ...lines.filter((line) => line.node === 'network').slice(0, 2).map((line) => ({ node: 'network', text: line.text })),
        ...topLine(findings, ['windows', 'rede', 'energia']).map((line) => ({ node: 'windows', ...line })),
        () => { node(state, 'windows', levelOf(findings, ['windows', 'energia'])); node(state, 'network', levelOf(findings, ['rede'])); }
      ]);
      if (cancelled(state)) return finishCancelled(state);

      // 6. O que roda por trás
      state.stageIndex = 5; stageStart = now();
      setAction(state, 'observando o que roda por trás (o próprio Nexo, jogos e launchers ficam de fora)…');
      const observed = await observe(state);
      const observation = Deep.summarizeObservation({ ...observed, selfPids: state.selfPids, match, classify, memoryTotalBytes: memoryTotal() });
      if (platform === 'linux') observation.system.psi = observed.ticks.map((tick) => tick.psi).filter(Boolean).pop() || null;
      await pace(state, stageStart, Deep.STAGES[5].minMs, []);
      if (cancelled(state)) return finishCancelled(state);

      // 7. Teste de carga
      state.stageIndex = 6; stageStart = now();
      setAction(state, 'preparando o teste de carga…');
      const load = await loadTest(state, profile);
      if (cancelled(state)) return finishCancelled(state);
      if (load?.temps?.cpuPeak) {
        const clockText = load.clock?.allCoreMHz ? `, ${load.clock.allCoreMHz} MHz em todos os núcleos` : '';
        fact(state, 'cpu', `sob carga: ${Math.round(load.temps.cpuPeak)} °C${clockText}`, 'info');
      }
      await pace(state, stageStart, Deep.STAGES[6].minMs, []);
      while (!cancelled(state) && now() - state.startedAt < Deep.MIN_TOTAL_MS) { setAction(state, 'juntando tudo…'); await sleep(500); }
      if (cancelled(state)) return finishCancelled(state);

      // Relatório
      setAction(state, 'montando o relatório…');
      const history = (await quiet(store?.load())) || { runs: [] };
      const at = now();
      const draft = Deep.buildFindings({ profile, health, facts: factsValue, observation, load, drives: drivesMarked, startup: startupValue, onBattery: battery, now: at });
      const record = Deep.runRecord({ at, durationMs: at - state.startedAt, profile, load, findings: draft, observation, onBattery: battery });
      const previous = (history.runs || []).filter((run) => run && run.at < at).sort((a, b) => b.at - a.at)[0] || null;
      const comparison = Deep.compareRuns(record, previous);
      const finalFindings = comparison ? Deep.buildFindings({ profile, health, facts: factsValue, observation, load, drives: drivesMarked, startup: startupValue, comparison, onBattery: battery, now: at }) : draft;
      record.findings = finalFindings.map((item) => ({ id: item.id, severity: item.severity, title: item.title }));
      record.score = Deep.healthScore(finalFindings);
      const report = {
        id: state.id, at, durationMs: at - state.startedAt, platform, onBattery: battery,
        profile: publicProfile(profile), lines, health: publicHealth(health), observation, load, findings: finalFindings,
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
  const { platform, events, wheaIds, tdrDrivers, crashes, rebootPending, fastStartup, lastBoot, problemDevices, failedUnits, journalReadable, swap } = health;
  return { platform, events, wheaIds, tdrDrivers, crashes, rebootPending, fastStartup, lastBoot, problemDevices, failedUnits, journalReadable, swap };
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

module.exports = { createDeepAnalysis, createLinuxSystemReader, publicProfile, publicHealth, HISTORY_LIMIT };
