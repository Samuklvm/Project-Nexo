/*
 * Cortex — forjador de hipóteses. Dada uma anomalia, monta as explicações candidatas a partir do que o mapa de relações
 * sabe (e das correlações recém-mineradas), sempre com duas explicações honestas ao lado: "é a variação normal desta
 * máquina neste horário" (rotina) e "a causa está fora do que eu consigo medir hoje" (desconhecida).
 *
 * Puro: sem disco, sem relógio. Nenhuma lista fixa por sintoma: tudo vem de map.causesOf().
 * Alvos das previsões: lembrar → id de sinal (presente/ausente); esperar → o sintoma; medir → bench:<id>;
 * intervir → ajuste:<id> (efeito no bench ligado).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoForge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_HOPS = 2;
  const UNKNOWN_PRIOR = 0.1;
  const ROUTINE_RAW = 0.25;
  const FALLBACK_RAW = 0.1;
  const HOP_DECAY = 0.5;
  const CORRELATION_DECAY = 0.8;
  // Quanto cada degrau da escada pesa a mais (ou a menos) na confiança inicial de uma aresta.
  const STATE_FACTOR = { semente: 1, observada: 1.05, correlacionada: 1.1, suspeita: 1.2, apoiada: 1.5 };

  const keyOf = (cause, symptom) => `${cause}>${symptom}`;
  const pred = (action, target, expect) => ({ action, target, expect });
  const isAction = (id) => typeof id === 'string' && id.startsWith('ajuste:');
  const isBench = (id) => typeof id === 'string' && id.startsWith('bench:');

  /** Previsões de uma causa vinda do mapa: ela aparece, o sintoma sobe e, se o caminho passa por teste/ajuste, mede/mexe. */
  function causePredictions(cause, symptom, nodes) {
    const out = [pred('lembrar', cause, 'presente'), pred('esperar', symptom, 'sobe')];
    for (const id of nodes) {
      if (isBench(id)) out.push(pred('medir', id, 'desce'));
      else if (isAction(id)) out.push(pred('intervir', id, 'sobe'));
    }
    return out;
  }

  /** Percorre o mapa para trás a partir do sintoma, até MAX_HOPS saltos. Cada caminho vira uma causa candidata. */
  function mapCandidates(symptom, map) {
    const found = new Map();
    const walk = (target, path, hops, raw) => {
      for (const edge of map.causesOf(target)) {
        if (edge.from === symptom || path.some((e) => e.from === edge.from)) continue;
        const factor = STATE_FACTOR[map.state(edge.id)] || 1;
        const edges = [edge, ...path];
        const value = raw * edge.weight * factor * (hops > 0 ? HOP_DECAY : 1);
        if (edge.from !== 'rotina') {
          const prev = found.get(edge.from);
          if (!prev || prev.raw < value) found.set(edge.from, { cause: edge.from, edges, raw: value });
        }
        if (hops + 1 < MAX_HOPS) walk(edge.from, edges, hops + 1, value);
      }
    };
    walk(symptom, [], 0, 1);
    return [...found.values()];
  }

  /** Último recurso: um sinal vizinho do sintoma (tem aresta com alguém que toca o sintoma). */
  function neighbourCandidate(symptom, map) {
    const edges = map.edges().filter((e) => map.state(e.id) !== 'derrubada');
    const near = new Set();
    for (const e of edges) {
      if (e.from === symptom) near.add(e.to);
      if (e.to === symptom) near.add(e.from);
    }
    let best = null;
    for (const e of edges) {
      for (const [other, mid] of [[e.from, e.to], [e.to, e.from]]) {
        if (!near.has(mid) || other === symptom || other === 'rotina' || near.has(other)) continue;
        if (!best || e.weight > best.edge.weight || (e.weight === best.edge.weight && e.id < best.edge.id)) best = { cause: other, edge: e };
      }
    }
    return best;
  }

  function forge(anomaly, map, extra = {}) {
    const symptom = anomaly && anomaly.symptom;
    const raw = [];
    const used = new Set();
    const add = (h, weight) => {
      if (used.has(h.key)) return false;
      used.add(h.key);
      raw.push({ h, weight });
      return true;
    };

    for (const c of mapCandidates(symptom, map)) {
      const nodes = c.edges.flatMap((e) => [e.from, e.to]).filter((id) => id !== symptom);
      add({ key: keyOf(c.cause, symptom), cause: c.cause, symptom, via: c.edges.map((e) => e.id), prior: 0, source: 'mapa',
        predictions: causePredictions(c.cause, symptom, nodes) }, c.raw);
    }
    for (const e of (extra && extra.correlations) || []) {
      if (!e || e.to !== symptom || e.from === 'rotina') continue;
      add({ key: keyOf(e.from, symptom), cause: e.from, symptom, via: [e.id], prior: 0, source: 'correlacao',
        predictions: causePredictions(e.from, symptom, [e.from]) }, (Number(e.weight) || 0.3) * CORRELATION_DECAY);
    }

    // Rotina: a variação normal desta hora. Prevê o oposto das causas: elas ausentes, o sintoma igual ao de costume.
    const causes = raw.map((r) => r.h.cause);
    add({ key: keyOf('rotina', symptom), cause: 'rotina', symptom, via: [], prior: 0, source: 'rotina',
      predictions: [pred('lembrar', 'rotina', 'presente'), ...causes.map((c) => pred('lembrar', c, 'ausente')), pred('esperar', symptom, 'igual')] }, ROUTINE_RAW);

    // Sem causa nenhuma no mapa nem correlação: completa com o vizinho mais forte, ou com o programa pesado genérico.
    if (raw.length < 2) {
      const n = neighbourCandidate(symptom, map);
      const cause = n ? n.cause : 'programa_pesado';
      add({ key: keyOf(cause, symptom), cause, symptom, via: n ? [n.edge.id] : [], prior: 0, source: 'mapa',
        predictions: causePredictions(cause, symptom, [cause]) }, FALLBACK_RAW);
    }

    const total = raw.reduce((s, r) => s + r.weight, 0) || 1;
    const out = raw.map(({ h, weight }) => ({ ...h, prior: (weight / total) * (1 - UNKNOWN_PRIOR) }));
    out.push({ key: keyOf('desconhecida', symptom), cause: 'desconhecida', symptom, via: [], prior: UNKNOWN_PRIOR, source: 'desconhecida', predictions: [] });
    return out.sort((a, b) => b.prior - a.prior || a.key.localeCompare(b.key));
  }

  return { forge };
});
