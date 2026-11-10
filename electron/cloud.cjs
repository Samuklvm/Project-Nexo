/*
 * Nexo na nuvem (servidor próprio na Cloudflare). Tudo desligado por padrão; cada parte liga separada:
 *  - sincronização: precisa do login Google; cada PC manda a SUA cópia; trazer dados de outro PC é escolha da pessoa;
 *  - relatórios de erro: SEMPRE ligados (desde a 0.11.1), os do registro local, agrupados, sem nome de usuário nem
 *    pastas; o e-mail da conta Google vai junto só com "incluir meu e-mail" marcado (dá para desmarcar);
 *  - telemetria: um resumo por dia (o de hoje, parcial, no máximo a cada 3 h), anônima (código aleatório deste PC,
 *    sem e-mail e sem conta).
 * O token de sessão do servidor fica cifrado com o cofre do sistema (safeStorage). Sem cofre (Linux sem chaveiro), o
 * token NÃO vai para o disco: vale só enquanto o app estiver aberto (antes era gravado em Base64, que não protege nada).
 * Toda gravação de cloud.json é conferida: se falhar, a tela fica sabendo e uma escolha que liga algo é desfeita.
 * Pedidos ao servidor têm prazo (20 s) e o envio do mesmo dia nunca roda duas vezes ao mesmo tempo.
 */
const crypto = require('crypto');

const DAY = 24 * 3600 * 1000;
const ROLE_CHECK_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const PARTIAL_EVERY_MS = 3 * 3600 * 1000;
const ERROR_BATCHES = 5;
/* `errors` fica sempre true: os relatórios de erro são obrigatórios desde a 0.11.1 (a chave continua por compatibilidade). */
const DEFAULTS = { sync: false, telemetry: false, errors: true, errorEmail: true, asked: false };

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Endereço do servidor: https, só host (e porta), sem caminho, usuário ou senha — conferido pela API de URL. */
function serverBase(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) return null;
  return url.origin;
}
const randomId = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

function createCloud({ fs, path, dir, serverUrl, fetchImpl, safeStorage, version, platform = process.platform, errorLog, accountEmail = async () => null, now = Date.now, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const file = path.join(dir, 'cloud.json');
  const base = serverBase(serverUrl);
  let state = null;
  let chain = Promise.resolve();
  let memoryToken = null; // sem cofre do sistema, o token fica só aqui
  const inflight = new Map();
  let lastSaveError = null;

  async function load() {
    if (state) return state;
    let stored = {};
    // Arquivo ilegível (cortado, editado): começa com tudo desligado, que é o lado seguro.
    try { stored = JSON.parse(await fs.readFile(file, 'utf8')); if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {}; } catch { stored = {}; }
    state = { ...DEFAULTS, ...stored };
    for (const key of Object.keys(DEFAULTS)) if (typeof state[key] !== 'boolean') state[key] = DEFAULTS[key];
    let fresh = false;
    // Relatórios de erro obrigatórios. Quem tinha desligado (antes da 0.11.1) começa a mandar a partir de agora: nada
    // do tempo em que estava desligado sai. Instalação nova (sem cloud.json) manda desde o começo.
    if (stored.errors !== true) {
      const firstRun = !stored.installId;
      state.errors = true;
      state.errorsWindowAt = firstRun ? 0 : now();
      if (!Number.isFinite(state.errorsCursor)) state.errorsCursor = 0;
      if (!firstRun) state.lastErrorsSentAt = now();
      fresh = true;
    }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(state.installId || ''))) { state.installId = randomId(); fresh = true; }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(state.deviceId || ''))) { state.deviceId = `pc-${randomId(12)}`; fresh = true; }
    // Códigos novos são gravados na hora: senão o PC ganharia outra identidade a cada abertura do app.
    // Token antigo gravado sem cofre (Base64): é descartado; a pessoa liga a sincronização de novo.
    if (state.session?.token && state.session.token.enc !== true) { state.session = null; state.sync = false; fresh = true; }
    if (fresh) await save().catch(() => {});
    return state;
  }
  /** Grava cloud.json (temporário + rename). A promessa REJEITA se não gravou; a fila continua para as próximas. */
  function save() {
    const run = chain.then(async () => {
      await fs.mkdir(dir, { recursive: true });
      const temp = `${file}.tmp`;
      await fs.writeFile(temp, JSON.stringify(state), 'utf8');
      await fs.rename(temp, file);
      lastSaveError = null;
      return true;
    });
    chain = run.catch((error) => { lastSaveError = { at: now(), code: String(error?.code || 'erro').slice(0, 20) }; });
    return run;
  }

  const vault = () => Boolean(safeStorage?.isEncryptionAvailable?.());
  function sealToken(token) {
    if (vault()) { memoryToken = null; return { enc: true, value: safeStorage.encryptString(token).toString('base64') }; }
    memoryToken = token;
    return { enc: false, memory: true };
  }
  function token() {
    const stored = state?.session?.token;
    if (!stored || !state.session.expiresAt || state.session.expiresAt <= now()) return null;
    if (stored.memory) return memoryToken;
    if (stored.enc !== true) return null;
    try { return safeStorage.decryptString(Buffer.from(stored.value, 'base64')); } catch { return null; }
  }

  async function request(method, route, { body, auth = true, optionalAuth = false } = {}) {
    if (!base) throw new Error('O servidor do Nexo não está configurado nesta versão.');
    const headers = { accept: 'application/json', 'user-agent': `NexoDeviceCare/${version}` };
    const bearer = auth || optionalAuth ? token() : null;
    if (auth && !bearer) throw Object.assign(new Error('Ative a sincronização para usar a sua conta no servidor.'), { status: 401 });
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    let data = {};
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null; // sempre limpo no finally
    try {
      try { response = await fetchImpl(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller?.signal }); }
      catch (error) { throw Object.assign(new Error(controller?.signal.aborted ? `O servidor do Nexo não respondeu em ${Math.round(timeoutMs / 1000)} s.` : 'Sem conexão com o servidor do Nexo agora.'), { offline: true, timeout: Boolean(controller?.signal.aborted), cause: error }); }
      try { data = await response.json(); } catch { data = {}; }
    } finally { if (timer) clearTimeout(timer); }
    if (response.status === 401 && auth) { state.session = null; state.sync = false; memoryToken = null; await save().catch(() => {}); }
    if (!response.ok) throw Object.assign(new Error(data.error || `O servidor respondeu ${response.status}.`), { status: response.status, code: data.code || null });
    return data;
  }

  async function status() {
    await load();
    return {
      configured: Boolean(base), sync: state.sync, telemetry: state.telemetry, errors: state.errors, errorEmail: state.errorEmail, asked: state.asked,
      connected: Boolean(token()), email: token() ? state.session.email : null, admin: Boolean(token() && state.session.admin),
      deviceId: state.deviceId, lastSyncAt: state.lastSyncAt || null, lastErrorsAt: state.lastErrorsSentAt || null, lastTelemetryDay: state.lastTelemetryDay || null,
      lastTelemetryAt: state.lastTelemetryAt || null, telemetryProblem: state.telemetryProblem || null, errorsProblem: state.errorsProblem || null,
      tokenProtected: vault(), saveProblem: lastSaveError, forgetEmailPending: state.forgetEmailPending === true
    };
  }

  /**
   * Liga/desliga telemetria e erros (e marca que a pergunta inicial já foi feita). Se não der para gravar a escolha,
   * o que LIGA algo é desfeito (o que desliga continua desligado nesta abertura) e o erro volta para a tela.
   */
  async function setOptions(options = {}) {
    await load();
    const before = { ...state };
    // `errors` não é mais uma escolha (relatórios de erro obrigatórios): um pedido para desligar é ignorado.
    for (const key of ['telemetry', 'errorEmail', 'asked']) if (typeof options[key] === 'boolean') state[key] = options[key];
    if (typeof options.sync === 'boolean') state.sync = options.sync && Boolean(token());
    try { await save(); }
    catch (error) {
      for (const key of ['telemetry', 'errorEmail', 'sync']) state[key] = Boolean(before[key] && state[key]);
      throw Object.assign(new Error(`Não consegui salvar a sua escolha no disco (${error?.code || 'erro'}). Nada foi ligado; tente de novo.`), { code: 'nao-salvou' });
    }
    // Desmarcou "incluir meu e-mail": o servidor tira o e-mail dos relatórios que este PC já mandou. Sem conexão agora,
    // fica pendente e é tentado de novo no próximo envio de erros (ou na próxima vez que mudar a escolha).
    if (before.errorEmail && !state.errorEmail) {
      state.forgetEmailPending = true;
      await save().catch(() => {});
      await forgetEmail().catch(() => {});
    }
    return status();
  }

  /** Pede ao servidor para tirar o e-mail dos relatórios deste PC (pendente até dar certo). */
  async function forgetEmail() {
    await load();
    if (!state.forgetEmailPending || !base) return { skipped: true };
    try {
      const data = await request('POST', '/v1/errors/forget-email', { auth: false, body: { installId: state.installId } });
      state.forgetEmailPending = false;
      state.errorsProblem = null;
      await save().catch(() => {});
      return { cleared: Number(data?.cleared) || 0 };
    } catch (error) {
      state.errorsProblem = { at: now(), message: `Não consegui tirar o seu e-mail dos relatórios ainda: ${String(error?.message || error).slice(0, 120)}` };
      await save().catch(() => {});
      throw error;
    }
  }

  /** Entra no servidor com o id_token do Google (vindo de um login feito agora). */
  async function connect(idToken, { sync = true } = {}) {
    await load();
    if (!idToken) throw new Error('Faça o login com o Google de novo para ligar a sincronização.');
    const data = await request('POST', '/v1/auth/google', { auth: false, body: { idToken, deviceId: state.deviceId } });
    state.session = { token: sealToken(String(data.token)), expiresAt: Number(data.expiresAt) || now() + 300 * DAY, email: String(data.user?.email || ''), admin: data.admin === true };
    if (sync) state.sync = true;
    await save();
    return status();
  }

  async function disconnect() {
    await load();
    if (token()) await request('POST', '/v1/auth/logout').catch(() => {});
    state.session = null;
    state.sync = false;
    memoryToken = null;
    await save();
    return status();
  }

  /** Apaga a conta inteira no servidor (cópias de todos os PCs; os erros ficam sem o e-mail). */
  async function deleteRemote() {
    await load();
    await request('DELETE', '/v1/me');
    state.session = null;
    state.sync = false;
    memoryToken = null;
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

  /**
   * Erros novos desde o último envio (só "erro"; avisos ficam no PC). Anda pela sequência do registro, em lotes de
   * 50 grupos: com mais erros diferentes que isso, os próximos lotes vão em seguida (nada fica para trás).
   * E-mail: o da sessão do servidor (verificado pelo Google lá) ou, sem sessão, o da conta Google entrada no app,
   * que o servidor guarda marcado como "informado pelo app".
   */
  function sendErrors() {
    if (inflight.has('errors')) return inflight.get('errors');
    const run = (async () => {
      await load();
      if (state.forgetEmailPending) await forgetEmail().catch(() => {});
      if (!state.errors || !base || !errorLog) return { skipped: true };
      if (!Number.isFinite(state.errorsWindowAt)) state.errorsWindowAt = state.lastErrorsSentAt || now();
      const legacy = Number.isFinite(state.errorsCursor) ? null : (state.lastErrorsSentAt || now());
      let sent = 0;
      for (let batch = 0; batch < ERROR_BATCHES; batch += 1) {
        const { groups, cursor, more } = await errorLog.groupsSince({ afterSeq: Number.isFinite(state.errorsCursor) ? state.errorsCursor : 0, notBefore: state.errorsWindowAt, legacyAfter: legacy, levels: ['erro'], limit: 50 });
        if (!groups.length) { if (Number.isFinite(cursor) && cursor > (state.errorsCursor || 0)) { state.errorsCursor = cursor; await save().catch(() => {}); } break; }
        const wantsEmail = state.errorEmail === true;
        const session = wantsEmail && Boolean(token());
        const contact = wantsEmail && !session ? await Promise.resolve(accountEmail()).catch(() => null) : null;
        const contactEmail = typeof contact === 'string' && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(contact) ? contact.slice(0, 254) : undefined;
        try {
          await request('POST', '/v1/errors', { auth: false, optionalAuth: session, body: { installId: state.installId, version, platform, includeEmail: session || Boolean(contactEmail), contactEmail, reports: groups } });
        } catch (error) { state.errorsProblem = { at: now(), message: String(error?.message || error).slice(0, 160) }; await save().catch(() => {}); throw error; }
        sent += groups.length;
        state.errorsCursor = cursor;
        state.lastErrorsSentAt = now();
        state.errorsProblem = null;
        await save();
        if (!more) break;
      }
      return { sent };
    })().finally(() => inflight.delete('errors'));
    inflight.set('errors', run);
    return run;
  }

  /**
   * Um resumo por dia. O dia completo sai depois que acaba (assim chegam as contagens do dia inteiro) e não vai de
   * novo; dias com mais de 6 dias ficam de fora. `partial`: o resumo de HOJE, ainda aberto (no máximo a cada 3 h),
   * para quem usa o app só um dia também aparecer; o completo, quando o dia acabar, substitui o parcial no servidor
   * (mesma chave instalação+dia). Dia no futuro (relógio do PC adiantado) não vira "hoje": espera o dia chegar.
   */
  function sendTelemetry(data, day = dayOf(now()), { partial = false } = {}) {
    const key = `tel:${day}:${partial ? 'p' : 'f'}`;
    if (inflight.has(key)) return inflight.get(key);
    const run = (async () => {
      await load();
      if (!state.telemetry || !base) return { skipped: true };
      const today = dayOf(now());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return { skipped: true, invalid: true };
      if (day > today) return { skipped: true, future: true };
      if (day < dayOf(now() - 6 * 86400000)) return { skipped: true, old: true };
      const sent = state.telemetryDays && typeof state.telemetryDays === 'object' ? state.telemetryDays : {};
      if (sent[day] || (!state.telemetryDays && state.lastTelemetryDay === day)) return { skipped: true, already: true };
      if (partial) {
        if (day !== today) return { skipped: true, invalid: true };
        if (Number.isFinite(state.lastPartialAt) && now() - state.lastPartialAt < PARTIAL_EVERY_MS && state.lastPartialDay === day) return { skipped: true, throttled: true };
      }
      try { await request('POST', '/v1/telemetry', { auth: false, body: { installId: state.installId, version, platform, day, partial: partial || undefined, data } }); }
      catch (error) { state.telemetryProblem = { at: now(), day, status: error.status || null, message: String(error?.message || error).slice(0, 160) }; await save().catch(() => {}); throw error; }
      state.telemetryProblem = null;
      state.lastTelemetryAt = now();
      if (partial) { state.lastPartialAt = now(); state.lastPartialDay = day; }
      else {
        sent[day] = now();
        state.telemetryDays = Object.fromEntries(Object.entries(sent).sort((a, b) => a[0].localeCompare(b[0])).slice(-14));
        if (!state.lastTelemetryDay || day > state.lastTelemetryDay) state.lastTelemetryDay = day;
      }
      await save().catch(() => {});
      return partial ? { sent: true, partial: true } : { sent: true };
    })().finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
  }

  async function adminLink() { await load(); return request('POST', '/v1/admin/link'); }

  /**
   * Confere no servidor se esta conta está na equipe do painel do criador (o papel pode mudar depois do login: o dono
   * adiciona ou tira a pessoa). No máximo a cada 10 min; sem conexão, fica o que já se sabia. Devolve true se mudou.
   */
  let roleCheckedAt = 0;
  async function refreshRole() {
    await load();
    if (!base || !token() || now() - roleCheckedAt < ROLE_CHECK_MS) return false;
    roleCheckedAt = now();
    let data;
    try { data = await request('GET', '/v1/me'); } catch { return false; }
    const admin = data?.admin === true;
    if (!state.session || state.session.admin === admin) return false;
    state.session.admin = admin;
    await save().catch(() => {});
    return true;
  }

  return { status, setOptions, connect, disconnect, deleteRemote, push, devices, pull, forget, sendErrors, sendTelemetry, adminLink, refreshRole, get configured() { return Boolean(base); } };
}

/**
 * Faz o resumo do dia caber no limite do servidor (TELEMETRY_BUDGET bytes). Corta do menos para o mais importante:
 * listas longas primeiro, depois partes inteiras de diagnóstico. Devolve o que cortou (vai para o registro se falhar).
 */
const TELEMETRY_BUDGET = 30000;
function fitTelemetry(input, budget = TELEMETRY_BUDGET) {
  const data = JSON.parse(JSON.stringify(input || {}));
  const bytes = () => Buffer.byteLength(JSON.stringify(data), 'utf8');
  const trimmed = [];
  const topN = (map, n) => (map && typeof map === 'object' ? Object.fromEntries(Object.entries(map).sort((a, b) => (Number(b[1]?.n ?? b[1]) || 0) - (Number(a[1]?.n ?? a[1]) || 0)).slice(0, n)) : map);
  const steps = [
    ['diag.ipc', () => { if (data.diag?.ipc) data.diag.ipc = topN(data.diag.ipc, 20); }],
    ['feats.listas', () => { if (data.feats) { data.feats.empty = (data.feats.empty || []).slice(0, 15); data.feats.crashed = (data.feats.crashed || []).slice(0, 15); } }],
    ['usage.actions', () => { if (data.usage?.actions) data.usage.actions = topN(data.usage.actions, 15); }],
    ['feats.sources', () => { if (data.feats?.sources) data.feats.sources = topN(data.feats.sources, 15); }],
    ['features', () => { if (data.features) data.features = topN(data.features, 15); }],
    ['diag', () => { delete data.diag; }],
    ['feats', () => { delete data.feats; }],
    ['library', () => { delete data.library; }],
    ['usage', () => { if (data.usage) data.usage = { views: data.usage.views }; }]
  ];
  for (const [name, step] of steps) {
    if (bytes() <= budget) break;
    step();
    trimmed.push(name);
  }
  return { data, bytes: bytes(), trimmed };
}

module.exports = { createCloud, fitTelemetry, DEFAULTS, TELEMETRY_BUDGET };
