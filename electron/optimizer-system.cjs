/*
 * "Otimizar este PC" no Windows: lê o que o plano precisa (início, placas de rede, energia, o jogo escolhido),
 * aplica as mudanças com UMA permissão do Windows (UAC) para tudo que precisa de administrador, guarda o valor
 * anterior de cada uma e reverte quando pedido. Mede o ping até o roteador e até a internet.
 *
 * O registro das otimizações (com os valores anteriores) fica aqui no processo principal, em userData: a interface
 * pede "reverter a otimização X" e nunca manda o valor que vai ser gravado.
 */
'use strict';

const Actions = require('./optimizer-actions.cjs');

const UTF8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = \'SilentlyContinue\'\n';
const STORE_LIMIT = 12;
const GAME_SKIP = /^(unins\d*|uninstall|setup|install(er)?|vc_?redist.*|dxsetup|dotnet.*|crash.*|.*crashhandler.*|.*reporter.*|unitycrashhandler\d*|launcher|.*helper|.*updater|.*update|redist|ue4prereqsetup.*|easyanticheat.*|battleye.*|.*benchmark.*|cefprocess|.*webhelper|qtwebengineprocess)\.exe$/i;

/** Nome bonito de um app da Loja a partir da família do pacote. */
const PACKAGED_NAMES = [
  [/^MSTeams_/i, 'Microsoft Teams'], [/^MicrosoftTeams_/i, 'Microsoft Teams'], [/^SpotifyAB\.SpotifyMusic_/i, 'Spotify'], [/^5319275A\.WhatsAppDesktop_/i, 'WhatsApp'],
  [/^TelegramMessengerLLP\./i, 'Telegram'], [/^Microsoft\.YourPhone_/i, 'Vincular ao Celular'], [/^Microsoft\.GamingApp_/i, 'Xbox'], [/^Microsoft\.XboxApp_/i, 'Xbox'],
  [/^Microsoft\.Copilot_/i, 'Copilot'], [/^Microsoft\.MicrosoftEdge/i, 'Microsoft Edge'], [/^Microsoft\.549981C3F5F10_/i, 'Cortana'], [/^Discord/i, 'Discord'],
  [/^Microsoft\.OutlookForWindows_/i, 'Outlook'], [/^Microsoft\.Todos_/i, 'Microsoft To Do'], [/^Microsoft\.SkypeApp_/i, 'Skype'], [/^NVIDIACorp\./i, 'NVIDIA'],
  [/^AdvancedMicroDevicesInc/i, 'AMD Software'], [/^RealtekSemiconductorCorp\./i, 'Realtek Audio Console'], [/^AppUp\.IntelGraphicsExperience_/i, 'Intel Graphics Command Center'],
  [/^Microsoft\.SecHealthUI_/i, 'Segurança do Windows'], [/^Microsoft\.WindowsTerminal_/i, 'Terminal do Windows']
];
function packagedName(name) {
  const family = String(name).split('\\')[0];
  for (const [pattern, label] of PACKAGED_NAMES) if (pattern.test(family)) return label;
  return family.replace(/_[a-z0-9]{13}$/i, '').split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Leitura do início: Run (usuário, PC e 32 bits), pastas Inicializar e apps da Loja, com o estado de cada um. */
const STARTUP_SCRIPT = UTF8 + String.raw`
$base = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'
function Approved($hive, $sub, $name) {
  try { $v = (Get-ItemProperty -LiteralPath "$($hive):\$base\$sub" -Name $name -ErrorAction Stop).$name; if ($v -is [byte[]]) { return ([BitConverter]::ToString($v) -replace '-', '') } } catch {}
  return $null
}
function ExeOf([string]$cmd) {
  $c = [Environment]::ExpandEnvironmentVariables($cmd).Trim()
  if ($c.StartsWith('"')) { $e = $c.IndexOf('"', 1); if ($e -gt 1) { return $c.Substring(1, $e - 1) } }
  $m = [regex]::Match($c, '^(.+?\.exe)(\s|$)', 'IgnoreCase'); if ($m.Success) { return $m.Groups[1].Value }
  return ($c -split '\s+')[0]
}
function Info([string]$file) {
  $o = @{ exe = ''; description = ''; company = '' }
  if (-not $file) { return $o }
  $o.exe = [IO.Path]::GetFileName($file)
  try { $vi = (Get-Item -LiteralPath $file -ErrorAction Stop).VersionInfo; $o.description = [string]$vi.FileDescription; $o.company = [string]$vi.CompanyName } catch {}
  return $o
}
$out = New-Object System.Collections.ArrayList
foreach ($s in @(@('user-run', 'HKCU', 'Software\Microsoft\Windows\CurrentVersion\Run', 'Run'), @('machine-run', 'HKLM', 'SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'Run'), @('machine-run32', 'HKLM', 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', 'Run32'))) {
  $key = Get-Item -LiteralPath "$($s[1]):\$($s[2])"
  if (-not $key) { continue }
  foreach ($n in $key.GetValueNames()) {
    if (-not $n) { continue }
    $i = Info (ExeOf ([string]$key.GetValue($n)))
    [void]$out.Add([pscustomobject]@{ source = $s[0]; name = $n; exe = $i.exe; description = $i.description; company = $i.company; approved = (Approved $s[1] $s[3] $n) })
  }
}
foreach ($f in @(@('user-folder', 'HKCU', 'Startup'), @('machine-folder', 'HKLM', 'CommonStartup'))) {
  $dir = [Environment]::GetFolderPath($f[2])
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $dir -File) {
    if ($file.Name -eq 'desktop.ini') { continue }
    $target = $file.FullName
    if ($file.Extension -eq '.lnk') { try { $target = (New-Object -ComObject WScript.Shell).CreateShortcut($file.FullName).TargetPath } catch {} }
    $i = Info $target
    [void]$out.Add([pscustomobject]@{ source = $f[0]; name = $file.Name; exe = $i.exe; description = $i.description; company = $i.company; approved = (Approved $f[1] 'StartupFolder' $file.Name) })
  }
}
$pk = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData'
foreach ($fam in Get-ChildItem -LiteralPath $pk) {
  foreach ($task in Get-ChildItem -LiteralPath $fam.PSPath) {
    $st = (Get-ItemProperty -LiteralPath $task.PSPath -Name 'State').State
    if ($null -eq $st) { continue }
    [void]$out.Add([pscustomobject]@{ source = 'packaged'; name = ($fam.PSChildName + '\' + $task.PSChildName); exe = ''; description = ''; company = ''; approved = [string][int]$st })
  }
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Compress -Depth 3))`;

/** Placas de rede em uso, com as propriedades avançadas do catálogo (só leitura, sem administrador). */
function nicScript() {
  const keywords = Actions.NIC_TWEAKS.map((item) => Actions.psQuote(item.keyword)).join(', ');
  return UTF8 + String.raw`
$kw = @(${keywords})
$out = New-Object System.Collections.ArrayList
foreach ($a in @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' })) {
  $media = 'outro'
  if ($a.NdisPhysicalMedium -eq 9 -or [string]$a.PhysicalMediaType -match '802\.11|Wireless') { $media = 'wifi' } elseif ($a.NdisPhysicalMedium -eq 14 -or [string]$a.PhysicalMediaType -match '802\.3') { $media = 'ethernet' }
  $props = @(Get-NetAdapterAdvancedProperty -Name $a.Name -AllProperties | Where-Object { $kw -contains $_.RegistryKeyword } | ForEach-Object { [pscustomobject]@{ keyword = [string]$_.RegistryKeyword; value = [string](@($_.RegistryValue)[0]); display = [string]$_.DisplayValue; valid = @(@($_.ValidRegistryValues) | ForEach-Object { [string]$_ }) } })
  [void]$out.Add([pscustomobject]@{ guid = [string]$a.InterfaceGuid; name = [string]$a.InterfaceDescription; media = $media; props = $props })
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Compress -Depth 4))`;
}

/** Estado atual do que o jogo escolhido pode mudar (preferência de placa, prioridade, QoS). */
function gameStateScript(game) {
  const exe = Actions.psQuote(game.exeName);
  const ifeo = Actions.psQuote(`${Actions.IFEO_BASE}\\${game.exeName}\\PerfOptions`);
  const gpu = game.exe ? `try { $p = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences' -ErrorAction Stop; $o.gpu = [string]$p.PSObject.Properties[${Actions.psQuote(game.exe)}].Value } catch {}` : '';
  return UTF8 + String.raw`
$o = @{ gpu = $null; priority = $null; qos = $false; nla = $null }
${gpu}
try { $o.priority = [int](Get-ItemProperty -LiteralPath ${ifeo} -Name 'CpuPriorityClass' -ErrorAction Stop).CpuPriorityClass } catch {}
try { $o.qos = [bool](Get-NetQosPolicy -Name ('Nexo - ' + ${exe}) -ErrorAction Stop) } catch {}
try { $o.nla = [string](Get-ItemProperty -LiteralPath ${Actions.psQuote(Actions.QOS_KEY)} -Name 'Do not use NLA' -ErrorAction Stop).'Do not use NLA' } catch {}
[Console]::Out.Write(($o | ConvertTo-Json -Compress))`;
}

const parseJson = (text, fallback) => { try { const value = JSON.parse(String(text || '').replace(/^﻿/, '').trim() || 'null'); return value ?? fallback; } catch { return fallback; } };
const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const clean = (value, max = 120) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function createOptimizerSystem({ runPowerShell, run, elevate, systemScan, fs, path, platform = process.platform, now = Date.now, storeFile, env = process.env,
  bench, connectTime, findGateway, labPreflight, labRun, powerPlans, setPowerPlan, library = () => [], deepLast = async () => null }) {
  let counter = 0;
  const nextId = () => { counter = (counter % 999) + 1; return `c${counter}`; };

  /* ---------- Leituras ---------- */
  async function readStartup() {
    if (platform !== 'win32') return [];
    const result = await runPowerShell(STARTUP_SCRIPT, 20000);
    return asList(parseJson(result.stdout, [])).map((item) => {
      const source = Actions.STARTUP_SOURCES[item?.source] ? item.source : null;
      if (!source) return null;
      const packaged = source === 'packaged';
      const state = packaged ? Number(item.approved) : null;
      const approved = packaged ? null : (/^[0-9A-F]+$/i.test(String(item.approved || '')) ? String(item.approved).toUpperCase() : null);
      return { source, name: clean(item.name, 200), exe: clean(item.exe, 80), description: clean(packaged ? packagedName(item.name) : item.description, 80), company: clean(item.company, 60),
        approved, state: packaged ? state : null, enabled: packaged ? Actions.packagedEnabled(state) : Actions.approvedEnabled(approved), elevated: Actions.STARTUP_SOURCES[source].elevated };
    }).filter(Boolean).filter((item) => { try { Actions.validStartupTarget(item); return true; } catch { return false; } });
  }

  async function readNics() {
    if (platform !== 'win32') return [];
    const result = await runPowerShell(nicScript(), 20000);
    return asList(parseJson(result.stdout, [])).filter((nic) => Actions.IF_GUID.test(String(nic?.guid || '')) && ['ethernet', 'wifi'].includes(nic.media))
      .map((nic) => ({ guid: nic.guid, name: clean(nic.name, 80), media: nic.media, props: asList(nic.props).map((prop) => ({ keyword: clean(prop.keyword, 40), value: clean(prop.value, 8), display: clean(prop.display, 40), valid: asList(prop.valid).map((value) => clean(value, 8)) })) }));
  }

  async function readPower() {
    if (platform !== 'win32') return null;
    const plans = await powerPlans().catch(() => []);
    const active = plans.find((plan) => plan.active)?.guid || null;
    const overlay = await run('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes', '/v', 'ActiveOverlayAcPowerScheme']).catch(() => ({ stdout: '' }));
    const match = String(overlay.stdout || '').match(/ActiveOverlayAcPowerScheme\s+REG_SZ\s+([0-9a-f-]{36})/i);
    return { active, overlayAc: match ? match[1].toLowerCase() : null, plans };
  }

  /* ---------- O jogo ---------- */
  async function exists(file) { try { return (await fs.stat(file)).isFile(); } catch { return false; } }
  /** Roblox (e os iniciadores Bloxstrap e Fishstrap): a versão mais nova do RobloxPlayerBeta.exe instalada. */
  async function findRoblox() {
    const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Roblox', 'Versions'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Bloxstrap', 'Versions'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Fishstrap', 'Versions'),
      env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Roblox', 'Versions')].filter(Boolean);
    let best = null;
    for (const root of roots) {
      let entries = [];
      try { entries = await fs.readdir(root); } catch { continue; }
      for (const entry of entries) {
        const file = path.join(root, entry, 'RobloxPlayerBeta.exe');
        try { const stat = await fs.stat(file); if (stat.isFile() && (!best || stat.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: stat.mtimeMs }; } catch { /* outra pasta */ }
      }
    }
    return best ? best.file : null;
  }
  /** Sem executável no catálogo: o maior .exe da pasta do jogo (até dois níveis), sem instaladores e ajudantes. */
  async function guessExe(dir) {
    let best = null;
    const walk = async (folder, depth) => {
      let entries = [];
      try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory() && depth < 2 && !/^(_commonredist|redist|redistributables|directx|support|tools|crashreport\w*|__installer|installers?|engine)$/i.test(entry.name)) await walk(full, depth + 1);
        else if (entry.isFile() && /\.exe$/i.test(entry.name) && !GAME_SKIP.test(entry.name)) {
          try { const stat = await fs.stat(full); if (!best || stat.size > best.size) best = { file: full, size: stat.size }; } catch { /* sem acesso */ }
        }
      }
    };
    await walk(dir, 0);
    return best?.file || null;
  }
  const exeInfo = (file, name) => { try { const exe = Actions.validExePath(file); return { name: clean(name, 80), exe, exeName: exe.split('\\').pop() }; } catch { return null; } };

  /** Jogos que dá para escolher: o Roblox (se instalado), os da biblioteca com executável e os vistos na análise. */
  async function games() {
    if (platform !== 'win32') return [];
    const out = [];
    const roblox = await findRoblox();
    if (roblox) out.push({ key: 'roblox', name: 'Roblox', exeName: 'RobloxPlayerBeta.exe', source: 'roblox' });
    for (const game of library().filter((item) => item && item.installed !== false && item.kind !== 'app').slice(0, 300)) {
      if (/roblox/i.test(game.name || '')) continue;
      out.push({ key: `lib:${String(game.id).slice(0, 80)}`, name: clean(game.name, 80), exeName: game.exe ? String(game.exe).split('\\').pop() : null, source: game.source || 'biblioteca' });
    }
    const report = await deepLast().catch(() => null);
    for (const seen of report?.observation?.games || []) {
      const exeName = /\.exe$/i.test(String(seen.name || '')) ? seen.name : `${seen.name}.exe`;
      try { Actions.validExeName(exeName); } catch { continue; }
      if (out.some((item) => (item.exeName || '').toLowerCase() === exeName.toLowerCase())) continue;
      out.push({ key: `proc:${exeName}`, name: clean(seen.label || seen.name, 80), exeName, source: 'analise' });
    }
    return out;
  }
  /** Resolve a escolha da interface (só a chave) para o executável de verdade, conferido. */
  async function resolveGame(key) {
    const value = String(key || '');
    if (value === 'roblox') { const file = await findRoblox(); return file ? exeInfo(file, 'Roblox') : null; }
    if (value.startsWith('lib:')) {
      const game = library().find((item) => String(item.id) === value.slice(4));
      if (!game) return null;
      if (game.exe && await exists(game.exe)) return exeInfo(game.exe, game.name);
      if (game.installDir) { const file = await guessExe(game.installDir); return file ? exeInfo(file, game.name) : null; }
      return null;
    }
    if (value.startsWith('proc:')) {
      try { const exeName = Actions.validExeName(value.slice(5)); return { name: exeName.replace(/\.exe$/i, ''), exe: null, exeName }; } catch { return null; }
    }
    return null;
  }
  async function readGameState(game) {
    if (!game) return null;
    const result = await runPowerShell(gameStateScript(game), 15000);
    const state = parseJson(result.stdout, {});
    return { gpu: typeof state?.gpu === 'string' && state.gpu ? state.gpu : null, priority: Number.isInteger(state?.priority) ? state.priority : null, qos: state?.qos === true, nla: state?.nla === '0' || state?.nla === '1' ? state.nla : null };
  }

  /* ---------- Aplicar e reverter ---------- */
  const regKey = (key) => key.replace(/^HKCU:/, 'HKCU').replace(/^HKLM:/, 'HKLM');
  async function regAddBinary(key, name, hex) { return run('reg', ['add', regKey(key), '/v', name, '/t', 'REG_BINARY', '/d', hex, '/f']); }
  /** Apagar um valor que já não existe também é "voltou ao que era": confere com uma leitura. */
  async function regDelete(key, name) {
    const outcome = await run('reg', ['delete', regKey(key), '/v', name, '/f']);
    if (outcome.code === 0) return outcome;
    const query = await run('reg', ['query', regKey(key), '/v', name]);
    return query.code === 0 ? outcome : { code: 0, stdout: '' };
  }

  /**
   * Prepara (lê o valor anterior e valida) cada mudança. HKCU e plano vão direto; o resto num lote elevado só.
   * `revert` usa o `before` guardado em cada registro.
   */
  async function execute(items, { restorePoint = false, revert = false, game = null } = {}) {
    const records = [];
    const direct = [];
    const elevated = [];
    const scanList = [];
    const needs = (kind) => items.some((item) => item.kind === kind);
    const startupNow = !revert && needs('startup') ? await readStartup() : [];
    const scanNow = !revert && needs('scan') ? await systemScan.scan() : null;
    const nicsNow = !revert && needs('nic') ? await readNics() : [];
    const power = !revert && (needs('power-plan') || needs('power-mode')) ? await readPower() : null;
    const gameState = !revert && game && (needs('gpu-pref') || needs('priority') || needs('qos')) ? await readGameState(game) : null;
    const fail = (item, error) => records.push({ id: item.id || nextId(), stepId: item.stepId, kind: item.kind, ok: false, error: clean(error, 160) });

    for (const item of items) {
      const id = revert ? item.id : nextId();
      const record = { id, stepId: item.stepId, kind: item.kind, target: null, before: null, after: null };
      try {
        if (item.kind === 'scan') {
          const tweakValues = revert ? item.before : item.values;
          const tweakId = revert ? item.target.id : item.id;
          const current = scanNow?.items?.find((entry) => entry.id === tweakId);
          if (!revert && !current?.available) throw new Error('não existe neste PC');
          record.target = { id: tweakId };
          record.before = revert ? item.after : current.values;
          record.after = tweakValues;
          scanList.push({ record, change: { id: tweakId, values: tweakValues, ...(revert ? { revert: true } : {}) } });
          continue;
        }
        if (item.kind === 'startup') {
          const target = revert ? item.target : { source: item.source, name: item.name };
          Actions.validStartupTarget(target);
          let before = item.before;
          if (!revert) {
            const found = startupNow.find((entry) => entry.source === target.source && entry.name === target.name);
            if (!found) throw new Error('não está mais no início');
            if (!found.enabled) throw new Error('já estava desligado');
            before = target.source === 'packaged' ? found.state : found.approved;
          }
          const value = revert ? item.before : target.source === 'packaged' ? 1 : Actions.disabledBytes(now());
          const change = Actions.validateChange({ id, kind: 'startup', source: target.source, name: target.name, value, revert });
          Object.assign(record, { target, before: revert ? item.after : before, after: value });
          (Actions.needsElevation(change) ? elevated : direct).push({ record, change });
          continue;
        }
        if (item.kind === 'gpu-pref') {
          const exe = Actions.validExePath(revert ? item.target.exe : item.exe);
          const before = revert ? item.before : gameState?.gpu ?? null;
          const value = revert ? item.before : Actions.gpuPreferenceValue(before);
          const change = Actions.validateChange({ id, kind: 'gpu-pref', exe, value, revert });
          Object.assign(record, { target: { exe }, before: revert ? item.after : before, after: value });
          direct.push({ record, change });
          continue;
        }
        if (item.kind === 'priority') {
          const exe = Actions.validExeName(revert ? item.target.exe : item.exe);
          const before = revert ? item.before : gameState?.priority ?? null;
          const value = revert ? item.before : Actions.PRIORITY_HIGH;
          const change = Actions.validateChange({ id, kind: 'priority', exe, value, revert });
          Object.assign(record, { target: { exe }, before: revert ? item.after : before, after: value });
          elevated.push({ record, change });
          continue;
        }
        if (item.kind === 'qos') {
          const exe = Actions.validExeName(revert ? item.target.exe : item.exe);
          const before = revert ? item.before : { on: gameState?.qos === true, nla: gameState?.nla ?? null };
          const change = Actions.validateChange(revert ? { id, kind: 'qos', exe, on: before.on, nla: before.nla, revert } : { id, kind: 'qos', exe, on: true, nla: before.nla });
          Object.assign(record, { target: { exe }, before: revert ? item.after : before, after: revert ? before : { on: true, nla: '1' } });
          elevated.push({ record, change });
          continue;
        }
        if (item.kind === 'nic') {
          const target = revert ? item.target : { guid: item.guid, keyword: item.keyword };
          const tweak = Actions.NIC_BY_KEYWORD.get(target.keyword);
          let before = item.before;
          if (!revert) {
            const nic = nicsNow.find((entry) => entry.guid.toLowerCase() === String(target.guid).toLowerCase());
            const prop = nic?.props.find((entry) => entry.keyword === target.keyword);
            if (!prop) throw new Error('a placa não oferece essa opção');
            before = prop.value;
          }
          const value = revert ? item.before : tweak?.target;
          const change = Actions.validateChange({ id, kind: 'nic', guid: target.guid, keyword: target.keyword, value, revert });
          Object.assign(record, { target, before: revert ? item.after : before, after: value });
          elevated.push({ record, change });
          continue;
        }
        if (item.kind === 'pagefile') {
          const value = revert ? item.before : true;
          const change = Actions.validateChange({ id, kind: 'pagefile', auto: value, revert });
          Object.assign(record, { target: {}, before: revert ? item.after : false, after: value });
          elevated.push({ record, change });
          continue;
        }
        if (item.kind === 'power-plan') {
          const guid = String(revert ? item.before : item.guid || '').toLowerCase();
          if (!/^[0-9a-f-]{36}$/.test(guid)) throw new Error('plano inválido');
          const plans = await powerPlans();
          if (!plans.some((plan) => plan.guid === guid)) throw new Error('esse plano não existe neste PC');
          Object.assign(record, { target: {}, before: revert ? item.after : power?.active || null, after: guid });
          direct.push({ record, change: { kind: 'power-plan', guid } });
          continue;
        }
        if (item.kind === 'power-mode') {
          const guid = String(revert ? item.before : item.guid || '').toLowerCase();
          if (!Actions.POWER_MODES[guid]) throw new Error('modo de energia inválido');
          Object.assign(record, { target: {}, before: revert ? item.after : power?.overlayAc || null, after: guid });
          direct.push({ record, change: { kind: 'power-mode', guid } });
          continue;
        }
        throw new Error('tipo de ajuste desconhecido');
      } catch (error) { fail({ ...item, id }, error.message || error); }
    }

    /* 1) Sem administrador: HKCU, plano de energia e a parte HKCU/plano do Raio-X. */
    for (const { record, change } of direct) {
      let outcome = { code: 1 };
      try {
        if (change.kind === 'startup' && change.source === 'packaged') {
          const key = Actions.packagedKey(change.name);
          outcome = change.value === null ? await regDelete(key, 'State') : await run('reg', ['add', regKey(key), '/v', 'State', '/t', 'REG_DWORD', '/d', String(change.value), '/f']);
        } else if (change.kind === 'startup') {
          const key = Actions.approvedKey(change.source);
          outcome = change.value === null ? await regDelete(key, change.name) : await regAddBinary(key, change.name, change.value);
        } else if (change.kind === 'gpu-pref') {
          outcome = change.value === null ? await regDelete(Actions.GPU_PREFS_KEY, change.exe) : await run('reg', ['add', Actions.GPU_PREFS_KEY, '/v', change.exe, '/t', 'REG_SZ', '/d', change.value, '/f']);
        } else if (change.kind === 'power-plan') {
          await setPowerPlan(change.guid); outcome = { code: 0 };
        } else if (change.kind === 'power-mode') {
          outcome = await run('powercfg', ['/overlaysetactive', change.guid]);
          const after = await readPower();
          if (after?.overlayAc !== change.guid) outcome = { code: 1, stderr: 'o Windows não aceitou trocar o modo por aqui; troque em Configurações > Sistema > Energia' };
        }
      } catch (error) { outcome = { code: 1, stderr: error.message }; }
      const ok = outcome.code === 0;
      records.push({ ...record, ok, error: ok ? null : clean(outcome.stderr || 'o Windows recusou', 160) });
    }
    let deferred = [];
    if (scanList.length) {
      try {
        const outcome = await systemScan.apply(scanList.map((entry) => entry.change), { deferElevation: true });
        const failed = new Set(outcome.failed || []);
        deferred = outcome.deferred || [];
        const deferredIds = new Set(deferred.map((change) => change.id));
        for (const { record } of scanList) if (!deferredIds.has(record.target.id)) records.push({ ...record, ok: !failed.has(record.target.id), error: failed.has(record.target.id) ? 'o Windows recusou' : null });
      } catch (error) {
        for (const { record } of scanList) records.push({ ...record, ok: false, error: clean(error.message, 160) });
        deferred = [];
      }
    }

    /* 2) Com administrador: um lote só (com o ponto de restauração junto, quando pedido). */
    let restore = null;
    let declined = false;
    if (elevated.length || deferred.length || restorePoint) {
      let answer = null;
      try { answer = await elevate('optimizer-batch', { restorePoint, description: 'Nexo - antes de otimizar', changes: elevated.map((entry) => entry.change), registry: deferred }); }
      catch (error) { answer = { result: { ok: false, note: error.message, failed: [], done: [] } }; }
      declined = Boolean(answer?.declined);
      const result = answer?.result || null;
      const failed = new Set(asList(result?.failed).map(String));
      const done = new Set(asList(result?.done).map(String));
      restore = restorePoint ? interpretRestore(result?.restore, declined) : null;
      for (const { record, change } of elevated) {
        const ok = Boolean(result?.ok) && done.has(change.id) && !failed.has(change.id);
        records.push({ ...record, ok, error: ok ? null : declined ? 'sem a permissão do Windows' : 'o Windows recusou' });
      }
      for (const change of deferred) {
        const entry = scanList.find((item) => item.record.target.id === change.id);
        if (!entry) continue;
        const ok = Boolean(result?.ok) && !failed.has(change.id);
        records.push({ ...entry.record, ok, error: ok ? null : declined ? 'sem a permissão do Windows' : 'o Windows recusou' });
      }
      // Ajuste misto (HKCU + HKLM) que ficou pela metade porque a permissão foi recusada: a parte HKCU volta.
      const half = deferred.filter((change) => !(Boolean(result?.ok) && !failed.has(change.id)));
      if (half.length && !revert) {
        const undo = half.map((change) => scanList.find((item) => item.record.target.id === change.id)).filter(Boolean).map((entry) => ({ id: entry.record.target.id, values: entry.record.before, revert: true }));
        if (undo.length) await systemScan.apply(undo, { deferElevation: true }).catch(() => null);
      }
    }
    return { records, restore, declined };
  }

  function interpretRestore(raw, declined) {
    if (declined) return { ok: false, created: false, note: 'sem a permissão do Windows' };
    if (!raw || typeof raw !== 'object') return { ok: false, created: false, note: 'o Windows não respondeu' };
    return { ok: raw.ok === true, created: raw.created === true, note: clean(raw.note, 160) };
  }

  /* ---------- Rede: ping até o roteador e até a internet ---------- */
  const INTERNET = [['1.1.1.1', 443], ['8.8.8.8', 443]];
  async function series(host, port, count = 16, gapMs = 60) {
    const values = [];
    let lost = 0;
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- um pacote de cada vez: medir latência em paralelo mediria a fila
      const us = await connectTime(host, port);
      if (Number.isFinite(us)) values.push(us / 1000); else lost += 1;
      // eslint-disable-next-line no-await-in-loop -- pausa curta entre as tentativas, como num jogo
      await new Promise((resolve) => { setTimeout(resolve, gapMs); });
    }
    if (values.length < count / 2) return { ms: null, jitter: null, loss: lost / count };
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    let jitter = 0;
    for (let i = 1; i < values.length; i += 1) jitter += Math.abs(values[i] - values[i - 1]);
    return { ms: Math.round(mid * 100) / 100, jitter: Math.round((jitter / Math.max(1, values.length - 1)) * 100) / 100, loss: lost / count };
  }
  async function ping() {
    const gateway = await findGateway().catch(() => null);
    const local = gateway ? await series(gateway.host, gateway.port) : null;
    let remote = null;
    for (const [host, port] of INTERNET) {
      // eslint-disable-next-line no-await-in-loop -- tenta o segundo servidor só se o primeiro não respondeu
      remote = await series(host, port);
      if (Number.isFinite(remote.ms)) break;
    }
    return { gatewayMs: local?.ms ?? null, gatewayJitter: local?.jitter ?? null, internetMs: remote?.ms ?? null, internetJitter: remote?.jitter ?? null, loss: remote?.loss ?? null };
  }
  async function waitNetwork(timeoutMs = 25000) {
    const started = now();
    await new Promise((resolve) => { setTimeout(resolve, 3000); });
    while (now() - started < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop -- espera a placa voltar, uma tentativa por vez
      const ok = Number.isFinite(await connectTime(INTERNET[0][0], INTERNET[0][1]));
      if (ok) return true;
      // eslint-disable-next-line no-await-in-loop -- idem
      await new Promise((resolve) => { setTimeout(resolve, 1500); });
    }
    return false;
  }

  /* ---------- Registro das otimizações (para reverter depois, até pelo Diário) ---------- */
  async function loadStore() { try { const data = JSON.parse(await fs.readFile(storeFile, 'utf8')); return { runs: Array.isArray(data?.runs) ? data.runs : [] }; } catch { return { runs: [] }; } }
  async function saveStore(data) { await fs.mkdir(path.dirname(storeFile), { recursive: true }); await fs.writeFile(`${storeFile}.tmp`, JSON.stringify({ version: 1, runs: data.runs.slice(-STORE_LIMIT) })); await fs.rename(`${storeFile}.tmp`, storeFile); }
  async function saveRun(run) { const data = await loadStore(); data.runs = [...data.runs.filter((item) => item.id !== run.id), run]; await saveStore(data); return run; }
  async function revertRun(runId, ids = null) {
    const data = await loadStore();
    const runRecord = data.runs.find((item) => item.id === String(runId));
    if (!runRecord) throw new Error('Essa otimização não está mais no registro do Nexo.');
    const wanted = Array.isArray(ids) ? new Set(ids.map(String)) : null;
    const targets = runRecord.records.filter((record) => record.ok && !record.undone && (!wanted || wanted.has(record.id)));
    if (!targets.length) return { reverted: 0, failed: 0, declined: false, remaining: 0 };
    const outcome = await execute(targets.map((record) => ({ ...record })), { revert: true });
    let reverted = 0;
    for (const result of outcome.records) {
      const original = runRecord.records.find((record) => record.id === result.id);
      if (original && result.ok) { original.undone = true; original.undoneAt = now(); reverted += 1; }
    }
    await saveStore(data);
    const remaining = runRecord.records.filter((record) => record.ok && !record.undone).length;
    return { reverted, failed: targets.length - reverted, declined: outcome.declined, remaining };
  }

  return {
    readStartup, readNics, readPower, games, resolveGame, readGameState, execute, ping, waitNetwork, saveRun, loadStore, revertRun,
    preflight: async () => labPreflight(), bench, lab: labRun, interpretRestore
  };
}

module.exports = { createOptimizerSystem, STARTUP_SCRIPT, nicScript, gameStateScript, packagedName, GAME_SKIP };
