/*
 * Drivers com um clique: a conferência da assinatura digital de cada instalador baixado.
 *  - Só libera arquivo com assinatura Authenticode válida E da empresa esperada (campo O= do certificado, igualdade
 *    exata). "NVIDIA Corp Fake" não passa por "NVIDIA Corporation".
 *  - O mesmo trecho roda sem administrador (logo depois do download) e dentro da tarefa elevada, logo antes de abrir o
 *    instalador (elevate.cjs), para o arquivo conferido ser o mesmo que roda.
 *  - Só arquivo direto na pasta de downloads do Nexo, local (nunca \\servidor), .exe ou .msi.
 */
'use strict';
const path = require('node:path');

const SIGNERS = Object.freeze({ nvidia: 'NVIDIA Corporation', microsoft: 'Microsoft Corporation' });
const ALLOWED = new Set(Object.values(SIGNERS));
const allowedSigner = (signer) => ALLOWED.has(signer);
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Trecho PowerShell que deixa em $sig o resultado da conferência do arquivo (sem gravar nada). */
function signatureCore(file, signer) {
  return String.raw`
$sig = @{ valid = $false; status = 'Missing'; org = $null }
try {
  $s = Get-AuthenticodeSignature -LiteralPath ${psQuote(file)} -ErrorAction Stop
  $sig.status = [string]$s.Status
  $subject = [string]$s.SignerCertificate.Subject
  if ($subject -match '(?:^|,\s*)O="?([^",]+)"?') { $sig.org = $Matches[1].Trim() }
  $sig.valid = ([string]$s.Status -eq 'Valid') -and ($sig.org -ceq ${psQuote(signer)})
} catch { $sig.status = 'Error' }`;
}

function signatureScript(file, signer) {
  const { PS_HEAD } = require('./deep-scan.cjs');
  return `${PS_HEAD}${signatureCore(file, signer)}
[Console]::Out.Write((ConvertTo-Json -InputObject @{ status = $sig.status; org = $sig.org } -Compress))`;
}

function parseSignature(stdout, signer) {
  const body = String(stdout || '').trim();
  let raw = null;
  try { raw = JSON.parse(body.slice(Math.max(0, body.indexOf('{')))); } catch { raw = null; }
  const status = typeof raw?.status === 'string' ? raw.status.slice(0, 40) : 'Error';
  const org = typeof raw?.org === 'string' ? raw.org.slice(0, 120) : null;
  const valid = status === 'Valid' && allowedSigner(signer) && org === signer;
  return { valid, signer: org, status };
}

/** Arquivo direto na pasta de downloads do Nexo, local, .exe ou .msi. */
function insideDir(file, dir) {
  if (typeof file !== 'string' || typeof dir !== 'string' || !file || !dir) return false;
  if (file.startsWith('\\\\') || file.includes('..') || !/^[A-Za-z]:\\/.test(file)) return false;
  if (!/\.(exe|msi)$/i.test(file)) return false;
  const full = path.win32.resolve(file);
  const base = path.win32.resolve(dir);
  return path.win32.dirname(full).toLowerCase() === base.toLowerCase();
}

module.exports = { SIGNERS, allowedSigner, signatureCore, signatureScript, parseSignature, insideDir, psQuote };
