
LangString PRIVACY_TITLE 1046 "Privacidade e transparência"
LangString PRIVACY_SUBTITLE 1046 "A coleta local mantém recursos do app; a telemetria e a sincronização são opcionais e começam desligadas."
LangString PRIVACY_DETAILS 1046 "COLETA LOCAL — ATIVA PARA OS RECURSOS DO APP:$\r$\n• Painel: nome do computador, versão do Windows e do app, tempo ligado, uso de CPU, RAM total/livre/usada, indicador local de conexão (sim/não) e discos fixos (letra, rótulo, sistema de arquivos, total/livre/usado). Endereços de rede só são examinados localmente para obter o indicador; o Nexo não os guarda nem envia.$\r$\n• GPU NVIDIA compatível: temperatura, uso e memória usada/total. Sensores ACPI: temperatura reportada pelo firmware.$\r$\n• Diagnóstico: PID, nome e uso de CPU/memória dos programas com maior consumo, calculados neste PC. Durante lentidões, apenas o nome desses programas (sem caminho nem linha de comando) é guardado para identificar quem mais atrapalha.$\r$\n• Limpeza e otimização: caminho, tamanho e quantidade de arquivos antigos (temporários, relatórios de falha e de erro, Lixeira), exibidos para prévia e remoção local; plano de energia e programas de inicialização do Windows, lidos só para exibição.$\r$\n• Perfil local: amostras de CPU/RAM/disco/GPU e temperaturas a cada minuto (até 7 dias); médias por hora da semana, lentidões detectadas (tipo, horário, duração, pico) e programas recorrentes (até 60) usados no aprendizado local; feedback (categoria, útil/não útil e horário; até 100); título, detalhe e horário das últimas 20 atividades; diário das alterações feitas pelo Nexo (operação, horário, valor anterior e novo e, se você pedir, o resultado de um teste curto de CPU; até 100 registros); sessões de observação que você iniciar (uso de CPU, GPU, memória e temperatura por segundo, nome do programa em primeiro plano e dos que mais pesaram, e FPS se você ativar; sem caminhos; até 10 sessões); perfil de uso escolhido; papel de parede escolhido (até 12 MB, como arquivo na pasta de dados do app); configuração e horário da limpeza automática. Tudo pode ser exportado ou apagado em Ajustes. Gráficos da sessão ficam em memória por até 5 minutos.$\r$\n$\r$\nRECURSOS OPCIONAIS (DESLIGADOS ATÉ VOCÊ USAR):$\r$\n• Biblioteca de jogos: o Nexo lê manifestos dos launchers (Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot, Rockstar), o Registro e as pastas dos jogos para listar o que está instalado; copia as capas do cache local para a pasta de dados do app e guarda os jogos que você adicionar (nome e caminho do executável). As capas que faltam podem vir das lojas oficiais (veja abaixo).$\r$\n• Sessão automática e bandeja: se você ligar, o Nexo lê a cada 3 s o programa em primeiro plano (nome e pasta, usados na hora e não guardados) para gravar sessões de jogo; iniciar com o Windows cria a entrada NexoDeviceCare em HKCU\…\Run.$\r$\n• Sensores de temperatura (Windows): na primeira abertura, com a sua permissão (UAC), o Nexo instala o driver PawnIO (assinado, código aberto, o mesmo do LibreHardwareMonitor; baixado do GitHub oficial com o arquivo conferido) e o serviço “Nexo Device Care: sensores”, que só lê sensores e responde ao app por um canal local. Desinstalar o Nexo remove o serviço e o PawnIO, se foi o Nexo que instalou.$\r$\n• Liberar o FPS: com a sua permissão (UAC), o Nexo coloca o seu usuário no grupo Performance Log Users; dá para desfazer pelo Diário.$\r$\n• Otimização extrema (beta, arriscada): só com consentimento reforçado. Cria um ponto de restauração do Windows (UAC), um plano de energia temporário, uma trava e uma entrada RunOnce para recuperação, lê contagens de erros graves do log de Sistema do Windows e guarda a evidência por ajuste e as últimas 15 sessões de risco. Tudo volta ao original no fim.$\r$\n• Conta Google: se você entrar, o login acontece no navegador (accounts.google.com e oauth2.googleapis.com); o Nexo guarda neste PC, cifrados pelo Windows, só nome, e-mail, identificador da conta e foto, e não guarda senhas nem tokens do Google. O e-mail vai junto dos relatórios de erro (dá para desmarcar) e, se você ligar a sincronização, para o servidor do Nexo (abaixo).$\r$\n• Contas de jogos (opcionais): Steam deste PC (lê só arquivos locais da Steam: conta, foto, tempo de jogo); chave da Steam Web API, se você colar a sua (consulta api.steampowered.com); conta Xbox pelo navegador (gamertag, foto e histórico de jogos; tokens descartados); Discord pelo canal local (mostra aos seus amigos o que você joga, se ligar). O que é guardado fica cifrado neste PC.$\r$\n• Capas oficiais (desligado por padrão): para jogos sem capa local, consulta a Steam (número ou nome exato do jogo) e o catálogo da Microsoft Store; essas lojas recebem o que foi pesquisado.$\r$\n$\r$\nREDE E ATUALIZAÇÕES:$\r$\nAo abrir, o app consulta as releases públicas do GitHub. O GitHub pode receber dados normais da conexão, como endereço IP, horário, URL e identificação do app. O download só começa por ação da pessoa.$\r$\n$\r$\nSERVIDOR DO NEXO — TUDO OPCIONAL; RELATÓRIOS DE ERRO VÊM LIGADOS:$\r$\nO Nexo tem um servidor que serve para a sincronização de contas, a coleta de erros e a telemetria. Para que o app possa melhorar cada vez mais, eu peço que você deixe a opção abaixo ligada: a telemetria é um resumo por dia e não leva nada pessoal, só o que ajuda a entender como o app se comporta em outras máquinas.$\r$\n• Telemetria: um resumo anônimo por dia, com versão, sistema, hardware e monitores, quanto o Nexo pesa no PC, médias do dia, o que limitou o PC (processador, placa de vídeo, memória ou limite de quadros), ajustes do app, telas e recursos usados e o que falhou no app; vai com um código aleatório deste PC, sem nomes, pastas, programas, e-mail ou conta. O resumo do dia em curso vai parcial, no máximo a cada 3 horas, e o completo o substitui quando o dia acaba.$\r$\n• Relatórios de erro (ligados por padrão; dá para desligar em Ajustes): os erros do registro do app e os últimos passos do app antes de cada um, sem o seu nome de usuário, as suas pastas ou o que você digitou. Se a conta Google estiver entrada no Nexo, o e-mail dela vai junto para o criador avisar quando corrigir; dá para desmarcar em Ajustes, e ele sai também dos relatórios já enviados.$\r$\n• Sincronização: só com o login do Google e ligada no app; cada PC guarda uma cópia criptografada (preferências, perfil, sessões e atividades) e você escolhe o que trazer de outro PC.$\r$\n• Contagem de uso (ligada por padrão; desmarque abaixo ou desligue em Ajustes): uma vez por dia o app avisa só “este PC abriu hoje”, e o instalador avisa quando instala, atualiza ou desinstala, com a versão, o sistema e um código do PC embaralhado (SHA-256 do identificador do Windows com um prefixo só do Nexo, embaralhado de novo no servidor): não dá para saber de quem é nem cruzar com outro app. Serve para o criador saber quantas pessoas usam o Nexo de verdade. Desmarcar manda uma única contagem “+1 desligou”, sem código nenhum.$\r$\nMarcar a primeira opção abaixo liga a telemetria; a segunda é a contagem de uso. Dá para mudar tudo a qualquer momento em Ajustes > Privacidade e dados. Política completa no GitHub."
LangString PRIVACY_TITLE 1033 "Privacy and transparency"
LangString PRIVACY_SUBTITLE 1033 "Local collection supports app features; telemetry and sync are optional and start off."
LangString PRIVACY_DETAILS 1033 "LOCAL COLLECTION — ACTIVE FOR APP FEATURES:$\r$\n• Dashboard: computer name, Windows and app version, uptime, CPU use, RAM total/free/used, local connectivity indicator (yes/no), and fixed disks (letter, label, file system, total/free/used). Network addresses are examined locally only to calculate the indicator; Nexo does not store or send them.$\r$\n• Compatible NVIDIA GPU: temperature, utilization and memory used/total. ACPI sensors: firmware-reported temperature.$\r$\n• Diagnostics: PID, name and CPU/memory use of the highest-consuming programs, calculated on this PC. During slowdowns, only the program name (no path or command line) is stored to identify the usual culprits.$\r$\n• Cleanup and optimization: path, size and count of old files (temporary files, crash and error reports, Recycle Bin), shown for local preview and removal; power plan and Windows startup programs, read for display only.$\r$\n• Local profile: CPU/RAM/disk/GPU and temperature samples every minute (up to 7 days); averages by hour of the week, detected slowdowns (type, time, duration, peak) and recurring programs (up to 60) used by the local learning; feedback (category, helpful/not helpful and time; up to 100); title, details and time of the last 20 activities; journal of changes made by Nexo (operation, time, previous and new value and, if you ask for it, the result of a short CPU test; up to 100 records); observation sessions you start (CPU, GPU, memory and temperature per second, name of the foreground program and of the heaviest ones, and FPS if you enable it; no paths; up to 10 sessions); chosen usage profile; chosen wallpaper (up to 12 MB, stored as a file in the app data folder); automatic-cleanup setting and last-run time. Everything can be exported or erased in Settings. Session charts stay in memory for up to 5 minutes.$\r$\n$\r$\nOPTIONAL FEATURES (OFF UNTIL YOU USE THEM):$\r$\n• Game library: Nexo reads launcher manifests (Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot, Rockstar), the Registry and game folders to list what is installed; it copies covers from the local cache into the app data folder and stores games you add (name and executable path). Missing covers may come from the official stores (see below).$\r$\n• Automatic sessions and tray: if you turn them on, Nexo reads the foreground program every 3 s (name and folder, used on the spot and not stored) to record game sessions; starting with Windows creates the NexoDeviceCare entry in HKCU\…\Run.$\r$\n• Temperature sensors (Windows): on first launch, with your permission (UAC), Nexo installs the PawnIO driver (signed, open source, the same one LibreHardwareMonitor uses; downloaded from the official GitHub with the file verified) and the “Nexo Device Care: sensores” service, which only reads sensors and answers the app through a local channel. Uninstalling Nexo removes the service, and PawnIO if Nexo installed it.$\r$\n• Unlock FPS: with your permission (UAC), Nexo adds your user to the Performance Log Users group; it can be undone from the Journal.$\r$\n• Extreme optimization (beta, risky): only with reinforced consent. It creates a Windows restore point (UAC), a temporary power plan, a lock and a RunOnce entry for recovery, reads counts of serious errors from the Windows System log and stores per-setting evidence and the last 15 risk sessions. Everything returns to the original at the end.$\r$\n• Google account: if you sign in, login happens in the browser (accounts.google.com and oauth2.googleapis.com); Nexo stores on this PC, encrypted by Windows, only name, email, account identifier and photo, and keeps no Google passwords or tokens. The email goes along with error reports (you can untick it) and, if you turn on sync, to the Nexo server (below).$\r$\n• Game accounts (optional): Steam on this PC (reads only local Steam files: account, photo, playtime); Steam Web API key, if you paste yours (queries api.steampowered.com); Xbox account through the browser (gamertag, photo and game history; tokens discarded); Discord through its local channel (shows your friends what you play, if enabled). Anything stored is encrypted on this PC.$\r$\n• Official covers (off by default): for games without a local cover, queries Steam (game number or exact name) and the Microsoft Store catalog; those stores receive what was searched.$\r$\n$\r$\nNETWORK AND UPDATES:$\r$\nAt launch, the app checks public GitHub releases. GitHub may receive normal connection data such as IP address, time, URL and app identification. Downloads only start when the user asks.$\r$\n$\r$\nNEXO SERVER — ALL OPTIONAL; ERROR REPORTS START ON:$\r$\nNexo has a server for account sync, error reports and telemetry. So the app can keep getting better, I ask you to leave the option below on: telemetry is one summary per day and carries nothing personal, only what helps us understand how the app behaves on other machines.$\r$\n• Telemetry: one anonymous summary per day, with version, system, hardware and monitors, how heavy Nexo is on the PC, daily averages, what limited the PC (processor, graphics card, memory or frame cap), app settings, screens and features used and what failed in the app; sent with a random code for this PC, no names, folders, programs, email or account. The summary of the current day goes as a partial, at most every 3 hours, and the complete one replaces it when the day ends.$\r$\n• Error reports (on by default; you can turn them off in Settings): the errors in the app log and the app's last steps before each one, without your user name, your folders or anything you typed. If a Google account is signed in to Nexo, its email goes along so the creator can tell you when it is fixed; you can untick it in Settings, and it is also removed from reports already sent.$\r$\n• Sync: only with Google sign-in and turned on in the app; each PC keeps an encrypted copy (preferences, profile, sessions and activity) and you choose what to bring from another PC.$\r$\n• Usage count (on by default; untick below or turn off in Settings): once a day the app only says “this PC opened today”, and the installer says when it installs, updates or uninstalls, with the version, the system and a scrambled PC code (SHA-256 of the Windows identifier with a Nexo-only prefix, scrambled again on the server): it cannot tell who you are nor be matched with another app. It lets the creator know how many people really use Nexo. Unticking sends a single “+1 turned off” count, with no code at all.$\r$\nTicking the first option below turns on telemetry; the second one is the usage count. You can change everything at any time in Settings > Privacy and data. Full policy on GitHub."
LangString TELEMETRY_LABEL 1046 "Ajudar a melhorar o Nexo: telemetria diária anônima"
LangString TELEMETRY_LABEL 1033 "Help improve Nexo: anonymous daily telemetry"
LangString COUNT_LABEL 1046 "Contar esta instalação nas estatísticas do Nexo (anônimo)"
LangString COUNT_LABEL 1033 "Count this install in Nexo's statistics (anonymous)"
LangString PRIVACY_PROJECT 1046 "Projeto e política de privacidade no GitHub"
LangString PRIVACY_PROJECT 1033 "Project and privacy policy on GitHub"
LangString PRIVACY_CREATOR 1046 "Perfil do criador"
LangString PRIVACY_CREATOR 1033 "Creator profile"

; Servidor do Nexo (o mesmo de config/server.json; um teste confere que os dois batem).
!define NEXO_SERVER "https://nexo-api.nexo-device-care.workers.dev"
; Contagem de uso: o instalador chama resources\count.ps1 escondido (prazo de 4 s; nunca trava nem falha a instalação).
!define NEXO_COUNT `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\count.ps1" -Server ${NEXO_SERVER}`

!ifndef BUILD_UNINSTALLER
Var DeveloperTelemetryConsent
Var CountConsent
Var CountBefore
Var NexoWasInstalled
Var NexoOldLocation

!macro customInit
  ReadRegDWORD $DeveloperTelemetryConsent HKCU "Software\NexoDeviceCare\Privacy" "DeveloperTelemetryOptIn"
  IfErrors 0 +2
    StrCpy $DeveloperTelemetryConsent 0
  ; Contagem de uso: ligada por padrão (sem a chave = 1).
  ClearErrors
  ReadRegDWORD $CountConsent HKCU "Software\NexoDeviceCare\Privacy" "CountOptIn"
  IfErrors 0 +2
    StrCpy $CountConsent 1
  StrCpy $CountBefore $CountConsent
  ; Já havia um Nexo instalado (atualização automática, Setup novo por cima ou pelo instalador visual)? Lido aqui,
  ; antes do desinstalador antigo rodar: assim só uma instalação de verdade conta como "instalou".
  StrCpy $NexoWasInstalled 0
  ${If} ${isUpdated}
    StrCpy $NexoWasInstalled 1
  ${EndIf}
  ReadRegStr $NexoOldLocation HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $NexoOldLocation != ""
    StrCpy $NexoWasInstalled 1
  ${EndIf}
  ReadRegStr $NexoOldLocation HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $NexoOldLocation != ""
    StrCpy $NexoWasInstalled 1
  ${EndIf}
  ; Quando o instalador substitui uma versão existente, o desinstalador antigo herda esta variável
  ; e NÃO apaga os dados do usuário (a limpeza total só vale para uma desinstalação de verdade).
  System::Call 'Kernel32::SetEnvironmentVariable(t "NEXO_KEEP", t "1")i'
!macroend

!include "nsDialogs.nsh"
!include "WinMessages.nsh"

Var PrivacyDialog
Var PrivacyDetails
Var TelemetryCheckbox
Var CountCheckbox

!macro customPageAfterChangeDir
  Page custom PrivacyPageCreate PrivacyPageLeave
!macroend

Function PrivacyPageCreate
  nsDialogs::Create 1018
  Pop $PrivacyDialog
  ${If} $PrivacyDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "$(PRIVACY_TITLE)"
  Pop $0
  ${NSD_CreateLabel} 0 15u 100% 13u "$(PRIVACY_SUBTITLE)"
  Pop $0

  ${NSD_CreateText} 0 31u 100% 63u "$(PRIVACY_DETAILS)"
  Pop $PrivacyDetails
  ${NSD_AddStyle} $PrivacyDetails ${ES_MULTILINE}|${ES_AUTOVSCROLL}|${ES_WANTRETURN}|${WS_HSCROLL}|${WS_VSCROLL}
  SendMessage $PrivacyDetails ${EM_SETREADONLY} 1 0

  ${NSD_CreateCheckBox} 0 96u 100% 11u "$(TELEMETRY_LABEL)"
  Pop $TelemetryCheckbox
  ${If} $DeveloperTelemetryConsent == 1
    ${NSD_SetState} $TelemetryCheckbox ${BST_CHECKED}
  ${Else}
    ${NSD_SetState} $TelemetryCheckbox ${BST_UNCHECKED}
  ${EndIf}

  ${NSD_CreateCheckBox} 0 107u 100% 11u "$(COUNT_LABEL)"
  Pop $CountCheckbox
  ${If} $CountConsent == 0
    ${NSD_SetState} $CountCheckbox ${BST_UNCHECKED}
  ${Else}
    ${NSD_SetState} $CountCheckbox ${BST_CHECKED}
  ${EndIf}

  ${NSD_CreateLink} 0 120u 57% 10u "$(PRIVACY_PROJECT)"
  Pop $0
  ${NSD_OnClick} $0 OpenProjectPrivacy
  ${NSD_CreateLink} 59% 120u 41% 10u "$(PRIVACY_CREATOR)"
  Pop $0
  ${NSD_OnClick} $0 OpenCreatorProfile

  nsDialogs::Show
FunctionEnd

Function PrivacyPageLeave
  ${NSD_GetState} $TelemetryCheckbox $DeveloperTelemetryConsent
  ${If} $DeveloperTelemetryConsent == ${BST_CHECKED}
    StrCpy $DeveloperTelemetryConsent 1
  ${Else}
    StrCpy $DeveloperTelemetryConsent 0
  ${EndIf}
  ${NSD_GetState} $CountCheckbox $CountConsent
  ${If} $CountConsent == ${BST_CHECKED}
    StrCpy $CountConsent 1
  ${Else}
    StrCpy $CountConsent 0
  ${EndIf}
FunctionEnd

Function OpenProjectPrivacy
  ExecShell "open" "https://github.com/Samuklvm/Project-Nexo/blob/main/PRIVACIDADE.md"
FunctionEnd

Function OpenCreatorProfile
  ExecShell "open" "https://github.com/Samuklvm"
FunctionEnd

!macro customInstall
  WriteRegDWORD HKCU "Software\NexoDeviceCare\Privacy" "DeveloperTelemetryOptIn" $DeveloperTelemetryConsent
  WriteRegDWORD HKCU "Software\NexoDeviceCare\Privacy" "CountOptIn" $CountConsent
  ; Contagem de uso: por cima de um Nexo que já existia (atualização automática ou manual) conta como "atualizou",
  ; nunca como instalação nova. Desmarcar a caixinha que estava marcada manda um único "+1 desligou", sem código;
  ; quem já estava desligado não manda de novo. Nada disso trava nem falha a instalação.
  ${If} $CountConsent == 1
    ${If} $NexoWasInstalled == 1
      nsExec::Exec `${NEXO_COUNT} -Version ${VERSION} -Event atualizou`
    ${Else}
      nsExec::Exec `${NEXO_COUNT} -Version ${VERSION} -Event instalou`
    ${EndIf}
    Pop $0
  ${ElseIf} $CountBefore != 0
    nsExec::Exec `${NEXO_COUNT} -Version ${VERSION} -Event optout`
    Pop $0
  ${EndIf}
!macroend
!endif

!ifdef BUILD_UNINSTALLER
; Limpeza total na desinstalação de verdade: dados, preferências, caches, atalhos e Registro.
; Mantenha esta lista alinhada com buildRemovalScript() em main.cjs.
;  - NEXO_KEEP=1  -> atualização/reinstalação feita pelo instalador: nada é apagado.
;  - NEXO_PURGE=1 -> desinstalação silenciosa pedida pelo próprio app: apaga tudo.
;  - Desinstalação interativa (Configurações do Windows): apaga tudo.
!macro customUnInstall
  Push $R0
  Push $R1
  ReadEnvStr $R0 "NEXO_KEEP"
  ${If} $R0 == ""
    ReadEnvStr $R1 "NEXO_PURGE"
    ${IfNot} ${Silent}
      StrCpy $R1 "1"
    ${EndIf}
    ${If} $R1 == "1"
      ; Contagem de uso: avisa "desinstalou" ANTES de apagar o Registro (onde está a escolha) e o app (onde está o script).
      ClearErrors
      ReadRegDWORD $R0 HKCU "Software\NexoDeviceCare\Privacy" "CountOptIn"
      ${If} ${Errors}
      ${OrIf} $R0 != 0
        ${If} ${FileExists} "$INSTDIR\resources\count.ps1"
          nsExec::Exec `${NEXO_COUNT} -Version ${VERSION} -Event desinstalou`
          Pop $0
        ${EndIf}
      ${EndIf}
      RMDir /r "$APPDATA\nexo-device-care"
      RMDir /r "$APPDATA\Nexo Device Care"
      RMDir /r "$LOCALAPPDATA\nexo-device-care"
      RMDir /r "$LOCALAPPDATA\nexo-device-care-updater"
      DeleteRegKey HKCU "Software\NexoDeviceCare"
      Delete "$DESKTOP\Nexo Device Care.lnk"
      Delete "$SMPROGRAMS\Nexo Device Care.lnk"
      RMDir /r "$SMPROGRAMS\Nexo Device Care"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NexoDeviceCare"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "NexoDeviceCare"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "NexoLabRecovery"
      ; Serviço de sensores (temperatura) e PawnIO instalado pelo Nexo: precisam de administrador (o Windows pede o UAC).
      SetRegView 64
      ReadRegStr $R0 HKLM "SOFTWARE\NexoDeviceCare\SensorService" "Version"
      SetRegView lastused
      ${If} $R0 != ""
        ${If} ${FileExists} "$INSTDIR\resources\sensor-host\Nexo.SensorHost.exe"
          ExecShellWait "runas" "$INSTDIR\resources\sensor-host\Nexo.SensorHost.exe" "--remove-service" SW_HIDE
        ${EndIf}
      ${EndIf}
      ; Planos de energia criados pelo laboratório: volta ao Equilibrado se um deles estiver ativo e apaga todos.
      nsExec::Exec `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$$a = (powercfg /getactivescheme | Out-String); foreach ($$l in (powercfg /list)) { if ($$l -match 'Nexo (Lab|.{1,3}Ajustado)' -and $$l -match '([0-9a-fA-F]{8}-[0-9a-fA-F-]{27})') { $$g = $$Matches[1]; if ($$a -match $$g) { powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e | Out-Null }; powercfg /delete $$g | Out-Null } }"`
      Pop $0
    ${EndIf}
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend
!endif
