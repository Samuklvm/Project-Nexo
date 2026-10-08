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
const autoCleanToggle = document.getElementById('auto-clean-toggle');
const desktopBridge = window.nexoDesktop;

const defaultWallpaper = './assets/default-wallpaper.svg';
const wallpaperStorageKey = 'nexo-wallpaper';
const activityStorageKey = 'nexo-activity';
const autoCleanPreferenceKey = 'nexo-auto-clean';
const autoCleanLastRunKey = 'nexo-auto-clean-last-run';
const performanceHistoryKey = 'nexo-performance-history';
const recommendationFeedbackKey = 'nexo-recommendation-feedback';
const maxWallpaperBytes = 5 * 1024 * 1024;
const historyIntervalMs = 15 * 60 * 1000;
const historyRetentionMs = 7 * 24 * 60 * 60 * 1000;
const maxHistorySamples = 672;
const autoCleanDiskThreshold = 90;
const autoCleanRequiredSamples = 4;
const autoCleanMinimumPersistenceMs = 60 * 1000;
const autoCleanCooldownMs = 60 * 60 * 1000;
let systemSnapshot = null;
let toastTimeout;
let highDiskSamples = 0;
let highDiskSince = 0;
let cleanupOperationInProgress = false;
let performanceHistory = null;
let autoCleanupEnabled = getLocalStorageValue(autoCleanPreferenceKey) === 'true';

function getLocalStorageValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

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

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function getPerformanceHistory() {
  if (performanceHistory) return performanceHistory;
  const cutoff = Date.now() - historyRetentionMs;
  performanceHistory = readStoredArray(performanceHistoryKey)
    .filter((sample) => sample && Number.isFinite(sample.timestamp) && sample.timestamp >= cutoff)
    .slice(-maxHistorySamples);
  return performanceHistory;
}

function recordPerformanceSample(snapshot) {
  const samples = getPerformanceHistory();
  const now = Date.now();
  if (samples.length && now - samples[samples.length - 1].timestamp < historyIntervalMs) return;

  samples.push({
    timestamp: now,
    cpuPercent: snapshot.cpuUsage,
    memoryPercent: snapshot.memoryPercent,
    diskPercent: snapshot.primaryDrive?.usedPercent ?? null
  });
  performanceHistory = samples
    .filter((sample) => sample.timestamp >= now - historyRetentionMs)
    .slice(-maxHistorySamples);
  try {
    localStorage.setItem(performanceHistoryKey, JSON.stringify(performanceHistory));
    refreshLearningStatus();
  } catch {
    setText('diagnosis-learning-status', 'O histórico local não pôde ser salvo; o diagnóstico atual continua disponível.');
  }
}

function getLocalBaseline(metric) {
  const baselineCutoff = Date.now() - 60 * 1000;
  const samples = getPerformanceHistory()
    .filter((sample) => sample.timestamp < baselineCutoff)
    .map((sample) => sample[metric])
    .filter(Number.isFinite);
  if (samples.length < 4) return null;
  return {
    average: samples.reduce((total, value) => total + value, 0) / samples.length,
    sampleCount: samples.length
  };
}

function describeLocalTrend(metric, currentValue) {
  const baseline = getLocalBaseline(metric);
  if (!baseline) return 'Ainda há poucos registros locais para comparar com o padrão habitual.';
  const delta = Math.round(currentValue - baseline.average);
  if (delta >= 10) return `${delta} pontos acima da média local de 7 dias (${Math.round(baseline.average)}%, ${baseline.sampleCount} amostras).`;
  return `Média local de 7 dias: ${Math.round(baseline.average)}% (${baseline.sampleCount} amostras); sem aumento grande sobre o padrão.`;
}

function getRecommendationConfidence(category, baseConfidence) {
  const feedback = readStoredArray(recommendationFeedbackKey)
    .filter((entry) => entry?.category === category && typeof entry.helpful === 'boolean')
    .slice(-30);
  if (feedback.length < 3) return { confidence: baseConfidence, feedbackCount: feedback.length };
  const helpfulCount = feedback.filter((entry) => entry.helpful).length;
  const learnedRate = (helpfulCount + 1) / (feedback.length + 2);
  return {
    confidence: Math.round(baseConfidence * 0.7 + learnedRate * 100 * 0.3),
    feedbackCount: feedback.length
  };
}

function recordRecommendationFeedback(category, helpful) {
  const feedback = readStoredArray(recommendationFeedbackKey);
  feedback.push({ category, helpful, timestamp: Date.now() });
  try {
    localStorage.setItem(recommendationFeedbackKey, JSON.stringify(feedback.slice(-100)));
    refreshLearningStatus();
    showToast('Feedback salvo apenas neste computador.');
  } catch {
    showToast('Não foi possível salvar o feedback local.');
  }
}

function refreshLearningStatus() {
  const sampleCount = getPerformanceHistory().length;
  const feedbackCount = readStoredArray(recommendationFeedbackKey).length;
  setText('diagnosis-learning-status', `${sampleCount} amostras locais e ${feedbackCount} avaliações. Os dados não saem deste computador.`);
}

function renderDiagnosisRecommendations(recommendations, emptyMessage) {
  diagnosisResult.replaceChildren();
  if (!recommendations.length) {
    const message = document.createElement('p');
    message.textContent = emptyMessage;
    diagnosisResult.append(message);
    return;
  }

  const list = document.createElement('div');
  list.className = 'recommendation-list';
  for (const recommendation of recommendations) {
    const card = document.createElement('article');
    card.className = 'recommendation-item';
    const heading = document.createElement('div');
    heading.className = 'recommendation-heading';
    const title = document.createElement('strong');
    const confidenceLabel = document.createElement('span');
    title.textContent = recommendation.title;
    const learned = getRecommendationConfidence(recommendation.category, recommendation.confidence);
    confidenceLabel.className = 'recommendation-confidence';
    confidenceLabel.textContent = `Confiança heurística ${learned.confidence}% · ${learned.feedbackCount ? `${learned.feedbackCount} avaliações locais` : 'estimativa inicial'}`;
    heading.append(title, confidenceLabel);

    const cause = document.createElement('p');
    cause.textContent = `Sinal: ${recommendation.cause}`;
    const action = document.createElement('p');
    action.textContent = `Próximo passo: ${recommendation.action}`;
    card.append(heading, cause, action);

    const controls = document.createElement('div');
    controls.className = 'recommendation-feedback';
    if (recommendation.actionType) {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'button-small';
      actionButton.textContent = recommendation.actionLabel;
      actionButton.addEventListener('click', async () => {
        if (recommendation.actionType === 'cleanup') await runCleanup();
        if (recommendation.actionType === 'task-manager' && desktopBridge?.openTaskManager) {
          try {
            await desktopBridge.openTaskManager();
          } catch (error) {
            showToast(error.message || 'Não foi possível abrir o Gerenciador de Tarefas.');
          }
        }
      });
      controls.append(actionButton);
    }

    const feedbackLabel = document.createElement('span');
    feedbackLabel.textContent = 'Essa sugestão ajudou?';
    controls.append(feedbackLabel);
    for (const [label, helpful] of [['Sim', true], ['Não', false]]) {
      const feedbackButton = document.createElement('button');
      feedbackButton.type = 'button';
      feedbackButton.className = 'button-small';
      feedbackButton.textContent = label;
      feedbackButton.addEventListener('click', () => {
        for (const button of controls.querySelectorAll('[data-learning-feedback]')) button.disabled = true;
        recordRecommendationFeedback(recommendation.category, helpful);
      });
      feedbackButton.dataset.learningFeedback = 'true';
      controls.append(feedbackButton);
    }
    card.append(controls);
    list.append(card);
  }
  diagnosisResult.append(list);
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
  const entry = { title, detail, timestamp: Date.now() };
  let entries = [];
  try {
    const storedEntries = JSON.parse(localStorage.getItem(activityStorageKey) || '[]');
    if (Array.isArray(storedEntries)) entries = storedEntries;
  } catch {
    entries = [];
  }
  entries = [entry, ...entries].slice(0, 20);
  try {
    localStorage.setItem(activityStorageKey, JSON.stringify(entries));
  } catch {
    showToast('Atividade registrada apenas nesta sessão.');
  }
  activityList.prepend(createActivityItem(entry));
  while (activityList.children.length > 20) activityList.lastElementChild.remove();
}

function createActivityItem(entry) {
  const item = document.createElement('li');
  const label = document.createElement('span');
  const time = document.createElement('strong');
  label.textContent = String(entry.title || 'Atividade');
  time.textContent = `${new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${String(entry.detail || '')}`;
  item.append(label, time);
  return item;
}

function restoreActivity() {
  if (!activityList) return;
  try {
    const entries = JSON.parse(localStorage.getItem(activityStorageKey) || '[]');
    if (!Array.isArray(entries)) return;
    const validEntries = entries.filter((entry) =>
      entry && typeof entry.title === 'string' && typeof entry.detail === 'string' && Number.isFinite(entry.timestamp)
    ).slice(0, 20);
    activityList.replaceChildren(...validEntries.map(createActivityItem));
  } catch {
    activityList.replaceChildren();
  }
}

async function refreshSystemSnapshot() {
  if (!desktopBridge?.getSystemSnapshot) {
    setAppStatus('Abra o app desktop para monitorar');
    return null;
  }
  const snapshot = await desktopBridge.getSystemSnapshot();
  renderSystemSnapshot(snapshot);
  recordPerformanceSample(snapshot);
  setAppStatus('Monitoramento ativo');
  await maybeRunAutonomousCleanup(snapshot);
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

async function maybeRunAutonomousCleanup(snapshot) {
  if (!autoCleanupEnabled || cleanupOperationInProgress) return;
  if (!snapshot.primaryDrive || snapshot.primaryDrive.usedPercent < autoCleanDiskThreshold) {
    highDiskSamples = 0;
    highDiskSince = 0;
    return;
  }

  if (!highDiskSamples) highDiskSince = Date.now();
  highDiskSamples += 1;
  if (highDiskSamples < autoCleanRequiredSamples || Date.now() - highDiskSince < autoCleanMinimumPersistenceMs) return;

  let lastRun = 0;
  try {
    lastRun = Number(localStorage.getItem(autoCleanLastRunKey)) || 0;
  } catch {
    lastRun = 0;
  }
  if (Date.now() - lastRun < autoCleanCooldownMs) {
    highDiskSamples = 0;
    highDiskSince = 0;
    return;
  }

  cleanupOperationInProgress = true;
  highDiskSamples = 0;
  highDiskSince = 0;
  try {
    const preview = await desktopBridge.getCleanupPreview();
    if (!preview.fileCount) {
      markCleanupRun();
      return;
    }

    const result = await desktopBridge.cleanupTempFiles();
    markCleanupRun();
    if (result.removedCount > 0) {
      const message = `Limpeza automática: ${result.removedCount} temporários removidos; ${formatBytes(result.bytesFreed)} liberados.`;
      showToast(message);
      setAppStatus('Limpeza automática concluída');
      recordActivity('Limpeza automática', `${result.removedCount} arquivos`);
    }
  } catch (error) {
    showToast(error.message || 'A limpeza automática não pôde ser concluída.');
  } finally {
    cleanupOperationInProgress = false;
  }
}

function markCleanupRun() {
  highDiskSamples = 0;
  highDiskSince = 0;
  try {
    localStorage.setItem(autoCleanLastRunKey, String(Date.now()));
  } catch {
    return;
  }
}

autoCleanToggle.checked = autoCleanupEnabled;
autoCleanToggle.addEventListener('change', () => {
  if (autoCleanToggle.checked) {
    const confirmed = window.confirm('O app só fará a limpeza após quatro leituras consecutivas com o disco principal acima de 90%. Ele removerá até 5.000 arquivos regulares diretamente no diretório temporário, com mais de 7 dias, no máximo uma vez por hora. Não fechará programas nem alterará configurações do Windows. Ativar?');
    if (!confirmed) {
      autoCleanToggle.checked = false;
      return;
    }
  }

  autoCleanupEnabled = autoCleanToggle.checked;
  highDiskSamples = 0;
  highDiskSince = 0;
  try {
    localStorage.setItem(autoCleanPreferenceKey, String(autoCleanupEnabled));
  } catch {
    autoCleanupEnabled = false;
    autoCleanToggle.checked = false;
    showToast('Não foi possível salvar a preferência de automação.');
    return;
  }
  showToast(autoCleanupEnabled ? 'Limpeza automática ativada.' : 'Limpeza automática desativada.');
});

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
    driveOptimizeButton.disabled = !getSelectedDrive();
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
  if (file.size > maxWallpaperBytes) {
    showToast('Escolha uma imagem de até 5 MB.');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const imageData = reader.result;
    try {
      localStorage.setItem(wallpaperStorageKey, imageData);
      document.documentElement.style.setProperty('--wallpaper-image', `url("${imageData}")`);
      resetWallpaperButton.hidden = false;
      showToast('Wallpaper atualizado.');
    } catch {
      showToast('Não foi possível armazenar essa imagem.');
    }
  };
  reader.onerror = () => showToast('Não foi possível ler essa imagem.');
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

const savedWallpaper = getLocalStorageValue(wallpaperStorageKey);
if (savedWallpaper) {
  document.documentElement.style.setProperty('--wallpaper-image', `url("${savedWallpaper}")`);
  resetWallpaperButton.hidden = false;
}

async function runDiagnosis() {
  if (!desktopBridge?.getSystemSnapshot) {
    renderDiagnosisRecommendations([], 'O diagnóstico real está disponível no aplicativo desktop.');
    return;
  }

  setButtonBusy(runDiagnosisButton, true, 'Analisando...');
  setAppStatus('Analisando o sistema');
  try {
    const processSample = desktopBridge.getTopProcesses
      ? desktopBridge.getTopProcesses().catch(() => null)
      : Promise.resolve(null);
    const [snapshot, sampledProcesses] = await Promise.all([refreshSystemSnapshot(), processSample]);
    const processes = sampledProcesses || { byCpu: [], byMemory: [] };
    const recommendations = [];
    const cpuLeader = processes.byCpu?.[0];
    const memoryLeader = processes.byMemory?.[0];
    const cpuBaseline = getLocalBaseline('cpuPercent');
    const memoryBaseline = getLocalBaseline('memoryPercent');
    const cpuSpike = cpuBaseline && snapshot.cpuUsage >= 60 && snapshot.cpuUsage - cpuBaseline.average >= 25;
    const memorySpike = memoryBaseline && snapshot.memoryPercent >= 70 && snapshot.memoryPercent - memoryBaseline.average >= 20;

    if (snapshot.cpuUsage >= 85 || cpuSpike) {
      recommendations.push({
        category: 'cpu',
        title: 'Uso elevado de CPU',
        cause: cpuLeader && cpuLeader.cpuPercent >= 5
          ? `${cpuLeader.name} (PID ${cpuLeader.processId}) liderou a amostra com ${cpuLeader.cpuPercent}%. ${describeLocalTrend('cpuPercent', snapshot.cpuUsage)}`
          : `Uso total em ${snapshot.cpuUsage}%; ${sampledProcesses ? 'nenhum processo dominou a amostra' : 'não foi possível medir os processos'}. ${describeLocalTrend('cpuPercent', snapshot.cpuUsage)}`,
        action: 'Revise o processo e encerre-o somente se reconhecer o programa e puder interromper o trabalho.',
        actionType: cpuLeader ? 'task-manager' : null,
        actionLabel: 'Ver processos',
        confidence: cpuLeader && cpuLeader.cpuPercent >= 5 ? (cpuSpike ? 82 : 70) : cpuSpike ? 60 : 45
      });
    }
    if (snapshot.memoryPercent >= 85 || memorySpike) {
      recommendations.push({
        category: 'memory',
        title: 'Pressão de memória',
        cause: memoryLeader
          ? `${memoryLeader.name} (PID ${memoryLeader.processId}) usa ${formatBytes(memoryLeader.memoryBytes)}. RAM total em ${snapshot.memoryPercent}%. ${describeLocalTrend('memoryPercent', snapshot.memoryPercent)}`
          : `RAM em ${snapshot.memoryPercent}%; ${sampledProcesses ? 'revise os programas abertos' : 'não foi possível atribuir o consumo a um processo'}. ${describeLocalTrend('memoryPercent', snapshot.memoryPercent)}`,
        action: 'Verifique se o processo está trabalhando antes de fechá-lo; o app não encerra processos por segurança.',
        actionType: memoryLeader ? 'task-manager' : null,
        actionLabel: 'Ver processos',
        confidence: memoryLeader ? (memorySpike ? 78 : 65) : memorySpike ? 55 : 40
      });
    }
    if (snapshot.primaryDrive?.usedPercent >= autoCleanDiskThreshold) {
      let preview = null;
      try {
        preview = await desktopBridge.getCleanupPreview();
      } catch {
        preview = null;
      }
      recommendations.push({
        category: 'disk',
        title: 'Pouco espaço livre',
        cause: `Unidade ${snapshot.primaryDrive.driveLetter}: com ${snapshot.primaryDrive.usedPercent}% ocupado. ${preview ? `${preview.fileCount} temporários antigos somam ${formatBytes(preview.bytes)}.` : 'Não foi possível calcular os temporários disponíveis.'}`,
        action: preview?.fileCount
          ? `${autoCleanupEnabled ? 'A limpeza automática está ativa.' : 'Revise a prévia e confirme a limpeza.'} Outros arquivos grandes devem ser revisados manualmente.`
          : 'Revise arquivos pessoais grandes; nenhum temporário elegível foi encontrado.',
        actionType: preview?.fileCount ? 'cleanup' : null,
        actionLabel: 'Limpar temporários',
        confidence: preview?.fileCount ? 75 : 55
      });
    }

    renderDiagnosisRecommendations(recommendations, 'Nenhum gargalo acima dos limites foi detectado nesta amostra. O diagnóstico consulta CPU, RAM, processos, conectividade e espaço em disco.');
    setAppStatus('Diagnóstico concluído');
    showToast(recommendations.length ? 'Recomendações de desempenho prontas.' : 'Nenhum gargalo relevante detectado.');
    recordActivity('Diagnóstico de desempenho', recommendations.length ? `${recommendations.length} recomendação(ões)` : 'sem gargalo detectado');
  } catch (error) {
    renderDiagnosisRecommendations([], error.message || 'Não foi possível obter as informações do sistema.');
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
  if (cleanupOperationInProgress) return;

  cleanupOperationInProgress = true;
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
    markCleanupRun();
    showToast(`${result.removedCount} arquivos removidos; ${formatBytes(result.bytesFreed)} liberados.`);
    setAppStatus('Limpeza concluída');
    recordActivity('Limpeza de temporários', `${result.removedCount} arquivos`);
    await refreshCleanupPreview();
  } catch (error) {
    setAppStatus('Limpeza não concluída');
    showToast(error.message || 'Não foi possível limpar os temporários.');
  } finally {
    cleanupOperationInProgress = false;
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
    development: 'Atualizações na versão instalada',
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

restoreActivity();
refreshLearningStatus();
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