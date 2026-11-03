/* Sessões de observação: gravar o sistema (1 Hz), a sonda de programas (~5 s) e, se pedido, o FPS; analisar e guardar. */
(function () {
  const MAX_SESSIONS = 10;
  const MAX_SECONDS = 4 * 3600;
  const bridge = desktopBridge;
  let rec = null;
  let timers = [];
  let stopProbeListener = null;
  const fps = { status: null, active: false };

  const load = () => { const stored = readJSON(Nexo.keys.sessions, []); return Array.isArray(stored) ? stored : []; };
  const persist = (list) => { if (!writeJSON(Nexo.keys.sessions, list.slice(0, MAX_SESSIONS))) showToast('Não foi possível guardar a sessão neste computador.'); };
  const clock = (total) => { const s = Math.max(0, Math.round(total)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60; return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0').padStart(2, '0')}:${String(r).padStart(2, '0')}`; };
  const pct = (value) => (Number.isFinite(value) ? `${Math.round(value)}%` : '--');
  const dec = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '--');
  const when = (at) => new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const avg = (list) => { const v = list.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

  Nexo.sessions = {
    list: load,
    recent: () => load().slice(0, 4).map((session) => ({ at: session.startedAt, findings: (session.report?.findings || []).filter((finding) => finding.severity !== 'info').map((finding) => finding.id) })),
    isRecording: () => Boolean(rec),
    clear() { persist([]); renderList(); Nexo.emit('learned'); }
  };

  /* ---------- Componentes ---------- */
  async function refreshFps() {
    try { fps.status = await bridge.getFpsStatus(); } catch { fps.status = { available: false, source: null, name: null, platform: 'desconhecida' }; }
    const status = fps.status;
    const where = status.source === 'escolhido' ? 'escolhido por você' : 'embutido no instalador';
    setText('fps-note', status.available ? `Componente: ${status.name} (${where}). Exige o grupo “Performance Log Users”.` : status.platform && status.platform !== 'win32' ? 'Disponível só no Windows.' : 'Componente não encontrado. Escolha o PresentMon em “Componentes”, mais abaixo.');
    setText('fps-status-text', status.available ? `${status.name} · ${where}` : 'Não encontrado. Baixe na página oficial e aponte o arquivo, ou use o embutido quando o hash estiver fixado na build.');
    document.getElementById('fps-clear').hidden = status.source !== 'escolhido';
  }

  /* ---------- Gravação ---------- */
  function showLiveError(message) {
    const box = document.getElementById('live-error');
    box.textContent = message || '';
    box.hidden = !message;
  }

  function renderRec() {
    const recording = Boolean(rec);
    const button = document.getElementById('rec-toggle');
    button.classList.toggle('on', recording);
    button.setAttribute('aria-label', recording ? 'Parar e analisar a sessão' : 'Iniciar sessão');
    button.setAttribute('aria-pressed', String(recording));
    setText('rec-state', recording ? 'Gravando a sessão' : 'Pronto para gravar');
    setText('rec-sub', recording ? 'Use o PC normalmente. Toque no botão para parar e ver o relatório.' : 'Escolha as opções e inicie. Você pode usar o PC normalmente.');
    document.getElementById('rec-options').hidden = recording;
    document.getElementById('rec-live').hidden = !recording;
    if (!recording) setText('rec-clock', '00:00');
  }

  async function startFps(pid) {
    if (!rec?.useFps || fps.active || rec.fpsResult || !pid) return;
    fps.active = true;
    try { await bridge.startFps({ pid }); showLiveError(''); }
    catch (error) { fps.active = false; rec.useFps = false; showLiveError(error.message || 'Não foi possível iniciar a medição de FPS.'); }
  }

  function onProbe(sample) {
    if (!rec) return;
    rec.probes.push(sample);
    if (rec.probes.length > 3000) rec.probes.shift();
    rec.fg = sample.fg;
    rec.probeSelf = sample.self;
    const chip = document.getElementById('live-fg');
    chip.textContent = sample.fg ? `Em primeiro plano: ${sample.fg.name}${sample.fg.isGame || rec.forcedGame === sample.fg.name ? ' · jogo detectado' : ''}` : 'Sem programa em primeiro plano';
    chip.classList.toggle('risk-baixo', Boolean(sample.fg?.isGame || rec.forcedGame === sample.fg?.name));
    const isGame = Boolean(sample.fg?.isGame || (rec.forcedGame && rec.forcedGame === sample.fg?.name));
    document.getElementById('live-mark-game').hidden = !sample.fg || isGame;
    document.getElementById('live-fps-now').hidden = !(rec.useFps && sample.fg && !fps.active && !rec.fpsResult && !isGame);
    if (isGame) startFps(sample.fg.pid);
  }

  async function tick() {
    if (!rec || rec.busy) return;
    rec.busy = true;
    try {
      const raw = await bridge.sampleSession();
      const deep = Nexo.store.deepMetrics();
      const temps = [deep.cpuTemperature, deep.gpuTemperature].filter(Number.isFinite);
      const sample = { t: raw.t, cpu: raw.cpu, maxCore: raw.maxCore, mem: raw.mem, gpu: Number.isFinite(deep.gpuLoad) ? deep.gpuLoad : null, temp: temps.length ? Math.max(...temps) : null, clockRatio: Nexo.store.brain.clockRatio(deep.cpuClock), fps: rec.lastFps ?? null };
      if (Number.isFinite(raw.cpu)) rec.samples.push(sample);
      rec.overheadCpu.push((raw.appCpu || 0) + (rec.probeSelf?.cpu || 0));
      rec.overheadMem.push((raw.appMemMB || 0) + (rec.probeSelf?.memMB || 0));
      setText('rec-clock', clock((Date.now() - rec.startedAt) / 1000));
      setText('live-cpu', pct(sample.cpu)); setText('live-core', pct(sample.maxCore)); setText('live-gpu', pct(sample.gpu)); setText('live-mem', pct(sample.mem));
      setText('live-temp', Number.isFinite(sample.temp) ? `${Math.round(sample.temp)} °C` : '--');
      setText('live-fps', Number.isFinite(rec.lastFps) ? dec(rec.lastFps, 0) : '--');
      setText('live-overhead', `Custo do Nexo nesta sessão: ${dec(avg(rec.overheadCpu), 1)}% da CPU e ${dec(avg(rec.overheadMem), 0)} MB (inclui a sonda; não inclui o PresentMon).`);
      drawLive();
      if (rec.samples.length >= MAX_SECONDS) stop();
    } catch (error) { showLiveError(error.message || 'Falha ao ler o sistema.'); }
    finally { if (rec) rec.busy = false; }
  }

  function drawLive() {
    const tail = rec.samples.slice(-120);
    if (tail.length < 2) return;
    const colors = Nexo.charts.palette();
    const series = (key) => tail.map((sample) => [sample.t, sample[key]]);
    const lines = [{ label: 'CPU', color: colors.cpu, data: series('cpu') }, { label: 'Núcleo', color: colors.acpi, data: series('maxCore') }, { label: 'Memória', color: colors.mem, data: series('mem') }];
    if (tail.some((sample) => Number.isFinite(sample.gpu))) lines.splice(2, 0, { label: 'Vídeo', color: colors.gpu, data: series('gpu') });
    Nexo.charts.render(document.getElementById('live-chart'), { from: tail[0].t, to: tail[tail.length - 1].t, yMin: 0, yMax: 100, unit: '%', fill: false, series: lines, bands: [{ from: 95, to: 100, color: 'rgba(255, 122, 149, 0.08)' }] }, null);
  }

  async function start() {
    if (rec) return;
    if (!bridge?.sampleSession) { showToast('As sessões estão disponíveis no aplicativo desktop.'); return; }
    let useFps = document.getElementById('sess-fps').checked;
    if (useFps && !fps.status?.available) {
      const proceed = await Nexo.confirm({ title: 'PresentMon não encontrado', body: 'Sem o componente, a sessão grava o sistema e os programas, mas não o FPS. Você pode escolher o arquivo em “Componentes”.', confirmLabel: 'Gravar sem FPS' });
      if (!proceed) return;
      useFps = false;
    }
    rec = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: document.getElementById('sess-name').value.trim().slice(0, 60), startedAt: Date.now(), profile: Nexo.profile.id || NexoProfiles.DEFAULT,
      samples: [], probes: [], overheadCpu: [], overheadMem: [], useProbe: document.getElementById('sess-probe').checked, useFps, lastFps: null, fpsResult: null, forcedGame: null, fg: null, probeSelf: null, busy: false };
    showLiveError('');
    renderRec();
    setText('live-fg', rec.useProbe ? 'Aguardando o primeiro plano…' : 'Observação detalhada desligada');
    await bridge.sampleSession(); // marca o ponto de partida do uso por núcleo
    if (rec.useProbe) {
      stopProbeListener = bridge.onProbe(onProbe);
      const result = await bridge.startProbe();
      if (!result.ok) { rec.useProbe = false; showLiveError(result.reason || 'A sonda não pôde ser iniciada.'); }
    }
    timers = [setInterval(tick, 1000), setInterval(() => Nexo.refreshSensors?.(), 5000)];
    Nexo.refreshSensors?.();
    setAppStatus('Gravando sessão');
  }

  async function stop() {
    if (!rec) return;
    const finished = rec;
    rec = null;
    timers.forEach(clearInterval); timers = [];
    stopProbeListener?.(); stopProbeListener = null;
    renderRec();
    setAppStatus('Analisando sessão');
    let fpsResult = finished.fpsResult;
    if (!fpsResult && (fps.active || finished.useFps)) { try { fpsResult = await bridge.stopFps(); } catch { fpsResult = null; } }
    fps.active = false;
    if (finished.useProbe) await bridge.stopProbe().catch(() => {});
    const endedAt = Date.now();
    const memory = finished.overheadMem.filter(Number.isFinite);
    const overhead = { cpuAvg: avg(finished.overheadCpu), cpuMax: finished.overheadCpu.length ? Math.max(...finished.overheadCpu) : null, memMB: avg(memory), note: 'Inclui o Nexo e a sonda; não inclui o PresentMon.' };
    const report = NexoSession.analyze({ name: finished.name, profile: finished.profile, startedAt: finished.startedAt, endedAt, samples: finished.samples, probes: finished.probes, fps: fpsResult?.summary || null,
      overhead, hasGpuSensor: finished.samples.some((sample) => Number.isFinite(sample.gpu)), forcedGame: finished.forcedGame });
    const label = finished.name || (report.game ? `${report.game.name}` : `Sessão de ${when(finished.startedAt)}`);
    const record = { id: finished.id, name: label, startedAt: finished.startedAt, endedAt, profile: finished.profile, report,
      timeline: NexoSession.compactTimeline(finished.samples, finished.startedAt, 5), fpsSeries: fpsResult?.series?.slice(0, 2000) || null };
    const list = load(); list.unshift(record); persist(list);
    renderList();
    recordActivity('Sessão de observação', `${label} · ${clock(report.meta.durationS)}`);
    setAppStatus('Monitoramento ativo');
    Nexo.emit('learned');
    openReport(record.id);
  }

  /* ---------- Relatório ---------- */
  const chip = (text, extra = '') => `<span class="chip ${extra}">${escapeHtml(text)}</span>`;

  function findingHtml(finding) {
    return `<article class="insight" data-severity="${finding.severity}"><div class="insight-head"><span class="sev" aria-hidden="true"><svg><use href="#${finding.severity === 'info' ? 'i-spark' : 'i-alert'}"/></svg></span><strong>${escapeHtml(finding.title)}</strong><span>confiança ${finding.confidence}%</span></div>
      <p>${escapeHtml(finding.detail)}</p><ul>${finding.evidence.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      ${finding.limits?.length ? `<ul class="limits">${finding.limits.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}</article>`;
  }

  function fpsHtml(summary) {
    const rows = [['FPS médio', dec(summary.avgFps, 0)], ['1% baixo', dec(summary.p1LowFps, 0)], ['0,1% baixo', dec(summary.p01LowFps, 0)], ['Tempo de quadro (mediana)', `${dec(summary.frameMs.p50)} ms`], ['Tempo de quadro (p99)', `${dec(summary.frameMs.p99)} ms`], ['Quadros lentos', String(summary.stutterCount)]];
    if (summary.hasBusy) rows.push(['Quadros limitados pela GPU', `${dec(summary.gpuBoundShare * 100, 0)}%`], ['Quadros limitados pela CPU', `${dec(summary.cpuBoundShare * 100, 0)}%`]);
    return `<h4>FPS e tempo de quadro</h4><table class="exp"><tbody>${rows.map(([name, value]) => `<tr><th>${name}</th><td>${value}</td></tr>`).join('')}</tbody></table><div class="chart-body rep-chart"><canvas id="rep-fps" role="img" aria-label="FPS ao longo da sessão"></canvas></div>
      <p class="muted">“1% baixo” é o FPS correspondente ao percentil 99 do tempo de quadro. “Quadro lento” é o que levou mais que o dobro da mediana e mais de 30 ms.</p>`;
  }

  function reportHtml(record) {
    const r = record.report;
    const m = r.meta;
    const fg = r.foreground.length ? `<ul class="fg-list">${r.foreground.map((item) => `<li><span>${escapeHtml(item.name)}</span><b>${clock(item.seconds)}</b>${item.isGame ? chip('jogo', 'risk-baixo') : ''}</li>`).join('')}</ul>` : '<p class="muted">Sem dados de primeiro plano (observação detalhada desligada ou indisponível).</p>';
    const bg = [r.background.cpu ? `CPU: ${r.background.cpu.name} (média ${dec(r.background.cpu.avg)}% em ${dec(r.background.cpu.presence * 100, 0)}% das leituras)` : null, r.background.gpu ? `GPU: ${r.background.gpu.name} (média ${dec(r.background.gpu.avg)}%)` : null].filter(Boolean);
    return `<div class="chips-row">${chip(`${clock(m.durationS)} de sessão`)}${chip(NexoProfiles.get(record.profile).nome)}${r.game ? chip(`Jogo: ${r.game.name}`, 'risk-baixo') : ''}${chip(m.hasFps ? 'FPS medido' : 'Sem FPS')}${chip(m.hasGpuSensor ? 'Sensor de GPU' : 'Sem sensor de GPU')}</div>
      <p class="verdict">${escapeHtml(r.conclusion)}</p>
      <div class="findings">${r.findings.map(findingHtml).join('')}</div>
      <h4>Linha do tempo</h4><div class="chart-body rep-chart"><canvas id="rep-chart" role="img" aria-label="Uso de CPU, vídeo e memória ao longo da sessão"></canvas></div>
      ${r.fps ? fpsHtml(r.fps) : ''}
      <h4>Programas em primeiro plano</h4>${fg}
      ${bg.length ? `<h4>Quem pesou em segundo plano</h4><ul>${bg.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
      ${r.overhead ? `<h4>Custo do Nexo</h4><p>Média de ${dec(r.overhead.cpuAvg)}% da CPU (pico ${dec(r.overhead.cpuMax)}%) e ${dec(r.overhead.memMB, 0)} MB. ${escapeHtml(r.overhead.note)}</p>` : ''}
      <p class="muted">${escapeHtml(r.limits)}</p>`;
  }

  function drawReportCharts(record) {
    const colors = Nexo.charts.palette();
    const start = record.startedAt;
    const at = (point) => start + point.s * 1000;
    const series = (key) => record.timeline.map((point) => [at(point), point[key]]);
    const lines = [{ label: 'CPU', color: colors.cpu, data: series('cpu') }, { label: 'Núcleo', color: colors.acpi, data: series('maxCore') }, { label: 'Memória', color: colors.mem, data: series('mem') }];
    if (record.timeline.some((point) => Number.isFinite(point.gpu))) lines.splice(2, 0, { label: 'Vídeo', color: colors.gpu, data: series('gpu') });
    const chart = document.getElementById('rep-chart');
    if (chart) Nexo.charts.render(chart, { from: start, to: record.endedAt, yMin: 0, yMax: 100, unit: '%', fill: false, key: `rep:${record.id}`, series: lines, bands: [{ from: 95, to: 100, color: 'rgba(255, 122, 149, 0.08)' }] }, null);
    const fpsCanvas = document.getElementById('rep-fps');
    if (fpsCanvas && record.fpsSeries?.length > 1) {
      const step = (record.endedAt - start) / record.fpsSeries.length;
      Nexo.charts.render(fpsCanvas, { from: start, to: record.endedAt, unit: ' fps', fill: true, key: `fps:${record.id}`, series: [{ label: 'FPS', color: colors.gpu, data: record.fpsSeries.map((value, index) => [start + index * step, value]) }] }, null);
    }
  }

  function exportRecord(record) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexo-sessao-${new Date(record.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Sessão exportada para um arquivo local.');
  }

  function openReport(id) {
    const record = load().find((session) => session.id === id);
    if (!record) return;
    const dialog = Nexo.dialog({ title: record.name, wide: true, html: reportHtml(record), actions: [
      { id: 'export', label: 'Exportar JSON', keepOpen: true, onClick: () => exportRecord(record) },
      { id: 'delete', label: 'Excluir', tone: 'danger' }, { id: 'close', label: 'Fechar', tone: 'primary' }] });
    requestAnimationFrame(() => drawReportCharts(record));
    dialog.done.then(async (answer) => {
      if (answer !== 'delete') return;
      const confirmed = await Nexo.confirm({ title: 'Excluir esta sessão?', body: 'O relatório e a linha do tempo serão apagados deste computador.', confirmLabel: 'Excluir', tone: 'danger' });
      if (!confirmed) { openReport(id); return; }
      persist(load().filter((session) => session.id !== id));
      renderList();
      Nexo.emit('learned');
      showToast('Sessão excluída.');
    });
  }

  function renderList() {
    const list = load();
    const box = document.getElementById('sess-list');
    document.getElementById('sess-clear').hidden = list.length === 0;
    box.innerHTML = list.length ? list.map((record) => {
      const findings = record.report.findings.filter((finding) => finding.severity !== 'info').slice(0, 3);
      return `<article class="sheet sess-card" data-id="${escapeHtml(record.id)}"><header><strong>${escapeHtml(record.name)}</strong>${record.report.game ? chip('jogo', 'risk-baixo') : ''}</header>
        <div class="j-meta">${when(record.startedAt)} · ${clock(record.report.meta.durationS)} · ${escapeHtml(NexoProfiles.get(record.profile).nome)}${record.report.fps ? ` · ${dec(record.report.fps.avgFps, 0)} FPS médios` : ''}</div>
        <p class="sess-concl">${escapeHtml(record.report.conclusion)}</p>
        <div class="chips-row">${findings.map((finding) => chip(finding.title, finding.severity === 'bad' ? 'risk-alto' : 'risk-moderado')).join('')}</div>
        <button class="btn sm" type="button" data-open="${escapeHtml(record.id)}">Ver relatório</button></article>`;
    }).join('') : `<div class="sheet empty-art">${Nexo.constellation()}<span>Nenhuma sessão gravada ainda. Inicie uma enquanto joga ou trabalha para ver onde está o limite do seu PC.</span></div>`;
  }

  /* ---------- Ligações ---------- */
  document.getElementById('rec-toggle').addEventListener('click', () => (rec ? stop() : start()));
  document.getElementById('sess-list').addEventListener('click', (event) => { const open = event.target.closest('[data-open]'); if (open) openReport(open.dataset.open); });
  document.getElementById('sess-clear').addEventListener('click', async () => {
    if (await Nexo.confirm({ title: 'Apagar todas as sessões?', body: 'Os relatórios e as linhas do tempo salvos serão removidos deste computador.', confirmLabel: 'Apagar', tone: 'danger' })) { Nexo.sessions.clear(); showToast('Sessões apagadas.'); }
  });
  document.getElementById('live-mark-game').addEventListener('click', () => { if (!rec?.fg) return; rec.forcedGame = rec.fg.name; onProbe({ ...rec.probes[rec.probes.length - 1] }); showToast(`${rec.fg.name} marcado como jogo nesta sessão.`); });
  document.getElementById('live-fps-now').addEventListener('click', () => { if (rec?.fg) startFps(rec.fg.pid); });
  document.getElementById('fps-choose').addEventListener('click', async () => { try { const status = await bridge.chooseFps(); if (!status.canceled) showToast('PresentMon escolhido.'); } catch (error) { showToast(error.message || 'Não foi possível usar este arquivo.'); } refreshFps(); });
  document.getElementById('fps-clear').addEventListener('click', async () => { await bridge.clearFps(); refreshFps(); });
  document.getElementById('fps-download').addEventListener('click', () => bridge?.openLink?.('presentmon'));
  document.getElementById('probe-test').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setButtonBusy(button, true, 'Testando…');
    setText('probe-result', 'Aguardando a primeira leitura (até 20 segundos)…');
    try {
      const result = await bridge.testProbe();
      if (!result.ok) { setText('probe-result', result.reason); return; }
      const sample = result.sample;
      setText('probe-result', `Funcionou. Primeiro plano: ${sample.fg ? `${sample.fg.name}${sample.fg.isGame ? ' (jogo)' : ''}` : 'nenhum'}. CPU por programa: ${sample.cpu.length ? 'sim' : 'nenhum programa se destacou agora'}. GPU por programa: ${sample.gpu.length ? 'sim' : 'nenhum programa usando a GPU agora ou contador indisponível'}. Custo da sonda: cerca de ${dec(sample.self?.cpu)}% da CPU e ${dec(sample.self?.memMB, 0)} MB.`);
    } catch (error) { setText('probe-result', error.message || 'O teste falhou.'); }
    finally { setButtonBusy(button, false); }
  });

  bridge?.onFpsUpdate?.((update) => { if (rec) rec.lastFps = update.fps; });
  bridge?.onFpsError?.((error) => { fps.active = false; if (rec) { rec.useFps = false; } showLiveError(error.message); showToast('A medição de FPS não pôde ser feita. Veja a explicação na sessão.'); });
  bridge?.onFpsEnded?.(async () => { fps.active = false; if (rec && !rec.fpsResult) { try { rec.fpsResult = await bridge.stopFps(); } catch { /* o resumo final tenta de novo */ } } });

  Nexo.on('view', (view) => { if (view === 'sessions') { refreshFps(); renderList(); } });
  Nexo.commands.push(
    { label: 'Iniciar sessão de observação', hint: 'Sessões', run: () => { Nexo.go('sessions'); if (!rec) start(); } },
    { label: 'Parar a sessão e ver o relatório', hint: 'Sessões', run: () => { if (rec) stop(); else showToast('Nenhuma sessão em andamento.'); } }
  );
  renderRec();
  renderList();
  refreshFps();
})();
