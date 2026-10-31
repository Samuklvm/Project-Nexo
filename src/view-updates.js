/* Atualizações: verificação, download e instalação via GitHub (electron-updater). */
(function () {
  const updateButton = document.getElementById('update-app');
  const installUpdatePageButton = document.getElementById('install-update-page');
  const downloadUpdateButton = document.getElementById('download-update');
  const deferUpdateButton = document.getElementById('defer-update');
  const updatePanel = document.getElementById('update-panel');
  const checkUpdatesButton = document.getElementById('check-updates');
  let currentUpdateStatus = { state: 'checking' };

  function formatUpdateEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const remaining = Math.ceil(seconds);
    if (remaining < 60) return `${remaining} s restantes`;
    return `${Math.floor(remaining / 60)} min restantes`;
  }

  function getUpdateErrorMessage(message) {
    const raw = String(message || '');
    const normalized = raw.toLowerCase();
    if (/enotfound|econn|timed? ?out|network|internet/.test(normalized)) {
      return 'Não foi possível conectar ao GitHub. Confira a internet e tente novamente.';
    }
    if (/404|not found|latest\.yml/.test(normalized)) {
      return 'O GitHub não encontrou os arquivos desta atualização. Você pode tentar de novo ou baixar o instalador na página de releases.';
    }
    if (/signature|publisher|certificate/.test(normalized)) {
      return 'O Windows não conseguiu confirmar a assinatura deste pacote. Não instalamos a atualização.';
    }
    return raw || 'Confira sua conexão e tente novamente.';
  }

  function getReleaseNoteLines(notes) {
    const text = Array.isArray(notes)
      ? notes.map((note) => typeof note === 'string' ? note : note?.note || note?.text || '').join('\n')
      : String(notes || '');
    return text.split(/\r?\n/)
      .map((line) => line.trim()
        .replace(/^#{1,6}\s*/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_`~]/g, ''))
      .filter(Boolean)
      .slice(0, 8)
      .map((line) => line.length > 180 ? `${line.slice(0, 177)}...` : line);
  }

  function renderUpdateReleaseNotes(status) {
    const section = document.getElementById('update-release-notes');
    const list = document.getElementById('update-release-list');
    if (!section || !list) return;
    const shouldShow = ['available', 'downloading', 'downloaded'].includes(status.state)
      || (status.state === 'error' && status.canRetry);
    if (!shouldShow || !status.version) {
      section.hidden = true;
      list.replaceChildren();
      return;
    }

    setText('update-release-heading', status.releaseName || `Novidades da versão ${status.version}`);
    const notes = getReleaseNoteLines(status.releaseNotes);
    list.replaceChildren();
    if (!notes.length) notes.push('Esta versão não tem notas de alteração publicadas.');
    for (const note of notes) {
      const item = document.createElement('li');
      item.textContent = note;
      list.append(item);
    }
    section.hidden = false;
  }

  function renderUpdateStatus(status) {
    const errorMessage = status.state === 'error' ? getUpdateErrorMessage(status.message) : '';
    const details = {
      checking: ['Conferindo novidades', 'Consultando as versões públicas do GitHub.', 'Verificação em andamento'],
      available: ['Nova atualização disponível', `A versão ${status.version || 'mais recente'} está pronta. Baixe quando quiser; você escolhe quando instalar.`, 'Nova versão disponível'],
      downloading: ['Baixando atualização', `A versão ${status.version || 'mais recente'} está sendo baixada. Você pode continuar usando o app.`, 'Download em andamento'],
      current: ['Você está em dia', 'Esta instalação já está na versão mais recente disponível.', 'Tudo atualizado'],
      downloaded: ['Pronto para atualizar', `A versão ${status.version || 'mais recente'} foi baixada. Feche os trabalhos abertos e instale quando estiver pronto.`, 'Atualização pronta'],
      development: ['Atualizações da versão instalada', 'Instale o Nexo para receber atualizações publicadas no GitHub.', 'Modo de desenvolvimento'],
      error: ['A atualização não foi concluída', errorMessage, 'Falha na atualização']
    };
    const [heading, detail, eyebrow] = details[status.state] || ['Status indisponível', 'Tente verificar novamente.', 'Atualizações'];
    const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
    const isAvailable = status.state === 'available';
    const isDownloading = status.state === 'downloading';
    const isChecking = status.state === 'checking';
    const isDownloaded = status.state === 'downloaded';
    const canRetryDownload = status.state === 'error' && status.canRetry;
    const hasInterruptedDownload = canRetryDownload && Number(status.total) > 0;
    currentUpdateStatus = status;

    setText('update-status', isDownloading
      ? `Baixando atualização · ${percent}%`
      : isAvailable ? `Nova versão · ${status.version || 'disponível'}` : heading);
    setText('update-state-heading', heading);
    setText('update-state-detail', detail);
    setText('update-state-eyebrow', eyebrow);
    setText('update-progress-label', isChecking ? 'Buscando uma versão nova' : hasInterruptedDownload ? 'Download interrompido' : 'Baixando pacote do GitHub');
    setText('update-progress-percent', isChecking ? '…' : `${percent}%`);

    const versionChip = document.getElementById('update-version-chip');
    if (versionChip) {
      const releaseDate = status.releaseDate ? new Date(status.releaseDate) : null;
      const dateLabel = releaseDate && Number.isFinite(releaseDate.getTime())
        ? ` · ${releaseDate.toLocaleDateString('pt-BR')}`
        : '';
      versionChip.textContent = status.version ? `Versão ${status.version}${dateLabel}` : '';
      versionChip.hidden = !status.version || !['available', 'downloading', 'downloaded', 'error'].includes(status.state);
    }
    renderUpdateReleaseNotes(status);
    if (updatePanel) updatePanel.dataset.state = status.state;

    const progressWrap = document.getElementById('update-progress-wrap');
    const progressTrack = document.getElementById('update-progress-track');
    const progressFill = document.getElementById('update-progress-fill');
    const showProgress = isChecking || isDownloading || hasInterruptedDownload;
    if (progressWrap) progressWrap.hidden = !showProgress;
    if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(isChecking ? 0 : percent));
    if (progressFill) progressFill.style.width = isChecking ? '34%' : `${percent}%`;
    if (isChecking) {
      setText('update-progress-size', 'Conectando ao GitHub…');
      setText('update-progress-speed', '');
    } else if (Number(status.total) > 0) {
      setText('update-progress-size', `${formatBytes(Number(status.transferred) || 0)} de ${formatBytes(Number(status.total))}`);
      const speed = Number(status.bytesPerSecond) || 0;
      const eta = speed > 0 ? formatUpdateEta((status.total - (status.transferred || 0)) / speed) : '';
      setText('update-progress-speed', speed > 0 ? `${formatBytes(speed)}/s${eta ? ` · ${eta}` : ''}` : 'Calculando velocidade…');
    } else {
      setText('update-progress-size', isDownloading ? 'Preparando o download…' : '');
      setText('update-progress-speed', '');
    }

    updateButton.hidden = !isAvailable && !isDownloaded && !canRetryDownload;
    updateButton.querySelector('span:last-child').textContent = isDownloaded
      ? `Instalar versão ${status.version || ''}`.trim()
      : `Ver versão ${status.version || ''}`.trim();
    downloadUpdateButton.hidden = !isAvailable && !canRetryDownload;
    downloadUpdateButton.dataset.idleText = canRetryDownload ? 'Tentar baixar novamente' : 'Baixar atualização';
    if (!downloadUpdateButton.disabled) downloadUpdateButton.textContent = downloadUpdateButton.dataset.idleText;
    checkUpdatesButton.disabled = isChecking || isDownloading || isDownloaded;
    checkUpdatesButton.textContent = status.state === 'error' ? 'Tentar verificar novamente' : 'Verificar novamente';
    deferUpdateButton.hidden = !isAvailable;
    installUpdatePageButton.hidden = !isDownloaded;
    const updateIndicator = document.getElementById('update-nav-indicator');
    if (updateIndicator) updateIndicator.hidden = !isAvailable && !isDownloaded && !canRetryDownload;
  }

  async function checkForUpdates() {
    if (!desktopBridge?.checkForUpdates) {
      renderUpdateStatus({ state: 'development' });
      return;
    }
    try {
      renderUpdateStatus(await desktopBridge.checkForUpdates());
    } catch (error) {
      renderUpdateStatus({ state: 'error', message: error.message });
    }
  }

  if (desktopBridge?.onUpdateStatus) desktopBridge.onUpdateStatus(renderUpdateStatus);

  updateButton.addEventListener('click', async () => {
    if (currentUpdateStatus.state !== 'downloaded') {
      Nexo.go('updates');
      return;
    }
    await installDownloadedUpdate();
  });

  async function installDownloadedUpdate() {
    if (!desktopBridge?.installUpdate) return;
    try {
      await desktopBridge.installUpdate();
    } catch (error) {
      showToast(error.message || 'Não foi possível instalar a atualização.');
    }
  }

  installUpdatePageButton.addEventListener('click', installDownloadedUpdate);

  downloadUpdateButton.addEventListener('click', async () => {
    if (!desktopBridge?.downloadUpdate) return;
    setButtonBusy(downloadUpdateButton, true, 'Baixando...');
    try {
      renderUpdateStatus(await desktopBridge.downloadUpdate());
    } catch (error) {
      renderUpdateStatus({
        state: 'error',
        message: error.message || 'Não foi possível baixar a atualização.',
        version: currentUpdateStatus.version,
        canRetry: true
      });
    } finally {
      setButtonBusy(downloadUpdateButton, false);
    }
  });

  deferUpdateButton.addEventListener('click', () => Nexo.go('home'));

  checkUpdatesButton.addEventListener('click', async () => {
    setButtonBusy(checkUpdatesButton, true, 'Verificando...');
    await checkForUpdates();
    setButtonBusy(checkUpdatesButton, false);
  });


  Nexo.checkForUpdates = checkForUpdates;
  Nexo.commands.push({ label: 'Verificar atualizações', hint: 'Atualizações', run: () => { Nexo.go('updates'); checkUpdatesButton.click(); } });
})();
