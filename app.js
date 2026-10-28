const viewButtons = document.querySelectorAll('.nav-item');
const panelMap = document.querySelectorAll('[data-view-panel]');
const toast = document.getElementById('toast');
const breadcrumbCurrent = document.getElementById('breadcrumb-current');
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
const processRefreshButton = document.getElementById('refresh-processes');
const processInsightsList = document.getElementById('process-insights-list');
const diagnosisResult = document.getElementById('diagnosis-result');
const runDiagnosisButton = document.getElementById('run-diagnosis');
const runCleanupButton = document.getElementById('run-cleanup');
const runRepairButton = document.getElementById('run-repair');
const activityList = document.querySelector('.activity-list');
const autoCleanToggle = document.getElementById('auto-clean-toggle');
const desktopBridge = window.nexoDesktop;
document.body.classList.toggle('desktop-app', Boolean(desktopBridge));

const defaultWallpaper = './assets/1338277.png';
const wallpaperStorageKey = 'nexo-wallpaper';
const activityStorageKey = 'nexo-activity';
const autoCleanPreferenceKey = 'nexo-auto-clean';
const autoCleanLastRunKey = 'nexo-auto-clean-last-run';
const performanceHistoryKey = 'nexo-performance-history';
const recommendationFeedbackKey = 'nexo-recommendation-feedback';
const maxWallpaperBytes = 5 * 1024 * 1024;
const historyIntervalMs = 60 * 1000;
const historyRetentionMs = 7 * 24 * 60 * 60 * 1000;
const maxHistorySamples = Math.ceil(historyRetentionMs / historyIntervalMs);
const autoCleanDiskThreshold = 90;
const autoCleanRequiredSamples = 4;
const autoCleanMinimumPersistenceMs = 60 * 1000;
const autoCleanCooldownMs = 60 * 60 * 1000;
const maxLivePerformanceSamples = 60;
const historyRanges = {
  '5m': { duration: 5 * 60 * 1000, label: '5 min' },
  '30m': { duration: 30 * 60 * 1000, label: '30 min' },
  '24h': { duration: 24 * 60 * 60 * 1000, label: '24 horas' },
  '7d': { duration: 7 * 24 * 60 * 60 * 1000, label: '7 dias' }
};
let systemSnapshot = null;
let currentUpdateStatus = { state: 'checking' };
let snapshotRefreshInProgress = false;
const livePerformanceSamples = [];
let toastTimeout;
let highDiskSamples = 0;
let highDiskSince = 0;
let cleanupOperationInProgress = false;
let performanceHistory = null;
let selectedHistoryRange = '5m';
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
    activity: 'Atividade',
    updates: 'Atualizações'
  };
  if (breadcrumbCurrent) breadcrumbCurrent.textContent = labelMap[viewName] || 'Visão geral';
  if (viewName === 'overview') drawPerformanceCharts();
}

viewButtons.forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.querySelectorAll('[data-history-range]').forEach((button) => {
  button.addEventListener('click', () => {
    selectedHistoryRange = button.dataset.historyRange;
    document.querySelectorAll('[data-history-range]').forEach((option) => {
      option.setAttribute('aria-pressed', String(option === button));
    });
    drawPerformanceCharts();
  });
});

let chartResizeFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(chartResizeFrame);
  chartResizeFrame = requestAnimationFrame(drawPerformanceCharts);
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
    .map((sample) => Array.isArray(sample) ? ({
      timestamp: sample[0],
      cpuPercent: sample[1],
      memoryPercent: sample[2],
      diskPercent: sample[3],
      gpuPercent: sample[4],
      acpiTemperatureCelsius: sample[5],
      gpuTemperatureCelsius: sample[6]
    }) : sample)
    .filter((sample) => sample && Number.isFinite(sample.timestamp) && sample.timestamp >= cutoff)
    .slice(-maxHistorySamples);
  return performanceHistory;
}

function recordPerformanceSample(snapshot) {
  const samples = getPerformanceHistory();
  const now = Date.now();
  if (samples.length && now - samples[samples.length - 1].timestamp < historyIntervalMs) return;

  const thermal = snapshot.temperatureReadings || {};
  const acpiTemperature = (thermal.acpiSensors || [])
    .map((sensor) => sensor.celsius)
    .filter(Number.isFinite)
    .reduce((highest, value) => Math.max(highest, value), null);
  const gpu = thermal.gpuSensors?.[0] || null;
  samples.push({
    timestamp: now,
    cpuPercent: snapshot.cpuUsage,
    memoryPercent: snapshot.memoryPercent,
    diskPercent: snapshot.primaryDrive?.usedPercent ?? null,
    gpuPercent: gpu?.usagePercent ?? null,
    acpiTemperatureCelsius: acpiTemperature,
    gpuTemperatureCelsius: gpu?.temperatureCelsius ?? null
  });
  performanceHistory = samples
    .filter((sample) => sample.timestamp >= now - historyRetentionMs)
    .slice(-maxHistorySamples);
  try {
    const compactHistory = performanceHistory.map((sample) => [
      sample.timestamp,
      sample.cpuPercent,
      sample.memoryPercent,
      sample.diskPercent,
      sample.gpuPercent,
      sample.acpiTemperatureCelsius,
      sample.gpuTemperatureCelsius
    ]);
    localStorage.setItem(performanceHistoryKey, JSON.stringify(compactHistory));
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

function getPerformanceSample(snapshot, timestamp = Date.now()) {
  const thermal = snapshot.temperatureReadings || {};
  const acpiTemperature = (thermal.acpiSensors || [])
    .map((sensor) => sensor.celsius)
    .filter(Number.isFinite)
    .reduce((highest, value) => Math.max(highest, value), null);
  const gpu = thermal.gpuSensors?.[0] || null;

  return {
    timestamp,
    cpu: snapshot.cpuUsage,
    memory: snapshot.memoryPercent,
    disk: snapshot.primaryDrive?.usedPercent ?? null,
    gpu: gpu?.usagePercent ?? null,
    acpiTemperature,
    gpuTemperature: gpu?.temperatureCelsius ?? null
  };
}

function getChartSamples(durationMs) {
  const start = Date.now() - durationMs;
  const samplesBySlot = new Map();
  const normalize = (sample) => ({
    timestamp: sample.timestamp,
    cpu: sample.cpu ?? sample.cpuPercent ?? null,
    memory: sample.memory ?? sample.memoryPercent ?? null,
    disk: sample.disk ?? sample.diskPercent ?? null,
    gpu: sample.gpu ?? sample.gpuPercent ?? null,
    acpiTemperature: sample.acpiTemperature ?? sample.acpiTemperatureCelsius ?? null,
    gpuTemperature: sample.gpuTemperature ?? sample.gpuTemperatureCelsius ?? null
  });

  for (const sample of getPerformanceHistory()) {
    if (sample.timestamp >= start) samplesBySlot.set(Math.floor(sample.timestamp / 5000), normalize(sample));
  }
  for (const sample of livePerformanceSamples) {
    if (sample.timestamp >= start) samplesBySlot.set(Math.floor(sample.timestamp / 5000), normalize(sample));
  }

  return [...samplesBySlot.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function downsampleChartPoints(points, targetCount) {
  if (points.length <= targetCount) return points;
  const bucketSize = points.length / targetCount;
  const compacted = [];
  for (let bucket = 0; bucket < targetCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(points.length, Math.floor((bucket + 1) * bucketSize));
    const entries = points.slice(start, end).filter((point) => Number.isFinite(point.value));
    if (!entries.length) continue;
    let minimum = entries[0];
    let maximum = entries[0];
    for (const point of entries) {
      if (point.value < minimum.value) minimum = point;
      if (point.value > maximum.value) maximum = point;
    }
    compacted.push(...(minimum.timestamp <= maximum.timestamp ? [minimum, maximum] : [maximum, minimum]));
  }
  return compacted.filter((point, index, all) => index === 0 || point.timestamp !== all[index - 1].timestamp);
}

function drawPerformanceChart(canvasId, series, range, timeWindow) {
  const canvas = document.getElementById(canvasId);
  const bounds = canvas?.getBoundingClientRect();
  if (!canvas || !bounds?.width || !bounds.height) return;

  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  const context = canvas.getContext('2d');
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const width = bounds.width;
  const height = bounds.height;
  const padding = { top: 12, right: 10, bottom: 24, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  context.clearRect(0, 0, width, height);

  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (plotHeight * index) / 4;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.strokeStyle = index === 4 ? 'rgba(226, 232, 240, 0.14)' : 'rgba(226, 232, 240, 0.075)';
    context.lineWidth = 1;
    context.stroke();
    const tickValue = Math.round(range.max - ((range.max - range.min) * index) / 4);
    context.fillStyle = 'rgba(206, 211, 222, 0.58)';
    context.font = '10px Segoe UI, sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillText(`${tickValue}${range.unit || '%'}`, padding.left - 7, y);
  }

  const startTime = timeWindow.end - timeWindow.duration;
  const timeLabels = [startTime, startTime + timeWindow.duration / 2, timeWindow.end];
  context.fillStyle = 'rgba(206, 211, 222, 0.5)';
  context.font = '10px Segoe UI, sans-serif';
  context.textBaseline = 'top';
  timeLabels.forEach((time, index) => {
    const x = padding.left + (plotWidth * index) / 2;
    context.textAlign = index === 0 ? 'left' : index === 2 ? 'right' : 'center';
    const label = timeWindow.duration >= 24 * 60 * 60 * 1000
      ? new Date(time).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : new Date(time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    context.fillText(label, x, height - padding.bottom + 8);
  });

  let hasAnyPoint = false;
  for (const item of series) {
    const targetCount = Math.max(100, Math.min(700, Math.floor(plotWidth * 1.5)));
    const maximumGap = Math.max(30 * 1000, Math.min(5 * 60 * 1000, timeWindow.duration / 20));
    const segments = [];
    let currentSegment = null;
    for (const point of item.values) {
      if (!Number.isFinite(point.value)) {
        currentSegment = null;
        continue;
      }
      if (!currentSegment || point.timestamp - currentSegment[currentSegment.length - 1].timestamp > maximumGap) {
        const nextSegment = [{ ...point, value: Math.min(range.max, Math.max(range.min, point.value)) }];
        segments.push(nextSegment);
        currentSegment = nextSegment;
      } else {
        currentSegment.push({ ...point, value: Math.min(range.max, Math.max(range.min, point.value)) });
      }
    }

    for (const segment of segments) {
      const points = downsampleChartPoints(segment, targetCount).map((point) => {
        const x = padding.left + (plotWidth * (point.timestamp - startTime)) / timeWindow.duration;
        const y = padding.top + plotHeight * (1 - (point.value - range.min) / (range.max - range.min));
        return { x, y, timestamp: point.timestamp, value: point.value };
      });
      if (!points.length) continue;
      hasAnyPoint = true;

      if (item.fill && points.length > 1) {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
        context.lineTo(points[points.length - 1].x, padding.top + plotHeight);
        context.lineTo(points[0].x, padding.top + plotHeight);
        context.closePath();
        const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
        gradient.addColorStop(0, `${item.color}44`);
        gradient.addColorStop(1, `${item.color}00`);
        context.fillStyle = gradient;
        context.fill();
      }

      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
      context.strokeStyle = item.color;
      context.lineWidth = 2;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.shadowColor = item.color;
      context.shadowBlur = 7;
      context.stroke();
      context.shadowBlur = 0;

      const lastPoint = points[points.length - 1];
      context.beginPath();
      context.arc(lastPoint.x, lastPoint.y, 3.4, 0, Math.PI * 2);
      context.fillStyle = item.color;
      context.fill();
      context.beginPath();
      context.arc(lastPoint.x, lastPoint.y, 7, 0, Math.PI * 2);
      context.strokeStyle = `${item.color}66`;
      context.lineWidth = 1;
      context.stroke();
    }
  }

  if (!hasAnyPoint) {
    context.fillStyle = 'rgba(206, 211, 222, 0.6)';
    context.font = '12px Segoe UI, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Aguardando dados locais neste período', padding.left + plotWidth / 2, padding.top + plotHeight / 2);
  }
}

function drawPerformanceCharts() {
  const selectedRange = historyRanges[selectedHistoryRange] || historyRanges['5m'];
  const timeWindow = { duration: selectedRange.duration, end: Date.now() };
  const samples = getChartSamples(timeWindow.duration);
  const line = (key, color, fill = true) => ({
    values: samples.map((sample) => ({ timestamp: sample.timestamp, value: sample[key] })),
    color,
    fill
  });
  const percentRange = { min: 0, max: 100, unit: '%' };
  const temperatureRange = { min: 0, max: 125, unit: '°' };
  drawPerformanceChart('chart-cpu', [line('cpu', '#a996ff')], percentRange, timeWindow);
  drawPerformanceChart('chart-memory', [line('memory', '#63dcc7')], percentRange, timeWindow);
  drawPerformanceChart('chart-disk', [line('disk', '#ffb56b')], percentRange, timeWindow);
  drawPerformanceChart('chart-gpu', [line('gpu', '#96e37c')], percentRange, timeWindow);
  drawPerformanceChart('chart-temperature', [
    line('acpiTemperature', '#a996ff', false),
    line('gpuTemperature', '#63dcc7', false)
  ], temperatureRange, timeWindow);
  document.querySelectorAll('[data-history-window]').forEach((label) => { label.textContent = selectedRange.label; });
  updateChartSummary('chart-cpu-summary', samples, 'cpu', '%');
  updateChartSummary('chart-memory-summary', samples, 'memory', '%');
  updateChartSummary('chart-disk-summary', samples, 'disk', '%');
  updateChartSummary('chart-gpu-summary', samples, 'gpu', '%');
  updateTemperatureSummary(samples);
}

function animatePerformanceCharts() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.metric-chart').forEach((canvas) => {
    if (!canvas.getClientRects().length) return;
    canvas.animate([
      { opacity: 0.74, transform: 'translateY(2px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 360, easing: 'ease-out' });
  });
}

function updateChartSummary(elementId, samples, metric, suffix) {
  const values = samples.map((sample) => sample[metric]).filter(Number.isFinite);
  if (!values.length) {
    const noSensor = metric === 'gpu' || metric === 'temperature';
    setText(elementId, noSensor ? 'Sensor indisponível' : 'Aguardando amostras locais');
    return;
  }
  const average = Math.round(values.reduce((total, value) => total + value, 0) / values.length);
  const peak = Math.round(Math.max(...values));
  setText(elementId, `Média ${average}${suffix} · pico ${peak}${suffix}`);
}

function updateTemperatureSummary(samples) {
  const summaries = [];
  for (const [key, label] of [['acpiTemperature', 'ACPI'], ['gpuTemperature', 'GPU']]) {
    const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
    if (!values.length) continue;
    const average = Math.round(values.reduce((total, value) => total + value, 0) / values.length);
    const peak = Math.round(Math.max(...values));
    summaries.push(`${label} média ${average}° · pico ${peak}°`);
  }
  setText('chart-temperature-summary', summaries.join('  /  ') || 'Sem leituras térmicas neste período');
}

function renderTopProcesses(result) {
  if (!processInsightsList || !result) return;
  const byId = new Map();
  for (const process of [...(result.byCpu || []), ...(result.byMemory || [])]) {
    const id = Number(process.processId) || 0;
    if (!id) continue;
    const existing = byId.get(id) || {
      processId: id,
      name: String(process.name || 'Processo'),
      cpuPercent: 0,
      memoryBytes: 0,
      memoryPercent: 0
    };
    existing.cpuPercent = Math.max(existing.cpuPercent, Number(process.cpuPercent) || 0);
    existing.memoryBytes = Math.max(existing.memoryBytes, Number(process.memoryBytes) || 0);
    existing.memoryPercent = Math.max(existing.memoryPercent, Number(process.memoryPercent) || 0);
    byId.set(id, existing);
  }

  const processes = [...byId.values()]
    .sort((left, right) => Math.max(right.cpuPercent, right.memoryPercent) - Math.max(left.cpuPercent, left.memoryPercent))
    .slice(0, 5);
  processInsightsList.replaceChildren();
  if (!processes.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhum processo em destaque nesta amostra.';
    processInsightsList.append(empty);
    return;
  }

  for (const process of processes) {
    const row = document.createElement('div');
    row.className = 'process-row';
    const identity = document.createElement('div');
    identity.className = 'process-identity';
    const name = document.createElement('strong');
    name.textContent = process.name;
    const pid = document.createElement('small');
    pid.textContent = 'PID ' + process.processId;
    identity.append(name, pid);

    const cpu = document.createElement('div');
    cpu.className = 'process-metric';
    cpu.setAttribute('aria-label', 'CPU ' + Math.round(process.cpuPercent) + '%');
    const cpuLabel = document.createElement('span');
    cpuLabel.textContent = 'CPU ' + Math.round(process.cpuPercent) + '%';
    const cpuTrack = document.createElement('span');
    cpuTrack.className = 'process-track cpu-track';
    const cpuFill = document.createElement('i');
    cpuFill.style.width = Math.min(100, Math.max(0, process.cpuPercent)) + '%';
    cpuTrack.append(cpuFill);
    cpu.append(cpuLabel, cpuTrack);

    const memory = document.createElement('div');
    memory.className = 'process-metric';
    memory.setAttribute('aria-label', 'Memória ' + formatBytes(process.memoryBytes));
    const memoryLabel = document.createElement('span');
    memoryLabel.textContent = 'RAM ' + formatBytes(process.memoryBytes);
    const memoryTrack = document.createElement('span');
    memoryTrack.className = 'process-track memory-track';
    const memoryFill = document.createElement('i');
    memoryFill.style.width = Math.min(100, Math.max(0, process.memoryPercent)) + '%';
    memoryTrack.append(memoryFill);
    memory.append(memoryLabel, memoryTrack);
    row.append(identity, cpu, memory);
    processInsightsList.append(row);
  }
}

async function refreshProcessInsights() {
  if (!desktopBridge?.getTopProcesses) {
    showToast('A leitura de processos está disponível no aplicativo desktop.');
    return;
  }
  setButtonBusy(processRefreshButton, true, 'Analisando...');
  try {
    const result = await desktopBridge.getTopProcesses();
    renderTopProcesses(result);
    showToast('Amostra local de processos atualizada.');
  } catch (error) {
    showToast(error.message || 'Não foi possível ler os processos.');
  } finally {
    setButtonBusy(processRefreshButton, false);
  }
}

processRefreshButton?.addEventListener('click', refreshProcessInsights);

function updatePerformanceCharts(snapshot) {
  const sample = getPerformanceSample(snapshot);
  const lastSample = livePerformanceSamples[livePerformanceSamples.length - 1];
  if (lastSample && sample.timestamp - lastSample.timestamp < 1500) return;
  livePerformanceSamples.push(sample);
  if (livePerformanceSamples.length > maxLivePerformanceSamples) livePerformanceSamples.shift();

  const thermal = snapshot.temperatureReadings || {};
  const gpu = thermal.gpuSensors?.[0] || null;
  const systemTemperature = sample.gpuTemperature ?? sample.acpiTemperature;
  const temperatureSource = sample.gpuTemperature !== null
    ? `${gpu?.name || 'GPU'} NVIDIA`
    : sample.acpiTemperature !== null ? 'Maior zona ACPI' : 'Sem sensor compatível';

  setText('gpu-usage-value', Number.isFinite(gpu?.usagePercent) ? `${gpu.usagePercent}%` : '--');
  setText('gpu-usage-state', gpu
    ? `${gpu.name} · ${gpu.temperatureCelsius === null ? 'sem temperatura' : `${gpu.temperatureCelsius} °C`} · VRAM ${gpu.memoryUsedMb ?? '--'}/${gpu.memoryTotalMb ?? '--'} MB`
    : 'Requer NVIDIA compatível e nvidia-smi');
  setText('system-temperature-value', Number.isFinite(systemTemperature) ? `${systemTemperature} °C` : '--');
  setText('system-temperature-state', temperatureSource);
  setText('chart-cpu-value', `${snapshot.cpuUsage}%`);
  setText('chart-memory-value', `${snapshot.memoryPercent}%`);
  setText('chart-disk-value', snapshot.primaryDrive ? `${snapshot.primaryDrive.usedPercent}%` : '--');
  setText('chart-gpu-value', Number.isFinite(gpu?.usagePercent) ? `${gpu.usagePercent}%` : '--');
  setText('chart-gpu-hardware', gpu ? `${gpu.name} · ${gpu.memoryUsedMb ?? '--'} / ${gpu.memoryTotalMb ?? '--'} MB` : 'Requer nvidia-smi');
  setText('chart-temperature-value', Number.isFinite(systemTemperature) ? `${systemTemperature} °C` : '--');
  setText('chart-temperature-detail', sample.acpiTemperature !== null || sample.gpuTemperature !== null
    ? `${sample.acpiTemperature !== null ? 'ACPI' : ''}${sample.acpiTemperature !== null && sample.gpuTemperature !== null ? ' · ' : ''}${sample.gpuTemperature !== null ? 'GPU NVIDIA' : ''}`
    : 'Sem sensores compatíveis');
  setText('telemetry-updated-at', `Atualizado às ${new Date(sample.timestamp).toLocaleTimeString('pt-BR')}`);
  drawPerformanceCharts();
  animatePerformanceCharts();
}

function formatUptime(seconds) {
  const totalMinutes = Math.max(0, Math.floor((Number(seconds) || 0) / 60));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return [days ? days + 'd' : '', hours ? hours + 'h' : '', minutes + ' min']
    .filter(Boolean)
    .join(' ');
}

function setMeter(id, value) {
  const meter = document.getElementById(id);
  if (!meter) return;
  const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  meter.style.width = percent + '%';
  meter.closest('.stat-box')?.classList.toggle('is-elevated', percent >= 85);
}

function renderSystemSnapshot(snapshot) {
  systemSnapshot = snapshot;
  const primaryDrive = snapshot.primaryDrive;
  const thermal = snapshot.temperatureReadings || {};
  const gpu = thermal.gpuSensors?.[0] || null;
  const acpiTemperature = (thermal.acpiSensors || [])
    .map((sensor) => sensor.celsius)
    .filter(Number.isFinite)
    .reduce((highest, value) => Math.max(highest, value), null);
  const reportedTemperature = gpu?.temperatureCelsius ?? acpiTemperature;
  const cpuText = `${snapshot.cpuUsage}%`;
  const memoryText = `${snapshot.memoryPercent}%`;
  const diskText = primaryDrive ? `${primaryDrive.usedPercent}%` : '--';

  setText('computer-name', snapshot.hostname);
  setText('updates-current-version', snapshot.version);
  const operatingSystemLabel = document.querySelector('.device-meta span');
  if (operatingSystemLabel) operatingSystemLabel.textContent = snapshot.operatingSystem || 'Estação de trabalho';
  setText('cpu-usage-value', cpuText);
  setText('cpu-usage-state', `${snapshot.logicalCpuCount || '--'} threads · leitura local`);
  const cpuState = document.getElementById('cpu-usage-state');
  if (cpuState) cpuState.title = snapshot.cpuModel || '';
  setText('memory-usage-value', memoryText);
  setText('memory-usage-state', `${formatBytes(snapshot.memoryUsedBytes)} de ${formatBytes(snapshot.memoryTotalBytes)}`);
  setText('disk-usage-value', diskText);
  setText('disk-usage-state', primaryDrive
    ? `${formatBytes(primaryDrive.freeBytes)} livres · ${primaryDrive.driveLetter}:`
    : 'Sem dados de unidade');
  setText('chart-disk-name', primaryDrive ? `Espaço em disco · ${primaryDrive.driveLetter}:` : 'Espaço em disco');
  setText('uptime-value', formatUptime(snapshot.uptimeSeconds));
  setText('uptime-detail', 'Desde a última inicialização');
  setMeter('cpu-usage-meter', snapshot.cpuUsage);
  setMeter('memory-usage-meter', snapshot.memoryPercent);
  setMeter('disk-usage-meter', primaryDrive?.usedPercent);
  setMeter('gpu-usage-meter', gpu?.usagePercent);
  setText('overview-cpu', cpuText);
  setText('overview-memory', memoryText);
  setText('overview-disk', primaryDrive ? `${diskText} usado` : '--');
  setText('overview-network', snapshot.networkConnected ? 'Conectada' : 'Desconectada');
  setText('diagnosis-cpu', cpuText);
  setText('diagnosis-memory', memoryText);
  setText('diagnosis-disk', primaryDrive ? `${diskText} usado` : 'Sem dados');
  setText('diagnosis-network', snapshot.networkConnected ? 'Conectada' : 'Desconectada');
  setText('diagnosis-gpu', Number.isFinite(gpu?.usagePercent) ? `${gpu.usagePercent}%` : 'Não detectada');
  setText('diagnosis-temperature', Number.isFinite(reportedTemperature) ? `${reportedTemperature} °C` : 'Não detectada');
  document.querySelector('.online-dot')?.classList.toggle('is-offline', !snapshot.networkConnected);
  setText('system-health-badge', snapshot.cpuUsage >= 90 || snapshot.memoryPercent >= 95 || (primaryDrive && primaryDrive.usedPercent >= 95)
    ? 'Uso elevado detectado'
    : 'Medições atualizadas');
  updatePerformanceCharts(snapshot);

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
  if (snapshotRefreshInProgress) return systemSnapshot;
  snapshotRefreshInProgress = true;
  try {
    const snapshot = await desktopBridge.getSystemSnapshot();
    renderSystemSnapshot(snapshot);
    recordPerformanceSample(snapshot);
    setAppStatus('Monitoramento ativo');
    await maybeRunAutonomousCleanup(snapshot);
    return snapshot;
  } finally {
    snapshotRefreshInProgress = false;
  }
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
    if (sampledProcesses) renderTopProcesses(sampledProcesses);
    const processes = sampledProcesses || { byCpu: [], byMemory: [] };
    const recommendations = [];
    const cpuLeader = processes.byCpu?.[0];
    const memoryLeader = processes.byMemory?.[0];
    const cpuBaseline = getLocalBaseline('cpuPercent');
    const memoryBaseline = getLocalBaseline('memoryPercent');
    const diskBaseline = getLocalBaseline('diskPercent');
    const cpuSpike = cpuBaseline && snapshot.cpuUsage >= 60
      && snapshot.cpuUsage - cpuBaseline.median >= Math.max(25, cpuBaseline.medianAbsoluteDeviation * 3);
    const memorySpike = memoryBaseline && snapshot.memoryPercent >= 70
      && snapshot.memoryPercent - memoryBaseline.median >= Math.max(20, memoryBaseline.medianAbsoluteDeviation * 3);
    const diskIncrease = diskBaseline && snapshot.primaryDrive
      ? snapshot.primaryDrive.usedPercent - diskBaseline.median
      : 0;
    const diskSpike = snapshot.primaryDrive && snapshot.primaryDrive.usedPercent >= 75
      && diskBaseline && diskIncrease >= Math.max(15, diskBaseline.medianAbsoluteDeviation * 3);

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
    if (snapshot.primaryDrive && (snapshot.primaryDrive.usedPercent >= autoCleanDiskThreshold || diskSpike)) {
      let preview = null;
      try {
        preview = await desktopBridge.getCleanupPreview();
      } catch {
        preview = null;
      }
      recommendations.push({
        category: 'disk',
        title: 'Pouco espaço livre',
        cause: `Unidade ${snapshot.primaryDrive.driveLetter}: com ${snapshot.primaryDrive.usedPercent}% ocupado. ${diskSpike ? describeLocalTrend('diskPercent', snapshot.primaryDrive.usedPercent) : ''} ${preview ? `${preview.fileCount} temporários antigos somam ${formatBytes(preview.bytes)}.` : 'Não foi possível calcular os temporários disponíveis.'}`,
        action: preview?.fileCount
          ? `${autoCleanupEnabled ? 'A limpeza automática está ativa.' : 'Revise a prévia e confirme a limpeza.'} Outros arquivos grandes devem ser revisados manualmente.`
          : 'Revise arquivos pessoais grandes; nenhum temporário elegível foi encontrado.',
        actionType: preview?.fileCount ? 'cleanup' : null,
        actionLabel: 'Limpar temporários',
        confidence: preview?.fileCount ? 75 : diskSpike ? 65 : 55
      });
    }
    const hotGpu = snapshot.temperatureReadings?.gpuSensors?.find((sensor) => sensor.temperatureCelsius >= 85);
    if (hotGpu) {
      recommendations.push({
        category: 'gpu-temperature',
        title: 'Temperatura elevada na GPU',
        cause: `${hotGpu.name} reportou ${hotGpu.temperatureCelsius} °C. Esse valor merece comparação com o limite térmico indicado pelo fabricante.`,
        action: 'Confira a ventilação e os limites do fabricante; reduza a carga se essa temperatura persistir fora de jogos ou renderização.',
        confidence: 65
      });
    }
    const hotAcpi = snapshot.temperatureReadings?.acpiSensors?.find((sensor) => sensor.celsius >= 90);
    if (hotAcpi) {
      recommendations.push({
        category: 'acpi-temperature',
        title: 'Zona térmica ACPI elevada',
        cause: `Um sensor do firmware reportou ${hotAcpi.celsius} °C. O nome da zona não identifica com precisão qual componente está medindo.`,
        action: 'Confira se a leitura corresponde a CPU ou GPU e compare com os limites informados pelo fabricante.',
        confidence: 45
      });
    }

    renderDiagnosisRecommendations(recommendations, 'Nenhum gargalo acima dos limites foi detectado nesta amostra. O diagnóstico consulta CPU, RAM, GPU compatível, sensores térmicos, processos, conectividade e espaço em disco.');
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
}, 5000);
