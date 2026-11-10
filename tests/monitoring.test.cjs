/*
 * Monitoramento: o que limita o PC (GPU de verdade x contador de uso), FPS de sessões longas, 1% baixo, régua do
 * clock, jogo com caminho protegido e o ciclo de vida do observador e da sonda (A21, A22, A26).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const Bottleneck = require('../src/bottleneck.js');
const Fps = require('../src/fps.js');
const Brain = require('../src/brain.js');
const Session = require('../src/session.js');
const Watch = require('../electron/watcher.cjs');
const { createLinuxProbe, normalizeProbe } = require('../electron/probe.cjs');

test('gargalo: GPU em 100% só é "a placa no limite" com clock alto; ocupada e devagar é outra coisa', () => {
  const base = { cpu: 35, maxCore: 60, mem: 50 };
  assert.equal(Bottleneck.classify({ ...base, gpu: 99, gpuClockRatio: 0.97, gpuPowerPct: 80 }), 'gpu');
  assert.equal(Bottleneck.classify({ ...base, gpu: 99, gpuClockRatio: 0.98, gpuLimits: { power: true } }), 'gpu-energia');
  assert.equal(Bottleneck.classify({ ...base, gpu: 99, gpuClockRatio: 0.45, gpuPowerPct: 30 }), 'gpu-baixo-clock', 'ocupada mas devagar: não é falta de potência');
  assert.equal(Bottleneck.classify({ ...base, gpu: 98, gpuTemp: 88, gpuClockRatio: 0.8 }), 'gpu-calor');
  assert.equal(Bottleneck.classify({ ...base, gpu: 98, gpuLimits: { thermal: true } }), 'gpu-calor');
  assert.equal(Bottleneck.classify({ ...base, gpu: 80, vramPct: 97 }), 'gpu-vram');
  assert.equal(Bottleneck.classify({ cpu: 40, maxCore: 99, gpu: 55, mem: 50 }), 'cpu-thread', 'um núcleo no limite com a CPU total baixa');
  assert.equal(Bottleneck.classify({ cpu: 95, maxCore: 100, gpu: 40, mem: 50 }), 'cpu-total');
  assert.equal(Bottleneck.classify({ cpu: 40, maxCore: 99, gpu: 55, mem: 50, cpuTemp: 95, cpuClockRatio: 0.7 }), 'cpu-calor');
  assert.equal(Bottleneck.classify({ cpu: 30, maxCore: 50, gpu: 60, mem: 50, fps: 143, refreshHz: 144 }), 'limite-de-quadros');
  assert.equal(Bottleneck.classify({ cpu: 10, maxCore: 30, gpu: 5, mem: 40 }), null, 'sem carga, sem veredito');
  assert.equal(Bottleneck.classify({ cpu: 30, maxCore: 50, gpu: 70, mem: 95 }), 'memoria');
});

test('gargalo: resumo do dia e PresentMon decidindo quando existe', () => {
  const samples = [...Array(30).fill({ cpu: 30, maxCore: 60, gpu: 99, gpuClockRatio: 0.95, mem: 40 }), ...Array(10).fill({ cpu: 40, maxCore: 99, gpu: 50, mem: 40 })];
  const summary = Bottleneck.summarize(samples);
  assert.equal(summary.verdict, 'gpu');
  assert.deepEqual(summary.limiter, { gpu: 30, 'cpu-thread': 10 });
  assert.equal(summary.gpu.saturatedShare, 0.75);
  const pm = Bottleneck.summarize(samples, { fps: { hasBusy: true, gpuBoundShare: 0.1, cpuBoundShare: 0.7, avgFps: 90 } });
  assert.equal(pm.verdict, 'cpu-thread', 'quem segurou os quadros manda mais que o contador de uso');
  assert.match(Bottleneck.explain(summary), /GPU em 95%\+ em 75% do tempo/);
});

test('sessão: GPU em 100% em clock baixo não vira "placa no limite"; RAM alta não apaga o achado da GPU', () => {
  const t0 = 1_000_000;
  const samples = Array.from({ length: 120 }, (_, i) => ({ t: t0 + i * 1000, cpu: 30, maxCore: 55, mem: 50, gpu: 99, gpuClockRatio: 0.4, gpuPowerPct: 25, temp: 60 }));
  const slow = Session.analyze({ startedAt: t0, endedAt: t0 + 120000, samples, hasGpuSensor: true });
  assert.ok(slow.findings.some((f) => f.id === 'gpu-low-clock'));
  assert.ok(!slow.findings.some((f) => f.id === 'gpu-limited'));
  assert.equal(slow.bottleneck.verdict, 'gpu-baixo-clock');
  const both = Session.analyze({ startedAt: t0, endedAt: t0 + 120000, samples: samples.map((s) => ({ ...s, gpuClockRatio: 0.97, gpuPowerPct: 90, mem: 95 })), hasGpuSensor: true });
  assert.ok(both.findings.some((f) => f.id === 'gpu-limited'));
  assert.ok(both.findings.some((f) => f.id === 'memory-pressure'));
});

test('sessão: um segundo de RAM a 96% não marca a sessão; 5 s seguidos marcam', () => {
  const t0 = 2_000_000;
  const make = (spikeSeconds) => Array.from({ length: 120 }, (_, i) => ({ t: t0 + i * 1000, cpu: 20, maxCore: 30, mem: i >= 50 && i < 50 + spikeSeconds ? 97 : 60 }));
  assert.ok(!Session.analyze({ startedAt: t0, endedAt: t0 + 120000, samples: make(1) }).findings.some((f) => f.id === 'memory-pressure'));
  assert.ok(Session.analyze({ startedAt: t0, endedAt: t0 + 120000, samples: make(6) }).findings.some((f) => f.id === 'memory-pressure'));
});

test('sessão: GPU quente não dispara o alarme de calor do processador', () => {
  const t0 = 3_000_000;
  const samples = Array.from({ length: 120 }, (_, i) => ({ t: t0 + i * 1000, cpu: 80, maxCore: 90, mem: 50, gpu: 70, temp: 65, gpuTemp: 92, clockRatio: 0.7 }));
  const report = Session.analyze({ startedAt: t0, endedAt: t0 + 120000, samples, hasGpuSensor: true });
  assert.ok(!report.findings.some((f) => f.id === 'thermal'), 'temp é a do processador (65 °C)');
});

test('FPS: "1% baixo" é a média do pior 1% (como o CapFrameX); o percentil continua como p1Fps', () => {
  const frames = [...Array(980).fill(10), ...Array(19).fill(20), 100].map((ms) => ({ ms }));
  const summary = Fps.summarize(frames);
  assert.equal(Math.round(summary.p1LowFps), Math.round(1000 / ((9 * 20 + 100) / 10)), 'média dos 10 piores quadros');
  assert.equal(Math.round(summary.p1Fps), 50, 'percentil 99');
  assert.ok(summary.p1LowFps < summary.p1Fps);
});

test('FPS: o acumulador cobre a sessão inteira (bem mais que 400 mil quadros) e bate com o cálculo exato', () => {
  const acc = Fps.createAccumulator();
  const frames = [];
  let seed = 3;
  for (let i = 0; i < 20000; i += 1) { seed = (seed * 16807) % 2147483647; const ms = 6 + (seed % 1000) / 100 + (i % 997 === 0 ? 40 : 0); frames.push({ ms, cpuBusy: 3, gpuBusy: ms * 0.95 }); acc.push(frames[i]); }
  const exact = Fps.summarize(frames);
  const streamed = acc.summary();
  for (const key of ['avgFps', 'p1LowFps', 'p01LowFps']) assert.ok(Math.abs(exact[key] - streamed[key]) / exact[key] < 0.01, `${key}: ${exact[key]} x ${streamed[key]}`);
  assert.equal(streamed.stutterCount, exact.stutterCount);
  assert.ok(Math.abs(streamed.gpuBoundShare - exact.gpuBoundShare) < 1e-9);
  const long = Fps.createAccumulator();
  for (let i = 0; i < 700000; i += 1) long.push({ ms: i < 400000 ? 4 : 16 });
  const result = long.summary();
  assert.equal(result.frames, 700000);
  assert.ok(result.avgFps < 150, 'o fim da sessão (16 ms) entrou na média');
  assert.ok(long.series().length > 0 && long.series().length <= 7200);
});

test('cérebro: a régua do clock acompanha a carga e esquece turbo de um núcleo e leitura absurda', () => {
  const brain = Brain.create(null);
  const t0 = Date.UTC(2026, 10, 1);
  brain.ingest({ t: t0, cpu: 20, mem: 40, clock: 5800 }); // turbo de um núcleo, sem carga: não vira régua
  brain.ingest({ t: t0 + 60000, cpu: 90, mem: 40, clock: 99999 }); // leitura absurda
  for (let i = 0; i < 30; i += 1) brain.ingest({ t: t0 + (i + 2) * 60000, cpu: 85, mem: 40, clock: 4200 + (i % 3) * 10 });
  assert.ok(Math.abs(brain.referenceClock() - 4220) <= 20, String(brain.referenceClock()));
  assert.ok(brain.clockRatio(4200) > 0.95, 'todos os núcleos a 4,2 GHz não é "queda de clock"');
  const saved = Brain.create({ ...brain.serialize(), maxClock: 5800 });
  assert.ok(saved.clockRatio(4200) > 0.95, 'o maxClock antigo (que só subia) é descartado');
});

test('jogo com caminho protegido (anticheat): tela cheia conta; navegador em tela cheia, não', () => {
  assert.equal(Session.classifyForeground({ name: 'FortniteClient-Win64-Shipping', path: null, fullscreen: true }).isGame, true);
  assert.equal(Session.classifyForeground({ name: 'FortniteClient-Win64-Shipping', path: null, fullscreen: false }).isGame, false);
  assert.equal(Session.classifyForeground({ name: 'chrome', path: null, fullscreen: true }).isGame, false);
  assert.equal(Session.classifyForeground({ name: 'vlc', path: null, fullscreen: true }).isGame, false);
  const byName = Object.assign(() => null, { byName: (name) => (name === 'valorant' ? { id: 'riot-1', name: 'VALORANT' } : null) });
  const sample = normalizeProbe({ t: 1, fg: { pid: 10, name: 'valorant', path: null }, cpu: [], gpu: [{ pid: 10, name: 'valorant', util: 90, engine: '3D', d3: 90 }] }, byName);
  assert.equal(sample.fg.isGame, true);
  assert.equal(sample.fg.gameId, 'riot-1');
  assert.equal(sample.gpu[0].engine, '3D');
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test('A21: observador que falha ao abrir não fica preso como "rodando" e tenta de novo (com limite)', () => {
  const children = [];
  const timers = [];
  const problems = [];
  const watcher = Watch.createWatcher({ platform: 'win32', spawnFn: () => { const c = fakeChild(); children.push(c); return c; }, onProblem: (kind) => problems.push(kind), setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  watcher.start();
  assert.equal(watcher.isRunning(), true);
  children[0].emit('error', Object.assign(new Error('não achei'), { code: 'ENOENT' }));
  assert.equal(watcher.isRunning(), false, 'error sem exit limpa a referência');
  children[0].emit('exit', 1); // exit depois do error: não conta duas vezes
  assert.deepEqual(problems, ['caiu']);
  timers.at(-1)(); // a nova tentativa
  assert.equal(children.length, 2);
  assert.equal(watcher.isRunning(), true);
  for (let i = 0; i < 6; i += 1) { children.at(-1).emit('exit', 1); if (timers.length) timers.at(-1)(); }
  assert.ok(problems.includes('desistiu'));
  assert.equal(watcher.state(), 'falhou');
  watcher.stop();
  const count = children.length;
  watcher.start();
  assert.equal(children.length, count + 1, 'ligar de novo à mão funciona');
  watcher.stop();
  children.at(-1).stdout.write('{"pid":5,"name":"x","path":"C:\\\\steamapps\\\\common\\\\x.exe"}\n');
  assert.equal(watcher.current(), null, 'linha de um processo que já não é o atual é ignorada');
});

test('A26: o jogo é reconhecido na segunda leitura (o script manda a confirmação no ciclo seguinte)', () => {
  assert.match(Watch.WATCH_SCRIPT, /\$confirm/);
  const events = [];
  const logic = Watch.createWatchLogic({ match: () => ({ id: 'g', name: 'Jogo' }), alive: () => true, onStart: (game) => events.push(game.name) });
  logic.feed({ pid: 42, name: 'jogo', path: 'C:\\Jogos\\jogo.exe' });
  assert.equal(events.length, 0, 'uma leitura só não basta (troca rápida de janela)');
  logic.feed({ pid: 42, name: 'jogo', path: 'C:\\Jogos\\jogo.exe' });
  assert.deepEqual(events, ['Jogo']);
});

test('A22: no Linux, leitura que termina depois de parar não emite nem reconstrói estado', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const linux = { foreground: () => pending, processSample: async () => new Map() };
  const emitted = [];
  const probe = createLinuxProbe({ linux, emit: (sample) => emitted.push(sample), interval: 60000 });
  probe.start();
  probe.stop();
  release({ pid: 7, name: 'jogo', path: '/home/x/.steam/steamapps/common/jogo' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(emitted.length, 0);
  const starts = [];
  let releaseFg;
  const linux2 = { foreground: () => new Promise((resolve) => { releaseFg = resolve; }) };
  const watcher = Watch.createLinuxWatcher({ linux: linux2, match: () => ({ id: 'g', name: 'Jogo' }), alive: () => true, onStart: (game) => starts.push(game), interval: 60000 });
  watcher.start();
  const tick = watcher._tick();
  watcher.stop();
  releaseFg({ pid: 9, name: 'jogo', path: '/jogos/jogo' });
  await tick;
  assert.equal(watcher.current(), null);
  assert.equal(starts.length, 0);
});
