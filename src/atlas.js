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
  const AREA = { processador: 'Processador', video: 'Vídeo e tela', memoria: 'Memória', disco: 'Armazenamento', windows: 'Sistema', rede: 'Rede', seguranca: 'Segurança' };

  const E = (id, area, status, fama, titulo, resumo, porque, extra = {}) => ({ id, area, status, fama, titulo, resumo, porque, ...extra });
  const ITEMS = [
    // ---- Laboratório: testado aqui, com medição ----
    E('lab-epp', 'processador', 'laboratorio', 'raro', 'Preferência de desempenho energético (EPP)', 'Configuração oculta que diz ao processador o quanto priorizar velocidade ou economia.', 'Em processadores modernos é ela, mais que o "plano", que decide a rapidez para acelerar. O valor ideal muda de PC para PC.', { goto: 'lab' , os: 'win32' }),
    E('lab-boost', 'processador', 'laboratorio', 'pouco-conhecido', 'Modo de turbo (boost)', 'Desativado, ativado, agressivo ou eficiente: como o turbo é usado.', 'Agressivo pode render mais em rajadas, mas aquece. O laboratório mede ganho e temperatura juntos.', { goto: 'lab' , os: 'win32' }),
    E('lab-minstate', 'processador', 'laboratorio', 'conhecido', 'Estado mínimo do processador', 'O piso de velocidade. Piso alto responde mais rápido e gasta mais parado.', 'É o que o plano "Desempenho máximo" faz por baixo. Medir evita gastar energia à toa.', { goto: 'lab' , os: 'win32' }),
    E('lab-parking', 'processador', 'laboratorio', 'raro', 'Estacionamento de núcleos', 'Quantos núcleos ficam sempre acordados.', 'Núcleos "estacionados" economizam, mas podem atrasar picos. Em alguns PCs não muda nada; em outros, muda.', { goto: 'lab' , os: 'win32' }),
    E('lab-incpol', 'processador', 'laboratorio', 'raro', 'Política de aumento de desempenho', 'Subir a frequência em degraus ou direto ao máximo ("foguete").', 'Afeta a resposta a cargas curtas, como cliques, carregamentos e quadros irregulares.', { goto: 'lab' , os: 'win32' }),
    E('lab-cooling', 'processador', 'laboratorio', 'pouco-conhecido', 'Política de resfriamento', 'Ao esquentar: reduzir a velocidade primeiro ou acelerar as ventoinhas primeiro.', 'Em notebooks, a política passiva pode cortar desempenho antes da hora.', { goto: 'lab' , os: 'win32' }),
    E('lab-latency', 'processador', 'laboratorio', 'raro', 'Sensibilidade à latência e desempenho mínimo garantido', 'Configurações ocultas que dizem quando um pico curto merece frequência máxima.', 'Mexem na resposta a cliques e quadros irregulares sem gastar energia o tempo todo. Só medindo dá para saber se ajudam aqui.', { goto: 'lab', os: 'win32' }),
    E('lab-idle', 'processador', 'laboratorio', 'raro', 'Estados ociosos (C-states) do processador', 'Quão fundo o processador "dorme" entre uma tarefa e outra, e quanto demora para acordar.', 'Dormir fundo economiza, mas acordar custa microssegundos. O laboratório mede a latência para acordar um núcleo antes e depois.', { goto: 'lab', os: 'win32' }),
    E('lab-hybrid', 'processador', 'laboratorio', 'raro', 'Núcleos híbridos P/E (Intel 12ª geração em diante)', 'Para onde o Windows manda as tarefas: núcleos de desempenho ou de eficiência.', 'Jogos em núcleo de eficiência engasgam. O laboratório só testa isso em processadores com núcleos P e E.', { goto: 'lab', os: 'win32' }),
    E('lab-storage', 'disco', 'laboratorio', 'raro', 'Economia de energia do SSD (SATA e NVMe)', 'Quanto tempo o SSD espera parado antes de cochilar, e quão fundo.', 'O cochilo economiza, mas o primeiro acesso depois dele demora. O teste de disco do laboratório mede exatamente esse atraso.', { goto: 'lab', os: 'win32' }),
    E('lab-pcie', 'disco', 'laboratorio', 'raro', 'Economia de energia do PCI Express (ASPM)', 'O link da placa de vídeo e do NVMe pode entrar em economia quando ocioso.', 'Em alguns PCs causa engasgos ao "acordar" o link; em outros não muda nada. Medindo, o Nexo descobre qual é o seu caso.', { goto: 'lab', os: 'win32' }),
    E('lab-wifi', 'rede', 'laboratorio', 'pouco-conhecido', 'Economia de energia do Wi-Fi', 'O adaptador sem fio pode cochilar entre pacotes.', 'Cochilos aumentam o ping e a variação dele. O teste de rede do laboratório mede a conexão com o roteador antes e depois.', { goto: 'lab', os: 'win32' }),
    E('ultimate-plan', 'processador', 'laboratorio', 'pouco-conhecido', 'Plano "Desempenho máximo" (oculto)', 'Um plano escondido do Windows que tira quase toda a economia de energia.', 'O laboratório testa as mesmas alavancas uma a uma e mostra se alguma faz diferença de verdade aqui, em vez de ligar tudo no escuro.', { goto: 'lab' , os: 'win32' }),
    // ---- Ações que o Nexo já faz ----
    E('xray', 'windows', 'acao', 'pouco-conhecido', 'Raio-X do registro, dos serviços e do plano de energia', 'Mais de 100 ajustes famosos e pouco conhecidos, com o valor de agora e o que a evidência diz de cada um.', 'Você escolhe um por um; tudo vai para o Diário com o valor anterior e "Reverter" volta exatamente ao que estava. O que reduz a segurança fica de fora.', { goto: 'lab', os: 'win32' }),
    E('reboot-test', 'windows', 'acao', 'raro', 'Teste com reinício (A, B, B, A)', 'Para ajustes que só valem depois de reiniciar: mede o PC reiniciando sem e com eles.', 'Comparar um PC recém-ligado com um ligado há horas engana. Aqui todo boot é medido igual, e só fica o que ganhou nos dois lados.', { goto: 'lab', os: 'win32' }),
    E('power-plan', 'processador', 'acao', 'conhecido', 'Trocar o plano de energia', 'Equilibrado, alto desempenho ou economia, com medição antes e depois.', 'Ajuda em PCs presos no modo economia. Em muitos outros a diferença fica no ruído, e o Nexo mostra isso.', { goto: 'optimize' , os: 'win32' }),
    E('cleanup', 'disco', 'acao', 'conhecido', 'Limpeza segura', 'Temporários antigos, relatórios de falha e de erro, Lixeira.', 'Libera espaço. Não deixa o PC mais rápido por si só, a não ser que o disco esteja quase cheio.', { goto: 'optimize' }),
    E('trim', 'disco', 'acao', 'conhecido', 'Otimizar unidade (TRIM em SSD)', 'O Windows escolhe TRIM para SSD e desfragmentação para HD.', 'Mantém o SSD rápido em escrita. Normalmente o Windows já agenda sozinho.', { goto: 'maintenance', os: 'win32' }),
    E('sfc', 'windows', 'acao', 'conhecido', 'Verificar arquivos do sistema (SFC)', 'Confere e repara arquivos protegidos do Windows.', 'Útil quando há travamentos ou erros estranhos; não acelera um sistema saudável.', { goto: 'maintenance' , os: 'win32' }),
    E('fps-access', 'video', 'acao', 'pouco-conhecido', 'Liberar a medição de FPS', 'Coloca o seu usuário no grupo "Performance Log Users", com a sua permissão.', 'Sem isso, ninguém mede FPS de verdade sem rodar como administrador.', { goto: 'sessions' , os: 'win32' }),
    // ---- Guias com verificação local ----
    E('refresh', 'video', 'guia', 'pouco-conhecido', 'Monitor na taxa certa (Hz)', 'Muita gente compra um monitor de 144 Hz e usa a 60 Hz sem saber.', 'É o ganho de fluidez mais barato que existe: um ajuste em Configurações.', { fact: 'refresh', page: 'display' , os: 'win32' }),
    E('xmp', 'memoria', 'guia', 'pouco-conhecido', 'Perfil XMP/EXPO da memória', 'Memórias vendidas a 3200 ou 6000 MT/s costumam vir de fábrica rodando mais devagar.', 'Ligar o perfil no BIOS é seguro na maioria dos PCs e dá ganho real em jogos. O Nexo só confere; o ajuste é no BIOS.', { fact: 'xmp' }),
    E('dual-channel', 'memoria', 'guia', 'pouco-conhecido', 'Memória em dois canais', 'Um pente só usa metade do caminho até o processador.', 'Dois pentes iguais costumam render bem mais em jogos e, principalmente, em vídeo integrado.', { fact: 'channels' }),
    E('hags', 'video', 'acao', 'pouco-conhecido', 'Agendamento de GPU acelerado por hardware', 'Deixa a placa de vídeo organizar a própria fila de trabalho.', 'Pode reduzir latência em alguns PCs e piorar em outros. Exige reiniciar: o teste com reinício do Raio-X mede antes e depois.', { fact: 'hags', goto: 'lab', os: 'win32' }),
    E('game-mode', 'windows', 'acao', 'conhecido', 'Modo de Jogo do Windows', 'Prioriza o jogo e segura atualizações durante a partida.', 'Vem ligado. Desligado, o Windows pode instalar coisas no meio do jogo. O Raio-X liga e desliga, com reverter.', { fact: 'gameMode', goto: 'lab', os: 'win32' }),
    E('capture', 'video', 'acao', 'pouco-conhecido', 'Gravação em segundo plano (Xbox Game Bar)', '"Gravar o que aconteceu" mantém um vídeo dos últimos minutos o tempo todo.', 'Custa um pouco de GPU e disco o tempo inteiro. Desligue se você não usa (o Raio-X faz isso e guarda o valor anterior).', { fact: 'capture', goto: 'lab', os: 'win32' }),
    E('windowed', 'video', 'acao', 'pouco-conhecido', 'Otimizações para jogos em janela', 'Faz jogos em janela/sem borda funcionarem como tela cheia (menor latência).', 'Ajuda jogos DirectX 10/11 em modo janela. O Raio-X liga (com a taxa variável) e reverte.', { goto: 'lab', os: 'win32' }),
    E('gpu-pref', 'video', 'guia', 'pouco-conhecido', 'Placa de vídeo preferida por jogo', 'Em notebooks com duas placas, garante que o jogo use a dedicada.', 'Um jogo rodando na placa integrada por engano perde metade do desempenho ou mais.', { page: 'graphics' , os: 'win32' }),
    E('startup', 'windows', 'guia', 'conhecido', 'Programas que abrem com o Windows', 'Menos coisas iniciando = PC pronto mais cedo e menos ruído de fundo.', 'O efeito em jogos é pequeno, mas na inicialização é grande. O Nexo lista; você decide no Windows.', { page: 'startup', os: 'win32' }),
    E('free-space', 'disco', 'guia', 'conhecido', 'Deixar espaço livre no SSD', 'SSDs muito cheios ficam mais lentos para gravar.', 'Manter uns 10–15% livres ajuda o próprio controlador do SSD. O Nexo prevê quando o disco vai encher.', { goto: 'analysis' }),
    E('vrr', 'video', 'guia', 'conhecido', 'Taxa variável (G-Sync/FreeSync) e limite de FPS', 'Sincronia sem atraso e quadros mais regulares.', 'Limitar o FPS um pouco abaixo da taxa do monitor costuma deixar o jogo mais suave e mais frio. Ajuste no driver ou no jogo.'),
    E('drivers', 'video', 'guia', 'conhecido', 'Driver de vídeo atualizado', 'Drivers novos trazem correções e ganhos para jogos recentes.', 'Use o app do fabricante. O Nexo não instala drivers.'),
    E('vbs', 'seguranca', 'guia', 'pouco-conhecido', 'Integridade de memória e VBS', 'Proteções do Windows que custam alguns % em certos jogos.', 'A própria Microsoft publicou (2022) que desligar "Integridade de memória" e a "Plataforma de Máquina Virtual" pode melhorar jogos, avisando que reduz a proteção. O Nexo só mostra o estado e leva você à tela; a decisão é sua.', { fact: 'vbs', page: 'coreisolation' , os: 'win32' }),
    // ---- Mitos e boatos ----
    E('myth-registry', 'windows', 'mito', 'conhecido', '"Limpadores de registro"', 'Prometem acelerar o PC apagando entradas do Registro.', 'Não há ganho mensurável, e apagar a entrada errada quebra programas.', { os: 'win32' }),
    E('myth-pagefile', 'memoria', 'mito', 'conhecido', 'Desligar o arquivo de paginação', 'A ideia é "forçar" o uso da memória RAM.', 'O Windows precisa dele para a memória confirmada. Sem ele, jogos e programas podem fechar sozinhos quando a memória aperta.', { os: 'win32' }),
    E('myth-ramclean', 'memoria', 'mito', 'conhecido', '"Liberadores de RAM" e limpeza da memória em espera', 'Esvaziam a memória que o Windows usa como cache.', 'Memória livre parada é memória desperdiçada: o cache existe para carregar as coisas mais rápido. Esvaziar costuma piorar carregamentos.', { os: 'win32' }),
    E('myth-ssd-defrag', 'disco', 'mito', 'conhecido', 'Desfragmentar SSD', 'Rodar desfragmentadores antigos no SSD.', 'Só gasta vida útil. O "Otimizar unidade" do Windows já faz o certo (TRIM).'),
    E('myth-services', 'windows', 'mito', 'conhecido', 'Desligar dezenas de serviços de uma vez', 'Listas da internet com serviços "inúteis" para desligar em massa.', 'Ganho não comprovado e recursos quebrados (busca, impressão, atualizações, Bluetooth), difícil de desfazer. O Raio-X oferece só serviços que dá para desligar sem perder o Windows, um por um, dizendo o que para de funcionar e com reverter.', { os: 'win32' }),
    E('myth-bcdedit', 'processador', 'mito', 'pouco-conhecido', 'bcdedit: useplatformclock, disabledynamictick, tscsyncpolicy', 'Comandos que mudam o relógio do sistema, populares em vídeos de "otimização".', 'Sem evidência de ganho em sistemas modernos; podem piorar a precisão de tempo e a latência. O Nexo não executa bcdedit.', { os: 'win32' }),
    E('myth-timer', 'processador', 'mito', 'pouco-conhecido', 'Ferramentas de "resolução de timer 0,5 ms"', 'Programas que forçam o relógio do Windows ao mínimo o tempo todo.', 'Desde o Windows 10 2004 o efeito é por processo; os jogos já pedem o que precisam. Fica só o gasto extra de energia.', { os: 'win32' }),
    E('myth-nagle', 'rede', 'mito', 'pouco-conhecido', 'Desligar o algoritmo de Nagle (TcpAckFrequency/TCPNoDelay)', 'Ajuste de Registro prometido para "reduzir o ping".', 'Jogos online modernos usam UDP ou já desligam o Nagle na própria conexão. Não muda o ping da sua internet.', { os: 'win32' }),
    E('myth-priority', 'windows', 'mito', 'conhecido', 'Prioridade "Tempo real" ou "Alta" para o jogo', 'Mudar a prioridade no Gerenciador de Tarefas.', 'Ganho mínimo e risco de travar mouse, teclado e áudio, que precisam de tempo de processador.', { os: 'win32' }),
    E('myth-hosts', 'rede', 'mito', 'conhecido', 'Bloquear "telemetria" no arquivo hosts para ganhar desempenho', 'Listas enormes no hosts.', 'Não muda o desempenho e pode quebrar atualizações e lojas.', { os: 'win32' }),
    // ---- O que o Nexo se recusa a fazer ----
    E('block-defender', 'seguranca', 'bloqueado', 'conhecido', 'Desligar o antivírus (Defender)', 'Comum em guias de "debloat".', 'O ganho é pequeno e o risco é enorme. Se um jogo engasga por causa do antivírus, uma exclusão de pasta pontual resolve, e quem decide é você.', { os: 'win32' }),
    E('block-mitigations', 'seguranca', 'bloqueado', 'pouco-conhecido', 'Desligar proteções contra Spectre/Meltdown', 'Recuperam alguns % em cargas específicas.', 'Abre brechas de segurança graves no processador. O Nexo não mexe.'),
    E('block-secureboot', 'seguranca', 'bloqueado', 'conhecido', 'Desligar Secure Boot, assinatura de drivers ou anticheat', 'Aparece em guias de mods e overclock.', 'Quebra jogos com anticheat e abre caminho para malware que inicia antes do Windows.', { os: 'win32' }),
    E('block-oc', 'processador', 'bloqueado', 'conhecido', 'Overclock ou undervolt automáticos', 'Mudar tensões e frequências do hardware.', 'Pode causar instabilidade, corrupção de dados e, no limite, dano. Fora do escopo do Nexo, inclusive no modo extremo.'),
    E('block-msi', 'video', 'bloqueado', 'raro', 'Forçar "MSI mode" de interrupções', 'Ajuste de Registro em dispositivos PCI.', 'Placas atuais já usam; forçar num dispositivo sem suporte pode impedir o Windows de iniciar.', { os: 'win32' }),
    E('block-thermal', 'processador', 'bloqueado', 'raro', 'Desligar limites térmicos e de energia', 'Tirar o freio de temperatura do processador ou da placa.', 'É a proteção que impede o hardware de se danificar. Nunca.'),
    // ---- Linux ----
    E('linux-ppd', 'processador', 'laboratorio', 'conhecido', 'Perfil de energia (power-profiles-daemon)', 'Economia, Equilibrado ou Desempenho, o mesmo seletor do GNOME e do KDE.', 'O laboratório mede os três perfis neste PC e só adota o que provar ganho. Sem root.', { goto: 'lab', os: 'linux', fact: 'ppd' }),
    E('linux-mangohud', 'video', 'guia', 'pouco-conhecido', 'MangoHud para medir FPS', 'O equivalente ao PresentMon no Linux: mede FPS e tempo de quadro de jogos Vulkan e OpenGL (inclusive Proton).', 'Instale pelo gerenciador de pacotes e use a opção de inicialização que o Nexo mostra em Sessões.', { goto: 'sessions', os: 'linux', fact: 'mangohud' }),
    E('linux-gamemode', 'processador', 'guia', 'pouco-conhecido', 'Feral GameMode', 'Ajusta governador, prioridade e agendador enquanto o jogo roda e desfaz ao fechar.', 'Ganho pequeno e variável; útil em CPUs que demoram a acelerar. Ative na Steam com "gamemoderun %command%" e grave sessões antes e depois.', { os: 'linux', fact: 'gamemode' }),
    E('linux-governor', 'processador', 'guia', 'raro', 'Governador do processador', 'schedutil, performance, powersave: como o kernel escolhe a frequência.', 'Com amd-pstate e intel_pstate, o perfil de energia já cuida disso; trocar à mão exige root e raramente ajuda.', { os: 'linux', fact: 'governor' }),
    E('linux-session', 'video', 'guia', 'pouco-conhecido', 'Wayland ou X11', 'A sessão gráfica muda latência, VRR e o que outros apps conseguem ver.', 'No Wayland puro, nenhum app vê a janela ativa de outro; a detecção automática de jogos do Nexo funciona com X11 e com jogos em XWayland (a maioria via Proton).', { os: 'linux', fact: 'session' }),
    E('linux-trim', 'disco', 'acao', 'conhecido', 'TRIM do SSD (fstrim)', 'Avisa o SSD quais blocos estão livres.', 'Muitas distribuições já rodam o fstrim.timer toda semana; o Nexo roda na hora, pedindo a sua senha (pkexec).', { goto: 'maintenance', os: 'linux' }),
    E('linux-startup', 'windows', 'guia', 'conhecido', 'Programas que abrem com a sessão', 'Entradas de ~/.config/autostart e /etc/xdg/autostart.', 'O Nexo lista; desligue nas configurações do seu ambiente (GNOME: Ajustes; KDE: Inicialização automática).', { goto: 'optimize', os: 'linux' }),
    E('linux-mesa', 'video', 'guia', 'conhecido', 'Mesa e drivers de vídeo atualizados', 'Em AMD e Intel o driver vem com o Mesa da distribuição; em NVIDIA, o driver proprietário.', 'Versões novas do Mesa trazem ganhos grandes em jogos recentes. Use o canal de atualizações da sua distribuição.', { os: 'linux' }),
    E('linux-proton', 'video', 'guia', 'conhecido', 'Versão do Proton por jogo', 'Proton Experimental ou GE às vezes rodam melhor que a versão padrão.', 'Teste por jogo (Propriedades → Compatibilidade) e compare sessões gravadas: o Nexo mostra a diferença de FPS e de 1% baixo.', { os: 'linux' }),
    E('linux-myth-swappiness', 'memoria', 'mito', 'conhecido', 'Zerar o swappiness "para o PC voar"', 'Ajuste de sysctl repetido em guias de otimização.', 'Com memória sobrando não muda nada; com memória curta, pode travar o sistema em vez de usar a troca. O Nexo não altera.', { os: 'linux' }),
    E('linux-block-mitigations', 'seguranca', 'bloqueado', 'pouco-conhecido', 'mitigations=off no kernel', 'Desliga proteções contra falhas de processador para ganhar alguns %.', 'Abre brechas de segurança graves. O Nexo não mexe na linha de comando do kernel.', { os: 'linux' })
  ];

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const list = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);

  /** Leituras do sistema → achados. Estados: ok | atencao | info | desconhecido. */
  function evaluateFacts(facts) {
    const out = {};
    if (facts?.platform === 'linux') {
      out.ppd = facts.ppd ? { state: 'info', text: `Perfil ativo: ${({ 'power-saver': 'Economia de energia', balanced: 'Equilibrado', performance: 'Desempenho' })[facts.powerProfile] || facts.powerProfile || 'desconhecido'}.` } : { state: 'atencao', text: 'O power-profiles-daemon não está rodando; sem ele o Nexo não troca perfis (instale ou ative o serviço).' };
      out.mangohud = facts.mangohud ? { state: 'ok', text: 'MangoHud instalado.' } : { state: 'atencao', text: 'MangoHud não encontrado: sem ele não há FPS nas sessões.' };
      out.gamemode = facts.gamemode ? { state: 'ok', text: 'GameMode instalado.' } : { state: 'info', text: 'GameMode não instalado.' };
      if (facts.governor) out.governor = { state: 'info', text: `Governador atual: ${facts.governor}.` };
      if (facts.session) out.session = { state: facts.session === 'wayland' ? 'info' : 'ok', text: facts.session === 'wayland' ? 'Sessão Wayland: a detecção automática de jogos depende do XWayland.' : `Sessão ${facts.session}.` };
      return out;
    }
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
      const hz = (display) => `${display.current} Hz`;
      out.refresh = low
        ? { state: 'atencao', text: `${low.name} está a ${low.current} Hz e a placa informa suporte até ${low.max} Hz. Se o seu monitor for de alta taxa, ajuste em Configurações > Tela > Avançado.` }
        : { state: 'info', text: `Taxa atual: ${displays.map(hz).join(', ')}. Confira se é a máxima do seu monitor.` };
    }
    out.hags = facts.hags === 2 ? { state: 'info', text: 'Ligado neste PC.' } : facts.hags === 1 ? { state: 'info', text: 'Desligado neste PC.' } : { state: 'desconhecido', text: 'Não exposto pelo driver (ou não suportado).' };
    out.gameMode = facts.gameMode === 0 ? { state: 'atencao', text: 'Desligado neste PC.' } : { state: 'ok', text: 'Ligado (padrão).' };
    // "Gravar o que aconteceu" (HistoricalCaptureEnabled) é o que grava o tempo todo; sem o valor no Registro, vale o padrão do Windows (desligado).
    out.capture = facts.historical === 1 ? { state: 'atencao', text: '"Gravar o que aconteceu" está ligado: o Windows grava os últimos minutos o tempo todo.' }
      : facts.capture === 0 ? { state: 'ok', text: 'Captura de jogos desligada.' }
      : { state: 'ok', text: '"Gravar o que aconteceu" está desligado (padrão do Windows). Só grava quando você pede.' };
    if (facts.vbs !== null && facts.vbs !== undefined) out.vbs = facts.vbs === 2 ? { state: 'info', text: `VBS em execução${facts.hvci ? ', com Integridade de memória ligada' : ''}.` } : { state: 'info', text: 'VBS não está em execução.' };
    return out;
  }

  const forPlatform = (platform) => ITEMS.filter((item) => !item.os || item.os === platform).sort((a, b) => Number(Boolean(b.os)) - Number(Boolean(a.os)));
  const counts = (platform) => (platform ? forPlatform(platform) : ITEMS).reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
  return { ITEMS, STATUS, FAME, AREA, evaluateFacts, counts, forPlatform, get: (id) => ITEMS.find((item) => item.id === id) || null };
});
