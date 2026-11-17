# Conector do Claude para o painel — Plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O servidor do Nexo vira um conector remoto (MCP com OAuth) do claude.ai, com ferramentas que leem métricas,
telemetria e erros e marcam erros, sem nunca expor e-mails.

**Architecture:** Três módulos novos dentro do Worker de hoje, sem nenhuma dependência nova:
- `oauth.js` cuida da descoberta, do registro dinâmico, do código, dos tokens e da revogação, tudo no D1, e reaproveita
  a sessão do painel para o consentimento.
- `mcp.js` é o JSON-RPC sem estado.
- `tools.js` e `cruzar.js` são as ferramentas, que chamam as funções do painel que já existem.

O `app.js` liga as rotas e a limpeza do cron.

**Tech Stack:** Cloudflare Workers (ESM, Web Crypto), D1, testes `node:test` com o D1 simulado em SQLite.

**Spec:** `docs/superpowers/specs/2026-11-17-conector-claude-design.md` (leia junto; os detalhes de protocolo estão lá).

## Global Constraints

- Sem dependências npm novas no `server/`.
- E-mails, equipe e chaves nunca aparecem em resposta do `/mcp` (nem para o dono).
- `redirect_uris` aceitos: exatamente `https://claude.ai/api/mcp/auth_callback` e `https://claude.com/api/mcp/auth_callback`.
- Código de autorização: 60 s, uso único, só o hash guardado. Access token: 1 h. Refresh: 30 dias, trocado a cada uso;
  reuso revoga a autorização.
- Tokens com prefixo `nexo_at_` / `nexo_rt_`, guardados como SHA-256.
- Limites: 2.000 `tools/call` por dia por autorização; 60 pedidos de token/registro por dia por IP; 20 clientes no máximo.
- Versões do MCP: `2025-11-25`, `2025-06-18`, `2025-03-26` (escolhe a pedida, se suportada; senão a mais nova).
- `Origin` presente e diferente de `https://claude.ai`/`https://claude.com` → 403.
- Cookie do painel continua `SameSite=Strict`; a página de consentimento busca a sessão por `fetch` do próprio site.
- Textos e comentários em português; nada do conteúdo dos pedidos no log; cabeçalhos de segurança do servidor em toda
  resposta.
- Nada de CHANGELOG/notas de versão (é da sessão de releases).

## Review Focus

1. **Token vencido:** o `/mcp` com access token vencido tem que devolver 401 com `WWW-Authenticate` (para o Claude
   renovar sozinho), nunca `isError`. Teste na Task 3.
2. **Argumentos com tipo errado:** `dias: "30"`, `limite: -5`, `assinatura: 123` viram valores válidos ou um `isError`
   claro, nunca 500. Teste nas Tasks 4 e 5.
3. **Banco vazio:** um servidor sem telemetria nem erros devolve estruturas vazias em todas as ferramentas. Teste na
   Task 4.
4. **Pedido de token com `resource`, e refresh de outro `client_id`:** aceitar o `resource` igual a `<origem>/mcp`;
   recusar o refresh de outro cliente com `invalid_grant`. Teste na Task 2.
5. **Corpo do token em `x-www-form-urlencoded` com `+` e `%20`:** o `URLSearchParams` decodifica certo e o
   `code_verifier` com `~._-` passa. Teste na Task 2.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `server/migrations/0004_conector.sql` | Tabelas `oauth_clients`, `oauth_codes`, `oauth_grants`, `oauth_tokens`, `claude_actions` (SQL do spec) |
| `server/src/oauth.js` | `createOAuth(deps)`: descoberta, registro, consentimento, token, revogação, `bearer(request, env)` |
| `server/src/connect-page.js` | `CONNECT_HTML(params)`, `CONNECT_JS`, `CONNECT_CSS`: a página de autorização (visual do painel) |
| `server/src/mcp.js` | `createMcp({ tools, serverVersion })`: JSON-RPC, negociação de versão, `tools/list` e `tools/call` |
| `server/src/tools.js` | `createTools(panel)`: as 8 ferramentas (esquemas, anotações e chamada) |
| `server/src/cruzar.js` | `CAMPOS`, `MEDIDAS`, `crossTab(rows, args)` (função pura) |
| `server/src/app.js` | rotas novas, `panel` exposto para as ferramentas, a API do painel `claude`/`claude/revogar` e o cron |
| `server/src/panel.js` | cartões "Conexões do Claude" e "O que o Claude fez" na aba Equipe e acessos |
| `tests/helpers/server-harness.cjs` | `createHarness()`: D1, Google falso, relógio, `call`, `loginAs`, `panelCookie(email)` |
| `tests/server-conector.test.cjs` | testes do conector |
| `.github/workflows/server.yml` | rodar também `tests/server-conector.test.cjs` e reagir a ele no `paths` |
| `PRIVACIDADE.md`, `PRIVACY.md`, `docs/SERVIDOR.md` | parágrafo do Claude, PT e EN; seção "Conectar o Claude" |

---

### Task 1: Migração, harness de testes, descoberta e registro dinâmico

**Files:**
- Create: `server/migrations/0004_conector.sql`, `server/src/oauth.js`, `tests/helpers/server-harness.cjs`, `tests/server-conector.test.cjs`
- Modify: `server/src/app.js` (rotas), `.github/workflows/server.yml`

**Interfaces:**
- Produces:
  - `createOAuth({ now, limit, roleOf, ipKey, json, HttpError })` → `{ protectedResource(url), serverMetadata(url),
    register(request, env), … }`; as próximas tasks acrescentam o resto.
  - `createHarness()` → `{ setup(), panelCookie(call, loginAs, email), tick(ms) }`. `setup()` devolve
    `{ env, call, loginAs }` como em `tests/server.test.cjs`, e `call` também aceita `form` (corpo urlencoded) e
    `cookie`.

- [ ] **Step 1: Escrever os testes que falham** em `tests/server-conector.test.cjs`:
  - `descoberta: metadados do recurso e do servidor de autorização`:
    - `GET /.well-known/oauth-protected-resource` e `.../oauth-protected-resource/mcp` → 200,
      `resource === origem + '/mcp'`, `authorization_servers[0] === origem`;
    - `GET /.well-known/oauth-authorization-server` → `authorization_endpoint === origem + '/painel/conectar'`,
      `code_challenge_methods_supported` deep-equal `['S256']`, `token_endpoint_auth_methods_supported` deep-equal
      `['none']`, `registration_endpoint === origem + '/oauth/register'`.
  - `registro: só os callbacks do Claude`:
    - POST com `redirect_uris: ['https://claude.ai/api/mcp/auth_callback']` e `client_name: 'Claude'` → 201 com
      `client_id` (string ≥ 16) e `token_endpoint_auth_method === 'none'`;
    - com `https://claude.com/api/mcp/auth_callback` → 201;
    - com `https://evil.example/cb` → 400 e `error === 'invalid_redirect_uri'`;
    - com os dois do Claude mais um estranho → 400;
    - o 21º cliente → 400 e `error === 'invalid_client_metadata'`.

- [ ] **Step 2: Rodar e ver falhar**
  Run: `node --test tests/server-conector.test.cjs`
  Expected: FAIL (404 nas rotas).

- [ ] **Step 3: Implementar.**
  - Migração: o SQL do spec.
  - Harness: copiar o `setup`, o `idToken` e os ganchos `before`/`beforeEach` de `tests/server.test.cjs:1-49` (esse
    arquivo fica como está).
  - `oauth.js`: `register` grava `client_id = randomId(18)`, `name = text(client_name, 60)` e `redirect_uris` em JSON,
    com o limite `limit(env, 'oauthreg:'+ip, 60)`.
  - `app.js`: `GET /.well-known/oauth-protected-resource`, o mesmo com `/mcp`, `GET
    /.well-known/oauth-authorization-server` e `POST /oauth/register`.
  - Workflow: o `run` vira `node --test tests/server.test.cjs tests/server-conector.test.cjs`, e os `paths` passam a
    incluir `tests/server-conector.test.cjs` e `tests/helpers/**`.

- [ ] **Step 4: Rodar e ver passar**
  Run: `node --test tests/server.test.cjs tests/server-conector.test.cjs`
  Expected: PASS (os testes antigos também).

- [ ] **Step 5: Commit** — `Conector: tabelas, descoberta OAuth e registro dinâmico`

### Task 2: Consentimento pelo painel, código, tokens e revogação

**Files:**
- Create: `server/src/connect-page.js`
- Modify: `server/src/oauth.js`, `server/src/app.js`
- Test: `tests/server-conector.test.cjs`

**Interfaces:**
- Consumes: `adminSession(request, env)` do app, que devolve `{ email, role, can }` ou `null`.
- Produces:
  - `oauth.authorizePage(url, env)` → a página HTML (200) ou a página de erro de parâmetro (400);
  - `oauth.who(request, env, url)` → `{ email: 'cr…@exemplo.com', role, client: 'Claude' }` ou 401;
  - `oauth.approve(request, env, url)` → `{ location }`;
  - `oauth.token(request, env)`;
  - `oauth.revoke(request, env)`;
  - `oauth.bearer(request, env)` → `{ grantId, email, role, can }`. Lança 401 com `WWW-Authenticate` se não houver
    token, se ele for inválido ou vencido, ou se o papel tiver sumido. Conta a chamada no limite de 2.000 por dia.
  - `oauth.revokeGrant(env, grantId)`, usado pelo painel na Task 6.

- [ ] **Step 1: Escrever os testes que falham:**
  - `consentimento: página sem dado; "quem" exige o cookie do painel`:
    - `GET /painel/conectar?…params válidos` sem cookie → 200, HTML com `<script src="/painel/conectar.js">` e sem
      e-mail;
    - `client_id` desconhecido → 400;
    - `redirect_uri` diferente do registrado → 400;
    - `code_challenge_method=plain` → 400;
    - `GET /painel/api/conectar/quem?…` sem cookie → 401;
    - com o cookie do dono → 200 com `role === 'dono'`, `client === 'Claude'` e o `email` mascarado (não é igual a
      `ADMIN`).
  - `fluxo completo com PKCE`:
    - `POST /painel/api/conectar` com o cookie, `x-nexo-painel: 1`, `{ ...params, decisao: 'autorizar' }` →
      `location` começa com o `redirect_uri` e traz `code` e o mesmo `state`;
    - sem `x-nexo-painel` → 403;
    - `decisao: 'recusar'` → `location` com `error=access_denied`;
    - `POST /oauth/token` (form) com `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`,
      `client_id` e `resource` → 200 com `access_token` (`/^nexo_at_/`), `refresh_token` (`/^nexo_rt_/`),
      `expires_in === 3600` e `token_type === 'Bearer'`;
    - o mesmo código de novo → 400 `invalid_grant`;
    - outro `code_verifier` → `invalid_grant`;
    - o código depois de 61 s (`tick`) → `invalid_grant`;
    - o código pedido com `redirect_uri` diferente → `invalid_grant`.
  - `renovação: troca e detecção de reuso`:
    - refresh → par novo;
    - o refresh antigo de novo → `invalid_grant`, e depois disso o access token novo também cai (`bearer` → 401);
    - refresh com outro `client_id` → `invalid_grant`.
  - `form-urlencoded`: um `code_verifier` de 64 caracteres com `~._-`, mandado como `URLSearchParams`, passa.
  - `revogar`: `POST /oauth/revoke` (form `token=`) → 200, e o token para de valer.

- [ ] **Step 2: Rodar e ver falhar**
  Run: `node --test tests/server-conector.test.cjs`
  Expected: FAIL.

- [ ] **Step 3: Implementar.**
  - Rotas novas:
    - `GET /painel/conectar` e `GET /painel/conectar.js`;
    - `GET /painel/conectar.css`, com `cache-control: public, max-age=3600`;
    - `GET /painel/api/conectar/quem` e `POST /painel/api/conectar`. Essas duas ficam **fora** do `adminApi`, porque
      precisam dos parâmetros do OAuth, mas usam `adminSession` e a mesma regra de CSRF.
    - `POST /oauth/token` e `POST /oauth/revoke`.
  - O corpo do token é lido como `URLSearchParams` quando o `content-type` tem `x-www-form-urlencoded`; senão,
    `readJson`.
  - PKCE: `b64url(sha256(verifier)) === challenge`, com `sameBytes`. O verifier precisa casar com
    `/^[A-Za-z0-9._~-]{43,128}$/`.
  - Máscara do e-mail: as 2 primeiras letras + `…@` + o domínio.
  - Visual: o desenho do spec, seção "Visual da página de autorização".
    - Fundo `/painel/fundo.svg` e cartão de vidro com a borda em gradiente `#5ad7ff → #9b7bff`.
    - A estrela ✦ e o anel ligados por uma linha pontilhada animada (`stroke-dashoffset`), parada com
      `prefers-reduced-motion`.
    - Os botões Recusar e Autorizar. O botão Autorizar é o primário, em gradiente.
    - O estado "abra o painel" traz o passo a passo e o botão "Já abri, tentar de novo", que só refaz o `fetch`.
  - CSP da página: a mesma `PANEL_CSP` do app.

- [ ] **Step 4: Rodar e ver passar**
  Run: `node --test tests/server.test.cjs tests/server-conector.test.cjs`
  Expected: PASS.

- [ ] **Step 5: Ver a página de verdade.** Servir o Worker local com o harness, abrir `/painel/conectar` no navegador
  nos dois estados e tirar um print. Conferir o visual contra o spec antes de commitar.

- [ ] **Step 6: Commit** — `Conector: consentimento pelo painel, tokens com PKCE e revogação`

### Task 3: Endpoint `/mcp` (protocolo)

**Files:**
- Create: `server/src/mcp.js`
- Modify: `server/src/app.js`
- Test: `tests/server-conector.test.cjs`

**Interfaces:**
- Consumes: `oauth.bearer`.
- Produces:
  - `createMcp({ tools, serverVersion, instructions })` → `{ handle(request, who) }` → `Response`.
  - `tools` é uma lista de `{ name, title, description, inputSchema, outputSchema?, annotations, needs?, run(args, ctx) }`,
    em que `ctx = { env, who, now }` e `needs` é a permissão exigida, por exemplo `'status'`.
  - `run` devolve um objeto (vira `structuredContent` mais o texto JSON) ou lança `ToolError(message)`, que vira
    `isError`.

- [ ] **Step 1: Escrever os testes que falham** (com uma ferramenta de teste `eco` injetada via
  `createApp({ extraTools })`, que só existe nos testes):
  - `GET /mcp` → 405;
  - `POST /mcp` sem token → 401 com `www-authenticate` contendo
    `resource_metadata="https://nexo-api.exemplo.workers.dev/.well-known/oauth-protected-resource"`;
  - access token vencido (`tick(3601e3)`) → 401 com o mesmo cabeçalho;
  - `initialize` com `protocolVersion: '2025-06-18'` → `result.protocolVersion === '2025-06-18'`,
    `result.capabilities.tools` presente e `result.serverInfo.name === 'nexo'`;
  - `initialize` com `'1999-01-01'` → `'2025-11-25'`;
  - `notifications/initialized` → 202 sem corpo;
  - `ping` → `result` igual a `{}`;
  - `tools/list` → contém `eco`, com `inputSchema.type === 'object'`;
  - `tools/call` com `eco` → `result.content[0].type === 'text'` e `structuredContent` igual ao objeto;
  - ferramenta que lança `ToolError` → `result.isError === true`;
  - ferramenta desconhecida → `isError`;
  - array (lote) → `error.code === -32600`;
  - método desconhecido → `-32601`;
  - JSON quebrado → `-32700`;
  - `Origin: https://evil.example` → 403;
  - `Origin: https://claude.ai` → 200;
  - ferramenta com `needs: 'status'` chamada por um grant de papel `leitura` → `isError`, com a mensagem de papel.
  - Limite: a 2.001ª chamada no dia → `isError` "Limite de hoje".

- [ ] **Step 2: Rodar e ver falhar.** Expected: FAIL.

- [ ] **Step 3: Implementar `mcp.js`.** Respostas `application/json` com os cabeçalhos de segurança. `instructions` é um
  parágrafo:

  > Você está conectado ao servidor do Nexo Device Care, app grátis de manutenção de PCs gamer do Samuel. As
  > ferramentas leem métricas, usuários, telemetria anônima e erros agrupados, e marcam erros. E-mails nunca vêm. Ao
  > marcar um erro como corrigido, informe a versão em que a correção sai.

- [ ] **Step 4: Rodar e ver passar.** Expected: PASS.

- [ ] **Step 5: Commit** — `Conector: endpoint MCP sem estado`

### Task 4: Ferramentas de leitura

**Files:**
- Create: `server/src/tools.js`
- Modify: `server/src/app.js` (expor `panel = { summary, errorList, errorDetail, telemetryRows }` para o `createTools`,
  reaproveitando o SQL de `adminSummary`, `adminErrorList`, `adminErrorDetail` e `adminTelemetry` sem `Response` no
  meio)
- Test: `tests/server-conector.test.cjs`

**Interfaces:**
- Produces:
  - `createTools(panel, { aggregateTelemetry, crossTab })` → a lista de ferramentas.
  - Os nomes e os argumentos são os da tabela do spec: `nexo_resumo`, `nexo_usuarios`, `nexo_erros`, `nexo_erro`,
    `nexo_telemetria`.
  - `panel.errorDetail(env, signature)` devolve `{ group, reports }`, em que cada relatório tem `temContato` booleano e
    nenhum campo `email`.
  - `panel.errorList(env, { status, avisos, limite })` devolve os grupos com `pcs_com_contato` no lugar de `emails`.

- [ ] **Step 1: Escrever os testes que falham:**
  - `ferramentas de leitura com dados de exemplo`: semeia 2 telemetrias, 3 erros e 1 erro com
    `includeEmail: true` de uma sessão com e-mail `fulano@exemplo.com`. Depois:
    - `nexo_resumo` → `openErrors === 3` e `newUsers.days7 >= 1`;
    - `nexo_erros` → 3 grupos, cada um com `pcs_com_contato` numérico;
    - `nexo_erro` com a assinatura → `group.stack` e `reports[0].temContato === true`;
    - `nexo_telemetria` → `installs === 2` e `activeByDay` não vazio;
    - `nexo_usuarios` com `dias: '30'` (string) → funciona.
  - `nenhuma ferramenta devolve e-mail`: todas as chamadas acima (e `nexo_historico`, na Task 6) passam pela regex
    `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/` sem casar no texto de resposta.
  - `banco vazio`: cada ferramenta de leitura num `setup()` novo → sem `isError`, com listas vazias e zeros.
  - `argumentos errados`:
    - `nexo_erro` com `assinatura: 123` → `isError` "Assinatura inválida";
    - `nexo_erros` com `limite: -5` → até 1 grupo, sem erro;
    - `nexo_telemetria` com `dias: 999` → limitado a 120.
  - `nexo_telemetria` sem `partes`: as listas vêm cortadas em 15. Com `partes: ['gpus']`, vem só `gpus`, mais
    `installs` e `reports`.

- [ ] **Step 2: Rodar e ver falhar.** Expected: FAIL.

- [ ] **Step 3: Implementar.** Descrições das ferramentas em português, claras para o Claude escolher, com
  `readOnlyHint: true`. O resultado do `nexo_telemetria` passa por um corte que garante `JSON.stringify` ≤ 60.000
  caracteres (reduz o top N até caber).

- [ ] **Step 4: Rodar e ver passar.** Expected: PASS, também os testes antigos do painel (a refatoração não pode mudar
  as respostas do `/painel/api`).

- [ ] **Step 5: Commit** — `Conector: ferramentas de leitura (resumo, usuários, erros, telemetria)`

### Task 5: `nexo_cruzar`

**Files:**
- Create: `server/src/cruzar.js`
- Modify: `server/src/tools.js`
- Test: `tests/server-conector.test.cjs` (função pura e ferramenta)

**Interfaces:**
- Produces:
  - `CAMPOS`: um objeto `nome → { titulo, ler(row) → string|null }`, com as dimensões do spec. `ram_faixa` e
    `idade_instalacao` usam as mesmas faixas de `app.js` (exportar `RAM_BANDS` e `AGE_BANDS` de lá ou movê-las para
    `cruzar.js` e importar no app). `flag:<nome>` vale para `SYSTEM_FLAGS` e `SKY_FLAGS`.
  - `MEDIDAS`: `nome → { titulo, ler(data) }`, a partir dos `DAY_METRICS`, com nomes em snake_case (por exemplo
    `minutos_foco`, `cpu_foco`, `fps_ceu`, `travadas`).
  - `crossTab(rows, { linha, coluna, medida, filtro })` → um destes:
    - `{ linha, coluna, total, celulas: [{ l, c, n }], outros }`;
    - com medida: `{ linha, medida, grupos: [{ l, mediana, p90, n }] }`.

    Contagem de PCs: o resumo mais recente de cada `install_id`. Medida: todos os resumos do período. No máximo 50
    linhas e 20 colunas; o resto vai em `outros`.

- [ ] **Step 1: Escrever os testes que falham:**
  - `crossTab` com 4 linhas falsas (2 AMD Leve, 1 AMD Completo, 1 NVIDIA Leve) e `linha: 'gpu_marca'`,
    `coluna: 'efeitos'` → as células `AMD/lite = 2`, `AMD/full = 1` e `NVIDIA/lite = 1`;
  - com `filtro: { sistema: 'win32' }` → filtra;
  - com `medida: 'fps_ceu'` → mediana certa;
  - campo desconhecido → lança "Campo desconhecido: x. Campos: …";
  - a ferramenta `nexo_cruzar` com `dias: 90` → limitada a 60;
  - a descrição da ferramenta lista todos os nomes de `CAMPOS` e `MEDIDAS`.

- [ ] **Step 2: Rodar e ver falhar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS.
- [ ] **Step 5: Commit** — `Conector: cruzamentos livres da telemetria por catálogo fechado`

### Task 6: `nexo_marcar_erro`, `nexo_historico` e o painel (conexões, ações, revogar e limpeza)

**Files:**
- Modify: `server/src/tools.js`, `server/src/app.js`, `server/src/panel.js`
- Test: `tests/server-conector.test.cjs`

**Interfaces:**
- Consumes: `oauth.revokeGrant(env, grantId)`.
- Produces:
  - API do painel (só `need('chaves')`, isto é, o dono):
    - `GET claude` → `{ conexoes: [{ id, cliente, autorizadoPor, criadoEm, ultimoUso, chamadasHoje, revogada }],
      acoes: [...] }`;
    - `POST claude/revogar` `{ id }`.

- [ ] **Step 1: Escrever os testes que falham:**
  - `marcar erro pelo Claude`:
    - `nexo_marcar_erro` `{ assinatura, status: 'corrigido', versao: '0.11.4', nota: 'cache do sensor' }` →
      `depois.status === 'corrigido'`, e o grupo no banco fica com `fixed_in = '0.11.4'`;
    - sem `versao` com `corrigido` → `isError`;
    - uma linha em `claude_actions` com `tool = 'nexo_marcar_erro'`;
    - `nexo_historico` mostra a linha;
    - um grant de "leitura" → `isError`.
  - `painel vê e revoga`:
    - `GET /painel/api/claude` com o cookie do dono → 1 conexão e 1 ação;
    - um "colaborador" → 403;
    - `POST claude/revogar` → o próximo `/mcp` com aquele token → 401.
  - `papel conferido a cada pedido`: um colaborador autoriza, o dono tira ele da equipe e o próximo `tools/call` → 401.
  - `limpeza`: o `scheduled()` com códigos e tokens vencidos, um grant revogado há 31 dias e um cliente órfão de 8
    dias → tudo some; o que ainda vale fica.

- [ ] **Step 2: Rodar e ver falhar.** Expected: FAIL.

- [ ] **Step 3: Implementar.**
  - Cartões no `panel.js`, aba Equipe e acessos: o mesmo estilo de `.card` e das tabelas, com um chip
    "ativa"/"revogada" e o botão "Revogar" (`ghost` com o texto de perigo).
  - Cada ação vira uma frase, por exemplo "Marcou como corrigido na 0.11.4: <mensagem> · 17/11 19:40".
  - A limpeza entra no `env.DB.batch` do `scheduled`.

- [ ] **Step 4: Rodar e ver passar.** Expected: PASS.

- [ ] **Step 5: Ver o painel de verdade.** Print da aba Equipe e acessos com os cartões, conferido contra o visual do
  painel.

- [ ] **Step 6: Commit** — `Conector: marcar erros, histórico do Claude e conexões no painel`

### Task 7: Documentação, PR, deploy e teste real

**Files:**
- Modify: `PRIVACIDADE.md`, `PRIVACY.md`, `docs/SERVIDOR.md`

- [ ] **Step 1: Documentação.**
  - Parágrafo do spec ("Privacidade") nas seções do servidor da PRIVACIDADE.md (PT) e da PRIVACY.md (EN).
  - `docs/SERVIDOR.md`:
    - linha nova na tabela de rotas (`/mcp`, `/oauth/*`, `/painel/conectar`, para "Claude, pelo conector");
    - seção "Conectar o Claude" com o passo a passo do spec;
    - a linha do plano grátis com o limite de 2.000 chamadas.

- [ ] **Step 2: Todos os testes e o lint**
  Run: `node --test tests/server.test.cjs tests/server-conector.test.cjs && npm run lint --if-present`
  Expected: PASS, sem erro de lint.

- [ ] **Step 3: Revisão final do branch** por um revisor novo, no modelo mais capaz. O foco são a segurança do OAuth e
  o vazamento de e-mail.

- [ ] **Step 4: PR** `servidor-conector` → `main`, com o corpo no padrão (o que mudou, como testar, segurança). O Samuel
  aprova o merge.

- [ ] **Step 5: Depois do deploy:**
  - `curl` em `/.well-known/oauth-authorization-server` e no `/mcp` (401 com o cabeçalho);
  - o Samuel adiciona o conector no claude.ai;
  - o Claude chama todas as ferramentas numa conversa e confere os números contra o painel.
