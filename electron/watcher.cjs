/*
 * Observador de jogos (opcional, desligado por padrão). Um PowerShell leve que, a cada 3 s, informa só o programa em
 * primeiro plano. Quando um jogo da biblioteca (ou de uma pasta de biblioteca conhecida) fica em primeiro plano por
 * alguns segundos, avisa "jogo começou"; quando o processo do jogo termina, avisa "jogo terminou".
 * O caminho do executável NUNCA sai do processo principal.
 */
const { spawn } = require('child_process');
const readline = require('readline');
const Session = require('../src/session.js');

const WATCH_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexoWatch {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$last = -1
$beat = 0
while ($true) {
  $fgPid = [uint32]0
  [void][NexoWatch]::GetWindowThreadProcessId([NexoWatch]::GetForegroundWindow(), [ref]$fgPid)
  $beat += 1
  if ($fgPid -ne $last -or $beat -ge 10) {
    $beat = 0
    $last = $fgPid
    $p = Get-Process -Id $fgPid
    $path = $null
    try { $path = $p.Path } catch {}
    [Console]::Out.WriteLine((@{ pid = [int]$fgPid; name = [string]$p.ProcessName; path = $path } | ConvertTo-Json -Compress))
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
      const game = match(reading.path);
      const classified = game ? { isGame: game.kind !== 'app' } : Session.classifyForeground({ name: reading.name, path: reading.path });
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

function createWatcher({ spawnFn = spawn, platform = process.platform, match, alive, onStart, onEnd } = {}) {
  let child = null;
  let timer = null;
  let wanted = false;
  let restarts = 0;
  let restartTimer = null;
  const logic = createWatchLogic({ match, alive, onStart, onEnd });
  function stop() {
    wanted = false;
    clearTimeout(restartTimer);
    restartTimer = null;
    if (child) { try { child.kill(); } catch { /* já saiu */ } }
    child = null;
    clearInterval(timer);
    timer = null;
    logic.reset();
  }
  function start() {
    if (child || platform !== 'win32') return { ok: platform === 'win32' };
    wanted = true;
    const spawned = spawnFn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WATCH_SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child = spawned;
    readline.createInterface({ input: spawned.stdout }).on('line', (line) => { try { logic.feed(JSON.parse(line)); } catch { /* linha inválida */ } });
    // Se o PowerShell do observador cair (antivírus, falta de memória…), a sessão automática parava em silêncio.
    // Agora ele volta sozinho, com espera crescente e no máximo 5 vezes seguidas.
    spawned.on('exit', () => {
      if (child !== spawned) return;
      child = null;
      if (!wanted || restarts >= 5) return;
      restarts += 1;
      clearInterval(timer); timer = null;
      restartTimer = setTimeout(() => { restartTimer = null; if (wanted && !child) start(); }, 5000 * restarts);
    });
    spawned.on('error', () => {});
    if (!timer) timer = setInterval(() => logic.tick(), 3000);
    setTimeout(() => { if (child === spawned) restarts = 0; }, 60000);
    return { ok: true };
  }
  return { start, stop, isRunning: () => Boolean(child), current: () => logic.current() };
}

/** Linux: mesma lógica, lendo o primeiro plano pelo xprop a cada 3 s (X11/XWayland). */
function createLinuxWatcher({ linux, match, alive, onStart, onEnd, interval = 3000 }) {
  let timer = null;
  const logic = createWatchLogic({ match, alive, onStart, onEnd });
  const tick = async () => { logic.tick(); const fg = await linux.foreground().catch(() => null); if (fg) logic.feed(fg); };
  return {
    start() { if (!timer) timer = setInterval(() => { tick().catch(() => {}); }, interval); return { ok: true }; },
    stop() { clearInterval(timer); timer = null; logic.reset(); },
    isRunning: () => Boolean(timer), current: () => logic.current()
  };
}

module.exports = { createWatcher, createLinuxWatcher, createWatchLogic, WATCH_SCRIPT };
