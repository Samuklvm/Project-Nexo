/*
 * Ações do "Otimizar este PC" (Windows): catálogo FECHADO do que o otimizador pode gravar, os validadores e os
 * trechos de PowerShell do lote elevado.
 *
 * Regras (as mesmas do Raio-X):
 *  - nada é montado a partir de texto livre vindo da interface: cada mudança é de um tipo conhecido, com campos
 *    conferidos por expressão regular e valores de uma lista fixa;
 *  - o valor ANTERIOR de cada mudança é lido no processo principal e guardado lá (a interface nunca manda o valor
 *    que vai ser gravado na reversão);
 *  - nada aqui desliga proteção do Windows (antivírus, UAC, atualizações, mitigações): programas de segurança nem
 *    entram na lista do que pode sair do início.
 *
 * Funções puras: o processo principal (electron/optimizer-system.cjs) lê o PC e executa; o elevate.cjs monta o lote.
 */
'use strict';

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/* ---------- Início com o Windows (o mesmo mecanismo do Gerenciador de Tarefas) ---------- */
const APPROVED_BASE = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
const PACKAGED_BASE = 'Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\SystemAppData';
/** Onde cada item do início mora e onde fica o "ligado/desligado" dele. */
const STARTUP_SOURCES = Object.freeze({
  'user-run': { hive: 'HKCU', approved: 'Run', elevated: false, label: 'Registro do usuário' },
  'machine-run': { hive: 'HKLM', approved: 'Run', elevated: true, label: 'Registro do PC (todos os usuários)' },
  'machine-run32': { hive: 'HKLM', approved: 'Run32', elevated: true, label: 'Registro do PC (programas de 32 bits)' },
  'user-folder': { hive: 'HKCU', approved: 'StartupFolder', elevated: false, label: 'Pasta Inicializar do usuário' },
  'machine-folder': { hive: 'HKLM', approved: 'StartupFolder', elevated: true, label: 'Pasta Inicializar de todos' },
  packaged: { hive: 'HKCU', elevated: false, label: 'App da Microsoft Store' }
});
// Nome do valor no registro ou do atalho na pasta: sem caracteres de controle, aspas, barra invertida ou crase.
const STARTUP_NAME = /^[^\u0000-\u001f"\\`]{1,200}$/;
const PACKAGE_PART = /^[A-Za-z0-9._-]{1,128}$/;
const HEX_APPROVED = /^[0-9A-F]{2,64}$/;
const ENABLED_BYTES = '020000000000000000000000';

/** Ligado? StartupApproved: sem valor = ligado; primeiro byte par (02, 06) = ligado, ímpar (03, 07) = desligado. */
function approvedEnabled(hex) {
  if (hex === null || hex === undefined || hex === '') return true;
  const first = parseInt(String(hex).slice(0, 2), 16);
  return Number.isInteger(first) ? (first & 1) === 0 : true;
}
/** Apps da Loja (StartupTask State): 2 ligado, 4 ligado por política; 0, 1 e 3 desligado. */
const packagedEnabled = (state) => state === 2 || state === 4;

/** 03 00 00 00 + a hora (FILETIME) em que foi desligado, como o Gerenciador de Tarefas grava. */
function disabledBytes(now = Date.now()) {
  const ticks = (BigInt(Math.max(0, Math.floor(now))) + 11644473600000n) * 10000n;
  let hex = '';
  for (let i = 0n; i < 8n; i += 1n) hex += Number((ticks >> (8n * i)) & 0xffn).toString(16).padStart(2, '0');
  return `03000000${hex}`.toUpperCase();
}

function validStartupTarget(change) {
  const source = STARTUP_SOURCES[change?.source];
  if (!source) throw new Error('Origem do item do início inválida.');
  if (change.source === 'packaged') {
    const [family, task, extra] = String(change.name || '').split('\\');
    if (extra !== undefined || !PACKAGE_PART.test(family || '') || !PACKAGE_PART.test(task || '')) throw new Error('App da Loja inválido.');
    return source;
  }
  if (!STARTUP_NAME.test(String(change.name || ''))) throw new Error('Nome do item do início inválido.');
  return source;
}
const approvedKey = (source, hiveStyle = 'ps') => `${hiveStyle === 'ps' ? `${STARTUP_SOURCES[source].hive}:` : STARTUP_SOURCES[source].hive}\\${APPROVED_BASE}\\${STARTUP_SOURCES[source].approved}`;
const packagedKey = (name, hiveStyle = 'ps') => `${hiveStyle === 'ps' ? 'HKCU:' : 'HKCU'}\\${PACKAGED_BASE}\\${name}`;

/* ---------- Jogo escolhido ---------- */
const SAFE_WIN_PATH = /^[A-Za-z]:\\[^"'`$;|&<>\r\n*?%]{1,400}\.exe$/i;
const EXE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.()+-]{0,80}\.exe$/i;
/* Nunca: partes do Windows, segurança, antitrapaça, shells e o próprio Nexo. Prioridade e QoS são só para jogos. */
const PROTECTED_EXE = /^(explorer|svchost|csrss|wininit|winlogon|lsass|lsaiso|services|smss|dwm|audiodg|conhost|ctfmon|fontdrvhost|sihost|taskhostw|runtimebroker|searchhost|searchindexer|startmenuexperiencehost|shellexperiencehost|textinputhost|msmpeng|nissrv|mpdefendercoreservice|securityhealthservice|securityhealthsystray|smartscreen|spoolsv|rundll32|regsvr32|dllhost|wmiprvse|powershell|pwsh|cmd|wscript|cscript|mshta|regedit|mmc|taskmgr|msiexec|trustedinstaller|tiworker|wuauclt|usoclient|consent|logonui|lockapp|winget|nexo[\w .-]*|electron|vgc|vgtray|easyanticheat[\w-]*|eac_launcher|beservice[\w-]*|battleye[\w-]*|faceit[\w-]*|ace-[\w-]*|anticheatexpert[\w-]*|nprotect[\w-]*|gameguard[\w-]*|xigncode[\w-]*|steam|steamwebhelper|epicgameslauncher|riotclientservices|battle\.net)\.exe$/i;

function validExeName(exe) {
  const name = String(exe || '');
  if (!EXE_NAME.test(name)) throw new Error('Executável do jogo inválido.');
  if (PROTECTED_EXE.test(name)) throw new Error('Esse programa não é um jogo; o Nexo não mexe nele.');
  return name;
}
function validExePath(file) {
  const value = String(file || '');
  if (!SAFE_WIN_PATH.test(value) || value.includes('..')) throw new Error('Caminho do jogo inválido.');
  validExeName(value.split('\\').pop());
  return value;
}

/** "GpuPreference=2;SwapEffectUpgradeEnable=1;" ↔ { GpuPreference: '2', ... }. Só chaves e valores simples. */
function parsePairs(text) {
  const out = {};
  for (const part of String(text || '').split(';')) {
    const [key, value, extra] = part.split('=');
    if (extra !== undefined || !/^[A-Za-z]{1,40}$/.test((key || '').trim()) || !/^[0-9]{1,3}$/.test((value || '').trim())) continue;
    out[key.trim()] = value.trim();
  }
  return out;
}
const formatPairs = (pairs) => Object.entries(pairs).map(([key, value]) => `${key}=${value};`).join('');
/** Placa de vídeo de alto desempenho para este jogo, preservando as outras opções que já estavam no valor. */
function gpuPreferenceValue(previous) {
  return formatPairs({ ...parsePairs(previous), GpuPreference: '2' });
}
const GPU_VALUE = /^([A-Za-z]{1,40}=[0-9]{1,3};){1,8}$/;
const GPU_PREFS_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';

const IFEO_BASE = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options';
const PRIORITY_HIGH = 3;
const QOS_KEY = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\QoS';
const qosName = (exe) => `Nexo - ${exe}`;

/* ---------- Placa de rede: só estas palavras-chave, só estes valores, só se a placa oferecer ---------- */
const NIC_TWEAKS = Object.freeze([
  { keyword: '*EEE', media: 'ethernet', target: '0', risk: 'baixo', evidence: 'varia', label: 'Ethernet com economia de energia (EEE)', why: 'O EEE põe o link para cochilar entre pacotes; ao acordar, os primeiros pacotes atrasam.' },
  { keyword: 'EEELinkAdvertisement', media: 'ethernet', target: '0', risk: 'baixo', evidence: 'varia', label: 'Anúncio de EEE (Intel)', why: 'O mesmo cochilo do link, na nomenclatura da Intel.' },
  { keyword: 'AdvancedEEE', media: 'ethernet', target: '0', risk: 'baixo', evidence: 'varia', label: 'EEE avançado (Realtek)', why: 'Versão mais agressiva do cochilo do link nas placas Realtek.' },
  { keyword: 'EnableGreenEthernet', media: 'ethernet', target: '0', risk: 'baixo', evidence: 'varia', label: 'Green Ethernet (Realtek)', why: 'Reduz a energia do link conforme o cabo; em alguns PCs causa picos de ping.' },
  { keyword: 'GigaLite', media: 'ethernet', target: '0', risk: 'baixo', evidence: 'varia', label: 'Gigabit Lite (Realtek)', why: 'Pode baixar o link para 500 Mb/s para economizar.' },
  { keyword: 'PowerSavingMode', media: 'ethernet', target: '0', risk: 'baixo', evidence: 'varia', label: 'Modo de economia de energia (Realtek)', why: 'A placa reduz o próprio consumo quando acha que está parada.' },
  { keyword: 'ULPMode', media: 'ethernet', target: '0', risk: 'baixo', evidence: 'varia', label: 'Ultra Low Power (Intel)', why: 'Economia extrema do link nas placas Intel.' },
  { keyword: 'RoamAggressiveness', media: 'wifi', target: '0', from: ['2', '3', '4'], risk: 'moderado', evidence: 'varia', label: 'Busca por outro roteador (roaming)', why: 'Com o roaming alto, o Wi-Fi para de tempos em tempos para procurar outro ponto de acesso, e o ping dá picos. Em redes mesh com vários pontos, pode piorar ao andar pela casa.' },
  { keyword: 'RoamingPreferredBandType', media: 'wifi', target: '2', from: ['0', '1'], risk: 'baixo', evidence: 'varia', label: 'Preferir 5 GHz', why: 'Em 5 GHz há menos interferência de vizinhos e de aparelhos da casa; se o roteador não tiver 5 GHz, nada muda.' }
]);
const NIC_BY_KEYWORD = new Map(NIC_TWEAKS.map((item) => [item.keyword, item]));
const IF_GUID = /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;
const NIC_VALUE = /^[0-9]{1,4}$/;

/* ---------- Modo de energia do Windows 11 (notebooks na tomada) ---------- */
const POWER_MODES = Object.freeze({
  'ded574b5-45a0-4f42-8737-46345c09c238': 'Melhor desempenho',
  '00000000-0000-0000-0000-000000000000': 'Equilibrado',
  '961cc777-2547-4f9d-8174-7d86181b8a7a': 'Melhor eficiência'
});
const POWER_SAVER = 'a1841308-3541-4fab-bc81-f71556f20b4a';
const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';

const CHANGE_ID = /^c\d{1,3}$/;

/**
 * Confere uma mudança do lote. `revert: true` aceita o valor anterior guardado pelo processo principal; sem ela,
 * só o valor do catálogo. Devolve a mudança normalizada (só os campos conhecidos).
 */
function validateChange(change) {
  if (!change || typeof change !== 'object') throw new Error('Mudança inválida.');
  if (!CHANGE_ID.test(String(change.id || ''))) throw new Error('Identificador da mudança inválido.');
  const revert = change.revert === true;
  switch (change.kind) {
    case 'startup': {
      validStartupTarget(change);
      if (change.source === 'packaged') {
        const value = change.value;
        if (revert ? !(value === null || (Number.isInteger(value) && value >= 0 && value <= 5)) : value !== 1) throw new Error('Estado do app da Loja inválido.');
        return { id: change.id, kind: 'startup', source: change.source, name: change.name, value, revert };
      }
      const value = change.value === null ? null : String(change.value || '').toUpperCase();
      if (value === null ? !revert : !HEX_APPROVED.test(value) || value.length % 2) throw new Error('Valor do item do início inválido.');
      if (!revert && approvedEnabled(value)) throw new Error('O otimizador só desliga itens do início.');
      return { id: change.id, kind: 'startup', source: change.source, name: change.name, value, revert };
    }
    case 'gpu-pref': {
      const exe = validExePath(change.exe);
      const value = change.value === null ? null : String(change.value || '');
      if (value === null ? !revert : !GPU_VALUE.test(value) || (!revert && parsePairs(value).GpuPreference !== '2')) throw new Error('Preferência de placa de vídeo inválida.');
      return { id: change.id, kind: 'gpu-pref', exe, value, revert };
    }
    case 'priority': {
      const exe = validExeName(change.exe);
      const value = change.value;
      if (revert ? !(value === null || (Number.isInteger(value) && value >= 1 && value <= 6)) : value !== PRIORITY_HIGH) throw new Error('Prioridade inválida.');
      return { id: change.id, kind: 'priority', exe, value, revert };
    }
    case 'qos': {
      const exe = validExeName(change.exe);
      if (typeof change.on !== 'boolean' || (!revert && !change.on)) throw new Error('Política de QoS inválida.');
      const nla = change.nla === null || change.nla === undefined ? null : String(change.nla);
      if (nla !== null && !/^[01]$/.test(nla)) throw new Error('Valor de QoS inválido.');
      return { id: change.id, kind: 'qos', exe, on: change.on, nla, revert };
    }
    case 'nic': {
      if (!IF_GUID.test(String(change.guid || ''))) throw new Error('Placa de rede inválida.');
      const tweak = NIC_BY_KEYWORD.get(change.keyword);
      if (!tweak) throw new Error('Propriedade da placa de rede fora do catálogo.');
      const value = String(change.value ?? '');
      if (!NIC_VALUE.test(value) || (!revert && value !== tweak.target)) throw new Error('Valor da placa de rede inválido.');
      return { id: change.id, kind: 'nic', guid: change.guid, keyword: change.keyword, value, revert };
    }
    case 'pagefile': {
      if (typeof change.auto !== 'boolean' || (!revert && change.auto !== true)) throw new Error('Arquivo de paginação: valor inválido.');
      return { id: change.id, kind: 'pagefile', auto: change.auto, revert };
    }
    default: throw new Error('Tipo de mudança fora do catálogo do otimizador.');
  }
}

/** Precisa do lote elevado (UAC)? Os de HKCU vão direto, sem pedir nada. */
function needsElevation(change) {
  if (change.kind === 'startup') return STARTUP_SOURCES[change.source].elevated;
  return ['priority', 'qos', 'nic', 'pagefile'].includes(change.kind);
}

/** Funções curtas do lote (o script inteiro vai na linha de comando, que tem limite de tamanho). */
const BATCH_PRELUDE = [
  "function B([string]$h) { [byte[]]($h -split '(..)' | Where-Object { $_ } | ForEach-Object { [Convert]::ToByte($_, 16) }) }",
  'function K($p) { if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null } }',
  'function DV($p, $n) { if (Test-Path -LiteralPath $p) { Remove-ItemProperty -LiteralPath $p -Name $n -ErrorAction SilentlyContinue } }',
  'function KE($p) { $i = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue; if ($i -and $i.ValueCount -eq 0 -and $i.SubKeyCount -eq 0) { Remove-Item -LiteralPath $p -ErrorAction SilentlyContinue } }',
  'function T($id, [scriptblock]$s) { try { & $s; $r.done += $id } catch { $r.failed += $id } }',
  '$NR = @{}'
];

/** Um passo do lote elevado para uma mudança já validada (só os tipos que precisam de administrador). */
function batchStep(change) {
  const id = psQuote(change.id);
  if (change.kind === 'startup') {
    const key = psQuote(approvedKey(change.source));
    if (change.value === null) return `T ${id} { DV ${key} ${psQuote(change.name)} }`;
    return `T ${id} { K ${key}; New-ItemProperty -LiteralPath ${key} -Name ${psQuote(change.name)} -PropertyType Binary -Value (B ${psQuote(change.value)}) -Force | Out-Null }`;
  }
  if (change.kind === 'priority') {
    const exeKey = psQuote(`${IFEO_BASE}\\${change.exe}`);
    const key = psQuote(`${IFEO_BASE}\\${change.exe}\\PerfOptions`);
    if (change.value === null) return `T ${id} { DV ${key} 'CpuPriorityClass'; KE ${key}; KE ${exeKey} }`;
    return `T ${id} { K ${key}; New-ItemProperty -LiteralPath ${key} -Name 'CpuPriorityClass' -PropertyType DWord -Value ${change.value} -Force | Out-Null }`;
  }
  if (change.kind === 'qos') {
    const name = psQuote(qosName(change.exe));
    const remove = `Get-NetQosPolicy -Name ${name} -ErrorAction SilentlyContinue | Remove-NetQosPolicy -Confirm:$false`;
    if (!change.on) {
      // "Do not use NLA" volta ao que era; se era vazio, só sai quando não sobra nenhuma política do Nexo.
      const nla = change.nla === null
        ? `if (-not (Get-NetQosPolicy -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Nexo - *' })) { DV ${psQuote(QOS_KEY)} 'Do not use NLA' }`
        : `K ${psQuote(QOS_KEY)}; New-ItemProperty -LiteralPath ${psQuote(QOS_KEY)} -Name 'Do not use NLA' -PropertyType String -Value ${psQuote(change.nla)} -Force | Out-Null`;
      return `T ${id} { ${remove}; ${nla} }`;
    }
    return `T ${id} { ${remove}; New-NetQosPolicy -Name ${name} -AppPathNameMatchCondition ${psQuote(change.exe)} -DSCPAction 46 -NetworkProfile All -IPProtocolMatchCondition Both -ErrorAction Stop | Out-Null; K ${psQuote(QOS_KEY)}; New-ItemProperty -LiteralPath ${psQuote(QOS_KEY)} -Name 'Do not use NLA' -PropertyType String -Value '1' -Force | Out-Null }`;
  }
  if (change.kind === 'nic') {
    // -NoRestart em cada propriedade e um reinício só por placa no fim (a internet cai por alguns segundos uma vez).
    return `T ${id} { $a = Get-NetAdapter -IncludeHidden | Where-Object { $_.InterfaceGuid -eq ${psQuote(change.guid)} } | Select-Object -First 1; if (-not $a) { throw 'sem placa' }; Set-NetAdapterAdvancedProperty -Name $a.Name -RegistryKeyword ${psQuote(change.keyword)} -RegistryValue ${psQuote(change.value)} -NoRestart -ErrorAction Stop; $NR[$a.Name] = 1 }`;
  }
  if (change.kind === 'pagefile') {
    return `T ${id} { $cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = ${change.auto ? '$true' : '$false'} } -ErrorAction Stop }`;
  }
  throw new Error('Essa mudança não vai no lote elevado.');
}
const BATCH_EPILOGUE = ['foreach ($n in @($NR.Keys)) { try { Restart-NetAdapter -Name $n -Confirm:$false -ErrorAction Stop } catch {} }'];

module.exports = {
  STARTUP_SOURCES, APPROVED_BASE, PACKAGED_BASE, ENABLED_BYTES, approvedEnabled, packagedEnabled, disabledBytes, approvedKey, packagedKey, validStartupTarget,
  SAFE_WIN_PATH, EXE_NAME, PROTECTED_EXE, validExeName, validExePath, parsePairs, formatPairs, gpuPreferenceValue, GPU_PREFS_KEY, IFEO_BASE, PRIORITY_HIGH, QOS_KEY, qosName,
  NIC_TWEAKS, NIC_BY_KEYWORD, IF_GUID, POWER_MODES, POWER_SAVER, BALANCED,
  validateChange, needsElevation, BATCH_PRELUDE, BATCH_EPILOGUE, batchStep, psQuote
};
