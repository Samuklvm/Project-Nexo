/* Painel do criador: erros agrupados (com quem avisar) e telemetria. HTML, CSS e JS servidos pelo próprio servidor. */

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const PANEL_LOCKED = (message) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Painel do Nexo</title><link rel="stylesheet" href="/painel/app.css"></head>
<body class="locked"><main><h1>Painel do Nexo</h1><p>${escape(message)}</p></main></body></html>`;

/*
 * Papel de parede do painel: céu noturno original (gerado aqui, sem imagem de terceiros) — gradiente, aurora, estrelas
 * com brilho, estrelas cadentes e o anel de órbita do Nexo. Servido como /painel/fundo.svg (a política de segurança
 * só aceita imagens do próprio servidor).
 */
/** Cor de uma estrela: a maioria branca, algumas azuladas e poucas quentes (sorteios na mesma ordem de antes). */
function starColor(rand) {
  if (rand() < 0.15) return 'bfe9ff';
  return rand() < 0.1 ? 'ffe6c2' : 'ffffff';
}

function starfield() {
  let seed = 20261110;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const stars = [];
  for (let i = 0; i < 260; i += 1) {
    const x = Math.round(rand() * 1600);
    const y = Math.round(rand() * 900 * (0.35 + rand() * 0.65));
    const r = (rand() < 0.06 ? 1.6 + rand() : 0.4 + rand() * 0.9).toFixed(2);
    const o = (0.35 + rand() * 0.65).toFixed(2);
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#${starColor(rand)}" opacity="${o}"/>`);
  }
  const meteors = [[1180, 120, 260], [420, 70, 190], [1420, 300, 150], [760, 40, 120]].map(([x, y, len], i) => `<line x1="${x}" y1="${y}" x2="${x - len}" y2="${y + len * 0.42}" stroke="url(#meteor)" stroke-width="${i ? 1.4 : 2.2}" stroke-linecap="round" opacity="${i ? 0.55 : 0.85}"/><circle cx="${x}" cy="${y}" r="${i ? 1.6 : 2.4}" fill="#e9f7ff"/>`);
  return { stars: stars.join(''), meteors: meteors.join('') };
}
const SKY = starfield();
export const PANEL_WALLPAPER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030616"/><stop offset=".55" stop-color="#0a1238"/><stop offset="1" stop-color="#151a52"/></linearGradient>
  <radialGradient id="glow" cx=".78" cy="-.05" r=".75"><stop offset="0" stop-color="#5a6cff" stop-opacity=".32"/><stop offset="1" stop-color="#5a6cff" stop-opacity="0"/></radialGradient>
  <radialGradient id="horizon" cx=".3" cy="1.15" r=".8"><stop offset="0" stop-color="#2fd4ff" stop-opacity=".22"/><stop offset="1" stop-color="#2fd4ff" stop-opacity="0"/></radialGradient>
  <linearGradient id="aurora1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3ee8c0" stop-opacity="0"/><stop offset=".35" stop-color="#3ee8c0" stop-opacity=".38"/><stop offset=".7" stop-color="#5ad7ff" stop-opacity=".3"/><stop offset="1" stop-color="#7b6cff" stop-opacity="0"/></linearGradient>
  <linearGradient id="aurora2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7b6cff" stop-opacity="0"/><stop offset=".45" stop-color="#9b7bff" stop-opacity=".3"/><stop offset="1" stop-color="#ff7bd5" stop-opacity="0"/></linearGradient>
  <linearGradient id="meteor" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset="1" stop-color="#5ad7ff" stop-opacity="0"/></linearGradient>
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ad7ff" stop-opacity=".5"/><stop offset="1" stop-color="#7b6cff" stop-opacity=".08"/></linearGradient>
  <filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>
  <filter id="twinkle"><feGaussianBlur stdDeviation=".6"/></filter>
</defs>
<rect width="1600" height="900" fill="url(#sky)"/>
<rect width="1600" height="900" fill="url(#glow)"/>
<rect width="1600" height="900" fill="url(#horizon)"/>
<g filter="url(#soft)"><path d="M-80 330 C 260 200, 520 360, 820 250 S 1380 120, 1700 230 L 1700 330 C 1380 240, 1100 380, 820 350 S 260 330, -80 430 Z" fill="url(#aurora1)"/><path d="M-80 470 C 300 380, 640 520, 980 420 S 1440 330, 1700 400 L 1700 470 C 1400 420, 1120 540, 900 500 S 300 470, -80 560 Z" fill="url(#aurora2)"/></g>
<g filter="url(#twinkle)">${SKY.stars}</g>
${SKY.meteors}
<g transform="translate(1340 760)" opacity=".75"><circle r="120" fill="#0d1440"/><circle r="120" fill="none" stroke="#5ad7ff" stroke-opacity=".25"/><ellipse rx="230" ry="46" fill="none" stroke="url(#ring)" stroke-width="3" transform="rotate(-16)"/><circle cx="-60" cy="-50" r="70" fill="#5a6cff" opacity=".12"/></g>
<path d="M0 900 L0 820 C 180 790, 300 840, 470 812 S 780 760, 980 800 S 1360 770, 1600 810 L 1600 900 Z" fill="#050820" opacity=".85"/>
</svg>`;

export const PANEL_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Painel do Nexo</title><link rel="stylesheet" href="/painel/app.css"></head>
<body>
<div class="wall" aria-hidden="true"></div>
<header class="top">
  <div class="brand"><svg class="mark" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ad7ff"/><stop offset="1" stop-color="#9b7bff"/></linearGradient></defs><circle cx="24" cy="24" r="22" fill="none" stroke="url(#mk)" stroke-opacity=".5"/><path d="M24 6 L28 20 L42 24 L28 28 L24 42 L20 28 L6 24 L20 20 Z" fill="url(#mk)"/></svg>
    <div><span class="badge">PAINEL DO CRIADOR</span><h1>Nexo Device Care</h1><p class="muted" id="who">Carregando…</p></div></div>
  <div class="top-actions"><span class="pill" id="updated">--</span><button id="refresh" type="button" class="ghost">Atualizar</button><button id="logout" type="button" class="ghost">Sair</button></div>
</header>
<section class="tiles" id="tiles" aria-live="polite"></section>
<nav class="tabs" role="tablist" aria-label="Seções do painel">
  <button type="button" role="tab" data-tab="geral" aria-selected="true">Visão geral</button>
  <button type="button" role="tab" data-tab="erros" aria-selected="false">Erros</button>
  <button type="button" role="tab" data-tab="usuarios" aria-selected="false">Usuários</button>
  <button type="button" role="tab" data-tab="telemetria" aria-selected="false">Telemetria</button>
  <button type="button" role="tab" data-tab="equipe" aria-selected="false" hidden>Equipe e acessos</button>
</nav>
<section id="tab-geral" role="tabpanel">
  <div class="cols">
    <div class="card wide"><h3>Usuários novos por dia <span class="muted small">(últimos 30 dias)</span></h3><div class="days tall" id="new-days"></div><p class="muted small" id="new-note"></p></div>
    <div class="card span2"><h3>O que mais limita os PCs</h3><p class="muted small">Minutos com carga por causa (últimos 30 dias). "GPU no limite" só conta com a placa em clock alto.</p><div id="geral-limiter"></div></div>
    <div class="card"><h3>Versões em uso <span class="muted small">(7 dias)</span></h3><div id="geral-versions"></div></div>
    <div class="card"><h3>Erros que mais precisam de atenção</h3><ul class="list compact" id="geral-errors"></ul></div>
  </div>
</section>
<section id="tab-erros" role="tabpanel" hidden>
  <div class="filters"><label class="sr" for="status">Situação</label><select id="status"><option value="">Abertos e reabertos primeiro (todos)</option><option value="aberto">Só abertos</option><option value="reaberto">Só reabertos</option><option value="corrigido">Corrigidos</option><option value="ignorado">Ignorados</option></select>
  <label class="check"><input type="checkbox" id="avisos"> Incluir avisos</label><label class="sr" for="busca">Filtrar</label><input id="busca" type="search" placeholder="Filtrar pela mensagem"></div>
  <div class="split"><ul class="list" id="errors"></ul><aside class="detail" id="detail"><p class="muted">Escolha um erro para ver os detalhes, a trilha do que aconteceu antes, quem avisar e marcar como corrigido.</p></aside></div>
</section>
<section id="tab-usuarios" role="tabpanel" hidden>
  <div class="cols">
    <div class="card wide"><h3>Como "usuário novo" é contado</h3><p class="muted">Cada instalação tem um código aleatório que fica nos dados do app. Ela conta como nova no dia em que o servidor a vê pela primeira vez (telemetria ou relatório de erro). Atualizar o app não cria código novo, então não infla como contar downloads. Quem deixa a telemetria e os erros desligados não aparece aqui.</p></div>
    <div class="card wide"><h3>Últimas instalações vistas pela primeira vez</h3><div class="table-wrap"><table class="nums" id="recent"><thead><tr><th>Primeira vez</th><th>Versão de entrada</th><th>Versão agora</th><th>Sistema</th><th>Chegou por</th><th>Última vez</th></tr></thead><tbody></tbody></table></div></div>
  </div>
</section>
<section id="tab-telemetria" role="tabpanel" hidden>
  <div class="filters"><label class="sr" for="dias">Período</label><select id="dias"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></div>
  <div id="telemetry"></div>
</section>
<section id="tab-equipe" role="tabpanel" hidden>
  <div class="cols">
    <div class="card"><h3>Equipe do painel</h3><p class="muted">Colaborador vê tudo e marca erros como corrigidos. Leitura só vê, sem os e-mails dos usuários. Só o dono adiciona e tira pessoas.</p>
      <ul class="list" id="team"></ul>
      <div class="row"><label class="sr" for="team-email">E-mail</label><input type="text" id="team-email" placeholder="e-mail Google da pessoa"><label class="sr" for="team-role">Papel</label><select id="team-role"><option value="colaborador">Colaborador</option><option value="leitura">Leitura</option></select><button type="button" id="team-add">Adicionar</button></div>
      <p class="muted">A pessoa entra pelo Nexo dela (Ajustes &gt; Painel do criador), logada com esse e-mail.</p></div>
    <div class="card"><h3>Chaves de acesso para ferramentas</h3><p class="muted">Só leitura dos erros, sem e-mails de usuários. Servem para a rotina que copia os erros abertos para o repositório privado. A chave aparece uma vez só.</p>
      <ul class="list" id="keys"></ul>
      <div class="row"><label class="sr" for="key-label">Nome da chave</label><input type="text" id="key-label" placeholder="Nome (ex.: relatórios no GitHub)"><button type="button" id="key-add">Criar chave</button></div>
      <div id="key-new"></div></div>
  </div>
</section>
<footer class="foot muted small">Painel privado · dados anônimos de telemetria e relatórios de erro de quem aceitou mandar · nada aqui identifica PCs.</footer>
<script src="/painel/app.js"></script>
</body></html>`;

export const PANEL_CSS = `
:root { color-scheme: dark; --bg: #050818; --card: rgba(13, 19, 52, 0.62); --card-strong: rgba(13, 19, 52, 0.82); --hair: rgba(150, 175, 255, 0.16); --hair-strong: rgba(150, 175, 255, 0.3); --ink: #eef2ff; --mist: #a3afdc; --star: #5ad7ff; --violet: #9b7bff; --rose: #ff5b6e; --ok: #46e6a0; --warn: #ffc15a; --radius: 16px; }
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; padding: 26px clamp(16px, 4vw, 44px) 40px; color: var(--ink); font: 14px/1.55 "Segoe UI Variable", "Segoe UI", system-ui, Roboto, sans-serif; min-height: 100vh; position: relative; }
.wall { position: fixed; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(5, 8, 24, 0.25), rgba(5, 8, 24, 0.7) 60%, rgba(5, 8, 24, 0.92)), url('/painel/fundo.svg') center / cover no-repeat, var(--bg); }
body.locked { display: grid; place-items: center; background: url('/painel/fundo.svg') center / cover no-repeat, var(--bg); }
body.locked main { max-width: 520px; padding: 28px 30px; text-align: center; border: 1px solid var(--hair); border-radius: var(--radius); background: var(--card-strong); backdrop-filter: blur(14px); }
h1 { margin: 4px 0 2px; font-size: 24px; letter-spacing: -.01em; }
h3 { margin: 0 0 10px; font-size: 15px; font-weight: 650; }
.muted { color: var(--mist); }
.small { font-size: 12px; font-weight: 400; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.badge { display: inline-block; padding: 2px 9px; border-radius: 99px; border: 1px solid rgba(255, 91, 110, 0.5); background: rgba(255, 91, 110, 0.1); color: #ff8a98; font-size: 10.5px; font-weight: 700; letter-spacing: .1em; }
.top { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
.brand { display: flex; align-items: center; gap: 14px; }
.mark { width: 48px; height: 48px; filter: drop-shadow(0 0 12px rgba(90, 215, 255, 0.45)); }
.top-actions { display: flex; gap: 8px; align-items: center; }
.pill { padding: 4px 10px; border-radius: 99px; border: 1px solid var(--hair); color: var(--mist); font-size: 12px; background: rgba(5, 8, 24, 0.5); }
button, select, input { font: inherit; color: inherit; }
button { padding: 7px 14px; border-radius: 11px; border: 1px solid var(--hair-strong); background: rgba(90, 215, 255, 0.14); cursor: pointer; transition: background .15s, border-color .15s; }
button:hover { background: rgba(90, 215, 255, 0.24); }
button:focus-visible, select:focus-visible, input:focus-visible, li[tabindex]:focus-visible { outline: 2px solid var(--star); outline-offset: 2px; }
button.ghost { background: rgba(5, 8, 24, 0.45); }
button.danger { border-color: rgba(255, 91, 110, 0.5); background: rgba(255, 91, 110, 0.14); }
button.ok { border-color: rgba(70, 230, 160, 0.5); background: rgba(70, 230, 160, 0.14); }
select, input[type=search], input[type=text] { padding: 8px 11px; border-radius: 11px; border: 1px solid var(--hair-strong); background: rgba(5, 8, 24, 0.7); }
.check { display: inline-flex; gap: 6px; align-items: center; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 20px; }
.tile { position: relative; overflow: hidden; padding: 14px 16px; border: 1px solid var(--hair); border-radius: var(--radius); background: var(--card); backdrop-filter: blur(12px); }
.tile::after { content: ""; position: absolute; inset: auto -30% -60% auto; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, rgba(90, 215, 255, 0.18), transparent 70%); }
.tile.new::after { background: radial-gradient(circle, rgba(70, 230, 160, 0.22), transparent 70%); }
.tile.bad::after { background: radial-gradient(circle, rgba(255, 91, 110, 0.22), transparent 70%); }
.tile span { font-size: 12px; }
.tile strong { display: block; font-size: 28px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.tile em { display: block; font-style: normal; font-size: 11.5px; color: var(--mist); }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; margin-bottom: 16px; border: 1px solid var(--hair); border-radius: 14px; background: rgba(5, 8, 24, 0.55); backdrop-filter: blur(10px); width: fit-content; max-width: 100%; }
.tabs button { border-color: transparent; background: transparent; border-radius: 10px; }
.tabs button[aria-selected=true] { background: linear-gradient(135deg, rgba(90, 215, 255, 0.28), rgba(155, 123, 255, 0.28)); border-color: var(--hair-strong); }
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
.filters input[type=search] { flex: 1 1 220px; max-width: 420px; }
.split { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 900px) { .split { grid-template-columns: minmax(0, 1fr); } }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.list li { padding: 11px 13px; border: 1px solid var(--hair); border-radius: 13px; background: var(--card); backdrop-filter: blur(10px); cursor: pointer; transition: border-color .15s, transform .15s; }
.list li:hover { border-color: var(--hair-strong); }
.list li.sel { border-color: var(--star); box-shadow: 0 0 0 1px rgba(90, 215, 255, 0.25), 0 8px 26px rgba(10, 20, 80, 0.35); }
.list.compact li { padding: 8px 11px; }
.list li strong { display: block; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { padding: 1px 8px; border-radius: 99px; border: 1px solid var(--hair); font-size: 12px; color: var(--mist); background: rgba(5, 8, 24, 0.35); }
.chip.aberto, .chip.erro { color: #ff8a98; border-color: rgba(255, 91, 110, 0.45); }
.chip.reaberto, .chip.aviso { color: var(--warn); border-color: rgba(255, 193, 90, 0.5); }
.chip.corrigido { color: var(--ok); border-color: rgba(70, 230, 160, 0.45); }
.detail { position: sticky; top: 12px; padding: 16px 18px; border: 1px solid var(--hair); border-radius: var(--radius); background: var(--card-strong); backdrop-filter: blur(14px); min-height: 200px; }
.detail pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: rgba(0, 0, 0, 0.4); padding: 10px; border-radius: 10px; max-height: 260px; overflow: auto; }
.detail .row, .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
.trail { margin: 8px 0; padding: 8px 10px 8px 26px; border-radius: 10px; background: rgba(0, 0, 0, 0.3); font: 12px/1.6 ui-monospace, "Cascadia Code", Consolas, monospace; }
.emails { font-size: 13px; overflow-wrap: anywhere; }
.emails .unconfirmed { color: var(--warn); }
.bars { display: grid; gap: 5px; }
.bar { display: grid; grid-template-columns: minmax(80px, 45%) minmax(40px, 1fr) auto; gap: 10px; align-items: center; font-size: 13px; }
.bar i { display: block; height: 10px; border-radius: 99px; background: linear-gradient(90deg, var(--violet), var(--star)); box-shadow: 0 0 10px rgba(90, 215, 255, 0.25); }
.bar span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 14px; }
.card { padding: 16px 18px; border: 1px solid var(--hair); border-radius: var(--radius); background: var(--card); backdrop-filter: blur(12px); }
.card.wide { grid-column: 1 / -1; }
@media (min-width: 980px) { .card.span2 { grid-column: span 2; } }
.days { display: flex; align-items: flex-end; gap: 3px; height: 120px; }
.days.tall { height: 150px; }
.days i { flex: 1; min-width: 4px; border-radius: 5px 5px 0 0; background: linear-gradient(180deg, var(--star), var(--violet)); opacity: .9; }
.days i.zero { background: var(--hair); min-height: 2px; }
h2.group { margin: 26px 0 10px; font-size: 16px; color: var(--mist); font-weight: 600; letter-spacing: .02em; }
.table-wrap { overflow-x: auto; }
table.nums { width: 100%; border-collapse: collapse; font-size: 13px; }
table.nums th, table.nums td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--hair); white-space: nowrap; }
table.nums th { color: var(--mist); font-weight: 600; }
table.nums td:not(:first-child), table.nums th:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
#recent td, #recent th { text-align: left; }
.foot { margin-top: 30px; text-align: center; }
@media (max-width: 640px) { .bar { grid-template-columns: minmax(70px, 50%) minmax(30px, 1fr) auto; } .tile strong { font-size: 22px; } h1 { font-size: 20px; } }
@media (prefers-reduced-transparency: reduce) { .card, .tile, .detail, .list li, .tabs { backdrop-filter: none; background: var(--card-strong); } }
`;

export const PANEL_JS = `
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String((v ?? null) === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const when = (ms) => ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
  const STATUS = { aberto: 'aberto', reaberto: 'voltou depois de corrigido', corrigido: 'corrigido', ignorado: 'ignorado' };
  const SOURCE = { principal: 'processo principal', interface: 'interface', ipc: 'ação do app', servico: 'serviço', processo: 'processo do app' };
  let groups = [];
  let selected = null;
  let can = new Set();
  const ROLE = { dono: 'dono', colaborador: 'colaborador', leitura: 'leitura' };

  async function api(path, options) {
    const response = await fetch('/painel/api/' + path, Object.assign({ credentials: 'same-origin', headers: { 'x-nexo-painel': '1', 'content-type': 'application/json' } }, options || {}));
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) { document.body.className = 'locked'; document.body.innerHTML = '<main><h1>Painel do Nexo</h1><p>A sessão acabou. Abra de novo pelo Nexo.</p></main>'; throw new Error('sessão'); }
    if (!response.ok) throw new Error(body.error || 'Erro');
    return body;
  }

  // Causas do "o que limita o PC" (classes fixas do app, src/bottleneck.js).
  const LIMITER = { gpu: 'Placa de vídeo no limite (de verdade)', 'gpu-energia': 'Placa de vídeo no teto de energia', 'gpu-calor': 'Placa de vídeo segurada pelo calor', 'gpu-vram': 'Memória de vídeo cheia',
    'gpu-baixo-clock': 'GPU "100%" mas em clock baixo', 'gpu-e-cpu': 'GPU e processador no limite', 'cpu-thread': 'Um núcleo do processador no limite', 'cpu-total': 'Processador inteiro no limite',
    'cpu-calor': 'Processador segurado pelo calor', memoria: 'Memória RAM no limite', 'limite-de-quadros': 'Limite de quadros / V-Sync', equilibrado: 'Sem gargalo claro' };
  let resumo = null;
  async function summary() {
    const s = resumo = await api('resumo');
    can = new Set(s.permissions || []);
    $('who').textContent = 'Entrou como ' + s.admin + ' (' + (ROLE[s.role] || s.role) + ')';
    $('updated').textContent = 'atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    document.querySelector('[data-tab="equipe"]').hidden = !can.has('equipe');
    const nu = s.newUsers || {};
    const tiles = [['new', 'Usuários novos hoje', nu.today ?? 0, ''], ['new', 'Novos em 7 dias', nu.days7 ?? 0, ''], ['new', 'Novos em 30 dias', nu.days30 ?? 0, ''],
      ['', 'PCs ativos (7 dias)', s.activeInstalls7, ''], ['', 'PCs ativos (30 dias)', s.activeInstalls30, ''], ['bad', 'Erros abertos', s.openErrors, ''], ['bad', 'PCs com erro (7 dias)', s.reportingInstalls7, ''],
      ['', 'Contas sincronizando', s.accounts, nu.accounts7 ? '+' + nu.accounts7 + ' em 7 dias' : '']];
    $('tiles').innerHTML = tiles.map(([tone, label, n, extra]) => '<div class="tile ' + tone + '"><span class="muted">' + esc(label) + '</span><strong>' + esc(n) + '</strong>' + (extra ? '<em>' + esc(extra) + '</em>' : '') + '</div>').join('');
    renderOverview();
  }

  /** Visão geral: usuários novos por dia, o que limita os PCs, versões e os erros que pedem atenção. */
  function dayBars(target, perDay, days) {
    const map = new Map((perDay || []).map((d) => [d.day, d.n]));
    const list = [];
    for (let i = days - 1; i >= 0; i -= 1) { const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); list.push({ day, n: map.get(day) || 0 }); }
    const max = Math.max(1, ...list.map((d) => d.n));
    target.innerHTML = list.map((d) => '<i class="' + (d.n ? '' : 'zero') + '" title="' + esc(d.day.split('-').reverse().join('/') + ': ' + d.n + ' novo(s)') + '" data-h="' + (d.n ? Math.max(4, (d.n / max) * 100) : 2) + '"></i>').join('');
    target.querySelectorAll('[data-h]').forEach((el) => { el.style.height = el.dataset.h + '%'; });
    return list.reduce((sum, d) => sum + d.n, 0);
  }
  function renderOverview() {
    if (!resumo) return;
    const total = dayBars($('new-days'), resumo.newUsers?.perDay, 30);
    $('new-note').textContent = total ? total + ' instalação(ões) nova(s) em 30 dias. Passe o mouse nas barras para ver o dia.' : 'Nenhuma instalação nova nos últimos 30 dias (ou ninguém novo ligou a telemetria/os erros).';
    $('geral-versions').innerHTML = bars((resumo.versions || []).map((v) => ({ key: v.version, n: v.n })));
    sizes($('geral-versions'));
    const recent = (resumo.newUsers?.recent || []);
    $('recent').querySelector('tbody').innerHTML = recent.length ? recent.map((r) => '<tr><td>' + esc(when(r.first_seen)) + '</td><td>' + esc(r.first_version) + '</td><td>' + esc(r.last_version) + '</td><td>' + esc(r.platform === 'win32' ? 'Windows' : r.platform === 'linux' ? 'Linux' : r.platform) + '</td><td>' + esc(r.via) + '</td><td>' + esc(when(r.last_seen)) + '</td></tr>').join('') : '<tr><td colspan="6" class="muted">Ainda ninguém.</td></tr>';
  }
  async function loadOverviewExtras() {
    try {
      const t = await api('telemetria?dias=30');
      $('geral-limiter').innerHTML = bars(nice(t.limiter, (key) => LIMITER[key] || key));
      sizes($('geral-limiter'));
    } catch { $('geral-limiter').innerHTML = '<p class="muted">Sem dados ainda.</p>'; }
    const top = groups.filter((g) => ['aberto', 'reaberto'].includes(g.status)).slice(0, 6);
    $('geral-errors').innerHTML = top.length ? top.map((g) => '<li tabindex="0" data-go="' + esc(g.signature) + '"><strong>' + esc(g.message) + '</strong><div class="chips"><span class="chip ' + esc(g.status) + '">' + esc(STATUS[g.status] || g.status) + '</span><span class="chip">' + esc(g.installs) + ' PC(s)</span><span class="chip">' + esc(g.occurrences) + '×</span></div></li>').join('') : '<li class="muted">Nenhum erro aberto. 🎉</li>';
  }
  const sizes = (root) => { root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; }); root.querySelectorAll('[data-h]').forEach((el) => { el.style.height = el.dataset.h + '%'; }); };

  async function loadErrors() {
    const params = new URLSearchParams();
    if ($('status').value) params.set('status', $('status').value);
    if ($('avisos').checked) params.set('avisos', '1');
    groups = (await api('erros?' + params)).groups;
    renderErrors();
  }
  function renderErrors() {
    const q = $('busca').value.trim().toLowerCase();
    const list = groups.filter((g) => !q || String(g.message).toLowerCase().includes(q));
    $('errors').innerHTML = list.length ? list.map((g) => '<li tabindex="0" data-sig="' + esc(g.signature) + '" class="' + (g.signature === selected ? 'sel' : '') + '"><strong>' + esc(g.message) + '</strong><div class="chips"><span class="chip ' + esc(g.status) + '">' + esc(STATUS[g.status] || g.status) + (g.fixed_in ? ' na ' + esc(g.fixed_in) : '') + '</span><span class="chip ' + esc(g.level) + '">' + esc(g.level) + '</span><span class="chip">' + esc(g.installs) + ' PC(s)</span><span class="chip">' + esc(g.occurrences) + '×</span><span class="chip">' + esc(g.emails) + ' e-mail(s)</span><span class="chip">versões ' + esc(g.versions || '--') + '</span><span class="chip">' + esc(when(g.last_at)) + '</span></div></li>').join('') : '<li class="muted">Nenhum erro aqui. 🎉</li>';
  }

  async function showDetail(signature) {
    selected = signature;
    renderErrors();
    const d = await api('erros/' + signature);
    const g = d.group;
    // A trilha (últimas ações antes do erro) vem dentro do contexto: mostrada como lista, o resto como texto.
    let context = g.context || '';
    let trail = [];
    try { const parsed = JSON.parse(context); if (parsed && Array.isArray(parsed.trilha)) { trail = parsed.trilha; delete parsed.trilha; context = Object.keys(parsed).length ? JSON.stringify(parsed) : ''; } } catch { /* contexto em texto */ }
    const info = d.emailInfo || d.emails.map((email) => ({ email, confirmed: true }));
    $('detail').innerHTML = '<h3>' + esc(g.message) + '</h3><div class="chips"><span class="chip ' + esc(g.status) + '">' + esc(STATUS[g.status] || g.status) + '</span><span class="chip ' + esc(g.level) + '">' + esc(g.level) + '</span><span class="chip">' + esc(SOURCE[g.source] || g.source) + '</span><span class="chip">#' + esc(g.signature) + '</span><span class="chip">desde ' + esc(when(g.first_at)) + '</span></div>'
      + (context ? '<p class="muted">Contexto: ' + esc(context) + '</p>' : '')
      + (trail.length ? '<p class="muted small">O que o app fez logo antes (mais antigo primeiro):</p><ol class="trail">' + trail.map((step) => '<li>' + esc(step) + '</li>').join('') + '</ol>' : '')
      + (g.stack ? '<pre>' + esc(g.stack) + '</pre>' : '<p class="muted">Sem detalhes técnicos.</p>')
      + (d.emailsHidden ? '<p class="muted">O seu papel no painel não mostra os e-mails dos usuários.</p>' : '<p><strong>' + d.emails.length + ' pessoa(s) para avisar</strong></p><div class="emails">' + (info.length ? info.map((item) => item.confirmed ? esc(item.email) : '<span class="unconfirmed" title="Informado pelo app (conta Google entrada no Nexo), sem a sincronização ligada">' + esc(item.email) + ' (não confirmado)</span>').join(', ') : '<span class="muted">Ninguém deixou o e-mail neste erro.</span>') + '</div>'
      + '<div class="row">' + (d.emails.length ? '<button type="button" id="copy-emails">Copiar e-mails</button>' : '') + '</div>')
      + (can.has('status') ? '<div class="row"><input type="text" id="fixed-in" placeholder="Corrigido na versão (ex.: 0.8.2)" value="' + esc(g.fixed_in || '') + '"><button type="button" class="ok" data-status="corrigido">Marcar como corrigido</button></div>'
      + '<div class="row"><input type="text" id="note" placeholder="Nota (opcional)" value="' + esc(g.note || '') + '"><button type="button" class="ghost" data-status="ignorado">Ignorar</button><button type="button" class="ghost" data-status="aberto">Reabrir</button></div>' : '')
      + '<p class="muted">' + d.reports.length + ' PC(s): ' + esc([...new Set(d.reports.map((r) => r.version + ' ' + r.platform))].join(' · ')) + '</p>';
    const copy = $('copy-emails');
    if (copy) copy.onclick = () => navigator.clipboard.writeText(d.emails.join(', ')).then(() => { copy.textContent = 'Copiado'; });
    $('detail').querySelectorAll('[data-status]').forEach((button) => { button.onclick = async () => {
      try { await api('erros/' + signature, { method: 'POST', body: JSON.stringify({ status: button.dataset.status, fixedIn: $('fixed-in').value.trim(), note: $('note').value.trim() }) }); await loadErrors(); await summary(); await showDetail(signature); }
      catch (error) { alert(error.message); }
    }; });
  }

  function bars(items, total) {
    const max = Math.max(1, ...items.map((i) => i.n));
    return '<div class="bars">' + (items.length ? items.slice(0, 12).map((i) => '<div class="bar"><span title="' + esc(i.key) + '">' + esc(i.key) + '</span><i data-w="' + Math.max(2, (i.n / max) * 100) + '"></i><span>' + esc(i.n) + '</span></div>').join('') : '<p class="muted">Sem dados ainda.</p>') + '</div>';
  }
  // Nomes legíveis para o que vem como código do app.
  const LABEL = {
    home: 'Início', analysis: 'Análise', hardware: 'Hardware', maintenance: 'Manutenção', optimize: 'Otimizar', sessions: 'Sessões', library: 'Jogos', atlas: 'Atlas', lab: 'Extremo', activity: 'Atividade', settings: 'Ajustes', updates: 'Atualizações',
    completo: 'Completo', leve: 'Leve', realtime: 'Tempo real', balanced: 'Equilibrada', eco: 'Econômica', jogos: 'Jogos', trabalho: 'Trabalho e criação', geral: 'Uso geral',
    busca: 'Buscou um recurso', filtro: 'Filtrou recursos', expandir: 'Abriu "ver mais" nos recursos', fixar: 'Fixou um recurso', acao: 'Botão de um recurso', paleta: 'Abriu a busca (Ctrl K)', novidades: 'Reabriu as novidades', 'novidades-sozinha': 'Viu as novidades depois de atualizar', meteoros: 'Pediu chuva de meteoros', tour: 'Fez o tour',
    fireflies: 'Vagalumes', twinkle: 'Estrelas piscando', meteors: 'Estrelas cadentes', showers: 'Chuva de meteoros', cursor: 'Vagalumes curiosos', skyHour: 'Céu acompanha a hora', wallpaper: 'Papel de parede próprio', autoClean: 'Limpeza automática', reducedMotion: 'Sistema pede menos movimento',
    autostart: 'Abre com o Windows', tray: 'Fica na bandeja', autoSession: 'Sessão automática', onlineCovers: 'Capas online',
    instalador: 'Instalador do Windows', appimage: 'AppImage', deb: 'Pacote .deb', win32: 'Windows', linux: 'Linux', darwin: 'macOS'
  };
  const nice = (items, fmt) => (items || []).map((i) => ({ key: fmt ? fmt(i.key) : (LABEL[i.key] || i.key), n: i.n }));
  const minutes = (items) => (items || []).map((i) => ({ key: LABEL[i.key] || i.key, n: Math.round(i.n / 60) }));
  async function loadTelemetry() {
    const t = await api('telemetria?dias=' + $('dias').value);
    const max = Math.max(1, ...t.activeByDay.map((d) => d.n));
    const card = (title, items, note) => '<div class="card"><h3>' + esc(title) + '</h3>' + (note ? '<p class="muted small">' + esc(note) + '</p>' : '') + bars(items) + '</div>';
    const group = (title, cards) => '<h2 class="group">' + esc(title) + '</h2><div class="cols">' + cards.join('') + '</div>';
    const numbers = (t.numbers || []).length
      ? '<div class="card wide"><h3>Números do dia (entre os resumos diários do período)</h3><table class="nums"><thead><tr><th>Medida</th><th>Mediana</th><th>9 em cada 10 até</th><th>Resumos</th></tr></thead><tbody>'
        + t.numbers.map((m) => '<tr><td>' + esc(m.key) + '</td><td>' + esc(String(m.median).replace('.', ',')) + '</td><td>' + esc(String(m.p90).replace('.', ',')) + '</td><td>' + esc(m.n) + '</td></tr>').join('') + '</tbody></table></div>'
      : '';
    $('telemetry').innerHTML = '<div class="card"><h3>PCs ativos por dia · ' + esc(t.installs) + ' PC(s) e ' + esc(t.reports || 0) + ' resumo(s) diário(s) no período</h3><div class="days">' + t.activeByDay.map((d) => '<i title="' + esc(d.day + ': ' + d.n) + '" data-h="' + Math.max(3, (d.n / max) * 100) + '"></i>').join('') + '</div></div>'
      + group('Os PCs', [card('Versões', t.versions), card('Sistema', nice(t.platforms)), card('Como instalou', nice(t.channels)), card('Idioma', t.locales), card('Processador', t.cpus), card('Modelo do processador', t.cpuModels), card('Threads', t.cores), card('Memória', t.ram), card('Placa de vídeo', t.gpus), card('Modelo da placa de vídeo', t.gpuModels), card('Sensores', t.sensors)])
      + group('Monitores', [card('Quantos monitores', t.monitors), card('Resolução', t.resolutions), card('Taxa de atualização', t.refresh), card('Escala do Windows', t.scales)])
      + group('Como o Nexo está configurado', [card('Efeitos visuais', nice(t.effects)), card('Cor de destaque', t.accents), card('Quantidade no céu', t.skyDensity), card('Céu e aparência ligados', nice(t.skyFlags)), card('Perfil de uso', nice(t.profiles)), card('Ritmo das leituras', nice(t.liveRates)), card('Opções do app ligadas', nice(t.appFlags)), card('Jogos por loja (soma)', t.stores)])
      + group('O que limita os PCs', [card('Causa nos minutos com carga', nice(t.limiter, (key) => LIMITER[key] || key), 'Somando os PCs: GPU "no limite" só conta com a placa em clock alto; ocupada mas devagar aparece separada.'),
        card('Causa nas sessões de jogo', nice(t.sessionLimiter, (key) => LIMITER[key] || key), 'O veredito de cada sessão gravada (com PresentMon, quem segurou os quadros decide).')])
      + group('Uso', [card('Telas mais abertas', nice(t.views)), card('Tempo em foco por tela (minutos)', minutes(t.viewTime)), card('Recursos usados', t.features), card('Botões dos cartões de recurso', t.actions), card('Atalhos e extras', nice(t.ui))])
      + (numbers ? group('Desempenho e saúde', [numbers]) : '')
      + group('Diagnóstico do app', [
        card('Ações internas que mais falham', t.ipcFails, 'Canal IPC e quantas falhas (muitas são esperadas, como recusar o UAC).'),
        card('Ações internas mais lentas (ms, média)', t.ipcSlow), card('Pior tempo de cada ação (ms)', t.ipcMax),
        card('Quedas, travadas e erros', t.events, 'telaFechou, gpuCaiu, processoCaiu, janelaTravou e erros por origem.'),
        card('Cartões que ficam sem dado', t.featsEmpty, 'Quantos PCs viram o cartão vazio no dia: dado que falta ou leitura que não funciona ali.'),
        card('Cartões cujo cálculo quebrou', t.featsCrashed), card('Fontes de dados que falham', t.sourceFails), card('Fontes mais lentas (ms, média)', t.sourceSlow)])
      + group('Instalações', [card('Tempo de uso do Nexo', t.ageDays), card('De qual versão atualizou', t.updatedFrom)]);
    // A política de segurança do painel não aceita style="" no HTML: tamanhos entram pelo JavaScript.
    $('telemetry').querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; });
    $('telemetry').querySelectorAll('[data-h]').forEach((el) => { el.style.height = el.dataset.h + '%'; });
  }

  async function loadTeam() {
    const t = await api('equipe');
    $('team').innerHTML = t.owners.map((email) => '<li><strong>' + esc(email) + '</strong><div class="chips"><span class="chip corrigido">dono</span></div></li>').join('')
      + t.members.map((m) => '<li><strong>' + esc(m.email) + '</strong><div class="chips"><span class="chip">' + esc(m.role) + '</span><span class="chip">adicionado por ' + esc(m.added_by) + ' em ' + esc(when(m.added_at)) + '</span></div><div class="row"><button type="button" class="ghost" data-remove="' + esc(m.email) + '">Tirar da equipe</button></div></li>').join('');
    const k = await api('chaves');
    $('keys').innerHTML = k.keys.length ? k.keys.map((key) => '<li><strong>' + esc(key.label) + '</strong><div class="chips"><span class="chip ' + (key.revoked ? 'ignorado' : 'corrigido') + '">' + (key.revoked ? 'revogada' : 'ativa') + '</span><span class="chip">criada em ' + esc(when(key.created_at)) + '</span><span class="chip">último uso ' + esc(when(key.last_used)) + '</span></div>' + (key.revoked ? '' : '<div class="row"><button type="button" class="danger" data-revoke="' + esc(key.id) + '">Revogar</button></div>') + '</li>').join('') : '<li class="muted">Nenhuma chave criada.</li>';
  }
  $('team-add').onclick = async () => { try { await api('equipe', { method: 'POST', body: JSON.stringify({ email: $('team-email').value.trim(), role: $('team-role').value }) }); $('team-email').value = ''; await loadTeam(); } catch (error) { alert(error.message); } };
  $('key-add').onclick = async () => {
    try {
      const created = await api('chaves', { method: 'POST', body: JSON.stringify({ label: $('key-label').value.trim() }) });
      $('key-new').innerHTML = '<p><strong>Copie agora: esta chave não aparece de novo.</strong></p><pre id="key-text"></pre><button type="button" id="key-copy">Copiar chave</button>';
      $('key-text').textContent = created.key;
      $('key-copy').onclick = () => navigator.clipboard.writeText(created.key).then(() => { $('key-copy').textContent = 'Copiada'; });
      $('key-label').value = '';
      await loadTeam();
    } catch (error) { alert(error.message); }
  };
  $('tab-equipe').onclick = async (event) => {
    const remove = event.target.closest('[data-remove]');
    const revoke = event.target.closest('[data-revoke]');
    try {
      if (remove && confirm('Tirar ' + remove.dataset.remove + ' da equipe?')) { await api('equipe/remover', { method: 'POST', body: JSON.stringify({ email: remove.dataset.remove }) }); await loadTeam(); }
      if (revoke && confirm('Revogar esta chave? A rotina que usa ela para de funcionar.')) { await api('chaves/revogar', { method: 'POST', body: JSON.stringify({ id: revoke.dataset.revoke }) }); await loadTeam(); }
    } catch (error) { alert(error.message); }
  };

  document.querySelectorAll('[data-tab]').forEach((button) => { button.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === button)));
    for (const name of ['geral', 'erros', 'usuarios', 'telemetria', 'equipe']) $('tab-' + name).hidden = button.dataset.tab !== name;
    if (button.dataset.tab === 'telemetria') loadTelemetry();
    if (button.dataset.tab === 'equipe') loadTeam().catch((error) => alert(error.message));
  }; });
  $('errors').onclick = (event) => { const li = event.target.closest('li[data-sig]'); if (li) showDetail(li.dataset.sig); };
  $('errors').onkeydown = (event) => { const li = event.target.closest('li[data-sig]'); if (li && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); showDetail(li.dataset.sig); } };
  const goToError = (li) => { if (!li) return; document.querySelector('[data-tab="erros"]').click(); showDetail(li.dataset.go); };
  $('geral-errors').onclick = (event) => goToError(event.target.closest('li[data-go]'));
  $('geral-errors').onkeydown = (event) => { if (event.key === 'Enter') goToError(event.target.closest('li[data-go]')); };
  $('refresh').onclick = () => { summary().then(loadErrors).then(loadOverviewExtras).catch(() => {}); };
  $('status').onchange = loadErrors;
  $('avisos').onchange = loadErrors;
  $('busca').oninput = renderErrors;
  $('dias').onchange = loadTelemetry;
  $('logout').onclick = async () => { await api('sair', { method: 'POST' }).catch(() => {}); location.reload(); };
  summary().then(loadErrors).then(loadOverviewExtras).catch(() => {});
})();
`;
