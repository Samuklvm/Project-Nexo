/*
 * Parte 4: backup dos drivers (pnputil /export-driver) e restauração, numa pasta dos Documentos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('../electron/driver-backup.cjs');

const ROOT = 'C:\\Users\\sam\\Documents\\Nexo\\Backup de drivers';
test('backup: nome da pasta pela data e hora, e só nomes do próprio Nexo', () => {
  assert.equal(B.stampName(new Date(2026, 10, 18, 9, 5)), '2026-11-18 09h05');
  assert.equal(B.validName('2026-11-18 09h05'), true);
  assert.equal(B.validName('2026-11-18 09h05 (2)'), true);
  for (const bad of ['..', '..\\x', 'C:\\x', '2026-11-18 09h05\\..', '', 'qualquer']) assert.equal(B.validName(bad), false, bad);
});

test('backup: corpo de administrador exporta com pnputil só dentro da pasta de backups', () => {
  const body = B.driverBackupBody({ dest: `${ROOT}\\2026-11-18 09h05`, root: ROOT });
  assert.match(body, /pnputil\.exe \/export-driver \* 'C:\\Users\\sam\\Documents\\Nexo\\Backup de drivers\\2026-11-18 09h05'/);
  assert.match(body, /-Filter '\*\.inf'/);
  assert.match(body, /\$NexoOut|WRITE|ConvertTo-Json/);
  assert.throws(() => B.driverBackupBody({ dest: 'C:\\Windows\\x', root: ROOT }), /pasta/);
  assert.throws(() => B.driverBackupBody({ dest: `${ROOT}\\..\\x`, root: ROOT }), /pasta/);
  const restore = B.driverRestoreBody({ dir: `${ROOT}\\2026-11-18 09h05`, root: ROOT });
  assert.match(restore, /pnputil\.exe \/add-driver \(Join-Path 'C:\\Users\\sam\\Documents\\Nexo\\Backup de drivers\\2026-11-18 09h05' '\*\.inf'\) \/subdirs \/install/);
  assert.match(restore, /@\(0, 3010, 259\) -contains \$r\.code/);
  assert.throws(() => B.driverRestoreBody({ dir: 'D:\\outro', root: ROOT }), /pasta/);
});

test('backup: criar, listar (mais novo primeiro), restaurar e abrir', async () => {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-docs-'));
  const root = path.join(docs, 'Nexo', 'Backup de drivers');
  const calls = [];
  let t = new Date(2026, 10, 18, 9, 5).getTime();
  const backups = B.createDriverBackups({
    fs: require('node:fs/promises'), path, root: () => root, now: () => t,
    openPath: async (p) => { calls.push(['open', p]); return ''; },
    elevate: async (task, args) => {
      calls.push([task, args]);
      if (task === 'driver-backup') { fs.mkdirSync(args.dest, { recursive: true }); fs.writeFileSync(path.join(args.dest, 'a.inf'), ''); return { result: { ok: true, code: 0, count: 42 } }; }
      return { result: { ok: true, code: 3010 } };
    }
  });
  const made = await backups.create();
  assert.deepEqual(made, { ok: true, name: '2026-11-18 09h05', count: 42, note: '' });
  t += 60 * 1000;
  const again = await backups.create();
  assert.equal(again.name, '2026-11-18 09h06');
  const list = await backups.list();
  assert.deepEqual(list.map((b) => [b.name, b.count]), [['2026-11-18 09h06', 42], ['2026-11-18 09h05', 42]]);
  assert.ok(list[0].at > list[1].at);
  const restored = await backups.restore('2026-11-18 09h05');
  assert.deepEqual(restored, { ok: true, restart: true, note: '' });
  await assert.rejects(backups.restore('..\\Windows'), /backup/);
  await assert.rejects(backups.restore('2020-01-01 00h00'), /backup/);
  await backups.open('2026-11-18 09h05');
  assert.deepEqual(calls.at(-1), ['open', path.join(root, '2026-11-18 09h05')]);
  const declined = B.createDriverBackups({ fs: require('node:fs/promises'), path, root: () => root, now: () => t + 120000, elevate: async () => ({ declined: true }) });
  assert.deepEqual(await declined.create(), { ok: false, name: null, count: 0, note: 'Você recusou a permissão de administrador.' });
});
