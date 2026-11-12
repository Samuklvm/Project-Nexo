/*
 * Página de Drivers: leitura (scripts e parsers), fontes oficiais (NVIDIA, .NET), regras dos cartões, fabricantes e
 * ícones oficiais (só do domínio do fabricante, só imagem de verdade, com cache).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Main = require('../electron/drivers.cjs');
const D = require('../src/drivers.js');
const V = require('../src/vendors.js');
const Icons = require('../electron/vendor-icons.cjs');

const NOW = Date.parse('2026-11-12T12:00:00Z');
const dev = (name, cls, provider, version, date, ids) => ({ name, cls, provider, maker: provider, version, date, ids: ids || null, signed: true });
const nvInfo = { Success: '1', IDS: [{ downloadInfo: { Version: '621.14', ReleaseDateTime: 'Wed Nov 04, 2026', Name: 'GeForce%20Game%20Ready%20Driver', DetailsURL: 'https://www.nvidia.com/en-us/drivers/details/283968/', DownloadURL: 'https://us.download.nvidia.com/Windows/621.14/x.exe', DownloadURLFileSize: '1.04 GB' } }] };

test('drivers: versão NVIDIA, comparação e linha de cada placa', () => {
  assert.equal(D.nvidiaVersion('32.0.15.6614'), '566.14');
  assert.equal(D.nvidiaVersion('31.0.15.5222'), '552.22');
  assert.equal(D.nvidiaVersion('lixo'), null);
  assert.equal(D.compare('621.14', '566.14'), 1);
  assert.equal(D.compare('14.44.35211.00', '14.40'), 1);
  assert.equal(D.compare('8.0.11', '8.0.34'), -1);
  assert.equal(D.compare('1.0', '1.0.0'), 0);
  const line = Main.nvidiaLine;
  assert.equal(line('NVIDIA GeForce RTX 4060 Laptop GPU'), 'modern');
  assert.equal(line('NVIDIA GeForce GTX 1650'), 'modern');
  assert.equal(line('NVIDIA GeForce GTX 1060 6GB'), 'legacy');
  assert.equal(line('NVIDIA GeForce GTX 750 Ti'), 'legacy');
  assert.equal(line('NVIDIA GeForce GTX 770'), 'ended');
  assert.equal(line('NVIDIA Quadro P2000'), 'pro');
  assert.equal(line('AMD Radeon RX 6600'), null);
  for (const name of ['NVIDIA GeForce RTX 4060 Laptop GPU', 'NVIDIA GeForce GTX 1060 6GB', 'NVIDIA GeForce GTX 770', 'NVIDIA Quadro P2000']) assert.equal(D.nvidiaLine(name), line(name), name);
});

test('drivers: só confia no que a NVIDIA e a Microsoft mandam no formato certo', () => {
  assert.deepEqual(Main.parseNvidia(nvInfo), { version: '621.14', date: '2026-11-04', name: 'GeForce Game Ready Driver', details: 'https://www.nvidia.com/en-us/drivers/details/283968/', download: 'https://us.download.nvidia.com/Windows/621.14/x.exe', size: '1.04 GB' });
  const evil = JSON.parse(JSON.stringify(nvInfo));
  evil.IDS[0].downloadInfo.DetailsURL = 'https://nvidia.com.evil.example/x';
  evil.IDS[0].downloadInfo.DownloadURL = 'http://us.download.nvidia.com/x.exe';
  assert.equal(Main.parseNvidia(evil).details, null);
  assert.equal(Main.parseNvidia(evil).download, null);
  assert.equal(Main.parseNvidia({ Success: '1', IDS: [{ downloadInfo: { Version: '<script>' } }] }), null);
  assert.equal(Main.parseNvidia({ Success: '0' }), null);
  assert.match(Main.nvidiaUrl('legacy', { win11: false }), /^https:\/\/gfwsl\.geforce\.com\/.*psid=98&pfid=778&osID=57/);
  const net = Main.parseDotnet({ 'releases-index': [{ 'channel-version': '8.0', 'latest-runtime': '8.0.34', 'support-phase': 'eol', 'eol-date': '2026-11-10' }, { 'channel-version': 'x', 'latest-runtime': '1' }, { 'channel-version': '10.0', 'latest-runtime': '<b>' }] });
  assert.deepEqual(Object.keys(net), ['8.0']);
  assert.equal(net['8.0'].latest, '8.0.34');
  const rt = Main.parseRuntimes(`aviso\n${JSON.stringify({ os: { build: 22631 }, board: { maker: 'ASUSTeK COMPUTER INC.', product: 'TUF\u0007 B550', mobile: false }, vc: { x64: 'v14.44.35211.00', x86: 'abc' }, dx: { d3dx9: true, xinput13: 'sim' }, netfx: 533320, desktop: ['8.0.11', '../../x', '8.0.11'], missing: [{ name: 'PCI', code: 28, ids: '8086:7AE8' }, { name: 'X', code: 'a', ids: 'zz' }] })}`);
  assert.equal(rt.vc.x64, '14.44.35211.00');
  assert.equal(rt.vc.x86, null);
  assert.equal(rt.dx.xinput13, false);
  assert.deepEqual(rt.desktop, ['8.0.11']);
  assert.equal(rt.board.product, 'TUF  B550');
  assert.deepEqual(rt.missing.map((item) => [item.code, item.ids]), [[28, '8086:7AE8'], [null, null]]);
  const all = Main.parseAllDrivers(JSON.stringify({ devices: [dev('NVIDIA GeForce RTX 3060', 'DISPLAY', 'NVIDIA', '32.0.15.6614', '2025-10-30', '10DE:2504')], others: dev('Logitech G502', 'MOUSE', 'Logitech', '1.0', '2023-01-01', '046D:C08B'), generic: 87 }));
  assert.equal(all.devices.length, 1);
  assert.equal(all.others[0].name, 'Logitech G502');
  assert.equal(all.generic, 87);
});

test('drivers: lê uma vez, consulta só as linhas da NVIDIA que existem e não quebra sem internet', async () => {
  const calls = [];
  const svc = Main.createDrivers({
    platform: 'win32', now: () => NOW,
    runPowerShellCode: async (script) => ({ stdout: script.includes('Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DeviceClass }') ? JSON.stringify({ devices: [dev('NVIDIA GeForce RTX 3060', 'DISPLAY', 'NVIDIA', '32.0.15.6614', '2025-10-30')], others: [], generic: 3 }) : JSON.stringify({ os: { build: 22631 }, desktop: ['8.0.11'] }) }),
    fetchJson: async (url) => { calls.push(url); if (url.includes('geforce')) return nvInfo; throw new Error('sem internet'); }
  });
  const first = await svc.scan();
  assert.equal(first.latest.nvidia.modern.version, '621.14');
  assert.equal(first.latest.dotnet, null);
  assert.equal(first.generic, 3);
  assert.equal(calls.filter((url) => url.includes('geforce')).length, 1);
  await svc.scan();
  assert.equal(calls.filter((url) => url.includes('geforce')).length, 1, 'a versão da NVIDIA fica em cache');
  const offline = await svc.scan({ online: false });
  assert.deepEqual(offline.latest, {});
  const linux = await Main.createDrivers({ platform: 'linux', runPowerShellCode: async () => { throw new Error('não chama'); }, fetchJson: async () => ({}) }).scan();
  assert.deepEqual(linux.devices, []);
});

function sample() {
  return {
    at: NOW,
    devices: [
      dev('NVIDIA GeForce RTX 4070 SUPER', 'DISPLAY', 'NVIDIA', '32.0.15.6614', '2025-10-30', '10DE:2783'),
      dev('Intel(R) UHD Graphics 770', 'DISPLAY', 'Intel Corporation', '31.0.101.4502', '2023-06-10'),
      dev('Microsoft Basic Display Adapter', 'DISPLAY', 'Microsoft', '10.0', '2006-06-21'),
      dev('Realtek Gaming 2.5GbE Family Controller', 'NET', 'Realtek', '10.50.511.2021', '2021-05-11', '10EC:8125'),
      dev('Intel(R) Wi-Fi 6E AX211 160MHz', 'NET', 'Microsoft', '22.0.0.1', '2022-01-01', '8086:51F1'),
      dev('WAN Miniport (IP)', 'NET', 'Microsoft', '10.0', '2006-06-21'),
      dev('Realtek(R) Audio', 'MEDIA', 'Realtek Semiconductor Corp.', '6.0.9235.1', '2021-09-01'),
      dev('NVIDIA High Definition Audio', 'MEDIA', 'NVIDIA', '1.4', '2024-01-01'),
      dev('Intel(R) Management Engine Interface #1', 'SYSTEM', 'Intel', '2229.1.4.0', '2022-07-18'),
      dev('Standard NVM Express Controller', 'SCSIADAPTER', 'Microsoft', '10.0', '2006-06-21'),
      dev('Intel(R) Wireless Bluetooth(R)', 'BLUETOOTH', 'Intel Corporation', '23.60.0.1', '2026-06-20')
    ],
    others: [dev('Logitech G502 HERO', 'MOUSE', 'Logitech', '1.0', '2023-01-01', '046D:C08B'), dev('Logitech G502 HERO', 'MOUSE', 'Logitech', '1.0', '2023-01-01'), dev('Coisa Estranha', 'USB', 'Foo Corp', '1', '2024-01-01')],
    generic: 87,
    runtimes: {
      os: { build: 22631 }, board: { maker: 'ASUSTeK COMPUTER INC.', product: 'TUF GAMING B760M-PLUS WIFI', systemMaker: 'System manufacturer', model: 'System Product Name', mobile: false },
      vc: { x64: '14.44.35211.00', x86: null }, uninstall: [{ name: 'Microsoft Visual C++ 2010  x64 Redistributable', version: '10.0.40219' }, { name: 'NVIDIA PhysX System Software', version: '9.23.1019' }],
      dx: { d3dx9: false, xinput13: true }, netfx: 533320, desktop: ['8.0.11', '8.0.30'], vulkan: '1.4.303.0', amd: null, missing: [{ name: 'Dispositivo PCI', code: 28, ids: '8086:7AE8' }, { name: 'Desligado', code: 22 }]
    },
    latest: { nvidia: { modern: Main.parseNvidia(nvInfo) }, dotnet: { '8.0': { latest: '8.0.34', phase: 'eol', eol: '2026-11-10' } } }
  };
}

test('drivers: cartões, estados e botões sempre para o site oficial', () => {
  const model = D.build(sample(), NOW);
  const all = model.groups.flatMap((group) => group.items);
  const byName = (name) => all.find((item) => item.name === name);
  const gpu = byName('NVIDIA GeForce RTX 4070 SUPER');
  assert.equal(gpu.state, 'update');
  assert.equal(gpu.installed.version, '566.14');
  assert.equal(gpu.latest.version, '621.14');
  assert.equal(gpu.brand, 'nvidia');
  assert.equal(gpu.action.url, 'https://www.nvidia.com/en-us/drivers/details/283968/');
  assert.ok(!all.some((item) => /basic display|wan miniport|nvidia high definition/i.test(item.name)), 'sem adaptador virtual nem áudio do HDMI');
  assert.equal(byName('Intel(R) Wi-Fi 6E AX211 160MHz').state, 'generic');
  assert.equal(byName('Realtek Gaming 2.5GbE Family Controller').state, 'old');
  assert.equal(byName('Realtek Gaming 2.5GbE Family Controller').icon, 'i-lan');
  assert.equal(byName('Controladores de disco do Windows').installed.month, null, 'driver do Windows sem a data de 2006');
  assert.equal(byName('Visual C++ (32 bits)').state, 'missing');
  assert.equal(byName('DirectX 9 (componentes antigos)').state, 'missing');
  const dotnet = byName('.NET 8.0 Desktop Runtime');
  assert.equal(dotnet.installed.version, '8.0.30', 'a maior de cada versão');
  assert.equal(dotnet.state, 'update');
  assert.deepEqual(model.groups.find((group) => group.id === 'semdriver').items.map((item) => item.name), ['Dispositivo PCI'], 'desativado de propósito não é erro');
  const others = model.groups.find((group) => group.id === 'outros').items;
  assert.equal(others.filter((item) => item.name === 'Logitech G502 HERO').length, 1, 'sem repetir');
  assert.equal(others.find((item) => item.name === 'Logitech G502 HERO').brand, 'logitech');
  assert.equal(others.find((item) => item.name === 'Coisa Estranha').action, null, 'fabricante desconhecido: sem link inventado');
  assert.match(others[others.length - 1].name, /^87 dispositivos/);
  assert.equal(model.support.maker, 'ASUS');
  assert.equal(model.support.model, 'TUF GAMING B760M-PLUS WIFI');
  assert.ok(D.brands(model).includes('asus') && D.brands(model).includes('logitech'));
  assert.ok(model.summary.update >= 2 && model.summary.missing >= 3);
  assert.match(D.headline(model.summary), /^\d+ atualizaç/);
  // Todo botão abre um site que o processo principal aceita (https e domínio oficial).
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const extra = JSON.parse(`[${/const VENDOR_DOMAINS = \[([\s\S]*?)\];/.exec(mainSource)[1].replace(/\/\/[^\n]*\n/g, '').replace(/'/g, '"')}]`);
  const domains = [...extra, ...V.LIST.map((vendor) => vendor.domain)];
  for (const item of [...all, { action: { url: model.support.url } }].filter((entry) => entry.action)) {
    const url = new URL(item.action.url);
    assert.equal(url.protocol, 'https:', item.action.url);
    assert.ok(domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)), `domínio não liberado: ${url.hostname}`);
  }
});

test('drivers: notebook usa a página do fabricante do notebook e a busca da NVIDIA', () => {
  const data = sample();
  data.runtimes.board = { maker: 'Dell Inc.', product: '0X8DXD', systemMaker: 'Dell Inc.', model: 'G15 5520', mobile: true };
  const model = D.build(data, NOW);
  assert.deepEqual([model.support.maker, model.support.model, model.support.kind], ['Dell', 'G15 5520', 'notebook']);
  const gpu = model.groups[0].items.find((item) => /NVIDIA/.test(item.name));
  assert.equal(gpu.action.url, D.PAGES.nvidia, 'pacote de notebook é outro: abre a busca oficial');
  const empty = D.build({ devices: [], runtimes: null, latest: {} }, NOW);
  assert.equal(D.headline(empty.summary), 'Nenhum driver lido ainda');
});

test('fabricantes: lista sem repetição, domínios válidos e quem fez o driver primeiro', () => {
  const keys = new Set();
  for (const vendor of V.LIST) {
    assert.ok(!keys.has(vendor.key), `chave repetida: ${vendor.key}`);
    keys.add(vendor.key);
    assert.match(vendor.domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, vendor.key);
    if (vendor.host) assert.ok(vendor.host === vendor.domain || vendor.host.endsWith(`.${vendor.domain}`), vendor.key);
    if (vendor.drivers) { const url = new URL(vendor.drivers); assert.equal(url.protocol, 'https:'); assert.ok(url.hostname.endsWith(vendor.domain), `${vendor.key}: página fora do domínio`); }
    for (const id of vendor.ids) assert.match(id, /^[0-9A-F]{4}(:[0-9A-F]{4})?$/, `${vendor.key}: ${id}`);
  }
  assert.ok(V.LIST.length >= 150, 'cobre os fabricantes comuns');
  assert.equal(V.vendorOf({ name: 'Intel(R) Wi-Fi 6 AX201', provider: 'Microsoft' }).key, 'microsoft', 'o ícone é de quem fez o driver');
  assert.equal(V.vendorOf({ name: 'Dispositivo PCI', provider: '', ids: '8086:7AE8' }).key, 'intel');
  assert.equal(V.vendorOf({ name: 'USB Composite Device', provider: '(Standard USB Host Controller)', ids: '1532:0084' }).key, 'razer');
  assert.equal(V.vendorOf({ name: 'AMD GPIO Controller', provider: 'Advanced Micro Devices, Inc' }).key, 'amd');
  assert.equal(V.vendorOf({ name: 'Algo', provider: 'Foo Corp' }) || null, null);
});

test('ícones oficiais: só do domínio do fabricante, só imagem de verdade, com cache', async () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(200)]);
  assert.equal(Icons.sniff(png), 'image/png');
  assert.equal(Icons.sniff(Buffer.from('<html><body>not found</body></html>')), null);
  assert.equal(Icons.sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')), 'image/svg+xml');
  assert.equal(Icons.sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="4"/></svg>')), null);
  assert.equal(Icons.sniff(Buffer.from('<svg><script>alert(1)</script></svg>')), null);
  assert.ok(Icons.allowed('https://images.nvidia.com/a.png', 'nvidia.com'));
  assert.ok(!Icons.allowed('https://nvidia.com.evil.example/a.png', 'nvidia.com'));
  assert.ok(!Icons.allowed('http://www.nvidia.com/a.png', 'nvidia.com'));
  assert.ok(!Icons.allowed('https://user@www.nvidia.com/a.png', 'nvidia.com'));
  assert.deepEqual(Icons.iconLinks('<link rel="icon" href="/f.ico"><link rel="apple-touch-icon" sizes="180x180" href="/t.png"><link rel="icon" type="image/svg+xml" href="https://cdn.nvidia.com/i.svg"><link rel="mask-icon" href="/m.svg">', 'https://www.nvidia.com/'), ['https://cdn.nvidia.com/i.svg', 'https://www.nvidia.com/t.png', 'https://www.nvidia.com/f.ico']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-icons-'));
  try {
    const asked = [];
    const svc = Icons.createVendorIcons({ dir, now: () => NOW, fetchRaw: async (url) => {
      asked.push(url);
      if (url === 'https://www.nvidia.com/') return { url, bytes: Buffer.from('<link rel="icon" href="https://evil.example/x.png"><link rel="apple-touch-icon" href="/t.png">') };
      if (url === 'https://www.nvidia.com/t.png') return { url, bytes: png };
      if (url.startsWith('https://www.intel.com/')) return { url: 'https://evil.example/redirected.png', bytes: png }; // redirecionou para fora
      throw new Error('404');
    } });
    const first = await svc.icons(['nvidia', 'intel', 'nao-existe']);
    assert.deepEqual(Object.keys(first), ['nvidia']);
    assert.match(first.nvidia, /^data:image\/png;base64,/);
    assert.ok(!asked.some((url) => url.includes('evil.example')), 'nunca pede a outro domínio');
    const again = Icons.createVendorIcons({ dir, now: () => NOW + 1000, fetchRaw: async () => { throw new Error('não deveria buscar'); } });
    assert.deepEqual(Object.keys(await again.icons(['nvidia', 'intel'])), ['nvidia'], 'achado e "não achei" ficam em cache');
    const later = Icons.createVendorIcons({ dir, now: () => NOW + 2 * 24 * 3600 * 1000, fetchRaw: async (url) => ({ url, bytes: png }) });
    assert.ok((await later.icons(['intel'])).intel, '"não achei" vale só um dia');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ícones do PC: cada componente com o ícone do próprio programa, nunca caminho de rede', async () => {
  assert.equal(Main.iconPath('"C:\\Program Files\\NVIDIA Corporation\\Installer2\\InstallerCore\\NVI2.DLL",0'), 'C:\\Program Files\\NVIDIA Corporation\\Installer2\\InstallerCore\\NVI2.DLL');
  assert.equal(Main.iconPath('C:\\ProgramData\\Package Cache\\{1}\\VC_redist.x64.exe,0'), 'C:\\ProgramData\\Package Cache\\{1}\\VC_redist.x64.exe');
  assert.equal(Main.iconPath('\\\\servidor\\share\\x.exe'), null, 'caminho de rede mandaria as credenciais do Windows');
  assert.equal(Main.iconPath('C:\\a\\..\\b.exe'), null);
  assert.equal(Main.iconPath('C:\\a\\b.txt'), null);
  const rt = Main.parseRuntimes(JSON.stringify({ systemRoot: 'C:\\WINDOWS', apps: [
    { name: 'Microsoft Visual C++ 2013 Redistributable (x86)', publisher: 'Microsoft Corporation', icon: 'C:\\PC\\vc2013.exe' },
    { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.44', publisher: 'Microsoft Corporation', icon: 'C:\\PC\\VC_redist.x64.exe,0' },
    { name: 'Microsoft Windows Desktop Runtime - 8.0.11 (x64)', publisher: 'Microsoft Corporation', icon: 'C:\\PC\\windowsdesktop.exe,0' },
    { name: 'NVIDIA FrameView SDK', publisher: 'NVIDIA Corporation', icon: 'C:\\a\\fv.exe' },
    { name: 'NVIDIA Graphics Driver 566.14', publisher: 'NVIDIA Corporation', icon: 'C:\\a\\NVI2.DLL,0' },
    { name: 'NVIDIA PhysX System Software 9.23', publisher: 'NVIDIA Corporation', icon: 'C:\\a\\physx.ico' },
    { name: 'Logitech G HUB', publisher: 'Logitech', icon: '\\\\rede\\ghub.exe' }] }));
  assert.deepEqual(Main.iconSources(rt), { vs: 'C:\\PC\\VC_redist.x64.exe', dotnet: 'C:\\PC\\windowsdesktop.exe', physx: 'C:\\a\\physx.ico', directx: 'C:\\WINDOWS\\System32\\dxdiag.exe', nvidia: 'C:\\a\\NVI2.DLL' });
  const asked = [];
  const svc = Main.createDrivers({ platform: 'win32', now: () => NOW, fetchJson: async () => { throw new Error('offline'); },
    runPowerShellCode: async (script) => ({ stdout: script.includes('ConfigManagerErrorCode') ? JSON.stringify({ systemRoot: 'C:\\WINDOWS', apps: [{ name: 'NVIDIA Graphics Driver', publisher: 'NVIDIA Corporation', icon: 'C:\\a\\x.exe' }] }) : '{}' }),
    fileIcon: async (file) => { asked.push(file); return file.endsWith('dxdiag.exe') ? `data:image/png;base64,${'A'.repeat(300)}` : 'data:text/html;base64,PHNjcmlwdD4=' } });
  const out = await svc.scan();
  assert.deepEqual(Object.keys(out.icons), ['directx'], 'só PNG de verdade passa');
  const model = D.build(sample(), NOW);
  const vc = model.groups.find((group) => group.id === 'jogos').items.find((item) => item.id === 'vc-x64');
  assert.deepEqual([vc.brand, vc.brandAlt], ['vs', 'microsoft']);
  assert.ok(D.brands(model).includes('physx') && D.brands(model).includes('directx'));
});
