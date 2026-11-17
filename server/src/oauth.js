/*
 * OAuth 2.1 do conector do Claude (MCP). Spec: docs/superpowers/specs/2026-11-17-conector-claude-design.md
 *
 *  descoberta   /.well-known/oauth-protected-resource[/mcp] e /.well-known/oauth-authorization-server
 *  registro     POST /oauth/register: registro dinâmico, só com os endereços de volta do Claude
 *  autorizar    GET /painel/conectar (página sem dado) → GET /painel/api/conectar/quem e POST /painel/api/conectar,
 *               com o cookie do painel (o pedido sai do próprio site, então o cookie SameSite=Strict vai junto)
 *  token        POST /oauth/token: código + PKCE (S256) ou renovação (trocada a cada uso; reuso revoga tudo)
 *  revogar      POST /oauth/revoke
 *
 * Tudo fica no D1; segredos (códigos e tokens) só como hash.
 */
import { b64url, randomId, sameBytes, sha256Hex, utf8 } from './crypto.js';
import { CONNECT_ERROR, CONNECT_HTML } from './connect-page.js';
import { text } from './validate.js';

/** Endereços de volta aceitos: só os do Claude (claude.ai e claude.com). */
export const CLAUDE_REDIRECTS = new Set(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback']);
export const SCOPE = 'painel';
const MAX_CLIENTS = 20;
const CODE_MS = 60 * 1000;
const ACCESS_MS = 3600 * 1000;
const REFRESH_MS = 30 * 24 * 3600 * 1000;
/** Renovação repetida logo depois de trocada (resposta perdida, duas ao mesmo tempo): par novo, sem revogar. */
const REUSE_GRACE_MS = 60 * 1000;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN = /^nexo_(at|rt)_[A-Za-z0-9_-]{30,80}$/;
/** E-mail mostrado na página de autorização: só as duas primeiras letras (cr…@exemplo.com). */
export const maskEmail = (email) => { const [user, domain] = String(email).split('@'); return `${user.slice(0, 2)}…@${domain || ''}`; };
/** PKCE S256: base64url(SHA-256(verificador)). */
async function s256(verifier) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier)))); }

/** Erro no formato do OAuth ({ error, error_description }). */
export class OAuthError extends Error {
  constructor(status, error, description) { super(description); this.status = status; this.error = error; }
}

export function createOAuth({ now, limit, ipKey, json, readJson, page, adminSession, roleOf, ROLE_NAMES = {}, CAN = {} }) {
  const oauthJson = (data, status = 200) => json(data, status, { 'cache-control': 'no-store', pragma: 'no-cache' });
  const fail = (error) => oauthJson({ error: error.error, error_description: error.message }, error.status);

  /** RFC 9728: de qual servidor de autorização este recurso (o /mcp) depende. */
  function protectedResource(url) {
    return oauthJson({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Painel do Nexo' });
  }

  /** RFC 8414: onde ficam a autorização, o token, o registro e a revogação. */
  function serverMetadata(url) {
    const at = (path) => `${url.origin}${path}`;
    return oauthJson({
      issuer: url.origin,
      authorization_endpoint: at('/painel/conectar'),
      token_endpoint: at('/oauth/token'),
      registration_endpoint: at('/oauth/register'),
      revocation_endpoint: at('/oauth/revoke'),
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true
    });
  }

  /** RFC 7591: o Claude se registra sozinho. Endereço de volta fora da lista do Claude é recusado. */
  async function register(request, env) {
    try {
      await limit(env, `oauthreg:${(await ipKey(request, env)).slice(3)}`, 60);
      const body = await readJson(request);
      const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      if (!uris.length || uris.length > 2 || !uris.every((uri) => typeof uri === 'string' && CLAUDE_REDIRECTS.has(uri))) throw new OAuthError(400, 'invalid_redirect_uri', 'Só o Claude pode se conectar ao painel do Nexo.');
      if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') throw new OAuthError(400, 'invalid_client_metadata', 'Só clientes públicos (PKCE, sem segredo).');
      // Só os clientes SEM conexão contam no limite; passando dele, os mais antigos saem (registro em massa de fora
      // não impede o Claude de verdade de se registrar, e um cliente com conexão autorizada nunca sai).
      const loose = await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_clients WHERE client_id NOT IN (SELECT client_id FROM oauth_grants)').first();
      const excess = (loose?.n || 0) - MAX_CLIENTS + 1;
      if (excess > 0) await env.DB.prepare('DELETE FROM oauth_clients WHERE client_id IN (SELECT client_id FROM oauth_clients WHERE client_id NOT IN (SELECT client_id FROM oauth_grants) ORDER BY created_at, rowid LIMIT ?)').bind(excess).run();
      const clientId = randomId(18);
      const name = text(body.client_name, 60).replace(/[\u0000-\u001f<>]/g, '').trim() || 'Claude';
      const at = now();
      const unique = [...new Set(uris)];
      await env.DB.prepare('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)').bind(clientId, name, JSON.stringify(unique), at).run();
      return oauthJson({ client_id: clientId, client_id_issued_at: Math.floor(at / 1000), client_name: name, redirect_uris: unique, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: SCOPE }, 201);
    } catch (error) {
      if (error instanceof OAuthError) return fail(error);
      if (error?.status === 429) return fail(new OAuthError(429, 'slow_down', error.message));
      if (error?.status === 400 || error?.status === 413) return fail(new OAuthError(400, 'invalid_client_metadata', error.message));
      throw error;
    }
  }

  /* ---------- Autorização (pelo painel) ---------- */

  /** Confere os parâmetros do pedido de autorização; devolve o cliente e os parâmetros limpos. */
  async function checkAuthorize(env, params, origin) {
    const get = (name) => (typeof params[name] === 'string' ? params[name] : '');
    if (get('response_type') !== 'code') throw new OAuthError(400, 'unsupported_response_type', 'Só o fluxo de código é aceito.');
    const clientId = get('client_id');
    const client = CLIENT_ID.test(clientId) ? await env.DB.prepare('SELECT client_id, name, redirect_uris, created_at FROM oauth_clients WHERE client_id = ?').bind(clientId).first() : null;
    if (!client) throw new OAuthError(400, 'invalid_client', 'Cliente desconhecido.');
    let uris = [];
    try { uris = JSON.parse(client.redirect_uris); } catch { uris = []; }
    const redirectUri = get('redirect_uri');
    if (!uris.includes(redirectUri) || !CLAUDE_REDIRECTS.has(redirectUri)) throw new OAuthError(400, 'invalid_request', 'Endereço de volta diferente do registrado.');
    if (get('code_challenge_method') !== 'S256' || !CHALLENGE.test(get('code_challenge'))) throw new OAuthError(400, 'invalid_request', 'PKCE com S256 é obrigatório.');
    const resource = get('resource');
    if (resource && resource !== `${origin}/mcp`) throw new OAuthError(400, 'invalid_target', 'Este servidor só autoriza o próprio /mcp.');
    const state = get('state');
    if (state.length > 500) throw new OAuthError(400, 'invalid_request', 'Estado grande demais.');
    return { client, clientId, redirectUri, challenge: get('code_challenge'), state };
  }

  /** Página de autorização (HTML sem dado nenhum) ou a página de pedido inválido. */
  async function authorizePage(url, env) {
    try { await checkAuthorize(env, Object.fromEntries(url.searchParams), url.origin); }
    catch (error) { if (error instanceof OAuthError) return page(CONNECT_ERROR(error.message), 'text/html; charset=utf-8', 400); throw error; }
    return page(CONNECT_HTML, 'text/html; charset=utf-8');
  }

  /** Quem está autorizando (pela sessão do painel), para a página desenhar o consentimento. */
  async function who(request, env, url) {
    const admin = await adminSession(request, env);
    if (!admin) return json({ error: 'Abra o painel pelo Nexo neste navegador.' }, 401);
    try {
      const { client } = await checkAuthorize(env, Object.fromEntries(url.searchParams), url.origin);
      return json({ email: maskEmail(admin.email), role: admin.role, roleName: ROLE_NAMES[admin.role] || admin.role, client: client.name || 'Claude', registradoHaSegundos: Math.max(0, Math.round((now() - client.created_at) / 1000)) });
    } catch (error) { if (error instanceof OAuthError) return json({ error: error.message }, 400); throw error; }
  }

  /** Autorizar ou recusar: cria o código (60 s) e devolve para onde a página manda o navegador. */
  async function approve(request, env, url) {
    const origin = request.headers.get('origin');
    if (request.headers.get('x-nexo-painel') !== '1' || (origin && origin !== url.origin)) return json({ error: 'Pedido recusado.' }, 403);
    const admin = await adminSession(request, env);
    if (!admin) return json({ error: 'Abra o painel pelo Nexo neste navegador.' }, 401);
    const body = await readJson(request);
    let checked;
    try { checked = await checkAuthorize(env, body, url.origin); }
    catch (error) { if (error instanceof OAuthError) return json({ error: error.message }, 400); throw error; }
    const back = new URL(checked.redirectUri);
    if (checked.state) back.searchParams.set('state', checked.state);
    back.searchParams.set('iss', url.origin);
    if (body.decisao !== 'autorizar') {
      back.searchParams.set('error', 'access_denied');
      return json({ location: back.toString() });
    }
    const code = randomId(32);
    const at = now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, challenge, email, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(await sha256Hex(code), checked.clientId, checked.redirectUri, checked.challenge, admin.email, SCOPE, at + CODE_MS),
      env.DB.prepare('UPDATE oauth_clients SET last_used = ? WHERE client_id = ?').bind(at, checked.clientId)
    ]);
    back.searchParams.set('code', code);
    return json({ location: back.toString() });
  }

  /* ---------- Tokens ---------- */

  /** Corpo do token/revogação: x-www-form-urlencoded (padrão do OAuth) ou JSON. */
  async function readForm(request) {
    if (!/application\/x-www-form-urlencoded/i.test(request.headers.get('content-type') || '')) return readJson(request);
    const raw = await request.text();
    if (raw.length > 8192) throw new OAuthError(400, 'invalid_request', 'Pedido grande demais.');
    return Object.fromEntries(new URLSearchParams(raw));
  }

  /** Um par novo (acesso de 1 h, renovação de 30 dias) para a autorização. */
  async function issue(env, grantId) {
    const access = `nexo_at_${randomId(32)}`;
    const refresh = `nexo_rt_${randomId(32)}`;
    const at = now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(access), grantId, 'acesso', at + ACCESS_MS),
      env.DB.prepare('INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(refresh), grantId, 'renovacao', at + REFRESH_MS)
    ]);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_MS / 1000, refresh_token: refresh, scope: SCOPE };
  }

  /** Revoga uma autorização inteira (todos os tokens dela param de valer). */
  async function revokeGrant(env, grantId) {
    await env.DB.prepare('UPDATE oauth_grants SET revoked = 1, revoked_at = COALESCE(revoked_at, ?) WHERE grant_id = ?').bind(now(), String(grantId || '')).run();
  }

  async function exchangeCode(env, form, origin) {
    const code = String(form.code || '');
    const row = code && code.length <= 80 ? await env.DB.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').bind(await sha256Hex(code)).first() : null;
    if (!row || row.used || row.expires_at < now()) throw new OAuthError(400, 'invalid_grant', 'Código inválido, vencido ou já usado.');
    if (String(form.client_id || '') !== row.client_id) throw new OAuthError(400, 'invalid_grant', 'Código de outro cliente.');
    // Gasta o código ANTES de conferir o resto: tentativa errada (verificador, endereço) também queima o código, e dois
    // pedidos ao mesmo tempo nunca passam os dois.
    const spent = await env.DB.prepare('UPDATE oauth_codes SET used = 1 WHERE code_hash = ? AND used = 0').bind(row.code_hash).run();
    if (!spent?.meta?.changes) throw new OAuthError(400, 'invalid_grant', 'Código já usado.');
    if (form.redirect_uri !== undefined && form.redirect_uri !== row.redirect_uri) throw new OAuthError(400, 'invalid_grant', 'Endereço de volta diferente.');
    const verifier = String(form.code_verifier || '');
    if (!VERIFIER.test(verifier) || !sameBytes(utf8(await s256(verifier)), utf8(row.challenge))) throw new OAuthError(400, 'invalid_grant', 'Verificador PKCE não confere.');
    if (form.resource && form.resource !== `${origin}/mcp`) throw new OAuthError(400, 'invalid_target', 'Este servidor só emite tokens para o próprio /mcp.');
    if (!await roleOf(env, row.email)) throw new OAuthError(400, 'invalid_grant', 'Quem autorizou não está mais no painel.');
    const grantId = randomId(12);
    await env.DB.prepare('INSERT INTO oauth_grants (grant_id, client_id, email, scope, created_at) VALUES (?, ?, ?, ?, ?)').bind(grantId, row.client_id, row.email, row.scope, now()).run();
    return issue(env, grantId);
  }

  async function exchangeRefresh(env, form, origin) {
    const token = String(form.refresh_token || '');
    const row = TOKEN.test(token) ? await env.DB.prepare(`SELECT t.token_hash, t.used, t.expires_at, g.grant_id, g.client_id, g.email, g.revoked
      FROM oauth_tokens t JOIN oauth_grants g ON g.grant_id = t.grant_id WHERE t.token_hash = ? AND t.kind = 'renovacao'`).bind(await sha256Hex(token)).first() : null;
    if (!row || row.revoked) throw new OAuthError(400, 'invalid_grant', 'Renovação inválida ou revogada.');
    if (String(form.client_id || '') !== row.client_id) throw new OAuthError(400, 'invalid_grant', 'Renovação de outro cliente.');
    if (row.expires_at < now()) throw new OAuthError(400, 'invalid_grant', 'Renovação vencida.');
    if (form.resource && form.resource !== `${origin}/mcp`) throw new OAuthError(400, 'invalid_target', 'Este servidor só emite tokens para o próprio /mcp.');
    // Já trocada (used = quando): repetição dentro de 60 s é resposta perdida ou corrida e ganha par novo; depois
    // disso é sinal de roubo e corta a autorização inteira.
    const reused = async (usedAt) => {
      if (usedAt && now() - usedAt <= REUSE_GRACE_MS) return null;
      await revokeGrant(env, row.grant_id);
      throw new OAuthError(400, 'invalid_grant', 'Renovação já usada: a conexão foi revogada por segurança.');
    };
    if (row.used) await reused(row.used);
    else {
      const spent = await env.DB.prepare('UPDATE oauth_tokens SET used = ? WHERE token_hash = ? AND used = 0').bind(now(), row.token_hash).run();
      if (!spent?.meta?.changes) await reused((await env.DB.prepare('SELECT used FROM oauth_tokens WHERE token_hash = ?').bind(row.token_hash).first())?.used);
    }
    if (!await roleOf(env, row.email)) { await revokeGrant(env, row.grant_id); throw new OAuthError(400, 'invalid_grant', 'Quem autorizou não está mais no painel.'); }
    return issue(env, row.grant_id);
  }

  /** POST /oauth/token. */
  async function token(request, env) {
    try {
      await limit(env, `oauthtok:${(await ipKey(request, env)).slice(3)}`, 300);
      const form = await readForm(request);
      const origin = new URL(request.url).origin;
      if (form.grant_type === 'authorization_code') return oauthJson(await exchangeCode(env, form, origin));
      if (form.grant_type === 'refresh_token') return oauthJson(await exchangeRefresh(env, form, origin));
      throw new OAuthError(400, 'unsupported_grant_type', 'Só código de autorização e renovação.');
    } catch (error) {
      if (error instanceof OAuthError) return fail(error);
      if (error?.status === 429) return fail(new OAuthError(429, 'slow_down', error.message));
      if (error?.status === 400 || error?.status === 413) return fail(new OAuthError(400, 'invalid_request', error.message));
      throw error;
    }
  }

  /** POST /oauth/revoke (RFC 7009): revoga a conexão do token; token desconhecido também responde 200. */
  async function revoke(request, env) {
    let form = {};
    try { form = await readForm(request); } catch { form = {}; }
    const value = String(form.token || '');
    if (TOKEN.test(value)) {
      const row = await env.DB.prepare('SELECT grant_id FROM oauth_tokens WHERE token_hash = ?').bind(await sha256Hex(value)).first();
      if (row) await revokeGrant(env, row.grant_id);
    }
    return oauthJson({});
  }

  /**
   * Quem está chamando o /mcp: token de acesso válido, conexão não revogada e quem autorizou ainda no painel (o papel é
   * conferido a cada pedido). Lança { status: 401 } em qualquer outro caso.
   */
  async function bearer(request, env) {
    const header = request.headers.get('authorization') || '';
    const value = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, '').trim() : '';
    const unauthorized = (message) => Object.assign(new Error(message), { status: 401 });
    if (!value.startsWith('nexo_at_') || !TOKEN.test(value)) throw unauthorized('Conecte o Claude ao painel do Nexo.');
    const row = await env.DB.prepare(`SELECT t.expires_at, g.grant_id, g.email, g.revoked FROM oauth_tokens t JOIN oauth_grants g ON g.grant_id = t.grant_id
      WHERE t.token_hash = ? AND t.kind = 'acesso'`).bind(await sha256Hex(value)).first();
    if (!row || row.revoked || row.expires_at <= now()) throw unauthorized('Acesso vencido ou revogado.');
    const role = await roleOf(env, row.email);
    if (!role || !CAN[role]) throw unauthorized('Quem autorizou não está mais no painel.');
    return { grantId: row.grant_id, email: row.email, role, can: (action) => CAN[role].has(action) };
  }

  return { protectedResource, serverMetadata, register, authorizePage, who, approve, token, revoke, revokeGrant, bearer, fail };
}
