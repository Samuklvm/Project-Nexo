# Conector do Claude para o painel do Nexo (projeto 1 de 5)

Sessão do servidor, sincronização e acesso do Claude ao painel (17/11/2026).

## Por quê

O Samuel quer que o Claude tenha acesso **completo e nativo** ao painel do criador, para trabalhar junto com ele no
dia a dia:

- analisar as métricas e a telemetria e dizer onde o app pode melhorar;
- ver os erros, corrigir no código e marcar no painel como solucionados ou não;
- ver quantas pessoas baixam e usam o app e quantos usuários existem no total.

A tentativa anterior foi a chave `painel:ler` (branch `wip-painel-acesso`). Ela emperrou por dois motivos:

- a chave teria que ser colada de novo em cada conversa;
- o Claude não pode guardar segredo na memória.

O Samuel pediu uma forma mais direta e prática.

**A solução:** o servidor do Nexo vira um **conector remoto (MCP)** do claude.ai. O Samuel adiciona o conector uma vez,
em Configurações → Conectores, e o Claude passa a ter ferramentas próprias do Nexo em qualquer conversa e em qualquer
aparelho. Não existe chave colada no chat: quem guarda a autorização é o claude.ai, e ela é revogável no painel.

## Objetivos

- Ferramentas do Nexo no Claude: resumo, usuários, erros (lista e detalhe), marcar erro, telemetria agregada e
  cruzamentos livres da telemetria.
- Login pelo próprio painel. Com o painel aberto no navegador, a pessoa clica em "Autorizar" e pronto.
- Toda ação do Claude que muda algo fica registrada e aparece no painel, em "O que o Claude fez".
- As conexões do Claude aparecem no painel, cada uma com um botão para revogar.
- O visual da autorização e dos cartões novos segue o painel: céu, vidro, aurora e neon. A interface tem que ser
  sofisticada.

## Fora deste projeto

Vem nos próximos projetos:

- contagem exata de usuários, funil e saúde por versão (projeto 2), que acrescentam ferramentas ao conector;
- vigias de erro (projeto 3);
- interruptores remotos (projeto 4).

## O que não pode acontecer (mesmo funcionando)

- Alguém de fora conseguir um token, ou ler qualquer dado pelo `/mcp`.
- O Claude ver dado pessoal. **E-mails, equipe e chaves nunca passam pelo conector.**
- Quebrar o app publicado (0.11.3) ou o painel atual.
- Sair do plano grátis da Cloudflare.

## Restrições

- **Sem dependências novas.** O servidor de hoje é JavaScript puro, com Web Crypto e D1, e continua assim.
- **Plano grátis do Workers:** 100 mil pedidos por dia, 10 ms de CPU por pedido (I/O não conta) e D1 com limites
  diários de leitura e gravação.
- **Testes:** em `tests/server.test.cjs`, com o D1 simulado em SQLite (`server/test/d1-sqlite.cjs`).
- **Deploy:** sai sozinho pelo `.github/workflows/server.yml` quando `server/` muda na `main`.
- **Estilo do código:** comentários e mensagens em português e cabeçalhos de segurança iguais aos de hoje (CSP,
  `nosniff`, sem frames). Nada do conteúdo dos pedidos vai para o log.
- **Fluxo de trabalho:** branch `servidor-conector` → pull request para a `main` → o Samuel aprova o merge.
- **Sem CHANGELOG nem notas de versão:** isso é da sessão de releases.

## Abordagens consideradas

| | Como | Troca | Decisão |
|---|---|---|---|
| **A** | MCP e OAuth escritos à mão dentro do Worker atual, guardados no D1, com o login pelo cookie do painel | Mais código nosso, mas zero dependência, um banco só, grátis e no estilo do servidor | **Escolhida** (o Samuel aprovou) |
| B | Kit da Cloudflare (`agents` + `workers-oauth-provider`) | Menos código, mas puxa KV, Durable Objects e dependências pesadas | Descartada: pesada demais para o Nexo |
| C | Chave colada no chat (`painel:ler`) | Simples | Descartada: é exatamente o que emperrou |

O branch `wip-painel-acesso` fica parado. Ele **não** entra na `main` e só é apagado se o Samuel pedir.

## Como funciona

### Passo a passo de conectar (o que o Samuel vê)

1. No claude.ai: **Configurações → Conectores → Adicionar conector personalizado**.
   - Nome: `Nexo`.
   - URL: `https://nexo-api.nexo-device-care.workers.dev/mcp`.
   - Configurações avançadas: deixar **em branco** (o Claude se registra sozinho).
2. Abre uma janela do navegador com a página **"Conectar o Claude ao painel do Nexo"**.
   - Se o painel estiver aberto nesse navegador, a página mostra o que o Claude poderá e o que **não** poderá fazer,
     com os botões **Autorizar** e **Recusar**.
   - Se o painel não estiver aberto: a página explica como abrir (no Nexo, Ajustes → Abrir o painel do criador,
     **no mesmo navegador**) e tem um botão "Já abri, tentar de novo".
3. Autorizou: a janela volta para o claude.ai e o conector fica ligado.

### Descoberta e OAuth (OAuth 2.1 com PKCE e registro dinâmico)

O Claude segue as especificações de autorização do MCP: 2025-03-26, 2025-06-18 e 2025-11-25.

| Rota | O que faz |
|---|---|
| `GET /.well-known/oauth-protected-resource` (também com o sufixo `/mcp`) | `{ resource: "<origem>/mcp", authorization_servers: ["<origem>"], scopes_supported: ["painel"] }` |
| `GET /.well-known/oauth-authorization-server` | `issuer`, `authorization_endpoint` (`/painel/conectar`), `token_endpoint` (`/oauth/token`), `registration_endpoint` (`/oauth/register`), `revocation_endpoint` (`/oauth/revoke`), `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `scopes_supported: ["painel"]` |
| `POST /oauth/register` (RFC 7591) | Aceita só `redirect_uris` exatamente iguais a `https://claude.ai/api/mcp/auth_callback` e/ou `https://claude.com/api/mcp/auth_callback`; outro endereço = 400. Cliente público (`none`), no máximo 20 clientes, limite por IP. Clientes sem nenhuma autorização somem em 7 dias. |
| `GET /painel/conectar` | Página de autorização. Fica embaixo de `/painel` para o cookie `nexo_painel` (Path=/painel) valer. Confere `response_type=code`, um `client_id` registrado, um `redirect_uri` igual ao registrado, `code_challenge_method=S256` e o `resource` (se vier) igual a `<origem>/mcp`. |
| `POST /painel/api/conectar` | Autorizar ou recusar. Exige a sessão do painel e o cabeçalho `x-nexo-painel: 1` (a mesma proteção contra CSRF de hoje). Devolve `{ location }` e o script da página faz o redirecionamento. |
| `POST /oauth/token` | `authorization_code` (código + `code_verifier`) ou `refresh_token`. Devolve `access_token` (1 h), `refresh_token` (30 dias, trocado a cada uso), `token_type: "Bearer"`, `expires_in` e `scope`. |
| `POST /oauth/revoke` | Revoga o token informado e a autorização inteira dele. |

**O cookie do painel com `SameSite=Strict` (achado na revisão).** A janela de login sai do claude.ai, que é outro site.
Por isso o navegador **não** manda o cookie `nexo_painel` na primeira abertura de `/painel/conectar`. O cookie
**continua Strict**. A solução:

1. O HTML da página é servido sem exigir sessão e não leva dado nenhum, só os parâmetros do pedido, conferidos.
2. O script da página pergunta `GET /painel/api/conectar/quem`. Esse pedido sai do próprio site, então o cookie vai
   junto.
3. A resposta é `{ email mascarado, papel, cliente }` ou 401, e a página desenha o consentimento ou a tela "abra o
   painel".
4. O botão Autorizar faz `POST /painel/api/conectar` com os parâmetros. O servidor confere tudo de novo, cria o código
   e devolve `{ location }`.

**Formato do OAuth:**

- `/oauth/token` e `/oauth/revoke` aceitam `application/x-www-form-urlencoded`, que é o padrão do OAuth, e também JSON.
- Os erros seguem o formato do OAuth: `{ "error": "invalid_grant" | "invalid_request" | "invalid_client" |
  "unsupported_grant_type", "error_description": "…" }`, com 400 (401 para cliente inválido).
- `/oauth/register` recebe e devolve JSON (`client_id`, `client_id_issued_at`, `redirect_uris`, `client_name`,
  `token_endpoint_auth_method: "none"`, `grant_types`, `response_types`).
- A página mostra o `client_name` registrado, por exemplo "Claude", limpo e cortado em 60 caracteres.

**Regras de segurança:**

- **Código de autorização:** 32 bytes aleatórios, guardado só o hash. Vale 60 s, uma vez só, preso ao cliente, ao
  `redirect_uri`, ao `code_challenge` e à pessoa que autorizou.
- **Tokens:** aleatórios (não são JWT) e guardados só como hash SHA-256. Formato `nexo_at_…` e `nexo_rt_…`, para o
  redator dos logs também reconhecer.
- **Reuso de refresh token já trocado:** revoga a autorização inteira. É a detecção de roubo.
- **A cada pedido ao `/mcp`, o papel da pessoa é conferido de novo** com `roleOf(email)`. Tirar alguém da equipe, ou
  tirar o e-mail de `ADMIN_EMAILS`, corta o Claude dela na hora.
- **Quem pode autorizar:** qualquer papel do painel. O Claude herda o papel de quem autorizou: um "leitura" conectado
  só lê, e marcar erro exige a permissão `status`. Os e-mails ficam de fora mesmo para o dono.
- **Página de autorização:** CSP própria (`form-action 'none'`, só scripts do próprio servidor), `frame-ancestors
  'none'` e `x-frame-options: DENY`, contra clickjacking.
- **Limites:** 2.000 chamadas de ferramenta por dia para cada autorização e 60 pedidos de token por dia para cada IP.

### O endpoint `/mcp` (Streamable HTTP sem estado)

- `POST /mcp` com JSON-RPC 2.0. Responde sempre `application/json`: sem SSE e sem sessão.
- `GET /mcp` devolve 405 (não há canal do servidor para o cliente).
- Sem token ou com token inválido: 401 com `WWW-Authenticate: Bearer resource_metadata="<origem>/.well-known/oauth-protected-resource"`.
- Cabeçalho `Origin` presente e diferente de `https://claude.ai` ou `https://claude.com`: 403, contra DNS rebinding.
  O Claude chama a partir da nuvem da Anthropic e normalmente nem manda `Origin`.
- Métodos:
  - `initialize`: escolhe a versão mais nova que os dois lados suportam (`2025-11-25`, `2025-06-18` ou `2025-03-26`)
    e responde com `capabilities: { tools: {} }`, `serverInfo: { name: "nexo", version }` e `instructions` (um
    parágrafo em português que explica o Nexo e as ferramentas);
  - `notifications/initialized`: 202 sem corpo;
  - `ping`;
  - `tools/list`;
  - `tools/call`.

  Qualquer outro método recebe `-32601`. Lote (array) recebe erro `-32600`.
- Erro da ferramenta (erro não encontrado, permissão, argumento): resultado com `isError: true` e a mensagem em
  português, não um erro JSON-RPC, para o Claude conseguir ler e se corrigir.

### Ferramentas

Todas reaproveitam as funções do painel que já existem em `server/src/app.js`. Cada uma devolve:

- `content: [{ type: "text", text: <JSON compacto> }]`;
- `structuredContent` com o mesmo objeto;
- `outputSchema` declarado, quando fizer sentido.

As ferramentas de leitura levam as anotações `readOnlyHint: true` e `openWorldHint: false`.

| Ferramenta | Argumentos | O que devolve | Base |
|---|---|---|---|
| `nexo_resumo` | – | Erros abertos, instalações ativas (7 e 30 dias), contas, versões em uso, usuários novos (hoje, 7 e 30 dias) e a hora de agora | `adminSummary` sem `admin` nem `permissions` |
| `nexo_usuarios` | `dias` (1 a 120, padrão 30) | Instalações novas por dia (versões e sistemas), últimas instalações vistas, ativos por dia e contas novas | `adminSummary.newUsers` + `activeByDay` da telemetria |
| `nexo_erros` | `status?` (aberto, reaberto, corrigido, ignorado), `incluir_avisos?`, `limite?` (padrão 50, até 300) | Grupos de erro com PCs, ocorrências, versões, sistemas, status, `fixed_in` e nota. Em vez de e-mails, só a contagem `pcs_com_contato` | `adminErrorList` |
| `nexo_erro` | `assinatura` (16 hex) | O grupo inteiro (pilha, contexto) e os relatórios por PC (versão, sistema, contagem, datas). **Sem e-mails:** nem `emails`, nem `emailInfo`, só `temContato` | `adminErrorDetail` com papel de leitura |
| `nexo_marcar_erro` | `assinatura`, `status`, `versao?` (obrigatória para `corrigido`), `nota?` (até 500) | O antes e o depois. Anotações: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true` | `adminErrorStatus` (exige `status`) |
| `nexo_telemetria` | `dias` (1 a 120, padrão 30), `partes?` (lista de nomes; sem ela, vai o essencial: `installs`, `reports`, `activeByDay`, `numbers`, `versions`, `platforms` e o top 15 de cada lista) | O agregado de hoje, recortado para caber (no máximo cerca de 60 KB) | `aggregateTelemetry` |
| `nexo_cruzar` | `linha`, `coluna?`, `medida?`, `dias` (1 a 60), `filtro?` (`{ campo: valor }`) | Tabela cruzada de PCs (o resumo mais recente de cada instalação no período) entre dois campos, ou a mediana e o p90 de uma `medida` por `linha`. Para responder "quem tem AMD usa mais o Modo Leve?" | nova, em JS sobre as linhas já lidas |
| `nexo_historico` | `limite?` (padrão 30) | O que o Claude mudou: quando, ferramenta, erro, antes e depois e qual conexão | tabela nova `claude_actions` |

**O `nexo_cruzar` não aceita SQL.** Ele usa um catálogo fechado de campos (`CAMPOS`), cada um com nome, descrição e
como ler o valor de um resumo. O catálogo também vai na descrição da ferramenta, para o Claude saber o que pode cruzar:

- **Dimensões:**
  - sistema: `versao`, `sistema`, `idioma`, `canal`;
  - hardware: `cpu_marca`, `cpu_modelo`, `gpu_marca`, `ram_faixa`, `threads`, `monitores`, `resolucao`, `hz`, `escala`;
  - ajustes: `efeitos`, `cor`, `perfil`, `ritmo_leituras`, `densidade_ceu`, `sensores`;
  - uso: `idade_instalacao`, `limitador`, `limitador_sessoes`;
  - recursos (`flag:<nome>`): bandeja, início com o Windows, vagalumes etc.
- **Medidas:** os `DAY_METRICS` que já existem, como minutos em foco, CPU e memória do Nexo, FPS do céu e travadas.

Os cruzamentos têm limite de tempo. Até 60 dias e no máximo 50 linhas × 20 colunas; o resto vira "outros". Assim o
pedido cabe nos 10 ms de CPU.

### Banco (migração `0004_conector.sql`)

```sql
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY, name TEXT, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL,
  email TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
-- Uma autorização (grant) = uma conexão do Claude. Os tokens apontam para ela; revogar a autorização corta todos.
CREATE TABLE IF NOT EXISTS oauth_grants (
  grant_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, email TEXT NOT NULL, scope TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used INTEGER, calls INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL,      -- acesso | renovacao
  expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0                  -- renovacao já trocada = 1
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);
CREATE TABLE IF NOT EXISTS claude_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, grant_id TEXT NOT NULL, tool TEXT NOT NULL,
  target TEXT, before TEXT, after TEXT
);
```

A limpeza do cron diário passa a apagar também:

- códigos vencidos;
- tokens vencidos;
- autorizações revogadas há mais de 30 dias;
- clientes sem autorização com mais de 7 dias;
- ações com mais de 180 dias.

### Painel

Aba **Equipe e acessos**, só para o dono:

- cartão **"Conexões do Claude"**: quando foi autorizada, por quem, último uso, chamadas de hoje e o botão
  **Revogar**;
- cartão **"O que o Claude fez"**: as últimas 30 ações, por exemplo "marcou como corrigido na 0.11.4 · Falha ao ler
  sensores · 17/11 19:40".

Rotas novas da API do painel: `GET claude`, `POST claude/revogar`.

### Visual da página de autorização

O fundo é o mesmo `fundo.svg` do painel. Por cima, um cartão de vidro centralizado com uma borda em gradiente da
aurora (`#5ad7ff → #9b7bff`) e um brilho suave. No topo, o anel de órbita do Nexo e uma estrela de quatro pontas (sem
logotipo da Anthropic), ligados por uma linha pontilhada animada, de constelação. A animação some com
`prefers-reduced-motion`. A tipografia e as cores vêm das variáveis do painel.

```
            ✦ · · · · ◯
     Conectar o Claude ao painel do Nexo
   Autorizando como criador@… · papel: Dono

   ✓ Ver métricas, usuários e telemetria
   ✓ Ver erros (pilha, versões, sistemas)
   ✓ Marcar erros como corrigidos ou abertos
   ✕ E-mails dos usuários   ✕ Equipe   ✕ Chaves

   Tudo que o Claude mudar aparece em
   "O que o Claude fez". Revogue quando quiser.

        [ Recusar ]     [ ✦ Autorizar ]
```

A página de "abra o painel primeiro" usa o mesmo cartão, com o passo a passo e o botão "Já abri, tentar de novo".

### Privacidade

Os dados que o Claude lê são todos agregados ou anônimos: telemetria, erros sem e-mail e contagens. Ainda assim, eles
passam a ser processados por um serviço de terceiros (a Anthropic). Por honestidade, entra **um parágrafo** em
`PRIVACIDADE.md` e em `PRIVACY.md`, PT e EN como o Samuel exige:

> o criador usa um assistente de IA (Claude, da Anthropic) para analisar a telemetria e os relatórios de erro; ele
> nunca recebe e-mails nem dados de conta.

`docs/SERVIDOR.md` ganha uma seção **"Conectar o Claude"**, com o passo a passo acima.

## Testes (antes de publicar)

Em `tests/server.test.cjs`:

1. **Descoberta:** os dois documentos `.well-known` e o 401 do `/mcp` com `WWW-Authenticate`.
2. **Registro:** aceita os dois callbacks do Claude, recusa qualquer outro e respeita o limite de clientes.
3. **Autorização sem sessão do painel:** `GET /painel/conectar` responde 200 com a página (sem dado nenhum), e
   `/painel/api/conectar/quem` sem cookie responde 401. A página serve com o cookie Strict, porque o pedido de
   "quem" sai do próprio site.
4. **Autorização com o dono:** consentimento → código → token. Também devem falhar: o `code_verifier` errado, o código
   usado duas vezes, o código vencido e o `redirect_uri` diferente do registrado.
5. **Renovação:** troca o token. Reusar o refresh antigo revoga tudo.
6. **Papel conferido a cada pedido:** tirar a pessoa da equipe → 401 no próximo `tools/call`.
7. **`tools/list`, e cada ferramenta com dados de exemplo.**
8. **Nenhuma resposta do `/mcp` contém um e-mail.** Varredura com a expressão de e-mail sobre todas as saídas, com
   e-mails semeados nos relatórios.
9. **`nexo_marcar_erro`:** registra em `claude_actions`; um "leitura" recebe `isError`.
10. **`Origin` estranho** → 403. **Lote** → `-32600`. **Método desconhecido** → `-32601`.
11. **Revogar no painel:** o token para na hora.

Depois do deploy, o teste real: o Samuel conecta e o Claude chama cada ferramenta numa conversa.

## Decisões tomadas pelo Claude (o Samuel pode corrigir)

- Tokens opacos no D1, e não JWT, para revogar na hora.
- Access token de 1 h e refresh de 30 dias, trocado a cada uso.
- Qualquer papel do painel pode conectar, e o Claude herda o papel. E-mails nunca, nem para o dono.
- `nexo_cruzar` com catálogo fechado em vez de SQL livre (segurança e CPU).
- O parágrafo de privacidade sobre o uso do Claude.
- Pull request para a `main`, e o Samuel aprova o merge.

## Riscos

- **O navegador do login do conector pode não ser o mesmo onde o painel está aberto.** Por exemplo, o app desktop do
  Claude abrindo o navegador padrão. A mitigação é a página explicar e ter "tentar de novo". Se mesmo assim der
  problema no teste real, o plano B é um **código de pareamento**: a página mostra `ABCD-1234` e o Samuel digita esse
  código no Nexo, em Painel do criador → Autorizar conector. Esse plano B só chega com a próxima versão do app.
- **A CPU do Worker com 120 dias de telemetria.** O painel de hoje já faz isso. Se passar de 10 ms, o
  `nexo_telemetria` limita os dias a 60.

---

## Roteiro dos próximos projetos (decisões já tomadas, desenho detalhado na hora de cada um)

2. **Contagem exata de usuários.**
   - **Sinal de vida diário**, **ligado por padrão** e desligável em Ajustes (decisão do Samuel): código aleatório do
     PC, versão e sistema, uma vez por dia.
   - Quando a pessoa desliga, sai um único "+1 desligou", sem código.
   - O instalador avisa "instalação concluída" e o desinstalador avisa "desinstalado".
   - **Usuário real** = abriu o app em pelo menos 2 dias diferentes. Quem abriu um dia só = "experimentou".
   - Funil (instalou → abriu → usuário real → ativo em 7 e 30 dias), retenção e saúde de cada versão (% de PCs sem
     erro, alarme de regressão).
   - O número do GitHub aparece só como referência, marcado como impreciso: o Samuel não confia nele, porque conta até
     revisão.
   - O servidor guarda um resumo por dia (cron) e ganha ferramentas novas no conector.
   - A PRIVACIDADE.md é atualizada (PT/EN).
3. **Vigias de erro.**
   - O app passa a avisar cada errinho e cada coisa "funcionando estranho", num nível novo, `estranho`, separado de
     `erro`, agrupado igual e com o mesmo interruptor dos relatórios.
   - Exemplos: tela vazia, leitura de sensor absurda, canal lento, interface congelada, céu abaixo de 20 fps, etapa
     da análise que não termina.
   - Os avisos também passam a ir para o servidor.
4. **Interruptor remoto, alerta no Discord e Claude de plantão.**
   - Recursos desligáveis pelo painel ou pelo conector, sem lançar versão nova.
   - Webhook do Discord quando um erro dispara de repente ou volta.
   - Tarefa agendada semanal: o Claude lê o painel, resume a semana, corrige o erro que mais pega num branch e avisa.
5. **Sincronização automática.** O PC manda as mudanças sozinho e o outro junta ao abrir, sem botão, com regra de
   junção por parte.
