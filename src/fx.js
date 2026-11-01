/* Efeitos visuais: tom do céu, foco de luz, paralaxe, cascata de entrada, pílula da barra, números animados e marcas do anel.
   Tudo é desligado no modo Leve e quando o sistema pede menos movimento. */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduce.matches || Nexo.effectsLite;

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

  /* Paralaxe da arte de fundo. */
  const art = document.querySelector('.sky-art');
  let parallaxFrame = 0;
  let px = 0;
  let py = 0;
  addEventListener('pointermove', (event) => {
    if (still() || !art) return;
    px = event.clientX / innerWidth - 0.5;
    py = event.clientY / innerHeight - 0.5;
    if (parallaxFrame) return;
    parallaxFrame = requestAnimationFrame(() => {
      parallaxFrame = 0;
      art.style.transform = `translate3d(${(-px * 22).toFixed(1)}px, ${(-py * 14).toFixed(1)}px, 0) scale(1.06)`;
    });
  }, { passive: true });

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
    parts.forEach((element, index) => { element.style.setProperty('--i', String(Math.min(index, 14))); element.classList.remove('rise'); });
    void panel.offsetWidth;
    parts.forEach((element) => element.classList.add('rise'));
    clearTimeout(panel._riseTimer);
    panel._riseTimer = setTimeout(() => parts.forEach((element) => element.classList.remove('rise')), 1300);
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
