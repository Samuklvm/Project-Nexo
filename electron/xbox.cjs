/*
 * Conta Xbox / Microsoft (opcional). Mesmo princípio do login Google: navegador padrão + PKCE + loopback, sem guardar tokens.
 *  1. Microsoft identity (consumidores), escopo XboxLive.signin → token de acesso;
 *  2. Xbox Live: token de usuário (user.auth.xboxlive.com) e XSTS (xsts.auth.xboxlive.com);
 *  3. lê o perfil (gamertag e foto) e o histórico de jogos com as artes OFICIAIS de cada título (titlehub).
 * Depois disso os tokens são descartados; fica só o que a interface mostra. "Atualizar" pede o login de novo
 * (o navegador costuma lembrar a sessão, então é rápido).
 * Exige um app registrado no Azure (ID do cliente, tipo "cliente público", redirecionamento http://localhost).
 */
const { loopbackAuthorize } = require('./account.cjs');

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin';
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildMicrosoftUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

/** Converte o histórico do titlehub no que a interface usa: nome, plataformas, última vez e a melhor arte vertical. */
function parseTitleHistory(data) {
  const titles = Array.isArray(data?.titles) ? data.titles : [];
  const rank = { BoxArt: 0, Poster: 1, Tile: 2 };
  return titles.filter((title) => title && title.name && title.type !== 'App').map((title) => {
    const images = (Array.isArray(title.images) ? title.images : []).filter((image) => typeof image?.url === 'string' && rank[image.type] !== undefined).sort((a, b) => rank[a.type] - rank[b.type]);
    const pick = images[0]?.url || title.displayImage || null;
    const image = typeof pick === 'string' && /^https?:\/\/[\w.-]+\.(xboxlive|xbox|s-microsoft|microsoft)\.com\//.test(pick) ? pick.replace(/^http:/, 'https:') : null;
    return { titleId: String(title.titleId || '').replace(/\D/g, ''), name: String(title.name).slice(0, 120), devices: Array.isArray(title.devices) ? title.devices.map(String).slice(0, 6) : [],
      lastPlayed: Date.parse(title.titleHistory?.lastTimePlayed) || null, image };
  }).slice(0, 400);
}

function parseProfile(data) {
  const settings = data?.profileUsers?.[0]?.settings || [];
  const get = (id) => settings.find((item) => item.id === id)?.value || null;
  const picture = get('GameDisplayPicRaw');
  return { gamertag: String(get('Gamertag') || 'Xbox').slice(0, 40), picture: picture && /^https:\/\//.test(picture) ? picture : null };
}

async function signIn({ clientId, createServer, openExternal, fetch }) {
  if (!CLIENT_ID.test(String(clientId))) throw new Error('A conta Xbox ainda não foi configurada nesta build.');
  const { code, redirectUri, verifier } = await loopbackAuthorize({ host: '127.0.0.1', redirectHost: 'localhost', appName: 'Nexo', createServer, openExternal,
    buildUrl: ({ redirectUri: uri, challenge, state }) => buildMicrosoftUrl({ clientId, redirectUri: uri, challenge, state }) });
  const json = async (url, init) => { const response = await fetch(url, init); const body = await response.json().catch(() => ({})); if (!response.ok) { throw new Error(body.error_description || body.Message || `${new URL(url).host} respondeu ${response.status}`); } return body; };
  const token = await json(`${AUTHORITY}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPE }).toString() });
  const user = await json('https://user.auth.xboxlive.com/user/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({ RelyingParty: 'http://auth.xboxlive.com', /* NOSONAR: identificador fixo exigido pela Xbox Live, não URL acessada */ TokenType: 'JWT', Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${token.access_token}` } }) });
  const xsts = await json('https://xsts.auth.xboxlive.com/xsts/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({ RelyingParty: 'http://xboxlive.com', /* NOSONAR: idem */ TokenType: 'JWT', Properties: { SandboxId: 'RETAIL', UserTokens: [user.Token] } }) });
  const claims = xsts.DisplayClaims?.xui?.[0] || {};
  if (!claims.uhs || !claims.xid) throw new Error('A Xbox Live não devolveu a identificação da conta (a conta precisa ter um perfil Xbox).');
  const auth = { Authorization: `XBL3.0 x=${claims.uhs};${xsts.Token}`, 'x-xbl-contract-version': '2', Accept: 'application/json', 'Accept-Language': 'pt-BR' };
  const profile = parseProfile(await json(`https://profile.xboxlive.com/users/xuid(${claims.xid})/profile/settings?settings=Gamertag,GameDisplayPicRaw`, { headers: auth }));
  const titles = parseTitleHistory(await json(`https://titlehub.xboxlive.com/users/xuid(${claims.xid})/titles/titlehistory/decoration/image,detail`, { headers: auth }).catch(() => ({ titles: [] })));
  return { profile, titles };
}

module.exports = { signIn, buildMicrosoftUrl, parseTitleHistory, parseProfile, CLIENT_ID, SCOPE };
