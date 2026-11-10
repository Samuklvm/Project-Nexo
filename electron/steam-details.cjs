/*
 * Dados completos de um jogo, como na loja da Steam: descrição, gêneros, desenvolvedora, lançamento, nota,
 * capturas de tela, requisitos, novidades e atualizações oficiais, e as SUAS conquistas.
 *  - Loja e novidades: endpoints públicos da Steam (sem chave).
 *  - Conquistas: Steam Web API com a chave da própria pessoa + perfil com "Detalhes do jogo" público.
 * Tudo passa pelo processo principal; respostas ficam em cache (loja 7 dias, novidades 3 h, conquistas 10 min).
 * Textos vindos da Steam são reduzidos a texto puro antes de chegar à interface.
 */
const TTL = { store: 7 * 24 * 3600e3, news: 3 * 3600e3, achievements: 10 * 60e3 };
const STEAM_IMAGE = /^https:\/\/([\w-]+\.)*(steamstatic\.com|akamaihd\.net)\//;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
/** HTML/BBCode da Steam → texto puro, com quebras de linha nos lugares certos. */
function toText(value, max = 2000) {
  let text = String(value || '')
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>|\[\/?(p|h\d|list|olist)\]|\[\*\]/gi, '\n')
    .replace(/\{STEAM_CLAN_IMAGE\}[^\s\]]*/g, '')
    .replace(/\[img\][\s\S]*?\[\/img\]|\[previewyoutube[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, '');
  // Remove marcações até não sobrar nenhuma (uma passada só deixaria restos como "<scr<b>ipt>").
  let previous;
  do { previous = text; text = text.replace(/<[^<>]*>|\[\/?[a-z][^\]]*\]/gi, ''); } while (text !== previous);
  return text
    .replace(/[<>]/g, '')
    .replace(/&(#?\w+);/g, (match, code) => ENTITIES[code] ?? match)
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim().slice(0, max);
}
const safeImage = (url) => (typeof url === 'string' && STEAM_IMAGE.test(url) ? url : null);

function parseAppDetails(data, appid) {
  const entry = data?.[String(appid)];
  if (!entry?.success || !entry.data) return null;
  const d = entry.data;
  const list = (items, key = 'description') => (Array.isArray(items) ? items.map((item) => String(item?.[key] || '')).filter(Boolean).slice(0, 12) : []);
  return {
    appid: String(appid), name: String(d.name || '').slice(0, 160), type: d.type, isFree: Boolean(d.is_free),
    description: toText(d.short_description, 600), about: toText(d.about_the_game, 2400),
    developers: Array.isArray(d.developers) ? d.developers.map(String).slice(0, 6) : [], publishers: Array.isArray(d.publishers) ? d.publishers.map(String).slice(0, 6) : [],
    genres: list(d.genres), categories: list(d.categories), release: d.release_date?.date ? String(d.release_date.date) : null, comingSoon: Boolean(d.release_date?.coming_soon),
    price: d.price_overview?.final_formatted || (d.is_free ? 'Gratuito' : null), metacritic: Number.isFinite(d.metacritic?.score) ? d.metacritic.score : null,
    recommendations: Number.isFinite(d.recommendations?.total) ? d.recommendations.total : null, achievementsTotal: Number.isFinite(d.achievements?.total) ? d.achievements.total : null,
    header: safeImage(d.header_image), background: safeImage(d.background_raw || d.background),
    screenshots: (Array.isArray(d.screenshots) ? d.screenshots : []).map((shot) => ({ thumb: safeImage(shot.path_thumbnail), full: safeImage(shot.path_full) })).filter((shot) => shot.thumb && shot.full).slice(0, 12),
    requirements: { minimum: toText(d.pc_requirements?.minimum, 1200) || null, recommended: toText(d.pc_requirements?.recommended, 1200) || null },
    platforms: d.platforms && typeof d.platforms === 'object' ? Object.keys(d.platforms).filter((key) => d.platforms[key]) : [],
    controller: d.controller_support || null, languages: toText(d.supported_languages, 400) || null
  };
}

const PATCH = /\b(patch|update|hotfix|atualiza|corre[cç][aã]o|notas? da vers|changelog|v?\d+\.\d+(\.\d+)?)\b/i;
function parseNews(data) {
  const items = Array.isArray(data?.appnews?.newsitems) ? data.appnews.newsitems : [];
  return items.slice(0, 12).map((item) => {
    const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
    const official = item.feedname === 'steam_community_announcements' || item.feed_type === 1;
    const isUpdate = tags.includes('patchnotes') || (official && PATCH.test(String(item.title)));
    return { id: String(item.gid || ''), title: toText(item.title, 160), date: Number(item.date) ? item.date * 1000 : null, author: toText(item.author, 60) || null,
      source: official ? 'Anúncio oficial' : toText(item.feedlabel, 60) || 'Notícia', kind: isUpdate ? 'atualizacao' : official ? 'anuncio' : 'noticia',
      summary: toText(item.contents, 420), url: /^https:\/\/(store\.steampowered\.com|steamcommunity\.com|steamstore-a\.akamaihd\.net)\//.test(item.url) ? item.url : null };
  }).filter((item) => item.title);
}

/** Junta o esquema (nomes e ícones), o progresso do jogador e a raridade global. */
function parseAchievements(schema, player, global) {
  const defs = schema?.game?.availableGameStats?.achievements;
  if (!Array.isArray(defs) || !defs.length) return { state: 'none', unlocked: 0, total: 0, list: [] };
  const mine = new Map((player?.playerstats?.achievements || []).map((item) => [item.apiname, item]));
  const rarity = new Map((global?.achievementpercentages?.achievements || []).map((item) => [item.name, Number(item.percent)]));
  const list = defs.map((def) => {
    const own = mine.get(def.name);
    const achieved = own?.achieved === 1;
    return { id: String(def.name), name: toText(def.displayName, 120) || def.name, description: def.hidden && !achieved ? null : toText(def.description, 240) || null, hidden: Boolean(def.hidden),
      achieved, unlockedAt: achieved && own.unlocktime ? own.unlocktime * 1000 : null, icon: safeImage(achieved ? def.icon : def.icongray) || safeImage(def.icon),
      percent: Number.isFinite(rarity.get(def.name)) ? Math.round(rarity.get(def.name) * 10) / 10 : null };
  });
  list.sort((a, b) => Number(b.achieved) - Number(a.achieved) || (b.unlockedAt || 0) - (a.unlockedAt || 0) || (b.percent ?? -1) - (a.percent ?? -1));
  const unlocked = list.filter((item) => item.achieved).length;
  return { state: 'ok', unlocked, total: list.length, list };
}

/** Resposta do servidor do Nexo ("Entrar com a Steam") → o mesmo formato de quando a pessoa usa a própria chave. */
function fromServer(data) {
  const defs = Array.isArray(data?.defs) ? data.defs : [];
  if (!defs.length) return { state: 'none', unlocked: 0, total: 0, list: [] };
  const schema = { game: { availableGameStats: { achievements: defs } } };
  if (data.private) return { ...parseAchievements(schema, null, null), state: 'private' };
  return parseAchievements(schema, { playerstats: { achievements: Array.isArray(data.mine) ? data.mine : [] } }, { achievementpercentages: { achievements: Array.isArray(data.rarity) ? data.rarity : [] } });
}

function createSteamDetails({ fetchJson, fs, path, cacheDir, now = Date.now }) {
  const memory = new Map();
  async function cached(key, ttl, load) {
    const hit = memory.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    const file = path.join(cacheDir, `${key.replace(/[^\w-]/g, '_')}.json`);
    try { const stored = JSON.parse(await fs.readFile(file, 'utf8')); if (now() - stored.at < ttl) { memory.set(key, stored); return stored.value; } } catch { /* sem cache */ }
    const value = await load();
    const record = { at: now(), value };
    memory.set(key, record);
    await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
    await fs.writeFile(file, JSON.stringify(record), 'utf8').catch(() => {});
    return value;
  }

  const store = (appid) => cached(`store-${appid}`, TTL.store, async () => parseAppDetails(await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=brazilian&cc=BR`), appid));
  const news = (appid) => cached(`news-${appid}`, TTL.news, async () => parseNews(await fetchJson(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=12&maxlength=1200&format=json`)));

  /** `viaServer`: com o "Entrar com a Steam", busca pelo servidor do Nexo (sem chave da pessoa). */
  async function achievements(appid, steamId, key, viaServer = null) {
    if (!steamId) return { state: 'needs-steam', unlocked: 0, total: 0, list: [] };
    if (!key && viaServer) return cached(`ach-${steamId}-${appid}`, TTL.achievements, async () => fromServer(await viaServer(appid)));
    if (!key) return { state: 'needs-key', unlocked: 0, total: 0, list: [] };
    return cached(`ach-${steamId}-${appid}`, TTL.achievements, async () => {
      const base = 'https://api.steampowered.com/ISteamUserStats';
      const schema = await fetchJson(`${base}/GetSchemaForGame/v2/?key=${key}&appid=${appid}&l=brazilian`).catch(() => null);
      if (!schema?.game?.availableGameStats?.achievements?.length) return { state: 'none', unlocked: 0, total: 0, list: [] };
      let player = null;
      try { player = await fetchJson(`${base}/GetPlayerAchievements/v1/?key=${key}&steamid=${steamId}&appid=${appid}`); }
      catch { return { ...parseAchievements(schema, null, null), state: 'private' }; }
      const global = await fetchJson(`${base}/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`).catch(() => null);
      return parseAchievements(schema, player, global);
    });
  }

  /** Para jogos de outras lojas: acha o mesmo jogo na Steam pelo nome EXATO (sem "parecido"). */
  const findAppid = (name, exact) => cached(`match-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`, TTL.store, async () => {
    const data = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(String(name).slice(0, 80))}&l=english&cc=US`);
    return exact(data, name);
  });

  return { store, news, achievements, findAppid };
}

module.exports = { fromServer, createSteamDetails, parseAppDetails, parseNews, parseAchievements, toText, safeImage, TTL };
