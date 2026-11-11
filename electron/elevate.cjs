/*
 * ÚNICO ponto do Nexo que pede elevação (UAC). Ninguém contorna o UAC: o Windows mostra a janela e a pessoa decide.
 *  - Só tarefas com nome na lista TASKS podem ser elevadas, e o corpo de cada uma é montado aqui, a partir de dados validados.
 *  - O script vai por -EncodedCommand (nada de .ps1 gravado em pasta do usuário que outro programa poderia trocar
 *    entre a gravação e a elevação).
 *  - A resposta volta por um arquivo JSON em userData; se a pessoa recusar o UAC, devolve { declined: true }.
 */
const SID_PERF_LOG_USERS = 'S-1-5-32-559';
const USER_SID = /^S-1-(5-21|12-1)(-\d+){4}$/;
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const WRITE_RESULT = '$r | ConvertTo-Json -Compress | Set-Content -LiteralPath $NexoOut -Encoding UTF8';

/** Ponto de restauração. Contorna o limite de 1 por 24 h do jeito documentado pela Microsoft (frequência 0) e devolve o valor anterior. */
function restorePointCore(description) {
  return String.raw`
$r = @{ ok = $false; created = $false; note = '' }
$key = 'HKLM:\Software\Microsoft\Windows NT\CurrentVersion\SystemRestore'
$had = $null
try { $had = (Get-ItemProperty -LiteralPath $key -Name 'SystemRestorePointCreationFrequency' -ErrorAction Stop).SystemRestorePointCreationFrequency } catch {}
try {
  $before = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Sort-Object SequenceNumber | Select-Object -Last 1)
  $seqBefore = if ($before.Count) { $before[0].SequenceNumber } else { -1 }
  New-ItemProperty -LiteralPath $key -Name 'SystemRestorePointCreationFrequency' -PropertyType DWord -Value 0 -Force | Out-Null
  Checkpoint-Computer -Description ${psQuote(description)} -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop -WarningAction SilentlyContinue
  $after = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Sort-Object SequenceNumber | Select-Object -Last 1)
  if ($after.Count -and $after[0].SequenceNumber -ne $seqBefore) {
    $r.ok = $true; $r.created = $true; $r.sequence = [int]$after[0].SequenceNumber
    $r.at = ([Management.ManagementDateTimeConverter]::ToDateTime($after[0].CreationTime)).ToString('o')
  } else { $r.note = 'o Windows não criou o ponto (a Proteção do Sistema pode estar desligada na unidade C:)' }
} catch {
  $m = $_.Exception.Message
  if ($m -match 'disabled|desativad|desabilitad|0x80042306') { $r.note = 'a Proteção do Sistema está desligada nesta unidade' } else { $r.note = $m }
} finally {
  if ($null -eq $had) { Remove-ItemProperty -LiteralPath $key -Name 'SystemRestorePointCreationFrequency' -ErrorAction SilentlyContinue }
  else { Set-ItemProperty -LiteralPath $key -Name 'SystemRestorePointCreationFrequency' -Value $had -ErrorAction SilentlyContinue }
}`;
}
function restorePointBody(description) {
  return `${restorePointCore(description)}\n${WRITE_RESULT}`;
}

/** Adiciona ou remove o usuário (por SID, nunca por nome localizado) do grupo "Performance Log Users". */
function perfLogUsersBody(action, sid) {
  if (!USER_SID.test(String(sid))) throw new Error('Identificador do usuário inválido.');
  if (action !== 'add' && action !== 'remove') throw new Error('Ação inválida.');
  const command = action === 'add' ? 'Add-LocalGroupMember' : 'Remove-LocalGroupMember';
  return String.raw`
$r = @{ ok = $false; changed = $false; note = '' }
try {
  ${command} -SID '${SID_PERF_LOG_USERS}' -Member ${psQuote(sid)} -ErrorAction Stop
  $r.ok = $true; $r.changed = $true
} catch {
  $id = [string]$_.FullyQualifiedErrorId
  if ($id -like '*MemberExists*' -or $id -like '*MemberNotFound*' -or $id -like '*PrincipalNotFound*') { $r.ok = $true; $r.note = 'já estava assim' } else { $r.note = $_.Exception.Message }
}
${WRITE_RESULT}`;
}

/* ---------- Serviço de sensores (temperatura do processador) ---------- */
/** PawnIO: driver assinado que o LibreHardwareMonitor usa para ler temperaturas. Versão e hash fixados e conferidos. */
const PAWNIO = Object.freeze({ version: '2.2.0', sha256: '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032', url: 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe' });
const SENSOR_SERVICE = 'NexoSensors';
const SAFE_WIN_PATH = /^[A-Za-z]:\\[^"'`$;|&<>\r\n]+$/;

/**
 * Instala (ou remove) o serviço de sensores. Tudo roda elevado, com caminhos validados:
 *  - copia o PawnIO_setup.exe baixado para a pasta protegida em Arquivos de Programas e confere o SHA-256 LÁ (depois da cópia);
 *  - instala o PawnIO só se ainda não existir, e marca quando foi o Nexo que instalou (para remover depois);
 *  - copia o coletor para Arquivos de Programas (só administradores escrevem ali) e cria o serviço "NexoSensors".
 */
function sensorServiceBody(args) {
  const action = args?.action;
  if (action !== 'install' && action !== 'uninstall') throw new Error('Ação inválida.');
  const source = String(args?.hostDir || '');
  const pawnio = String(args?.pawnioSetup || '');
  if (action === 'install') {
    if (!SAFE_WIN_PATH.test(source) || !/\\sensor-host$/i.test(source)) throw new Error('Pasta do coletor inválida.');
    if (!SAFE_WIN_PATH.test(pawnio) || !/\\PawnIO_setup\.exe$/i.test(pawnio)) throw new Error('Arquivo do PawnIO inválido.');
  }
  const common = String.raw`
$r = @{ ok = $false; action = '${action}'; pawnio = ''; service = ''; note = '' }
$dest = Join-Path $env:ProgramFiles 'Nexo Device Care\SensorService'
$regKey = 'HKLM:\SOFTWARE\NexoDeviceCare\SensorService'
function Remove-NexoService {
  $svc = Get-Service -Name '${SENSOR_SERVICE}' -ErrorAction SilentlyContinue
  if ($svc) {
    if ($svc.Status -ne 'Stopped') { Stop-Service -Name '${SENSOR_SERVICE}' -Force -ErrorAction SilentlyContinue; try { $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(15)) } catch {} }
    & sc.exe delete '${SENSOR_SERVICE}' | Out-Null
  }
  # Espera o processo do serviço sair de verdade: sem isso a pasta do coletor fica travada e a reinstalação falha.
  $hostExe = Join-Path $dest 'host\Nexo.SensorHost.exe'
  for ($i = 0; $i -lt 30; $i++) {
    $left = @(Get-Process -Name 'Nexo.SensorHost' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $hostExe })
    if (-not $left.Count) { break }
    if ($i -eq 20) { $left | Stop-Process -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 250
  }
  for ($i = 0; $i -lt 20 -and (Get-Service -Name '${SENSOR_SERVICE}' -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
}
function Find-PawnIO { Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like 'PawnIO*' } | Select-Object -First 1 }`;
  if (action === 'uninstall') {
    return common + String.raw`
try {
  Remove-NexoService
  $byNexo = $false
  try { $byNexo = [int](Get-ItemProperty -LiteralPath $regKey -Name 'PawnIOByNexo' -ErrorAction Stop).PawnIOByNexo -eq 1 } catch {}
  if ($byNexo) {
    $p = Find-PawnIO
    $setup = Join-Path $dest 'PawnIO_setup.exe'
    if ($p -and (Test-Path -LiteralPath $setup)) { $x = Start-Process -FilePath $setup -ArgumentList @('-uninstall','-silent') -Wait -PassThru -WindowStyle Hidden; $r.pawnio = "removido ($($x.ExitCode))" } else { $r.pawnio = 'não encontrado' }
  } else { $r.pawnio = 'mantido (não foi instalado pelo Nexo)' }
  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  $parent = Split-Path $dest -Parent
  if ((Test-Path -LiteralPath $parent) -and -not (Get-ChildItem -LiteralPath $parent -Force)) { Remove-Item -LiteralPath $parent -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath 'HKLM:\SOFTWARE\NexoDeviceCare' -Recurse -Force -ErrorAction SilentlyContinue
  $r.ok = $true; $r.service = 'removido'
} catch { $r.note = $_.Exception.Message }
${WRITE_RESULT}`;
  }
  return common + String.raw`
try {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  # PawnIO: copia para a pasta protegida e só então confere o hash (ninguém troca o arquivo entre a conferência e a execução).
  $setup = Join-Path $dest 'PawnIO_setup.exe'
  Copy-Item -LiteralPath ${psQuote(pawnio)} -Destination $setup -Force
  $hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne '${PAWNIO.sha256}') { Remove-Item -LiteralPath $setup -Force; throw 'O instalador do PawnIO não confere com o hash fixado.' }
  $existing = Find-PawnIO
  if ($existing) { $r.pawnio = 'já instalado' } else {
    $x = Start-Process -FilePath $setup -ArgumentList @('-install','-silent') -Wait -PassThru -WindowStyle Hidden
    if (Find-PawnIO) { $r.pawnio = 'instalado'; New-Item -Path $regKey -Force | Out-Null; New-ItemProperty -LiteralPath $regKey -Name 'PawnIOByNexo' -PropertyType DWord -Value 1 -Force | Out-Null }
    else { $r.pawnio = "falhou ($($x.ExitCode))" }
  }
  # Coletor: cópia protegida + serviço.
  Remove-NexoService
  $hostDest = Join-Path $dest 'host'
  if (Test-Path -LiteralPath $hostDest) { Remove-Item -LiteralPath $hostDest -Recurse -Force }
  Copy-Item -LiteralPath ${psQuote(source)} -Destination $hostDest -Recurse -Force
  $exe = Join-Path $hostDest 'Nexo.SensorHost.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw 'O coletor não foi encontrado na instalação do Nexo.' }
  New-Service -Name '${SENSOR_SERVICE}' -BinaryPathName ('"' + $exe + '" --service') -DisplayName 'Nexo Device Care: sensores' -Description 'Lê temperaturas e sensores para o Nexo Device Care. Só responde leituras, pelo pipe local NexoSensors.' -StartupType Automatic | Out-Null
  & sc.exe failure '${SENSOR_SERVICE}' reset= 86400 actions= restart/5000/restart/30000/restart/60000 | Out-Null
  Start-Service -Name '${SENSOR_SERVICE}'
  New-Item -Path $regKey -Force | Out-Null
  New-ItemProperty -LiteralPath $regKey -Name 'Version' -PropertyType String -Value ((& $exe --version) | Select-Object -First 1) -Force | Out-Null
  $r.service = [string](Get-Service -Name '${SENSOR_SERVICE}').Status
  $r.ok = $r.service -eq 'Running'
} catch { $r.note = $_.Exception.Message }
${WRITE_RESULT}`;
}

/** Raio-X: grava (ou volta) valores do registro em HKLM. Só chaves do catálogo fechado (electron/system-scan.cjs). */
function registryTweaksBody(args) {
  const { elevatedBody, MAX_CHANGES } = require('./system-scan.cjs');
  const { prelude, steps } = elevatedBody(Array.isArray(args?.changes) ? args.changes.slice(0, MAX_CHANGES) : []);
  if (!steps.length) throw new Error('Nada para gravar no sistema.');
  // Cada passo tem o próprio try/catch (um valor recusado não impede os outros); o que falhou volta em "failed".
  return String.raw`
$r = @{ ok = $false; note = ''; steps = 0; failed = @() }
try {
${prelude.map((line) => `  ${line}`).join('\n')}
${steps.map((step) => `  ${step}`).join('\n')}
  $r.ok = $true
} catch { $r.note = $_.Exception.Message }
${WRITE_RESULT}`;
}

/* ---------- Otimizar este PC: um lote só, com uma permissão do Windows ---------- */
// ~10,5 mil caracteres viram ~28 mil em -EncodedCommand (UTF-16 + base64); a linha de comando do Windows aceita 32 767.
const OPTIMIZER_LIMIT = 10500;
/**
 * Ponto de restauração (opcional), os valores do Raio-X que ficam em HKLM e as ações do otimizador que precisam de
 * administrador, tudo validado aqui de novo. Cada passo tem o próprio try/catch: o que falhou volta em "failed"
 * (o id da mudança ou, para o Raio-X, o id do ajuste) e o que deu certo, em "done".
 */
function optimizerBatchBody(args) {
  const Actions = require('./optimizer-actions.cjs');
  const { elevatedBody, MAX_CHANGES } = require('./system-scan.cjs');
  const changes = (Array.isArray(args?.changes) ? args.changes : []).slice(0, 120).map(Actions.validateChange);
  if (changes.some((change) => !Actions.needsElevation(change))) throw new Error('Mudança sem necessidade de administrador no lote elevado.');
  const registry = elevatedBody(Array.isArray(args?.registry) ? args.registry.slice(0, MAX_CHANGES) : []);
  if (!changes.length && !registry.steps.length && args?.restorePoint !== true) throw new Error('Nada para fazer com administrador.');
  const restore = args?.restorePoint === true ? `$r.restore = & { ${restorePointCore(String(args?.description || 'Nexo - antes de otimizar').slice(0, 64))}\n$r }` : '';
  const body = String.raw`
$r = @{ ok = $false; note = ''; steps = 0; failed = @(); done = @(); restore = $null }
${restore}
try {
${[...registry.prelude, ...Actions.BATCH_PRELUDE].map((line) => `  ${line}`).join('\n')}
${[...registry.steps, ...changes.map(Actions.batchStep), ...Actions.BATCH_EPILOGUE].map((line) => `  ${line}`).join('\n')}
  $r.ok = $true
} catch { $r.note = $_.Exception.Message }
${WRITE_RESULT}`;
  if (body.length > OPTIMIZER_LIMIT + 2600) throw new Error('Lote grande demais para uma permissão só.');
  return body;
}

/* ---------- Rede (diagnóstico de rede: só o que o diagnóstico sugeriu, com dados validados aqui) ---------- */
const { isIP } = require('node:net');
const ifIndexOf = (value) => { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 1000000) { throw new Error('Placa de rede inválida.'); } return n; };

/** Troca os servidores de DNS de uma placa (ou volta para os da rede, com reset) e limpa o cache de DNS. */
function netDnsBody(args) {
  const index = ifIndexOf(args?.ifIndex);
  const reset = args?.reset === true;
  const servers = reset ? [] : (Array.isArray(args?.servers) ? args.servers : []).map(String);
  if (!reset && (!servers.length || servers.length > 6 || servers.some((ip) => !isIP(ip)))) throw new Error('Servidores de DNS inválidos.');
  const set = reset ? `Set-DnsClientServerAddress -InterfaceIndex ${index} -ResetServerAddresses -ErrorAction Stop` : `Set-DnsClientServerAddress -InterfaceIndex ${index} -ServerAddresses @(${servers.map(psQuote).join(', ')}) -ErrorAction Stop`;
  return String.raw`
$r = @{ ok = $false; note = '' }
try {
  ${set}
  Clear-DnsClientCache -ErrorAction SilentlyContinue
  $r.ok = $true
} catch { $r.note = $_.Exception.Message }
${WRITE_RESULT}`;
}

/** Preferência de IPv4 sobre IPv6 (DisabledComponents, documentado pela Microsoft). null tira o valor (padrão). */
function netIpv6Body(args) {
  const value = args?.value === null ? null : Number(args?.value);
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 255)) throw new Error('Valor inválido.');
  const key = String.raw`HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters`;
  const write = value === null ? `Remove-ItemProperty -LiteralPath '${key}' -Name 'DisabledComponents' -ErrorAction SilentlyContinue` : `New-ItemProperty -LiteralPath '${key}' -Name 'DisabledComponents' -PropertyType DWord -Value ${value} -Force | Out-Null`;
  return String.raw`
$r = @{ ok = $false; note = '' }
try {
  ${write}
  $r.ok = $true
} catch { $r.note = $_.Exception.Message }
${WRITE_RESULT}`;
}

/** Reparo profundo: Winsock e TCP/IP voltam ao padrão do Windows e o cache de DNS é limpo (vale depois de reiniciar). */
function netResetBody() {
  return String.raw`
$r = @{ ok = $false; note = ''; steps = @() }
try {
  $w = & netsh.exe winsock reset 2>&1; $r.steps += @{ step = 'winsock'; code = $LASTEXITCODE }
  $i = & netsh.exe int ip reset 2>&1; $r.steps += @{ step = 'ip'; code = $LASTEXITCODE }
  $d = & ipconfig.exe /flushdns 2>&1; $r.steps += @{ step = 'dns'; code = $LASTEXITCODE }
  $r.ok = ($r.steps | Where-Object { $_.code -ne 0 }).Count -eq 0
  if (-not $r.ok) { $r.note = 'algum passo não terminou bem' }
} catch { $r.note = $_.Exception.Message }
${WRITE_RESULT}`;
}

/** Só limpa o cache de DNS (quando o ipconfig sem administrador não conseguiu). */
function netFlushBody() {
  return String.raw`
$r = @{ ok = $false; note = '' }
try { Clear-DnsClientCache -ErrorAction Stop; $r.ok = $true } catch { $r.note = $_.Exception.Message }
${WRITE_RESULT}`;
}

const TASKS = {
  'net-dns': (args) => netDnsBody(args),
  'net-ipv6': (args) => netIpv6Body(args),
  'net-reset': () => netResetBody(),
  'net-flush': () => netFlushBody(),
  'restore-point': (args) => restorePointBody(String(args?.description || 'Nexo').slice(0, 64)),
  'perf-log-users': (args) => perfLogUsersBody(args?.action, args?.sid),
  'sensor-service': (args) => sensorServiceBody(args),
  'registry-tweaks': (args) => registryTweaksBody(args),
  'optimizer-batch': (args) => optimizerBatchBody(args)
};

/** Ferramentas nativas do Windows chamadas com elevação (sem PowerShell no meio do caminho elevado). */
const TOOLS = {
  defrag: (letter) => {
    if (!/^[A-Z]$/.test(String(letter))) throw new Error('Unidade inválida.');
    return ['defrag.exe', [`${letter}:`, '/O', '/U', '/V']];
  },
  sfc: () => ['sfc.exe', ['/scannow']]
};
function toolLauncher(name, arg) {
  const build = TOOLS[name];
  if (!build) throw new Error('Ferramenta não permitida.');
  const [file, args] = build(arg);
  // Recusar o UAC faz o Start-Process lançar: vira o código 1223 (ERROR_CANCELLED), igual ao resto do Nexo.
  // Caminho completo em System32 (nunca o PATH), montado pelo próprio PowerShell a partir do Windows instalado.
  return `try { $process = Start-Process -FilePath (Join-Path $env:SystemRoot ${psQuote(`System32\\${file}`)}) -ArgumentList @(${args.map(psQuote).join(', ')}) -Verb RunAs -Wait -PassThru } catch { exit 1223 }; exit $process.ExitCode`;
}

/** Linux: pkexec (polkit) mostra a janela de senha do próprio sistema. Só comandos fixos. */
const LINUX_TOOLS = {
  fstrim: (mount) => {
    if (typeof mount !== 'string' || !/^\/[\w\-./ @+]*$/.test(mount) || mount.includes('..')) throw new Error('Ponto de montagem inválido.');
    return ['pkexec', ['fstrim', '-v', mount]];
  },
  'remove-deb': () => ['pkexec', ['dpkg', '-r', 'nexo-device-care']]
};
function linuxPrivileged(name, arg) {
  const build = LINUX_TOOLS[name];
  if (!build) throw new Error('Ferramenta não permitida.');
  return build(arg);
}

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

function createElevator({ runPowerShell, fs, path, dir, now = Date.now }) {
  return async function elevate(task, args = {}) {
    const build = TASKS[task];
    if (!build) throw new Error('Tarefa de elevação não permitida.');
    await fs.mkdir(dir, { recursive: true });
    const outPath = path.join(dir, `${task}-${now()}.json`);
    const body = `$ErrorActionPreference = 'Stop'\n$NexoOut = ${psQuote(outPath)}\n${build(args)}`;
    const launcher = `try { $p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encode(body)}'); exit $p.ExitCode } catch { exit 1223 }`;
    const response = await runPowerShell(launcher, 240000);
    let result = null;
    try { result = JSON.parse(String(await fs.readFile(outPath, 'utf8')).replace(/^﻿/, '')); } catch { /* sem resposta */ }
    await fs.rm(outPath, { force: true }).catch(() => {});
    return { declined: !result && response.code === 1223, code: response.code, result };
  };
}

module.exports = { optimizerBatchBody, OPTIMIZER_LIMIT, restorePointCore, netDnsBody, netIpv6Body, netResetBody, PAWNIO, SENSOR_SERVICE, sensorServiceBody, createElevator, toolLauncher, TOOLS, linuxPrivileged, LINUX_TOOLS, restorePointBody, perfLogUsersBody, TASKS, SID_PERF_LOG_USERS, USER_SID, psQuote, encode };
