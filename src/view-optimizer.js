/*
 * "Otimizar este PC" na tela, dentro da Análise: o plano que saiu da análise (com o jogo escolhido), a execução com a
 * constelação reagindo (cada estrela carrega enquanto a parte dela é ajustada e acende mais forte quando termina; no
 * fim, um cometa atravessa a carta) e o antes e depois. O plano e a execução ficam no processo principal
 * (src/optimizer.js + electron/optimizer-system.cjs); aqui só desenha e repassa o que a pessoa marcou.
 */
(function () {
  const bridge = desktopBridge;
  const box = document.getElementById('deep-opt');
  if (!box || !window.NexoOptimizer) return;
  const Opt = NexoOptimizer;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const calm = () => reduce.matches || Nexo.effectsLite;
  const LAST_KEY = 'nexo-otimizacao-ultima';
  const STAGES = [
    { id: 'preparar', label: 'Preparar' }, { id: 'antes', label: 'Medir antes' }, { id: 'aplicar', label: 'Aplicar' },
    { id: 'laboratorio', label: 'Laboratório' }, { id: 'depois', label: 'Medir depois' }, { id: 'conferir', label: 'Conferir' }
  ];
  const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage.id, index]));
  const STATUS = { feito: ['Feito', 'ok'], falhou: ['Não aplicado', 'bad'], desfeito: ['Desfeito: piorou', 'warn'], 'sem-ganho': ['Sem ganho; ficou como estava', 'muted'], rodando: ['Rodando', 'live'] };
  const RISK = { baixo: 'risco baixo', moderado: 'risco moderado', alto: 'risco alto' };
  const state = { plan: null, games: [], game: '', allowRisk: 'moderado', picked: new Set(), loading: false, running: false, result: null, live: null, error: null };

  const ico = (id) => `<svg class="deep-ico" aria-hidden="true"><use href="#${id}"/></svg>`;
  const esc = (value) => escapeHtml(String(value ?? ''));
  const nodeOf = (step) => step.node || Opt.CATEGORY.get(step.category)?.node || 'windows';
  const pct = (value) => `${value > 0 ? '+' : ''}${Number(value).toFixed(1).replace('.', ',')}%`;
  const num = (value, digits = 1) => Number(value).toFixed(digits).replace('.', ',');

  /* ---------------- Plano ---------------- */
  async function open() {
    if (!bridge?.planOptimization) { showToast('A otimização automática funciona no aplicativo para Windows.'); return; }
    if (state.running) { Nexo.deepView.show('opt'); return; }
    Nexo.deepView.show('opt');
    box.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    if (!state.games.length) state.games = await bridge.optimizerGames().catch(() => []);
    await loadPlan();
  }

  async function loadPlan() {
    state.loading = true;
    state.error = null;
    state.result = null;
    render();
    try {
      const answer = await bridge.planOptimization({ game: state.game || null, allowRisk: state.allowRisk });
      if (!answer?.supported) { state.error = 'A otimização automática funciona no Windows.'; state.plan = null; }
      else {
        state.plan = answer;
        state.picked = new Set(answer.plan.steps.filter((step) => step.selected).map((step) => step.id));
      }
    } catch (error) {
      state.error = error.message || 'Não consegui montar o plano.';
      state.plan = null;
    } finally { state.loading = false; render(); }
  }

  const stepsWithPicks = () => (state.plan?.plan.steps || []).map((step) => ({ ...step, selected: state.picked.has(step.id) }));

  function stepRow(step) {
    const manual = step.method === 'manual';
    const testar = step.method === 'testar';
    const blocked = Boolean(step.blocked);
    const chips = [
      `<span class="opt-chip method-${esc(step.method)}">${esc(Opt.METHOD_LABEL[step.method] || step.method)}</span>`,
      step.risk && step.risk !== 'baixo' ? `<span class="opt-chip risk-${esc(step.risk)}">${esc(RISK[step.risk])}</span>` : '',
      step.admin ? '<span class="opt-chip admin">pede permissão</span>' : '',
      step.tag ? `<span class="opt-chip">${esc(step.tag)}</span>` : '',
      step.evidence && !manual ? `<span class="opt-chip ev">${esc(Opt.EVIDENCE_LABEL[step.evidence] || step.evidence)}</span>` : ''
    ].join('');
    const change = step.from && step.to ? `<span class="opt-change">${esc(step.from)} <i aria-hidden="true">→</i> ${esc(step.to)}</span>` : '';
    let control = `<label class="opt-check"><input type="checkbox" data-pick="${esc(step.id)}"${state.picked.has(step.id) ? ' checked' : ''}${blocked ? ' disabled' : ''} /><i aria-hidden="true"></i><span class="sr-only">Incluir</span></label>`;
    if (manual) control = `<span class="opt-you" aria-hidden="true">${ico('i-wrench')}</span>`;
    if (testar) control = `<span class="opt-you" aria-hidden="true">${ico('i-refresh')}</span>`;
    const action = testar ? `<button class="btn sm" type="button" data-reboot-test="${esc(step.id)}">Medir com reinício</button>`
      : step.goto ? `<button class="btn sm ghost" type="button" data-goto="${esc(step.goto)}">Abrir</button>` : '';
    return `<li class="opt-step${manual ? ' manual' : ''}${blocked ? ' blocked' : ''}" data-step="${esc(step.id)}">${control}
      <div class="opt-step-body"><strong>${esc(step.title)}</strong><p>${esc(step.why)}</p><div class="opt-chips">${chips}${change}</div></div>${action}</li>`;
  }

  function planHtml() {
    const answer = state.plan;
    const steps = stepsWithPicks();
    const counts = Opt.countsOf(steps);
    const phrase = Opt.needsPhrase(steps);
    const gameOptions = [`<option value="">Nenhum em especial</option>`, ...state.games.map((game) => `<option value="${esc(game.key)}"${state.game === game.key ? ' selected' : ''}>${esc(game.name)}${game.exeName ? '' : ' (o Nexo procura o executável)'}</option>`)].join('');
    const sections = answer.plan.categories.map((category) => {
      const list = steps.filter((step) => step.category === category.id);
      const selected = list.filter((step) => step.selected).length;
      const right = category.id === 'manual' ? `${list.length} ${list.length === 1 ? 'coisa' : 'coisas'}` : `${selected} de ${list.length}`;
      return `<section class="opt-section" data-cat="${esc(category.id)}"><header>${ico(category.icon)}<h4>${esc(category.label)}</h4><span>${esc(right)}</span></header><ul>${list.map(stepRow).join('')}</ul></section>`;
    }).join('');
    const facts = [`${counts.selected} ${counts.selected === 1 ? 'ajuste marcado' : 'ajustes marcados'}`, counts.admin ? 'o Windows pede permissão uma vez só' : 'sem pedir permissão', counts.reboot ? `${counts.reboot} ${counts.reboot === 1 ? 'vale' : 'valem'} depois de reiniciar` : null, answer.onBattery ? 'ligue na tomada antes de começar' : null].filter(Boolean);
    return `<div class="opt-hero">
        <div class="opt-hero-text">
          <span class="deep-kicker">Otimizar este PC</span>
          <h3>Um plano feito a partir da sua análise</h3>
          <p class="muted">O Nexo mede o PC, aplica tudo de uma vez, mede de novo e desfaz o que piorar. O que muda só depois de reiniciar é conferido depois do reinício. Tudo vai para o Diário, com "Reverter".</p>
          <div class="opt-controls">
            <label class="opt-field"><span>Jogo principal</span><span class="select"><select id="opt-game">${gameOptions}</select></span></label>
            <div class="opt-field"><span>Até onde ir sozinho</span><div class="segmented sm" role="group" aria-label="Risco"><button type="button" data-risk="baixo" aria-pressed="${state.allowRisk === 'baixo'}">Só o seguro</button><button type="button" data-risk="moderado" aria-pressed="${state.allowRisk === 'moderado'}">Inclui moderado</button></div></div>
          </div>
          <p class="opt-facts">${facts.map(esc).join(' · ')}</p>
        </div>
        <div class="opt-hero-sky"><svg class="deep-sky deep-chart opt-sky" id="opt-plan-sky" viewBox="0 0 1000 320" aria-hidden="true">${Nexo.deepView.chart(Nexo.deepView.report(), {}, {}, 'opt-plan')}</svg></div>
      </div>
      <div class="opt-sections">${sections}</div>
      <div class="opt-go">
        <label class="opt-consent"><input type="checkbox" id="opt-ack" /><span>Entendo que o Nexo vai mudar configurações do Windows. Cada mudança fica no Diário com o valor anterior.</span></label>
        ${phrase ? '<label class="opt-phrase"><span>Há ajustes de risco moderado marcados. Para seguir, digite <b>ENTENDO O RISCO</b></span><input id="opt-phrase" type="text" autocomplete="off" spellcheck="false" maxlength="40" /></label>' : ''}
        <div class="opt-go-row"><button class="btn ghost" type="button" data-opt-back="1">Voltar ao relatório</button><button class="btn primary opt-cta" type="button" data-opt-run="1"${counts.selected ? '' : ' disabled'}>${ico('i-bolt')}Otimizar agora</button></div>
      </div>`;
  }

  function paintPlanSky() {
    const sky = document.getElementById('opt-plan-sky');
    if (!sky) return;
    const steps = stepsWithPicks().filter((step) => step.selected);
    const count = {};
    for (const step of steps) count[nodeOf(step)] = (count[nodeOf(step)] || 0) + 1;
    for (const star of sky.querySelectorAll('.deep-star')) {
      const n = count[star.dataset.node] || 0;
      star.dataset.opt = n ? 'queued' : 'idle';
      star.querySelector('.deep-badge')?.remove();
      if (n) star.insertAdjacentHTML('beforeend', `<g class="deep-badge opt-badge" transform="translate(25 -3)"><circle r="10.5" /><text y="4">${n}</text></g>`);
    }
    Nexo.deepView.space(sky, 'chart');
  }

  /* ---------------- Execução ---------------- */
  async function runNow() {
    const steps = stepsWithPicks();
    const ack = document.getElementById('opt-ack')?.checked === true;
    const phrase = document.getElementById('opt-phrase')?.value || '';
    try { Opt.assertConsent(steps, { acknowledged: ack, phrase }); } catch (error) { showToast(error.message); (document.getElementById(ack ? 'opt-phrase' : 'opt-ack'))?.focus(); return; }
    state.running = true;
    state.live = { stage: 'preparar', detail: 'Conferindo se dá para medir direito', log: [], steps: {}, startedAt: Date.now(), measure: null, lab: null };
    renderRun();
    setAppStatus('Otimizando o PC');
    startMotion();
    let result = null;
    try {
      const memory = Nexo.labMemory?.() || { evidence: {}, tabu: [], runs: [] };
      result = await bridge.runOptimization({ selected: steps.filter((step) => step.selected).map((step) => step.id), consent: { acknowledged: ack, phrase }, allowRisk: state.allowRisk, labMemory: { evidence: memory.evidence, tabu: memory.tabu } });
    } catch (error) {
      result = { status: 'aborted', reason: error.message || 'A otimização parou.', steps: {}, records: [], comparison: {}, summary: { headline: 'A otimização parou', lines: [error.message || ''] } };
    } finally {
      state.running = false;
      setAppStatus('Monitoramento ativo');
    }
    finish(result);
  }

  function finish(result) {
    state.result = result;
    if (result.records?.length && result.id) {
      const done = result.records.filter((record) => !record.undone).length;
      Nexo.journal.record({ actionId: 'opt-run', title: `Otimização do PC (${done} ${done === 1 ? 'ajuste' : 'ajustes'})`, risk: result.records.some((record) => record.risk === 'moderado') ? 'moderado' : 'baixo', reversible: done > 0, riskSession: true,
        authorization: 'confirmação na interface, frase digitada quando havia risco moderado e permissão de administrador (UAC)', before: { runId: result.id }, after: { count: done, titles: result.records.filter((record) => !record.undone).map((record) => record.title).slice(0, 40) },
        detail: [result.summary?.headline, ...(result.summary?.lines || [])].filter(Boolean).join(' ') });
    }
    if (result.lab) {
      const memory = Nexo.labMemory?.() || { evidence: {}, tabu: [], runs: [] };
      Nexo.labSaveMemory?.({ evidence: result.lab.evidence || memory.evidence, tabu: result.lab.tabu || memory.tabu, runs: memory.runs });
      if (result.lab.adopted) {
        Nexo.journal.record({ actionId: 'power-plan-switch', title: 'Plano ajustado pelo laboratório (Otimizar este PC)', risk: 'moderado', reversible: true, riskSession: true, authorization: 'modo autônomo da otimização, com consentimento reforçado', before: result.lab.adopted.before, after: { guid: result.lab.adopted.guid, name: result.lab.adopted.name } });
        Nexo.loadPower?.();
      }
    }
    Nexo.emit('journal');
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), id: result.id || null, headline: result.summary?.headline || '', status: result.status })); } catch { /* só nesta sessão */ }
    recordActivity('Otimizar este PC', result.summary?.headline || result.status);
    showToast(result.status === 'completed' ? `Otimização concluída: ${(result.summary?.headline || '').toLowerCase()}.` : result.reason || 'A otimização parou.');
    renderResult();
    celebrate();
  }

  function onEvent(event) {
    if (!state.running || !state.live || !event) return;
    const live = state.live;
    if (event.type === 'stage') { live.stage = event.stage; live.detail = event.detail; if (event.stage === 'aplicar') charge(); }
    else if (event.type === 'log') { live.log.unshift(event.message); live.log = live.log.slice(0, 7); }
    else if (event.type === 'step') { live.steps[event.id] = event; if (event.status === 'feito' || event.status === 'desfeito') nova(event); }
    else if (event.type === 'measure') live.measure = event;
    else if (event.type === 'lab') {
      const lab = event.event || {};
      if (lab.type === 'stage') live.detail = `Laboratório: ${lab.detail || lab.stage}`;
      if (lab.type === 'trial') { live.lab = lab; pulse('cpu'); }
      if (lab.type === 'arm' && lab.arm) live.log.unshift(`Laboratório: ${lab.arm.label} → ${lab.arm.valueLabel}: ${lab.arm.verdict}${Number.isFinite(lab.arm.compositeDelta) ? ' (' + pct(lab.arm.compositeDelta) + ')' : ''}`);
    }
    paintRun();
  }

  function renderRun() {
    const steps = stepsWithPicks().filter((step) => step.selected);
    const count = {};
    for (const step of steps) count[nodeOf(step)] = (count[nodeOf(step)] || 0) + 1;
    box.innerHTML = `<div class="opt-run">
        <div class="opt-run-head"><span class="deep-kicker">Otimizando o PC</span><h3 id="opt-headline">Medindo o PC como está</h3></div>
        <svg class="deep-sky deep-chart opt-sky running" id="opt-run-sky" viewBox="0 0 1000 320" role="img" aria-label="Constelação do PC: cada estrela acende quando a parte dela é otimizada"><defs><linearGradient id="opt-sweep-grad" x1="0" x2="1"><stop offset="0" stop-color="#7fe3ff" stop-opacity="0" /><stop offset="0.85" stop-color="#9fe9ff" stop-opacity="0.16" /><stop offset="1" stop-color="#d9f7ff" stop-opacity="0.5" /></linearGradient></defs>${Nexo.deepView.chart(Nexo.deepView.report(), {}, {}, 'opt-run')}<rect class="opt-sweep" x="-80" y="-20" width="80" height="360" fill="url(#opt-sweep-grad)" transform="translate(-200 0)" /></svg>
        <div class="deep-now"><i class="deep-dot" aria-hidden="true"></i><strong id="opt-action" aria-live="polite">Conferindo se dá para medir direito</strong></div>
        <ol class="opt-track" id="opt-track">${STAGES.map((stage) => `<li data-stage="${stage.id}"><i aria-hidden="true"></i><span>${esc(stage.label)}</span></li>`).join('')}</ol>
        <ul class="deep-facts opt-log" id="opt-log"></ul>
        <div class="deep-progress"><div class="deep-bar" role="progressbar" aria-label="Progresso da otimização" aria-valuemin="0" aria-valuemax="${STAGES.length}" id="opt-bar"><i id="opt-bar-fill"></i></div><span class="deep-time" id="opt-time">0:00</span><button class="btn sm" type="button" data-opt-cancel="1">Cancelar</button></div>
      </div>`;
    const sky = document.getElementById('opt-run-sky');
    for (const star of sky.querySelectorAll('.deep-star')) {
      star.querySelector('.deep-badge')?.remove();
      star.dataset.opt = count[star.dataset.node] ? 'queued' : 'idle';
    }
    Nexo.deepView.space(sky, 'chart');
    paintRun();
  }

  function paintRun() {
    const live = state.live;
    if (!live || !document.getElementById('opt-run-sky')) return;
    const index = STAGE_INDEX.has(live.stage) ? STAGE_INDEX.get(live.stage) : live.stage === 'rede' ? STAGE_INDEX.get('aplicar') : STAGES.length;
    for (const item of document.querySelectorAll('#opt-track li')) {
      const i = STAGE_INDEX.get(item.dataset.stage);
      item.dataset.state = i < index ? 'done' : i === index ? 'active' : 'pending';
    }
    const measuring = live.measure && ['antes', 'depois', 'confirmacao', 'depois-de-desfazer'].includes(live.measure.side) && ['antes', 'depois', 'conferir'].includes(live.stage);
    const extra = measuring ? ` (rodada ${live.measure.round} de ${live.measure.rounds})` : live.stage === 'laboratorio' && live.lab ? ` (par ${live.lab.pair} de ${live.lab.pairs})` : '';
    setText('opt-action', `${live.detail || ''}${extra}`);
    const head = { preparar: 'Preparando', antes: 'Medindo o PC como está', aplicar: 'Aplicando os ajustes', rede: 'Esperando a internet voltar', laboratorio: 'Laboratório de energia', depois: 'Medindo de novo', conferir: 'Conferindo o que mudou' }[live.stage];
    if (head) setText('opt-headline', head);
    const fill = document.getElementById('opt-bar-fill');
    if (fill) fill.style.width = `${Math.min(100, ((index + (measuring ? (live.measure.round - 0.5) / live.measure.rounds : 0.4)) / STAGES.length) * 100)}%`;
    document.getElementById('opt-bar')?.setAttribute('aria-valuenow', String(index));
    const log = document.getElementById('opt-log');
    const key = live.log.join('|');
    if (log && log.dataset.key !== key) { log.dataset.key = key; log.innerHTML = live.log.map((line, i) => `<li${i === 0 ? ' class="fresh"' : ''}>${esc(line)}</li>`).join(''); }
    const sky = document.getElementById('opt-run-sky');
    sky.dataset.stage = live.stage;
    if (live.stage === 'laboratorio') setStar(sky, 'cpu', 'charging');
  }
  const setStar = (sky, node, value) => { const star = sky?.querySelector(`.deep-star[data-node="${node}"]`); if (star && star.dataset.opt !== 'boosted') star.dataset.opt = value; };
  /** Ao aplicar: as estrelas das partes marcadas começam a carregar. */
  function charge() {
    const sky = document.getElementById('opt-run-sky');
    for (const star of sky?.querySelectorAll('.deep-star[data-opt="queued"]') || []) star.dataset.opt = 'charging';
  }
  /** Um ajuste terminou: onda de luz saindo da estrela, e ela passa a "otimizada" (ou âmbar, se foi desfeito). */
  function nova(event) {
    const sky = document.getElementById('opt-run-sky');
    const step = stepsWithPicks().find((item) => item.id === event.id);
    const node = step ? nodeOf(step) : Opt.CATEGORY.get(event.category)?.node;
    const star = sky?.querySelector(`.deep-star[data-node="${node}"]`);
    if (!star) return;
    star.dataset.opt = event.status === 'desfeito' ? 'undone' : 'boosted';
    if (calm()) return;
    star.insertAdjacentHTML('afterbegin', `<circle class="opt-nova${event.status === 'desfeito' ? ' warn' : ''}" r="8" />`);
    const wave = star.firstElementChild;
    setTimeout(() => wave.remove(), 1400);
  }
  function pulse(node) {
    const star = document.getElementById('opt-run-sky')?.querySelector(`.deep-star[data-node="${node}"]`);
    if (!star || calm()) return;
    star.insertAdjacentHTML('afterbegin', '<circle class="opt-nova soft" r="8" />');
    const wave = star.firstElementChild;
    setTimeout(() => wave.remove(), 1400);
  }

  /* Movimento (relógio único do app): anel girando nas estrelas carregando e a faixa de medição varrendo a carta. */
  let motion = null;
  function startMotion() {
    if (motion || !Nexo.clock) return;
    motion = (now) => {
      const sky = document.getElementById('opt-run-sky');
      if (!state.running || !sky) { motion = null; return false; }
      if (calm() || document.hidden) return true;
      const t = now / 1000;
      for (const star of sky.querySelectorAll('.deep-star[data-opt="charging"]')) {
        star.querySelector('.deep-ring')?.setAttribute('transform', `rotate(${Math.round((t * 90) % 360)})`);
        star.querySelector('.deep-glow')?.setAttribute('transform', `scale(${(1.05 + 0.18 * Math.sin(t * 4)).toFixed(3)})`);
      }
      const sweep = sky.querySelector('.opt-sweep');
      if (sweep) sweep.setAttribute('transform', ['antes', 'depois', 'conferir'].includes(sky.dataset.stage) ? `translate(${Math.round(((t * 260) % 1240) - 80)} 0)` : 'translate(-200 0)');
      const time = document.getElementById('opt-time');
      if (time && state.live) { const s = Math.floor((Date.now() - state.live.startedAt) / 1000); time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
      return true;
    };
    Nexo.clock.add(motion);
  }

  /* ---------------- Resultado ---------------- */
  function metricRows(result) {
    const rows = Opt.METRICS.filter((metric) => result.comparison?.[metric.id]).map((metric) => {
      const c = result.comparison[metric.id];
      const tone = c.verdict === 'melhorou' ? 'ok' : c.verdict === 'piorou' ? 'bad' : 'muted';
      const word = c.verdict === 'melhorou' ? 'melhorou' : c.verdict === 'piorou' ? 'piorou' : c.verdict === 'inconclusivo' ? 'sem dados' : 'dentro do ruído';
      const values = metric.unit === 'ms' ? `${num(c.before, 1)} ms <i aria-hidden="true">→</i> ${num(c.after, 1)} ms` : `${pct(c.deltaPct ?? 0)}`;
      return `<li data-tone="${tone}"><span>${esc(metric.label)}</span><b>${values}</b><em>${esc(word)}${Number.isFinite(c.noisePct) && c.verdict !== 'inconclusivo' ? ` · ruído ±${num(c.noisePct, 1)}%` : ''}</em></li>`;
    });
    return rows.length ? `<ul class="opt-metrics">${rows.join('')}</ul>` : '<p class="muted">Sem medição comparável (a otimização parou antes de medir de novo).</p>';
  }

  function renderResult() {
    const result = state.result;
    if (!result) return;
    const steps = stepsWithPicks();
    const done = steps.filter((step) => result.steps?.[step.id]);
    const rows = done.map((step) => {
      const status = result.steps[step.id];
      const [label, tone] = STATUS[status.status] || [status.status, 'muted'];
      return `<li data-tone="${tone}"><span class="opt-dot" aria-hidden="true"></span><div><strong>${esc(step.title)}</strong>${status.note ? `<small>${esc(status.note)}</small>` : ''}</div><em>${esc(label)}</em></li>`;
    }).join('');
    const canRevert = (result.records || []).some((record) => !record.undone) && result.id;
    const reboot = steps.find((step) => step.method === 'testar');
    const summary = result.summary || { headline: '', lines: [] };
    box.innerHTML = `<div class="opt-result">
        <div class="opt-hero result">
          <div class="opt-hero-text">
            <span class="deep-kicker">${result.status === 'completed' ? 'Otimização concluída' : 'Otimização'}</span>
            <h3>${esc(summary.headline)}</h3>
            ${summary.lines.map((line) => `<p>${esc(line)}</p>`).join('')}
            ${result.status !== 'completed' && result.reason ? `<p class="opt-reason">${esc(result.reason)}</p>` : ''}
            <div class="opt-go-row left">${canRevert ? '<button class="btn" type="button" data-opt-revert="1">Reverter tudo</button>' : ''}${reboot ? `<button class="btn" type="button" data-reboot-test="${esc(reboot.id)}">Medir os controversos com reinício</button>` : ''}<button class="btn primary" type="button" data-opt-back="1">Voltar ao relatório</button></div>
          </div>
          <div class="opt-hero-sky"><svg class="deep-sky deep-chart opt-sky finished" id="opt-run-sky" viewBox="0 0 1000 320" aria-hidden="true">${Nexo.deepView.chart(Nexo.deepView.report(), {}, {}, 'opt-done')}</svg></div>
        </div>
        <div class="deep-grid">
          <section class="deep-card">${`<h4>${ico('i-spark')}Antes e depois</h4>`}<p class="muted">Mesmas medições, antes e depois. Só conta o que passou do ruído e apareceu na maioria das rodadas.</p>${metricRows(result)}</section>
          <section class="deep-card">${`<h4>${ico('i-check')}O que foi feito</h4>`}${rows ? `<ul class="opt-done">${rows}</ul>` : '<p class="muted">Nada foi aplicado.</p>'}</section>
        </div>
      </div>`;
    const sky = document.getElementById('opt-run-sky');
    const boosted = new Set(done.filter((step) => result.steps[step.id].status === 'feito').map(nodeOf));
    const undone = new Set(done.filter((step) => result.steps[step.id].status === 'desfeito').map(nodeOf));
    for (const star of sky.querySelectorAll('.deep-star')) { star.querySelector('.deep-badge')?.remove(); star.dataset.opt = undone.has(star.dataset.node) ? 'undone' : boosted.has(star.dataset.node) ? 'boosted' : 'idle'; }
    Nexo.deepView.space(sky, 'chart');
  }

  /** No fim: um cometa atravessa a carta e as estrelas otimizadas brilham juntas. */
  function celebrate() {
    const sky = document.getElementById('opt-run-sky');
    if (!sky || calm() || state.result?.status !== 'completed') return;
    sky.insertAdjacentHTML('beforeend', '<g class="opt-comet"><line x1="-90" y1="0" x2="0" y2="0" /><circle r="3" /></g>');
    sky.classList.add('celebrate');
    setTimeout(() => { sky.querySelector('.opt-comet')?.remove(); sky.classList.remove('celebrate'); }, 2600);
  }

  /* ---------------- Desenho geral e eventos ---------------- */
  function render() {
    if (state.running) { renderRun(); return; }
    if (state.result) { renderResult(); return; }
    if (state.loading) {
      box.innerHTML = `<div class="opt-loading"><svg class="deep-sky deep-chart opt-sky" id="opt-plan-sky" viewBox="0 0 1000 320" aria-hidden="true">${Nexo.deepView.chart(Nexo.deepView.report(), {}, {}, 'opt-load')}</svg><p class="deep-now"><i class="deep-dot" aria-hidden="true"></i><strong>Lendo o PC: início com o Windows, placas de rede, energia e o Raio-X…</strong></p></div>`;
      Nexo.deepView.space(document.getElementById('opt-plan-sky'), 'chart');
      return;
    }
    if (state.error || !state.plan) {
      box.innerHTML = `<div class="opt-empty"><h3>Não deu para montar o plano</h3><p>${esc(state.error || 'Tente de novo.')}</p><div class="opt-go-row left"><button class="btn" type="button" data-opt-back="1">Voltar ao relatório</button><button class="btn primary" type="button" data-opt-retry="1">Tentar de novo</button></div></div>`;
      return;
    }
    box.innerHTML = planHtml();
    paintPlanSky();
  }

  async function revertAll() {
    const result = state.result;
    if (!result?.id) return;
    const ok = await Nexo.confirm({ title: 'Reverter a otimização?', body: 'Tudo o que esta otimização mudou volta ao que era (o Windows pede permissão uma vez, se houver ajustes de sistema). O plano de energia ajustado pelo laboratório se reverte pelo Diário.', confirmLabel: 'Reverter tudo', tone: 'danger' });
    if (!ok) return;
    try {
      const answer = await bridge.revertOptimization({ runId: result.id });
      for (const record of result.records || []) record.undone = true;
      const entry = Nexo.journal.list(100).find((item) => item.actionId === 'opt-run' && item.before?.runId === result.id && item.status === 'applied');
      if (entry && !answer.remaining) Nexo.journal.markReverted(entry.id, 'tudo de volta');
      Nexo.emit('journal');
      showToast(answer.failed ? `${answer.reverted} revertido(s); ${answer.failed} não ${answer.declined ? '(sem a permissão do Windows)' : 'voltaram'}.` : `Pronto: ${answer.reverted} ${answer.reverted === 1 ? 'ajuste voltou' : 'ajustes voltaram'} ao que era.`);
      renderResult();
    } catch (error) { showToast(error.message || 'Não consegui reverter.'); }
  }

  function rebootTest(id) {
    const step = (state.plan?.plan.steps || []).find((item) => item.id === id);
    const list = Array.isArray(step?.changes) ? step.changes : [];
    if (!list.length || !Nexo.composeRebootTest) return;
    Nexo.go('lab');
    Nexo.composeRebootTest(list.map((change) => ({ item: { id: change.id, label: change.label, values: change.before, current: change.beforeLabel, reboot: change.reboot, admin: change.admin }, option: { values: change.after, label: change.afterLabel } })));
  }

  box.addEventListener('change', (event) => {
    const pick = event.target.closest('[data-pick]');
    if (pick) { if (pick.checked) state.picked.add(pick.dataset.pick); else state.picked.delete(pick.dataset.pick); refreshCounts(); return; }
    if (event.target.id === 'opt-game') { state.game = event.target.value; loadPlan(); }
  });
  /** Marcar ou desmarcar não redesenha a lista inteira (mantém o foco e a rolagem): só os números e a carta. */
  function refreshCounts() {
    const html = document.createElement('div');
    html.innerHTML = planHtml();
    for (const selector of ['.opt-facts', '.opt-go']) {
      const fresh = html.querySelector(selector);
      const current = box.querySelector(selector);
      if (!fresh || !current) continue;
      if (selector === '.opt-go') {
        const ack = document.getElementById('opt-ack')?.checked;
        const phrase = document.getElementById('opt-phrase')?.value || '';
        current.replaceWith(fresh);
        if (ack) document.getElementById('opt-ack').checked = true;
        const input = document.getElementById('opt-phrase');
        if (input) input.value = phrase;
      } else current.replaceWith(fresh);
    }
    for (const section of box.querySelectorAll('.opt-section')) {
      const fresh = html.querySelector(`.opt-section[data-cat="${section.dataset.cat}"] header span`);
      const current = section.querySelector('header span');
      if (fresh && current) current.textContent = fresh.textContent;
    }
    paintPlanSky();
  }
  box.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.risk) { state.allowRisk = button.dataset.risk; loadPlan(); }
    else if (button.dataset.optRun) runNow();
    else if (button.dataset.optCancel) { bridge.cancelOptimization?.(); setText('opt-action', 'cancelando…'); }
    else if (button.dataset.optBack) { state.result = null; Nexo.deepView.back(); }
    else if (button.dataset.optRetry) loadPlan();
    else if (button.dataset.optRevert) revertAll();
    else if (button.dataset.rebootTest) rebootTest(button.dataset.rebootTest);
    else if (button.dataset.goto) Nexo.go(button.dataset.goto);
  });
  /* ======================================================================================================
   * "Resolver agora" em cada achado da análise: o próprio app faz a correção (com uma permissão do Windows quando
   * precisa, tudo no Diário). O que não dá para fazer por um app (BIOS, cabo, limpeza física) vira passo a passo
   * guiado, com "Reiniciar direto na BIOS" quando é lá.
   * ==================================================================================================== */
  const DRIVER_PAGES = { NVIDIA: 'https://www.nvidia.com/pt-br/drivers/', AMD: 'https://www.amd.com/pt/support/download/drivers.html', Intel: 'https://www.intel.com.br/content/www/br/pt/support/detect.html' };
  const BOARD_PAGES = { ASUS: 'https://www.asus.com/br/support/download-center/', MSI: 'https://br.msi.com/support/download', GIGABYTE: 'https://www.gigabyte.com/br/Support', ASRock: 'https://www.asrock.com/support/index.pt.asp' };
  const makerOf = (profile) => { const text = `${profile?.board?.maker || ''} ${profile?.board?.model || ''}`; return /asus|rog|tuf|prime/i.test(text) ? 'ASUS' : /micro-star|msi/i.test(text) ? 'MSI' : /gigabyte|aorus/i.test(text) ? 'GIGABYTE' : /asrock/i.test(text) ? 'ASRock' : null; };
  const gpuMaker = (profile) => { const name = ((profile?.gpus || []).find((gpu) => gpu.discrete) || (profile?.gpus || [])[0])?.name || ''; return /nvidia|geforce|rtx|gtx|quadro/i.test(name) ? 'NVIDIA' : /amd|radeon/i.test(name) ? 'AMD' : /intel|arc|iris|uhd/i.test(name) ? 'Intel' : null; };
  /** Onde fica cada opção na BIOS de cada fabricante (o nome muda de marca para marca). */
  const BIOS_STEPS = {
    xmp: { title: 'Ligar o perfil de memória (XMP, DOCP ou EXPO)', steps: {
      ASUS: ['Aperte F7 para o modo avançado.', 'Ai Tweaker → Ai Overclock Tuner → escolha D.O.C.P. (ou XMP I / EXPO).', 'Aperte F10 e confirme para salvar e reiniciar.'],
      MSI: ['Na tela inicial (EZ Mode), clique no botão A-XMP (ou XMP / EXPO) no alto.', 'Escolha o Perfil 1.', 'Aperte F10 e confirme.'],
      GIGABYTE: ['Na tela inicial, ligue "XMP" (ou entre em Tweaker → Extreme Memory Profile).', 'Escolha Profile1.', 'Aperte F10 e confirme.'],
      ASRock: ['OC Tweaker → DRAM Configuration → Load XMP Setting.', 'Escolha o XMP Profile 1.', 'Aperte F10 e confirme.'],
      outro: ['Procure "XMP", "DOCP" ou "EXPO" nas opções de memória (DRAM).', 'Escolha o perfil 1.', 'Salve (geralmente F10) e reinicie.'] },
      after: 'Se o PC não ligar ou travar depois, ele volta sozinho ao padrão depois de algumas tentativas; se não voltar, entre na BIOS e use "Load Optimized Defaults".' },
    rebar: { title: 'Ligar o Resizable BAR', steps: {
      ASUS: ['F7 (modo avançado) → Advanced → PCI Subsystem Settings.', 'Above 4G Decoding: Enabled → Re-Size BAR Support: Enabled.', 'F10 para salvar.'],
      MSI: ['Settings → Advanced → PCI Subsystem Settings.', 'Above 4G memory: Enabled → Re-Size BAR Support: Enabled.', 'F10 para salvar.'],
      GIGABYTE: ['Settings → IO Ports.', 'Above 4G Decoding: Enabled → Re-Size BAR Support: Auto (ou Enabled).', 'F10 para salvar.'],
      ASRock: ['Advanced → Chipset Configuration.', 'Above 4G Decoding: Enabled → C.A.M. / Re-Size BAR: Enabled.', 'F10 para salvar.'],
      outro: ['Procure "Above 4G Decoding" e ligue.', 'Depois ligue "Re-Size BAR" (ou "Smart Access Memory" / "Clever Access Memory").', 'Salve e reinicie.'] },
      after: 'O Resizable BAR precisa do Windows instalado em modo UEFI. Se a BIOS pedir para desligar o "CSM" e o Windows foi instalado no modo antigo (MBR), não desligue: o PC pode não iniciar.' },
    update: { title: 'Atualizar a BIOS', steps: {
      outro: ['Baixe a BIOS mais nova da página de suporte da sua placa (o botão abaixo abre o site oficial).', 'Copie o arquivo para um pendrive em FAT32.', 'Na BIOS, use a ferramenta de atualização (ASUS EZ Flash, MSI M-Flash, GIGABYTE Q-Flash, ASRock Instant Flash).', 'Não desligue o PC durante a atualização.'] },
      after: 'Depois de atualizar, a BIOS volta ao padrão: ligue de novo o XMP se ele estava ligado.' }
  };
  const GUIDES = {
    'wifi-24': ['Conecte na rede de 5 GHz do roteador (às vezes tem o mesmo nome com "5G").', 'Se só aparece uma rede, entre nas configurações do roteador e separe os nomes de 2,4 e 5 GHz.', 'Para jogar, cabo de rede é sempre melhor que Wi-Fi.'],
    'wifi-sinal': ['Aproxime o PC do roteador ou tire obstáculos (paredes, espelhos, aquários, micro-ondas).', 'Se o roteador tiver antenas, deixe uma em pé e outra deitada.', 'Repetidores e redes mesh ajudam em casas grandes; cabo resolve de vez.'],
    'rede-100': ['Troque o cabo de rede por um Cat 5e ou Cat 6 (cabos velhos ou amassados caem para 100 Mb/s).', 'Teste outra porta do roteador.', 'Confira se o conector está firme dos dois lados.'],
    'tela-placa-mae': ['Desligue o PC.', 'Tire o cabo do monitor da saída da placa-mãe (a de trás, perto das USB).', 'Ligue na saída da placa de vídeo (a horizontal, mais embaixo).'],
    'mem-canal-unico': ['Com um pente só, a memória roda em um canal (metade da velocidade de transferência).', 'Coloque um segundo pente igual: os dois no slot A2 e B2 (o segundo e o quarto, contando do processador).'],
    'mem-mesmo-canal': ['Desligue o PC e tire da tomada.', 'Mude os pentes para os slots A2 e B2 (o segundo e o quarto, contando a partir do processador).', 'Ligue de novo: o Nexo confirma o dual channel na próxima análise.'],
    'cpu-quente': ['Limpe a poeira do cooler e das ventoinhas (ar comprimido, com o PC desligado).', 'Confira se todas as ventoinhas giram.', 'Pasta térmica com mais de 3 ou 4 anos vale trocar.'],
    'cpu-freio-calor': ['Limpe a poeira do cooler e das ventoinhas (ar comprimido, com o PC desligado).', 'Confira se o cooler está bem preso e se todas as ventoinhas giram.', 'Pasta térmica com mais de 3 ou 4 anos vale trocar.'],
    'gpu-calor': ['Limpe a poeira da placa de vídeo e do gabinete.', 'Deixe espaço para o ar entrar na frente e sair atrás.', 'Uma curva de ventoinha mais forte (no programa da placa) ajuda em jogos pesados.'],
    'disco-hd-sistema': ['O Windows num HD é o que mais deixa um PC lento hoje.', 'Um SSD SATA ou NVMe barato já muda tudo; dá para clonar o disco sem reinstalar.'],
    'na-bateria': ['Ligue o notebook na tomada para jogar: na bateria o Windows segura o processador e a placa de vídeo.'],
    'win10': ['O Windows 10 não recebe mais atualizações de segurança gratuitas.', 'Se o PC aceitar, atualize para o Windows 11 pelo Windows Update.']
  };
  const decorated = { report: null, plan: null, loading: null };
  const ACT = (label, attrs, primary = true) => `<button class="btn sm${primary ? ' primary' : ''} fix-btn" type="button" ${attrs}>${esc(label)}</button>`;

  /** Botões de cada achado (alguns precisam do plano lido do PC; os outros entram na hora). */
  async function decorateFindings(report) {
    if (Nexo.platform !== 'win32' || !report) return;
    decorated.report = report;
    paintFixes();
    if (!bridge?.planOptimization) return;
    if (!decorated.plan || decorated.plan.reportAt !== report.at) {
      decorated.loading = decorated.loading || bridge.planOptimization({}).then((answer) => { decorated.plan = answer?.supported ? answer : null; return answer; }).catch(() => null).finally(() => { decorated.loading = null; });
      await decorated.loading;
    }
    paintFixes();
  }
  function fixFor(finding, steps) {
    const id = finding.id;
    const byId = (list) => list.filter((stepId) => steps.some((step) => step.id === stepId));
    const MAP = { 'gravacao-fundo': [['raiox-gamedvr'], 'Desligar a gravação'], 'modo-jogo': [['raiox-gamemode'], 'Ligar o Modo de Jogo'], 'gpu-hags': [['raiox-hags'], 'Ligar o agendamento da GPU'],
      'plano-economia': [['energia-plano'], 'Sair do plano de economia'], 'modo-energia': [['energia-modo'], 'Usar "Melhor desempenho"'], 'mem-sem-paginacao': [['sistema-paginacao'], 'Religar a paginação'] };
    if (MAP[id]) { const ids = byId(MAP[id][0]); return ids.length ? { kind: 'steps', ids, label: MAP[id][1] } : (decorated.plan ? { kind: 'done' } : null); }
    if (id === 'inicializacao') {
      const ids = steps.filter((step) => step.kind === 'startup' && step.verdict === 'desligar').map((step) => step.id);
      return ids.length ? { kind: 'steps', ids, label: `Tirar ${ids.length} do início` } : null;
    }
    if (id.startsWith('fundo-') && id !== 'fundo-limpo') {
      const name = id.replace(/^fundo-(presenca-)?/, '').toLowerCase().replace(/\.exe$/, '');
      if (/entrega|delivery/i.test(finding.title) || name === 'svchost-do') { const ids = byId(['raiox-deliveryopt']); if (ids.length) return { kind: 'steps', ids, label: 'Parar o envio para outros PCs' }; }
      if (name === 'msedge') { const ids = byId(['raiox-edgebg']); if (ids.length) return { kind: 'steps', ids, label: 'Não deixar rodando escondido' }; }
      if (name === 'chrome') { const ids = byId(['raiox-chromebg']); if (ids.length) return { kind: 'steps', ids, label: 'Fechar de verdade ao sair' }; }
      const start = steps.find((step) => step.kind === 'startup' && step.match === name);
      if (start) return { kind: 'steps', ids: [start.id], label: 'Tirar do início' };
      return null;
    }
    if (id === 'reinicio-pendente' || id === 'tempo-ligado') return { kind: 'restart', label: 'Reiniciar agora' };
    if (id === 'update-falhou') return { kind: 'settings', page: 'windowsupdate', label: 'Abrir o Windows Update' };
    if (id === 'x3d-gamebar') return { kind: 'settings', page: 'gamebar', label: 'Abrir a Game Bar' };
    if (id === 'mem-xmp') return { kind: 'bios', guide: 'xmp', label: 'Como ligar (e reiniciar na BIOS)' };
    if (id === 'gpu-rebar' || id === 'gpu-rebar-arc') return { kind: 'bios', guide: 'rebar', label: 'Como ligar (e reiniciar na BIOS)' };
    if (['bios-antiga', 'raptor-bios', 'am5-bios'].includes(id)) return { kind: 'bios', guide: 'update', label: 'Atualizar a BIOS', vendor: true };
    if (id === 'disco-cheio') return { kind: 'goto', view: 'maintenance', label: 'Liberar espaço' };
    if (['tela-azul', 'whea', 'whea-fatal', 'desligou-sozinho', 'mem-travada'].includes(id)) return { kind: 'memtest', label: 'Testar a memória' };
    if (['crashes', 'disco-ntfs', 'disco-erros'].includes(id)) return { kind: 'repair', label: 'Reparar o Windows' };
    if (['driver-video-travou', 'crash-driver-video', 'gpu-sem-driver', 'gpu-legado'].includes(id)) return { kind: 'driver', label: 'Baixar o driver oficial' };
    if (id === 'gpu-hibrida') return { kind: 'optimizer', label: 'Escolher o jogo' };
    if (['pc-ocupado', 'memoria-acabando'].includes(id)) return { kind: 'taskmgr', label: 'Ver o que está pesando' };
    if (GUIDES[id]) return { kind: 'guide', label: 'Passo a passo' };
    return null;
  }
  function paintFixes() {
    const report = decorated.report;
    if (!report) return;
    const steps = decorated.plan?.plan?.steps || [];
    for (const card of document.querySelectorAll('#deep-report .finding[data-finding]')) {
      const finding = (report.findings || []).find((item) => item.id === card.dataset.finding);
      if (!finding || finding.severity === 'ok') continue;
      const box = card.querySelector('.finding-actions');
      if (!box || card.dataset.fixed) continue;
      box.querySelector('.fix-btn, .fix-done')?.remove();
      const fix = fixFor(finding, steps);
      if (!fix) continue;
      if (fix.kind === 'done') { box.insertAdjacentHTML('afterbegin', '<span class="fix-done">Já está certo agora</span>'); continue; }
      box.insertAdjacentHTML('afterbegin', ACT(fix.label, `data-fix-finding="${esc(finding.id)}"`, !['guide', 'taskmgr'].includes(fix.kind)));
    }
  }

  async function runFix(findingId, button) {
    const report = decorated.report;
    const finding = (report?.findings || []).find((item) => item.id === findingId);
    if (!finding) return;
    const steps = decorated.plan?.plan?.steps || [];
    const fix = fixFor(finding, steps);
    if (!fix) return;
    const card = button.closest('.finding');
    try {
      if (fix.kind === 'steps') {
        const chosen = steps.filter((step) => fix.ids.includes(step.id));
        const admin = chosen.some((step) => step.admin);
        const items = chosen.map((step) => (step.from && step.to ? `${step.title}: ${step.from} → ${step.to}` : step.title));
        const ok = await Nexo.confirm({ title: fix.label, body: `${chosen.length === 1 ? chosen[0].why : 'O Nexo vai fazer:'} ${admin ? 'O Windows pede permissão uma vez.' : ''} Fica no Diário, com "Reverter".`.trim(), items: chosen.length > 1 ? items : [], confirmLabel: 'Resolver agora' });
        if (!ok) return;
        button.disabled = true;
        button.textContent = 'Resolvendo…';
        const result = await bridge.fixFinding({ ids: fix.ids, consent: { acknowledged: true } });
        const done = (result.records || []).length;
        if (!done) { button.disabled = false; button.textContent = fix.label; showToast(result.reason || 'Não foi possível resolver agora.'); return; }
        Nexo.journal.record({ actionId: 'opt-run', title: `Correção: ${finding.title}`, risk: 'baixo', reversible: true, authorization: `botão "${fix.label}" no relatório da análise${admin ? ' e permissão de administrador (UAC)' : ''}`, before: { runId: result.id }, after: { count: done, titles: result.records.map((record) => record.title) } });
        Nexo.emit('journal');
        markFixed(card, result, chosen.some((step) => step.method === 'reiniciar' || step.reboot !== 'nao'));
        decorated.plan = null;
        showToast(`${fix.label}: pronto.`);
        return;
      }
      if (fix.kind === 'restart') {
        const ok = await Nexo.confirm({ title: 'Reiniciar agora?', body: 'O PC reinicia em 15 segundos. Salve o que estiver aberto. Dá para cancelar dentro desse tempo.', confirmLabel: 'Reiniciar', tone: 'danger' });
        if (!ok) return;
        await bridge.restartComputer({});
        showToast('Reiniciando em 15 segundos…');
        return;
      }
      if (fix.kind === 'bios') { await biosGuide(fix, report); return; }
      if (fix.kind === 'settings') { await bridge.openWindowsSettings(fix.page); return; }
      if (fix.kind === 'goto') { Nexo.go(fix.view); return; }
      if (fix.kind === 'taskmgr') { await bridge.openTaskManager(); return; }
      if (fix.kind === 'optimizer') { open(); return; }
      if (fix.kind === 'driver') { const maker = gpuMaker(report.profile); if (maker) await bridge.openVendorPage(DRIVER_PAGES[maker]); else showToast('Não identifiquei o fabricante da placa de vídeo.'); return; }
      if (fix.kind === 'memtest') {
        const ok = await Nexo.confirm({ title: 'Testar a memória', body: 'O Diagnóstico de Memória do Windows (a ferramenta oficial) testa os pentes no próximo reinício, antes do Windows abrir. Leva de 10 a 20 minutos; o resultado aparece depois de entrar no Windows. Se o XMP estiver ligado e der erro, o culpado costuma ser ele.', confirmLabel: 'Abrir o teste' });
        if (ok) await bridge.openMemoryTest();
        return;
      }
      if (fix.kind === 'repair') {
        const ok = await Nexo.confirm({ title: 'Reparar os arquivos do Windows', body: 'O verificador oficial (SFC) confere e repara os arquivos do sistema. Leva de 5 a 15 minutos; o Windows pede permissão.', confirmLabel: 'Reparar agora' });
        if (!ok) return;
        button.disabled = true; button.textContent = 'Reparando…';
        await bridge.repairSystemFiles();
        button.textContent = 'Reparo concluído';
        return;
      }
      if (fix.kind === 'guide') { await Nexo.confirm({ title: finding.title, body: 'Passo a passo:', items: GUIDES[finding.id], confirmLabel: 'Entendi', cancelLabel: 'Fechar' }); }
    } catch (error) {
      button.disabled = false;
      button.textContent = fix.label;
      showToast(error.message || 'Não deu certo.');
    }
  }
  function markFixed(card, result, later) {
    if (!card) return;
    card.dataset.fixed = '1';
    const box = card.querySelector('.finding-actions');
    box.querySelector('.fix-btn')?.remove();
    box.insertAdjacentHTML('afterbegin', `<span class="fix-done ok">${later ? 'Resolvido; vale depois de reiniciar' : 'Resolvido agora'}</span><button class="btn sm ghost" type="button" data-fix-undo="${esc(result.id)}">Desfazer</button>`);
  }
  async function biosGuide(fix, report) {
    const guide = BIOS_STEPS[fix.guide];
    const maker = makerOf(report.profile) || 'outro';
    const steps = guide.steps[maker] || guide.steps.outro;
    const intro = fix.guide === 'update' ? 'A atualização da BIOS é feita com o arquivo do site oficial da placa.' : `Isso fica na BIOS${maker !== 'outro' ? ' da sua ' + maker : ''}; o Nexo pode reiniciar o PC direto nela.`;
    if (fix.vendor) {
      const page = BOARD_PAGES[maker];
      const ok = await Nexo.confirm({ title: guide.title, body: `${intro} ${guide.after}`, items: steps, confirmLabel: page ? 'Abrir o site da placa' : 'Entendi' });
      if (ok && page) await bridge.openVendorPage(page);
      return;
    }
    const ok = await Nexo.confirm({ title: guide.title, body: `${intro} ${guide.after}`, items: [...steps, 'Ao salvar, o PC reinicia no Windows; o Nexo confirma na próxima análise.'], confirmLabel: 'Reiniciar na BIOS agora', cancelLabel: 'Fazer depois' });
    if (!ok) return;
    const answer = await bridge.restartComputer({ firmware: true });
    if (answer?.declined) { showToast('Sem a permissão do Windows, não dá para reiniciar direto na BIOS. Reinicie e aperte Del (ou F2) na tela do fabricante.'); return; }
    showToast('Reiniciando direto na BIOS em 15 segundos. Salve o que estiver aberto.');
  }
  document.getElementById('deep-report')?.addEventListener('click', (event) => {
    const fixButton = event.target.closest('[data-fix-finding]');
    if (fixButton) { runFix(fixButton.dataset.fixFinding, fixButton); return; }
    const undo = event.target.closest('[data-fix-undo]');
    if (undo) {
      undo.disabled = true;
      bridge.revertOptimization({ runId: undo.dataset.fixUndo }).then((answer) => {
        const entry = Nexo.journal.list(100).find((item) => item.actionId === 'opt-run' && item.before?.runId === undo.dataset.fixUndo && item.status === 'applied');
        if (entry && !answer.remaining) Nexo.journal.markReverted(entry.id, 'desfeito no relatório');
        Nexo.emit('journal');
        const card = undo.closest('.finding');
        delete card.dataset.fixed;
        card.querySelector('.fix-done')?.remove();
        undo.remove();
        decorated.plan = null;
        decorateFindings(decorated.report);
        showToast(answer.remaining ? 'Parte não voltou; veja no Diário.' : 'Desfeito: voltou ao que era.');
        return answer;
      }).catch((error) => { undo.disabled = false; showToast(error.message || 'Não consegui desfazer.'); });
    }
  });
  Nexo.decorateFindings = decorateFindings;

  bridge?.onOptimizerEvent?.(onEvent);
  Nexo.openOptimizer = open;
  // Reaberto com a otimização rodando (outra tela, janela recarregada): mostra o progresso.
  bridge?.getOptimizationStatus?.().then((status) => { if (status?.running) showToast('Uma otimização está rodando; abra a Análise para acompanhar.'); return status; }).catch(() => null);
})();
