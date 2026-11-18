-- Em quais versões cada instalação viu cada erro. O error_reports guarda só a versão MAIS RECENTE de cada
-- (erro, instalação), sobrescrita a cada relatório; a saúde por versão e o alarme de regressão precisam do histórico.
-- Mesma identificação dos relatórios (o código aleatório da instalação): nada novo é ligado a nada.
CREATE TABLE IF NOT EXISTS error_seen (
  signature TEXT NOT NULL,
  install_id TEXT NOT NULL,
  version TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (signature, install_id, version)
);
CREATE INDEX IF NOT EXISTS error_seen_last ON error_seen (last_at);
CREATE INDEX IF NOT EXISTS error_seen_version ON error_seen (version);

-- O que já existe entra com a versão que o relatório tem hoje (o melhor que dá para saber do passado).
INSERT OR IGNORE INTO error_seen (signature, install_id, version, count, first_at, last_at)
  SELECT signature, install_id, version, count, first_at, last_at FROM error_reports;
