# Histórico de versões

Notas completas de cada versão em [`docs/releases/`](docs/releases/).

## 0.5.0 — Otimização extrema (beta), biblioteca de jogos e Atlas
- Novo: Otimização extrema (beta) — laboratório autônomo com clone do plano de energia, ponto de restauração, A/B contra o ruído, guardas, recuperação automática e modos assistido/autônomo; sessões de risco marcadas.
- Novo: biblioteca de jogos (Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot, Rockstar e manuais).
- Novo: sessão automática ao abrir um jogo, bandeja e iniciar com o Windows (opcionais).
- Novo: liberação automática do FPS (Performance Log Users) com reversão no Diário.
- Novo: Atlas de opções (41 itens, com mitos e bloqueios) e conta Google opcional.
- Melhoria: sessões medem a 1 Hz com jogo em tela cheia; elevação centralizada; desinstalação mais completa.
- Correção: YAML inválido no workflow de release.
- Dependências: Electron 42.11.16 e electron-builder 26.18.0.

## 0.4.0 — Sessões de observação
- Sessões com relatório do que limitou o PC (GPU, núcleo da CPU, memória, calor ou programa em segundo plano), sonda de programas e FPS pelo PresentMon (opcional, com hash fixado).

## 0.3.0 — Catálogo, Diário e perfis
- Catálogo de operações com risco e fontes, Diário com reversão, medição A/B do plano de energia e perfis de uso (Jogos, Trabalho, Geral).

## 0.2.0 — Nova interface e motor local
- Interface repaginada, papel de parede do instalador, motor local de análise (rotina, lentidões, culpados, previsão de disco), instalador visual e desinstalação completa.
