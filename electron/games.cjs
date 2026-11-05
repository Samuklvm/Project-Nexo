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
const NOT_A_GAME = /redistributable|^proton\b|steam linux runtime|steamvr|dedicated server|\bsdk\b|soundtrack|benchmark tool|^steamworks/i;
const GAME_PUBLISHERS = /(electronic arts|riot games|blizzard|rockstar games|ubisoft|bethesda|mojang|activision|bandai namco|cd projekt|square enix|\bsega\b|capcom|wargaming|garena|mihoyo|hoyoverse|krafton|nexon|grinding gear|digital extremes|hi-rez|innersloth|paradox interactive|focus entertainment|2k games|take-two|warner bros\. games|devolver|team17|ea swiss|respawn|bungie|epic games, inc\.)/i;
const GAME_FOLDER = [/\\steamapps\\common\\/i, /\\epic games\\(?!launcher)/i, /\\gog galaxy\\games\\/i, /\\gog games\\/i, /\\riot games\\/i,
  /\\ubisoft game launcher\\games\\/i, /\\ea games\\/i, /\\origin games\\/i, /\\xboxgames\\/i, /\\rockstar games\\(?!launcher)/i];
const SOURCE_LABEL = { steam: 'Steam', epic: 'Epic Games', gog: 'GOG', ubisoft: 'Ubisoft', xbox: 'Xbox', ea: 'EA', battlenet: 'Battle.net', riot: 'Riot', rockstar: 'Rockstar', outro: 'Instalado', manual: 'Adicionado por você' };

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

function steamLibraries(vdfText, steamRoot) {
  const parsed = parseVdf(vdfText);
  const root = parsed.libraryfolders || parsed;
  const paths = new Set([steamRoot]);
  for (const value of Object.values(root || {})) {
    if (typeof value === 'string') { if (/^[a-z]:[\\/]/i.test(value)) paths.add(value); continue; }
    if (value && typeof value.path === 'string') paths.add(value.path);
  }
  return [...paths].filter(Boolean).map((item) => item.replace(/\\\\/g, '\\').replace(/\//g, '\\'));
}

function parseAppManifest(text) {
  const state = parseVdf(text).appstate;
  if (!state || !state.appid || !state.name) return null;
  if (state.appid === '228980' || NOT_A_GAME.test(state.name)) return null;
  const flags = Number(state.stateflags) || 0;
  return { appid: String(state.appid).replace(/\D/g, ''), name: state.name.trim(), installdir: state.installdir || '', sizeBytes: Number(state.sizeondisk) || 0,
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
  return { name: display && !/^ms-resource:/i.test(display) ? display.trim() : null, exe, logo, identity: attr('Identity', 'Name') };
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
  const priority = { steam: 0, epic: 1, gog: 2, xbox: 3, ubisoft: 4, ea: 5, battlenet: 6, riot: 7, rockstar: 8, outro: 9, manual: 10 };
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
    cover: game.cover || null, icon: game.icon || null, hue: hueOf(game.name), canLaunch: Boolean(game.launchUri || game.exe), coverSource: game.coverSource || null };
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

function createLibrary({ fs, path, runPowerShell, getFileIcon, coversDir, manualFile, env = process.env, platform = process.platform, fetchCover = null }) {
  let games = [];
  const byId = new Map();
  const exists = (target) => fs.stat(target).then(() => true).catch(() => false);
  const listDir = (target) => fs.readdir(target, { withFileTypes: true }).catch(() => []);

  async function steamCover(steamRoot, appid) {
    const cache = path.join(steamRoot, 'appcache', 'librarycache');
    for (const name of [`${appid}_library_600x900.jpg`, `${appid}_header.jpg`]) { const file = path.join(cache, name); if (await exists(file)) return file; }
    const folder = path.join(cache, appid);
    const wanted = ['library_600x900.jpg', 'library_capsule.jpg', 'header.jpg', 'library_header.jpg', 'library_hero.jpg'];
    const levels = [folder, ...(await listDir(folder)).filter((entry) => entry.isDirectory()).map((entry) => path.join(folder, entry.name))];
    for (const want of wanted) for (const level of levels) { const file = path.join(level, want); if (await exists(file)) return file; }
    return null;
  }

  async function scanSteam(steamRoot) {
    if (!steamRoot) return [];
    const root = steamRoot.replace(/\//g, '\\');
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
        found.push({ id: `steam-${manifest.appid}`, source: 'steam', name: manifest.name, sizeBytes: manifest.sizeBytes, lastPlayed: manifest.lastPlayed, appid: manifest.appid,
          installDir: path.join(apps, 'common', manifest.installdir), launchUri: `steam://rungameid/${manifest.appid}`, coverFile: await steamCover(root, manifest.appid) });
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
      found.push({ id: `epic-${slug(manifest.appName || manifest.name)}`, source: 'epic', name: manifest.name, sizeBytes: manifest.sizeBytes, installDir: manifest.installDir, exe: manifest.exe,
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
        found.push({ id: `xbox-${slug(entry.name)}`, source: 'xbox', name: config.name || entry.name, installDir: content, exe: null, coverFile: config.logo ? path.join(content, config.logo.replace(/\//g, '\\')) : null });
      }
    }
    return found;
  }

  async function loadManual() {
    try { const list = JSON.parse(await fs.readFile(manualFile, 'utf8')); return asList(list).filter((item) => item && item.exe && item.name).map((item) => ({ id: `manual-${slug(item.exe)}`, source: 'manual', name: String(item.name).slice(0, 80), exe: item.exe, installDir: path.dirname(item.exe) })); } catch { return []; }
  }

  async function prepareCover(game) {
    await fs.mkdir(coversDir, { recursive: true });
    const custom = (await listDir(coversDir)).find((entry) => entry.name.startsWith(`custom-${game.id}.`));
    if (custom) { game.cover = path.join(coversDir, custom.name); game.coverSource = 'sua imagem'; return; }
    if (game.coverFile) {
      const extension = path.extname(game.coverFile).toLowerCase() || '.jpg';
      const target = path.join(coversDir, `${game.id}${extension}`);
      try {
        const [source, copied] = await Promise.all([fs.stat(game.coverFile), fs.stat(target).catch(() => null)]);
        if (!copied || copied.mtimeMs < source.mtimeMs) await fs.copyFile(game.coverFile, target);
        game.cover = target; game.coverSource = game.source === 'steam' ? 'cache local da Steam' : 'pasta do jogo';
        return;
      } catch { /* sem capa local */ }
    }
    const online = (await listDir(coversDir)).find((entry) => entry.name.startsWith(`cdn-${game.id}.`));
    if (online) { game.cover = path.join(coversDir, online.name); game.coverSource = 'CDN da Steam'; }
  }

  async function scan() {
    if (platform !== 'win32') { games = []; byId.clear(); return []; }
    let registry = {};
    try { registry = JSON.parse((await runPowerShell(REGISTRY_SCRIPT, 30000)).stdout || '{}'); } catch { registry = {}; }
    const gog = asList(registry.gog).filter((item) => item.name && item.path).map((item) => ({ id: `gog-${String(item.id).replace(/\D/g, '') || slug(item.name)}`, source: 'gog', name: item.name, installDir: item.path,
      exe: item.exe || null, iconFile: item.id ? path.join(item.path, `goggame-${String(item.id).replace(/\D/g, '')}.ico`) : null }));
    const ubisoft = asList(registry.ubisoft).filter((item) => item.path).map((item) => ({ id: `ubisoft-${String(item.id).replace(/\D/g, '')}`, source: 'ubisoft', name: path.basename(String(item.path).replace(/[\\/]+$/, '')), installDir: item.path, launchUri: `uplay://launch/${String(item.id).replace(/\D/g, '')}/0` }));
    const others = asList(registry.uninstall).map(classifyUninstall).filter(Boolean).map((item) => ({ ...item, id: `${item.source}-${slug(item.name)}` }));
    const lists = await Promise.all([scanSteam(registry.steam), scanEpic(), scanXbox(asList(registry.drives)), loadManual()]);
    games = mergeGames([...lists, gog, ubisoft, others]);
    byId.clear();
    for (const game of games) {
      byId.set(game.id, game);
      await prepareCover(game);
      if (!game.cover && getFileIcon) {
        const iconSource = game.iconFile && await exists(game.iconFile) ? game.iconFile : game.exe && await exists(game.exe) ? game.exe : null;
        if (iconSource) game.icon = await getFileIcon(iconSource).catch(() => null);
      }
    }
    return games.map(publicView);
  }

  /** Opcional (desligado por padrão): baixa da CDN da Steam as capas que faltam. Revela à Valve quais jogos você tem. */
  async function fetchMissingCovers() {
    if (!fetchCover) return 0;
    let count = 0;
    for (const game of games.filter((item) => item.source === 'steam' && !item.cover)) {
      const bytes = await fetchCover(game.appid).catch(() => null);
      if (!bytes || bytes.length < 1024 || bytes.length > 3 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) continue;
      const target = path.join(coversDir, `cdn-${game.id}.jpg`);
      await fs.writeFile(target, bytes);
      game.cover = target; game.coverSource = 'CDN da Steam';
      count += 1;
    }
    return count;
  }

  /** Pastas de instalação, para a sonda e o observador reconhecerem o jogo em primeiro plano. Ficam no processo principal. */
  function matchPath(exePath) {
    if (!exePath) return null;
    const lower = String(exePath).toLowerCase();
    for (const game of games) {
      const dir = String(game.installDir || '').toLowerCase().replace(/[\\/]+$/, '');
      if (dir.length > 3 && (lower.startsWith(`${dir}\\`) || lower.startsWith(`${dir}/`))) return game;
      if (game.exe && lower === String(game.exe).toLowerCase()) return game;
    }
    return null;
  }

  return { scan, fetchMissingCovers, matchPath, get: (id) => byId.get(id) || null, list: () => games.map(publicView) };
}

module.exports = { createLibrary, parseVdf, steamLibraries, parseAppManifest, parseEpicManifest, parseMicrosoftGameConfig, classifyUninstall, mergeGames, publicView, slug, hueOf, SOURCE_LABEL, GAME_FOLDER, REGISTRY_SCRIPT };
