/*
 * Contagem pelo instalador (installer/count.ps1 e installer/installer.nsh). O PowerShell de verdade roda no
 * windows-latest (.github/workflows/installer-check.yml); aqui conferimos o texto e a fórmula.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pcCodeFrom } = require('../electron/cloud.cjs');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const GUID = '4C4C4544-0042-3510-8051-B4C04F4E3732';
const VECTOR = '5494d4d3f02aa76ad4d16aa360ffc47e1c4425d210b921c05a16d5540518c698';

test('count.ps1: mesma fórmula do app, prazo curto, silencioso e sempre sai com 0', () => {
  const ps = read('installer/count.ps1');
  assert.equal(pcCodeFrom(GUID), VECTOR, 'o vetor do script é o do app');
  assert.ok(ps.includes('nexo-pc-v1|'), 'prefixo');
  assert.ok(ps.includes(GUID) && ps.includes(VECTOR), 'vetor fixo no -SelfTest');
  assert.match(ps, /-TimeoutSec 4/);
  assert.match(ps, /'Registry64'/);
  assert.match(ps, /\/v1\/install/);
  assert.match(ps, /\/v1\/optout/);
  assert.match(ps, /\[Environment\]::Exit\(0\)\s*$/, 'sai com 0 mesmo com o pedido ainda pendurado');
  assert.match(ps, /WaitOne\(4000\)/, 'prazo duro de 4 s (o -TimeoutSec não cobre DNS nem proxy)');
  assert.doesNotMatch(ps, /Write-Host|Invoke-Expression|\biex\b|DownloadString|-EncodedCommand/i);
});

test('installer.nsh: caixinha marcada, avisos no instalar/atualizar e no desinstalar (antes de apagar o Registro)', () => {
  const nsh = read('installer/installer.nsh');
  assert.match(nsh, /CountOptIn/);
  assert.match(nsh, /COUNT_LABEL/);
  assert.match(nsh, /Contar esta instalação nas estatísticas do Nexo \(anônimo\)/);
  assert.match(nsh, /Count this install in Nexo's statistics \(anonymous\)/);
  assert.match(nsh, /count\.ps1/);
  assert.match(nsh, /-Event atualizou/);
  assert.match(nsh, /-Event instalou/);
  assert.match(nsh, /-Event optout/);
  const uninstall = nsh.slice(nsh.indexOf('!macro customUnInstall'));
  assert.ok(uninstall.indexOf('-Event desinstalou') > -1, 'desinstalou');
  assert.ok(uninstall.indexOf('-Event desinstalou') < uninstall.indexOf('DeleteRegKey HKCU "Software\\NexoDeviceCare"'), 'aviso antes de apagar o Registro');
});

test('o build leva o count.ps1 para resources e o instalador visual tem a opção', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.extraResources.some((item) => item.from === 'installer/count.ps1' && item.to === 'count.ps1'));
  assert.match(read('installer-launcher/index.html'), /id="o-count"[^>]*checked/);
  assert.match(read('installer-launcher/main.cjs'), /CountOptIn/);
});

test('o servidor do instalador é o mesmo de config/server.json', () => {
  const server = JSON.parse(read('config/server.json')).url;
  assert.ok(read('installer/installer.nsh').includes(`!define NEXO_SERVER "${server}"`), `NEXO_SERVER tem que ser ${server}`);
});

test('installer.nsh: atualização manual (Setup novo por cima) conta como "atualizou", não como reinstalação', () => {
  const nsh = read('installer/installer.nsh');
  const init = nsh.slice(nsh.indexOf('!macro customInit'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInit')));
  assert.match(init, /ReadRegStr \$\w+ HKCU "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/, 'instalação existente por usuário');
  assert.match(init, /ReadRegStr \$\w+ HKLM "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/, 'instalação existente para todos');
  const install = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInstall')));
  assert.match(install, /\$NexoWasInstalled == 1/);
});

test('installer.nsh: o "+1 desligou" só sai quando a caixinha passa de marcada para desmarcada', () => {
  const nsh = read('installer/installer.nsh');
  const install = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInstall')));
  assert.match(install, /\$CountBefore != 0/);
  assert.doesNotMatch(install, /IfNot\} \$\{isUpdated\}[\s\S]*-Event optout/);
});

test('instalador visual: a caixinha da contagem começa como a escolha já gravada (quem desligou não é religado)', () => {
  const main = read('installer-launcher/main.cjs');
  assert.match(main, /reg\.exe'\),\s*\['query', 'HKCU\\\\Software\\\\NexoDeviceCare\\\\Privacy', '\/v', 'CountOptIn'/);
  assert.match(main, /countOn/);
  assert.match(read('installer-launcher/renderer.js'), /\$\('#o-count'\)\.checked = i\.countOn !== false/);
});
