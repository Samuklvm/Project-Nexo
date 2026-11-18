'use strict';
/*
 * Instalação sem janela: a tabela FECHADA de parâmetros silenciosos de cada instalador que o Nexo conhece.
 *
 * - A tela nunca manda parâmetro: manda o id do cartão. O processo principal escolhe o NOME do perfil (pela fonte do
 *   download) e a tarefa de administrador confere o nome aqui de novo antes de montar a linha de comando.
 * - "Saber ou não saber": `detect` lê o começo do .exe e só escolhe um perfil se achar a marca do tipo de instalador.
 *   Tipo desconhecido abre a janela do fabricante (nada de chutar parâmetro).
 * - Telemetria: onde o instalador deixa escolher na instalação, o perfil escolhe "não". Na NVIDIA isso é instalar só o
 *   driver (Display.Driver, áudio HDMI e PhysX), sem o NVIDIA App, que é quem traz a telemetria.
 */

const P = (args, minutes, codes) => Object.freeze({ args: Object.freeze(args), minutes, codes: Object.freeze(codes) });
const OK = { 0: 'ok' };
const OK_REBOOT = { 0: 'ok', 3010: 'restart' };

const PROFILES = Object.freeze({
  nvidia: P(['Display.Driver', 'HDAudio.Driver', 'PhysX', '-s', '-noreboot', '-noeula', '-nofinish', '-nosplash'], 60, OK),
  amd: P(['-install'], 60, OK),
  burn: P(['/install', '/quiet', '/norestart'], 45, { ...OK_REBOOT, 1638: 'nothing' }),
  vc2005: P(['/q'], 20, OK_REBOOT),
  vc2008: P(['/q'], 20, OK_REBOOT),
  vc2010: P(['/q', '/norestart'], 20, OK_REBOOT),
  dell: P(['/s'], 45, { 0: 'ok', 2: 'restart', 3: 'nothing', 5: 'notApplicable' }),
  hp: P(['/s'], 45, OK_REBOOT),
  inno: P(['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], 45, OK),
  nsis: P(['/S'], 45, OK),
  msi: P(['/qn', '/norestart'], 45, { ...OK_REBOOT, 1641: 'restart' }),
  installshield: P(['/s', '/v"/qn REBOOT=ReallySuppress"'], 45, OK_REBOOT),
  lghub: P(['--silent'], 30, OK)
});
/** Tipos que o `detect` sabe reconhecer pelo conteúdo do .exe. */
const DETECTABLE = Object.freeze(new Set(['burn', 'inno', 'nsis', 'installshield']));

const own = (name) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, name);
/** Nome aceito no plano: um perfil da tabela ou `detect`. */
const isName = (name) => own(name) || name === 'detect';
const profileFor = (name) => (own(name) ? PROFILES[name] : null);

/** O que o código de saída significa para esse perfil (código desconhecido = não deu certo). */
function outcome(name, code) {
  const what = own(name) ? PROFILES[name].codes[code] : undefined;
  if (what === 'ok') return { ok: true, restart: false };
  if (what === 'restart') return { ok: true, restart: true };
  if (what === 'nothing') return { ok: false, nothing: true };
  if (what === 'notApplicable') return { ok: false, notApplicable: true };
  return { ok: false };
}

/**
 * PowerShell que lê até 8 MB do instalador (`fileExpr` = variável já resolvida, ex. '$dst') e põe em `$profile` o
 * tipo achado, ou $null. A ordem importa: pacote WiX (Burn) pode carregar textos de outros tipos dentro.
 */
function detectCore(fileExpr) {
  return String.raw`
  $profile = $null
  $fs = [System.IO.File]::OpenRead(${fileExpr})
  try {
    $len = [int][Math]::Min($fs.Length, 8388608)
    $buf = New-Object byte[] $len
    $read = 0
    while ($read -lt $len) { $n = $fs.Read($buf, $read, $len - $read); if ($n -le 0) { break }; $read += $n }
  } finally { $fs.Dispose() }
  $txt = [System.Text.Encoding]::GetEncoding(28591).GetString($buf, 0, $read)
  if ($txt.Contains('.wixburn') -or $txt.Contains('WixBundle')) { $profile = 'burn' }
  elseif ($txt.Contains('Inno Setup')) { $profile = 'inno' }
  elseif ($txt.Contains('Nullsoft')) { $profile = 'nsis' }
  elseif ($txt.Contains('InstallShield')) { $profile = 'installshield' }`;
}

/** Arquivo baixado na página da AMD: o AMD Software tem perfil próprio; o resto (chipset etc.) passa pelo detect. */
function amdProfileFor(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._()-]{0,160}\.exe$/.test(name)) return null;
  return /adrenalin|radeon-software|amd-software/.test(name) ? 'amd' : 'detect';
}

module.exports = { PROFILES, DETECTABLE, isName, profileFor, outcome, detectCore, amdProfileFor };
