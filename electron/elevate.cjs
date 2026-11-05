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

const TASKS = {
  'restore-point': (args) => restorePointBody(String(args?.description || 'Nexo').slice(0, 64)),
  'perf-log-users': (args) => perfLogUsersBody(args?.action, args?.sid)
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

module.exports = { createElevator, toolLauncher, TOOLS, linuxPrivileged, LINUX_TOOLS, restorePointBody, perfLogUsersBody, TASKS, SID_PERF_LOG_USERS, USER_SID, psQuote, encode };
