/*
 * Discord Rich Presence (opcional). Fala com o Discord instalado no PC pelo canal local (named pipe
 * \\?\pipe\discord-ipc-N) — nada passa por servidor do Nexo. Mostra no seu perfil, para os seus amigos,
 * o que você escolher: o jogo que o Nexo está gravando e/ou "Cuidando do PC com o Nexo".
 * Exige o "Application ID" de um app criado no Discord Developer Portal (configurado na build ou importado).
 */
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2 };
const APP_ID = /^\d{17,20}$/;

function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

/** Lê quantos quadros completos houver no buffer; devolve { frames, rest }. */
function decode(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const op = buffer.readInt32LE(offset);
    const length = buffer.readInt32LE(offset + 4);
    if (length < 0 || length > 1024 * 1024) throw new Error('quadro inválido do Discord');
    if (buffer.length - offset - 8 < length) break;
    let data = null;
    try { data = JSON.parse(buffer.toString('utf8', offset + 8, offset + 8 + length)); } catch { data = null; }
    frames.push({ op, data });
    offset += 8 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/** Atividade limitada aos campos e tamanhos que o Discord aceita. */
function buildActivity({ details, state, startedAt, image = 'nexo', imageText = 'Nexo Device Care' }) {
  const clip = (value, max) => String(value || '').slice(0, max) || undefined;
  return { details: clip(details, 128), state: clip(state, 128), timestamps: Number.isFinite(startedAt) ? { start: Math.floor(startedAt / 1000) } : undefined, assets: { large_image: clip(image, 256), large_text: clip(imageText, 128) }, instance: false };
}

/** Onde o Discord escuta: named pipe no Windows; socket Unix no Linux (nativo, Flatpak ou Snap). */
function ipcPaths(platform = process.platform, env = process.env) {
  if (platform === 'win32') return Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || '/tmp';
  const dirs = [base, `${base}/app/com.discordapp.Discord`, `${base}/snap.discord`, '/tmp'];
  return dirs.flatMap((dir) => Array.from({ length: 10 }, (_, index) => `${dir}/discord-ipc-${index}`));
}

function createDiscord({ connect, pid = process.pid, platform = process.platform, env = process.env }) {
  let socket = null;
  let ready = false;
  let appId = null;
  let pending = Buffer.alloc(0);
  let nonce = 0;

  function close() {
    try { socket?.end(); socket?.destroy(); } catch { /* fechado */ }
    socket = null; ready = false; pending = Buffer.alloc(0);
  }

  async function open(clientId) {
    if (platform !== 'win32' && platform !== 'linux') throw new Error('Disponível no Windows e no Linux.');
    if (!APP_ID.test(String(clientId))) throw new Error('O Discord ainda não foi configurado nesta build (falta o Application ID).');
    if (ready && appId === clientId) return true;
    close();
    for (const pipe of ipcPaths(platform, env)) {
      const attempt = await new Promise((resolve) => {
        const candidate = connect(pipe);
        const fail = () => { candidate.destroy?.(); resolve(null); };
        candidate.once('error', fail);
        candidate.once('connect', () => { candidate.removeListener('error', fail); resolve(candidate); });
      });
      if (!attempt) continue;
      socket = attempt;
      appId = clientId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { close(); reject(new Error('O Discord não respondeu.')); }, 5000);
        socket.on('data', (chunk) => {
          const { frames, rest } = decode(Buffer.concat([pending, chunk]));
          pending = rest;
          for (const frame of frames) {
            if (frame.op === OP.FRAME && frame.data?.evt === 'READY') { ready = true; clearTimeout(timer); resolve(true); }
            if (frame.op === OP.CLOSE) { clearTimeout(timer); close(); reject(new Error(frame.data?.message || 'O Discord recusou a conexão.')); }
          }
        });
        socket.on('close', () => { ready = false; socket = null; });
        socket.on('error', () => { ready = false; });
        socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: String(clientId) }));
      });
    }
    throw new Error('O Discord não está aberto neste PC.');
  }

  async function setActivity(clientId, activity) {
    await open(clientId);
    nonce += 1;
    socket.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid, activity: activity ? buildActivity(activity) : null }, nonce: `nexo-${nonce}` }));
    return { ok: true };
  }

  return { setActivity, clear: (clientId) => (ready ? setActivity(clientId, null) : Promise.resolve({ ok: true })), close, isReady: () => ready };
}

module.exports = { ipcPaths, createDiscord, encode, decode, buildActivity, OP, APP_ID };
