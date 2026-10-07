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

const defaultWallpaper = './assets/default-wallpaper.svg';
const wallpaperStorageKey = 'nexo-wallpaper';

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2200);
}

function setAppStatus(message) {
  if (!appStatusLabel) return;
  appStatusLabel.textContent = message;
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

  breadcrumbCurrent.textContent = labelMap[viewName] || 'Visão geral';
}

viewButtons.forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

const driveCatalog = {
  nvme: {
    type: 'NVMe SSD',
    model: 'C: NVMe SSD 1TB',
    name: 'C: Unidade do sistema',
    temperature: '42°C',
    format: 'NTFS',
    state: 'Saudável',
    usedCapacity: '680 GB',
    totalCapacity: '1 TB',
    usedLabel: '680 GB usados',
    freeLabel: '320 GB livres',
    operationTitle: 'TRIM de manutenção',
    operationDescription: 'Ajuste para reduzir desgaste e melhorar performance do SSD.',
    method: 'TRIM',
    free: 320,
    used: 680,
    total: 1000,
    driveLabel: 'C:'
  },
  hdd: {
    type: 'Disco rígido',
    model: 'D: HDD 2TB',
    name: 'D: Armazenamento',
    temperature: '48°C',
    format: 'NTFS',
    state: 'Leve fragmentação',
    usedCapacity: '1.1 TB',
    totalCapacity: '2 TB',
    usedLabel: '1.1 TB usados',
    freeLabel: '900 GB livres',
    operationTitle: 'Desfragmentação',
    operationDescription: 'Organiza arquivos e melhora o acesso sequencial do disco.',
    method: 'Defrag',
    free: 900,
    used: 1100,
    total: 2000,
    driveLabel: 'D:'
  }
};

function hydrateDriveView(selectedKey) {
  const drive = driveCatalog[selectedKey] || driveCatalog.nvme;
  const total = Math.max(drive.total || 1, 1);
  const usedRatio = Math.min((drive.used || 0) / total, 1);
  document.getElementById('drive-type').textContent = drive.type;
  document.getElementById('drive-model').textContent = drive.model;
  document.getElementById('drive-temp').textContent = drive.temperature;
  document.getElementById('drive-format').textContent = drive.format;
  document.getElementById('drive-state').textContent = drive.state;
  document.getElementById('drive-used-capacity').textContent = drive.usedCapacity;
  document.getElementById('drive-total-capacity').textContent = drive.totalCapacity;
  document.getElementById('drive-used-label').textContent = drive.usedLabel;
  document.getElementById('drive-free-label').textContent = drive.freeLabel;
  document.getElementById('drive-operation-title').textContent = drive.operationTitle;
  document.getElementById('drive-operation-description').textContent = drive.operationDescription;
  document.getElementById('drive-method').textContent = drive.method;
  document.getElementById('drive-capacity-bar').style.width = `${Math.max(usedRatio * 100, 10)}%`;
}

driveSelect.addEventListener('change', (event) => {
  hydrateDriveView(event.target.value);
});

driveOptimizeButton.addEventListener('click', async () => {
  const key = driveSelect.value;
  const selectedDrive = driveCatalog[key] || driveCatalog.nvme;
  setAppStatus(`${selectedDrive.method} em execução`);
  showToast(`${selectedDrive.method} iniciado em ${selectedDrive.driveLabel}.`);

  if (window.nexoDesktop && typeof window.nexoDesktop.optimizeDrive === 'function') {
    try {
      const result = await window.nexoDesktop.optimizeDrive(selectedDrive.driveLabel, selectedDrive.method);
      if (result && result.ok) {
        setAppStatus('Otimização concluída');
        showToast(`Otimização concluída em ${selectedDrive.driveLabel}.`);
      }
    } catch (error) {
      setAppStatus('Modo demonstração');
      showToast('Otimização simulada concluída.');
    }
  }
});

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

const desktopBridge = window.nexoDesktop;
if (desktopBridge && typeof desktopBridge.listDrives === 'function') {
  appStatusLabel.textContent = 'Modo desktop';
  desktopBridge.listDrives().then((items) => {
    if (!items || !items.length) return;
    const options = items
      .map((item, index) => `<option value="${item.id || index}">${item.name}</option>`)
      .join('');
    driveSelect.innerHTML = options;
  }).catch(() => {});
} else {
  updateButton.hidden = true;
}

runDiagnosisButton.addEventListener('click', () => {
  diagnosisResult.textContent = 'Análise concluída: sistema estável, sem erros críticos. Nenhuma falha detectada.';
  setAppStatus('Diagnóstico concluído');
  showToast('Diagnóstico concluído.');
});

runCleanupButton.addEventListener('click', () => {
  setAppStatus('Limpeza em execução');
  showToast('Limpeza executada em modo de demonstração.');
  setTimeout(() => {
    setAppStatus('Sistema limpo');
  }, 1200);
});

runRepairButton.addEventListener('click', () => {
  setAppStatus('Reparo em andamento');
  showToast('Reparo simulado concluído.');
  setTimeout(() => {
    setAppStatus('Reparo concluído');
  }, 1300);
});

const scanButtons = document.querySelectorAll('[data-scan]');
scanButtons.forEach((button) => {
  button.addEventListener('click', () => {
    showToast('Verificação em andamento.');
  });
});

hydrateDriveView('nvme');
setView('overview');
