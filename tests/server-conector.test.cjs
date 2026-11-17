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

