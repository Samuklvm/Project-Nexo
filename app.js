/* Nexo Device Care — inicialização: laços de leitura, comandos e primeira renderização. */
(function () {
  /* Ritmo das leituras (Ajustes → Velocidade das leituras). Tempo real = painel a cada 1 s e sensores a cada 2 s.
     Nada disso trava: CPU e memória vêm direto do sistema (sem PowerShell), os sensores vêm do serviço por um pipe
     local, e cada leitura só começa quando a anterior terminou. Sem foco, tudo espaça para 30 s. */
  const RATES = { realtime: { snapshot: 1000, sensors: 2000, slowSensors: 4000 }, balanced: { snapshot: 2000, sensors: 5000, slowSensors: 8000 }, eco: { snapshot: 5000, sensors: 15000, slowSensors: 15000 } };
  const IDLE_SNAPSHOT_MS = 30000;
  const rate = () => RATES[Nexo.liveRate] || RATES.realtime;
  let snapshotBusy = false;
  let lastSnapshotAt = 0;
  let lastSamplesAt = 0;

  /** Lê o estado do PC (CPU, memória, discos) e atualiza o painel; mais espaçado com a janela escondida e pausado durante as medições. */
  async function refreshSnapshot() {
    if (!desktopBridge?.getSystemSnapshot) { setAppStatus('Abra o app desktop para monitorar'); return; }
    if (snapshotBusy || Nexo.state.labRunning || Nexo.state.rebootMeasuring) return; // durante as medições, nada de carga extra atrapalhando
    // Janela escondida ou sem foco: uma leitura a cada 30 s (o aprendizado continua, o custo quase some).
    if (Nexo.isIdle?.() && !Nexo.sessions?.isRecording?.() && Date.now() - lastSnapshotAt < IDLE_SNAPSHOT_MS) return;
    lastSnapshotAt = Date.now();
    snapshotBusy = true;
    try {
      const snapshot = await desktopBridge.getSystemSnapshot();
      Nexo.state.snapshot = snapshot;
      Nexo.emit('snapshot', snapshot);
      // Índice e sugestões dependem de médias de minutos: recalcular a cada 5 s basta (os números ao vivo seguem a 1 s).
      if (Date.now() - lastSamplesAt >= 4500) { lastSamplesAt = Date.now(); Nexo.emit('samples'); }
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
  refreshSnapshot().then(() => Nexo.refreshHome()).catch((error) => console.error('[início] primeira leitura falhou', error));
  Nexo.refreshSensors?.();
  // Laços com setTimeout encadeado: o próximo só é marcado quando o anterior acabou (nunca empilham).
  const loop = (fn, delay) => { const tick = async () => { try { await fn(); } catch { /* segue */ } setTimeout(tick, delay()); }; setTimeout(tick, delay()); };
  loop(refreshSnapshot, () => (Nexo.isIdle?.() && !Nexo.sessions?.isRecording?.() ? 5000 : rate().snapshot));
  // Sensores: sem foco também atualizam (a cada 30 s, como o resto) — antes paravam e a GPU, o clock e a temperatura
  // ficavam congelados no último valor e entravam no histórico como se fossem do minuto atual.
  let lastSensorsAt = 0;
  loop(async () => {
    if (Nexo.state.labRunning || Nexo.state.rebootMeasuring) return;
    if (Nexo.isIdle?.() && !Nexo.sessions?.isRecording?.() && Date.now() - lastSensorsAt < IDLE_SNAPSHOT_MS) return;
    lastSensorsAt = Date.now();
    await Nexo.refreshSensors?.();
  }, () => {
    if (Nexo.isIdle?.() && !Nexo.sessions?.isRecording?.()) return 5000;
    return Nexo.state.sensors?.source === 'service' ? rate().sensors : rate().slowSensors;
  });
  Nexo.on('learned', () => Nexo.refreshHome());

  // No Linux não há assistente de instalação com os avisos: o próprio app mostra na primeira abertura.
  let noticed = true;
  try { noticed = localStorage.getItem('nexo-linux-notice') === '1'; } catch { noticed = true; }
  if (Nexo.platform === 'linux' && !noticed && desktopBridge) {
    setTimeout(() => {
      const dialog = Nexo.dialog({ title: 'Bem-vindo ao Nexo no Linux', wide: true, dismissible: false,
        html: `<ul>
          <li>Os indicadores e as recomendações são heurísticos: não garantem ganho de desempenho nem substituem avaliação técnica.</li>
          <li>Tudo o que o Nexo aprende fica neste computador (em ~/.config/Nexo Device Care). Ele consulta o GitHub para atualizações, manda os relatórios de erro ao servidor do Nexo e, fora isso, só usa a internet para os recursos opcionais que você ligar (capas e dados das lojas, contas, login com Google, telemetria e sincronização).</li>
          <li>Nada roda como root. O TRIM e a remoção do pacote .deb pedem a sua senha pela janela do próprio sistema (pkexec).</li>
          <li>A Otimização extrema (beta) é arriscada: no Linux ela testa os perfis de energia do power-profiles-daemon e volta ao original no fim.</li>
          <li>Para medir FPS, o Nexo lê o log do MangoHud; para detectar o jogo em primeiro plano, usa o xprop (X11 e XWayland).</li>
          <li>Os relatórios de erro vão sempre ao servidor do Nexo: os erros do app e os últimos passos antes de cada um, sem o seu nome de usuário, as suas pastas ou o que você digitou. Com a conta Google entrada, o e-mail vai junto para o criador avisar quando corrigir (dá para tirar em Ajustes). A telemetria (um resumo anônimo por dia) e a sincronização são opcionais e começam desligadas.</li></ul>`,
        actions: [{ id: 'policy', label: 'Política completa', keepOpen: true, onClick: () => desktopBridge.openLink?.('privacy') }, { id: 'ok', label: 'Entendi', tone: 'primary' }] });
      dialog.done.then(() => { try { localStorage.setItem('nexo-linux-notice', '1'); } catch { /* sem armazenamento */ } return true; }).catch(() => {});
    }, 900);
  }
})();
