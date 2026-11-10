/* Atlas de opções: catálogo amplo e honesto, com o que já foi conferido neste PC. */
(function () {
  const bridge = desktopBridge;
  const state = { status: 'all', query: '', findings: {}, checked: false };
  const STATE_LABEL = { ok: 'ok neste PC', atencao: 'vale olhar', info: 'neste PC', desconhecido: 'não foi possível conferir' };

  function renderStats() {
    const counts = NexoAtlas.counts(Nexo.platform);
    const order = ['laboratorio', 'acao', 'guia', 'mito', 'bloqueado'];
    document.getElementById('atlas-stats').innerHTML = order.map((status) => `<div class="atlas-stat" data-status="${status}"><strong>${counts[status] || 0}</strong><span>${NexoAtlas.STATUS[status]}</span></div>`).join('');
    document.getElementById('atlas-status').innerHTML = [['all', 'Tudo'], ...order.map((status) => [status, NexoAtlas.STATUS[status]]), ['atencao', 'Vale olhar aqui']].map(([id, label]) => `<button type="button" data-atlas="${id}" aria-pressed="${state.status === id}">${escapeHtml(label)}</button>`).join('');
  }

  /** Desenha os cartões do Atlas de opções conforme o filtro e a busca. */
  function renderGrid() {
    const query = state.query.toLocaleLowerCase('pt-BR');
    const items = NexoAtlas.forPlatform(Nexo.platform).filter((item) => {
      if (state.status === 'atencao') { if (state.findings[item.fact]?.state !== 'atencao') return false; }
      else if (state.status !== 'all' && item.status !== state.status) return false;
      return !query || `${item.titulo} ${item.resumo} ${item.porque}`.toLocaleLowerCase('pt-BR').includes(query);
    });
    document.getElementById('atlas-grid').innerHTML = items.length ? items.map((item) => {
      const finding = item.fact ? state.findings[item.fact] : null;
      const action = item.page && Nexo.platform === 'linux' && !item.goto ? '' : item.goto ? `<button class="btn sm" type="button" data-goto-view="${item.goto}">${item.status === 'laboratorio' ? 'Testar no laboratório' : 'Abrir'}</button>` : item.page ? `<button class="btn sm ghost" type="button" data-settings="${item.page}">Abrir no Windows</button>` : '';
      let findingHtml = '';
      if (finding) findingHtml = `<div class="atlas-finding" data-state="${finding.state}"><b>${STATE_LABEL[finding.state]}</b><span>${escapeHtml(finding.text)}</span></div>`;
      else if (item.fact && !state.checked) findingHtml = '<div class="atlas-finding" data-state="pending"><b>ainda não conferido</b><span>Use “Conferir este PC”.</span></div>';
      const actionRow = action ? `<div class="btn-row">${action}</div>` : '';
      return `<article class="atlas-card" data-status="${item.status}">
        <header><span class="atlas-tag">${escapeHtml(NexoAtlas.STATUS[item.status])}</span><span class="chip">${escapeHtml(NexoAtlas.AREA[item.area])}</span><span class="chip">${escapeHtml(NexoAtlas.FAME[item.fama])}</span></header>
        <h3>${escapeHtml(item.titulo)}</h3><p>${escapeHtml(item.resumo)}</p><p class="muted">${escapeHtml(item.porque)}</p>
        ${findingHtml}
        ${actionRow}</article>`;
    }).join('') : '<p class="empty">Nada com esse filtro.</p>';
  }

  async function check() {
    if (!bridge?.getSystemFacts) return;
    const button = document.getElementById('atlas-refresh');
    setButtonBusy(button, true, 'Conferindo…');
    try { state.findings = NexoAtlas.evaluateFacts(await bridge.getSystemFacts()); state.checked = true; }
    catch (error) { showToast(error.message || 'Não foi possível ler o sistema.'); }
    finally { setButtonBusy(button, false); renderStats(); renderGrid(); }
  }

  document.getElementById('atlas-status').addEventListener('click', (event) => { const chip = event.target.closest('[data-atlas]'); if (!chip) { return; } state.status = chip.dataset.atlas; renderStats(); renderGrid(); });
  document.getElementById('atlas-search').addEventListener('input', (event) => { state.query = event.target.value.trim(); renderGrid(); });
  document.getElementById('atlas-refresh').addEventListener('click', check);
  document.getElementById('atlas-grid').addEventListener('click', (event) => {
    const go = event.target.closest('[data-goto-view]'); if (go) Nexo.go(go.dataset.gotoView);
    const page = event.target.closest('[data-settings]'); if (page) bridge?.openWindowsSettings?.(page.dataset.settings).catch((error) => showToast(error.message));
  });
  Nexo.on('view', (view) => { if (view === 'atlas' && !state.checked) check(); });
  Nexo.commands.push({ label: 'Abrir o Atlas de opções', hint: 'Atlas', run: () => Nexo.go('atlas') });
  renderStats();
  renderGrid();
})();
