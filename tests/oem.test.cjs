/*
 * Drivers dos fabricantes de PC: leitor de XML dos catálogos, identificação do PC e casamento pacote ↔ peça.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../electron/xml-lite.cjs');

test('xml: elementos, atributos, texto e entidades', () => {
  const root = X.parseXml('<a x="1" y=\'dois &amp; tr&#234;s\'><b>Ol&#225; &lt;mundo&gt; &quot;oi&quot; &apos;x&apos; &#x41;</b><b/><c k="v">  t  </c></a>');
  assert.equal(root.name, 'a');
  assert.deepEqual(root.attrs, { x: '1', y: 'dois & três' });
  assert.equal(X.kids(root, 'b').length, 2);
  assert.equal(X.textOf(root, 'b'), 'Olá <mundo> "oi" \'x\' A');
  assert.equal(X.kid(root, 'C').attrs.k, 'v', 'nome sem diferenciar maiúsculas');
  assert.equal(X.kid(root, 'c').text.trim(), 't');
  assert.equal(X.kid(root, 'nada'), null);
});

test('xml: CDATA, comentários e instruções', () => {
  const root = X.parseXml('\uFEFF<?xml version="1.0" encoding="utf-8"?>\n<!-- topo --><r><![CDATA[<cru> & solto]]><!-- dentro --><?pi algo?><s>1</s></r>');
  assert.equal(root.text, '<cru> & solto');
  assert.equal(X.textOf(root, 's'), '1');
});

test('xml: prefixo de namespace some do nome e walk acha descendentes', () => {
  const root = X.parseXml('<x:Manifest xmlns:x="u"><x:Group><x:Item id="1"/><x:Sub><x:Item id="2"/></x:Sub></x:Group></x:Manifest>');
  assert.equal(root.name, 'Manifest');
  assert.deepEqual(X.walk(root, 'item').map((n) => n.attrs.id), ['1', '2']);
});

test('xml: recusa DOCTYPE/ENTITY, tag sem fechar e fechamento trocado', () => {
  assert.throws(() => X.parseXml('<!DOCTYPE r [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><r>&x;</r>'), /DOCTYPE/);
  assert.throws(() => X.parseXml('<r><a></r>'), /fecha/);
  assert.throws(() => X.parseXml('<r><a>'), /fecha/);
  assert.throws(() => X.parseXml('<r>&naoexiste;</r>'), /entidade/);
  assert.throws(() => X.parseXml(''), /vazio/);
});

test('xml: limites de tamanho, profundidade e quantidade de nós', () => {
  assert.throws(() => X.parseXml(`<r>${'a'.repeat(200)}</r>`, { maxBytes: 100 }), /grande/);
  assert.throws(() => X.parseXml(`${'<a>'.repeat(70)}${'</a>'.repeat(70)}`), /fundo/);
  assert.throws(() => X.parseXml(`<r>${'<i/>'.repeat(50)}</r>`, { maxNodes: 20 }), /nós/);
  const big = X.parseXml(`<r>${'<i/>'.repeat(5000)}</r>`);
  assert.equal(big.children.length, 5000);
});

/* ---------------- Identificação do PC, casamento e comparação (src/oem.js) ---------------- */
const O = require('../src/oem.js');

test('oem: identifica Dell, HP, Lenovo e placas de marca; genérico e marca sem fonte = null', () => {
  assert.deepEqual(O.identify({ systemMaker: 'Dell Inc.', model: 'XPS 15 9530', sku: '0beb' }), { oem: 'dell', key: '0BEB', label: 'Dell XPS 15 9530' });
  assert.equal(O.identify({ systemMaker: 'Alienware', model: 'Alienware m16 R2', sku: '0C5A' }).oem, 'dell');
  assert.equal(O.identify({ systemMaker: 'Dell Inc.', model: 'XPS', sku: 'XYZ' }), null, 'SKU fora do formato');
  assert.deepEqual(O.identify({ systemMaker: 'HP', maker: 'HP', product: '8870', model: 'HP EliteBook 840 G8 Notebook PC' }), { oem: 'hp', key: '8870', label: 'HP EliteBook 840 G8 Notebook PC' });
  assert.equal(O.identify({ systemMaker: 'Hewlett-Packard', product: '880d', model: 'HP ZBook' }).key, '880D');
  assert.deepEqual(O.identify({ systemMaker: 'LENOVO', model: '20XWCTO1WW', version: 'ThinkPad X1 Carbon Gen 9' }), { oem: 'lenovo', key: '20XW', label: 'Lenovo ThinkPad X1 Carbon Gen 9' });
  assert.deepEqual(O.identify({ systemMaker: 'System manufacturer', maker: 'ASUSTeK COMPUTER INC.', product: 'ROG STRIX B550-F GAMING', model: 'System Product Name' }), { oem: 'asus', key: 'ROG STRIX B550-F GAMING', label: 'ASUS ROG STRIX B550-F GAMING' });
  assert.equal(O.identify({ systemMaker: 'ASUSTeK COMPUTER INC.', maker: 'ASUSTeK COMPUTER INC.', product: 'GA402XY', model: 'ROG Zephyrus G14 GA402XY', mobile: true }).key, 'ROG Zephyrus G14 GA402XY');
  assert.equal(O.identify({ systemMaker: 'Micro-Star International Co., Ltd.', maker: 'Micro-Star International Co., Ltd.', product: 'MAG B550 TOMAHAWK (MS-7C91)' }).oem, 'msi');
  assert.equal(O.identify({ maker: 'Gigabyte Technology Co., Ltd.', product: 'B650 AORUS ELITE AX' }).oem, 'gigabyte');
  assert.equal(O.identify({ maker: 'ASRock', product: 'B650M Pro RS' }).oem, 'asrock');
  assert.equal(O.identify({ systemMaker: 'Acer', model: 'Predator PH315-54' }).oem, 'acer');
  assert.equal(O.identify({ systemMaker: 'To be filled by O.E.M.', maker: 'To be filled by O.E.M.', product: 'Default string' }), null);
  assert.equal(O.identify({ systemMaker: 'Positivo Tecnologia SA', model: 'VJFE42F11X' }), null);
  assert.equal(O.identify(null), null);
});

test('oem: código de hardware normalizado e nível de casamento', () => {
  assert.equal(O.normalizeHwid('pci\\ven_8086&dev_a0f0&subsys_0a6f1028&rev_20'), 'PCI\\VEN_8086&DEV_A0F0&SUBSYS_0A6F1028&REV_20');
  assert.equal(O.normalizeHwid('PCI\\VEN<script>'), null);
  assert.equal(O.normalizeHwid('x'.repeat(201)), null);
  const dev = 'PCI\\VEN_8086&DEV_A0F0&SUBSYS_0A6F1028&REV_20';
  assert.equal(O.hwidRank(dev, 'PCI\\VEN_8086&DEV_A0F0&SUBSYS_0A6F1028'), 3);
  assert.equal(O.hwidRank(dev, 'PCI\\VEN_8086&DEV_A0F0&SUBSYS_0A6F1028&REV_20'), 3);
  assert.equal(O.hwidRank(dev, 'PCI\\VEN_8086&DEV_A0F0&SUBSYS_0B001028'), 0, 'SUBSYS de outro modelo nunca');
  assert.equal(O.hwidRank(dev, 'PCI\\VEN_8086&DEV_A0F0&REV_20'), 2);
  assert.equal(O.hwidRank(dev, 'PCI\\VEN_8086&DEV_A0F0'), 1);
  assert.equal(O.hwidRank('HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280A6F', 'HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295*'), 2);
  assert.equal(O.hwidRank('PCI\\VEN_8086&DEV_A0F0', 'PCI\\VEN_8086&DEV_A0F1'), 0);
  assert.equal(O.hwidRank('PCI\\VEN_8086&DEV_A0F0', 'PCI\\VEN_8086*DEV'), 0, 'curinga só no fim');
});

const pkg = (extra) => ({ id: 'p', source: 'dell', title: 'Realtek High Definition Audio Driver', category: 'Audio', version: 'A05', date: '2026-08-01', url: 'https://downloads.dell.com/x.exe', fileName: 'x.exe', hardwareIds: ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280A6F'], kind: 'exe', signers: [], ...extra });
const audio = { name: 'Realtek Audio', cls: 'MEDIA', maker: 'Realtek', version: '6.0.9500.1', date: '2025-01-01', hwids: ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280A6F&REV_1001', 'HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280A6F'] };
const gpu = { name: 'NVIDIA GeForce RTX 4060 Laptop GPU', cls: 'DISPLAY', maker: 'NVIDIA', version: '32.0.15.6614', date: '2025-01-01', hwids: ['PCI\\VEN_10DE&DEV_28E0&SUBSYS_0BEB1028'] };

test('oem: casa pacote com peça; vídeo e BIOS nunca; empate fica com a versão maior', () => {
  const out = O.matchPackages([audio, gpu], [
    pkg({ id: 'a1', driverVersion: '6.0.9600.1' }),
    pkg({ id: 'a2', driverVersion: '6.0.10000.1' }),
    pkg({ id: 'g', title: 'NVIDIA Graphics', category: 'Video', hardwareIds: ['PCI\\VEN_10DE&DEV_28E0&SUBSYS_0BEB1028'] }),
    pkg({ id: 'bios', title: 'BIOS', bios: true, hardwareIds: audio.hwids })
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].pkg.id, 'a2', '6.0.10000.1 > 6.0.9600.1 (número a número, não texto)');
  assert.deepEqual(out[0].devices.map((d) => d.name), ['Realtek Audio']);
  const tie = O.matchPackages([audio], [pkg({ id: 'old', date: '2025-01-01' }), pkg({ id: 'new', date: '2026-02-01' })]);
  assert.equal(tie[0].pkg.id, 'new', 'sem versão do driver: o pacote de data mais nova');
  const better = O.matchPackages([audio], [pkg({ id: 'gen', hardwareIds: ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295*'], driverVersion: '9.9.9.9' }), pkg({ id: 'exact', driverVersion: '6.0.1.1' })]);
  assert.equal(better[0].pkg.id, 'exact', 'o código mais específico ganha da versão');
});

test('oem: ASUS sem códigos casa por categoria e fabricante da peça', () => {
  const lan = { name: 'Realtek Gaming 2.5GbE Family Controller', cls: 'NET', maker: 'Realtek', version: '10.68.0', hwids: ['PCI\\VEN_10EC&DEV_8125'] };
  const wifi = { name: 'Intel(R) Wi-Fi 6E AX210 160MHz', cls: 'NET', maker: 'Intel', version: '23.10.0', hwids: ['PCI\\VEN_8086&DEV_2725'] };
  const out = O.matchPackages([audio, lan, wifi], [
    { id: 'asus-lan', source: 'asus', title: 'Realtek LAN Driver', category: 'LAN', hardwareIds: [], date: '2026-05-01' },
    { id: 'asus-audio', source: 'asus', title: 'Realtek Audio Driver', category: 'Audio', hardwareIds: [], date: '2026-05-01' },
    { id: 'asus-bt', source: 'asus', title: 'Intel Bluetooth Driver', category: 'Bluetooth', hardwareIds: [], date: '2026-05-01' }
  ]);
  const byPkg = Object.fromEntries(out.map((m) => [m.pkg.id, m.devices.map((d) => d.name)]));
  assert.deepEqual(byPkg['asus-lan'], ['Realtek Gaming 2.5GbE Family Controller']);
  assert.deepEqual(byPkg['asus-audio'], ['Realtek Audio']);
  assert.equal(byPkg['asus-bt'], undefined, 'nenhuma peça Bluetooth');
});

test('oem: compara a versão do driver número a número; formato diferente = unknown (nunca pela data)', () => {
  assert.equal(O.compareToInstalled('27.20.100.9168', { driverVersion: '27.20.100.9466' }), 'newer');
  assert.equal(O.compareToInstalled('27.20.100.9466', { driverVersion: '27.20.100.9466' }), 'same');
  assert.equal(O.compareToInstalled('31.0.101.5186', { driverVersion: '27.20.100.9466' }), 'older');
  assert.equal(O.compareToInstalled('6.0.9500.1', { driverVersion: null, version: 'A05', date: '2026-08-01' }), 'unknown');
  assert.equal(O.compareToInstalled('6.0.9500.1', { driverVersion: '6.0' }), 'unknown', 'quantidade de partes diferente');
  assert.equal(O.compareToInstalled('', { driverVersion: '1.0.0.0' }), 'unknown');
});

test('oem: domínios e assinantes fixos', () => {
  assert.deepEqual(O.DOMAINS['dell-catalog'], ['dell.com']);
  assert.ok(O.DOMAINS['hpia-ref'].includes('hp.com'));
  assert.ok(O.signersFor('dell').includes('Dell Inc'));
  assert.ok(O.signersFor('dell').includes('Realtek Semiconductor Corp.'));
  assert.ok(O.signersFor('asus').includes('ASUSTeK COMPUTER INC.'));
  assert.deepEqual(O.signersFor('nada'), []);
});
