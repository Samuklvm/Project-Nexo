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

test('expectedGain: hipótese sem previsão fica espalhada e separa menos', () => {
  const hs = [hyp('A>s', 0.5, [pred('medir', 'bench:b', 'desce')]), hyp('B>s', 0.5, [pred('medir', 'bench:b', 'igual')]), hyp('C>s', 0, [])];
  const comC = [{ ...hs[0], prior: 0.4 }, { ...hs[1], prior: 0.4 }, { ...hs[2], prior: 0.2 }];
  const g = P.expectedGain({ type: 'medir', target: 'bench:b' }, comC, priors(comC));
  assert.ok(g > 0 && g < 1.5);
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
  assert.ok(r.need);
});

test('onBattery nunca devolve intervir', () => {
  const hs = [hyp('A>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'sobe')]), hyp('B>s', 0.5, [pred('intervir', 'ajuste:perfepp', 'igual')])];
  assert.ok(!P.choose(hs, priors(hs), ctx({ onBattery: true })).action);
});

test('activeToday = 3 não devolve medir nem intervir', () => {
  const hs = dois();
  const r = P.choose(hs, priors(hs), ctx({ activeToday: 3 }));
  assert.ok(!r.action || !['medir', 'intervir'].includes(r.action.type));
});

test('nada que separe devolve need com as hipóteses empatadas', () => {
  const hs = [hyp('A>s', 0.45, [pred('lembrar', 'x', 'presente')]), hyp('B>s', 0.45, [pred('lembrar', 'x', 'presente')]), hyp('C>s', 0.1, [])];
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
