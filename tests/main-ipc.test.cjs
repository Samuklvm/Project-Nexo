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
    isPackaged: false, getVersion: () => '0.2.0-test', getPath: () => userData, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), on() {}, quit() {}, setAppUserModelId() {}
  },
  BrowserWindow: class { constructor() { this.webContents = { on() {}, setWindowOpenHandler() {}, send() {} }; } once() {} on() {} loadURL(url) { loadedUrl = url; } static getAllWindows() { return []; } },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on() {} },
  shell: { openExternal: async () => {} }, Menu: { setApplicationMenu() {} }
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

test('desinstalação completa só existe na versão instalada', async () => {
  await assert.rejects(() => call('app:uninstall'), /versão instalada/);
  const info = await call('app:info');
  assert.equal(info.version, '0.2.0-test');
  assert.equal(info.packaged, false);
});

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
