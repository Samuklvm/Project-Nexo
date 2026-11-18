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
const Vendors = require('../src/vendors.js');
const OemCatalogs = require('./oem-catalogs.cjs');
const MsCatalog = require('./ms-catalog.cjs');
const Oem = require('../src/oem.js');

const RUNTIMES_SCRIPT = Scan.PS_HEAD + String.raw`
$cs = Get-CimInstance Win32_ComputerSystem
$bb = Get-CimInstance Win32_BaseBoard
$csp = Get-CimInstance Win32_ComputerSystemProduct
$bios = Get-CimInstance Win32_BIOS
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
function VC($arch) {
  foreach ($base in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes', 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes')) {
    $k = Get-ItemProperty "$base\$arch"
    if ($k -and [int]$k.Installed -eq 1) { return [string]$k.Version }
  }
  return $null
}
# Runtimes, e os programas oficiais que atualizam drivers (assistente da Intel, G HUB, GG, Synapse, iCUE, AMD).
$un = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { [string]$_.DisplayName -match 'Visual C\+\+ .*Redistributable|PhysX|Logitech G HUB|SteelSeries GG|Razer Synapse|iCUE|Driver & Support Assistant|AMD Software' } |
  ForEach-Object { @{ name = [string]$_.DisplayName; version = [string]$_.DisplayVersion } } | Select-Object -First 40)
# Programas instalados com ícone (DisplayIcon): o ícone de verdade de cada componente e de cada fabricante vem daqui.
$apps = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' |
  Where-Object { $_.DisplayName -and $_.DisplayIcon } |
  ForEach-Object { @{ name = [string]$_.DisplayName; publisher = [string]$_.Publisher; icon = [string]$_.DisplayIcon } } | Select-Object -First 400)
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
  @{ name = [string]$_.Name; code = [int]$_.ConfigManagerErrorCode; cls = [string]$_.PNPClass; ids = $ids; hwids = @($_.HardwareID | Select-Object -First 6 | ForEach-Object { [string]$_ }) }
})
$out = @{
  os = @{ build = [int]$os.CurrentBuild; name = [string]$os.ProductName; display = [string]$os.DisplayVersion }
  board = @{ maker = [string]$bb.Manufacturer; product = [string]$bb.Product; systemMaker = [string]$cs.Manufacturer; model = [string]$cs.Model; mobile = ([int]$cs.PCSystemType -eq 2); sku = [string]$cs.SystemSKUNumber; version = [string]$csp.Version; bios = [string]$bios.SMBIOSBIOSVersion }
  vc = @{ x64 = (VC 'X64'); x86 = (VC 'X86'); arm64 = (VC 'ARM64') }
  uninstall = $un
  dx = $dx
  netfx = [int]$ndp.Release
  desktop = $desk
  vulkan = $vk
  amd = [string]$amd.RadeonSoftwareVersion
  missing = $bad
  apps = $apps
  systemRoot = [string]$env:SystemRoot
  programFiles = [string]$env:ProgramFiles
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
  @{ name = [string]$d.DeviceName; cls = ([string]$d.DeviceClass).ToUpper(); provider = [string]$d.DriverProviderName; maker = [string]$d.Manufacturer; version = [string]$d.DriverVersion; date = (D $d.DriverDate); ids = $ids; signed = [bool]$d.IsSigned; hwids = @(@($(if ($ent.ContainsKey([string]$d.DeviceID)) { $ent[[string]$d.DeviceID] } else { $d.HardWareID })) | Select-Object -First 6 | ForEach-Object { [string]$_ }); inf = [string]$d.InfName }
}
# Win32_PnPSignedDriver só traz o primeiro código de hardware; a lista inteira vem do Win32_PnPEntity (pelo DeviceID).
$ent = @{}
Get-CimInstance Win32_PnPEntity | ForEach-Object { if ($_.PNPDeviceID) { $ent[[string]$_.PNPDeviceID] = @($_.HardwareID) } }
$all = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DeviceClass })
$devices = @($all | Where-Object { $c = ([string]$_.DeviceClass).ToUpper(); $main -contains $c -and ($c -ne 'SYSTEM' -or [string]$_.DriverProviderName -notmatch '^Microsoft') } | Select-Object -First 220 | ForEach-Object { Row $_ })
$rest = @($all | Where-Object { $c = ([string]$_.DeviceClass).ToUpper(); $main -notcontains $c -and $skip -notcontains $c })
$others = @($rest | Where-Object { [string]$_.DriverProviderName -notmatch '^Microsoft' } | Select-Object -First 160 | ForEach-Object { Row $_ })
$genericAll = @($rest | Where-Object { [string]$_.DriverProviderName -match '^Microsoft' })
$generic = $genericAll.Count
# Os de driver da Microsoft não ganham cartão próprio, mas entram no casamento com os pacotes do fabricante do PC.
$genericDevices = @($genericAll | Select-Object -First 300 | ForEach-Object { Row $_ })
[Console]::Out.Write((ConvertTo-Json -InputObject @{ devices = $devices; others = $others; generic = $generic; genericDevices = $genericDevices } -Depth 4 -Compress))`;

function parseAllDrivers(stdout) {
  const body = String(stdout || '').trim();
  const start = body.indexOf('{');
  let raw = null;
  try { raw = start >= 0 ? JSON.parse(body.slice(start)) : null; } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return null;
  // Cada linha passa pela mesma limpeza da verificação completa, mais os códigos de hardware e o INF.
  const rows = (list, max) => asList(list).slice(0, max).map((item) => {
    const row = Scan.parseDrivers(JSON.stringify([item]))[0];
    return row ? { ...row, hwids: hwidsOf(item?.hwids), inf: /^[\w.-]{1,40}\.inf$/i.test(String(item?.inf || '')) ? item.inf : '' } : null;
  }).filter(Boolean);
  const generic = Number(raw.generic);
  return { devices: rows(raw.devices, 220), others: rows(raw.others, 160), genericDevices: rows(raw.genericDevices, 300), generic: Number.isInteger(generic) && generic >= 0 && generic < 100000 ? generic : null };
}

const text = (value, max = 120) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const asList = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);
/** Até 6 códigos de hardware do Windows, maiúsculos, só os caracteres que eles usam (o resto é descartado). */
const hwidsOf = (value) => asList(typeof value === 'string' ? [value] : value).slice(0, 6).map((id) => String(id ?? '').trim().toUpperCase()).filter((id) => id.length > 0 && id.length <= 200 && /^[A-Z0-9_&\\.-]+$/.test(id));
/* Cortes sem expressão regular (o SonarCloud acusa retrocesso nas versões com regex). */
const trimEndChar = (v, ch) => { let end = v.length; while (end > 0 && v[end - 1] === ch) end -= 1; return v.slice(0, end); };
const trimChar = (v, ch) => { let start = 0; while (start < v.length && v[start] === ch) start += 1; return trimEndChar(v.slice(start), ch); };
// "C:\pasta\app.exe",0  ->  "C:\pasta\app.exe (tira o índice do ícone do fim, com a aspa e os espaços antes da vírgula)
const withoutIconIndex = (v) => {
  const comma = v.lastIndexOf(',');
  if (comma < 0 || !/^\s*-?\d+\s*$/.test(v.slice(comma + 1))) return v;
  const head = v.slice(0, comma).trimEnd();
  return head.endsWith('"') ? head.slice(0, -1) : head;
};
const version = (value) => { const v = text(value, 40).replace(/^v(?=\d)/i, ''); const head = /^\d+(?:\.\d+){1,3}/.exec(v); return head && /^[a-z0-9.-]*$/i.test(v.slice(head[0].length)) ? v : null; };

/*
 * Caminho de ícone vindo do registro (DisplayIcon: "C:\\...\\x.exe",0): só arquivo local de verdade (letra de unidade,
 * nunca \\servidor — abrir caminho de rede mandaria as credenciais do Windows para fora), só .exe/.dll/.ico.
 */
function iconPath(value) {
  let v = trimChar(text(String(value || ''), 400), '"');
  v = trimChar(withoutIconIndex(v), '"').trim();
  if (!/^[A-Za-z]:\\[^<>"|?*\u0000-\u001f]+\.(exe|dll|ico)$/i.test(v) || v.includes('..')) return null;
  return v;
}
const localDir = (value) => { const v = text(String(value || ''), 200); return /^[A-Za-z]:\\[^<>"|?*\u0000-\u001f]*$/.test(v) && !v.includes('..') ? trimEndChar(v, '\\') : null; };

function parseRuntimes(stdout) {
  const body = String(stdout || '').trim();
  const start = body.indexOf('{');
  let raw = null;
  try { raw = start >= 0 ? JSON.parse(body.slice(start)) : null; } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return null;
  const build = Number(raw.os?.build);
  return {
    os: { build: Number.isInteger(build) && build > 0 ? build : null, name: text(raw.os?.name, 60), display: text(raw.os?.display, 12) },
    board: { maker: text(raw.board?.maker, 60), product: text(raw.board?.product, 60), systemMaker: text(raw.board?.systemMaker, 60), model: text(raw.board?.model, 80), mobile: raw.board?.mobile === true, sku: text(raw.board?.sku, 20), version: text(raw.board?.version, 80), bios: text(raw.board?.bios, 40) },
    vc: { x64: version(raw.vc?.x64), x86: version(raw.vc?.x86), arm64: version(raw.vc?.arm64) },
    uninstall: asList(raw.uninstall).slice(0, 40).map((item) => ({ name: text(item?.name, 120), version: version(item?.version) })).filter((item) => item.name),
    dx: { d3dx9: raw.dx?.d3dx9 === true, xinput13: raw.dx?.xinput13 === true, x3daudio: raw.dx?.x3daudio === true },
    netfx: Number.isInteger(raw.netfx) && raw.netfx > 0 ? raw.netfx : null,
    desktop: [...new Set(asList(raw.desktop).map((item) => version(item)).filter(Boolean))].slice(0, 16),
    vulkan: version(raw.vulkan),
    amd: version(raw.amd),
    apps: asList(raw.apps).slice(0, 400).map((item) => ({ name: text(item?.name, 120), publisher: text(item?.publisher, 80), icon: iconPath(item?.icon) })).filter((item) => item.name && item.icon),
    systemRoot: localDir(raw.systemRoot), programFiles: localDir(raw.programFiles),
    missing: asList(raw.missing).slice(0, 12).map((item) => ({ name: text(item?.name, 90), code: Number.isInteger(item?.code) ? item.code : null, cls: text(item?.cls, 30), ids: /^[0-9A-F]{4}:[0-9A-F]{4}$/.test(String(item?.ids || '')) ? item.ids : null, hwids: hwidsOf(item?.hwids) })).filter((item) => item.name)
  };
}

/* ---------------- NVIDIA: o serviço oficial de busca de drivers ---------------- */
const NV_ENDPOINT = 'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php';
// Série/produto de referência de cada linha: o Game Ready é o mesmo para todas as GeForce da linha (desktop e notebook).
//  modern: RTX 20 em diante e GTX 16 (Turing+); legacy: GTX 900/10 (Maxwell/Pascal), que ficaram num ramo próprio.
const NV_LINES = { modern: { psid: 131, pfid: 1092 }, legacy: { psid: 98, pfid: 778 } };
// Notebook: o pacote é outro (mesmo número de versão, instalador "-notebook-"). Séries do serviço oficial
// lookupValueSearch (TypeID=2/3): RTX 40 Series (Notebooks) 129 / RTX 4070 Laptop GPU 1006; GeForce 10 Series (Notebooks) 102 / GTX 1060 821.
const NV_LINES_NOTEBOOK = { modern: { psid: 129, pfid: 1006 }, legacy: { psid: 102, pfid: 821 } };
function nvidiaUrl(line = 'modern', { win11 = true, notebook = false } = {}) {
  const lines = notebook ? NV_LINES_NOTEBOOK : NV_LINES;
  const ref = lines[line] || lines.modern;
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

/** O arquivo do .NET Desktop Runtime (x64) da versão mais recente de um canal: só link da Microsoft e só com SHA-512. */
const dotnetReleaseUrl = (channel) => `https://builds.dotnet.microsoft.com/dotnet/release-metadata/${channel}/releases.json`;
function parseDotnetRelease(json) {
  const desk = asList(json?.releases)[0]?.windowsdesktop;
  const file = asList(desk?.files).find((item) => item?.rid === 'win-x64' && /\.exe$/i.test(String(item?.name || '')));
  const url = officialLink(file?.url, ['microsoft.com', 'dot.net']);
  const sha512 = /^[0-9a-f]{128}$/i.test(String(file?.hash || '')) ? String(file.hash).toLowerCase() : null;
  const v = version(desk?.version);
  return url && sha512 && v ? { version: v, url, sha512 } : null;
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
  if (/(?:\bGT\s?6\d\d\b)|(?:\bGT\s?7[1-4]0\b)|(?:\bGTX\s?(?:6\d\d|7[6-9]0)\b)|(?:GTX TITAN(?: Black| Z)?$)/i.test(n)) return 'ended';
  if (/\bGTX\s?(9\d\d|10[5-8]0)\b|\bGTX\s?(745|750)\b|TITAN Xp?\b|\bGT\s?1030\b|\bMX\s?[1-3]\d0\b/i.test(n)) return 'legacy';
  return 'modern';
}

/*
 * O ícone de verdade de cada componente e fabricante, tirado dos programas instalados neste PC (o mesmo que o Windows
 * mostra em "Aplicativos instalados"): Visual C++ do instalador do Visual C++, .NET do runtime, PhysX do PhysX,
 * DirectX do dxdiag do Windows; para os fabricantes, o do pacote de driver deles. Volta chave → caminho do arquivo.
 */
const COMPONENT_APPS = [
  ['vs', /visual c\+\+ (2015|2017|2019|2022|v14).*redistributable.*(x64|amd64)/i],
  ['vs', /visual c\+\+ .*redistributable/i],
  ['dotnet', /windows desktop runtime|\.net (desktop )?runtime|microsoft \.net/i],
  ['physx', /physx/i]
];
const DRIVER_APP = /driver|graphics|gráfico|audio|áudio|chipset|wi-?fi|wireless|bluetooth|ethernet|\blan\b|control panel|painel|software|synapse|g hub|icue|engine/i;
function iconSources(runtimes) {
  const out = {};
  const apps = runtimes?.apps || [];
  for (const [key, re] of COMPONENT_APPS) if (!out[key]) { const hit = apps.find((app) => re.test(app.name)); if (hit) out[key] = hit.icon; }
  if (runtimes?.systemRoot) out.directx = `${runtimes.systemRoot}\\System32\\dxdiag.exe`;
  // Fabricantes: o programa dele que tem cara de driver primeiro, depois qualquer outro dele.
  const ranked = [...apps].sort((a, b) => Number(DRIVER_APP.test(b.name)) - Number(DRIVER_APP.test(a.name)));
  for (const app of ranked) {
    const vendor = app.publisher ? Vendors.vendorOf({ provider: app.publisher }) : null;
    if (vendor && !out[vendor.key] && vendor.key !== 'microsoft') out[vendor.key] = app.icon;
  }
  return out;
}

function createDrivers({ runPowerShellCode, fetchJson, fetchText = null, fetchBytes = null, fs = null, catalogDir = null, oemLimitMs, fileIcon = null, now = () => Date.now(), platform = process.platform } = {}) {
  // Catálogo oficial do fabricante do PC (Dell, HP, Lenovo, ASUS...): só quando o app injeta rede, disco e pasta.
  // Último recurso (parte 3): Catálogo da Microsoft, só para peça sem driver e sem fabricante identificável.
  const msCatalog = typeof fetchText === 'function' ? MsCatalog.createMsCatalog({ fetchText, now }) : null;
  const oemCatalogs = OemCatalogs.createOemCatalogs({ fetchBytes, runPowerShellCode, fs, catalogDir, now, ...(oemLimitMs ? { limitMs: oemLimitMs } : {}) });
  const iconCache = new Map(); // caminho → data: URL (ou null)
  async function localIcons(runtimes) {
    if (!fileIcon) return {};
    const entries = Object.entries(iconSources(runtimes)).slice(0, 60);
    const out = {};
    await Promise.all(entries.map(async ([key, file]) => {
      if (!iconCache.has(file)) iconCache.set(file, await fileIcon(file).catch(() => null));
      const data = iconCache.get(file);
      if (typeof data === 'string' && /^data:image\/png;base64,/.test(data) && data.length > 200) out[key] = data;
    }));
    return out;
  }
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
    local = { devices: drivers?.devices || [], others: drivers?.others || [], genericDevices: drivers?.genericDevices || [], generic: drivers?.generic ?? null, runtimes };
    localAt = now();
    return local;
  }
  /** Tudo que a página precisa. `online: false` não consulta nada fora do PC. */
  async function scan({ force = false, online: allowOnline = true } = {}) {
    if (platform !== 'win32') return { platform, devices: [], others: [], genericDevices: [], generic: null, runtimes: null, latest: {}, icons: {}, at: now() };
    const { devices, others, genericDevices, generic, runtimes } = await readLocal(force);
    const latest = {};
    if (allowOnline) {
      const win11 = (runtimes?.os?.build || 0) >= 22000;
      const lines = [...new Set((devices || []).filter((item) => item.cls === 'DISPLAY').map((item) => nvidiaLine(item.name)).filter((line) => line === 'modern' || line === 'legacy'))];
      const nv = await Promise.all(lines.map(async (line) => [line, await cachedFetch(nvidiaUrl(line, { win11 }), parseNvidia)]));
      if (nv.length) latest.nvidia = Object.fromEntries(nv);
      if (nv.length && runtimes?.board?.mobile === true) {
        latest.nvidiaNotebook = Object.fromEntries(await Promise.all(lines.map(async (line) => [line, await cachedFetch(nvidiaUrl(line, { win11, notebook: true }), parseNvidia)])));
      }
      if (runtimes?.desktop?.length) {
        latest.dotnet = await cachedFetch(DOTNET_INDEX, parseDotnet);
        // O arquivo oficial (com hash) só dos canais instalados, no máximo 3.
        const channels = [...new Set(runtimes.desktop.map((v) => v.split('.').slice(0, 2).join('.')))].filter((c) => latest.dotnet?.[c]).slice(0, 3);
        const files = await Promise.all(channels.map(async (c) => [c, await cachedFetch(dotnetReleaseUrl(c), parseDotnetRelease)]));
        if (files.some(([, value]) => value)) latest.dotnetFiles = Object.fromEntries(files.filter(([, value]) => value));
      }
      if (oemCatalogs) {
        let oem = null;
        try { oem = await oemCatalogs.lookup({ runtimes, devices: [...(devices || []), ...(genericDevices || []), ...(runtimes?.missing || [])] }); } catch { oem = null; }
        if (oem) latest.oem = oem;
      }
      if (msCatalog) {
        const covered = new Set(Oem.matchPackages(runtimes?.missing || [], latest.oem?.packages || []).flatMap((m) => m.devices));
        const orphans = (runtimes?.missing || []).filter((m) => m.code === 28 && !covered.has(m) && !Vendors.vendorOf({ name: m.name, ids: m.ids }))
          .map((m) => ({ key: `${m.name}-${m.ids || ''}`, hwids: m.hwids }));
        if (orphans.length) latest.catalog = msCatalog.lookup(orphans);
      }
    }
    const icons = await localIcons(runtimes);
    return { platform, devices: devices || [], others: others || [], genericDevices: genericDevices || [], generic, runtimes, latest, icons, at: now() };
  }
  // A busca do fabricante do PC roda em segundo plano; isto espera ela terminar (a tela pergunta de novo depois).
  const oemSettled = () => Promise.all([oemCatalogs ? oemCatalogs.settled() : null, msCatalog ? msCatalog.settled() : null]).then(() => undefined);
  return { scan, oemSettled };
}

module.exports = { expandCabScript: OemCatalogs.expandCabScript, createDrivers, parseDotnetRelease, dotnetReleaseUrl, NV_LINES_NOTEBOOK, iconSources, iconPath, ALL_DRIVERS_SCRIPT, RUNTIMES_SCRIPT, parseRuntimes, parseAllDrivers, parseNvidia, parseDotnet, nvidiaUrl, nvidiaLine, officialLink, NV_ENDPOINT, DOTNET_INDEX };
