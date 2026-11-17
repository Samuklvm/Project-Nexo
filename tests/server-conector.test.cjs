/* Conector do Claude (MCP + OAuth) no servidor do Nexo. Spec: docs/superpowers/specs/2026-11-17-conector-claude-design.md */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ORIGIN } = require('./helpers/server-harness.cjs');

const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const CLAUDE_COM_CB = 'https://claude.com/api/mcp/auth_callback';
let h;
test.before(async () => { h = await createHarness(); });

const register = (call, redirectUris = [CLAUDE_CB], extra = {}) => call('POST', '/oauth/register', { body: { client_name: 'Claude', redirect_uris: redirectUris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', ...extra } });

test('descoberta: metadados do recurso e do servidor de autorização', async () => {
  const { call } = h.setup();
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const meta = await call('GET', path);
    assert.equal(meta.status, 200, path);
    assert.equal(meta.data.resource, `${ORIGIN}/mcp`);
    assert.equal(meta.data.authorization_servers[0], ORIGIN);
  }
  const server = await call('GET', '/.well-known/oauth-authorization-server');
  assert.equal(server.status, 200);
  assert.equal(server.data.issuer, ORIGIN);
  assert.equal(server.data.authorization_endpoint, `${ORIGIN}/painel/conectar`);
  assert.equal(server.data.token_endpoint, `${ORIGIN}/oauth/token`);
  assert.equal(server.data.registration_endpoint, `${ORIGIN}/oauth/register`);
  assert.deepEqual(server.data.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(server.data.token_endpoint_auth_methods_supported, ['none']);
  assert.deepEqual(server.data.grant_types_supported, ['authorization_code', 'refresh_token']);
});

test('registro: só os callbacks do Claude', async () => {
  const { call } = h.setup();
  const ok = await register(call);
  assert.equal(ok.status, 201);
  assert.ok(typeof ok.data.client_id === 'string' && ok.data.client_id.length >= 16);
  assert.equal(ok.data.token_endpoint_auth_method, 'none');
  assert.deepEqual(ok.data.redirect_uris, [CLAUDE_CB]);
  assert.equal((await register(call, [CLAUDE_COM_CB])).status, 201);
  const evil = await register(call, ['https://evil.example/cb']);
  assert.equal(evil.status, 400);
  assert.equal(evil.data.error, 'invalid_redirect_uri');
  assert.equal((await register(call, [CLAUDE_CB, CLAUDE_COM_CB, 'https://evil.example/cb'])).status, 400);
  assert.equal((await register(call, [])).status, 400);
  for (let i = 2; i < 20; i += 1) assert.equal((await register(call)).status, 201);
  const over = await register(call);
  assert.equal(over.status, 400, 'o 21º cliente');
  assert.equal(over.data.error, 'invalid_client_metadata');
});


/* ---------- Consentimento, código e tokens ---------- */
const nodeCrypto = require('node:crypto');
const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
function pkce(length = 64) {
  const bytes = nodeCrypto.randomBytes(length);
  const verifier = [...bytes].map((byte) => VERIFIER_CHARS[byte % VERIFIER_CHARS.length]).join('');
  return { verifier, challenge: nodeCrypto.createHash('sha256').update(verifier).digest('base64url') };
}
const authParams = (clientId, challenge, extra = {}) => ({ response_type: 'code', client_id: clientId, redirect_uri: CLAUDE_CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'estado-123', scope: 'painel', resource: `${ORIGIN}/mcp`, ...extra });
const qs = (params) => new URLSearchParams(params).toString();
const approve = (call, cookie, params, decisao = 'autorizar', headers = { 'x-nexo-painel': '1' }) => call('POST', '/painel/api/conectar', { cookie, headers, body: { ...params, decisao } });

/** Do registro ao par de tokens, como o Claude faz. */
async function connect(env, { email } = {}) {
  const { call, panelCookie } = env;
  const client = (await register(call)).data;
  const cookie = await panelCookie(email);
  const { verifier, challenge } = pkce();
  const params = authParams(client.client_id, challenge);
  const answer = await approve(call, cookie, params);
  assert.equal(answer.status, 200, JSON.stringify(answer.data));
  const code = new URL(answer.data.location).searchParams.get('code');
  const tokens = await call('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: client.client_id, resource: `${ORIGIN}/mcp` } });
  assert.equal(tokens.status, 200, JSON.stringify(tokens.data));
  return { client, cookie, tokens: tokens.data };
}

test('consentimento: a página não leva dado nenhum; "quem" exige o cookie do painel', async () => {
  const env = h.setup();
  const { call, panelCookie } = env;
  const client = (await register(call)).data;
  const { challenge } = pkce();
  const params = authParams(client.client_id, challenge);
  const pageResponse = await call('GET', `/painel/conectar?${qs(params)}`, { raw: true });
  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();
  assert.match(html, /<script src="\/painel\/conectar\.js"/);
  assert.doesNotMatch(html, /@/);
  assert.match(pageResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY');
  assert.equal((await call('GET', '/painel/conectar.js', { raw: true })).status, 200);
  assert.equal((await call('GET', '/painel/conectar.css', { raw: true })).status, 200);
  assert.equal((await call('GET', `/painel/conectar?${qs({ ...params, client_id: 'desconhecido-123456' })}`)).status, 400);
  assert.equal((await call('GET', `/painel/conectar?${qs({ ...params, redirect_uri: CLAUDE_COM_CB })}`)).status, 400, 'endereço de volta que não foi registrado');
  assert.equal((await call('GET', `/painel/conectar?${qs({ ...params, code_challenge_method: 'plain' })}`)).status, 400);
  assert.equal((await call('GET', `/painel/conectar?${qs({ ...params, resource: 'https://outro.exemplo/mcp' })}`)).status, 400);
  assert.equal((await call('GET', `/painel/api/conectar/quem?${qs(params)}`)).status, 401);
  const cookie = await panelCookie();
  const who = await call('GET', `/painel/api/conectar/quem?${qs(params)}`, { cookie });
  assert.equal(who.status, 200);
  assert.equal(who.data.role, 'dono');
  assert.equal(who.data.client, 'Claude');
  assert.notEqual(who.data.email, h.ADMIN);
  assert.match(who.data.email, /^cr…@exemplo\.com$/);
});

test('fluxo completo com PKCE: código de uso único, de 60 s, preso ao verificador e ao endereço de volta', async () => {
  const env = h.setup();
  const { call, panelCookie } = env;
  const client = (await register(call)).data;
  const cookie = await panelCookie();
  const { verifier, challenge } = pkce();
  const params = authParams(client.client_id, challenge);
  assert.equal((await approve(call, cookie, params, 'autorizar', {})).status, 403, 'sem o cabeçalho contra CSRF');
  assert.equal((await approve(call, null, params)).status, 401, 'sem o cookie do painel');
  const refused = await approve(call, cookie, params, 'recusar');
  const refusedUrl = new URL(refused.data.location);
  assert.equal(`${refusedUrl.origin}${refusedUrl.pathname}`, CLAUDE_CB);
  assert.equal(refusedUrl.searchParams.get('error'), 'access_denied');
  assert.equal(refusedUrl.searchParams.get('state'), 'estado-123');
  const answer = await approve(call, cookie, params);
  const back = new URL(answer.data.location);
  assert.equal(`${back.origin}${back.pathname}`, CLAUDE_CB);
  assert.equal(back.searchParams.get('state'), 'estado-123');
  assert.equal(back.searchParams.get('iss'), ORIGIN);
  const code = back.searchParams.get('code');
  const exchange = (extra = {}) => call('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: client.client_id, ...extra } });
  assert.equal((await exchange({ code_verifier: pkce().verifier })).data.error, 'invalid_grant', 'outro verificador');
  assert.equal((await exchange({ redirect_uri: CLAUDE_COM_CB })).data.error, 'invalid_grant', 'outro endereço de volta');
  const ok = await exchange({ resource: `${ORIGIN}/mcp` });
  assert.equal(ok.status, 200);
  assert.match(ok.data.access_token, /^nexo_at_[A-Za-z0-9_-]{30,}$/);
  assert.match(ok.data.refresh_token, /^nexo_rt_[A-Za-z0-9_-]{30,}$/);
  assert.equal(ok.data.token_type, 'Bearer');
  assert.equal(ok.data.expires_in, 3600);
  assert.equal(ok.data.scope, 'painel');
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const again = await exchange();
  assert.equal(again.status, 400);
  assert.equal(again.data.error, 'invalid_grant', 'código usado duas vezes');
  // Código vencido.
  const second = new URL((await approve(call, cookie, params)).data.location).searchParams.get('code');
  h.tick(61 * 1000);
  assert.equal((await call('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code: second, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: client.client_id } })).data.error, 'invalid_grant');
  assert.equal((await call('POST', '/oauth/token', { form: { grant_type: 'password', username: 'x' } })).data.error, 'unsupported_grant_type');
});

test('renovação: troca o par e reusar o refresh antigo revoga a autorização', async () => {
  const env = h.setup();
  const { call } = env;
  const { client, tokens } = await connect(env);
  const refresh = (token, clientId = client.client_id) => call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: token, client_id: clientId } });
  const other = (await register(call)).data;
  assert.equal((await refresh(tokens.refresh_token, other.client_id)).data.error, 'invalid_grant', 'refresh de outro cliente');
  const next = await refresh(tokens.refresh_token);
  assert.equal(next.status, 200);
  assert.notEqual(next.data.refresh_token, tokens.refresh_token);
  assert.notEqual(next.data.access_token, tokens.access_token);
  const reuse = await refresh(tokens.refresh_token);
  assert.equal(reuse.data.error, 'invalid_grant', 'refresh antigo reusado');
  const grant = await env.env.DB.prepare('SELECT revoked FROM oauth_grants').first();
  assert.equal(grant.revoked, 1, 'reuso revoga a autorização inteira (o /mcp cai também: teste do /mcp)');
  assert.equal((await refresh(next.data.refresh_token)).data.error, 'invalid_grant', 'nem o par novo vale mais');
});

test('token no formato do OAuth (x-www-form-urlencoded) e revogação', async () => {
  const env = h.setup();
  const { call } = env;
  const client = (await register(call)).data;
  const cookie = await env.panelCookie();
  const { verifier, challenge } = pkce(128);
  assert.match(verifier, /^[A-Za-z0-9._~-]{128}$/);
  const code = new URL((await approve(call, cookie, authParams(client.client_id, challenge))).data.location).searchParams.get('code');
  const raw = `grant_type=authorization_code&code=${encodeURIComponent(code)}&code_verifier=${encodeURIComponent(verifier)}&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&client_id=${encodeURIComponent(client.client_id)}&scope=painel+extra`;
  const ok = await call('POST', '/oauth/token', { body: raw, headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const revoked = await call('POST', '/oauth/revoke', { form: { token: ok.data.access_token, client_id: client.client_id } });
  assert.equal(revoked.status, 200);
  const grant = await env.env.DB.prepare('SELECT revoked FROM oauth_grants').first();
  assert.equal(grant.revoked, 1);
  assert.equal((await call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: ok.data.refresh_token, client_id: client.client_id } })).data.error, 'invalid_grant');
  assert.equal((await call('POST', '/oauth/revoke', { form: { token: 'qualquer-coisa' } })).status, 200, 'token desconhecido: 200 (RFC 7009)');
});

/* ---------- O endpoint /mcp ---------- */
let mcpMod;
test.before(async () => { mcpMod = await import('../server/src/mcp.js'); });
const rpc = (call, token, method, params, { id = 1, headers = {} } = {}) => call('POST', '/mcp', { token, headers: { accept: 'application/json, text/event-stream', ...headers }, body: { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) } });
const callTool = async (call, token, name, args = {}) => (await rpc(call, token, 'tools/call', { name, arguments: args })).data.result;
/** Ferramentas só dos testes: eco, uma que falha e uma que exige a permissão "status". */
function testTools() {
  return [
    { name: 'eco', title: 'Eco', description: 'Devolve o texto.', inputSchema: { type: 'object', properties: { texto: { type: 'string' } } }, annotations: { readOnlyHint: true }, run: (args) => ({ eco: args.texto ?? null }) },
    { name: 'falha', title: 'Falha', description: 'Sempre falha.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true }, run: () => { throw new mcpMod.ToolError('Falhou de propósito.'); } },
    { name: 'muda', title: 'Muda', description: 'Precisa de status.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false }, needs: 'status', run: () => ({ ok: true }) }
  ];
}
/** Põe alguém na equipe (pelo painel do dono) e conecta o Claude dessa pessoa. */
async function connectAs(env, email, role) {
  const owner = await env.panelCookie();
  const added = await env.call('POST', '/painel/api/equipe', { cookie: owner, headers: { 'x-nexo-painel': '1' }, body: { email, role } });
  assert.equal(added.status, 200);
  return connect(env, { email });
}

test('mcp: só com token válido; 401 aponta para os metadados (inclusive token vencido e conexão revogada)', async () => {
  const env = h.setup({ extraTools: testTools() });
  const { call } = env;
  assert.equal((await call('GET', '/mcp')).status, 405);
  const none = await rpc(call, null, 'tools/list');
  assert.equal(none.status, 401);
  assert.equal(none.headers.get('www-authenticate'), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  assert.equal((await rpc(call, 'nexo_at_' + 'x'.repeat(43), 'tools/list')).status, 401, 'token inventado');
  const { tokens } = await connect(env);
  assert.equal((await rpc(call, tokens.access_token, 'tools/list')).status, 200);
  assert.equal((await rpc(call, tokens.refresh_token, 'tools/list')).status, 401, 'token de renovação não abre o /mcp');
  h.tick(3601 * 1000);
  const late = await rpc(call, tokens.access_token, 'tools/list');
  assert.equal(late.status, 401, 'vencido: 401 para o Claude renovar sozinho, nunca isError');
  assert.match(late.headers.get('www-authenticate'), /resource_metadata=/);
  // Reuso de renovação revoga a conexão: o acesso novo cai também.
  const { client, tokens: second } = await connect(env);
  const next = (await call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: client.client_id } })).data;
  assert.equal((await rpc(call, next.access_token, 'tools/list')).status, 200);
  await call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: client.client_id } });
  assert.equal((await rpc(call, next.access_token, 'tools/list')).status, 401);
});

test('mcp: protocolo (initialize, versões, ping, lista, chamada, erros do JSON-RPC, Origin)', async () => {
  const env = h.setup({ extraTools: testTools() });
  const { call } = env;
  const { tokens } = await connect(env);
  const t = tokens.access_token;
  const init = await rpc(call, t, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } });
  assert.equal(init.status, 200);
  assert.match(init.headers.get('content-type'), /application\/json/);
  assert.equal(init.data.jsonrpc, '2.0');
  assert.equal(init.data.id, 1);
  assert.equal(init.data.result.protocolVersion, '2025-06-18');
  assert.ok(init.data.result.capabilities.tools);
  assert.equal(init.data.result.serverInfo.name, 'nexo');
  assert.match(init.data.result.instructions, /Nexo/);
  assert.equal((await rpc(call, t, 'initialize', { protocolVersion: '1999-01-01' })).data.result.protocolVersion, '2025-11-25');
  const note = await call('POST', '/mcp', { token: t, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(note.status, 202);
  assert.equal(note.data, '');
  assert.deepEqual((await rpc(call, t, 'ping')).data.result, {});
  const list = (await rpc(call, t, 'tools/list')).data.result.tools;
  const eco = list.find((tool) => tool.name === 'eco');
  assert.equal(eco.inputSchema.type, 'object');
  assert.equal(eco.annotations.readOnlyHint, true);
  assert.equal(eco.run, undefined, 'a função não vaza na lista');
  const result = await callTool(call, t, 'eco', { texto: 'oi' });
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), { eco: 'oi' });
  assert.deepEqual(result.structuredContent, { eco: 'oi' });
  assert.ok(!result.isError);
  const failed = await callTool(call, t, 'falha');
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /Falhou de propósito/);
  assert.equal((await callTool(call, t, 'nao-existe')).isError, true);
  assert.equal((await call('POST', '/mcp', { token: t, body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] })).data.error.code, -32600, 'lote');
  assert.equal((await rpc(call, t, 'resources/list')).data.error.code, -32601);
  assert.equal((await call('POST', '/mcp', { token: t, body: '{quebrado' })).data.error.code, -32700);
  assert.equal((await rpc(call, t, 'ping', undefined, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await rpc(call, t, 'ping', undefined, { headers: { origin: 'https://claude.ai' } })).status, 200);
});

test('mcp: permissões do papel e limite diário por conexão', async () => {
  const env = h.setup({ extraTools: testTools() });
  const { call } = env;
  const owner = await connect(env);
  assert.deepEqual((await callTool(call, owner.tokens.access_token, 'muda')).structuredContent, { ok: true });
  const reader = await connectAs(env, 'leitor@exemplo.com', 'leitura');
  const denied = await callTool(call, reader.tokens.access_token, 'muda');
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /papel/);
  assert.ok(!(await callTool(call, reader.tokens.access_token, 'eco', { texto: 'x' })).isError, 'leitura lê');
  const grant = await env.env.DB.prepare("SELECT grant_id FROM oauth_grants WHERE email = 'leitor@exemplo.com'").first();
  await env.env.DB.prepare('INSERT INTO rate (key, day, count) VALUES (?, ?, 2000) ON CONFLICT(key) DO UPDATE SET day = excluded.day, count = 2000').bind(`mcp:${grant.grant_id}`, new Date(h.clock.now).toISOString().slice(0, 10)).run();
  const limited = await callTool(call, reader.tokens.access_token, 'eco', { texto: 'x' });
  assert.equal(limited.isError, true);
  assert.match(limited.content[0].text, /Limite de hoje/);
  const used = await env.env.DB.prepare('SELECT calls, last_used FROM oauth_grants WHERE grant_id = ?').bind(grant.grant_id).first();
  assert.ok(used.calls >= 1 && used.last_used > 0);
});

/* ---------- Ferramentas de leitura ---------- */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SIGS = ['aaaaaaaaaaaaaaa1', 'bbbbbbbbbbbbbbb2', 'ccccccccccccccc3'];
/** Dados de exemplo: 2 PCs com telemetria, 3 erros (um com o e-mail de quem aceitou). */
async function seed(env) {
  const { call, loginAs } = env;
  const tel = (installId, gpuVendor, effects) => call('POST', '/v1/telemetry', { body: { installId, version: '0.11.3', platform: 'win32', data: { hw: { cpuVendor: 'AMD', gpuVendor, cores: 12, ramGB: 16 }, settings: { effects }, perf: { skyFps: 58 }, usage: { views: { home: 3 } } } } });
  assert.equal((await tel('install-telem-000001', 'AMD', 'lite')).status, 200);
  assert.equal((await tel('install-telem-000002', 'NVIDIA', 'full')).status, 200);
  const person = await loginAs({ email: 'fulano@exemplo.com', sub: 'sub-fulano' });
  const report = (signature, message) => ({ signature, source: 'interface', level: 'erro', message, stack: `TypeError: ${message}\n    at f (view.js:1:1)`, context: '{"tela":"home"}', count: 2, firstAt: h.clock.now - 1000, lastAt: h.clock.now });
  await call('POST', '/v1/errors', { token: person.token, body: { installId: 'install-telem-000001', version: '0.11.3', platform: 'win32', includeEmail: true, reports: [report(SIGS[0], 'Falha ao ler sensores')] } });
  await call('POST', '/v1/errors', { body: { installId: 'install-telem-000002', version: '0.11.3', platform: 'linux', reports: [report(SIGS[1], 'Tela vazia'), report(SIGS[2], 'Canal lento')] } });
}
const READ_TOOLS = [['nexo_resumo', {}], ['nexo_usuarios', { dias: 30 }], ['nexo_erros', {}], ['nexo_erro', { assinatura: SIGS[0] }], ['nexo_telemetria', { dias: 30 }]];

test('ferramentas de leitura com dados de exemplo', async () => {
  const env = h.setup();
  await seed(env);
  const t = (await connect(env)).tokens.access_token;
  const list = (await rpc(env.call, t, 'tools/list')).data.result.tools.map((tool) => tool.name);
  for (const [name] of READ_TOOLS) assert.ok(list.includes(name), name);
  const resumo = (await callTool(env.call, t, 'nexo_resumo')).structuredContent;
  assert.equal(resumo.openErrors, 3);
  assert.ok(resumo.newUsers.days7 >= 2);
  assert.ok(Number.isFinite(resumo.agora));
  assert.equal(resumo.admin, undefined);
  const erros = (await callTool(env.call, t, 'nexo_erros')).structuredContent;
  assert.equal(erros.grupos.length, 3);
  for (const grupo of erros.grupos) { assert.equal(typeof grupo.pcs_com_contato, 'number'); assert.equal(grupo.emails, undefined); }
  assert.equal(erros.grupos.find((grupo) => grupo.signature === SIGS[0]).pcs_com_contato, 1);
  const erro = (await callTool(env.call, t, 'nexo_erro', { assinatura: SIGS[0] })).structuredContent;
  assert.match(erro.group.stack, /TypeError/);
  assert.equal(erro.reports[0].temContato, true);
  assert.equal(erro.reports[0].email, undefined);
  const tele = (await callTool(env.call, t, 'nexo_telemetria', { dias: 30 })).structuredContent;
  assert.equal(tele.installs, 2);
  assert.ok(tele.activeByDay.length >= 1);
  const usuarios = (await callTool(env.call, t, 'nexo_usuarios', { dias: '30' })).structuredContent;
  assert.ok(!('isError' in usuarios));
  assert.ok(usuarios.novosPorDia.length >= 1);
  assert.ok(usuarios.ativosPorDia.length >= 1);
});

test('nenhuma ferramenta devolve e-mail', async () => {
  const env = h.setup();
  await seed(env);
  const t = (await connect(env)).tokens.access_token;
  for (const [name, args] of READ_TOOLS) {
    const result = await callTool(env.call, t, name, args);
    assert.ok(!result.isError, `${name}: ${result.content?.[0]?.text}`);
    assert.doesNotMatch(JSON.stringify(result), EMAIL_RE, name);
  }
});

test('banco vazio: tudo responde, com listas vazias e zeros', async () => {
  const env = h.setup();
  const t = (await connect(env)).tokens.access_token;
  for (const [name, args] of READ_TOOLS.filter(([name]) => name !== 'nexo_erro')) {
    const result = await callTool(env.call, t, name, args);
    assert.ok(!result.isError, `${name}: ${result.content?.[0]?.text}`);
  }
  assert.deepEqual((await callTool(env.call, t, 'nexo_erros')).structuredContent.grupos, []);
  assert.equal((await callTool(env.call, t, 'nexo_telemetria')).structuredContent.installs, 0);
  const missing = await callTool(env.call, t, 'nexo_erro', { assinatura: 'ddddddddddddddd4' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /não encontrado/);
});

test('argumentos com tipo errado viram valores válidos ou um erro claro', async () => {
  const env = h.setup();
  await seed(env);
  const t = (await connect(env)).tokens.access_token;
  const bad = await callTool(env.call, t, 'nexo_erro', { assinatura: 123 });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Assinatura inválida/);
  assert.ok((await callTool(env.call, t, 'nexo_erros', { limite: -5 })).structuredContent.grupos.length <= 1);
  assert.equal((await callTool(env.call, t, 'nexo_erros', { status: 'qualquer' })).isError, true);
  assert.equal((await callTool(env.call, t, 'nexo_telemetria', { dias: 999 })).structuredContent.dias, 120);
  assert.equal((await callTool(env.call, t, 'nexo_usuarios', { dias: 'abc' })).structuredContent.dias, 30);
});

test('nexo_telemetria: listas cortadas em 15 e escolha de partes', async () => {
  const env = h.setup();
  for (let i = 0; i < 20; i += 1) {
    await env.call('POST', '/v1/telemetry', { body: { installId: `install-muitos-${String(i).padStart(6, '0')}`, version: `0.${i}.0`, platform: 'win32', data: { hw: { cpuVendor: 'AMD' } } } });
  }
  const t = (await connect(env)).tokens.access_token;
  const full = (await callTool(env.call, t, 'nexo_telemetria')).structuredContent;
  assert.equal(full.versions.length, 15);
  assert.equal(full.cortado.versions, 20);
  const only = (await callTool(env.call, t, 'nexo_telemetria', { partes: ['cpus'] })).structuredContent;
  assert.deepEqual(Object.keys(only).sort(), ['cpus', 'dias', 'installs', 'reports']);
  assert.ok(JSON.stringify(full).length <= 60000);
});
