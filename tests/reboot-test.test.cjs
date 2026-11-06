const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const RT = require('../src/reboot-test.js');
const { createRebootTest, RUNONCE_KEY, RUNONCE_VALUE } = require('../electron/reboot-test.cjs');
const Scan = require('../electron/system-scan.cjs');

const CHANGE = { id: 'priosep', label: 'Divisão de tempo', before: [2], after: [38], beforeLabel: 'Padrão', afterLabel: '0x26', admin: true };
const HKCU = { id: 'menudelay', label: 'Atraso dos menus', before: ['400'], after: ['100'], beforeLabel: '400 ms', afterLabel: '100 ms', admin: false };

/** Boot de mentira: B melhor em `gain` (frações) nos testes e no tempo até a área de trabalho. */
function fakeBoot(config, { gain = 0.08, jitter = 0.005, seed = 1 } = {}) {
  const wobble = (i) => 1 + jitter * Math.sin(seed * 7 + i * 3);
  const factor = config === 'B' ? 1 + gain : 1;
  const metrics = { desktop: 10 / factor * wobble(1), boot: 20 * wobble(2), idleCpu: 3 * wobble(3), memUsed: 4 * wobble(4), processes: 200 * wobble(5), services: 100 * wobble(6) };
  RT.BENCHES.forEach((mode, i) => { metrics[mode] = 1000 * factor * wobble(10 + i); });
  return { bootAt: 1, metrics, rounds: {}, quiet: true, viaRunOnce: true };
}

test('plano: ordens ABBA, validação dos ajustes e contagem de permissões', () => {
  assert.deepEqual(RT.PROTOCOLS.completo.order, ['A', 'B', 'B', 'A']);
  for (const protocol of Object.values(RT.PROTOCOLS)) {
    assert.equal(protocol.order[0], 'A', 'começa medindo sem mudar nada');
    assert.equal(protocol.order[protocol.order.length - 1], 'A', 'termina no original (só volta ao B se ganhar)');
  }
  const plan = RT.createPlan({ changes: [CHANGE, HKCU], now: 1000 });
  assert.equal(plan.status, 'running');
  assert.equal(plan.applied, 'A');
  assert.equal(plan.admin, true);
  assert.throws(() => RT.createPlan({ changes: [] }));
  assert.throws(() => RT.createPlan({ changes: [{ ...CHANGE, after: [2] }] }), /diferente/);
  assert.throws(() => RT.createPlan({ changes: [{ ...CHANGE, id: 'X; rm' }] }));
  assert.throws(() => RT.createPlan({ changes: [CHANGE], protocol: 'nada' }));
  assert.equal(RT.permissionCount(RT.PROTOCOLS.completo.order, true), 2);
  assert.equal(RT.permissionCount(RT.PROTOCOLS.longo.order, true), 4);
  assert.equal(RT.permissionCount(RT.PROTOCOLS.completo.order, false), 0);
});

test('máquina de estados: só mede depois de um boot NOVO; troca A↔B só quando a ordem pede', () => {
  let state = RT.createPlan({ changes: [CHANGE], protocol: 'completo', now: 1000 });
  assert.equal(RT.nextAction(state, { bootAt: 500, now: 2000 }).type, 'wait-reboot', 'PC ligado antes de armar não conta');
  assert.equal(RT.nextAction(state, { bootAt: 1500, now: 2000 }).type, 'measure');
  state = RT.recordBoot(state, fakeBoot('A'), 3000);
  assert.deepEqual(RT.nextAction(state, { bootAt: 1500, now: 3100 }), { type: 'switch', config: 'B' });
  state = RT.markSwitched(state, 'B', 3200);
  assert.equal(RT.nextAction(state, { bootAt: 1500, now: 3300 }).type, 'wait-reboot', 'depois de trocar, precisa reiniciar');
  assert.equal(RT.nextAction(state, { bootAt: 3500, now: 4000 }).type, 'measure');
  state = RT.recordBoot(state, fakeBoot('B'), 5000);
  assert.equal(RT.nextAction(state, { bootAt: 3500, now: 5100 }).type, 'wait-reboot', 'B de novo: mesma configuração, novo boot');
  state = RT.recordBoot(state, fakeBoot('B', { seed: 2 }), 7000);
  assert.deepEqual(RT.nextAction(state, { bootAt: 6000, now: 7100 }), { type: 'switch', config: 'A' });
  state = RT.markSwitched(state, 'A', 7200);
  state = RT.recordBoot(state, fakeBoot('A', { seed: 3 }), 9000);
  assert.equal(RT.nextAction(state, { bootAt: 8000, now: 9100 }).type, 'finish');
  assert.deepEqual(state.boots.map((boot) => boot.config), ['A', 'B', 'B', 'A']);
  assert.equal(RT.nextAction({ ...state, updatedAt: 9000 }, { bootAt: 1, now: 9000 + RT.LIMITS.staleAfterMs + 10 }).type, 'abandon');
});

test('veredito: ganho só quando B vence em todos os boots e passa do ruído', () => {
  const run = (gain, jitter) => {
    let state = RT.createPlan({ changes: [CHANGE], protocol: 'completo', goal: 'jogos', now: 1 });
    for (const [index, config] of state.order.entries()) state = RT.recordBoot(state, fakeBoot(config, { gain, jitter, seed: index + 1 }), 10 + index);
    return RT.verdict(state);
  };
  const win = run(0.08, 0.005);
  assert.equal(win.overall, 'ganho');
  assert.equal(win.keep, 'B');
  assert.ok(win.composite > 2);
  assert.equal(win.metrics.find((item) => item.id === 'frames').verdict, 'melhorou');
  const loss = run(-0.08, 0.005);
  assert.equal(loss.overall, 'perda');
  assert.equal(loss.keep, 'A');
  const flat = run(0, 0.003);
  assert.equal(flat.overall, 'empate');
  assert.equal(flat.keep, 'A');
  // Ganho de 4% com boots iguais variando ±6%: não dá para afirmar.
  const noisy = run(0.04, 0.06);
  assert.notEqual(noisy.overall, 'ganho');
  assert.equal(noisy.keep, 'A');
});

test('veredito: boot com o PC ocupado fica de fora; métrica sem dados é inconclusiva', () => {
  let state = RT.createPlan({ changes: [CHANGE], protocol: 'rapido', now: 1 });
  state = RT.recordBoot(state, fakeBoot('A'), 2);
  state = RT.recordBoot(state, { ...fakeBoot('B'), quiet: false }, 3);
  state = RT.recordBoot(state, fakeBoot('A', { seed: 4 }), 4);
  const result = RT.verdict(state);
  assert.equal(result.discarded, 1);
  assert.equal(result.counts.B, 0);
  assert.equal(result.overall, 'inconclusivo');
  const partial = RT.judgeMetric(RT.METRIC.get('frames'), [{ config: 'A', metrics: { frames: 1 }, rounds: {} }]);
  assert.equal(partial.verdict, 'inconclusivo');
});

test('estado do disco: arquivo estranho ou adulterado é ignorado', () => {
  const good = RT.createPlan({ changes: [CHANGE], now: 5 });
  assert.ok(RT.sanitizeState(JSON.parse(JSON.stringify(good))));
  assert.equal(RT.sanitizeState(null), null);
  assert.equal(RT.sanitizeState({ ...good, version: 99 }), null);
  assert.equal(RT.sanitizeState({ ...good, order: ['B', 'B'] }), null, 'ordem que não é de um protocolo');
  assert.equal(RT.sanitizeState({ ...good, changes: [{ ...CHANGE, id: '../x' }] }), null);
  assert.equal(RT.sanitizeState({ ...good, applied: 'C' }), null);
  const odd = RT.sanitizeState({ ...good, boots: [{ metrics: { frames: -5, desktop: 1e9, single: 1000 }, rounds: { single: [1, 'x', null] } }] });
  assert.deepEqual(odd.boots[0].metrics, { single: 1000 });
  assert.deepEqual(odd.boots[0].rounds.single, [1]);
  assert.equal(odd.boots[0].config, 'A');
});

/* ---------- Executor (com Windows de mentira) ---------- */
function harness({ applyResult = () => ({ ok: true, failed: [] }), packaged = true } = {}) {
  const files = new Map();
  const fs = {
    mkdir: async () => {}, rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    writeFile: async (file, text) => { files.set(file, String(text)); }, readFile: async (file) => { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); }
  };
  const clock = { now: 1_000_000, uptimeS: 3600 };
  const calls = [];
  const applied = [];
  const sys = {
    fs, files, clock, calls, applied,
    test: createRebootTest({
      fs, path, dir: '/data/reboot-test', platform: 'win32', isPackaged: packaged, exePath: 'C:\\Program Files\\Nexo\\Nexo.exe',
      run: async (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: '' }; },
      // O Explorer abriu 20 s depois do boot.
      runPowerShell: async () => ({ code: 0, stdout: JSON.stringify({ explorer: clock.now - clock.uptimeS * 1000 + 20000, processes: 210, services: 101 }) }),
      apply: async (changes) => { applied.push(changes); return applyResult(changes); },
      validate: (change) => Scan.validateChange(change),
      bench: async (mode) => ({ mode, mopsPerSec: 1000 }), cpuLoad: async () => 3, memory: () => ({ total: 16 * 1024 ** 3, free: 10 * 1024 ** 3 }), onBattery: async () => false,
      uptime: () => clock.uptimeS, now: () => clock.now, sleep: async (ms) => { clock.now += ms; clock.uptimeS += ms / 1000; }
    })
  };
  return sys;
}
const reboot = (sys) => { sys.clock.now += 60000; sys.clock.uptimeS = 30; };

test('executor: arma o RunOnce, espera o reinício, mede, troca e termina voltando ao A sem ganho', async () => {
  const sys = harness();
  const started = await sys.test.start({ changes: [CHANGE], protocol: 'rapido' });
  assert.equal(started.armed, true);
  assert.deepEqual(sys.calls[0], ['reg', 'add', RUNONCE_KEY, '/v', RUNONCE_VALUE, '/t', 'REG_SZ', '/d', '"C:\\Program Files\\Nexo\\Nexo.exe" --reboot-test', '/f']);
  assert.equal(started.action, 'wait-reboot');
  // Abrir o Nexo sem reiniciar não mede nada.
  assert.equal((await sys.test.tick({})).action, 'wait-reboot');
  assert.equal(sys.applied.length, 0);
  reboot(sys);
  let status = await sys.test.tick({ viaRunOnce: true, launchedAt: sys.clock.now });
  assert.equal(status.state.boots.length, 1);
  assert.ok(status.state.boots[0].metrics.memUsed > 5.9 && status.state.boots[0].metrics.memUsed < 6.1);
  assert.equal(status.state.boots[0].metrics.services, 101);
  assert.equal(status.state.applied, 'B', 'depois do boot A, aplica B para o próximo');
  assert.deepEqual(sys.applied[0], [{ id: 'priosep', values: [38] }]);
  assert.equal(status.action, 'wait-reboot');
  reboot(sys);
  status = await sys.test.tick({ viaRunOnce: true, launchedAt: sys.clock.now });
  assert.equal(status.state.applied, 'A');
  assert.deepEqual(sys.applied[1], [{ id: 'priosep', values: [2], revert: true }]);
  reboot(sys);
  status = await sys.test.tick({ viaRunOnce: true, launchedAt: sys.clock.now });
  assert.equal(status.state.status, 'done');
  assert.equal(status.state.kept, 'A', 'testes iguais: fica o original');
  assert.equal(sys.applied.length, 2);
  assert.ok(sys.calls.some((call) => call[0] === 'reg' && call[1] === 'delete' && call.includes(RUNONCE_VALUE)), 'desarma o RunOnce');
  assert.equal(status.history.length, 1);
  assert.equal(status.history[0].boots[0].rounds, undefined, 'histórico sem as rodadas');
});

test('executor: UAC recusado pausa o teste; cancelar volta ao A', async () => {
  let refuse = true;
  const sys = harness({ applyResult: () => (refuse ? { ok: false, failed: ['priosep'], declined: true } : { ok: true, failed: [] }) });
  await sys.test.start({ changes: [CHANGE], protocol: 'completo' });
  reboot(sys);
  let status = await sys.test.tick({ viaRunOnce: true, launchedAt: sys.clock.now });
  assert.equal(status.state.applied, 'A');
  assert.equal(status.action, 'switch');
  assert.match(status.state.note, /Sem a permissão do Windows: Divisão de tempo/);
  refuse = false;
  status = await sys.test.tick({});
  assert.equal(status.state.applied, 'B');
  status = await sys.test.cancel();
  assert.equal(status.state.status, 'cancelled');
  assert.equal(status.state.kept, 'A');
  assert.deepEqual(sys.applied.at(-1), [{ id: 'priosep', values: [2], revert: true }]);
  assert.ok(sys.calls.some((call) => call[0] === 'shutdown' && call[1] === '/a'), 'cancela um reinício agendado');
  await assert.rejects(sys.test.start({ changes: [{ ...CHANGE, after: [99] }] }), /catálogo/);
});

test('executor: reinício automático só se pedido, e só depois de medir ou trocar', async () => {
  const sys = harness();
  await assert.rejects(sys.test.restart(15), /Não há teste/, 'sem teste, a interface não consegue reiniciar o PC');
  assert.ok(!sys.calls.some((call) => call[0] === 'shutdown'));
  await sys.test.start({ changes: [HKCU], protocol: 'rapido', auto: true });
  await sys.test.tick({});
  assert.ok(!sys.calls.some((call) => call[0] === 'shutdown'), 'abrir o Nexo esperando reinício não reinicia sozinho');
  reboot(sys);
  await sys.test.tick({ viaRunOnce: true, launchedAt: sys.clock.now });
  const shutdown = sys.calls.find((call) => call[0] === 'shutdown');
  assert.deepEqual(shutdown.slice(0, 4), ['shutdown', '/r', '/t', '60']);
  const status = await sys.test.status();
  assert.ok(status.restartAt > sys.clock.now);
});

test('executor: o tempo até a área de trabalho vem do RunOnce (mesmo se outra cópia já estava medindo)', async () => {
  const sys = harness();
  await sys.test.start({ changes: [HKCU], protocol: 'rapido' });
  reboot(sys);
  const launchedAt = sys.clock.now;
  const status = await sys.test.tick({ viaRunOnce: true, launchedAt });
  const boot = status.state.boots[0];
  assert.equal(boot.viaRunOnce, true);
  // reboot(): o Nexo abriu 30 s depois do boot; o Explorer, 20 s depois: 10 s até a área de trabalho.
  assert.ok(Math.abs(boot.metrics.desktop - 10) < 0.5, String(boot.metrics.desktop));
  assert.ok(Math.abs(boot.metrics.boot - 20) < 0.5, String(boot.metrics.boot));
  // Aberto à mão (sem RunOnce): sem o tempo até a área de trabalho, o resto vale.
  const other = harness();
  await other.test.start({ changes: [HKCU], protocol: 'rapido' });
  reboot(other);
  const manual = (await other.test.tick({})).state.boots[0];
  assert.equal(manual.viaRunOnce, false);
  assert.equal(manual.metrics.desktop, undefined);
  assert.ok(manual.metrics.boot > 0);
});

test('fora do Windows: não faz nada', async () => {
  const test = createRebootTest({ fs: {}, path, dir: '/x', platform: 'linux', run: async () => ({ code: 0 }), uptime: () => 1, readFile: null, now: () => 1 });
  await assert.rejects(test.start({ changes: [CHANGE] }), /Windows/);
});
