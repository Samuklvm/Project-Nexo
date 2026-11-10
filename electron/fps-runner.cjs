/*
 * Medição de FPS com o PresentMon (Intel, licença MIT), executado como processo filho SOMENTE quando o usuário pede.
 * O PresentMon lê eventos de apresentação do Windows (ETW) do programa escolhido; nada disso sai do computador.
 * Requisito do próprio PresentMon: usuário no grupo "Performance Log Users" ou administrador.
 */
const { spawn } = require('child_process');
const readline = require('readline');
const Fps = require('../src/fps.js');

const SESSION = 'NexoFPS';
const ACCESS_HINT = 'O Windows negou o acesso aos eventos de apresentação. O PresentMon precisa que o seu usuário esteja no grupo “Performance Log Users” (ou seja administrador). O Nexo libera isso sozinho em Sessões → Componentes → “Liberar automaticamente” (o Windows pede permissão); depois saia da conta do Windows e entre de novo.';

function createFpsRunner({ spawnFn = spawn, emit = () => {}, platform = process.platform } = {}) {
  let child = null;
  let timer = null;
  // Acumulador sem limite: a sessão inteira entra no resumo (antes, só os primeiros 400 mil quadros).
  let frames = Fps.createAccumulator();
  let rolling = null;
  let parser = null;
  let startedAt = 0;
  let notes = [];
  let exePath = '';

  function fail(code, message) { emit('fps:error', { code, message }); }

  function terminateSession() {
    if (!exePath) return;
    try {
      const cleaner = spawnFn(exePath, ['--terminate_existing_session', '--session_name', SESSION], { windowsHide: true, stdio: 'ignore' });
      cleaner.on?.('error', () => {});
    } catch { /* a sessão ETW some sozinha quando o processo termina */ }
  }

  function start({ exe, pid }) {
    if (platform !== 'win32') throw new Error('A medição de FPS só existe no Windows.');
    if (child) throw new Error('A medição de FPS já está em andamento.');
    if (!exe) throw new Error('O componente PresentMon não foi encontrado. Escolha o executável em Sessões.');
    if (!Number.isInteger(pid) || pid < 4 || pid > 4194304) throw new Error('Processo inválido para medir FPS.');
    exePath = exe;
    parser = Fps.createFrameParser();
    rolling = Fps.createRolling(1000);
    frames = Fps.createAccumulator();
    notes = [];
    startedAt = Date.now();
    const args = ['--process_id', String(pid), '--output_stdout', '--no_console_stats', '--stop_existing_session', '--session_name', SESSION, '--terminate_on_proc_exit'];
    const spawned = spawnFn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child = spawned;

    const onLine = (line) => {
      const frame = parser.push(line);
      if (frame) { frames.push(frame); rolling.push(frame); return; }
      if (!parser.ready || /error|denied|failed|access|negad/i.test(line)) { notes.push(String(line).slice(0, 200)); if (notes.length > 8) notes.shift(); }
    };
    readline.createInterface({ input: spawned.stdout }).on('line', onLine);
    if (spawned.stderr) readline.createInterface({ input: spawned.stderr }).on('line', onLine);

    timer = setInterval(() => emit('fps:update', { ...rolling.snapshot(), frames: frames.count }), 1000);
    spawned.on('error', (error) => { clearInterval(timer); if (child === spawned) { child = null; } fail('falha-ao-iniciar', `Não foi possível iniciar o PresentMon: ${error.message}`); });
    spawned.on('exit', (code) => {
      clearInterval(timer);
      if (child === spawned) child = null;
      const early = Date.now() - startedAt < 8000 && frames.count === 0;
      if (code !== 0 && early) {
        const joined = notes.join(' ');
        if (/access|denied|negad|0x5\b|performance log/i.test(joined)) fail('acesso-negado', ACCESS_HINT);
        else fail('falha-ao-iniciar', `O PresentMon encerrou sem medir nada${joined ? `: ${joined}` : '.'} Confira se o programa está exibindo imagem (DirectX/OpenGL/Vulkan).`);
      } else emit('fps:ended', { frames: frames.count, code });
    });
    return { ok: true };
  }

  /** Encerra e devolve { summary, series, frames } (summary é null com poucos quadros). */
  async function stop() {
    clearInterval(timer);
    timer = null;
    const result = { summary: frames.summary(), series: frames.series(), frames: frames.count };
    if (child) { try { child.kill(); } catch { /* já encerrado */ } child = null; terminateSession(); }
    frames = Fps.createAccumulator();
    return result;
  }

  return { start, stop, isRunning: () => child !== null };
}

module.exports = { createFpsRunner, ACCESS_HINT, SESSION };
