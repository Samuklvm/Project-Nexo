/*
 * Janela de novidades (estilo Discord): abre uma vez depois de cada atualização e também por Atualizações.
 * Numa instalação nova não abre (a pessoa já tem a escolha de perfil e a pergunta da telemetria).
 * Espera outras janelas fecharem; Esc, o X ou o botão fecham. Setas trocam de versão.
 */
(function () {
  const SEEN_KEY = 'nexo-novidades-seen';
  const VERSIONS_KEY = 'nexo-versions-seen';
  const data = () => window.NexoNovidades?.versions || [];
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* só nesta sessão */ } };
  const TONES = { new: 'Novo', up: 'Melhor', fix: 'Corrigido' };

  function remember(version) {
    let list = [];
    try { list = JSON.parse(read(VERSIONS_KEY) || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    if (list[list.length - 1]?.version !== version) { list.push({ version, at: Date.now() }); write(VERSIONS_KEY, JSON.stringify(list.slice(-30))); }
  }

  function html(entry, index, total) {
    const date = entry.date ? new Date(`${entry.date}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    return `<div class="nv-banner">
        <div class="nv-stars" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--x:${(i * 53) % 100}%;--y:${(i * 37) % 100}%;--d:${(i % 7) * 0.4}s;--s:${1 + (i % 3)}px"></i>`).join('')}</div>
        <div class="nv-emoji" aria-hidden="true">${entry.emoji || '✨'}</div>
        <div class="nv-head"><span class="nv-kicker">Novidades da versão ${escapeHtml(entry.version)}</span><h2 id="nv-title">${escapeHtml(entry.title)}</h2><p>${escapeHtml(entry.tagline || '')}</p>${date ? `<small>${escapeHtml(date)}</small>` : ''}</div>
        <button class="nv-close" type="button" data-nv="close" aria-label="Fechar">×</button>
      </div>
      <div class="nv-body">${entry.sections.map((section) => `<section class="nv-section" data-tone="${section.tone || 'new'}">
          <h3><span>${section.emoji || ''}</span>${escapeHtml(section.title)}<em>${escapeHtml(TONES[section.tone] || '')}</em></h3>
          <ul>${section.items.map((item, i) => `<li style="--i:${i}"><span class="nv-item-emoji" aria-hidden="true">${item.emoji || '•'}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div></li>`).join('')}</ul>
        </section>`).join('')}</div>
      <footer class="nv-foot">
        <div class="nv-nav"><button type="button" class="btn sm ghost" data-nv="older" ${index >= total - 1 ? 'disabled' : ''} aria-label="Versão anterior">‹ Anterior</button><span>${index + 1} de ${total}</span><button type="button" class="btn sm ghost" data-nv="newer" ${index <= 0 ? 'disabled' : ''} aria-label="Versão mais nova">Mais nova ›</button></div>
        <button type="button" class="btn primary" data-nv="close">Bora! 🚀</button>
      </footer>`;
  }

  let open = null;
  function show(version) {
    const list = data();
    if (!list.length) return;
    let index = Math.max(0, list.findIndex((entry) => entry.version === version));
    const root = document.getElementById('modal-root') || document.body;
    const backdrop = document.createElement('div');
    backdrop.className = 'nv-backdrop';
    backdrop.innerHTML = `<div class="nv-card" role="dialog" aria-modal="true" aria-labelledby="nv-title"></div>`;
    const card = backdrop.firstElementChild;
    const paint = () => { card.innerHTML = html(list[index], index, list.length); card.querySelector('.btn.primary')?.focus(); };
    const close = () => { backdrop.classList.add('out'); setTimeout(() => backdrop.remove(), 220); document.removeEventListener('keydown', onKey, true); open = null; };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'ArrowLeft' && index < list.length - 1) { index += 1; paint(); }
      if (event.key === 'ArrowRight' && index > 0) { index -= 1; paint(); }
    };
    backdrop.addEventListener('click', (event) => {
      const action = event.target.closest('[data-nv]')?.dataset.nv;
      if (event.target === backdrop || action === 'close') close();
      if (action === 'older' && index < list.length - 1) { index += 1; paint(); }
      if (action === 'newer' && index > 0) { index -= 1; paint(); }
    });
    document.addEventListener('keydown', onKey, true);
    root.append(backdrop);
    paint();
    open = close;
    if (!Nexo.effectsLite) setTimeout(() => Nexo.sky?.shower?.(true), 350);
  }

  /** Abre as novidades. Sem `force`, só se a versão mudou desde a última vez. */
  Nexo.showNovidades = async function showNovidades({ force = false, tries = 0 } = {}) {
    let version = Nexo.state.snapshot?.version;
    if (!version) { try { version = (await desktopBridge?.getAppInfo?.())?.version; } catch { version = null; } }
    if (!version) return;
    if (force) { open?.(); show(version); Nexo.emit('telemetry-ui', 'novidades'); return; }
    remember(version);
    const seen = read(SEEN_KEY);
    if (seen === version) return;
    // Instalação nova: nada de histórico nem perfil. Marca como visto e não empilha mais uma janela.
    const fresh = !seen && !read(Nexo.keys.history) && !read(Nexo.keys.profile);
    if (fresh || !data().some((entry) => entry.version === version)) { write(SEEN_KEY, version); return; }
    if (document.getElementById('modal-root')?.childElementCount || document.hidden) { if (tries < 40) setTimeout(() => Nexo.showNovidades({ tries: tries + 1 }), 4000); return; }
    write(SEEN_KEY, version);
    show(version);
    Nexo.emit('telemetry-ui', 'novidades-sozinha');
  };

  setTimeout(() => Nexo.showNovidades(), 2500);
})();
