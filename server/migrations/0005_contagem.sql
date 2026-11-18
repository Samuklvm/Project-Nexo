-- Contagem exata de usuários: por PC (não por instalação). O servidor nunca vê o identificador do sistema: o app manda
-- SHA-256("nexo-pc-v1|" + id) e aqui só fica HMAC(PC_PEPPER, isso), cortado em 32 hex. Nada aqui se liga à telemetria
-- nem aos relatórios de erro (esses continuam com o código aleatório da instalação).

CREATE TABLE IF NOT EXISTS pcs (
  pc TEXT PRIMARY KEY,                 -- HMAC(PC_PEPPER, código do PC), 32 hex
  first_seen INTEGER NOT NULL,         -- primeiro sinal de vida OU primeiro evento do instalador
  last_seen INTEGER NOT NULL,
  first_version TEXT NOT NULL,
  last_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  first_pulse_day TEXT,                -- primeiro dia em que o app abriu (null = instalou e nunca abriu)
  last_pulse_day TEXT,
  days_active INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0, -- quantas vezes "instalou" (> 1 = reinstalou)
  installed_at INTEGER,
  uninstalled_at INTEGER               -- último "desinstalou" (some se o app abrir de novo depois)
);
CREATE INDEX IF NOT EXISTS pcs_first_pulse ON pcs (first_pulse_day);

-- Um sinal de vida por PC por dia (UTC, o dia do servidor).
CREATE TABLE IF NOT EXISTS pulses (
  pc TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  PRIMARY KEY (pc, day)
);
CREATE INDEX IF NOT EXISTS pulses_day ON pulses (day);

-- Avisos do instalador: instalou, atualizou, desinstalou.
CREATE TABLE IF NOT EXISTS pc_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pc TEXT NOT NULL,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pc_events_at ON pc_events (at);

-- Quem desligou a contagem: só uma soma por dia e por origem, sem código nenhum.
CREATE TABLE IF NOT EXISTS optouts (
  day TEXT NOT NULL,
  origem TEXT NOT NULL,                -- app | instalador
  n INTEGER NOT NULL,
  PRIMARY KEY (day, origem)
);

-- Foto diária dos números (o cron grava a de ontem) e downloads do GitHub (referência imprecisa).
CREATE TABLE IF NOT EXISTS daily_stats (day TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gh_downloads (day TEXT NOT NULL, tag TEXT NOT NULL, total INTEGER NOT NULL, PRIMARY KEY (day, tag));
