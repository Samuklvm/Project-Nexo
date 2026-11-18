# Servidor do Nexo

Um Worker da Cloudflare (`server/`) com banco D1. Recebe os relatórios de erro do app (ligados por padrão e opcionais, sem nada pessoal) e, se a pessoa ligar, a telemetria diária e a sincronização entre PCs; também serve o painel do criador:

| Parte | Rota | Quem chama |
|---|---|---|
| Sincronização entre PCs (login do Google) | `POST /v1/auth/google`, `GET/DELETE /v1/me`, `GET /v1/sync`, `PUT/GET/DELETE /v1/sync/:pc` | o app, com a sincronização ligada |
| Relatórios de erro | `POST /v1/errors`, `POST /v1/errors/forget-email` | o app (sempre); o segundo quando a pessoa desmarca o e-mail nos relatórios |
| Telemetria diária | `POST /v1/telemetry` | o app, com a telemetria ligada |
| Entrar com a Steam | `GET /v1/steam/start`, `/back`, `/me`, `/library`, `/achievements` | o app, quando a pessoa conecta a conta Steam |
| Painel do criador | `/painel` | navegador (link de uso único que o app abre) |
| Leitura para ferramentas | `GET /v1/tools/errors` | chave `nexo_…` criada no painel (só erros, sem e-mails) |
| Conector do Claude (MCP) | `POST /mcp`, `/oauth/register`, `/oauth/token`, `/oauth/revoke`, `/.well-known/oauth-*`, `/painel/conectar` | o Claude, depois que alguém do painel autoriza |

O que cada parte guarda, por quanto tempo e como apagar está em [PRIVACIDADE.md](../PRIVACIDADE.md#servidor-do-nexo).

## Plano gratuito

O plano grátis da Cloudflare dá 100 mil pedidos por dia, 10 ms de CPU por pedido e 5 GB no D1. O conector do Claude tem limite próprio: 2.000 chamadas de ferramenta por dia para cada conexão. O app faz poucos pedidos por PC: telemetria (se ligada): um resumo por dia, mais o parcial de hoje no máximo a cada 3 horas; erros só quando há erro novo (no máximo a cada 30 min) e uma cópia da sincronização a cada 30 min, se ligada.

## Testar sem a Cloudflare

```bash
node --test tests/server.test.cjs tests/cloud.test.cjs
```

Os testes rodam o Worker de verdade no Node, com o D1 simulado em SQLite (`server/test/d1-sqlite.cjs`) e um "Google" com chave RSA de teste.

## Publicar (primeira vez)

1. **Conta na Cloudflare** (grátis), criada pela própria pessoa dona do projeto, com verificação em duas etapas. Em **Workers e Pages**, escolha o subdomínio `*.workers.dev` (ele entra no endereço do servidor).
2. **Token da API** em *My Profile → API Tokens → Create Token → Custom token*, com as permissões da conta:
   - `Workers Scripts: Edit`
   - `D1: Edit`
   - `Account Settings: Read`
3. **Segredos do repositório** (*Settings → Secrets and variables → Actions*):

   | Segredo | Valor |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | o token do passo 2 |
   | `CLOUDFLARE_ACCOUNT_ID` | o ID da conta (aparece na lateral do painel da Cloudflare) |
   | `NEXO_ADMIN_EMAILS` | o e-mail Google de quem entra no painel como dono (vírgula separa vários) |

   O ID do cliente Google (público) vem de `config/google-client.json`, o mesmo que as builds usam.

4. Rode o fluxo **Publicar servidor** (*Actions → Publicar servidor → Run workflow*), ou mande algo de `server/` para a `main`. Ele roda os testes, cria o banco `nexo` se não existir, aplica as migrações, publica o Worker, cria os segredos `SESSION_SECRET`, `DATA_KEY` e `PC_PEPPER` (só na primeira vez, sem aparecer no log) e confere `/health`. O endereço sai no fim do log: `https://nexo-api.<subdomínio>.workers.dev`.
5. Coloque esse endereço em `config/server.json` (`{ "url": "https://nexo-api.<subdomínio>.workers.dev" }`) e gere uma versão do app. Sem endereço, o app mostra que o servidor não está ligado e não manda nada.

> **Nunca apague nem troque o `DATA_KEY`** na Cloudflare: as cópias da sincronização são cifradas com chaves derivadas dele e ficariam ilegíveis. **Nunca troque o `PC_PEPPER`** também: a contagem de PCs guarda o código de cada PC embaralhado com ele, e trocar zera a continuidade (todo PC vira novo). Sem ele, as rotas da contagem respondem 503 e não guardam nada. Trocar o `SESSION_SECRET` só desconecta todo mundo (cada um liga a sincronização de novo).

## Vigias de erro

Desde a 0.11.4, os relatórios de erro levam também os **avisos** (coisas funcionando de um jeito estranho, sem chegar a erro). Cada aviso traz o nome do vigia que o mandou em `context.vigia` (por exemplo `leitura-impossivel`, `sensores-sumiram`, `fonte-falhando`, `abertura-lenta`, `ceu-lento`, `memoria-alta`, `contagem-recusada`, `tela-travada`, `acao-lenta`).

- No painel, aba **Erros**, o cartão **Vigias** mostra os avisos dos últimos 7 dias por tipo (PCs, ocorrências, abertos e versões). Clicar num vigia filtra a lista por ele.
- No conector, `nexo_vigias` dá a mesma tabela, e `nexo_resumo` traz `avisosAbertos`.
- Os avisos **não** entram no alarme de regressão, no "% sem erro" das versões nem em "PCs com erro".

## Contagem de usuários

O app e os instaladores contam **PCs**, não downloads (o número do GitHub soma toda baixada do instalador, inclusive as atualizações automáticas e quem baixa duas vezes, então aparece só como referência, marcado como impreciso). Rotas anônimas, sem login:

| Rota | Corpo | Para quê | Limite por dia |
|---|---|---|---|
| `POST /v1/pulse` | `{ pc, version, platform }` | "Este PC abriu hoje" (UTC). Repetir no mesmo dia não muda nada | 10 por PC, 1.000 por IP |
| `POST /v1/install` | `{ pc, event, version, platform }`, com `event` = `instalou`, `atualizou` ou `desinstalou` | Avisos do instalador (`installer/count.ps1`, escondido, prazo de 4 s) | 10 por PC, 300 por IP |
| `POST /v1/optout` | `{ origem: 'app' \| 'instalador' }` | O "+1 desligou", **sem código nenhum** | 5 por IP |

- `pc` é `SHA-256("nexo-pc-v1|" + id do sistema)` em 64 hex (MachineGuid no Windows, machine-id no Linux). O servidor guarda só `HMAC(PC_PEPPER, pc)` cortado em 32 hex.
- O cron diário tira uma foto dos números em `daily_stats` e soma os downloads do GitHub (`.exe`, `.AppImage`, `.deb`) em `gh_downloads`. Para não esbarrar no limite da API do GitHub sem login, crie o segredo **opcional** `NEXO_GITHUB_TOKEN` no repositório (um token *fine-grained* só de leitura de conteúdo público basta): o fluxo **Publicar servidor** o copia para o Worker como `GITHUB_TOKEN`.
- No painel: aba **Usuários** (funil, retenção, novos por dia) e aba **Versões** (PCs por versão, ≈ % sem erro e o alarme de regressão). No conector: `nexo_usuarios` e `nexo_versoes`.
- Retenção: dias de uso e avisos 400 dias; o PC some depois de 400 dias sem aparecer.

## Painel e equipe

No app, entre com o e-mail de dono e ligue a sincronização: aparece **Abrir o painel do criador** em Ajustes. O link vale uma vez, por 1 minuto, e o cookie do painel dura 8 horas.

- **Erros:** agrupados por assinatura, com quantos PCs, versões, sistemas e, para quem pediu aviso, os e-mails. Marque *corrigido em* uma versão: se o mesmo erro aparecer de novo nessa versão ou numa mais nova, ele reabre sozinho.
- **Telemetria:** só somas (PCs ativos, versões, sistemas, hardware, telas e recursos mais usados).
- **Equipe e acessos** (só o dono): adicione pessoas por e-mail Google com o papel **colaborador** (vê e-mails e muda o estado dos erros) ou **leitura** (vê erros e telemetria, sem e-mails). Tirar alguém corta o acesso no próximo pedido. Também é ali que se cria uma **chave de ferramenta** (`nexo_…`, mostrada uma vez só) para um assistente ou script ler os erros, sem e-mails.

## Conectar o Claude

O servidor também é um **conector remoto (MCP)** do Claude: com ele, o Claude lê métricas, usuários, telemetria e erros do painel e marca erros, sem nunca ver e-mails, equipe ou chaves.

1. No Claude: **Configurações → Conectores → Adicionar conector personalizado**.
   - Nome: `Nexo`.
   - URL: `https://nexo-api.<subdomínio>.workers.dev/mcp` (o endereço aparece em **Equipe e acessos**, no cartão "Conexões do Claude", com botão de copiar).
   - Configurações avançadas: **em branco**. O Claude se registra sozinho, e o servidor só aceita os endereços de volta do próprio Claude.
2. Abre a página **Conectar o Claude ao painel do Nexo**. Com o painel aberto **no mesmo navegador**, ela mostra o que o Claude pode e não pode fazer. Clique em **Autorizar**.
3. Pronto: em qualquer conversa o Claude tem as ferramentas `nexo_resumo`, `nexo_usuarios`, `nexo_erros`, `nexo_erro`, `nexo_marcar_erro`, `nexo_telemetria`, `nexo_cruzar`, `nexo_historico`, `nexo_versoes` e `nexo_vigias`.

O Claude herda o papel de quem autorizou: com **leitura**, ele só lê. Tirar a pessoa da equipe corta o Claude dela no próximo pedido. Em **Equipe e acessos**, o dono vê as conexões (com **Revogar**) e o cartão **O que o Claude fez**, com cada mudança. O acesso vale 1 hora e é renovado sozinho por até 30 dias; reusar um token de renovação já trocado revoga a conexão inteira.

## Relatórios num repositório privado (opcional)

Para acompanhar os erros como *issues* sem expor nada no repositório público:

1. Crie um repositório **privado** (por exemplo `nexo-relatorios`).
2. Copie `server/tools/relatorios.mjs` para `tools/relatorios.mjs` e `server/tools/relatorios.yml` para `.github/workflows/relatorios.yml` nesse repositório.
3. Nos segredos dele, coloque `NEXO_SERVER_URL` (o endereço do servidor) e `NEXO_TOOLS_KEY` (uma chave de ferramenta criada no painel).

O fluxo roda uma vez por dia (e quando você mandar, em *Actions*) e abre, atualiza ou fecha uma *issue* por erro (rótulo `erro-nexo`), sem e-mails.
