const test = require('node:test');
const assert = require('node:assert/strict');
const Scan = require('../electron/system-scan.cjs');
const Elevate = require('../electron/elevate.cjs');

test('catálogo do Raio-X: chaves e nomes seguros, opções do tamanho das entradas, uma padrão por ajuste', () => {
  const ids = new Set();
  for (const tweak of Scan.TWEAKS) {
    assert.ok(!ids.has(tweak.id)); ids.add(tweak.id);
    assert.ok(tweak.id.length <= 40, `${tweak.id}: id longo demais (a ponte corta em 48)`);
    assert.ok(['baixo', 'moderado', 'alto'].includes(tweak.risk), tweak.id);
    assert.ok(tweak.label && tweak.what && tweak.what.length > 20, tweak.id);
    assert.ok(Scan.GROUPS[tweak.group], tweak.id);
    assert.ok(Scan.EVIDENCE[tweak.evidence], tweak.id);
    assert.ok(['nao', 'sessao', 'reiniciar'].includes(tweak.reboot), tweak.id);
    for (const entry of tweak.entries) {
      assert.ok(['HKCU', 'HKLM', 'POWER'].includes(entry.hive));
      assert.match(entry.key, /^[A-Za-z0-9 _\\.\-()]+$/);
      assert.match(entry.name, /^[A-Za-z0-9 _\-.]+$/);
      if (entry.hive === 'POWER') { assert.equal(entry.kind, 'power'); assert.match(entry.sub, /^[0-9a-f-]{36}$/); assert.match(entry.setting, /^[0-9a-f-]{36}$/); }
      // HKCU\Software\Policies costuma ser só leitura para o usuário: políticas vão para HKLM (com UAC).
      if (entry.hive === 'HKCU') assert.doesNotMatch(entry.key, /Policies/i, `${tweak.id}: política em HKCU`);
    }
    // Duas opções iguais confundiriam a reversão e o "atual".
    const keys = tweak.options.map((option) => JSON.stringify(option.values));
    assert.equal(new Set(keys).size, keys.length, `${tweak.id}: opções repetidas`);
    for (const option of tweak.options) for (const [index, value] of option.values.entries()) {
      const entry = tweak.entries[index];
      if (entry.kind === 'power') assert.ok(Number.isInteger(value), tweak.id);
      else if (value !== null) assert.ok(entry.type === 'dword' ? Number.isInteger(value) && value >= 0 && value <= Scan.DWORD_MAX : typeof value === 'string' && /^[A-Za-z0-9 _.\-=;]{0,200}$/.test(value), `${tweak.id}: ${value}`);
    }
    assert.ok(tweak.options.length >= 2);
    assert.equal(tweak.options.filter((option) => option.kind === 'padrao').length, 1, tweak.id);
    for (const option of tweak.options) assert.equal(option.values.length, tweak.entries.length, tweak.id);
  }
  assert.ok(Scan.TWEAKS.length >= 100, `só ${Scan.TWEAKS.length} ajustes`);
  // Duas entradas do catálogo nunca escrevem no mesmo valor (o Diário reverteria uma por cima da outra).
  const targets = Scan.TWEAKS.flatMap((tweak) => tweak.entries.map((entry) => `${entry.hive}\\${entry.key}\\${entry.name}`.toLowerCase()));
  assert.equal(new Set(targets).size, targets.length, 'entrada repetida no catálogo');
});

test('tamanho: Raio-X + laboratório passam de 600 opções', () => {
  const Lab = require('../src/lab.js');
  const scan = Scan.catalogStats();
  const lab = Lab.spaceStats({ allowRisk: 'alto' });
  assert.ok(scan.settings >= 100 && scan.options >= 280, JSON.stringify(scan));
  assert.ok(scan.options + lab.options >= 600, `${scan.options} + ${lab.options}`);
});

test('serviços: só os que dá para desligar sem perder o Windows; aparecem só se existirem', () => {
  const services = Scan.TWEAKS.filter((tweak) => tweak.requiresExisting);
  assert.ok(services.length >= 25);
  const names = services.map((tweak) => tweak.entries[0].key.split('\\').pop().toLowerCase());
  for (const forbidden of ['wuauserv', 'windefend', 'wscsvc', 'mpssvc', 'audiosrv', 'dnscache', 'dhcp', 'msiserver', 'bfe', 'cryptsvc', 'eventlog', 'rpcss', 'remoteregistry', 'termservice', 'usosvc', 'waasmedicsvc', 'sense', 'securityhealthservice']) {
    assert.ok(!names.includes(forbidden), forbidden);
  }
  for (const tweak of services) {
    assert.deepEqual(tweak.options.map((option) => option.values[0]).sort(), [2, 3, 4], tweak.id);
    assert.equal(tweak.reboot, 'reiniciar');
  }
  const scan = Scan.interpret({ 'svc-diagtrack#0': 2 });
  assert.equal(scan.items.find((item) => item.id === 'svc-diagtrack').available, true);
  assert.equal(scan.items.find((item) => item.id === 'svc-fax').available, false);
  assert.equal(scan.items.find((item) => item.id === 'svc-fax').current, 'Não existe neste PC');
  assert.equal(scan.items.find((item) => item.id === 'gamedvr').available, true, 'registro comum sempre aparece');
  assert.ok(scan.stats.options < scan.stats.catalog.options);
});

test('plano de energia: lê do /qh, só índices que o PC aceita, grava pelo powercfg sem UAC', async () => {
  const DUMP = [
    'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)',
    '  Subgroup GUID: 2a737441-1930-4402-8d77-b2bebba308a3  (USB settings)',
    '    Power Setting GUID: 48e6b7a6-50f5-4782-a5d4-53bb8f07e226  (USB selective suspend setting)',
    '      Possible Setting Index: 000', '      Possible Setting Friendly Name: Disabled',
    '      Possible Setting Index: 001', '      Possible Setting Friendly Name: Enabled',
    '    Current AC Power Setting Index: 0x00000001', '    Current DC Power Setting Index: 0x00000001',
    '  Subgroup GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Sleep)',
    '    Power Setting GUID: bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d  (Allow wake timers)',
    '      Possible Setting Index: 000', '      Possible Setting Friendly Name: Disable',
    '      Possible Setting Index: 001', '      Possible Setting Friendly Name: Enable',
    '    Current AC Power Setting Index: 0x00000001', '    Current DC Power Setting Index: 0x00000001',
    '  Subgroup GUID: 0012ee47-9041-4b5d-9b77-535fba8b1442  (Hard disk)',
    '    Power Setting GUID: 6738e2c4-e8a5-4a42-b16a-e040e769756e  (Turn off hard disk after)',
    '      Minimum Possible Setting: 0x00000000', '      Maximum Possible Setting: 0xffffffff', '      Possible Settings increment: 0x00000001', '      Possible Settings units: Seconds',
    '    Current AC Power Setting Index: 0x000004b0', '    Current DC Power Setting Index: 0x00000258'
  ].join('\r\n');
  const calls = [];
  const scan = Scan.createSystemScan({
    platform: 'win32',
    runPowerShell: async () => ({ code: 0, stdout: '{}' }),
    run: async (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: file === 'powercfg' && args[0] === '/qh' ? DUMP : '' }; },
    elevate: async () => { throw new Error('não deveria pedir UAC'); }
  });
  const result = await scan.scan();
  const get = (id) => result.items.find((item) => item.id === id);
  assert.equal(get('usbsuspend').available, true);
  assert.equal(get('usbsuspend').current, 'Ativada (padrão)');
  // O PC só aceita 0 e 1: "Só os importantes" (2) some da lista.
  assert.deepEqual(get('waketimers').options.map((option) => option.values[0]), [0, 1]);
  assert.equal(get('diskidle').current, 'Depois de 20 min (padrão)');
  assert.equal(get('usb3lpm').available, false, 'configuração que não existe no plano');
  assert.equal(get('usbsuspend').admin, false);
  calls.length = 0;
  await scan.apply([{ id: 'usbsuspend', values: [0] }, { id: 'diskidle', values: [0] }]);
  assert.deepEqual(calls[0], ['powercfg', '/setacvalueindex', 'scheme_current', '2a737441-1930-4402-8d77-b2bebba308a3', '48e6b7a6-50f5-4782-a5d4-53bb8f07e226', '0']);
  assert.deepEqual(calls[2], ['powercfg', '/setactive', 'scheme_current']);
  assert.throws(() => Scan.validateChange({ id: 'usbsuspend', values: [null], revert: true }));
  assert.throws(() => Scan.validateChange({ id: 'usbsuspend', values: [7] }), /catálogo/);
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
  assert.equal(calls.filter((call) => call[0] === 'reg').length, 3);
  assert.ok(calls.some((call) => call[0] === 'powercfg' && call[1] === '/qh'), 'a varredura depois de aplicar lê o plano');
  assert.equal(elevated.task, 'registry-tweaks');
  const { prelude, steps } = Scan.elevatedBody(elevated.args.changes);
  const body = [...prelude, ...steps].join('\n');
  assert.match(body, /\$B = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\'/);
  assert.match(body, /\(\$B \+ 'PriorityControl'\)/);
  assert.match(body, /try \{ S \$P\[0\] 'Win32PrioritySeparation' DWord \(U 38\); \$r\.steps\+\+ \} catch \{ \$r\.failed \+= 'priosep' \}/);
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

test('aplicar: um ajuste recusado não derruba os outros; recusar o UAC só falha o que é do sistema', async () => {
  const make = (elevate, run = async () => ({ code: 0, stdout: '' })) => Scan.createSystemScan({ platform: 'win32', runPowerShell: async () => ({ code: 0, stdout: '{}' }), run, elevate });
  const partial = await make(async () => ({ declined: false, result: { ok: true, failed: ['hags'] } })).apply([{ id: 'priosep', values: [38] }, { id: 'hags', values: [2] }]);
  assert.deepEqual(partial.failed, ['hags']);
  assert.equal(partial.ok, false);
  const mixed = await make(async () => ({ declined: true })).apply([{ id: 'menudelay', values: ['100'] }, { id: 'priosep', values: [38] }]);
  assert.deepEqual(mixed.failed, ['priosep']);
  assert.equal(mixed.declined, true);
  await assert.rejects(make(async () => ({ declined: true })).apply([{ id: 'priosep', values: [38] }]), /recusou/);
  const regFail = await make(async () => ({ result: { ok: true, failed: [] } }), async (file, args) => ({ code: args[0] === 'add' && args[3] === 'MenuShowDelay' ? 5 : 0, stdout: '' })).apply([{ id: 'menudelay', values: ['100'] }, { id: 'gamedvr', values: [0, 0] }]);
  assert.deepEqual(regFail.failed, ['menudelay']);
});

test('elevação: o catálogo inteiro de HKLM cabe numa linha de comando (blocos se precisar)', () => {
  const changes = Scan.TWEAKS.filter((tweak) => tweak.entries.some((entry) => entry.hive === 'HKLM'))
    .map((tweak) => ({ id: tweak.id, values: tweak.options.find((option) => option.kind !== 'padrao').values }));
  const chunks = Scan.elevationChunks(changes);
  assert.equal(chunks.flat().length, changes.length);
  for (const chunk of chunks) {
    const body = `$ErrorActionPreference = 'Stop'\n$NexoOut = 'C:\\Users\\Fulano de Tal da Silva\\AppData\\Roaming\\Nexo Device Care\\elevation\\registry-tweaks-1730000000000.json'\n${Elevate.TASKS['registry-tweaks']({ changes: chunk })}`;
    assert.ok(Elevate.encode(body).length + 600 < 32767, `bloco grande demais: ${Elevate.encode(body).length}`);
  }
  // Um bloco pequeno de mentira força a divisão.
  assert.ok(Scan.elevationChunks(changes, 2000).length > 1);
});

test('interface do Raio-X lê o catálogo do mesmo jeito que o app (grupos e contagem)', () => {
  const result = Scan.interpret({});
  assert.deepEqual(result.groups, Scan.GROUPS);
  assert.equal(result.stats.catalog.settings, Scan.TWEAKS.length);
  const view = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'view-scan.js'), 'utf8');
  for (const group of Object.keys(Scan.GROUPS)) assert.match(view, new RegExp(`${group}: '`), group);
});
