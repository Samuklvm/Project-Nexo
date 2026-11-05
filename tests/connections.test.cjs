const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const Steam = require('../electron/steam-account.cjs');
const Covers = require('../electron/covers.cjs');
const Xbox = require('../electron/xbox.cjs');
const Discord = require('../electron/discord.cjs');
const Games = require('../electron/games.cjs');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2000, 7)]);

test('Steam local: contas do loginusers.vdf, conta mais recente primeiro, e tempo de jogo do localconfig.vdf', () => {
  const users = Steam.parseLoginUsers(`"users" { "76561198000000001" { "AccountName" "a" "PersonaName" "Antigo" "MostRecent" "0" "Timestamp" "100" } "76561198000000002" { "AccountName" "b" "PersonaName" "Atual" "MostRecent" "1" "Timestamp" "50" } "123" { "PersonaName" "lixo" } }`);
  assert.deepEqual(users.map((user) => user.personaName), ['Atual', 'Antigo']);
  assert.equal(Steam.accountIdOf('76561198000000002'), String(76561198000000002n - 76561197960265728n));
  const playtime = Steam.parseLocalConfig(`"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "570" { "LastPlayed" "1700000000" "Playtime" "1234" } "abc" { "Playtime" "1" } } } } } }`);
  assert.deepEqual(playtime, { 570: { playtimeMin: 1234, lastPlayed: 1700000000000 } });
});

test('Steam Web API: valida chave e conta antes de chamar e interpreta a lista', async () => {
  const urls = [];
  const account = Steam.createSteamAccount({ fs: fsp, path, fetchJson: async (url) => { urls.push(url); return { response: { games: [{ appid: 10, name: 'Jogo', playtime_forever: 90, rtime_last_played: 1700000000 }, { appid: 'x' }] } }; } });
  await assert.rejects(account.ownedGames('naoehex', '76561198000000002'));
  const games = await account.ownedGames('0123456789ABCDEF0123456789ABCDEF', '76561198000000002');
  assert.deepEqual(games, [{ appid: '10', name: 'Jogo', playtimeMin: 90, lastPlayed: 1700000000000 }]);
  assert.match(urls[0], /^https:\/\/api\.steampowered\.com\/IPlayerService\/GetOwnedGames\/v1\//);
});

test('capas oficiais: nome exato, sem "parecido", e arte da Microsoft só do domínio oficial', () => {
  assert.equal(Covers.normalizeName('ELDEN RING™'), 'elden ring');
  assert.equal(Covers.normalizeName('Ratchet & Clank: Rift Apart'), 'ratchet and clank rift apart');
  const search = { items: [{ type: 'app', id: 1, name: 'Hades II' }, { type: 'app', id: 2, name: 'Hades' }] };
  assert.equal(Covers.exactSteamMatch(search, 'HADES'), '2');
  assert.equal(Covers.exactSteamMatch(search, 'Hades III'), null);
  const product = { LocalizedProperties: [{ Images: [{ ImagePurpose: 'Logo', Uri: '//store-images.s-microsoft.com/logo' }, { ImagePurpose: 'BoxArt', Uri: '//store-images.s-microsoft.com/box', Width: 1080 }, { ImagePurpose: 'Poster', Uri: '//store-images.s-microsoft.com/poster', Width: 720 }] }] };
  assert.equal(Covers.pickMicrosoftImage(product), 'https://store-images.s-microsoft.com/poster');
  assert.equal(Covers.pickMicrosoftImage({ LocalizedProperties: [{ Images: [{ ImagePurpose: 'Poster', Uri: 'https://evil.example/x.jpg' }] }] }), null);
  assert.equal(Covers.isImage(Buffer.from('<html>')), null);
  assert.equal(Covers.isImage(JPEG), 'jpg');
});

test('resolvedor: Steam pelo número, Xbox pelo StoreId, outras lojas pelo nome exato na Steam', async () => {
  const saved = [];
  const fetched = [];
  const resolver = Covers.createCoverResolver({
    fetchBytes: async (url) => { fetched.push(url); if (/library_600x900_2x|library_hero/.test(url) && url.includes('shared.cloudflare')) return JPEG; if (/logo\.png/.test(url)) return PNG; if (/store-images/.test(url)) return JPEG; throw new Error('404'); },
    fetchJson: async (url) => (url.includes('displaycatalog') ? { Products: [{ LocalizedProperties: [{ Images: [{ ImagePurpose: 'Poster', Uri: '//store-images.s-microsoft.com/image/apps.1' }] }] }] } : { items: [{ type: 'app', id: 42, name: 'Hollow Signal' }] }),
    save: async (id, kind) => { saved.push(`${id}:${kind}`); return `/covers/${id}-${kind}`; }
  });
  const steam = await resolver.resolve({ id: 'steam-1', source: 'steam', appid: '1', name: 'X' });
  assert.equal(steam.source, 'capa oficial da Steam');
  assert.ok(steam.hero && steam.logo);
  const xbox = await resolver.resolve({ id: 'xbox-f', source: 'xbox', storeId: '9NKX70BBCDRN', name: 'Forza' });
  assert.equal(xbox.source, 'capa oficial da Microsoft Store');
  const epic = await resolver.resolve({ id: 'epic-h', source: 'epic', name: 'Hollow Signal' });
  assert.equal(epic.matchedAppid, '42');
  assert.equal(await resolver.resolve({ id: 'gog-z', source: 'gog', name: 'Sem Par' }), null, 'sem correspondência exata, sem capa');
  assert.ok(fetched.every((url) => /^https:\/\/(shared\.cloudflare\.steamstatic\.com|cdn\.cloudflare\.steamstatic\.com|store-images\.s-microsoft\.com)\//.test(url)));
});

test('Xbox: histórico de títulos com arte oficial, apps fora, domínios conferidos', () => {
  const titles = Xbox.parseTitleHistory({ titles: [
    { titleId: '123', name: 'Forza Horizon 5', type: 'Game', devices: ['PC', 'XboxSeries'], titleHistory: { lastTimePlayed: '2026-10-01T10:00:00Z' }, images: [{ type: 'Logo', url: 'https://store-images.s-microsoft.com/l' }, { type: 'BoxArt', url: 'https://store-images.s-microsoft.com/b' }] },
    { titleId: '9', name: 'Netflix', type: 'App' },
    { titleId: '7', name: 'Jogo', type: 'Game', displayImage: 'https://evil.example/x.png' }] });
  assert.equal(titles.length, 2);
  assert.equal(titles[0].image, 'https://store-images.s-microsoft.com/b');
  assert.equal(titles[0].lastPlayed, Date.parse('2026-10-01T10:00:00Z'));
  assert.equal(titles[1].image, null);
  assert.deepEqual(Xbox.parseProfile({ profileUsers: [{ settings: [{ id: 'Gamertag', value: 'Estrela' }, { id: 'GameDisplayPicRaw', value: 'https://images-eds-ssl.xboxlive.com/p' }] }] }), { gamertag: 'Estrela', picture: 'https://images-eds-ssl.xboxlive.com/p' });
  const url = new URL(Xbox.buildMicrosoftUrl({ clientId: '00000000-0000-0000-0000-000000000000', redirectUri: 'http://localhost:5000', challenge: 'c', state: 's' }));
  assert.equal(url.searchParams.get('scope'), 'XboxLive.signin');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('Xbox: login de ponta a ponta (loopback real, Microsoft e Xbox Live simulados) sem guardar tokens', async () => {
  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push(new URL(url).host);
    const reply = (body) => ({ ok: true, json: async () => body });
    if (url.includes('/token')) { assert.ok(new URLSearchParams(init.body).get('code_verifier')); return reply({ access_token: 'ms' }); }
    if (url.includes('user.auth')) { assert.equal(JSON.parse(init.body).Properties.RpsTicket, 'd=ms'); return reply({ Token: 'u' }); }
    if (url.includes('xsts')) return reply({ Token: 'x', DisplayClaims: { xui: [{ uhs: 'h', xid: '2535' }] } });
    if (url.includes('profile.xboxlive')) { assert.equal(init.headers.Authorization, 'XBL3.0 x=h;x'); return reply({ profileUsers: [{ settings: [{ id: 'Gamertag', value: 'Estrela' }] }] }); }
    if (url.includes('titlehub')) return reply({ titles: [{ titleId: '1', name: 'Halo', type: 'Game', images: [{ type: 'BoxArt', url: 'https://store-images.s-microsoft.com/h' }] }] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const openExternal = async (authUrl) => {
    const params = new URL(authUrl).searchParams;
    const redirect = params.get('redirect_uri').replace('localhost', '127.0.0.1');
    setTimeout(() => http.get(`${redirect}/?code=abc&state=${encodeURIComponent(params.get('state'))}`, (response) => response.resume()), 10);
  };
  const result = await Xbox.signIn({ clientId: '00000000-0000-0000-0000-000000000000', createServer: http.createServer, openExternal, fetch });
  assert.equal(result.profile.gamertag, 'Estrela');
  assert.equal(result.titles[0].name, 'Halo');
  assert.equal(JSON.stringify(result).includes('ms'), false, 'nenhum token volta para quem chamou');
  assert.deepEqual([...new Set(seen)].sort(), ['login.microsoftonline.com', 'profile.xboxlive.com', 'titlehub.xboxlive.com', 'user.auth.xboxlive.com', 'xsts.auth.xboxlive.com']);
  await assert.rejects(Xbox.signIn({ clientId: 'x' }), /não foi configurada/);
});

test('Discord: quadros do protocolo local, handshake e atividade limitada', async () => {
  const frame = Discord.encode(1, { cmd: 'X' });
  const { frames, rest } = Discord.decode(Buffer.concat([frame, frame.subarray(0, 5)]));
  assert.equal(frames.length, 1);
  assert.equal(rest.length, 5);
  const activity = Discord.buildActivity({ details: 'x'.repeat(300), startedAt: 1700000000123 });
  assert.equal(activity.details.length, 128);
  assert.equal(activity.timestamps.start, 1700000000);

  const written = [];
  const connect = (pipe) => {
    const socket = new EventEmitter();
    socket.write = (buffer) => { written.push(Discord.decode(buffer).frames[0]); if (written.length === 1) setImmediate(() => socket.emit('data', Discord.encode(1, { evt: 'READY' }))); };
    socket.end = () => {}; socket.destroy = () => {};
    setImmediate(() => (pipe.endsWith('-0') ? socket.emit('error', new Error('ENOENT')) : socket.emit('connect')));
    return socket;
  };
  const client = Discord.createDiscord({ connect, platform: 'win32', pid: 7 });
  await assert.rejects(client.setActivity('abc', { details: 'x' }), /Application ID/);
  await client.setActivity('123456789012345678', { details: 'Jogando Hades' });
  assert.deepEqual(written[0], { op: 0, data: { v: 1, client_id: '123456789012345678' } });
  assert.equal(written[1].data.cmd, 'SET_ACTIVITY');
  assert.equal(written[1].data.args.pid, 7);
  assert.equal(written[1].data.args.activity.details, 'Jogando Hades');
});

test('biblioteca completa: arte local da Steam, tempo de jogo, jogos da conta não instalados e artes do Xbox', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-steam-'));
  const apps = path.join(root, 'steamapps');
  fs.mkdirSync(path.join(apps, 'common', 'Hades'), { recursive: true });
  fs.writeFileSync(path.join(apps, 'appmanifest_1145360.acf'), '"AppState" { "appid" "1145360" "name" "Hades" "StateFlags" "4" "installdir" "Hades" "SizeOnDisk" "100" "LastPlayed" "1600000000" }');
  const cache = path.join(root, 'appcache', 'librarycache', '1145360', 'abc123');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'library_600x900.jpg'), JPEG);
  fs.writeFileSync(path.join(cache, 'library_hero.jpg'), JPEG);
  fs.writeFileSync(path.join(cache, 'logo.png'), PNG);
  const coversDir = path.join(root, 'covers');
  const library = Games.createLibrary({
    fs: fsp, path, platform: 'win32', coversDir, manualFile: path.join(root, 'manual.json'), env: { ProgramData: path.join(root, 'pd') },
    runPowerShell: async () => ({ stdout: JSON.stringify({ steam: root, drives: [] }) }),
    extras: async () => ({ steamPlaytime: { 1145360: { playtimeMin: 4200, lastPlayed: 1700000000000 } }, steamOwned: [{ appid: '620', name: 'Portal 2', playtimeMin: 600 }, { appid: '1145360', name: 'Hades', playtimeMin: 4300 }],
      xboxTitles: [{ titleId: '5', name: 'HADES', image: 'https://store-images.s-microsoft.com/h' }, { titleId: '6', name: 'Halo Infinite', image: null, lastPlayed: 5 }] })
  });
  const list = await library.scan();
  const hades = list.find((game) => game.id === 'steam-1145360');
  assert.equal(hades.installed, true);
  assert.equal(hades.playtimeMin, 4300);
  assert.equal(hades.lastPlayed, 1700000000000);
  assert.match(hades.cover, /steam-1145360\.jpg$/);
  assert.match(hades.hero, /steam-1145360-hero\.jpg$/);
  assert.match(hades.logo, /steam-1145360-logo\.png$/);
  assert.equal(hades.coverSource, 'capa oficial (cache da Steam)');
  const portal = list.find((game) => game.id === 'steam-620');
  assert.equal(portal.installed, false);
  assert.equal(portal.fromAccount, 'steam');
  assert.ok(list.find((game) => game.name === 'Halo Infinite' && game.source === 'xboxconta'));
  assert.equal(list.filter((game) => /hades/i.test(game.name)).length, 1, 'o mesmo jogo não aparece duas vezes');
  assert.equal(list.findIndex((game) => !game.installed) > list.findIndex((game) => game.installed), true, 'instalados primeiro');
  assert.equal(library.matchPath(path.join(apps, 'common', 'Hades', 'Hades.exe'))?.id, 'steam-1145360');
});

test('página do jogo: loja da Steam vira texto puro, só imagens da CDN da Steam', () => {
  const Details = require('../electron/steam-details.cjs');
  const store = Details.parseAppDetails({ 10: { success: true, data: { name: 'Hades', short_description: 'Lute para sair do <b>Submundo</b> &amp; mais', developers: ['Supergiant Games'], genres: [{ description: 'Ação' }], release_date: { date: '17 set. 2020' },
    metacritic: { score: 93 }, recommendations: { total: 250000 }, achievements: { total: 49 }, screenshots: [{ path_thumbnail: 'https://shared.akamai.steamstatic.com/a.jpg', path_full: 'https://shared.akamai.steamstatic.com/b.jpg' }, { path_thumbnail: 'https://evil.example/x.jpg', path_full: 'https://evil.example/y.jpg' }],
    pc_requirements: { minimum: '<strong>Mínimos:</strong><br><ul class="bb_ul"><li><strong>SO:</strong> Windows 7<br></li></ul>' } } } }, 10);
  assert.equal(store.description, 'Lute para sair do Submundo & mais');
  assert.equal(store.screenshots.length, 1);
  assert.deepEqual(store.genres, ['Ação']);
  assert.equal(store.metacritic, 93);
  assert.match(store.requirements.minimum, /SO: Windows 7/);
  assert.doesNotMatch(store.requirements.minimum, /</);
  assert.equal(Details.parseAppDetails({ 10: { success: false } }, 10), null);
});

test('novidades: atualizações oficiais marcadas, links só da Steam', () => {
  const Details = require('../electron/steam-details.cjs');
  const news = Details.parseNews({ appnews: { newsitems: [
    { gid: '1', title: 'Patch 1.2.3 Notes', feedname: 'steam_community_announcements', date: 1700000000, contents: '[h1]Correções[/h1][list][*]Menos travadas[/list]{STEAM_CLAN_IMAGE}/x.png', url: 'https://steamcommunity.com/games/10/announcements/detail/1', tags: ['patchnotes'] },
    { gid: '2', title: 'Evento de inverno', feedname: 'steam_community_announcements', date: 1700000100, contents: 'Novidades', url: 'https://steamstore-a.akamaihd.net/news/externalpost/x' },
    { gid: '3', title: 'Análise', feedname: 'pcgamer', feedlabel: 'PC Gamer', date: 1700000200, contents: 'Texto', url: 'https://evil.example/n' }] } });
  assert.deepEqual(news.map((item) => item.kind), ['atualizacao', 'anuncio', 'noticia']);
  assert.match(news[0].summary, /Correções\n+Menos travadas/);
  assert.equal(news[2].url, null);
  assert.equal(news[2].source, 'PC Gamer');
});

test('conquistas: desbloqueadas primeiro com data, ocultas sem spoiler, raridade global', async () => {
  const Details = require('../electron/steam-details.cjs');
  const schema = { game: { availableGameStats: { achievements: [
    { name: 'A', displayName: 'Primeira', description: 'Comece', icon: 'https://cdn.akamai.steamstatic.com/a.jpg', icongray: 'https://cdn.akamai.steamstatic.com/ag.jpg' },
    { name: 'B', displayName: 'Segredo', description: 'Final verdadeiro', hidden: 1, icon: 'https://cdn.akamai.steamstatic.com/b.jpg', icongray: 'https://cdn.akamai.steamstatic.com/bg.jpg' }] } } };
  const result = Details.parseAchievements(schema, { playerstats: { achievements: [{ apiname: 'A', achieved: 1, unlocktime: 1700000000 }, { apiname: 'B', achieved: 0, unlocktime: 0 }] } }, { achievementpercentages: { achievements: [{ name: 'A', percent: '81.23' }, { name: 'B', percent: 2.5 }] } });
  assert.equal(result.unlocked, 1);
  assert.equal(result.total, 2);
  assert.equal(result.list[0].unlockedAt, 1700000000000);
  assert.equal(result.list[0].percent, 81.2);
  assert.equal(result.list[1].description, null, 'conquista oculta não revela o texto');
  assert.match(result.list[1].icon, /bg\.jpg$/);

  const fsMem = new Map();
  const fs = { readFile: async (file) => { if (!fsMem.has(file)) throw new Error('x'); return fsMem.get(file); }, writeFile: async (file, data) => { fsMem.set(file, data); }, mkdir: async () => {} };
  const calls = [];
  const details = Details.createSteamDetails({ fs, path: require('node:path'), cacheDir: '/c', fetchJson: async (url) => { calls.push(url); if (url.includes('GetPlayerAchievements')) throw new Error('HTTP 403'); return schema; } });
  assert.equal((await details.achievements('10', null, null)).state, 'needs-steam');
  assert.equal((await details.achievements('10', '76561198000000002', null)).state, 'needs-key');
  const privateProfile = await details.achievements('10', '76561198000000002', 'K');
  assert.equal(privateProfile.state, 'private');
  await details.achievements('10', '76561198000000002', 'K');
  assert.equal(calls.length, 2, 'a segunda leitura sai do cache');
});

test('textos da Steam: marcações aninhadas não deixam restos de HTML', () => {
  const { toText } = require('../electron/steam-details.cjs');
  assert.equal(toText('<scr<b>ipt>alert(1)</script>oi'), 'alert(1)oi');
  assert.equal(toText('Precisa de &lt; 4 GB<br>e <b>DirectX</b> 12'), 'Precisa de < 4 GB\ne DirectX 12');
  assert.doesNotMatch(toText('<<img src=x onerror=1>>texto'), /[<>]/);
});
