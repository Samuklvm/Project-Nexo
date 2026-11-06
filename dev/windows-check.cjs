/*
 * Conferência num Windows de verdade (CI do GitHub ou um PC de teste, rodando como administrador):
 *  1. todo script PowerShell que o Nexo monta compila (parser do próprio PowerShell);
 *  2. a varredura do Raio-X lê o registro, os serviços e o plano de energia de verdade;
 *  3. aplica alguns ajustes de verdade (HKCU, HKLM, serviço e plano de energia), confere, REVERTE e confere de novo;
 *  4. a leitura do teste com reinício (Explorer, processos, serviços) e a leitura completa do powercfg /qh.
 * Não entra no instalador. Uso: node dev/windows-check.cjs   (só no Windows, como administrador)
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Scan = require('../electron/system-scan.cjs');
const Elevate = require('../electron/elevate.cjs');
const Sys = require('../electron/lab-system.cjs');
const LabSpace = require('../src/lab-space.js');
const { BOOT_SCRIPT } = require('../electron/reboot-test.cjs');

if (process.platform !== 'win32') { console.log('Só no Windows.'); process.exit(0); }
const failures = [];
const check = (ok, message) => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${message}`); if (!ok) failures.push(message); };
const exec = (file, args, timeout = 60000) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
const ps = (script, timeout = 60000) => exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`], timeout);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-check-'));

/** O runner do CI já é administrador: roda o corpo elevado direto (sem a janela do UAC), como o elevate faria. */
async function directElevate(task, args) {
  const out = path.join(tmp, `${task}-${Date.now()}.json`);
  const body = `$ErrorActionPreference = 'Stop'\n$NexoOut = ${Elevate.psQuote(out)}\n${Elevate.TASKS[task](args)}`;
  const result = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Elevate.encode(body)], 120000);
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^﻿/, '')); } catch { /* sem resposta */ }
  if (!parsed) console.log(result.stderr.slice(0, 2000));
  return { declined: false, code: result.code, result: parsed };
}

async function parses(name, script) {
  const file = path.join(tmp, `${name}.ps1`);
  fs.writeFileSync(file, script, 'utf8');
  const result = await ps(`$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile(${Elevate.psQuote(file)}, [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message + ' @ ' + $_.Extent.StartLineNumber } } else { 'OK' }`);
  check(result.stdout.trim() === 'OK', `PowerShell compila: ${name}${result.stdout.trim() === 'OK' ? '' : `\n${result.stdout.trim().slice(0, 1500)}`}`);
}

(async () => {
  // 1. Compilação dos scripts.
  const allHklm = Scan.TWEAKS.filter((tweak) => tweak.entries.some((entry) => entry.hive === 'HKLM')).map((tweak) => ({ id: tweak.id, values: tweak.options.find((option) => option.kind !== 'padrao').values }));
  await parses('leitura do Raio-X', Scan.readScript());
  await parses('Raio-X elevado (todos os ajustes do sistema)', `$NexoOut = 'x'\n${Elevate.TASKS['registry-tweaks']({ changes: allHklm })}`);
  await parses('leitura do boot', BOOT_SCRIPT);
  const launcherSize = Elevate.encode(`$ErrorActionPreference = 'Stop'\n$NexoOut = ${Elevate.psQuote(path.join(os.homedir(), 'AppData', 'Roaming', 'Nexo Device Care', 'elevation', 'registry-tweaks-1730000000000.json'))}\n${Elevate.TASKS['registry-tweaks']({ changes: allHklm })}`).length;
  check(launcherSize < 31000, `linha de comando elevada com todos os ajustes: ${launcherSize} caracteres`);

  // 2. Varredura real.
  const scanner = Scan.createSystemScan({ runPowerShell: ps, run: exec, elevate: directElevate, platform: 'win32' });
  const before = await scanner.scan();
  const available = before.items.filter((item) => item.available);
  check(before.supported && available.length >= 60, `varredura: ${available.length} de ${before.items.length} ajustes disponíveis, ${before.stats.options} opções, VBS ${before.vbs}`);
  const power = available.filter((item) => item.group === 'plano');
  check(power.length >= 1, `plano de energia lido: ${power.map((item) => `${item.id}=${item.current}`).join(', ') || 'nada'}`);
  const services = available.filter((item) => item.id.startsWith('svc-'));
  check(services.length >= 10, `serviços encontrados: ${services.length} (${before.items.filter((item) => item.id.startsWith('svc-') && !item.available).map((item) => item.id).join(', ') || 'todos existem'})`);
  console.log(available.slice(0, 200).map((item) => `     ${item.id.padEnd(22)} ${item.current}`).join('\n'));

  // 3. Aplica de verdade, confere, reverte e confere.
  const want = ['priosep', 'sysresp', 'netthumbs', 'menudelay', 'directx', 'stickykeys', 'svc-fax', 'svc-retaildemo', 'usbsuspend', 'waketimers', 'diskidle', 'tcpwait']
    .map((id) => available.find((item) => item.id === id)).filter(Boolean)
    .map((item) => ({ item, option: item.options.find((option) => JSON.stringify(option.values) !== JSON.stringify(item.values)) })).filter(({ option }) => option);
  const applied = await scanner.apply(want.map(({ item, option }) => ({ id: item.id, values: option.values })));
  check(applied.failed.length === 0, `aplicar ${want.length} ajustes: recusados ${JSON.stringify(applied.failed)}`);
  for (const { item, option } of want) {
    const now = applied.after.items.find((entry) => entry.id === item.id);
    check(JSON.stringify(now.values) === JSON.stringify(option.values), `  ${item.id}: ${item.current} → ${now.current} (esperado ${option.label})`);
  }
  const reverted = await scanner.apply(want.map(({ item }) => ({ id: item.id, values: item.values, revert: true })));
  check(reverted.failed.length === 0, `reverter: recusados ${JSON.stringify(reverted.failed)}`);
  for (const { item } of want) {
    const now = reverted.after.items.find((entry) => entry.id === item.id);
    check(JSON.stringify(now.values) === JSON.stringify(item.values), `  ${item.id} de volta: ${now.current}`);
  }

  // 4. Leitura do boot e do plano inteiro.
  const boot = await ps(BOOT_SCRIPT, 30000);
  let info = {};
  try { info = JSON.parse(boot.stdout.trim()); } catch { info = {}; }
  check(info.processes > 10 && info.services > 10, `leitura do boot: ${boot.stdout.trim()}`);
  const dump = await exec('powercfg', ['/qh', 'scheme_current']);
  const map = Sys.parseQueryAll(dump.stdout);
  const keys = Object.keys(map).filter((key) => !key.startsWith('alias:'));
  check(keys.length >= 20, `powercfg /qh scheme_current: ${keys.length} configurações lidas`);
  const found = LabSpace.SPACE.filter((knob) => map[`${knob.subGuid}/${knob.guid}`]);
  console.log(`     laboratório: ${found.length} de ${LabSpace.SPACE.length} ajustes existem neste Windows`);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures.length ? `\n${failures.length} falha(s).` : '\nTudo certo.');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
