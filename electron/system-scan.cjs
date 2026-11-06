/*
 * Raio-X do PC (Windows): varre o registro e o sistema atrás de ajustes de desempenho, mostra o valor atual, o que
 * a evidência diz de cada um e deixa a pessoa aplicar ou reverter.
 *
 * Regras:
 *  - catálogo FECHADO: só as chaves e os valores desta lista. Nada é montado a partir do que vem da interface;
 *  - ler não pede nada; gravar em HKCU não pede permissão; gravar em HKLM passa por UMA elevação (UAC) por vez;
 *  - todo valor anterior é guardado (inclusive "não existia") para a reversão pelo Diário;
 *  - o que reduz a segurança do PC (antivírus, integridade de memória, mitigações do processador, UAC, atualizações)
 *    fica na lista de recusados: aparece com o motivo, nunca é aplicado.
 */

const DWORD_MAX = 0xffffffff;
const HIVES = { HKCU: 'HKCU', HKLM: 'HKLM' };
const SAFE_KEY = /^[A-Za-z0-9 _\\.\-()]+$/;
const SAFE_NAME = /^[A-Za-z0-9 _\-.]+$/;
const SAFE_STRING = /^[A-Za-z0-9 _.\-]{0,40}$/;

const GROUPS = {
  jogos: 'Jogos e captura',
  agendador: 'Agendador e prioridades',
  energia: 'Energia',
  disco: 'Disco e arquivos',
  interface: 'Interface',
  entrada: 'Mouse e teclado',
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
      { values: [22], label: 'Longo e variável (0x16)', kind: 'alternativa' }, { values: [24], label: 'Longo e fixo (0x18)', kind: 'alternativa' }, { values: [2], label: 'Padrão do Windows (2)', kind: 'padrao' }] },
  { id: 'sysresp', group: 'agendador', label: 'Reserva para tarefas de segundo plano (MMCSS)', risk: 'baixo', evidence: 'controverso', reboot: 'reiniciar',
    what: 'Quanto do processador o agendador multimídia guarda para o resto do sistema enquanto áudio e vídeo tocam.',
    entries: [e('HKLM', MMCSS, 'SystemResponsiveness', 'dword', 20)],
    options: [{ values: [10], label: 'Mínima (10%)', kind: 'alternativa' }, { values: [20], label: 'Padrão (20%)', kind: 'padrao' }] },
  { id: 'netthrottle', group: 'agendador', label: 'Limite de rede durante multimídia', risk: 'baixo', evidence: 'controverso', reboot: 'reiniciar',
    what: 'O Windows limita pacotes de rede que não são multimídia enquanto algo toca. Desligar ajuda pouco em jogos online, mas não costuma prejudicar.',
    entries: [e('HKLM', MMCSS, 'NetworkThrottlingIndex', 'dword', 10)],
    options: [{ values: [DWORD_MAX], label: 'Sem limite', kind: 'alternativa' }, { values: [10], label: 'Padrão (10)', kind: 'padrao' }] },
  { id: 'mmcssgames', group: 'agendador', label: 'Prioridade da tarefa "Games" do MMCSS', risk: 'baixo', evidence: 'mito', reboot: 'reiniciar',
    what: 'Só vale para jogos que se registram no agendador multimídia (poucos fazem). Famoso em listas de "tweaks", com efeito raramente medido.',
    entries: [e('HKLM', `${MMCSS}\\Tasks\\Games`, 'GPU Priority', 'dword', 8), e('HKLM', `${MMCSS}\\Tasks\\Games`, 'Priority', 'dword', 2), e('HKLM', `${MMCSS}\\Tasks\\Games`, 'Scheduling Category', 'string', 'Medium'), e('HKLM', `${MMCSS}\\Tasks\\Games`, 'SFIO Priority', 'string', 'Normal')],
    options: [{ values: [8, 6, 'High', 'High'], label: 'Alta', kind: 'alternativa' }, { values: [8, 2, 'Medium', 'Normal'], label: 'Padrão', kind: 'padrao' }] },
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
    options: [{ values: [0x80000001], label: 'Não registrar', kind: 'recomendado' }, { values: [0x80000002], label: 'O sistema decide (padrão)', kind: 'padrao' }] },
  { id: 'shortnames', group: 'disco', label: 'Nomes curtos 8.3', risk: 'moderado', evidence: 'medido', reboot: 'reiniciar',
    what: 'O Windows cria um segundo nome curto (ARQUIV~1) para cada arquivo, por compatibilidade com programas muito antigos.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'NtfsDisable8dot3NameCreation', 'dword', 2)],
    options: [{ values: [1], label: 'Não criar em nenhuma unidade', kind: 'alternativa' }, { values: [2], label: 'Por unidade (padrão)', kind: 'padrao' }] },

  { id: 'sysmain', group: 'servicos', label: 'SysMain (Superfetch)', risk: 'moderado', evidence: 'controverso', reboot: 'reiniciar',
    what: 'Pré-carrega na memória os programas que você mais usa. Em HD ajuda bastante; em SSD rápido, o ganho é pequeno e há quem prefira desligar.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\SysMain', 'Start', 'dword', 2)],
    options: [{ values: [4], label: 'Desativado', kind: 'alternativa' }, { values: [2], label: 'Automático (padrão)', kind: 'padrao' }] },
  { id: 'wsearch', group: 'servicos', label: 'Indexação da busca do Windows', risk: 'moderado', evidence: 'varia', reboot: 'reiniciar',
    what: 'Mantém um índice dos arquivos para a busca ser instantânea. Desligar tira o trabalho em segundo plano, mas a busca fica lenta.',
    entries: [e('HKLM', 'SYSTEM\\CurrentControlSet\\Services\\WSearch', 'Start', 'dword', 2)],
    options: [{ values: [4], label: 'Desativada', kind: 'alternativa' }, { values: [2], label: 'Automática (padrão)', kind: 'padrao' }] },

  { id: 'transparency', group: 'interface', label: 'Transparência das janelas', risk: 'baixo', evidence: 'medido', reboot: 'nao',
    what: 'O efeito de vidro da barra de tarefas e do menu Iniciar. Desligar alivia placas de vídeo integradas.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 'dword', 1)],
    options: [{ values: [0], label: 'Desligada', kind: 'alternativa' }, { values: [1], label: 'Ligada (padrão)', kind: 'padrao' }] },
  { id: 'visualfx', group: 'interface', label: 'Efeitos visuais do Windows', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Animações e sombras do Windows. "Melhor desempenho" desliga tudo de uma vez; em PCs fracos, a diferença é visível.',
    entries: [e('HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', 'VisualFXSetting', 'dword', 0)],
    options: [{ values: [2], label: 'Melhor desempenho', kind: 'alternativa' }, { values: [0], label: 'O Windows escolhe (padrão)', kind: 'padrao' }] },
  { id: 'menudelay', group: 'interface', label: 'Atraso para abrir menus', risk: 'baixo', evidence: 'medido', reboot: 'sessao',
    what: 'Quanto tempo o Windows espera antes de abrir um submenu ao passar o mouse.',
    entries: [e('HKCU', 'Control Panel\\Desktop', 'MenuShowDelay', 'string', '400')],
    options: [{ values: ['100'], label: '100 ms', kind: 'recomendado' }, { values: ['0'], label: 'Sem atraso', kind: 'alternativa' }, { values: ['400'], label: '400 ms (padrão)', kind: 'padrao' }] },
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
    options: [{ values: [50, 50], label: '50', kind: 'alternativa' }, { values: [100, 100], label: '100 (padrão)', kind: 'padrao' }] }
];

/** O que o Nexo encontra, explica e se recusa a mudar (deixa o PC menos seguro por um ganho pequeno ou nenhum). */
const REFUSED = [
  { id: 'antivirus', label: 'Desligar o antivírus do Windows', reason: 'Ganho de desempenho pequeno e o PC fica aberto a qualquer arquivo malicioso. Se um jogo específico sofre, uma exclusão de pasta no próprio antivírus resolve melhor.' },
  { id: 'vbs', label: 'Desligar a integridade de memória e a segurança baseada em virtualização', reason: 'Pode render alguns quadros em processadores antigos, mas tira a proteção contra drivers maliciosos. O Nexo só mostra o estado (abaixo) e onde mudar, se você decidir por conta própria.' },
  { id: 'mitigations', label: 'Desligar as proteções do processador contra Spectre e Meltdown', reason: 'Expõe senhas e dados da memória a sites e programas maliciosos.' },
  { id: 'uac', label: 'Desligar o Controle de Conta de Usuário (UAC)', reason: 'Qualquer programa passaria a mexer no sistema sem pedir permissão. Não muda o desempenho.' },
  { id: 'updates', label: 'Desligar as atualizações do Windows', reason: 'Correções de segurança param de chegar. Para não ser interrompido em jogo, o Modo de Jogo e o horário ativo já seguram as atualizações.' },
  { id: 'myths', label: '"Limpar a RAM", LargeSystemCache, DisablePagingExecutive, desligar o Prefetch', reason: 'Mitos: no Windows 10 e 11, esses ajustes não aceleram (alguns pioram). Memória livre é memória desperdiçada.' }
];

const byId = new Map(TWEAKS.map((tweak) => [tweak.id, tweak]));
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const psPath = (entry) => `${entry.hive === 'HKCU' ? 'HKCU:' : 'HKLM:'}\\${entry.key}`;

/** Valida um valor para gravar: DWORD inteiro, texto curto e simples, ou null (apagar o valor). */
function validValue(entry, value) {
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
  for (const entry of tweak.entries) if (!SAFE_KEY.test(entry.key) || !SAFE_NAME.test(entry.name) || !HIVES[entry.hive]) throw new Error('Catálogo inválido.');
  return tweak;
}

/** Script de leitura (sem permissão especial): todos os valores do catálogo + estado de segurança, em JSON. */
function readScript() {
  const lines = [];
  TWEAKS.forEach((tweak) => tweak.entries.forEach((entry, index) => {
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

/** Corpo do script elevado (HKLM). Só entradas do catálogo, valores já validados. */
function elevatedBody(changes) {
  const steps = [];
  for (const change of changes) {
    const tweak = validateChange(change);
    tweak.entries.forEach((entry, index) => {
      if (entry.hive !== 'HKLM') return;
      const value = change.values[index];
      const path = psQuote(psPath(entry));
      if (value === null) steps.push(`Remove-ItemProperty -LiteralPath ${path} -Name ${psQuote(entry.name)} -ErrorAction SilentlyContinue`);
      else {
        // DWORD acima de 0x7FFFFFFF precisa ir como Int32 com os mesmos bits (o New-ItemProperty só aceita Int32).
        const typed = entry.type === 'dword' ? `([BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]${value}), 0))` : psQuote(value);
        steps.push(`if (-not (Test-Path -LiteralPath ${path})) { New-Item -Path ${path} -Force | Out-Null }; New-ItemProperty -LiteralPath ${path} -Name ${psQuote(entry.name)} -PropertyType ${entry.type === 'dword' ? 'DWord' : 'String'} -Value ${typed} -Force | Out-Null`);
      }
    });
  }
  return steps;
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
    const match = tweak.options.find((option) => option.values.every((value, index) => value === values[index]))
      || tweak.options.find((option) => option.values.every((value, index) => (value === null ? effective[index] === null : value === effective[index])));
    return { id: tweak.id, group: tweak.group, label: tweak.label, what: tweak.what, risk: tweak.risk, evidence: tweak.evidence, reboot: tweak.reboot,
      admin: tweak.entries.some((entry) => entry.hive === 'HKLM'), values, current: match ? match.label : 'Personalizado', currentKind: match?.kind || 'personalizado',
      options: tweak.options.map((option) => ({ values: option.values, label: option.label, kind: option.kind })) };
  });
  const vbs = Number.isInteger(data.__vbs) ? data.__vbs : null;
  return { items, vbs: vbs === 2 ? 'ativa' : vbs === 1 ? 'ligada, sem rodar' : vbs === 0 ? 'desligada' : 'desconhecido', refused: REFUSED };
}

function createSystemScan({ runPowerShell, run, elevate, platform = process.platform }) {
  async function scan() {
    if (platform !== 'win32') return { supported: false, items: [], refused: REFUSED, vbs: 'desconhecido' };
    const result = await runPowerShell(readScript(), 30000);
    let parsed = {};
    try { parsed = JSON.parse(String(result.stdout || '{}').trim() || '{}'); } catch { parsed = {}; }
    return { supported: true, scannedAt: Date.now(), ...interpret(parsed) };
  }

  /** Aplica (ou reverte) mudanças. HKCU direto pelo reg.exe; HKLM juntas numa única elevação. */
  async function apply(changes) {
    if (platform !== 'win32') throw new Error('O Raio-X funciona no Windows.');
    const list = (Array.isArray(changes) ? changes : []).slice(0, 40);
    if (!list.length) throw new Error('Nada para aplicar.');
    const tweaks = list.map(validateChange);
    for (const [i, tweak] of tweaks.entries()) {
      for (const [index, entry] of tweak.entries.entries()) {
        if (entry.hive !== 'HKCU') continue;
        const value = list[i].values[index];
        const key = `HKCU\\${entry.key}`;
        const args = value === null ? ['delete', key, '/v', entry.name, '/f'] : ['add', key, '/v', entry.name, '/t', entry.type === 'dword' ? 'REG_DWORD' : 'REG_SZ', '/d', String(value), '/f'];
        const outcome = await run('reg', args);
        if (outcome.code !== 0 && value !== null) throw new Error(`${tweak.label}: o Windows recusou a gravação.`);
      }
    }
    let declined = false;
    if (tweaks.some((tweak) => tweak.entries.some((entry) => entry.hive === 'HKLM'))) {
      const elevated = await elevate('registry-tweaks', { changes: list });
      declined = Boolean(elevated?.declined);
      if (declined) throw new Error('Você recusou a permissão do Windows; os ajustes do sistema não foram aplicados.');
      if (!elevated?.result?.ok) throw new Error(`O Windows não confirmou a gravação${elevated?.result?.note ? `: ${String(elevated.result.note).slice(0, 160)}` : '.'}`);
    }
    return { ok: true, after: await scan() };
  }

  return { scan, apply };
}

module.exports = { createSystemScan, TWEAKS, REFUSED, GROUPS, EVIDENCE, validateChange, elevatedBody, readScript, interpret, DWORD_MAX };
