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
