/*
 * Espaço profundo atrás da constelação: céu mais escuro, nebulosa com textura, três camadas de estrelas, uma
 * galáxia distante, planetas (um gigante com anéis e um pequeno, gelado), cometas e um buraco negro com disco de
 * acreção e o arco de luz curvada por cima.
 *
 * Desenhado UMA vez num <svg> próprio, atrás do da constelação (o que se mexe fica no da frente; assim o fundo, que
 * tem filtro de textura, não é redesenhado a cada quadro). Mesmo viewBox da constelação, para os objetos ficarem
 * longe das estrelas e dos nomes. No modo Leve, sem a textura da nebulosa (só degradês).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoSpace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const f1 = (value) => Number(value).toFixed(1);
  /** Gerador determinístico: o mesmo céu toda vez (nada de estrelas pulando entre uma tela e outra). */
  function rng(seed) {
    let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
    return () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
  }

  /*
   * Onde fica cada objeto em cada constelação (longe das peças e dos nomes). x, y no viewBox; s = escala.
   *  chart: carta do relatório e da otimização (1000 × 320); sky: análise ao vivo (640 × 306, começa em y −6);
   *  mini: apresentação (640 × 280).
   */
  const LAYOUTS = {
    chart: { x: 0, y: 0, w: 1000, h: 320, hole: [930, 70, 1.25], giant: [66, 286, 0.56], ice: [92, 46, 1], galaxy: [548, 300, 1], comet: [[476, 26], [384, 8]], comet2: [[978, 252], [930, 226]], seed: 41 },
    sky: { x: 0, y: -6, w: 640, h: 306, hole: [590, 42, 0.85], giant: [42, 272, 0.42], ice: [56, 30, 0.8], galaxy: [612, 268, 0.75], comet: [[330, 8], [262, -4]], comet2: null, seed: 17 },
    mini: { x: 0, y: 0, w: 640, h: 280, hole: [592, 44, 0.85], giant: [48, 248, 0.45], ice: [56, 34, 0.85], galaxy: [606, 250, 0.8], comet: [[330, 12], [258, 0]], comet2: null, seed: 23 }
  };

  function stars(L, rand, prefix) {
    const out = [];
    const area = (L.w * L.h) / 320000;
    const place = () => [L.x + rand() * L.w, L.y + rand() * L.h];
    // Camada distante: muitas e quase apagadas.
    for (let i = 0; i < Math.round(260 * area); i += 1) { const [x, y] = place(); out.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${(0.3 + rand() * 0.45).toFixed(2)}" opacity="${(0.18 + rand() * 0.45).toFixed(2)}" />`); }
    const far = `<g class="space-stars far">${out.join('')}</g>`;
    // Camada do meio: algumas coloridas (estrelas mais quentes e mais frias, como num céu de verdade).
    const tints = ['#ffffff', '#ffffff', '#ffffff', '#cfe0ff', '#b8ccff', '#ffe2c2', '#ffd1a8'];
    const mid = [];
    for (let i = 0; i < Math.round(46 * area); i += 1) { const [x, y] = place(); mid.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${(0.7 + rand() * 0.6).toFixed(2)}" fill="${tints[Math.floor(rand() * tints.length)]}" opacity="${(0.45 + rand() * 0.4).toFixed(2)}" />`); }
    // Poucas brilhantes, com halo e raios finos.
    const bright = [];
    for (let i = 0; i < Math.max(3, Math.round(7 * area)); i += 1) {
      const [x, y] = place();
      const r = 1 + rand() * 0.8;
      const s = 5 + rand() * 6;
      bright.push(`<g transform="translate(${f1(x)} ${f1(y)})"><circle r="${f1(r * 5)}" fill="url(#${prefix}-starhalo)" /><path d="M${f1(-s)} 0H${f1(s)}M0 ${f1(-s)}V${f1(s)}" /><circle r="${r.toFixed(2)}" fill="#fff" /></g>`);
    }
    return `${far}<g class="space-stars mid">${mid.join('')}</g><g class="space-stars bright">${bright.join('')}</g>`;
  }

  /** Planeta gigante com faixas e anel (a parte de trás do anel passa atrás do planeta, a da frente, na frente). */
  function giant(prefix, [x, y, s]) {
    const r = 52 * s;
    const ring = (part) => `<ellipse class="space-ring ${part}" rx="${f1(r * 1.72)}" ry="${f1(r * 0.34)}" clip-path="url(#${prefix}-ring-${part})" />`;
    const bands = [-0.5, -0.18, 0.12, 0.42].map((k, i) => `<ellipse cx="0" cy="${f1(r * k)}" rx="${f1(r * 1.1)}" ry="${f1(r * (0.07 + (i % 2) * 0.05))}" fill="rgba(255,255,255,${i % 2 ? 0.05 : 0.08})" />`).join('');
    return `<g class="space-giant" transform="translate(${f1(x)} ${f1(y)}) rotate(-16)">
      <circle r="${f1(r * 1.9)}" fill="url(#${prefix}-giant-glow)" />${ring('back')}
      <g clip-path="url(#${prefix}-giant-clip)"><circle r="${f1(r)}" fill="url(#${prefix}-giant)" />${bands}<circle r="${f1(r)}" fill="url(#${prefix}-giant-shade)" /></g>${ring('front')}</g>`;
  }
  function giantDefs(prefix, s) {
    const r = 52 * s;
    return `<radialGradient id="${prefix}-giant" cx="0.68" cy="0.3" r="0.95"><stop offset="0" stop-color="#d9c2f5" /><stop offset="0.35" stop-color="#7f68c4" /><stop offset="0.75" stop-color="#2f2466" /><stop offset="1" stop-color="#0f0b29" /></radialGradient>
      <radialGradient id="${prefix}-giant-shade" cx="0.75" cy="0.25" r="1"><stop offset="0.45" stop-color="#05040f" stop-opacity="0" /><stop offset="1" stop-color="#05040f" stop-opacity="0.85" /></radialGradient>
      <radialGradient id="${prefix}-giant-glow"><stop offset="0.48" stop-color="#9d86ff" stop-opacity="0.1" /><stop offset="1" stop-color="#9d86ff" stop-opacity="0" /></radialGradient>
      <clipPath id="${prefix}-giant-clip"><circle r="${f1(r)}" /></clipPath>
      <clipPath id="${prefix}-ring-back"><rect x="${f1(-r * 2)}" y="${f1(-r)}" width="${f1(r * 4)}" height="${f1(r)}" /></clipPath>
      <clipPath id="${prefix}-ring-front"><rect x="${f1(-r * 2)}" y="0" width="${f1(r * 4)}" height="${f1(r)}" /></clipPath>`;
  }

  /** Buraco negro: disco de acreção inclinado, a sombra, o anel de fótons e o arco do disco de trás curvado por cima. */
  function hole(prefix, [x, y, s]) {
    const r = 11 * s;
    return `<g class="space-hole" transform="translate(${f1(x)} ${f1(y)}) rotate(-14)">
      <circle r="${f1(r * 6)}" fill="url(#${prefix}-hole-glow)" />
      <ellipse class="disk back" rx="${f1(r * 4.6)}" ry="${f1(r * 0.95)}" fill="url(#${prefix}-disk)" clip-path="url(#${prefix}-hole-top)" />
      <ellipse class="lens" rx="${f1(r * 1.75)}" ry="${f1(r * 1.55)}" fill="none" stroke="url(#${prefix}-lens)" stroke-width="${f1(r * 0.55)}" clip-path="url(#${prefix}-hole-top)" />
      <circle r="${f1(r * 1.18)}" fill="none" stroke="#ffe8c7" stroke-opacity="0.75" stroke-width="${f1(Math.max(0.6, r * 0.09))}" />
      <circle r="${f1(r)}" fill="#010104" />
      <ellipse class="disk front" rx="${f1(r * 4.6)}" ry="${f1(r * 0.95)}" fill="url(#${prefix}-disk)" clip-path="url(#${prefix}-hole-bottom)" /></g>`;
  }
  function holeDefs(prefix, s) {
    const r = 11 * s;
    return `<radialGradient id="${prefix}-disk"><stop offset="0.24" stop-color="#fff4dc" stop-opacity="0.95" /><stop offset="0.42" stop-color="#ffc77a" stop-opacity="0.85" /><stop offset="0.7" stop-color="#ff7b4a" stop-opacity="0.35" /><stop offset="1" stop-color="#ff5a3c" stop-opacity="0" /></radialGradient>
      <linearGradient id="${prefix}-lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd59a" stop-opacity="0.75" /><stop offset="1" stop-color="#ff9a5c" stop-opacity="0.1" /></linearGradient>
      <radialGradient id="${prefix}-hole-glow"><stop offset="0.15" stop-color="#ffb978" stop-opacity="0.16" /><stop offset="1" stop-color="#ff8a5c" stop-opacity="0" /></radialGradient>
      <clipPath id="${prefix}-hole-top"><rect x="${f1(-r * 6)}" y="${f1(-r * 6)}" width="${f1(r * 12)}" height="${f1(r * 6)}" /></clipPath>
      <clipPath id="${prefix}-hole-bottom"><rect x="${f1(-r * 6)}" y="0" width="${f1(r * 12)}" height="${f1(r * 6)}" /></clipPath>`;
  }

  const ice = (prefix, [x, y, s]) => `<g class="space-ice" transform="translate(${f1(x)} ${f1(y)})"><circle r="${f1(15 * s)}" fill="url(#${prefix}-ice-glow)" /><circle r="${f1(7 * s)}" fill="url(#${prefix}-ice)" /></g>`;
  const iceDefs = (prefix) => `<radialGradient id="${prefix}-ice" cx="0.3" cy="0.3" r="0.9"><stop offset="0" stop-color="#e6fbff" /><stop offset="0.45" stop-color="#6fc6e8" /><stop offset="1" stop-color="#0c2a44" /></radialGradient>
    <radialGradient id="${prefix}-ice-glow"><stop offset="0.45" stop-color="#7fd8ff" stop-opacity="0.22" /><stop offset="1" stop-color="#7fd8ff" stop-opacity="0" /></radialGradient>`;
  const galaxy = (prefix, [x, y, s]) => `<g class="space-galaxy" transform="translate(${f1(x)} ${f1(y)}) rotate(-24)"><ellipse rx="${f1(22 * s)}" ry="${f1(6 * s)}" fill="url(#${prefix}-galaxy)" /><ellipse rx="${f1(12 * s)}" ry="${f1(3 * s)}" fill="url(#${prefix}-galaxy)" transform="rotate(38)" opacity="0.6" /><circle r="${f1(1.6 * s)}" fill="#fff6e8" /></g>`;
  const galaxyDefs = (prefix) => `<radialGradient id="${prefix}-galaxy"><stop offset="0" stop-color="#fff1d6" stop-opacity="0.75" /><stop offset="0.35" stop-color="#c9b6ff" stop-opacity="0.32" /><stop offset="1" stop-color="#7d8cff" stop-opacity="0" /></radialGradient>`;
  function comet(prefix, [[hx, hy], [tx, ty]], n) {
    return `<g class="space-comet"><line x1="${f1(tx)}" y1="${f1(ty)}" x2="${f1(hx)}" y2="${f1(hy)}" stroke="url(#${prefix}-tail-${n})" stroke-width="1.6" stroke-linecap="round" /><circle cx="${f1(hx)}" cy="${f1(hy)}" r="1.5" fill="#f4fbff" /><circle cx="${f1(hx)}" cy="${f1(hy)}" r="5" fill="url(#${prefix}-starhalo)" /></g>`;
  }
  const tailDef = (prefix, [[hx, hy], [tx, ty]], n) => `<linearGradient id="${prefix}-tail-${n}" gradientUnits="userSpaceOnUse" x1="${f1(tx)}" y1="${f1(ty)}" x2="${f1(hx)}" y2="${f1(hy)}"><stop offset="0" stop-color="#9fdcff" stop-opacity="0" /><stop offset="1" stop-color="#e8f7ff" stop-opacity="0.8" /></linearGradient>`;

  /**
   * O <svg> do fundo, inteiro. `kind`: chart | sky | mini. `lite`: sem a textura (filtro) da nebulosa.
   */
  function svg(kind, { prefix = 'space', lite = false } = {}) {
    const L = LAYOUTS[kind] || LAYOUTS.chart;
    const rand = rng(L.seed);
    const p = `${prefix}-${kind}`;
    const cx = L.x + L.w / 2;
    const cy = L.y + L.h / 2;
    const texture = lite ? '' : `<filter id="${p}-cloud" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${(3.2 / L.w).toFixed(4)} ${(5.4 / L.h).toFixed(4)}" numOctaves="4" seed="${L.seed}" /><feColorMatrix type="matrix" values="0 0 0 0 0.52  0 0 0 0 0.42  0 0 0 0 1  0 0 0 1.4 -0.62" /></filter>
      <filter id="${p}-cloud2" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${(5 / L.w).toFixed(4)} ${(7 / L.h).toFixed(4)}" numOctaves="3" seed="${L.seed + 7}" /><feColorMatrix type="matrix" values="0 0 0 0 0.3  0 0 0 0 0.78  0 0 0 0 0.95  0 0 0 1.3 -0.66" /></filter>`;
    const defs = `<defs>
      <radialGradient id="${p}-bg" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#0d1236" /><stop offset="0.55" stop-color="#070a20" /><stop offset="1" stop-color="#020309" /></radialGradient>
      <radialGradient id="${p}-fade" cx="0.5" cy="0.5" r="0.5"><stop offset="0.55" stop-color="#fff" /><stop offset="1" stop-color="#000" /></radialGradient>
      <mask id="${p}-mask" maskContentUnits="userSpaceOnUse"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="url(#${p}-fade)" /></mask>
      <linearGradient id="${p}-band" x1="0" y1="0" x2="1" y2="1"><stop offset="0.12" stop-color="#000" /><stop offset="0.5" stop-color="#fff" /><stop offset="0.88" stop-color="#000" /></linearGradient>
      <mask id="${p}-band-mask" maskContentUnits="userSpaceOnUse"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="url(#${p}-band)" /></mask>
      <radialGradient id="${p}-milky" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#b9c6ff" stop-opacity="0.16" /><stop offset="1" stop-color="#b9c6ff" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-violet"><stop offset="0" stop-color="#8a5cff" stop-opacity="0.22" /><stop offset="1" stop-color="#8a5cff" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-teal"><stop offset="0" stop-color="#3ad6ff" stop-opacity="0.14" /><stop offset="1" stop-color="#3ad6ff" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-starhalo"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55" /><stop offset="1" stop-color="#cfe0ff" stop-opacity="0" /></radialGradient>
      ${texture}${giantDefs(p, L.giant[2])}${holeDefs(p, L.hole[2])}${iceDefs(p)}${galaxyDefs(p)}${tailDef(p, L.comet, 1)}${L.comet2 ? tailDef(p, L.comet2, 2) : ''}
    </defs>`;
    const clouds = lite ? '' : `<g mask="url(#${p}-band-mask)" opacity="0.55"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" filter="url(#${p}-cloud)" /></g><g mask="url(#${p}-band-mask)" opacity="0.4"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" filter="url(#${p}-cloud2)" /></g>`;
    const glow = `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(L.w * 0.62)}" ry="${f1(L.h * 0.3)}" transform="rotate(-9 ${f1(cx)} ${f1(cy)})" fill="url(#${p}-milky)" />`
      + `<ellipse cx="${f1(L.x + L.w * 0.28)}" cy="${f1(L.y + L.h * 0.38)}" rx="${f1(L.w * 0.26)}" ry="${f1(L.h * 0.42)}" fill="url(#${p}-violet)" />`
      + `<ellipse cx="${f1(L.x + L.w * 0.74)}" cy="${f1(L.y + L.h * 0.62)}" rx="${f1(L.w * 0.24)}" ry="${f1(L.h * 0.38)}" fill="url(#${p}-teal)" />`;
    // O céu se esvai nas bordas (funde com o cartão); os astros ficam por cima, inteiros.
    const body = `<g mask="url(#${p}-mask)"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="url(#${p}-bg)" />${glow}${clouds}${stars(L, rand, p)}</g>${galaxy(p, L.galaxy)}${comet(p, L.comet, 1)}${L.comet2 ? comet(p, L.comet2, 2) : ''}${ice(p, L.ice)}${hole(p, L.hole)}${giant(p, L.giant)}`;
    return `<svg class="space-art" viewBox="${L.x} ${L.y} ${L.w} ${L.h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${defs}${body}</svg>`;
  }

  /**
   * Põe o fundo atrás de um <svg> de constelação: embrulha os dois numa moldura (os dois no mesmo lugar da grade).
   * Chamar de novo só troca o fundo (por exemplo, ao entrar ou sair do modo Leve).
   */
  function mount(target, kind, options = {}) {
    if (!target || typeof document === 'undefined') return;
    let stage = target.parentElement;
    if (!stage?.classList.contains('space-stage')) {
      stage = document.createElement('div');
      stage.className = `space-stage space-${kind}`;
      target.parentElement.insertBefore(stage, target);
      stage.appendChild(target);
    }
    const lite = Boolean(options.lite);
    const current = stage.querySelector(':scope > .space-art');
    if (current && current.dataset.lite === String(lite)) return;
    const holder = document.createElement('div');
    holder.innerHTML = svg(kind, { prefix: options.prefix || target.id || 'space', lite });
    const art = holder.firstElementChild;
    art.dataset.lite = String(lite);
    if (current) current.replaceWith(art); else stage.insertBefore(art, target);
  }

  return { svg, mount, LAYOUTS, rng };
});
