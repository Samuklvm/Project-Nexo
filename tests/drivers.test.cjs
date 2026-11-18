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

const dotnetRelease = (url, hash) => ({ releases: [{ 'release-version': '8.0.34', windowsdesktop: { version: '8.0.34', files: [
  { name: 'windowsdesktop-runtime-win-arm64.exe', rid: 'win-arm64', url: 'https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/8.0.34/windowsdesktop-runtime-8.0.34-win-arm64.exe', hash: 'b'.repeat(128) },
  { name: 'windowsdesktop-runtime-win-x64.zip', rid: 'win-x64', url: 'https://builds.dotnet.microsoft.com/x.zip', hash: 'c'.repeat(128) },
  { name: 'windowsdesktop-runtime-win-x64.exe', rid: 'win-x64', url, hash }
] } }] });
const DN_URL = 'https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/8.0.34/windowsdesktop-runtime-8.0.34-win-x64.exe';

test('drivers: arquivo oficial do .NET só com link da Microsoft e SHA-512 de verdade', () => {
  assert.deepEqual(Main.parseDotnetRelease(dotnetRelease(DN_URL, 'a'.repeat(128))), { version: '8.0.34', url: DN_URL, sha512: 'a'.repeat(128) });
  assert.equal(Main.parseDotnetRelease(dotnetRelease('https://evil.example/x.exe', 'a'.repeat(128))), null);
  assert.equal(Main.parseDotnetRelease(dotnetRelease(DN_URL, 'a'.repeat(64))), null);
  assert.equal(Main.parseDotnetRelease({ releases: [] }), null);
  assert.equal(Main.parseDotnetRelease('lixo'), null);
});

test('drivers: notebook consulta o pacote de notebook da NVIDIA; .NET busca o arquivo de cada versão instalada', async () => {
  assert.match(Main.nvidiaUrl('modern', { notebook: true }), /psid=129&pfid=1006/);
  assert.match(Main.nvidiaUrl('legacy', { notebook: true }), /psid=102&pfid=821/);
  assert.match(Main.nvidiaUrl('modern'), /psid=131&pfid=1092/, 'desktop continua igual');
  const calls = [];
  const notebookNv = { ...nvInfo, IDS: [{ downloadInfo: { ...nvInfo.IDS[0].downloadInfo, DownloadURL: 'https://us.download.nvidia.com/Windows/621.14/621.14-notebook-win10-win11-64bit-international-dch-whql.exe' } }] };
  const svc = Main.createDrivers({
    platform: 'win32', now: () => NOW,
    runPowerShellCode: async (script) => ({ stdout: script.includes('Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DeviceClass }') ? JSON.stringify({ devices: [dev('NVIDIA GeForce RTX 4060 Laptop GPU', 'DISPLAY', 'NVIDIA', '32.0.15.6614', '2025-10-30')], others: [], generic: 3 }) : JSON.stringify({ os: { build: 22631 }, board: { mobile: true }, desktop: ['8.0.11'] }) }),
    fetchJson: async (url) => {
      calls.push(url);
      if (url.includes('geforce')) return url.includes('psid=129') ? notebookNv : nvInfo;
      if (url.endsWith('releases-index.json')) return { 'releases-index': [{ 'channel-version': '8.0', 'latest-runtime': '8.0.34', 'support-phase': 'active', 'releases.json': 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json' }] };
      if (url.endsWith('/8.0/releases.json')) return dotnetRelease(DN_URL, 'a'.repeat(128));
      throw new Error('?');
    }
  });
  const out = await svc.scan();
  assert.match(out.latest.nvidiaNotebook.modern.download, /-notebook-/);
  assert.equal(out.latest.nvidia.modern.version, '621.14', 'o desktop continua sendo lido (versão de referência)');
  assert.deepEqual(out.latest.dotnetFiles['8.0'], { version: '8.0.34', url: DN_URL, sha512: 'a'.repeat(128) });
  assert.ok(calls.includes('https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json'));
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

test('drivers: cada cartão sabe qual arquivo oficial baixar (e só o certo para aquele PC)', () => {
  const find = (model, re) => model.groups.flatMap((g) => g.items).find((item) => re.test(item.id));
  const data = sample();
  data.latest.dotnetFiles = { '8.0': { version: '8.0.34', url: DN_URL, sha512: 'a'.repeat(128) } };
  const desk = D.build(data, NOW);
  const gpu = find(desk, /^video-NVIDIA/);
  assert.equal(gpu.state, 'update');
  assert.deepEqual(gpu.download, { url: 'https://us.download.nvidia.com/Windows/621.14/x.exe', domains: ['nvidia.com'], fileName: 'nvidia-621.14.exe', signer: 'NVIDIA Corporation', size: '1.04 GB', primary: true, label: 'Baixar · 1.04 GB' });
  assert.equal(find(desk, /^video-Intel/).download, null, 'Intel ainda abre o site (projeto 2)');
  const vc86 = find(desk, /^vc-x86$/);
  assert.equal(vc86.state, 'missing');
  assert.equal(vc86.download.fileName, 'vc_redist.x86.exe');
  assert.equal(vc86.download.signer, 'Microsoft Corporation');
  assert.equal(find(desk, /^vc-x64$/).download, null, 'Visual C++ em dia não ganha download');
  const dx = find(desk, /^directx9$/);
  assert.equal(dx.download.fileName, 'dxwebsetup.exe');
  assert.match(dx.download.url, /^https:\/\/download\.microsoft\.com\//);
  const net = find(desk, /^dotnet-8\.0$/);
  assert.equal(net.download.sha512, 'a'.repeat(128));
  assert.equal(net.download.url, DN_URL);
  assert.equal(D.downloadFor(desk, gpu.id).fileName, 'nvidia-621.14.exe');
  assert.equal(D.downloadFor(desk, 'id-que-nao-existe'), null);
  assert.equal(D.downloadFor(null, gpu.id), null);

  // Notebook: só o pacote de notebook; sem ele, nada de download (nunca o de desktop num notebook).
  const nb = sample();
  nb.runtimes.board = { ...nb.runtimes.board, mobile: true };
  const noNotebook = find(D.build(nb, NOW), /^video-NVIDIA/);
  assert.equal(noNotebook.download, null);
  nb.latest.nvidiaNotebook = { modern: { ...Main.parseNvidia(nvInfo), download: 'https://us.download.nvidia.com/Windows/621.14/621.14-notebook-win10-win11-64bit-international-dch-whql.exe' } };
  assert.match(find(D.build(nb, NOW), /^video-NVIDIA/).download.url, /-notebook-/);

  // Placa que a NVIDIA não atualiza mais: sem download.
  const old = sample();
  old.devices[0] = dev('NVIDIA GeForce GTX 760', 'DISPLAY', 'NVIDIA', '30.0.14.7514', '2021-01-01');
  assert.equal(find(D.build(old, NOW), /^video-NVIDIA/).download, null);
  // Link fora do domínio oficial nunca vira download.
  const evil = sample();
  evil.latest.nvidia.modern = { ...evil.latest.nvidia.modern, download: 'https://evil.example/x.exe' };
  assert.equal(find(D.build(evil, NOW), /^video-NVIDIA/).download, null);
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

test('drivers: textos da barra de download e de cada fase', () => {
  assert.equal(D.progressText({ received: 471859200, total: 713031680, speed: 13002342, eta: 19 }), '66% · 12,4 MB/s · faltam 19 s');
  assert.equal(D.progressText({ received: 471859200, total: 713031680, speed: 13002342, eta: 170 }), '66% · 12,4 MB/s · faltam 3 min');
  assert.equal(D.progressText({ received: 471859200, total: null, speed: 13002342, eta: null }), '450 MB · 12,4 MB/s');
  assert.equal(D.progressText({ received: 0, total: 1000, speed: null, eta: null }), '0%');
  assert.equal(D.progressText({ received: 150000, total: 300000, speed: 51200, eta: 3 }), '50% · 50 KB/s · faltam 3 s', 'arquivo pequeno: KB/s, nunca 0,0 MB/s');
  assert.equal(D.phaseText({ phase: 'queued', position: 2 }), 'Na fila (2º)');
  assert.equal(D.phaseText({ phase: 'verifying' }), 'Conferindo a assinatura…');
  assert.equal(D.phaseText({ phase: 'ready', signer: 'NVIDIA Corporation' }), '✓ Assinado pela NVIDIA');
  assert.equal(D.phaseText({ phase: 'ready', signer: 'Microsoft Corporation' }), '✓ Assinado pela Microsoft');
  assert.equal(D.phaseText({ phase: 'install-queued' }), 'Na fila para instalar');
  assert.equal(D.phaseText({ phase: 'installing' }), 'Instalando… siga a janela do fabricante');
  const errors = {
    offline: 'Sem internet. Tente de novo.', domain: 'O link saiu do site oficial, então parei.', redirects: 'O site redirecionou demais, então parei.',
    'too-big': 'O arquivo veio maior que o esperado, então parei.', hash: 'O arquivo não bateu com o oficial, então apaguei por segurança.',
    signature: 'O arquivo não veio assinado pelo fabricante, então apaguei por segurança.', disk: 'Sem espaço no disco.', http: 'O site do fabricante não respondeu.'
  };
  for (const [error, text] of Object.entries(errors)) assert.equal(D.phaseText({ phase: 'error', error }), text);
  assert.equal(D.phaseText({ phase: 'error', error: 'desconhecido' }), 'O download não terminou. Tente de novo.');
  assert.equal(D.phaseText({ phase: 'canceled' }), 'Download cancelado.');
});

test('drivers: depois de instalar, o cartão mantém o aviso e sabe se a versão mudou', () => {
  const item = { id: 'vc-x86', state: 'ok', download: null };
  assert.equal(D.keepsZone(item, null, false), false);
  assert.equal(D.keepsZone(item, null, true), true, 'aviso de reiniciar continua aparecendo mesmo sem download');
  assert.equal(D.keepsZone(item, { phase: 'installed' }, false), true);
  assert.equal(D.keepsZone(item, { phase: 'installing' }, false), true);
  assert.equal(D.keepsZone(item, { phase: 'downloading' }, false), true, 'nova leitura sem internet não some com a barra');
  assert.equal(D.keepsZone(item, { phase: 'ready' }, false), true);
  assert.equal(D.keepsZone(item, { phase: 'canceled' }, false), false);
  assert.equal(D.keepsZone({ ...item, download: { url: 'x' } }, null, false), true);
  assert.equal(D.installOutcome('ok'), 'updated');
  assert.equal(D.installOutcome('unknown'), 'updated');
  for (const state of ['update', 'missing', 'old', 'error']) assert.equal(D.installOutcome(state), 'unchanged');
  assert.equal(D.installOutcome(undefined), 'unchanged');
});

test('drivers: placa NVIDIA já em dia oferece reinstalar (botão discreto), não "Baixar" chamativo', () => {
  const data = sample();
  data.latest.nvidia.modern = { ...data.latest.nvidia.modern, version: '566.14' };
  const gpu = D.build(data, NOW).groups.flatMap((g) => g.items).find((x) => /^video-NVIDIA/.test(x.id));
  assert.equal(gpu.state, 'ok');
  assert.equal(gpu.download.primary, false);
  assert.match(gpu.download.label, /^Reinstalar/);
  const upd = D.build(sample(), NOW).groups.flatMap((g) => g.items).find((x) => /^video-NVIDIA/.test(x.id));
  assert.equal(upd.download.primary, true);
  assert.equal(D.phaseText({ phase: 'error', error: 'file' }), 'Não consegui gravar o arquivo no disco.');
});

test('drivers: guarda os códigos de hardware de cada peça e o modelo exato do PC', () => {
  const row = { ...dev('Realtek Audio', 'MEDIA', 'Realtek', '6.0.9500.1', '2025-01-01', '10EC:0295'), hwids: ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280A6F&REV_1001', 'hdaudio\\func_01&ven_10ec&dev_0295', 'x'.repeat(201), 'PCI\\VEN<script>', 'A', 'B', 'C', 'D', 'E'], inf: 'oem42.inf' };
  const ms = { ...dev('Leitor de cartão SD', 'SDHOST', 'Microsoft', '10.0.22621.1', '2006-06-21', ''), hwids: ['PCI\\VEN_8086&DEV_51C1'] };
  const all = Main.parseAllDrivers(JSON.stringify({ devices: [row], others: [], genericDevices: [ms, { name: '', cls: 'X' }], generic: 87 }));
  assert.deepEqual(all.devices[0].hwids, ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280A6F&REV_1001', 'HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295', 'A', 'B'], 'até 6 códigos lidos, só os válidos');
  assert.equal(all.devices[0].inf, 'oem42.inf');
  assert.equal(all.genericDevices.length, 1);
  assert.deepEqual(all.genericDevices[0].hwids, ['PCI\\VEN_8086&DEV_51C1']);
  assert.equal(all.generic, 87, 'a contagem continua');
  const rt = Main.parseRuntimes(JSON.stringify({ board: { systemMaker: 'Dell Inc.', model: 'XPS 15 9530', sku: '0BEB', version: '\u0007Rev 1', bios: '1.12.0' }, missing: [{ name: 'Controlador', code: 28, cls: 'SYSTEM', ids: '8086:7AE8', hwids: ['PCI\\VEN_8086&DEV_7AE8&SUBSYS_0BEB1028'] }] }));
  assert.equal(rt.board.sku, '0BEB');
  assert.equal(rt.board.version, 'Rev 1');
  assert.equal(rt.board.bios, '1.12.0');
  assert.deepEqual(rt.missing[0].hwids, ['PCI\\VEN_8086&DEV_7AE8&SUBSYS_0BEB1028']);
});

/* ---------------- Projeto 2: catálogos do fabricante do PC (latest.oem) ---------------- */
const fixtureOem = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'oem', name));
const AUDIO_ID = 'HDAUDIO\\FUNC_01&VEN_10EC&DEV_0295&SUBSYS_10280BEB';
const DELL_BOARD = { maker: 'Dell Inc.', product: '0XYZ', systemMaker: 'Dell Inc.', model: 'XPS 15 9530', mobile: true, sku: '0BEB', version: '', bios: '1.10.0' };
function oemSvc({ board = DELL_BOARD, fetchBytes, org = 'Dell Inc.', clock } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-cat-'));
  const calls = { net: [], ps: [] };
  let t = NOW;
  const svc = Main.createDrivers({
    platform: 'win32', now: clock || (() => t), catalogDir: dir, fs: require('node:fs/promises'),
    fetchJson: async () => { throw new Error('offline'); },
    fetchBytes: async (url, opts) => { calls.net.push(url); return fetchBytes(url, opts); },
    runPowerShellCode: async (script) => {
      calls.ps.push(script);
      if (script.includes('expand.exe')) {
        // Imita a tarefa: assinatura conferida e, se for de quem deve, o .cab "expandido" (aqui o .cab já é o XML).
        const m = /expand\.exe -F:\* '([^']+)' '([^']+)'/.exec(script);
        const ok = script.includes(`'${org}'`);
        if (ok) { fs.mkdirSync(m[2], { recursive: true }); fs.copyFileSync(m[1], path.join(m[2], 'Catalog.xml')); }
        return { stdout: JSON.stringify({ status: 'Valid', org, code: ok ? 0 : -1 }) };
      }
      if (script.includes('Win32_PnPSignedDriver | Where-Object')) return { stdout: JSON.stringify({ devices: [{ ...dev('Realtek Audio', 'MEDIA', 'Realtek', '6.0.9500.1', '2025-01-10'), hwids: [AUDIO_ID] }], others: [], generic: 0, genericDevices: [] }) };
      return { stdout: JSON.stringify({ os: { build: 22631 }, board }) };
    }
  });
  return { svc, calls, dir, tick: (ms) => { t += ms; } };
}
const dellNet = (overrides = {}) => async (url) => {
  if (overrides[url]) return overrides[url]();
  if (url.endsWith('fontes.json')) return Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'docs', 'drivers', 'fontes.json')));
  if (url.endsWith('CatalogIndexPC.cab')) return fixtureOem('dell-index.xml');
  if (url.endsWith('0BEB_Catalog.cab')) return fixtureOem('dell-catalog.xml');
  throw new Error(`inesperado: ${url}`);
};

test('oem: sem fabricante identificado não busca nada', async () => {
  const { svc, calls } = oemSvc({ board: { maker: 'Desconhecida', product: 'X', systemMaker: 'Montado', model: 'PC', mobile: false, sku: '', version: '', bios: '' }, fetchBytes: dellNet() });
  const r = await svc.scan();
  assert.equal(r.latest.oem, undefined);
  assert.equal(calls.net.length, 0);
});

test('oem: Dell completo (índice → catálogo), só pacotes que casam, BIOS à parte e cache de 6 h', async () => {
  const { svc, calls, tick } = oemSvc({ fetchBytes: dellNet() });
  const r = await svc.scan();
  const oem = r.latest.oem;
  assert.equal(oem.oem, 'dell');
  assert.equal(oem.key, '0BEB');
  assert.equal(oem.error, undefined);
  assert.deepEqual(oem.packages.map((p) => p.id), ['dell-R1VKP'], 'só o pacote que casa com uma peça deste PC');
  assert.equal(oem.bios.version, '1.14.0');
  assert.ok(oem.at > 0);
  assert.ok(calls.ps.some((s) => s.includes("'Dell Inc.'") && s.includes("'Dell Technologies'")), 'confere a assinatura do .cab pelos nomes da Dell');
  const n = calls.net.length;
  tick(5 * 3600 * 1000);
  await svc.scan({ force: true });
  assert.equal(calls.net.length, n, 'segunda leitura dentro de 6 h não vai à rede');
  tick(2 * 3600 * 1000);
  await svc.scan({ force: true });
  assert.ok(calls.net.length > n, 'depois de 6 h busca de novo');
});

test('oem: .cab assinado por outra empresa não é lido', async () => {
  const { svc } = oemSvc({ fetchBytes: dellNet(), org: 'Evil Corp' });
  const oem = (await svc.scan()).latest.oem;
  assert.equal(oem.error.stage, 'signature');
  assert.equal(oem.error.source, 'dell');
  assert.deepEqual(oem.packages, []);
});

test('oem: lista remota inválida usa a local; "disabled" desliga a fonte', async () => {
  const url = 'https://raw.githubusercontent.com/Samuklvm/Project-Nexo/main/docs/drivers/fontes.json';
  const bad = oemSvc({ fetchBytes: dellNet({ [url]: () => Buffer.from('{"sources": 3}') }) });
  assert.deepEqual((await bad.svc.scan()).latest.oem.packages.map((p) => p.id), ['dell-R1VKP']);
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'drivers', 'fontes.json'), 'utf8'));
  const off = oemSvc({ fetchBytes: dellNet({ [url]: () => Buffer.from(JSON.stringify({ ...local, disabled: ['dell'] })) }) });
  const oem = (await off.svc.scan()).latest.oem;
  assert.equal(oem.disabled, true);
  assert.deepEqual(oem.packages, []);
  assert.equal(off.calls.net.filter((u) => u.includes('dell.com')).length, 0);
});

test('oem: erro de rede no índice vira erro com etapa e a leitura local continua inteira', async () => {
  const { svc } = oemSvc({ fetchBytes: dellNet({ 'https://downloads.dell.com/catalog/CatalogIndexPC.cab': () => { throw new Error('ECONNRESET'); } }) });
  const r = await svc.scan();
  assert.deepEqual(r.latest.oem.error, { source: 'dell', stage: 'index', code: 'network' });
  assert.equal(r.devices.length, 1);
  assert.equal(r.runtimes.board.sku, '0BEB');
});

test('oem: script do .cab só aceita caminhos dentro da pasta de catálogos', () => {
  const s = Main.expandCabScript('C:\\Nexo\\driver-catalogs\\dell\\a.cab', 'C:\\Nexo\\driver-catalogs\\dell\\x', 'C:\\Nexo\\driver-catalogs');
  assert.match(s, /expand\.exe -F:\* 'C:\\Nexo\\driver-catalogs\\dell\\a\.cab' 'C:\\Nexo\\driver-catalogs\\dell\\x'/);
  assert.throws(() => Main.expandCabScript('C:\\Windows\\a.cab', 'C:\\Nexo\\driver-catalogs\\x', 'C:\\Nexo\\driver-catalogs'));
  assert.throws(() => Main.expandCabScript('C:\\Nexo\\driver-catalogs\\..\\a.cab', 'C:\\Nexo\\driver-catalogs\\x', 'C:\\Nexo\\driver-catalogs'));
});

/* ---------------- Projeto 2: cartões dos pacotes do fabricante do PC ---------------- */
const S = require('../electron/oem-sources.cjs');
const DELL_PKGS = S.parseDellCatalog(fixtureOem('dell-catalog.xml').toString('utf8'));
function oemData({ installed = '6.0.9500.1', packages = DELL_PKGS, missing = [], extra = [] } = {}) {
  return {
    platform: 'win32', at: NOW,
    devices: [
      { ...dev('Realtek Audio', 'MEDIA', 'Realtek', installed, '2025-01-10'), hwids: [AUDIO_ID] },
      { ...dev('NVIDIA GeForce RTX 4060 Laptop GPU', 'DISPLAY', 'NVIDIA', '32.0.15.6614', '2025-10-30'), hwids: ['PCI\\VEN_10DE&DEV_28E0&SUBSYS_0BEB1028'] },
      ...extra
    ],
    others: [], genericDevices: [], generic: 0,
    runtimes: { os: { build: 22631 }, board: DELL_BOARD, missing },
    latest: { oem: { oem: 'dell', label: 'Dell XPS 15 9530', key: '0BEB', at: NOW, packages: [...packages, { id: 'dell-VID', source: 'dell', title: 'NVIDIA Graphics Driver', category: 'Video', version: 'A01', driverVersion: '32.0.15.9999', date: '2026-10-01', url: 'https://downloads.dell.com/F/1/nv.exe', fileName: 'nv.exe', kind: 'exe', hardwareIds: ['PCI\\VEN_10DE&DEV_28E0&SUBSYS_0BEB1028'], signers: ['Dell Inc.'] }], bios: { version: '1.14.0', date: '2026-09-15' } } }
  };
}
const cardsOf = (model) => model.groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.id })));

test('oem: áudio Realtek casado vira cartão do pacote Dell no grupo Áudio, com Baixar', () => {
  const model = D.build(oemData(), NOW);
  const pkg = cardsOf(model).find((c) => c.id === 'oem-dell-R1VKP');
  assert.ok(pkg, 'tem o cartão do pacote');
  assert.equal(pkg.group, 'audio');
  assert.equal(pkg.kind, 'oem');
  assert.equal(pkg.state, 'update');
  assert.equal(pkg.brand, 'dell');
  assert.equal(pkg.installed.version, '6.0.9500.1');
  assert.equal(pkg.latest.version, '6.0.9600.1');
  assert.deepEqual(pkg.covers, ['Realtek Audio']);
  assert.equal(pkg.download.primary, true);
  assert.match(pkg.download.label, /^Baixar · Dell/);
  assert.equal(model.summary.update, 1);
  assert.equal(D.STATES.oem, 'Pacote do fabricante disponível');
});

test('oem: a peça coberta perde o botão do site e aponta para o pacote', () => {
  const model = D.build(oemData(), NOW);
  const audio = cardsOf(model).find((c) => c.id === 'audio-Realtek Audio');
  assert.equal(audio.coveredBy, 'oem-dell-R1VKP');
  assert.equal(audio.action, null);
});

test('oem: versão em outro formato vira "pacote do fabricante disponível" e não conta no topo; igual não vira cartão', () => {
  const odd = D.build(oemData({ installed: '6.0.1.9500.1' }), NOW);
  const pkg = cardsOf(odd).find((c) => c.id === 'oem-dell-R1VKP');
  assert.equal(pkg.state, 'oem');
  assert.equal(pkg.download.primary, false);
  assert.equal(odd.summary.update, 0);
  assert.equal(odd.summary.oem, 1);
  const same = D.build(oemData({ installed: '6.0.9600.1' }), NOW);
  assert.equal(cardsOf(same).some((c) => c.kind === 'oem'), false);
  assert.equal(cardsOf(same).find((c) => c.id === 'audio-Realtek Audio').coveredBy, undefined);
});

test('oem: vídeo continua com a NVIDIA mesmo com pacote da Dell; BIOS só no aviso', () => {
  const model = D.build(oemData(), NOW);
  assert.equal(cardsOf(model).some((c) => c.id === 'oem-dell-VID'), false);
  assert.equal(cardsOf(model).some((c) => c.id === 'oem-dell-BIOS1'), false);
  assert.equal(model.oem.label, 'Dell XPS 15 9530');
  assert.deepEqual(model.oem.bios, { version: '1.14.0', date: '2026-09-15', installed: '1.10.0', newer: true });
  assert.equal(model.oem.error, null);
});

test('oem: dispositivo sem driver que casa com um pacote vira atualização no grupo "Sem driver"', () => {
  const model = D.build(oemData({ missing: [{ name: 'PCI Serial IO', code: 28, ids: 'PCI:VEN_8086&DEV_7A4C', hwids: ['PCI\\VEN_8086&DEV_7A4C&SUBSYS_0BEB1028&REV_01'] }] }), NOW);
  const pkg = cardsOf(model).find((c) => c.id === 'oem-dell-7CHKN');
  assert.equal(pkg.group, 'semdriver');
  assert.equal(pkg.state, 'update');
  assert.equal(cardsOf(model).find((c) => c.id.startsWith('pnp-PCI Serial IO')).coveredBy, 'oem-dell-7CHKN');
});

test('oem: downloadFor devolve o plano com assinantes da Dell e das peças, md5 e tipo', () => {
  const model = D.build(oemData(), NOW);
  const plan = D.downloadFor(model, 'oem-dell-R1VKP');
  assert.equal(plan.url, DELL_PKGS.find((p) => p.id === 'dell-R1VKP').url);
  assert.deepEqual(plan.domains, ['dell.com']);
  assert.equal(plan.kind, 'exe');
  assert.equal(plan.source, 'dell');
  assert.ok(plan.signers.includes('Dell Inc.') && plan.signers.includes('Realtek Semiconductor Corp.'));
  assert.equal(plan.fileName, DELL_PKGS.find((p) => p.id === 'dell-R1VKP').fileName);
  assert.equal(D.downloadFor(model, 'oem-nada'), null);
});

test('oem: linha do topo nos três casos (conferida, fonte fora do ar, sem fabricante)', () => {
  const at = Date.parse('2026-11-12T14:32:00');
  assert.match(D.oemLine({ oem: 'dell', label: 'Dell XPS 15 9530', at, error: null }, at + 60000), /^Seu PC: Dell XPS 15 9530 · lista oficial da Dell conferida às \d{2}:\d{2}$/);
  assert.equal(D.oemLine({ oem: 'dell', label: 'Dell XPS 15 9530', at, error: { source: 'dell', stage: 'index', code: 'network' } }, at), 'Seu PC: Dell XPS 15 9530 · fonte da Dell fora do ar agora; tentando de novo mais tarde');
  assert.match(D.oemLine({ oem: 'dell', label: 'Dell XPS 15 9530', at, error: { source: 'dell', stage: 'signature', code: 'unsigned' } }, at), /não passou na conferência da assinatura/);
  assert.match(D.oemLine({ oem: 'msi', label: 'MSI MAG B550 TOMAHAWK', at, support: 'https://www.msi.com/Motherboard/MAG-B550-TOMAHAWK/support' }, at), /^Seu PC: MSI MAG B550 TOMAHAWK · a MSI não tem lista pública/);
  assert.match(D.oemLine({ oem: 'dell', label: 'Dell XPS 15 9530', at, disabled: true }, at), /pausad/);
  assert.equal(D.oemLine(null, at), '');
});

test('oem: texto das peças atendidas (até 3 nomes e "e mais N")', () => {
  assert.equal(D.coversText(['A']), 'Atualiza: A');
  assert.equal(D.coversText(['A', 'B', 'C']), 'Atualiza: A, B e C');
  assert.equal(D.coversText(['A', 'B', 'C', 'D', 'E']), 'Atualiza: A, B, C e mais 2');
  assert.equal(D.coversText([]), '');
  assert.equal(D.phaseText({ phase: 'ready', signer: null }), '✓ Baixado e conferido');
});
