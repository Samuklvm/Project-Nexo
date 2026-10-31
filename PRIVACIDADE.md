# Privacidade do Nexo Device Care

## Resumo

O Nexo é gratuito e de código aberto. A coleta e o processamento locais são ativos para alimentar os recursos do app e ficam no computador. O compartilhamento de telemetria com o criador é opcional e começa desativado. Nesta versão, não existe envio de telemetria, anúncios ou relatórios de falha; a opção do instalador apenas guarda a preferência localmente. Qualquer futura coleta externa deverá apresentar previamente os campos exatos, finalidade, destino, retenção e forma de revogar o consentimento.

## Coleta local (ativa)

A coleta local é parte do funcionamento do Nexo e não depende do consentimento para compartilhamento externo. Os dados abaixo permanecem no computador.

## Dados processados neste computador

- **Painel:** nome do computador, tipo/versão do Windows, versão do app, tempo ligado, percentual de CPU, memória RAM total/livre/usada, indicador local de conectividade (sim/não) e espaço total/livre/usado das unidades fixas, incluindo letra, rótulo e sistema de arquivos. Endereços de rede são examinados apenas localmente para calcular o indicador e não são guardados nem enviados pelo Nexo.
- **Sensores:** leituras disponibilizadas localmente pela biblioteca aberta LibreHardwareMonitorLib 0.9.6: CPU, GPU AMD/NVIDIA/Intel, memória, placa-mãe, armazenamento, rede, bateria, fonte, medidores de energia e controladores compatíveis. Conforme o hardware, podem incluir temperatura, tensão, corrente, potência, clock, frequência, carga, ventoinha, fluxo, nível, dados, transferência, duração, latência, energia, ruído, condutividade e umidade, além de mínimo e máximo da sessão. O coletor não lê os campos de identificador de hardware/sensor, número de série ou MAC; os nomes dos componentes e sensores são os nomes fornecidos pela biblioteca, que podem incluir modelo. Componentes sem suporte ou acesso mostram leitura indisponível.
- **Diagnóstico:** PID, nome e uso de CPU/memória dos programas que mais consomem são obtidos localmente para compor sugestões. O app não encerra esses processos. Quando há uma lentidão sustentada, **apenas o nome** do programa que liderava o consumo é guardado no aprendizado local (nunca o caminho, a linha de comando ou o conteúdo).
- **Limpeza e otimização:** caminhos, tamanhos e quantidade de arquivos regulares antigos (pasta temporária do usuário, relatórios de falha, relatórios de erro do Windows) e o tamanho da Lixeira são lidos localmente para a prévia. A limpeza só remove itens após ação explícita ou configuração explícita de limpeza automática (que considera apenas temporários). O plano de energia ativo e a lista de programas de inicialização do Windows (nome e comando) são lidos só para exibição e não são guardados.
- **Histórico local:** amostras locais de CPU, RAM, disco principal, utilização de GPU compatível e temperaturas ACPI/CPU/GPU em intervalos de um minuto, por até sete dias.
- **Aprendizado local:** médias e variações de CPU, RAM, disco, GPU e temperatura para cada uma das 168 horas da semana; episódios de lentidão detectados (tipo, horário, duração e pico; até 120, por até 30 dias); e até 60 nomes de programas recorrentes com a contagem de episódios. É um cálculo estatístico simples feito no computador. Pode ser exportado ou apagado em **Ajustes → Privacidade e dados**.
- **Sensores detalhados:** valores atuais e mínimos/máximos da sessão ficam em memória para a tela de sensores e não são gravados automaticamente no histórico de sete dias. Se a pessoa escolher **Exportar CSV**, o Nexo cria um arquivo local com nome/categoria do componente, nome e tipo do sensor, valor atual, unidade, mínimo, máximo e indicador de sensor avançado.
- **Feedback local:** categoria da recomendação, resposta útil/não útil e horário, limitado aos últimos 100 registros.
- **Atividade local:** título, detalhe e horário das últimas 20 atividades exibidas pelo app.
- **Preferências locais:** papel de parede escolhido (até 12 MB, guardado como arquivo na pasta de dados do app), modo de efeitos visuais, configuração da limpeza automática e horário da última execução.
- **Compartilhamento opcional:** a preferência para enviar telemetria ao criador, hoje inativa, é guardada no Registro do Windows em `HKCU\Software\NexoDeviceCare\Privacy\DeveloperTelemetryOptIn`. Não é enviada ao desenvolvedor.

Os itens acima ficam no computador da pessoa. O gráfico da sessão mantém amostras em memória por até cinco minutos. Nomes e detalhes locais de atividades podem incluir o resultado de ações iniciadas pela pessoa, como a quantidade de arquivos removidos e o espaço liberado.

## Exportar, apagar e desinstalar

- **Exportar:** em **Ajustes** é possível salvar um arquivo JSON com o histórico, o aprendizado, o feedback e a atividade.
- **Apagar o aprendizado:** o botão correspondente apaga o histórico, o aprendizado e o feedback.
- **Desinstalar:** a desinstalação pelo Windows ou por **Ajustes** remove o programa, os dados e preferências, os caches, os atalhos e as entradas do Registro do Nexo. Atualizações preservam os dados.

## Conexões de rede

Ao iniciar, a versão empacotada consulta as releases públicas do GitHub para verificar se existe uma atualização. Como qualquer conexão HTTP, o GitHub pode receber metadados técnicos da solicitação, incluindo endereço IP, horário, URL consultada e identificação do cliente. O Nexo não anexa a essa consulta inventário do computador, nomes de processos, arquivos, histórico, papel de parede ou feedback. Nenhuma atualização é baixada até a pessoa escolher **Baixar e atualizar**.

## Compartilhamento opcional com o criador

Nesta versão não existe serviço ou código que envie telemetria ao criador. A opção do instalador fica desativada por padrão e registra a preferência em `HKCU\Software\NexoDeviceCare\Privacy\DeveloperTelemetryOptIn`; neste momento, marcá-la não ativa transmissão alguma. Se uma versão futura implementar compartilhamento, deverá mostrar o inventário completo dos campos, finalidade, destino, retenção e forma de revogar a escolha, mantendo o envio desativado até consentimento explícito e informado.

## Contato e código

- Projeto: <https://github.com/Samuklvm/Project-Nexo>
- Problemas e sugestões: <https://github.com/Samuklvm/Project-Nexo/issues>
- Criador: <https://github.com/Samuklvm>
