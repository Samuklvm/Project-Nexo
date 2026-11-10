/*
 * Servidor do Nexo Device Care.
 *
 *  /v1/auth/google   login com o id_token do Google → sessão do Nexo (1 ano, revogável)
 *  /v1/me            conta: ver e APAGAR TUDO (direito da pessoa, LGPD)
 *  /v1/sync          uma cópia criptografada por PC; trazer dados de outro PC é escolha da pessoa no app
 *  /v1/errors        relatórios de erro agrupados (com o e-mail só de quem está logado e aceitou)
 *  /v1/telemetry     um pacote por dia, anônimo (código aleatório do PC), só para quem ligou
 *  /v1/steam/*       "Entrar com a Steam" (OpenID oficial) e jogos/conquistas da conta pela chave do criador (src/steam.js)
 *  /painel           painel do criador (entrada por link de uso único gerado no app do criador)
 *
 * Nada aqui registra o conteúdo dos pedidos em log.
 */
import { open, randomId, seal, sha256Hex, signToken, verifyToken } from './crypto.js';
import { verifyGoogleIdToken } from './google.js';
import { LEVELS, LIMITS, PLATFORMS, RE, SOURCES, STATUSES, clampInt, cleanTelemetry, compareVersions, dayOf, isCalendarDay, redact, text } from './validate.js';
import { PANEL_CSS, PANEL_HTML, PANEL_JS, PANEL_LOCKED, PANEL_WALLPAPER } from './panel.js';
import { createSteam } from './steam.js';

const DAY = 24 * 3600 * 1000;
const SESSION_DAYS = 365;
const ADMIN_LINK_MS = 60 * 1000;
const ADMIN_SESSION_MS = 8 * 3600 * 1000;
export const SERVER_VERSION = '1.0.0';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};
const PANEL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra } });
}
function page(body, type, status = 200, extra = {}) {
  return new Response(body, { status, headers: { 'content-type': type, 'cache-control': 'no-store', 'content-security-policy': PANEL_CSP, ...SECURITY_HEADERS, ...extra } });
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > LIMITS.body) throw new HttpError(413, 'Pedido grande demais.');
  const raw = await request.text();
  if (raw.length > LIMITS.body) throw new HttpError(413, 'Pedido grande demais.');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
}

const adminEmails = (env) => String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map((item) => item.trim()).filter(Boolean);
// Partes sem ponto separadas por ponto: sem sobreposição entre os trechos, a checagem é linear (sem retrocesso).
const EMAIL = /^[^\s@]{1,64}@[^\s@.]{1,63}(?:\.[^\s@.]{1,63}){1,8}$/;
export const ROLES = { dono: 'Dono', colaborador: 'Colaborador', leitura: 'Leitura' };
/** O que cada papel pode fazer no painel. */
const CAN = {
  dono: new Set(['ver', 'emails', 'status', 'equipe', 'chaves']),
  colaborador: new Set(['ver', 'emails', 'status']),
  leitura: new Set(['ver'])
};

/** Cria o servidor do Nexo (sincronização, relatórios de erro, telemetria, Steam e painel do criador). */
export function createApp({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  /** Limite diário por chave (pessoa, PC ou IP com hash). */
  async function allow(env, key, max) {
    const day = dayOf(now());
    const row = await env.DB.prepare('SELECT day, count FROM rate WHERE key = ?').bind(key).first();
    if (row && row.day === day && row.count >= max) return false;
    if (!row || row.day !== day) await env.DB.prepare('INSERT INTO rate (key, day, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET day = excluded.day, count = 1').bind(key, day).run();
    else await env.DB.prepare('UPDATE rate SET count = count + 1 WHERE key = ?').bind(key).run();
    return true;
  }
  async function limit(env, key, max) { if (!await allow(env, key, max)) throw new HttpError(429, 'Muitos pedidos hoje. Tente amanhã.'); }
  const steam = createSteam({ fetchImpl, now, limit, json });
  // O IP nunca é guardado: só um resumo com o segredo do servidor (sem ele, não dá para voltar ao IP), apagado em um dia.
  const ipKey = async (request, env) => {
    const mixed = await sha256Hex(`${env.SESSION_SECRET}|${request.headers.get('cf-connecting-ip') || 'local'}`);
    return `ip:${mixed.slice(0, 20)}`;
  };

  /** Papel no painel: dono (segredo ADMIN_EMAILS), colaborador ou leitura (aba Equipe), ou nenhum. */
  async function roleOf(env, email) {
    const normalized = String(email || '').toLowerCase();
    if (!normalized) return null;
    if (adminEmails(env).includes(normalized)) return 'dono';
    const row = await env.DB.prepare('SELECT role FROM team WHERE email = ?').bind(normalized).first();
    return row && CAN[row.role] && row.role !== 'dono' ? row.role : null;
  }

  /** Sessão do app (Authorization: Bearer). Devolve null sem token; lança 401 com token inválido. */
  async function session(request, env, { required = true } = {}) {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      if (required) throw new HttpError(401, 'Entre com a sua conta Google no Nexo.');
      return null;
    }
    const payload = await verifyToken(token, env.SESSION_SECRET, now());
    if (!payload?.sid) throw new HttpError(401, 'Sessão inválida. Entre de novo.');
    const row = await env.DB.prepare('SELECT s.sid, s.uid, s.device_id, s.expires_at, s.revoked, u.email, u.name FROM sessions s JOIN users u ON u.uid = s.uid WHERE s.sid = ?').bind(payload.sid).first();
    if (!row || row.revoked || row.expires_at <= now()) throw new HttpError(401, 'Sessão encerrada. Entre de novo.');
    return { sid: row.sid, uid: row.uid, deviceId: row.device_id, email: row.email, name: row.name };
  }

  /* ---------- Conta ---------- */
  async function login(request, env) {
    await limit(env, await ipKey(request, env), 60);
    const body = await readJson(request);
    const deviceId = RE.deviceId.test(String(body.deviceId || '')) ? body.deviceId : null;
    const google = await verifyGoogleIdToken(body.idToken, { clientIds: env.GOOGLE_CLIENT_IDS, fetchImpl, now: now() });
    const subjectHash = await sha256Hex(`google:${google.sub}`);
    const uid = `u_${subjectHash.slice(0, 32)}`;
    const at = now();
    await env.DB.prepare('INSERT INTO users (uid, google_sub, email, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET email = excluded.email, name = excluded.name, last_seen = excluded.last_seen')
      .bind(uid, google.sub, google.email, google.name, at, at).run();
    const sid = randomId(18);
    const expiresAt = at + SESSION_DAYS * DAY;
    await env.DB.prepare('INSERT INTO sessions (sid, uid, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(sid, uid, deviceId, at, expiresAt).run();
    const token = await signToken({ sid, exp: expiresAt }, env.SESSION_SECRET);
    const role = await roleOf(env, google.email);
    return json({ token, expiresAt, user: { email: google.email, name: google.name }, admin: Boolean(role), role });
  }

  async function logout(request, env) {
    const who = await session(request, env);
    await env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE sid = ?').bind(who.sid).run();
    return json({ ok: true });
  }

  async function me(request, env) {
    const who = await session(request, env);
    const devices = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE uid = ?').bind(who.uid).first();
    const role = await roleOf(env, who.email);
    return json({ email: who.email, name: who.name, devices: devices?.n || 0, admin: Boolean(role), role });
  }

  /** Apaga tudo da conta. Os relatórios de erro ficam, mas sem o e-mail. */
  async function deleteMe(request, env) {
    const who = await session(request, env);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM snapshots WHERE uid = ?').bind(who.uid),
      env.DB.prepare('DELETE FROM sessions WHERE uid = ?').bind(who.uid),
      env.DB.prepare('UPDATE error_reports SET email = NULL WHERE email = ?').bind(who.email),
      env.DB.prepare('DELETE FROM users WHERE uid = ?').bind(who.uid)
    ]);
    return json({ ok: true, deleted: true });
  }

  /* ---------- Sincronização ---------- */
  async function listDevices(request, env) {
    const who = await session(request, env);
    const { results = [] } = await env.DB.prepare('SELECT device_id, name_enc, sections, size, app_version, updated_at FROM snapshots WHERE uid = ? ORDER BY updated_at DESC').bind(who.uid).all();
    // Os nomes são decifrados em paralelo (cada um é independente); um nome ou lista ilegível não derruba a lista.
    const devices = await Promise.all(results.map(async (row) => {
      let name = 'PC';
      try { name = await open(row.name_enc, { dataKey: env.DATA_KEY, uid: who.uid }); } catch { /* nome ilegível: segue */ }
      let sections = [];
      try { sections = JSON.parse(row.sections || '[]'); } catch { /* lista ilegível: segue vazia */ }
      return { deviceId: row.device_id, name, sections: Array.isArray(sections) ? sections : [], size: row.size, appVersion: row.app_version, updatedAt: row.updated_at, current: row.device_id === who.deviceId };
    }));
    return json({ devices });
  }

  /** Guarda (cifrada) a cópia de um PC da conta, com limite de tamanho e de PCs. */
  async function putDevice(request, env, deviceId) {
    const who = await session(request, env);
    if (!RE.deviceId.test(deviceId)) throw new HttpError(400, 'PC inválido.');
    await limit(env, `sync:${who.uid}`, 400);
    const body = await readJson(request);
    const sections = body.sections && typeof body.sections === 'object' && !Array.isArray(body.sections) ? body.sections : null;
    if (!sections) throw new HttpError(400, 'Nada para guardar.');
    const names = Object.keys(sections);
    if (!names.length || names.length > LIMITS.sections || !names.every((name) => RE.section.test(name))) throw new HttpError(400, 'Seções inválidas.');
    const plain = JSON.stringify(sections);
    if (plain.length > LIMITS.snapshot) throw new HttpError(413, 'Os dados deste PC passaram de 1 MB.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE uid = ? AND device_id != ?').bind(who.uid, deviceId).first();
    if ((count?.n || 0) >= 20) throw new HttpError(409, 'Limite de 20 PCs por conta. Apague um PC antigo no Nexo.');
    const name = text(body.name, LIMITS.deviceName) || 'PC';
    const version = RE.version.test(String(body.appVersion || '')) ? body.appVersion : null;
    const at = now();
    const keys = { dataKey: env.DATA_KEY, uid: who.uid };
    await env.DB.prepare('INSERT INTO snapshots (uid, device_id, name_enc, data_enc, sections, size, app_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid, device_id) DO UPDATE SET name_enc = excluded.name_enc, data_enc = excluded.data_enc, sections = excluded.sections, size = excluded.size, app_version = excluded.app_version, updated_at = excluded.updated_at')
      .bind(who.uid, deviceId, await seal(name, keys), await seal(sections, keys), JSON.stringify(names), plain.length, version, at).run();
    return json({ ok: true, updatedAt: at, size: plain.length });
  }

  async function getDevice(request, env, deviceId, url) {
    const who = await session(request, env);
    if (!RE.deviceId.test(deviceId)) throw new HttpError(400, 'PC inválido.');
    const row = await env.DB.prepare('SELECT name_enc, data_enc, updated_at, app_version FROM snapshots WHERE uid = ? AND device_id = ?').bind(who.uid, deviceId).first();
    if (!row) throw new HttpError(404, 'Este PC não tem dados guardados.');
    const keys = { dataKey: env.DATA_KEY, uid: who.uid };
    const all = await open(row.data_enc, keys);
    const only = (url.searchParams.get('only') || '').split(',').filter((name) => RE.section.test(name));
    const sections = only.length ? Object.fromEntries(Object.entries(all).filter(([name]) => only.includes(name))) : all;
    return json({ deviceId, name: await open(row.name_enc, keys).catch(() => 'PC'), updatedAt: row.updated_at, appVersion: row.app_version, sections });
  }

  async function deleteDevice(request, env, deviceId) {
    const who = await session(request, env);
    if (!RE.deviceId.test(deviceId)) throw new HttpError(400, 'PC inválido.');
    await env.DB.prepare('DELETE FROM snapshots WHERE uid = ? AND device_id = ?').bind(who.uid, deviceId).run();
    return json({ ok: true });
  }

  /* ---------- Erros ---------- */
  /**
   * Tira o e-mail dos relatórios que ESTE PC mandou (quem desmarcou "incluir meu e-mail"). Vale também para o e-mail
   * não confirmado, de quem nunca ligou a sincronização: o código da instalação só existe nos dados do app daquele PC.
   */
  async function forgetErrorEmail(request, env) {
    const body = await readJson(request);
    const installId = String(body.installId || '');
    if (!RE.installId.test(installId)) throw new HttpError(400, 'Instalação inválida.');
    await limit(env, `errmail:${installId}`, 20);
    const result = await env.DB.prepare('UPDATE error_reports SET email = NULL, email_verified = 1 WHERE install_id = ? AND email IS NOT NULL').bind(installId).run();
    return json({ ok: true, cleared: result?.meta?.changes ?? 0 });
  }

  /**
   * E-mail dos relatórios: o da sessão (confirmado pelo Google no login) vale mais. Sem sessão, aceita o que o app
   * informou da conta Google entrada nele, guardado como "não confirmado" (email_verified = 0). Só com includeEmail.
   */
  async function reportEmail(request, env, body) {
    if (body.includeEmail !== true) return { email: null, verified: 1 };
    const fromSession = (await session(request, env, { required: false }).catch(() => null))?.email || null;
    if (fromSession) return { email: fromSession, verified: 1 };
    const contact = typeof body.contactEmail === 'string' ? body.contactEmail.trim().toLowerCase().slice(0, 254) : '';
    return EMAIL.test(contact) ? { email: contact, verified: 0 } : { email: null, verified: 1 };
  }

  /** Os dois comandos de um relatório válido: o grupo do erro (texto limpo de novo) e a contagem deste PC. */
  function reportStatements(env, report, { installId, email, verified, version, platform, at }) {
    const source = SOURCES.has(report.source) ? report.source : 'principal';
    const level = LEVELS.has(report.level) ? report.level : 'erro';
    const message = redact(text(report.message, LIMITS.message)) || 'Erro sem mensagem';
    const stack = redact(text(report.stack, LIMITS.stack));
    const context = redact(text(report.context, LIMITS.context));
    const count = clampInt(report.count, 1, 100000, 1);
    const lastAt = Math.min(at, clampInt(report.lastAt, at - 400 * DAY, at, at));
    const firstAt = Math.min(lastAt, clampInt(report.firstAt, at - 400 * DAY, at, lastAt));
    return [
      env.DB.prepare(`INSERT INTO error_groups (signature, source, level, message, stack, context, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(signature) DO UPDATE SET message = excluded.message, context = excluded.context, stack = CASE WHEN excluded.stack != '' THEN excluded.stack ELSE error_groups.stack END,
        first_at = MIN(error_groups.first_at, excluded.first_at), last_at = MAX(error_groups.last_at, excluded.last_at),
        level = CASE WHEN excluded.level = 'erro' THEN 'erro' ELSE error_groups.level END`).bind(report.signature, source, level, message, stack, context, firstAt, lastAt),
      env.DB.prepare(`INSERT INTO error_reports (signature, install_id, email, email_verified, version, platform, count, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(signature, install_id) DO UPDATE SET
          email = CASE WHEN excluded.email IS NULL THEN error_reports.email WHEN error_reports.email IS NOT NULL AND error_reports.email_verified = 1 AND excluded.email_verified = 0 THEN error_reports.email ELSE excluded.email END,
          email_verified = CASE WHEN excluded.email IS NULL THEN error_reports.email_verified WHEN error_reports.email IS NOT NULL AND error_reports.email_verified = 1 AND excluded.email_verified = 0 THEN 1 ELSE excluded.email_verified END,
          version = excluded.version, platform = excluded.platform,
          count = error_reports.count + excluded.count, first_at = MIN(error_reports.first_at, excluded.first_at), last_at = MAX(error_reports.last_at, excluded.last_at)`).bind(report.signature, installId, email, verified, version, platform, count, firstAt, lastAt)
    ];
  }

  /** Corrigido, mas voltou numa versão igual ou mais nova que a da correção: reabre (comparar versões no SQL é ruim). */
  async function reopenStatement(env, signatures, version) {
    const fixed = (await env.DB.prepare(`SELECT signature, fixed_in FROM error_groups WHERE status = 'corrigido' AND signature IN (${signatures.map(() => '?').join(',')})`).bind(...signatures).all()).results || [];
    const reopen = fixed.filter((row) => row.fixed_in && compareVersions(version, row.fixed_in) >= 0).map((row) => row.signature);
    return reopen.length ? env.DB.prepare(`UPDATE error_groups SET status = 'reaberto' WHERE signature IN (${reopen.map(() => '?').join(',')})`).bind(...reopen) : null;
  }

  /** Recebe os relatórios de erro de um PC (em grupos), com limite por PC e por IP. */
  async function postErrors(request, env) {
    const body = await readJson(request);
    const installId = String(body.installId || '');
    if (!RE.installId.test(installId)) throw new HttpError(400, 'Instalação inválida.');
    await limit(env, `err:${installId}`, 30);
    await limit(env, `errip:${(await ipKey(request, env)).slice(3)}`, 300);
    const version = RE.version.test(String(body.version || '')) ? body.version : '0.0.0';
    const platform = PLATFORMS.has(body.platform) ? body.platform : 'win32';
    const { email, verified } = await reportEmail(request, env, body);
    const valid = (Array.isArray(body.reports) ? body.reports.slice(0, LIMITS.reportsPerPost) : []).filter((report) => report && RE.signature.test(String(report.signature || '')));
    if (!valid.length) return json({ ok: true, accepted: 0 });
    const at = now();
    const statements = valid.flatMap((report) => reportStatements(env, report, { installId, email, verified, version, platform, at }));
    const reopen = await reopenStatement(env, [...new Set(valid.map((report) => report.signature))], version);
    if (reopen) statements.push(reopen);
    statements.push(seenInstall(env, installId, version, platform, 'erros'));
    await env.DB.batch(statements);
    return json({ ok: true, accepted: valid.length });
  }

  /** Primeira e última vez que uma instalação apareceu (base de "usuários novos" no painel). */
  function seenInstall(env, installId, version, platform, via) {
    const at = now();
    return env.DB.prepare(`INSERT INTO installs (install_id, first_seen, last_seen, first_version, last_version, platform, via) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(install_id) DO UPDATE SET last_seen = MAX(installs.last_seen, excluded.last_seen), last_version = excluded.last_version, platform = excluded.platform`).bind(installId, at, at, version, version, platform, via);
  }

  /* ---------- Telemetria ---------- */
  async function postTelemetry(request, env) {
    const body = await readJson(request);
    const installId = String(body.installId || '');
    if (!RE.installId.test(installId)) throw new HttpError(400, 'Instalação inválida.');
    // Um resumo por dia fechado (o app guarda os dias de quando estava sem internet) e o de hoje, parcial, a cada 3 h.
    await limit(env, `tel:${installId}`, 30);
    const data = cleanTelemetry(body.data);
    if (!data) throw new HttpError(400, 'Telemetria inválida.');
    const today = dayOf(now());
    if (body.day !== undefined && !isCalendarDay(body.day)) throw Object.assign(new HttpError(400, 'Dia inválido.'), { code: 'dia-invalido' });
    const day = body.day || today;
    // Dia no futuro (relógio do PC adiantado): recusa em vez de gravar como hoje — senão sobrescreveria o resumo de hoje.
    if (day > today) throw Object.assign(new HttpError(400, 'Dia no futuro: confira o relógio do PC.'), { code: 'dia-futuro' });
    if (day < dayOf(now() - 7 * DAY)) throw Object.assign(new HttpError(400, 'Dia antigo demais.'), { code: 'dia-antigo' });
    const partial = body.partial === true ? 1 : 0;
    if (partial && day !== today) throw Object.assign(new HttpError(400, 'Resumo parcial só vale para hoje.'), { code: 'parcial-fora-de-hoje' });
    const version = RE.version.test(String(body.version || '')) ? body.version : '0.0.0';
    const platform = PLATFORMS.has(body.platform) ? body.platform : 'win32';
    // O completo sempre substitui o parcial; um parcial nunca substitui um completo já recebido.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO telemetry (install_id, day, version, platform, data, received_at, partial) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(install_id, day) DO UPDATE SET version = excluded.version, platform = excluded.platform, data = excluded.data, received_at = excluded.received_at, partial = excluded.partial
        WHERE excluded.partial = 0 OR telemetry.partial = 1`).bind(installId, day, version, platform, JSON.stringify(data), now(), partial),
      seenInstall(env, installId, version, platform, 'telemetria')
    ]);
    return json({ ok: true, partial: Boolean(partial) });
  }

  /* ---------- Painel do criador ---------- */
  async function adminLink(request, env, url) {
    const who = await session(request, env);
    if (!await roleOf(env, who.email)) throw new HttpError(403, 'Só o criador do Nexo e a equipe dele entram no painel.');
    const code = randomId(24);
    await env.DB.prepare('INSERT INTO admin_links (code, email, expires_at) VALUES (?, ?, ?)').bind(code, who.email, now() + ADMIN_LINK_MS).run();
    return json({ url: `${url.origin}/painel/entrar?c=${code}`, expiresIn: ADMIN_LINK_MS / 1000 });
  }

  /** Entrada no painel pelo link de uso único: confere, gasta o link e cria a sessão do painel (cookie de 8 h). */
  async function adminEnter(env, url) {
    const code = url.searchParams.get('c') || '';
    const row = /^[A-Za-z0-9_-]{20,64}$/.test(code) ? await env.DB.prepare('SELECT code, email, expires_at, used FROM admin_links WHERE code = ?').bind(code).first() : null;
    if (!row || row.used || row.expires_at < now() || !await roleOf(env, row.email)) return page(PANEL_LOCKED('O link expirou ou já foi usado. Abra de novo pelo Nexo.'), 'text/html; charset=utf-8', 403);
    const sid = randomId(24);
    await env.DB.batch([
      env.DB.prepare('UPDATE admin_links SET used = 1 WHERE code = ?').bind(code),
      env.DB.prepare('INSERT INTO admin_sessions (sid, email, expires_at) VALUES (?, ?, ?)').bind(sid, row.email, now() + ADMIN_SESSION_MS)
    ]);
    const cookie = await signToken({ sid, exp: now() + ADMIN_SESSION_MS }, env.SESSION_SECRET);
    return new Response(null, { status: 302, headers: { location: '/painel', 'set-cookie': `nexo_painel=${cookie}; Path=/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_MS / 1000}`, 'cache-control': 'no-store', ...SECURITY_HEADERS } });
  }

  async function adminSession(request, env) {
    const cookie = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('nexo_painel='))?.slice('nexo_painel='.length);
    const payload = cookie ? await verifyToken(cookie, env.SESSION_SECRET, now()) : null;
    if (!payload?.sid) return null;
    const row = await env.DB.prepare('SELECT email, expires_at FROM admin_sessions WHERE sid = ?').bind(payload.sid).first();
    // O papel é conferido a cada pedido: tirar alguém da equipe corta o acesso na hora.
    const role = row && row.expires_at >= now() ? await roleOf(env, row.email) : null;
    if (!role) return null;
    return { email: row.email, sid: payload.sid, role, can: (action) => CAN[role].has(action) };
  }

  /* ----- API do painel: cada função recebe { request, env, url, admin, need } ----- */

  /** Números da página inicial do painel: erros abertos, instalações ativas, versões e usuários novos. */
  async function adminSummary({ env, admin }) {
    const since7 = now() - 7 * DAY;
    const [open7, reporters, active7, active30, versions] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM error_groups WHERE status IN ('aberto','reaberto') AND level = 'erro'").first(),
      env.DB.prepare('SELECT COUNT(DISTINCT install_id) AS n FROM error_reports WHERE last_at >= ?').bind(since7).first(),
      env.DB.prepare('SELECT COUNT(DISTINCT install_id) AS n FROM telemetry WHERE day >= ?').bind(dayOf(since7)).first(),
      env.DB.prepare('SELECT COUNT(DISTINCT install_id) AS n FROM telemetry WHERE day >= ?').bind(dayOf(now() - 30 * DAY)).first(),
      env.DB.prepare('SELECT version, COUNT(DISTINCT install_id) AS n FROM telemetry WHERE day >= ? GROUP BY version ORDER BY n DESC LIMIT 10').bind(dayOf(since7)).all()
    ]);
    const accounts = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    // Usuários novos = instalações vistas pela primeira vez (um código aleatório por instalação; atualizar não conta).
    const startOfToday = Date.parse(`${dayOf(now())}T00:00:00Z`);
    const [new1, new7, new30, newAccounts7, firstDays] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM installs WHERE first_seen >= ?').bind(startOfToday).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM installs WHERE first_seen >= ?').bind(now() - 7 * DAY).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM installs WHERE first_seen >= ?').bind(now() - 30 * DAY).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?').bind(now() - 7 * DAY).first(),
      env.DB.prepare("SELECT strftime('%Y-%m-%d', first_seen / 1000, 'unixepoch') AS day, COUNT(*) AS n, GROUP_CONCAT(DISTINCT first_version) AS versions, GROUP_CONCAT(DISTINCT platform) AS platforms FROM installs WHERE first_seen >= ? GROUP BY day ORDER BY day").bind(now() - 30 * DAY).all()
    ]);
    const recent = await env.DB.prepare('SELECT first_seen, last_seen, first_version, last_version, platform, via FROM installs ORDER BY first_seen DESC LIMIT 15').all();
    return json({ openErrors: open7?.n || 0, reportingInstalls7: reporters?.n || 0, activeInstalls7: active7?.n || 0, activeInstalls30: active30?.n || 0, accounts: accounts?.n || 0, versions: versions.results || [], admin: admin.email, role: admin.role, permissions: [...CAN[admin.role]],
      newUsers: { today: new1?.n || 0, days7: new7?.n || 0, days30: new30?.n || 0, accounts7: newAccounts7?.n || 0, perDay: firstDays.results || [], recent: recent.results || [] } });
  }

  /** Lista dos erros agrupados (abertos e reabertos primeiro), com filtro de status e, se pedido, os avisos. */
  async function adminErrorList({ env, url }) {
    const status = STATUSES.has(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
    const levelAll = url.searchParams.get('avisos') === '1';
    const { results = [] } = await env.DB.prepare(`SELECT g.signature, g.source, g.level, g.message, g.context, g.first_at, g.last_at, g.status, g.fixed_in, g.note,
        COUNT(r.install_id) AS installs, COALESCE(SUM(r.count), 0) AS occurrences, COUNT(r.email) AS emails, GROUP_CONCAT(DISTINCT r.version) AS versions, GROUP_CONCAT(DISTINCT r.platform) AS platforms
      FROM error_groups g LEFT JOIN error_reports r ON r.signature = g.signature
      WHERE (? IS NULL OR g.status = ?) AND (? = 1 OR g.level = 'erro')
      GROUP BY g.signature ORDER BY CASE g.status WHEN 'reaberto' THEN 0 WHEN 'aberto' THEN 1 ELSE 2 END, g.last_at DESC LIMIT 300`).bind(status, status, levelAll ? 1 : 0).all();
    return json({ groups: results });
  }

  /** Um erro com os PCs que mandaram; os e-mails só aparecem para quem tem a permissão "emails". */
  async function adminErrorDetail({ env, admin }, signature) {
    const group = await env.DB.prepare('SELECT * FROM error_groups WHERE signature = ?').bind(signature).first();
    if (!group) throw new HttpError(404, 'Erro não encontrado.');
    const { results = [] } = await env.DB.prepare('SELECT email, email_verified, version, platform, count, first_at, last_at FROM error_reports WHERE signature = ? ORDER BY last_at DESC LIMIT 500').bind(signature).all();
    const byEmail = new Map();
    if (admin.can('emails')) for (const row of results) if (row.email) byEmail.set(row.email, Boolean(byEmail.get(row.email)) || row.email_verified === 1);
    const emails = [...byEmail.keys()];
    const emailInfo = [...byEmail].map(([email, confirmed]) => ({ email, confirmed }));
    return json({ group, reports: results.map(({ email, email_verified, ...row }) => ({ ...row, hasEmail: Boolean(email), emailConfirmed: Boolean(email) && email_verified === 1 })), emails, emailInfo, emailsHidden: !admin.can('emails') });
  }

  /** Muda o status de um erro; "corrigido" exige a versão da correção. */
  async function adminErrorStatus({ request, env, need }, signature) {
    need('status');
    const body = await readJson(request);
    const status = STATUSES.has(body.status) ? body.status : null;
    if (!status) throw new HttpError(400, 'Status inválido.');
    const validVersion = RE.version.test(String(body.fixedIn || '')) ? body.fixedIn : null;
    const fixedIn = status === 'corrigido' ? validVersion : null;
    if (status === 'corrigido' && !fixedIn) throw new HttpError(400, 'Diga em qual versão foi corrigido (ex.: 0.8.2).');
    await env.DB.prepare('UPDATE error_groups SET status = ?, fixed_in = ?, note = ? WHERE signature = ?').bind(status, fixedIn, text(body.note, 500) || null, signature).run();
    return json({ ok: true });
  }

  /** Telemetria agregada dos últimos dias (padrão 30, até 120). */
  async function adminTelemetry({ env, url }) {
    const days = clampInt(url.searchParams.get('dias'), 1, 120, 30);
    const from = dayOf(now() - days * DAY);
    const { results = [] } = await env.DB.prepare('SELECT install_id, day, version, platform, data FROM telemetry WHERE day >= ? ORDER BY day').bind(from).all();
    return json(aggregateTelemetry(results));
  }

  /** Equipe do painel (só o dono). */
  async function adminTeamList({ env, need }) {
    need('equipe');
    const { results = [] } = await env.DB.prepare('SELECT email, role, added_by, added_at FROM team ORDER BY added_at').all();
    return json({ owners: adminEmails(env), members: results, roles: { colaborador: ROLES.colaborador, leitura: ROLES.leitura } });
  }

  /** Adiciona alguém à equipe ou muda o papel dessa pessoa (até 50 pessoas). */
  async function adminTeamAdd({ request, env, admin, need }) {
    need('equipe');
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    if (!EMAIL.test(email)) throw new HttpError(400, 'E-mail inválido.');
    if (!['colaborador', 'leitura'].includes(body.role)) throw new HttpError(400, 'Papel inválido.');
    if (adminEmails(env).includes(email)) throw new HttpError(400, 'Esse e-mail já é dono do painel.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM team').first();
    if ((count?.n || 0) >= 50) throw new HttpError(409, 'A equipe chegou a 50 pessoas.');
    await env.DB.prepare('INSERT INTO team (email, role, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role').bind(email, body.role, admin.email, now()).run();
    return json({ ok: true });
  }

  /** Tira alguém da equipe e encerra as sessões do painel dessa pessoa na hora. */
  async function adminTeamRemove({ request, env, need }) {
    need('equipe');
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM team WHERE email = ?').bind(email),
      env.DB.prepare('DELETE FROM admin_sessions WHERE email = ?').bind(email)
    ]);
    return json({ ok: true });
  }

  /** Chaves de acesso para ferramentas (só o dono). */
  async function adminKeyList({ env, need }) {
    need('chaves');
    const { results = [] } = await env.DB.prepare('SELECT id, label, scope, created_by, created_at, last_used, revoked FROM tool_keys ORDER BY created_at DESC').all();
    return json({ keys: results });
  }

  /** Cria uma chave só de leitura dos erros (até 10 ativas); o segredo aparece só nesta resposta. */
  async function adminKeyCreate({ request, env, admin, need }) {
    need('chaves');
    const body = await readJson(request);
    const label = text(body.label, 60).trim() || 'Chave sem nome';
    const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM tool_keys WHERE revoked = 0').first();
    if ((active?.n || 0) >= 10) throw new HttpError(409, 'Já existem 10 chaves ativas. Revogue uma antes.');
    const secret = `nexo_${randomId(30)}`;
    const id = randomId(9);
    await env.DB.prepare('INSERT INTO tool_keys (id, label, key_hash, scope, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, label, await sha256Hex(secret), 'erros:ler', admin.email, now()).run();
    // A chave aparece só agora; depois, nem o painel consegue mostrar de novo.
    return json({ id, label, key: secret, scope: 'erros:ler' });
  }

  /** Revoga uma chave de acesso. */
  async function adminKeyRevoke({ request, env, need }) {
    need('chaves');
    const body = await readJson(request);
    await env.DB.prepare('UPDATE tool_keys SET revoked = 1 WHERE id = ?').bind(String(body.id || '').slice(0, 40)).run();
    return json({ ok: true });
  }

  /** Sai do painel: apaga a sessão e o cookie. */
  async function adminLogout({ env, admin }) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE sid = ?').bind(admin.sid).run();
    return json({ ok: true }, 200, { 'set-cookie': 'nexo_painel=; Path=/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }

  /** Rotas fixas da API do painel: "MÉTODO caminho" → função. */
  const ADMIN_ROUTES = new Map([
    ['GET resumo', adminSummary],
    ['GET erros', adminErrorList],
    ['GET telemetria', adminTelemetry],
    ['GET equipe', adminTeamList],
    ['POST equipe', adminTeamAdd],
    ['POST equipe/remover', adminTeamRemove],
    ['GET chaves', adminKeyList],
    ['POST chaves', adminKeyCreate],
    ['POST chaves/revogar', adminKeyRevoke],
    ['POST sair', adminLogout]
  ]);
  /** Rotas de um erro só (erros/<assinatura>). */
  const ADMIN_ERROR_ROUTES = new Map([['GET', adminErrorDetail], ['POST', adminErrorStatus]]);

  /** API do painel do criador, com permissão por papel (dono, colaborador, leitura) e proteção contra CSRF. */
  async function adminApi(request, env, url, rest) {
    const admin = await adminSession(request, env);
    if (!admin) throw new HttpError(401, 'Abra o painel pelo Nexo.');
    const need = (action) => { if (!admin.can(action)) throw new HttpError(403, 'O seu papel no painel não permite isso.'); };
    // Contra CSRF (pedidos que mudam algo): mesmo site e um cabeçalho que formulário de outro site não consegue mandar.
    const origin = request.headers.get('origin');
    const crossSite = request.headers.get('x-nexo-painel') !== '1' || (origin && origin !== url.origin);
    if (request.method !== 'GET' && crossSite) throw new HttpError(403, 'Pedido recusado.');
    const context = { request, env, url, admin, need };
    const handler = ADMIN_ROUTES.get(`${request.method} ${rest}`);
    if (handler) return handler(context);
    const detail = /^erros\/([0-9a-f]{16})$/.exec(rest || '');
    const errorHandler = detail && ADMIN_ERROR_ROUTES.get(request.method);
    if (errorHandler) return errorHandler(context, detail[1]);
    throw new HttpError(404, 'Não encontrado.');
  }

  /* ---------- Ferramentas (chave de acesso, só leitura dos erros, sem e-mails) ---------- */
  async function toolErrors(request, env, url) {
    const header = request.headers.get('authorization') || '';
    const secret = header.startsWith('Bearer nexo_') ? header.slice(7).trim() : '';
    if (!/^nexo_[A-Za-z0-9_-]{30,60}$/.test(secret)) throw new HttpError(401, 'Chave de acesso inválida.');
    const row = await env.DB.prepare('SELECT id, scope, revoked FROM tool_keys WHERE key_hash = ?').bind(await sha256Hex(secret)).first();
    if (!row || row.revoked || row.scope !== 'erros:ler') throw new HttpError(401, 'Chave de acesso inválida ou revogada.');
    await limit(env, `tool:${row.id}`, 200);
    await env.DB.prepare('UPDATE tool_keys SET last_used = ? WHERE id = ?').bind(now(), row.id).run();
    const status = STATUSES.has(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
    const { results = [] } = await env.DB.prepare(`SELECT g.signature, g.source, g.level, g.message, g.stack, g.context, g.first_at, g.last_at, g.status, g.fixed_in, g.note,
        COUNT(r.install_id) AS installs, COALESCE(SUM(r.count), 0) AS occurrences, GROUP_CONCAT(DISTINCT r.version) AS versions, GROUP_CONCAT(DISTINCT r.platform) AS platforms
      FROM error_groups g LEFT JOIN error_reports r ON r.signature = g.signature
      WHERE (? IS NULL AND g.status IN ('aberto', 'reaberto')) OR g.status = ?
      GROUP BY g.signature ORDER BY g.last_at DESC LIMIT 200`).bind(status, status).all();
    return json({ groups: results, generatedAt: now() });
  }

  /** Página do painel: só abre com a sessão do painel; sem ela, mostra como entrar. */
  async function panelPage(request, env) {
    if (await adminSession(request, env)) return page(PANEL_HTML, 'text/html; charset=utf-8');
    return page(PANEL_LOCKED('Abra o painel pelo Nexo: Ajustes > Painel do criador.'), 'text/html; charset=utf-8', 401);
  }

  /** Rotas fixas: "MÉTODO caminho" → função (request, env, url). */
  const ROUTES = new Map([
    ['POST /v1/auth/google', login],
    ['POST /v1/auth/logout', logout],
    ['GET /v1/me', me],
    ['DELETE /v1/me', deleteMe],
    ['GET /v1/sync', listDevices],
    ['POST /v1/errors', postErrors],
    ['POST /v1/errors/forget-email', forgetErrorEmail],
    ['POST /v1/telemetry', postTelemetry],
    ['POST /v1/admin/link', adminLink],
    ['GET /v1/tools/errors', toolErrors],
    ['GET /painel/entrar', (_request, env, url) => adminEnter(env, url)],
    ['GET /painel', panelPage],
    ['GET /painel/app.js', () => page(PANEL_JS, 'text/javascript; charset=utf-8')],
    ['GET /painel/app.css', () => page(PANEL_CSS, 'text/css; charset=utf-8')],
    // Papel de parede do painel (público como o CSS: é só arte, sem dado nenhum).
    ['GET /painel/fundo.svg', () => page(PANEL_WALLPAPER, 'image/svg+xml; charset=utf-8', 200, { 'cache-control': 'public, max-age=86400' })]
  ]);
  /** Cópia de um PC (/v1/sync/<id>): função (request, env, deviceId, url). */
  const DEVICE_ROUTES = new Map([['PUT', putDevice], ['GET', getDevice], ['DELETE', deleteDevice]]);

  /** Encaminha cada pedido para a rota certa; o que não existe vira 404. */
  async function route(request, env) {
    const url = new URL(request.url);
    let end = url.pathname.length;
    while (end > 1 && url.pathname[end - 1] === '/') end -= 1; // tira as barras do fim sem regex
    const path = url.pathname.slice(0, end) || '/';
    const { method } = request;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    if (path === '/' || path === '/health') return json({ ok: true, service: 'nexo-api', version: SERVER_VERSION });
    const handler = ROUTES.get(`${method} ${path}`);
    if (handler) return handler(request, env, url);
    const device = /^\/v1\/sync\/([^/]+)$/.exec(path);
    const deviceHandler = device && DEVICE_ROUTES.get(method);
    if (deviceHandler) return deviceHandler(request, env, decodeURIComponent(device[1]), url);
    if (path.startsWith('/painel/api/')) return adminApi(request, env, url, path.slice('/painel/api/'.length));
    if (path.startsWith('/v1/steam/')) {
      const answer = await steam.route(request, env, url, path, method);
      if (answer) return answer;
    }
    throw new HttpError(404, 'Não encontrado.');
  }

  return {
    async fetch(request, env) {
      try {
        return await route(request, env);
      } catch (error) {
        const status = Number(error?.status) || 500;
        if (status >= 500) console.error('nexo-api', error?.name || 'Error');
        return json({ error: status >= 500 ? 'Erro interno do servidor.' : error.message, ...(status < 500 && error?.code ? { code: String(error.code).slice(0, 40) } : {}) }, status);
      }
    },
    /** Limpeza diária (cron). */
    async scheduled(_event, env) {
      const at = now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM error_reports WHERE last_at < ?').bind(at - 180 * DAY),
        env.DB.prepare("DELETE FROM error_groups WHERE last_at < ? AND status != 'aberto' AND signature NOT IN (SELECT signature FROM error_reports)").bind(at - 180 * DAY),
        env.DB.prepare('DELETE FROM telemetry WHERE day < ?').bind(dayOf(at - 120 * DAY)),
        env.DB.prepare('DELETE FROM installs WHERE last_seen < ?').bind(at - 400 * DAY),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked = 1').bind(at),
        env.DB.prepare('DELETE FROM admin_links WHERE expires_at < ?').bind(at),
        env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(at),
        env.DB.prepare('DELETE FROM rate WHERE day < ?').bind(dayOf(at - DAY)),
        // Cópia de PC sem atualizar há um ano some; conta sem sessão nem cópia (só nome e e-mail) some junto.
        env.DB.prepare('DELETE FROM snapshots WHERE updated_at < ?').bind(at - 365 * DAY),
        env.DB.prepare('DELETE FROM users WHERE last_seen < ? AND uid NOT IN (SELECT uid FROM sessions) AND uid NOT IN (SELECT uid FROM snapshots)').bind(at - 30 * DAY)
      ]);
    }
  };
}

/* ---------- Telemetria agregada para o painel ---------- */

/** Número de verdade (finito) ou null. */
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
/** Fração (0–1) em porcentagem, ou null. */
const pct = (value) => (num(value) === null ? null : value * 100);
/** Faixa de um valor (em vez de ternários encadeados): a primeira cujo limite é maior que ele. */
const band = (value, limits) => limits.find(([max]) => value < max)?.[1] ?? limits.at(-1)[1];
const RAM_BANDS = [[8.5, 'até 8 GB'], [16.5, '9–16 GB'], [32.5, '17–32 GB'], [Infinity, 'mais de 32 GB']];
const AGE_BANDS = [[1, 'menos de 1 dia'], [7, '1 a 6 dias'], [30, '1 a 4 semanas'], [90, '1 a 3 meses'], [Infinity, 'mais de 3 meses']];
const SYSTEM_FLAGS = ['autostart', 'tray', 'autoSession', 'onlineCovers'];
const SKY_FLAGS = ['fireflies', 'twinkle', 'meteors', 'showers', 'cursor', 'skyHour', 'wallpaper', 'autoClean', 'reducedMotion'];
/** Ajustes contados como estão: campo do resumo → lista no painel. */
const SETTING_LISTS = [['effects', 'effects'], ['accent', 'accents'], ['skyDensity', 'skyDensity'], ['profile', 'profiles'], ['liveRate', 'liveRates']];
/** Números do dia (mediana e p90 entre os resumos): rótulo → valor de um resumo. */
const DAY_METRICS = [
  ['Minutos com o Nexo em foco', (data) => data.app?.focusMin],
  ['Minutos com o Nexo aberto', (data) => data.app?.openMin],
  ['Aberturas no dia', (data) => data.app?.launches],
  ['Tempo de abertura (ms)', (data) => data.app?.startMs],
  ['CPU do Nexo em foco (%)', (data) => data.perf?.cpuFocus],
  ['CPU do Nexo em segundo plano (%)', (data) => data.perf?.cpuBack],
  ['Memória do Nexo em foco (MB)', (data) => data.perf?.memFocusMB],
  ['Pico de memória do Nexo (MB)', (data) => data.perf?.memMaxMB],
  ['Quadros do céu por segundo', (data) => data.perf?.skyFps],
  ['Travadas da interface no dia', (data) => data.perf?.longTasks],
  ['Vídeo com o Nexo na frente, Completo (%)', (data) => data.perf?.gpuCompleto],
  ['Vídeo com o Nexo na frente, Leve (%)', (data) => data.perf?.gpuLeve],
  ['Vídeo com o Nexo em segundo plano (%)', (data) => data.perf?.gpuFundo],
  ['Processador do PC, média do dia (%)', (data) => data.health?.cpu],
  ['Memória do PC, média do dia (%)', (data) => data.health?.mem],
  ['Vídeo do PC, média do dia (%)', (data) => data.health?.gpu],
  ['Maior temperatura do dia (°C)', (data) => data.health?.tempMax],
  // O que limita os PCs: números da GPU e da CPU com carga e das sessões de jogo.
  ['GPU com carga: uso típico (%)', (data) => data.bottleneck?.gpu?.busyP50],
  ['GPU com carga: clock em % do máximo dela', (data) => pct(data.bottleneck?.gpu?.clockRatioP50)],
  ['GPU com carga: energia em % do limite', (data) => data.bottleneck?.gpu?.powerPctP50],
  ['GPU em 95%+ (% do tempo com carga)', (data) => pct(data.bottleneck?.gpu?.saturatedShare)],
  ['Memória de vídeo, pico do dia (%)', (data) => data.bottleneck?.gpu?.vramPctMax],
  ['Núcleo mais ocupado da CPU (p90, %)', (data) => data.bottleneck?.cpu?.maxCoreP90],
  ['Minutos com carga no dia', (data) => data.bottleneck?.minutes],
  ['FPS médio nas sessões', (data) => data.bottleneck?.fps?.avg],
  ['1% baixo nas sessões (FPS)', (data) => data.bottleneck?.fps?.p1Low]
];
/** Listas que o painel mostra, na ordem da resposta. */
const TOP_LISTS = ['limiter', 'sessionLimiter', 'updatedFrom', 'ageDays', 'ipcFails', 'events', 'featsEmpty', 'featsCrashed', 'sourceFails', 'versions', 'platforms', 'cpus', 'cpuModels', 'ram', 'cores', 'gpus', 'gpuModels', 'monitors', 'resolutions', 'refresh', 'scales', 'locales', 'channels', 'appFlags', 'sensors', 'effects', 'accents', 'skyDensity', 'skyFlags', 'profiles', 'liveRates', 'stores', 'views', 'viewTime', 'actions', 'ui', 'features'];

/** Contadores por lista (nome → chave → soma), mais o maior valor visto por chave. */
function createTally() {
  const maps = {};
  const mapOf = (name) => { maps[name] ??= new Map(); return maps[name]; };
  return {
    maps,
    count(name, key, n = 1) {
      if (key === null || key === undefined || key === '') return;
      const map = mapOf(name);
      map.set(String(key), (map.get(String(key)) || 0) + n);
    },
    max(name, key, value) {
      const map = mapOf(name);
      map.set(key, Math.max(map.get(key) || 0, value));
    }
  };
}

/** Lê cada resumo guardado (JSON); um resumo estragado vira vazio em vez de derrubar o painel. */
function parseTelemetryRows(rows) {
  return rows.map((row) => {
    let data = {};
    try { data = JSON.parse(row.data) || {}; } catch { data = {}; }
    return { ...row, data };
  });
}

/** Processador, memória, placa de vídeo e monitores de um PC. */
function tallyHardware(count, hw) {
  if (hw.cpuVendor) count('cpus', hw.cpuVendor);
  if (hw.cpuModel) count('cpuModels', hw.cpuModel);
  if (num(hw.ramGB) !== null) count('ram', band(hw.ramGB, RAM_BANDS));
  if (num(hw.cores) !== null) count('cores', `${hw.cores} threads`);
  if (hw.gpuVendor) count('gpus', hw.gpuVendor);
  for (const model of Array.isArray(hw.gpuModels) ? hw.gpuModels : []) count('gpuModels', model);
  const displays = Array.isArray(hw.displays) ? hw.displays : [];
  const plural = displays.length > 1 ? 'es' : '';
  if (displays.length) count('monitors', `${displays.length} monitor${plural}`);
  for (const display of displays) {
    if (num(display.w) && num(display.h)) count('resolutions', `${display.w}×${display.h}`);
    if (num(display.hz)) count('refresh', `${display.hz} Hz`);
    if (num(display.scale)) count('scales', `${Math.round(display.scale * 100)}%`);
  }
}

/** Sistema, sensores, ajustes do céu e da aparência, lojas e de qual versão o PC veio. */
function tallySetup(count, row) {
  const { data } = row;
  if (data.system?.locale) count('locales', data.system.locale);
  if (data.system?.channel) count('channels', data.system.channel);
  for (const flag of SYSTEM_FLAGS) if (data.system?.[flag] === true) count('appFlags', flag);
  const withTemp = data.sensors?.cpuTemp ? ' · com temperatura do processador' : '';
  if (data.sensors?.status) count('sensors', `${data.sensors.status}${withTemp}`);
  const set = data.settings || {};
  for (const [field, list] of SETTING_LISTS) if (set[field]) count(list, set[field]);
  for (const flag of SKY_FLAGS) if (set[flag] === true) count('skyFlags', flag);
  for (const [store, n] of Object.entries(data.library?.stores || {})) if (num(n)) count('stores', store, n);
  if (data.app?.previous) count('updatedFrom', `${data.app.previous} → ${row.version}`);
  if (num(data.app?.ageDays) !== null) count('ageDays', band(data.app.ageDays, AGE_BANDS));
}

/** Uso das telas e dos recursos, canais do app (falhas, chamadas, tempo e pico) e eventos de um resumo. */
function tallyUsage({ count, max }, data) {
  for (const [name, source] of [['views', data.usage?.views], ['viewTime', data.usage?.viewTime], ['actions', data.usage?.actions], ['ui', data.usage?.ui], ['features', data.features]]) {
    for (const [key, value] of Object.entries(source || {})) if (num(value) !== null) count(name, key, value);
  }
  // Diagnóstico: canais que falham e os mais lentos (média de ms ponderada pelas chamadas), quedas e travadas.
  for (const [channel, row] of Object.entries(data.diag?.ipc || {})) {
    if (num(row?.e)) count('ipcFails', channel, row.e);
    if (num(row?.n)) count('ipcCalls', channel, row.n);
    if (num(row?.n) && num(row?.ms)) count('ipcMsSum', channel, row.ms * row.n);
    if (num(row?.max)) max('ipcMax', channel, row.max);
  }
  for (const [event, n] of Object.entries(data.diag?.events || {})) if (num(n)) count('events', event, n);
}

/** Telas vazias ou que quebraram, fontes de dados (ok, falha e tempo) e o que limitou o PC. */
function tallyHealth(count, data) {
  for (const id of Array.isArray(data.feats?.empty) ? data.feats.empty : []) count('featsEmpty', id);
  for (const id of Array.isArray(data.feats?.crashed) ? data.feats.crashed : []) count('featsCrashed', id);
  for (const [name, row] of Object.entries(data.feats?.sources || {})) {
    if (num(row?.fail)) count('sourceFails', name, row.fail);
    if (num(row?.ok)) count('sourceOk', name, row.ok);
    if (num(row?.ms) && num(row?.ok) && num(row?.fail)) count('sourceMsSum', name, row.ms * (row.ok + row.fail));
  }
  // Minutos com carga por classe e o veredito das sessões de jogo.
  for (const [kind, n] of Object.entries(data.bottleneck?.limiter || {})) if (num(n)) count('limiter', kind, n);
  for (const [kind, n] of Object.entries(data.bottleneck?.sessionLimiter || {})) if (num(n)) count('sessionLimiter', kind, n);
}

/** Valor da posição p (0–1) numa lista ordenada. */
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
const round1 = (value) => Math.round(value * 10) / 10;

/** Mediana e p90 de cada número do dia. */
function dayNumbers(metrics) {
  return [...metrics].map(([label, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { key: label, median: round1(percentile(sorted, 0.5)), p90: round1(percentile(sorted, 0.9)), n: sorted.length };
  });
}

/** Tempo médio por chave (soma de ms ÷ chamadas), os mais lentos primeiro. */
function slowest(maps, sumName, callNames) {
  return [...(maps[sumName] || new Map())].map(([key, total]) => {
    const calls = callNames.reduce((sum, name) => sum + (maps[name]?.get(key) || 0), 0);
    return { key, n: calls ? Math.round(total / calls) : 0 };
  }).sort((a, b) => b.n - a.n);
}

/**
 * Agregados para o painel: instalações ativas por dia, versões, sistemas, hardware, monitores, ajustes, uso das telas
 * e dos recursos, e os números do dia (mediana e p90 entre os resumos diários). Tudo vem de dados anônimos.
 */
export function aggregateTelemetry(rows) {
  const perDay = new Map();
  const latest = new Map();
  const parsed = parseTelemetryRows(rows);
  for (const row of parsed) {
    if (!perDay.has(row.day)) perDay.set(row.day, new Set());
    perDay.get(row.day).add(row.install_id);
    const previous = latest.get(row.install_id);
    if (!previous || previous.day <= row.day) latest.set(row.install_id, row);
  }
  const tally = createTally();
  const { count, maps } = tally;
  // Um voto por PC: o resumo mais recente de cada instalação.
  for (const row of latest.values()) {
    count('versions', row.version);
    count('platforms', row.platform);
    tallyHardware(count, row.data.hw || {});
    tallySetup(count, row);
  }
  // Somas de uso e números do dia: todos os resumos do período.
  const metrics = new Map();
  for (const { data } of parsed) {
    tallyUsage(tally, data);
    tallyHealth(count, data);
    for (const [label, read] of DAY_METRICS) {
      const value = num(read(data));
      if (value === null) continue;
      if (!metrics.has(label)) metrics.set(label, []);
      metrics.get(label).push(value);
    }
  }
  const top = (name) => [...(maps[name] || new Map())].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n: round1(n) }));
  const ipcMax = [...(maps.ipcMax || new Map())].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n }));
  return {
    activeByDay: [...perDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, set]) => ({ day, n: set.size })),
    installs: latest.size,
    reports: parsed.length,
    numbers: dayNumbers(metrics),
    ipcSlow: slowest(maps, 'ipcMsSum', ['ipcCalls']),
    ipcMax,
    sourceSlow: slowest(maps, 'sourceMsSum', ['sourceOk', 'sourceFails']),
    ...Object.fromEntries(TOP_LISTS.map((name) => [name, top(name)]))
  };
}
