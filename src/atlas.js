/*
 * Atlas de opções: TODAS as alavancas de desempenho que valem conhecer — as famosas, as pouco conhecidas e as que
 * circulam como boato — cada uma com o que o Nexo faz com ela:
 *   laboratorio = o laboratório testa sozinho, medindo neste PC   ·  acao = o Nexo faz, com prévia e confirmação
 *   guia        = o Nexo verifica e leva você à tela certa          ·  mito = não use (motivo e evidência ao lado)
 *   bloqueado   = o Nexo se recusa a mexer, mesmo no modo extremo (segurança ou risco ao hardware)
 * `evaluateFacts` transforma leituras somente-leitura do sistema em achados para os itens que dá para conferir aqui.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoAtlas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS = { laboratorio: 'O laboratório testa', acao: 'O Nexo faz', guia: 'O Nexo confere e guia', mito: 'Mito: não use', bloqueado: 'O Nexo não mexe' };
  const FAME = { conhecido: 'Conhecido', 'pouco-conhecido': 'Pouco conhecido', raro: 'Quase ninguém mexe' };
  const AREA = { processador: 'Processador', video: 'Vídeo e tela', memoria: 'Memória', disco: 'Armazenamento', windows: 'Windows', rede: 'Rede', seguranca: 'Segurança' };

  const E = (id, area, status, fama, titulo, resumo, porque, extra = {}) => ({ id, area, status, fama, titulo, resumo, porque, ...extra });
  const ITEMS = [
    // ---- Laboratório: testado aqui, com medição ----
    E('lab-epp', 'processador', 'laboratorio', 'raro', 'Preferência de desempenho energético (EPP)', 'Configuração oculta que diz ao processador o quanto priorizar velocidade ou economia.', 'Em processadores modernos é ela, mais que o "plano", que decide a rapidez para acelerar. O valor ideal muda de PC para PC.', { goto: 'lab' }),
    E('lab-boost', 'processador', 'laboratorio', 'pouco-conhecido', 'Modo de turbo (boost)', 'Desativado, ativado, agressivo ou eficiente: como o turbo é usado.', 'Agressivo pode render mais em rajadas, mas aquece. O laboratório mede ganho e temperatura juntos.', { goto: 'lab' }),
    E('lab-minstate', 'processador', 'laboratorio', 'conhecido', 'Estado mínimo do processador', 'O piso de velocidade. Piso alto responde mais rápido e gasta mais parado.', 'É o que o plano "Desempenho máximo" faz por baixo. Medir evita gastar energia à toa.', { goto: 'lab' }),
    E('lab-parking', 'processador', 'laboratorio', 'raro', 'Estacionamento de núcleos', 'Quantos núcleos ficam sempre acordados.', 'Núcleos "estacionados" economizam, mas podem atrasar picos. Em alguns PCs não muda nada; em outros, muda.', { goto: 'lab' }),
    E('lab-incpol', 'processador', 'laboratorio', 'raro', 'Política de aumento de desempenho', 'Subir a frequência em degraus ou direto ao máximo ("foguete").', 'Afeta a resposta a cargas curtas, como cliques, carregamentos e quadros irregulares.', { goto: 'lab' }),
    E('lab-cooling', 'processador', 'laboratorio', 'pouco-conhecido', 'Política de resfriamento', 'Ao esquentar: reduzir a velocidade primeiro ou acelerar as ventoinhas primeiro.', 'Em notebooks, a política passiva pode cortar desempenho antes da hora.', { goto: 'lab' }),
    E('ultimate-plan', 'processador', 'laboratorio', 'pouco-conhecido', 'Plano "Desempenho máximo" (oculto)', 'Um plano escondido do Windows que tira quase toda a economia de energia.', 'O laboratório testa as mesmas alavancas uma a uma e mostra se alguma faz diferença de verdade aqui, em vez de ligar tudo no escuro.', { goto: 'lab' }),
    // ---- Ações que o Nexo já faz ----
    E('power-plan', 'processador', 'acao', 'conhecido', 'Trocar o plano de energia', 'Equilibrado, alto desempenho ou economia, com medição antes e depois.', 'Ajuda em PCs presos no modo economia. Em muitos outros a diferença fica no ruído, e o Nexo mostra isso.', { goto: 'optimize' }),
    E('cleanup', 'disco', 'acao', 'conhecido', 'Limpeza segura', 'Temporários antigos, relatórios de falha e de erro, Lixeira.', 'Libera espaço. Não deixa o PC mais rápido por si só, a não ser que o disco esteja quase cheio.', { goto: 'optimize' }),
    E('trim', 'disco', 'acao', 'conhecido', 'Otimizar unidade (TRIM em SSD)', 'O Windows escolhe TRIM para SSD e desfragmentação para HD.', 'Mantém o SSD rápido em escrita. Normalmente o Windows já agenda sozinho.', { goto: 'maintenance' }),
    E('sfc', 'windows', 'acao', 'conhecido', 'Verificar arquivos do sistema (SFC)', 'Confere e repara arquivos protegidos do Windows.', 'Útil quando há travamentos ou erros estranhos; não acelera um sistema saudável.', { goto: 'maintenance' }),
    E('fps-access', 'video', 'acao', 'pouco-conhecido', 'Liberar a medição de FPS', 'Coloca o seu usuário no grupo "Performance Log Users", com a sua permissão.', 'Sem isso, ninguém mede FPS de verdade sem rodar como administrador.', { goto: 'sessions' }),
    // ---- Guias com verificação local ----
    E('refresh', 'video', 'guia', 'pouco-conhecido', 'Monitor na taxa certa (Hz)', 'Muita gente compra um monitor de 144 Hz e usa a 60 Hz sem saber.', 'É o ganho de fluidez mais barato que existe: um ajuste em Configurações.', { fact: 'refresh', page: 'display' }),
    E('xmp', 'memoria', 'guia', 'pouco-conhecido', 'Perfil XMP/EXPO da memória', 'Memórias vendidas a 3200 ou 6000 MT/s costumam vir de fábrica rodando mais devagar.', 'Ligar o perfil no BIOS é seguro na maioria dos PCs e dá ganho real em jogos. O Nexo só confere; o ajuste é no BIOS.', { fact: 'xmp' }),
    E('dual-channel', 'memoria', 'guia', 'pouco-conhecido', 'Memória em dois canais', 'Um pente só usa metade do caminho até o processador.', 'Dois pentes iguais costumam render bem mais em jogos e, principalmente, em vídeo integrado.', { fact: 'channels' }),
    E('hags', 'video', 'guia', 'pouco-conhecido', 'Agendamento de GPU acelerado por hardware', 'Deixa a placa de vídeo organizar a própria fila de trabalho.', 'Pode reduzir latência em alguns PCs e piorar em outros. Exige reiniciar. Grave uma sessão antes e outra depois.', { fact: 'hags', page: 'graphics' }),
    E('game-mode', 'windows', 'guia', 'conhecido', 'Modo de Jogo do Windows', 'Prioriza o jogo e segura atualizações durante a partida.', 'Vem ligado. Desligado, o Windows pode instalar coisas no meio do jogo.', { fact: 'gameMode', page: 'gamemode' }),
    E('capture', 'video', 'guia', 'pouco-conhecido', 'Gravação em segundo plano (Xbox Game Bar)', '"Gravar o que aconteceu" mantém um vídeo dos últimos minutos o tempo todo.', 'Custa um pouco de GPU e disco o tempo inteiro. Desligue se você não usa.', { fact: 'capture', page: 'captures' }),
    E('windowed', 'video', 'guia', 'pouco-conhecido', 'Otimizações para jogos em janela', 'Faz jogos em janela/sem borda funcionarem como tela cheia (menor latência).', 'Ajuda jogos DirectX 10/11 em modo janela. Fica em Configurações > Gráficos.', { page: 'graphics' }),
    E('gpu-pref', 'video', 'guia', 'pouco-conhecido', 'Placa de vídeo preferida por jogo', 'Em notebooks com duas placas, garante que o jogo use a dedicada.', 'Um jogo rodando na placa integrada por engano perde metade do desempenho ou mais.', { page: 'graphics' }),
    E('startup', 'windows', 'guia', 'conhecido', 'Programas que abrem com o Windows', 'Menos coisas iniciando = PC pronto mais cedo e menos ruído de fundo.', 'O efeito em jogos é pequeno, mas na inicialização é grande. O Nexo lista; você decide no Windows.', { page: 'startup' }),
    E('free-space', 'disco', 'guia', 'conhecido', 'Deixar espaço livre no SSD', 'SSDs muito cheios ficam mais lentos para gravar.', 'Manter uns 10–15% livres ajuda o próprio controlador do SSD. O Nexo prevê quando o disco vai encher.', { goto: 'analysis' }),
    E('vrr', 'video', 'guia', 'conhecido', 'Taxa variável (G-Sync/FreeSync) e limite de FPS', 'Sincronia sem atraso e quadros mais regulares.', 'Limitar o FPS um pouco abaixo da taxa do monitor costuma deixar o jogo mais suave e mais frio. Ajuste no driver ou no jogo.'),
    E('drivers', 'video', 'guia', 'conhecido', 'Driver de vídeo atualizado', 'Drivers novos trazem correções e ganhos para jogos recentes.', 'Use o app do fabricante. O Nexo não instala drivers.'),
    E('vbs', 'seguranca', 'guia', 'pouco-conhecido', 'Integridade de memória e VBS', 'Proteções do Windows que custam alguns % em certos jogos.', 'A própria Microsoft publicou (2022) que desligar "Integridade de memória" e a "Plataforma de Máquina Virtual" pode melhorar jogos, avisando que reduz a proteção. O Nexo só mostra o estado e leva você à tela; a decisão é sua.', { fact: 'vbs', page: 'coreisolation' }),
    // ---- Mitos e boatos ----
    E('myth-registry', 'windows', 'mito', 'conhecido', '"Limpadores de registro"', 'Prometem acelerar o PC apagando entradas do Registro.', 'Não há ganho mensurável, e apagar a entrada errada quebra programas.'),
    E('myth-pagefile', 'memoria', 'mito', 'conhecido', 'Desligar o arquivo de paginação', 'A ideia é "forçar" o uso da memória RAM.', 'O Windows precisa dele para a memória confirmada. Sem ele, jogos e programas podem fechar sozinhos quando a memória aperta.'),
    E('myth-ramclean', 'memoria', 'mito', 'conhecido', '"Liberadores de RAM" e limpeza da memória em espera', 'Esvaziam a memória que o Windows usa como cache.', 'Memória livre parada é memória desperdiçada: o cache existe para carregar as coisas mais rápido. Esvaziar costuma piorar carregamentos.'),
    E('myth-ssd-defrag', 'disco', 'mito', 'conhecido', 'Desfragmentar SSD', 'Rodar desfragmentadores antigos no SSD.', 'Só gasta vida útil. O "Otimizar unidade" do Windows já faz o certo (TRIM).'),
    E('myth-services', 'windows', 'mito', 'conhecido', 'Desligar dezenas de serviços', 'Listas da internet com serviços "inúteis" para desligar.', 'Ganho não comprovado e recursos quebrados (busca, impressão, atualizações, Bluetooth). Difícil de desfazer.'),
    E('myth-bcdedit', 'processador', 'mito', 'pouco-conhecido', 'bcdedit: useplatformclock, disabledynamictick, tscsyncpolicy', 'Comandos que mudam o relógio do sistema, populares em vídeos de "otimização".', 'Sem evidência de ganho em sistemas modernos; podem piorar a precisão de tempo e a latência. O Nexo não executa bcdedit.'),
    E('myth-timer', 'processador', 'mito', 'pouco-conhecido', 'Ferramentas de "resolução de timer 0,5 ms"', 'Programas que forçam o relógio do Windows ao mínimo o tempo todo.', 'Desde o Windows 10 2004 o efeito é por processo; os jogos já pedem o que precisam. Fica só o gasto extra de energia.'),
    E('myth-nagle', 'rede', 'mito', 'pouco-conhecido', 'Desligar o algoritmo de Nagle (TcpAckFrequency/TCPNoDelay)', 'Ajuste de Registro prometido para "reduzir o ping".', 'Jogos online modernos usam UDP ou já desligam o Nagle na própria conexão. Não muda o ping da sua internet.'),
    E('myth-priority', 'windows', 'mito', 'conhecido', 'Prioridade "Tempo real" ou "Alta" para o jogo', 'Mudar a prioridade no Gerenciador de Tarefas.', 'Ganho mínimo e risco de travar mouse, teclado e áudio, que precisam de tempo de processador.'),
    E('myth-hosts', 'rede', 'mito', 'conhecido', 'Bloquear "telemetria" no arquivo hosts para ganhar desempenho', 'Listas enormes no hosts.', 'Não muda o desempenho e pode quebrar atualizações e lojas.'),
    // ---- O que o Nexo se recusa a fazer ----
    E('block-defender', 'seguranca', 'bloqueado', 'conhecido', 'Desligar o antivírus (Defender)', 'Comum em guias de "debloat".', 'O ganho é pequeno e o risco é enorme. Se um jogo engasga por causa do antivírus, uma exclusão de pasta pontual resolve, e quem decide é você.'),
    E('block-mitigations', 'seguranca', 'bloqueado', 'pouco-conhecido', 'Desligar proteções contra Spectre/Meltdown', 'Recuperam alguns % em cargas específicas.', 'Abre brechas de segurança graves no processador. O Nexo não mexe.'),
    E('block-secureboot', 'seguranca', 'bloqueado', 'conhecido', 'Desligar Secure Boot, assinatura de drivers ou anticheat', 'Aparece em guias de mods e overclock.', 'Quebra jogos com anticheat e abre caminho para malware que inicia antes do Windows.'),
    E('block-oc', 'processador', 'bloqueado', 'conhecido', 'Overclock ou undervolt automáticos', 'Mudar tensões e frequências do hardware.', 'Pode causar instabilidade, corrupção de dados e, no limite, dano. Fora do escopo do Nexo, inclusive no modo extremo.'),
    E('block-msi', 'video', 'bloqueado', 'raro', 'Forçar "MSI mode" de interrupções', 'Ajuste de Registro em dispositivos PCI.', 'Placas atuais já usam; forçar num dispositivo sem suporte pode impedir o Windows de iniciar.'),
    E('block-thermal', 'processador', 'bloqueado', 'raro', 'Desligar limites térmicos e de energia', 'Tirar o freio de temperatura do processador ou da placa.', 'É a proteção que impede o hardware de se danificar. Nunca.')
  ];

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const list = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);

  /** Leituras do sistema → achados. Estados: ok | atencao | info | desconhecido. */
  function evaluateFacts(facts) {
    const out = {};
    if (!facts || facts.platform !== 'win32') return out;
    const memory = list(facts.memory).filter((module) => finite(module.capacity) && module.capacity > 0);
    if (memory.length) {
      const speed = Math.max(...memory.map((module) => module.speed || 0));
      const configured = Math.min(...memory.map((module) => module.configured || module.speed || 0));
      if (speed && configured && configured < speed * 0.92) out.xmp = { state: 'atencao', text: `A memória está configurada a ${configured} MT/s, mas os módulos informam ${speed} MT/s. O perfil XMP/EXPO provavelmente está desligado no BIOS.` };
      else if (configured) out.xmp = { state: 'info', text: `A memória roda a ${configured} MT/s, igual ao que os módulos informam ao Windows. Se ela foi vendida como mais rápida, o perfil XMP/EXPO pode estar desligado (o Windows nem sempre enxerga o perfil).` };
      out.channels = memory.length === 1
        ? { state: 'atencao', text: 'Só um módulo de memória detectado: provavelmente um canal só. Em notebooks com memória soldada isso pode não se aplicar.' }
        : { state: 'ok', text: `${memory.length} módulos de memória detectados; dois canais é o provável (depende dos slots usados).` };
    }
    const displays = list(facts.displays).filter((display) => finite(display.current) && display.current > 1);
    if (displays.length) {
      const low = displays.find((display) => display.current <= 60 && finite(display.max) && display.max >= 100);
      out.refresh = low
        ? { state: 'atencao', text: `${low.name} está a ${low.current} Hz e a placa informa suporte até ${low.max} Hz. Se o seu monitor for de alta taxa, ajuste em Configurações > Tela > Avançado.` }
        : { state: 'info', text: `Taxa atual: ${displays.map((display) => `${display.current} Hz`).join(', ')}. Confira se é a máxima do seu monitor.` };
    }
    out.hags = facts.hags === 2 ? { state: 'info', text: 'Ligado neste PC.' } : facts.hags === 1 ? { state: 'info', text: 'Desligado neste PC.' } : { state: 'desconhecido', text: 'Não exposto pelo driver (ou não suportado).' };
    out.gameMode = facts.gameMode === 0 ? { state: 'atencao', text: 'Desligado neste PC.' } : { state: 'ok', text: 'Ligado (padrão).' };
    out.capture = facts.capture === 1 ? { state: 'atencao', text: 'A captura de jogos está ativa. Se "Gravar o que aconteceu" estiver ligado, há gravação contínua.' } : facts.capture === 0 ? { state: 'ok', text: 'Captura de jogos desligada.' } : { state: 'desconhecido', text: 'Não foi possível ler.' };
    if (facts.vbs !== null && facts.vbs !== undefined) out.vbs = facts.vbs === 2 ? { state: 'info', text: `VBS em execução${facts.hvci ? ', com Integridade de memória ligada' : ''}.` } : { state: 'info', text: 'VBS não está em execução.' };
    return out;
  }

  const counts = () => ITEMS.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
  return { ITEMS, STATUS, FAME, AREA, evaluateFacts, counts, get: (id) => ITEMS.find((item) => item.id === id) || null };
});
