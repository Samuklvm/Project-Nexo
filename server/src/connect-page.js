/*
 * Página "Conectar o Claude ao painel do Nexo" (autorização do OAuth do conector).
 *
 * O HTML não leva dado nenhum: a janela vem do claude.ai (outro site), então o cookie do painel (SameSite=Strict) não
 * vem junto na abertura. O script da página pergunta /painel/api/conectar/quem: esse pedido sai do próprio site e
 * leva o cookie. Daí a página mostra o consentimento ou o passo a passo para abrir o painel.
 * Visual: o céu do painel, cartão de vidro com borda de aurora e a constelação ligando o Claude ao Nexo.
 */

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Marca do Nexo (a mesma do painel) e um nó de IA genérico para o lado do Claude (sem logotipo de terceiros). */
const NEXO_MARK = '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="cx-n" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ad7ff"/><stop offset="1" stop-color="#9b7bff"/></linearGradient></defs><circle cx="24" cy="24" r="22" fill="none" stroke="url(#cx-n)" stroke-opacity=".55"/><path d="M24 6 L28 20 L42 24 L28 28 L24 42 L20 28 L6 24 L20 20 Z" fill="url(#cx-n)"/></svg>';
const AI_MARK = '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="cx-a" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ffd59a"/><stop offset="1" stop-color="#ff9ec7"/></linearGradient></defs><g stroke="url(#cx-a)" stroke-width="2" stroke-linecap="round" fill="none"><path d="M15 31 L24 15 L33 31 Z" stroke-opacity=".55"/></g><g fill="url(#cx-a)"><circle cx="24" cy="15" r="4.2"/><circle cx="15" cy="31" r="4.2"/><circle cx="33" cy="31" r="4.2"/><circle cx="24" cy="25.5" r="2.2" fill-opacity=".8"/></g></svg>';

const shell = (inner) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Conectar o Claude · Painel do Nexo</title><link rel="stylesheet" href="/painel/conectar.css"></head>
<body><div class="sky" aria-hidden="true"></div><main class="card" aria-live="polite">
<div class="link" aria-hidden="true"><span class="orb ai">${AI_MARK}</span><svg class="beam" viewBox="0 0 160 20" preserveAspectRatio="none"><defs><linearGradient id="cx-b" gradientUnits="userSpaceOnUse" x1="4" y1="10" x2="156" y2="10"><stop offset="0" stop-color="#ffb8a8"/><stop offset="1" stop-color="#5ad7ff"/></linearGradient></defs><line x1="4" y1="10" x2="156" y2="10" stroke="url(#cx-b)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 7"/><circle class="spark" cx="4" cy="10" r="3" fill="#eef2ff"/></svg><span class="orb nexo">${NEXO_MARK}</span></div>
${inner}
</main><script src="/painel/conectar.js"></script></body></html>`;

/** A página de autorização: estados que o script liga e desliga (nenhum dado do servidor no HTML). */
export const CONNECT_HTML = shell(`
<section data-state="carregando"><p class="eyebrow">CONECTOR DO CLAUDE</p><h1>Conferindo o painel…</h1><p class="muted">Um instante.</p></section>
<section data-state="consentir" hidden>
  <p class="eyebrow">CONECTOR DO CLAUDE</p>
  <h1>Conectar o <span class="grad">Claude</span> ao painel do Nexo</h1>
  <p class="muted who">Autorizando como <strong data-who></strong> · papel: <strong data-role></strong></p>
  <ul class="can">
    <li class="yes"><i>✓</i><span><strong>Ver métricas, usuários e telemetria</strong><small>só números agregados e anônimos</small></span></li>
    <li class="yes"><i>✓</i><span><strong>Ver erros</strong><small>pilha, contexto, versões e sistemas</small></span></li>
    <li class="yes" data-write><i>✓</i><span><strong>Marcar erros como corrigidos ou abertos</strong><small>cada mudança fica em "O que o Claude fez"</small></span></li>
  </ul>
  <div class="never"><span>Nunca:</span><b>✕ E-mails dos usuários</b><b>✕ Equipe</b><b>✕ Chaves</b></div>
  <p class="warn small"><strong>Só autorize se você acabou de clicar em Conectar no seu Claude.</strong> Se alguém te mandou este link, recuse.</p>
  <p class="muted small">Pedido feito por <strong data-client></strong> <span data-when></span>. Você revoga quando quiser, em Equipe e acessos no painel.</p>
  <div class="actions"><button type="button" class="ghost" data-act="recusar">Recusar</button><button type="button" class="primary" data-act="autorizar"><span>✦</span> Autorizar</button></div>
</section>
<section data-state="abrir" hidden>
  <p class="eyebrow">CONECTOR DO CLAUDE</p>
  <h1>Abra o painel primeiro</h1>
  <p class="muted">Para autorizar o Claude, o painel do criador precisa estar aberto <strong>neste navegador</strong>.</p>
  <ol class="steps"><li><span>No Nexo, vá em <strong>Ajustes</strong>.</span></li><li><span>Clique em <strong>Abrir o painel do criador</strong>.</span></li><li><span>Volte aqui e toque em <strong>Já abri</strong>.</span></li></ol>
  <p class="muted small">O link do painel abre no navegador padrão. Se esta janela estiver em outro navegador, copie o endereço dela para o navegador padrão.</p>
  <div class="actions"><button type="button" class="primary" data-act="tentar">Já abri, tentar de novo</button></div>
</section>
<section data-state="pronto" hidden><p class="eyebrow">CONECTOR DO CLAUDE</p><h1 data-done-title>Tudo certo ✦</h1><p class="muted" data-done-text>Voltando para o Claude…</p></section>
<section data-state="erro" hidden><p class="eyebrow">CONECTOR DO CLAUDE</p><h1>Não deu para conectar</h1><p class="muted" data-error></p><div class="actions"><button type="button" class="ghost" data-act="tentar">Tentar de novo</button></div></section>`);

/** Pedido de autorização com parâmetro errado: nada de redirecionar para endereço que não foi conferido. */
export const CONNECT_ERROR = (message) => shell(`<section><p class="eyebrow">CONECTOR DO CLAUDE</p><h1>Pedido de conexão inválido</h1><p class="muted">${escape(message)}</p><p class="muted small">Tente adicionar o conector de novo no Claude.</p></section>`);

export const CONNECT_JS = `(() => {
  'use strict';
  if (!document.querySelector('[data-state]')) return; // página de pedido inválido: nada a fazer
  const search = location.search;
  const $ = (selector) => document.querySelector(selector);
  const show = (name) => { for (const section of document.querySelectorAll('[data-state]')) section.hidden = section.dataset.state !== name; };
  const ROLES = { dono: 'Dono', colaborador: 'Colaborador', leitura: 'Leitura' };
  let busy = false;
  function fail(message) { $('[data-error]').textContent = message; show('erro'); }
  async function load() {
    show('carregando');
    let response;
    try { response = await fetch('/painel/api/conectar/quem' + search, { credentials: 'same-origin', headers: { accept: 'application/json' } }); }
    catch { fail('Sem conexão com o servidor do Nexo agora.'); return; }
    if (response.status === 401) { show('abrir'); return; }
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) { fail(data.error || 'O servidor recusou o pedido.'); return; }
    $('[data-who]').textContent = data.email || '--';
    $('[data-role]').textContent = ROLES[data.role] || data.role || '--';
    $('[data-client]').textContent = data.client || 'Claude';
    const secs = Number(data.registradoHaSegundos);
    $('[data-when]').textContent = !Number.isFinite(secs) ? '' : secs < 90 ? 'agora há pouco' : secs < 5400 ? 'há ' + Math.round(secs / 60) + ' min' : 'há ' + Math.round(secs / 3600) + ' h (antigo: desconfie)';
    $('[data-write]').hidden = data.role === 'leitura';
    show('consentir');
  }
  async function decide(decisao) {
    if (busy) return;
    busy = true;
    for (const button of document.querySelectorAll('[data-act]')) button.disabled = true;
    try {
      const params = Object.fromEntries(new URLSearchParams(search));
      const response = await fetch('/painel/api/conectar', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-nexo-painel': '1' }, body: JSON.stringify({ ...params, decisao }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { show('abrir'); return; }
      if (!response.ok || typeof data.location !== 'string') { fail(data.error || 'O servidor recusou o pedido.'); return; }
      $('[data-done-title]').textContent = decisao === 'autorizar' ? 'Conectado ✦' : 'Pedido recusado';
      $('[data-done-text]').textContent = 'Voltando para o Claude…';
      show('pronto');
      document.body.classList.add('done');
      setTimeout(() => location.assign(data.location), decisao === 'autorizar' ? 700 : 200);
    } catch { fail('Sem conexão com o servidor do Nexo agora.'); }
    finally { busy = false; for (const button of document.querySelectorAll('[data-act]')) button.disabled = false; }
  }
  document.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'tentar') load();
    if (act === 'autorizar' || act === 'recusar') decide(act);
  });
  load();
})();`;

export const CONNECT_CSS = `
:root { color-scheme: dark; --bg: #050818; --card: rgba(11, 16, 46, 0.72); --hair: rgba(150, 175, 255, 0.16); --hair-strong: rgba(150, 175, 255, 0.3); --ink: #eef2ff; --mist: #a3afdc; --star: #5ad7ff; --violet: #9b7bff; --rose: #ff5b6e; --ok: #46e6a0; --warm: #ffb8a8; }
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 28px 16px; color: var(--ink); font: 15px/1.55 "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
.sky { position: fixed; inset: 0; z-index: -1; background: radial-gradient(60% 45% at 50% 38%, rgba(155, 123, 255, 0.16), transparent 70%), linear-gradient(180deg, rgba(5, 8, 24, 0.15), rgba(5, 8, 24, 0.75)), url('/painel/fundo.svg') center / cover no-repeat, var(--bg); }
.card { position: relative; width: min(500px, 100%); padding: 34px 34px 28px; border-radius: 24px; text-align: center;
  border: 1px solid transparent; background: linear-gradient(var(--card), var(--card)) padding-box, linear-gradient(140deg, rgba(90, 215, 255, 0.75), rgba(155, 123, 255, 0.55) 45%, rgba(255, 184, 168, 0.45)) border-box;
  backdrop-filter: blur(18px) saturate(1.2); box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.8), 0 0 60px -20px rgba(90, 215, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06); animation: rise .5s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.985); } }
.link { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 0 auto 22px; }
.orb { width: 64px; height: 64px; display: grid; place-items: center; border-radius: 50%; background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.1), rgba(5, 8, 24, 0.6)); border: 1px solid var(--hair-strong); box-shadow: 0 0 28px -6px rgba(90, 215, 255, 0.55); }
.orb.ai { box-shadow: 0 0 28px -6px rgba(255, 170, 150, 0.6); }
.orb svg { width: 38px; height: 38px; }
.beam { width: 120px; height: 20px; overflow: visible; }
.beam line { animation: flow 1.6s linear infinite; }
.beam .spark { filter: drop-shadow(0 0 6px #5ad7ff); animation: travel 2.4s cubic-bezier(.45, 0, .55, 1) infinite; }
@keyframes flow { to { stroke-dashoffset: -14.2; } }
@keyframes travel { 0% { transform: translateX(0); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateX(152px); opacity: 0; } }
body.done .orb { box-shadow: 0 0 40px -2px rgba(70, 230, 160, 0.6); border-color: rgba(70, 230, 160, 0.5); transition: box-shadow .4s, border-color .4s; }
.eyebrow { margin: 0 0 6px; color: var(--star); font-size: 11px; font-weight: 700; letter-spacing: .16em; }
h1 { margin: 0 0 8px; font: 650 25px/1.22 "Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; letter-spacing: -.015em; text-wrap: balance; }
.grad { background: linear-gradient(90deg, #ffc6b4, #ff9ec7 40%, #9b7bff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.muted { color: var(--mist); margin: 0 0 14px; }
.small { font-size: 12.5px; }
.who strong { color: var(--ink); font-weight: 600; }
.can { list-style: none; margin: 18px 0 14px; padding: 0; display: grid; gap: 8px; text-align: left; }
.can li { display: flex; gap: 12px; align-items: flex-start; padding: 11px 14px; border-radius: 14px; border: 1px solid var(--hair); background: rgba(5, 8, 24, 0.42); }
.can i { flex: none; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; font-style: normal; font-size: 12px; font-weight: 800; color: #04121a; background: linear-gradient(135deg, var(--ok), var(--star)); box-shadow: 0 0 12px -2px rgba(70, 230, 160, 0.7); }
.can strong { display: block; font-weight: 600; font-size: 14px; }
.can small { display: block; color: var(--mist); font-size: 12.5px; }
.warn { margin: 0 0 10px; padding: 9px 12px; border-radius: 12px; border: 1px solid rgba(255, 193, 90, 0.45); background: rgba(255, 193, 90, 0.08); color: #ffd58a; }
.warn strong { font-weight: 650; }
.never { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; align-items: center; margin: 0 0 16px; font-size: 12.5px; color: var(--mist); }
.never b { font-weight: 600; padding: 3px 10px; border-radius: 99px; border: 1px solid rgba(255, 91, 110, 0.4); background: rgba(255, 91, 110, 0.1); color: #ff9aa6; }
.steps { text-align: left; margin: 14px auto 12px; padding: 0 0 0 4px; list-style: none; counter-reset: s; display: grid; gap: 8px; max-width: 360px; }
.steps li { counter-increment: s; display: flex; gap: 10px; align-items: center; }
.steps li::before { content: counter(s); flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; font-size: 12px; font-weight: 700; border: 1px solid var(--hair-strong); background: rgba(90, 215, 255, 0.12); color: var(--star); }
.actions { display: flex; gap: 10px; justify-content: center; margin-top: 18px; }
button { font: inherit; font-weight: 600; color: var(--ink); padding: 10px 20px; border-radius: 12px; border: 1px solid var(--hair-strong); cursor: pointer; transition: transform .12s, box-shadow .2s, background .2s; }
button:hover { transform: translateY(-1px); }
button:active { transform: translateY(0); }
button:disabled { opacity: .55; cursor: progress; transform: none; }
button:focus-visible { outline: 2px solid var(--star); outline-offset: 3px; }
button.ghost { background: rgba(5, 8, 24, 0.5); }
button.ghost:hover { background: rgba(5, 8, 24, 0.75); }
button.primary { border-color: transparent; color: #050818; background: linear-gradient(135deg, #7fe3ff, #a68bff); box-shadow: 0 8px 26px -10px rgba(120, 170, 255, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.5); min-width: 150px; }
button.primary:hover { box-shadow: 0 10px 32px -8px rgba(120, 170, 255, 1), inset 0 1px 0 rgba(255, 255, 255, 0.5); }
@media (prefers-reduced-motion: reduce) { .card, .beam line, .beam .spark { animation: none; } .beam .spark { opacity: 0; } button { transition: none; } }
@media (prefers-reduced-transparency: reduce) { .card { backdrop-filter: none; background: linear-gradient(#0d1334, #0d1334) padding-box, linear-gradient(140deg, #5ad7ff, #9b7bff) border-box; } }
@media (max-width: 420px) { .card { padding: 26px 20px 22px; } h1 { font-size: 22px; } .actions { flex-direction: column-reverse; } button { width: 100%; } }
`;
