/* Otimizar: limpeza segura por categorias, plano de energia e programas de inicialização. */
(function () {
  const AUTO_THRESHOLD = 90;
  const AUTO_SAMPLES = 4;
  const AUTO_MIN_PERSISTENCE_MS = 60 * 1000;
  const AUTO_COOLDOWN_MS = 60 * 60 * 1000;
  let categories = [];
  let busy = false;
  let autoEnabled = localStorage.getItem(Nexo.keys.autoClean) === 'true';
  let highSamples = 0;
  let highSince = 0;

  const list = () => document.getElementById('cleanup-list');
  const runButton = () => document.getElementById('run-cleanup');
  const selectedIds = () => $$('input[type="checkbox"]:checked', list()).map((input) => input.closest('li').dataset.id);

  function updateTotals() {
    const chosen = categories.filter((category) => selectedIds().includes(category.id));
    const bytes = chosen.reduce((total, category) => total + (category.bytes || 0), 0);
    const files = chosen.reduce((total, category) => total + (category.fileCount || 0), 0);
    setText('cleanup-total', formatBytes(bytes));
    setText('cleanup-total-detail', chosen.length ? `${files.toLocaleString('pt-BR')} itens em ${chosen.length} categoria${chosen.length > 1 ? 's' : ''}` : 'nada selecionado');
    runButton().disabled = busy || !chosen.some((category) => category.fileCount > 0);
  }

  function renderCleanup() {
    list().innerHTML = categories.map((category) => {
      const empty = !category.fileCount;
      const checked = !empty && !category.destructive;
      return `<li data-id="${category.id}"><label class="check"><input type="checkbox" ${checked ? 'checked' : ''} ${empty ? 'disabled' : ''} aria-label="${escapeHtml(category.label)}"><i></i></label>
        <div><strong>${escapeHtml(category.label)}${category.destructive ? '<span class="warn-tag">não pode ser desfeito</span>' : ''}</strong><small>${escapeHtml(category.description)}</small></div>
        <div class="size">${empty ? '—' : formatBytes(category.bytes)}<small>${empty ? 'nada para limpar' : `${category.fileCount.toLocaleString('pt-BR')} itens`}</small></div></li>`;
    }).join('');
    $$('input', list()).forEach((input) => input.addEventListener('change', updateTotals));
    Nexo.state.cleanupTotals = categories.filter((category) => !category.destructive).reduce((total, category) => ({ bytes: total.bytes + (category.bytes || 0), fileCount: total.fileCount + (category.fileCount || 0) }), { bytes: 0, fileCount: 0 });
    updateTotals();
  }

  async function scan() {
    if (!desktopBridge?.scanCleanup) { list().innerHTML = '<li class="empty">A limpeza está disponível no aplicativo desktop.</li>'; return; }
    const button = document.getElementById('cleanup-rescan');
    setButtonBusy(button, true, 'Calculando…');
    try {
      const result = await desktopBridge.scanCleanup();
      categories = result.categories || [];
      renderCleanup();
    } catch (error) {
      list().innerHTML = `<li class="empty">${escapeHtml(error.message || 'Não foi possível calcular a limpeza.')}</li>`;
    } finally { setButtonBusy(button, false); }
  }

  async function runCleanup() {
    const ids = selectedIds();
    const chosen = categories.filter((category) => ids.includes(category.id) && category.fileCount > 0);
    if (!chosen.length || busy) return;
    const confirmed = await Nexo.confirm({
      title: 'Limpar os itens selecionados?',
      body: 'Estes itens serão removidos agora. Eles são arquivos antigos que o Windows e os programas recriam sozinhos.',
      items: chosen.map((category) => `${category.label}: ${formatBytes(category.bytes)} (${category.fileCount.toLocaleString('pt-BR')} itens)${category.destructive ? ' — definitivo' : ''}`),
      confirmLabel: 'Limpar agora'
    });
    if (!confirmed) return;
    busy = true;
    setButtonBusy(runButton(), true, 'Limpando…');
    setAppStatus('Limpando arquivos antigos');
    try {
      const result = await desktopBridge.runCleanup(chosen.map((category) => category.id));
      const message = result.removedCount ? `${result.removedCount.toLocaleString('pt-BR')} itens removidos; ${formatBytes(result.bytesFreed)} liberados.` : 'Nada precisou ser removido.';
      showToast(message);
      recordActivity('Limpeza segura', `${result.removedCount} itens · ${formatBytes(result.bytesFreed)}`);
      markCleanupRun();
    } catch (error) {
      showToast(error.message || 'A limpeza não pôde ser concluída.');
    } finally {
      busy = false;
      setButtonBusy(runButton(), false);
      setAppStatus('Monitoramento ativo');
      await scan();
    }
  }

  /* ---------- Limpeza automática (somente temporários antigos) ---------- */
  function markCleanupRun() {
    highSamples = 0; highSince = 0;
    try { localStorage.setItem(Nexo.keys.autoCleanLastRun, String(Date.now())); } catch { /* ignorado */ }
  }

  async function maybeAutoClean(snapshot) {
    if (!autoEnabled || busy || !desktopBridge?.getCleanupPreview) return;
    if (!snapshot.primaryDrive || snapshot.primaryDrive.usedPercent < AUTO_THRESHOLD) { highSamples = 0; highSince = 0; return; }
    if (!highSamples) highSince = Date.now();
    highSamples += 1;
    if (highSamples < AUTO_SAMPLES || Date.now() - highSince < AUTO_MIN_PERSISTENCE_MS) return;
    const lastRun = Number(localStorage.getItem(Nexo.keys.autoCleanLastRun)) || 0;
    if (Date.now() - lastRun < AUTO_COOLDOWN_MS) { highSamples = 0; highSince = 0; return; }
    busy = true;
    highSamples = 0; highSince = 0;
    try {
      const preview = await desktopBridge.getCleanupPreview();
      if (!preview.fileCount) { markCleanupRun(); return; }
      const result = await desktopBridge.cleanupTempFiles();
      markCleanupRun();
      if (result.removedCount > 0) {
        showToast(`Limpeza automática: ${result.removedCount} temporários removidos; ${formatBytes(result.bytesFreed)} liberados.`);
        recordActivity('Limpeza automática', `${result.removedCount} arquivos`);
      }
    } catch (error) {
      showToast(error.message || 'A limpeza automática não pôde ser concluída.');
    } finally { busy = false; }
  }

  const autoToggle = document.getElementById('auto-clean-toggle');
  autoToggle.checked = autoEnabled;
  autoToggle.addEventListener('change', async () => {
    if (autoToggle.checked) {
      const confirmed = await Nexo.confirm({
        title: 'Ativar a limpeza automática?',
        body: 'O app só fará a limpeza após quatro leituras consecutivas com o disco principal acima de 90%.',
        items: ['Remove até 5.000 arquivos regulares diretamente na pasta temporária, com mais de 7 dias.', 'Acontece no máximo uma vez por hora.', 'Não fecha programas nem altera configurações do Windows.'],
        confirmLabel: 'Ativar'
      });
      if (!confirmed) { autoToggle.checked = false; return; }
    }
    autoEnabled = autoToggle.checked;
    highSamples = 0; highSince = 0;
    try { localStorage.setItem(Nexo.keys.autoClean, String(autoEnabled)); } catch { autoEnabled = false; autoToggle.checked = false; showToast('Não foi possível salvar a preferência de automação.'); return; }
    showToast(autoEnabled ? 'Limpeza automática ativada.' : 'Limpeza automática desativada.');
  });

  /* ---------- Plano de energia ---------- */
  const planNote = (name) => /alto|high|máxim|ultimate|ultra/i.test(name) ? 'Máximo de desempenho; consome mais energia.'
    : /equilibr|balanced/i.test(name) ? 'Equilíbrio entre desempenho e consumo.'
      : /econom|saver/i.test(name) ? 'Poupa energia; pode limitar a velocidade do processador.' : 'Plano personalizado.';

  function renderPower() {
    const box = document.getElementById('power-list');
    const plans = Nexo.state.power?.plans || [];
    box.innerHTML = plans.length ? plans.map((plan) => `<button class="power-item" type="button" role="radio" aria-checked="${plan.active}" data-guid="${plan.guid}"><span class="radio"></span><span><strong>${escapeHtml(plan.name)}</strong><small>${planNote(plan.name)}</small></span></button>`).join('')
      : '<p class="empty">O Windows não informou planos de energia neste computador.</p>';
  }

  Nexo.loadPower = async function loadPower() {
    if (!desktopBridge?.listPowerPlans) return;
    try {
      const plans = await desktopBridge.listPowerPlans();
      Nexo.state.power = { plans, active: plans.find((plan) => plan.active) || null };
      renderPower();
    } catch { Nexo.state.power = { plans: [], active: null }; renderPower(); }
  };

  document.getElementById('power-list').addEventListener('click', async (event) => {
    const item = event.target.closest('[data-guid]');
    if (!item || item.getAttribute('aria-checked') === 'true') return;
    const plan = Nexo.state.power.plans.find((candidate) => candidate.guid === item.dataset.guid);
    $$('.power-item').forEach((button) => { button.disabled = true; });
    try {
      const result = await desktopBridge.setPowerPlan(item.dataset.guid);
      Nexo.state.power = { plans: result.plans, active: result.plans.find((candidate) => candidate.active) || null };
      showToast(`Plano de energia: ${plan?.name || 'alterado'}.`);
      recordActivity('Plano de energia', plan?.name || 'alterado');
    } catch (error) { showToast(error.message || 'Não foi possível trocar o plano de energia.'); }
    renderPower();
  });

  /* ---------- Início com o Windows ---------- */
  async function loadStartup() {
    const box = document.getElementById('startup-list');
    if (!desktopBridge?.listStartupItems) { box.innerHTML = '<li class="empty">Disponível no aplicativo desktop.</li>'; return; }
    try {
      const items = await desktopBridge.listStartupItems();
      box.innerHTML = items.length ? items.map((item) => `<li><strong>${escapeHtml(item.name)}</strong><small title="${escapeHtml(item.command)}">${escapeHtml(item.command)}</small></li>`).join('') : '<li class="empty">Nenhum programa registrado para iniciar com o Windows.</li>';
    } catch { box.innerHTML = '<li class="empty">Não foi possível ler a lista agora.</li>'; }
  }

  document.getElementById('cleanup-rescan').addEventListener('click', scan);
  runButton().addEventListener('click', runCleanup);
  document.getElementById('open-startup-settings').addEventListener('click', () => desktopBridge?.openWindowsSettings?.('startup'));
  Nexo.on('snapshot', maybeAutoClean);
  Nexo.on('view', (view) => { if (view === 'optimize') { scan(); Nexo.loadPower(); loadStartup(); } });
  Nexo.scanCleanup = scan;
})();
