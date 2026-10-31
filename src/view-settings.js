/* Ajustes: papel de parede, efeitos, privacidade, dados locais e desinstalação completa. */
(function () {
  const root = document.documentElement;
  const fileInput = document.getElementById('wallpaper-file');
  const resetButton = document.getElementById('reset-wallpaper');

  function applyWallpaper(url) {
    if (url) root.style.setProperty('--wallpaper-image', `url("${url}")`);
    else root.style.removeProperty('--wallpaper-image');
    resetButton.hidden = !url;
  }

  /** Reduz a imagem para no máximo 2560 px de largura antes de guardar (WebP). */
  async function shrinkImage(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    return blob ? blob.arrayBuffer() : file.arrayBuffer();
  }

  document.getElementById('choose-wallpaper').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { showToast('Use uma imagem PNG, JPEG ou WebP.'); return; }
    try {
      const bytes = await shrinkImage(file);
      if (desktopBridge?.setWallpaper) applyWallpaper((await desktopBridge.setWallpaper(bytes)).url);
      else applyWallpaper(URL.createObjectURL(new Blob([bytes])));
      showToast('Papel de parede atualizado.');
      recordActivity('Papel de parede', 'imagem personalizada');
    } catch (error) { showToast(error.message || 'Não foi possível usar esta imagem.'); }
  });
  resetButton.addEventListener('click', async () => {
    try { await desktopBridge?.resetWallpaper?.(); } catch { /* o padrão volta de qualquer forma */ }
    applyWallpaper(null);
    showToast('Papel de parede padrão restaurado.');
  });

  $$('[data-effects]').forEach((button) => button.addEventListener('click', () => Nexo.setEffects(button.dataset.effects)));

  const shareToggle = document.getElementById('share-toggle');
  shareToggle.addEventListener('change', async () => {
    try { await desktopBridge?.setPrivacy?.(shareToggle.checked); showToast('Preferência salva neste computador.'); }
    catch { shareToggle.checked = !shareToggle.checked; showToast('Não foi possível salvar a preferência.'); }
  });

  document.getElementById('export-data').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(Nexo.store.exportAll(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexo-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Arquivo salvo localmente.');
  });

  document.getElementById('erase-learning').addEventListener('click', async () => {
    const confirmed = await Nexo.confirm({
      title: 'Apagar o aprendizado e o histórico?',
      body: 'O Nexo esquece a sua rotina, as lentidões registradas, os programas identificados, o histórico de 7 dias e as suas avaliações. Ele volta a aprender do zero.',
      confirmLabel: 'Apagar', tone: 'danger'
    });
    if (!confirmed) return;
    Nexo.store.eraseLearning();
    showToast('Aprendizado e histórico apagados.');
    recordActivity('Dados locais', 'aprendizado apagado');
    refreshInfo();
  });

  document.getElementById('open-privacy').addEventListener('click', () => desktopBridge?.openLink?.('privacy'));
  $$('[data-link]').forEach((button) => button.addEventListener('click', () => desktopBridge?.openLink?.(button.dataset.link)));

  document.getElementById('uninstall-app').addEventListener('click', async () => {
    const confirmed = await Nexo.confirm({
      title: 'Desinstalar o Nexo completamente?',
      body: 'O Nexo vai fechar e remover tudo em poucos segundos. Uma mensagem final mostrará se algo não pôde ser apagado.',
      items: ['O programa e todos os arquivos da instalação.', 'Seus dados e preferências: histórico, aprendizado, papel de parede.', 'Atalhos, entradas do Registro e o cache de atualizações.', 'Rastros que o Windows guarda sobre o Nexo (MuiCache, UserAssist e Recentes).', 'Nada além disso: outros programas e arquivos pessoais não são tocados.'],
      confirmLabel: 'Desinstalar', tone: 'danger'
    });
    if (!confirmed) return;
    try { await desktopBridge.uninstallApp(); }
    catch (error) { showToast(error.message || 'Não foi possível iniciar a desinstalação.'); }
  });

  async function refreshInfo() {
    if (!desktopBridge?.getAppInfo) { setText('about-version', 'desenvolvimento'); return; }
    try {
      const info = await desktopBridge.getAppInfo();
      setText('about-version', info.version);
      setText('updates-current-version', info.version);
      setText('data-size', formatBytes(info.userDataBytes));
      setText('data-path', info.userDataPath);
      document.getElementById('uninstall-app').disabled = !info.packaged;
      document.getElementById('uninstall-app').title = info.packaged ? '' : 'Disponível na versão instalada';
    } catch { /* informações opcionais */ }
  }

  Nexo.initSettings = async function initSettings() {
    Nexo.setEffects(localStorage.getItem(Nexo.keys.effects) === 'lite' ? 'lite' : 'full');
    try { applyWallpaper((await desktopBridge?.getWallpaper?.())?.url || null); } catch { applyWallpaper(null); }
    try { shareToggle.checked = Boolean((await desktopBridge?.getPrivacy?.())?.shareWithCreator); } catch { /* padrão desativado */ }
    refreshInfo();
  };
  Nexo.on('view', (view) => { if (view === 'settings') refreshInfo(); });
})();
