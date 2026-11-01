const test = require('node:test');
const assert = require('node:assert/strict');
const Catalog = require('../src/catalog.js');
const Journal = require('../src/journal.js');
const Experiment = require('../src/experiment.js');

test('catálogo: toda técnica tem os campos obrigatórios e fonte coerente com a evidência', () => {
  const entries = Catalog.list();
  assert.ok(entries.length >= 7);
  const ids = new Set();
  for (const entry of entries) {
    assert.deepEqual(Catalog.missingFields(entry), [], `${entry.id} incompleta`);
    assert.ok(Catalog.RISK[entry.risco] !== undefined, `${entry.id}: risco inválido`);
    assert.ok(!ids.has(entry.id), `id duplicado ${entry.id}`);
    ids.add(entry.id);
    for (const fonte of entry.fontes) {
      if (fonte.evidencia === 'oficial') assert.match(fonte.url || '', /^https:\/\/(learn|support)\.microsoft\.com\//, `${entry.id}: fonte oficial sem URL da Microsoft`);
      else assert.ok(['observada', 'hipotese'].includes(fonte.evidencia));
    }
    // 29.19: só declara reversível quem explica como reverter
    if (entry.reversivel === true) assert.ok(entry.reversao.length > 40);
  }
});

test('catálogo: o consentimento sobe com o risco e o crítico é bloqueado', () => {
  assert.equal(Catalog.consentFor('baixo'), 'confirmacao');
  assert.equal(Catalog.consentFor('moderado'), 'explicita');
  assert.equal(Catalog.consentFor('alto'), 'explicita-reforcada');
  assert.equal(Catalog.consentFor('critico'), 'bloquear');
  assert.equal(Catalog.consentFor('inventado'), 'bloquear');
  assert.equal(Catalog.get('cleanup-recycle').risco, 'moderado');
  assert.equal(Catalog.get('cleanup-recycle').reversivel, false);
});

function memoryStorage() { let data = []; return { get: () => data, set: (value) => { data = value; } }; }

test('diário: registra, limita o tamanho e lista do mais novo para o mais antigo', () => {
  const journal = Journal.create(memoryStorage());
  for (let i = 0; i < 130; i++) journal.record({ actionId: 'cleanup-temp', title: `limpeza ${i}`, now: 1000 + i });
  const list = journal.list();
  assert.equal(list.length, Journal.MAX_ENTRIES);
  assert.equal(list[0].title, 'limpeza 129');
});

test('diário: reversão do plano de energia, com detecção de conflito', () => {
  const journal = Journal.create(memoryStorage());
  const entry = journal.record({ actionId: 'power-plan-switch', title: 'Plano de energia', reversible: true, before: { guid: 'aaa', name: 'Equilibrado' }, after: { guid: 'bbb', name: 'Alto desempenho' } });
  assert.deepEqual(journal.canRevert(entry, { activeGuid: 'bbb' }), { ok: true, conflict: false, reason: '' });
  const conflict = journal.canRevert(entry, { activeGuid: 'ccc', activeName: 'Economia de energia' });
  assert.equal(conflict.ok, true);
  assert.equal(conflict.conflict, true);
  assert.match(conflict.reason, /Economia de energia/);
  journal.markReverted(entry.id, 'ok');
  assert.equal(journal.canRevert(journal.get(entry.id), { activeGuid: 'aaa' }).ok, false);
});

test('diário: operação irreversível nunca oferece reversão', () => {
  const journal = Journal.create(memoryStorage());
  const entry = journal.record({ actionId: 'cleanup-temp', title: 'Limpeza', reversible: false });
  assert.equal(journal.canRevert(entry, {}).ok, false);
});

test('experimento: mediana e ruído', () => {
  const s = Experiment.summarize([100, 102, 98]);
  assert.equal(s.median, 100);
  assert.ok(Math.abs(s.noisePct - 2) < 1e-9);
  assert.equal(Experiment.summarize([]).n, 0);
});

test('experimento: melhora clara, piora clara e diferença dentro do ruído', () => {
  const up = Experiment.compare([100, 101, 99], [112, 113, 111]);
  assert.equal(up.verdict, 'melhorou');
  assert.ok(up.deltaPct > 10 && up.confidence === 'alta');
  const down = Experiment.compare([100, 101, 99], [90, 91, 89]);
  assert.equal(down.verdict, 'piorou');
  const noise = Experiment.compare([100, 108, 92], [103, 109, 95]);
  assert.equal(noise.verdict, 'sem-diferenca');
  assert.match(noise.notes.join(' '), /dentro do ruído/);
});

test('experimento: poucas repetições é inconclusivo e ruído alto gera aviso', () => {
  assert.equal(Experiment.compare([100, 101], [120, 121]).verdict, 'inconclusivo');
  const noisy = Experiment.compare([100, 125, 80], [200, 230, 170]);
  assert.match(noisy.notes.join(' '), /variaram muito/);
});

test('experimento: avisos de contexto', () => {
  const warnings = Experiment.contextWarnings({ onBattery: true, cpuBefore: 70, tempBefore: 60, tempAfter: 72 });
  assert.equal(warnings.length, 3);
  assert.deepEqual(Experiment.contextWarnings({}), []);
});
