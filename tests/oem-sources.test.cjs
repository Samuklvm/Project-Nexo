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

test('hp: endereço da referência pelo código da placa e pela versão do Windows', () => {
  assert.equal(S.hpRefUrl('https://hpia.hpcloud.hp.com/ref/', '8870', { build: 26100 }), 'https://hpia.hpcloud.hp.com/ref/8870/8870_64_11.0.24H2.cab');
  assert.equal(S.hpRefUrl('https://hpia.hpcloud.hp.com/ref/', '8870', { build: 22631 }), 'https://hpia.hpcloud.hp.com/ref/8870/8870_64_11.0.23H2.cab');
  assert.equal(S.hpRefUrl('https://hpia.hpcloud.hp.com/ref/', '8870', { build: 19045 }), 'https://hpia.hpcloud.hp.com/ref/8870/8870_64_10.0.22H2.cab');
  assert.equal(S.hpRefUrl('https://hpia.hpcloud.hp.com/ref/', '88/70', { build: 26100 }), null);
});

test('hp: referência vira pacotes (driver com código e SHA-256, BIOS marcada, software e domínio errado fora)', () => {
  const list = S.parseHpRef(fixture('hp-ref.xml'));
  assert.deepEqual(list.map((p) => p.id), ['hp-sp173992', 'hp-sp150001']);
  const [audio, bios] = list;
  assert.equal(audio.url, 'https://ftp.hp.com/pub/softpaq/sp173501-174000/sp173992.exe');
  assert.equal(audio.driverVersion, '6.0.9977.1');
  assert.equal(audio.version, '6.0.9977.1 A 1');
  assert.equal(audio.sha256, 'a0fa0c218d33e45e934b986f6808835d81f40606125336d21720db69e30e5484');
  assert.equal(audio.date, '2026-08-14');
  assert.equal(audio.category, 'Audio');
  assert.deepEqual(audio.hardwareIds, ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0236&SUBSYS_103C8870']);
  assert.ok(audio.signers.includes('HP Inc.'));
  assert.equal(bios.bios, true);
});

test('lenovo: catálogo dá os descritores (domínio oficial) e o descritor vira pacote', () => {
  assert.equal(S.lenovoCatalogUrl('https://download.lenovo.com/catalog/', '20XW', true), 'https://download.lenovo.com/catalog/20XW_Win11.xml');
  assert.equal(S.lenovoCatalogUrl('https://download.lenovo.com/catalog/', '20XW', false), 'https://download.lenovo.com/catalog/20XW_Win10.xml');
  assert.deepEqual(S.parseLenovoCatalog(fixture('lenovo-catalog.xml')), [
    { url: 'https://download.lenovo.com/pccbbs/mobiles/n32ac12w_2_.xml', category: 'Audio' },
    { url: 'https://download.lenovo.com/pccbbs/mobiles/n32ug10w_2_.xml', category: 'BIOS/UEFI' }
  ]);
  const p = S.parseLenovoPackage(fixture('lenovo-package.xml'), 'https://download.lenovo.com/pccbbs/mobiles/n32ac12w_2_.xml', 'Audio');
  assert.equal(p.id, 'lenovo-n32ac12w');
  assert.equal(p.url, 'https://download.lenovo.com/pccbbs/mobiles/n32ac12w.exe');
  assert.equal(p.title, 'Realtek Audio Driver for Windows 11 (64-bit) - ThinkPad X1 Carbon Gen 9');
  assert.equal(p.version, '6.0.9600.1');
  assert.equal(p.driverVersion, '6.0.9600.1');
  assert.equal(p.sha256, '5d78d22b9672744dff73ef810c1a033423dc39dcfc895fb05289f65a8f88c1bf');
  assert.equal(p.size, 384245120);
  assert.deepEqual(p.hardwareIds, ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0287*', 'HDAUDIO\\FUNC_01&VEN_10EC&DEV_0287&SUBSYS_17AA22D9']);
  assert.ok(p.signers.includes('Lenovo'));
  assert.equal(S.parseLenovoPackage(fixture('lenovo-package.xml'), 'https://evil.example/n32ac12w_2_.xml', 'Audio'), null);
  assert.equal(S.parseLenovoPackage(fixture('lenovo-package.xml'), 'https://download.lenovo.com/x_2_.xml', 'BIOS/UEFI').bios, true);
});

test('asus: endereço da consulta e o JSON vira pacotes (códigos quando vierem, sem BIOS, domínio oficial)', () => {
  assert.equal(S.asusUrl('https://rog.asus.com/support/webapi/product/GetPDDrivers', 'ROG STRIX B550-F GAMING'), 'https://rog.asus.com/support/webapi/product/GetPDDrivers?website=global&model=ROG+STRIX+B550-F+GAMING&cpu=ROG+STRIX+B550-F+GAMING&osid=52');
  const list = S.parseAsus(JSON.parse(fixture('asus-drivers.json')));
  assert.deepEqual(list.map((p) => p.id), ['asus-a1', 'asus-l1']);
  const [audio, lan] = list;
  assert.equal(audio.kind, 'zip');
  assert.equal(audio.url, 'https://dlcdnets.asus.com/pub/ASUS/mb/03CHIPSET/Realtek_Audio_6.0.9600.1.zip?model=ROG%20STRIX%20B550-F%20GAMING');
  assert.equal(audio.fileName, 'Realtek_Audio_6.0.9600.1.zip');
  assert.equal(audio.driverVersion, '6.0.9600.1');
  assert.equal(audio.date, '2026-05-10');
  assert.equal(audio.sha256, '0afd6c310193eb33729649f55cd12991e2d24af783262fbf7f824d2ed838d8c2');
  assert.deepEqual(audio.hardwareIds, ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_1220&SUBSYS_10438797']);
  assert.equal(audio.category, 'Audio');
  assert.deepEqual(lan.hardwareIds, [], 'sem códigos: casa por categoria + fabricante');
  assert.ok(audio.signers.includes('ASUSTeK COMPUTER INC.'));
  assert.deepEqual(S.parseAsus({ Status: 'FAIL' }), []);
});

test('outras marcas: página de suporte do modelo exato quando o formato é conhecido', () => {
  assert.equal(S.supportUrlFor('msi', 'MAG B550 TOMAHAWK (MS-7C91)'), 'https://www.msi.com/Motherboard/MAG-B550-TOMAHAWK/support');
  assert.equal(S.supportUrlFor('msi', 'Katana 15 B13VFK', true), null, 'notebook MSI tem outro caminho: fica a página geral');
  assert.equal(S.supportUrlFor('gigabyte', 'B650 AORUS ELITE AX'), null, 'o endereço da Gigabyte depende da revisão da placa');
  assert.equal(S.supportUrlFor('asrock', 'B650M Pro RS'), null);
  assert.equal(S.supportUrlFor('msi', '../../x'), null);
});


/* ---- Correções da revisão final ---- */
test('hp: endereços da referência do release do PC para baixo (até 3)', () => {
  assert.deepEqual(S.hpRefCandidates('https://hpia.hpcloud.hp.com/ref/', '8870', { build: 26200 }), [
    'https://hpia.hpcloud.hp.com/ref/8870/8870_64_11.0.25H2.cab',
    'https://hpia.hpcloud.hp.com/ref/8870/8870_64_11.0.24H2.cab',
    'https://hpia.hpcloud.hp.com/ref/8870/8870_64_11.0.23H2.cab'
  ]);
  assert.deepEqual(S.hpRefCandidates('https://hpia.hpcloud.hp.com/ref/', 'zz', { build: 26200 }), []);
});
test('firmware separado da BIOS (Dell FRMW, HP Firmware, Lenovo tipo 4)', () => {
  const xml = fixture('dell-catalog.xml').replace('<ComponentType value="BIOS" />', '<ComponentType value="FRMW" />');
  const fw = S.parseDellCatalog(xml).find((p) => p.firmware);
  assert.ok(fw, 'FRMW vira firmware');
  assert.equal(fw.bios, undefined);
  const hp = S.parseHpRef(fixture('hp-ref.xml').replace('<Category>BIOS</Category>', '<Category>Firmware</Category>'));
  assert.equal(hp.find((p) => p.id === 'hp-sp150001').firmware, true);
  assert.equal(hp.find((p) => p.id === 'hp-sp150001').bios, undefined);
  const lv = S.parseLenovoPackage(fixture('lenovo-package.xml').replace('<PackageType type="2" />', '<PackageType type="4" />'), 'https://download.lenovo.com/x_2_.xml', 'Thunderbolt');
  assert.equal(lv.firmware, true);
  assert.equal(lv.bios, undefined);
});
test('lista de fontes: subdomínio que não é o servidor oficial exato é recusado', () => {
  const list = S.parseSourceList({ version: 1, sources: { hp: { type: 'hpia-ref', base: 'https://evil.hp.com/ref/' }, dell: { type: 'dell-catalog', index: 'https://downloads.dell.com/catalog/CatalogIndexPC.cab' } }, disabled: [] });
  assert.equal(list.sources.hp, undefined);
  assert.ok(list.sources.dell);
});

test('lenovo: código dentro de <Not> não conta como peça atendida', () => {
  const xml = fixture('lenovo-package.xml').replace('<And>', '<And><Not><_PnPID><![CDATA[PCI\\VEN_8086&DEV_9999]]></_PnPID></Not>');
  const p = S.parseLenovoPackage(xml, 'https://download.lenovo.com/pccbbs/mobiles/n32ac12w_2_.xml', 'Audio');
  assert.ok(!p.hardwareIds.includes('PCI\\VEN_8086&DEV_9999'));
  assert.ok(p.hardwareIds.length >= 1);
});
test('dell: pacote só de 32 bits (ou só de ARM) fica de fora', () => {
  const xml = fixture('dell-catalog.xml').replace('<Category value="CS">', '<SupportedOperatingSystems><OperatingSystem osCode="W10P4" osArch="x86" /></SupportedOperatingSystems><Category value="CS">');
  assert.ok(!S.parseDellCatalog(xml).some((p) => p.id === 'dell-7CHKN'));
  const x64 = fixture('dell-catalog.xml').replace('<Category value="CS">', '<SupportedOperatingSystems><OperatingSystem osCode="W11P4" osArch="x64" /></SupportedOperatingSystems><Category value="CS">');
  assert.ok(S.parseDellCatalog(x64).some((p) => p.id === 'dell-7CHKN'));
});
