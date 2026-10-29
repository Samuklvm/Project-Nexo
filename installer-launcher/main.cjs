const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

const PRODUCT = 'Nexo Device Care';   // igual ao productName do app principal
const EXPECTED_MB = 330;              // tamanho aproximado da pasta instalada: meça uma vez e ajuste
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const DEFAULT_DIR = path.join(LOCAL, 'Programs', PRODUCT);

let win, installing = false, lastExe = null;
if (!app.requestSingleInstanceLock()) app.quit();

const setupPath = () => path.join(app.isPackaged ? process.resourcesPath : __dirname, 'payload', 'Nexo-Setup.exe');
const noticesPath = () => path.join(app.isPackaged ? process.resourcesPath : __dirname, 'payload', 'AVISOS.txt');

function createWindow() {
  win = new BrowserWindow({
    width: 920, height: 575, useContentSize: true, resizable: false, maximizable: false,
    frame: false, show: false, backgroundColor: '#060919', title: 'Nexo Device Care',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.on('close', e => { if (installing) e.preventDefault(); });   // não fecha no meio da instalação
  win.once('ready-to-show', () => win.show());
  win.loadFile('index.html');
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

async function dirSize(dir) {
  let total = 0, entries = [];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) { try { total += (await fs.promises.stat(p)).size; } catch {} }
  }
  return total;
}

// O instalador (installer.nsh) lê esta chave no customInit; no modo silencioso as páginas não aparecem.
const setTelemetry = on => new Promise(r => execFile('reg',
  ['add', 'HKCU\\Software\\NexoDeviceCare\\Privacy', '/v', 'DeveloperTelemetryOptIn', '/t', 'REG_DWORD', '/d', on ? '1' : '0', '/f'],
  () => r()));

ipcMain.handle('info', () => ({ defaultDir: DEFAULT_DIR, version: app.getVersion() }));
ipcMain.handle('notices', () => fs.readFileSync(noticesPath(), 'utf8'));
ipcMain.handle('open-link', async (_event, key) => {
  const links = {
    project: 'https://github.com/Samuklvm/Project-Nexo',
    privacy: 'https://github.com/Samuklvm/Project-Nexo/blob/main/PRIVACIDADE.md',
    creator: 'https://github.com/Samuklvm'
  };
  if (!Object.hasOwn(links, key)) return false;
  await shell.openExternal(links[key]);
  return true;
});

ipcMain.handle('pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: path.dirname(DEFAULT_DIR) });
  if (r.canceled || !r.filePaths[0]) return null;
  const d = r.filePaths[0];
  return path.basename(d) === PRODUCT ? d : path.join(d, PRODUCT);
});

ipcMain.handle('install', async (_e, o) => {
  const setup = setupPath();
  if (!fs.existsSync(setup)) return { ok: false, code: 'setup ausente' };
  const target = o.dir || DEFAULT_DIR;
  const lnk = path.join(app.getPath('desktop'), PRODUCT + '.lnk');
  const hadLnk = fs.existsSync(lnk);
  installing = true;
  await setTelemetry(!!o.telemetry);

  const args = ['/S'];
  if (o.dir) args.push('/D=' + o.dir);   // NSIS exige /D= por último; o spawn padrão escapa espaços do caminho.

  // O NSIS silencioso não informa progresso: estimamos pelo tamanho da pasta de destino.
  const t0 = Date.now();
  let pct = 0, busy = false, done = false;
  const timer = setInterval(async () => {
    if (busy || done) return;
    busy = true;
    const bySize = Math.min(0.95, (await dirSize(target)) / (EXPECTED_MB * 1024 * 1024));
    const byTime = Math.min(0.12, (Date.now() - t0) / 90000);
    pct = Math.max(pct, bySize, byTime);
    if (!done && win && !win.isDestroyed()) {
      win.setProgressBar(pct);
      win.webContents.send('progress', Math.floor(pct * 100));
    }
    busy = false;
  }, 600);

  const code = await new Promise(res => {
    const c = spawn(setup, args, { windowsHide: true, stdio: 'ignore' });
    c.on('error', () => res(-1));
    c.on('exit', x => res(x ?? -1));
  });
  done = true; clearInterval(timer); installing = false;
  if (win && !win.isDestroyed()) win.setProgressBar(-1);
  if (code !== 0) return { ok: false, code };

  if (!o.desktop && !hadLnk) fs.rmSync(lnk, { force: true });
  lastExe = path.join(target, PRODUCT + '.exe');
  return { ok: true };
});

ipcMain.handle('open-app', () => {
  if (lastExe && fs.existsSync(lastExe)) spawn(lastExe, [], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
});
ipcMain.on('win', (_e, a) => { if (a === 'min') win.minimize(); else win.close(); });
