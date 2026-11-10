/* Teste com reinício: escolhe ajustes no Raio-X, mede o PC depois de reiniciar sem e com eles (ordem ABBA) e diz se houve ganho. */
(function () {
  const bridge = desktopBridge;
  const RT = window.NexoRebootTest;
  if (!bridge?.rebootStatus || !RT) return;
  const el = () => document.getElementById('reboot-test');
  const BOOT_MINUTES = 5.5; // reinício + espera do Windows sossegar + medição
  const VERDICT = { melhorou: ['melhorou', 'risk-baixo'], piorou: ['piorou', 'risk-alto'], 'sem-diferenca': ['sem diferença', ''], inconclusivo: ['inconclusivo', 'risk-moderado'] };
  const OVERALL = { ganho: ['GANHO', 'risk-baixo'], perda: ['PERDA', 'risk-alto'], misto: ['MISTO', 'risk-moderado'], empate: ['EMPATE', ''], inconclusivo: ['INCONCLUSIVO', 'risk-moderado'] };
  const CONFIG = { A: 'sem os ajustes, com os valores de antes', B: 'com os ajustes' };
  const view = { status: null, progress: null, composing: null, options: { protocol: 'completo', goal: 'jogos', auto: false }, hidden: false, timer: null, rescanned: null };
  const dec = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '--');
  const signed = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${dec(value)}%` : '--');
  const when = (at) => (Number.isFinite(at) ? new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--');
  const metricValue = (metric, value) => (Number.isFinite(value) ? `${dec(value, metric.unit === 'pts' || metric.unit === '' ? 0 : 1)}${metric.unit && metric.unit !== 'pts' ? ` ${metric.unit}` : ''}` : '--');

  function segment(name, current, entries) {
    return `<div class="segmented sm" role="group">${entries.map(([value, label]) => `<button type="button" data-rt-${name}="${value}" aria-pressed="${value === current}">${escapeHtml(label)}</button>`).join('')}</div>`;
  }

  function timeline(state) {
    return `<ol class="rt-boots">${state.order.map((config, index) => {
      const boot = state.boots[index];
      const now = index === state.step && state.status === 'running';
      return `<li class="${boot ? 'done' : now ? 'now' : ''}"><strong>${config}</strong><span>${boot ? `boot ${index + 1} medido` : now ? 'agora' : `boot ${index + 1}`}</span></li>`;
    }).join('')}</ol>`;
  }

  function resultTable(result) {
    const rows = result.metrics.filter((item) => item.a.length || item.b.length);
    return `<div class="table-scroll"><table class="exp rt-table"><thead><tr><th>Medida</th><th>Sem (A)</th><th>Com (B)</th><th>Diferença</th><th>Variação entre boots</th><th>Veredito</th></tr></thead><tbody>${rows.map((item) => {
      const metric = RT.METRIC.get(item.id);
      const [label, tone] = VERDICT[item.verdict] || [item.verdict, ''];
      return `<tr><td>${escapeHtml(item.label)}${metric.note ? `<small class="muted"> (${escapeHtml(metric.note)})</small>` : ''}</td><td>${metricValue(metric, item.medianA)}</td><td>${metricValue(metric, item.medianB)}</td><td>${signed(item.gainPct)}</td><td>${Number.isFinite(item.noisePct) ? `±${dec(item.noisePct)}%` : '--'}</td><td><span class="chip ${tone}">${label}</span></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function verdictCard(state, result, final) {
    const [label, tone] = OVERALL[result.overall] || [result.overall, ''];
    const kept = state.kept === 'B' ? 'Os ajustes ficaram aplicados (estão no Diário para reverter).' : 'O PC ficou com os valores de antes.';
    return `<div class="rt-verdict"><span class="chip ${tone}">${label}</span><strong>${escapeHtml(RT.OVERALL_TEXT[result.overall] || '')}</strong>
      <span class="muted">Ganho composto (objetivo ${escapeHtml(RT.GOALS[state.goal]?.label || state.goal)}): <strong>${signed(result.composite)}</strong> · ${result.counts.A} boot(s) sem e ${result.counts.B} com os ajustes${result.discarded ? ` · ${result.discarded} boot(s) com o PC ocupado ficaram de fora` : ''}${final ? ` · ${escapeHtml(kept)}` : ''}</span></div>${resultTable(result)}`;
  }

  function composeHtml() {
    const list = view.composing;
    const order = RT.PROTOCOLS[view.options.protocol].order;
    const admin = list.some((change) => change.admin);
    const permissions = RT.permissionCount(order, admin);
    return `<div class="rt-head"><div><span class="badge risk sm">TESTE COM REINÍCIO</span><h4>Medir ${list.length} ajuste(s) reiniciando o PC</h4>
        <p class="muted">O Nexo reinicia o PC, mede, aplica os ajustes, reinicia, mede de novo e volta ao original na ordem ${order.join(', ')}. Cada boot é medido do mesmo jeito: tempo até a área de trabalho, processador e memória em repouso, processos e serviços, e os testes de desempenho do laboratório. No fim, só fica o que ganhou nos dois lados.</p></div></div>
      <ul class="rt-changes">${list.map((change) => `<li><strong>${escapeHtml(change.label)}</strong><span class="muted">${escapeHtml(change.beforeLabel)} → ${escapeHtml(change.afterLabel)}</span></li>`).join('')}</ul>
      <div class="rt-options">
        <div class="lab-field"><span>Ordem</span>${segment('protocol', view.options.protocol, Object.entries(RT.PROTOCOLS).map(([id, item]) => [id, item.label.split(' (')[0]]))}<small>${escapeHtml(RT.PROTOCOLS[view.options.protocol].label)}. Mais reinícios separam melhor o efeito da variação normal.</small></div>
        <div class="lab-field"><span>Objetivo</span>${segment('goal', view.options.goal, Object.entries(RT.GOALS).map(([id, item]) => [id, item.label]))}</div>
        <label class="toggle-line"><input type="checkbox" id="rt-auto" ${view.options.auto ? 'checked' : ''} /> Reiniciar sozinho entre as medições (aviso de 60 s, dá para impedir)</label>
      </div>
      <p class="notes-line">Cerca de ${Math.round(order.length * BOOT_MINUTES)} min no total, ${order.length} reinícios${permissions ? `; o Windows vai pedir permissão ${permissions} vez(es) para trocar os ajustes do sistema` : ''}. Salve o que estiver aberto e não use o PC pesado enquanto ele mede.</p>
      <div class="rt-actions"><button class="btn ghost" type="button" data-rt="close">Voltar</button><button class="btn danger" type="button" data-rt="start">Começar o teste</button></div>`;
  }

  function runningHtml(status) {
    const state = status.state;
    const progress = view.progress && view.progress.stage === 'medindo' ? view.progress : null;
    const config = state.order[state.step];
    let body = '';
    if (status.busy && progress) {
      body = `<p><strong>Medindo o boot ${state.step + 1} de ${state.order.length} (${escapeHtml(CONFIG[config])}).</strong> Não use o PC até terminar.</p><div class="progress-track"><span data-css="width:${Math.max(3, progress.pct)}%"></span></div><p class="muted">${escapeHtml(progress.text || '')}</p>`;
    } else if (status.busy) {
      body = `<p class="muted">${escapeHtml(view.progress?.text || 'Trabalhando…')}</p>`;
    } else if (status.action === 'switch') {
      body = `<p>Falta ${config === 'B' ? 'aplicar os ajustes' : 'voltar aos valores de antes'} para o boot ${state.step + 1}.</p><div class="rt-actions"><button class="btn danger" type="button" data-rt="continue">${config === 'B' ? 'Aplicar e continuar' : 'Voltar e continuar'}</button></div>`;
    } else if (status.action === 'measure') {
      body = '<p>O PC reiniciou. Pronto para medir este boot.</p><div class="rt-actions"><button class="btn primary" type="button" data-rt="continue">Medir agora</button></div>';
    } else {
      const seconds = status.restartAt ? Math.max(0, Math.round((status.restartAt - Date.now()) / 1000)) : null;
      body = `<p><strong>Reinicie o PC para medir o boot ${state.step + 1} de ${state.order.length}</strong> (${escapeHtml(CONFIG[config])}). Depois de entrar no Windows, o Nexo abre sozinho e mede.</p>
        <div class="rt-actions">${seconds !== null ? `<span class="chip risk-moderado">reiniciando em ${seconds} s</span><button class="btn ghost" type="button" data-rt="abort-restart">Não reiniciar agora</button>` : '<button class="btn danger" type="button" data-rt="restart">Reiniciar agora</button>'}</div>`;
    }
    return `<div class="rt-head"><div><span class="badge risk sm">TESTE COM REINÍCIO</span><h4>${state.changes.length} ajuste(s) em teste · começou ${when(state.createdAt)}</h4></div><button class="btn ghost sm" type="button" data-rt="cancel">Cancelar teste (volta ao original)</button></div>
      ${timeline(state)}${state.note ? `<p class="notes-line">${escapeHtml(state.note)}</p>` : ''}${body}
      ${status.preview ? `<details class="rt-preview"><summary>Parcial até agora</summary>${verdictCard(state, status.preview, false)}</details>` : ''}`;
  }

  function finishedHtml(status) {
    const state = status.state;
    return `<div class="rt-head"><div><span class="badge risk sm">TESTE COM REINÍCIO</span><h4>${state.status === 'cancelled' ? 'Teste cancelado' : 'Resultado'} · ${state.changes.length} ajuste(s) · ${when(state.finishedAt)}</h4></div><button class="btn ghost sm" type="button" data-rt="hide">Fechar</button></div>
      ${timeline(state)}${state.note ? `<p class="notes-line">${escapeHtml(state.note)}</p>` : ''}
      ${state.result ? verdictCard(state, state.result, true) : '<p class="muted">Sem boots suficientes para um veredito. O PC ficou com os valores de antes.</p>'}`;
  }

  function historyHtml(status) {
    const list = (status?.history || []).filter((item) => item.id !== status?.state?.id);
    if (!list.length) return '';
    return `<details class="rt-history"><summary>Testes com reinício anteriores (${list.length})</summary><ul>${list.map((item) => {
      const [label, tone] = OVERALL[item.result?.overall] || ['sem veredito', ''];
      return `<li><span class="chip ${tone}">${label}</span><span>${when(item.finishedAt || item.createdAt)} · ${item.changes.length} ajuste(s): ${escapeHtml(item.changes.slice(0, 3).map((change) => change.label).join(', '))}${item.changes.length > 3 ? '…' : ''}</span><span class="muted">${Number.isFinite(item.result?.composite) ? signed(item.result.composite) : ''} · ${item.kept === 'B' ? 'ajustes ficaram' : 'voltou ao original'}</span></li>`;
    }).join('')}</ul></details>`;
  }

  function render() {
    const box = el();
    if (!box) return;
    const status = view.status;
    // Enquanto mede um boot, o painel para de ler o sistema (a própria leitura atrapalharia a medida).
    Nexo.state.rebootMeasuring = Boolean(status?.busy && status?.state?.status === 'running' && view.progress?.stage === 'medindo');
    let html = '';
    if (view.composing) html = composeHtml();
    else if (status?.state?.status === 'running') html = runningHtml(status);
    else if (status?.state && !view.hidden) html = finishedHtml(status);
    html += historyHtml(status);
    box.hidden = !html;
    box.innerHTML = html;
    clearTimeout(view.timer);
    if (status?.restartAt) view.timer = setTimeout(render, 1000);
  }

  /** Quando o teste termina com os ajustes mantidos, eles entram no Diário (para reverter como qualquer ajuste do Raio-X). */
  async function journalIfNeeded() {
    const state = view.status?.state;
    if (!state || state.status === 'running' || state.kept !== 'B' || state.journaled) return;
    for (const change of state.changes) {
      Nexo.journal.record({ actionId: 'registry-tweak', title: change.label, risk: 'moderado', reversible: true, riskSession: true,
        authorization: change.admin ? 'teste com reinício confirmado na interface e permissão de administrador (UAC)' : 'teste com reinício confirmado na interface',
        before: { id: change.id, values: change.before, label: change.beforeLabel }, after: { id: change.id, values: change.after, label: change.afterLabel, reboot: change.reboot },
        detail: `${change.beforeLabel} → ${change.afterLabel}. Mantido pelo teste com reinício (${state.result ? RT.OVERALL_TEXT[state.result.overall] : 'sem veredito'}).` });
    }
    Nexo.emit('journal');
    recordActivity('Teste com reinício', `${state.changes.length} ajuste(s) mantido(s)`);
    await bridge.rebootAck(state.id).catch(() => {});
    view.status = { ...view.status, state: { ...state, journaled: true } };
  }

  async function refresh() {
    view.status = await bridge.rebootStatus().catch(() => view.status);
    render();
    await journalIfNeeded();
    // Terminou agora: o Raio-X relê o PC uma vez (os valores podem ter voltado ou ficado).
    const finished = view.status?.state && view.status.state.status !== 'running' ? view.status.state.id : null;
    if (finished && view.rescanned !== finished) { if (view.rescanned !== null) Nexo.emit('scan-changed'); view.rescanned = finished; }
  }

  async function act(name) {
    try {
      if (name === 'close') { view.composing = null; render(); return; }
      if (name === 'hide') { view.hidden = true; render(); return; }
      if (name === 'start') {
        const order = RT.PROTOCOLS[view.options.protocol].order;
        const ok = await Nexo.confirm({ title: 'Começar o teste com reinício?', tone: 'danger', confirmLabel: 'Começar',
          body: `O PC vai reiniciar ${order.length} vezes. Na primeira, nada muda (é a medida de referência). Cancelar a qualquer momento volta ao original.`,
          items: view.composing.map((change) => `${change.label}: ${change.beforeLabel} → ${change.afterLabel}`).slice(0, 12) });
        if (!ok) return;
        view.status = await bridge.rebootStart({ changes: view.composing, ...view.options });
        view.composing = null;
        view.hidden = false;
        render();
        if (view.options.auto) await act('restart');
        return;
      }
      if (name === 'restart') {
        const ok = view.options.auto && view.status?.state?.step === 0 ? true : await Nexo.confirm({ title: 'Reiniciar o PC agora?', body: 'O Windows reinicia em 15 segundos. Salve o que estiver aberto. Depois de entrar, o Nexo abre sozinho e mede.', confirmLabel: 'Reiniciar', tone: 'danger' });
        if (!ok) return;
        await bridge.rebootRestart();
      }
      if (name === 'abort-restart') await bridge.rebootAbortRestart();
      if (name === 'continue') { view.progress = { stage: 'trabalhando', text: 'Continuando o teste…' }; view.status = { ...view.status, busy: true }; render(); view.status = await bridge.rebootContinue(); }
      if (name === 'cancel') {
        const ok = await Nexo.confirm({ title: 'Cancelar o teste com reinício?', body: 'O Nexo volta todos os ajustes do teste aos valores de antes (o Windows pode pedir permissão).', confirmLabel: 'Cancelar o teste', cancelLabel: 'Continuar testando', tone: 'danger' });
        if (!ok) return;
        view.status = await bridge.rebootCancel();
        view.hidden = false;
      }
      await refresh();
    } catch (error) { showToast(error.message || 'Não deu certo.'); await refresh(); }
  }

  /** Chamado pelo Raio-X com os ajustes marcados. */
  Nexo.composeRebootTest = (list) => {
    if (view.status?.state?.status === 'running') { showToast('Já existe um teste com reinício em andamento.'); el()?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    view.composing = list.map(({ item, option }) => ({ id: item.id, label: item.label, before: item.values, after: option.values, beforeLabel: item.current, afterLabel: option.label, reboot: item.reboot, admin: item.admin }));
    view.hidden = false;
    render();
    el()?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  el()?.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.rt) { act(button.dataset.rt); return; }
    for (const name of ['protocol', 'goal']) {
      const value = button.dataset[`rt${name[0].toUpperCase()}${name.slice(1)}`];
      if (value) { view.options[name] = value; render(); }
    }
  });
  el()?.addEventListener('change', (event) => { if (event.target.id === 'rt-auto') view.options.auto = event.target.checked; });
  bridge.onRebootProgress?.((progress) => {
    view.progress = progress;
    const working = ['medindo', 'trocando', 'trabalhando'].includes(progress.stage);
    if (view.status) view.status = { ...view.status, busy: working };
    render();
    if (!working) refresh();
  });
  bridge.onRebootStatus?.((status) => { view.status = status; render(); journalIfNeeded(); });
  bridge.onRebootShow?.(() => { Nexo.go('lab'); view.hidden = false; refresh().then(() => el()?.scrollIntoView({ behavior: 'smooth', block: 'center' })); });
  Nexo.on?.('view', (name) => { if (name === 'lab') refresh(); });
  if (Nexo.platform !== 'linux') refresh();
})();
