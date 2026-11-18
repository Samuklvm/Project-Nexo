/*
 * Drivers: cada driver do PC com o que ele faz, a versão instalada, a mais recente no site oficial e o botão para lá.
 * As regras ficam em src/drivers.js; a leitura (Windows + fontes oficiais) no processo principal (electron/drivers.cjs).
 * Lê ao abrir a tela pela primeira vez e quando a pessoa pede "Conferir de novo"; nada é instalado pelo Nexo.
 */
(function () {
  const bridge = desktopBridge;
  const D = NexoDrivers;
  let model = null;
  let loading = false;
  let failed = false;
  let focus = null;
  /** Ícones oficiais já buscados (chave do fabricante → data: URL), guardados enquanto o app está aberto. */
  const logos = {};
  /** Ícones tirados dos programas instalados no PC (Visual C++, .NET, PhysX, DirectX e o pacote de cada fabricante). */
  let localLogos = {};
  let asked = new Set();
  /* Drivers com um clique: o estado de cada download (vem do processo principal, por id do cartão), a chave do ponto de
   * restauração (vale para todos) e os avisos que ficam no cartão depois de instalar. */
  const downloads = new Map();
  const notes = new Map();
  const celebrate = new Set();
  const RESTORE_KEY = 'nexo-drivers-restore';
  const RESTORE_AT_KEY = 'nexo-drivers-restore-at';
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };
  let restoreOn = store.get(RESTORE_KEY) !== '0';
  let restoreAt = store.get(RESTORE_AT_KEY);
  // "Atualizar tudo" (parte 4): { ids, index, current, done, failed, stop } enquanto roda.
  let bulk = null;
  // Backups dos drivers: a lista vem do processo principal; busy enquanto faz ou restaura.
  let backups = null;
  let backupBusy = '';
  // Projeto 3: histórico das versões de cada driver (só neste PC) e os nomes dos jogos da biblioteca.
  const HISTORY_KEY = 'nexo-drivers-history';
  let history = (() => { try { return JSON.parse(store.get(HISTORY_KEY) || '{}') || {}; } catch { return {}; } })();
  let gameNames = null;
  // Projeto 4: filtro "só o que precisa de atenção" (lembrado) e a busca.
  const ATTENTION_KEY = 'nexo-drivers-attention';
  const filter = { attention: store.get(ATTENTION_KEY) === '1', query: '' };
  const LIVE = new Set(['queued', 'downloading', 'verifying']);
  // Componente: o ícone do próprio programa instalado é o certo; fabricante: o do site oficial, e o do PC na falta dele.
  const COMPONENTS = new Set(['vs', 'dotnet', 'physx', 'directx', 'vulkan']);
  const pick = (key) => (!key ? null : COMPONENTS.has(key) ? localLogos[key] || logos[key] : logos[key] || localLogos[key]) || null;

  const groupsBox = () => document.getElementById('drivers-groups');
  const heroBox = () => document.getElementById('drivers-hero');
  const ico = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  /** O quadrado do ícone: o logotipo oficial do fabricante (quando já veio do site dele) com o ícone da categoria no canto. */
  const tile = (brand, icon, cls = 'driver-ico', alt = null) => {
    const logo = pick(brand) || pick(alt);
    return `<span class="${cls}${logo ? ' has-logo' : ''}"${brand ? ` data-brand="${escapeHtml(brand)}"` : ''}${alt ? ` data-brand-alt="${escapeHtml(alt)}"` : ''}>${logo ? `<img class="driver-logo" src="${escapeHtml(logo)}" alt="" decoding="async" draggable="false" />` : ''}<span class="driver-glyph">${ico(icon)}</span></span>`;
  };
  const timeText = (at) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function versionCell(label, info, cls = '') {
    if (!info?.version) return `<div class="${cls}"><dt>${label}</dt><dd class="none">${label === 'Instalado' ? 'nenhum' : 'sem consulta'}</dd></div>`;
    return `<div class="${cls}"><dt>${label}</dt><dd>${escapeHtml(info.version)}${info.month ? ` <small>${escapeHtml(info.month)}</small>` : ''}</dd></div>`;
  }
  function row(item) {
    const latest = item.latest ? versionCell('Mais recente', item.latest, 'latest') : '';
    const extra = item.extra?.length ? `<details class="driver-parts"><summary>${item.extra.length === 1 ? 'Ver o componente' : `Ver os ${item.extra.length} componentes`}</summary><ul>${item.extra.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul></details>` : '';
    const direct = Boolean(item.download) && Nexo.platform !== 'linux';
    const action = item.action ? `<button class="btn sm${direct ? ' ghost' : item.state === 'update' || item.state === 'missing' ? ' primary' : ''}" type="button" data-driver-url="${escapeHtml(item.action.url)}">${escapeHtml(direct ? 'Site oficial' : item.action.label)}</button>` : '';
    const dl = Nexo.platform !== 'linux' ? downloads.get(item.id) || null : null;
    // A área do download fica mesmo se o cartão perder o download direto (ex.: virou "Em dia" e precisa reiniciar).
    const zone = Nexo.platform !== 'linux' && D.keepsZone(item, dl, notes.has(item.id)) ? downloadZone(item, dl) : { side: '', below: '' };
    return `<li class="driver${zone.below ? ' has-dl' : ''}${item.kind === 'oem' ? ' is-oem' : ''}${item.coveredBy ? ' is-covered' : ''}${celebrate.has(item.id) ? ' celebrate' : ''}" data-state="${escapeHtml(item.state)}" data-id="${escapeHtml(item.id)}"${dl ? ` data-dl="${escapeHtml(dl.phase)}"` : ''}>
      ${tile(item.brand, item.icon, 'driver-ico', item.brandAlt)}
      <div class="driver-main">${oemSeal(item)}<strong class="driver-name">${escapeHtml(item.name)}</strong><span class="driver-purpose">${escapeHtml(item.purpose)}</span>${item.covers?.length ? `<span class="driver-covers">${escapeHtml(D.coversText(item.covers))}</span>` : ''}${item.note ? `<span class="driver-note">${escapeHtml(item.note)}</span>` : ''}${gameLine(item)}${historyLine(item)}${covered(item)}${extra}</div>
      ${item.plain ? '<span class="driver-ver"></span>' : `<dl class="driver-ver">${versionCell('Instalado', item.installed)}${latest}</dl>`}
      <div class="driver-side"><span class="driver-state">${escapeHtml(D.STATES[item.state] || '')}</span><div class="driver-actions">${zone.side}${action}</div></div>${zone.below}
    </li>`;
  }
  /** "Game Ready para X e Y, que você tem instalados" (vídeo NVIDIA). */
  function gameLine(item) {
    const text = D.gameReadyText(item.gameReady);
    if (!text) return '';
    return `<span class="driver-games${item.gameReady.yours?.length ? ' is-yours' : ''}">${ico('i-game')}<span>${escapeHtml(text)}</span></span>`;
  }
  /** "Antes: 566.14 (02/11)": a versão que o driver tinha antes desta. */
  function historyLine(item) {
    const text = D.historyText(history[item.id]);
    return text ? `<span class="driver-history">${ico('i-clock')}<span>${escapeHtml(text)}</span></span>` : '';
  }
  const oemName = () => D.OEM_NAME[model?.oem?.oem] || 'fabricante';
  /** O selo do pacote do fabricante do PC (de onde ele vem). */
  function oemSeal(item) {
    if (item.kind !== 'oem') return '';
    return `<span class="driver-seal">${ico('i-shield')}Pacote oficial · ${escapeHtml(oemName())}</span>`;
  }
  /** A peça que o pacote do fabricante atualiza: aponta para ele no lugar do botão do site. */
  function covered(item) {
    if (!item.coveredBy) return '';
    return `<span class="driver-covered">${ico('i-check')}<span>Atualizado pelo pacote oficial da ${escapeHtml(oemName())}</span><button class="driver-jump" type="button" data-driver-jump="${escapeHtml(item.coveredBy)}">Ver o pacote</button></span>`;
  }
  /** Botões e barra do download direto de um cartão, conforme a fase. */
  function downloadZone(item, dl) {
    const id = escapeHtml(item.id);
    const phase = dl?.phase || 'idle';
    const note = notes.get(item.id);
    const noteHtml = note ? `<p class="dl-note" data-tone="${escapeHtml(note.tone)}">${escapeHtml(note.text)}${note.retry ? ` <button class="btn sm ghost" type="button" data-driver-install="${id}" data-no-restore="1">Instalar sem ponto</button>` : ''}</p>` : '';
    const button = (label, attr, cls = 'primary', icon = 'i-down') => `<button class="btn sm ${cls}" type="button" ${attr}="${id}">${ico(icon)}${escapeHtml(label)}</button>`;
    if (phase === 'idle' || phase === 'canceled' || phase === 'error') {
      const error = phase === 'error' ? `<p class="dl-note" data-tone="bad">${escapeHtml(D.phaseText(dl))}</p>` : '';
      if (!item.download) return { side: '', below: error || noteHtml };
      return { side: button(phase === 'error' ? 'Tentar de novo' : item.download.label, 'data-driver-download', item.download.primary === false && phase !== 'error' ? 'ghost' : 'primary'), below: error || noteHtml };
    }
    if (LIVE.has(phase)) {
      const pct = dl.total ? Math.min(100, (dl.received / dl.total) * 100) : 0;
      const text = phase === 'downloading' ? D.progressText(dl) : D.phaseText(dl);
      return {
        // Conferindo a assinatura não dá para cancelar (é rapidinho): sem botão que não faz nada.
        side: phase === 'verifying' ? '' : `<button class="btn sm ghost dl-cancel" type="button" data-driver-cancel="${id}" aria-label="Cancelar o download">${ico('i-close')}</button>`,
        below: `<div class="dl" data-phase="${escapeHtml(phase)}"><div class="dl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Download de ${escapeHtml(item.name)}"><i data-css="width: ${phase === 'downloading' ? pct.toFixed(1) : 100}%"></i></div><span class="dl-text">${escapeHtml(text)}</span></div>`
      };
    }
    if (phase === 'ready') {
      return {
        side: `${button('Instalar', 'data-driver-install', 'primary', 'i-check')}<button class="btn sm ghost" type="button" data-driver-folder="${id}">Pasta</button>`,
        below: `<div class="dl" data-phase="ready"><span class="dl-seal">${escapeHtml(D.phaseText(dl))}</span></div>${noteHtml}`
      };
    }
    // Instalando, esperando a vez ou já instalado.
    return { side: '', below: `<div class="dl" data-phase="${escapeHtml(phase)}">${phase === 'installed' ? '' : '<div class="dl-bar"><i data-css="width: 100%"></i></div>'}<span class="dl-text">${escapeHtml(D.phaseText(dl))}</span></div>${noteHtml}` };
  }
  /** Atualiza só o cartão do download (a barra anda sem redesenhar a lista inteira). */
  function updateCard(id) {
    const box = groupsBox();
    if (!box || !model) return;
    const li = box.querySelector(`.driver[data-id="${CSS.escape(id)}"]`);
    const item = model.groups.flatMap((g) => g.items).find((x) => x.id === id);
    if (!li || !item) return;
    const dl = downloads.get(id);
    if (dl?.phase === 'downloading' && li.dataset.dl === 'downloading') {
      const pct = dl.total ? Math.min(100, (dl.received / dl.total) * 100) : 0;
      const bar = li.querySelector('.dl-bar');
      bar?.querySelector('i')?.style.setProperty('width', `${pct.toFixed(1)}%`);
      bar?.setAttribute('aria-valuenow', String(Math.round(pct)));
      const text = li.querySelector('.dl-text');
      if (text) text.textContent = D.progressText(dl);
      return;
    }
    const tpl = document.createElement('template');
    tpl.innerHTML = row(item).trim();
    li.replaceWith(tpl.content.firstElementChild);
  }
  function group(entry) {
    return `<section class="drivers-group" data-group="${escapeHtml(entry.id)}" aria-labelledby="dg-${escapeHtml(entry.id)}">
      <header><span class="dg-ico">${ico(entry.icon)}</span><div><h3 id="dg-${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</h3><p>${escapeHtml(entry.hint)}</p></div></header>
      <ul class="driver-list">${entry.items.map(row).join('')}</ul>
    </section>`;
  }

  function renderHero() {
    const box = heroBox();
    if (!box) return;
    if (Nexo.platform === 'linux') { box.innerHTML = '<h3 class="drivers-headline">No Linux, os drivers vêm do sistema</h3><p class="drivers-sub">Atualize pelo gerenciador de pacotes da sua distribuição. Para placas NVIDIA, use o driver oficial que a distribuição oferece.</p>'; return; }
    if (loading && !model) { box.innerHTML = '<h3 class="drivers-headline">Lendo os drivers…</h3><p class="drivers-sub">O Nexo pergunta ao Windows o que está instalado em cada peça e consulta as versões mais recentes nos sites oficiais. Leva uns 15 segundos.</p>'; return; }
    if (failed && !model) { box.innerHTML = '<h3 class="drivers-headline">Não consegui ler os drivers</h3><p class="drivers-sub">O Windows não respondeu a tempo. Tente de novo em alguns segundos.</p>'; return; }
    if (!model) return;
    const s = model.summary;
    // Dourado quando há algo a fazer (os itens com erro já ficam marcados na lista); verde com tudo em dia.
    const tone = s.missing || s.update || s.old ? 'warn' : 'good';
    const support = model.support;
    const fromOem = model.oem && !model.oem.error && !model.oem.disabled && D.OEM_NAME[model.oem.oem] && model.oem.packages;
    const online = model.online ? `As versões mais recentes da NVIDIA${fromOem ? `, do .NET e da lista oficial da ${D.OEM_NAME[model.oem.oem]}` : ' e do .NET'} vieram agora dos sites oficiais; nos outros fabricantes, o botão abre a página certa para conferir.` : 'Sem acesso aos sites oficiais agora: o estado vem da data de cada driver.';
    const line = D.oemLine(model.oem, Date.now());
    const oemBox = line ? `<p class="drivers-oem" data-tone="${model.oem.error ? 'warn' : 'good'}">${tile(model.oem.oem, 'i-board', 'do-logo')}<span>${escapeHtml(line)}</span></p>` : '';
    const bios = model.oem?.bios?.newer ? `<div class="drivers-bios"><span class="db-ico">${ico('i-alert')}</span><div><strong>BIOS ${escapeHtml(model.oem.bios.version)} disponível</strong><span>Você tem a ${escapeHtml(model.oem.bios.installed || 'anterior')}. A BIOS não entra no Baixar: atualize pela página de suporte${support?.kind === 'notebook' ? ', com o notebook na tomada' : ''}, sem desligar no meio.</span></div></div>` : '';
    const supportBox = support ? `<div class="drivers-support">${support.brand ? tile(support.brand, 'i-board', 'ds-logo') : ''}<span class="ds-label">${support.kind === 'notebook' ? 'Seu notebook' : support.kind === 'computador' ? 'Seu computador' : 'Sua placa-mãe'}</span><strong>${escapeHtml(`${support.maker}${support.model ? ` ${support.model}` : ''}`)}</strong><span class="ds-hint">Chipset, áudio e rede feitos para ela estão na página de suporte.</span>${bios}<div class="ds-actions"><button class="btn sm" type="button" data-driver-url="${escapeHtml(support.url)}">Página de suporte da ${escapeHtml(support.maker)}</button>${support.model ? `<button class="btn sm ghost" type="button" data-driver-copy="${escapeHtml(support.model)}">Copiar o modelo</button>` : ''}</div></div>` : '';
    box.innerHTML = `<div class="drivers-status"><h3 class="drivers-headline" data-tone="${tone}">${escapeHtml(D.headline(s))}</h3><p class="drivers-sub">${escapeHtml(`Conferido às ${timeText(model.at)}. ${online}`)}</p>${oemBox}${support ? '' : bios}<p class="drivers-rule">O Nexo baixa só do site oficial de cada fabricante, confere a assinatura de cada arquivo e nunca usa o Windows Update. O Catálogo da Microsoft só entra para peça sem driver e sem fabricante conhecido.</p>${restoreToggle()}${toolsRow()}</div>${supportBox}`;
  }
  /** Chips dos grupos (com a contagem do que pede atenção), a busca e o filtro. */
  /** Projeto 5: o céu do topo, uma estrela por driver (clicar leva ao cartão). */
  const SKY_TONES = [['update', 'atualização'], ['missing', 'falta'], ['warn', 'driver básico ou antigo'], ['ok', 'em dia'], ['unknown', 'sem como saber daqui']];
  const STATE_WORD = { update: 'atualização disponível', missing: 'falta', warn: 'pede atenção', ok: 'em dia', unknown: 'confira no site' };
  let skyFor = null;
  function renderSky() {
    const box = document.getElementById('drivers-sky');
    if (!box) return;
    // Busca e filtro não mexem no céu: só redesenha quando chega leitura nova (sem piscar).
    if (skyFor === model && box.innerHTML) return;
    skyFor = model;
    const sky = model && Nexo.platform !== 'linux' ? D.constellation(model, { width: 1000, height: 150 }) : null;
    box.hidden = !sky?.stars.length;
    if (!sky?.stars.length) { box.innerHTML = ''; return; }
    const count = (tone) => sky.stars.filter((s) => s.tone === tone).length;
    const label = `Constelação dos drivers: ${sky.stars.length} drivers, ${count('update')} com atualização, ${count('missing')} faltando, ${count('ok')} em dia.`;
    const lines = sky.lines.map((l) => `<line class="ds-line" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"/>`).join('');
    const stars = sky.stars.map((st) => `<g class="ds-star" data-tone="${st.tone}" data-driver-jump="${escapeHtml(st.id)}" tabindex="-1" aria-label="${escapeHtml(`${st.name}: ${st.covered ? 'atendida pelo pacote do fabricante' : STATE_WORD[st.tone]}`)}"><circle class="ds-halo" cx="${st.x}" cy="${st.y}" r="${Math.round(st.r * 3.2 * 10) / 10}"/><circle class="ds-core" cx="${st.x}" cy="${st.y}" r="${st.r}"/><title>${escapeHtml(`${st.name} · ${st.covered ? 'atendida pelo pacote do fabricante' : STATE_WORD[st.tone]}`)}</title></g>`).join('');
    const labels = sky.groups.map((g) => `<text class="ds-label" x="${g.x}" y="${g.y}" text-anchor="middle">${escapeHtml(g.title)}</text>`).join('');
    const legend = SKY_TONES.filter(([tone]) => count(tone)).map(([tone, text]) => `<span data-tone="${tone}"><i></i>${escapeHtml(text)} <b>${count(tone)}</b></span>`).join('');
    box.innerHTML = `<svg class="ds-svg" viewBox="0 0 1000 150" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${escapeHtml(label)}">${lines}${stars}${labels}</svg><div class="ds-legend">${legend}</div>`;
  }
  function renderBar() {
    const bar = document.getElementById('drivers-bar');
    if (!bar) return;
    bar.hidden = !model || Nexo.platform === 'linux';
    const dot = document.getElementById('drivers-nav-indicator');
    if (dot) dot.hidden = !D.navDot(model);
    if (!model) return;
    const chips = document.getElementById('drivers-chips');
    if (chips) chips.innerHTML = D.chips(D.filterModel(model, filter)).map((c) => `<button class="db-chip" type="button" data-driver-chip="${escapeHtml(c.id)}">${ico(c.icon)}<span>${escapeHtml(c.title)}</span>${c.attention ? `<b class="db-chip-alert">${c.attention}</b>` : `<b>${c.count}</b>`}</button>`).join('');
    const att = document.getElementById('drivers-attention');
    if (att) { att.checked = filter.attention; att.closest('.switch')?.classList.toggle('on', filter.attention); }
  }
  const nameOf = (id) => model?.groups.flatMap((g) => g.items).find((i) => i.id === id)?.name || 'driver';
  /** Atualizar tudo + backup: a faixa de ferramentas do topo. */
  function toolsRow() {
    const plan = D.updatePlan(model);
    let update = '';
    if (bulk) {
      const total = bulk.ids.length;
      const step = Math.min(bulk.index + 1, total);
      const what = bulk.current ? `${bulk.phase === 'install' ? 'instalando' : 'baixando'} ${nameOf(bulk.current)}` : 'terminando';
      update = `<div class="dt-bulk" role="status"><span class="dt-bulk-ico">${ico('i-refresh')}</span><div><strong>Atualizando tudo · ${step} de ${total}</strong><span>${escapeHtml(what)}${bulk.failed.length ? ` · ${bulk.failed.length} não ${bulk.failed.length === 1 ? 'foi' : 'foram'}` : ''}</span><i class="dt-bar"><b data-css="width:${Math.round((bulk.done.length / Math.max(1, total)) * 100)}%"></b></i></div><button class="btn sm ghost" type="button" data-driver-bulk-stop${bulk.stop ? ' disabled' : ''}>${bulk.stop ? 'Parando…' : 'Parar depois deste'}</button></div>`;
    } else if (plan.length) {
      update = `<button class="btn primary dt-all" type="button" data-driver-bulk>${ico('i-down')}Atualizar tudo <span class="dt-count">${plan.length}</span></button>`;
    }
    const last = backups?.[0];
    const lastLine = backupBusy === 'backup' ? 'Fazendo o backup… (o Windows copia cada driver)' : backupBusy === 'restore' ? 'Restaurando…' : last ? `Último backup: ${new Date(last.at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${timeText(last.at)}${Number.isInteger(last.count) ? ` · ${last.count} drivers` : ''}` : 'Nenhum backup ainda';
    const backup = `<div class="dt-backup"><span class="dt-backup-ico">${ico('i-box')}</span><div class="dt-backup-text"><strong>Backup dos drivers</strong><small>${escapeHtml(lastLine)}</small></div><div class="dt-backup-actions"><button class="btn sm" type="button" data-driver-backup${backupBusy || bulk ? ' disabled' : ''}>Fazer backup</button>${last ? `<button class="btn sm ghost" type="button" data-driver-backup-open="${escapeHtml(last.name)}">Abrir</button><button class="btn sm ghost" type="button" data-driver-backup-restore="${escapeHtml(last.name)}"${backupBusy || bulk ? ' disabled' : ''}>Restaurar</button>` : ''}</div></div>`;
    // Todos os backups (não só o último): cada um com abrir e restaurar.
    const off = backupBusy || bulk ? ' disabled' : '';
    const when = (b) => `${new Date(b.at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${timeText(b.at)}`;
    const all = (backups || []).length > 1 ? `<details class="dt-list"><summary>Todos os backups <span class="dt-count">${backups.length}</span></summary><ul>${backups.map((b) => `<li><span class="dt-list-when">${escapeHtml(when(b))}</span><span class="dt-list-count">${Number.isInteger(b.count) ? `${b.count} drivers` : ''}</span><button class="btn sm ghost" type="button" data-driver-backup-open="${escapeHtml(b.name)}">Abrir</button><button class="btn sm ghost" type="button" data-driver-backup-restore="${escapeHtml(b.name)}"${off}>Restaurar</button></li>`).join('')}</ul></details>` : '';
    return `<div class="drivers-tools">${update}${backup}${all}</div>`;
  }
  async function loadBackups() {
    try { backups = await bridge.driverBackups(); } catch { backups = []; }
    renderHero();
  }
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  /** Atualizar tudo: o passo a passo é do NexoDrivers.runBulk; aqui só as ações da tela e o resumo honesto no fim. */
  async function runBulk() {
    const ids = D.updatePlan(model);
    if (!ids.length || bulk) return;
    bulk = { ids, index: 0, current: null, phase: 'download', done: [], failed: [], stop: false };
    renderHero();
    const out = await D.runBulk({
      ids, restoreOn,
      phaseOf: (id) => downloads.get(id)?.phase,
      start: async (id) => { const item = await bridge.downloadDriver(id); if (item?.id) { downloads.set(item.id, { ...downloads.get(item.id), ...item }); updateCard(item.id); } },
      cancel: async (id) => { await bridge.cancelDriverDownload(id); },
      install: async (id, options) => {
        const result = await bridge.installDriver(id, options);
        if (result?.restore?.created && result.restore.at) { restoreAt = result.restore.at; store.set(RESTORE_AT_KEY, restoreAt); }
        if (result?.ok && result.restart) notes.set(id, { tone: 'warn', text: 'Reinicie o PC para terminar a instalação.' });
        else if (!result?.ok && result?.note) notes.set(id, { tone: 'warn', text: result.note });
        if (result?.ok) bulk.done.push(id); else bulk.failed.push(id);
        return result;
      },
      sleep, stopped: () => Boolean(bulk?.stop),
      onStep: ({ index, id, phase }) => { Object.assign(bulk, { index, current: id, phase }); renderHero(); }
    }).catch(() => ({ done: bulk.done, failed: bulk.failed, stopped: true }));
    bulk = null;
    await load(true);
    // Instalador cancelado também sai com código 0: só conta o que mudou de verdade na leitura nova.
    const items = new Map((model?.groups || []).flatMap((g) => g.items).map((i) => [i.id, i]));
    const really = out.done.filter((id) => notes.get(id)?.text?.startsWith('Reinicie') || D.installOutcome(items.get(id)?.state) === 'updated');
    for (const id of out.done.filter((x) => !really.includes(x))) notes.set(id, { tone: 'warn', text: 'O instalador fechou, mas a versão continua a mesma. Se você cancelou, é só instalar de novo.' });
    render();
    const why = out.declined ? ' Você recusou a permissão de administrador, então parei.' : out.stopped ? ' Parei antes do fim.' : '';
    showToast(really.length === ids.length ? `Pronto: ${really.length} ${really.length === 1 ? 'driver atualizado' : 'drivers atualizados'}.` : `Atualizei ${really.length} de ${ids.length}.${why} Os outros ficaram com o aviso no cartão.`);
  }

  function restoreLine() {
    if (!restoreOn) return 'Instala direto, sem ponto de restauração';
    const at = Date.parse(restoreAt || '');
    if (!Number.isFinite(at)) return 'Nenhum ponto criado pelo Nexo ainda';
    const day = new Date(at).toDateString() === new Date().toDateString() ? 'hoje' : new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `Último ponto: ${day}, ${timeText(at)}`;
  }
  /** A chave do topo: ponto de restauração antes de instalar (vale para todos os drivers). */
  function restoreToggle() {
    return `<label class="switch compact drivers-restore${restoreOn ? ' on' : ''}"><span class="dr-shield">${ico('i-shield')}</span><span class="dr-text"><strong>Ponto de restauração antes de instalar</strong><small id="drivers-restore-line">${escapeHtml(restoreLine())}</small></span><input id="drivers-restore" type="checkbox"${restoreOn ? ' checked' : ''} /><i></i></label>`;
  }
  function render() {
    renderHero();
    const box = groupsBox();
    if (!box) return;
    if (Nexo.platform === 'linux') { box.innerHTML = ''; return; }
    if (!model) {
      box.innerHTML = loading ? `<section class="drivers-group loading" aria-hidden="true">${'<div class="driver skeleton-row"><span class="skeleton"></span><span class="skeleton short"></span></div>'.repeat(4)}</section>` : '';
      return;
    }
    renderBar();
    renderSky();
    const view = D.filterModel(model, filter);
    box.innerHTML = view.groups.length ? view.groups.map(group).join('') : `<section class="drivers-group drivers-empty"><strong>${filter.query ? 'Nada com esse nome' : 'Nada pedindo atenção'}</strong><span>${filter.query ? 'Tente outro nome de peça ou de fabricante.' : 'Tudo o que o Nexo consegue saber está em dia. Desligue o filtro para ver todos os drivers.'}</span></section>`;
    // Comemoração só com a página aberta (a leitura quieta do começo guarda para quando a pessoa abrir).
    const visible = box.closest('.view')?.classList.contains('active');
    if (celebrate.size && visible) setTimeout(() => { celebrate.clear(); box.querySelectorAll('.driver.celebrate').forEach((li) => li.classList.remove('celebrate')); }, 1700);
    if (focus) {
      const target = box.querySelector(`[data-group="${CSS.escape(focus)}"]`);
      focus = null;
      if (target) { target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1800); }
    }
  }

  /** Pede ao processo principal os ícones oficiais que a página vai mostrar e troca no lugar, sem redesenhar a lista. */
  async function loadLogos() {
    const wanted = D.brands(model).filter((key) => !logos[key] && !asked.has(key) && !(COMPONENTS.has(key) && localLogos[key]));
    if (!wanted.length || !bridge.vendorIcons) return;
    wanted.forEach((key) => asked.add(key));
    let found = {};
    try { found = (await bridge.vendorIcons(wanted)) || {}; } catch { return; }
    for (const [key, data] of Object.entries(found)) {
      if (typeof data !== 'string' || !/^data:image\/(png|x-icon|jpeg|gif|webp|svg\+xml);base64,/.test(data)) continue;
      logos[key] = data;
      for (const box of document.querySelectorAll(`.drivers-view [data-brand="${CSS.escape(key)}"], .drivers-view [data-brand-alt="${CSS.escape(key)}"]`)) {
        const best = pick(box.dataset.brand) || pick(box.dataset.brandAlt);
        if (!best) continue;
        let img = box.querySelector('img.driver-logo');
        if (!img) {
          img = document.createElement('img');
          img.className = 'driver-logo';
          img.alt = '';
          img.decoding = 'async';
          img.draggable = false;
          box.prepend(img);
        }
        if (img.getAttribute('src') !== best) img.src = best;
        box.classList.add('has-logo');
      }
    }
  }

  async function load(force = false) {
    if (loading || Nexo.platform === 'linux') { render(); return; }
    if (model && !force) { render(); return; }
    loading = true;
    failed = false;
    const button = document.getElementById('drivers-refresh');
    if (button) button.disabled = true;
    render();
    try {
      const data = await bridge.scanDrivers({ force });
      if (gameNames === null) { try { gameNames = (await bridge.listGames() || []).filter((g) => g?.kind !== 'app').map((g) => g.name).filter(Boolean).slice(0, 500); } catch { gameNames = []; } }
      model = D.build(data, Date.now(), { games: gameNames });
      // Driver que subiu de versão desde a última leitura: comemora no cartão e guarda no histórico.
      const tracked = D.trackHistory(history, model, Date.now());
      history = tracked.history;
      store.set(HISTORY_KEY, JSON.stringify(history));
      for (const id of tracked.changed) celebrate.add(id);
      localLogos = Object.fromEntries(Object.entries(data?.icons || {}).filter(([, value]) => typeof value === 'string' && /^data:image\/png;base64,/.test(value)));
      loadLogos();
    } catch {
      failed = true;
    } finally {
      loading = false;
      if (button) button.disabled = false;
      render();
      watchOem(true);
      if (backups === null && Nexo.platform !== 'linux') loadBackups();
    }
  }
  /*
   * A lista do fabricante do PC chega em segundo plano: a página abre com o que já tem e pergunta de novo a cada 4 s
   * (no máximo 2 min) até a lista chegar; aí os cartões dos pacotes aparecem.
   */
  let oemTimer = null;
  let oemTries = 0;
  function watchOem(reset = false) {
    clearTimeout(oemTimer);
    if (reset) oemTries = 0;
    if (!(model?.oem?.pending || model?.catalogPending) || oemTries >= 30) return;
    oemTries += 1;
    oemTimer = setTimeout(async () => {
      if (loading) { watchOem(); return; }
      try {
        const data = await bridge.scanDrivers({ force: false });
        model = D.build(data, Date.now(), { games: gameNames || [] });
        localLogos = { ...localLogos, ...Object.fromEntries(Object.entries(data?.icons || {}).filter(([, value]) => typeof value === 'string' && /^data:image\/png;base64,/.test(value))) };
        render();
        if (!model.oem?.pending) loadLogos();
      } catch { /* tenta de novo na próxima volta */ }
      watchOem();
    }, 4000);
  }

  document.addEventListener('click', async (event) => {
    const open = event.target.closest?.('[data-driver-url]');
    if (open && open.closest('.drivers-view')) {
      try { await bridge.openVendorPage(open.dataset.driverUrl); } catch (error) { showToast(error?.message || 'Não consegui abrir o site.'); }
      return;
    }
    const down = event.target.closest?.('[data-driver-download]');
    if (down && down.closest('.drivers-view')) {
      const id = down.dataset.driverDownload;
      notes.delete(id);
      down.disabled = true;
      try { const item = await bridge.downloadDriver(id); if (item?.id) { downloads.set(item.id, { ...downloads.get(item.id), ...item }); updateCard(item.id); } else if (item?.note) showToast(item.note); } catch (error) { showToast(error?.message || 'Não consegui começar o download.'); down.disabled = false; }
      return;
    }
    const stop = event.target.closest?.('[data-driver-cancel]');
    if (stop && stop.closest('.drivers-view')) { try { await bridge.cancelDriverDownload(stop.dataset.driverCancel); } catch { /* já terminou */ } return; }
    const folder = event.target.closest?.('[data-driver-folder]');
    if (folder && folder.closest('.drivers-view')) { try { await bridge.showDriverFile(folder.dataset.driverFolder); } catch { showToast('Não consegui abrir a pasta.'); } return; }
    const inst = event.target.closest?.('[data-driver-install]');
    if (inst && inst.closest('.drivers-view')) {
      const id = inst.dataset.driverInstall;
      const withPoint = restoreOn && inst.dataset.noRestore !== '1';
      if (inst.disabled) return;
      inst.disabled = true; // clique duplo não manda dois pedidos
      notes.delete(id);
      let result = null;
      try { result = await bridge.installDriver(id, { restorePoint: withPoint }); } catch (error) { result = { ok: false, note: error?.message || 'Não consegui abrir o instalador.' }; }
      if (result?.restore?.created && result.restore.at) { restoreAt = result.restore.at; store.set(RESTORE_AT_KEY, restoreAt); const line = document.getElementById('drivers-restore-line'); if (line) line.textContent = restoreLine(); }
      if (result?.ok) {
        if (result.restart) notes.set(id, { tone: 'warn', text: 'Reinicie o PC para terminar a instalação.' });
        await load(true);
        // Confere se a versão mudou mesmo (instalador cancelado também sai com código 0).
        const after = model?.groups.flatMap((g) => g.items).find((x) => x.id === id);
        if (D.installOutcome(after?.state) === 'updated') celebrate.add(id);
        else if (!result.restart) {
          notes.set(id, { tone: 'warn', text: 'O instalador fechou, mas a versão continua a mesma. Se você cancelou, é só instalar de novo.' });
          const dl = downloads.get(id);
          if (dl?.phase === 'installed') downloads.set(id, { ...dl, phase: 'ready' });
        }
        render();
      } else if (result?.restore && result.restore.ok === false) {
        notes.set(id, { tone: 'warn', text: result.note || 'O ponto de restauração não foi criado.', retry: true });
        updateCard(id);
      } else {
        notes.set(id, { tone: result?.declined ? 'warn' : 'bad', text: result?.note || 'O instalador fechou sem terminar.' });
        updateCard(id);
      }
      return;
    }
    const chip = event.target.closest?.('[data-driver-chip]');
    if (chip && chip.closest('.drivers-view')) {
      const target = groupsBox()?.querySelector(`.drivers-group[data-group="${CSS.escape(chip.dataset.driverChip)}"]`);
      target?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    if (event.target.closest?.('[data-driver-bulk]') && event.target.closest('.drivers-view')) {
      const ids = D.updatePlan(model);
      const ok = await Nexo.confirm({ title: `Atualizar ${ids.length} ${ids.length === 1 ? 'item' : 'itens'}?`, body: `O Nexo baixa tudo do site oficial e abre um instalador por vez, na ordem certa (placa primeiro, vídeo por último).${restoreOn ? ' Antes do primeiro, cria um ponto de restauração.' : ''} Cada instalador abre na sua frente.`, items: D.bulkNames(model, ids, 8), confirmLabel: 'Atualizar tudo' });
      if (ok) runBulk().catch(() => { bulk = null; renderHero(); });
      return;
    }
    if (event.target.closest?.('[data-driver-bulk-stop]') && bulk) { bulk.stop = true; renderHero(); return; }
    if (event.target.closest?.('[data-driver-backup]') && event.target.closest('.drivers-view') && !bulk && !backupBusy) {
      backupBusy = 'backup';
      renderHero();
      let r = null;
      try { r = await bridge.backupDrivers(); } catch (error) { r = { ok: false, note: error?.message }; }
      backupBusy = '';
      showToast(r?.ok ? `Backup feito: ${r.count} drivers guardados.${r.note ? ` ${r.note}` : ''} Use "Abrir" para ver a pasta.` : r?.note || 'O backup não terminou.');
      await loadBackups();
      return;
    }
    const bOpen = event.target.closest?.('[data-driver-backup-open]');
    if (bOpen && bOpen.closest('.drivers-view')) { try { await bridge.openDriverBackup(bOpen.dataset.driverBackupOpen); } catch (error) { showToast(error?.message || 'Não consegui abrir a pasta.'); } return; }
    const bRestore = event.target.closest?.('[data-driver-backup-restore]');
    if (bRestore && bRestore.closest('.drivers-view') && !bulk && !backupBusy) {
      const name = bRestore.dataset.driverBackupRestore;
      const ok = await Nexo.confirm({ title: 'Restaurar os drivers deste backup?', body: `O Windows reinstala os drivers guardados em ${name}, só nas peças deste PC; nada é apagado. Restaurar não volta versão: se uma peça já tem driver igual ou mais novo, ela fica como está.`, confirmLabel: 'Restaurar' });
      if (!ok) return;
      backupBusy = 'restore';
      renderHero();
      let r = null;
      try { r = await bridge.restoreDriverBackup(name); } catch (error) { r = { ok: false, note: error?.message }; }
      backupBusy = '';
      showToast(r?.ok ? (r.restart ? 'Drivers restaurados. Reinicie o PC para terminar.' : 'Drivers restaurados.') : r?.note || 'A restauração não terminou.');
      if (r?.nothing) { await loadBackups(); return; }
      await load(true);
      return;
    }
    const jump = event.target.closest?.('[data-driver-jump]');
    if (jump && jump.closest('.drivers-view')) {
      const find = () => groupsBox()?.querySelector(`.driver[data-id="${CSS.escape(jump.dataset.driverJump)}"]`);
      // Escondido pelo filtro ou pela busca: limpa os dois para o cartão aparecer.
      if (!find() && (filter.attention || filter.query)) {
        filter.attention = false; filter.query = ''; store.set(ATTENTION_KEY, '0');
        const input = document.getElementById('drivers-search'); if (input) input.value = '';
        render();
      }
      const target = find();
      if (target) { target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1800); }
      return;
    }
    const copy = event.target.closest?.('[data-driver-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.driverCopy); showToast('Modelo copiado. Cole na busca do site de suporte.'); } catch { showToast('Não consegui copiar.'); }
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target?.id !== 'drivers-restore') return;
    restoreOn = event.target.checked;
    store.set(RESTORE_KEY, restoreOn ? '1' : '0');
    event.target.closest('.drivers-restore')?.classList.toggle('on', restoreOn);
    const line = document.getElementById('drivers-restore-line');
    if (line) line.textContent = restoreLine();
  });
  bridge.onDriverDownload?.((item) => {
    if (!item?.id) return;
    downloads.set(item.id, item);
    if (item.phase === 'installed') { notes.delete(item.id); }
    updateCard(item.id);
  });
  bridge.driverDownloads?.().then((list) => { for (const item of list || []) if (item?.id) downloads.set(item.id, item); if (model) render(); }).catch(() => {});
  document.getElementById('drivers-refresh')?.addEventListener('click', () => { asked = new Set(Object.keys(logos)); load(true); });
  Nexo.on('view', (view) => { if (view === 'drivers') load(false); });
  // Estrela do céu pelo teclado: Enter ou espaço levam ao cartão, como o clique.
  document.getElementById('drivers-sky')?.addEventListener('keydown', (event) => {
    const star = event.target.closest?.('[data-driver-jump]');
    if (!star || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    star.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // Filtro e busca (projeto 4): só redesenha a lista, o campo de busca não perde o foco.
  document.addEventListener('change', (event) => {
    if (event.target?.id !== 'drivers-attention') return;
    filter.attention = event.target.checked;
    store.set(ATTENTION_KEY, filter.attention ? '1' : '0');
    if (model) render();
  });
  let searchTimer = null;
  document.getElementById('drivers-search')?.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter.query = String(event.target.value || '').slice(0, 80); if (model) render(); }, 120);
  });
  // A bolinha da barra lateral: uma leitura quieta um minuto depois de abrir o app (com cache, sem pressa).
  // Não roda durante uma sessão gravada (medição de jogo): tenta de novo a cada 5 minutos.
  const quietScan = () => { if (model || loading) return; if (Nexo.recording?.()) { setTimeout(quietScan, 5 * 60000); return; } load(false); };
  if (Nexo.platform !== 'linux') setTimeout(quietScan, 60000);
  /** Abre a página de Drivers num grupo (os botões de correção da análise usam). */
  Nexo.openDrivers = (groupId = null) => { focus = groupId; Nexo.go('drivers'); if (model) render(); };
})();
