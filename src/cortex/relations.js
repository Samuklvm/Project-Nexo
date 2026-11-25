/*
 * Cortex — mapa de relações. O que o Nexo acha que causa o quê neste computador, e o quanto cada ligação já foi provada.
 *
 * Puro: sem disco, sem relógio. Quem guarda o histórico (EdgeEvent) é a memória eterna (src/cortex/memory.cjs).
 *
 * Escada de cada ligação: semente → observada → correlacionada → suspeita → apoiada | derrubada.
 * Regra de ouro: só um EXPERIMENTO leva a "apoiada" (ou a "derrubada"). Ver, correlacionar ou suspeitar muitas vezes
 * nunca promove sozinho.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lab-space.js'));
  else root.NexoRelations = factory(root.NexoLabSpace);
})(typeof self !== 'undefined' ? self : this, function (LabSpace) {
  const STATES = ['semente', 'observada', 'correlacionada', 'suspeita', 'apoiada', 'derrubada'];
  // Degraus que os eventos comuns alcançam (experimento não entra aqui: ele decide por conta própria).
  const RUNG = { visto: 'observada', correlacao: 'correlacionada', suspeita: 'suspeita' };
  const EXPERIMENT = { 'experimento-a-favor': 'apoiada', 'experimento-contra': 'derrubada' };
  const ORDER = { semente: 0, observada: 1, correlacionada: 2, suspeita: 3 };

  const SPACES = [...(LabSpace.SPACE || []), ...(LabSpace.LINUX_SPACE || [])];

  /** Nomes dos testes do laboratório, em linguagem de gente. */
  const BENCH_LABEL = {
    single: 'Velocidade de um núcleo', multi: 'Velocidade de todos os núcleos', burst: 'Resposta em rajadas curtas',
    frames: 'Ritmo de quadros', memory: 'Velocidade da memória', latency: 'Tempo para acordar um núcleo',
    timer: 'Precisão do relógio do sistema', disk: 'Velocidade do disco', network: 'Rede (ping e estabilidade)'
  };

  const SIGNALS = {
    cpu: { label: 'Processador ocupado', unit: '%' },
    mem: { label: 'Memória em uso', unit: '%' },
    // Os rótulos seguem o que a coluna dos minutos mede (store.js commitMinute): disk = espaço usado do disco principal
    // (não atividade), temp = o sensor mais quente (processador, placa de vídeo ou ACPI), cpuTemp = o do processador.
    disk: { label: 'Espaço usado no disco', unit: '%' },
    gpu: { label: 'Placa de vídeo ocupada', unit: '%' },
    temp_cpu: { label: 'Temperatura do processador', unit: '°C' },
    temp: { label: 'Temperatura mais alta do PC', unit: '°C' },
    clock_queda: { label: 'Processador desacelerando' },
    page_faults: { label: 'Memória indo para o disco' },
    travadas: { label: 'Travadas' },
    quadros_ruins: { label: 'Quadros ruins nos jogos' },
    programa_pesado: { label: 'Programa pesado aberto' },
    rotina: { label: 'Rotina do dia a dia' }
  };
  for (const [id, label] of Object.entries(BENCH_LABEL)) SIGNALS[`bench:${id}`] = { label };
  for (const knob of SPACES) SIGNALS[`ajuste:${knob.id}`] = { label: knob.label || knob.id };

  // Semente geral: conhecimento de bancada, ainda não confirmado neste PC.
  const GENERAL = [
    ['temp_cpu', 'clock_queda', 'causa', 0.8],
    ['clock_queda', 'cpu', 'causa', 0.5],
    ['programa_pesado', 'cpu', 'causa', 0.7],
    ['cpu', 'travadas', 'causa', 0.6],
    ['mem', 'page_faults', 'causa', 0.7],
    ['page_faults', 'travadas', 'causa', 0.7],
    ['disk', 'travadas', 'causa', 0.5],
    ['gpu', 'quadros_ruins', 'causa', 0.7],
    ['temp', 'quadros_ruins', 'causa', 0.4],
    ['rotina', 'programa_pesado', 'explica', 0.4],
    // Causa → teste do lab ("afeta", como ajuste → teste): com a causa em ação o teste cai. É o que deixa o laboratório
    // provar por experimento uma causa que não é ajuste (medir 'desce' na previsão do forjador).
    ['temp_cpu', 'bench:single', 'afeta', 0.6],
    ['temp_cpu', 'bench:multi', 'afeta', 0.6],
    ['programa_pesado', 'bench:multi', 'afeta', 0.6],
    ['disk', 'bench:disk', 'afeta', 0.7],
    ['mem', 'bench:memory', 'afeta', 0.5],
    ['gpu', 'bench:frames', 'afeta', 0.6]
  ];
  const edgeId = (from, to) => `${from}>${to}`;
  const makeEdge = (from, to, type, weight, origem, extra = {}) => ({ id: edgeId(from, to), from, to, type, weight, origem, ...extra });

  /** Arestas iniciais: as gerais (inclusive causa → teste do lab) mais uma "ajuste → teste" para cada teste que o ajuste do laboratório afeta. */
  function seedEdges() {
    const edges = GENERAL.map(([from, to, type, weight]) => makeEdge(from, to, type, weight, 'semente'));
    const seen = new Set(edges.map((e) => e.id));
    for (const knob of SPACES) {
      for (const bench of knob.affects || []) {
        const edge = makeEdge(`ajuste:${knob.id}`, `bench:${bench}`, 'afeta', 0.5, 'semente');
        if (!seen.has(edge.id)) { seen.add(edge.id); edges.push(edge); }
      }
    }
    return edges;
  }

  /**
   * O mapa vivo. Estado de uma aresta: o último experimento decide (a favor → apoiada, contra → derrubada);
   * sem experimento, vale o degrau mais alto entre visto/correlação/suspeita; sem nada, o ponto de partida da aresta
   * (semente para as de semente, correlacionada para as descobertas pela mineração).
   */
  function createMap(edges, history) {
    const list = [];
    const byId = new Map();
    const events = new Map();
    for (const edge of edges || []) {
      if (!edge || byId.has(edge.id)) continue;
      const copy = { ...edge };
      list.push(copy);
      byId.set(copy.id, copy);
      events.set(copy.id, []);
    }

    function apply(event) {
      if (!event || !events.has(event.edgeId)) return;
      if (!RUNG[event.kind] && !EXPERIMENT[event.kind]) return;
      events.get(event.edgeId).push(event);
    }
    for (const event of history || []) apply(event);

    function state(id) {
      const edge = byId.get(id);
      if (!edge) return null;
      const evs = events.get(id);
      let experiment = null;
      let best = edge.origem === 'correlacao' ? 'correlacionada' : 'semente';
      for (const ev of evs) {
        if (EXPERIMENT[ev.kind]) {
          if (!experiment || (Number(ev.at) || 0) >= (Number(experiment.at) || 0)) experiment = ev;
        } else if (ORDER[RUNG[ev.kind]] > ORDER[best]) best = RUNG[ev.kind];
      }
      return experiment ? EXPERIMENT[experiment.kind] : best;
    }

    /** Peso da aresta vezes o histórico desta máquina: quantas vezes foi vista e se algum experimento a apoiou. */
    function score(edge) {
      const evs = events.get(edge.id);
      const seen = Math.min(evs.filter((e) => e.kind === 'visto').length, 20);
      const backed = evs.some((e) => e.kind === 'experimento-a-favor') ? 1 : 0;
      return edge.weight * (1 + seen / 20 + backed);
    }

    function causesOf(signal) {
      return list
        .filter((e) => e.to === signal && state(e.id) !== 'derrubada')
        .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    }

    return { state, causesOf, apply, edges: () => list.slice() };
  }

  // Colunas do MinuteRow que viram sinais. clockRatio é invertido: queda de clock = 1 - razão do clock máximo.
  const COLUMNS = [
    { col: 'cpu', signal: 'cpu' },
    { col: 'mem', signal: 'mem' },
    { col: 'disk', signal: 'disk' },
    { col: 'gpu', signal: 'gpu' },
    { col: 'temp', signal: 'temp' },
    { col: 'cpuTemp', signal: 'temp_cpu' },
    { col: 'clockRatio', signal: 'clock_queda', invert: true }
  ];

  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Pearson de a[i] com b[i+lag], só nos pares em que os dois existem. Devolve { r, n }. */
  function pearson(a, b, lag) {
    let n = 0, sa = 0, sb = 0;
    for (let i = 0; i + lag < a.length; i++) {
      if (!finite(a[i]) || !finite(b[i + lag])) continue;
      n++; sa += a[i]; sb += b[i + lag];
    }
    if (n < 2) return { r: 0, n };
    const ma = sa / n, mb = sb / n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i + lag < a.length; i++) {
      if (!finite(a[i]) || !finite(b[i + lag])) continue;
      const da = a[i] - ma, db = b[i + lag] - mb;
      cov += da * db; va += da * da; vb += db * db;
    }
    if (va <= 1e-12 || vb <= 1e-12) return { r: 0, n };
    return { r: cov / Math.sqrt(va * vb), n };
  }

  /**
   * Procura pares de sinais que andam juntos nos minutos guardados (Pearson >= minR em algum atraso 0..maxLag), exceto
   * os que o mapa já conhece. "a → b com atraso k" = o que a fez aparece em b k minutos depois. Correlação não prova
   * causa: a aresta nasce 'correlacao', no degrau "correlacionada", e só um experimento a promove.
   */
  function mineCorrelations(minutes, known, opts = {}) {
    const { maxLag = 5, minN = 60, minR = 0.6 } = opts;
    const rows = (Array.isArray(minutes) ? minutes : []).filter((m) => m && typeof m === 'object');
    if (rows.length < minN) return [];
    const sorted = rows.every((m) => finite(m.t)) ? rows.slice().sort((x, y) => x.t - y.t) : rows;
    const series = COLUMNS.map((c) => ({ ...c, data: sorted.map((m) => (finite(m[c.col]) ? (c.invert ? 1 - m[c.col] : m[c.col]) : NaN)) }));
    const taken = new Set();
    for (const e of known || []) { taken.add(edgeId(e.from, e.to)); taken.add(edgeId(e.to, e.from)); }

    const out = [];
    for (let i = 0; i < series.length; i++) {
      for (let j = i + 1; j < series.length; j++) {
        const A = series[i], B = series[j];
        if (taken.has(edgeId(A.signal, B.signal))) continue;
        let best = null;
        // lag 0 não diz quem vem primeiro: fica na ordem das colunas. Lag > 0 sabe a direção; vence empate de r.
        const consider = (from, to, lag, res) => {
          if (res.n < minN || res.r < minR) return;
          if (!best || res.r > best.r + 1e-9 || (Math.abs(res.r - best.r) <= 1e-9 && lag > 0 && best.lag === 0)) best = { from, to, lag, r: res.r, n: res.n };
        };
        for (let lag = 0; lag <= maxLag; lag++) {
          consider(A.signal, B.signal, lag, pearson(A.data, B.data, lag));
          if (lag > 0) consider(B.signal, A.signal, lag, pearson(B.data, A.data, lag));
        }
        if (best) out.push(makeEdge(best.from, best.to, 'afeta', Math.min(1, best.r), 'correlacao', { lag: best.lag, n: best.n }));
      }
    }
    return out.sort((x, y) => y.weight - x.weight || x.id.localeCompare(y.id));
  }

  return { SIGNALS, STATES, seedEdges, createMap, mineCorrelations };
});
