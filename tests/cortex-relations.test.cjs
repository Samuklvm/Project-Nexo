'use strict';
// Mapa de relações do Cortex (src/cortex/relations.js): semente, escada de estados e correlações novas.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/cortex/relations.js');
const { SPACE } = require('../src/lab-space.js');

const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const MIN = 60000;

/** Gerador pseudoaleatório com seed fixa (mulberry32): os testes dão sempre o mesmo resultado. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const row = (i, extra = {}) => ({ t: T0 + i * MIN, cpu: 10, mem: 40, disk: 5, gpu: 10, temp: 50, cpuTemp: 60, clock: 4000, clockRatio: 1, culprit: null, ...extra });

test('semente: tem as arestas gerais e uma por ajuste do laboratório', () => {
  const edges = R.seedEdges();
  const has = (from, to) => edges.find((e) => e.from === from && e.to === to);
  for (const [from, to] of [['temp_cpu', 'clock_queda'], ['programa_pesado', 'cpu'], ['mem', 'page_faults'], ['page_faults', 'travadas'],
    ['cpu', 'travadas'], ['clock_queda', 'cpu'], ['gpu', 'quadros_ruins'], ['disk', 'travadas']]) {
    assert.ok(has(from, to), `falta ${from}→${to}`);
  }
  const epp = has('ajuste:perfepp', 'bench:single');
  assert.ok(epp);
  assert.equal(epp.type, 'afeta');
  assert.equal(epp.origem, 'semente');
  for (const knob of SPACE) for (const b of knob.affects) assert.ok(has(`ajuste:${knob.id}`, `bench:${b}`), `falta ajuste:${knob.id}→bench:${b}`);
  assert.equal(new Set(edges.map((e) => e.id)).size, edges.length, 'ids únicos');
  for (const e of edges) {
    assert.ok(e.weight >= 0 && e.weight <= 1);
    assert.ok(['causa', 'explica', 'afeta'].includes(e.type));
    assert.ok(R.SIGNALS[e.from] && R.SIGNALS[e.to], `sinal sem rótulo em ${e.id}`);
  }
});

test('SIGNALS: rótulos curtos em português para os sinais mínimos, benches e ajustes', () => {
  for (const id of ['cpu', 'mem', 'disk', 'gpu', 'temp_cpu', 'temp', 'clock_queda', 'page_faults', 'travadas', 'quadros_ruins', 'programa_pesado', 'rotina', 'bench:single', 'ajuste:perfepp']) {
    assert.equal(typeof R.SIGNALS[id].label, 'string', id);
    assert.ok(R.SIGNALS[id].label.length > 0 && R.SIGNALS[id].label.length <= 60, id);
  }
  assert.deepEqual(R.STATES, ['semente', 'observada', 'correlacionada', 'suspeita', 'apoiada', 'derrubada']);
});

test('causesOf devolve as arestas cuja origem é a causa, ordenadas por peso x histórico', () => {
  const map = R.createMap(R.seedEdges(), []);
  const causes = map.causesOf('clock_queda');
  assert.ok(causes.some((e) => e.from === 'temp_cpu'));
  assert.ok(causes.every((e) => e.to === 'clock_queda'));
  const travadas = map.causesOf('travadas');
  assert.ok(travadas.length >= 3);
  // histórico desta máquina reordena: mem→page_faults→travadas vs. cpu→travadas
  const base = map.causesOf('travadas').map((e) => e.from);
  const cpuEdge = travadas.find((e) => e.from === 'cpu');
  const pf = travadas.find((e) => e.from === 'page_faults');
  const first = base[0];
  for (let i = 0; i < 20; i++) map.apply({ edgeId: first === 'cpu' ? pf.id : cpuEdge.id, kind: 'visto', at: T0 + i });
  assert.notEqual(map.causesOf('travadas')[0].from, first, 'histórico mudou a ordem');
  assert.deepEqual(map.causesOf('sinal-que-nao-existe'), []);
});

test('escada: visto, correlação e suspeita sobem, mas só experimento chega a apoiada', () => {
  const map = R.createMap(R.seedEdges(), []);
  const id = 'temp_cpu>clock_queda';
  assert.equal(map.state(id), 'semente');
  map.apply({ edgeId: id, kind: 'visto', at: T0 });
  assert.equal(map.state(id), 'observada');
  map.apply({ edgeId: id, kind: 'correlacao', at: T0 + 1 });
  assert.equal(map.state(id), 'correlacionada');
  map.apply({ edgeId: id, kind: 'suspeita', at: T0 + 2 });
  assert.equal(map.state(id), 'suspeita');
  for (let i = 0; i < 50; i++) map.apply({ edgeId: id, kind: i % 2 ? 'correlacao' : 'visto', at: T0 + 10 + i });
  assert.equal(map.state(id), 'suspeita', 'repetir correlação não promove');
  map.apply({ edgeId: id, kind: 'experimento-a-favor', at: T0 + 100 });
  assert.equal(map.state(id), 'apoiada');
});

test('experimento contra derruba, e o experimento mais recente decide', () => {
  const id = 'cpu>travadas';
  const map = R.createMap(R.seedEdges(), [{ edgeId: id, kind: 'experimento-a-favor', at: T0 }]);
  assert.equal(map.state(id), 'apoiada');
  map.apply({ edgeId: id, kind: 'experimento-contra', at: T0 + 5 });
  assert.equal(map.state(id), 'derrubada');
  map.apply({ edgeId: id, kind: 'visto', at: T0 + 6 });
  assert.equal(map.state(id), 'derrubada', 'ver de novo não ressuscita');
  assert.ok(!map.causesOf('travadas').some((e) => e.id === id), 'aresta derrubada sai das causas');
  map.apply({ edgeId: id, kind: 'experimento-a-favor', at: T0 + 9 });
  assert.equal(map.state(id), 'apoiada');
});

test('histórico inicial é reaplicado e evento de aresta desconhecida é ignorado', () => {
  const id = 'gpu>quadros_ruins';
  const map = R.createMap(R.seedEdges(), [{ edgeId: id, kind: 'suspeita', at: T0 }, { edgeId: 'nada>nada', kind: 'visto', at: T0 }]);
  assert.equal(map.state(id), 'suspeita');
  assert.equal(map.state('nada>nada'), null);
  assert.equal(map.edges().length, R.seedEdges().length);
});

test('mineCorrelations acha gpu→temp com atraso 2 num par sintético', () => {
  const rand = rng(7);
  const n = 200;
  const gpu = Array.from({ length: n }, () => rand() * 100);
  const rows = gpu.map((g, i) => row(i, { gpu: g, temp: (i >= 2 ? 0.9 * gpu[i - 2] : 50) + (rand() - 0.5) * 30 }));
  const found = R.mineCorrelations(rows, []);
  const e = found.find((x) => x.from === 'gpu' && x.to === 'temp');
  assert.ok(e, 'achou gpu→temp');
  assert.equal(e.lag, 2);
  assert.equal(e.origem, 'correlacao');
  assert.ok(e.weight >= 0.85 && e.weight <= 1, `r=${e.weight}`);
  assert.equal(found.length, 1, 'só esse par');
});

test('mineCorrelations não devolve nada para ruídos independentes nem para poucos minutos', () => {
  const rand = rng(12345);
  const rows = Array.from({ length: 300 }, (_, i) => row(i, { cpu: rand() * 100, mem: rand() * 100, disk: rand() * 100, gpu: rand() * 100, temp: 40 + rand() * 30, cpuTemp: 50 + rand() * 30, clockRatio: 0.6 + rand() * 0.4 }));
  assert.deepEqual(R.mineCorrelations(rows, []), []);
  const few = Array.from({ length: 30 }, (_, i) => row(i, { gpu: i, temp: i }));
  assert.deepEqual(R.mineCorrelations(few, []), [], 'abaixo de minN');
});

test('mineCorrelations ignora par que já está em known e respeita minR/minN', () => {
  const rand = rng(99);
  const n = 150;
  const gpu = Array.from({ length: n }, () => rand() * 100);
  const rows = gpu.map((g, i) => row(i, { gpu: g, temp: (i >= 2 ? 0.9 * gpu[i - 2] : 50) + (rand() - 0.5) * 30 }));
  const known = [{ id: 'gpu>temp', from: 'gpu', to: 'temp', type: 'causa', weight: 0.5, origem: 'semente' }];
  assert.deepEqual(R.mineCorrelations(rows, known), []);
  assert.deepEqual(R.mineCorrelations(rows, [], { minR: 0.99 }), []);
  assert.equal(R.mineCorrelations(rows, [], { minN: 500 }).length, 0);
});

test('mineCorrelations mapeia colunas: cpuTemp→temp_cpu e queda de clock (1 - clockRatio)', () => {
  const rand = rng(3);
  const n = 200;
  const temps = Array.from({ length: n }, () => 50 + rand() * 40);
  const rows = temps.map((t, i) => row(i, { cpuTemp: t, clockRatio: 1 - (i >= 1 ? (temps[i - 1] - 50) / 100 : 0) + (rand() - 0.5) * 0.02 }));
  const e = R.mineCorrelations(rows, []).find((x) => x.to === 'clock_queda');
  assert.ok(e);
  assert.equal(e.from, 'temp_cpu');
  assert.equal(e.lag, 1);
});
