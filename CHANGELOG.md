# Histórico de versões · Version history

[Português](#português) · [English](#english)

Notas completas de cada versão / Full release notes: [`docs/releases/`](docs/releases/).

## Português

### 0.11.2: análise profunda
- Novo: análise profunda em Análise (no mínimo 60 s, mais quando precisa): peças entendidas pelo nome (chipset e o que ele permite, geração do processador e caminho de upgrade, velocidade de cada pente pelo código, link PCIe da placa de vídeo e do SSD, porta e taxa do monitor), 30 dias de eventos, o que roda por trás do jogo (jogo, launchers e o próprio Nexo fora da conta), teste de carga com a placa de vídeo acordada, plano para o PC (BIOS, laboratório, acompanhar) e comparação com a análise anterior. Também no Linux.
- Novo: constelação do PC durante a análise (cada peça acende e ganha o nome) e relatório com a carta celeste do PC, nota, placar, termômetros até o limite da peça e as pistas do PCIe.
- Melhoria: reconhecimento de peças do Core 2 ao Core Ultra, Ryzen, Xeon de placas X79/X99, Steam Deck e Snapdragon; placas de vídeo de jogo, de estação de trabalho e integradas; chipsets com prefixo do fabricante; códigos de pente de dezenas de marcas; SSD/HD pelo modelo; placas de rede.
- Melhoria: o botão do painel do criador aparece e some quando a conta entra ou sai da equipe, sem religar a sincronização; as novidades do app ficam só com o que muda para quem usa.
- Correção: o experimento do plano de energia media o plano atual inteiro e só depois o novo (o processador mais quente fazia o novo parecer pior); agora mede em pares intercalados. O laboratório chamava de "piorou" um ajuste com ganho composto positivo quando um teste de peso baixo caía; o veredito agora acompanha o ganho composto e o custo fica anotado.
- Correção: a tabela de resultados do laboratório mostrava "undefined" em quatro colunas.

### 0.11.1: revisão completa
- Novo: relatórios de erro sempre ligados (só os erros de depois da atualização, sem nome de usuário, pastas ou texto digitado); o e-mail da conta Google vai junto e desmarcar em Ajustes tira o e-mail também dos relatórios já enviados. Telemetria e sincronização continuam opcionais.
- Novo: as sessões dizem o que limitou o PC (processador, um núcleo, placa de vídeo por energia, calor, memória de vídeo ou clock baixo, memória, limite de quadros); telemetria com o resumo parcial do dia em curso e o que limitou o PC; registro de erros com ações lentas, travadas, interrupções e a trilha antes de cada erro.
- Novo: painel do criador com usuários novos (sem contar atualizações), o que limita os PCs e visual novo.
- Melhoria: sensores não congelam sem foco; carga da placa pelo núcleo 3D e motivos do clock baixo pelo nvidia-smi; FPS da sessão inteira e "1% baixo" como média do pior 1%; jogos com anticheat reconhecidos; sonda mais leve; régua do clock pelos minutos com carga; aprendizado salvo antes do histórico.
- Melhoria: revisão de segurança e qualidade com SonarCloud, CodeAnt e três auditorias (programas do sistema pelo caminho completo, sem código a partir de texto, política de segurança fechada, login com prazo, regex sem retrocesso, acessibilidade).
- Correção: modo extremo abortava no começo pelo próprio aquecimento; erro antigo do Windows culpava o ajuste seguinte; pico de 1 s de RAM marcava a sessão; registro de erros perdia contagem e podia crescer além do limite; diagnóstico do app não era salvo; servidor aceitava dia futuro e dava erro interno com login malformado; aviso do Linux dizia que o Nexo não envia telemetria.

### 0.11.0: mais espaço e mais leve
- Novo: entrar com a Steam (login oficial; jogos da conta e conquistas pelo servidor, sem chave da pessoa).
- Novo: diagnóstico de rede em Manutenção (DNS, IPv6, proxy, cabo, site de verdade) com correções reversíveis pelo Diário.
- Novo: recursos de cada tela em grupos (Fixados, Leituras, Ferramentas, Ações), cartões maiores e "ver mais".
- Novo: a sincronização leva a cor de destaque e as opções do céu; telemetria com o resumo do dia completo, enviado depois que o dia acaba.
- Melhoria: animações decorativas num relógio único de até 30 quadros e cartões sem desfoque próprio: o modo Completo pesa bem menos na placa de vídeo; o mapa do Início para com o app sem foco.
- Correção: memória do Hardware em "B" e sensores "SmallData"; barra da memória livre invertida; limpezas contando como alteração ativa; programa repetido nos cartões; "-0,0".

### 0.10.0: noite viva
- Novo: céu vivo (estrelas piscando, estrelas cadentes, chuva de meteoros) e vagalumes, com opções em Ajustes > Aparência.
- Novo: sete cores de destaque e tom do céu que acompanha a hora.
- Novo: mais de 30 recursos em cada uma das 12 telas (389 no Windows, 375 no Linux), com busca, filtros e favoritos.
- Novo: janela de novidades depois de cada atualização.
- Melhoria: interface repaginada (vidro, neon, títulos, botões) e um teste que confere os arquivos do instalador.

### 0.9.0: servidor do Nexo (sincronização, erros e telemetria)
- Novo: sincronização entre PCs com o login do Google; cópia criptografada por PC e escolha do que trazer de outro PC.
- Novo: relatórios de erro agrupados (sem nome de usuário nem pastas; e-mail opcional) e telemetria diária anônima, tudo desligado por padrão.
- Novo: registro de erros local em Ajustes e pergunta única na primeira abertura.
- Correção: login com Google nas versões publicadas.

### 0.8.1: correções do teste num PC de verdade
- Correção: limites de aviso e crítico do SSD NVMe apareciam como temperatura; mínimo e máximo "0 °C" viram "—".
- Correção: a conferência do laboratório conta só o que vale neste PC (sem núcleos P/E quando não há) e o espaço de ajustes mostra os números do PC.
- Correção: Atlas com os grupos novos do laboratório, o Raio-X e o teste com reinício.
- Correção: Manutenção mostra a temperatura e o tipo do disco; o Início não usa mais uma temperatura antiga depois de reiniciar o app; notas da atualização sem palavras cortadas.

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

### 0.11.2: deep analysis
- New: deep analysis in Analysis (at least 60 s, longer when it needs to): parts understood by name (the chipset and what it allows, the processor generation and the socket's upgrade path, each memory stick's rated speed from its part number, the PCIe link of the graphics card and the SSD, the monitor's port and refresh rate), 30 days of events, what runs behind the game (the game, launchers and Nexo itself are left out), a load test with the graphics card awake, a plan for the PC (BIOS, lab, keep an eye on) and a comparison with the previous analysis. On Linux too.
- New: the PC constellation during the analysis (each part lights up and gets its name) and a report with the PC's star chart, score, tally, thermometers up to each part's limit and the PCIe lanes.
- Improvement: recognition of parts from Core 2 to Core Ultra, Ryzen, Xeon on X79/X99 boards, Steam Deck and Snapdragon; gaming, workstation and integrated graphics; chipsets with a maker prefix; memory part numbers from dozens of brands; SSD/HDD by model; network adapters.
- Improvement: the creator panel button appears and disappears when the account joins or leaves the team, without turning sync off and on; the app's what's new window only lists what changes for users.
- Fix: the power plan experiment measured the whole current plan first and the new one after (the hotter processor made the new plan look worse); it now measures in interleaved pairs. The lab called a tweak with a positive composite gain "worse" when a low-weight test dropped; the verdict now follows the composite gain and the cost is noted.
- Fix: the lab results table showed "undefined" in four columns.

### 0.11.1: a complete review
- New: error reports always on (only errors from after the update, without user name, folders or typed text); the Google account email goes along and unchecking it in Settings also removes it from reports already sent. Telemetry and sync are still optional.
- New: sessions say what limited the PC (processor, a single core, graphics card by power, heat, video memory or low clock, memory, frame cap); telemetry with the current day's partial summary and what limited the PC; error log with slow actions, freezes, interruptions and the trail before each error.
- New: creator panel with new users (updates do not count), what limits PCs and a new look.
- Improvement: sensors do not freeze out of focus; graphics load from the 3D engine and low-clock reasons from nvidia-smi; FPS for the whole session and "1% low" as the average of the worst 1%; games with anti-cheat recognized; lighter probe; clock ruler from loaded minutes; learning saved before the history.
- Improvement: security and quality review with SonarCloud, CodeAnt and three audits (system programs by full path, no code from text, closed security policy, sign-in with expiry, no-backtracking regex, accessibility).
- Fix: extreme mode aborted at the start because of its own warm-up; an old Windows error blamed the next tweak; a 1 s RAM spike marked the session; the error log lost counts and could grow past its limit; app diagnostics were not saved; the server accepted future days and gave an internal error on malformed sign-in; the Linux notice said Nexo does not send telemetry.

### 0.11.0: more room and lighter
- New: sign in with Steam (official login; account games and achievements through the server, no personal key).
- New: network diagnosis in Maintenance (DNS, IPv6, proxy, cable, real site) with fixes that can be undone from the Journal.
- New: each screen's features in groups (Pinned, Readings, Tools, Actions), bigger cards and "see more".
- New: sync carries the accent color and sky options; telemetry with the full day's summary, sent after the day ends.
- Improvement: decorative animations on a single clock of up to 30 frames and cards without their own blur: Complete mode is much lighter on the graphics card; the Home map stops when the app is out of focus.
- Fix: Hardware memory shown in "B" and "SmallData" sensors; inverted free-memory bar; cleanups counted as active changes; repeated program in cards; "-0.0".

### 0.10.0: living night
- New: living sky (twinkling stars, shooting stars, meteor showers) and fireflies, with options in Settings > Appearance.
- New: seven accent colors and a sky tone that follows the time of day.
- New: more than 30 features on each of the 12 screens (389 on Windows, 375 on Linux), with search, filters and favorites.
- New: what's-new window after each update.
- Improvement: refreshed interface (glass, neon, titles, buttons) and a test that checks the installer files.

### 0.9.0: Nexo server (sync, errors and telemetry)
- New: sync between PCs with Google sign-in; one encrypted copy per PC and you choose what to bring from another PC.
- New: grouped error reports (no user name or folders; optional email) and anonymous daily telemetry, all off by default.
- New: local error log in Settings and a single question on first launch.
- Fix: Google sign-in in published builds.

### 0.8.1: fixes from testing on a real PC
- Fix: NVMe SSD warning and critical limits showed up as temperatures; "0 °C" minimum and maximum now show "—".
- Fix: the lab check counts only what applies to this PC (no P/E cores when there are none) and the settings space shows the PC's numbers.
- Fix: the Atlas has the lab's new groups, the X-ray and the reboot test.
- Fix: Maintenance shows the disk's temperature and type; Home no longer uses an old temperature after the app restarts; update notes no longer cut words.

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
