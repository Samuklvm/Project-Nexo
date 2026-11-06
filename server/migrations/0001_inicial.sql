-- Servidor do Nexo: contas (só para sincronizar), cópias de cada PC (criptografadas), erros agrupados e telemetria diária.

-- Conta = login do Google. Guardamos o identificador do Google (sub), o e-mail e o nome, nada mais.
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- Sessões do app (o token do Nexo, não o do Google). Dá para revogar uma por uma.
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_uid ON sessions (uid);

-- Uma cópia por PC de cada conta. Nome do PC e dados ficam criptografados (AES-256-GCM, chave própria da conta).
CREATE TABLE IF NOT EXISTS snapshots (
  uid TEXT NOT NULL,
  device_id TEXT NOT NULL,
  name_enc TEXT NOT NULL,
  data_enc TEXT NOT NULL,
  sections TEXT NOT NULL,
  size INTEGER NOT NULL,
  app_version TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, device_id)
);

-- Erros agrupados pela assinatura (a mesma do registro local do app). Status para o painel: aberto / corrigido / ignorado.
CREATE TABLE IF NOT EXISTS error_groups (
  signature TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  context TEXT,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberto',
  fixed_in TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS error_groups_last ON error_groups (last_at);

-- Quem viu cada erro (por instalação), com o e-mail de quem estava logado e aceitou mandar, para avisar da correção.
CREATE TABLE IF NOT EXISTS error_reports (
  signature TEXT NOT NULL,
  install_id TEXT NOT NULL,
  email TEXT,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (signature, install_id)
);
CREATE INDEX IF NOT EXISTS error_reports_last ON error_reports (last_at);

-- Telemetria: no máximo um pacote por instalação por dia. Sem e-mail, sem conta: só um código aleatório do PC.
CREATE TABLE IF NOT EXISTS telemetry (
  install_id TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  data TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (install_id, day)
);
CREATE INDEX IF NOT EXISTS telemetry_day ON telemetry (day);

-- Limites por dia (evita abuso e mantém o plano grátis).
CREATE TABLE IF NOT EXISTS rate (
  key TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  count INTEGER NOT NULL
);

-- Entrada no painel: link de uso único (60 s) gerado pelo app do criador; vira um cookie de 8 horas.
CREATE TABLE IF NOT EXISTS admin_links (
  code TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  sid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
