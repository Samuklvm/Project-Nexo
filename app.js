const viewButtons = document.querySelectorAll('.nav-item');
const panelMap = document.querySelectorAll('[data-view-panel]');
const toast = document.getElementById('toast');
const breadcrumbCurrent = document.getElementById('breadcrumb-current');
const appStatusLabel = document.getElementById('app-status-label');
const wallpaperInput = document.getElementById('wallpaper-file');
const chooseWallpaperButton = document.getElementById('choose-wallpaper');
const resetWallpaperButton = document.getElementById('reset-wallpaper');
const updateButton = document.getElementById('update-app');
const driveSelect = document.getElementById('drive-select');
const driveOptimizeButton = document.getElementById('drive-optimize');
const diagnosisResult = document.getElementById('diagnosis-result');
const runDiagnosisButton = document.getElementById('run-diagnosis');
const runCleanupButton = document.getElementById('run-cleanup');
const runRepairButton = document.getElementById('run-repair');
const activityList = document.querySelector('.activity-list');
const desktopBridge = window.nexoDesktop;

const defaultWallpaper = './assets/default-wallpaper.svg';
const wallpaperStorageKey = 'nexo-wallpaper';
let systemSnapshot = null;
let toastTimeout;

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 3000);
}

function setAppStatus(message) {
  if (appStatusLabel) appStatusLabel.textContent = message;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.idleText;
}

function setView(viewName) {
  viewButtons.forEach((button) => {
    const active = button.dataset.view === viewName;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });

  panelMap.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.viewPanel === viewName);
  });

  const labelMap = {
    overview: 'Visão geral',
    diagnosis: 'Diagnóstico',
    cleanup: 'Limpeza',
    repairs: 'Reparos',
    drives: 'Unidades',
    activity: 'Atividade'
  };
  if (breadcrumbCurrent) breadcrumbCurrent.textContent = labelMap[viewName] || 'Visão geral';
}

viewButtons.forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getSelectedDrive() {
  return systemSnapshot?.drives?.find((drive) => drive.driveLetter === driveSelect.value) || null;
}

function hydrateDriveView(driveLetter = driveSelect.value) {
  const drive = systemSnapshot?.drives?.find((item) => item.driveLetter === driveLetter);
  if (!drive) {
    setText('drive-type', 'Unidade local');
    setText('drive-model', 'Nenhuma unidade disponível');
    setText('drive-temp', 'Não medida');
    setText('drive-format', '--');
    setText('drive-state', 'Indisponível');
    setText('drive-used-capacity', '--');
    setText('drive-total-capacity', '--');
    setText('drive-used-label', '-- usados');
    setText('drive-free-label', '-- livres');
    document.getElementById('drive-capacity-bar').style.width = '0%';
    driveOptimizeButton.disabled = true;
    return;
  }

  setText('drive-type', 'Unidade local');
  setText('drive-model', drive.name);
  setText('drive-temp', 'Não medida');
  setText('drive-format', drive.fileSystem);
  setText('drive-state', drive.usedPercent >= 95 ? 'Pouco espaço livre' : 'Leitura concluída');
  setText('drive-used-capacity', formatBytes(drive.usedBytes));
  setText('drive-total-capacity', formatBytes(drive.sizeBytes));
  setText('drive-used-label', `${formatBytes(drive.usedBytes)} usados`);
  setText('drive-free-label', `${formatBytes(drive.freeBytes)} livres`);
  setText('drive-operation-title', 'Otimização do Windows');
  setText('drive-operation-description', 'O Windows seleciona a operação adequada para o tipo de unidade.');
  setText('drive-method', 'Otimizar');
  document.getElementById('drive-capacity-bar').style.width = `${drive.usedPercent}%`;
  driveOptimizeButton.disabled = false;
}

function renderSystemSnapshot(snapshot) {
  systemSnapshot = snapshot;
  const primaryDrive = snapshot.primaryDrive;
  const cpuText = `${snapshot.cpuUsage}%`;
  const memoryText = `${snapshot.memoryPercent}%`;
  const diskText = primaryDrive ? `${primaryDrive.usedPercent}%` : '--';

  setText('computer-name', snapshot.hostname);
  setText('app-version', snapshot.version);
  setText('cpu-usage-value', cpuText);
  setText('cpu-usage-state', 'Uso atual');
  setText('memory-usage-value', memoryText);
  setText('memory-usage-state', `${formatBytes(snapshot.memoryUsedBytes)} de ${formatBytes(snapshot.memoryTotalBytes)}`);
  setText('disk-usage-value', diskText);
  setText('disk-usage-state', primaryDrive ? `${primaryDrive.driveLetter}: unidade principal` : 'Sem dados de unidade');
  setText('overview-cpu', cpuText);
  setText('overview-memory', memoryText);
  setText('overview-disk', primaryDrive ? `${diskText} usado` : '--');
  setText('overview-network', snapshot.networkConnected ? 'Conectada' : 'Desconectada');
  setText('diagnosis-cpu', cpuText);
  setText('diagnosis-memory', memoryText);
  setText('diagnosis-disk', primaryDrive ? `${diskText} usado` : 'Sem dados');
  setText('diagnosis-network', snapshot.networkConnected ? 'Conectada' : 'Desconectada');
  setText('system-health-badge', snapshot.cpuUsage >= 90 || snapshot.memoryPercent >= 95 || (primaryDrive && primaryDrive.usedPercent >= 95)
    ? 'Uso elevado detectado'
    : 'Medições atualizadas');

  if (!snapshot.drives.some((drive) => drive.driveLetter === driveSelect.value)) {
    driveSelect.replaceChildren();
    for (const drive of snapshot.drives) {
      const option = document.createElement('option');
      option.value = drive.driveLetter;
      option.textContent = drive.name;
      driveSelect.append(option);
    }
  }
  hydrateDriveView(driveSelect.value);
}

function recordActivity(title, detail) {
  if (!activityList) return;
  const item = document.createElement('li');
  const label = document.createElement('span');
  const time = document.createElement('strong');
  label.textContent = title;
  time.textContent = `${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${detail}`;
  item.append(label, time);
  activityList.prepend(item);
  while (activityList.children.length > 20) activityList.lastElementChild.remove();
}

async function refreshSystemSnapshot() {
  if (!desktopBridge?.getSystemSnapshot) {
    setAppStatus('Abra o app desktop para monitorar');
    return null;
  }
  const snapshot = await desktopBridge.getSystemSnapshot();
  renderSystemSnapshot(snapshot);
  setAppStatus('Monitoramento ativo');
  return snapshot;
}

async function refreshCleanupPreview() {
  if (!desktopBridge?.getCleanupPreview) {
    setText('cleanup-preview', 'Disponível no app desktop');
    setText('cleanup-file-count', '--');
    setText('cleanup-size', '--');
    return null;
  }

  const preview = await desktopBridge.getCleanupPreview();
  setText('cleanup-preview', `${preview.fileCount} arquivos · ${formatBytes(preview.bytes)}`);
  setText('cleanup-file-count', `${preview.fileCount} arquivos`);
  setText('cleanup-size', formatBytes(preview.bytes));
  return preview;
}

driveSelect.addEventListener('change', (event) => hydrateDriveView(event.target.value));
driveOptimizeButton.disabled = true;

async function optimizeSelectedDrive() {
  const selectedDrive = getSelectedDrive();
  if (!selectedDrive || !desktopBridge?.optimizeDrive) return;
  const confirmed = window.confirm(`O Windows vai otimizar a unidade ${selectedDrive.driveLetter}: usando a ferramenta nativa. O Windows poderá solicitar permissão de administrador. Continuar?`);
  if (!confirmed) return;

  setButtonBusy(driveOptimizeButton, true, 'Otimizando...');
  setAppStatus(`Otimizando ${selectedDrive.driveLetter}:`);
  try {
    await desktopBridge.optimizeDrive(selectedDrive.driveLetter);
    setAppStatus('Otimização concluída');
    showToast(`O Windows concluiu a otimização de ${selectedDrive.driveLetter}:.`);
    recordActivity('Otimização de unidade', `${selectedDrive.driveLetter}:`);
    await refreshSystemSnapshot();
  } catch (error) {
    setAppStatus('Otimização não concluída');
    showToast(error.message || 'Não foi possível otimizar a unidade.');
  } finally {
    setButtonBusy(driveOptimizeButton, false);
  }
}

driveOptimizeButton.addEventListener('click', optimizeSelectedDrive);

function applyWallpaper(file) {
  if (!file) return;
  const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!acceptedTypes.includes(file.type)) {
    showToast('Use uma imagem PNG, JPEG ou WebP.');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const imageData = reader.result;
    document.documentElement.style.setProperty('--wallpaper-image', `url("${imageData}")`);
    localStorage.setItem(wallpaperStorageKey, imageData);
    resetWallpaperButton.hidden = false;
    showToast('Wallpaper atualizado.');
  };
  reader.readAsDataURL(file);
}

function restoreDefaultWallpaper() {
  document.documentElement.style.setProperty('--wallpaper-image', defaultWallpaper);
  localStorage.removeItem(wallpaperStorageKey);
  resetWallpaperButton.hidden = true;
  showToast('Fundo padrão restaurado.');
}

chooseWallpaperButton.addEventListener('click', () => wallpaperInput.click());
resetWallpaperButton.addEventListener('click', restoreDefaultWallpaper);
wallpaperInput.addEventListener('change', (event) => {
  const [file] = event.target.files || [];
  if (file) applyWallpaper(file);
  event.target.value = '';
});

const savedWallpaper = localStorage.getItem(wallpaperStorageKey);
if (savedWallpaper) {
  document.documentElement.style.setProperty('--wallpaper-image', `url("${savedWallpaper}")`);
  resetWallpaperButton.hidden = false;
}

async function runDiagnosis() {
  if (!desktopBridge?.getSystemSnapshot) {
    diagnosisResult.textContent = 'O diagnóstico real está disponível no aplicativo desktop.';
    return;
  }

  setButtonBusy(runDiagnosisButton, true, 'Analisando...');
  setAppStatus('Analisando o sistema');
  try {
    const snapshot = await refreshSystemSnapshot();
    const findings = [];
    if (snapshot.cpuUsage >= 90) findings.push(`CPU em uso elevado (${snapshot.cpuUsage}%)`);
    if (snapshot.memoryPercent >= 90) findings.push(`memória em uso elevado (${snapshot.memoryPercent}%)`);
    if (snapshot.primaryDrive?.usedPercent >= 95) findings.push(`pouco espaço livre em ${snapshot.primaryDrive.driveLetter}:`);
    diagnosisResult.textContent = findings.length
      ? `Atenção: ${findings.join('; ')}. Esses indicadores são leituras instantâneas.`
      : 'Leitura concluída: CPU, memória, interface de rede e espaço em disco sem uso elevado neste momento.';
    setAppStatus('Diagnóstico concluído');
    showToast('Leitura do sistema concluída.');
    recordActivity('Diagnóstico do sistema', findings.length ? `${findings.length} alerta(s)` : 'sem uso elevado');
  } catch (error) {
    diagnosisResult.textContent = error.message || 'Não foi possível obter as informações do sistema.';
    setAppStatus('Diagnóstico indisponível');
    showToast('Falha ao ler o sistema.');
  } finally {
    setButtonBusy(runDiagnosisButton, false);
  }
}

runDiagnosisButton.addEventListener('click', runDiagnosis);

async function runCleanup() {
  if (!desktopBridge?.getCleanupPreview || !desktopBridge?.cleanupTempFiles) {
    showToast('A limpeza está disponível no aplicativo desktop.');
    return;
  }

  setButtonBusy(runCleanupButton, true, 'Verificando...');
  try {
    const preview = await refreshCleanupPreview();
    if (!preview?.fileCount) {
      showToast('Nenhum arquivo temporário antigo encontrado.');
      return;
    }

    const confirmed = window.confirm(`Foram encontrados ${preview.fileCount} arquivos temporários com mais de 7 dias (${formatBytes(preview.bytes)}). Somente arquivos no diretório temporário do usuário serão removidos. Continuar?`);
    if (!confirmed) return;

    setButtonBusy(runCleanupButton, true, 'Limpando...');
    setAppStatus('Limpando temporários');
    const result = await desktopBridge.cleanupTempFiles();
    showToast(`${result.removedCount} arquivos removidos; ${formatBytes(result.bytesFreed)} liberados.`);
    setAppStatus('Limpeza concluída');
    recordActivity('Limpeza de temporários', `${result.removedCount} arquivos`);
    await refreshCleanupPreview();
  } catch (error) {
    setAppStatus('Limpeza não concluída');
    showToast(error.message || 'Não foi possível limpar os temporários.');
  } finally {
    setButtonBusy(runCleanupButton, false);
  }
}

runCleanupButton.addEventListener('click', runCleanup);

async function runRepair() {
  if (!desktopBridge?.repairSystemFiles) {
    showToast('A verificação SFC está disponível no aplicativo desktop.');
    return;
  }

  const confirmed = window.confirm('O Windows executará sfc /scannow para verificar arquivos protegidos do sistema. Esta análise pode levar bastante tempo e solicitar permissão de administrador. Deseja continuar?');
  if (!confirmed) return;

  setButtonBusy(runRepairButton, true, 'Verificando...');
  setText('repair-status', 'Verificação em andamento');
  setAppStatus('Verificando arquivos do Windows');
  try {
    await desktopBridge.repairSystemFiles();
    setText('repair-status', 'Verificação concluída');
    setAppStatus('Verificação concluída');
    showToast('O Windows concluiu a verificação SFC.');
    recordActivity('Verificação SFC', 'concluída');
  } catch (error) {
    setText('repair-status', 'Não concluída');
    setAppStatus('Verificação não concluída');
    showToast(error.message || 'O Windows não concluiu a verificação.');
  } finally {
    setButtonBusy(runRepairButton, false);
  }
}

runRepairButton.addEventListener('click', runRepair);

function renderUpdateStatus(status) {
  const messages = {
    checking: 'Verificando atualizações',
    downloading: status.percent === undefined ? 'Baixando atualização' : `Baixando atualização · ${status.percent}%`,
    current: 'App atualizado',
    downloaded: `Versão ${status.version || ''} pronta para instalar`.trim(),
    development: 'Atualização disponível na versão instalada',
    error: 'Falha ao verificar atualização'
  };
  setText('update-status', messages[status.state] || 'Status de atualização desconhecido');
  if (status.state === 'downloaded') {
    updateButton.hidden = false;
    updateButton.querySelector('span:last-child').textContent = 'Instalar atualização';
  }
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
  if (!desktopBridge?.installUpdate) return;
  try {
    await desktopBridge.installUpdate();
  } catch (error) {
    showToast(error.message || 'Não foi possível instalar a atualização.');
  }
});

document.querySelectorAll('[data-scan="diagnosis"]').forEach((button) => {
  button.addEventListener('click', runDiagnosis);
});
document.querySelectorAll('[data-scan="cleanup"]').forEach((button) => {
  button.addEventListener('click', runCleanup);
});

setView('overview');
refreshSystemSnapshot().catch((error) => {
  setAppStatus('Falha ao ler o sistema');
  showToast(error.message || 'Não foi possível ler o sistema.');
});
refreshCleanupPreview().catch(() => {
  setText('cleanup-preview', 'Não foi possível calcular');
  setText('cleanup-file-count', '--');
  setText('cleanup-size', '--');
});
checkForUpdates();
setInterval(() => {
  refreshSystemSnapshot().catch(() => setAppStatus('Falha ao atualizar leitura'));
}, 15000);