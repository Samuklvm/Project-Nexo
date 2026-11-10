/*
 * Quadros por segundo a partir do CSV do PresentMon (MIT, Intel). Funções puras.
 * Lê as colunas pelo NOME (a ordem muda entre versões): MsBetweenPresents/FrameTime, MsCPUBusy, MsGPUBusy.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoFps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const num = (text) => { const value = Number(String(text ?? '').trim()); return text === undefined || text === '' || String(text).trim().toUpperCase() === 'NA' ? NaN : value; };

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
    return sorted[rank - 1];
  }

  const FIELDS = {
    app: ['application'], pid: ['processid'],
    ms: ['msbetweenpresents', 'frametime'],
    cpuBusy: ['mscpubusy', 'cpubusy'], gpuBusy: ['msgpubusy', 'gpubusy'],
    dropped: ['dropped']
  };

  /** Alimenta linha a linha; devolve um quadro ({ms, cpuBusy, gpuBusy, dropped, app, pid}) ou null. */
  function createFrameParser() {
    let columns = null;
    return {
      get ready() { return columns !== null; },
      push(line) {
        const text = String(line).replace(/^\uFEFF/, '').trim();
        if (!text) return null;
        const cells = text.split(',');
        if (!columns) {
          const names = cells.map((cell) => cell.trim().toLowerCase());
          if (!(names.includes('application') && names.includes('processid'))) return null;
          columns = {};
          for (const [key, aliases] of Object.entries(FIELDS)) {
            const index = names.findIndex((name) => aliases.includes(name));
            if (index >= 0) columns[key] = index;
          }
          columns.displayed = names.indexOf('displayedtime');
          return null;
        }
        if (columns.ms === undefined) return null;
        const ms = num(cells[columns.ms]);
        if (!finite(ms) || ms <= 0 || ms > 60000) return null;
        const dropped = columns.dropped !== undefined ? ['1', 'true'].includes(String(cells[columns.dropped]).trim().toLowerCase())
          : columns.displayed >= 0 ? String(cells[columns.displayed]).trim().toUpperCase() === 'NA' : false;
        return {
          ms, dropped,
          cpuBusy: columns.cpuBusy !== undefined ? num(cells[columns.cpuBusy]) : NaN,
          gpuBusy: columns.gpuBusy !== undefined ? num(cells[columns.gpuBusy]) : NaN,
          app: columns.app !== undefined ? String(cells[columns.app]).trim() : '', pid: columns.pid !== undefined ? Number(cells[columns.pid]) : 0
        };
      }
    };
  }

  /** Média dos `fraction` maiores tempos de quadro (o "pior 1%"), já ordenados do menor para o maior. */
  function worstMean(sorted, fraction) {
    const n = Math.max(1, Math.ceil(sorted.length * fraction));
    let sum = 0;
    for (let i = sorted.length - n; i < sorted.length; i += 1) sum += sorted[i];
    return sum / n;
  }

  /**
   * Resumo de um conjunto de quadros. "1% baixo" = FPS da MÉDIA do pior 1% dos quadros (como o CapFrameX e os
   * overlays); o percentil 99 continua disponível como p1Fps. Idem para 0,1%.
   */
  function summarize(frames) {
    const valid = frames.filter((frame) => finite(frame.ms) && frame.ms > 0);
    if (valid.length < 10) return null;
    const times = valid.map((frame) => frame.ms).sort((a, b) => a - b);
    const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
    const median = percentile(times, 50);
    const p99 = percentile(times, 99);
    const p999 = percentile(times, 99.9);
    const stutterLimit = Math.max(2 * median, 30);
    const withBusy = valid.filter((frame) => finite(frame.cpuBusy) && finite(frame.gpuBusy));
    const share = (predicate) => (withBusy.length ? withBusy.filter(predicate).length / withBusy.length : null);
    return {
      frames: valid.length,
      avgFps: 1000 / mean,
      p1LowFps: 1000 / worstMean(times, 0.01),
      p01LowFps: 1000 / worstMean(times, 0.001),
      p1Fps: 1000 / p99,
      p01Fps: 1000 / p999,
      frameMs: { p50: median, p95: percentile(times, 95), p99, max: times[times.length - 1] },
      stutterCount: valid.filter((frame) => frame.ms > stutterLimit).length,
      droppedShare: valid.filter((frame) => frame.dropped).length / valid.length,
      gpuBoundShare: share((frame) => frame.gpuBusy >= 0.9 * frame.ms),
      cpuBoundShare: share((frame) => frame.cpuBusy >= 0.9 * frame.ms && frame.gpuBusy < 0.8 * frame.ms),
      hasBusy: withBusy.length > 0
    };
  }

  /** FPS por segundo, para o gráfico (no máximo `limit` pontos). */
  function perSecond(frames, limit = 7200) {
    const out = [];
    let acc = 0;
    let count = 0;
    for (const frame of frames) {
      acc += frame.ms; count += 1;
      if (acc >= 1000) { out.push(Math.round((count * 1000) / acc * 10) / 10); acc = 0; count = 0; }
    }
    if (out.length <= limit) return out;
    const size = Math.ceil(out.length / limit);
    const compact = [];
    for (let i = 0; i < out.length; i += size) { const slice = out.slice(i, i + size); compact.push(slice.reduce((a, v) => a + v, 0) / slice.length); }
    return compact;
  }

  /** Janela deslizante para mostrar o FPS atual enquanto a sessão grava. */
  function createRolling(windowMs = 1000) {
    const frames = [];
    return {
      push(frame) { frames.push(frame.ms); let total = frames.reduce((a, v) => a + v, 0); while (total > windowMs && frames.length > 1) { total -= frames.shift(); } },
      snapshot() { if (!frames.length) { return { fps: null, worstMs: null }; } const total = frames.reduce((a, v) => a + v, 0); return { fps: (frames.length * 1000) / total, worstMs: Math.max(...frames) }; }
    };
  }

  /*
   * Acumulador sem limite de quadros (sessão de horas): histograma fino dos tempos de quadro (0,05 ms até 200 ms;
   * 1 ms até 60 s) com a soma exata por faixa, contadores e a série por segundo. Memória fixa (~760 KB), e o resumo
   * cobre a sessão INTEIRA — antes os quadros paravam de ser guardados em 400 mil (≈ 28 min a 240 FPS).
   */
  const FINE = 4000;          // 0 a 200 ms em passos de 0,05 ms
  const BINS = FINE + 59800;  // 200 ms a 60 s em passos de 1 ms
  const binOf = (ms) => (ms < 200 ? Math.floor(ms * 20) : Math.min(BINS - 1, FINE + Math.floor(ms - 200)));
  function createAccumulator({ seriesLimit = 7200 } = {}) {
    const counts = new Uint32Array(BINS);
    const sums = new Float64Array(BINS);
    let count = 0; let total = 0; let max = 0; let dropped = 0;
    let busy = 0; let gpuBound = 0; let cpuBound = 0;
    const series = []; let acc = 0; let inSecond = 0;
    function push(frame) {
      if (!frame || !finite(frame.ms) || frame.ms <= 0) return;
      const bin = binOf(frame.ms);
      counts[bin] += 1; sums[bin] += frame.ms;
      count += 1; total += frame.ms; if (frame.ms > max) max = frame.ms;
      if (frame.dropped) dropped += 1;
      if (finite(frame.cpuBusy) && finite(frame.gpuBusy)) {
        busy += 1;
        if (frame.gpuBusy >= 0.9 * frame.ms) gpuBound += 1;
        if (frame.cpuBusy >= 0.9 * frame.ms && frame.gpuBusy < 0.8 * frame.ms) cpuBound += 1;
      }
      acc += frame.ms; inSecond += 1;
      if (acc >= 1000) { series.push(Math.round((inSecond * 1000) / acc * 10) / 10); acc = 0; inSecond = 0; }
    }
    /** Tempo de quadro no percentil p (pela faixa: média da faixa onde ele cai). */
    function quantile(p) {
      const rank = Math.min(count, Math.max(1, Math.ceil((p / 100) * count)));
      let seen = 0;
      for (let i = 0; i < BINS; i += 1) { seen += counts[i]; if (seen >= rank) return sums[i] / counts[i]; }
      return max;
    }
    /** Média do pior `fraction` dos quadros (soma exata das faixas de cima; a faixa da borda entra pela média dela). */
    function worst(fraction) {
      let need = Math.max(1, Math.ceil(count * fraction));
      const n = need;
      let sum = 0;
      for (let i = BINS - 1; i >= 0 && need > 0; i -= 1) {
        if (!counts[i]) continue;
        const take = Math.min(need, counts[i]);
        sum += take === counts[i] ? sums[i] : (sums[i] / counts[i]) * take;
        need -= take;
      }
      return sum / n;
    }
    function summary() {
      if (count < 10) return null;
      const median = quantile(50);
      const stutterLimit = Math.max(2 * median, 30);
      let stutters = 0;
      for (let i = binOf(stutterLimit); i < BINS; i += 1) stutters += counts[i];
      return {
        frames: count, avgFps: 1000 / (total / count), p1LowFps: 1000 / worst(0.01), p01LowFps: 1000 / worst(0.001), p1Fps: 1000 / quantile(99), p01Fps: 1000 / quantile(99.9),
        frameMs: { p50: median, p95: quantile(95), p99: quantile(99), max },
        stutterCount: stutters, droppedShare: dropped / count,
        gpuBoundShare: busy ? gpuBound / busy : null, cpuBoundShare: busy ? cpuBound / busy : null, hasBusy: busy > 0
      };
    }
    function perSecondSeries() {
      if (series.length <= seriesLimit) return series.slice();
      const size = Math.ceil(series.length / seriesLimit);
      const compact = [];
      for (let i = 0; i < series.length; i += size) { const slice = series.slice(i, i + size); compact.push(slice.reduce((a, v) => a + v, 0) / slice.length); }
      return compact;
    }
    return { push, summary, series: perSecondSeries, get count() { return count; } };
  }

  return { createFrameParser, summarize, perSecond, createRolling, createAccumulator, percentile };
});
