# Drivers: fontes dos fabricantes de PC e placa-mãe (projeto 2, parte 1 de 4)

Data: 18/11/2026 · Versão alvo: a próxima depois da 0.11.4 · Status: na `main` desde 18/11/2026 (revisado; falta conferir os formatos no Windows)

## Por que

O Samuel quer que **todos os drivers de todas as máquinas** possam ser atualizados pelo Nexo, sempre do site
oficial. Hoje o botão Baixar cobre só NVIDIA, Visual C++, DirectX 9 e .NET. Chipset, áudio, rede, Wi-Fi, Bluetooth,
touchpad, leitor de cartão e o resto caem no "Site oficial", e a pessoa volta a fazer roleta russa.

A fonte certa para essas peças é **o fabricante do PC ou da placa-mãe**: é ele que valida o driver para aquele modelo
(a própria Intel e a própria AMD recomendam o driver do fabricante do computador antes do genérico delas).

O projeto 2 inteiro, combinado com o Samuel:
1. **Motor de fontes + listas dos fabricantes de PC e placa-mãe** (este documento)
2. Fabricantes de peça: AMD, Intel, periféricos (Logitech, Razer, Corsair, SteelSeries) e runtimes antigos de jogos
3. Catálogo da Microsoft como último recurso
4. "Atualizar tudo" na ordem certa e backup dos drivers atuais

## Regra de ouro (do Samuel)

- **Se o Nexo sabe quem fez a peça, o driver vem só do site oficial desse fabricante.** Sem download direto, fica o
  botão do site.
- O Catálogo da Microsoft só vale para peça cujo fabricante o Nexo **não consegue identificar de jeito nenhum** (parte 3).
- **Windows Update: nunca.**

### Quem ganha quando há duas fontes oficiais (o Samuel escolheu)

- **Placa de vídeo → sempre o fabricante do chip** (NVIDIA, AMD, Intel), como já é hoje: é o driver mais novo, e é o
  que pesa em jogo. Pacote de vídeo da lista do fabricante do PC é ignorado.
- **Todo o resto** (chipset, áudio, rede, Wi-Fi, Bluetooth, touchpad, leitor de cartão, câmera...) **→ o fabricante do
  PC/placa-mãe**, que valida para aquele modelo.
- Se o fabricante do PC **não tiver pacote** para aquela peça → fica o que existe hoje (botão do site do fabricante da
  peça) e, na parte 2, o download direto do fabricante da peça (AMD, Intel...).

## Metas

- Identificar o **modelo exato** do PC: fabricante, modelo, código do sistema (Dell: SKU de 4 dígitos hex; HP: código
  da placa de 4 dígitos hex; Lenovo: tipo de máquina de 4 caracteres; ASUS/MSI/Gigabyte/ASRock: nome do produto da placa).
- Ler a **lista oficial de drivers daquele modelo** e casar cada pacote com as peças do PC pelos **códigos de hardware**
  que o Windows dá a cada dispositivo (`PCI\VEN_8086&DEV_A0F0&SUBSYS_...`), e não pelo nome.
- Cartões de dispositivos que hoje mostram "Site oficial" ganham **Baixar** quando há pacote do fabricante, com o
  nome da fonte ("Dell", "HP"...), a versão do pacote e a data.
- **Pacotes que não são `.exe`**: `.zip` (ASUS e outros) e `.cab`. O Nexo extrai numa pasta protegida e instala o
  instalador de dentro ou, se for driver "cru" (`.inf`), instala pela ferramenta do próprio Windows (`pnputil`).
- **Lista de fontes atualizável sem versão nova**: um arquivo JSON no repositório (`docs/drivers/fontes.json`), lido
  pelo app; uma cópia vai junto do app para funcionar sem internet no GitHub.
- **Vigia de fonte quebrada**: quando uma fonte falha (formato mudou, 404, assinatura), vai um aviso anônimo para o
  painel (os vigias da 0.11.4), com o nome da fonte e o tipo do erro.

### Cobertura desta parte

| Fabricante | Fonte oficial | Como identifica o modelo | Situação |
|---|---|---|---|
| **Dell / Alienware** | Catálogo do Dell Command Update (índice + catálogo por modelo, `.cab` assinado) em `downloads.dell.com/catalog/` | SKU do sistema | pacote por peça, com MD5 |
| **HP** (linhas empresariais: EliteBook, ProBook, ZBook, Elite/Pro Desk) | Arquivo de referência do HP Image Assistant, um por modelo e versão do Windows (`hpia.hpcloud.hp.com/ref/<código>/<código>_64_<win>.<ver>.cab`, assinado) | código da placa | pacote por peça, com SHA-256 |
| **Lenovo** (Think\* e o que o System Update atender) | Catálogo por tipo de máquina do Lenovo System Update (`download.lenovo.com/catalog/<tipo>_<Win10|Win11>.xml`) e o descritor de cada pacote | tipo de máquina | pacote por peça, com regra de detecção por código de hardware |
| **ASUS / ROG** (notebook e placa-mãe) | Consulta de drivers por modelo do site de suporte da ASUS (`GetPDDrivers`, JSON) | nome do modelo/placa | pacote por categoria (casar por nome e código) |
| **MSI, GIGABYTE/AORUS, ASRock, Acer** | Consulta da página de suporte de cada uma, quando existir (a descobrir no build) | nome do modelo/placa | "melhor esforço": sem consulta estável, fica o botão do site do modelo exato |
| HP de linha doméstica (Pavilion, OMEN, Victus), Samsung, Positivo, Avell, LG | — | — | botão do site de suporte do modelo (como hoje); entram aqui se surgir fonte legível |

## Não-metas

- AMD, Intel, periféricos, runtimes antigos (parte 2). Catálogo da Microsoft (parte 3). "Atualizar tudo" e backup (parte 4).
- **BIOS e firmware**: não entram no Baixar (risco de deixar o PC sem ligar). Quando o catálogo trouxer BIOS mais nova,
  o cartão da placa só **avisa** e abre a página oficial.
- Instalação silenciosa (continua a tela do fabricante; para `.inf`, a janela do Windows não existe, então o Nexo
  mostra o progresso dele).
- Mandar a lista de peças para o servidor do Nexo (as buscas são feitas pelo próprio PC).

## Anti-metas

- Driver do **modelo errado** (ex.: pacote de outro Dell): só casa por SKU/código exato **e** por código de hardware.
- Instalar algo de domínio ou assinante que não esteja na lista fixa do app, **mesmo que a lista remota peça**.
- Rebaixar driver: pacote do fabricante mais antigo que o instalado não aparece como atualização.
- Página lenta: a leitura das fontes não pode travar a página nem a leitura local (fica em segundo plano, com cache).

## Restrições do projeto

- Tudo da parte 1 do projeto 1 continua valendo: id do cartão só, conferência em cada redirecionamento, fila de 4,
  instalação uma de cada vez numa cópia em pasta só de administrador, ponto de restauração pela chave do topo.
- **Domínios e assinantes permitidos ficam fixos no código do app.** A lista remota só escolhe entre eles.
- `.cab` de catálogo também tem assinatura conferida (Dell e HP assinam os catálogos). O catálogo da Lenovo é XML
  solto: vale por HTTPS em domínio fixo + o hash e a assinatura de cada pacote (o mesmo critério da ASUS).
- Sem regex com retrocesso perigoso (SonarCloud), sem `style=` embutido, sem loop infinito de CSS.
- Interface em português; a novidade pública vai para o `pendente-proxima-versao.md` (nada de CHANGELOG nesta sessão).

## Abordagens consideradas

| | Abordagem | Ganha | Perde |
|---|---|---|---|
| | Cada fonte escrita direto no app | Simples | Site mudou = fonte parada até a próxima versão |
| ⭐ | **Tipos de fonte no app + lista de fontes atualizável** | Conserto no mesmo dia, sem versão nova; segurança local intacta | Um formato de lista a manter |
| | Servidor do Nexo faz as buscas | Mais rápido, menos carga nos sites | Lista de peças sai do PC; gasta o servidor grátis; servidor fora = nada atualiza |

**Escolhida: tipos de fonte no app + lista atualizável** (o Samuel aprovou).

## Decidido pelo Samuel

- Catálogo da Microsoft só como **último recurso**, para peça sem fabricante identificável (parte 3).
- Lista de fontes **atualizável sem versão nova**.
- Quem ganha com duas fontes: **vídeo pelo fabricante do chip, o resto pelo fabricante do PC** (opção B).
- Ordem das 4 partes acima.
- Interface mega bonita, na paleta do app.

## Como funciona

### 1. Identificação do PC e das peças (leitura local)

- `RUNTIMES_SCRIPT` ganha: `Win32_ComputerSystem.SystemSKUNumber`, `Win32_ComputerSystemProduct.Version` (Lenovo traz
  o nome comercial ali) e `Win32_BIOS.SMBIOSBIOSVersion`.
- `ALL_DRIVERS_SCRIPT` passa a guardar **até 6 códigos de hardware** por dispositivo (`HardWareID`), em maiúsculas,
  cada um com no máximo 200 caracteres e só `[A-Z0-9_&\\.-]`, mais o `INF` em uso.
- `src/oem.js` (novo, puro): `identify(board)` → `{ oem: 'dell'|'hp'|'lenovo'|'asus'|'msi'|'gigabyte'|'asrock'|'acer'|null, key, label }`.
  - Dell: `systemMaker` Dell/Alienware e SKU `^[0-9A-F]{4}$`.
  - HP: `systemMaker` HP/Hewlett-Packard e `board.product` `^[0-9A-F]{4}$`.
  - Lenovo: `model` começando com o tipo de máquina `^[0-9A-Z]{4}`.
  - ASUS/MSI/Gigabyte/ASRock: fabricante da placa e `board.product` (placa-mãe montada) ou `model` (notebook).
  - Valores genéricos ("To be filled by O.E.M.", "System Product Name") → `null`.

### 2. Lista de fontes (`fontes.json`)

```json
{
  "version": 3,
  "sources": {
    "dell":   { "type": "dell-catalog",  "index": "https://downloads.dell.com/catalog/CatalogIndexPC.cab" },
    "hp":     { "type": "hpia-ref",      "base": "https://hpia.hpcloud.hp.com/ref/" },
    "lenovo": { "type": "lenovo-catalog","base": "https://download.lenovo.com/catalog/" },
    "asus":   { "type": "asus-api",      "url": "https://www.asus.com/support/api/product.asmx/GetPDDrivers" },
    "msi":    { "type": "site-only" }
  },
  "disabled": []
}
```

- O app lê `https://raw.githubusercontent.com/Samuklvm/Project-Nexo/main/docs/drivers/fontes.json` (cache de 6 h) e,
  se falhar, usa a cópia que vai no app (`electron/drivers-fontes.json`).
- **Validação**: `type` só dos tipos que o app conhece; toda URL passa por `officialLink` com os domínios fixos do tipo
  (`DOMAINS_BY_TYPE`, no código); `disabled` desliga uma fonte na hora (o "interruptor" para fonte quebrada).
  Lista inválida inteira → cópia local.

### 3. Tipos de fonte (`electron/oem-sources.cjs`, cada um puro + um passo de rede)

Cada tipo exporta `fetchFor(machine, { fetchBytes, expandCab, verifySig })` → `Package[]`:

```
Package = { id, source, title, category, version, date, url, fileName, size?, sha256?, md5?, sha512?,
            hardwareIds: string[], kind: 'exe' | 'zip' | 'cab', signers: string[], bios?: true }
```

- **dell-catalog**: baixa o índice (`.cab`), confere a assinatura Dell, acha o catálogo do SKU, baixa e confere,
  extrai o XML e lê `SoftwareComponent` (só `ComponentType=DRVR`): `path`, `hashMD5`, `vendorVersion`, `releaseDate`,
  `SupportedDevices/Device/PCIInfo` (vendor/device/subVendor/subDevice) e `PnPInfo`. BIOS/firmware viram `bios: true`.
- **hpia-ref**: código da placa + Windows (10/11) + versão (`23H2`, `24H2`...) → baixa a referência, confere a
  assinatura HP, lê `UpdateInfo` (categoria Driver) com `Url`, `SHA256`, `Version`, `ReleaseDate` e os `Devices`.
- **lenovo-catalog**: `<tipo>_Win11.xml` (ou Win10) → lista de pacotes com o descritor; o descritor traz versão,
  data, arquivo com hash e a regra de detecção (`_PnPID`, com curinga) que vira `hardwareIds`.
- **asus-api**: modelo → JSON por categoria; casa por **categoria + fabricante da peça** (ex.: "Audio" + Realtek),
  porque a ASUS não lista códigos de hardware; arquivo em `dlcdnets.asus.com` (`.zip`), com SHA-256 quando vier.
- **site-only**: nada a baixar; garante que o botão do site abra a **página do modelo exato** quando possível.

`expandCab(file, dir)`: no Windows, `expand.exe -F:* <cab> <dir>` pelo PowerShell, só para arquivos da pasta do Nexo.

### 4. Casamento pacote ↔ peça (`src/oem.js`, puro)

- `matchPackages(devices, packages)`:
  1. Código de hardware: o código mais específico do dispositivo que casar (com `SUBSYS` > sem `SUBSYS` > só
     `VEN&DEV`; curinga `*` da Lenovo só no fim).
  2. Sem código (ASUS): categoria do pacote ↔ classe do dispositivo (`MEDIA`→Audio, `NET`→LAN/Wireless,
     `BLUETOOTH`→Bluetooth, `SYSTEM`→Chipset) **e** fabricante da peça no título do pacote.
  3. Empate: o pacote de data mais nova.
- `compareToInstalled(installed, pkg)` → `'newer' | 'same' | 'older' | 'unknown'`:
  - usa a **versão do driver** dentro do pacote quando a fonte traz (Dell `vendorVersion` no formato numérico do
    driver; Lenovo pela regra de detecção, que traz a versão do driver; HP quando `Version` tiver o mesmo formato do
    driver instalado) e compara número a número;
  - versão do pacote em outro formato (Dell `A05`, SoftPaq) → **`unknown`**. **Nunca** compara pela data do pacote
    contra a data do driver (o pacote sai sempre depois do driver que leva, e o cartão ficaria em "atualização" para
    sempre).
- Estados no cartão: `newer` → **"Atualização disponível"** (conta no topo); `unknown` → estado neutro **"Pacote do
  fabricante disponível"** (com Baixar discreto, não conta como atualização); `same`/`older` → nada muda.
- **Que dispositivos entram no casamento:** todos os de `ALL_DRIVERS_SCRIPT` **incluindo** os que usam driver da
  Microsoft (hoje só contados em `generic`) e os sem driver (`missing`, que passam a guardar os códigos completos).
- **Cartões por pacote**: um pacote casado vira **um cartão próprio** no grupo da classe do primeiro dispositivo que ele
  cobre (ex.: "Intel Serial IO" e "Intel Management Engine" no grupo Chipset), com a lista de peças que ele atualiza.
  O cartão do dispositivo coberto deixa de mostrar o botão do site (mostra "atualizado pelo pacote abaixo").
- Pacotes sem dispositivo casado (ex.: utilitário do fabricante) **não** aparecem nesta parte.

### 5. Download e instalação de `.zip` e `.cab`

- O motor (`driver-download.cjs`) já baixa com conferência; o plano ganha `kind`, `md5`/`sha256` e `signers` (lista).
- `driver-install` (elevado) ganha o modo **pacote**:
  1. copia o pacote para a pasta protegida (como hoje);
  2. `.zip`: `Expand-Archive` dentro dela; `.cab`: `expand.exe`;
  3. procura, nesta ordem, `setup.exe`, `AsusSetup.exe`, `install.exe` na raiz extraída; se achar, confere a
     assinatura (assinante na lista do pacote) e roda como hoje;
  4. senão, se houver `.inf`: confere a assinatura do `.cat` de cada `.inf` (assinado pela Microsoft — "Microsoft
     Windows Hardware Compatibility Publisher" — ou por um assinante da lista) e roda
     `pnputil /add-driver <pasta>\*.inf /subdirs /install`; código 3010 = reiniciar;
  5. nada disso → não instala e explica.
- **Assinantes por fonte** (fixos no app): Dell → `Dell Inc`, `Dell Technologies`; HP → `HP Inc.`, `Hewlett-Packard
  Company`; Lenovo → `Lenovo`; ASUS → `ASUSTeK COMPUTER INC.`, `ASUSTeK Computer Inc.`. Em todos, também os fabricantes
  de peça que os pacotes trazem dentro: `Intel Corporation`, `Advanced Micro Devices, Inc.`, `Realtek Semiconductor Corp.`,
  `Qualcomm Technologies, Inc.`, `MediaTek Inc.`, `Synaptics Incorporated`, `ELAN Microelectronics Corp.`,
  `Microsoft Windows Hardware Compatibility Publisher`, `Microsoft Corporation`. O assinante exato confere o `O=` do
  certificado (igualdade), como hoje.
- Hash: SHA-256/SHA-512 quando a fonte publicar; MD5 (Dell) aceito **só** porque o catálogo que o traz é assinado pela Dell.

### 6. Tela

- Cartão do dispositivo: selo pequeno da fonte (ícone do fabricante, já existente) + "Pacote do fabricante do seu PC".
- Topo da página: linha nova "Seu PC: **Dell XPS 15 9530** · lista oficial da Dell conferida às 14:32" (ou "Fonte da
  Dell fora do ar agora; tentando de novo mais tarde").
- BIOS mais nova: aviso no cartão da placa, sem Baixar.
- Leitura das fontes em segundo plano: a página abre com o que já tem e os cartões ganham o Baixar quando a lista chega
  (sem pular de lugar).

### 7. Vigia de fonte quebrada

- Erro ao buscar ou interpretar uma fonte → `vigia('driver-source', { source, stage: 'index'|'catalog'|'parse'|'signature', code })`
  pelo mecanismo dos vigias da 0.11.4 (anônimo, sem modelo nem lista de peças, no máximo 1 por fonte por dia).

## Testes

- `tests/oem.test.cjs` (novo): `identify` para cada fabricante e para valores genéricos; `matchPackages` com códigos
  com/sem `SUBSYS`, curinga, empate por data, ASUS por categoria; `isNewer` versão e data, nunca rebaixa.
- `tests/oem-sources.test.cjs` (novo), com XML/JSON de exemplo no formato de cada fonte (fixtures em `tests/fixtures/`):
  Dell (índice + catálogo), HP (referência), Lenovo (catálogo + descritor), ASUS (JSON); URL fora do domínio do tipo
  some; tipo desconhecido some; `disabled` desliga.
- `tests/driver-download.test.cjs`: `kind: 'zip'|'cab'` com `sha256`/`md5`; lista de assinantes.
- `driver-install`: modo pacote com `Expand-Archive`/`expand.exe`, ordem setup → inf, `.cat` conferido antes do
  `pnputil`, nada encontrado = não instala.
- `tests/powershell-parse.test.cjs`: os corpos novos.

## Fica para quem for construir

- Os formatos exatos de cada fonte **conferidos contra a resposta real** (o ambiente de build não alcança esses sites
  pelo terminal; usar a busca e a leitura de páginas, e salvar um exemplo resumido como fixture).
- Se MSI, Gigabyte, ASRock ou Acer têm consulta JSON estável: se tiver, vira tipo novo; se não, `site-only`.
- O código de versão do Windows para a HP (`10.0.<ver>`, ex. `2009`, `22H2`, `24H2`).
- O limite de tamanho do catálogo e o tempo de leitura (o da Dell por modelo é pequeno; o índice tem alguns MB).

## Decisões minhas (o Samuel pode trocar)

1. Lista de fontes no **repositório do GitHub** (não no servidor do Nexo): de graça, com histórico, e o conserto é um commit.
2. **BIOS/firmware fora do Baixar**, só aviso.
3. Casamento por **código de hardware**; nome só para a ASUS (que não publica códigos), sempre junto com a categoria.
4. MD5 da Dell aceito só porque vem dentro de um catálogo assinado.
5. Pacote que não casa com nenhuma peça não aparece nesta parte.
6. Versão do pacote que não dá para comparar com a do driver → estado neutro "Pacote do fabricante disponível" (nunca
   "atualização" pela data).
7. Pacotes casados viram **cartões próprios** (um por pacote), inclusive para peças com driver da Microsoft ou sem driver.
8. Lenovo sem assinatura no catálogo, mas com hash e assinatura em cada pacote.

## Como ficou na construção (18/11/2026)

Tudo acima foi feito; o que mudou em relação ao desenho:
- A busca dos catálogos ficou num arquivo próprio, `electron/oem-catalogs.cjs` (`lookup` chamado pela leitura).
- Falha de fonte fica 30 min em cache (sucesso, 6 h), para não insistir num site fora do ar.
- ASUS pela consulta do site ROG (`rog.asus.com/support/webapi/product/GetPDDrivers`), com códigos de hardware quando a
  ASUS manda e categoria + fabricante quando não.
- MSI, GIGABYTE, ASRock e Acer sem consulta pública: `site-only` (MSI de placa-mãe abre a página do modelo exato).
- O motor calcula sempre o SHA-256 do que baixou e a tarefa de administrador confere a cópia contra ele antes de abrir
  (em .zip/.cab é obrigatório): trocar o arquivo na pasta do usuário entre o download e a instalação não adianta.
- .zip/.cab não passam por Authenticode no download (não têm assinatura própria); o instalador de dentro, ou todo .cat,
  é conferido antes de rodar.
- O aviso de BIOS fica no quadro do PC no topo (com o botão da página de suporte), não no cartão da placa.
- A peça coberta mostra "Atualizado pelo pacote oficial da <marca>" com o atalho "Ver o pacote".
- Vigia com o nome `fonte-de-driver` (padrão dos vigias da 0.11.4), no máximo 1 aviso por fonte por dia.
- Os formatos de cada fonte foram montados pela documentação e por ferramentas que leem essas listas; falta conferir no
  Windows (lista no `pendente-proxima-versao.md`).
- Depois da revisão final: modelo sem lista (404) não é "fonte fora do ar"; a busca roda em segundo plano (limite de
  90 s); peça com driver básico da Microsoft ganha o pacote; ASUS por categoria exata (Wi-Fi, cabo e Bluetooth separados);
  catálogo só assinado pelo próprio fabricante do PC; servidores exatos; firmware fora do aviso de BIOS.
- Pedido do Samuel: o app não chuta mais pela idade do driver ("provavelmente há versão mais nova"). Sem lista do
  fabricante, o cartão diz "Confira no site"; o topo conta só o que o app sabe, cada peça uma vez.
