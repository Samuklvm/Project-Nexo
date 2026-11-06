/*
 * Escreve config/google-oauth.json na build a partir do segredo GOOGLE_OAUTH_JSON.
 * Aceita o JSON baixado do Google Cloud ({ installed: {...} }) ou só o segredo do cliente (GOCSPX-…): nesse caso
 * o ID do cliente, que é público, vem de config/google-client.json. Nunca imprime o segredo.
 * Uso: node scripts/write-google-oauth.cjs  (lê process.env.GOOGLE_OAUTH_JSON)
 */
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_ID = /^[\w-]+\.apps\.googleusercontent\.com$/;

function publicClientId(root) {
  try { const id = String(JSON.parse(fs.readFileSync(path.join(root, 'config', 'google-client.json'), 'utf8')).clientId || '').trim(); return CLIENT_ID.test(id) ? id : null; } catch { return null; }
}

/** Devolve { installed: { client_id, client_secret } } ou um motivo (sem conteúdo do segredo). */
function buildOAuthConfig(raw, clientId) {
  const text = String(raw || '').replace(/^﻿/, '').trim();
  if (!text) return { error: 'segredo vazio' };
  if (text.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { return { error: 'o segredo parece JSON mas não abre' }; }
    const inner = parsed.installed || parsed.web || parsed;
    const id = String(inner.client_id || inner.clientId || '').trim();
    const secret = String(inner.client_secret || inner.clientSecret || '').trim();
    if (!CLIENT_ID.test(id)) return { error: 'o JSON não tem um client_id do Google' };
    return { config: { installed: { client_id: id, client_secret: secret || undefined } } };
  }
  if (/^GOCSPX-[\w-]{10,}$/.test(text)) {
    if (!clientId) return { error: 'só o segredo do cliente, e config/google-client.json não tem o ID' };
    return { config: { installed: { client_id: clientId, client_secret: text } } };
  }
  return { error: `formato desconhecido (${text.length} caracteres)` };
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const result = buildOAuthConfig(process.env.GOOGLE_OAUTH_JSON, publicClientId(root));
  if (result.error) {
    console.log(`::warning::Login com Google desativado nesta build: ${result.error}.`);
  } else {
    fs.writeFileSync(path.join(root, 'config', 'google-oauth.json'), JSON.stringify(result.config), 'utf8');
    console.log('Login com Google configurado nesta build.');
  }
}

module.exports = { buildOAuthConfig, publicClientId };
