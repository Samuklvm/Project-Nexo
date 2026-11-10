/*
 * Recursos de cada tela: cartões pequenos com uma leitura, uma ferramenta ou uma ação de verdade.
 * Cada recurso declara de onde vêm os dados; nada é inventado. Sem o dado, o cartão diz o que falta.
 * As fontes lentas (PowerShell, rede) só carregam quando a tela abre, ficam em cache e nunca rodam com o app sem foco.
 * O painel só redesenha a tela aberta, no máximo a cada 3 s, e para quando o app perde o foco.
 */
(function () {
  const bridge = desktopBridge;
  const REG = {};
  const PIN_KEY = 'nexo-feats-pins';
  const FILTER_KEY = 'nexo-feats-filter';
  const KINDS = { leitura: 'Leitura', ferramenta: 'Ferramenta', acao: 'Ação' };
  const VIEW_TITLE = { home: 'do Início', analysis: 'da Análise', hardware: 'do Hardware', maintenance: 'da Manutenção', optimize: 'da Otimização', sessions: 'das Sessões', library: 'dos Jogos', atlas: 'do Atlas', lab: 'do Extremo', activity: 'da Atividade', settings: 'dos Ajustes', updates: 'das Atualizações' };

  /* ---------- Formatos e contas ---------- */
  const fin = Number.isFinite;
  const H = {
    fin,
    // Arredonda antes de formatar: -0,04 vira "0,0", nunca "-0,0".
    nf: (value, digits = 0) => { if (!fin(value)) return '--'; let v = Number(Number(value).toFixed(digits)); if (v === 0) v = 0; return v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }); },
    /** Programas (processos de mesmo nome somados), do serviço se ele já mandar, senão agrupados aqui. */
    programs(result, by = 'cpu') {
      const ready = by === 'cpu' ? result?.programsByCpu : result?.programsByMemory;
      if (Array.isArray(ready) && ready.length) return ready;
      const map = new Map();
      for (const p of (by === 'cpu' ? result?.byCpu : result?.byMemory) || []) {
        const key = String(p.name || '').toLowerCase();
        const g = map.get(key) || { name: p.name, cpuPercent: 0, memoryBytes: 0, count: 0 };
        g.cpuPercent += fin(p.cpuPercent) ? p.cpuPercent : 0; g.memoryBytes += fin(p.memoryBytes) ? p.memoryBytes : 0; g.count += 1;
        map.set(key, g);
      }
      return [...map.values()].sort((a, b) => (by === 'cpu' ? b.cpuPercent - a.cpuPercent : b.memoryBytes - a.memoryBytes));
    },
    /** Número com sinal: "+1,2", "-0,8" ou "0,0" (sem "+0,0" nem "-0,0"). */
    signed: (value, digits = 0) => { if (!fin(value)) return '--'; const v = Number(Number(value).toFixed(digits)); return `${v > 0 ? '+' : ''}${H.nf(v, digits)}`; },
    bytes(value) {
      if (!fin(value) || value < 0) return '--';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let n = value; let i = 0;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
      return `${H.nf(n, n < 10 && i >= 2 ? 1 : 0)} ${units[i]}`;
    },
    dur(seconds) {
      if (!fin(seconds) || seconds < 0) return '--';
      const s = Math.round(seconds);
      if (s < 60) return `${s} s`;
      const m = Math.floor(s / 60); if (m < 60) return `${m} min`;
      const h = Math.floor(m / 60); if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
      return `${Math.floor(h / 24)} d ${h % 24} h`;
    },
    ago(ts, now = Date.now()) {
      if (!fin(ts) || ts <= 0) return 'nunca';
      const s = Math.max(0, (now - ts) / 1000);
      if (s < 60) return 'agora mesmo';
      if (s < 3600) return `há ${Math.round(s / 60)} min`;
      if (s < 86400) return `há ${Math.round(s / 3600)} h`;
      const d = Math.round(s / 86400); return d === 1 ? 'ontem' : `há ${d} dias`;
    },
    when: (ts) => (fin(ts) ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--'),
    vals: (list, key) => (list || []).map((item) => (typeof key === 'function' ? key(item) : item?.[key])).filter(fin),
    avg: (list) => (list.length ? list.reduce((a, v) => a + v, 0) / list.length : null),
    max: (list) => (list.length ? Math.max(...list) : null),
    min: (list) => (list.length ? Math.min(...list) : null),
    sum: (list) => list.reduce((a, v) => a + v, 0),
    sd(list) { if (list.length < 2) return null; const m = H.avg(list); return Math.sqrt(H.avg(list.map((v) => (v - m) ** 2))); },
    pct(list, p) { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; },
    slope(points) { // regressão simples: [[x, y]] → inclinação por unidade de x
      if (points.length < 3) return null;
      const n = points.length; const mx = H.avg(points.map((p) => p[0])); const my = H.avg(points.map((p) => p[1]));
      const num = H.sum(points.map(([x, y]) => (x - mx) * (y - my))); const den = H.sum(points.map(([x]) => (x - mx) ** 2));
      return den ? num / den : null;
    },
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    tone: (value, warn, bad, higherIsWorse = true) => (!fin(value) ? undefined : higherIsWorse ? (value >= bad ? 'bad' : value >= warn ? 'warn' : 'good') : (value <= bad ? 'bad' : value <= warn ? 'warn' : 'good')),
    plural: (n, one, many) => `${H.nf(n)} ${n === 1 ? one : many}`,
    weekday: (i) => ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][i],
    since: (ms) => Date.now() - ms,
    count(list, keyFn) { const out = new Map(); for (const item of list) { const k = keyFn(item); if (k !== null && k !== undefined && k !== '') out.set(k, (out.get(k) || 0) + 1); } return [...out.entries()].sort((a, b) => b[1] - a[1]); },
    copy: async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } },
    download(name, text, type = 'application/json') {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    stamp: () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  };

  /* ---------- Fontes de dados (lentas ficam em cache e só carregam com a tela aberta) ---------- */
  const SOURCES = {
    facts: { ttl: 15 * 60e3, load: () => bridge?.getSystemFacts?.() },
    power: { ttl: 60e3, load: () => bridge?.getPowerSource?.() },
    self: { ttl: 4e3, load: () => bridge?.getSelfMetrics?.() },
    games: { ttl: 60e3, load: () => bridge?.listGames?.() },
    errors: { ttl: 30e3, load: () => bridge?.listErrors?.({ limit: 300 }) },
    cloud: { ttl: 20e3, load: () => bridge?.cloudStatus?.() },
    app: { ttl: 5 * 60e3, load: () => bridge?.getAppInfo?.() },
    connections: { ttl: 2 * 60e3, load: () => bridge?.getConnections?.() },
    settings: { ttl: 30e3, load: () => bridge?.getSettings?.() },
    labStatus: { ttl: 60e3, load: () => bridge?.getLabStatus?.() },
    startup: { ttl: 5 * 60e3, load: () => bridge?.listStartupItems?.() },
    plans: { ttl: 60e3, load: () => bridge?.listPowerPlans?.() },
    tier: { ttl: 60 * 60e3, load: () => bridge?.getHardwareTier?.() },
    sensorService: { ttl: 60e3, load: () => bridge?.getSensorService?.() },
    fps: { ttl: 2 * 60e3, load: () => bridge?.getFpsStatus?.() },
    fpsAccess: { ttl: 2 * 60e3, load: () => bridge?.getFpsAccess?.() },
    reboot: { ttl: 30e3, load: () => bridge?.rebootStatus?.() },
    account: { ttl: 60e3, load: () => bridge?.getAccount?.() },
    privacy: { ttl: 5 * 60e3, load: () => bridge?.getPrivacy?.() },
    wallpaper: { ttl: 5 * 60e3, load: () => bridge?.getWallpaper?.() },
    watching: { ttl: 10e3, load: () => bridge?.currentWatchedGame?.() },
    processes: { ttl: 45e3, load: () => bridge?.getTopProcesses?.().then((result) => { Nexo.state.processes = result; return result; }) }
  };
  const cache = {};
  // Saúde dos recursos (para a telemetria, só números e ids do código): fontes que demoram ou falham,
  // cartões que ficam sem dado e cartões cujo cálculo quebrou.
  const health = { sources: {}, tiles: {}, crashed: new Set() };
  function source(name) {
    const spec = SOURCES[name];
    if (!spec) return undefined;
    const entry = cache[name];
    const fresh = entry && Date.now() - entry.at < spec.ttl;
    if (!fresh && !entry?.loading && !Nexo.isIdle?.()) {
      cache[name] = { ...(entry || {}), loading: true, at: entry?.at || 0 };
      const started = performance.now();
      health.sources[name] ??= [0, 0, 0]; // certas, falhas, ms somados
      const stat = health.sources[name];
      Promise.resolve().then(() => spec.load()).then((value) => {
        stat[0] += 1;
        stat[2] += Math.round(performance.now() - started);
        cache[name] = { value, at: Date.now(), loading: false };
        schedule(true);
        return value;
      }).catch((error) => {
        stat[1] += 1;
        stat[2] += Math.round(performance.now() - started);
        cache[name] = { value: entry?.value, error: String(error?.message || error), at: Date.now(), loading: false };
      });
    }
    return entry?.value;
  }
  const invalidate = (name) => { if (cache[name]) cache[name].at = 0; };

  /* ---------- Contexto de cada desenho (memorizado) ---------- */
  function makeContext() {
    const memo = {};
    const once = (key, fn) => (key in memo ? memo[key] : (memo[key] = fn()));
    const ctx = {
      H, now: Date.now(),
      get snap() { return Nexo.state.snapshot; },
      get live() { return once('live', () => Nexo.store?.live?.() || []); },
      get hist() { return once('hist', () => Nexo.store?.history?.() || []); },
      get deep() { return once('deep', () => Nexo.store?.deepMetrics?.() || {}); },
      get brain() { return Nexo.store?.brain; },
      get journal() { return once('journal', () => [...(Nexo.journal?.list?.() || [])].sort((a, b) => (b.at || 0) - (a.at || 0))); },
      get sessions() { return once('sessions', () => Nexo.sessions?.list?.() || readJSON(Nexo.keys.sessions, []) || []); },
      get activity() { return once('activity', () => { const a = readJSON(Nexo.keys.activity, []); return Array.isArray(a) ? a : []; }); },
      get lab() { return once('lab', () => readJSON('nexo-lab-v1', null) || { evidence: {}, tabu: [], runs: [] }); },
      get feedback() { return once('feedback', () => Nexo.store?.feedback?.() || []); },
      get processes() { return Nexo.state.processes || Nexo.store?.lastProcesses?.() || null; },
      get platform() { return Nexo.platform; },
      /** Amostras do histórico (1 por minuto) das últimas `ms`. */
      since: (ms) => (Nexo.store?.history?.() || []).filter((s) => s.timestamp >= Date.now() - ms),
      /** Todos os sensores do serviço, achatados. */
      sensors: () => once('sensors', () => {
        const snap = Nexo.state.sensors;
        const devices = snap?.status === 'ready' ? snap.devices || [] : [];
        return devices.flatMap((device) => (device.sensors || []).map((sensor) => ({ device: device.name, deviceType: device.type, ...sensor })));
      }),
      devices: () => { const snap = Nexo.state.sensors; return snap?.status === 'ready' ? snap.devices || [] : []; },
      src: source,
      hottest: (sample) => Nexo.store?.hottest?.(sample) ?? null
    };
    return ctx;
  }

  /* ---------- Registro ---------- */
  function add(view, defs) {
    const list = (REG[view] ||= []);
    for (const def of defs) {
      if (!def.id || !def.title || typeof def.compute !== 'function') throw new Error(`recurso inválido em ${view}: ${def.id}`);
      if (list.some((item) => item.id === def.id)) throw new Error(`recurso repetido em ${view}: ${def.id}`);
      list.push({ kind: 'leitura', icon: 'spark', ...def, view });
    }
  }
  const forView = (view) => (REG[view] || []).filter((item) => !item.os || item.os === Nexo.platform);

  /* ---------- Ícones (traço simples, 24×24) ---------- */
  const ICONS = {
    cpu: 'M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 9h6v6H9z',
    mem: 'M3 8h18v8H3zM7 8v8M11 8v8M15 8v8M5 16v3M19 16v3',
    disk: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    gpu: 'M2 7h18v10H2zM20 10h2M6 17v3M10 17v3M8 12a2 2 0 1 0 0.01 0M14 12a2 2 0 1 0 0.01 0',
    temp: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0zM12 9v7',
    clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0.01 0',
    fan: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 10c-1-4 1-7 4-6s2 4-2 6M14 12c4-1 7 1 6 4s-4 2-6-2M12 14c1 4-1 7-4 6s-2-4 2-6M10 12c-4 1-7-1-6-4s4-2 6 2',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    chart: 'M3 20h18M6 16l4-5 3 3 5-7',
    star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    broom: 'M14 4l6 6M9 9l6 6M4 20l6-6M10 14c-2 0-5 1-6 6 5-1 6-4 6-6',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    game: 'M6 9h4M8 7v4M15 9h.01M18 11h.01M5 6h14a3 3 0 0 1 3 3l-1 7a3 3 0 0 1-5 2l-2-2h-4l-2 2a3 3 0 0 1-5-2L2 9a3 3 0 0 1 3-3z',
    trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
    flask: 'M9 3h6M10 3v6L4 19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2l-6-10V3M7 14h10',
    map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 1 2-2h13',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z',
    bug: 'M8 8a4 4 0 0 1 8 0M7 10h10v5a5 5 0 0 1-10 0zM4 12h3M17 12h3M5 18l2-2M19 18l-2-2M5 7l2 2M19 7l-2 2M12 10v10',
    download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
    history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 8v4l3 2',
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
    target: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12h.01',
    wave: 'M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0',
    plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
    wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
    battery: 'M3 8h15v8H3zM21 11v2M6 11h6',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    timer: 'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
    calendar: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4',
    fire: 'M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z',
    snow: 'M12 2v20M4 6l16 12M20 6 4 18M9 4l3 2 3-2M9 20l3-2 3 2',
    leaf: 'M5 21c0-9 5-16 16-16 0 11-7 16-16 16zM5 21l8-8',
    rocket: 'M5 15c-1 1-2 4-2 6 2 0 5-1 6-2M9 15l-3-3c2-5 6-9 13-9 0 7-4 11-9 13zM15 9h.01',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    folder: 'M3 6h6l2 2h10v11H3z',
    palette: 'M12 3a9 9 0 0 0 0 18c1 0 2-.8 2-2 0-1.5 1-2 2-2h2a3 3 0 0 0 3-3c0-6-4-11-9-11zM7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01',
    heart: 'M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z',
    layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 18l10 5 10-5',
    pulse: 'M3 12h4l2-6 4 12 2-6h6',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4'
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.spark}"/></svg>`;

  /* ---------- Desenho ---------- */
  const pins = () => { try { const p = JSON.parse(localStorage.getItem(PIN_KEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } };
  const savePins = (value) => { try { localStorage.setItem(PIN_KEY, JSON.stringify(value)); } catch { /* só nesta sessão */ } };
  const filterOf = (view) => { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || '{}')[view] || 'todos'; } catch { return 'todos'; } };
  // Grupos da tela de recursos: cada um mostra duas linhas de cartões e guarda (por tela) quais estão abertos.
  const GROUPS = [['leitura', 'Leituras', 'O que o Nexo mede agora e no seu histórico.'], ['ferramenta', 'Ferramentas', 'Atalhos para ver ou ajustar algo, sempre com confirmação.'], ['acao', 'Ações', 'Fazem algo na hora; quando mexem no PC, pedem confirmação antes.']];
  const OPEN_KEY = 'nexo-feats-open';
  const expandedOf = (view) => { try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}')[view]; return Array.isArray(v) ? v : []; } catch { return []; } };
  const saveExpanded = (view, value) => { try { const all = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); all[view] = value; localStorage.setItem(OPEN_KEY, JSON.stringify(all)); } catch { /* só nesta sessão */ } };
  const sectionOf = (view) => document.querySelector(`[data-feats="${view}"]`);
  const saveFilter = (view, value) => { try { const all = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'); all[view] = value; localStorage.setItem(FILTER_KEY, JSON.stringify(all)); } catch { /* só nesta sessão */ } };
  const search = {};
  const lastHtml = new WeakMap();

  function sparkSvg(values) {
    const list = values.filter(fin);
    if (list.length < 2) return '';
    const lo = Math.min(...list); const hi = Math.max(...list); const span = hi - lo || 1;
    const pts = list.map((v, i) => [(i / (list.length - 1)) * 100, 24 - ((v - lo) / span) * 20 - 2]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return `<svg class="feat-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${line} L100 26 L0 26 Z"/><path d="${line}"/></svg>`;
  }

  function tileHtml(def, ctx, pinned) {
    let out;
    try { out = def.compute(ctx); } catch (error) { console.error(`[recurso ${def.view}/${def.id}]`, error); out = null; health.crashed.add(`${def.view}.${def.id}`); }
    const empty = !out || out.value === undefined || out.value === null || out.value === '';
    // Só conta como "sem dado" quando as fontes do cartão já responderam (carregando não é falta de dado).
    if (!empty || !(def.needs || []).some((name) => !cache[name] || cache[name].loading)) health.tiles[`${def.view}.${def.id}`] = empty ? 0 : 1;
    const value = empty ? (def.empty || 'Ainda sem dados') : out.value;
    const isText = empty || out.text || (typeof value === 'string' && value.length > 9 && !out.unit);
    const tone = empty ? '' : out.tone || '';
    const actionLabel = def.action ? (typeof def.action.label === 'function' ? def.action.label(ctx, out) : def.action.label) : null;
    const actionHidden = def.action && def.action.when && !def.action.when(ctx, out);
    return `<article class="feat${pinned ? ' pinned' : ''}" data-id="${def.id}" data-kind="${def.kind}"${tone ? ` data-tone="${tone}"` : ''}${empty ? ' data-state="empty"' : ''}>
      <div class="feat-top"><span class="feat-icon">${icon(def.icon)}</span><span class="feat-title">${escapeHtml(def.title)}</span><button class="feat-pin" type="button" data-pin="${def.id}" aria-pressed="${pinned}" title="${pinned ? 'Desafixar' : 'Fixar no topo'}" aria-label="${pinned ? 'Desafixar' : 'Fixar'} ${escapeHtml(def.title)}">★</button></div>
      <div class="feat-value${isText ? ' text' : ''}">${escapeHtml(String(value))}${!empty && out.unit ? `<small>${escapeHtml(out.unit)}</small>` : ''}</div>
      <div class="feat-body">${!empty && out.spark ? sparkSvg(out.spark) : ''}${!empty && fin(out.bar) ? `<div class="feat-bar"><i data-css="width:${(H.clamp(out.bar, 0, 1) * 100).toFixed(1)}%"></i></div>` : ''}<div class="feat-detail">${escapeHtml(empty ? (def.emptyDetail || def.hint || '') : (out.detail || def.hint || ''))}</div>${!empty && out.list?.length ? `<div class="feat-list">${out.list.slice(0, 4).map(([k, v]) => `<span><em>${escapeHtml(String(k))}</em><b>${escapeHtml(String(v))}</b></span>`).join('')}</div>` : ''}</div>
      <div class="feat-foot"><span class="feat-kind">${KINDS[def.kind] || ''}</span>${def.action && !actionHidden ? `<button class="feat-action" type="button" data-act="${def.id}">${escapeHtml(actionLabel)}</button>` : ''}</div>
    </article>`;
  }

  function ensureSection(view) {
    const panel = document.querySelector(`[data-view-panel="${view}"]`);
    if (!panel) return null;
    let section = panel.querySelector(':scope > .feats');
    if (section) return section;
    section = document.createElement('section');
    section.className = 'feats';
    section.dataset.feats = view;
    section.innerHTML = `<header class="feats-head"><div><h2>Recursos ${VIEW_TITLE[view] || ''} <span class="feats-count"></span></h2><p>Leituras, ferramentas e atalhos desta tela. Fixe os seus favoritos com a estrela.</p></div>
      <div class="feats-tools"><div class="segmented sm" role="group" aria-label="Filtrar recursos">${[['todos', 'Todos'], ['leitura', 'Leituras'], ['ferramenta', 'Ferramentas'], ['acao', 'Ações'], ['fixados', 'Fixados']].map(([id, label]) => `<button type="button" data-filter="${id}" aria-pressed="false">${label}</button>`).join('')}</div>
      <input type="search" placeholder="Buscar recurso" aria-label="Buscar recurso" data-feat-search /></div></header>
      <div class="feats-body"></div>`;
    panel.append(section);
    section.addEventListener('click', (event) => onClick(view, event));
    section.querySelector('[data-feat-search]').addEventListener('input', (event) => { search[view] = event.target.value.trim().toLowerCase(); render(view); });
    // Para a telemetria conta só QUE houve uma busca (nunca o texto buscado).
    section.querySelector('[data-feat-search]').addEventListener('change', () => Nexo.emit('feat-use', { kind: 'busca', view }));
    section.addEventListener('pointermove', (event) => {
      const tile = event.target.closest('.feat');
      if (!tile) return;
      const box = tile.getBoundingClientRect();
      tile.style.setProperty('--fx', `${event.clientX - box.left}px`);
      tile.style.setProperty('--fy', `${event.clientY - box.top}px`);
    }, { passive: true });
    return section;
  }

  function render(view) {
    const section = ensureSection(view);
    if (!section) return;
    const defs = forView(view);
    const pinned = pins()[view] || [];
    const filter = filterOf(view);
    const query = search[view] || '';
    section.querySelectorAll('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
    section.querySelector('.feats-count').textContent = String(defs.length);
    for (const name of new Set(defs.flatMap((def) => def.needs || []))) source(name);
    const ctx = makeContext();
    const list = defs
      .filter((def) => filter === 'todos' || (filter === 'fixados' ? pinned.includes(def.id) : def.kind === filter))
      .filter((def) => !query || `${def.title} ${def.hint || ''}`.toLowerCase().includes(query))
      .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)));
    const body = section.querySelector('.feats-body');
    const htmlOf = new Map(list.map((def) => [def.id, tileHtml(def, ctx, pinned.includes(def.id)).trim()]));
    const grid = (defs2) => `<div class="feats-grid" role="list">${defs2.map((def) => htmlOf.get(def.id)).join('')}</div>`;
    if (!list.length) {
      body.innerHTML = `<div class="feats-empty">${filter === 'fixados' ? 'Nenhum recurso fixado nesta tela. Passe o mouse num cartão e clique na estrela.' : 'Nenhum recurso com esse nome.'}</div>`;
    } else if (filter !== 'todos' || query) {
      // Filtro ou busca: tudo o que bate, numa grade só.
      body.innerHTML = grid(list);
    } else {
      // Sem filtro: em grupos (fixados, leituras, ferramentas, ações), cada um mostrando 6 e o resto num "ver mais".
      const open = expandedOf(view);
      // Duas linhas cheias, quantas colunas couberem (3 numa tela comum, 4 numa larga).
      const width = body.clientWidth || section.clientWidth;
      const GROUP_LIMIT = width ? Math.max(2, Math.floor((width + 16) / (290 + 16))) * 2 : 6;
      const groups = [['fixados', 'Fixados', 'Os seus favoritos desta tela.', list.filter((def) => pinned.includes(def.id))]]
        .concat(GROUPS.map(([kind, title, text]) => [kind, title, text, list.filter((def) => def.kind === kind && !pinned.includes(def.id))]))
        .filter(([, , , defs2]) => defs2.length);
      body.innerHTML = groups.map(([kind, title, text, defs2]) => {
        const all = kind === 'fixados' || open.includes(kind) || defs2.length <= GROUP_LIMIT + 2;
        const shown = all ? defs2 : defs2.slice(0, GROUP_LIMIT);
        const rest = defs2.length - GROUP_LIMIT;
        const more = defs2.length > GROUP_LIMIT + 2 && kind !== 'fixados'
          ? `<button class="feats-more-btn" type="button" data-more="${kind}" aria-expanded="${String(all)}">${all ? 'Mostrar menos' : `Ver mais ${rest} ${title.toLowerCase()}`}</button>` : '';
        return `<div class="feats-group" data-group="${kind}"><div class="feats-group-head"><h3>${title} <span>${defs2.length}</span></h3><p>${text}</p></div>${grid(shown)}${more}</div>`;
      }).join('');
    }
    body.querySelectorAll('.feat').forEach((tile) => { const html = htmlOf.get(tile.dataset.id); if (html) lastHtml.set(tile, html); });
  }

  /**
   * Atualiza só os cartões que mudaram, sem recriar a grade (mantém foco e rolagem). O trabalho vai em pedaços,
   * nos intervalos entre os quadros (requestIdleCallback): mesmo com 7 dias de histórico, nada trava a tela.
   * Com `sync`, faz tudo de uma vez (usado nos testes e depois de um clique).
   */
  let pass = 0;
  function refresh(view, { sync = false } = {}) {
    const section = document.querySelector(`[data-feats="${view}"]`);
    if (!section) return render(view);
    const token = ++pass;
    const ctx = makeContext();
    const pinned = pins()[view] || [];
    const queue = [...section.querySelectorAll('.feat')];
    const step = (deadline) => {
      if (token !== pass) return; // outra atualização começou: esta para
      // Tempo do quadro: atualização síncrona (ou sem requestIdleCallback) vai até o fim; senão, até sobrar 2 ms.
      const hasTime = () => sync || !deadline || deadline.timeRemaining() > 2;
      while (queue.length && hasTime()) {
        const tile = queue.shift();
        if (!tile.isConnected || (tile.contains(document.activeElement) && document.activeElement.matches('.feat-action'))) continue;
        const def = forView(view).find((item) => item.id === tile.dataset.id);
        if (!def) continue;
        const html = tileHtml(def, ctx, pinned.includes(def.id));
        if (lastHtml.get(tile) === html) continue;
        const holder = document.createElement('div');
        holder.innerHTML = html;
        const next = holder.firstElementChild;
        next.style.cssText = tile.style.cssText;
        tile.replaceWith(next);
        lastHtml.set(next, html);
      }
      if (queue.length) (window.requestIdleCallback || ((fn) => setTimeout(fn, 16)))(step, { timeout: 500 });
    };
    if (sync || !window.requestIdleCallback) step(null); else requestIdleCallback(step, { timeout: 500 });
  }

  async function onClick(view, event) {
    const more = event.target.closest('[data-more]');
    if (more) {
      const open = expandedOf(view);
      const kind = more.dataset.more;
      saveExpanded(view, open.includes(kind) ? open.filter((k) => k !== kind) : [...open, kind]);
      render(view);
      if (!open.includes(kind)) Nexo.emit('feat-use', { kind: 'expandir', view, id: kind });
      else sectionOf(view)?.querySelector(`[data-group="${kind}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const filter = event.target.closest('[data-filter]');
    if (filter) { saveFilter(view, filter.dataset.filter); render(view); Nexo.emit('feat-use', { kind: 'filtro', view, id: filter.dataset.filter }); return; }
    const pin = event.target.closest('[data-pin]');
    if (pin) {
      const all = pins(); const list = all[view] || [];
      all[view] = list.includes(pin.dataset.pin) ? list.filter((id) => id !== pin.dataset.pin) : [pin.dataset.pin, ...list];
      savePins(all); render(view); Nexo.emit('feat-use', { kind: 'fixar', view, id: pin.dataset.pin }); return;
    }
    const act = event.target.closest('[data-act]');
    if (act) {
      const def = forView(view).find((item) => item.id === act.dataset.act);
      if (!def?.action) return;
      Nexo.emit('feat-use', { kind: 'acao', view, id: def.id });
      act.disabled = true;
      try {
        const message = await def.action.run(makeContext(), act);
        if (message) showToast(message);
        for (const name of def.action.invalidates || def.needs || []) invalidate(name);
      } catch (error) { showToast(error?.message || 'Não deu certo.'); }
      finally { act.disabled = false; setTimeout(() => refresh(view, { sync: true }), 200); }
      const tile = document.querySelector(`[data-feats="${view}"] .feat[data-id="${def.id}"]`);
      tile?.classList.add('flash');
    }
  }

  /* ---------- Ritmo: só a tela aberta, no máximo a cada 3 s, nada com o app sem foco ---------- */
  let timer = null;
  let lastAt = 0;
  function schedule(soon = false) {
    if (timer) return;
    const wait = soon ? 250 : Math.max(0, 3000 - (Date.now() - lastAt));
    timer = setTimeout(() => {
      timer = null;
      if (Nexo.isIdle?.() || document.hidden) return;
      const view = Nexo.state.view;
      if (!REG[view]) return;
      lastAt = Date.now();
      refresh(view);
    }, wait);
  }
  Nexo.on('view', (view) => { if (REG[view]) { render(view); } });
  Nexo.on('snapshot', () => schedule());
  Nexo.on('sensors', () => schedule());
  Nexo.on('learned', () => schedule(true));
  Nexo.on('idle', (idle) => { if (!idle) schedule(true); });

  window.NexoFeatures = { add, forView, render, refresh, helpers: H, icon, sources: SOURCES, makeContext, all: () => REG, invalidate,
    /** Para a telemetria: fontes (certas, falhas, ms), cartões vistos e vazios por tela, e ids de cartões que quebraram. */
    health: () => ({ sources: JSON.parse(JSON.stringify(health.sources)), tiles: { ...health.tiles }, crashed: [...health.crashed] }) };
})();
