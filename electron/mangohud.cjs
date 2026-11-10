/*
 * FPS no Linux pelo MangoHud (MIT), o equivalente prático do PresentMon: o jogo roda com o MangoHud gravando um
 * log CSV numa pasta do Nexo, e o Nexo só LÊ esse arquivo enquanto a sessão grava. Nada é injetado pelo Nexo.
 * Opção de inicialização (Steam): MANGOHUD_CONFIG="output_folder=<pasta>,autostart_log=1,log_interval=0" mangohud %command%
 */
const Fps = require('../src/fps.js');

/** Lê as linhas novas do CSV; o cabeçalho de dados começa com "fps,frametime". Devolve tempos de quadro em ms. */
function parseMangoChunk(text, state = null) {
  const previous = state || { header: null, rest: '' }; // estado novo a cada chamada (nada de objeto padrão compartilhado)
  const lines = (previous.rest + text).split('\n');
  const rest = lines.pop();
  const frames = [];
  let header = previous.header;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^fps,frametime/i.test(line)) { header = line.split(',').map((name) => name.trim().toLowerCase()); continue; }
    if (!header) continue;
    const cells = line.split(',');
    const ms = Number(cells[header.indexOf('frametime')]);
    if (Number.isFinite(ms) && ms > 0 && ms < 2000) frames.push({ ms });
  }
  return { frames, state: { header, rest } };
}

const launchOption = (dir) => `MANGOHUD_CONFIG="output_folder=${dir},autostart_log=1,log_interval=0" mangohud %command%`;

function createMangoRunner({ fs, path, dir, emit = () => {}, now = Date.now, interval = 1000 }) {
  let timer = null;
  let started = 0;
  let file = null;
  let offset = 0;
  let parse = { header: null, rest: '' };
  let frames = [];
  let lastEmit = 0;

  async function newestLog() {
    const names = (await fs.readdir(dir).catch(() => [])).filter((name) => name.endsWith('.csv') && !name.endsWith('_summary.csv'));
    let best = null;
    for (const name of names) {
      const stats = await fs.stat(path.join(dir, name)).catch(() => null);
      if (stats && stats.mtimeMs >= started - 2000 && (!best || stats.mtimeMs > best.mtimeMs)) best = { name, mtimeMs: stats.mtimeMs };
    }
    return best ? path.join(dir, best.name) : null;
  }

  async function poll() {
    if (!file) { file = await newestLog(); offset = 0; parse = { header: null, rest: '' }; if (!file) return; }
    const handle = await fs.open(file, 'r').catch(() => null);
    if (!handle) return;
    try {
      const { size } = await handle.stat();
      if (size <= offset) return;
      const buffer = Buffer.alloc(Math.min(size - offset, 4 * 1024 * 1024));
      await handle.read(buffer, 0, buffer.length, offset);
      offset += buffer.length;
      const result = parseMangoChunk(buffer.toString('utf8'), parse);
      parse = result.state;
      frames.push(...result.frames);
      if (frames.length > 400000) frames = frames.slice(-400000);
    } finally { await handle.close(); }
    if (now() - lastEmit >= 1000 && frames.length) {
      lastEmit = now();
      const recent = frames.slice(-240);
      const avgMs = recent.reduce((sum, frame) => sum + frame.ms, 0) / recent.length;
      emit('fps:update', { fps: 1000 / avgMs, worstMs: Math.max(...recent.map((frame) => frame.ms)), frames: frames.length });
    }
  }

  return {
    async start() {
      await fs.mkdir(dir, { recursive: true });
      started = now(); file = null; frames = []; offset = 0; lastEmit = 0;
      clearInterval(timer);
      timer = setInterval(() => { poll().catch(() => {}); }, interval);
      return { ok: true, waiting: true };
    },
    async stop() {
      clearInterval(timer); timer = null;
      await poll().catch(() => {});
      if (!frames.length) return { summary: null, series: null, frames: 0 };
      return { summary: Fps.summarize(frames), series: Fps.perSecond(frames), frames: frames.length };
    },
    poll
  };
}

module.exports = { createMangoRunner, parseMangoChunk, launchOption };
