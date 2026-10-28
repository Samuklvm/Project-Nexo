!include "nsDialogs.nsh"
!include "WinMessages.nsh"

Var PrivacyDialog
Var PrivacyDetails
Var TelemetryCheckbox
Var DeveloperTelemetryConsent

LangString PRIVACY_TITLE 1046 "Privacidade e transparência"
LangString PRIVACY_SUBTITLE 1046 "A coleta local mantém recursos do app; compartilhar com o criador é opcional."
LangString PRIVACY_DETAILS 1046 "COLETA LOCAL — ATIVA PARA OS RECURSOS DO APP:$\r$\n• Painel: nome do computador, versão do Windows e do app, tempo ligado, uso de CPU, RAM total/livre/usada, indicador local de conexão (sim/não) e discos fixos (letra, rótulo, sistema de arquivos, total/livre/usado). Endereços de rede só são examinados localmente para obter o indicador; o Nexo não os guarda nem envia.$\r$\n• GPU NVIDIA compatível: temperatura, uso e memória usada/total. Sensores ACPI: temperatura reportada pelo firmware.$\r$\n• Diagnóstico: PID, nome e uso de CPU/memória dos cinco processos com maior consumo de cada recurso, calculados neste PC.$\r$\n• Limpeza: caminho e tamanho de arquivos temporários antigos, exibidos para prévia e remoção local.$\r$\n• Perfil local: amostras de CPU/RAM/disco/GPU e temperaturas locais a cada minuto (até 7 dias); feedback (categoria, útil/não útil e horário; até 100); título, detalhe e horário das últimas 20 atividades; papel de parede escolhido (até 5 MB); configuração e horário da limpeza automática. Gráficos da sessão ficam em memória por até 5 minutos.$\r$\n$\r$\nREDE E ATUALIZAÇÕES:$\r$\nAo abrir, o app consulta as releases públicas do GitHub. O GitHub pode receber dados normais da conexão, como endereço IP, horário, URL e identificação do app. O download só começa por ação da pessoa.$\r$\n$\r$\nCOMPARTILHAMENTO COM O CRIADOR — OPCIONAL:$\r$\nA opção abaixo começa desativada. Nesta versão, marcar ou desmarcar apenas salva sua preferência neste computador; o Nexo não envia telemetria ao criador. Uma versão futura só poderá enviar dados após informar os campos exatos, finalidade, destino, retenção e como revogar a autorização."
LangString PRIVACY_TITLE 1033 "Privacy and transparency"
LangString PRIVACY_SUBTITLE 1033 "Local collection supports app features; sharing with the creator is optional."
LangString PRIVACY_DETAILS 1033 "LOCAL COLLECTION — ACTIVE FOR APP FEATURES:$\r$\n• Dashboard: computer name, Windows and app version, uptime, CPU use, RAM total/free/used, local connectivity indicator (yes/no), and fixed disks (letter, label, file system, total/free/used). Network addresses are examined locally only to calculate the indicator; Nexo does not store or send them.$\r$\n• Compatible NVIDIA GPU: temperature, utilization and memory used/total. ACPI sensors: firmware-reported temperature.$\r$\n• Diagnostics: PID, name and CPU/memory use of the five highest-consuming processes for each resource, calculated on this PC.$\r$\n• Cleanup: path and size of old temporary files, shown for local preview and removal.$\r$\n• Local profile: CPU/RAM/disk/GPU and local temperature samples every minute (up to 7 days); feedback (category, helpful/not helpful and time; up to 100); title, details and time of the last 20 activities; chosen wallpaper (up to 5 MB); automatic-cleanup setting and last-run time. Session charts stay in memory for up to 5 minutes.$\r$\n$\r$\nNETWORK AND UPDATES:$\r$\nAt launch, the app checks public GitHub releases. GitHub may receive normal connection data such as IP address, time, URL and app identification. Downloads only start when the user asks.$\r$\n$\r$\nSHARING WITH THE CREATOR — OPTIONAL:$\r$\nThe option below is off by default. In this version, checking or unchecking only saves your preference on this computer; Nexo does not send telemetry to the creator. A future version may send data only after listing the exact fields, purpose, destination, retention and how to withdraw consent."
LangString TELEMETRY_LABEL 1046 "Ativar compartilhamento opcional com o criador (desativado por padrão)"
LangString TELEMETRY_LABEL 1033 "Enable optional sharing with the creator (off by default)"
LangString PRIVACY_PROJECT 1046 "Projeto e política de privacidade no GitHub"
LangString PRIVACY_PROJECT 1033 "Project and privacy policy on GitHub"
LangString PRIVACY_CREATOR 1046 "Perfil do criador"
LangString PRIVACY_CREATOR 1033 "Creator profile"

!macro customInit
  ReadRegDWORD $DeveloperTelemetryConsent HKCU "Software\NexoDeviceCare\Privacy" "DeveloperTelemetryOptIn"
  IfErrors 0 +2
    StrCpy $DeveloperTelemetryConsent 0
!macroend

!macro customPageAfterChangeDir
  !insertmacro skipPageIfUpdated
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

  ${NSD_CreateCheckBox} 0 98u 100% 12u "$(TELEMETRY_LABEL)"
  Pop $TelemetryCheckbox
  ${If} $DeveloperTelemetryConsent == 1
    ${NSD_SetState} $TelemetryCheckbox ${BST_CHECKED}
  ${Else}
    ${NSD_SetState} $TelemetryCheckbox ${BST_UNCHECKED}
  ${EndIf}

  ${NSD_CreateLink} 0 115u 57% 10u "$(PRIVACY_PROJECT)"
  Pop $0
  ${NSD_OnClick} $0 OpenProjectPrivacy
  ${NSD_CreateLink} 59% 115u 41% 10u "$(PRIVACY_CREATOR)"
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
FunctionEnd

Function OpenProjectPrivacy
  ExecShell "open" "https://github.com/Samuklvm/Project-Nexo/blob/main/PRIVACIDADE.md"
FunctionEnd

Function OpenCreatorProfile
  ExecShell "open" "https://github.com/Samuklvm"
FunctionEnd

!macro customInstall
  WriteRegDWORD HKCU "Software\NexoDeviceCare\Privacy" "DeveloperTelemetryOptIn" $DeveloperTelemetryConsent
!macroend
