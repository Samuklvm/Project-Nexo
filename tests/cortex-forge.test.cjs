'use strict';
// Forjador de hipóteses do Cortex (src/cortex/forge.js): causas do mapa, correlações, rotina e desconhecida.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/cortex/relations.js');
const F = require('../src/cortex/forge.js');

const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const anomaly = (symptom, extra = {}) => ({ kind: 'lentidao', symptom, at: T0, window: { from: T0 - 60000, to: T0 }, data: {}, ...extra });
const edge = (from, to, weight = 0.6, origem = 'semente') => ({ id: `${from}>${to}`, from, to, type: 'causa', weight, origem });
const sum = (hs) => hs.reduce((s, h) => s + h.prior, 0);
const by = (hs, source) => hs.filter((h) => h.source === source);

test('lentidão de clock_queda: temp_cpu do mapa, rotina e desconhecida; priors somam 1', () => {
  const hs = F.forge(anomaly('clock_queda'), R.createMap(R.seedEdges()));
  assert.ok(hs.length >= 3);
  const t = hs.find((h) => h.cause === 'temp_cpu');
  assert.equal(t.source, 'mapa');
  assert.equal(t.key, 'temp_cpu>clock_queda');
  assert.deepEqual(t.via, ['temp_cpu>clock_queda']);
  assert.equal(by(hs, 'rotina').length, 1);
  const d = by(hs, 'desconhecida')[0];
  assert.equal(d.prior, 0.1);
  assert.deepEqual(d.predictions, []);
  assert.ok(Math.abs(sum(hs) - 1) < 1e-9);
  assert.equal(new Set(hs.map((h) => h.key)).size, hs.length, 'keys únicas');
});

test('toda hipótese exceto desconhecida tem previsão; rotina e causa do mapa discordam no mesmo alvo', () => {
  const hs = F.forge(anomaly('travadas'), R.createMap(R.seedEdges()));
  for (const h of hs) if (h.source !== 'desconhecida') assert.ok(h.predictions.length >= 1, h.key);
  const rot = by(hs, 'rotina')[0];
  const cpu = hs.find((h) => h.cause === 'cpu');
  const find = (h, target) => h.predictions.find((p) => p.action === 'lembrar' && p.target === target);
  assert.equal(find(cpu, 'cpu').expect, 'presente');
  assert.equal(find(rot, 'cpu').expect, 'ausente');
  assert.equal(rot.predictions.find((p) => p.action === 'esperar').expect, 'igual');
});

test('causas a 2 saltos entram, com o caminho completo', () => {
  const map = R.createMap([edge('a', 'b'), edge('b', 'sym')]);
  const hs = F.forge(anomaly('sym'), map);
  const a = hs.find((h) => h.cause === 'a');
  assert.deepEqual(a.via, ['a>b', 'b>sym']);
  assert.equal(a.source, 'mapa');
  assert.ok(hs.find((h) => h.cause === 'b').prior > a.prior, 'perto vale mais que longe');
  // 3 saltos ficam de fora
  const far = F.forge(anomaly('sym'), R.createMap([edge('z', 'a'), edge('a', 'b'), edge('b', 'sym')]));
  assert.equal(far.find((h) => h.cause === 'z'), undefined);
});

test('sem causa no mapa: com 1 correlação injetada dá 3; sem correlação completa com vizinho (≥ 3)', () => {
  const map = R.createMap(R.seedEdges());
  const corr = { id: 'gpu>temp_cpu', from: 'gpu', to: 'temp_cpu', type: 'afeta', weight: 0.8, origem: 'correlacao', lag: 2, n: 100 };
  const withCorr = F.forge(anomaly('temp_cpu'), map, { correlations: [corr, { ...corr, id: 'x>y', from: 'x', to: 'y' }] });
  assert.equal(withCorr.length, 3);
  assert.equal(by(withCorr, 'correlacao')[0].cause, 'gpu');
  assert.ok(Math.abs(sum(withCorr) - 1) < 1e-9);

  const none = F.forge(anomaly('temp_cpu'), map);
  assert.ok(none.length >= 3);
  const near = none.find((h) => h.source === 'mapa');
  // Vizinho mais forte: temp_cpu toca bench:multi, onde o programa pesado também pesa (0.6, acima de clock_queda>cpu 0.5).
  assert.equal(near.cause, 'programa_pesado');
  assert.deepEqual(near.via, ['programa_pesado>bench:multi']);
  assert.ok(near.prior < by(none, 'rotina')[0].prior, 'prior baixo');
  assert.ok(Math.abs(sum(none) - 1) < 1e-9);
});

test('mapa vazio: rotina + desconhecida + programa_pesado genérico', () => {
  const hs = F.forge(anomaly('travadas'), R.createMap([]));
  assert.equal(hs.length, 3);
  assert.deepEqual(hs.map((h) => h.source).sort(), ['desconhecida', 'mapa', 'rotina']);
  assert.equal(by(hs, 'mapa')[0].cause, 'programa_pesado');
  assert.ok(Math.abs(sum(hs) - 1) < 1e-9);
});

test('aresta derrubada some; experimento a favor sobe o prior; caminho com ajuste/bench gera medir/intervir', () => {
  const map = R.createMap(R.seedEdges(), [{ edgeId: 'temp_cpu>clock_queda', kind: 'experimento-contra', at: 1 }]);
  assert.equal(F.forge(anomaly('clock_queda'), map).find((h) => h.cause === 'temp_cpu'), undefined);

  const base = F.forge(anomaly('travadas'), R.createMap(R.seedEdges()));
  const backed = F.forge(anomaly('travadas'), R.createMap(R.seedEdges(), [{ edgeId: 'disk>travadas', kind: 'experimento-a-favor', at: 1 }]));
  assert.ok(backed.find((h) => h.cause === 'disk').prior > base.find((h) => h.cause === 'disk').prior);

  const m = R.createMap([{ id: 'ajuste:k>bench:single', from: 'ajuste:k', to: 'bench:single', type: 'afeta', weight: 0.5, origem: 'semente' },
    { id: 'bench:single>sym', from: 'bench:single', to: 'sym', type: 'causa', weight: 0.6, origem: 'semente' }]);
  const h = F.forge(anomaly('sym'), m).find((x) => x.cause === 'ajuste:k');
  assert.ok(h.predictions.some((p) => p.action === 'medir' && p.target === 'bench:single'));
  assert.ok(h.predictions.some((p) => p.action === 'intervir' && p.target === 'ajuste:k'));
});

test('módulo sem switch nem lista fixa por sintoma: só causesOf', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'cortex', 'forge.js'), 'utf8');
  assert.ok(!/\bswitch\s*\(/.test(src));
  assert.ok(src.includes('causesOf'));
  const allowed = new Set(['rotina', 'programa_pesado', 'desconhecida']);
  for (const id of Object.keys(R.SIGNALS)) {
    if (allowed.has(id)) continue;
    assert.ok(!new RegExp(`['"\`]${id}['"\`]`).test(src), `id de sinal fixo no módulo: ${id}`);
  }
});

test('hipóteses de causa se distinguem entre si: "antes" na própria causa e previsões além de presente', () => {
  const hs = F.forge(anomaly('travadas'), R.createMap(R.seedEdges()));
  const causal = hs.filter((h) => h.source === 'mapa' || h.source === 'correlacao');
  assert.ok(causal.length >= 2);
  for (const h of causal) assert.ok(h.predictions.some((p) => p.action === 'lembrar' && p.target === h.cause && p.expect === 'antes'), h.key);
  assert.ok(by(hs, 'rotina')[0].predictions.every((p) => p.expect !== 'antes' && p.expect !== 'depois'));
  const sig = (h) => new Set(h.predictions.map((p) => `${p.action}|${p.target}|${p.expect}`));
  const extras = causal.map((h) => [...sig(h)].filter((s) => !s.endsWith('|presente')));
  assert.ok(extras.some((a) => extras.some((b) => a !== b && a.some((s) => !b.includes(s)))), 'ao menos duas diferem além de presente');
  // nenhuma causa é dada como ausente por outra causa (co-ocorrência é normal)
  for (const h of causal) assert.ok(!h.predictions.some((p) => p.expect === 'ausente'));
});

test('ajuste ligado à causa vira previsão de intervir só para aquela causa', () => {
  const map = R.createMap([
    { id: 'ajuste:k>cpu', from: 'ajuste:k', to: 'cpu', type: 'afeta', weight: 0.5, origem: 'semente' },
    edge('cpu', 'sym'), edge('disk', 'sym')]);
  const hs = F.forge(anomaly('sym'), map);
  const has = (h) => h.predictions.some((p) => p.action === 'intervir' && p.target === 'ajuste:k');
  assert.ok(has(hs.find((h) => h.cause === 'cpu')));
  assert.ok(!has(hs.find((h) => h.cause === 'disk')));
  // aresta no outro sentido (causa -> bench) também conta
  const m2 = R.createMap([{ id: 'cpu>bench:single', from: 'cpu', to: 'bench:single', type: 'afeta', weight: 0.5, origem: 'semente' }, edge('cpu', 'sym'), edge('disk', 'sym')]);
  const h2 = F.forge(anomaly('sym'), m2);
  assert.ok(h2.find((h) => h.cause === 'cpu').predictions.some((p) => p.action === 'medir' && p.target === 'bench:single'));
  assert.ok(!h2.find((h) => h.cause === 'disk').predictions.some((p) => p.target === 'bench:single'));
});

test('plataforma: com extra.knobs / extra.benches, nenhuma previsão de ajuste ou teste que este sistema não tem', () => {
  const map = R.createMap(R.seedEdges());
  const full = F.forge(anomaly('bench:burst'), map).flatMap((h) => h.predictions);
  assert.ok(full.some((p) => p.action === 'intervir' && p.target !== 'ajuste:ppd'), 'sem filtro há ajustes do Windows');
  const hs = F.forge(anomaly('bench:burst'), map, { knobs: ['ppd'], benches: ['single', 'multi', 'burst'] });
  for (const h of hs) {
    assert.ok(!(h.cause.startsWith('ajuste:') && h.cause !== 'ajuste:ppd'), `causa de outro sistema: ${h.cause}`);
    for (const p of h.predictions) {
      if (p.action === 'intervir') assert.equal(p.target, 'ajuste:ppd');
      if (p.action === 'medir') assert.ok(['bench:single', 'bench:multi', 'bench:burst'].includes(p.target), p.target);
    }
  }
  assert.ok(Math.abs(sum(hs) - 1) < 1e-9);
  const disk = F.forge(anomaly('disk'), map, { knobs: [], benches: ['single'] }).flatMap((h) => h.predictions);
  assert.ok(!disk.some((p) => p.target === 'bench:disk'));
});
