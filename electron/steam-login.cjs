/*
 * "Entrar com a Steam" no app. O navegador abre a página oficial da Steam pelo servidor do Nexo (que confere a
 * resposta com a própria Steam) e o passe assinado com o SteamID volta só para este PC, em 127.0.0.1.
 * Depois, perfil, jogos da conta e conquistas vêm pelo servidor, com a chave da Steam do criador: a pessoa não
 * precisa criar nem colar chave nenhuma. Nenhuma senha passa pelo Nexo.
 */
const crypto = require('node:crypto');

const ID64 = /^7656119\d{10}$/;
const base64url = (bytes) => Buffer.from(bytes).toString('base64url');

const PAGE = (ok, text) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Nexo e Steam</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b1f;color:#eef2ff;font:16px/1.5 system-ui,"Segoe UI",sans-serif}main{max-width:460px;padding:28px;border:1px solid rgba(150,175,255,.2);border-radius:18px;background:rgba(16,24,60,.7);text-align:center}h1{font-size:20px;margin:0 0 8px}</style></head>
<body><main><h1>${ok ? 'Steam conectada ao Nexo' : 'Não deu para entrar com a Steam'}</h1><p>${text}</p></main></body></html>`;

/** SteamID dentro do passe (o servidor é quem confere a assinatura; aqui só lemos e vemos se não venceu). */
function steamIdOfPass(pass, now = Date.now()) {
  const [body, signature, extra] = String(pass || '').split('.');
  if (!body || !signature || extra !== undefined || body.length > 600) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload?.typ === 'steam' && ID64.test(String(payload.steam)) && Number(payload.exp) > now ? String(payload.steam) : null;
  } catch { return null; }
}

/** Abre o login da Steam e espera o passe voltar (até 5 minutos). */
function signIn({ serverUrl, createServer, openExternal, randomBytes = crypto.randomBytes, timeoutMs = 5 * 60 * 1000 }) {
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(String(serverUrl || ''))) return Promise.reject(new Error('O servidor do Nexo não está configurado nesta versão.'));
  const state = base64url(randomBytes(24));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/steam') { response.writeHead(404); response.end(); return; }
      // Outro estado: não é o nosso pedido (uma aba velha, por exemplo). Responde, mas continua esperando o certo.
      if (url.searchParams.get('state') !== state) { response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(PAGE(false, 'Este link de login é antigo. Tente de novo pelo Nexo.')); return; }
      const pass = url.searchParams.get('pass');
      const steamId = steamIdOfPass(pass);
      response.writeHead(steamId ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(PAGE(Boolean(steamId), steamId ? 'Pode fechar esta aba e voltar ao aplicativo.' : 'O passe da Steam veio estranho. Tente de novo pelo Nexo.'));
      if (steamId) done(null, { pass, steamId }); else done(new Error('O passe da Steam veio estranho. Tente de novo.'));
    });
    const timer = setTimeout(() => done(new Error('O login da Steam demorou demais e foi cancelado.')), timeoutMs);
    function done(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch { /* já fechado */ }
      if (error) reject(error); else resolve(value);
    }
    server.on('error', (error) => done(error));
    server.listen(0, '127.0.0.1', () => {
      const url = `${serverUrl}/v1/steam/start?${new URLSearchParams({ port: String(server.address().port), state })}`;
      Promise.resolve(openExternal(url)).catch((error) => done(error));
    });
  });
}

/** Pedido ao servidor com o passe. 401 vira erro com status (o app então pede para entrar de novo). */
async function api({ serverUrl, fetchImpl, pass, route, version = '0' }) {
  let response;
  try { response = await fetchImpl(`${serverUrl}${route}`, { headers: { accept: 'application/json', authorization: `Bearer ${pass}`, 'user-agent': `NexoDeviceCare/${version}` } }); } catch { throw new Error('Sem conexão com o servidor do Nexo agora.'); }
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw Object.assign(new Error(data.error || `O servidor respondeu ${response.status}.`), { status: response.status });
  return data;
}

module.exports = { signIn, api, steamIdOfPass };
