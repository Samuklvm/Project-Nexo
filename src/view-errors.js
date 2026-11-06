/* Ajustes > Registro de erros: o que deu errado neste PC, agrupado, para ver, copiar e (quando ligado) mandar ao criador. */
(function () {
  const bridge = desktopBridge;
  const body = () => document.getElementById('errors-body');
  if (!body()) return;
  const SOURCE = { principal: 'processo principal', interface: 'interface', ipc: 'ação do app', servico: 'serviço', processo: 'processo do app' };
  const state = { data: null, warnings: false, open: new Set() };
  const LABEL = { tela: 'tela', acao: 'ação', codigo: 'código', nome: 'nome' };
  /** Contexto guardado como JSON vira "tela: hardware · ação: scan:apply". */
  const pretty = (context) => {
    try {
      const value = JSON.parse(context);
      if (!value || typeof value !== 'object') return String(context);
      return Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '').map(([key, item]) => `${LABEL[key] || key}: ${typeof item === 'object' ? JSON.stringify(item) : item}`).join(' · ');
    } catch { return String(context); }
  };
  const when = (at) => new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function render() {
    const box = body();
    if (!bridge?.listErrors) { box.innerHTML = '<p class="muted">Abra o Nexo para computador para ver o registro.</p>'; return; }
    const groups = (state.data?.groups || []).filter((group) => state.warnings || group.level !== 'aviso');
    const hiddenWarnings = (state.data?.groups || []).filter((group) => group.level === 'aviso').length;
    if (!groups.length) {
      box.innerHTML = `<p class="muted">Nenhum erro registrado${!state.warnings && hiddenWarnings ? ` (${hiddenWarnings} aviso(s) escondido(s))` : ''}. Tudo certo por aqui.</p>`;
      return;
    }
    box.innerHTML = `<ul class="errors-list">${groups.slice(0, 60).map((group) => `
      <li class="${group.level === 'aviso' ? 'is-warning' : ''}">
        <div class="errors-main"><strong>${escapeHtml(group.message)}</strong>
          <span class="muted">${escapeHtml(SOURCE[group.source] || group.source)}${group.context ? ` · ${escapeHtml(pretty(group.context).slice(0, 160))}` : ''}</span>
          <div class="chips-row"><span class="chip ${group.level === 'aviso' ? 'risk-moderado' : 'risk-alto'}">${group.level === 'aviso' ? 'aviso' : 'erro'}</span><span class="chip">${group.count}×</span><span class="chip">última vez ${when(group.lastAt)}</span><span class="chip">versão ${escapeHtml(group.versions.join(', '))}</span></div>
          ${group.stack ? `<details data-signature="${escapeHtml(group.signature)}"${state.open.has(group.signature) ? ' open' : ''}><summary>Detalhes técnicos</summary><pre>${escapeHtml(group.stack.split('\n').slice(0, 12).join('\n'))}</pre></details>` : ''}
        </div></li>`).join('')}</ul>
      <p class="muted">${state.data.total} ocorrência(s) no total. O registro fica em ${escapeHtml(state.data.dir || 'logs')}.</p>`;
  }

  async function refresh() {
    try { state.data = await bridge.listErrors({ limit: 200 }); } catch (error) { state.data = null; body().innerHTML = `<p class="notes-line">Não consegui ler o registro: ${escapeHtml(error.message || 'erro')}</p>`; return; }
    render();
  }

  document.getElementById('errors-refresh')?.addEventListener('click', refresh);
  document.getElementById('errors-warnings')?.addEventListener('change', (event) => { state.warnings = event.target.checked; render(); });
  body().addEventListener('toggle', (event) => {
    const signature = event.target?.dataset?.signature;
    if (!signature) return;
    if (event.target.open) state.open.add(signature); else state.open.delete(signature);
  }, true);
  document.getElementById('errors-copy')?.addEventListener('click', async () => {
    try {
      const text = await bridge.exportErrors();
      await navigator.clipboard.writeText(text);
      showToast('Relatório copiado. Dá para colar num e-mail ou em "Relatar um problema".');
    } catch { showToast('Não consegui copiar o relatório.'); }
  });
  document.getElementById('errors-folder')?.addEventListener('click', () => { bridge.openErrorFolder?.().catch(() => showToast('Não consegui abrir a pasta.')); });
  document.getElementById('errors-clear')?.addEventListener('click', async () => {
    if (!await Nexo.confirm({ title: 'Limpar o registro de erros?', body: 'Apaga tudo o que foi anotado neste computador. Erros novos voltam a ser registrados.', confirmLabel: 'Limpar' })) return;
    await bridge.clearErrors().catch(() => {});
    state.open.clear();
    refresh();
  });
  Nexo.on?.('view', (view) => { if (view === 'settings') refresh(); });
  Nexo.commands?.push({ label: 'Registro de erros', hint: 'Ajustes', run: () => { Nexo.go('settings'); document.getElementById('errors-sheet')?.scrollIntoView({ behavior: 'smooth' }); refresh(); } });
})();
