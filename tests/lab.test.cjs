const test = require('node:test');
const assert = require('node:assert/strict');
const Lab = require('../src/lab.js');

const CONSENT = { acknowledged: true, phrase: 'entendo o risco' };

/** PC simulado: o ganho depende só da configuração aplicada; ruído pequeno e determinístico. */
function fakeSystem(overrides = {}) {
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.01; };
  const original = { perfepp: 33, boostmode: 1, minstate: 5, mincores: 10, incpol: 0, boostpol: 60, cooling: 1 };
  const state = { config: { ...original }, applied: [], begun: false, restored: false, finished: false, adopted: null, temp: 50, t: 0 };
  const effect = (bench) => {
    const c = state.config;
    let gain = 1;
    if (bench === 'burst' && c.minstate === 100) gain *= 1.08;
    if (bench === 'burst' && c.perfepp === 0) gain *= 1.06;
    if (c.boostmode === 0) gain *= 0.8;
    return gain;
  };
  const system = {
    now: () => state.t,
    sleep: async (ms) => { state.t += ms; },
    preflight: async () => ({ platform: 'win32', onBattery: false, tempC: 50, cpuLoad: 8, pending: false, knobs: Object.fromEntries(Object.keys(original).map((id) => [id, { available: true, current: original[id] }])) }),
    createRestorePoint: async () => ({ ok: true, created: true }),
    begin: async () => { state.begun = true; },
    readConfig: async () => ({ ...original }),
    apply: async (changes) => { for (const change of changes) { state.config[change.id] = change.value; state.applied.push(`${change.setting}=${change.value}`); } },
    bench: async (bench) => { state.t += 1200; return 100 * effect(bench) * (1 + noise()); },
    sample: async () => ({ tempC: state.temp, onBattery: false, cpuLoad: 10 }),
    errorEventsSince: async () => 0,
    restore: async () => { state.restored = true; state.config = { ...original }; return { ok: true }; },
    adopt: async (config) => { state.adopted = config; return { guid: 'g-new', name: 'Nexo — Ajustado (teste)' }; },
    finish: async () => { state.finished = true; },
    ...overrides
  };
  return { system, state, original };
}

test('validateStep aceita só o espaço fechado e o valor original', () => {
  assert.equal(Lab.validateStep('perfepp', 0, 33).setting, 'PERFEPP');
  assert.equal(Lab.validateStep('perfepp', 33, 33).id, 'perfepp');
  assert.throws(() => Lab.validateStep('perfepp', 77, 33), (error) => error.code === 'fora-do-espaco');
  assert.throws(() => Lab.validateStep('hvci', 0, 1), (error) => error.code === 'fora-do-espaco');
  assert.throws(() => Lab.validateStep('perfepp', 1.5, 33), (error) => error.code === 'fora-do-espaco');
});

test('espaço revisado: GUIDs válidos e únicos, valores inteiros dentro da faixa, cada ajuste medido por algum teste', () => {
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assert.ok(Lab.SPACE.length >= 60, `só ${Lab.SPACE.length} ajustes`);
  const ids = new Set();
  const guids = new Set();
  for (const knob of Lab.SPACE) {
    assert.ok(!ids.has(knob.id), `id repetido: ${knob.id}`); ids.add(knob.id);
    assert.ok(!guids.has(knob.guid), `GUID repetido: ${knob.id}`); guids.add(knob.guid);
    assert.ok(['baixo', 'moderado', 'alto'].includes(knob.risk), knob.id);
    assert.ok(['SUB_PROCESSOR', 'SUB_DISK', 'SUB_PCIEXPRESS'].includes(knob.sub), knob.id);
    assert.match(knob.guid, GUID, knob.id);
    assert.match(knob.subGuid, GUID, knob.id);
    assert.match(knob.setting, /^[A-Z0-9]+$/);
    assert.ok(Lab.GROUPS[knob.group], `grupo desconhecido: ${knob.id}`);
    assert.ok(knob.label && knob.what, knob.id);
    const max = Number.isFinite(knob.max) ? knob.max : 100;
    assert.ok(knob.values.length >= 2 && new Set(knob.values).size === knob.values.length, knob.id);
    assert.ok(knob.values.every((value) => Number.isInteger(value) && value >= 0 && value <= max), knob.id);
    assert.ok(Lab.benchesOf(knob).length >= 1, `nenhum teste mede ${knob.id}`);
  }
  // Os sete originais continuam com o apelido do powercfg (compatível com o que já foi aprendido).
  for (const id of ['perfepp', 'boostmode', 'minstate', 'mincores', 'incpol', 'boostpol', 'cooling']) assert.equal(Lab.knob(id).alias, true, id);
});

test('risco alto só entra quando a pessoa libera "tudo"', () => {
  const high = Lab.SPACE.filter((knob) => knob.risk === 'alto');
  assert.ok(high.length >= 1);
  const baseline = Object.fromEntries(high.map((knob) => [knob.id, knob.values[knob.values.length - 1]]));
  assert.equal(Lab.chooseCandidates({ baseline, count: 10, allowRisk: 'moderado' }).length, 0);
  assert.ok(Lab.chooseCandidates({ baseline, count: 10, allowRisk: 'alto' }).length >= 1);
});

test('o que o PC informa corta o catálogo: faixa, índices e núcleos híbridos', () => {
  const knob = Lab.knob('perfcheck');
  assert.deepEqual(Lab.supportedValues(knob, { min: 1, max: 20 }), [5, 10, 1, 15]);
  assert.deepEqual(Lab.supportedValues(Lab.knob('boostmode'), { indexes: [0, 1, 2] }), [2, 1, 0]);
  const baseline = { perfepp: 33, perfepp1: 33, schedpolicy: 5 };
  const plain = Lab.chooseCandidates({ baseline, count: 20, hybrid: false });
  assert.ok(plain.every((arm) => !Lab.knob(arm.knob).hybrid));
  const hybrid = Lab.chooseCandidates({ baseline, count: 20, hybrid: true });
  assert.ok(hybrid.some((arm) => arm.knob === 'schedpolicy'));
  const limited = Lab.chooseCandidates({ baseline: { boostmode: 1 }, count: 10, support: { boostmode: { indexes: [0, 1, 2] } } });
  assert.deepEqual(limited.map((arm) => arm.value).sort(), [0, 2]);
});

test('números do espaço: dezenas de ajustes, centenas de opções e combinações astronômicas', () => {
  const all = Lab.spaceStats();
  assert.ok(all.knobs >= 60 && all.options >= 200 && all.log10 > 30, JSON.stringify(all));
  const low = Lab.spaceStats({ allowRisk: 'baixo', hybrid: false });
  assert.ok(low.knobs < all.knobs && low.options < all.options);
});

test('escolha espalha as ideias entre grupos diferentes', () => {
  const baseline = Object.fromEntries(Lab.SPACE.filter((knob) => !knob.hybrid).map((knob) => [knob.id, knob.values[knob.values.length - 1]]));
  const picked = Lab.chooseCandidates({ baseline, count: 10, allowRisk: 'moderado', hybrid: false });
  assert.equal(picked.length, 10);
  assert.equal(new Set(picked.map((arm) => arm.knob)).size, 10);
  assert.ok(new Set(picked.map((arm) => arm.group)).size >= 5, 'ideias concentradas num grupo só');
});

test('chooseCandidates prioriza o inédito, espalha por ajustes e respeita tabu e risco', () => {
  const baseline = { perfepp: 33, boostmode: 1, minstate: 5 };
  const first = Lab.chooseCandidates({ baseline, count: 3 });
  assert.equal(new Set(first.map((arm) => arm.knob)).size, 3);
  assert.ok(first.every((arm) => arm.untested && arm.novelty === 'inedito-aqui'));
  const lowOnly = Lab.chooseCandidates({ baseline, count: 10, allowRisk: 'baixo' });
  assert.ok(lowOnly.every((arm) => arm.knob !== 'boostmode'));
  const tabu = Lab.chooseCandidates({ baseline: { perfepp: 33 }, tabu: ['perfepp=0'], count: 10 });
  assert.ok(!tabu.some((arm) => arm.key === 'perfepp=0'));
});

test('UCB: depois de tudo testado, o melhor ganho médio vem primeiro', () => {
  const baseline = { cooling: 1, perfepp: 33 };
  let evidence = {};
  const keys = ['cooling=0', ...Lab.knob('perfepp').values.filter((value) => value !== 33).map((value) => `perfepp=${value}`)];
  for (const key of keys) evidence = Lab.updateEvidence(evidence, key, { delta: key === 'perfepp=0' ? 6 : 0, verdict: 'sem-diferenca' });
  const [best] = Lab.chooseCandidates({ baseline, evidence, count: 1 });
  assert.equal(best.key, 'perfepp=0');
  assert.equal(best.untested, false);
});

test('judge separa ganho real de ruído e exige consistência', () => {
  assert.equal(Lab.judge([100, 101, 99], [108, 109, 107]).verdict, 'melhorou');
  assert.equal(Lab.judge([100, 101, 99], [92, 91, 93]).verdict, 'piorou');
  assert.equal(Lab.judge([100, 101, 99], [101, 100, 100]).verdict, 'sem-diferenca');
  assert.equal(Lab.judge([100, 130, 80], [140, 150, 120]).verdict, 'inconclusivo');
  assert.equal(Lab.judge([100], [120]).verdict, 'inconclusivo');
  const mixed = Lab.judge([100, 100.5, 99.5, 100, 100], [110, 90, 111, 89, 110]);
  assert.notEqual(mixed.verdict, 'melhorou');
});

test('combine: melhora num teste e piora noutro é "misto", não ganho', () => {
  assert.equal(Lab.combine({ single: { verdict: 'melhorou', deltaPct: 5 }, multi: { verdict: 'piorou', deltaPct: -4 } }).verdict, 'misto');
  assert.equal(Lab.combine({ single: { verdict: 'sem-diferenca', deltaPct: 0.2 }, burst: { verdict: 'melhorou', deltaPct: 7 } }).verdict, 'melhorou');
});

test('assertRunnable: consentimento reforçado, tomada, temperatura e carga', () => {
  const pre = { platform: 'win32', onBattery: false, tempC: 50, cpuLoad: 5, knobs: { perfepp: { available: true } } };
  assert.deepEqual(Lab.assertRunnable(pre, CONSENT), ['perfepp']);
  const code = (fn) => { try { fn(); return 'ok'; } catch (error) { return error.code; } };
  assert.equal(code(() => Lab.assertRunnable(pre, { acknowledged: true, phrase: 'sim' })), 'consentimento');
  assert.equal(code(() => Lab.assertRunnable({ ...pre, platform: 'darwin' }, CONSENT)), 'plataforma');
  assert.deepEqual(Lab.assertRunnable({ ...pre, platform: 'linux', knobs: { ppd: { available: true } } }, CONSENT), ['ppd']);
  assert.equal(code(() => Lab.assertRunnable({ ...pre, onBattery: true }, CONSENT)), 'bateria');
  assert.equal(code(() => Lab.assertRunnable({ ...pre, tempC: null }, CONSENT)), 'sem-temperatura');
  assert.equal(code(() => Lab.assertRunnable({ ...pre, tempC: 83 }, CONSENT)), 'quente');
  assert.equal(code(() => Lab.assertRunnable({ ...pre, cpuLoad: 70 }, CONSENT)), 'ocupado');
  assert.equal(code(() => Lab.assertRunnable({ ...pre, pending: true }, CONSENT)), 'pendente');
  assert.equal(code(() => Lab.assertRunnable({ ...pre, knobs: {} }, CONSENT)), 'sem-ajustes');
});

test('evaluateGuards dispara em bateria, temperatura, aquecimento e erros do Windows', () => {
  const ok = { tempC: 60, onBattery: false };
  assert.equal(Lab.evaluateGuards({ sample: ok, startTemp: 55 }).ok, true);
  assert.equal(Lab.evaluateGuards({ sample: { ...ok, onBattery: true }, startTemp: 55 }).code, 'bateria');
  assert.equal(Lab.evaluateGuards({ sample: { tempC: 90 }, startTemp: 85 }).code, 'temperatura');
  assert.equal(Lab.evaluateGuards({ sample: { tempC: 70 }, startTemp: 55 }).code, 'aquecimento');
  assert.equal(Lab.evaluateGuards({ sample: ok, startTemp: 55, errorCount: 1 }).code, 'erros-windows');
  assert.equal(Lab.evaluateGuards({ sample: { tempC: null }, startTemp: 55 }).code, 'sem-temperatura');
});

test('run assistido: descobre o ganho real, confirma, NÃO adota e restaura tudo', async () => {
  const { system, state } = fakeSystem();
  const events = [];
  const result = await Lab.run(system, { consent: CONSENT, autonomy: 'assistido', maxArms: 7, allowRisk: 'baixo', emit: (event) => events.push(event.type) });
  assert.equal(result.status, 'completed');
  assert.equal(result.riskSession, true);
  const minstate = result.arms.find((arm) => arm.key === 'minstate=100');
  assert.ok(minstate, 'testou o estado mínimo 100%');
  assert.equal(minstate.results.burst.verdict, 'melhorou');
  const cooling = result.arms.find((arm) => arm.key === 'cooling=0');
  assert.ok(cooling && ['sem-diferenca', 'inconclusivo'].includes(cooling.verdict));
  assert.equal(result.combination?.verdict, 'melhorou');
  assert.equal(result.adopted, null);
  assert.ok(state.restored && state.finished);
  assert.ok(events.includes('arm') && events.includes('combination') && events.at(-1) === 'done');
  assert.ok(state.applied.every((step) => /^(PERFEPP|PERFBOOSTMODE|PROCTHROTTLEMIN|CPMINCORES|PERFINCPOL|PERFBOOSTPOL|SYSCOOLPOL)=\d+$/.test(step)));
});

test('run autônomo: adota só a combinação confirmada', async () => {
  const { system, state } = fakeSystem();
  const result = await Lab.run(system, { consent: CONSENT, autonomy: 'autonomo', maxArms: 7, allowRisk: 'baixo' });
  assert.equal(result.combination.verdict, 'melhorou');
  assert.ok(result.adopted?.guid);
  assert.equal(state.adopted.minstate, 100);
  assert.ok(state.restored, 'restaura antes de adotar');
});

test('guarda de aquecimento aborta, marca tabu, restaura e libera a trava', async () => {
  const { system, state } = fakeSystem();
  const realApply = system.apply;
  system.apply = async (changes) => { await realApply(changes); state.temp = state.config.boostmode !== 1 ? 66 : 50; };
  const result = await Lab.run(system, { consent: CONSENT, maxArms: 8, allowRisk: 'moderado' });
  assert.equal(result.status, 'aborted');
  assert.equal(result.guard, 'aquecimento');
  const key = result.tabu.find((item) => item.startsWith('boostmode='));
  assert.ok(key, 'o ajuste que esquentou virou tabu');
  assert.equal(result.evidence[key].guards, 1);
  assert.ok(state.restored && state.finished);
});

test('cancelamento volta ao original', async () => {
  const signal = { cancelled: false };
  const { system, state } = fakeSystem();
  const realBench = system.bench;
  let calls = 0;
  system.bench = async (bench) => { calls += 1; if (calls === 6) signal.cancelled = true; return realBench(bench); };
  const result = await Lab.run(system, { consent: CONSENT, signal });
  assert.equal(result.status, 'cancelled');
  assert.ok(state.restored && state.finished);
});

test('se a restauração falhar, a trava fica (finish não roda) e nada é adotado', async () => {
  const { system, state } = fakeSystem({ restore: async () => ({ ok: false }) });
  const result = await Lab.run(system, { consent: CONSENT, autonomy: 'autonomo', maxArms: 7, allowRisk: 'baixo' });
  assert.equal(result.restoreFailed, true);
  assert.equal(result.adopted, null);
  assert.equal(state.finished, false);
});

test('sem ponto de restauração: não começa, a não ser que a pessoa dispense', async () => {
  const blocked = fakeSystem({ createRestorePoint: async () => ({ ok: false, note: 'recusado' }) });
  const first = await Lab.run(blocked.system, { consent: CONSENT });
  assert.equal(first.status, 'aborted');
  assert.equal(first.guard, 'sem-ponto');
  assert.equal(blocked.state.begun, false);
  const allowed = fakeSystem({ createRestorePoint: async () => ({ ok: false, note: 'recusado' }) });
  const second = await Lab.run(allowed.system, { consent: CONSENT, requireRestorePoint: false, maxArms: 1 });
  assert.equal(second.status, 'completed');
});

test('sem consentimento nada é tocado', async () => {
  const { system, state } = fakeSystem();
  const result = await Lab.run(system, { consent: { acknowledged: false } });
  assert.equal(result.status, 'aborted');
  assert.equal(result.guard, 'consentimento');
  assert.equal(state.begun, false);
  assert.equal(state.applied.length, 0);
});

test('orçamento de tempo encerra cedo sem adotar', async () => {
  const { system } = fakeSystem();
  const result = await Lab.run(system, { consent: CONSENT, autonomy: 'autonomo', maxArms: 6, limits: { budgetMs: 1 } });
  assert.equal(result.budgetHit, true);
  assert.equal(result.adopted, null);
  assert.equal(result.status, 'completed');
});

test('sanitizeMemory descarta chaves e valores fora do espaço', () => {
  const clean = Lab.sanitizeMemory({ 'perfepp=0': { n: 2, mean: 5 }, 'hvci=0': { n: 1 }, 'perfepp=77': { n: 1 }, 'cooling=0': 'x' }, ['perfepp=15', 'rm -rf=1', 'cooling=0']);
  assert.deepEqual(Object.keys(clean.evidence), ['perfepp=0']);
  assert.deepEqual(clean.tabu, ['perfepp=15', 'cooling=0']);
});

test('triagem em duas etapas: o que promete ganha mais pares; o neutro para em 2', async () => {
  const { system } = fakeSystem();
  const result = await Lab.run(system, { consent: CONSENT, maxArms: 7, allowRisk: 'baixo', combos: 0 });
  const winner = result.arms.find((arm) => arm.key === 'minstate=100');
  const neutral = result.arms.find((arm) => arm.key === 'cooling=0');
  assert.equal(winner.pairsDone, Lab.DEFAULT_LIMITS.pairs);
  assert.equal(neutral.pairsDone, Lab.DEFAULT_LIMITS.screenPairs);
  assert.ok(winner.benches.includes('burst'));
});

test('combinações inéditas: sorteadas entre o que deu sinal, registradas e nunca repetidas', async () => {
  const first = fakeSystem();
  const result = await Lab.run(first.system, { consent: CONSENT, maxArms: 7, allowRisk: 'baixo', combos: 3, wild: true });
  assert.equal(result.status, 'completed');
  assert.ok(result.combos.length >= 1, 'nenhuma combinação testada');
  for (const combo of result.combos) {
    assert.match(combo.key, /^combo:/);
    assert.ok(combo.keys.length >= 2 && new Set(combo.keys.map((key) => key.split('=')[0])).size === combo.keys.length);
    assert.ok(result.evidence[combo.key]?.n >= 1);
  }
  const again = fakeSystem();
  const second = await Lab.run(again.system, { consent: CONSENT, maxArms: 7, allowRisk: 'baixo', combos: 3, wild: true, evidence: result.evidence, tabu: result.tabu });
  const before = new Set(result.combos.map((combo) => combo.key));
  assert.ok(second.combos.every((combo) => !before.has(combo.key)), 'repetiu combinação já testada');
  const clean = Lab.sanitizeMemory(result.evidence, []);
  for (const combo of result.combos) assert.ok(clean.evidence[combo.key], 'combinação perdida ao higienizar');
});

test('objetivo muda o peso de cada teste no ganho composto', () => {
  const results = { multi: { verdict: 'melhorou', deltaPct: 10 }, latency: { verdict: 'sem-diferenca', deltaPct: 0 } };
  const heavy = Lab.combine(results, Lab.GOALS.pesado.weights).compositeDelta;
  const quick = Lab.combine(results, Lab.GOALS.resposta.weights).compositeDelta;
  assert.ok(heavy > quick, `${heavy} <= ${quick}`);
});

test('sanitizeMemory: combinação só com ajustes válidos e sem repetir ajuste', () => {
  const clean = Lab.sanitizeMemory({ 'combo:minstate=100+perfepp=0': { n: 1, mean: 4 }, 'combo:minstate=100+minstate=50': { n: 1 }, 'combo:hvci=0+perfepp=0': { n: 1 }, 'combo:perfepp=0': { n: 1 } }, ['combo:minstate=100+perfepp=0']);
  assert.deepEqual(Object.keys(clean.evidence), ['combo:minstate=100+perfepp=0']);
  assert.deepEqual(clean.tabu, ['combo:minstate=100+perfepp=0']);
});
