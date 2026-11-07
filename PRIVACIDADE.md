# Privacidade do Nexo Device Care

## Resumo

O Nexo é gratuito. O código é proprietário (veja LICENSE). A coleta e o processamento locais são ativos para alimentar os recursos do app e ficam no computador.

O Nexo tem um servidor que serve para a sincronização de contas, a coleta de erros e a telemetria, que é opcional e vem desativada por padrão. Para que o app possa melhorar cada vez mais, eu peço que você deixe a opção ligada. Ela gera a telemetria apenas uma vez por dia, então é inofensiva, e não puxa nada pessoal: só o que ajuda a entender como o app se comporta em outras máquinas, para podermos melhorar o Nexo. Cada parte (sincronização, relatórios de erro e telemetria) liga e desliga separada; o inventário completo está em [Servidor do Nexo](#servidor-do-nexo-opcional-e-desligado-por-padrão). Não há anúncios.

## Coleta local (ativa)

A coleta local é parte do funcionamento do Nexo e não depende do consentimento para compartilhamento externo. Os dados abaixo permanecem no computador.

## Dados processados neste computador

- **Painel:** nome do computador, tipo/versão do Windows, versão do app, tempo ligado, percentual de CPU, memória RAM total/livre/usada, indicador local de conectividade (sim/não) e espaço total/livre/usado das unidades fixas, incluindo letra, rótulo e sistema de arquivos. Endereços de rede são examinados apenas localmente para calcular o indicador e não são guardados nem enviados pelo Nexo.
- **Sensores:** leituras disponibilizadas localmente pela biblioteca aberta LibreHardwareMonitorLib 0.9.6: CPU, GPU AMD/NVIDIA/Intel, memória, placa-mãe, armazenamento, rede, bateria, fonte, medidores de energia e controladores compatíveis. Conforme o hardware, podem incluir temperatura, tensão, corrente, potência, clock, frequência, carga, ventoinha, fluxo, nível, dados, transferência, duração, latência, energia, ruído, condutividade e umidade, além de mínimo e máximo da sessão. O coletor não lê os campos de identificador de hardware/sensor, número de série ou MAC; os nomes dos componentes e sensores são os nomes fornecidos pela biblioteca, que podem incluir modelo. Componentes sem suporte ou acesso mostram leitura indisponível.
- **Diagnóstico:** PID, nome e uso de CPU/memória dos programas que mais consomem são obtidos localmente para compor sugestões. O app não encerra esses processos. Quando há uma lentidão sustentada, **apenas o nome** do programa que liderava o consumo é guardado no aprendizado local (nunca o caminho, a linha de comando ou o conteúdo).
- **Limpeza e otimização:** caminhos, tamanhos e quantidade de arquivos regulares antigos (pasta temporária do usuário, relatórios de falha, relatórios de erro do Windows) e o tamanho da Lixeira são lidos localmente para a prévia. A limpeza só remove itens após ação explícita ou configuração explícita de limpeza automática (que considera apenas temporários). O plano de energia ativo e a lista de programas de inicialização do Windows (nome e comando) são lidos só para exibição e não são guardados.
- **Histórico local:** amostras locais de CPU, RAM, disco principal, utilização de GPU compatível e temperaturas ACPI/CPU/GPU em intervalos de um minuto, por até sete dias.
- **Aprendizado local:** médias e variações de CPU, RAM, disco, GPU e temperatura para cada uma das 168 horas da semana; episódios de lentidão detectados (tipo, horário, duração e pico; até 120, por até 30 dias); e até 60 nomes de programas recorrentes com a contagem de episódios. É um cálculo estatístico simples feito no computador. Pode ser exportado ou apagado em **Ajustes → Privacidade e dados**.
- **Serviço de sensores (Windows):** o Windows só deixa ler a temperatura do processador e da placa-mãe com um driver. Por isso, na primeira abertura, com a permissão da pessoa (UAC), o Nexo baixa do GitHub oficial o instalador do **PawnIO 2.2.0** (driver assinado e de código aberto, o mesmo do LibreHardwareMonitor), confere o SHA-256 antes de executar, instala o driver se ele ainda não existir e cria o serviço **“Nexo Device Care: sensores”** (`NexoSensors`), com o coletor copiado para `%ProgramFiles%\Nexo Device Care\SensorService`. O serviço só lê sensores e responde a leituras pelo canal local `\\.\pipe\NexoSensors`, que recusa conexões pela rede; não aceita outros comandos. Se a pessoa recusar o UAC, o Nexo continua com as leituras que não precisam de driver e pergunta de novo depois de alguns dias (ou em Hardware). A desinstalação remove o serviço, a pasta e o PawnIO quando foi o Nexo que o instalou; se ele já existia, fica.
- **Sensores detalhados:** valores atuais e mínimos/máximos da sessão ficam em memória para a tela de sensores e não são gravados automaticamente no histórico de sete dias. Se a pessoa escolher **Exportar CSV**, o Nexo cria um arquivo local com nome/categoria do componente, nome e tipo do sensor, valor atual, unidade, mínimo, máximo e indicador de sensor avançado.
- **Feedback local:** categoria da recomendação, resposta útil/não útil e horário, limitado aos últimos 100 registros.
- **Atividade local:** título, detalhe e horário das últimas 20 atividades exibidas pelo app.
- **Registro de erros:** quando algo dá errado no app, o Nexo anota localmente o horário, a origem (processo principal, tela, ação, serviço), a mensagem, a pilha de chamadas e um contexto curto (por exemplo, a tela aberta), na pasta `logs` dos dados do app (até 512 KB, com uma cópia anterior). Antes de gravar, troca a sua pasta pessoal e o seu nome de usuário por `<usuário>` e apaga tokens e chaves. Você vê, copia e apaga tudo em **Ajustes → Registro de erros**. Só sai do PC se você ligar os relatórios de erro (veja Servidor do Nexo).
- **Sessões de observação (só quando você inicia uma):** a cada segundo, uso total de CPU, do núcleo mais ocupado, memória, GPU, temperatura e queda de clock; a cada poucos segundos, o programa em primeiro plano, os programas que mais usaram CPU e GPU (só o **nome**, nunca o caminho nem a linha de comando) e o custo do próprio Nexo; e, se você ativar, FPS e tempo de quadro do programa escolhido. Para saber se algo é um jogo, o Nexo olha **só a pasta de instalação** do programa em primeiro plano; o caminho é usado nessa hora e não é guardado. Nunca lê a memória de outro programa. Guarda as 10 sessões mais recentes (relatório e linha do tempo reduzida a um ponto a cada 5 s); você pode exportar, excluir cada uma ou apagar todas.
- **Perfil de uso:** a opção escolhida (Jogos, Trabalho e criação ou Uso geral), só para ajustar pesos e a ordem das observações.
- **Diário de alterações:** para cada alteração feita pelo Nexo (plano de energia, limpezas, otimização de unidade, verificação do sistema) ficam registrados o nome da operação, o horário, o risco, o valor anterior e o novo (por exemplo, nome e identificador do plano de energia), a quantidade e o tamanho dos itens removidos e a forma de autorização. Guarda até 100 registros e serve para você auditar e reverter.
- **Benchmark local:** o experimento do plano de energia executa uma carga sintética de CPU por cerca de 20 segundos, sempre iniciada por você. Só os números resultantes (medianas, ruído e veredito) são guardados no Diário.
- **Preferências locais:** papel de parede escolhido (até 12 MB, guardado como arquivo na pasta de dados do app), modo de efeitos visuais, configuração da limpeza automática e horário da última execução.
- **Servidor do Nexo:** as escolhas (sincronização, telemetria, relatórios de erro, incluir o e-mail), dois códigos aleatórios deste PC (um para a telemetria, outro para a sincronização), o horário dos últimos envios e, com a sincronização ligada, o e-mail da conta e o token de sessão do servidor, cifrado com o cofre do sistema quando disponível, ficam em `cloud.json`. A caixa do instalador fica também no Registro do Windows em `HKCU\Software\NexoDeviceCare\Privacy\DeveloperTelemetryOptIn` (no Linux, em `privacy.json`). Na tela, a contagem do dia de telas abertas e recursos usados fica em `nexo-usage-day` e só sai do PC com a telemetria ligada.

Os itens acima ficam no computador da pessoa. O gráfico da sessão mantém amostras em memória por até cinco minutos. Nomes e detalhes locais de atividades podem incluir o resultado de ações iniciadas pela pessoa, como a quantidade de arquivos removidos e o espaço liberado.

## Recursos opcionais (desligados até você usar)

- **Biblioteca de jogos:** para listar o que está instalado, o Nexo lê os manifestos da Steam (`libraryfolders.vdf`, `appmanifest_*.acf`) e da Epic (`*.item`), o arquivo `MicrosoftGame.config` dos jogos em `X:\XboxGames`, as chaves do Registro da GOG, da Ubisoft e de desinstalação de programas de editoras de jogos, e as pastas de instalação. Fica no processo principal (não vai para a interface nem para arquivos) o caminho de cada jogo; a interface recebe nome, loja, tamanho e última vez jogado. O Nexo **copia** as capas do cache local de cada launcher para `covers` na pasta de dados do app e guarda em `games-manual.json` os jogos que você adicionar (nome e caminho do executável). Capas que você escolher ficam na mesma pasta.
- **Sessão automática:** desligada por padrão. Se você ligar, um PowerShell leve lê a cada 3 s o programa em primeiro plano (PID, nome e caminho). O caminho só é comparado com as pastas da biblioteca, na hora, e não é guardado. A sessão gravada guarda também o identificador do jogo da biblioteca.
- **Bandeja e iniciar com o Windows:** desligados por padrão. As escolhas ficam em `nexo-settings.json`. Iniciar com o Windows cria o valor `NexoDeviceCare` em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
- **Liberar a medição de FPS:** se você pedir, o Nexo adiciona o seu usuário (pelo SID) ao grupo local “Performance Log Users” (SID `S-1-5-32-559`), com a permissão de administrador do Windows (UAC). O SID do usuário é lido só no processo principal. A alteração fica no Diário e pode ser revertida; ao desinstalar pelo app, o Nexo oferece desfazer.
- **Atlas de opções:** lê, sem alterar, a velocidade configurada da memória e a informada pelos módulos, a quantidade de módulos, a taxa de atualização atual e máxima informada pela placa de vídeo, e o estado do agendamento de GPU por hardware, do Modo de Jogo, da captura de jogos e da segurança baseada em virtualização (VBS). Não guarda essas leituras.

## Contas e conexões de jogos (opcionais)

- **Steam deste PC:** ao conectar, o Nexo lê só arquivos que a própria Steam guarda no computador: `config/loginusers.vdf` (identificador SteamID64 e nome de perfil das contas que já entraram neste PC), `config/avatarcache` (a foto de perfil) e `userdata/<conta>/config/localconfig.vdf` (tempo de jogo e última vez jogado de cada jogo). Não pede senha nem fala com a Valve. Fica guardado: o SteamID64 e o nome de perfil escolhidos.
- **Entrar com a Steam (opcional):** o botão abre no navegador a página **oficial** de login da Steam (`steamcommunity.com/openid`), passando pelo servidor do Nexo. Você digita a senha só na Steam; o Nexo nunca a vê. A Steam devolve ao servidor do Nexo apenas o identificador da conta (SteamID64); o servidor confere essa resposta com a própria Steam e entrega ao app, só neste PC (endereço `127.0.0.1`), um passe assinado com o SteamID64, válido por um ano e guardado cifrado em `connections.bin`. Com esse passe, o app pede ao servidor do Nexo o seu nome e foto públicos, os jogos da conta (com tempo de jogo, última vez e as horas das últimas 2 semanas) e as conquistas de um jogo; o servidor busca na Steam Web API com a **chave do criador** (que nunca sai do servidor) e **não guarda** nada disso: cada pedido vai à Steam e volta. A Valve recebe do servidor o SteamID64 consultado. Os jogos e as conquistas só aparecem se o seu perfil deixar “Detalhes de jogos” como público. O servidor conta quantos pedidos cada SteamID64 fez no dia (limite de uso), e essa contagem some no dia seguinte. **Sair da Steam** apaga o passe e a foto deste PC.
- **Chave da Steam Web API (opcional):** se você colar a **sua** chave, o Nexo consulta `api.steampowered.com` para listar os jogos da conta (inclusive não instalados) com o tempo de jogo. A Valve recebe a chave, o SteamID64 e os dados normais da conexão. A chave fica cifrada pelo Windows em `connections.bin` e pode ser apagada a qualquer momento.
- **Xbox / conta Microsoft (opcional):** login no seu navegador (PKCE, retorno em `localhost`), escopo `XboxLive.signin`, sem acesso offline. O Nexo conversa com `login.microsoftonline.com`, `user.auth.xboxlive.com`, `xsts.auth.xboxlive.com`, `profile.xboxlive.com` e `titlehub.xboxlive.com`, lê gamertag, foto e o histórico de jogos (nome, plataformas, última vez jogado e o endereço da arte oficial) e **descarta os tokens**. Fica guardado, cifrado: gamertag, foto e esse histórico.
- **Discord (opcional):** o Nexo fala com o Discord aberto no próprio PC pelo canal local do Discord (Rich Presence) e mostra no seu perfil — para os seus amigos — o jogo que está sendo gravado e/ou “Cuidando do PC com o Nexo”, conforme você escolher. Nada passa por servidor do Nexo; o Discord trata esse status pelas regras dele.
- **Capas oficiais (opcional, desligado por padrão):** para jogos sem capa no cache local, o Nexo consulta a CDN de imagens da Steam (pelo número do jogo), a busca da loja Steam (`store.steampowered.com`, pelo **nome** do jogo, aceitando só correspondência exata) e o catálogo público da Microsoft Store (`displaycatalog.mp.microsoft.com`, pelo identificador do jogo). Essas lojas recebem o que foi pesquisado e os dados normais da conexão. As imagens são reduzidas e guardadas em `covers`; jogos sem correspondência ficam marcados por 7 dias para não repetir a busca.
- **Dados completos do jogo (com o conteúdo online permitido):** ao abrir a página de um jogo, o processo principal consulta a loja da Steam (`store.steampowered.com/api/appdetails`: descrição, gêneros, lançamento, nota, capturas de tela, requisitos) e as novidades (`api.steampowered.com/ISteamNews`) pelo número do jogo; para jogos de outras lojas, procura o mesmo nome exato na Steam. Com a sua chave da Steam Web API, consulta também as suas conquistas (`ISteamUserStats`: esquema, progresso e raridade global); o perfil precisa ter “Detalhes do jogo” público. A página carrega as imagens (capturas e ícones de conquistas) direto da CDN da Steam, que recebe os dados normais da conexão. As respostas ficam em cache em `details` (loja 7 dias, novidades 3 horas, conquistas 10 minutos).
- **Custo do Nexo:** em Ajustes, o app mostra o próprio uso de CPU e memória lido do Electron; não é guardado.

## Otimização extrema (beta) — sessões de risco

É uma opção **arriscada e em beta**, que só roda depois de você marcar o aviso e digitar a frase de confirmação. Durante uma sessão de risco o Nexo:

- cria um **ponto de restauração** do Windows (com UAC). Para isso, ajusta por alguns segundos o valor `SystemRestorePointCreationFrequency` (documentado pela Microsoft) e devolve o valor anterior;
- **clona** o plano de energia ativo para “Nexo Lab (temporário)”, exporta uma cópia de segurança do plano original para a pasta `lab` dos dados do app, grava uma **trava** (`lab-lock.json`, com os identificadores dos dois planos) e, na versão instalada, uma entrada **RunOnce** (`NexoLabRecovery`) para restaurar o plano original se o PC travar;
- muda só configurações do processador do plano temporário, roda testes sintéticos de CPU e lê a temperatura do processador, a fonte de energia e a **contagem** de erros graves (níveis crítico e erro) de alguns provedores do log de Sistema do Windows (hardware, energia e vídeo). Não lê o conteúdo de outros eventos;
- no fim, volta ao plano original, apaga o temporário, a trava e o RunOnce. No modo autônomo, uma combinação confirmada vira um plano novo “Nexo — Ajustado (data)”.

Guarda no navegador interno do app (`nexo-lab-v1`): a evidência por ajuste (quantas vezes foi testado, ganho médio, vitórias, pioras, guardas), a lista de ajustes bloqueados por guarda e um resumo das últimas 15 sessões de risco. No Diário, cada sessão fica marcada como **sessão de risco**, com os valores originais e o que foi testado.

## Conta Google (opcional)

Se você escolher **Entrar com o Google**, o login acontece no seu navegador padrão, com OAuth 2.0 para aplicativos instalados (PKCE e retorno para `127.0.0.1` numa porta temporária). O Nexo se conecta a `accounts.google.com` e `oauth2.googleapis.com` e, para a foto, ao endereço `googleusercontent.com` que o Google informar. Pede só os escopos `openid`, `email` e `profile`, **sem acesso offline**: depois de ler o perfil, revoga o token de acesso e não guarda tokens nem senhas. Fica neste computador, cifrado com a proteção de dados do Windows quando disponível (`account/profile.bin`), apenas: identificador da conta Google, nome, e-mail e horário do login; a foto fica em `account/avatar.*`. Nada disso é enviado ao criador, a não ser que você ligue a sincronização (veja abaixo). Sair da conta apaga esses arquivos e desliga a sincronização deste PC.

## No Linux

O Nexo funciona do mesmo jeito local, com as fontes que o Linux oferece: `/proc` (uso de CPU, memória e programas), `/proc/mounts` e `statfs` (unidades), `/sys/class/hwmon`, `/sys/class/thermal` e `cpufreq` (sensores), `nvidia-smi` quando houver placa NVIDIA, `powerprofilesctl` (perfis de energia), `~/.config/autostart` e `/etc/xdg/autostart` (inicialização, só leitura) e o `xprop` (programa em primeiro plano, em X11 e XWayland). Os dados ficam em `~/.config/Nexo Device Care` e `~/.cache`. Não há assistente de instalação: os avisos aparecem na primeira abertura do app.

- **Limpeza:** só arquivos do próprio usuário em `/tmp` e `/var/crash`, miniaturas antigas em `~/.cache/thumbnails` e a Lixeira freedesktop (`~/.local/share/Trash`).
- **FPS:** o Nexo lê, enquanto a sessão grava, o log CSV que o **MangoHud** escreve numa pasta do Nexo (`mangohud` nos dados do app) quando o jogo é iniciado com a opção de inicialização mostrada em Sessões. Os logs ficam nessa pasta até você apagar os dados.
- **Biblioteca:** Steam (nativa, Flatpak ou Snap; mesmos arquivos locais do Windows) e o Heroic Games Launcher (`installed.json` e `library.json` de Epic e GOG).
- **Laboratório:** só troca o perfil do power-profiles-daemon; lê a contagem de erros do kernel pelo `journalctl` (sem guardar o texto).
- **Permissões:** nada roda como root. TRIM (`fstrim`) e a remoção do pacote `.deb` pedem a sua senha pelo pkexec.
- **Inicialização com o sistema:** cria `~/.config/autostart/nexo-device-care.desktop`; a desinstalação pelo app apaga esse arquivo, os dados, os caches e a AppImage (ou remove o pacote `.deb`).
- **Discord:** fala pelo socket local do Discord em `$XDG_RUNTIME_DIR` (nativo, Flatpak ou Snap).

## Componente opcional: PresentMon

Para medir FPS, o Nexo pode executar o **PresentMon** (Intel, licença MIT) como um programa separado, só quando você ativa a medição. Ele lê os eventos de apresentação do Windows (ETW) do programa escolhido e entrega ao Nexo os tempos de quadro; nada sai do computador. Exige que o usuário esteja no grupo “Performance Log Users” (ou seja administrador). Sem um hash fixado na build, o instalador **não** embute o executável; você pode apontar um arquivo que baixou do site oficial. Detalhes em `THIRD-PARTY-NOTICES.md`.

## Exportar, apagar e desinstalar

- **Exportar:** em **Ajustes** é possível salvar um arquivo JSON com o histórico, o aprendizado, o feedback, a atividade, o diário, as sessões, o aprendizado do laboratório e o perfil.
- **Apagar o aprendizado:** o botão correspondente apaga o histórico, o aprendizado, o feedback, as sessões e o aprendizado do laboratório. O diário de alterações é mantido para permitir reverter.
- **Desinstalar:** a desinstalação pelo Windows ou por **Ajustes** remove o programa, os dados e preferências (inclusive capas, conta e laboratório), os caches, os atalhos, as entradas do Registro do Nexo (inclusive `Run` e `RunOnce`) e os planos de energia criados pelo laboratório. Pontos de restauração continuam sendo gerenciados pelo Windows. As cópias da sincronização no servidor não são apagadas pela desinstalação (use “Apagar meus dados do servidor” antes). Atualizações preservam os dados.

## Conexões de rede

Ao iniciar, a versão empacotada consulta as releases públicas do GitHub para verificar se existe uma atualização. Como qualquer conexão HTTP, o GitHub pode receber metadados técnicos da solicitação, incluindo endereço IP, horário, URL consultada e identificação do cliente. O Nexo não anexa a essa consulta inventário do computador, nomes de processos, arquivos, histórico, papel de parede ou feedback. Nenhuma atualização é baixada até a pessoa escolher **Baixar e atualizar**. As outras conexões só acontecem se você usar os recursos opcionais acima: abrir um jogo pelo launcher dele, capas oficiais, entrar com a Steam, chave da Steam Web API, conta Xbox, login com o Google e o servidor do Nexo (sincronização, relatórios de erro e telemetria, cada um só se ligado).

## Servidor do Nexo (opcional e desligado por padrão)

O Nexo tem um servidor que serve para a sincronização de contas, a coleta de erros e a telemetria, que é opcional e vem desativada por padrão. Para que o app possa melhorar cada vez mais, eu peço que você deixe a opção ligada. Ela gera a telemetria apenas uma vez por dia, então é inofensiva, e não puxa nada pessoal: só o que ajuda a entender como o app se comporta em outras máquinas, para podermos melhorar o Nexo.

O servidor roda na **Cloudflare** (Workers e banco D1), num endereço `*.workers.dev`, só por HTTPS. A Cloudflare recebe os dados normais de qualquer conexão (endereço IP, horário, identificação do app). O servidor não guarda o endereço IP: para limitar abusos, guarda por um dia só um resumo dele misturado com um segredo do servidor, que não permite voltar ao IP. As três partes ligam e desligam separadas, em **Ajustes**:

- **Na primeira abertura**, o app pergunta uma vez (com o texto acima) se você quer ligar a telemetria e os relatórios de erro. “Agora não” deixa tudo desligado. Quem marcou **“Ajudar a melhorar o Nexo”** no instalador já respondeu: as duas ficam ligadas e o app não pergunta de novo.

### Telemetria (um resumo por dia)

- **Quando:** o app monta, neste PC, o resumo de cada dia (em horário UTC) e manda **uma vez, depois que o dia acaba** (na hora seguinte, ou na próxima vez que o Nexo abrir). Assim chegam as contagens do dia inteiro. Dias de quando a telemetria estava desligada nunca saem, e um dia com mais de 6 dias fica de fora.
- **O que vai:**
  - **App:** versão, sistema (Windows ou Linux, versão do sistema, arquitetura), idioma do sistema, como foi instalado (instalador, AppImage ou .deb), há quantos dias o Nexo está neste PC, de qual versão atualizou, quantas vezes abriu no dia e por quantos minutos ficou aberto e em foco, e quanto demorou para abrir.
  - **Hardware:** fabricante e modelo do processador, núcleos, memória total em GB, fabricante e modelo da placa de vídeo, monitores (resolução, escala e taxa de atualização), quantos discos e o tamanho somado, e se os sensores funcionam (sem os valores).
  - **Quanto o próprio Nexo pesa:** uso médio de processador e memória do app (com e sem foco), pico de memória, quadros por segundo do céu, travadas da interface e o uso médio da placa de vídeo com o Nexo na frente (Completo ou Leve) e em segundo plano.
  - **Médias do dia do PC:** processador, memória, placa de vídeo e disco (médias e picos) e a maior temperatura, tiradas do histórico local de 1 leitura por minuto.
  - **Ajustes do app:** efeitos visuais, cor de destaque, opções do céu, velocidade das leituras, perfil de uso, se usa papel de parede próprio (não a imagem), limpeza automática, bandeja, abrir com o sistema, sessões automáticas, capas online e quantos recursos estão fixados.
  - **Uso:** quantas vezes cada **tela** foi aberta e o tempo em foco nela; quais **recursos** foram usados (de uma lista fixa de nomes, como “raio-x-do-pc”); quais **botões dos cartões de recurso** foram usados (pelo id do cartão no código); e se usou a busca, os filtros, a busca rápida (Ctrl K), a janela de novidades e a chuva de meteoros (só a contagem, **nunca o texto buscado**).
  - **Saúde do app:** quais cartões de recurso ficaram sem dado ou quebraram neste PC (ids do código), quais fontes de dados falharam e quanto demoraram, quantas vezes cada ação interna do app rodou, falhou e demorou (pelo nome fixo da ação), e quantas vezes um processo do Nexo caiu, a janela travou ou houve erro, por origem (só a contagem; o conteúdo dos erros só vai pelos relatórios de erro, abaixo, se você ligar).
  - **Biblioteca e laboratório:** quantos jogos por loja e quantos instalados (**sem os nomes**), quantas sessões gravadas e com FPS, e quantas alterações do Diário foram aplicadas ou revertidas no dia (pelo nome fixo da ação).
- **O que nunca vai:** nome do computador ou do usuário, e-mail, conta, pastas, nomes de arquivos, de programas ou de jogos, texto digitado, endereço de rede e os valores lidos dos sensores um a um.
- **Com o quê:** um código aleatório criado neste PC. **Sem e-mail, sem conta, sem nome do computador**, mesmo se você estiver com a sincronização ligada (a telemetria nunca leva a sessão).
- **Retenção:** 120 dias. O painel do criador mostra só somas e medianas entre os PCs.

### Relatórios de erro

- **O que vai:** os erros do registro local (não os avisos) que acontecerem **depois** de você ligar, agrupados: a mensagem, a pilha de chamadas, o contexto curto, a origem, quantas vezes e quando aconteceu, a versão do app e o sistema. O app já tira a sua pasta pessoal e o seu nome de usuário antes de gravar, e o servidor limpa de novo ao receber.
- **E-mail (opcional):** se a sincronização estiver ligada e você marcar **“Incluir meu e-mail nos relatórios”**, o e-mail vai junto, para o criador avisar você quando o erro for corrigido. Quem informa o e-mail é a sessão do servidor (confirmada pelo Google), nunca um campo digitado.
- **Quando:** 2 minutos depois de abrir o app e a cada 30 minutos, se houver erro novo.
- **Retenção:** 180 dias desde a última ocorrência. Apagar os seus dados do servidor tira o seu e-mail dos relatórios que você mandou.

### Sincronização entre PCs

- **A “senha” é o seu login do Google:** ao ligar, o navegador confirma o login e o servidor recebe do Google só o identificador da conta, o e-mail e o nome. O Nexo não guarda o token do Google; o servidor devolve uma sessão própria (válida por até um ano), que fica cifrada no PC.
- **O que vai, de cada PC:** o nome do computador e uma cópia de: preferências (efeitos visuais, cor de destaque, opções do céu, velocidade das leituras, bandeja, sessões automáticas e capas online), perfil de uso, as sessões de jogo gravadas (até 10, o que couber em 1 MB) e o histórico de atividades (até 20). **Não vão:** o Diário de alterações, o aprendizado, o laboratório, a biblioteca de jogos, contas de jogos, a limpeza automática (ela apaga arquivos, então cada PC confirma a sua), o papel de parede e qualquer arquivo pessoal.
- **Trazer dados de outro PC** é sempre uma escolha sua: você vê os PCs da sua conta, escolhe um e marca o que trazer. Preferências e perfil substituem os deste PC; sessões e atividades se juntam às daqui. Nada entra sozinho.
- **Criptografia, sem exagero:** cada cópia (e o nome do PC) é cifrada no servidor com AES-256-GCM, com uma chave própria da sua conta, derivada de uma chave mestra que só existe como segredo do servidor; o banco guarda só o texto cifrado, então um vazamento do banco não revela o conteúdo. **Como a “senha” é o login do Google, e não uma senha só sua, o servidor consegue abrir as cópias para entregá-las a você** — e, em tese, quem opera o servidor também conseguiria. O painel do criador mostra só **quantas contas** usam a sincronização no total; **não mostra** quem são, os PCs de cada uma nem o conteúdo, e nenhuma ferramenta do painel lê essas cópias.
- **Limites e retenção:** até 20 PCs por conta. A cópia de um PC que não é atualizada há um ano é apagada, e a conta sem sessão nem cópia some depois de 30 dias.

### Painel do criador

Só o e-mail do criador (configurado como segredo do servidor, fora do código) e as pessoas que ele adicionar entram no painel, por um link de uso único que o próprio app abre e um cookie de 8 horas. Cada pessoa tem um papel: **colaborador** (vê erros, e-mails de quem pediu aviso e telemetria somada; muda o estado de um erro) ou **leitura** (vê erros e telemetria, **sem e-mails**). Para o assistente de programação do criador, existe uma chave de leitura que só vê os erros, **sem e-mails**. Os relatórios podem ser copiados para um repositório **privado** do criador no GitHub, também sem e-mails.

### Desligar, apagar e revogar

- **Desligar** qualquer parte em **Ajustes** para os envios na hora.
- **Desligar a sincronização** encerra a sessão deste PC; as cópias ficam no servidor até você apagar.
- **Apagar a cópia de um PC** ou **“Apagar meus dados do servidor”** (todas as cópias, a conta e o e-mail nos relatórios) acontece na hora, pelo app.
- **Desinstalar** não apaga as cópias no servidor: use “Apagar meus dados do servidor” antes, se quiser.

## Contato e código

- Projeto: <https://github.com/Samuklvm/Project-Nexo>
- Problemas e sugestões: <https://github.com/Samuklvm/Project-Nexo/issues>
- Criador: <https://github.com/Samuklvm>
