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
      <div class="driver-main">${oemSeal(item)}<strong class="driver-name">${escapeHtml(item.name)}</strong><span class="driver-purpose">${escapeHtml(item.purpose)}</span>${item.covers?.length ? `<span class="driver-covers">${escapeHtml(D.coversText(item.covers))}</span>` : ''}${item.note ? `<span class="driver-note">${escapeHtml(item.note)}</span>` : ''}${covered(item)}${extra}</div>
      ${item.plain ? '<span class="driver-ver"></span>' : `<dl class="driver-ver">${versionCell('Instalado', item.installed)}${latest}</dl>`}
      <div class="driver-side"><span class="driver-state">${escapeHtml(D.STATES[item.state] || '')}</span><div class="driver-actions">${zone.side}${action}</div></div>${zone.below}
    </li>`;
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
    box.innerHTML = `<div class="drivers-status"><h3 class="drivers-headline" data-tone="${tone}">${escapeHtml(D.headline(s))}</h3><p class="drivers-sub">${escapeHtml(`Conferido às ${timeText(model.at)}. ${online}`)}</p>${oemBox}${support ? '' : bios}<p class="drivers-rule">O Nexo baixa só do site oficial de cada fabricante, confere a assinatura de cada arquivo e nunca usa o Windows Update.</p>${restoreToggle()}</div>${supportBox}`;
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
    box.innerHTML = model.groups.map(group).join('');
    if (celebrate.size) setTimeout(() => { celebrate.clear(); box.querySelectorAll('.driver.celebrate').forEach((li) => li.classList.remove('celebrate')); }, 1700);
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
      model = D.build(data, Date.now());
      localLogos = Object.fromEntries(Object.entries(data?.icons || {}).filter(([, value]) => typeof value === 'string' && /^data:image\/png;base64,/.test(value)));
      loadLogos();
    } catch {
      failed = true;
    } finally {
      loading = false;
      if (button) button.disabled = false;
      render();
    }
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
    const jump = event.target.closest?.('[data-driver-jump]');
    if (jump && jump.closest('.drivers-view')) {
      const target = groupsBox()?.querySelector(`.driver[data-id="${CSS.escape(jump.dataset.driverJump)}"]`);
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
  /** Abre a página de Drivers num grupo (os botões de correção da análise usam). */
  Nexo.openDrivers = (groupId = null) => { focus = groupId; Nexo.go('drivers'); if (model) render(); };
})();
