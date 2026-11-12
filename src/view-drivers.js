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
    const action = item.action ? `<button class="btn sm${item.state === 'update' || item.state === 'missing' ? ' primary' : ''}" type="button" data-driver-url="${escapeHtml(item.action.url)}">${escapeHtml(item.action.label)}</button>` : '';
    return `<li class="driver" data-state="${escapeHtml(item.state)}">
      ${tile(item.brand, item.icon, 'driver-ico', item.brandAlt)}
      <div class="driver-main"><strong class="driver-name">${escapeHtml(item.name)}</strong><span class="driver-purpose">${escapeHtml(item.purpose)}</span>${item.note ? `<span class="driver-note">${escapeHtml(item.note)}</span>` : ''}${extra}</div>
      ${item.plain ? '<span class="driver-ver"></span>' : `<dl class="driver-ver">${versionCell('Instalado', item.installed)}${latest}</dl>`}
      <div class="driver-side"><span class="driver-state">${escapeHtml(D.STATES[item.state] || '')}</span>${action}</div>
    </li>`;
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
    const online = model.online ? 'As versões mais recentes da NVIDIA e do .NET vieram agora dos sites oficiais; nos outros fabricantes, o botão abre a página certa para conferir.' : 'Sem acesso aos sites oficiais agora: o estado vem da data de cada driver.';
    const support = model.support;
    const supportBox = support ? `<div class="drivers-support">${support.brand ? tile(support.brand, 'i-board', 'ds-logo') : ''}<span class="ds-label">${support.kind === 'notebook' ? 'Seu notebook' : support.kind === 'computador' ? 'Seu computador' : 'Sua placa-mãe'}</span><strong>${escapeHtml(`${support.maker}${support.model ? ` ${support.model}` : ''}`)}</strong><span class="ds-hint">Chipset, áudio e rede feitos para ela estão na página de suporte.</span><div class="ds-actions"><button class="btn sm" type="button" data-driver-url="${escapeHtml(support.url)}">Página de suporte da ${escapeHtml(support.maker)}</button>${support.model ? `<button class="btn sm ghost" type="button" data-driver-copy="${escapeHtml(support.model)}">Copiar o modelo</button>` : ''}</div></div>` : '';
    box.innerHTML = `<div class="drivers-status"><h3 class="drivers-headline" data-tone="${tone}">${escapeHtml(D.headline(s))}</h3><p class="drivers-sub">${escapeHtml(`Conferido às ${timeText(model.at)}. ${online}`)}</p><p class="drivers-rule">O Nexo não instala driver sozinho e nunca usa o Windows Update: cada botão abre o site oficial do fabricante.</p></div>${supportBox}`;
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
    const copy = event.target.closest?.('[data-driver-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.driverCopy); showToast('Modelo copiado. Cole na busca do site de suporte.'); } catch { showToast('Não consegui copiar.'); }
    }
  });
  document.getElementById('drivers-refresh')?.addEventListener('click', () => { asked = new Set(Object.keys(logos)); load(true); });
  Nexo.on('view', (view) => { if (view === 'drivers') load(false); });
  /** Abre a página de Drivers num grupo (os botões de correção da análise usam). */
  Nexo.openDrivers = (groupId = null) => { focus = groupId; Nexo.go('drivers'); if (model) render(); };
})();
