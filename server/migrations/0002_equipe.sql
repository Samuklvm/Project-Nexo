-- Equipe do painel (além do dono, que vem do segredo ADMIN_EMAILS) e chaves de acesso para ferramentas.
CREATE TABLE IF NOT EXISTS team (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL,            -- colaborador | leitura
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

-- Chaves para automações (ex.: copiar os erros abertos para um repositório privado). Só o hash fica guardado.
CREATE TABLE IF NOT EXISTS tool_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,           -- erros:ler
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);
