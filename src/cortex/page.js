/*
 * Cortex — regras da página (src/view-cortex.js): em que grupo cada investigação entra, o estado e a confiança de cada
 * hipótese, a criatura de cada causa no diário de causas, os instrumentos que faltaram, quando a frase de consentimento
 * é pedida e se a janela da primeira escolha aparece.
 *
 * Puro: sem tela, sem disco. Lê o que cortexList/cortexGet devolvem (src/cortex/cortex.cjs list/get).
 * A frase segue a mesma regra do setSettings do processo principal: só "pedir" com teto acima de baixo, e só se o teto
 * escolhido ainda não tinha sido liberado; "sozinho" é sempre teto baixo e não pede frase.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoCortexPage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RISKS = ['baixo', 'moderado', 'alto'];
  const DAY = 86400000;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const rank = (r) => RISKS.indexOf(r);

  /** Grupo da lista: abertas | aguardando | concluidas | nao-resolvidas. */
  function group(item) {
    const s = item && item.status;
    if (s === 'aguardando') return 'aguardando';
    if (s === 'concluida') return item.verdict && item.verdict.status === 'nao-resolvido' ? 'nao-resolvidas' : 'concluidas';
    return 'abertas';
  }

  const verdictOf = (detail) => (detail && detail.conclusao && detail.conclusao.verdict) || null;

  /** Confiança atual de uma hipótese (0 a 1): a da última crença, senão a inicial do forjador. */
  function belief(h, detail) {
    const b = detail && detail.crenca && finite(detail.crenca[h.key]) ? detail.crenca[h.key] : h.prior;
    return finite(b) ? Math.max(0, Math.min(1, b)) : 0;
  }

  /** apoiada | correlacionada | derrubada | suspeita. Só o veredito afirma (o motor só derruba com teste que contradiz). */
  function hypothesisState(h, detail) {
    const v = verdictOf(detail);
    if (v && v.winner === h.key && (v.status === 'apoiada' || v.status === 'correlacionada')) return v.status;
    if (v && Array.isArray(v.refuted) && v.refuted.includes(h.key)) return 'derrubada';
    return 'suspeita';
  }

  const CREATURES = new Set(['temp_cpu', 'gpu', 'disk', 'mem', 'programa_pesado', 'cpu', 'ajuste', 'rotina', 'desconhecida']);
  const ALIAS = { temp: 'temp_cpu', page_faults: 'mem', clock_queda: 'cpu', travadas: 'cpu', quadros_ruins: 'gpu' };
  /** Criatura do diário de causas para um id de sinal. */
  function creatureOf(cause) {
    const id = String(cause || '');
    if (id.startsWith('ajuste:') || id.startsWith('bench:')) return 'ajuste';
    if (CREATURES.has(id)) return id;
    return ALIAS[id] || 'desconhecida';
  }

  const STATE_ORDER = { apoiada: 0, correlacionada: 1, suspeita: 2, derrubada: 3 };
  /** Uma entrada por causa: o melhor estado já alcançado e em quantas investigações ela apareceu. */
  function bestiary(details) {
    const byCause = new Map();
    for (const d of details || []) {
      if (!d || !Array.isArray(d.hipoteses)) continue;
      const seen = new Set();
      for (const h of d.hipoteses) {
        if (!h || !h.cause || seen.has(h.cause)) continue;
        seen.add(h.cause);
        const state = hypothesisState(h, d);
        const cur = byCause.get(h.cause) || { cause: h.cause, creature: creatureOf(h.cause), source: h.source || null, state, count: 0 };
        cur.count += 1;
        // Apoiada vence tudo; derrubada só fica se nunca passou de derrubada.
        if (STATE_ORDER[state] < STATE_ORDER[cur.state]) cur.state = state;
        byCause.set(h.cause, cur);
      }
    }
    return [...byCause.values()].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.count - a.count || a.cause.localeCompare(b.cause));
  }

  /** As necessidades guardadas (registros 'necessidade'), uma por pergunta igual. */
  function instruments(details) {
    const out = [];
    const keys = new Set();
    for (const d of details || []) {
      const n = d && d.necessidade;
      if (!n) continue;
      const key = `${n.goal}|${(n.between || []).join(',')}|${(n.missing || []).join(',')}`;
      if (keys.has(key)) continue;
      keys.add(key);
      out.push({ inv: d.inv, symptom: d.symptom, goal: n.goal, between: n.between || [], reason: n.reason || '', missing: n.missing || [], outside: !!n.outside });
    }
    return out;
  }

  /** A frase ENTENDO O RISCO é pedida? (current = cortexSettings(); next = { permission, maxRisk }) */
  function needsPhrase(current, next) {
    if (!next || next.permission !== 'pedir' || rank(next.maxRisk) <= rank('baixo')) return false;
    const c = current || {};
    const already = c.chosen && c.permission === 'pedir' && rank(c.maxRisk) >= rank(next.maxRisk);
    return !already;
  }

  /** Janela da primeira escolha: só se a pessoa ainda não escolheu; o botão marcado segue o recomendado. */
  function firstRun(settings) {
    if (!settings || settings.chosen !== false) return { show: false, recommendedOn: false };
    return { show: true, recommendedOn: settings.recommended === 'sozinho' };
  }

  /**
   * A janela da primeira escolha pode aparecer agora? Só com a janela do app visível (quem abre na bandeja vê quando
   * abrir), sem outra janela na frente, sem escolha feita e sem ela já estar aberta. Sem limite de espera.
   */
  function canShowFirst({ hidden, modalOpen, settings, showing } = {}) {
    return !hidden && !modalOpen && !showing && firstRun(settings).show;
  }

  const QUESTION = {
    cpu: 'Por que o processador ficou sobrecarregado', mem: 'Por que a memória chegou ao limite', disk: 'Por que o disco ficou ocupado',
    gpu: 'Por que a placa de vídeo chegou ao limite', temp_cpu: 'Por que o processador esquentou', temp: 'Por que a placa de vídeo esquentou',
    clock_queda: 'Por que o processador desacelerou', page_faults: 'Por que a memória foi parar no disco', travadas: 'Por que houve travadas',
    quadros_ruins: 'Por que os quadros pioraram no jogo'
  };
  const pad = (n) => String(n).padStart(2, '0');
  /** A pergunta da investigação, com a data da anomalia. */
  function question(symptom, at, label) {
    const base = QUESTION[symptom] || `O que causou “${label || symptom}”`;
    if (!finite(at)) return `${base}?`;
    const d = new Date(at);
    return `${base} em ${pad(d.getDate())}/${pad(d.getMonth() + 1)}, às ${pad(d.getHours())}:${pad(d.getMinutes())}?`;
  }

  /** Dias de memória: o primeiro dia já conta como 1; sem memória, 0. */
  function memoryDays(since, now) {
    if (!finite(since) || !finite(now)) return 0;
    return Math.max(1, Math.ceil((now - since) / DAY));
  }

  return { group, hypothesisState, belief, creatureOf, bestiary, instruments, needsPhrase, firstRun, canShowFirst, question, memoryDays };
});
