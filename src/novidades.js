/*
 * Novidades de cada versão, para a janela que abre uma vez depois de atualizar (src/view-novidades.js).
 * A versão mais nova vem primeiro. Toda versão publicada precisa de uma entrada aqui (o teste confere).
 * É para quem USA o Nexo: só o que muda para a pessoa. Bastidores do criador (painel do criador, testes, ferramentas de
 * análise do código, servidor por dentro) ficam no CHANGELOG, não aqui (o teste também confere).
 */
(function (root) {
  root.NexoNovidades = {
    versions: [
      {
        version: '0.11.2', date: '2026-11-11', emoji: '🔭', title: 'Análise profunda',
        tagline: 'O Nexo entende o seu PC peça por peça, vê o que pesa por trás do jogo e monta um plano feito para a sua máquina.',
        sections: [
          { emoji: '✨', title: 'Novidades', tone: 'new', items: [
            { emoji: '🔭', title: 'Análise profunda', text: 'Em Análise: no mínimo 60 segundos (mais, quando precisa) olhando o PC a fundo. Lê as peças, 30 dias de eventos do sistema, o que roda por trás e faz um teste de carga curto. Não muda nada no PC e dá para deixar um jogo aberto.' },
            { emoji: '🧩', title: 'Cada peça entendida, não só listada', text: 'O chipset da placa-mãe e o que ele permite, a geração do processador e o caminho de upgrade do soquete, a velocidade de cada pente pelo código dele, o link da placa de vídeo e do SSD, a porta e a taxa do monitor.' },
            { emoji: '🎮', title: 'O que pesa por trás do jogo', text: 'O jogo, os launchers (Steam, Epic, Riot…) e o próprio Nexo ficam de fora da conta: a lista mostra o que atrapalha por trás deles, com o tipo de cada programa e o que fazer.' },
            { emoji: '🗺️', title: 'Um plano para este PC', text: 'O que fazer na BIOS, o que o laboratório testa e mede neste PC e o que acompanhar, montado a partir das peças. Cada nova análise compara com a anterior.' },
            { emoji: '🌌', title: 'A constelação do seu PC', text: 'Cada peça é uma estrela que acende e ganha o nome quando é examinada. No fim, a carta celeste do PC mostra a nota, o que já está certo e onde há algo para ajustar.' }
          ] },
          { emoji: '⚡', title: 'Melhorias', tone: 'up', items: [
            { emoji: '🔎', title: 'Reconhece muito mais peças', text: 'Do Core 2 ao Core Ultra, Ryzen, Xeon de placas X79/X99, Steam Deck e Snapdragon; placas de vídeo de jogo, de estação de trabalho e integradas; chipsets, pentes de memória, SSDs, HDs e placas de rede de dezenas de marcas.' },
            { emoji: '⚡', title: 'A análise de antes continua', text: 'O botão "Rápida" mede os programas na hora, como antes.' }
          ] },
          { emoji: '🛠️', title: 'Correções', tone: 'fix', items: [
            { emoji: '📏', title: 'Medição de desempenho mais justa', text: 'O teste do plano de energia agora alterna os dois planos (o aquecimento do processador pesa igual dos dois lados), e o laboratório não chama de "piorou" um ajuste com ganho total positivo.' },
            { emoji: '🧪', title: 'Tabela do laboratório', text: 'Quatro colunas dos resultados mostravam "undefined" no lugar do nome do teste.' }
          ] }
        ]
      },
      {
        version: '0.11.1', date: '2026-11-10', emoji: '🛡️', title: 'Revisão completa',
        tagline: 'Medições mais honestas, o modo extremo sem alarme falso, relatórios de erro sempre ligados e o app mais seguro de ponta a ponta.',
        sections: [
          { emoji: '✨', title: 'Novidades', tone: 'new', items: [
            { emoji: '🧭', title: 'O que limita o seu PC', text: 'As sessões gravadas dizem o que segurou o PC: o processador, um núcleo só, a placa de vídeo (e se foi energia, calor, memória de vídeo cheia ou clock baixo), a memória ou um limite de quadros. GPU em 100% com clock baixo não é mais "falta de placa".' },
            { emoji: '🐞', title: 'Relatórios de erro sempre ligados', text: 'Os erros do app vão sempre para o criador corrigir, com os últimos passos antes de cada um e sem o seu nome de usuário, as suas pastas ou o que você digitou. Só os erros de depois desta atualização. A telemetria continua opcional.' },
            { emoji: '📧', title: 'O seu e-mail, do seu jeito', text: 'Com a conta Google entrada no Nexo, o e-mail vai junto para o criador avisar quando corrigir. Desmarcar em Ajustes > Privacidade e dados tira o e-mail também dos relatórios que já foram.' },
            { emoji: '📊', title: 'Telemetria do dia em curso', text: 'Com a telemetria ligada, o resumo de hoje vai parcial (no máximo a cada 3 horas) e o completo o substitui quando o dia acaba. Continua anônimo.' }
          ] },
          { emoji: '⚡', title: 'Melhorias', tone: 'up', items: [
            { emoji: '🌡️', title: 'Leituras que não congelam', text: 'Com um jogo na frente, temperatura, clock e placa de vídeo continuam atualizando, e uma leitura velha não entra no histórico como se fosse de agora.' },
            { emoji: '🎞️', title: 'FPS da sessão inteira', text: 'Sessões longas são medidas até o fim (antes, só os primeiros minutos), e o "1% baixo" é a média do pior 1%, como no CapFrameX.' },
            { emoji: '🎯', title: 'Jogos com anticheat', text: 'Jogo em tela cheia com o caminho protegido agora é reconhecido, e a sessão automática começa em uns 3 segundos.' },
            { emoji: '🧠', title: 'Aprendizado que não volta atrás', text: 'O aprendizado é salvo antes do histórico, e um turbo de um núcleo só não vira mais a régua do clock.' },
            { emoji: '🔒', title: 'Mais seguro', text: 'O app inteiro passou por uma revisão de segurança: os programas do Windows são chamados sempre pelo caminho oficial, as telas não rodam nenhum código de fora do Nexo e o login com o Google tem prazo e vale uma vez só.' }
          ] },
          { emoji: '🛠️', title: 'Correções', tone: 'fix', items: [
            { emoji: '🧪', title: 'Modo extremo não aborta no começo', text: 'Cada ajuste é comparado com a temperatura normal do mesmo teste no plano original. Antes, o próprio aquecimento contava como culpa do ajuste e o teste parava sem ter mudado nada.' },
            { emoji: '⚠️', title: 'Erro do Windows no ajuste certo', text: 'No modo extremo, só conta o erro que aconteceu durante o teste daquele ajuste; um erro antigo não culpa o ajuste seguinte.' },
            { emoji: '📈', title: 'Placa de vídeo no limite de verdade', text: 'A carga da placa é a do núcleo 3D, não a do decodificador de vídeo ou da memória dela.' },
            { emoji: '💾', title: 'Um segundo de memória alta', text: 'Um pico de 1 segundo de RAM não marca mais a sessão inteira como "memória no limite".' },
            { emoji: '📝', title: 'Registro de erros', text: 'Conta todas as ocorrências, não passa do tamanho limite e "Apagar" só diz que apagou quando apagou.' }
          ] }
        ]
      },
      {
        version: '0.11.0', date: '2026-11-07', emoji: '🪐', title: 'Mais espaço e mais leve',
        tagline: 'Entrar com a Steam, diagnóstico de rede, recursos em grupos e o céu bem mais leve na placa de vídeo.',
        sections: [
          { emoji: '✨', title: 'Novidades', tone: 'new', items: [
            { emoji: '🎮', title: 'Entrar com a Steam', text: 'Login oficial da Steam, sem senha no Nexo e sem precisar de chave: jogos da conta, tempo de jogo e conquistas, mesmo sem a Steam instalada. Em Ajustes > Contas e conexões.' },
            { emoji: '🌐', title: 'Internet lenta? Diagnóstico de rede', text: 'Em Manutenção: mede o DNS, o IPv6, o proxy, o cabo e um site de verdade, e sugere a correção (como trocar o DNS), com volta pelo Diário.' },
            { emoji: '🗂️', title: 'Recursos em grupos', text: 'Fixados, Leituras, Ferramentas e Ações, cada grupo com duas linhas e um "ver mais". Cartões maiores, com mais respiro.' },
            { emoji: '🔄', title: 'Cor e céu viajam entre PCs', text: 'A sincronização agora leva a cor de destaque e as opções do céu junto das preferências.' },
            { emoji: '📊', title: 'Telemetria mais útil', text: 'O resumo do dia agora chega completo, depois que o dia acaba, e ajuda a achar o que falha e o que pesa. Sempre anônima e opcional; a lista está em Política completa.' }
          ] },
          { emoji: '⚡', title: 'Melhorias', tone: 'up', items: [
            { emoji: '🎮', title: 'Bem mais leve na placa de vídeo', text: 'A aurora, o anel do índice e outros detalhes animados agora andam junto com o céu, a no máximo 30 quadros, e os cartões não usam mais desfoque próprio. Numa placa integrada, o modo Completo pesava uns 30% de uso.' },
            { emoji: '🌙', title: 'Mapa do sistema descansa', text: 'Com outro app na frente, o mapa do Início para de girar, como o resto do céu.' },
            { emoji: '🧮', title: 'Programas somados', text: '"Programa que mais pesa" e "Quem mais ocupa memória" somam os processos de mesmo nome (o Chrome e o Discord abrem vários).' }
          ] },
          { emoji: '🛠️', title: 'Correções', tone: 'fix', items: [
            { emoji: '💾', title: 'Memória no Hardware', text: 'A memória aparecia como "12 B" em vez de 12 GB, e alguns sensores apareciam como "SmallData".' },
            { emoji: '📉', title: 'Memória livre', text: 'A barra mostrava a parte usada; agora mostra a livre, com a porcentagem.' },
            { emoji: '🧷', title: 'Alterações ativas', text: 'Esvaziar a Lixeira e limpar temporários não contam mais como alteração ativa (não há o que desfazer).' },
            { emoji: '➖', title: 'Sem "-0,0"', text: 'Tendências quase paradas aparecem como 0,0.' }
          ] }
        ]
      },
      {
        version: '0.10.0', date: '2026-11-07', emoji: '🌌', title: 'Noite viva',
        tagline: 'O Nexo ganhou vida: céu animado, cores à sua escolha e mais de 370 recursos novos espalhados pelas telas.',
        sections: [
          { emoji: '✨', title: 'Novidades', tone: 'new', items: [
            { emoji: '🌠', title: 'Céu vivo', text: 'Estrelas que piscam, estrelas cadentes e, de vez em quando, uma chuva de meteoros. Clique duas vezes no céu vazio para soltar uma.' },
            { emoji: '🪲', title: 'Vagalumes', text: 'Luzinhas que vagam perto das flores e chegam perto do mouse. Dá para desligar ou mudar a quantidade em Ajustes.' },
            { emoji: '🎨', title: 'Sete cores de destaque', text: 'Estrela, Nebulosa, Meteoro, Aurora, Vagalume, Brasa e Lua: o neon do app inteiro muda junto.' },
            { emoji: '🧩', title: 'Mais de 30 recursos em cada tela', text: 'Leituras, ferramentas e atalhos novos no fim de cada uma das 12 telas, com busca, filtros e estrela para fixar os favoritos.' },
            { emoji: '🕰️', title: 'Céu que acompanha a hora', text: 'Anoitecer, madrugada e amanhecer mudam o tom do fundo.' },
            { emoji: '📰', title: 'Esta janela!', text: 'Toda atualização agora mostra o que mudou. Você pode reabrir em Atualizações.' }
          ] },
          { emoji: '⚡', title: 'Melhorias', tone: 'up', items: [
            { emoji: '🪟', title: 'Interface repaginada', text: 'Vidro mais profundo, títulos com brilho, botões novos e uma barra lateral com neon.' },
            { emoji: '🚀', title: 'Leve de verdade', text: 'O céu desenha no máximo 30 quadros por segundo, para com o app fora de foco e se ajusta sozinho em PCs mais fracos.' }
          ] }
        ]
      },
      {
        version: '0.9.0', date: '2026-11-06', emoji: '☁️', title: 'Servidor do Nexo',
        tagline: 'Sincronização entre PCs com o seu login do Google, relatórios de erro e telemetria diária. Tudo opcional.',
        sections: [
          { emoji: '✨', title: 'Novidades', tone: 'new', items: [
            { emoji: '🔄', title: 'Sincronização entre PCs', text: 'Cada PC guarda uma cópia criptografada; você escolhe de qual PC e o que trazer.' },
            { emoji: '🐞', title: 'Relatórios de erro', text: 'Agrupados, sem o seu nome de usuário nem as suas pastas. O e-mail vai só se você quiser.' },
            { emoji: '📊', title: 'Telemetria diária', text: 'Anônima, uma vez por dia, desligada por padrão.' },
            { emoji: '📝', title: 'Registro de erros', text: 'Em Ajustes: veja, copie e apague o que deu errado no app.' }
          ] },
          { emoji: '🛠️', title: 'Correções', tone: 'fix', items: [
            { emoji: '🔑', title: 'Login com Google', text: 'As versões publicadas saíam sem a configuração do Google. Agora funciona direto.' }
          ] }
        ]
      },
      {
        version: '0.8.1', date: '2026-11-05', emoji: '🩹', title: 'Correções',
        tagline: 'Temperaturas, laboratório, Atlas, Manutenção e notas da atualização.',
        sections: [
          { emoji: '🛠️', title: 'Correções', tone: 'fix', items: [
            { emoji: '🌡️', title: 'Limites do SSD', text: 'Os limites de aviso e crítico apareciam como temperatura. Agora aparecem como "Limite (fixo)".' },
            { emoji: '🧪', title: 'Laboratório', text: 'A conferência conta só o que vale no seu processador.' },
            { emoji: '🗺️', title: 'Atlas', text: 'Com os grupos novos do laboratório, o Raio-X e o teste com reinício.' },
            { emoji: '💽', title: 'Manutenção', text: 'Mostra a temperatura e o tipo do disco.' }
          ] }
        ]
      },
      {
        version: '0.8.0', date: '2026-11-04', emoji: '🔬', title: 'Raio-X e teste com reinício',
        tagline: '109 configurações do Windows lidas e explicadas, e testes que atravessam reinícios.',
        sections: [
          { emoji: '✨', title: 'Novidades', tone: 'new', items: [
            { emoji: '🩻', title: 'Raio-X do PC', text: '109 configurações com o valor atual, o padrão do Windows e o que muda, com reversão pelo Diário.' },
            { emoji: '🔁', title: 'Teste com reinício', text: 'Mede ajustes que só valem depois de reiniciar, alternando A e B.' }
          ] }
        ]
      }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
