/* Painel do criador: erros agrupados (com quem avisar) e telemetria. HTML, CSS e JS servidos pelo próprio servidor. */

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const PANEL_LOCKED = (message) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Painel do Nexo</title><link rel="stylesheet" href="/painel/app.css"></head>
<body class="locked"><main><h1>Painel do Nexo</h1><p>${escape(message)}</p></main></body></html>`;

export const PANEL_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Painel do Nexo</title><link rel="stylesheet" href="/painel/app.css"></head>
<body>
<header class="top"><div><span class="badge">PAINEL DO CRIADOR</span><h1>Nexo Device Care</h1><p class="muted" id="who">Carregando…</p></div><button id="logout" type="button" class="ghost">Sair</button></header>
<section class="tiles" id="tiles"></section>
<nav class="tabs" role="tablist"><button type="button" data-tab="erros" aria-pressed="true">Erros</button><button type="button" data-tab="telemetria" aria-pressed="false">Telemetria</button><button type="button" data-tab="equipe" aria-pressed="false" hidden>Equipe e acessos</button></nav>
<section id="tab-erros">
  <div class="filters"><select id="status"><option value="">Abertos e reabertos primeiro (todos)</option><option value="aberto">Só abertos</option><option value="reaberto">Só reabertos</option><option value="corrigido">Corrigidos</option><option value="ignorado">Ignorados</option></select>
  <label><input type="checkbox" id="avisos"> Incluir avisos</label><input id="busca" type="search" placeholder="Filtrar pela mensagem"></div>
  <div class="split"><ul class="list" id="errors"></ul><aside class="detail" id="detail"><p class="muted">Escolha um erro para ver os detalhes, quem avisar e marcar como corrigido.</p></aside></div>
</section>
<section id="tab-telemetria" hidden>
  <div class="filters"><select id="dias"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></div>
  <div id="telemetry"></div>
</section>
<section id="tab-equipe" hidden>
  <div class="cols">
    <div class="card"><h3>Equipe do painel</h3><p class="muted">Colaborador vê tudo e marca erros como corrigidos. Leitura só vê, sem os e-mails dos usuários. Só o dono adiciona e tira pessoas.</p>
      <ul class="list" id="team"></ul>
      <div class="row"><input type="text" id="team-email" placeholder="e-mail Google da pessoa"><select id="team-role"><option value="colaborador">Colaborador</option><option value="leitura">Leitura</option></select><button type="button" id="team-add">Adicionar</button></div>
      <p class="muted">A pessoa entra pelo Nexo dela (Ajustes &gt; Painel do criador), logada com esse e-mail.</p></div>
    <div class="card"><h3>Chaves de acesso para ferramentas</h3><p class="muted">Só leitura dos erros, sem e-mails de usuários. Servem para a rotina que copia os erros abertos para o repositório privado. A chave aparece uma vez só.</p>
      <ul class="list" id="keys"></ul>
      <div class="row"><input type="text" id="key-label" placeholder="Nome (ex.: relatórios no GitHub)"><button type="button" id="key-add">Criar chave</button></div>
      <div id="key-new"></div></div>
  </div>
</section>
<script src="/painel/app.js"></script>
</body></html>`;

export const PANEL_CSS = `
:root { color-scheme: dark; --bg: #070b1f; --card: rgba(16, 24, 60, 0.72); --hair: rgba(150, 175, 255, 0.16); --ink: #eef2ff; --mist: #9aa6d6; --star: #5ad7ff; --rose: #ff5b6e; --ok: #46e6a0; --warn: #ffc15a; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px clamp(16px, 4vw, 40px) 60px; background: radial-gradient(1200px 600px at 80% -10%, rgba(90, 120, 255, 0.18), transparent), var(--bg); color: var(--ink); font: 14px/1.5 system-ui, "Segoe UI", Roboto, sans-serif; }
body.locked main { max-width: 520px; margin: 18vh auto; text-align: center; }
h1 { margin: 6px 0 2px; font-size: 22px; }
.muted { color: var(--mist); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(255, 91, 110, 0.5); color: var(--rose); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
button, select, input { font: inherit; color: inherit; }
button { padding: 7px 14px; border-radius: 10px; border: 1px solid var(--hair); background: rgba(90, 215, 255, 0.14); cursor: pointer; }
button.ghost { background: transparent; }
button.danger { border-color: rgba(255, 91, 110, 0.5); background: rgba(255, 91, 110, 0.14); }
button.ok { border-color: rgba(70, 230, 160, 0.5); background: rgba(70, 230, 160, 0.14); }
select, input[type=search], input[type=text] { padding: 7px 10px; border-radius: 10px; border: 1px solid var(--hair); background: rgba(8, 12, 34, 0.7); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 18px; }
.tile { padding: 14px 16px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card); }
.tile strong { display: block; font-size: 26px; }
.tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.tabs button[aria-pressed=true] { background: rgba(90, 215, 255, 0.3); }
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
.filters input[type=search] { flex: 1 1 220px; max-width: 420px; }
.split { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 900px) { .split { grid-template-columns: minmax(0, 1fr); } }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.list li { padding: 10px 12px; border: 1px solid var(--hair); border-radius: 12px; background: var(--card); cursor: pointer; }
.list li.sel { border-color: var(--star); }
.list li strong { display: block; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { padding: 1px 8px; border-radius: 99px; border: 1px solid var(--hair); font-size: 12px; color: var(--mist); }
.chip.aberto, .chip.erro { color: var(--rose); border-color: rgba(255, 91, 110, 0.45); }
.chip.reaberto { color: var(--warn); border-color: rgba(255, 193, 90, 0.5); }
.chip.corrigido { color: var(--ok); border-color: rgba(70, 230, 160, 0.45); }
.detail { position: sticky; top: 12px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card); min-height: 200px; }
.detail pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: rgba(0, 0, 0, 0.35); padding: 10px; border-radius: 10px; max-height: 260px; overflow: auto; }
.detail .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
.emails { font-size: 13px; overflow-wrap: anywhere; }
.bars { display: grid; gap: 4px; }
.bar { display: grid; grid-template-columns: 140px 1fr 50px; gap: 8px; align-items: center; font-size: 13px; }
.bar i { display: block; height: 10px; border-radius: 99px; background: linear-gradient(90deg, #7b6cff, var(--star)); }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.card { padding: 14px 16px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card); }
.card h3 { margin: 0 0 10px; font-size: 15px; }
.days { display: flex; align-items: flex-end; gap: 3px; height: 120px; }
.days i { flex: 1; min-width: 3px; border-radius: 4px 4px 0 0; background: linear-gradient(180deg, var(--star), #7b6cff); }
h2.group { margin: 26px 0 10px; font-size: 16px; color: var(--mist); font-weight: 600; letter-spacing: .02em; }
.card.wide { grid-column: 1 / -1; }
.small { font-size: 12px; margin: -4px 0 8px; }
table.nums { width: 100%; border-collapse: collapse; font-size: 13px; }
table.nums th, table.nums td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--hair); }
table.nums th { color: var(--mist); font-weight: 600; }
table.nums td:not(:first-child), table.nums th:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
.bar span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export const PANEL_JS = `
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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

  async function summary() {
    const s = await api('resumo');
    can = new Set(s.permissions || []);
    $('who').textContent = 'Entrou como ' + s.admin + ' (' + (ROLE[s.role] || s.role) + ')';
    document.querySelector('[data-tab="equipe"]').hidden = !can.has('equipe');
    $('tiles').innerHTML = [['Erros abertos', s.openErrors], ['PCs com erro (7 dias)', s.reportingInstalls7], ['PCs ativos (7 dias)', s.activeInstalls7], ['PCs ativos (30 dias)', s.activeInstalls30], ['Contas sincronizando', s.accounts]]
      .map(([label, n]) => '<div class="tile"><span class="muted">' + esc(label) + '</span><strong>' + esc(n) + '</strong></div>').join('');
  }

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
    $('errors').innerHTML = list.length ? list.map((g) => '<li data-sig="' + esc(g.signature) + '" class="' + (g.signature === selected ? 'sel' : '') + '"><strong>' + esc(g.message) + '</strong><div class="chips"><span class="chip ' + esc(g.status) + '">' + esc(STATUS[g.status] || g.status) + (g.fixed_in ? ' na ' + esc(g.fixed_in) : '') + '</span><span class="chip ' + esc(g.level) + '">' + esc(g.level) + '</span><span class="chip">' + esc(g.installs) + ' PC(s)</span><span class="chip">' + esc(g.occurrences) + '×</span><span class="chip">' + esc(g.emails) + ' e-mail(s)</span><span class="chip">versões ' + esc(g.versions || '--') + '</span><span class="chip">' + esc(when(g.last_at)) + '</span></div></li>').join('') : '<li class="muted">Nenhum erro aqui. 🎉</li>';
  }

  async function showDetail(signature) {
    selected = signature;
    renderErrors();
    const d = await api('erros/' + signature);
    const g = d.group;
    $('detail').innerHTML = '<h3>' + esc(g.message) + '</h3><div class="chips"><span class="chip ' + esc(g.status) + '">' + esc(STATUS[g.status] || g.status) + '</span><span class="chip">' + esc(SOURCE[g.source] || g.source) + '</span><span class="chip">#' + esc(g.signature) + '</span><span class="chip">desde ' + esc(when(g.first_at)) + '</span></div>'
      + (g.context ? '<p class="muted">Contexto: ' + esc(g.context) + '</p>' : '')
      + (g.stack ? '<pre>' + esc(g.stack) + '</pre>' : '<p class="muted">Sem detalhes técnicos.</p>')
      + (d.emailsHidden ? '<p class="muted">O seu papel no painel não mostra os e-mails dos usuários.</p>' : '<p><strong>' + d.emails.length + ' pessoa(s) para avisar</strong></p><div class="emails">' + (d.emails.length ? esc(d.emails.join(', ')) : '<span class="muted">Ninguém deixou o e-mail neste erro.</span>') + '</div>'
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
    return '<div class="bars">' + (items.length ? items.slice(0, 12).map((i) => '<div class="bar"><span>' + esc(i.key) + '</span><i data-w="' + Math.max(2, (i.n / max) * 100) + '"></i><span>' + esc(i.n) + '</span></div>').join('') : '<p class="muted">Sem dados ainda.</p>') + '</div>';
  }
  // Nomes legíveis para o que vem como código do app.
  const LABEL = {
    home: 'Início', analysis: 'Análise', hardware: 'Hardware', maintenance: 'Manutenção', optimize: 'Otimizar', sessions: 'Sessões', library: 'Jogos', atlas: 'Atlas', lab: 'Extremo', activity: 'Atividade', settings: 'Ajustes', updates: 'Atualizações',
    completo: 'Completo', leve: 'Leve', realtime: 'Tempo real', balanced: 'Equilibrada', eco: 'Econômica', jogos: 'Jogos', trabalho: 'Trabalho e criação', geral: 'Uso geral',
    busca: 'Buscou um recurso', filtro: 'Filtrou recursos', fixar: 'Fixou um recurso', acao: 'Botão de um recurso', paleta: 'Abriu a busca (Ctrl K)', novidades: 'Reabriu as novidades', 'novidades-sozinha': 'Viu as novidades depois de atualizar', meteoros: 'Pediu chuva de meteoros', tour: 'Fez o tour',
    fireflies: 'Vagalumes', twinkle: 'Estrelas piscando', meteors: 'Estrelas cadentes', showers: 'Chuva de meteoros', cursor: 'Vagalumes curiosos', skyHour: 'Céu acompanha a hora', wallpaper: 'Papel de parede próprio', autoClean: 'Limpeza automática', reducedMotion: 'Sistema pede menos movimento',
    autostart: 'Abre com o Windows', tray: 'Fica na bandeja', autoSession: 'Sessão automática', onlineCovers: 'Capas online',
    instalador: 'Instalador do Windows', appimage: 'AppImage', deb: 'Pacote .deb'
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
      + group('Os PCs', [card('Versões', t.versions), card('Sistema', t.platforms), card('Como instalou', nice(t.channels)), card('Idioma', t.locales), card('Processador', t.cpus), card('Modelo do processador', t.cpuModels), card('Threads', t.cores), card('Memória', t.ram), card('Placa de vídeo', t.gpus), card('Modelo da placa de vídeo', t.gpuModels), card('Sensores', t.sensors)])
      + group('Monitores', [card('Quantos monitores', t.monitors), card('Resolução', t.resolutions), card('Taxa de atualização', t.refresh), card('Escala do Windows', t.scales)])
      + group('Como o Nexo está configurado', [card('Efeitos visuais', nice(t.effects)), card('Cor de destaque', t.accents), card('Quantidade no céu', t.skyDensity), card('Céu e aparência ligados', nice(t.skyFlags)), card('Perfil de uso', nice(t.profiles)), card('Ritmo das leituras', nice(t.liveRates)), card('Opções do app ligadas', nice(t.appFlags)), card('Jogos por loja (soma)', t.stores)])
      + group('Uso', [card('Telas mais abertas', nice(t.views)), card('Tempo em foco por tela (minutos)', minutes(t.viewTime)), card('Recursos usados', t.features), card('Botões dos cartões de recurso', t.actions), card('Atalhos e extras', nice(t.ui))])
      + (numbers ? group('Desempenho e saúde', [numbers]) : '');
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
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    $('tab-erros').hidden = button.dataset.tab !== 'erros';
    $('tab-telemetria').hidden = button.dataset.tab !== 'telemetria';
    $('tab-equipe').hidden = button.dataset.tab !== 'equipe';
    if (button.dataset.tab === 'telemetria') loadTelemetry();
    if (button.dataset.tab === 'equipe') loadTeam().catch((error) => alert(error.message));
  }; });
  $('errors').onclick = (event) => { const li = event.target.closest('li[data-sig]'); if (li) showDetail(li.dataset.sig); };
  $('status').onchange = loadErrors;
  $('avisos').onchange = loadErrors;
  $('busca').oninput = renderErrors;
  $('dias').onchange = loadTelemetry;
  $('logout').onclick = async () => { await api('sair', { method: 'POST' }).catch(() => {}); location.reload(); };
  summary().then(loadErrors).catch(() => {});
})();
`;
