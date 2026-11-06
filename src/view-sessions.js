/* Sessões de observação: gravar o sistema (1 Hz), a sonda de programas (~5 s) e, se pedido, o FPS; analisar e guardar. */
(function () {
  const MAX_SESSIONS = 10;
  const MAX_SECONDS = 4 * 3600;
  const bridge = desktopBridge;
  let rec = null;
  let starting = false; // evita duas gravações ao mesmo tempo (clique duplo, ou jogo abrindo enquanto a caixa de diálogo está aberta)
  let timers = [];
  let stopProbeListener = null;
  const fps = { status: null, active: false, access: null };
  const FPS_PREF = 'nexo-sess-fps';

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
    current: () => (rec ? { name: rec.name, gameId: rec.gameId, auto: rec.auto, startedAt: rec.startedAt } : null),
    forGame: (gameId, name) => load().filter((session) => (gameId && session.gameId === gameId) || (name && session.report?.game?.name && session.report.game.name.toLowerCase() === String(name).toLowerCase())),
    open: (id) => openReport(id),
    start: (options) => start(options),
    stop: () => stop(),
    clear() { persist([]); renderList(); Nexo.emit('learned'); }
  };

  /* ---------- Componentes ---------- */
  async function refreshFps() {
    try { fps.status = await bridge.getFpsStatus(); } catch { fps.status = { available: false, source: null, name: null, platform: 'desconhecida' }; }
    const status = fps.status;
    const where = status.source === 'escolhido' ? 'escolhido por você' : 'embutido no instalador';
    setText('fps-note', status.available ? `Componente: ${status.name} (${where}). Exige o grupo “Performance Log Users”.` : status.platform && status.platform !== 'win32' ? 'Disponível só no Windows.' : 'Componente não encontrado. Escolha o PresentMon em “Componentes”, mais abaixo.');
    setText('fps-status-text', status.available ? `${status.name} · ${where}` : 'Não encontrado nesta instalação. Reinstale o Nexo pela última versão, ou baixe o PresentMon no site oficial e escolha o arquivo.');
    document.getElementById('fps-clear').hidden = status.source !== 'escolhido';
    if (status.platform === 'linux') {
      setText('fps-note', status.available ? 'MangoHud instalado. Rode o jogo com a opção de inicialização (em Componentes) e o Nexo lê o FPS sozinho.' : 'Instale o MangoHud (pacote "mangohud" da sua distribuição) para medir FPS.');
      setText('mango-status', status.available ? 'Instalado. Na Steam: Propriedades do jogo → Opções de inicialização → cole a linha abaixo. O MangoHud grava o log numa pasta do Nexo, que só lê enquanto a sessão grava.' : 'Não encontrado. Instale o pacote "mangohud" (Flatpak: org.freedesktop.Platform.VulkanLayer.MangoHud).');
      setText('mango-launch', status.launchOption || '');
    }
    await refreshAccess();
    // Primeira vez: com o FPS pronto para medir, a opção já vem ligada. Depois vale a última escolha da pessoa.
    const toggle = document.getElementById('sess-fps');
    let stored = null;
    try { stored = localStorage.getItem(FPS_PREF); } catch { /* sem armazenamento */ }
    if (stored === null && !rec) toggle.checked = Boolean(status.available && (fps.access?.ready || status.platform === 'linux'));
    else if (stored !== null && !rec) toggle.checked = stored === '1';
  }

  /* ---------- Acesso ao FPS: grupo "Performance Log Users", liberado automaticamente com o UAC ---------- */
  async function refreshAccess() {
    try { fps.access = await bridge.getFpsAccess(); } catch { fps.access = null; }
    const access = fps.access;
    const text = !access || access.platform !== 'win32' ? 'Disponível só no Windows.'
      : access.admin ? 'O Nexo está rodando como administrador: o FPS funciona sem o grupo.'
      : access.inToken ? 'Liberado: o seu usuário está no grupo “Performance Log Users”.'
      : access.needsRelogin ? 'Quase lá: você já está no grupo. Saia e entre de novo no Windows (ou reinicie) para valer.'
      : 'Bloqueado: o seu usuário não está no grupo. O Nexo pode liberar sozinho (o Windows pede a sua permissão).';
    setText('fps-access-text', text);
    document.getElementById('fps-grant').hidden = !access || access.platform !== 'win32' || access.ready || access.needsRelogin;
    document.getElementById('fps-revoke').hidden = !access || !(access.member || access.inToken);
  }

  Nexo.grantFpsAccess = async function grantFpsAccess() {
    setAppStatus('Aguardando a permissão do Windows');
    try {
      const result = await bridge.grantFpsAccess();
      if (result.declined) { showToast('Você recusou a permissão no Windows; nada mudou.'); return false; }
      if (!result.ok) { showToast(`O Windows não aceitou: ${result.note || 'motivo desconhecido'}.`); return false; }
      if (result.changed) {
        Nexo.journal.record({ actionId: 'perf-log-users', title: 'Liberar a medição de FPS', risk: 'baixo', reversible: true, before: { member: false }, after: { member: true }, authorization: 'permissão de administrador (UAC) do Windows', detail: 'Usuário adicionado ao grupo Performance Log Users (S-1-5-32-559).' });
        Nexo.emit('journal');
        recordActivity('Acesso ao FPS liberado', 'Grupo Performance Log Users');
      }
      if (result.access?.needsRelogin) await Nexo.confirm({ title: 'Falta só um passo', body: 'O Windows só aplica a mudança de grupo depois que você sai e entra de novo (ou reinicia o PC). Até lá, o FPS só funciona com o Nexo aberto como administrador.', confirmLabel: 'Entendi', cancelLabel: 'Fechar' });
      else showToast('Medição de FPS liberada.');
      return true;
    } catch (error) { showToast(error.message || 'Não foi possível liberar o acesso.'); return false; }
    finally { setAppStatus('Monitoramento ativo'); refreshAccess(); }
  };
  Nexo.revokeFpsAccess = async function revokeFpsAccess() {
    let result;
    try { result = await bridge.revokeFpsAccess(); } catch (error) { showToast(error.message || 'Não foi possível tirar o acesso.'); return false; }
    if (result.declined) { showToast('Você recusou a permissão no Windows; nada mudou.'); return false; }
    if (!result.ok) { showToast(`O Windows não aceitou: ${result.note || 'motivo desconhecido'}.`); return false; }
    refreshAccess();
    showToast('O seu usuário saiu do grupo. Vale a partir da próxima entrada no Windows.');
    return true;
  };

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

  async function start(options = {}) {
    if (rec || starting) return;
    starting = true;
    try { await beginRecording(options); } finally { starting = false; }
  }

  async function beginRecording(options) {
    if (!bridge?.sampleSession) { showToast('As sessões estão disponíveis no aplicativo desktop.'); return; }
    if (Nexo.state.labRunning || Nexo.state.rebootMeasuring) { showToast('O Nexo está medindo o PC agora; a sessão fica para depois.'); return; }
    const auto = options.auto === true;
    if (!fps.status) await refreshFps();
    let useFps = auto ? Boolean(fps.status?.available && fps.access?.ready) : document.getElementById('sess-fps').checked;
    if (!auto && useFps && fps.status?.available && fps.access && fps.access.platform === 'win32' && !fps.access.ready) {
      const choice = await new Promise((resolve) => {
        const dialog = Nexo.dialog({ title: 'Liberar a medição de FPS?', html: `<p>O PresentMon só lê os quadros se o seu usuário estiver no grupo “Performance Log Users”. O Nexo pode fazer isso agora, sozinho: o Windows vai pedir a sua permissão (UAC). ${fps.access.needsRelogin ? 'Você já está no grupo, mas precisa sair e entrar de novo no Windows para valer.' : 'Depois é preciso sair e entrar de novo no Windows.'}</p>`,
          actions: [{ id: 'nofps', label: 'Gravar sem FPS', onClick: () => resolve('nofps') }, ...(fps.access.needsRelogin ? [] : [{ id: 'grant', label: 'Liberar automaticamente', tone: 'primary', onClick: () => resolve('grant') }])] });
        dialog.done.then((answer) => resolve(answer === 'dismiss' ? 'cancel' : answer));
      });
      if (choice === 'cancel') return;
      if (choice === 'grant') await Nexo.grantFpsAccess();
      useFps = Boolean(fps.access?.ready);
    }
    if (!auto && useFps && !fps.status?.available) {
      const proceed = await Nexo.confirm({ title: 'PresentMon não encontrado', body: 'Sem o componente, a sessão grava o sistema e os programas, mas não o FPS. Você pode escolher o arquivo em “Componentes”.', confirmLabel: 'Gravar sem FPS' });
      if (!proceed) return;
      useFps = false;
    }
    rec = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: String(options.name ?? document.getElementById('sess-name').value).trim().slice(0, 60), startedAt: Date.now(), profile: Nexo.profile.id || NexoProfiles.DEFAULT,
      samples: [], probes: [], overheadCpu: [], overheadMem: [], useProbe: auto ? true : document.getElementById('sess-probe').checked, useFps, lastFps: null, fpsResult: null, forcedGame: null, fg: null, probeSelf: null, busy: false,
      auto, gameId: options.gameId || null, watchPid: options.pid || null };
    showLiveError('');
    renderRec();
    setText('live-fg', rec.useProbe ? 'Aguardando o primeiro plano…' : 'Observação detalhada desligada');
    await bridge.sampleSession().catch(() => null); // marca o ponto de partida do uso por núcleo
    if (rec.useProbe) {
      stopProbeListener = bridge.onProbe(onProbe);
      const result = await bridge.startProbe().catch((error) => ({ ok: false, reason: error.message }));
      if (!result.ok) { rec.useProbe = false; showLiveError(result.reason || 'A sonda não pôde ser iniciada.'); }
    }
    timers = [setInterval(tick, 1000), setInterval(() => Nexo.refreshSensors?.(), 5000)];
    Nexo.refreshSensors?.();
    setAppStatus(auto ? `Gravando ${rec.name || 'a sessão'} (automático)` : 'Gravando sessão');
    if (auto && rec.useFps && rec.watchPid) startFps(rec.watchPid);
    if (rec.gameId || auto) Promise.resolve(bridge.updatePresence?.({ kind: 'game', name: rec.name, startedAt: rec.startedAt })).catch(() => {});
    Nexo.emit('session-state');
  }

  async function stop() {
    if (!rec) return;
    const finished = rec;
    rec = null;
    timers.forEach(clearInterval); timers = [];
    Promise.resolve(bridge.updatePresence?.(null)).catch(() => {});
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
    const probeGame = (() => { const counts = new Map(); for (const probe of finished.probes) if (probe.fg?.gameId) counts.set(probe.fg.gameId, (counts.get(probe.fg.gameId) || 0) + 1); return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null; })();
    const record = { id: finished.id, name: label, startedAt: finished.startedAt, endedAt, profile: finished.profile, report, auto: finished.auto, gameId: finished.gameId || probeGame,
      timeline: NexoSession.compactTimeline(finished.samples, finished.startedAt, 5), fpsSeries: fpsResult?.series?.slice(0, 2000) || null };
    const list = load(); list.unshift(record); persist(list);
    renderList();
    recordActivity('Sessão de observação', `${label} · ${clock(report.meta.durationS)}`);
    setAppStatus('Monitoramento ativo');
    Nexo.emit('learned');
    Nexo.emit('session-state');
    if (finished.auto) showToast(`Relatório da sessão de ${label} pronto.`, { label: 'Ver', run: () => { Nexo.go('sessions'); openReport(record.id); } });
    else openReport(record.id);
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
      return `<article class="sheet sess-card" data-id="${escapeHtml(record.id)}"><header><strong>${escapeHtml(record.name)}</strong>${record.report.game ? chip('jogo', 'risk-baixo') : ''}${record.auto ? chip('automática') : ''}</header>
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

  document.getElementById('mango-copy').addEventListener('click', async () => {
    const text = document.getElementById('mango-launch').textContent;
    try { await navigator.clipboard.writeText(text); showToast('Opção de inicialização copiada.'); }
    catch { const range = document.createRange(); range.selectNodeContents(document.getElementById('mango-launch')); getSelection().removeAllRanges(); getSelection().addRange(range); showToast('Selecionado: use Ctrl+C.'); }
  });
  document.getElementById('fps-grant').addEventListener('click', () => Nexo.grantFpsAccess());
  document.getElementById('fps-revoke').addEventListener('click', () => Nexo.revokeFpsAccess());
  document.getElementById('sess-fps').addEventListener('change', (event) => { try { localStorage.setItem(FPS_PREF, event.target.checked ? '1' : '0'); } catch { /* só nesta sessão */ } if (event.target.checked && fps.access && fps.access.platform === 'win32' && !fps.access.ready) showToast(fps.access.needsRelogin ? 'Para o FPS: saia e entre de novo no Windows.' : 'O FPS precisa de uma liberação do Windows.', fps.access.needsRelogin ? null : { label: 'Liberar', run: () => Nexo.grantFpsAccess() }); });
  // Sessão automática: o observador do processo principal avisa quando um jogo abre e fecha.
  bridge?.onWatchGame?.((event) => {
    if (event.type === 'start' && !rec) start({ auto: true, name: event.name, gameId: event.gameId, pid: event.pid });
    if (event.type === 'end' && rec?.auto && (!rec.watchPid || rec.watchPid === event.pid)) stop();
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
