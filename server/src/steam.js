/*
 * "Entrar com a Steam": o login oficial da Steam (OpenID 2.0) passando pelo servidor do Nexo.
 *
 *  /v1/steam/start         abre a página da Steam; nenhuma senha passa pelo Nexo
 *  /v1/steam/back          a Steam volta aqui; o servidor confere com a própria Steam e devolve ao app (127.0.0.1)
 *                          um passe assinado com o SteamID (1 ano)
 *  /v1/steam/me            perfil público (nome e foto)
 *  /v1/steam/library       jogos da conta, tempo de jogo e jogados nas últimas 2 semanas
 *  /v1/steam/achievements  conquistas de um jogo (esquema, progresso da pessoa e raridade global)
 *
 * A chave da Steam Web API é do criador (segredo STEAM_API_KEY) e nunca sai do servidor. Nada da Steam é guardado
 * aqui: cada pedido vai à Steam e volta. Os jogos só aparecem se o perfil deixar "Detalhes de jogos" público.
 */
import { signToken, verifyToken } from './crypto.js';

const OPENID = 'https://steamcommunity.com/openid/login';
// Identificadores fixos da especificação OpenID 2.0 (são nomes, não endereços acessados): a Steam exige exatamente
// estes textos com "http://". Nenhuma conexão é feita a eles.
const NS = 'http://specs.openid.net/auth/2.0'; // NOSONAR: identificador da especificação, não URL acessada
const SELECT = 'http://specs.openid.net/auth/2.0/identifier_select'; // NOSONAR: idem
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
const STATE = /^[A-Za-z0-9_-]{16,64}$/;
const API = 'https://api.steampowered.com';
const PASS_DAYS = 365;
const DAY = 24 * 3600 * 1000;

class SteamError extends Error { constructor(status, message) { super(message); this.status = status; } }

const portOf = (value) => { const port = Number(value); return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null; };

/** Página curta para quando algo dá errado no navegador (o app espera e mostra o motivo também). */
function tella(message, status = 400) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nexo e Steam</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b1f;color:#eef2ff;font:16px/1.5 system-ui,"Segoe UI",sans-serif}main{max-width:460px;padding:28px;border:1px solid rgba(150,175,255,.2);border-radius:18px;background:rgba(16,24,60,.7);text-align:center}h1{font-size:20px;margin:0 0 8px}</style></head>
<body><main><h1>Não deu para entrar com a Steam</h1><p>${String(message).replace(/[<>&"]/g, '')}</p><p>Pode fechar esta aba e tentar de novo no Nexo.</p></main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
}

/** Rotas do "Entrar com a Steam" (login OpenID oficial) e da biblioteca/conquistas pela chave do servidor. */
export function createSteam({ fetchImpl, now, limit, json }) {
  const returnTo = (url, port, state) => `${url.origin}/v1/steam/back?port=${port}&state=${state}`;

  /** 1) Leva o navegador para a página oficial de login da Steam. */
  function start(url) {
    const port = portOf(url.searchParams.get('port'));
    const state = url.searchParams.get('state') || '';
    if (!port || !STATE.test(state)) return tella('O pedido de login veio incompleto.');
    const params = new URLSearchParams({
      'openid.ns': NS, 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo(url, port, state), 'openid.realm': url.origin,
      'openid.identity': SELECT, 'openid.claimed_id': SELECT
    });
    return new Response(null, { status: 302, headers: { location: `${OPENID}?${params}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }

  /** 2) A Steam volta aqui. Confere a resposta com a própria Steam e devolve o passe ao app neste PC. */
  async function back(url, env) {
    const port = portOf(url.searchParams.get('port'));
    const state = url.searchParams.get('state') || '';
    if (!port || !STATE.test(state)) return tella('O retorno da Steam veio incompleto.');
    const q = url.searchParams;
    if (q.get('openid.mode') === 'cancel') return tella('O login foi cancelado na Steam.');
    if (q.get('openid.mode') !== 'id_res' || q.get('openid.ns') !== NS || q.get('openid.op_endpoint') !== OPENID) return tella('A resposta não parece ser da Steam.');
    if (q.get('openid.return_to') !== returnTo(url, port, state)) return tella('A resposta da Steam era para outro pedido.');
    const match = CLAIMED.exec(q.get('openid.claimed_id') || '');
    if (!match || q.get('openid.identity') !== q.get('openid.claimed_id')) return tella('A Steam não mandou uma conta válida.');
    // Só a Steam sabe se a assinatura vale: pergunta a ela (modo check_authentication).
    const body = new URLSearchParams();
    for (const [key, value] of q) if (key.startsWith('openid.')) body.set(key, value);
    body.set('openid.mode', 'check_authentication');
    let verdict = '';
    try {
      const response = await fetchImpl(OPENID, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/plain' }, body: body.toString() });
      verdict = await response.text();
    } catch { return tella('A Steam não respondeu agora.', 502); }
    if (!/^is_valid\s*:\s*true\s*$/m.test(verdict)) return tella('A Steam não confirmou o login.');
    const pass = await signToken({ typ: 'steam', steam: match[1], exp: now() + PASS_DAYS * DAY }, env.SESSION_SECRET);
    const target = `http://127.0.0.1:${port}/steam?${new URLSearchParams({ state, pass })}`;
    return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }

  /** Passe da Steam no cabeçalho Authorization → SteamID64 (ou 401). */
  async function who(request, env) {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const payload = token ? await verifyToken(token, env.SESSION_SECRET, now()) : null;
    if (!payload || payload.typ !== 'steam' || !/^7656119\d{10}$/.test(String(payload.steam))) throw new SteamError(401, 'Entre com a Steam de novo.');
    return payload.steam;
  }

  async function steamApi(env, route, params) {
    if (!/^[0-9A-F]{32}$/i.test(String(env.STEAM_API_KEY || '').trim())) throw new SteamError(503, 'A Steam ainda não está configurada no servidor do Nexo.');
    const query = new URLSearchParams({ key: String(env.STEAM_API_KEY).trim(), format: 'json', ...params });
    let response;
    try { response = await fetchImpl(`${API}${route}?${query}`, { headers: { accept: 'application/json' } }); } catch { throw new SteamError(502, 'A Steam não respondeu agora.'); }
    if (response.status === 403 || response.status === 401) return { private: true };
    if (response.status === 400) return { private: true };
    if (!response.ok) throw new SteamError(502, `A Steam respondeu ${response.status}.`);
    try { return await response.json(); } catch { throw new SteamError(502, 'A Steam mandou uma resposta estranha.'); }
  }

  async function me(request, env) {
    const steam = await who(request, env);
    await limit(env, `steam:${steam}`, 600);
    const data = await steamApi(env, '/ISteamUser/GetPlayerSummaries/v2/', { steamids: steam });
    const player = data?.response?.players?.[0];
    if (!player) return json({ steamId: steam, personaName: null, avatar: null, public: false });
    const avatar = /^https:\/\/avatars\.(steamstatic|akamai\.steamstatic|cloudflare\.steamstatic)\.com\/[A-Za-z0-9_./-]+$/.test(String(player.avatarfull || '')) ? player.avatarfull : null;
    return json({ steamId: steam, personaName: String(player.personaname || '').slice(0, 64) || null, avatar, public: Number(player.communityvisibilitystate) === 3 });
  }

  /** Jogos da conta Steam do passe assinado (com tempo de jogo), buscados na Steam Web API a cada pedido. */
  async function library(request, env) {
    const steam = await who(request, env);
    await limit(env, `steam:${steam}`, 600);
    const [owned, recent] = await Promise.all([
      steamApi(env, '/IPlayerService/GetOwnedGames/v1/', { steamid: steam, include_appinfo: '1', include_played_free_games: '1' }),
      steamApi(env, '/IPlayerService/GetRecentlyPlayedGames/v1/', { steamid: steam, count: '30' })
    ]);
    const list = owned?.response?.games;
    if (!Array.isArray(list)) return json({ steamId: steam, visible: false, games: [] });
    const twoWeeks = new Map((recent?.response?.games || []).map((game) => [String(game.appid), Number(game.playtime_2weeks) || 0]));
    const games = list.filter((game) => Number.isInteger(game.appid) && game.name).slice(0, 5000).map((game) => ({
      appid: String(game.appid), name: String(game.name).slice(0, 120), playtimeMin: Number(game.playtime_forever) || 0,
      lastPlayed: Number(game.rtime_last_played) ? game.rtime_last_played * 1000 : null, twoWeeksMin: twoWeeks.get(String(game.appid)) || 0
    }));
    return json({ steamId: steam, visible: true, games });
  }

  /**
   * Conquistas de um jogo: esquema (nomes e ícones), o progresso da pessoa e a raridade global, só com os campos que
   * o app usa. O app monta a lista (o mesmo código de quando a pessoa usa a própria chave).
   */
  async function achievements(request, env, url) {
    const steam = await who(request, env);
    const appid = url.searchParams.get('appid') || '';
    if (!/^\d{1,9}$/.test(appid)) throw new SteamError(400, 'Jogo inválido.');
    await limit(env, `steam:${steam}`, 600);
    const schema = await steamApi(env, '/ISteamUserStats/GetSchemaForGame/v2/', { appid, l: 'brazilian' });
    const defs = schema?.game?.availableGameStats?.achievements;
    if (!Array.isArray(defs) || !defs.length) return json({ appid, defs: [] });
    const cut = (value, max) => (typeof value === 'string' ? value.slice(0, max) : undefined);
    const slim = defs.slice(0, 2000).map((def) => ({ name: cut(def.name, 120), displayName: cut(def.displayName, 160), description: cut(def.description, 400), hidden: def.hidden ? 1 : 0, icon: cut(def.icon, 300), icongray: cut(def.icongray, 300) }));
    const [player, global] = await Promise.all([
      steamApi(env, '/ISteamUserStats/GetPlayerAchievements/v1/', { steamid: steam, appid }),
      fetchImpl(`${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}&format=json`, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ]);
    const mine = player?.playerstats?.achievements;
    return json({
      appid, defs: slim, private: !Array.isArray(mine),
      mine: Array.isArray(mine) ? mine.slice(0, 2000).map((item) => ({ apiname: cut(item.apiname, 120), achieved: Number(item.achieved) === 1 ? 1 : 0, unlocktime: Number(item.unlocktime) || 0 })) : [],
      rarity: (global?.achievementpercentages?.achievements || []).slice(0, 2000).map((item) => ({ name: cut(item.name, 120), percent: Number(item.percent) || 0 }))
    });
  }

  /** Roteamento das rotas da Steam (null quando a rota não é daqui). */
  async function route(request, env, url, path, method) {
    if (method !== 'GET') return null;
    try {
      if (path === '/v1/steam/start') return start(url);
      if (path === '/v1/steam/back') return await back(url, env);
      if (path === '/v1/steam/me') return await me(request, env);
      if (path === '/v1/steam/library') return await library(request, env);
      if (path === '/v1/steam/achievements') return await achievements(request, env, url);
    } catch (error) {
      if (error instanceof SteamError) return json({ error: error.message }, error.status);
      throw error;
    }
    return null;
  }

  return { route };
}
