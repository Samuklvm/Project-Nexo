/*
 * Espaço de ajustes do laboratório (Windows). Catálogo FECHADO: o motor só aplica o que está aqui, e o adaptador do
 * Windows ainda corta tudo o que o próprio PC não expõe ou não aceita (faixa e índices lidos do powercfg /qh).
 *
 * Cada ajuste vive num plano de energia: no laboratório, num CLONE temporário que é apagado no fim. Por isso todos são
 * reversíveis na hora, sem reiniciar. GUIDs conferidos na lista oficial de opções de gerenciamento de energia do
 * processador (Microsoft Learn) e nos subgrupos de disco, NVMe e PCI Express do Windows.
 *
 * values: na ordem do mais promissor para o menos (o motor testa primeiro o começo da lista).
 * affects: quais testes medem o efeito (single, multi, burst, latency, disk). Sem teste que meça, o ajuste fica de fora.
 * risk: baixo | moderado | alto. "alto" só entra quando a pessoa escolhe "Tudo, inclusive alto".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoLabSpace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PROC = '54533251-82be-4824-96c1-47b60b740d00';
  const DISK = '0012ee47-9041-4b5d-9b77-535fba8b1442';
  const PCIE = '501a4d13-42af-4429-9fd1-a8218c268e20';

  const GROUPS = {
    desempenho: { label: 'Motor de desempenho', hint: 'Como o Windows sobe e desce a frequência do processador.' },
    turbo: { label: 'Turbo', hint: 'Quando e quanto o processador passa da frequência base.' },
    nucleos: { label: 'Estacionamento de núcleos', hint: 'Quantos núcleos ficam acordados e quão rápido eles voltam.' },
    resposta: { label: 'Sensibilidade à latência', hint: 'O que o Windows faz quando um programa avisa que precisa de resposta rápida.' },
    ocioso: { label: 'Estados ociosos (C-states)', hint: 'O quanto o processador "dorme" entre uma tarefa e outra; dormir fundo economiza, mas demora para acordar.' },
    hibrido: { label: 'Núcleos híbridos (P/E)', hint: 'Processadores com núcleos de desempenho e de eficiência: quem recebe cada tarefa.' },
    termico: { label: 'Térmico', hint: 'O que vem primeiro quando esquenta: ventilação ou redução de velocidade.' },
    armazenamento: { label: 'Armazenamento (SATA e NVMe)', hint: 'Economia de energia dos discos: entrar em repouso economiza, mas a primeira leitura demora mais.' },
    barramento: { label: 'PCI Express', hint: 'Economia de energia do barramento onde ficam o SSD NVMe e a placa de vídeo.' },
    rede: { label: 'Rede', hint: 'Economia de energia do adaptador sem fio, medida pelo tempo de resposta do seu roteador.' }
  };

  const CPU = ['single', 'multi', 'burst', 'frames'];
  const RESP = ['burst', 'latency', 'frames', 'single'];
  const IDLE = ['latency', 'timer', 'frames', 'burst', 'memory'];
  const AMD_SLIDER = 'c763b4ec-0e50-4b6b-9bed-2b92a6ee884e';
  const WIFI = '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1';
  const BOOST = { 0: 'Desativado', 1: 'Ativado', 2: 'Agressivo', 3: 'Eficiente', 4: 'Eficiente agressivo', 5: 'Agressivo no garantido', 6: 'Eficiente agressivo no garantido' };
  const INC = { 0: 'Ideal', 1: 'Degrau único', 2: 'Foguete (direto ao máximo)', 3: 'Ideal agressiva' };
  const DEC = { 0: 'Ideal', 1: 'Degrau único', 2: 'Queda total' };
  const PARK = { 0: 'Ideal', 1: 'Um núcleo por vez', 2: 'Todos de uma vez' };
  const ONOFF = { 0: 'Desligado', 1: 'Ligado' };
  const SCHED = { 0: 'Todos os núcleos', 1: 'Núcleos de desempenho', 2: 'Preferir desempenho', 3: 'Núcleos de eficiência', 4: 'Preferir eficiência', 5: 'Automático' };
  const HETERO = { 0: 'Política 0', 1: 'Política 1', 2: 'Política 2', 3: 'Política 3', 4: 'Política 4' };

  // Atalho: ajuste do processador por GUID.
  const p = (id, group, setting, guid, label, values, extra = {}) => ({ id, group, sub: 'SUB_PROCESSOR', subGuid: PROC, setting, guid, label, values, risk: 'baixo', novelty: 'raro', hidden: true, affects: CPU, ...extra });

  const SPACE = [
    /* Os sete originais usam o apelido do powercfg (SUB_PROCESSOR/PERFEPP...): compatível com versões antigas. */
    { id: 'perfepp', group: 'desempenho', alias: true, sub: 'SUB_PROCESSOR', subGuid: PROC, setting: 'PERFEPP', guid: '36687f9e-e3a5-4dbf-b1dc-15eb381c6863', label: 'Preferência de desempenho energético (EPP)', values: [0, 5, 10, 15, 20, 25, 33, 40, 50, 60, 75, 85], unit: '%', risk: 'baixo', novelty: 'pouco-conhecido', hidden: true, affects: [...CPU, 'memory'],
      what: 'Diz ao processador o quanto priorizar desempenho (0) ou economia (100) quando ele mesmo escolhe a frequência.' },
    { id: 'boostmode', group: 'turbo', alias: true, sub: 'SUB_PROCESSOR', subGuid: PROC, setting: 'PERFBOOSTMODE', guid: 'be337238-0d82-4146-a960-4f3749d470c7', label: 'Modo de aceleração (boost)', values: [2, 5, 4, 6, 3, 1, 0], risk: 'moderado', novelty: 'pouco-conhecido', hidden: true, affects: CPU, names: BOOST,
      what: 'Como o processador usa o turbo acima da frequência base. "Agressivo" pode aquecer mais.' },
    { id: 'minstate', group: 'desempenho', alias: true, sub: 'SUB_PROCESSOR', subGuid: PROC, setting: 'PROCTHROTTLEMIN', guid: '893dee8e-2bef-41e0-89c6-b55d0929964c', label: 'Estado mínimo do processador', values: [100, 90, 75, 60, 50, 40, 25, 10, 5, 0], unit: '%', risk: 'baixo', novelty: 'conhecido', hidden: false, affects: [...RESP, 'timer'],
      what: 'O piso de desempenho do processador. Um piso alto evita a demora para acelerar, ao custo de mais consumo parado.' },
    { id: 'mincores', group: 'nucleos', alias: true, sub: 'SUB_PROCESSOR', subGuid: PROC, setting: 'CPMINCORES', guid: '0cc5b647-c1df-4637-891a-dec35c318583', label: 'Mínimo de núcleos não estacionados', values: [100, 90, 75, 60, 50, 40, 25, 10, 0], unit: '%', risk: 'baixo', novelty: 'pouco-conhecido', hidden: true, affects: ['multi', 'burst', 'latency'],
      what: 'Quantos núcleos ficam sempre acordados. O "estacionamento" de núcleos economiza energia, mas pode atrasar picos de carga.' },
    { id: 'incpol', group: 'desempenho', alias: true, sub: 'SUB_PROCESSOR', subGuid: PROC, setting: 'PERFINCPOL', guid: '465e1f50-b610-473a-ab58-00d1077dc418', label: 'Política de aumento de desempenho', values: [2, 3, 1, 0], risk: 'baixo', novelty: 'pouco-conhecido', hidden: true, affects: RESP, names: INC,
      what: 'Como o Windows sobe a frequência quando a carga aumenta: em degraus ou direto ao máximo ("foguete").' },
    { id: 'boostpol', group: 'turbo', alias: true, sub: 'SUB_PROCESSOR', subGuid: PROC, setting: 'PERFBOOSTPOL', guid: '45bcc044-d885-43e2-8605-ee0ec6e96b59', label: 'Política de turbo', values: [100, 90, 80, 70, 60, 50, 40, 20, 0], unit: '%', risk: 'baixo', novelty: 'pouco-conhecido', hidden: true, affects: CPU,
      what: 'O quanto o Windows insiste no turbo em processadores que dependem dele.' },
    { id: 'cooling', group: 'termico', alias: true, sub: 'SUB_PROCESSOR', subGuid: PROC, setting: 'SYSCOOLPOL', guid: '94d3a615-a899-4ac5-ae2b-e4d8f634367f', label: 'Política de resfriamento', values: [1, 0], risk: 'baixo', novelty: 'conhecido', hidden: false, affects: ['multi', 'single'],
      names: { 0: 'Passiva (reduz a velocidade antes)', 1: 'Ativa (acelera ventoinhas antes)' },
      what: 'Ao esquentar, o Windows primeiro reduz a velocidade (passiva) ou primeiro aumenta a ventilação (ativa).' },

    /* Motor de desempenho (P-states) */
    p('maxstate', 'desempenho', 'PROCTHROTTLEMAX', 'bc5038f7-23e0-4960-96da-33abaf5935ec', 'Estado máximo do processador', [100, 99, 98, 95, 90, 85, 80, 70], { unit: '%', novelty: 'conhecido', hidden: false,
      what: 'O teto de desempenho. Em muitos processadores, 99% desliga o turbo: menos calor, menos velocidade máxima.' }),
    p('decpol', 'desempenho', 'PERFDECPOL', '40fbefc7-2e9d-4d25-a185-0cfd8574bac6', 'Política de redução de desempenho', [1, 0, 2], { names: DEC, affects: RESP,
      what: 'Como a frequência cai quando a carga diminui. Cair devagar ("degrau único") mantém o processador pronto para o próximo pico.' }),
    p('incthr', 'desempenho', 'PERFINCTHRESHOLD', '06cadf0e-64ed-448a-8927-ce7bf90eb35d', 'Limite para aumentar o desempenho', [10, 5, 15, 20, 30, 40, 50, 60, 75, 90], { unit: '%', affects: RESP,
      what: 'A partir de quanto uso o Windows decide subir a frequência. Mais baixo = sobe antes.' }),
    p('decthr', 'desempenho', 'PERFDECTHRESHOLD', '12a0ab44-fe28-4fa9-b3bd-4b64f44960a6', 'Limite para reduzir o desempenho', [5, 10, 15, 20, 30, 40, 50, 60], { unit: '%', affects: RESP,
      what: 'Abaixo de quanto uso o Windows desce a frequência. Mais baixo = demora mais para desacelerar.' }),
    p('inctime', 'desempenho', 'PERFINCTIME', '984cf492-3bed-4488-a8f9-4286c97bf5aa', 'Tempo para aumentar o desempenho', [1, 2, 3, 4, 5, 8], { unit: ' intervalo(s)', affects: RESP,
      what: 'Quantas checagens seguidas de carga alta até acelerar. 1 = reage na primeira.' }),
    p('dectime', 'desempenho', 'PERFDECTIME', 'd8edeb9b-95cf-4f95-a73c-b061973693c8', 'Tempo para reduzir o desempenho', [10, 5, 15, 20, 8, 3, 2, 1], { unit: ' intervalo(s)', affects: RESP,
      what: 'Quantas checagens seguidas de carga baixa até desacelerar. Mais = segura a frequência entre um pico e outro.' }),
    p('perfcheck', 'desempenho', 'PERFCHECK', '4d2b0152-7d5c-498b-88e2-34345392a2c5', 'Intervalo de checagem de desempenho', [5, 10, 1, 2, 8, 15, 20, 30, 50, 100], { unit: ' ms', max: 5000, affects: RESP,
      what: 'De quanto em quanto tempo o Windows reavalia a frequência. Mais curto = reage mais rápido, com um pouco mais de trabalho do sistema.' }),
    p('perfhistory', 'desempenho', 'PERFHISTORY', '7d24baa7-0b84-480f-840c-1b0743c00f5f', 'Histórico de desempenho', [1, 2, 3, 4, 6, 8, 16, 32], { unit: ' amostra(s)', max: 128, affects: RESP,
      what: 'Quantas checagens o Windows usa para decidir. Menos histórico = decisões mais rápidas e mais nervosas.' }),
    p('autonomous', 'desempenho', 'PERFAUTONOMOUS', '8baa4a8a-14c6-4451-8e8b-14bdbd197537', 'Modo autônomo do processador (CPPC)', [1, 0], { names: { 0: 'O Windows decide a frequência', 1: 'O processador decide sozinho' }, novelty: 'pouco-conhecido',
      what: 'Quem escolhe a frequência a cada instante: o próprio processador (mais rápido de reagir) ou o Windows.' }),
    p('autowindow', 'desempenho', 'PERFAUTONOMOUSWINDOW', 'cfeda3d0-7697-4566-a922-a9086cd49dfa', 'Janela de atividade do modo autônomo', [1000, 500, 2000, 5000, 10000, 20000, 30000, 50000, 100000], { unit: ' µs', max: 1270000, affects: RESP,
      what: 'No modo autônomo, o período que o processador olha para decidir. Mais curto = reage mais rápido.' }),
    p('dutycycling', 'desempenho', 'PERFDUTYCYCLING', '4e4450b3-6179-4e91-b8f1-5bb9938f81a1', 'Ciclo de trabalho do processador', [0, 1], { names: ONOFF,
      what: 'Liga e desliga o relógio do processador em ciclos curtos para economizar. Desligado evita essa intermitência.' }),
    p('throttling', 'desempenho', 'THROTTLING', '3b04d4fd-1cc7-4f23-ab1c-d1337819c4bb', 'Permitir estados de limitação (T-states)', [0, 1], { names: { 0: 'Não permitir', 1: 'Permitir' }, risk: 'moderado',
      what: 'Estados antigos de limitação de velocidade. Sem eles, o processador só reduz pelo jeito moderno (ou pelo calor, que continua protegido).' }),

    /* Estacionamento de núcleos */
    p('maxcores', 'nucleos', 'CPMAXCORES', 'ea062031-0e34-4ff1-9b6d-eb1059334028', 'Máximo de núcleos não estacionados', [100, 90, 75, 60, 50], { unit: '%', affects: ['multi', 'burst'],
      what: 'O limite de núcleos acordados ao mesmo tempo. Abaixo de 100% sobra calor e energia para os outros acelerarem mais.' }),
    p('cpconcurrency', 'nucleos', 'CPCONCURRENCY', '2430ab6f-a520-44a2-9601-f7f23b5134b1', 'Limite de concorrência do estacionamento', [50, 40, 60, 70, 75, 80, 85, 90, 95, 98], { unit: '%', affects: ['multi', 'burst', 'latency'],
      what: 'Quanto de uso simultâneo faz o Windows acordar mais núcleos. Mais baixo = acorda antes.' }),
    p('cpheadroom', 'nucleos', 'CPHEADROOM', 'f735a673-2066-4f80-a0c5-ddee0cf1bf5d', 'Folga de concorrência do estacionamento', [10, 0, 5, 15, 25, 35, 50, 75], { unit: '%', affects: ['multi', 'burst', 'latency'],
      what: 'A margem de núcleos acordados além do necessário. Mais folga = picos encontram núcleo pronto.' }),
    p('cpdistribution', 'nucleos', 'CPDISTRIBUTION', '4bdaf4e9-d103-46d7-a5f0-6280121616ef', 'Limite de distribuição do estacionamento', [50, 40, 60, 75, 85, 90, 95], { unit: '%', affects: ['multi', 'burst'],
      what: 'Quando a carga é espalhada entre os núcleos acordados antes de acordar outros.' }),
    p('cpoverutil', 'nucleos', 'CPOVERUTIL', '943c8cb6-6f93-4227-ad87-e9a3feec08d1', 'Limite de sobreuso do estacionamento', [40, 30, 50, 60, 70, 85, 95], { unit: '%', affects: ['multi', 'burst'],
      what: 'A partir de quanto uso um núcleo é considerado sobrecarregado (e outro é acordado para ajudar).' }),
    p('cpinctime', 'nucleos', 'CPINCREASETIME', '2ddd5a84-5a71-437e-912a-db0b8c788732', 'Tempo para acordar núcleos', [1, 2, 3, 4, 6], { unit: ' intervalo(s)', affects: ['multi', 'burst', 'latency'],
      what: 'Quantas checagens até acordar mais núcleos. 1 = acorda na primeira.' }),
    p('cpdectime', 'nucleos', 'CPDECREASETIME', 'dfd10d17-d5eb-45dd-877a-9a34ddd15c82', 'Tempo para estacionar núcleos', [20, 30, 15, 10, 5, 2, 1], { unit: ' intervalo(s)', affects: ['multi', 'burst', 'latency'],
      what: 'Quantas checagens até voltar a estacionar. Mais = núcleos ficam acordados entre um pico e outro.' }),
    p('cpincpol', 'nucleos', 'CPINCREASEPOL', 'c7be0679-2817-4d69-9d02-519a537ed0c6', 'Política para acordar núcleos', [2, 0, 1], { names: PARK, affects: ['multi', 'burst'],
      what: 'Quantos núcleos acordam de cada vez quando a carga sobe.' }),
    p('cpdecpol', 'nucleos', 'CPDECREASEPOL', '71021b41-c749-4d21-be74-a00f335d582b', 'Política para estacionar núcleos', [1, 0, 2], { names: PARK, affects: ['multi', 'burst'],
      what: 'Quantos núcleos voltam a dormir de cada vez quando a carga cai.' }),
    p('distributeutil', 'nucleos', 'DISTRIBUTEUTIL', 'e0007330-f589-42ed-a401-5ddb10e785d3', 'Distribuição de uso entre núcleos', [0, 1], { names: ONOFF, affects: ['multi', 'burst'],
      what: 'Se o Windows considera o uso distribuído entre núcleos ao decidir estacionar.' }),

    /* Sensibilidade à latência */
    p('latperf', 'resposta', 'LATENCYHINTPERF', '619b7505-003b-4e82-b7a6-4dd29c300971', 'Desempenho com aviso de latência', [100, 99, 95, 90, 80, 75, 60, 50], { unit: '%', affects: RESP,
      what: 'Quando um programa avisa que precisa de resposta rápida (jogo, áudio, clique), o desempenho que o Windows garante.' }),
    p('latunpark', 'resposta', 'LATENCYHINTUNPARK', '616cdaa5-695e-4545-97ad-97dc2d1bdd88', 'Núcleos acordados com aviso de latência', [100, 75, 50, 25, 10], { unit: '%', affects: ['burst', 'latency', 'multi'],
      what: 'Quantos núcleos o Windows acorda quando um programa pede resposta rápida.' }),

    /* Estados ociosos */
    p('idledisable', 'ocioso', 'IDLEDISABLE', '5d76a2ca-e8c0-402f-a133-2158492d58ad', 'Desativar os estados ociosos', [1, 0], { names: { 0: 'Estados ociosos ligados', 1: 'Processador nunca dorme' }, risk: 'alto', affects: IDLE,
      what: 'Impede o processador de dormir entre tarefas: a menor latência possível, com muito mais calor e consumo parado. Só em "Tudo, inclusive alto".' }),
    p('idlestatemax', 'ocioso', 'IDLESTATEMAX', '9943e905-9a30-4ec1-9b99-44dd3b76f7a2', 'Sono mais profundo permitido', [1, 2, 3], { names: { 0: 'Sem limite', 1: 'Só o sono leve (C1)', 2: 'Até C2', 3: 'Até C3' }, risk: 'moderado', affects: IDLE,
      what: 'Limita o quão fundo o processador dorme. Sono leve acorda mais rápido; sono fundo economiza mais.' }),
    p('idlepromote', 'ocioso', 'IDLEPROMOTE', '7b224883-b3cc-4d79-819f-8374152cbe7c', 'Limite para aprofundar o sono', [90, 95, 80, 70, 60, 50, 40, 30, 20], { unit: '%', affects: IDLE,
      what: 'Quanto tempo ocioso é preciso para o processador ir para um sono mais fundo. Mais alto = vai menos fundo.' }),
    p('idledemote', 'ocioso', 'IDLEDEMOTE', '4b92d758-5a24-4851-a470-815d78aee119', 'Limite para aliviar o sono', [60, 80, 50, 40, 30, 20, 10], { unit: '%', affects: IDLE,
      what: 'Quando o processador volta a um sono mais leve. Mais alto = volta antes.' }),
    p('idlecheck', 'ocioso', 'IDLECHECK', 'c4581c31-89ab-4597-8e2b-9c9cab440e6b', 'Intervalo de checagem do ocioso', [5000, 10000, 500, 1000, 2000, 20000, 30000, 50000], { unit: ' µs', max: 200000, affects: IDLE,
      what: 'De quanto em quanto tempo o Windows reavalia o sono do processador.' }),
    p('idlescaling', 'ocioso', 'IDLESCALING', '6c2993b0-8f48-481f-bcc6-00dd2742aa06', 'Escala dos limites de ocioso', [0, 1], { names: ONOFF, affects: IDLE,
      what: 'Se os limites de sono mudam conforme a carga. Desligado deixa o comportamento mais previsível.' }),

    p('cpperf', 'nucleos', 'CPPERF', '447235c7-6a8d-4cc0-8e24-9eaf70b96e2b', 'Desempenho dos núcleos estacionados', [2, 0, 1], { names: { 0: 'Sem preferência', 1: 'Estado de desempenho mais fundo', 2: 'Estado de desempenho mais leve' }, affects: ['multi', 'burst', 'latency', 'frames'],
      what: 'Em que frequência um núcleo fica enquanto está estacionado. Mais leve = volta ao trabalho mais rápido.' }),
    { id: 'amdslider', group: 'desempenho', sub: 'SUB_AMDSLIDER', subGuid: AMD_SLIDER, setting: 'AMDSLIDER', guid: '7ec1751b-60ed-4588-afb5-9819d3d77d90', label: 'Controle deslizante de energia da AMD', values: [3, 2, 1, 0], risk: 'baixo', novelty: 'pouco-conhecido', hidden: false, affects: CPU,
      names: { 0: 'Economia de bateria', 1: 'Melhor bateria', 2: 'Melhor desempenho', 3: 'Máximo desempenho' },
      what: 'Em notebooks com processador AMD, muda de uma vez os limites de potência e temperatura que a AMD definiu para cada modo.' },

    /* Núcleos híbridos (Intel 12ª geração em diante e afins): só aparecem quando o PC tem dois tipos de núcleo. */
    p('perfepp1', 'hibrido', 'PERFEPP1', '36687f9e-e3a5-4dbf-b1dc-15eb381c6864', 'EPP dos núcleos de eficiência', [0, 10, 25, 33, 50, 60, 75, 85], { unit: '%', hybrid: true,
      what: 'A preferência de desempenho energético só dos núcleos de eficiência (E-cores).' }),
    p('minstate1', 'hibrido', 'PROCTHROTTLEMIN1', '893dee8e-2bef-41e0-89c6-b55d0929964d', 'Estado mínimo dos núcleos de eficiência', [100, 75, 50, 25, 5, 0], { unit: '%', hybrid: true, affects: RESP,
      what: 'O piso de desempenho dos E-cores.' }),
    p('maxstate1', 'hibrido', 'PROCTHROTTLEMAX1', 'bc5038f7-23e0-4960-96da-33abaf5935ed', 'Estado máximo dos núcleos de eficiência', [100, 90, 80, 60, 50], { unit: '%', hybrid: true,
      what: 'O teto dos E-cores. Baixar pode deixar mais energia e calor para os núcleos de desempenho.' }),
    p('incpol1', 'hibrido', 'PERFINCPOL1', '465e1f50-b610-473a-ab58-00d1077dc419', 'Aumento de desempenho dos núcleos de eficiência', [2, 3, 1, 0], { names: INC, hybrid: true, affects: RESP,
      what: 'Como os E-cores sobem a frequência.' }),
    p('decpol1', 'hibrido', 'PERFDECPOL1', '40fbefc7-2e9d-4d25-a185-0cfd8574bac7', 'Redução de desempenho dos núcleos de eficiência', [1, 0, 2], { names: DEC, hybrid: true, affects: RESP,
      what: 'Como os E-cores descem a frequência.' }),
    p('incthr1', 'hibrido', 'PERFINCTHRESHOLD1', '06cadf0e-64ed-448a-8927-ce7bf90eb35e', 'Limite de aumento dos núcleos de eficiência', [10, 5, 20, 30, 60, 90], { unit: '%', hybrid: true, affects: RESP,
      what: 'A partir de quanto uso os E-cores aceleram.' }),
    p('decthr1', 'hibrido', 'PERFDECTHRESHOLD1', '12a0ab44-fe28-4fa9-b3bd-4b64f44960a7', 'Limite de redução dos núcleos de eficiência', [5, 10, 20, 40], { unit: '%', hybrid: true, affects: RESP,
      what: 'Abaixo de quanto uso os E-cores desaceleram.' }),
    p('inctime1', 'hibrido', 'PERFINCTIME1', '984cf492-3bed-4488-a8f9-4286c97bf5ab', 'Tempo de aumento dos núcleos de eficiência', [1, 2, 3, 5], { unit: ' intervalo(s)', hybrid: true, affects: RESP,
      what: 'Checagens até os E-cores acelerarem.' }),
    p('dectime1', 'hibrido', 'PERFDECTIME1', 'd8edeb9b-95cf-4f95-a73c-b061973693c9', 'Tempo de redução dos núcleos de eficiência', [10, 5, 3, 1], { unit: ' intervalo(s)', hybrid: true, affects: RESP,
      what: 'Checagens até os E-cores desacelerarem.' }),
    p('mincores1', 'hibrido', 'CPMINCORES1', '0cc5b647-c1df-4637-891a-dec35c318584', 'Mínimo de núcleos de eficiência acordados', [100, 75, 50, 25, 0], { unit: '%', hybrid: true, affects: ['multi', 'burst', 'latency'],
      what: 'Quantos E-cores ficam sempre acordados.' }),
    p('maxcores1', 'hibrido', 'CPMAXCORES1', 'ea062031-0e34-4ff1-9b6d-eb1059334029', 'Máximo de núcleos de eficiência acordados', [100, 75, 50, 25, 0], { unit: '%', hybrid: true, affects: ['multi', 'burst'],
      what: 'O limite de E-cores acordados. 0% empurra quase tudo para os núcleos de desempenho.' }),
    p('latperf1', 'hibrido', 'LATENCYHINTPERF1', '619b7505-003b-4e82-b7a6-4dd29c300972', 'Desempenho com aviso de latência (eficiência)', [100, 90, 75, 50], { unit: '%', hybrid: true, affects: RESP,
      what: 'O desempenho garantido nos E-cores quando um programa pede resposta rápida.' }),
    p('latunpark1', 'hibrido', 'LATENCYHINTUNPARK1', '616cdaa5-695e-4545-97ad-97dc2d1bdd89', 'E-cores acordados com aviso de latência', [100, 50, 25, 10], { unit: '%', hybrid: true, affects: ['burst', 'latency'],
      what: 'Quantos E-cores acordam quando um programa pede resposta rápida.' }),
    p('cpperf1', 'hibrido', 'CPPERF1', '447235c7-6a8d-4cc0-8e24-9eaf70b96e2c', 'Desempenho dos E-cores estacionados', [2, 0, 1], { names: { 0: 'Sem preferência', 1: 'Estado de desempenho mais fundo', 2: 'Estado de desempenho mais leve' }, hybrid: true, affects: ['multi', 'burst', 'latency'],
      what: 'Em que frequência um E-core estacionado fica esperando.' }),
    p('heteroinctime', 'hibrido', 'HETEROINCREASETIME', '4009efa7-e72d-4cba-9edf-91084ea8cbc3', 'Tempo para acordar mais E-cores', [1, 2, 3, 5, 8], { unit: ' intervalo(s)', hybrid: true, affects: ['multi', 'burst', 'frames'],
      what: 'Quantas checagens de carga alta até o Windows acordar mais núcleos de eficiência.' }),
    p('heterodectime', 'hibrido', 'HETERODECREASETIME', '7f2492b6-60b1-45e5-ae55-773f8cd5caec', 'Tempo para estacionar E-cores', [10, 5, 3, 1], { unit: ' intervalo(s)', hybrid: true, affects: ['multi', 'burst', 'frames'],
      what: 'Quantas checagens de carga baixa até o Windows estacionar núcleos de eficiência.' }),
    p('heteropolicy', 'hibrido', 'HETEROPOLICY', '7f2f5cfa-f10c-4823-b5e1-e93ae85f46b5', 'Política heterogênea em vigor', [0, 1, 2, 3, 4], { names: HETERO, hybrid: true, novelty: 'raro',
      what: 'Qual conjunto de regras o Windows usa para dividir trabalho entre P-cores e E-cores.' }),
    p('schedpolicy', 'hibrido', 'SCHEDPOLICY', '93b8b6dc-0698-4d1c-9ee4-0644e900c85d', 'Agendamento de tarefas longas (P/E)', [2, 1, 5, 0, 4, 3], { names: SCHED, hybrid: true,
      what: 'Onde o Windows coloca as tarefas que rodam por muito tempo: nos núcleos de desempenho, nos de eficiência ou em todos.' }),
    p('shortschedpolicy', 'hibrido', 'SHORTSCHEDPOLICY', 'bae08b81-2d5e-4688-ad6a-13243356654b', 'Agendamento de tarefas curtas (P/E)', [2, 1, 5, 0, 4, 3], { names: SCHED, hybrid: true, affects: RESP,
      what: 'Onde o Windows coloca as tarefas rápidas (cliques, respostas curtas).' }),
    p('class1initial', 'hibrido', 'HETEROCLASS1INITIALPERF', '1facfc65-a930-4bc5-9f38-504ec097bbc0', 'Desempenho inicial dos E-cores ao acordar', [100, 75, 50, 25], { unit: '%', hybrid: true, affects: RESP,
      what: 'Com que frequência um E-core começa quando acorda.' }),
    p('class0floor', 'hibrido', 'HETEROCLASS0FLOORPERF', 'fddc842b-8364-4edc-94cf-c17f60de1c80', 'Piso dos P-cores com E-cores ativos', [100, 75, 50, 25, 0], { unit: '%', hybrid: true, affects: RESP,
      what: 'O desempenho mínimo dos núcleos de desempenho enquanto os de eficiência trabalham.' }),

    /* Armazenamento */
    { id: 'ahcilpm', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'AHCILPM', guid: '0b2d69d7-a2a1-449c-9680-f91c70521c60', label: 'Gerenciamento de energia do link AHCI (SATA)', values: [0, 1, 2, 3, 4], risk: 'baixo', novelty: 'raro', hidden: true, affects: ['disk'],
      names: { 0: 'Ativo (sem economia)', 1: 'HIPM', 2: 'DIPM', 3: 'HIPM+DIPM', 4: 'Mais baixo' },
      what: 'Se o cabo SATA entra em repouso entre leituras. Sem repouso, a primeira leitura depois de uma pausa responde mais rápido.' },
    { id: 'nvmeidle', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'NVMEIDLE', guid: 'd639518a-e56d-4345-8af2-b9f32fb26109', label: 'Tempo até o NVMe entrar em repouso (principal)', values: [0, 50, 100, 200, 500, 1000, 2000, 5000], unit: ' ms', max: 60000, risk: 'baixo', novelty: 'raro', hidden: true, affects: ['disk'],
      what: 'Quanto tempo parado até o SSD NVMe entrar no estado de economia. 0 = nunca entra.' },
    { id: 'nvmeidle2', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'NVMEIDLE2', guid: 'd3d55efd-c1ff-424e-9dc3-441be7833010', label: 'Tempo até o NVMe entrar em repouso (secundário)', values: [0, 500, 1000, 2000, 5000, 10000], unit: ' ms', max: 600000, risk: 'baixo', novelty: 'raro', hidden: true, affects: ['disk'],
      what: 'O segundo degrau de economia do NVMe, mais profundo e mais lento para acordar.' },
    { id: 'nvmetol', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'NVMETOLERANCE', guid: 'fc95af4d-40e7-4b6d-835a-56d131dbc80e', label: 'Latência tolerada pelo NVMe (principal)', values: [0, 1, 5, 10, 15, 50, 100], unit: ' ms', max: 1000, risk: 'baixo', novelty: 'raro', hidden: true, affects: ['disk'],
      what: 'Quanto atraso o Windows aceita para o SSD acordar. 0 = só estados que acordam na hora.' },
    { id: 'nvmetol2', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'NVMETOLERANCE2', guid: 'dbc9e238-6de9-49e3-92cd-8c2b4946b472', label: 'Latência tolerada pelo NVMe (secundário)', values: [0, 1, 5, 15, 50, 100], unit: ' ms', max: 1000, risk: 'baixo', novelty: 'raro', hidden: true, affects: ['disk'],
      what: 'O mesmo limite, para o segundo degrau de economia.' },
    { id: 'nvmenoppme', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'NVMENOPPME', guid: 'fc7372b6-ab2d-43ee-8797-15e9841f2cca', label: 'Economia de energia não operacional do NVMe', values: [0, 1], names: ONOFF, risk: 'baixo', novelty: 'raro', hidden: true, affects: ['disk'],
      what: 'Deixa o SSD desligar partes internas quando parado. Desligado = sempre pronto.' },
    { id: 'ahciadaptive', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'AHCIADAPTIVE', guid: 'dab60367-53fe-4fbc-825e-521d069d2456', label: 'Tempo ocioso do link AHCI antes de economizar', values: [0, 100, 500, 1000, 5000], unit: ' ms', max: 300000, risk: 'baixo', novelty: 'raro', hidden: true, affects: ['disk'],
      what: 'Quanto tempo o cabo SATA precisa ficar parado antes de entrar em economia. 0 = nunca entra.' },
    { id: 'diskburst', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'DISKBURSTIGNORE', guid: '80e3c60e-bb94-4ad8-bbe0-0d3195efc663', label: 'Ignorar rajadas curtas de disco', values: [0, 1, 5, 10], unit: ' s', max: 300, risk: 'baixo', novelty: 'raro', hidden: true, affects: ['disk'],
      what: 'Por quanto tempo uma atividade curta de disco não conta para manter o disco acordado.' },
    { id: 'diskidle', group: 'armazenamento', sub: 'SUB_DISK', subGuid: DISK, setting: 'DISKIDLE', guid: '6738e2c4-e8a5-4a42-b16a-e040e769756e', label: 'Desligar o disco depois de', values: [0, 60, 300, 600, 1200, 3600], unit: ' s', max: 100000, risk: 'baixo', novelty: 'conhecido', hidden: false, affects: ['disk'],
      what: 'Para HDs: quanto tempo parado até o disco parar de girar. 0 = nunca.' },

    /* PCI Express */
    { id: 'aspm', group: 'barramento', sub: 'SUB_PCIEXPRESS', subGuid: PCIE, setting: 'ASPM', guid: 'ee12f906-d277-404b-b6da-e5fa1a576df5', label: 'Gerenciamento de energia do estado do link (ASPM)', values: [0, 1, 2], risk: 'baixo', novelty: 'pouco-conhecido', hidden: false, affects: ['disk', 'latency'],
      names: { 0: 'Desligado', 1: 'Economia moderada', 2: 'Economia máxima' },
      what: 'Economia de energia no barramento do SSD NVMe e da placa de vídeo. Desligado tira o atraso de acordar o link.' },

    /* Rede */
    { id: 'wifipower', group: 'rede', sub: 'SUB_WIFI', subGuid: WIFI, setting: 'WIFIPOWERSAVING', guid: '12bbebe6-58d6-4636-95bb-3217ef867c1a', label: 'Economia de energia do Wi-Fi', values: [0, 1, 2, 3], risk: 'baixo', novelty: 'conhecido', hidden: false, affects: ['network'],
      names: { 0: 'Desempenho máximo', 1: 'Economia baixa', 2: 'Economia média', 3: 'Economia máxima' },
      what: 'Deixa o rádio do Wi-Fi cochilar entre pacotes. Em desempenho máximo, o ping fica mais baixo e mais estável.' }
  ];

  return { SPACE, GROUPS, PROC, DISK, PCIE, AMD_SLIDER, WIFI };
});
