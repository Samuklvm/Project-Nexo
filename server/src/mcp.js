/*
 * Endpoint MCP do conector do Claude (POST /mcp): JSON-RPC 2.0 sem estado, sempre respondendo application/json.
 * Spec: docs/superpowers/specs/2026-11-17-conector-claude-design.md
 *
 * A autorização (Bearer nexo_at_…) é conferida a cada pedido pelo oauth.bearer; o papel de quem autorizou decide o
 * que cada ferramenta pode fazer. Erros de ferramenta voltam como resultado com isError (o Claude lê e se corrige);
 * erros de protocolo voltam como erro do JSON-RPC.
 */

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const ALLOWED_ORIGINS = new Set(['https://claude.ai', 'https://claude.com']);
const DAILY_CALLS = 2000;

/** Erro que a ferramenta quer mostrar ao Claude (vira isError com a mensagem). */
export class ToolError extends Error {}

export const INSTRUCTIONS = 'Você está conectado ao servidor do Nexo Device Care, app grátis de manutenção de PCs gamer do Samuel (Windows e Linux). As ferramentas leem métricas, usuários, telemetria anônima e erros agrupados, e marcam erros como corrigidos, abertos ou ignorados. E-mails e dados de conta nunca vêm. Ao marcar um erro como corrigido, informe a versão em que a correção sai. Tudo que você mudar fica registrado no painel, em "O que o Claude fez".';

export function createMcp({ tools, serverVersion, bearer, limit, json, now }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const listed = tools.map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({ name, title, description, inputSchema, ...(outputSchema ? { outputSchema } : {}), annotations: { openWorldHint: false, ...annotations } }));
  const reply = (id, result) => json({ jsonrpc: '2.0', id, result });
  const rpcError = (id, code, message, status = 200) => json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status);
  const toolError = (id, message) => reply(id, { content: [{ type: 'text', text: message }], isError: true });

  async function callTool(env, who, id, params) {
    const tool = byName.get(params?.name);
    if (!tool) return toolError(id, `Ferramenta desconhecida: ${String(params?.name).slice(0, 60)}.`);
    const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
    if (tool.needs && !who.can(tool.needs)) return toolError(id, 'O seu papel no painel não permite isso (quem autorizou o Claude precisa poder mudar o estado dos erros).');
    try { await limit(env, `mcp:${who.grantId}`, DAILY_CALLS); }
    catch (error) { if (error?.status === 429) return toolError(id, `Limite de hoje atingido (${DAILY_CALLS} chamadas por conexão). Volta amanhã.`); throw error; }
    await env.DB.prepare('UPDATE oauth_grants SET calls = calls + 1, last_used = ? WHERE grant_id = ?').bind(now(), who.grantId).run();
    let result;
    try { result = await tool.run(args, { env, who, now }); }
    catch (error) {
      if (error instanceof ToolError) return toolError(id, error.message);
      console.error('nexo-mcp', tool.name, error?.name || 'Error');
      return toolError(id, 'Erro interno ao rodar a ferramenta.');
    }
    return reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
  }

  /** Atende um pedido ao /mcp (o método HTTP e a autorização já vêm conferidos aqui dentro). */
  async function handle(request, env) {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { allow: 'POST' });
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origem recusada.' }, 403);
    let who;
    try { who = await bearer(request, env); }
    catch (error) {
      if (error?.status !== 401) throw error;
      // O Claude lê o cabeçalho, acha os metadados e renova (ou pede autorização de novo) sozinho.
      return json({ error: error.message }, 401, { 'www-authenticate': `Bearer resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource"` });
    }
    const raw = await request.text();
    if (raw.length > 64 * 1024) return rpcError(null, -32600, 'Pedido grande demais.', 413);
    let message;
    try { message = JSON.parse(raw); } catch { return rpcError(null, -32700, 'JSON inválido.', 400); }
    if (Array.isArray(message) || !message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message?.id, -32600, 'Pedido JSON-RPC inválido (lotes não são aceitos).', 400);
    const { id, method, params } = message;
    if (id === undefined) return new Response(null, { status: 202 }); // notificação: nada a responder
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return reply(id, { protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nexo', title: 'Painel do Nexo', version: serverVersion }, instructions: INSTRUCTIONS });
      }
      case 'ping': return reply(id, {});
      case 'tools/list': return reply(id, { tools: listed });
      case 'tools/call': return callTool(env, who, id, params);
      default: return rpcError(id, -32601, `Método não suportado: ${String(method).slice(0, 60)}.`);
    }
  }

  return { handle };
}
