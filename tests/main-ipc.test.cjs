// Carrega o main.cjs real com um Electron simulado e exercita os handlers de IPC.
// Roda em qualquer sistema: força a plataforma "linux" para não chamar PowerShell/reg/powercfg.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ipc-'));
const tmp = path.join(sandbox, 'tmp'); const local = path.join(sandbox, 'local'); const userData = path.join(sandbox, 'userData');
for (const dir of [tmp, local, userData]) fs.mkdirSync(dir, { recursive: true });
process.env.TMPDIR = tmp; process.env.TEMP = tmp; process.env.TMP = tmp; process.env.LOCALAPPDATA = local;
Object.defineProperty(process, 'platform', { value: 'linux' });

const handlers = new Map();
let loadedUrl = null;
const electronStub = {
  app: {
    isPackaged: false, getVersion: () => '0.2.0-test', getAppMetrics: () => [{ cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 51200 } }], getPath: () => userData, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), on() {}, quit() {}, setAppUserModelId() {}
  },
  BrowserWindow: class { constructor() { this.webContents = { on() {}, setWindowOpenHandler() {}, send() {} }; } once() {} on() {} loadURL(url) { loadedUrl = url; } static getAllWindows() { return []; } },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on() {} },
  shell: { openExternal: async () => {} }, Menu: { setApplicationMenu() {} }, powerMonitor: { isOnBatteryPower: () => false }, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
};
const updaterStub = { autoUpdater: { on() {}, autoDownload: false, autoInstallOnAppQuit: false, checkForUpdates: async () => null, logger: null } };
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  if (request === 'electron-updater') return updaterStub;
  return originalLoad.call(this, request, ...rest);
};
require('../main.cjs');
Module._load = originalLoad;

const call = (channel, ...args) => handlers.get(channel)({ senderFrame: { url: loadedUrl || require('node:url').pathToFileURL(path.join(__dirname, '..', 'index.html')).href } }, ...args);
const daysAgo = (days) => new Date(Date.now() - days * 86400000);
function touch(file, ageDays, size = 100) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
  fs.utimesSync(file, daysAgo(ageDays), daysAgo(ageDays));
}

test('registra todos os canais esperados', () => {
  for (const channel of ['cleanup:scan', 'cleanup:run', 'power:list', 'power:set', 'startup:list', 'wallpaper:set', 'wallpaper:get', 'wallpaper:reset', 'privacy:get', 'privacy:set', 'app:uninstall', 'app:info', 'app:open-link', 'system:open-settings']) {
    assert.ok(handlers.has(channel), `faltou ${channel}`);
  }
});

test('rejeita chamadas vindas de outra origem', async () => {
  await assert.rejects(async () => handlers.get('cleanup:scan')({ senderFrame: { url: 'https://exemplo.com' } }), /Origem não autorizada/);
});

test('limpeza: remove só arquivos antigos, ignora recentes e links, poda pastas vazias', async () => {
  touch(path.join(tmp, 'velho.tmp'), 10, 1000);
  touch(path.join(tmp, 'recente.tmp'), 1, 500);
  touch(path.join(tmp, 'subpasta', 'fundo-velho.tmp'), 30);            // temp não é recursivo: deve ficar
  touch(path.join(local, 'CrashDumps', 'a', 'crash.dmp'), 20, 4000);   // categoria recursiva: remove
  touch(path.join(local, 'CrashDumps', 'novo.dmp'), 0, 4000);
  try { fs.symlinkSync(path.join(tmp, 'velho.tmp'), path.join(tmp, 'link.tmp')); } catch { /* sem permissão para symlink */ }

  const scan = await call('cleanup:scan');
  const byId = Object.fromEntries(scan.categories.map((c) => [c.id, c]));
  assert.equal(byId.temp.fileCount, 1);
  assert.equal(byId.temp.bytes, 1000);
  assert.equal(byId.crashdumps.fileCount, 1);
  assert.equal(byId.recycle.destructive, true);

  const result = await call('cleanup:run', ['temp', 'crashdumps', 'categoria-inventada']);
  assert.equal(result.removedCount, 2);
  assert.equal(result.bytesFreed, 5000);
  assert.ok(!fs.existsSync(path.join(tmp, 'velho.tmp')));
  assert.ok(fs.existsSync(path.join(tmp, 'recente.tmp')));
  assert.ok(fs.existsSync(path.join(tmp, 'subpasta', 'fundo-velho.tmp')));
  assert.ok(fs.existsSync(path.join(local, 'CrashDumps', 'novo.dmp')));
  assert.ok(!fs.existsSync(path.join(local, 'CrashDumps', 'a')), 'pasta vazia deveria ser podada');
});

test('papel de parede: valida o tipo real, grava, lê e restaura', async () => {
  await assert.rejects(() => call('wallpaper:set', Buffer.from('isto não é uma imagem')), /PNG, JPEG ou WebP/);
  await assert.rejects(() => call('wallpaper:set', Buffer.alloc(13 * 1024 * 1024, 0x89)), /12 MB/);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const { url } = await call('wallpaper:set', new Uint8Array(png));
  assert.match(url, /^file:.*wallpaper\.png\?v=\d+$/);
  assert.equal((await call('wallpaper:get')).url, url);
  assert.equal((await call('wallpaper:reset')).url, null);
  assert.equal((await call('wallpaper:get')).url, null);
});

test('energia, inicialização e privacidade têm retorno seguro fora do Windows', async () => {
  assert.deepEqual(await call('power:list'), []);
  await assert.rejects(() => call('power:set', '00000000-0000-0000-0000-000000000000'), /não reconhecido/);
  assert.deepEqual(await call('startup:list'), []);
  assert.deepEqual(await call('privacy:get'), { shareWithCreator: false });
});

test('links e páginas do Windows só aceitam o que está na lista', async () => {
  await assert.rejects(() => call('app:open-link', 'https://malicioso.exemplo'), /não permitido/);
  await assert.rejects(() => call('system:open-settings', 'cmd'), /não permitida/);
  assert.deepEqual(await call('app:open-link', 'repo'), { ok: true });
});

test('documentação: só abre páginas oficiais da Microsoft', async () => {
  assert.deepEqual(await call('app:open-doc', 'https://learn.microsoft.com/powershell/module/storage/optimize-volume'), { ok: true });
  assert.deepEqual(await call('app:open-doc', 'https://support.microsoft.com/kb/929833'), { ok: true });
  for (const bad of ['http://learn.microsoft.com/x', 'https://learn.microsoft.com.evil.com/x', 'https://exemplo.com', 'file:///C:/Windows/notepad.exe', 42]) {
    await assert.rejects(() => call('app:open-doc', bad), /não permitido/, String(bad));
  }
});

test('desinstalação completa só existe na versão instalada', async () => {
  await assert.rejects(() => call('app:uninstall'), /versão instalada/);
  const info = await call('app:info');
  assert.equal(info.version, '0.2.0-test');
  assert.equal(info.packaged, false);
});

test('benchmark de CPU: valida o modo, mede em um e vários núcleos e pode ser cancelado', async () => {
  await assert.rejects(() => call('bench:cpu', { mode: 'estresse' }), /inválido/);
  const single = await call('bench:cpu', { mode: 'single', ms: 200 });
  assert.equal(single.threads, 1);
  assert.ok(single.mopsPerSec > 1, `taxa implausível: ${single.mopsPerSec}`);
  const multi = await call('bench:cpu', { mode: 'multi', ms: 200 });
  assert.ok(multi.threads >= 1 && multi.mopsPerSec > 1);
  const pending = call('bench:cpu', { mode: 'single', ms: 3000 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await assert.rejects(() => call('bench:cpu', { mode: 'single', ms: 200 }), /em andamento/);
  await call('bench:cancel');
  await assert.rejects(() => pending, /cancelado/);
  assert.deepEqual(await call('system:power-source'), { onBattery: false });
});

test('sessão: amostra do sistema por núcleo, sonda e FPS têm retorno seguro fora do Windows', async () => {
  const first = await call('session:sample');
  assert.equal(first.cpu, null, 'a primeira leitura só marca o ponto de partida');
  await new Promise((resolve) => setTimeout(resolve, 60));
  const second = await call('session:sample');
  assert.ok(Number.isFinite(second.cpu) && second.cpu >= 0 && second.cpu <= 100);
  assert.ok(second.maxCore >= second.cpu - 1e-9);
  assert.ok(second.mem > 0 && second.mem < 100);
  assert.equal(second.appMemMB, 50);
  assert.equal((await call('session:probe-start')).ok, false);
  assert.equal((await call('session:probe-test')).ok, false);
  assert.deepEqual(await call('fps:status'), { available: false, source: null, name: null, platform: 'linux' });
  assert.equal((await call('fps:choose')).canceled, true);
  await assert.rejects(() => call('fps:start', { pid: 1234 }), /só existe no Windows/);
  assert.equal((await call('fps:stop')).frames, 0);
});

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
