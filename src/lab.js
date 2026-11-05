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
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoLab = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SUB = 'SUB_PROCESSOR';

  /** Espaço fechado de ajustes. Nada fora daqui pode ser aplicado (validateStep). */
  const SPACE = [
    { id: 'perfepp', sub: SUB, setting: 'PERFEPP', label: 'Preferência de desempenho energético (EPP)', values: [0, 15, 33, 50], unit: '%', risk: 'baixo', novelty: 'pouco-conhecido', hidden: true,
      what: 'Diz ao processador o quanto priorizar desempenho (0) ou economia (100) quando ele mesmo escolhe a frequência.' },
    { id: 'boostmode', sub: SUB, setting: 'PERFBOOSTMODE', label: 'Modo de aceleração (boost)', values: [0, 1, 2, 3, 4], risk: 'moderado', novelty: 'pouco-conhecido', hidden: true,
      names: { 0: 'Desativado', 1: 'Ativado', 2: 'Agressivo', 3: 'Eficiente', 4: 'Eficiente agressivo' },
      what: 'Como o processador usa o turbo acima da frequência base. "Agressivo" pode aquecer mais.' },
    { id: 'minstate', sub: SUB, setting: 'PROCTHROTTLEMIN', label: 'Estado mínimo do processador', values: [5, 50, 100], unit: '%', risk: 'baixo', novelty: 'conhecido', hidden: false,
      what: 'O piso de desempenho do processador. Um piso alto evita a demora para acelerar, ao custo de mais consumo parado.' },
    { id: 'mincores', sub: SUB, setting: 'CPMINCORES', label: 'Mínimo de núcleos não estacionados', values: [10, 50, 100], unit: '%', risk: 'baixo', novelty: 'pouco-conhecido', hidden: true,
      what: 'Quantos núcleos ficam sempre acordados. O "estacionamento" de núcleos economiza energia, mas pode atrasar picos de carga.' },
    { id: 'incpol', sub: SUB, setting: 'PERFINCPOL', label: 'Política de aumento de desempenho', values: [0, 1, 2], risk: 'baixo', novelty: 'pouco-conhecido', hidden: true,
      names: { 0: 'Ideal', 1: 'Degrau único', 2: 'Foguete', 3: 'Ideal agressiva' },
      what: 'Como o Windows sobe a frequência quando a carga aumenta: em degraus ou direto ao máximo ("foguete").' },
    { id: 'boostpol', sub: SUB, setting: 'PERFBOOSTPOL', label: 'Política de turbo', values: [60, 100], unit: '%', risk: 'baixo', novelty: 'pouco-conhecido', hidden: true,
      what: 'O quanto o Windows insiste no turbo em processadores que dependem dele.' },
    { id: 'cooling', sub: SUB, setting: 'SYSCOOLPOL', label: 'Política de resfriamento', values: [0, 1], risk: 'baixo', novelty: 'conhecido', hidden: false,
      names: { 0: 'Passiva (reduz a velocidade antes)', 1: 'Ativa (acelera ventoinhas antes)' },
      what: 'Ao esquentar, o Windows primeiro reduz a velocidade (passiva) ou primeiro aumenta a ventilação (ativa).' }
  ];
  /* No Linux o laboratório testa os perfis do power-profiles-daemon (sem root). Ajustes finos do processador no Linux
     (EPP, governador) exigem root a cada mudança, e o Nexo não roda como root. */
  const LINUX_SPACE = [
    { id: 'ppd', sub: 'PPD', setting: 'PROFILE', label: 'Perfil de energia do sistema', values: [0, 1, 2], risk: 'baixo', novelty: 'conhecido', hidden: false, platform: 'linux',
      names: { 0: 'Economia de energia', 1: 'Equilibrado', 2: 'Desempenho' },
      what: 'O perfil do power-profiles-daemon muda limites de frequência, EPP e plataforma de uma vez, do jeito que o fabricante e o kernel definiram.' }
  ];
  const ALL = [...SPACE, ...LINUX_SPACE];
  const KNOB = new Map(ALL.map((knob) => [knob.id, knob]));
  const RISK_RANK = { baixo: 1, moderado: 2 };

  const BENCHES = ['single', 'multi', 'burst'];
  const BENCH_LABEL = { single: 'um núcleo', multi: 'todos os núcleos', burst: 'rajadas curtas (resposta)' };
  const DEFAULT_LIMITS = { maxTempC: 88, maxTempRiseC: 12, minEffectPct: 3, maxNoisePct: 12, settleMs: 1500, pairs: 3, confirmPairs: 5, budgetMs: 20 * 60 * 1000 };
  const CONSENT_PHRASE = 'ENTENDO O RISCO';

  class GuardError extends Error {
    constructor(code, message, extra = {}) { super(message); this.name = 'GuardError'; this.code = code; Object.assign(this, extra); }
  }

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const median = (list) => { const v = list.filter(finite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const round1 = (value) => Math.round(value * 10) / 10;
  const armKey = (arm) => `${arm.knob}=${arm.value}`;
  const valueLabel = (knob, value) => (knob.names?.[value] ? `${knob.names[value]}` : `${value}${knob.unit || ''}`);

  /** Só valores do espaço fechado — ou o valor original deste PC, para poder voltar a ele. */
  function validateStep(knobId, value, baselineValue) {
    const knob = KNOB.get(knobId);
    if (!knob) throw new GuardError('fora-do-espaco', `Ajuste desconhecido: ${String(knobId).slice(0, 40)}.`);
    if (!Number.isInteger(value) || value < 0 || value > 100) throw new GuardError('fora-do-espaco', `Valor inválido para ${knob.label}.`);
    if (!knob.values.includes(value) && value !== baselineValue) throw new GuardError('fora-do-espaco', `${valueLabel(knob, value)} não faz parte do espaço revisado de ${knob.label}.`);
    return knob;
  }

  /** Escolhe as próximas ideias: primeiro as nunca testadas aqui (menor risco primeiro), depois UCB. Tabu fica de fora. */
  function chooseCandidates({ baseline = {}, evidence = {}, tabu = [], count = 4, allowRisk = 'moderado' } = {}) {
    const blocked = new Set(tabu);
    const maxRisk = RISK_RANK[allowRisk] || 1;
    const total = Object.values(evidence).reduce((sum, item) => sum + (item?.n || 0), 0);
    const arms = [];
    for (const knob of ALL) {
      if (!finite(baseline[knob.id])) continue;
      if ((RISK_RANK[knob.risk] || 9) > maxRisk) continue;
      for (const value of knob.values) {
        if (value === baseline[knob.id]) continue;
        const arm = { knob: knob.id, value };
        const key = armKey(arm);
        if (blocked.has(key)) continue;
        const seen = evidence[key];
        const untested = !seen || !seen.n;
        const bonus = untested ? 0 : 3 * Math.sqrt(Math.log(total + 1) / seen.n);
        const score = untested ? 1000 - (RISK_RANK[knob.risk] || 1) * 10 + (knob.novelty === 'pouco-conhecido' ? 2 : 0) : (seen.mean || 0) + bonus;
        arms.push({ ...arm, key, untested, score, risk: knob.risk, novelty: untested ? 'inedito-aqui' : knob.novelty });
      }
    }
    arms.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    const picked = [];
    const usedKnobs = new Set();
    for (const arm of arms) { if (picked.length >= count) break; if (!usedKnobs.has(arm.knob)) { picked.push(arm); usedKnobs.add(arm.knob); } }
    for (const arm of arms) { if (picked.length >= count) break; if (!picked.includes(arm)) picked.push(arm); }
    return picked;
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

  /** Veredito combinado entre os testes: qualquer piora com melhora noutro = "misto" (troca, não ganho). */
  function combine(results) {
    const verdicts = Object.values(results).map((result) => result.verdict);
    const deltas = Object.values(results).map((result) => result.deltaPct).filter(finite);
    const compositeDelta = deltas.length ? round1(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null;
    let verdict = 'sem-diferenca';
    if (verdicts.every((v) => v === 'inconclusivo')) verdict = 'inconclusivo';
    else if (verdicts.includes('piorou') && verdicts.includes('melhorou')) verdict = 'misto';
    else if (verdicts.includes('piorou')) verdict = 'piorou';
    else if (verdicts.includes('melhorou')) verdict = 'melhorou';
    return { verdict, compositeDelta };
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
   * options: consent, autonomy ('assistido' | 'autonomo'), benches, maxArms, limits, evidence, tabu,
   *          allowRisk, requireRestorePoint, signal ({ cancelled }), emit(event)
   */
  async function run(system, options = {}) {
    const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    const benches = (options.benches || BENCHES).filter((bench) => BENCHES.includes(bench));
    const emit = typeof options.emit === 'function' ? options.emit : () => {};
    const now = system.now || (() => Date.now());
    const signal = options.signal || {};
    const startedAt = now();
    const result = { riskSession: true, startedAt, endedAt: null, status: 'running', reason: null, autonomy: options.autonomy === 'autonomo' ? 'autonomo' : 'assistido',
      restorePoint: null, baseline: null, arms: [], combination: null, adopted: null, evidence: { ...(options.evidence || {}) }, tabu: [...(options.tabu || [])], log: [], restoreFailed: false, budgetHit: false };
    const say = (message) => { const entry = { t: now(), message }; result.log.push(entry); emit({ type: 'log', ...entry }); };
    const stage = (name, detail = '') => emit({ type: 'stage', stage: name, detail });
    const checkCancel = () => { if (signal.cancelled) throw new GuardError('cancelado', 'Você cancelou o teste.'); };
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

    const abTest = async (config, pairs, arm) => {
      const base = Object.fromEntries(benches.map((bench) => [bench, []]));
      const cand = Object.fromEntries(benches.map((bench) => [bench, []]));
      const temps = { base: [], cand: [] };
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
        emit({ type: 'trial', arm: arm ? armKey(arm) : 'combinacao', pair: i + 1, pairs });
      }
      const results = Object.fromEntries(benches.map((bench) => [bench, judge(base[bench], cand[bench], limits)]));
      const tempDelta = finite(median(temps.cand)) && finite(median(temps.base)) ? round1(median(temps.cand) - median(temps.base)) : null;
      return { results, tempDelta, ...combine(results) };
    };

    try {
      stage('preflight', 'Conferindo se é seguro começar');
      const pre = await system.preflight();
      const available = assertRunnable(pre, options.consent);
      startTemp = pre.tempC;
      say(`Pré-checagem ok: na tomada, ${Math.round(pre.tempC)} °C, processador ${finite(pre.cpuLoad) ? `${Math.round(pre.cpuLoad)}%` : '?'} ocupado. Ajustes disponíveis: ${available.length}.`);

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
      say(`Ambiente de testes pronto: um clone do seu plano, que é apagado no fim. Valores originais: ${Object.entries(result.baseline).map(([id, value]) => `${KNOB.get(id)?.label || id} = ${valueLabel(KNOB.get(id) || {}, value)}`).join('; ')}.`);

      stage('aquecer', 'Aquecendo para estabilizar a medição');
      for (const bench of benches) await measure(bench, null);

      const candidates = chooseCandidates({ baseline: result.baseline, evidence: result.evidence, tabu: result.tabu, count: Math.max(1, Math.min(8, options.maxArms || 4)), allowRisk: options.allowRisk || 'moderado' });
      say(candidates.length ? `Ideias escolhidas para hoje: ${candidates.map((arm) => `${KNOB.get(arm.knob).label} → ${valueLabel(KNOB.get(arm.knob), arm.value)}${arm.untested ? ' (inédito aqui)' : ''}`).join('; ')}.` : 'Nenhuma ideia nova: tudo o que o espaço permite já foi testado ou bloqueado.');

      for (const arm of candidates) {
        if (now() - startedAt > limits.budgetMs) { result.budgetHit = true; say('Tempo máximo da sessão atingido; o restante fica para a próxima.'); break; }
        const knob = KNOB.get(arm.knob);
        stage('testar', `${knob.label}: ${valueLabel(knob, result.baseline[arm.knob])} → ${valueLabel(knob, arm.value)}`);
        const outcome = await abTest({ ...result.baseline, [arm.knob]: arm.value }, limits.pairs, arm);
        const record = { key: arm.key, knob: arm.knob, value: arm.value, from: result.baseline[arm.knob], label: knob.label, valueLabel: valueLabel(knob, arm.value), fromLabel: valueLabel(knob, result.baseline[arm.knob]), risk: knob.risk, novelty: arm.novelty, ...outcome };
        result.arms.push(record);
        result.evidence = updateEvidence(result.evidence, arm.key, { delta: outcome.compositeDelta, verdict: outcome.verdict }, now());
        emit({ type: 'arm', arm: record });
        say(`${knob.label} → ${record.valueLabel}: ${outcome.verdict}${finite(outcome.compositeDelta) ? ` (${outcome.compositeDelta > 0 ? '+' : ''}${outcome.compositeDelta}%)` : ''}.`);
      }

      const winners = new Map();
      for (const arm of result.arms) {
        if (arm.verdict !== 'melhorou') continue;
        const best = winners.get(arm.knob);
        if (!best || arm.compositeDelta > best.compositeDelta) winners.set(arm.knob, arm);
      }
      const chosen = [...winners.values()].sort((a, b) => b.compositeDelta - a.compositeDelta).slice(0, 3);
      if (chosen.length && !result.budgetHit) {
        const config = { ...result.baseline };
        for (const arm of chosen) config[arm.knob] = arm.value;
        stage('confirmar', `Confirmando a combinação (${chosen.length} ajuste${chosen.length > 1 ? 's' : ''}) com ${limits.confirmPairs} repetições`);
        const outcome = await abTest(config, limits.confirmPairs, null);
        result.combination = { config, knobs: chosen.map((arm) => arm.key), replicates: limits.confirmPairs, ...outcome };
        emit({ type: 'combination', combination: result.combination });
        say(`Combinação: ${outcome.verdict}${finite(outcome.compositeDelta) ? ` (${outcome.compositeDelta > 0 ? '+' : ''}${outcome.compositeDelta}%)` : ''}.`);
      }
      result.status = 'completed';
    } catch (error) {
      if (error instanceof GuardError) {
        result.status = error.code === 'cancelado' ? 'cancelled' : 'aborted';
        result.reason = error.message;
        result.guard = error.code;
        if (error.arm) {
          const key = armKey(error.arm);
          result.evidence = updateEvidence(result.evidence, key, { guard: true }, now());
          if (!result.tabu.includes(key)) result.tabu.push(key);
          say(`Guarda disparada durante ${key}: ${error.message} Esse ajuste não será mais tentado neste PC.`);
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
    const valid = (key) => { const [id, raw] = String(key).split('='); const knob = KNOB.get(id); return knob && /^\d+$/.test(raw || '') && knob.values.includes(Number(raw)); };
    for (const [key, item] of Object.entries(evidence && typeof evidence === 'object' ? evidence : {})) {
      if (!valid(key) || !item || typeof item !== 'object') continue;
      clean[key] = { n: Math.max(0, Math.min(1000, Math.floor(item.n) || 0)), mean: finite(item.mean) ? Math.max(-100, Math.min(100, item.mean)) : 0,
        wins: Math.max(0, Math.floor(item.wins) || 0), losses: Math.max(0, Math.floor(item.losses) || 0), guards: Math.max(0, Math.floor(item.guards) || 0), lastAt: finite(item.lastAt) ? item.lastAt : null, lastVerdict: typeof item.lastVerdict === 'string' ? item.lastVerdict.slice(0, 20) : null };
    }
    return { evidence: clean, tabu: (Array.isArray(tabu) ? tabu : []).filter(valid).slice(0, 64) };
  }

  const spaceFor = (platform) => (platform === 'linux' ? LINUX_SPACE : SPACE);
  return { SPACE, LINUX_SPACE, spaceFor, BENCHES, BENCH_LABEL, DEFAULT_LIMITS, CONSENT_PHRASE, GuardError, validateStep, chooseCandidates, updateEvidence, evaluateGuards, assertRunnable, judge, combine, run, armKey, valueLabel, sanitizeMemory, knob: (id) => KNOB.get(id) || null };
});
