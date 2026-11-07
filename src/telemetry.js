/*
 * Telemetria: o resumo de cada dia, montado aqui e enviado UMA vez, depois que o dia acaba (só com a opção ligada).
 * Antes o pacote saía no primeiro minuto do dia e as contagens daquele dia nunca chegavam: iam quase vazias.
 *
 * O que entra (sempre anônimo, com nomes fixos do próprio app; nunca nomes de arquivo, de programa ou de jogo,
 * texto digitado, e-mail ou pasta):
 *  - telas abertas e o tempo em foco em cada uma; recursos usados (lista fixa); botões dos cartões de recurso;
 *  - quanto o próprio Nexo pesou (CPU e memória, com e sem foco), quadros do céu, travadas da interface e tempo
 *    de abertura; uso da placa de vídeo com o Nexo na frente (Completo ou Leve) e em segundo plano;
 *  - médias do dia do PC (processador, memória, vídeo, maior temperatura, disco);
 *  - ajustes do app (efeitos, cor, céu, ritmo das leituras, perfil) e quantos jogos por loja (sem os nomes).
 * O hardware, os monitores e o estado dos sensores o processo principal junta na hora de enviar.
 * Fica tudo neste PC enquanto a telemetria estiver desligada; com ela desligada nada sai.
 */
(function () {
  const KEY = 'nexo-telemetry-days';
  const KEEP_DAYS = 8;
  const dayOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
  const slug = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 39);
  const fin = Number.isFinite;

  // Só nomes fixos entram na contagem: as telas do app e os recursos desta lista (nunca o detalhe de uma atividade).
  const VIEWS = new Set(['home', 'analysis', 'hardware', 'maintenance', 'optimize', 'sessions', 'library', 'atlas', 'lab', 'activity', 'settings', 'updates']);
  const FEATURES = new Set(['analise-inteligente', 'verificacao-sfc', 'limpeza-automatica', 'raio-x-do-pc', 'experimento-de-energia', 'teste-com-reinicio', 'sincronizacao', 'plano-de-energia', 'leitura-completa-de-sensores',
    'sessao-de-risco-laboratorio', 'sessao-de-observacao', 'jogo-aberto', 'instalacao-pedida', 'papel-de-parede', 'conta-google-conectada', 'dados-locais', 'limpeza-segura', 'otimizacao-de-unidade', 'acesso-ao-fps-liberado']);
  const UI = new Set(['busca', 'filtro', 'fixar', 'acao', 'paleta', 'novidades', 'novidades-sozinha', 'meteoros', 'tour']);

  const empty = (day) => ({ day, views: {}, viewTime: {}, features: {}, actions: {}, ui: {}, app: { launches: 0, focusSec: 0, openSec: 0 },
    perf: { cpuFocus: [0, 0], cpuBack: [0, 0], memFocus: [0, 0], memMax: 0, skyFps: [0, 0], longTasks: 0, longTaskMs: 0, startMs: [0, 0] },
    gpu: { completo: [0, 0], leve: [0, 0], fundo: [0, 0] }, sent: false });

  let days = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } })();
  let dirty = false;
  function bucket() {
    const day = dayOf();
    if (!days[day]) { days[day] = empty(day); prune(); }
    return days[day];
  }
  function prune() {
    const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
    days = Object.fromEntries(keep.map((day) => [day, days[day]]));
  }
  function save() {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(days)); } catch { /* cheio: tenta de novo no próximo minuto */ dirty = true; }
  }
  const add = (map, key, n = 1) => { if (!key) return; map[key] = Math.round(((map[key] || 0) + n) * 10) / 10; dirty = true; };
  const acc = (pair, value) => { if (!fin(value)) return; pair[0] += value; pair[1] += 1; dirty = true; };

  /* ---------- Contagens ---------- */
  const focused = () => !document.hidden && document.hasFocus();
  let viewStart = performance.now();
  let current = Nexo.state.view;
  function closeView() {
    const now = performance.now();
    if (focused() && VIEWS.has(current)) add(bucket().viewTime, current, Math.min(3600, (now - viewStart) / 1000));
    viewStart = now;
  }
  Nexo.on('view', (name) => { closeView(); current = name; if (VIEWS.has(name)) add(bucket().views, name); });
  Nexo.on('idle', () => closeView());
  Nexo.on('feat-use', ({ kind, view, id } = {}) => {
    if (UI.has(kind)) add(bucket().ui, kind);
    // Cartão de recurso: "tela.id", só se o recurso existir no registro (nomes do próprio app).
    if (kind === 'acao' && VIEWS.has(view) && window.NexoFeatures?.forView?.(view)?.some((def) => def.id === id)) add(bucket().actions, `${view}.${slug(id)}`);
  });
  Nexo.on('telemetry-ui', (kind) => { if (UI.has(kind)) add(bucket().ui, kind); });
  const original = window.recordActivity;
  if (typeof original === 'function') {
    window.recordActivity = function counted(title, detail) {
      const name = slug(title);
      add(bucket().features, FEATURES.has(name) ? name : 'outro');
      return original.call(this, title, detail);
    };
  }

  /* ---------- Desempenho do próprio Nexo e do PC ---------- */
  add(bucket().app, 'launches');
  // Abertura: do início da página até a primeira leitura do PC chegar à tela.
  let started = false;
  Nexo.on('snapshot', () => {
    if (!started) { started = true; acc(bucket().perf.startMs, Math.round(performance.now())); }
    const sample = Nexo.store?.live?.().slice(-1)[0];
    if (sample && fin(sample.gpu)) acc(bucket().gpu[!focused() ? 'fundo' : Nexo.effectsLite ? 'leve' : 'completo'], sample.gpu);
  });
  try {
    new PerformanceObserver((list) => { const b = bucket(); for (const entry of list.getEntries()) { b.perf.longTasks += 1; b.perf.longTaskMs += Math.round(entry.duration); } dirty = true; }).observe({ type: 'longtask', buffered: false });
  } catch { /* navegador sem longtask */ }

  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const seconds = Math.min(120, (now - lastTick) / 1000);
    lastTick = now;
    const b = bucket();
    b.app.openSec += seconds;
    if (focused()) b.app.focusSec += seconds;
    dirty = true;
    save();
  }, 60000);

  // Custo do Nexo a cada 5 minutos (com e sem foco: o que ele pesa em segundo plano importa tanto quanto).
  setInterval(async () => {
    try {
      const m = await desktopBridge?.getSelfMetrics?.();
      if (!m) return;
      const b = bucket();
      acc(focused() ? b.perf.cpuFocus : b.perf.cpuBack, m.cpu);
      if (focused()) acc(b.perf.memFocus, m.memMB);
      if (fin(m.memMB)) b.perf.memMax = Math.max(b.perf.memMax, Math.round(m.memMB));
      const sky = Nexo.sky?.stats?.();
      if (focused() && !Nexo.effectsLite && sky?.fps) acc(b.perf.skyFps, sky.fps);
    } catch { /* fica para a próxima */ }
  }, 5 * 60000);

  addEventListener('beforeunload', () => { closeView(); dirty = true; save(); });

  /* ---------- Resumo de um dia ---------- */
  const avg = (pair) => (pair?.[1] ? Math.round((pair[0] / pair[1]) * 10) / 10 : null);
  const top = (map, n) => Object.fromEntries(Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, n));

  /** Médias do PC naquele dia, do histórico local (1 amostra por minuto). */
  function health(day) {
    const list = (Nexo.store?.history?.() || []).filter((s) => dayOf(s.timestamp) === day);
    if (!list.length) return null;
    const mean = (key) => { const v = list.map((s) => s[key]).filter(fin); return v.length ? Math.round((v.reduce((a, x) => a + x, 0) / v.length) * 10) / 10 : null; };
    const temps = list.map((s) => Nexo.store.hottest?.(s)).filter(fin);
    const peak = (key) => { const v = list.map((s) => s[key]).filter(fin); return v.length ? Math.round(Math.max(...v)) : null; };
    return { minutes: list.length, cpu: mean('cpu'), cpuMax: peak('cpu'), mem: mean('memory'), memMax: peak('memory'), gpu: mean('gpu'), disk: mean('disk'), tempMax: temps.length ? Math.round(Math.max(...temps)) : null, tempAvg: temps.length ? Math.round(temps.reduce((a, x) => a + x, 0) / temps.length) : null };
  }

  /** Ajustes do app agora (nomes e escolhas fixas, nada digitado). */
  function settings() {
    const sky = Nexo.sky?.prefs?.() || {};
    const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
    return {
      effects: Nexo.effectsLite ? 'leve' : 'completo', liveRate: Nexo.liveRate || null, profile: Nexo.profile?.id || null, accent: Nexo.accent || 'estrela',
      skyDensity: sky.density || null, fireflies: sky.fireflies ?? null, twinkle: sky.twinkle ?? null, meteors: sky.meteors ?? null, showers: sky.showers ?? null, cursor: sky.cursor ?? null,
      skyHour: read('nexo-sky-hour') !== 'off', wallpaper: Boolean(document.documentElement.style.getPropertyValue('--wallpaper-image')), autoClean: read(Nexo.keys.autoClean) === 'true',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, pins: Object.values(readJSON('nexo-feats-pins', {}) || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0)
    };
  }

  /** Coisas que o Nexo já sabe deste PC, sem nomes: jogos por loja, sessões, diário, laboratório. */
  function local(day) {
    const stores = Nexo.libraryStats?.() || null;
    const sessions = readJSON(Nexo.keys.sessions, []) || [];
    const journal = Nexo.journal?.list?.() || [];
    const inDay = (ts) => fin(ts) && dayOf(ts) === day;
    const byAction = {};
    for (const entry of journal) if (inDay(entry.at)) add(byAction, `${slug(entry.actionId || 'acao')}.${entry.status === 'reverted' ? 'revertida' : 'aplicada'}`);
    return {
      library: stores,
      sessions: { saved: Array.isArray(sessions) ? sessions.length : 0, today: Array.isArray(sessions) ? sessions.filter((s) => inDay(s.startedAt)).length : 0, withFps: Array.isArray(sessions) ? sessions.filter((s) => s.report?.fps).length : 0 },
      journal: { active: journal.filter((e) => e.status === 'applied' && e.reversible).length, today: top(byAction, 20) }
    };
  }

  function summary(day) {
    const b = days[day];
    if (!b) return null;
    const extra = local(day);
    return {
      usage: { views: top(b.views, 20), viewTime: top(Object.fromEntries(Object.entries(b.viewTime).map(([k, v]) => [k, Math.round(v)])), 20), ui: b.ui, actions: top(b.actions, 40) },
      features: top(b.features, 30),
      app: { launches: b.app.launches, focusMin: Math.round(b.app.focusSec / 60), openMin: Math.round(b.app.openSec / 60), startMs: avg(b.perf.startMs) },
      perf: { cpuFocus: avg(b.perf.cpuFocus), cpuBack: avg(b.perf.cpuBack), memFocusMB: avg(b.perf.memFocus), memMaxMB: b.perf.memMax || null, skyFps: avg(b.perf.skyFps), longTasks: b.perf.longTasks, longTaskMs: b.perf.longTaskMs,
        gpuCompleto: avg(b.gpu.completo), gpuLeve: avg(b.gpu.leve), gpuFundo: avg(b.gpu.fundo) },
      health: health(day),
      settings: settings(),
      library: extra.library,
      lab: { sessions: extra.sessions, journal: extra.journal }
    };
  }

  Nexo.telemetry = {
    /** Dias fechados (antes de hoje) que ainda não foram enviados, do mais antigo para o mais novo. */
    pending: () => Object.keys(days).filter((day) => day < dayOf() && !days[day].sent).sort(),
    summary,
    markSent(day) { if (days[day]) { days[day].sent = true; dirty = true; save(); } },
    today: () => summary(dayOf()),
    dayOf
  };
})();
