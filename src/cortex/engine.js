/*
 * Cortex — motor de investigação. Junta as peças: forjador (hipóteses) → planejador (próximo passo) → ação (quem chama
 * executa: memória, espera, lab) → crença → narrador → registros na memória eterna.
 *
 * Sem estado próprio que importe: tudo o que o motor sabe de uma investigação é relido dos registros a cada passo, então
 * um motor novo com a mesma loja continua exatamente de onde o anterior parou (app fechado no meio, Review Focus 2).
 * A loja só acrescenta (record/latest/list de memory.cjs); mudança de estado é sempre um registro novo.
 *
 * Registros de uma investigação (todos com inv = id do registro 'investigacao'):
 *   investigacao  { anomaly, symptom }                       (inv = null: o próprio id é a investigação)
 *   hipotese      Hypothesis do forjador
 *   crenca        { beliefs }                               prev = crença anterior, ref = experimento que a mudou
 *   experimento   { action, status, outcome?, detail? }     status: feito | interrompido | esperando | invalido | falhou
 *                                                           (o resultado de uma espera aponta para ela em prev)
 *   prova         { outcome, anomaly? } (ref = experimento) ou { kind: 'repeticao', anomaly } (a lentidão repetiu)
 *   pedido        { action, status: 'pendente' }; a resposta é outro pedido { action, status: aprovado|negado }, ref = pedido
 *   pensamento    { step, text, pause? }                    frase do narrador (passos no formato do narrate.js)
 *   necessidade   { goal, between, reason, missing, outside } goal 'separar' (nada separa as explicações) ou
 *                                                           'apoiada' (há vencedora correlacionada, falta a prova);
 *                                                           missing = causas ou testes ainda não olhados; outside = o
 *                                                           que falta está fora do que o Nexo mede
 *   conclusao     { verdict: { status, winner, refuted }, missing, leading, events }  (events = os EdgeEvent abaixo)
 *   relacao       EdgeEvent { edgeId, kind, at, inv }       o motor só grava; quem chama aplica no mapa (map.apply)
 *
 * step(inv) → 'continua' | 'aguardando' (pedido de autorização) | 'esperando-repetir' (esperar sem resultado ainda) |
 *             'pausada' (o planejador mandou esperar: ritmo leve, bateria, orçamento) | 'concluida' |
 *             'falha-gravacao' (a loja não gravou: o passo para ali, sem gravar mais nada; tenta de novo depois).
 *
 * Gravação que falha ou app que fecha no meio de um passo: cada gravação é conferida (id > 0) e o passo para na
 * primeira que falhar. A leitura conserta o que ficou pela metade, sempre acrescentando: resultado sem prova ganha a
 * prova; resultado sem crença ganha a crença (a atualização bayesiana comuta, então reaplicar sobre a última crença dá
 * o mesmo); conclusão sem os eventos do mapa ganha os que faltam. Investigação sem a crença inicial (a abertura não
 * terminou) é ignorada.
 *
 * Puro em relação ao mundo: disco é a loja, relógio é `now`, ações são `act`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./forge.js'), require('./planner.js'), require('./beliefs.js'), require('./narrate.js'));
  } else root.NexoEngine = factory(root.NexoForge, root.NexoPlanner, root.NexoBeliefs, root.NexoNarrate);
})(typeof self !== 'undefined' ? self : this, function (Forge, Planner, Beliefs, Narrate) {
  const VOCAB = ['sobe', 'desce', 'igual', 'presente', 'ausente', 'antes', 'depois'];
  const SCAN = 1000; // investigações e conclusões recentes olhadas para achar as abertas
  const ALL = 100000; // teto de registros de um tipo lidos de uma investigação
  const SUSPECTS = 3; // suspeitas narradas ao abrir (além da "fora do que eu meço")
  const COUNTED = new Set(['feito', 'invalido', 'falhou']); // a ação conta como feita (interrompido não conta)
  const PAUSE = {
    ritmo: 'o próximo passo é um teste pesado, e esse eu só faço com o computador parado',
    bateria: 'o computador está na bateria, então o ajuste fica para depois',
    orcamento: 'já fiz os testes ativos de hoje; o próximo fica para amanhã'
  };

  const idOf = (type, target) => `${type}:${target}`;
  const isTest = (type) => type === 'medir' || type === 'intervir';
  const causeOf = (key) => String(key).split('>')[0];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const slimAction = (a) => ({ type: a.type, target: a.target });
  const slimHyp = (h) => ({ key: h.key, cause: h.cause, symptom: h.symptom, source: h.source });
  const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

  const relation = Beliefs.relation;
  const OUTSIDE = 'a causa está fora do que eu consigo medir hoje';

  /** A loja não gravou (devolveu -1 ou lançou): o passo para aqui. */
  class WriteFailed extends Error {}

  function createEngine({ store, map, act, ctx, now = Date.now, onThought, correlations } = {}) {
    if (!store || typeof store.record !== 'function') throw new TypeError('motor sem loja');
    const heads = new Map(); // inv → registro da investigação (só cache de leitura: a loja é a verdade)
    const running = new Map(); // inv → passo em andamento (dois passos da mesma investigação nunca correm juntos)

    // ---------- leitura ----------

    function head(inv) {
      if (heads.has(inv)) return heads.get(inv);
      const row = store.list('investigacao', { limit: SCAN }).find((r) => r.id === inv) || null;
      if (row) heads.set(inv, row);
      return row;
    }

    /** Investigações abertas (sem conclusão), da mais antiga para a mais nova. */
    function openRows() {
      const closed = new Set(store.list('conclusao', { limit: SCAN }).map((r) => r.inv));
      return store.list('investigacao', { limit: SCAN })
        .filter((r) => !closed.has(r.id) && !store.latest('conclusao', { inv: r.id }) && store.latest('crenca', { inv: r.id }));
    }

    function openFor(symptom) {
      const rows = openRows().filter((r) => r.data && r.data.symptom === symptom);
      return rows.length ? rows[rows.length - 1].id : null;
    }

    /** Reconstrói a investigação inteira a partir dos registros. */
    function load(inv) {
      const top = head(inv);
      if (!top) return null;
      const rows = (kind) => store.list(kind, { inv, limit: ALL });
      const hyps = rows('hipotese').map((r) => r.data);
      const crenca = store.latest('crenca', { inv });
      if (!crenca) return null; // a abertura não terminou
      const exps = rows('experimento');
      const repaired = repair(inv, hyps, crenca, exps);
      const resolved = new Set(exps.filter((r) => r.prev != null).map((r) => r.prev));
      const asks = rows('pedido');
      const answers = asks.filter((r) => r.ref != null);
      const answered = new Set(answers.map((r) => r.ref));
      const approved = new Set();
      const denied = new Set();
      for (const r of answers) (r.data.status === 'aprovado' ? approved : denied).add(idOf(r.data.action.type, r.data.action.target));
      return {
        inv,
        anomaly: top.data.anomaly,
        symptom: top.data.symptom,
        hyps,
        beliefs: repaired.beliefs,
        crencaId: repaired.crencaId,
        outcomes: exps.filter((r) => r.data.status === 'feito').map((r) => r.data.outcome),
        done: exps.filter((r) => COUNTED.has(r.data.status)).map((r) => idOf(r.data.action.type, r.data.action.target)),
        waiting: exps.filter((r) => r.data.status === 'esperando' && !resolved.has(r.id)).pop() || null,
        pending: asks.filter((r) => r.ref == null && !answered.has(r.id)).pop() || null,
        approved,
        denied,
        concluded: !!store.latest('conclusao', { inv })
      };
    }

    /** Conserta, só acrescentando, o que um passo interrompido deixou pela metade (ver cabeçalho). */
    function repair(inv, hyps, crenca, exps) {
      const proved = new Set(store.list('prova', { inv, limit: ALL }).map((r) => r.ref).filter((r) => r != null));
      const believed = new Set(store.list('crenca', { inv, limit: ALL }).map((r) => r.ref).filter((r) => r != null));
      let beliefs = crenca.data.beliefs;
      let crencaId = crenca.id;
      for (const e of exps) {
        if (e.data.status !== 'feito') continue;
        const outcome = e.data.outcome;
        if (!proved.has(e.id)) put('prova', { inv, ref: e.id, data: { outcome } });
        if (believed.has(e.id)) continue;
        beliefs = Beliefs.update(hyps, beliefs, outcome);
        crencaId = put('crenca', { inv, prev: crencaId, ref: e.id, data: { beliefs } });
        think(inv, { type: 'resultado', outcome });
      }
      const end = store.latest('conclusao', { inv });
      const events = (end && end.data && end.data.events) || [];
      const have = store.list('relacao', { inv, limit: ALL }).length;
      for (const ev of events.slice(have)) put('relacao', { inv, data: ev });
      return { beliefs, crencaId };
    }

    const belief = (s, h) => (finite(s.beliefs[h.key]) ? s.beliefs[h.key] : h.prior);
    const ranked = (s) => s.hyps.slice().sort((a, b) => belief(s, b) - belief(s, a) || a.key.localeCompare(b.key));

    /** A previsão que o narrador usa: a da hipótese mais forte que fala deste alvo (a que bate, se houver resultado). */
    function predictionFor(s, a, observed) {
      for (const h of ranked(s)) {
        const ps = (h.predictions || []).filter((p) => p.action === a.type && p.target === a.target);
        if (ps.length) return ps.find((p) => p.expect === observed) || ps[0];
      }
      return null;
    }

    /** Algum teste forte (medir/intervir) contradiz uma previsão da hipótese? */
    function contradicted(s, key) {
      const h = s.hyps.find((x) => x.key === key);
      return s.outcomes.some((o) => o.significant && isTest(o.action) && relation(h, o) === 'erra');
    }

    // ---------- escrita ----------

    function put(kind, opts) {
      let id;
      try { id = store.record(kind, opts); } catch (e) { throw new WriteFailed(String((e && e.message) || e)); }
      if (!(id > 0)) throw new WriteFailed(`${kind} não gravou`);
      return id;
    }

    function think(inv, step, extra = {}) {
      const text = Narrate.say(step);
      put('pensamento', { inv, data: { step, text, ...extra } });
      if (typeof onThought === 'function') {
        try { onThought(text, { inv, type: step.type }); } catch (_) { /* quem escuta não derruba o motor */ }
      }
      return text;
    }

    /** Eventos do mapa da conclusão: a favor (só apoiada), contra (só derrubada por teste forte), visto/correlação. */
    function mapEventsFor(s, verdict) {
      const at = now();
      const out = [];
      const used = new Set();
      const push = (edgeId, kind) => {
        if (!edgeId || used.has(edgeId)) return;
        used.add(edgeId);
        out.push({ edgeId, kind, at, inv: s.inv });
      };
      const byKey = new Map(s.hyps.map((h) => [h.key, h]));
      if (verdict.status === 'apoiada' && byKey.has(verdict.winner)) for (const e of byKey.get(verdict.winner).via || []) push(e, 'experimento-a-favor');
      for (const key of verdict.refuted || []) {
        const h = byKey.get(key);
        if (h && contradicted(s, key)) push((h.via || [])[0], 'experimento-contra');
      }
      // A causa apareceu na memória junto com o sintoma: vista; antes dele e com força: correlacionada.
      for (const h of s.hyps) {
        if (!(h.via || []).length || h.source === 'rotina') continue;
        const o = s.outcomes.find((x) => x.action === 'lembrar' && x.target === h.cause && ['presente', 'antes', 'depois'].includes(x.observed));
        if (o) push(h.via[0], h.source === 'correlacao' || (o.observed === 'antes' && o.significant) ? 'correlacao' : 'visto');
      }
      return out;
    }

    function conclude(s, verdict, extra = {}) {
      const lead = ranked(s).find((h) => h.source !== 'desconhecida');
      const data = {
        verdict: { status: verdict.status, winner: verdict.winner || null, refuted: verdict.refuted || [] },
        missing: extra.missing || [],
        leading: lead ? { key: lead.key, belief: belief(s, lead) } : null
      };
      data.events = mapEventsFor(s, data.verdict);
      put('conclusao', { inv: s.inv, data });
      for (const ev of data.events) put('relacao', { inv: s.inv, data: ev });
      think(s.inv, { type: 'conclusao', verdict: data.verdict, missing: data.missing });
      s.concluded = true;
      return 'concluida';
    }

    /** Se as crenças já sustentam uma conclusão apoiada (e nenhum teste forte a contradiz), conclui. */
    function settle(s) {
      const v = Beliefs.verdict(s.hyps, s.beliefs, s.outcomes);
      if (v.status === 'apoiada' && !contradicted(s, v.winner)) return conclude(s, v);
      return null;
    }

    /** Guarda um resultado válido: experimento, prova, crença nova e o pensamento. Síncrono (attach também usa). */
    function absorb(s, a, outcome, prev, anomaly) {
      const inv = s.inv;
      const exp = put('experimento', { inv, prev, data: { action: slimAction(a), status: 'feito', outcome } });
      put('prova', { inv, ref: exp, data: anomaly ? { outcome, anomaly } : { outcome } });
      const beliefs = Beliefs.update(s.hyps, s.beliefs, outcome);
      s.crencaId = put('crenca', { inv, prev: s.crencaId, ref: exp, data: { beliefs } });
      think(inv, { type: 'resultado', outcome, prediction: predictionFor(s, a, outcome.observed) });
      s.beliefs = beliefs;
      s.outcomes.push(outcome);
      s.done.push(idOf(a.type, a.target));
      return settle(s) || 'continua';
    }

    function fail(s, a, status, detail) {
      put('experimento', { inv: s.inv, data: { action: slimAction(a), status, detail: String(detail) } });
      think(s.inv, { type: 'resultado', outcome: { action: a.type, target: a.target, observed: String(detail), significant: false } });
      return 'continua';
    }

    async function run(s, a) {
      think(s.inv, { type: 'plano', prediction: predictionFor(s, a) });
      let o;
      try {
        o = await act({ type: a.type, target: a.target, cost: a.cost, risk: a.risk, inv: s.inv, symptom: s.symptom });
      } catch (e) {
        return fail(s, a, 'falhou', (e && e.message) || e);
      }
      if (o == null) {
        // Sem resultado ainda: a espera fica registrada e a próxima repetição da lentidão (attach) traz o resultado.
        if (a.type !== 'esperar') return fail(s, a, 'falhou', 'sem resultado');
        put('experimento', { inv: s.inv, data: { action: slimAction(a), status: 'esperando' } });
        return 'esperando-repetir';
      }
      if (o.observed === 'interrompido') {
        // A pessoa voltou no meio: não é evidência, não muda crença e a ação continua por fazer.
        put('experimento', { inv: s.inv, data: { action: slimAction(a), status: 'interrompido' } });
        think(s.inv, { type: 'interrompido', target: a.target });
        return 'continua';
      }
      if (!VOCAB.includes(o.observed)) return fail(s, a, 'invalido', o.observed);
      const outcome = { action: a.type, target: a.target, observed: o.observed, significant: !!o.significant };
      if (o.evidenceId != null) outcome.evidenceId = o.evidenceId;
      return absorb(s, a, outcome, null);
    }

    /**
     * Acabaram os passos. Com vencedora correlacionada: conclui correlacionada e registra a prova que faltou (goal
     * 'apoiada'). Sem vencedora: não resolvido, e a necessidade diz só o que ainda não foi olhado; se tudo o que as
     * causas conhecidas previam já foi olhado (ou a desconhecida está entre as empatadas), o que falta está fora do
     * que o Nexo mede (outside).
     */
    function giveUp(s, need) {
      const v = Beliefs.verdict(s.hyps, s.beliefs, s.outcomes);
      const seen = new Set(s.outcomes.map((o) => idOf(o.action, o.target)));
      const unseen = (p) => !seen.has(idOf(p.action, p.target));
      const byKey = new Map(s.hyps.map((h) => [h.key, h]));
      const unique = (xs) => [...new Set(xs)];
      let data;
      if (v.status === 'correlacionada' && v.winner) {
        const tests = unique((byKey.get(v.winner).predictions || []).filter((p) => isTest(p.action) && unseen(p)).map((p) => p.target));
        const reason = tests.length
          ? 'falta um teste do laboratório que eu ainda não posso fazer (é preciso liberar a medição ou o ajuste) para provar esta causa'
          : 'não tenho um teste no laboratório que prove esta causa; por enquanto só observei';
        data = { goal: 'apoiada', between: [v.winner], reason, missing: tests, outside: false };
      } else {
        const between = need.between || [];
        const hs = between.map((k) => byKey.get(k)).filter(Boolean);
        const known = hs.filter((h) => h.source !== 'rotina' && h.source !== 'desconhecida');
        const missing = unique(known.filter((h) => (h.predictions || []).some(unseen)).map((h) => h.cause));
        const outside = !missing.length || hs.some((h) => h.source === 'desconhecida');
        const reason = !missing.length
          ? `já olhei tudo o que as causas que eu conheço previam, e ${OUTSIDE}`
          : outside ? `${lower(need.reason)} Também pode ser que ${OUTSIDE}` : lower(need.reason);
        data = { goal: 'separar', between, reason, missing, outside };
      }
      // Um passo anterior pode ter gravado a necessidade e falhado na conclusão: não grava de novo.
      if (!store.latest('necessidade', { inv: s.inv })) {
        put('necessidade', { inv: s.inv, data });
        think(s.inv, { type: 'necessidade', signal: data.missing[0], reason: data.reason });
      }
      if (data.goal === 'apoiada') return conclude(s, v, { missing: data.missing });
      return conclude(s, { status: 'nao-resolvido', winner: null, refuted: v.refuted }, { missing: data.missing });
    }

    function pause(s, why) {
      const last = store.latest('pensamento', { inv: s.inv });
      if (last && last.data && last.data.pause === why) return 'pausada';
      think(s.inv, { type: 'ritmo', state: 'leve', reason: PAUSE[why] || why }, { pause: why });
      return 'pausada';
    }

    function ask(s, a) {
      put('pedido', { inv: s.inv, data: { action: slimAction(a), status: 'pendente' } });
      think(s.inv, { type: 'pedido', text: 'autorize um teste rápido (eu desfaço tudo no fim)', signal: a.target });
      return 'aguardando';
    }

    async function doStep(inv) {
      try {
        return await stepOnce(inv);
      } catch (e) {
        if (e instanceof WriteFailed) return 'falha-gravacao';
        throw e;
      }
    }

    async function stepOnce(inv) {
      const s = load(inv);
      if (!s) throw new Error(`investigação desconhecida: ${inv}`);
      if (s.concluded) return 'concluida';
      if (s.waiting) return 'esperando-repetir';
      if (s.pending) return 'aguardando';
      // O app pode ter fechado entre a última crença e a conclusão.
      const settled = settle(s);
      if (settled) return settled;

      const base = (typeof ctx === 'function' ? ctx() : ctx) || {};
      const c = { ...base, done: [...(base.done || []), ...s.done, ...s.denied] };
      const choice = Planner.choose(s.hyps, s.beliefs, c);
      if (choice.need) return giveUp(s, choice.need);
      if (choice.stop) return pause(s, choice.stop);
      const a = choice.action;
      if (choice.needsApproval && !s.approved.has(idOf(a.type, a.target))) return ask(s, a);
      return run(s, a);
    }

    // ---------- interface ----------

    async function open(anomaly) {
      if (!anomaly || typeof anomaly.symptom !== 'string' || !anomaly.symptom) throw new TypeError('anomalia sem sintoma');
      const same = attach(anomaly);
      if (same != null) return same;
      try {
        return create(anomaly);
      } catch (e) {
        if (e instanceof WriteFailed) return -1; // abertura incompleta: sem a crença inicial ela é ignorada
        throw e;
      }
    }

    function create(anomaly) {
      const inv = put('investigacao', { data: { anomaly, symptom: anomaly.symptom } });
      heads.set(inv, { id: inv, kind: 'investigacao', inv: null, data: { anomaly, symptom: anomaly.symptom } });
      const extra = typeof correlations === 'function' ? correlations(anomaly) : correlations;
      const hyps = Forge.forge(anomaly, map, { correlations: Array.isArray(extra) ? extra : [] });
      for (const h of hyps) put('hipotese', { inv, data: h });
      put('crenca', { inv, data: { beliefs: Object.fromEntries(hyps.map((h) => [h.key, h.prior])) } });
      const value = anomaly.data && finite(anomaly.data.value) ? anomaly.data.value : undefined;
      think(inv, { type: 'notei', signal: anomaly.symptom, value });
      const shown = hyps.filter((h) => h.source !== 'desconhecida').slice(0, SUSPECTS).concat(hyps.filter((h) => h.source === 'desconhecida'));
      for (const h of shown) think(inv, { type: 'suspeito', hypothesis: slimHyp(h), belief: h.prior });
      return inv;
    }

    /** A lentidão repetiu: vira prova da investigação aberta do mesmo sintoma (e o resultado da espera, se houver). */
    function attach(anomaly) {
      try {
        return attachOnce(anomaly);
      } catch (e) {
        if (e instanceof WriteFailed) return null; // não anexou: a leitura seguinte conserta o que ficou pela metade
        throw e;
      }
    }

    function attachOnce(anomaly) {
      const symptom = anomaly && anomaly.symptom;
      if (typeof symptom !== 'string' || !symptom) return null;
      const inv = openFor(symptom);
      if (inv == null) return null;
      const s = load(inv);
      if (!s) return null;
      if (s.waiting) {
        const a = s.waiting.data.action;
        const given = anomaly.data && anomaly.data.outcome;
        const ok = given && VOCAB.includes(given.observed);
        // Sem resultado detalhado, a repetição conta como "o sintoma voltou", com peso pequeno.
        const outcome = { action: a.type, target: a.target, observed: ok ? given.observed : 'sobe', significant: ok ? !!given.significant : false };
        absorb(s, a, outcome, s.waiting.id, anomaly);
      } else {
        put('prova', { inv, data: { kind: 'repeticao', anomaly } });
        const value = anomaly.data && finite(anomaly.data.value) ? anomaly.data.value : undefined;
        think(inv, { type: 'notei', signal: symptom, value });
      }
      return inv;
    }

    function step(inv) {
      if (running.has(inv)) return running.get(inv);
      const p = doStep(inv).finally(() => running.delete(inv));
      running.set(inv, p);
      return p;
    }

    async function resume() {
      const ids = openRows().map((r) => r.id);
      for (const id of ids) head(id);
      return ids;
    }

    function answer(inv, status) {
      try {
        const s = load(inv);
        if (!s || s.concluded || !s.pending) return false;
        put('pedido', { inv, ref: s.pending.id, data: { action: s.pending.data.action, status } });
        return true;
      } catch (e) {
        if (e instanceof WriteFailed) return false;
        throw e;
      }
    }

    return {
      open,
      step,
      resume,
      attach,
      approve: (inv) => answer(inv, 'aprovado'),
      deny: (inv) => answer(inv, 'negado'),
      mapEvents: (inv) => store.list('relacao', { inv, limit: ALL }).map((r) => r.data)
    };
  }

  return { createEngine };
});
