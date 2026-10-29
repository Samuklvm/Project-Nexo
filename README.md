# Nexo Device Care

Aplicativo desktop para Windows que reúne indicadores do computador e ferramentas básicas de manutenção. O projeto está em desenvolvimento; as recomendações de diagnóstico são heurísticas e não prometem aumentar o desempenho em todos os PCs.

## Recursos atuais

- Painel com uso de CPU, memória, disco e GPU, além de temperaturas reportadas por sensores disponíveis.
- Explorador local com sensores detalhados para CPU, GPU NVIDIA/AMD/Intel, placa-mãe, memória, armazenamento, rede, bateria, fonte e controladores compatíveis; permite pesquisar, filtrar, incluir sensores avançados e exportar CSV.
- Gráficos locais de desempenho atualizados a cada cinco segundos, com períodos de 5 minutos a 7 dias. O histórico mantém CPU, RAM, disco principal, GPU e temperaturas disponíveis; as curvas incluem temperaturas de CPU, GPU e ACPI conforme expostas pelo computador.
- Diagnóstico sob demanda que compara CPU, RAM e disco com o padrão local e identifica processos que mais consomem CPU ou memória. A página inicial também oferece uma leitura de processos sob demanda.
- Prévia e remoção de arquivos temporários antigos do usuário.
- Limpeza automática opcional quando o disco principal permanece com uso elevado.
- Abertura do Gerenciador de Tarefas, otimização de unidade pela ferramenta do Windows e verificação de arquivos protegidos do sistema.
- Histórico local de desempenho e feedback das recomendações, usados para contextualizar os diagnósticos.

## Executar em desenvolvimento

Requisitos: Windows, Node.js 20 ou superior e .NET SDK 10 para compilar o coletor de sensores.

Na pasta do projeto, instale as dependências e inicie o aplicativo:

```powershell
npm install
npm run build:sensors
npm start
```

## Gerar o instalador localmente

```powershell
npm run dist
```

O instalador visual do Windows permite escolher Português ou English, a pasta de destino, a criação de atalho e a abertura do app após a instalação. Ele mostra os avisos do produto antes de exigir o aceite e detalha todos os dados locais e as conexões de rede. O compartilhamento com o criador começa desativado e, nesta versão, a opção apenas guarda a preferência localmente. A tela de instalação exibe a arte e o novo ícone do Nexo.

`npm run dist` gera o instalador NSIS em `release/` e o launcher visual em `installer-launcher/dist/`. O NSIS continua sendo o instalador usado pelo atualizador interno do app. A coleta local de métricas usada pelos recursos do app está ativa. Consulte [PRIVACIDADE.md](PRIVACIDADE.md) para o inventário detalhado.

## Publicar uma versão

1. Altere o campo `version` em `package.json` e envie o commit para o GitHub. A Action compila o coletor local em .NET 10 e empacota o instalador Electron.
2. Crie uma tag `v` seguida exatamente da mesma versão. Para a versão `0.1.8`:

   ```powershell
   git tag v0.1.8
   git push origin v0.1.8
   ```

3. A GitHub Action compila o app, publica `Nexo-Setup` para atualizações automáticas e anexa `Nexo-Instalador` à release como instalador visual de primeira instalação. Acompanhe a execução na aba **Actions**; após o sucesso, os dois arquivos ficam na página **Releases**.

O aplicativo instalado verifica atualizações ao iniciar e mostra a versão disponível na aba **Atualizações**. A tela mostra as novidades, o progresso, a velocidade e o tamanho do download, com opção para tentar novamente. O download só começa quando a pessoa seleciona **Baixar atualização**; depois, ela escolhe quando instalar e reiniciar o app. O atualizador funciona apenas na versão empacotada. Para que outras pessoas baixem atualizações sem autenticação, o repositório e as releases devem ser públicos.

### Assinatura digital do instalador

A compilação de release já aceita um certificado Authenticode sem guardar o certificado no repositório. Para ativar a assinatura, adicione estes dois segredos em **Settings → Secrets and variables → Actions** no GitHub:

- `WIN_CSC_LINK`: caminho/URL privada ou conteúdo Base64 do certificado `.pfx`/`.p12`.
- `WIN_CSC_KEY_PASSWORD`: senha desse certificado.

Sem esses segredos, a release continua sendo criada, mas sem assinatura. Nunca coloque o arquivo do certificado ou a senha no Git. Uma assinatura válida identifica o publicador e protege contra alterações, mas o SmartScreen ainda pode avisar sobre uma versão nova enquanto a reputação se forma.

## Limites e privacidade

- As leituras de hardware são feitas localmente pela LibreHardwareMonitorLib, além das consultas de sistema já existentes. A disponibilidade depende do componente, firmware e suporte da biblioteca. Algumas leituras avançadas exigem driver ou privilégios que o Nexo não instala nem solicita silenciosamente; sem eles, o sensor pode ficar indisponível. A NVIDIA também pode fornecer campos extras pelo `nvidia-smi` quando instalado.
- Os gráficos ao vivo atualizam a cada cinco segundos e mantêm a sessão recente em memória. O seletor mostra 5 minutos, 30 minutos, 24 horas ou até 7 dias de histórico local, com CPU, RAM, disco principal, GPU e temperaturas disponíveis. As curvas são resumidas para manter os picos visíveis em períodos longos. Nada disso é enviado a servidores.
- O diagnóstico usa sinais observáveis e regras heurísticas; indica possibilidades, não comprova causas. Ele não encerra processos.
- O histórico usado pelo diagnóstico e pelos gráficos guarda até sete dias de amostras locais em intervalos de um minuto. O feedback também fica neste computador; esses dados não são enviados para servidores.
- A limpeza exibe uma prévia e remove somente arquivos regulares diretamente na pasta temporária do usuário, com mais de sete dias. Há um limite de 5.000 arquivos por execução; subpastas e links são ignorados.
- A limpeza automática é opcional e só é executada após ativação explícita. Ela exige quatro leituras e pelo menos 60 segundos com o disco principal acima de 90%, respeitando um intervalo mínimo de uma hora entre execuções.
- A otimização de unidades usa a ferramenta nativa do Windows. A verificação de arquivos protegidos executa `sfc /scannow`. Essas operações pedem confirmação e podem solicitar elevação de permissão pelo Windows.
- No navegador, as operações que dependem do computador ficam indisponíveis; use o aplicativo desktop.
