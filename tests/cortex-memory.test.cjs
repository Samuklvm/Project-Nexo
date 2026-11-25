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

test('backup(destino): cópia com as mesmas contagens, sem tocar a memória viva e sem escrever em cima dela', async () => {
  const { memory, dir } = open();
  memory.record('pensamento', { data: { t: 1 } });
  memory.record('pensamento', { data: { t: 2 } });
  const destino = path.join(dir, 'copia.db');
  assert.equal(await memory.backup(destino), destino);
  const { DatabaseSync } = require('node:sqlite');
  const copia = new DatabaseSync(destino);
  const viva = memory._db.prepare('SELECT COUNT(*) n FROM registros').get().n;
  assert.equal(copia.prepare('SELECT COUNT(*) n FROM registros').get().n, viva);
  copia.close();
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.parcial')).length, 0, 'sem sobra de arquivo parcial');
  await assert.rejects(memory.backup(memory.file), /memória viva/);
  await assert.rejects(memory.backup(path.join(dir, 'nao-existe', 'x.db')));
  assert.equal(memory._db.prepare('SELECT COUNT(*) n FROM registros').get().n, viva, 'a memória viva segue intacta');
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

// ---- falhas de disco/trava: nada se perde em silêncio e nada derruba quem chama ----
const { DatabaseSync } = require('node:sqlite');

function travar(dir) {
  const outro = new DatabaseSync(path.join(dir, 'memoria.db'));
  outro.exec('BEGIN IMMEDIATE'); // segura a escrita
  return { soltar() { outro.exec('ROLLBACK'); outro.close(); } };
}

test('flush que falha devolve o lote à fila e tenta de novo depois', () => {
  const { memory, dir } = open({ busyMs: 30 });
  const trava = travar(dir);
  memory.addMinute(minute(T0 - 2 * MIN));
  memory.addMachine({ a: 1 });
  assert.doesNotThrow(() => memory.flush());
  const h = memory.health();
  assert.equal(h.ok, false);
  assert.ok(h.lastError);
  trava.soltar();
  memory.flush();
  assert.equal(memory.minutes({ from: 0, to: T0 }).length, 1);
  assert.equal(memory._db.prepare('SELECT COUNT(*) n FROM maquina').get().n, 1);
  assert.equal(memory.health().ok, true);
  // o retrato igual continua sem duplicar depois da recuperação
  memory.addMachine({ a: 1 });
  memory.flush();
  assert.equal(memory._db.prepare('SELECT COUNT(*) n FROM maquina').get().n, 1);
  memory.close();
});

test('escritas síncronas não lançam com o banco travado', () => {
  const { memory, dir } = open({ busyMs: 30 });
  const trava = travar(dir);
  assert.equal(memory.addEvent({ kind: 'k', at: T0, data: {} }), -1);
  assert.equal(memory.record('pensamento', { data: {} }), -1);
  assert.doesNotThrow(() => memory.camera.put('s', [{ t: T0 }]));
  assert.doesNotThrow(() => memory.setMeta('a', 'b'));
  assert.deepEqual(memory.importLegacy({ history: [minute(T0 - MIN)] }), { ok: false, imported: 0 });
  assert.doesNotThrow(() => memory.minutes({ from: 0, to: T0 }));
  assert.equal(memory.health().ok, false);
  trava.soltar();
  assert.ok(memory.record('pensamento', { data: {} }) > 0);
  assert.equal(memory.health().ok, true);
  memory.close();
});

test('banco travado na abertura não é tratado como corrompido', async () => {
  const { memory, dir, clock } = open();
  memory.record('pensamento', { data: { t: 1 } });
  await memory.backupDaily();
  memory.close();
  const outro = new DatabaseSync(path.join(dir, 'memoria.db'));
  outro.exec('PRAGMA journal_mode=DELETE');
  outro.exec('BEGIN EXCLUSIVE');
  const r = createMemory({ dir, now: () => clock.t, busyMs: 30 });
  outro.exec('ROLLBACK'); outro.close();
  assert.equal(r.ok, false);
  assert.ok(!fs.readdirSync(dir).some((f) => /corrompido/.test(f)), 'não pode renomear');
  const r2 = createMemory({ dir, now: () => clock.t });
  assert.equal(r2.ok, true, r2.error);
  assert.equal(r2.memory.latest('pensamento', {}).data.t, 1);
  r2.memory.close();
});

test('erro que não é corrupção (não abre) deixa o arquivo quieto', async () => {
  const { memory, dir, clock } = open();
  await memory.backupDaily();
  memory.close();
  fs.rmSync(path.join(dir, 'memoria.db'));
  fs.mkdirSync(path.join(dir, 'memoria.db')); // pasta no lugar do arquivo: não abre
  const r = createMemory({ dir, now: () => clock.t });
  assert.equal(r.ok, false);
  assert.ok(fs.statSync(path.join(dir, 'memoria.db')).isDirectory());
  assert.ok(!fs.readdirSync(dir).some((f) => /corrompido/.test(f)));
});

test('restauração não perde nada: copia o backup antes, guarda o corrompido com o -wal e o -shm, e tenta do backup mais novo ao mais antigo', async () => {
  const { memory, dir, clock } = open();
  memory.record('pensamento', { data: { t: 'antigo' } });
  await memory.backupDaily();
  clock.t += DAY;
  memory.record('pensamento', { data: { t: 'novo' } });
  await memory.backupDaily();
  memory.close();
  const backups = fs.readdirSync(path.join(dir, 'backups')).sort();
  assert.equal(backups.length, 2);
  // O backup mais novo também estragou: vale o anterior.
  fs.writeFileSync(path.join(dir, 'backups', backups[1]), 'lixo '.repeat(1000));
  const junk = 'lixo '.repeat(1000);
  fs.writeFileSync(path.join(dir, 'memoria.db'), junk);
  for (const ext of ['-wal', '-shm']) fs.rmSync(path.join(dir, 'memoria.db' + ext), { force: true });
  const r = createMemory({ dir, now: () => clock.t });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.memory.latest('pensamento', {}).data.t, 'antigo');
  const names = fs.readdirSync(dir);
  const base = names.find((f) => /^memoria\.corrompido-\d+\.db$/.test(f));
  assert.ok(base, names.join(', '));
  assert.equal(fs.readFileSync(path.join(dir, base), 'utf8'), junk, 'o corrompido fica guardado como estava');
  assert.ok(!names.some((f) => f.includes('restaurando')), 'sem sobra da cópia de restauração');
  r.memory.close();
});

test('restauração sem nenhum backup bom: o arquivo estragado fica como estava', async () => {
  const { memory, dir } = open();
  await memory.backupDaily();
  memory.close();
  for (const f of fs.readdirSync(path.join(dir, 'backups'))) fs.writeFileSync(path.join(dir, 'backups', f), 'lixo '.repeat(1000));
  const junk = 'lixo do arquivo vivo '.repeat(100);
  fs.writeFileSync(path.join(dir, 'memoria.db'), junk);
  for (const ext of ['-wal', '-shm']) fs.rmSync(path.join(dir, 'memoria.db' + ext), { force: true });
  const r = createMemory({ dir, now: () => T0 });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(dir, 'memoria.db'), 'utf8'), junk, 'não mexeu no arquivo estragado');
  assert.ok(!fs.readdirSync(dir).some((f) => /corrompido|restaurando/.test(f)));
});

test('minuto sem hora de verdade (null, vazio, 0 ou antes de 2020) não entra, nem pela importação', () => {
  const { memory } = open();
  for (const t of [null, '', 0, undefined, Date.UTC(2019, 11, 31)]) memory.addMinute({ ...minute(T0), t });
  memory.flush();
  assert.equal(memory._db.prepare('SELECT COUNT(*) n FROM minutos').get().n, 0);
  const r = memory.importLegacy({ history: [{ ...minute(0), t: null }, { ...minute(0), t: '' }, minute(0), minute(Date.UTC(2019, 0, 1)), minute(T0 - MIN)] });
  assert.equal(r.imported, 1);
  assert.equal(memory._db.prepare('SELECT MIN(t) t FROM minutos').get().t, T0 - MIN);
  memory.close();
});

test('importLegacy: se o cérebro antigo não grava, nada é importado nem marcado (tenta de novo depois)', () => {
  const { memory } = open();
  const history = Array.from({ length: 10 }, (_, i) => minute(T0 - (i + 1) * MIN));
  const bad = memory.importLegacy({ history, brain: { x: 1n } }); // BigInt: a gravação do registro falha
  assert.equal(bad.ok, false);
  assert.equal(memory.getMeta('legado_importado'), null);
  assert.equal(memory._db.prepare('SELECT COUNT(*) n FROM minutos').get().n, 0);
  assert.equal(memory.importLegacy({ history, brain: { x: 1 } }).imported, 10);
  assert.equal(memory.list('ajuste', {}).length, 1);
  memory.close();
});

test('eventos: order "desc" traz os mais novos primeiro (o limite corta os mais antigos)', () => {
  const { memory } = open();
  for (let i = 0; i < 5; i++) memory.addEvent({ kind: 'lentidao', at: T0 + i * MIN, data: { i } });
  assert.deepEqual(memory.events({ kind: 'lentidao', limit: 2 }).map((e) => e.data.i), [0, 1]);
  assert.deepEqual(memory.events({ kind: 'lentidao', limit: 2, order: 'desc' }).map((e) => e.data.i), [4, 3]);
  memory.close();
});

test('câmera: sessões com mais de 7 dias saem; teto padrão de 50 MB; uso em disco conta o banco, o -wal e as cópias', async () => {
  const { CAMERA_MAX_BYTES, CAMERA_MAX_AGE_MS } = require('../src/cortex/memory.cjs');
  assert.equal(CAMERA_MAX_BYTES, 50 * 1024 * 1024);
  assert.equal(CAMERA_MAX_AGE_MS, 7 * DAY);
  const { memory, dir, clock } = open();
  memory.camera.put('velha', [{ t: T0 - 8 * DAY, cpu: 1 }, { t: T0 - 8 * DAY + MIN, cpu: 2 }]);
  memory.camera.put('nova', [{ t: T0 - DAY, cpu: 3 }]);
  memory.camera.prune();
  const sessions = memory._db.prepare('SELECT DISTINCT session s FROM camera').all().map((r) => r.s);
  assert.deepEqual(sessions, ['nova']);
  const live = memory.sizeBytes();
  await memory.backupDaily();
  const backup = fs.readdirSync(path.join(dir, 'backups')).reduce((n, f) => n + fs.statSync(path.join(dir, 'backups', f)).size, 0);
  assert.ok(backup > 0);
  assert.ok(memory.diskBytes() >= live + backup, `${memory.diskBytes()} < ${live} + ${backup}`);
  assert.equal(memory.lastBackupAt(), clock.t);
  memory.close();
});
