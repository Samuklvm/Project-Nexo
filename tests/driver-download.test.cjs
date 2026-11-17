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

/* ---------------- Tarefa de administrador: driver-install ---------------- */
const E = require('../electron/elevate.cjs');
const fakeFs = () => ({ mkdir: async () => {}, readFile: async () => { throw new Error('sem resposta'); }, rm: async () => {} });

test('driver-install: recusa arquivo fora da pasta e assinante fora da lista', () => {
  const dir = 'C:\\N\\driver-downloads';
  assert.throws(() => E.driverInstallBody({ file: 'C:\\Windows\\x.exe', dir, signer: 'NVIDIA Corporation' }), /Arquivo não permitido/);
  assert.throws(() => E.driverInstallBody({ file: `${dir}\\x.exe`, dir, signer: 'Evil Corp' }), /Assinante não permitido/);
  assert.throws(() => E.TASKS['driver-install']({ file: `${dir}\\..\\x.exe`, dir, signer: 'NVIDIA Corporation' }), /Arquivo não permitido/);
});

test('driver-install: confere assinatura antes, ponto opcional e não instala se o ponto falhar', () => {
  const dir = 'C:\\N\\driver-downloads';
  const on = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: true, description: 'Nexo - antes de instalar o driver de vídeo' });
  assert.ok(on.indexOf('Get-AuthenticodeSignature') < on.indexOf('Start-Process'));
  assert.ok(on.indexOf('Checkpoint-Computer') < on.indexOf('Start-Process'));
  assert.match(on, /if \(-not \$r\.restore\.ok\)/);
  assert.match(on, /Start-Process -FilePath '[^']*nv\.exe' -Wait -PassThru/);
  assert.match(on, /Set-Content -LiteralPath \$NexoOut/);
  const off = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: false });
  assert.doesNotMatch(off, /Checkpoint-Computer/);
  assert.ok(E.TASKS['driver-install']);
  const long = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: true, description: `x'${'a'.repeat(200)}` });
  assert.doesNotMatch(long, /a{70}/, 'descrição cortada em 64');
});

test('elevate: driver-install usa o tempo-limite longo; as outras o de sempre', async () => {
  const used = [];
  const elevate = E.createElevator({ runPowerShell: async (_s, t) => { used.push(t); return { code: 0 }; }, fs: fakeFs(), path: require('node:path').win32, dir: 'C:\\N\\elevate' });
  await elevate('driver-install', { file: 'C:\\N\\driver-downloads\\nv.exe', dir: 'C:\\N\\driver-downloads', signer: 'NVIDIA Corporation' });
  await elevate('net-flush', {});
  assert.deepEqual(used, [45 * 60 * 1000, 240000]);
});
