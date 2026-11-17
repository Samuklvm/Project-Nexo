/* Contagem exata de usuários no servidor. Spec: docs/superpowers/specs/2026-11-17-contagem-exata-design.md */
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { createHarness } = require('./helpers/server-harness.cjs');

const DAY = 24 * 3600 * 1000;
let h;
test.before(async () => { h = await createHarness(); });

/** Código do PC como o app manda (64 hex) a partir de um nome qualquer. */
const pcOf = (name) => nodeCrypto.createHash('sha256').update(`nexo-pc-v1|${name}`).digest('hex');
const pulse = (call, pc, extra = {}) => call('POST', '/v1/pulse', { body: { pc, version: '0.12.0', platform: 'win32', ...extra } });
const install = (call, pc, event, extra = {}) => call('POST', '/v1/install', { body: { pc, event, version: '0.12.0', platform: 'win32', ...extra } });
const optout = (call, origem, headers = {}) => call('POST', '/v1/optout', { body: { origem }, headers });
const rows = async (env, sql) => (await env.DB.prepare(sql).all()).results.map((row) => ({ ...row }));
const today = () => new Date(h.clock.now).toISOString().slice(0, 10);

test('pulse: um por PC por dia, days_active certo e só o HMAC guardado', async () => {
  const { call, env } = h.setup();
  const pc = pcOf('pc-a');
  assert.equal((await pulse(call, pc)).status, 200);
  assert.equal((await pulse(call, pc)).status, 200);
  assert.equal((await rows(env, 'SELECT * FROM pulses')).length, 1);
  assert.equal((await rows(env, 'SELECT days_active FROM pcs'))[0].days_active, 1);
  h.tick(DAY);
  await pulse(call, pc);
  assert.equal((await rows(env, 'SELECT days_active FROM pcs'))[0].days_active, 2);
  const everything = JSON.stringify([...await rows(env, 'SELECT * FROM pcs'), ...await rows(env, 'SELECT * FROM pulses'), ...await rows(env, 'SELECT * FROM pc_events')]);
  assert.ok(!everything.includes(pc), 'o código cru nunca é guardado');
  assert.match((await rows(env, 'SELECT pc FROM pcs'))[0].pc, /^[0-9a-f]{32}$/);
});

test('pulse: validação e PC_PEPPER', async () => {
  const { call, env } = h.setup();
  assert.equal((await pulse(call, 'abc')).status, 400);
  assert.equal((await pulse(call, pcOf('x').toUpperCase())).status, 400);
  assert.equal((await pulse(call, pcOf('pc-b'), { platform: 'amiga' })).status, 200);
  assert.equal((await rows(env, 'SELECT platform FROM pcs'))[0].platform, 'win32');
  delete env.PC_PEPPER;
  const before = (await rows(env, 'SELECT * FROM pulses')).length;
  assert.equal((await pulse(call, pcOf('pc-c'))).status, 503);
  assert.equal((await rows(env, 'SELECT * FROM pulses')).length, before);
});

test('pulse: o dia é o do servidor', async () => {
  const { call, env } = h.setup();
  await pulse(call, pcOf('pc-d'), { day: '1999-01-01' });
  assert.equal((await rows(env, 'SELECT day FROM pulses'))[0].day, today());
});

test('install: instalou, reinstalou, atualizou, desinstalou e voltou', async () => {
  const { call, env } = h.setup();
  const pc = pcOf('pc-e');
  const get = async () => (await rows(env, 'SELECT installs, first_pulse_day, last_version, uninstalled_at FROM pcs'))[0];
  assert.equal((await install(call, pc, 'instalou')).status, 200);
  assert.equal((await get()).installs, 1);
  assert.equal((await get()).first_pulse_day, null);
  await install(call, pc, 'instalou');
  assert.equal((await get()).installs, 2);
  await install(call, pc, 'atualizou', { version: '0.12.1' });
  assert.equal((await get()).last_version, '0.12.1');
  await install(call, pc, 'desinstalou');
  assert.ok((await get()).uninstalled_at > 0);
  await pulse(call, pc);
  assert.equal((await get()).uninstalled_at, null, 'voltou a usar');
  assert.equal((await install(call, pc, 'explodiu')).status, 400);
  assert.equal((await rows(env, 'SELECT event FROM pc_events ORDER BY id')).map((row) => row.event).join(','), 'instalou,instalou,atualizou,desinstalou');
});

test('optout: só uma contagem, sem código', async () => {
  const { call, env } = h.setup();
  await optout(call, 'app');
  await call('POST', '/v1/optout', { body: { origem: 'app', pc: pcOf('pc-f') } });
  await optout(call, 'instalador');
  const counts = Object.fromEntries((await rows(env, 'SELECT origem, n FROM optouts')).map((row) => [row.origem, row.n]));
  assert.deepEqual(counts, { app: 2, instalador: 1 });
  assert.ok(!JSON.stringify(await rows(env, 'SELECT * FROM optouts')).includes(pcOf('pc-f')));
  assert.equal((await optout(call, 'hacker')).status, 400);
});

test('limites diários por PC e por IP', async () => {
  const { call } = h.setup();
  const pc = pcOf('pc-g');
  for (let i = 0; i < 10; i += 1) assert.equal((await pulse(call, pc)).status, 200);
  assert.equal((await pulse(call, pc)).status, 429);
  const ip = { 'cf-connecting-ip': '9.9.9.9' };
  for (let i = 0; i < 5; i += 1) assert.equal((await optout(call, 'app', ip)).status, 200);
  assert.equal((await optout(call, 'app', ip)).status, 429);
});

/* ---------- Funil, retenção, séries e versões ---------- */
let contagemMod;
test.before(async () => { contagemMod = await import('../server/src/contagem.js'); });
/** As consultas, ligadas ao relógio do teste. */
const queries = () => contagemMod.createQueries({ now: () => h.clock.now });
const errors = (call, installId, version, signature) => call('POST', '/v1/errors', { body: { installId, version, platform: 'win32', reports: [{ signature, source: 'interface', level: 'erro', message: `Erro ${signature}`, count: 1, firstAt: h.clock.now, lastAt: h.clock.now }] } });

test('funil com cada tipo de PC', async () => {
  const { call, env } = h.setup();
  const linux = { platform: 'linux' };
  const [A, B, C, D, E, F] = ['A', 'B', 'C', 'D', 'E', 'F'].map(pcOf);
  const t0 = h.clock.now;
  await install(call, A, 'instalou');
  await install(call, B, 'instalou'); await pulse(call, B);
  await install(call, D, 'instalou'); await pulse(call, D);
  h.tick(DAY); await pulse(call, D); await pulse(call, E, linux);
  h.tick(DAY); await pulse(call, D); await pulse(call, E, linux);
  h.clock.now = t0 + 10 * DAY;
  await install(call, C, 'instalou'); await pulse(call, C);
  await install(call, F, 'instalou'); await install(call, F, 'instalou'); await pulse(call, F); await install(call, F, 'desinstalou');
  await optout(call, 'app');
  const funil = await queries().funil(env);
  assert.deepEqual({ ...funil, desligaram: undefined, inicio: undefined }, { instalaram: 6, abriram: 5, reais: 2, experimentaram: 1, ativosHoje: 2, ativos7: 2, ativos30: 5, reinstalaram: 1, desinstalaram: 1, desligaram: undefined, inicio: undefined });
  assert.deepEqual(funil.desligaram, { app: 1, instalador: 0, total: 1 });
  assert.equal(funil.inicio, new Date(t0).toISOString().slice(0, 10));
});

test('retenção: quem voltou depois de 1, 7 e 30 dias', async () => {
  const { call, env } = h.setup();
  const t0 = h.clock.now;
  await pulse(call, pcOf('R1')); await pulse(call, pcOf('R2'));
  h.clock.now = t0 + 8 * DAY; await pulse(call, pcOf('R1'));
  h.clock.now = t0 + 40 * DAY;
  const ret = await queries().retencao(env);
  assert.deepEqual(ret, { d1: { pct: 50, de: 2 }, d7: { pct: 50, de: 2 }, d30: { pct: 0, de: 2 } });
});

test('banco vazio: zeros, listas vazias e nada de NaN ou Infinity', async () => {
  const { env } = h.setup();
  const q = queries();
  const funil = await q.funil(env);
  assert.deepEqual(funil, { instalaram: 0, abriram: 0, reais: 0, experimentaram: 0, ativosHoje: 0, ativos7: 0, ativos30: 0, reinstalaram: 0, desinstalaram: 0, desligaram: { app: 0, instalador: 0, total: 0 }, inicio: null });
  assert.deepEqual(await q.retencao(env), { d1: { pct: null, de: 0 }, d7: { pct: null, de: 0 }, d30: { pct: null, de: 0 } });
  assert.deepEqual(await q.porDia(env, 30), { ativos: [], novos: [], eventos: [] });
  assert.deepEqual(await q.versoes(env), { maisNova: null, versoes: [] });
});

test('séries por dia: ativos, novos e eventos do instalador', async () => {
  const { call, env } = h.setup();
  await install(call, pcOf('S1'), 'instalou'); await pulse(call, pcOf('S1')); await pulse(call, pcOf('S2'));
  h.tick(DAY); await pulse(call, pcOf('S1')); await install(call, pcOf('S2'), 'atualizou');
  const series = await queries().porDia(env, 30);
  assert.deepEqual(series.ativos.map((row) => row.n), [2, 1]);
  assert.deepEqual(series.novos.map((row) => row.n), [2]);
  assert.deepEqual(series.eventos.map(({ instalou, atualizou, desinstalou }) => [instalou, atualizou, desinstalou]), [[1, 0, 0], [0, 1, 0]]);
});

test('versões: % sem erro aproximado e regressão só na mais nova', async () => {
  const { call, env } = h.setup();
  for (const name of ['N1', 'N2', 'N3', 'N4']) await pulse(call, pcOf(name), { version: '0.12.0' });
  for (const name of ['O1', 'O2']) await pulse(call, pcOf(name), { version: '0.11.3' });
  h.tick(60 * 1000);
  await errors(call, 'install-nova-000001', '0.12.0', 'aaaaaaaaaaaaaaa1');
  await errors(call, 'install-nova-000001', '0.12.0', 'bbbbbbbbbbbbbbb2');
  await errors(call, 'install-velha-00002', '0.11.3', 'bbbbbbbbbbbbbbb2');
  const { maisNova, versoes } = await queries().versoes(env);
  assert.equal(maisNova, '0.12.0');
  assert.deepEqual(versoes.map((v) => v.version), ['0.12.0', '0.11.3']);
  const nova = versoes[0];
  assert.equal(nova.ativos7, 4);
  assert.equal(nova.pctSemErro, 75);
  assert.equal(nova.errosAbertos, 2);
  assert.deepEqual(nova.regressoes.map((r) => r.signature), ['aaaaaaaaaaaaaaa1']);
  assert.equal(versoes[1].pctSemErro, 50);
  assert.deepEqual(versoes[1].regressoes, []);
});
