# Contagem de uso do Nexo pelo instalador (instalou, atualizou, desinstalou) ou o "+1 desligou" (optout).
#
# Chamado escondido pelo instalador (installer/installer.nsh), com prazo de 4 s: nunca escreve na tela, nunca trava a
# instalação e sempre sai com 0. Manda só o código do PC embaralhado, a versão e o sistema; o "optout" não manda código
# nenhum. Spec: docs/superpowers/specs/2026-11-17-contagem-exata-design.md
#
# Código do PC = SHA-256("nexo-pc-v1|" + MachineGuid em minúsculas), 64 hex: a MESMA conta do app
# (electron/cloud.cjs, pcCodeFrom). Vetor fixo, conferido com -SelfTest no windows-latest:
#   4C4C4544-0042-3510-8051-B4C04F4E3732 -> 5494d4d3f02aa76ad4d16aa360ffc47e1c4425d210b921c05a16d5540518c698

param(
  # $Event é variável automática do PowerShell: o nome de dentro é $Kind, e -Event continua valendo pelo apelido.
  [Alias('Event')][string]$Kind = '',
  [string]$Version = '0.0.0',
  [string]$Server = '',
  [switch]$SelfTest
)

function Get-NexoPcCode([string]$Id) {
  $text = 'nexo-pc-v1|' + $Id.Trim().ToLowerInvariant()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text)) } finally { $sha.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

if ($SelfTest) {
  if ((Get-NexoPcCode '4C4C4544-0042-3510-8051-B4C04F4E3732') -eq '5494d4d3f02aa76ad4d16aa360ffc47e1c4425d210b921c05a16d5540518c698') { exit 0 }
  exit 1
}

try {
  if ($Server -notmatch '^https://[A-Za-z0-9.-]+(:[0-9]+)?$') { exit 0 }
  if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+') { $Version = '0.0.0' }
  if ($Kind -eq 'optout') {
    $route = '/v1/optout'
    $body = @{ origem = 'instalador' }
  } elseif (@('instalou', 'atualizou', 'desinstalou') -contains $Kind) {
    $machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64')
    try { $guid = [string]$machine.OpenSubKey('SOFTWARE\Microsoft\Cryptography').GetValue('MachineGuid') } finally { $machine.Dispose() }
    if (-not $guid) { exit 0 }
    $route = '/v1/install'
    $body = @{ pc = (Get-NexoPcCode $guid); event = $Kind; version = $Version; platform = 'win32' }
  } else { exit 0 }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $null = Invoke-RestMethod -Method Post -Uri ($Server + $route) -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 4 -UseBasicParsing
} catch { }
exit 0
