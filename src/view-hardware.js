/* Hardware: explorador de sensores (somente leitura, dados locais). */
(function () {
  const sensorRefreshButton = document.getElementById('sensor-refresh');
  const sensorExportButton = document.getElementById('sensor-export');
  const sensorDeviceList = document.getElementById('sensor-device-list');
  const sensorCategoryFilters = document.getElementById('sensor-category-filters');
  const sensorSearchInput = document.getElementById('sensor-search');
  const sensorAdvancedToggle = document.getElementById('sensor-advanced');
  let selectedSensorCategory = 'all';
  let sensorRefreshInProgress = false;

  const sensorTypeLabels = {
    Motherboard: 'Placa-mãe', SuperIO: 'Controlador da placa-mãe', Cpu: 'Processador', Memory: 'Memória',
    GpuNvidia: 'GPU NVIDIA', GpuAmd: 'GPU AMD', GpuIntel: 'GPU Intel', Storage: 'Armazenamento',
    Network: 'Rede', Cooler: 'Refrigeração', EmbeddedController: 'Controlador embarcado', Psu: 'Fonte',
    Battery: 'Bateria', PowerMonitor: 'Medidor de energia'
  };
  const sensorMetricLabels = {
    Voltage: 'Tensão', Current: 'Corrente', Power: 'Potência', Clock: 'Clock', Temperature: 'Temperatura',
    Load: 'Uso', Frequency: 'Frequência', Fan: 'Ventoinha', Flow: 'Fluxo', Control: 'Controle', Level: 'Nível',
    Factor: 'Fator', Data: 'Dados', Throughput: 'Transferência', TimeSpan: 'Tempo', Timing: 'Latência',
    Energy: 'Energia', Noise: 'Ruído', Conductivity: 'Condutividade', Humidity: 'Umidade'
  };

  function formatSensorValue(value, unit = '') {
    if (!Number.isFinite(value)) return '—';
    const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
    const formatted = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);
    if (unit === 'B') return formatBytes(value);
    if (unit === 'B/s') return `${formatBytes(value)}/s`;
    return `${formatted}${unit ? ` ${unit}` : ''}`;
  }

  function renderSensorExplorer() {
    if (!Nexo.state.sensors || !sensorDeviceList) return;
    const snapshot = Nexo.state.sensors;
    const devices = Array.isArray(snapshot.devices) ? snapshot.devices : [];
    const query = (sensorSearchInput?.value || '').trim().toLocaleLowerCase('pt-BR');
    const includeAdvanced = Boolean(sensorAdvancedToggle?.checked);
    const categories = [...new Set(devices.map((device) => device.type))];
    const filterLabels = ['all', ...categories];
    if (sensorCategoryFilters) {
      sensorCategoryFilters.innerHTML = filterLabels.map((category) => {
        const label = category === 'all' ? 'Tudo' : (sensorTypeLabels[category] || category);
        const active = selectedSensorCategory === category;
        return `<button type="button" data-sensor-category="${escapeHtml(category)}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
      }).join('');
    }

    const visibleDevices = devices.map((device) => ({
      ...device,
      visibleSensors: (Array.isArray(device.sensors) ? device.sensors : []).filter((sensor) => {
        if (!includeAdvanced && sensor.advanced) return false;
        if (selectedSensorCategory !== 'all' && device.type !== selectedSensorCategory) return false;
        const terms = `${device.name} ${device.path} ${sensor.name} ${sensor.type} ${sensorMetricLabels[sensor.type] || ''}`.toLocaleLowerCase('pt-BR');
        return !query || terms.includes(query);
      })
    })).filter((device) => {
      if (selectedSensorCategory !== 'all' && device.type !== selectedSensorCategory) return false;
      if (query && !device.visibleSensors.length && !`${device.name} ${device.path}`.toLocaleLowerCase('pt-BR').includes(query)) return false;
      return device.visibleSensors.length > 0 || (!query && (device.sensors || []).length === 0);
    });

    if (snapshot.status !== 'ready') {
      const message = snapshot.issues?.[0]?.message || 'O coletor detalhado ainda não está disponível.';
      sensorDeviceList.innerHTML = `<article class="sheet sensor-empty"><strong>Não foi possível ler os sensores</strong><span>${escapeHtml(message)}</span><small>As leituras básicas do painel continuam funcionando.</small></article>`;
      return;
    }
    if (!visibleDevices.length) {
      sensorDeviceList.innerHTML = `<article class="sheet sensor-empty"><strong>${devices.length ? 'Nenhum sensor corresponde ao filtro' : 'Nenhum sensor foi exposto'}</strong><span>${devices.length ? 'Tente outra busca ou categoria, ou inclua sensores avançados.' : 'O Windows, firmware ou os componentes deste PC não disponibilizaram leituras ao Nexo nesta sessão.'}</span></article>`;
      return;
    }

    sensorDeviceList.innerHTML = visibleDevices.map((device) => {
      const sensorRows = device.visibleSensors.map((sensor) => {
        const state = sensor.value === null ? 'Indisponível' : formatSensorValue(sensor.value, sensor.unit);
        const maximum = sensor.max === null ? '—' : formatSensorValue(sensor.max, sensor.unit);
        const minimum = sensor.min === null ? '—' : formatSensorValue(sensor.min, sensor.unit);
        return `<tr class="${sensor.advanced ? 'is-advanced' : ''}"><td><span>${escapeHtml(sensor.name)}</span>${sensor.advanced ? '<small>Avançado</small>' : ''}</td><td>${escapeHtml(sensorMetricLabels[sensor.type] || sensor.type)}</td><td class="sensor-current-value">${escapeHtml(state)}</td><td>${escapeHtml(minimum)}</td><td>${escapeHtml(maximum)}</td></tr>`;
      }).join('');
      const deviceCategory = sensorTypeLabels[device.type] || device.type;
      const noSensor = !device.visibleSensors.length;
      return `<article class="sheet sensor-device-card"><header class="sensor-device-heading"><div><span class="sensor-device-category">${escapeHtml(deviceCategory)}</span><h3>${escapeHtml(device.name)}</h3><small>${escapeHtml(device.path || deviceCategory)}</small></div><span class="sensor-device-total">${device.visibleSensors.length} leituras</span></header>${noSensor ? '<p class="sensor-no-readings">Hardware identificado; nenhum valor de sensor disponível.</p>' : `<div class="sensor-table-wrap"><table class="sensor-table"><thead><tr><th>Sensor</th><th>Métrica</th><th>Agora</th><th>Mín.</th><th>Máx.</th></tr></thead><tbody>${sensorRows}</tbody></table></div>`}</article>`;
    }).join('');
  }

  async function refreshHardwareSensors() {
    if (sensorRefreshInProgress) return Nexo.state.sensors;
    if (!desktopBridge?.getHardwareSensors) {
      Nexo.state.sensors = { status: 'unavailable', devices: [], sensorCount: 0, issues: [{ message: 'Abra o Nexo para computador para acessar os sensores.' }] };
      renderSensorExplorer();
      return Nexo.state.sensors;
    }
    sensorRefreshInProgress = true;
    if (sensorRefreshButton) sensorRefreshButton.disabled = true;
    setText('sensor-status-title', 'Lendo hardware localmente');
    setText('sensor-status-detail', 'Atualizando os sensores disponíveis; essa leitura fica neste computador.');
    try {
      Nexo.state.sensors = await desktopBridge.getHardwareSensors();
      const snapshot = Nexo.state.sensors;
      setText('sensor-count', Number(snapshot.sensorCount || 0).toLocaleString('pt-BR'));
      const time = snapshot.collectedAt ? new Date(snapshot.collectedAt) : new Date();
      setText('sensor-updated-at', `Atualizado às ${time.toLocaleTimeString('pt-BR')}`);
      if (snapshot.status === 'ready') {
        setText('sensor-status-title', `${snapshot.sensorCount || 0} leituras disponíveis`);
        const deviceCount = (snapshot.devices || []).length;
        const issueCount = (snapshot.issues || []).length;
        setText('sensor-status-detail', `${deviceCount} componentes detectados · somente leitura local${issueCount ? ` · ${issueCount} componente(s) não responderam` : ''}.`);
      } else {
        setText('sensor-status-title', 'Leitura detalhada indisponível');
        setText('sensor-status-detail', snapshot.issues?.[0]?.message || 'Este sistema não disponibilizou o coletor de hardware.');
      }
      renderSensorExplorer();
      return snapshot;
    } finally {
      sensorRefreshInProgress = false;
      if (sensorRefreshButton) sensorRefreshButton.disabled = false;
    }
  }

  sensorCategoryFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sensor-category]');
    if (!button) return;
    selectedSensorCategory = button.dataset.sensorCategory;
    renderSensorExplorer();
  });
  sensorSearchInput?.addEventListener('input', renderSensorExplorer);
  sensorAdvancedToggle?.addEventListener('change', renderSensorExplorer);
  sensorRefreshButton?.addEventListener('click', () => refreshHardwareSensors().catch(() => {}));
  sensorExportButton?.addEventListener('click', () => {
    const rows = [['Componente', 'Categoria', 'Sensor', 'Métrica', 'Valor', 'Unidade', 'Mínimo', 'Máximo', 'Avançado']];
    for (const device of Nexo.state.sensors?.devices || []) {
      for (const sensor of device.sensors || []) {
        rows.push([device.path || device.name, sensorTypeLabels[device.type] || device.type, sensor.name,
          sensorMetricLabels[sensor.type] || sensor.type, sensor.value ?? '', sensor.unit || '', sensor.min ?? '', sensor.max ?? '', sensor.advanced ? 'Sim' : 'Não']);
      }
    }
    if (rows.length === 1) {
      showToast('Ainda não há sensores para exportar.');
      return;
    }
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexo-sensores-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Arquivo CSV salvo localmente.');
  });


  Nexo.refreshSensors = () => refreshHardwareSensors().catch(() => {});
  Nexo.on('view', (view) => { if (view === 'hardware') Nexo.refreshSensors(); });
  Nexo.commands.push({ label: 'Exportar sensores em CSV', hint: 'Hardware', run: () => { Nexo.go('hardware'); sensorExportButton.click(); } });
})();
