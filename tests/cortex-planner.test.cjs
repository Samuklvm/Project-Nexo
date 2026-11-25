'use strict';
// Planejador do Cortex (src/cortex/planner.js): escolhe a ação que mais separa as hipóteses, por ganho ÷ custo.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/cortex/planner.js');

const pred = (action, target, expect) => ({ action, target, expect });
const hyp = (key, prior, predictions) => ({ key, cause: key.split('>')[0], symptom: 's', via: [], prior, source: 'mapa', predictions });
const priors = (hs) => Object.fromEntries(hs.map((h) => [h.key, h.prior]));
const ctx = (extra = {}) => ({ permission: 'sozinho', maxRisk: 'alto', activeToday: 0, deep: true, onBattery: false, done: [], ...extra });

// A e B igualmente prováveis. `lembrar x` não separa (as duas preveem o mesmo); `medir bench:b` separa.
const dois = () => [
  hyp('A>s', 0.5, [pred('lembrar', 'x', 'presente'), pred('medir', 'bench:b', 'desce')]),
  hyp('B>s', 0.5, [pred('lembrar', 'x', 'presente'), pred('medir', 'bench:b', 'igual')]),
];

test('COST e MIN_GAIN têm os valores do brief', () => {
  assert.deepEqual(P.COST, { lembrar: 0.05, esperar: 0.3, medir: 1, intervir: 3 });
  assert.equal(P.MIN_GAIN, 0.05);
});

test('actionsFor: uma ação por alvo distinto, presente e antes viram a mesma ação', () => {
  const hs = [hyp('A>s', 0.6, [pred('lembrar', 'x', 'presente'), pred('lembrar', 'x', 'antes'), pred('intervir', 'ajuste:perfepp', 'sobe')]),
    hyp('B>s', 0.4, [pred('lembrar', 'x', 'ausente'), pred('medir', 'bench:b', 'desce')])];
  const acts = P.actionsFor(hs);
  assert.equal(acts.length, 3);
  const k = (t, g) => acts.find((a) => a.type === t && a.target === g);
  assert.equal(k('lembrar', 'x').cost, 0.05);
  assert.equal(k('lembrar', 'x').risk, 'nenhum');
  assert.equal(k('medir', 'bench:b').cost, 1);
  assert.equal(k('intervir', 'ajuste:perfepp').cost, 3);
  assert.equal(k('intervir', 'ajuste:perfepp').risk, 'baixo');
});

test('actionsFor: ajuste desconhecido tem risco alto', () => {
  const acts = P.actionsFor([hyp('A>s', 1, [pred('intervir', 'ajuste:nao_existe', 'sobe')])]);
  assert.equal(acts[0].risk, 'alto');
});

test('expectedGain: ação que não separa vale 0; a que separa 2 iguais vale 1 bit', () => {
  const hs = dois();
  assert.ok(Math.abs(P.expectedGain({ type: 'lembrar', target: 'x' }, hs, priors(hs))) < 1e-9);
  assert.ok(Math.abs(P.expectedGain({ type: 'medir', target: 'bench:b' }, hs, priors(hs)) - 1) < 1e-9);
});

test('expectedGain: presente e antes na mesma ação contam como resultados distintos', () => {
  const hs = [hyp('A>s', 0.5, [pred('lembrar', 'x', 'presente')]), hyp('B>s', 0.5, [pred('lembrar', 'x', 'antes')])];
  assert.ok(P.expectedGain({ type: 'lembrar', target: 'x' }, hs, priors(hs)) > 0.9);
});

const H = (ps) => -ps.reduce((acc, p) => (p > 0 ? acc + p * Math.log2(p) : acc), 0);

test('expectedGain: hipótese sem previsão se espalha pelo domínio inteiro da ação (valor exato)', () => {
  const hs = [hyp('A>s', 0.4, [pred('medir', 'bench:b', 'desce')]), hyp('B>s', 0.4, [pred('medir', 'bench:b', 'igual')]), hyp('C>s', 0.2, [])];
  // C reparte 1/3 em sobe, desce e igual. desce e igual: 0.4 + 0.2/3 cada, posterior (0.4, 0.2/3)/p; sobe: só C (certeza).
  const pd = 0.4 + 0.2 / 3;
  const esperado = H([0.4, 0.4, 0.2]) - 2 * pd * H([0.4 / pd, 0.2 / 3 / pd]);
  assert.ok(Math.abs(P.expectedGain({ type: 'medir', target: 'bench:b' }, hs, priors(hs)) - esperado) < 1e-9);
});

test('expectedGain: teste que só uma hipótese prevê separa (a outra se espalha), valor exato', () => {
  // lembrar: domínio presente/ausente/antes/depois. B espalha 1/4 em cada; presente: 0.5 + 0.125, posterior (0.8, 0.2).
  const hs = [hyp('A>s', 0.5, [pred('lembrar', 'x', 'presente')]), hyp('B>s', 0.5, [])];
  assert.ok(Math.abs(P.expectedGain({ type: 'lembrar', target: 'x' }, hs, priors(hs)) - (1 - 0.625 * H([0.8, 0.2]))) < 1e-9);
  // medir/intervir/esperar: domínio sobe/desce/igual. desce: 0.5 + 1/6, posterior (0.75, 0.25).
  const ms = [hyp('A>s', 0.5, [pred('medir', 'bench:b', 'desce')]), hyp('B>s', 0.5, [])];
  assert.ok(Math.abs(P.expectedGain({ type: 'medir', target: 'bench:b' }, ms, priors(ms)) - (1 - (2 / 3) * H([0.75, 0.25]))) < 1e-9);
});

test('empate de ganho/custo: ajuste de risco menor primeiro, depois o id', () => {
  // boostmode (moderado) vem antes de perfepp (baixo) pelo id; o risco menor ganha.
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:boostmode', 'sobe'), pred('intervir', 'ajuste:perfepp', 'sobe')]), hyp('B>s', 0.5, [])];
  const r = P.choose(hs, priors(hs), ctx());
  assert.equal(r.action.target, 'ajuste:perfepp');
  const baixos = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'sobe'), pred('intervir', 'ajuste:minstate', 'sobe')]), hyp('B>s', 0.5, [])];
  assert.equal(P.choose(baixos, priors(baixos), ctx()).action.target, 'ajuste:minstate', 'mesmo risco: menor id');
});

test('expectedGain: hipótese com dois expect no mesmo alvo reparte por igual (valor exato)', () => {
  const hs = [hyp('A>s', 0.5, [pred('lembrar', 'x', 'presente'), pred('lembrar', 'x', 'antes')]), hyp('B>s', 0.5, [pred('lembrar', 'x', 'presente')])];
  // resultado presente (0.75): posterior (1/3, 2/3); antes (0.25): certeza. 1 - 0.75 * H(1/3, 2/3)
  const esperado = 1 - 0.75 * (Math.log2(3) - 2 / 3);
  assert.ok(Math.abs(P.expectedGain({ type: 'lembrar', target: 'x' }, hs, priors(hs)) - esperado) < 1e-9);
});

test('expectedGain: crenças desiguais dão a entropia delas (valor exato)', () => {
  const hs = [hyp('A>s', 0.5, [pred('medir', 'bench:b', 'desce')]), hyp('B>s', 0.5, [pred('medir', 'bench:b', 'igual')])];
  const crencas = { 'A>s': 0.75, 'B>s': 0.25 };
  const esperado = -(0.75 * Math.log2(0.75) + 0.25 * Math.log2(0.25));
  assert.ok(Math.abs(P.expectedGain({ type: 'medir', target: 'bench:b' }, hs, crencas) - esperado) < 1e-9);
});

test('entre lembrar que não separa e medir que separa, escolhe medir', () => {
  const hs = dois();
  const r = P.choose(hs, priors(hs), ctx());
  assert.equal(r.action.type, 'medir');
  assert.equal(r.needsApproval, false);
});

test('com a mesma separação escolhe a mais barata', () => {
  const hs = [hyp('A>s', 0.5, [pred('medir', 'bench:b', 'desce'), pred('lembrar', 'x', 'presente')]),
    hyp('B>s', 0.5, [pred('medir', 'bench:b', 'igual'), pred('lembrar', 'x', 'ausente')])];
  const r = P.choose(hs, priors(hs), ctx());
  assert.equal(r.action.type, 'lembrar');
});

test('observar nunca devolve intervir', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'sobe')]), hyp('B>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'igual')])];
  const r = P.choose(hs, priors(hs), ctx({ permission: 'observar' }));
  assert.ok(!r.action, JSON.stringify(r));
  assert.ok(r.need);
});

test('maxRisk corta intervir de risco acima', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:boostmode', 'sobe')]), hyp('B>s', 0.5, [pred('intervir', 'ajuste:boostmode', 'igual')])];
  assert.ok(P.choose(hs, priors(hs), ctx({ maxRisk: 'baixo' })).need);
  assert.equal(P.choose(hs, priors(hs), ctx({ maxRisk: 'moderado' })).action.type, 'intervir');
});

test('deep:false nunca devolve medir nem intervir', () => {
  const hs = dois();
  const r = P.choose(hs, priors(hs), ctx({ deep: false }));
  assert.ok(!r.action || !['medir', 'intervir'].includes(r.action.type));
  assert.deepEqual(r, { stop: 'ritmo' });
});

test('onBattery nunca devolve intervir', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'sobe')]), hyp('B>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'igual')])];
  assert.deepEqual(P.choose(hs, priors(hs), ctx({ onBattery: true })), { stop: 'bateria' });
});

test('activeToday = 3 não devolve medir nem intervir', () => {
  const hs = dois();
  const r = P.choose(hs, priors(hs), ctx({ activeToday: 3 }));
  assert.ok(!r.action || !['medir', 'intervir'].includes(r.action.type));
  assert.deepEqual(r, { stop: 'orcamento' });
});

test('nada que separe devolve need com as hipóteses empatadas', () => {
  const hs = [hyp('A>s', 0.45, [pred('lembrar', 'x', 'presente')]), hyp('B>s', 0.45, [pred('lembrar', 'x', 'presente')]), hyp('C>s', 0.1, [pred('lembrar', 'x', 'presente')])];
  const r = P.choose(hs, priors(hs), ctx());
  assert.deepEqual(r.need.between.sort(), ['A>s', 'B>s']);
  assert.equal(typeof r.need.reason, 'string');
  assert.ok(!/provavelmente|talvez seja|deve ser|com certeza/.test(r.need.reason));
});

test('ações já feitas (done) não voltam', () => {
  const hs = dois();
  const r = P.choose(hs, priors(hs), ctx({ done: ['medir:bench:b'] }));
  assert.ok(r.need);
});

test('pedir + intervir exige aprovação; sozinho não', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'sobe')]), hyp('B>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'igual')])];
  const pedir = P.choose(hs, priors(hs), ctx({ permission: 'pedir' }));
  assert.equal(pedir.action.type, 'intervir');
  assert.equal(pedir.needsApproval, true);
  assert.equal(P.choose(hs, priors(hs), ctx()).needsApproval, false);
});

test('sem ação permitida e orçamento do dia gasto devolve stop orcamento', () => {
  const hs = [hyp('A>s', 0.5, [pred('medir', 'bench:b', 'desce')]), hyp('B>s', 0.5, [pred('medir', 'bench:b', 'igual')])];
  assert.deepEqual(P.choose(hs, priors(hs), ctx({ activeToday: 3 })), { stop: 'orcamento' });
});

test('só intervir útil: activeToday 3 espera (orcamento); observar não espera (need)', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'sobe')]), hyp('B>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'igual')])];
  assert.deepEqual(P.choose(hs, priors(hs), ctx({ activeToday: 3 })), { stop: 'orcamento' });
  assert.ok(P.choose(hs, priors(hs), ctx({ permission: 'observar', deep: false })).need);
});

test('ritmo vence bateria e orçamento no empate; ganho maior decide o motivo', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'sobe')]), hyp('B>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'igual')])];
  assert.deepEqual(P.choose(hs, priors(hs), ctx({ deep: false, onBattery: true, activeToday: 3 })), { stop: 'ritmo' });
  assert.deepEqual(P.choose(hs, priors(hs), ctx({ onBattery: true, activeToday: 3 })), { stop: 'bateria' });
});

test('permissão ausente, nula ou desconhecida nunca deixa intervir passar; só sozinho é autônomo', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'sobe')]), hyp('B>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'igual')])];
  for (const permission of [undefined, null, 'Pedir', 'SOZINHO', '', 'qualquer']) {
    const r = P.choose(hs, priors(hs), ctx({ permission }));
    assert.ok(!r.action, `permission=${String(permission)} -> ${JSON.stringify(r)}`);
    assert.ok(r.need);
  }
  const semCampo = ctx(); delete semCampo.permission;
  assert.ok(!P.choose(hs, priors(hs), semCampo).action);
  assert.equal(P.choose(hs, priors(hs), ctx({ permission: 'pedir' })).needsApproval, true);
  assert.equal(P.choose(hs, priors(hs), ctx({ permission: 'sozinho' })).needsApproval, false);
});

test('ação permitida mais fraca roda antes de pausar por uma mais forte bloqueada', () => {
  const hs = [hyp('A>s', 0.34, [pred('lembrar', 'x', 'presente'), pred('medir', 'bench:b', 'desce')]),
    hyp('B>s', 0.33, [pred('lembrar', 'x', 'ausente'), pred('medir', 'bench:b', 'igual')]),
    hyp('C>s', 0.33, [pred('lembrar', 'x', 'ausente'), pred('medir', 'bench:b', 'sobe')])];
  const b = priors(hs);
  assert.ok(P.expectedGain({ type: 'medir', target: 'bench:b' }, hs, b) > P.expectedGain({ type: 'lembrar', target: 'x' }, hs, b));
  const r = P.choose(hs, b, ctx({ deep: false }));
  assert.equal(r.action.type, 'lembrar');
});

test('Linux: o risco do ajuste ppd vem do catálogo (baixo), não cai em "alto"', () => {
  const h = (key, expect) => ({ key, cause: key, symptom: 'bench:single', prior: 0.5, predictions: [{ action: 'intervir', target: 'ajuste:ppd', expect }] });
  const choice = P.choose([h('a', 'sobe'), h('b', 'igual')], { a: 0.5, b: 0.5 }, { permission: 'pedir', maxRisk: 'baixo', deep: true, activeToday: 0 });
  assert.ok(choice.action, JSON.stringify(choice));
  assert.equal(choice.action.risk, 'baixo');
});

test('plataforma: ajuste e teste fora do que este sistema tem (ctx.knobs / ctx.benches) contam como inexistentes', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:minstate', 'sobe'), pred('medir', 'bench:disk', 'desce'), pred('medir', 'bench:single', 'desce')]),
    hyp('B>s', 0.5, [pred('intervir', 'ajuste:minstate', 'igual'), pred('medir', 'bench:disk', 'igual'), pred('medir', 'bench:single', 'igual')])];
  const all = P.choose(hs, priors(hs), ctx());
  assert.ok(all.action, 'sem filtro escolhe alguma ação');
  const linux = P.choose(hs, priors(hs), ctx({ knobs: ['ppd'], benches: ['single', 'multi', 'burst'] }));
  assert.deepEqual([linux.action.type, linux.action.target], ['medir', 'bench:single']);
  const none = P.choose(hs, priors(hs), ctx({ knobs: [], benches: [] }));
  assert.ok(none.need, 'nada que dê para fazer aqui: vira necessidade, não pausa');
});

test('ctx.types: só os tipos de ação pedidos contam (a investigação em espera procura só um teste ativo)', () => {
  const hs = [hyp('A>s', 0.5, [pred('lembrar', 'x', 'presente'), pred('medir', 'bench:b', 'desce')]),
    hyp('B>s', 0.5, [pred('lembrar', 'x', 'ausente'), pred('medir', 'bench:b', 'igual')])];
  assert.equal(P.choose(hs, priors(hs), ctx()).action.type, 'lembrar');
  const r = P.choose(hs, priors(hs), ctx({ types: ['medir', 'intervir'] }));
  assert.equal(r.action.type, 'medir');
  // Fora do profundo o teste fica bloqueado pelo ritmo; o lembrar não entra no lugar.
  assert.deepEqual(P.choose(hs, priors(hs), ctx({ types: ['medir', 'intervir'], deep: false })), { stop: 'ritmo' });
});

test('ctx.hold (bloqueio passageiro: quente, ocupado, bateria no medir): teste ativo espera com stop "espera"; lembrar segue', () => {
  const hs = dois();
  assert.deepEqual(P.choose(hs, priors(hs), ctx({ hold: 'quente' })), { stop: 'espera' });
  const both = [hyp('A>s', 0.5, [pred('lembrar', 'x', 'presente'), pred('medir', 'bench:b', 'desce')]), hyp('B>s', 0.5, [pred('lembrar', 'x', 'ausente'), pred('medir', 'bench:b', 'igual')])];
  assert.equal(P.choose(both, priors(both), ctx({ hold: 'quente' })).action.type, 'lembrar');
  // No leve o motivo continua sendo o ritmo.
  assert.deepEqual(P.choose(hs, priors(hs), ctx({ hold: 'quente', deep: false })), { stop: 'ritmo' });
});
