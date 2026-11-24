/*
 * Cortex — lugar reservado da IA local (parte 3 do cérebro). Na v0 a interface existe e está vazia: o Cortex nunca
 * depende dela. Quando a IA local chegar, ela poderá sugerir hipóteses e reescrever as frases do narrador, mas o dado
 * de base continua sendo o estruturado (hipóteses do forjador, frases do narrate.js).
 *
 *   available()                  -> boolean           (v0: sempre false)
 *   proposeHypotheses(contexto)  -> Promise<Hypothesis[]>   (v0: [])
 *   narrate(passo)               -> Promise<string|null>    (v0: null = use a frase do narrador)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoMind = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    available: () => false,
    proposeHypotheses: async () => [],
    narrate: async () => null
  };
});
