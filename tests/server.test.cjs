/* Servidor do Nexo (Cloudflare Worker) testado no Node: D1 simulado em SQLite e um "Google" com chave RSA de teste. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createD1 } = require('../server/test/d1-sqlite.cjs');

const CLIENT_ID = '123-teste.apps.googleusercontent.com';
const ADMIN = 'criador@exemplo.com';
let mod; let google; let crypto0; let validate;
let keyPair; let jwk;
let clock = Date.UTC(2026, 10, 6, 15, 0, 0);

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function idToken(claims = {}, { kid = 'kid-1', key = keyPair.privateKey } = {}) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'sub-1', email: 'pessoa@exemplo.com', email_verified: true, name: 'Pessoa', iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 3600, ...claims })));
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(signature)}`;
}

function setup() {
  const env = { DB: createD1(), SESSION_SECRET: 's'.repeat(48), DATA_KEY: 'd'.repeat(48), GOOGLE_CLIENT_IDS: CLIENT_ID, ADMIN_EMAILS: ADMIN };
  let certFetches = 0;
  const fetchImpl = async (url) => { certFetches += 1; assert.equal(url, google.GOOGLE_CERTS); return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=20000' } }); };
  const app = mod.createApp({ fetchImpl, now: () => clock });
  const call = async (method, path, { body, token, headers = {}, raw = false } = {}) => {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    if (token) init.headers.authorization = `Bearer ${token}`;
    const response = await app.fetch(new Request(`https://nexo-api.exemplo.workers.dev${path}`, init), env, { waitUntil() {} });
    if (raw) return response;
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  };
  const loginAs = async (claims = {}, deviceId = 'pc-aaaaaaaa') => (await call('POST', '/v1/auth/google', { body: { idToken: await idToken(claims), deviceId } })).data;
  return { env, app, call, loginAs, certFetches: () => certFetches };
}

test.before(async () => {
  mod = await import('../server/src/app.js');
  google = await import('../server/src/google.js');
  crypto0 = await import('../server/src/crypto.js');
  validate = await import('../server/src/validate.js');
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
});
test.beforeEach(() => google.resetGoogleKeys());

test('saúde e rotas desconhecidas', async () => {
  const { call } = setup();
  assert.deepEqual((await call('GET', '/health')).data.ok, true);
  assert.equal((await call('GET', '/nada')).status, 404);
  const response = await call('GET', '/health', { raw: true });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('login: só com id_token verdadeiro do Google para o Nexo, e-mail verificado e dentro da validade', async () => {
  const { call, certFetches } = setup();
  const ok = await call('POST', '/v1/auth/google', { body: { idToken: await idToken(), deviceId: 'pc-aaaaaaaa' } });
  assert.equal(ok.status, 200);
  assert.match(ok.data.token, /^[\w-]+\.[\w-]+$/);
  assert.equal(ok.data.user.email, 'pessoa@exemplo.com');
  assert.equal(ok.data.admin, false);
  const bad = async (claims, options) => (await call('POST', '/v1/auth/google', { body: { idToken: await idToken(claims, options) } })).status;
  assert.equal(await bad({ aud: 'outro-app.apps.googleusercontent.com' }), 401, 'cliente OAuth de outro app');
  assert.equal(await bad({ iss: 'https://evil.example' }), 401);
  assert.equal(await bad({ exp: Math.floor(clock / 1000) - 3600 }), 401, 'expirado');
  assert.equal(await bad({ email_verified: false }), 401);
  assert.equal(await bad({ email: 'sem-arroba' }), 401);
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  assert.equal(await bad({}, { key: other.privateKey }), 401, 'assinado por outra chave');
  assert.equal(await bad({}, { kid: 'kid-desconhecido' }), 401);
  assert.equal((await call('POST', '/v1/auth/google', { body: { idToken: 'a.b.c' } })).status, 401);
  assert.equal((await call('POST', '/v1/auth/google', { body: '{quebrado' })).status, 400);
  assert.ok(certFetches() <= 3, 'as chaves do Google ficam em cache (só busca de novo com kid desconhecido)');
});

test('sessão: token adulterado, revogado ou de conta apagada não entra', async () => {
  const { call, loginAs } = setup();
  const { token } = await loginAs();
  assert.equal((await call('GET', '/v1/me', { token })).status, 200);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sid: 'outro', exp: clock + 1e9 })).toString('base64url');
  assert.equal((await call('GET', '/v1/me', { token: `${forged}.${sig}` })).status, 401);
  assert.equal((await call('GET', '/v1/me', { token: `${body}.${sig}x` })).status, 401);
  assert.equal((await call('GET', '/v1/me')).status, 401);
  await call('POST', '/v1/auth/logout', { token });
  assert.equal((await call('GET', '/v1/me', { token })).status, 401, 'sair revoga a sessão');
});

test('sincronização: cada PC guarda a sua cópia criptografada; outro PC escolhe o que trazer', async () => {
  const { call, loginAs, env } = setup();
  const a = await loginAs({}, 'pc-aaaaaaaa');
  const b = await loginAs({}, 'pc-bbbbbbbb');
  const putA = await call('PUT', '/v1/sync/pc-aaaaaaaa', { token: a.token, body: { name: 'DESKTOP-CASA', appVersion: '0.9.0', sections: { preferencias: { tema: 'escuro', leituras: 'realtime' }, diario: [{ titulo: 'Atraso dos menus' }] } } });
  assert.equal(putA.status, 200);
  await call('PUT', '/v1/sync/pc-bbbbbbbb', { token: b.token, body: { name: 'NOTEBOOK-TRABALHO', sections: { preferencias: { tema: 'claro' } } } });
  const list = await call('GET', '/v1/sync', { token: b.token });
  assert.deepEqual(list.data.devices.map((device) => [device.name, device.current]).sort(), [['DESKTOP-CASA', false], ['NOTEBOOK-TRABALHO', true]]);
  assert.deepEqual(list.data.devices.find((device) => device.name === 'DESKTOP-CASA').sections, ['preferencias', 'diario']);
  const only = await call('GET', '/v1/sync/pc-aaaaaaaa?only=preferencias', { token: b.token });
  assert.deepEqual(only.data.sections, { preferencias: { tema: 'escuro', leituras: 'realtime' } });
  // No banco não há nada legível: nem o nome do PC, nem os dados.
  const raw = env.DB.raw.prepare('SELECT name_enc, data_enc FROM snapshots').all().map((row) => `${row.name_enc}${row.data_enc}`).join('');
  assert.doesNotMatch(raw, /DESKTOP|escuro|Atraso/);
  assert.match(raw, /^v1\./);
  // Outra conta não enxerga e não abre.
  const stranger = await loginAs({ sub: 'sub-2', email: 'outra@exemplo.com' }, 'pc-cccccccc');
  assert.deepEqual((await call('GET', '/v1/sync', { token: stranger.token })).data.devices, []);
  assert.equal((await call('GET', '/v1/sync/pc-aaaaaaaa', { token: stranger.token })).status, 404);
  const stolen = env.DB.raw.prepare("SELECT data_enc FROM snapshots WHERE device_id = 'pc-aaaaaaaa'").get().data_enc;
  const strangerUid = env.DB.raw.prepare("SELECT uid FROM users WHERE email = 'outra@exemplo.com'").get().uid;
  await assert.rejects(crypto0.open(stolen, { dataKey: env.DATA_KEY, uid: strangerUid }), 'a chave de uma conta não abre a de outra');
  // Validações.
  assert.equal((await call('PUT', '/v1/sync/x', { token: a.token, body: { sections: { a1: 1 } } })).status, 400);
  assert.equal((await call('PUT', '/v1/sync/pc-aaaaaaaa', { token: a.token, body: { sections: { 'Seção Inválida': 1 } } })).status, 400);
  assert.equal((await call('PUT', '/v1/sync/pc-aaaaaaaa', { token: a.token, body: { sections: { grande: 'x'.repeat(1_100_000) } } })).status, 413);
  assert.equal((await call('DELETE', '/v1/sync/pc-bbbbbbbb', { token: a.token })).status, 200);
  assert.equal((await call('GET', '/v1/sync', { token: a.token })).data.devices.length, 1);
});

test('erros: agrupados, com o e-mail só da sessão de quem aceitou, e reabertos se voltarem depois de corrigidos', async () => {
  const { call, loginAs, env } = setup();
  const person = await loginAs();
  const report = (extra = {}) => ({ signature: 'a1b2c3d4e5f60718', source: 'interface', level: 'erro', message: 'Falhou em C:\\Users\\Joana Silva\\AppData\\x', stack: 'TypeError\n    at f (view.js:1:1)', context: '{"tela":"hardware"}', count: 3, firstAt: clock - 1000, lastAt: clock, ...extra });
  const anon = await call('POST', '/v1/errors', { body: { installId: 'install-0000000001', version: '0.9.0', platform: 'win32', includeEmail: true, email: 'falso@exemplo.com', reports: [report()] } });
  assert.equal(anon.data.accepted, 1);
  await call('POST', '/v1/errors', { token: person.token, body: { installId: 'install-0000000002', version: '0.9.0', platform: 'win32', includeEmail: true, reports: [report({ count: 2 }), { signature: 'nao-e-hex', message: 'x' }] } });
  await call('POST', '/v1/errors', { token: person.token, body: { installId: 'install-0000000003', version: '0.9.0', platform: 'linux', includeEmail: false, reports: [report({ count: 1 })] } });
  const rows = env.DB.raw.prepare('SELECT install_id, email, count FROM error_reports ORDER BY install_id').all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ install_id: 'install-0000000001', email: null, count: 3 }, { install_id: 'install-0000000002', email: 'pessoa@exemplo.com', count: 2 }, { install_id: 'install-0000000003', email: null, count: 1 }]);
  const group = env.DB.raw.prepare('SELECT message FROM error_groups').get();
  assert.equal(group.message, 'Falhou em C:\\Users\\<usuário>\\AppData\\x', 'o servidor também esconde a pasta pessoal');
  // Marca como corrigido na 0.9.1: um relatório da 0.9.0 não reabre; um da 0.9.1 reabre.
  env.DB.raw.prepare("UPDATE error_groups SET status = 'corrigido', fixed_in = '0.9.1'").run();
  await call('POST', '/v1/errors', { body: { installId: 'install-0000000001', version: '0.9.0', reports: [report()] } });
  assert.equal(env.DB.raw.prepare('SELECT status FROM error_groups').get().status, 'corrigido');
  await call('POST', '/v1/errors', { body: { installId: 'install-0000000001', version: '0.9.1', reports: [report()] } });
  assert.equal(env.DB.raw.prepare('SELECT status FROM error_groups').get().status, 'reaberto');
  assert.equal((await call('POST', '/v1/errors', { body: { installId: 'curto', reports: [] } })).status, 400);
});

test('telemetria: anônima, só chaves conhecidas, um pacote por dia e limite diário', async () => {
  const { call, env } = setup();
  const body = { installId: 'install-telemetria-01', version: '0.9.0', platform: 'win32', data: { hw: { cpuVendor: 'AMD', cores: 12, ramGB: 16, gpuVendor: 'AMD', path: 'C:\\Users\\samue\\x' }, usage: { views: { home: 10, lab: 2 } }, features: { scanApply: 1 }, email: 'nao@deveria.com', senha: '123' } };
  assert.equal((await call('POST', '/v1/telemetry', { body })).status, 200);
  assert.equal((await call('POST', '/v1/telemetry', { body })).status, 200);
  const rows = env.DB.raw.prepare('SELECT data FROM telemetry').all();
  assert.equal(rows.length, 1, 'mesmo dia: substitui');
  const data = JSON.parse(rows[0].data);
  assert.deepEqual(Object.keys(data).sort(), ['features', 'hw', 'usage']);
  assert.equal(data.hw.path, 'C:\\Users\\<usuário>\\x');
  assert.equal((await call('POST', '/v1/telemetry', { body })).status, 200);
  assert.equal((await call('POST', '/v1/telemetry', { body })).status, 429, 'no máximo 3 por dia');
  // Textos longos são cortados (80) e listas, limitadas (40); o que ainda passar de 8 KB é recusado.
  const trimmed = await call('POST', '/v1/telemetry', { body: { ...body, installId: 'install-telemetria-02', data: { usage: { views: { x: 'y'.repeat(9000) } } } } });
  assert.equal(trimmed.status, 200);
  assert.equal(JSON.parse(env.DB.raw.prepare("SELECT data FROM telemetry WHERE install_id = 'install-telemetria-02'").get().data).usage.views.x.length, 80);
  const huge = { usage: { views: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`tela${i}`, 'y'.repeat(79)])) }, lab: Array.from({ length: 40 }, () => ({ a: 'b'.repeat(79) })) };
  assert.equal((await call('POST', '/v1/telemetry', { body: { ...body, installId: 'install-telemetria-03', data: huge } })).status, 400, 'grande demais');
  env.DB.raw.prepare("DELETE FROM telemetry WHERE install_id != 'install-telemetria-01'").run();
  const agg = mod.aggregateTelemetry(env.DB.raw.prepare('SELECT * FROM telemetry').all());
  assert.equal(agg.installs, 1);
  assert.deepEqual(agg.views[0], { key: 'home', n: 10 });
  assert.deepEqual(agg.ram, [{ key: '9–16 GB', n: 1 }]);
});

test('painel: só o criador, por link de uso único, cookie seguro e proteção contra CSRF', async () => {
  const { call, loginAs } = setup();
  const person = await loginAs();
  assert.equal((await call('POST', '/v1/admin/link', { token: person.token })).status, 403);
  const admin = await loginAs({ sub: 'sub-admin', email: ADMIN }, 'pc-admin00');
  assert.equal(admin.admin, true);
  const link = await call('POST', '/v1/admin/link', { token: admin.token });
  const code = new URL(link.data.url).searchParams.get('c');
  assert.equal((await call('GET', '/painel')).status, 401, 'sem cookie, sem painel');
  const enter = await call('GET', `/painel/entrar?c=${code}`, { raw: true });
  assert.equal(enter.status, 302);
  const cookieHeader = enter.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly; Secure; SameSite=Strict/);
  const cookie = cookieHeader.split(';')[0];
  assert.equal((await call('GET', `/painel/entrar?c=${code}`)).status, 403, 'link já usado');
  const html = await call('GET', '/painel', { headers: { cookie }, raw: true });
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  // Dados para o painel.
  await call('POST', '/v1/errors', { token: person.token, body: { installId: 'install-0000000009', version: '0.9.0', includeEmail: true, reports: [{ signature: '0123456789abcdef', message: 'Quebrou', count: 4, lastAt: clock }] } });
  const resumo = await call('GET', '/painel/api/resumo', { headers: { cookie } });
  assert.equal(resumo.data.openErrors, 1);
  const erros = await call('GET', '/painel/api/erros', { headers: { cookie } });
  assert.equal(erros.data.groups[0].occurrences, 4);
  assert.equal(erros.data.groups[0].emails, 1);
  const detail = await call('GET', '/painel/api/erros/0123456789abcdef', { headers: { cookie } });
  assert.deepEqual(detail.data.emails, ['pessoa@exemplo.com']);
  assert.equal(detail.data.reports[0].email, undefined, 'a lista de PCs não repete o e-mail');
  assert.equal((await call('POST', '/painel/api/erros/0123456789abcdef', { headers: { cookie }, body: { status: 'corrigido', fixedIn: '0.9.1' } })).status, 403, 'sem o cabeçalho do painel');
  assert.equal((await call('POST', '/painel/api/erros/0123456789abcdef', { headers: { cookie, 'x-nexo-painel': '1', origin: 'https://evil.example' }, body: { status: 'corrigido', fixedIn: '0.9.1' } })).status, 403, 'de outro site');
  assert.equal((await call('POST', '/painel/api/erros/0123456789abcdef', { headers: { cookie, 'x-nexo-painel': '1' }, body: { status: 'corrigido' } })).status, 400, 'corrigido pede a versão');
  assert.equal((await call('POST', '/painel/api/erros/0123456789abcdef', { headers: { cookie, 'x-nexo-painel': '1', origin: 'https://nexo-api.exemplo.workers.dev' }, body: { status: 'corrigido', fixedIn: '0.9.1' } })).status, 200);
  assert.equal((await call('GET', '/painel/api/resumo', { headers: { cookie } })).data.openErrors, 0);
  assert.equal((await call('GET', '/painel/api/telemetria?dias=30', { headers: { cookie } })).status, 200);
  // O link expira em 60 s.
  const late = new URL((await call('POST', '/v1/admin/link', { token: admin.token })).data.url).searchParams.get('c');
  clock += 61 * 1000;
  assert.equal((await call('GET', `/painel/entrar?c=${late}`)).status, 403);
  await call('POST', '/painel/api/sair', { headers: { cookie, 'x-nexo-painel': '1' } });
  assert.equal((await call('GET', '/painel/api/resumo', { headers: { cookie } })).status, 401);
});

test('apagar minha conta: some tudo, os erros ficam sem o e-mail, e o token para de valer', async () => {
  const { call, loginAs, env } = setup();
  const person = await loginAs();
  await call('PUT', '/v1/sync/pc-aaaaaaaa', { token: person.token, body: { sections: { preferencias: { a: 1 } } } });
  await call('POST', '/v1/errors', { token: person.token, body: { installId: 'install-0000000005', version: '0.9.0', includeEmail: true, reports: [{ signature: 'fedcba9876543210', message: 'x' }] } });
  assert.equal((await call('DELETE', '/v1/me', { token: person.token })).data.deleted, true);
  for (const table of ['users', 'sessions', 'snapshots']) assert.equal(env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  assert.equal(env.DB.raw.prepare('SELECT email FROM error_reports').get().email, null);
  assert.equal((await call('GET', '/v1/me', { token: person.token })).status, 401);
});

test('limpeza diária e limites', async () => {
  const { app, env, call } = setup();
  await call('POST', '/v1/errors', { body: { installId: 'install-0000000007', version: '0.9.0', reports: [{ signature: '1111111111111111', message: 'velho' }] } });
  await call('POST', '/v1/telemetry', { body: { installId: 'install-0000000007', version: '0.9.0', data: { hw: { cores: 4 } } } });
  clock += 200 * 24 * 3600 * 1000;
  await app.scheduled({}, env);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM error_reports').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM telemetry').get().n, 0);
  for (let i = 0; i < 30; i += 1) await call('POST', '/v1/errors', { body: { installId: 'install-0000000008', version: '0.9.0', reports: [] } });
  assert.equal((await call('POST', '/v1/errors', { body: { installId: 'install-0000000008', version: '0.9.0', reports: [] } })).status, 429);
  assert.equal((await call('POST', '/v1/telemetry', { body: 'x'.repeat(1_700_000) })).status, 413);
});

test('peças: versões, criptografia e validação', async () => {
  assert.ok(validate.compareVersions('0.9.1', '0.9.0') > 0);
  assert.ok(validate.compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(validate.compareVersions('1.0.0-beta.1', '1.0.0') < 0);
  assert.equal(validate.compareVersions('0.9.0', '0.9.0'), 0);
  const sealed = await crypto0.seal({ a: 'olá' }, { dataKey: 'k'.repeat(40), uid: 'u1' });
  assert.deepEqual(await crypto0.open(sealed, { dataKey: 'k'.repeat(40), uid: 'u1' }), { a: 'olá' });
  await assert.rejects(crypto0.open(sealed, { dataKey: 'x'.repeat(40), uid: 'u1' }));
  await assert.rejects(crypto0.seal({}, { dataKey: 'curta', uid: 'u1' }), /DATA_KEY/);
  assert.equal(await crypto0.verifyToken(await crypto0.signToken({ sid: 'a', exp: 10 }, 'z'.repeat(40)), 'z'.repeat(40), 20), null, 'vencido');
});
