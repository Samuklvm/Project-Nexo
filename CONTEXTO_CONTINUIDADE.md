# Contexto de continuidade — Project Nexo

> Arquivo de referência preparado em 28/10/2026 para continuar o trabalho em outro chat. É uma síntese organizada do que foi decidido e feito, não uma transcrição literal nem uma memória automática. Ao retomar, confira o estado atual do repositório e do GitHub antes de agir.

## Como retomar em outro chat

Anexe este arquivo ao novo chat e diga algo como: “Leia este contexto e continue o trabalho no Project Nexo. Confira o estado atual do repositório antes de alterar qualquer coisa.”

O repositório local é `C:\Users\samue\OneDrive\Desktop\Project-Nexo` e o remoto é `https://github.com/Samuklvm/Project-Nexo`.

## Projeto e objetivo do criador

- O Project Nexo é um aplicativo desktop de otimização e cuidados do computador, feito para aprender e evoluir continuamente.
- O criador quer que seja gratuito, de código aberto, honesto e respeitoso com a privacidade.
- Ao conversar, usar português brasileiro e um tom próximo e claro. O usuário gosta de aprender visualmente, com demonstrações na tela quando pede isso.
- O usuário autoriza criatividade de design e funcionalidades quando diz que podemos decidir livremente, mas prefere testar uma versão antes de abrir novas frentes grandes.

## Decisões de privacidade e telemetria

- A telemetria local é parte das funções do aplicativo e deve permanecer ativa independentemente da opção de compartilhamento externo.
- Compartilhar telemetria com o criador é opcional, deve vir desativado e só pode começar depois de informar claramente os campos enviados, finalidade, destino, retenção e como retirar o consentimento.
- Na versão 0.1.5, marcar a opção apenas salva a escolha neste computador; o aplicativo não envia telemetria ao criador.
- A tela do instalador deve listar de forma explícita tudo o que o app coleta localmente e informar o tráfego de rede necessário para verificar atualizações públicas do GitHub.
- A preferência de compartilhamento é salva no Registro do Windows em `HKCU\Software\NexoDeviceCare\Privacy\DeveloperTelemetryOptIn`.

## Histórico do Git e releases

- `main` é a branch principal escolhida.
- O usuário decidiu arquivar a antiga `master` e manter `archive/master-legacy` no mesmo commit histórico, localmente e no GitHub; as referências antigas `master`/`origin/master` foram retiradas.
- A versão 0.1.4 foi publicada e o usuário testou o instalador, relatando que funcionou corretamente.
- A versão 0.1.5 foi preparada com melhorias do sistema de atualização do app, trabalho de telemetria local/gráficos e ajustes de interface feitos antes deste histórico.
- A primeira compilação da 0.1.5 falhou repetidamente por avisos/erros do NSIS. As correções finais foram publicadas em `main` e a automação terminou com sucesso.
- Release publicada: https://github.com/Samuklvm/Project-Nexo/releases/tag/v0.1.5
- A release contém `Nexo-Setup-0.1.5.exe` (109 MB), `latest.yml`, o arquivo `.blockmap` e os arquivos-fonte.
- Execução de sucesso do GitHub Actions: https://github.com/Samuklvm/Project-Nexo/actions/runs/40785866821
- Estado confirmado ao escrever esta nota: branch `main`; `HEAD` e tag `v0.1.5` apontavam para `e9cd4e0f816f17c5cf0bf84ea6d420e6e63ecf1d` (`Remove unavailable update check from privacy page`). A cópia de trabalho estava limpa.

## Ajustes técnicos do instalador que destravaram a 0.1.5

- A configuração do NSIS está em `package.json`; o script personalizado está em `installer/installer.nsh`.
- Os textos do instalador usam os códigos de idioma Windows `1046` (Português do Brasil) e `1033` (English).
- O campo longo de privacidade usa um controle de texto multilinha somente para leitura.
- A página de privacidade, suas variáveis e funções de consentimento ficam fora da compilação do desinstalador, que não possui essa tela.
- A página personalizada não deve redefinir `MUI_PAGE_CUSTOMFUNCTION_PRE` nem chamar `${isUpdated}`: isso causou falhas por macro duplicada e plugin indisponível. Na versão que compilou com sucesso, ela aparece também durante atualizações.
- O build bem-sucedido ainda exibiu um aviso de manutenção: `actions/checkout@v4` e `actions/setup-node@v4` foram forçados a rodar com Node.js 24 por causa da descontinuação do Node.js 20. Não impediu a release.
- O log também informou que o executável Electron estava usando o ícone padrão. Isso pode ser melhorado junto da repaginada do instalador/app, se o projeto já tiver um ícone adequado.

## Próximo trabalho pedido

### Repaginar a interface do instalador

O usuário testou o instalador da 0.1.5 e disse que a interface continua feia. Ele quer voltar a esse ponto e criar uma experiência bonita, moderna e sofisticada, com referência visual ao Opera GX.

Requisitos já informados:

- Usar como fundo/referência a imagem que o usuário anexou (`1338277.png`, originalmente em `C:\Users\samue\Downloads\1338277.png`), com personagem anime, flores azuis e céu estrelado.
- Permitir escolher onde instalar.
- Permitir mudar o idioma.
- Ter uma tela clara de privacidade, com a telemetria para terceiros desligada por padrão e a lista completa do que é coletado.
- Manter o fluxo funcional e coerente com o NSIS/electron-builder existente.
- O usuário deu liberdade criativa para incluir detalhes e funções úteis, sem esconder decisões importantes.

Antes de editar, conferir se a imagem original ainda está acessível e como os recursos visuais atuais são fornecidos ao NSIS (por exemplo, `installer/installer-sidebar.bmp`). Preparar uma prévia visual e iterar com o usuário se isso ajudar a validar a direção de design.

### Assinatura digital e confiança do Windows

- O usuário quer resolver os alertas de confiança do Windows por meio de assinatura digital e perguntou como obter um certificado.
- A obtenção de um certificado comercial confiável ainda precisa ser tratada; não assumir que a 0.1.5 foi assinada com um certificado Authenticode confiável só porque o log cita `signtool.exe`.
- Próximo passo é identificar a opção de certificado/fornecedor viável, custo e requisitos atuais, depois configurar o segredo/certificado com segurança no processo de publicação. Nunca pedir que o usuário cole senha/chave privada no chat.

## Preferências de colaboração

- Fazer progresso em tarefas já autorizadas e informar com clareza o que foi mudado e como foi verificado.
- Para mudanças de interface, priorizar resultado visual revisável; o usuário aprende melhor vendo o fluxo.
- Quando o usuário pedir ajuda para publicar, a release é no GitHub.
- Não afirmar que o app é assinado, que coleta dados específicos ou que uma release foi testada sem evidência.
- Evitar pedir novamente autorizações que o usuário já deu para as tarefas em curso. Confirmação é necessária para operações novas, externas ou irreversíveis sem autorização prévia.

## Nota sobre precisão

Este documento reúne as decisões e o estado de projeto relevantes desta conversa. Não contém cada mensagem, imagem em resolução original, credencial, log completo ou detalhe incidental. A conversa original deve continuar na história do Codex enquanto não for excluída; este arquivo serve como referência portátil para um novo chat.
