'use strict';
// Memória eterna do Cortex (src/cortex/memory.cjs). O node:sqlite ainda imprime um aviso "experimental" no Node 22:
// silenciamos só esse, para a saída dos testes ficar limpa; os demais avisos continuam aparecendo.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemory } = require('../src/cortex/memory.cjs');

const MIN = 60000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-cortex-')); }
function open(extra = {}) {
  const dir = extra.dir || tmp();
  const clock = { t: T0 };
  const r = createMemory({ dir, now: () => clock.t, ...extra });
  assert.equal(r.ok, true, r.error);
  return { memory: r.memory, dir, clock };
}
const minute = (t, cpu = 10) => ({ t, cpu, mem: 40, disk: 5, gpu: 0, temp: 50, cpuTemp: 55, clock: 3000, clockRatio: 1, culprit: null });

test('grava e lê minutos depois do flush', () => {
  const { memory } = open();
  memory.addMinute(minute(T0 - 3 * MIN));
  memory.addMinute(minute(T0 - 2 * MIN));
  memory.addMinute(minute(T0 - 1 * MIN));
  memory.flush();
  const rows = memory.minutes({ from: T0 - 10 * MIN, to: T0 });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.t), [T0 - 3 * MIN, T0 - 2 * MIN, T0 - 1 * MIN]);
  memory.close();
});

test('minuto do futuro não entra', () => {
  const { memory } = open();
  memory.addMinute(minute(T0 + 6 * MIN));
  memory.flush();
  assert.equal(memory.minutes({ from: 0, to: T0 + DAY }).length, 0);
  memory.close();
});

test('tabelas eternas recusam UPDATE e DELETE', () => {
  const { memory } = open();
  memory.addMinute(minute(T0 - MIN));
  memory.addEvent({ kind: 'k', at: T0, data: { a: 1 } });
  memory.addMachine({ cpu: 'x' });
  memory.record('pensamento', { data: { t: 'oi' } });
  memory.flush();
  const db = memory._db;
  for (const tabela of ['registros', 'minutos', 'eventos', 'maquina']) {
    assert.throws(() => db.exec(`DELETE FROM ${tabela}`), /memoria eterna/, `DELETE ${tabela}`);
    const col = tabela === 'minutos' ? 'cpu=1' : tabela === 'maquina' ? "data='x'" : "kind='x'";
    assert.throws(() => db.exec(`UPDATE ${tabela} SET ${col}`), /memoria eterna/, `UPDATE ${tabela}`);
  }
  memory.camera.put('s1', [{ t: T0, v: 1 }]);
  assert.doesNotThrow(() => db.exec('DELETE FROM camera'));
  memory.close();
});

test('record encadeia versões', () => {
  const { memory } = open();
  const a = memory.record('crenca', { inv: 1, data: { p: 0.3 } });
  const b = memory.record('crenca', { inv: 1, prev: a, data: { p: 0.6 } });
  assert.ok(b > a);
  assert.equal(memory.latest('crenca', { inv: 1 }).data.p, 0.6);
  assert.equal(memory.latest('crenca', { inv: 1 }).prev, a);
  assert.equal(memory.list('crenca', { inv: 1 }).length, 2);
  assert.equal(memory.latest('crenca', { inv: 2 }), null);
  memory.close();
});

test('addMachine não duplica retrato igual', () => {
  const { memory } = open();
  memory.addMachine({ a: 1, b: 2 });
  memory.addMachine({ b: 2, a: 1 }); // mesma coisa em outra ordem de chaves
  memory.addMachine({ a: 1, b: 3 });
  memory.flush();
  assert.equal(memory._db.prepare('SELECT COUNT(*) n FROM maquina').get().n, 2);
  memory.close();
});

test('câmera: cite copia trecho e prune nunca apaga trecho', () => {
  const { memory, clock } = open({ cameraMaxBytes: 1000 });
  const big = (s, n) => Array.from({ length: n }, (_, i) => ({ t: T0 + s * 100000 + i * 1000, blob: 'x'.repeat(200) }));
  memory.camera.put('s1', big(0, 20));
  clock.t += 1000;
  memory.camera.put('s2', big(1, 20));
  memory.camera.put('s3', big(2, 20));
  const id = memory.camera.cite('s1', T0 + 2000, T0 + 5000);
  const antes = memory.latest('trecho', {});
  assert.equal(antes.id, id);
  assert.equal(antes.data.samples.length, 4);
  memory.camera.prune();
  const restam = memory._db.prepare('SELECT COUNT(DISTINCT session) n FROM camera').get().n;
  assert.ok(restam < 3, 'prune removeu sessões da câmera');
  const depois = memory.latest('trecho', {});
  assert.deepEqual(depois.data.samples, antes.data.samples);
  memory.close();
});

test('backup diário guarda só 3', async () => {
  const { memory, dir, clock } = open();
  memory.record('pensamento', { data: { t: 1 } });
  for (let i = 0; i < 5; i++) {
    const f = await memory.backupDaily();
    assert.ok(typeof f === 'string' && fs.existsSync(f));
    assert.equal(await memory.backupDaily(), null, 'segunda chamada no mesmo dia');
    clock.t += DAY;
  }
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 3);
  memory.close();
});

test('importLegacy é idempotente', () => {
  const { memory } = open();
  const history = Array.from({ length: 100 }, (_, i) => minute(T0 - (i + 1) * MIN));
  assert.equal(memory.importLegacy({ history, brain: { x: 1 } }).imported, 100);
  assert.equal(memory.importLegacy({ history, brain: { x: 1 } }).imported, 0);
  const rows = memory.minutes({ from: 0, to: T0 });
  assert.equal(rows.length, 100);
  assert.equal(memory._db.prepare("SELECT COUNT(*) n FROM minutos WHERE origem='importado'").get().n, 100);
  memory.close();
});

test('arquivo corrompido não derruba', () => {
  // sem backup: devolve ok:false
  const dir1 = tmp();
  fs.writeFileSync(path.join(dir1, 'memoria.db'), 'isto não é um banco sqlite, é lixo '.repeat(50));
  const r1 = createMemory({ dir: dir1, now: () => T0 });
  assert.equal(r1.ok, false);
  assert.equal(typeof r1.error, 'string');

  // com backup: renomeia, restaura e abre
  return (async () => {
    const { memory, dir, clock } = open();
    memory.record('pensamento', { data: { t: 'guardado' } });
    await memory.backupDaily();
    memory.close();
    fs.writeFileSync(path.join(dir, 'memoria.db'), 'lixo '.repeat(1000));
    for (const ext of ['-wal', '-shm']) fs.rmSync(path.join(dir, 'memoria.db' + ext), { force: true });
    const r = createMemory({ dir, now: () => clock.t });
    assert.equal(r.ok, true, r.error);
    assert.ok(fs.readdirSync(dir).some((f) => /^memoria\.corrompido-\d+\.db$/.test(f)));
    assert.equal(r.memory.latest('pensamento', {}).data.t, 'guardado');
    r.memory.close();
  })();
});

test('consulta de um dia em 500 mil minutos < 200 ms', () => {
  const { memory } = open();
  const db = memory._db;
  const ins = db.prepare('INSERT INTO minutos (t,cpu,mem,disk,gpu,temp,cpuTemp,clock,clockRatio,culprit,origem) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const base = T0 - 500000 * MIN;
  db.exec('BEGIN');
  for (let i = 0; i < 500000; i++) ins.run(base + i * MIN, 10, 40, 5, 0, 50, 55, 3000, 1, null, 'vivo');
  db.exec('COMMIT');
  const t0 = process.hrtime.bigint();
  const rows = memory.minutes({ from: T0 - 2 * DAY, to: T0 - DAY });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(rows.length >= 1440 - 1 && rows.length <= 1441);
  assert.ok(ms < 200, `levou ${ms.toFixed(1)} ms`);
  memory.close();
});
