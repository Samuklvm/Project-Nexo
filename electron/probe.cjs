/*
 * Sonda de sessão: um único PowerShell residente que, a cada poucos segundos, informa
 *  - o programa em primeiro plano (para detectar jogos),
 *  - os programas que mais usaram CPU,
 *  - o uso de GPU por programa (contador oficial do Windows, via CIM, independente de idioma): como o Gerenciador de
 *    Tarefas, soma os motores do MESMO tipo (3D, cópia, vídeo…) e fica com o tipo mais ocupado — antes somava todos
 *    os motores e cortava em 100% (três motores a 40% viravam "placa lotada"); a consulta de GPU roda a cada 8 s;
 *  - se a janela em primeiro plano está em tela cheia (jogo com o caminho protegido por anticheat);
 *  - o custo da própria sonda: o PowerShell E o serviço WMI (WmiPrvSE) que responde às consultas dela.
 * O CAMINHO do executável é usado só aqui, para classificar o jogo, e NUNCA sai do processo principal.
 */
const { spawn } = require('child_process');
const readline = require('readline');
const Session = require('../src/session.js');
const { systemTool } = require('./system-path.cjs');

const PROBE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexoFg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  public static bool IsFullscreen(IntPtr hWnd) {
    RECT r;
    if (hWnd == IntPtr.Zero || !GetWindowRect(hWnd, out r)) return false;
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(hWnd, 2), ref mi)) return false;
    return r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
  }
}
'@
$cores = [Math]::Max(1, [Environment]::ProcessorCount)
$prev = @{}
$prevSelf = 0.0
$prevTime = [DateTime]::UtcNow
$tick = 0
$gpu = @()
while ($true) {
  try {
    $tick += 1
    $fgPid = [uint32]0
    $hwnd = [NexoFg]::GetForegroundWindow()
    [void][NexoFg]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
    $now = [DateTime]::UtcNow
    $dt = ($now - $prevTime).TotalSeconds
    if ($dt -le 0) { $dt = 1 }
    $procs = @(Get-Process)
    $cur = @{}
    $list = @()
    $wmi = 0.0
    foreach ($p in $procs) {
      $cpu = 0.0
      try { $cpu = [double]$p.CPU } catch {}
      $id = [int]$p.Id
      $cur[$id] = $cpu
      if ($prev.ContainsKey($id)) {
        $pct = ($cpu - $prev[$id]) * 100 / ($dt * $cores)
        if ($p.ProcessName -eq 'WmiPrvSE') { if ($pct -gt 0) { $wmi += $pct } }
        elseif ($pct -gt 0.5) { $list += [pscustomobject]@{ pid = $id; name = [string]$p.ProcessName; cpu = [Math]::Round($pct, 1) } }
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
        $full = $false
        try { $full = [NexoFg]::IsFullscreen($hwnd) } catch {}
        $fg = [pscustomobject]@{ pid = [int]$fgPid; name = [string]$fp.ProcessName; path = $path; fullscreen = [bool]$full }
      }
    }
    if ($tick % 2 -eq 1) {
      $gpu = @()
      try {
        $engines = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.UtilizationPercentage -gt 0 })
        # Como o Gerenciador de Tarefas: soma por (programa, tipo de motor) e fica com o tipo mais ocupado.
        $by = @{}
        foreach ($e in $engines) {
          if ($e.Name -match 'pid_(\d+)_.*engtype_(.+)$') {
            $k = [int]$Matches[1]
            $type = [string]$Matches[2]
            if (-not $by.ContainsKey($k)) { $by[$k] = @{} }
            if (-not $by[$k].ContainsKey($type)) { $by[$k][$type] = 0.0 }
            $by[$k][$type] += [double]$e.UtilizationPercentage
          }
        }
        foreach ($k in $by.Keys) {
          $best = 0.0; $bestType = ''; $d3 = 0.0
          foreach ($t in $by[$k].Keys) { $v = $by[$k][$t]; if ($v -gt $best) { $best = $v; $bestType = $t }; if ($t -eq '3D') { $d3 = $v } }
          $nm = ($procs | Where-Object { $_.Id -eq $k } | Select-Object -First 1).ProcessName
          $gpu += [pscustomobject]@{ pid = $k; name = [string]$nm; util = [Math]::Round([Math]::Min(100, $best), 1); engine = $bestType; d3 = [Math]::Round([Math]::Min(100, $d3), 1) }
        }
        $gpu = @($gpu | Sort-Object util -Descending | Select-Object -First 5)
      } catch {}
    }
    $me = Get-Process -Id $PID
    $selfNow = 0.0
    try { $selfNow = [double]$me.CPU } catch {}
    $selfPct = 0.0
    if ($prevSelf -gt 0) { $selfPct = ($selfNow - $prevSelf) * 100 / ($dt * $cores) }
    $prevSelf = $selfNow
    $self = [pscustomobject]@{ cpu = [Math]::Round($selfPct, 2); wmi = [Math]::Round($wmi, 2); memMB = [Math]::Round($me.WorkingSet64 / 1MB, 1) }
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
  const libraryGame = foreground ? match(foreground.path) || (!foreground.path ? match.byName?.(foreground.name) || null : null) : null;
  const classification = libraryGame ? (libraryGame.kind === 'app' ? { isGame: false, reason: 'é um programa da sua biblioteca, não um jogo' } : { isGame: true, reason: 'é um jogo da sua biblioteca' }) : foreground ? Session.classifyForeground({ name: foreground.name, path: foreground.path, fullscreen: foreground.fullscreen === true }) : null;
  return {
    t: Number.isFinite(raw.t) ? raw.t : Date.now(),
    fg: foreground ? { pid: Number(foreground.pid) || 0, name: text(foreground.name), isGame: classification.isGame, reason: classification.reason, gameId: libraryGame?.id || null, gameName: libraryGame ? text(libraryGame.name, 80) : null } : null,
    cpu: asList(raw.cpu).slice(0, 5).map((item) => ({ pid: Number(item.pid) || 0, name: text(item.name), cpu: clamp(Number(item.cpu) || 0, 0, 100) })),
    gpu: asList(raw.gpu).slice(0, 5).map((item) => ({ pid: Number(item.pid) || 0, name: text(item.name), util: clamp(Number(item.util) || 0, 0, 100), engine: /^[\w ]{1,20}$/.test(String(item.engine || '')) ? String(item.engine) : null, d3: Number.isFinite(Number(item.d3)) ? clamp(Number(item.d3), 0, 100) : null })),
    // Custo da sonda = o PowerShell dela + o serviço WMI que responde às consultas dela.
    self: raw.self ? { cpu: clamp((Number(raw.self.cpu) || 0) + (Number(raw.self.wmi) || 0), 0, 100), shell: clamp(Number(raw.self.cpu) || 0, 0, 100), wmi: clamp(Number(raw.self.wmi) || 0, 0, 100), memMB: clamp(Number(raw.self.memMB) || 0, 0, 4096) } : null
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
    const spawned = spawnFn(systemTool('powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
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
      const finish = (result) => { clearTimeout(timer); waiters.delete(onSample); if (startedHere) { stop(); } resolve(result); };
      const onSample = (sample) => finish({ ok: true, sample });
      const timer = setTimeout(() => finish({ ok: false, reason: 'A sonda não respondeu a tempo. O Windows pode ter bloqueado o PowerShell ou o contador de GPU.' }), timeoutMs);
      waiters.add(onSample);
    });
  }

  return { start, stop, test, isRunning: () => child !== null };
}

/** Sonda do Linux, toda em Node: primeiro plano (xprop), CPU por programa (/proc) e o custo do próprio Nexo. GPU por programa não tem fonte padrão no Linux. */
function createLinuxProbe({ linux, emit = () => {}, match = () => null, interval = 4000, now = Date.now }) {
  let timer = null;
  let previous = null;
  let previousAt = 0;
  let generation = 0;
  let busy = false;
  const waiters = new Set();
  /* Geração (A22): leitura que termina depois de parar não é emitida nem vira base da próxima; nunca duas ao mesmo tempo. */
  async function tick() {
    if (busy) return;
    busy = true;
    const mine = generation;
    try { await tickBody(mine); } finally { busy = false; }
  }
  async function tickBody(mine) {
    const [fg, snapshot] = await Promise.all([linux.foreground().catch(() => null), linux.processSample()]);
    if (mine !== generation || !timer) return;
    const at = now();
    const cores = Math.max(1, require('os').cpus().length);
    const cpu = [];
    if (previous) {
      const seconds = Math.max(0.5, (at - previousAt) / 1000);
      for (const proc of snapshot.values()) {
        const prev = previous.get(proc.pid);
        if (!prev) continue;
        const pct = ((proc.ticks - prev.ticks) / 100 / seconds / cores) * 100;
        if (pct > 0.5) cpu.push({ pid: proc.pid, name: proc.name, cpu: Math.round(pct * 10) / 10 });
      }
    }
    previous = snapshot; previousAt = at;
    const memory = process.memoryUsage().rss / 1048576;
    const sample = normalizeProbe({ t: at, fg, cpu: cpu.sort((a, b) => b.cpu - a.cpu).slice(0, 5), gpu: [], self: { cpu: 0, memMB: Math.round(memory) } }, match);
    if (!sample) return;
    emit(sample);
    for (const waiter of [...waiters]) waiter(sample);
  }
  function start() { if (!timer) { generation += 1; timer = setInterval(() => { tick().catch(() => {}); }, interval); tick().catch(() => {}); } return { ok: true }; }
  function stop() { generation += 1; clearInterval(timer); timer = null; previous = null; return { ok: true }; }
  function test(timeoutMs = 12000) {
    const startedHere = !timer;
    start();
    return new Promise((resolve) => {
      const finish = (result) => { clearTimeout(limit); waiters.delete(onSample); if (startedHere) { stop(); } resolve(result); };
      const onSample = (sample) => { if (sample.cpu.length || sample.fg || previous) finish({ ok: true, sample }); };
      const limit = setTimeout(() => finish({ ok: false, reason: 'A sonda não respondeu a tempo.' }), timeoutMs);
      waiters.add(onSample);
    });
  }
  return { start, stop, test, isRunning: () => Boolean(timer) };
}

module.exports = { createProbe, createLinuxProbe, normalizeProbe, PROBE_SCRIPT };
