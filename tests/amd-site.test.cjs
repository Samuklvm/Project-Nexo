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

/* ---- correções da revisão ---- */
test('AMD vídeo (escondido): só aceita o AMD Software; o botão clicado é o do Adrenalin', () => {
  const adrenalin = 'amd-software-adrenalin-edition-26.11.1-minimalsetup-261111_web.exe';
  assert.ok(A.allowedDownload(`https://drivers.amd.com/drivers/installer/26.20/beta/${adrenalin}`, adrenalin, { video: true }));
  assert.ok(!A.allowedDownload('https://drivers.amd.com/drivers/amd_chipset_software_7.10.20.742.exe', 'amd_chipset_software_7.10.20.742.exe', { video: true }));
  assert.ok(A.allowedDownload('https://drivers.amd.com/drivers/amd_chipset_software_7.10.20.742.exe', 'amd_chipset_software_7.10.20.742.exe', { video: false }));
  assert.match(A.PICK_SCRIPT, /adrenalin\|minimalsetup/);
});
test('AMD: nome de arquivo segue a mesma regra do motor (o que a página aceita, o motor aceita)', () => {
  const DL = require('../electron/driver-download.cjs');
  for (const name of ['amd-software-adrenalin-edition-26.11.1-minimalsetup-261111_web.exe', 'amd (1).exe', `${'a'.repeat(140)}.exe`]) {
    assert.equal(A.allowedDownload(`https://drivers.amd.com/drivers/${encodeURIComponent(name)}`, name), DL.SAFE_NAME.test(name), name);
  }
});
test('AMD: sessão sem permissão nenhuma e popup só com a janela visível', () => {
  const calls = {};
  const ses = { setPermissionRequestHandler: (f) => { calls.req = f; }, setPermissionCheckHandler: (f) => { calls.check = f; }, setDevicePermissionHandler: (f) => { calls.dev = f; } };
  A.lockSession(ses);
  let answer = null;
  calls.req(null, 'media', (ok) => { answer = ok; });
  assert.equal(answer, false);
  assert.equal(calls.check(), false);
  assert.equal(calls.dev(), false);
  assert.equal(A.popupAction('https://www.amd.com/x', { visible: false }), 'stay');
  assert.equal(A.popupAction('https://ads.example.com/x', { visible: false }), 'deny');
  assert.equal(A.popupAction('https://ads.example.com/x', { visible: true }), 'external');
  assert.equal(A.popupAction('http://ads.example.com/x', { visible: true }), 'deny');
});
