/* Otimização extrema (beta): o laboratório autônomo. Sessões de risco são marcadas em todo o app enquanto rodam. */
(function () {
  const bridge = desktopBridge;
  const KEY = 'nexo-lab-v1';
  const STAGES = [['preflight', 'Pré-checagem'], ['ponto', 'Ponto de restauração'], ['preparar', 'Ambiente de testes'], ['aquecer', 'Aquecimento'], ['testar', 'Testando ideias'], ['combinar', 'Combinações inéditas'], ['confirmar', 'Confirmação'], ['restaurar', 'Restauração']];
  const BENCH_SHORT = { single: '1 núcleo', multi: 'Todos', burst: 'Rajadas', latency: 'Latência', disk: 'Disco' };
  const GOAL_NOTE = { jogos: 'Pesa mais um núcleo, rajadas e latência.', geral: 'Todos os testes com peso parecido.', pesado: 'Pesa mais todos os núcleos (render, compilação, compressão).', resposta: 'Pesa mais latência e rajadas: cliques e carregamentos curtos.' };
  const VERDICT = { melhorou: ['melhorou', 'risk-baixo'], piorou: ['piorou', 'risk-alto'], misto: ['troca (melhora e piora)', 'risk-moderado'], 'sem-diferenca': ['sem diferença', ''], inconclusivo: ['inconclusivo', ''], recusado: ['o PC recusou', 'risk-moderado'] };
  const NOVELTY = { 'inedito-aqui': 'inédito neste PC', 'pouco-conhecido': 'pouco conhecido', conhecido: 'conhecido', raro: 'quase ninguém mexe' };
  const options = { autonomy: 'assistido', allowRisk: 'moderado', maxArms: 8, goal: 'jogos', combos: 2, budgetMin: 30 };
  let space = [];
  let live = null;
  let lastPre = null; // última conferência deste PC (para mostrar o espaço que ele aceita de verdade)

  const memory = () => { const stored = readJSON(KEY, null); return { evidence: stored?.evidence || {}, tabu: Array.isArray(stored?.tabu) ? stored.tabu : [], runs: Array.isArray(stored?.runs) ? stored.runs : [] }; };
  const saveMemory = (value) => writeJSON(KEY, { evidence: value.evidence, tabu: value.tabu, runs: value.runs.slice(0, 15) });
  const temp = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')} °C` : '—');
  const signed = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%` : '—');
  const when = (at) => new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const verdictChip = (verdict) => { const [label, tone] = VERDICT[verdict] || [verdict || '—', '']; return `<span class="chip ${tone}">${escapeHtml(label)}</span>`; };
  const knobLabel = (id) => space.find((knob) => knob.id === id)?.label || NexoLab.knob(id)?.label || id;
  const valueText = (id, value) => { const knob = NexoLab.knob(id); return knob ? NexoLab.valueLabel(knob, value) : String(value); };

  function setRisk(on) {
    Nexo.state.labRunning = on;
    document.body.classList.toggle('risk-session', on);
    document.getElementById('risk-banner').hidden = !on;
    if (on) setAppStatus('Laboratório medindo');
    Promise.resolve(bridge?.updatePresence?.(on ? { kind: 'lab' } : null)).catch(() => {});
  }

  /* ---------- Espaço de ajustes e histórico ---------- */
  function renderKnobs() {
    const { evidence, tabu } = memory();
    const list = space.length ? space : NexoLab.spaceFor(Nexo.platform === 'linux' ? 'linux' : 'win32');
    // Depois de "Só conferir", os números passam a ser os deste PC (o que o powercfg aceita, sem núcleos híbridos se não houver).
    const support = lastPre?.knobs ? Object.fromEntries(Object.entries(lastPre.knobs).filter(([, info]) => info.available)) : null;
    const baseline = support ? Object.fromEntries(Object.entries(support).map(([id, info]) => [id, info.current])) : null;
    const stats = NexoLab.spaceStats({ allowRisk: 'alto', platform: Nexo.platform === 'linux' ? 'linux' : 'win32', support, baseline, hybrid: lastPre ? lastPre.hybrid : null });
    const testedArms = Object.entries(evidence).filter(([key, item]) => !key.startsWith('combo:') && item?.n).length;
    const testedCombos = Object.entries(evidence).filter(([key, item]) => key.startsWith('combo:') && item?.n).length;
    const statsBox = document.getElementById('lab-space-stats');
    if (statsBox) statsBox.innerHTML = `<div><strong>${stats.knobs}</strong><span>ajustes${support ? ' neste PC' : ''}</span></div><div><strong>${stats.options}</strong><span>opções${support ? ' neste PC' : ''}</span></div><div><strong>10<sup>${String(Math.floor(stats.log10))}</sup></strong><span>combinações possíveis</span></div><div><strong>${testedArms + testedCombos}</strong><span>testadas neste PC</span></div>`;
    const groups = new Map();
    for (const knob of list) { const id = knob.group || 'desempenho'; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(knob); }
    document.getElementById('lab-knobs').innerHTML = [...groups].map(([groupId, knobs]) => {
      const info = NexoLab.GROUPS?.[groupId] || { label: groupId, hint: '' };
      // Depois da conferência: o que este PC não tem (ou não usa) aparece apagado e não conta nas opções.
      const usable = (knob) => !lastPre?.knobs || (lastPre.knobs[knob.id]?.available && !(knob.hybrid && lastPre.hybrid === false));
      const optionCount = knobs.filter(usable).reduce((sum, knob) => sum + NexoLab.supportedValues(knob, lastPre?.knobs?.[knob.id]).length, 0);
      const missing = knobs.filter((knob) => !usable(knob)).length;
      const tested = knobs.reduce((sum, knob) => sum + Object.keys(evidence).filter((key) => key.startsWith(`${knob.id}=`)).length, 0);
      return `<details class="knob-group"><summary><strong>${escapeHtml(info.label)}</strong><span class="muted">${knobs.length - missing} ajustes · ${optionCount} opções${missing ? ` · ${missing} não valem neste PC` : ''}${tested ? ` · ${tested} testadas` : ''}</span></summary><p class="muted">${escapeHtml(info.hint || '')}</p><ul class="knobs">${knobs.map((knob) => {
        const testedValues = Object.entries(evidence).filter(([key]) => key.startsWith(`${knob.id}=`));
        const blocked = tabu.filter((key) => key.startsWith(`${knob.id}=`));
        const [best] = testedValues.filter(([, item]) => item.wins).sort((x, y) => y[1].mean - x[1].mean);
        const riskTone = knob.risk === 'alto' ? 'risk-alto' : knob.risk === 'moderado' ? 'risk-moderado' : 'risk-baixo';
        const benches = (knob.affects || []).map((bench) => BENCH_SHORT[bench]).filter(Boolean).join(', ');
        return `<li class="${usable(knob) ? '' : 'knob-missing'}"><div><strong>${escapeHtml(knob.label)}</strong><span class="muted">${escapeHtml(knob.what)}</span></div>
          <div class="chips-row"><span class="chip ${riskTone}">risco ${knob.risk}</span><span class="chip">${NOVELTY[knob.novelty] || knob.novelty}</span>${knob.hidden ? '<span class="chip">oculto no Windows</span>' : ''}${knob.hybrid ? '<span class="chip">só processadores P/E</span>' : ''}${!usable(knob) ? `<span class="chip">${lastPre.knobs[knob.id]?.available ? 'este processador não tem núcleos P/E' : 'não existe neste PC'}</span>` : ''}${benches ? `<span class="chip">medido por: ${escapeHtml(benches)}</span>` : ''}
          <span class="chip">${testedValues.length}/${knob.values.length} valores testados</span>${best ? `<span class="chip risk-baixo">melhor: ${escapeHtml(valueText(knob.id, Number(best[0].split('=')[1])))} (${signed(best[1].mean)})</span>` : ''}${blocked.length ? `<span class="chip risk-alto">${blocked.length} bloqueado(s) por guarda</span>` : ''}</div></li>`;
      }).join('')}</ul></details>`;
    }).join('');
  }

  function renderHistory() {
    const { runs } = memory();
    const box = document.getElementById('lab-history');
    box.innerHTML = runs.length ? runs.map((run) => `<li class="risk-run"><span class="badge risk sm">RISCO</span><div><strong>${escapeHtml(run.headline)}</strong><span class="muted">${when(run.at)} · ${run.arms} ideia(s)${run.combos ? ` e ${run.combos} combinação(ões) inédita(s)` : ''} testada(s) · modo ${run.autonomy === 'autonomo' ? 'autônomo' : 'assistido'}${run.adopted ? ' · adotado' : ''}</span></div>${verdictChip(run.verdict)}</li>`).join('')
      : '<li class="empty">Nenhuma sessão de risco ainda.</li>';
  }

  /* ---------- Formulário ---------- */
  function updateForm() {
    const ack = document.getElementById('lab-ack').checked;
    const phrase = document.getElementById('lab-phrase').value.trim().toUpperCase() === NexoLab.CONSENT_PHRASE;
    document.getElementById('lab-start').disabled = !(ack && phrase) || Nexo.state.labRunning;
    setText('lab-autonomy-note', options.autonomy === 'autonomo' ? 'Testa, confirma e ADOTA sozinho a combinação que provar ganho (vira um plano novo, reversível pelo Diário).' : 'Testa e recomenda. Você decide o que adotar.');
    setText('lab-goal-note', GOAL_NOTE[options.goal] || '');
    setText('lab-risk-note', options.allowRisk === 'alto' ? 'Inclui o processador que nunca dorme: bem mais calor e consumo. As guardas de temperatura continuam valendo.' : options.allowRisk === 'baixo' ? 'Só ajustes de risco baixo.' : '');
    setText('lab-estimate', `Leva cerca de ${estimateMinutes()} minutos (limite: ${options.budgetMin >= 120 ? '2 h' : `${options.budgetMin} min`}).`);
  }
  /** Estimativa: triagem de 2 pares por ideia (um terço ganha mais pares), combinações com 3 e a confirmação com 5. */
  function estimateMinutes() {
    const side = (benches) => 1.5 + benches * 1.4;
    const seconds = 40 + options.maxArms * (2 * 2 * side(2.4)) * 1.3 + options.combos * (3 * 2 * side(3)) + 5 * 2 * side(3);
    return Math.max(3, Math.min(options.budgetMin, Math.round(seconds / 60)));
  }
  function formError(message) { const box = document.getElementById('lab-form-error'); box.textContent = message || ''; box.hidden = !message; }

  function bindSegment(attr, key, cast = (value) => value) {
    document.querySelectorAll(`[data-${attr}]`).forEach((button) => button.addEventListener('click', () => {
      options[key] = cast(button.dataset[attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]);
      document.querySelectorAll(`[data-${attr}]`).forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      updateForm();
    }));
  }

  async function check() {
    formError('');
    try {
      const pre = await bridge.labPreflight();
      // Ajustes de núcleos híbridos (P/E) existem no plano de qualquer PC, mas só valem com núcleos híbridos.
      const hybridOnly = NexoLab.SPACE.filter((knob) => knob.hybrid && pre.knobs?.[knob.id]?.available).length;
      const available = Object.entries(pre.knobs || {}).filter(([id, knob]) => knob.available && !(pre.hybrid === false && NexoLab.knob(id)?.hybrid)).length;
      lastPre = pre;
      renderKnobs();
      const lines = [
        [['win32', 'linux'].includes(pre.platform), 'Sistema compatível', pre.platform === 'linux' ? 'Linux (perfis de energia)' : pre.platform === 'win32' ? 'Windows' : 'o laboratório roda no Windows e no Linux'],
        [!pre.onBattery, 'Na tomada', pre.onBattery ? 'ligue o carregador' : 'ok'],
        [Number.isFinite(pre.tempC) && pre.tempC < 80, 'Temperatura do processador', Number.isFinite(pre.tempC) ? `${Math.round(pre.tempC)} °C` : 'sem leitura (sem ela, não roda)'],
        [!(pre.cpuLoad >= 50), 'Processador livre', Number.isFinite(pre.cpuLoad) ? `${Math.round(pre.cpuLoad)}% ocupado` : '?'],
        [available > 0, 'Ajustes disponíveis', `${available} de ${NexoLab.SPACE.length}${pre.hybrid === false && hybridOnly ? ` (${hybridOnly} são só para núcleos híbridos P/E)` : ''}`],
        [!pre.pending, 'Sem teste pendente', pre.pending ? 'recupere o anterior primeiro' : 'ok']
      ];
      Nexo.dialog({ title: 'Dá para rodar agora?', html: `<ul class="checks">${lines.map(([ok, label, detail]) => `<li class="${ok ? 'ok' : 'no'}"><b>${ok ? '✓' : '✕'}</b><span>${escapeHtml(label)}</span><small>${escapeHtml(detail)}</small></li>`).join('')}</ul>`, actions: [{ id: 'ok', label: 'Fechar', tone: 'primary' }] });
    } catch (error) { formError(error.message || 'Não consegui conferir.'); }
  }

  /* ---------- Execução ao vivo ---------- */
  function renderSteps(current) {
    const index = STAGES.findIndex(([id]) => id === current);
    document.getElementById('lab-steps').innerHTML = STAGES.map(([id, label], i) => `<li class="${i < index ? 'done' : i === index ? 'now' : ''}"><i></i>${label}</li>`).join('');
  }
  function renderArms() {
    document.getElementById('lab-arms').innerHTML = live.arms.length ? `<table class="exp"><thead><tr><th>Ideia</th><th>De → para</th><th>Ganho</th><th>Temp.</th><th>Veredito</th></tr></thead><tbody>${live.arms.map((arm) => `<tr><td>${escapeHtml(arm.label)} <span class="chip">${NOVELTY[arm.novelty] || ''}</span></td><td>${escapeHtml(arm.fromLabel)} → ${escapeHtml(arm.valueLabel)}</td><td>${signed(arm.compositeDelta)}</td><td class="nowrap">${temp(arm.tempDelta)}</td><td>${verdictChip(arm.verdict)}</td></tr>`).join('')}</tbody></table>` : '';
  }
  function onEvent(event) {
    if (!live) return;
    if (event.type === 'stage') {
      renderSteps(event.stage);
      setText('lab-run-title', STAGES.find(([id]) => id === event.stage)?.[1] || 'Concluindo');
      setText('lab-run-detail', event.detail || '');
      if (event.stage === 'testar') live.armIndex += 1;
    }
    if (event.type === 'log') {
      const item = document.createElement('li');
      item.innerHTML = `<time>${new Date(event.t).toLocaleTimeString('pt-BR')}</time><span>${escapeHtml(event.message)}</span>`;
      document.getElementById('lab-log').prepend(item);
      const match = /Ideias escolhidas para hoje: (.*)\./.exec(event.message);
      if (match) live.totalArms = match[1].split(';').length;
    }
    if (event.type === 'stage' && event.stage === 'combinar') live.comboIndex += 1;
    if (event.type === 'stage' && event.stage === 'confirmar') live.confirmIndex += 1;
    if (event.type === 'trial') {
      const total = Math.max(1, live.totalArms + options.combos + 1);
      const step = event.pair / event.pairs;
      const done = live.confirmIndex ? live.totalArms + options.combos + Math.min(1, step) : live.comboIndex ? live.totalArms + live.comboIndex - 1 + step : Math.max(0, live.armIndex - 1) + step;
      document.getElementById('lab-progress').style.width = `${Math.min(100, (done / total) * 100).toFixed(1)}%`;
    }
    if (event.type === 'arm') { live.arms.push(event.arm); renderArms(); }
    if (event.type === 'combo') { live.arms.push({ label: 'Combinação inédita', fromLabel: 'original', valueLabel: event.combo.label, novelty: 'inedito-aqui', compositeDelta: event.combo.compositeDelta, tempDelta: event.combo.tempDelta, verdict: event.combo.verdict }); renderArms(); }
  }

  async function startRun() {
    formError('');
    const consent = { acknowledged: document.getElementById('lab-ack').checked, phrase: document.getElementById('lab-phrase').value };
    if (Nexo.sessions?.isRecording?.()) { formError('Pare a sessão de observação antes: as duas medições se atrapalhariam.'); return; }
    const final = await Nexo.confirm({ title: 'Começar a sessão de risco?', body: 'O Nexo vai testar ajustes sozinho por alguns minutos. Não use o PC pesado enquanto isso. Você pode cancelar a qualquer momento e tudo volta ao original.', items: [`Autonomia: ${options.autonomy === 'autonomo' ? 'autônoma (adota sozinho o que for confirmado)' : 'assistida (só recomenda)'}`, `Objetivo: ${NexoLab.GOALS?.[options.goal]?.label || options.goal}`, `Risco permitido: ${options.allowRisk === 'baixo' ? 'só baixo' : options.allowRisk === 'alto' ? 'TUDO, inclusive alto' : 'até moderado'}`, `Ideias: ${options.maxArms} · combinações inéditas: ${options.combos}${document.getElementById('lab-wild').checked ? ' (exploração radical)' : ''} · limite de ${options.budgetMin >= 120 ? '2 h' : `${options.budgetMin} min`}`, document.getElementById('lab-restore').checked ? 'Ponto de restauração: exigido (o Windows vai pedir permissão)' : 'Ponto de restauração: dispensado por você'], confirmLabel: 'Começar', tone: 'danger' });
    if (!final) return;
    const mem = memory();
    live = { arms: [], armIndex: 0, comboIndex: 0, confirmIndex: 0, totalArms: options.maxArms };
    setRisk(true);
    document.getElementById('lab-form').hidden = true;
    document.getElementById('lab-result').hidden = true;
    document.getElementById('lab-run').hidden = false;
    document.getElementById('lab-log').replaceChildren();
    document.getElementById('lab-arms').replaceChildren();
    document.getElementById('lab-progress').style.width = '0%';
    renderSteps('preflight');
    let result = null;
    try {
      result = await bridge.runLab({ ...options, wild: document.getElementById('lab-wild').checked, consent, requireRestorePoint: document.getElementById('lab-restore').checked, evidence: mem.evidence, tabu: mem.tabu });
    } catch (error) {
      result = { status: 'aborted', reason: error.message || 'Falha inesperada.', arms: [], combos: [], log: [], riskSession: true, startedAt: Date.now(), evidence: mem.evidence, tabu: mem.tabu };
    } finally { setRisk(false); setAppStatus('Monitoramento ativo'); }
    finishRun(result, mem);
  }

  function headlineOf(result) {
    if (result.restoreFailed) return 'Não consegui voltar ao plano original';
    if (result.status === 'cancelled') return 'Cancelado por você; tudo voltou ao original';
    if (result.status === 'aborted') return `Interrompido: ${result.reason || 'motivo desconhecido'}`;
    if (result.combination?.verdict === 'melhorou') return `Ganho real confirmado: ${signed(result.combination.compositeDelta)}`;
    if (result.arms.some((arm) => arm.verdict === 'melhorou')) return 'Houve sinal de ganho, mas a confirmação não sustentou';
    return 'Nada mudou acima do ruído neste PC';
  }

  function finishRun(result, mem) {
    live = null;
    result.combos = Array.isArray(result.combos) ? result.combos : [];
    const runs = [{ at: result.startedAt || Date.now(), headline: headlineOf(result), verdict: result.combination?.verdict || (result.status === 'completed' ? 'sem-diferenca' : 'inconclusivo'), arms: result.arms.length, combos: result.combos.length, autonomy: result.autonomy, adopted: Boolean(result.adopted) }, ...mem.runs];
    saveMemory({ evidence: result.evidence || mem.evidence, tabu: result.tabu || mem.tabu, runs });
    const tested = [...result.arms.map((arm) => `${arm.label}: ${arm.fromLabel} → ${arm.valueLabel} (${VERDICT[arm.verdict]?.[0] || arm.verdict}${Number.isFinite(arm.compositeDelta) ? `, ${signed(arm.compositeDelta)}` : ''})`),
      ...result.combos.map((combo) => `combinação inédita ${combo.label} (${VERDICT[combo.verdict]?.[0] || combo.verdict}${Number.isFinite(combo.compositeDelta) ? `, ${signed(combo.compositeDelta)}` : ''})`)];
    if (result.status !== 'aborted' || result.arms.length || result.restorePoint) {
      Nexo.journal.record({ actionId: 'lab-session', title: 'Sessão de risco do laboratório', risk: 'moderado', reversible: false, riskSession: true, status: result.restoreFailed ? 'failed' : 'applied',
        authorization: 'consentimento reforçado (frase digitada) na Otimização extrema', before: result.baseline, after: result.adopted ? result.adopted.config : null,
        detail: `${headlineOf(result)}. ${tested.length ? `Testado: ${tested.join('; ')}.` : ''} ${result.restoreFailed ? 'A restauração falhou; o Nexo tenta de novo na próxima abertura.' : 'Plano original restaurado ao fim.'}` });
    }
    if (result.adopted) {
      Nexo.journal.record({ actionId: 'power-plan-switch', title: 'Plano ajustado pelo laboratório (modo autônomo)', risk: 'moderado', reversible: true, riskSession: true, authorization: 'modo autônomo do laboratório, com consentimento reforçado', before: result.adopted.before, after: { guid: result.adopted.guid, name: result.adopted.name } });
      Nexo.loadPower?.();
    }
    Nexo.emit('journal');
    recordActivity('Sessão de risco (laboratório)', headlineOf(result));
    document.getElementById('lab-run').hidden = true;
    const box = document.getElementById('lab-result');
    const combo = result.combination;
    const canAdopt = result.status === 'completed' && !result.adopted && combo?.verdict === 'melhorou';
    box.innerHTML = `<div class="sheet-head"><div><span class="badge risk">SESSÃO DE RISCO · ${when(result.startedAt || Date.now())}</span><h3>${escapeHtml(headlineOf(result))}</h3>
        <p class="muted">${result.restoreFailed ? 'ATENÇÃO: use "Recuperar agora". Se não der, o Nexo tenta de novo ao abrir, e há um ponto de restauração do Windows.' : result.adopted ? `Adotado como o plano “${escapeHtml(result.adopted.name)}”. Para desfazer, use “Reverter” no Diário (Atividade).` : 'O seu plano original está ativo de novo.'}</p></div></div>
      ${resultTable(result.arms.map((arm) => ({ name: arm.label, change: `${arm.fromLabel} → ${arm.valueLabel}`, ...arm })), 'Ideia')}
      ${result.combos.length ? `<h4 class="lab-subhead">Combinações inéditas (${result.combos.length})</h4>${resultTable(result.combos.map((combo) => ({ name: combo.wild ? 'Exploração radical' : 'Combinação', change: combo.label, ...combo })), 'Tipo')}` : ''}
      ${combo ? `<div class="combo"><strong>Combinação testada de novo (${combo.replicates} pares):</strong> ${combo.knobs.map((key) => { const [id, value] = key.split('='); return escapeHtml(`${knobLabel(id)} → ${valueText(id, Number(value))}`); }).join(' + ')} · ${verdictChip(combo.verdict)} ${signed(combo.compositeDelta)}</div>` : ''}
      <details class="lab-details"><summary>Registro completo (${result.log?.length || 0} linhas)</summary><ol class="lab-log">${(result.log || []).map((line) => `<li><time>${new Date(line.t).toLocaleTimeString('pt-BR')}</time><span>${escapeHtml(line.message)}</span></li>`).join('')}</ol></details>
      <p class="muted">Como ler: o ganho é a mediana das comparações intercaladas; ± é o ruído medido na base. Só vira “melhorou” acima de 3% e de 1,5× o ruído, com a maioria dos pares concordando.</p>
      <div class="btn-row">${canAdopt ? '<button class="btn primary" type="button" id="lab-adopt">Adotar esta combinação</button>' : ''}${result.restoreFailed ? '<button class="btn danger" type="button" id="lab-recover-now">Recuperar agora</button>' : ''}<button class="btn" type="button" id="lab-again">Nova sessão</button></div>`;
    box.hidden = false;
    document.querySelector('.lab-split')?.classList.add('wide-result'); // a tabela precisa da largura toda
    document.getElementById('lab-again').addEventListener('click', resetForm);
    document.getElementById('lab-recover-now')?.addEventListener('click', recover);
    document.getElementById('lab-adopt')?.addEventListener('click', async () => {
      const ok = await Nexo.confirm({ title: 'Adotar a combinação?', body: 'O Nexo cria um plano novo, a partir do plano ativo, com estes ajustes, e o ativa. O plano atual não é editado; para voltar, use “Reverter” no Diário.', confirmLabel: 'Adotar' });
      if (!ok) return;
      try {
        await Nexo.loadPower?.();
        const adopted = await bridge.adoptLab(combo.config);
        Nexo.journal.record({ actionId: 'power-plan-switch', title: 'Plano ajustado pelo laboratório', risk: 'moderado', reversible: true, riskSession: true, authorization: 'confirmação na interface depois da sessão de risco', before: adopted.before, after: { guid: adopted.guid, name: adopted.name } });
        Nexo.emit('journal');
        Nexo.loadPower?.();
        showToast(`Plano “${adopted.name}” ativo.`);
        document.getElementById('lab-adopt').remove();
      } catch (error) { showToast(error.message || 'Não foi possível adotar.'); }
    });
    renderKnobs();
    renderHistory();
  }

  /** Tabela de resultados com uma coluna por teste usado na sessão (1 núcleo, todos, rajadas, latência, disco). */
  function resultTable(rows, firstColumn) {
    if (!rows.length) return '';
    const benches = NexoLab.BENCHES.filter((bench) => rows.some((row) => row.results?.[bench]));
    // Melhores primeiro: o que ganhou aparece no topo, o inconclusivo no fim.
    const order = { melhorou: 0, misto: 1, 'sem-diferenca': 2, piorou: 3, inconclusivo: 4 };
    rows = [...rows].sort((a, b) => (order[a.verdict] ?? 5) - (order[b.verdict] ?? 5) || (b.compositeDelta ?? -99) - (a.compositeDelta ?? -99));
    return `<div class="table-scroll"><table class="exp"><thead><tr><th>${firstColumn}</th><th>De → para</th>${benches.map((bench) => `<th>${BENCH_SHORT[bench]}</th>`).join('')}<th>Ganho (${escapeHtml(NexoLab.GOALS?.[options.goal]?.label || 'composto')})</th><th>Temp.</th><th>Veredito</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.change)}</td>${benches.map((bench) => `<td>${row.results?.[bench] ? `${signed(row.results[bench].deltaPct)}<small> ±${(row.results[bench].noisePct ?? 0).toFixed(1).replace('.', ',')}</small>` : '—'}</td>`).join('')}<td>${signed(row.compositeDelta)}</td><td class="nowrap">${temp(row.tempDelta)}</td><td>${verdictChip(row.verdict)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function resetForm() {
    document.querySelector('.lab-split')?.classList.remove('wide-result');
    document.getElementById('lab-result').hidden = true;
    document.getElementById('lab-run').hidden = true;
    document.getElementById('lab-form').hidden = false;
    document.getElementById('lab-phrase').value = '';
    document.getElementById('lab-ack').checked = false;
    updateForm();
  }

  async function recover() {
    try {
      const result = await bridge.recoverLab();
      showToast(result.recovered ? 'Pronto: o plano original está ativo de novo.' : 'Não havia teste pendente.');
      Nexo.loadPower?.();
      refreshStatus();
    } catch (error) { showToast(error.message || 'Não foi possível recuperar.'); }
  }

  async function refreshStatus() {
    if (!bridge?.getLabStatus) return;
    try {
      const status = await bridge.getLabStatus();
      space = status.space || [];
      renderKnobs();
      if (status.pending && !Nexo.state.labRunning) formError('Um teste anterior não terminou direito. Recupere antes de começar outro.');
      const button = document.getElementById('lab-recover-pending');
      if (status.pending && !button) {
        const recoverButton = document.createElement('button');
        recoverButton.className = 'btn sm danger'; recoverButton.type = 'button'; recoverButton.id = 'lab-recover-pending'; recoverButton.textContent = 'Recuperar agora';
        recoverButton.addEventListener('click', recover);
        document.querySelector('#lab-form .btn-row').append(recoverButton);
      } else if (!status.pending && button) button.remove();
    } catch { /* fora do app desktop */ }
  }

  bindSegment('lab-autonomy', 'autonomy');
  bindSegment('lab-risk', 'allowRisk');
  bindSegment('lab-arms', 'maxArms', Number);
  bindSegment('lab-goal', 'goal');
  bindSegment('lab-combos', 'combos', Number);
  bindSegment('lab-budget', 'budgetMin', Number);
  document.getElementById('lab-ack').addEventListener('change', updateForm);
  document.getElementById('lab-phrase').addEventListener('input', updateForm);
  document.getElementById('lab-start').addEventListener('click', startRun);
  document.getElementById('lab-check').addEventListener('click', check);
  document.getElementById('lab-cancel').addEventListener('click', async () => { setText('lab-run-detail', 'Cancelando e restaurando…'); await bridge.cancelLab(); });
  document.getElementById('lab-forget').addEventListener('click', async () => {
    if (!await Nexo.confirm({ title: 'Esquecer o que o laboratório aprendeu?', body: 'A evidência por ajuste, os bloqueios por guarda e o histórico de sessões de risco serão apagados. Planos adotados continuam (reverta pelo Diário).', confirmLabel: 'Esquecer', tone: 'danger' })) return;
    saveMemory({ evidence: {}, tabu: [], runs: [] });
    renderKnobs(); renderHistory();
    showToast('Aprendizado do laboratório apagado.');
  });
  bridge?.onLabEvent?.(onEvent);
  bridge?.onLabRecovered?.((info) => {
    Nexo.journal.record({ actionId: 'lab-session', title: 'Recuperação automática do laboratório', risk: 'moderado', riskSession: true, detail: `Um teste de ${info.startedAt ? when(info.startedAt) : 'antes'} não terminou; o Nexo voltou ao plano ${info.originalName || 'original'} ao abrir.`, authorization: 'automática (trava de segurança)' });
    Nexo.emit('journal');
    showToast('O Nexo encontrou um teste interrompido e voltou ao seu plano original.');
  });
  Nexo.on('view', (view) => { if (view === 'lab') { refreshStatus(); renderHistory(); } });
  Nexo.commands.push({ label: 'Abrir a Otimização extrema (beta)', hint: 'Laboratório', run: () => Nexo.go('lab') });
  renderKnobs();
  renderHistory();
  updateForm();
})();
