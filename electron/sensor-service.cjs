/*
 * Serviço de sensores do Windows ("NexoSensors"): o coletor roda como serviço, com o driver PawnIO, e por isso lê
 * a temperatura do processador e da placa-mãe (o que um programa comum não consegue).
 *  - read(): pede uma leitura pelo pipe local \\.\pipe\NexoSensors (o serviço só responde leituras).
 *  - status(): instalado? rodando? versão instalada × versão que veio com este Nexo.
 *  - install(): baixa o instalador oficial do PawnIO (versão e SHA-256 fixados), confere o hash aqui e de novo
 *    no passo elevado, e pede ao Windows (UAC) para instalar o driver e o serviço. A pessoa pode recusar.
 */
const PIPE = '\\\\.\\pipe\\NexoSensors';
const REG_KEY = 'HKLM\\SOFTWARE\\NexoDeviceCare\\SensorService';

function parseScState(text) {
  // O rótulo (STATE/ESTADO…) muda com o idioma do Windows; o código e o nome do estado não.
  const match = String(text).match(/:\s*(\d)\s+(RUNNING|STOPPED|START_PENDING|STOP_PENDING|PAUSED|CONTINUE_PENDING|PAUSE_PENDING)\b/i);
  if (!match) return null;
  return { 1: 'stopped', 2: 'starting', 3: 'stopping', 4: 'running', 7: 'paused' }[match[1]] || 'unknown';
}
function parseRegVersion(text) {
  const match = String(text).match(/Version\s+REG_SZ\s+([\d.]+)/i);
  return match ? match[1] : null;
}
const sameVersion = (a, b) => Boolean(a && b && String(a).split('.').slice(0, 2).join('.') === String(b).split('.').slice(0, 2).join('.'));

function createSensorService({ net, fs, path, crypto, run, fetchBuffer, elevate, userData, hostDir, pawnio, timeoutMs = 12000 }) {
  let bundledVersion;

  function read() {
    return new Promise((resolve) => {
      let buffer = '';
      let done = false;
      const finish = (value) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(value); };
      const socket = net.connect(PIPE);
      const timer = setTimeout(() => finish(null), timeoutMs);
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write('sample\n'));
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 8 * 1024 * 1024) { finish(null); return; }
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        try { finish(JSON.parse(buffer.slice(0, newline))); } catch { finish(null); }
      });
      socket.on('error', () => finish(null));
      socket.on('close', () => finish(null));
    });
  }

  async function getBundledVersion() {
    if (bundledVersion !== undefined) return bundledVersion;
    const result = await run(path.join(hostDir, 'Nexo.SensorHost.exe'), ['--version']).catch(() => ({ stdout: '' }));
    bundledVersion = /^\d+\.\d+\.\d+/.test(String(result.stdout).trim()) ? String(result.stdout).trim().split(/\s/)[0] : null;
    return bundledVersion;
  }

  async function status() {
    const [sc, reg, bundled] = await Promise.all([
      run('sc.exe', ['query', 'NexoSensors']).catch(() => ({ stdout: '' })),
      run('reg.exe', ['query', REG_KEY, '/v', 'Version']).catch(() => ({ stdout: '' })),
      getBundledVersion()
    ]);
    const state = parseScState(sc.stdout);
    const installedVersion = parseRegVersion(reg.stdout);
    const installed = Boolean(state);
    return { installed, state, running: state === 'running', installedVersion, bundledVersion: bundled,
      needsInstall: Boolean(bundled) && (!installed || !sameVersion(installedVersion, bundled)) };
  }

  /** Baixa (se preciso) o instalador oficial do PawnIO e confere o SHA-256 antes de entregar o caminho. */
  async function pawnioSetup() {
    const dir = path.join(userData, 'pawnio');
    const file = path.join(dir, 'PawnIO_setup.exe');
    const hashOf = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
    const existing = await fs.readFile(file).catch(() => null);
    if (existing && hashOf(existing) === pawnio.sha256) return file;
    const bytes = await fetchBuffer(pawnio.url);
    if (hashOf(bytes) !== pawnio.sha256) throw new Error('O instalador do PawnIO baixado não confere com o hash fixado. Nada foi instalado.');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, bytes);
    return file;
  }

  async function install() {
    const setup = await pawnioSetup();
    const result = await elevate('sensor-service', { action: 'install', hostDir, pawnioSetup: setup });
    return { declined: result.declined, ok: Boolean(result.result?.ok), pawnio: result.result?.pawnio || '', service: result.result?.service || '', note: String(result.result?.note || '').slice(0, 240) };
  }

  return { read, status, install, pawnioSetup };
}

module.exports = { createSensorService, parseScState, parseRegVersion, sameVersion, PIPE };
