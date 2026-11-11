/*
 * Raio-X do PC (Windows): varre o registro e o sistema atrás de ajustes de desempenho, mostra o valor atual, o que
 * a evidência diz de cada um e deixa a pessoa aplicar ou reverter.
 *
 * Regras:
 *  - catálogo FECHADO: só as chaves e os valores desta lista. Nada é montado a partir do que vem da interface;
 *  - ler não pede nada; gravar em HKCU não pede permissão; gravar em HKLM passa por UMA elevação (UAC) por vez;
 *  - configurações do plano de energia ATIVO vão pelo powercfg (na tomada), só GUIDs do catálogo e índices que o PC aceita;
 *  - serviços só aparecem se existirem no PC, e nenhum serviço de segurança, atualização, rede ou áudio está na lista;
 *  - todo valor anterior é guardado (inclusive "não existia") para a reversão pelo Diário;
 *  - o que reduz a segurança do PC (antivírus, integridade de memória, mitigações do processador, UAC, atualizações)
 *    fica na lista de recusados: aparece com o motivo, nunca é aplicado.
 */

const DWORD_MAX = 0xffffffff;
const HIVES = { HKCU: 'HKCU', HKLM: 'HKLM', POWER: 'POWER' };
const SAFE_KEY = /^[A-Za-z0-9 _\\.\-()]+$/;
const SAFE_NAME = /^[A-Za-z0-9 _\-.]+$/;
const SAFE_STRING = /^[A-Za-z0-9 _.\-=;]{0,200}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CHANGES = 160;

const GROUPS = {
  jogos: 'Jogos e captura',
  agendador: 'Agendador e prioridades',
  energia: 'Energia',
  disco: 'Disco e arquivos',
  interface: 'Interface',
  entrada: 'Mouse e teclado',
  memoria: 'Memória e sistema',
  navegadores: 'Navegadores e segundo plano',
  rede: 'Rede (TCP/IP)',
  plano: 'Plano de energia ativo (na tomada)',
  servicos: 'Serviços'
};
const EVIDENCE = {
  medido: 'efeito medido',
  varia: 'depende do PC',
  controverso: 'controverso',
  mito: 'quase mito'
};

/** def: o valor que o Windows usa quando a entrada não existe (para reconhecer o padrão). */
const e = (hive, key, name, type = 'dword', def = null) => ({ hive, key, name, type, def });
/** Configuração do plano de energia ATIVO (powercfg /setacvalueindex scheme_current), sem permissão especial. */
const pw = (sub, setting) => ({ hive: 'POWER', kind: 'power', sub, setting, key: `${sub}\\${setting}`, name: setting, type: 'dword', def: null });
/**
 * Serviço do Windows (valor Start: 2 automático, 3 manual, 4 desativado). Só aparece se existir no PC.
 * O padrão (def) é o de uma instalação limpa do Windows 11.
 */
function svc(name, label, what, def, { risk = 'moderado', evidence = 'varia', id = null } = {}) {
  const base = [[2, 'Automático'], [3, 'Manual (abre só quando algum programa pede)'], [4, 'Desativado']];
  return {
    id: id || `svc-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, group: 'servicos', label, risk, evidence, reboot: 'reiniciar', requiresExisting: true, what,
    entries: [e('HKLM', `SYSTEM\\CurrentControlSet\\Services\\${name}`, 'Start', 'dword', def)],
    options: base.map(([value, text]) => (value === def ? { values: [value], label: `${text} (padrão)`, kind: 'padrao' } : { values: [value], label: text, kind: 'alternativa' }))
  };
}
const MMCSS = 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';

/** values: um item por entrada; null = valor ausente (o Windows usa o padrão dele). */
const TWEAKS = [
  { id: 'gamedvr', group: 'jogos', label: 'Gravação em segundo plano (Game DVR)', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'O Windows pode ficar gravando os últimos minutos de jogo o tempo todo. Desligar tira esse trabalho da placa de vídeo e do disco.',
    entries: [e('HKCU', 'System\\GameConfigStore', 'GameDVR_Enabled', 'dword', 1), e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', 'AppCaptureEnabled', 'dword', 1)],
    options: [{ values: [0, 0], label: 'Desligada', kind: 'recomendado' }, { values: [1, 1], label: 'Ligada', kind: 'padrao' }] },
  { id: 'gamedvrpolicy', group: 'jogos', label: 'Bloquear a gravação de jogos para todos', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'A mesma gravação, desligada por política para todos os usuários do PC (o app Xbox não consegue religar).',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR', 'AllowGameDVR')],
    options: [{ values: [0], label: 'Bloqueada', kind: 'alternativa' }, { values: [null], label: 'Sem política (padrão)', kind: 'padrao' }] },
  { id: 'gamemode', group: 'jogos', label: 'Modo de Jogo', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'Dá prioridade ao jogo e segura atualizações durante a partida. Costuma ajudar em PCs mais fracos e ser neutro nos fortes.',
    entries: [e('HKCU', 'Software\\Microsoft\\GameBar', 'AutoGameModeEnabled')],
    options: [{ values: [1], label: 'Ligado', kind: 'recomendado' }, { values: [0], label: 'Desligado', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows (ligado)', kind: 'padrao' }] },
  { id: 'fso', group: 'jogos', label: 'Otimizações de tela cheia', risk: 'baixo', evidence: 'controverso', reboot: 'nao',
    what: 'O Windows troca a tela cheia "exclusiva" por uma tela cheia em janela otimizada. Em jogos antigos, desligar às vezes reduz o atraso; nos novos, costuma piorar.',
    entries: [e('HKCU', 'System\\GameConfigStore', 'GameDVR_FSEBehaviorMode', 'dword', 0), e('HKCU', 'System\\GameConfigStore', 'GameDVR_HonorUserFSEBehaviorMode', 'dword', 0), e('HKCU', 'System\\GameConfigStore', 'GameDVR_DXGIHonorFSEWindowsCompatible', 'dword', 0)],
    options: [{ values: [2, 1, 1], label: 'Desligadas em todos os jogos', kind: 'alternativa' }, { values: [0, 0, 0], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'hags', group: 'jogos', label: 'Agendamento de GPU acelerado por hardware', risk: 'baixo', evidence: 'varia', reboot: 'reiniciar',
    what: 'A placa de vídeo organiza a própria fila de trabalho. Necessário para a geração de quadros (DLSS 3/FSR 3); em algumas placas, piora a fluidez.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'HwSchMode')],
    options: [{ values: [2], label: 'Ligado', kind: 'alternativa' }, { values: [1], label: 'Desligado', kind: 'alternativa' }, { values: [null], label: 'Padrão do driver', kind: 'padrao' }] },
  { id: 'mpo', group: 'jogos', label: 'Sobreposição multiplano (MPO)', risk: 'moderado', evidence: 'varia', reboot: 'reiniciar',
    what: 'Um recurso da composição de tela. Desligar resolve tela piscando e engasgos com dois monitores em algumas placas; em outras, não muda nada.',
    entries: [e('HKLM', 'SOFTWARE\\Microsoft\\Windows\\Dwm', 'OverlayTestMode')],
    options: [{ values: [5], label: 'Desligada', kind: 'alternativa' }, { values: [null], label: 'Ligada (padrão)', kind: 'padrao' }] },

  { id: 'priosep', group: 'agendador', label: 'Divisão de tempo do processador (Win32PrioritySeparation)', risk: 'moderado', evidence: 'controverso', reboot: 'nao',
    what: 'Quanto tempo cada programa ganha por vez no processador e quanto o programa em foco é favorecido. Vale na hora.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\PriorityControl', 'Win32PrioritySeparation', 'dword', 2)],
    options: [{ values: [38], label: 'Curto e variável, foco ×3 (0x26)', kind: 'alternativa' }, { values: [40], label: 'Curto e fixo (0x28)', kind: 'alternativa' }, { values: [42], label: 'Curto e fixo, foco ×3 (0x2A)', kind: 'alternativa' },
      { values: [22], label: 'Longo e variável (0x16)', kind: 'alternativa' }, { values: [24], label: 'Longo e fixo (0x18)', kind: 'alternativa' }, { values: [26], label: 'Longo e fixo, foco ×3 (0x1A)', kind: 'alternativa' },
      { values: [36], label: 'Curto e variável, sem favorecer o foco (0x24)', kind: 'alternativa' }, { values: [20], label: 'Longo e variável, sem favorecer o foco (0x14)', kind: 'alternativa' }, { values: [2], label: 'Padrão do Windows (2)', kind: 'padrao' }] },
  { id: 'sysresp', group: 'agendador', label: 'Reserva para tarefas de segundo plano (MMCSS)', risk: 'baixo', evidence: 'controverso', reboot: 'reiniciar',
    what: 'Quanto do processador o agendador multimídia guarda para o resto do sistema enquanto áudio e vídeo tocam.',
    entries: [e('HKLM', MMCSS, 'SystemResponsiveness', 'dword', 20)],
    options: [{ values: [10], label: 'Mínima (10%)', kind: 'alternativa' }, { values: [0], label: 'Zero (o Windows trata como 10%)', kind: 'alternativa' }, { values: [14], label: '14%', kind: 'alternativa' }, { values: [20], label: 'Padrão (20%)', kind: 'padrao' }] },
  { id: 'netthrottle', group: 'agendador', label: 'Limite de rede durante multimídia', risk: 'baixo', evidence: 'controverso', reboot: 'reiniciar',
    what: 'O Windows limita pacotes de rede que não são multimídia enquanto algo toca. Desligar ajuda pouco em jogos online, mas não costuma prejudicar.',
    entries: [e('HKLM', MMCSS, 'NetworkThrottlingIndex', 'dword', 10)],
    options: [{ values: [DWORD_MAX], label: 'Sem limite', kind: 'alternativa' }, { values: [20], label: '20 pacotes por ms', kind: 'alternativa' }, { values: [10], label: 'Padrão (10)', kind: 'padrao' }] },
  { id: 'mmcssgames', group: 'agendador', label: 'Prioridade da tarefa "Games" do MMCSS', risk: 'baixo', evidence: 'mito', reboot: 'reiniciar',
    what: 'Só vale para jogos que se registram no agendador multimídia (poucos fazem). Famoso em listas de "tweaks", com efeito raramente medido.',
    entries: [e('HKLM', `${MMCSS}\\Tasks\\Games`, 'GPU Priority', 'dword', 8), e('HKLM', `${MMCSS}\\Tasks\\Games`, 'Priority', 'dword', 2), e('HKLM', `${MMCSS}\\Tasks\\Games`, 'Scheduling Category', 'string', 'Medium'), e('HKLM', `${MMCSS}\\Tasks\\Games`, 'SFIO Priority', 'string', 'Normal')],
    options: [{ values: [8, 6, 'High', 'High'], label: 'Alta', kind: 'alternativa' }, { values: [8, 4, 'High', 'Normal'], label: 'Média-alta', kind: 'alternativa' }, { values: [8, 2, 'Medium', 'Normal'], label: 'Padrão', kind: 'padrao' }] },
  { id: 'timerglobal', group: 'agendador', label: 'Resolução do timer valendo para o sistema todo', risk: 'baixo', evidence: 'controverso', reboot: 'reiniciar',
    what: 'No Windows 11, um programa que pede um timer mais preciso só muda o timer dele. Ligar volta ao jeito do Windows 10: vale para todos (menos atraso, mais consumo).',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel', 'GlobalTimerResolutionRequests')],
    options: [{ values: [1], label: 'Para o sistema todo', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },

  { id: 'powerthrottling', group: 'energia', label: 'Limitação de programas em segundo plano', risk: 'baixo', evidence: 'medido', reboot: 'reiniciar',
    what: 'O Windows põe programas sem foco em modo econômico (EcoQoS). Desligar mantém tudo na velocidade total; gasta mais bateria em notebooks.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', 'PowerThrottlingOff')],
    options: [{ values: [1], label: 'Desligada', kind: 'alternativa' }, { values: [null], label: 'Ligada (padrão)', kind: 'padrao' }] },
  { id: 'faststartup', group: 'energia', label: 'Inicialização rápida', risk: 'baixo', evidence: 'varia', reboot: 'reiniciar',
    what: 'Desligar o PC vira uma hibernação parcial. Desligar o recurso faz cada desligamento ser limpo (drivers e memória do zero).',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power', 'HiberbootEnabled', 'dword', 1)],
    options: [{ values: [0], label: 'Desligada', kind: 'alternativa' }, { values: [1], label: 'Ligada (padrão)', kind: 'padrao' }] },

  { id: 'lastaccess', group: 'disco', label: 'Registro do último acesso (NTFS)', risk: 'baixo', evidence: 'medido', reboot: 'reiniciar',
    what: 'Cada arquivo lido ganha uma gravação com a hora do acesso. Desligar economiza gravações em pastas com muitos arquivos.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'NtfsDisableLastAccessUpdate', 'dword', 0x80000002)],
    options: [{ values: [0x80000001], label: 'Não registrar', kind: 'recomendado' }, { values: [0x80000003], label: 'Só na unidade do sistema não registrar', kind: 'alternativa' }, { values: [0x80000002], label: 'O sistema decide (padrão)', kind: 'padrao' }] },
  { id: 'shortnames', group: 'disco', label: 'Nomes curtos 8.3', risk: 'moderado', evidence: 'medido', reboot: 'reiniciar',
    what: 'O Windows cria um segundo nome curto (ARQUIV~1) para cada arquivo, por compatibilidade com programas muito antigos.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'NtfsDisable8dot3NameCreation', 'dword', 2)],
    options: [{ values: [1], label: 'Não criar em nenhuma unidade', kind: 'alternativa' }, { values: [2], label: 'Por unidade (padrão)', kind: 'padrao' }] },

  { id: 'sysmain', group: 'servicos', label: 'SysMain (Superfetch)', risk: 'moderado', evidence: 'controverso', reboot: 'reiniciar',
    what: 'Pré-carrega na memória os programas que você mais usa. Em HD ajuda bastante; em SSD rápido, o ganho é pequeno e há quem prefira desligar.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\SysMain', 'Start', 'dword', 2)],
    options: [{ values: [4], label: 'Desativado', kind: 'alternativa' }, { values: [3], label: 'Manual', kind: 'alternativa' }, { values: [2], label: 'Automático (padrão)', kind: 'padrao' }] },
  { id: 'wsearch', group: 'servicos', label: 'Indexação da busca do Windows', risk: 'moderado', evidence: 'varia', reboot: 'reiniciar',
    what: 'Mantém um índice dos arquivos para a busca ser instantânea. Desligar tira o trabalho em segundo plano, mas a busca fica lenta.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\WSearch', 'Start', 'dword', 2)],
    options: [{ values: [4], label: 'Desativada', kind: 'alternativa' }, { values: [3], label: 'Manual', kind: 'alternativa' }, { values: [2], label: 'Automática (padrão)', kind: 'padrao' }] },

  { id: 'transparency', group: 'interface', label: 'Transparência das janelas', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'O efeito de vidro da barra de tarefas e do menu Iniciar. Desligar alivia placas de vídeo integradas.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 'dword', 1)],
    options: [{ values: [0], label: 'Desligada', kind: 'alternativa' }, { values: [1], label: 'Ligada (padrão)', kind: 'padrao' }] },
  { id: 'visualfx', group: 'interface', label: 'Efeitos visuais do Windows', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Animações e sombras do Windows. "Melhor desempenho" desliga tudo de uma vez; em PCs fracos, a diferença é visível.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', 'VisualFXSetting', 'dword', 0)],
    options: [{ values: [2], label: 'Melhor desempenho', kind: 'alternativa' }, { values: [1], label: 'Melhor aparência', kind: 'alternativa' }, { values: [0], label: 'O Windows escolhe (padrão)', kind: 'padrao' }] },
  { id: 'menudelay', group: 'interface', label: 'Atraso para abrir menus', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Quanto tempo o Windows espera antes de abrir um submenu ao passar o mouse.',
    entries: [e('HKCU', 'Control Panel\\Desktop', 'MenuShowDelay', 'string', '400')],
    options: [{ values: ['100'], label: '100 ms', kind: 'recomendado' }, { values: ['0'], label: 'Sem atraso', kind: 'alternativa' }, { values: ['50'], label: '50 ms', kind: 'alternativa' }, { values: ['200'], label: '200 ms', kind: 'alternativa' }, { values: ['400'], label: '400 ms (padrão)', kind: 'padrao' }] },
  { id: 'startupdelay', group: 'interface', label: 'Atraso dos programas de inicialização', risk: 'baixo', evidence: 'varia', reboot: 'sessao',
    what: 'O Windows espera alguns segundos antes de abrir os programas que iniciam com ele. Sem o atraso, eles abrem junto com a área de trabalho.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize', 'StartupDelayInMSec')],
    options: [{ values: [0], label: 'Sem atraso', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'bgapps', group: 'interface', label: 'Apps da Microsoft Store em segundo plano', risk: 'baixo', evidence: 'varia', reboot: 'sessao',
    what: 'Bloqueia os apps da loja de rodarem escondidos (notificações deles podem atrasar). Vale principalmente no Windows 10.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', 'GlobalUserDisabled')],
    options: [{ values: [1], label: 'Bloqueados', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },

  { id: 'mouseaccel', group: 'entrada', label: 'Aceleração do mouse ("aumentar precisão do ponteiro")', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Com aceleração, o mesmo movimento da mão anda mais ou menos na tela conforme a velocidade. Sem ela, a mira fica consistente.',
    entries: [e('HKCU', 'Control Panel\\Mouse', 'MouseSpeed', 'string', '1'), e('HKCU', 'Control Panel\\Mouse', 'MouseThreshold1', 'string', '6'), e('HKCU', 'Control Panel\\Mouse', 'MouseThreshold2', 'string', '10')],
    options: [{ values: ['0', '0', '0'], label: 'Sem aceleração', kind: 'recomendado' }, { values: ['1', '6', '10'], label: 'Com aceleração (padrão)', kind: 'padrao' }] },
  { id: 'inputqueue', group: 'entrada', label: 'Fila de dados do mouse e do teclado', risk: 'moderado', evidence: 'mito', reboot: 'reiniciar',
    what: 'O tamanho do buffer dos drivers de mouse e teclado. Listas de "tweaks" mandam diminuir; valores baixos demais perdem cliques, por isso o Nexo não passa de 50.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters', 'MouseDataQueueSize', 'dword', 100), e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters', 'KeyboardDataQueueSize', 'dword', 100)],
    options: [{ values: [50, 50], label: '50', kind: 'alternativa' }, { values: [70, 70], label: '70', kind: 'alternativa' }, { values: [100, 100], label: '100 (padrão)', kind: 'padrao' }] },

  { id: 'nolazymode', group: 'agendador', label: 'MMCSS sem "modo preguiçoso"', risk: 'baixo', evidence: 'mito', reboot: 'reiniciar',
    what: 'Faz o agendador multimídia nunca relaxar entre tarefas. Aparece em listas de "tweaks" para jogos; o efeito raramente é medido.',
    entries: [e('HKLM', MMCSS, 'NoLazyMode')],
    options: [{ values: [1], label: 'Sempre ativo', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'psched', group: 'rede', label: 'Banda "reservada" do QoS (Psched)', risk: 'baixo', evidence: 'mito', reboot: 'reiniciar',
    what: 'O mito dos "20% da internet reservados pelo Windows". Na prática essa reserva só vale para programas que pedem QoS; mudar quase nunca muda nada.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Windows\\Psched', 'NonBestEffortLimit')],
    options: [{ values: [0], label: 'Sem reserva', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'tcpttl', group: 'rede', label: 'Tempo de vida dos pacotes (TTL)', risk: 'baixo', evidence: 'mito', reboot: 'reiniciar',
    what: 'Quantos saltos um pacote pode dar até ser descartado. Listas de "tweaks" mandam mudar; não muda o ping.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', 'DefaultTTL')],
    options: [{ values: [64], label: '64', kind: 'alternativa' }, { values: [128], label: '128 (fixo)', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows (128)', kind: 'padrao' }] },
  { id: 'tcpwait', group: 'rede', label: 'Espera depois de fechar uma conexão (TIME_WAIT)', risk: 'baixo', evidence: 'controverso', reboot: 'reiniciar',
    what: 'Quanto tempo a porta fica reservada depois que a conexão fecha. Encurtar ajuda programas que abrem milhares de conexões (servidores, downloads em massa).',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', 'TcpTimedWaitDelay')],
    options: [{ values: [30], label: '30 s', kind: 'alternativa' }, { values: [60], label: '60 s', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows (120 s)', kind: 'padrao' }] },
  { id: 'maxuserport', group: 'rede', label: 'Portas disponíveis para conexões de saída', risk: 'baixo', evidence: 'controverso', reboot: 'reiniciar',
    what: 'Até que número de porta o Windows usa para conexões de saída. Ampliar evita esgotar portas com muitas conexões ao mesmo tempo.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', 'MaxUserPort')],
    options: [{ values: [65534], label: 'Até 65534', kind: 'alternativa' }, { values: [32768], label: 'Até 32768', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'tcp1323', group: 'rede', label: 'Janelas grandes e marcas de tempo do TCP', risk: 'baixo', evidence: 'mito', reboot: 'reiniciar',
    what: 'Opções do TCP que o Windows moderno já ajusta sozinho. Mudar costuma ser neutro.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', 'Tcp1323Opts')],
    options: [{ values: [1], label: 'Só janelas grandes', kind: 'alternativa' }, { values: [3], label: 'Janelas grandes e marcas de tempo', kind: 'alternativa' }, { values: [0], label: 'Desligadas', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },

  { id: 'minanimate', group: 'interface', label: 'Animação ao minimizar e maximizar', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'A animação das janelas abrindo e fechando. Sem ela, as janelas aparecem na hora.',
    entries: [e('HKCU', 'Control Panel\\Desktop\\WindowMetrics', 'MinAnimate', 'string', '1')],
    options: [{ values: ['0'], label: 'Desligada', kind: 'alternativa' }, { values: ['1'], label: 'Ligada (padrão)', kind: 'padrao' }] },
  { id: 'taskbaranim', group: 'interface', label: 'Animações da barra de tarefas', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Os efeitos ao abrir e trocar de programa pela barra de tarefas.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAnimations', 'dword', 1)],
    options: [{ values: [0], label: 'Desligadas', kind: 'alternativa' }, { values: [1], label: 'Ligadas (padrão)', kind: 'padrao' }] },
  { id: 'listview', group: 'interface', label: 'Seleção translúcida e sombra dos ícones', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'O retângulo azul translúcido ao selecionar arquivos e a sombra embaixo dos nomes na área de trabalho.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'ListviewAlphaSelect', 'dword', 1), e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'ListviewShadow', 'dword', 1)],
    options: [{ values: [0, 0], label: 'Desligadas', kind: 'alternativa' }, { values: [1, 0], label: 'Só a seleção translúcida', kind: 'alternativa' }, { values: [1, 1], label: 'Ligadas (padrão)', kind: 'padrao' }] },
  { id: 'dragfull', group: 'interface', label: 'Mostrar o conteúdo ao arrastar janelas', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Redesenhar a janela inteira enquanto ela é arrastada. Desligado, só um contorno se move (alivia placas de vídeo integradas).',
    entries: [e('HKCU', 'Control Panel\\Desktop', 'DragFullWindows', 'string', '1')],
    options: [{ values: ['0'], label: 'Só o contorno', kind: 'alternativa' }, { values: ['1'], label: 'Janela inteira (padrão)', kind: 'padrao' }] },
  { id: 'aeropeek', group: 'interface', label: 'Espiar a área de trabalho (Aero Peek)', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Deixar as janelas transparentes ao passar o mouse no canto da barra de tarefas.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\DWM', 'EnableAeroPeek', 'dword', 1)],
    options: [{ values: [0], label: 'Desligado', kind: 'alternativa' }, { values: [1], label: 'Ligado (padrão)', kind: 'padrao' }] },
  { id: 'thumbhover', group: 'interface', label: 'Espera para mostrar as prévias da barra de tarefas', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Quanto tempo o mouse precisa ficar sobre um ícone da barra de tarefas para a prévia da janela aparecer.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'ExtendedUIHoverTime')],
    options: [{ values: [100], label: '100 ms', kind: 'alternativa' }, { values: [1000], label: '1 s', kind: 'alternativa' }, { values: [30000], label: 'Quase nunca (30 s)', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'iconsonly', group: 'interface', label: 'Miniaturas nas pastas', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'Gerar miniaturas de fotos e vídeos. Só ícones deixa pastas com milhares de arquivos abrirem bem mais rápido.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'IconsOnly', 'dword', 0)],
    options: [{ values: [1], label: 'Só ícones', kind: 'alternativa' }, { values: [0], label: 'Miniaturas (padrão)', kind: 'padrao' }] },
  { id: 'netthumbs', group: 'interface', label: 'Miniaturas em pastas da rede', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Gerar miniaturas em pastas compartilhadas pela rede, que é lento e trava o Explorador.',
    entries: [e('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', 'DisableThumbnailsOnNetworkFolders')],
    options: [{ values: [1], label: 'Sem miniaturas na rede', kind: 'recomendado' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'separateprocess', group: 'interface', label: 'Janelas de pasta em processos separados', risk: 'baixo', evidence: 'varia', reboot: 'sessao',
    what: 'Cada janela do Explorador num processo próprio: se uma travar, a barra de tarefas não cai junto. Usa um pouco mais de memória.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'SeparateProcess', 'dword', 0)],
    options: [{ values: [1], label: 'Separadas', kind: 'alternativa' }, { values: [0], label: 'Um processo só (padrão)', kind: 'padrao' }] },
  { id: 'websearch', group: 'interface', label: 'Resultados da internet na busca do Iniciar', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'A busca do Iniciar consulta a internet a cada letra digitada. Sem isso, ela só procura no PC e responde mais rápido.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled', 'dword', 1), e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions')],
    options: [{ values: [0, 1], label: 'Só o PC', kind: 'recomendado' }, { values: [0, null], label: 'Só o PC (sem política)', kind: 'alternativa' }, { values: [1, null], label: 'Com a internet (padrão)', kind: 'padrao' }] },
  { id: 'widgets', group: 'interface', label: 'Widgets e notícias da barra de tarefas', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'O painel de notícias e clima. Desligado, o processo dele não fica carregado.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Dsh', 'AllowNewsAndInterests')],
    options: [{ values: [0], label: 'Desligados', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'suggestions', group: 'interface', label: 'Sugestões, dicas e apps instalados sem pedir', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'O Windows instala apps "sugeridos" e mostra dicas e anúncios no Iniciar e nas Configurações. Desligar evita downloads e processos que você não pediu.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SilentInstalledAppsEnabled', 'dword', 1), e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SystemPaneSuggestionsEnabled', 'dword', 1),
      e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SubscribedContent-338388Enabled', 'dword', 1), e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SubscribedContent-338389Enabled', 'dword', 1)],
    options: [{ values: [0, 0, 0, 0], label: 'Desligadas', kind: 'recomendado' }, { values: [0, 1, 1, 1], label: 'Só não instalar apps sozinho', kind: 'alternativa' }, { values: [1, 1, 1, 1], label: 'Ligadas (padrão)', kind: 'padrao' }] },
  { id: 'consumerfeatures', group: 'interface', label: 'Apps e jogos patrocinados no Iniciar (para todos)', risk: 'baixo', evidence: 'varia', reboot: 'sessao',
    what: 'Política que impede o Windows de baixar apps e jogos patrocinados para qualquer usuário do PC. Nas edições Home e Pro recentes, o Windows pode ignorar (o ajuste "Sugestões" acima vale em todas).',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent', 'DisableWindowsConsumerFeatures')],
    options: [{ values: [1], label: 'Bloqueados', kind: 'recomendado' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'toasts', group: 'interface', label: 'Notificações do Windows', risk: 'moderado', evidence: 'varia', reboot: 'sessao',
    what: 'Todas as notificações (inclusive as de apps). Desligar evita interrupções em jogo, mas você deixa de ver avisos.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'ToastEnabled', 'dword', 1)],
    options: [{ values: [0], label: 'Desligadas', kind: 'alternativa' }, { values: [1], label: 'Ligadas (padrão)', kind: 'padrao' }] },
  { id: 'autoendtasks', group: 'interface', label: 'Fechar programas travados ao desligar', risk: 'moderado', evidence: 'medido', reboot: 'sessao',
    what: 'Desligar e reiniciar sem esperar programas que não respondem. Arquivos não salvos nesses programas se perdem.',
    entries: [e('HKCU', 'Control Panel\\Desktop', 'AutoEndTasks', 'string', '0')],
    options: [{ values: ['1'], label: 'Fechar sozinho', kind: 'alternativa' }, { values: ['0'], label: 'Perguntar (padrão)', kind: 'padrao' }] },
  { id: 'waittokill', group: 'interface', label: 'Espera para fechar programas ao desligar', risk: 'moderado', evidence: 'medido', reboot: 'sessao',
    what: 'Quanto tempo o Windows espera cada programa fechar quando você desliga. Pouco tempo pode perder o que não foi salvo.',
    entries: [e('HKCU', 'Control Panel\\Desktop', 'WaitToKillAppTimeout', 'string', '20000')],
    options: [{ values: ['2000'], label: '2 s', kind: 'alternativa' }, { values: ['5000'], label: '5 s', kind: 'alternativa' }, { values: ['10000'], label: '10 s', kind: 'alternativa' }, { values: ['20000'], label: '20 s (padrão)', kind: 'padrao' }] },
  { id: 'hungapp', group: 'interface', label: 'Tempo até considerar um programa travado', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Depois de quanto tempo sem responder a janela vira "Não está respondendo".',
    entries: [e('HKCU', 'Control Panel\\Desktop', 'HungAppTimeout', 'string', '5000')],
    options: [{ values: ['1000'], label: '1 s', kind: 'alternativa' }, { values: ['2000'], label: '2 s', kind: 'alternativa' }, { values: ['3000'], label: '3 s', kind: 'alternativa' }, { values: ['5000'], label: '5 s (padrão)', kind: 'padrao' }] },
  { id: 'activityhistory', group: 'interface', label: 'Histórico de atividades', risk: 'baixo', evidence: 'varia', reboot: 'sessao',
    what: 'O Windows registra os programas e arquivos que você abre (e pode enviar para a conta Microsoft). Desligar tira essa gravação de fundo.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities'), e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'UploadUserActivities')],
    options: [{ values: [0, 0], label: 'Desligado', kind: 'recomendado' }, { values: [null, null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'adid', group: 'interface', label: 'ID de publicidade', risk: 'baixo', evidence: 'varia', reboot: 'sessao',
    what: 'Um identificador que os apps usam para anúncios personalizados.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled', 'dword', 1)],
    options: [{ values: [0], label: 'Desligado', kind: 'recomendado' }, { values: [1], label: 'Ligado (padrão)', kind: 'padrao' }] },

  { id: 'hovertime', group: 'entrada', label: 'Espera do mouse parado em cima', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Quanto tempo o mouse precisa ficar parado para mostrar dicas.',
    entries: [e('HKCU', 'Control Panel\\Mouse', 'MouseHoverTime', 'string', '400')],
    options: [{ values: ['10'], label: '10 ms', kind: 'alternativa' }, { values: ['100'], label: '100 ms', kind: 'alternativa' }, { values: ['200'], label: '200 ms', kind: 'alternativa' }, { values: ['400'], label: '400 ms (padrão)', kind: 'padrao' }] },
  { id: 'keydelay', group: 'entrada', label: 'Espera para repetir uma tecla segurada', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Quanto tempo uma tecla segurada espera antes de começar a repetir.',
    entries: [e('HKCU', 'Control Panel\\Keyboard', 'KeyboardDelay', 'string', '1')],
    options: [{ values: ['0'], label: 'Mínima', kind: 'alternativa' }, { values: ['1'], label: 'Curta (padrão)', kind: 'padrao' }, { values: ['2'], label: 'Média', kind: 'alternativa' }, { values: ['3'], label: 'Longa', kind: 'alternativa' }] },
  { id: 'keyspeed', group: 'entrada', label: 'Velocidade de repetição das teclas', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Quantas vezes por segundo uma tecla segurada se repete.',
    entries: [e('HKCU', 'Control Panel\\Keyboard', 'KeyboardSpeed', 'string', '31')],
    options: [{ values: ['31'], label: 'Máxima (padrão)', kind: 'padrao' }, { values: ['28'], label: 'Alta', kind: 'alternativa' }, { values: ['24'], label: 'Média', kind: 'alternativa' }, { values: ['16'], label: 'Baixa', kind: 'alternativa' }] },
  { id: 'stickykeys', group: 'entrada', label: 'Atalhos de acessibilidade que interrompem o jogo', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Apertar Shift 5 vezes (ou segurar Shift, Num Lock) abre uma janela de acessibilidade no meio do jogo. Desliga só os atalhos; os recursos continuam nas Configurações.',
    entries: [e('HKCU', 'Control Panel\\Accessibility\\StickyKeys', 'Flags', 'string', '510'), e('HKCU', 'Control Panel\\Accessibility\\ToggleKeys', 'Flags', 'string', '62'), e('HKCU', 'Control Panel\\Accessibility\\Keyboard Response', 'Flags', 'string', '126')],
    options: [{ values: ['506', '58', '122'], label: 'Atalhos desligados', kind: 'recomendado' }, { values: ['506', '62', '126'], label: 'Só o das 5 vezes Shift', kind: 'alternativa' }, { values: ['510', '62', '126'], label: 'Ligados (padrão)', kind: 'padrao' }] },

  { id: 'gamebarbutton', group: 'jogos', label: 'Botão Xbox do controle abre a Game Bar', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'Apertar o botão Xbox do controle abre a Game Bar (e pode atrapalhar jogos e programas que usam esse botão).',
    entries: [e('HKCU', 'Software\\Microsoft\\GameBar', 'UseNexusForGameBarEnabled', 'dword', 1)],
    options: [{ values: [0], label: 'Não abre', kind: 'alternativa' }, { values: [1], label: 'Abre (padrão)', kind: 'padrao' }] },
  { id: 'gamebartips', group: 'jogos', label: 'Avisos da Game Bar ao abrir jogos', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'A mensagem "pressione Win+G" que aparece no começo de alguns jogos.',
    entries: [e('HKCU', 'Software\\Microsoft\\GameBar', 'ShowStartupPanel', 'dword', 1)],
    options: [{ values: [0], label: 'Sem avisos', kind: 'alternativa' }, { values: [1], label: 'Com avisos (padrão)', kind: 'padrao' }] },
  { id: 'directx', group: 'jogos', label: 'Otimizações para jogos em janela e taxa variável (DirectX)', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'No Windows 11, jogos antigos em janela passam a usar o modelo moderno de apresentação: menos atraso e G-Sync/FreeSync em janela. Substitui as preferências globais de DirectX (como o HDR automático); Reverter devolve o texto anterior.',
    entries: [e('HKCU', 'Software\\Microsoft\\DirectX\\UserGpuPreferences', 'DirectXUserGlobalSettings', 'string')],
    options: [{ values: ['SwapEffectUpgradeEnable=1;VRROptimizeEnable=1;'], label: 'Otimizações e taxa variável ligadas', kind: 'alternativa' }, { values: ['SwapEffectUpgradeEnable=1;VRROptimizeEnable=0;'], label: 'Só as otimizações', kind: 'alternativa' },
      { values: ['SwapEffectUpgradeEnable=0;VRROptimizeEnable=0;'], label: 'Desligadas', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'tdrdelay', group: 'jogos', label: 'Tempo até o Windows reiniciar a placa de vídeo travada', risk: 'moderado', evidence: 'varia', reboot: 'reiniciar',
    what: 'Se a placa de vídeo não responde por 2 s, o Windows reinicia o driver (a tela pisca e o jogo pode fechar). Mais tempo ajuda em cargas muito pesadas e em placas instáveis.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'TdrDelay')],
    options: [{ values: [5], label: '5 s', kind: 'alternativa' }, { values: [8], label: '8 s', kind: 'alternativa' }, { values: [10], label: '10 s', kind: 'alternativa' }, { values: [null], label: '2 s (padrão)', kind: 'padrao' }] },

  { id: 'svchostsplit', group: 'memoria', label: 'Agrupar serviços do Windows em menos processos', risk: 'baixo', evidence: 'varia', reboot: 'reiniciar',
    what: 'Com mais de 3,5 GB de RAM, cada serviço ganha um processo próprio (dezenas de svchost). Agrupar reduz o número de processos; se um serviço travar, leva os vizinhos junto.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control', 'SvcHostSplitThresholdInKB', 'dword', 3670016)],
    options: [{ values: [67108864], label: 'Agrupar (até 64 GB)', kind: 'alternativa' }, { values: [16777216], label: 'Agrupar (até 16 GB)', kind: 'alternativa' }, { values: [3670016], label: 'Separados (padrão)', kind: 'padrao' }] },
  { id: 'pagingexec', group: 'memoria', label: 'Manter o núcleo do Windows sempre na RAM', risk: 'baixo', evidence: 'mito', reboot: 'reiniciar',
    what: 'Famoso em listas de "tweaks". Com bastante RAM o Windows quase nunca tira o núcleo da memória; o efeito costuma ser nenhum.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', 'DisablePagingExecutive', 'dword', 0)],
    options: [{ values: [1], label: 'Sempre na RAM', kind: 'alternativa' }, { values: [0], label: 'O Windows decide (padrão)', kind: 'padrao' }] },
  { id: 'largecache', group: 'memoria', label: 'Cache grande de arquivos (modo servidor)', risk: 'moderado', evidence: 'mito', reboot: 'reiniciar',
    what: 'Faz o Windows priorizar o cache de arquivos sobre os programas, como num servidor. Em PC de jogos costuma piorar.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', 'LargeSystemCache', 'dword', 0)],
    options: [{ values: [1], label: 'Cache grande', kind: 'alternativa' }, { values: [0], label: 'Programas primeiro (padrão)', kind: 'padrao' }] },
  { id: 'prefetcher', group: 'memoria', label: 'Pré-busca de programas (Prefetch)', risk: 'baixo', evidence: 'mito', reboot: 'reiniciar',
    what: 'O Windows aprende o que cada programa lê ao abrir e adianta essas leituras. Desligar quase sempre deixa tudo mais lento para abrir.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters', 'EnablePrefetcher', 'dword', 3)],
    options: [{ values: [3], label: 'Programas e inicialização (padrão)', kind: 'padrao' }, { values: [2], label: 'Só a inicialização', kind: 'alternativa' }, { values: [1], label: 'Só os programas', kind: 'alternativa' }, { values: [0], label: 'Desligada', kind: 'alternativa' }] },
  { id: 'ntfsmemory', group: 'disco', label: 'Memória reservada para o NTFS', risk: 'baixo', evidence: 'controverso', reboot: 'reiniciar',
    what: 'Deixa o sistema de arquivos usar mais memória para cache de pastas e arquivos abertos. Ajuda com muitos arquivos; gasta RAM.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'NtfsMemoryUsage')],
    options: [{ values: [2], label: 'Aumentada', kind: 'alternativa' }, { values: [1], label: 'Normal (fixa)', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'hibernate', group: 'memoria', label: 'Hibernação', risk: 'baixo', evidence: 'medido', reboot: 'reiniciar',
    what: 'Desligar apaga o arquivo de hibernação (do tamanho de boa parte da RAM) e libera esse espaço no disco. Também desliga a inicialização rápida.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Power', 'HibernateEnabled', 'dword', 1)],
    options: [{ values: [0], label: 'Desligada', kind: 'alternativa' }, { values: [1], label: 'Ligada (padrão)', kind: 'padrao' }] },
  { id: 'wer', group: 'memoria', label: 'Relatórios de erro do Windows', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'Quando um programa trava, o Windows junta e envia um relatório (às vezes grande). Desligar evita esse trabalho.',
    entries: [e('HKLM', 'SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting', 'Disabled', 'dword', 0)],
    options: [{ values: [1], label: 'Desligados', kind: 'alternativa' }, { values: [0], label: 'Ligados (padrão)', kind: 'padrao' }] },
  { id: 'telemetry', group: 'memoria', label: 'Nível dos dados de diagnóstico enviados', risk: 'baixo', evidence: 'varia', reboot: 'reiniciar',
    what: 'O quanto o Windows coleta e envia de diagnóstico. "Mínimo" é o menor nível aceito nas edições Home e Pro.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry')],
    options: [{ values: [1], label: 'Mínimo', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'deliveryopt', group: 'memoria', label: 'Otimização de entrega (atualizações por P2P)', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'O Windows pode enviar pedaços de atualizações para outros PCs pela internet, usando o seu upload. As atualizações continuam chegando normalmente.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization', 'DODownloadMode')],
    options: [{ values: [0], label: 'Só da Microsoft', kind: 'recomendado' }, { values: [1], label: 'Só PCs da minha rede', kind: 'alternativa' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },
  { id: 'feedback', group: 'memoria', label: 'Pedidos de avaliação do Windows', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'As janelinhas "Como está sendo sua experiência?" do Hub de Comentários.',
    entries: [e('HKCU', 'Software\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod')],
    options: [{ values: [0], label: 'Nunca perguntar', kind: 'recomendado' }, { values: [null], label: 'Padrão do Windows', kind: 'padrao' }] },

  { id: 'edgebg', group: 'navegadores', label: 'Microsoft Edge rodando escondido', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'O Edge pré-carrega ao ligar o PC e continua rodando depois de fechado. Desligar libera memória e processador.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Edge', 'StartupBoostEnabled'), e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Edge', 'BackgroundModeEnabled')],
    options: [{ values: [0, 0], label: 'Não roda escondido', kind: 'recomendado' }, { values: [0, null], label: 'Só sem o pré-carregamento', kind: 'alternativa' }, { values: [null, null], label: 'Padrão do Edge', kind: 'padrao' }] },
  { id: 'edgeefficiency', group: 'navegadores', label: 'Modo de eficiência do Edge', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'O Edge pode pôr abas em espera e reduzir o próprio consumo. "Sempre" economiza memória; "nunca" deixa as abas sempre prontas.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Microsoft\\Edge', 'EfficiencyModeEnabled')],
    options: [{ values: [1], label: 'Sempre ligado', kind: 'alternativa' }, { values: [0], label: 'Sempre desligado', kind: 'alternativa' }, { values: [null], label: 'Padrão do Edge', kind: 'padrao' }] },
  { id: 'chromebg', group: 'navegadores', label: 'Google Chrome rodando depois de fechado', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'Extensões e apps do Chrome podem manter o navegador aberto em segundo plano.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Google\\Chrome', 'BackgroundModeEnabled')],
    options: [{ values: [0], label: 'Fecha de verdade', kind: 'alternativa' }, { values: [null], label: 'Padrão do Chrome', kind: 'padrao' }] },
  { id: 'chromeaccel', group: 'navegadores', label: 'Aceleração por hardware do Chrome', risk: 'moderado', evidence: 'varia', reboot: 'nao',
    what: 'O Chrome usa a placa de vídeo para desenhar páginas e vídeos. Desligar resolve tela preta e engasgos com alguns drivers, mas pesa no processador.',
    entries: [e('HKLM', 'SOFTWARE\\Policies\\Google\\Chrome', 'HardwareAccelerationModeEnabled')],
    options: [{ values: [0], label: 'Desligada', kind: 'alternativa' }, { values: [1], label: 'Sempre ligada', kind: 'alternativa' }, { values: [null], label: 'Padrão do Chrome', kind: 'padrao' }] },

  { id: 'usbsuspend', group: 'plano', label: 'Suspensão seletiva de USB', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'O Windows desliga portas USB paradas. Desativar evita mouse, headset ou controle "acordando" com atraso ou desconectando.',
    entries: [pw('2a737441-1930-4402-8d77-b2bebba308a3', '48e6b7a6-50f5-4782-a5d4-53bb8f07e226')],
    options: [{ values: [0], label: 'Desativada', kind: 'alternativa' }, { values: [1], label: 'Ativada (padrão)', kind: 'padrao' }] },
  { id: 'usb3lpm', group: 'plano', label: 'Economia de energia do link USB 3', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'Economia de energia das portas USB 3. Desligada, dispositivos rápidos (SSD externo, placa de captura) não cochilam.',
    entries: [pw('2a737441-1930-4402-8d77-b2bebba308a3', 'd4e98f31-5ffe-4ce1-be31-1b38b384c009')],
    options: [{ values: [0], label: 'Desligada', kind: 'alternativa' }, { values: [1], label: 'Mínima', kind: 'alternativa' }, { values: [2], label: 'Moderada (padrão)', kind: 'padrao' }, { values: [3], label: 'Máxima', kind: 'alternativa' }] },
  { id: 'videoquality', group: 'plano', label: 'Prioridade na reprodução de vídeo', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'Ao tocar vídeo, priorizar qualidade (desempenho) ou economia de energia.',
    entries: [pw('9596fb26-9850-41fd-ac3e-f7c3c00afd4b', '10778347-1370-4ee0-8bbd-33bdacaade49')],
    options: [{ values: [1], label: 'Desempenho (padrão)', kind: 'padrao' }, { values: [0], label: 'Economia', kind: 'alternativa' }] },
  { id: 'playvideo', group: 'plano', label: 'Ao reproduzir vídeo', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'Como o Windows trata a qualidade do vídeo durante a reprodução.',
    entries: [pw('9596fb26-9850-41fd-ac3e-f7c3c00afd4b', '34c7b99f-9a6d-4b3c-8dc7-b6693b78cef4')],
    options: [{ values: [0], label: 'Otimizar a qualidade', kind: 'alternativa' }, { values: [1], label: 'Equilibrado (padrão)', kind: 'padrao' }, { values: [2], label: 'Economizar energia', kind: 'alternativa' }] },
  { id: 'sharemedia', group: 'plano', label: 'Ao compartilhar mídia', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'Se o PC pode dormir enquanto compartilha músicas e vídeos com outros aparelhos da casa.',
    entries: [pw('9596fb26-9850-41fd-ac3e-f7c3c00afd4b', '03680956-93bc-4294-bba6-4e0f09bb717f')],
    options: [{ values: [0], label: 'Pode dormir', kind: 'alternativa' }, { values: [1], label: 'Não dormir (padrão)', kind: 'padrao' }, { values: [2], label: 'Modo ausente', kind: 'alternativa' }] },
  { id: 'waketimers', group: 'plano', label: 'Despertadores (o PC ligar sozinho)', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'Tarefas agendadas e atualizações podem acordar o PC da suspensão. Desativar mantém ele dormindo.',
    entries: [pw('238c9fa8-0aad-41ed-83f4-97be242c8f20', 'bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d')],
    options: [{ values: [0], label: 'Desativados', kind: 'alternativa' }, { values: [2], label: 'Só os importantes', kind: 'alternativa' }, { values: [1], label: 'Ativados (padrão)', kind: 'padrao' }] },
  { id: 'hybridsleep', group: 'plano', label: 'Suspensão híbrida', risk: 'baixo', evidence: 'varia', reboot: 'nao',
    what: 'Ao suspender, o Windows também grava a memória no disco (protege contra queda de energia, mas demora mais e grava gigabytes).',
    entries: [pw('238c9fa8-0aad-41ed-83f4-97be242c8f20', '94ac6d29-73ce-41a6-809f-6363ba21b47e')],
    options: [{ values: [0], label: 'Desligada', kind: 'alternativa' }, { values: [1], label: 'Ligada', kind: 'padrao' }] },
  { id: 'diskidle', group: 'plano', label: 'Desligar o disco rígido parado', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'Depois de quanto tempo parado o HD desliga. Religar um HD demora alguns segundos (o famoso "engasgo" ao abrir uma pasta). Não afeta SSD.',
    entries: [pw('0012ee47-9041-4b5d-9b77-535fba8b1442', '6738e2c4-e8a5-4a42-b16a-e040e769756e')],
    options: [{ values: [0], label: 'Nunca', kind: 'alternativa' }, { values: [3600], label: 'Depois de 1 hora', kind: 'alternativa' }, { values: [1200], label: 'Depois de 20 min (padrão)', kind: 'padrao' }, { values: [600], label: 'Depois de 10 min', kind: 'alternativa' }] },

  svc('DiagTrack', 'Telemetria (Experiências do Usuário Conectado)', 'Coleta e envia dados de diagnóstico o tempo todo. Desligar não quebra nada do dia a dia.', 2, { risk: 'baixo' }),
  svc('dmwappushservice', 'Roteamento de mensagens WAP (telemetria)', 'Auxiliar da telemetria e do gerenciamento corporativo de dispositivos.', 3, { risk: 'baixo' }),
  svc('MapsBroker', 'Gerenciador de Mapas Baixados', 'Só serve para os mapas offline do app Mapas.', 2, { risk: 'baixo', evidence: 'medido' }),
  svc('lfsvc', 'Geolocalização', 'Sem ele, o Windows e os apps não sabem onde o PC está (fuso automático, clima, "encontrar meu dispositivo").', 3),
  svc('RetailDemo', 'Modo de demonstração de loja', 'Só usado em PCs de vitrine.', 3, { risk: 'baixo', evidence: 'medido' }),
  svc('Fax', 'Fax', 'Envio e recebimento de fax pelo modem.', 3, { risk: 'baixo', evidence: 'medido' }),
  svc('Spooler', 'Spooler de impressão', 'Sem ele, nenhuma impressora funciona (nem "Imprimir em PDF"). Só desative se você nunca imprime.', 2),
  svc('WerSvc', 'Relatório de Erros do Windows (serviço)', 'Monta os relatórios quando um programa trava.', 3, { risk: 'baixo' }),
  svc('wisvc', 'Programa Windows Insider', 'Só para quem recebe versões de teste do Windows.', 3, { risk: 'baixo', evidence: 'medido' }),
  svc('PcaSvc', 'Assistente de Compatibilidade de Programas', 'Vigia programas antigos para sugerir modos de compatibilidade.', 2),
  svc('DPS', 'Política de Diagnóstico', 'Detecta problemas e alimenta os solucionadores de problemas do Windows; desligado, eles param de funcionar.', 2),
  svc('TrkWks', 'Rastreamento de Links Distribuídos', 'Mantém atalhos funcionando quando arquivos mudam de lugar entre unidades e PCs da rede.', 2, { risk: 'baixo' }),
  svc('iphlpsvc', 'Auxiliar de IP (IPv6 de transição)', 'Teredo e afins. Alguns jogos online e o app Xbox usam: desligar pode atrapalhar o multijogador.', 2),
  svc('SEMgrSvc', 'Pagamentos e NFC', 'Pagamento por aproximação em notebooks com NFC.', 3, { risk: 'baixo', evidence: 'medido' }),
  svc('PhoneSvc', 'Telefonia', 'Estado de chamadas para o app Vincular ao Celular.', 3, { risk: 'baixo' }),
  svc('WpcMonSvc', 'Controle dos Pais', 'Limites de tempo e filtros da Família Microsoft. Não desative se você usa o controle dos pais.', 3, { risk: 'baixo' }),
  svc('SCardSvr', 'Cartão inteligente', 'Leitores de cartão e tokens, inclusive certificado digital (e-CPF, e-CNPJ). Não desative se você usa.', 3),
  svc('bthserv', 'Suporte a Bluetooth', 'Fones, controles e mouses Bluetooth param de funcionar.', 3),
  svc('WbioSrvc', 'Biometria do Windows', 'O Windows Hello por digital ou rosto para de funcionar.', 3),
  svc('AJRouter', 'Roteador AllJoyn', 'Protocolo antigo de casa inteligente, quase sem uso.', 3, { risk: 'baixo', evidence: 'medido' }),
  svc('icssvc', 'Hotspot móvel', 'Compartilhar a internet do PC por Wi-Fi para de funcionar.', 3, { risk: 'baixo' }),
  svc('WMPNetworkSvc', 'Compartilhamento do Windows Media Player', 'Compartilhar a biblioteca do Media Player com outros aparelhos.', 3, { risk: 'baixo', evidence: 'medido' }),
  svc('diagnosticshub.standardcollector.service', 'Coletor do hub de diagnóstico', 'Usado por ferramentas de desenvolvedor (Visual Studio).', 3, { risk: 'baixo', id: 'svc-diaghub' }),
  svc('XblGameSave', 'Salvamento de jogos Xbox Live', 'Jogos da Xbox e do Game Pass param de sincronizar o progresso na nuvem.', 3),
  svc('XboxNetApiSvc', 'Rede Xbox Live', 'O multijogador de jogos da Xbox e do Game Pass pode falhar.', 3),
  svc('XboxGipSvc', 'Acessórios Xbox', 'Atualização de firmware e configurações dos controles Xbox.', 3),
  svc('WalletService', 'Carteira', 'Carteira de cartões e passes; quase sem uso no Brasil.', 3, { risk: 'baixo', evidence: 'medido' }),
  svc('Wecsvc', 'Coletor de Eventos', 'Recebe registros de eventos de outros PCs (redes de empresa).', 3, { risk: 'baixo', evidence: 'medido' }),
  svc('TabletInputService', 'Teclado virtual e escrita à mão', 'Teclado da tela, painel de emojis (Win+.) e caneta. Desativar quebra o painel de emojis.', 3),
  svc('CscService', 'Arquivos Offline', 'Sincroniza pastas da rede para usar sem conexão (redes de empresa).', 3, { risk: 'baixo', evidence: 'medido' })
];

/** O que o Nexo encontra, explica e se recusa a mudar (deixa o PC menos seguro por um ganho pequeno ou nenhum). */
const REFUSED = [
  { id: 'antivirus', label: 'Desligar o antivírus do Windows', reason: 'Ganho de desempenho pequeno e o PC fica aberto a qualquer arquivo malicioso. Se um jogo específico sofre, uma exclusão de pasta no próprio antivírus resolve melhor.' },
  { id: 'vbs', label: 'Desligar a integridade de memória e a segurança baseada em virtualização', reason: 'Pode render alguns quadros em processadores antigos, mas tira a proteção contra drivers maliciosos. O Nexo só mostra o estado (abaixo) e onde mudar, se você decidir por conta própria.' },
  { id: 'mitigations', label: 'Desligar as proteções do processador contra Spectre e Meltdown', reason: 'Expõe senhas e dados da memória a sites e programas maliciosos.' },
  { id: 'uac', label: 'Desligar o Controle de Conta de Usuário (UAC)', reason: 'Qualquer programa passaria a mexer no sistema sem pedir permissão. Não muda o desempenho.' },
  { id: 'updates', label: 'Desligar as atualizações do Windows', reason: 'Correções de segurança param de chegar. Para não ser interrompido em jogo, o Modo de Jogo e o horário ativo já seguram as atualizações.' },
  { id: 'myths', label: '"Limpar a RAM" à força de tempos em tempos', reason: 'Mito: memória livre é memória desperdiçada. Esvaziar a RAM obriga o Windows a ler tudo do disco de novo. (LargeSystemCache, DisablePagingExecutive e o Prefetch estão na lista, marcados como "quase mito", para quem quiser testar.)' },
  { id: 'core-services', label: 'Desligar serviços essenciais (Windows Update, Segurança do Windows, Instalador, Áudio, DNS, DHCP, Firewall)', reason: 'Quebram o Windows, a internet ou a proteção do PC. O Nexo só oferece serviços que dá para desligar sem perder o sistema, e diz o que cada um faz.' },
  { id: 'remote', label: 'Ligar o Registro Remoto ou a Área de Trabalho Remota', reason: 'Abrem o PC para outros computadores da rede. Não mudam o desempenho.' }
];

const byId = new Map(TWEAKS.map((tweak) => [tweak.id, tweak]));
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const psPath = (entry) => `${entry.hive === 'HKCU' ? 'HKCU:' : 'HKLM:'}\\${entry.key}`;

/** Valida um valor para gravar: DWORD inteiro, texto curto e simples, ou null (apagar o valor). */
function validValue(entry, value) {
  if (entry.kind === 'power') return Number.isInteger(value) && value >= 0 && value <= DWORD_MAX;
  if (value === null) return true;
  if (entry.type === 'dword') return Number.isInteger(value) && value >= 0 && value <= DWORD_MAX;
  return typeof value === 'string' && SAFE_STRING.test(value);
}

/**
 * Confere um pedido vindo da interface. `revert: true` aceita o valor anterior guardado no Diário (qualquer valor
 * válido para o tipo, ou null); sem ele, só as opções do catálogo.
 */
function validateChange(change) {
  const tweak = byId.get(change?.id);
  if (!tweak) throw new Error('Ajuste fora do catálogo do Raio-X.');
  const values = change.values;
  if (!Array.isArray(values) || values.length !== tweak.entries.length) throw new Error(`${tweak.label}: valores inválidos.`);
  if (change.revert === true) {
    if (!tweak.entries.every((entry, index) => validValue(entry, values[index]))) throw new Error(`${tweak.label}: valor anterior inválido.`);
  } else if (!tweak.options.some((option) => option.values.every((value, index) => value === values[index]))) {
    throw new Error(`${tweak.label}: essa opção não faz parte do catálogo.`);
  }
  for (const entry of tweak.entries) {
    if (!SAFE_KEY.test(entry.key) || !SAFE_NAME.test(entry.name) || !HIVES[entry.hive]) throw new Error('Catálogo inválido.');
    if (entry.kind === 'power' && (!GUID.test(entry.sub) || !GUID.test(entry.setting))) throw new Error('Catálogo inválido.');
  }
  return tweak;
}

/** Script de leitura (sem permissão especial): todos os valores do catálogo + estado de segurança, em JSON. */
function readScript() {
  const lines = [];
  TWEAKS.forEach((tweak) => tweak.entries.forEach((entry, index) => {
    if (entry.kind === 'power') return;
    lines.push(`$out[${psQuote(`${tweak.id}#${index}`)}] = Read-Value ${psQuote(psPath(entry))} ${psQuote(entry.name)}`);
  }));
  return String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function Read-Value($path, $name) {
  try {
    $item = Get-ItemProperty -LiteralPath $path -Name $name -ErrorAction Stop; $value = $item.$name
    # DWORD vem como Int32 com sinal (0x80000002 = negativo): devolve os mesmos bits sem sinal.
    if ($value -is [int]) { return [long][BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$value), 0) }
    if ($value -is [long] -or $value -is [uint32]) { return [long]$value }
    return [string]$value
  } catch { return $null }
}
$out = @{}
${lines.join('\n')}
$vbs = $null
try { $g = Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop; $vbs = [int]$g.VirtualizationBasedSecurityStatus } catch {}
$out['__vbs'] = $vbs
[Console]::Out.Write(($out | ConvertTo-Json -Compress))`;
}

/**
 * Corpo do script elevado (HKLM). Só entradas do catálogo, valores já validados.
 * Compacto (funções curtas + tabela de caminhos) para caber até centenas de valores numa única elevação, e cada
 * passo isolado: se o Windows recusar um valor, os outros seguem e o ajuste recusado volta na lista "failed".
 */
const PATH_PREFIXES = [['$A', 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\'], ['$B', 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\'], ['$C', 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\'], ['$E', 'HKLM:\\SOFTWARE\\Microsoft\\']];
// ~10,5 mil caracteres viram ~28 mil em -EncodedCommand (UTF-16 + base64); a linha de comando do Windows aceita 32 767.
const ELEVATED_LIMIT = 10500;
const ELEVATED_PRELUDE = [
  // DWORD acima de 0x7FFFFFFF precisa ir como Int32 com os mesmos bits (o New-ItemProperty só aceita Int32).
  'function U($v) { [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$v), 0) }',
  'function S($p, $n, $t, $v) { if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null }; New-ItemProperty -LiteralPath $p -Name $n -PropertyType $t -Value $v -Force | Out-Null }',
  'function D($p, $n) { if (Test-Path -LiteralPath $p) { Remove-ItemProperty -LiteralPath $p -Name $n -ErrorAction SilentlyContinue } }'
];
function elevatedBody(changes) {
  const paths = [];
  const pathIndex = (entry) => {
    const path = psPath(entry);
    let index = paths.indexOf(path);
    if (index < 0) { paths.push(path); index = paths.length - 1; }
    return index;
  };
  const steps = [];
  for (const change of changes) {
    const tweak = validateChange(change);
    const parts = [];
    tweak.entries.forEach((entry, index) => {
      if (entry.hive !== 'HKLM') return;
      const value = change.values[index];
      const where = `$P[${pathIndex(entry)}]`;
      if (value === null) parts.push(`D ${where} ${psQuote(entry.name)}`);
      else parts.push(`S ${where} ${psQuote(entry.name)} ${entry.type === 'dword' ? `DWord (U ${value})` : `String ${psQuote(value)}`}`);
    });
    if (parts.length) steps.push(`try { ${parts.join('; ')}; $r.steps++ } catch { $r.failed += ${psQuote(tweak.id)} }`);
  }
  if (!steps.length) return { prelude: [], steps: [] };
  // Prefixos comuns encurtam a tabela (o script inteiro vai na linha de comando, que tem limite de tamanho).
  const short = (path) => {
    for (const [variable, prefix] of PATH_PREFIXES) if (path.startsWith(prefix)) return `(${variable} + ${psQuote(path.slice(prefix.length))})`;
    return psQuote(path);
  };
  return { prelude: [...ELEVATED_PRELUDE, ...PATH_PREFIXES.map(([variable, prefix]) => `${variable} = ${psQuote(prefix)}`), `$P = @(${paths.map(short).join(', ')})`], steps };
}

/** Tamanho aproximado do corpo elevado (para dividir em mais de uma elevação só se passar do limite seguro). */
function elevatedSize(changes) {
  const { prelude, steps } = elevatedBody(changes);
  return [...prelude, ...steps].join('\n').length + 400;
}
/** Agrupa as mudanças de HKLM em blocos que cabem na linha de comando (normalmente um bloco só = um UAC). */
function elevationChunks(changes, limit = ELEVATED_LIMIT) {
  const chunks = [];
  let current = [];
  for (const change of changes) {
    if (current.length && elevatedSize([...current, change]) > limit) { chunks.push(current); current = []; }
    current.push(change);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Interpreta a leitura: valor atual de cada entrada, a opção que bate (ou "personalizado") e o status. */
function interpret(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const items = TWEAKS.map((tweak) => {
    const values = tweak.entries.map((entry, index) => {
      const value = data[`${tweak.id}#${index}`];
      if (value === null || value === undefined || value === '') return null;
      if (entry.type === 'dword') { const number = Number(value); return Number.isFinite(number) ? number : null; }
      return String(value);
    });
    // Valor ausente = o que o Windows usa por padrão (def), para reconhecer a opção certa.
    const effective = values.map((value, index) => (value === null ? tweak.entries[index].def : value));
    // Plano de energia: só os índices que este PC aceita (vêm do powercfg /qh).
    let options = tweak.options;
    tweak.entries.forEach((entry, index) => {
      if (entry.kind !== 'power') return;
      const accepted = data[`__indexes:${tweak.id}#${index}`];
      const range = data[`__range:${tweak.id}#${index}`];
      if (Array.isArray(accepted) && accepted.length) options = options.filter((option) => accepted.includes(option.values[index]));
      else if (Array.isArray(range) && range.length === 2) options = options.filter((option) => option.values[index] >= range[0] && option.values[index] <= range[1]);
    });
    const needsValue = tweak.requiresExisting || tweak.entries.some((entry) => entry.kind === 'power');
    const available = (!needsValue || values.every((value) => value !== null)) && options.length >= 2;
    const match = options.find((option) => option.values.every((value, index) => value === values[index]))
      || options.find((option) => option.values.every((value, index) => (value === null ? effective[index] === null : value === effective[index])));
    return { id: tweak.id, group: tweak.group, label: tweak.label, what: tweak.what, risk: tweak.risk, evidence: tweak.evidence, reboot: tweak.reboot, available,
      admin: tweak.entries.some((entry) => entry.hive === 'HKLM'), values, current: !available ? 'Não existe neste PC' : match ? match.label : 'Personalizado', currentKind: match?.kind || 'personalizado',
      options: options.map((option) => ({ values: option.values, label: option.label, kind: option.kind })) };
  });
  const vbs = Number.isInteger(data.__vbs) ? data.__vbs : null;
  const usable = items.filter((item) => item.available);
  return { items, groups: GROUPS, stats: { settings: usable.length, options: usable.reduce((total, item) => total + item.options.length, 0), catalog: catalogStats() },
    vbs: vbs === 2 ? 'ativa' : vbs === 1 ? 'ligada, sem rodar' : vbs === 0 ? 'desligada' : 'desconhecido', refused: REFUSED };
}

/** Tamanho do catálogo inteiro (para mostrar na interface e nos testes). */
function catalogStats() {
  return { settings: TWEAKS.length, options: TWEAKS.reduce((total, tweak) => total + tweak.options.length, 0) };
}

/** Junta a leitura do plano de energia ativo (powercfg /qh scheme_current) às chaves "<id>#<i>" da leitura do registro. */
function mergePower(parsed, dump) {
  const out = { ...parsed };
  for (const tweak of TWEAKS) {
    tweak.entries.forEach((entry, index) => {
      if (entry.kind !== 'power') return;
      const found = dump?.[`${entry.sub}/${entry.setting}`];
      out[`${tweak.id}#${index}`] = found && Number.isInteger(found.ac) ? found.ac : null;
      if (found?.indexes?.length) out[`__indexes:${tweak.id}#${index}`] = found.indexes;
      else if (found && Number.isInteger(found.min) && Number.isInteger(found.max)) out[`__range:${tweak.id}#${index}`] = [found.min, found.max];
    });
  }
  return out;
}

function createSystemScan({ runPowerShell, run, elevate, platform = process.platform }) {
  async function readPower() {
    try {
      const { parseQueryAll } = require('./lab-system.cjs');
      const result = await run('powercfg', ['/qh', 'scheme_current']);
      return result.code === 0 ? parseQueryAll(result.stdout) : {};
    } catch { return {}; }
  }
  async function scan() {
    if (platform !== 'win32') return { supported: false, items: [], refused: REFUSED, vbs: 'desconhecido', groups: GROUPS, stats: { settings: 0, options: 0, catalog: catalogStats() } };
    const [result, power] = await Promise.all([runPowerShell(readScript(), 30000), readPower()]);
    let parsed = {};
    try { parsed = JSON.parse(String(result.stdout || '{}').trim() || '{}'); } catch { parsed = {}; }
    return { supported: true, scannedAt: Date.now(), ...interpret(mergePower(parsed, power)) };
  }

  /**
   * Aplica (ou reverte) mudanças. HKCU direto pelo reg.exe; plano de energia pelo powercfg; HKLM juntas numa única
   * elevação. Um valor recusado não derruba os outros: volta em "failed" (o Diário só guarda o que foi gravado).
   */
  async function apply(changes, { deferElevation = false } = {}) {
    if (platform !== 'win32') throw new Error('O Raio-X funciona no Windows.');
    const list = (Array.isArray(changes) ? changes : []).slice(0, MAX_CHANGES);
    if (!list.length) throw new Error('Nada para aplicar.');
    const tweaks = list.map(validateChange);
    const failed = new Set();
    let powerChanged = false;
    for (const [i, tweak] of tweaks.entries()) {
      for (const [index, entry] of tweak.entries.entries()) {
        const value = list[i].values[index];
        if (entry.hive === 'HKCU') {
          const key = `HKCU\\${entry.key}`;
          const args = value === null ? ['delete', key, '/v', entry.name, '/f'] : ['add', key, '/v', entry.name, '/t', entry.type === 'dword' ? 'REG_DWORD' : 'REG_SZ', '/d', String(value), '/f'];
          const outcome = await run('reg', args);
          if (outcome.code !== 0 && value !== null) failed.add(tweak.id);
        } else if (entry.kind === 'power') {
          const outcome = await run('powercfg', ['/setacvalueindex', 'scheme_current', entry.sub, entry.setting, String(value)]);
          if (outcome.code !== 0) failed.add(tweak.id); else powerChanged = true;
        }
      }
    }
    if (powerChanged) await run('powercfg', ['/setactive', 'scheme_current']);
    const elevatedIds = tweaks.filter((tweak) => tweak.entries.some((entry) => entry.hive === 'HKLM')).map((tweak) => tweak.id);
    /* O otimizador junta a parte de HKLM no lote dele (uma permissão do Windows para tudo): aqui só HKCU e plano. */
    if (deferElevation) return { ok: failed.size === 0, failed: [...failed], deferred: list.filter((change) => elevatedIds.includes(change.id)) };
    let declined = false;
    for (const chunk of elevationChunks(list.filter((change) => elevatedIds.includes(change.id)))) {
      const ids = chunk.map((change) => change.id);
      if (declined) { ids.forEach((id) => failed.add(id)); continue; }
      const elevated = await elevate('registry-tweaks', { changes: chunk });
      if (elevated?.declined) { declined = true; ids.forEach((id) => failed.add(id)); }
      else if (!elevated?.result || !elevated.result.ok) ids.forEach((id) => failed.add(id));
      else for (const id of Array.isArray(elevated.result.failed) ? elevated.result.failed : [elevated.result.failed].filter(Boolean)) failed.add(String(id));
    }
    if (failed.size === tweaks.length) throw new Error(declined ? 'Você recusou a permissão do Windows; os ajustes do sistema não foram aplicados.' : 'O Windows não aceitou nenhum dos ajustes.');
    return { ok: failed.size === 0, failed: [...failed], declined, after: await scan() };
  }

  return { scan, apply };
}

module.exports = { createSystemScan, TWEAKS, REFUSED, GROUPS, EVIDENCE, validateChange, elevatedBody, elevationChunks, elevatedSize, readScript, interpret, mergePower, catalogStats, DWORD_MAX, MAX_CHANGES, ELEVATED_PRELUDE, ELEVATED_LIMIT };
