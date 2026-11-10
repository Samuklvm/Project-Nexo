# Servidor do Nexo

Um Worker da Cloudflare (`server/`) com banco D1. Recebe os relatórios de erro do app (sempre enviados desde a 0.11.1, sem nada pessoal) e, se a pessoa ligar, a telemetria diária e a sincronização entre PCs; também serve o painel do criador:

| Parte | Rota | Quem chama |
|---|---|---|
| Sincronização entre PCs (login do Google) | `POST /v1/auth/google`, `GET/DELETE /v1/me`, `GET /v1/sync`, `PUT/GET/DELETE /v1/sync/:pc` | o app, com a sincronização ligada |
| Relatórios de erro | `POST /v1/errors`, `POST /v1/errors/forget-email` | o app (sempre); o segundo quando a pessoa desmarca o e-mail nos relatórios |
| Telemetria diária | `POST /v1/telemetry` | o app, com a telemetria ligada |
| Entrar com a Steam | `GET /v1/steam/start`, `/back`, `/me`, `/library`, `/achievements` | o app, quando a pessoa conecta a conta Steam |
| Painel do criador | `/painel` | navegador (link de uso único que o app abre) |
| Leitura para ferramentas | `GET /v1/tools/errors` | chave `nexo_…` criada no painel (só erros, sem e-mails) |

O que cada parte guarda, por quanto tempo e como apagar está em [PRIVACIDADE.md](../PRIVACIDADE.md#servidor-do-nexo).

## Plano gratuito

O plano grátis da Cloudflare dá 100 mil pedidos por dia, 10 ms de CPU por pedido e 5 GB no D1. O app faz poucos pedidos por PC: telemetria (se ligada): um resumo por dia, mais o parcial de hoje no máximo a cada 3 horas; erros só quando há erro novo (no máximo a cada 30 min) e uma cópia da sincronização a cada 30 min, se ligada.

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

4. Rode o fluxo **Publicar servidor** (*Actions → Publicar servidor → Run workflow*), ou mande algo de `server/` para a `main`. Ele roda os testes, cria o banco `nexo` se não existir, aplica as migrações, publica o Worker, cria os segredos `SESSION_SECRET` e `DATA_KEY` (só na primeira vez, sem aparecer no log) e confere `/health`. O endereço sai no fim do log: `https://nexo-api.<subdomínio>.workers.dev`.
5. Coloque esse endereço em `config/server.json` (`{ "url": "https://nexo-api.<subdomínio>.workers.dev" }`) e gere uma versão do app. Sem endereço, o app mostra que o servidor não está ligado e não manda nada.

> **Nunca apague nem troque o `DATA_KEY`** na Cloudflare: as cópias da sincronização são cifradas com chaves derivadas dele e ficariam ilegíveis. Trocar o `SESSION_SECRET` só desconecta todo mundo (cada um liga a sincronização de novo).

## Painel e equipe

No app, entre com o e-mail de dono e ligue a sincronização: aparece **Abrir o painel do criador** em Ajustes. O link vale uma vez, por 1 minuto, e o cookie do painel dura 8 horas.

- **Erros:** agrupados por assinatura, com quantos PCs, versões, sistemas e, para quem pediu aviso, os e-mails. Marque *corrigido em* uma versão: se o mesmo erro aparecer de novo nessa versão ou numa mais nova, ele reabre sozinho.
- **Telemetria:** só somas (PCs ativos, versões, sistemas, hardware, telas e recursos mais usados).
- **Equipe e acessos** (só o dono): adicione pessoas por e-mail Google com o papel **colaborador** (vê e-mails e muda o estado dos erros) ou **leitura** (vê erros e telemetria, sem e-mails). Tirar alguém corta o acesso no próximo pedido. Também é ali que se cria uma **chave de ferramenta** (`nexo_…`, mostrada uma vez só) para um assistente ou script ler os erros, sem e-mails.

## Relatórios num repositório privado (opcional)

Para acompanhar os erros como *issues* sem expor nada no repositório público:

1. Crie um repositório **privado** (por exemplo `nexo-relatorios`).
2. Copie `server/tools/relatorios.mjs` para `tools/relatorios.mjs` e `server/tools/relatorios.yml` para `.github/workflows/relatorios.yml` nesse repositório.
3. Nos segredos dele, coloque `NEXO_SERVER_URL` (o endereço do servidor) e `NEXO_TOOLS_KEY` (uma chave de ferramenta criada no painel).

O fluxo roda uma vez por dia (e quando você mandar, em *Actions*) e abre, atualiza ou fecha uma *issue* por erro (rótulo `erro-nexo`), sem e-mails.
