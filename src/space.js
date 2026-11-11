/*
 * Espaço profundo atrás da constelação, desenhado como uma foto de céu de longa exposição:
 *  - fundo preto;
 *  - nebulosa com textura (turquesa de um lado, violeta e magenta do outro, com um núcleo quente), cortada por
 *    faixas escuras de poeira;
 *  - campo de estrelas com distribuição de brilho realista: milhares de pontos fracos, centenas pequenas, algumas
 *    com halo e poucas brilhantes com raios finos que se apagam nas pontas; mais densas ao longo da faixa da galáxia;
 *  - galáxias distantes (pequenas elipses), um gigante gasoso com faixas e anel, um planeta pequeno com atmosfera,
 *    cometas e um buraco negro com disco de acreção e o arco de luz curvada por cima.
 *
 * Desenhado UMA vez num <svg> próprio, atrás do da constelação (o que se mexe fica no da frente; assim o fundo, que
 * tem filtros de textura, não é redesenhado a cada quadro). Mesmo viewBox da constelação, para os astros ficarem
 * longe das estrelas e dos nomes. No modo Leve, sem as texturas (só degradês e estrelas).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoSpace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const f1 = (value) => Number(value).toFixed(1);
  const f2 = (value) => Number(value).toFixed(2);
  /** Gerador determinístico: o mesmo céu toda vez (nada de estrelas pulando entre uma tela e outra). */
  function rng(seed) {
    let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
    return () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
  }
  /** Normal padrão (Box–Muller), para as estrelas se concentrarem na faixa da galáxia. */
  const gauss = (rand) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());

  /*
   * Onde fica cada astro em cada constelação (longe das peças e dos nomes). x, y no viewBox; s = escala.
   *  chart: carta do relatório e da otimização (1000 × 320); sky: análise ao vivo (640 × 306, começa em y −6);
   *  mini: apresentação (640 × 280).  band: faixa da galáxia (ângulo em graus, largura relativa).
   */
  // As peças da constelação (as mesmas posições de src/view-deep.js): estrela de fundo brilhante não nasce colada nelas.
  const CHART_NODES = [[250, 86], [640, 72], [480, 160], [815, 150], [130, 190], [345, 238], [680, 236]];
  const SKY_NODES = [[190, 70], [420, 58], [310, 148], [522, 152], [108, 178], [236, 238], [452, 236]];
  const LAYOUTS = {
    chart: { x: 0, y: 0, w: 1000, h: 320, hole: [924, 78, 1.15], giant: [70, 278, 0.52], ice: [92, 46, 1], galaxies: 7, comet: [[476, 26], [384, 8]], comet2: [[978, 252], [930, 226]], band: [-11, 0.2], seed: 41, avoid: CHART_NODES, gap: 62 },
    sky: { x: 0, y: -6, w: 640, h: 306, hole: [586, 50, 0.8], giant: [46, 262, 0.4], ice: [56, 30, 0.8], galaxies: 4, comet: [[330, 8], [262, -4]], comet2: null, band: [-14, 0.24], seed: 17, avoid: SKY_NODES, gap: 40 },
    // A página inteira da Análise: só céu (estrelas, nebulosa e galáxias distantes); os astros ficam perto da constelação.
    page: { x: 0, y: 0, w: 1600, h: 1000, page: true, density: 0.95, galaxies: 22, band: [-24, 0.16], seed: 59, avoid: [], gap: 0, spiral: [250, 862, 0.8], ringNeb: [1500, 540, 1] },
    mini: { x: 0, y: 0, w: 640, h: 280, hole: [592, 44, 0.85], giant: [48, 248, 0.45], ice: [56, 34, 0.85], galaxies: 4, comet: [[330, 12], [258, 0]], comet2: null, band: [-14, 0.24], seed: 23, avoid: SKY_NODES, gap: 40 }
  };

  /* ---------------- Estrelas ---------------- */
  const WHITE = ['#ffffff', '#ffffff', '#ffffff', '#f4f7ff', '#e8f0ff'];
  const TINTS = ['#ffffff', '#ffffff', '#eef4ff', '#d6e4ff', '#c4d6ff', '#fff3e2', '#ffe2c4', '#ffd2b0'];
  function starField(L, rand, p) {
    const area = ((L.w * L.h) / 320000) * (L.density || 1);
    const [angle, width] = L.band;
    const cx = L.x + L.w / 2;
    const cy = L.y + L.h / 2;
    const rad = (angle * Math.PI) / 180;
    /** Metade das estrelas fracas se concentra na faixa da galáxia (como na Via Láctea); o resto, espalhado. */
    const place = (inBand) => {
      if (!inBand) return [L.x + rand() * L.w, L.y + rand() * L.h];
      const along = (rand() - 0.5) * L.w * 1.2;
      const across = gauss(rand) * L.h * width;
      return [cx + along * Math.cos(rad) - across * Math.sin(rad), cy + along * Math.sin(rad) + across * Math.cos(rad)];
    };
    const inside = ([x, y]) => x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h;
    /** Para as estrelas que chamam atenção: longe das peças (tenta de novo algumas vezes). */
    const clear = () => {
      let point = place(false);
      for (let tries = 0; tries < 12 && (L.avoid || []).some(([ax, ay]) => Math.hypot(point[0] - ax, point[1] - ay) < L.gap); tries += 1) point = place(false);
      return point;
    };

    // Muitas e fracas: o "pó" do céu (sem cor, opacidade baixa; algumas quase invisíveis dão profundidade).
    const dust = [];
    for (let i = 0; i < Math.round(1900 * area); i += 1) {
      const point = place(rand() < 0.55);
      if (!inside(point)) continue;
      const bright = rand();
      dust.push(`<circle cx="${f1(point[0])}" cy="${f1(point[1])}" r="${f2(0.22 + bright * bright * 0.42)}" opacity="${f2(0.16 + bright * 0.62)}" />`);
    }
    // Pequenas: já se vê a cor (estrelas quentes e frias).
    const small = [];
    for (let i = 0; i < Math.round(260 * area); i += 1) {
      const point = place(rand() < 0.35);
      if (!inside(point)) continue;
      small.push(`<circle cx="${f1(point[0])}" cy="${f1(point[1])}" r="${f2(0.55 + rand() * 0.5)}" fill="${TINTS[Math.floor(rand() * TINTS.length)]}" opacity="${f2(0.55 + rand() * 0.4)}" />`);
    }
    // Com halo: um brilho que se apaga devagar (degradê), não uma bola com borda.
    const halo = [];
    for (let i = 0; i < Math.round(26 * area); i += 1) {
      const [x, y] = clear();
      const r = 0.8 + rand() * 0.55;
      const tint = TINTS[Math.floor(rand() * TINTS.length)];
      halo.push(`<g transform="translate(${f1(x)} ${f1(y)})"><circle r="${f1(r * 6)}" fill="url(#${p}-halo)" opacity="${f2(0.4 + rand() * 0.35)}" /><circle r="${f2(r * 0.85)}" fill="${tint}" opacity="0.9" filter="url(#${p}-soft)" /></g>`);
    }
    // Poucas brilhantes: halo largo e quatro raios finíssimos que somem nas pontas (difração, como na foto).
    const bright = [];
    for (let i = 0; i < Math.max(3, Math.round(6 * area)); i += 1) {
      const [x, y] = clear();
      const r = 1.1 + rand() * 0.6;
      const s = 7 + rand() * 9;
      const tilt = rand() < 0.5 ? 0 : 45;
      bright.push(`<g transform="translate(${f1(x)} ${f1(y)}) rotate(${tilt})"><circle r="${f1(r * 10)}" fill="url(#${p}-halo)" opacity="0.6" /><rect x="${f1(-s)}" y="-0.3" width="${f1(s * 2)}" height="0.6" fill="url(#${p}-spike-h)" /><rect x="-0.3" y="${f1(-s)}" width="0.6" height="${f1(s * 2)}" fill="url(#${p}-spike-v)" /><circle r="${f2(r * 0.9)}" fill="${WHITE[Math.floor(rand() * WHITE.length)]}" filter="url(#${p}-soft)" /></g>`);
    }
    // Galáxias distantes: elipses minúsculas e inclinadas, um pouco mais quentes no centro.
    const galaxies = [];
    for (let i = 0; i < L.galaxies; i += 1) {
      const [x, y] = place(false);
      galaxies.push(`<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(1.4 + rand() * 2.4)}" ry="${f1(0.5 + rand() * 0.7)}" transform="rotate(${Math.round(rand() * 180)} ${f1(x)} ${f1(y)})" fill="url(#${p}-galaxy)" />`);
    }
    return `<g class="space-stars dust" fill="#e9efff">${dust.join('')}</g><g class="space-galaxies">${galaxies.join('')}</g><g class="space-stars small">${small.join('')}</g><g class="space-stars halo">${halo.join('')}</g><g class="space-stars bright">${bright.join('')}</g>`;
  }

  /* ---------------- Nebulosa (textura) ---------------- */
  /** Uma camada de nuvem: ruído fractal → só a parte mais densa vira cor, com borda macia. */
  const cloudFilter = (id, L, freq, seed, [r, g, b], gain = 2.3, cut = 1.08, blur = 1.4) => `<filter id="${id}" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${(freq[0] / L.w).toFixed(4)} ${(freq[1] / L.h).toFixed(4)}" numOctaves="5" seed="${seed}" />
      <feColorMatrix type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${gain} -${cut}" />
      <feGaussianBlur stdDeviation="${blur}" /></filter>`;
  /** Região onde a nuvem aparece (máscara com borda que some aos poucos). */
  const region = (id, cx, cy, rx, ry, angle, strength = 1) => `<radialGradient id="${id}-g"><stop offset="0" stop-color="#fff" stop-opacity="${strength}" /><stop offset="0.55" stop-color="#fff" stop-opacity="${f2(strength * 0.55)}" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></radialGradient>
      <mask id="${id}" maskContentUnits="userSpaceOnUse"><ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}" transform="rotate(${angle} ${f1(cx)} ${f1(cy)})" fill="url(#${id}-g)" /></mask>`;

  function nebula(L, p, lite) {
    const at = (fx, fy) => [L.x + L.w * fx, L.y + L.h * fy];
    const [tx, ty] = at(0.27, 0.3);
    const [vx, vy] = at(0.72, 0.6);
    const [hx, hy] = at(0.66, 0.5);
    const [dx, dy] = at(0.5, 0.48);
    const rect = (filter) => `<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" filter="url(#${filter})" />`;
    const defs = [
      region(`${p}-m-teal`, tx, ty, L.w * 0.42, L.h * 0.5, -12, 0.95),
      region(`${p}-m-violet`, vx, vy, L.w * 0.4, L.h * 0.55, 8, 1),
      region(`${p}-m-hot`, hx, hy, L.w * 0.12, L.h * 0.22, 20, 0.9),
      region(`${p}-m-dust`, dx, dy, L.w * 0.6, L.h * 0.34, -11, 1),
      `<radialGradient id="${p}-soft-teal"><stop offset="0" stop-color="#2fd5c4" stop-opacity="0.13" /><stop offset="1" stop-color="#2fd5c4" stop-opacity="0" /></radialGradient>`,
      `<radialGradient id="${p}-soft-violet"><stop offset="0" stop-color="#8b4dff" stop-opacity="0.14" /><stop offset="1" stop-color="#8b4dff" stop-opacity="0" /></radialGradient>`,
      `<radialGradient id="${p}-soft-hot"><stop offset="0" stop-color="#ff7a59" stop-opacity="0.09" /><stop offset="1" stop-color="#ff7a59" stop-opacity="0" /></radialGradient>`
    ];
    // Base suave (também no modo Leve): manchas de cor bem fracas onde as nuvens ficam.
    const base = `<ellipse cx="${f1(tx)}" cy="${f1(ty)}" rx="${f1(L.w * 0.36)}" ry="${f1(L.h * 0.42)}" fill="url(#${p}-soft-teal)" />`
      + `<ellipse cx="${f1(vx)}" cy="${f1(vy)}" rx="${f1(L.w * 0.34)}" ry="${f1(L.h * 0.46)}" fill="url(#${p}-soft-violet)" />`
      + `<ellipse cx="${f1(hx)}" cy="${f1(hy)}" rx="${f1(L.w * 0.12)}" ry="${f1(L.h * 0.2)}" fill="url(#${p}-soft-hot)" />`;
    if (lite) return { defs: defs.join(''), body: `<g class="space-nebula">${base}</g>` };
    defs.push(
      cloudFilter(`${p}-c-teal`, L, [3.4, 2.4], L.seed, [0.24, 0.86, 0.78]),
      cloudFilter(`${p}-c-blue`, L, [5.2, 3.6], L.seed + 3, [0.2, 0.46, 1], 2.1, 1.02, 1.1),
      cloudFilter(`${p}-c-violet`, L, [3.8, 2.6], L.seed + 7, [0.56, 0.3, 1]),
      cloudFilter(`${p}-c-magenta`, L, [6.2, 4.4], L.seed + 11, [0.95, 0.3, 0.78], 2.2, 1.06, 1),
      cloudFilter(`${p}-c-hot`, L, [7, 5], L.seed + 13, [1, 0.55, 0.32], 2.4, 1.12, 0.8),
      cloudFilter(`${p}-c-dust`, L, [9, 6], L.seed + 19, [0, 0, 0.01], 2.6, 1.18, 0.9),
      cloudFilter(`${p}-c-wisp`, L, [14, 9], L.seed + 23, [0.82, 0.9, 1], 2.8, 1.5, 0.5)
    );
    const body = `<g class="space-nebula">${base}
      <g mask="url(#${p}-m-teal)"><g opacity="0.5">${rect(`${p}-c-teal`)}</g><g opacity="0.35">${rect(`${p}-c-blue`)}</g><g opacity="0.22">${rect(`${p}-c-wisp`)}</g></g>
      <g mask="url(#${p}-m-violet)"><g opacity="0.48">${rect(`${p}-c-violet`)}</g><g opacity="0.32">${rect(`${p}-c-magenta`)}</g><g opacity="0.2">${rect(`${p}-c-wisp`)}</g></g>
      <g mask="url(#${p}-m-hot)" opacity="0.42">${rect(`${p}-c-hot`)}</g>
      <g mask="url(#${p}-m-dust)" opacity="0.75">${rect(`${p}-c-dust`)}</g></g>`;
    return { defs: defs.join(''), body };
  }

  /* ---------------- Céu real (só na página inteira) ---------------- */
  /*
   * Constelações com as posições de verdade (ascensão reta em horas, declinação em graus, magnitude): projetadas num
   * plano pequeno em volta do centro de cada uma (o leste fica à esquerda, como olhando para o céu). Brilho pela
   * magnitude; cor pelo tipo da estrela (Betelgeuse e Antares avermelhadas, Rigel e as Plêiades azuladas).
   */
  const CONSTELLATIONS = [
    { id: 'orion', name: 'Órion', at: [1250, 300], scale: 10.5, stars: {
      betelgeuse: [5.919, 7.41, 0.5, '#ffc9a0'], rigel: [5.242, -8.2, 0.13, '#cfe0ff'], bellatrix: [5.418, 6.35, 1.6, '#dce8ff'], saiph: [5.796, -9.67, 2.1, '#d6e4ff'],
      alnitak: [5.679, -1.94, 1.8, '#d6e4ff'], alnilam: [5.604, -1.2, 1.7, '#d6e4ff'], mintaka: [5.533, -0.3, 2.2, '#d6e4ff'], meissa: [5.585, 9.93, 3.4, '#e6eeff'] },
      lines: [['meissa', 'betelgeuse'], ['meissa', 'bellatrix'], ['betelgeuse', 'alnitak'], ['bellatrix', 'mintaka'], ['mintaka', 'alnilam'], ['alnilam', 'alnitak'], ['alnitak', 'saiph'], ['mintaka', 'rigel']],
      nebula: [5.588, -5.39] },
    { id: 'crux', name: 'Cruzeiro do Sul', at: [1390, 790], scale: 13, stars: {
      acrux: [12.443, -63.1, 0.8, '#d6e4ff'], mimosa: [12.795, -59.69, 1.25, '#d0deff'], gacrux: [12.519, -57.11, 1.6, '#ffcfa6'], delta: [12.252, -58.75, 2.8, '#dce8ff'], intrometida: [12.356, -60.4, 3.6, '#ffe2c0'] },
      lines: [['gacrux', 'acrux'], ['mimosa', 'delta']] },
    { id: 'scorpius', name: 'Escorpião', at: [330, 560], scale: 6.6, stars: {
      graffias: [16.09, -19.8, 2.6, '#dce8ff'], dschubba: [16.005, -22.62, 2.3, '#dce8ff'], pi: [15.98, -26.11, 2.9, '#dce8ff'], sigma: [16.353, -25.59, 2.9, '#dce8ff'],
      antares: [16.49, -26.43, 1.0, '#ffb08a'], tau: [16.598, -28.22, 2.8, '#dce8ff'], epsilon: [16.836, -34.29, 2.3, '#ffe2c0'], mu: [16.864, -38.05, 3.0, '#dce8ff'],
      zeta: [16.91, -42.36, 3.6, '#ffd7b0'], eta: [17.203, -43.24, 3.3, '#eef3ff'], sargas: [17.622, -43.0, 1.9, '#fff1d8'], iota: [17.793, -40.13, 3.0, '#fff1d8'],
      kappa: [17.708, -39.03, 2.4, '#dce8ff'], shaula: [17.56, -37.1, 1.6, '#dce8ff'], upsilon: [17.513, -37.3, 2.7, '#dce8ff'] },
      lines: [['graffias', 'dschubba'], ['dschubba', 'pi'], ['dschubba', 'sigma'], ['sigma', 'antares'], ['antares', 'tau'], ['tau', 'epsilon'], ['epsilon', 'mu'], ['mu', 'zeta'], ['zeta', 'eta'], ['eta', 'sargas'], ['sargas', 'iota'], ['iota', 'kappa'], ['kappa', 'shaula'], ['shaula', 'upsilon']] }
  ];
  const PLEIADES = { at: [430, 168], scale: 46, stars: [[3.791, 24.105, 2.9], [3.82, 24.053, 3.6], [3.749, 24.113, 3.7], [3.763, 24.367, 3.9], [3.772, 23.948, 4.2], [3.753, 24.467, 4.3], [3.819, 24.137, 5.0], [3.748, 24.289, 5.4]] };
  /** RA/Dec → plano: em volta do centro médio da constelação. */
  function project(stars, [cx, cy], scale) {
    const list = Object.values(stars);
    const ra0 = list.reduce((sum, star) => sum + star[0], 0) / list.length;
    const dec0 = list.reduce((sum, star) => sum + star[1], 0) / list.length;
    const cos = Math.cos((dec0 * Math.PI) / 180);
    return (ra, dec) => [cx - (ra - ra0) * 15 * cos * scale, cy - (dec - dec0) * scale];
  }
  const magSize = (mag) => Math.max(0.6, 2.9 - mag * 0.5);
  function realSky(L, p) {
    const out = [];
    for (const item of CONSTELLATIONS) {
      const to = project(item.stars, item.at, item.scale);
      const pos = Object.fromEntries(Object.entries(item.stars).map(([key, [ra, dec]]) => [key, to(ra, dec)]));
      const lines = item.lines.map(([a, b]) => `<line x1="${f1(pos[a][0])}" y1="${f1(pos[a][1])}" x2="${f1(pos[b][0])}" y2="${f1(pos[b][1])}" />`).join('');
      const stars = Object.entries(item.stars).map(([key, [, , mag, color]]) => {
        const r = magSize(mag);
        const [x, y] = pos[key];
        return `<g transform="translate(${f1(x)} ${f1(y)})"><circle r="${f1(r * 7)}" fill="url(#${p}-halo)" opacity="${f2(Math.min(0.85, 0.3 + r * 0.22))}" /><circle r="${f2(r * 0.62)}" fill="${color}" filter="url(#${p}-soft)" /></g>`;
      }).join('');
      let nebula = '';
      if (item.nebula) { const [nx, ny] = to(item.nebula[0], item.nebula[1]); nebula = `<ellipse cx="${f1(nx)}" cy="${f1(ny)}" rx="12" ry="9" fill="url(#${p}-m42)" /><circle cx="${f1(nx)}" cy="${f1(ny)}" r="1" fill="#fff4f8" opacity="0.8" />`; }
      const ys = Object.values(pos).map((point) => point[1]);
      const label = `<text x="${f1(item.at[0])}" y="${f1(Math.max(...ys) + 26)}" text-anchor="middle" font-family="Segoe UI, Inter, system-ui, sans-serif" font-size="10.5" letter-spacing="1.6" fill="#c9d6ff" fill-opacity="0.32">${item.name}</text>`;
      out.push(`<g class="space-constellation"><g stroke="#c4d4ff" stroke-opacity="0.22" stroke-width="0.8" stroke-linecap="round">${lines}</g>${nebula}${stars}${label}</g>`);
    }
    // Plêiades: aglomerado azulado com a névoa de reflexão em volta.
    const to = project(PLEIADES.stars, PLEIADES.at, PLEIADES.scale);
    const pleiades = PLEIADES.stars.map(([ra, dec, mag]) => { const [x, y] = to(ra, dec); const r = magSize(mag) * 0.9; return `<g transform="translate(${f1(x)} ${f1(y)})"><circle r="${f1(r * 7)}" fill="url(#${p}-blue-halo)" /><circle r="${f2(r * 0.6)}" fill="#e4edff" filter="url(#${p}-soft)" /></g>`; }).join('');
    out.push(`<g class="space-pleiades"><ellipse cx="${PLEIADES.at[0]}" cy="${PLEIADES.at[1]}" rx="46" ry="32" fill="url(#${p}-reflection)" />${pleiades}<text x="${PLEIADES.at[0]}" y="${PLEIADES.at[1] + 52}" text-anchor="middle" font-family="Segoe UI, Inter, system-ui, sans-serif" font-size="10" letter-spacing="1.6" fill="#c9d6ff" fill-opacity="0.28">Plêiades</text></g>`);
    return out.join('');
  }
  /** Galáxia espiral de lado (como Andrômeda): núcleo quente, braços azulados com poeira e duas satélites. */
  function spiral(p, [x, y, s], lite) {
    const arms = lite ? '' : `<ellipse rx="${f1(120 * s)}" ry="${f1(34 * s)}" filter="url(#${p}-arms)" opacity="0.6" />`;
    return `<g class="space-spiral" transform="translate(${f1(x)} ${f1(y)}) rotate(-32)">
      <ellipse rx="${f1(150 * s)}" ry="${f1(44 * s)}" fill="url(#${p}-disk-blue)" />${arms}
      <ellipse rx="${f1(92 * s)}" ry="${f1(22 * s)}" fill="url(#${p}-disk-warm)" />
      <ellipse rx="${f1(110 * s)}" ry="${f1(12 * s)}" cy="${f1(-5 * s)}" fill="#000" opacity="0.32" filter="url(#${p}-soft2)" />
      <ellipse rx="${f1(22 * s)}" ry="${f1(10 * s)}" fill="url(#${p}-core)" />
      <ellipse cx="${f1(60 * s)}" cy="${f1(-46 * s)}" rx="${f1(9 * s)}" ry="${f1(6 * s)}" fill="url(#${p}-core)" opacity="0.55" />
      <ellipse cx="${f1(-40 * s)}" cy="${f1(40 * s)}" rx="${f1(14 * s)}" ry="${f1(5 * s)}" fill="url(#${p}-core)" opacity="0.4" transform="rotate(20)" /></g>`;
  }
  /** Nebulosa planetária em anel (como a do Anel do Sul): dentro azul-esverdeado, borda laranja, a estrela no meio. */
  const ringNebula = (p, [x, y, s]) => `<g class="space-ring-nebula" transform="translate(${f1(x)} ${f1(y)}) rotate(28)"><ellipse rx="${f1(16 * s)}" ry="${f1(12 * s)}" fill="url(#${p}-ring-in)" /><ellipse rx="${f1(16 * s)}" ry="${f1(12 * s)}" fill="none" stroke="url(#${p}-ring-rim)" stroke-width="${f1(4 * s)}" filter="url(#${p}-soft2)" /><circle r="0.9" fill="#f2fbff" /></g>`;
  /**
   * Aurora no alto da página: centenas de raios verticais finos (como os da aurora de verdade), com a base seguindo
   * uma onda, verdes embaixo e violeta em cima, ondulados e desfocados; bem fracos, para o conteúdo ficar por cima.
   */
  function aurora(L, p, lite, rand) {
    if (lite) return `<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${f1(L.h * 0.3)}" fill="url(#${p}-aurora-soft)" />`;
    const rays = [];
    const step = 6;
    for (let x = L.x + L.w * 0.08; x < L.x + L.w * 0.96; x += step) {
      const t = (x - L.x) / L.w;
      const base = L.y + L.h * (0.2 + 0.07 * Math.sin(t * 7.1) + 0.04 * Math.sin(t * 17.3 + 1.3));
      const height = L.h * (0.09 + 0.06 * (0.5 + 0.5 * Math.sin(t * 11.7 + 0.4)) + rand() * 0.05);
      const strength = Math.max(0, 0.35 + 0.65 * Math.sin(t * 5.3 + 0.8) * Math.sin(t * 2.1 + 0.2)) * (0.55 + rand() * 0.45);
      if (strength < 0.06) continue;
      rays.push(`<rect x="${f1(x)}" y="${f1(base - height)}" width="${f1(step * 0.9)}" height="${f1(height)}" fill="url(#${p}-ray)" opacity="${f2(strength)}" />`);
    }
    return `<g filter="url(#${p}-wave)" opacity="0.85">${rays.join('')}</g>`;
  }
  function realDefs(p, L) {
    return `<radialGradient id="${p}-m42" cx="0.5" cy="0.45"><stop offset="0" stop-color="#ffd2e6" stop-opacity="0.55" /><stop offset="0.35" stop-color="#ff7fb0" stop-opacity="0.28" /><stop offset="0.7" stop-color="#7f8cff" stop-opacity="0.1" /><stop offset="1" stop-color="#7f8cff" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-blue-halo"><stop offset="0" stop-color="#dfe9ff" stop-opacity="0.5" /><stop offset="0.12" stop-color="#9fbcff" stop-opacity="0.22" /><stop offset="0.4" stop-color="#7fa2ff" stop-opacity="0.05" /><stop offset="1" stop-color="#7fa2ff" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-reflection"><stop offset="0" stop-color="#7fa6ff" stop-opacity="0.16" /><stop offset="1" stop-color="#7fa6ff" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-disk-blue"><stop offset="0" stop-color="#cfd9ff" stop-opacity="0.2" /><stop offset="0.6" stop-color="#7d8fff" stop-opacity="0.08" /><stop offset="1" stop-color="#7d8fff" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-disk-warm"><stop offset="0" stop-color="#fff0d8" stop-opacity="0.45" /><stop offset="0.5" stop-color="#ffd9a8" stop-opacity="0.14" /><stop offset="1" stop-color="#ffd9a8" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-core"><stop offset="0" stop-color="#fffaf0" stop-opacity="0.95" /><stop offset="0.4" stop-color="#ffe6c0" stop-opacity="0.5" /><stop offset="1" stop-color="#ffe6c0" stop-opacity="0" /></radialGradient>
      <radialGradient id="${p}-ring-in"><stop offset="0" stop-color="#9ff3ff" stop-opacity="0.35" /><stop offset="0.7" stop-color="#4fb8ff" stop-opacity="0.18" /><stop offset="1" stop-color="#4fb8ff" stop-opacity="0" /></radialGradient>
      <linearGradient id="${p}-ring-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb27a" stop-opacity="0.55" /><stop offset="1" stop-color="#ff7a5c" stop-opacity="0.3" /></linearGradient>
      <linearGradient id="${p}-ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b48cff" stop-opacity="0" /><stop offset="0.35" stop-color="#8f86ff" stop-opacity="0.12" /><stop offset="0.75" stop-color="#3dffb0" stop-opacity="0.32" /><stop offset="0.93" stop-color="#7dffd0" stop-opacity="0.45" /><stop offset="1" stop-color="#7dffd0" stop-opacity="0" /></linearGradient>
      <linearGradient id="${p}-aurora-soft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3dffb0" stop-opacity="0.06" /><stop offset="1" stop-color="#3dffb0" stop-opacity="0" /></linearGradient>
      <filter id="${p}-wave" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.002" numOctaves="2" seed="4" result="t" /><feDisplacementMap in="SourceGraphic" in2="t" scale="70" xChannelSelector="R" yChannelSelector="G" /><feGaussianBlur stdDeviation="2.2 5" /></filter>
      <filter id="${p}-arms" x="-20%" y="-40%" width="140%" height="180%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.05 0.12" numOctaves="3" seed="8" /><feColorMatrix type="matrix" values="0 0 0 0 0.75  0 0 0 0 0.82  0 0 0 0 1  0 0 0 1.8 -0.8" /><feComposite in2="SourceGraphic" operator="in" /><feGaussianBlur stdDeviation="0.8" /></filter>
      <filter id="${p}-soft2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" /></filter>`;
  }

  /* ---------------- Astros ---------------- */
  /** Gigante gasoso com faixas (textura esticada na horizontal), sombra do lado sem sol e anel inclinado. */
  function giant(p, [x, y, s], lite) {
    const r = 52 * s;
    // Atributos direto no SVG: ele vira imagem, e imagem não lê o CSS da página.
    const ring = (part) => `<g opacity="${part === 'back' ? 0.55 : 1}"><ellipse rx="${f1(r * 1.72)}" ry="${f1(r * 0.34)}" fill="none" stroke="#ecd6ce" stroke-opacity="0.34" stroke-width="2.6" clip-path="url(#${p}-ring-${part})" /><ellipse rx="${f1(r * 1.45)}" ry="${f1(r * 0.28)}" fill="none" stroke="#ecd6ce" stroke-opacity="0.16" stroke-width="1.4" clip-path="url(#${p}-ring-${part})" /></g>`;
    const bands = lite ? '' : `<rect x="${f1(-r)}" y="${f1(-r)}" width="${f1(r * 2)}" height="${f1(r * 2)}" filter="url(#${p}-bands)" opacity="0.55" />`;
    return `<g class="space-giant" opacity="0.9" transform="translate(${f1(x)} ${f1(y)}) rotate(-16)">
      <circle r="${f1(r * 1.6)}" fill="url(#${p}-giant-glow)" />${ring('back')}
      <g clip-path="url(#${p}-giant-clip)"><circle r="${f1(r)}" fill="url(#${p}-giant)" />${bands}<circle r="${f1(r)}" fill="url(#${p}-giant-shade)" /></g>
      <circle r="${f1(r)}" fill="none" stroke="url(#${p}-giant-rim)" stroke-width="${f1(Math.max(0.8, r * 0.04))}" />${ring('front')}</g>`;
  }
  function giantDefs(p, s) {
    const r = 52 * s;
    return `<radialGradient id="${p}-giant" cx="0.66" cy="0.3" r="0.95"><stop offset="0" stop-color="#f3d9c8" /><stop offset="0.3" stop-color="#c79aa0" /><stop offset="0.62" stop-color="#6c4a86" /><stop offset="1" stop-color="#1a1230" /></radialGradient>
      <radialGradient id="${p}-giant-shade" cx="0.78" cy="0.22" r="1.05"><stop offset="0.42" stop-color="#000" stop-opacity="0" /><stop offset="0.8" stop-color="#000" stop-opacity="0.72" /><stop offset="1" stop-color="#000" stop-opacity="0.92" /></radialGradient>
      <linearGradient id="${p}-giant-rim" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe6d2" stop-opacity="0.55" /><stop offset="0.45" stop-color="#ffe6d2" stop-opacity="0" /></linearGradient>
      <radialGradient id="${p}-giant-glow"><stop offset="0.58" stop-color="#c7a4ff" stop-opacity="0.08" /><stop offset="1" stop-color="#c7a4ff" stop-opacity="0" /></radialGradient>
      <filter id="${p}-bands" x="${f1(-r)}" y="${f1(-r)}" width="${f1(r * 2)}" height="${f1(r * 2)}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${(0.6 / r).toFixed(4)} ${(6 / r).toFixed(4)}" numOctaves="4" seed="5" /><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.86  0 0 0 0 0.8  1.6 0 0 0 -0.62" /></filter>
      <clipPath id="${p}-giant-clip"><circle r="${f1(r)}" /></clipPath>
      <clipPath id="${p}-ring-back"><rect x="${f1(-r * 2)}" y="${f1(-r)}" width="${f1(r * 4)}" height="${f1(r)}" /></clipPath>
      <clipPath id="${p}-ring-front"><rect x="${f1(-r * 2)}" y="0" width="${f1(r * 4)}" height="${f1(r)}" /></clipPath>`;
  }

  /** Buraco negro: disco de acreção inclinado, a sombra, o anel de fótons e o arco do disco de trás curvado por cima. */
  function hole(p, [x, y, s]) {
    const r = 11 * s;
    return `<g class="space-hole" transform="translate(${f1(x)} ${f1(y)}) rotate(-14)">
      <circle r="${f1(r * 3.4)}" fill="url(#${p}-hole-glow)" />
      <ellipse rx="${f1(r * 4.6)}" ry="${f1(r * 0.95)}" fill="url(#${p}-disk)" clip-path="url(#${p}-hole-top)" />
      <ellipse rx="${f1(r * 1.75)}" ry="${f1(r * 1.55)}" fill="none" stroke="url(#${p}-lens)" stroke-width="${f1(r * 0.5)}" clip-path="url(#${p}-hole-top)" />
      <circle r="${f1(r * 1.16)}" fill="none" stroke="#ffe8c7" stroke-opacity="0.6" stroke-width="${f1(Math.max(0.5, r * 0.07))}" />
      <circle r="${f1(r)}" fill="#000" />
      <ellipse rx="${f1(r * 4.6)}" ry="${f1(r * 0.95)}" fill="url(#${p}-disk)" clip-path="url(#${p}-hole-bottom)" /></g>`;
  }
  function holeDefs(p, s) {
    const r = 11 * s;
    return `<radialGradient id="${p}-disk"><stop offset="0.24" stop-color="#fff4dc" stop-opacity="0.9" /><stop offset="0.42" stop-color="#ffc77a" stop-opacity="0.75" /><stop offset="0.7" stop-color="#ff7b4a" stop-opacity="0.28" /><stop offset="1" stop-color="#ff5a3c" stop-opacity="0" /></radialGradient>
      <linearGradient id="${p}-lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd59a" stop-opacity="0.65" /><stop offset="1" stop-color="#ff9a5c" stop-opacity="0.08" /></linearGradient>
      <radialGradient id="${p}-hole-glow"><stop offset="0.15" stop-color="#ffb978" stop-opacity="0.12" /><stop offset="1" stop-color="#ff8a5c" stop-opacity="0" /></radialGradient>
      <clipPath id="${p}-hole-top"><rect x="${f1(-r * 6)}" y="${f1(-r * 6)}" width="${f1(r * 12)}" height="${f1(r * 6)}" /></clipPath>
      <clipPath id="${p}-hole-bottom"><rect x="${f1(-r * 6)}" y="0" width="${f1(r * 12)}" height="${f1(r * 6)}" /></clipPath>`;
  }
  /** Planeta pequeno com atmosfera: lado iluminado azul-esverdeado, sombra e a borda de luz fina. */
  const ice = (p, [x, y, s]) => `<g class="space-ice" transform="translate(${f1(x)} ${f1(y)})"><circle r="${f1(13 * s)}" fill="url(#${p}-ice-glow)" /><circle r="${f1(7 * s)}" fill="url(#${p}-ice)" /><circle r="${f1(7 * s)}" fill="url(#${p}-ice-shade)" /><circle r="${f1(7 * s)}" fill="none" stroke="url(#${p}-ice-rim)" stroke-width="0.7" /></g>`;
  const iceDefs = (p) => `<radialGradient id="${p}-ice" cx="0.32" cy="0.3" r="0.9"><stop offset="0" stop-color="#e8fbff" /><stop offset="0.4" stop-color="#6cc4dc" /><stop offset="0.8" stop-color="#1d4a68" /><stop offset="1" stop-color="#0a1b2c" /></radialGradient>
    <radialGradient id="${p}-ice-shade" cx="0.3" cy="0.28" r="1"><stop offset="0.5" stop-color="#000" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity="0.85" /></radialGradient>
    <linearGradient id="${p}-ice-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bff3ff" stop-opacity="0.8" /><stop offset="0.5" stop-color="#bff3ff" stop-opacity="0" /></linearGradient>
    <radialGradient id="${p}-ice-glow"><stop offset="0.5" stop-color="#7fd8ff" stop-opacity="0.16" /><stop offset="1" stop-color="#7fd8ff" stop-opacity="0" /></radialGradient>`;
  function comet(p, [[hx, hy], [tx, ty]], n) {
    return `<g class="space-comet"><line x1="${f1(tx)}" y1="${f1(ty)}" x2="${f1(hx)}" y2="${f1(hy)}" stroke="url(#${p}-tail-${n})" stroke-width="1.2" stroke-linecap="round" /><circle cx="${f1(hx)}" cy="${f1(hy)}" r="4" fill="url(#${p}-halo)" /><circle cx="${f1(hx)}" cy="${f1(hy)}" r="1.1" fill="#f4fbff" /></g>`;
  }
  const tailDef = (p, [[hx, hy], [tx, ty]], n) => `<linearGradient id="${p}-tail-${n}" gradientUnits="userSpaceOnUse" x1="${f1(tx)}" y1="${f1(ty)}" x2="${f1(hx)}" y2="${f1(hy)}"><stop offset="0" stop-color="#9fdcff" stop-opacity="0" /><stop offset="1" stop-color="#e8f7ff" stop-opacity="0.65" /></linearGradient>`;

  /**
   * O <svg> do fundo, inteiro. `kind`: chart | sky | mini. `lite`: sem as texturas (filtros).
   */
  function svg(kind, { prefix = 'space', lite = false } = {}) {
    const L = LAYOUTS[kind] || LAYOUTS.chart;
    const rand = rng(L.seed);
    const p = `${prefix}-${kind}`;
    const neb = nebula(L, p, lite);
    const defs = `<defs>
      <radialGradient id="${p}-bg" cx="0.5" cy="0.5" r="0.7"><stop offset="0" stop-color="#03040a" /><stop offset="1" stop-color="#000000" /></radialGradient>
      <radialGradient id="${p}-fade" cx="0.5" cy="0.5" r="0.5"><stop offset="0.7" stop-color="#fff" /><stop offset="1" stop-color="#000" /></radialGradient>
      <mask id="${p}-mask" maskContentUnits="userSpaceOnUse"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="url(#${p}-fade)" /></mask>
      <radialGradient id="${p}-halo"><stop offset="0" stop-color="#ffffff" stop-opacity="0.42" /><stop offset="0.08" stop-color="#f4f7ff" stop-opacity="0.22" /><stop offset="0.22" stop-color="#e2ebff" stop-opacity="0.08" /><stop offset="0.5" stop-color="#d6e4ff" stop-opacity="0.02" /><stop offset="1" stop-color="#d6e4ff" stop-opacity="0" /></radialGradient>
      <linearGradient id="${p}-spike-h"><stop offset="0" stop-color="#fff" stop-opacity="0" /><stop offset="0.35" stop-color="#fff" stop-opacity="0.08" /><stop offset="0.5" stop-color="#fff" stop-opacity="0.45" /><stop offset="0.65" stop-color="#fff" stop-opacity="0.08" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></linearGradient>
      <linearGradient id="${p}-spike-v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0" /><stop offset="0.35" stop-color="#fff" stop-opacity="0.08" /><stop offset="0.5" stop-color="#fff" stop-opacity="0.45" /><stop offset="0.65" stop-color="#fff" stop-opacity="0.08" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></linearGradient>
      <filter id="${p}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.35" /></filter>
      <radialGradient id="${p}-galaxy"><stop offset="0" stop-color="#fff1dc" stop-opacity="0.85" /><stop offset="0.4" stop-color="#d8c9ff" stop-opacity="0.35" /><stop offset="1" stop-color="#9fb2ff" stop-opacity="0" /></radialGradient>
      ${neb.defs}${L.page ? realDefs(p, L) : giantDefs(p, L.giant[2]) + holeDefs(p, L.hole[2]) + iceDefs(p) + tailDef(p, L.comet, 1) + (L.comet2 ? tailDef(p, L.comet2, 2) : '')}
    </defs>`;
    /* Página: fundo preto e céu inteiro, sem borda. Constelação: sem fundo próprio (fica direto no céu da página); a
       nebulosa e as estrelas de perto se esvaem nas bordas, sem moldura, e os astros ficam por cima, inteiros. */
    const body = L.page
      ? `<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="url(#${p}-bg)" />${aurora(L, p, lite, rand)}${neb.body}${starField(L, rand, p)}${spiral(p, L.spiral, lite)}${ringNebula(p, L.ringNeb)}${realSky(L, p)}`
      : `<g mask="url(#${p}-mask)">${neb.body}${starField(L, rand, p)}</g>${comet(p, L.comet, 1)}${L.comet2 ? comet(p, L.comet2, 2) : ''}${ice(p, L.ice)}${hole(p, L.hole)}${giant(p, L.giant, lite)}`;
    return `<svg class="space-art${L.page ? ' page' : ''}" viewBox="${L.x} ${L.y} ${L.w} ${L.h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${defs}${body}</svg>`;
  }

  /**
   * Desenha o céu numa imagem (canvas) do tamanho exato da caixa, uma vez: o SVG com as texturas vira bitmap e a tela
   * só compõe a imagem pronta (nada de refazer filtros ao rolar ou quando algo se mexe por cima). Refaz só quando o
   * tamanho muda de verdade. Densidade de pixels limitada a 2 (estrelas nítidas sem gastar memória à toa).
   */
  async function paint(canvas, kind, { prefix, lite }) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    const key = `${w}x${h}:${lite}`;
    if (canvas.dataset.key === key) return true;
    canvas.dataset.key = key;
    const markup = svg(kind, { prefix, lite }).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      if (canvas.dataset.key !== key) return false;
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(image, 0, 0, w, h);
      canvas.dataset.ready = '1';
      return true;
    } catch {
      canvas.dataset.key = '';
      return false;
    } finally { URL.revokeObjectURL(url); }
  }
  /** Acompanha o tamanho da caixa (janela redimensionada, painel que aparece) e redesenha quando muda. */
  function watch(canvas, kind, options) {
    let timer = null;
    const redo = () => { clearTimeout(timer); timer = setTimeout(() => { paint(canvas, kind, canvas.settings || options); }, 140); };
    if (typeof ResizeObserver === 'function') new ResizeObserver(redo).observe(canvas);
    paint(canvas, kind, options);
    return redo;
  }

  /**
   * Põe o fundo atrás de um <svg> de constelação: embrulha os dois numa moldura (sem borda: o céu de perto se esvai e
   * a constelação flutua no céu da página). Chamar de novo só troca o fundo (por exemplo, ao entrar no modo Leve).
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
    let art = stage.querySelector(':scope > .space-art');
    if (art && art.dataset.lite === String(lite)) return;
    if (!art) {
      art = document.createElement('canvas');
      art.className = 'space-art';
      art.setAttribute('aria-hidden', 'true');
      stage.insertBefore(art, stage.firstChild);
    }
    art.dataset.lite = String(lite);
    art.dataset.key = '';
    const settings = { prefix: options.prefix || target.id || 'space', lite };
    if (art.redo) { art.settings = settings; paint(art, kind, settings); return; }
    art.settings = settings;
    art.redo = watch(art, kind, settings);
  }

  /** O céu da página inteira (atrás de tudo, parado enquanto o conteúdo rola). */
  function mountPage(holder, options = {}) {
    if (!holder || typeof document === 'undefined') return;
    const lite = Boolean(options.lite);
    let art = holder.querySelector('canvas');
    if (art && art.dataset.lite === String(lite)) return;
    if (!art) { art = document.createElement('canvas'); art.className = 'space-art page'; holder.appendChild(art); }
    art.dataset.lite = String(lite);
    art.dataset.key = '';
    const settings = { prefix: 'page', lite };
    art.settings = settings;
    if (art.redo) { paint(art, 'page', settings); return; }
    art.redo = watch(art, 'page', settings);
  }

  return { svg, mount, mountPage, LAYOUTS, rng };
});
