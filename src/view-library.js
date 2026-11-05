/* Biblioteca de jogos no estilo de uma loja: capas, destaque do último jogado, filtros e o desempenho de cada jogo. */
(function () {
  const bridge = desktopBridge;
  const state = { games: [], source: 'all', sort: 'recent', query: '', loading: false, loaded: false };
  const when = (at) => new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  const dec = (value) => (Number.isFinite(value) ? Math.round(value).toString() : '--');

  function lastSession(game) {
    const list = Nexo.sessions?.forGame?.(game.id, game.name) || [];
    return list[0] || null;
  }

  function art(game, size = 'card') {
    if (game.cover) return `<img class="cover-img" src="${escapeHtml(game.cover)}" alt="" loading="lazy" decoding="async" />`;
    return `<div class="cover-gen" style="--hue:${Number(game.hue) || 220}">${game.icon ? `<img class="cover-icon" src="${escapeHtml(game.icon)}" alt="" />` : ''}<b>${escapeHtml(initials(game.name))}</b>${size === 'card' ? `<span>${escapeHtml(game.name)}</span>` : ''}</div>`;
  }

  function visible() {
    const query = state.query.toLocaleLowerCase('pt-BR');
    const list = state.games.filter((game) => (state.source === 'all' || game.source === state.source) && (!query || game.name.toLocaleLowerCase('pt-BR').includes(query)));
    const sorters = { recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name, 'pt-BR'), name: (a, b) => a.name.localeCompare(b.name, 'pt-BR'), size: (a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0) };
    return list.sort(sorters[state.sort]);
  }

  function renderSources() {
    const counts = state.games.reduce((acc, game) => { acc[game.source] = (acc[game.source] || 0) + 1; return acc; }, {});
    const labels = Object.fromEntries(state.games.map((game) => [game.source, game.sourceLabel]));
    const entries = [['all', `Todos · ${state.games.length}`], ...Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((source) => [source, `${labels[source]} · ${counts[source]}`])];
    document.getElementById('lib-sources').innerHTML = entries.map(([id, label]) => `<button type="button" data-lib-source="${escapeHtml(id)}" aria-pressed="${state.source === id}">${escapeHtml(label)}</button>`).join('');
  }

  function renderHero() {
    const hero = state.games.filter((game) => game.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || state.games[0];
    const artBox = document.getElementById('lib-hero-art');
    const actions = document.getElementById('lib-hero-actions');
    if (!hero) {
      artBox.replaceChildren();
      setText('lib-hero-eyebrow', 'Sua biblioteca');
      setText('lib-hero-title', state.loading ? 'Procurando seus jogos…' : state.loaded ? 'Nenhum jogo encontrado' : 'Biblioteca de jogos');
      setText('lib-hero-sub', state.loaded ? 'O Nexo procura em Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot e Rockstar. Se o seu jogo veio de outro lugar, use “Adicionar jogo”.' : 'Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot, Rockstar e os que você adicionar.');
      actions.replaceChildren();
      return;
    }
    artBox.innerHTML = hero.cover ? `<img class="hero-bg" src="${escapeHtml(hero.cover)}" alt="" /><img class="hero-cover" src="${escapeHtml(hero.cover)}" alt="" />` : `<div class="cover-gen hero-bg" style="--hue:${hero.hue}"></div><div class="hero-cover">${art(hero, 'big')}</div>`;
    const session = lastSession(hero);
    setText('lib-hero-eyebrow', hero.lastPlayed ? `Jogado por último · ${when(hero.lastPlayed)}` : hero.sourceLabel);
    setText('lib-hero-title', hero.name);
    setText('lib-hero-sub', session?.report?.fps ? `Última sessão gravada: ${dec(session.report.fps.avgFps)} FPS médios, 1% baixo de ${dec(session.report.fps.p1LowFps)}. ${session.report.conclusion}` : session ? session.report.conclusion : 'Ainda sem sessão gravada. Use “Jogar e gravar” para o Nexo medir onde está o limite neste jogo.');
    actions.innerHTML = `${hero.canLaunch ? `<button class="btn primary" type="button" data-play="${escapeHtml(hero.id)}"><svg><use href="#i-play"/></svg>Jogar</button><button class="btn" type="button" data-play-rec="${escapeHtml(hero.id)}"><svg><use href="#i-record"/></svg>Jogar e gravar</button>` : ''}<button class="btn ghost" type="button" data-game="${escapeHtml(hero.id)}">Detalhes</button>`;
  }

  function renderGrid() {
    const grid = document.getElementById('lib-grid');
    if (state.loading && !state.games.length) { grid.innerHTML = Array.from({ length: 8 }, () => '<div class="game-card skeleton-card"><span class="skeleton"></span></div>').join(''); return; }
    const list = visible();
    if (!list.length) { grid.innerHTML = `<div class="sheet empty-art">${Nexo.constellation?.() || ''}<span>${state.games.length ? 'Nada com esse filtro.' : 'Nenhum jogo encontrado neste PC ainda.'}</span></div>`; return; }
    grid.innerHTML = list.map((game, index) => {
      const session = lastSession(game);
      return `<button class="game-card" type="button" data-game="${escapeHtml(game.id)}" style="--i:${Math.min(index, 24)}">
        <div class="cover">${art(game)}<span class="src-badge">${escapeHtml(game.sourceLabel)}</span>${session?.report?.fps ? `<span class="fps-badge">${dec(session.report.fps.avgFps)} FPS</span>` : ''}</div>
        <div class="game-meta"><strong>${escapeHtml(game.name)}</strong><span>${game.lastPlayed ? when(game.lastPlayed) : game.sizeBytes ? formatBytes(game.sizeBytes) : game.sourceLabel}</span></div></button>`;
    }).join('');
  }

  function render() { renderSources(); renderHero(); renderGrid(); }

  async function scan() {
    if (!bridge?.scanGames || state.loading) return;
    state.loading = true;
    render();
    const button = document.getElementById('lib-rescan');
    setButtonBusy(button, true, 'Procurando…');
    try { state.games = await bridge.scanGames(); state.loaded = true; }
    catch (error) { showToast(error.message || 'Não foi possível ler a biblioteca.'); }
    finally { state.loading = false; setButtonBusy(button, false); render(); }
  }

  async function play(id, record) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    try {
      await bridge.launchGame(id);
      recordActivity('Jogo aberto', game.name);
      if (record && !Nexo.sessions.isRecording()) {
        await Nexo.sessions.start({ name: game.name, gameId: game.id });
        showToast(`Gravando a sessão de ${game.name}. Pare em Sessões quando terminar.`, { label: 'Ver', run: () => Nexo.go('sessions') });
      } else showToast(`Abrindo ${game.name}…`);
    } catch (error) { showToast(error.message || 'Não foi possível abrir o jogo.'); }
  }

  function openGame(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    const sessions = Nexo.sessions?.forGame?.(game.id, game.name) || [];
    const fpsSessions = sessions.filter((session) => session.report?.fps);
    const trend = fpsSessions.length > 1 ? `Do primeiro ao último registro: ${dec(fpsSessions.at(-1).report.fps.avgFps)} → ${dec(fpsSessions[0].report.fps.avgFps)} FPS médios.` : '';
    const dialog = Nexo.dialog({
      title: game.name, wide: true,
      html: `<div class="game-detail"><div class="cover big">${art(game, 'big')}</div><div>
        <div class="chips-row"><span class="chip">${escapeHtml(game.sourceLabel)}</span>${game.sizeBytes ? `<span class="chip">${formatBytes(game.sizeBytes)}</span>` : ''}${game.lastPlayed ? `<span class="chip">jogado em ${when(game.lastPlayed)}</span>` : ''}${game.coverSource ? `<span class="chip">capa: ${escapeHtml(game.coverSource)}</span>` : ''}</div>
        <h4>Desempenho neste PC</h4>
        ${sessions.length ? `<ul class="game-sessions">${sessions.slice(0, 6).map((session) => `<li><button class="link" type="button" data-session="${escapeHtml(session.id)}">${when(session.startedAt)}</button><span>${session.report?.fps ? `${dec(session.report.fps.avgFps)} FPS · 1% baixo ${dec(session.report.fps.p1LowFps)}` : 'sem FPS'}</span><small>${escapeHtml(session.report?.conclusion || '')}</small></li>`).join('')}</ul><p class="muted">${escapeHtml(trend)}</p>` : '<p class="muted">Nenhuma sessão gravada deste jogo. “Jogar e gravar” mede FPS, tempo de quadro e o que limita (CPU, GPU, memória, temperatura).</p>'}
      </div></div>`,
      actions: [
        ...(game.canLaunch ? [{ id: 'rec', label: 'Jogar e gravar', onClick: () => play(id, true) }, { id: 'play', label: 'Jogar', tone: 'primary', onClick: () => play(id, false) }] : []),
        { id: 'cover', label: 'Trocar capa', keepOpen: true, onClick: async () => { try { const result = await bridge.setGameCover(id); if (result?.games) { state.games = result.games; render(); dialog.close('cover'); openGame(id); } } catch (error) { showToast(error.message || 'Não foi possível usar a imagem.'); } } },
        { id: 'folder', label: 'Abrir pasta', keepOpen: true, onClick: () => bridge.revealGame(id).catch((error) => showToast(error.message)) },
        ...(game.source === 'manual' ? [{ id: 'remove', label: 'Tirar da biblioteca', tone: 'danger', onClick: async () => { const result = await bridge.removeManualGame(id); state.games = result.games; render(); } }] : []),
        { id: 'close', label: 'Fechar' }
      ]
    });
    document.querySelector('.dialog-body').addEventListener('click', (event) => {
      const link = event.target.closest('[data-session]');
      if (link) { dialog.close('session'); Nexo.go('sessions'); Nexo.sessions.open(link.dataset.session); }
    });
  }

  async function syncAuto() {
    if (!bridge?.getSettings) return;
    try { const settings = await bridge.getSettings(); document.getElementById('lib-auto').checked = settings.autoSession; } catch { /* fora do desktop */ }
  }

  document.getElementById('lib-grid').addEventListener('click', (event) => { const card = event.target.closest('[data-game]'); if (card) openGame(card.dataset.game); });
  document.getElementById('lib-hero').addEventListener('click', (event) => {
    const playButton = event.target.closest('[data-play]'); if (playButton) play(playButton.dataset.play, false);
    const recButton = event.target.closest('[data-play-rec]'); if (recButton) play(recButton.dataset.playRec, true);
    const detail = event.target.closest('[data-game]'); if (detail) openGame(detail.dataset.game);
  });
  document.getElementById('lib-sources').addEventListener('click', (event) => { const chip = event.target.closest('[data-lib-source]'); if (!chip) return; state.source = chip.dataset.libSource; render(); });
  document.querySelectorAll('[data-lib-sort]').forEach((button) => button.addEventListener('click', () => { state.sort = button.dataset.libSort; document.querySelectorAll('[data-lib-sort]').forEach((other) => other.setAttribute('aria-pressed', String(other === button))); renderGrid(); }));
  document.getElementById('lib-search').addEventListener('input', (event) => { state.query = event.target.value.trim(); renderGrid(); });
  document.getElementById('lib-rescan').addEventListener('click', scan);
  document.getElementById('lib-add').addEventListener('click', async () => { try { const result = await bridge.addGame(); if (result?.games) { state.games = result.games; render(); showToast('Jogo adicionado à biblioteca.'); } } catch (error) { showToast(error.message || 'Não foi possível adicionar.'); } });
  document.getElementById('lib-auto').addEventListener('change', async (event) => { try { await bridge.setSettings({ autoSession: event.target.checked }); showToast(event.target.checked ? 'O Nexo vai gravar sozinho quando um jogo abrir.' : 'Gravação automática desligada.'); } catch (error) { event.target.checked = !event.target.checked; showToast(error.message); } });
  bridge?.onGamesUpdated?.((games) => { state.games = games; render(); });
  bridge?.onSettingsChanged?.((settings) => { document.getElementById('lib-auto').checked = settings.autoSession; });
  Nexo.on('learned', () => { if (Nexo.state.view === 'library') render(); });
  Nexo.on('view', (view) => { if (view === 'library') { syncAuto(); if (!state.loaded) scan(); else render(); } });
  Nexo.commands.push({ label: 'Abrir a biblioteca de jogos', hint: 'Jogos', run: () => Nexo.go('library') }, { label: 'Procurar jogos instalados de novo', hint: 'Jogos', run: () => { Nexo.go('library'); scan(); } });
  render();
})();
