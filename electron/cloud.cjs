/*
 * Nexo na nuvem (servidor próprio na Cloudflare). Tudo desligado por padrão; cada parte liga separada:
 *  - sincronização: precisa do login Google; cada PC manda a SUA cópia; trazer dados de outro PC é escolha da pessoa;
 *  - relatórios de erro: os do registro local, agrupados; o e-mail vai junto só se a pessoa marcar (e estiver logada);
 *  - telemetria: no máximo uma vez por dia, anônima (código aleatório deste PC, sem e-mail e sem conta).
 * O token de sessão do servidor fica cifrado com o cofre do sistema (safeStorage) quando disponível.
 */
const crypto = require('crypto');

const DAY = 24 * 3600 * 1000;
const DEFAULTS = { sync: false, telemetry: false, errors: false, errorEmail: true, asked: false };

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const randomId = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

function createCloud({ fs, path, dir, serverUrl, fetchImpl, safeStorage, version, platform = process.platform, errorLog, now = Date.now }) {
  const file = path.join(dir, 'cloud.json');
  const base = typeof serverUrl === 'string' && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(serverUrl.replace(/\/+$/, '')) ? serverUrl.replace(/\/+$/, '') : null;
  let state = null;
  let chain = Promise.resolve();

  async function load() {
    if (state) return state;
    let stored = {};
    try { stored = JSON.parse(await fs.readFile(file, 'utf8')); } catch { stored = {}; }
    state = { ...DEFAULTS, ...stored };
    for (const key of Object.keys(DEFAULTS)) if (typeof state[key] !== 'boolean') state[key] = DEFAULTS[key];
    let fresh = false;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(state.installId || ''))) { state.installId = randomId(); fresh = true; }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(state.deviceId || ''))) { state.deviceId = `pc-${randomId(12)}`; fresh = true; }
    // Códigos novos são gravados na hora: senão o PC ganharia outra identidade a cada abertura do app.
    if (fresh) await save();
    return state;
  }
  function save() {
    chain = chain.then(async () => {
      await fs.mkdir(dir, { recursive: true });
      const temp = `${file}.tmp`;
      await fs.writeFile(temp, JSON.stringify(state), 'utf8');
      await fs.rename(temp, file);
    }).catch(() => {});
    return chain;
  }

  const sealToken = (token) => (safeStorage?.isEncryptionAvailable?.() ? { enc: true, value: safeStorage.encryptString(token).toString('base64') } : { enc: false, value: Buffer.from(token, 'utf8').toString('base64') });
  function token() {
    const stored = state?.session?.token;
    if (!stored || !state.session.expiresAt || state.session.expiresAt <= now()) return null;
    try { return stored.enc ? safeStorage.decryptString(Buffer.from(stored.value, 'base64')) : Buffer.from(stored.value, 'base64').toString('utf8'); } catch { return null; }
  }

  async function request(method, route, { body, auth = true, optionalAuth = false } = {}) {
    if (!base) throw new Error('O servidor do Nexo não está configurado nesta versão.');
    const headers = { accept: 'application/json', 'user-agent': `NexoDeviceCare/${version}` };
    const bearer = auth || optionalAuth ? token() : null;
    if (auth && !bearer) throw Object.assign(new Error('Ative a sincronização para usar a sua conta no servidor.'), { status: 401 });
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try { response = await fetchImpl(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); } catch { throw new Error('Sem conexão com o servidor do Nexo agora.'); }
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (response.status === 401 && auth) { state.session = null; state.sync = false; await save(); }
    if (!response.ok) throw Object.assign(new Error(data.error || `O servidor respondeu ${response.status}.`), { status: response.status });
    return data;
  }

  async function status() {
    await load();
    return {
      configured: Boolean(base), sync: state.sync, telemetry: state.telemetry, errors: state.errors, errorEmail: state.errorEmail, asked: state.asked,
      connected: Boolean(token()), email: token() ? state.session.email : null, admin: Boolean(token() && state.session.admin),
      deviceId: state.deviceId, lastSyncAt: state.lastSyncAt || null, lastErrorsAt: state.lastErrorsSentAt || null, lastTelemetryDay: state.lastTelemetryDay || null
    };
  }

  /** Liga/desliga telemetria e erros (e marca que a pergunta inicial já foi feita). */
  async function setOptions(options = {}) {
    await load();
    for (const key of ['telemetry', 'errors', 'errorEmail', 'asked']) if (typeof options[key] === 'boolean') state[key] = options[key];
    if (typeof options.sync === 'boolean') state.sync = options.sync && Boolean(token());
    // Ao ligar os erros, só vai o que acontecer daqui para frente (nada do passado sem a pessoa ver).
    if (options.errors === true && !state.lastErrorsSentAt) state.lastErrorsSentAt = now();
    await save();
    return status();
  }

  /** Entra no servidor com o id_token do Google (vindo de um login feito agora). */
  async function connect(idToken) {
    await load();
    if (!idToken) throw new Error('Faça o login com o Google de novo para ligar a sincronização.');
    const data = await request('POST', '/v1/auth/google', { auth: false, body: { idToken, deviceId: state.deviceId } });
    state.session = { token: sealToken(String(data.token)), expiresAt: Number(data.expiresAt) || now() + 300 * DAY, email: String(data.user?.email || ''), admin: data.admin === true };
    state.sync = true;
    await save();
    return status();
  }

  async function disconnect() {
    await load();
    if (token()) await request('POST', '/v1/auth/logout').catch(() => {});
    state.session = null;
    state.sync = false;
    await save();
    return status();
  }

  /** Apaga a conta inteira no servidor (cópias de todos os PCs; os erros ficam sem o e-mail). */
  async function deleteRemote() {
    await load();
    await request('DELETE', '/v1/me');
    state.session = null;
    state.sync = false;
    await save();
    return status();
  }

  /** Manda a cópia deste PC (se a sincronização está ligada). */
  async function push({ name, sections }) {
    await load();
    if (!state.sync || !token()) return { skipped: true };
    const result = await request('PUT', `/v1/sync/${encodeURIComponent(state.deviceId)}`, { body: { name: String(name || 'PC').slice(0, 80), appVersion: version, sections } });
    state.lastSyncAt = now();
    await save();
    return result;
  }

  async function devices() { await load(); return request('GET', '/v1/sync'); }
  async function pull(deviceId, only = []) {
    await load();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(deviceId))) throw new Error('PC inválido.');
    const query = only.length ? `?only=${only.filter((name) => /^[a-z][a-z0-9]{1,23}$/.test(name)).join(',')}` : '';
    return request('GET', `/v1/sync/${encodeURIComponent(deviceId)}${query}`);
  }
  async function forget(deviceId) {
    await load();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(deviceId))) throw new Error('PC inválido.');
    return request('DELETE', `/v1/sync/${encodeURIComponent(deviceId)}`);
  }

  /** Erros novos desde o último envio (só "erro"; avisos ficam no PC). */
  async function sendErrors() {
    await load();
    if (!state.errors || !base || !errorLog) return { skipped: true };
    const since = state.lastErrorsSentAt || now();
    const { groups, newest } = await errorLog.groupsSince(since, { levels: ['erro'], limit: 50 });
    if (!groups.length) return { sent: 0 };
    const includeEmail = state.errorEmail && Boolean(token());
    await request('POST', '/v1/errors', { auth: false, optionalAuth: includeEmail, body: { installId: state.installId, version, platform, includeEmail, reports: groups } });
    state.lastErrorsSentAt = newest;
    await save();
    return { sent: groups.length };
  }

  /** Telemetria do dia (uma vez). `data` já vem montado (hardware, uso das telas, recursos). */
  async function sendTelemetry(data) {
    await load();
    if (!state.telemetry || !base) return { skipped: true };
    const day = dayOf(now());
    if (state.lastTelemetryDay === day) return { skipped: true, already: true };
    await request('POST', '/v1/telemetry', { auth: false, body: { installId: state.installId, version, platform, day, data } });
    state.lastTelemetryDay = day;
    await save();
    return { sent: true };
  }

  async function adminLink() { await load(); return request('POST', '/v1/admin/link'); }

  return { status, setOptions, connect, disconnect, deleteRemote, push, devices, pull, forget, sendErrors, sendTelemetry, adminLink, get configured() { return Boolean(base); } };
}

module.exports = { createCloud, DEFAULTS };
