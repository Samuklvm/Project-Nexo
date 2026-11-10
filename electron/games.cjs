/*
 * Biblioteca de jogos: encontra o que está instalado em Steam, Epic, GOG, Ubisoft, EA, Battle.net, Riot,
 * Rockstar, Xbox (pasta XboxGames) e entradas de desinstalação de editoras de jogos, mais os jogos que a pessoa
 * adicionar à mão.
 *  - Só LÊ manifestos, o Registro e pastas. Não abre jogos, não lê memória de processos, não fala com servidores.
 *  - Capas: primeiro o cache LOCAL do próprio launcher (a Steam guarda as capas em appcache/librarycache; os jogos
 *    da Xbox trazem as imagens na pasta Content). Baixar capas da CDN da Steam é opcional e vem desligado.
 *  - Caminhos de instalação e de executáveis ficam no processo principal; a interface recebe só nome, origem,
 *    tamanho, última vez jogado e a capa já copiada para a pasta de dados do Nexo.
 */
const LAUNCHER_NAMES = /^(steam|steamworks common redistributables|epic games launcher|epic online services|ea app|ea desktop|origin|battle\.net|riot client|riot vanguard|ubisoft connect|uplay|gog galaxy|rockstar games launcher|rockstar games social club|xbox|gaming services|microsoft gameinput|nvidia app|geforce experience|amd software|directx|microsoft visual c\+\+.*|vulkan run ?time.*|easy ?anti-?cheat.*|battleye.*|punkbuster.*|physx.*)$/i;
const NOT_A_GAME = /redistributable|^proton\b|steam linux runtime|steamvr|dedicated server|\bsdk\b|soundtrack|benchmark tool|^steamworks|bonus content|\bartbook\b|\bart book\b|digital extras|season pass/i;
/** Programas da Steam que não são jogos: aparecem em “Apps”, fora dos destaques e da gravação automática. */
const STEAM_APPS = new Set(['431960', '629520', '993090', '1905180', '365670', '1840', '1250410', '388080', '1454400', '774361', '440900', '607380', '1066780']);
const APP_NAMES = /^(wallpaper engine|soundpad|lossless scaling|obs studio|blender|source filmmaker|rpg maker|aseprite|fpsvr|steam deck|krita|voicemod|tabletop simulator workshop)/i;
const GAME_PUBLISHERS = /(electronic arts|riot games|blizzard|rockstar games|ubisoft|bethesda|mojang|activision|bandai namco|cd projekt|square enix|\bsega\b|capcom|wargaming|garena|mihoyo|hoyoverse|krafton|nexon|grinding gear|digital extremes|hi-rez|innersloth|paradox interactive|focus entertainment|2k games|take-two|warner bros\. games|devolver|team17|ea swiss|respawn|bungie|epic games, inc\.)/i;
const GAME_FOLDER = [/\\steamapps\\common\\/i, /\\epic games\\(?!launcher)/i, /\\gog galaxy\\games\\/i, /\\gog games\\/i, /\\riot games\\/i,
  /\\ubisoft game launcher\\games\\/i, /\\ea games\\/i, /\\origin games\\/i, /\\xboxgames\\/i, /\\rockstar games\\(?!launcher)/i];
const SOURCE_LABEL = { steam: 'Steam', epic: 'Epic Games', gog: 'GOG', ubisoft: 'Ubisoft', xbox: 'Xbox', ea: 'EA', battlenet: 'Battle.net', riot: 'Riot', rockstar: 'Rockstar', outro: 'Instalado', manual: 'Adicionado por você', xboxconta: 'Conta Xbox' };

/* ---------- VDF/ACF da Steam (chave-valor com aspas e chaves) ---------- */
function parseVdf(text) {
  const tokens = [];
  const source = String(text);
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') {
      let value = '';
      for (i += 1; i < source.length && source[i] !== '"'; i += 1) {
        if (source[i] === '\\' && i + 1 < source.length) { i += 1; value += source[i] === 'n' ? '\n' : source[i]; } else value += source[i];
      }
      tokens.push({ s: value });
    } else if (ch === '{' || ch === '}') tokens.push({ b: ch });
    else if (ch === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i += 1; }
  }
  let index = 0;
  const readObject = () => {
    const object = {};
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.b === '}') { index += 1; return object; }
      if (token.s === undefined) { index += 1; continue; }
      const key = token.s.toLowerCase();
      index += 1;
      const next = tokens[index];
      if (!next) break;
      if (next.b === '{') { index += 1; object[key] = readObject(); } else { object[key] = next.s; index += 1; }
    }
    return object;
  };
  return readObject();
}

/** Caminhos do Windows com "/" (a Steam grava assim) viram "\\"; outros ficam como estão. */
const winPath = (value) => (/^[a-z]:[\\/]/i.test(String(value)) ? String(value).replace(/\\\\/g, '\\').replace(/\//g, '\\') : String(value));

function steamLibraries(vdfText, steamRoot) {
  const parsed = parseVdf(vdfText);
  const root = parsed.libraryfolders || parsed;
  const paths = new Set([steamRoot]);
  for (const value of Object.values(root || {})) {
    if (typeof value === 'string') { if (/^[a-z]:[\\/]/i.test(value)) paths.add(value); continue; }
    if (value && typeof value.path === 'string') paths.add(value.path);
  }
  return [...paths].filter(Boolean).map(winPath);
}

function parseAppManifest(text) {
  const state = parseVdf(text).appstate;
  if (!state || !state.appid || !state.name) return null;
  if (state.appid === '228980' || NOT_A_GAME.test(state.name)) return null;
  const flags = Number(state.stateflags) || 0;
  const appid = String(state.appid).replace(/\D/g, '');
  return { appid, name: state.name.trim(), kind: STEAM_APPS.has(appid) || APP_NAMES.test(state.name.trim()) ? 'app' : 'game', installdir: state.installdir || '', sizeBytes: Number(state.sizeondisk) || 0,
    lastPlayed: Number(state.lastplayed) ? Number(state.lastplayed) * 1000 : null, installed: (flags & 4) === 4 || flags === 0 };
}

function parseEpicManifest(text) {
  let item;
  try { item = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { return null; }
  if (!item || !item.DisplayName || !item.InstallLocation || item.bIsIncompleteInstall) return null;
  if (item.MainGameAppName && item.AppName && item.MainGameAppName !== item.AppName) return null; // DLC
  if (Array.isArray(item.AppCategories) && item.AppCategories.length && !item.AppCategories.includes('games')) return null;
  return { name: String(item.DisplayName).trim(), installDir: item.InstallLocation, exe: item.LaunchExecutable ? `${item.InstallLocation}\\${item.LaunchExecutable}`.replace(/\//g, '\\') : null,
    appName: item.AppName, namespace: item.CatalogNamespace, catalogItemId: item.CatalogItemId, sizeBytes: Number(item.InstallSize) || 0 };
}

/** MicrosoftGame.config (jogos do app Xbox / Game Pass instalados em X:\XboxGames). */
function parseMicrosoftGameConfig(text) {
  const source = String(text);
  const attr = (tag, name) => { const element = source.match(new RegExp(`<${tag}\\b[^>]*>`, 'i')); if (!element) return null; const value = element[0].match(new RegExp(`\\b${name}="([^"]*)"`, 'i')); return value ? value[1] : null; };
  const display = attr('ShellVisuals', 'DefaultDisplayName');
  const exe = attr('Executable', 'Name');
  const logo = attr('ShellVisuals', 'Square480x480Logo') || attr('ShellVisuals', 'Square150x150Logo') || attr('ShellVisuals', 'StoreLogo');
  const storeId = (source.match(/<StoreId>\s*([0-9A-Z]{12})\s*<\/StoreId>/i) || [])[1] || null;
  return { name: display && !/^ms-resource:/i.test(display) ? display.trim() : null, exe, logo, identity: attr('Identity', 'Name'), storeId: storeId ? storeId.toUpperCase() : null };
}

/** Classifica entradas de desinstalação: editora de jogos ou pasta de biblioteca, nunca launcher/redistribuível. */
function classifyUninstall(entry) {
  const name = String(entry.DisplayName || '').trim();
  if (!name || LAUNCHER_NAMES.test(name) || NOT_A_GAME.test(name) || entry.SystemComponent === 1) return null;
  const location = String(entry.InstallLocation || '').trim();
  const publisher = String(entry.Publisher || '');
  const byFolder = location && GAME_FOLDER.some((pattern) => pattern.test(`${location}\\`));
  if (!byFolder && !GAME_PUBLISHERS.test(publisher)) return null;
  if (!location) return null;
  let source = 'outro';
  if (/electronic arts|\bea\b|respawn/i.test(publisher) || /\\ea games\\|\\origin games\\/i.test(location)) source = 'ea';
  else if (/blizzard/i.test(publisher)) source = 'battlenet';
  else if (/riot/i.test(publisher) || /\\riot games\\/i.test(location)) source = 'riot';
  else if (/rockstar/i.test(publisher)) source = 'rockstar';
  else if (/ubisoft/i.test(publisher)) source = 'ubisoft';
  else if (/\\epic games\\/i.test(location)) return null; // já vem pelos manifestos da Epic
  else if (/\\steamapps\\/i.test(location)) return null; // já vem pela Steam
  const icon = String(entry.DisplayIcon || '').replace(/^"|"(,\s*-?\d+)?$/g, '').replace(/,\s*-?\d+$/, '');
  return { name, installDir: location.replace(/\\$/, ''), exe: /\.exe$/i.test(icon) ? icon : null, source, sizeBytes: Number(entry.EstimatedSize) ? Number(entry.EstimatedSize) * 1024 : 0 };
}

const slug = (value) => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
const hueOf = (value) => { let hash = 0; for (const ch of String(value)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; return hash % 360; };

/** Junta as fontes, remove duplicados (o mesmo jogo em duas fontes) e ordena por última vez jogado e nome. */
function mergeGames(lists) {
  const byName = new Map();
  const priority = { steam: 0, epic: 1, gog: 2, xbox: 3, ubisoft: 4, ea: 5, battlenet: 6, riot: 7, rockstar: 8, outro: 9, manual: 10, xboxconta: 11 };
  for (const game of lists.flat()) {
    if (!game || !game.name) continue;
    const key = slug(game.name);
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing || priority[game.source] < priority[existing.source]) byName.set(key, { ...existing, ...game, lastPlayed: game.lastPlayed || existing?.lastPlayed || null });
  }
  return [...byName.values()].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name, 'pt-BR'));
}

/** O que a interface pode ver de um jogo. */
function publicView(game) {
  return { id: game.id, name: game.name, source: game.source, sourceLabel: SOURCE_LABEL[game.source] || 'Instalado', sizeBytes: game.sizeBytes || 0, lastPlayed: game.lastPlayed || null,
    cover: game.cover || null, hero: game.hero || null, logo: game.logo || null, header: game.header || null, icon: game.icon || null, hue: hueOf(game.name),
    installed: game.installed !== false, playtimeMin: Number.isFinite(game.playtimeMin) ? game.playtimeMin : null, fromAccount: game.fromAccount || null,
    canLaunch: Boolean(game.launchUri || game.exe), coverSource: game.coverSource || null, kind: game.kind === 'app' ? 'app' : 'game' };
}

const REGISTRY_SCRIPT = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$steam = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Valve\Steam').SteamPath
$gog = @(Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games' | ForEach-Object { $p = Get-ItemProperty -LiteralPath $_.PSPath; [pscustomobject]@{ id = [string]$p.gameID; name = [string]$p.gameName; path = [string]$p.path; exe = [string]$p.exe } })
$ubi = @(Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs' | ForEach-Object { $p = Get-ItemProperty -LiteralPath $_.PSPath; [pscustomobject]@{ id = [string]$_.PSChildName; path = [string]$p.InstallDir } })
$roots = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
$un = @(Get-ItemProperty -Path $roots | Where-Object { $_.DisplayName -and $_.InstallLocation } | Select-Object DisplayName, Publisher, InstallLocation, DisplayIcon, EstimatedSize, SystemComponent)
$drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID })
[pscustomobject]@{ steam = $steam; gog = $gog; ubisoft = $ubi; uninstall = $un; drives = $drives } | ConvertTo-Json -Depth 4 -Compress
`;

const asList = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);

function createLibrary({ fs, path, runPowerShell, getFileIcon, coversDir, manualFile, env = process.env, platform = process.platform, downscale = null, extras = async () => ({}), resolveOnline = null }) {
  let games = [];
  let steamRoot = null;
  const byId = new Map();
  const exists = (target) => fs.stat(target).then(() => true).catch(() => false);
  const listDir = (target) => fs.readdir(target, { withFileTypes: true }).catch(() => []);
  const missesFile = () => path.join(coversDir, 'sem-capa.json');

  /** Arte que a própria Steam já guardou no PC (layout antigo `<appid>_x.jpg` e novo `<appid>/<hash>/x.jpg`). */
  async function steamLocalArt(root, appid) {
    const cache = path.join(root, 'appcache', 'librarycache');
    const folder = path.join(cache, appid);
    const levels = [folder, ...(await listDir(folder)).filter((entry) => entry.isDirectory()).map((entry) => path.join(folder, entry.name))];
    const find = async (names) => {
      for (const name of names) { const flat = path.join(cache, `${appid}_${name}`); if (await exists(flat)) return flat; }
      for (const name of names) for (const level of levels) { const file = path.join(level, name); if (await exists(file)) return file; }
      return null;
    };
    return { coverFile: await find(['library_600x900_2x.jpg', 'library_600x900.jpg', 'library_capsule.jpg']), heroFile: await find(['library_hero.jpg', 'library_hero_blur.jpg']), logoFile: await find(['logo.png']), headerFile: await find(['header.jpg', 'library_header.jpg']) };
  }

  async function scanSteam(root) {
    if (!root) return [];
    let vdf = '';
    try { vdf = await fs.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'); } catch { /* biblioteca única */ }
    const found = [];
    for (const library of steamLibraries(vdf, root)) {
      const apps = path.join(library, 'steamapps');
      for (const entry of await listDir(apps)) {
        if (!/^appmanifest_\d+\.acf$/i.test(entry.name)) continue;
        let manifest;
        try { manifest = parseAppManifest(await fs.readFile(path.join(apps, entry.name), 'utf8')); } catch { continue; }
        if (!manifest || !manifest.installed) continue;
        found.push({ id: `steam-${manifest.appid}`, source: 'steam', name: manifest.name, kind: manifest.kind, sizeBytes: manifest.sizeBytes, lastPlayed: manifest.lastPlayed, appid: manifest.appid, installed: true,
          installDir: path.join(apps, 'common', manifest.installdir), launchUri: `steam://rungameid/${manifest.appid}`, ...(await steamLocalArt(root, manifest.appid)) });
      }
    }
    return found;
  }

  async function scanEpic() {
    const dir = path.join(env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    const found = [];
    for (const entry of await listDir(dir)) {
      if (!/\.item$/i.test(entry.name)) continue;
      const manifest = parseEpicManifest(await fs.readFile(path.join(dir, entry.name), 'utf8').catch(() => ''));
      if (!manifest) continue;
      found.push({ id: `epic-${slug(manifest.appName || manifest.name)}`, source: 'epic', name: manifest.name, sizeBytes: manifest.sizeBytes, installDir: manifest.installDir, exe: manifest.exe, installed: true,
        launchUri: manifest.namespace && manifest.catalogItemId && manifest.appName ? `com.epicgames.launcher://apps/${encodeURIComponent(`${manifest.namespace}:${manifest.catalogItemId}:${manifest.appName}`)}?action=launch&silent=true` : null });
    }
    return found;
  }

  async function scanXbox(drives) {
    const found = [];
    for (const drive of drives) {
      const root = `${String(drive).slice(0, 1)}:\\XboxGames`;
      for (const entry of await listDir(root)) {
        if (!entry.isDirectory()) continue;
        const content = path.join(root, entry.name, 'Content');
        const config = parseMicrosoftGameConfig(await fs.readFile(path.join(content, 'MicrosoftGame.config'), 'utf8').catch(() => ''));
        if (!config.exe && !config.name) continue;
        found.push({ id: `xbox-${slug(entry.name)}`, source: 'xbox', name: config.name || entry.name, installDir: content, exe: null, installed: true, storeId: config.storeId,
          coverFile: config.logo ? path.join(content, config.logo.replace(/\//g, '\\')) : null });
      }
    }
    return found;
  }

  async function loadManual() {
    try { const list = JSON.parse(await fs.readFile(manualFile, 'utf8')); return asList(list).filter((item) => item && item.exe && item.name).map((item) => ({ id: `manual-${slug(item.exe)}`, source: 'manual', name: String(item.name).slice(0, 80), exe: item.exe, installDir: path.dirname(item.exe), installed: true })); } catch { return []; }
  }

  /** Copia reduzindo (capa 360 px, fundo 1600 px): menos memória e menos decodificação em PCs fracos. */
  async function cacheLocal(source, target, width) {
    try {
      const [from, to] = await Promise.all([fs.stat(source), fs.stat(target).catch(() => null)]);
      if (to && to.mtimeMs >= from.mtimeMs) return target;
      if (downscale && await downscale(source, target, width).catch(() => false)) return target;
      await fs.copyFile(source, target);
      return target;
    } catch { return null; }
  }

  async function prepareArt(game, names) {
    const find = (prefix) => names.find((name) => name.startsWith(prefix));
    const custom = find(`custom-${game.id}.`);
    if (custom) { game.cover = path.join(coversDir, custom); game.coverSource = 'sua imagem'; }
    else if (game.coverFile && (game.cover = await cacheLocal(game.coverFile, path.join(coversDir, `${game.id}.jpg`), 360))) game.coverSource = game.source === 'steam' ? 'capa oficial (cache da Steam)' : 'arte oficial do jogo';
    else if (find(`off-${game.id}-cover.`)) { game.cover = path.join(coversDir, find(`off-${game.id}-cover.`)); game.coverSource = 'capa oficial (internet)'; }
    if (game.heroFile) game.hero = await cacheLocal(game.heroFile, path.join(coversDir, `${game.id}-hero.jpg`), 1600);
    if (!game.hero && find(`off-${game.id}-hero.`)) game.hero = path.join(coversDir, find(`off-${game.id}-hero.`));
    if (game.logoFile) game.logo = await cacheLocal(game.logoFile, path.join(coversDir, `${game.id}-logo.png`), 640);
    if (!game.logo && find(`off-${game.id}-logo.`)) game.logo = path.join(coversDir, find(`off-${game.id}-logo.`));
    if (!game.cover && game.headerFile) game.header = await cacheLocal(game.headerFile, path.join(coversDir, `${game.id}-header.jpg`), 460);
  }

  /** Une conta Steam (tempo de jogo, jogos não instalados) e conta Xbox (artes, histórico) à lista local. */
  function mergeAccounts(list, data) {
    const out = [...list];
    const index = new Map(out.map((game) => [slug(game.name), game]));
    for (const [appid, info] of Object.entries(data.steamPlaytime || {})) {
      const game = out.find((item) => item.appid === appid);
      if (!game) continue;
      if (Number.isFinite(info.playtimeMin)) game.playtimeMin = info.playtimeMin;
      if (info.lastPlayed && (!game.lastPlayed || info.lastPlayed > game.lastPlayed)) game.lastPlayed = info.lastPlayed;
    }
    for (const owned of data.steamOwned || []) {
      const existing = out.find((item) => item.appid === owned.appid);
      if (existing) {
        existing.playtimeMin = Math.max(existing.playtimeMin || 0, owned.playtimeMin || 0);
        if (owned.lastPlayed && (!existing.lastPlayed || owned.lastPlayed > existing.lastPlayed)) existing.lastPlayed = owned.lastPlayed;
        if (owned.twoWeeksMin) existing.twoWeeksMin = owned.twoWeeksMin;
        continue;
      }
      if (NOT_A_GAME.test(owned.name)) continue;
      const game = { id: `steam-${owned.appid}`, source: 'steam', name: owned.name, appid: owned.appid, installed: false, playtimeMin: owned.playtimeMin, lastPlayed: owned.lastPlayed, twoWeeksMin: owned.twoWeeksMin || 0, launchUri: `steam://install/${owned.appid}`, fromAccount: 'steam' };
      out.push(game); index.set(slug(game.name), game);
    }
    for (const title of data.xboxTitles || []) {
      const match = index.get(slug(title.name));
      if (match) {
        if (title.image && !match.xboxImage) match.xboxImage = title.image;
        if (title.lastPlayed && (!match.lastPlayed || title.lastPlayed > match.lastPlayed)) match.lastPlayed = title.lastPlayed;
        continue;
      }
      const game = { id: `xboxconta-${title.titleId || slug(title.name)}`, source: 'xboxconta', name: title.name, installed: false, lastPlayed: title.lastPlayed, xboxImage: title.image, devices: title.devices, fromAccount: 'xbox' };
      out.push(game); index.set(slug(game.name), game);
    }
    return out;
  }

  /* ---------- Linux: Steam nativa/Flatpak/Snap e Heroic (Epic e GOG); Proton entra como jogo da Steam ---------- */
  async function linuxSteamRoot() {
    const home = env.HOME || '';
    for (const candidate of [`${home}/.steam/steam`, `${home}/.local/share/Steam`, `${home}/.var/app/com.valvesoftware.Steam/.local/share/Steam`, `${home}/snap/steam/common/.local/share/Steam`]) {
      if (await exists(path.join(candidate, 'steamapps'))) return fs.realpath(candidate).catch(() => candidate);
    }
    return null;
  }
  async function scanHeroic() {
    const home = env.HOME || '';
    const found = [];
    for (const root of [`${home}/.config/heroic`, `${home}/.var/app/com.heroicgameslauncher.hgl/config/heroic`]) {
      let legendary = {};
      try { legendary = JSON.parse(await fs.readFile(path.join(root, 'legendaryConfig', 'legendary', 'installed.json'), 'utf8')); } catch { /* sem Epic */ }
      for (const [appName, item] of Object.entries(legendary || {})) {
        if (!item?.install_path || !item.title) continue;
        found.push({ id: `epic-${slug(appName)}`, source: 'epic', name: String(item.title), installDir: item.install_path, exe: null, installed: true, sizeBytes: Number(item.install_size) || 0, via: 'Heroic' });
      }
      let titles = {};
      try { const library = JSON.parse(await fs.readFile(path.join(root, 'gog_store', 'library.json'), 'utf8')); for (const game of asList(library.games)) if (game?.app_name) titles[game.app_name] = game.title; } catch { /* sem cache de títulos */ }
      let gog = {};
      try { gog = JSON.parse(await fs.readFile(path.join(root, 'gog_store', 'installed.json'), 'utf8')); } catch { /* sem GOG */ }
      for (const item of asList(gog.installed)) {
        if (!item?.install_path) continue;
        found.push({ id: `gog-${String(item.appName).replace(/\D/g, '') || slug(item.install_path)}`, source: 'gog', name: titles[item.appName] || path.basename(String(item.install_path)), installDir: item.install_path, exe: null, installed: true, via: 'Heroic' });
      }
    }
    return found;
  }

  async function scan() {
    if (platform === 'linux') return scanLinux();
    if (platform !== 'win32') { games = []; byId.clear(); return []; }
    let registry = {};
    try { registry = JSON.parse((await runPowerShell(REGISTRY_SCRIPT, 30000)).stdout || '{}'); } catch { registry = {}; }
    steamRoot = registry.steam ? winPath(registry.steam) : null;
    const gog = asList(registry.gog).filter((item) => item.name && item.path).map((item) => ({ id: `gog-${String(item.id).replace(/\D/g, '') || slug(item.name)}`, source: 'gog', name: item.name, installDir: item.path, installed: true,
      exe: item.exe || null, gogId: String(item.id).replace(/\D/g, '') || null, iconFile: item.id ? path.join(item.path, `goggame-${String(item.id).replace(/\D/g, '')}.ico`) : null }));
    const ubisoft = asList(registry.ubisoft).filter((item) => item.path).map((item) => ({ id: `ubisoft-${String(item.id).replace(/\D/g, '')}`, source: 'ubisoft', name: path.basename(String(item.path).replace(/[\\/]+$/, '')), installDir: item.path, installed: true, launchUri: `uplay://launch/${String(item.id).replace(/\D/g, '')}/0` }));
    const others = asList(registry.uninstall).map(classifyUninstall).filter(Boolean).map((item) => ({ ...item, installed: true, id: `${item.source}-${slug(item.name)}` }));
    const lists = await Promise.all([scanSteam(steamRoot), scanEpic(), scanXbox(asList(registry.drives)), loadManual()]);
    const account = await extras(steamRoot).catch(() => ({}));
    games = mergeAccounts(mergeGames([...lists, gog, ubisoft, others]), account);
    for (const game of games.filter((item) => !item.installed && item.source === 'steam' && steamRoot)) Object.assign(game, await steamLocalArt(steamRoot, game.appid));
    byId.clear();
    await fs.mkdir(coversDir, { recursive: true });
    const names = (await listDir(coversDir)).map((entry) => entry.name);
    for (const game of games) {
      byId.set(game.id, game);
      await prepareArt(game, names);
      if (!game.cover && getFileIcon && game.installed) {
        const iconSource = game.iconFile && await exists(game.iconFile) ? game.iconFile : game.exe && await exists(game.exe) ? game.exe : null;
        if (iconSource) game.icon = await getFileIcon(iconSource).catch(() => null);
      }
    }
    games.sort((a, b) => Number(b.installed) - Number(a.installed) || (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name, 'pt-BR'));
    return games.map(publicView);
  }

  async function finalize(lists) {
    const account = await extras(steamRoot).catch(() => ({}));
    games = mergeAccounts(mergeGames(lists), account);
    for (const game of games.filter((item) => !item.installed && item.source === 'steam' && steamRoot)) Object.assign(game, await steamLocalArt(steamRoot, game.appid));
    byId.clear();
    await fs.mkdir(coversDir, { recursive: true });
    const names = (await listDir(coversDir)).map((entry) => entry.name);
    for (const game of games) { byId.set(game.id, game); await prepareArt(game, names); }
    games.sort((a, b) => Number(b.installed) - Number(a.installed) || (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name, 'pt-BR'));
    return games.map(publicView);
  }
  async function scanLinux() {
    steamRoot = await linuxSteamRoot();
    const lists = await Promise.all([scanSteam(steamRoot), scanHeroic(), loadManual()]);
    return finalize(lists);
  }

  /**
   * Opcional (o usuário liga): busca as capas OFICIAIS que faltam. Lembra quem não teve correspondência por 7 dias
   * para não ficar perguntando à toa. `onProgress(done, total)` alimenta a barra da interface.
   */
  async function fetchOfficialArt({ onProgress = () => {}, now = Date.now(), force = false } = {}) {
    if (!resolveOnline) return 0;
    let misses = {};
    try { misses = JSON.parse(await fs.readFile(missesFile(), 'utf8')); } catch { misses = {}; }
    const todo = games.filter((game) => (!game.cover || (game.source === 'steam' && !game.hero)) && game.coverSource !== 'sua imagem' && (force || !(misses[game.id] > now - 7 * 86400000)));
    let done = 0;
    let found = 0;
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const game = queue.shift();
        const art = await resolveOnline(game).catch(() => null);
        if (art?.cover) {
          if (!game.cover || game.coverSource === 'arte oficial do jogo') { game.cover = art.cover; game.coverSource = art.source; }
          if (art.hero && !game.hero) game.hero = art.hero;
          if (art.logo && !game.logo) game.logo = art.logo;
          found += 1;
          delete misses[game.id];
        } else misses[game.id] = now;
        done += 1;
        onProgress(done, todo.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await fs.writeFile(missesFile(), JSON.stringify(misses), 'utf8').catch(() => {});
    return found;
  }

  function matchPath(exePath) {
    if (!exePath) return null;
    const lower = String(exePath).toLowerCase();
    for (const game of games) {
      if (!game.installed) continue;
      const dir = String(game.installDir || '').toLowerCase().replace(/[\\/]+$/, '');
      if (dir.length > 3 && (lower.startsWith(`${dir}\\`) || lower.startsWith(`${dir}/`))) return game;
      if (game.exe && lower === String(game.exe).toLowerCase()) return game;
    }
    return null;
  }

  /**
   * Pelo NOME do processo (quando o Windows esconde o caminho: anticheat, jogos da loja): o executável conhecido do
   * jogo com o mesmo nome. Só jogos instalados e só nome exato (sem a extensão), para não confundir.
   */
  function matchName(processName) {
    const name = String(processName || '').toLowerCase().replace(/\.exe$/, '');
    if (name.length < 3) return null;
    for (const game of games) {
      if (!game.installed || !game.exe) continue;
      const base = String(game.exe).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
      if (base === name) return game;
    }
    return null;
  }

  return { scan, fetchOfficialArt, matchPath, matchName, steamRoot: () => steamRoot, get: (id) => byId.get(id) || null, list: () => games.map(publicView) };
}

module.exports = { NOT_A_GAME, STEAM_APPS, createLibrary, parseVdf, steamLibraries, parseAppManifest, parseEpicManifest, parseMicrosoftGameConfig, classifyUninstall, mergeGames, publicView, slug, hueOf, SOURCE_LABEL, GAME_FOLDER, REGISTRY_SCRIPT };
