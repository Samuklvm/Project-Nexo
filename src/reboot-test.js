/*
 * Teste com reinício: mede o PC depois de reiniciar com os ajustes ANTES (A) e DEPOIS (B), em ordem ABBA, e só
 * afirma ganho quando ele aparece nos dois lados e supera a diferença entre dois boots iguais.
 *
 * Por que reiniciar: muitos ajustes do registro e dos serviços só valem depois de reiniciar, e comparar um PC recém-
 * ligado com um PC ligado há horas engana (cache, memória, programas abertos). Aqui todo boot é medido do mesmo jeito.
 *
 * Funções puras (estado em JSON, salvo em disco pelo processo principal). Nada aqui grava no PC.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoRebootTest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const VERSION = 1;

  /** Ordens de boots. ABBA anula a deriva linear (o PC esquentando, atualizações chegando) com só 2 trocas. */
  const PROTOCOLS = {
    rapido: { label: 'Rápido (3 reinícios: A, B, A)', order: ['A', 'B', 'A'] },
    completo: { label: 'Completo (4 reinícios: A, B, B, A)', order: ['A', 'B', 'B', 'A'] },
    longo: { label: 'Longo (8 reinícios: A, B, B, A, A, B, B, A)', order: ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A'] }
  };

  /** Métricas de cada boot. better: up = maior é melhor. min = menor efeito (em %) que vale relatar. */
  const METRICS = [
    { id: 'desktop', label: 'Da entrada no Windows até a área de trabalho pronta', unit: 's', better: 'down', min: 5, group: 'boot' },
    { id: 'boot', label: 'Do boot até a entrada no Windows', unit: 's', better: 'down', min: 5, group: 'boot', note: 'inclui o tempo de digitar a senha; só conta se os boots forem parecidos' },
    { id: 'idleCpu', label: 'Processador parado (uso médio em repouso)', unit: '%', better: 'down', min: 15, group: 'repouso' },
    { id: 'memUsed', label: 'Memória em uso depois do boot', unit: 'GB', better: 'down', min: 3, group: 'repouso' },
    { id: 'processes', label: 'Processos rodando depois do boot', unit: '', better: 'down', min: 3, group: 'repouso' },
    { id: 'services', label: 'Serviços rodando depois do boot', unit: '', better: 'down', min: 3, group: 'repouso' },
    { id: 'single', label: 'Processador: um núcleo', unit: 'pts', better: 'up', min: 3, group: 'desempenho' },
    { id: 'multi', label: 'Processador: todos os núcleos', unit: 'pts', better: 'up', min: 3, group: 'desempenho' },
    { id: 'burst', label: 'Rajadas curtas (resposta)', unit: 'pts', better: 'up', min: 3, group: 'desempenho' },
    { id: 'latency', label: 'Latência para acordar um núcleo', unit: 'pts', better: 'up', min: 3, group: 'desempenho' },
    { id: 'frames', label: 'Ritmo de quadros (simulação de jogo)', unit: 'pts', better: 'up', min: 3, group: 'desempenho' },
    { id: 'timer', label: 'Precisão do timer', unit: 'pts', better: 'up', min: 3, group: 'desempenho' },
    { id: 'memory', label: 'Memória (acesso aleatório)', unit: 'pts', better: 'up', min: 3, group: 'desempenho' },
    { id: 'disk', label: 'Disco (gravações curtas)', unit: 'pts', better: 'up', min: 5, group: 'desempenho' }
  ];
  const METRIC = new Map(METRICS.map((metric) => [metric.id, metric]));
  const BENCHES = METRICS.filter((metric) => metric.group === 'desempenho').map((metric) => metric.id);

  /** Peso de cada métrica por objetivo. "boot" (com a senha no meio) nunca pesa: só informa. */
  const GOALS = {
    jogos: { label: 'Jogos', weights: { frames: 3, latency: 2, single: 2, timer: 1, burst: 1, multi: 1, memory: 1, disk: 0.5, desktop: 1, idleCpu: 1, memUsed: 1, processes: 0.5, services: 0.5 } },
    inicializacao: { label: 'Ligar mais rápido e leve', weights: { desktop: 3, processes: 2, services: 2, memUsed: 2, idleCpu: 2, disk: 1, burst: 0.5, single: 0.5, multi: 0.5, latency: 0.5, frames: 0.5, timer: 0.5, memory: 0.5 } },
    geral: { label: 'Uso geral', weights: { desktop: 1, idleCpu: 1, memUsed: 1, processes: 1, services: 1, single: 1, multi: 1, burst: 1, latency: 1, frames: 1, timer: 1, memory: 1, disk: 1 } }
  };

  const LIMITS = {
    rounds: 3,             // rodadas de cada teste por boot (vale a mediana)
    settleAfterBootMs: 120000, // espera mínima depois do boot (programas de inicialização terminando)
    settleAfterLaunchMs: 45000,
    quietCpuPct: 20,       // só mede com o processador sossegado...
    quietMaxWaitMs: 300000, // ...esperando no máximo 5 minutos
    idleSampleMs: 20000,
    maxChanges: 160,
    staleAfterMs: 14 * 24 * 3600 * 1000 // um teste parado há 2 semanas é abandonado (e volta ao A)
  };

  function median(values) {
    const list = (values || []).filter(finite).sort((a, b) => a - b);
    if (!list.length) return null;
    const middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }
  /** Meia amplitude em % da mediana (o mesmo "ruído" do laboratório). */
  function halfRangePct(values) {
    const list = (values || []).filter(finite);
    if (list.length < 2) return null;
    const mid = median(list);
    if (!mid) return null;
    return ((Math.max(...list) - Math.min(...list)) / 2 / Math.abs(mid)) * 100;
  }

  /* ---------- Plano ---------- */
  function validChange(change) {
    return change && typeof change.id === 'string' && /^[a-z0-9-]{1,40}$/.test(change.id)
      && Array.isArray(change.before) && Array.isArray(change.after) && change.before.length === change.after.length && change.before.length >= 1 && change.before.length <= 8
      && JSON.stringify(change.before) !== JSON.stringify(change.after);
  }

  /** Cria o plano. changes: [{ id, label, before: [...], after: [...], beforeLabel, afterLabel, reboot, admin }]. */
  function createPlan({ changes, protocol = 'completo', goal = 'jogos', auto = false, now = Date.now(), id = null }) {
    const list = (Array.isArray(changes) ? changes : []).filter(validChange).slice(0, LIMITS.maxChanges);
    if (!list.length) throw new Error('Escolha pelo menos um ajuste diferente do valor atual.');
    if (!PROTOCOLS[protocol]) throw new Error('Ordem de reinícios desconhecida.');
    if (!GOALS[goal]) throw new Error('Objetivo desconhecido.');
    return {
      version: VERSION, id: id || `rt-${now}`, createdAt: now, updatedAt: now,
      status: 'running', phase: 'await-reboot', armedAt: now, protocol, order: [...PROTOCOLS[protocol].order], goal, auto: Boolean(auto),
      step: 0, applied: 'A', admin: list.some((change) => change.admin),
      changes: list.map((change) => ({ id: change.id, label: String(change.label || change.id).slice(0, 120), before: change.before, after: change.after,
        beforeLabel: String(change.beforeLabel || '').slice(0, 80), afterLabel: String(change.afterLabel || '').slice(0, 80), reboot: change.reboot || 'reiniciar', admin: Boolean(change.admin) })),
      boots: [], note: '', result: null, kept: null, journaled: false
    };
  }

  /** Quantas vezes o Windows vai pedir permissão (cada troca A↔B com ajuste do sistema, mais a adoção do B no fim). */
  function permissionCount(order, admin) {
    if (!admin) return 0;
    let count = 0;
    for (let i = 1; i < order.length; i += 1) if (order[i] !== order[i - 1]) count += 1;
    return count;
  }

  /** Configuração que o boot `step` precisa ter. */
  const configAt = (state, step) => state.order[step];

  /**
   * O que fazer agora, dado o estado salvo e o boot atual.
   * Retorna { type: 'idle' | 'wait-reboot' | 'switch' | 'measure' | 'finish', config?, reason? }.
   */
  function nextAction(state, { bootAt, now = Date.now() } = {}) {
    if (!state || state.status !== 'running') return { type: 'idle' };
    if (now - (state.updatedAt || state.createdAt) > LIMITS.staleAfterMs) return { type: 'abandon', reason: 'O teste ficou parado por mais de duas semanas.' };
    if (state.step >= state.order.length) return { type: 'finish' };
    const need = configAt(state, state.step);
    if (state.applied !== need) return { type: 'switch', config: need };
    if (state.phase === 'await-reboot') {
      // Só conta como novo boot se o PC ligou DEPOIS de o teste armar o reinício.
      if (!finite(bootAt) || bootAt <= state.armedAt) return { type: 'wait-reboot', config: need };
      return { type: 'measure', config: need };
    }
    if (state.phase === 'measuring') return { type: 'measure', config: need };
    return { type: 'wait-reboot', config: need };
  }

  /** Depois de trocar a configuração: anota qual está gravada e arma o próximo reinício. */
  function markSwitched(state, config, now = Date.now()) {
    return { ...state, applied: config, phase: 'await-reboot', armedAt: now, updatedAt: now, note: '' };
  }
  function markArmed(state, now = Date.now()) { return { ...state, phase: 'await-reboot', armedAt: now, updatedAt: now }; }
  function markMeasuring(state, now = Date.now()) { return { ...state, phase: 'measuring', updatedAt: now }; }

  /** Limpa uma medição (só números finitos e positivos, dentro de faixas plausíveis). */
  function cleanBoot(boot) {
    const metrics = {};
    const rounds = {};
    for (const metric of METRICS) {
      const value = boot?.metrics?.[metric.id];
      const plausible = finite(value) && value >= 0 && (metric.id === 'boot' || metric.id === 'desktop' ? value < 3600 : metric.id === 'idleCpu' ? value <= 100 : metric.id === 'memUsed' ? value < 4096 : metric.id === 'processes' || metric.id === 'services' ? value < 100000 : value > 0);
      if (plausible) metrics[metric.id] = value;
      const list = Array.isArray(boot?.rounds?.[metric.id]) ? boot.rounds[metric.id].filter((item) => finite(item) && item > 0).slice(0, 12) : null;
      if (list?.length) rounds[metric.id] = list;
    }
    return { metrics, rounds };
  }

  /** Guarda a medição do boot atual e avança. */
  function recordBoot(state, boot, now = Date.now()) {
    const { metrics, rounds } = cleanBoot(boot);
    const record = { step: state.step, config: configAt(state, state.step), bootAt: finite(boot?.bootAt) ? boot.bootAt : null, measuredAt: now, metrics, rounds,
      quiet: boot?.quiet !== false, viaRunOnce: Boolean(boot?.viaRunOnce), onBattery: Boolean(boot?.onBattery) };
    return { ...state, boots: [...state.boots, record], step: state.step + 1, phase: 'await-reboot', armedAt: now, updatedAt: now };
  }

  /* ---------- Veredito ---------- */
  function judgeMetric(metric, boots) {
    const a = boots.filter((boot) => boot.config === 'A').map((boot) => boot.metrics[metric.id]).filter(finite);
    const b = boots.filter((boot) => boot.config === 'B').map((boot) => boot.metrics[metric.id]).filter(finite);
    if (!a.length || !b.length || a.length + b.length < 3) return { id: metric.id, verdict: 'inconclusivo', gainPct: null, noisePct: null, a, b, reason: 'faltam boots com essa medida' };
    const mA = median(a);
    const mB = median(b);
    if (!mA) return { id: metric.id, verdict: 'inconclusivo', gainPct: null, noisePct: null, a, b, reason: 'medida zerada' };
    const dir = metric.better === 'up' ? 1 : -1;
    const gainPct = dir * ((mB - mA) / Math.abs(mA)) * 100;
    // Ruído: a diferença entre boots IGUAIS (A com A, B com B) e, dentro de cada boot, entre as rodadas.
    const within = median(boots.map((boot) => halfRangePct(boot.rounds?.[metric.id])).filter(finite));
    const noisePct = Math.max(halfRangePct(a) || 0, halfRangePct(b) || 0, finite(within) ? within / 2 : 0);
    const threshold = Math.max(metric.min, 1.5 * noisePct);
    // Consistência: todo boot B melhor que todo boot A (ou pior que todos, para "piorou").
    const better = (x, y) => dir * (x - y) > 0;
    const allBetter = b.every((vb) => a.every((va) => better(vb, va)));
    const allWorse = b.every((vb) => a.every((va) => better(va, vb)));
    let verdict = 'inconclusivo';
    if (gainPct >= threshold && allBetter) verdict = 'melhorou';
    else if (gainPct <= -threshold && allWorse) verdict = 'piorou';
    else if (Math.abs(gainPct) < metric.min && noisePct < metric.min * 1.5) verdict = 'sem-diferenca';
    return { id: metric.id, verdict, gainPct: Math.round(gainPct * 10) / 10, noisePct: Math.round(noisePct * 10) / 10, thresholdPct: Math.round(threshold * 10) / 10, a, b, medianA: mA, medianB: mB };
  }

  /**
   * Veredito do teste inteiro: por métrica e geral (pesos do objetivo).
   * overall: ganho | perda | empate | misto | inconclusivo; keep: 'B' só com ganho.
   */
  function verdict(state) {
    const boots = (state?.boots || []).filter((boot) => boot.quiet !== false);
    const metrics = METRICS.map((metric) => ({ ...judgeMetric(metric, boots), label: metric.label, unit: metric.unit, better: metric.better, group: metric.group }));
    const weights = GOALS[state?.goal]?.weights || GOALS.geral.weights;
    let sum = 0;
    let total = 0;
    for (const item of metrics) {
      const weight = weights[item.id] || 0;
      if (!weight || !finite(item.gainPct) || item.verdict === 'inconclusivo') continue;
      sum += weight * (item.verdict === 'sem-diferenca' ? 0 : item.gainPct);
      total += weight;
    }
    const composite = total ? Math.round((sum / total) * 10) / 10 : null;
    const weighted = metrics.filter((item) => (weights[item.id] || 0) >= 1);
    const improved = weighted.filter((item) => item.verdict === 'melhorou');
    const worse = weighted.filter((item) => item.verdict === 'piorou');
    const neutral = weighted.filter((item) => item.verdict === 'sem-diferenca');
    let overall = 'inconclusivo';
    if (improved.length && worse.length) overall = 'misto';
    else if (worse.length && (!finite(composite) || composite < 0)) overall = 'perda';
    else if (improved.length && finite(composite) && composite >= 2) overall = 'ganho';
    else if (!improved.length && !worse.length && neutral.length >= Math.max(1, Math.ceil(weighted.length / 2))) overall = 'empate';
    const counts = { A: boots.filter((boot) => boot.config === 'A').length, B: boots.filter((boot) => boot.config === 'B').length };
    return { overall, composite, keep: overall === 'ganho' ? 'B' : 'A', metrics, counts, improved: improved.map((item) => item.id), worse: worse.map((item) => item.id), discarded: (state?.boots || []).length - boots.length };
  }

  const OVERALL_TEXT = {
    ganho: 'Os ajustes deixaram o PC mais rápido nos dois lados do teste, acima da diferença entre boots iguais.',
    perda: 'Com os ajustes o PC ficou mais lento. O melhor é voltar ao que estava.',
    misto: 'Melhorou em uma coisa e piorou em outra. Veja a tabela e decida o que pesa mais para você.',
    empate: 'Não mudou nada que dê para medir. Os ajustes podem ficar ou sair; o Nexo recomenda voltar ao original.',
    inconclusivo: 'A diferença ficou dentro da variação normal entre um boot e outro. Rode a ordem longa para ter certeza.'
  };

  /** Valida o estado lido do disco (arquivo pode estar corrompido ou ser de outra versão). */
  function sanitizeState(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return null;
    if (!['running', 'done', 'cancelled', 'failed'].includes(raw.status)) return null;
    if (!PROTOCOLS[raw.protocol] || !Array.isArray(raw.order) || raw.order.join() !== PROTOCOLS[raw.protocol].order.join()) return null;
    if (!Array.isArray(raw.changes) || !raw.changes.length || !raw.changes.every(validChange)) return null;
    if (!Number.isInteger(raw.step) || raw.step < 0 || raw.step > raw.order.length) return null;
    if (!['A', 'B'].includes(raw.applied)) return null;
    const boots = Array.isArray(raw.boots) ? raw.boots.slice(0, raw.order.length).map((boot, index) => ({ ...cleanBoot(boot), step: index, config: raw.order[index], bootAt: finite(boot?.bootAt) ? boot.bootAt : null, measuredAt: finite(boot?.measuredAt) ? boot.measuredAt : null, quiet: boot?.quiet !== false, viaRunOnce: Boolean(boot?.viaRunOnce), onBattery: Boolean(boot?.onBattery) })) : [];
    return { ...raw, goal: GOALS[raw.goal] ? raw.goal : 'geral', boots, phase: ['await-reboot', 'measuring'].includes(raw.phase) ? raw.phase : 'await-reboot', armedAt: finite(raw.armedAt) ? raw.armedAt : 0 };
  }

  /** Changes para o Raio-X gravar a configuração A (valores anteriores, como reversão) ou B. */
  function changesFor(state, config) {
    return state.changes.map((change) => (config === 'A' ? { id: change.id, values: change.before, revert: true } : { id: change.id, values: change.after }));
  }

  return { VERSION, PROTOCOLS, METRICS, METRIC, BENCHES, GOALS, LIMITS, OVERALL_TEXT, median, halfRangePct, createPlan, permissionCount, nextAction, markSwitched, markArmed, markMeasuring, recordBoot, judgeMetric, verdict, sanitizeState, changesFor, cleanBoot };
});
