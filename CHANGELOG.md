# Histórico de versões · Version history

[Português](#português) · [English](#english)

Notas completas de cada versão / Full release notes: [`docs/releases/`](docs/releases/).

## Português

### 0.11.5: drivers do fabricante do seu PC
- Aviso: esta versão ainda não tem assinatura digital; a assinatura chega numa atualização futura. O aviso e os passos para abrir o Nexo continuam nas notas e no README.
- Novo: drivers oficiais do fabricante do PC na página de Drivers (Windows): o Nexo identifica o modelo exato (Dell pelo código do sistema, HP pelo código da placa, Lenovo pelo tipo de máquina, ASUS pelo modelo) e lê a lista oficial da Dell, HP, Lenovo e ASUS/ROG; cada pacote que serve para uma peça vira um cartão "Pacote oficial" com Baixar, escolhido pelo código de hardware mais específico; peças sem driver ou com o driver básico do Windows viram atualização; vídeo continua sempre com NVIDIA/AMD/Intel; BIOS nova só vira aviso com a página de suporte; MSI, GIGABYTE, ASRock e Acer abrem a página de suporte; a lista é lida em segundo plano e o topo mostra o PC, quando a lista foi conferida e quando a fonte está fora do ar ou o modelo não tem lista.
- Melhoria: sem chute pela idade do driver: sem versão publicada pelo fabricante, o cartão diz "Confira no site"; o título do topo conta só o que o app sabe, cada peça uma vez.
- Melhoria: instalação mais segura: ponto de restauração só depois de conferir o pacote; listas da Dell e da HP só abertas com a assinatura do fabricante; só HTTPS e servidores oficiais exatos (também depois de redirecionar); .zip e .cab abertos numa pasta só de administrador, com o instalador assinado pelo fabricante do PC ou da peça, e sem instalador só com o catálogo (.cat) todo assinado; o arquivo instalado é conferido contra o baixado (SHA-256); quando o Windows já usa um driver igual ou mais novo, o app diz que nada mudou.
- Melhoria: a lista de fontes dos fabricantes fica no GitHub (docs/drivers/fontes.json), com cópia no app, para desligar uma fonte sem lançar versão nova; vigia novo "fonte-de-driver" avisa o criador quando a lista de um fabricante falha (no máximo uma vez por fonte por dia).

### 0.11.4: flores, código aberto e drivers com um clique
- Aviso: esta versão ainda não tem assinatura digital; a assinatura já foi pedida e chega numa atualização futura. O aviso e os passos para abrir o Nexo continuam nas notas e no README.
- Novo: o Nexo é código aberto, sob a GPL-3.0 (LICENSE e NOTICE.md); nome e ícone reservados à versão oficial; pull requests aceitos com os termos de contribuição.
- Novo: fundo animado do app, um campo de flores azuis que brilham sob o céu do Nexo (capim, pétalas no vento e vaga-lumes), tocado pela placa de vídeo; pausa fora de foco e fica parado no Modo Leve, com movimento reduzido ou com papel de parede próprio. Os instaladores ganharam a mesma arte, original do projeto.
- Novo: drivers com um clique na página de Drivers (Windows): o botão Baixar pega o arquivo oficial certo para a peça e o PC (NVIDIA para desktop ou notebook, Visual C++, DirectX 9 e .NET), com barra de progresso, cancelar, fila de até 4 downloads ao mesmo tempo e retomada se a internet cair; confere a assinatura do fabricante (e o código de conferência no .NET) antes de liberar; Instalar abre o instalador oficial, um de cada vez, com ponto de restauração opcional numa chave no topo da página; Reinstalar para placa NVIDIA em dia. Nunca pelo Windows Update.
- Novo: contagem de uso anônima, ligada por padrão (Ajustes > Privacidade e dados e nos dois instaladores): uma vez por dia o app avisa que este PC abriu, com um código do PC embaralhado (o identificador do sistema nunca sai do PC; reinstalar conta como o mesmo PC); desligar manda um único "+1 desligou" sem código; o instalador avisa instalou, atualizou e desinstalou sem travar a instalação; seção nova "Contagem de uso" na política de privacidade.
- Melhoria: relatórios de erro opcionais, ligados por padrão (Ajustes > Privacidade e dados); ao religar, só vai o que acontecer depois.
- Melhoria: a política de privacidade diz que o criador usa um assistente de IA (Claude, da Anthropic) para analisar a telemetria e os relatórios de erro, sem e-mails nem dados de conta.
- Melhoria: vigias de erro: os relatórios de erro (mesmo interruptor, ligado por padrão) passam a levar avisos de coisas funcionando de um jeito estranho (leitura impossível, sensores que somem, fonte de dados falhando, abertura lenta, céu lento, memória alta acima de 1,5 GB e contagem recusada pelo servidor), uma vez por abertura cada, só números e nomes fixos; só os avisos de depois de a 0.11.4 abrir; seção nova "Vigias de erro" na política de privacidade.
- Correção: o mapa do sistema dava erro quando a tela ainda não tinha tamanho; o cartão "Segundo plano durante os jogos" quebrava em sessões com um programa pesando por trás; no Linux, "Ver processos" abre o monitor do sistema da área de trabalho (GNOME, KDE, Xfce, MATE, LXDE ou Qt) e, sem nenhum, avisa em vez de dar erro, também pela paleta de comandos.
- Melhoria: revisão do SonarCloud (expressões regulares sem retrocesso na página de Drivers e na análise, promessas tratadas, sementes dos testes de desempenho em inteiro, script de desenvolvimento que só grava na pasta atual).
- Servidor: conector do Claude para o painel do criador (MCP com login pelo painel), com cartões "Conexões do Claude" e "O que o Claude fez" na aba Equipe e acessos; abas Usuários e Versões no painel, com o funil de downloads e usuários e a saúde por versão; cartão Vigias no painel e nexo_vigias e avisosAbertos no conector; "PCs com erro" conta só erros.

### 0.11.3: análise e otimização
- Novo: Análise e otimização numa tela só. Cada achado que pede ação tem um botão (ajuste automático, BIOS guiada com reinício direto nela, driver oficial, correções de rede, Gerenciador de Tarefas ou passo a passo).
- Novo: verificação completa de no mínimo 10 minutos: teste de estabilidade da memória, placa de vídeo sob carga, gravação real no disco, drivers por função, 30 dias de eventos com o código de cada tela azul e o tipo de cada desligamento, um minuto de rede, observação estendida, carga no processador e os erros registrados durante os próprios testes.
- Novo: causa provável das telas azuis, desligamentos e travadas, cruzando todas as pistas (memória, placa de vídeo, driver, disco, processador, fonte ou calor), com "Por que eu acho isso" e o botão certo.
- Novo: Otimizar este PC. Plano para este PC (jogo escolhido, inclusive Roblox; rede; energia; o que abre com o Windows; ajustes do sistema), uma permissão só do Windows com ponto de restauração, medição antes e depois, desfaz sozinho o que piorar e confere depois do reinício o que só vale depois de reiniciar. Tudo no Diário com "Reverter".
- Novo: página de Drivers no lugar de Otimizar: cada driver com o ícone oficial do fabricante, para que serve, instalado e mais recente (NVIDIA e .NET consultados nas fontes oficiais), estado e botão para o site oficial; também Visual C++, DirectX 9, .NET, Vulkan, PhysX, dispositivos sem driver e todos os outros dispositivos. Nunca pelo Windows Update.
- Novo: a Análise vira o espaço: céu animado (Full HD ou 4K, conforme a tela e a placa de vídeo), nebulosa, aurora, Via Láctea, constelações de verdade e estrelas de quatro pontas; a constelação reage à otimização.
- Melhoria: Limpeza segura, Plano de energia e Início com o sistema foram para a Manutenção.
- Correção: o botão do assistente de drivers da Intel não abria a página.

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

### 0.11.5: drivers from your PC maker
- Notice: this version is not digitally signed yet; the signature arrives in a future update. The notice and the steps to open Nexo stay in the notes and in the README.
- New: official drivers from the PC maker on the Drivers page (Windows): Nexo identifies the exact model (Dell by system ID, HP by board ID, Lenovo by machine type, ASUS by model) and reads the official list from Dell, HP, Lenovo and ASUS/ROG; every package that fits a part becomes an "Official package" card with Download, picked by the most specific hardware ID; parts with no driver or with Windows' basic driver become updates; graphics always stay with NVIDIA/AMD/Intel; a newer BIOS is only a notice with the support page; MSI, GIGABYTE, ASRock and Acer open the support page; the list loads in the background and the top shows the PC, when the list was checked and when the source is down or the model has no list.
- Improvement: no guessing from the driver's age: with no version published by the maker, the card says "Check the website"; the headline only counts what the app knows, each part once.
- Improvement: safer installs: restore point only after the package is checked; Dell and HP lists only opened with the maker's signature; HTTPS and exact official servers only (also after redirects); .zip and .cab opened in an admin-only folder, with the installer signed by the PC or part maker, and with no installer only when the whole catalog (.cat) is signed; the installed file is checked against the downloaded one (SHA-256); when Windows already uses the same or a newer driver, the app says nothing changed.
- Improvement: the maker source list lives on GitHub (docs/drivers/fontes.json), with a copy in the app, so a source can be switched off without a new release; new "fonte-de-driver" watcher tells the creator when a maker's list fails (at most once per source per day).

### 0.11.4: flowers, open source and one-click drivers
- Notice: this version is not digitally signed yet; the signature has been requested and arrives in a future update. The notice and the steps to open Nexo stay in the notes and in the README.
- New: Nexo is open source, under the GPL-3.0 (LICENSE and NOTICE.md); name and icon reserved for the official version; pull requests accepted under the contribution terms.
- New: animated app background, a field of glowing blue flowers under Nexo's sky (grass, petals in the wind and fireflies), played by the graphics card; it pauses out of focus and stays still in Lite mode, with reduced motion or with your own wallpaper. The installers got the same art, original to the project.
- New: one-click drivers on the Drivers page (Windows): the Download button gets the right official file for the part and the PC (NVIDIA for desktop or laptop, Visual C++, DirectX 9 and .NET), with a progress bar, cancel, a queue of up to 4 downloads at a time and resume if the internet drops; it checks the maker's signature (and the checksum for .NET) before handing it over; Install opens the official installer, one at a time, with an optional restore point set by a switch at the top of the page; Reinstall for an up-to-date NVIDIA card. Never through Windows Update.
- New: anonymous usage count, on by default (Settings > Privacy and data and both installers): once a day the app reports that this PC opened, with a scrambled PC code (the system identifier never leaves the PC; reinstalling counts as the same PC); turning it off sends a single "+1 turned off" with no code; the installer reports install, update and uninstall without holding up the installation; new "Usage count" section in the privacy policy.
- Improvement: optional error reports, on by default (Settings > Privacy and data); when turned back on, only what happens afterwards is sent.
- Improvement: the privacy policy states that the creator uses an AI assistant (Claude, by Anthropic) to analyze telemetry and error reports, never emails or account data.
- Improvement: error watchers: error reports (same switch, on by default) now also carry warnings about things working in a strange way (impossible reading, sensors that disappear, a failing data source, slow launch, slow sky, memory above 1.5 GB and a usage count refused by the server), once per launch each, with only numbers and fixed names; only warnings from after 0.11.4 opens; new "Error watchers" section in the privacy policy.
- Fix: the system map errored when the screen had no size yet; the "Background during games" card broke on sessions with a program weighing on the PC in the background; on Linux, "View processes" opens the desktop's system monitor (GNOME, KDE, Xfce, MATE, LXDE or Qt) and, with none, shows a notice instead of an error, also from the command palette.
- Improvement: SonarCloud review (regular expressions without backtracking on the Drivers page and in the analysis, handled promises, benchmark seeds as integers, a development script that only writes to the current folder).
- Server: Claude connector for the creator panel (MCP with sign-in through the panel), with "Claude connections" and "What Claude did" cards in the Team and access tab; Users and Versions tabs in the panel, with the downloads and users funnel and health by version; Watchers card in the panel and nexo_vigias and avisosAbertos in the connector; "PCs with errors" counts only errors.

### 0.11.3: analysis and optimization
- New: Analysis and optimization on one screen. Every finding that needs action has a button (automatic tweak, guided BIOS steps with a restart straight into it, official driver, network fixes, Task Manager or step by step).
- New: a complete check of at least 10 minutes: memory stability test, graphics card under load, a real disk write, drivers by role, 30 days of events with each blue screen's code and the kind of each shutdown, one minute of network, longer observation, processor load and the errors logged during the tests themselves.
- New: probable cause of blue screens, shutdowns and freezes, crossing every clue (memory, graphics card, driver, disk, processor, power supply or heat), with "Why I think so" and the right button.
- New: Optimize this PC. A plan for this PC (chosen game, Roblox included; network; power; what starts with Windows; system tweaks), a single Windows permission with a restore point, measurement before and after, automatic undo of whatever got worse and, after the restart, a check of what only applies after restarting. Everything in the Journal with "Revert".
- New: Drivers page in place of Optimize: each driver with the manufacturer's official icon, what it is for, installed and latest version (NVIDIA and .NET checked at the official sources), status and a button to the official site; also Visual C++, DirectX 9, .NET, Vulkan, PhysX, devices without a driver and every other device. Never through Windows Update.
- New: the Analysis becomes space: an animated sky (Full HD or 4K, depending on the screen and the graphics card), nebula, aurora, Milky Way, real constellations and four-point stars; the constellation reacts to the optimization.
- Improvement: Safe cleanup, Power plan and Startup moved to Maintenance.
- Fix: the Intel driver assistant button did not open the page.

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
