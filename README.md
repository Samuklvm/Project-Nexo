Nexo Device Care
Aplicativo desktop para Windows que cuida do computador: mede, explica o que está pesando, aprende a rotina de uso e oferece ações reais de manutenção, sempre com prévia e confirmação. É gratuito, de código aberto e processa tudo localmente. As recomendações são heurísticas e não prometem aumentar o desempenho em todos os PCs.

O que ele faz
Início: Índice Nexo (0 a 100) explicado fator por fator, medições ao vivo com miniaturas, mapa do sistema em órbitas (cada componente é um planeta), gráficos de 5 minutos a 7 dias com dica ao passar o mouse, e as principais observações do momento.
Análise inteligente: compara o presente com a sua rotina e mostra a causa provável com a evidência. Inclui lentidões detectadas, programas que mais atrapalham, previsão de quando o disco enche, indício de queda de clock por calor, mapa da rotina por dia e hora e leitura sob demanda dos processos.
Otimizar: limpeza segura por categorias (temporários antigos, relatórios de falha, relatórios de erro do Windows e, opcionalmente, Lixeira), limpeza automática opcional, troca do plano de energia do Windows e lista dos programas que iniciam com o Windows. Cada operação tem uma ficha (risco, reversão, fonte oficial, como medimos e estado de validação). O plano de energia pode ser medido antes e depois com um benchmark de CPU de cerca de 20 segundos e revertido depois.
Atividade: Diário de alterações com valor anterior, risco, autorização, medição e botão Reverter (avisa se o estado mudou desde então).
Hardware: explorador de sensores locais (CPU, GPU, placa-mãe, memória, armazenamento, rede, bateria e mais), com busca, filtros e exportação em CSV.
Manutenção: otimização de unidades e verificação de arquivos do sistema (SFC), pelas ferramentas nativas do Windows.
Ajustes: papel de parede (o padrão é a arte do instalador), modo de efeitos leve, exportar ou apagar os seus dados, e desinstalação completa.
Paleta de comandos: Ctrl+K para ir a qualquer página ou ação.
Como o "aprendizado" funciona (sem exagero)
Não há modelo de IA. O motor (src/brain.js, com testes em tests/) faz quatro coisas simples e verificáveis:

Guarda médias e variações de CPU, RAM, disco, GPU e temperatura para cada uma das 168 horas da semana. Assim sabe o que é "normal" numa terça às 15h. Minutos de lentidão não entram na média, para não virarem o novo normal.
Detecta episódios sustentados (CPU alta, memória no limite, temperatura alta, queda de clock com calor).
Registra qual programa estava no topo do consumo durante cada episódio e conta os reincidentes.
Ajusta a confiança de cada tipo de sugestão conforme o seu feedback ("ajudou" ou "não ajudou").
Tudo fica neste computador e pode ser exportado ou apagado em Ajustes.

Visão técnica, contratos e plano de fases: docs/ARQUITETURA.md.
