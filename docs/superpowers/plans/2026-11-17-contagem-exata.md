# Contagem exata de usuários — Plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contar PCs de verdade e mostrar o resultado no painel e no conector: sinal de vida diário, avisos do
instalador, funil, retenção e saúde por versão.

**Architecture:**
- **Servidor:** guarda `HMAC(PC_PEPPER, código do PC)` em tabelas próprias (`pcs`, `pulses`, `pc_events`,
  `optouts`). Um módulo `contagem.js` calcula funil, retenção e versões, e o cron grava a foto diária e os downloads
  do GitHub.
- **App:** manda o sinal de vida pelo `cloud.cjs`.
- **Instalador:** manda os eventos por um `count.ps1` chamado pelo NSIS.

**Tech Stack:** Cloudflare Workers + D1 (zero deps), Electron (`electron/cloud.cjs`, `main.cjs`), NSIS
(`installer/installer.nsh`), PowerShell 5.1+, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-17-contagem-exata-design.md`

## Global Constraints

- **Código do PC:** `hex(SHA-256(utf8("nexo-pc-v1|" + id.trim().toLowerCase())))`, com 64 hex.
- **Vetor fixo do código:** o id `4C4C4544-0042-3510-8051-B4C04F4E3732` dá
  `5494d4d3f02aa76ad4d16aa360ffc47e1c4425d210b921c05a16d5540518c698`.
- **Chave guardada no servidor:** `hex(HMAC-SHA256(PC_PEPPER, pc)).slice(0, 32)`. Sem `PC_PEPPER` (ou com menos de
  32 caracteres), as rotas novas respondem 503.
- **Dia:** o UTC (`dayOf`).
- **Usuário real:** `days_active >= 2`.
- **Experimentou:** `days_active = 1` e o primeiro dia há mais de 7 dias.
- **Rotas e limites por dia:**
  - `/v1/pulse`: 10 por PC e 1.000 por IP;
  - `/v1/install`: 10 por PC e 300 por IP;
  - `/v1/optout`: 5 por IP.
- **Eventos aceitos:** `instalou | atualizou | desinstalou`.
- **Origens de opt-out:** `app | instalador`.
- **Retenção dos dados:** `pulses`, `pc_events` e `pcs` (sem aparecer) por 400 dias.
- **Proibido:**
  - nenhuma resposta do painel ou do `/mcp` contém código de PC (cru ou embaralhado), e o e-mail continua bloqueado;
  - o sinal de vida não leva o `installId`.
- **Sem dependências novas.**
- **Textos em português** (os do instalador em PT e EN).
- **Visual** na estética do painel e do app.
- **Sem CHANGELOG nem notas.** No fim, anotar em `claude/pendente-proxima-versao.md`.

## Review Focus

1. **Relógio do PC adiantado ou atrasado:** o dia é o do servidor (`now()` do Worker); o app só usa o dia para não
   mandar duas vezes. Teste na Task 1: o pulse grava no dia do servidor mesmo com o `day` do corpo diferente (o corpo
   nem leva dia).
2. **Atualização silenciosa às 3h:** o `customInstall` com `${isUpdated}` manda "atualizou", nunca "instalou". Teste
   na Task 6: o script com `-Event atualizou` e a revisão do `.nsh`, conferida no build do Windows.
3. **App aberto há dias sem fechar:** o timer de hora em hora manda o sinal do dia novo. Teste na Task 5: avançar o
   relógio 25 h deve dar um segundo pulse.
4. **Primeira semana depois do deploy, com o banco quase vazio:** funil, retenção e versões com zero PCs devolvem
   zeros, sem dividir por zero (nada de `NaN` nem `Infinity`). Teste na Task 2.
5. **Desligar a contagem sem internet:** o "+1" fica pendente e sai uma vez só quando voltar; religar e desligar de
   novo não manda um segundo "+1" no mesmo dia. Teste na Task 5.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `server/migrations/0005_contagem.sql` | As tabelas do spec |
| `server/src/contagem.js` | `createContagem({ now, limit, ipKey, json, readJson, fetchImpl })`: rotas `pulse`, `install` e `optout`; consultas `funil(env)`, `retencao(env)`, `porDia(env, dias)`, `versoes(env)`; `fotoDiaria(env)`; `downloadsGithub(env)`; `limpeza(env)` |
| `server/src/app.js` | Liga as rotas, a API do painel (`GET contagem`, `GET versoes`) e o cron |
| `server/src/tools.js` | `nexo_resumo.contagem`, `nexo_usuarios` (formato novo) e `nexo_versoes` |
| `server/src/panel.js` | Aba Usuários refeita, aba Versões nova e os blocos de cima da Geral |
| `.github/workflows/server.yml` | Cria o segredo `PC_PEPPER`; copia o `GITHUB_TOKEN` opcional |
| `electron/cloud.cjs` | `count`, `pcCode`, `sendPulse`, opt-out pendente e a leitura da primeira abertura |
| `main.cjs` | `machineId()`, `readCountPreference`/`writeCountPreference`, timer, IPC `cloud:set` com `count` |
| `index.html`, `src/view-cloud.js` | A chave "Contar este PC…" e a linha de estado |
| `installer/count.ps1` | Script do instalador (com `-SelfTest`) |
| `installer/installer.nsh` | Caixinha, `customInstall`, `customUnInstall` e o texto de privacidade |
| `installer-launcher/*` | A opção "Contar esta instalação" e o `CountOptIn` |
| `package.json` (`build.extraResources`) | Leva o `count.ps1` para `resources/` |
| `.github/workflows/installer-check.yml` | Roda `count.ps1 -SelfTest` no `windows-latest` quando `installer/**` muda |
| `tests/server-contagem.test.cjs`, `tests/cloud.test.cjs` | Testes |
| `PRIVACIDADE.md`, `PRIVACY.md`, `docs/SERVIDOR.md` | Documentação |

---

### Task 1: Banco, código do PC e as três rotas

**Files:** Create `server/migrations/0005_contagem.sql`, `server/src/contagem.js`,
`tests/server-contagem.test.cjs`. Modify `server/src/app.js`, `.github/workflows/server.yml`, `package.json` (o
script de teste) e a mesma linha do `server.yml` que roda os testes.

**Interfaces:**
- Produces:
  - `createContagem(deps)` → `{ pulse(request, env), install(request, env), optout(request, env), … }`;
  - `pcKey(env, pc)` → `Promise<string>` (32 hex), que lança `{ status: 503 }` sem `PC_PEPPER`.
- O harness (`tests/helpers/server-harness.cjs`) passa a pôr `PC_PEPPER: 'p'.repeat(48)` no `env` do `setup()` e
  aceita `headers['cf-connecting-ip']` para simular IPs.

- [ ] **Step 1: Testes que falham**, em `tests/server-contagem.test.cjs`:
  - `pulse: um por PC por dia, days_active certo e só o HMAC guardado`:
    - dois pulses no mesmo dia → `pulses` com 1 linha e `days_active = 1`;
    - um pulse no dia seguinte (`tick(DAY)`) → `days_active = 2`;
    - o `pc` cru (64 hex) não aparece em nenhuma tabela: varre `pcs`, `pulses` e `pc_events` com `SELECT *` e procura
      a string;
    - a coluna `pc` tem 32 hex.
  - `pulse: validação e PC_PEPPER`:
    - `pc` que não seja 64 hex → 400;
    - plataforma desconhecida → grava `win32` (como a telemetria);
    - sem `PC_PEPPER` no env → 503 e nenhuma linha.
  - `pulse: o dia é o do servidor`: um corpo com `day: '1999-01-01'` grava o dia do `now()`.
  - `install: instalou, reinstalou, atualizou, desinstalou e voltou`:
    - "instalou" → `installs = 1`, `first_pulse_day` nulo;
    - "instalou" de novo → `installs = 2`;
    - "atualizou" → `last_version` muda;
    - "desinstalou" → `uninstalled_at` preenchido;
    - pulse depois → `uninstalled_at` nulo;
    - evento desconhecido → 400.
  - `optout: só uma contagem, sem código`:
    - dois POSTs de `app` e um de `instalador` → `optouts` com `{ app: 2, instalador: 1 }` no dia;
    - um corpo com `pc` não grava `pc` nenhum, porque a tabela nem tem a coluna;
    - origem desconhecida → 400.
  - `limites`: o 11º pulse do mesmo PC no dia → 429; o 6º optout do mesmo IP → 429.

- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/server-contagem.test.cjs` → FAIL (404).

- [ ] **Step 3: Implementar.**
  - SQL do spec.
  - `pcKey` com HMAC do Web Crypto.
  - As rotas usam `env.DB.batch` com `INSERT ... ON CONFLICT`. O `days_active` sobe só se o `INSERT OR IGNORE` em
    `pulses` mudou alguma linha: rodar o insert antes e ver `meta.changes`.
  - Workflow: o laço de segredos vira `for NAME in SESSION_SECRET DATA_KEY PC_PEPPER`, e o comentário do topo ganha
    "Nunca troque o PC_PEPPER". Também um passo "GitHub token (opcional)" igual ao da Steam, que copia o segredo
    `NEXO_GITHUB_TOKEN`, se existir, para o `GITHUB_TOKEN` do Worker.
  - `package.json` `test` e `server.yml` incluem `tests/server-contagem.test.cjs`.

- [ ] **Step 4: Rodar e ver passar.**
  `node --test tests/server.test.cjs tests/server-conector.test.cjs tests/server-contagem.test.cjs` → PASS.

- [ ] **Step 5: Commit** — `Contagem: código do PC, sinal de vida, eventos do instalador e opt-out no servidor`

### Task 2: Funil, retenção, por dia e versões

**Files:** Modify `server/src/contagem.js`. Test: `tests/server-contagem.test.cjs`.

**Interfaces:**
- Produces:
  - `funil(env)` → `{ instalaram, abriram, reais, experimentaram, ativosHoje, ativos7, ativos30, reinstalaram, desinstalaram, desligaram: { app, instalador, total }, inicio }`.
    `inicio` = o primeiro dia com pulse, ou `null`.
  - `retencao(env)` → `{ d1: { pct, de }, d7: { pct, de }, d30: { pct, de } }`. `pct` é um número de 0 a 100 com uma
    casa, ou `null` quando `de = 0`.
  - `porDia(env, dias)` → `{ ativos: [{ day, n }], novos: [{ day, n }], eventos: [{ day, instalou, atualizou, desinstalou }] }`.
  - `versoes(env)` → `{ maisNova, versoes: [{ version, ativos7, desde, pctSemErro, errosAbertos, regressoes: [{ signature, message, installs, occurrences }] }] }`,
    ordenado pela versão (`compareVersions`), da mais nova para a mais velha.

- [ ] **Step 1: Testes que falham**, com dados montados direto pelas rotas (pulse, install) e pelo `/v1/errors`:
  - `funil com cada tipo de PC`. Monta 6 PCs, todos Windows com "instalou" exceto o E:
    - A: instalou e nunca abriu;
    - B: abriu 1 dia, há 10 dias;
    - C: abriu 1 dia, hoje;
    - D: abriu em 3 dias diferentes;
    - E: Linux, sem "instalou", abriu em 2 dias;
    - F: instalou 2 vezes, abriu 1 dia (hoje) e desinstalou.

    E mais 1 optout de app. Espera:
    - `instalaram = 6` (A, B, C, D, F e o E pelo Linux);
    - `abriram = 5`;
    - `reais = 2` (D e E);
    - `experimentaram = 1` (só B; C e F abriram há menos de 7 dias);
    - `reinstalaram = 1`;
    - `desinstalaram = 1`;
    - `desligaram.total = 1`.
  - `retenção: quem voltou depois de 1, 7 e 30 dias`: PCs com o primeiro dia há 40 dias; um voltou no dia +8 → conta
    em d1 e d7, não em d30. Sem PCs → `pct: null, de: 0`.
  - `banco vazio`: todas as funções devolvem zeros e listas vazias. `JSON.stringify` não contém `NaN` nem `null` onde
    deveria haver 0, e nenhum `Infinity`.
  - `versões: % sem erro aproximado e regressão`:
    - 4 PCs pulsando na 0.12.0 e 2 na 0.11.3;
    - 1 instalação com erro só na 0.12.0, um erro antigo nas duas;
    - a 0.12.0 → `pctSemErro = 75`, `regressoes` com 1 item;
    - a 0.11.3 → sem regressões.

- [ ] **Step 2: Rodar e ver falhar.** → FAIL.

- [ ] **Step 3: Implementar.**
  - Retenção em SQL com `date(first_pulse_day, '+N days')`.
  - A versão mais nova é a maior entre as que tiveram pulse nos últimos 7 dias.
  - Regressão: um grupo aberto ou reaberto cujo `GROUP_CONCAT(DISTINCT version)` dos relatórios é exatamente a mais
    nova.

- [ ] **Step 4: Rodar e ver passar.** → PASS.
- [ ] **Step 5: Commit** — `Contagem: funil, retenção, séries diárias e saúde por versão`

### Task 3: Cron (foto diária, GitHub e limpeza) e o conector

**Files:** Modify `server/src/contagem.js`, `server/src/app.js` (o `scheduled` e o `createTools`) e
`server/src/tools.js`. Test: `tests/server-contagem.test.cjs`.

**Interfaces:**
- Produces:
  - `fotoDiaria(env)` grava `daily_stats(dia de ontem)` com `{ funil, retencao, ativosDia, novosDia, porVersao }`.
  - `downloadsGithub(env)` grava `gh_downloads(hoje, tag, total)`; sem rede ou com resposta ruim, não lança.
  - `limpeza(env)` devolve as instruções do `DB.batch` de retenção.
  - `githubTotal(env)` → `{ total, porTag: [{ tag, total }], dia }` ou `null`.
  - Nas ferramentas:
    - `nexo_resumo` passa a ter `contagem: { funil, retencao }`;
    - `nexo_usuarios` passa a devolver `{ dias, funil, retencao, porDia, github: { ...githubTotal, impreciso: true }, fotos: [{ day, data }], antigo: { instalacoesVistas } }`;
    - `nexo_versoes` (sem argumentos) devolve `versoes(env)`.

- [ ] **Step 1: Testes que falham:**
  - `cron grava a foto de ontem e os downloads`:
    - `createApp({ fetchImpl })` com um `fetch` que responde à API do GitHub com 2 releases (`.exe` com 10 e
      `.AppImage` com 3; `.yml` com 99, que não conta);
    - depois do `scheduled()`: `gh_downloads` com os totais 13 e afins, e `daily_stats` com o dia de ontem.
  - `GitHub fora do ar não quebra o cron`: o `fetch` lança, o `scheduled()` resolve e as outras limpezas rodam.
  - `limpeza de 400 dias`: pulses e eventos velhos somem.
  - `ferramentas novas sem código de PC`: `nexo_usuarios`, `nexo_versoes` e `nexo_resumo` respondem. O JSON não
    contém nenhum dos códigos (crus ou HMAC) montados no teste, nem e-mail.
  - `nexo_usuarios.github.impreciso === true`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** No `scheduled`, os blocos rodam em `try` separados, para um não impedir o outro.
- [ ] **Step 4: Rodar e ver passar**, com os testes do conector também (o formato do `nexo_usuarios` mudou: atualizar
  o teste antigo e registrar um `Ruling`).
- [ ] **Step 5: Commit** — `Contagem: foto diária, downloads do GitHub, limpeza e ferramentas do conector`

### Task 4: Painel (Usuários, Versões e Geral)

**Files:** Modify `server/src/panel.js` e `server/src/app.js` (rotas `GET contagem` e `GET versoes` no
`ADMIN_ROUTES`). Test: `tests/server-contagem.test.cjs` (a API) e print.

**Interfaces:**
- Consumes: as funções da Task 2 e o `githubTotal`.
- Produces:
  - `GET /painel/api/contagem` → `{ funil, retencao, porDia, github, antigo: { instalacoesVistas, novos30 }, ultimos: [{ primeira, ultima, versao, sistema, dias, reinstalou }] }`;
  - `GET /painel/api/versoes` → `versoes(env)`.

- [ ] **Step 1: Teste que falha**, `painel: contagem e versões sem código de PC`:
  - a API responde para qualquer papel com `ver`;
  - nenhum código no JSON;
  - `ultimos` sem nenhum campo `pc`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a API e a tela**, como no spec ("Painel"):
  - **Funil:** cartões de vidro em linha (quebra em coluna no celular), linha de luz entre eles com gradiente
    `--star → --violet`, número grande com `tabular-nums` e a conversão em chip.
  - **Chips laterais** e o **GitHub** apagadinho (`opacity .55`, com o ícone de aviso e a dica no `title`).
  - **Barras por dia:** ativos e novos em duas cores.
  - **Retenção:** anéis em SVG (`stroke-dasharray`).
  - **Tabela de últimos PCs.**
  - **Aba Versões:** a tabela, a barra de "% sem erro" (verde → amarelo → vermelho) e o selo `REGRESSÃO` em vermelho
    com brilho.
  - **Aba Geral:** os blocos de cima com a contagem nova e o aviso "a contagem exata começou em …" enquanto o
    `funil.inicio` tiver menos de 30 dias.
  - **CSP:** a do painel não aceita `style=""`, então as larguras e os arcos entram por `data-*` + JS, como hoje.
- [ ] **Step 4: Rodar os testes e tirar print** das duas abas com dados de exemplo (servidor local, como no conector).
  Conferir o visual antes do commit.
- [ ] **Step 5: Commit** — `Painel: funil, retenção e saúde por versão`

### Task 5: App (sinal de vida, chave em Ajustes e primeira abertura)

**Files:** Modify `electron/cloud.cjs`, `main.cjs`, `index.html` e `src/view-cloud.js`. Test: `tests/cloud.test.cjs`.

**Interfaces:**
- Produces:
  - `createCloud({ …, machineId, readCountPreference })`, em que `machineId: () => Promise<string|null>` e
    `readCountPreference: () => Promise<boolean|null>`;
  - a instância ganha `sendPulse(): Promise<{ sent?, skipped?, already?, off? }>` e `pcCode(): Promise<string>`;
  - o `status()` ganha `count`, `lastPulseDay` e `countProblem`;
  - o `setOptions` aceita `count`;
  - exportado: `pcCodeFrom(id: string) → string` (função pura, a fórmula).

- [ ] **Step 1: Testes que falham**, em `tests/cloud.test.cjs`, com o mundo de verdade (servidor em memória):
  - `código do PC: vetor fixo`: `pcCodeFrom('4C4C4544-0042-3510-8051-B4C04F4E3732')` igual ao vetor.
  - `sinal de vida: um por dia, novo depois de 25 h`: dois `sendPulse()` → 1 POST; `clock += 25 h` → mais 1 POST.
  - `contagem desligada não manda nada`: `setOptions({ count: false })` → 1 POST `/v1/optout` com
    `{ origem: 'app' }` e sem `pc`; depois `sendPulse()` → nenhum POST.
  - `desligar sem internet: +1 pendente, uma vez só`:
    - `fetch` falhando → o estado guarda `optoutPending`;
    - religar e desligar de novo → nada duplicado;
    - a rede volta, `sendPulse()` → manda o `optout` pendente uma vez;
    - mais chamadas → nada.
  - `primeira abertura com CountOptIn = 0`: sem `cloud.json` e com `readCountPreference → false` → `count = false`,
    sem `optout` (o instalador já mandou).
  - `sem machine-id`: `machineId → null` → usa `pcFallback` aleatório guardado; reabrir mantém o mesmo.
  - `o sinal de vida não leva installId`: o corpo do POST tem exatamente as chaves `pc`, `version` e `platform`.

- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/cloud.test.cjs` → FAIL.

- [ ] **Step 3: Implementar.**
  - **`cloud.cjs`:** seguindo os padrões dele (`load`/`save`, `inflight`, `request` com prazo).
  - **`main.cjs`:**
    - `machineId()`: no Windows, `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid /reg:64` pelo
      `systemTool('reg')`; no Linux, `/etc/machine-id` e depois `/var/lib/dbus/machine-id`.
    - `readCountPreference` e `writeCountPreference`: no Windows, o DWORD `CountOptIn` em `PRIVACY_KEY`; no Linux,
      o campo `count` no `PRIVACY_FILE`.
    - O `cloud:set` repassa `count` e grava a preferência.
    - Timer: `setTimeout(1 min)` e depois `setInterval(1 h)` chamando `sendPulse` em silêncio.
  - **`index.html`:** o interruptor `cloud-count` acima de `cloud-telemetry`, com o texto exato do spec.
  - **`view-cloud.js`:** o `syncToggles` e o `onchange` seguem o padrão do `cloud-telemetry`, e o
    `renderPrivacyStatus` ganha a linha "Contado pela última vez hoje" ou "em DD/MM".

- [ ] **Step 4: Rodar e ver passar.** Rodar também o `npm test` inteiro (o `security-static` e o `syntax` olham o
  `index.html` e os `src`).
- [ ] **Step 5: Print da chave em Ajustes** (`node dev/build-preview.cjs`, que gera `dev/preview.html`, com o
  `mock-bridge` ganhando `count` no `cloudStatus`).
- [ ] **Step 6: Commit** — `App: contar este PC (sinal de vida diário, ligado por padrão)`

### Task 6: Instaladores

**Files:** Create `installer/count.ps1` e `.github/workflows/installer-check.yml`. Modify `installer/installer.nsh`,
`package.json` (`build.extraResources`: `{ "from": "installer/count.ps1", "to": "count.ps1" }`),
`installer-launcher/main.cjs`, `installer-launcher/renderer.js` e `installer-launcher/index.html`.

**Interfaces:**
- `count.ps1 -Event <instalou|atualizou|desinstalou|optout> -Version <x.y.z> -Server <https://…>`, que sempre sai
  com 0, ou `count.ps1 -SelfTest`, que sai com 0 se o vetor fixo bate e com 1 se não.
- Registro: `HKCU\Software\NexoDeviceCare\Privacy\CountOptIn` (DWORD; ausente = 1).

- [ ] **Step 1: Teste que falha.** O workflow `installer-check.yml` (`on: pull_request` e `push` com
  `paths: [installer/**]`, `runs-on: windows-latest`) roda:
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File installer/count.ps1 -SelfTest
  powershell -NoProfile -ExecutionPolicy Bypass -File installer/count.ps1 -Event atualizou -Version 0.0.0 -Server https://127.0.0.1:9
  ```
  O segundo comando prova que sem servidor ele sai com 0 em menos de 6 s; o passo mede o tempo e falha se passar.
  Também um teste local, `tests/installer-count.test.cjs`, que confere o `.ps1` como texto:
  - tem `nexo-pc-v1|`;
  - tem o vetor;
  - tem `-TimeoutSec 4`;
  - tem `exit 0` no fim;
  - não usa `Write-Host`, `Invoke-Expression` nem `iex`.

  Esse teste roda aqui, e o de verdade no runner.

- [ ] **Step 2: Rodar o local e ver falhar** (o arquivo ainda não existe).

- [ ] **Step 3: Implementar.**
  - **`count.ps1`:**
    - lê o MachineGuid com `[Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine','Registry64')`;
    - faz o SHA-256 com `[System.Security.Cryptography.SHA256]::Create()`;
    - escolhe a rota:
      - `optout` → `/v1/optout` com `{ origem: 'instalador' }`;
      - o resto → `/v1/install` com `{ pc, event, version, platform: 'win32' }`;
    - tudo em `try { } catch { }` e `exit 0`.
  - **`installer.nsh`:**
    - `Var CountCheckbox` e `Var CountConsent`, com o `customInit` lendo o `CountOptIn` (sem a chave = 1);
    - a caixinha na página de privacidade, logo abaixo da telemetria (o y da telemetria é `98u`: as duas ficam
      `92u`/`104u` e os links descem para `117u`), com `LangString COUNT_LABEL` em 1046 e 1033;
    - um parágrafo novo no `PRIVACY_DETAILS` (PT e EN), no bloco SERVIDOR DO NEXO, explicando a contagem e o código
      do PC;
    - **`customInstall`:**
      - grava o `CountOptIn`;
      - monta `$0 = powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\count.ps1"`;
      - `${if} $CountConsent == 1`: `${if} ${isUpdated}` → `atualizou`, se não → `instalou`;
      - `${elseif} ${isUpdated} == false`: `optout`.
      - `-Version ${VERSION} -Server ${NEXO_SERVER}`, com `nsExec::Exec`.
    - **`customUnInstall`**, no ramo da desinstalação de verdade, **antes** do `DeleteRegKey`: lê o `CountOptIn`;
      se não for "0", roda `-Event desinstalou`.
    - O `!define NEXO_SERVER` vem de um `installer/server.nsh` **gerado no build** a partir do `config/server.json`
      por um script `scripts/write-server-nsh.cjs`, chamado no `release.yml` antes do build. Sem o arquivo, o
      `!ifndef NEXO_SERVER` define vazio e os avisos não rodam.
    - Se a macro `${isUpdated}` não existir no NSIS do electron-builder, usar o `${GetParameters}` com
      `${GetOptions}` procurando `--updated`. Registrar um `Ruling`.
  - **Instalador visual:**
    - checkbox `#o-count` (marcado) com "Contar esta instalação nas estatísticas do Nexo (anônimo)" e a tradução no
      `EN`;
    - `nexo.install({ …, count })`;
    - `setCount(on)` grava o `CountOptIn` como o `setTelemetry`.

- [ ] **Step 4: Rodar o local e ver passar.** Depois do push, conferir o `installer-check` verde no GitHub.
- [ ] **Step 5: Print da tela de opções do instalador visual** (abrir o `index.html` dele no Chrome local com um
  `nexo` falso).
- [ ] **Step 6: Commit** — `Instaladores: contar a instalação (avisos de instalou, atualizou e desinstalou)`

### Task 7: Documentação, revisão e PR

- [ ] **Step 1:**
  - `PRIVACIDADE.md` e `PRIVACY.md`: a seção do spec.
  - `docs/SERVIDOR.md`: as rotas, o `PC_PEPPER` (nunca trocar) e o `NEXO_GITHUB_TOKEN` opcional.
  - `claude/pendente-proxima-versao.md`: o servidor e o painel entram no ar com o PR; o app e os instaladores vão na
    próxima versão, com nota PT/EN e novidade.
- [ ] **Step 2:** `npm test` inteiro verde.
- [ ] **Step 3:** revisão final por um revisor novo, com foco em privacidade (código do PC vazando) e nos números do
  funil.
- [ ] **Step 4:** PR `servidor-contagem` → `main`. Depois do merge e do deploy, conferir pelo conector:
  `nexo_usuarios` e `nexo_versoes` respondendo (com zeros até o app novo sair).
