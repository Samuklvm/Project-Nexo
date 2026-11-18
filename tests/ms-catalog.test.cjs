/*
 * Parte 3: Catálogo do Microsoft Update, só para peça sem driver e sem fabricante identificável.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../electron/ms-catalog.cjs');
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'mscatalog', name), 'utf8');

test('catálogo: busca vira linhas com id, título, classificação, data e versão', () => {
  const rows = C.parseSearch(fixture('search.html'));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { id: '0a1b2c3d-1111-2222-3333-444455556666', title: 'Fabricante X - Other hardware - Leitor & Cia', products: 'Windows 10 and later drivers,Windows 10 S and Later Servicing Drivers', classification: 'Drivers (Other Hardware)', date: '2024-03-14', version: '1.2.3.4', size: '1.1 MB' });
  assert.equal(rows[1].date, '2026-09-16');
  assert.deepEqual(C.parseSearch('<html>nada</html>'), []);
});

test('catálogo: escolhe o driver mais novo para Windows 10/11 (nunca firmware nem Windows Server)', () => {
  const best = C.pickRow(C.parseSearch(fixture('search.html')));
  assert.equal(best.id, '9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff');
  assert.equal(C.pickRow([]), null);
});

test('catálogo: o link do arquivo só vale nos servidores de download da Microsoft e só .cab', () => {
  assert.equal(C.parseDownload(fixture('dialog.txt')), 'https://catalog.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/leitor_1.3.0.0_x64.cab');
  assert.equal(C.parseDownload("downloadInformation[0].files[0].url = 'https://evil.example/x.cab';"), null);
  assert.equal(C.parseDownload("downloadInformation[0].files[0].url = 'https://download.windowsupdate.com/x.exe';"), null);
  assert.equal(C.parseDownload(''), null);
});

test('catálogo: termo de busca pelo código do dispositivo (sem SUBSYS/REV) e corpo do pedido de download', () => {
  assert.equal(C.searchTerm(['PCI\\VEN_1B21&DEV_1242&SUBSYS_86751043&REV_00', 'PCI\\VEN_1B21&DEV_1242']), 'PCI\\VEN_1B21&DEV_1242');
  assert.equal(C.searchTerm(['USB\\VID_0BDA&PID_8771&REV_0200']), 'USB\\VID_0BDA&PID_8771');
  assert.equal(C.searchTerm(['ACPI\\VEN_ELAN&DEV_0001']), 'ACPI\\VEN_ELAN&DEV_0001');
  assert.equal(C.searchTerm(['ROOT\\X']), null);
  assert.equal(C.dialogBody('9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff'), 'updateIDs=%5B%7B%22size%22%3A0%2C%22languages%22%3A%22%22%2C%22uidInfo%22%3A%229f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff%22%2C%22updateID%22%3A%229f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff%22%7D%5D');
  assert.throws(() => C.dialogBody('x"]'), /id/);
});

test('catálogo: busca em segundo plano, cache de 24 h e erro não quebra nada', async () => {
  let t = 1_000_000;
  const calls = [];
  const cat = C.createMsCatalog({
    now: () => t,
    fetchText: async (url, opts = {}) => {
      calls.push([url, opts.method || 'GET']);
      if (url.includes('Search.aspx')) return fixture('search.html');
      if (url.includes('DownloadDialog.aspx')) return fixture('dialog.txt');
      throw new Error('?');
    }
  });
  const dev = { key: 'Leitor-1B21:1242', hwids: ['PCI\\VEN_1B21&DEV_1242&SUBSYS_86751043'] };
  const first = cat.lookup([dev]);
  assert.equal(first.pending, true);
  await cat.settled();
  const done = cat.lookup([dev]);
  assert.equal(done.pending, false);
  assert.deepEqual(done.items[dev.key], { title: 'Fabricante X - Other hardware - Leitor', version: '1.3.0.0', date: '2026-09-16', size: '1.2 MB', url: 'https://catalog.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/leitor_1.3.0.0_x64.cab' });
  assert.equal(calls[0][0], 'https://www.catalog.update.microsoft.com/Search.aspx?q=PCI%5CVEN_1B21%26DEV_1242');
  assert.equal(calls[1][1], 'POST');
  const n = calls.length;
  t += 23 * 3600 * 1000;
  cat.lookup([dev]);
  await cat.settled();
  assert.equal(calls.length, n, 'cache de 24 h');
  const broken = C.createMsCatalog({ now: () => t, fetchText: async () => { throw new Error('offline'); } });
  broken.lookup([dev]);
  await broken.settled();
  assert.deepEqual(broken.lookup([dev]).items, {});
  assert.deepEqual(C.createMsCatalog({ now: () => t, fetchText: async () => '' }).lookup([]), { pending: false, items: {} });
});
