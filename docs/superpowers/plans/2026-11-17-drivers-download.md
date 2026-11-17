# Drivers: baixar e instalar com um clique — Plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão Baixar (com barra de progresso, fila e conferência de assinatura) e Instalar (com ponto de restauração opcional numa chave no topo) na página de Drivers, para NVIDIA, Visual C++, DirectX 9 e .NET.

**Architecture:** O processo principal decide tudo: monta o plano de cada download a partir da própria leitura (`D.build` de `src/drivers.js`, que é UMD e roda no main), baixa com `net.request` em partes num motor com fila (`electron/driver-download.cjs`), confere hash e assinatura e instala por uma tarefa nova do `elevate.cjs` (uma janela de administrador só). A tela só manda o id do cartão e recebe eventos de progresso.

**Tech Stack:** Electron (main + preload + renderer sem framework), Node `node:test`, PowerShell 5.1 (Authenticode, Checkpoint-Computer), CSS próprio do app (`style.css` + `theme.css`).

**Spec:** `docs/superpowers/specs/2026-11-17-drivers-download-design.md`

## Global Constraints

- Branch `feat/drivers-download`; commits em português, frase curta, como o histórico do repo; cada commit termina com as linhas de atribuição do Claude.
- **Windows Update: nunca.** Só HTTPS, só domínio oficial em **cada** salto de redirecionamento (`officialLink(url, domains)` de `electron/drivers.cjs`).
- A tela manda só o **id do cartão**; URL vinda da tela é recusada.
- **Elevação só pelo `electron/elevate.cjs`** (tarefa na lista `TASKS`, corpo montado com `psQuote`, enviado por `-EncodedCommand`).
- Fila: sem limite de pedidos, **no máximo 4 baixando ao mesmo tempo**; instalação **uma de cada vez**.
- Tamanho máximo por arquivo: **1,5 GB** (`1536 * 1024 * 1024` bytes). No máximo **5** redirecionamentos.
- Progresso para a tela no máximo **10 vezes por segundo**.
- Assinantes esperados: NVIDIA → `NVIDIA Corporation`; Visual C++, DirectX e .NET → `Microsoft Corporation`.
- Pasta: `path.join(app.getPath('userData'), 'driver-downloads')`. Instalados com sucesso apagados após **14 dias**; `.part` após **7 dias**.
- Chave do ponto de restauração **ligada por padrão**, guardada em `localStorage` na chave `nexo-drivers-restore` (`'1'`/`'0'`); último ponto em `nexo-drivers-restore-at` (ISO).
- Código de saída `3010` = "reinicie o PC para terminar"; `1223` = recusou o administrador.
- Textos da interface em português; cores só por `--neon`, `--neon-2`, `--neon-rgb`, `--good`, `--mist`, `--glass`, `--hair` (funciona nas 7 cores do tema); animações desligadas com `prefers-reduced-motion` e no Modo Leve (`body.lite`).
- Frase do topo: "O Nexo baixa só do site oficial de cada fabricante, confere a assinatura de cada arquivo e nunca usa o Windows Update."
- `npm test` passa inteiro ao fim de cada tarefa; arquivo de teste novo entra na lista do script `test` do `package.json`.

## Review Focus

1. **"Conferir de novo" com download andando:** o estado do download não pode sumir nem voltar para "Baixar"; o cartão reencontra o download pelo id → teste na Tarefa 5 (`motor não depende da leitura depois de começar`) e conferência no preview da Tarefa 7 (clicar "Conferir de novo" com a barra andando).
2. **App fechado no meio do download:** o `.part` continua na próxima vez, mas só se for **o mesmo arquivo** (mesma URL/versão); `.part` de versão antiga é apagado → teste na Tarefa 5 (`part de outra versão não é retomado`).
3. **Disco cheio / erro de gravação:** apaga o `.part` e mostra `espaço em disco` em vez de travar em 87% → teste na Tarefa 5 (`ENOSPC vira erro disk e limpa`).
4. **Servidor mente:** manda mais bytes que o `Content-Length`, passa de 1,5 GB ou faz laço de redirecionamento → aborta com erro claro → testes na Tarefa 5.
5. **Pessoa recusa a janela de administrador:** volta para "pronto para instalar" com "Você recusou a permissão de administrador", sem gravar ponto de restauração → teste na Tarefa 5.

---

### Task 1: Conferência de assinatura (script PowerShell compartilhado)

**Files:**
- Create: `electron/driver-signature.cjs`
- Test: `tests/driver-download.test.cjs` (novo; adicionar ao `package.json`)

**Interfaces:**
- Produces:
  - `signatureCore(file: string, signer: string): string` — trecho PowerShell que define `$sig = @{ valid: bool, signer: string|null, status: string }` para o arquivo. Usado sozinho (Tarefa 5) e dentro do corpo elevado (Tarefa 2).
  - `signatureScript(file, signer): string` — `Scan.PS_HEAD` + `signatureCore` + escreve `$sig` em JSON no stdout.
  - `parseSignature(stdout: string, signer: string): { valid: boolean, signer: string|null, status: string }`.
  - `insideDir(file: string, dir: string): boolean` — `path.win32.resolve`, mesmo prefixo case-insensitive, sem `..`, só `.exe`/`.msi`.
  - `SIGNERS = { nvidia: 'NVIDIA Corporation', microsoft: 'Microsoft Corporation' }`.

- [ ] **Step 1: Escrever os testes**

```js
test('assinatura: script cita o caminho com psQuote e confere organização exata', () => {
  const s = Sig.signatureScript("C:\\Users\\a'b\\driver-downloads\\x.exe", 'NVIDIA Corporation');
  assert.match(s, /Get-AuthenticodeSignature -LiteralPath 'C:\\Users\\a''b\\driver-downloads\\x\.exe'/);
  assert.match(s, /\$_.Status -eq 'Valid'|Status -eq 'Valid'/);
  assert.doesNotMatch(s, /Invoke-Expression|iex /);
});
test('assinatura: parse só aceita Valid e o assinante esperado', () => {
  assert.deepEqual(Sig.parseSignature('{"status":"Valid","org":"NVIDIA Corporation"}', 'NVIDIA Corporation'), { valid: true, signer: 'NVIDIA Corporation', status: 'Valid' });
  assert.equal(Sig.parseSignature('{"status":"Valid","org":"NVIDIA Corp Fake"}', 'NVIDIA Corporation').valid, false);
  assert.equal(Sig.parseSignature('{"status":"HashMismatch","org":"NVIDIA Corporation"}', 'NVIDIA Corporation').valid, false);
  assert.equal(Sig.parseSignature('lixo', 'NVIDIA Corporation').valid, false);
});
test('assinatura: insideDir recusa fora da pasta, .. e extensão errada', () => {
  const dir = 'C:\\Users\\a\\AppData\\Roaming\\Nexo\\driver-downloads';
  assert.equal(Sig.insideDir(`${dir}\\nvidia-572.16.exe`, dir), true);
  assert.equal(Sig.insideDir(`${dir.toUpperCase()}\\x.msi`, dir), true);
  assert.equal(Sig.insideDir(`${dir}\\..\\evil.exe`, dir), false);
  assert.equal(Sig.insideDir('C:\\Windows\\System32\\cmd.exe', dir), false);
  assert.equal(Sig.insideDir(`${dir}\\x.ps1`, dir), false);
  assert.equal(Sig.insideDir(`\\\\servidor\\share\\x.exe`, dir), false);
});
```

- [ ] **Step 2:** `node --test tests/driver-download.test.cjs` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `electron/driver-signature.cjs`**. A organização vem de `$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)` **e** do campo `O=` do `Subject`; usar o `O=` para comparar (igualdade exata, sem `-like`). `psQuote` vem de `electron/elevate.cjs`.
- [ ] **Step 4:** `node --test tests/driver-download.test.cjs` → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Drivers: conferência de assinatura dos instaladores baixados"`

---

### Task 2: Tarefa elevada `driver-install` e tempo-limite por tarefa

**Files:**
- Modify: `electron/elevate.cjs` (`TASKS`, `createElevator`, exports)
- Test: `tests/driver-download.test.cjs`

**Interfaces:**
- Consumes: `signatureCore`, `insideDir`, `SIGNERS` (Tarefa 1); `restorePointCore` (já existe).
- Produces:
  - `driverInstallBody({ file, dir, signer, restorePoint, description }): string` — exportada.
  - `TASKS['driver-install']`.
  - `createElevator(...)` aceita `elevate(task, args, { timeout })`; padrão segue `240000`; `TIMEOUTS = { 'driver-install': 45 * 60 * 1000 }` usado quando a chamada não passa `timeout`.
  - Resultado JSON: `{ ok, code, signature: { valid, signer }, restore: { ok, created, at, note } | null, note }`.

- [ ] **Step 1: Testes**

```js
test('driver-install: recusa arquivo fora da pasta e assinante fora da lista', () => {
  const dir = 'C:\\N\\driver-downloads';
  assert.throws(() => E.driverInstallBody({ file: 'C:\\Windows\\x.exe', dir, signer: 'NVIDIA Corporation' }), /Arquivo não permitido/);
  assert.throws(() => E.driverInstallBody({ file: `${dir}\\x.exe`, dir, signer: 'Evil Corp' }), /Assinante não permitido/);
});
test('driver-install: confere assinatura antes, ponto opcional e não instala se o ponto falhar', () => {
  const dir = 'C:\\N\\driver-downloads';
  const on = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: true, description: 'Nexo - antes de instalar o driver de vídeo' });
  assert.ok(on.indexOf('Get-AuthenticodeSignature') < on.indexOf('Start-Process'));
  assert.match(on, /Checkpoint-Computer/);
  assert.match(on, /if \(-not \$r\.restore\.ok\)/);           // sem ponto, sem instalação
  assert.match(on, /Start-Process -FilePath '[^']*nv\.exe' -Wait -PassThru/);
  const off = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: false });
  assert.doesNotMatch(off, /Checkpoint-Computer/);
  assert.ok(E.TASKS['driver-install']);
});
test('elevate: driver-install usa o tempo-limite longo', async () => {
  let used = null;
  const elevate = E.createElevator({ runPowerShell: async (_s, t) => { used = t; return { code: 0 }; }, fs: fakeFs(), path: require('node:path').win32, dir: 'C:\\N\\elevate' });
  await elevate('driver-install', { file: 'C:\\N\\driver-downloads\\nv.exe', dir: 'C:\\N\\driver-downloads', signer: 'NVIDIA Corporation' });
  assert.equal(used, 45 * 60 * 1000);
});
```

(`fakeFs()` = helper no topo do arquivo de teste com `mkdir`, `readFile` que lança, `rm`.)

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar.** Ordem do corpo: validar (JS) → `signatureCore` → se inválida, `$r.note = 'assinatura não confere'` e grava → se `restorePoint`, `$r.restore = & { restorePointCore(...) ; $r }` e para se `-not $r.restore.ok` → `Start-Process -FilePath <psQuote(file)> -Wait -PassThru` → `$r.code = $p.ExitCode; $r.ok = $p.ExitCode -in 0,3010` → `WRITE_RESULT`. Descrição cortada em 64 caracteres.
- [ ] **Step 4:** rodar → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Drivers: tarefa de administrador que confere, cria o ponto e instala"`

---

### Task 3: Leitura online ganha o pacote de notebook da NVIDIA e os arquivos do .NET

**Files:**
- Modify: `electron/drivers.cjs` (`NV_LINES`, `nvidiaUrl`, `scan`, novo `parseDotnetRelease`, exports)
- Test: `tests/drivers.test.cjs`

**Interfaces:**
- Produces (no resultado de `scan`):
  - `latest.nvidia[line]` como hoje **e**, quando `runtimes.board.mobile`, `latest.nvidiaNotebook[line]` (mesmo formato de `parseNvidia`, com `download`).
  - `nvidiaUrl(line, { win11, notebook })` — `NV_LINES_NOTEBOOK = { modern: { psid, pfid }, legacy: { psid, pfid } }`. Os valores saem do serviço oficial `https://www.nvidia.com/Download/API/lookupValueSearch.aspx?TypeID=2` (séries com "(Notebooks)"): conferir na hora e fixar no código com comentário.
  - `latest.dotnetFiles[channel] = { version, url, sha512, size? }` para os canais instalados (no máximo 3), lido de `https://builds.dotnet.microsoft.com/dotnet/release-metadata/<canal>/releases.json`: `releases[0].windowsdesktop.files` com `rid === 'win-x64'` e nome terminando em `.exe`.
  - `parseDotnetRelease(json): { version, url, sha512 } | null` — `url` passa por `officialLink(url, ['microsoft.com', 'dot.net'])`; `sha512` só `/^[0-9a-f]{128}$/i`.

- [ ] **Step 1: Testes** — `parseDotnetRelease` com fixture real resumida (aceita), com `url` de outro domínio (null), com hash de 64 caracteres (null); `nvidiaUrl('modern', { notebook: true })` usa o psid de notebook; `scan` com `runtimes.board.mobile = true` chama a URL de notebook e preenche `latest.nvidiaNotebook.modern` (fake `fetchJson` que registra as URLs).
- [ ] **Step 2:** `node --test tests/drivers.test.cjs` → FAIL.
- [ ] **Step 3:** Implementar; tudo por `cachedFetch` (TTL de 6 h que já existe).
- [ ] **Step 4:** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Drivers: pacote de notebook da NVIDIA e arquivos oficiais do .NET"`

---

### Task 4: Cartões com download (regra pura)

**Files:**
- Modify: `src/drivers.js` (`card`, `videoCards`, `runtimeCards`, `PAGES`, retorno de `build`)
- Test: `tests/drivers.test.cjs`

**Interfaces:**
- Consumes: `latest.nvidia`, `latest.nvidiaNotebook`, `latest.dotnetFiles` (Tarefa 3).
- Produces: `card.download = { url, domains: string[], fileName, signer, sha512?: string, size?: string, label }` ou `null`. `D.downloadFor(model, id): download|null`. `PAGES.directxRedist`, `PAGES.vc64`, `PAGES.vc86` como URLs de arquivo.
  - NVIDIA `update` ou `ok`: `url` = `download` do pacote **de notebook quando `board.mobile`**, senão o de desktop; `domains: ['nvidia.com']`; `signer: 'NVIDIA Corporation'`; `fileName: 'nvidia-<versão>.exe'`; `size` = `top.size`; `label: 'Baixar · <size>'` (sem size: `'Baixar'`).
  - Linhas `ended` e `pro`, AMD, Intel e o resto: `download: null` (continua o botão do site).
  - Visual C++ (`missing`/`old`): `vc_redist.x64.exe` / `vc_redist.x86.exe`, `domains: ['aka.ms', 'microsoft.com', 'visualstudio.microsoft.com']`, `signer: 'Microsoft Corporation'`.
  - DirectX 9 (`missing`): o redistribuível oficial (URL conferida na hora, `download.microsoft.com`), `signer: 'Microsoft Corporation'`.
  - .NET (`update`): de `dotnetFiles[channel]`, com `sha512`.
  - Notebook sem `nvidiaNotebook` disponível: `download: null` (nunca o pacote de desktop num notebook).

- [ ] **Step 1: Testes** — `build` com o fixture do teste atual: RTX 4070 desktop ganha `download.url` do desktop; o mesmo com `board.mobile: true` e `nvidiaNotebook` ganha a URL de notebook; com `mobile: true` sem `nvidiaNotebook` → `download === null`; GTX 760 (`ended`) → `null`; `vc-x64` faltando → `fileName 'vc_redist.x64.exe'`; `.NET 8.0` com update → `sha512` presente; `D.downloadFor(model, 'id-que-nao-existe') === null`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Drivers: cada cartão sabe qual arquivo oficial baixar"`

---

### Task 5: Motor de download e fila de instalação

**Files:**
- Create: `electron/driver-download.cjs`
- Test: `tests/driver-download.test.cjs`

**Interfaces:**
- Consumes: `officialLink` (drivers.cjs), `signatureScript`/`parseSignature`/`insideDir` (Tarefa 1), `elevate('driver-install', ...)` (Tarefa 2), `D.downloadFor` (Tarefa 4).
- Produces: `createDriverDownloads({ request, fs, path, crypto, dir, runPowerShell, elevate, emit, now, max = 4 })` →
  - `start(id: string, plan: download): { id, phase }` — enfileira; recusa `plan` nulo (`'Este driver não tem download direto.'`).
  - `cancel(id)`, `list(): Array<Item>`, `install(id, { restorePoint: boolean }): Promise<InstallResult>`, `fileOf(id): string|null`, `cleanup(): Promise<void>`.
  - `Item = { id, phase, received, total, speed, eta, position?, error?, signer?, file? }`, com `phase ∈ 'queued'|'downloading'|'verifying'|'ready'|'installing'|'error'|'canceled'`.
  - `error ∈ 'offline'|'domain'|'redirects'|'too-big'|'hash'|'signature'|'disk'|'http'`.
  - `InstallResult = { ok, restart, declined, restore, note }` (`restart` = código 3010).
  - `emit('drivers:download', item)` com no máximo 10 eventos/s por item (o último sempre sai).
  - `request(url, { headers }) → { status, headers, location?, body: AsyncIterable<Buffer>, abort() }`: injetável; no main, implementado com `net.request({ url, redirect: 'manual' })`.
  - Nome do `.part`: `<fileName>.<sha256(url).slice(0,12)>.part`; `.part` de outra URL para o mesmo `fileName` é apagado ao começar.

- [ ] **Step 1: Testes** (fake `request` a partir de uma tabela `url → { status, headers, chunks }`, `fs` real em `os.tmpdir()`):
  - `baixa, confere e fica ready` (`phase` final `ready`, arquivo renomeado, sem `.part`).
  - `fila: 6 pedidos, 4 baixando e 2 na fila com posição 1 e 2`; ao terminar um, o próximo começa.
  - `redirecionamento para fora do domínio aborta com error domain`; `6 redirecionamentos viram error redirects`.
  - `mais bytes que o Content-Length ou acima de 1,5 GB viram error too-big`.
  - `continua com Range quando há Accept-Ranges` (segundo pedido com `Range: bytes=<n>-`, resposta 206) e `recomeça sem Accept-Ranges`.
  - `part de outra versão não é retomado` (apagado).
  - `sha512 errado vira error hash e apaga`; `assinatura inválida vira error signature e apaga`.
  - `ENOSPC vira erro disk e limpa`.
  - `cancelar apaga o part e libera a vaga`.
  - `motor não depende da leitura depois de começar` (o `plan` é copiado no `start`).
  - `install: uma de cada vez` (segundo `install` só chama `elevate` depois do primeiro resolver).
  - `install: recusou o UAC → declined, phase volta a ready`; `código 3010 → restart true`; `ponto falhou → ok false, restore.ok false, phase ready`.
  - `progresso limitado a 10 por segundo` (relógio falso `now`).
  - `cleanup apaga instalados há mais de 14 dias e part há mais de 7`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar (hash SHA-512 incremental com `crypto.createHash` durante a gravação; `speed` em média móvel de 2 s; `eta` = restante / speed). **Step 4:** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Drivers: motor de download com fila, retomada e conferência"`

---

### Task 6: Ligação no app (IPC, preload e leitura usada como fonte do plano)

**Files:**
- Modify: `main.cjs` (perto de `drivers:scan`, ~linha 1427), `preload.cjs` (~linha 38), `dev/mock-bridge.js` (~linha 519)
- Test: `tests/main-ipc.test.cjs`

**Interfaces:**
- Consumes: Tarefas 4 e 5.
- Produces (preload):
  - `downloadDriver(id) → Item`, `cancelDriverDownload(id)`, `installDriver(id, { restorePoint }) → InstallResult`, `driverDownloads() → Item[]`, `showDriverFile(id)`, `onDriverDownload: subscribe('drivers:download')`.
  - Canais: `drivers:download`, `drivers:cancel`, `drivers:install`, `drivers:downloads`, `drivers:show-file`; evento `drivers:download`.
  - O main guarda `lastDriversModel = D.build(scanResult, Date.now())` a cada `drivers:scan`; `drivers:download` usa `D.downloadFor(lastDriversModel, id)`; o handler aceita **só** `typeof id === 'string' && id.length <= 200`.
  - `drivers:show-file` → `shell.showItemInFolder(file)` só se `insideDir`.
  - `cleanup()` uma vez, 30 s depois de abrir.
  - Fora do Windows, todos respondem `{ ok: false, note: 'Só no Windows.' }`.
- Mock do preview: `downloadDriver` simula progresso de 0 a 100% em 6 s com eventos, depois `ready` com `signer: 'NVIDIA Corporation'`; `installDriver` responde `ok` depois de 2 s.

- [ ] **Step 1: Testes** em `main-ipc.test.cjs`: os 5 canais existem; `drivers:download` com objeto `{ url: 'https://evil.com' }` → lança; com string sem leitura anterior → `{ ok: false }` ou erro claro, sem chamar `net`; fora do Windows → `Só no Windows.`
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Drivers: canais de download e instalação, só por id"`

---

### Task 7: Interface (chave, barra, estados e o brilho de sucesso)

**Files:**
- Modify: `src/view-drivers.js`, `style.css` (bloco `Drivers`, ~linha 1664), `theme.css` (se precisar de ajuste por tema)
- Test: `tests/drivers.test.cjs` (funções puras de texto) + conferência visual no preview

**Interfaces:**
- Consumes: preload da Tarefa 6; `card.download` (Tarefa 4).
- Produces (puras, exportadas em `src/drivers.js` para testar): `D.progressText(item): string` e `D.phaseText(item): string`.
  - `progressText({ received: 471859200, total: 713031680, speed: 13002342, eta: 19 })` → `'66% · 12,4 MB/s · faltam 19 s'`; `eta > 90` → minutos (`'faltam 3 min'`); sem `total` → `'450 MB · 12,4 MB/s'`.
  - `phaseText`: `queued` → `'Na fila (2º)'`; `verifying` → `'Conferindo a assinatura…'`; `ready` → `'✓ Assinado pela NVIDIA'`; erros → `offline` 'Sem internet. Tente de novo.', `domain` 'O link saiu do site oficial, então parei.', `redirects` 'O site redirecionou demais, então parei.', `too-big` 'O arquivo veio maior que o esperado, então parei.', `hash` 'O arquivo não bateu com o oficial, então apaguei por segurança.', `signature` 'O arquivo não veio assinado pelo fabricante, então apaguei por segurança.', `disk` 'Sem espaço no disco.', `http` 'O site do fabricante não respondeu.'.
- Topo (`renderHero`): pílula de vidro com o escudo (`i-shield` se existir no sprite; senão `i-check`) e o `.switch` do app; texto "Ponto de restauração antes de instalar"; linha de baixo "Último ponto: hoje, 14:32" / "Nenhum ponto criado pelo Nexo ainda" / desligada "Instala direto, sem ponto de restauração". Frase do topo nova (Global Constraints).
- Cartão: botão primário `Baixar · 680 MB` quando `download`; durante: barra + `progressText` + `[✕]`; `ready`: selo + `Instalar` (primário) + `Pasta` (ghost); `installing`: "Instalando… siga a janela do fabricante"; depois: rescan forçado e, se ficou `ok`, classe `celebrate` por 1,6 s; `restart` → "Reinicie o PC para terminar"; ponto falhou → motivo + botão ghost "Instalar sem ponto".
- Estado por id num `Map` fora do `model`, para sobreviver a "Conferir de novo".
- CSS: `.dl-bar` 6 px, trilho `rgba(10,16,44,.55)` + `var(--hair)`, preenchimento `linear-gradient(90deg, var(--neon-2), var(--neon))`, `box-shadow: 0 0 14px rgba(var(--neon-rgb), .45)`, reflexo `::after` em `@keyframes dl-sheen` (1,4 s); `verifying` = reflexo contínuo sem largura fixa; números com `font-variant-numeric: tabular-nums`; `.celebrate` = estrelinhas em `::before`/`::after` com `@keyframes dl-twinkle`; tudo parado sob `@media (prefers-reduced-motion: reduce)` e `body.lite`.

- [ ] **Step 1: Testes** de `progressText` e `phaseText` com os valores acima.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar textos, view e CSS.
- [ ] **Step 4:** `npm test` → PASS; `npm run preview`, abrir Drivers no navegador embutido e conferir com captura: chave ligada/desligada, barra andando, fila com posição, `ready`, `celebrate`, nas cores padrão, aurora e brasa, e em janela estreita (≤ 980 px). Nada cortado, nada pulando.
- [ ] **Step 5: Commit** — `git commit -m "Drivers: chave do ponto de restauração, barra de download e instalação"`

---

### Task 8: Fechamento

**Files:**
- Modify: `CHANGELOG.md` (seção da próxima versão, PT e EN), `src/novidades.js` se a próxima versão já tiver entrada (texto público, sem coisa de criador)

- [ ] **Step 1:** `npm test` inteiro → PASS; `node --test tests/security-static.test.cjs` → PASS.
- [ ] **Step 2:** CHANGELOG PT: "- Novo: drivers com um clique. A página de Drivers baixa o arquivo oficial certo para a sua peça (NVIDIA, Visual C++, DirectX e .NET), com barra de progresso e fila, confere a assinatura do fabricante e instala com um ponto de restauração opcional, ligado numa chave no topo da página." EN equivalente: "- New: one-click drivers. The Drivers page downloads the right official file for your part (NVIDIA, Visual C++, DirectX and .NET), with a progress bar and a queue, checks the maker's signature and installs with an optional restore point, set by a switch at the top of the page."
- [ ] **Step 3: Commit** — `git commit -m "Drivers: novidade no CHANGELOG"`; `git push -u origin feat/drivers-download` (com `-c push.negotiate=true`).
