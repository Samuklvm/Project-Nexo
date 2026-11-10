/* Diário de alterações (página Atividade), detalhes de cada operação (catálogo) e reversão. */
(function () {
  const STATUS = { applied: 'Aplicada', reverted: 'Revertida', failed: 'Falhou' };
  const when = (at) => new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const signed = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%`;

  function summaryOf(entry) {
    if (entry.actionId === 'power-plan-switch') return `${entry.before?.name || '?'} → ${entry.after?.name || '?'}`;
    if (entry.actionId === 'lab-session' || entry.actionId === 'perf-log-users') return entry.detail || '';
    if (Number.isFinite(entry.after?.removedCount)) return `${entry.after.removedCount.toLocaleString('pt-BR')} itens · ${formatBytes(entry.after.bytesFreed || 0)}`;
    return entry.detail || '';
  }

  function measureLine(measure) {
    if (!measure) return '';
    const label = { single: 'um núcleo', multi: 'vários núcleos' };
    return ['single', 'multi'].filter((key) => measure[key]).map((key) => {
      const result = measure[key];
      return result.verdict === 'sem-diferenca' ? `${label[key]}: dentro do ruído (${signed(result.deltaPct)}, ruído ±${result.noisePct.toFixed(1).replace('.', ',')}%)`
        : `${label[key]}: ${signed(result.deltaPct)} (confiança ${result.confidence})`;
    }).join(' · ');
  }

  /** Desenha o Diário de alterações (as 30 mais recentes) com os botões de reverter e de detalhes. */
  function renderJournal() {
    const list = document.getElementById('journal-list');
    if (!list) return;
    const entries = Nexo.journal.list(30);
    document.getElementById('journal-empty').hidden = entries.length > 0;
    list.innerHTML = entries.map((entry) => {
      const info = NexoCatalog.get(entry.actionId);
      const canRevert = entry.status === 'applied' && entry.reversible === true;
      const measured = measureLine(entry.measure);
      const reverted = entry.revertedAt ? ` · revertida em ${when(entry.revertedAt)}` : '';
      const measureRow = measured ? `<div class="j-measure">Medição: ${escapeHtml(measured)}</div>` : '';
      const noteRow = entry.revertNote && entry.status !== 'reverted' ? `<div class="j-meta">${escapeHtml(entry.revertNote)}</div>` : '';
      const revertButton = canRevert ? `<button class="btn sm" type="button" data-revert="${escapeHtml(entry.id)}">Reverter</button>` : '';
      const infoButton = info ? `<button class="btn sm ghost" type="button" data-op="${escapeHtml(entry.actionId)}">Detalhes da operação</button>` : '';
      return `<li class="j-item" data-id="${escapeHtml(entry.id)}" data-status="${escapeHtml(entry.status)}">
        <div class="j-head"><strong>${escapeHtml(entry.title)}</strong>
          <span class="chip risk-${escapeHtml(entry.risk)}">${escapeHtml(NexoCatalog.RISK_LABEL[entry.risk] || entry.risk)}</span>
          <span class="chip status-${escapeHtml(entry.status)}">${escapeHtml(STATUS[entry.status] || entry.status)}</span>${entry.riskSession ? '<span class="chip risk-alto">sessão de risco</span>' : ''}</div>
        <div class="j-meta">${when(entry.at)} · ${escapeHtml(summaryOf(entry))}${reverted}</div>
        ${measureRow}
        ${noteRow}
        <div class="j-actions">${revertButton}${infoButton}</div>
      </li>`;
    }).join('');
  }

  /** Painel com tudo o que o catálogo sabe sobre uma operação (o que altera, risco, reversão, fonte, validação). */
  Nexo.showOperation = function showOperation(id) {
    const entry = NexoCatalog.get(id);
    if (!entry) { showToast('Não há detalhes para esta operação.'); return; }
    const admin = entry.exigeAdmin === true ? 'Exige administrador' : entry.exigeAdmin === false ? 'Não exige administrador' : 'Administrador: a validar em máquina real';
    const rows = [
      ['O que altera', entry.oQueAltera], ['Por que pode ajudar', entry.porQuePodeAjudar], ['Quando pode não ajudar', entry.quandoNaoAjuda],
      ['O que pode mudar', entry.oQuePodeMudar], ['Como é feito', entry.mecanismo], ['Como reverter', entry.reversao], ['Como medimos', entry.medicao],
      ['Compatibilidade', `${entry.compat.windows}. ${entry.compat.hardware}.`], ['Estado de validação', entry.estado]
    ];
    const sourceItem = (source) => {
      const title = source.url ? `<button class="link" type="button" data-doc="${escapeHtml(source.url)}">${escapeHtml(source.titulo)}</button>` : escapeHtml(source.titulo);
      return `<li>${title} <span class="chip">${source.evidencia === 'oficial' ? 'fonte oficial' : source.evidencia}</span></li>`;
    };
    const sources = entry.fontes.map(sourceItem).join('');
    const rowItem = ([name, text]) => `<div><dt>${name}</dt><dd>${escapeHtml(text)}</dd></div>`;
    const dialog = Nexo.dialog({
      title: entry.titulo, wide: true,
      html: `<div class="chips-row"><span class="chip risk-${entry.risco}">${NexoCatalog.RISK_LABEL[entry.risco]}</span>
        <span class="chip">${entry.reversivel === true ? 'Reversível' : entry.reversivel === 'parcial' ? 'Reversão parcial' : 'Não reversível'}</span>
        <span class="chip">${entry.persistente ? 'Persistente' : 'Temporária'}</span><span class="chip">${entry.exigeReinicio ? 'Exige reiniciar' : 'Sem reinício'}</span><span class="chip">${admin}</span></div>
        <dl class="op">${rows.map(rowItem).join('')}<div><dt>Fontes</dt><dd><ul class="sources">${sources}</ul></dd></div></dl>`,
      actions: [{ id: 'close', label: 'Fechar', tone: 'primary' }]
    });
    document.querySelector('.dialog-body').addEventListener('click', (event) => {
      const button = event.target.closest('[data-doc]');
      if (button) desktopBridge?.openDoc?.(button.dataset.doc);
    });
    return dialog;
  };

  /** Reverte uma alteração do diário, avisando se o estado atual mudou desde que o Nexo alterou. */
  Nexo.revertJournal = async function revertJournal(id) {
    const entry = Nexo.journal.get(id);
    if (!entry) return false;
    if (entry.actionId === 'perf-log-users') {
      const access = await desktopBridge.getFpsAccess().catch(() => null);
      const check = Nexo.journal.canRevert(entry, access ? { member: access.member } : null);
      if (!check.ok) { showToast(check.reason); return false; }
      const done = await Nexo.revokeFpsAccess();
      if (done) { Nexo.journal.markReverted(id, 'usuário removido do grupo'); Nexo.emit('journal'); }
      return done;
    }
    if (/^net-/.test(entry.actionId) && Nexo.revertNetwork) {
      const check = Nexo.journal.canRevert(entry, null);
      if (!check.ok) { showToast(check.reason); return false; }
      try { return await Nexo.revertNetwork(entry); }
      catch (error) {
        Nexo.journal.update(id, { revertNote: `Falha ao reverter: ${error.message || 'erro desconhecido'}` });
        showToast(error.message || 'Não foi possível reverter.');
        Nexo.emit('journal');
        return false;
      }
    }
    if (entry.actionId === 'registry-tweak') {
      const scan = await desktopBridge.scanSystem().catch(() => null);
      const now = scan?.items?.find((item) => item.id === entry.before.id);
      const check = Nexo.journal.canRevert(entry, now ? { values: now.values } : null);
      if (!check.ok) { showToast(check.reason); return false; }
      if (check.conflict && !await Nexo.confirm({ title: 'Reverter mesmo assim?', body: check.reason, confirmLabel: 'Reverter', tone: 'danger' })) return false;
      try {
        await desktopBridge.applyTweaks([{ id: entry.before.id, values: entry.before.values, revert: true }]);
        Nexo.journal.markReverted(id, 'valor anterior de volta');
        showToast(`${entry.title}: valor anterior de volta.${entry.after?.reboot === 'reiniciar' ? ' Vale depois de reiniciar o PC.' : ''}`);
        Nexo.emit('journal');
        Nexo.emit('scan-changed');
        return true;
      } catch (error) {
        Nexo.journal.update(id, { revertNote: `Falha ao reverter: ${error.message || 'erro desconhecido'}` });
        showToast(error.message || 'Não foi possível reverter.');
        Nexo.emit('journal');
        return false;
      }
    }
    await Nexo.loadPower?.();
    const active = Nexo.state.power?.active;
    const check = Nexo.journal.canRevert(entry, { activeGuid: active?.guid, activeName: active?.name });
    if (!check.ok) { showToast(check.reason); return false; }
    if (check.conflict) {
      const confirmed = await Nexo.confirm({ title: 'Reverter mesmo assim?', body: check.reason, confirmLabel: 'Reverter', tone: 'danger' });
      if (!confirmed) return false;
    }
    try {
      const result = await desktopBridge.setPowerPlan(entry.before.guid);
      Nexo.state.power = { plans: result.plans, active: result.plans.find((plan) => plan.active) || null };
      Nexo.journal.markReverted(id, 'revertida com sucesso');
      showToast(`Plano de energia voltou para ${entry.before.name}.`);
      Nexo.emit('journal');
      Nexo.emit('power');
      return true;
    } catch (error) {
      Nexo.journal.update(id, { revertNote: `Falha ao reverter: ${error.message || 'erro desconhecido'}` });
      showToast(error.message || 'Não foi possível reverter.');
      Nexo.emit('journal');
      return false;
    }
  };

  document.getElementById('journal-list')?.addEventListener('click', (event) => {
    const revert = event.target.closest('[data-revert]');
    if (revert) Nexo.revertJournal(revert.dataset.revert);
    const operation = event.target.closest('[data-op]');
    if (operation) Nexo.showOperation(operation.dataset.op);
  });
  document.addEventListener('click', (event) => {
    const info = event.target.closest('.info[data-op]');
    if (info) Nexo.showOperation(info.dataset.op);
  });
  Nexo.on('journal', renderJournal);
  Nexo.on('view', (view) => { if (view === 'activity') renderJournal(); });
  renderJournal();
})();
