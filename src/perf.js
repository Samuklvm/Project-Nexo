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
