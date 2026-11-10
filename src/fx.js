/* Efeitos visuais: tom do céu, foco de luz, paralaxe, cascata de entrada, pílula da barra, números animados e marcas do anel.
   Tudo é desligado no modo Leve e quando o sistema pede menos movimento. */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduce.matches || Nexo.effectsLite;

  /*
   * Relógio único das animações decorativas (céu, aurora, mapa do sistema, faixa do laboratório).
   * Tudo o que se mexe muda no MESMO quadro, no máximo 30 por segundo. Animações de CSS infinitas rodavam na
   * taxa do monitor (60 a 144 Hz) e, a cada quadro, obrigavam a placa de vídeo a refazer o desfoque de todos os
   * painéis de vidro: numa placa integrada isso custava uns 30% de uso. Uma tarefa devolve false para sair.
   */
  Nexo.clock = (() => {
    const jobs = new Set();
    let running = false;
    let lastTick = 0;
    /** Um passo do relógio compartilhado dos efeitos: no máximo ~30 quadros por segundo e para quando não há trabalho. */
    function tick(now) {
      if (!jobs.size) { running = false; return; }
      requestAnimationFrame(tick);
      if (now - lastTick < 32) return;
      const elapsed = Math.min(now - lastTick, 250);
      lastTick = now;
      for (const job of [...jobs]) {
        let keep = false;
        try { keep = job(now, elapsed) !== false; } catch (error) { console.error(error); }
        if (!keep) jobs.delete(job);
      }
    }
    return {
      add(job) { jobs.add(job); if (!running) { running = true; lastTick = performance.now() - 40; requestAnimationFrame(tick); } },
      remove(job) { jobs.delete(job); },
      has: (job) => jobs.has(job),
      get size() { return jobs.size; }
    };
  })();

  /** Tom do app (good | warn | bad): muda a aurora, o anel e os acentos. */
  Nexo.setTone = (tone) => { document.body.dataset.tone = tone; };
  Nexo.setTone('good');

  /* Foco de luz que segue o mouse nos painéis (um único ouvinte, uma atualização por quadro). */
  const stage = document.getElementById('stage');
  let spotFrame = 0;
  let spotEvent = null;
  stage?.addEventListener('pointermove', (event) => {
    spotEvent = event;
    if (spotFrame) return;
    spotFrame = requestAnimationFrame(() => {
      spotFrame = 0;
      const target = spotEvent.target.closest?.('.sheet, .insight');
      if (!target) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${spotEvent.clientX - box.left}px`);
      target.style.setProperty('--my', `${spotEvent.clientY - box.top}px`);
    });
  }, { passive: true });

  /* Paralaxe da arte de fundo: segue o mouse com inércia (sem trancos) e para sozinha quando chega. */
  const art = document.querySelector('.sky-art');
  let targetX = 0, targetY = 0, curX = 0, curY = 0, parallaxFrame = 0;
  const parallaxStep = () => {
    curX += (targetX - curX) * 0.08;
    curY += (targetY - curY) * 0.08;
    art.style.transform = `translate3d(${(-curX * 16).toFixed(2)}px, ${(-curY * 10).toFixed(2)}px, 0) scale(1.06)`;
    parallaxFrame = Math.abs(targetX - curX) + Math.abs(targetY - curY) > 0.0015 ? requestAnimationFrame(parallaxStep) : 0;
  };
  addEventListener('pointermove', (event) => {
    if (still() || !art) return;
    targetX = event.clientX / innerWidth - 0.5;
    targetY = event.clientY / innerHeight - 0.5;
    if (!parallaxFrame) parallaxFrame = requestAnimationFrame(parallaxStep);
  }, { passive: true });

  /* Faixa de perigo da Otimização extrema: anda no relógio único, só com a tela aberta e em foco. */
  const tape = document.querySelector('.hazard-tape');
  let tapeOn = false;
  function tapeStep(now) {
    if (Nexo.state.view !== 'lab' || still() || document.hidden || Nexo.isIdle?.()) { tapeOn = false; return false; }
    tape.style.setProperty('--tape', `${((now / 1600) % 1 * 45.25).toFixed(2)}px`);
    return true;
  }
  const tapeWake = () => { if (tape && !tapeOn && Nexo.state.view === 'lab' && !still() && !Nexo.isIdle?.()) { tapeOn = true; Nexo.clock.add(tapeStep); } };
  Nexo.on('view', tapeWake);
  Nexo.on('idle', (idle) => { if (!idle) tapeWake(); });
  Nexo.on('effects', tapeWake);

  /* Arte do jogo em destaque na Biblioteca: o zoom lento também anda no relógio único. */
  let heroOn = false;
  function heroStep(now) {
    const art = document.querySelector('[data-view-panel="library"] .hero-wide');
    if (Nexo.state.view !== 'library' || !art || still() || document.hidden || Nexo.isIdle?.()) { heroOn = false; return false; }
    const k = (1 - Math.cos((now / 26000) * Math.PI)) / 2;
    art.style.transform = `scale(${(1.04 + 0.06 * k).toFixed(4)}) translateX(${(-1.5 * k).toFixed(3)}%)`;
    return true;
  }
  const heroWake = () => { if (!heroOn && Nexo.state.view === 'library' && !still() && !Nexo.isIdle?.()) { heroOn = true; Nexo.clock.add(heroStep); } };
  Nexo.on('view', () => setTimeout(heroWake, 60));
  Nexo.on('idle', (idle) => { if (!idle) heroWake(); });
  Nexo.on('effects', heroWake);
  Nexo.heroWake = heroWake; // a Biblioteca chama quando troca a arte

  /* Pílula que desliza até o item ativo da barra lateral. */
  const rail = document.getElementById('rail');
  const pill = document.getElementById('rail-pill');
  Nexo.placePill = () => {
    const active = document.querySelector('.rail-item.active');
    if (!active || !pill) return;
    const railBox = rail.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    pill.style.height = `${box.height}px`;
    pill.style.transform = `translateY(${box.top - railBox.top}px)`;
    pill.classList.add('on');
  };
  addEventListener('resize', () => Nexo.placePill());

  /* Entrada em cascata dos blocos de cada página. */
  Nexo.on('view', (view) => {
    requestAnimationFrame(Nexo.placePill);
    const panel = document.querySelector(`[data-view-panel="${view}"]`);
    if (!panel || still()) return;
    const parts = $$(':scope > .hero, :scope > .live, :scope > .orbit, :scope > .sheet, :scope > .learn, :scope > .page-head, :scope > .section-head, :scope > .chart-grid > *, :scope > .split > *, :scope > .split > .stack > *', panel);
    parts.forEach((element, index) => { element.style.setProperty('--i', String(Math.min(index, 10))); element.classList.remove('rise'); });
    void panel.offsetWidth;
    // Cada bloco perde a classe quando a SUA animação termina (antes um temporizador cortava os últimos no meio).
    parts.forEach((element) => {
      element.classList.add('rise');
      element.addEventListener('animationend', function done(event) { if (event.target !== element) return; element.classList.remove('rise'); element.removeEventListener('animationend', done); });
    });
  });

  /* Números que deslizam até o novo valor em vez de saltar. */
  const shown = new WeakMap();
  Nexo.num = function animateNumber(target, value, format = (v) => String(Math.round(v))) {
    const element = typeof target === 'string' ? document.getElementById(target) : target;
    if (!element) return;
    if (!Number.isFinite(value)) { element.textContent = '--'; shown.delete(element); return; }
    const previous = shown.get(element);
    const from = previous ? previous.current : undefined;
    if (from === undefined || still() || Math.abs(value - from) < 0.6) {
      shown.set(element, { current: value });
      element.textContent = format(value);
      return;
    }
    const token = { current: from };
    shown.set(element, token);
    const start = performance.now();
    const duration = 520;
    const step = (now) => {
      if (shown.get(element) !== token) return;
      const k = Math.min(1, (now - start) / duration);
      token.current = from + (value - from) * (1 - (1 - k) ** 3);
      element.textContent = format(token.current);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* Marcas do anel de saúde: 60 traços que acendem conforme a nota. */
  const ticks = document.getElementById('ring-ticks');
  if (ticks) {
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < 60; i += 1) {
      const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const major = i % 5 === 0;
      const inner = major ? 111 : 113.5;
      const outer = major ? 121 : 118.5;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', (120 + Math.cos(angle) * inner).toFixed(2));
      line.setAttribute('y1', (120 + Math.sin(angle) * inner).toFixed(2));
      line.setAttribute('x2', (120 + Math.cos(angle) * outer).toFixed(2));
      line.setAttribute('y2', (120 + Math.sin(angle) * outer).toFixed(2));
      line.setAttribute('class', major ? 'tick major' : 'tick');
      ticks.append(line);
    }
  }
  Nexo.lightTicks = (score) => {
    if (!ticks) return;
    const lit = Math.round((score / 100) * 60);
    [...ticks.children].forEach((line, index) => line.classList.toggle('on', index < lit));
  };

  /** Constelação decorativa para estados vazios. */
  Nexo.constellation = () => '<svg class="constellation" viewBox="0 0 120 44" aria-hidden="true"><path d="M8 32 34 14 62 26 88 8 112 22" /><g><circle cx="8" cy="32" r="2.2"/><circle cx="34" cy="14" r="2.6"/><circle cx="62" cy="26" r="2"/><circle cx="88" cy="8" r="2.8"/><circle cx="112" cy="22" r="2.2"/></g></svg>';
})();
