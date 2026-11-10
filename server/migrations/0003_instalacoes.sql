-- Instalações vistas pelo servidor: quando cada código aleatório de PC apareceu pela primeira vez (telemetria ou
-- relatório de erro). É isso que conta "usuários novos" no painel: atualizar o app não cria uma instalação nova
-- (o código fica nos dados do app), então não infla como contar downloads. Nada pessoal: só o código, datas,
-- versão e sistema. Some depois de 400 dias sem aparecer.
CREATE TABLE IF NOT EXISTS installs (
  install_id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  first_version TEXT NOT NULL,
  last_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  via TEXT NOT NULL              -- telemetria | erros (por onde apareceu primeiro)
);
CREATE INDEX IF NOT EXISTS installs_first ON installs (first_seen);

-- Instalações que já mandavam algo antes desta tabela existir entram com a data mais antiga conhecida.
INSERT OR IGNORE INTO installs (install_id, first_seen, last_seen, first_version, last_version, platform, via)
  SELECT install_id, MIN(received_at), MAX(received_at), MIN(version), MAX(version), MAX(platform), 'telemetria' FROM telemetry GROUP BY install_id;
INSERT OR IGNORE INTO installs (install_id, first_seen, last_seen, first_version, last_version, platform, via)
  SELECT install_id, MIN(first_at), MAX(last_at), MIN(version), MAX(version), MAX(platform), 'erros' FROM error_reports GROUP BY install_id;

-- E-mail dos relatórios: 1 = veio da sessão do servidor (confirmado pelo Google); 0 = informado pelo app (conta Google
-- entrada no Nexo, sem a sincronização ligada).
ALTER TABLE error_reports ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;

-- Resumo de hoje ainda aberto (parcial) até o dia acabar e o completo chegar.
ALTER TABLE telemetry ADD COLUMN partial INTEGER NOT NULL DEFAULT 0;
