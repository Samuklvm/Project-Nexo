/*
 * Sessões de observação: análise de uma gravação (sistema a 1 Hz, sonda de programas a cada ~5 s, FPS opcional).
 * Cada achado carrega evidência, confiança e LIMITES. Sem FPS, nenhum achado afirma queda de quadros.
 * Funções puras; a coleta fica na interface e no processo principal.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./profiles.js'));
  else root.NexoSession = factory(root.NexoProfiles);
})(typeof self !== 'undefined' ? self : this, function (Profiles) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const round1 = (value) => Math.round(value * 10) / 10;
  const comma = (value, digits = 0) => value.toFixed(digits).replace('.', ',');
  const IGNORED_PROCESSES = /^(idle|system|registry|memory compression|powershell|pwsh|conhost|nexo.*|dwm|csrss|svchost|audiodg|searchhost|runtimebroker)$/i;

  /* ---------- Detecção de jogo (heurística por pasta de biblioteca; nunca lê a memória do jogo) ---------- */
  const GAME_FOLDERS = [/\\steamapps\\common\\/i, /\\epic games\\(?!launcher)/i, /\\gog galaxy\\games\\/i, /\\gog games\\/i, /\\riot games\\/i,
    /\\ubisoft game launcher\\games\\/i, /\\ea games\\/i, /\\origin games\\/i, /\\xboxgames\\/i, /\\rockstar games\\/i, /\\blizzard\\/i,
    /\/steamapps\/common\//i, /\/games\/heroic\//i, /\/heroic\/(legendary|gog)?/i, /\/lutris\//i, /\/games\/(epic|gog)\//i];
  const NOT_GAMES = /^(steam|steamwebhelper|heroic|lutris|gamescope|wineserver|explorer\.exe|epicgameslauncher|galaxyclient|riotclientservices|riotclientux|battle\.net|ubisoftconnect|upc|eadesktop|origin|xboxapp|gamingservices|chrome|msedge|firefox|explorer|discord|code|devenv|obs64|launcher)$/i;

  function classifyForeground(foreground) {
    if (!foreground || !foreground.name) return { isGame: false, reason: 'sem programa em primeiro plano' };
    const name = String(foreground.name);
    if (NOT_GAMES.test(name.replace(/\.exe$/i, ''))) return { isGame: false, reason: 'programa conhecido que não é jogo' };
    if (foreground.path && GAME_FOLDERS.some((pattern) => pattern.test(String(foreground.path)))) return { isGame: true, reason: 'está numa pasta de biblioteca de jogos' };
    return { isGame: false, reason: 'não está numa pasta de biblioteca de jogos' };
  }

  /* ---------- Estatística ---------- */
  function stats(values) {
    const list = values.filter(finite).sort((a, b) => a - b);
    if (!list.length) return null;
    const at = (p) => list[Math.min(list.length, Math.max(1, Math.ceil((p / 100) * list.length))) - 1];
    return { n: list.length, avg: list.reduce((a, v) => a + v, 0) / list.length, min: list[0], max: list[list.length - 1], p50: at(50), p95: at(95), p99: at(99) };
  }
  const shareOf = (values, predicate) => { const list = values.filter(finite); return list.length ? list.filter(predicate).length / list.length : 0; };

  /** Reduz a série de 1 Hz para buckets de `bucketSeconds` (média; máximo para o núcleo mais ocupado). */
  function compactTimeline(samples, startedAt, bucketSeconds = 5) {
    const buckets = new Map();
    for (const sample of samples) {
      const index = Math.floor((sample.t - startedAt) / (bucketSeconds * 1000));
      if (index < 0) continue;
      const bucket = buckets.get(index) || { n: 0, cpu: [], maxCore: [], mem: [], gpu: [], temp: [], fps: [] };
      bucket.n += 1;
      for (const key of ['cpu', 'maxCore', 'mem', 'gpu', 'temp', 'fps']) if (finite(sample[key])) bucket[key].push(sample[key]);
      buckets.set(index, bucket);
    }
    const avg = (list) => (list.length ? round1(list.reduce((a, v) => a + v, 0) / list.length) : null);
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([index, b]) => ({
      s: index * bucketSeconds, cpu: avg(b.cpu), maxCore: b.maxCore.length ? round1(Math.max(...b.maxCore)) : null, mem: avg(b.mem), gpu: avg(b.gpu), temp: avg(b.temp), fps: avg(b.fps)
    }));
  }

  /** Trechos contínuos em que `test` vale por pelo menos `minSeconds`. */
  function episodes(samples, kind, test, value, minSeconds = 8) {
    const out = [];
    let start = null;
    let last = null;
    let peak = null;
    const flush = () => { if (start !== null && last - start >= (minSeconds - 1) * 1000) out.push({ kind, startMs: start, endMs: last, seconds: Math.round((last - start) / 1000) + 1, peak }); start = null; peak = null; };
    for (const sample of samples) {
      if (test(sample)) { if (start === null) start = sample.t; last = sample.t; const v = value(sample); if (finite(v)) peak = peak === null ? v : Math.max(peak, v); } else flush();
    }
    flush();
    return out;
  }

  /** Segundos em que cada programa esteve em primeiro plano, a partir das leituras da sonda. */
  function foregroundSummary(probes) {
    if (!probes.length) return [];
    const gaps = probes.slice(1).map((probe, i) => probe.t - probes[i].t).filter((gap) => gap > 0 && gap < 60000).sort((a, b) => a - b);
    const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] / 1000 : 5;
    const totals = new Map();
    for (const probe of probes) {
      if (!probe.fg?.name) continue;
      const entry = totals.get(probe.fg.name) || { name: probe.fg.name, seconds: 0, isGame: false };
      entry.seconds += step; entry.isGame = entry.isGame || Boolean(probe.fg.isGame);
      totals.set(probe.fg.name, entry);
    }
    return [...totals.values()].map((entry) => ({ ...entry, seconds: Math.round(entry.seconds) })).sort((a, b) => b.seconds - a.seconds);
  }

  /** Quem pesou fora do primeiro plano: média e presença por programa. */
  function backgroundLoad(probes, field, valueKey, threshold) {
    if (!probes.length) return null;
    const totals = new Map();
    for (const probe of probes) {
      const fgName = probe.fg?.name;
      for (const item of probe[field] || []) {
        if (!item?.name || IGNORED_PROCESSES.test(item.name) || item.name === fgName) continue;
        const entry = totals.get(item.name) || { name: item.name, sum: 0, ticks: 0 };
        if (item[valueKey] >= threshold) { entry.sum += item[valueKey]; entry.ticks += 1; }
        totals.set(item.name, entry);
      }
    }
    const best = [...totals.values()].filter((entry) => entry.ticks > 0).map((entry) => ({ name: entry.name, avg: entry.sum / entry.ticks, presence: entry.ticks / probes.length })).sort((a, b) => b.presence * b.avg - a.presence * a.avg)[0];
    return best || null;
  }

  const LIMIT_NO_FPS = 'Sem FPS medido, não dá para afirmar se houve queda de quadros.';

  function analyze(input) {
    const { name = '', profile = 'geral', startedAt, endedAt, samples = [], probes = [], fps = null, overhead = null, hasGpuSensor = false, forcedGame = null } = input;
    const durationS = Math.max(0, Math.round((endedAt - startedAt) / 1000));
    const foreground = foregroundSummary(probes);
    const gameEntry = forcedGame ? foreground.find((entry) => entry.name === forcedGame) || { name: forcedGame, seconds: 0, isGame: true } : foreground.find((entry) => entry.isGame && entry.seconds >= 20);
    const game = gameEntry ? { name: gameEntry.name, seconds: gameEntry.seconds } : null;

    // Quando há jogo, os achados valem para os momentos em que ele estava em primeiro plano.
    let active = samples;
    if (game && probes.length) {
      const windows = probes.filter((probe) => probe.fg?.name === game.name).map((probe) => probe.t);
      if (windows.length) active = samples.filter((sample) => windows.some((t) => Math.abs(sample.t - t) <= 3000));
      if (active.length < 15) active = samples;
    }
    const col = (key, list = active) => list.map((sample) => sample[key]);
    const summary = { cpu: stats(col('cpu', samples)), maxCore: stats(col('maxCore', samples)), mem: stats(col('mem', samples)), gpu: stats(col('gpu', samples)), temp: stats(col('temp', samples)) };
    const activeSeconds = active.length;
    const findings = [];
    const add = (finding) => findings.push({ confidence: 60, limits: [], ...finding });

    if (!samples.length || durationS < 15) {
      add({ id: 'too-short', severity: 'info', title: 'Sessão curta demais para concluir', detail: 'Grave pelo menos 1 minuto para que as medições façam sentido.', evidence: [`Duração: ${durationS} s.`], confidence: 90 });
    } else {
      const gpuShare = shareOf(col('gpu'), (v) => v >= 95);
      const gpuHigh = shareOf(col('gpu'), (v) => v >= 90);
      const coreShare = shareOf(col('maxCore'), (v) => v >= 95);
      const cpuShare = shareOf(col('cpu'), (v) => v >= 90);
      const memShare = shareOf(col('mem'), (v) => v >= 90);
      const cpuAvg = summary.cpu?.avg ?? 0;
      const fpsLimit = fps ? [] : [LIMIT_NO_FPS];

      if (hasGpuSensor && gpuShare >= 0.5 && coreShare < 0.3) {
        add({ id: 'gpu-limited', severity: 'warn', title: 'A placa de vídeo ficou no limite', detail: 'A GPU trabalhou no máximo na maior parte do tempo enquanto o processador tinha folga. Reduzir resolução ou qualidade gráfica tende a ajudar mais do que mexer no processador.',
          evidence: [`GPU em 95% ou mais em ${comma(gpuShare * 100)}% do tempo.`, `Núcleo mais ocupado em 95% ou mais em ${comma(coreShare * 100)}% do tempo; uso médio da CPU ${comma(cpuAvg)}%.`], limits: fpsLimit, confidence: fps?.gpuBoundShare >= 0.5 ? 82 : 68 });
      }
      if (coreShare >= 0.35 && gpuHigh < 0.5 && cpuAvg < 75) {
        add({ id: 'cpu-thread-limited', severity: 'warn', title: 'Um núcleo do processador ficou no limite', detail: 'Um único núcleo chegou ao máximo enquanto o uso total e a GPU tinham folga: o programa depende de uma thread principal. Mais núcleos ou outro plano de energia pouco mudam; frequência e cache importam mais.',
          evidence: [`Núcleo mais ocupado em 95% ou mais em ${comma(coreShare * 100)}% do tempo.`, `Uso total médio da CPU: ${comma(cpuAvg)}%.`, hasGpuSensor ? `GPU em 90% ou mais em ${comma(gpuHigh * 100)}% do tempo.` : 'Sem sensor de GPU para comparar.'], limits: fpsLimit, confidence: fps?.cpuBoundShare >= 0.5 ? 80 : hasGpuSensor ? 66 : 50 });
      }
      if (cpuShare >= 0.25) {
        add({ id: 'cpu-saturated', severity: cpuShare >= 0.5 ? 'bad' : 'warn', title: 'O processador ficou saturado', detail: 'O uso total passou de 90% por boa parte da sessão, o que deixa o sistema sem folga para outras tarefas.',
          evidence: [`CPU em 90% ou mais em ${comma(cpuShare * 100)}% do tempo (média ${comma(cpuAvg)}%).`], confidence: 74 });
      }
      if (memShare >= 0.1 || (summary.mem?.max ?? 0) >= 96) {
        add({ id: 'memory-pressure', severity: memShare >= 0.3 ? 'bad' : 'warn', title: 'A memória chegou ao limite', detail: 'Com pouca RAM livre o Windows usa o disco como apoio, o que causa travadas.',
          evidence: [`RAM em 90% ou mais em ${comma(memShare * 100)}% do tempo; pico de ${comma(summary.mem?.max ?? 0)}%.`], confidence: 72 });
      }
      const heat = episodes(samples, 'thermal', (s) => finite(s.temp) && s.temp >= 90, (s) => s.temp, 15);
      const throttle = episodes(samples, 'throttle', (s) => finite(s.clockRatio) && s.clockRatio <= 0.78 && s.cpu >= 70 && finite(s.temp) && s.temp >= 80, (s) => Math.round(s.clockRatio * 100), 10);
      if (heat.length || throttle.length) {
        const evidence = [];
        if (heat.length) evidence.push(`${heat.length} trecho(s) com temperatura em 90 °C ou mais (pico ${comma(Math.max(...heat.map((e) => e.peak)))} °C).`);
        if (throttle.length) evidence.push(`${throttle.length} trecho(s) com o clock abaixo de 78% do máximo observado, sob carga e calor.`);
        add({ id: 'thermal', severity: 'warn', title: 'O calor pode ter limitado o desempenho', detail: 'Temperatura alta ou queda de frequência com carga indicam limitação térmica. Limpar poeira, melhorar a ventilação e revisar a pasta térmica costumam ajudar.', evidence, limits: ['É um indício, não uma prova: o clock também cai por limite de energia.'], confidence: throttle.length ? 66 : 58 });
      }
      const bgCpu = backgroundLoad(probes, 'cpu', 'cpu', 5);
      if (bgCpu && bgCpu.avg >= 8 && bgCpu.presence >= 0.4) {
        add({ id: 'background-load', severity: 'warn', title: `${bgCpu.name} pesou em segundo plano`, detail: 'Um programa que não estava em primeiro plano consumiu CPU durante boa parte da sessão. Fechá-lo ou adiar a tarefa dele libera folga.',
          evidence: [`${bgCpu.name}: média de ${comma(bgCpu.avg)}% da CPU em ${comma(bgCpu.presence * 100)}% das leituras.`], limits: ['O percentual é do total da CPU, medido a cada poucos segundos.'], confidence: 70 });
      }
      const bgGpu = backgroundLoad(probes, 'gpu', 'util', 10);
      if (bgGpu && bgGpu.avg >= 15 && bgGpu.presence >= 0.3) {
        add({ id: 'gpu-other-process', severity: 'info', title: `${bgGpu.name} também usou a GPU`, detail: 'Outro programa dividiu a placa de vídeo com o que estava em primeiro plano.',
          evidence: [`${bgGpu.name}: média de ${comma(bgGpu.avg)}% de uso da GPU em ${comma(bgGpu.presence * 100)}% das leituras.`], limits: ['Contador do Windows por programa; pode somar vários motores da GPU.'], confidence: 60 });
      }
      if (fps) {
        if (fps.p1LowFps < 0.6 * fps.avgFps) add({ id: 'fps-stutter', severity: 'warn', title: 'Os quadros variaram bastante', detail: 'O 1% baixo ficou bem abaixo da média, o que o olho percebe como engasgos mesmo com FPS médio alto.',
          evidence: [`FPS médio ${comma(fps.avgFps)}; 1% baixo ${comma(fps.p1LowFps)}; 0,1% baixo ${comma(fps.p01LowFps)}.`, `${fps.stutterCount} quadro(s) lento(s) (mais que o dobro da mediana e acima de 30 ms).`], confidence: 76 });
        if (fps.avgFps < 30) add({ id: 'fps-low', severity: 'warn', title: 'O FPS médio ficou baixo', detail: 'Abaixo de 30 quadros por segundo o movimento costuma parecer travado.', evidence: [`FPS médio ${comma(fps.avgFps)} em ${fps.frames} quadros.`], confidence: 80 });
      } else if (game) {
        add({ id: 'no-fps', severity: 'info', title: 'FPS e tempo de quadro não foram medidos', detail: 'Ative “Medir FPS com o PresentMon” na próxima sessão para saber se houve queda de quadros e onde.', evidence: [`Jogo detectado: ${game.name}.`], confidence: 90 });
      }
      if (!findings.some((f) => f.severity !== 'info')) {
        add({ id: 'ok', severity: 'info', title: 'Nenhum gargalo evidente nas medições do sistema', detail: 'CPU, GPU, memória e temperatura ficaram dentro do que o Nexo considera normal nesta sessão.', evidence: [`${activeSeconds} s analisados.`], limits: fpsLimit, confidence: 70 });
      }
    }

    const ranked = Profiles ? Profiles.rankFindings(profile, findings) : findings;
    const headline = ranked.filter((f) => f.severity !== 'info').slice(0, 2).map((f) => f.title);
    return {
      meta: { name, profile, startedAt, endedAt, durationS, samples: samples.length, probes: probes.length, hasGpuSensor, hasFps: Boolean(fps), activeSeconds },
      summary, game, foreground: foreground.slice(0, 8), findings: ranked,
      background: { cpu: backgroundLoad(probes, 'cpu', 'cpu', 5), gpu: backgroundLoad(probes, 'gpu', 'util', 10) },
      fps, overhead,
      conclusion: headline.length ? `${headline.join(' e ')}.` : 'Nenhum gargalo evidente nas medições do sistema.',
      limits: fps ? 'Medições de sistema a 1 Hz e FPS do programa escolhido.' : `Medições de sistema a 1 Hz, sem FPS. ${LIMIT_NO_FPS}`
    };
  }

  return { analyze, classifyForeground, stats, compactTimeline, episodes, foregroundSummary, backgroundLoad };
});
