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
const cache = path.join(sandbox, 'cache'); const data = path.join(sandbox, 'data'); const config = path.join(sandbox, 'config');
process.env.XDG_CACHE_HOME = cache; process.env.XDG_DATA_HOME = data; process.env.XDG_CONFIG_HOME = config; process.env.HOME = sandbox;
Object.defineProperty(process, 'platform', { value: 'linux' });

const handlers = new Map();
let loadedUrl = null;
const electronStub = {
  app: {
    isPackaged: false, getVersion: () => '0.2.0-test', getAppMetrics: () => [{ cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 51200 } }], getPath: () => userData, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), on() {}, quit() {}, setAppUserModelId() {}
  },
  BrowserWindow: class { constructor() { this.webContents = { on() {}, setWindowOpenHandler() {}, send() {} }; } once() {} on() {} isDestroyed() { return false; } isVisible() { return true; } loadURL(url) { loadedUrl = url; } static getAllWindows() { return []; } },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on() {} },
  shell: { openExternal: async () => {} }, Menu: { setApplicationMenu() {} }, powerMonitor: { isOnBatteryPower: () => false }, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  Tray: class { setToolTip() {} on() {} setContextMenu() {} destroy() {} }, Notification: class { static isSupported() { return false; } show() {} },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, net: { fetch: async () => ({ ok: false }) }, safeStorage: { isEncryptionAvailable: () => false }
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

test('limpeza (Linux): só arquivos antigos do usuário, miniaturas recursivas, Lixeira freedesktop', async () => {
  touch(path.join(tmp, 'velho.tmp'), 10, 1000);
  touch(path.join(tmp, 'recente.tmp'), 1, 500);
  touch(path.join(tmp, 'subpasta', 'fundo-velho.tmp'), 30);                 // temp não é recursivo: deve ficar
  touch(path.join(cache, 'thumbnails', 'large', 'a.png'), 20, 4000);         // miniaturas: recursivo
  touch(path.join(cache, 'thumbnails', 'normal', 'novo.png'), 0, 4000);
  touch(path.join(data, 'Trash', 'files', 'apagado.txt'), 3, 700);
  touch(path.join(data, 'Trash', 'info', 'apagado.txt.trashinfo'), 3, 60);
  try { fs.symlinkSync(path.join(tmp, 'velho.tmp'), path.join(tmp, 'link.tmp')); } catch { /* sem permissão para symlink */ }

  const scan = await call('cleanup:scan');
  const byId = Object.fromEntries(scan.categories.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(byId), ['temp', 'thumbnails', 'crash', 'recycle']);
  assert.equal(byId.temp.fileCount, 1);
  assert.equal(byId.temp.bytes, 1000);
  assert.equal(byId.thumbnails.fileCount, 1);
  assert.equal(byId.recycle.destructive, true);
  assert.equal(byId.recycle.fileCount, 1);
  assert.equal(byId.recycle.bytes, 700);

  const result = await call('cleanup:run', ['temp', 'thumbnails', 'recycle', 'categoria-inventada']);
  assert.equal(result.removedCount, 3);
  assert.equal(result.bytesFreed, 5700);
  assert.ok(!fs.existsSync(path.join(tmp, 'velho.tmp')));
  assert.ok(fs.existsSync(path.join(tmp, 'recente.tmp')));
  assert.ok(fs.existsSync(path.join(tmp, 'subpasta', 'fundo-velho.tmp')));
  assert.ok(fs.existsSync(path.join(cache, 'thumbnails', 'normal', 'novo.png')));
  assert.ok(!fs.existsSync(path.join(cache, 'thumbnails', 'large')), 'pasta vazia deveria ser podada');
  assert.equal(fs.readdirSync(path.join(data, 'Trash', 'info')).length, 0);
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
  assert.ok(Array.isArray(await call('power:list')));
  await assert.rejects(() => call('power:set', '00000000-0000-0000-0000-000000000000'), /não reconhecido/);
  fs.mkdirSync(path.join(config, 'autostart'), { recursive: true });
  fs.writeFileSync(path.join(config, 'autostart', 'chat.desktop'), '[Desktop Entry]\nName=Chat\nExec=/usr/bin/chat --tray\n');
  fs.writeFileSync(path.join(config, 'autostart', 'oculto.desktop'), '[Desktop Entry]\nName=Oculto\nExec=x\nHidden=true\n');
  const startup = await call('startup:list');
  assert.ok(startup.some((item) => item.name === 'Chat' && item.location === 'Usuário'));
  assert.ok(!startup.some((item) => item.name === 'Oculto'));
  assert.deepEqual(await call('privacy:get'), { shareWithCreator: false });
});

test('links e páginas do Windows só aceitam o que está na lista', async () => {
  await assert.rejects(() => call('app:open-link', 'https://malicioso.exemplo'), /não permitido/);
  await assert.rejects(() => call('system:open-settings', 'startup'), /Windows/);
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
  assert.equal((await call('session:probe-start')).ok, true, 'no Linux a sonda roda em Node');
  assert.equal((await call('session:probe-stop')).ok, true);
  const fps = await call('fps:status');
  assert.equal(fps.source, 'mangohud');
  assert.match(fps.launchOption, /^MANGOHUD_CONFIG="output_folder=.*mangohud,autostart_log=1,log_interval=0" mangohud %command%$/);
  await assert.rejects(() => call('fps:choose'), /MangoHud/);
  assert.equal((await call('fps:start', { pid: 1234 })).ok, true);
  assert.equal((await call('fps:stop')).frames, 0);
});

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('0.5.0: canais novos de laboratório, biblioteca, conta, acesso ao FPS e preferências', async () => {
  for (const channel of ['lab:status', 'lab:preflight', 'lab:run', 'lab:cancel', 'lab:recover', 'games:scan', 'games:list', 'games:launch', 'games:set-cover', 'games:add', 'account:get', 'account:sign-in', 'account:sign-out', 'account:import-config', 'fps:access', 'fps:grant', 'fps:revoke', 'settings:get', 'settings:set', 'system:facts', 'watch:current']) {
    assert.ok(handlers.has(channel), `faltou ${channel}`);
  }
  const status = await call('lab:status');
  assert.equal(status.running, false);
  assert.deepEqual(status.space.map((knob) => knob.id), ['ppd'], 'no Linux o laboratório testa os perfis de energia');
  const pre = await call('lab:preflight');
  assert.equal(pre.platform, 'linux');
  const run = await call('lab:run', { consent: { acknowledged: true, phrase: 'ENTENDO O RISCO' } });
  assert.equal(run.status, 'aborted', 'sem power-profiles-daemon e sem sensor, não roda');
  assert.ok(['sem-temperatura', 'sem-ajustes', 'bateria', 'quente', 'ocupado'].includes(run.guard), run.guard);
  assert.deepEqual(await call('games:scan'), []);
  const account = await call('account:get');
  assert.equal(account.configured, false);
  assert.equal(account.profile, null);
  await assert.rejects(call('account:sign-in'), /não foi configurado/);
  const settings = await call('settings:set', { tray: false, autoSession: false, bogus: true, openAtLogin: 'sim' });
  assert.equal(settings.openAtLogin, false);
  assert.equal('bogus' in settings, false);
  assert.equal((await call('fps:access')).ready, true, 'no Linux o MangoHud não precisa de grupo');
  await assert.rejects(call('bench:cpu', { mode: 'turbo' }), /inválido/);
  await assert.rejects(call('system:open-settings', 'graphics'), /Windows/);
});

test('0.6.0: conexões, capas oficiais e leveza', async () => {
  for (const channel of ['connections:get', 'steam:connect', 'steam:disconnect', 'steam:set-key', 'xbox:sign-in', 'xbox:sign-out', 'discord:set', 'presence:update', 'integrations:import', 'games:fetch-art', 'games:details', 'app:open-store-url', 'app:self-metrics', 'system:tier']) assert.ok(handlers.has(channel), `faltou ${channel}`);
  const view = await call('connections:get');
  assert.equal('nintendo' in view, false);
  assert.equal(view.xbox.configured, false);
  assert.equal(view.discord.configured, false);
  await assert.rejects(call('xbox:sign-in'), /não foi configurada/);
  await assert.rejects(call('steam:connect', '76561198000000002'), /não entrou/);
  assert.ok(['fraco', 'medio', 'forte'].includes((await call('system:tier')).tier));
  assert.ok(Number.isFinite((await call('app:self-metrics')).memMB));
  assert.deepEqual(await call('presence:update', { kind: 'game', name: 'X' }), { ok: true });
  await assert.rejects(call('app:open-store-url', 'https://evil.example/x'), /não permitido/);
  await assert.rejects(call('games:details', 'steam-1'), /não encontrado/);
});
