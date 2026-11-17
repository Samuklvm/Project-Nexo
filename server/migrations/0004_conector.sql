-- Conector do Claude (MCP + OAuth 2.1). Só o Claude se registra (os endereços de volta aceitos são os dele), a
-- autorização sai do painel do criador e os tokens ficam guardados só como hash.

-- Clientes registrados sozinhos (registro dinâmico). Sem autorização nenhuma, somem em 7 dias.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);

-- Código de autorização: 60 s, uso único, preso ao cliente, ao endereço de volta, ao PKCE e a quem autorizou.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  email TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Uma autorização = uma conexão do Claude. Os tokens apontam para ela; revogar a autorização corta todos.
CREATE TABLE IF NOT EXISTS oauth_grants (
  grant_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  email TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  calls INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);

-- Tokens de acesso (1 h) e de renovação (30 dias, trocado a cada uso; reusar um já trocado revoga a autorização).
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- acesso | renovacao
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);

-- O que o Claude mudou pelo conector (aparece no painel, em "O que o Claude fez").
CREATE TABLE IF NOT EXISTS claude_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  grant_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  target TEXT,
  before TEXT,
  after TEXT
);
CREATE INDEX IF NOT EXISTS claude_actions_at ON claude_actions (at);
