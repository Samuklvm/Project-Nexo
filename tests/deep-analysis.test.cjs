/*
 * Análise profunda: a base de conhecimento das peças (src/hardware-kb.js), as leituras do sistema
 * (electron/deep-scan.cjs), as regras dos achados (src/deep-analysis.js) e a orquestração com o mínimo de 60 s
 * (electron/deep-run.cjs), num relógio virtual.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const H = require('../src/hardware-kb.js');
const D = require('../src/deep-analysis.js');
const Scan = require('../electron/deep-scan.cjs');
const { createDeepAnalysis } = require('../electron/deep-run.cjs');
const Session = require('../src/session.js');

const GB = 1024 ** 3;

test('processador: geração, arquitetura, socket e recursos pelo nome (Intel e AMD, desktop e notebook)', () => {
  const cases = [
    ['12th Gen Intel(R) Core(TM) i5-12400F', 6, 12, { vendor: 'Intel', generation: 12, architecture: 'Alder Lake', socket: 'LGA1700', igpu: false, hybrid: false, segment: 'desktop' }],
    ['12th Gen Intel(R) Core(TM) i7-12700K', 12, 20, { hybrid: true, unlocked: true }],
    ['Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz', 8, 8, { generation: 9, architecture: 'Coffee Lake Refresh', pcie: 3 }],
    ['11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz', 4, 8, { generation: 11, architecture: 'Tiger Lake', segment: 'laptop' }],
    ['Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz', 4, 8, { generation: 10, architecture: 'Ice Lake' }],
    ['13th Gen Intel(R) Core(TM) i9-13900K', 24, 32, { raptorRisk: true }],
    ['Intel(R) Core(TM) Ultra 9 285K', 24, 24, { architecture: 'Arrow Lake', socket: 'LGA1851', hybrid: true }],
    ['Intel(R) Core(TM) Ultra 7 258V', 8, 8, { architecture: 'Lunar Lake', segment: 'laptop' }],
    ['Intel(R) N100', 4, 4, { architecture: 'Alder Lake-N', efficiencyOnly: true }],
    ['Intel(R) Core(TM) i7-920 CPU @ 2.67GHz', 4, 8, { generation: 1 }],
    ['AMD Ryzen 5 5600X 6-Core Processor', 6, 12, { vendor: 'AMD', architecture: 'Zen 3', socket: 'AM4', pcie: 4, igpu: false }],
    ['AMD Ryzen 5 5600G with Radeon Graphics', 6, 12, { apuPcie3: true, pcie: 3, igpu: true }],
    ['AMD Ryzen 5 5500', 6, 12, { apuPcie3: true, igpu: false }],
    ['AMD Ryzen 7 5700X3D 8-Core Processor', 8, 16, { apuPcie3: false, x3d: true, pcie: 4, architecture: 'Zen 3' }],
    ['AMD Ryzen 7 5700X 8-Core Processor', 8, 16, { apuPcie3: false, pcie: 4 }],
    ['AMD Ryzen 9 7950X3D 16-Core Processor', 16, 32, { socket: 'AM5', x3d: true, dualCcdX3d: true, pcie: 5 }],
    ['AMD Ryzen 7 9800X3D 8-Core Processor', 8, 16, { architecture: 'Zen 5', x3d: true, dualCcdX3d: false }],
    ['AMD Ryzen 5 5500U with Radeon Graphics', 6, 12, { architecture: 'Zen 2', segment: 'laptop' }],
    ['AMD Ryzen 7 5800U with Radeon Graphics', 8, 16, { architecture: 'Zen 3' }],
    ['AMD Ryzen 5 7520U with Radeon Graphics', 4, 8, { architecture: 'Zen 2' }],
    ['AMD Ryzen 7 7735HS with Radeon Graphics', 8, 16, { architecture: 'Zen 3+' }],
    ['AMD Ryzen AI 9 HX 370 w/ Radeon 890M', 12, 24, { architecture: 'Zen 5', model: 'HX 370' }],
    ['AMD Ryzen 5 8400F 6-Core Processor', 6, 12, { socket: 'AM5', igpu: false, pcie: 4 }]
  ];
  for (const [name, cores, threads, expected] of cases) {
    const cpu = H.decodeCpu({ name, cores, threads });
    for (const [key, value] of Object.entries(expected)) assert.equal(cpu[key], value, `${name} → ${key}`);
    assert.equal(cpu.known, true, name);
  }
  const unknown = H.decodeCpu({ name: 'Processador Misterioso X', cores: 4, threads: 4, manufacturer: 'Fabricante' });
  assert.equal(unknown.known, false);
  assert.equal(unknown.cores, 4, 'peça desconhecida continua com o que o sistema informa');
});

test('placa-mãe: chipset pelo nome do produto, com o que ele permite', () => {
  const amd = { vendor: 'AMD' };
  const intel = { vendor: 'Intel' };
  assert.equal(H.decodeChipset('ROG STRIX B550-F GAMING', amd).id, 'B550');
  assert.equal(H.decodeChipset('B550M AORUS ELITE', amd).socket, 'AM4');
  assert.equal(H.decodeChipset('TUF GAMING X670E-PLUS', amd).id, 'X670E', 'o "E" não é perdido');
  assert.equal(H.decodeChipset('PRIME Z790-P WIFI', intel).cpuOc, true);
  assert.equal(H.decodeChipset('H410M-E', intel).memOc, false, 'H410 trava a memória');
  assert.equal(H.decodeChipset('B85M-G', intel).ddr, 'DDR3');
  assert.equal(H.decodeChipset('A520M-K', amd).cpuOc, false);
  assert.equal(H.decodeChipset('B460M PRO', amd), null, 'chipset de outro fabricante não vale');
  assert.equal(H.decodeChipset('0XYZ12', intel), null, 'placa de OEM sem chipset no nome');
  assert.equal(H.maker('ASUSTeK COMPUTER INC.'), 'ASUS');
  assert.equal(H.maker('Micro-Star International Co., Ltd.'), 'MSI');
  assert.equal(H.maker('To Be Filled By O.E.M.'), null);
});

test('memória: velocidade da caixa pelo código do pente, canais pelos slots', () => {
  const cases = [['F4-3200C16D-16GVKB', 3200, 16, false], ['F5-6000J3038F16G', 6000, 30, false], ['CMK16GX4M2B3200C16', 3200, 16, false], ['KF432C16BB/8', 3200, 16, false],
    ['KF560C30-16', 6000, 30, false], ['KVR32N22S8/8', 3200, 22, true], ['BL8G32C16U4B.M8FE1', 3200, 16, false], ['CT8G4SFRA266.C8FJ', 2666, null, true], ['CT16G48C40U5.M8A1', 4800, 40, true],
    ['M378A1K43CB2-CTD', 2666, null, true], ['HMA81GU6CJR8N-VK', 2666, null, true], ['MTA8ATF1G64AZ-3G2E1', 3200, null, true], ['AX4U32008G16A-SR10', 3200, null, false], ['PVS416G320C6K', 3200, 16, false]];
  for (const [part, speed, cl, jedec] of cases) {
    const rated = H.ratedFromPart(part);
    assert.equal(rated?.speed, speed, part);
    assert.equal(rated.cl, cl, `${part} CL`);
    assert.equal(rated.jedec, jedec, `${part} jedec`);
  }
  assert.equal(H.ratedFromPart('Undefined'), null);
  assert.equal(H.channelOf('DIMM_A2', 'BANK 1'), 'A');
  assert.equal(H.channelOf('ChannelB-DIMM0', 'BANK 2'), 'B');
  assert.equal(H.channelOf('DIMM 1', 'P0 CHANNEL A'), 'A');
  assert.equal(H.channelOf('DIMM1', ''), null);
  const module = (locator, part = 'F4-3200C16-8GVKB') => ({ capacity: 8 * GB, speed: 2133, configured: 2133, part, type: 26, formFactor: 8, locator, bank: '' });
  assert.equal(H.decodeMemory({ modules: [module('DIMM_A2')] }).layout, 'single');
  assert.equal(H.decodeMemory({ modules: [module('DIMM_A1'), module('DIMM_A2')] }).layout, 'same-channel');
  const dual = H.decodeMemory({ modules: [module('DIMM_A2'), module('DIMM_B2')], slots: 4 });
  assert.equal(dual.layout, 'dual');
  assert.equal(dual.freeSlots, 2);
  assert.equal(dual.belowRated, true);
  assert.equal(H.decodeMemory({ modules: [module('DIMM_A2'), module('DIMM_B2', 'F4-3600C16-8GVKC')] }).mixed, true);
});

test('placa de vídeo: família, integrada ou dedicada, driver básico', () => {
  const gpu = (name, vendorId) => H.decodeGpu({ name, vendorId, driverDate: '2025-01-01' }, Date.parse('2026-01-01'));
  assert.equal(gpu('NVIDIA GeForce RTX 4070 SUPER', '10DE').architecture, 'Ada Lovelace');
  assert.equal(gpu('NVIDIA GeForce RTX 3060 Laptop GPU', '10DE').mobile, true);
  assert.equal(gpu('NVIDIA GeForce GTX 1060 6GB', '10DE').legacyDriver, true);
  assert.equal(gpu('AMD Radeon RX 7900 XTX', '1002').variant, 'XTX');
  assert.equal(gpu('AMD Radeon(TM) Graphics', '1002').integrated, true);
  assert.equal(gpu('Intel(R) Arc(TM) A750 Graphics', '8086').needsRebar, true);
  assert.equal(gpu('Intel(R) Arc(TM) Graphics', '8086').integrated, true);
  assert.equal(gpu('Microsoft Basic Display Adapter', '1414').basicDriver, true);
  assert.equal(gpu('NVIDIA GeForce RTX 4070 SUPER', '10DE').driver.ageDays, 365);
});

test('leituras do Windows: inventário, saúde e observação saneados (sem quebrar com um item só ou valores absurdos)', () => {
  const inventory = Scan.parseInventory(JSON.stringify({
    cpu: { name: 'AMD Ryzen 5 5600X 6-Core Processor', cores: 6, threads: 12, baseMHz: 3700 },
    board: { manufacturer: 'ASUSTeK COMPUTER INC.', product: 'TUF GAMING B550M-PLUS' }, bios: { date: '2024-02-21', version: '3404' },
    memory: { modules: { capacity: 8 * GB, speed: 2133, configured: 2133, part: 'F4-3200C16-8GVKB', type: 26, formFactor: 8, locator: 'DIMM_A2' }, slots: 4 },
    gpus: { name: 'NVIDIA GeForce RTX 3060', vendorId: '10de', link: { curSpeed: 1, maxSpeed: 4, curWidth: 16, maxWidth: 16 } },
    displays: { adapter: 'NVIDIA GeForce RTX 3060', name: 'VG27AQ', output: 2147483648, width: 2560, height: 1440, hz: 60, maxHz: 165 },
    disks: [{ model: 'WDC WD10EZEX', media: 'HDD', bus: 'SATA', size: 1e12, rpm: 4294967295, system: true }],
    network: { name: 'Ethernet', description: 'Realtek PCIe GbE Family Controller', up: true, linkMbps: 100, ndis: 14 },
    wlan: '', os: { caption: 'Microsoft Windows 10 Pro', build: 19045 }
  }));
  assert.equal(inventory.memory.modules.length, 1, 'um pente só vira lista');
  assert.equal(inventory.gpus[0].vendorId, '10DE');
  assert.equal(inventory.displays[0].internal, true, 'saída interna (0x80000000)');
  assert.equal(inventory.disks[0].rpm, null, 'RPM "desconhecido" do Windows não vira número');
  assert.equal(Scan.parseInventory('não é json'), null);
  const health = Scan.parseHealth(JSON.stringify({ events: { bugcheck: { count: 2, last: '2026-11-01T10:00:00Z' } }, crashes: [{ app: 'C:\\Jogos\\Jogo.exe', count: 3, modules: ['C:\\Windows\\System32\\nvwgf2umx.dll'] }], plan: 'GUID do esquema de energia: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado)', fastStartup: 1 }));
  assert.equal(health.events.bugcheck.count, 2);
  assert.equal(health.crashes[0].app, 'Jogo.exe', 'só o nome do programa, nunca a pasta');
  assert.equal(health.crashes[0].modules[0], 'nvwgf2umx.dll');
  assert.equal(health.planGuid, '381b4222-f694-41f0-9685-ff5bb260df2e');
  assert.equal(health.fastStartup, true);
  const meta = Scan.parseObserveLine(JSON.stringify({ kind: 'meta', self: 99, cores: 12, services: { 500: ['wuauserv', 'BITS', 'nome; ruim'] }, procs: { 20: { name: 'chrome', path: 'C:\\x\\chrome.exe', window: true } } }));
  assert.deepEqual(meta.services.get(500), ['wuauserv', 'BITS'], 'nome de serviço fora do padrão é descartado');
  const tick = Scan.parseObserveLine(JSON.stringify({ kind: 'tick', i: 1, t: 1, procs: [{ pid: 20, cpu: 500, io: 1, mem: 2 }, { pid: 20, cpu: 1 }], gpu: [{ pid: 20, util: 10, engine: '3D; rm -rf', d3: 10 }], cpu: { total: 30, dpc: 1 } }));
  assert.equal(tick.procs.length, 1, 'mesmo PID duas vezes vira um');
  assert.equal(tick.procs[0].cpu, 0, 'valor fora da faixa vira 0');
  assert.equal(tick.gpu[0].engine, null);
  assert.deepEqual(Scan.parseWlan('Estado : conectado\n Tipo de rádio : 802.11ax\n Banda : 5 GHz\n Canal : 36\n Sinal : 92%'), { signal: 92, standard: '802.11ax', band: 5, channel: 36 });
  assert.equal(Scan.parseWlan('Radio type : 802.11n\nChannel : 6\nSignal : 40%').band, 2.4);
  assert.equal(Scan.parseBar1('FB Memory Usage\n Total : 8188 MiB\nBAR1 Memory Usage\n Total : 256 MiB\n Used : 3 MiB'), 256);
});

test('scripts da análise: programas do sistema pelo caminho completo, parâmetros só por variável de ambiente', () => {
  for (const [name, script] of Object.entries({ INVENTORY_SCRIPT: Scan.INVENTORY_SCRIPT, HEALTH_SCRIPT: Scan.HEALTH_SCRIPT, OBSERVE_SCRIPT: Scan.OBSERVE_SCRIPT, LOAD_SCRIPT: Scan.LOAD_SCRIPT, LINK_SCRIPT: Scan.LINK_SCRIPT })) {
    assert.doesNotMatch(script, /&\s*(?:netsh|powercfg|reg|cmd|wmic)(?:\.exe)?\b/i, `${name}: sem PATH`);
    assert.doesNotMatch(script, /Invoke-Expression|\biex\b|Start-Process|Stop-Process|Set-ItemProperty|New-ItemProperty|Remove-Item/i, `${name}: só leitura`);
  }
  assert.match(Scan.INVENTORY_SCRIPT, /\$env:SystemRoot\\System32\\netsh\.exe/);
  assert.match(Scan.HEALTH_SCRIPT, /\$env:SystemRoot\\System32\\powercfg\.exe/);
  assert.match(Scan.OBSERVE_SCRIPT, /\[int\]\$env:NEXO_TICKS/);
});

test('EDID: nome do monitor e taxa máxima (Linux)', () => {
  const edid = Buffer.alloc(128);
  Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]).copy(edid, 0);
  edid[8] = 0x1e; edid[9] = 0x6d; // "GSM"
  edid.set([0, 0, 0, 0xfc, 0], 54); Buffer.from('ULTRAGEAR\n   ', 'latin1').copy(edid, 59);
  edid.set([0, 0, 0, 0xfd, 0, 48, 144], 72);
  assert.deepEqual(Scan.parseEdid(edid), { name: 'ULTRAGEAR', maxHz: 144, maker: 'GSM' });
  assert.equal(Scan.parseEdid(Buffer.alloc(10)), null);
});

test('quem é quem: o próprio Nexo, jogos, launchers e anticheats nunca são culpados', () => {
  const ctx = { selfPids: new Set([10]), probePid: 99, services: new Map([[500, ['wuauserv']], [501, ['Dnscache']], [502, ['DoSvc']]]), classify: Session.classifyForeground, match: (path) => (/MeusJogos/.test(path) ? { name: 'Hades', kind: 'game' } : null) };
  const role = (info, extra = {}) => D.classifyProcess(info, { ...ctx, ...extra });
  assert.equal(role({ pid: 10, name: 'Nexo Device Care' }).role, 'self');
  assert.equal(role({ pid: 99, name: 'powershell' }).role, 'self', 'o PowerShell da própria observação');
  assert.equal(role({ pid: 1, name: 'PresentMon-x64' }).role, 'self');
  assert.deepEqual(role({ pid: 2, name: 'RobloxPlayerBeta' }), { role: 'game', label: 'Roblox' });
  assert.equal(role({ pid: 3, name: 'cs2', path: 'D:\\SteamLibrary\\steamapps\\common\\CS2\\cs2.exe' }).role, 'game');
  assert.equal(role({ pid: 4, name: 'Hades', path: 'E:\\MeusJogos\\Hades\\Hades.exe' }).label, 'Hades', 'jogo da biblioteca');
  assert.equal(role({ pid: 5, name: 'Palworld-Win64-Shipping' }).role, 'game', 'jogos em Unreal');
  assert.equal(role({ pid: 6, name: 'JogoSemCaminho', path: null, window: true }, { gpu3d: 60 }).role, 'game', 'anticheat esconde o caminho, mas a janela usa a placa em 3D');
  assert.deepEqual(role({ pid: 7, name: 'steamwebhelper' }), { role: 'launcher', label: 'Steam' });
  assert.equal(role({ pid: 8, name: 'vgc' }).role, 'anticheat');
  assert.equal(role({ pid: 500, name: 'svchost' }).label, 'Windows Update', 'svchost pelo serviço que hospeda');
  assert.equal(role({ pid: 501, name: 'svchost' }).role, 'system');
  assert.equal(role({ pid: 502, name: 'svchost' }).label, 'Otimização de Entrega');
  assert.equal(role({ pid: 9, name: 'MsMpEng' }).protect, true, 'antivírus: proteção, o Nexo não sugere desligar');
  assert.equal(role({ pid: 11, name: 'NahimicSvc64' }).kind, 'audio');
  assert.equal(role({ pid: 12, name: 'algo_estranho' }).kind, 'desconhecido');
  assert.equal(role({ pid: 13, name: 'javaw', window: true }, { gpu3d: 0 }).role, 'background', 'Java sem 3D não é jogo');
});

function observationTicks() {
  return Array.from({ length: 11 }, (_, i) => ({ kind: 'tick', i, t: 1000 + i * 3000,
    procs: [{ pid: 2, cpu: 35, io: 0, mem: 2e9 }, { pid: 7, cpu: 2, io: 0, mem: 4e8 }, { pid: 10, cpu: 3, io: 0, mem: 3e8 }, { pid: 20, cpu: i % 3 ? 2 : 16, io: 0, mem: 1e9 }, { pid: 500, cpu: 4, io: 9e6, mem: 1e8 }, { pid: 21, cpu: 0.3, io: 0, mem: 1e8 }],
    gpu: [{ pid: 2, util: 85, engine: '3D', d3: 85 }], cpu: { total: 50, dpc: 0.5, irq: 0.1, maxFreq: 100 }, mem: { availMB: 5000, hardFaults: 10, commit: 1e10, limit: 2e10 }, disk: { busy: 20 }, sys: {} }));
}

test('observação: o jogo e o Nexo ficam de fora; quem pesa por trás aparece com evidência', () => {
  const procs = new Map([[2, { name: 'RobloxPlayerBeta' }], [7, { name: 'steamwebhelper' }], [10, { name: 'Nexo Device Care' }], [20, { name: 'chrome' }], [500, { name: 'svchost' }], [21, { name: 'iCUE' }]]);
  const summary = D.summarizeObservation({ ticks: observationTicks(), procs, services: new Map([[500, ['wuauserv']]]), selfPids: new Set([10]), classify: Session.classifyForeground, memoryTotalBytes: 16 * GB });
  assert.deepEqual(summary.games.map((game) => game.label), ['Roblox']);
  assert.deepEqual(summary.launchers.map((item) => item.label), ['Steam']);
  assert.equal(summary.samples, 10, 'a primeira leitura (aquecimento do contador) é descartada');
  const names = summary.background.map((item) => item.label);
  assert.ok(!names.includes('Roblox') && !names.includes('Steam') && !names.some((name) => /Nexo/.test(name)));
  const chrome = summary.background.find((item) => item.name === 'chrome');
  assert.equal(chrome.impact, 'medio');
  assert.ok(chrome.cpuPeak >= 16 && chrome.cpuAvg < 8);
  assert.equal(summary.background.find((item) => item.label === 'Windows Update').impact, 'medio');
  assert.equal(summary.background.find((item) => item.kind === 'rgb').impact, 'presenca', 'RGB parado aparece como presença, não como culpado');
  const findings = D.buildFindings({ profile: H.identify({}), observation: summary });
  assert.ok(findings.some((item) => item.id === 'fundo-chrome' && item.severity === 'media'));
  assert.ok(!findings.some((item) => /Roblox|Steam/.test(item.title)));
  const spike = observationTicks().map((tick, i) => (i >= 9 ? { ...tick, cpu: { ...tick.cpu, total: 95 } } : { ...tick, cpu: { ...tick.cpu, total: 20 } }));
  assert.match(D.needsMoreTime(spike, 0), /processador subiu/);
  assert.equal(D.needsMoreTime(spike, 2), null, 'no máximo duas extensões');
  assert.equal(D.needsMoreTime(observationTicks(), 0), null);
});

const baseInventory = (over = {}) => ({
  cpu: { name: 'AMD Ryzen 5 5600G with Radeon Graphics', cores: 6, threads: 12 }, board: { manufacturer: 'ASUSTeK COMPUTER INC.', product: 'TUF GAMING B550M-PLUS' }, bios: { date: '2024-01-01' }, system: { chassis: [3] },
  memory: { modules: [{ capacity: 8 * GB, speed: 2133, configured: 2133, part: 'F4-3200C16-8GVKB', type: 26, formFactor: 8, locator: 'DIMM_A2' }, { capacity: 8 * GB, speed: 2133, configured: 2133, part: 'F4-3200C16-8GVKB', type: 26, formFactor: 8, locator: 'DIMM_B2' }], slots: 4 },
  gpus: [{ name: 'NVIDIA GeForce RTX 3060', vendorId: '10DE', vramBytes: 12 * GB, link: { curSpeed: 1, maxSpeed: 4, curWidth: 16, maxWidth: 16 } }, { name: 'AMD Radeon(TM) Graphics', vendorId: '1002' }],
  displays: [{ adapter: 'NVIDIA GeForce RTX 3060', name: 'VG27AQ', width: 2560, height: 1440, hz: 165, maxHz: 165 }],
  disks: [{ model: 'Samsung SSD 980', media: 'SSD', bus: 'NVMe', size: 1e12, system: true, health: 'Healthy' }], os: { build: 26100 }, ...over
});
const ids = (findings) => findings.map((item) => item.id);

test('achados dependem do setup: o mesmo sintoma vira conselho, explicação ou nada', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const b550 = D.buildFindings({ profile: H.identify(baseInventory()), load: { gpu: { pcieGen: 3, pcieGenMax: 4, clockMHz: 1800, clockMaxMHz: 1900 }, links: [] }, now });
  assert.ok(ids(b550).includes('mem-xmp'), 'B550 aceita XMP: ligar é o conselho');
  assert.equal(b550.find((item) => item.id === 'gpu-pcie-plataforma')?.severity, 'info', 'Ryzen 5600G só tem PCIe 3.0: explicação, não defeito');
  assert.ok(ids(b550).includes('mem-canais-ok'));
  const h410 = D.buildFindings({ profile: H.identify(baseInventory({ cpu: { name: 'Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz', cores: 6, threads: 12 }, board: { manufacturer: 'Gigabyte', product: 'H410M H' }, gpus: [{ name: 'NVIDIA GeForce RTX 3060', vendorId: '10DE' }] })), now });
  assert.ok(!ids(h410).includes('mem-xmp') && ids(h410).includes('mem-travada'), 'H410 trava a memória: nada de "ligue o XMP"');
  const igpuMonitor = baseInventory({ displays: [{ adapter: 'AMD Radeon(TM) Graphics', name: 'VG27AQ', width: 2560, height: 1440, hz: 60, maxHz: 165 }] });
  const desktop = D.buildFindings({ profile: H.identify(igpuMonitor), now });
  assert.ok(ids(desktop).includes('tela-placa-mae'));
  assert.ok(desktop.some((item) => item.id.startsWith('tela-hz-') && item.severity === 'alta'));
  const laptop = D.buildFindings({ profile: H.identify({ ...igpuMonitor, system: { chassis: [10] } }), now });
  assert.ok(!ids(laptop).includes('tela-placa-mae') && ids(laptop).includes('gpu-hibrida'), 'notebook usa o vídeo integrado de propósito');
  const raptor = D.buildFindings({ profile: H.identify(baseInventory({ cpu: { name: '13th Gen Intel(R) Core(TM) i9-13900K', cores: 24, threads: 32 }, board: { product: 'PRIME Z790-P' }, bios: { date: '2023-11-02' } })), health: { events: {}, wheaIds: [{ id: 19, count: 4 }] }, now });
  assert.ok(ids(raptor).includes('raptor-bios') && ids(raptor).includes('whea'));
  const win10 = D.buildFindings({ profile: H.identify(baseInventory({ os: { build: 19045 } })), health: { events: {} }, now });
  assert.ok(ids(win10).includes('win10'));
  const hd = D.buildFindings({ profile: H.identify(baseInventory({ disks: [{ model: 'ST1000DM010', media: 'HDD', bus: 'SATA', size: 1e12, system: true, health: 'Healthy' }] })), now });
  assert.equal(hd.find((item) => item.id === 'disco-hd-sistema').severity, 'alta');
});

test('achados nunca sugerem desligar proteção, e a ordem vai do mais grave ao certo', () => {
  const procs = new Map([[30, { name: 'MsMpEng' }]]);
  const ticks = Array.from({ length: 6 }, (_, i) => ({ kind: 'tick', i, t: i * 3000, procs: [{ pid: 30, cpu: 15, io: 40e6, mem: 2e8 }], gpu: [], cpu: { total: 30 }, mem: {}, disk: {}, sys: {} }));
  const observation = D.summarizeObservation({ ticks, procs });
  const findings = D.buildFindings({ profile: H.identify(baseInventory()), observation, health: { events: {}, vcacheService: false } });
  const defender = findings.find((item) => item.id === 'fundo-MsMpEng');
  assert.ok(defender && defender.action === null, 'Defender aparece, mas sem botão para mexer nele');
  assert.ok(!findings.some((item) => /desativ\w* o (antivírus|Defender)|desligue o (antivírus|Defender)|isolamento de núcleo|integridade de memória/i.test(`${item.title} ${item.detail} ${item.action?.how || ''}`)));
  const order = findings.map((item) => D.SEVERITY_ORDER[item.severity]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(D.healthScore(findings) >= 5 && D.healthScore(findings) <= 100);
  assert.equal(D.healthScore([]), 100);
});

test('comparação com a análise anterior: queda de desempenho e peça trocada', () => {
  const profile = H.identify(baseInventory());
  const before = D.runRecord({ at: 1, profile, load: { bench: { multi: 1000, single: 200 }, temps: { cpuPeak: 70 } }, findings: [{ id: 'mem-xmp', severity: 'media', title: 'Memória abaixo' }] });
  const after = D.runRecord({ at: 2, profile, load: { bench: { multi: 850, single: 190 }, temps: { cpuPeak: 78 } }, findings: [] });
  const comparison = D.compareRuns(after, before);
  assert.deepEqual(comparison.resolved, ['Memória abaixo']);
  assert.ok(D.buildFindings({ profile, comparison }).some((item) => item.id === 'desempenho-caiu'));
  const upgraded = D.runRecord({ at: 3, profile: H.identify(baseInventory({ gpus: [{ name: 'NVIDIA GeForce RTX 4070', vendorId: '10DE' }] })), load: { bench: { multi: 800 } }, findings: [] });
  const swap = D.compareRuns(upgraded, before);
  assert.ok(swap.hardware.some((item) => item.key === 'gpu'));
  assert.ok(!D.buildFindings({ profile, comparison: swap }).some((item) => item.id === 'desempenho-caiu'), 'peça trocada: comparar desempenho não faz sentido');
});

/* ---------------- Orquestração num relógio virtual ---------------- */
function harness({ cancelAt = null, hang = null, inventory = {} } = {}) {
  let clock = 1_000_000;
  const now = () => clock;
  const sleep = (ms) => new Promise((resolve) => { setImmediate(() => { clock += Math.max(1, ms); resolve(); }); });
  const emitted = [];
  const saved = [];
  let state = null;
  const fakeChild = (lines) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.kill = () => { child.killed = true; child.stdout.end(); setImmediate(() => child.emit('exit', 0)); };
    (async () => {
      for (const line of lines) {
        if (child.killed) return;
        await new Promise((resolve) => { setImmediate(resolve); });
        clock += 300;
        child.stdout.write(`${line}\n`);
      }
      child.stdout.end();
      setImmediate(() => child.emit('exit', 0));
    })();
    return child;
  };
  const spawnFn = (_file, args) => {
    const script = args[args.length - 1];
    if (script === Scan.OBSERVE_SCRIPT) {
      const procs = { 2: { name: 'RobloxPlayerBeta', path: null, window: true }, 20: { name: 'chrome', path: 'C:\\x\\chrome.exe', window: true }, 10: { name: 'Nexo Device Care' } };
      return fakeChild([JSON.stringify({ kind: 'meta', self: 99, cores: 12, services: {}, procs }), ...observationTicks().map((tick) => JSON.stringify({ ...tick, i: tick.i, procs: tick.procs.filter((row) => [2, 10, 20].includes(row.pid)), fresh: {} })), ...Array.from({ length: 10 }, (_, i) => JSON.stringify({ ...observationTicks()[1], i: 11 + i, procs: [], fresh: {} })), JSON.stringify({ kind: 'end' })]);
    }
    if (script === Scan.LOAD_SCRIPT) return fakeChild(Array.from({ length: 25 }, (_, i) => JSON.stringify({ kind: 'tick', i, t: clock + i * 1000, mhz: 3700, perf: 120, maxFreq: 100, limit: 0, busy: 100, cores: [{ perf: 120, busy: 100 }, { perf: 118, busy: 100 }] })));
    return fakeChild([]);
  };
  const runPowerShellCode = async (script) => {
    if (hang && script === Scan[hang]) return new Promise(() => { /* nunca responde: simula um script travado */ });
    if (script === Scan.INVENTORY_SCRIPT) return { code: 0, stdout: JSON.stringify({ ...baseInventory(inventory), memory: { modules: baseInventory().memory.modules, slots: 4 } }) };
    if (script === Scan.HEALTH_SCRIPT) return { code: 0, stdout: JSON.stringify({ events: { bugcheck: { count: 0 } }, rebootPending: { update: true }, fastStartup: 1, lastBoot: new Date(clock - 2 * 86400e3).toISOString() }) };
    if (script === Scan.LINK_SCRIPT) return { code: 0, stdout: JSON.stringify([{ name: 'NVIDIA GeForce RTX 3060', link: { curSpeed: 3, maxSpeed: 4, curWidth: 16, maxWidth: 16 } }]) };
    return { code: 1, stdout: '' };
  };
  const analysis = createDeepAnalysis({
    platform: 'win32', now, sleep, runPowerShellCode, spawnFn,
    sensors: async () => ({ devices: [{ type: 'Cpu', sensors: [{ name: 'CPU Package', type: 'Temperature', value: 72 }] }] }),
    nvidia: async () => [{ pcieGen: 3, pcieGenMax: 4, pcieGenHostMax: 3, pcieWidth: 16, bar1MB: 256 }],
    bench: async (mode, ms) => { await sleep(ms); return { mopsPerSec: mode === 'multi' ? 900 : 150, threads: 11 }; },
    facts: async () => ({ hags: 2, gameMode: 1, historical: 0 }), startup: async () => [], drives: async () => [{ driveLetter: 'C', sizeBytes: 1e12, freeBytes: 5e11 }],
    selfPids: () => new Set([10]), classify: Session.classifyForeground, memoryTotal: () => 16 * GB,
    emit: (progress) => { emitted.push(progress); if (cancelAt !== null && progress.stageIndex >= cancelAt && state) state.cancel(); },
    store: { load: async () => ({ runs: [] }), save: async (data) => { saved.push(data); } }
  });
  state = analysis;
  return { analysis, emitted, saved, now };
}

test('orquestração: 7 etapas na ordem, no mínimo 60 s, relatório sem caminhos e histórico salvo', async () => {
  const { analysis, emitted, saved, now } = harness();
  const startedAt = now();
  const report = await analysis.run();
  assert.ok(now() - startedAt >= D.MIN_TOTAL_MS, `durou ${now() - startedAt} ms`);
  assert.ok(report.durationMs >= D.MIN_TOTAL_MS);
  const stages = emitted.map((progress) => progress.stageIndex);
  assert.deepEqual(stages, [...stages].sort((a, b) => a - b), 'as etapas só andam para a frente');
  assert.deepEqual([...new Set(stages)], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(emitted[emitted.length - 1].status, 'done');
  assert.ok(emitted.some((progress) => progress.facts.some((item) => /Roblox aberto/.test(item.text))), 'o jogo é anunciado e deixado de fora');
  assert.ok(report.observation.games.some((game) => game.label === 'Roblox'));
  assert.ok(report.findings.some((item) => item.id === 'reinicio-pendente'));
  assert.ok(report.findings.some((item) => item.id === 'gpu-rebar'), 'BAR1 de 256 MB numa RTX 30 com plataforma compatível');
  assert.equal(report.load.bench.multi, 900);
  assert.doesNotMatch(JSON.stringify(report), /C:\\\\x\\\\chrome\.exe/, 'caminho de executável nunca vai para a tela');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].runs.length, 1);
  const again = analysis.run();
  await assert.rejects(analysis.run(), /já está rodando/, 'uma de cada vez');
  analysis.cancel();
  assert.deepEqual(await again, { cancelled: true });
});

test('orquestração: cancelar no meio para tudo e não salva nada', async () => {
  const { analysis, saved, emitted } = harness({ cancelAt: 2 });
  const result = await analysis.run();
  assert.deepEqual(result, { cancelled: true });
  assert.equal(saved.length, 0);
  assert.equal(emitted[emitted.length - 1].status, 'cancelled');
  assert.equal(analysis.isRunning(), false);
});

test('orquestração: cancelar responde na hora mesmo com um script travado no meio', async () => {
  for (const hang of ['INVENTORY_SCRIPT', 'HEALTH_SCRIPT']) {
    const { analysis } = harness({ hang });
    const running = analysis.run();
    for (let i = 0; i < 50; i += 1) await new Promise((resolve) => { setImmediate(resolve); });
    assert.equal(analysis.isRunning(), true);
    assert.deepEqual(analysis.cancel(), { ok: true });
    const result = await Promise.race([running, new Promise((resolve) => { setTimeout(() => resolve('travou'), 2000); })]);
    assert.deepEqual(result, { cancelled: true }, `cancelar com ${hang} pendurado`);
    assert.equal(analysis.isRunning(), false, 'libera para rodar de novo');
  }
});

test('orquestração: a peça com problema continua amarela depois do teste de carga', async () => {
  const { analysis, emitted } = harness({ inventory: { displays: [{ adapter: 'NVIDIA GeForce RTX 3060', name: 'VG27AQ', width: 2560, height: 1440, hz: 60, maxHz: 165 }] } });
  const report = await analysis.run();
  const warned = new Set();
  for (const progress of emitted) if (progress.stageIndex < 6) for (const [id, value] of Object.entries(progress.nodes)) if (value === 'warn') warned.add(id);
  assert.ok(warned.has('gpu'), 'monitor a 60 Hz deixa a placa de vídeo amarela na etapa de vídeo');
  const first = emitted.findIndex((progress) => progress.nodes.gpu === 'warn');
  for (const progress of emitted.slice(first)) assert.ok(['warn', 'active'].includes(progress.nodes.gpu), `na etapa ${progress.stageIndex} a placa de vídeo ficou "${progress.nodes.gpu}"`);
  assert.ok(emitted.slice(first).some((progress) => progress.nodes.gpu === 'active'), 'o teste de carga reacende a placa');
  const last = emitted[emitted.length - 1].nodes;
  for (const id of warned) assert.equal(last[id], 'warn', `${id} voltou a ficar verde depois do teste de carga`);
  assert.ok(report.findings.some((item) => item.area === 'video' && (item.severity === 'alta' || item.severity === 'media')));
});

test('revisão: casos que já enganaram os decodificadores e as regras', () => {
  // "64-Core" de um Threadripper não pode cair na regra da Intel ("Core").
  const tr = H.decodeCpu({ name: 'AMD Ryzen Threadripper 3990X 64-Core Processor', cores: 64, threads: 128 });
  assert.equal(tr.vendor, 'AMD');
  assert.equal(H.decodeCpu({ name: 'AMD Ryzen AI 9 HX 370 w/ Radeon 890M', cores: 12, threads: 24 }).vendor, 'AMD');
  assert.equal(H.decodeCpu({ name: 'Intel(R) Core(TM) 5 120F', cores: 6, threads: 12 }).vendor, 'Intel');
  // DDR5 na Intel: Controller0-ChannelA e Controller1-ChannelA são dois canais (dual channel), não o mesmo.
  const ddr5 = H.decodeMemory({ modules: [{ capacity: 16 * GB, speed: 4800, type: 34, formFactor: 8, locator: 'Controller0-ChannelA-DIMM0', bank: 'BANK 0' }, { capacity: 16 * GB, speed: 4800, type: 34, formFactor: 8, locator: 'Controller1-ChannelA-DIMM0', bank: 'BANK 0' }] });
  assert.equal(ddr5.layout, 'dual');
  const same = H.decodeMemory({ modules: [{ capacity: 8 * GB, speed: 3200, type: 26, formFactor: 8, locator: 'DIMM_A1' }, { capacity: 8 * GB, speed: 3200, type: 26, formFactor: 8, locator: 'DIMM_A2' }] });
  assert.equal(same.layout, 'same-channel');
  // Wallpaper Engine mora na pasta da Steam, mas é um app: nunca vira "o jogo".
  const wallpaper = D.classifyProcess({ name: 'wallpaper32.exe', pid: 50, path: 'D:\\SteamLibrary\\steamapps\\common\\wallpaper_engine\\wallpaper32.exe', window: true }, { match: () => ({ name: 'Wallpaper Engine', kind: 'app' }), classify: () => ({ isGame: true }), gpu3d: 40 });
  assert.notEqual(wallpaper.role, 'game');
  assert.equal(wallpaper.role, 'background');
  // Vídeo de streaming/VM (Parsec, Hyper-V) não é "placa sem driver".
  for (const name of ['Parsec Virtual Display Adapter', 'Microsoft Hyper-V Video']) {
    const gpu = H.decodeGpu({ name });
    assert.equal(gpu.virtual, true, name);
    assert.equal(gpu.basicDriver, false, name);
    assert.equal(gpu.discrete, false, name);
  }
  assert.equal(H.decodeGpu({ name: 'Microsoft Basic Display Adapter', vendorId: '1414' }).basicDriver, true);
  assert.equal(H.decodeGpu({ name: 'AMD Radeon RX Vega 8 Graphics', vendorId: '1002' }).integrated, true);
  // Saída do monitor sem informação é "desconhecida", nunca VGA.
  assert.equal(Scan.outputOf(null).output, null);
  assert.equal(Scan.outputOf(undefined).output, null);
  assert.equal(Scan.outputOf(0).output, 'VGA');
  // WHEA 18 é erro fatal (tela azul); 19/47 são corrigidos.
  const profile = H.identify(baseInventory());
  const fatal = D.buildFindings({ profile, health: { events: {}, wheaIds: [{ id: 18, count: 2 }] } });
  assert.ok(fatal.some((item) => item.id === 'whea-fatal' && item.severity === 'alta'));
  const corrected = D.buildFindings({ profile, health: { events: {}, wheaIds: [{ id: 19, count: 3 }] } });
  assert.ok(!corrected.some((item) => item.id === 'whea-fatal'));
  // Linux: "estável" só quando o diário pôde ser lido e não tem erro.
  const unread = D.buildFindings({ profile, health: { platform: 'linux', events: {}, journalReadable: false } });
  assert.ok(!unread.some((item) => item.id === 'estavel') && unread.some((item) => item.id === 'diario-linux'));
  const clean = D.buildFindings({ profile, health: { platform: 'linux', events: {}, journalReadable: true } });
  assert.ok(clean.some((item) => item.id === 'estavel'));
  const broken = D.buildFindings({ profile, health: { platform: 'linux', events: { diskIo: 3 }, journalReadable: true } });
  assert.ok(!broken.some((item) => item.id === 'estavel') && broken.some((item) => item.id === 'linux-disco'));
  // Nenhum conselho manda pausar atualização ou desligar proteção.
  const all = JSON.stringify(D.BACKGROUND);
  assert.doesNotMatch(all, /pause as atualiza|pausar (as )?atualiza|desativ\w* o (antiv|defender)|desligu\w* o (antiv|defender)/i);
});

test('entender o setup: o que cada peça significa e o plano para este PC', () => {
  const profile = H.identify(baseInventory({ cpu: { name: 'AMD Ryzen 7 5700X3D 8-Core Processor', cores: 8, threads: 16 }, memory: { modules: baseInventory().memory.modules, slots: 4, maxBytes: 128 * GB }, nvme: [{ name: 'NVMe', link: { curSpeed: 3, maxSpeed: 4, curWidth: 4, maxWidth: 4 } }], network: [{ description: 'Intel Wi-Fi 6 AX201', up: true, kind: 'wifi', wifi: { signal: 70, standard: '802.11ax', band: 5 } }] }));
  const traits = H.traits(profile);
  assert.ok(traits.cpu.some((line) => /cache 3D/.test(line)) && traits.cpu.some((line) => /soquete AM4: fim de linha/.test(line)));
  assert.ok(!traits.board.some((line) => /cai para PCIe 3.0/.test(line)), 'nota da B550 só aparece com Ryzen derivado de APU');
  assert.ok(traits.memory.some((line) => /DIMM_A2 · .*vendido para 3200 CL16, rodando a 2133/.test(line)), 'cada pente com slot, código e velocidades');
  assert.ok(traits.memory.some((line) => /4 slots, 2 livres; aceita até 128 GB/.test(line)));
  assert.ok(traits.disk.some((line) => /PCIe 3.0 x4 \(aceita 4.0 x4\)/.test(line)));
  const findings = D.buildFindings({ profile });
  const steps = D.plan(profile, findings);
  const ids = steps.map((step) => step.id);
  assert.ok(ids.includes('bios-xmp') && ids.includes('lab-cpu') && ids.includes('lab-nvme') && ids.includes('lab-wifi') && ids.includes('watch-session'));
  assert.ok(!ids.includes('lab-hybrid') && !ids.includes('lab-cooling'), 'nada de núcleos E nem resfriamento de notebook num Ryzen de desktop');
  const laptop = D.plan(H.identify(baseInventory({ cpu: { name: '12th Gen Intel(R) Core(TM) i7-12700H', cores: 14, threads: 20 }, system: { chassis: [10] } })), []).map((step) => step.id);
  assert.ok(laptop.includes('lab-hybrid') && laptop.includes('lab-cooling') && laptop.includes('lab-parking'));
  const linux = D.plan(H.identify({ ...baseInventory(), os: { platform: 'linux', name: 'Ubuntu' } }), []).map((step) => step.id);
  assert.ok(!linux.some((id) => id.startsWith('lab-')), 'o laboratório de energia é do Windows');
  for (const step of steps.filter((item) => item.kind === 'laboratorio')) for (const knob of step.knobs) assert.ok(require('../src/lab-space.js').SPACE.some((entry) => entry.id === knob), `ajuste do laboratório existe: ${knob}`);
});

test('notebook gamer de verdade (simulado): da saída do PowerShell ao relatório, sem quebrar em nenhuma etapa', () => {
  const inventory = Scan.parseInventory(JSON.stringify({
    cpu: { name: '13th Gen Intel(R) Core(TM) i7-13650HX', manufacturer: 'GenuineIntel', cores: 14, threads: 20, baseMHz: 2600, socket: 'U3E1' },
    board: { manufacturer: 'LENOVO', product: 'LNVNB161216' }, bios: { vendor: 'LENOVO', version: 'LPCN49WW', date: '2024-05-10' },
    system: { manufacturer: 'LENOVO', model: '82XV', family: 'Legion 5 15IRX9', mobile: true, chassis: 10 },
    memory: { modules: [{ capacity: 8 * GB, speed: 4800, configured: 4800, manufacturer: 'Samsung', part: 'M425R1GB4BB0-CQKOL', type: 34, formFactor: 12, locator: 'DIMM 0', bank: 'P0 CHANNEL A' }, { capacity: 8 * GB, speed: 4800, configured: 4800, manufacturer: 'Samsung', part: 'M425R1GB4BB0-CQKOL', type: 34, formFactor: 12, locator: 'DIMM 0', bank: 'P0 CHANNEL B' }], slots: 2 },
    gpus: [{ name: 'NVIDIA GeForce RTX 4060 Laptop GPU', vendorId: '10DE', deviceId: '28A0', driverVersion: '32.0.15.6094', driverDate: '2024-08-14', vramBytes: 8 * GB, link: { curSpeed: 1, maxSpeed: 4, curWidth: 8, maxWidth: 8 } }, { name: 'Intel(R) UHD Graphics', vendorId: '8086', driverDate: '2024-03-01' }],
    nvme: { name: 'Controlador NVM Express padrão', link: { curSpeed: 4, maxSpeed: 4, curWidth: 4, maxWidth: 4 } },
    displays: [{ adapter: 'Intel(R) UHD Graphics', name: '', output: 2147483648, width: 2560, height: 1440, hz: 60, maxHz: 165, primary: true }, { adapter: 'NVIDIA GeForce RTX 4060 Laptop GPU', name: 'VG249Q1A', output: 5, width: 1920, height: 1080, hz: 60, maxHz: 165 }],
    disks: { model: 'WD PC SN740 SDDPNQD-1T00-1014', media: 'SSD', bus: 'NVMe', size: 1024209543168, health: 'Healthy', rpm: 0, system: true },
    network: [{ name: 'Wi-Fi', description: 'Intel(R) Wi-Fi 6E AX211 160MHz', up: true, linkMbps: 1201, ndis: 9 }, { name: 'Ethernet', description: 'Realtek Gaming 2.5GbE Family Controller', up: false, linkMbps: 0, ndis: 14 }],
    wlan: 'There is 1 interface on the system:\n    Name                   : Wi-Fi\n    State                  : connected\n    Radio type             : 802.11ax\n    Band                   : 2.4 GHz\n    Channel                : 6\n    Signal                 : 38%\n',
    battery: { designWh: 80, fullWh: 54.4 }, os: { caption: 'Microsoft Windows 11 Home', build: 22631 }
  }));
  const profile = H.identify(inventory, { now: Date.parse('2026-11-11T12:00:00Z') });
  assert.equal(profile.kind, 'laptop');
  assert.equal(profile.cpu.raptorRisk, undefined, 'HX de notebook não entra no aviso de desktop');
  assert.equal(profile.cpu.socket, null, 'soquete "U3E1" não é soquete');
  assert.equal(profile.memory.layout, 'dual', 'canal pelo BankLabel (P0 CHANNEL A/B)');
  assert.equal(profile.memory.type, 'DDR5');
  assert.equal(profile.displays[0].internal, true);
  assert.equal(profile.network[0].wifi.band, 2.4);
  assert.equal(profile.battery.wear, 32);
  const health = Scan.parseHealth(JSON.stringify({ events: { whea: { count: 3 }, wheaIds: { id: 17, count: 3 }, firmwareLimit: { count: 5, last: '2026-11-09T22:00:00Z' } }, fastStartup: 1, lastBoot: '2026-10-30T08:00:00Z', overlayAc: '961cc777-2547-4f9d-8174-7d86181b8a7a', planGuid: null }));
  assert.equal(health.wheaIds.length, 1, 'um item só do PowerShell vira lista');
  const findings = D.buildFindings({ profile, health, facts: { hags: 1, gameMode: 1, historical: 1 }, now: Date.parse('2026-11-11T12:00:00Z') });
  const ids = findings.map((item) => item.id);
  for (const expected of ['gpu-hibrida', 'whea-pcie', 'firmware-limite', 'modo-energia', 'tempo-ligado', 'wifi-sinal', 'wifi-24', 'bateria', 'gpu-hags', 'gravacao-fundo']) assert.ok(ids.includes(expected), `achado esperado: ${expected}`);
  assert.ok(ids.filter((id) => id.startsWith('tela-hz-')).length === 2, 'as duas telas a 60 Hz de 165 Hz');
  assert.ok(!ids.includes('tela-placa-mae'), 'tela interna do notebook no vídeo integrado é normal');
  assert.ok(!ids.includes('gpu-linhas'), 'placa x8 nativa em x8 não é problema');
  const story = D.narrative(profile, findings);
  assert.match(story.identity, /^Notebook com Intel Core i7-13650HX \(Raptor Lake com núcleos P e E\)/);
  const traits = H.traits(profile);
  assert.ok(!traits.cpu.some((line) => /soquete/.test(line)), 'notebook não recebe caminho de upgrade de soquete');
  assert.ok(D.plan(profile, findings).some((step) => step.id === 'lab-cooling'));
  assert.ok(D.healthScore(findings) < 100);
});
