# Instalador visual do Nexo

Este launcher mostra a tela de boas-vindas e as opções de instalação. Ele inclui o instalador NSIS do Nexo e o executa em modo silencioso após a pessoa escolher o destino, as opções, ler os Avisos e aceitar continuar.

## Gerar localmente

Na raiz do projeto, execute `npm run dist`. O processo gera `release/Nexo-Setup-X.exe` e `installer-launcher/dist/Nexo-Instalador-X.exe`. O primeiro continua sendo usado pelo atualizador interno do Nexo; o segundo é o instalador visual para uma instalação nova.

O launcher e o aplicativo devem ter a mesma versão em seus `package.json`. O script `scripts/prepare.cjs` verifica isso e inclui o instalador principal e `installer/AVISOS.txt` no pacote visual.

O progresso é estimado porque o NSIS não expõe o progresso de uma execução silenciosa. A opção de compartilhar dados fica desativada por padrão e, nesta versão, só grava a preferência localmente.
