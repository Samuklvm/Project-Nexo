/* Nexo Device Care — inicialização: laços de leitura, comandos e primeira renderização. */
(function () {
  const SNAPSHOT_MS = 5000;
  const SENSORS_MS = 15000;
  let snapshotBusy = false;
  let idleTicks = 0;

  async function refreshSnapshot() {
    if (!desktopBridge?.getSystemSnapshot) { setAppStatus('Abra o app desktop para monitorar'); return; }
    if (snapshotBusy || Nexo.state.labRunning) return; // durante o laboratório, nada de carga extra atrapalhando a medição
    // Janela escondida ou sem foco: lê a cada 30 s em vez de 5 s (o aprendizado continua, o custo cai a 1/6).
    idleTicks = Nexo.isIdle?.() ? (idleTicks + 1) % 6 : 0;
    if (idleTicks !== 0 && !Nexo.sessions?.isRecording?.()) return;
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

  const pages = [['home', 'Início'], ['analysis', 'Análise'], ['sessions', 'Sessões'], ['library', 'Jogos'], ['optimize', 'Otimizar'], ['lab', 'Otimização extrema (beta)'], ['atlas', 'Atlas de opções'], ['hardware', 'Hardware'], ['maintenance', 'Manutenção'], ['activity', 'Atividade'], ['updates', 'Atualizações'], ['settings', 'Ajustes']];
  Nexo.commands.unshift(
    ...pages.map(([view, label]) => ({ label: `Ir para ${label}`, hint: 'Página', run: () => Nexo.go(view) })),
    { label: 'Analisar agora', hint: 'Análise inteligente', run: () => { Nexo.go('analysis'); Nexo.runAnalysis(); } },
    { label: 'Recalcular a limpeza segura', hint: 'Otimizar', run: () => { Nexo.go('optimize'); Nexo.scanCleanup(); } },
    { label: 'Abrir o Gerenciador de Tarefas', hint: 'Sistema', run: () => desktopBridge?.openTaskManager?.() },
    { label: 'Alternar efeitos visuais (completo/leve)', hint: 'Ajustes', run: () => Nexo.setEffects(Nexo.effectsLite ? 'full' : 'lite') }
  );

  renderActivity();
  Nexo.initSettings();
  Nexo.autoEffects?.();
  Nexo.go('home');
  Nexo.checkForUpdates();
  Nexo.loadPower();
  refreshSnapshot().then(() => Nexo.refreshHome());
  Nexo.refreshSensors?.();
  setInterval(refreshSnapshot, SNAPSHOT_MS);
  setInterval(() => { if (!Nexo.state.labRunning && (!Nexo.isIdle?.() || Nexo.sessions?.isRecording?.())) Nexo.refreshSensors?.(); }, SENSORS_MS);
  Nexo.on('learned', () => Nexo.refreshHome());

  // No Linux não há assistente de instalação com os avisos: o próprio app mostra na primeira abertura.
  let noticed = true;
  try { noticed = localStorage.getItem('nexo-linux-notice') === '1'; } catch { noticed = true; }
  if (Nexo.platform === 'linux' && !noticed && desktopBridge) {
    setTimeout(() => {
      const dialog = Nexo.dialog({ title: 'Bem-vindo ao Nexo no Linux', wide: true, dismissible: false,
        html: `<ul>
          <li>Os indicadores e as recomendações são heurísticos: não garantem ganho de desempenho nem substituem avaliação técnica.</li>
          <li>Tudo o que o Nexo aprende fica neste computador (em ~/.config/Nexo Device Care). Ele consulta o GitHub para atualizações e só usa a internet para os recursos opcionais que você ligar (capas e dados das lojas, contas e login com Google).</li>
          <li>Nada roda como root. O TRIM e a remoção do pacote .deb pedem a sua senha pela janela do próprio sistema (pkexec).</li>
          <li>A Otimização extrema (beta) é arriscada: no Linux ela testa os perfis de energia do power-profiles-daemon e volta ao original no fim.</li>
          <li>Para medir FPS, o Nexo lê o log do MangoHud; para detectar o jogo em primeiro plano, usa o xprop (X11 e XWayland).</li>
          <li>O compartilhamento opcional com o criador começa desativado, e nesta versão o Nexo não envia telemetria.</li></ul>`,
        actions: [{ id: 'policy', label: 'Política completa', keepOpen: true, onClick: () => desktopBridge.openLink?.('privacy') }, { id: 'ok', label: 'Entendi', tone: 'primary' }] });
      dialog.done.then(() => { try { localStorage.setItem('nexo-linux-notice', '1'); } catch { /* sem armazenamento */ } });
    }, 900);
  }
})();
