/*
 * Coleta da Análise profunda (somente leitura, sem administrador):
 *  - inventário: processador, placa-mãe, BIOS, pentes de memória e slots, placas de vídeo (VRAM, driver, link PCIe
 *    real), monitores (nome pelo EDID, porta, modo atual e o maior que ele aceita), discos (tipo, barramento, saúde),
 *    controladores NVMe (link PCIe), rede (velocidade do link, Wi-Fi), bateria e Windows;
 *  - saúde: 30 dias de eventos (telas azuis, desligamentos inesperados, erros de hardware WHEA, driver de vídeo que
 *    travou, erros de disco, limite de firmware no processador, programas que fecharam sozinhos), reinício pendente,
 *    inicialização rápida, arquivo de paginação, plano de energia, dispositivos com problema;
 *  - observação: um PowerShell residente que mede, a cada ~3 s, CPU, disco e GPU de cada programa, DPC/interrupções,
 *    falhas de página e fila do disco;
 *  - carga: % do desempenho de cada núcleo e limites do firmware durante o teste.
 * O caminho dos executáveis só serve para reconhecer jogos e NUNCA sai do processo principal.
 * Parâmetros vão por variável de ambiente (números conferidos no script), nunca montando código a partir de texto.
 */
const { spawn } = require('child_process');
const readline = require('readline');
const { systemTool } = require('./system-path.cjs');

const PS_HEAD = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function D($v) { if ($v -is [datetime]) { return $v.ToString('yyyy-MM-dd') }; return $null }
function Link($id) {
  if (-not $id -or -not ([string]$id).StartsWith('PCI\')) { return $null }
  $r = @{}
  $pid2 = @{ '9' = 'CurrentSpeed'; '10' = 'CurrentWidth'; '11' = 'MaxSpeed'; '12' = 'MaxWidth' }
  foreach ($p in @(Get-PnpDeviceProperty -InstanceId $id)) {
    $k = [string]$p.KeyName
    if ($k -match 'PciDevice_(Current|Max)Link(Speed|Width)$') { $r[$Matches[1] + $Matches[2]] = [int]$p.Data }
    elseif ($k -match '^\{3ab22e31-8264-4b4e-9af5-a8d2d8e33e62\}\s+(9|10|11|12)$') { $r[$pid2[$Matches[1]]] = [int]$p.Data }
  }
  if ($r.Count -eq 0) { return $null }
  return @{ curSpeed = $r['CurrentSpeed']; maxSpeed = $r['MaxSpeed']; curWidth = $r['CurrentWidth']; maxWidth = $r['MaxWidth'] }
}
`;

const INVENTORY_SCRIPT = PS_HEAD + String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NexoDisp {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName; public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra; public int dmFields;
    public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName; public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency;
    public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplayDevices(string device, uint index, ref DISPLAY_DEVICE info, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE info);
  public static List<string[]> List() {
    var result = new List<string[]>();
    for (uint i = 0; i < 16; i++) {
      var d = new DISPLAY_DEVICE(); d.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(null, i, ref d, 0)) break;
      if ((d.StateFlags & 1) == 0) continue;
      var mon = new DISPLAY_DEVICE(); mon.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      string monId = "";
      if (EnumDisplayDevices(d.DeviceName, 0, ref mon, 0)) monId = mon.DeviceID ?? "";
      var cur = new DEVMODE(); cur.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
      if (!EnumDisplaySettings(d.DeviceName, -1, ref cur)) continue;
      int maxHz = 0, maxW = 0, maxH = 0;
      for (int m = 0; m < 4000; m++) {
        var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        if (!EnumDisplaySettings(d.DeviceName, m, ref dm)) break;
        if (dm.dmPelsWidth == cur.dmPelsWidth && dm.dmPelsHeight == cur.dmPelsHeight && dm.dmDisplayFrequency > maxHz) maxHz = dm.dmDisplayFrequency;
        if ((long)dm.dmPelsWidth * dm.dmPelsHeight > (long)maxW * maxH) { maxW = dm.dmPelsWidth; maxH = dm.dmPelsHeight; }
      }
      result.Add(new string[] { d.DeviceString ?? "", monId, cur.dmPelsWidth.ToString(), cur.dmPelsHeight.ToString(), cur.dmDisplayFrequency.ToString(), maxHz.ToString(), maxW.ToString(), maxH.ToString(), ((d.StateFlags & 4) != 0) ? "1" : "0" });
    }
    return result;
  }
}
'@
$procs = @(Get-CimInstance Win32_Processor)
$p = $procs | Select-Object -First 1
$cpu = @{ name = [string]$p.Name; manufacturer = [string]$p.Manufacturer; cores = [int](($procs | Measure-Object NumberOfCores -Sum).Sum); threads = [int](($procs | Measure-Object NumberOfLogicalProcessors -Sum).Sum); baseMHz = [int]$p.MaxClockSpeed; l3KB = [int]$p.L3CacheSize; socket = [string]$p.SocketDesignation }
$b = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$bi = Get-CimInstance Win32_BIOS | Select-Object -First 1
$cs = Get-CimInstance Win32_ComputerSystem
$en = Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1
$mods = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { @{ capacity = [double]$_.Capacity; speed = [int]$_.Speed; configured = [int]$_.ConfiguredClockSpeed; manufacturer = ([string]$_.Manufacturer).Trim(); part = ([string]$_.PartNumber).Trim(); type = [int]$_.SMBIOSMemoryType; formFactor = [int]$_.FormFactor; locator = [string]$_.DeviceLocator; bank = [string]$_.BankLabel } })
$arr = @(Get-CimInstance Win32_PhysicalMemoryArray | Where-Object { $_.Use -eq 3 })
$vram = @{}
foreach ($k in @(Get-ChildItem -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}')) {
  try {
    $props = Get-ItemProperty -LiteralPath $k.PSPath
    $q = $props.'HardwareInformation.qwMemorySize'
    if ($q -is [byte[]]) { $q = [BitConverter]::ToUInt64($q, 0) }
    if (-not $q) { $q = $props.'HardwareInformation.MemorySize'; if ($q -is [byte[]]) { $q = [BitConverter]::ToUInt32($q, 0) } }
    $mid = ([string]$props.MatchingDeviceId).ToUpper()
    if ($q -and $mid) { $vram[$mid] = [double]$q }
  } catch {}
}
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  $pnp = [string]$_.PNPDeviceID
  $ven = $null; $dev = $null
  if ($pnp -match 'VEN_([0-9A-Fa-f]{4})') { $ven = $Matches[1] }
  if ($pnp -match 'DEV_([0-9A-Fa-f]{4})') { $dev = $Matches[1] }
  $mem = $null
  foreach ($key in $vram.Keys) { if ($pnp.ToUpper().StartsWith($key)) { $mem = $vram[$key] } }
  if (-not $mem -and $_.AdapterRAM) { try { $mem = [double][uint32]$_.AdapterRAM } catch {} }
  @{ name = [string]$_.Name; vendorId = $ven; deviceId = $dev; driverVersion = [string]$_.DriverVersion; driverDate = (D $_.DriverDate); vramBytes = $mem; link = (Link $pnp); problem = [int]$_.ConfigManagerErrorCode }
})
$nvme = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='SCSIAdapter'" | Where-Object { ([string]$_.PNPDeviceID).StartsWith('PCI\') -and ([string]$_.Name -match 'NVM|NVMe') } | ForEach-Object { @{ name = [string]$_.Name; link = (Link ([string]$_.PNPDeviceID)) } })
$monName = @{}
foreach ($m in @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID)) {
  if ([string]$m.InstanceName -match '^DISPLAY\\([^\\]+)\\') { $monName[$Matches[1].ToUpper()] = -join (@($m.UserFriendlyName) | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ }) }
}
$monOut = @{}
foreach ($c in @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorConnectionParams)) {
  if ([string]$c.InstanceName -match '^DISPLAY\\([^\\]+)\\') { $monOut[$Matches[1].ToUpper()] = [int64]$c.VideoOutputTechnology }
}
$displays = @()
try {
  foreach ($row in [NexoDisp]::List()) {
    $code = $null
    if ($row[1] -match '^MONITOR\\([^\\]+)\\') { $code = $Matches[1].ToUpper() }
    $displays += @{ adapter = $row[0]; code = $code; name = $monName[$code]; output = $monOut[$code]; width = [int]$row[2]; height = [int]$row[3]; hz = [int]$row[4]; maxHz = [int]$row[5]; maxWidth = [int]$row[6]; maxHeight = [int]$row[7]; primary = ($row[8] -eq '1') }
  }
} catch {}
$sysNum = $null
try { $sysNum = [string](Get-Partition -DriveLetter ([string]$env:SystemDrive).Substring(0, 1) -ErrorAction Stop).DiskNumber } catch {}
$disks = @(Get-PhysicalDisk | ForEach-Object {
  $h = @{ model = [string]$_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; size = [double]$_.Size; health = [string]$_.HealthStatus; rpm = [double]$_.SpindleSpeed; system = ([string]$_.DeviceId -eq $sysNum) }
  try { $r = Get-StorageReliabilityCounter -PhysicalDisk $_ -ErrorAction Stop; $h.wear = $r.Wear; $h.tempC = $r.Temperature; $h.powerOnHours = $r.PowerOnHours; $h.readErrors = $r.ReadErrorsUncorrected } catch {}
  $h
})
$net = @(Get-NetAdapter -Physical | ForEach-Object { @{ name = [string]$_.Name; description = [string]$_.InterfaceDescription; up = ([string]$_.Status -eq 'Up'); linkMbps = [Math]::Round([double]$_.ReceiveLinkSpeed / 1000000); ndis = [int]$_.NdisPhysicalMedium } })
$wlan = ''
try { $wlan = (& "$env:SystemRoot\System32\netsh.exe" wlan show interfaces) -join [Environment]::NewLine } catch {}
$battery = $null
$bs = Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData | Select-Object -First 1
$bf = Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1
if ($bs -and $bs.DesignedCapacity) { $battery = @{ designWh = [double]$bs.DesignedCapacity / 1000; fullWh = [double]$bf.FullChargedCapacity / 1000 } }
elseif (Get-CimInstance Win32_Battery) { $battery = @{ present = $true } }
$os = Get-CimInstance Win32_OperatingSystem
$out = @{
  cpu = $cpu
  board = @{ manufacturer = [string]$b.Manufacturer; product = [string]$b.Product; version = [string]$b.Version }
  bios = @{ vendor = [string]$bi.Manufacturer; version = [string]$bi.SMBIOSBIOSVersion; date = (D $bi.ReleaseDate) }
  system = @{ manufacturer = [string]$cs.Manufacturer; model = [string]$cs.Model; family = [string]$cs.SystemFamily; mobile = ([int]$cs.PCSystemType -eq 2); chassis = @($en.ChassisTypes | ForEach-Object { [int]$_ }) }
  memory = @{ modules = $mods; slots = [int](($arr | Measure-Object MemoryDevices -Sum).Sum); maxBytes = [double](($arr | Measure-Object MaxCapacityEx -Sum).Sum) * 1024 }
  gpus = $gpus; nvme = $nvme; displays = $displays; disks = $disks; network = $net; wlan = $wlan; battery = $battery
  os = @{ caption = [string]$os.Caption; build = [int]$os.BuildNumber; lastBoot = (D $os.LastBootUpTime); installDate = (D $os.InstallDate) }
}
[Console]::Out.Write(($out | ConvertTo-Json -Depth 6 -Compress))`;

const HEALTH_SCRIPT = PS_HEAD + String.raw`
$since = (Get-Date).AddDays(-30)
function Ev($log, $providers, $ids) {
  $all = @()
  foreach ($prov in $providers) {
    $f = @{ LogName = $log; ProviderName = $prov; StartTime = $since }
    if ($ids) { $f.Id = $ids }
    try { $all += @(Get-WinEvent -FilterHashtable $f -MaxEvents 300 -ErrorAction Stop) } catch {}
  }
  return @($all | Sort-Object TimeCreated -Descending)
}
function Sum($list) {
  if ($list.Count -eq 0) { return @{ count = 0 } }
  return @{ count = $list.Count; last = $list[0].TimeCreated.ToString('o'); first = $list[$list.Count - 1].TimeCreated.ToString('o') }
}
$bug = Ev 'System' @('Microsoft-Windows-WER-SystemErrorReporting', 'BugCheck') @(1001)
$kp = Ev 'System' @('Microsoft-Windows-Kernel-Power') @(41)
$whea = Ev 'System' @('Microsoft-Windows-WHEA-Logger') $null
$tdr = Ev 'System' @('Display') @(4101)
$disk = Ev 'System' @('disk') @(7, 51, 153)
$stor = Ev 'System' @('stornvme', 'storahci', 'iaStorAC', 'iaStorA', 'iaStorAVC', 'nvme') @(129)
$ntfs = Ev 'System' @('Ntfs') @(55)
$fw = Ev 'System' @('Microsoft-Windows-Kernel-Processor-Power') @(37)
$app = Ev 'Application' @('Application Error') @(1000)
$hang = Ev 'Application' @('Application Hang') @(1002)
$wu = Ev 'System' @('Microsoft-Windows-WindowsUpdateClient') @(20)
$res = Ev 'System' @('Microsoft-Windows-Resource-Exhaustion-Detector') @(2004)
$nvx = Ev 'System' @('nvlddmkm') @(13, 14, 153)
# Código de cada tela azul (o 1001 traz "0x0000001a (...)" na mensagem, em qualquer idioma) e, no desligamento
# inesperado (Kernel-Power 41), se houve tela azul, botão de ligar segurado (o PC travou) ou nada (queda de energia).
$bugCodes = @($bug | ForEach-Object { if ([string]$_.Message -match '\b0x[0-9a-fA-F]{8}\b') { $Matches[0].ToLower() } } | Group-Object | ForEach-Object { @{ code = [string]$_.Name; count = [int]$_.Count } })
$kpCodes = @()
$kpInfo = @{ bugcheck = 0; button = 0; sleep = 0; silent = 0 }
foreach ($e in $kp) {
  try {
    $x = [xml]$e.ToXml(); $d = @{}
    foreach ($n in @($x.Event.EventData.Data)) { $d[[string]$n.Name] = [string]$n.'#text' }
    [int64]$code = 0; [void][int64]::TryParse([string]$d['BugcheckCode'], [ref]$code)
    [int64]$button = 0; [void][int64]::TryParse([string]$d['PowerButtonTimestamp'], [ref]$button)
    if ($code -ne 0) { $kpInfo.bugcheck++; $kpCodes += ('0x{0:x8}' -f $code) }
    elseif ($button -ne 0 -or $d['LongPowerButtonPressDetected'] -eq 'true') { $kpInfo.button++ }
    elseif ([string]$d['SleepInProgress'] -notin @('', '0', 'false')) { $kpInfo.sleep++ }
    else { $kpInfo.silent++ }
  } catch {}
}
$kpCodes = @($kpCodes | Group-Object | ForEach-Object { @{ code = [string]$_.Name; count = [int]$_.Count } })
$crashes = @($app | ForEach-Object { [pscustomobject]@{ app = [string]$_.Properties[0].Value; module = [string]$_.Properties[3].Value } } | Group-Object app | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object { @{ app = [string]$_.Name; count = [int]$_.Count; modules = @($_.Group | Group-Object module | Sort-Object Count -Descending | Select-Object -First 2 | ForEach-Object { [string]$_.Name }) } })
$hangs = @($hang | ForEach-Object { [pscustomobject]@{ app = [string]$_.Properties[0].Value } } | Group-Object app | Sort-Object Count -Descending | Select-Object -First 6 | ForEach-Object { @{ app = [string]$_.Name; count = [int]$_.Count } })
$wheaIds = @($whea | Group-Object Id | ForEach-Object { @{ id = [int]$_.Name; count = [int]$_.Count } })
$tdrDrivers = @($tdr | ForEach-Object { [pscustomobject]@{ d = [string]$_.Properties[0].Value } } | Group-Object d | ForEach-Object { @{ driver = [string]$_.Name; count = [int]$_.Count } })
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$pf = @(Get-CimInstance Win32_PageFileUsage | ForEach-Object { @{ drive = ([string]$_.Name).Substring(0, 1); allocMB = [int]$_.AllocatedBaseSize; usedMB = [int]$_.CurrentUsage; peakMB = [int]$_.PeakUsage } })
$plan = ''
try { $plan = (& "$env:SystemRoot\System32\powercfg.exe" /getactivescheme) -join ' ' } catch {}
$ov = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes'
$bad = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -and @(0, 22, 45) -notcontains [int]$_.ConfigManagerErrorCode } | Select-Object -First 12 | ForEach-Object { @{ name = [string]$_.Name; code = [int]$_.ConfigManagerErrorCode } })
$soft = @(Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | ForEach-Object { [string]$_.DisplayName } | Where-Object { $_ -match '^(AMD Chipset Software|Intel\(R\) Chipset Device Software|AMD Software|NVIDIA Graphics Driver|NVIDIA App|NVIDIA GeForce Experience|Wallpaper Engine|MSI Afterburner|RivaTuner|Armoury Crate|iCUE|NZXT CAM|Razer Synapse|Logitech G HUB|SteelSeries GG|MSI Center|Nahimic)' } | Select-Object -Unique -First 20)
$out = @{
  events = @{ bugcheck = (Sum $bug); unexpected = (Sum $kp); whea = (Sum $whea); wheaIds = $wheaIds; tdr = (Sum $tdr); tdrDrivers = $tdrDrivers; disk = (Sum $disk); storReset = (Sum $stor); ntfs = (Sum $ntfs); firmwareLimit = (Sum $fw); appCrash = (Sum $app); appHang = (Sum $hang); updateFail = (Sum $wu); lowMemory = (Sum $res); gpuErrors = (Sum $nvx) }
  bugCodes = $bugCodes; kpCodes = $kpCodes; powerLoss = $kpInfo
  crashes = $crashes; hangs = $hangs
  rebootPending = @{ servicing = (Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'); update = (Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') }
  fastStartup = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled).HiberbootEnabled
  hibernate = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -Name HibernateEnabled).HibernateEnabled
  lastBoot = $os.LastBootUpTime.ToString('o')
  memory = @{ totalKB = [double]$os.TotalVisibleMemorySize; freeKB = [double]$os.FreePhysicalMemory; virtualKB = [double]$os.TotalVirtualMemorySize; freeVirtualKB = [double]$os.FreeVirtualMemory }
  pagefile = @{ automatic = [bool]$cs.AutomaticManagedPagefile; files = $pf }
  plan = $plan; overlayAc = [string]$ov.ActiveOverlayAcPowerScheme; overlayDc = [string]$ov.ActiveOverlayDcPowerScheme
  problemDevices = $bad
  vcacheService = [bool](Get-Service -Name 'amd3dvcache*')
  gameBar = [bool](Get-AppxPackage -Name 'Microsoft.XboxGamingOverlay')
  software = $soft
}
[Console]::Out.Write(($out | ConvertTo-Json -Depth 5 -Compress))`;

/* Observação residente: NEXO_TICKS leituras com NEXO_WAIT_MS entre elas (conferidos aqui dentro). */
const OBSERVE_SCRIPT = PS_HEAD + String.raw`
$ticks = [int]$env:NEXO_TICKS; if ($ticks -lt 1 -or $ticks -gt 80) { $ticks = 12 }
$wait = [int]$env:NEXO_WAIT_MS; if ($wait -lt 500 -or $wait -gt 10000) { $wait = 3000 }
$cores = [Math]::Max(1, [Environment]::ProcessorCount)
$svc = @{}
foreach ($s in @(Get-CimInstance Win32_Service -Filter "State='Running'")) { $id = [string][int]$s.ProcessId; if ($id -ne '0') { if (-not $svc.ContainsKey($id)) { $svc[$id] = @() }; $svc[$id] += [string]$s.Name } }
$known = @{}
function Fresh() {
  $out = @{}
  foreach ($p in @(Get-Process)) {
    $k = [string]$p.Id
    if (-not $known.ContainsKey($k)) {
      $known[$k] = 1
      $path = $null; try { $path = $p.Path } catch {}
      $out[$k] = @{ name = [string]$p.ProcessName; path = $path; window = ($p.MainWindowHandle -ne [IntPtr]::Zero) }
    }
  }
  return $out
}
[Console]::Out.WriteLine((@{ kind = 'meta'; self = $PID; cores = $cores; services = $svc; procs = (Fresh) } | ConvertTo-Json -Depth 4 -Compress))
[Console]::Out.Flush()
for ($i = 0; $i -le $ticks; $i++) {
  try {
    $rows = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -gt 0 } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.IDProcess; cpu = [Math]::Round([double]$_.PercentProcessorTime / $cores, 2); io = [double]$_.IODataBytesPersec; mem = [double]$_.WorkingSetPrivate } })
    $top = @($rows | Sort-Object cpu -Descending | Select-Object -First 25) + @($rows | Sort-Object io -Descending | Select-Object -First 12) + @($rows | Sort-Object mem -Descending | Select-Object -First 8)
    $gpu = @()
    try {
      $by = @{}
      foreach ($e in @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.UtilizationPercentage -gt 0 })) {
        if ($e.Name -match 'pid_(\d+)_.*engtype_(.+)$') {
          $k = [int]$Matches[1]; $type = [string]$Matches[2]
          if (-not $by.ContainsKey($k)) { $by[$k] = @{} }
          if (-not $by[$k].ContainsKey($type)) { $by[$k][$type] = 0.0 }
          $by[$k][$type] += [double]$e.UtilizationPercentage
        }
      }
      foreach ($k in $by.Keys) {
        $best = 0.0; $bestType = ''; $d3 = 0.0
        foreach ($t in $by[$k].Keys) { $v = $by[$k][$t]; if ($v -gt $best) { $best = $v; $bestType = $t }; if ($t -eq '3D') { $d3 = $v } }
        $gpu += @{ pid = $k; util = [Math]::Round([Math]::Min(100, $best), 1); engine = $bestType; d3 = [Math]::Round([Math]::Min(100, $d3), 1) }
      }
    } catch {}
    $pi = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'"
    $mm = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
    $dk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
    $sy = Get-CimInstance Win32_PerfFormattedData_PerfOS_System
    $line = @{
      kind = 'tick'; i = $i; t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); procs = $top; gpu = $gpu; fresh = (Fresh)
      cpu = @{ total = [double]$pi.PercentProcessorTime; dpc = [double]$pi.PercentDPCTime; irq = [double]$pi.PercentInterruptTime; maxFreq = [double]$pi.PercentofMaximumFrequency; perf = [double]$pi.PercentProcessorPerformance; limit = [double]$pi.PercentPerformanceLimit; mhz = [double]$pi.ProcessorFrequency }
      mem = @{ availMB = [double]$mm.AvailableMBytes; hardFaults = [double]$mm.PagesInputPersec; commit = [double]$mm.CommittedBytes; limit = [double]$mm.CommitLimit }
      disk = @{ busy = [Math]::Max(0, 100 - [double]$dk.PercentIdleTime); queue = [double]$dk.CurrentDiskQueueLength; bytes = [double]$dk.DiskBytesPersec }
      sys = @{ queue = [double]$sy.ProcessorQueueLength; switches = [double]$sy.ContextSwitchesPersec }
    }
    [Console]::Out.WriteLine(($line | ConvertTo-Json -Depth 4 -Compress))
  } catch { [Console]::Out.WriteLine('{"kind":"error"}') }
  [Console]::Out.Flush()
  if ($i -lt $ticks) { Start-Sleep -Milliseconds $wait }
}
[Console]::Out.WriteLine('{"kind":"end"}')`;

/* Durante o teste de carga: desempenho de cada núcleo (% do nominal) e limites do firmware, uma vez por segundo. */
const LOAD_SCRIPT = PS_HEAD + String.raw`
$ticks = [int]$env:NEXO_TICKS; if ($ticks -lt 1 -or $ticks -gt 120) { $ticks = 15 }
for ($i = 0; $i -le $ticks; $i++) {
  try {
    $all = @(Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation)
    $tot = $all | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
    $cores = @($all | Where-Object { $_.Name -notmatch '_Total' } | ForEach-Object { @{ perf = [double]$_.PercentProcessorPerformance; busy = [double]$_.PercentProcessorTime } })
    $line = @{ kind = 'tick'; i = $i; t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); mhz = [double]$tot.ProcessorFrequency; perf = [double]$tot.PercentProcessorPerformance; maxFreq = [double]$tot.PercentofMaximumFrequency; limit = [double]$tot.PercentPerformanceLimit; flags = [double]$tot.PerformanceLimitFlags; busy = [double]$tot.PercentProcessorTime; cores = $cores }
    [Console]::Out.WriteLine(($line | ConvertTo-Json -Depth 3 -Compress))
  } catch { [Console]::Out.WriteLine('{"kind":"error"}') }
  [Console]::Out.Flush()
  if ($i -lt $ticks) { Start-Sleep -Milliseconds 1000 }
}
[Console]::Out.WriteLine('{"kind":"end"}')`;

/* Link PCIe das placas de vídeo de novo (com a placa acordada, a geração real aparece). */
const LINK_SCRIPT = PS_HEAD + String.raw`
$out = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = [string]$_.Name; link = (Link ([string]$_.PNPDeviceID)) } })
[Console]::Out.Write((ConvertTo-Json -InputObject $out -Depth 4 -Compress))`;

/*
 * Drivers das peças que importam (vídeo, rede, áudio, chipset, armazenamento, Bluetooth): nome, quem fez o driver,
 * versão, data, assinatura e o par fabricante:dispositivo do hardware (VEN/DEV), sem caminho de arquivo.
 */
const DRIVERS_SCRIPT = PS_HEAD + String.raw`
$cls = @('DISPLAY', 'NET', 'MEDIA', 'SYSTEM', 'HDC', 'SCSIADAPTER', 'BLUETOOTH')
# Da classe SYSTEM só os drivers de fabricante (chipset, ME, PSP); os genéricos da Microsoft são centenas e não mudam nada.
$rows = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $cls -contains ([string]$_.DeviceClass).ToUpper() -and (([string]$_.DeviceClass).ToUpper() -ne 'SYSTEM' -or [string]$_.DriverProviderName -notmatch '^Microsoft') } | ForEach-Object {
  $hw = [string](@($_.HardWareID)[0])
  $ids = ''
  if ($hw -match '(VEN|VID)_([0-9A-Fa-f]{4}).*?(DEV|PID)_([0-9A-Fa-f]{4})') { $ids = ($Matches[2] + ':' + $Matches[4]).ToUpper() }
  @{ name = [string]$_.DeviceName; cls = ([string]$_.DeviceClass).ToUpper(); provider = [string]$_.DriverProviderName; maker = [string]$_.Manufacturer; version = [string]$_.DriverVersion; date = (D $_.DriverDate); ids = $ids; signed = [bool]$_.IsSigned }
} | Select-Object -First 220)
[Console]::Out.Write((ConvertTo-Json -InputObject $rows -Depth 3 -Compress))`;

/* Erros que apareceram DURANTE a verificação (desde NEXO_SINCE, em ms Unix): hardware (WHEA), vídeo e disco. */
const DURING_SCRIPT = PS_HEAD + String.raw`
$ms = [double]$env:NEXO_SINCE
if (-not $ms -or $ms -lt 1e12) { $ms = [DateTimeOffset]::UtcNow.AddMinutes(-15).ToUnixTimeMilliseconds() }
$since = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$ms).LocalDateTime
function C($providers, $ids) {
  $n = 0
  foreach ($prov in $providers) {
    $f = @{ LogName = 'System'; ProviderName = $prov; StartTime = $since }
    if ($ids) { $f.Id = $ids }
    try { $n += @(Get-WinEvent -FilterHashtable $f -MaxEvents 50 -ErrorAction Stop).Count } catch {}
  }
  return $n
}
$out = @{ whea = (C @('Microsoft-Windows-WHEA-Logger') $null); tdr = (C @('Display') @(4101)); disk = (C @('disk', 'stornvme', 'storahci', 'iaStorAC', 'iaStorA', 'iaStorAVC', 'nvme') @(7, 51, 129, 153)); gpu = (C @('nvlddmkm') @(13, 14, 153)) }
[Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))`;

/* ======================================================================================================
 * Saneamento
 * ==================================================================================================== */
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value, max = 120) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const asList = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);
const num = (value, min, max) => { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const isoDate = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 10) : null);
const isoTime = (value) => { const at = Date.parse(String(value || '')); return Number.isFinite(at) ? new Date(at).toISOString() : null; };

function parseJson(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw.slice(raw.indexOf('{'))); } catch { return null; }
}

/** Saída do netsh (traduzida no idioma do Windows): só sinal, padrão e faixa; o nome da rede é descartado. */
function parseWlan(output) {
  const value = String(output || '');
  if (!value.trim()) return null;
  const signal = value.match(/:\s*(\d{1,3})\s*%/);
  if (!signal) return null;
  const standard = value.match(/802\.11([a-z]{1,2})\b/i);
  const channel = value.match(/(?:Channel|Canal|Kanal|Canale)\s*:\s*(\d{1,3})/i);
  const band = value.match(/:\s*(2[,.]4|5|6)\s*GHz/i);
  let bandValue = band ? Number(band[1].replace(',', '.')) : null;
  if (bandValue === null && channel) bandValue = Number(channel[1]) >= 32 ? 5 : 2.4;
  return { signal: num(Number(signal[1]), 0, 100), standard: standard ? `802.11${standard[1].toLowerCase()}` : null, band: bandValue, channel: channel ? num(Number(channel[1]), 1, 233) : null };
}

const OUTPUT_TECH = { 0: 'VGA', 4: 'DVI', 5: 'HDMI', 6: 'interno', 10: 'DisplayPort', 11: 'interno', 13: 'interno', 15: 'Miracast', 16: 'USB' };
function outputOf(value) {
  // Sem linha no WmiMonitorConnectionParams o PowerShell manda null: é "desconhecido", não VGA (0).
  if (value === null || value === undefined || value === '') return { output: null, internal: false };
  const n = Number(value);
  if (!Number.isFinite(n)) return { output: null, internal: false };
  if (n === 0x80000000 || n === -0x80000000 || n === 6 || n === 11 || n === 13) return { output: 'interno', internal: true };
  return { output: OUTPUT_TECH[n] || null, internal: false };
}

const link = (value) => (value && typeof value === 'object' ? { curSpeed: num(value.curSpeed, 1, 6), maxSpeed: num(value.maxSpeed, 1, 6), curWidth: num(value.curWidth, 1, 32), maxWidth: num(value.maxWidth, 1, 32) } : null);

/** Inventário bruto (Windows) → o formato que NexoHardware.identify entende. Tudo conferido e cortado. */
function parseInventory(stdout) {
  const raw = parseJson(stdout);
  if (!raw || typeof raw !== 'object') return null;
  const cpu = raw.cpu || {};
  const wlan = parseWlan(raw.wlan);
  return {
    platform: 'win32',
    cpu: { name: text(cpu.name, 120), manufacturer: text(cpu.manufacturer, 40), cores: num(cpu.cores, 1, 512), threads: num(cpu.threads, 1, 1024), baseMHz: num(cpu.baseMHz, 100, 10000), l3KB: num(cpu.l3KB, 1, 1e6), socket: text(cpu.socket, 30) },
    board: { manufacturer: text(raw.board?.manufacturer, 50), product: text(raw.board?.product, 60), version: text(raw.board?.version, 30) },
    bios: { vendor: text(raw.bios?.vendor, 40), version: text(raw.bios?.version, 40), date: isoDate(raw.bios?.date) },
    system: { manufacturer: text(raw.system?.manufacturer, 50), model: text(raw.system?.model, 60), family: text(raw.system?.family, 60), mobile: raw.system?.mobile === true, chassis: asList(raw.system?.chassis).map(Number).filter(Number.isInteger).slice(0, 4) },
    memory: {
      modules: asList(raw.memory?.modules).slice(0, 16).map((module) => ({
        capacity: num(module.capacity, 1, 2 ** 42), speed: num(module.speed, 0, 20000), configured: num(module.configured, 0, 20000), manufacturer: text(module.manufacturer, 40),
        part: text(module.part, 40), type: num(module.type, 0, 255), formFactor: num(module.formFactor, 0, 64), locator: text(module.locator, 40), bank: text(module.bank, 40)
      })).filter((module) => module.capacity),
      slots: num(raw.memory?.slots, 1, 64), maxBytes: num(raw.memory?.maxBytes, 1, 2 ** 50)
    },
    gpus: asList(raw.gpus).slice(0, 6).map((gpu) => ({ name: text(gpu.name, 80), vendorId: /^[0-9A-F]{4}$/i.test(String(gpu.vendorId || '')) ? String(gpu.vendorId).toUpperCase() : null, deviceId: /^[0-9A-F]{4}$/i.test(String(gpu.deviceId || '')) ? String(gpu.deviceId).toUpperCase() : null, driverVersion: text(gpu.driverVersion, 40), driverDate: isoDate(gpu.driverDate), vramBytes: num(gpu.vramBytes, 1, 2 ** 40), link: link(gpu.link), problem: num(gpu.problem, 0, 64) })).filter((gpu) => gpu.name),
    nvme: asList(raw.nvme).slice(0, 6).map((item) => ({ name: text(item.name, 60), link: link(item.link) })),
    displays: asList(raw.displays).slice(0, 8).map((display) => ({ adapter: text(display.adapter, 80), name: text(display.name, 60), ...outputOf(display.output), width: num(display.width, 1, 16000), height: num(display.height, 1, 16000), hz: num(display.hz, 1, 1000), maxHz: num(display.maxHz, 1, 1000), maxWidth: num(display.maxWidth, 1, 16000), maxHeight: num(display.maxHeight, 1, 16000), primary: display.primary === true })),
    disks: asList(raw.disks).slice(0, 12).map((disk) => ({ model: text(disk.model, 80), media: text(disk.media, 20), bus: text(disk.bus, 20), size: num(disk.size, 1, 1e15), health: text(disk.health, 20), rpm: num(disk.rpm, 1, 20000), system: disk.system === true, wear: num(disk.wear, 0, 100), tempC: num(disk.tempC, 1, 120), powerOnHours: num(disk.powerOnHours, 0, 1e6), readErrors: num(disk.readErrors, 0, 1e9) })),
    network: asList(raw.network).slice(0, 8).map((adapter) => {
      const wifi = Number(adapter.ndis) === 9 || /Wi-?Fi|Wireless|802\.11|WLAN/i.test(String(adapter.description || ''));
      return { name: text(adapter.name, 40), description: text(adapter.description, 90), up: adapter.up === true, linkMbps: num(adapter.linkMbps, 1, 400000), kind: wifi ? 'wifi' : 'ethernet', wifi: wifi && adapter.up === true ? wlan : null };
    }),
    battery: raw.battery && typeof raw.battery === 'object' ? (num(raw.battery.designWh, 1, 500) ? { designWh: num(raw.battery.designWh, 1, 500), fullWh: num(raw.battery.fullWh, 1, 500) } : raw.battery.present === true ? { present: true } : null) : null,
    os: { platform: 'win32', caption: text(raw.os?.caption, 60), build: num(raw.os?.build, 1, 99999), lastBoot: isoDate(raw.os?.lastBoot), installDate: isoDate(raw.os?.installDate) }
  };
}

const eventSum = (value) => ({ count: num(value?.count, 0, 100000) || 0, last: isoTime(value?.last), first: isoTime(value?.first) });

/** Saúde (Windows): contagens de eventos, nomes de programa/driver (sem caminho), reinício pendente, paginação… */
function parseHealth(stdout) {
  const raw = parseJson(stdout);
  if (!raw || typeof raw !== 'object') return null;
  const events = {};
  for (const key of ['bugcheck', 'unexpected', 'whea', 'tdr', 'disk', 'storReset', 'ntfs', 'firmwareLimit', 'appCrash', 'appHang', 'updateFail', 'lowMemory', 'gpuErrors']) events[key] = eventSum(raw.events?.[key]);
  // A mesma tela azul aparece no 1001 e no 41: por código, vale a maior das duas contagens (nunca a soma).
  const codes = new Map();
  for (const list of [raw.bugCodes, raw.kpCodes]) {
    const local = new Map();
    for (const item of asList(list)) {
      const code = /^0x[0-9a-f]{8}$/i.test(String(item?.code || '')) ? String(item.code).toLowerCase() : null;
      const count = num(item?.count, 0, 100000) || 0;
      if (code && count) local.set(code, (local.get(code) || 0) + count);
    }
    for (const [code, count] of local) codes.set(code, Math.max(codes.get(code) || 0, count));
  }
  const loss = raw.powerLoss && typeof raw.powerLoss === 'object' ? raw.powerLoss : null;
  const exe = (value) => text(String(value || '').split(/[\\/]/).pop(), 60);
  const guid = (value) => (/^[0-9a-f-]{36}$/i.test(String(value || '').trim()) ? String(value).trim().toLowerCase() : null);
  const plan = String(raw.plan || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return {
    platform: 'win32', events,
    bugCodes: [...codes].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, count]) => ({ code, count })),
    powerLoss: loss ? { bugcheck: num(loss.bugcheck, 0, 100000) || 0, button: num(loss.button, 0, 100000) || 0, sleep: num(loss.sleep, 0, 100000) || 0, silent: num(loss.silent, 0, 100000) || 0 } : null,
    wheaIds: asList(raw.events?.wheaIds).slice(0, 12).map((item) => ({ id: num(item.id, 0, 100000), count: num(item.count, 0, 100000) || 0 })).filter((item) => item.id !== null),
    tdrDrivers: asList(raw.events?.tdrDrivers).slice(0, 4).map((item) => ({ driver: exe(item.driver), count: num(item.count, 0, 100000) || 0 })),
    crashes: asList(raw.crashes).slice(0, 8).map((item) => ({ app: exe(item.app), count: num(item.count, 0, 100000) || 0, modules: asList(item.modules).slice(0, 2).map(exe).filter(Boolean) })).filter((item) => item.app),
    hangs: asList(raw.hangs).slice(0, 6).map((item) => ({ app: exe(item.app), count: num(item.count, 0, 100000) || 0 })).filter((item) => item.app),
    rebootPending: { servicing: raw.rebootPending?.servicing === true, update: raw.rebootPending?.update === true },
    fastStartup: raw.fastStartup === 1 ? true : raw.fastStartup === 0 ? false : null,
    hibernate: raw.hibernate === 1 ? true : raw.hibernate === 0 ? false : null,
    lastBoot: isoTime(raw.lastBoot),
    memory: { totalKB: num(raw.memory?.totalKB, 1, 2 ** 40), freeKB: num(raw.memory?.freeKB, 0, 2 ** 40), virtualKB: num(raw.memory?.virtualKB, 1, 2 ** 42), freeVirtualKB: num(raw.memory?.freeVirtualKB, 0, 2 ** 42) },
    pagefile: { automatic: raw.pagefile?.automatic === true, files: asList(raw.pagefile?.files).slice(0, 8).map((item) => ({ drive: /^[A-Za-z]$/.test(String(item.drive || '')) ? String(item.drive).toUpperCase() : null, allocMB: num(item.allocMB, 0, 1e7), usedMB: num(item.usedMB, 0, 1e7), peakMB: num(item.peakMB, 0, 1e7) })) },
    planGuid: plan ? plan[0].toLowerCase() : null, overlayAc: guid(raw.overlayAc), overlayDc: guid(raw.overlayDc),
    problemDevices: asList(raw.problemDevices).slice(0, 12).map((item) => ({ name: text(item.name, 80), code: num(item.code, 1, 64) })).filter((item) => item.name && item.code),
    vcacheService: raw.vcacheService === true, gameBar: raw.gameBar === true,
    software: asList(raw.software).slice(0, 20).map((item) => text(item, 60)).filter(Boolean)
  };
}

/** Drivers: só texto curto e campos conhecidos; data no formato AAAA-MM-DD. */
function parseDrivers(stdout) {
  const body = String(stdout || '').trim();
  const start = body.search(/[[{]/);
  let raw = null;
  try { raw = start >= 0 ? JSON.parse(body.slice(start)) : null; } catch { raw = null; }
  return asList(raw).slice(0, 220).map((item) => ({
    name: text(item?.name, 90), cls: text(item?.cls, 16).toUpperCase(), provider: text(item?.provider, 60), maker: text(item?.maker, 60),
    version: text(item?.version, 40), date: isoDate(item?.date), ids: /^[0-9A-F]{4}:[0-9A-F]{4}$/.test(String(item?.ids || '')) ? item.ids : null, signed: item?.signed === false ? false : item?.signed === true ? true : null
  })).filter((item) => item.name && item.cls);
}
function parseDuring(stdout) {
  const raw = parseJson(stdout);
  if (!raw || typeof raw !== 'object') return null;
  return { whea: num(raw.whea, 0, 1000) || 0, tdr: num(raw.tdr, 0, 1000) || 0, disk: num(raw.disk, 0, 1000) || 0, gpu: num(raw.gpu, 0, 1000) || 0 };
}

/** Uma linha da observação (meta, leitura ou fim). Caminhos ficam, porque quem lê é o processo principal. */
function parseObserveLine(line) {
  let raw;
  try { raw = JSON.parse(String(line || '')); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const procInfo = (map) => {
    const out = new Map();
    for (const [pid, info] of Object.entries(map && typeof map === 'object' ? map : {})) {
      const id = Number(pid);
      if (!Number.isInteger(id) || id <= 0 || !info) continue;
      out.set(id, { name: text(info.name, 60), path: typeof info.path === 'string' && info.path.length < 400 ? info.path : null, window: info.window === true });
      if (out.size >= 1500) break;
    }
    return out;
  };
  if (raw.kind === 'meta') {
    const services = new Map();
    for (const [pid, names] of Object.entries(raw.services && typeof raw.services === 'object' ? raw.services : {})) {
      const id = Number(pid);
      if (Number.isInteger(id) && id > 0) services.set(id, asList(names).slice(0, 40).map((name) => text(name, 60)).filter((name) => /^[\w.$ -]+$/.test(name)));
    }
    return { kind: 'meta', self: num(raw.self, 1, 2 ** 31), cores: num(raw.cores, 1, 1024), services, procs: procInfo(raw.procs) };
  }
  if (raw.kind === 'tick') {
    const seen = new Set();
    const procs = [];
    for (const row of asList(raw.procs)) {
      const pid = num(row?.pid, 1, 2 ** 31);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      procs.push({ pid, cpu: num(row.cpu, 0, 100) || 0, io: num(row.io, 0, 1e12) || 0, mem: num(row.mem, 0, 2 ** 42) || 0 });
    }
    const gpu = asList(raw.gpu).slice(0, 40).map((row) => ({ pid: num(row?.pid, 1, 2 ** 31), util: num(row?.util, 0, 100) || 0, engine: /^[\w ]{1,20}$/.test(String(row?.engine || '')) ? String(row.engine) : null, d3: num(row?.d3, 0, 100) })).filter((row) => row.pid);
    const c = raw.cpu || {};
    return {
      kind: 'tick', i: num(raw.i, 0, 1000), t: num(raw.t, 0, 1e14) || Date.now(), procs, gpu, fresh: procInfo(raw.fresh),
      cpu: { total: num(c.total, 0, 100), dpc: num(c.dpc, 0, 100), irq: num(c.irq, 0, 100), maxFreq: num(c.maxFreq, 0, 200), perf: num(c.perf, 0, 400), limit: num(c.limit, 0, 100), mhz: num(c.mhz, 0, 20000) },
      mem: { availMB: num(raw.mem?.availMB, 0, 1e8), hardFaults: num(raw.mem?.hardFaults, 0, 1e9), commit: num(raw.mem?.commit, 0, 2 ** 50), limit: num(raw.mem?.limit, 0, 2 ** 50) },
      disk: { busy: num(raw.disk?.busy, 0, 100), queue: num(raw.disk?.queue, 0, 1e5), bytes: num(raw.disk?.bytes, 0, 1e12) },
      sys: { queue: num(raw.sys?.queue, 0, 1e5), switches: num(raw.sys?.switches, 0, 1e9) }
    };
  }
  if (raw.kind === 'end' || raw.kind === 'error') return { kind: raw.kind };
  return null;
}

function parseLoadLine(line) {
  let raw;
  try { raw = JSON.parse(String(line || '')); } catch { return null; }
  if (!raw || raw.kind !== 'tick') return raw && (raw.kind === 'end' || raw.kind === 'error') ? { kind: raw.kind } : null;
  return {
    kind: 'tick', t: num(raw.t, 0, 1e14) || Date.now(), mhz: num(raw.mhz, 0, 20000), perf: num(raw.perf, 0, 400), maxFreq: num(raw.maxFreq, 0, 200), limit: num(raw.limit, 0, 100), flags: num(raw.flags, 0, 2 ** 32), busy: num(raw.busy, 0, 100),
    cores: asList(raw.cores).slice(0, 512).map((core) => ({ perf: num(core?.perf, 0, 400), busy: num(core?.busy, 0, 100) }))
  };
}

function parseLinks(stdout) {
  let raw;
  try { raw = JSON.parse(String(stdout || '').trim() || '[]'); } catch { return []; }
  return asList(raw).slice(0, 6).map((item) => ({ name: text(item?.name, 80), link: link(item?.link) })).filter((item) => item.name);
}

/** BAR1 do nvidia-smi -q -d MEMORY: com Resizable BAR ligado, o total acompanha a memória da placa (senão, 256 MiB). */
function parseBar1(output) {
  const value = String(output || '');
  const section = value.split(/BAR1 Memory Usage/i)[1];
  if (!section) return null;
  const total = section.match(/Total\s*:\s*(\d+)\s*MiB/i);
  return total ? num(Number(total[1]), 1, 1e7) : null;
}

/* ======================================================================================================
 * Linux: tudo por /sys e /proc, sem root
 * ==================================================================================================== */
/** Nome do monitor (descritor 0xFC) e a taxa máxima (faixa 0xFD) a partir do EDID binário. */
function parseEdid(buffer) {
  if (!buffer || buffer.length < 128) return null;
  const header = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
  if (!header.every((byte, index) => buffer[index] === byte)) return null;
  let name = null;
  let maxHz = null;
  for (let offset = 54; offset <= 108; offset += 18) {
    if (buffer[offset] !== 0 || buffer[offset + 1] !== 0) continue;
    const tag = buffer[offset + 3];
    if (tag === 0xfc) name = Buffer.from(buffer.subarray(offset + 5, offset + 18)).toString('latin1').replace(/[\n\r]+.*$/s, '').trim().slice(0, 40) || null;
    if (tag === 0xfd) maxHz = buffer[offset + 6] + ((buffer[offset + 4] & 0x02) ? 255 : 0);
  }
  const code = String.fromCharCode(((buffer[8] >> 2) & 0x1f) + 64, (((buffer[8] & 0x03) << 3) | (buffer[9] >> 5)) + 64, (buffer[9] & 0x1f) + 64);
  return { name, maxHz: maxHz && maxHz > 20 && maxHz <= 1000 ? maxHz : null, maker: /^[A-Z]{3}$/.test(code) ? code : null };
}

const LINK_GT = { '2.5': 1, '5.0': 2, '5': 2, '8.0': 3, '8': 3, '16.0': 4, '16': 4, '32.0': 5, '32': 5, '64.0': 6, '64': 6 };
const linuxGen = (value) => { const m = String(value || '').match(/([\d.]+)\s*GT\/s/); return m ? LINK_GT[m[1]] || null : null; };

function createLinuxCollector({ fs, path, os, run = async () => ({ code: 1, stdout: '' }) }) {
  const read = (file) => fs.readFile(file, 'utf8').then((value) => value.trim()).catch(() => null);
  const list = (dir) => fs.readdir(dir).catch(() => []);
  async function pciLink(dir) {
    const [cur, max, cw, mw] = await Promise.all(['current_link_speed', 'max_link_speed', 'current_link_width', 'max_link_width'].map((name) => read(path.join(dir, name))));
    const out = { curSpeed: linuxGen(cur), maxSpeed: linuxGen(max), curWidth: num(Number(cw), 1, 32), maxWidth: num(Number(mw), 1, 32) };
    return Object.values(out).some((value) => value !== null) ? out : null;
  }
  async function inventory() {
    const dmi = async (name) => read(`/sys/class/dmi/id/${name}`);
    const cpuinfo = (await read('/proc/cpuinfo')) || '';
    const cpus = os.cpus();
    const physical = new Set(cpuinfo.split(/\n\n/).map((block) => `${(block.match(/physical id\s*:\s*(\d+)/) || [])[1]}-${(block.match(/core id\s*:\s*(\d+)/) || [])[1]}`).filter((key) => !key.includes('undefined')));
    const biosDate = await dmi('bios_date');
    const dateMatch = String(biosDate || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const gpus = [];
    const displays = [];
    for (const entry of await list('/sys/class/drm')) {
      if (/^card\d+$/.test(entry)) {
        const dir = path.join('/sys/class/drm', entry, 'device');
        const vendor = String((await read(path.join(dir, 'vendor'))) || '').replace(/^0x/, '').toUpperCase();
        const device = String((await read(path.join(dir, 'device'))) || '').replace(/^0x/, '').toUpperCase();
        if (!vendor) continue;
        let name = null;
        const slot = String((await fs.realpath(dir).catch(() => '')) || '').split('/').pop();
        if (/^[\da-f:.]+$/i.test(slot)) { const out = await run('lspci', ['-mm', '-s', slot]); const parts = String(out.stdout || '').match(/"([^"]*)"/g); if (parts && parts.length >= 3) { name = `${parts[1].replace(/"/g, '')} ${parts[2].replace(/"/g, '')}`.replace(/\s+/g, ' ').slice(0, 80); } }
        const vram = Number(await read(path.join(dir, 'mem_info_vram_total')));
        gpus.push({ name: name || `GPU ${vendor}:${device}`, vendorId: /^[0-9A-F]{4}$/.test(vendor) ? vendor : null, deviceId: /^[0-9A-F]{4}$/.test(device) ? device : null, vramBytes: Number.isFinite(vram) && vram > 0 ? vram : null, link: await pciLink(dir) });
      } else if (/^card\d+-/.test(entry)) {
        const dir = path.join('/sys/class/drm', entry);
        if ((await read(path.join(dir, 'status'))) !== 'connected') continue;
        const edid = parseEdid(await fs.readFile(path.join(dir, 'edid')).catch(() => null));
        const modes = String((await read(path.join(dir, 'modes'))) || '').split('\n').filter(Boolean);
        const [w, h] = (modes[0] || '').split('x').map((value) => parseInt(value, 10));
        const internal = /eDP|LVDS|DSI/i.test(entry);
        // A faixa do EDID (0xFD) vale para qualquer resolução: não é a taxa máxima na resolução nativa, por isso não vira maxHz.
        displays.push({ name: edid?.name || null, output: internal ? 'interno' : (entry.match(/-(HDMI|DP|DVI|VGA)/i) || [])[1] || null, internal, maxWidth: num(w, 1, 16000), maxHeight: num(h, 1, 16000), rangeHz: edid?.maxHz || null });
      }
    }
    const mounts = String((await read('/proc/mounts')) || '').split('\n').map((line) => line.split(' '));
    const rootDevice = (mounts.find((parts) => parts[1] === '/') || [])[0] || '';
    const disks = [];
    for (const name of await list('/sys/block')) {
      if (!/^(sd[a-z]+|nvme\d+n\d+|mmcblk\d+|vd[a-z]+)$/.test(name)) continue;
      const dir = path.join('/sys/block', name);
      const size = Number(await read(path.join(dir, 'size'))) * 512;
      const rotational = (await read(path.join(dir, 'queue', 'rotational'))) === '1';
      const removable = (await read(path.join(dir, 'removable'))) === '1';
      const model = (await read(path.join(dir, 'device', 'model'))) || null;
      const nvme = name.startsWith('nvme');
      disks.push({ model, media: rotational ? 'HDD' : 'SSD', bus: nvme ? 'NVMe' : removable ? 'USB' : name.startsWith('mmc') ? 'MMC' : 'SATA', size: Number.isFinite(size) && size > 0 ? size : null, system: rootDevice.includes(name), link: nvme ? await pciLink(path.join('/sys/class/nvme', name.replace(/n\d+$/, ''), 'device')) : null });
    }
    const network = [];
    for (const name of await list('/sys/class/net')) {
      if (name === 'lo') continue;
      const dir = path.join('/sys/class/net', name);
      if (!(await fs.stat(path.join(dir, 'device')).then(() => true).catch(() => false))) continue;
      const wifi = await fs.stat(path.join(dir, 'wireless')).then(() => true).catch(() => false);
      const speed = Number(await read(path.join(dir, 'speed')));
      network.push({ name, description: name, up: (await read(path.join(dir, 'operstate'))) === 'up', linkMbps: Number.isFinite(speed) && speed > 0 ? speed : null, kind: wifi ? 'wifi' : 'ethernet' });
    }
    let battery = null;
    for (const name of await list('/sys/class/power_supply')) {
      if (!/^BAT/i.test(name)) continue;
      const dir = path.join('/sys/class/power_supply', name);
      // energy_* vem em µWh; charge_* em µAh (vira Wh com a tensão de projeto, em µV; sem ela, só a proporção).
      const energyFull = Number(await read(path.join(dir, 'energy_full')));
      const energyDesign = Number(await read(path.join(dir, 'energy_full_design')));
      const chargeFull = Number(await read(path.join(dir, 'charge_full')));
      const chargeDesign = Number(await read(path.join(dir, 'charge_full_design')));
      const volts = Number(await read(path.join(dir, 'voltage_min_design'))) / 1e6;
      if (Number.isFinite(energyFull) && Number.isFinite(energyDesign) && energyDesign > 0) battery = { designWh: energyDesign / 1e6, fullWh: energyFull / 1e6 };
      else if (Number.isFinite(chargeFull) && Number.isFinite(chargeDesign) && chargeDesign > 0 && volts > 0) battery = { designWh: (chargeDesign / 1e6) * volts, fullWh: (chargeFull / 1e6) * volts };
      else if (Number.isFinite(chargeFull) && Number.isFinite(chargeDesign) && chargeDesign > 0) battery = { wear: (1 - chargeFull / chargeDesign) * 100 };
      else battery = { present: true };
      break;
    }
    const release = String((await read('/etc/os-release')) || '');
    const pretty = (release.match(/^PRETTY_NAME="?([^"\n]+)"?/m) || [])[1] || 'Linux';
    const meminfo = String((await read('/proc/meminfo')) || '');
    const memKB = Number((meminfo.match(/MemTotal:\s*(\d+)/) || [])[1]);
    return {
      platform: 'linux',
      cpu: { name: (cpuinfo.match(/model name\s*:\s*(.+)/) || [])[1] || cpus[0]?.model || '', manufacturer: (cpuinfo.match(/vendor_id\s*:\s*(.+)/) || [])[1] || '', cores: physical.size || null, threads: cpus.length, baseMHz: num(Number(await read('/sys/devices/system/cpu/cpu0/cpufreq/base_frequency')) / 1000, 100, 10000) },
      board: { manufacturer: (await dmi('board_vendor')) || '', product: (await dmi('board_name')) || '', version: (await dmi('board_version')) || '' },
      bios: { vendor: (await dmi('bios_vendor')) || '', version: (await dmi('bios_version')) || '', date: dateMatch ? `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}` : null },
      system: { manufacturer: (await dmi('sys_vendor')) || '', model: (await dmi('product_name')) || '', family: (await dmi('product_family')) || '', chassis: [Number(await dmi('chassis_type'))].filter(Number.isInteger), hypervisor: /^flags\s*:.*\bhypervisor\b/m.test(cpuinfo) },
      memory: { modules: [], totalBytes: Number.isFinite(memKB) ? memKB * 1024 : null },
      gpus, displays, disks, network, battery, nvme: [],
      os: { platform: 'linux', name: pretty.slice(0, 60), kernel: os.release() }
    };
  }
  /** Saúde no Linux: erros do kernel nos últimos 30 dias (quando o diário é legível), unidades com falha, reinício pendente. */
  async function health() {
    const journal = await run('journalctl', ['-k', '--since=-30d', '-p', '3', '-o', 'cat', '--no-pager', '-q']);
    const lines = journal.code === 0 ? String(journal.stdout || '').split('\n') : null;
    const count = (pattern) => (lines ? lines.filter((line) => pattern.test(line)).length : null);
    const failed = await run('systemctl', ['--failed', '--no-legend', '--plain']);
    const swaps = String((await read('/proc/swaps')) || '').split('\n').slice(1).filter(Boolean);
    return {
      platform: 'linux', journalReadable: Boolean(lines),
      events: { mce: count(/mce:|Machine Check/i), pcieAer: count(/AER:/), gpuHang: count(/amdgpu.*(timeout|hang)|NVRM: Xid|i915.*GPU HANG/i), diskIo: count(/I\/O error|blk_update_request|EXT4-fs error|BTRFS error|XFS.*error/i) },
      failedUnits: failed.code === 0 ? String(failed.stdout || '').split('\n').map((line) => line.trim().split(/\s+/)[0]).filter((name) => /^[\w@.-]+\.(service|mount|socket|timer)$/.test(name)).slice(0, 10) : [],
      rebootPending: { update: await fs.stat('/var/run/reboot-required').then(() => true).catch(() => false) },
      swap: swaps.map((line) => line.split(/\s+/)).map((parts) => ({ kind: /zram/.test(parts[0]) ? 'zram' : parts[1] || null, sizeKB: num(Number(parts[2]), 0, 2 ** 40) })).slice(0, 6)
    };
  }
  /** Uma leitura de pressão (PSI): quanto tempo tarefas esperaram por CPU, memória e disco nos últimos 10 s. */
  async function pressure() {
    const out = {};
    for (const kind of ['cpu', 'memory', 'io']) {
      const value = await read(`/proc/pressure/${kind}`);
      const some = String(value || '').match(/some avg10=([\d.]+)/);
      out[kind] = some ? num(Number(some[1]), 0, 100) : null;
    }
    return out;
  }
  async function frequencies() {
    const values = [];
    for (const name of await list('/sys/devices/system/cpu')) {
      if (!/^cpu\d+$/.test(name)) continue;
      const cur = Number(await read(`/sys/devices/system/cpu/${name}/cpufreq/scaling_cur_freq`));
      const max = Number(await read(`/sys/devices/system/cpu/${name}/cpufreq/cpuinfo_max_freq`));
      if (Number.isFinite(cur) && cur > 0) values.push({ mhz: cur / 1000, maxMhz: Number.isFinite(max) && max > 0 ? max / 1000 : null });
    }
    return values;
  }
  return { inventory, health, pressure, frequencies, pciLink };
}

/* ======================================================================================================
 * Execução no Windows
 * ==================================================================================================== */
/** PowerShell residente que emite JSON por linha; `env` só leva números (o script confere de novo). */
function streamScript({ spawnFn = spawn, script, env = {}, onLine, timeoutMs = 180000 }) {
  let child;
  try {
    child = spawnFn(systemTool('powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } });
  } catch (error) { return { done: Promise.resolve({ ok: false, error }), stop: () => {} }; }
  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', (line) => { try { onLine(line); } catch { /* linha ruim não derruba a coleta */ } });
  let timer = null;
  const done = new Promise((resolve) => {
    const finish = (ok) => { clearTimeout(timer); reader.close(); resolve({ ok }); };
    child.on('exit', (code) => finish(code === 0));
    child.on('error', () => finish(false));
    timer = setTimeout(() => { try { child.kill(); } catch { /* já saiu */ } }, timeoutMs);
  });
  return { done, stop: () => { try { child.kill(); } catch { /* já saiu */ } }, pid: child.pid };
}

module.exports = {
  INVENTORY_SCRIPT, HEALTH_SCRIPT, OBSERVE_SCRIPT, LOAD_SCRIPT, LINK_SCRIPT, DRIVERS_SCRIPT, DURING_SCRIPT, PS_HEAD,
  parseInventory, parseHealth, parseObserveLine, parseLoadLine, parseLinks, parseBar1, parseWlan, parseEdid, parseDrivers, parseDuring, outputOf,
  createLinuxCollector, streamScript, linuxGen
};
