# Privacidade do Nexo Device Care

## Resumo

O Nexo é gratuito. O código é proprietário (veja LICENSE). A coleta e o processamento locais são ativos para alimentar os recursos do app e ficam no computador. O compartilhamento de telemetria com o criador é opcional e começa desativado. Nesta versão, não existe envio de telemetria, anúncios ou relatórios de falha; a opção do instalador apenas guarda a preferência localmente. Qualquer futura coleta externa deverá apresentar previamente os campos exatos, finalidade, destino, retenção e forma de revogar o consentimento.

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
- **Sessões de observação (só quando você inicia uma):** a cada segundo, uso total de CPU, do núcleo mais ocupado, memória, GPU, temperatura e queda de clock; a cada poucos segundos, o programa em primeiro plano, os programas que mais usaram CPU e GPU (só o **nome**, nunca o caminho nem a linha de comando) e o custo do próprio Nexo; e, se você ativar, FPS e tempo de quadro do programa escolhido. Para saber se algo é um jogo, o Nexo olha **só a pasta de instalação** do programa em primeiro plano; o caminho é usado nessa hora e não é guardado. Nunca lê a memória de outro programa. Guarda as 10 sessões mais recentes (relatório e linha do tempo reduzida a um ponto a cada 5 s); você pode exportar, excluir cada uma ou apagar todas.
- **Perfil de uso:** a opção escolhida (Jogos, Trabalho e criação ou Uso geral), só para ajustar pesos e a ordem das observações.
- **Diário de alterações:** para cada alteração feita pelo Nexo (plano de energia, limpezas, otimização de unidade, verificação do sistema) ficam registrados o nome da operação, o horário, o risco, o valor anterior e o novo (por exemplo, nome e identificador do plano de energia), a quantidade e o tamanho dos itens removidos e a forma de autorização. Guarda até 100 registros e serve para você auditar e reverter.
- **Benchmark local:** o experimento do plano de energia executa uma carga sintética de CPU por cerca de 20 segundos, sempre iniciada por você. Só os números resultantes (medianas, ruído e veredito) são guardados no Diário.
- **Preferências locais:** papel de parede escolhido (até 12 MB, guardado como arquivo na pasta de dados do app), modo de efeitos visuais, configuração da limpeza automática e horário da última execução.
- **Compartilhamento opcional:** a preferência para enviar telemetria ao criador, hoje inativa, é guardada no Registro do Windows em `HKCU\Software\NexoDeviceCare\Privacy\DeveloperTelemetryOptIn`. Não é enviada ao desenvolvedor.

Os itens acima ficam no computador da pessoa. O gráfico da sessão mantém amostras em memória por até cinco minutos. Nomes e detalhes locais de atividades podem incluir o resultado de ações iniciadas pela pessoa, como a quantidade de arquivos removidos e o espaço liberado.

## Recursos opcionais (desligados até você usar)

- **Biblioteca de jogos:** para listar o que está instalado, o Nexo lê os manifestos da Steam (`libraryfolders.vdf`, `appmanifest_*.acf`) e da Epic (`*.item`), o arquivo `MicrosoftGame.config` dos jogos em `X:\XboxGames`, as chaves do Registro da GOG, da Ubisoft e de desinstalação de programas de editoras de jogos, e as pastas de instalação. Fica no processo principal (não vai para a interface nem para arquivos) o caminho de cada jogo; a interface recebe nome, loja, tamanho e última vez jogado. O Nexo **copia** as capas do cache local de cada launcher para `covers` na pasta de dados do app e guarda em `games-manual.json` os jogos que você adicionar (nome e caminho do executável). Capas que você escolher ficam na mesma pasta.
- **Sessão automática:** desligada por padrão. Se você ligar, um PowerShell leve lê a cada 3 s o programa em primeiro plano (PID, nome e caminho). O caminho só é comparado com as pastas da biblioteca, na hora, e não é guardado. A sessão gravada guarda também o identificador do jogo da biblioteca.
- **Bandeja e iniciar com o Windows:** desligados por padrão. As escolhas ficam em `nexo-settings.json`. Iniciar com o Windows cria o valor `NexoDeviceCare` em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
- **Liberar a medição de FPS:** se você pedir, o Nexo adiciona o seu usuário (pelo SID) ao grupo local “Performance Log Users” (SID `S-1-5-32-559`), com a permissão de administrador do Windows (UAC). O SID do usuário é lido só no processo principal. A alteração fica no Diário e pode ser revertida; ao desinstalar pelo app, o Nexo oferece desfazer.
- **Atlas de opções:** lê, sem alterar, a velocidade configurada da memória e a informada pelos módulos, a quantidade de módulos, a taxa de atualização atual e máxima informada pela placa de vídeo, e o estado do agendamento de GPU por hardware, do Modo de Jogo, da captura de jogos e da segurança baseada em virtualização (VBS). Não guarda essas leituras.

## Contas e conexões de jogos (opcionais)

- **Steam deste PC:** ao conectar, o Nexo lê só arquivos que a própria Steam guarda no computador: `config/loginusers.vdf` (identificador SteamID64 e nome de perfil das contas que já entraram neste PC), `config/avatarcache` (a foto de perfil) e `userdata/<conta>/config/localconfig.vdf` (tempo de jogo e última vez jogado de cada jogo). Não pede senha nem fala com a Valve. Fica guardado: o SteamID64 e o nome de perfil escolhidos.
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

Se você escolher **Entrar com o Google**, o login acontece no seu navegador padrão, com OAuth 2.0 para aplicativos instalados (PKCE e retorno para `127.0.0.1` numa porta temporária). O Nexo se conecta a `accounts.google.com` e `oauth2.googleapis.com` e, para a foto, ao endereço `googleusercontent.com` que o Google informar. Pede só os escopos `openid`, `email` e `profile`, **sem acesso offline**: depois de ler o perfil, revoga o token de acesso e não guarda tokens nem senhas. Fica neste computador, cifrado com a proteção de dados do Windows quando disponível (`account/profile.bin`), apenas: identificador da conta Google, nome, e-mail e horário do login; a foto fica em `account/avatar.*`. Nada disso é enviado ao criador. Sair da conta apaga esses arquivos. Ainda não existe sincronização entre computadores.

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
- **Desinstalar:** a desinstalação pelo Windows ou por **Ajustes** remove o programa, os dados e preferências (inclusive capas, conta e laboratório), os caches, os atalhos, as entradas do Registro do Nexo (inclusive `Run` e `RunOnce`) e os planos de energia criados pelo laboratório. Pontos de restauração continuam sendo gerenciados pelo Windows. Atualizações preservam os dados.

## Conexões de rede

Ao iniciar, a versão empacotada consulta as releases públicas do GitHub para verificar se existe uma atualização. Como qualquer conexão HTTP, o GitHub pode receber metadados técnicos da solicitação, incluindo endereço IP, horário, URL consultada e identificação do cliente. O Nexo não anexa a essa consulta inventário do computador, nomes de processos, arquivos, histórico, papel de parede ou feedback. Nenhuma atualização é baixada até a pessoa escolher **Baixar e atualizar**. As outras conexões só acontecem se você usar os recursos opcionais acima: abrir um jogo pelo launcher dele, capas oficiais, chave da Steam Web API, conta Xbox e login com o Google.

## Compartilhamento opcional com o criador

Nesta versão não existe serviço ou código que envie telemetria ao criador. A opção do instalador fica desativada por padrão e registra a preferência em `HKCU\Software\NexoDeviceCare\Privacy\DeveloperTelemetryOptIn`; neste momento, marcá-la não ativa transmissão alguma. Se uma versão futura implementar compartilhamento, deverá mostrar o inventário completo dos campos, finalidade, destino, retenção e forma de revogar a escolha, mantendo o envio desativado até consentimento explícito e informado.

## Contato e código

- Projeto: <https://github.com/Samuklvm/Project-Nexo>
- Problemas e sugestões: <https://github.com/Samuklvm/Project-Nexo/issues>
- Criador: <https://github.com/Samuklvm>
