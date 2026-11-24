'use strict';
// Ritmo do Cortex (src/cortex/rhythm.js): leve (reduzido) ou profundo (PC parado e sem jogo em primeiro plano).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRhythm } = require('../src/cortex/rhythm.js');

const MIN11 = 11 * 60;
const idle = (r, idleSec, gameInForeground = false) => r.check({ idleSec, gameInForeground });

test('começa leve', () => {
  assert.equal(createRhythm().state(), 'leve');
});

test('parado 11 min sem jogo: uma checagem ainda é leve, duas viram profundo', () => {
  const r = createRhythm();
  const a = idle(r, MIN11);
  assert.equal(a.state, 'leve');
  assert.equal(a.changed, false);
  assert.equal(a.reason, 'parado há 11 min');
  const b = idle(r, MIN11);
  assert.equal(b.state, 'profundo');
  assert.equal(b.changed, true);
  assert.equal(b.reason, 'parado há 11 min, sem jogo aberto');
  assert.equal(r.state(), 'profundo');
});

test('já no profundo, nova checagem parada não marca mudança', () => {
  const r = createRhythm();
  idle(r, MIN11); idle(r, MIN11);
  const c = idle(r, 30 * 60);
  assert.equal(c.state, 'profundo');
  assert.equal(c.changed, false);
  assert.ok(c.reason.length > 0);
});

test('parado 30 min com jogo em primeiro plano: sempre leve', () => {
  const r = createRhythm();
  for (let i = 0; i < 5; i++) {
    const c = idle(r, 30 * 60, true);
    assert.equal(c.state, 'leve');
    assert.equal(c.changed, false);
    assert.equal(c.reason, 'jogo em primeiro plano');
  }
});

test('gameInForeground null (não deu para saber) conta como jogo: leve', () => {
  const r = createRhythm();
  for (let i = 0; i < 5; i++) assert.equal(idle(r, 30 * 60, null).state, 'leve');
});

test('no profundo, idleSec 2 volta a leve na mesma checagem', () => {
  const r = createRhythm();
  idle(r, MIN11); idle(r, MIN11);
  const c = idle(r, 2);
  assert.equal(c.state, 'leve');
  assert.equal(c.changed, true);
  assert.equal(c.reason, 'você voltou');
  assert.equal(r.state(), 'leve');
});

test('no profundo, jogo aparecendo volta a leve', () => {
  const r = createRhythm();
  idle(r, MIN11); idle(r, MIN11);
  const c = idle(r, 30 * 60, true);
  assert.equal(c.state, 'leve');
  assert.equal(c.changed, true);
  assert.equal(c.reason, 'jogo em primeiro plano');
});

test('o contador zera se a ociosidade cair entre as checagens', () => {
  const r = createRhythm();
  idle(r, MIN11);
  const mid = idle(r, 60);
  assert.equal(mid.state, 'leve');
  assert.ok(mid.reason.length > 0);
  assert.equal(idle(r, MIN11).state, 'leve'); // recomeçou do 1
  assert.equal(idle(r, MIN11).state, 'profundo');
});

test('jogo no meio da contagem também zera o contador', () => {
  const r = createRhythm();
  idle(r, MIN11);
  idle(r, MIN11, true);
  assert.equal(idle(r, MIN11).state, 'leve');
  assert.equal(idle(r, MIN11).state, 'profundo');
});

test('reason é texto em português não vazio em toda checagem, minutos arredondados para baixo', () => {
  const r = createRhythm();
  const x = idle(r, 3 * 60 + 59, false); // abaixo de enterIdleSec, ainda sem contar
  assert.equal(typeof x.reason, 'string');
  assert.ok(x.reason.length > 0);
  const r2 = createRhythm({ enterIdleSec: 60, confirmChecks: 3 });
  assert.equal(idle(r2, 3 * 60 + 59).reason, 'parado há 3 min');
  assert.equal(idle(r2, 3 * 60 + 59).reason, 'parado há 3 min');
  assert.equal(idle(r2, 3 * 60 + 59).reason, 'parado há 3 min, sem jogo aberto');
});

test('exitIdleSec só vale no profundo: em leve, idleSec baixo só zera o contador', () => {
  const r = createRhythm();
  const c = idle(r, 2);
  assert.equal(c.state, 'leve');
  assert.equal(c.changed, false);
  assert.ok(c.reason.length > 0);
});

test('no profundo, ociosidade entre exitIdleSec e enterIdleSec mantém profundo', () => {
  const r = createRhythm();
  idle(r, MIN11); idle(r, MIN11);
  const c = idle(r, 60);
  assert.equal(c.state, 'profundo');
  assert.equal(c.changed, false);
});

test('idleSec inválido (NaN, negativo, undefined, texto) conta como pessoa presente: leve e zera o contador', () => {
  for (const bad of [NaN, -5, undefined, '900', null, Infinity * -1]) {
    const r = createRhythm();
    idle(r, MIN11);
    const c = r.check({ idleSec: bad, gameInForeground: false });
    assert.equal(c.state, 'leve');
    assert.ok(c.reason.length > 0);
    assert.equal(idle(r, MIN11).state, 'leve', `contador deveria zerar com ${String(bad)}`);
  }
  const r = createRhythm();
  idle(r, MIN11); idle(r, MIN11);
  const c = r.check({ idleSec: NaN, gameInForeground: false });
  assert.equal(c.state, 'leve');
  assert.equal(c.changed, true);
});

test('check sem argumento não quebra e fica leve', () => {
  const r = createRhythm();
  assert.equal(r.check().state, 'leve');
});

test('opções: enterIdleSec e confirmChecks personalizados', () => {
  const r = createRhythm({ enterIdleSec: 120, confirmChecks: 1 });
  assert.equal(idle(r, 119).state, 'leve');
  assert.equal(idle(r, 120).state, 'profundo');
  const r2 = createRhythm({ exitIdleSec: 30 });
  idle(r2, MIN11); idle(r2, MIN11);
  assert.equal(idle(r2, 20).state, 'leve');
});

test('no profundo, gameInForeground null (não deu para ver) volta a leve na mesma checagem', () => {
  const r = createRhythm();
  idle(r, MIN11); idle(r, MIN11);
  const c = idle(r, MIN11, null);
  assert.equal(c.state, 'leve');
  assert.equal(c.changed, true);
  assert.equal(c.reason, 'não deu para ver se tem jogo aberto');
  assert.equal(r.state(), 'leve');
});
