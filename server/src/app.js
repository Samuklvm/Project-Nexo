/*
 * Servidor do Nexo Device Care.
 *
 *  /v1/auth/google   login com o id_token do Google → sessão do Nexo (1 ano, revogável)
 *  /v1/me            conta: ver e APAGAR TUDO (direito da pessoa, LGPD)
 *  /v1/sync          uma cópia criptografada por PC; trazer dados de outro PC é escolha da pessoa no app
 *  /v1/errors        relatórios de erro agrupados (com o e-mail só de quem está logado e aceitou)
 *  /v1/telemetry     um pacote por dia, anônimo (código aleatório do PC), só para quem ligou
 *  /painel           painel do criador (entrada por link de uso único gerado no app do criador)
 *
 * Nada aqui registra o conteúdo dos pedidos em log.
 */
import { open, randomId, seal, sha256Hex, signToken, verifyToken } from './crypto.js';
import { verifyGoogleIdToken } from './google.js';
import { LEVELS, LIMITS, PLATFORMS, RE, SOURCES, STATUSES, clampInt, cleanTelemetry, compareVersions, dayOf, redact, text } from './validate.js';
import { PANEL_CSS, PANEL_HTML, PANEL_JS, PANEL_LOCKED } from './panel.js';

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
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  const ipKey = async (request) => `ip:${(await sha256Hex(`nexo:${request.headers.get('cf-connecting-ip') || 'local'}`)).slice(0, 20)}`;

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
    if (!token) { if (required) throw new HttpError(401, 'Entre com a sua conta Google no Nexo.'); return null; }
    const payload = await verifyToken(token, env.SESSION_SECRET, now());
    if (!payload?.sid) throw new HttpError(401, 'Sessão inválida. Entre de novo.');
    const row = await env.DB.prepare('SELECT s.sid, s.uid, s.device_id, s.expires_at, s.revoked, u.email, u.name FROM sessions s JOIN users u ON u.uid = s.uid WHERE s.sid = ?').bind(payload.sid).first();
    if (!row || row.revoked || row.expires_at <= now()) throw new HttpError(401, 'Sessão encerrada. Entre de novo.');
    return { sid: row.sid, uid: row.uid, deviceId: row.device_id, email: row.email, name: row.name };
  }

  /* ---------- Conta ---------- */
  async function login(request, env) {
    await limit(env, await ipKey(request), 60);
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
    await limit(env, `errip:${(await ipKey(request)).slice(3)}`, 300);
    const version = RE.version.test(String(body.version || '')) ? body.version : '0.0.0';
    const platform = PLATFORMS.has(body.platform) ? body.platform : 'win32';
    // O e-mail vem da sessão (nunca do corpo): só de quem está logado e marcou "incluir meu e-mail".
    let email = null;
    if (body.includeEmail === true) email = (await session(request, env, { required: false }).catch(() => null))?.email || null;
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
      statements.push(env.DB.prepare(`INSERT INTO error_reports (signature, install_id, email, version, platform, count, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(signature, install_id) DO UPDATE SET email = COALESCE(excluded.email, error_reports.email), version = excluded.version, platform = excluded.platform,
        count = error_reports.count + excluded.count, first_at = MIN(error_reports.first_at, excluded.first_at), last_at = MAX(error_reports.last_at, excluded.last_at)`).bind(report.signature, installId, email, version, platform, count, firstAt, lastAt));
      accepted += 1;
    }
    if (accepted) {
      // Corrigido, mas voltou numa versão igual ou mais nova que a da correção: reabre (comparar versões no SQL é ruim).
      const signatures = [...new Set(reports.filter((report) => report && RE.signature.test(String(report.signature || ''))).map((report) => report.signature))];
      const fixed = (await env.DB.prepare(`SELECT signature, fixed_in FROM error_groups WHERE status = 'corrigido' AND signature IN (${signatures.map(() => '?').join(',')})`).bind(...signatures).all()).results || [];
      const reopen = fixed.filter((row) => row.fixed_in && compareVersions(version, row.fixed_in) >= 0).map((row) => row.signature);
      if (reopen.length) statements.push(env.DB.prepare(`UPDATE error_groups SET status = 'reaberto' WHERE signature IN (${reopen.map(() => '?').join(',')})`).bind(...reopen));
      await env.DB.batch(statements);
    }
    return json({ ok: true, accepted });
  }

  /* ---------- Telemetria ---------- */
  async function postTelemetry(request, env) {
    const body = await readJson(request);
    const installId = String(body.installId || '');
    if (!RE.installId.test(installId)) throw new HttpError(400, 'Instalação inválida.');
    await limit(env, `tel:${installId}`, 3);
    const data = cleanTelemetry(body.data);
    if (!data) throw new HttpError(400, 'Telemetria inválida.');
    const today = dayOf(now());
    const day = RE.day.test(String(body.day || '')) && body.day <= today && body.day >= dayOf(now() - 3 * DAY) ? body.day : today;
    const version = RE.version.test(String(body.version || '')) ? body.version : '0.0.0';
    const platform = PLATFORMS.has(body.platform) ? body.platform : 'win32';
    await env.DB.prepare('INSERT INTO telemetry (install_id, day, version, platform, data, received_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(install_id, day) DO UPDATE SET version = excluded.version, platform = excluded.platform, data = excluded.data, received_at = excluded.received_at')
      .bind(installId, day, version, platform, JSON.stringify(data), now()).run();
    return json({ ok: true });
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
      return json({ openErrors: open7?.n || 0, reportingInstalls7: reporters?.n || 0, activeInstalls7: active7?.n || 0, activeInstalls30: active30?.n || 0, accounts: accounts?.n || 0, versions: versions.results || [], admin: admin.email, role: admin.role, permissions: [...CAN[admin.role]] });
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
      const { results = [] } = await env.DB.prepare('SELECT email, version, platform, count, first_at, last_at FROM error_reports WHERE signature = ? ORDER BY last_at DESC LIMIT 500').bind(detail[1]).all();
      const emails = admin.can('emails') ? [...new Set(results.map((row) => row.email).filter(Boolean))] : [];
      return json({ group, reports: results.map(({ email, ...row }) => ({ ...row, hasEmail: Boolean(email) })), emails, emailsHidden: !admin.can('emails') });
    }
    if (detail && request.method === 'POST') {
      need('status');
      const body = await readJson(request);
      const status = STATUSES.has(body.status) ? body.status : null;
      if (!status) throw new HttpError(400, 'Status inválido.');
      const fixedIn = status === 'corrigido' ? (RE.version.test(String(body.fixedIn || '')) ? body.fixedIn : null) : null;
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
    const path = url.pathname.replace(/\/+$/, '') || '/';
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
    if (path.startsWith('/painel/api/')) return adminApi(request, env, url, path.slice('/painel/api/'.length));
    throw new HttpError(404, 'Não encontrado.');
  }

  return {
    async fetch(request, env, ctx) {
      try {
        return await route(request, env, ctx);
      } catch (error) {
        const status = Number(error?.status) || 500;
        if (status >= 500) console.error('nexo-api', error?.name || 'Error');
        return json({ error: status >= 500 ? 'Erro interno do servidor.' : error.message }, status);
      }
    },
    /** Limpeza diária (cron). */
    async scheduled(_event, env) {
      const at = now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM error_reports WHERE last_at < ?').bind(at - 180 * DAY),
        env.DB.prepare("DELETE FROM error_groups WHERE last_at < ? AND status != 'aberto' AND signature NOT IN (SELECT signature FROM error_reports)").bind(at - 180 * DAY),
        env.DB.prepare('DELETE FROM telemetry WHERE day < ?').bind(dayOf(at - 120 * DAY)),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked = 1').bind(at),
        env.DB.prepare('DELETE FROM admin_links WHERE expires_at < ?').bind(at),
        env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(at),
        env.DB.prepare('DELETE FROM rate WHERE day < ?').bind(dayOf(at - DAY))
      ]);
    }
  };
}

/** Agregados para o painel: instalações ativas por dia, versões, sistemas, hardware e uso das telas. */
export function aggregateTelemetry(rows) {
  const perDay = new Map();
  const latest = new Map();
  for (const row of rows) {
    if (!perDay.has(row.day)) perDay.set(row.day, new Set());
    perDay.get(row.day).add(row.install_id);
    const previous = latest.get(row.install_id);
    if (!previous || previous.day <= row.day) latest.set(row.install_id, row);
  }
  const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const versions = new Map(); const platforms = new Map(); const cpus = new Map(); const ram = new Map(); const gpus = new Map();
  const views = new Map(); const features = new Map();
  for (const row of latest.values()) {
    count(versions, row.version);
    count(platforms, row.platform);
    let data = {};
    try { data = JSON.parse(row.data); } catch { data = {}; }
    if (data.hw?.cpuVendor) count(cpus, String(data.hw.cpuVendor));
    if (Number.isFinite(data.hw?.ramGB)) count(ram, data.hw.ramGB <= 8 ? 'até 8 GB' : data.hw.ramGB <= 16 ? '9–16 GB' : data.hw.ramGB <= 32 ? '17–32 GB' : 'mais de 32 GB');
    if (data.hw?.gpuVendor) count(gpus, String(data.hw.gpuVendor));
  }
  for (const row of rows) {
    let data = {};
    try { data = JSON.parse(row.data); } catch { data = {}; }
    for (const [key, value] of Object.entries(data.usage?.views || {})) if (Number.isFinite(value)) views.set(key, (views.get(key) || 0) + value);
    for (const [key, value] of Object.entries(data.features || {})) if (Number.isFinite(value)) features.set(key, (features.get(key) || 0) + value);
  }
  const top = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n }));
  return { activeByDay: [...perDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, set]) => ({ day, n: set.size })), installs: latest.size, versions: top(versions), platforms: top(platforms), cpus: top(cpus), ram: top(ram), gpus: top(gpus), views: top(views), features: top(features) };
}
