/* Nexo Device Care — inicialização: laços de leitura, comandos e primeira renderização. */
(function () {
  const SNAPSHOT_MS = 5000;
  const SENSORS_MS = 15000;
  let snapshotBusy = false;

  async function refreshSnapshot() {
    if (!desktopBridge?.getSystemSnapshot) { setAppStatus('Abra o app desktop para monitorar'); return; }
    if (snapshotBusy) return;
    snapshotBusy = true;
    try {
      const snapshot = await desktopBridge.getSystemSnapshot();
      Nexo.state.snapshot = snapshot;
      Nexo.emit('snapshot', snapshot);
      Nexo.emit('samples');
      setAppStatus('Monitoramento ativo');
    } catch (error) {
      setAppStatus('Falha ao ler o sistema');
      console.error(error);
    } finally { snapshotBusy = false; }
  }

  const pages = [['home', 'Início'], ['analysis', 'Análise'], ['optimize', 'Otimizar'], ['hardware', 'Hardware'], ['maintenance', 'Manutenção'], ['activity', 'Atividade'], ['updates', 'Atualizações'], ['settings', 'Ajustes']];
  Nexo.commands.unshift(
    ...pages.map(([view, label]) => ({ label: `Ir para ${label}`, hint: 'Página', run: () => Nexo.go(view) })),
    { label: 'Analisar agora', hint: 'Análise inteligente', run: () => { Nexo.go('analysis'); Nexo.runAnalysis(); } },
    { label: 'Recalcular a limpeza segura', hint: 'Otimizar', run: () => { Nexo.go('optimize'); Nexo.scanCleanup(); } },
    { label: 'Abrir o Gerenciador de Tarefas', hint: 'Sistema', run: () => desktopBridge?.openTaskManager?.() },
    { label: 'Alternar efeitos visuais (completo/leve)', hint: 'Ajustes', run: () => Nexo.setEffects(Nexo.effectsLite ? 'full' : 'lite') }
  );

  renderActivity();
  Nexo.initSettings();
  Nexo.go('home');
  Nexo.checkForUpdates();
  Nexo.loadPower();
  refreshSnapshot().then(() => Nexo.refreshHome());
  Nexo.refreshSensors?.();
  setInterval(refreshSnapshot, SNAPSHOT_MS);
  setInterval(() => Nexo.refreshSensors?.(), SENSORS_MS);
  Nexo.on('learned', () => Nexo.refreshHome());
})();
