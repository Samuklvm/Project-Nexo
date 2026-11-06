const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Games = require('../electron/games.cjs');
const Watch = require('../electron/watcher.cjs');
const Account = require('../electron/account.cjs');
const Elevate = require('../electron/elevate.cjs');

const LIBRARY_VDF = `"libraryfolders"
{
  "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" "apps" { "570" "1" } }
  "1" { "path" "D:\\\\SteamLibrary" }
}`;
const MANIFEST = (appid, name, flags = 4) => `"AppState" { "appid" "${appid}" "name" "${name}" "StateFlags" "${flags}" "installdir" "${name}" "SizeOnDisk" "1000" "LastPlayed" "1700000000" }`;

test('Steam: bibliotecas do libraryfolders.vdf e manifestos de jogos', () => {
  assert.deepEqual(Games.steamLibraries(LIBRARY_VDF, 'C:\\Program Files (x86)\\Steam'), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  const game = Games.parseAppManifest(MANIFEST(1245620, 'ELDEN RING'));
  assert.equal(game.appid, '1245620');
  assert.equal(game.lastPlayed, 1700000000000);
  assert.equal(Games.parseAppManifest(MANIFEST(228980, 'Steamworks Common Redistributables')), null);
  assert.equal(Games.parseAppManifest(MANIFEST(1, 'Proton 9.0')), null);
});

test('Epic: ignora DLC, instalação incompleta e aplicativos', () => {
  const base = { DisplayName: 'Fortnite', InstallLocation: 'C:\\Epic Games\\Fortnite', LaunchExecutable: 'FortniteGame/Binaries/Win64/FortniteLauncher.exe', AppName: 'Fortnite', MainGameAppName: 'Fortnite', CatalogNamespace: 'fn', CatalogItemId: 'abc', AppCategories: ['public', 'games'] };
  const parsed = Games.parseEpicManifest(JSON.stringify(base));
  assert.equal(parsed.name, 'Fortnite');
  assert.match(parsed.exe, /FortniteLauncher\.exe$/);
  assert.equal(Games.parseEpicManifest(JSON.stringify({ ...base, AppName: 'Fortnite_DLC' })), null);
  assert.equal(Games.parseEpicManifest(JSON.stringify({ ...base, bIsIncompleteInstall: true })), null);
  assert.equal(Games.parseEpicManifest(JSON.stringify({ ...base, AppCategories: ['applications'] })), null);
  assert.equal(Games.parseEpicManifest('{lixo'), null);
});

test('Xbox: MicrosoftGame.config dá nome e imagem local', () => {
  const xml = '<Game><Identity Name="Microsoft.Forza" /><ExecutableList><Executable Name="ForzaHorizon5.exe" Id="Game" /></ExecutableList><ShellVisuals DefaultDisplayName="Forza Horizon 5" Square150x150Logo="GraphicsLogo.png" Square480x480Logo="StoreLogo480.png" /></Game>';
  const parsed = Games.parseMicrosoftGameConfig(xml);
  assert.equal(parsed.name, 'Forza Horizon 5');
  assert.equal(parsed.logo, 'StoreLogo480.png');
  assert.equal(Games.parseMicrosoftGameConfig('<ShellVisuals DefaultDisplayName="ms-resource:Title" />').name, null);
});

test('desinstalação: editoras de jogos entram, launchers e redistribuíveis não', () => {
  assert.equal(Games.classifyUninstall({ DisplayName: 'VALORANT', Publisher: 'Riot Games, Inc', InstallLocation: 'C:\\Riot Games\\VALORANT\\live' }).source, 'riot');
  assert.equal(Games.classifyUninstall({ DisplayName: 'Battle.net', Publisher: 'Blizzard Entertainment', InstallLocation: 'C:\\Battle.net' }), null);
  assert.equal(Games.classifyUninstall({ DisplayName: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', Publisher: 'Microsoft Corporation', InstallLocation: 'C:\\x' }), null);
  assert.equal(Games.classifyUninstall({ DisplayName: 'Planilha', Publisher: 'Qualquer', InstallLocation: 'C:\\Programas\\Planilha' }), null);
  const ea = Games.classifyUninstall({ DisplayName: 'Apex Legends', Publisher: 'Electronic Arts', InstallLocation: 'C:\\Program Files\\EA Games\\Apex', DisplayIcon: '"C:\\Program Files\\EA Games\\Apex\\r5apex.exe",0', EstimatedSize: 2048 });
  assert.equal(ea.source, 'ea');
  assert.match(ea.exe, /r5apex\.exe$/);
  assert.equal(ea.sizeBytes, 2048 * 1024);
});

test('mergeGames remove duplicados preferindo a Steam e ordena por último jogo', () => {
  const merged = Games.mergeGames([[{ id: 'epic-x', source: 'epic', name: 'Hades', lastPlayed: null }], [{ id: 'steam-1', source: 'steam', name: 'HADES', lastPlayed: 5 }, { id: 'steam-2', source: 'steam', name: 'Celeste', lastPlayed: 9 }]]);
  assert.deepEqual(merged.map((game) => game.id), ['steam-2', 'steam-1']);
});

test('a visão pública do jogo não carrega caminhos', () => {
  const view = Games.publicView({ id: 'steam-1', name: 'Hades', source: 'steam', installDir: 'D:\\Steam\\common\\Hades', exe: 'D:\\x.exe', launchUri: 'steam://rungameid/1', cover: 'C:\\dados\\covers\\steam-1.jpg' });
  assert.equal(view.canLaunch, true);
  assert.equal(JSON.stringify(view).includes('common'), false);
  assert.equal('installDir' in view || 'exe' in view || 'launchUri' in view, false);
});

test('observador: jogo da biblioteca por duas leituras inicia; processo encerrado termina', () => {
  const events = [];
  let alive = true;
  const logic = Watch.createWatchLogic({ match: (path) => (path && path.startsWith('D:\\Games\\Hades') ? { id: 'steam-1', name: 'Hades' } : null), alive: () => alive, onStart: (game) => events.push(['start', game.name, game.gameId]), onEnd: (game) => events.push(['end', game.name]) });
  logic.feed({ pid: 10, name: 'Code', path: 'C:\\Programs\\Code.exe' });
  logic.feed({ pid: 20, name: 'Hades', path: 'D:\\Games\\Hades\\Hades.exe' });
  assert.equal(events.length, 0, 'uma leitura só não basta');
  logic.feed({ pid: 20, name: 'Hades', path: 'D:\\Games\\Hades\\Hades.exe' });
  assert.deepEqual(events[0], ['start', 'Hades', 'steam-1']);
  logic.feed({ pid: 30, name: 'Outro', path: 'E:\\SteamLibrary\\steamapps\\common\\Outro\\o.exe' });
  logic.tick();
  assert.equal(events.length, 1);
  alive = false;
  logic.tick();
  assert.deepEqual(events[1], ['end', 'Hades']);
  logic.feed({ pid: 30, name: 'Outro', path: 'E:\\SteamLibrary\\steamapps\\common\\Outro\\o.exe' });
  logic.feed({ pid: 30, name: 'Outro', path: 'E:\\SteamLibrary\\steamapps\\common\\Outro\\o.exe' });
  assert.equal(events[2][0], 'start', 'pasta de biblioteca conhecida também conta');
});

test('PKCE S256 e URL de login com escopos mínimos', () => {
  const pkce = Account.createPkce();
  assert.equal(pkce.challenge, crypto.createHash('sha256').update(pkce.verifier).digest('base64url'));
  const url = new URL(Account.buildAuthUrl({ clientId: 'id.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:5000', challenge: pkce.challenge, state: 's' }));
  assert.equal(url.origin + url.pathname, Account.AUTH_URL);
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), null, 'sem acesso offline');
});

test('configuração do cliente: aceita o JSON do Google Cloud e recusa lixo', () => {
  assert.deepEqual(Account.parseClientConfig({ installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'x' } }), { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'x' });
  assert.equal(Account.parseClientConfig({ installed: { client_id: 'qualquer' } }), null);
  assert.equal(Account.parseClientConfig(null), null);
});

test('retorno do navegador: state errado e cancelamento são recusados', () => {
  assert.deepEqual(Account.parseCallback('/?code=abc&state=s1', 's1'), { code: 'abc' });
  assert.ok(Account.parseCallback('/?code=abc&state=outro', 's1').error);
  assert.match(Account.parseCallback('/?error=access_denied', 's1').error, /cancelou/);
  assert.equal(Account.parseCallback('/favicon.ico', 's1').ignore, true);
});

test('id_token: emissor, público e validade conferidos', () => {
  const now = 1_800_000_000_000;
  const good = { iss: 'https://accounts.google.com', aud: 'id.apps.googleusercontent.com', exp: now / 1000 + 600, sub: '42', name: 'Ana', email: 'ana@example.com', email_verified: true, picture: 'https://lh3.googleusercontent.com/a/x' };
  assert.equal(Account.validateIdToken(good, 'id.apps.googleusercontent.com', now).profile.name, 'Ana');
  assert.equal(Account.validateIdToken({ ...good, iss: 'https://evil.example' }, 'id.apps.googleusercontent.com', now).ok, false);
  assert.equal(Account.validateIdToken({ ...good, aud: 'outro' }, 'id.apps.googleusercontent.com', now).ok, false);
  assert.equal(Account.validateIdToken({ ...good, exp: now / 1000 - 3600 }, 'id.apps.googleusercontent.com', now).ok, false);
  assert.equal(Account.validateIdToken({ ...good, picture: 'https://evil.example/x.png' }, 'id.apps.googleusercontent.com', now).profile.picture, null);
});

test('login de ponta a ponta com loopback real e Google simulado', async () => {
  const clientId = 'id.apps.googleusercontent.com';
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ iss: 'accounts.google.com', aud: clientId, exp: Math.floor(now / 1000) + 600, sub: '7', name: 'Bia', email: 'bia@example.com', email_verified: true })).toString('base64url');
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (url === Account.TOKEN_URL) {
      const body = new URLSearchParams(init.body);
      assert.ok(body.get('code_verifier'));
      assert.equal(body.get('code'), 'codigo');
      return { ok: true, json: async () => ({ id_token: `x.${payload}.y`, access_token: 'tok' }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const openExternal = async (authUrl) => {
    const params = new URL(authUrl).searchParams;
    const redirect = params.get('redirect_uri');
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+$/);
    setTimeout(() => http.get(`${redirect}/?code=codigo&state=${encodeURIComponent(params.get('state'))}`, (response) => response.resume()), 10);
  };
  const result = await Account.signIn({ config: { clientId, clientSecret: 's' }, createServer: http.createServer, openExternal, fetch, timeoutMs: 5000 });
  assert.equal(result.profile.name, 'Bia');
  assert.ok(calls.some((call) => { const url = new URL(call); return url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/revoke'; }), 'token de acesso revogado');
});

test('login sem configuração falha com mensagem clara', async () => {
  await assert.rejects(Account.signIn({ config: null }), /não foi configurado/);
});

test('ferramentas elevadas: só defrag com letra válida e sfc', () => {
  assert.match(Elevate.toolLauncher('defrag', 'C'), /'defrag\.exe' -ArgumentList @\('C:', '\/O', '\/U', '\/V'\)/);
  assert.throws(() => Elevate.toolLauncher('defrag', 'C:; rm'));
  assert.throws(() => Elevate.toolLauncher('cmd'));
  assert.match(Elevate.toolLauncher('sfc'), /'sfc\.exe'/);
});

test('Atlas: cada item tem status e área válidos; mitos e bloqueios não apontam para ações', () => {
  const Atlas = require('../src/atlas.js');
  const ids = new Set();
  for (const item of Atlas.ITEMS) {
    assert.ok(!ids.has(item.id), `duplicado: ${item.id}`); ids.add(item.id);
    assert.ok(Atlas.STATUS[item.status] && Atlas.AREA[item.area] && Atlas.FAME[item.fama], item.id);
    assert.ok(item.resumo && item.porque, item.id);
    if (item.status === 'mito' || item.status === 'bloqueado') assert.equal(item.goto, undefined, item.id);
  }
  assert.ok(Atlas.counts().mito >= 8 && Atlas.counts().bloqueado >= 5);
});

test('Atlas: fatos do sistema viram achados honestos', () => {
  const Atlas = require('../src/atlas.js');
  const slow = Atlas.evaluateFacts({ platform: 'win32', memory: [{ speed: 3200, configured: 2133, capacity: 8e9 }], displays: [{ name: 'GPU', current: 60, max: 165 }], hags: 2, gameMode: 0, capture: 1, vbs: 2, hvci: true });
  assert.equal(slow.xmp.state, 'atencao');
  assert.match(slow.xmp.text, /2133.*3200/);
  assert.equal(slow.channels.state, 'atencao');
  assert.equal(slow.refresh.state, 'atencao');
  assert.equal(slow.gameMode.state, 'atencao');
  assert.match(slow.vbs.text, /Integridade de memória/);
  assert.equal(Atlas.evaluateFacts({ platform: 'win32', capture: 1, historical: 1 }).capture.state, 'atencao', 'gravar o que aconteceu ligado');
  assert.equal(Atlas.evaluateFacts({ platform: 'win32', capture: null, historical: null }).capture.state, 'ok', 'sem valor no Registro = padrão do Windows (desligado)');
  const fine = Atlas.evaluateFacts({ platform: 'win32', memory: [{ speed: 3200, configured: 3200, capacity: 8e9 }, { speed: 3200, configured: 3200, capacity: 8e9 }], displays: [{ name: 'GPU', current: 144, max: 165 }], gameMode: 1, capture: 0 });
  assert.equal(fine.xmp.state, 'info');
  assert.equal(fine.channels.state, 'ok');
  assert.equal(fine.refresh.state, 'info');
  assert.deepEqual(Atlas.evaluateFacts({ platform: 'darwin' }), {});
  const linux = Atlas.evaluateFacts({ platform: 'linux', ppd: false, mangohud: true, gamemode: false, governor: 'schedutil', session: 'wayland' });
  assert.equal(linux.ppd.state, 'atencao');
  assert.equal(linux.mangohud.state, 'ok');
  assert.match(linux.session.text, /XWayland/);
});

test('build: o instalador do Windows leva o coletor de sensores e o PresentMon fixado', () => {
  const pkg = require('../package.json');
  const win = pkg.build.win.extraResources || [];
  assert.ok(win.some((entry) => entry.from === 'sensor-host/publish' && entry.to === 'sensor-host'), 'sensor-host empacotado (sumiu do build desde a 0.4.0)');
  assert.ok(pkg.build.extraResources.some((entry) => entry.from === 'third-party/bin' && entry.to === 'tools'));
  const lock = require('../third-party/presentmon.lock.json');
  assert.match(lock.sha256, /^[0-9a-f]{64}$/);
});

test('biblioteca: DLC fica de fora e programas da Steam viram "app", não jogo', () => {
  const Games = require('../electron/games.cjs');
  const acf = (appid, name) => `"AppState" { "appid" "${appid}" "name" "${name}" "StateFlags" "4" "installdir" "x" }`;
  assert.equal(Games.parseAppManifest(acf('2138330', 'Cyberpunk 2077 Bonus Content')), null);
  assert.equal(Games.parseAppManifest(acf('431960', 'Wallpaper Engine')).kind, 'app');
  assert.equal(Games.parseAppManifest(acf('629520', 'Soundpad')).kind, 'app');
  assert.equal(Games.parseAppManifest(acf('1091500', 'Cyberpunk 2077')).kind, 'game');
  assert.equal(Games.publicView({ id: 'steam-431960', name: 'Wallpaper Engine', source: 'steam', kind: 'app' }).kind, 'app');
  const { normalizeProbe } = require('../electron/probe.cjs');
  const sample = normalizeProbe({ t: 1, fg: { pid: 9, name: 'wallpaper32', path: 'C:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper32.exe' } }, () => ({ id: 'steam-431960', name: 'Wallpaper Engine', kind: 'app' }));
  assert.equal(sample.fg.isGame, false);
});

test('planos de energia: a saída do powercfg (em português) é lida sem depender do idioma', () => {
  const { parseList } = require('../electron/lab-system.cjs');
  const plans = parseList('Esquemas de Energia Existentes (* Ativo)\r\n-----------------------------------\r\nGUID do Esquema de Energia: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado) *\r\nGUID do Esquema de Energia: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (Alto desempenho)\r\n');
  assert.deepEqual(plans.map((plan) => [plan.guid.slice(0, 8), plan.active]), [['381b4222', true], ['8c5e7fda', false]]);
});

test('build: config do Google sai do JSON do cliente ou só do segredo GOCSPX + ID público', () => {
  const { buildOAuthConfig, publicClientId } = require('../scripts/write-google-oauth.cjs');
  const { execFileSync } = require('node:child_process');
  const id = publicClientId(path.join(__dirname, '..'));
  assert.match(id, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
  const fake = 'GOCSPX-segredoDeTeste_123456789';
  const fromSecret = buildOAuthConfig(`  ${fake}\n`, id);
  assert.deepEqual(fromSecret.config, { installed: { client_id: id, client_secret: fake } });
  const json = JSON.stringify({ installed: { client_id: '1-abc.apps.googleusercontent.com', client_secret: fake, redirect_uris: ['http://localhost'] } });
  assert.equal(buildOAuthConfig(`﻿${json}`, id).config.installed.client_id, '1-abc.apps.googleusercontent.com', 'JSON (até com BOM) vale como está');
  assert.ok(buildOAuthConfig(fake, null).error, 'sem ID público, só o segredo não basta');
  // O motivo é sempre um código fixo, e o texto do aviso vem de uma lista fixa: nada do segredo vai para o log.
  const codes = ['empty', 'bad-json', 'no-client-id', 'no-public-id', 'unknown'];
  for (const bad of ['', 'qualquer-coisa', '{ quebrado', JSON.stringify({ installed: { client_id: 'x' } })]) assert.ok(codes.includes(buildOAuthConfig(bad, id).error), bad);
  const { reasonText } = require('../scripts/write-google-oauth.cjs');
  for (const code of codes) assert.ok(reasonText(code).length > 10, code);
  // O script nunca imprime o segredo (nem quando o formato é desconhecido).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-oauth-'));
  fs.mkdirSync(path.join(dir, 'config')); fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'write-google-oauth.cjs'), path.join(dir, 'scripts', 'write-google-oauth.cjs'));
  fs.copyFileSync(path.join(__dirname, '..', 'config', 'google-client.json'), path.join(dir, 'config', 'google-client.json'));
  for (const secret of [fake, 'formato-estranho-mas-secreto-123']) {
    const out = execFileSync(process.execPath, [path.join(dir, 'scripts', 'write-google-oauth.cjs')], { env: { ...process.env, GOOGLE_OAUTH_JSON: secret }, encoding: 'utf8' });
    assert.ok(!out.includes(secret), 'segredo não aparece no log');
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config', 'google-oauth.json'), 'utf8')).installed.client_secret, fake);
});
