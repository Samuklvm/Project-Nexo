/*
 * Drivers, parte 4: backup dos drivers instalados e restauração.
 *  - Backup: pnputil /export-driver * (a ferramenta do próprio Windows), numa pasta datada dentro de
 *    Documentos\Nexo\Backup de drivers. Pede administrador uma vez; nada é apagado nem trocado.
 *  - Restaurar: pnputil /add-driver <pasta>\*.inf /subdirs /install (o Windows só instala o que casar com as peças).
 *  - Só pastas com nome do próprio Nexo ("AAAA-MM-DD HHhMM"), sempre dentro da pasta de backups.
 */
'use strict';
const { psQuote } = require('./driver-signature.cjs');

const WRITE = '$r | ConvertTo-Json -Compress | Set-Content -LiteralPath $NexoOut -Encoding UTF8';
const META = 'nexo-backup.json';
const NAME = /^\d{4}-\d{2}-\d{2} \d{2}h\d{2}( \(\d{1,2}\))?$/;
const win = require('node:path').win32;

const two = (n) => String(n).padStart(2, '0');
const stampName = (date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}h${two(date.getMinutes())}`;
const validName = (name) => typeof name === 'string' && NAME.test(name);
/** Pasta de backup = raiz + um nome do Nexo (nada de "..", outra unidade ou rede). */
function insideRoot(dir, root) {
  if (typeof dir !== 'string' || typeof root !== 'string' || !root || dir.includes('..') || dir.startsWith('\\\\')) return false;
  const rel = win.relative(win.resolve(root), win.resolve(dir));
  return Boolean(rel) && !rel.includes('\\') && validName(rel);
}

/** A raiz dos backups: Documentos\Nexo\..., menos quando Documentos está no OneDrive ou na rede (aí, a pasta do usuário). */
function backupRootFor({ documents, home } = {}) {
  const docs = String(documents || '');
  const synced = !docs || docs.startsWith('\\\\') || /\\onedrive( - [^\\]+)?(\\|$)/i.test(docs);
  return win.join(synced ? String(home || '') : docs, 'Nexo', 'Backup de drivers');
}
// Recusa atalho de pasta (junção/link) na raiz, na pasta do Nexo e na do backup: o administrador não segue um caminho trocado.
const noReparse = (dirs) => String.raw`
  foreach ($p in @(${dirs.map(psQuote).join(', ')})) {
    if ((Test-Path -LiteralPath $p) -and (((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { $r.note = 'a pasta de backups é um atalho, então parei'; ${WRITE}; return }
  }`;
const chain = (dir, root) => [win.dirname(win.resolve(root)), win.resolve(root), win.resolve(dir)];

function driverBackupBody({ dest, root } = {}) {
  if (!insideRoot(dest, root)) throw new Error('Backup fora da pasta de backups do Nexo.');
  return String.raw`
$r = @{ ok = $false; code = $null; count = 0; partial = $false; note = '' }
& {
try {${noReparse(chain(dest, root))}
  New-Item -ItemType Directory -Force -Path ${psQuote(dest)} | Out-Null
  $null = & pnputil.exe /export-driver * ${psQuote(dest)}
  $r.code = [int]$LASTEXITCODE
  $r.count = @(Get-ChildItem -LiteralPath ${psQuote(dest)} -Filter '*.inf' -File -Recurse -ErrorAction SilentlyContinue).Count
  # Código diferente de 0 com drivers na pasta: o Windows exportou quase tudo (algum driver protegido ficou de fora).
  $r.ok = ($r.count -gt 0)
  $r.partial = $r.ok -and ($r.code -ne 0)
  if (-not $r.ok) { $r.note = "o Windows não exportou os drivers (código $($r.code))" }
} catch { $r.note = $_.Exception.Message }
${WRITE}
}`;
}
function driverRestoreBody({ dir, root } = {}) {
  if (!insideRoot(dir, root)) throw new Error('Restauração fora da pasta de backups do Nexo.');
  return String.raw`
$r = @{ ok = $false; code = $null; nothing = $false; note = '' }
& {
$work = Join-Path (Join-Path $env:SystemRoot 'Temp') ('Nexo-restore-' + [guid]::NewGuid().ToString('N'))
try {${noReparse(chain(dir, root))}
  # Copia para uma pasta que só o sistema e os administradores mexem: ninguém troca um arquivo depois da conferência.
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sidText in @('S-1-5-18', 'S-1-5-32-544')) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier($sidText)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  [System.IO.Directory]::CreateDirectory($work, $acl) | Out-Null
  $src = (Resolve-Path -LiteralPath ${psQuote(dir)}).ProviderPath
  foreach ($f in @(Get-ChildItem -LiteralPath $src -File -Recurse -Force | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 })) {
    $to = Join-Path $work $f.FullName.Substring($src.Length).TrimStart('\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    [System.IO.File]::Copy($f.FullName, $to, $false)
  }
  $cats = @(Get-ChildItem -LiteralPath $work -Filter '*.cat' -File -Recurse)
  if ($cats.Count -eq 0) { $r.note = 'o backup não tem drivers assinados'; ${WRITE}; return }
  foreach ($cat in $cats) {
    if ((Get-AuthenticodeSignature -LiteralPath $cat.FullName).Status -ne 'Valid') { $r.note = "um driver do backup não está mais assinado ($($cat.Name)), então parei"; ${WRITE}; return }
  }
  $null = & pnputil.exe /add-driver (Join-Path $work '*.inf') /subdirs /install
  $r.code = [int]$LASTEXITCODE
  $r.ok = @(0, 3010) -contains $r.code
  if ($r.code -eq 259) { $r.nothing = $true }
  elseif (-not $r.ok) { $r.note = "o Windows recusou a restauração (código $($r.code))" }
} catch { $r.note = $_.Exception.Message } finally { if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue } }
${WRITE}
}`;
}

function createDriverBackups({ fs, path, root, elevate, openPath = async () => '', now = () => Date.now() } = {}) {
  const base = () => root();
  async function freeName() {
    const stamp = stampName(new Date(now()));
    for (let n = 1; n < 50; n += 1) {
      const name = n === 1 ? stamp : `${stamp} (${n})`;
      try { await fs.stat(path.join(base(), name)); } catch { return name; }
    }
    throw new Error('Muitos backups no mesmo minuto.');
  }
  async function create() {
    await fs.mkdir(base(), { recursive: true });
    const name = await freeName();
    const dest = path.join(base(), name);
    let answer;
    try { answer = await elevate('driver-backup', { dest, root: base() }); } catch (error) { return { ok: false, name: null, count: 0, note: String(error?.message || 'Não consegui fazer o backup.').slice(0, 200) }; }
    if (answer?.declined) return { ok: false, name: null, count: 0, note: 'Você recusou a permissão de administrador.' };
    const r = answer?.result;
    if (!r?.ok) {
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      return { ok: false, name: null, count: 0, note: String(r?.note || 'O backup não terminou.').slice(0, 200) };
    }
    const count = Number.isInteger(r.count) ? r.count : 0;
    await fs.writeFile(path.join(dest, META), JSON.stringify({ at: now(), count })).catch(() => {});
    return { ok: true, name, count, note: r.partial ? 'O Windows não deixou copiar alguns drivers (os protegidos do sistema); o resto está no backup.' : '' };
  }
  async function list() {
    const names = (await fs.readdir(base()).catch(() => [])).filter(validName);
    const out = [];
    for (const name of names) {
      let meta = null;
      try { meta = JSON.parse(await fs.readFile(path.join(base(), name, META), 'utf8')); } catch { meta = null; }
      let at = Number(meta?.at);
      if (!Number.isFinite(at)) { try { at = (await fs.stat(path.join(base(), name))).mtimeMs; } catch { at = 0; } }
      out.push({ name, at, count: Number.isInteger(meta?.count) ? meta.count : null });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 20);
  }
  async function existing(name) {
    if (!validName(name)) throw new Error('Esse backup não existe.');
    const dir = path.join(base(), name);
    try { if (!(await fs.stat(dir)).isDirectory()) throw new Error('x'); } catch { throw new Error('Esse backup não existe.'); }
    return dir;
  }
  async function restore(name) {
    const dir = await existing(name);
    let answer;
    try { answer = await elevate('driver-restore', { dir, root: base() }); } catch (error) { return { ok: false, restart: false, note: String(error?.message || 'Não consegui restaurar.').slice(0, 200) }; }
    if (answer?.declined) return { ok: false, restart: false, note: 'Você recusou a permissão de administrador.' };
    const r = answer?.result;
    if (r?.nothing) return { ok: false, restart: false, nothing: true, note: 'Nada mudou: o Windows já usa esses drivers ou versões mais novas (restaurar não volta versão).' };
    if (!r?.ok) return { ok: false, restart: false, note: String(r?.note || 'A restauração não terminou.').slice(0, 200) };
    return { ok: true, restart: r.code === 3010, note: '' };
  }
  async function open(name) {
    const dir = await existing(name);
    await openPath(dir);
    return { ok: true };
  }
  return { create, list, restore, open };
}

module.exports = { createDriverBackups, backupRootFor, driverBackupBody, driverRestoreBody, stampName, validName, insideRoot };
