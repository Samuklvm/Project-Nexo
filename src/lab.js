/*
 * Laboratório do Nexo — "Otimização extrema (beta)".
 *
 * Um motor de experimentos autônomo, mas confinado:
 *  - só mexe num ESPAÇO FECHADO de ajustes reversíveis (configurações do processador num CLONE do plano de energia);
 *  - cada ideia é testada NA HORA, neste PC, com medição A/B intercalada contra o ruído medido — sem presunção nem boato;
 *  - guardas de segurança (bateria, temperatura, aquecimento, erros graves do Windows) abortam o teste no ato;
 *  - tudo volta ao estado original no fim, aconteça o que acontecer (finally); se a volta falhar, a trava fica
 *    para o Nexo recuperar na próxima abertura;
 *  - aprende entre execuções: guarda evidência por ajuste e escolhe o próximo com prioridade para o que nunca
 *    foi testado aqui e, depois, pelo critério UCB (ganho médio + bônus de incerteza); o que disparou guarda vira tabu.
 *
 * "Inédito" aqui significa honestamente "nunca testado NESTE computador" — combinações de ajustes ocultos que quase
 * ninguém mexe. O Nexo não gera comandos em tempo de execução: o sistema real é injetado (electron/lab-system.cjs).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lab-space.js'));
  else root.NexoLab = factory(root.NexoLabSpace);
})(typeof self !== 'undefined' ? self : this, function (LabSpace) {
  /** Espaço fechado de ajustes (src/lab-space.js). Nada fora daqui pode ser aplicado (validateStep). */
  const SPACE = LabSpace.SPACE;
  const GROUPS = LabSpace.GROUPS;
  /* No Linux o laboratório testa os perfis do power-profiles-daemon (sem root). Ajustes finos do processador no Linux
     (EPP, governador) exigem root a cada mudança, e o Nexo não roda como root. */
  const LINUX_SPACE = [
    { id: 'ppd', group: 'desempenho', sub: 'PPD', setting: 'PROFILE', label: 'Perfil de energia do sistema', values: [2, 1, 0], risk: 'baixo', novelty: 'conhecido', hidden: false, platform: 'linux', affects: ['single', 'multi', 'burst'],
      names: { 0: 'Economia de energia', 1: 'Equilibrado', 2: 'Desempenho' },
      what: 'O perfil do power-profiles-daemon muda limites de frequência, EPP e plataforma de uma vez, do jeito que o fabricante e o kernel definiram.' }
  ];
  const ALL = [...SPACE, ...LINUX_SPACE];
  const KNOB = new Map(ALL.map((knob) => [knob.id, knob]));
  const RISK_RANK = { baixo: 1, moderado: 2, alto: 3 };
  const NOVELTY_BONUS = { raro: 3, 'pouco-conhecido': 2, conhecido: 0 };

  const BENCHES = ['single', 'multi', 'burst', 'latency', 'disk'];
  const BENCH_LABEL = { single: 'um núcleo', multi: 'todos os núcleos', burst: 'rajadas curtas (resposta)', latency: 'latência para acordar um núcleo', disk: 'disco (gravações curtas com pausas)' };
  /** Objetivo da sessão: o peso de cada teste no ganho composto. */
  const GOALS = {
    jogos: { label: 'Jogos', weights: { single: 0.3, burst: 0.3, latency: 0.3, multi: 0.1, disk: 0.15 } },
    geral: { label: 'Uso geral', weights: { single: 0.25, multi: 0.25, burst: 0.25, latency: 0.15, disk: 0.2 } },
    pesado: { label: 'Trabalho pesado', weights: { multi: 0.55, single: 0.2, burst: 0.1, latency: 0.05, disk: 0.15 } },
    resposta: { label: 'Resposta instantânea', weights: { burst: 0.35, latency: 0.45, single: 0.15, disk: 0.2 } }
  };
  const DEFAULT_LIMITS = { maxTempC: 88, maxTempRiseC: 12, minEffectPct: 3, maxNoisePct: 12, settleMs: 1500, screenPairs: 2, pairs: 3, confirmPairs: 5, budgetMs: 20 * 60 * 1000 };
  const CONSENT_PHRASE = 'ENTENDO O RISCO';

  class GuardError extends Error {
    constructor(code, message, extra = {}) { super(message); this.name = 'GuardError'; this.code = code; Object.assign(this, extra); }
  }

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const median = (list) => { const v = list.filter(finite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const round1 = (value) => Math.round(value * 10) / 10;
  const armKey = (arm) => `${arm.knob}=${arm.value}`;
  const comboKey = (keys) => `combo:${[...keys].sort().join('+')}`;
  const valueLabel = (knob, value) => (knob.names?.[value] ? `${knob.names[value]}` : `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${knob.unit || ''}`);
  const benchesOf = (knob) => (knob?.affects || ['single', 'multi', 'burst']).filter((bench) => BENCHES.includes(bench));

  /** Valores que este PC aceita para o ajuste: o catálogo cortado pela faixa/índices que o próprio powercfg informou. */
  function supportedValues(knob, info) {
    if (!info) return knob.values;
    if (Array.isArray(info.indexes) && info.indexes.length) return knob.values.filter((value) => info.indexes.includes(value));
    if (finite(info.min) && finite(info.max)) return knob.values.filter((value) => value >= info.min && value <= info.max);
    if (Array.isArray(info.values)) return knob.values.filter((value) => info.values.includes(value));
    return knob.values;
  }

  /** Só valores do espaço fechado — ou o valor original deste PC, para poder voltar a ele. */
  function validateStep(knobId, value, baselineValue) {
    const knob = KNOB.get(knobId);
    if (!knob) throw new GuardError('fora-do-espaco', `Ajuste desconhecido: ${String(knobId).slice(0, 40)}.`);
    const max = finite(knob.max) ? Math.max(100, knob.max) : 100;
    const isBaseline = value === baselineValue && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
    if (!isBaseline && (!Number.isInteger(value) || value < 0 || value > max)) throw new GuardError('fora-do-espaco', `Valor inválido para ${knob.label}.`);
    if (!knob.values.includes(value) && !isBaseline) throw new GuardError('fora-do-espaco', `${valueLabel(knob, value)} não faz parte do espaço revisado de ${knob.label}.`);
    return knob;
  }

  /**
   * Escolhe as próximas ideias: primeiro as nunca testadas aqui (menor risco e mais promissoras primeiro), espalhadas
   * entre os grupos; depois UCB (ganho médio + bônus de incerteza). Tabu fica de fora.
   * support: { id: { indexes | min/max } } lido do PC; hybrid: false tira os ajustes de núcleos de eficiência.
   */
  function chooseCandidates({ baseline = {}, evidence = {}, tabu = [], count = 4, allowRisk = 'moderado', support = null, hybrid = null } = {}) {
    const blocked = new Set(tabu);
    const maxRisk = RISK_RANK[allowRisk] || 1;
    const total = Object.entries(evidence).filter(([key]) => !key.startsWith('combo:')).reduce((sum, [, item]) => sum + (item?.n || 0), 0);
    const arms = [];
    for (const knob of ALL) {
      if (!finite(baseline[knob.id])) continue;
      if ((RISK_RANK[knob.risk] || 9) > maxRisk) continue;
      if (knob.hybrid && hybrid === false) continue;
      supportedValues(knob, support?.[knob.id]).forEach((value, index) => {
        if (value === baseline[knob.id]) return;
        const arm = { knob: knob.id, value };
        const key = armKey(arm);
        if (blocked.has(key)) return;
        const seen = evidence[key];
        const untested = !seen || !seen.n;
        const bonus = untested ? 0 : 3 * Math.sqrt(Math.log(total + 1) / seen.n);
        const score = untested ? 1000 - (RISK_RANK[knob.risk] || 1) * 10 + (NOVELTY_BONUS[knob.novelty] || 0) - index * 0.5 : (seen.mean || 0) + bonus;
        arms.push({ ...arm, key, untested, score, risk: knob.risk, group: knob.group, benches: benchesOf(knob), novelty: untested ? 'inedito-aqui' : knob.novelty });
      });
    }
    arms.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    const picked = [];
    const usedKnobs = new Set();
    const perGroup = new Map();
    const limit = Math.max(1, Math.ceil(count / 5));
    // 1ª passada: um valor por ajuste, no máximo alguns por grupo (variedade); 2ª: um por ajuste; 3ª: o que sobrar.
    for (const arm of arms) { if (picked.length >= count) break; if (!usedKnobs.has(arm.knob) && (perGroup.get(arm.group) || 0) < limit) { picked.push(arm); usedKnobs.add(arm.knob); perGroup.set(arm.group, (perGroup.get(arm.group) || 0) + 1); } }
    for (const arm of arms) { if (picked.length >= count) break; if (!usedKnobs.has(arm.knob)) { picked.push(arm); usedKnobs.add(arm.knob); } }
    for (const arm of arms) { if (picked.length >= count) break; if (!picked.includes(arm)) picked.push(arm); }
    return picked;
  }

  /** Números do espaço neste PC: ajustes, opções (valores) e combinações possíveis (cada ajuste: original ou um valor). */
  function spaceStats({ baseline = null, support = null, hybrid = null, allowRisk = 'alto', platform = 'win32' } = {}) {
    const maxRisk = RISK_RANK[allowRisk] || 3;
    let knobs = 0;
    let options = 0;
    let log10 = 0;
    for (const knob of platform === 'linux' ? LINUX_SPACE : SPACE) {
      if (baseline && !finite(baseline[knob.id])) continue;
      if ((RISK_RANK[knob.risk] || 9) > maxRisk) continue;
      if (knob.hybrid && hybrid === false) continue;
      const values = supportedValues(knob, support?.[knob.id]).filter((value) => !baseline || value !== baseline[knob.id]);
      if (!values.length) continue;
      knobs += 1;
      options += values.length;
      log10 += Math.log10(values.length + 1);
    }
    return { knobs, options, log10: Math.round(log10 * 10) / 10, combinations: log10 < 15 ? Math.round(10 ** log10) : null };
  }

  /** Média corrente do ganho composto por ajuste; guardas e pioras contam à parte. */
  function updateEvidence(evidence, key, { delta = null, verdict = null, guard = false } = {}, now = Date.now()) {
    const previous = evidence[key] || { n: 0, mean: 0, wins: 0, losses: 0, guards: 0 };
    const next = { ...previous, lastAt: now, lastVerdict: guard ? 'guarda' : verdict };
    if (guard) next.guards += 1;
    if (finite(delta)) { next.n += 1; next.mean = previous.mean + (delta - previous.mean) / next.n; }
    if (verdict === 'melhorou') next.wins += 1;
    if (verdict === 'piorou' || verdict === 'misto') next.losses += 1;
    return { ...evidence, [key]: next };
  }

  /** Guardas avaliadas depois de CADA medição. */
  function evaluateGuards({ sample, startTemp, errorCount = 0, limits = DEFAULT_LIMITS }) {
    if (sample?.onBattery) return { ok: false, code: 'bateria', reason: 'O PC passou a usar a bateria; o teste parou.' };
    if (!finite(sample?.tempC)) return { ok: false, code: 'sem-temperatura', reason: 'A leitura de temperatura sumiu; sem ela o laboratório não continua.' };
    if (sample.tempC >= limits.maxTempC) return { ok: false, code: 'temperatura', reason: `O processador chegou a ${Math.round(sample.tempC)} °C (limite ${limits.maxTempC} °C).` };
    if (finite(startTemp) && sample.tempC - startTemp >= limits.maxTempRiseC) return { ok: false, code: 'aquecimento', reason: `A temperatura subiu ${Math.round(sample.tempC - startTemp)} °C desde o início (limite ${limits.maxTempRiseC} °C).` };
    if (errorCount > 0) return { ok: false, code: 'erros-windows', reason: `O Windows registrou ${errorCount} erro(s) grave(s) de hardware, energia ou vídeo durante o teste.` };
    return { ok: true };
  }

  /** Pré-condições. Consentimento reforçado: a pessoa digita a frase. */
  function assertRunnable(pre, consent) {
    if (!consent || consent.acknowledged !== true || String(consent.phrase || '').trim().toUpperCase() !== CONSENT_PHRASE) throw new GuardError('consentimento', `Para iniciar, marque o aviso e digite "${CONSENT_PHRASE}".`);
    if (!pre || !['win32', 'linux'].includes(pre.platform)) throw new GuardError('plataforma', 'O laboratório funciona no Windows e no Linux.');
    if (pre.pending) throw new GuardError('pendente', 'Existe um teste anterior que não terminou. Use "Recuperar" antes de começar outro.');
    if (pre.onBattery) throw new GuardError('bateria', 'Ligue o PC na tomada: o laboratório não roda na bateria.');
    if (!finite(pre.tempC)) throw new GuardError('sem-temperatura', 'Sem leitura de temperatura do processador o laboratório não roda (é uma das guardas).');
    if (pre.tempC >= 80) throw new GuardError('quente', `O processador já está a ${Math.round(pre.tempC)} °C. Espere esfriar.`);
    if (finite(pre.cpuLoad) && pre.cpuLoad >= 50) throw new GuardError('ocupado', `O processador está ${Math.round(pre.cpuLoad)}% ocupado. Feche programas pesados para a medição ser justa.`);
    const available = ALL.filter((knob) => pre.knobs?.[knob.id]?.available);
    if (!available.length) throw new GuardError('sem-ajustes', 'Este PC não expõe nenhum dos ajustes do laboratório.');
    return available.map((knob) => knob.id);
  }

  /**
   * Compara pares intercalados (base, candidato). Ganho = mediana das razões por par; ruído = meia amplitude da base.
   * Exige consistência: a maioria dos pares precisa concordar com o sinal da mediana.
   */
  function judge(base, cand, limits = DEFAULT_LIMITS) {
    const pairs = [];
    for (let i = 0; i < Math.min(base.length, cand.length); i += 1) if (finite(base[i]) && finite(cand[i]) && base[i] > 0) pairs.push(cand[i] / base[i] - 1);
    const mb = median(base);
    const spread = base.filter(finite);
    const noisePct = mb && spread.length > 1 ? ((Math.max(...spread) - Math.min(...spread)) / 2 / mb) * 100 : null;
    if (pairs.length < 2 || !finite(noisePct)) return { verdict: 'inconclusivo', deltaPct: null, noisePct, consistency: null, confidence: 'baixa', pairs: pairs.length, reason: 'medições insuficientes' };
    const deltaPct = median(pairs) * 100;
    if (noisePct > limits.maxNoisePct) return { verdict: 'inconclusivo', deltaPct: round1(deltaPct), noisePct: round1(noisePct), consistency: null, confidence: 'baixa', pairs: pairs.length, reason: 'ruído alto demais' };
    const sign = Math.sign(deltaPct);
    const consistency = sign === 0 ? 0 : pairs.filter((value) => Math.sign(value) === sign).length / pairs.length;
    const threshold = Math.max(limits.minEffectPct, noisePct * 1.5);
    let verdict = 'sem-diferenca';
    if (Math.abs(deltaPct) > threshold && consistency >= 2 / 3) verdict = deltaPct > 0 ? 'melhorou' : 'piorou';
    const confidence = verdict === 'sem-diferenca' ? (pairs.length >= 5 ? 'media' : 'baixa') : pairs.length >= 5 && consistency === 1 ? 'alta' : 'media';
    return { verdict, deltaPct: round1(deltaPct), noisePct: round1(noisePct), consistency: round1(consistency), confidence, pairs: pairs.length, threshold: round1(threshold) };
  }

  /**
   * Veredito combinado entre os testes: qualquer piora com melhora noutro = "misto" (troca, não ganho).
   * O ganho composto é a média ponderada pelo objetivo (jogos, uso geral...) só dos testes que mediram esse ajuste.
   */
  function combine(results, weights = null) {
    const entries = Object.entries(results);
    const verdicts = entries.map(([, result]) => result.verdict);
    let sum = 0;
    let weight = 0;
    for (const [bench, result] of entries) {
      if (!finite(result.deltaPct)) continue;
      const w = weights ? (finite(weights[bench]) ? weights[bench] : 0.1) : 1;
      sum += result.deltaPct * w;
      weight += w;
    }
    const compositeDelta = weight > 0 ? round1(sum / weight) : null;
    let verdict = 'sem-diferenca';
    if (verdicts.every((v) => v === 'inconclusivo')) verdict = 'inconclusivo';
    else if (verdicts.includes('piorou') && verdicts.includes('melhorou')) verdict = 'misto';
    else if (verdicts.includes('piorou')) verdict = 'piorou';
    else if (verdicts.includes('melhorou')) verdict = 'melhorou';
    return { verdict, compositeDelta };
  }

  /** Gerador determinístico (a mesma sessão sorteia as mesmas combinações; nos testes, resultado reproduzível). */
  function rng(seed) {
    let state = (Math.floor(Math.abs(seed)) % 2147483646) + 1;
    return () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
  }

  async function applyConfig(system, current, target, baseline) {
    const changes = [];
    for (const [id, value] of Object.entries(target)) {
      if (current[id] === value) continue;
      const knob = validateStep(id, value, baseline[id]);
      changes.push({ id, sub: knob.sub, setting: knob.setting, value });
    }
    if (!changes.length) return;
    await system.apply(changes);
    for (const change of changes) current[change.id] = change.value;
  }

  /**
   * Executa uma sessão de risco. `system` é o adaptador do Windows (ou um simulado nos testes).
   * options: consent, autonomy ('assistido' | 'autonomo'), goal (jogos | geral | pesado | resposta), maxArms, combos,
   *          wild (exploração radical), limits, evidence, tabu, allowRisk, requireRestorePoint, signal ({ cancelled }), emit(event)
   *
   * Etapas: pré-checagem → ponto de restauração → clone do plano → aquecimento → triagem (2 pares; quem promete ganha
   * mais pares) → combinações inéditas → confirmação (5 pares) → restauração. Guardas depois de cada medição.
   */
  async function run(system, options = {}) {
    const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    const goal = GOALS[options.goal] ? options.goal : 'geral';
    const weights = GOALS[goal].weights;
    const emit = typeof options.emit === 'function' ? options.emit : () => {};
    const now = system.now || (() => Date.now());
    const signal = options.signal || {};
    const startedAt = now();
    const random = rng(startedAt || 1);
    const comboCount = Math.max(0, Math.min(8, Number.isInteger(options.combos) ? options.combos : 2));
    const result = { riskSession: true, startedAt, endedAt: null, status: 'running', reason: null, autonomy: options.autonomy === 'autonomo' ? 'autonomo' : 'assistido', goal,
      restorePoint: null, baseline: null, arms: [], combos: [], combination: null, adopted: null, evidence: { ...(options.evidence || {}) }, tabu: [...(options.tabu || [])], log: [], restoreFailed: false, budgetHit: false, stats: null };
    const say = (message) => { const entry = { t: now(), message }; result.log.push(entry); emit({ type: 'log', ...entry }); };
    const stage = (name, detail = '') => emit({ type: 'stage', stage: name, detail });
    const checkCancel = () => { if (signal.cancelled) throw new GuardError('cancelado', 'Você cancelou o teste.'); };
    const overBudget = () => now() - startedAt > limits.budgetMs;
    let began = false;
    let startTemp = null;
    const current = {};

    const measure = async (bench, arm) => {
      checkCancel();
      const score = await system.bench(bench);
      const sample = await system.sample();
      const errorCount = await system.errorEventsSince(startedAt);
      const guard = evaluateGuards({ sample, startTemp, errorCount, limits });
      if (!guard.ok) throw new GuardError(guard.code, guard.reason, { arm });
      return { score, tempC: sample.tempC };
    };

    /** Pares intercalados (base, candidato). `previous` junta medições de uma rodada anterior do mesmo teste. */
    const abTest = async (config, pairs, arm, benches, label, previous = null) => {
      const base = previous?.raw.base || Object.fromEntries(benches.map((bench) => [bench, []]));
      const cand = previous?.raw.cand || Object.fromEntries(benches.map((bench) => [bench, []]));
      const temps = previous?.raw.temps || { base: [], cand: [] };
      for (let i = 0; i < pairs; i += 1) {
        for (const side of ['base', 'cand']) {
          await applyConfig(system, current, side === 'base' ? result.baseline : config, result.baseline);
          await system.sleep(limits.settleMs);
          for (const bench of benches) {
            const reading = await measure(bench, arm);
            (side === 'base' ? base : cand)[bench].push(reading.score);
            temps[side].push(reading.tempC);
          }
        }
        emit({ type: 'trial', arm: label, pair: i + 1, pairs });
      }
      const results = Object.fromEntries(benches.map((bench) => [bench, judge(base[bench], cand[bench], limits)]));
      const tempDelta = finite(median(temps.cand)) && finite(median(temps.base)) ? round1(median(temps.cand) - median(temps.base)) : null;
      return { results, tempDelta, ...combine(results, weights), raw: { base, cand, temps }, pairsDone: (previous?.pairsDone || 0) + pairs };
    };
    const strip = ({ raw, ...rest }) => rest;
    const describe = (keys) => keys.map((key) => { const [id, value] = key.split('='); const knob = KNOB.get(id); return `${knob?.label || id} → ${knob ? valueLabel(knob, Number(value)) : value}`; }).join(' + ');
    const configOf = (keys) => { const config = { ...result.baseline }; for (const key of keys) { const [id, value] = key.split('='); config[id] = Number(value); } return config; };
    const benchesFor = (keys) => [...new Set(keys.flatMap((key) => benchesOf(KNOB.get(key.split('=')[0]))))].filter((bench) => BENCHES.includes(bench));

    try {
      stage('preflight', 'Conferindo se é seguro começar');
      const pre = await system.preflight();
      const available = assertRunnable(pre, options.consent);
      startTemp = pre.tempC;
      const support = Object.fromEntries(Object.entries(pre.knobs || {}).filter(([, info]) => info?.available));
      say(`Pré-checagem ok: na tomada, ${Math.round(pre.tempC)} °C, processador ${finite(pre.cpuLoad) ? `${Math.round(pre.cpuLoad)}%` : '?'} ocupado. Ajustes disponíveis neste PC: ${available.length}${pre.hybrid === true ? ' (processador híbrido)' : ''}. Objetivo: ${GOALS[goal].label}.`);

      stage('ponto', 'Criando ponto de restauração do Windows');
      checkCancel();
      result.restorePoint = await system.createRestorePoint();
      if (result.restorePoint?.ok) say(result.restorePoint.created ? 'Ponto de restauração criado.' : `Ponto de restauração: ${result.restorePoint.note || 'usando um recente'}.`);
      else if (options.requireRestorePoint !== false) throw new GuardError('sem-ponto', `Sem ponto de restauração o teste não começa (${result.restorePoint?.note || 'motivo desconhecido'}).`);
      else say(`Seguindo sem ponto de restauração, como você escolheu (${result.restorePoint?.note || 'falhou'}). O plano original continua intacto.`);

      stage('preparar', 'Clonando o plano de energia para o ambiente de testes');
      checkCancel();
      began = true;
      await system.begin();
      result.baseline = await system.readConfig();
      Object.assign(current, result.baseline);
      result.stats = spaceStats({ baseline: result.baseline, support, hybrid: pre.hybrid ?? null, allowRisk: options.allowRisk || 'moderado', platform: pre.platform });
      say(`Ambiente de testes pronto: um clone do seu plano, que é apagado no fim. ${result.stats.knobs} ajustes e ${result.stats.options} opções liberados para este PC (cerca de 10^${result.stats.log10} combinações possíveis).`);

      const candidates = chooseCandidates({ baseline: result.baseline, evidence: result.evidence, tabu: result.tabu, count: Math.max(1, Math.min(48, options.maxArms || 4)), allowRisk: options.allowRisk || 'moderado', support, hybrid: pre.hybrid ?? null });
      const sessionBenches = [...new Set(candidates.flatMap((arm) => arm.benches))];
      stage('aquecer', 'Aquecendo para estabilizar a medição');
      for (const bench of sessionBenches.length ? sessionBenches : ['single']) await measure(bench, null);
      say(candidates.length ? `Ideias escolhidas para hoje: ${candidates.map((arm) => `${KNOB.get(arm.knob).label} → ${valueLabel(KNOB.get(arm.knob), arm.value)}${arm.untested ? ' (inédito aqui)' : ''}`).join('; ')}.` : 'Nenhuma ideia nova: tudo o que o espaço permite já foi testado ou bloqueado.');

      /* Triagem em duas etapas: todos ganham 2 pares; quem mostra sinal de ganho ganha mais pares antes do veredito. */
      for (const arm of candidates) {
        if (overBudget()) { result.budgetHit = true; say('Tempo máximo da sessão atingido; o restante fica para a próxima.'); break; }
        const knob = KNOB.get(arm.knob);
        stage('testar', `${knob.label}: ${valueLabel(knob, result.baseline[arm.knob])} → ${valueLabel(knob, arm.value)}`);
        const config = { ...result.baseline, [arm.knob]: arm.value };
        const screenPairs = Math.min(limits.screenPairs, limits.pairs);
        let outcome = await abTest(config, screenPairs, arm, arm.benches, arm.key);
        const promising = outcome.verdict === 'melhorou' || (finite(outcome.compositeDelta) && outcome.compositeDelta > limits.minEffectPct / 2 && outcome.verdict !== 'piorou');
        if (promising && limits.pairs > screenPairs && !overBudget()) outcome = await abTest(config, limits.pairs - screenPairs, arm, arm.benches, arm.key, outcome);
        const record = { key: arm.key, knob: arm.knob, group: knob.group, value: arm.value, from: result.baseline[arm.knob], label: knob.label, valueLabel: valueLabel(knob, arm.value), fromLabel: valueLabel(knob, result.baseline[arm.knob]), risk: knob.risk, novelty: arm.novelty, benches: arm.benches, ...strip(outcome) };
        result.arms.push(record);
        result.evidence = updateEvidence(result.evidence, arm.key, { delta: outcome.compositeDelta, verdict: outcome.verdict }, now());
        emit({ type: 'arm', arm: record });
        say(`${knob.label} → ${record.valueLabel}: ${outcome.verdict}${finite(outcome.compositeDelta) ? ` (${outcome.compositeDelta > 0 ? '+' : ''}${outcome.compositeDelta}%)` : ''}${outcome.pairsDone > screenPairs ? `, com ${outcome.pairsDone} pares` : ''}.`);
      }

      const winners = new Map();
      for (const arm of result.arms) {
        if (arm.verdict !== 'melhorou') continue;
        const best = winners.get(arm.knob);
        if (!best || arm.compositeDelta > best.compositeDelta) winners.set(arm.knob, arm);
      }
      const chosen = [...winners.values()].sort((a, b) => b.compositeDelta - a.compositeDelta).slice(0, 4);

      /* Combinações inéditas: ajustes que, sozinhos, deram sinal de ganho (ou ficaram neutros) podem render juntos.
         Na exploração radical, entram também ajustes que ninguém testou neste PC, de grupos diferentes. */
      const pool = result.arms.filter((arm) => ['melhorou', 'sem-diferenca'].includes(arm.verdict) && finite(arm.compositeDelta) && arm.compositeDelta > 0).sort((a, b) => b.compositeDelta - a.compositeDelta);
      const wildPool = options.wild ? chooseCandidates({ baseline: result.baseline, evidence: result.evidence, tabu: result.tabu, count: 24, allowRisk: options.allowRisk || 'moderado', support, hybrid: pre.hybrid ?? null }).filter((arm) => arm.untested) : [];
      const tried = new Set([...Object.keys(result.evidence).filter((key) => key.startsWith('combo:') && result.evidence[key]?.n), ...result.tabu]);
      const chosenKey = chosen.length > 1 ? comboKey(chosen.map((arm) => arm.key)) : null;
      const novel = [];
      for (let attempt = 0; attempt < 60 && novel.length < comboCount; attempt += 1) {
        const source = [...pool.map((arm) => ({ key: arm.key, knob: arm.knob, group: arm.group })), ...wildPool.map((arm) => ({ key: arm.key, knob: arm.knob, group: arm.group }))];
        if (source.length < 2) break;
        const size = Math.min(source.length, 2 + Math.floor(random() * 3));
        const keys = [];
        const knobs = new Set();
        for (let tries = 0; tries < 20 && keys.length < size; tries += 1) {
          const item = source[Math.floor(random() * source.length)];
          if (knobs.has(item.knob)) continue;
          knobs.add(item.knob); keys.push(item.key);
        }
        if (keys.length < 2) continue;
        const key = comboKey(keys);
        if (key === chosenKey || tried.has(key) || novel.some((combo) => combo.key === key)) continue;
        novel.push({ key, keys, wild: keys.some((k) => wildPool.some((arm) => arm.key === k)) });
      }
      for (const combo of novel) {
        if (overBudget()) { result.budgetHit = true; say('Tempo máximo atingido antes de terminar as combinações.'); break; }
        stage('combinar', `Combinação inédita: ${describe(combo.keys)}`);
        const outcome = await abTest(configOf(combo.keys), limits.pairs, { knob: 'combo', value: 0, comboKey: combo.key }, benchesFor(combo.keys), 'combinacao');
        const record = { key: combo.key, keys: combo.keys, wild: combo.wild, label: describe(combo.keys), ...strip(outcome) };
        result.combos.push(record);
        result.evidence = updateEvidence(result.evidence, combo.key, { delta: outcome.compositeDelta, verdict: outcome.verdict }, now());
        emit({ type: 'combo', combo: record });
        say(`Combinação inédita ${describe(combo.keys)}: ${outcome.verdict}${finite(outcome.compositeDelta) ? ` (${outcome.compositeDelta > 0 ? '+' : ''}${outcome.compositeDelta}%)` : ''}.`);
      }

      /* Confirmação: a melhor candidata (os vencedores juntos e/ou a melhor combinação inédita) com 5 pares. */
      const finalists = [];
      if (chosen.length) finalists.push({ keys: chosen.map((arm) => arm.key), expected: Math.max(...chosen.map((arm) => arm.compositeDelta)) });
      const bestNovel = result.combos.filter((combo) => combo.verdict === 'melhorou').sort((a, b) => b.compositeDelta - a.compositeDelta)[0];
      if (bestNovel && (!finalists.length || bestNovel.compositeDelta > finalists[0].expected)) finalists.push({ keys: bestNovel.keys, expected: bestNovel.compositeDelta });
      for (const finalist of finalists) {
        if (result.budgetHit || overBudget()) { result.budgetHit = true; break; }
        stage('confirmar', `Confirmando ${finalist.keys.length > 1 ? `a combinação (${finalist.keys.length} ajustes)` : 'o melhor ajuste'} com ${limits.confirmPairs} repetições`);
        const outcome = strip(await abTest(configOf(finalist.keys), limits.confirmPairs, null, benchesFor(finalist.keys), 'combinacao'));
        const confirmed = { config: configOf(finalist.keys), knobs: finalist.keys, replicates: limits.confirmPairs, ...outcome };
        if (finalist.keys.length > 1) result.evidence = updateEvidence(result.evidence, comboKey(finalist.keys), { delta: outcome.compositeDelta, verdict: outcome.verdict }, now());
        emit({ type: 'combination', combination: confirmed });
        say(`Confirmação de ${describe(finalist.keys)}: ${outcome.verdict}${finite(outcome.compositeDelta) ? ` (${outcome.compositeDelta > 0 ? '+' : ''}${outcome.compositeDelta}%)` : ''}.`);
        const better = !result.combination || (confirmed.verdict === 'melhorou' && (result.combination.verdict !== 'melhorou' || confirmed.compositeDelta > result.combination.compositeDelta));
        if (better) result.combination = confirmed;
      }
      result.status = 'completed';
    } catch (error) {
      if (error instanceof GuardError) {
        result.status = error.code === 'cancelado' ? 'cancelled' : 'aborted';
        result.reason = error.message;
        result.guard = error.code;
        if (error.arm) {
          const key = error.arm.comboKey || armKey(error.arm);
          result.evidence = updateEvidence(result.evidence, key, { guard: true }, now());
          if (!result.tabu.includes(key)) result.tabu.push(key);
          say(`Guarda disparada durante ${error.arm.comboKey ? 'uma combinação' : key}: ${error.message} ${error.arm.comboKey ? 'Essa combinação' : 'Esse ajuste'} não será mais tentado neste PC.`);
        } else say(error.message);
      } else {
        result.status = 'aborted';
        result.reason = `Erro inesperado: ${error?.message || error}`;
        say(result.reason);
      }
    } finally {
      if (began) {
        stage('restaurar', 'Voltando ao plano original');
        try { const restored = await system.restore(); result.restoreFailed = !restored?.ok; }
        catch { result.restoreFailed = true; }
        say(result.restoreFailed ? 'ATENÇÃO: não consegui voltar ao plano original agora. O Nexo tenta de novo na próxima abertura (trava de recuperação mantida).' : 'Plano original de volta; o clone de testes foi apagado.');
      }
    }

    if (began && !result.restoreFailed && result.status === 'completed' && result.combination?.verdict === 'melhorou' && result.autonomy === 'autonomo' && result.combination.replicates >= limits.confirmPairs) {
      try {
        result.adopted = await system.adopt(result.combination.config);
        say(`Modo autônomo: a combinação confirmada foi adotada como o plano "${result.adopted?.name || 'Nexo — Ajustado'}". Dá para reverter pelo Diário.`);
      } catch (error) { say(`Não consegui adotar a combinação: ${error?.message || error}.`); }
    }
    if (began && !result.restoreFailed) { try { await system.finish(); } catch { /* a trava será limpa na recuperação */ } }
    result.endedAt = now();
    stage('fim', result.status);
    emit({ type: 'done', result });
    return result;
  }

  /** Higieniza evidência e tabu vindos do armazenamento do navegador antes de entrar no motor. */
  function sanitizeMemory(evidence, tabu) {
    const clean = {};
    const validArm = (key) => { const [id, raw, extra] = String(key).split('='); const knob = KNOB.get(id); return extra === undefined && knob && /^\d+$/.test(raw || '') && knob.values.includes(Number(raw)); };
    const valid = (key) => {
      const text = String(key);
      if (!text.startsWith('combo:')) return validArm(text);
      const parts = text.slice(6).split('+');
      return parts.length >= 2 && parts.length <= 6 && parts.every(validArm) && new Set(parts.map((part) => part.split('=')[0])).size === parts.length;
    };
    for (const [key, item] of Object.entries(evidence && typeof evidence === 'object' ? evidence : {})) {
      if (!valid(key) || !item || typeof item !== 'object') continue;
      clean[key] = { n: Math.max(0, Math.min(1000, Math.floor(item.n) || 0)), mean: finite(item.mean) ? Math.max(-100, Math.min(100, item.mean)) : 0,
        wins: Math.max(0, Math.floor(item.wins) || 0), losses: Math.max(0, Math.floor(item.losses) || 0), guards: Math.max(0, Math.floor(item.guards) || 0), lastAt: finite(item.lastAt) ? item.lastAt : null, lastVerdict: typeof item.lastVerdict === 'string' ? item.lastVerdict.slice(0, 20) : null };
    }
    return { evidence: clean, tabu: (Array.isArray(tabu) ? tabu : []).filter(valid).slice(0, 256) };
  }

  const spaceFor = (platform) => (platform === 'linux' ? LINUX_SPACE : SPACE);
  return { SPACE, LINUX_SPACE, GROUPS, GOALS, spaceFor, BENCHES, BENCH_LABEL, DEFAULT_LIMITS, CONSENT_PHRASE, GuardError, validateStep, chooseCandidates, supportedValues, spaceStats, updateEvidence, evaluateGuards, assertRunnable, judge, combine, run, armKey, comboKey, valueLabel, benchesOf, sanitizeMemory, knob: (id) => KNOB.get(id) || null };
});
