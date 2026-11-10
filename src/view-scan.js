/* Raio-X do PC (Windows): registro e sistema. Lê sem pedir nada; aplica só o que a pessoa marcar, com o Diário guardando o valor anterior. */
(function () {
  const bridge = desktopBridge;
  const GROUPS = { jogos: 'Jogos e captura', agendador: 'Agendador e prioridades', energia: 'Energia', disco: 'Disco e arquivos', interface: 'Interface', entrada: 'Mouse e teclado', memoria: 'Memória e sistema', navegadores: 'Navegadores e segundo plano', rede: 'Rede (TCP/IP)', plano: 'Plano de energia ativo (na tomada)', servicos: 'Serviços' };
  const RISK_TONE = { baixo: 'risk-baixo', moderado: 'risk-moderado', alto: 'risk-alto' };
  const EVIDENCE = { medido: ['efeito medido', 'risk-baixo'], varia: ['depende do PC', ''], controverso: ['controverso', 'risk-moderado'], mito: ['quase mito', 'risk-alto'] };
  const REBOOT = { nao: 'vale na hora', sessao: 'vale ao entrar de novo no Windows', reiniciar: 'vale depois de reiniciar' };
  // picks: ajuste marcado → índice da opção escolhida (sobrevive ao filtro e a redesenhos).
  const state = { scan: null, busy: false, filter: '', onlyChanged: false, picks: new Map() };
  const body = () => document.getElementById('scan-body');
  const key = (values) => JSON.stringify(values);

  function labTotals() {
    try { return window.NexoLab?.spaceStats ? NexoLab.spaceStats({ allowRisk: 'alto', platform: 'win32' }) : null; } catch { return null; }
  }
  function visible(item) {
    if (!item.available) return false;
    if (state.onlyChanged && item.currentKind === 'padrao') return false;
    if (!state.filter) return true;
    const text = `${item.label} ${item.what} ${GROUPS[item.group] || ''}`.toLocaleLowerCase('pt-BR');
    return state.filter.split(/\s+/).every((word) => text.includes(word));
  }

  function render() {
    const { scan } = state;
    if (!scan) return;
    if (!scan.supported) { body().innerHTML = '<p class="muted">O Raio-X do registro existe só no Windows.</p>'; return; }
    const usable = scan.items.filter((item) => item.available);
    const missing = scan.items.length - usable.length;
    const shown = usable.filter(visible);
    const groups = new Map();
    for (const item of shown) { if (!groups.has(item.group)) groups.set(item.group, []); groups.get(item.group).push(item); }
    const changed = usable.filter((item) => item.currentKind !== 'padrao').length;
    const options = usable.reduce((total, item) => total + item.options.length, 0);
    const lab = labTotals();
    const names = scan.groups || GROUPS;
    const rank = Object.keys(names);
    const ordered = [...groups].sort((a, b) => (rank.indexOf(a[0]) + 1 || 99) - (rank.indexOf(b[0]) + 1 || 99));
    body().innerHTML = `
      <div class="scan-summary"><span><strong>${usable.length}</strong> ajustes e <strong>${options}</strong> opções neste PC</span><span><strong>${changed}</strong> fora do padrão do Windows</span>${lab ? `<span>Otimização extrema inteira: <strong>${usable.length + lab.knobs}</strong> ajustes e <strong>${options + lab.options}</strong> opções</span>` : ''}<span>Segurança baseada em virtualização: <strong>${escapeHtml(scan.vbs)}</strong></span><span class="muted">varrido às ${new Date(scan.scannedAt).toLocaleTimeString('pt-BR')}${missing ? ` · ${missing} não existem neste PC` : ''}</span></div>
      <div class="scan-filters"><label class="search"><svg aria-hidden="true"><use href="#i-search"/></svg><input id="scan-filter" type="search" placeholder="Filtrar ajustes (ex.: rede, mouse, Xbox)" autocomplete="off" value="${escapeHtml(state.filter)}" /></label><label class="toggle-line"><input type="checkbox" id="scan-only-changed" ${state.onlyChanged ? 'checked' : ''} /> Só o que está fora do padrão</label></div>
      ${shown.length ? '' : '<p class="muted">Nada com esse filtro.</p>'}
      ${ordered.map(([group, items], index) => `<details class="scan-group"${index === 0 || state.filter ? ' open' : ''}><summary><strong>${escapeHtml(names[group] || GROUPS[group] || group)}</strong><span class="muted">${items.length} ajustes · ${items.reduce((total, item) => total + item.options.length, 0)} opções</span></summary><ul class="scan-list">${items.map(row).join('')}</ul></details>`).join('')}
      <details class="scan-group refused"><summary><strong>O que o Nexo encontra e se recusa a mudar</strong><span class="muted">${scan.refused.length} itens</span></summary><ul class="scan-list">${scan.refused.map((item) => `<li><div class="scan-main"><strong>${escapeHtml(item.label)}</strong><span class="muted">${escapeHtml(item.reason)}</span></div><span class="chip risk-alto">recusado</span></li>`).join('')}</ul></details>
      <div class="scan-foot"><button class="btn ghost sm" type="button" id="scan-recommended">Marcar os recomendados</button><span class="muted" id="scan-count">Nada marcado.</span>${Nexo.composeRebootTest ? '<button class="btn ghost" type="button" id="scan-reboot-test" disabled title="Reinicia o PC algumas vezes e mede com e sem os ajustes marcados">Testar com reinício</button>' : ''}<button class="btn danger" type="button" id="scan-apply" disabled>Aplicar marcados</button></div>`;
    updateCount();
  }

  function row(item) {
    const [evidence, tone] = EVIDENCE[item.evidence] || [item.evidence, ''];
    const currentIndex = item.options.findIndex((option) => option.label === item.current);
    const chosen = state.picks.has(item.id) ? state.picks.get(item.id) : currentIndex;
    const options = item.options.map((option, index) => `<option value="${index}" ${index === chosen ? 'selected' : ''}>${escapeHtml(option.label)}${option.kind === 'recomendado' ? ' (recomendado)' : option.kind === 'padrao' && !/padrão/i.test(option.label) ? ' (padrão)' : ''}</option>`).join('');
    return `<li data-tweak="${escapeHtml(item.id)}"><label class="scan-pick"><span class="check"><input type="checkbox" data-pick ${state.picks.has(item.id) ? 'checked' : ''} /><i></i></span></label>
      <div class="scan-main"><strong>${escapeHtml(item.label)}</strong><span class="muted">${escapeHtml(item.what)}</span>
        <div class="chips-row"><span class="chip ${tone}">${escapeHtml(evidence)}</span><span class="chip ${RISK_TONE[item.risk] || ''}">risco ${escapeHtml(item.risk)}</span><span class="chip">${escapeHtml(REBOOT[item.reboot] || '')}</span>${item.admin ? '<span class="chip">pede permissão (UAC)</span>' : ''}${item.group === 'plano' ? '<span class="chip">plano de energia ativo</span>' : ''}</div></div>
      <div class="scan-side"><small class="muted">Agora: <strong>${escapeHtml(item.current)}</strong></small><select data-option aria-label="Novo valor de ${escapeHtml(item.label)}">${options}</select></div></li>`;
  }

  function picked() {
    if (!state.scan) return [];
    return [...state.picks].map(([id, index]) => {
      const item = state.scan.items.find((entry) => entry.id === id && entry.available);
      return { item, option: item?.options[index] };
    }).filter(({ item, option }) => item && option && key(option.values) !== key(item.values));
  }
  function updateCount() {
    const list = picked();
    const button = document.getElementById('scan-apply');
    if (button) button.disabled = !list.length || state.busy;
    const test = document.getElementById('scan-reboot-test');
    if (test) test.disabled = !list.length || state.busy;
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
      const failed = new Set(Array.isArray(result?.failed) ? result.failed : []);
      const after = result?.after;
      let recorded = 0;
      for (const { item, option } of list) {
        // Recusado pelo Windows: só entra no Diário se algo chegou a mudar (ajustes com mais de um valor).
        const now = after?.items?.find((entry) => entry.id === item.id);
        if (failed.has(item.id) && (!now || key(now.values) === key(item.values))) continue;
        const done = failed.has(item.id) ? { values: now.values, label: now.current } : { values: option.values, label: option.label };
        Nexo.journal.record({ actionId: 'registry-tweak', title: item.label, risk: item.risk, reversible: true, riskSession: true,
          authorization: item.admin ? 'confirmação na interface e permissão de administrador (UAC)' : 'confirmação na interface',
          before: { id: item.id, values: item.values, label: item.current }, after: { id: item.id, values: done.values, label: done.label, reboot: item.reboot },
          detail: `${item.current} → ${done.label}. ${REBOOT[item.reboot] || ''}.${failed.has(item.id) ? ' O Windows recusou parte da mudança.' : ''}` });
        recorded += 1;
      }
      Nexo.emit('journal');
      recordActivity('Raio-X do PC', `${recorded} ajuste(s) aplicado(s)${failed.size ? `, ${failed.size} recusado(s) pelo Windows` : ''}`);
      state.scan = after || state.scan;
      state.picks.clear();
      render();
      const refusedNames = list.filter(({ item }) => failed.has(item.id)).map(({ item }) => item.label);
      if (refusedNames.length) showToast(`${result?.declined ? 'Sem a permissão do Windows' : 'O Windows recusou'}: ${refusedNames.slice(0, 3).join(', ')}${refusedNames.length > 3 ? ` e mais ${refusedNames.length - 3}` : ''}. O resto foi aplicado e está no Diário.`);
      else showToast(list.some(({ item }) => item.reboot === 'reiniciar') ? 'Aplicado. Reinicie o PC para valer tudo; dá para reverter pelo Diário.' : 'Aplicado. Dá para reverter pelo Diário (Atividade).');
    } catch (error) { showToast(error.message || 'Não foi possível aplicar.'); }
    finally { state.busy = false; setButtonBusy(button, false); updateCount(); }
  }

  document.getElementById('scan-run')?.addEventListener('click', scanNow);
  body()?.addEventListener('input', (event) => {
    if (event.target.id !== 'scan-filter') return;
    state.filter = event.target.value.trim().toLocaleLowerCase('pt-BR');
    const caret = event.target.selectionStart;
    render();
    const input = document.getElementById('scan-filter');
    if (input) { input.focus(); input.setSelectionRange(caret, caret); }
  });
  body()?.addEventListener('change', (event) => {
    if (event.target.id === 'scan-only-changed') { state.onlyChanged = event.target.checked; render(); return; }
    const li = event.target.closest('li[data-tweak]');
    if (li && event.target.matches('[data-option]')) {
      const pick = li.querySelector('[data-pick]');
      if (pick) pick.checked = true;
      state.picks.set(li.dataset.tweak, Number(event.target.value));
    } else if (li && event.target.matches('[data-pick]')) {
      if (event.target.checked) state.picks.set(li.dataset.tweak, Number(li.querySelector('[data-option]').value));
      else state.picks.delete(li.dataset.tweak);
    }
    updateCount();
  });
  body()?.addEventListener('click', (event) => {
    if (event.target.id === 'scan-apply') applyPicked();
    if (event.target.id === 'scan-reboot-test') { const list = picked(); if (list.length) Nexo.composeRebootTest?.(list); }
    if (event.target.id === 'scan-recommended') {
      for (const item of state.scan.items) {
        if (!item.available) continue;
        const index = item.options.findIndex((option) => option.kind === 'recomendado');
        if (index < 0 || key(item.options[index].values) === key(item.values)) continue;
        state.picks.set(item.id, index);
      }
      render();
    }
  });
  Nexo.on('scan-changed', () => { if (state.scan) scanNow(); });
  Nexo.commands.push({ label: 'Raio-X do PC (registro e sistema)', hint: 'Otimização extrema', run: () => { Nexo.go('lab'); document.getElementById('scan-sheet')?.scrollIntoView({ behavior: 'smooth' }); scanNow(); } });
})();
