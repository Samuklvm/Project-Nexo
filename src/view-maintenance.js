/* Manutenção: otimização de unidades e verificação de arquivos do sistema (SFC). */
(function () {
  const select = document.getElementById('drive-select');
  const optimizeButton = document.getElementById('drive-optimize');
  const repairButton = document.getElementById('run-repair');

  const selectedDrive = () => Nexo.state.snapshot?.drives?.find((drive) => drive.driveLetter === select.value) || null;

  function hydrate() {
    const drive = selectedDrive();
    const bar = document.getElementById('drive-capacity-bar');
    if (!drive) {
      setText('drive-type', 'Unidade local'); setText('drive-model', 'Nenhuma unidade disponível');
      setText('drive-temp', 'Não medida'); setText('drive-format', '--'); setText('drive-state', 'Indisponível');
      setText('drive-used-capacity', '--'); setText('drive-total-capacity', '--');
      setText('drive-used-label', '-- usados'); setText('drive-free-label', '-- livres');
      bar.style.width = '0%'; optimizeButton.disabled = true;
      return;
    }
    setText('drive-type', 'Unidade local'); setText('drive-model', drive.name || `Disco ${drive.driveLetter}:`);
    setText('drive-temp', 'Não medida'); setText('drive-format', drive.fileSystem || '--');
    setText('drive-state', drive.usedPercent >= 95 ? 'Pouco espaço livre' : 'Leitura concluída');
    setText('drive-used-capacity', formatBytes(drive.usedBytes)); setText('drive-total-capacity', formatBytes(drive.sizeBytes));
    setText('drive-used-label', `${formatBytes(drive.usedBytes)} usados`); setText('drive-free-label', `${formatBytes(drive.freeBytes)} livres`);
    setText('drive-operation-title', 'Otimização do Windows');
    setText('drive-operation-description', 'O Windows seleciona a operação adequada para o tipo de unidade.');
    setText('drive-method', 'Otimizar');
    bar.style.width = `${drive.usedPercent}%`;
    optimizeButton.disabled = false;
  }

  function syncOptions() {
    const drives = Nexo.state.snapshot?.drives || [];
    const signature = drives.map((drive) => drive.driveLetter).join(',');
    if (select.dataset.signature !== signature) {
      const previous = select.value || Nexo.state.snapshot?.primaryDrive?.driveLetter;
      select.innerHTML = drives.length ? drives.map((drive) => `<option value="${escapeHtml(drive.driveLetter)}">${escapeHtml(drive.driveLetter)}: ${escapeHtml(drive.name || 'Disco local')}</option>`).join('') : '<option value="">Nenhuma unidade</option>';
      if (drives.some((drive) => drive.driveLetter === previous)) select.value = previous;
      select.dataset.signature = signature;
    }
    hydrate();
  }

  async function optimizeDrive() {
    const drive = selectedDrive();
    if (!drive || !desktopBridge?.optimizeDrive) return;
    const confirmed = await Nexo.confirm({
      title: `Otimizar a unidade ${drive.driveLetter}:?`,
      body: 'O Windows vai usar a ferramenta nativa de otimização (TRIM em SSD, desfragmentação em HD).',
      items: ['O Windows pode pedir permissão de administrador.', 'Você pode continuar usando o computador durante o processo.'],
      confirmLabel: 'Otimizar'
    });
    if (!confirmed) return;
    setButtonBusy(optimizeButton, true, 'Otimizando…');
    setAppStatus(`Otimizando ${drive.driveLetter}:`);
    try {
      await desktopBridge.optimizeDrive(drive.driveLetter);
      showToast(`O Windows concluiu a otimização de ${drive.driveLetter}:.`);
      recordActivity('Otimização de unidade', `${drive.driveLetter}:`);
    } catch (error) {
      showToast(error.message || 'Não foi possível otimizar a unidade.');
    } finally {
      setButtonBusy(optimizeButton, false);
      setAppStatus('Monitoramento ativo');
      optimizeButton.disabled = !selectedDrive();
    }
  }

  async function runRepair() {
    if (!desktopBridge?.repairSystemFiles) { showToast('A verificação SFC está disponível no aplicativo desktop.'); return; }
    const confirmed = await Nexo.confirm({
      title: 'Verificar os arquivos do Windows?',
      body: 'O Windows executará sfc /scannow para conferir os arquivos protegidos do sistema.',
      items: ['Pode levar vários minutos.', 'O Windows pode pedir permissão de administrador.'],
      confirmLabel: 'Verificar'
    });
    if (!confirmed) return;
    setButtonBusy(repairButton, true, 'Verificando…');
    setText('repair-status', 'Verificação em andamento');
    setAppStatus('Verificando arquivos do Windows');
    try {
      await desktopBridge.repairSystemFiles();
      setText('repair-status', 'Verificação concluída');
      showToast('O Windows concluiu a verificação SFC.');
      recordActivity('Verificação SFC', 'concluída');
    } catch (error) {
      setText('repair-status', 'Não concluída');
      showToast(error.message || 'O Windows não concluiu a verificação.');
    } finally {
      setButtonBusy(repairButton, false);
      setAppStatus('Monitoramento ativo');
    }
  }

  select.addEventListener('change', hydrate);
  optimizeButton.addEventListener('click', optimizeDrive);
  repairButton.addEventListener('click', runRepair);
  optimizeButton.disabled = true;
  Nexo.on('snapshot', syncOptions);
})();
