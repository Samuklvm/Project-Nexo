/*
 * Leveza: o visual é extravagante, mas o custo é medido e controlado.
 *  - "idle": janela sem foco ou escondida = todas as animações decorativas pausadas (CSS) e leituras mais espaçadas;
 *  - modo leve automático na primeira abertura em PCs com até 4 núcleos ou menos de 8 GB de RAM;
 *  - medidor do custo real do próprio Nexo (CPU e memória) em Ajustes.
 */
(function () {
  const bridge = desktopBridge;
  const body = document.body;
  const update = () => {
    const idle = document.hidden || !document.hasFocus();
    if (idle === body.classList.contains('idle')) return;
    body.classList.toggle('idle', idle);
    Nexo.emit('idle', idle);
  };
  addEventListener('blur', update);
  addEventListener('focus', update);
  document.addEventListener('visibilitychange', update);
  Nexo.isIdle = () => body.classList.contains('idle');
  /* Taxa do monitor desta janela (Hz), medida pelos quadros do navegador uma vez ao abrir: serve para saber se o FPS
     de um jogo ficou colado no limite do monitor (limite de quadros/V-Sync) em vez de num gargalo de verdade. */
  let refreshHz = null;
  const measureRefresh = () => {
    const times = [];
    const step = (time) => {
      times.push(time);
      if (times.length < 90) { requestAnimationFrame(step); return; }
      const deltas = times.slice(1).map((value, index) => value - times[index]).filter((value) => value > 2 && value < 100).sort((a, b) => a - b);
      const median = deltas[Math.floor(deltas.length / 2)];
      if (median) refreshHz = Math.round(1000 / median);
    };
    requestAnimationFrame(step);
  };
  if (document.hidden) document.addEventListener('visibilitychange', () => { if (!document.hidden && refreshHz === null) measureRefresh(); }, { once: true });
  else measureRefresh();
  Nexo.refreshHz = () => refreshHz;
  update();

  /* Primeira abertura num PC fraco: liga o modo leve sozinho (a pessoa pode trocar em Ajustes). */
  Nexo.autoEffects = async function autoEffects() {
    let stored = null;
    try { stored = localStorage.getItem(Nexo.keys.effects); } catch { stored = null; }
    if (stored || !bridge?.getHardwareTier) return;
    try {
      const tier = await bridge.getHardwareTier();
      if (tier.tier === 'fraco') {
        Nexo.setEffects('lite');
        if (!Nexo.liveRateStored?.()) Nexo.setLiveRate?.('balanced');
        showToast(`Modo leve ligado: este PC tem ${tier.cores} núcleos e ${String(tier.memGB).replace('.', ',')} GB. Dá para trocar em Ajustes.`);
      }
    } catch { /* mantém o padrão */ }
  };

  /* Medidor do custo do Nexo (só roda com Ajustes aberto). */
  let meter = null;
  async function sample() {
    try {
      const metrics = await bridge.getSelfMetrics();
      setText('self-cpu', `${metrics.cpu.toFixed(1).replace('.', ',')}%`);
      setText('self-mem', `${Math.round(metrics.memMB)} MB`);
      setText('self-proc', String(metrics.processes));
      const bar = document.getElementById('self-bar');
      if (bar) bar.style.width = `${Math.min(100, metrics.cpu * 10)}%`;
    } catch { /* fora do app desktop */ }
  }
  Nexo.on('view', (view) => {
    clearInterval(meter);
    meter = null;
    if (view === 'settings' && bridge?.getSelfMetrics) { sample(); meter = setInterval(() => { if (!Nexo.isIdle()) sample(); }, 2000); }
  });
})();
