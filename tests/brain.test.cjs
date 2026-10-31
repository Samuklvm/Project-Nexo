const test = require('node:test');
const assert = require('node:assert/strict');
const Brain = require('../src/brain.js');

const MIN = 60000, DAY = 86400000;
// Semana simulada: 10 dias, 1 amostra por minuto, hora local.
function simulate() {
  const brain = Brain.create();
  const history = [];
  const start = new Date(2026, 9, 1, 0, 0, 0).getTime();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 10 * 24 * 60; i++) {
    const t = start + i * MIN; const d = new Date(t); const h = d.getHours(); const day = Math.floor(i / 1440);
    let cpu = 12 + rnd() * 8; let mem = 45 + rnd() * 4; let culprit = null;
    if (h >= 20 && h < 23) { cpu = 62 + rnd() * 8; mem = 60 + rnd() * 3; }          // rotina: jogos à noite
    if (day === 8 && h === 14 && d.getMinutes() < 25) { cpu = 96 + rnd() * 3; culprit = 'chrome'; } // lentidão pontual
    if (day === 9 && h === 14 && d.getMinutes() < 20) { cpu = 97; culprit = 'chrome'; }
    const disk = 60 + (i / 1440) * 1.5 + rnd() * 0.1;
    const sample = { t, cpu, mem, disk, gpu: null, temp: 55 + rnd() * 5, culprit };
    brain.ingest(sample); history.push(sample);
  }
  return { brain, history, end: start + 10 * DAY };
}

test('detecta episódios de CPU e atribui o culpado', () => {
  const { brain, end } = simulate();
  const eps = brain.recentEpisodes(30 * DAY, end, ['cpu']);
  assert.ok(eps.length >= 2, `esperava ≥2 episódios, veio ${eps.length}`);
  assert.equal(eps[0].culprit, 'chrome');
  assert.ok(eps[0].minutes >= 15 && eps[0].minutes <= 30);
  const ledger = brain.ledger();
  assert.equal(ledger[0].name, 'chrome');
  assert.ok(ledger[0].events >= 2);
});

test('rotina noturna normal não vira episódio', () => {
  const { brain, end } = simulate();
  const night = brain.recentEpisodes(30 * DAY, end, ['cpu']).filter((e) => { const h = new Date(e.start).getHours(); return h >= 20 && h < 23; });
  assert.equal(night.length, 0);
});

test('mapa de hábitos mostra o pico das 20h–22h', () => {
  const { brain } = simulate();
  const { grid } = brain.habitGrid('cpu');
  const evening = grid[1][21], morning = grid[1][9];
  assert.ok(evening > 55 && morning < 25, `noite ${evening}, manhã ${morning}`);
});

test('previsão de disco aponta cerca de 16,7 dias (25 pontos restantes a 1,5/dia)', () => {
  const { history, end } = simulate();
  const f = Brain.forecastDisk(history, end);
  assert.ok(f && f.daysToFull, 'sem previsão');
  assert.ok(f.daysToFull > 15 && f.daysToFull < 18.5, `dias ${f.daysToFull}`);
  assert.ok(f.r2 > 0.9);
});

test('índice cai com memória alta e explica por quê', () => {
  const { brain, history, end } = simulate();
  const calm = Brain.healthScore({ now: end, history, brain, cpu: 10, mem: 45, disk: 75, temp: 56, uptimeSeconds: 3600 });
  const stressed = Brain.healthScore({ now: end, history: history.map((s) => ({ ...s, mem: 95 })), brain, cpu: 40, mem: 95, disk: 96, temp: 88, uptimeSeconds: 40 * 86400 });
  assert.ok(calm.score >= 85, `calmo ${calm.score}`);
  assert.ok(stressed.score <= 55, `estressado ${stressed.score}`);
  assert.equal(stressed.factors[0].status, 'bad');
});

test('serialização preserva o aprendizado', () => {
  const { brain, end } = simulate();
  const copy = Brain.create(JSON.parse(JSON.stringify(brain.serialize())));
  assert.equal(copy.learning(end).minutes, brain.learning(end).minutes);
  assert.equal(copy.ledger()[0].name, 'chrome');
});

test('insights: culpado recorrente e confiança ajustada por feedback', () => {
  const { brain, history, end } = simulate();
  const ctx = { now: end, brain, history, snapshot: { cpuUsage: 20, memoryPercent: 50, primaryDrive: { usedPercent: 75, driveLetter: 'C', freeBytes: 1e11 }, uptimeSeconds: 100 } };
  const base = Brain.buildInsights(ctx).find((i) => i.id === 'culprit');
  assert.ok(base, 'sem insight de culpado');
  const bad = Array.from({ length: 6 }, () => ({ category: 'culprit', helpful: false }));
  const lowered = Brain.buildInsights({ ...ctx, feedback: bad }).find((i) => i.id === 'culprit');
  assert.ok(lowered.confidence < base.confidence);
});

test('limpa o estado com reset', () => {
  const { brain, end } = simulate();
  brain.reset();
  assert.equal(brain.learning(end).minutes, 0);
  assert.equal(brain.ledger().length, 0);
});
