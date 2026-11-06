/*
 * Letra da unidade → disco físico (modelo, conexão e tipo), só leitura. Serve para achar a temperatura do SSD
 * certo nos sensores e mostrar "SSD NVMe", "HD SATA" etc. na Manutenção.
 */
const DISK_MODEL_SCRIPT = String.raw`
$out = @{}
$physical = @(Get-PhysicalDisk -ErrorAction SilentlyContinue)
Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter } | ForEach-Object {
  try {
    $disk = Get-Disk -Number $_.DiskNumber -ErrorAction Stop
    $pd = $physical | Where-Object { [string]$_.DeviceId -eq [string]$disk.Number } | Select-Object -First 1
    $out[[string]$_.DriveLetter] = @{ model = [string]$disk.FriendlyName; bus = [string]$disk.BusType; media = [string]$pd.MediaType }
  } catch {}
}
[Console]::Out.Write(($out | ConvertTo-Json -Compress))`;

const clean = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** Lê a saída do script: { C: { model, bus, media } }. Qualquer coisa fora disso é descartada. */
function parseDiskModels(stdout) {
  let parsed = {};
  try { parsed = JSON.parse(String(stdout || '').trim() || '{}'); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [letter, info] of Object.entries(parsed)) {
    if (!/^[A-Za-z]$/.test(letter) || !info || typeof info !== 'object') continue;
    out[letter.toUpperCase()] = { model: clean(info.model, 80), bus: clean(info.bus, 20), media: clean(info.media, 20) };
  }
  return out;
}

module.exports = { DISK_MODEL_SCRIPT, parseDiskModels };
