# Nexo Device Care

Aplicativo desktop para Windows e Linux que cuida do computador: mede, explica o que está pesando, aprende a rotina de uso e oferece ações reais de manutenção, sempre com prévia e confirmação. É gratuito, de código aberto e processa tudo localmente. As recomendações são heurísticas e **não prometem** aumentar o desempenho em todos os PCs.

## Novidades da 0.6.1

- **Discord:** o status mostra o jogo que o Nexo está medindo, com o ícone oficial e um botão para baixar o Nexo. Funciona sem configurar nada.
- **Entrar com Google** ativado.

## Novidades da 0.6.0

- **Linux:** o Nexo agora roda no Linux (AppImage e `.deb`), com sensores, sessões, FPS pelo MangoHud, biblioteca Steam/Heroic, perfis de energia e laboratório. Veja a seção [Linux](#linux).
- **Página de cada jogo como numa loja:** visão geral com capturas e requisitos, **suas conquistas** (com raridade global), **novidades e atualizações oficiais** e o desempenho medido neste PC.
- **Capas oficiais** (Steam, Microsoft Store e Xbox), **contas conectadas** (Steam deste PC, Steam Web API, Xbox, Discord Rich Presence).
- **Mais leve em PC fraco:** modo leve automático, animações pausadas sem foco, leituras espaçadas em segundo plano e o custo real do Nexo em Ajustes.

Notas completas: [`docs/releases/v0.6.1.md`](docs/releases/v0.6.1.md) e [`docs/releases/v0.6.0.md`](docs/releases/v0.6.0.md) · Histórico: [`CHANGELOG.md`](CHANGELOG.md)

## O que ele faz

- **Início:** Índice Nexo (0 a 100) explicado fator por fator, medições ao vivo com miniaturas, mapa do sistema em órbitas (cada componente é um planeta), gráficos de 5 minutos a 7 dias com dica ao passar o mouse, e as principais observações do momento.
- **Sessões de observação:** grave o PC enquanto joga ou trabalha e receba um relatório. Ele diz se o limite foi a GPU, um único núcleo da CPU, a memória, o calor ou um programa em segundo plano, **sempre com a evidência e os limites**. Detecta jogos pela pasta de instalação (nunca lê a memória do jogo), mede o custo do próprio Nexo e, com o PresentMon, mede FPS, 1% baixo e tempo de quadro.
- **Jogos:** biblioteca no estilo de uma loja: destaque com a arte larga e o logo oficiais, prateleiras “Continue jogando” e “Mais jogados”, página de cada jogo como na loja — visão geral (descrição, capturas, gêneros, desenvolvedora, lançamento, Metacritic, requisitos), **suas conquistas** (desbloqueadas com data, raridade global, ocultas sem spoiler), **novidades e atualizações oficiais** e o FPS de cada sessão gravada — e **todos os jogos instalados** (Steam, Epic, GOG, Xbox/Game Pass, EA, Ubisoft, Battle.net, Riot, Rockstar e os que você adicionar), capas do cache local de cada launcher, destaque do último jogado, filtros, “Jogar” e “Jogar e gravar”, e o desempenho de cada jogo nas sessões gravadas. Opcional: gravar a sessão sozinho quando um jogo abre (e guardar o relatório quando fecha), com a bandeja.
- **Otimização extrema (beta, arriscada):** um laboratório autônomo que testa **na hora, neste PC**, combinações de ajustes ocultos do processador (EPP, modo de turbo, estacionamento de núcleos, política de aumento, resfriamento…) num **clone temporário** do plano de energia, com ponto de restauração antes, medição A/B intercalada contra o ruído e guardas (tomada, temperatura, aquecimento, erros graves do Windows). Aprende entre execuções (o que nunca foi testado aqui vem primeiro; depois, o que mais rendeu) e, no modo autônomo, adota sozinho só o que a medição confirmou. Sessões de risco ficam marcadas no app inteiro e no Diário.
- **Atlas de opções:** todas as alavancas que valem conhecer — famosas, pouco conhecidas e boatos —, cada uma com o que o Nexo faz (testa, faz, confere, desaconselha ou se recusa) e o que ele conferiu neste PC (XMP desligado, monitor a 60 Hz, memória em um canal, captura em segundo plano…).
- **Conta Google (opcional):** login pelo navegador, sem guardar senhas nem tokens (`docs/LOGIN_GOOGLE.md`).
- **Contas de jogos (opcionais):** Steam deste PC (tempo de jogo, sem senha), Steam Web API com a chave da própria pessoa (jogos não instalados), conta Xbox (gamertag e histórico com artes oficiais) e Discord Rich Presence. Capas **oficiais** das lojas (Steam e Microsoft Store), nunca arte de fã. Configuração em `docs/CONEXOES.md`.
- **Leve em PC fraco:** modo leve automático na primeira abertura (até 4 núcleos ou menos de 8 GB), animações pausadas com a janela sem foco, leituras 6× mais espaçadas em segundo plano, estrelas do fundo desenhadas só enquanto passam, imagens reduzidas ao tamanho exibido e cartões fora da tela sem pintura. O custo real do Nexo aparece em Ajustes.
- **Perfil de uso:** Jogos, Trabalho e criação ou Uso geral, escolhido por você. Muda o peso dos fatores no índice, a ordem das observações e o que as sessões destacam.
- **Análise inteligente:** compara o presente com a sua rotina e mostra a causa provável **com a evidência**. Inclui lentidões detectadas, programas que mais atrapalham, previsão de quando o disco enche, indício de queda de clock por calor, mapa da rotina por dia e hora e leitura sob demanda dos processos.
- **Otimizar:** limpeza segura por categorias (temporários antigos, relatórios de falha, relatórios de erro do Windows e, opcionalmente, Lixeira), limpeza automática opcional, troca do plano de energia do Windows e lista dos programas que iniciam com o Windows. Cada operação tem uma ficha (risco, reversão, fonte oficial, como medimos e estado de validação). O plano de energia pode ser **medido antes e depois** com um benchmark de CPU de cerca de 20 segundos e revertido depois.
- **Atividade:** Diário de alterações com valor anterior, risco, autorização, medição e botão **Reverter** (avisa se o estado mudou desde então).
- **Hardware:** explorador de sensores locais (CPU, GPU, placa-mãe, memória, armazenamento, rede, bateria e mais), com busca, filtros e exportação em CSV.
- **Manutenção:** otimização de unidades e verificação de arquivos do sistema (SFC), pelas ferramentas nativas do Windows.
- **Ajustes:** papel de parede (o padrão é a arte do instalador), modo de efeitos leve, exportar ou apagar os seus dados, e desinstalação completa.
- **Paleta de comandos:** `Ctrl+K` para ir a qualquer página ou ação.

### Como o "aprendizado" funciona (sem exagero)

Não há modelo de IA. O motor (`src/brain.js`, com testes em `tests/`) faz quatro coisas simples e verificáveis:

1. Guarda médias e variações de CPU, RAM, disco, GPU e temperatura para cada uma das 168 horas da semana. Assim sabe o que é "normal" numa terça às 15h. Minutos de lentidão não entram na média, para não virarem o novo normal.
2. Detecta episódios sustentados (CPU alta, memória no limite, temperatura alta, queda de clock com calor).
3. Registra qual programa estava no topo do consumo durante cada episódio e conta os reincidentes.
4. Ajusta a confiança de cada tipo de sugestão conforme o seu feedback ("ajudou" ou "não ajudou").

Tudo fica neste computador e pode ser exportado ou apagado em **Ajustes**.

Visão técnica, contratos e plano de fases: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Executar em desenvolvimento

Requisitos: Windows, Node.js 20 ou superior e .NET SDK 10 para compilar o coletor de sensores.

```powershell
npm install
npm run build:sensors
npm start
```

Outros comandos:

```powershell
npm test         # 53 testes: motor de análise, sessões, FPS, IPC do main.cjs e diário/catálogo
npm run preview  # gera dev/preview.html: abre a interface num navegador, com dados fictícios
```

## Linux

O Nexo roda no Linux com as mesmas telas. O que muda é de onde vêm os dados e quais ações existem:

| Recurso | Windows | Linux |
|---|---|---|
| Sensores | LibreHardwareMonitor (sensor-host .NET) | `/sys/class/hwmon`, `cpufreq`, `gpu_busy_percent` (AMD) e `nvidia-smi` |
| Programas e sessões | PowerShell + contadores do Windows | `/proc` + `xprop` (X11 e XWayland; no Wayland puro a detecção automática de jogo não funciona) |
| FPS | PresentMon | MangoHud (o Nexo lê o log; opção de inicialização pronta em Sessões) |
| Energia | planos do Windows (`powercfg`) | perfis do power-profiles-daemon |
| Laboratório (beta) | 7 ajustes ocultos do processador, ponto de restauração | perfis de energia (sem root); ajustes finos exigiriam root a cada mudança |
| Limpeza | temporários, relatórios de falha, WER, Lixeira | `/tmp`, miniaturas, relatórios do apport, Lixeira freedesktop |
| Otimizar unidade | `defrag` (UAC) | `fstrim` (pkexec) |
| SFC, grupo Performance Log Users, Xbox instalado | sim | não existem no Linux |
| Biblioteca | Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot, Rockstar | Steam (nativa, Flatpak, Snap; Proton incluso) e Heroic (Epic e GOG) |
| Instalação | instalador NSIS + instalador visual | AppImage (qualquer distribuição) e `.deb` |

Gerar: `npm run dist:linux` (no Linux). Pacotes recomendados: `power-profiles-daemon`, `mangohud`, `x11-utils` (xprop), `lm-sensors`, `policykit-1`. No GNOME, o ícone da bandeja precisa da extensão AppIndicator.

## Medição de FPS (PresentMon)

O FPS vem do **PresentMon** (Intel, licença MIT), executado como programa separado só quando você liga a opção na sessão. Requisitos do próprio PresentMon: o seu usuário precisa estar no grupo **“Performance Log Users”** (ou o Nexo rodar como administrador). O Nexo **libera isso sozinho** quando você pede (o Windows mostra o UAC; vale depois de sair e entrar de novo no Windows) e registra no Diário, com reversão.

- **Versão e integridade:** `third-party/presentmon.lock.json` guarda a versão (2.6.0) e o SHA-256. **O hash ainda não está fixado**, então a build não embute o executável. Para fixar: `npm run presentmon:hash`, compare o resultado com o digest mostrado pelo GitHub na página da release e cole em `sha256`. Enquanto isso, **Sessões → Componentes → Escolher PresentMon…** aceita um arquivo baixado por você do site oficial.
- A compatibilidade com jogos que usam anti-cheat **não foi validada**: o Nexo só lê eventos do Windows e não injeta nada no jogo, mas teste antes de confiar.

## Instalador e desinstalador

- **`npm run dist`** gera `release/Nexo-Setup-X.exe` (NSIS), o instalador "de verdade". É ele que o atualizador automático usa.
- **`installer-launcher/`** é o instalador visual (janela com a arte, opções, avisos e idioma PT/EN). Ele embute o `Nexo-Setup` e o executa em modo silencioso. Gere com `npm run build:launcher` (depois de `npm run dist`); o resultado fica em `installer-launcher/dist/Nexo-Instalador-X.exe`. Veja `installer-launcher/README.md`.
- A privacidade e os avisos aparecem no launcher e no assistente NSIS. O compartilhamento com o criador começa desativado.

### Desinstalação completa

Pelas Configurações do Windows ou por **Ajustes → Desinstalar o Nexo**, são removidos: o programa, os dados e preferências (`%APPDATA%\nexo-device-care`, inclusive capas, conta e laboratório), os caches e o cache do atualizador (`%LOCALAPPDATA%`), atalhos, a chave `HKCU\Software\NexoDeviceCare`, as entradas `Run`/`RunOnce` do Nexo, os planos de energia criados pelo laboratório e a entrada de desinstalação. Pelo app, ele ainda oferece tirar o seu usuário do grupo “Performance Log Users”. O caminho por **Ajustes** também apaga os rastros que o próprio Windows guarda sobre o Nexo (MuiCache, UserAssist e itens Recentes) e mostra ao final o que não conseguiu apagar. Atualizações **não** apagam os seus dados.

Fora do alcance de um programa sem administrador: logs de eventos do Windows, Prefetch e histórico do antivírus. Pontos de restauração criados antes do laboratório continuam com o Windows (são proteção sua; apague em Proteção do Sistema, se quiser).

## Publicar uma versão

1. Altere `version` em `package.json` (e em `installer-launcher/package.json`) e envie o commit.
2. Crie uma tag `v` seguida exatamente da mesma versão. Para a `0.3.0`:

   ```powershell
   git tag v0.3.0
   git push origin v0.3.0
   ```

3. A GitHub Action roda os testes, compila o coletor .NET, publica o instalador NSIS e anexa o instalador visual à release. Se o passo do instalador visual falhar, a release principal continua publicada.

O app instalado verifica atualizações ao iniciar e mostra a versão disponível na aba **Atualizações**. O download só começa quando a pessoa seleciona **Baixar atualização**. O atualizador funciona apenas na versão empacotada, e o repositório e as releases devem ser públicos.

### Assinatura digital

A compilação aceita um certificado Authenticode sem guardá-lo no repositório. Adicione em **Settings → Secrets and variables → Actions**: `WIN_CSC_LINK` (caminho/URL privada ou Base64 do `.pfx`) e `WIN_CSC_KEY_PASSWORD`. Sem eles a release é criada sem assinatura. Assine o launcher e o Setup com o mesmo certificado: um executável que roda outro em modo silencioso é um padrão que antivírus e o SmartScreen costumam estranhar.

## Limites e privacidade

- A disponibilidade das leituras depende do hardware, do firmware e da LibreHardwareMonitorLib. O Nexo não instala drivers de kernel.
- O diagnóstico indica possibilidades; não comprova causas e **nunca encerra processos**.
- A limpeza remove só arquivos regulares antigos (mais de 7 dias), ignora links e limita-se a 5.000 arquivos por execução. A "Limpeza automática" considera somente a pasta temporária e exige quatro leituras e 60 segundos com o disco acima de 90%, no máximo uma vez por hora.
- Trocar o plano de energia, otimizar unidades e verificar o sistema são ações explícitas; algumas podem pedir permissão de administrador ao Windows.
- Nada é enviado a servidores, exceto a consulta pública de atualizações ao GitHub. Consulte [PRIVACIDADE.md](PRIVACIDADE.md) para o inventário completo.
- No navegador (`npm run preview`), as ações que dependem do computador usam dados fictícios.
