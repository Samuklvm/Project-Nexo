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
// Pasta escolhida na janela do Windows (pick-dir). A instalação só aceita ESTA ou a padrão: o que a tela manda é só
// um "use a escolhida", nunca um caminho que vá direto para a linha de comando do instalador.
let pickedDir = null;
const SYSTEM32 = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32');
/** Pasta de instalação segura para ir no /D= do NSIS: absoluta, local (C:\…), sem aspas nem caracteres de controle. */
function safeInstallDir(dir) {
  if (typeof dir !== 'string' || dir.length < 4 || dir.length > 240) return null;
  const normal = path.win32.normalize(dir);
  if (!/^[A-Za-z]:\\/.test(normal) || /["%\r\n\t\0*?<>|]/.test(normal) || normal.includes('..')) return null;
  return normal;
}
if (!app.requestSingleInstanceLock()) app.quit();

const setupPath = () => path.join(app.isPackaged ? process.resourcesPath : __dirname, 'payload', 'Nexo-Setup.exe');

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
const setTelemetry = on => new Promise(r => { execFile(path.join(SYSTEM32, 'reg.exe'),
  ['add', 'HKCU\\Software\\NexoDeviceCare\\Privacy', '/v', 'DeveloperTelemetryOptIn', '/t', 'REG_DWORD', '/d', on ? '1' : '0', '/f'],
  () => r()); });

ipcMain.handle('info', () => ({ defaultDir: DEFAULT_DIR, version: app.getVersion() }));

ipcMain.handle('pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: path.dirname(DEFAULT_DIR) });
  if (r.canceled || !r.filePaths[0]) return null;
  const d = r.filePaths[0];
  const chosen = safeInstallDir(path.basename(d) === PRODUCT ? d : path.join(d, PRODUCT));
  if (!chosen) return null;
  pickedDir = chosen;
  return chosen;
});

ipcMain.handle('install', async (_e, input) => {
  const o = input && typeof input === 'object' ? input : {};
  const setup = setupPath();
  if (!fs.existsSync(setup)) return { ok: false, code: 'setup ausente' };
  // Só a pasta que o próprio processo principal guardou (pick-dir); qualquer outro texto vindo da tela é ignorado.
  const custom = o.dir && pickedDir && o.dir === pickedDir ? pickedDir : null;
  const target = custom || DEFAULT_DIR;
  const lnk = path.join(app.getPath('desktop'), PRODUCT + '.lnk');
  const hadLnk = fs.existsSync(lnk);
  installing = true;
  let timer = null;
  let done = false;
  let code;
  // Qualquer falha no meio (o instalador não abrir, por exemplo) solta a trava de "instalando" e o relógio do progresso.
  try {
    await setTelemetry(!!o.telemetry);

    const args = ['/S'];
    if (custom) args.push('/D=' + custom);   // NSIS: /D= precisa ser o último argumento e sem aspas

    // O NSIS silencioso não informa progresso: estimamos pelo tamanho da pasta de destino.
    const t0 = Date.now();
    let pct = 0, busy = false;
    timer = setInterval(async () => {
      if (busy || done) return;
      busy = true;
      try {
        const bySize = Math.min(0.95, (await dirSize(target)) / (EXPECTED_MB * 1024 * 1024));
        const byTime = Math.min(0.12, (Date.now() - t0) / 90000);
        pct = Math.max(pct, bySize, byTime);
        if (!done && win && !win.isDestroyed()) {
          win.setProgressBar(pct);
          win.webContents.send('progress', Math.floor(pct * 100));
        }
      } finally {
        busy = false;
      }
    }, 600);

    code = await new Promise(res => {
      try {
        const c = spawn(setup, args, { windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore' });
        c.on('error', () => res(-1));
        c.on('exit', x => res(x ?? -1));
      } catch {
        res(-1);
      }
    });
  } finally {
    done = true;
    clearInterval(timer);
    installing = false;
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }
  if (code !== 0) return { ok: false, code };

  if (!o.desktop && !hadLnk) fs.rmSync(lnk, { force: true });
  lastExe = path.join(target, PRODUCT + '.exe'); // pasta conferida acima + nome fixo do produto
  return { ok: true };
});

ipcMain.handle('open-app', () => {
  // Abre só o executável que esta instalação acabou de colocar (caminho montado aqui, sem nada vindo da tela).
  const exe = lastExe && [DEFAULT_DIR, pickedDir].filter(Boolean).some((dir) => path.dirname(lastExe) === dir) ? lastExe : null;
  if (exe && fs.existsSync(exe)) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
});
const LINKS = { privacy: 'https://github.com/Samuklvm/Project-Nexo/blob/main/PRIVACIDADE.md', repo: 'https://github.com/Samuklvm/Project-Nexo' };
ipcMain.handle('open-link', (_e, key) => { if (Object.hasOwn(LINKS, String(key))) return shell.openExternal(LINKS[key]); });
ipcMain.on('win', (_e, a) => { if (a === 'min') win.minimize(); else win.close(); });
