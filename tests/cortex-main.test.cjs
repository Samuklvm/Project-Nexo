'use strict';
// Cortex no processo principal (src/cortex/cortex.cjs): memória de verdade numa pasta temporária, ritmo de verdade,
// e lab/benchmark/ociosidade/primeiro plano falsos. O node:sqlite ainda avisa "experimental" no Node 22: só esse aviso
// é silenciado.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemory } = require('../src/cortex/memory.cjs');
const { createRhythm } = require('../src/cortex/rhythm.js');
const Lab = require('../src/lab.js');
const Cortex = require('../src/cortex/cortex.cjs');

const MIN = 60000;
const DAY = 1440 * MIN;
const T0 = new Date(2026, 10, 24, 15, 0, 0).getTime(); // 24/11/2026 15:00, hora local

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-cortex-main-')); }

function labResult(verdict = 'melhorou', status = 'completed') {
  const arm = { key: 'minstate=100', knob: 'minstate', value: 100, benches: ['burst'], verdict, compositeDelta: verdict === 'melhorou' ? 6 : 0,
    results: { burst: { verdict, confidence: 'alta', deltaPct: verdict === 'melhorou' ? 6 : 0 } } };
  return { status, reason: status === 'aborted' ? 'O processador chegou a 90 °C.' : null, arms: status === 'completed' ? [arm] : [], combos: [], combination: null, adopted: null };
}

function setup({ dir = tmp(), clock = { t: T0 }, memory, labReturn } = {}) {
  const opened = memory || createMemory({ dir, now: () => clock.t });
  const env = { idle: 0, game: false, battery: false, busy: false, bench: [], lab: [], cancels: 0, logs: [], emits: [], gameCalls: 0, onBench: null, score: () => 100 };
  const cortex = Cortex.createCortex({
    memory: opened,
    rhythm: createRhythm(),
    now: () => clock.t,
    idleSec: () => env.idle,
    gameInForeground: async () => { env.gameCalls += 1; if (env.game instanceof Error) throw env.game; return env.game; },
    onBattery: () => env.battery,
    busy: () => env.busy,
    bench: async (mode) => { env.bench.push(mode); const n = env.bench.length; if (env.onBench) await env.onBench(n); return env.score(n); },
    quiet: async () => ({ ok: true }),
    labRun: async (opts) => { env.lab.push(opts); return labReturn ? labReturn(opts) : labResult(); },
    labCancel: () => { env.cancels += 1; },
    emit: (channel, payload) => env.emits.push({ channel, payload }),
    log: (entry) => env.logs.push(entry)
  });
  return { cortex, memory: opened.memory, clock, env, dir };
}

const lentidao = (at, kind = 'cpu') => ({ kind: 'lentidao', at, data: { kind, start: at - 10 * MIN, end: at, peak: 97, minutes: 10, culprit: null } });

async function goDeep(t) {
  t.env.idle = 700;
  t.env.game = false;
  await t.cortex.checkRhythm();
  await t.cortex.checkRhythm();
  assert.equal(t.cortex.rhythm().state, 'profundo');
}

/** Tiques até a condição valer (ou o limite). */
async function tickUntil(t, cond, max = 40) {
  for (let i = 0; i < max; i++) {
    if (cond()) return true;
    await t.cortex.tick();
  }
  return cond();
}

const experiments = (memory) => memory.list('experimento', { limit: 1000 });

/** Leva uma investigação de cpu até o próximo passo ser medir: lembra, espera a repetição, repete e entra no profundo. */
async function toMedir(t) {
  t.cortex.observeEvent(lentidao(T0));
  assert.ok(await tickUntil(t, () => experiments(t.memory).some((e) => e.data.status === 'esperando')), 'não chegou a esperar a repetição');
  t.clock.t = T0 + 40 * MIN;
  t.cortex.observeEvent(lentidao(t.clock.t));
  await t.cortex.tick();
  await t.cortex.tick();
  assert.deepEqual(t.env.bench, [], 'mediu no leve');
  await goDeep(t);
  // As referências dos outros testes entram no profundo; só a medição da investigação interessa daqui em diante.
  for (const b of ['disk', 'memory', 'frames']) t.memory.setMeta(`cortex.ref.${b}`, JSON.stringify({ values: [100, 100, 100, 100, 100], at: t.clock.t }));
}

test('minuto e lentidão entram na memória eterna', async () => {
  const t = setup();
  t.cortex.observeMinute({ t: T0 - MIN, cpu: 42, mem: 50, disk: 3, gpu: 7, temp: 51, cpuTemp: 60, clock: 3900, clockRatio: 0.97, culprit: 'chrome' });
  t.cortex.observeEvent(lentidao(T0));
  const rows = t.memory.minutes({ from: T0 - 2 * MIN, to: T0 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cpu, 42);
  assert.equal(rows[0].culprit, 'chrome');
  const evs = t.memory.events({ kind: 'lentidao' });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].data.kind, 'cpu');
  // O tique abre a investigação de "cpu" com a lentidão.
  await t.cortex.tick();
  const list = t.cortex.list({ limit: 10 });
  assert.equal(list.length, 1);
  assert.equal(list[0].symptom, 'cpu');
  assert.ok(t.env.emits.some((e) => e.channel === 'cortex:update'), 'avisou a tela');
});

test('sintoma de cada lentidão: cpu, memória, calor e queda de clock', () => {
  assert.equal(Cortex.symptomOfEpisode({ kind: 'cpu' }), 'cpu');
  assert.equal(Cortex.symptomOfEpisode({ kind: 'memory' }), 'mem');
  assert.equal(Cortex.symptomOfEpisode({ kind: 'thermal' }), 'temp');
  assert.equal(Cortex.symptomOfEpisode({ kind: 'throttle' }), 'clock_queda');
  assert.equal(Cortex.symptomOfEpisode({ kind: 'outra-coisa' }), null);
});

test('achados de sessão: gargalo vira sintoma; limite de quadros e equilibrado não abrem nada', () => {
  const of = (verdict, findings = []) => Cortex.symptomsOfSession({ bottleneck: { verdict }, findings });
  assert.deepEqual(of('gpu'), ['gpu']);
  assert.deepEqual(of('gpu-energia'), ['gpu']);
  assert.deepEqual(of('gpu-calor'), ['temp']);
  assert.deepEqual(of('cpu-calor'), ['temp']);
  assert.deepEqual(of('cpu-thread'), ['cpu']);
  assert.deepEqual(of('cpu-total'), ['cpu']);
  assert.deepEqual(of('memoria'), ['mem']);
  assert.deepEqual(of('limite-de-quadros'), []);
  assert.deepEqual(of('equilibrado'), []);
  assert.deepEqual(of('equilibrado', [{ id: 'fps-stutter' }]), ['travadas']);
  assert.deepEqual(of(null), []);
});

test('sessão com achado cpu-thread abre investigação de cpu; sessão equilibrada não abre', async () => {
  const t = setup();
  const meta = { startedAt: T0 - 30 * MIN, endedAt: T0 };
  t.cortex.observeSession({ id: 's-eq', summary: { meta, bottleneck: { verdict: 'equilibrado' }, findings: [] }, samples: [{ t: T0 - MIN, cpu: 30 }] });
  await t.cortex.tick();
  assert.equal(t.cortex.list({ limit: 10 }).length, 0);
  t.cortex.observeSession({ id: 's-cpu', summary: { meta, bottleneck: { verdict: 'cpu-thread' }, findings: [] }, samples: [{ t: T0 - MIN, cpu: 30, maxCore: 99 }] });
  await t.cortex.tick();
  const list = t.cortex.list({ limit: 10 });
  assert.equal(list.length, 1);
  assert.equal(list[0].symptom, 'cpu');
  assert.equal(t.memory.events({ kind: 'sessao' }).length, 2);
});

test('evento do lab não abre investigação: cada braço medido vira evento do mapa', async () => {
  const t = setup();
  const arm = { key: 'minstate=100', knob: 'minstate', value: 100, benches: ['burst', 'latency'], verdict: 'melhorou',
    results: { burst: { verdict: 'melhorou', confidence: 'alta' }, latency: { verdict: 'sem-diferenca', confidence: 'media' } } };
  t.cortex.observeEvent({ kind: 'lab', at: T0, data: { status: 'completed', arms: [arm] } });
  await t.cortex.tick();
  assert.equal(t.memory.list('investigacao', { limit: 10 }).length, 0);
  const rel = t.memory.list('relacao', { limit: 10 }).map((r) => r.data);
  assert.ok(rel.some((e) => e.edgeId === 'ajuste:minstate>bench:burst' && e.kind === 'experimento-a-favor'), JSON.stringify(rel));
  assert.ok(rel.some((e) => e.edgeId === 'ajuste:minstate>bench:latency' && e.kind === 'experimento-contra'), JSON.stringify(rel));
});

test('permissão: sem a IA local aceita, padrão "observar" (ainda não escolhido); "sozinho" sem frase vale com teto baixo; "pedir" acima de baixo exige a frase', () => {
  const t = setup();
  assert.deepEqual(t.cortex.settings(), { permission: 'observar', maxRisk: 'baixo', chosen: false, recommended: 'observar', iaLocal: false });
  // Ligar os testes sozinho é um clique explícito da pessoa: sem frase, e sempre no risco baixo.
  const auto = t.cortex.setSettings({ permission: 'sozinho', maxRisk: 'alto' });
  assert.equal(auto.ok, true);
  assert.deepEqual([t.cortex.settings().permission, t.cortex.settings().maxRisk, t.cortex.settings().chosen], ['sozinho', 'baixo', true]);
  // "Pedir" com risco acima do baixo: a frase continua obrigatória.
  const refused = t.cortex.setSettings({ permission: 'pedir', maxRisk: 'alto' });
  assert.equal(refused.ok, false);
  assert.equal(t.cortex.settings().permission, 'sozinho');
  assert.equal(t.cortex.setSettings({ permission: 'pedir', maxRisk: 'alto', consent: 'entendo' }).ok, false);
  assert.equal(t.cortex.setSettings({ permission: 'pedir', maxRisk: 'baixo' }).ok, true);
  assert.equal(t.cortex.setSettings({ permission: 'pedir', maxRisk: 'moderado', consent: Lab.CONSENT_PHRASE }).ok, true);
  assert.deepEqual([t.cortex.settings().permission, t.cortex.settings().maxRisk], ['pedir', 'moderado']);
  // Baixar o teto não pede frase; voltar a subir pede.
  assert.equal(t.cortex.setSettings({ maxRisk: 'baixo' }).ok, true);
  assert.equal(t.cortex.setSettings({ maxRisk: 'moderado' }).ok, false);
  assert.equal(t.cortex.setSettings({ permission: 'observar' }).ok, true);
  // Configuração guardada como registro eterno e no meta, com chosen.
  const meta = JSON.parse(t.memory.getMeta('cortex.config'));
  assert.equal(meta.permission, 'observar');
  assert.equal(meta.chosen, true);
  assert.ok(t.memory.list('ajuste', { limit: 20 }).every((r) => r.data.config.chosen === true));
  // Um Cortex novo com a mesma memória lembra a escolha.
  const again = setup({ memory: { ok: true, memory: t.memory } });
  assert.equal(again.cortex.settings().permission, 'observar');
  assert.equal(again.cortex.settings().chosen, true);
});

test('IA local aceita: padrão "sozinho" com teto baixo e recomendação "sozinho"; testa no profundo, nunca no leve, ocupado ou com jogo', async () => {
  const dir = tmp();
  const pre = createMemory({ dir, now: () => T0 });
  pre.memory.setMeta('ia-local.aceita', String(T0));
  const t = setup({ memory: pre });
  assert.deepEqual(t.cortex.settings(), { permission: 'sozinho', maxRisk: 'baixo', chosen: false, recommended: 'sozinho', iaLocal: true });
  const action = { type: 'intervir', target: 'ajuste:minstate', cost: 3, risk: 'baixo' };
  // Leve: nada.
  assert.equal((await t.cortex._act(action, { inv: 1, symptom: 'bench:burst' })).observed, 'interrompido');
  // Jogo em primeiro plano com o PC parado: continua leve, nada de lab.
  t.env.idle = 1200; t.env.game = true;
  for (let i = 0; i < 3; i++) await t.cortex.checkRhythm();
  assert.equal(t.cortex.rhythm().state, 'leve');
  assert.equal((await t.cortex._act(action, { inv: 1, symptom: 'bench:burst' })).observed, 'interrompido');
  // Ocupado: o tique não age.
  t.env.busy = true;
  t.cortex.observeEvent(lentidao(T0));
  await t.cortex.tick();
  assert.equal(t.memory.list('investigacao', { limit: 10 }).length, 0);
  assert.deepEqual(t.env.lab, []);
  // Profundo: o lab roda, só no risco baixo.
  t.env.busy = false;
  await goDeep(t);
  const o = await t.cortex._act(action, { inv: 1, symptom: 'bench:burst' });
  assert.equal(o.observed, 'sobe');
  assert.equal(t.env.lab.length, 1);
  assert.equal(t.env.lab[0].allowRisk, 'baixo');
  await assert.rejects(() => t.cortex._act({ ...action, target: 'ajuste:boostmode', risk: 'moderado' }, { inv: 1, symptom: 'bench:burst' }), /risco/);
  assert.equal(t.env.lab.length, 1);
  // A escolha da pessoa vale sobre a recomendação.
  assert.equal(t.cortex.setSettings({ permission: 'observar' }).ok, true);
  assert.deepEqual([t.cortex.settings().permission, t.cortex.settings().recommended, t.cortex.settings().chosen], ['observar', 'sozinho', true]);
});

test('busy(): com o lab da pessoa, a análise profunda ou um benchmark rodando, o tique não faz nada', async () => {
  const t = setup();
  t.env.busy = true;
  t.cortex.observeEvent(lentidao(T0));
  await t.cortex.tick();
  assert.equal(t.memory.list('investigacao', { limit: 10 }).length, 0);
  t.env.busy = false;
  await t.cortex.tick();
  assert.equal(t.memory.list('investigacao', { limit: 10 }).length, 1);
});

test('ritmo leve: nada de bench nem lab, nem com "sozinho" liberado (Review Focus 4)', async () => {
  const t = setup();
  t.cortex.setSettings({ permission: 'sozinho' });
  for (let i = 0; i < 4; i++) {
    t.clock.t = T0 + i * 30 * MIN;
    t.cortex.observeEvent(lentidao(t.clock.t));
    for (let k = 0; k < 10; k++) await t.cortex.tick();
  }
  assert.equal(t.cortex.rhythm().state, 'leve');
  assert.deepEqual(t.env.bench, []);
  assert.deepEqual(t.env.lab, []);
  // E a ação, chamada direto no leve, também se recusa a medir.
  const o = await t.cortex._act({ type: 'medir', target: 'bench:single', cost: 1, risk: 'nenhum' }, { inv: 1, symptom: 'cpu' });
  assert.equal(o.observed, 'interrompido');
  assert.deepEqual(t.env.bench, []);
});

test('pessoa usando o PC: o primeiro plano nem é consultado', async () => {
  const t = setup();
  t.env.idle = 30;
  for (let i = 0; i < 3; i++) await t.cortex.checkRhythm();
  assert.equal(t.env.gameCalls, 0);
  assert.equal(t.cortex.rhythm().state, 'leve');
});

test('PC parado 20 min com jogo em primeiro plano: fica no leve e nunca chama bench nem lab', async () => {
  const t = setup();
  t.cortex.setSettings({ permission: 'sozinho' });
  t.cortex.observeEvent(lentidao(T0));
  t.env.idle = 1200;
  t.env.game = true;
  for (let i = 0; i < 10; i++) {
    await t.cortex.checkRhythm();
    await t.cortex.tick();
  }
  assert.ok(t.env.gameCalls >= 1, 'consultou o primeiro plano com o PC parado');
  assert.equal(t.cortex.rhythm().state, 'leve');
  assert.deepEqual(t.env.bench, []);
  assert.deepEqual(t.env.lab, []);
});

test('consulta do primeiro plano que falha: conta como jogo (leve) e vai para o registro com source cortex', async () => {
  const t = setup();
  t.env.idle = 900;
  t.env.game = new Error('powershell travou');
  for (let i = 0; i < 3; i++) await t.cortex.checkRhythm();
  assert.equal(t.cortex.rhythm().state, 'leve');
  assert.ok(t.env.logs.some((l) => l.source === 'cortex' && l.context && l.context.etapa === 'primeiro-plano'), JSON.stringify(t.env.logs));
});

test('pessoa volta no meio de um medir: bench para, experimento interrompido, nenhuma prova nova', async () => {
  const t = setup();
  t.cortex.observeEvent(lentidao(T0));
  // No leve: olha a memória e passa a esperar a lentidão repetir.
  assert.ok(await tickUntil(t, () => experiments(t.memory).some((e) => e.data.status === 'esperando')), 'não chegou a esperar a repetição');
  t.clock.t = T0 + 40 * MIN;
  t.cortex.observeEvent(lentidao(t.clock.t));
  await t.cortex.tick();
  assert.ok(!experiments(t.memory).some((e) => e.data.status === 'esperando' && !experiments(t.memory).some((x) => x.prev === e.id)), 'a repetição não resolveu a espera');
  await t.cortex.tick();
  assert.deepEqual(t.env.bench, [], 'mediu no leve');
  const provas = t.memory.list('prova', { limit: 1000 }).length;

  await goDeep(t);
  t.env.onBench = async (n) => { if (n === 3) { t.env.idle = 2; await t.cortex.checkRhythm(); } };
  await t.cortex.tick();
  assert.equal(t.env.bench.length, 3, `rodadas: ${t.env.bench.length}`);
  assert.equal(t.cortex.rhythm().state, 'leve');
  const last = experiments(t.memory).pop();
  assert.equal(last.data.action.type, 'medir');
  assert.equal(last.data.status, 'interrompido');
  assert.equal(t.memory.list('prova', { limit: 1000 }).length, provas, 'interrompido virou prova');
  const thoughts = t.memory.list('pensamento', { limit: 1000 }).map((p) => p.data.text);
  assert.ok(thoughts.includes('Voltei ao ritmo leve: você voltou.'), thoughts.slice(-5).join(' | '));
  assert.equal(t.cortex.stats().ativosHoje, 0, 'teste interrompido gastou o orçamento');
});

test('medir compara com a referência guardada do teste: sem referência (ou velha) guarda e não vale como evidência; o orçamento sobrevive a reiniciar e zera à meia-noite', async () => {
  const dir = tmp();
  const clock = { t: T0 };
  const t = setup({ dir, clock });
  await goDeep(t);
  const medir = { type: 'medir', target: 'bench:single', cost: 1, risk: 'nenhum' };
  t.env.score = (n) => (n <= 5 ? 100 + (n % 2) : 80 + (n % 2)); // a referência ~100; depois cai 20%
  // Primeira vez: sem referência. As 5 rodadas viram a referência e o resultado não é evidência.
  const first = await t.cortex._act(medir, { inv: 1, symptom: 'cpu' });
  assert.equal(first.observed, 'sem-referencia');
  assert.equal(t.env.bench.length, 5);
  const ref = JSON.parse(t.memory.getMeta('cortex.ref.single'));
  assert.equal(ref.values.length, 5);
  assert.equal(ref.at, T0);
  // Agora 5 rodadas comparadas com a referência pelo NexoExperiment.
  const o = await t.cortex._act(medir, { inv: 1, symptom: 'cpu' });
  assert.equal(t.env.bench.length, 10);
  assert.ok(t.env.bench.every((m) => m === 'single'));
  assert.equal(o.observed, 'desce');
  assert.equal(o.significant, true);
  assert.equal(t.cortex.stats().ativosHoje, 2);
  // Reiniciou o app: o contador continua.
  const again = setup({ memory: { ok: true, memory: t.memory }, clock });
  assert.equal(again.cortex.stats().ativosHoje, 2);
  // Meia-noite local: zera.
  const next = new Date(T0); next.setDate(next.getDate() + 1); next.setHours(0, 5, 0, 0);
  clock.t = next.getTime();
  assert.equal(again.cortex.stats().ativosHoje, 0);
  // Referência com mais de 30 dias: refeita do mesmo jeito (e de novo não vale como evidência).
  clock.t = T0 + 31 * DAY;
  await goDeep(again);
  const stale = await again.cortex._act(medir, { inv: 1, symptom: 'cpu' });
  assert.equal(stale.observed, 'sem-referencia');
  assert.equal(JSON.parse(t.memory.getMeta('cortex.ref.single')).at, T0 + 31 * DAY);
});

test('referências no profundo: só dos testes que nenhuma investigação aberta vai medir; interrompidas não ficam', async () => {
  const t = setup();
  t.cortex.observeEvent(lentidao(T0)); // investigação de cpu: mede bench:multi e bench:single
  await t.cortex.tick();
  await goDeep(t);
  await t.cortex.tick();
  const refs = ['single', 'multi', 'disk', 'memory', 'frames'].filter((b) => t.memory.getMeta(`cortex.ref.${b}`));
  assert.ok(refs.length >= 1, 'nenhuma referência no profundo');
  assert.ok(!refs.includes('multi') && !refs.includes('single'), `referência de teste com investigação aberta: ${refs}`);
  // Cancelada no meio (a pessoa abriu o lab): nada é guardado.
  const u = setup();
  await goDeep(u);
  u.env.onBench = async (n) => { if (n === 2) assert.equal(u.cortex.cancelActive(), true); };
  await u.cortex.tick();
  assert.equal(u.env.bench.length, 2);
  assert.ok(!['single', 'multi', 'disk', 'memory', 'frames'].some((b) => u.memory.getMeta(`cortex.ref.${b}`)), 'guardou referência interrompida');
  // Ocupado: nem começa.
  const w = setup();
  await goDeep(w);
  w.env.busy = true;
  await w.cortex.tick();
  assert.deepEqual(w.env.bench, []);
});

test('o lab, o benchmark ou a análise profunda da pessoa cancelam o teste do Cortex: experimento interrompido, nenhuma prova', async () => {
  const t = setup();
  await toMedir(t);
  const provas = t.memory.list('prova', { limit: 1000 }).length;
  t.env.onBench = async (n) => { if (n === 2) t.cortex.cancelActive(); };
  await t.cortex.tick();
  assert.equal(t.env.bench.length, 2);
  const last = experiments(t.memory).pop();
  assert.equal(last.data.action.type, 'medir');
  assert.equal(last.data.status, 'interrompido');
  assert.equal(t.memory.list('prova', { limit: 1000 }).length, provas);
  assert.equal(t.cortex.cancelActive(), false, 'nada rodando: nada a cancelar');
  // Intervir: o cancelamento chega ao lab.
  let u;
  u = setup({ labReturn: async () => { u.cortex.cancelActive(); return labResult('melhorou', 'cancelled'); } });
  u.cortex.setSettings({ permission: 'pedir', maxRisk: 'baixo' });
  await goDeep(u);
  const o = await u.cortex._act({ type: 'intervir', target: 'ajuste:minstate', cost: 3, risk: 'baixo' }, { inv: 1, symptom: 'bench:burst' });
  assert.equal(o.observed, 'interrompido');
  assert.equal(u.env.cancels, 1);
});

test('profundo: ociosidade a cada checagem, primeiro plano só a cada 30 s', async () => {
  const t = setup();
  await goDeep(t);
  const before = t.env.gameCalls;
  for (let i = 1; i <= 12; i++) { t.clock.t = T0 + i * 5000; await t.cortex.checkRhythm(); }
  assert.equal(t.cortex.rhythm().state, 'profundo');
  assert.equal(t.env.gameCalls - before, 2, `consultas: ${t.env.gameCalls - before}`);
  // A pessoa volta: a ociosidade pega na hora, sem esperar a consulta do primeiro plano.
  t.clock.t += 5000;
  t.env.idle = 1;
  await t.cortex.checkRhythm();
  assert.equal(t.cortex.rhythm().state, 'leve');
});

test('lentidão gravada e app fechado antes do tique: o Cortex novo abre a investigação (uma vez só)', async () => {
  const t = setup();
  t.cortex.observeEvent(lentidao(T0));
  t.cortex.observeSession({ id: 's1', summary: { meta: { startedAt: T0 - 30 * MIN, endedAt: T0 }, bottleneck: { verdict: 'memoria' }, findings: [] }, samples: [] });
  t.cortex.stop(); // fechou sem tique
  const again = setup({ memory: { ok: true, memory: t.memory } });
  await again.cortex.start({ timers: false });
  await again.cortex.tick();
  const symptoms = again.cortex.list({ limit: 10 }).map((i) => i.symptom).sort();
  assert.deepEqual(symptoms, ['cpu', 'mem']);
  // Outro reinício: já foi tratada, não repete (nem vira "repetição" da investigação aberta).
  const third = setup({ memory: { ok: true, memory: t.memory } });
  await third.cortex.start({ timers: false });
  await third.cortex.tick();
  assert.equal(third.cortex.list({ limit: 10 }).length, 2);
  assert.equal(t.memory.list('prova', { limit: 100 }).filter((p) => p.data.kind === 'repeticao').length, 0);
});

test('intervir: o lab vira braço só do ajuste pedido, sem combinações e sem adotar; "observar" nunca chama o lab', async () => {
  const t = setup();
  await goDeep(t);
  const action = { type: 'intervir', target: 'ajuste:minstate', cost: 3, risk: 'baixo' };
  // Só observar: nada de lab, nem chamando a ação direto.
  await assert.rejects(() => t.cortex._act(action, { inv: 1, symptom: 'bench:burst' }));
  assert.deepEqual(t.env.lab, []);
  assert.equal(t.cortex.setSettings({ permission: 'pedir', maxRisk: 'moderado', consent: Lab.CONSENT_PHRASE }).ok, true);
  const o = await t.cortex._act(action, { inv: 1, symptom: 'bench:burst' });
  assert.equal(t.env.lab.length, 1);
  const opts = t.env.lab[0];
  assert.deepEqual(opts.onlyKnobs, ['minstate']);
  assert.equal(opts.maxArms, 1);
  assert.equal(opts.combos, 0);
  assert.equal(opts.autonomy, 'assistido');
  assert.equal(opts.allowRisk, 'moderado');
  assert.equal(opts.requireRestorePoint, false);
  assert.equal(opts.consent.acknowledged, true);
  assert.equal(String(opts.consent.phrase).toUpperCase(), Lab.CONSENT_PHRASE);
  assert.equal(o.observed, 'sobe');
  assert.equal(o.significant, true);
  // Risco acima do baixo exige ponto de restauração.
  // (o lab falso só devolve o braço do minstate: sem o braço pedido, a ação falha em vez de inventar resultado)
  await assert.rejects(() => t.cortex._act({ ...action, target: 'ajuste:boostmode', risk: 'moderado' }, { inv: 1, symptom: 'bench:burst' }), /não testou/);
  assert.equal(t.env.lab[1].requireRestorePoint, true);
  assert.equal(t.env.lab[1].allowRisk, 'moderado');
});

test('intervir: a pessoa volta no meio → labCancel e o resultado é "interrompido"', async () => {
  let t;
  t = setup({ labReturn: async () => { t.env.idle = 1; await t.cortex.checkRhythm(); return labResult('melhorou', 'cancelled'); } });
  t.cortex.setSettings({ permission: 'pedir', maxRisk: 'baixo' });
  await goDeep(t);
  const o = await t.cortex._act({ type: 'intervir', target: 'ajuste:minstate', cost: 3, risk: 'baixo' }, { inv: 1, symptom: 'bench:burst' });
  assert.equal(t.env.cancels, 1);
  assert.equal(o.observed, 'interrompido');
});

test('resultado do lab vira resultado do Cortex: guarda abortada é falha, inconclusivo não é evidência', () => {
  assert.deepEqual(Cortex.labOutcome(labResult('melhorou'), 'minstate'), { observed: 'sobe', significant: true });
  assert.equal(Cortex.labOutcome(labResult('piorou'), 'minstate').observed, 'desce');
  assert.equal(Cortex.labOutcome(labResult('sem-diferenca'), 'minstate').observed, 'igual');
  assert.equal(Cortex.labOutcome(labResult('melhorou', 'cancelled'), 'minstate').observed, 'interrompido');
  assert.throws(() => Cortex.labOutcome(labResult('melhorou', 'aborted'), 'minstate'), /90 °C/);
  assert.throws(() => Cortex.labOutcome(labResult('inconclusivo'), 'minstate'));
  assert.throws(() => Cortex.labOutcome(labResult('melhorou'), 'perfepp'));
});

test('lembrar consulta a memória: o sinal que subiu antes do sintoma nas lentidões guardadas aparece como "antes"', async () => {
  const t = setup();
  // Três lentidões de cpu em dias seguidos; a temperatura do processador sobe 5 min antes de cada uma.
  for (let d = 2; d >= 0; d--) {
    const start = T0 - d * DAY - 10 * MIN;
    for (let m = -80; m <= 10; m++) {
      const at = start + m * MIN;
      const hot = m >= -5 && m <= 10;
      t.cortex.observeMinute({ t: at, cpu: m >= 0 ? 95 : 20, mem: 40, disk: 2, gpu: 5, temp: 45, cpuTemp: hot ? 88 : 55 + (m % 3), clock: 4000, clockRatio: 0.98, culprit: null });
    }
    if (d > 0) t.cortex.observeEvent(lentidao(start + 10 * MIN));
  }
  const o = await t.cortex._act({ type: 'lembrar', target: 'temp_cpu', cost: 0.05, risk: 'nenhum' }, { inv: null, symptom: 'cpu', anomaly: { symptom: 'cpu', window: { from: T0 - 10 * MIN, to: T0 } } });
  assert.equal(o.observed, 'antes');
  assert.equal(o.significant, true);
  const g = await t.cortex._act({ type: 'lembrar', target: 'gpu', cost: 0.05, risk: 'nenhum' }, { inv: null, symptom: 'cpu', anomaly: { symptom: 'cpu', window: { from: T0 - 10 * MIN, to: T0 } } });
  assert.equal(g.observed, 'ausente');
  // Sinal que os minutos não guardam: falha honesta (não vira evidência).
  await assert.rejects(() => t.cortex._act({ type: 'lembrar', target: 'page_faults', cost: 0.05, risk: 'nenhum' }, { inv: null, symptom: 'cpu', anomaly: { symptom: 'cpu', window: { from: T0 - 10 * MIN, to: T0 } } }));
  // esperar: sem resultado ainda (a próxima lentidão igual traz).
  assert.equal(await t.cortex._act({ type: 'esperar', target: 'cpu', cost: 0.3, risk: 'nenhum' }, { inv: 1, symptom: 'cpu' }), null);
});

test('retrato da máquina só com o que é estável (sem uso de CPU, memória livre ou nome do PC)', () => {
  const a = Cortex.machineOf({ hostname: 'pc-da-pessoa', operatingSystem: 'Windows_NT 10.0.22631', cpuModel: 'Ryzen 7', logicalCpuCount: 16, cpuUsage: 12, memoryTotalBytes: 32e9, memoryUsedBytes: 9e9,
    drives: [{ driveLetter: 'C', fileSystem: 'NTFS', sizeBytes: 1e12, freeBytes: 3e11, model: 'Samsung 980' }], uptimeSeconds: 100, version: '0.11.6' });
  const b = Cortex.machineOf({ hostname: 'pc-da-pessoa', operatingSystem: 'Windows_NT 10.0.22631', cpuModel: 'Ryzen 7', logicalCpuCount: 16, cpuUsage: 80, memoryTotalBytes: 32e9, memoryUsedBytes: 20e9,
    drives: [{ driveLetter: 'C', fileSystem: 'NTFS', sizeBytes: 1e12, freeBytes: 1e11, model: 'Samsung 980' }], uptimeSeconds: 9999, version: '0.11.6' });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a).includes('pc-da-pessoa'), false);
  assert.equal(a.cpuModel, 'Ryzen 7');
});

test('abertura: retrato da máquina (só quando muda) e evento de atualização do Nexo', async () => {
  const t = setup();
  const snap = { operatingSystem: 'Linux 6.8', cpuModel: 'Ryzen 5', logicalCpuCount: 12, memoryTotalBytes: 16e9, drives: [] };
  await t.cortex.start({ snapshot: async () => snap, version: '0.12.0', timers: false });
  t.memory.flush();
  assert.equal(t.memory._db.prepare('SELECT COUNT(*) n FROM maquina').get().n, 1);
  assert.equal(t.memory.events({ kind: 'atualizacao-nexo' }).length, 1);
  assert.equal(t.memory.getMeta('versao'), '0.12.0');
  // Mesma versão e mesma máquina: nada novo.
  const again = setup({ memory: { ok: true, memory: t.memory } });
  await again.cortex.start({ snapshot: async () => ({ ...snap }), version: '0.12.0', timers: false });
  t.memory.flush();
  assert.equal(t.memory._db.prepare('SELECT COUNT(*) n FROM maquina').get().n, 1);
  assert.equal(t.memory.events({ kind: 'atualizacao-nexo' }).length, 1);
  again.cortex.stop();
  t.cortex.stop();
});

test('memória que não abre: Cortex desligado (tudo no-op) e o erro vai para o registro com source cortex (Review Focus 1)', async () => {
  const logs = [];
  const cortex = Cortex.createCortex({ memory: { ok: false, error: 'memória não abriu: disco cheio' }, rhythm: createRhythm(), log: (e) => logs.push(e), now: () => T0 });
  assert.equal(cortex.stats().ativo, false);
  assert.doesNotThrow(() => cortex.observeMinute({ t: T0, cpu: 1 }));
  assert.doesNotThrow(() => cortex.observeEvent(lentidao(T0)));
  await cortex.tick();
  await cortex.start({ timers: false });
  assert.deepEqual(cortex.list({ limit: 5 }), []);
  assert.equal(cortex.get(1), null);
  assert.equal(cortex.approve(1), false);
  assert.equal(cortex.setSettings({ permission: 'pedir' }).ok, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].source, 'cortex');
  assert.equal(logs[0].level, 'erro');
  assert.match(logs[0].message, /disco cheio/);
});

test('exceção dentro do Cortex não sobe: vai para o registro e o tique segue', async () => {
  const t = setup();
  const broken = Cortex.createCortex({
    memory: { ok: true, memory: t.memory }, rhythm: createRhythm(), now: () => T0, idleSec: () => 0, gameInForeground: async () => false,
    onBattery: () => false, busy: () => { throw new Error('busy quebrou'); }, bench: async () => 1, labRun: async () => labResult(), labCancel: () => {},
    emit: () => {}, log: (e) => t.env.logs.push(e)
  });
  await broken.tick();
  assert.ok(t.env.logs.some((l) => l.source === 'cortex' && /busy quebrou/.test(l.message)));
});

test('aprovar e negar pedidos pelo Cortex: só respondem quando há pedido pendente', async () => {
  const t = setup();
  t.cortex.observeEvent(lentidao(T0));
  await t.cortex.tick();
  const [inv] = t.cortex.list({ limit: 1 });
  assert.equal(t.cortex.approve(inv.inv), false);
  assert.equal(t.cortex.deny(inv.inv), false);
  const detail = t.cortex.get(inv.inv);
  assert.equal(detail.inv, inv.inv);
  assert.ok(detail.hipoteses.length >= 3);
  assert.ok(detail.pensamentos.length >= 1);
  const s = t.cortex.stats();
  assert.equal(s.ativo, true);
  assert.equal(s.ritmo, 'leve');
  assert.equal(s.investigacoes.abertas, 1);
  assert.ok(s.memoria.bytes > 0);
});
