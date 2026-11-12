/* "Otimizar este PC": plano, classificação do início, medição antes e depois, motor (com um PC simulado) e o lote elevado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Opt = require('../src/optimizer.js');
const Actions = require('../electron/optimizer-actions.cjs');
const { optimizerBatchBody, TASKS } = require('../electron/elevate.cjs');
const { interpret } = require('../electron/system-scan.cjs');
const { packagedName, gameStateScript, nicScript, STARTUP_SCRIPT } = require('../electron/optimizer-system.cjs');

const GB = 1024 ** 3;
const desktop = {
  kind: 'desktop', kindLabel: 'desktop', os: { platform: 'win32', build: 26100 },
  cpu: { vendor: 'AMD', model: 'Ryzen 7 5700X3D', cores: 8 }, memory: { totalBytes: 32 * GB },
  gpus: [{ name: 'GeForce RTX 4070', discrete: true }], disks: [{ kind: 'nvme', system: true }], displays: [{ vrr: true }]
};
const laptop = {
  kind: 'laptop', os: { platform: 'win32', build: 22631 }, cpu: { vendor: 'Intel', cores: 6 }, memory: { totalBytes: 16 * GB },
  gpus: [{ name: 'Intel Iris Xe', integrated: true }, { name: 'GeForce RTX 3050 Laptop', discrete: true }], disks: [{ kind: 'ssd', system: true }]
};
const find = (plan, id) => plan.steps.find((step) => step.id === id);

test('início: segurança, áudio e touchpad nunca saem; launchers e atualizadores saem; chat só se pesou', () => {
  const C = (item) => Opt.classifyStartup(item);
  assert.equal(C({ name: 'SecurityHealth', exe: 'SecurityHealthSystray.exe' }).verdict, 'manter');
  assert.equal(C({ name: 'Avast Update', exe: 'AvastUI.exe' }).verdict, 'manter', 'atualizador de antivírus é antivírus');
  assert.equal(C({ name: 'RtkAudUService', exe: 'RtkAudUService64.exe' }).verdict, 'manter');
  assert.equal(C({ name: 'SynTPEnh', exe: 'SynTPEnh.exe', company: 'Synaptics' }).verdict, 'manter');
  assert.equal(C({ name: 'Steam', exe: 'steam.exe' }).verdict, 'desligar');
  assert.equal(C({ name: 'EpicGamesLauncher', exe: 'EpicGamesLauncher.exe' }).verdict, 'desligar');
  assert.equal(C({ name: 'Adobe Acrobat Update', exe: 'AdobeARM.exe' }).verdict, 'desligar');
  assert.equal(C({ name: 'MicrosoftEdgeAutoLaunch_123', exe: 'msedge.exe', description: 'msedge --no-startup-window' }).verdict, 'desligar');
  assert.equal(C({ name: 'Discord', exe: 'Update.exe', description: 'Discord' }).verdict, 'opcional', 'Discord é chat, não atualizador (o exe dele se chama Update.exe)');
  assert.equal(C({ name: 'OneDrive', exe: 'OneDrive.exe' }).verdict, 'opcional');
  assert.equal(C({ name: 'iCUE', exe: 'iCUE.exe', company: 'Corsair' }).verdict, 'opcional');
  assert.equal(C({ name: 'NordVPN', exe: 'NordVPN.exe' }).verdict, 'manter');
  assert.equal(C({ name: 'qualquercoisa', exe: 'xyz.exe' }).kind, 'desconhecido');
});

test('plano: cada passo cita o PC, com método, risco e o que fica de fora', () => {
  const scan = interpret({ 'gamedvr#0': 1, 'gamedvr#1': 1, 'deliveryopt#0': null, 'powerthrottling#0': null, 'lastaccess#0': 0x80000002, 'hags#0': 1, 'directx#0': null, 'sysresp#0': 20, 'netthrottle#0': 10 });
  const findings = [{ id: 'gravacao-fundo', severity: 'baixa' }, { id: 'gpu-hags', severity: 'baixa' }, { id: 'wifi-24', severity: 'baixa' }];
  const report = { profile: desktop, findings, observation: { background: [{ name: 'Discord', cpuAvg: 6, memBytes: 700 * 1048576, impact: 'medio', tip: 'Desligue a aceleração.', label: 'Discord' }] }, plan: [{ id: 'lab-cpu', kind: 'laboratorio', title: 'Política de energia', knobs: ['perfepp', 'boostmode'] }, { id: 'bios-xmp', kind: 'bios', title: 'Ligar o perfil XMP', why: 'Pentes de 3600.' }] };
  const startup = [
    { source: 'user-run', name: 'Steam', exe: 'steam.exe', enabled: true },
    { source: 'user-run', name: 'Discord', exe: 'Discord.exe', description: 'Discord', enabled: true },
    { source: 'machine-run', name: 'SecurityHealth', exe: 'SecurityHealthSystray.exe', enabled: true, elevated: true },
    { source: 'user-run', name: 'Spotify', exe: 'Spotify.exe', enabled: false }
  ];
  const nics = [{ guid: '{11111111-2222-3333-4444-555555555555}', name: 'Realtek PCIe GbE', media: 'ethernet', props: [{ keyword: '*EEE', value: '1', valid: ['0', '1'] }, { keyword: 'EnableGreenEthernet', value: '0', valid: ['0', '1'] }] }];
  const game = { name: 'Roblox', exe: 'C:\\Users\\a\\AppData\\Local\\Roblox\\Versions\\version-1\\RobloxPlayerBeta.exe', exeName: 'RobloxPlayerBeta.exe' };
  const plan = Opt.buildPlan({ report, scan, startup, nics, game, power: { active: Opt.POWER_SAVER }, nicTweaks: Actions.NIC_TWEAKS, sensors: true });

  assert.equal(find(plan, 'raiox-gamedvr').selected, true);
  assert.match(find(plan, 'raiox-gamedvr').why, /análise viu/);
  assert.equal(find(plan, 'raiox-hags').to, 'Ligado');
  assert.equal(find(plan, 'raiox-hags').method, 'reiniciar');
  assert.equal(find(plan, 'raiox-powerthrottling').category, 'energia', 'desktop: limitação de segundo plano sai');
  assert.equal(find(plan, 'raiox-directx').to, 'Otimizações e taxa variável ligadas', 'monitor com VRR');
  assert.equal(find(plan, 'energia-plano').change.guid, Opt.BALANCED);
  assert.equal(find(plan, 'energia-laboratorio').method, 'medir');
  assert.equal(find(plan, 'energia-laboratorio').selected, true);
  assert.ok(find(plan, 'jogo-prioridade').admin);
  assert.equal(find(plan, 'jogo-gpu'), undefined, 'desktop sem vídeo integrado: preferência de placa não faz sentido');
  assert.equal(find(plan, 'jogo-qos').category, 'rede');
  // Rede: só o EEE (o Green já está desligado).
  const nicSteps = plan.steps.filter((step) => step.kind === 'nic');
  assert.deepEqual(nicSteps.map((step) => step.change.keyword), ['*EEE']);
  // Início: Steam marcado; Discord pesou 6% → marcado; segurança fora; Spotify já desligado.
  const starts = plan.steps.filter((step) => step.kind === 'startup');
  assert.deepEqual(starts.map((step) => [step.change.name, step.selected]), [['Steam', true], ['Discord', true]]);
  assert.match(starts[1].why, /6% do processador e 700 MB/);
  // Controversos com reinício: um passo só, desmarcado, com as mudanças.
  const reboot = find(plan, 'reinicio-teste');
  assert.equal(reboot.selected, false);
  // SysMain só porque o disco do sistema é SSD; o agrupamento de serviços só com 16 GB ou mais.
  assert.deepEqual(reboot.change.changes.map((change) => change.id).sort(), ['netthrottle', 'svchostsplit', 'sysmain', 'sysresp', 'tcpwait', 'timerglobal']);
  const small = Opt.buildPlan({ report: { profile: { ...desktop, memory: { totalBytes: 8 * GB }, disks: [{ kind: 'hdd', system: true }] }, findings: [] }, scan });
  assert.deepEqual(find(small, 'reinicio-teste').change.changes.map((change) => change.id).sort(), ['netthrottle', 'sysresp', 'tcpwait', 'timerglobal']);
  // Só a pessoa: BIOS, Wi-Fi 5 GHz, ajuste dentro do Discord.
  assert.ok(find(plan, 'manual-bios-xmp'));
  assert.ok(find(plan, 'manual-5ghz'));
  assert.ok(plan.steps.some((step) => step.id.startsWith('manual-fundo-')));
  assert.ok(plan.steps.filter((step) => step.method === 'manual').every((step) => !step.selected));
  // Nada de mito, e as seções seguem a ordem.
  assert.ok(plan.steps.every((step) => step.evidence !== 'mito'));
  const order = Opt.CATEGORIES.map((item) => item.id);
  const seen = plan.steps.map((step) => order.indexOf(step.category));
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.ok(Opt.needsPhrase(plan.steps), 'prioridade e laboratório são moderados: pede a frase');
});

test('plano: notebook híbrido fixa a placa dedicada; sem sensor, o laboratório fica de fora; risco baixo não marca moderado', () => {
  const game = { name: 'Valorant', exe: 'C:\\Riot Games\\VALORANT\\live\\VALORANT.exe', exeName: 'VALORANT.exe' };
  const report = { profile: laptop, findings: [], plan: [{ id: 'lab-cpu', kind: 'laboratorio', title: 'x', knobs: ['perfepp'] }] };
  const plan = Opt.buildPlan({ report, game, power: { active: Opt.BALANCED, overlayAc: Opt.EFFICIENCY_MODE }, sensors: false, allowRisk: 'baixo' });
  assert.ok(find(plan, 'jogo-gpu').selected);
  assert.equal(find(plan, 'energia-modo').change.guid, Opt.BEST_PERFORMANCE);
  assert.equal(find(plan, 'energia-laboratorio').selected, false);
  assert.equal(find(plan, 'energia-laboratorio').blocked, 'sem-temperatura');
  assert.equal(find(plan, 'jogo-prioridade').selected, false, 'moderado com limite "baixo"');
  assert.equal(Opt.needsPhrase(plan.steps), false);
});

test('medição: ganho e piora só além do ruído e na maioria das rodadas; ms baixos exigem diferença absoluta', () => {
  const single = Opt.METRIC.get('single');
  assert.equal(Opt.compareMetric(single, [100, 101, 99], [110, 111, 109]).verdict, 'melhorou');
  assert.equal(Opt.compareMetric(single, [100, 101, 99], [90, 89, 91]).verdict, 'piorou');
  assert.equal(Opt.compareMetric(single, [100, 120, 80], [110, 90, 105]).verdict, 'sem-diferenca', 'ruído alto');
  assert.equal(Opt.compareMetric(single, [100], [110]).verdict, 'inconclusivo');
  const ping = Opt.METRIC.get('gatewayMs');
  assert.equal(Opt.compareMetric(ping, [1.0, 1.05, 0.95], [0.7, 0.72, 0.68]).verdict, 'sem-diferenca', '0,3 ms a menos não é ganho de verdade');
  assert.equal(Opt.compareMetric(ping, [6, 6.2, 5.8], [3, 3.1, 2.9]).verdict, 'melhorou', 'menos ms é melhor');
  assert.equal(Opt.compareMetric(Opt.METRIC.get('internetMs'), [20, 20.5, 19.5], [30, 31, 29]).verdict, 'piorou');
});

/** PC simulado: benches e ping configuráveis por fase, e o registro do que foi aplicado e desfeito. */
function fakeSystem({ benchAfter = 1, pingAfter = 1, pingAfterUndo = null, declined = false, labResult = null } = {}) {
  let phase = 'antes';
  let t = 0;
  const calls = { apply: [], revert: [], lab: 0 };
  const system = {
    now: () => (t += 10),
    preflight: async () => ({ platform: 'win32', onBattery: false, cpuLoad: 5, tempC: 45 }),
    bench: async () => 1000 * (phase === 'antes' ? 1 : benchAfter) * (1 + (t % 3) * 0.002),
    ping: async () => {
      const factor = phase === 'antes' ? 1 : phase === 'desfeito' && pingAfterUndo ? pingAfterUndo : pingAfter;
      return { gatewayMs: 2 * factor, gatewayJitter: 0.5, internetMs: 20 * factor + (t % 3) * 0.05, internetJitter: 1 };
    },
    apply: async (changes) => { calls.apply.push(changes); phase = 'depois'; return { records: changes.map((change, index) => ({ id: `c${index + 1}`, stepId: change.stepId, ok: !(declined && ['priority', 'qos', 'nic'].includes(change.kind)) })), restore: { ok: !declined, created: !declined, note: declined ? 'sem a permissão do Windows' : '' }, declined }; },
    revert: async (records) => { calls.revert.push(records.map((record) => record.kind)); phase = 'desfeito'; return { records: records.map((record) => ({ id: record.id, ok: true })) }; },
    lab: async () => { calls.lab += 1; return labResult || { status: 'completed', adopted: null }; },
    waitNetwork: async () => true,
    sleep: async () => {}
  };
  return { system, calls };
}
const planWith = (steps) => ({ steps: steps.map((step) => ({ admin: false, reboot: 'nao', risk: 'baixo', evidence: 'medido', selected: true, method: 'aplicar', ...step })) });

test('motor: mede antes, aplica tudo de uma vez, roda o laboratório e mede depois', async () => {
  const { system, calls } = fakeSystem({ benchAfter: 1.08, labResult: { status: 'completed', adopted: { name: 'Nexo — Ajustado' }, combination: { compositeDelta: 4.2 } } });
  const plan = planWith([
    { id: 'raiox-gamedvr', kind: 'scan', category: 'windows', change: { kind: 'scan', id: 'gamedvr', values: [0, 0] } },
    { id: 'raiox-hags', kind: 'scan', category: 'jogo', method: 'reiniciar', reboot: 'reiniciar', change: { kind: 'scan', id: 'hags', values: [2] } },
    { id: 'energia-laboratorio', kind: 'lab', category: 'energia', method: 'medir', risk: 'moderado', change: { kind: 'lab', knobs: ['perfepp'] } },
    { id: 'manual-bios', kind: 'manual', category: 'manual', method: 'manual', selected: false }
  ]);
  const events = [];
  const result = await Opt.run(system, plan, { consent: { acknowledged: true, phrase: 'entendo o risco' }, emit: (event) => events.push(event) });
  assert.equal(result.status, 'completed');
  assert.equal(calls.apply.length, 1, 'uma aplicação só (um UAC)');
  assert.deepEqual(calls.apply[0].map((change) => change.stepId), ['raiox-gamedvr', 'raiox-hags']);
  assert.equal(calls.lab, 1);
  assert.equal(result.steps['energia-laboratorio'].status, 'feito');
  assert.equal(result.steps['raiox-hags'].note, 'vale depois de reiniciar');
  assert.equal(result.rebootPending, true);
  assert.equal(result.comparison.single.verdict, 'melhorou');
  assert.ok(events.some((event) => event.type === 'stage' && event.stage === 'depois'));
  const summary = Opt.summarize(result, plan);
  assert.match(summary.headline, /3 ajustes aplicados/);
  assert.ok(summary.lines.some((line) => /reiniciar/.test(line)));
});

test('motor: sem a frase, com algo moderado marcado, não começa; sem nada marcado, também não', async () => {
  const { system, calls } = fakeSystem();
  const risky = planWith([{ id: 'jogo-prioridade', kind: 'priority', category: 'jogo', risk: 'moderado', admin: true, change: { kind: 'priority', exe: 'game.exe' } }]);
  const result = await Opt.run(system, risky, { consent: { acknowledged: true, phrase: '' } });
  assert.equal(result.status, 'aborted');
  assert.equal(result.code, 'consentimento');
  assert.equal(calls.apply.length, 0);
  const empty = await Opt.run(system, planWith([]), { consent: { acknowledged: true } });
  assert.equal(empty.code, 'vazio');
});

test('motor: o ping piorou de verdade depois da placa de rede → desfaz a placa e o QoS, mede de novo e para de piorar', async () => {
  const { system, calls } = fakeSystem({ pingAfter: 1.6, pingAfterUndo: 1 });
  const plan = planWith([
    { id: 'rede-eee', kind: 'nic', category: 'rede', admin: true, change: { kind: 'nic', guid: '{x}', keyword: '*EEE' } },
    { id: 'jogo-qos', kind: 'qos', category: 'rede', admin: true, change: { kind: 'qos', exe: 'game.exe' } },
    { id: 'raiox-gamedvr', kind: 'scan', category: 'windows', change: { kind: 'scan', id: 'gamedvr', values: [0, 0] } }
  ]);
  const result = await Opt.run(system, plan, { consent: { acknowledged: true } });
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls.revert, [['nic', 'qos']], 'só o que é de rede e vale na hora');
  assert.equal(result.steps['rede-eee'].status, 'desfeito');
  assert.equal(result.steps['raiox-gamedvr'].status, 'feito');
  assert.notEqual(result.comparison.internetMs.verdict, 'piorou');
  assert.equal(result.undone.length, 2);
});

test('motor: piora que some na segunda medição é oscilação — nada é desfeito', async () => {
  let pings = 0;
  const { system, calls } = fakeSystem();
  system.ping = async () => { pings += 1; const bad = pings > 3 && pings <= 6; return { gatewayMs: bad ? 4 : 2, gatewayJitter: 0.5, internetMs: bad ? 40 : 20, internetJitter: 1 }; };
  const plan = planWith([{ id: 'rede-eee', kind: 'nic', category: 'rede', admin: true, change: { kind: 'nic', guid: '{x}', keyword: '*EEE' } }]);
  const result = await Opt.run(system, plan, { consent: { acknowledged: true } });
  assert.equal(calls.revert.length, 0);
  assert.equal(result.steps['rede-eee'].status, 'feito');
  assert.ok(result.log.some((entry) => /oscilação/.test(entry.message)));
});

test('motor: permissão recusada → os de administrador falham com o motivo, o resto fica; cancelar para no meio', async () => {
  const { system } = fakeSystem({ declined: true });
  const plan = planWith([
    { id: 'jogo-prioridade', kind: 'priority', category: 'jogo', admin: true, change: { kind: 'priority', exe: 'game.exe' } },
    { id: 'raiox-gamedvr', kind: 'scan', category: 'windows', change: { kind: 'scan', id: 'gamedvr', values: [0, 0] } }
  ]);
  const result = await Opt.run(system, plan, { consent: { acknowledged: true } });
  assert.equal(result.steps['jogo-prioridade'].status, 'falhou');
  assert.match(result.steps['jogo-prioridade'].note, /permissão/);
  assert.equal(result.steps['raiox-gamedvr'].status, 'feito');

  const signal = { cancelled: false };
  const second = fakeSystem();
  let benches = 0;
  second.system.bench = async () => { benches += 1; if (benches === 3) signal.cancelled = true; return 1000; };
  const cancelled = await Opt.run(second.system, plan, { consent: { acknowledged: true }, signal });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(second.calls.apply.length, 0, 'cancelou na medição de antes: nada foi aplicado');
});

test('ações: só o catálogo, só desligar, nunca programas do sistema, valores conferidos', () => {
  const ok = (change) => Actions.validateChange({ id: 'c1', ...change });
  assert.throws(() => ok({ kind: 'registro', key: 'HKLM\\x' }), /fora do catálogo/);
  assert.throws(() => ok({ kind: 'startup', source: 'user-run', name: 'Steam', value: Actions.ENABLED_BYTES }), /só desliga/);
  assert.equal(ok({ kind: 'startup', source: 'user-run', name: 'Steam', value: Actions.disabledBytes(0) }).value.slice(0, 8), '03000000');
  assert.equal(ok({ kind: 'startup', source: 'user-run', name: 'Steam', value: null, revert: true }).value, null);
  assert.throws(() => ok({ kind: 'startup', source: 'user-run', name: 'a"; rm', value: '03000000' }), /inválido/);
  assert.throws(() => ok({ kind: 'startup', source: 'packaged', name: 'Spotify\\Task', value: 2 }), /inválido/);
  assert.equal(ok({ kind: 'startup', source: 'packaged', name: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0\\SpotifyStartupTask', value: 1 }).value, 1);
  assert.throws(() => ok({ kind: 'priority', exe: 'svchost.exe', value: 3 }), /não é um jogo/);
  assert.throws(() => ok({ kind: 'priority', exe: 'vgc.exe', value: 3 }), /não é um jogo/);
  assert.throws(() => ok({ kind: 'priority', exe: 'game.exe', value: 4 }), /inválida/, 'só "alta" (3); tempo real nunca');
  assert.equal(ok({ kind: 'priority', exe: 'RobloxPlayerBeta.exe', value: null, revert: true }).value, null);
  assert.throws(() => ok({ kind: 'qos', exe: 'game.exe', on: false }), /inválida/);
  assert.throws(() => ok({ kind: 'nic', guid: '{11111111-2222-3333-4444-555555555555}', keyword: '*EEE', value: '1' }), /inválido/, 'só o valor do catálogo');
  assert.throws(() => ok({ kind: 'nic', guid: '{11111111-2222-3333-4444-555555555555}', keyword: '*SpeedDuplex', value: '0' }), /fora do catálogo/);
  assert.throws(() => ok({ kind: 'gpu-pref', exe: 'C:\\Jogos\\..\\Windows\\explorer.exe', value: 'GpuPreference=2;' }), /inválido|não é um jogo/);
  assert.equal(Actions.gpuPreferenceValue('SwapEffectUpgradeEnable=1;GpuPreference=1;'), 'SwapEffectUpgradeEnable=1;GpuPreference=2;');
  assert.equal(Actions.gpuPreferenceValue(null), 'GpuPreference=2;');
  assert.equal(Actions.approvedEnabled(null), true);
  assert.equal(Actions.approvedEnabled('020000000000000000000000'), true);
  assert.equal(Actions.approvedEnabled('06000000'), true);
  assert.equal(Actions.approvedEnabled('03000000ABCD'), false);
  assert.equal(Actions.disabledBytes(Date.UTC(2026, 0, 1)).length, 24);
  assert.equal(Actions.needsElevation(ok({ kind: 'startup', source: 'machine-run', name: 'X', value: '03000000' })), true);
  assert.equal(Actions.needsElevation(ok({ kind: 'startup', source: 'user-run', name: 'X', value: '03000000' })), false);
});

test('lote elevado: ponto de restauração, Raio-X e ações juntos; nada fora do catálogo; cabe na linha de comando', () => {
  assert.ok(TASKS['optimizer-batch']);
  const body = optimizerBatchBody({
    restorePoint: true,
    registry: [{ id: 'hags', values: [2] }, { id: 'lastaccess', values: [0x80000001] }],
    changes: [
      { id: 'c1', kind: 'startup', source: 'machine-run', name: "O'Neil Tool", value: '03000000AABBCCDDEEFF0011' },
      { id: 'c2', kind: 'priority', exe: 'RobloxPlayerBeta.exe', value: 3 },
      { id: 'c3', kind: 'qos', exe: 'RobloxPlayerBeta.exe', on: true, nla: null },
      { id: 'c4', kind: 'nic', guid: '{11111111-2222-3333-4444-555555555555}', keyword: '*EEE', value: '0' },
      { id: 'c5', kind: 'pagefile', auto: true }
    ]
  });
  assert.match(body, /Checkpoint-Computer/);
  assert.match(body, /\$r\.restore = & \{/);
  assert.match(body, /HwSchMode/);
  assert.match(body, /'O''Neil Tool'/, 'aspas escapadas');
  assert.match(body, /CpuPriorityClass' -PropertyType DWord -Value 3/);
  assert.match(body, /-DSCPAction 46/);
  assert.match(body, /-RegistryKeyword '\*EEE' -RegistryValue '0' -NoRestart/);
  assert.match(body, /Restart-NetAdapter/);
  assert.match(body, /AutomaticManagedPagefile = \$true/);
  assert.ok(body.length < 12000, `tamanho ${body.length}`);
  assert.throws(() => optimizerBatchBody({ changes: [{ id: 'c1', kind: 'gpu-pref', exe: 'C:\\g\\game.exe', value: 'GpuPreference=2;' }] }), /sem necessidade de administrador/);
  assert.throws(() => optimizerBatchBody({ changes: [{ id: 'x1', kind: 'pagefile', auto: true }] }), /Identificador/);
  assert.throws(() => optimizerBatchBody({}), /Nada para fazer/);
  // Reverter o QoS: volta o "Do not use NLA" só quando não sobra política do Nexo.
  const undo = optimizerBatchBody({ changes: [{ id: 'c9', kind: 'qos', exe: 'game.exe', on: false, nla: null, revert: true }] });
  assert.match(undo, /Where-Object \{ \$_\.Name -like 'Nexo - \*' \}/);
});

test('leituras: scripts sem dado de fora embutido sem escape; nomes da Loja legíveis', () => {
  assert.equal(packagedName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0\\SpotifyStartupTask'), 'Spotify');
  assert.equal(packagedName('Contoso.CoolApp_abcdefghijklm\\Task'), 'Cool App');
  const script = gameStateScript({ name: 'x', exe: "C:\\Jogos\\O'Brien\\game.exe", exeName: 'game.exe' });
  assert.match(script, /'C:\\Jogos\\O''Brien\\game\.exe'/);
  assert.match(nicScript(), /'\*EEE'/);
  assert.match(STARTUP_SCRIPT, /StartupApproved/);
});

test('otimizador: conferência depois do reinício mede contra o antes e desfaz só o ajuste de reinício que piorou', async () => {
  const Opt = require('../src/optimizer.js');
  const before = Object.fromEntries(Opt.METRICS.map((metric) => [metric.id, []]));
  for (const id of Opt.BENCHES) before[id] = [1000, 1010, 990];
  before.gatewayMs = [2, 2.1, 1.9]; before.gatewayJitter = [0.3, 0.3, 0.3]; before.internetMs = [12, 12.4, 11.8]; before.internetJitter = [1, 1, 1];
  const saved = { before, records: [
    { id: 'c1', kind: 'pagefile', reboot: 'reiniciar', ok: true },
    { id: 'c2', kind: 'nic', reboot: 'reiniciar', ok: true },
    { id: 'c3', kind: 'registry', reboot: 'nao', ok: true }
  ] };
  const fake = (scores, extra = {}) => {
    const reverted = [];
    return { reverted, system: { now: () => 1, preflight: async () => ({ platform: 'win32', uptimeSec: 600, cpuLoad: 5, ...extra }), bench: async (name) => scores[name] ?? 1000, ping: async () => ({ gatewayMs: 2, gatewayJitter: 0.3, internetMs: 12, internetJitter: 1 }), revert: async (ids) => { reverted.push(...ids); return { records: ids.map((id) => ({ id, ok: true })) }; } } };
  };
  const same = fake({});
  const fine = await Opt.afterBoot(same.system, saved, { rounds: 3 });
  assert.equal(fine.status, 'completed');
  assert.deepEqual(fine.undone, []);
  assert.equal(fine.rebootAgain, false);
  const slow = fake({ multi: 700 });
  const worse = await Opt.afterBoot(slow.system, saved, { rounds: 3 });
  assert.equal(worse.status, 'completed');
  assert.deepEqual(slow.reverted, ['c1'], 'processador piorou: desfaz só o ajuste de reinício do processador (não o de rede, nem o que vale na hora)');
  assert.deepEqual(worse.undone, ['c1']);
  assert.equal(worse.rebootAgain, true);
  const early = await Opt.afterBoot(fake({}, { uptimeSec: 30 }).system, saved, { rounds: 1 });
  assert.equal(early.code, 'cedo');
  const nothing = await Opt.afterBoot(same.system, { before, records: [{ id: 'c3', reboot: 'nao', ok: true }] }, { rounds: 1 });
  assert.equal(nothing.code, 'vazio');
});
