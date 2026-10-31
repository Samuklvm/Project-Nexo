/* Gráficos em canvas: curvas suaves, preenchimento em degradê, dica ao passar o mouse e sparklines. */
(function () {
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const palette = () => ({ cpu: css('--c-cpu', '#5ad7ff'), mem: css('--c-mem', '#a08cff'), disk: css('--c-disk', '#ffb86b'), gpu: css('--c-gpu', '#6ef2c2'), acpi: css('--c-acpi', '#ffb86b') });

  function prepare(canvas) {
    const ratio = devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  function downsample(points, limit) {
    if (points.length <= limit) return points;
    const size = Math.ceil(points.length / limit);
    const out = [];
    for (let index = 0; index < points.length; index += size) {
      const bucket = points.slice(index, index + size);
      const valid = bucket.filter((point) => Number.isFinite(point[1]));
      out.push([bucket[bucket.length - 1][0], valid.length ? valid.reduce((sum, point) => sum + point[1], 0) / valid.length : null]);
    }
    return out;
  }

  function segments(points) {
    const out = [];
    let current = [];
    for (const point of points) {
      if (Number.isFinite(point[1])) current.push(point);
      else if (current.length) { out.push(current); current = []; }
    }
    if (current.length) out.push(current);
    return out;
  }

  function trace(context, pts) {
    context.moveTo(pts[0].x, pts[0].y);
    for (let index = 1; index < pts.length; index += 1) {
      const previous = pts[index - 1];
      const point = pts[index];
      const midX = (previous.x + point.x) / 2;
      context.bezierCurveTo(midX, previous.y, midX, point.y, point.x, point.y);
    }
  }

  function tickLabel(time, span) {
    const date = new Date(time);
    if (span >= 20 * 3600e3) return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  /** options: {series:[{label,color,data:[[t,v]]}], from, to, yMin, yMax, unit, decimals} */
  function line(canvas, options, hover = null) {
    const { context, width, height } = prepare(canvas);
    const pad = { left: 38, right: 8, top: 10, bottom: 20 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const { from, to, unit = '' } = options;
    const all = options.series.flatMap((serie) => serie.data.map((point) => point[1])).filter(Number.isFinite);
    let yMin = options.yMin;
    let yMax = options.yMax;
    if (yMin === undefined) {
      const low = all.length ? Math.min(...all) : 30;
      const high = all.length ? Math.max(...all) : 90;
      yMin = Math.max(0, Math.floor((low - 5) / 10) * 10);
      yMax = Math.max(yMin + 20, Math.ceil((high + 5) / 10) * 10);
    }
    const xOf = (t) => pad.left + ((t - from) / Math.max(1, to - from)) * plotW;
    const yOf = (v) => pad.top + (1 - (v - yMin) / Math.max(1e-6, yMax - yMin)) * plotH;

    context.font = '11px "Segoe UI", system-ui, sans-serif';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(154, 168, 214, 0.85)';
    context.strokeStyle = 'rgba(150, 175, 255, 0.1)';
    context.lineWidth = 1;
    for (let step = 0; step <= 2; step += 1) {
      const value = yMin + ((yMax - yMin) * step) / 2;
      const y = Math.round(yOf(value)) + 0.5;
      context.setLineDash(step === 0 ? [] : [3, 5]);
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
      context.textAlign = 'right';
      context.fillText(`${Math.round(value)}${unit === '%' ? '' : ''}`, pad.left - 8, y);
    }
    context.setLineDash([]);
    context.textAlign = 'left'; context.textBaseline = 'alphabetic';
    context.fillText(tickLabel(from, to - from), pad.left, height - 4);
    context.textAlign = 'right';
    context.fillText(tickLabel(to, to - from), width - pad.right, height - 4);

    const drawn = [];
    for (const serie of options.series) {
      const points = downsample(serie.data, Math.max(30, Math.floor(plotW / 3)));
      const parts = segments(points);
      for (const part of parts) {
        const pts = part.map((point) => ({ x: xOf(point[0]), y: yOf(Math.min(yMax, Math.max(yMin, point[1]))) }));
        if (pts.length < 2) { context.fillStyle = serie.color; context.beginPath(); context.arc(pts[0].x, pts[0].y, 2.5, 0, 7); context.fill(); continue; }
        if (options.fill !== false) {
          const gradient = context.createLinearGradient(0, pad.top, 0, pad.top + plotH);
          gradient.addColorStop(0, `${serie.color}55`);
          gradient.addColorStop(1, `${serie.color}00`);
          context.beginPath(); trace(context, pts);
          context.lineTo(pts[pts.length - 1].x, pad.top + plotH); context.lineTo(pts[0].x, pad.top + plotH); context.closePath();
          context.fillStyle = gradient; context.fill();
        }
        context.save();
        context.strokeStyle = serie.color; context.lineWidth = 2; context.lineJoin = 'round'; context.lineCap = 'round';
        context.shadowColor = serie.color; context.shadowBlur = 10;
        context.beginPath(); trace(context, pts); context.stroke();
        context.restore();
      }
      const last = [...points].reverse().find((point) => Number.isFinite(point[1]));
      if (last) {
        const x = xOf(last[0]); const y = yOf(Math.min(yMax, Math.max(yMin, last[1])));
        context.fillStyle = '#fff'; context.beginPath(); context.arc(x, y, 3, 0, 7); context.fill();
        context.strokeStyle = serie.color; context.lineWidth = 2; context.beginPath(); context.arc(x, y, 5.5, 0, 7); context.stroke();
      }
      drawn.push({ serie, points });
    }

    if (hover !== null) {
      const t = from + ((hover - pad.left) / plotW) * (to - from);
      const x = Math.min(width - pad.right, Math.max(pad.left, hover));
      context.strokeStyle = 'rgba(228, 234, 255, 0.35)'; context.lineWidth = 1;
      context.beginPath(); context.moveTo(x + 0.5, pad.top); context.lineTo(x + 0.5, pad.top + plotH); context.stroke();
      const readings = drawn.map(({ serie, points }) => {
        let best = null;
        for (const point of points) if (Number.isFinite(point[1]) && (best === null || Math.abs(point[0] - t) < Math.abs(best[0] - t))) best = point;
        return best && Math.abs(best[0] - t) < (to - from) / 8 ? { serie, point: best } : null;
      }).filter(Boolean);
      for (const { serie, point } of readings) {
        context.fillStyle = serie.color; context.beginPath(); context.arc(xOf(point[0]), yOf(point[1]), 4, 0, 7); context.fill();
      }
      return { x, t, readings };
    }
    return null;
  }

  const states = new WeakMap();
  /** Desenha e liga o mouse uma única vez por canvas. */
  function render(canvas, options, tip) {
    states.set(canvas, { options, tip });
    line(canvas, options);
    if (canvas.dataset.bound) return;
    canvas.dataset.bound = '1';
    canvas.addEventListener('pointermove', (event) => {
      const state = states.get(canvas);
      if (!state) return;
      const rect = canvas.getBoundingClientRect();
      const info = line(canvas, state.options, event.clientX - rect.left);
      const box = state.tip;
      if (!box || !info || !info.readings.length) { if (box) box.hidden = true; return; }
      const unit = state.options.unit || '';
      box.innerHTML = `<b>${new Date(info.t).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</b> ${info.readings.map(({ serie, point }) => `<span style="color:${serie.color}">●</span> ${escapeHtml(serie.label)} ${point[1].toFixed(unit === '°C' ? 0 : 0)}${unit}`).join(' · ')}`;
      box.hidden = false;
      box.style.left = `${Math.min(rect.width - 80, Math.max(80, info.x))}px`;
      box.style.top = '14px';
    });
    canvas.addEventListener('pointerleave', () => {
      const state = states.get(canvas);
      if (state?.tip) state.tip.hidden = true;
      if (state) line(canvas, state.options);
    });
  }

  function spark(canvas, values, color) {
    const { context, width, height } = prepare(canvas);
    const valid = values.filter(Number.isFinite);
    if (valid.length < 2) return;
    const low = Math.min(...valid);
    const high = Math.max(...valid);
    const span = Math.max(8, high - low);
    const pts = values.map((value, index) => (Number.isFinite(value) ? { x: (index / (values.length - 1)) * (width - 6) + 3, y: height - 3 - ((value - low) / span) * (height - 8) } : null)).filter(Boolean);
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `${color}40`); gradient.addColorStop(1, `${color}00`);
    context.beginPath(); trace(context, pts); context.lineTo(pts[pts.length - 1].x, height); context.lineTo(pts[0].x, height); context.closePath();
    context.fillStyle = gradient; context.fill();
    context.strokeStyle = color; context.lineWidth = 1.5; context.lineJoin = 'round';
    context.beginPath(); trace(context, pts); context.stroke();
  }

  Nexo.charts = { render, spark, palette, line };
})();
