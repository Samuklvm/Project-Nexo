/*
 * Biblioteca de jogos: destaque com a arte oficial, prateleiras ("Continue jogando", "Mais jogados"), grade completa
 * (instalados e da conta) e uma página por jogo com tempo de jogo e o desempenho medido neste PC.
 * Leveza: imagens já vêm reduzidas do processo principal, carregam sob demanda, e cartões fora da tela não são pintados.
 */
(function () {
  const bridge = desktopBridge;
  const state = { games: [], filter: 'installed', sort: 'recent', query: '', loading: false, loaded: false, connections: null, art: null, open: null, tab: 'geral' };
  const when = (at) => new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  const short = (at) => { const date = new Date(at); return date.toLocaleDateString('pt-BR', date.getFullYear() === new Date().getFullYear() ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: '2-digit', year: '2-digit' }); };
  const dec = (value) => (Number.isFinite(value) ? Math.round(value).toString() : '--');
  const hours = (minutes) => (!Number.isFinite(minutes) ? null : minutes < 60 ? `${minutes} min` : `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0).replace('.', ',')} h`);
  const sessionsOf = (game) => Nexo.sessions?.forGame?.(game.id, game.name) || [];
  const byId = (id) => state.games.find((game) => game.id === id);
  /** Para a telemetria: quantos jogos por loja (instalados e da conta), nunca os nomes. */
  Nexo.libraryStats = () => {
    if (!state.loaded) return null;
    const out = { installed: 0, account: 0, apps: 0, stores: {} };
    for (const game of state.games) {
      if (game.kind === 'app') { out.apps += 1; continue; }
      if (game.installed) out.installed += 1; else out.account += 1;
      const store = /^[a-z]{2,12}$/.test(String(game.source)) ? game.source : 'outra';
      out.stores[store] = (out.stores[store] || 0) + 1;
    }
    return out;
  };

  /* ---------- Peças visuais ---------- */
  function art(game, kind = 'card') {
    if (game.cover) return `<img class="cover-img" src="${escapeHtml(game.cover)}" alt="" loading="lazy" decoding="async" />`;
    if (game.header) return `<div class="cover-header"><img src="${escapeHtml(game.header)}" alt="" loading="lazy" decoding="async" /><span>${escapeHtml(game.name)}</span></div>`;
    const icon = game.icon ? `<img class="cover-icon" src="${escapeHtml(game.icon)}" alt="" />` : '';
    const caption = kind === 'card' ? `<span>${escapeHtml(game.name)}</span>` : '';
    return `<div class="cover-gen" data-css="--hue:${Number(game.hue) || 220}">${icon}<b>${escapeHtml(initials(game.name))}</b>${caption}</div>`;
  }
  const wideArt = (game) => (game.hero ? `<img src="${escapeHtml(game.hero)}" alt="" loading="lazy" decoding="async" />` : game.header ? `<img src="${escapeHtml(game.header)}" alt="" loading="lazy" decoding="async" />` : game.cover ? `<img class="blur" src="${escapeHtml(game.cover)}" alt="" loading="lazy" decoding="async" />` : `<div class="cover-gen" data-css="--hue:${game.hue}"></div>`);
  const titleArt = (game, tag = 'h2') => (game.logo ? `<img class="game-logo" src="${escapeHtml(game.logo)}" alt="${escapeHtml(game.name)}" />` : `<${tag}>${escapeHtml(game.name)}</${tag}>`);

  function card(game, index) {
    const [session] = sessionsOf(game);
    const meta = !game.installed ? (game.fromAccount === 'xbox' ? 'No histórico da conta Xbox' : 'Na sua conta · não instalado') : game.lastPlayed ? `Jogado em ${short(game.lastPlayed)}` : game.sizeBytes ? formatBytes(game.sizeBytes) : game.sourceLabel;
    const fpsBadge = session?.report?.fps ? `<span class="fps-badge">${dec(session.report.fps.avgFps)} FPS</span>` : '';
    const playtime = hours(game.playtimeMin) ? `<b>${hours(game.playtimeMin)}</b><span>jogadas</span>` : `<span>${game.installed ? 'Pronto para jogar' : 'Não instalado'}</span>`;
    return `<button class="game-card${game.installed ? '' : ' not-installed'}" type="button" data-game="${escapeHtml(game.id)}" data-css="--i:${Math.min(index, 24)}">
      <div class="cover">${art(game)}<span class="src-badge">${escapeHtml(game.sourceLabel)}</span>${fpsBadge}
        <div class="cover-info">${playtime}</div></div>
      <div class="game-meta"><strong>${escapeHtml(game.name)}</strong><span>${escapeHtml(meta)}</span></div></button>`;
  }

  function tile(game) {
    const [session] = sessionsOf(game);
    const name = game.logo ? `<img class="tile-logo" src="${escapeHtml(game.logo)}" alt="${escapeHtml(game.name)}" />` : `<strong>${escapeHtml(game.name)}</strong>`;
    const fps = session?.report?.fps ? `${dec(session.report.fps.avgFps)} FPS` : null;
    const meta = [game.lastPlayed ? short(game.lastPlayed) : null, hours(game.playtimeMin), fps].filter(Boolean).map(escapeHtml).join(' · ');
    return `<button class="shelf-tile" type="button" data-game="${escapeHtml(game.id)}"><div class="tile-art">${wideArt(game)}</div><div class="tile-copy">${name}
      <span>${meta}</span></div></button>`;
  }

  /* ---------- Filtros ---------- */
  function visible() {
    const query = state.query.toLocaleLowerCase('pt-BR');
    const list = state.games.filter((game) => {
      const isApp = game.kind === 'app';
      if (state.filter === 'apps') return isApp && (!query || game.name.toLocaleLowerCase('pt-BR').includes(query));
      if (isApp) return false;
      if (state.filter === 'installed' && !game.installed) return false;
      if (state.filter === 'account' && game.installed) return false;
      if (!['installed', 'account', 'all'].includes(state.filter) && game.source !== state.filter) return false;
      return !query || game.name.toLocaleLowerCase('pt-BR').includes(query);
    });
    const sorters = { recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name, 'pt-BR'), name: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
      size: (a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0), playtime: (a, b) => (b.playtimeMin || 0) - (a.playtimeMin || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0) };
    return list.sort(sorters[state.sort]);
  }

  function renderFilters() {
    const games = state.games.filter((game) => game.kind !== 'app');
    const apps = state.games.length - games.length;
    const installed = games.filter((game) => game.installed);
    const account = games.length - installed.length;
    const counts = installed.reduce((acc, game) => { acc[game.source] = (acc[game.source] || 0) + 1; return acc; }, {});
    const labels = Object.fromEntries(state.games.map((game) => [game.source, game.sourceLabel]));
    const entries = [['installed', `Instalados · ${installed.length}`], ...(account ? [['account', `Na conta · ${account}`], ['all', `Tudo · ${games.length}`]] : []),
      ...Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((source) => [source, `${labels[source]} · ${counts[source]}`]), ...(apps ? [['apps', `Apps · ${apps}`]] : [])];
    document.getElementById('lib-sources').innerHTML = entries.map(([id, label]) => `<button type="button" data-lib-source="${escapeHtml(id)}" aria-pressed="${state.filter === id}">${escapeHtml(label)}</button>`).join('');
  }

  /* ---------- Destaque ---------- */
  function renderHero() {
    const installed = state.games.filter((game) => game.installed && game.kind !== 'app');
    const hero = installed.filter((game) => game.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || installed[0] || state.games[0];
    const artBox = document.getElementById('lib-hero-art');
    const actions = document.getElementById('lib-hero-actions');
    const stats = document.getElementById('lib-hero-stats');
    if (!hero) {
      artBox.replaceChildren(); stats.replaceChildren(); actions.replaceChildren();
      setText('lib-hero-eyebrow', 'Sua biblioteca');
      document.getElementById('lib-hero-title').innerHTML = `<h2>${state.loading ? 'Procurando seus jogos…' : state.loaded ? 'Nenhum jogo encontrado' : 'Biblioteca de jogos'}</h2>`;
      setText('lib-hero-sub', state.loaded ? 'O Nexo procura em Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot e Rockstar. Se o seu jogo veio de outro lugar, use “Adicionar jogo”.' : 'Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Riot, Rockstar e os que você adicionar.');
      return;
    }
    let background = `<div class="cover-gen hero-bg" data-css="--hue:${Number(hero.hue) || 220}"></div>`;
    if (hero.hero) background = `<img class="hero-wide" src="${escapeHtml(hero.hero)}" alt="" />`;
    else if (hero.cover) background = `<img class="hero-bg" src="${escapeHtml(hero.cover)}" alt="" />`;
    const heroCover = hero.hero ? '' : `<div class="hero-cover">${art(hero, 'big')}</div>`;
    artBox.innerHTML = `${background}${heroCover}`;
    if (hero.hero) Nexo.heroWake?.();
    const [session] = sessionsOf(hero);
    setText('lib-hero-eyebrow', hero.lastPlayed ? `Jogado por último · ${when(hero.lastPlayed)}` : hero.sourceLabel);
    document.getElementById('lib-hero-title').innerHTML = titleArt(hero);
    setText('lib-hero-sub', session ? session.report.conclusion : 'Ainda sem sessão gravada. “Jogar e gravar” mede FPS, tempo de quadro e o que limita o jogo neste PC.');
    stats.innerHTML = [hours(hero.playtimeMin) && ['Tempo de jogo', hours(hero.playtimeMin)], session?.report?.fps && ['FPS médio', dec(session.report.fps.avgFps)], session?.report?.fps && ['1% baixo', dec(session.report.fps.p1LowFps)], ['Loja', hero.sourceLabel]]
      .filter(Boolean).map(([label, value]) => `<div><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join('');
    const launchButtons = hero.canLaunch ? `<button class="btn primary" type="button" data-play="${escapeHtml(hero.id)}"><svg><use href="#i-play"/></svg>Jogar</button><button class="btn" type="button" data-play-rec="${escapeHtml(hero.id)}"><svg><use href="#i-record"/></svg>Jogar e gravar</button>` : '';
    actions.innerHTML = `${launchButtons}<button class="btn ghost" type="button" data-game="${escapeHtml(hero.id)}">Ver jogo</button>`;
  }

  /* ---------- Contas e capas ---------- */
  function renderAccounts() {
    const box = document.getElementById('lib-accounts');
    const c = state.connections;
    const chips = [];
    const accountAvatar = (url) => (url ? `<img src="${escapeHtml(url)}" alt="" />` : '');
    if (c?.steam?.connected) chips.push(`<span class="acc-chip"><span class="avatar">${accountAvatar(c.steam.avatar)}</span><span><b>${escapeHtml(c.steam.personaName)}</b><small>Steam${c.steam.hasKey ? ' · biblioteca da conta' : ' · tempo de jogo'}</small></span></span>`);
    if (c?.xbox?.connected) chips.push(`<span class="acc-chip"><span class="avatar">${accountAvatar(c.xbox.avatar)}</span><span><b>${escapeHtml(c.xbox.gamertag)}</b><small>Xbox · ${c.xbox.titles} títulos</small></span></span>`);
    if (c?.discord?.enabled) chips.push('<span class="acc-chip"><span class="avatar"></span><span><b>Discord</b><small>mostrando o que você joga</small></span></span>');
    const suggest = c?.steam?.installed && !c.steam.connected && c.steam.detected?.length;
    const detected = suggest ? c.steam.detected[0] : null;
    const suggestButton = detected ? `<button class="acc-suggest" type="button" data-connect-steam="${escapeHtml(detected.steamId)}"><span class="avatar">${accountAvatar(detected.avatar)}</span><span><b>Conectar ${escapeHtml(detected.personaName)}</b><small>conta Steam deste PC · tempo de jogo</small></span></button>` : '';
    box.innerHTML = `${chips.join('')}${suggestButton}<button class="btn sm ghost" type="button" id="lib-connect">${chips.length ? 'Gerenciar contas' : 'Conectar contas'}</button>`;
  }

  const ART_SEEN_KEY = 'nexo.art-banner-seen';
  const artSeen = () => { try { return Number(localStorage.getItem(ART_SEEN_KEY)) || 0; } catch { return 0; } };
  const markArtSeen = () => { try { localStorage.setItem(ART_SEEN_KEY, String(state.games.filter((game) => !game.cover && game.kind !== 'app').length)); } catch { /* sem armazenamento */ } };
  function renderArtBanner() {
    const banner = document.getElementById('art-banner');
    const missing = state.games.filter((game) => !game.cover && game.kind !== 'app').length;
    const running = Boolean(state.art);
    // Depois de uma busca, o aviso só volta se aparecerem jogos novos sem capa (antes ficava para sempre na tela).
    banner.hidden = !state.loaded || (!running && (!missing || missing <= artSeen()));
    if (banner.hidden) return;
    setText('art-banner-title', running ? 'Buscando capas oficiais…' : `${missing} jogo${missing > 1 ? 's' : ''} sem capa`);
    setText('art-banner-text', running ? `${state.art.done} de ${state.art.total} conferidos (Steam e Microsoft Store, só arte oficial)` : 'O Nexo pode buscar a capa oficial de cada um nas lojas (Steam e Microsoft Store). Jogos sem correspondência exata ficam com a arte gerada, e você pode escolher uma imagem.');
    document.getElementById('art-progress-wrap').hidden = !running;
    if (running) document.getElementById('art-progress').style.width = `${state.art.total ? (state.art.done / state.art.total) * 100 : 0}%`;
    document.getElementById('art-fetch').hidden = running;
  }

  function renderShelves() {
    const recent = state.games.filter((game) => game.installed && game.lastPlayed && game.kind !== 'app').sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 8);
    const top = state.games.filter((game) => game.playtimeMin > 0 && game.kind !== 'app').sort((a, b) => b.playtimeMin - a.playtimeMin).slice(0, 10);
    document.getElementById('shelf-recent').hidden = recent.length < 2;
    document.getElementById('shelf-recent-row').innerHTML = recent.map(tile).join('');
    document.getElementById('shelf-top').hidden = top.length < 3;
    document.getElementById('shelf-top-row').innerHTML = top.map((game, index) => card(game, index)).join('');
  }

  function renderGrid() {
    const grid = document.getElementById('lib-grid');
    if (state.loading && !state.games.length) { grid.innerHTML = Array.from({ length: 10 }, () => '<div class="game-card skeleton-card"><span class="skeleton"></span></div>').join(''); return; }
    const list = visible();
    setText('lib-count', state.filter === 'account' ? `Na sua conta (${list.length})` : state.filter === 'all' ? `Toda a biblioteca (${list.length})` : state.filter === 'apps' ? `Apps (${list.length})` : `Instalados (${list.length})`);
    grid.innerHTML = list.length ? list.map(card).join('') : `<div class="sheet empty-art">${Nexo.constellation?.() || ''}<span>${state.games.length ? 'Nada com esse filtro.' : 'Nenhum jogo encontrado neste PC ainda.'}</span></div>`;
  }

  function render() { renderFilters(); renderHero(); renderAccounts(); renderArtBanner(); renderShelves(); renderGrid(); if (state.open) renderGame(state.open); }

  /* ---------- Página do jogo ---------- */
  function fpsChart(sessions) {
    const points = sessions.filter((session) => session.report?.fps).slice(0, 12).reverse();
    if (points.length < 1) return '<p class="muted">Grave uma sessão com FPS para ver a evolução aqui.</p>';
    const max = Math.max(...points.map((session) => session.report.fps.avgFps)) * 1.15;
    const width = 100 / Math.max(points.length, 8); // no mínimo 8 vagas: uma sessão só não vira um bloco gigante
    const bars = points.map((session, index) => {
      const { fps } = session.report;
      const avg = (fps.avgFps / max) * 100;
      const low = (fps.p1LowFps / max) * 100;
      return `<g><rect x="${index * width + width * 0.18}" y="${100 - avg}" width="${width * 0.64}" height="${avg}" rx="1.2" class="fps-bar"/><rect x="${index * width + width * 0.18}" y="${100 - low}" width="${width * 0.64}" height="0.9" class="fps-low"/><title>${when(session.startedAt)}: ${dec(fps.avgFps)} FPS médios, 1% baixo ${dec(fps.p1LowFps)}</title></g>`;
    }).join('');
    return `<svg class="fps-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="FPS médio e 1% baixo por sessão">${bars}</svg><div class="fps-legend"><span><i class="fps-bar"></i>FPS médio</span><span><i class="fps-low"></i>1% baixo</span><span>${points.length} sessão(ões)</span></div>`;
  }

  /* ---------- Dados completos (loja, conquistas, novidades) ---------- */
  const details = new Map(); // id -> { loading, data, error }
  const TABS = [['geral', 'Visão geral'], ['conquistas', 'Conquistas'], ['novidades', 'Novidades'], ['desempenho', 'Desempenho']];
  const KIND = { atualizacao: ['Atualização', 'risk-baixo'], anuncio: ['Anúncio', ''], noticia: ['Notícia', ''] };
  const num = (value) => (Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—');

  async function loadDetails(game, force = false) {
    if (!bridge?.getGameDetails || (!force && details.get(game.id)?.data)) return;
    details.set(game.id, { loading: true });
    if (state.open === game.id) renderGame(game.id);
    try { details.set(game.id, { data: await bridge.getGameDetails(game.id) }); }
    catch (error) { details.set(game.id, { error: error.message || 'Não foi possível carregar.' }); }
    if (state.open === game.id) renderGame(game.id);
  }

  function consentCard(game) {
    return `<section class="sheet gp-consent"><div><h3>Ver tudo deste jogo, como na loja</h3><p class="muted">Descrição, capturas de tela, gêneros, requisitos, as novidades e atualizações oficiais e as suas conquistas vêm da Steam. Para isso o Nexo precisa consultar a Steam pela internet${game.source === 'steam' ? '' : ' (para jogos de outras lojas, procurando o mesmo nome exato)'}. Fica ligado em Ajustes e dá para desligar quando quiser.</p></div><button class="btn primary" type="button" data-allow-online="${escapeHtml(game.id)}">Permitir e carregar</button></section>`;
  }

  /** Aba "Visão geral" da página do jogo: capturas, descrição, requisitos e ficha da loja. */
  function overviewTab(game, info) {
    const store = info?.store;
    if (!store) return info?.appid === null ? '<p class="muted gp-empty">Este jogo não tem uma página com o mesmo nome na loja da Steam, então não há dados oficiais para mostrar.</p>' : '<p class="muted gp-empty">A loja não devolveu dados deste jogo agora.</p>';
    const facts = [['Desenvolvedora', store.developers.join(', ')], ['Distribuidora', store.publishers.join(', ')], ['Lançamento', store.comingSoon ? `${store.release} (em breve)` : store.release], ['Gêneros', store.genres.join(', ')], ['Preço na loja', store.price], ['Avaliações', store.recommendations ? `${num(store.recommendations)} recomendações` : null], ['Conquistas', store.achievementsTotal ? String(store.achievementsTotal) : null], ['Controle', store.controller === 'full' ? 'Suporte completo' : store.controller === 'partial' ? 'Suporte parcial' : null]].filter(([, value]) => value);
    const shotButton = (shot, index) => `<button type="button" class="shot" data-shot="${index}"><img src="${escapeHtml(shot.thumb)}" alt="Captura ${index + 1}" loading="lazy" decoding="async" /></button>`;
    const shots = store.screenshots.length ? `<div class="shots">${store.screenshots.map(shotButton).join('')}</div>` : '';
    const more = store.about && store.about !== store.description ? `<details class="gp-more"><summary>Ler mais</summary><p class="gp-about">${escapeHtml(store.about)}</p></details>` : '';
    const categoryChip = (item) => `<span class="chip">${escapeHtml(item)}</span>`;
    const categories = store.categories.length ? `<div class="chips-row">${store.categories.map(categoryChip).join('')}</div>` : '';
    const minimum = store.requirements.minimum ? `<pre>${escapeHtml(store.requirements.minimum)}</pre>` : '';
    const recommended = store.requirements.recommended ? `<pre>${escapeHtml(store.requirements.recommended)}</pre>` : '';
    const requirements = store.requirements.minimum || store.requirements.recommended ? `<section class="sheet"><h3>Requisitos de sistema</h3><div class="reqs">${minimum}${recommended}</div><p class="muted">Compare com o seu PC em Hardware. O Nexo não promete desempenho a partir dos requisitos: as sessões gravadas mostram o real.</p></section>` : '';
    const header = store.header ? `<img class="gp-header" src="${escapeHtml(store.header)}" alt="" loading="lazy" />` : '';
    let metaTone = 'bad';
    if (store.metacritic >= 75) metaTone = 'good';
    else if (store.metacritic >= 50) metaTone = 'warn';
    const metacritic = store.metacritic ? `<div class="meta-score" data-tone="${metaTone}"><b>${Number(store.metacritic) || 0}</b><span>Metacritic</span></div>` : '';
    const fact = ([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    return `<div class="gp-overview">
      <div class="gp-main">
        ${shots}
        <section class="sheet"><h3>Sobre o jogo</h3><p class="gp-desc">${escapeHtml(store.description)}</p>${more}
          ${categories}</section>
        ${requirements}
      </div>
      <aside class="gp-side">
        ${header}
        ${metacritic}
        <dl class="facts">${facts.map(fact).join('')}</dl>
        <button class="btn sm" type="button" data-store-url="https://store.steampowered.com/app/${escapeHtml(store.appid)}/">Página na loja Steam</button>
        ${info.matched ? '<p class="muted">Dados da página da Steam com o mesmo nome deste jogo.</p>' : ''}
      </aside></div>`;
  }

  /** Aba "Conquistas": progresso da conta Steam ou o aviso do que falta para ver. */
  function achievementsTab(game, info) {
    const ach = info?.achievements;
    const c = state.connections?.steam;
    const notice = (title, text, action = '') => `<section class="sheet gp-notice"><h3>${title}</h3><p class="muted">${text}</p>${action}</section>`;
    if (!ach || ach.state === 'error') return notice('Conquistas indisponíveis agora', 'A Steam não respondeu. Tente atualizar daqui a pouco.');
    if (ach.state === 'other-store') return notice('Conquistas da outra loja', `Este jogo é da ${escapeHtml(game.sourceLabel)}. As conquistas dessa loja não têm uma forma oficial de leitura por apps de PC, então o Nexo mostra só as da Steam.`);
    if (ach.state === 'needs-steam') return notice('Conecte a sua Steam', 'As conquistas são da sua conta. Conecte a conta Steam deste PC em Ajustes → Contas e conexões.', '<button class="btn primary sm" type="button" data-open-connections>Conectar</button>');
    const account = c?.personaName ? ` Conta: ${escapeHtml(c.personaName)}.` : '';
    if (ach.state === 'needs-key') return notice('Entre com a Steam para ver as conquistas', `O seu progresso de conquistas vem da conta Steam. Entre com a Steam em Ajustes → Contas e conexões (login oficial, sem senha no Nexo).${account}`, '<button class="btn primary sm" type="button" data-open-connections>Entrar com a Steam</button>');
    if (ach.state === 'none') return notice('Sem conquistas', 'Este jogo não tem conquistas na Steam.');
    const pct = ach.total ? Math.round((ach.unlocked / ach.total) * 100) : 0;
    const privateNote = ach.state === 'private' ? '<p class="notes-line">O seu perfil da Steam está com “Detalhes do jogo” privado, então a Steam não mostra o que você já desbloqueou. Abaixo, a lista do jogo.</p>' : '';
    const progressText = ach.unlocked === ach.total && ach.total ? 'Platinou! Todas desbloqueadas.' : `Faltam ${ach.total - ach.unlocked}. A porcentagem de cada uma é quantos jogadores no mundo têm.`;
    const achItem = (item) => {
      const icon = item.icon ? `<img src="${escapeHtml(item.icon)}" alt="" loading="lazy" decoding="async" />` : '<span class="ach-blank"></span>';
      const date = item.achieved && item.unlockedAt ? `<small>${when(item.unlockedAt)}</small>` : '';
      const rarity = (item.percent ?? null) !== null ? `<em class="${item.percent < 5 ? 'rare' : ''}">${String(item.percent).replace('.', ',')}%</em>` : '';
      return `<li class="${item.achieved ? 'got' : 'locked'}">${icon}
        <div><strong>${escapeHtml(item.name)}</strong><span>${item.description ? escapeHtml(item.description) : item.hidden ? 'Conquista oculta' : ''}</span></div>
        <div class="ach-meta">${date}${rarity}</div></li>`;
    };
    return `<section class="sheet ach-head"><div class="ach-ring" data-css="--p:${pct}"><b>${pct}%</b></div><div><h3>${ach.unlocked} de ${ach.total} conquistas</h3><div class="progress-track"><span data-css="width:${pct}%"></span></div>
        <p class="muted">${progressText}</p>${privateNote}</div></section>
      <ul class="ach-list">${ach.list.map(achItem).join('')}</ul>`;
  }

  function newsTab(game, info) {
    const news = info?.news || [];
    if (!news.length) return '<p class="muted gp-empty">Sem novidades publicadas na Steam para este jogo.</p>';
    const newsItem = (item) => {
      const [label, tone] = KIND[item.kind] || KIND.noticia;
      const link = item.url ? `<button class="link" type="button" data-store-url="${escapeHtml(item.url)}">Ler completo na Steam</button>` : '';
      return `<li class="news-item" data-kind="${escapeHtml(item.kind)}"><div class="news-head"><span class="chip ${tone}">${label}</span><span class="muted">${item.date ? when(item.date) : ''} · ${escapeHtml(item.source)}</span></div>
      <h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p>${link}</li>`;
    };
    return `<ol class="news">${news.map(newsItem).join('')}</ol>`;
  }

  function performanceTab(game, sessions) {
    const sessionItem = (session) => {
      const fps = session.report?.fps ? `${dec(session.report.fps.avgFps)} FPS · 1% baixo ${dec(session.report.fps.p1LowFps)}` : 'sem FPS';
      return `<li><button class="link" type="button" data-session="${escapeHtml(session.id)}">${when(session.startedAt)}</button><span>${fps}</span><small>${escapeHtml(session.report?.conclusion || '')}</small></li>`;
    };
    const sessionList = sessions.length ? `<ul class="game-sessions">${sessions.slice(0, 6).map(sessionItem).join('')}</ul>` : '';
    const playtime = (game.playtimeMin ?? null) !== null ? `<div><dt>Tempo de jogo</dt><dd>${escapeHtml(hours(game.playtimeMin))} (da conta)</dd></div>` : '';
    return `<div class="split gp-body">
      <section class="sheet"><div class="sheet-head"><div><h3>Desempenho neste PC</h3><p class="muted">Cada barra é uma sessão gravada. A linha clara marca o 1% baixo: quanto mais perto da barra, mais estável.</p></div></div>${fpsChart(sessions)}
        ${sessionList}</section>
      <section class="sheet"><div class="sheet-head"><h3>Sobre esta cópia</h3></div><dl class="facts">
        <div><dt>Loja</dt><dd>${escapeHtml(game.sourceLabel)}</dd></div><div><dt>Situação</dt><dd>${game.installed ? 'Instalado neste PC' : game.fromAccount === 'xbox' ? 'No histórico da conta Xbox' : 'Na sua conta, não instalado'}</dd></div>
        <div><dt>Capa</dt><dd>${escapeHtml(game.coverSource || 'arte gerada pelo Nexo')}</dd></div>${playtime}</dl>
        <p class="muted">O Nexo reconhece este jogo em primeiro plano pela pasta de instalação; o caminho não sai do processo principal.</p></section></div>`;
  }

  /** Desenha a página do jogo (capa, botões, números e a aba aberta). */
  function renderGame(id) {
    const game = byId(id);
    const page = document.getElementById('game-page');
    if (!game) { closeGame(); return; }
    const sessions = sessionsOf(game);
    const last = sessions.find((session) => session.report?.fps)?.report.fps;
    const entry = details.get(game.id);
    const info = entry?.data;
    const ach = info?.achievements?.state === 'ok' || info?.achievements?.state === 'private' ? info.achievements : null;
    const stats = [['Tempo de jogo', hours(game.playtimeMin) || '—'], ['Última vez', game.lastPlayed ? short(game.lastPlayed) : '—'], ['Conquistas', ach?.state === 'ok' ? `${ach.unlocked}/${ach.total}` : info?.store?.achievementsTotal ? `${info.store.achievementsTotal} no jogo` : '—'], ['Tamanho', game.sizeBytes ? formatBytes(game.sizeBytes) : '—'], ['FPS médio', last ? dec(last.avgFps) : '—'], ['1% baixo', last ? dec(last.p1LowFps) : '—']];
    const tab = state.tab || 'geral';
    let body = '';
    if (tab === 'desempenho') body = performanceTab(game, sessions);
    else if (entry?.loading) body = '<div class="gp-loading"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton short"></span><p class="muted">Carregando da Steam…</p></div>';
    else if (entry?.error) body = `<p class="notes-line">${escapeHtml(entry.error)}</p>`;
    else if (!info || info.consent === false) body = consentCard(game);
    else body = tab === 'conquistas' ? achievementsTab(game, info) : tab === 'novidades' ? newsTab(game, info) : overviewTab(game, info);
    const updates = (info?.news || []).filter((item) => item.kind === 'atualizacao').length;
    const genres = info?.store?.genres?.length ? ` · ${escapeHtml(info.store.genres.slice(0, 3).join(' · '))}` : '';
    const tagline = info?.store?.description ? `<p class="gp-tagline">${escapeHtml(info.store.description)}</p>` : '';
    const recordButton = game.installed ? `<button class="btn" type="button" data-play-rec="${escapeHtml(game.id)}"><svg><use href="#i-record"/></svg>Jogar e gravar</button>` : '';
    const playButtons = game.canLaunch ? `<button class="btn primary" type="button" data-play="${escapeHtml(game.id)}"><svg><use href="#i-play"/></svg>${game.installed ? 'Jogar' : 'Instalar pela loja'}</button>${recordButton}` : '';
    const revealButton = game.installed ? `<button class="btn ghost" type="button" data-reveal="${escapeHtml(game.id)}">Abrir pasta</button>` : '';
    const refreshButton = info?.appid ? `<button class="btn ghost" type="button" data-refresh-details="${escapeHtml(game.id)}">Atualizar dados</button>` : '';
    const removeButton = game.source === 'manual' ? `<button class="btn ghost" type="button" data-remove="${escapeHtml(game.id)}">Tirar da biblioteca</button>` : '';
    const statItem = ([label, value]) => `<div><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
    const tabButton = ([key, label]) => {
      let extra = '';
      if (key === 'conquistas' && ach?.state === 'ok') extra = ` <small>${ach.unlocked}/${ach.total}</small>`;
      else if (key === 'novidades' && updates) extra = ` <small>${updates} atualização(ões)</small>`;
      return `<button type="button" role="tab" data-tab="${key}" aria-selected="${tab === key}">${label}${extra}</button>`;
    };
    page.innerHTML = `<div class="gp-backdrop" aria-hidden="true">${wideArt(game)}</div>
      <button class="btn ghost sm gp-back" type="button" data-close-game>← Biblioteca</button>
      <header class="gp-head"><div class="cover gp-cover">${art(game, 'big')}</div><div class="gp-title">
        <span class="eyebrow">${escapeHtml(game.sourceLabel)}${game.installed ? '' : ' · não instalado'}${genres}</span>${titleArt(game)}
        ${tagline}
        <div class="btn-row">${playButtons}${revealButton}<button class="btn ghost" type="button" data-cover="${escapeHtml(game.id)}">Trocar capa</button>${refreshButton}${removeButton}</div>
      </div></header>
      <div class="gp-stats">${stats.map(statItem).join('')}</div>
      <nav class="gp-tabs" role="tablist">${TABS.map(tabButton).join('')}</nav>
      <div class="gp-tab-body">${body}</div>`;
    page.hidden = false;
    document.getElementById('lib-home').hidden = true;
  }
  function openGame(id) { state.open = id; state.tab = 'geral'; renderGame(id); document.getElementById('stage').scrollTo({ top: 0, behavior: 'smooth' }); const game = byId(id); if (game) loadDetails(game); }
  function closeGame() { state.open = null; document.getElementById('game-page').hidden = true; document.getElementById('lib-home').hidden = false; }
  function showShot(index) {
    const shots = details.get(state.open)?.data?.store?.screenshots || [];
    let current = index;
    const html = () => `<img class="shot-full" src="${escapeHtml(shots[current].full)}" alt="Captura ${current + 1}" /><p class="muted">${current + 1} de ${shots.length}</p>`;
    const dialog = Nexo.dialog({ title: byId(state.open)?.name || 'Capturas', wide: true, html: html(), actions: [
      { id: 'prev', label: '← Anterior', keepOpen: true, onClick: () => { current = (current - 1 + shots.length) % shots.length; dialog.setBody(html()); } },
      { id: 'next', label: 'Próxima →', keepOpen: true, onClick: () => { current = (current + 1) % shots.length; dialog.setBody(html()); } },
      { id: 'close', label: 'Fechar', tone: 'primary' }] });
  }

  /* ---------- Ações ---------- */
  async function scan() {
    if (!bridge?.scanGames || state.loading) return;
    state.loading = true;
    render();
    const button = document.getElementById('lib-rescan');
    setButtonBusy(button, true, 'Procurando…');
    try { [state.games, state.connections] = await Promise.all([bridge.scanGames(), bridge.getConnections?.().catch(() => null)]); state.loaded = true; }
    catch (error) { showToast(error.message || 'Não foi possível ler a biblioteca.'); }
    finally { state.loading = false; setButtonBusy(button, false); render(); }
  }

  async function fetchArt() {
    const ok = await Nexo.confirm({ title: 'Buscar as capas oficiais?', body: 'Para cada jogo sem capa, o Nexo pergunta às lojas oficiais (Steam e Microsoft Store) e só aceita a correspondência exata do nome. Essas lojas recebem o nome ou o número de cada jogo pesquisado e os dados normais da conexão. Dá para desligar em Ajustes.', confirmLabel: 'Buscar capas' });
    if (!ok) return;
    state.art = { done: 0, total: state.games.filter((game) => !game.cover).length };
    renderArtBanner();
    try { const result = await bridge.fetchGameArt(); showToast(result.found ? `${result.found} capa(s) oficial(is) encontrada(s).` : 'Nenhuma capa nova com correspondência exata.'); }
    catch (error) { showToast(error.message || 'Não foi possível buscar as capas.'); }
    finally { state.art = null; markArtSeen(); renderArtBanner(); }
  }

  /** Abre o jogo pelo launcher dele e, se pedido, começa a gravar a sessão. */
  async function play(id, record) {
    const game = byId(id);
    if (!game) return;
    try {
      await bridge.launchGame(id);
      recordActivity(game.installed ? 'Jogo aberto' : 'Instalação pedida', game.name);
      if (record && game.installed && !Nexo.sessions.isRecording()) {
        await Nexo.sessions.start({ name: game.name, gameId: game.id });
        showToast(`Gravando a sessão de ${game.name}. Pare em Sessões quando terminar.`, { label: 'Ver', run: () => Nexo.go('sessions') });
      } else showToast(game.installed ? `Abrindo ${game.name}…` : `Abrindo ${game.name} na loja…`);
    } catch (error) { showToast(error.message || 'Não foi possível abrir o jogo.'); }
  }

  async function syncAuto() {
    if (!bridge?.getSettings) return;
    try { document.getElementById('lib-auto').checked = (await bridge.getSettings()).autoSession; } catch { /* fora do desktop */ }
  }

  const view = document.querySelector('[data-view-panel="library"]');
  view.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-play],[data-play-rec],[data-game],[data-close-game],[data-reveal],[data-cover],[data-remove],[data-session],[data-connect-steam],[data-tab],[data-shot],[data-store-url],[data-allow-online],[data-refresh-details],[data-open-connections],#lib-connect,#art-fetch');
    if (!target) return;
    if (target.dataset.tab) { state.tab = target.dataset.tab; renderGame(state.open); return; }
    if (target.dataset.shot) { showShot(Number(target.dataset.shot)); return; }
    if (target.dataset.storeUrl) { bridge.openStoreUrl(target.dataset.storeUrl).catch((error) => showToast(error.message)); return; }
    if (target.dataset.allowOnline) { await bridge.setSettings({ onlineCovers: true }); const game = byId(target.dataset.allowOnline); if (game) { loadDetails(game, true); } return; }
    if (target.dataset.refreshDetails) { const game = byId(target.dataset.refreshDetails); if (game) { loadDetails(game, true); } return; }
    if ('openConnections' in target.dataset) { Nexo.openConnections?.(); return; }
    if (target.dataset.play) play(target.dataset.play, false);
    else if (target.dataset.playRec) play(target.dataset.playRec, true);
    else if (target.dataset.game && !target.closest('#game-page')) openGame(target.dataset.game);
    else if ('closeGame' in target.dataset) closeGame();
    else if (target.dataset.reveal) bridge.revealGame(target.dataset.reveal).catch((error) => showToast(error.message));
    else if (target.dataset.cover) { try { const result = await bridge.setGameCover(target.dataset.cover); if (result?.games) { state.games = result.games; render(); } } catch (error) { showToast(error.message || 'Não foi possível usar a imagem.'); } }
    else if (target.dataset.remove) {
      const game = byId(target.dataset.remove);
      if (!await Nexo.confirm({ title: `Tirar ${game?.name || 'o jogo'} da biblioteca?`, body: 'Só sai da lista do Nexo. O jogo continua instalado e as sessões gravadas ficam guardadas.', confirmLabel: 'Tirar da biblioteca' })) return;
      try { const result = await bridge.removeManualGame(target.dataset.remove); state.games = result.games; closeGame(); render(); } catch (error) { showToast(error.message || 'Não foi possível tirar o jogo.'); }
    }
    else if (target.dataset.session) { Nexo.go('sessions'); Nexo.sessions.open(target.dataset.session); }
    else if (target.dataset.connectSteam) { try { state.connections = await bridge.connectSteam(target.dataset.connectSteam); showToast('Steam conectada. Atualizando a biblioteca…'); scan(); } catch (error) { showToast(error.message); } }
    else if (target.id === 'lib-connect') Nexo.openConnections?.();
    else if (target.id === 'art-fetch') fetchArt();
  });
  document.getElementById('lib-sources').addEventListener('click', (event) => { const chip = event.target.closest('[data-lib-source]'); if (!chip) { return; } state.filter = chip.dataset.libSource; renderFilters(); renderGrid(); });
  document.querySelectorAll('[data-lib-sort]').forEach((button) => button.addEventListener('click', () => { state.sort = button.dataset.libSort; document.querySelectorAll('[data-lib-sort]').forEach((other) => other.setAttribute('aria-pressed', String(other === button))); renderGrid(); }));
  document.getElementById('lib-search').addEventListener('input', (event) => { state.query = event.target.value.trim(); if (state.query && state.filter === 'installed') { state.filter = 'all'; } renderFilters(); renderGrid(); });
  document.getElementById('lib-rescan').addEventListener('click', scan);
  document.getElementById('lib-add').addEventListener('click', async () => { try { const result = await bridge.addGame(); if (result?.games) { state.games = result.games; render(); showToast('Jogo adicionado à biblioteca.'); } } catch (error) { showToast(error.message || 'Não foi possível adicionar.'); } });
  document.getElementById('lib-auto').addEventListener('change', async (event) => { try { await bridge.setSettings({ autoSession: event.target.checked }); showToast(event.target.checked ? 'O Nexo vai gravar sozinho quando um jogo abrir.' : 'Gravação automática desligada.'); } catch (error) { event.target.checked = !event.target.checked; showToast(error.message); } });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.open && Nexo.state.view === 'library' && !document.querySelector('.modal-backdrop')) closeGame(); });
  bridge?.onGamesUpdated?.((games) => { state.games = games; render(); });
  bridge?.onArtProgress?.((progress) => { state.art = progress; renderArtBanner(); });
  bridge?.onSettingsChanged?.((settings) => { document.getElementById('lib-auto').checked = settings.autoSession; });
  // Conta nova (ex.: "Entrar com a Steam"): a Biblioteca relê na hora se estiver aberta, ou na próxima vez que abrir.
  Nexo.on('connections', (connections) => { state.connections = connections; details.clear(); if (Nexo.state.view === 'library') scan(); else state.stale = true; });
  Nexo.on('learned', () => { if (Nexo.state.view === 'library') render(); });
  Nexo.on('view', (name) => { if (name === 'library') { syncAuto(); if (!state.loaded || state.stale) { state.stale = false; scan(); } else render(); } });
  Nexo.commands.push({ label: 'Abrir a biblioteca de jogos', hint: 'Jogos', run: () => Nexo.go('library') }, { label: 'Procurar jogos instalados de novo', hint: 'Jogos', run: () => { Nexo.go('library'); scan(); } });
  render();
})();
