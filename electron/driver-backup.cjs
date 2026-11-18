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

function driverBackupBody({ dest, root } = {}) {
  if (!insideRoot(dest, root)) throw new Error('Backup fora da pasta de backups do Nexo.');
  return String.raw`
$r = @{ ok = $false; code = $null; count = 0; note = '' }
try {
  New-Item -ItemType Directory -Force -Path ${psQuote(dest)} | Out-Null
  $null = & pnputil.exe /export-driver * ${psQuote(dest)}
  $r.code = [int]$LASTEXITCODE
  $r.count = @(Get-ChildItem -LiteralPath ${psQuote(dest)} -Filter '*.inf' -File -Recurse -ErrorAction SilentlyContinue).Count
  $r.ok = ($r.code -eq 0) -and ($r.count -gt 0)
  if (-not $r.ok) { $r.note = "o Windows não exportou os drivers (código $($r.code))" }
} catch { $r.note = $_.Exception.Message }
${WRITE}`;
}
function driverRestoreBody({ dir, root } = {}) {
  if (!insideRoot(dir, root)) throw new Error('Restauração fora da pasta de backups do Nexo.');
  return String.raw`
$r = @{ ok = $false; code = $null; note = '' }
try {
  $null = & pnputil.exe /add-driver (Join-Path ${psQuote(dir)} '*.inf') /subdirs /install
  $r.code = [int]$LASTEXITCODE
  $r.ok = @(0, 3010, 259) -contains $r.code
  if (-not $r.ok) { $r.note = "o Windows recusou a restauração (código $($r.code))" }
} catch { $r.note = $_.Exception.Message }
${WRITE}`;
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
    return { ok: true, name, count, note: '' };
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

module.exports = { createDriverBackups, driverBackupBody, driverRestoreBody, stampName, validName, insideRoot };
