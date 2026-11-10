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
  const ipKey = async (request, env) => `ip:${(await sha256Hex(`${env.SESSION_SECRET}|${request.headers.get('cf-connecting-ip') || 'local'}`)).slice(0, 20)}`;

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
    const uid = `u_${(await sha256Hex(`google:${google.sub}`)).slice(0, 32)}`;
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
    const devices = [];
    for (const row of results) {
      let name = 'PC';
      try { name = await open(row.name_enc, { dataKey: env.DATA_KEY, uid: who.uid }); } catch { /* nome ilegível: segue */ }
      devices.push({ deviceId: row.device_id, name, sections: JSON.parse(row.sections || '[]'), size: row.size, appVersion: row.app_version, updatedAt: row.updated_at, current: row.device_id === who.deviceId });
    }
    return json({ devices });
  }

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
  async function postErrors(request, env) {
    const body = await readJson(request);
    const installId = String(body.installId || '');
    if (!RE.installId.test(installId)) throw new HttpError(400, 'Instalação inválida.');
    await limit(env, `err:${installId}`, 30);
    await limit(env, `errip:${(await ipKey(request, env)).slice(3)}`, 300);
    const version = RE.version.test(String(body.version || '')) ? body.version : '0.0.0';
    const platform = PLATFORMS.has(body.platform) ? body.platform : 'win32';
    // E-mail: o da sessão (confirmado pelo Google no login) vale mais. Sem sessão, aceita o que o app informou da conta
    // Google entrada nele — guardado como "não confirmado" (email_verified = 0), só de quem marcou "incluir meu e-mail".
    let email = null;
    let verified = 1;
    if (body.includeEmail === true) email = (await session(request, env, { required: false }).catch(() => null))?.email || null;
    if (!email && body.includeEmail === true && typeof body.contactEmail === 'string') {
      const contact = body.contactEmail.trim().toLowerCase().slice(0, 254);
      if (EMAIL.test(contact)) { email = contact; verified = 0; }
    }
    const reports = Array.isArray(body.reports) ? body.reports.slice(0, LIMITS.reportsPerPost) : [];
    const at = now();
    const statements = [];
    let accepted = 0;
    for (const report of reports) {
      if (!report || !RE.signature.test(String(report.signature || ''))) continue;
      const source = SOURCES.has(report.source) ? report.source : 'principal';
      const level = LEVELS.has(report.level) ? report.level : 'erro';
      const message = redact(text(report.message, LIMITS.message)) || 'Erro sem mensagem';
      const stack = redact(text(report.stack, LIMITS.stack));
      const context = redact(text(report.context, LIMITS.context));
      const count = clampInt(report.count, 1, 100000, 1);
      const lastAt = Math.min(at, clampInt(report.lastAt, at - 400 * DAY, at, at));
      const firstAt = Math.min(lastAt, clampInt(report.firstAt, at - 400 * DAY, at, lastAt));
      statements.push(env.DB.prepare(`INSERT INTO error_groups (signature, source, level, message, stack, context, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(signature) DO UPDATE SET message = excluded.message, context = excluded.context, stack = CASE WHEN excluded.stack != '' THEN excluded.stack ELSE error_groups.stack END,
        first_at = MIN(error_groups.first_at, excluded.first_at), last_at = MAX(error_groups.last_at, excluded.last_at),
        level = CASE WHEN excluded.level = 'erro' THEN 'erro' ELSE error_groups.level END`).bind(report.signature, source, level, message, stack, context, firstAt, lastAt));
      statements.push(env.DB.prepare(`INSERT INTO error_reports (signature, install_id, email, email_verified, version, platform, count, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(signature, install_id) DO UPDATE SET
          email = CASE WHEN excluded.email IS NULL THEN error_reports.email WHEN error_reports.email IS NOT NULL AND error_reports.email_verified = 1 AND excluded.email_verified = 0 THEN error_reports.email ELSE excluded.email END,
          email_verified = CASE WHEN excluded.email IS NULL THEN error_reports.email_verified WHEN error_reports.email IS NOT NULL AND error_reports.email_verified = 1 AND excluded.email_verified = 0 THEN 1 ELSE excluded.email_verified END,
          version = excluded.version, platform = excluded.platform,
          count = error_reports.count + excluded.count, first_at = MIN(error_reports.first_at, excluded.first_at), last_at = MAX(error_reports.last_at, excluded.last_at)`).bind(report.signature, installId, email, verified, version, platform, count, firstAt, lastAt));
      accepted += 1;
    }
    if (accepted) {
      // Corrigido, mas voltou numa versão igual ou mais nova que a da correção: reabre (comparar versões no SQL é ruim).
      const signatures = [...new Set(reports.filter((report) => report && RE.signature.test(String(report.signature || ''))).map((report) => report.signature))];
      const fixed = (await env.DB.prepare(`SELECT signature, fixed_in FROM error_groups WHERE status = 'corrigido' AND signature IN (${signatures.map(() => '?').join(',')})`).bind(...signatures).all()).results || [];
      const reopen = fixed.filter((row) => row.fixed_in && compareVersions(version, row.fixed_in) >= 0).map((row) => row.signature);
      if (reopen.length) statements.push(env.DB.prepare(`UPDATE error_groups SET status = 'reaberto' WHERE signature IN (${reopen.map(() => '?').join(',')})`).bind(...reopen));
      statements.push(seenInstall(env, installId, version, platform, 'erros'));
      await env.DB.batch(statements);
    }
    return json({ ok: true, accepted });
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

  async function adminApi(request, env, url, rest) {
    const admin = await adminSession(request, env);
    if (!admin) throw new HttpError(401, 'Abra o painel pelo Nexo.');
    const need = (action) => { if (!admin.can(action)) throw new HttpError(403, 'O seu papel no painel não permite isso.'); };
    if (request.method !== 'GET') {
      // Contra CSRF: mesmo site e um cabeçalho que formulário de outro site não consegue mandar.
      if (request.headers.get('x-nexo-painel') !== '1' || (request.headers.get('origin') && request.headers.get('origin') !== url.origin)) throw new HttpError(403, 'Pedido recusado.');
    }
    if (rest === 'resumo' && request.method === 'GET') {
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
    if (rest === 'erros' && request.method === 'GET') {
      const status = STATUSES.has(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
      const levelAll = url.searchParams.get('avisos') === '1';
      const { results = [] } = await env.DB.prepare(`SELECT g.signature, g.source, g.level, g.message, g.context, g.first_at, g.last_at, g.status, g.fixed_in, g.note,
          COUNT(r.install_id) AS installs, COALESCE(SUM(r.count), 0) AS occurrences, COUNT(r.email) AS emails, GROUP_CONCAT(DISTINCT r.version) AS versions, GROUP_CONCAT(DISTINCT r.platform) AS platforms
        FROM error_groups g LEFT JOIN error_reports r ON r.signature = g.signature
        WHERE (? IS NULL OR g.status = ?) AND (? = 1 OR g.level = 'erro')
        GROUP BY g.signature ORDER BY CASE g.status WHEN 'reaberto' THEN 0 WHEN 'aberto' THEN 1 ELSE 2 END, g.last_at DESC LIMIT 300`).bind(status, status, levelAll ? 1 : 0).all();
      return json({ groups: results });
    }
    const detail = /^erros\/([0-9a-f]{16})$/.exec(rest || '');
    if (detail && request.method === 'GET') {
      const group = await env.DB.prepare('SELECT * FROM error_groups WHERE signature = ?').bind(detail[1]).first();
      if (!group) throw new HttpError(404, 'Erro não encontrado.');
      const { results = [] } = await env.DB.prepare('SELECT email, email_verified, version, platform, count, first_at, last_at FROM error_reports WHERE signature = ? ORDER BY last_at DESC LIMIT 500').bind(detail[1]).all();
      const byEmail = new Map();
      if (admin.can('emails')) for (const row of results) if (row.email) byEmail.set(row.email, Boolean(byEmail.get(row.email)) || row.email_verified === 1);
      const emails = [...byEmail.keys()];
      const emailInfo = [...byEmail].map(([email, confirmed]) => ({ email, confirmed }));
      return json({ group, reports: results.map(({ email, email_verified, ...row }) => ({ ...row, hasEmail: Boolean(email), emailConfirmed: Boolean(email) && email_verified === 1 })), emails, emailInfo, emailsHidden: !admin.can('emails') });
    }
    if (detail && request.method === 'POST') {
      need('status');
      const body = await readJson(request);
      const status = STATUSES.has(body.status) ? body.status : null;
      if (!status) throw new HttpError(400, 'Status inválido.');
      const validVersion = RE.version.test(String(body.fixedIn || '')) ? body.fixedIn : null;
      const fixedIn = status === 'corrigido' ? validVersion : null;
      if (status === 'corrigido' && !fixedIn) throw new HttpError(400, 'Diga em qual versão foi corrigido (ex.: 0.8.2).');
      await env.DB.prepare('UPDATE error_groups SET status = ?, fixed_in = ?, note = ? WHERE signature = ?').bind(status, fixedIn, text(body.note, 500) || null, detail[1]).run();
      return json({ ok: true });
    }
    if (rest === 'telemetria' && request.method === 'GET') {
      const days = clampInt(url.searchParams.get('dias'), 1, 120, 30);
      const from = dayOf(now() - days * DAY);
      const { results = [] } = await env.DB.prepare('SELECT install_id, day, version, platform, data FROM telemetry WHERE day >= ? ORDER BY day').bind(from).all();
      return json(aggregateTelemetry(results));
    }
    /* ----- Equipe (só o dono) ----- */
    if (rest === 'equipe' && request.method === 'GET') {
      need('equipe');
      const { results = [] } = await env.DB.prepare('SELECT email, role, added_by, added_at FROM team ORDER BY added_at').all();
      return json({ owners: adminEmails(env), members: results, roles: { colaborador: ROLES.colaborador, leitura: ROLES.leitura } });
    }
    if (rest === 'equipe' && request.method === 'POST') {
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
    if (rest === 'equipe/remover' && request.method === 'POST') {
      need('equipe');
      const body = await readJson(request);
      const email = String(body.email || '').trim().toLowerCase();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM team WHERE email = ?').bind(email),
        env.DB.prepare('DELETE FROM admin_sessions WHERE email = ?').bind(email)
      ]);
      return json({ ok: true });
    }
    /* ----- Chaves de acesso para ferramentas (só o dono) ----- */
    if (rest === 'chaves' && request.method === 'GET') {
      need('chaves');
      const { results = [] } = await env.DB.prepare('SELECT id, label, scope, created_by, created_at, last_used, revoked FROM tool_keys ORDER BY created_at DESC').all();
      return json({ keys: results });
    }
    if (rest === 'chaves' && request.method === 'POST') {
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
    if (rest === 'chaves/revogar' && request.method === 'POST') {
      need('chaves');
      const body = await readJson(request);
      await env.DB.prepare('UPDATE tool_keys SET revoked = 1 WHERE id = ?').bind(String(body.id || '').slice(0, 40)).run();
      return json({ ok: true });
    }
    if (rest === 'sair' && request.method === 'POST') {
      await env.DB.prepare('DELETE FROM admin_sessions WHERE sid = ?').bind(admin.sid).run();
      return json({ ok: true }, 200, { 'set-cookie': 'nexo_painel=; Path=/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
    }
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

  async function route(request, env, ctx) {
    const url = new URL(request.url);
    let end = url.pathname.length;
    while (end > 1 && url.pathname[end - 1] === '/') end -= 1; // tira as barras do fim sem regex
    const path = url.pathname.slice(0, end) || '/';
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    if (path === '/' || path === '/health') return json({ ok: true, service: 'nexo-api', version: SERVER_VERSION });
    if (path === '/v1/auth/google' && method === 'POST') return login(request, env);
    if (path === '/v1/auth/logout' && method === 'POST') return logout(request, env);
    if (path === '/v1/me' && method === 'GET') return me(request, env);
    if (path === '/v1/me' && method === 'DELETE') return deleteMe(request, env);
    if (path === '/v1/sync' && method === 'GET') return listDevices(request, env);
    const device = /^\/v1\/sync\/([^/]+)$/.exec(path);
    if (device && method === 'PUT') return putDevice(request, env, decodeURIComponent(device[1]));
    if (device && method === 'GET') return getDevice(request, env, decodeURIComponent(device[1]), url);
    if (device && method === 'DELETE') return deleteDevice(request, env, decodeURIComponent(device[1]));
    if (path === '/v1/errors' && method === 'POST') return postErrors(request, env);
    if (path === '/v1/telemetry' && method === 'POST') return postTelemetry(request, env);
    if (path === '/v1/admin/link' && method === 'POST') return adminLink(request, env, url);
    if (path === '/v1/tools/errors' && method === 'GET') return toolErrors(request, env, url);
    if (path === '/painel/entrar' && method === 'GET') return adminEnter(env, url);
    if (path === '/painel' && method === 'GET') return (await adminSession(request, env)) ? page(PANEL_HTML, 'text/html; charset=utf-8') : page(PANEL_LOCKED('Abra o painel pelo Nexo: Ajustes > Painel do criador.'), 'text/html; charset=utf-8', 401);
    if (path === '/painel/app.js' && method === 'GET') return page(PANEL_JS, 'text/javascript; charset=utf-8');
    if (path === '/painel/app.css' && method === 'GET') return page(PANEL_CSS, 'text/css; charset=utf-8');
    // Papel de parede do painel (público como o CSS: é só arte, sem dado nenhum).
    if (path === '/painel/fundo.svg' && method === 'GET') return page(PANEL_WALLPAPER, 'image/svg+xml; charset=utf-8', 200, { 'cache-control': 'public, max-age=86400' });
    if (path.startsWith('/painel/api/')) return adminApi(request, env, url, path.slice('/painel/api/'.length));
    if (path.startsWith('/v1/steam/')) { const answer = await steam.route(request, env, url, path, method); if (answer) return answer; }
    throw new HttpError(404, 'Não encontrado.');
  }

  return {
    async fetch(request, env, ctx) {
      try {
        return await route(request, env, ctx);
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

/**
 * Agregados para o painel: instalações ativas por dia, versões, sistemas, hardware, monitores, ajustes, uso das telas
 * e dos recursos, e os números do dia (mediana e p90 entre os resumos diários). Tudo vem de dados anônimos.
 */
export function aggregateTelemetry(rows) {
  const perDay = new Map();
  const latest = new Map();
  const parsed = rows.map((row) => { let data = {}; try { data = JSON.parse(row.data) || {}; } catch { data = {}; } return { ...row, data }; });
  for (const row of parsed) {
    if (!perDay.has(row.day)) perDay.set(row.day, new Set());
    perDay.get(row.day).add(row.install_id);
    const previous = latest.get(row.install_id);
    if (!previous || previous.day <= row.day) latest.set(row.install_id, row);
  }
  const maps = {};
  const count = (name, key, n = 1) => {
    if (key === null || key === undefined || key === '') return;
    maps[name] ??= new Map();
    const map = maps[name];
    map.set(String(key), (map.get(String(key)) || 0) + n);
  };
  // Faixas para os gráficos (em vez de ternários encadeados).
  const band = (value, limits) => limits.find(([max]) => value < max)?.[1] ?? limits.at(-1)[1];
  const RAM_BANDS = [[8.5, 'até 8 GB'], [16.5, '9–16 GB'], [32.5, '17–32 GB'], [Infinity, 'mais de 32 GB']];
  const AGE_BANDS = [[1, 'menos de 1 dia'], [7, '1 a 6 dias'], [30, '1 a 4 semanas'], [90, '1 a 3 meses'], [Infinity, 'mais de 3 meses']];
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  // Um voto por PC: o resumo mais recente de cada instalação.
  for (const row of latest.values()) {
    const { data } = row;
    count('versions', row.version);
    count('platforms', row.platform);
    const hw = data.hw || {};
    if (hw.cpuVendor) count('cpus', hw.cpuVendor);
    if (hw.cpuModel) count('cpuModels', hw.cpuModel);
    if (num(hw.ramGB) !== null) count('ram', band(hw.ramGB, RAM_BANDS));
    if (num(hw.cores) !== null) count('cores', `${hw.cores} threads`);
    if (hw.gpuVendor) count('gpus', hw.gpuVendor);
    for (const model of Array.isArray(hw.gpuModels) ? hw.gpuModels : []) count('gpuModels', model);
    const displays = Array.isArray(hw.displays) ? hw.displays : [];
    if (displays.length) count('monitors', `${displays.length} monitor${displays.length > 1 ? 'es' : ''}`);
    for (const display of displays) {
      if (num(display.w) && num(display.h)) count('resolutions', `${display.w}×${display.h}`);
      if (num(display.hz)) count('refresh', `${display.hz} Hz`);
      if (num(display.scale)) count('scales', `${Math.round(display.scale * 100)}%`);
    }
    if (data.system?.locale) count('locales', data.system.locale);
    if (data.system?.channel) count('channels', data.system.channel);
    for (const flag of ['autostart', 'tray', 'autoSession', 'onlineCovers']) if (data.system?.[flag] === true) count('appFlags', flag);
    if (data.sensors?.status) count('sensors', `${data.sensors.status}${data.sensors.cpuTemp ? ' · com temperatura do processador' : ''}`);
    const set = data.settings || {};
    if (set.effects) count('effects', set.effects);
    if (set.accent) count('accents', set.accent);
    if (set.skyDensity) count('skyDensity', set.skyDensity);
    if (set.profile) count('profiles', set.profile);
    if (set.liveRate) count('liveRates', set.liveRate);
    for (const flag of ['fireflies', 'twinkle', 'meteors', 'showers', 'cursor', 'skyHour', 'wallpaper', 'autoClean', 'reducedMotion']) if (set[flag] === true) count('skyFlags', flag);
    for (const [store, n] of Object.entries(data.library?.stores || {})) if (num(n)) count('stores', store, n);
    if (data.app?.previous) count('updatedFrom', `${data.app.previous} → ${row.version}`);
    if (num(data.app?.ageDays) !== null) count('ageDays', band(data.app.ageDays, AGE_BANDS));
  }
  // Somas de uso e números do dia: todos os resumos do período.
  const metrics = new Map();
  const metric = (label, value) => {
    const v = num(value);
    if (v === null) return;
    if (!metrics.has(label)) metrics.set(label, []);
    metrics.get(label).push(v);
  };
  for (const { data } of parsed) {
    for (const [name, source] of [['views', data.usage?.views], ['viewTime', data.usage?.viewTime], ['actions', data.usage?.actions], ['ui', data.usage?.ui], ['features', data.features]]) {
      for (const [key, value] of Object.entries(source || {})) if (num(value) !== null) count(name, key, value);
    }
    // Diagnóstico: canais que falham e os mais lentos (média de ms ponderada pelas chamadas), quedas e travadas.
    for (const [channel, row] of Object.entries(data.diag?.ipc || {})) {
      if (num(row?.e)) count('ipcFails', channel, row.e);
      if (num(row?.n)) count('ipcCalls', channel, row.n);
      if (num(row?.n) && num(row?.ms)) { count('ipcMsSum', channel, row.ms * row.n); }
      if (num(row?.max)) {
        maps.ipcMax ??= new Map();
        maps.ipcMax.set(channel, Math.max(maps.ipcMax.get(channel) || 0, row.max));
      }
    }
    for (const [event, n] of Object.entries(data.diag?.events || {})) if (num(n)) count('events', event, n);
    for (const id of Array.isArray(data.feats?.empty) ? data.feats.empty : []) count('featsEmpty', id);
    for (const id of Array.isArray(data.feats?.crashed) ? data.feats.crashed : []) count('featsCrashed', id);
    for (const [name, row] of Object.entries(data.feats?.sources || {})) {
      if (num(row?.fail)) count('sourceFails', name, row.fail);
      if (num(row?.ok)) count('sourceOk', name, row.ok);
      if (num(row?.ms) && num(row?.ok) && num(row?.fail)) count('sourceMsSum', name, row.ms * (row.ok + row.fail));
    }
    metric('Minutos com o Nexo em foco', data.app?.focusMin);
    metric('Minutos com o Nexo aberto', data.app?.openMin);
    metric('Aberturas no dia', data.app?.launches);
    metric('Tempo de abertura (ms)', data.app?.startMs);
    metric('CPU do Nexo em foco (%)', data.perf?.cpuFocus);
    metric('CPU do Nexo em segundo plano (%)', data.perf?.cpuBack);
    metric('Memória do Nexo em foco (MB)', data.perf?.memFocusMB);
    metric('Pico de memória do Nexo (MB)', data.perf?.memMaxMB);
    metric('Quadros do céu por segundo', data.perf?.skyFps);
    metric('Travadas da interface no dia', data.perf?.longTasks);
    metric('Vídeo com o Nexo na frente, Completo (%)', data.perf?.gpuCompleto);
    metric('Vídeo com o Nexo na frente, Leve (%)', data.perf?.gpuLeve);
    metric('Vídeo com o Nexo em segundo plano (%)', data.perf?.gpuFundo);
    metric('Processador do PC, média do dia (%)', data.health?.cpu);
    metric('Memória do PC, média do dia (%)', data.health?.mem);
    metric('Vídeo do PC, média do dia (%)', data.health?.gpu);
    metric('Maior temperatura do dia (°C)', data.health?.tempMax);
    // O que limita os PCs: minutos com carga por classe e o veredito das sessões de jogo; números da GPU com carga.
    for (const [kind, n] of Object.entries(data.bottleneck?.limiter || {})) if (num(n)) count('limiter', kind, n);
    for (const [kind, n] of Object.entries(data.bottleneck?.sessionLimiter || {})) if (num(n)) count('sessionLimiter', kind, n);
    const b = data.bottleneck || {};
    metric('GPU com carga: uso típico (%)', b.gpu?.busyP50);
    metric('GPU com carga: clock em % do máximo dela', num(b.gpu?.clockRatioP50) === null ? null : b.gpu.clockRatioP50 * 100);
    metric('GPU com carga: energia em % do limite', b.gpu?.powerPctP50);
    metric('GPU em 95%+ (% do tempo com carga)', num(b.gpu?.saturatedShare) === null ? null : b.gpu.saturatedShare * 100);
    metric('Memória de vídeo, pico do dia (%)', b.gpu?.vramPctMax);
    metric('Núcleo mais ocupado da CPU (p90, %)', b.cpu?.maxCoreP90);
    metric('Minutos com carga no dia', b.minutes);
    metric('FPS médio nas sessões', b.fps?.avg);
    metric('1% baixo nas sessões (FPS)', b.fps?.p1Low);
  }
  const top = (name) => [...(maps[name] || new Map())].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n: Math.round(n * 10) / 10 }));
  const pick = (list, p) => list[Math.min(list.length - 1, Math.max(0, Math.ceil(p * list.length) - 1))];
  const numbers = [...metrics].map(([label, values]) => { const sorted = [...values].sort((a, b) => a - b); return { key: label, median: Math.round(pick(sorted, 0.5) * 10) / 10, p90: Math.round(pick(sorted, 0.9) * 10) / 10, n: sorted.length }; });
  // Tempo médio por canal e por fonte: soma de ms ÷ chamadas, os mais lentos primeiro.
  const slow = (sumName, callsName, extra) => [...(maps[sumName] || new Map())].map(([key, total]) => { const calls = (maps[callsName]?.get(key) || 0) + (extra ? (maps[extra]?.get(key) || 0) : 0); return { key, n: calls ? Math.round(total / calls) : 0 }; }).sort((a, b) => b.n - a.n);
  const ipcSlow = slow('ipcMsSum', 'ipcCalls');
  const sourceSlow = slow('sourceMsSum', 'sourceOk', 'sourceFails');
  const ipcMax = [...(maps.ipcMax || new Map())].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n }));
  const names = ['limiter', 'sessionLimiter', 'updatedFrom', 'ageDays', 'ipcFails', 'events', 'featsEmpty', 'featsCrashed', 'sourceFails', 'versions', 'platforms', 'cpus', 'cpuModels', 'ram', 'cores', 'gpus', 'gpuModels', 'monitors', 'resolutions', 'refresh', 'scales', 'locales', 'channels', 'appFlags', 'sensors', 'effects', 'accents', 'skyDensity', 'skyFlags', 'profiles', 'liveRates', 'stores', 'views', 'viewTime', 'actions', 'ui', 'features'];
  return { activeByDay: [...perDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, set]) => ({ day, n: set.size })), installs: latest.size, reports: parsed.length, numbers, ipcSlow, ipcMax, sourceSlow, ...Object.fromEntries(names.map((name) => [name, top(name)])) };
}
