/*
 * Cortex — planejador. Escolhe o próximo passo que melhor separa as hipóteses em disputa: ganho esperado de informação
 * (bits) dividido pelo custo, sempre dentro do que a pessoa permitiu e do ritmo dela (bateria, uso do dia, modo leve).
 *
 * Ação = tipo + alvo. Duas previsões com o mesmo `action` e `target` são a mesma ação, mesmo que difiram em `expect`
 * ('presente' e 'antes' no mesmo `lembrar` são resultados diferentes da mesma ação). Convenção dos alvos: lembrar → id de
 * sinal; esperar → sintoma; medir → bench:<id>; intervir → ajuste:<id>.
 *
 * Puro: sem disco, sem relógio.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('../lab-space.js'));
  else root.NexoPlanner = factory(() => root.NexoLabSpace);
})(typeof self !== 'undefined' ? self : this, function (loadSpace) {
  const COST = { lembrar: 0.05, esperar: 0.3, medir: 1, intervir: 3 };
  const MIN_GAIN = 0.05;
  const MAX_ACTIVE_PER_DAY = 3;
  const RISK_ORDER = { nenhum: 0, baixo: 1, moderado: 2, alto: 3 };
  const TIE = 0.05; // diferença de crença abaixo da qual duas hipóteses contam como empatadas

  let knobs = null;
  /** Risco de um ajuste pelo catálogo; ajuste fora do catálogo conhecido conta como 'alto'. */
  function knobRisk(target) {
    if (!knobs) {
      knobs = new Map();
      try {
        const space = loadSpace();
        for (const k of (space && space.SPACE) || []) knobs.set(k.id, k.risk);
      } catch (e) { /* sem catálogo: tudo vira 'alto' */ }
    }
    const id = String(target).replace(/^ajuste:/, '');
    return RISK_ORDER[knobs.get(id)] !== undefined ? knobs.get(id) : 'alto';
  }

  const riskOf = (type, target) => (type === 'intervir' ? knobRisk(target) : 'nenhum');
  const idOf = (type, target) => `${type}:${target}`;

  function actionsFor(hyps) {
    const seen = new Map();
    for (const h of hyps || []) {
      for (const p of h.predictions || []) {
        const id = idOf(p.action, p.target);
        if (!seen.has(id) && COST[p.action] !== undefined) {
          seen.set(id, { type: p.action, target: p.target, cost: COST[p.action], risk: riskOf(p.action, p.target) });
        }
      }
    }
    return [...seen.values()];
  }

  const entropy = (ps) => -ps.reduce((s, p) => (p > 0 ? s + p * Math.log2(p) : s), 0);

  /**
   * Informação mútua entre a hipótese verdadeira e o resultado da ação (bits). Cada hipótese aposta num ou mais valores
   * de `expect` para o alvo (reparte por igual entre eles); sem previsão para o alvo ela fica espalhada por todos.
   */
  function expectedGain(action, hyps, beliefs) {
    const list = hyps || [];
    const raw = list.map((h) => (beliefs && typeof beliefs[h.key] === 'number' ? beliefs[h.key] : h.prior) || 0);
    const total = raw.reduce((s, v) => s + v, 0);
    if (!(total > 0)) return 0;
    const b = raw.map((v) => v / total);

    const values = [];
    const own = list.map((h) => {
      const set = [...new Set((h.predictions || []).filter((p) => p.action === action.type && p.target === action.target).map((p) => p.expect))];
      for (const v of set) if (!values.includes(v)) values.push(v);
      return set;
    });
    if (values.length < 2 && !own.some((s) => s.length)) return 0;

    // like[i][o] = P(resultado o | hipótese i)
    const like = own.map((set) => values.map((v) => (set.length ? (set.includes(v) ? 1 / set.length : 0) : 1 / values.length)));
    let expectedAfter = 0;
    for (let o = 0; o < values.length; o++) {
      const joint = b.map((p, i) => p * like[i][o]);
      const po = joint.reduce((s, v) => s + v, 0);
      if (po > 0) expectedAfter += po * entropy(joint.map((v) => v / po));
    }
    return Math.max(0, entropy(b) - expectedAfter);
  }

  /** As hipóteses mais bem colocadas e empatadas (ou as duas primeiras, se uma disparar). */
  function tied(hyps, beliefs) {
    const rows = (hyps || []).map((h) => ({ key: h.key, p: typeof beliefs[h.key] === 'number' ? beliefs[h.key] : h.prior }))
      .sort((a, b) => b.p - a.p || a.key.localeCompare(b.key));
    if (!rows.length) return [];
    const near = rows.filter((r) => rows[0].p - r.p <= TIE);
    return (near.length >= 2 ? near : rows.slice(0, 2)).map((r) => r.key);
  }

  function choose(hyps, beliefs, ctx) {
    const c = ctx || {};
    const bel = beliefs || {};
    const done = new Set(c.done || []);
    const maxRisk = RISK_ORDER[c.maxRisk] !== undefined ? RISK_ORDER[c.maxRisk] : RISK_ORDER.baixo;
    const spent = (c.activeToday || 0) >= MAX_ACTIVE_PER_DAY;

    const allowed = actionsFor(hyps).filter((a) => {
      if (done.has(idOf(a.type, a.target))) return false;
      if ((a.type === 'medir' || a.type === 'intervir') && (!c.deep || spent)) return false;
      if (a.type === 'intervir') {
        if (c.permission === 'observar' || c.onBattery) return false;
        if (RISK_ORDER[a.risk] > maxRisk) return false;
      }
      return true;
    });

    let best = null;
    for (const a of allowed) {
      const gain = expectedGain(a, hyps, bel);
      if (gain < MIN_GAIN) continue;
      const score = gain / a.cost;
      if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && idOf(a.type, a.target) < idOf(best.action.type, best.action.target))) best = { action: a, score };
    }
    if (best) return { action: best.action, needsApproval: best.action.type === 'intervir' && c.permission === 'pedir' };

    // Nada permitido separa as hipóteses: com o orçamento do dia gasto e sem ação alguma à mão, para; senão pede ajuda.
    if (!allowed.length && spent) return { stop: 'orcamento' };
    return { need: { between: tied(hyps, bel), reason: 'Nenhum passo permitido agora separa estas explicações; falta um dado novo (ou liberar uma medição) para decidir entre elas.' } };
  }

  return { COST, MIN_GAIN, actionsFor, expectedGain, choose };
});
