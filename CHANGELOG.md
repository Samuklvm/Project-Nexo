# Histórico de versões · Version history

🇧🇷 [Português](#-português) · 🇺🇸 [English](#-english)

Notas completas de cada versão / Full release notes: [`docs/releases/`](docs/releases/).

## 🇧🇷 Português

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

## 🇺🇸 English

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
