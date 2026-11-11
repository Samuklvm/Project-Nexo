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
const Disk = require('../electron/disk-models.cjs');
const DeepScan = require('../electron/deep-scan.cjs');
const NexoHardware = require('../src/hardware-kb.js');
const NexoDeep = require('../src/deep-analysis.js');

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
  await parses('disco físico por letra', Disk.DISK_MODEL_SCRIPT);
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
  const want = ['priosep', 'sysresp', 'netthumbs', 'menudelay', 'directx', 'stickykeys', 'svc-fax', 'svc-retaildemo', 'svc-wisvc', 'svc-wecsvc', 'usbsuspend', 'waketimers', 'diskidle', 'tcpwait', 'edgebg', 'websearch']
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

  // 4. Disco físico de cada letra (para a temperatura do SSD na Manutenção).
  const disks = Disk.parseDiskModels((await ps(Disk.DISK_MODEL_SCRIPT, 30000)).stdout);
  check(disks.C && disks.C.model, `disco físico por letra: ${JSON.stringify(disks)}`);

  // 5. Leitura do boot e do plano inteiro.
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

  // 6. Análise profunda: os scripts compilam, rodam sem administrador e o resultado é decodificado.
  for (const name of ['INVENTORY_SCRIPT', 'HEALTH_SCRIPT', 'OBSERVE_SCRIPT', 'LOAD_SCRIPT', 'LINK_SCRIPT']) await parses(`análise profunda: ${name}`, DeepScan[name]);
  const invRun = await ps(DeepScan.INVENTORY_SCRIPT, 90000);
  const inventory = DeepScan.parseInventory(invRun.stdout);
  check(inventory && inventory.cpu.name && inventory.cpu.cores >= 1, `inventário: ${inventory ? `${inventory.cpu.name}, ${inventory.cpu.cores} núcleos` : invRun.stdout.slice(0, 400) || invRun.stderr.slice(0, 800)}`);
  if (inventory) {
    check(inventory.memory.modules.length >= 1 || inventory.memory.slots === null, `memória: ${inventory.memory.modules.length} pente(s), ${inventory.memory.slots} slot(s)`);
    check(inventory.disks.length >= 1 && inventory.disks.some((disk) => disk.system), `discos: ${inventory.disks.map((disk) => `${disk.model} ${disk.bus}/${disk.media}${disk.system ? ' (sistema)' : ''}`).join(', ')}`);
    check(inventory.gpus.length >= 1, `vídeo: ${inventory.gpus.map((gpu) => `${gpu.name} link=${JSON.stringify(gpu.link)}`).join(', ')}`);
    console.log(`     telas: ${JSON.stringify(inventory.displays)}`);
    console.log(`     rede: ${JSON.stringify(inventory.network)}`);
    console.log(`     nvme: ${JSON.stringify(inventory.nvme)}`);
    const profile = NexoHardware.identify(inventory);
    console.log(NexoHardware.factLines(profile).map((line) => `     ${line.node.padEnd(8)} ${line.text}`).join('\n'));
  }
  const healthRun = await ps(DeepScan.HEALTH_SCRIPT, 90000);
  const health = DeepScan.parseHealth(healthRun.stdout);
  check(health && health.events && typeof health.events.bugcheck.count === 'number' && health.lastBoot, `saúde: ${health ? `telas azuis ${health.events.bugcheck.count}, apps que fecharam ${health.events.appCrash.count}, plano ${health.planGuid}, paginação ${JSON.stringify(health.pagefile)}` : healthRun.stdout.slice(0, 400) || healthRun.stderr.slice(0, 800)}`);
  const lines = [];
  const observe = DeepScan.streamScript({ script: DeepScan.OBSERVE_SCRIPT, env: { NEXO_TICKS: '3', NEXO_WAIT_MS: '1000' }, timeoutMs: 120000, onLine: (line) => lines.push(DeepScan.parseObserveLine(line)) });
  await observe.done;
  const meta = lines.find((line) => line?.kind === 'meta');
  const ticks = lines.filter((line) => line?.kind === 'tick');
  check(meta && meta.services.size > 5 && meta.procs.size > 10 && ticks.length >= 3 && lines.some((line) => line?.kind === 'end'), `observação: ${meta ? `${meta.procs.size} processos, ${meta.services.size} svchost com serviços` : 'sem meta'}, ${ticks.length} leituras, CPU ${ticks.map((tick) => Math.round(tick.cpu.total ?? -1)).join('/')}, DPC ${ticks.map((tick) => tick.cpu.dpc).join('/')}, máx. freq ${ticks.map((tick) => tick.cpu.maxFreq).join('/')}`);
  if (meta) {
    const summary = NexoDeep.summarizeObservation({ ticks, procs: meta.procs, services: meta.services, probePid: meta.self });
    console.log(`     por trás: ${summary.background.slice(0, 6).map((item) => `${item.label}=${item.cpuAvg}%/${item.impact}`).join(', ') || 'nada'}`);
  }
  const loadLines = [];
  const load = DeepScan.streamScript({ script: DeepScan.LOAD_SCRIPT, env: { NEXO_TICKS: '2' }, timeoutMs: 60000, onLine: (line) => loadLines.push(DeepScan.parseLoadLine(line)) });
  await load.done;
  const loadTicks = loadLines.filter((line) => line?.kind === 'tick');
  check(loadTicks.length >= 2 && loadTicks[0].cores.length >= 1 && loadTicks[0].mhz > 0, `carga: ${loadTicks.length} leituras, ${loadTicks[0]?.cores.length} núcleos, ${loadTicks[0]?.mhz} MHz nominal, desempenho ${loadTicks.map((tick) => tick.perf).join('/')}%`);
  const links = DeepScan.parseLinks((await ps(DeepScan.LINK_SCRIPT, 30000)).stdout);
  check(links.length >= 1, `link PCIe das placas de vídeo: ${JSON.stringify(links)}`);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures.length ? `\n${failures.length} falha(s).` : '\nTudo certo.');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
