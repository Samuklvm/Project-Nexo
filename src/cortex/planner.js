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
  const STOP_RANK = { ritmo: 0, bateria: 1, orcamento: 2 }; // precedência quando o ganho empata
  // Só estas duas permissões liberam intervir; ausente, nula ou desconhecida valem como 'observar' (nunca abre sozinho).
  const AUTONOMY = new Set(['pedir', 'sozinho']);
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
  // Resultados possíveis de cada tipo de ação: é por eles que se espalha a hipótese que não diz nada sobre o alvo.
  const DOMAIN = {
    lembrar: ['presente', 'ausente', 'antes', 'depois'],
    esperar: ['sobe', 'desce', 'igual'],
    medir: ['sobe', 'desce', 'igual'],
    intervir: ['sobe', 'desce', 'igual']
  };

  /**
   * Informação mútua entre a hipótese verdadeira e o resultado da ação (bits). Cada hipótese aposta num ou mais valores
   * de `expect` para o alvo (reparte por igual entre eles); sem previsão para o alvo ela fica espalhada por todo o
   * domínio da ação (DOMAIN), e não só pelos valores que as outras previram: "ninguém discorda" não é "todos esperam o
   * mesmo". Assim um teste que só uma hipótese prevê também separa.
   */
  function expectedGain(action, hyps, beliefs) {
    const list = hyps || [];
    const raw = list.map((h) => (beliefs && typeof beliefs[h.key] === 'number' ? beliefs[h.key] : h.prior) || 0);
    const total = raw.reduce((s, v) => s + v, 0);
    if (!(total > 0)) return 0;
    const b = raw.map((v) => v / total);

    const domain = DOMAIN[action.type] || [];
    const values = domain.slice();
    const own = list.map((h) => {
      const set = [...new Set((h.predictions || []).filter((p) => p.action === action.type && p.target === action.target).map((p) => p.expect))];
      for (const v of set) if (!values.includes(v)) values.push(v);
      return set;
    });
    if (!own.some((s) => s.length)) return 0;
    const spread = domain.length ? domain : values; // tipo fora do DOMAIN: espalha pelos valores previstos

    // like[i][o] = P(resultado o | hipótese i)
    const like = own.map((set) => values.map((v) => (set.length ? (set.includes(v) ? 1 / set.length : 0) : spread.includes(v) ? 1 / spread.length : 0)));
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

  /** -> { action, needsApproval } | { need: { between, reason } } | { stop: 'ritmo'|'orcamento'|'bateria' } */
  function choose(hyps, beliefs, ctx) {
    const c = ctx || {};
    const bel = beliefs || {};
    const done = new Set(c.done || []);
    const maxRisk = RISK_ORDER[c.maxRisk] !== undefined ? RISK_ORDER[c.maxRisk] : RISK_ORDER.baixo;
    const spent = (c.activeToday || 0) >= MAX_ACTIVE_PER_DAY;

    let best = null;
    let blocked = null; // melhor ação útil bloqueada só por ora (ritmo, bateria ou orçamento do dia)
    // Empate de ganho/custo: risco menor primeiro (entre 40 ajustes empatados, os de risco baixo vêm antes), depois o id.
    const better = (score, risk, id, cur) => {
      if (!cur || score > cur.score + 1e-12) return true;
      if (Math.abs(score - cur.score) > 1e-12) return false;
      if (risk !== cur.risk) return risk < cur.risk;
      return id < cur.id;
    };
    for (const a of actionsFor(hyps)) {
      const id = idOf(a.type, a.target);
      if (done.has(id)) continue;
      // Permissão e teto de risco não passam com o tempo: a ação conta como inexistente.
      if (a.type === 'intervir' && (!AUTONOMY.has(c.permission) || RISK_ORDER[a.risk] > maxRisk)) continue;
      const gain = expectedGain(a, hyps, bel);
      if (gain < MIN_GAIN) continue;
      const heavy = a.type === 'medir' || a.type === 'intervir';
      const why = heavy && !c.deep ? 'ritmo' : a.type === 'intervir' && c.onBattery ? 'bateria' : heavy && spent ? 'orcamento' : null;
      const score = gain / a.cost;
      if (why) {
        const rank = STOP_RANK[why];
        if (!blocked || gain > blocked.gain + 1e-12 || (Math.abs(gain - blocked.gain) <= 1e-12 && rank < STOP_RANK[blocked.why])) blocked = { why, gain };
      } else if (better(score, RISK_ORDER[a.risk], id, best)) best = { action: a, score, risk: RISK_ORDER[a.risk], id };
    }
    // Uma ação permitida e útil (ganho >= MIN_GAIN) roda antes de pausar por outra mais forte que está bloqueada por ora.
    if (best) return { action: best.action, needsApproval: best.action.type === 'intervir' && c.permission === 'pedir' };
    // Há passo útil, só que não agora: espera, em vez de dar a investigação por não resolvida.
    if (blocked) return { stop: blocked.why };
    return { need: { between: tied(hyps, bel), reason: 'Nenhum passo permitido separa estas explicações; falta um dado novo (ou liberar uma medição) para decidir entre elas.' } };
  }

  return { COST, MIN_GAIN, DOMAIN, actionsFor, expectedGain, choose };
});
