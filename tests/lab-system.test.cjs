const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fsReal = require('fs');
const Sys = require('../electron/lab-system.cjs');
const Elevate = require('../electron/elevate.cjs');
const Lab = require('../src/lab.js');

const ORIGINAL = '381b4222-f694-41f0-9685-ff5bb260df2e';
const CLONE = 'aaaaaaaa-1111-2222-3333-444444444444';
const ADJUSTED = 'bbbbbbbb-1111-2222-3333-444444444444';

const qh = (ac, dc) => `Índice de Configuração de Energia CA Atual: 0x${ac.toString(16).padStart(8, '0')}\r\nÍndice de Configuração de Energia CC Atual: 0x${dc.toString(16).padStart(8, '0')}`;

function memoryFs() {
  const files = new Map();
  return {
    files,
    mkdir: async () => {},
    writeFile: async (file, data) => { files.set(file, String(data)); },
    readFile: async (file) => { if (!files.has(file)) { const error = new Error('ENOENT'); error.code = 'ENOENT'; throw error; } return files.get(file); },
    rm: async (file) => { files.delete(file); }
  };
}

function fakeWindows() {
  const state = { active: ORIGINAL, plans: new Map([[ORIGINAL, 'Equilibrado']]), values: new Map(), calls: [], dup: [CLONE, ADJUSTED] };
  const run = async (file, args) => {
    state.calls.push([file, ...args]);
    if (file === 'reg') return { code: 0, stdout: '' };
    assert.equal(file, 'powercfg');
    const [verb, ...rest] = args;
    switch (verb) {
      case '/getactivescheme': return { code: 0, stdout: `GUID do Esquema de Energia: ${state.active}  (${state.plans.get(state.active)})` };
      case '/list': return { code: 0, stdout: [...state.plans].map(([guid, name]) => `GUID do Esquema de Energia: ${guid}  (${name})${guid === state.active ? ' *' : ''}`).join('\r\n') };
      case '/duplicatescheme': { const guid = state.dup.shift(); state.plans.set(guid, state.plans.get(rest[0])); for (const [key, value] of state.values) if (key.startsWith(rest[0])) state.values.set(key.replace(rest[0], guid), value); return { code: 0, stdout: `GUID do Esquema de Energia: ${guid}  (${state.plans.get(guid)})` }; }
      case '/changename': state.plans.set(rest[0], rest[1]); return { code: 0, stdout: '' };
      case '/setactive': if (!state.plans.has(rest[0])) return { code: 1, stdout: '' }; state.active = rest[0]; return { code: 0, stdout: '' };
      case '/delete': if (rest[0] === state.active) return { code: 1, stdout: '' }; state.plans.delete(rest[0]); return { code: 0, stdout: '' };
      case '/export': return { code: 0, stdout: '' };
      case '/qh': { const key = `${rest[0]}|${rest[2]}`; if (rest[2] === 'PERFBOOSTPOL') return { code: 1, stdout: '' }; const value = state.values.has(key) ? state.values.get(key) : 33; return { code: 0, stdout: qh(value, value) }; }
      case '/setacvalueindex': state.values.set(`${rest[0]}|${rest[2]}`, Number(rest[3])); return { code: 0, stdout: '' };
      default: return { code: 2, stdout: '' };
    }
  };
  return { state, run };
}

function makeSystem(overrides = {}) {
  const win = fakeWindows();
  const fs = memoryFs();
  const system = Sys.createLabSystem({
    run: win.run, runPowerShell: async () => ({ code: 0, stdout: '0' }), bench: async (mode) => ({ mode, mopsPerSec: 100 }),
    readTemp: async () => 52, cpuLoad: async () => 6, onBattery: async () => false,
    elevate: async () => ({ declined: false, code: 0, result: { ok: true, created: true, sequence: 9 } }),
    fs, path, dir: '/dados/lab', exePath: 'C:\\Nexo\\Nexo Device Care.exe', isPackaged: true, platform: 'win32', now: () => 1000, sleep: async () => {},
    ...overrides
  });
  return { system, win, fs };
}

test('leitura do powercfg independe do idioma', () => {
  assert.equal(Sys.parseActive(`Power Scheme GUID: ${ORIGINAL}  (Balanced)`), ORIGINAL);
  assert.deepEqual(Sys.parseIndexes('Minimum Possible Setting: 0x00000000\nMaximum Possible Setting: 0x00000064\nCurrent AC Power Setting Index: 0x00000032\nCurrent DC Power Setting Index: 0x00000019'), { ac: 50, dc: 25 });
  assert.equal(Sys.parseIndexes('nada'), null);
  const list = Sys.parseList(`GUID do Esquema de Energia: ${ORIGINAL}  (Equilibrado) *\r\nGUID do Esquema de Energia: ${CLONE}  (Alto desempenho)`);
  assert.deepEqual(list.map((plan) => [plan.name, plan.active]), [['Equilibrado', true], ['Alto desempenho', false]]);
  assert.equal(Sys.parseAliases(`  ${ORIGINAL}  SCHEME_BALANCED`).SCHEME_BALANCED, ORIGINAL);
});

test('preflight lê os ajustes do plano ativo e marca indisponíveis', async () => {
  const { system } = makeSystem();
  const pre = await system.preflight();
  assert.equal(pre.platform, 'win32');
  assert.equal(pre.tempC, 52);
  assert.equal(pre.knobs.perfepp.available, true);
  assert.equal(pre.knobs.perfepp.current, 33);
  assert.equal(pre.knobs.boostpol.available, false);
});

test('begin clona o plano, nunca edita o original e grava trava + RunOnce', async () => {
  const { system, win, fs } = makeSystem();
  await system.begin();
  assert.equal(win.state.active, CLONE);
  assert.equal(win.state.plans.get(CLONE), Sys.LAB_PLAN_NAME);
  assert.ok(fs.files.has(path.join('/dados/lab', 'lab-lock.json')));
  assert.ok(win.state.calls.some((call) => call[0] === 'reg' && call.includes(Sys.RUNONCE_VALUE) && call.some((arg) => /--lab-recover/.test(arg))));
  await system.apply([{ id: 'perfepp', sub: 'SUB_PROCESSOR', setting: 'PERFEPP', value: 0 }]);
  assert.equal(win.state.values.get(`${CLONE}|PERFEPP`), 0);
  assert.equal(win.state.values.has(`${ORIGINAL}|PERFEPP`), false, 'o plano original não é tocado');
});

test('apply recusa ajuste fora do espaço mesmo vindo direto', async () => {
  const { system } = makeSystem();
  await system.begin();
  await assert.rejects(system.apply([{ id: 'perfepp', sub: 'SUB_PROCESSOR', setting: 'HVCI', value: 0 }]));
  await assert.rejects(system.apply([{ id: 'x', sub: 'SUB_PROCESSOR', setting: 'PERFEPP', value: 0 }]));
});

test('restore volta ao original, apaga o clone e finish limpa trava e RunOnce', async () => {
  const { system, win, fs } = makeSystem();
  await system.begin();
  const restored = await system.restore();
  assert.equal(restored.ok, true);
  assert.equal(win.state.active, ORIGINAL);
  assert.equal(win.state.plans.has(CLONE), false);
  await system.finish();
  assert.equal(fs.files.size, 0);
  assert.ok(win.state.calls.some((call) => call[0] === 'reg' && call[1] === 'delete'));
});

test('recover: trava esquecida volta ao plano original na próxima abertura', async () => {
  const first = makeSystem();
  await first.system.begin();
  // "trava" no meio: um novo adaptador (como numa nova abertura do app) com o mesmo disco e o mesmo Windows
  const again = Sys.createLabSystem({ run: first.win.run, runPowerShell: async () => ({ code: 0, stdout: '0' }), bench: async () => ({ mopsPerSec: 1 }), readTemp: async () => 50, cpuLoad: async () => 1, onBattery: async () => false, elevate: async () => ({}), fs: first.fs, path, dir: '/dados/lab', exePath: 'x', isPackaged: true });
  assert.equal(await again.hasPendingLock(), true);
  const result = await again.recover();
  assert.equal(result.recovered, true);
  assert.equal(first.win.state.active, ORIGINAL);
  assert.equal(await again.hasPendingLock(), false);
});

test('recover cai no Equilibrado se o plano original sumiu', async () => {
  const { system, win } = makeSystem();
  win.state.plans.set('cccccccc-1111-2222-3333-444444444444', 'Meu plano');
  win.state.active = 'cccccccc-1111-2222-3333-444444444444';
  await system.begin();
  win.state.plans.delete('cccccccc-1111-2222-3333-444444444444');
  const restored = await system.restore();
  assert.equal(restored.target, Sys.BALANCED);
  assert.equal(win.state.active, Sys.BALANCED);
});

test('adopt cria um plano novo a partir do original com os ajustes confirmados', async () => {
  const { system, win } = makeSystem();
  await system.begin();
  await system.restore();
  const adopted = await system.adopt({ perfepp: 0, minstate: 100 });
  assert.equal(adopted.guid, ADJUSTED);
  assert.equal(adopted.before.guid, ORIGINAL);
  assert.equal(win.state.active, ADJUSTED);
  assert.match(win.state.plans.get(ADJUSTED), /^Nexo — Ajustado/);
  assert.equal(win.state.values.get(`${ADJUSTED}|PROCTHROTTLEMIN`), 100);
  await assert.rejects(system.adopt({ perfepp: 77 }));
});

test('ponto de restauração: recusa do UAC e resposta ausente viram motivo claro', async () => {
  assert.equal(Sys.interpretRestorePoint({ declined: true }).ok, false);
  assert.match(Sys.interpretRestorePoint({ declined: true }).note, /recusada/);
  assert.equal(Sys.interpretRestorePoint({ declined: false, code: 5, result: null }).ok, false);
  assert.equal(Sys.interpretRestorePoint({ result: { ok: true, created: true, sequence: 3 } }).created, true);
  const { system } = makeSystem({ elevate: async () => ({ declined: true, code: 1223, result: null }) });
  assert.equal((await system.createRestorePoint()).ok, false);
});

test('motor + adaptador de ponta a ponta no Windows simulado', async () => {
  const { system, win, fs } = makeSystem();
  const result = await Lab.run(system, { consent: { acknowledged: true, phrase: 'ENTENDO O RISCO' }, maxArms: 2, allowRisk: 'baixo', limits: { pairs: 2, confirmPairs: 2 } });
  assert.equal(result.status, 'completed');
  assert.equal(win.state.active, ORIGINAL);
  assert.equal(win.state.plans.has(CLONE), false);
  assert.equal(fs.files.size, 0);
  const verbs = new Set(win.state.calls.filter((call) => call[0] === 'powercfg').map((call) => call[1]));
  for (const verb of verbs) assert.ok(Sys.ALLOWED_POWERCFG.has(verb), verb);
});

test('elevação: só tarefas da lista, SID validado, corpo codificado e uma única elevação no código', async () => {
  const fs = memoryFs();
  let launched = '';
  const elevate = Elevate.createElevator({ runPowerShell: async (script) => { launched = script; return { code: 1223, stdout: '' }; }, fs, path, dir: '/dados/elev', now: () => 5 });
  await assert.rejects(elevate('rm-rf', {}));
  await assert.rejects(elevate('perf-log-users', { action: 'add', sid: "S-1-5-21-1'; Remove-Item C:\\" }));
  const declined = await elevate('perf-log-users', { action: 'add', sid: 'S-1-5-21-111-222-333-1001' });
  assert.equal(declined.declined, true);
  assert.match(launched, /-Verb RunAs/);
  assert.match(launched, /-EncodedCommand','[A-Za-z0-9+/=]+'/);
  const decoded = Buffer.from(launched.match(/-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1], 'base64').toString('utf16le');
  assert.match(decoded, /Add-LocalGroupMember -SID 'S-1-5-32-559' -Member 'S-1-5-21-111-222-333-1001'/);
  assert.match(Elevate.restorePointBody('Nexo'), /SystemRestorePointCreationFrequency/);

  const root = path.join(__dirname, '..');
  const sources = ['main.cjs', 'electron/lab-system.cjs', 'electron/elevate.cjs', 'electron/games.cjs', 'electron/watcher.cjs', 'electron/account.cjs', 'electron/system-scan.cjs', 'electron/reboot-test.cjs', 'src/lab.js', 'src/lab-space.js', 'src/reboot-test.js', 'src/view-reboot.js', 'src/view-scan.js']
    .filter((file) => fsReal.existsSync(path.join(root, file)))
    .map((file) => [file, fsReal.readFileSync(path.join(root, file), 'utf8')]);
  const forbidden = /bcdedit|Set-MpPreference|DisableAntiSpyware|HypervisorEnforcedCodeIntegrity|SecureBoot|testsigning|nointegritychecks|Invoke-Expression|\biex\b|DownloadString|ReadProcessMemory|OpenProcess|WriteProcessMemory/i;
  for (const [file, text] of sources) assert.doesNotMatch(text, forbidden, file);
  const elevations = sources.filter(([, text]) => /-Verb RunAs/.test(text)).map(([file]) => file);
  assert.deepEqual(elevations, ['electron/elevate.cjs']);
  assert.deepEqual([...Sys.ALLOWED_POWERCFG].sort(), ['/aliases', '/changename', '/delete', '/duplicatescheme', '/export', '/getactivescheme', '/list', '/qh', '/setactive', '/setacvalueindex']);
});

test('adoptCurrent (modo assistido): só aplica valores revisados que mudam o plano ativo', async () => {
  const { system, win } = makeSystem();
  await assert.rejects(system.adoptCurrent({ perfepp: 33 }), /já tem/);
  await assert.rejects(system.adoptCurrent({ perfepp: 77 }));
  const adopted = await system.adoptCurrent({ perfepp: 0, cooling: 33 });
  assert.equal(adopted.before.guid, ORIGINAL);
  assert.deepEqual(adopted.config, { perfepp: 0 });
  assert.equal(win.state.values.get(`${CLONE}|PERFEPP`), 0, 'o primeiro clone disponível vira o plano ajustado');
});

const DUMP = [
  'GUID do Esquema de Energia: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado)',
  '  Alias de GUID: SCHEME_BALANCED',
  '  GUID do Subgrupo: 54533251-82be-4824-96c1-47b60b740d00  (Gerenciamento de energia do processador)',
  '    Alias de GUID: SUB_PROCESSOR',
  '    GUID da Configuração de Energia: 893dee8e-2bef-41e0-89c6-b55d0929964c  (Estado mínimo do processador)',
  '      Alias de GUID: PROCTHROTTLEMIN',
  '      Configuração Mínima Possível: 0x00000000',
  '      Configuração Máxima Possível: 0x00000064',
  '      Incremento das Configurações Possíveis: 0x00000001',
  '      Unidades das Configurações Possíveis: %',
  '    Índice de Configuração de Energia CA Atual: 0x00000005',
  '    Índice de Configuração de Energia CC Atual: 0x00000005',
  '',
  '    GUID da Configuração de Energia: be337238-0d82-4146-a960-4f3749d470c7  (Modo de aumento de desempenho do processador)',
  '      Alias de GUID: PERFBOOSTMODE',
  '      Índice de Configuração Possível: 000',
  '      Nome Amigável de Configuração Possível: Desabilitado',
  '      Índice de Configuração Possível: 001',
  '      Nome Amigável de Configuração Possível: Habilitado',
  '      Índice de Configuração Possível: 002',
  '      Nome Amigável de Configuração Possível: Agressivo',
  '    Índice de Configuração de Energia CA Atual: 0x00000001',
  '    Índice de Configuração de Energia CC Atual: 0x00000001',
  '',
  '    GUID da Configuração de Energia: 4d2b0152-7d5c-498b-88e2-34345392a2c5  (Intervalo de verificação de tempo de desempenho do processador)',
  '      Configuração Mínima Possível: 0x00000001',
  '      Configuração Máxima Possível: 0x00001388',
  '      Incremento das Configurações Possíveis: 0x00000001',
  '      Unidades das Configurações Possíveis: Milissegundos',
  '    Índice de Configuração de Energia CA Atual: 0x0000000f',
  '    Índice de Configuração de Energia CC Atual: 0x0000001e',
  '  GUID do Subgrupo: 501a4d13-42af-4429-9fd1-a8218c268e20  (PCI Express)',
  '    Alias de GUID: SUB_PCIEXPRESS',
  '    GUID da Configuração de Energia: ee12f906-d277-404b-b6da-e5fa1a576df5  (Gerenciamento de Energia do Estado de Link)',
  '      Alias de GUID: ASPM',
  '      Índice de Configuração Possível: 000',
  '      Nome Amigável de Configuração Possível: Desligado',
  '      Índice de Configuração Possível: 001',
  '      Nome Amigável de Configuração Possível: Economia moderada',
  '    Índice de Configuração de Energia CA Atual: 0x00000001',
  '    Índice de Configuração de Energia CC Atual: 0x00000002'
].join('\r\n');

test('powercfg /qh completo: subgrupo, configuração, apelido, faixa e índices, em qualquer idioma', () => {
  const map = Sys.parseQueryAll(DUMP);
  assert.deepEqual(map['54533251-82be-4824-96c1-47b60b740d00/893dee8e-2bef-41e0-89c6-b55d0929964c'], { ac: 5, dc: 5, min: 0, max: 100 });
  assert.deepEqual(map['alias:SUB_PROCESSOR/PERFBOOSTMODE'], { ac: 1, dc: 1, indexes: [0, 1, 2] });
  assert.deepEqual(map['54533251-82be-4824-96c1-47b60b740d00/4d2b0152-7d5c-498b-88e2-34345392a2c5'], { ac: 15, dc: 30, min: 1, max: 5000 });
  assert.deepEqual(map['501a4d13-42af-4429-9fd1-a8218c268e20/ee12f906-d277-404b-b6da-e5fa1a576df5'], { ac: 1, dc: 2, indexes: [0, 1] });
});

test('leitura de uma chamada só, faixa do PC respeitada e GUIDs nos ajustes novos', async () => {
  const win = fakeWindows();
  const realRun = win.run;
  const run = async (file, args) => { if (file === 'powercfg' && args[0] === '/qh' && args.length === 2) { win.state.calls.push([file, ...args]); return { code: 0, stdout: DUMP }; } return realRun(file, args); };
  const { system } = makeSystem({ run });
  const pre = await system.preflight();
  assert.equal(pre.knobs.minstate.current, 5);
  assert.deepEqual(pre.knobs.boostmode.indexes, [0, 1, 2]);
  assert.equal(pre.knobs.perfcheck.max, 5000);
  assert.equal(pre.knobs.aspm.available, true);
  assert.equal(pre.knobs.idledisable.available, false, 'o que o PC não lista fica de fora');
  assert.equal(win.state.calls.filter((call) => call[1] === '/qh').length, 1, 'uma chamada só');
  await system.begin();
  await system.readConfig();
  await assert.rejects(system.apply([{ id: 'boostmode', sub: 'SUB_PROCESSOR', setting: 'PERFBOOSTMODE', value: 5 }]), /não aceita/);
  await system.apply([{ id: 'aspm', sub: 'SUB_PCIEXPRESS', setting: 'ASPM', value: 0 }]);
  const call = win.state.calls.find((item) => item[1] === '/setacvalueindex');
  assert.deepEqual(call.slice(3), ['501a4d13-42af-4429-9fd1-a8218c268e20', 'ee12f906-d277-404b-b6da-e5fa1a576df5', '0']);
});
