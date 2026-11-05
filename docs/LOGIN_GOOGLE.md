# Login com Google — como ativar

O código do login está pronto (`electron/account.cjs`), mas o Google exige que **o dono do app** registre um cliente OAuth. Sem isso, o botão aparece como "não configurado". Leva uns 10 minutos.

## 1. Criar o cliente no Google Cloud

1. Abra o Google Cloud Console e crie um projeto (ex.: `nexo-device-care`).
2. **APIs e serviços → Tela de consentimento OAuth** (em versões novas: **Google Auth Platform → Branding/Público**):
   - Tipo de usuário: **Externo**.
   - Nome do app: `Nexo Device Care`; e-mail de suporte; logotipo opcional (o ícone do Nexo).
   - Escopos: só `openid`, `.../auth/userinfo.email` e `.../auth/userinfo.profile`. São escopos **não sensíveis**: não exigem a verificação demorada do Google.
   - Enquanto o app estiver em **Teste**, só os e-mails cadastrados em **Usuários de teste** conseguem entrar. Para liberar para todo mundo, clique em **Publicar app**.
3. **Credenciais → Criar credenciais → ID do cliente OAuth → Tipo: App para computador**. Baixe o JSON.

## 2. Colocar no Nexo

Escolha **uma** das formas:

- **Na build (recomendado para releases):** crie o segredo `GOOGLE_OAUTH_JSON` no repositório do GitHub (Settings → Secrets and variables → Actions) com o conteúdo do JSON. O workflow de release grava `config/google-oauth.json` antes de empacotar.
- **Localmente:** salve o arquivo como `config/google-oauth.json` (já está no `.gitignore`) e rode `npm start` ou gere o instalador.
- **Num PC já instalado (testes):** em **Ajustes → Conta → Importar credenciais (desenvolvedor)**, escolha o JSON.
- **Variáveis de ambiente (desenvolvimento):** `NEXO_GOOGLE_CLIENT_ID` e `NEXO_GOOGLE_CLIENT_SECRET`.

> Para apps de computador, o Google entrega um "client secret" que **não é tratado como segredo** (qualquer app instalado pode ser inspecionado). A segurança vem do PKCE e do retorno em `127.0.0.1`. Mesmo assim, não versione o arquivo no Git.

## 3. Como o login funciona (resumo técnico)

- Abre o navegador padrão em `accounts.google.com` com PKCE (S256), `state` aleatório e `prompt=select_account`.
- Recebe o código num servidor de loopback `http://127.0.0.1:<porta aleatória>` que só existe durante o login (5 minutos no máximo).
- Troca o código por tokens em `oauth2.googleapis.com/token`, confere `iss`, `aud` e `exp` do `id_token`, lê nome, e-mail e foto e **revoga** o token de acesso. Nenhum token é guardado.
- Guarda o perfil em `account/profile.bin`, cifrado com o `safeStorage` do Electron (DPAPI do Windows).

## O que a conta faz hoje

Mostra quem está usando o Nexo (nome e foto) — é a base para recursos futuros que precisem de identidade, como sincronizar sessões entre PCs. **Sincronização ainda não existe**: ela exigiria um servidor e uma nova revisão de privacidade antes de qualquer envio.
