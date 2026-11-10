/*
 * O que está limitando o PC — por amostra, por minuto e por sessão. Funções puras (testadas fora do Electron).
 *
 * "GPU em 100%" sozinho não prova que a placa é o gargalo: o contador do Windows mede quanto tempo o motor ficou
 * ocupado, não quanto trabalho ele fez. Por isso a classificação cruza:
 *  - carga do núcleo 3D (não o maior sensor de carga: decodificador de vídeo ou barramento a 100% não contam);
 *  - clock da GPU em relação ao máximo dela (ocupada mas devagar = modo de economia, calor ou driver);
 *  - energia em relação ao limite e o MOTIVO do clock baixo informado pelo driver (NVIDIA: limite de energia, calor);
 *  - memória de vídeo cheia, temperatura da GPU e do ponto mais quente;
 *  - o núcleo mais ocupado da CPU (jogo preso numa thread aparece com a CPU total baixa);
 *  - FPS colado na taxa do monitor (limite de quadros/V-Sync: nada está no limite de verdade);
 *  - quando há PresentMon, quem segurou cada quadro (tempo ocupado da GPU e da CPU por quadro).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoBottleneck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const LABELS = {
    gpu: 'Placa de vídeo no limite (desempenho real)',
    'gpu-energia': 'Placa de vídeo no teto de energia',
    'gpu-calor': 'Placa de vídeo segurada pelo calor',
    'gpu-vram': 'Memória de vídeo cheia',
    'gpu-baixo-clock': 'Placa de vídeo ocupada, mas em clock baixo',
    'gpu-e-cpu': 'Placa de vídeo e processador no limite juntos',
    'cpu-thread': 'Um núcleo do processador no limite',
    'cpu-total': 'Processador inteiro no limite',
    'cpu-calor': 'Processador segurado pelo calor',
    memoria: 'Memória RAM no limite',
    'limite-de-quadros': 'Limite de quadros ou V-Sync (nada no limite)',
    equilibrado: 'Sem gargalo claro (carga equilibrada)'
  };
  const GPU_KINDS = new Set(['gpu', 'gpu-energia', 'gpu-calor', 'gpu-vram', 'gpu-baixo-clock', 'gpu-e-cpu']);

  /**
   * Uma amostra: { cpu, maxCore, mem, gpu (núcleo 3D %), gpuClockRatio, gpuPowerPct, gpuLimits {power, thermal},
   * gpuTemp, gpuHot, vramPct, cpuTemp, cpuClockRatio, fps, refreshHz }. Devolve null quando não há carga para julgar.
   */
  /** Só o lado da placa de vídeo: null quando ela não está no limite (ou não há sensor). */
  function gpuKind(s = {}) {
    const gpu = finite(s.gpu) ? s.gpu : null;
    const core = finite(s.maxCore) ? s.maxCore : (finite(s.cpu) ? s.cpu : 0);
    if (finite(s.vramPct) && s.vramPct >= 95 && (gpu ?? 0) >= 60) return 'gpu-vram';
    if (gpu === null || gpu < 92) return null;
    if (s.gpuLimits?.thermal || (finite(s.gpuTemp) && s.gpuTemp >= 85 && finite(s.gpuClockRatio) && s.gpuClockRatio <= 0.85) || (finite(s.gpuHot) && s.gpuHot >= 100)) return 'gpu-calor';
    if (finite(s.gpuClockRatio) && s.gpuClockRatio < 0.6 && !(finite(s.gpuPowerPct) && s.gpuPowerPct >= 50)) return 'gpu-baixo-clock';
    if (core >= 95) return 'gpu-e-cpu';
    if (s.gpuLimits?.power || (finite(s.gpuPowerPct) && s.gpuPowerPct >= 95)) return 'gpu-energia';
    return 'gpu';
  }

  function classify(s = {}) {
    const cpu = finite(s.cpu) ? s.cpu : 0;
    const core = finite(s.maxCore) ? s.maxCore : cpu;
    const mem = finite(s.mem) ? s.mem : 0;
    const gpu = finite(s.gpu) ? s.gpu : null;
    if (cpu < 40 && core < 70 && (gpu ?? 0) < 50 && mem < 85) return null;
    const cpuHot = finite(s.cpuTemp) && s.cpuTemp >= 90 && finite(s.cpuClockRatio) && s.cpuClockRatio <= 0.78;
    if (finite(s.fps) && finite(s.refreshHz) && s.refreshHz >= 30 && s.fps >= 0.95 * s.refreshHz && (gpu ?? 0) < 90 && core < 90) return 'limite-de-quadros';
    if (mem >= 92) return 'memoria';
    const gpuSide = gpuKind(s);
    if (gpuSide) return gpuSide;
    if (core >= 95 && cpu < 85) return cpuHot ? 'cpu-calor' : 'cpu-thread';
    if (cpu >= 90) return cpuHot ? 'cpu-calor' : 'cpu-total';
    return 'equilibrado';
  }

  /** A classe que mais apareceu (empate: a primeira na ordem de gravidade da lista acima). */
  function majority(kinds) {
    const counts = {};
    for (const kind of kinds) if (kind) counts[kind] = (counts[kind] || 0) + 1;
    const order = Object.keys(LABELS);
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]?.[0] || null;
  }

  const percentile = (values, p) => {
    const list = values.filter(finite).sort((a, b) => a - b);
    if (!list.length) return null;
    return Math.round(list[Math.min(list.length - 1, Math.floor((p / 100) * list.length))] * 10) / 10;
  };
  const share = (values, test) => { const list = values.filter(finite); return list.length ? Math.round((list.filter(test).length / list.length) * 1000) / 1000 : null; };
  const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null && value !== undefined));

  /**
   * Resumo de um conjunto de amostras (um dia ou uma sessão). `fps` opcional: resumo do PresentMon (gpuBoundShare,
   * cpuBoundShare, avgFps, p1LowFps), que manda mais que os sensores quando existe.
   */
  function summarize(samples = [], { fps = null, refreshHz = null } = {}) {
    const kinds = samples.map((sample) => classify(sample)).filter(Boolean);
    const limiter = {};
    for (const kind of kinds) limiter[kind] = (limiter[kind] || 0) + 1;
    const loadedGpu = samples.filter((sample) => finite(sample.gpu) && sample.gpu >= 50);
    let verdict = majority(kinds);
    // Com o PresentMon, quem segurou os quadros decide (é medida direta, não indício).
    if (fps?.hasBusy) {
      if (fps.gpuBoundShare >= 0.6 && verdict && !GPU_KINDS.has(verdict)) verdict = 'gpu';
      else if (fps.cpuBoundShare >= 0.4 && verdict && GPU_KINDS.has(verdict) && verdict !== 'gpu-e-cpu') verdict = 'cpu-thread';
    }
    // O lado da GPU separado (para o achado da placa mesmo quando outra coisa também estava no limite, como a RAM).
    let gpuVerdict = majority(samples.map((sample) => gpuKind(sample)));
    if (fps?.hasBusy && fps.gpuBoundShare >= 0.6 && !gpuVerdict) gpuVerdict = 'gpu';
    return {
      verdict, label: verdict ? LABELS[verdict] : null, gpuVerdict, minutes: kinds.length, limiter,
      gpu: clean({
        busyP50: percentile(loadedGpu.map((s) => s.gpu), 50), busyP90: percentile(loadedGpu.map((s) => s.gpu), 90),
        clockRatioP50: percentile(loadedGpu.map((s) => s.gpuClockRatio), 50), powerPctP50: percentile(loadedGpu.map((s) => s.gpuPowerPct), 50),
        hotShare: share(samples.map((s) => s.gpuTemp), (v) => v >= 85), vramPctMax: percentile(samples.map((s) => s.vramPct), 100),
        engine3dP50: percentile(loadedGpu.map((s) => s.gpu3d), 50), saturatedShare: share(samples.map((s) => s.gpu), (v) => v >= 95),
        frameBoundShare: fps?.hasBusy && finite(fps.gpuBoundShare) ? Math.round(fps.gpuBoundShare * 1000) / 1000 : null
      }),
      cpu: clean({
        maxCoreP90: percentile(samples.map((s) => s.maxCore), 90), totalP50: percentile(samples.map((s) => s.cpu), 50),
        clockRatioP50: percentile(samples.filter((s) => finite(s.cpu) && s.cpu >= 50).map((s) => s.cpuClockRatio), 50), hotShare: share(samples.map((s) => s.cpuTemp), (v) => v >= 90)
      }),
      fps: fps ? clean({ avg: finite(fps.avgFps) ? Math.round(fps.avgFps) : null, p1Low: finite(fps.p1LowFps) ? Math.round(fps.p1LowFps) : null, refreshHz: finite(refreshHz) ? Math.round(refreshHz) : null,
        cappedShare: finite(refreshHz) && finite(fps.avgFps) ? (fps.avgFps >= 0.95 * refreshHz ? 1 : 0) : null }) : null
    };
  }

  /** Explicação curta para a tela: por que a conclusão é essa (com os números que pesaram). */
  function explain(summary) {
    if (!summary?.verdict) return 'Sem carga suficiente para dizer o que limitou.';
    const g = summary.gpu || {};
    const parts = [];
    if (finite(g.saturatedShare)) parts.push(`GPU em 95%+ em ${Math.round(g.saturatedShare * 100)}% do tempo`);
    if (finite(g.clockRatioP50)) parts.push(`clock da GPU em ${Math.round(g.clockRatioP50 * 100)}% do máximo dela`);
    if (finite(g.powerPctP50)) parts.push(`energia em ${Math.round(g.powerPctP50)}% do limite`);
    if (finite(g.frameBoundShare)) parts.push(`quadros segurados pela GPU: ${Math.round(g.frameBoundShare * 100)}%`);
    if (finite(summary.cpu?.maxCoreP90)) parts.push(`núcleo mais ocupado (p90) ${Math.round(summary.cpu.maxCoreP90)}%`);
    return `${summary.label}. ${parts.join(' · ')}.`;
  }

  return { classify, gpuKind, summarize, majority, explain, LABELS, GPU_KINDS };
});
