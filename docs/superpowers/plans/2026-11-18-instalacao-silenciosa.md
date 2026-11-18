# Instalação silenciosa ("Baixar e instalar") — desenho e plano

**Pedido do Samuel (18/11/2026):** um clique em "Baixar e instalar", de qualquer fonte (AMD inclusive), sem janela de
instalador, recusando telemetria. Caminho escolhido para a AMD: a página da AMD abre dentro do Nexo, a pessoa clica no
Download da própria AMD (é o aceite da licença) e o Nexo faz o resto.

## Regras que valem para tudo
- Nunca Windows Update; download só do site oficial; assinatura conferida antes de rodar (igual a hoje).
- "Saber ou não saber": modo silencioso só com os parâmetros que o Nexo conhece. Instalador de tipo desconhecido abre a
  janela, e o cartão diz por quê. Instalador que trava no modo silencioso é encerrado e o cartão oferece "Instalar com janela".
- Os parâmetros saem de uma tabela fechada no processo principal (`electron/silent-install.cjs`); a tela só manda o id do
  cartão e "com ou sem janela". Nenhum texto da tela vira argumento de linha de comando.
- Nada de fingir o referrer da AMD: o download da AMD sai da página dela, com o clique da pessoa.
- Licença: na primeira instalação sem janela, o Nexo avisa que aceita a licença de cada fabricante (a mesma que a janela
  mostraria) e recusa telemetria onde o instalador deixa escolher. Há uma chave "Instalar sem janelas" (ligada).

## Perfis (tabela fechada)
| perfil | quem | argumentos | códigos |
|---|---|---|---|
| `nvidia` | driver NVIDIA | `Display.Driver HDAudio.Driver PhysX -s -noreboot -noeula -nofinish -nosplash` (só o driver: sem NVIDIA App = sem telemetria) | 0 ok |
| `amd` | AMD Software (Adrenalin) | `-install` | 0 ok |
| `burn` | VC++ 2012+, .NET, assistente da Intel (WiX) | `/install /quiet /norestart` | 0, 3010 reiniciar, 1638 já tem |
| `vc2005`, `vc2008` | VC++ antigos | `/q` | 0, 3010 |
| `vc2010` | VC++ 2010 | `/q /norestart` | 0, 3010 |
| `dell` | Dell Update Package | `/s` | 0 ok, 2 reiniciar, 3 já tem, 5 não serve |
| `hp` | HP SoftPaq | `/s` | 0, 3010 |
| `inno` | Lenovo e Inno em geral | `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-` | 0 |
| `nsis` | NSIS (SteelSeries GG etc.) | `/S` | 0 |
| `msi` | .msi | `msiexec /i <arq> /qn /norestart` | 0, 3010, 1641 |
| `installshield` | InstallShield | `/s /v"/qn REBOOT=ReallySuppress"` | 0, 3010 |
| `lghub` | Logitech G HUB | `--silent` | 0 |
| `detect` | o resto | lê o começo do .exe: Inno → `inno`, Nullsoft → `nsis`, WiX Burn → `burn`, InstallShield → `installshield`; nada conhecido → janela | — |

Tempo-limite do modo silencioso: 45 min (NVIDIA/AMD 60). Passou: encerra a árvore do processo e devolve `hung`.

## Tarefas
1. `electron/silent-install.cjs`: `PROFILES`, `profileFor(name)`, `outcome(profile, code)`, `detectScript` (PowerShell que lê
   até 8 MB e devolve o tipo). Testes.
2. `electron/elevate.cjs`: `driver-install` aceita `silent` (nome de perfil ou `false`); valida na tabela; roda escondido com
   tempo-limite e encerra a árvore; `detect` escolhe o perfil antes; tipo desconhecido abre janela (`windowed`). Testes no texto.
3. `src/drivers.js`: cada plano ganha `silent`; rótulo "Baixar e instalar"; cartões da AMD ganham download `via: 'amd-site'`. Testes.
4. `electron/driver-download.cjs`: plano guarda `silent`; `start(id, plan, { auto })` instala sozinho quando fica pronto e emite
   `drivers:auto-installed`; `external(id, plan)` / `progress` / `arrived` / `failed` para download feito pela página da AMD;
   resultados `hung`, `windowed`, `nothing` (Dell 3, burn 1638), `notApplicable` (Dell 5). Testes.
5. `electron/amd-site.cjs` (navegação só em amd.com, download só de drivers.amd.com .exe, perfil pelo nome do arquivo) +
   janela no `main.cjs` (sandbox, sessão própria) + assinante "Advanced Micro Devices, Inc.". Testes das regras puras.
6. Tela: um botão só, resultado automático tratado igual ao clique, aviso de licença na primeira vez, chave "Instalar sem
   janelas", "Instalar com janela" quando trava/desconhecido, fase "esperando você no site da AMD"; mock e preview.
7. Doc `claude/pendente-proxima-versao.md` (texto PT/EN + o que conferir no Windows), revisão final, correções, main.

## Review Focus
- Instalador que pede algo na tela no modo silencioso (fica parado escondido) → tem de encerrar e oferecer janela.
- Código de saída "já instalado" tratado como sucesso falso → precisa virar "nada mudou".
- Página da AMD navegando para fora do amd.com ou baixando de outro host → bloqueia.
- Renderer tentando mandar parâmetros → impossível (só nome de perfil validado no main e no elevate).
- Fechar a janela da AMD no meio do download → cartão volta ao normal, sem arquivo pela metade.
