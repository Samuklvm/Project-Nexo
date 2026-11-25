/*
 * Cortex — a página própria do cérebro novo do Nexo (a casa da nova IA; as próximas partes vão morar aqui).
 *  - topo: estado, ritmo (carretel), o pensamento de agora e o painel de números (memória, dias, relações provadas);
 *  - "Até onde o Cortex pode ir": Só observar / Pedir antes de testar (+ teto; frase só para moderado ou alto) /
 *    Testar sozinho com o PC parado (um clique);
 *  - diário de investigações por estado, com a página aberta (pergunta, hipóteses com fio de confiança, testes, provas
 *    com o trecho guardado e a linha do tempo dos pensamentos; "Pode testar" / "Agora não" quando aguarda você);
 *  - diário de causas (criaturas: sombra enquanto é suspeita, cor quando um teste prova) e instrumentos que faltaram;
 *  - o cartão pequeno na Análise e a janela da primeira escolha (uma vez por abertura, até a pessoa escolher).
 * Tudo o que vem da memória passa por escapeHtml. As regras puras ficam em src/cortex/page.js.
 * Arte opcional em assets/arte/cortex/ (manifest.json): cada arquivo é conferido antes; sem ele, tudo é desenhado.
 * Efeitos (poeira, névoa, vagalumes, carretel, clarão de "apoiada") andam no relógio único (Nexo.clock, 30 quadros), só
 * com a página aberta e a janela visível e em foco; param no modo Leve e com "menos movimento".
 */
(function () {
  const panel = document.querySelector('[data-view-panel="cortex"]');
  const teaser = document.getElementById('cortex-teaser');
  const Page = window.NexoCortexPage;
  if (!panel || !Page) return;
  const bridge = desktopBridge;
  const has = (name) => typeof bridge?.[name] === 'function';
  const SIGNALS = window.NexoRelations?.SIGNALS || {};
  const space = window.NexoLabSpace || {};
  const KNOBS = new Map([...(space.SPACE || []), ...(space.LINUX_SPACE || [])].map((knob) => [knob.id, knob]));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduce.matches || Nexo.effectsLite;
  const BASE = `${window.__assetBase || ''}assets/arte/cortex/`;
  const $id = (id) => document.getElementById(id);

  /* ---------- Arte opcional: papel → arquivo (o mesmo do manifest.json) ---------- */
  const ART = {
    'titulo-topo': 'titulo-topo.webp', 'titulo-base': 'titulo-base.webp', divisor: 'divisor.webp', 'divisor-fino': 'divisor-fino.webp',
    canto: 'canto.webp', 'moldura-topo': 'moldura-topo.webp', 'moldura-base': 'moldura-base.webp', aviso: 'aviso.webp', cursor: 'cursor.webp',
    pensando: 'pensando.webp', 'ritmo-profundo': 'ritmo-profundo.webp',
    'medalhao-aberta': 'medalhao-aberta.webp', 'medalhao-aguardando': 'medalhao-aguardando.webp', 'medalhao-concluida': 'medalhao-concluida.webp',
    'bestiario-temp_cpu': 'bestiario-temp_cpu.webp', 'bestiario-gpu': 'bestiario-gpu.webp', 'bestiario-disk': 'bestiario-disk.webp',
    'bestiario-mem': 'bestiario-mem.webp', 'bestiario-programa_pesado': 'bestiario-programa_pesado.webp', 'bestiario-cpu': 'bestiario-cpu.webp',
    'bestiario-ajuste': 'bestiario-ajuste.webp', 'bestiario-rotina': 'bestiario-rotina.webp', 'bestiario-desconhecida': 'bestiario-desconhecida.webp',
    'poeira-luz': 'poeira-luz.webp', 'poeira-voo': 'poeira-voo.webp', nevoa: 'nevoa.webp', vagalume: 'vagalume.webp', cinza: 'cinza.webp',
    pluma: 'pluma.webp', mandala: 'mandala.webp', faisca: 'faisca.webp', clarao: 'clarao.webp', anel: 'anel.webp', brilho: 'brilho.webp'
  };
  const FRAMES = { 'ritmo-profundo': [8, 12], faisca: [5, 15], clarao: [4, 8], brilho: [9, 18] }; // [quadros, fps]
  const art = new Map(); // papel → Image carregada
  let artReady = null;
  /** Confere cada arquivo de arte uma vez (Image solta: arquivo ausente não vira erro na tela) e marca as raízes. */
  function ensureArt() {
    if (!artReady) {
      artReady = Promise.all(Object.entries(ART).map(([role, file]) => new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { art.set(role, img); resolve(); };
        img.onerror = () => resolve();
        img.src = BASE + file;
      }))).then(markArt);
    }
    return artReady;
  }
  const artClasses = () => [...art.keys()].map((role) => `cx-a-${role}`);
  function markArt() { for (const root of [panel, teaser, document.querySelector('.cx-first')]) root?.classList.add(...artClasses()); }
  const artImg = (role, cls = '') => (art.has(role) ? `<img class="${cls}" src="${BASE}${ART[role]}" alt="" draggable="false" />` : '');

  /* ---------- Desenhos de reserva (sem arte) ---------- */
  const corners = () => '<i class="cx-c tl" aria-hidden="true"></i><i class="cx-c tr" aria-hidden="true"></i><i class="cx-c bl" aria-hidden="true"></i><i class="cx-c br" aria-hidden="true"></i>';
  const SPOOL_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M12 7h24M12 41h24" stroke-width="2.4"/><path d="M15 9v30M33 9v30" stroke-width="1.6"/><path d="M15 14l18 3M15 19l18 3M15 24l18 3M15 29l18 3M15 34l18 2" stroke-width="1.3" opacity=".85"/><path d="M33 36c5 1 7 3 9 7" stroke-width="1.2"/></g><path d="M41 41l3 4-1 .6z" fill="currentColor"/></svg>';
  const spoolArt = (size = '') => artImg('pensando', size) || SPOOL_SVG;
  const MEDAL_SVG = (tone) => `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="#2b1c24" stroke="#c9a35a" stroke-opacity=".6" stroke-width="1.5"/><circle cx="32" cy="32" r="18" fill="#3d2530" stroke="#0a090d" stroke-width="3"/><circle cx="32" cy="32" r="8" fill="${tone}" stroke="#0a090d" stroke-width="2"/><path d="M26 33l12-3" stroke="#0a090d" stroke-width="2.2"/></svg>`;
  const MEDAL_ROLE = { aberta: 'medalhao-aberta', esperando: 'medalhao-aberta', aguardando: 'medalhao-aguardando', concluida: 'medalhao-concluida' };
  const MEDAL_TONE = { aberta: '#b9b0a0', esperando: '#b9b0a0', aguardando: '#e2394a', concluida: '#f0d48e' };
  function medal(item) {
    const s = item?.status || 'aberta';
    const dim = s === 'concluida' && item.verdict?.status === 'nao-resolvido';
    return `<span class="cx-medal${dim ? ' dim' : ''}" aria-hidden="true">${artImg(MEDAL_ROLE[s] || 'medalhao-aberta') || MEDAL_SVG(MEDAL_TONE[s] || '#b9b0a0')}</span>`;
  }
  const BEAST_ICON = { temp_cpu: 'i-alert', gpu: 'i-gpu', disk: 'i-disk', mem: 'i-ram', programa_pesado: 'i-win', cpu: 'i-chip', ajuste: 'i-sliders', rotina: 'i-clock', desconhecida: 'i-search' };
  const beastArt = (creature) => artImg(`bestiario-${creature}`) || `<svg aria-hidden="true"><use href="#${BEAST_ICON[creature] || 'i-search'}"/></svg>`;

  /* ---------- Textos ---------- */
  const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  /** Nome de gente de um sinal (o mesmo mapa do narrador); id desconhecido volta como veio. */
  function label(id) {
    const raw = String(id || '');
    if (raw === 'rotina') return 'A variação normal deste PC';
    if (raw === 'desconhecida') return 'Algo que o Nexo ainda não mede';
    return SIGNALS[raw]?.label || (raw.startsWith('ajuste:') && KNOBS.get(raw.slice(7))?.label) || raw;
  }
  const hypLabel = (h) => label(h.source === 'desconhecida' ? 'desconhecida' : h.source === 'rotina' ? 'rotina' : h.cause);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (t) => { if (!Number.isFinite(t)) return ''; const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const percent = (b) => `${Math.round(b * 100)}%`;
  const STATUS = { aberta: 'Investigando', esperando: 'Esperando repetir', aguardando: 'Aguardando você' };
  const VERDICT = { apoiada: 'Provada', correlacionada: 'Só observada', 'nao-resolvido': 'Não resolvida' };
  const chipKey = (item) => (item.status === 'concluida' ? item.verdict?.status || 'nao-resolvido' : item.status || 'aberta');
  const chipText = (item) => (item.status === 'concluida' ? VERDICT[item.verdict?.status] || 'Concluída' : STATUS[item.status] || 'Investigando');
  const HSTATE = { apoiada: 'Provada por teste', correlacionada: 'Aparece junto', suspeita: 'Suspeita', derrubada: 'Derrubada' };
  const VERB = { lembrar: 'Conferi no histórico', esperar: 'Fiquei de olho na repetição', medir: 'Medi', intervir: 'Testei o ajuste' };
  const STEP_MARK = { lembrar: 'L', esperar: 'E', medir: 'M', intervir: 'T' };
  const SEEN = { sobe: 'subiu', desce: 'caiu', igual: 'ficou igual', presente: 'apareceu', ausente: 'não apareceu', antes: 'começou a subir antes do sintoma', depois: 'só subiu depois do sintoma, ou junto' };
  const question = (item) => Page.question(item.symptom, item.anomaly?.at ?? item.at, label(item.symptom));

  /** O pedido do Cortex, dito como ele diria. */
  function askText(action) {
    const target = action?.target || '';
    if (action?.type === 'intervir') {
      const knob = KNOBS.get(target.replace(/^ajuste:/, ''));
      const risk = knob?.risk ? ` (risco ${knob.risk})` : '';
      return `Quero testar o ajuste “${label(target)}”${risk} com o PC parado e medir a diferença. No fim, ele volta ao valor original.`;
    }
    if (action?.type === 'medir') return `Quero medir “${label(target)}” por alguns minutos, com o PC parado.`;
    return 'Quero fazer um teste para separar as explicações.';
  }

  function experimentRows(list) {
    // "Esperando" que já teve resultado depois (mesma ação) sai da lista: o resultado conta a história.
    return list.filter((e, i) => !(e.status === 'esperando' && list.slice(i + 1).some((n) => n.action?.type === e.action?.type && n.action?.target === e.action?.target)));
  }
  function experimentResult(e) {
    switch (e.status) {
      case 'feito': {
        const seen = SEEN[e.outcome?.observed];
        if (!seen) return 'Não consegui classificar o que vi.';
        return `${cap(seen)}.${e.outcome.significant === false ? ' A diferença foi pequena, então pesa pouco.' : ''}`;
      }
      case 'esperando': return 'Esperando o sintoma acontecer de novo.';
      case 'interrompido': return 'Interrompido porque você voltou; não conta como evidência.';
      case 'invalido': return e.detail === 'sem-referencia' ? 'Virou a medida de referência; eu meço de novo para comparar.' : 'Não valeu como evidência.';
      case 'falhou': return `Não deu para fazer${e.detail ? `: ${e.detail}` : ''}.`;
      default: return String(e.status || '');
    }
  }
  function snippet(anomaly) {
    if (!anomaly) return '';
    const parts = [];
    const win = anomaly.window;
    if (win && Number.isFinite(win.from) && Number.isFinite(win.to)) parts.push(`${stamp(win.from)} a ${hm(win.to)}`);
    const unit = SIGNALS[anomaly.symptom]?.unit || '';
    if (Number.isFinite(anomaly.data?.value)) parts.push(`pico de ${String(Math.round(anomaly.data.value))}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`);
    if (anomaly.data?.culprit) parts.push(`em primeiro plano: ${anomaly.data.culprit}`);
    if (anomaly.kind === 'sessao') parts.push('sessão de jogo');
    return parts.length ? `<span class="cx-snip">Trecho guardado · ${escapeHtml(parts.join(' · '))}</span>` : '';
  }

  /* ---------- Estado da página ---------- */
  let stats = null; let settings = null; let rhythm = null; let items = []; let bridgeError = null;
  const details = new Map(); // inv → { sig, data }
  let tab = null; let selected = null; let pendingRisk = null; let pactNote = '';
  const sig = (item) => `${item.status}|${item.verdict?.status || ''}|${item.pensamento || ''}|${item.pedido?.target || ''}`;
  const DETAIL_MAX = 30; // diário de causas e instrumentos olham as 30 mais recentes

  async function load({ withDetails = true } = {}) {
    if (!has('cortexList')) { bridgeError = 'Esta versão do app ainda não tem o Cortex.'; return; }
    const safe = (p, fallback) => p.catch(() => fallback);
    [stats, settings, rhythm, items] = await Promise.all([
      safe(bridge.cortexStats(), null), safe(bridge.cortexSettings(), null), has('cortexRhythm') ? safe(bridge.cortexRhythm(), null) : null, safe(bridge.cortexList({ limit: 200 }), [])
    ]);
    items = Array.isArray(items) ? items : [];
    bridgeError = stats ? null : 'Não consegui ler o Cortex agora.';
    if (!withDetails) return;
    await Promise.all(items.slice(0, DETAIL_MAX).map(async (item) => {
      const cached = details.get(item.inv);
      if (cached && cached.sig === sig(item)) return;
      try { details.set(item.inv, { sig: sig(item), data: await bridge.cortexGet(item.inv) }); } catch { /* fica sem o detalhe */ }
    }));
  }
  const detailOf = (inv) => details.get(inv)?.data || null;

  /* ---------- Topo ---------- */
  function renderState() {
    const host = $id('cx-state');
    const on = stats?.ativo !== false && !bridgeError;
    const state = rhythm?.state || stats?.ritmo || 'leve';
    const deep = on && state === 'profundo';
    const reason = rhythm?.reason || stats?.motivo || '';
    const testing = stats?.testando || rhythm?.testando || null;
    const current = items.find((item) => item.status !== 'concluida') || items[0];
    const thinking = on && (deep || Boolean(testing));
    const thought = current?.pensamento
      ? `<p class="cx-thought${thinking ? ' thinking' : ''}"><i class="cx-mandala" aria-hidden="true"></i><q>${escapeHtml(current.pensamento)}</q><small>${testing ? 'Testando agora' : 'O último pensamento'}</small></p>`
      : `<p class="cx-thought"><i class="cx-mandala" aria-hidden="true"></i>${on ? 'Observando em silêncio. Quando algo pesar no PC, eu abro uma investigação e conto cada passo aqui.' : ''}</p>`;
    host.innerHTML = `<span class="cx-seal${on ? '' : ' off'}">${on ? 'Ativo' : 'Desligado'}</span>
      <span class="cx-rhythm${deep ? ' deep' : ''}"><span class="cx-spool" aria-hidden="true">${spoolArt()}</span>
        <span><strong>Ritmo ${deep ? 'profundo' : 'leve'}</strong><small>${escapeHtml(reason ? cap(reason) : deep ? 'PC parado: posso medir e testar.' : 'Você está usando o PC: só observo e penso.')}</small></span><i class="cx-runner" aria-hidden="true"></i></span>
      ${thought}`;
  }

  function renderStats() {
    const host = $id('cx-stats');
    const on = stats && stats.ativo !== false;
    const mb = on && Number.isFinite(stats.memoria?.bytes) ? stats.memoria.bytes / 1048576 : NaN;
    const days = on ? Page.memoryDays(stats.desde, Date.now()) : NaN;
    const proven = on && Number.isFinite(stats.provadas) ? stats.provadas : NaN;
    const tests = on && Number.isFinite(stats.ativosHoje) ? stats.ativosHoje : NaN;
    const num = (v, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits).replace('.', ',') : '--');
    host.innerHTML = `${corners()}
      <div class="cx-stat"><b>${num(mb, mb < 10 ? 1 : 0)}<small> MB</small></b><span>de memória guardada</span></div>
      <div class="cx-stat"><b>${num(days)}</b><span>${days === 1 ? 'dia de memória' : 'dias de memória'}</span></div>
      <div class="cx-stat"><b>${num(proven)}</b><span>${proven === 1 ? 'relação provada neste PC' : 'relações provadas neste PC'}</span></div>
      <div class="cx-stat"><b>${num(tests)}<small> / 3</small></b><span>testes sozinho hoje</span></div>`;
  }

  function renderBanner() {
    const host = $id('cx-banner');
    const off = bridgeError || stats?.ativo === false;
    host.hidden = !off;
    if (off) host.innerHTML = `<strong>O Cortex está desligado</strong>${escapeHtml(bridgeError || (stats?.motivo ? `A memória dele não abriu (${stats.motivo}). O resto do Nexo segue funcionando.` : 'A memória dele não abriu. O resto do Nexo segue funcionando.'))}`;
  }

  /* ---------- Permissão ---------- */
  const PACTS = [
    { id: 'observar', icon: 'i-eye', title: 'Só observar', text: 'Olha, lembra e investiga com o que já mediu. Nunca mexe em nada no PC.' },
    { id: 'pedir', icon: 'i-shield', title: 'Pedir antes de testar', text: 'Quando um teste puder provar a causa, o Cortex pede aqui e espera o seu “Pode testar”.' },
    { id: 'sozinho', icon: 'i-flask', title: 'Testar sozinho com o PC parado', text: 'Só ajustes de risco baixo, só com o PC parado e sem jogo, sempre de volta ao original, no máximo 3 testes por dia.' }
  ];
  const RISK_LABEL = { baixo: 'Só baixo', moderado: 'Até moderado', alto: 'Até alto' };
  function renderPacts() {
    const host = $id('cx-pacts');
    const s = settings || { permission: 'observar', maxRisk: 'baixo', recommended: 'observar' };
    const off = !settings || stats?.ativo === false;
    host.innerHTML = PACTS.map((pact) => `<button type="button" class="cx-pact" role="radio" data-pact="${pact.id}" aria-checked="${s.permission === pact.id}"${off ? ' disabled' : ''}>
        ${corners()}<i class="cx-pick" aria-hidden="true"></i>${pact.id === s.recommended ? '<span class="cx-reco">Recomendado</span>' : ''}
        <span class="cx-sigil"><svg aria-hidden="true"><use href="#${pact.icon}"/></svg></span>
        <strong>${pact.title}</strong><p>${pact.text}</p></button>`).join('');
    let extra = host.parentElement.querySelector('.cx-pact-extra');
    if (s.permission !== 'pedir' || off) { extra?.remove(); return; }
    if (!extra) { extra = document.createElement('div'); extra.className = 'cx-pact-extra'; host.after(extra); }
    const shown = pendingRisk || s.maxRisk;
    const phrase = pendingRisk && Page.needsPhrase(s, { permission: 'pedir', maxRisk: pendingRisk });
    extra.innerHTML = `<p>Teto de risco dos ajustes que o Cortex pode pedir para testar.</p>
      <div class="cx-risks" role="group" aria-label="Teto de risco">${Object.entries(RISK_LABEL).map(([risk, text]) => `<button type="button" data-risk="${risk}" aria-pressed="${shown === risk}">${text}</button>`).join('')}</div>
      ${phrase ? `<div class="cx-consent"><label>Para liberar o teto ${escapeHtml(pendingRisk)}, digite <strong>ENTENDO O RISCO</strong><input id="cx-consent" type="text" maxlength="30" autocomplete="off" spellcheck="false" /></label><button type="button" class="cx-btn" data-consent-go>Liberar</button><button type="button" class="cx-btn ghost" data-consent-cancel>Cancelar</button></div>` : ''}
      ${pactNote ? `<p class="cx-note">${escapeHtml(pactNote)}</p>` : ''}`;
    if (phrase) extra.querySelector('#cx-consent')?.focus();
  }

  async function choose(patch, success) {
    if (!has('cortexSetSettings')) return;
    try {
      const result = await bridge.cortexSetSettings(patch);
      if (result?.ok) { settings = result.settings || settings; pendingRisk = null; pactNote = ''; if (success) showToast(success); }
      else { pactNote = result?.reason || 'Não consegui guardar a escolha agora.'; if (result?.settings) settings = result.settings; }
    } catch (error) { pactNote = error.message || 'Não consegui guardar a escolha agora.'; }
    renderPacts();
    renderStats();
  }
  const PACT_DONE = { observar: 'O Cortex só observa: nada muda no PC.', pedir: 'O Cortex vai pedir aqui antes de testar qualquer ajuste.', sozinho: 'O Cortex pode testar ajustes de risco baixo com o PC parado.' };
  function pickPact(id) {
    const s = settings || {};
    if (id === s.permission && id !== 'pedir') return;
    pendingRisk = null; pactNote = '';
    if (id === 'pedir') {
      if (s.permission === 'pedir') return;
      choose({ permission: 'pedir', maxRisk: 'baixo' }, PACT_DONE.pedir);
      return;
    }
    choose({ permission: id }, PACT_DONE[id]);
  }
  function pickRisk(risk) {
    const s = settings || {};
    pactNote = '';
    if (Page.needsPhrase(s, { permission: 'pedir', maxRisk: risk })) { pendingRisk = risk; renderPacts(); return; }
    pendingRisk = null;
    choose({ permission: 'pedir', maxRisk: risk }, `Teto de risco: ${lower(RISK_LABEL[risk])}.`);
  }

  /* ---------- Diário de investigações ---------- */
  const TABS = [['abertas', 'Abertas'], ['aguardando', 'Aguardando você'], ['concluidas', 'Concluídas'], ['nao-resolvidas', 'Não resolvidas']];
  function renderTabs() {
    const counts = Object.fromEntries(TABS.map(([id]) => [id, 0]));
    for (const item of items) counts[Page.group(item)] += 1;
    if (!tab || (!counts[tab] && items.length)) tab = counts.aguardando ? 'aguardando' : TABS.map(([id]) => id).find((id) => counts[id]) || 'abertas';
    $id('cx-tabs').innerHTML = TABS.map(([id, text]) => `<button type="button" class="cx-tab" data-tab="${id}" aria-pressed="${tab === id}"${id === 'aguardando' && counts[id] ? ' data-calls="true"' : ''}>${text}<em>${counts[id]}</em></button>`).join('');
  }

  function renderList() {
    const list = items.filter((item) => Page.group(item) === tab);
    if (!list.some((item) => item.inv === selected)) selected = list[0]?.inv ?? null;
    $id('cx-list').innerHTML = list.length ? list.map((item) => `<li><button type="button" class="cx-entry" data-inv="${Number(item.inv)}" aria-pressed="${item.inv === selected}">
        ${medal(item)}<span><small>Nº ${Number(item.inv)} · ${escapeHtml(stamp(item.at))} · <span class="cx-chip" data-s="${escapeHtml(chipKey(item))}">${escapeHtml(chipText(item))}</span></small>
        <strong>${escapeHtml(question(item))}</strong>${item.pensamento ? `<em>${escapeHtml(item.pensamento)}</em>` : ''}</span></button></li>`).join('')
      : `<li class="cx-empty">${items.length ? 'Nada aqui por enquanto.' : 'Nenhuma investigação ainda.'}</li>`;
  }

  function renderPage() {
    const host = $id('cx-page');
    const item = items.find((entry) => entry.inv === selected);
    const orns = '<i class="cx-page-orn top" aria-hidden="true"></i><i class="cx-page-orn base" aria-hidden="true"></i>';
    if (!item) {
      host.innerHTML = `${corners()}${orns}<div class="cx-empty">${items.length ? 'Escolha uma investigação ao lado para abrir a página dela.' : 'O diário ainda está em branco. Quando algo pesar no PC, o Cortex abre um caso aqui: a pergunta, as suspeitas, os testes e o que cada um mostrou.'}</div>`;
      return;
    }
    const d = detailOf(item.inv) || {};
    const hyps = (d.hipoteses || []).slice().sort((a, b) => Page.belief(b, d) - Page.belief(a, d));
    const thoughts = (d.pensamentos || []).slice(-60);
    const conclusion = [...thoughts].reverse().find((t) => t.type === 'conclusao');
    const asking = item.status === 'aguardando';
    const pending = asking ? item.pedido || [...(d.pedidos || [])].reverse().find((p) => p.status === 'pendente')?.action : null;
    const first = thoughts.find((t) => t.type === 'notei') || thoughts[0];
    const hypRow = (h) => {
      const state = Page.hypothesisState(h, d);
      const b = Page.belief(h, d);
      return `<li class="cx-hyp" data-s="${state}"><span class="cx-hyp-name">${escapeHtml(hypLabel(h))}</span><span class="cx-chip" data-s="${state}">${HSTATE[state]}</span>
        <span class="cx-thread" data-css="--b:${(b * 100).toFixed(1)}%"><i></i><b>${percent(b)}</b></span></li>`;
    };
    const tests = experimentRows(d.experimentos || []);
    const testRow = (e) => `<li><span class="cx-step" aria-hidden="true">${STEP_MARK[e.action?.type] || '·'}</span><div><strong>${escapeHtml(`${VERB[e.action?.type] || 'Passo'}: “${label(e.action?.target)}”`)}</strong><span>${escapeHtml(experimentResult(e))}</span></div><time>${escapeHtml(stamp(e.at))}</time></li>`;
    const proofRow = (p) => {
      const text = p.kind === 'repeticao' ? 'O sintoma aconteceu de novo.' : p.outcome ? `“${label(p.outcome.target)}” ${SEEN[p.outcome.observed] || 'mudou'}.` : 'Prova guardada.';
      return `<li><span class="cx-step" aria-hidden="true">✦</span><div><strong>${escapeHtml(text)}</strong>${snippet(p.anomaly)}</div><time>${escapeHtml(stamp(p.at))}</time></li>`;
    };
    host.innerHTML = `${corners()}${orns}
      <header class="cx-page-head">${medal(item)}<div><p class="cx-kicker">Investigação nº ${Number(item.inv)} <span class="cx-chip" data-s="${escapeHtml(chipKey(item))}">${escapeHtml(chipText(item))}</span></p><h3>${escapeHtml(question({ ...item, anomaly: d.anomaly }))}</h3></div></header>
      ${first ? `<p class="cx-story">${escapeHtml(first.text)}</p>` : ''}
      ${asking ? `<div class="cx-ask"><strong>O Cortex pede</strong><p>${escapeHtml(askText(pending))}</p><div class="cx-actions"><button type="button" class="cx-btn" data-answer="yes" data-inv="${Number(item.inv)}">Pode testar</button><button type="button" class="cx-btn ghost" data-answer="no" data-inv="${Number(item.inv)}">Agora não</button></div></div>` : ''}
      ${conclusion ? `<p class="cx-verdict">${escapeHtml(conclusion.text)}</p>` : ''}
      ${hyps.length ? `<section class="cx-part"><h4>Hipóteses</h4><ul class="cx-hyps">${hyps.map(hypRow).join('')}</ul></section>` : ''}
      ${tests.length ? `<section class="cx-part"><h4>Testes feitos</h4><ul class="cx-tests">${tests.map(testRow).join('')}</ul></section>` : ''}
      ${(d.provas || []).length ? `<section class="cx-part"><h4>Provas</h4><ul class="cx-proofs">${d.provas.map(proofRow).join('')}</ul></section>` : ''}
      ${thoughts.length ? `<section class="cx-part"><h4>Linha do tempo</h4><ol class="cx-timeline">${thoughts.map((t) => `<li data-t="${escapeHtml(t.type || '')}"><time>${escapeHtml(stamp(t.at))}</time><p>${escapeHtml(t.text)}</p></li>`).join('')}</ol></section>` : ''}
      ${!detailOf(item.inv) ? '<p class="cx-empty">Não consegui abrir os detalhes desta investigação agora.</p>' : ''}`;
  }

  /* ---------- Diário de causas e instrumentos ---------- */
  const SEEN_KEY = 'nexo-cortex-provadas';
  let bursts = [];
  function renderBestiary() {
    const host = $id('cx-bestiary');
    const all = items.slice(0, DETAIL_MAX).map((item) => detailOf(item.inv));
    const list = Page.bestiary(all);
    const STATE = { apoiada: 'Provada por teste', correlacionada: 'Aparece junto, sem prova', suspeita: 'Só suspeita', derrubada: 'Derrubada' };
    host.innerHTML = list.length ? list.map((entry) => `<article class="cx-beast" data-s="${entry.state}" data-cause="${escapeHtml(entry.cause)}">
        <div class="cx-beast-art" aria-hidden="true">${beastArt(entry.creature)}</div>
        <strong>${escapeHtml(label(entry.cause))}</strong><span>${STATE[entry.state]} · em ${entry.count} ${entry.count === 1 ? 'investigação' : 'investigações'}</span></article>`).join('')
      : '<p class="cx-empty">Nenhuma causa investigada ainda. A primeira suspeita aparece aqui, na sombra.</p>';
    // Causa que virou "apoiada" desde a última visita: clarão e anel (a criatura ganha cor).
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { seen = []; }
    const proven = list.filter((entry) => entry.state === 'apoiada').map((entry) => entry.cause);
    const fresh = proven.filter((cause) => !seen.includes(cause));
    if (fresh.length && Nexo.state.view === 'cortex') {
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seen, ...proven])].slice(-200))); } catch { /* só nesta sessão */ }
      for (const cause of fresh) {
        const card = [...host.querySelectorAll('.cx-beast')].find((el) => el.dataset.cause === cause);
        if (card) whenSeen(card, () => { burst(card.querySelector('.cx-beast-art'), [['flash', 'clarao'], ['ring', 'anel']]); sceneFlash(); });
      }
    }
  }

  /** Roda quando o cartão aparece na tela (o diário de causas fica abaixo da dobra). */
  function whenSeen(element, run) {
    if (typeof IntersectionObserver !== 'function') { run(); return; }
    const watch = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watch.disconnect();
      setTimeout(run, 250);
    }, { root: document.getElementById('stage'), threshold: 0.6 });
    watch.observe(element);
  }

  function renderNeeds() {
    const host = $id('cx-needs');
    const list = Page.instruments(items.slice(0, DETAIL_MAX).map((item) => detailOf(item.inv)));
    const names = (keys) => keys.map((key) => `“${label(String(key).split('>')[0])}”`);
    const join = (a) => a.join(', ').replace(/, ([^,]*)$/, ' e $1');
    host.innerHTML = list.length ? list.map((need) => {
      const title = need.goal === 'apoiada' ? `Para provar ${join(names(need.between))}` : `Para separar ${join(names(need.between)) || 'as explicações'}`;
      return `<article class="cx-need"><small>Investigação nº ${Number(need.inv)}</small><strong>${escapeHtml(title)}</strong>
        ${need.reason ? `<p>${escapeHtml(cap(need.reason))}</p>` : ''}
        ${need.missing.length ? `<ul>${need.missing.map((id) => `<li>${escapeHtml(label(id))}</li>`).join('')}</ul>` : ''}
        ${need.outside ? '<p class="cx-outside">Parte do que falta está fora do que o Nexo mede hoje.</p>' : ''}</article>`;
    }).join('') : '<p class="cx-empty">Nada faltou até agora.</p>';
  }

  /* ---------- Cartão da Análise e indicador da barra ---------- */
  function renderTeaser() {
    if (!teaser) return;
    const dot = $id('cortex-nav-indicator');
    const waiting = items.filter((item) => item.status === 'aguardando');
    if (dot) dot.hidden = !waiting.length;
    if (!has('cortexList') || stats?.ativo === false) { teaser.hidden = true; return; }
    const open = items.find((item) => item.status !== 'concluida');
    const done = items.find((item) => item.status === 'concluida');
    const pick = waiting[0] || open || done;
    const kicker = waiting.length ? 'Cortex · aguardando você' : open ? 'Cortex · investigando' : done ? 'Cortex · última conclusão' : 'Cortex · observando';
    const title = pick ? question(pick) : 'O Cortex está observando este PC.';
    const sub = waiting.length ? 'Ele quer fazer um teste e espera a sua resposta.' : pick?.pensamento || 'Quando algo pesar, ele abre uma investigação e conta cada passo.';
    teaser.innerHTML = `${corners()}<span class="cx-teaser-spool" aria-hidden="true">${spoolArt()}</span><span><small>${kicker}</small><strong>${escapeHtml(title)}</strong><em>${escapeHtml(sub)}</em></span><span class="cx-teaser-go">Abrir o Cortex ›</span>`;
    teaser.hidden = false;
  }

  function renderAll() {
    renderBanner(); renderState(); renderStats(); renderPacts(); renderTabs(); renderList(); renderPage(); renderBestiary(); renderNeeds(); renderTeaser();
  }

  /* ---------- Atualização ---------- */
  let loading = null; let again = false; let lastTesting = null;
  async function refresh() {
    if (loading) { again = true; return loading; }
    loading = (async () => {
      const page = Nexo.state.view === 'cortex';
      await ensureArt();
      await load({ withDetails: page });
      const testing = stats?.testando || null;
      if (page) {
        renderAll();
        if (scene.on) placeGlobe();
        if (testing && testing !== lastTesting) burst(panel.querySelector('.cx-spool'), [['spark', 'faisca']]);
      } else renderTeaser();
      lastTesting = testing;
    })().finally(() => { loading = null; if (again) { again = false; refresh(); } });
    return loading;
  }
  let soonTimer = 0;
  const soon = () => { clearTimeout(soonTimer); soonTimer = setTimeout(refresh, 350); };

  panel.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.dataset.pact) { pickPact(target.dataset.pact); return; }
    if (target.dataset.risk) { pickRisk(target.dataset.risk); return; }
    if (target.hasAttribute('data-consent-cancel')) { pendingRisk = null; pactNote = ''; renderPacts(); return; }
    if (target.hasAttribute('data-consent-go')) {
      const phrase = panel.querySelector('#cx-consent')?.value || '';
      choose({ permission: 'pedir', maxRisk: pendingRisk, consent: phrase }, `Teto de risco: ${lower(RISK_LABEL[pendingRisk] || '')}.`);
      return;
    }
    if (target.dataset.tab) { tab = target.dataset.tab; selected = null; renderTabs(); renderList(); renderPage(); return; }
    if (target.dataset.answer) {
      const inv = Number(target.dataset.inv);
      const yes = target.dataset.answer === 'yes';
      setButtonBusy(target, true, yes ? 'Combinado…' : 'Tudo bem…');
      try {
        const result = await (yes ? bridge.cortexApprove(inv) : bridge.cortexDeny(inv));
        showToast(result?.ok ? (yes ? 'Combinado: o Cortex testa quando o PC estiver parado e volta tudo ao original.' : 'Tudo bem: o Cortex não testa isso e segue com o que dá para ver sem mexer.') : 'Esse pedido já não está mais aberto.');
      } catch (error) { showToast(error.message || 'Não consegui responder ao pedido agora.'); }
      details.delete(inv);
      await refresh();
      return;
    }
    if (target.dataset.inv) { selected = Number(target.dataset.inv); renderList(); renderPage(); }
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.id === 'cx-consent') { event.preventDefault(); panel.querySelector('[data-consent-go]')?.click(); return; }
    const pact = event.target.closest?.('.cx-pact');
    if (!pact || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const all = [...panel.querySelectorAll('.cx-pact')];
    const next = all[(all.indexOf(pact) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + all.length) % all.length];
    next.focus();
  });

  /* ---------- Cenário vivo em camadas (A Biblioteca da Memória) ----------
   As mesmas camadas da assets/arte/cortex/cenario/cena.json (o CSP não deixa ler o JSON na hora; o teste confere).
   depth: 0 = parado (céu), 1 = frente. O globo é recortado (box na cena de 2400 × 1350) e brilha conforme o Cortex. */
  const SCENE_BASE = `${window.__assetBase || ''}assets/arte/cortex/cenario/`;
  const SCENE = [
    { id: 'ceu', file: 'ceu.webp', depth: 0.04 },
    { id: 'fundo', file: 'fundo.webp', depth: 0.12 },
    { id: 'meio', file: 'meio.webp', depth: 0.3 },
    { id: 'luzes', file: 'luzes.webp', depth: 0.3 },
    { id: 'globo', file: 'globo.webp', depth: 0.32, box: [990, 270, 420, 400] },
    { id: 'perto', file: 'perto.webp', depth: 0.6 },
    { id: 'frente', file: 'frente.webp', depth: 1 }
  ];
  const sceneHost = $id('cx-scene');
  const stageEl = $id('stage');
  const scene = { ready: null, on: false, layers: [], globe: null, glow: null, core: null, pointer: { x: 0, y: 0 }, target: null, lastMove: 0, flash: 0 };
  /** Carrega as camadas na primeira visita à página. Sem o céu (ou sem qualquer camada), fica o fundo de antes. */
  function ensureScene() {
    if (scene.ready || !sceneHost) return scene.ready || Promise.resolve();
    scene.ready = Promise.all(SCENE.map((layer) => new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.alt = '';
      img.draggable = false;
      img.onload = () => resolve({ layer, img });
      img.onerror = () => resolve(null);
      img.src = SCENE_BASE + layer.file;
    }))).then((loaded) => {
      if (loaded.some((entry) => !entry)) return; // cenário pela metade não monta: fica o fundo antigo
      for (const { layer, img } of loaded) {
        const el = document.createElement('div');
        el.className = 'cx-layer';
        el.dataset.l = layer.id;
        if (layer.box) {
          // O globo mora no vão do coração (no fluxo da página: rola junto com o conteúdo, mesmo sem efeitos).
          const globe = document.createElement('div');
          globe.className = 'cx-globe';
          globe.innerHTML = '<i class="cx-globe-silk"></i><i class="cx-globe-glow"></i><i class="cx-globe-core"></i>';
          globe.prepend(img);
          $id('cx-heart')?.append(globe);
          scene.globe = globe; scene.glow = globe.querySelector('.cx-globe-glow'); scene.core = globe.querySelector('.cx-globe-core');
          scene.layers.push({ el: globe, depth: layer.depth, box: layer.box, inPage: true });
          continue;
        }
        el.append(img);
        sceneHost.append(el);
        scene.layers.push({ el, depth: layer.depth, box: null });
      }
      scene.on = true;
      sceneHost.classList.add('on');
      panel.classList.add('cx-scene-on');
      placeGlobe();
    });
    return scene.ready;
  }
  /** O globo pende num fio de seda no centro do vão do coração (entre o salão e a permissão), do tamanho do vão. */
  function placeGlobe() {
    const entry = scene.layers.find((layer) => layer.box);
    const heart = $id('cx-heart');
    if (!entry || !scene.globe || !heart || !heart.offsetHeight) return;
    const [, , bw, bh] = entry.box;
    const h = Math.min(heart.offsetHeight * 0.8, 380);
    const w = h * (bw / bh);
    Object.assign(scene.globe.style, { left: `calc(50% - ${(w / 2).toFixed(1)}px)`, top: `calc(50% - ${(h / 2).toFixed(1)}px)`, width: `${w.toFixed(1)}px`, height: `${h.toFixed(1)}px` });
  }
  addEventListener('resize', () => { if (scene.on) placeGlobe(); });
  addEventListener('pointermove', (event) => {
    if (Nexo.state.view !== 'cortex') return;
    const box = stageEl?.getBoundingClientRect() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
    scene.target = { x: ((event.clientX - box.left) / box.width) * 2 - 1, y: ((event.clientY - box.top) / box.height) * 2 - 1 };
    scene.lastMove = performance.now();
  }, { passive: true });
  /** Um passo do cenário: segue o mouse com inércia (sem mouse há 4 s, respira devagar) e a rolagem; o globo pulsa. */
  function sceneStep(t, dt) {
    if (!scene.on) return;
    sceneHost.classList.add('moving');
    const idle = !scene.target || performance.now() - scene.lastMove > 4000;
    const goal = idle ? { x: Math.sin(t * 0.13) * 0.35, y: Math.cos(t * 0.09) * 0.22 } : scene.target;
    const k = 1 - Math.exp(-dt * (idle ? 0.8 : 3.2));
    scene.pointer.x += (goal.x - scene.pointer.x) * k;
    scene.pointer.y += (goal.y - scene.pointer.y) * k;
    const scroll = stageEl?.scrollTop || 0;
    for (const layer of scene.layers) {
      // Camadas fixas sobem devagar com a rolagem; o globo (no fluxo da página) fica um pouco para trás do conteúdo.
      const { x, y } = Page.parallax({ depth: layer.depth, pointer: scene.pointer, scroll: layer.inPage ? 0 : scroll, max: 30, scrollMax: 120 });
      const lag = layer.inPage ? Math.min(scroll * 0.1, 36) : 0;
      layer.el.style.transform = `translate3d(${x}px, ${(y + lag).toFixed(2)}px, 0)`;
    }
    // O coração: brilho calmo; pulso lento pensando; mais forte no profundo; clarão quando uma causa é provada.
    const deep = (rhythm?.state || stats?.ritmo) === 'profundo';
    const thinking = deep || Boolean(stats?.testando || rhythm?.testando);
    const pulse = thinking ? 0.5 + 0.5 * Math.sin(t * (deep ? 1.6 : 0.9)) : 0;
    scene.flash = Math.max(0, scene.flash - dt * 0.7);
    const glow = 0.55 + (deep ? 0.2 : 0) + pulse * (deep ? 0.3 : 0.18) + scene.flash * 0.6;
    if (scene.glow) { scene.glow.style.opacity = Math.min(1, glow).toFixed(3); scene.glow.style.transform = `scale(${(1 + pulse * 0.06 + scene.flash * 0.35).toFixed(3)})`; }
    if (scene.core) scene.core.style.opacity = Math.min(1, 0.32 + pulse * 0.3 + scene.flash * 0.7).toFixed(3);
  }
  /** Parado (Leve, menos movimento, fora da página): imagem no lugar, sem deslocamento. */
  function sceneSettle() {
    if (!scene.on) return;
    sceneHost.classList.remove('moving');
    for (const layer of scene.layers) layer.el.style.transform = '';
    if (scene.glow) { scene.glow.style.opacity = ''; scene.glow.style.transform = ''; }
    if (scene.core) scene.core.style.opacity = '';
  }
  /** Clarão do globo quando uma causa vira "apoiada" (junto com o clarão da criatura). */
  function sceneFlash() { scene.flash = 1; wake(); }

  /* ---------- Efeitos (relógio único) ---------- */
  const fx = { on: false, t: 0, canvas: $id('cx-fx'), ctx: null, w: 0, h: 0, dpr: 1, parts: [], shots: [], nextSpark: 3 };
  const canRun = () => Nexo.state.view === 'cortex' && !document.hidden && !Nexo.isIdle?.() && !still() && Boolean(Nexo.clock);
  const rnd = (a, b) => a + Math.random() * (b - a);
  function sizeCanvas() {
    const box = fx.canvas.getBoundingClientRect();
    fx.dpr = Math.min(1.5, devicePixelRatio || 1);
    fx.w = box.width; fx.h = box.height;
    fx.canvas.width = Math.round(box.width * fx.dpr); fx.canvas.height = Math.round(box.height * fx.dpr);
    fx.ctx = fx.canvas.getContext('2d');
  }
  /** Vagalumes, cinzas e plumas: no máximo 29 partículas, só no salão do topo. */
  function seedParticles() {
    fx.parts = [];
    for (let i = 0; i < 22; i += 1) fx.parts.push({ kind: 'fly', x: rnd(0, fx.w), y: rnd(0, fx.h), vx: rnd(-6, 6), vy: rnd(-12, -4), s: rnd(10, 22), ph: rnd(0, 6.3), sp: rnd(0.6, 1.6) });
    for (let i = 0; i < 4; i += 1) fx.parts.push({ kind: 'ash', x: rnd(0, fx.w), y: rnd(-fx.h, fx.h), vx: rnd(-4, 4), vy: rnd(8, 16), s: rnd(8, 14), ph: rnd(0, 6.3), sp: rnd(0.4, 1) });
    for (let i = 0; i < 3; i += 1) fx.parts.push({ kind: 'down', x: rnd(0, fx.w), y: rnd(-fx.h, fx.h), vx: rnd(-3, 3), vy: rnd(6, 11), s: rnd(14, 20), ph: rnd(0, 6.3), sp: rnd(0.3, 0.7), v: i % 3 });
  }
  let glow = null;
  function glowSprite() {
    if (glow) return glow;
    glow = document.createElement('canvas');
    glow.width = glow.height = 32;
    const g = glow.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,246,214,1)'); grad.addColorStop(0.25, 'rgba(240,212,142,0.7)'); grad.addColorStop(1, 'rgba(240,212,142,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    return glow;
  }
  function drawParticles(dt) {
    const { ctx } = fx;
    if (!ctx) return;
    ctx.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
    ctx.clearRect(0, 0, fx.w, fx.h);
    const fly = art.get('vagalume') || glowSprite();
    const ash = art.get('cinza');
    const down = art.get('pluma');
    for (const p of fx.parts) {
      p.ph += dt * p.sp;
      p.x += (p.vx + Math.sin(p.ph) * (p.kind === 'fly' ? 8 : 14)) * dt;
      p.y += p.vy * dt;
      if (p.kind === 'fly' && p.y < -20) { p.y = fx.h + 20; p.x = rnd(0, fx.w); }
      if (p.kind !== 'fly' && p.y > fx.h + 20) { p.y = -20; p.x = rnd(0, fx.w); }
      if (p.x < -30) p.x = fx.w + 30; else if (p.x > fx.w + 30) p.x = -30;
      if (p.kind === 'fly') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(p.ph * 2.3));
        ctx.drawImage(fly, p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
      } else if (p.kind === 'ash') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.5;
        if (ash) ctx.drawImage(ash, p.x, p.y, p.s, p.s * 0.65); else { ctx.fillStyle = 'rgba(120,110,120,0.6)'; ctx.fillRect(p.x, p.y, p.s * 0.4, p.s * 0.25); }
      } else if (down) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.28;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.ph) * 0.6);
        ctx.drawImage(down, p.v * 38, 0, 38, 38, -p.s / 2, -p.s / 2, p.s, p.s);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  /** Um efeito de uma vez só (faísca, clarão, anel, brilho). Sem arte, o CSS desenha um brilho simples. */
  function burst(host, kinds) {
    if (!host || still()) return;
    for (const [cls, role] of kinds) {
      const el = document.createElement('i');
      el.className = `cx-burst ${cls}`;
      el.setAttribute('aria-hidden', 'true');
      host.append(el);
      fx.shots.push({ el, role, t: 0, cls });
    }
    wake();
  }
  function sparkle() {
    const nums = [...panel.querySelectorAll('.cx-stat b')];
    if (!nums.length || !art.has('brilho')) return;
    const host = nums[Math.floor(Math.random() * nums.length)];
    const el = document.createElement('i');
    el.className = 'cx-spark';
    el.style.left = `${rnd(0, Math.max(10, host.offsetWidth - 20)).toFixed(0)}px`;
    el.style.top = `${rnd(-8, 12).toFixed(0)}px`;
    host.append(el);
    fx.shots.push({ el, role: 'brilho', t: 0, cls: 'spark-num' });
  }
  function stepShots(dt) {
    fx.shots = fx.shots.filter((shot) => {
      shot.t += dt;
      const [frames, fps] = FRAMES[shot.role] || [1, 12];
      const duration = shot.cls === 'ring' ? 0.9 : Math.max(0.5, frames / fps);
      const k = shot.t / duration;
      if (k >= 1) { shot.el.remove(); return false; }
      if (art.has(shot.role) && frames > 1) shot.el.style.backgroundPositionX = `${((Math.min(frames - 1, Math.floor(k * frames)) / (frames - 1)) * 100).toFixed(2)}%`;
      if (shot.cls === 'ring') { shot.el.style.transform = `scale(${(0.4 + k * 1.1).toFixed(3)})`; shot.el.style.opacity = String((1 - k).toFixed(3)); }
      else if (!art.has(shot.role)) { shot.el.style.opacity = String((1 - k).toFixed(3)); shot.el.style.transform = `scale(${(0.6 + k * 0.8).toFixed(3)})`; }
      return true;
    });
  }
  function step(now, elapsed) {
    if (!canRun()) { fx.on = false; settle(); return false; }
    const dt = Math.min(elapsed, 250) / 1000;
    fx.t += dt;
    const t = fx.t;
    const [near, far] = panel.querySelectorAll('.cx-dust');
    if (near) near.style.transform = `translate3d(${(-(t * 7) % 512).toFixed(1)}px, ${(-(t * 4) % 512).toFixed(1)}px, 0)`;
    if (far) far.style.transform = `translate3d(${((t * 4) % 384).toFixed(1)}px, ${(-(t * 2) % 384).toFixed(1)}px, 0)`;
    const mist = panel.querySelector('.cx-mist');
    if (mist) mist.style.transform = `translate3d(${((t * 10) % 512).toFixed(1)}px, 0, 0)`;
    const rhythmEl = panel.querySelector('.cx-rhythm');
    const deep = rhythmEl?.classList.contains('deep');
    const spool = panel.querySelector('.cx-spool > svg, .cx-spool > img');
    if (spool) spool.style.transform = deep ? `rotate(${((t * 45) % 360).toFixed(1)}deg)` : `rotate(${(Math.sin(t * 0.8) * 4).toFixed(2)}deg)`;
    const runner = panel.querySelector('.cx-runner');
    if (runner && deep && art.has('ritmo-profundo')) runner.style.backgroundPositionX = `${((Math.floor(t * 12) % 8) / 7 * 100).toFixed(2)}%`;
    const mandala = panel.querySelector('.cx-thought.thinking .cx-mandala');
    if (mandala) mandala.style.transform = `rotate(${((t * 9) % 360).toFixed(1)}deg)`;
    if (t > fx.nextSpark) { fx.nextSpark = t + rnd(2.5, 5); sparkle(); }
    sceneStep(t, dt);
    drawParticles(dt);
    stepShots(dt);
    return true;
  }
  /** Parado (Leve, menos movimento, janela oculta): tudo fica no lugar, sem resto de efeito pela metade. */
  function settle() {
    sceneSettle();
    for (const shot of fx.shots) shot.el.remove();
    fx.shots = [];
    fx.ctx?.clearRect(0, 0, fx.canvas.width, fx.canvas.height);
  }
  function wake() {
    if (fx.on || !canRun()) return;
    fx.on = true;
    sizeCanvas();
    if (!fx.parts.length) seedParticles();
    Nexo.clock.add(step);
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (fx.on) { sizeCanvas(); seedParticles(); } }).observe($id('cx-hall'));

  Nexo.on('view', (view) => {
    if (view === 'cortex') { ensureScene().then(placeGlobe); refresh().then(() => setTimeout(wake, 80)); }
    else if (view === 'analysis') refresh();
  });
  Nexo.on('idle', (idle) => { if (!idle) wake(); });
  Nexo.on('effects', () => { if (still()) settle(); wake(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  reduce.addEventListener?.('change', () => { if (still()) settle(); wake(); });
  if (has('onCortexUpdate')) bridge.onCortexUpdate((payload) => { if (payload?.settings) settings = payload.settings; if (Nexo.state.view === 'cortex' || Nexo.state.view === 'analysis' || payload?.inv) soon(); });
  Nexo.commands?.push({ label: 'Ir para o Cortex', hint: 'Página', run: () => Nexo.go('cortex') });

  /* ---------- Primeira escolha: em toda abertura, até a pessoa escolher ---------- */
  // Espera sem limite: o app pode abrir escondido na bandeja (iniciar com o sistema) e a janela de perfil pode
  // demorar. Tenta de novo quando a janela fica visível e quando o #modal-root esvazia; confere a escolha logo antes.
  let firstShowing = false;
  let firstDone = false; // já apareceu nesta abertura (escolhendo ou fechando): só volta na próxima
  let firstChecking = false;
  const modalRoot = document.getElementById('modal-root');
  const modalOpen = () => Boolean(modalRoot?.childElementCount);
  async function firstRun() {
    if (firstShowing || firstDone || firstChecking || document.hidden || modalOpen() || !has('cortexSettings') || !has('cortexSetSettings')) return;
    firstChecking = true; // a verificação inteira (duas leituras e a arte) conta: duas chamadas nunca abrem duas janelas
    try {
      const read = async () => { try { return await bridge.cortexSettings(); } catch { return null; } };
      const ok = (settings) => Page.canShowFirst({ hidden: document.hidden, modalOpen: modalOpen(), settings, showing: firstShowing || firstDone });
      if (!ok(await read())) return;
      await ensureArt();
      // Durante a espera pela arte outra janela pode ter aberto, ou a escolha pode ter sido feita em outro lugar: relê.
      let fresh = null;
      try { fresh = await bridge.cortexSettings(); } catch { fresh = null; }
      if (!Page.canShowFirst({ hidden: document.hidden, modalOpen: modalOpen(), settings: fresh, showing: firstShowing || firstDone })) return;
      showFirst(Page.firstRun(fresh), fresh);
    } finally { firstChecking = false; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(firstRun, 1200); });
  if (modalRoot) new MutationObserver(() => { if (!modalOpen()) setTimeout(firstRun, 900); }).observe(modalRoot, { childList: true });
  function showFirst(plan, current) {
    const root = document.getElementById('modal-root') || document.body;
    const back = document.createElement('div');
    back.className = ['cx-first', ...artClasses()].join(' ');
    const on = plan.recommendedOn;
    const why = current.iaLocal ? 'Recomendado ligado, porque a IA integrada do Nexo está ativa neste PC.' : 'Sem a IA integrada, o padrão é desligado. Dá para ligar agora ou quando quiser.';
    const reco = '<span class="cx-reco">Recomendado</span>';
    back.innerHTML = `<div class="cx-first-card" role="dialog" aria-modal="true" aria-labelledby="cx-first-t" aria-describedby="cx-first-d">${corners()}
      <button type="button" class="cx-first-close" data-first="close" aria-label="Fechar sem escolher">×</button>
      <div class="cx-first-spool" aria-hidden="true">${spoolArt()}</div>
      <p class="cx-first-pre">O cérebro do Nexo</p>
      <h2 id="cx-first-t">Deixar o Nexo testar ajustes sozinho?</h2>
      <i class="cx-first-orn" aria-hidden="true"></i>
      <div id="cx-first-d"><p class="cx-first-lead">O Cortex investiga por que o PC fica lento. Às vezes, para provar uma causa, ele precisa testar um ajuste e medir a diferença.</p>
      <ul><li>Só ajustes de risco baixo.</li><li>Só com o PC parado e sem jogo aberto.</li><li>Sempre volta ao valor original no fim.</li><li>No máximo 3 testes por dia.</li></ul>
      <p class="cx-first-why">${why}</p></div>
      <div class="cx-first-actions"><span class="cx-choice">${on ? '' : reco}<button type="button" class="cx-btn${on ? ' ghost' : ''}" data-first="off">Deixar desligado</button></span><span class="cx-choice">${on ? reco : ''}<button type="button" class="cx-btn${on ? '' : ' ghost'}" data-first="on">Deixar ligado</button></span></div>
      <p class="cx-first-foot">Dá para mudar a qualquer hora na página do Cortex.</p></div>`;
    const previous = document.activeElement;
    firstShowing = true;
    const close = () => {
      firstShowing = false; firstDone = true;
      document.removeEventListener('keydown', onKey, true);
      back.classList.add('out');
      setTimeout(() => back.remove(), 220);
      previous?.focus?.();
    };
    const onKey = (event) => {
      if (!back.isConnected) { firstShowing = false; document.removeEventListener('keydown', onKey, true); return; } // outra janela tomou o lugar
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === 'Tab') {
        const focusable = [...back.querySelectorAll('button')];
        const index = focusable.indexOf(document.activeElement);
        event.preventDefault();
        focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
      }
    };
    back.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-first]')?.dataset.first;
      if (!action) return;
      if (action === 'close') { close(); return; } // fechar sem escolher: mantém o padrão, não grava, pergunta na próxima abertura
      const permission = action === 'on' ? 'sozinho' : 'observar';
      back.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      try {
        const result = await bridge.cortexSetSettings({ permission });
        if (result?.ok) { settings = result.settings || settings; showToast(action === 'on' ? 'Pronto: o Cortex pode testar ajustes de risco baixo com o PC parado.' : 'Pronto: o Cortex só observa. Dá para mudar na página dele.'); }
        else showToast(result?.reason || 'Não consegui guardar a escolha agora. Ela aparece de novo na próxima abertura.');
      } catch (error) { showToast(error.message || 'Não consegui guardar a escolha agora.'); }
      close();
      if (Nexo.state.view === 'cortex') refresh();
    });
    document.addEventListener('keydown', onKey, true);
    root.append(back);
    back.querySelector(`[data-first="${on ? 'on' : 'off'}"]`)?.focus();
  }
  setTimeout(() => firstRun(), 3200);
  setTimeout(() => { if (Nexo.state.view !== 'cortex') refresh(); }, 2600); // cartão da Análise e o ponto na barra
})();
