'use strict';
// Crença e conclusão do Cortex (src/cortex/beliefs.js): atualização bayesiana das hipóteses e regras de veredito.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/cortex/beliefs.js');

const pred = (action, target, expect) => ({ action, target, expect });
const hyp = (key, prior, predictions, source = 'mapa') => ({ key, cause: key.split('>')[0], symptom: 'clock_queda', via: [], prior, source, predictions });
const out = (action, target, observed, significant = true, extra = {}) => ({ action, target, observed, significant, ...extra });

// A diz "x presente, o teste cai, o ajuste mexe"; B diz o contrário; desconhecida não prevê nada.
const hyps = () => [
  hyp('A>clock_queda', 0.5, [pred('lembrar', 'x', 'presente'), pred('medir', 'bench:b', 'desce'), pred('intervir', 'ajuste:k', 'sobe')]),
  hyp('B>clock_queda', 0.4, [pred('lembrar', 'x', 'ausente'), pred('medir', 'bench:b', 'igual')]),
  hyp('desconhecida>clock_queda', 0.1, [], 'desconhecida'),
];
const priors = (hs) => Object.fromEntries(hs.map((h) => [h.key, h.prior]));
const sum = (b) => Object.values(b).reduce((s, v) => s + v, 0);

test('previsão confirmada com significant sobe a crença e renormaliza', () => {
  const hs = hyps();
  const b = B.update(hs, priors(hs), out('lembrar', 'x', 'presente'));
  assert.ok(b['A>clock_queda'] > 0.5 + 0.2);
  assert.ok(b['B>clock_queda'] < 0.4 / 2);
  assert.ok(Math.abs(sum(b) - 1) < 1e-9);
});

test('sem significant a crença sobe pouco (menos de 0.1 de diferença)', () => {
  const hs = hyps();
  const b = B.update(hs, priors(hs), out('lembrar', 'x', 'presente', false));
  const delta = b['A>clock_queda'] - 0.5;
  assert.ok(delta > 0 && delta < 0.1, `delta=${delta}`);
});

test('hipótese sem previsão para o alvo fica neutra (0.5) e desconhecida não se mexe por si', () => {
  const hs = hyps();
  const b = B.update(hs, priors(hs), out('medir', 'bench:outro', 'sobe'));
  for (const h of hs) assert.ok(Math.abs(b[h.key] - h.prior) < 1e-9, h.key);
});

test('previsão errada significativa derruba a crença', () => {
  const hs = hyps();
  const b = B.update(hs, priors(hs), out('medir', 'bench:b', 'igual'));
  assert.ok(b['A>clock_queda'] < 0.2);
  assert.ok(b['B>clock_queda'] > 0.7);
});

test('bate por qualquer previsão do alvo: lembrar presente/antes no mesmo sinal', () => {
  const hs = [hyp('A>s', 0.5, [pred('lembrar', 'x', 'presente'), pred('lembrar', 'x', 'antes')]), hyp('R>s', 0.5, [pred('lembrar', 'x', 'ausente')], 'rotina')];
  const bAntes = B.update(hs, priors(hs), out('lembrar', 'x', 'antes'));
  assert.ok(bAntes['A>s'] > 0.8);
  const bAusente = B.update(hs, priors(hs), out('lembrar', 'x', 'ausente'));
  assert.ok(bAusente['A>s'] < 0.2 && bAusente['R>s'] > 0.8);
  // 'depois' é um valor como outro: erra para quem previu presente/antes e para quem previu ausente (ficam empatadas).
  const bDepois = B.update(hs, priors(hs), out('lembrar', 'x', 'depois'));
  assert.ok(Math.abs(bDepois['A>s'] - 0.5) < 1e-9 && Math.abs(bDepois['R>s'] - 0.5) < 1e-9);
});

test('duas confirmações por lembrar levam no máximo a correlacionada', () => {
  const hs = hyps();
  let b = priors(hs);
  const o = out('lembrar', 'x', 'presente');
  b = B.update(hs, b, o);
  b = B.update(hs, b, o);
  assert.ok(b['A>clock_queda'] >= 0.8);
  const v = B.verdict(hs, b, [o, o]);
  assert.equal(v.status, 'correlacionada');
  assert.equal(v.winner, 'A>clock_queda');
});

test('uma intervir significativa a favor leva a apoiada', () => {
  const hs = hyps();
  const os = [out('lembrar', 'x', 'presente'), out('lembrar', 'x', 'presente'), out('intervir', 'ajuste:k', 'sobe', true, { evidenceId: 7 })];
  let b = priors(hs);
  for (const o of os) b = B.update(hs, b, o);
  const v = B.verdict(hs, b, os);
  assert.equal(v.status, 'apoiada');
  assert.equal(v.winner, 'A>clock_queda');
});

test('medir significativo a favor também é prova experimental; medir sem significant não é', () => {
  const hs = hyps();
  const base = [out('lembrar', 'x', 'presente'), out('lembrar', 'x', 'presente')];
  const forte = [...base, out('medir', 'bench:b', 'desce')];
  const fraca = [...base, out('medir', 'bench:b', 'desce', false)];
  const run = (os) => { let b = priors(hs); for (const o of os) b = B.update(hs, b, o); return B.verdict(hs, b, os); };
  assert.equal(run(forte).status, 'apoiada');
  assert.equal(run(fraca).status, 'correlacionada');
});

test('previsão errada significativa derruba e marca como refutada', () => {
  const hs = hyps();
  const os = [out('medir', 'bench:b', 'igual'), out('lembrar', 'x', 'ausente')];
  let b = priors(hs);
  for (const o of os) b = B.update(hs, b, o);
  const v = B.verdict(hs, b, os);
  assert.ok(b['A>clock_queda'] < 0.05);
  assert.deepEqual(v.refuted, ['A>clock_queda']);
  assert.equal(v.winner, 'B>clock_queda');
});

test('crença baixa sem previsão errada significativa não é refutada', () => {
  const hs = hyps();
  const b = { 'A>clock_queda': 0.02, 'B>clock_queda': 0.9, 'desconhecida>clock_queda': 0.08 };
  const v = B.verdict(hs, b, [out('lembrar', 'x', 'ausente', false)]);
  assert.deepEqual(v.refuted, []);
});

test('abaixo de 0.8 fica aberta e sem vencedor', () => {
  const hs = hyps();
  const v = B.verdict(hs, priors(hs), []);
  assert.equal(v.status, 'aberta');
  assert.equal(v.winner, null);
  assert.deepEqual(v.refuted, []);
});

test('desconhecida nunca vira apoiada, mesmo com crença alta', () => {
  const hs = hyps();
  const os = [out('medir', 'bench:b', 'sobe'), out('intervir', 'ajuste:k', 'igual'), out('medir', 'bench:b', 'sobe'), out('medir', 'bench:b', 'sobe')];
  let b = priors(hs);
  for (const o of os) b = B.update(hs, b, o);
  assert.ok(b['desconhecida>clock_queda'] > 0.8, 'as outras caíram');
  const v = B.verdict(hs, b, os);
  assert.notEqual(v.status, 'apoiada');
  assert.notEqual(v.winner, 'desconhecida>clock_queda');
});

test('outcome interrompido é ignorado por update e por verdict', () => {
  const hs = hyps();
  const o = out('intervir', 'ajuste:k', 'interrompido');
  const b = B.update(hs, priors(hs), o);
  assert.deepEqual(b, priors(hs));
  const alto = { 'A>clock_queda': 0.9, 'B>clock_queda': 0.05, 'desconhecida>clock_queda': 0.05 };
  const v = B.verdict(hs, alto, [out('intervir', 'ajuste:k', 'sobe', true), o]);
  assert.equal(v.status, 'apoiada');
  const sem = B.verdict(hs, alto, [o, out('medir', 'bench:b', 'interrompido')]);
  assert.equal(sem.status, 'correlacionada');
  assert.deepEqual(sem.refuted, []);
});

test('update não muta a entrada e completa chaves ausentes com o prior', () => {
  const hs = hyps();
  const beliefs = { 'A>clock_queda': 0.5 };
  const b = B.update(hs, beliefs, out('lembrar', 'x', 'presente'));
  assert.deepEqual(beliefs, { 'A>clock_queda': 0.5 });
  assert.equal(Object.keys(b).length, 3);
  assert.ok(Math.abs(sum(b) - 1) < 1e-9);
});

// Muitas alternativas: a vencedora também vale com crença >= FLOOR e >= RELATIVE vezes a segunda (desconhecida conta).
const many = () => [
  hyp('A>clock_queda', 0.2, [pred('lembrar', 'x', 'presente'), pred('medir', 'bench:b', 'desce')]),
  hyp('B>clock_queda', 0.2, [pred('lembrar', 'x', 'ausente')]),
  hyp('C>clock_queda', 0.2, [pred('lembrar', 'y', 'presente')]),
  hyp('D>clock_queda', 0.2, [pred('lembrar', 'z', 'presente')]),
  hyp('desconhecida>clock_queda', 0.2, [], 'desconhecida'),
];
const exp = [out('medir', 'bench:b', 'desce', true)];

test('RELATIVE e FLOOR exportados com os valores do controlador', () => {
  assert.equal(B.RELATIVE, 3);
  assert.equal(B.FLOOR, 0.5);
  assert.equal(B.SUPPORT, 0.8);
});

test('vencedora relativa: >= 0.5 e >= 3x a segunda leva a apoiada (com teste) ou correlacionada (sem teste)', () => {
  const b = { 'A>clock_queda': 0.55, 'B>clock_queda': 0.15, 'C>clock_queda': 0.1, 'D>clock_queda': 0.05, 'desconhecida>clock_queda': 0.15 };
  assert.deepEqual(B.verdict(many(), b, exp), { status: 'apoiada', winner: 'A>clock_queda', refuted: [] });
  const sem = B.verdict(many(), b, [out('lembrar', 'x', 'presente', true)]);
  assert.equal(sem.status, 'correlacionada');
  assert.equal(sem.winner, 'A>clock_queda');
});

test('vencedora relativa exige o piso e a folga: 0.45 não basta; 0.6 contra desconhecida 0.25 não basta', () => {
  const piso = { 'A>clock_queda': 0.45, 'B>clock_queda': 0.14, 'C>clock_queda': 0.14, 'D>clock_queda': 0.14, 'desconhecida>clock_queda': 0.13 };
  assert.equal(B.verdict(many(), piso, exp).status, 'aberta');
  const folga = { 'A>clock_queda': 0.6, 'B>clock_queda': 0.05, 'C>clock_queda': 0.05, 'D>clock_queda': 0.05, 'desconhecida>clock_queda': 0.25 };
  const v = B.verdict(many(), folga, exp);
  assert.equal(v.status, 'aberta', 'a segunda conta mesmo sendo a desconhecida');
  assert.equal(v.winner, null);
});
