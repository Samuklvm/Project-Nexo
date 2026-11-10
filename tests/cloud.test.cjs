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
  return { env, calls, tokens, rows, client, fetchImpl };
}

test.before(async () => {
  mod = await import('../server/src/app.js');
  google = await import('../server/src/google.js');
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
});
test.beforeEach(() => google.resetGoogleKeys());

test('nuvem: sincronização e telemetria desligadas por padrão; relatórios de erro sempre ligados', async () => {
  assert.deepEqual(DEFAULTS, { sync: false, telemetry: false, errors: true, errorEmail: true, asked: false });
  const { client, calls } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const errorLog = { groupsSince: async () => ({ groups: [], cursor: 0, more: false }) };
  const cloud = client(dir, { errorLog });
  const status = await cloud.status();
  assert.equal(status.configured, true);
  for (const key of ['sync', 'telemetry', 'asked', 'connected', 'admin']) assert.equal(status[key], false, key);
  assert.equal(status.errors, true, 'relatórios de erro são obrigatórios');
  assert.equal((await cloud.setOptions({ errors: false })).errors, true, 'pedido para desligar os erros é ignorado');
  assert.match(status.deviceId, /^pc-[A-Za-z0-9_-]{8,}$/);
  assert.deepEqual(await cloud.sendErrors(), { sent: 0 }, 'sem erro no registro, nada sai');
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
  // Um JWT tem cara de "eyJ….….": procurar só "eyJ" falhava por acaso quando o texto cifrado (aleatório) continha isso.
  assert.ok(!/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/.test(file), 'nada de JWT no disco');

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

test('relatórios de erro: agrupados, sem pastas pessoais, e o e-mail só de quem está conectado e marcou', async () => {
  const { client, rows, calls } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const errorLog = createErrorLog({ fs: fs.promises, path, dir: path.join(dir, 'logs'), version: '0.9.0', platform: 'win32', home: 'C:\\Users\\Samuel Antonio', user: 'Samuel Antonio', now: () => clock });
  const cloud = client(dir, { errorLog });
  assert.deepEqual(await cloud.sendErrors(), { sent: 0 });
  assert.equal(calls.length, 0, 'registro vazio, nenhum pedido');

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
  assert.equal(rows("SELECT email FROM error_reports WHERE email IS NOT NULL").length, 0, 'desmarcar tira o e-mail até dos relatórios já mandados');

  await cloud.setOptions({ errors: false });
  clock += 1000;
  errorLog.record({ level: 'erro', source: 'principal', message: 'Depois de tentar desligar' });
  assert.deepEqual(await cloud.sendErrors(), { sent: 1 }, 'os relatórios de erro não desligam');
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
  assert.deepEqual(Object.keys(stored[0]).sort(), ['data', 'day', 'install_id', 'partial', 'platform', 'received_at', 'version'], 'sem e-mail, conta ou PC sincronizado');
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

test('painel: quem entra ou sai da equipe depois do login vê (ou deixa de ver) o botão sem entrar de novo', async () => {
  const { client, env, calls } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const member = client(dir);
  assert.equal((await member.connect(await idToken({ sub: 'sub-amiga', email: 'amiga@exemplo.com' }))).admin, false);
  env.DB.raw.prepare('INSERT INTO team (email, role, added_by, added_at) VALUES (?, ?, ?, ?)').run('amiga@exemplo.com', 'leitura', 'criador@exemplo.com', clock);
  assert.equal(await member.refreshRole(), true, 'o servidor diz que agora está na equipe');
  assert.equal((await member.status()).admin, true);
  assert.equal((await client(dir).status()).admin, true, 'fica gravado');
  await member.adminLink();
  const before = calls.length;
  assert.equal(await member.refreshRole(), false, 'no máximo a cada 10 minutos');
  assert.equal(calls.length, before, 'sem pedido ao servidor dentro dos 10 minutos');
  clock += 11 * 60 * 1000;
  env.DB.raw.prepare('DELETE FROM team WHERE email = ?').run('amiga@exemplo.com');
  assert.equal(await member.refreshRole(), true);
  assert.equal((await member.status()).admin, false, 'tirada da equipe: o botão some');
  await assert.rejects(member.adminLink(), (error) => error.status === 403);
  // Sem conexão: fica o que já se sabia, sem erro.
  clock += 11 * 60 * 1000;
  const offline = createCloud({ fs: fs.promises, path, dir, serverUrl: SERVER, fetchImpl: async () => { throw new Error('sem rede'); }, safeStorage: fakeSafeStorage, version: '0.9.0', now: () => clock });
  assert.equal(await offline.refreshRole(), false);
  assert.equal((await offline.status()).admin, false);
  // Sem sincronização ligada não há conta no servidor: nada é pedido.
  const loose = client();
  const asked = calls.length;
  assert.equal(await loose.refreshRole(), false);
  assert.equal(calls.length, asked);
});

test('A07: quem tinha desligado os erros (antes da 0.11.1) só manda o que acontecer depois da atualização', async () => {
  const { client, rows } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const errorLog = createErrorLog({ fs: fs.promises, path, dir: path.join(dir, 'logs'), now: () => clock });
  // cloud.json de uma versão antiga, com os relatórios desligados.
  fs.writeFileSync(path.join(dir, 'cloud.json'), JSON.stringify({ sync: false, telemetry: false, errors: false, errorEmail: true, asked: true, installId: 'instalacao-antiga-0001', deviceId: 'pc-antigo-0001' }));
  errorLog.record({ message: 'T1, enquanto estava desligado' });
  await errorLog.idle();
  clock += 1000;
  const cloud = client(dir, { errorLog });
  assert.equal((await cloud.status()).errors, true);
  clock += 1000;
  errorLog.record({ message: 'T2, depois da atualização' });
  assert.deepEqual(await cloud.sendErrors(), { sent: 1 });
  const messages = rows('SELECT message FROM error_groups ORDER BY first_at').map((row) => row.message);
  assert.deepEqual(messages, ['T2, depois da atualização']);
  assert.equal(rows('SELECT install_id FROM error_reports')[0].install_id, 'instalacao-antiga-0001', 'a instalação continua a mesma');
});

test('A03: com mais de 50 erros diferentes, todos chegam (em lotes) e nenhum se repete', async () => {
  const { client, rows } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const errorLog = createErrorLog({ fs: fs.promises, path, dir: path.join(dir, 'logs'), now: () => clock });
  const cloud = client(dir, { errorLog });
  await cloud.setOptions({ errors: true });
  clock += 1000;
  for (let i = 0; i < 101; i += 1) errorLog.record({ message: `erro diferente ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, stack: `Error\n    at f${i} (a.js:1:1)` });
  assert.deepEqual(await cloud.sendErrors(), { sent: 101 });
  assert.equal(rows('SELECT COUNT(*) AS n FROM error_groups')[0].n, 101);
  assert.deepEqual(await cloud.sendErrors(), { sent: 0 }, 'nada de novo');
  // Empate de horário e reinício do app: o cursor é a sequência, não a data.
  errorLog.record({ message: 'depois do lote' });
  const again = client(dir, { errorLog: createErrorLog({ fs: fs.promises, path, dir: path.join(dir, 'logs'), now: () => clock }) });
  await errorLog.idle();
  assert.deepEqual(await again.sendErrors(), { sent: 1 });
  assert.equal(rows('SELECT SUM(count) AS n FROM error_reports')[0].n, 102, 'cada ocorrência contada uma vez');
});

test('A08: se não der para gravar a escolha, o que liga é desfeito e a tela fica sabendo', async () => {
  const { client } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const broken = { ...fs.promises, rename: async () => { throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); } };
  const cloud = client(dir, { fs: broken });
  await assert.rejects(cloud.setOptions({ telemetry: true }), (error) => error.code === 'nao-salvou' && /ENOSPC/.test(error.message));
  const status = await cloud.status();
  assert.equal(status.telemetry, false);
  assert.equal(status.errors, true, 'os relatórios de erro não dependem da escolha');
  assert.equal(status.saveProblem.code, 'ENOSPC');
  // Desligar continua desligado mesmo sem gravar (o lado seguro).
  const ok = client(dir);
  await ok.setOptions({ telemetry: true });
  const later = client(dir, { fs: broken });
  await assert.rejects(later.setOptions({ telemetry: false }));
  assert.equal((await later.status()).telemetry, false);
  // Arquivo ilegível: começa com tudo desligado.
  fs.writeFileSync(path.join(dir, 'cloud.json'), '{"telemetry": tr');
  assert.equal((await client(dir).status()).telemetry, false);
});

test('A13: sem cofre do sistema, o token não vai para o disco', async () => {
  const { client } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const noVault = { isEncryptionAvailable: () => false, encryptString: () => { throw new Error('sem cofre'); }, decryptString: () => { throw new Error('sem cofre'); } };
  const cloud = client(dir, { safeStorage: noVault });
  const status = await cloud.connect(await idToken());
  assert.equal(status.connected, true, 'vale enquanto o app está aberto');
  assert.equal(status.tokenProtected, false);
  const stored = fs.readFileSync(path.join(dir, 'cloud.json'), 'utf8');
  assert.ok(!/"value"/.test(stored), 'nenhum valor de token gravado');
  assert.equal((await client(dir, { safeStorage: noVault }).status()).connected, false, 'depois de reabrir, precisa ligar de novo');
  // Token antigo em Base64 (versões anteriores) é descartado ao abrir.
  const old = JSON.parse(stored);
  old.session = { token: { enc: false, value: Buffer.from('abc').toString('base64') }, expiresAt: clock + DAY, email: 'x@exemplo.com' };
  fs.writeFileSync(path.join(dir, 'cloud.json'), JSON.stringify(old));
  assert.equal((await client(dir).status()).connected, false);
});

test('A19/A20: o mesmo dia não sai duas vezes ao mesmo tempo; servidor parado tem prazo', async () => {
  const { client, calls } = world();
  const cloud = client();
  await cloud.setOptions({ telemetry: true });
  const day = new Date(clock - DAY).toISOString().slice(0, 10);
  const [a, b] = await Promise.all([cloud.sendTelemetry({ usage: { views: { home: 1 } } }, day), cloud.sendTelemetry({ usage: { views: { home: 1 } } }, day)]);
  assert.deepEqual(a, { sent: true });
  assert.deepEqual(b, { sent: true }, 'a segunda chamada espera a primeira em vez de mandar de novo');
  assert.equal(calls.filter((call) => call.url.endsWith('/v1/telemetry')).length, 1);
  const stuck = client(undefined, { fetchImpl: (_url, init) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(new Error('abortado'))); }), timeoutMs: 50 });
  await stuck.setOptions({ telemetry: true });
  const started = Date.now();
  await assert.rejects(stuck.sendTelemetry({ usage: { views: { home: 1 } } }, day), (error) => error.timeout === true && /não respondeu/.test(error.message));
  assert.ok(Date.now() - started < 2000);
  assert.match((await stuck.status()).telemetryProblem.message, /não respondeu/);
});

test('telemetria: hoje sai como parcial (a cada 3 h); dia no futuro espera', async () => {
  const { client, rows } = world();
  const cloud = client();
  await cloud.setOptions({ telemetry: true });
  const today = new Date(clock).toISOString().slice(0, 10);
  assert.deepEqual(await cloud.sendTelemetry({ usage: { views: { home: 1 } } }, today, { partial: true }), { sent: true, partial: true });
  assert.deepEqual(await cloud.sendTelemetry({ usage: { views: { home: 2 } } }, today, { partial: true }), { skipped: true, throttled: true });
  clock += 3 * 3600 * 1000 + 1;
  assert.deepEqual(await cloud.sendTelemetry({ usage: { views: { home: 3 } } }, today, { partial: true }), { sent: true, partial: true });
  assert.equal(rows('SELECT partial FROM telemetry')[0].partial, 1);
  assert.deepEqual(await cloud.sendTelemetry({ usage: { views: { home: 9 } } }, today), { sent: true }, 'o completo do dia ainda sai depois do parcial');
  const tomorrow = new Date(clock + DAY).toISOString().slice(0, 10);
  assert.deepEqual(await cloud.sendTelemetry({ usage: { views: { home: 1 } } }, tomorrow), { skipped: true, future: true });
});

test('erros: com a conta Google entrada no app (sem sincronizar), o e-mail vai como "não confirmado"', async () => {
  const { client, rows, calls } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const errorLog = createErrorLog({ fs: fs.promises, path, dir: path.join(dir, 'logs'), now: () => clock });
  const cloud = client(dir, { errorLog, accountEmail: async () => 'amiga@exemplo.com' });
  await cloud.setOptions({ errors: true });
  clock += 1000;
  errorLog.record({ message: 'erro da amiga' });
  await cloud.sendErrors();
  assert.deepEqual({ ...rows('SELECT email, email_verified FROM error_reports')[0] }, { email: 'amiga@exemplo.com', email_verified: 0 });
  assert.equal(calls.at(-1).auth, false);
  await cloud.setOptions({ errorEmail: false });
  clock += 1000;
  errorLog.record({ message: 'outro erro da amiga' });
  await cloud.sendErrors();
  assert.equal(calls.at(-1).body.contactEmail, undefined, 'sem marcar, o e-mail não sai do PC');
  assert.ok(calls.some((call) => call.url.endsWith('/v1/errors/forget-email') && call.body.installId), 'desmarcar pede para tirar o e-mail');
  assert.ok(rows('SELECT email FROM error_reports').every((row) => row.email === null), 'e o e-mail some dos relatórios já mandados');
  assert.equal((await cloud.status()).forgetEmailPending, false);
});

test('desmarcar o e-mail sem conexão: fica pendente e vai no próximo envio de erros', async () => {
  const { client, rows, calls, fetchImpl } = world();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-nuvem-'));
  const errorLog = createErrorLog({ fs: fs.promises, path, dir: path.join(dir, 'logs'), now: () => clock });
  let offline = false;
  const base = client(dir, { errorLog, accountEmail: async () => 'amiga@exemplo.com' });
  await base.setOptions({ errors: true });
  clock += 1000;
  errorLog.record({ message: 'erro com e-mail' });
  await base.sendErrors();
  assert.equal(rows('SELECT email FROM error_reports')[0].email, 'amiga@exemplo.com');
  // Mesmo diretório (mesmo cloud.json), mas a rede cai na hora de desmarcar.
  const flaky = createCloud({ fs: fs.promises, path, dir, serverUrl: SERVER, version: '0.9.0', platform: 'win32', now: () => clock, errorLog, accountEmail: async () => 'amiga@exemplo.com',
    fetchImpl: async (url, init) => {
      if (offline) throw new Error('sem rede');
      return fetchImpl(url, init);
    } });
  offline = true;
  await flaky.setOptions({ errorEmail: false });
  assert.equal((await flaky.status()).forgetEmailPending, true);
  assert.equal(rows('SELECT email FROM error_reports')[0].email, 'amiga@exemplo.com');
  offline = false;
  await flaky.sendErrors();
  assert.equal(rows('SELECT email FROM error_reports')[0].email, null);
  assert.equal((await flaky.status()).forgetEmailPending, false);
  assert.ok(calls.length > 0);
});

test('fitTelemetry: corta do menos importante até caber', () => {
  const { fitTelemetry } = require('../electron/cloud.cjs');
  const big = { hw: { cores: 8 }, usage: { views: { home: 1 }, actions: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`acao${i}`, i])) }, diag: { ipc: Object.fromEntries(Array.from({ length: 58 }, (_, i) => [`canal.${i}`, { n: i, e: 0, ms: 1, max: 2 }])) } };
  const fitted = fitTelemetry(big, 1500);
  assert.ok(fitted.bytes <= 1500, String(fitted.bytes));
  assert.deepEqual(fitted.data.hw, { cores: 8 }, 'o hardware fica');
  assert.ok(fitted.trimmed.includes('diag.ipc'));
  assert.equal(fitTelemetry({ hw: { cores: 2 } }).trimmed.length, 0);
});
