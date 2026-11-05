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

test('nenhum ajuste do espaço é de risco alto e todos vivem no subgrupo do processador', () => {
  for (const knob of Lab.SPACE) {
    assert.ok(['baixo', 'moderado'].includes(knob.risk), knob.id);
    assert.equal(knob.sub, 'SUB_PROCESSOR');
    assert.match(knob.setting, /^[A-Z]+$/);
    assert.ok(knob.values.every((value) => Number.isInteger(value) && value >= 0 && value <= 100));
  }
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
  for (const key of ['cooling=0', 'perfepp=0', 'perfepp=15', 'perfepp=50']) evidence = Lab.updateEvidence(evidence, key, { delta: key === 'perfepp=0' ? 6 : 0, verdict: 'sem-diferenca' });
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
  assert.equal(code(() => Lab.assertRunnable({ ...pre, platform: 'linux' }, CONSENT)), 'plataforma');
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
