/*
 * O lado do app (electron/cloud.cjs) conversando com o servidor de verdade (server/src/app.js) em memória:
 * D1 simulado em SQLite e um "Google" com chave RSA de teste. Confere o que sai do PC, quando sai e o que fica guardado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createD1 } = require('../server/test/d1-sqlite.cjs');
const { createCloud, DEFAULTS } = require('../electron/cloud.cjs');
const { createErrorLog } = require('../electron/error-log.cjs');

const CLIENT_ID = '123-teste.apps.googleusercontent.com';
const SERVER = 'https://nexo-api.exemplo.workers.dev';
const DAY = 24 * 3600 * 1000;
let mod; let google; let keyPair; let jwk;
let clock = Date.UTC(2026, 10, 6, 15, 0, 0);

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function idToken(claims = {}) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'kid-1', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'sub-1', email: 'pessoa@exemplo.com', email_verified: true, name: 'Pessoa', iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 3600, ...claims })));
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, Buffer.from(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Cofre do sistema de mentira: "cifra" invertendo os bytes (o suficiente para o token não aparecer no arquivo). */
const fakeSafeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value, 'utf8').reverse(), decryptString: (buffer) => Buffer.from(buffer).reverse().toString('utf8') };

function world() {
  const env = { DB: createD1(), SESSION_SECRET: 's'.repeat(48), DATA_KEY: 'd'.repeat(48), GOOGLE_CLIENT_IDS: CLIENT_ID, ADMIN_EMAILS: 'criador@exemplo.com' };
  const app = mod.createApp({ fetchImpl: async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=20000' } }), now: () => clock });
  const calls = [];
  const tokens = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: Boolean(init.headers?.authorization) });
    const response = await app.fetch(new Request(url, init), env, { waitUntil() {} });
    if (String(url).endsWith('/v1/auth/google') && response.ok) { const copy = await response.clone().json(); tokens.push(copy.token); }
    return response;
  };
  const rows = (sql, ...values) => env.DB.raw.prepare(sql).all(...values);
  const client = (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-')), extra = {}) => createCloud({ fs: fs.promises, path, dir, serverUrl: SERVER, fetchImpl, safeStorage: fakeSafeStorage, version: '0.9.0', platform: 'win32', now: () => clock, ...extra });
  return { env, calls, tokens, rows, client };
}

test.before(async () => {
  mod = await import('../server/src/app.js');
  google = await import('../server/src/google.js');
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
});
test.beforeEach(() => google.resetGoogleKeys());

test('nuvem: tudo desligado por padrão e nada sai do PC sem a pessoa ligar', async () => {
  assert.deepEqual(DEFAULTS, { sync: false, telemetry: false, errors: false, errorEmail: true, asked: false });
  const { client, calls } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const errorLog = { groupsSince: async () => { throw new Error('não deveria ler o registro'); } };
  const cloud = client(dir, { errorLog });
  const status = await cloud.status();
  assert.equal(status.configured, true);
  for (const key of ['sync', 'telemetry', 'errors', 'asked', 'connected', 'admin']) assert.equal(status[key], false, key);
  assert.match(status.deviceId, /^pc-[A-Za-z0-9_-]{8,}$/);
  assert.deepEqual(await cloud.sendErrors(), { skipped: true });
  assert.deepEqual(await cloud.sendTelemetry({ usage: { views: { home: 1 } } }), { skipped: true });
  assert.deepEqual(await cloud.push({ name: 'PC', sections: { perfil: 'jogos' } }), { skipped: true });
  await assert.rejects(cloud.devices(), /sincronização/);
  assert.equal(calls.length, 0, 'nenhum pedido ao servidor');
  // Os códigos deste PC ficam os mesmos depois de reabrir o app.
  const again = await client(dir).status();
  assert.equal(again.deviceId, status.deviceId);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cloud.json'), 'utf8'));
  assert.match(saved.installId, /^[A-Za-z0-9_-]{16,64}$/);
  assert.notEqual(saved.installId, saved.deviceId, 'o código da telemetria não é o mesmo do PC sincronizado');
  // Servidor sem HTTPS (ou URL estranha) não vale.
  for (const serverUrl of ['http://nexo.exemplo.com', 'https://nexo.exemplo.com/caminho', 'ftp://x', '', null]) {
    const off = createCloud({ fs: fs.promises, path, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-')), serverUrl, fetchImpl: async () => { throw new Error('não deveria chamar'); }, version: '0.9.0' });
    assert.equal((await off.status()).configured, false, String(serverUrl));
    await assert.rejects(off.connect('x.y.z'), /não está configurado/);
  }
  // Ligar a sincronização sem estar conectado não liga nada.
  assert.equal((await cloud.setOptions({ sync: true })).sync, false);
});

test('sincronização: cada PC manda a sua cópia criptografada e o outro PC escolhe o que trazer', async () => {
  const { client, rows, tokens } = world();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const pcA = client(dirA);
  const pcB = client();
  await assert.rejects(pcA.connect(''), /login com o Google/);
  const statusA = await pcA.connect(await idToken());
  assert.equal(statusA.connected, true);
  assert.equal(statusA.sync, true);
  assert.equal(statusA.email, 'pessoa@exemplo.com');
  assert.equal(statusA.admin, false);
  // O token do servidor não aparece no arquivo (fica com o cofre do sistema) e o id_token do Google não é guardado.
  const file = fs.readFileSync(path.join(dirA, 'cloud.json'), 'utf8');
  assert.ok(!file.includes(tokens[0]), 'token cifrado no disco');
  assert.ok(!file.includes('eyJ'), 'nada de JWT no disco');

  const sections = { perfil: 'jogos', preferencias: { effects: 'lite', liveRate: 'eco' }, atividade: [{ title: 'Raio-X aplicado', detail: '3 ajustes', timestamp: clock }] };
  const pushed = await pcA.push({ name: 'PC-DA-SALA', sections });
  assert.equal(pushed.ok, true);
  assert.equal((await pcA.status()).lastSyncAt, clock);
  const stored = rows('SELECT name_enc, data_enc, sections FROM snapshots');
  assert.equal(stored.length, 1);
  assert.ok(!stored[0].data_enc.includes('jogos') && !stored[0].data_enc.includes('Raio-X'), 'dados cifrados no banco');
  assert.ok(!stored[0].name_enc.includes('SALA'), 'nome do PC cifrado no banco');
  assert.deepEqual(JSON.parse(stored[0].sections), ['perfil', 'preferencias', 'atividade']);

  clock += 60000;
  await pcB.connect(await idToken());
  const { devices } = await pcB.devices();
  assert.equal(devices.length, 1, 'o PC B ainda não mandou cópia');
  assert.equal(devices[0].name, 'PC-DA-SALA');
  assert.equal(devices[0].current, false);
  const picked = await pcB.pull(devices[0].deviceId, ['perfil', 'nao vale', 'preferencias']);
  assert.deepEqual(Object.keys(picked.sections).sort(), ['perfil', 'preferencias'], 'só o que a pessoa marcou');
  assert.equal(picked.sections.perfil, 'jogos');
  assert.deepEqual((await pcB.pull(devices[0].deviceId)).sections, sections);
  await assert.rejects(pcB.pull('../../etc'), /PC inválido/);

  // Outra conta Google não enxerga nem abre as cópias desta.
  const stranger = client();
  await stranger.connect(await idToken({ sub: 'sub-2', email: 'outra@exemplo.com' }));
  assert.deepEqual((await stranger.devices()).devices, []);
  await assert.rejects(stranger.pull(devices[0].deviceId), (error) => error.status === 404);

  await pcB.push({ name: 'NOTEBOOK', sections: { perfil: 'trabalho' } });
  assert.deepEqual((await pcA.devices()).devices.map((device) => [device.name, device.current]).sort(), [['NOTEBOOK', false], ['PC-DA-SALA', true]]);
  await pcB.forget(devices[0].deviceId);
  assert.deepEqual((await pcB.devices()).devices.map((device) => device.name), ['NOTEBOOK']);
});

test('sincronização: sessão recusada pelo servidor desliga a sincronização neste PC', async () => {
  const { client, env } = world();
  const pc = client();
  await pc.connect(await idToken());
  env.SESSION_SECRET = 'outro-segredo-'.repeat(4);
  await assert.rejects(pc.push({ name: 'PC', sections: { perfil: 'geral' } }), (error) => error.status === 401);
  const status = await pc.status();
  assert.equal(status.connected, false);
  assert.equal(status.sync, false);
  assert.deepEqual(await pc.push({ name: 'PC', sections: { perfil: 'geral' } }), { skipped: true });
});

test('sincronização: desligar encerra a sessão; apagar leva as cópias de todos os PCs e a conta', async () => {
  const { client, rows } = world();
  const pcA = client();
  const pcB = client();
  await pcA.connect(await idToken());
  await pcB.connect(await idToken());
  await pcA.push({ name: 'A', sections: { perfil: 'jogos' } });
  await pcB.push({ name: 'B', sections: { perfil: 'geral' } });
  assert.equal(rows('SELECT * FROM snapshots').length, 2);
  const off = await pcB.disconnect();
  assert.equal(off.connected, false);
  assert.equal(rows('SELECT * FROM snapshots').length, 2, 'desligar não apaga as cópias');
  const gone = await pcA.deleteRemote();
  assert.equal(gone.connected, false);
  assert.equal(gone.sync, false);
  assert.equal(rows('SELECT * FROM snapshots').length, 0);
  assert.equal(rows('SELECT * FROM users').length, 0);
});

test('relatórios de erro: só os novos, agrupados, e o e-mail só de quem está conectado e marcou', async () => {
  const { client, rows, calls } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const errorLog = createErrorLog({ fs: fs.promises, path, dir: path.join(dir, 'logs'), version: '0.9.0', platform: 'win32', home: 'C:\\Users\\Samuel Antonio', user: 'Samuel Antonio', now: () => clock });
  const cloud = client(dir, { errorLog });
  errorLog.record({ level: 'erro', source: 'interface', message: 'Erro antigo, de antes de ligar', stack: 'at C:\\Users\\Samuel Antonio\\AppData\\x.js:1:1' });
  clock += 1000;
  await cloud.setOptions({ errors: true });
  assert.deepEqual(await cloud.sendErrors(), { sent: 0 }, 'o que aconteceu antes de ligar não vai');
  assert.equal(calls.length, 0);

  clock += 1000;
  errorLog.record({ level: 'erro', source: 'ipc', message: 'Falhou ao ler C:\\Users\\Samuel Antonio\\Desktop\\jogo.exe', stack: 'Error\n    at scan (C:\\Users\\Samuel Antonio\\AppData\\Local\\Programs\\nexo\\main.cjs:10:5)' });
  errorLog.record({ level: 'erro', source: 'ipc', message: 'Falhou ao ler C:\\Users\\Samuel Antonio\\Desktop\\outro.exe', stack: 'Error\n    at scan (C:\\Users\\Samuel Antonio\\AppData\\Local\\Programs\\nexo\\main.cjs:10:5)' });
  errorLog.record({ level: 'aviso', source: 'ipc', message: 'Você recusou a permissão do Windows.' });
  assert.deepEqual(await cloud.sendErrors(), { sent: 1 }, 'dois iguais viram um grupo; aviso fica no PC');
  let reports = rows('SELECT * FROM error_reports');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].count, 2);
  assert.equal(reports[0].email, null, 'sem conexão, sem e-mail');
  const group = rows('SELECT * FROM error_groups')[0];
  assert.ok(!/Samuel/.test(`${group.message} ${group.stack}`), 'nome de usuário e pastas pessoais não saem do PC');
  assert.equal(calls.at(-1).auth, false);
  assert.deepEqual(await cloud.sendErrors(), { sent: 0 }, 'não manda de novo');

  await cloud.connect(await idToken());
  clock += 1000;
  errorLog.record({ level: 'erro', source: 'principal', message: 'Outro erro, já conectado' });
  assert.deepEqual(await cloud.sendErrors(), { sent: 1 });
  reports = rows('SELECT * FROM error_reports ORDER BY first_at');
  assert.equal(reports[1].email, 'pessoa@exemplo.com', 'o e-mail vem da sessão');
  assert.ok(!('email' in calls.at(-1).body), 'o app não manda o e-mail no corpo');

  await cloud.setOptions({ errorEmail: false });
  clock += 1000;
  errorLog.record({ level: 'erro', source: 'principal', message: 'Terceiro erro, sem e-mail marcado' });
  await cloud.sendErrors();
  assert.equal(calls.at(-1).auth, false, 'sem o e-mail, nem a sessão vai junto');
  assert.equal(rows("SELECT email FROM error_reports WHERE email IS NOT NULL").length, 1);

  await cloud.setOptions({ errors: false });
  clock += 1000;
  errorLog.record({ level: 'erro', source: 'principal', message: 'Depois de desligar' });
  assert.deepEqual(await cloud.sendErrors(), { skipped: true });
});

test('telemetria: no máximo uma vez por dia, anônima e só com o que a lista permite', async () => {
  const { client, rows, calls } = world();
  const cloud = client();
  const data = { hw: { cpuVendor: 'AMD', cores: 8, ramGB: 32, gpuVendor: 'NVIDIA', osBuild: '26100' }, usage: { views: { home: 4, settings: 1 } }, features: { 'raio-x': 2 }, settings: { liveRate: 'balanced', profile: 'jogos' }, segredo: 'não vale' };
  assert.deepEqual(await cloud.sendTelemetry(data), { skipped: true });
  await cloud.setOptions({ telemetry: true });
  assert.deepEqual(await cloud.sendTelemetry(data), { sent: true });
  assert.deepEqual(await cloud.sendTelemetry(data), { skipped: true, already: true });
  let stored = rows('SELECT * FROM telemetry');
  assert.equal(stored.length, 1);
  assert.deepEqual(Object.keys(stored[0]).sort(), ['data', 'day', 'install_id', 'platform', 'received_at', 'version'], 'sem e-mail, conta ou PC sincronizado');
  assert.ok(!stored[0].data.includes('segredo'), 'chaves fora da lista ficam de fora');
  assert.equal(calls.filter((call) => call.url.endsWith('/v1/telemetry')).length, 1);
  assert.equal(calls.at(-1).auth, false, 'a telemetria nunca leva a sessão');

  // Mesmo conectado, a telemetria continua sem a conta.
  await cloud.connect(await idToken());
  clock += DAY;
  assert.deepEqual(await cloud.sendTelemetry(data), { sent: true });
  assert.equal(calls.at(-1).auth, false);
  stored = rows('SELECT * FROM telemetry ORDER BY day');
  assert.equal(stored.length, 2);
  assert.equal(stored[0].install_id, stored[1].install_id);
  assert.notEqual(stored[0].install_id, (await cloud.status()).deviceId);
});

test('telemetria: cada dia fechado sai uma vez, com o próprio dia; dia velho demais fica de fora', async () => {
  const { client, rows } = world();
  const cloud = client();
  await cloud.setOptions({ telemetry: true });
  const day = (offset) => new Date(clock - offset * DAY).toISOString().slice(0, 10);
  const data = { usage: { views: { home: 3 } } };
  assert.deepEqual(await cloud.sendTelemetry(data, day(1)), { sent: true });
  assert.deepEqual(await cloud.sendTelemetry(data, day(1)), { skipped: true, already: true }, 'o mesmo dia não vai duas vezes');
  assert.deepEqual(await cloud.sendTelemetry(data, day(2)), { sent: true }, 'outro dia guardado vai');
  assert.deepEqual(await cloud.sendTelemetry(data, day(9)), { skipped: true, old: true });
  assert.deepEqual(rows('SELECT day FROM telemetry ORDER BY day').map((row) => row.day), [day(2), day(1)]);
  assert.equal((await cloud.status()).telemetry, true);
});

test('painel: o link de entrada só sai para o e-mail do criador', async () => {
  const { client } = world();
  const visitor = client();
  await visitor.connect(await idToken());
  await assert.rejects(visitor.adminLink(), (error) => error.status === 403);
  const owner = client();
  const status = await owner.connect(await idToken({ sub: 'sub-criador', email: 'criador@exemplo.com' }));
  assert.equal(status.admin, true);
  const link = await owner.adminLink();
  assert.match(link.url, /^https:\/\/nexo-api\.exemplo\.workers\.dev\/painel\/entrar\?c=[A-Za-z0-9_-]+$/);
});
