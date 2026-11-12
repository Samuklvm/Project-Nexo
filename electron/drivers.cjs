/*
 * Página de Drivers: o que está instalado neste PC e a versão mais recente nos sites oficiais.
 *  - Local: os drivers por função (o mesmo script da verificação completa), os dispositivos sem driver e os
 *    componentes que os jogos usam (Visual C++, DirectX 9, .NET, Vulkan, PhysX), mais placa-mãe/notebook para achar a
 *    página de suporte certa.
 *  - Online, só de fontes oficiais e só leitura: o serviço de busca de drivers da NVIDIA e o índice de versões do .NET
 *    da Microsoft. Nada é baixado nem instalado pelo Nexo e nada passa pelo Windows Update: o botão abre o site oficial.
 *  - O que vem da internet é tratado como dado não confiável: versão no formato esperado, link só https e só do
 *    domínio do fabricante.
 */
'use strict';
const Scan = require('./deep-scan.cjs');

const RUNTIMES_SCRIPT = Scan.PS_HEAD + String.raw`
$cs = Get-CimInstance Win32_ComputerSystem
$bb = Get-CimInstance Win32_BaseBoard
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
function VC($arch) {
  foreach ($base in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes', 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes')) {
    $k = Get-ItemProperty "$base\$arch"
    if ($k -and [int]$k.Installed -eq 1) { return [string]$k.Version }
  }
  return $null
}
$un = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' |
  Where-Object { [string]$_.DisplayName -match 'Visual C\+\+ .*Redistributable|PhysX' } |
  ForEach-Object { @{ name = [string]$_.DisplayName; version = [string]$_.DisplayVersion } } | Select-Object -First 40)
$sys = "$env:SystemRoot\System32"
$wow = "$env:SystemRoot\SysWOW64"
$dx = @{ d3dx9 = [bool]((Test-Path "$sys\d3dx9_43.dll") -or (Test-Path "$wow\d3dx9_43.dll")); xinput13 = [bool]((Test-Path "$sys\xinput1_3.dll") -or (Test-Path "$wow\xinput1_3.dll")); x3daudio = [bool]((Test-Path "$sys\X3DAudio1_7.dll") -or (Test-Path "$wow\X3DAudio1_7.dll")) }
$ndp = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full'
$desk = @()
$pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
foreach ($root in @("$env:ProgramFiles\dotnet\shared\Microsoft.WindowsDesktop.App", "$pf86\dotnet\shared\Microsoft.WindowsDesktop.App")) {
  if (Test-Path $root) { $desk += @(Get-ChildItem $root -Directory | ForEach-Object { [string]$_.Name }) }
}
$vk = $null
$vkf = Get-Item "$sys\vulkan-1.dll"
if ($vkf) { $vk = [string]$vkf.VersionInfo.ProductVersion }
$amd = Get-ItemProperty 'HKLM:\SOFTWARE\AMD\CN'
$bad = @(Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode <> 0' | Select-Object -First 12 | ForEach-Object {
  $hw = [string](@($_.HardwareID)[0])
  $ids = ''
  if ($hw -match '(VEN|VID)_([0-9A-Fa-f]{4}).*?(DEV|PID)_([0-9A-Fa-f]{4})') { $ids = ($Matches[2] + ':' + $Matches[4]).ToUpper() }
  @{ name = [string]$_.Name; code = [int]$_.ConfigManagerErrorCode; cls = [string]$_.PNPClass; ids = $ids }
})
$out = @{
  os = @{ build = [int]$os.CurrentBuild; name = [string]$os.ProductName; display = [string]$os.DisplayVersion }
  board = @{ maker = [string]$bb.Manufacturer; product = [string]$bb.Product; systemMaker = [string]$cs.Manufacturer; model = [string]$cs.Model; mobile = ([int]$cs.PCSystemType -eq 2) }
  vc = @{ x64 = (VC 'X64'); x86 = (VC 'X86'); arm64 = (VC 'ARM64') }
  uninstall = $un
  dx = $dx
  netfx = [int]$ndp.Release
  desktop = $desk
  vulkan = $vk
  amd = [string]$amd.RadeonSoftwareVersion
  missing = $bad
}
[Console]::Out.Write((ConvertTo-Json -InputObject $out -Depth 4 -Compress))`;

/*
 * Todos os drivers numa leitura só (Win32_PnPSignedDriver é lento): as classes principais (como na verificação
 * completa), o resto dos dispositivos com driver de fabricante e quantos usam só o driver do próprio Windows.
 */
const ALL_DRIVERS_SCRIPT = Scan.PS_HEAD + String.raw`
$main = @('DISPLAY', 'NET', 'MEDIA', 'SYSTEM', 'HDC', 'SCSIADAPTER', 'BLUETOOTH')
$skip = @('PROCESSOR', 'VOLUME', 'VOLUMESNAPSHOT', 'LEGACYDRIVER', 'COMPUTER', 'SOFTWAREDEVICE', 'SOFTWARECOMPONENT', 'EXTENSION', 'PRINTQUEUE', 'AUDIOENDPOINT')
function Row($d) {
  $hw = [string](@($d.HardWareID)[0])
  $ids = ''
  if ($hw -match '(VEN|VID)_([0-9A-Fa-f]{4}).*?(DEV|PID)_([0-9A-Fa-f]{4})') { $ids = ($Matches[2] + ':' + $Matches[4]).ToUpper() }
  @{ name = [string]$d.DeviceName; cls = ([string]$d.DeviceClass).ToUpper(); provider = [string]$d.DriverProviderName; maker = [string]$d.Manufacturer; version = [string]$d.DriverVersion; date = (D $d.DriverDate); ids = $ids; signed = [bool]$d.IsSigned }
}
$all = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DeviceClass })
$devices = @($all | Where-Object { $c = ([string]$_.DeviceClass).ToUpper(); $main -contains $c -and ($c -ne 'SYSTEM' -or [string]$_.DriverProviderName -notmatch '^Microsoft') } | Select-Object -First 220 | ForEach-Object { Row $_ })
$rest = @($all | Where-Object { $c = ([string]$_.DeviceClass).ToUpper(); $main -notcontains $c -and $skip -notcontains $c })
$others = @($rest | Where-Object { [string]$_.DriverProviderName -notmatch '^Microsoft' } | Select-Object -First 160 | ForEach-Object { Row $_ })
$generic = @($rest | Where-Object { [string]$_.DriverProviderName -match '^Microsoft' }).Count
[Console]::Out.Write((ConvertTo-Json -InputObject @{ devices = $devices; others = $others; generic = $generic } -Depth 4 -Compress))`;

function parseAllDrivers(stdout) {
  const body = String(stdout || '').trim();
  const start = body.indexOf('{');
  let raw = null;
  try { raw = start >= 0 ? JSON.parse(body.slice(start)) : null; } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return null;
  const rows = (list) => Scan.parseDrivers(JSON.stringify(asList(list)));
  const generic = Number(raw.generic);
  return { devices: rows(raw.devices), others: rows(raw.others).slice(0, 160), generic: Number.isInteger(generic) && generic >= 0 && generic < 100000 ? generic : null };
}

const text = (value, max = 120) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const asList = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);
const version = (value) => { const v = text(value, 40).replace(/^v(?=\d)/i, ''); return /^\d+(\.\d+){1,3}[a-z0-9.-]*$/i.test(v) ? v : null; };

function parseRuntimes(stdout) {
  const body = String(stdout || '').trim();
  const start = body.indexOf('{');
  let raw = null;
  try { raw = start >= 0 ? JSON.parse(body.slice(start)) : null; } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return null;
  const build = Number(raw.os?.build);
  return {
    os: { build: Number.isInteger(build) && build > 0 ? build : null, name: text(raw.os?.name, 60), display: text(raw.os?.display, 12) },
    board: { maker: text(raw.board?.maker, 60), product: text(raw.board?.product, 60), systemMaker: text(raw.board?.systemMaker, 60), model: text(raw.board?.model, 80), mobile: raw.board?.mobile === true },
    vc: { x64: version(raw.vc?.x64), x86: version(raw.vc?.x86), arm64: version(raw.vc?.arm64) },
    uninstall: asList(raw.uninstall).slice(0, 40).map((item) => ({ name: text(item?.name, 120), version: version(item?.version) })).filter((item) => item.name),
    dx: { d3dx9: raw.dx?.d3dx9 === true, xinput13: raw.dx?.xinput13 === true, x3daudio: raw.dx?.x3daudio === true },
    netfx: Number.isInteger(raw.netfx) && raw.netfx > 0 ? raw.netfx : null,
    desktop: [...new Set(asList(raw.desktop).map((item) => version(item)).filter(Boolean))].slice(0, 16),
    vulkan: version(raw.vulkan),
    amd: version(raw.amd),
    missing: asList(raw.missing).slice(0, 12).map((item) => ({ name: text(item?.name, 90), code: Number.isInteger(item?.code) ? item.code : null, cls: text(item?.cls, 30), ids: /^[0-9A-F]{4}:[0-9A-F]{4}$/.test(String(item?.ids || '')) ? item.ids : null })).filter((item) => item.name)
  };
}

/* ---------------- NVIDIA: o serviço oficial de busca de drivers ---------------- */
const NV_ENDPOINT = 'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php';
// Série/produto de referência de cada linha: o Game Ready é o mesmo para todas as GeForce da linha (desktop e notebook).
//  modern: RTX 20 em diante e GTX 16 (Turing+); legacy: GTX 900/10 (Maxwell/Pascal), que ficaram num ramo próprio.
const NV_LINES = { modern: { psid: 131, pfid: 1092 }, legacy: { psid: 98, pfid: 778 } };
function nvidiaUrl(line = 'modern', { win11 = true } = {}) {
  const ref = NV_LINES[line] || NV_LINES.modern;
  const params = new URLSearchParams({ func: 'DriverManualLookup', psid: String(ref.psid), pfid: String(ref.pfid), osID: win11 ? '135' : '57', languageCode: '1033', isWHQL: '0', beta: '0', dltype: '-1', dch: '1', upCRD: '0', qnf: '0', sort1: '1', numberOfResults: '1' });
  return `${NV_ENDPOINT}?${params}`;
}
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const safeDecode = (value) => { try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); } };
const officialLink = (value, domains) => {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
};
function parseNvidia(json) {
  const info = json?.IDS?.[0]?.downloadInfo;
  if (!info || String(json?.Success) !== '1') return null;
  const v = String(info.Version || '');
  if (!/^\d{3}\.\d{2}$/.test(v)) return null;
  const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(String(info.ReleaseDateTime || ''));
  const date = m && MONTHS[m[1]] ? `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
  return {
    version: v, date, name: text(safeDecode(info.Name), 60) || 'GeForce Game Ready Driver',
    details: officialLink(info.DetailsURL, ['nvidia.com']), download: officialLink(info.DownloadURL, ['nvidia.com']), size: text(String(info.DownloadURLFileSize || ''), 12) || null
  };
}

/* ---------------- .NET: o índice oficial de versões da Microsoft ---------------- */
const DOTNET_INDEX = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json';
function parseDotnet(json) {
  const rows = asList(json?.['releases-index']);
  const out = {};
  for (const row of rows) {
    const channel = String(row?.['channel-version'] || '');
    const latest = version(row?.['latest-runtime'] || row?.['latest-release']);
    if (!/^\d+\.\d+$/.test(channel) || !latest) continue;
    out[channel] = { latest, phase: text(row?.['support-phase'], 16) || null, eol: /^\d{4}-\d{2}-\d{2}$/.test(String(row?.['eol-date'] || '')) ? row['eol-date'] : null, type: text(row?.['release-type'], 8) || null };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Qual linha da NVIDIA consultar para a placa: 'modern' (Turing em diante), 'legacy' (Maxwell/Pascal, ramo próprio),
 * 'ended' (Kepler: a NVIDIA não lança mais driver), 'pro' (Quadro/RTX profissional: driver de outra linha, sem consulta)
 * ou null (não é NVIDIA).
 */
function nvidiaLine(name) {
  const n = String(name || '');
  if (!/nvidia|geforce|quadro|rtx|gtx|titan|tesla/i.test(n)) return null;
  if (/quadro|tesla|\bRTX\s?A\d{3,4}\b|\bRTX\s?\d{4}\s?Ada\b|\bRTX PRO\b|NVIDIA T\d{3,4}\b|NVIDIA A\d{2,3}\b/i.test(n)) return 'pro';
  if (/\bGT\s?6\d\d\b|\bGT\s?7[1-4]0\b|\bGTX\s?(6\d\d|7[6-9]0)\b|GTX TITAN( Black| Z)?$/i.test(n)) return 'ended';
  if (/\bGTX\s?(9\d\d|10[5-8]0)\b|\bGTX\s?(745|750)\b|TITAN Xp?\b|\bGT\s?1030\b|\bMX\s?[1-3]\d0\b/i.test(n)) return 'legacy';
  return 'modern';
}

function createDrivers({ runPowerShellCode, fetchJson, now = () => Date.now(), platform = process.platform } = {}) {
  let local = null;
  let localAt = 0;
  const online = new Map(); // url → { at, value }
  const ONLINE_TTL = 6 * 3600 * 1000;
  async function cachedFetch(url, parse) {
    const hit = online.get(url);
    if (hit && now() - hit.at < ONLINE_TTL) return hit.value;
    let value = null;
    try { value = parse(await fetchJson(url)); } catch { value = null; }
    if (value) online.set(url, { at: now(), value });
    return value;
  }
  async function readLocal(force) {
    if (local && !force && now() - localAt < 10 * 60 * 1000) return local;
    const [drivers, runtimes] = await Promise.all([
      runPowerShellCode(ALL_DRIVERS_SCRIPT, 110000).then((out) => parseAllDrivers(out.stdout)).catch(() => null),
      runPowerShellCode(RUNTIMES_SCRIPT, 60000).then((out) => parseRuntimes(out.stdout)).catch(() => null)
    ]);
    local = { devices: drivers?.devices || [], others: drivers?.others || [], generic: drivers?.generic ?? null, runtimes };
    localAt = now();
    return local;
  }
  /** Tudo que a página precisa. `online: false` não consulta nada fora do PC. */
  async function scan({ force = false, online: allowOnline = true } = {}) {
    if (platform !== 'win32') return { platform, devices: [], others: [], generic: null, runtimes: null, latest: {}, at: now() };
    const { devices, others, generic, runtimes } = await readLocal(force);
    const latest = {};
    if (allowOnline) {
      const win11 = (runtimes?.os?.build || 0) >= 22000;
      const lines = [...new Set((devices || []).filter((item) => item.cls === 'DISPLAY').map((item) => nvidiaLine(item.name)).filter((line) => line === 'modern' || line === 'legacy'))];
      const nv = await Promise.all(lines.map(async (line) => [line, await cachedFetch(nvidiaUrl(line, { win11 }), parseNvidia)]));
      if (nv.length) latest.nvidia = Object.fromEntries(nv);
      if (runtimes?.desktop?.length) latest.dotnet = await cachedFetch(DOTNET_INDEX, parseDotnet);
    }
    return { platform, devices: devices || [], others: others || [], generic, runtimes, latest, at: now() };
  }
  return { scan };
}

module.exports = { createDrivers, ALL_DRIVERS_SCRIPT, RUNTIMES_SCRIPT, parseRuntimes, parseAllDrivers, parseNvidia, parseDotnet, nvidiaUrl, nvidiaLine, officialLink, NV_ENDPOINT, DOTNET_INDEX };
