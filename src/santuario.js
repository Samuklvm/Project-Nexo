/*
 * Santuário (a cara da página de Ajustes): um salão com lanternas de ferro penduradas em fios (cada uma leva a uma
 * seção), arcos em ruína desenhados a tinta, um círculo de runas inventadas girando devagar e brasas subindo.
 * Embaixo, a barra fixa com as seções e a busca de ajustes.
 * Estilo próprio do Nexo, inspirado no clima de fantasia sombria desenhada à mão (como Hollow Knight: Silksong e
 * Frieren); nenhum desenho, personagem ou peça desses jogos é usado.
 * Desempenho: tudo o que se mexe anda no relógio único (Nexo.clock, 30 quadros), só com Ajustes aberto, em foco e com
 * o salão à vista; para no modo Leve e com "menos movimento" do sistema.
 */
(function () {
  const panel = document.querySelector('[data-view-panel="settings"]');
  const hall = document.getElementById('sanct-hall');
  if (!panel || !hall) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduce.matches || Nexo.effectsLite;
  const sections = [...panel.querySelectorAll('.sanct-sec')].map((element) => ({
    element, id: element.dataset.sec, title: element.querySelector('.sanct-sec-head h3')?.textContent.trim() || element.dataset.sec
  }));
  const SHORT = { 'Desempenho do Nexo': 'Desempenho', 'Privacidade e dados': 'Privacidade', 'Em segundo plano': 'Segundo plano', 'Perfil de uso': 'Perfil' };
  const shortName = (title) => SHORT[title] || title;

  // Gerador com semente: o desenho sai igual em toda abertura (sem tremer entre uma visita e outra).
  const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  /* ---------- Traço de tinta: o filtro que faz as linhas parecerem desenhadas a pena ---------- */
  const inkDefs = `<svg class="sanct-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
    <filter id="sanct-ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="sanct-ink-soft" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>
    <radialGradient id="sanct-glass-grad" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#fff2c9"/><stop offset="0.45" stop-color="#ffc867"/><stop offset="1" stop-color="#b8661f"/></radialGradient>
  </defs></svg>`;
  hall.insertAdjacentHTML('afterbegin', inkDefs);

  /* ---------- Arcos em ruína, correntes e galhos (silhuetas a tinta no fundo do salão) ---------- */
  function drawArches() {
    const host = hall.querySelector('.sanct-arches');
    if (!host) return;
    const rnd = seeded(41);
    const W = 1600, H = 230, base = H;
    // Topo do muro quebrado, irregular.
    let top = `M0 ${base}V40`;
    for (let x = 0; x <= W; x += 40) top += `L${x} ${Math.round(26 + rnd() * 22 + (x % 320 < 40 ? -14 : 0))}`;
    top += `V${base}Z`;
    // Janelas em arco ogival (o fundo aparece por elas).
    const windows = [];
    const arch = (x0, w, spring, apex) => {
      const r = w * 0.86, x1 = x0 + w, xm = x0 + w / 2;
      return `M${x0} ${base}V${spring}A${r} ${r} 0 0 1 ${xm} ${apex}A${r} ${r} 0 0 1 ${x1} ${spring}V${base}Z`;
    };
    [[70, 90, 158, 112], [250, 110, 150, 96], [470, 130, 140, 70], [735, 150, 132, 48], [1000, 130, 140, 70], [1230, 110, 150, 96], [1430, 90, 158, 112]]
      .forEach(([x, w, s, a]) => windows.push(arch(x, w, s, a)));
    // Rosácea no arco do meio.
    const rose = 'M810 104a22 22 0 1 0 0.1 0Z';
    // Galhos com espinhos subindo pela esquerda e pela direita.
    const vine = (x, flip) => {
      const k = flip ? -1 : 1;
      let d = `M${x} ${base}C${x + 30 * k} 170 ${x - 10 * k} 120 ${x + 40 * k} 70S${x + 90 * k} 30 ${x + 70 * k} 8`;
      for (let i = 0; i < 7; i++) { const y = 190 - i * 24, xx = x + (i % 2 ? 22 : 8) * k; d += `M${xx} ${y}l${(i % 2 ? 14 : -12) * k} -8`; }
      return d;
    };
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs><linearGradient id="sanct-window" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf7a" stop-opacity="0.2"/><stop offset="0.6" stop-color="#ff9a4a" stop-opacity="0.07"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></linearGradient></defs>
      <path class="arch-wall" d="${top}"/>
      <path class="arch-glass" d="${windows.join('')}${rose}"/>
      <path class="arch-vine" d="${vine(18, false)}${vine(1582, true)}"/>
    </svg>`;
  }

  /* ---------- Círculo de runas (glifos inventados, sem escrita real) ---------- */
  function drawRunes() {
    const host = document.getElementById('sanct-runes');
    if (!host) return;
    const rnd = seeded(2026);
    const glyph = () => {
      const pt = () => [Math.round(rnd() * 2) * 4, Math.round(rnd() * 3) * 4];
      let d = '';
      for (let s = 0; s < 3; s++) { const [a, b] = pt(); const [c, e] = pt(); d += `M${a} ${b}L${c} ${e === b && c === a ? e + 4 : e}`; }
      if (rnd() > 0.5) d += 'M4 -3h0.1';
      return d;
    };
    const R = 150, ring = [];
    const count = 28;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 360;
      ring.push(`<path transform="rotate(${angle}) translate(-4 ${-R + 9})" d="${glyph()}"/>`);
    }
    // Heptagrama: duas voltas pulando pontas.
    const star = Array.from({ length: 7 }, (_, i) => { const a = -Math.PI / 2 + (i * 3 * 2 * Math.PI) / 7; return `${(118 * Math.cos(a)).toFixed(1)} ${(118 * Math.sin(a)).toFixed(1)}`; });
    host.innerHTML = `<svg viewBox="-170 -170 340 340" aria-hidden="true"><g class="rune-spin">
      <circle r="${R + 6}" class="rune-line"/><circle r="${R - 16}" class="rune-line"/><circle r="${R - 22}" class="rune-line thin"/>
      <g class="rune-glyphs">${ring.join('')}</g>
      <path class="rune-line thin" d="M${star.join('L')}Z"/>
      <circle r="52" class="rune-line thin"/><circle r="6" class="rune-dot"/>
    </g></svg>`;
  }

  /* ---------- Lanternas (uma por seção) ---------- */
  const lanternSvg = `<svg class="lantern-art" viewBox="0 0 40 64" aria-hidden="true">
    <g class="ln-ink"><circle class="ln-line" cx="20" cy="4.5" r="3"/><path class="ln-fill" d="M9 19 20 9l11 10z"/><path class="ln-line" d="M20 7.5v2"/><path class="ln-fill" d="M7 19h26v3H7z"/></g>
    <path class="ln-glass" d="M10.5 22h19l-1.6 21h-15.8z"/>
    <path class="ln-flame" d="M20 27c2.8 3.6 3.6 6.6 0 11-3.6-4.4-2.8-7.4 0-11z"/>
    <g class="ln-ink"><path class="ln-line" d="M15.6 22.4l-.7 20.4M24.4 22.4l.7 20.4M11 32.5h18"/><path class="ln-fill" d="M10 43h20l-3 4H13z"/><path class="ln-fill" d="M17.2 47h5.6L20 54z"/><path class="ln-line" d="M20 54v4"/></g>
  </svg>`;
  const DROPS = [30, 62, 40, 72, 34, 66, 44, 78, 38, 60];
  function drawLanterns() {
    const nav = document.getElementById('sanct-lanterns');
    if (!nav) return;
    nav.innerHTML = sections.map((section, index) => `<button type="button" class="lantern" data-go-sec="${section.id}" data-css="--drop:${DROPS[index % DROPS.length]}px" aria-label="Ir para ${escapeHtml(section.title)}">
      <span class="lantern-thread" aria-hidden="true"></span>
      <span class="lantern-body"><span class="lantern-halo" aria-hidden="true"></span>${lanternSvg}</span>
      <span class="lantern-label">${escapeHtml(shortName(section.title))}</span>
    </button>`).join('');
  }



  /* ---------- Camadas do salão: torres ao longe, névoa e correntes na frente ---------- */
  function drawLayers() {
    const rnd = seeded(77);
    const W = 1600, H = 220;
    let towers = '';
    let lights = '';
    for (let x = 30; x < W; x += 90 + Math.round(rnd() * 120)) {
      const w = 26 + Math.round(rnd() * 34), h = 70 + Math.round(rnd() * 120), top = H - h, roof = 24 + Math.round(rnd() * 40);
      towers += `M${x} ${H}V${top}L${x + w / 2} ${top - roof}L${x + w} ${top}V${H}Z`;
      if (rnd() > 0.55) lights += `<rect class="spire-light" x="${x + w / 2 - 2}" y="${top + 14 + Math.round(rnd() * 30)}" width="4" height="7" rx="2"/>`;
    }
    const spires = document.createElement('div');
    spires.className = 'sanct-spires';
    spires.setAttribute('aria-hidden', 'true');
    spires.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice"><path class="spire" d="${towers}"/>${lights}</svg>`;
    const fog = document.createElement('div');
    fog.className = 'sanct-fog';
    fog.setAttribute('aria-hidden', 'true');
    hall.querySelector('.sanct-arches')?.before(spires, fog);
    // Correntes penduradas nos cantos, na frente de tudo.
    const chain = (x, links) => {
      let d = '', hi = '';
      for (let i = 0; i < links; i++) {
        const y = i * 11;
        if (i % 2) { d += `M${x - 1.2} ${y}h2.4v13h-2.4z`; } else { d += `M${x} ${y - 1}c4 0 4.6 3 4.6 7s-.6 7-4.6 7-4.6-3-4.6-7 .6-7 4.6-7z`; hi += `M${x + 2.6} ${y + 2}c.8 1.4.8 4.4 0 6`; }
      }
      return `<path class="chain" d="${d}"/><path class="chain-hi" d="${hi}"/>`;
    };
    const front = document.createElement('div');
    front.className = 'sanct-front';
    front.setAttribute('aria-hidden', 'true');
    front.innerHTML = `<svg viewBox="0 0 1600 340" preserveAspectRatio="none">${chain(14, 9)}${chain(30, 5)}${chain(1586, 7)}</svg>`;
    hall.append(front);
  }

  /* ---------- Sinos (decoração) e o manto do viajante (um segredo) ---------- */
  const bellSvg = `<svg viewBox="0 0 30 40" aria-hidden="true"><circle class="bell-fill" cx="15" cy="3.5" r="2.4"/><path class="bell-fill" d="M12.5 6h5v3.4h-5z"/>
    <path class="bell-fill" d="M15 9.2c-6.4 0-8.2 6.4-8.4 13.2-.1 4.2-1.5 6.8-3.6 8.6h24c-2.1-1.8-3.5-4.4-3.6-8.6-.2-6.8-2-13.2-8.4-13.2z"/>
    <path class="bell-gild" d="M6.2 26.6h17.6M9.6 15.4c.8-2.4 2.6-3.8 5.4-3.8"/><circle class="bell-fill" cx="15" cy="34" r="2.6"/></svg>`;
  function drawBells() {
    const host = document.createElement('div');
    host.className = 'sanct-bells';
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = [24, 62, 38].map((drop) => `<span class="sanct-bell" data-css="--drop:${drop}px"><span class="lantern-thread"></span>${bellSvg}</span>`).join('');
    hall.append(host);
  }
  function drawRelic() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sanct-relic';
    button.title = 'Alguém passou por aqui…';
    button.setAttribute('aria-label', 'Um manto de viajante e uma máscara deixados numa pedra');
    button.innerHTML = `<svg viewBox="0 0 230 104" aria-hidden="true">
      <path class="relic-stone" d="M30 102c-9-20-2-46 22-56 24-10 58-8 78 4 20 12 26 32 18 52z"/>
      <path class="relic-crack" d="M70 50l6 10-5 8 7 12"/>
      <path class="relic-cloak" d="M38 66c10-14 34-20 56-15 12 3 17 10 14 20-3 11 3 22 10 31H90c-5-5-12-5-18 0H62c-6-4-14-4-20 0h-6c-2-12-2-24 2-36z"/>
      <path class="relic-hood" d="M40 66c-6-6-4-14 4-17 8-3 16 1 18 8"/>
      <path class="relic-fold" d="M54 60c3 12 2 28-4 42M72 54c4 14 4 32 0 48M92 54c5 14 8 30 10 48"/>
      <path class="relic-clasp" d="M60 56l2.3 5 5.2.7-3.9 3.5 1 5.1-4.6-2.6-4.6 2.6 1-5.1-3.9-3.5 5.2-.7z"/>
      <g class="relic-mask" transform="translate(166 74) rotate(-16)">
        <path class="mask-face" d="M0-26c13 0 20 9 20 22 0 15-9 28-20 28S-20 11-20-4c0-13 7-22 20-22z"/>
        <path class="mask-eye" d="M-12-2c3-5 8-6 10-2-3 1-6 2-10 2zM12-2c-3-5-8-6-10-2 3 1 6 2 10 2z"/>
        <path class="mask-crack" d="M7-24l-3 8 4 5-4 8"/>
        <path class="mask-star" d="M0-21l1.6 5 5 1.6-5 1.6L0-8l-1.6-4.8-5-1.6 5-1.6z"/>
        <path class="mask-line" d="M-8 13c5 3 11 3 16 0"/>
      </g>
      <g transform="translate(206 92) rotate(70)"><path class="relic-lamp" d="M0 -12 6 -7H-6z"/><path class="relic-lamp" d="M-5 -7h10l-1 12H-4z"/><path class="relic-lamp" d="M-5 5h10l-1.6 2.6h-6.8z"/></g>
      <circle class="relic-fly-halo" cx="196" cy="40" r="10"/><circle class="relic-fly" cx="196" cy="40" r="2.3"/>
    </svg>`;
    button.addEventListener('click', () => showToast('Um viajante passou por aqui. Deixou o manto, a máscara e um vagalume tomando conta da lanterna. ✦'));
    hall.append(button);
  }

  /* ---------- Barra fixa: seções e busca ---------- */
  function drawChips() {
    const nav = document.getElementById('sanct-chips');
    if (!nav) return;
    nav.innerHTML = sections.map((section) => `<button type="button" class="sanct-chip" data-go-sec="${section.id}">${escapeHtml(shortName(section.title))}</button>`).join('');
  }
  panel.addEventListener('click', (event) => {
    const go = event.target.closest('[data-go-sec]');
    if (!go) return;
    const target = sections.find((section) => section.id === go.dataset.goSec)?.element;
    if (!target) return;
    target.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' });
    const lantern = hall.querySelector(`.lantern[data-go-sec="${go.dataset.goSec}"]`);
    if (lantern) kick.set(lantern, 1);
  });

  // Seção à vista: acende a lanterna e o chip dela.
  let current = null;
  const setCurrent = (id) => {
    if (id === current) return;
    current = id;
    for (const element of panel.querySelectorAll('[data-go-sec]')) {
      const on = element.dataset.goSec === id;
      element.classList.toggle('is-lit', on);
      if (element.classList.contains('sanct-chip')) element.setAttribute('aria-current', on ? 'true' : 'false');
    }
  };
  const seen = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) seen.set(entry.target.dataset.sec, entry.isIntersecting ? entry.boundingClientRect.top : null);
    const best = [...seen.entries()].filter(([, top]) => top !== null).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0];
    if (best) setCurrent(best[0]);
  }, { rootMargin: '-20% 0px -55% 0px' });
  sections.forEach((section) => observer.observe(section.element));

  /* Busca: acha ajustes pelo texto e por palavras-chave (sem acento e sem diferença de maiúsculas). */
  const fold = (text) => String(text || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const search = document.getElementById('sanct-search');
  const empty = document.getElementById('sanct-empty');
  const ITEMS = '[data-setting], [data-keywords], .setting-row, label.switch, .conn-card, .charm';
  let firstHit = null;
  function runSearch() {
    const words = fold(search.value).split(/\s+/).filter(Boolean);
    panel.querySelectorAll('.is-hit').forEach((element) => element.classList.remove('is-hit'));
    firstHit = null;
    panel.classList.toggle('is-searching', words.length > 0);
    let found = 0;
    for (const section of sections) {
      if (!words.length) { section.element.hidden = false; continue; }
      const head = fold(section.title);
      const items = [...section.element.querySelectorAll(ITEMS)];
      const hits = items.filter((item) => { const text = fold(`${item.textContent} ${item.dataset.keywords || ''}`); return words.every((word) => text.includes(word)); });
      // Só os achados mais de dentro brilham (o cartão inteiro não brilha junto com a linha certa).
      const inner = hits.filter((item) => !hits.some((other) => other !== item && item.contains(other)));
      inner.forEach((item) => item.classList.add('is-hit'));
      const show = inner.length > 0 || words.every((word) => head.includes(word));
      section.element.hidden = !show;
      if (show) { found += 1; if (!firstHit) firstHit = inner[0] || section.element; }
    }
    empty.hidden = !words.length || found > 0;
    if (!empty.hidden) empty.textContent = `Nenhum ajuste com “${search.value.trim()}”. Tente outra palavra, como cor, bateria, Steam ou bandeja.`;
  }
  search?.addEventListener('input', runSearch);
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && firstHit) { event.preventDefault(); Nexo.spotlight?.(firstHit); }
    if (event.key === 'Escape' && search.value) { event.preventDefault(); search.value = ''; runSearch(); }
  });
  Nexo.commands?.push({ label: 'Procurar um ajuste', hint: 'Ajustes', run: () => { Nexo.go('settings'); requestAnimationFrame(() => search?.focus()); } });
  for (const section of sections) Nexo.commands?.push({ label: `Ajustes › ${section.title}`, hint: 'Ajustes', run: () => { Nexo.go('settings'); requestAnimationFrame(() => section.element.scrollIntoView({ block: 'start' })); } });

  /* ---------- Brasas e poeira subindo no salão ---------- */
  const canvas = document.getElementById('sanct-embers');
  const ctx = canvas?.getContext('2d', { alpha: true });
  let embers = [];
  let width = 0, height = 0, ratio = 1;
  function sizeCanvas() {
    if (!canvas) return;
    const box = hall.getBoundingClientRect();
    ratio = Math.min(1.5, devicePixelRatio || 1);
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const rnd = Math.random;
    embers = Array.from({ length: Math.round(Math.min(46, width / 30)) }, () => ({
      x: rnd() * width, y: rnd() * height, r: 0.6 + rnd() * 1.8, vy: 6 + rnd() * 14, sway: rnd() * Math.PI * 2, warm: rnd() > 0.35, life: rnd()
    }));
  }
  function drawEmbers(elapsed) {
    if (!ctx) return;
    const dt = elapsed / 1000;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const ember of embers) {
      ember.y -= ember.vy * dt;
      ember.sway += dt * 0.9;
      ember.life += dt * 0.08;
      if (ember.y < -6) { ember.y = height + 4; ember.x = Math.random() * width; ember.life = 0; }
      const x = ember.x + Math.sin(ember.sway) * 8;
      const fade = Math.min(1, ember.y / (height * 0.5)) * (0.55 + 0.45 * Math.sin(ember.life * 9));
      ctx.globalAlpha = Math.max(0, fade) * (ember.warm ? 0.9 : 0.45);
      ctx.fillStyle = ember.warm ? '#ffb45e' : '#efe2c4';
      ctx.beginPath();
      ctx.arc(x, ember.y, ember.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- Movimento: balanço das lanternas, chama tremendo, runas girando ---------- */
  const kick = new Map(); // lanterna clicada balança mais por um instante
  const runeSpin = () => hall.querySelector('.rune-spin');
  let hallVisible = false;
  let running = false;
  function step(now, elapsed) {
    if (!hallVisible || Nexo.state.view !== 'settings' || still() || document.hidden || Nexo.isIdle?.()) { running = false; return false; }
    hall.querySelectorAll('.lantern').forEach((lantern, index) => {
      const extra = kick.get(lantern) || 0;
      if (extra) kick.set(lantern, Math.max(0, extra - elapsed / 1400));
      const swing = (1.6 + extra * 7) * Math.sin(now / (1700 + index * 130) + index * 1.7);
      const flicker = 0.82 + 0.12 * Math.sin(now / 90 + index * 3.1) + 0.06 * Math.sin(now / 37 + index);
      lantern.style.setProperty('--swing', `${swing.toFixed(2)}deg`);
      lantern.style.setProperty('--flicker', flicker.toFixed(3));
    });
    hall.querySelectorAll('.sanct-bell').forEach((bell, index) => bell.style.setProperty('--swing', `${(2.4 * Math.sin(now / (2300 + index * 410) + index * 2.2)).toFixed(2)}deg`));
    hall.querySelector('.sanct-relic')?.style.setProperty('--flicker', (0.5 + 0.5 * Math.sin(now / 420)).toFixed(3));
    runeSpin()?.setAttribute('transform', `rotate(${((now / 1000) * 2.4 % 360).toFixed(2)})`);
    drawEmbers(elapsed);
    return true;
  }
  function wake() {
    if (running || !hallVisible || still() || Nexo.state.view !== 'settings') return;
    running = true;
    Nexo.clock.add(step);
  }
  hall.addEventListener('pointerover', (event) => { const lantern = event.target.closest('.lantern'); if (lantern && !kick.get(lantern)) kick.set(lantern, 0.5); });
  new IntersectionObserver((entries) => { hallVisible = entries.some((entry) => entry.isIntersecting); wake(); }).observe(hall);
  new ResizeObserver(() => sizeCanvas()).observe(hall);
  Nexo.on('view', (view) => { if (view === 'settings') { sizeCanvas(); wake(); } });
  Nexo.on('effects', () => { if (still()) ctx?.clearRect(0, 0, canvas.width, canvas.height); wake(); });
  addEventListener('focus', wake);
  reduce.addEventListener?.('change', wake);

  drawArches();
  drawLayers();
  drawRunes();
  drawLanterns();
  drawBells();
  drawRelic();
  drawChips();
  sizeCanvas();
})();
