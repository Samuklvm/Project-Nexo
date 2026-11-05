/*
 * Capas OFICIAIS dos jogos (opcional; só com "Buscar capas oficiais" ligado).
 * Só fontes das próprias lojas — nada de arte de fã:
 *  1. Steam: a capa vertical oficial da página do jogo (CDN da Valve), pelo número do jogo;
 *  2. Microsoft Store / Xbox: a arte "Poster"/"BoxArt" do catálogo público da Microsoft, pelo StoreId do jogo
 *     (ou a imagem que a conta Xbox informar);
 *  3. Jogos de outras lojas: procura o MESMO nome na loja da Steam e só aceita correspondência exata
 *     (sem "parecido"), para não colocar a capa errada.
 * Toda imagem é conferida (formato, tamanho), reduzida para o tamanho exibido (poupa memória em PCs fracos) e guardada.
 */
const STEAM_CDN = ['https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps', 'https://cdn.cloudflare.steamstatic.com/steam/apps'];
const MAX_BYTES = 6 * 1024 * 1024;

/** Nome comparável: sem marcas registradas, acentos, pontuação e espaços repetidos. */
function normalizeName(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function isImage(bytes) {
  if (!bytes || bytes.length < 512 || bytes.length > MAX_BYTES) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Escolhe a melhor arte vertical do catálogo da Microsoft (Poster > BoxArt), maior primeiro. */
function pickMicrosoftImage(product) {
  const images = product?.LocalizedProperties?.[0]?.Images || [];
  const rank = { Poster: 0, BoxArt: 1 };
  const candidates = images.filter((image) => image && typeof image.Uri === 'string' && rank[image.ImagePurpose] !== undefined)
    .sort((a, b) => rank[a.ImagePurpose] - rank[b.ImagePurpose] || (b.Width || 0) - (a.Width || 0));
  const uri = candidates[0]?.Uri;
  if (!uri) return null;
  const full = uri.startsWith('//') ? `https:${uri}` : uri;
  return /^https:\/\/store-images\.s-microsoft\.com\//.test(full) ? full : null;
}

/** Na busca da loja Steam, aceita só o item com o mesmo nome normalizado. */
function exactSteamMatch(searchResult, name) {
  const wanted = normalizeName(name);
  const items = Array.isArray(searchResult?.items) ? searchResult.items : [];
  const hit = items.find((item) => item?.type === 'app' && Number.isInteger(item.id) && normalizeName(item.name) === wanted);
  return hit ? String(hit.id) : null;
}

function createCoverResolver({ fetchBytes, fetchJson, save, market = 'BR', language = 'pt-br' }) {
  async function steamAsset(appid, file) {
    for (const base of STEAM_CDN) {
      const bytes = await fetchBytes(`${base}/${appid}/${file}`).catch(() => null);
      if (isImage(bytes)) return bytes;
    }
    return null;
  }

  async function steamArt(appid) {
    const cover = (await steamAsset(appid, 'library_600x900_2x.jpg')) || (await steamAsset(appid, 'library_600x900.jpg'));
    const hero = await steamAsset(appid, 'library_hero.jpg');
    const logo = await steamAsset(appid, 'logo.png');
    return { cover, hero, logo, source: 'capa oficial da Steam' };
  }

  async function microsoftArt(storeId) {
    if (!/^[0-9A-Z]{12}$/.test(String(storeId))) return null;
    const data = await fetchJson(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${storeId}&market=${market}&languages=${language}`).catch(() => null);
    const url = pickMicrosoftImage(data?.Products?.[0]);
    if (!url) return null;
    const bytes = await fetchBytes(`${url}?w=600`).catch(() => null);
    return isImage(bytes) ? { cover: bytes, source: 'capa oficial da Microsoft Store' } : null;
  }

  async function steamByName(name) {
    const term = encodeURIComponent(String(name).slice(0, 80));
    const data = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${term}&l=english&cc=US`).catch(() => null);
    const appid = exactSteamMatch(data, name);
    return appid ? { appid, ...(await steamArt(appid)) } : null;
  }

  /** Resolve e guarda. Devolve { cover, hero, logo, source } com os caminhos salvos (ou null). */
  async function resolve(game) {
    let art = null;
    if (game.source === 'steam' && game.appid) art = await steamArt(game.appid);
    if (!art?.cover && game.xboxImage) {
      const bytes = await fetchBytes(game.xboxImage).catch(() => null);
      if (isImage(bytes)) art = { cover: bytes, source: 'capa oficial do Xbox' };
    }
    if (!art?.cover && game.storeId) art = await microsoftArt(game.storeId);
    if (!art?.cover && game.source !== 'steam') art = await steamByName(game.name);
    if (!art?.cover) return null;
    const out = { source: art.source, matchedAppid: art.appid || null };
    out.cover = await save(game.id, 'cover', art.cover);
    if (art.hero) out.hero = await save(game.id, 'hero', art.hero);
    if (art.logo) out.logo = await save(game.id, 'logo', art.logo);
    return out;
  }

  return { resolve, steamArt, microsoftArt, steamByName };
}

module.exports = { createCoverResolver, normalizeName, isImage, pickMicrosoftImage, exactSteamMatch, STEAM_CDN };
