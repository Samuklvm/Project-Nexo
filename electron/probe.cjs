/*
 * Sonda de sessão: um único PowerShell residente que, a cada poucos segundos, informa
 *  - o programa em primeiro plano (para detectar jogos),
 *  - os programas que mais usaram CPU,
 *  - o uso de GPU por programa (contador oficial do Windows, via CIM, independente de idioma),
 *  - o custo da própria sonda (para o Nexo medir e mostrar o seu overhead).
 * O CAMINHO do executável é usado só aqui, para classificar o jogo, e NUNCA sai do processo principal.
 */
const { spawn } = require('child_process');
const readline = require('readline');
const Session = require('../src/session.js');

const PROBE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexoFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$cores = [Math]::Max(1, [Environment]::ProcessorCount)
$prev = @{}
$prevSelf = 0.0
$prevTime = [DateTime]::UtcNow
while ($true) {
  try {
    $fgPid = [uint32]0
    [void][NexoFg]::GetWindowThreadProcessId([NexoFg]::GetForegroundWindow(), [ref]$fgPid)
    $now = [DateTime]::UtcNow
    $dt = ($now - $prevTime).TotalSeconds
    if ($dt -le 0) { $dt = 1 }
    $procs = @(Get-Process)
    $cur = @{}
    $list = @()
    foreach ($p in $procs) {
      $cpu = 0.0
      try { $cpu = [double]$p.CPU } catch {}
      $id = [int]$p.Id
      $cur[$id] = $cpu
      if ($prev.ContainsKey($id)) {
        $pct = ($cpu - $prev[$id]) * 100 / ($dt * $cores)
        if ($pct -gt 0.5) { $list += [pscustomobject]@{ pid = $id; name = [string]$p.ProcessName; cpu = [Math]::Round($pct, 1) } }
      }
    }
    $prev = $cur
    $prevTime = $now
    $top = @($list | Sort-Object cpu -Descending | Select-Object -First 5)
    $fg = $null
    if ($fgPid -gt 0) {
      $fp = $procs | Where-Object { $_.Id -eq $fgPid } | Select-Object -First 1
      if ($fp) {
        $path = $null
        try { $path = $fp.Path } catch {}
        $fg = [pscustomobject]@{ pid = [int]$fgPid; name = [string]$fp.ProcessName; path = $path }
      }
    }
    $gpu = @()
    try {
      $engines = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.UtilizationPercentage -gt 0 })
      $by = @{}
      foreach ($e in $engines) {
        if ($e.Name -match 'pid_(\d+)_') {
          $k = [int]$Matches[1]
          if (-not $by.ContainsKey($k)) { $by[$k] = 0.0 }
          $by[$k] += [double]$e.UtilizationPercentage
        }
      }
      foreach ($k in $by.Keys) {
        $nm = ($procs | Where-Object { $_.Id -eq $k } | Select-Object -First 1).ProcessName
        $gpu += [pscustomobject]@{ pid = $k; name = [string]$nm; util = [Math]::Round([Math]::Min(100, $by[$k]), 1) }
      }
      $gpu = @($gpu | Sort-Object util -Descending | Select-Object -First 5)
    } catch {}
    $me = Get-Process -Id $PID
    $selfNow = 0.0
    try { $selfNow = [double]$me.CPU } catch {}
    $selfPct = 0.0
    if ($prevSelf -gt 0) { $selfPct = ($selfNow - $prevSelf) * 100 / ($dt * $cores) }
    $prevSelf = $selfNow
    $self = [pscustomobject]@{ cpu = [Math]::Round($selfPct, 2); memMB = [Math]::Round($me.WorkingSet64 / 1MB, 1) }
    $out = [pscustomobject]@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); fg = $fg; cpu = $top; gpu = $gpu; self = $self }
    [Console]::Out.WriteLine(($out | ConvertTo-Json -Depth 4 -Compress))
    [Console]::Out.Flush()
  } catch {
    [Console]::Out.WriteLine('{"error":"probe"}')
  }
  Start-Sleep -Seconds 4
}
`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const text = (value, limit = 60) => String(value ?? '').slice(0, limit);
const asList = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);

/** Sanitiza a leitura bruta e acrescenta a classificação de jogo. Remove o caminho do executável. */
function normalizeProbe(raw, match = () => null) {
  if (!raw || typeof raw !== 'object' || raw.error) return null;
  const foreground = raw.fg && raw.fg.name ? raw.fg : null;
  const libraryGame = foreground ? match(foreground.path) : null;
  const classification = libraryGame ? { isGame: true, reason: 'é um jogo da sua biblioteca' } : foreground ? Session.classifyForeground({ name: foreground.name, path: foreground.path }) : null;
  return {
    t: Number.isFinite(raw.t) ? raw.t : Date.now(),
    fg: foreground ? { pid: Number(foreground.pid) || 0, name: text(foreground.name), isGame: classification.isGame, reason: classification.reason, gameId: libraryGame?.id || null, gameName: libraryGame ? text(libraryGame.name, 80) : null } : null,
    cpu: asList(raw.cpu).slice(0, 5).map((item) => ({ pid: Number(item.pid) || 0, name: text(item.name), cpu: clamp(Number(item.cpu) || 0, 0, 100) })),
    gpu: asList(raw.gpu).slice(0, 5).map((item) => ({ pid: Number(item.pid) || 0, name: text(item.name), util: clamp(Number(item.util) || 0, 0, 100) })),
    self: raw.self ? { cpu: clamp(Number(raw.self.cpu) || 0, 0, 100), memMB: clamp(Number(raw.self.memMB) || 0, 0, 4096) } : null
  };
}

function createProbe({ spawnFn = spawn, emit = () => {}, platform = process.platform, match = () => null } = {}) {
  let child = null;
  let reader = null;
  const waiters = new Set();

  function stop() {
    if (child) { try { child.kill(); } catch { /* já encerrado */ } }
    child = null;
    reader?.close();
    reader = null;
    return { ok: true };
  }

  function start() {
    if (child) return { ok: true };
    if (platform !== 'win32') return { ok: false, reason: 'A sonda só existe no Windows.' };
    const spawned = spawnFn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child = spawned;
    reader = readline.createInterface({ input: spawned.stdout });
    reader.on('line', (line) => {
      let parsed;
      try { parsed = JSON.parse(line); } catch { return; }
      const sample = normalizeProbe(parsed, match);
      if (!sample) return;
      emit(sample);
      for (const waiter of [...waiters]) waiter(sample);
    });
    spawned.on('exit', () => { if (child === spawned) { child = null; reader?.close(); reader = null; } });
    spawned.on('error', () => { if (child === spawned) { child = null; reader?.close(); reader = null; } });
    return { ok: true };
  }

  /** Autodiagnóstico: espera a primeira leitura. Devolve o que foi lido ou o motivo da falha. */
  function test(timeoutMs = 20000) {
    const startedHere = !child;
    const started = start();
    if (!started.ok) return Promise.resolve({ ok: false, reason: started.reason });
    return new Promise((resolve) => {
      const finish = (result) => { clearTimeout(timer); waiters.delete(onSample); if (startedHere) stop(); resolve(result); };
      const onSample = (sample) => finish({ ok: true, sample });
      const timer = setTimeout(() => finish({ ok: false, reason: 'A sonda não respondeu a tempo. O Windows pode ter bloqueado o PowerShell ou o contador de GPU.' }), timeoutMs);
      waiters.add(onSample);
    });
  }

  return { start, stop, test, isRunning: () => child !== null };
}

module.exports = { createProbe, normalizeProbe, PROBE_SCRIPT };
