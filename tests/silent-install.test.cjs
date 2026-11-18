const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../electron/silent-install.cjs');

test('perfis: tabela fechada, congelada, nome desconhecido não existe', () => {
  assert.ok(Object.isFrozen(S.PROFILES));
  assert.equal(S.profileFor('nvidia').args.includes('-s'), true);
  assert.equal(S.profileFor('rm -rf'), null);
  assert.equal(S.profileFor('__proto__'), null);
  assert.equal(S.profileFor('detect'), null, 'detect não é perfil de execução');
  assert.ok(S.isName('detect'));
  assert.ok(!S.isName('toString'));
});
test('NVIDIA instala só o driver (sem o app = sem telemetria)', () => {
  const nv = S.profileFor('nvidia').args;
  assert.deepEqual(nv.slice(0, 3), ['Display.Driver', 'HDAudio.Driver', 'PhysX']);
  for (const flag of ['-s', '-noreboot', '-noeula', '-nofinish', '-nosplash']) assert.ok(nv.includes(flag), flag);
  assert.ok(!nv.some((a) => /GFExperience|NvApp|NvTelemetry/i.test(a)));
});
test('argumentos: só texto simples (nada de aspas soltas, ; | & $ ` nem quebra de linha)', () => {
  for (const [name, p] of Object.entries(S.PROFILES)) {
    for (const a of p.args) assert.match(a, /^[A-Za-z0-9 ._\-/:="]+$/, `${name}: ${a}`);
    assert.ok(p.minutes >= 10 && p.minutes <= 90, name);
  }
});
test('resultado pelo código: sucesso, reiniciar, já tinha, não serve, erro', () => {
  assert.deepEqual(S.outcome('burn', 0), { ok: true, restart: false });
  assert.deepEqual(S.outcome('burn', 3010), { ok: true, restart: true });
  assert.deepEqual(S.outcome('burn', 1638), { ok: false, nothing: true });
  assert.deepEqual(S.outcome('dell', 2), { ok: true, restart: true });
  assert.deepEqual(S.outcome('dell', 3), { ok: false, nothing: true });
  assert.deepEqual(S.outcome('dell', 5), { ok: false, notApplicable: true });
  assert.deepEqual(S.outcome('msi', 1641), { ok: true, restart: true });
  assert.deepEqual(S.outcome('nvidia', 1), { ok: false });
  assert.deepEqual(S.outcome('nada', 0), { ok: false });
});
test('detecção: script lê no máximo 8 MB e só devolve tipos da tabela', () => {
  const s = S.detectCore('$dst');
  assert.match(s, /8MB|8 \* 1024 \* 1024|8388608/);
  for (const marker of ['Inno Setup', 'Nullsoft', 'WixBundle', 'InstallShield']) assert.ok(s.includes(marker), marker);
  assert.match(s, /\$profile = /);
  assert.deepEqual([...S.DETECTABLE].sort(), ['burn', 'inno', 'installshield', 'nsis']);
});
test('perfil pelo nome do arquivo baixado no site da AMD', () => {
  assert.equal(S.amdProfileFor('amd-software-adrenalin-edition-25.11.1-win10-win11-nov-rdna.exe'), 'amd');
  assert.equal(S.amdProfileFor('whql-amd-software-adrenalin-edition-25.9.1-win10-win11-sep5-rdna.exe'), 'amd');
  assert.equal(S.amdProfileFor('amd_chipset_software_7.10.20.742.exe'), 'detect');
  assert.equal(S.amdProfileFor('qualquer.zip'), null);
});
test('3010 é "reiniciar" em qualquer perfil (nunca vira "fechou sem terminar")', () => {
  for (const name of Object.keys(S.PROFILES)) {
    const o = S.outcome(name, 3010);
    if (name === 'dell') continue; // a Dell usa 2 para reiniciar; 3010 não é dela
    assert.deepEqual(o, { ok: true, restart: true }, name);
  }
});
