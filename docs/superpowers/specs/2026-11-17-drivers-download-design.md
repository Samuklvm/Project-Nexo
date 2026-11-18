# Drivers: baixar e instalar com um clique (projeto 1 de 5)

Data: 17/11/2026 · Versão alvo: a próxima depois da 0.11.4 · Status: aprovado pelo Samuel em 17/11/2026

## Por que

Hoje a página de Drivers mostra o que está instalado e abre o site do fabricante, e aí a pessoa vira detetive: acha o
modelo, escolhe o sistema, adivinha qual dos 14 arquivos é o dela. O Samuel quer o contrário: **um clique e o Nexo
baixa o arquivo certo para aquela peça naquele PC, direto do site oficial, com uma barra de progresso, e depois um
botão "Instalar"**. Sem roleta russa.

Este é o projeto 1 de 5 da reforma da página. A ordem combinada:
1. **Motor de download + Instalar + chave do ponto de restauração** (este documento)
2. Mais fontes ligadas no motor: catálogos oficiais por modelo (ASUS, HP, Dell, Lenovo), AMD e Intel
3. Inteligência: "esse driver é bom pros seus jogos" e histórico com comemoração
4. Usabilidade: filtro, chips por grupo, ordem guiada, bolinha na barra lateral
5. Constelação dos drivers no topo

## Metas

- Botão **Baixar** nos cartões que já têm link exato e oficial:
  - **NVIDIA GeForce** (linhas `modern` e `legacy`; desktop e notebook, cada um com o pacote certo)
  - **Visual C++** 64 e 32 bits (`aka.ms/vc14/...`)
  - **DirectX 9** (redistribuível oficial da Microsoft)
  - **.NET Desktop Runtime** (a mais recente de cada versão instalada, pelo índice oficial, que traz o hash do arquivo)
- Barra de progresso com %, velocidade, tempo restante e tamanho; **Cancelar**; se a internet cair, **continua de onde parou**.
- Antes de liberar o arquivo: **só HTTPS e só domínio oficial em cada redirecionamento**, **hash** quando a fonte
  publica e **assinatura digital válida do fabricante esperado** (NVIDIA Corporation, Microsoft Corporation).
- Botão **Instalar**: cria o ponto de restauração (se a chave estiver ligada) e abre o **instalador oficial**, com a
  tela do próprio fabricante. Quando o instalador fecha, o Nexo confere a versão de novo e o cartão vira "Em dia".
- **Chave no topo da página**: "Ponto de restauração antes de instalar". Vale para todos os drivers, fica salva e
  mostra o último ponto criado.
- Interface **bonita, sofisticada e moderna**, na paleta do app (ver "Visual").

## Não-metas (ficam para os próximos projetos ou para nunca)

- Fontes novas (AMD, Intel, catálogos por modelo): projeto 2. Nesses cartões o botão continua abrindo o site oficial.
- Instalação silenciosa, sem a tela do fabricante.
- Baixar ou instalar sem a pessoa clicar.
- **Windows Update: nunca.**
- Linux: a página continua com o aviso do gerenciador de pacotes.

## Anti-metas (seria um fracasso mesmo "funcionando")

- Baixar o arquivo errado para a peça (por exemplo, o pacote de desktop num notebook).
- Executar arquivo não oficial, adulterado ou assinado por outra empresa.
- A interface travar ou engasgar durante o download.
- Ponto de restauração "de mentira": dizer que criou quando o Windows não criou.
- Janela de administrador (UAC) aparecendo sem a pessoa ter clicado em Instalar.

## Restrições do projeto

- Rede, disco e processos ficam no processo principal; a tela só fala por IPC (`preload.cjs` → `call(...)`) e
  recebe eventos de progresso.
- **O `electron/elevate.cjs` é o único ponto que pede administrador**: tarefa nova entra na lista `TASKS`, com o
  corpo montado a partir de dados validados e enviado por `-EncodedCommand`.
- Domínios oficiais: `officialLink` (drivers.cjs) e `vendorHost` (main.cjs) já existem; o download usa a mesma regra.
- Os testes `tests/security-static.test.cjs` e `tests/drivers.test.cjs` continuam passando; testes novos para o motor.
- Interface em português (como o resto do app); textos públicos (CHANGELOG e novidades) em PT e EN na hora do release.
- Ninguém de fora decide a URL: **a tela manda só o id do cartão**, e o processo principal monta o plano de download
  a partir da última leitura. URL vinda da tela é recusada.

## Abordagens consideradas

| | Abordagem | Ganha | Perde |
|---|---|---|---|
| ⭐ | **Baixador próprio no processo principal** (`net.request` do Electron, em partes) | Confere cada redirecionamento, calcula o hash enquanto baixa, continua de onde parou (`Range`), cabeçalhos por fabricante, testável | Mais código nosso |
| | Gerenciador de downloads do Electron (`DownloadItem`) | Progresso e pausa prontos | Pouco controle de redirecionamento e hash; ruim de testar |
| | BITS do Windows via PowerShell | Continua com o app fechado | Progresso aos trancos; difícil de controlar e de mostrar erro |

**Escolhida: baixador próprio** (o Samuel escolheu). `net.request` usa o proxy e os certificados do sistema, como o
`fetchBytes` que o app já usa.

## Decidido pelo Samuel

- Depois de baixar: **botão Instalar que abre o instalador oficial**, com ponto de restauração antes (opção B).
- O ponto de restauração é **opcional, numa chave só, no topo da página** (não por driver).
- Download pelo **baixador próprio**.
- **Interface mega bonita**, sofisticada, moderna, nas cores da paleta.

## Como funciona

### Peças novas

- `electron/driver-download.cjs`: `createDriverDownloads({ request, fs, path, crypto, dir, verify, now })`
  - `plan(card, scan)`: monta `{ id, url, domains, fileName, size?, sha512?, signer }` só para os cartões suportados.
  - `start(id)`, `cancel(id)`, `list()` e um callback `onProgress(id, { received, total, speed, eta, phase })`.
  - Grava em `<arquivo>.part` e renomeia só depois de conferir tudo.
  - Redirecionamento manual: cada salto passa por `officialLink(url, domains)`; fora da lista, aborta.
  - Continua de onde parou com `Range` quando o servidor tem `Accept-Ranges`; senão, recomeça.
  - Tamanho máximo por arquivo (1,5 GB) e por resposta; fila sem limite: a pessoa pode pedir quantos quiser, **no máximo 4 baixando ao mesmo tempo** e os outros esperando na fila (estado `na fila`, com a posição e Cancelar).
  - Progresso para a tela no máximo 10 vezes por segundo.
- `src/drivers.js`: cada cartão ganha `download: { kind, size?, label }` quando o plano é possível (regra pura, testável).
- `src/view-drivers.js`: estados do cartão, a chave no topo e os eventos de progresso.
- `preload.cjs`: `downloadDriver(id)`, `cancelDriverDownload(id)`, `installDriver(id, { restorePoint })`,
  `driverDownloads()` e `onDriverDownload(callback)`.
- `electron/elevate.cjs`: tarefa nova **`driver-install`**.

### Conferência do arquivo

1. Hash: o `.NET` traz SHA-512 no índice oficial, então é obrigatório bater. Os outros não publicam hash.
2. Assinatura: `Get-AuthenticodeSignature -LiteralPath` (caminho só dentro da pasta de downloads do Nexo):
   `Status = Valid` **e** organização do certificado igual à esperada (`NVIDIA Corporation`, `Microsoft Corporation`).
3. Falhou: o arquivo é apagado e o cartão diz em português claro o que aconteceu ("O arquivo não veio assinado pela
   NVIDIA, então apaguei por segurança").

### Instalar (uma janela de administrador só)

A tarefa `driver-install` recebe `{ file, restorePoint, description }` e, **numa única elevação**:
1. confere de novo a assinatura (o mesmo arquivo, já como administrador, logo antes de rodar);
2. se a chave estiver ligada, cria o ponto de restauração (`restorePointCore`, que já contorna o limite de 24 h);
   se o Windows não criar (Proteção do Sistema desligada), **não instala** e devolve o motivo;
3. abre o instalador (`Start-Process -Wait -PassThru`) e devolve o código de saída.

Instalação é **uma de cada vez** (dois instaladores juntos brigam entre si no Windows): clicar Instalar em outro cartão
enquanto um roda põe ele na fila de instalação (`aguardando instalar`).

Se o ponto falhar, o cartão mostra o motivo e oferece **"Instalar sem ponto"** (outro clique, de propósito).
Quando a tarefa termina, o Nexo roda `scanDrivers({ force: true })` e o cartão vira "Em dia" se a versão subiu, ou
"O instalador fechou sem atualizar" se não subiu. Código de saída 3010 = "reinicie o PC para terminar".

### A chave do ponto de restauração

- Guardada nas preferências do app (`Nexo.keys`), **ligada por padrão**.
- Mostra "Último ponto: hoje, 14:32" (o último criado pelo Nexo) ou "Nenhum ponto criado pelo Nexo ainda".
- Desligada: a linha fica mais apagada e o texto diz "Instala direto, sem ponto de restauração".

### Arquivos baixados

- Pasta `userData/driver-downloads`, com o botão "Mostrar na pasta" no cartão.
- Arquivos instalados com sucesso são apagados depois de 14 dias; `.part` de mais de 7 dias também.

### Estados do cartão

`pronto para baixar` → `na fila` (posição) → `baixando` (barra) → `conferindo` → `pronto para instalar` (Instalar · Mostrar na pasta)
→ `instalando` → `conferindo a versão` → `Em dia ✓`.
Erros: `sem internet`, `link fora do site oficial`, `assinatura não confere`, `espaço em disco`, `cancelado`,
`ponto de restauração falhou`, `instalador fechou sem atualizar`.

## Visual

O topo segue o vidro da página (`.sheet`), com a cor de destaque do tema (`--neon`, `--neon-2`) em tudo, para
funcionar nas 7 cores (nebulosa, meteoro, aurora, vagalume, lua, brasa e a padrão).

```
┌ Drivers ─────────────────────────────────────────────────┐
│ 3 atualizações disponíveis            [↻ Conferir de novo]│
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 🛡  Ponto de restauração antes de instalar   (●──)    │ │
│ │     Último ponto: hoje, 14:32                         │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
 [ícone] GeForce RTX 4070      566.14 → 572.16   [⬇ Baixar · 680 MB]
         ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  68%   12,4 MB/s · faltam 20 s   [✕]
         ✓ Assinado pela NVIDIA                  [Instalar] [Pasta]
```

- **Chave**: o `.switch` do app, numa pílula de vidro com o escudo do lado; ligada, o escudo e a borda ganham um
  brilho suave da cor de destaque.
- **Barra**: 6 px, cantos redondos, trilho em vidro escuro e preenchimento em gradiente `--neon-2 → --neon` com
  brilho (`box-shadow`) e um reflexo correndo por cima. Números com `tabular-nums`, para não ficarem pulando.
- **Fases**: "conferindo" vira um reflexo contínuo sem porcentagem; "pronto" vira o selo verde `✓ Assinado pela NVIDIA`.
- **Sucesso**: um brilho curto de estrelinhas no cartão quando ele vira "Em dia" (some no Modo Leve e com
  `prefers-reduced-motion`).
- Tipografia caprichada, nas mesmas regras de `.driver-name` e `.driver-ver`; nada de texto cortado (`overflow-wrap`).
- Frase do topo nova: "O Nexo baixa só do site oficial de cada fabricante, confere a assinatura de cada arquivo e
  nunca usa o Windows Update."

## Testes

- `tests/driver-download.test.cjs` (novo): redirecionamento para domínio fora da lista aborta; hash errado apaga o
  arquivo; continua com `Range`; recomeça sem `Range`; cancelar apaga o `.part`; id desconhecido é recusado; URL vinda
  da tela é recusada; limite de tamanho.
- `tests/drivers.test.cjs`: quais cartões ganham `download` (NVIDIA ended/pro não; notebook pega o pacote de notebook).
- `driver-install` em `elevate.cjs`: caminho fora da pasta é recusado; o caminho vai com `psQuote`; o ponto falhando
  impede a instalação.
- `security-static`: a regra nova não abre brecha (nenhum `spawn` direto de instalador fora do `elevate.cjs`).

## Fica para quem for construir

- Os `psid/pfid` de série **notebook** da NVIDIA para pegar o pacote de notebook (testar contra o serviço oficial).
- A URL exata e o assinante do redistribuível do DirectX e do instalador do Visual C++ (conferir na hora).
- O tempo-limite do `elevate` para tarefas longas (instalador da NVIDIA leva minutos): `driver-install` precisa de um limite próprio, generoso.
- O tamanho do arquivo quando a fonte não informa (`Content-Length`).
- Os ajustes finos da barra e dos estados em telas estreitas (o `@media` que a página já tem).

## Decisões minhas (aprovadas pelo Samuel)

1. Ponto de restauração **ligado por padrão**.
2. Ponto + instalador **numa janela de administrador só**, e se o ponto falhar, não instala (oferece "Instalar sem ponto").
3. **Tela da NVIDIA/Microsoft aparece normal** na instalação (nada silencioso).
4. Arquivos na pasta do app, apagados 14 dias depois de instalados.
5. Fila sem limite, **no máximo 4 baixando ao mesmo tempo** (o Samuel ajustou de 2 para 4).
6. Instalação **uma de cada vez**, as outras na fila (downloads podem ir 4 juntos; instaladores não).
7. A tela só manda o **id do cartão**; a URL é sempre decidida pelo processo principal.
