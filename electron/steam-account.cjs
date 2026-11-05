/*
 * Conta Steam deste PC, lida LOCALMENTE (sem senha, sem login, sem servidor):
 *  - config/loginusers.vdf: contas que já entraram na Steam neste PC (SteamID64, nome de perfil, a mais recente);
 *  - config/avatarcache/<steamid64>.png: a foto de perfil que a própria Steam guardou;
 *  - userdata/<accountid>/config/localconfig.vdf: tempo de jogo e última vez jogado de cada jogo.
 * Opcional: com uma chave da Steam Web API (da própria pessoa), lista também os jogos da conta que não estão instalados.
 */
const { parseVdf } = require('./games.cjs');

const STEAM64_BASE = 76561197960265728n;
const ID64 = /^7656119\d{10}$/;

function parseLoginUsers(text) {
  const users = parseVdf(text).users || {};
  return Object.entries(users).filter(([id]) => ID64.test(id)).map(([steamId, data]) => ({
    steamId, personaName: String(data.personaname || data.accountname || 'Steam').slice(0, 64), mostRecent: data.mostrecent === '1',
    timestamp: Number(data.timestamp) ? Number(data.timestamp) * 1000 : 0
  })).sort((a, b) => Number(b.mostRecent) - Number(a.mostRecent) || b.timestamp - a.timestamp);
}

const accountIdOf = (steamId) => String(BigInt(steamId) - STEAM64_BASE);

/** Tempo de jogo (minutos) e última vez jogado (ms) por appid, a partir do localconfig.vdf. */
function parseLocalConfig(text) {
  const root = parseVdf(text);
  const store = root.userlocalconfigstore || root;
  const apps = store?.software?.valve?.steam?.apps || {};
  const out = {};
  for (const [appid, data] of Object.entries(apps)) {
    if (!/^\d+$/.test(appid) || !data || typeof data !== 'object') continue;
    const playtime = Number(data.playtime);
    const last = Number(data.lastplayed);
    if (!Number.isFinite(playtime) && !Number.isFinite(last)) continue;
    out[appid] = { playtimeMin: Number.isFinite(playtime) ? playtime : null, lastPlayed: Number.isFinite(last) && last > 0 ? last * 1000 : null };
  }
  return out;
}

function createSteamAccount({ fs, path, fetchJson }) {
  async function detect(steamRoot) {
    if (!steamRoot) return { found: false, users: [] };
    let users = [];
    try { users = parseLoginUsers(await fs.readFile(path.join(steamRoot, 'config', 'loginusers.vdf'), 'utf8')); } catch { /* Steam sem login salvo */ }
    for (const user of users) {
      const avatar = path.join(steamRoot, 'config', 'avatarcache', `${user.steamId}.png`);
      user.avatarFile = await fs.stat(avatar).then(() => avatar).catch(() => null);
    }
    return { found: users.length > 0, users };
  }

  async function playtime(steamRoot, steamId) {
    if (!steamRoot || !ID64.test(String(steamId))) return {};
    try { return parseLocalConfig(await fs.readFile(path.join(steamRoot, 'userdata', accountIdOf(steamId), 'config', 'localconfig.vdf'), 'utf8')); } catch { return {}; }
  }

  /** Steam Web API (opcional, chave da própria pessoa): jogos da conta, inclusive não instalados. */
  async function ownedGames(key, steamId) {
    if (!/^[0-9A-F]{32}$/i.test(String(key)) || !ID64.test(String(steamId))) throw new Error('Chave da Steam Web API ou conta inválida.');
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
    const data = await fetchJson(url);
    const games = data?.response?.games;
    if (!Array.isArray(games)) throw new Error('A Steam não devolveu a lista. Confira se “Detalhes do jogo” está público no seu perfil.');
    return games.filter((game) => Number.isInteger(game.appid) && game.name).map((game) => ({
      appid: String(game.appid), name: String(game.name).slice(0, 120), playtimeMin: Number(game.playtime_forever) || 0, lastPlayed: Number(game.rtime_last_played) ? game.rtime_last_played * 1000 : null
    }));
  }

  return { detect, playtime, ownedGames };
}

module.exports = { createSteamAccount, parseLoginUsers, parseLocalConfig, accountIdOf, STEAM64_BASE };
