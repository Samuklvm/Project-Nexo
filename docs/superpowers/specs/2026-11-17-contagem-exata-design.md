# Contagem exata de usuários (projeto 2 de 5)

Sessão do servidor, sincronização e acesso do Claude ao painel (17/11/2026). Vem depois do conector do Claude
(`2026-11-17-conector-claude-design.md`).

## Por quê

O Samuel quer saber **exatamente** quantas pessoas baixaram e usaram o Nexo. Hoje existem dois números, e nenhum serve:

- **O do GitHub** é impreciso: conta até ele mesmo abrindo a página para revisar.
- **O do servidor** só enxerga quem mandou telemetria (desligada por padrão) ou relatório de erro (só sai quando
  acontece um erro). Quem usa o app sem erro e com a telemetria desligada fica invisível.

Também quer ver o caminho inteiro de quem chega (instalou → abriu → virou usuário → continua usando) e a saúde de cada
versão.

## Decisões do Samuel

- **Sinal de vida diário, ligado por padrão**, que a pessoa desliga em Ajustes.
- **Quem desliga manda um único "+1 desligou"**, sem código nenhum, para o total ainda fazer sentido.
- **O instalador avisa "instalou" e "atualizou"; o desinstalador avisa "desinstalou".**
- **Usuário real** = abriu o app em pelo menos **2 dias diferentes**. Quem abriu um dia só **experimentou**.
- **Reinstalar no mesmo PC conta como o mesmo PC.** Para isso existe um código do PC, derivado do identificador do
  sistema e embaralhado, explicado na privacidade e desligável pela mesma chave.
- **O número do GitHub aparece só como referência**, marcado como impreciso.
- **Visual:** a interface tem que ser bonita e sofisticada, na estética do painel e do app.

## Objetivos

1. **Contar PCs, não instalações.** O código do PC sobrevive a desinstalar e instalar de novo.
2. **Funil exato.** Instalaram → abriram → usuários reais → ativos em 7 e 30 dias. Ao lado: desinstalaram, desligaram
   a contagem e os downloads do GitHub (impreciso).
3. **Retenção.** Dos PCs que chegaram há pelo menos N dias, quantos voltaram depois de 1, 7 e 30 dias.
4. **Saúde de cada versão.** PCs ativos na versão, quantos % sem erro e o **alarme de regressão**: um erro que só
   aparece na versão mais nova.
5. **Histórico diário guardado.** O cron tira uma foto por dia dos números, para o painel e o Claude verem a
   evolução sem consultas pesadas.
6. **No conector:** `nexo_resumo` e `nexo_usuarios` passam a usar a contagem nova, e entra a ferramenta
   `nexo_versoes`.
7. **No app:** a chave "Contar este PC nas estatísticas do Nexo", ligada por padrão, no mesmo visual dos outros
   interruptores de Privacidade.
8. **Nos instaladores:** a caixinha "Contar esta instalação nas estatísticas do Nexo (anônimo)", já marcada.
   - No NSIS: na página de privacidade.
   - No instalador visual: a mesma opção, no estilo dele.

## Fora deste projeto

- Mudar a telemetria ou os erros: eles continuam com o código aleatório da instalação.
- Vigias de erro (projeto 3) e alerta no Discord (projeto 4).
- macOS: o Nexo não tem build para ele.

## O que não pode acontecer (mesmo funcionando)

- O identificador cru do PC (MachineGuid ou machine-id) sair do computador. Só sai o código embaralhado.
- O servidor guardar algo que permita dizer "esse registro é o PC do fulano", ou cruzar com outro app.
- **Amarrar o código do PC à telemetria ou aos erros no servidor.** O sinal de vida não leva o código da instalação.
- A contagem atrasar, travar ou falhar a instalação, a atualização ou a desinstalação.
- A contagem continuar depois que a pessoa desligou, a não ser pelo único "+1 desligou" no momento em que desliga.
- Quebrar a 0.11.3 publicada, o painel atual ou o conector.
- Sair do plano grátis da Cloudflare.

## Restrições

- **Sem dependências npm novas.**
- **Do lado do servidor:** testes em `tests/server*.test.cjs`, deploy automático na `main` e segredos novos criados
  pelo workflow.
- **App:** `electron/cloud.cjs` já tem o padrão de estado em `cloud.json`, gravação conferida e prazo de 20 s; seguir
  esse padrão.
- **Instaladores:**
  - NSIS: `installer/installer.nsh`, com `customInit`, `customInstall`, `customUnInstall` e a página
    `PrivacyPageCreate`.
  - Instalador visual: `installer-launcher/`, que roda o NSIS com `/S` e passa as escolhas pelo Registro, igual ao
    `DeveloperTelemetryOptIn`.
- **Privacidade:** `PRIVACIDADE.md` e `PRIVACY.md` (PT/EN), o texto `PRIVACY_DETAILS` do NSIS (PT e EN) e os textos
  de Ajustes.
- **Sem CHANGELOG nem notas.** Ao terminar, anotar em `claude/pendente-proxima-versao.md` (regra do Samuel).

## Abordagens consideradas

| | Como | Troca | Decisão |
|---|---|---|---|
| **A** | Código do PC separado: o app (e o instalador) faz `SHA-256("nexo-pc-v1\|" + id do sistema)`, e o servidor guarda só `HMAC(PC_PEPPER, código)`. Ele é a chave da contagem; telemetria e erros continuam com o código da instalação | Mais uma identidade, mas a contagem fica exata e o histórico de uso continua separado do PC | **Escolhida** |
| B | Trocar o código da instalação pelo código do PC em tudo | Uma identidade só, mas amarra todo o histórico de uso a um PC fixo | Descartada: mais invasiva do que contar precisa |
| C | Contar por IP e assinatura da conexão | Nada no app | Descartada: erra muito (casa com vários PCs) e é pior para a privacidade |

**Avisos do instalador:** o NSIS chama o PowerShell escondido, com prazo de 4 s, sem esperar a resposta travar nada.
A alternativa seria avisar "instalou" só na primeira abertura do app, mas aí perderia quem instala e nunca abre, que é
justamente o topo do funil.

## Como funciona

### Código do PC

- **Windows:** `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`. Qualquer usuário pode ler, e é a visão de 64 bits.
- **Linux:** `/etc/machine-id` (reserva: `/var/lib/dbus/machine-id`).
- **No app e no instalador:** `pc = hex(SHA-256(utf8("nexo-pc-v1|" + id.trim().toLowerCase())))`, com 64 caracteres
  hexadecimais. O app e o script do instalador **têm que dar o mesmo resultado.** Um vetor de teste fixo (id
  conhecido → código esperado) entra nos testes do app e no comentário do script.
- **No servidor:** guarda `chave = hex(HMAC-SHA256(PC_PEPPER, pc)).slice(0, 32)`. O `PC_PEPPER` é um segredo novo do
  Worker, criado pelo workflow como o `SESSION_SECRET`.
  - **Nunca trocar o `PC_PEPPER`**: trocar zera a continuidade da contagem. Isso fica documentado como o `DATA_KEY`.
  - Sem o `PC_PEPPER` no ar, as rotas novas respondem 503 e não guardam nada.
- **Sem identificador do sistema** (raro: Linux sem machine-id): o app usa um código aleatório guardado nos dados
  dele (`pcFallback` em `cloud.json`). Nesse caso a reinstalação conta como PC novo.
- **Limite conhecido:** PCs clonados de uma mesma imagem sem sysprep têm o mesmo MachineGuid e contam como um só.
  Fica documentado; é raro em PC de jogo.

### Servidor: rotas novas (anônimas, sem login)

| Rota | Corpo | O que faz | Limite |
|---|---|---|---|
| `POST /v1/pulse` | `{ pc, version, platform }` | Sinal de vida do dia (UTC). Cria ou atualiza o PC e marca o dia (um por PC por dia; repetir no mesmo dia não muda nada) | 10 por PC e 1.000 por IP, por dia |
| `POST /v1/install` | `{ pc, event: 'instalou' \| 'atualizou' \| 'desinstalou', version, platform }` | Evento do instalador. "instalou" num PC já conhecido = reinstalação (conta separado) | 10 por PC e 300 por IP, por dia |
| `POST /v1/optout` | `{ origem: 'app' \| 'instalador' }` | Soma +1 em "desligaram a contagem" no dia. **Sem código nenhum** | 5 por IP por dia |

Validação: `pc` = `/^[0-9a-f]{64}$/`, versão e sistema como nas rotas de hoje e evento numa lista fechada.

### Banco (migração `0005_contagem.sql`)

```sql
CREATE TABLE IF NOT EXISTS pcs (
  pc TEXT PRIMARY KEY,                 -- HMAC(PC_PEPPER, código do PC), 32 hex
  first_seen INTEGER NOT NULL,         -- primeiro sinal de vida OU primeiro evento do instalador
  last_seen INTEGER NOT NULL,
  first_version TEXT NOT NULL,
  last_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  first_pulse_day TEXT,                -- primeiro dia em que o app abriu (null = instalou e nunca abriu)
  last_pulse_day TEXT,
  days_active INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0, -- quantas vezes "instalou" (> 1 = reinstalou)
  installed_at INTEGER,
  uninstalled_at INTEGER               -- último "desinstalou" (some se ele abrir de novo depois)
);
CREATE TABLE IF NOT EXISTS pulses (
  pc TEXT NOT NULL, day TEXT NOT NULL, version TEXT NOT NULL, platform TEXT NOT NULL,
  PRIMARY KEY (pc, day)
);
CREATE INDEX IF NOT EXISTS pulses_day ON pulses (day);
CREATE TABLE IF NOT EXISTS pc_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, pc TEXT NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL,
  version TEXT NOT NULL, platform TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pc_events_at ON pc_events (at);
CREATE TABLE IF NOT EXISTS optouts (day TEXT NOT NULL, origem TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, origem));
-- Foto diária dos números (o cron grava a de ontem) e dos downloads do GitHub (referência imprecisa).
CREATE TABLE IF NOT EXISTS daily_stats (day TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gh_downloads (day TEXT NOT NULL, tag TEXT NOT NULL, total INTEGER NOT NULL, PRIMARY KEY (day, tag));
```

- **`days_active` só sobe** quando o `INSERT OR IGNORE` em `pulses` grava uma linha nova (`meta.changes`).
- **Sinal de vida depois de um "desinstalou"** limpa o `uninstalled_at` (a pessoa voltou).
- **Retenção dos dados:**
  - `pulses`: 400 dias;
  - `pc_events`: 400 dias;
  - `pcs`: 400 dias sem aparecer;
  - `optouts`, `daily_stats` e `gh_downloads`: ficam (são poucas linhas).

### Definições (todas por PC)

| Número | Conta |
|---|---|
| Instalaram | PCs com pelo menos um "instalou" (Windows) **+** PCs Linux vistos pelo sinal de vida |
| Abriram | PCs com `days_active >= 1` |
| Usuários reais | PCs com `days_active >= 2` |
| Experimentaram | PCs com `days_active = 1` e o primeiro dia há mais de 7 dias |
| Ativos hoje, em 7 e em 30 dias | PCs com sinal de vida no período |
| Reinstalaram | PCs com `installs >= 2` |
| Desinstalaram | PCs com `uninstalled_at` preenchido |
| Desligaram a contagem | soma de `optouts` (a origem mostrada separada) |
| Retenção em 1, 7 e 30 dias | dos PCs com primeiro dia há pelo menos N dias, quantos % têm sinal de vida em algum dia ≥ primeiro dia + N |
| Saúde da versão V (7 dias) | PCs com sinal de vida em V × instalações com erro em V (`error_reports`, nível erro), em %. É **aproximado** de propósito: o servidor não amarra PC com instalação. O painel diz "≈" |
| Regressão | grupo de erro aberto ou reaberto cujas versões são **só** a versão mais nova com PCs ativos, e que apareceu depois do primeiro sinal de vida nessa versão |

### Cron diário (o mesmo de hoje, às 06:17 UTC)

1. **Foto de ontem em `daily_stats`:** o JSON com os números da tabela acima no fim do dia de ontem, mais os ativos
   do dia, os novos do dia e os ativos por versão.
2. **Downloads do GitHub:** `GET https://api.github.com/repos/Samuklvm/Project-Nexo/releases?per_page=100`, com
   `User-Agent: nexo-api` e, se houver o segredo `GITHUB_TOKEN`, autenticado. Soma o `download_count` dos `.exe`,
   `.AppImage` e `.deb` por tag e grava em `gh_downloads`. Se falhar, tenta no dia seguinte, sem erro no cron.
3. **Limpezas de retenção** (acima).

### App (próxima versão)

- **`electron/cloud.cjs`:**
  - `DEFAULTS.count = true`;
  - `createCloud` recebe `machineId: async () => string | null`;
  - funções novas:
    - `pcCode()` (a fórmula acima, com cache em memória);
    - `sendPulse()`: no máximo uma vez por dia UTC, guarda `lastPulseDay` e não manda se `count` estiver desligado
      ou sem servidor; falha de rede só tenta de novo depois, sem erro no registro;
    - `setOptions({ count })`: desligar manda **uma vez** o `POST /v1/optout { origem: 'app' }` e grava o estado,
      mesmo sem rede (o "+1" pendente vai quando der); religar não manda nada.
  - **Primeira abertura** (sem `cloud.json`): lê o `CountOptIn` do Registro (Windows; se for 0, começa desligado e
    não manda "+1", porque o instalador já mandou) ou o arquivo de privacidade (Linux).
- **`main.cjs`:**
  - `machineId()`: Windows por `reg query` (visão de 64 bits); Linux pelos arquivos acima.
  - `sendPulse` 1 min depois de abrir e a cada hora; ele mesmo decide se já mandou hoje.
  - A chave de Ajustes também grava o `CountOptIn` no Registro ou no arquivo de privacidade, como o `writeSharePreference`.
- **`index.html` + `src/view-cloud.js`:** interruptor novo em Privacidade, **acima** da telemetria:
  - **"Contar este PC nas estatísticas do Nexo"**, com o texto: *"Ligado por padrão. Uma vez por dia o Nexo avisa só
    'este PC abriu hoje', com a versão e o sistema, usando um código do PC embaralhado (não dá para saber de quem é,
    nem cruzar com outro app). É o que faz o criador saber quantas pessoas usam o Nexo de verdade. Desligar para de
    contar na hora."*
  - A linha de estado embaixo ganha "Contado pela última vez hoje".

### Instaladores (próxima versão)

- **`installer/count.ps1`** (vai junto em `resources`, pelo `extraResources`):
  - parâmetros `-Event instalou|atualizou|desinstalou|optout`, `-Version` e `-Server`;
  - calcula o código do PC com a mesma fórmula e manda o `POST`;
  - `Invoke-RestMethod -TimeoutSec 4` dentro de `try`; **nunca** escreve na tela e **sempre** sai com 0.
- **`installer.nsh`:**
  - **Página de privacidade:** segunda caixinha, já marcada: "Contar esta instalação nas estatísticas do Nexo
    (anônimo)" (EN: "Count this install in Nexo's statistics (anonymous)"). O estado vem de `CountOptIn` (padrão 1).
    O texto `PRIVACY_DETAILS` (PT e EN) ganha um parágrafo com o código do PC.
  - **`customInstall`:**
    - grava o `CountOptIn`;
    - caixinha marcada: roda o `count.ps1` com `atualizou` se `${isUpdated}`, ou `instalou` se não;
    - caixinha desmarcada: roda com `optout`, e só na instalação nova, não na atualização.
    - Chamada com `nsExec::Exec` no PowerShell escondido.
  - **`customUnInstall`:** só na desinstalação de verdade (sem `NEXO_KEEP`), **antes** de apagar o Registro: se o
    `CountOptIn` não for 0, roda o `count.ps1 -Event desinstalou`. O script ainda está em `$INSTDIR\resources`.
  - **Endereço do servidor:** o mesmo de `config/server.json`, passado no build por `!define NEXO_SERVER`. O builder
    escolhe como; o `electron-builder` aceita `nsis.include`/defines.
- **Instalador visual (`installer-launcher/`):**
  - a opção "Contar esta instalação" na mesma tela da telemetria, ligada por padrão e no estilo dela;
  - grava o `CountOptIn` antes de rodar o NSIS com `/S`. No modo silencioso o NSIS lê o Registro e faz o resto.

### Painel

- **Aba Usuários, refeita:**
  - **Funil no topo:** Instalaram → Abriram → Usuários reais → Ativos em 30 dias → Ativos em 7 dias.
    - Cada passo é um cartão de vidro conectado por uma linha de luz, com o número grande (`tabular-nums`) e a
      conversão para o passo seguinte ("62% abriram").
    - Ao lado, em chips menores: Experimentaram, Reinstalaram, Desinstalaram e Desligaram a contagem.
    - Os downloads do GitHub ficam apagadinhos, com "≈ impreciso" e uma dica explicando o porquê.
  - **Ativos por dia (30 dias):** as barras da aba Geral, com os novos do dia em outra cor.
  - **Retenção:** três anéis (1, 7 e 30 dias) com a porcentagem e o "de N PCs".
  - **Últimos PCs:** mostra primeira e última vez, versão, sistema, dias ativos e reinstalou. Nada que identifique.
  - Some o cartão "Como usuário novo é contado" de hoje; entra uma linha curta explicando a contagem nova.
- **Aba Versões (nova):** tabela por versão com PCs ativos em 7 dias, PCs desde que saiu, "≈ % sem erro" (barra
  colorida), erros abertos e o selo **REGRESSÃO** nos erros que só existem nela. A versão mais nova fica em
  destaque.
- **Aba Geral:**
  - os blocos de cima passam a mostrar "Usuários reais", "Ativos em 7 dias" e "Ativos hoje" da contagem nova;
  - "Usuários novos por dia" vira "PCs novos por dia";
  - a contagem antiga (por telemetria e erros) sai da tela, mas a tabela `installs` continua (a telemetria usa).
- **Primeiros dias depois do deploy:** a contagem nova só começa a encher quando as pessoas atualizarem para a versão
  com o sinal de vida. Nesse período o painel mostra um aviso: "A contagem exata começou em DD/MM; antes disso,
  veja a contagem antiga (telemetria e erros)", com o número antigo ao lado.

### Conector

- **`nexo_resumo`:** ganha o bloco `contagem` (funil, ativos e retenção) e mantém os campos de hoje.
- **`nexo_usuarios`:** devolve o funil, a retenção, os ativos e novos por dia (pulses), os eventos do instalador
  (instalou, atualizou e desinstalou por dia), as desligadas, o GitHub (marcado `impreciso: true`) e as fotos
  diárias do período (`daily_stats`).
- **`nexo_versoes` (nova, só leitura):** a mesma tabela da aba Versões, com a lista de regressões.
- Nada disso tem código de PC, nem embaralhado. Saem só contagens.

### Privacidade e documentação

- **`PRIVACIDADE.md` / `PRIVACY.md`:** seção nova, "Contagem de uso (ligada por padrão)":
  - o que vai: o código do PC embaralhado, a versão e o sistema, uma vez por dia, e os avisos do instalador;
  - como é feito o código e por que não identifica a pessoa;
  - o "+1 desligou";
  - por quanto tempo fica e como desligar.
- **`docs/SERVIDOR.md`:** as rotas novas, o `PC_PEPPER` (nunca trocar) e o `GITHUB_TOKEN` (opcional).
- **`claude/pendente-proxima-versao.md`:** o que entra nas notas PT/EN e nas novidades (sim: "Agora dá para saber
  quantas pessoas usam o Nexo; você pode desligar em Ajustes").

## Testes

- **Servidor:**
  - pulse: um por dia, `days_active` certo, repetir não conta duas vezes, o código cru não é guardado (só o HMAC),
    sem `PC_PEPPER` dá 503;
  - install: eventos, reinstalação, desinstalação, e um pulse depois do desinstalar limpa a marca;
  - optout: só a contagem, sem nenhum código;
  - definições do funil com dados montados (cada número da tabela);
  - retenção 1/7/30;
  - saúde da versão e regressão;
  - foto diária e GitHub com `fetch` simulado (inclusive a falha);
  - limites de uso;
  - as ferramentas do conector (inclusive a `nexo_versoes`), e a varredura de e-mail e de código de PC nas respostas.
- **App:** `tests/cloud.test.cjs` cobre:
  - o código do PC com o vetor fixo;
  - um pulse por dia;
  - desligado não manda;
  - desligar manda um "+1" só (e o pendente sem rede);
  - a primeira abertura com `CountOptIn = 0`;
  - o código reserva sem machine-id.
- **Script do instalador:** o vetor fixo calculado também no PowerShell, no runner `windows-latest`, com um passo no
  `release.yml` ou num teste que chama o `pwsh` se ele existir.
- **Visual:** print do painel (Usuários e Versões), da chave em Ajustes e da página do instalador visual.
- **No Windows de verdade (Samuel):** instalar, atualizar e desinstalar uma vez e conferir os eventos pelo conector.

## Decisões tomadas pelo Claude (o Samuel pode corrigir)

- **Prefixo `nexo-pc-v1|`** no código do PC e o segundo embaralhamento no servidor (`PC_PEPPER`).
- **O dia é o UTC**, igual à telemetria.
- **A saúde da versão é aproximada**, de propósito, para não amarrar o PC com a instalação.
- **"Experimentou"** só depois de 7 dias sem voltar (antes disso ainda pode voltar).
- **Desmarcar no instalador** manda o "+1 desligou" com a origem "instalador".
- **A contagem antiga sai da tela**, mas a tabela continua.
- **Aviso no painel** enquanto a contagem nova está enchendo.

## Riscos

- **`${isUpdated}`:** o NSIS do `electron-builder` precisa ter essa macro. Conferir no build. Se não tiver, usar o
  parâmetro `--updated` que o `electron-updater` passa, ou ler o `NEXO_KEEP` mais a presença da versão anterior.
- **Antivírus:** um instalador que chama o PowerShell com rede pode chamar a atenção. O script é pequeno, sem
  ofuscação e assinado junto (0.11.4 com a SignPath). Se der problema, o plano B é o app mandar "instalou" na
  primeira abertura e o instalador ficar sem rede.
- **Gravações no D1:** cerca de 2 por PC ativo por dia. Com o limite grátis de 100 mil por dia, cabe até uns 40 mil
  PCs ativos por dia. Bem longe.

---

## Roteiro dos próximos projetos

3. **Vigias de erro no app.**
4. **Interruptor remoto, alerta no Discord** (inclusive regressões novas) **e Claude de plantão.**
5. **Sincronização automática.**
