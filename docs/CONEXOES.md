# Conexões de jogos — como ativar

| Conexão | Precisa configurar na build? | O que a pessoa faz |
|---|---|---|
| **Steam deste PC** | Não | Ajustes → Contas e conexões → escolher a conta. O Nexo lê só arquivos locais da Steam (conta, foto, tempo de jogo). |
| **Steam Web API** (jogos não instalados) | Não | A própria pessoa cria a chave em steamcommunity.com/dev/apikey e cola no Nexo. O perfil precisa ter “Detalhes do jogo” público. |
| **Xbox / Microsoft** | **Sim** (ID do app no Azure) | “Entrar com a conta Microsoft” no navegador. |
| **Discord** (Rich Presence) | Não (app oficial embutido) | Liga as chaves em Ajustes; o Discord precisa estar aberto no PC. |
| **Capas oficiais** | Não | “Buscar capas oficiais” na biblioteca (ou em Ajustes). |

## Discord: app oficial

O app **Nexo Device Care** já existe no Discord Developer Portal (Application ID `1568049794834898954`, embutido em `electron/discord.cjs`).
- Ícone e capa de convite: `assets/discord/nexo-1024.png` e `assets/discord/nexo-cover-1024x576.png`.
- Arte do Rich Presence: chave **`nexo`** (a imagem grande do status).
- O status mostra um botão “Conhecer o Nexo” que abre a última release.
- Para testar com outro app, `NEXO_DISCORD_APP_ID` ou `discordAppId` em `integrations.json` têm prioridade.

## Xbox: app no Azure (Microsoft Entra)

1. portal.azure.com → **Microsoft Entra ID → Registros de aplicativo → Novo registro**.
2. Tipos de conta: **Somente contas Microsoft pessoais** (ou “qualquer diretório + pessoais”).
3. URI de redirecionamento: plataforma **Cliente público/nativo (móvel e desktop)**, valor `http://localhost`.
4. Em **Autenticação**, deixe “Permitir fluxos de cliente público” = **Sim**.
5. Copie o **ID do aplicativo (cliente)** para `config/integrations.json` (`{"xboxClientId":"…"}`) ou para o segredo `NEXO_INTEGRATIONS_JSON`.

O escopo usado é `XboxLive.signin`. O fluxo (Microsoft → token de usuário Xbox Live → XSTS → perfil e histórico de títulos) é o mesmo usado por launchers conhecidos, mas **não foi validado com um app real** nesta versão: teste antes de publicar.

## Um arquivo para tudo

```json
{ "discordAppId": "123456789012345678", "xboxClientId": "00000000-0000-0000-0000-000000000000" }
```

Em um PC de testes dá para importar esse arquivo em **Ajustes → Contas e conexões → Importar configuração (desenvolvedor)**.
