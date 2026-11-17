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
import { PLATFORMS, RE, dayOf } from './validate.js';

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
