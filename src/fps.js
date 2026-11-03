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

  /** Resumo de um conjunto de quadros. 1% baixo = FPS do percentil 99 do tempo de quadro. */
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
      p1LowFps: 1000 / p99,
      p01LowFps: 1000 / p999,
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
    let frames = [];
    return {
      push(frame) { frames.push(frame.ms); let total = frames.reduce((a, v) => a + v, 0); while (total > windowMs && frames.length > 1) { total -= frames.shift(); } },
      snapshot() { if (!frames.length) return { fps: null, worstMs: null }; const total = frames.reduce((a, v) => a + v, 0); return { fps: (frames.length * 1000) / total, worstMs: Math.max(...frames) }; }
    };
  }

  return { createFrameParser, summarize, perSecond, createRolling, percentile };
});
