/* Início: índice Nexo, medições ao vivo, gráficos e observações. */
(function () {
  let range = '5m';
  let countedScore = 0;
  let countTimer = 0;
  let lastHealth = null;

  const colors = () => Nexo.charts.palette();
  const pct = (value) => (Number.isFinite(value) ? `${Math.round(value)}%` : '--');
  const deg = (value) => (Number.isFinite(value) ? `${Math.round(value)} °C` : '--');

  function animateScore(target) {
    clearInterval(countTimer);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || Math.abs(target - countedScore) < 2) { countedScore = target; setText('health-score', String(target)); return; }
    const step = target > countedScore ? 1 : -1;
    countTimer = setInterval(() => {
      countedScore += step;
      setText('health-score', String(countedScore));
      if (countedScore === target) clearInterval(countTimer);
    }, 14);
  }

  /** Atualiza o índice, o veredito e os fatores. */
  function renderHealth() {
    const snapshot = Nexo.state.snapshot;
    if (!snapshot) return;
    const history = Nexo.store.brainHistory();
    const sample = Nexo.store.live().slice(-1)[0];
    const forecast = NexoBrain.forecastDisk(history);
    const health = NexoBrain.healthScore({
      brain: Nexo.store.brain, history, forecast, cpu: snapshot.cpuUsage, mem: snapshot.memoryPercent,
      disk: snapshot.primaryDrive?.usedPercent, temp: sample ? Nexo.store.hottest(sample) : null, uptimeSeconds: snapshot.uptimeSeconds
    });
    lastHealth = health;
    Nexo.state.health = health;
    const tone = health.score >= 75 ? 'good' : health.score >= 55 ? 'warn' : 'bad';
    const box = document.getElementById('health');
    box.dataset.tone = tone;
    document.getElementById('ring-head').style.transform = `rotate(${(health.score * 3.6).toFixed(1)}deg)`;
    document.getElementById('ring-arc').setAttribute('stroke-dasharray', `${health.score} 100`);
    animateScore(health.score);
    setText('health-verdict', health.verdict);
    const worst = health.factors.find((factor) => factor.points > 0);
    setText('health-sub', worst ? `O que mais pesa agora: ${worst.label.toLocaleLowerCase('pt-BR')}. ${worst.detail}.` : 'Nenhum ponto de atenção nas medições, no histórico de hoje nem na previsão de disco.');
    document.getElementById('health-factors').innerHTML = health.factors.slice(0, 4).map((factor) =>
      `<li data-status="${factor.status}" title="${escapeHtml(factor.detail)}"><strong>${escapeHtml(factor.label)}</strong><span class="tag">${factor.status === 'ok' ? 'Em ordem' : factor.status === 'warn' ? 'Atenção' : 'Crítico'}</span><em>${escapeHtml(factor.detail)}</em></li>`).join('');
  }

  function renderLive() {
    const snapshot = Nexo.state.snapshot;
    if (!snapshot) return;
    const sample = Nexo.store.live().slice(-1)[0] || {};
    setText('cpu-usage-value', pct(snapshot.cpuUsage));
    setText('cpu-usage-state', `${snapshot.logicalCpuCount || '--'} threads · ${snapshot.cpuUsage >= 85 ? 'carga alta' : snapshot.cpuUsage >= 60 ? 'carga moderada' : 'folgado'}`);
    setText('memory-usage-value', pct(snapshot.memoryPercent));
    setText('memory-usage-state', `${formatBytes(snapshot.memoryUsedBytes)} de ${formatBytes(snapshot.memoryTotalBytes)}`);
    const drive = snapshot.primaryDrive;
    setText('disk-usage-value', pct(drive?.usedPercent));
    setText('disk-usage-state', drive ? `${drive.driveLetter}: · ${formatBytes(drive.freeBytes)} livres` : 'Sem unidade detectada');
    setText('gpu-usage-value', Number.isFinite(sample.gpu) ? pct(sample.gpu) : '--');
    setText('gpu-usage-state', Number.isFinite(sample.gpu) ? (Number.isFinite(sample.gpuTemperature) ? `${deg(sample.gpuTemperature)} · em uso` : 'em uso') : 'Sensor não detectado');
    const hot = Nexo.store.hottest(sample);
    setText('system-temperature-value', Number.isFinite(hot) ? deg(hot) : '--');
    setText('system-temperature-state', Number.isFinite(hot) ? (hot >= 85 ? 'Acima do ideal' : 'Dentro do esperado') : 'Sem sensor compatível');
    setText('uptime-value', formatUptime(snapshot.uptimeSeconds));
    setText('uptime-detail', `Desde ${new Date(Date.now() - snapshot.uptimeSeconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`);
    setText('rail-host', snapshot.hostname || 'Device Care');
    $$('.metric').forEach((metric, index) => metric.classList.toggle('is-elevated', (index === 0 && snapshot.cpuUsage >= 85) || (index === 1 && snapshot.memoryPercent >= 85) || (index === 2 && drive?.usedPercent >= 90)));
    const live = Nexo.store.recent();
    const sparkMap = { cpu: ['cpu', colors().cpu], memory: ['memory', colors().mem], disk: ['disk', colors().disk], gpu: ['gpu', colors().gpu], temp: [null, colors().acpi] };
    $$('.spark').forEach((canvas) => {
      const [key, color] = sparkMap[canvas.dataset.spark] || [];
      Nexo.charts.spark(canvas, live.map((sample) => (key ? sample[key] : Nexo.store.hottest(sample))), color);
    });
  }

  function drawCharts() {
    const { from, to, samples } = Nexo.store.range(range);
    const c = colors();
    const series = (key) => samples.map((sample) => [sample.timestamp, sample[key]]);
    const tip = (id) => document.getElementById(id)?.parentElement.querySelector('.chart-tip') || (() => {
      const box = document.createElement('div'); box.className = 'chart-tip'; box.hidden = true;
      document.getElementById(id).parentElement.append(box); return box;
    })();
    const draw = (id, options) => { const canvas = document.getElementById(id); if (canvas) Nexo.charts.render(canvas, { from, to, ...options }, tip(id)); };
    draw('chart-cpu', { series: [{ label: 'Processador', color: c.cpu, data: series('cpu') }], yMin: 0, yMax: 100, unit: '%' });
    draw('chart-memory', { series: [{ label: 'Memória', color: c.mem, data: series('memory') }], yMin: 0, yMax: 100, unit: '%' });
    draw('chart-gpu', { series: [{ label: 'Vídeo', color: c.gpu, data: series('gpu') }], yMin: 0, yMax: 100, unit: '%' });
    draw('chart-disk', { series: [{ label: 'Disco', color: c.disk, data: series('disk') }], yMin: 0, yMax: 100, unit: '%' });
    draw('chart-temperature', { unit: '°C', series: [
      { label: 'Processador', color: c.cpu, data: series('cpuSensorTemperature') },
      { label: 'Vídeo', color: c.gpu, data: series('gpuTemperature') },
      { label: 'ACPI', color: c.acpi, data: series('acpiTemperature') }
    ].filter((serie) => serie.data.some((point) => Number.isFinite(point[1]))) });

    const stats = (key) => {
      const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
      return values.length ? { last: values[values.length - 1], avg: values.reduce((a, v) => a + v, 0) / values.length, max: Math.max(...values) } : null;
    };
    const summary = (id, valueId, key, formatter, emptyText) => {
      const s = stats(key);
      setText(valueId, s ? formatter(s.last) : '--');
      setText(id, s ? `média ${formatter(s.avg)} · pico ${formatter(s.max)}` : emptyText);
    };
    summary('chart-cpu-summary', 'chart-cpu-value', 'cpu', pct, 'Aguardando amostras');
    summary('chart-memory-summary', 'chart-memory-value', 'memory', pct, 'Aguardando amostras');
    summary('chart-gpu-summary', 'chart-gpu-value', 'gpu', pct, 'Sensor indisponível');
    summary('chart-disk-summary', 'chart-disk-value', 'disk', pct, 'Aguardando amostras');
    const temps = samples.map((sample) => Nexo.store.hottest(sample)).filter(Number.isFinite);
    setText('chart-temperature-value', temps.length ? deg(temps[temps.length - 1]) : '--');
    setText('chart-temperature-summary', temps.length ? `média ${deg(temps.reduce((a, v) => a + v, 0) / temps.length)} · pico ${deg(Math.max(...temps))}` : 'Sem sensor de temperatura compatível');
    const drive = Nexo.state.snapshot?.primaryDrive;
    setText('chart-disk-name', drive ? `Disco ${drive.driveLetter}:` : 'Disco');
    const label = { '5m': '5 min', '30m': '30 min', '24h': '24 h', '7d': '7 dias' }[range];
    $$('[data-history-window]').forEach((element) => { element.textContent = label; });
  }

  /** Cartões de insight, usados na Início e na Análise. */
  Nexo.renderInsights = function renderInsights(container, insights, { limit = 99, withFeedback = false } = {}) {
    if (!insights.length) {
      container.innerHTML = `<div class="all-good"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><div><strong>Nada preocupante por enquanto.</strong><div class="muted">As medições, o histórico e a previsão de disco estão dentro do que o Nexo considera normal.</div></div></div>`;
      return;
    }
    container.innerHTML = insights.slice(0, limit).map((insight) => `<article class="insight" data-severity="${insight.severity}">
      <div class="insight-head"><strong>${escapeHtml(insight.title)}</strong><span>confiança ${insight.confidence}%${insight.votes >= 3 ? ` · ajustada por ${insight.votes} avaliações` : ''}</span></div>
      <p>${escapeHtml(insight.summary)}</p>
      <ul>${insight.evidence.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      ${(insight.actions.length || withFeedback) ? `<div class="insight-actions">${insight.actions.map((action) => `<button class="btn sm" type="button" data-insight-action="${action.type}">${escapeHtml(action.label)}</button>`).join('')}${withFeedback ? `<span class="ask">Isso ajudou?</span><button class="btn sm ghost" type="button" data-feedback="${insight.category}" data-helpful="1">Sim</button><button class="btn sm ghost" type="button" data-feedback="${insight.category}" data-helpful="0">Não</button>` : ''}</div>` : ''}
    </article>`).join('');
  };

  Nexo.currentInsights = function currentInsights() {
    return NexoBrain.buildInsights({
      brain: Nexo.store.brain, snapshot: Nexo.state.snapshot, processes: Nexo.state.processes, cleanup: Nexo.state.cleanupTotals,
      power: Nexo.state.power, history: Nexo.store.brainHistory(), feedback: Nexo.store.feedback(),
      sensors: Nexo.store.deepMetrics(), temp: Nexo.state.snapshot ? Nexo.store.hottest(Nexo.store.live().slice(-1)[0] || {}) : null
    });
  };

  function renderHomeInsights() {
    if (!Nexo.state.snapshot) return;
    Nexo.renderInsights(document.getElementById('home-insights'), Nexo.currentInsights(), { limit: 3 });
  }

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-insight-action]');
    if (action) {
      if (action.dataset.insightAction === 'task-manager') desktopBridge?.openTaskManager?.();
      if (action.dataset.insightAction === 'goto-optimize') Nexo.go('optimize');
    }
    const feedback = event.target.closest('[data-feedback]');
    if (feedback) Nexo.store.addFeedback(feedback.dataset.feedback, feedback.dataset.helpful === '1');
  });

  $$('[data-history-range]').forEach((button) => button.addEventListener('click', () => {
    range = button.dataset.historyRange;
    $$('[data-history-range]').forEach((option) => option.setAttribute('aria-pressed', String(option === button)));
    drawCharts();
  }));
  $('#hero-analyze')?.addEventListener('click', () => { Nexo.go('analysis'); Nexo.runAnalysis?.(); });
  $('#hero-clean')?.addEventListener('click', () => Nexo.go('optimize'));
  $('#why-score')?.addEventListener('click', () => Nexo.confirm({
    title: 'Como o índice Nexo é calculado',
    body: 'Começa em 100 e perde pontos por sinais reais do seu PC. É um indicador heurístico: ajuda a enxergar tendências, mas não garante nem mede ganho de desempenho.',
    items: ['Processador e memória: média dos últimos 30 minutos.', 'Armazenamento: espaço ocupado e, se houver histórico, a previsão de quando enche.', 'Temperatura, quedas de clock por calor e lentidões das últimas 24 h.', 'Tempo ligado sem reiniciar (a partir de 14 dias).'],
    confirmLabel: 'Entendi', cancelLabel: 'Fechar'
  }));

  Nexo.on('snapshot', () => {
    renderLive();
    if (Nexo.state.view === 'home') drawCharts();
  });
  Nexo.on('samples', () => { renderHealth(); renderHomeInsights(); });
  Nexo.on('learned', () => { renderHealth(); renderHomeInsights(); });
  Nexo.on('processes', renderHomeInsights);
  Nexo.on('view', (view) => { if (view === 'home') { drawCharts(); renderLive(); } });
  Nexo.refreshHome = () => { renderHealth(); renderLive(); drawCharts(); renderHomeInsights(); };
  addEventListener('resize', () => { if (Nexo.state.view === 'home') { drawCharts(); renderLive(); } });
})();
