/*
 * Contagem exata de usuários, por PC. Spec: docs/superpowers/specs/2026-11-17-contagem-exata-design.md
 *
 *  POST /v1/pulse    sinal de vida do dia (o app, uma vez por dia, ligado por padrão e desligável)
 *  POST /v1/install  avisos do instalador: instalou, atualizou, desinstalou
 *  POST /v1/optout   +1 em "desligaram a contagem" (sem código nenhum)
 *
 * O código do PC chega embaralhado (SHA-256 com o prefixo do Nexo) e aqui vira HMAC(PC_PEPPER, código): o banco sozinho
 * não liga um registro a um PC nem a outro app. Nada daqui sai pelo painel ou pelo conector, só contagens.
 */
import { utf8 } from './crypto.js';
import { PLATFORMS, RE, compareVersions, dayOf } from './validate.js';

const PC = /^[0-9a-f]{64}$/;
export const EVENTS = new Set(['instalou', 'atualizou', 'desinstalou']);
export const ORIGENS = new Set(['app', 'instalador']);

/** Chave guardada para um código de PC: HMAC-SHA256(PC_PEPPER, código), 32 hex. Sem o segredo, 503 (nada é guardado). */
export async function pcKey(env, pc) {
  const pepper = String(env.PC_PEPPER || '');
  if (pepper.length < 32) throw Object.assign(new Error('Contagem indisponível no servidor.'), { status: 503 });
  const key = await crypto.subtle.importKey('raw', utf8(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(pc)));
  return [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export function createContagem({ now, limit, ipKey, json, readJson, HttpError }) {
  const bad = (message) => new HttpError(400, message);
  const version = (value) => (RE.version.test(String(value || '')) ? value : '0.0.0');
  const platform = (value) => (PLATFORMS.has(value) ? value : 'win32');
  const ip = async (request, env) => (await ipKey(request, env)).slice(3);

  /** Valida o código, embaralha com o segredo e aplica os limites (por PC e por IP). */
  async function checkedKey(request, env, body, prefix, perPc, perIp) {
    const pc = typeof body.pc === 'string' ? body.pc : '';
    if (!PC.test(pc)) throw bad('Código do PC inválido.');
    const key = await pcKey(env, pc);
    await limit(env, `${prefix}:${key}`, perPc);
    await limit(env, `${prefix}ip:${await ip(request, env)}`, perIp);
    return key;
  }

  /** Sinal de vida: um por PC por dia (o dia do servidor); dia novo soma em days_active. */
  async function pulse(request, env) {
    const body = await readJson(request);
    const key = await checkedKey(request, env, body, 'pulse', 10, 1000);
    const at = now();
    const day = dayOf(at);
    const ver = version(body.version);
    const plat = platform(body.platform);
    const inserted = await env.DB.prepare('INSERT OR IGNORE INTO pulses (pc, day, version, platform) VALUES (?, ?, ?, ?)').bind(key, day, ver, plat).run();
    const fresh = inserted?.meta?.changes ? 1 : 0;
    await env.DB.prepare(`INSERT INTO pcs (pc, first_seen, last_seen, first_version, last_version, platform, first_pulse_day, last_pulse_day, days_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pc) DO UPDATE SET last_seen = excluded.last_seen, last_version = excluded.last_version, platform = excluded.platform,
        first_pulse_day = COALESCE(pcs.first_pulse_day, excluded.first_pulse_day), last_pulse_day = excluded.last_pulse_day,
        days_active = pcs.days_active + ?, uninstalled_at = NULL`).bind(key, at, at, ver, ver, plat, day, day, fresh, fresh).run();
    return json({ ok: true, day });
  }

  /** Aviso do instalador. "instalou" num PC conhecido soma uma reinstalação; um sinal de vida depois de "desinstalou" limpa a marca. */
  async function install(request, env) {
    const body = await readJson(request);
    const event = String(body.event || '');
    if (!EVENTS.has(event)) throw bad('Evento inválido.');
    const key = await checkedKey(request, env, body, 'inst', 10, 300);
    const at = now();
    const ver = version(body.version);
    const plat = platform(body.platform);
    const installed = event === 'instalou' ? 1 : 0;
    const removed = event === 'desinstalou' ? at : null;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO pcs (pc, first_seen, last_seen, first_version, last_version, platform, installs, installed_at, uninstalled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pc) DO UPDATE SET last_seen = excluded.last_seen, last_version = excluded.last_version, platform = excluded.platform,
          installs = pcs.installs + ?, installed_at = CASE WHEN ? = 1 THEN excluded.last_seen ELSE pcs.installed_at END,
          uninstalled_at = CASE WHEN ? IS NOT NULL THEN ? WHEN ? = 1 THEN NULL ELSE pcs.uninstalled_at END`)
        .bind(key, at, at, ver, ver, plat, installed, installed ? at : null, removed, installed, installed, removed, removed, installed),
      env.DB.prepare('INSERT INTO pc_events (pc, at, event, version, platform) VALUES (?, ?, ?, ?, ?)').bind(key, at, event, ver, plat)
    ]);
    return json({ ok: true });
  }

  /** +1 em "desligaram a contagem", só a soma do dia por origem. */
  async function optout(request, env) {
    const body = await readJson(request);
    const origem = String(body.origem || '');
    if (!ORIGENS.has(origem)) throw bad('Origem inválida.');
    await limit(env, `optout:${await ip(request, env)}`, 5);
    await env.DB.prepare('INSERT INTO optouts (day, origem, n) VALUES (?, ?, 1) ON CONFLICT(day, origem) DO UPDATE SET n = optouts.n + 1').bind(dayOf(now()), origem).run();
    return json({ ok: true });
  }

  return { pulse, install, optout };
}

/* ---------- Números (só contagens: nada daqui leva código de PC) ---------- */

const DAY_MS = 24 * 3600 * 1000;
const pct1 = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const n = (row) => Number(row?.n) || 0;

/** Consultas da contagem: funil, retenção, séries por dia e saúde por versão. */
export function createQueries({ now }) {
  const today = () => dayOf(now());
  const daysAgo = (days) => dayOf(now() - days * DAY_MS);

  /** Funil por PC. "Instalaram" = todo PC conhecido (quem atualizou de uma versão antiga nunca mandou "instalou"). */
  async function funil(env) {
    const one = (sql, ...args) => env.DB.prepare(sql).bind(...args).first();
    const [all, opened, real, tried, act1, act7, act30, reinst, uninst, inicio, opt] = await Promise.all([
      one('SELECT COUNT(*) AS n FROM pcs'),
      one('SELECT COUNT(*) AS n FROM pcs WHERE days_active >= 1'),
      one('SELECT COUNT(*) AS n FROM pcs WHERE days_active >= 2'),
      one('SELECT COUNT(*) AS n FROM pcs WHERE days_active = 1 AND first_pulse_day < ?', daysAgo(7)),
      one('SELECT COUNT(DISTINCT pc) AS n FROM pulses WHERE day = ?', today()),
      one('SELECT COUNT(DISTINCT pc) AS n FROM pulses WHERE day >= ?', daysAgo(6)),
      one('SELECT COUNT(DISTINCT pc) AS n FROM pulses WHERE day >= ?', daysAgo(29)),
      one('SELECT COUNT(*) AS n FROM pcs WHERE installs >= 2'),
      one('SELECT COUNT(*) AS n FROM pcs WHERE uninstalled_at IS NOT NULL'),
      one('SELECT MIN(day) AS day FROM pulses'),
      env.DB.prepare('SELECT origem, SUM(n) AS n FROM optouts GROUP BY origem').all()
    ]);
    const byOrigin = Object.fromEntries((opt.results || []).map((row) => [row.origem, Number(row.n) || 0]));
    const app = byOrigin.app || 0;
    const instalador = byOrigin.instalador || 0;
    return { instalaram: n(all), abriram: n(opened), reais: n(real), experimentaram: n(tried), ativosHoje: n(act1), ativos7: n(act7), ativos30: n(act30),
      reinstalaram: n(reinst), desinstalaram: n(uninst), desligaram: { app, instalador, total: app + instalador }, inicio: inicio?.day || null };
  }

  /** Dos PCs com o primeiro dia há pelo menos N dias, quantos % voltaram em algum dia >= primeiro dia + N. */
  async function retencao(env) {
    const out = {};
    for (const [name, days] of [['d1', 1], ['d7', 7], ['d30', 30]]) {
      // eslint-disable-next-line no-await-in-loop -- três consultas pequenas, em ordem
      const row = await env.DB.prepare(`SELECT COUNT(*) AS de, SUM(CASE WHEN EXISTS (SELECT 1 FROM pulses u WHERE u.pc = p.pc AND u.day >= date(p.first_pulse_day, ?)) THEN 1 ELSE 0 END) AS voltou
        FROM pcs p WHERE p.first_pulse_day IS NOT NULL AND p.first_pulse_day <= ?`).bind(`+${days} days`, daysAgo(days)).first();
      const de = Number(row?.de) || 0;
      out[name] = { pct: pct1(Number(row?.voltou) || 0, de), de };
    }
    return out;
  }

  /** Séries diárias do período: PCs ativos, PCs novos (primeiro dia) e avisos do instalador. */
  async function porDia(env, dias) {
    const from = daysAgo(dias - 1);
    const [ativos, novos, eventos] = await Promise.all([
      env.DB.prepare('SELECT day, COUNT(*) AS n FROM pulses WHERE day >= ? GROUP BY day ORDER BY day').bind(from).all(),
      env.DB.prepare('SELECT first_pulse_day AS day, COUNT(*) AS n FROM pcs WHERE first_pulse_day >= ? GROUP BY first_pulse_day ORDER BY first_pulse_day').bind(from).all(),
      env.DB.prepare(`SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day, SUM(event = 'instalou') AS instalou, SUM(event = 'atualizou') AS atualizou, SUM(event = 'desinstalou') AS desinstalou
        FROM pc_events WHERE at >= ? GROUP BY day ORDER BY day`).bind(Date.parse(`${from}T00:00:00Z`)).all()
    ]);
    const list = (result) => (result.results || []).map((row) => ({ ...row }));
    return { ativos: list(ativos), novos: list(novos), eventos: list(eventos).map((row) => ({ day: row.day, instalou: Number(row.instalou) || 0, atualizou: Number(row.atualizou) || 0, desinstalou: Number(row.desinstalou) || 0 })) };
  }

  /**
   * Saúde por versão (7 dias): PCs ativos, ≈ % sem erro (instalações com erro ÷ PCs ativos: aproximado de propósito,
   * PC e instalação não se ligam no servidor), erros abertos e, na mais nova, as regressões (erros só dela).
   */
  async function versoes(env) {
    const since = daysAgo(6);
    const sinceMs = Date.parse(`${since}T00:00:00Z`);
    const [active, ever, errored, open] = await Promise.all([
      env.DB.prepare('SELECT version, COUNT(DISTINCT pc) AS n FROM pulses WHERE day >= ? GROUP BY version').bind(since).all(),
      env.DB.prepare('SELECT version, COUNT(DISTINCT pc) AS n, MIN(day) AS first FROM pulses GROUP BY version').all(),
      env.DB.prepare(`SELECT r.version, COUNT(DISTINCT r.install_id) AS n FROM error_reports r JOIN error_groups g ON g.signature = r.signature
        WHERE g.level = 'erro' AND r.last_at >= ? GROUP BY r.version`).bind(sinceMs).all(),
      env.DB.prepare(`SELECT r.version, COUNT(DISTINCT g.signature) AS n FROM error_groups g JOIN error_reports r ON r.signature = g.signature
        WHERE g.status IN ('aberto', 'reaberto') AND g.level = 'erro' GROUP BY r.version`).all()
    ]);
    const map = (result, field = 'n') => new Map((result.results || []).map((row) => [row.version, row[field]]));
    const act = map(active);
    const all = map(ever);
    const first = map(ever, 'first');
    const err = map(errored);
    const opened = map(open);
    const names = [...new Set([...act.keys(), ...all.keys()])].sort((a, b) => compareVersions(b, a));
    const maisNova = [...act.keys()].sort((a, b) => compareVersions(b, a))[0] || null;
    let regressoes = [];
    if (maisNova) {
      const since0 = Date.parse(`${first.get(maisNova)}T00:00:00Z`);
      const { results = [] } = await env.DB.prepare(`SELECT g.signature, g.message, COUNT(DISTINCT r.install_id) AS installs, COALESCE(SUM(r.count), 0) AS occurrences
        FROM error_groups g JOIN error_reports r ON r.signature = g.signature
        WHERE g.status IN ('aberto', 'reaberto') AND g.level = 'erro' AND g.first_at >= ?
        GROUP BY g.signature HAVING COUNT(DISTINCT r.version) = 1 AND MAX(r.version) = ? ORDER BY occurrences DESC LIMIT 20`).bind(since0, maisNova).all();
      regressoes = results.map((row) => ({ signature: row.signature, message: row.message, installs: Number(row.installs) || 0, occurrences: Number(row.occurrences) || 0 }));
    }
    return {
      maisNova,
      versoes: names.map((version) => {
        const ativos7 = Number(act.get(version)) || 0;
        const comErro = Math.min(ativos7, Number(err.get(version)) || 0);
        return { version, ativos7, desde: Number(all.get(version)) || 0, pctSemErro: ativos7 ? pct1(ativos7 - comErro, ativos7) : null, errosAbertos: Number(opened.get(version)) || 0, regressoes: version === maisNova ? regressoes : [] };
      })
    };
  }

  return { funil, retencao, porDia, versoes };
}
