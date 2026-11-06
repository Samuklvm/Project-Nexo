const test = require('node:test');
const assert = require('node:assert/strict');
const Scan = require('../electron/system-scan.cjs');
const Elevate = require('../electron/elevate.cjs');

test('catálogo do Raio-X: chaves e nomes seguros, opções do tamanho das entradas, uma padrão por ajuste', () => {
  const ids = new Set();
  for (const tweak of Scan.TWEAKS) {
    assert.ok(!ids.has(tweak.id)); ids.add(tweak.id);
    assert.ok(Scan.GROUPS[tweak.group], tweak.id);
    assert.ok(Scan.EVIDENCE[tweak.evidence], tweak.id);
    assert.ok(['nao', 'sessao', 'reiniciar'].includes(tweak.reboot), tweak.id);
    for (const entry of tweak.entries) {
      assert.ok(['HKCU', 'HKLM'].includes(entry.hive));
      assert.match(entry.key, /^[A-Za-z0-9 _\\.\-()]+$/);
      assert.match(entry.name, /^[A-Za-z0-9 _\-.]+$/);
    }
    assert.ok(tweak.options.length >= 2);
    assert.equal(tweak.options.filter((option) => option.kind === 'padrao').length, 1, tweak.id);
    for (const option of tweak.options) assert.equal(option.values.length, tweak.entries.length, tweak.id);
  }
  assert.ok(Scan.TWEAKS.length >= 20);
});

test('o que reduz a segurança fica só na lista de recusados', () => {
  const all = JSON.stringify(Scan.TWEAKS);
  assert.doesNotMatch(all, /Defender|DisableAntiSpyware|EnableLUA|FeatureSettingsOverride|DeviceGuard|HypervisorEnforced|WindowsUpdate|wuauserv/i);
  for (const id of ['antivirus', 'vbs', 'mitigations', 'uac', 'updates']) assert.ok(Scan.REFUSED.some((item) => item.id === id), id);
});

test('validateChange: só opções do catálogo; reversão aceita o valor anterior válido', () => {
  assert.equal(Scan.validateChange({ id: 'priosep', values: [38] }).id, 'priosep');
  assert.throws(() => Scan.validateChange({ id: 'priosep', values: [99] }), /catálogo/);
  assert.throws(() => Scan.validateChange({ id: 'nada', values: [1] }));
  assert.throws(() => Scan.validateChange({ id: 'priosep', values: [38, 1] }));
  assert.equal(Scan.validateChange({ id: 'priosep', values: [99], revert: true }).id, 'priosep');
  assert.equal(Scan.validateChange({ id: 'hags', values: [null], revert: true }).id, 'hags');
  assert.throws(() => Scan.validateChange({ id: 'menudelay', values: ["1'; Remove-Item C:\\"], revert: true }));
  assert.throws(() => Scan.validateChange({ id: 'priosep', values: [-1], revert: true }));
});

test('leitura: valor ausente vira o padrão do Windows; DWORD alto e estado de segurança', () => {
  const result = Scan.interpret({ 'gamedvr#0': null, 'gamedvr#1': null, 'lastaccess#0': 2147483649, 'priosep#0': 38, __vbs: 2 });
  const get = (id) => result.items.find((item) => item.id === id);
  assert.equal(get('gamedvr').currentKind, 'padrao');
  assert.equal(get('lastaccess').currentKind, 'recomendado');
  assert.equal(get('priosep').current, 'Curto e variável, foco ×3 (0x26)');
  assert.equal(get('hags').currentKind, 'padrao');
  assert.equal(result.vbs, 'ativa');
  assert.equal(get('hags').admin, true);
  assert.equal(get('gamedvr').admin, false);
});

test('aplicar: HKCU pelo reg.exe, HKLM numa única elevação com script fixo', async () => {
  const calls = [];
  let elevated = null;
  const scan = Scan.createSystemScan({
    platform: 'win32',
    runPowerShell: async () => ({ code: 0, stdout: '{}' }),
    run: async (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: '' }; },
    elevate: async (task, args) => { elevated = { task, args }; return { declined: false, result: { ok: true } }; }
  });
  await scan.apply([{ id: 'menudelay', values: ['100'] }, { id: 'priosep', values: [38] }, { id: 'gamedvr', values: [0, 0] }]);
  assert.deepEqual(calls[0], ['reg', 'add', 'HKCU\\Control Panel\\Desktop', '/v', 'MenuShowDelay', '/t', 'REG_SZ', '/d', '100', '/f']);
  assert.equal(calls.length, 3);
  assert.equal(elevated.task, 'registry-tweaks');
  const body = Scan.elevatedBody(elevated.args.changes).join('\n');
  assert.match(body, /PriorityControl' -Name 'Win32PrioritySeparation' -PropertyType DWord -Value \(\[BitConverter\]/);
  assert.doesNotMatch(body, /HKCU/);
  const declined = Scan.createSystemScan({ platform: 'win32', runPowerShell: async () => ({ code: 0, stdout: '{}' }), run: async () => ({ code: 0 }), elevate: async () => ({ declined: true }) });
  await assert.rejects(declined.apply([{ id: 'priosep', values: [38] }]), /recusou/);
});

test('elevação do Raio-X: tarefa registrada, script codificado e corpo só com chaves do catálogo', async () => {
  let launched = '';
  const fs = { mkdir: async () => {}, writeFile: async () => {}, readFile: async () => { throw new Error('x'); }, rm: async () => {} };
  const elevate = Elevate.createElevator({ runPowerShell: async (script) => { launched = script; return { code: 1223, stdout: '' }; }, fs, path: require('path'), dir: '/x', now: () => 1 });
  await assert.rejects(elevate('registry-tweaks', { changes: [{ id: 'priosep', values: [77] }] }));
  const result = await elevate('registry-tweaks', { changes: [{ id: 'sysresp', values: [10] }] });
  assert.equal(result.declined, true);
  const decoded = Buffer.from(launched.match(/-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1], 'base64').toString('utf16le');
  assert.match(decoded, /SystemResponsiveness/);
});
