/* Experimento A/B do plano de energia: medir, trocar, medir de novo, comparar com o ruído e decidir. */
(function () {
  const REPS = 3;
  const BENCH_MS = 1200;
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const num = (value) => (Number.isFinite(value) ? value.toFixed(1).replace('.', ',') : '--');
  const signed = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%` : '--');
  const CANCELLED = Symbol('cancelado');

  function overall(single, multi) {
    const verdicts = [single.verdict, multi.verdict];
    if (verdicts.includes('melhorou') && verdicts.includes('piorou')) return 'misto';
    if (verdicts.includes('piorou')) return 'piorou';
    if (verdicts.includes('melhorou')) return 'melhorou';
    if (verdicts.every((verdict) => verdict === 'sem-diferenca')) return 'sem-diferenca';
    return 'inconclusivo';
  }

  const VERDICT_TEXT = {
    melhorou: 'O novo plano ficou mais rápido neste teste. O custo costuma ser mais consumo de energia e calor.',
    piorou: 'O novo plano ficou mais lento neste teste. Voltar ao plano anterior é o mais indicado.',
    misto: 'Resultado misto: um tipo de carga melhorou e o outro piorou. Escolha conforme o seu uso.',
    'sem-diferenca': 'Neste PC, a diferença ficou dentro do ruído da medição: o plano não muda a velocidade bruta do processador de forma mensurável. Escolha pelo consumo de energia.',
    inconclusivo: 'Não foi possível concluir. Feche outros programas e repita o teste.'
  };

  async function precheck() {
    const source = await desktopBridge.getPowerSource().catch(() => ({ onBattery: false }));
    const cpu = Nexo.state.snapshot?.cpuUsage;
    const temp = Nexo.store.hottest(Nexo.store.live().slice(-1)[0] || {});
    const blockers = [];
    if (Number.isFinite(cpu) && cpu >= 80) blockers.push(`O processador está em ${Math.round(cpu)}% agora. Espere a carga baixar ou feche o programa que está usando o PC.`);
    if (Number.isFinite(temp) && temp >= 88) blockers.push(`A temperatura está em ${Math.round(temp)} °C. O Nexo não executa testes de carga com o computador quente.`);
    return { blockers, warnings: NexoExperiment.contextWarnings({ onBattery: source.onBattery, cpuBefore: cpu }), temp };
  }

  async function runPhase(label, ctx) {
    ctx.detail = `${label}: aquecendo os núcleos`; ctx.render();
    await desktopBridge.runCpuBench({ mode: 'single', ms: 400 });
    const single = [];
    const multi = [];
    for (let i = 0; i < REPS; i += 1) {
      ctx.check(); ctx.detail = `${label}: um núcleo, repetição ${i + 1} de ${REPS}`; ctx.render();
      // eslint-disable-next-line no-await-in-loop -- uma medição por vez: duas ao mesmo tempo disputariam o processador
      single.push((await desktopBridge.runCpuBench({ mode: 'single', ms: BENCH_MS })).mopsPerSec);
    }
    for (let i = 0; i < REPS; i += 1) {
      ctx.check(); ctx.detail = `${label}: vários núcleos, repetição ${i + 1} de ${REPS}`; ctx.render();
      // eslint-disable-next-line no-await-in-loop -- uma medição por vez: duas ao mesmo tempo disputariam o processador
      multi.push((await desktopBridge.runCpuBench({ mode: 'multi', ms: BENCH_MS })).mopsPerSec);
    }
    return { single, multi, temp: Nexo.store.hottest(Nexo.store.live().slice(-1)[0] || {}) };
  }

  function resultHtml(current, target, a, b, single, multi, verdict, warnings) {
    const row = (name, before, after, cmp) => `<tr><th>${name}</th><td>${num(cmp.a.median)}</td><td>${num(cmp.b.median)}</td><td class="delta ${cmp.verdict}">${signed(cmp.deltaPct)}</td><td>±${num(cmp.noisePct)}%</td></tr>`;
    return `<table class="exp"><thead><tr><th></th><th>${escapeHtml(current.name)}</th><th>${escapeHtml(target.name)}</th><th>Mudança</th><th>Ruído</th></tr></thead>
      <tbody>${row('Um núcleo', a.single, b.single, single)}${row('Vários núcleos', a.multi, b.multi, multi)}</tbody></table>
      <p class="verdict v-${verdict}">${VERDICT_TEXT[verdict]}</p>
      ${[...warnings, ...single.notes, ...multi.notes].length ? `<ul class="notes">${[...new Set([...warnings, ...single.notes, ...multi.notes])].map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : ''}
      <p class="muted">Valores em milhões de operações por segundo (Mops/s) de uma carga sintética de inteiros, mediana de ${REPS} repetições. Mede velocidade bruta de CPU: não mede FPS, jogos nem tempo de abertura de programas.</p>`;
  }

  /** Fluxo completo: pré-checagem, confirmação, A, troca, B, comparação, decisão. */
  Nexo.experimentPowerPlan = async function experimentPowerPlan(target) {
    const current = Nexo.state.power?.active;
    if (!current || !target || current.guid === target.guid) return;
    if (!desktopBridge?.runCpuBench) { showToast('O experimento está disponível no aplicativo desktop.'); return; }

    const check = await precheck();
    if (check.blockers.length) {
      await Nexo.dialog({ title: 'Agora não é um bom momento para medir', html: `<ul class="notes">${check.blockers.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`, actions: [{ id: 'ok', label: 'Entendi', tone: 'primary' }] }).done;
      return;
    }
    const answer = await Nexo.dialog({
      title: `Medir “${target.name}” contra “${current.name}”?`, wide: true,
      html: `<p>O Nexo vai medir a velocidade do processador com o plano atual, trocar para o novo plano, medir de novo e comparar com o ruído da medição.</p>
        <ul><li>Dura cerca de <strong>20 segundos</strong>, com o processador em carga máxima. O computador pode ficar lento nesse intervalo.</li>
        <li>Você pode cancelar a qualquer momento. Se cancelar depois da troca, o plano anterior volta sozinho.</li>
        <li>No fim, você escolhe manter o novo plano ou voltar. A troca fica registrada no Diário de alterações.</li></ul>
        ${check.warnings.length ? `<ul class="notes">${check.warnings.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : ''}`,
      actions: [{ id: 'no', label: 'Cancelar' }, { id: 'go', label: 'Iniciar o teste', tone: 'primary' }]
    }).done;
    if (answer !== 'go') return;

    let cancelled = false;
    let entry = null;
    const steps = [`Medir o plano atual (${current.name})`, `Trocar para ${target.name}`, `Medir o novo plano`, 'Comparar com o ruído'].map((label) => ({ label, state: 'pending' }));
    const ctx = { detail: '', render: null, check() { if (cancelled) throw CANCELLED; } };
    const dialog = Nexo.dialog({
      title: 'Experimento em andamento', wide: true, dismissible: false, html: '',
      actions: [{ id: 'cancel', label: 'Cancelar teste', keepOpen: true, onClick: () => { cancelled = true; desktopBridge.cancelCpuBench(); } }]
    });
    ctx.render = () => dialog.setBody(`<ol class="steps">${steps.map((step) => `<li data-state="${step.state}">${escapeHtml(step.label)}</li>`).join('')}</ol><p class="muted" aria-live="polite">${escapeHtml(ctx.detail)}</p>`);
    const mark = (index, state) => { steps[index].state = state; ctx.render(); };

    try {
      mark(0, 'running');
      const a = await runPhase('Plano atual', ctx);
      mark(0, 'done'); ctx.check();

      mark(1, 'running'); ctx.detail = 'Trocando o plano de energia…'; ctx.render();
      entry = await Nexo.switchPowerPlan(target, { notify: false });
      mark(1, 'done');
      ctx.detail = 'Deixando o processador estabilizar…'; ctx.render();
      await sleep(2500); ctx.check();

      mark(2, 'running');
      const b = await runPhase('Plano novo', ctx);
      mark(2, 'done');

      mark(3, 'running');
      const single = NexoExperiment.compare(a.single, b.single);
      const multi = NexoExperiment.compare(a.multi, b.multi);
      const verdict = overall(single, multi);
      const warnings = NexoExperiment.contextWarnings({ tempBefore: a.temp, tempAfter: b.temp, cpuBefore: Nexo.state.snapshot?.cpuUsage });
      const pick = (c) => ({ deltaPct: c.deltaPct, noisePct: c.noisePct, verdict: c.verdict, confidence: c.confidence });
      Nexo.journal.attachMeasurement(entry.id, { at: Date.now(), reps: REPS, benchMs: BENCH_MS, verdict, single: pick(single), multi: pick(multi) });
      Nexo.emit('journal');
      mark(3, 'done');

      dialog.close('measured');
      const keepFirst = verdict === 'melhorou';
      const decision = await Nexo.dialog({
        title: 'Resultado do experimento', wide: true, dismissible: false,
        html: resultHtml(current, target, a, b, single, multi, verdict, warnings),
        actions: [{ id: 'revert', label: `Voltar para ${current.name}`, tone: keepFirst ? '' : 'primary' }, { id: 'keep', label: `Manter ${target.name}`, tone: keepFirst ? 'primary' : '' }]
      }).done;
      if (decision === 'revert') await Nexo.revertJournal(entry.id);
      else showToast(`Mantido: ${target.name}. Você pode reverter a qualquer momento em Atividade.`);
      recordActivity('Experimento de energia', `${target.name}: ${verdict.replace('-', ' ')}`);
    } catch (error) {
      dialog.close('error');
      if (entry) {
        const reverted = await Nexo.revertJournal(entry.id);
        showToast(error === CANCELLED ? (reverted ? `Teste cancelado. O plano ${current.name} foi restaurado.` : 'Teste cancelado. Confira o plano de energia em Otimizar.') : (error.message || 'O experimento não pôde ser concluído.'));
      } else showToast(error === CANCELLED ? 'Teste cancelado. Nada foi alterado.' : (error.message || 'O experimento não pôde ser concluído.'));
    }
  };
})();
