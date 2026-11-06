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
function restorePointBody(description) {
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
}
${WRITE_RESULT}`;
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

const TASKS = {
  'restore-point': (args) => restorePointBody(String(args?.description || 'Nexo').slice(0, 64)),
  'perf-log-users': (args) => perfLogUsersBody(args?.action, args?.sid),
  'sensor-service': (args) => sensorServiceBody(args)
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
  return `$process = Start-Process -FilePath ${psQuote(file)} -ArgumentList @(${args.map(psQuote).join(', ')}) -Verb RunAs -Wait -PassThru; exit $process.ExitCode`;
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
    const launcher = `try { $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encode(body)}'); exit $p.ExitCode } catch { exit 1223 }`;
    const response = await runPowerShell(launcher, 240000);
    let result = null;
    try { result = JSON.parse(String(await fs.readFile(outPath, 'utf8')).replace(/^﻿/, '')); } catch { /* sem resposta */ }
    await fs.rm(outPath, { force: true }).catch(() => {});
    return { declined: !result && response.code === 1223, code: response.code, result };
  };
}

module.exports = { PAWNIO, SENSOR_SERVICE, sensorServiceBody, createElevator, toolLauncher, TOOLS, linuxPrivileged, LINUX_TOOLS, restorePointBody, perfLogUsersBody, TASKS, SID_PERF_LOG_USERS, USER_SID, psQuote, encode };
