const test = require('node:test');
const assert = require('node:assert/strict');
const Session = require('../src/session.js');
const Fps = require('../src/fps.js');

// ---------- gerador de sessões sintéticas (1 Hz) ----------
function build({ seconds = 300, cpu = 20, maxCore = 40, gpu = null, mem = 50, temp = 60, clockRatio = 1, game = true, jitter = 3, shape = null } = {}) {
  let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const startedAt = 1_700_000_000_000; const samples = []; const probes = [];
  const v = (base, i) => Math.max(0, Math.min(100, base + (rnd() - 0.5) * 2 * jitter));
  for (let i = 0; i < seconds; i++) {
    const over = shape ? shape(i) : {};
    samples.push({ t: startedAt + i * 1000, cpu: v(over.cpu ?? cpu, i), maxCore: v(over.maxCore ?? maxCore, i), gpu: (over.gpu ?? gpu) === null ? null : v(over.gpu ?? gpu, i), mem: v(over.mem ?? mem, i), temp: over.temp ?? temp, clockRatio: over.clockRatio ?? clockRatio });
  }
  for (let i = 0; i < seconds; i += 5) {
    probes.push({ t: startedAt + i * 1000, fg: game ? { name: 'GameX', isGame: true } : { name: 'Code', isGame: false }, cpu: [{ name: 'GameX', cpu: 18 }], gpu: [{ name: 'GameX', util: 95 }] });
  }
  return { startedAt, endedAt: startedAt + seconds * 1000, samples, probes, hasGpuSensor: gpu !== null };
}
const ids = (report) => report.findings.map((f) => f.id);

test('detecção de jogo: só por pasta de biblioteca, nunca por suposição', () => {
  assert.equal(Session.classifyForeground({ name: 'eldenring', path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\ELDEN RING\\Game\\eldenring.exe' }).isGame, true);
  assert.equal(Session.classifyForeground({ name: 'VALORANT-Win64-Shipping', path: 'C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe' }).isGame, true);
  assert.equal(Session.classifyForeground({ name: 'steam', path: 'C:\\Program Files (x86)\\Steam\\steam.exe' }).isGame, false);
  assert.equal(Session.classifyForeground({ name: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }).isGame, false);
  assert.equal(Session.classifyForeground({ name: 'EpicGamesLauncher', path: 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe' }).isGame, false);
  assert.equal(Session.classifyForeground({ name: 'semcaminho' }).isGame, false);
  assert.equal(Session.classifyForeground(null).isGame, false);
});

test('GPU no limite com CPU folgada: achado de GPU, não de CPU, e limite honesto sem FPS', () => {
  const report = Session.analyze({ ...build({ cpu: 30, maxCore: 62, gpu: 98 }), profile: 'jogos' });
  assert.ok(ids(report).includes('gpu-limited'));
  assert.ok(!ids(report).includes('cpu-thread-limited'));
  assert.equal(report.game.name, 'GameX');
  const gpu = report.findings.find((f) => f.id === 'gpu-limited');
  assert.match(gpu.limits.join(' '), /Sem FPS/);
  assert.ok(ids(report).includes('no-fps'));
});

test('um núcleo no limite com GPU folgada: achado de thread principal', () => {
  const report = Session.analyze({ ...build({ cpu: 24, maxCore: 99, gpu: 55, jitter: 0.5 }), profile: 'jogos' });
  assert.ok(ids(report).includes('cpu-thread-limited'));
  assert.ok(!ids(report).includes('gpu-limited'));
});

test('sem sensor de GPU, o achado de thread tem menos confiança', () => {
  const withGpu = Session.analyze(build({ cpu: 24, maxCore: 99, gpu: 55, jitter: 0.5 })).findings.find((f) => f.id === 'cpu-thread-limited');
  const without = Session.analyze(build({ cpu: 24, maxCore: 99, gpu: null, jitter: 0.5 })).findings.find((f) => f.id === 'cpu-thread-limited');
  assert.ok(without.confidence < withGpu.confidence);
});

test('programa em segundo plano pesado e GPU compartilhada são apontados pelo nome', () => {
  const data = build({ cpu: 40, maxCore: 60, gpu: 60 });
  data.probes.forEach((probe, i) => { probe.cpu = [{ name: 'GameX', cpu: 18 }, { name: 'chrome', cpu: 22 }]; probe.gpu = [{ name: 'GameX', util: 60 }, { name: 'obs64', util: 30 }]; });
  const report = Session.analyze({ ...data, profile: 'trabalho' });
  assert.match(report.findings.find((f) => f.id === 'background-load').title, /chrome/);
  assert.match(report.findings.find((f) => f.id === 'gpu-other-process').title, /obs64/);
});

test('memória no limite por boa parte do tempo vira achado crítico', () => {
  const report = Session.analyze(build({ mem: 95, jitter: 1, game: false }));
  assert.equal(report.findings.find((f) => f.id === 'memory-pressure').severity, 'bad');
});

test('calor e queda de clock sob carga: achado térmico com ressalva', () => {
  const report = Session.analyze(build({ cpu: 20, shape: (i) => (i >= 100 && i < 140 ? { temp: 93, cpu: 92, clockRatio: 0.6 } : {}) }));
  const thermal = report.findings.find((f) => f.id === 'thermal');
  assert.ok(thermal);
  assert.match(thermal.limits.join(' '), /indício/);
});

test('sessão tranquila: "nenhum gargalo evidente", sem inventar problema', () => {
  const report = Session.analyze(build({ cpu: 18, maxCore: 35, gpu: 40, mem: 45, temp: 58 }));
  assert.deepEqual(ids(report).filter((id) => !['ok', 'no-fps'].includes(id)), []);
  assert.match(report.conclusion, /Nenhum gargalo evidente/);
  assert.match(report.limits, /Sem FPS|sem FPS/);
});

test('sessão curta é inconclusiva', () => {
  const report = Session.analyze(build({ seconds: 8 }));
  assert.deepEqual(ids(report), ['too-short']);
});

test('o perfil muda a ordem dos achados, não o que existe', () => {
  const data = build({ cpu: 30, maxCore: 62, gpu: 98, mem: 95, jitter: 1 });
  const jogos = Session.analyze({ ...data, profile: 'jogos' }).findings.map((f) => f.id);
  const trabalho = Session.analyze({ ...data, profile: 'trabalho' }).findings.map((f) => f.id);
  assert.deepEqual([...jogos].sort(), [...trabalho].sort());
  assert.ok(trabalho.indexOf('memory-pressure') < trabalho.indexOf('gpu-limited'));
});

test('linha do tempo compacta reduz 300 s a 60 buckets', () => {
  const data = build({ cpu: 50 });
  const timeline = Session.compactTimeline(data.samples, data.startedAt, 5);
  assert.equal(timeline.length, 60);
  assert.equal(timeline[1].s, 5);
});

// ---------- FPS ----------
const header2 = 'Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,CPUStartTime,MsCPUBusy,MsCPUWait,MsGPULatency,MsGPUTime,MsGPUBusy,MsGPUWait,DisplayedTime,MsBetweenPresents';
const row2 = (ms, cpuBusy, gpuBusy, displayed = ms) => `GameX.exe,1234,0x1,DXGI,0,0,1,Hardware: Independent Flip,1.0,${cpuBusy},1,1,${gpuBusy},${gpuBusy},0,${displayed},${ms}`;

test('FPS: lê por nome de coluna, ignora BOM e NA, e resume corretamente', () => {
  const parser = Fps.createFrameParser();
  assert.equal(parser.push('\uFEFF' + header2), null);
  assert.equal(parser.ready, true);
  const frames = [];
  for (let i = 0; i < 600; i++) frames.push(parser.push(row2(8, 3, 7.5)));
  for (let i = 0; i < 20; i++) frames.push(parser.push(row2(80, 4, 20, 'NA')));
  assert.ok(frames.every(Boolean));
  assert.equal(frames[0].ms, 8);
  assert.equal(frames[610].dropped, true);
  const summary = Fps.summarize(frames);
  assert.ok(summary.avgFps > 90 && summary.avgFps < 105, `avg ${summary.avgFps}`);
  assert.ok(summary.p1LowFps < 20, `1% low ${summary.p1LowFps}`);
  assert.equal(summary.stutterCount, 20);
  assert.ok(summary.gpuBoundShare > 0.9, 'quadros de 8 ms com GPU ocupada 7,5 ms');
  assert.ok(Math.abs(summary.droppedShare - 20 / 620) < 1e-9);
});

test('FPS: formato antigo (1.x), linhas inválidas e poucos quadros', () => {
  const parser = Fps.createFrameParser();
  parser.push('Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,Dropped,TimeInSeconds,MsBetweenPresents,MsBetweenDisplayChange');
  const ok = parser.push('game.exe,10,0x1,DXGI,1,0,0,Composed,0,1.0,16.6,16.6');
  assert.equal(ok.ms, 16.6);
  assert.equal(parser.push('game.exe,10,0x1,DXGI,1,0,0,Composed,1,1.0,NA,16.6'), null);
  assert.equal(parser.push('lixo sem sentido'), null);
  assert.equal(Fps.summarize([ok]), null);
});

test('FPS: janela deslizante e série por segundo', () => {
  const rolling = Fps.createRolling(1000);
  for (let i = 0; i < 200; i++) rolling.push({ ms: 10 });
  assert.ok(Math.abs(rolling.snapshot().fps - 100) < 1);
  const series = Fps.perSecond(Array.from({ length: 300 }, () => ({ ms: 10 })));
  assert.equal(series.length, 3);
  assert.ok(Math.abs(series[0] - 100) < 0.5);
});

test('FPS e sessão: com FPS medido, o achado de queda de quadros aparece e o limite some', () => {
  const frames = [...Array.from({ length: 600 }, () => ({ ms: 8 })), ...Array.from({ length: 20 }, () => ({ ms: 90 }))];
  const fps = Fps.summarize(frames);
  const report = Session.analyze({ ...build({ cpu: 30, maxCore: 60, gpu: 70 }), fps });
  assert.ok(ids(report).includes('fps-stutter'));
  assert.ok(!ids(report).includes('no-fps'));
  assert.match(report.limits, /FPS do programa/);
});
