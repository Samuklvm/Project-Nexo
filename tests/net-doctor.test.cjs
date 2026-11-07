/*
 * Diagnóstico de rede (electron/net-doctor.cjs): o que conta como problema, que correção sugere, e as tarefas com
 * administrador (electron/elevate.cjs) só aceitam dados válidos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, createNetDoctor } = require('../electron/net-doctor.cjs');
const { netDnsBody, netIpv6Body, netResetBody, TASKS } = require('../electron/elevate.cjs');

const dnsRow = (server, medianMs, extra = {}) => ({ server, medianMs, worstMs: medianMs, failures: 0, tries: 6, freshMs: medianMs * 2, freshFailures: 0, ...extra });
const healthy = (over = {}) => ({
  platform: 'win32',
  info: { ifIndex: 12, adapter: { name: 'Ethernet', description: 'Realtek PCIe GbE', linkSpeed: '1 Gbps', media: '802.3', bps: 1e9 }, dnsV4: ['192.168.0.1'], staticV4: [], staticV6: [], proxyEnable: 0, autoDetect: true },
  dnsSystem: [dnsRow('192.168.0.1', 18)], dnsPublic: { cloudflare: dnsRow('1.1.1.1', 12), google: dnsRow('8.8.8.8', 20) },
  lookup: { ok: true, ms: 9 }, ipv4: { ok: true, ms: 14 }, hasIpv6: false, ipv6: null, proxyLookup: { ms: 30, result: 'DIRECT' },
  http: [{ url: 'https://www.google.com/generate_204', ok: true, status: 204, dnsMs: 10, connectMs: 25, tlsMs: 60, firstByteMs: 90, totalMs: 95 }], ...over
});
const levelOf = (result, id) => result.checks.find((check) => check.id === id)?.level;
const fixIds = (result) => result.fixes.map((fix) => fix.id).sort();

test('rede: tudo bem não sugere mudança nenhuma (só as ferramentas de sempre)', () => {
  const result = analyze(healthy());
  assert.equal(result.problems, 0);
  assert.equal(result.warnings, 0);
  assert.equal(result.summary, 'Tudo certo com a rede deste PC.');
  assert.deepEqual(fixIds(result), ['limpar-dns', 'reparo-profundo']);
  assert.ok(result.fixes.find((fix) => fix.id === 'reparo-profundo').lastResort);
});

test('rede: DNS da rede lento com DNS público rápido → trocar o DNS pelo mais rápido', () => {
  const result = analyze(healthy({ dnsSystem: [dnsRow('192.168.0.1', 420, { failures: 1 })], dnsPublic: { cloudflare: dnsRow('1.1.1.1', 15), google: dnsRow('8.8.8.8', 30) } }));
  assert.equal(levelOf(result, 'dns'), 'problema');
  const fix = result.fixes.find((item) => item.id === 'dns-publico');
  assert.equal(fix.provider, 'cloudflare');
  assert.match(result.summary, /1 problema/);
  // DNS que nem responde também conta.
  assert.equal(levelOf(analyze(healthy({ dnsSystem: [dnsRow('192.168.0.1', null, { failures: 6 })] })), 'dns'), 'problema');
  // Nome novo (sem cache) muito lento no DNS da rede, rápido no público.
  assert.equal(levelOf(analyze(healthy({ dnsSystem: [dnsRow('192.168.0.1', 20, { freshMs: 900 })], dnsPublic: { cloudflare: dnsRow('1.1.1.1', 12, { freshMs: 40 }), google: dnsRow('8.8.8.8', 20) } })), 'dns'), 'problema');
});

test('rede: tudo lento (inclusive os DNS públicos) não culpa o DNS', () => {
  const result = analyze(healthy({ dnsSystem: [dnsRow('192.168.0.1', 300)], dnsPublic: { cloudflare: dnsRow('1.1.1.1', 280), google: dnsRow('8.8.8.8', 310) } }));
  assert.equal(levelOf(result, 'dns'), 'aviso');
  assert.ok(!result.fixes.some((fix) => fix.id === 'dns-publico'));
});

test('rede: IPv6 público sem funcionar → preferir IPv4 (com reinício)', () => {
  const result = analyze(healthy({ hasIpv6: true, ipv6: { ok: false, ms: null, failures: 3 } }));
  assert.equal(levelOf(result, 'ipv6'), 'problema');
  const fix = result.fixes.find((item) => item.id === 'preferir-ipv4');
  assert.ok(fix.restart && fix.admin && fix.reversible);
  assert.equal(levelOf(analyze(healthy({ hasIpv6: true, ipv6: { ok: true, ms: 15 } })), 'ipv6'), 'ok');
});

test('rede: proxy morto, procura de proxy lenta e cabo a 100 Mbps', () => {
  const dead = analyze(healthy({ info: { ...healthy().info, proxyEnable: 1, proxyServer: '127.0.0.1:8888' }, proxy: { server: '127.0.0.1:8888', ok: false } }));
  assert.equal(levelOf(dead, 'proxy'), 'problema');
  assert.ok(dead.fixes.some((fix) => fix.id === 'desligar-proxy' && !fix.admin));
  const wpad = analyze(healthy({ proxyLookup: { ms: 4200, result: 'DIRECT' } }));
  assert.equal(levelOf(wpad, 'wpad'), 'problema');
  assert.ok(wpad.fixes.some((fix) => fix.id === 'desligar-autodetect'));
  // Com script de proxy (empresa), só abre as configurações: não mexe sozinho.
  const pac = analyze(healthy({ info: { ...healthy().info, autoConfigUrl: 'http://wpad/wpad.dat' }, proxyLookup: { ms: 4200, result: 'PROXY 10.0.0.1:3128' } }));
  assert.ok(!pac.fixes.some((fix) => fix.id === 'desligar-autodetect'));
  assert.ok(pac.fixes.some((fix) => fix.id === 'abrir-proxy'));
  const cable = analyze(healthy({ info: { ...healthy().info, adapter: { name: 'Ethernet', description: 'Realtek PCIe GbE', linkSpeed: '100 Mbps', media: '802.3', bps: 1e8 } } }));
  assert.equal(levelOf(cable, 'link'), 'aviso');
  assert.match(cable.checks.find((c) => c.id === 'link').title, /100 Mbps/);
});

test('rede: no Linux, sem correções que só existem no Windows', () => {
  const result = analyze(healthy({ platform: 'linux', dnsSystem: [dnsRow('127.0.0.53', 500)] }));
  assert.deepEqual(fixIds(result), ['limpar-dns']);
});

test('rede: medição com rede de mentira (DNS, IPv4, site) monta tudo sem travar', async () => {
  const { EventEmitter } = require('node:events');
  class Resolver { constructor() { this.server = null; } setServers([s]) { this.server = s; } async resolve4(name) { if (name.startsWith('nexo-')) { const e = new Error('x'); e.code = 'ENOTFOUND'; throw e; } return ['1.2.3.4']; } }
  const fakeSocket = () => { const s = new EventEmitter(); s.destroy = () => {}; s.setTimeout = () => {}; setTimeout(() => s.emit('connect'), 1); return s; };
  const https = { get: (url, opts, cb) => { const req = new EventEmitter(); req.destroy = () => {}; setTimeout(() => { const sock = new EventEmitter(); req.emit('socket', sock); sock.emit('lookup'); sock.emit('connect'); sock.emit('secureConnect'); const res = new EventEmitter(); res.statusCode = 204; res.resume = () => {}; cb(res); res.emit('end'); }, 2); return req; } };
  const doctor = createNetDoctor({ dns: { promises: { Resolver, lookup: async () => ({ address: '1.2.3.4' }) }, getServers: () => ['192.168.0.1'] }, net: { connect: fakeSocket, isIPv4: (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip), isIPv6: () => false }, https,
    os: { networkInterfaces: () => ({ eth0: [{ family: 'IPv4', address: '192.168.0.10', internal: false }] }) }, fs: { readFile: async () => { throw new Error('x'); }, stat: async () => { throw new Error('x'); } }, platform: 'linux', resolveProxy: async () => 'DIRECT' });
  const measured = await doctor.measure();
  assert.equal(measured.dnsSystem[0].server, '192.168.0.1');
  assert.equal(measured.dnsSystem[0].failures, 0);
  assert.ok(measured.ipv4.ok);
  assert.equal(measured.http.length, 2);
  const result = analyze(measured);
  assert.equal(result.problems, 0);
});

test('rede: tarefas com administrador só aceitam dados válidos', () => {
  for (const task of ['net-dns', 'net-ipv6', 'net-reset', 'net-flush']) assert.ok(TASKS[task], task);
  assert.match(netDnsBody({ ifIndex: 12, servers: ['1.1.1.1', '2606:4700:4700::1111'] }), /-ServerAddresses @\('1\.1\.1\.1', '2606:4700:4700::1111'\)/);
  assert.match(netDnsBody({ ifIndex: 12, reset: true }), /-ResetServerAddresses/);
  for (const bad of [{ ifIndex: 0, servers: ['1.1.1.1'] }, { ifIndex: 'x', servers: ['1.1.1.1'] }, { ifIndex: 12, servers: [] }, { ifIndex: 12, servers: ["1.1.1.1'; Remove-Item C:\\"] }, { ifIndex: 12, servers: ['8.8.8.8', 'exemplo.com'] }]) assert.throws(() => netDnsBody(bad), /inválid/, JSON.stringify(bad));
  assert.match(netIpv6Body({ value: 32 }), /-Name 'DisabledComponents' -PropertyType DWord -Value 32/);
  assert.match(netIpv6Body({ value: 32 }), /HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters/);
  assert.match(netIpv6Body({ value: null }), /Remove-ItemProperty/);
  for (const bad of [{ value: 256 }, { value: -1 }, { value: '32; x' }, {}]) assert.throws(() => netIpv6Body(bad), /inválido/);
  assert.match(netResetBody(), /netsh\.exe winsock reset[\s\S]*netsh\.exe int ip reset[\s\S]*ipconfig\.exe \/flushdns/);
});
