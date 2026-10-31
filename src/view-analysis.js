/* Análise: o que o Nexo encontrou, lentidões, culpados e a rotina semanal. */
(function () {
  const KIND_LABEL = { cpu: 'Processador sobrecarregado', memory: 'Memória no limite', thermal: 'Temperatura alta', throttle: 'Queda de clock por calor' };
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  let habitMetric = 'cpu';

  function renderProcesses(result) {
    const list = document.getElementById('process-insights-list');
    if (!list || !result) return;
    const byId = new Map();
    for (const process of [...(result.byCpu || []), ...(result.byMemory || [])]) {
      const id = Number(process.processId) || 0;
      if (!id) continue;
      const existing = byId.get(id) || { processId: id, name: String(process.name || 'Processo'), cpuPercent: 0, memoryBytes: 0, memoryPercent: 0 };
      existing.cpuPercent = Math.max(existing.cpuPercent, Number(process.cpuPercent) || 0);
      existing.memoryBytes = Math.max(existing.memoryBytes, Number(process.memoryBytes) || 0);
      existing.memoryPercent = Math.max(existing.memoryPercent, Number(process.memoryPercent) || 0);
      byId.set(id, existing);
    }
    const rows = [...byId.values()].sort((a, b) => Math.max(b.cpuPercent, b.memoryPercent) - Math.max(a.cpuPercent, a.memoryPercent)).slice(0, 6);
    list.innerHTML = rows.length ? rows.map((p) => `<div class="process-row">
      <div class="process-identity"><strong>${escapeHtml(p.name)}</strong><small>PID ${p.processId}</small></div>
      <div class="process-metric"><span>CPU ${Math.round(p.cpuPercent)}%</span><span class="process-track"><i style="width:${Math.min(100, p.cpuPercent)}%"></i></span></div>
      <div class="process-metric"><span>RAM ${formatBytes(p.memoryBytes)}</span><span class="process-track memory-track"><i style="width:${Math.min(100, p.memoryPercent)}%"></i></span></div></div>`).join('')
      : '<p class="empty">Nenhum programa em destaque nesta amostra.</p>';
  }

  function renderLearning() {
    const info = Nexo.store.brain.learning();
    setText('learn-days', String(info.days));
    setText('learn-coverage', `${info.coverage}%`);
    setText('learn-episodes', String(info.episodes));
    setText('learn-culprits', String(info.culprits));
    setText('diagnosis-learning-status', `${Nexo.store.history().length.toLocaleString('pt-BR')} amostras locais e ${Nexo.store.feedback().length} avaliações. Os dados não saem deste computador.`);
  }

  function renderEpisodes() {
    const episodes = Nexo.store.brain.recentEpisodes(14 * 24 * 3600e3).slice(0, 8);
    document.getElementById('episode-list').innerHTML = episodes.length ? episodes.map((e) => `<li data-kind="${e.kind}"><i class="dot"></i><div><strong>${KIND_LABEL[e.kind] || e.kind}${e.ongoing ? ' · em andamento' : ''}</strong><small>${e.peak != null ? `${e.kind === 'throttle' ? 'mínimo' : 'pico'} ${Math.round(e.peak)}${e.kind === 'thermal' ? ' °C' : '%'} · ` : ''}${e.minutes} min${e.culprit ? ` · ${escapeHtml(e.culprit)}` : ''}</small></div><time>${formatRelative(e.start)}</time></li>`).join('')
      : '<li class="muted">Nenhuma lentidão sustentada registrada. Quando houver, ela aparece aqui com o programa que mais pesou.</li>';
  }

  function renderLedger() {
    const ledger = Nexo.store.brain.ledger().slice(0, 6);
    const top = ledger[0]?.minutes || 1;
    document.getElementById('ledger-list').innerHTML = ledger.length ? ledger.map((e) => `<li><div class="row"><strong>${escapeHtml(e.name)}</strong><span>${e.events} episódio${e.events > 1 ? 's' : ''} · ${e.minutes} min</span></div><div class="bar"><i style="width:${Math.max(6, (e.minutes / top) * 100)}%"></i></div></li>`).join('')
      : '<li class="muted">Ainda não identifiquei programas recorrentes. Isso depende de acontecerem lentidões enquanto o Nexo observa.</li>';
  }

  function renderHabit() {
    const { grid, max } = Nexo.store.brain.habitGrid(habitMetric);
    const rgb = habitMetric === 'cpu' ? '90, 215, 255' : '160, 140, 255';
    const now = new Date();
    let html = '<span></span>' + Array.from({ length: 24 }, (_, hour) => `<span class="h-hour">${hour % 3 === 0 ? hour : ''}</span>`).join('');
    for (const day of DAY_ORDER) {
      html += `<span class="h-label">${DAY_SHORT[day]}</span>`;
      for (let hour = 0; hour < 24; hour += 1) {
        const value = grid[day][hour];
        const isNow = day === now.getDay() && hour === now.getHours();
        const alpha = value === null ? 0.05 : 0.14 + Math.min(1, value / Math.max(40, max)) * 0.78;
        html += `<span class="cell${isNow ? ' now' : ''}" style="background:rgba(${rgb},${alpha.toFixed(2)})" title="${DAY_SHORT[day]} ${String(hour).padStart(2, '0')}h — ${value === null ? 'sem dados ainda' : `média ${Math.round(value)}%`}"></span>`;
      }
    }
    document.getElementById('habit-grid').innerHTML = html;
    const info = Nexo.store.brain.learning();
    setText('habit-caption', info.coverage < 5
      ? 'O mapa se completa conforme o Nexo observa o uso do computador. A cada minuto ele aprende um pouco mais sobre a sua rotina.'
      : `Cada quadrado é o uso médio nessa hora da semana (${info.coverage}% da semana já conhecida). O contorno marca o momento atual. Lentidões não entram na média, para não virarem “normal”.`);
  }

  function renderInsights() {
    if (!Nexo.state.snapshot) return;
    Nexo.renderInsights(document.getElementById('insight-list'), Nexo.currentInsights(), { withFeedback: true });
  }

  function renderAll() { renderLearning(); renderInsights(); renderEpisodes(); renderLedger(); renderHabit(); }

  async function measureProcesses(button) {
    if (!desktopBridge?.getTopProcesses) { showToast('A leitura de processos está disponível no aplicativo desktop.'); return null; }
    setButtonBusy(button, true, 'Medindo…');
    try {
      const result = await desktopBridge.getTopProcesses();
      Nexo.state.processes = result;
      renderProcesses(result);
      return result;
    } catch (error) {
      showToast(error.message || 'Não foi possível ler os processos.');
      return null;
    } finally { setButtonBusy(button, false); }
  }

  Nexo.runAnalysis = async function runAnalysis() {
    const button = document.getElementById('run-diagnosis');
    setAppStatus('Analisando');
    await measureProcesses(button);
    renderAll();
    const count = Nexo.currentInsights().length;
    setAppStatus('Monitoramento ativo');
    recordActivity('Análise inteligente', count ? `${count} ${count > 1 ? 'observações' : 'observação'}` : 'nada preocupante');
    showToast(count ? `Análise concluída: ${count} ${count > 1 ? 'observações' : 'observação'}.` : 'Análise concluída: nada preocupante.');
  };

  document.getElementById('run-diagnosis')?.addEventListener('click', () => Nexo.runAnalysis());
  document.getElementById('refresh-processes')?.addEventListener('click', (event) => measureProcesses(event.currentTarget).then(renderInsights));
  $$('[data-habit]').forEach((button) => button.addEventListener('click', () => {
    habitMetric = button.dataset.habit;
    $$('[data-habit]').forEach((option) => option.setAttribute('aria-pressed', String(option === button)));
    renderHabit();
  }));
  Nexo.on('view', (view) => { if (view === 'analysis') renderAll(); });
  Nexo.on('learned', () => { if (Nexo.state.view === 'analysis') renderAll(); });
  Nexo.on('processes', (result) => { renderProcesses(result); if (Nexo.state.view === 'analysis') renderInsights(); });
})();
