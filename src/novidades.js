/*
 * Novidades de cada versão, para a janela que abre uma vez depois de atualizar (src/view-novidades.js).
 * A versão mais nova vem primeiro. Toda versão publicada precisa de uma entrada aqui (o teste confere).
 */
(function (root) {
  root.NexoNovidades = {
    versions: [
      {
        version: '0.11.0', date: '2026-11-07', emoji: '🪐', title: 'Mais espaço e mais leve',
        tagline: 'Recursos em grupos, cartões maiores, o céu bem mais leve na placa de vídeo e várias correções achadas num PC de verdade.',
        sections: [
          { emoji: '✨', title: 'Novidades', tone: 'new', items: [
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
            { emoji: '🚀', title: 'Leve de verdade', text: 'O céu desenha no máximo 30 quadros por segundo, para com o app fora de foco e se ajusta sozinho em PCs mais fracos.' },
            { emoji: '📦', title: 'Instalador conferido', text: 'Um teste novo garante que todo arquivo da interface entra no instalador.' }
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
        version: '0.8.1', date: '2026-11-05', emoji: '🩹', title: 'Correções do teste num PC de verdade',
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
