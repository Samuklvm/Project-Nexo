'use strict';
// Narrador do Cortex (src/cortex/narrate.js): cada passo do raciocínio vira uma frase simples em português.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/cortex/narrate.js');
const { SIGNALS } = require('../src/cortex/relations.js');

const BANIDAS = /provavelmente|talvez seja|deve ser|com certeza/i;
const hyp = (cause, symptom = 'clock_queda', source = 'mapa') => ({ key: `${cause}>${symptom}`, cause, symptom, via: [], prior: 0.4, source, predictions: [] });
const pred = (action, target, expect) => ({ action, target, expect });
const out = (action, target, observed, significant = true) => ({ action, target, observed, significant });

const PASSOS = () => [
  { type: 'notei', signal: 'temp_cpu', value: 92.5, symptom: 'clock_queda' },
  { type: 'notei', signal: 'cpu', value: 88 },
  { type: 'suspeito', hypothesis: hyp('temp_cpu'), belief: 0.62 },
  { type: 'suspeito', hypothesis: hyp('rotina', 'clock_queda', 'rotina'), belief: 0.2 },
  { type: 'suspeito', hypothesis: hyp('desconhecida', 'clock_queda', 'desconhecida'), belief: 0.1 },
  ...['lembrar', 'esperar', 'medir', 'intervir'].flatMap((a) => ['sobe', 'desce', 'igual', 'presente', 'ausente', 'antes', 'depois']
    .map((e) => ({ type: 'plano', prediction: pred(a, a === 'medir' ? 'bench:single' : a === 'intervir' ? 'ajuste:xmp' : 'temp_cpu', e) }))),
  { type: 'resultado', outcome: out('medir', 'bench:single', 'desce', true), prediction: pred('medir', 'bench:single', 'desce') },
  { type: 'resultado', outcome: out('lembrar', 'temp_cpu', 'antes', false), prediction: pred('lembrar', 'temp_cpu', 'antes') },
  { type: 'resultado', outcome: out('lembrar', 'temp_cpu', 'depois', true), prediction: pred('lembrar', 'temp_cpu', 'antes') },
  { type: 'resultado', outcome: out('esperar', 'clock_queda', 'igual', true), prediction: pred('esperar', 'clock_queda', 'sobe') },
  { type: 'resultado', outcome: out('medir', 'bench:single', 'interrompido', false) },
  { type: 'interrompido', target: 'bench:single' },
  { type: 'ritmo', state: 'leve', reason: 'você voltou' },
  { type: 'ritmo', state: 'profundo', reason: 'o computador ficou parado' },
  { type: 'conclusao', verdict: { status: 'apoiada', winner: 'temp_cpu>clock_queda', refuted: ['cpu>clock_queda'] } },
  { type: 'conclusao', verdict: { status: 'correlacionada', winner: 'temp_cpu>clock_queda', refuted: [] } },
  { type: 'conclusao', verdict: { status: 'aberta', winner: null, refuted: [] } },
  { type: 'conclusao', verdict: { status: 'nao-resolvido', winner: null, refuted: ['cpu>clock_queda', 'mem>clock_queda'] }, missing: ['bench:disk'] },
  { type: 'necessidade', signal: 'temp_cpu', reason: 'sem ela não consigo separar as causas' },
  { type: 'pedido', text: 'deixe o computador parado por 2 minutos', minutes: 2 }
];

test('cada type produz uma frase não vazia que cita o sinal pelo label', () => {
  const label = (id) => SIGNALS[id].label;
  const casos = [
    [{ type: 'notei', signal: 'temp_cpu', value: 92.5 }, 'temp_cpu'],
    [{ type: 'suspeito', hypothesis: hyp('temp_cpu'), belief: 0.6 }, 'temp_cpu'],
    [{ type: 'plano', prediction: pred('medir', 'bench:single', 'desce') }, 'bench:single'],
    [{ type: 'resultado', outcome: out('lembrar', 'temp_cpu', 'presente'), prediction: pred('lembrar', 'temp_cpu', 'presente') }, 'temp_cpu'],
    [{ type: 'conclusao', verdict: { status: 'apoiada', winner: 'temp_cpu>clock_queda', refuted: [] } }, 'temp_cpu'],
    [{ type: 'necessidade', signal: 'temp_cpu' }, 'temp_cpu'],
    [{ type: 'pedido', signal: 'temp_cpu', text: 'abra o jogo' }, 'temp_cpu']
  ];
  for (const [step, id] of casos) {
    const s = N.say(step);
    assert.equal(typeof s, 'string');
    assert.ok(s.length > 0, step.type);
    assert.ok(s.includes(label(id)), `${step.type}: "${s}" deveria citar "${label(id)}"`);
  }
});

test('nenhuma saída usa palavras de falsa certeza ou de chute', () => {
  for (const step of PASSOS()) {
    const s = N.say(step);
    assert.ok(s.length > 0, JSON.stringify(step));
    assert.doesNotMatch(s, BANIDAS, s);
  }
});

test('conclusao nao-resolvido diz o que foi descartado e o que faltou medir', () => {
  const s = N.say({ type: 'conclusao', verdict: { status: 'nao-resolvido', winner: null, refuted: ['cpu>clock_queda', 'mem>clock_queda'] }, missing: ['bench:disk', 'page_faults'] });
  assert.ok(s.includes(SIGNALS.cpu.label));
  assert.ok(s.includes(SIGNALS.mem.label));
  assert.ok(s.includes(SIGNALS['bench:disk'].label));
  assert.ok(s.includes(SIGNALS.page_faults.label));
  assert.match(s, /descart/i);
  assert.match(s, /faltou|falta/i);
});

test('números usam vírgula decimal', () => {
  const s = N.say({ type: 'notei', signal: 'temp_cpu', value: 92.5 });
  assert.ok(s.includes('92,5'));
  assert.ok(!s.includes('92.5'));
});

test('a hipótese desconhecida vira "algo que eu ainda não consigo medir"', () => {
  const s = N.say({ type: 'suspeito', hypothesis: hyp('desconhecida', 'clock_queda', 'desconhecida'), belief: 0.1 });
  assert.match(s, /algo que eu ainda não consigo medir/);
});

test('ritmo e interrompido', () => {
  assert.equal(N.say({ type: 'ritmo', state: 'leve', reason: 'você voltou' }), 'Voltei ao ritmo leve: você voltou.');
  assert.match(N.say({ type: 'ritmo', state: 'profundo', reason: 'o PC ficou parado' }), /ritmo profundo/);
  assert.match(N.say({ type: 'interrompido', target: 'bench:single' }), /não conta|refaço|refazer/i);
  assert.match(N.say({ type: 'resultado', outcome: out('medir', 'bench:single', 'interrompido', false) }), /não conta/i);
});

test('antes/depois são narrados com naturalidade', () => {
  assert.match(N.say({ type: 'plano', prediction: pred('lembrar', 'temp_cpu', 'antes') }), /antes/);
  const s = N.say({ type: 'resultado', outcome: out('lembrar', 'temp_cpu', 'depois'), prediction: pred('lembrar', 'temp_cpu', 'antes') });
  assert.match(s, /depois/);
});

test('ids desconhecidos e passos malformados não quebram', () => {
  const s = N.say({ type: 'notei', signal: 'sinal_novo', value: 3.5 });
  assert.ok(s.includes('sinal_novo'));
  assert.ok(s.includes('3,5'));
  assert.equal(typeof N.say({ type: 'inexistente' }), 'string');
  assert.equal(typeof N.say(null), 'string');
  assert.equal(typeof N.say({ type: 'suspeito' }), 'string');
});

test('pedido fica bem formado com ou sem pontuação no texto', () => {
  for (const text of ['abra o jogo', 'abra o jogo.', 'abra o jogo!']) {
    const s = N.say({ type: 'pedido', text, signal: 'temp_cpu', minutes: 2 });
    assert.doesNotMatch(s, /\.\.|[.!?] para|[.!?] \(/, s);
    assert.ok(s.includes('abra o jogo'));
    assert.ok(s.includes(SIGNALS.temp_cpu.label));
  }
  assert.doesNotMatch(N.say({ type: 'pedido', text: 'abra o jogo.' }), /\.\./);
});

test('resultado com observed fora do vocabulário não afirma nada', () => {
  const s = N.say({ type: 'resultado', outcome: out('medir', 'bench:single', 'xyz', true), prediction: pred('medir', 'bench:single', 'desce') });
  assert.match(s, /não consegui classificar/i);
  assert.doesNotMatch(s, /muda de um jeito|bateu com|cai|sobe/i);
  assert.ok(s.includes(SIGNALS['bench:single'].label));
  assert.doesNotMatch(N.say({ type: 'resultado', outcome: out('medir', 'bench:single', undefined, true) }), /bateu/i);
});
