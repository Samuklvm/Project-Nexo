/*
 * Drivers com um clique: a conferência da assinatura digital de cada instalador baixado.
 *  - Só libera arquivo com assinatura Authenticode válida E da empresa esperada (campo O= do certificado, igualdade
 *    exata). "NVIDIA Corp Fake" não passa por "NVIDIA Corporation".
 *  - O mesmo trecho roda sem administrador (logo depois do download) e dentro da tarefa elevada, logo antes de abrir o
 *    instalador (elevate.cjs), para o arquivo conferido ser o mesmo que roda.
 *  - Pode valer mais de um nome (o pacote do fabricante do PC às vezes é assinado pelo fabricante da peça), mas só nomes
 *    que o app conhece: NVIDIA, Microsoft, os fabricantes de PC e os de peça de src/oem.js.
 *  - Só arquivo direto na pasta de downloads do Nexo, local (nunca \\servidor): .exe, .msi, .zip ou .cab.
 */
'use strict';
const path = require('node:path');

const Oem = require('../src/oem.js');

const SIGNERS = Object.freeze({ nvidia: 'NVIDIA Corporation', microsoft: 'Microsoft Corporation' });
// Programas oficiais dos periféricos gamer (Logitech G HUB, SteelSeries GG): cada nome só vale para o próprio programa.
const PERIPHERAL_SIGNERS = Object.freeze(['Logitech Inc', 'Logitech Inc.', 'Logitech', 'SteelSeries ApS']);
const ALLOWED = new Set([...Object.values(SIGNERS), ...Object.values(Oem.SIGNERS).flat(), ...Oem.PART_SIGNERS, ...PERIPHERAL_SIGNERS]);
const listOf = (signers) => (Array.isArray(signers) ? signers : [signers]).filter((name) => typeof name === 'string' && name);
/** Um nome, ou uma lista não vazia em que todos os nomes são conhecidos do app. */
const allowedSigner = (signers) => {
  const list = listOf(signers);
  return list.length > 0 && list.length === (Array.isArray(signers) ? signers.length : 1) && list.every((name) => ALLOWED.has(name));
};
const BT = '`'; // crase do PowerShell (escape de linha) dentro de template string
const psQuote = (value) => `'${String(value).replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q)}'`;

/** Trecho PowerShell que deixa em $sig o resultado da conferência do arquivo (sem gravar nada). */
function signatureCore(file, signers) { return signatureCoreFor(psQuote(file), signers); }
/** O mesmo, para um caminho que só existe dentro do PowerShell (ex.: $dst, a cópia na pasta protegida). */
function signatureCoreFor(pathExpr, signers) {
  const names = listOf(signers).map(psQuote).join(', ');
  return String.raw`
$sig = @{ valid = $false; status = 'Missing'; org = $null }
try {
  $s = Get-AuthenticodeSignature -LiteralPath ${pathExpr} -ErrorAction Stop
  $sig.status = [string]$s.Status
  # Nome formatado do certificado, um campo por linha (um CN com ", O=..." dentro não engana).
  foreach ($line in ([string]$s.SignerCertificate.SubjectName.Format($true) -split "${BT}r?${BT}n")) {
    if ($line -match '^\s*O=(.+)$') { $sig.org = $Matches[1].Trim().Trim('"'); break }
  }
  $sig.valid = ([string]$s.Status -eq 'Valid') -and (@(${names}) -ccontains $sig.org)
} catch { $sig.status = 'Error' }`;
}

function signatureScript(file, signers) {
  const { PS_HEAD } = require('./deep-scan.cjs');
  return `${PS_HEAD}${signatureCore(file, signers)}
[Console]::Out.Write((ConvertTo-Json -InputObject @{ status = $sig.status; org = $sig.org } -Compress))`;
}

function parseSignature(stdout, signers) {
  const body = String(stdout || '').trim();
  let raw = null;
  try { raw = JSON.parse(body.slice(Math.max(0, body.indexOf('{')))); } catch { raw = null; }
  const status = typeof raw?.status === 'string' ? raw.status.slice(0, 40) : 'Error';
  const org = typeof raw?.org === 'string' ? raw.org.slice(0, 120) : null;
  const valid = status === 'Valid' && allowedSigner(signers) && listOf(signers).includes(org);
  return { valid, signer: org, status };
}

/** Arquivo direto na pasta de downloads do Nexo, local: .exe, .msi, .zip ou .cab. */
function insideDir(file, dir) {
  if (typeof file !== 'string' || typeof dir !== 'string' || !file || !dir) return false;
  if (file.startsWith('\\\\') || file.includes('..') || !/^[A-Za-z]:\\/.test(file)) return false;
  if (!/\.(exe|msi|zip|cab)$/i.test(file)) return false;
  const full = path.win32.resolve(file);
  const base = path.win32.resolve(dir);
  return path.win32.dirname(full).toLowerCase() === base.toLowerCase();
}

module.exports = { SIGNERS, ALLOWED, listOf, allowedSigner, signatureCore, signatureCoreFor, signatureScript, parseSignature, insideDir, psQuote };
