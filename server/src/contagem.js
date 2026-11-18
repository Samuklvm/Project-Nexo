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

/** Sem o PC_PEPPER no ar, todas as rotas da contagem respondem 503 e não guardam nada. */
function requirePepper(env) {
  const pepper = String(env.PC_PEPPER || '');
  if (pepper.length < 32) throw Object.assign(new Error('Contagem indisponível no servidor.'), { status: 503 });
  return pepper;
}

/** Início (00:00 UTC) do dia de um instante: o banco guarda só o dia dos PCs, sem hora para cruzar com a telemetria. */
const dayStart = (at) => Date.parse(`${dayOf(at)}T00:00:00Z`);

/** Chave guardada para um código de PC: HMAC-SHA256(PC_PEPPER, código), 32 hex. Sem o segredo, 503 (nada é guardado). */
export async function pcKey(env, pc) {
  const pepper = requirePepper(env);
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

  /**
   * Sinal de vida: um por PC por dia (o dia do servidor). As duas gravações vão juntas (batch = transação), e o dia
   * novo é decidido pelo próprio pcs (last_pulse_day < hoje), não pelo INSERT anterior: uma falha no meio não perde o dia.
   */
  async function pulse(request, env) {
    const body = await readJson(request);
    const key = await checkedKey(request, env, body, 'pulse', 10, 1000);
    const at = dayStart(now());
    const day = dayOf(at);
    const ver = version(body.version);
    const plat = platform(body.platform);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO pulses (pc, day, version, platform) VALUES (?, ?, ?, ?)').bind(key, day, ver, plat),
      env.DB.prepare(`INSERT INTO pcs (pc, first_seen, last_seen, first_version, last_version, platform, first_pulse_day, last_pulse_day, days_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(pc) DO UPDATE SET last_seen = excluded.last_seen, last_version = excluded.last_version, platform = excluded.platform,
          first_pulse_day = COALESCE(pcs.first_pulse_day, excluded.first_pulse_day), last_pulse_day = excluded.last_pulse_day,
          days_active = pcs.days_active + CASE WHEN pcs.last_pulse_day IS NULL OR pcs.last_pulse_day < excluded.last_pulse_day THEN 1 ELSE 0 END,
          uninstalled_at = NULL`).bind(key, at, at, ver, ver, plat, day, day)
    ]);
    return json({ ok: true, day });
  }

  /** Aviso do instalador. "instalou" num PC conhecido soma uma reinstalação; um sinal de vida depois de "desinstalou" limpa a marca. */
  async function install(request, env) {
    const body = await readJson(request);
    const event = String(body.event || '');
    if (!EVENTS.has(event)) throw bad('Evento inválido.');
    const key = await checkedKey(request, env, body, 'inst', 10, 300);
    const at = dayStart(now());
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
    requirePepper(env);
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
  const shift = (day, days) => dayOf(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);

  /**
   * Funil por PC no fim do dia `ate` (padrão: hoje, ao vivo). "Instalaram" = todo PC conhecido (quem atualizou de uma
   * versão antiga nunca mandou "instalou"). Para um dia passado (a foto diária), desconta o que veio depois dele.
   */
  async function funil(env, ate = today()) {
    const one = (sql, ...args) => env.DB.prepare(sql).bind(...args).first();
    const end = Date.parse(`${ate}T00:00:00Z`) + DAY_MS;
    const daysUntil = '(p.days_active - (SELECT COUNT(*) FROM pulses u WHERE u.pc = p.pc AND u.day > ?))';
    const [all, opened, real, tried, act1, act7, act30, reinst, uninst, inicio, opt] = await Promise.all([
      one('SELECT COUNT(*) AS n FROM pcs WHERE first_seen < ?', end),
      one('SELECT COUNT(*) AS n FROM pcs WHERE first_pulse_day <= ?', ate),
      one(`SELECT COUNT(*) AS n FROM pcs p WHERE ${daysUntil} >= 2`, ate),
      one(`SELECT COUNT(*) AS n FROM pcs p WHERE ${daysUntil} = 1 AND p.first_pulse_day < ?`, ate, shift(ate, -7)),
      one('SELECT COUNT(DISTINCT pc) AS n FROM pulses WHERE day = ?', ate),
      one('SELECT COUNT(DISTINCT pc) AS n FROM pulses WHERE day >= ? AND day <= ?', shift(ate, -6), ate),
      one('SELECT COUNT(DISTINCT pc) AS n FROM pulses WHERE day >= ? AND day <= ?', shift(ate, -29), ate),
      one(`SELECT COUNT(*) AS n FROM pcs p WHERE p.installs - (SELECT COUNT(*) FROM pc_events e WHERE e.pc = p.pc AND e.event = 'instalou' AND e.at >= ?) >= 2`, end),
      one('SELECT COUNT(*) AS n FROM pcs WHERE uninstalled_at IS NOT NULL AND uninstalled_at < ?', end),
      one('SELECT MIN(day) AS day FROM pulses WHERE day <= ?', ate),
      env.DB.prepare('SELECT origem, SUM(n) AS n FROM optouts WHERE day <= ? GROUP BY origem').bind(ate).all()
    ]);
    const byOrigin = Object.fromEntries((opt.results || []).map((row) => [row.origem, Number(row.n) || 0]));
    const app = byOrigin.app || 0;
    const instalador = byOrigin.instalador || 0;
    return { instalaram: n(all), abriram: n(opened), reais: n(real), experimentaram: n(tried), ativosHoje: n(act1), ativos7: n(act7), ativos30: n(act30),
      reinstalaram: n(reinst), desinstalaram: n(uninst), desligaram: { app, instalador, total: app + instalador }, inicio: inicio?.day || null };
  }

  /** Dos PCs com o primeiro dia há pelo menos N dias (até o dia `ate`), quantos % voltaram em algum dia >= primeiro dia + N. */
  async function retencao(env, ate = today()) {
    const out = {};
    for (const [name, days] of [['d1', 1], ['d7', 7], ['d30', 30]]) {
      // eslint-disable-next-line no-await-in-loop -- três consultas pequenas, em ordem
      const row = await env.DB.prepare(`SELECT COUNT(*) AS de, SUM(CASE WHEN EXISTS (SELECT 1 FROM pulses u WHERE u.pc = p.pc AND u.day >= date(p.first_pulse_day, ?) AND u.day <= ?) THEN 1 ELSE 0 END) AS voltou
        FROM pcs p WHERE p.first_pulse_day IS NOT NULL AND p.first_pulse_day <= ?`).bind(`+${days} days`, ate, shift(ate, -days)).first();
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
      env.DB.prepare(`SELECT s.version, COUNT(DISTINCT s.install_id) AS n FROM error_seen s JOIN error_groups g ON g.signature = s.signature
        WHERE g.level = 'erro' AND s.last_at >= ? GROUP BY s.version`).bind(sinceMs).all(),
      env.DB.prepare(`SELECT s.version, COUNT(DISTINCT g.signature) AS n FROM error_groups g JOIN error_seen s ON s.signature = g.signature
        WHERE g.status IN ('aberto', 'reaberto') AND g.level = 'erro' GROUP BY s.version`).all()
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
      const { results = [] } = await env.DB.prepare(`SELECT g.signature, g.message, COUNT(DISTINCT s.install_id) AS installs, COALESCE(SUM(s.count), 0) AS occurrences
        FROM error_groups g JOIN error_seen s ON s.signature = g.signature
        WHERE g.status IN ('aberto', 'reaberto') AND g.level = 'erro' AND g.first_at >= ?
        GROUP BY g.signature HAVING COUNT(DISTINCT s.version) = 1 AND MAX(s.version) = ? ORDER BY occurrences DESC LIMIT 20`).bind(since0, maisNova).all();
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

/* ---------- Cron: foto diária, downloads do GitHub (referência imprecisa) e limpeza ---------- */

const RELEASES_URL = 'https://api.github.com/repos/Samuklvm/Project-Nexo/releases?per_page=100';
/** Arquivos que contam como download do app (o resto, como latest.yml e .blockmap, é do atualizador). */
const DOWNLOADABLE = /\.(exe|appimage|deb)$/i;
const KEEP_DAYS = 400;

export function createCron({ now, fetchImpl, queries }) {
  const yesterday = () => dayOf(now() - DAY_MS);

  /** Foto do dia de ontem: funil e retenção no fim de ontem, ativos e novos de ontem e os ativos por versão. */
  async function fotoDiaria(env) {
    const day = yesterday();
    const [funil, retencao, ativos, novos, porVersao] = await Promise.all([
      queries.funil(env, day), queries.retencao(env, day),
      env.DB.prepare('SELECT COUNT(*) AS n FROM pulses WHERE day = ?').bind(day).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM pcs WHERE first_pulse_day = ?').bind(day).first(),
      env.DB.prepare('SELECT version, COUNT(*) AS n FROM pulses WHERE day = ? GROUP BY version ORDER BY n DESC').bind(day).all()
    ]);
    const data = { dia: day, funil, retencao, ativosDia: n(ativos), novosDia: n(novos), porVersao: (porVersao.results || []).map((row) => ({ version: row.version, n: n(row) })) };
    await env.DB.prepare('INSERT OR REPLACE INTO daily_stats (day, data) VALUES (?, ?)').bind(day, JSON.stringify(data)).run();
  }

  /** Downloads por release no GitHub (só .exe, .AppImage e .deb). Falha de rede ou resposta estranha: fica para amanhã. */
  async function downloadsGithub(env) {
    const headers = { 'user-agent': 'nexo-api', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
    if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
    let list;
    try {
      const response = await fetchImpl(RELEASES_URL, { headers });
      if (!response.ok) return;
      list = await response.json();
    } catch { return; }
    if (!Array.isArray(list)) return;
    const day = dayOf(now());
    const statements = list.filter((release) => release && typeof release.tag_name === 'string').slice(0, 100).map((release) => {
      const total = (Array.isArray(release.assets) ? release.assets : []).filter((asset) => DOWNLOADABLE.test(String(asset?.name || ''))).reduce((sum, asset) => sum + (Number(asset.download_count) || 0), 0);
      return env.DB.prepare('INSERT OR REPLACE INTO gh_downloads (day, tag, total) VALUES (?, ?, ?)').bind(day, release.tag_name.slice(0, 40), total);
    });
    if (statements.length) await env.DB.batch(statements);
  }

  /** Último retrato dos downloads do GitHub, ou null. */
  async function githubTotal(env) {
    const last = await env.DB.prepare('SELECT MAX(day) AS day FROM gh_downloads').first();
    if (!last?.day) return null;
    const { results = [] } = await env.DB.prepare('SELECT tag, total FROM gh_downloads WHERE day = ? ORDER BY total DESC').bind(last.day).all();
    return { dia: last.day, total: results.reduce((sum, row) => sum + (Number(row.total) || 0), 0), porTag: results.map((row) => ({ tag: row.tag, total: Number(row.total) || 0 })) };
  }

  /** Limpeza de retenção (400 dias), para entrar no batch do cron. */
  function limpeza(env) {
    const at = now();
    return [
      env.DB.prepare('DELETE FROM pulses WHERE day < ?').bind(dayOf(at - KEEP_DAYS * DAY_MS)),
      env.DB.prepare('DELETE FROM pc_events WHERE at < ?').bind(at - KEEP_DAYS * DAY_MS),
      env.DB.prepare('DELETE FROM pcs WHERE last_seen < ?').bind(at - KEEP_DAYS * DAY_MS)
    ];
  }

  return { fotoDiaria, downloadsGithub, githubTotal, limpeza };
}
