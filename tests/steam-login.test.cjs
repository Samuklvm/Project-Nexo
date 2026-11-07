/*
 * "Entrar com a Steam" (server/src/steam.js) com uma Steam de mentira: o servidor só aceita a resposta que a própria
 * Steam confirma, devolve o passe só para o app neste PC (127.0.0.1) e a chave da Steam nunca sai do servidor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createD1 } = require('../server/test/d1-sqlite.cjs');

const KEY = 'ABCDEF0123456789ABCDEF0123456789';
const SID = '76561198000000001';
const ORIGIN = 'https://nexo-api.exemplo.workers.dev';
let mod;
let clock = Date.UTC(2026, 10, 6, 15);

function world({ valid = true, key = KEY, ownedVisible = true } = {}) {
  const env = { DB: createD1(), SESSION_SECRET: 's'.repeat(48), DATA_KEY: 'd'.repeat(48), GOOGLE_CLIENT_IDS: 'x.apps.googleusercontent.com', STEAM_API_KEY: key };
  const steamCalls = [];
  const fetchImpl = async (url, init = {}) => {
    steamCalls.push({ url: String(url), method: init.method || 'GET', body: init.body });
    if (String(url) === 'https://steamcommunity.com/openid/login') return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`);
    const u = new URL(url);
    if (u.pathname.includes('GetPlayerSummaries')) return Response.json({ response: { players: [{ steamid: SID, personaname: 'LeaveMeAloneBruh', avatarfull: 'https://avatars.steamstatic.com/abc_full.jpg', communityvisibilitystate: 3 }] } });
    if (u.pathname.includes('GetOwnedGames')) return Response.json({ response: ownedVisible ? { game_count: 2, games: [{ appid: 1091500, name: 'Cyberpunk 2077', playtime_forever: 8640, rtime_last_played: 1794000000 }, { appid: 105600, name: 'Terraria', playtime_forever: 600 }] } : {} });
    if (u.pathname.includes('GetRecentlyPlayedGames')) return Response.json({ response: { games: [{ appid: 1091500, playtime_2weeks: 300 }] } });
    if (u.pathname.includes('GetSchemaForGame')) return Response.json({ game: { availableGameStats: { achievements: [{ name: 'A1', displayName: 'Primeira', description: 'x', hidden: 0, icon: 'https://cdn.steamstatic.com/a1.jpg', icongray: 'https://cdn.steamstatic.com/a1g.jpg' }, { name: 'A2', displayName: 'Segunda', hidden: 1, icon: 'https://cdn.steamstatic.com/a2.jpg' }] } } });
    if (u.pathname.includes('GetPlayerAchievements')) return Response.json({ playerstats: { achievements: [{ apiname: 'A1', achieved: 1, unlocktime: 1794000000 }, { apiname: 'A2', achieved: 0, unlocktime: 0 }] } });
    if (u.pathname.includes('GetGlobalAchievementPercentagesForApp')) return Response.json({ achievementpercentages: { achievements: [{ name: 'A1', percent: 41.2 }, { name: 'A2', percent: '3.1' }] } });
    return new Response('?', { status: 404 });
  };
  const app = mod.createApp({ fetchImpl, now: () => clock });
  const call = async (path, { token, headers = {} } = {}) => {
    const init = { method: 'GET', headers: { ...headers } };
    if (token) init.headers.authorization = `Bearer ${token}`;
    return app.fetch(new Request(`${ORIGIN}${path}`, init), env, { waitUntil() {} });
  };
  return { call, steamCalls, env };
}

/** O que a Steam mandaria de volta para o servidor depois do login. */
function steamReturn(port, state, overrides = {}) {
  const returnTo = `${ORIGIN}/v1/steam/back?port=${port}&state=${state}`;
  const claimed = `https://steamcommunity.com/openid/id/${SID}`;
  const params = new URLSearchParams({ port: String(port), state, 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': claimed, 'openid.identity': claimed, 'openid.return_to': returnTo, 'openid.response_nonce': '2026-11-06T15:00:00Zabc', 'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'c2lnbmF0dXJh', ...overrides });
  return `/v1/steam/back?${params}`;
}

test.before(async () => { mod = await import('../server/src/app.js'); });

test('Steam: o login vai para a página oficial e o passe volta só para o app neste PC', async () => {
  const { call, steamCalls } = world();
  const state = 'estado-aleatorio-123456';
  const start = await call(`/v1/steam/start?port=51234&state=${state}`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  assert.equal(`${to.origin}${to.pathname}`, 'https://steamcommunity.com/openid/login');
  assert.equal(to.searchParams.get('openid.realm'), ORIGIN);
  assert.equal(to.searchParams.get('openid.return_to'), `${ORIGIN}/v1/steam/back?port=51234&state=${state}`);
  // Pedido incompleto ou porta estranha: nada de redirecionar.
  for (const bad of ['/v1/steam/start?port=80&state=' + state, '/v1/steam/start?port=51234&state=curto', '/v1/steam/start']) assert.equal((await call(bad)).status, 400, bad);

  const back = await call(steamReturn(51234, state));
  assert.equal(back.status, 302);
  const local = new URL(back.headers.get('location'));
  assert.equal(local.origin, 'http://127.0.0.1:51234', 'o passe só vai para este PC');
  assert.equal(local.searchParams.get('state'), state);
  const pass = local.searchParams.get('pass');
  assert.ok(pass && pass.length > 40);
  const check = steamCalls.find((c) => c.method === 'POST');
  assert.ok(check, 'o servidor perguntou à Steam');
  assert.match(check.body, /openid\.mode=check_authentication/);

  // Com o passe: perfil, jogos e conquistas, pela chave do servidor (que nunca aparece na resposta).
  const me = await (await call('/v1/steam/me', { token: pass })).json();
  assert.deepEqual(me, { steamId: SID, personaName: 'LeaveMeAloneBruh', avatar: 'https://avatars.steamstatic.com/abc_full.jpg', public: true });
  const lib = await (await call('/v1/steam/library', { token: pass })).json();
  assert.equal(lib.visible, true);
  assert.deepEqual(lib.games[0], { appid: '1091500', name: 'Cyberpunk 2077', playtimeMin: 8640, lastPlayed: 1794000000000, twoWeeksMin: 300 });
  const ach = await (await call('/v1/steam/achievements?appid=1091500', { token: pass })).json();
  assert.equal(ach.defs.length, 2);
  assert.deepEqual(ach.mine[0], { apiname: 'A1', achieved: 1, unlocktime: 1794000000 });
  assert.equal(ach.private, false);
  assert.equal(ach.rarity[1].percent, 3.1);
  // O app monta a lista com o mesmo código de quando a pessoa usa a própria chave.
  const { fromServer } = require('../electron/steam-details.cjs');
  const parsed = fromServer(ach);
  assert.equal(parsed.state, 'ok');
  assert.equal(parsed.unlocked, 1);
  assert.equal(parsed.total, 2);
  assert.equal(parsed.list[0].name, 'Primeira');
  assert.equal(parsed.list[1].description, null, 'conquista secreta não mostra a descrição');
  for (const body of [me, lib, ach]) assert.ok(!JSON.stringify(body).includes(KEY), 'a chave nunca sai do servidor');
  assert.equal((await call('/v1/steam/achievements?appid=abc', { token: pass })).status, 400);
});

test('Steam: resposta não confirmada, adulterada ou para outro pedido não vira passe', async () => {
  const state = 'estado-aleatorio-123456';
  const denied = world({ valid: false });
  assert.equal((await denied.call(steamReturn(51234, state))).status, 400, 'a Steam disse que não vale');
  const { call } = world();
  assert.equal((await call(steamReturn(51234, state, { 'openid.return_to': `${ORIGIN}/v1/steam/back?port=6666&state=${state}` }))).status, 400, 'outro pedido');
  assert.equal((await call(steamReturn(51234, state, { 'openid.claimed_id': 'https://evil.example/openid/id/76561198000000001' }))).status, 400, 'conta que não é da Steam');
  assert.equal((await call(steamReturn(51234, state, { 'openid.op_endpoint': 'https://evil.example/openid' }))).status, 400, 'outro provedor');
  assert.equal((await call(steamReturn(51234, state, { 'openid.mode': 'cancel' }))).status, 400);
  // Sem passe, com passe de outro tipo ou vencido: 401.
  assert.equal((await call('/v1/steam/me')).status, 401);
  const crypto0 = await import('../server/src/crypto.js');
  const session = await crypto0.signToken({ sid: 'sessao-qualquer', exp: clock + 1000 }, 's'.repeat(48));
  assert.equal((await call('/v1/steam/me', { token: session })).status, 401, 'sessão do Google não serve como passe da Steam');
  const old = await crypto0.signToken({ typ: 'steam', steam: SID, exp: clock - 1 }, 's'.repeat(48));
  assert.equal((await call('/v1/steam/library', { token: old })).status, 401);
});

test('Steam: perfil fechado e servidor sem chave dão respostas claras', async () => {
  const crypto0 = await import('../server/src/crypto.js');
  const pass = await crypto0.signToken({ typ: 'steam', steam: SID, exp: clock + 1e9 }, 's'.repeat(48));
  const closed = world({ ownedVisible: false });
  assert.deepEqual(await (await closed.call('/v1/steam/library', { token: pass })).json(), { steamId: SID, visible: false, games: [] });
  const nokey = world({ key: '' });
  const answer = await nokey.call('/v1/steam/library', { token: pass });
  assert.equal(answer.status, 503);
  assert.match((await answer.json()).error, /não está configurada/);
});
