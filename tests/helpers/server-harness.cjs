/*
 * Banco de testes do servidor do Nexo: o Worker de verdade rodando no Node, D1 simulado em SQLite, um "Google" com
 * chave RSA de teste e um relógio que os testes controlam. Usado pelos testes do conector do Claude.
 */
const assert = require('node:assert/strict');
const { createD1 } = require('../../server/test/d1-sqlite.cjs');

const ORIGIN = 'https://nexo-api.exemplo.workers.dev';
const CLIENT_ID = '123-teste.apps.googleusercontent.com';
const ADMIN = 'criador@exemplo.com';
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function createHarness() {
  const mod = await import('../../server/src/app.js');
  const google = await import('../../server/src/google.js');
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
  const clock = { now: Date.UTC(2026, 10, 17, 15, 0, 0) };

  async function idToken(claims = {}) {
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'kid-1', typ: 'JWT' })));
    const payload = b64url(Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'sub-1', email: 'pessoa@exemplo.com', email_verified: true, name: 'Pessoa', iat: Math.floor(clock.now / 1000), exp: Math.floor(clock.now / 1000) + 3600, ...claims })));
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, Buffer.from(`${header}.${payload}`)));
    return `${header}.${payload}.${b64url(signature)}`;
  }

  /** Um servidor novo (banco vazio). `options` vai para o createApp (ex.: extraTools nos testes do MCP). */
  function setup(options = {}) {
    google.resetGoogleKeys();
    const env = { DB: createD1(), SESSION_SECRET: 's'.repeat(48), DATA_KEY: 'd'.repeat(48), PC_PEPPER: 'p'.repeat(48), GOOGLE_CLIENT_IDS: CLIENT_ID, ADMIN_EMAILS: ADMIN };
    const fetchImpl = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=20000', 'content-type': 'application/json' } });
    const app = mod.createApp({ fetchImpl, now: () => clock.now, ...options });
    /** Pedido ao Worker: body (JSON), form (x-www-form-urlencoded), token (Bearer), cookie, headers, raw (Response). */
    const call = async (method, path, { body, form, token, cookie, headers = {}, raw = false } = {}) => {
      const init = { method, headers: { ...headers } };
      if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] ??= 'application/json'; }
      if (form !== undefined) { init.body = new URLSearchParams(form).toString(); init.headers['content-type'] = 'application/x-www-form-urlencoded'; }
      if (token) init.headers.authorization = `Bearer ${token}`;
      if (cookie) init.headers.cookie = cookie;
      const response = await app.fetch(new Request(`${ORIGIN}${path}`, init), env, { waitUntil() {} });
      if (raw) return response;
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, data, headers: response.headers };
    };
    const loginAs = async (claims = {}, deviceId = 'pc-aaaaaaaa') => (await call('POST', '/v1/auth/google', { body: { idToken: await idToken(claims), deviceId } })).data;
    /** Cookie do painel de quem tem esse e-mail (dono pelo ADMIN_EMAILS, ou alguém já posto na equipe). */
    const panelCookie = async (email = ADMIN, sub = `sub-${email}`) => {
      const session = await loginAs({ email, sub });
      const link = await call('POST', '/v1/admin/link', { token: session.token });
      assert.equal(link.status, 200, `link do painel para ${email}`);
      const enter = await call('GET', `/painel/entrar?c=${new URL(link.data.url).searchParams.get('c')}`, { raw: true });
      return enter.headers.get('set-cookie').split(';')[0];
    };
    return { env, app, call, loginAs, panelCookie };
  }

  return { mod, setup, idToken, clock, tick: (ms) => { clock.now += ms; }, ORIGIN, ADMIN };
}

module.exports = { createHarness, ORIGIN, ADMIN };
