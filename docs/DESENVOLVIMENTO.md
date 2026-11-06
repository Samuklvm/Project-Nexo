# Para desenvolvedores

Português · [English](DEVELOPMENT.md)

## Rodar em desenvolvimento

**Windows:** Node.js 20 ou superior e .NET SDK 10 (para compilar o coletor de sensores).

```powershell
npm install
npm run build:sensors
npm start
```

**Linux:** Node.js 20 ou superior. O coletor .NET não é usado: os sensores vêm do kernel.

```bash
npm install
npm start
```

Outros comandos:

```bash
npm test          # testes do motor de análise, sessões, FPS, IPC, laboratório, biblioteca, conexões e Linux
npm run preview   # gera dev/preview.html: a interface num navegador, com dados fictícios
```

Visão técnica, contratos e plano de fases: [ARQUITETURA.md](ARQUITETURA.md).

## Gerar os instaladores

| Comando | Resultado |
|---|---|
| `npm run dist` | `release/Nexo-Setup-X.exe` (NSIS). É o que o atualizador automático usa. |
| `npm run build:launcher` | `installer-launcher/dist/Nexo-Instalador-X.exe`, o instalador visual (arte, opções, avisos, PT/EN). Ele embute o `Nexo-Setup` e o executa em modo silencioso. Rode depois de `npm run dist`. |
| `npm run dist:linux` | AppImage e `.deb` (rode no Linux). |

A privacidade e os avisos aparecem no instalador visual e no assistente NSIS. O compartilhamento com o criador começa desativado.

## Publicar uma versão

1. Altere `version` em `package.json`, `package-lock.json` e `installer-launcher/package.json`.
2. Escreva as notas em `docs/releases/vX.Y.Z.md` (português primeiro, depois inglês) e atualize o `CHANGELOG.md`.
3. Crie a tag `vX.Y.Z` (no GitHub, em **Releases → Draft a new release**, ou com `git push origin vX.Y.Z`).

A GitHub Action confere se a tag bate com a versão, roda os testes, compila o coletor .NET, publica o `Nexo-Setup` e o instalador visual (Windows) e o AppImage e o `.deb` (Linux) na mesma release, e usa o texto de `docs/releases/vX.Y.Z.md` como notas.

O app instalado verifica atualizações ao iniciar e só baixa quando a pessoa pede. O atualizador funciona apenas na versão empacotada, e o repositório e as releases precisam ser públicos.

### Segredos do repositório (Settings → Secrets and variables → Actions)

| Segredo | Para quê |
|---|---|
| `GOOGLE_OAUTH_JSON` | Cliente OAuth “App para computador” do Google. Veja [LOGIN_GOOGLE.md](LOGIN_GOOGLE.md). |
| `NEXO_INTEGRATIONS_JSON` | Opcional: `{"xboxClientId":"…"}` para o login com Xbox. O Discord já vem com o app oficial embutido. Veja [CONEXOES.md](CONEXOES.md). |
| `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD` | Opcional: certificado Authenticode (`.pfx`) para assinar os executáveis. Sem eles a release sai sem assinatura. Assine o instalador visual e o Setup com o mesmo certificado, porque um executável que roda outro em modo silencioso costuma chamar a atenção de antivírus e do SmartScreen. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e `NEXO_ADMIN_EMAILS` | Servidor do Nexo (sincronização, erros e telemetria), publicado pelo fluxo **Publicar servidor**. Veja [SERVIDOR.md](SERVIDOR.md). |

## FPS: PresentMon (Windows)

O FPS vem do **PresentMon** (Intel, licença MIT), executado como programa separado só quando a pessoa liga a opção na sessão. O usuário precisa estar no grupo **Performance Log Users** (ou o Nexo rodar como administrador). O Nexo libera isso quando a pessoa pede, com UAC, registra no Diário e permite reverter.

- **Versão e integridade:** `third-party/presentmon.lock.json` guarda a versão e o SHA-256. Enquanto o hash não estiver fixado, a build não embute o executável. Para fixar: `npm run presentmon:hash`, compare com o digest da página da release do PresentMon e cole em `sha256`. Sem isso, **Sessões → Componentes → Escolher PresentMon…** aceita um arquivo baixado do site oficial.
- O Nexo só lê eventos do Windows e não injeta nada no jogo. A compatibilidade com anti-cheat não foi validada.

## Linux em detalhe

| Recurso | Windows | Linux |
|---|---|---|
| Sensores | LibreHardwareMonitor (sensor-host .NET) | `/sys/class/hwmon`, `cpufreq`, `gpu_busy_percent` (AMD) e `nvidia-smi` |
| Programas e sessões | PowerShell e contadores do Windows | `/proc` e `xprop` (X11 e XWayland; no Wayland puro a detecção automática de jogo não funciona) |
| FPS | PresentMon | MangoHud (o Nexo lê o log; a opção de inicialização fica pronta em Sessões) |
| Energia | planos do Windows (`powercfg`) | perfis do power-profiles-daemon |
| Laboratório (beta) | 71 ajustes ocultos de energia (processador, núcleos, estados ociosos, núcleos híbridos, SATA/NVMe, PCIe, Wi-Fi), 9 testes, combinações inéditas, ponto de restauração; Raio-X de 109 ajustes (registro, serviços, plano ativo); teste com reinício (ABBA) | perfis de energia, sem root |
| Limpeza | temporários, relatórios de falha, WER, Lixeira | `/tmp`, miniaturas, relatórios do apport, Lixeira freedesktop |
| Otimizar unidade | `defrag` (UAC) | `fstrim` (pkexec) |
| SFC, Performance Log Users, jogos do app Xbox | sim | não existem no Linux |

## Desinstalação completa (Windows)

Pelas Configurações do Windows ou por **Ajustes → Desinstalar o Nexo** são removidos: o programa, os dados e preferências (`%APPDATA%\nexo-device-care`, inclusive capas, conta e laboratório), os caches e o cache do atualizador (`%LOCALAPPDATA%`), os atalhos, a chave `HKCU\Software\NexoDeviceCare`, as entradas `Run`/`RunOnce` do Nexo, os planos de energia criados pelo laboratório e a entrada de desinstalação. Pelo app, ele também oferece tirar o usuário do grupo Performance Log Users e apaga os rastros que o Windows guarda sobre o Nexo (MuiCache, UserAssist e itens Recentes). Atualizações **não** apagam os dados.

Fora do alcance de um programa sem administrador: logs de eventos do Windows, Prefetch e histórico do antivírus. Pontos de restauração criados antes do laboratório continuam com o Windows.

## Limites

- As leituras dependem do hardware, do firmware e da LibreHardwareMonitorLib. No Windows, temperaturas do processador e da placa-mãe vêm do serviço `NexoSensors` (coletor com `--service`, driver PawnIO); sem ele, o coletor roda como processo comum, sem essas leituras.
- O diagnóstico indica possibilidades, não comprova causas, e o Nexo **nunca encerra processos**.
- A limpeza remove só arquivos regulares com mais de 7 dias, ignora links e para em 5.000 arquivos por execução. A limpeza automática considera só a pasta temporária e exige quatro leituras e 60 segundos com o disco acima de 90%, no máximo uma vez por hora.
- No navegador (`npm run preview`), as ações que dependem do computador usam dados fictícios.
