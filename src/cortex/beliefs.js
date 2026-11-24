/*
 * Cortex — crença e conclusão. Cada hipótese carrega uma crença (probabilidade); cada resultado de um passo do plano
 * (lembrar, esperar, medir, intervir) a atualiza por verossimilhança, e as regras de veredito dizem quando dá para
 * afirmar algo. Só um experimento significativo (medir/intervir) leva a "apoiada": lembrar e esperar, por mais que
 * se repitam, só chegam a "correlacionada".
 *
 * Puro: sem disco, sem relógio. Outcome.observed === 'interrompido' (teste cortado porque a pessoa voltou) não
 * conta para nada. "nao-resolvido" é decidido pelo motor, não aqui.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoBeliefs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const HIT_STRONG = 0.85;
  const MISS_STRONG = 0.15;
  const HIT_WEAK = 0.55;
  const MISS_WEAK = 0.45;
  const NEUTRAL = 0.5;
  const SUPPORT = 0.8;
  const REFUTE = 0.05;

  const counts = (o) => !!o && o.observed !== 'interrompido';
  const sameStep = (p, o) => p.action === o.action && p.target === o.target;
  const isTest = (o) => o.action === 'medir' || o.action === 'intervir';

  /** 'bate' | 'erra' | null (a hipótese não diz nada sobre este alvo). Basta uma previsão do alvo bater. */
  function relation(h, o) {
    const ps = (h.predictions || []).filter((p) => sameStep(p, o));
    if (!ps.length) return null;
    return ps.some((p) => p.expect === o.observed) ? 'bate' : 'erra';
  }

  /** Teorema de Bayes sobre as hipóteses: devolve um novo mapa de crenças que soma 1. */
  function update(hyps, beliefs, outcome) {
    const list = hyps || [];
    const base = {};
    for (const h of list) base[h.key] = beliefs && typeof beliefs[h.key] === 'number' ? beliefs[h.key] : h.prior;
    if (!counts(outcome)) return base;

    const hit = outcome.significant ? HIT_STRONG : HIT_WEAK;
    const miss = outcome.significant ? MISS_STRONG : MISS_WEAK;
    const raw = {};
    let total = 0;
    for (const h of list) {
      const r = relation(h, outcome);
      raw[h.key] = base[h.key] * (r === 'bate' ? hit : r === 'erra' ? miss : NEUTRAL);
      total += raw[h.key];
    }
    if (!(total > 0)) return base;
    for (const k of Object.keys(raw)) raw[k] /= total;
    return raw;
  }

  /** Conclusão a partir das crenças e de tudo o que foi observado. */
  function verdict(hyps, beliefs, outcomes) {
    const list = hyps || [];
    const seen = (outcomes || []).filter(counts);
    const belief = (h) => (beliefs && typeof beliefs[h.key] === 'number' ? beliefs[h.key] : h.prior);

    const refuted = list
      .filter((h) => h.source !== 'desconhecida' && belief(h) < REFUTE && seen.some((o) => o.significant && relation(h, o) === 'erra'))
      .map((h) => h.key);

    // A desconhecida nunca é vencedora: sem previsões, não há o que provar nela.
    let best = null;
    for (const h of list) {
      if (h.source === 'desconhecida' || !(h.predictions || []).length) continue;
      if (!best || belief(h) > belief(best)) best = h;
    }
    if (!best || belief(best) < SUPPORT) return { status: 'aberta', winner: null, refuted };

    const experimental = seen.some((o) => o.significant && isTest(o) && relation(best, o) === 'bate');
    return { status: experimental ? 'apoiada' : 'correlacionada', winner: best.key, refuted };
  }

  return { update, verdict, SUPPORT, REFUTE };
});
