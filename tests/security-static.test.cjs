/*
 * Conferências estáticas de segurança (o que os analisadores — SonarCloud, CodeAnt, Devin — apontaram e foi corrigido
 * não pode voltar sem ninguém perceber).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
// No Windows o checkout vem com CRLF: normaliza para as expressões valerem nos dois sistemas.
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const list = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((name) => ext.some((e) => name.endsWith(e))).map((name) => `${dir}/${name}`);
const code = [...list('src', ['.js']), ...list('electron', ['.cjs']), ...list('electron/workers', ['.cjs']), 'main.cjs', 'preload.cjs', 'app.js', 'installer-launcher/main.cjs', 'installer-launcher/renderer.js'];
const csp = (html) => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || '';

test('nada de código a partir de texto: sem eval, new Function ou Worker com eval', () => {
  for (const file of code) {
    const text = read(file);
    assert.doesNotMatch(text, /\beval\s*\(|new Function\s*\(|eval:\s*true/, file);
  }
  // Cada trabalho de medição existe como arquivo próprio e vai fora do app.asar.
  const main = read('main.cjs');
  for (const [, name] of main.matchAll(/workerFile\('([\w-]+\.cjs)'\)/g)) assert.ok(fs.existsSync(path.join(root, 'electron', 'workers', name)), name);
  assert.ok(JSON.parse(read('package.json')).build.asarUnpack.includes('electron/workers/**'));
});

test('política de segurança das telas: sem unsafe-inline, sem curinga, e sem estilo embutido no HTML', () => {
  for (const file of ['index.html', 'installer-launcher/index.html']) {
    const policy = csp(read(file));
    assert.ok(policy, file);
    assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/, file);
    assert.doesNotMatch(policy, /\*/, `${file}: nenhum curinga`);
    assert.doesNotMatch(read(file), /\sstyle="|<style[\s>]/, `${file}: estilo vai em arquivo .css`);
  }
  for (const file of list('src', ['.js'])) assert.doesNotMatch(read(file), / style="/, `${file}: use data-css (aplicado pelo CSSOM)`);
});

test('imagens da Steam: a lista do código e a da política de segurança são as mesmas', () => {
  const { STEAM_IMAGE_HOSTS } = require('../electron/steam-details.cjs');
  const img = csp(read('index.html')).split(';').find((part) => part.trim().startsWith('img-src')).trim().split(/\s+/).slice(1);
  const hosts = img.filter((source) => source.startsWith('https://')).map((source) => new URL(source).hostname).sort();
  assert.deepEqual(hosts, [...STEAM_IMAGE_HOSTS].sort());
});

test('programas do sistema pelo caminho completo, nunca pelo PATH', () => {
  for (const file of ['main.cjs', 'electron/probe.cjs', 'electron/watcher.cjs']) {
    assert.doesNotMatch(read(file), /(?:spawn|spawnFn|execFile|execFileAsync)\('(?:powershell\.exe|powershell|reg|powercfg|taskmgr\.exe|sh|nvidia-smi(?:\.exe)?)'/, file);
  }
  // nvidia-smi: só nos lugares em que o driver da NVIDIA instala; sem ele, nada (nunca procura no PATH).
  const { nvidiaSmi } = require('../electron/system-path.cjs');
  const asked = [];
  assert.equal(nvidiaSmi({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', ProgramW6432: 'C:\\Program Files' }, exists: (file) => { asked.push(file); return false; } }), null);
  assert.deepEqual(asked, ['C:\\Windows\\System32\\nvidia-smi.exe', 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe']);
  assert.equal(nvidiaSmi({ platform: 'linux', env: {}, exists: (file) => file === '/usr/bin/nvidia-smi' }), '/usr/bin/nvidia-smi');
  assert.doesNotMatch(read('installer-launcher/main.cjs'), /execFile\('reg'/);
  assert.doesNotMatch(read('electron/elevate.cjs'), /-FilePath 'powershell\.exe'/);
});

test('listas fixas por chave própria (constructor/toString não passam)', () => {
  const main = read('main.cjs');
  assert.match(main, /Object\.hasOwn\(SETTINGS_PAGES/);
  assert.match(main, /Object\.hasOwn\(EXTERNAL_LINKS/);
  assert.match(read('installer-launcher/main.cjs'), /Object\.hasOwn\(LINKS/);
});

test('workflows: token só de leitura no topo e instalação sem scripts', () => {
  const release = read('.github/workflows/release.yml');
  assert.match(release, /^permissions:\n {2}contents: read/m);
  assert.doesNotMatch(release, /run: npm ci\s*$/m);
  assert.match(read('.github/workflows/codeql.yml'), /^permissions:\n {2}contents: read/m);
});

test('monitor do sistema no Linux: o primeiro instalado, por caminho fixo (nunca pelo PATH); sem nenhum, null', () => {
  // Erro real do painel (assinatura 35fc9ecaa5d00da0): "O Gerenciador de Tarefas está disponível somente no Windows."
  const { systemMonitor } = require('../electron/system-path.cjs');
  assert.equal(systemMonitor({ platform: 'linux', exists: (file) => file === '/usr/bin/plasma-systemmonitor' }), '/usr/bin/plasma-systemmonitor');
  assert.equal(systemMonitor({ platform: 'linux', exists: (file) => file === '/usr/bin/gnome-system-monitor' || file === '/usr/bin/xfce4-taskmanager' }), '/usr/bin/gnome-system-monitor');
  assert.equal(systemMonitor({ platform: 'linux', exists: () => false }), null);
  const asked = [];
  systemMonitor({ platform: 'linux', exists: (file) => { asked.push(file); return false; } });
  assert.ok(asked.length > 0 && asked.every((file) => file.startsWith('/')), 'só caminhos absolutos');
  assert.equal(systemMonitor({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: () => true }), 'C:\\Windows\\System32\\Taskmgr.exe');
});

test('"Ver processos" na tela inicial mostra o motivo se não der para abrir (sem erro solto no console)', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'src', 'view-home.js'), 'utf8');
  assert.match(home, /openTaskManager\?\.\(\)\?\.catch\(\(error\) => showToast\(/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.match(main, /systemMonitor\(\)/, 'o main usa o monitor do sistema (Linux incluído)');
  assert.doesNotMatch(main, /Gerenciador de Tarefas está disponível somente no Windows/);
});

test('vigias: a trilha dos últimos passos vai também nos avisos (o "estranho" precisa do contexto)', () => {
  const main = read('main.cjs');
  const hook = main.slice(main.indexOf('errorLog.record = (entry = {}) => {'), main.indexOf('return recordRaw(entry);'));
  assert.ok(hook.includes('trilha: trail.slice(-12)'));
  assert.doesNotMatch(hook, /entry\.level !== 'aviso'/);
});
