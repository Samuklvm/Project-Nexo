# Drivers: fontes dos fabricantes de PC e placa-mãe — Plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O botão Baixar passa a cobrir chipset, áudio, rede, Wi-Fi, Bluetooth, touchpad e o resto, com o pacote oficial do fabricante do PC/placa-mãe (Dell, HP, Lenovo, ASUS), casado pelo código de hardware de cada peça.

**Architecture:** `src/oem.js` (UMD, puro) identifica o PC, guarda os domínios/assinantes fixos e casa pacotes com peças. `electron/oem-sources.cjs` valida a lista de fontes (GitHub + cópia local) e interpreta cada formato (Dell, HP, Lenovo, ASUS) com o leitor `electron/xml-lite.cjs`. `electron/drivers.cjs` busca e confere os catálogos na leitura online; `src/drivers.js` vira os pacotes em cartões; o motor de download e a instalação elevada ganham lista de assinantes e pacotes `.zip`/`.cab`/`.inf`.

**Tech Stack:** Electron, Node `node:test`, PowerShell 5.1 (`expand.exe`, `Expand-Archive`, `pnputil`, Authenticode), sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-18-drivers-fontes-fabricantes-design.md`

## Global Constraints

- Branch `feat/drivers-fontes`; commits em português, com as linhas de atribuição do Claude.
- **Vídeo (classe `DISPLAY`) nunca usa pacote do fabricante do PC** (fica NVIDIA/AMD/Intel). Todo o resto → fabricante do PC/placa-mãe.
- **Windows Update: nunca.** Catálogo da Microsoft não entra nesta parte.
- Domínios e assinantes permitidos **fixos em `src/oem.js`**; a lista remota só escolhe entre eles.
- Domínios por tipo: `dell-catalog` → `dell.com`; `hpia-ref` → `hp.com`, `hpcloud.hp.com`; `lenovo-catalog` → `lenovo.com`; `asus-api` → `asus.com`, `asus.com.cn`.
- Assinantes por fonte: Dell → `Dell Inc`, `Dell Technologies`, `Dell Inc.`; HP → `HP Inc.`, `Hewlett-Packard Company`, `HP Inc`; Lenovo → `Lenovo`, `Lenovo (Beijing) Limited`; ASUS → `ASUSTeK COMPUTER INC.`, `ASUSTeK Computer Inc.`. Em todas, também: `Intel Corporation`, `Advanced Micro Devices, Inc.`, `Realtek Semiconductor Corp.`, `Qualcomm Technologies, Inc.`, `MediaTek Inc.`, `Synaptics Incorporated`, `ELAN Microelectronics Corp.`, `Microsoft Windows Hardware Compatibility Publisher`, `Microsoft Corporation`.
- Lista remota: `https://raw.githubusercontent.com/Samuklvm/Project-Nexo/main/docs/drivers/fontes.json`, cache **6 h**; cópia local `electron/drivers-fontes.json`. As duas com o mesmo conteúdo.
- Códigos de hardware: até **6** por dispositivo, maiúsculos, até **200** caracteres, só `A-Z 0-9 _ & \ . -` (o resto descarta o código).
- BIOS/firmware: **nunca** Baixar; só aviso.
- Comparação de versão: só número a número no mesmo formato; senão `unknown` → estado `oem` ("Pacote do fabricante disponível"). **Nunca** pela data.
- MD5 só para Dell (catálogo assinado). Catálogos `.cab` com assinatura conferida (Dell, HP). Lenovo e ASUS: domínio fixo + hash + assinatura do pacote.
- Vigia `fonte-de-driver`: no máximo 1 por fonte por dia, sem modelo nem lista de peças.
- **Nada de CHANGELOG** (a novidade vai para `claude/pendente-proxima-versao.md` no fim).
- Sem dependência nova; sem regex com retrocesso perigoso; sem `style=` embutido; sem loop infinito de CSS.

## Review Focus

1. **PC montado com placa genérica** ("To be filled by O.E.M.", "System Product Name") ou notebook de marca sem fonte (Positivo, Avell): a página continua igual a hoje, sem erro nem "fonte fora do ar" → teste na Tarefa 2 (`identify` devolve `null`) e na Tarefa 6 (`sem fabricante identificado não busca nada`).
2. **XML enorme ou malicioso** (entidade externa, `<!DOCTYPE>`, 50 MB): o leitor recusa sem travar → testes na Tarefa 1.
3. **Dois pacotes servindo a mesma peça** (pacote velho e novo do mesmo driver no catálogo): fica só o de versão maior/data mais nova → teste na Tarefa 2 (`empate`).
4. **Fonte fora do ar ou formato mudado**: a página abre normal, com a linha "Fonte da Dell fora do ar agora" e um vigia por dia → testes na Tarefa 6 e na Tarefa 9.
5. **Pacote `.zip` sem instalador nem `.inf`** (só um PDF, por exemplo): não instala e explica → teste na Tarefa 7.

---

### Task 1: Leitor de XML pequeno e seguro

**Files:**
- Create: `electron/xml-lite.cjs`
- Test: `tests/oem.test.cjs` (novo; adicionar ao `package.json`)

**Interfaces:**
- Produces: `parseXml(text: string, { maxBytes = 30 * 1024 * 1024, maxDepth = 64, maxNodes = 400000 } = {}) → Node`, com `Node = { name, attrs: {}, children: Node[], text: string }`; helpers `kids(node, name) → Node[]` (filhos diretos, nome sem prefixo de namespace, sem diferenciar maiúsculas), `kid(node, name) → Node|null`, `walk(node, name) → Node[]` (todos os descendentes com o nome), `textOf(node, name) → string`.

- [ ] **Step 1: Testes**: `xml: elementos, atributos, texto e entidades` (`&amp; &lt; &gt; &quot; &apos; &#65; &#x41;`); `xml: CDATA e comentários`; `xml: prefixo de namespace some do nome` (`<x:Foo>` → `Foo`); `xml: recusa DOCTYPE e ENTITY` (lança `/DOCTYPE/`); `xml: recusa acima do limite de tamanho, profundidade e nós`; `xml: tag sem fechar lança`; `xml: BOM UTF-8 e cabeçalho <?xml?> aceitos`.
- [ ] **Step 2:** `node --test tests/oem.test.cjs` → FAIL.
- [ ] **Step 3:** Implementar com varredura por índice (`indexOf`), sem regex de backtracking; pilha de nós.
- [ ] **Step 4:** → PASS. **Step 5: Commit** `Drivers: leitor de XML pequeno e seguro para os catálogos`.

### Task 2: Identificação do PC, casamento e comparação (`src/oem.js`)

**Files:** Create `src/oem.js` (UMD como `src/drivers.js`; incluir no `index.html` antes de `src/drivers.js`); Test `tests/oem.test.cjs`.

**Interfaces:**
- Produces:
  - `DOMAINS: { [type]: string[] }`, `SIGNERS: { dell|hp|lenovo|asus: string[] }`, `PART_SIGNERS: string[]`, `signersFor(oem) → string[]` (fonte + peça).
  - `identify(board) → { oem, key, label } | null` (regras da spec §1; Dell `key` = SKU maiúsculo; HP `key` = `board.product` maiúsculo; Lenovo `key` = 4 primeiros de `model` maiúsculos; ASUS/MSI/Gigabyte/ASRock/Acer `key` = `board.product` (desktop) ou `model` (notebook), cortado em 80; `label` = "Dell XPS 15 9530" etc.).
  - `normalizeHwid(id) → string|null`; `hwidRank(deviceId, pkgId) → 0|1|2|3` (3 = igual com SUBSYS, 2 = igual sem SUBSYS/REV, 1 = só `VEN&DEV`, 0 = não casa; `*` só no fim do código do pacote).
  - `matchPackages(devices: Array<{ name, cls, maker, version, date, hwids: string[] }>, packages: Package[]) → Array<{ pkg, devices }>` (ignora `cls === 'DISPLAY'` e `pkg.bios`; um pacote por dispositivo — o de maior `hwidRank`, depois versão maior, depois data mais nova; ASUS sem `hardwareIds`: categoria ↔ classe + fabricante da peça no título).
  - `compareToInstalled(installed: string, pkg: Package) → 'newer'|'same'|'older'|'unknown'` (usa `pkg.driverVersion`; formatos diferentes → `unknown`).
- [ ] **Step 1: Testes**:
  ```js
  assert.deepEqual(O.identify({ systemMaker: 'Dell Inc.', model: 'XPS 15 9530', sku: '0BEB' }), { oem: 'dell', key: '0BEB', label: 'Dell XPS 15 9530' });
  assert.equal(O.identify({ systemMaker: 'HP', product: '8870', model: 'HP EliteBook 840 G8 Notebook PC' }).key, '8870');
  assert.equal(O.identify({ systemMaker: 'LENOVO', model: '20XWCTO1WW', version: 'ThinkPad X1 Carbon Gen 9' }).key, '20XW');
  assert.equal(O.identify({ systemMaker: 'System manufacturer', maker: 'ASUSTeK COMPUTER INC.', product: 'ROG STRIX B550-F GAMING', model: 'System Product Name' }).oem, 'asus');
  assert.equal(O.identify({ systemMaker: 'To be filled by O.E.M.', maker: 'To be filled by O.E.M.', product: 'Default string' }), null);
  assert.equal(O.identify({ systemMaker: 'Positivo Tecnologia SA', model: 'VJFE42F11X' }), null);
  assert.equal(O.hwidRank('PCI\\VEN_8086&DEV_A0F0&SUBSYS_0A6F1028&REV_20', 'PCI\\VEN_8086&DEV_A0F0&SUBSYS_0A6F1028'), 3);
  assert.equal(O.hwidRank('PCI\\VEN_8086&DEV_A0F0&SUBSYS_0A6F1028&REV_20', 'PCI\\VEN_8086&DEV_A0F0'), 1);
  assert.equal(O.hwidRank('HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280A6F', 'HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295*'), 2);
  assert.equal(O.hwidRank('PCI\\VEN_8086&DEV_A0F0', 'PCI\\VEN_8086&DEV_A0F1'), 0);
  // vídeo nunca, BIOS nunca, empate: maior versão
  // compare: '27.20.100.9168' vs driverVersion '27.20.100.9466' → newer; 'A05' → unknown; igual → same; menor → older
  ```
  e `empate`: dois pacotes com o mesmo código, versões `1.2.3` e `1.10.0` → fica `1.10.0`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + `npm test`. **Step 5: Commit** `Drivers: identificação do PC e casamento de pacotes por código de hardware`.

### Task 3: Leitura local com códigos de hardware e modelo exato

**Files:** Modify `electron/drivers.cjs` (`RUNTIMES_SCRIPT`, `ALL_DRIVERS_SCRIPT`, `parseRuntimes`, `parseAllDrivers`); Test `tests/drivers.test.cjs`.

**Interfaces:**
- Produces: cada linha de dispositivo ganha `hwids: string[]` e `inf: string`; `parseAllDrivers` devolve também `genericDevices: Row[]` (os de driver Microsoft, até 300, sem cartão próprio); `runtimes.board` ganha `sku`, `version`, `bios`; `runtimes.missing[]` ganha `hwids`.
- [ ] **Step 1: Testes**: `parseAllDrivers` mantém até 6 `hwids` válidos e descarta inválidos (`'PCI\\VEN_8086&DEV_A0F0'` fica; `'x'.repeat(201)` e `'PCI\\VEN<script>'` saem); `genericDevices` existe e `generic` (contagem) continua; `parseRuntimes` aceita `board.sku` `'0BEB'` e corta texto de controle.
- [ ] **Step 2:** FAIL. **Step 3:** PowerShell: `@($d.HardWareID | Select-Object -First 6)`, `$d.InfName`, `Win32_ComputerSystem.SystemSKUNumber`, `Win32_ComputerSystemProduct.Version`, `Win32_BIOS.SMBIOSBIOSVersion`; o Row do Microsoft-driver continua igual, só vai para `genericDevices`. Corpos novos no `tests/powershell-parse.test.cjs` (já inclui os scripts da página? conferir e incluir).
- [ ] **Step 4:** PASS + suíte. **Step 5: Commit** `Drivers: leitura dos códigos de hardware e do modelo exato do PC`.

### Task 4: Lista de fontes e formato da Dell

**Files:** Create `electron/oem-sources.cjs`, `electron/drivers-fontes.json`, `docs/drivers/fontes.json`, `tests/fixtures/oem/dell-index.xml`, `tests/fixtures/oem/dell-catalog.xml`; Test `tests/oem-sources.test.cjs` (novo; no `package.json`).

**Interfaces:**
- Consumes: `parseXml`/`kids`/`walk` (T1); `DOMAINS` (T2).
- Produces:
  - `parseSourceList(json) → { version, sources: { [oem]: { type, ...urls } }, disabled: string[] } | null` (tipo desconhecido some; URL fora de `DOMAINS[type]` some; `disabled` só ids conhecidos).
  - `Package` (spec §3) + `driverVersion?: string`.
  - `parseDellIndex(xml, sku) → string|null` (caminho do catálogo do modelo, `downloads.dell.com/<path>`; casa `SupportedSystems/Brand/Model[@systemID=sku]`).
  - `parseDellCatalog(xml, base = 'https://downloads.dell.com/') → Package[]` (`SoftwareComponent` com `ComponentType@value=DRVR` → driver; `BIOS`/`FRMW` → `bios: true`; `hashMD5`, `vendorVersion` → `driverVersion` se numérico, `dellVersion` → `version`, `releaseDate`, `size`, `hardwareIds` de `SupportedDevices/Device/PCIInfo` (`PCI\VEN_xxxx&DEV_xxxx[&SUBSYS_ddddssss]`) e `PnPInfo@pnpString`; `kind` pela extensão).
- [ ] **Step 1: Testes** com fixtures resumidas (2–3 componentes, um BIOS) no formato real (conferir com a busca/leitura de página antes de escrever a fixture e citar a fonte no topo do arquivo): índice acha o modelo `0BEB` e ignora outro; catálogo dá `hardwareIds` com e sem SUBSYS, `md5`, `driverVersion`, `bios: true`; URL fora de `dell.com` some; `parseSourceList` com tipo `evil`, URL `https://evil.example/` e `disabled: ['dell','nada']`.
- [ ] **Step 2–4:** FAIL → implementar → PASS + suíte. **Step 5: Commit** `Drivers: lista de fontes e catálogo da Dell`.

### Task 5: Formatos da HP, Lenovo e ASUS (+ MSI/Gigabyte/ASRock/Acer)

**Files:** Modify `electron/oem-sources.cjs`; fixtures `hp-ref.xml`, `lenovo-catalog.xml`, `lenovo-package.xml`, `asus-drivers.json`; Test `tests/oem-sources.test.cjs`.

**Interfaces:**
- Produces: `hpRefUrl(base, platform, { win11, release }) → string` (`<base><plat>/<plat>_64_<10|11>.0.<rel>.cab`, `rel` ∈ `2009|21H2|22H2|23H2|24H2|25H2`, a do PC ou a mais próxima abaixo); `parseHpRef(xml) → Package[]` (`UpdateInfo` com `Category` contendo `Driver` → driver; `BIOS`/`Firmware` → `bios`; `Url` (`ftp.hp.com` → `https://ftp.hp.com`), `SHA256`, `Version`, `ReleaseDate`, `Devices/Device`); `lenovoCatalogUrl(base, type, win11) → string`; `parseLenovoCatalog(xml) → string[]` (URLs dos descritores, no máximo 120); `parseLenovoPackage(xml, url) → Package|null` (versão, data, arquivo `.exe` com `SHA256`/`CRC`, `_PnPID` → `hardwareIds`, `_Driver` → `driverVersion`, `PackageType@type` 1/2 = app/driver, BIOS → `bios`); `parseAsus(json) → Package[]` (categorias de driver, sem BIOS; `hardwareIds: []`, `category`, `title`, `url` em `dlcdnets.asus.com`, `sha256` se vier); `supportUrlFor(id, key) → string|null` (página do modelo exato para MSI/Gigabyte/ASRock/Acer quando o formato da URL for conhecido; senão `null`).
- [ ] **Step 0:** pesquisar (busca/leitura de página) se MSI, Gigabyte, ASRock ou Acer têm consulta JSON pública e estável; registrar no ledger. Se tiver, vira tipo novo com fixture; se não, só `supportUrlFor`.
- [ ] **Step 1: Testes** com as fixtures (formato conferido como na T4): HP com driver, BIOS e URL `ftp.hp.com`; HP release escolhe `24H2` para build 26100 e `23H2` para 22631; Lenovo catálogo → descritores; Lenovo pacote com `_PnPID` curinga e `_Driver`; ASUS JSON → pacotes por categoria sem BIOS; domínio errado some em todos.
- [ ] **Step 2–4.** **Step 5: Commit** `Drivers: catálogos da HP, Lenovo e ASUS`.

### Task 6: Busca online dos catálogos na leitura (`latest.oem`)

**Files:** Modify `electron/drivers.cjs` (`createDrivers`, `scan`); Modify `main.cjs` (injetar `fetchBytes`, `fs`, pasta `driver-catalogs` em `downloadsDir`… vizinha); Test `tests/drivers.test.cjs`.

**Interfaces:**
- Consumes: T2, T4, T5; `signatureScript`/`parseSignature` (assinatura do `.cab`).
- Produces: `createDrivers({ ..., fetchBytes, fs, catalogDir })`; `scan()` → `latest.oem = { oem, label, key, at, packages: Package[] (só os casáveis, no máximo 400), bios?: { version, date }, error?: { source, stage, code } }`; `expandCabScript(cab, outDir) → string` (`expand.exe -F:* <cab> <dir>`, caminhos só dentro de `catalogDir`).
- Fluxo: `identify(runtimes.board)` → `null` = nada; lista de fontes (cache 6 h; falhou → cópia local); `disabled` = nada; por tipo: Dell índice → catálogo; HP ref; Lenovo catálogo → descritores (no máximo 120, 6 em paralelo); ASUS JSON. `.cab` → assinatura conferida (`SIGNERS[oem]`) → expandir → ler o XML (limite 30 MB). Cache dos pacotes 6 h por `oem:key`.
- [ ] **Step 1: Testes**: `sem fabricante identificado não busca nada`; Dell completo com `fetchBytes`/`runPowerShellCode` falsos (assinatura válida → pacotes; assinatura de outro → `error.stage = 'signature'`, sem pacotes); lista remota inválida → usa a local; `disabled: ['dell']` → nada; erro de rede → `error.stage = 'index'` e a leitura local continua inteira; cache de 6 h (segunda leitura não chama a rede).
- [ ] **Step 2–4.** **Step 5: Commit** `Drivers: busca e conferência dos catálogos do fabricante do PC`.

### Task 7: Download e instalação de pacotes (`zip`, `cab`, `inf`, vários assinantes)

**Files:** Modify `electron/driver-signature.cjs`, `electron/driver-download.cjs`, `electron/elevate.cjs`; Test `tests/driver-download.test.cjs`, `tests/powershell-parse.test.cjs`.

**Interfaces:**
- Produces:
  - `allowedSigner(name)` aceita também `SIGNERS`/`PART_SIGNERS` de `src/oem.js`; `signatureCore(file, signers: string|string[])` (`-ccontains`); `parseSignature(stdout, signers)`.
  - Plano de download: `signers: string[]` (aceita o antigo `signer`), `kind: 'exe'|'zip'|'cab'|'msi'`, `md5?`, `sha256?`, `sha512?` (o motor confere o que vier; MD5 só se `source === 'dell'`); `SAFE_NAME` aceita `.zip`/`.cab`.
  - `driverInstallBody({ file, dir, signers, kind, restorePoint, description })`: `exe`/`msi` como hoje; `zip` → `Expand-Archive -LiteralPath <cópia> -DestinationPath <work>\x`; `cab` → `expand.exe -F:* <cópia> <work>\x`; depois `setup.exe` → `AsusSetup.exe` → `install.exe` (na raiz de `x` ou num único subdiretório) com assinatura conferida; senão `.inf` com `.cat` assinado (Microsoft Windows Hardware Compatibility Publisher ou lista) → `pnputil.exe /add-driver "<x>\*.inf" /subdirs /install` (código 0/3010/259 "nada a fazer" = ok); senão `$r.note = 'o pacote não tem instalador nem driver'`.
  - `insideDir` aceita `.zip`/`.cab`.
- [ ] **Step 1: Testes**: motor aceita `kind: 'zip'` com `sha256` certo e recusa errado; MD5 recusado fora da Dell; `signers` com dois nomes passa no `start`; corpo `zip` tem `Expand-Archive` antes de `setup.exe` e `pnputil` só depois de conferir `.cat`; corpo sem nada → nota; `powershell-parse` com os três modos.
- [ ] **Step 2–4.** **Step 5: Commit** `Drivers: instalação de pacotes zip, cab e inf com vários assinantes`.

### Task 8: Cartões dos pacotes (`src/drivers.js`)

**Files:** Modify `src/drivers.js` (`build`, `downloadOf`, `STATES`, novo `oemCards`); Test `tests/drivers.test.cjs`.

**Interfaces:**
- Consumes: `matchPackages`, `compareToInstalled`, `signersFor`, `DOMAINS` (T2); `latest.oem` (T6); devices com `hwids` (T3).
- Produces: cartão de pacote `{ id: 'oem-<pkg.id>', kind: 'oem', name: pkg.title, brand: oem, state: 'update'|'oem', installed: maior versão entre as peças, latest: { version: pkg.driverVersion || pkg.version, date }, covers: string[] (nomes das peças), download }` no grupo da classe do primeiro dispositivo (`MEDIA`→audio, `NET`→rede, `BLUETOOTH`→bluetooth, `HDC`/`SCSIADAPTER`→disco, `SYSTEM`→placa, sem driver→semdriver, resto→outros); `download = { url, domains: DOMAINS[type], fileName, signers, kind, md5|sha256, size, primary: state === 'update', label: 'Baixar · Dell · 34 MB' }`; cartões de peças cobertas ganham `coveredBy: 'oem-<id>'` e perdem o botão do site; `STATES.oem = 'Pacote do fabricante disponível'`; `summary.oem` (não entra em `update`); `model.oem = { label, at, error, bios }`.
- [ ] **Step 1: Testes**: Dell com áudio Realtek casado → cartão `oem` no grupo Áudio, `state: 'update'` quando `driverVersion` maior; `unknown` → `state: 'oem'` e não conta no topo; vídeo com pacote Dell continua NVIDIA; BIOS → `model.oem.bios` e nenhum cartão; peça coberta tem `coveredBy`; `downloadFor(model, 'oem-…')` devolve o plano com `signers` da Dell + peças.
- [ ] **Step 2–4.** **Step 5: Commit** `Drivers: cartões dos pacotes do fabricante do PC`.

### Task 9: Tela, vigia e prévia

**Files:** Modify `src/view-drivers.js`, `style.css`, `index.html` (script `src/oem.js`), `main.cjs` (vigia), `dev/mock-bridge.js`; Test `tests/watch-main.test.cjs` (o vigia está no `main.cjs`), `tests/drivers.test.cjs` (texto puro `D.oemLine(model.oem, now)`).
- Produces: `D.oemLine(oem, now) → string` ("Seu PC: Dell XPS 15 9530 · lista oficial da Dell conferida às 14:32" / "Fonte da Dell fora do ar agora; tentando de novo mais tarde" / '' sem fabricante); cartão `oem` com selo da fonte, "Atualiza: Realtek Audio, …" (até 3 nomes + "e mais N"), botão discreto quando `state: 'oem'`; peça coberta: "Atualizado pelo pacote do fabricante abaixo"; BIOS: aviso no cartão da placa com botão do site; vigia `errorLog.record({ source: 'principal', level: 'aviso', message: 'Fonte de drivers falhando: <fonte>', context: { fonte, etapa, codigo, vigia: 'fonte-de-driver' } })` no máximo 1 por fonte por dia.
- [ ] **Step 1: Testes**: `oemLine` nos três casos; `watch-main` inclui `vigia: 'fonte-de-driver'`.
- [ ] **Step 2–3:** implementar; mock com um Dell XPS e 3 pacotes (áudio `update`, chipset `oem`, Wi-Fi Intel).
- [ ] **Step 4:** `npm test`; prévia conferida com capturas (padrão, aurora, brasa, 960 px). **Step 5: Commit** `Drivers: pacotes do fabricante na tela e vigia de fonte quebrada`.

### Task 10: Fechamento

- [ ] `npm test` inteiro 3 vezes → PASS. Atualizar `claude/pendente-proxima-versao.md` (seção Drivers) com a novidade PT/EN e o que conferir no Windows; atualizar o doc do projeto. Avisar a sessão do servidor (via doc pendente) que o vigia novo `fonte-de-driver` ainda não tem nome bonito no painel.
