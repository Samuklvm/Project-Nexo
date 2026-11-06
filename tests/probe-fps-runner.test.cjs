const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createProbe, normalizeProbe, PROBE_SCRIPT } = require('../electron/probe.cjs');
const { createFpsRunner, ACCESS_HINT } = require('../electron/fps-runner.cjs');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
  child.kill = () => { child.killed = true; child.emit('exit', 0); };
  return child;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('sonda: normaliza, classifica o jogo e NUNCA deixa o caminho sair', () => {
  const sample = normalizeProbe({ t: 5, fg: { pid: 77, name: 'eldenring', path: 'C:\\Games\\Steam\\steamapps\\common\\ELDEN RING\\eldenring.exe' },
    cpu: { pid: 1, name: 'chrome', cpu: 250 }, gpu: [{ pid: 2, name: 'obs64', util: 33.3 }], self: { cpu: 0.4, memMB: 90 } });
  assert.equal(sample.fg.isGame, true);
  assert.equal(JSON.stringify(sample).includes('steamapps'), false, 'o caminho vazou');
  assert.equal(sample.cpu.length, 1);
  assert.equal(sample.cpu[0].cpu, 100, 'valor absurdo é limitado');
  assert.equal(normalizeProbe({ error: 'probe' }), null);
  assert.equal(normalizeProbe(null), null);
});

test('sonda: o script não usa interpolação do JavaScript nem aspas que quebrem o -Command', () => {
  assert.equal(PROBE_SCRIPT.includes('${'), false);
  assert.ok(PROBE_SCRIPT.includes("Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine"));
  assert.ok(/^'@/m.test(PROBE_SCRIPT), 'o here-string precisa fechar no início da linha');
});

test('sonda: lê linhas do processo filho, ignora lixo, autodiagnostica e encerra', async () => {
  const children = []; const emitted = [];
  const probe = createProbe({ platform: 'win32', emit: (sample) => emitted.push(sample), spawnFn: (cmd, args) => { assert.equal(cmd, 'powershell.exe'); assert.ok(args.includes('-NonInteractive')); const c = fakeChild(); children.push(c); return c; } });
  assert.deepEqual(probe.start(), { ok: true });
  assert.deepEqual(probe.start(), { ok: true });
  assert.equal(children.length, 1, 'não abre uma segunda sonda');
  children[0].stdout.write('isto não é json\n{"error":"probe"}\n{"t":9,"fg":{"pid":4,"name":"Code","path":"C:\\\\x\\\\Code.exe"},"cpu":[],"gpu":[]}\n');
  await wait(30);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].fg.isGame, false);
  probe.stop();
  assert.equal(children[0].killed, true);
  assert.equal(probe.isRunning(), false);
});

test('sonda: o autodiagnóstico devolve a primeira leitura ou o motivo da falha', async () => {
  let child;
  const ok = createProbe({ platform: 'win32', spawnFn: () => { child = fakeChild(); setTimeout(() => child.stdout.write('{"t":1,"fg":null,"cpu":[],"gpu":[]}\n'), 10); return child; } });
  const result = await ok.test(2000);
  assert.equal(result.ok, true);
  assert.equal(child.killed, true, 'a sonda iniciada só para o teste é encerrada');
  const silent = createProbe({ platform: 'win32', spawnFn: () => fakeChild() });
  const timeout = await silent.test(80);
  assert.equal(timeout.ok, false);
  assert.match(timeout.reason, /não respondeu/);
  assert.equal((await createProbe({ platform: 'linux' }).test(50)).ok, false);
});

test('FPS: valida pid e plataforma, monta os argumentos oficiais e resume ao parar', async () => {
  const spawned = []; const events = [];
  const runner = createFpsRunner({ platform: 'win32', emit: (channel, payload) => events.push([channel, payload]), spawnFn: (exe, args) => { const c = fakeChild(); spawned.push({ exe, args, c }); return c; } });
  assert.throws(() => runner.start({ exe: 'C:\\x\\PresentMon.exe', pid: 0 }), /inválido/);
  assert.throws(() => runner.start({ exe: '', pid: 100 }), /não foi encontrado/);
  assert.throws(() => createFpsRunner({ platform: 'linux' }).start({ exe: 'x', pid: 100 }), /só existe no Windows/);
  runner.start({ exe: 'C:\\x\\PresentMon.exe', pid: 4321 });
  assert.throws(() => runner.start({ exe: 'C:\\x\\PresentMon.exe', pid: 4321 }), /já está em andamento/);
  const args = spawned[0].args;
  for (const flag of ['--process_id', '4321', '--output_stdout', '--no_console_stats', '--stop_existing_session', '--session_name', 'NexoFPS', '--terminate_on_proc_exit']) assert.ok(args.includes(flag), `faltou ${flag}`);
  const out = spawned[0].c.stdout;
  out.write('Application,ProcessID,MsBetweenPresents,MsCPUBusy,MsGPUBusy\n');
  for (let i = 0; i < 300; i++) out.write('Game.exe,4321,10,4,9.5\n');
  await wait(1150);
  assert.ok(events.some(([channel, payload]) => channel === 'fps:update' && payload.fps > 90 && payload.frames === 300));
  const result = await runner.stop();
  assert.equal(result.frames, 300);
  assert.ok(Math.abs(result.summary.avgFps - 100) < 1);
  assert.equal(spawned[0].c.killed, true);
  const cleaner = spawned[1];
  assert.deepEqual(cleaner.args, ['--terminate_existing_session', '--session_name', 'NexoFPS']);
});

test('FPS: falha de permissão vira uma explicação clara, não um erro vago', async () => {
  const events = []; let child;
  const runner = createFpsRunner({ platform: 'win32', emit: (channel, payload) => events.push([channel, payload]), spawnFn: () => { child = fakeChild(); return child; } });
  runner.start({ exe: 'C:\\x\\PresentMon.exe', pid: 4321 });
  child.stderr.write('error: failed to start trace session (access denied)\n');
  await wait(30);
  child.emit('exit', 1);
  const error = events.find(([channel]) => channel === 'fps:error');
  assert.equal(error[1].code, 'acesso-negado');
  assert.equal(error[1].message, ACCESS_HINT);
  assert.match(ACCESS_HINT, /Performance Log Users/);
  assert.equal(runner.isRunning(), false);
});

const Fetch = require('../scripts/fetch-presentmon.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

test('PresentMon: hash fixado e conferido; sem hash nada é baixado; só baixa da URL oficial e se o arquivo conferir', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'third-party', 'presentmon.lock.json'), 'utf8'));
  assert.equal(lock.sha256, 'b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af', 'hash conferido com o digest da release v2.6.0 do GitHub');
  assert.equal(Fetch.plan(lock).action, 'download');
  assert.equal(Fetch.plan({ ...lock, sha256: null }).action, 'skip', 'sem hash, nada é baixado');
  assert.equal(Fetch.plan(lock, ['--print-hash']).action, 'print-hash');
  assert.equal(Fetch.plan({ ...lock, sha256: 'abc' }).action, 'skip', 'hash malformado é ignorado');
  const good = crypto.createHash('sha256').update('conteudo').digest('hex');
  assert.equal(Fetch.plan({ ...lock, sha256: good }).action, 'download');
  assert.equal(Fetch.plan({ ...lock, url: 'https://evil.example/PresentMon.exe', sha256: good }).action, 'error');
  assert.equal(Fetch.verify(Buffer.from('conteudo'), good.toUpperCase()), true);
  assert.equal(Fetch.verify(Buffer.from('adulterado'), good), false);
  assert.equal(lock.license, 'MIT');
});
