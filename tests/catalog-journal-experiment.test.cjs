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

const Profiles = require('../src/profiles.js');
const Brain = require('../src/brain.js');

test('perfis: três opções, padrão válido e fallback seguro', () => {
  assert.deepEqual(Profiles.list().map((profile) => profile.id).sort(), ['geral', 'jogos', 'trabalho']);
  assert.equal(Profiles.get('inventado').id, 'geral');
  assert.equal(Profiles.isValid('jogos'), true);
  assert.equal(Profiles.isValid('__proto__'), false);
});

test('perfis: os pesos mudam o índice mas nunca inventam problema onde não há', () => {
  const base = { now: 1e12, history: [], brain: null, cpu: 10, mem: 92, disk: 50, temp: 60, uptimeSeconds: 100 };
  const geral = Brain.healthScore({ ...base, weights: Profiles.weights('geral') });
  const trabalho = Brain.healthScore({ ...base, weights: Profiles.weights('trabalho') });
  const jogos = Brain.healthScore({ ...base, weights: Profiles.weights('jogos') });
  assert.ok(trabalho.score < geral.score, 'memória alta pesa mais para trabalho');
  assert.equal(jogos.score, geral.score, 'memória pesa igual para jogos');
  const calmo = { ...base, mem: 40 };
  assert.equal(Brain.healthScore({ ...calmo, weights: Profiles.weights('trabalho') }).score, Brain.healthScore({ ...calmo, weights: Profiles.weights('geral') }).score);
});

test('perfis: o realce reordena observações sem alterar a confiança', () => {
  const snapshot = { cpuUsage: 20, memoryPercent: 88, primaryDrive: { usedPercent: 91, driveLetter: 'C', freeBytes: 5e10 }, uptimeSeconds: 20 * 86400 };
  const sessions = [{ findings: ['thermal'] }, { findings: ['thermal'] }];
  const run = (id) => Brain.buildInsights({ now: 1e12, snapshot, history: [], sessions, boost: Profiles.boost(id), brain: null });
  const geral = run('geral'); const jogos = run('jogos');
  const confidence = (list, id) => list.find((item) => item.id === id).confidence;
  assert.equal(confidence(geral, 'session-thermal'), confidence(jogos, 'session-thermal'));
  const position = (list, id) => list.findIndex((item) => item.id === id);
  assert.ok(position(jogos, 'session-thermal') <= position(geral, 'session-thermal'));
});

test('perfis: achados de sessão são ordenados pela prioridade do perfil', () => {
  const findings = [{ id: 'memory-pressure', severity: 'warn', confidence: 70 }, { id: 'gpu-limited', severity: 'warn', confidence: 70 }, { id: 'thermal', severity: 'bad', confidence: 60 }];
  assert.deepEqual(Profiles.rankFindings('jogos', findings).map((f) => f.id), ['thermal', 'gpu-limited', 'memory-pressure']);
  assert.deepEqual(Profiles.rankFindings('trabalho', findings).map((f) => f.id), ['thermal', 'memory-pressure', 'gpu-limited']);
});
