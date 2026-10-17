const viewButtons = document.querySelectorAll('.nav-item');
const panelMap = document.querySelectorAll('[data-view-panel]');
const toast = document.getElementById('toast');
const viewTitle = document.getElementById('view-title');
const statusPill = document.getElementById('status-pill');
const appStatusLabel = document.getElementById('app-status-label');
const wallpaperInput = document.getElementById('wallpaper-file');
const chooseWallpaperButton = document.getElementById('choose-wallpaper');
const resetWallpaperButton = document.getElementById('reset-wallpaper');
const updateButton = document.getElementById('update-app');
const installUpdatePageButton = document.getElementById('install-update-page');
const downloadUpdateButton = document.getElementById('download-update');
const deferUpdateButton = document.getElementById('defer-update');
const updatePanel = document.getElementById('update-panel');
const checkUpdatesButton = document.getElementById('check-updates');
const windowMinimizeButton = document.getElementById('window-minimize');
const windowMaximizeButton = document.getElementById('window-maximize');
const windowCloseButton = document.getElementById('window-close');
const driveSelect = document.getElementById('drive-select');
const driveOptimizeButton = document.getElementById('drive-optimize');
const diagnosisResult = document.getElementById('diagnosis-result');
const runDiagnosisButton = document.getElementById('run-diagnosis');
const runCleanupButton = document.getElementById('run-cleanup');
const runRepairButton = document.getElementById('run-repair');
const activityFeed = document.getElementById('activity-feed');
const activityEmpty = document.getElementById('activity-empty');
const clearActivityButton = document.getElementById('clear-activity');
const verdictPrimary = document.getElementById('verdict-primary');
const verdictSecondary = document.getElementById('verdict-secondary');
const confirmDialog = document.getElementById('confirm-dialog');
const autoCleanToggle = document.getElementById('auto-clean-toggle');
const desktopBridge = window.nexoDesktop;
document.body.classList.toggle('desktop-app', Boolean(desktopBridge));

const wallpaperStorageKey = 'nexo-wallpaper';
const activityStorageKey = 'nexo-activity';
const autoCleanPreferenceKey = 'nexo-auto-clean';
const autoCleanLastRunKey = 'nexo-auto-clean-last-run';
const performanceHistoryKey = 'nexo-performance-history';
const recommendationFeedbackKey = 'nexo-recommendation-feedback';
const lastRunStorageKey = 'nexo-last-run';
const wallpaperLumaKey = 'nexo-wallpaper-luma';
const maxWallpaperBytes = 20 * 1024 * 1024;
const wallpaperMaxEdge = 2560;
const historyIntervalMs = 5 * 60 * 1000;
const historyRetentionMs = 7 * 24 * 60 * 60 * 1000;
const maxHistorySamples = 2016;
const autoCleanDiskThreshold = 90;
const autoCleanRequiredSamples = 4;
const autoCleanMinimumPersistenceMs = 60 * 1000;
const autoCleanCooldownMs = 60 * 60 * 1000;
const maxLivePerformanceSamples = 60;
let systemSnapshot = null;
let currentUpdateStatus = { state: 'checking' };
let snapshotPromise = null;
let lastVerdict = null;
let lastCleanupPreview = null;
let statusHoldUntil = 0;
let driveOptimizing = false;
let refreshTimer = 0;
const livePerformanceSamples = [];
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

function showToast(message, tone = 'info') {
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), tone === 'error' ? 6000 : 3500);
}

let activeTaskLabel = '';

function setAppStatus(message, busy = false) {
  if (appStatusLabel) appStatusLabel.textContent = message;
  if (statusPill) statusPill.dataset.busy = String(busy);
}

function beginTask(label) {
  activeTaskLabel = label;
  setAppStatus(label, true);
}

function endTask(message = 'Monitoramento ativo') {
  activeTaskLabel = '';
  statusHoldUntil = Date.now() + 6000;
  setAppStatus(message);
}

function setText(id, value) {
  const element = document.getElementById(id);
  const text = String(value);
  if (element && element.textContent !== text) element.textContent = text;
}

function setValue(id, value, unit = '') {
  const element = document.getElementById(id);
  if (!element) return;
  const signature = `${value}|${unit}`;
  if (element.dataset.signature === signature) return;
  element.dataset.signature = signature;
  element.replaceChildren(String(value));
  if (unit) {
    const unitElement = document.createElement('span');
    unitElement.className = 'unit';
    unitElement.textContent = unit;
    element.append(unitElement);
  }
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.idleText;
}

const viewLabels = {
  overview: 'Visão geral',
  diagnosis: 'Diagnóstico',
  maintenance: 'Manutenção',
  activity: 'Atividade',
  updates: 'Atualizações'
};
const viewOrder = Object.keys(viewLabels);

function setView(viewName) {
  const target = viewLabels[viewName] ? viewName : 'overview';
  viewButtons.forEach((button) => {
    const active = button.dataset.view === target;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  panelMap.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.viewPanel === target);
  });
  if (viewTitle) viewTitle.textContent = viewLabels[target];
  if (target === 'overview') drawMetricCharts();
}

viewButtons.forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.addEventListener('keydown', (event) => {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || confirmDialog?.open) return;
  const target = viewOrder[Number(event.key) - 1];
  if (!target) return;
  event.preventDefault();
  setView(target);
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
  const digits = unitIndex === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unitIndex]}`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${Math.max(1, minutes)} min`;
}

function formatDayLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatWhen(timestamp) {
  if (!Number.isFinite(timestamp)) return 'nunca';
  return `${formatDayLabel(timestamp).toLowerCase()} às ${formatClock(timestamp)}`;
}

function cleanError(error, fallback) {
  const raw = String(error?.message || error || '');
  const text = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '').trim();
  if (!text || /Command failed|powershell\.exe|Start-Process/i.test(text)) return fallback;
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

function readStoredObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function renderLastRuns() {
  const runs = readStoredObject(lastRunStorageKey);
  setText('cleanup-last-run', formatWhen(runs.cleanup));
  setText('repair-last-run', formatWhen(runs.repair));
  setText('drive-last-run', formatWhen(runs[`optimize:${driveSelect.value}`]));
}

function markLastRun(task) {
  const runs = readStoredObject(lastRunStorageKey);
  runs[task] = Date.now();
  saveStored(lastRunStorageKey, runs);
  renderLastRuns();
}

function confirmAction({ title, body, points = [], confirmLabel = 'Continuar', tone = 'primary' }) {
  if (!confirmDialog || typeof confirmDialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${body}`));
  }
  if (confirmDialog.open) return Promise.resolve(false);

  setText('confirm-title', title);
  setText('confirm-body', body);
  const pointList = document.getElementById('confirm-points');
  pointList.replaceChildren(...points.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  pointList.hidden = points.length === 0;
  const okButton = document.getElementById('confirm-ok');
  okButton.textContent = confirmLabel;
  okButton.className = tone === 'danger' ? 'button button-danger' : 'button';

  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  document.getElementById('confirm-cancel').focus();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true });
  });
}

confirmDialog?.addEventListener('click', (event) => {
  if (event.target === confirmDialog) confirmDialog.close('cancel');
});

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
  const sortedSamples = [...samples].sort((left, right) => left - right);
  const median = sortedSamples.length % 2
    ? sortedSamples[Math.floor(sortedSamples.length / 2)]
    : (sortedSamples[sortedSamples.length / 2 - 1] + sortedSamples[sortedSamples.length / 2]) / 2;
  const deviations = sortedSamples.map((value) => Math.abs(value - median)).sort((left, right) => left - right);
  const medianAbsoluteDeviation = deviations.length % 2
    ? deviations[Math.floor(deviations.length / 2)]
    : (deviations[deviations.length / 2 - 1] + deviations[deviations.length / 2]) / 2;
  return {
    average: samples.reduce((total, value) => total + value, 0) / samples.length,
    median,
    medianAbsoluteDeviation,
    sampleCount: samples.length
  };
}

function describeLocalTrend(metric, currentValue) {
  const baseline = getLocalBaseline(metric);
  if (!baseline) return 'Ainda há poucos registros locais para comparar com o padrão habitual.';
  const delta = Math.round(currentValue - baseline.median);
  if (delta >= 10) return `${delta} pontos acima da mediana local de 7 dias (${Math.round(baseline.median)}%, ${baseline.sampleCount} amostras).`;
  return `Mediana local de 7 dias: ${Math.round(baseline.median)}% (${baseline.sampleCount} amostras); sem aumento grande sobre o padrão.`;
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
    showToast('Não foi possível salvar o feedback local.', 'error');
  }
}

function refreshLearningStatus() {
  const sampleCount = getPerformanceHistory().length;
  const feedbackCount = readStoredArray(recommendationFeedbackKey).length;
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  setText('diagnosis-learning-status', `${plural(sampleCount, 'amostra local', 'amostras locais')} e ${plural(feedbackCount, 'avaliação', 'avaliações')}. Os dados não saem deste computador.`);
}

function renderDiagnosisRecommendations(recommendations, emptyMessage) {
  diagnosisResult.replaceChildren();
  if (!recommendations.length) {
    const message = document.createElement('p');
    message.className = 'empty-note';
    message.textContent = emptyMessage;
    diagnosisResult.append(message);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'findings';
  for (const recommendation of recommendations) {
    const item = document.createElement('li');
    item.className = 'finding';
    item.dataset.level = recommendation.severity || 'warn';

    const heading = document.createElement('div');
    heading.className = 'finding-head';
    const title = document.createElement('strong');
    title.textContent = recommendation.title;
    const confidenceLabel = document.createElement('span');
    const learned = getRecommendationConfidence(recommendation.category, recommendation.confidence);
    confidenceLabel.className = 'finding-confidence';
    confidenceLabel.textContent = `Confiança estimada ${learned.confidence}% (${learned.feedbackCount ? `${learned.feedbackCount} avaliações locais` : 'estimativa inicial'})`;
    heading.append(title, confidenceLabel);

    const cause = document.createElement('p');
    cause.textContent = `Sinal: ${recommendation.cause}`;
    const action = document.createElement('p');
    action.textContent = `Próximo passo: ${recommendation.action}`;
    item.append(heading, cause, action);

    const controls = document.createElement('div');
    controls.className = 'finding-controls';
    if (recommendation.actionType) {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'button button-small';
      actionButton.textContent = recommendation.actionLabel;
      actionButton.addEventListener('click', async () => {
        if (recommendation.actionType === 'cleanup') await runCleanup();
        if (recommendation.actionType === 'task-manager' && desktopBridge?.openTaskManager) {
          try {
            await desktopBridge.openTaskManager();
          } catch (error) {
            showToast(cleanError(error, 'Não foi possível abrir o Gerenciador de Tarefas.'), 'error');
          }
        }
      });
      controls.append(actionButton);
    }

    const feedbackLabel = document.createElement('span');
    feedbackLabel.className = 'feedback-label';
    feedbackLabel.textContent = 'Essa sugestão ajudou?';
    controls.append(feedbackLabel);
    for (const [label, helpful] of [['Sim', true], ['Não', false]]) {
      const feedbackButton = document.createElement('button');
      feedbackButton.type = 'button';
      feedbackButton.className = 'button button-quiet button-small';
      feedbackButton.textContent = label;
      feedbackButton.dataset.learningFeedback = 'true';
      feedbackButton.addEventListener('click', () => {
        for (const button of controls.querySelectorAll('[data-learning-feedback]')) button.disabled = true;
        recordRecommendationFeedback(recommendation.category, helpful);
      });
      controls.append(feedbackButton);
    }
    item.append(controls);
    list.append(item);
  }
  diagnosisResult.append(list);
}

function renderProcessLists(processes) {
  const container = document.getElementById('diagnosis-processes');
  if (!container) return;
  container.replaceChildren();
  const groups = [
    {
      title: 'Mais usam CPU',
      items: processes?.byCpu || [],
      measure: (item) => item.cpuPercent,
      label: (item) => `${item.cpuPercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    },
    {
      title: 'Mais usam memória',
      items: processes?.byMemory || [],
      measure: (item) => item.memoryBytes,
      label: (item) => formatBytes(item.memoryBytes)
    }
  ].filter((group) => group.items.length);

  for (const group of groups) {
    const box = document.createElement('section');
    box.className = 'proc-list';
    const heading = document.createElement('h3');
    heading.textContent = group.title;
    box.append(heading);
    const peak = Math.max(...group.items.map(group.measure), 0);
    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'proc';
      const name = document.createElement('span');
      name.className = 'proc-name';
      name.textContent = item.name;
      const pid = document.createElement('small');
      pid.textContent = `PID ${item.processId}`;
      name.append(pid);
      const value = document.createElement('span');
      value.className = 'proc-value';
      value.textContent = group.label(item);
      const bar = document.createElement('div');
      bar.className = 'proc-bar';
      const fill = document.createElement('span');
      fill.style.width = `${peak ? Math.max(2, Math.round((group.measure(item) / peak) * 100)) : 0}%`;
      bar.append(fill);
      row.append(name, value, bar);
      box.append(row);
    }
    container.append(box);
  }
}

function getSelectedDrive() {
  return systemSnapshot?.drives?.find((drive) => drive.driveLetter === driveSelect.value) || null;
}

function hydrateDriveView(driveLetter = driveSelect.value) {
  const drive = systemSnapshot?.drives?.find((item) => item.driveLetter === driveLetter);
  const bar = document.getElementById('drive-capacity-bar');
  const track = document.getElementById('drive-capacity');
  if (!drive) {
    setText('drive-summary', 'Nenhuma unidade disponível.');
    if (bar) bar.style.width = '0%';
    if (track) {
      track.dataset.level = 'idle';
      track.setAttribute('aria-valuenow', '0');
    }
    driveOptimizeButton.disabled = true;
    renderLastRuns();
    return;
  }

  setText('drive-summary', `${drive.usedPercent}% usado, ${formatBytes(drive.freeBytes)} livres de ${formatBytes(drive.sizeBytes)} (${drive.fileSystem})`);
  if (bar) bar.style.width = `${drive.usedPercent}%`;
  if (track) {
    track.dataset.level = levelOf(drive.usedPercent, thresholds.disk);
    track.setAttribute('aria-valuenow', String(drive.usedPercent));
  }
  driveOptimizeButton.disabled = driveOptimizing;
  renderLastRuns();
}

const thresholds = {
  cpu: { warn: 80, crit: 95 },
  memory: { warn: 85, crit: 95 },
  disk: { warn: 85, crit: 95 },
  gpuTemperature: { warn: 85, crit: 92 },
  acpiTemperature: { warn: 80, crit: 95 }
};
const levelRank = { idle: 0, ok: 1, warn: 2, crit: 3 };
const levelColors = { idle: '#7aa2ff', ok: '#7aa2ff', warn: '#f1b64f', crit: '#ff7b8c' };
const stateLabels = {
  load: { warn: 'Alto', crit: 'Crítico' },
  heat: { warn: 'Quente', crit: 'Muito quente' }
};
const tileLevels = { cpu: 'idle', memory: 'idle', disk: 'idle', gpu: 'idle', temperature: 'idle' };
const chartWindowMs = 5 * 60 * 1000;

function levelOf(value, limits) {
  if (!Number.isFinite(value)) return 'idle';
  if (value >= limits.crit) return 'crit';
  return value >= limits.warn ? 'warn' : 'ok';
}

function worstLevel(...levels) {
  return levels.reduce((worst, level) => (levelRank[level] > levelRank[worst] ? level : worst), 'idle');
}

function recentAverage(key, count = 3) {
  const values = livePerformanceSamples.slice(-count).map((sample) => sample[key]).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function highestAcpiTemperature(snapshot) {
  return (snapshot.temperatureReadings?.acpiSensors || [])
    .map((sensor) => sensor.celsius)
    .filter(Number.isFinite)
    .reduce((highest, value) => Math.max(highest, value), null);
}

function getPerformanceSample(snapshot, timestamp = Date.now()) {
  const gpu = snapshot.temperatureReadings?.gpuSensors?.[0] || null;
  return {
    timestamp,
    cpu: snapshot.cpuUsage,
    memory: snapshot.memoryPercent,
    disk: snapshot.primaryDrive?.usedPercent ?? null,
    gpu: gpu?.usagePercent ?? null,
    acpiTemperature: highestAcpiTemperature(snapshot),
    gpuTemperature: gpu?.temperatureCelsius ?? null
  };
}

function pushLiveSample(snapshot) {
  const sample = getPerformanceSample(snapshot);
  const last = livePerformanceSamples[livePerformanceSamples.length - 1];
  if (last && sample.timestamp - last.timestamp < 1500) return last;
  livePerformanceSamples.push(sample);
  while (livePerformanceSamples.length > 1 && sample.timestamp - livePerformanceSamples[0].timestamp > chartWindowMs + 30000) {
    livePerformanceSamples.shift();
  }
  if (livePerformanceSamples.length > maxLivePerformanceSamples) livePerformanceSamples.shift();
  return sample;
}

function hexToRgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

// Cada série vira um cometa: o rastro some para a esquerda e a cabeça marca a leitura mais recente.
function drawSparkline(canvasId, series, { min = 0, max = 100, threshold = null } = {}) {
  const canvas = document.getElementById(canvasId);
  const bounds = canvas?.getBoundingClientRect();
  if (!canvas || !bounds?.width || !bounds.height) return;

  const ratio = window.devicePixelRatio || 1;
  const width = bounds.width;
  const height = bounds.height;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!series.some((item) => item.values.some(Number.isFinite))) return;

  const padding = { top: 12, bottom: 12, left: 0, right: 18 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const yOf = (value) => padding.top + plotHeight * (1 - (Math.min(max, Math.max(min, value)) - min) / (max - min));

  if (threshold !== null) {
    const y = yOf(threshold);
    context.save();
    context.setLineDash([3, 5]);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width, y);
    context.strokeStyle = 'rgba(241, 182, 79, 0.32)';
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  const times = livePerformanceSamples.map((sample) => sample.timestamp);
  const latest = times[times.length - 1];
  if (!Number.isFinite(latest)) return;
  const xOf = (timestamp) => padding.left + plotWidth * (1 - (latest - timestamp) / chartWindowMs);

  for (const item of series) {
    const points = item.values.map((value, index) => (
      Number.isFinite(value) ? { x: xOf(times[index]), y: yOf(value) } : null
    ));
    const visible = points.filter(Boolean);
    if (!visible.length) continue;
    const head = visible[visible.length - 1];
    const tailX = Math.max(padding.left, visible[0].x);

    if (visible.length > 1 && head.x - tailX > 1) {
      const trail = context.createLinearGradient(tailX, 0, head.x, 0);
      trail.addColorStop(0, hexToRgba(item.color, 0));
      trail.addColorStop(0.55, hexToRgba(item.color, 0.5));
      trail.addColorStop(1, hexToRgba(item.color, 1));
      context.beginPath();
      let open = false;
      for (const point of points) {
        if (!point) {
          open = false;
          continue;
        }
        if (open) context.lineTo(point.x, point.y);
        else context.moveTo(point.x, point.y);
        open = true;
      }
      context.strokeStyle = trail;
      context.lineWidth = 2;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke();
    }

    const glow = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, 12);
    glow.addColorStop(0, hexToRgba(item.color, 0.45));
    glow.addColorStop(1, hexToRgba(item.color, 0));
    context.fillStyle = glow;
    context.fillRect(head.x - 12, head.y - 12, 24, 24);
    context.beginPath();
    context.arc(head.x, head.y, 3.2, 0, Math.PI * 2);
    context.fillStyle = item.color;
    context.fill();
  }
}

function drawMetricCharts() {
  const samples = livePerformanceSamples;
  const line = (key, color) => ({ values: samples.map((sample) => sample[key]), color });
  drawSparkline('chart-cpu', [line('cpu', levelColors[tileLevels.cpu])], { threshold: thresholds.cpu.warn });
  drawSparkline('chart-memory', [line('memory', levelColors[tileLevels.memory])], { threshold: thresholds.memory.warn });
  drawSparkline('chart-disk', [line('disk', levelColors[tileLevels.disk])], { threshold: thresholds.disk.warn });
  drawSparkline('chart-gpu', [line('gpu', levelColors[tileLevels.gpu])]);
  drawSparkline('chart-temperature', [
    line('acpiTemperature', '#dfe6ff'),
    line('gpuTemperature', '#7aa2ff')
  ], { min: 20, max: 110, threshold: thresholds.gpuTemperature.warn });
}

let chartFrame = 0;
function scheduleChartRedraw() {
  if (chartFrame) return;
  chartFrame = requestAnimationFrame(() => {
    chartFrame = 0;
    drawMetricCharts();
  });
}

function setTile(name, { level, value, unit = '', caption }) {
  const tile = document.querySelector(`[data-tile="${name}"]`);
  if (tile) tile.dataset.level = level;
  tileLevels[name] = level;
  setValue(`${name}-value`, value, unit);
  setText(`${name}-caption`, caption);
  const labels = name === 'gpu' || name === 'temperature' ? stateLabels.heat : stateLabels.load;
  setText(`${name}-state`, labels[level] || '');
}

function renderMetricTiles(snapshot) {
  const drive = snapshot.primaryDrive;
  const gpu = snapshot.temperatureReadings?.gpuSensors?.[0] || null;
  const gpuTemperature = Number.isFinite(gpu?.temperatureCelsius) ? gpu.temperatureCelsius : null;
  const acpiTemperature = highestAcpiTemperature(snapshot);
  const hottest = gpuTemperature ?? acpiTemperature;

  const cpuLevel = levelOf(recentAverage('cpu') ?? snapshot.cpuUsage, thresholds.cpu);
  setTile('cpu', {
    level: cpuLevel,
    value: Math.round(snapshot.cpuUsage),
    unit: '%',
    caption: cpuLevel === 'warn' || cpuLevel === 'crit'
      ? 'Carga alta nos últimos segundos'
      : snapshot.cpuCores ? `${snapshot.cpuCores} núcleos lógicos` : 'Uso total do processador'
  });

  setTile('memory', {
    level: levelOf(snapshot.memoryPercent, thresholds.memory),
    value: snapshot.memoryPercent,
    unit: '%',
    caption: `${formatBytes(snapshot.memoryUsedBytes)} de ${formatBytes(snapshot.memoryTotalBytes)} em uso`
  });

  if (drive) {
    setTile('disk', {
      level: levelOf(drive.usedPercent, thresholds.disk),
      value: drive.usedPercent,
      unit: '%',
      caption: `${formatBytes(drive.freeBytes)} livres de ${formatBytes(drive.sizeBytes)} na unidade ${drive.driveLetter}:`
    });
  } else {
    setTile('disk', { level: 'idle', value: '--', caption: 'Sem dados de unidade' });
  }

  if (gpu && Number.isFinite(gpu.usagePercent)) {
    const vram = Number.isFinite(gpu.memoryUsedMb) && Number.isFinite(gpu.memoryTotalMb)
      ? `${formatBytes(gpu.memoryUsedMb * 1048576)} de ${formatBytes(gpu.memoryTotalMb * 1048576)} de VRAM`
      : 'VRAM indisponível';
    setTile('gpu', {
      level: levelOf(gpuTemperature, thresholds.gpuTemperature),
      value: gpu.usagePercent,
      unit: '%',
      caption: `${gpu.name}: ${vram}`
    });
  } else {
    setTile('gpu', { level: 'idle', value: '--', caption: 'Requer placa NVIDIA e nvidia-smi' });
  }

  if (Number.isFinite(hottest)) {
    const parts = [];
    if (gpuTemperature !== null) parts.push(`GPU ${gpuTemperature} °C`);
    if (acpiTemperature !== null) parts.push(`ACPI ${acpiTemperature} °C`);
    setTile('temperature', {
      level: worstLevel(levelOf(gpuTemperature, thresholds.gpuTemperature), levelOf(acpiTemperature, thresholds.acpiTemperature)),
      value: hottest,
      unit: '°C',
      caption: parts.join(' e ')
    });
  } else {
    setTile('temperature', { level: 'idle', value: '--', caption: 'Sem sensores compatíveis neste PC' });
  }
}

function buildVerdict(snapshot) {
  const drive = snapshot.primaryDrive;
  const cpu = recentAverage('cpu') ?? snapshot.cpuUsage;
  const memory = snapshot.memoryPercent;
  const gpu = snapshot.temperatureReadings?.gpuSensors?.[0] || null;
  const gpuTemperature = Number.isFinite(gpu?.temperatureCelsius) ? gpu.temperatureCelsius : null;
  const acpiTemperature = highestAcpiTemperature(snapshot);
  const issues = [];

  const diskLevel = drive ? levelOf(drive.usedPercent, thresholds.disk) : 'idle';
  if (diskLevel === 'warn' || diskLevel === 'crit') {
    issues.push({
      level: diskLevel,
      focus: 'disk',
      headline: `O disco ${drive.driveLetter}: está ${diskLevel === 'crit' ? 'cheio' : 'quase cheio'}.`,
      detail: `${drive.usedPercent}% ocupado, com ${formatBytes(drive.freeBytes)} livres de ${formatBytes(drive.sizeBytes)}. Pouco espaço livre pode deixar o Windows lento e travar atualizações.`
    });
  }

  const memoryLevel = levelOf(memory, thresholds.memory);
  if (memoryLevel === 'warn' || memoryLevel === 'crit') {
    issues.push({
      level: memoryLevel,
      focus: 'memory',
      headline: `A memória está ${memoryLevel === 'crit' ? 'no limite' : 'quase cheia'}.`,
      detail: `${memory}% da RAM em uso (${formatBytes(snapshot.memoryUsedBytes)} de ${formatBytes(snapshot.memoryTotalBytes)}). Veja quais programas consomem mais.`
    });
  }

  const cpuLevel = levelOf(cpu, thresholds.cpu);
  if (cpuLevel === 'warn' || cpuLevel === 'crit') {
    issues.push({
      level: cpuLevel,
      focus: 'cpu',
      headline: 'O processador está sob carga alta.',
      detail: `${Math.round(cpu)}% de uso nos últimos segundos. Pode ser uma tarefa normal ou um programa travado; veja quem está usando.`
    });
  }

  const gpuLevel = levelOf(gpuTemperature, thresholds.gpuTemperature);
  if (gpuLevel === 'warn' || gpuLevel === 'crit') {
    issues.push({
      level: gpuLevel,
      focus: 'gpu',
      headline: 'A GPU está quente.',
      detail: `${gpu.name} em ${gpuTemperature} °C. Se isso acontecer fora de jogos e renderização, confira a ventilação.`
    });
  }

  const acpiLevel = levelOf(acpiTemperature, thresholds.acpiTemperature);
  if (acpiLevel === 'warn' || acpiLevel === 'crit') {
    issues.push({
      level: acpiLevel,
      focus: 'heat',
      headline: 'O computador está esquentando.',
      detail: `Um sensor térmico marca ${acpiTemperature} °C. Confira a ventilação e a poeira nas entradas de ar.`
    });
  }

  issues.sort((left, right) => levelRank[right.level] - levelRank[left.level]);
  if (issues.length) {
    const [main] = issues;
    const extra = issues.length - 1;
    return { ...main, detail: extra ? `${main.detail} Há mais ${extra} ponto${extra > 1 ? 's' : ''} de atenção.` : main.detail };
  }

  return {
    level: 'ok',
    focus: 'ok',
    headline: 'Seu PC está em bom estado.',
    detail: `Nada fora do normal agora: CPU em ${Math.round(cpu)}%, memória em ${memory}%${drive ? ` e disco ${drive.driveLetter}: com ${drive.usedPercent}% usado` : ''}.`
  };
}

function applyAction(button, config) {
  if (!button) return;
  button.hidden = !config;
  if (!config) return;
  button.dataset.action = config.action;
  if (button.textContent !== config.label) button.textContent = config.label;
}

function renderVerdictActions(verdict) {
  const canClean = Boolean(lastCleanupPreview?.fileCount) && Boolean(desktopBridge?.cleanupTempFiles);
  const cleanLabel = canClean ? `Limpar temporários (${formatBytes(lastCleanupPreview.bytes)})` : '';
  let primary = {
    action: 'diagnose',
    label: verdict.level === 'ok' || verdict.level === 'idle' ? 'Analisar desempenho' : 'Ver o que está pesando'
  };
  let secondary = canClean ? { action: 'cleanup', label: cleanLabel } : null;
  if (verdict.focus === 'disk' && canClean) {
    primary = { action: 'cleanup', label: cleanLabel };
    secondary = { action: 'diagnose', label: 'Analisar desempenho' };
  }
  applyAction(verdictPrimary, primary);
  applyAction(verdictSecondary, secondary);
}

function renderVerdict(verdict) {
  lastVerdict = verdict;
  const element = document.getElementById('verdict');
  if (element) element.dataset.level = verdict.level;
  setText('verdict-headline', verdict.headline);
  setText('verdict-detail', verdict.detail);
  renderVerdictActions(verdict);
}

function renderSystemSnapshot(snapshot) {
  systemSnapshot = snapshot;
  const sample = pushLiveSample(snapshot);

  setText('computer-name', snapshot.hostname);
  setText('device-meta', `${snapshot.osLabel || snapshot.operatingSystem}, ligado há ${formatDuration(snapshot.uptimeSeconds)}`);
  setText('device-network', snapshot.networkConnected ? 'Interface de rede ativa' : 'Sem interface de rede ativa');
  document.getElementById('device-network')?.setAttribute('data-online', String(Boolean(snapshot.networkConnected)));
  setText('app-version', snapshot.version);
  setText('updates-current-version', snapshot.version);

  renderMetricTiles(snapshot);
  renderVerdict(buildVerdict(snapshot));
  setText('telemetry-updated-at', `Atualizado às ${new Date(sample.timestamp).toLocaleTimeString('pt-BR')}`);
  drawMetricCharts();

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

const maxActivityEntries = 50;
let activityEntries = null;

function getActivityEntries() {
  if (!activityEntries) {
    activityEntries = readStoredArray(activityStorageKey)
      .filter((entry) => entry && typeof entry.title === 'string' && typeof entry.detail === 'string' && Number.isFinite(entry.timestamp))
      .slice(0, maxActivityEntries);
  }
  return activityEntries;
}

function recordActivity(title, detail) {
  activityEntries = [{ title, detail, timestamp: Date.now() }, ...getActivityEntries()].slice(0, maxActivityEntries);
  if (!saveStored(activityStorageKey, activityEntries)) showToast('Atividade registrada apenas nesta sessão.');
  renderActivity();
}

function renderActivity() {
  if (!activityFeed) return;
  const entries = getActivityEntries();
  if (activityEmpty) activityEmpty.hidden = entries.length > 0;
  if (clearActivityButton) clearActivityButton.hidden = entries.length === 0;

  const groups = [];
  for (const entry of entries) {
    const label = formatDayLabel(entry.timestamp);
    const group = groups[groups.length - 1];
    if (group && group.label === label) group.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  activityFeed.replaceChildren(...groups.map((group) => {
    const section = document.createElement('section');
    section.className = 'feed-group';
    const heading = document.createElement('h3');
    heading.className = 'feed-day';
    heading.textContent = group.label;
    const list = document.createElement('ul');
    list.className = 'feed-list';
    for (const entry of group.entries) {
      const item = document.createElement('li');
      item.className = 'feed-item';
      const time = document.createElement('span');
      time.className = 'feed-time';
      time.textContent = formatClock(entry.timestamp);
      const text = document.createElement('span');
      text.textContent = entry.title;
      const detail = document.createElement('small');
      detail.className = 'feed-detail';
      detail.textContent = entry.detail;
      text.append(detail);
      item.append(time, text);
      list.append(item);
    }
    section.append(heading, list);
    return section;
  }));
}

function refreshSystemSnapshot() {
  if (!desktopBridge?.getSystemSnapshot) {
    setAppStatus('Abra o app desktop para monitorar');
    return Promise.resolve(null);
  }
  if (snapshotPromise) return snapshotPromise;

  snapshotPromise = (async () => {
    const snapshot = await desktopBridge.getSystemSnapshot();
    renderSystemSnapshot(snapshot);
    recordPerformanceSample(snapshot);
    if (activeTaskLabel) setAppStatus(activeTaskLabel, true);
    else if (Date.now() >= statusHoldUntil) setAppStatus('Monitoramento ativo');
    await maybeRunAutonomousCleanup(snapshot);
    return snapshot;
  })().finally(() => {
    snapshotPromise = null;
  });
  return snapshotPromise;
}

async function refreshCleanupPreview() {
  if (!desktopBridge?.getCleanupPreview) {
    setText('cleanup-summary', 'Disponível no app desktop');
    return null;
  }

  const preview = await desktopBridge.getCleanupPreview();
  lastCleanupPreview = preview;
  const count = `${preview.fileCount.toLocaleString('pt-BR')}${preview.fileCount >= preview.maxFiles ? '+' : ''}`;
  setText('cleanup-summary', preview.fileCount
    ? `${count} arquivos, ${formatBytes(preview.bytes)} para liberar`
    : 'Nenhum temporário antigo encontrado');
  if (lastVerdict) renderVerdictActions(lastVerdict);
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
      showToast(message, 'ok');
      setAppStatus('Limpeza automática concluída');
      recordActivity('Limpeza automática', `${result.removedCount} arquivos, ${formatBytes(result.bytesFreed)}`);
      markLastRun('cleanup');
    }
  } catch (error) {
    showToast(cleanError(error, 'A limpeza automática não pôde ser concluída.'), 'error');
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
autoCleanToggle.addEventListener('change', async () => {
  if (autoCleanToggle.checked) {
    const confirmed = await confirmAction({
      title: 'Ativar a limpeza automática?',
      body: 'Quando o disco principal ficar acima de 90% por pelo menos um minuto, o Nexo remove temporários antigos sozinho.',
      points: [
        'Remove até 5.000 arquivos por vez, só da pasta temporária e com mais de 7 dias.',
        'Roda no máximo uma vez por hora.',
        'Não fecha programas nem muda configurações do Windows.'
      ],
      confirmLabel: 'Ativar'
    });
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
    showToast('Não foi possível salvar a preferência de automação.', 'error');
    return;
  }
  showToast(autoCleanupEnabled ? 'Limpeza automática ativada.' : 'Limpeza automática desativada.', 'ok');
});

driveSelect.addEventListener('change', (event) => hydrateDriveView(event.target.value));
driveOptimizeButton.disabled = true;

async function optimizeSelectedDrive() {
  const selectedDrive = getSelectedDrive();
  if (!selectedDrive || !desktopBridge?.optimizeDrive || driveOptimizing) return;
  const letter = selectedDrive.driveLetter;

  const confirmed = await confirmAction({
    title: `Otimizar a unidade ${letter}:?`,
    body: 'O Windows escolhe a operação certa para o tipo de disco: desfragmentação em HDDs e TRIM em SSDs.',
    points: [
      'O Windows vai pedir permissão de administrador.',
      'Pode levar vários minutos e deixar o disco mais lento enquanto roda.'
    ],
    confirmLabel: 'Otimizar'
  });
  if (!confirmed) return;

  driveOptimizing = true;
  setButtonBusy(driveOptimizeButton, true, 'Otimizando…');
  beginTask(`Otimizando ${letter}:`);
  try {
    await desktopBridge.optimizeDrive(letter);
    endTask('Otimização concluída');
    showToast(`O Windows concluiu a otimização de ${letter}:.`, 'ok');
    recordActivity('Otimização de unidade', `${letter}:`);
    markLastRun(`optimize:${letter}`);
    await refreshSystemSnapshot();
  } catch (error) {
    endTask('Otimização não concluída');
    showToast(cleanError(error, 'Não foi possível otimizar a unidade.'), 'error');
  } finally {
    driveOptimizing = false;
    setButtonBusy(driveOptimizeButton, false);
    driveOptimizeButton.disabled = !getSelectedDrive();
  }
}

driveOptimizeButton.addEventListener('click', optimizeSelectedDrive);

// Mede o brilho médio da imagem (0 a 1) e escurece o véu na mesma medida, para o texto continuar legível.
function averageLuminance(source) {
  const probe = document.createElement('canvas');
  probe.width = 24;
  probe.height = 24;
  const context = probe.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, 24, 24);
  const { data } = context.getImageData(0, 0, 24, 24);
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    total += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  }
  return total / (data.length / 4) / 255;
}

function applyVeil(luminance) {
  const alpha = Math.min(0.78, 0.38 + Math.max(0, luminance - 0.25) * 0.9);
  document.documentElement.style.setProperty('--veil-alpha', alpha.toFixed(2));
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler essa imagem.'));
    };
    image.src = url;
  });
}

async function applyWallpaper(file) {
  if (!file) return;
  const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!acceptedTypes.includes(file.type)) {
    showToast('Use uma imagem PNG, JPEG ou WebP.', 'error');
    return;
  }
  if (file.size > maxWallpaperBytes) {
    showToast('Escolha uma imagem de até 20 MB.', 'error');
    return;
  }

  try {
    const image = await loadImageFile(file);
    const scale = Math.min(1, wallpaperMaxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/webp', 0.82);
    const luminance = averageLuminance(canvas);
    localStorage.setItem(wallpaperStorageKey, imageData);
    localStorage.setItem(wallpaperLumaKey, luminance.toFixed(3));
    applyVeil(luminance);
    document.documentElement.style.setProperty('--wallpaper-image', `url("${imageData}")`);
    resetWallpaperButton.hidden = false;
    showToast('Wallpaper atualizado.', 'ok');
  } catch (error) {
    const storageFull = error?.name === 'QuotaExceededError';
    showToast(storageFull ? 'Não foi possível armazenar essa imagem.' : error?.message || 'Não foi possível ler essa imagem.', 'error');
  }
}

function restoreDefaultWallpaper() {
  document.documentElement.style.removeProperty('--wallpaper-image');
  document.documentElement.style.removeProperty('--veil-alpha');
  try {
    localStorage.removeItem(wallpaperStorageKey);
    localStorage.removeItem(wallpaperLumaKey);
  } catch {
    // Sem armazenamento disponível, o padrão volta a valer na próxima abertura.
  }
  resetWallpaperButton.hidden = true;
  showToast('Wallpaper padrão restaurado.');
}

chooseWallpaperButton.addEventListener('click', () => wallpaperInput.click());
resetWallpaperButton.addEventListener('click', restoreDefaultWallpaper);
wallpaperInput.addEventListener('change', (event) => {
  const [file] = event.target.files || [];
  if (file) applyWallpaper(file);
  event.target.value = '';
});

const savedWallpaper = getLocalStorageValue(wallpaperStorageKey);
if (savedWallpaper && savedWallpaper.startsWith('data:image/') && !savedWallpaper.includes('"')) {
  document.documentElement.style.setProperty('--wallpaper-image', `url("${savedWallpaper}")`);
  resetWallpaperButton.hidden = false;
  const savedLuminance = Number.parseFloat(getLocalStorageValue(wallpaperLumaKey));
  // Wallpaper guardado por versões antigas não tem brilho medido: usa um véu intermediário seguro.
  applyVeil(Number.isFinite(savedLuminance) ? savedLuminance : 0.5);
}

async function runDiagnosis() {
  if (!desktopBridge?.getSystemSnapshot) {
    renderDiagnosisRecommendations([], 'O diagnóstico real está disponível no aplicativo desktop.');
    return;
  }

  setButtonBusy(runDiagnosisButton, true, 'Analisando…');
  beginTask('Analisando o sistema');
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
    const cpuSpike = cpuBaseline && snapshot.cpuUsage >= 60
      && snapshot.cpuUsage - cpuBaseline.median >= Math.max(25, cpuBaseline.medianAbsoluteDeviation * 3);
    const memorySpike = memoryBaseline && snapshot.memoryPercent >= 70
      && snapshot.memoryPercent - memoryBaseline.median >= Math.max(20, memoryBaseline.medianAbsoluteDeviation * 3);

    if (snapshot.cpuUsage >= 85 || cpuSpike) {
      recommendations.push({
        category: 'cpu',
        severity: snapshot.cpuUsage >= thresholds.cpu.crit ? 'crit' : 'warn',
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
        severity: snapshot.memoryPercent >= thresholds.memory.crit ? 'crit' : 'warn',
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
        severity: snapshot.primaryDrive.usedPercent >= thresholds.disk.crit ? 'crit' : 'warn',
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
    const hotGpu = snapshot.temperatureReadings?.gpuSensors?.find((sensor) => sensor.temperatureCelsius >= 85);
    if (hotGpu) {
      recommendations.push({
        category: 'gpu-temperature',
        severity: hotGpu.temperatureCelsius >= thresholds.gpuTemperature.crit ? 'crit' : 'warn',
        title: 'Temperatura elevada na GPU',
        cause: `${hotGpu.name} reportou ${hotGpu.temperatureCelsius} °C. Esse valor merece comparação com o limite térmico indicado pelo fabricante.`,
        action: 'Confira a ventilação e os limites do fabricante; reduza a carga se essa temperatura persistir fora de jogos ou renderização.',
        confidence: 65
      });
    }

    if (snapshot.uptimeSeconds >= 14 * 24 * 60 * 60) {
      recommendations.push({
        category: 'uptime',
        severity: 'info',
        title: 'Computador ligado há muito tempo',
        cause: `O Windows está ativo há ${formatDuration(snapshot.uptimeSeconds)} sem reiniciar.`,
        action: 'Reinicie (não só desligue): reiniciar aplica atualizações pendentes e libera memória acumulada. Com a inicialização rápida do Windows, desligar e ligar não zera esse tempo.',
        confidence: 50
      });
    }

    renderDiagnosisRecommendations(recommendations, 'Nada fora do normal nesta amostra. O diagnóstico olhou CPU, memória, disco, GPU compatível, temperatura e processos.');
    renderProcessLists(sampledProcesses);
    endTask('Diagnóstico concluído');
    showToast(recommendations.length ? 'Recomendações de desempenho prontas.' : 'Nenhum gargalo relevante detectado.', 'ok');
    recordActivity('Diagnóstico de desempenho', recommendations.length ? `${recommendations.length} recomendação(ões)` : 'sem gargalo detectado');
  } catch (error) {
    renderDiagnosisRecommendations([], cleanError(error, 'Não foi possível obter as informações do sistema.'));
    renderProcessLists(null);
    endTask('Diagnóstico indisponível');
    showToast('Falha ao ler o sistema.', 'error');
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
  setButtonBusy(runCleanupButton, true, 'Verificando…');
  try {
    const preview = await refreshCleanupPreview();
    if (!preview?.fileCount) {
      showToast('Nenhum arquivo temporário antigo encontrado.');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Remover arquivos temporários?',
      body: `${preview.fileCount.toLocaleString('pt-BR')} arquivos (${formatBytes(preview.bytes)}) com mais de ${preview.minAgeDays} dias serão removidos da pasta temporária do seu usuário.`,
      points: [
        'A remoção é definitiva: os arquivos não vão para a Lixeira.',
        'Subpastas e atalhos não são tocados.',
        'Arquivos que o Windows estiver usando podem ser mantidos.'
      ],
      confirmLabel: 'Remover arquivos',
      tone: 'danger'
    });
    if (!confirmed) return;

    setButtonBusy(runCleanupButton, true, 'Limpando…');
    beginTask('Limpando temporários');
    const result = await desktopBridge.cleanupTempFiles();
    markCleanupRun();
    markLastRun('cleanup');
    const skipped = result.skippedCount ? `; ${result.skippedCount} não puderam ser removidos` : '';
    showToast(`${result.removedCount} arquivos removidos, ${formatBytes(result.bytesFreed)} liberados${skipped}.`, 'ok');
    endTask('Limpeza concluída');
    recordActivity('Limpeza de temporários', `${result.removedCount} arquivos, ${formatBytes(result.bytesFreed)}`);
    await refreshCleanupPreview();
  } catch (error) {
    endTask('Limpeza não concluída');
    showToast(cleanError(error, 'Não foi possível limpar os temporários.'), 'error');
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

  const confirmed = await confirmAction({
    title: 'Verificar os arquivos do Windows?',
    body: 'O Windows vai executar sfc /scannow para procurar e reparar arquivos de sistema corrompidos.',
    points: [
      'Costuma levar de 10 a 30 minutos, às vezes mais.',
      'O Windows vai pedir permissão de administrador.'
    ],
    confirmLabel: 'Verificar'
  });
  if (!confirmed) return;

  setButtonBusy(runRepairButton, true, 'Verificando…');
  setText('repair-status', 'Em andamento');
  beginTask('Verificando arquivos do Windows');
  try {
    await desktopBridge.repairSystemFiles();
    setText('repair-status', 'Concluída');
    endTask('Verificação concluída');
    showToast('O Windows concluiu a verificação SFC.', 'ok');
    recordActivity('Verificação SFC', 'concluída');
    markLastRun('repair');
  } catch (error) {
    setText('repair-status', 'Não concluída');
    endTask('Verificação não concluída');
    showToast(cleanError(error, 'O Windows não concluiu a verificação.'), 'error');
  } finally {
    setButtonBusy(runRepairButton, false);
  }
}

runRepairButton.addEventListener('click', runRepair);

function renderUpdateStatus(status) {
  const messages = {
    checking: ['Conferindo novidades', 'Estamos verificando se há uma versão mais recente do Nexo.', 'Verificação em andamento'],
    available: ['Nova atualização disponível', `A versão ${status.version || 'mais recente'} está pronta para baixar. Deseja atualizar o app agora?`, 'Nova versão disponível'],
    downloading: ['Baixando atualização', `A versão ${status.version || 'mais recente'} está sendo baixada. Você poderá escolher quando instalar.`, 'Download em andamento'],
    current: ['Você está em dia', 'Esta instalação já está na versão mais recente disponível.', 'Tudo atualizado'],
    downloaded: ['Pronto para atualizar', `A versão ${status.version || 'mais recente'} foi baixada e está pronta para instalar.`, 'Atualização pronta'],
    development: ['Atualizações disponíveis na versão instalada', 'Instale o aplicativo para receber versões publicadas pelo GitHub.', 'Modo de desenvolvimento'],
    error: ['Não foi possível concluir a atualização', status.message || 'Confira sua conexão e tente novamente.', 'Falha na atualização']
  };
  const [heading, detail, eyebrow] = messages[status.state] || ['Status indisponível', 'Tente verificar novamente.', 'Atualizações'];
  const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
  const isAvailable = status.state === 'available';
  const isDownloading = status.state === 'downloading';
  const isChecking = status.state === 'checking';
  const isDownloaded = status.state === 'downloaded';
  const canRetryDownload = status.state === 'error' && status.canRetry;
  currentUpdateStatus = status;
  setText('update-status', status.state === 'downloading' && status.percent !== undefined
    ? `Baixando atualização · ${percent}%`
    : isAvailable ? `Nova versão · ${status.version || 'disponível'}` : heading);
  setText('update-state-heading', heading);
  setText('update-state-detail', detail);
  setText('update-state-eyebrow', eyebrow);
  setText('update-progress-label', isChecking ? 'Buscando uma versão nova' : 'Download da atualização');
  setText('update-progress-percent', isChecking ? '...' : `${percent}%`);
  if (updatePanel) updatePanel.dataset.state = status.state;
  const progressWrap = document.getElementById('update-progress-wrap');
  const progressTrack = document.getElementById('update-progress-track');
  const progressFill = document.getElementById('update-progress-fill');
  if (progressWrap) progressWrap.hidden = !isDownloading && !isChecking;
  if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(isChecking ? 0 : percent));
  if (progressFill) progressFill.style.width = isChecking ? '34%' : `${percent}%`;
  updateButton.hidden = !isAvailable && !isDownloaded && !canRetryDownload;
  updateButton.querySelector('span:last-child').textContent = isDownloaded
    ? `Instalar versão ${status.version || ''}`.trim()
    : `Atualização ${status.version || ''}`.trim();
  downloadUpdateButton.hidden = !isAvailable && !canRetryDownload;
  downloadUpdateButton.dataset.idleText = canRetryDownload ? 'Tentar baixar novamente' : 'Baixar e atualizar';
  downloadUpdateButton.textContent = downloadUpdateButton.dataset.idleText;
  checkUpdatesButton.disabled = isChecking || isDownloading;
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
    setView('updates');
    return;
  }
  await installDownloadedUpdate();
});

async function installDownloadedUpdate() {
  if (!desktopBridge?.installUpdate) return;
  try {
    await desktopBridge.installUpdate();
  } catch (error) {
    showToast(cleanError(error, 'Não foi possível instalar a atualização.'), 'error');
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

deferUpdateButton.addEventListener('click', () => setView('overview'));

checkUpdatesButton.addEventListener('click', async () => {
  setButtonBusy(checkUpdatesButton, true, 'Verificando...');
  await checkForUpdates();
  setButtonBusy(checkUpdatesButton, false);
});

windowMinimizeButton.addEventListener('click', () => desktopBridge?.minimizeWindow?.());
windowMaximizeButton.addEventListener('click', () => desktopBridge?.toggleMaximizeWindow?.());
windowCloseButton.addEventListener('click', () => desktopBridge?.closeWindow?.());

function renderWindowState(state) {
  if (!windowMaximizeButton) return;
  windowMaximizeButton.classList.toggle('is-maximized', Boolean(state.maximized));
  windowMaximizeButton.setAttribute('aria-label', state.maximized ? 'Restaurar janela' : 'Maximizar');
  windowMaximizeButton.title = state.maximized ? 'Restaurar' : 'Maximizar';
}

if (desktopBridge?.getWindowState) desktopBridge.getWindowState().then(renderWindowState);
if (desktopBridge?.onWindowState) desktopBridge.onWindowState(renderWindowState);

document.querySelectorAll('[data-scan="diagnosis"]').forEach((button) => {
  button.addEventListener('click', runDiagnosis);
});
document.querySelectorAll('[data-scan="cleanup"]').forEach((button) => {
  button.addEventListener('click', runCleanup);
});

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!desktopBridge?.getSystemSnapshot) return;
  // Com a janela minimizada o app continua medindo (para o histórico e a limpeza automática), mas bem mais devagar.
  const delay = document.hidden ? (autoCleanupEnabled ? 30000 : 60000) : 5000;
  refreshTimer = setTimeout(async () => {
    try {
      await refreshSystemSnapshot();
    } catch {
      setAppStatus('Falha ao atualizar leitura');
    }
    scheduleRefresh();
  }, delay);
}

for (const button of [verdictPrimary, verdictSecondary]) {
  button?.addEventListener('click', () => {
    if (button.dataset.action === 'cleanup') {
      runCleanup();
    } else {
      setView('diagnosis');
      runDiagnosis();
    }
  });
}

clearActivityButton?.addEventListener('click', async () => {
  const confirmed = await confirmAction({
    title: 'Limpar o histórico de atividade?',
    body: 'O registro desta tela será apagado deste computador. Isso não desfaz nenhuma limpeza ou otimização já feita.',
    confirmLabel: 'Limpar histórico',
    tone: 'danger'
  });
  if (!confirmed) return;
  activityEntries = [];
  saveStored(activityStorageKey, activityEntries);
  renderActivity();
  showToast('Histórico apagado.');
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshSystemSnapshot().catch(() => setAppStatus('Falha ao atualizar leitura'));
  scheduleRefresh();
});

if ('ResizeObserver' in window) new ResizeObserver(scheduleChartRedraw).observe(document.querySelector('.views'));

renderActivity();
refreshLearningStatus();
renderLastRuns();
setView('overview');

if (!desktopBridge) {
  renderVerdict({
    level: 'idle',
    focus: 'none',
    headline: 'Abra o app desktop para ver o seu PC.',
    detail: 'No navegador não há acesso às medições do computador. Leituras e ferramentas funcionam no aplicativo instalado.'
  });
  setAppStatus('Modo navegador');
  setText('device-meta', 'Modo navegador');
  setText('device-network', 'Rede indisponível no navegador');
}

refreshSystemSnapshot().catch((error) => {
  setAppStatus('Falha ao ler o sistema');
  showToast(cleanError(error, 'Não foi possível ler o sistema.'), 'error');
});
refreshCleanupPreview().catch(() => {
  setText('cleanup-summary', 'Não foi possível calcular');
});
checkForUpdates();
scheduleRefresh();
setInterval(() => {
  if (!document.hidden) refreshCleanupPreview().catch(() => {});
}, 10 * 60 * 1000);
