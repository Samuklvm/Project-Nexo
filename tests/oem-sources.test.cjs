/*
 * Drivers dos fabricantes de PC: a lista de fontes (atualizável pelo GitHub) e o formato de cada catálogo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../electron/oem-sources.cjs');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'oem', name), 'utf8');

test('fontes: a lista valida tipos, domínios e o interruptor "disabled"', () => {
  const list = S.parseSourceList({
    version: 3,
    sources: {
      dell: { type: 'dell-catalog', index: 'https://downloads.dell.com/catalog/CatalogIndexPC.cab' },
      hp: { type: 'hpia-ref', base: 'https://hpia.hpcloud.hp.com/ref/' },
      lenovo: { type: 'lenovo-catalog', base: 'https://evil.example/catalog/' },
      asus: { type: 'evil-type', url: 'https://www.asus.com/x' },
      msi: { type: 'site-only' },
      nada: { type: 'dell-catalog', index: 'https://downloads.dell.com/x.cab' }
    },
    disabled: ['hp', 'nada', 42]
  });
  assert.deepEqual(Object.keys(list.sources).sort(), ['dell', 'hp', 'msi'], 'URL fora do domínio, tipo desconhecido e fonte que o app não conhece somem');
  assert.equal(list.sources.dell.index, 'https://downloads.dell.com/catalog/CatalogIndexPC.cab');
  assert.deepEqual(list.disabled, ['hp']);
  assert.equal(S.parseSourceList({ sources: [] }), null);
  assert.equal(S.parseSourceList('lixo'), null);
  assert.equal(S.parseSourceList({ version: 3, sources: { dell: { type: 'dell-catalog', index: 'http://downloads.dell.com/x.cab' } } }), null, 'só https (e lista sem nada válido = usa a cópia local)');
});

test('fontes: a cópia local e a do repositório são iguais e válidas', () => {
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'electron', 'drivers-fontes.json'), 'utf8'));
  const repo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'drivers', 'fontes.json'), 'utf8'));
  assert.deepEqual(local, repo);
  const list = S.parseSourceList(local);
  assert.ok(list.sources.dell && list.sources.hp && list.sources.lenovo && list.sources.asus);
  assert.equal(S.REMOTE_LIST, 'https://raw.githubusercontent.com/Samuklvm/Project-Nexo/main/docs/drivers/fontes.json');
});

test('dell: o índice acha o catálogo do modelo pelo SKU', () => {
  assert.equal(S.parseDellIndex(fixture('dell-index.xml'), '0BEB'), 'https://downloads.dell.com/FOLDER12345678M/1/0BEB_Catalog.cab');
  assert.equal(S.parseDellIndex(fixture('dell-index.xml'), '0a69'), 'https://downloads.dell.com/FOLDER87654321M/1/0A69_Catalog.cab');
  assert.equal(S.parseDellIndex(fixture('dell-index.xml'), 'FFFF'), null);
  assert.equal(S.parseDellIndex('<ManifestIndex><GroupManifest><SupportedSystems><Brand><Model systemID="0BEB"/></Brand></SupportedSystems><ManifestInformation path="//evil.example/x.cab"/></GroupManifest></ManifestIndex>', '0BEB'), null);
});

test('dell: o catálogo do modelo vira pacotes (driver com códigos, BIOS marcada, app e domínio errado fora)', () => {
  const list = S.parseDellCatalog(fixture('dell-catalog.xml'));
  assert.deepEqual(list.map((p) => p.id), ['dell-R1VKP', 'dell-7CHKN', 'dell-BIOS1']);
  const [audio, serial, bios] = list;
  assert.equal(audio.url, 'https://downloads.dell.com/FOLDER11223344M/1/Realtek-High-Definition-Audio-Driver_R1VKP_WIN64_6.0.9600.1_A05.EXE');
  assert.equal(audio.title, 'Realtek High Definition Audio Driver');
  assert.equal(audio.category, 'Audio');
  assert.equal(audio.version, 'A05');
  assert.equal(audio.driverVersion, '6.0.9600.1');
  assert.equal(audio.date, '2026-08-01');
  assert.equal(audio.md5, '0123456789abcdef0123456789abcdef');
  assert.equal(audio.size, 352718840);
  assert.equal(audio.kind, 'exe');
  assert.equal(audio.source, 'dell');
  assert.deepEqual(audio.hardwareIds, ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280BEB']);
  assert.deepEqual(serial.hardwareIds, ['PCI\\VEN_8086&DEV_7AE8&SUBSYS_0BEB1028', 'PCI\\VEN_8086&DEV_7A4C']);
  assert.equal(bios.bios, true);
  assert.ok(audio.signers.includes('Dell Inc'));
  assert.match(audio.fileName, /^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/i);
});

test('dell: catálogo quebrado ou vazio não derruba nada', () => {
  assert.deepEqual(S.parseDellCatalog('<Manifest/>'), []);
  assert.throws(() => S.parseDellCatalog('<Manifest><SoftwareComponent></Manifest>'));
});
