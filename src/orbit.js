/* Mapa do sistema: cada componente é um planeta. Mais carga = maior e mais rápido; calor = avermelhado. */
(function () {
  const canvas = document.getElementById('orbit-canvas');
  const legend = document.getElementById('orbit-legend');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const PLANETS = [
    { key: 'cpu', name: 'Processador', note: 'carga atual', orbit: 0.3, speed: 0.9, color: 'cpu' },
    { key: 'mem', name: 'Memória', note: 'em uso', orbit: 0.46, speed: 0.7, color: 'mem' },
    { key: 'disk', name: 'Armazenamento', note: 'ocupado', orbit: 0.62, speed: 0.12, color: 'disk', slow: true },
    { key: 'gpu', name: 'Vídeo', note: 'uso da GPU', orbit: 0.78, speed: 0.55, color: 'gpu' },
    { key: 'temp', name: 'Temperatura', note: 'maior sensor', orbit: 0.94, speed: 0.4, color: 'acpi', hot: true }
  ].map((planet, index) => ({ ...planet, angle: (index / 5) * Math.PI * 2 + 0.6, value: null, shown: 0, trail: [] }));

  if (legend) legend.innerHTML = PLANETS.map((planet) => `<li data-key="${planet.key}"><i data-css="color:var(--c-${planet.color === 'acpi' ? 'acpi' : planet.color === 'mem' ? 'mem' : planet.color})"></i><span>${planet.name} · ${planet.note}</span><b>--</b></li>`).join('');

  let width = 0;
  let height = 0;
  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 1.5); // nitidez de sobra sem multiplicar o tamanho do canvas em telas 4K
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function blend(hex, toward, amount) {
    const read = (value) => [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
    const a = read(hex);
    const b = read(toward);
    return `rgb(${a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount)).join(',')})`;
  }

  function readValues() {
    const { snapshot } = Nexo.state;
    if (!snapshot) return;
    const sample = Nexo.store.live().slice(-1)[0] || {};
    const hot = Nexo.store.hottest(sample);
    const values = {
      cpu: snapshot.cpuUsage, mem: snapshot.memoryPercent, disk: snapshot.primaryDrive?.usedPercent,
      gpu: Number.isFinite(sample.gpu) ? sample.gpu : null, temp: Number.isFinite(hot) ? clamp(((hot - 30) / 70) * 100, 0, 100) : null
    };
    const labels = {
      cpu: `${Math.round(snapshot.cpuUsage)}%`, mem: `${Math.round(snapshot.memoryPercent)}%`,
      disk: Number.isFinite(values.disk) ? `${Math.round(values.disk)}%` : '--', gpu: values.gpu === null ? 'sem sensor' : `${Math.round(values.gpu)}%`,
      temp: Number.isFinite(hot) ? `${Math.round(hot)} °C` : 'sem sensor'
    };
    for (const planet of PLANETS) {
      planet.value = values[planet.key];
      planet.label = labels[planet.key];
      const row = legend?.querySelector(`[data-key="${planet.key}"] b`);
      if (row) row.textContent = labels[planet.key];
    }
  }

  /* Cor de destaque lida uma vez por mudança de tom ou de cor (ler o estilo a cada quadro forçava recálculo). */
  let toneCache = null;
  const accent = () => {
    toneCache ||= getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#5ad7ff';
    return toneCache;
  };
  new MutationObserver(() => { toneCache = null; }).observe(document.body, { attributes: true, attributeFilter: ['data-tone', 'style', 'class'] });
  const ring = document.querySelector('.ring-orbit');

  function draw(time, delta) {
    context.clearRect(0, 0, width, height);
    const palette = Nexo.charts.palette();
    const cx = width / 2;
    const cy = height / 2;
    const rx = width / 2 - 34;
    const ry = height / 2 - 18;
    const tone = accent();

    context.lineWidth = 1;
    context.strokeStyle = 'rgba(150, 190, 255, 0.24)';
    context.setLineDash([3, 7]);
    for (const planet of PLANETS) { context.beginPath(); context.ellipse(cx, cy, rx * planet.orbit, ry * planet.orbit, 0, 0, Math.PI * 2); context.stroke(); }
    context.setLineDash([]);

    const placed = PLANETS.map((planet) => {
      const load = Number.isFinite(planet.value) ? planet.value : 0;
      planet.shown += (load - planet.shown) * 0.08;
      const speed = planet.slow ? planet.speed : planet.speed * (0.3 + (planet.shown / 100) * 1.5);
      planet.angle += speed * (delta / 1000);
      const x = cx + Math.cos(planet.angle) * rx * planet.orbit;
      const y = cy + Math.sin(planet.angle) * ry * planet.orbit;
      const depth = 0.8 + 0.3 * ((Math.sin(planet.angle) + 1) / 2);
      planet.trail.push([x, y]);
      if (planet.trail.length > 26) planet.trail.shift();
      return { planet, x, y, depth, front: Math.sin(planet.angle) >= 0 };
    });

    const paint = ({ planet, x, y, depth, front }) => {
      const dim = planet.value === null ? 0.35 : 1;
      const base = palette[planet.color] || '#5ad7ff';
      const heat = planet.hot ? planet.shown / 100 : clamp((planet.shown - 80) / 20, 0, 1) * 0.8;
      const color = blend(base.length === 7 ? base : '#5ad7ff', '#ff7a95', heat);
      const radius = (7.5 + (planet.shown / 100) * 11) * depth;
      context.save();
      context.globalAlpha = dim * (front ? 1 : 0.65);
      for (let i = 1; i < planet.trail.length; i += 1) {
        context.strokeStyle = color; context.globalAlpha = dim * (i / planet.trail.length) * 0.35 * (front ? 1 : 0.6);
        context.lineWidth = Math.max(1, radius * 0.5 * (i / planet.trail.length));
        context.lineCap = 'round'; context.beginPath(); context.moveTo(planet.trail[i - 1][0], planet.trail[i - 1][1]); context.lineTo(planet.trail[i][0], planet.trail[i][1]); context.stroke();
      }
      context.globalAlpha = dim * (front ? 1 : 0.65);
      const glow = context.createRadialGradient(x, y, 0, x, y, radius * 3.4);
      glow.addColorStop(0, color); glow.addColorStop(0.25, color); glow.addColorStop(1, 'rgba(0,0,0,0)');
      context.globalAlpha = dim * 0.28; context.fillStyle = glow; context.beginPath(); context.arc(x, y, radius * 3.4, 0, Math.PI * 2); context.fill();
      context.globalAlpha = dim * (front ? 1 : 0.7);
      const body = context.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius);
      body.addColorStop(0, '#ffffff'); body.addColorStop(0.35, color); body.addColorStop(1, color);
      context.fillStyle = body; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      if (front && planet.label) {
        context.globalAlpha = dim * 0.95; context.font = '600 11.5px "Segoe UI", system-ui, sans-serif'; context.fillStyle = '#e4eaff'; context.textBaseline = 'middle';
        context.shadowColor = 'rgba(2,4,16,0.9)'; context.shadowBlur = 6;
        context.fillText(`${planet.name} ${planet.label}`, x + radius + 8, y - radius - 2);
      }
      context.restore();
    };

    placed.filter((item) => !item.front).forEach(paint);
    const pulse = 1 + Math.sin(time / 900) * 0.06;
    const halo = context.createRadialGradient(cx, cy, 0, cx, cy, 96 * pulse);
    halo.addColorStop(0, tone); halo.addColorStop(0.22, `${tone.length === 7 ? tone : '#5ad7ff'}66`); halo.addColorStop(1, 'rgba(0,0,0,0)');
    context.globalAlpha = 0.55; context.fillStyle = halo; context.beginPath(); context.arc(cx, cy, 96 * pulse, 0, Math.PI * 2); context.fill(); context.globalAlpha = 1;
    context.save(); context.translate(cx, cy); context.rotate(time / 9000); context.fillStyle = '#ffffff'; context.shadowColor = tone; context.shadowBlur = 18;
    const spike = 21 * pulse;
    context.beginPath(); [[0, -spike], [spike * 0.2, -spike * 0.2], [spike, 0], [spike * 0.2, spike * 0.2], [0, spike], [-spike * 0.2, spike * 0.2], [-spike, 0], [-spike * 0.2, -spike * 0.2]].forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y))); context.closePath(); context.fill(); context.restore();
    placed.filter((item) => item.front).forEach(paint);
  }

  let running = false;
  // Janela sem foco (outro app na frente, um jogo no outro monitor) também para o mapa: antes ele seguia girando.
  const visible = () => Nexo.state.view === 'home' && !document.hidden && !Nexo.isIdle?.();
  const quiet = () => Nexo.effectsLite || matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* Anda no relógio único (fx.js), no mesmo quadro do céu: 30 por segundo no máximo. O anel da nota gira junto. */
  function frame(now, elapsed) {
    if (!visible() || quiet()) { running = false; return false; }
    draw(now, Math.min(elapsed, 100));
    if (ring) ring.style.transform = `rotate(${((now / 120000) * 360 % 360).toFixed(2)}deg)`;
    return true;
  }
  function start() {
    resize();
    if (quiet()) { draw(performance.now(), 0); return; }
    if (!running && visible()) { running = true; Nexo.clock.add(frame); }
  }

  Nexo.on('snapshot', () => { readValues(); if (!running && visible()) start(); });
  Nexo.on('view', (view) => { if (view === 'home') start(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  Nexo.on('idle', (idle) => { if (!idle) start(); });
  Nexo.on('effects', () => { if (Nexo.state.view === 'home') start(); });
  addEventListener('resize', () => { if (visible()) start(); });
})();
