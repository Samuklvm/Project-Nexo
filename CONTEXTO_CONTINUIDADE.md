# Contexto de continuidade — Project Nexo

> Arquivo de referência preparado em 28/10/2026 para continuar o trabalho em outro chat. É uma síntese organizada do que foi decidido e feito, não uma transcrição literal nem uma memória automática. Ao retomar, confira o estado atual do repositório e do GitHub antes de agir.

## Como retomar em outro chat

Anexe este arquivo ao novo chat e diga algo como: “Leia este contexto e continue o trabalho no Project Nexo. Confira o estado atual do repositório antes de alterar qualquer coisa.”

O repositório local é `C:\Users\samue\OneDrive\Desktop\Project-Nexo` e o remoto é `https://github.com/Samuklvm/Project-Nexo`.

## Projeto e objetivo do criador

- O Project Nexo é um aplicativo desktop de otimização e cuidados do computador, feito para aprender e evoluir continuamente.
- O criador quer que seja gratuito, honesto e respeitoso com a privacidade. O código é proprietário (todos os direitos reservados, veja LICENSE).
- Ao conversar, usar português brasileiro e um tom próximo e claro. O usuário gosta de aprender visualmente, com demonstrações na tela quando pede isso.
- O usuário autoriza criatividade de design e funcionalidades quando diz que podemos decidir livremente, mas prefere testar uma versão antes de abrir novas frentes grandes.

## Decisões de privacidade e telemetria

- A telemetria local é parte das funções do aplicativo e deve permanecer ativa independentemente da opção de compartilhamento externo.
- Compartilhar telemetria com o criador é opcional, deve vir desativado e só pode começar depois de informar claramente os campos enviados, finalidade, destino, retenção e como retirar o consentimento.
- Na versão 0.1.5, marcar a opção apenas salva a escolha neste computador; o aplicativo não envia telemetria ao criador.
- A tela do instalador deve listar de forma explícita tudo o que o app coleta localmente e informar o tráfego de rede necessário para verificar atualizações públicas do GitHub.
- A preferência de compartilhamento é salva no Registro do Windows em `HKCU\Software\NexoDeviceCare\Privacy\DeveloperTelemetryOptIn`.

## Histórico do Git e releases

- `main` é a branch principal escolhida.
- O usuário decidiu arquivar a antiga `master` e manter `archive/master-legacy` no mesmo commit histórico, localmente e no GitHub; as referências antigas `master`/`origin/master` foram retiradas.
- A versão 0.1.4 foi publicada e o usuário testou o instalador, relatando que funcionou corretamente.
- A versão 0.1.5 foi preparada com melhorias do sistema de atualização do app, trabalho de telemetria local/gráficos e ajustes de interface feitos antes deste histórico.
- A primeira compilação da 0.1.5 falhou repetidamente por avisos/erros do NSIS. As correções finais foram publicadas em `main` e a automação terminou com sucesso.
- Release publicada: https://github.com/Samuklvm/Project-Nexo/releases/tag/v0.1.5
- A release contém `Nexo-Setup-0.1.5.exe` (109 MB), `latest.yml`, o arquivo `.blockmap` e os arquivos-fonte.
- Execução de sucesso do GitHub Actions: https://github.com/Samuklvm/Project-Nexo/actions/runs/40785866821
- Estado confirmado ao escrever esta nota: branch `main`; `HEAD` e tag `v0.1.5` apontavam para `e9cd4e0f816f17c5cf0bf84ea6d420e6e63ecf1d` (`Remove unavailable update check from privacy page`). A cópia de trabalho estava limpa.

## Ajustes técnicos do instalador que destravaram a 0.1.5

- A configuração do NSIS está em `package.json`; o script personalizado está em `installer/installer.nsh`.
- Os textos do instalador usam os códigos de idioma Windows `1046` (Português do Brasil) e `1033` (English).
- O campo longo de privacidade usa um controle de texto multilinha somente para leitura.
- A página de privacidade, suas variáveis e funções de consentimento ficam fora da compilação do desinstalador, que não possui essa tela.
- A página personalizada não deve redefinir `MUI_PAGE_CUSTOMFUNCTION_PRE` nem chamar `${isUpdated}`: isso causou falhas por macro duplicada e plugin indisponível. Na versão que compilou com sucesso, ela aparece também durante atualizações.
- O build bem-sucedido ainda exibiu um aviso de manutenção: `actions/checkout@v4` e `actions/setup-node@v4` foram forçados a rodar com Node.js 24 por causa da descontinuação do Node.js 20. Não impediu a release.
- O log também informou que o executável Electron estava usando o ícone padrão. Isso pode ser melhorado junto da repaginada do instalador/app, se o projeto já tiver um ícone adequado.

## Próximo trabalho pedido

### Repaginar a interface do instalador

O usuário testou o instalador da 0.1.5 e disse que a interface continua feia. Ele quer voltar a esse ponto e criar uma experiência bonita, moderna e sofisticada, com referência visual ao Opera GX.

Requisitos já informados:

- Usar como fundo/referência a imagem que o usuário anexou (`1338277.png`, originalmente em `C:\Users\samue\Downloads\1338277.png`), com personagem anime, flores azuis e céu estrelado.
- Permitir escolher onde instalar.
- Permitir mudar o idioma.
- Ter uma tela clara de privacidade, com a telemetria para terceiros desligada por padrão e a lista completa do que é coletado.
- Manter o fluxo funcional e coerente com o NSIS/electron-builder existente.
- O usuário deu liberdade criativa para incluir detalhes e funções úteis, sem esconder decisões importantes.

Antes de editar, conferir se a imagem original ainda está acessível e como os recursos visuais atuais são fornecidos ao NSIS (por exemplo, `installer/installer-sidebar.bmp`). Preparar uma prévia visual e iterar com o usuário se isso ajudar a validar a direção de design.

### Assinatura digital e confiança do Windows

- O usuário quer resolver os alertas de confiança do Windows por meio de assinatura digital e perguntou como obter um certificado.
- A obtenção de um certificado comercial confiável ainda precisa ser tratada; não assumir que a 0.1.5 foi assinada com um certificado Authenticode confiável só porque o log cita `signtool.exe`.
- Próximo passo é identificar a opção de certificado/fornecedor viável, custo e requisitos atuais, depois configurar o segredo/certificado com segurança no processo de publicação. Nunca pedir que o usuário cole senha/chave privada no chat.

## Preferências de colaboração

- Fazer progresso em tarefas já autorizadas e informar com clareza o que foi mudado e como foi verificado.
- Para mudanças de interface, priorizar resultado visual revisável; o usuário aprende melhor vendo o fluxo.
- Quando o usuário pedir ajuda para publicar, a release é no GitHub.
- Não afirmar que o app é assinado, que coleta dados específicos ou que uma release foi testada sem evidência.
- Evitar pedir novamente autorizações que o usuário já deu para as tarefas em curso. Confirmação é necessária para operações novas, externas ou irreversíveis sem autorização prévia.

## Nota sobre precisão

Este documento reúne as decisões e o estado de projeto relevantes desta conversa. Não contém cada mensagem, imagem em resolução original, credencial, log completo ou detalhe incidental. A conversa original deve continuar na história do Codex enquanto não for excluída; este arquivo serve como referência portátil para um novo chat.

## Versão 0.2.0 — repaginação completa (31/10/2026)

Registro do que foi feito e decidido. Conferir o estado do repositório antes de agir.

### Decisões e arquitetura

- **Interface nova** ("noite estrelada"): `index.html`, `style.css`, `app.js` e módulos em `src/` (`core`, `ui-kit`, `charts`, `store`, `view-*`). Páginas: Início, Análise, Otimizar, Hardware, Manutenção, Atividade, Atualizações, Ajustes. Sem framework e sem etapa de build.
- **Motor de análise** em `src/brain.js` (UMD, testado em `tests/brain.test.cjs` com `npm test`). Aprendizado = estatística simples por hora da semana + episódios + programas recorrentes + confiança ajustada por feedback. Não vender como "IA".
- **Privacidade:** o aprendizado guarda nomes de programas só durante episódios de lentidão. `PRIVACIDADE.md`, `installer/installer.nsh` (texto PT/EN), `installer/AVISOS.txt` e o launcher foram atualizados juntos; manter os quatro sincronizados.
- **Papel de parede:** arquivo em `userData` (via IPC), não mais base64 no `localStorage`. O padrão é `assets/wallpaper.webp` (a arte do instalador; o PNG de 26 MB saiu do pacote, mas continua no histórico do Git).
- **CSP** adicionada ao `index.html` (`script-src 'self'`, sem scripts inline).
- **Limpeza por categorias** (`cleanup:scan`/`cleanup:run`). A limpeza automática continua restrita aos temporários, como no consentimento.
- **Novos recursos no `main.cjs`:** plano de energia (`power:*`), programas de inicialização (`startup:*`), atalhos para o Windows (`system:open-settings`), links permitidos, privacidade no Registro, instância única, AppUserModelID.

### Instalador e desinstalador

- `installer-launcher/`: instalador visual em Electron (portable) que executa o `Nexo-Setup` em modo silencioso. Escreve `DeveloperTelemetryOptIn` antes de instalar, exige aceitar os avisos e tem PT/EN. O Setup NSIS continua sendo o que o `electron-updater` usa.
- `installer.nsh`: `customInit` define `NEXO_KEEP=1` (instalador substituindo versão existente); `customUnInstall` apaga dados, caches, Registro e atalhos **exceto** se `NEXO_KEEP` existir. Silencioso sem `NEXO_PURGE=1` também não apaga. Não foi usado `${isUpdated}`, conforme a lição da 0.1.5.
- **Ajustes → Desinstalar o Nexo** abre um script PowerShell oculto que espera o app fechar, roda o desinstalador com `NEXO_PURGE=1` e limpa MuiCache, UserAssist e Recentes. Lista de alvos em `buildRemovalScript()` (`main.cjs`) e em `customUnInstall`: manter alinhadas.
- Ícone do app: `assets/icon.ico` e `icon.png` (a estrela do logo). Barras laterais do NSIS regeneradas com a arte.

### Não validado em Windows (testar antes de publicar)

Eu só tinha Linux ao escrever isto. Verificado: sintaxe, testes do motor, interface renderizada no navegador (com CSP real) e o fluxo do launcher com ponte simulada. **Não verificado:** compilação do NSIS, execução do Electron, `powercfg`/CIM, o script de remoção em PowerShell, o launcher empacotado e o `/D=` com espaços. Sugestão: criar uma branch, rodar `npm run dist` e testar instalar, atualizar sobre a versão anterior (dados preservados?), desinstalar (nada sobrou?) numa VM antes de criar a tag `v0.2.0`.

### Ideias para depois

Idioma EN no app principal; bandeja do sistema com monitoramento em segundo plano (opt-in, ampliaria a coleta e a lista de rastros a remover); relatório de saúde exportável; assinatura digital (ver seção anterior).

## Versão 0.3.0 — fatia vertical "catálogo, diário e experimento" + refinamento visual (31/10/2026)

Origem: o usuário enviou o `prompt_mestre_otimizador_autonomo.txt` (norte do projeto). Ele manda auditar primeiro, não prometer ganho sem medição, separar diagnóstico, recomendação, autorização, execução, medição e reversão, e **não implementar tudo de uma vez**. Auditoria e plano: `docs/ARQUITETURA.md` (entregáveis 52.01 a 52.18).

- **Catálogo** (`src/catalog.js`): 7 técnicas com mecanismo, risco, reversão, fontes oficiais verificadas (Microsoft Learn/Support) e estado de validação. O teste exige todos os campos. Nada entra no app sem ficha.
- **Diário de alterações** (`src/journal.js`, tela Atividade): antes/depois, risco, autorização, medição e reversão com detecção de conflito. Irreversíveis nunca oferecem reversão.
- **Experimento A/B do plano de energia** (`bench:cpu` no `main.cjs`, `src/experiment.js`, `src/view-experiment.js`): benchmark curto (um e vários núcleos, 3 repetições), compara com o ruído medido. Controle A contra A deu "sem diferença". Bloqueado com CPU ≥ 80% ou temperatura ≥ 88 °C; avisa na bateria; cancelar depois da troca restaura o plano.
- **Interface:** aurora que muda de cor com o Índice (bom/atenção/crítico), foco de luz nos painéis, paralaxe da arte, marcas no anel, números animados, gráficos com revelação e faixas de alerta, mapa do sistema em órbitas, pílula deslizante na barra lateral, cascata de entrada, estados vazios com constelação. Tudo desligado no modo Leve.
- **Privacidade:** diário e benchmark entraram em `PRIVACIDADE.md`, `installer.nsh` (PT/EN), `AVISOS.txt` e no launcher (PT/EN). Manter as quatro fontes sincronizadas.
- **Correção de texto:** `Clear-RecycleBin` esvazia a Lixeira do usuário atual (não "de todos"). `powercfg` pode exigir administrador (documentação antiga): marcado "a validar".

### Próxima fatia sugerida (fase D do prompt)
Sessões de observação com início/fim, relatório da sessão, detecção de jogo por caminho de instalação (sem ler memória) e medição do próprio overhead do Nexo. FPS/frame time só com ETW/PresentMon, após decisão do usuário (ver 52.18).

## Versão 0.4.0 — perfis, sessões de observação e FPS opcional (03/11/2026)

O usuário respondeu às decisões da 0.3.0: (1) o perfil deve ser **escolha entre três opções**; (2) extensões e APIs estão liberadas; (3) seguir com as sessões (fase D do prompt mestre).

- **Perfis** (`src/profiles.js`, `src/view-profile.js`): Jogos, Trabalho e criação, Uso geral. Mudam pesos do índice, ordem das observações (sem alterar a confiança, que é só da evidência), ordem dos achados e dicas. Diálogo na primeira execução e seletor em Ajustes.
- **Sessões** (`src/session.js`, `src/view-sessions.js`): sistema a 1 Hz (CPU total e por núcleo, GPU, memória, temperatura, queda de clock), sonda de programas a cada ~5 s, FPS opcional. Relatório com achados (GPU no limite, um núcleo no limite, memória, térmico, programa em segundo plano, GPU compartilhada, variação de quadros), cada um com evidência, confiança e limites. Sem FPS, nenhum achado afirma queda de quadros. 10 sessões guardadas; exportar e excluir.
- **Detecção de jogo:** só por pasta de biblioteca de jogos (Steam, Epic, GOG, Riot, Xbox etc.) e marcação manual. Nunca lê memória de outro programa. O caminho é usado na hora e não é guardado nem sai do processo principal (testado).
- **Sonda** (`electron/probe.cjs`): PowerShell residente com `GetForegroundWindow` (P/Invoke), CPU por programa e GPU por programa pelo contador `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine`. Mede o próprio custo. Botão **Testar sonda** valida no PC do usuário.
- **PresentMon** (`electron/fps-runner.cjs`, `scripts/fetch-presentmon.cjs`, `third-party/`): licença MIT (Copyright Intel), v2.6.0 conferida, flags 2.x do README oficial (`--process_id`, `--output_stdout`, `--no_console_stats`, `--stop_existing_session`, `--session_name`, `--terminate_on_proc_exit`, `--terminate_existing_session`). Exige grupo “Performance Log Users” ou administrador. **O hash NÃO está fixado**: o script recusa baixar sem ele (cadeia de suprimentos). O usuário pode apontar o próprio `PresentMon.exe`.
- **Privacidade:** sessões e perfil entraram em `PRIVACIDADE.md`, `installer.nsh` (PT/EN), `AVISOS.txt` e no launcher (PT/EN). Exportação agora inclui diário, sessões e perfil. “Apagar aprendizado” inclui as sessões e mantém o diário.

### Não validado em Windows (testar antes de publicar)
O script PowerShell da sonda (compila um tipo com `Add-Type` e consulta CIM), o contador de GPU por programa, o PresentMon real (flags, permissão, anti-cheat), a normalização do `percentCPUUsage` do Electron (assumida como percentual de um núcleo, dividida pelo número de núcleos) e todo o restante da lista da 0.3.0.

### Próximos passos sugeridos
Fixar o hash do PresentMon; rodar “Testar sonda” e uma sessão real num jogo; decidir sobre iniciar sessão automaticamente ao detectar jogo; escolher a próxima técnica para o experimento A/B; integrar os motivos de limitação da GPU do `nvidia-smi`.


## Versão 0.5.0 — Otimização extrema (beta), biblioteca de jogos, Atlas e conta Google (05/11/2026)

Pedidos do usuário: (1) liberar o FPS de forma automática; (2) sessão automática ao detectar jogo + segundo plano, e uma biblioteca estilo Steam com **todos** os jogos e capas; (3) “todas as opções, inclusive as que ninguém usa e as que ninguém tentou”; (4) seção **Otimização extrema (beta)** com aviso claro de risco, autônoma, com pontos de restauração e **ambiente de testes dentro do PC** para testar na hora (“sem presunção ou boatos”); sessões de risco marcadas e avisadas; o app como ecossistema autônomo; (5) **login com Google**.

Combinado com o usuário (honestidade): “inédito” = **nunca testado neste PC**; o motor autônomo só age num **espaço fechado e revisado** de ajustes reversíveis e mede cada ideia; o UAC nunca é contornado; nada de desligar Defender, VBS, Secure Boot, anticheat, proteções térmicas, overclock/undervolt ou ler memória de outro processo (estão no Atlas como “o Nexo não mexe”).

- **Laboratório:** `src/lab.js`, `electron/lab-system.cjs`, `electron/elevate.cjs`, `src/view-lab.js`. Detalhes em ARQUITETURA 52.17. Recuperação na abertura e por `--lab-recover` (RunOnce). `before-quit` cancela e espera a restauração. Durante o laboratório o app pausa as leituras periódicas para não sujar a medição, e `bench:cpu`/`power:set` ficam bloqueados. Novo modo de benchmark `burst` (rajadas de 30 ms após 70 ms parado) mede a resposta do processador.
- **Biblioteca:** `electron/games.cjs` (Steam VDF/ACF + capas em `appcache/librarycache` nos layouts antigo e novo; Epic `.item`; Xbox `MicrosoftGame.config`; GOG/Ubisoft/desinstalações via Registro; jogos manuais), `src/view-library.js`. Caminhos ficam no processo principal (testado). Capas copiadas para `userData/covers`; capas da CDN da Steam são opt-in. A sonda e o observador reconhecem jogos da biblioteca.
- **Segundo plano:** `electron/watcher.cjs` (primeiro plano a cada 3 s, 2 leituras para iniciar, `process.kill(pid, 0)` para detectar o fim), bandeja (`Tray`), iniciar com o Windows (`setLoginItemSettings`, valor `NexoDeviceCare`, `--hidden`), `backgroundThrottling: false` (sessões continuam a 1 Hz com jogo em tela cheia). Preferências em `userData/nexo-settings.json`.
- **FPS automático:** botão e oferta automática ao gravar com FPS; `Add-LocalGroupMember -SID S-1-5-32-559` com o SID do usuário (lido no processo principal); avisa que vale após sair/entrar; Diário com reversão; a desinstalação pelo app oferece desfazer.
- **Atlas:** `src/atlas.js`, `src/view-atlas.js`: 41 itens (7 testados pelo laboratório, 5 ações, 13 guias, 10 mitos, 6 bloqueados) + leitura somente-leitura de XMP, canais de memória, Hz, HAGS, Modo de Jogo, captura e VBS.
- **Conta Google:** `electron/account.cjs`, `src/view-account.js`, `docs/LOGIN_GOOGLE.md`. Loopback + PKCE, escopos mínimos, token revogado, perfil cifrado com `safeStorage`. **Falta o usuário criar o cliente OAuth** (segredo `GOOGLE_OAUTH_JSON` no GitHub). Sem sincronização (exigiria servidor).
- **Desinstalação:** agora remove `Run`, `StartupApproved\Run`, `RunOnce` e os planos “Nexo Lab”/“Nexo — Ajustado” (volta ao Equilibrado se um deles estiver ativo), no NSIS e no script do app.
- **Privacidade:** sincronizada nas quatro fontes (PRIVACIDADE.md, installer.nsh PT/EN, AVISOS.txt, launcher PT/EN).
- **Testes:** 99 passando (8 arquivos).

### Não validado em Windows (testar antes de publicar)
Tudo do laboratório no Windows real (`powercfg` com aliases nos verbos `/qh` e `/setacvalueindex`, saída localizada, ponto de restauração elevado com `-EncodedCommand`, RunOnce, `Get-WinEvent`), o tamanho do texto de privacidade do NSIS (passou de 4 mil caracteres; se a build do NSIS limitar strings em 1024/8192, o texto pode ser cortado — conferir na tela do instalador), `Add-LocalGroupMember` por SID, `app.getFileIcon`, layouts reais do cache de capas da Steam, a bandeja e o início escondido, o login com Google com um cliente real.

### Próximos passos sugeridos
Rodar o laboratório num PC real em modo assistido primeiro; criar o cliente OAuth; fixar o hash do PresentMon; ampliar o espaço do laboratório com medições que não são de CPU (latência de disco com ASPM, testes de GPU) antes de incluir ajustes dessas áreas.

## Versão 0.6.0 — biblioteca completa, contas de jogos, capas oficiais e leveza (05/11/2026)

Pedido: interface ainda mais detalhada e bonita; biblioteca completa com base no PC; conectar Steam, Discord, Xbox e Nintendo; capa REAL de cada jogo; app leve até em PC fraco.

- **Biblioteca** (`src/view-library.js`, `electron/games.cjs`): destaque com `library_hero.jpg` e `logo.png` do cache da Steam (layouts antigo e novo), prateleiras, filtros Instalados / Na conta / Tudo / por loja, página do jogo (tempo de jogo, última vez, tamanho, sessões, gráfico de FPS por sessão). Jogos da conta não instalados aparecem esmaecidos e abrem a instalação na loja (`steam://install/<id>`).
- **Steam** (`electron/steam-account.cjs`): conta deste PC por `loginusers.vdf`, foto do `avatarcache`, tempo de jogo do `localconfig.vdf`. Opcional: chave da Steam Web API (GetOwnedGames) cifrada em `connections.bin`.
- **Capas oficiais** (`electron/covers.cjs`): Steam CDN (capa, arte larga, logo), Microsoft Store `displaycatalog` (Poster/BoxArt pelo StoreId do `MicrosoftGame.config`), arte do titlehub do Xbox, e para outras lojas a busca da Steam com nome **exato**. Sem SteamGridDB (é arte de comunidade). Imagens reduzidas com `nativeImage` (capa 360 px, fundo 1600 px). Sem correspondência = lembrado por 7 dias.
- **Xbox** (`electron/xbox.cjs`): Microsoft identity (consumers, PKCE, `XboxLive.signin`) → XBL → XSTS → perfil + titlehub. Tokens descartados. Exige ID do app no Azure. **Não validado com app real.**
- **Discord** (`electron/discord.cjs`): Rich Presence pelo named pipe local, sem dependência. Exige Application ID + asset `nexo`. Presença muda com sessões (jogo) e laboratório.
- **Nintendo:** sem API oficial; o usuário pediu para tirar o cartão (removido na revisão da 0.6.0).
- **Leveza** (`src/perf.js` e ajustes): `body.idle` pausa animações sem foco; polling 30 s em segundo plano (exceto durante sessão); estrelas cadentes por timer em vez de rAF contínuo; DPR do canvas limitado a 1,5; modo leve automático por `system:tier`; `content-visibility` nos cartões; medidor do custo do Nexo em Ajustes.
- **Configuração:** `config/integrations.json` ou segredo `NEXO_INTEGRATIONS_JSON` (ver `docs/CONEXOES.md`).
- **Testes:** 111 passando (9 arquivos).

### Não validado em Windows
Endpoints reais (Steam CDN novo `shared.cloudflare.steamstatic.com/store_item_assets`, storesearch, displaycatalog, fluxo Xbox), named pipe do Discord, `nativeImage.resize` com as capas reais, leitura do `localconfig.vdf` em contas grandes.

### Revisão da 0.6.0 — página do jogo completa, estilo Steam (05/11/2026)
- `electron/steam-details.cjs`: loja (`appdetails`, pt-BR), novidades e atualizações (`GetNewsForApp`, classifica atualização/anúncio/notícia), conquistas do jogador (`GetSchemaForGame` + `GetPlayerAchievements` + raridade global) com a chave da própria pessoa. Texto da Steam convertido para texto puro; só imagens de `*.steamstatic.com`/`akamaihd.net`. Cache em `userData/details`.
- Página do jogo com abas: Visão geral (descrição, capturas com visualizador, gêneros, desenvolvedora, lançamento, Metacritic, recomendações, requisitos mínimo/recomendado), Conquistas (progresso, desbloqueadas com data, bloqueadas com raridade global, ocultas escondidas), Novidades (atualizações oficiais marcadas), Desempenho.
- CSP: `img-src` passou a aceitar `https://*.steamstatic.com` e `https://steamcdn-a.akamaihd.net` (só imagens; JSON continua só no processo principal).
- Removido o cartão da Nintendo.

### Revisão da 0.6.0 — Linux (05/11/2026)
- `electron/linux.cjs`: unidades (`/proc/mounts` + statfs), sensores (hwmon, thermal, cpufreq, amdgpu) no mesmo formato do sensor-host, processos (`/proc/<pid>/stat`), primeiro plano (`xprop`, com a pasta de trabalho para jogos via Proton), perfis (`powerprofilesctl`), inicialização (`.desktop`), Lixeira freedesktop, limpeza só de arquivos do próprio usuário.
- `electron/lab-linux.cjs` + `LINUX_SPACE` em `src/lab.js`: laboratório com os perfis do power-profiles-daemon (sem root). `electron/mangohud.cjs`: FPS lendo o CSV do MangoHud. Sonda e observador do Linux em Node (`createLinuxProbe`, `createLinuxWatcher`). Discord por socket Unix. `linuxPrivileged` (pkexec) em `electron/elevate.cjs` só para `fstrim` e remover o `.deb`.
- Biblioteca: Steam nativa/Flatpak/Snap e Heroic (Epic/GOG). Atlas com itens por plataforma (`os`). UI com `data-only="win32|linux"` e `Nexo.platform` pelo user agent.
- Empacotamento: AppImage + `.deb` (`build.linux`, `build.deb`), job `release-linux` no CI. Corrigido um YAML inválido no workflow (linhas `run:` com `: ` sem bloco).
- Desinstalação no Linux: apaga dados, caches, autostart e a AppImage, ou `pkexec dpkg -r nexo-device-care`.
- Testes: 120 (10 arquivos), incluindo leitura real de `/proc` e `/sys` nesta máquina Linux de testes.
- Não validado: AppImage/.deb gerados de verdade, bandeja no GNOME, `xprop` com jogos reais, MangoHud real (`log_interval=0`), `journalctl` sem permissão, Heroic com instalações reais.
