/*
 * Céu vivo: estrelas que piscam, vagalumes que vagam (e chegam perto do mouse), estrelas cadentes e, às vezes,
 * uma chuva de meteoros. Um único canvas, no máximo 30 quadros por segundo, com brilhos pré-desenhados.
 * Para sozinho com o app fora de foco, no modo Leve, com "menos movimento" do sistema e quando os efeitos
 * do céu são desligados em Ajustes. Se um quadro custar caro, o céu se ajusta e desenha menos coisas.
 */
(function () {
  const canvas = document.getElementById('ambient');
  if (!canvas) return;
  const context = canvas.getContext('2d', { alpha: true });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const PREFS_KEY = 'nexo-sky';
  const DEFAULTS = { fireflies: true, twinkle: true, meteors: true, showers: true, cursor: true, density: 'normal' };
  const DENSITY = { pouco: 0.55, normal: 1, muito: 1.6 };

  const prefs = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; } })();
  Nexo.sky = {
    prefs: () => ({ ...prefs }),
    set(patch) {
      Object.assign(prefs, patch);
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* só nesta sessão */ }
      build();
      wake();
      Nexo.emit('sky', { ...prefs });
    },
    /** Chuva de meteoros agora (atalho e recurso de Ajustes). */
    shower: () => { if (!still()) { shower(6); wake(); } },
    stats: () => ({ stars: stars.length, fireflies: flies.length, fps: Math.round(fps), budget: Math.round(scale * 100) })
  };

  let width = 0;
  let height = 0;
  let ratio = 1;
  let stars = [];
  let flies = [];
  let meteors = [];
  let scale = 1; // corte automático quando o quadro fica caro
  let running = false;
  let last = 0;
  let lastDraw = 0;
  let fps = 0;
  let costAvg = 0;
  let meteorTimer = null;
  let pointer = null;

  const still = () => reduce.matches || Nexo.effectsLite || document.hidden || document.body.classList.contains('idle');
  const rand = (a, b) => a + Math.random() * (b - a);

  /* Brilhos pré-desenhados: desenhar um gradiente por partícula a cada quadro sairia caro. */
  function sprite(color, size = 48) {
    const off = document.createElement('canvas');
    off.width = off.height = size;
    const c = off.getContext('2d');
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, color.replace('A', '0.95'));
    g.addColorStop(0.35, color.replace('A', '0.35'));
    g.addColorStop(1, color.replace('A', '0'));
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    return off;
  }
  const FLY_SPRITES = [sprite('rgba(220,255,140,A)'), sprite('rgba(255,226,130,A)'), sprite('rgba(150,240,255,A)')];
  const STAR_SPRITE = sprite('rgba(200,225,255,A)', 24);

  function resize() {
    ratio = Math.min(devicePixelRatio || 1, 1.25);
    width = canvas.width = Math.round(innerWidth * ratio);
    height = canvas.height = Math.round(innerHeight * ratio);
    build();
  }

  function build() {
    const area = (width * height) / (ratio * ratio);
    const k = (DENSITY[prefs.density] || 1) * scale;
    const starCount = prefs.twinkle ? Math.round(Math.min(150, Math.max(50, area / 12000)) * k) : 0;
    stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * width, y: Math.pow(Math.random(), 1.4) * height * 0.8,
      r: rand(0.5, 1.5) * ratio, base: rand(0.25, 0.75), speed: rand(0.5, 1.7), phase: Math.random() * Math.PI * 2, bright: Math.random() < 0.08
    }));
    const flyCount = prefs.fireflies ? Math.round(Math.min(34, Math.max(12, area / 55000)) * k) : 0;
    flies = Array.from({ length: flyCount }, (_, i) => newFly(i));
  }
  function newFly(i) {
    return {
      x: Math.random() * width, y: height * rand(0.38, 0.98), seed: Math.random() * 1000 + i,
      vx: 0, vy: 0, size: rand(9, 18) * ratio, sprite: FLY_SPRITES[Math.random() < 0.55 ? 0 : Math.random() < 0.7 ? 1 : 2],
      glow: Math.random(), cycle: rand(2.6, 5.5), offset: Math.random() * 6
    };
  }

  function spawnMeteor(delay = 0) {
    meteors.push({ x: width * rand(0.35, 1.05), y: -30 * ratio, progress: -delay, speed: rand(0.55, 0.85), length: width * rand(0.08, 0.14), tilt: rand(0.75, 0.9) });
  }
  function shower(count) { for (let i = 0; i < count; i += 1) spawnMeteor(i * rand(0.18, 0.4)); }
  function scheduleMeteor() {
    clearTimeout(meteorTimer);
    meteorTimer = setTimeout(() => {
      if (prefs.meteors && !still()) {
        if (prefs.showers && Math.random() < 0.12) shower(Math.round(rand(3, 7))); else spawnMeteor();
        wake();
      }
      scheduleMeteor();
    }, rand(5500, 12500));
  }

  function draw(time, dt) {
    context.clearRect(0, 0, width, height);
    const t = time / 1000;

    if (stars.length) {
      for (const star of stars) {
        const twinkle = 0.55 + 0.45 * Math.sin(t * star.speed + star.phase);
        const alpha = star.base * twinkle;
        if (star.bright) {
          const s = star.r * 9;
          context.globalAlpha = alpha * 0.9;
          context.drawImage(STAR_SPRITE, star.x - s / 2, star.y - s / 2, s, s);
        } else {
          context.globalAlpha = alpha;
          context.fillStyle = '#dfe9ff';
          context.fillRect(star.x, star.y, star.r, star.r);
        }
      }
    }

    if (flies.length) {
      context.globalCompositeOperation = 'lighter';
      for (const fly of flies) {
        // Passeio suave (sem ruído caro): soma de senos com fase própria de cada vagalume.
        const wx = Math.sin(t * 0.31 + fly.seed) + Math.sin(t * 0.17 + fly.seed * 1.7) * 0.6;
        const wy = Math.cos(t * 0.27 + fly.seed * 0.9) + Math.sin(t * 0.13 + fly.seed * 2.3) * 0.5;
        fly.vx += (wx * 0.018 - fly.vx * 0.02) * dt;
        fly.vy += (wy * 0.014 - fly.vy * 0.02) * dt;
        if (pointer && prefs.cursor) {
          const dx = pointer.x - fly.x;
          const dy = pointer.y - fly.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 180 * ratio && dist > 20 * ratio) { fly.vx += (dx / dist) * 0.006 * dt; fly.vy += (dy / dist) * 0.006 * dt; }
        }
        fly.x += fly.vx * dt * ratio;
        fly.y += fly.vy * dt * ratio;
        if (fly.x < -40) fly.x = width + 30; else if (fly.x > width + 40) fly.x = -30;
        if (fly.y < height * 0.25) fly.vy += 0.01 * dt; else if (fly.y > height + 20) fly.y = height * 0.5;
        const phase = ((t + fly.offset) % fly.cycle) / fly.cycle;
        const glow = Math.pow(Math.max(0, Math.sin(phase * Math.PI)), 2.2);
        context.globalAlpha = 0.12 + glow * 0.88;
        const s = fly.size * (0.8 + glow * 0.5);
        context.drawImage(fly.sprite, fly.x - s / 2, fly.y - s / 2, s, s);
      }
      context.globalCompositeOperation = 'source-over';
    }

    if (meteors.length) {
      for (const meteor of meteors) {
        meteor.progress += (dt / 1000) * meteor.speed;
        const k = meteor.progress;
        if (k <= 0 || k >= 1) continue;
        const headX = meteor.x - k * width * 0.42;
        const headY = -30 * ratio + k * height * meteor.tilt;
        const alpha = Math.sin(k * Math.PI) * 0.8;
        const tailX = headX + meteor.length * 0.55;
        const tailY = headY - meteor.length * 0.83;
        const gradient = context.createLinearGradient(headX, headY, tailX, tailY);
        gradient.addColorStop(0, `rgba(225, 245, 255, ${alpha})`);
        gradient.addColorStop(1, 'rgba(90, 150, 255, 0)');
        context.globalAlpha = 1;
        context.strokeStyle = gradient;
        context.lineWidth = Math.max(1.2, width / 1300);
        context.lineCap = 'round';
        context.beginPath(); context.moveTo(headX, headY); context.lineTo(tailX, tailY); context.stroke();
        context.globalAlpha = alpha;
        context.drawImage(STAR_SPRITE, headX - 6 * ratio, headY - 6 * ratio, 12 * ratio, 12 * ratio);
      }
      meteors = meteors.filter((meteor) => meteor.progress < 1);
    }
    context.globalAlpha = 1;
  }

  function frame(time) {
    if (still()) { running = false; drawStill(); return; }
    const elapsed = time - lastDraw;
    if (elapsed < 32) { requestAnimationFrame(frame); return; } // ~30 quadros por segundo bastam para o céu
    const dt = Math.min(time - last, 100) / 16.7;
    last = time;
    lastDraw = time;
    const start = performance.now();
    draw(time, dt);
    const cost = performance.now() - start;
    costAvg = costAvg * 0.95 + cost * 0.05;
    fps = fps * 0.9 + (1000 / Math.max(elapsed, 1)) * 0.1;
    // Quadro caro (PC fraco ou janela enorme): desenha menos, sem travar o resto do app.
    if (costAvg > 5 && scale > 0.4) { scale = Math.max(0.4, scale - 0.15); costAvg = 0; build(); }
    const busy = stars.length || flies.length || meteors.length;
    if (!busy) { running = false; return; }
    requestAnimationFrame(frame);
  }
  /** Quadro parado (sem animação): só as estrelas, para o céu não ficar vazio no modo Leve ou com menos movimento. */
  function drawStill() {
    context.clearRect(0, 0, width, height);
    if (Nexo.effectsLite || !prefs.twinkle) return;
    for (const star of stars) { context.globalAlpha = star.base * 0.7; context.fillStyle = '#dfe9ff'; context.fillRect(star.x, star.y, star.r, star.r); }
    context.globalAlpha = 1;
  }
  function wake() {
    if (running) return;
    if (still()) { drawStill(); return; }
    running = true;
    last = lastDraw = performance.now() - 40;
    requestAnimationFrame(frame);
  }

  addEventListener('resize', () => { resize(); wake(); });
  addEventListener('pointermove', (event) => { pointer = { x: event.clientX * ratio, y: event.clientY * ratio }; }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer = null; });
  document.addEventListener('visibilitychange', wake);
  Nexo.on('idle', wake);
  reduce.addEventListener?.('change', wake);
  // Modo Leve liga/desliga pela classe do body.
  new MutationObserver(wake).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // Clique duplo no céu vazio (fora dos painéis) solta uma estrela cadente: um segredo pequeno.
  document.addEventListener('dblclick', (event) => {
    if (still() || !prefs.meteors || event.target.closest('.sheet, button, input, a, .rail, .titlebar, .modal')) return;
    meteors.push({ x: event.clientX * ratio + width * 0.12, y: -30 * ratio, progress: 0, speed: 0.8, length: width * 0.12, tilt: 0.82 });
    wake();
  });

  resize();
  scheduleMeteor();
  wake();
})();
