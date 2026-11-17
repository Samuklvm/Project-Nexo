/*
 * Drivers com um clique: conferência de assinatura, tarefa de administrador que instala e o motor de download
 * (fila, retomada, só domínio oficial, hash e assinatura antes de liberar o arquivo).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Sig = require('../electron/driver-signature.cjs');

const DIR = 'C:\\Users\\a\\AppData\\Roaming\\Nexo\\driver-downloads';

test('assinatura: script cita o caminho com psQuote e confere organização exata', () => {
  const s = Sig.signatureScript("C:\\Users\\a'b\\driver-downloads\\x.exe", 'NVIDIA Corporation');
  assert.match(s, /Get-AuthenticodeSignature -LiteralPath 'C:\\Users\\a''b\\driver-downloads\\x\.exe'/);
  assert.match(s, /Status -eq 'Valid'/);
  assert.match(s, /'NVIDIA Corporation'/);
  assert.doesNotMatch(s, /Invoke-Expression|\biex\b/);
});

test('assinatura: parse só aceita Valid e o assinante esperado', () => {
  assert.deepEqual(Sig.parseSignature('{"status":"Valid","org":"NVIDIA Corporation"}', 'NVIDIA Corporation'), { valid: true, signer: 'NVIDIA Corporation', status: 'Valid' });
  assert.equal(Sig.parseSignature('{"status":"Valid","org":"NVIDIA Corp Fake"}', 'NVIDIA Corporation').valid, false);
  assert.equal(Sig.parseSignature('{"status":"HashMismatch","org":"NVIDIA Corporation"}', 'NVIDIA Corporation').valid, false);
  assert.equal(Sig.parseSignature('lixo', 'NVIDIA Corporation').valid, false);
  assert.equal(Sig.parseSignature('{"status":"Valid","org":"NVIDIA Corporation"}', 'Microsoft Corporation').valid, false);
});

test('assinatura: insideDir recusa fora da pasta, .. e extensão errada', () => {
  assert.equal(Sig.insideDir(`${DIR}\\nvidia-572.16.exe`, DIR), true);
  assert.equal(Sig.insideDir(`${DIR.toUpperCase()}\\x.msi`, DIR), true);
  assert.equal(Sig.insideDir(`${DIR}\\..\\evil.exe`, DIR), false);
  assert.equal(Sig.insideDir('C:\\Windows\\System32\\cmd.exe', DIR), false);
  assert.equal(Sig.insideDir(`${DIR}\\x.ps1`, DIR), false);
  assert.equal(Sig.insideDir('\\\\servidor\\share\\x.exe', DIR), false);
  assert.equal(Sig.insideDir(`${DIR}-irmao\\x.exe`, DIR), false);
  assert.equal(Sig.insideDir(`${DIR}\\sub\\x.exe`, DIR), false, 'só arquivo direto na pasta');
});

test('assinatura: lista de assinantes permitidos', () => {
  assert.equal(Sig.SIGNERS.nvidia, 'NVIDIA Corporation');
  assert.equal(Sig.SIGNERS.microsoft, 'Microsoft Corporation');
  assert.equal(Sig.allowedSigner('NVIDIA Corporation'), true);
  assert.equal(Sig.allowedSigner('Evil Corp'), false);
});
