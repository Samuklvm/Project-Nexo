const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../electron/amd-site.cjs');

test('AMD: navegação só dentro do amd.com (https)', () => {
  assert.ok(A.allowedNav('https://www.amd.com/en/support/download/drivers.html'));
  assert.ok(A.allowedNav('https://drivers.amd.com/drivers/x.exe'));
  assert.ok(!A.allowedNav('http://www.amd.com/'));
  assert.ok(!A.allowedNav('https://amd.com.evil.io/'));
  assert.ok(!A.allowedNav('https://evilamd.com/'));
  assert.ok(!A.allowedNav('javascript:alert(1)'));
  assert.ok(!A.allowedNav('file:///C:/Windows/'));
});
test('AMD: download só de drivers.amd.com, .exe com nome limpo', () => {
  assert.ok(A.allowedDownload('https://drivers.amd.com/drivers/installer/26.20/beta/amd-software-adrenalin-edition-26.11.1-minimalsetup-261111_web.exe', 'amd-software-adrenalin-edition-26.11.1-minimalsetup-261111_web.exe'));
  assert.ok(!A.allowedDownload('https://www.amd.com/x.exe', 'x.exe'));
  assert.ok(!A.allowedDownload('https://drivers.amd.com/relnotes/command-line-installation.pdf', 'command-line-installation.pdf'));
  assert.ok(!A.allowedDownload('https://drivers.amd.com/drivers/x.exe', '..\\..\\Windows\\x.exe'));
  assert.ok(!A.allowedDownload('http://drivers.amd.com/drivers/x.exe', 'x.exe'));
});
test('AMD: o script da página só clica no botão oficial de download (drivers.amd.com/drivers/….exe)', () => {
  assert.ok(A.PICK_SCRIPT.includes('drivers\\.amd\\.com\\/drivers\\/'));
  assert.match(A.PICK_SCRIPT, /\.click\(\)/);
  assert.equal(A.PAGE, 'https://www.amd.com/en/support/download/drivers.html');
  assert.ok(A.HIDDEN_MS >= 15000 && A.HIDDEN_MS <= 60000);
});
test('AMD: perfil pelo nome (o instalador de detecção automática é o AMD Software)', () => {
  assert.equal(A.profileFor('amd-software-adrenalin-edition-26.11.1-minimalsetup-261111_web.exe'), 'amd');
  assert.equal(A.profileFor('amd_chipset_software_7.10.20.742.exe'), 'detect');
});
test('AMD: só o vídeo vai escondido; chipset abre a página para escolher a placa-mãe', () => {
  assert.equal(A.hiddenFor('video-amd-radeon-rx-7800-xt'), true);
  assert.equal(A.hiddenFor('placa-chipset'), false);
});
