const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const S = require('../electron/sensor-service.cjs');
const E = require('../electron/elevate.cjs');

test('serviço de sensores: lê o estado do sc.exe e a versão do registro (independe do idioma)', () => {
  assert.equal(S.parseScState('NOME_DO_SERVIÇO: NexoSensors\r\n        TIPO               : 10  WIN32_OWN_PROCESS\r\n        ESTADO             : 4  RUNNING'), 'running', 'Windows em português');
  assert.equal(S.parseScState('        STATE              : 4  RUNNING'), 'running');
  assert.equal(S.parseScState('        STATE              : 1  STOPPED'), 'stopped');
  assert.equal(S.parseScState('[SC] EnumQueryServicesStatus:OpenService FAILED 1060'), null);
  assert.equal(S.parseRegVersion('\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\NexoDeviceCare\\SensorService\r\n    Version    REG_SZ    2.0.0\r\n'), '2.0.0');
  assert.equal(S.sameVersion('2.0.0', '2.0.7'), true);
  assert.equal(S.sameVersion('1.0.0', '2.0.0'), false);
});

function fakeNet(reply) {
  return { connect: () => { const socket = new EventEmitter(); socket.setEncoding = () => {}; socket.destroy = () => {}; socket.write = () => setImmediate(() => reply(socket)); setImmediate(() => socket.emit('connect')); return socket; } };
}

test('serviço de sensores: leitura pelo pipe, em pedaços, e falha vira null', async () => {
  const ok = S.createSensorService({ net: fakeNet((socket) => { socket.emit('data', '{"status":"ready","sour'); socket.emit('data', 'ce":"service"}\n'); }), path });
  assert.deepEqual(await ok.read(), { status: 'ready', source: 'service' });
  const missing = S.createSensorService({ net: { connect: () => { const socket = new EventEmitter(); socket.setEncoding = () => {}; socket.destroy = () => {}; setImmediate(() => socket.emit('error', new Error('ENOENT'))); return socket; } }, path });
  assert.equal(await missing.read(), null);
});

test('serviço de sensores: precisa instalar quando falta ou quando a versão mudou', async () => {
  const make = (sc, reg, version) => S.createSensorService({ path, hostDir: 'C:\\x\\sensor-host', run: async (file) => ({ stdout: file === 'sc.exe' ? sc : file === 'reg.exe' ? reg : version }) });
  assert.equal((await make('', '', '2.0.0\n').status()).needsInstall, true);
  assert.equal((await make('STATE : 4 RUNNING', '    Version    REG_SZ    2.0.0', '2.0.0').status()).needsInstall, false);
  assert.equal((await make('STATE : 4 RUNNING', '    Version    REG_SZ    1.0.0', '2.0.0').status()).needsInstall, true);
  assert.equal((await make('', '', '').status()).needsInstall, false, 'sem o coletor nesta build não tenta instalar');
});

test('serviço de sensores: o PawnIO só passa adiante se o SHA-256 conferir', async () => {
  const files = new Map();
  const fs = { readFile: async (file) => { if (!files.has(file)) throw new Error('x'); return files.get(file); }, writeFile: async (file, data) => files.set(file, data), mkdir: async () => {} };
  const good = Buffer.from('pawnio oficial');
  const pawnio = { url: 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe', sha256: crypto.createHash('sha256').update(good).digest('hex') };
  const calls = [];
  const elevate = async (task, args) => { calls.push([task, args]); return { result: { ok: true, pawnio: 'instalado', service: 'Running' } }; };
  const bad = S.createSensorService({ fs, path, crypto, pawnio, userData: 'C:\\u', hostDir: 'C:\\app\\resources\\sensor-host', fetchBuffer: async () => Buffer.from('adulterado'), elevate });
  await assert.rejects(bad.install(), /não confere/);
  assert.equal(calls.length, 0);
  const svc = S.createSensorService({ fs, path, crypto, pawnio, userData: 'C:\\u', hostDir: 'C:\\app\\resources\\sensor-host', fetchBuffer: async () => good, elevate });
  const result = await svc.install();
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], 'sensor-service');
  assert.equal(calls[0][1].action, 'install');
});

test('elevação do serviço: só caminhos válidos, hash conferido no passo elevado, remoção com PawnIO só se foi o Nexo', () => {
  const body = E.sensorServiceBody({ action: 'install', hostDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\Nexo Device Care\\resources\\sensor-host', pawnioSetup: 'C:\\Users\\a\\AppData\\Roaming\\nexo-device-care\\pawnio\\PawnIO_setup.exe' });
  assert.match(body, new RegExp(E.PAWNIO.sha256));
  assert.match(body, /Get-FileHash/);
  assert.ok(body.indexOf('Copy-Item -LiteralPath') < body.indexOf('Get-FileHash'), 'confere o hash depois de copiar para a pasta protegida');
  assert.match(body, /New-Service -Name 'NexoSensors'/);
  assert.throws(() => E.sensorServiceBody({ action: 'install', hostDir: 'C:\\x"; rm', pawnioSetup: 'C:\\p\\PawnIO_setup.exe' }));
  assert.throws(() => E.sensorServiceBody({ action: 'install', hostDir: 'C:\\app\\sensor-host', pawnioSetup: 'C:\\p\\outro.exe' }));
  assert.throws(() => E.sensorServiceBody({ action: 'format' }));
  assert.match(E.sensorServiceBody({ action: 'uninstall' }), /PawnIOByNexo/);
  assert.ok(E.TASKS['sensor-service']);
  assert.match(E.PAWNIO.url, /^https:\/\/github\.com\/namazso\/PawnIO\.Setup\/releases\/download\//);
});
