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
    // Porcentagem e temperatura com uma casa no máximo ("8,3 %", não "8,28 %"); tensões e afins precisam de mais.
    const coarse = unit === '%' || unit === '°C';
    const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 || coarse ? 1 : 2;
    const formatted = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);
    if (unit === 'B') return formatBytes(value);
    if (unit === 'B/s') return `${formatBytes(value)}/s`;
    return `${formatted}${unit ? ` ${unit}` : ''}`;
  }

  function renderSensorExplorer() {
    if (!Nexo.state.sensors || !sensorDeviceList) return;
    const snapshot = Nexo.state.sensors;
    // Filtros virtuais de rede (WFP, QoS, LightWeight Filter…) repetem o mesmo adaptador várias vezes: ficam de fora.
    const VIRTUAL_NET = /-WFP |-WFP$|LightWeight Filter|QoS Packet Scheduler|WiFi Filter Driver|Native MAC Layer|WAN Miniport|Kernel Debug|Virtual WiFi Filter/i;
    const devices = (Array.isArray(snapshot.devices) ? snapshot.devices : []).filter((device) => !(device.type === 'Network' && VIRTUAL_NET.test(String(device.name))));
    const query = (sensorSearchInput?.value || '').trim().toLocaleLowerCase('pt-BR');
    const includeAdvanced = Boolean(sensorAdvancedToggle?.checked);
    const categories = [...new Set(devices.map((device) => device.type))];
    const filterLabels = ['all', ...categories];
    const filterKey = `${filterLabels.join('|')}#${selectedSensorCategory}`;
    if (sensorCategoryFilters && sensorCategoryFilters.dataset.key !== filterKey) {
      sensorCategoryFilters.dataset.key = filterKey;
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
      sensorDeviceList.dataset.structure = "";
      sensorDeviceList.innerHTML = `<article class="sheet sensor-empty"><strong>Não foi possível ler os sensores</strong><span>${escapeHtml(message)}</span><small>As leituras básicas do painel continuam funcionando.</small></article>`;
      return;
    }
    if (!visibleDevices.length) {
      sensorDeviceList.dataset.structure = "";
      sensorDeviceList.innerHTML = `<article class="sheet sensor-empty"><strong>${devices.length ? 'Nenhum sensor corresponde ao filtro' : 'Nenhum sensor foi exposto'}</strong><span>${devices.length ? 'Tente outra busca ou categoria, ou inclua sensores avançados.' : 'O Windows, firmware ou os componentes deste PC não disponibilizaram leituras ao Nexo nesta sessão.'}</span></article>`;
      return;
    }

    const cells = (sensor) => {
      const noAccess = sensor.type === 'Temperature' && sensor.value !== null && sensor.value <= 0;
      return [sensor.value === null ? 'Indisponível' : noAccess ? 'Sem acesso ao sensor' : formatSensorValue(sensor.value, sensor.unit),
        sensor.min === null ? '—' : formatSensorValue(sensor.min, sensor.unit), sensor.max === null ? '—' : formatSensorValue(sensor.max, sensor.unit)];
    };
    // Com leituras a cada 2 s, reconstruir centenas de linhas travaria a rolagem: se a estrutura é a mesma,
    // só os números mudam (o resto da tabela, a rolagem e a seleção ficam intactos).
    const structure = visibleDevices.map((device) => `${device.path}|${device.name}:${device.visibleSensors.map((sensor) => `${sensor.name}/${sensor.type}`).join(',')}`).join(';');
    if (sensorDeviceList.dataset.structure === structure) {
      const valueCells = sensorDeviceList.querySelectorAll('tr[data-sensor-row]');
      const flat = visibleDevices.flatMap((device) => device.visibleSensors);
      if (valueCells.length === flat.length) {
        flat.forEach((sensor, index) => {
          const [now, min, max] = cells(sensor);
          const row = valueCells[index].children;
          if (row[2].textContent !== now) row[2].textContent = now;
          if (row[3].textContent !== min) row[3].textContent = min;
          if (row[4].textContent !== max) row[4].textContent = max;
        });
        return;
      }
    }
    sensorDeviceList.dataset.structure = structure;
    sensorDeviceList.innerHTML = visibleDevices.map((device) => {
      const sensorRows = device.visibleSensors.map((sensor) => {
        const [state, minimum, maximum] = cells(sensor);
        return `<tr data-sensor-row class="${sensor.advanced ? 'is-advanced' : ''}"><td><span>${escapeHtml(sensor.name)}</span>${sensor.advanced ? '<small>Avançado</small>' : ''}</td><td>${escapeHtml(sensorMetricLabels[sensor.type] || sensor.type)}</td><td class="sensor-current-value">${escapeHtml(state)}</td><td>${escapeHtml(minimum)}</td><td>${escapeHtml(maximum)}</td></tr>`;
      }).join('');
      const deviceCategory = sensorTypeLabels[device.type] || device.type;
      const noSensor = !device.visibleSensors.length;
      return `<article class="sheet sensor-device-card"><header class="sensor-device-heading"><div><span class="sensor-device-category">${escapeHtml(deviceCategory)}</span><h3>${escapeHtml(device.name)}</h3><small>${escapeHtml(device.path || deviceCategory)}</small></div><span class="sensor-device-total">${device.visibleSensors.length} leituras</span></header>${noSensor ? '<p class="sensor-no-readings">Hardware identificado; nenhum valor de sensor disponível.</p>' : `<div class="sensor-table-wrap"><table class="sensor-table"><thead><tr><th>Sensor</th><th>Métrica</th><th>Agora</th><th>Mín.</th><th>Máx.</th></tr></thead><tbody>${sensorRows}</tbody></table></div>`}</article>`;
    }).join('');
  }

  async function refreshHardwareSensors({ silent = false } = {}) {
    if (sensorRefreshInProgress) return Nexo.state.sensors;
    // Atualização automática (a cada 2 s): sem piscar o título nem desabilitar o botão; só os números mudam.
    const quiet = silent && Nexo.state.sensors?.status === 'ready';
    if (!desktopBridge?.getHardwareSensors) {
      Nexo.state.sensors = { status: 'unavailable', devices: [], sensorCount: 0, issues: [{ message: 'Abra o Nexo para computador para acessar os sensores.' }] };
      renderSensorExplorer();
      return Nexo.state.sensors;
    }
    sensorRefreshInProgress = true;
    if (!quiet) {
      if (sensorRefreshButton) sensorRefreshButton.disabled = true;
      setText('sensor-status-title', 'Lendo hardware localmente');
      setText('sensor-status-detail', 'Atualizando os sensores disponíveis; essa leitura fica neste computador.');
    }
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
      if (!quiet || Nexo.state.view === 'hardware') renderSensorExplorer();
      Nexo.emit('sensors', snapshot);
      return snapshot;
    } finally {
      sensorRefreshInProgress = false;
      if (sensorRefreshButton && !quiet) sensorRefreshButton.disabled = false;
    }
  }

  /* ---------- Serviço de sensores (Windows): temperatura do processador ---------- */
  const serviceBox = document.getElementById('sensor-service');
  const serviceButton = document.getElementById('sensor-service-install');
  async function renderSensorService() {
    if (!serviceBox || !desktopBridge?.getSensorService) return;
    const state = await desktopBridge.getSensorService().catch(() => null);
    if (!state?.supported) { serviceBox.hidden = true; return; }
    serviceBox.hidden = false;
    const ok = state.running && !state.needsInstall;
    serviceBox.dataset.state = ok ? 'ok' : state.setupRunning ? 'busy' : 'off';
    setText('sensor-service-title', ok ? 'Leitura completa ativa' : state.setupRunning ? 'Ativando a leitura completa…' : state.installed ? 'Serviço de sensores precisa ser atualizado' : 'Leitura completa desligada');
    setText('sensor-service-detail', ok ? 'Temperatura do processador e da placa-mãe pelo serviço “Nexo Device Care: sensores”.' : state.setupRunning ? 'O Windows vai pedir permissão (UAC) para instalar o driver PawnIO e o serviço.' : 'Sem o serviço, o Windows não deixa ler a temperatura do processador. Ativar pede permissão de administrador uma vez.');
    serviceButton.hidden = ok || state.setupRunning;
  }
  serviceButton?.addEventListener('click', async () => {
    setButtonBusy(serviceButton, true, 'Aguardando o Windows…');
    try { await desktopBridge.installSensorService(); } catch (error) { showToast(error.message || 'Não foi possível ativar.'); }
    finally { setButtonBusy(serviceButton, false); renderSensorService(); refreshHardwareSensors?.(); }
  });
  desktopBridge?.onSensorSetup?.((event) => {
    if (event.phase === 'start') showToast('Ativando a leitura de temperatura: o Windows vai pedir permissão.');
    else if (event.ok) {
      showToast('Leitura completa ativa: temperatura do processador liberada.');
      // Instalar driver e serviço é uma mudança no sistema: fica no Diário, como tudo o que o Nexo altera.
      Nexo.journal.record({ actionId: 'sensor-service', title: 'Ativar a leitura completa de sensores', risk: 'baixo', reversible: false,
        authorization: 'permissão de administrador (UAC) do Windows', detail: `Serviço “Nexo Device Care: sensores”${event.pawnio === 'instalado' ? ' e driver PawnIO instalados' : event.pawnio === 'já instalado' ? ' instalado (o PawnIO já estava no PC)' : ' instalado'}. Saem ao desinstalar o Nexo.` });
      Nexo.emit('journal');
      recordActivity('Leitura completa de sensores', 'serviço ativo');
    }
    else if (event.declined) showToast('Tudo bem: a leitura completa fica desligada. Dá para ativar em Hardware quando quiser.');
    else showToast(`Não foi possível ativar a leitura completa${event.note ? `: ${event.note}` : '.'}`);
    renderSensorService();
  });
  Nexo.on?.('view', (view) => { if (view === 'hardware') renderSensorService(); });

  sensorCategoryFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sensor-category]');
    if (!button) return;
    selectedSensorCategory = button.dataset.sensorCategory;
    renderSensorExplorer();
  });
  sensorSearchInput?.addEventListener('input', renderSensorExplorer);
  sensorAdvancedToggle?.addEventListener('change', renderSensorExplorer);
  sensorRefreshButton?.addEventListener('click', () => refreshHardwareSensors().catch(() => {}));
  // Excel em português usa vírgula decimal (e o arquivo usa ";" como separador): "45.5" viraria texto ou data.
  const csvNumber = (value) => (Number.isFinite(value) ? String(Math.round(value * 1000) / 1000).replace('.', ',') : '');
  // Nomes que começam com = + - @ seriam lidos como fórmula pela planilha.
  const csvCell = (cell) => { const text = String(cell); return `"${(/^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`; };
  sensorExportButton?.addEventListener('click', () => {
    const rows = [['Componente', 'Categoria', 'Sensor', 'Métrica', 'Valor', 'Unidade', 'Mínimo', 'Máximo', 'Avançado']];
    for (const device of Nexo.state.sensors?.devices || []) {
      for (const sensor of device.sensors || []) {
        rows.push([device.path || device.name, sensorTypeLabels[device.type] || device.type, sensor.name,
          sensorMetricLabels[sensor.type] || sensor.type, csvNumber(sensor.value), sensor.unit || '', csvNumber(sensor.min), csvNumber(sensor.max), sensor.advanced ? 'Sim' : 'Não']);
      }
    }
    if (rows.length === 1) {
      showToast('Ainda não há sensores para exportar.');
      return;
    }
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexo-sensores-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Arquivo CSV salvo localmente.');
  });


  Nexo.refreshSensors = () => refreshHardwareSensors({ silent: true }).catch(() => {});
  Nexo.on('view', (view) => { if (view === 'hardware') refreshHardwareSensors().catch(() => {}); });
  Nexo.commands.push({ label: 'Exportar sensores em CSV', hint: 'Hardware', run: () => { Nexo.go('hardware'); sensorExportButton.click(); } });
})();
