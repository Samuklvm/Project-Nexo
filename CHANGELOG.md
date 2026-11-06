# Histórico de versões · Version history

[Português](#português) · [English](#english)

Notas completas de cada versão / Full release notes: [`docs/releases/`](docs/releases/).

## Português

### 0.8.0: otimização extrema no último nível
- Novo: laboratório com 71 ajustes ocultos e 393 opções (processador, núcleos, estados ociosos, núcleos híbridos, temperatura, SATA, NVMe, PCIe, Wi-Fi), nove testes (inclusive ritmo de quadros, timer, memória e rede), ordem ABBA, objetivo da sessão, triagem em duas etapas, combinações inéditas, exploração radical e risco alto.
- Novo: Raio-X do PC com 109 ajustes e 309 opções (registro, 30 serviços, plano de energia ativo, rede, navegadores), evidência de cada um, aplicar e reverter pelo Diário; o que reduz a segurança fica recusado.
- Novo: teste com reinício: mede o PC reiniciando sem e com os ajustes (A, B, B, A) e só mantém o que ganhou nos dois lados.
- Melhoria: 180 testes automáticos, com testes de força bruta contra as travas de segurança.
- Novo: leituras em tempo real (painel a cada 1 s, sensores a cada 2 s) sem travar, com a opção "Velocidade das leituras".

### 0.7.1: revisão completa
- Correção: notas da atualização em todos os passos (baixando, baixada, erro); botão "Verificar novamente" com o estado certo.
- Correção: temperatura 0 °C ignorada em todas as fontes e no histórico antigo.
- Correção: sessões duplicadas e gravação travada; mensagens claras na manutenção (UAC recusado, SFC com avisos).
- Correção: serviço de sensores espera o processo fechar ao atualizar ou remover; biblioteca com confirmação ao tirar jogo e aviso de capas que não fica para sempre; CSV com vírgula decimal.
- Correção: acentos dos planos de energia, coluna que vazava em Otimizar, janelas sobrepostas, observador de jogos que se recupera sozinho.
- Melhoria: histórico 60% menor, gráficos sem redesenho excessivo, FPS ligado por padrão quando pronto, serviço de sensores no Diário, textos para o público.

### 0.7.0: temperatura do processador, tudo no mais recente
- Novo: serviço de sensores com o driver PawnIO (Windows) para ler a temperatura do processador e da placa-mãe; instalado com permissão (UAC) e removido na desinstalação.
- Novo: fonte Inter embutida.
- Melhoria: animações refinadas (curva única, uma entrada por página, fundo com inércia).
- Melhoria: Electron 45.2.3, electron-updater 6.8.11, .NET 10, Node 24 e ações do GitHub atualizadas.
- Correção: notas da atualização em HTML cru, bandeiras que viravam letras, temperatura falsa de 0 °C e alerta do Dependabot (minimatch 11).

### 0.6.2: sensores e FPS de volta, biblioteca mais certinha
- Correção: o coletor de sensores voltou ao instalador do Windows (estava fora desde a 0.4.0).
- Correção: PresentMon 2.6.0 embutido, com integridade conferida; o FPS funciona sem baixar nada.
- Correção: planos de energia que vinham vazios em alguns PCs; menu lateral que ficava aberto cobrindo o título.
- Correção: conteúdo extra (DLC) fora da biblioteca; programas da Steam no filtro “Apps”.
- Correção: Atlas lê “Gravar o que aconteceu” do lugar certo; unidade sem letra repetida; atividades repetidas agrupadas; total de conquistas sem conta conectada.
- Mudança: software proprietário (todos os direitos reservados), continua gratuito.

### 0.6.1: Discord oficial e login com Google
- Novo: status do Discord com o app oficial “Nexo Device Care” (ícone, tempo de jogo e botão “Conhecer o Nexo”), sem configuração.
- Novo: login com Google ativado.

### 0.6.0: Linux, página completa do jogo e contas conectadas
- Novo: suporte a Linux (AppImage e .deb) com sensores, sessões, FPS pelo MangoHud, biblioteca Steam/Heroic, perfis de energia e laboratório.
- Novo: página de cada jogo com visão geral, conquistas (com raridade global), novidades e atualizações oficiais e desempenho.
- Novo: capas oficiais (Steam e Microsoft Store) e contas conectadas (Steam deste PC, Steam Web API e Discord).
- Melhoria: modo leve automático, animações pausadas sem foco, leituras espaçadas em segundo plano e custo do Nexo em Ajustes.
- Correção: caixa de consentimento do laboratório, workflow de release, gráfico de FPS, datas quebrando linha, caminhos da Steam e limpeza completa de HTML nos textos da Steam.
- Mudança: removido o cartão da Nintendo.

### 0.5.0: Otimização extrema (beta), biblioteca de jogos e Atlas
- Novo: Otimização extrema (beta), um laboratório autônomo com cópia do plano de energia, ponto de restauração, medição A/B contra o ruído, guardas, recuperação automática e modos assistido e autônomo.
- Novo: biblioteca de jogos (Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot, Rockstar e manuais).
- Novo: sessão automática ao abrir um jogo, bandeja e iniciar com o Windows (opcionais).
- Novo: liberação automática do FPS (Performance Log Users) com reversão no Diário.
- Novo: Atlas de opções (41 itens, com mitos e bloqueios) e conta Google opcional.
- Melhoria: sessões medem a 1 Hz com jogo em tela cheia; elevação centralizada; desinstalação mais completa.
- Dependências: Electron 42.11.16 e electron-builder 26.18.0.

### 0.4.0: Sessões de observação
- Sessões com relatório do que limitou o PC (placa de vídeo, núcleo do processador, memória, calor ou programa em segundo plano), sonda de programas e FPS pelo PresentMon.

### 0.3.0: Catálogo, Diário e perfis
- Catálogo de operações com risco e fontes, Diário com reversão, medição A/B do plano de energia e perfis de uso (Jogos, Trabalho, Geral).

### 0.2.0: Nova interface e motor local
- Interface repaginada, papel de parede do instalador, motor local de análise (rotina, lentidões, culpados, previsão de disco), instalador visual e desinstalação completa.

---

## English

### 0.8.0: extreme optimization at its peak
- New: lab with 71 hidden settings and 393 options (processor, cores, idle states, hybrid cores, thermals, SATA, NVMe, PCIe, Wi-Fi), nine tests (including frame pacing, timer, memory and network), ABBA order, session goal, two-stage screening, novel combinations, radical exploration and high risk.
- New: PC X-ray with 109 settings and 309 options (registry, 30 services, the active power plan, network, browsers), the evidence for each, apply and revert through the Journal; anything that reduces security stays refused.
- New: reboot test: measures the PC restarting without and with the settings (A, B, B, A) and only keeps what won on both sides.
- Improvement: 180 automated tests, including brute-force tests against the safety locks.
- New: real-time readings (dashboard every 1 s, sensors every 2 s) without stutter, with a "Reading speed" option.

### 0.7.1: full review
- Fix: update notes at every step (downloading, downloaded, error); the "Check again" button shows the right state.
- Fix: 0 °C temperature ignored in every source and in old history.
- Fix: duplicated sessions and stuck recordings; clear maintenance messages (declined UAC, SFC with warnings).
- Fix: the sensor service waits for its process to close when updating or removing; the library asks before removing a game and the covers notice no longer stays forever; CSV with decimal comma.
- Fix: power plan accents, a column overflowing in Optimize, overlapping dialogs, a game watcher that recovers on its own.
- Improvement: 60% smaller history, charts without excessive redraws, FPS on by default when ready, sensor service in the Journal, user-facing wording.

### 0.7.0: processor temperature, everything on the latest version
- New: sensor service with the PawnIO driver (Windows) to read processor and motherboard temperature; installed with permission (UAC) and removed on uninstall.
- New: built-in Inter font.
- Improvement: refined animations (single curve, one entrance per page, background with inertia).
- Improvement: Electron 45.2.3, electron-updater 6.8.11, .NET 10, Node 24 and updated GitHub actions.
- Fix: update notes shown as raw HTML, flags turning into letters, a false 0 °C temperature and the Dependabot alert (minimatch 11).

### 0.6.2: sensors and FPS back, a tidier library
- Fix: the sensor collector is back in the Windows installer (it was missing since 0.4.0).
- Fix: PresentMon 2.6.0 bundled, with verified integrity; FPS works without downloading anything.
- Fix: power plans that came back empty on some PCs; a side menu that stayed open over the page title.
- Fix: extra content (DLC) left out of the library; Steam programs moved to the “Apps” filter.
- Fix: the Atlas reads “Record what happened” from the right place; no repeated drive letter; repeated activities grouped; total achievements shown without a connected account.
- Change: proprietary software (all rights reserved), still free.

### 0.6.1: official Discord app and Google sign-in
- New: Discord status with the official “Nexo Device Care” app (icon, playtime and a “Get Nexo” button), no setup needed.
- New: Google sign-in turned on.

### 0.6.0: Linux, full game page and connected accounts
- New: Linux support (AppImage and .deb) with sensors, sessions, FPS through MangoHud, Steam/Heroic library, power profiles and the lab.
- New: a page for every game with overview, achievements (with global rarity), official news and updates, and performance.
- New: official covers (Steam and Microsoft Store) and connected accounts (Steam on this PC, Steam Web API and Discord).
- Improvement: automatic lite mode, paused animations when unfocused, less frequent background readings and Nexo's own cost in Settings.
- Fix: lab consent checkbox, release workflow, FPS chart, wrapping dates, Steam paths and full HTML cleanup of Steam text.
- Change: removed the Nintendo card.

### 0.5.0: Extreme optimization (beta), game library and Atlas
- New: Extreme optimization (beta), an autonomous lab with a copy of the power plan, a restore point, A/B measurement against noise, guards, automatic recovery and assisted and autonomous modes.
- New: game library (Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot, Rockstar and manual entries).
- New: automatic session when a game opens, tray and start with Windows (optional).
- New: automatic FPS access (Performance Log Users) with a revert option in the Journal.
- New: Options Atlas (41 items, with myths and refusals) and an optional Google account.
- Improvement: sessions measure at 1 Hz with a full-screen game; centralized elevation; more complete uninstall.
- Dependencies: Electron 42.11.16 and electron-builder 26.18.0.

### 0.4.0: Observation sessions
- Sessions with a report of what limited the PC (graphics card, a processor core, memory, heat or a background program), a program probe and FPS through PresentMon.

### 0.3.0: Catalog, Journal and profiles
- Catalog of operations with risks and sources, a Journal with revert, A/B measurement of the power plan and usage profiles (Gaming, Work, General).

### 0.2.0: New interface and local engine
- Redesigned interface, installer wallpaper, local analysis engine (routine, slowdowns, culprits, disk forecast), visual installer and complete uninstall.
