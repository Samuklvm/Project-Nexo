/*
 * Vigias de erro da interface: coisas que funcionam, mas errado, sem exceção nenhuma (leitura impossível, sensores
 * que somem, fonte de dados falhando, abertura lenta, céu lento). Cada uma vira um AVISO no registro local, que vai para
 * o criador junto dos relatórios de erro (mesmo interruptor), no máximo uma vez por abertura em cada chave.
 *
 * Privacidade: só números arredondados e nomes fixos (campo, fonte, tela). Nada de programas, pastas ou texto digitado.
 * Spec: docs/superpowers/specs/2026-11-18-vigias-de-erro-design.md
 *
 * As decisões ficam em funções puras (testadas nos limites); install() liga elas no app.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.NexoWatchers = factory();
    if (root.Nexo) {
      root.Nexo.watchers = root.NexoWatchers.install({
        Nexo: root.Nexo, bridge: root.nexoDesktop, document: root.document, performance: root.performance, setInterval: root.setInterval.bind(root)
      });
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN = 60000;
  const LIMITS = { tempMin: -10, tempMax: 125, slowStartMs: 12000, sensorsGoneMs: 5 * MIN, skyFps: 12, skySlowMs: MIN, sourceFails: 3, sourceSlowMs: 20000 };
  const round1 = (value) => Math.round(value * 10) / 10;
  const shown = (value) => (Number.isFinite(value) ? round1(value) : 'NaN');
  const isNumber = (value) => typeof value === 'number';

  /** Problemas de uma leitura do PC: porcentagem fora de 0–100 (ou NaN), temperatura fora de −10–125 °C, memória total 0. */
  function checkReading(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return [];
    const out = [];
    const percent = (campo, value) => { if (isNumber(value) && !(value >= 0 && value <= 100)) out.push({ campo, valor: shown(value) }); };
    const celsius = (campo, value) => { if (isNumber(value) && !(value >= LIMITS.tempMin && value <= LIMITS.tempMax)) out.push({ campo, valor: shown(value) }); };
    percent('cpu', snapshot.cpuUsage);
    percent('memoria', snapshot.memoryPercent);
    percent('disco', snapshot.primaryDrive?.usedPercent);
    const thermal = snapshot.temperatureReadings || {};
    const acpi = Array.isArray(thermal.acpiSensors) ? thermal.acpiSensors : [];
    const gpus = Array.isArray(thermal.gpuSensors) ? thermal.gpuSensors : [];
    const badTemp = acpi.map((sensor) => sensor?.celsius).find((value) => isNumber(value) && !(value >= LIMITS.tempMin && value <= LIMITS.tempMax));
    if (badTemp !== undefined) celsius('temperatura', badTemp);
    const badGpuTemp = gpus.map((gpu) => gpu?.temperatureCelsius).find((value) => isNumber(value) && !(value >= LIMITS.tempMin && value <= LIMITS.tempMax));
    if (badGpuTemp !== undefined) celsius('temperatura-video', badGpuTemp);
    const badUsage = gpus.map((gpu) => gpu?.usagePercent).find((value) => isNumber(value) && !(value >= 0 && value <= 100));
    if (badUsage !== undefined) percent('video', badUsage);
    if (isNumber(snapshot.memoryTotalBytes) && !(snapshot.memoryTotalBytes > 0)) out.push({ campo: 'memoria-total', valor: shown(snapshot.memoryTotalBytes) });
    return out;
  }

  /**
   * Sensores que funcionavam nesta abertura e ficaram 5 min seguidos sem temperatura. hasTemp = null quando não dá
   * para contar (janela sem foco: o coletor pausa) e recomeça a conta.
   */
  function sensorsGone(state, hasTemp, now) {
    if (hasTemp === null) { state.lostAt = null; return false; }
    if (hasTemp) { state.seen = true; state.lostAt = null; return false; }
    if (!state.seen) return false;
    if (!Number.isFinite(state.lostAt)) state.lostAt = now;
    return now - state.lostAt >= LIMITS.sensorsGoneMs;
  }

  /** A primeira leitura do PC chegou mais de 12 s depois de a tela abrir. */
  const slowStart = (ms) => Number.isFinite(ms) && ms > LIMITS.slowStartMs;

  /** Céu abaixo de 12 quadros/s por 1 min seguido, com o Nexo em foco, efeitos completos e a tela inicial aberta. */
  function skySlow(state, { fps, focused, full, home }, now) {
    if (!(focused && full && home) || !Number.isFinite(fps) || fps >= LIMITS.skyFps) { state.since = null; return false; }
    if (!Number.isFinite(state.since)) state.since = now;
    return now - state.since >= LIMITS.skySlowMs;
  }

  /** Fonte de dados dos cartões: 3 falhas seguidas ou uma resposta de mais de 20 s. Um acerto zera as falhas. */
  function sourceTrouble(state, name, ok, ms) {
    const item = (state[name] ||= { fails: 0 });
    if (Number.isFinite(ms) && ms > LIMITS.sourceSlowMs) return { motivo: 'lenta', segundos: Math.round(ms / 1000) };
    if (ok) { item.fails = 0; return null; }
    item.fails += 1;
    return item.fails >= LIMITS.sourceFails ? { motivo: 'falhando', vezes: item.fails } : null;
  }

  /** Nome fixo e curto (fonte, campo): só letras, números, ponto e hífen. */
  const fixed = (value) => String(value || '').replace(/[^a-z0-9.-]/gi, '').slice(0, 40) || 'outro';

  /** Liga os vigias no app. Devolve { note, sourceResult } (note não repete a mesma chave na mesma abertura). */
  function install({ Nexo, bridge, document, performance, setInterval }) {
    const fired = new Set();
    const guard = (fn) => (...args) => { try { return fn(...args); } catch { return undefined; } };
    const note = guard((vigia, message, context = {}, key = vigia) => {
      if (fired.has(key)) return;
      fired.add(key);
      bridge?.reportError?.({ level: 'aviso', message: String(message).slice(0, 300), stack: '', context: { tela: Nexo?.state?.view || null, vigia, ...context } });
    });
    const focused = () => Boolean(document && !document.hidden && (document.hasFocus ? document.hasFocus() : true) && !Nexo?.isIdle?.());

    const sources = {};
    const sourceResult = guard((name, ok, ms, message) => {
      const fonte = fixed(name);
      const trouble = sourceTrouble(sources, fonte, ok, ms);
      if (!trouble) return;
      note('fonte-falhando', `Fonte de dados dos cartões ${trouble.motivo === 'lenta' ? 'lenta' : 'falhando'}: ${fonte}`, { fonte, ...trouble, ...(message ? { erro: String(message).slice(0, 160) } : {}) }, `fonte:${fonte}:${trouble.motivo}`);
    });

    let firstReading = true;
    const sensors = {};
    const plausible = (value) => Number.isFinite(value) && value > 5 && value < 125;
    Nexo?.on?.('snapshot', guard((snapshot) => {
      if (firstReading) {
        firstReading = false;
        const ms = performance?.now?.();
        if (slowStart(ms)) note('abertura-lenta', 'O Nexo demorou para mostrar a primeira leitura do PC', { segundos: Math.round(ms / 1000) });
      }
      for (const problem of checkReading(snapshot)) note('leitura-impossivel', `Leitura impossível do PC: ${problem.campo}`, problem, `leitura:${problem.campo}`);
      const thermal = snapshot?.temperatureReadings || {};
      const live = Nexo.store?.live?.() || [];
      const hasTemp = (thermal.acpiSensors || []).some((sensor) => plausible(sensor?.celsius)) || (thermal.gpuSensors || []).some((gpu) => plausible(gpu?.temperatureCelsius))
        || plausible(Nexo.store?.hottest?.(live[live.length - 1] || {}));
      if (sensorsGone(sensors, focused() ? hasTemp : null, Date.now())) note('sensores-sumiram', 'Os sensores de temperatura pararam de responder', { minutos: 5 });
    }));

    const sky = {};
    setInterval?.(guard(() => {
      const state = { fps: Nexo?.sky?.stats?.()?.fps, focused: focused(), full: !Nexo?.effectsLite, home: Nexo?.state?.view === 'home' };
      if (skySlow(sky, state, performance?.now?.() ?? Date.now())) note('ceu-lento', 'O céu ficou lento com o Nexo na frente', { fps: Math.round(state.fps) });
    }), 10000);

    return { note, sourceResult };
  }

  return { checkReading, sensorsGone, slowStart, skySlow, sourceTrouble, install, LIMITS };
});
