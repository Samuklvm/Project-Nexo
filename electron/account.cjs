/*
 * Conta Google (opcional). OAuth 2.0 para apps instalados, do jeito que o Google exige:
 *  - o login acontece no NAVEGADOR padrão da pessoa (nunca numa janela embutida), com PKCE (S256) e "state";
 *  - o retorno chega num servidor de loopback em 127.0.0.1, porta aleatória, que só vive durante o login;
 *  - escopos mínimos: openid, email, profile. Sem acesso offline: o Nexo não guarda tokens do Google.
 *    Depois de ler nome, e-mail e foto, o token de acesso é revogado na hora.
 *  - fica salvo só um perfil local (nome, e-mail, foto), cifrado com o cofre do Windows (safeStorage) quando disponível.
 * As credenciais do cliente OAuth (ID e "segredo", que para apps instalados não é tratado como segredo pelo Google)
 * vêm de config/google-oauth.json na build, de google-oauth.json na pasta de dados, ou das variáveis de ambiente.
 */
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPES = ['openid', 'email', 'profile'];
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const base64url = (buffer) => Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createPkce(randomBytes = crypto.randomBytes) {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

/** Aceita o JSON baixado do Google Cloud ({ installed: {...} }) ou { clientId, clientSecret }. */
function parseClientConfig(value) {
  if (!value || typeof value !== 'object') return null;
  const inner = value.installed || value.web || value;
  const clientId = String(inner.client_id || inner.clientId || '').trim();
  const clientSecret = String(inner.client_secret || inner.clientSecret || '').trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) return null;
  return { clientId, clientSecret: clientSecret || null };
}

function buildAuthUrl({ clientId, redirectUri, challenge, state, loginHint = null }) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' });
  if (loginHint) params.set('login_hint', loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

/** Lê o retorno do navegador; recusa "state" diferente (proteção contra CSRF). */
function parseCallback(url, expectedState) {
  let parsed;
  try { parsed = new URL(url, 'http://127.0.0.1'); } catch { return { error: 'endereço inválido' }; }
  const params = parsed.searchParams;
  if (params.get('error')) return { error: params.get('error') === 'access_denied' ? 'você cancelou o login' : `o Google respondeu: ${params.get('error')}` };
  if (!params.get('code')) return { ignore: true };
  if (params.get('state') !== expectedState) return { error: 'resposta de login não confere (state)' };
  return { code: params.get('code') };
}

function decodeJwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  try { return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
}

/** O id_token veio direto do endpoint de token do Google por TLS; mesmo assim conferimos emissor, público e validade. */
function validateIdToken(payload, clientId, nowMs = Date.now()) {
  if (!payload) return { ok: false, reason: 'sem identidade na resposta' };
  if (!ISSUERS.has(payload.iss)) return { ok: false, reason: 'emissor inesperado' };
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(clientId)) return { ok: false, reason: 'token emitido para outro aplicativo' };
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 < nowMs - 60000) return { ok: false, reason: 'token expirado' };
  if (!payload.sub) return { ok: false, reason: 'conta sem identificador' };
  return { ok: true, profile: { sub: String(payload.sub).slice(0, 64), name: String(payload.name || payload.given_name || 'Conta Google').slice(0, 80), email: String(payload.email || '').slice(0, 120),
    emailVerified: payload.email_verified === true || payload.email_verified === 'true', picture: typeof payload.picture === 'string' && /^https:\/\/[\w.-]+\.googleusercontent\.com\//.test(payload.picture) ? payload.picture : null } };
}

const DONE_PAGE = (ok, message) => `<!doctype html><meta charset="utf-8"><title>Nexo</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#060919;color:#e4eaff;font:16px "Segoe UI",system-ui,sans-serif}main{text-align:center;max-width:42ch}b{display:block;font-size:22px;margin-bottom:8px;color:${ok ? '#6ef2c2' : '#ff7a95'}}</style><main><b>${ok ? 'Pronto!' : 'Não deu certo'}</b>${message}</main>`;

/**
 * Faz o login inteiro. Dependências injetadas para teste: createServer (http), openExternal, fetch.
 * Devolve { profile, avatar } — avatar são os bytes da foto (ou null).
 */
function signIn({ config, createServer, openExternal, fetch, randomBytes = crypto.randomBytes, timeoutMs = 5 * 60 * 1000, now = Date.now }) {
  if (!config?.clientId) return Promise.reject(new Error('O login com Google não foi configurado nesta build.'));
  const pkce = createPkce(randomBytes);
  const state = base64url(randomBytes(24));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer(async (request, response) => {
      const result = parseCallback(request.url, state);
      if (result.ignore) { response.writeHead(404); response.end(); return; }
      const finish = (ok, message) => { response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(DONE_PAGE(ok, message)); };
      if (result.error) { finish(false, `${result.error}. Pode fechar esta aba.`); done(new Error(result.error)); return; }
      try {
        const { port } = server.address();
        const body = new URLSearchParams({ code: result.code, client_id: config.clientId, redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: pkce.verifier });
        if (config.clientSecret) body.set('client_secret', config.clientSecret);
        const tokenResponse = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        const tokens = await tokenResponse.json();
        if (!tokenResponse.ok) throw new Error(tokens.error_description || tokens.error || 'o Google recusou o código');
        const checked = validateIdToken(decodeJwtPayload(tokens.id_token), config.clientId, now());
        if (!checked.ok) throw new Error(checked.reason);
        let avatar = null;
        if (checked.profile.picture) {
          try { const picture = await fetch(checked.profile.picture); if (picture.ok) avatar = Buffer.from(await picture.arrayBuffer()); } catch { /* sem foto */ }
        }
        if (tokens.access_token) fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.access_token }).toString() }).catch(() => {});
        finish(true, 'Você entrou no Nexo. Pode fechar esta aba e voltar ao aplicativo.');
        // O id_token só passa adiante (para o servidor do Nexo, se a pessoa ligar a sincronização); nunca é salvo.
        done(null, { profile: checked.profile, avatar, idToken: typeof tokens.id_token === 'string' ? tokens.id_token : null });
      } catch (error) { finish(false, `${error.message}. Pode fechar esta aba e tentar de novo.`); done(error); }
    });
    const timer = setTimeout(() => done(new Error('o login demorou demais e foi cancelado')), timeoutMs);
    function done(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch { /* já fechado */ }
      if (error) reject(error); else resolve(value);
    }
    server.on('error', (error) => done(error));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      Promise.resolve(openExternal(buildAuthUrl({ clientId: config.clientId, redirectUri: `http://127.0.0.1:${port}`, challenge: pkce.challenge, state }))).catch((error) => done(error));
    });
  });
}


/**
 * Loopback genérico (usado pelo login Microsoft/Xbox): abre o navegador, espera o código no 127.0.0.1/localhost
 * e devolve { code, redirectUri, verifier }. A troca do código fica com quem chamou.
 */
function loopbackAuthorize({ buildUrl, createServer, openExternal, randomBytes = crypto.randomBytes, timeoutMs = 5 * 60 * 1000, host = '127.0.0.1', redirectHost = host, appName = 'Nexo' }) {
  const pkce = createPkce(randomBytes);
  const state = base64url(randomBytes(24));
  return new Promise((resolve, reject) => {
    let settled = false;
    let redirectUri = null;
    const server = createServer((request, response) => {
      const result = parseCallback(request.url, state);
      if (result.ignore) { response.writeHead(404); response.end(); return; }
      response.writeHead(result.error ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(DONE_PAGE(!result.error, result.error ? `${result.error}. Pode fechar esta aba.` : `Conta conectada ao ${appName}. Pode fechar esta aba e voltar ao aplicativo.`));
      if (result.error) done(new Error(result.error)); else done(null, { code: result.code, redirectUri, verifier: pkce.verifier });
    });
    const timer = setTimeout(() => done(new Error('o login demorou demais e foi cancelado')), timeoutMs);
    function done(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch { /* já fechado */ }
      if (error) reject(error); else resolve(value);
    }
    server.on('error', (error) => done(error));
    server.listen(0, host, () => {
      redirectUri = `http://${redirectHost}:${server.address().port}`;
      Promise.resolve(openExternal(buildUrl({ redirectUri, challenge: pkce.challenge, state }))).catch((error) => done(error));
    });
  });
}

module.exports = { loopbackAuthorize, createPkce, parseClientConfig, buildAuthUrl, parseCallback, decodeJwtPayload, validateIdToken, signIn, SCOPES, AUTH_URL, TOKEN_URL };
