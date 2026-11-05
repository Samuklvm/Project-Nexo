# Conexões de jogos — como ativar

| Conexão | Precisa configurar na build? | O que a pessoa faz |
|---|---|---|
| **Steam deste PC** | Não | Ajustes → Contas e conexões → escolher a conta. O Nexo lê só arquivos locais da Steam (conta, foto, tempo de jogo). |
| **Steam Web API** (jogos não instalados) | Não | A própria pessoa cria a chave em steamcommunity.com/dev/apikey e cola no Nexo. O perfil precisa ter “Detalhes do jogo” público. |
| **Xbox / Microsoft** | **Sim** (ID do app no Azure) | “Entrar com a conta Microsoft” no navegador. |
| **Discord** (Rich Presence) | **Sim** (Application ID) | Liga as chaves em Ajustes; o Discord precisa estar aberto no PC. |
| **Capas oficiais** | Não | “Buscar capas oficiais” na biblioteca (ou em Ajustes). |

## Discord: Application ID

1. Discord Developer Portal → **New Application** → nome “Nexo Device Care”.
2. Copie o **Application ID** (General Information).
3. Em **Rich Presence → Art Assets**, envie o ícone do Nexo com o nome **`nexo`** (é a imagem grande do status).
4. Coloque o ID em `config/integrations.json` (`{"discordAppId":"…"}`) ou no segredo `NEXO_INTEGRATIONS_JSON` do GitHub.

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
