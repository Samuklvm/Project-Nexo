/*
 * Nexo Brain — motor local de análise.
 * O que "aprender" significa aqui, de forma honesta e verificável:
 *  1. Rotina: médias e variações por hora da semana (168 faixas), atualizadas continuamente.
 *  2. Lentidões: episódios sustentados de CPU, RAM, temperatura e queda de clock.
 *  3. Culpados: quais programas estavam no topo durante cada episódio.
 *  4. Confiança: ajustada pelo feedback "ajudou / não ajudou" de cada tipo de sugestão.
 * Tudo roda e fica neste computador. Nenhum dado sai daqui.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoBrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const BUCKETS = 168;
  const METRICS = ['cpu', 'mem', 'disk', 'gpu', 'temp'];
  const MAX_EPISODES = 120;
  const MAX_LEDGER = 60;
  const EPISODE_RETENTION = 30 * DAY;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const comma = (value, digits = 1) => value.toFixed(digits).replace('.', ',');
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const bucketOf = (t) => { const d = new Date(t); return d.getDay() * 24 + d.getHours(); };

  const EPISODE_RULES = {
    cpu: { open: 3, close: 2, label: 'CPU alta' },
    memory: { open: 3, close: 2, label: 'Memória no limite' },
    thermal: { open: 2, close: 2, label: 'Temperatura alta' },
    throttle: { open: 2, close: 2, label: 'Queda de clock' }
  };

  function emptyState() {
    const grid = () => Array.from({ length: BUCKETS }, () => [0, 0, 0]);
    return {
      v: 1, firstSeen: 0, minutes: 0, maxClock: null,
      buckets: Object.fromEntries(METRICS.map((m) => [m, grid()])),
      episodes: [], ledger: {}
    };
  }

  function create(saved) {
    const state = emptyState();
    if (saved && saved.v === 1) {
      for (const metric of METRICS) {
        const stored = saved.buckets?.[metric];
        if (Array.isArray(stored) && stored.length === BUCKETS) state.buckets[metric] = stored.map((cell) => [Number(cell[0]) || 0, Number(cell[1]) || 0, Number(cell[2]) || 0]);
      }
      state.firstSeen = Number(saved.firstSeen) || 0;
      state.minutes = Number(saved.minutes) || 0;
      state.maxClock = finite(saved.maxClock) ? saved.maxClock : null;
      state.episodes = Array.isArray(saved.episodes) ? saved.episodes.filter((e) => e && finite(e.start)).slice(-MAX_EPISODES) : [];
      state.ledger = saved.ledger && typeof saved.ledger === 'object' ? saved.ledger : {};
    }
    const runtime = {}; // streaks e episódio aberto por tipo; vive só em memória

    function expected(metric, t) {
      const cell = state.buckets[metric]?.[bucketOf(t)];
      if (!cell || cell[0] < 8) return null;
      return { mean: cell[1], sd: Math.max(Math.sqrt(Math.max(cell[2], 0)), 5), n: cell[0] };
    }

    function zscore(metric, value, t) {
      const e = expected(metric, t);
      return e && finite(value) ? (value - e.mean) / e.sd : null;
    }

    function learnBucket(metric, value, t) {
      if (!finite(value)) return;
      const cell = state.buckets[metric][bucketOf(t)];
      cell[0] += 1;
      const alpha = Math.max(1 / cell[0], 0.03);
      const diff = value - cell[1];
      const increment = alpha * diff;
      cell[1] += increment;
      cell[2] = (1 - alpha) * (cell[2] + diff * increment);
    }

    function conditions(sample) {
      const zCpu = zscore('cpu', sample.cpu, sample.t);
      const zMem = zscore('mem', sample.mem, sample.t);
      const throttled = finite(sample.clockRatio) && sample.clockRatio <= 0.78 && sample.cpu >= 70 && finite(sample.temp) && sample.temp >= 80;
      return {
        cpu: finite(sample.cpu) && (sample.cpu >= 85 || (zCpu !== null && zCpu >= 3 && sample.cpu >= 60)),
        memory: finite(sample.mem) && (sample.mem >= 90 || (zMem !== null && zMem >= 3 && sample.mem >= 75)),
        thermal: finite(sample.temp) && sample.temp >= 90,
        throttle: Boolean(throttled)
      };
    }

    function peakFor(kind, sample) {
      if (kind === 'cpu') return sample.cpu;
      if (kind === 'memory') return sample.mem;
      if (kind === 'thermal') return sample.temp;
      return finite(sample.clockRatio) ? Math.round(sample.clockRatio * 100) : null;
    }

    function closeEpisode(kind, endT) {
      const run = runtime[kind];
      if (!run?.open) return;
      const votes = Object.entries(run.votes).sort((a, b) => b[1] - a[1]);
      const episode = {
        kind, start: run.open.start, end: endT, peak: run.open.peak,
        minutes: Math.max(1, Math.round((endT - run.open.start) / MIN)),
        culprit: votes[0]?.[0] || null
      };
      state.episodes.push(episode);
      if (episode.culprit) {
        const entry = state.ledger[episode.culprit] || { events: 0, minutes: 0, last: 0 };
        entry.events += 1; entry.minutes += episode.minutes; entry.last = endT;
        state.ledger[episode.culprit] = entry;
        const names = Object.keys(state.ledger);
        if (names.length > MAX_LEDGER) {
          names.sort((a, b) => state.ledger[a].minutes - state.ledger[b].minutes).slice(0, names.length - MAX_LEDGER).forEach((n) => delete state.ledger[n]);
        }
      }
      state.episodes = state.episodes.filter((e) => e.end >= endT - EPISODE_RETENTION).slice(-MAX_EPISODES);
      run.open = null; run.votes = {}; run.lowStreak = 0;
    }

    /** Uma amostra por minuto: {t, cpu, mem, disk, gpu, temp, clockRatio, culprit} */
    function ingest(sample) {
      if (!finite(sample?.t)) return;
      if (!state.firstSeen) state.firstSeen = sample.t;
      state.minutes += 1;
      if (finite(sample.clock) && (state.maxClock === null || sample.clock > state.maxClock)) state.maxClock = sample.clock;

      const active = conditions(sample);
      for (const kind of Object.keys(EPISODE_RULES)) {
        const rule = EPISODE_RULES[kind];
        const run = runtime[kind] || (runtime[kind] = { high: 0, lowStreak: 0, open: null, votes: {}, firstT: 0, peak: null });
        if (active[kind]) {
          if (!run.high) run.firstT = sample.t;
          run.high += 1; run.lowStreak = 0;
          const peak = peakFor(kind, sample);
          run.peak = kind === 'throttle' ? (run.peak === null ? peak : Math.min(run.peak, peak ?? run.peak)) : Math.max(run.peak ?? 0, peak ?? 0);
          if (sample.culprit) run.votes[sample.culprit] = (run.votes[sample.culprit] || 0) + 1;
          if (!run.open && run.high >= rule.open) run.open = { start: run.firstT, peak: run.peak };
          if (run.open) run.open.peak = run.peak;
        } else {
          run.high = 0; run.peak = null;
          if (run.open) {
            run.lowStreak += 1;
            if (run.lowStreak >= rule.close) closeEpisode(kind, sample.t - rule.close * MIN);
          } else run.votes = {};
        }
      }
      // A rotina só aprende com minutos "normais", senão o pico viraria o padrão.
      const anyEpisode = Object.values(active).some(Boolean);
      for (const metric of METRICS) {
        if (metric === 'disk' || !anyEpisode) learnBucket(metric, sample[metric], sample.t);
      }
    }

    function recentEpisodes(sinceMs, now = Date.now(), kinds = null) {
      const open = Object.entries(runtime).filter(([, r]) => r.open).map(([kind, r]) => ({
        kind, start: r.open.start, end: now, peak: r.open.peak, minutes: Math.max(1, Math.round((now - r.open.start) / MIN)),
        culprit: Object.entries(r.votes).sort((a, b) => b[1] - a[1])[0]?.[0] || null, ongoing: true
      }));
      return [...state.episodes, ...open]
        .filter((e) => e.end >= now - sinceMs && (!kinds || kinds.includes(e.kind)))
        .sort((a, b) => b.start - a.start);
    }

    function ledger() {
      return Object.entries(state.ledger)
        .map(([name, v]) => ({ name, events: v.events, minutes: v.minutes, last: v.last }))
        .sort((a, b) => b.minutes - a.minutes || b.events - a.events);
    }

    function habitGrid(metric = 'cpu') {
      const cells = state.buckets[metric] || [];
      const grid = Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => {
        const cell = cells[day * 24 + hour];
        return cell && cell[0] >= 3 ? Math.round(cell[1] * 10) / 10 : null;
      }));
      const values = grid.flat().filter(finite);
      return { grid, max: values.length ? Math.max(...values) : 0, min: values.length ? Math.min(...values) : 0 };
    }

    function learning(now = Date.now()) {
      const known = state.buckets.cpu.filter((cell) => cell[0] >= 5).length;
      return {
        minutes: state.minutes,
        coverage: Math.round((known / BUCKETS) * 100),
        days: state.firstSeen ? Math.max(0, Math.floor((now - state.firstSeen) / DAY)) : 0,
        episodes: state.episodes.length,
        culprits: Object.keys(state.ledger).length
      };
    }

    return {
      ingest, expected, zscore, recentEpisodes, ledger, habitGrid, learning,
      clockRatio: (clock) => (state.maxClock && finite(clock) ? clamp(clock / state.maxClock, 0, 1.2) : null),
      serialize: () => JSON.parse(JSON.stringify(state)),
      reset: () => { Object.assign(state, emptyState()); for (const k of Object.keys(runtime)) delete runtime[k]; }
    };
  }

  /** Previsão linear de ocupação do disco principal (amostras {t, disk}). */
  function forecastDisk(history, now = Date.now()) {
    const points = history.filter((s) => finite(s.disk) && s.t >= now - 7 * DAY).map((s) => [(s.t - now) / DAY, s.disk]);
    if (points.length < 200) return null;
    const span = points[points.length - 1][0] - points[0][0];
    if (span < 1.5) return null;
    const n = points.length;
    const sx = points.reduce((a, p) => a + p[0], 0), sy = points.reduce((a, p) => a + p[1], 0);
    const sxx = points.reduce((a, p) => a + p[0] * p[0], 0), sxy = points.reduce((a, p) => a + p[0] * p[1], 0);
    const denom = n * sxx - sx * sx;
    if (!denom) return null;
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    const meanY = sy / n;
    const ssTot = points.reduce((a, p) => a + (p[1] - meanY) ** 2, 0);
    const ssRes = points.reduce((a, p) => a + (p[1] - (intercept + slope * p[0])) ** 2, 0);
    const r2 = ssTot ? 1 - ssRes / ssTot : 0;
    const current = intercept;
    if (slope < 0.05 || r2 < 0.35) return { slopePerDay: slope, daysToFull: null, r2, spanDays: span, current };
    const days = (100 - current) / slope;
    return { slopePerDay: slope, daysToFull: days > 0 && days < 365 ? days : null, r2, spanDays: span, current };
  }

  function average(history, key, windowMs, now) {
    const values = history.filter((s) => s.t >= now - windowMs && finite(s[key])).map((s) => s[key]);
    return values.length >= 3 ? values.reduce((a, v) => a + v, 0) / values.length : null;
  }

  /** Índice Nexo: heurístico, explicável, sem promessa de desempenho. */
  function healthScore(ctx) {
    const now = ctx.now ?? Date.now();
    const history = ctx.history || [];
    const factors = [];
    const add = (id, label, points, detail, warnAt = 4, badAt = 10) => {
      const rounded = Math.round(points);
      factors.push({ id, label, points: rounded, status: rounded >= badAt ? 'bad' : rounded >= warnAt ? 'warn' : 'ok', detail });
    };
    const cpuAvg = average(history, 'cpu', 30 * MIN, now) ?? ctx.cpu;
    const memAvg = average(history, 'mem', 30 * MIN, now) ?? ctx.mem;
    if (finite(cpuAvg)) add('cpu', 'Processador', clamp((cpuAvg - 60) / 40, 0, 1) * 20 + (ctx.cpu >= 90 ? 3 : 0), `Média de ${Math.round(cpuAvg)}% nos últimos 30 min`);
    if (finite(memAvg)) add('memory', 'Memória', clamp((memAvg - 70) / 30, 0, 1) * 22, `Média de ${Math.round(memAvg)}% em uso`);
    if (finite(ctx.disk)) {
      const f = ctx.forecast;
      const soon = f?.daysToFull != null ? (f.daysToFull <= 3 ? 10 : f.daysToFull <= 14 ? 6 : 0) : 0;
      add('disk', 'Armazenamento', clamp((ctx.disk - 80) / 20, 0, 1) * 18 + soon, f?.daysToFull != null && soon ? `${Math.round(ctx.disk)}% ocupado; cheio em cerca de ${pl(Math.max(1, Math.round(f.daysToFull)), 'dia', 'dias')} no ritmo atual` : `${Math.round(ctx.disk)}% ocupado`);
    }
    if (finite(ctx.temp)) add('thermal', 'Temperatura', clamp((ctx.temp - 75) / 20, 0, 1) * 18, `${Math.round(ctx.temp)} °C reportados`);
    const day = 24 * 60 * MIN;
    const brain = ctx.brain;
    const throttles = brain ? brain.recentEpisodes(day, now, ['throttle']).length : 0;
    if (brain) add('throttle', 'Limites de desempenho', throttles ? 8 : 0, throttles ? `${pl(throttles, 'queda', 'quedas')} de clock com calor nas últimas 24 h` : 'Nenhuma queda de clock com calor nas últimas 24 h');
    const slow = brain ? brain.recentEpisodes(day, now, ['cpu', 'memory']).length : 0;
    if (brain) add('slowdowns', 'Lentidões recentes', Math.min(slow, 5) * 2, slow ? `${pl(slow, 'episódio', 'episódios')} de CPU ou memória nas últimas 24 h` : 'Nenhum episódio nas últimas 24 h');
    if (finite(ctx.uptimeSeconds)) {
      const days = ctx.uptimeSeconds / 86400;
      add('uptime', 'Tempo ligado', days > 30 ? 6 : days > 14 ? 3 : 0, `${days >= 1 ? pl(Math.floor(days), 'dia', 'dias') : 'menos de 1 dia'} sem reiniciar`, 3, 6);
    }
    const total = factors.reduce((sum, f) => sum + f.points, 0);
    const score = Math.round(clamp(100 - total, 5, 100));
    const verdict = score >= 90 ? 'Tudo certo' : score >= 75 ? 'Bom, com pontos de atenção' : score >= 55 ? 'Merece atenção' : 'Precisa de cuidado';
    return { score, verdict, factors: factors.sort((a, b) => b.points - a.points) };
  }

  const SEVERITY_RANK = { bad: 0, warn: 1, info: 2 };

  function confidenceWith(feedback, category, base) {
    const entries = (feedback || []).filter((e) => e?.category === category && typeof e.helpful === 'boolean').slice(-30);
    if (entries.length < 3) return { value: base, votes: entries.length };
    const rate = (entries.filter((e) => e.helpful).length + 1) / (entries.length + 2);
    return { value: Math.round(base * 0.7 + rate * 100 * 0.3), votes: entries.length };
  }

  const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const fmtBytes = (bytes) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let v = bytes; let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`;
  };

  /** Explicações com evidência. ctx: {brain, snapshot, processes, cleanup, sensors, power, history, feedback, now} */
  function buildInsights(ctx) {
    const now = ctx.now ?? Date.now();
    const s = ctx.snapshot || {};
    const brain = ctx.brain;
    const history = ctx.history || [];
    const out = [];
    const push = (item) => {
      const c = confidenceWith(ctx.feedback, item.category, item.confidence);
      out.push({ ...item, confidence: c.value, votes: c.votes });
    };
    const cpuLead = ctx.processes?.byCpu?.[0];
    const memLead = ctx.processes?.byMemory?.[0];
    const cpuAvg = average(history, 'cpu', 30 * MIN, now);
    const zCpu = brain && finite(s.cpuUsage) ? brain.zscore('cpu', s.cpuUsage, now) : null;
    const expectedCpu = brain?.expected('cpu', now);

    if (s.cpuUsage >= 85 || (zCpu !== null && zCpu >= 3 && s.cpuUsage >= 60)) {
      const evidence = [`Uso agora: ${Math.round(s.cpuUsage)}%.`];
      if (expectedCpu) evidence.push(`Neste horário da semana o normal é ${Math.round(expectedCpu.mean)}% (${expectedCpu.n} registros).`);
      if (cpuLead && cpuLead.cpuPercent >= 5) evidence.push(`${cpuLead.name} liderou a amostra com ${Math.round(cpuLead.cpuPercent)}%.`);
      push({
        id: 'cpu-now', category: 'cpu', severity: s.cpuUsage >= 95 ? 'bad' : 'warn', title: 'O processador está sobrecarregado',
        summary: cpuLead && cpuLead.cpuPercent >= 5 ? `${cpuLead.name} é o principal consumidor neste momento.` : 'Nenhum programa isolado explica o uso; pode ser soma de vários.',
        evidence, actions: [{ type: 'task-manager', label: 'Ver processos' }],
        confidence: cpuLead && cpuLead.cpuPercent >= 5 ? (zCpu >= 3 ? 82 : 70) : 48
      });
    }
    if (s.memoryPercent >= 85) {
      const evidence = [`RAM em ${Math.round(s.memoryPercent)}% (${fmtBytes(s.memoryUsedBytes)} de ${fmtBytes(s.memoryTotalBytes)}).`];
      if (memLead) evidence.push(`${memLead.name} usa ${fmtBytes(memLead.memoryBytes)}.`);
      push({
        id: 'memory-now', category: 'memory', severity: s.memoryPercent >= 93 ? 'bad' : 'warn', title: 'A memória está quase cheia',
        summary: 'Com pouca RAM livre o Windows passa a usar o disco como apoio, e tudo fica mais lento.',
        evidence, actions: [{ type: 'task-manager', label: 'Ver processos' }], confidence: memLead ? 72 : 52
      });
    }
    const disk = s.primaryDrive?.usedPercent;
    const forecast = ctx.forecast ?? forecastDisk(history, now);
    if (finite(disk) && (disk >= 90 || (forecast?.daysToFull != null && forecast.daysToFull <= 21))) {
      const evidence = [`Unidade ${s.primaryDrive.driveLetter}: com ${Math.round(disk)}% ocupado e ${fmtBytes(s.primaryDrive.freeBytes)} livres.`];
      if (forecast?.daysToFull != null) evidence.push(`No ritmo dos últimos ${comma(forecast.spanDays)} dias (+${comma(forecast.slopePerDay, 2)} ponto por dia), o disco enche em cerca de ${pl(Math.max(1, Math.round(forecast.daysToFull)), 'dia', 'dias')}.`);
      if (ctx.cleanup?.bytes > 0) evidence.push(`${fmtBytes(ctx.cleanup.bytes)} podem ser liberados com a limpeza segura.`);
      push({
        id: 'disk-space', category: 'disk', severity: disk >= 95 || (forecast?.daysToFull != null && forecast.daysToFull <= 5) ? 'bad' : 'warn',
        title: forecast?.daysToFull != null && disk < 90 ? 'O disco está enchendo' : 'Pouco espaço livre no disco',
        summary: 'Discos muito cheios perdem desempenho e deixam de receber atualizações e arquivos temporários.',
        evidence, actions: ctx.cleanup?.bytes > 0 ? [{ type: 'goto-optimize', label: 'Abrir limpeza' }] : [], confidence: forecast?.daysToFull != null ? clamp(Math.round(55 + forecast.r2 * 35), 55, 90) : 70
      });
    }
    const hotLimit = ctx.sensors?.cpuTemperature ?? ctx.sensors?.gpuTemperature ?? ctx.temp;
    if (finite(hotLimit) && hotLimit >= 85) {
      push({
        id: 'thermal', category: 'thermal', severity: hotLimit >= 92 ? 'bad' : 'warn', title: 'Temperatura elevada',
        summary: 'Calor constante reduz a vida útil e faz o processador baixar a frequência.',
        evidence: [`Maior leitura: ${Math.round(hotLimit)} °C.`, 'Compare com o limite térmico informado pelo fabricante do componente.'],
        actions: [], confidence: 66
      });
    }
    const throttled = brain ? brain.recentEpisodes(24 * 60 * MIN, now, ['throttle']) : [];
    if (throttled.length) {
      const last = throttled[0];
      push({
        id: 'throttle', category: 'throttle', severity: 'warn', title: 'O processador reduziu a velocidade por calor',
        summary: 'Houve momentos de carga alta com a frequência bem abaixo do máximo já observado e temperatura alta: indício de limitação térmica.',
        evidence: [`${pl(throttled.length, 'ocorrência', 'ocorrências')} nas últimas 24 h; a última durou ${last.minutes} min.`, last.peak != null ? `Menor frequência registrada: ${last.peak}% do máximo.` : 'Frequência abaixo de 78% do máximo observado.'],
        actions: [], confidence: 58
      });
    }
    if (brain) {
      const ledger = brain.ledger().filter((e) => e.events >= 2);
      if (ledger.length) {
        const top = ledger[0];
        push({
          id: 'culprit', category: 'culprit', severity: 'info', title: `${top.name} costuma estar por trás das lentidões`,
          summary: 'Este programa apareceu no topo do consumo em vários episódios de sobrecarga.',
          evidence: [`${pl(top.events, 'episódio', 'episódios')}, somando ${top.minutes} min de lentidão.`], actions: [{ type: 'task-manager', label: 'Ver processos' }],
          confidence: clamp(50 + top.events * 6, 50, 88)
        });
      }
      const grid = brain.habitGrid('cpu');
      let peak = null;
      grid.grid.forEach((row, day) => row.forEach((v, hour) => { if (v !== null && v >= 55 && (!peak || v > peak.v)) peak = { v, day, hour }; }));
      if (peak && brain.learning(now).coverage >= 20) {
        push({
          id: 'habit', category: 'habit', severity: 'info', title: `Seu pico de uso costuma ser ${WEEKDAYS[peak.day]}, às ${String(peak.hour).padStart(2, '0')}h`,
          summary: 'Aprendido pela sua rotina; vale evitar tarefas pesadas (atualizações, antivírus) nesse horário.',
          evidence: [`Média de ${Math.round(peak.v)}% de CPU nessa faixa.`], actions: [], confidence: 60
        });
      }
    }
    if (finite(s.uptimeSeconds) && s.uptimeSeconds > 14 * 86400) {
      push({
        id: 'uptime', category: 'uptime', severity: 'info', title: 'Faz muito tempo que o PC não reinicia',
        summary: 'Reiniciar limpa vazamentos de memória e aplica atualizações pendentes do Windows.',
        evidence: [`Ligado há ${Math.floor(s.uptimeSeconds / 86400)} dias.`], actions: [], confidence: 62
      });
    }
    const plan = ctx.power?.active?.name || '';
    if (/econom|saver/i.test(plan) && (cpuAvg ?? s.cpuUsage) >= 55) {
      push({
        id: 'power-saver', category: 'power', severity: 'info', title: 'O plano de energia limita o desempenho',
        summary: `O plano ativo (${plan}) reduz a frequência do processador para poupar energia.`,
        evidence: [`Uso médio recente de CPU: ${Math.round(cpuAvg ?? s.cpuUsage)}%.`], actions: [{ type: 'goto-optimize', label: 'Trocar plano' }], confidence: 64
      });
    }
    return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence);
  }

  return { create, forecastDisk, healthScore, buildInsights, confidenceWith, WEEKDAYS, METRICS };
});
