'use strict';
// Motor de investigação do Cortex (src/cortex/engine.js): abre, dá passos, grava tudo só acrescentando e retoma
// depois de o app fechar, lendo apenas os registros.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/cortex/engine.js');
const M = require('../src/cortex/mind.js');
const R = require('../src/cortex/relations.js');
const { memoryStore, T0 } = require('./fixtures/pcs-simulados/index.cjs');

const edge = (from, to, weight = 0.8, type = 'causa') => ({ id: `${from}>${to}`, from, to, type, weight, origem: 'semente' });
// Calor derruba o clock; calor também derruba dois testes do lab (o que permite provar por experimento).
const heatMap = () => R.createMap([edge('temp_cpu', 'clock_queda'), edge('temp_cpu', 'bench:single', 0.6, 'afeta'), edge('temp_cpu', 'bench:multi', 0.6, 'afeta')]);
const anomaly = (symptom = 'clock_queda', extra = {}) => ({ kind: 'lentidao', symptom, at: T0, window: { from: T0 - 60000, to: T0 }, data: { value: 0.6 }, ...extra });
const deep = (extra = {}) => () => ({ permission: 'sozinho', maxRisk: 'alto', activeToday: 0, deep: true, onBattery: false, done: [], ...extra });

/** act falso de uma máquina com calor de verdade; `override` troca a resposta de ações específicas. */
function heatAct(override = {}) {
  const calls = [];
  const truth = {
    'lembrar:temp_cpu': ['antes', true], 'lembrar:rotina': ['ausente', true], 'esperar:clock_queda': ['sobe', true],
    'medir:bench:single': ['desce', true], 'medir:bench:multi': ['desce', true]
  };
  const fn = async (action) => {
    const id = `${action.type}:${action.target}`;
    calls.push(id);
    if (override[id] !== undefined) {
      const o = typeof override[id] === 'function' ? override[id](calls) : override[id];
      if (o === null || (o && o.observed === 'interrompido')) return o;
      return { action: action.type, target: action.target, ...o };
    }
    const [observed, significant] = truth[id] || ['igual', false];
    return { action: action.type, target: action.target, observed, significant };
  };
  fn.calls = calls;
  return fn;
}

async function untilDone(engine, inv, max = 40) {
  const seen = [];
  for (let i = 0; i < max; i++) {
    const r = await engine.step(inv);
    seen.push(r);
    if (r !== 'continua') return seen;
  }
  return seen;
}
const kinds = (store, kind, inv) => store.rows.filter((r) => r.kind === kind && (inv == null || r.inv === inv));

test('mind v0: interface existe e está vazia', async () => {
  assert.equal(M.available(), false);
  assert.deepEqual(await M.proposeHypotheses({}), []);
  assert.equal(await M.narrate({ type: 'notei', signal: 'cpu' }), null);
});

test('abre, dá passos até concluir apoiada e grava cada etapa', async () => {
  const store = memoryStore();
  const thoughts = [];
  const act = heatAct();
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0, onThought: (t) => thoughts.push(t) });
  const inv = await engine.open(anomaly());
  assert.ok(inv > 0);
  assert.equal(kinds(store, 'investigacao').length, 1);
  assert.ok(kinds(store, 'hipotese', inv).length >= 3, 'hipóteses gravadas');
  assert.equal(kinds(store, 'crenca', inv).length, 1, 'crença inicial');

  const seen = await untilDone(engine, inv);
  assert.equal(seen[seen.length - 1], 'concluida');
  const end = kinds(store, 'conclusao', inv);
  assert.equal(end.length, 1);
  assert.equal(end[0].data.verdict.status, 'apoiada');
  assert.equal(end[0].data.verdict.winner, 'temp_cpu>clock_queda');
  assert.ok(act.calls.some((c) => c.startsWith('medir:')), 'só experimento leva a apoiada');

  const exps = kinds(store, 'experimento', inv);
  assert.equal(exps.length, act.calls.length, 'um experimento por ação feita');
  assert.ok(exps.every((r) => r.data.status === 'feito'));
  assert.equal(kinds(store, 'prova', inv).length, exps.length, 'uma prova por experimento');
  assert.ok(kinds(store, 'prova', inv).every((p) => exps.some((x) => x.id === p.ref)), 'prova aponta para o experimento');
  assert.equal(kinds(store, 'crenca', inv).length, exps.length + 1, 'nova crença a cada resultado, a anterior fica');

  // Eventos do mapa: a favor nas ligações da vencedora, e o motor não mexe sozinho no mapa.
  const events = engine.mapEvents(inv);
  assert.deepEqual(events.filter((e) => e.kind === 'experimento-a-favor').map((e) => e.edgeId), ['temp_cpu>clock_queda']);
  assert.ok(events.every((e) => e.inv === inv && e.at === T0));
  assert.equal(kinds(store, 'relacao', inv).length, events.length);
  assert.equal(engine.mapEvents(inv).length, events.length, 'ler os eventos não grava nada');

  assert.equal(thoughts.length, kinds(store, 'pensamento', inv).length, 'cada pensamento gravado também é avisado');
  for (const t of thoughts) assert.doesNotMatch(t, /provavelmente|talvez seja|deve ser|com certeza/i);
  assert.ok(kinds(store, 'pensamento', inv).some((p) => p.data.step.type === 'conclusao'));
  assert.equal(await engine.step(inv), 'concluida', 'concluída fica concluída');
});

test('a mesma lentidão de novo anexa prova na investigação aberta em vez de abrir outra', async () => {
  const store = memoryStore();
  const engine = E.createEngine({ store, map: heatMap(), act: heatAct(), ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  const again = await engine.open(anomaly('clock_queda', { at: T0 + 60000 }));
  assert.equal(again, inv);
  assert.equal(engine.attach(anomaly('clock_queda', { at: T0 + 120000 })), inv);
  assert.equal(kinds(store, 'investigacao').length, 1);
  assert.equal(kinds(store, 'prova', inv).length, 2, 'cada repetição vira prova');
  assert.equal(engine.attach(anomaly('cpu')), null, 'outro sintoma não anexa');
  const other = await engine.open(anomaly('cpu'));
  assert.notEqual(other, inv);
});

test('app fechado no meio: um motor novo com a mesma loja retoma do passo seguinte', async () => {
  // Corrida inteira sem interrupção, como referência.
  const refStore = memoryStore();
  const refAct = heatAct();
  const ref = E.createEngine({ store: refStore, map: heatMap(), act: refAct, ctx: deep(), now: () => T0 });
  const refInv = await ref.open(anomaly());
  await untilDone(ref, refInv);

  const store = memoryStore();
  const first = heatAct();
  const a = E.createEngine({ store, map: heatMap(), act: first, ctx: deep(), now: () => T0 });
  const inv = await a.open(anomaly());
  await a.step(inv);
  await a.step(inv);
  assert.equal(first.calls.length, 2);

  const second = heatAct();
  const b = E.createEngine({ store, map: heatMap(), act: second, ctx: deep(), now: () => T0 });
  assert.deepEqual(await b.resume(), [inv]);
  await untilDone(b, inv);
  assert.deepEqual([...first.calls, ...second.calls], refAct.calls, 'nenhum passo repetido nem pulado');
  assert.ok(second.calls.every((c) => !first.calls.includes(c)));
  const end = kinds(store, 'conclusao', inv)[0].data.verdict;
  assert.deepEqual(end, kinds(refStore, 'conclusao', refInv)[0].data.verdict);
  assert.deepEqual(await b.resume(), [], 'concluída não volta como aberta');
});

test('pedir antes: grava pedido e devolve aguardando até a pessoa aprovar; negar tira a ação da lista', async () => {
  // Ajuste ligado ao teste: a única prova possível é mexer nele.
  const map = () => R.createMap([edge('ajuste:perfepp', 'bench:single', 0.6, 'afeta')]);
  const sym = anomaly('bench:single');
  const make = () => {
    const calls = [];
    const fn = async (a) => {
      calls.push(`${a.type}:${a.target}`);
      // A medição sozinha não decide (fica dentro do ruído): sobra mexer no ajuste.
      const o = a.type === 'intervir' ? ['sobe', true] : a.type === 'esperar' ? ['sobe', true] : a.target === 'ajuste:perfepp' ? ['antes', true] : a.type === 'medir' ? ['igual', false] : ['ausente', true];
      return { action: a.type, target: a.target, observed: o[0], significant: o[1] };
    };
    fn.calls = calls;
    return fn;
  };

  const store = memoryStore();
  const act = make();
  const engine = E.createEngine({ store, map: map(), act, ctx: deep({ permission: 'pedir' }), now: () => T0 });
  const inv = await engine.open(sym);
  const seen = await untilDone(engine, inv);
  assert.equal(seen[seen.length - 1], 'aguardando');
  assert.ok(!act.calls.some((c) => c.startsWith('intervir:')), 'não mexe sem autorização');
  const asks = kinds(store, 'pedido', inv);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].data.action.type, 'intervir');
  assert.equal(await engine.step(inv), 'aguardando');
  assert.equal(kinds(store, 'pedido', inv).length, 1, 'não repete o pedido');
  assert.ok(engine.approve(inv));
  await untilDone(engine, inv);
  assert.ok(act.calls.includes('intervir:ajuste:perfepp'));
  assert.equal(kinds(store, 'pedido', inv).length, 2, 'a resposta é um registro novo; o pedido fica como estava');

  const store2 = memoryStore();
  const act2 = make();
  const e2 = E.createEngine({ store: store2, map: map(), act: act2, ctx: deep({ permission: 'pedir' }), now: () => T0 });
  const inv2 = await e2.open(sym);
  await untilDone(e2, inv2);
  assert.ok(e2.deny(inv2));
  assert.equal(e2.approve(inv2), false, 'nada mais pendente');
  const after = await untilDone(e2, inv2);
  assert.notEqual(after[after.length - 1], 'aguardando');
  assert.ok(!act2.calls.some((c) => c.startsWith('intervir:')));
});

test('nenhum registro é sobrescrito: a loja só cresce e os dados gravados não mudam depois', async () => {
  const store = memoryStore();
  const engine = E.createEngine({ store, map: heatMap(), act: heatAct({ 'medir:bench:multi': { observed: 'interrompido' } }), ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  let count = store.rows.length;
  for (let i = 0; i < 30; i++) {
    const r = await engine.step(inv);
    assert.ok(store.rows.length >= count);
    count = store.rows.length;
    engine.attach(anomaly());
    if (r === 'concluida') break;
  }
  await engine.resume();
  engine.mapEvents(inv);
  store.rows.forEach((row, i) => {
    assert.equal(row.id, i + 1);
    assert.equal(JSON.stringify(row.data), row.snapshot, `registro ${row.id} (${row.kind}) foi mexido`);
  });
});

test('esperar sem resultado: esperando-repetir até a lentidão repetir, e a repetição vira o resultado', async () => {
  const store = memoryStore();
  const act = heatAct({ 'esperar:clock_queda': null });
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  const seen = await untilDone(engine, inv);
  assert.equal(seen[seen.length - 1], 'esperando-repetir');
  const calls = act.calls.length;
  assert.equal(await engine.step(inv), 'esperando-repetir');
  assert.equal(act.calls.length, calls, 'não chama de novo enquanto espera');
  const waiting = kinds(store, 'experimento', inv).find((r) => r.data.status === 'esperando');
  assert.ok(waiting);

  assert.equal(engine.attach(anomaly('clock_queda', { data: { value: 0.5, outcome: { observed: 'sobe', significant: true } } })), inv);
  const done = kinds(store, 'experimento', inv).filter((r) => r.data.status === 'feito' && r.prev === waiting.id);
  assert.equal(done.length, 1, 'o resultado aponta para a espera');
  assert.deepEqual(done[0].data.outcome, { action: 'esperar', target: 'clock_queda', observed: 'sobe', significant: true });
  assert.ok(kinds(store, 'prova', inv).some((p) => p.ref === done[0].id));
  const rest = await untilDone(engine, inv);
  assert.equal(rest[rest.length - 1], 'concluida');
  assert.equal(act.calls.filter((c) => c === 'esperar:clock_queda').length, 1, 'esperar não é refeito');
});

test('planejador pausa (ritmo leve): pausada, um pensamento só, e continua quando o PC fica livre', async () => {
  const store = memoryStore();
  let isDeep = false;
  const act = heatAct();
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: () => deep({ deep: isDeep })(), now: () => T0 });
  const inv = await engine.open(anomaly());
  const seen = await untilDone(engine, inv);
  assert.equal(seen[seen.length - 1], 'pausada');
  assert.ok(!act.calls.some((c) => c.startsWith('medir:')), 'no leve não mede');
  const thoughts = kinds(store, 'pensamento', inv).length;
  const exps = kinds(store, 'experimento', inv).length;
  assert.equal(await engine.step(inv), 'pausada');
  assert.equal(await engine.step(inv), 'pausada');
  assert.equal(kinds(store, 'pensamento', inv).length, thoughts, 'pausa repetida não enche o diário');
  assert.equal(kinds(store, 'experimento', inv).length, exps);
  assert.equal(kinds(store, 'conclusao', inv).length, 0, 'pausar não conclui');
  isDeep = true;
  const rest = await untilDone(engine, inv);
  assert.equal(rest[rest.length - 1], 'concluida');
  assert.equal(kinds(store, 'conclusao', inv)[0].data.verdict.status, 'apoiada');
});

test('teste interrompido: experimento interrompido, sem prova, crença igual, e a ação é refeita', async () => {
  const store = memoryStore();
  const act = heatAct({ 'medir:bench:multi': (calls) => (calls.filter((c) => c === 'medir:bench:multi').length === 1 ? { observed: 'interrompido' } : { observed: 'desce', significant: true }) });
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  for (let i = 0; i < 40; i++) {
    const before = store.latest('crenca', { inv }).id;
    const proofs = kinds(store, 'prova', inv).length;
    const r = await engine.step(inv);
    const last = kinds(store, 'experimento', inv).pop();
    if (last && last.data.status === 'interrompido') {
      assert.equal(r, 'continua');
      assert.equal(store.latest('crenca', { inv }).id, before, 'crença não muda');
      assert.equal(kinds(store, 'prova', inv).length, proofs, 'interrompido não vira prova');
      assert.ok(kinds(store, 'pensamento', inv).pop().data.step.type === 'interrompido');
      break;
    }
    assert.ok(r === 'continua', `parou antes de interromper: ${r}`);
  }
  await untilDone(engine, inv);
  assert.equal(act.calls.filter((c) => c === 'medir:bench:multi').length, 2, 'refeito');
  assert.equal(kinds(store, 'experimento', inv).filter((r) => r.data.status === 'interrompido').length, 1);
});

test('nada separa as explicações: necessidade + conclusão não resolvido', async () => {
  const store = memoryStore();
  // Mapa vazio: o forjador só tem a rotina, o programa pesado genérico e a desconhecida. Nada aparece na memória e o
  // sintoma volta de leve: cada pista fraca puxa para um lado, e ninguém fica na frente.
  const act = async (a) => ({ action: a.type, target: a.target, observed: a.type === 'lembrar' ? 'ausente' : 'sobe', significant: false });
  const engine = E.createEngine({ store, map: R.createMap([]), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly('travadas'));
  const seen = await untilDone(engine, inv);
  assert.equal(seen[seen.length - 1], 'concluida');
  const need = kinds(store, 'necessidade', inv);
  assert.equal(need.length, 1);
  assert.ok(Array.isArray(need[0].data.between) && need[0].data.between.length >= 2);
  assert.equal(typeof need[0].data.reason, 'string');
  const end = kinds(store, 'conclusao', inv)[0].data;
  assert.equal(end.verdict.status, 'nao-resolvido');
  assert.equal(end.verdict.winner, null, 'sem vencedora: não resolvido sem ninguém');
  assert.ok(Array.isArray(end.verdict.refuted));
  // Tudo o que o programa pesado previa já foi olhado: não dá para dizer "faltou medir" dele.
  assert.deepEqual(need[0].data.missing, []);
  assert.deepEqual(end.missing, []);
  assert.equal(need[0].data.outside, true, 'o que falta está fora do que eu meço');
  const said = kinds(store, 'pensamento', inv).filter((p) => ['necessidade', 'conclusao'].includes(p.data.step.type)).map((p) => p.data.text);
  assert.match(said[0], /fora do que eu consigo medir/);
  assert.doesNotMatch(said.join(' '), /Programa pesado/);
});

test('sem passo novo mas com vencedora correlacionada: conclui correlacionada e diz o que falta para provar', async () => {
  const store = memoryStore();
  // Só calor → clock no mapa (sem teste do lab ligado): a memória e a espera apontam o calor, mas não há experimento.
  const act = heatAct();
  const engine = E.createEngine({ store, map: R.createMap([edge('temp_cpu', 'clock_queda')]), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  const seen = await untilDone(engine, inv);
  assert.equal(seen[seen.length - 1], 'concluida');
  assert.ok(!act.calls.some((c) => /^(medir|intervir):/.test(c)));
  const end = kinds(store, 'conclusao', inv)[0].data.verdict;
  assert.equal(end.status, 'correlacionada');
  assert.equal(end.winner, 'temp_cpu>clock_queda');
  const need = kinds(store, 'necessidade', inv);
  assert.equal(need.length, 1);
  assert.equal(need[0].data.goal, 'apoiada', 'a necessidade é a prova que faltou');
  assert.deepEqual(need[0].data.between, ['temp_cpu>clock_queda']);
  assert.deepEqual(need[0].data.missing, [], 'nenhum teste do lab mede o calor neste mapa');
  assert.match(kinds(store, 'pensamento', inv).find((p) => p.data.step.type === 'necessidade').data.text, /teste/);
  assert.ok(!engine.mapEvents(inv).some((e) => e.kind === 'experimento-a-favor'), 'correlacionada não é prova');
});

test('não conclui apoiada se um teste forte contradiz a vencedora', async () => {
  const store = memoryStore();
  // Calor bate em tudo, mas o teste de todos os núcleos ficou igual (forte): a explicação não se sustenta inteira.
  const act = heatAct({ 'medir:bench:multi': { observed: 'igual', significant: true } });
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  await untilDone(engine, inv);
  assert.ok(act.calls.includes('medir:bench:single') && act.calls.includes('medir:bench:multi'));
  const end = kinds(store, 'conclusao', inv)[0].data.verdict;
  assert.notEqual(end.status, 'apoiada');
  assert.ok(!engine.mapEvents(inv).some((e) => e.kind === 'experimento-a-favor'));
});

test('hipótese derrubada por teste forte gera experimento-contra na ligação dela', async () => {
  const store = memoryStore();
  // O calor não aparece na memória, o sintoma não repete e os dois testes do lab ficam iguais (tudo forte): calor cai.
  const strong = (observed) => ({ observed, significant: true });
  const act = heatAct({ 'lembrar:temp_cpu': strong('ausente'), 'esperar:clock_queda': strong('igual'), 'medir:bench:multi': strong('igual'), 'medir:bench:single': strong('igual') });
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  await untilDone(engine, inv);
  const end = kinds(store, 'conclusao', inv)[0].data.verdict;
  assert.ok(end.refuted.includes('temp_cpu>clock_queda'), JSON.stringify(end));
  assert.ok(engine.mapEvents(inv).some((e) => e.kind === 'experimento-contra' && e.edgeId === 'temp_cpu>clock_queda'));
});

// ---------- gravação que falha e app que morre entre gravações ----------

/** Loja que devolve -1 (como memory.record com disco cheio) quando `fails(kind, data, opts, n)` diz que sim. */
function flaky(fails) {
  const store = memoryStore();
  let n = 0;
  let on = true;
  const record = store.record;
  store.record = (kind, opts = {}) => {
    n++;
    if (on && fails(kind, opts.data || {}, opts, n)) return -1;
    return record(kind, opts);
  };
  store.heal = () => { on = false; };
  return store;
}

async function reference() {
  const store = memoryStore();
  const act = heatAct();
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  await untilDone(engine, inv);
  return { calls: act.calls, verdict: kinds(store, 'conclusao', inv)[0].data.verdict };
}

test('crença não grava: o passo para (falha-gravacao) e a próxima leitura refaz a crença, sem repetir a ação', async () => {
  const ref = await reference();
  let once = true;
  const store = flaky((kind, data, opts) => kind === 'crenca' && opts.ref != null && once && !(once = false));
  const act = heatAct();
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  assert.equal(await engine.step(inv), 'falha-gravacao');
  const exp = kinds(store, 'experimento', inv);
  assert.equal(exp.length, 1);
  assert.equal(kinds(store, 'crenca', inv).filter((c) => c.ref === exp[0].id).length, 0);
  assert.equal(kinds(store, 'pensamento', inv).filter((p) => p.data.step.type === 'resultado').length, 0, 'parou antes de narrar');
  await untilDone(engine, inv);
  assert.deepEqual(act.calls, ref.calls, 'a ação não foi refeita nem contada duas vezes');
  const fixed = kinds(store, 'crenca', inv).filter((c) => c.ref === exp[0].id);
  assert.equal(fixed.length, 1, 'crença refeita, uma vez só');
  const chain = kinds(store, 'crenca', inv);
  assert.ok(chain.slice(1).every((c, i) => c.prev === chain[i].id), 'cada crença aponta para a anterior');
  assert.deepEqual(kinds(store, 'conclusao', inv)[0].data.verdict, ref.verdict);
});

test('experimento não grava: o passo para e a ação é refeita (a evidência entra uma vez só)', async () => {
  let once = true;
  const store = flaky((kind, data) => kind === 'experimento' && data.status === 'feito' && once && !(once = false));
  const act = heatAct();
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  assert.equal(await engine.step(inv), 'falha-gravacao');
  assert.equal(kinds(store, 'experimento', inv).length, 0);
  assert.equal(kinds(store, 'prova', inv).length, 0, 'nada gravado depois da falha');
  assert.equal(kinds(store, 'crenca', inv).length, 1);
  await untilDone(engine, inv);
  const first = act.calls[0];
  assert.equal(act.calls.filter((c) => c === first).length, 2, 'refeita');
  assert.equal(kinds(store, 'experimento', inv).filter((r) => `${r.data.action.type}:${r.data.action.target}` === first).length, 1);
  assert.equal(kinds(store, 'conclusao', inv)[0].data.verdict.status, 'apoiada');
});

test('pedido, necessidade e conclusão que não gravam também param o passo', async () => {
  const store = flaky((kind) => kind === 'conclusao');
  const engine = E.createEngine({ store, map: heatMap(), act: heatAct(), ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  const seen = await untilDone(engine, inv);
  assert.equal(seen[seen.length - 1], 'falha-gravacao');
  assert.equal(kinds(store, 'relacao', inv).length, 0, 'sem conclusão, sem eventos do mapa');
  store.heal();
  assert.equal(await engine.step(inv), 'concluida');
  assert.equal(kinds(store, 'conclusao', inv).length, 1);

  const asks = flaky((kind) => kind === 'pedido');
  const map = R.createMap([edge('ajuste:perfepp', 'bench:single', 0.6, 'afeta')]);
  const act = async (a) => ({ action: a.type, target: a.target, observed: a.type === 'intervir' || a.type === 'esperar' ? 'sobe' : a.target === 'ajuste:perfepp' ? 'antes' : a.type === 'medir' ? 'igual' : 'ausente', significant: a.type !== 'medir' });
  const e2 = E.createEngine({ store: asks, map, act, ctx: deep({ permission: 'pedir' }), now: () => T0 });
  const inv2 = await e2.open(anomaly('bench:single'));
  const r2 = await untilDone(e2, inv2);
  assert.equal(r2[r2.length - 1], 'falha-gravacao', 'sem o pedido gravado, não diz que está aguardando');
  assert.equal(e2.approve(inv2), false);
});

test('app morre entre a prova e a crença: um motor novo refaz a crença e segue igual à corrida sem queda', async () => {
  const ref = await reference();
  const store = memoryStore();
  const record = store.record;
  let crash = true;
  store.record = (kind, opts) => {
    if (crash && kind === 'crenca' && opts && opts.ref != null) { crash = false; throw new Error('o app fechou'); }
    return record(kind, opts);
  };
  const first = heatAct();
  const a = E.createEngine({ store, map: heatMap(), act: first, ctx: deep(), now: () => T0 });
  const inv = await a.open(anomaly());
  await a.step(inv).catch(() => {});
  assert.equal(kinds(store, 'experimento', inv).length, 1);
  assert.equal(kinds(store, 'prova', inv).length, 1);

  const second = heatAct();
  const b = E.createEngine({ store, map: heatMap(), act: second, ctx: deep(), now: () => T0 });
  assert.deepEqual(await b.resume(), [inv]);
  await untilDone(b, inv);
  assert.deepEqual([...first.calls, ...second.calls], ref.calls);
  const exp = kinds(store, 'experimento', inv)[0];
  assert.equal(kinds(store, 'crenca', inv).filter((c) => c.ref === exp.id).length, 1, 'crença do primeiro resultado refeita');
  assert.deepEqual(kinds(store, 'conclusao', inv)[0].data.verdict, ref.verdict);
});

test('medir sem referência ainda: experimento invalido que NÃO conta como feito; o mesmo teste é refeito e aí vale', async () => {
  const store = memoryStore();
  // O primeiro medir (seja qual for o teste) ainda não tem referência; depois, a máquina responde de verdade.
  let first = null;
  const once = (target) => () => { if (!first) { first = target; return { observed: 'sem-referencia', significant: false }; } return { observed: 'desce', significant: true }; };
  const act = heatAct({ 'medir:bench:single': once('bench:single'), 'medir:bench:multi': once('bench:multi') });
  const engine = E.createEngine({ store, map: heatMap(), act, ctx: deep(), now: () => T0 });
  const inv = await engine.open(anomaly());
  const seen = await untilDone(engine, inv);
  assert.equal(seen[seen.length - 1], 'concluida');
  assert.ok(first, 'nunca mediu');
  const order = act.calls.filter((c) => c.startsWith('medir:'));
  assert.deepEqual(order.slice(0, 2), [`medir:${first}`, `medir:${first}`], order.join(', '));
  const exps = kinds(store, 'experimento', inv).map((r) => r.data);
  assert.ok(exps.some((e) => e.status === 'invalido' && e.detail === 'sem-referencia'));
  assert.ok(exps.some((e) => e.status === 'feito' && e.action.target === first));
  // Sem prova para o invalido; a frase é a do narrador para "sem referência".
  assert.equal(kinds(store, 'prova', inv).filter((p) => p.data.outcome && p.data.outcome.observed === 'sem-referencia').length, 0);
  assert.ok(kinds(store, 'pensamento', inv).some((p) => /referência/.test(p.data.text)));
  // Outro invalido continua contando como feito (não repete).
  const store2 = memoryStore();
  const act2 = heatAct({ 'medir:bench:single': { observed: 'xyz', significant: false }, 'medir:bench:multi': { observed: 'xyz', significant: false } });
  const engine2 = E.createEngine({ store: store2, map: heatMap(), act: act2, ctx: deep(), now: () => T0 });
  const inv2 = await engine2.open(anomaly());
  await untilDone(engine2, inv2);
  for (const b of ['bench:single', 'bench:multi']) assert.ok(act2.calls.filter((c) => c === `medir:${b}`).length <= 1, act2.calls.join(', '));
});
