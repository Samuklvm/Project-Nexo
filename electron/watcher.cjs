/*
 * Observador de jogos (opcional, desligado por padrão). Um PowerShell leve que, a cada 3 s, informa só o programa em
 * primeiro plano. Quando um jogo da biblioteca (ou de uma pasta de biblioteca conhecida) fica em primeiro plano por
 * alguns segundos, avisa "jogo começou"; quando o processo do jogo termina, avisa "jogo terminou".
 * O caminho do executável NUNCA sai do processo principal.
 */
const { spawn } = require('child_process');
const readline = require('readline');
const Session = require('../src/session.js');
const { systemTool } = require('./system-path.cjs');

const WATCH_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexoWatch {
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
$last = -1
$beat = 0
$confirm = $false
while ($true) {
  $fgPid = [uint32]0
  $hwnd = [NexoWatch]::GetForegroundWindow()
  [void][NexoWatch]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
  $beat += 1
  # Programa novo: manda na hora e de novo no ciclo seguinte (a confirmação sai em ~3 s, não em 30 s); depois, a cada 30 s.
  if ($fgPid -ne $last -or $beat -ge 10 -or $confirm) {
    $confirm = ($fgPid -ne $last)
    $beat = 0
    $last = $fgPid
    $p = Get-Process -Id $fgPid
    $path = $null
    try { $path = $p.Path } catch {}
    $full = $false
    try { $full = [NexoWatch]::IsFullscreen($hwnd) } catch {}
    [Console]::Out.WriteLine((@{ pid = [int]$fgPid; name = [string]$p.ProcessName; path = $path; fullscreen = [bool]$full } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  }
  Start-Sleep -Seconds 3
}
`;

const defaultAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/**
 * Lógica de decisão separada do PowerShell para ser testável.
 * `match(path)` devolve o jogo da biblioteca (ou null). Exige 2 leituras seguidas para evitar alarme falso.
 */
function createWatchLogic({ match = () => null, alive = defaultAlive, onStart = () => {}, onEnd = () => {} } = {}) {
  let candidate = null;
  let current = null;
  return {
    feed(reading) {
      if (!reading || !reading.pid) return;
      if (current) return;
      const game = match(reading.path) || (reading.path ? null : match.byName?.(reading.name)) || null;
      const classified = game ? { isGame: game.kind !== 'app' } : Session.classifyForeground({ name: reading.name, path: reading.path, fullscreen: reading.fullscreen === true });
      if (!classified.isGame) { candidate = null; return; }
      if (candidate && candidate.pid === reading.pid) {
        current = { pid: reading.pid, name: game?.name || String(reading.name || 'Jogo').slice(0, 60), gameId: game?.id || null, since: Date.now() };
        candidate = null;
        onStart({ ...current });
      } else candidate = { pid: reading.pid };
    },
    tick() {
      if (current && !alive(current.pid)) { const ended = current; current = null; onEnd({ ...ended, endedAt: Date.now() }); }
    },
    current: () => (current ? { ...current } : null),
    reset() { candidate = null; current = null; }
  };
}

/**
 * Ciclo de vida com IDENTIDADE do processo (A21): `error` (ex.: não conseguiu criar o PowerShell) e `exit` passam pelo
 * mesmo encerramento, uma vez só por processo; a referência nunca fica presa e a volta automática é limitada.
 * Linha que chega de um processo que já não é o atual é ignorada.
 */
function createWatcher({ spawnFn = spawn, platform = process.platform, match, alive, onStart, onEnd, onProblem = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let child = null;
  let timer = null;
  let wanted = false;
  let restarts = 0;
  let restartTimer = null;
  let healthyTimer = null;
  let state = 'parado';
  const logic = createWatchLogic({ match, alive, onStart, onEnd });
  function stop() {
    wanted = false;
    clearTimer(restartTimer); restartTimer = null;
    clearTimer(healthyTimer); healthyTimer = null;
    const old = child;
    child = null;
    if (old) { try { old.kill(); } catch { /* já saiu */ } }
    clearInterval(timer);
    timer = null;
    logic.reset();
    state = 'parado';
  }
  function finalize(spawned, reason) {
    if (child !== spawned) return; // já finalizado (error seguido de exit) ou processo antigo
    child = null;
    clearInterval(timer); timer = null;
    clearTimer(healthyTimer); healthyTimer = null;
    logic.reset();
    if (!wanted) { state = 'parado'; return; }
    if (restarts >= 5) { state = 'falhou'; try { onProblem('desistiu', reason); } catch { /* registro indisponível */ } return; }
    restarts += 1;
    state = 'tentando de novo';
    try { onProblem('caiu', reason); } catch { /* registro indisponível */ }
    restartTimer = setTimer(() => { restartTimer = null; if (wanted && !child) start(); }, 5000 * restarts);
  }
  function start() {
    if (platform !== 'win32') return { ok: false };
    wanted = true;
    if (child || restartTimer) return { ok: true };
    let spawned;
    try { spawned = spawnFn(systemTool('powershell'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WATCH_SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (error) { child = null; state = 'falhou'; try { onProblem('nao-iniciou', error?.message || String(error)); } catch { /* registro indisponível */ } return { ok: false, reason: 'não consegui iniciar o observador' }; }
    child = spawned;
    state = 'ativo';
    readline.createInterface({ input: spawned.stdout }).on('line', (line) => { if (child !== spawned) return; try { logic.feed(JSON.parse(line)); } catch { /* linha inválida */ } });
    // Se o PowerShell do observador cair (antivírus, falta de memória…) ou nem abrir, volta sozinho com espera
    // crescente, no máximo 5 vezes seguidas; o contador zera depois de 60 s funcionando.
    spawned.on('exit', (code) => finalize(spawned, `saiu (código ${code})`));
    spawned.on('error', (error) => finalize(spawned, error?.code || error?.message || 'erro'));
    if (!timer) timer = setInterval(() => logic.tick(), 3000);
    healthyTimer = setTimer(() => { if (child === spawned) restarts = 0; }, 60000);
    return { ok: true };
  }
  return { start, stop, isRunning: () => Boolean(child), state: () => state, current: () => logic.current() };
}

/**
 * Linux: mesma lógica, lendo o primeiro plano pelo xprop a cada 3 s (X11/XWayland). Geração (A22): leitura que
 * termina depois de parar (ou de um parar-e-ligar) é descartada; leituras nunca se sobrepõem.
 */
function createLinuxWatcher({ linux, match, alive, onStart, onEnd, interval = 3000 }) {
  let timer = null;
  let generation = 0;
  let busy = false;
  const logic = createWatchLogic({ match, alive, onStart, onEnd });
  const tick = async () => {
    if (busy) return;
    busy = true;
    const mine = generation;
    try {
      logic.tick();
      const fg = await linux.foreground().catch(() => null);
      if (mine !== generation || !timer) return;
      if (fg) logic.feed(fg);
    } finally { busy = false; }
  };
  return {
    start() { if (!timer) { generation += 1; timer = setInterval(() => { tick().catch(() => {}); }, interval); } return { ok: true }; },
    stop() { generation += 1; clearInterval(timer); timer = null; logic.reset(); },
    isRunning: () => Boolean(timer), current: () => logic.current(), _tick: tick
  };
}

module.exports = { createWatcher, createLinuxWatcher, createWatchLogic, WATCH_SCRIPT };
