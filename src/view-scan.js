/* Raio-X do PC (Windows): registro e sistema. Lê sem pedir nada; aplica só o que a pessoa marcar, com o Diário guardando o valor anterior. */
(function () {
  const bridge = desktopBridge;
  const GROUPS = { jogos: 'Jogos e captura', agendador: 'Agendador e prioridades', energia: 'Energia', disco: 'Disco e arquivos', servicos: 'Serviços', interface: 'Interface', entrada: 'Mouse e teclado' };
  const EVIDENCE = { medido: ['efeito medido', 'risk-baixo'], varia: ['depende do PC', ''], controverso: ['controverso', 'risk-moderado'], mito: ['quase mito', 'risk-alto'] };
  const REBOOT = { nao: 'vale na hora', sessao: 'vale ao entrar de novo no Windows', reiniciar: 'vale depois de reiniciar' };
  const state = { scan: null, busy: false };
  const body = () => document.getElementById('scan-body');
  const key = (values) => JSON.stringify(values);

  function render() {
    const scan = state.scan;
    if (!scan) return;
    if (!scan.supported) { body().innerHTML = '<p class="muted">O Raio-X do registro existe só no Windows.</p>'; return; }
    const groups = new Map();
    for (const item of scan.items) { if (!groups.has(item.group)) groups.set(item.group, []); groups.get(item.group).push(item); }
    const changed = scan.items.filter((item) => item.currentKind !== 'padrao').length;
    body().innerHTML = `
      <div class="scan-summary"><span><strong>${scan.items.length}</strong> ajustes lidos</span><span><strong>${changed}</strong> fora do padrão do Windows</span><span>Segurança baseada em virtualização: <strong>${escapeHtml(scan.vbs)}</strong></span><span class="muted">varrido às ${new Date(scan.scannedAt).toLocaleTimeString('pt-BR')}</span></div>
      ${[...groups].map(([group, items], index) => `<details class="scan-group"${index === 0 ? ' open' : ''}><summary><strong>${escapeHtml(GROUPS[group] || group)}</strong><span class="muted">${items.length} ajustes</span></summary><ul class="scan-list">${items.map(row).join('')}</ul></details>`).join('')}
      <details class="scan-group refused"><summary><strong>O que o Nexo encontra e se recusa a mudar</strong><span class="muted">${scan.refused.length} itens</span></summary><ul class="scan-list">${scan.refused.map((item) => `<li><div class="scan-main"><strong>${escapeHtml(item.label)}</strong><span class="muted">${escapeHtml(item.reason)}</span></div><span class="chip risk-alto">recusado</span></li>`).join('')}</ul></details>
      <div class="scan-foot"><button class="btn ghost sm" type="button" id="scan-recommended">Marcar os recomendados</button><span class="muted" id="scan-count">Nada marcado.</span><button class="btn danger" type="button" id="scan-apply" disabled>Aplicar marcados</button></div>`;
    updateCount();
  }

  function row(item) {
    const [evidence, tone] = EVIDENCE[item.evidence] || [item.evidence, ''];
    const options = item.options.map((option, index) => `<option value="${index}" ${key(option.values) === key(item.options.find((o) => o.label === item.current)?.values) ? 'selected' : ''}>${escapeHtml(option.label)}${option.kind === 'recomendado' ? ' (recomendado)' : option.kind === 'padrao' && !/padrão/i.test(option.label) ? ' (padrão)' : ''}</option>`).join('');
    return `<li data-tweak="${escapeHtml(item.id)}"><label class="scan-pick"><span class="check"><input type="checkbox" data-pick /><i></i></span></label>
      <div class="scan-main"><strong>${escapeHtml(item.label)}</strong><span class="muted">${escapeHtml(item.what)}</span>
        <div class="chips-row"><span class="chip ${tone}">${escapeHtml(evidence)}</span><span class="chip ${item.risk === 'moderado' ? 'risk-moderado' : 'risk-baixo'}">risco ${escapeHtml(item.risk)}</span><span class="chip">${escapeHtml(REBOOT[item.reboot] || '')}</span>${item.admin ? '<span class="chip">pede permissão (UAC)</span>' : ''}</div></div>
      <div class="scan-side"><small class="muted">Agora: <strong>${escapeHtml(item.current)}</strong></small><select data-option aria-label="Novo valor de ${escapeHtml(item.label)}">${options}</select></div></li>`;
  }

  function picked() {
    if (!state.scan) return [];
    return [...body().querySelectorAll('li[data-tweak]')].filter((li) => li.querySelector('[data-pick]')?.checked).map((li) => {
      const item = state.scan.items.find((entry) => entry.id === li.dataset.tweak);
      const option = item.options[Number(li.querySelector('[data-option]').value)];
      return { item, option };
    }).filter(({ item, option }) => item && option && key(option.values) !== key(item.values));
  }
  function updateCount() {
    const list = picked();
    const button = document.getElementById('scan-apply');
    if (button) button.disabled = !list.length || state.busy;
    setText('scan-count', list.length ? `${list.length} ajuste(s) marcado(s)${list.some(({ item }) => item.admin) ? ' · o Windows vai pedir permissão uma vez' : ''}${list.some(({ item }) => item.reboot === 'reiniciar') ? ' · alguns valem depois de reiniciar' : ''}.` : 'Nada marcado (ou a opção escolhida já é a atual).');
  }

  async function scanNow() {
    if (!bridge?.scanSystem || state.busy) return;
    const button = document.getElementById('scan-run');
    setButtonBusy(button, true, 'Varrendo…');
    try { state.scan = await bridge.scanSystem(); render(); }
    catch (error) { body().innerHTML = `<p class="notes-line">Não consegui varrer: ${escapeHtml(error.message || 'erro desconhecido')}</p>`; }
    finally { button.dataset.idleText = 'Varrer de novo'; setButtonBusy(button, false); }
  }

  async function applyPicked() {
    const list = picked();
    if (!list.length) return;
    const ok = await Nexo.confirm({
      title: `Aplicar ${list.length} ajuste(s) do registro?`,
      body: 'Opção arriscada: mexe em configurações do sistema. Cada mudança vai para o Diário com o valor anterior, e "Reverter" volta exatamente ao que estava.',
      items: list.map(({ item, option }) => `${item.label}: ${item.current} → ${option.label} (${REBOOT[item.reboot] || ''})`),
      confirmLabel: 'Aplicar', tone: 'danger'
    });
    if (!ok) return;
    state.busy = true;
    const button = document.getElementById('scan-apply');
    setButtonBusy(button, true, 'Aplicando…');
    try {
      const result = await bridge.applyTweaks(list.map(({ item, option }) => ({ id: item.id, values: option.values })));
      for (const { item, option } of list) {
        Nexo.journal.record({ actionId: 'registry-tweak', title: item.label, risk: item.risk, reversible: true, riskSession: true,
          authorization: item.admin ? 'confirmação na interface e permissão de administrador (UAC)' : 'confirmação na interface',
          before: { id: item.id, values: item.values, label: item.current }, after: { id: item.id, values: option.values, label: option.label, reboot: item.reboot },
          detail: `${item.current} → ${option.label}. ${REBOOT[item.reboot] || ''}.` });
      }
      Nexo.emit('journal');
      recordActivity('Raio-X do PC', `${list.length} ajuste(s) aplicado(s)`);
      state.scan = result.after || state.scan;
      render();
      showToast(list.some(({ item }) => item.reboot === 'reiniciar') ? 'Aplicado. Reinicie o PC para valer tudo; dá para reverter pelo Diário.' : 'Aplicado. Dá para reverter pelo Diário (Atividade).');
    } catch (error) { showToast(error.message || 'Não foi possível aplicar.'); }
    finally { state.busy = false; setButtonBusy(button, false); updateCount(); }
  }

  document.getElementById('scan-run')?.addEventListener('click', scanNow);
  body()?.addEventListener('change', (event) => {
    if (event.target.matches('[data-option]')) { const pick = event.target.closest('li')?.querySelector('[data-pick]'); if (pick) pick.checked = true; }
    updateCount();
  });
  body()?.addEventListener('click', (event) => {
    if (event.target.id === 'scan-apply') applyPicked();
    if (event.target.id === 'scan-recommended') {
      for (const li of body().querySelectorAll('li[data-tweak]')) {
        const item = state.scan.items.find((entry) => entry.id === li.dataset.tweak);
        const index = item.options.findIndex((option) => option.kind === 'recomendado');
        if (index < 0 || key(item.options[index].values) === key(item.values)) continue;
        li.querySelector('[data-option]').value = String(index);
        li.querySelector('[data-pick]').checked = true;
      }
      updateCount();
    }
  });
  Nexo.on('scan-changed', () => { if (state.scan) scanNow(); });
  Nexo.commands.push({ label: 'Raio-X do PC (registro e sistema)', hint: 'Otimização extrema', run: () => { Nexo.go('lab'); document.getElementById('scan-sheet')?.scrollIntoView({ behavior: 'smooth' }); scanNow(); } });
})();
