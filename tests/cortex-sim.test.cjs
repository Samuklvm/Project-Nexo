'use strict';
// PCs simulados (critérios do spec, seção 10): o motor inteiro (forjador → planejador → ação → crença → conclusão)
// investigando máquinas cuja causa a gente conhece, cada uma com 5 sementes de ruído.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/cortex/engine.js');
const R = require('../src/cortex/relations.js');
const { makePCs, SEEDS, memoryStore } = require('./fixtures/pcs-simulados/index.cjs');

// Ritmo profundo, pessoa liberou tudo, orçamento do dia zerado (Ruling R5).
const CTX = () => ({ permission: 'sozinho', maxRisk: 'alto', activeToday: 0, deep: true, onBattery: false, done: [] });
const MAX_STEPS = 300;

async function investigate(pc) {
  const store = memoryStore();
  const map = R.createMap(R.seedEdges());
  const correlations = R.mineCorrelations(pc.minutes(), map.edges());
  const engine = E.createEngine({ store, map, act: async (a) => pc.act(a), ctx: CTX, now: () => pc.anomaly.at, correlations: () => correlations });
  const inv = await engine.open(pc.anomaly);
  let last = null;
  let steps = 0;
  while (steps < MAX_STEPS) {
    steps++;
    last = await engine.step(inv);
    if (last !== 'continua') break;
  }
  const end = store.latest('conclusao', { inv });
  const crenca = store.latest('crenca', { inv });
  const beliefs = crenca ? crenca.data.beliefs : {};
  const ranking = Object.keys(beliefs).sort((a, b) => beliefs[b] - beliefs[a] || a.localeCompare(b));
  return {
    name: pc.name, seed: pc.seed, truth: pc.truth, last, steps, calls: pc.calls.length,
    status: end ? end.data.verdict.status : 'sem-conclusao', winner: end ? end.data.verdict.winner : null,
    rank: pc.truth ? ranking.indexOf(pc.truth) + 1 : null, top3: ranking.slice(0, 3),
    need: !!store.latest('necessidade', { inv }), needData: (store.latest('necessidade', { inv }) || {}).data || null,
    said: store.list('pensamento', { inv, limit: 1000 }).filter((p) => ['necessidade', 'conclusao'].includes(p.data.step.type)).map((p) => p.data.text),
    tests: pc.calls.filter((c) => /^(medir|intervir):/.test(c)).length
  };
}

const runs = (async () => {
  const out = [];
  for (const seed of SEEDS) for (const pc of makePCs(seed)) out.push(await investigate(pc));
  return out;
})();

const measurable = (r) => r.truth && !r.truth.startsWith('desconhecida>');
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

test('toda investigação termina com uma conclusão (nenhuma fica rodando para sempre)', async (t) => {
  const all = await runs;
  const lines = all.map((r) => `${r.name.padEnd(17)} semente ${String(r.seed).padStart(2)}  ${r.status.padEnd(14)} vencedora ${String(r.winner).padEnd(32)} posição ${r.rank ?? '-'}  passos ${r.steps}  testes ${r.tests}`);
  for (const line of lines) t.diagnostic(line);
  for (const r of all) assert.equal(r.last, 'concluida', `${r.name}/${r.seed} parou em ${r.last}`);
});

test('causa verdadeira entre as 3 primeiras hipóteses em >= 90% das máquinas com causa medível', async (t) => {
  const all = (await runs).filter(measurable);
  const hits = all.filter((r) => r.rank >= 1 && r.rank <= 3).length;
  t.diagnostic(`${hits}/${all.length} = ${pct(hits, all.length)}%`);
  assert.ok(hits / all.length >= 0.9, `${hits}/${all.length}`);
});

test('apoiada correta em >= 70% das máquinas com causa medível', async (t) => {
  const all = (await runs).filter(measurable);
  const hits = all.filter((r) => r.status === 'apoiada' && r.winner === r.truth).length;
  t.diagnostic(`${hits}/${all.length} = ${pct(hits, all.length)}%`);
  assert.ok(hits / all.length >= 0.7, `${hits}/${all.length}`);
});

test('zero apoiada na máquina só com ruído', async () => {
  const noise = (await runs).filter((r) => r.name === 'so-ruido');
  assert.equal(noise.length, SEEDS.length);
  for (const r of noise) assert.notEqual(r.status, 'apoiada', `semente ${r.seed}: ${r.winner}`);
});

test('causa invisível termina em não resolvido, com um registro de necessidade', async () => {
  const hidden = (await runs).filter((r) => r.name === 'invisivel');
  assert.equal(hidden.length, SEEDS.length);
  for (const r of hidden) {
    assert.equal(r.status, 'nao-resolvido', `semente ${r.seed}`);
    assert.ok(r.need, `semente ${r.seed}: sem necessidade`);
    // Honesto: tudo o que as causas conhecidas previam já foi olhado; o que falta está fora do que o Nexo mede.
    assert.equal(r.needData.outside, true, `semente ${r.seed}: ${JSON.stringify(r.needData)}`);
    assert.deepEqual(r.needData.missing, [], `semente ${r.seed}: faltou medir o que já foi medido`);
    assert.match(r.said.join(' '), /fora do que eu consigo medir/);
    assert.doesNotMatch(r.said.join(' '), /Faltou medir “/);
  }
});

test('mesma máquina com a mesma semente responde igual (repetível)', async () => {
  const a = await investigate(makePCs(SEEDS[0])[0]);
  const b = await investigate(makePCs(SEEDS[0])[0]);
  assert.deepEqual(a, b);
});
