/*
 * OAuth 2.1 do conector do Claude (MCP). Spec: docs/superpowers/specs/2026-11-17-conector-claude-design.md
 *
 *  descoberta   /.well-known/oauth-protected-resource[/mcp] e /.well-known/oauth-authorization-server
 *  registro     POST /oauth/register: registro dinâmico, só com os endereços de volta do Claude
 *
 * Tudo fica no D1; segredos (códigos e tokens) só como hash.
 */
import { randomId } from './crypto.js';
import { text } from './validate.js';

/** Endereços de volta aceitos: só os do Claude (claude.ai e claude.com). */
export const CLAUDE_REDIRECTS = new Set(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback']);
export const SCOPE = 'painel';
const MAX_CLIENTS = 20;

/** Erro no formato do OAuth ({ error, error_description }). */
export class OAuthError extends Error {
  constructor(status, error, description) { super(description); this.status = status; this.error = error; }
}

export function createOAuth({ now, limit, ipKey, json, readJson }) {
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
      scopes_supported: [SCOPE]
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
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_clients').first();
      if ((count?.n || 0) >= MAX_CLIENTS) throw new OAuthError(400, 'invalid_client_metadata', 'Clientes demais registrados. Revogue conexões antigas no painel.');
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

  return { protectedResource, serverMetadata, register, fail };
}
