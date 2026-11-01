/*
 * Diário de alterações: registro auditável de tudo o que o Nexo alterou, com valor anterior e novo,
 * a autorização, a medição (se houver) e o resultado da reversão. Fica só neste computador.
 * O armazenamento é injetado para que o módulo seja testável fora do navegador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoJournal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_ENTRIES = 100;
  const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  function create(storage) {
    const load = () => { const stored = storage.get(); return Array.isArray(stored) ? stored.filter((entry) => entry && typeof entry.id === 'string') : []; };
    const save = (entries) => storage.set(entries.slice(-MAX_ENTRIES));

    /** status: applied | reverted | failed. `authorization` descreve como o usuário autorizou. */
    function record({ actionId, title, risk = 'baixo', reversible = false, before = null, after = null, detail = '', status = 'applied', authorization = 'confirmação na interface', now = Date.now() }) {
      const entries = load();
      const entry = { id: newId(), at: now, actionId, title, risk, reversible: reversible === true || reversible === 'parcial' ? reversible : false, before, after, detail, status, authorization, measure: null, revertedAt: null, revertNote: '' };
      entries.push(entry);
      save(entries);
      return entry;
    }

    function update(id, patch) {
      const entries = load();
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return null;
      entries[index] = { ...entries[index], ...patch };
      save(entries);
      return entries[index];
    }

    /**
     * 29.16/29.17: antes de reverter, compara o estado atual com o que o Nexo deixou.
     * `current` é o estado lido agora (ex.: { activeGuid }). Devolve { ok, conflict, reason }.
     */
    function canRevert(entry, current) {
      if (!entry || entry.status !== 'applied') return { ok: false, conflict: false, reason: 'Esta alteração já foi revertida ou não foi aplicada.' };
      if (entry.reversible !== true) return { ok: false, conflict: false, reason: 'Esta operação não tem reversão.' };
      if (entry.actionId === 'power-plan-switch') {
        if (!entry.before?.guid) return { ok: false, conflict: false, reason: 'O plano anterior não foi guardado.' };
        if (current?.activeGuid && current.activeGuid !== entry.after?.guid) {
          return { ok: true, conflict: true, reason: `O plano ativo mudou depois da alteração do Nexo (agora é ${current.activeName || 'outro'}). Reverter vai sobrescrever essa mudança.` };
        }
        return { ok: true, conflict: false, reason: '' };
      }
      return { ok: false, conflict: false, reason: 'Não há reversão automática para esta operação.' };
    }

    return {
      record, update, canRevert,
      list: (limit = MAX_ENTRIES) => load().slice(-limit).reverse(),
      get: (id) => load().find((entry) => entry.id === id) || null,
      attachMeasurement: (id, measure) => update(id, { measure }),
      markReverted: (id, note = '', now = Date.now()) => update(id, { status: 'reverted', revertedAt: now, revertNote: note }),
      clear: () => save([])
    };
  }

  return { create, MAX_ENTRIES };
});
