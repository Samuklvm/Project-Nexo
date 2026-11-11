/*
 * Análise profunda na tela: a constelação do PC (cada peça acende quando é examinada), a linha do que o Nexo está
 * fazendo agora, as últimas descobertas e o relatório no fim. A coleta e as regras ficam no processo principal
 * (electron/deep-run.cjs) e em src/deep-analysis.js; aqui só desenha.
 * Movimento reduzido do sistema ou modo Leve: a constelação fica parada (só as cores mudam).
 */
(function () {
  const bridge = desktopBridge;
  const panel = document.getElementById('deep-panel');
  if (!panel) return;
  const intro = document.getElementById('deep-intro');
  const runBox = document.getElementById('deep-run');
  const reportBox = document.getElementById('deep-report');
  const sky = document.getElementById('deep-sky');
  const factsList = document.getElementById('deep-facts');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const NODES = NexoDeep.NODES;
  const STAGES = NexoDeep.STAGES;
  const POS = { cpu: [190, 70], memory: [420, 58], board: [310, 148], gpu: [522, 152], disk: [108, 178], windows: [236, 238], network: [452, 236] };
  const EDGES = [['cpu', 'memory'], ['cpu', 'board'], ['memory', 'board'], ['board', 'gpu'], ['board', 'disk'], ['board', 'windows'], ['board', 'network'], ['windows', 'network'], ['gpu', 'network'], ['disk', 'windows'], ['memory', 'gpu']];
  const SEVERITY = { alta: 'Resolver', media: 'Vale ajustar', baixa: 'Sugestão', info: 'Para saber', ok: 'Certo' };
  const CONFIDENCE = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa' };
  const AREA = { memoria: 'Memória', video: 'Vídeo e tela', disco: 'Disco', windows: 'Windows', processador: 'Processador', rede: 'Rede', energia: 'Energia', fundo: 'Por trás' };
  let running = false;
  let startedAt = 0;
  let clock = null;
  let lastReport = null;
  let loadedLast = false;

  /* ---------------- Constelação ---------------- */
  function drawSky() {
    if (sky.dataset.ready) return;
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const dust = Array.from({ length: 46 }, () => `<circle class="deep-dust" cx="${Math.round(rand() * 640)}" cy="${Math.round(rand() * 280)}" r="${(0.5 + rand() * 1.1).toFixed(2)}" />`).join('');
    const edges = EDGES.map(([a, b]) => `<line class="deep-edge" data-a="${a}" data-b="${b}" x1="${POS[a][0]}" y1="${POS[a][1]}" x2="${POS[b][0]}" y2="${POS[b][1]}" pathLength="1" />`).join('');
    const stars = NODES.map((item) => {
      const [x, y] = POS[item.id];
      return `<g class="deep-star" data-node="${item.id}" data-state="pending" transform="translate(${x} ${y})">
        <circle class="deep-halo" r="22" /><circle class="deep-ring" r="15" /><circle class="deep-core" r="5.5" />
        <text class="deep-label" y="${item.id === 'cpu' || item.id === 'memory' ? -26 : 34}">${escapeHtml(item.label)}</text></g>`;
    }).join('');
    const comets = `<g class="deep-orbit" aria-hidden="true">${[0, 1, 2].map((i) => `<circle class="deep-comet" cx="${310 + 118 * Math.cos(i * 2.1)}" cy="${148 + 62 * Math.sin(i * 2.1)}" r="2.4" />`).join('')}</g>`;
    sky.innerHTML = `<g class="deep-dusts">${dust}</g><g class="deep-edges">${edges}</g>${comets}<g class="deep-stars">${stars}</g>`;
    sky.dataset.ready = '1';
  }
  const calm = () => reduce.matches || Nexo.effectsLite;

  /*
   * Movimento no relógio único do app (30 quadros): pulso e anel da peça que está sendo examinada, cometas na
   * observação e o ponto do "agora". Parado com movimento reduzido, no modo Leve, com o app fora de foco e durante o
   * teste de carga (a animação não pode pesar na própria medição).
   */
  let motion = null;
  function startMotion() {
    if (motion || !Nexo.clock) return;
    const orbit = () => sky.querySelector('.deep-orbit');
    const dot = panel.querySelector('.deep-dot');
    motion = (now) => {
      if (!running || runBox.hidden) { motion = null; if (dot) { dot.style.opacity = ''; } return false; }
      if (calm() || document.hidden || sky.dataset.stage === 'load') return true;
      const t = now / 1000;
      for (const star of sky.querySelectorAll('.deep-star[data-state="active"]')) {
        star.querySelector('.deep-halo')?.setAttribute('transform', `scale(${(1 + 0.16 * Math.sin(t * 3.9)).toFixed(3)})`);
        star.querySelector('.deep-ring')?.setAttribute('transform', `rotate(${Math.round((t * 60) % 360)})`);
      }
      if (sky.dataset.stage === 'behind') orbit()?.setAttribute('transform', `rotate(${Math.round((t * 40) % 360)} 310 148)`);
      if (dot) dot.style.opacity = (0.65 + 0.35 * Math.cos(t * 5.2)).toFixed(2);
      return true;
    };
    Nexo.clock.add(motion);
  }

  function paintSky(progress) {
    drawSky();
    if (progress.status === 'running') startMotion();
    sky.classList.toggle('calm', calm());
    const stage = STAGES[progress.stageIndex]?.id || (progress.status === 'done' ? 'done' : '');
    sky.dataset.stage = progress.status === 'running' ? stage : progress.status;
    for (const star of sky.querySelectorAll('.deep-star')) {
      const state = progress.nodes?.[star.dataset.node] || 'pending';
      if (star.dataset.state !== state) {
        star.dataset.state = state;
        if (state !== 'active') { star.querySelector('.deep-halo')?.removeAttribute('transform'); star.querySelector('.deep-ring')?.removeAttribute('transform'); }
      }
      star.dataset.hot = stage === 'load' && progress.status === 'running' && (star.dataset.node === 'cpu' || star.dataset.node === 'gpu') && state === 'active' ? '1' : '';
    }
    const lit = (id) => ['done', 'warn', 'seen', 'active'].includes(progress.nodes?.[id]);
    const done = (id) => ['done', 'warn'].includes(progress.nodes?.[id]);
    for (const edge of sky.querySelectorAll('.deep-edge')) {
      const a = edge.dataset.a;
      const b = edge.dataset.b;
      edge.dataset.state = done(a) && done(b) ? 'done' : lit(a) && lit(b) ? 'seen' : 'pending';
    }
  }

  /* ---------------- Progresso ---------------- */
  const minutes = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function tickClock() { setText('deep-time', minutes(Date.now() - startedAt)); }

  function renderProgress(progress) {
    if (!progress || progress.status === 'done') return;
    show('run');
    paintSky(progress);
    startedAt = Date.now() - (Number(progress.elapsedMs) || 0);
    tickClock();
    const index = Math.min(STAGES.length - 1, progress.stageIndex || 0);
    const stage = STAGES[index];
    let within = 0.45;
    if (stage.id === 'behind' && progress.observed?.of) within = Math.min(1, progress.observed.done / progress.observed.of);
    const pct = Math.min(100, ((index + within) / STAGES.length) * 100);
    const fill = document.getElementById('deep-bar-fill');
    if (fill) fill.dataset.css = `width:${pct.toFixed(1)}%`;
    document.getElementById('deep-bar')?.setAttribute('aria-valuenow', String(index + 1));
    setText('deep-count', `${index + 1} de ${STAGES.length} · ${stage.label}`);
    setText('deep-action', progress.status === 'cancelled' ? 'Análise cancelada.' : progress.status === 'error' ? `Não consegui terminar: ${progress.error || 'erro desconhecido'}` : `${progress.action || '…'}`);
    const facts = (progress.facts || []).slice(-5);
    const key = facts.map((item) => item.text).join('|');
    if (factsList.dataset.key !== key) {
      factsList.dataset.key = key;
      factsList.innerHTML = facts.map((item, i) => `<li data-level="${escapeHtml(item.level || 'info')}"${i === facts.length - 1 ? ' class="fresh"' : ''}>${escapeHtml(item.text)}</li>`).join('');
    }
  }

  function show(which) {
    intro.hidden = which !== 'intro';
    runBox.hidden = which !== 'run';
    reportBox.hidden = which !== 'report';
    panel.dataset.mode = which;
  }

  /* ---------------- Despertar da placa de vídeo (link PCIe sob carga) ---------------- */
  // Um shader pesado num canvas fora da tela por alguns segundos: a placa sai do repouso e o link PCIe sobe ao máximo.
  function gpuWake(ms) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance', antialias: false }) || canvas.getContext('webgl', { powerPreference: 'high-performance' });
    if (!gl) return;
    const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); return shader; };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, 'precision highp float;uniform float t;void main(){vec2 u=gl_FragCoord.xy/1024.0;float a=0.0;for(int i=0;i<160;i++){float f=float(i);a+=sin(u.x*f+t)*cos(u.y*f-t*0.7)/(1.0+f);}gl_FragColor=vec4(a,a*0.5,1.0-a,1.0);}'));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const time = gl.getUniformLocation(program, 't');
    const until = performance.now() + Math.min(10000, Math.max(1000, Number(ms) || 6000));
    const frame = (now) => {
      for (let i = 0; i < 4; i += 1) { gl.uniform1f(time, now / 1000 + i); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.finish();
      if (now < until) requestAnimationFrame(frame);
      else gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    requestAnimationFrame(frame);
  }

  /* ---------------- Relatório ---------------- */
  const n = (value, digits = 0) => (Number.isFinite(value) ? Number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—');
  const mb = (bytes) => (bytes >= 1048576 * 10 ? `${Math.round(bytes / 1048576)} MB/s` : `${n(bytes / 1048576, 1)} MB/s`);
  const duration = (ms) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
  const toneOf = (score) => (score >= 80 ? 'good' : score >= 55 ? 'warn' : 'bad');

  function actionButton(action) {
    if (!action) return '';
    if (action.settings && Nexo.platform !== 'linux') return `<button class="btn sm" type="button" data-deep-settings="${escapeHtml(action.settings)}">Abrir no Windows</button>`;
    if (action.goto) return `<button class="btn sm" type="button" data-deep-goto="${escapeHtml(action.goto)}">Abrir no Nexo</button>`;
    if (action.taskManager) return `<button class="btn sm" type="button" data-deep-taskmgr="1">Gerenciador de Tarefas</button>`;
    return '';
  }

  function findingHtml(item) {
    const evidence = (item.evidence || []).filter(Boolean);
    return `<article class="finding" data-severity="${escapeHtml(item.severity)}">
      <header><span class="finding-tag">${escapeHtml(SEVERITY[item.severity] || item.severity)}</span><strong>${escapeHtml(item.title)}</strong><span class="finding-area">${escapeHtml(AREA[item.area] || '')}</span></header>
      ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}
      ${evidence.length ? `<ul class="finding-evidence">${evidence.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
      ${item.action?.how ? `<p class="finding-how"><b>O que fazer:</b> ${escapeHtml(item.action.how)}</p>` : ''}
      <footer><span>${escapeHtml(CONFIDENCE[item.confidence] || '')}${item.gain ? ` · ${escapeHtml(item.gain)}` : ''}</span>${actionButton(item.action)}</footer>
    </article>`;
  }

  function pcHtml(report) {
    const lines = report.lines || [];
    const profile = report.profile || {};
    const rows = NODES.map((item) => {
      const mine = lines.filter((line) => line.node === item.id);
      if (item.id === 'windows' && profile.os?.name) mine.push({ text: [profile.os.name, profile.kindLabel].filter(Boolean).join(' · ') });
      if (!mine.length) return '';
      return `<li data-node="${item.id}"><span class="pc-node">${escapeHtml(item.label)}</span><div>${mine.map((line) => `<p>${escapeHtml(line.text)}</p>`).join('')}</div></li>`;
    }).join('');
    const chip = profile.board?.chipset;
    const cpu = profile.cpu || {};
    const knows = [chip ? `Chipset ${chip.id}: ${chip.cpus}; ${chip.ddr}; ${chip.pcie || 'PCIe conforme a placa'}; ${chip.cpuOc ? 'aceita overclock do processador' : 'sem overclock do processador'}; ${chip.memOc === true ? 'aceita XMP/EXPO' : chip.memOc === false ? 'memória presa na velocidade oficial' : 'XMP limitado'}.` : null,
      cpu.known === false && cpu.name ? `Não reconheci "${cpu.name}" pela nomenclatura; usei o que o sistema informa dele.` : null].filter(Boolean);
    return `<section class="deep-card deep-pc"><h4>Seu PC</h4><ul class="pc-list">${rows || '<li><div><p>Não consegui ler as peças neste sistema.</p></div></li>'}</ul>${knows.map((line) => `<p class="muted pc-know">${escapeHtml(line)}</p>`).join('')}</section>`;
  }

  function behindHtml(report) {
    const obs = report.observation;
    if (!obs) return '';
    const games = (obs.games || []).map((game) => `<span class="pill" data-role="game">${escapeHtml(game.label)} · o jogo</span>`);
    const launchers = (obs.launchers || []).slice(0, 4).map((item) => `<span class="pill" data-role="launcher">${escapeHtml(item.label)}</span>`);
    const weight = (item) => Math.max(item.cpuAvg, item.gpuAvg, item.ioAvg / 1048576 / 2);
    const top = Math.max(10, ...(obs.background || []).map(weight));
    const rows = (obs.background || []).filter((item) => item.impact !== 'nenhum').slice(0, 8).map((item) => {
      const width = Math.max(4, Math.min(100, (weight(item) / top) * 100));
      const gpuFirst = item.gpuAvg > item.cpuAvg;
      const main = gpuFirst ? `${n(item.gpuAvg, 1)}% vídeo` : `${n(item.cpuAvg, 1)}% CPU${item.cpuPeak >= item.cpuAvg * 2 && item.cpuPeak >= 8 ? ` (pico ${n(item.cpuPeak)}%)` : ''}`;
      const extra = [item.ioAvg >= 1048576 ? `disco ${mb(item.ioAvg)}` : null, gpuFirst ? (item.cpuAvg >= 0.5 ? `CPU ${n(item.cpuAvg, 1)}%` : null) : item.gpuAvg >= 1 ? `vídeo ${n(item.gpuAvg, 1)}%` : null, item.impact === 'memoria' ? `${n(item.memBytes / 1073741824, 1)} GB de memória` : null].filter(Boolean).join(' · ');
      return `<li data-impact="${escapeHtml(item.impact)}"><div class="row"><strong>${escapeHtml(item.kind === 'desconhecido' ? item.name : item.label)}</strong><span>${main}</span></div><div class="bar"><i data-css="width:${width.toFixed(1)}%"></i></div>${extra || item.kind !== 'desconhecido' ? `<small>${escapeHtml([item.kind !== 'desconhecido' && item.label.toLowerCase() !== item.name.toLowerCase() ? item.name : null, extra].filter(Boolean).join(' · '))}</small>` : ''}</li>`;
    }).join('');
    const sys = obs.system || {};
    const stats = [Number.isFinite(sys.cpuAvg) ? `processador ${n(sys.cpuAvg)}% no total` : null, Number.isFinite(sys.dpcAvg) ? `DPC ${n(sys.dpcAvg, 1)}%` : null, Number.isFinite(sys.diskBusyAvg) ? `disco ocupado ${n(sys.diskBusyAvg)}%` : null, Number.isFinite(sys.availMBMin) ? `memória livre mín. ${n(sys.availMBMin / 1024, 1)} GB` : null].filter(Boolean).join(' · ');
    return `<section class="deep-card deep-behind"><h4>O que roda por trás${games.length ? ' do jogo' : ''}</h4>
      <p class="muted">Observei por ${n(obs.seconds)} s (${obs.samples} leituras). ${games.length ? 'O jogo, os launchers e o próprio Nexo ficam fora da conta.' : 'Nenhum jogo aberto: o que pesa agora pesa também quando você joga, se não fechar antes.'}</p>
      ${games.length || launchers.length ? `<div class="pill-row">${[...games, ...launchers].join('')}</div>` : ''}
      ${rows ? `<ul class="ledger deep-ledger">${rows}</ul>` : '<p class="deep-clean">Nada pesando por trás. 👌</p>'}
      <small class="muted">${escapeHtml(stats)}${obs.self?.cpuAvg ? ` · o próprio Nexo usou ${n(obs.self.cpuAvg, 1)}% medindo (já descontado)` : ''}</small></section>`;
  }

  function loadHtml(report) {
    const load = report.load;
    if (!load) return '';
    const linkText = (gen, width) => (gen ? `PCIe ${gen}.0${width ? ' x' + width : ''}` : null);
    const link = linkText(load.gpu?.pcieGen, load.gpu?.pcieWidth) || (load.links || []).map((item) => linkText(item.link?.gen, item.link?.width)).find(Boolean) || null;
    const tiles = [
      ['Todos os núcleos', load.clock?.allCoreMHz ? `${n(load.clock.allCoreMHz)} MHz` : null],
      ['Um núcleo (turbo)', load.clock?.singleMHz ? `${n(load.clock.singleMHz)} MHz` : null],
      ['Processador em carga', Number.isFinite(load.temps?.cpuPeak) ? `${n(load.temps.cpuPeak)} °C` : null],
      ['Placa de vídeo', Number.isFinite(load.temps?.gpuPeak) ? `${n(load.temps.gpuPeak)} °C` : null],
      ['Link da placa de vídeo', link],
      ['Pontuação', load.bench?.multi ? `${n(load.bench.multi, 0)} · ${n(load.bench.single, 0)} (1 núcleo)` : null]
    ].filter(([, value]) => value);
    const signed = (value, digits) => (value >= 0 ? '+' : '') + n(value, digits);
    const changes = (report.comparison?.changes || []).map((item) => (item.pct === undefined ? `${item.label}: ${signed(item.delta, 0)} °C` : `${item.label}: ${signed(item.pct, 1)}%`));
    return `<section class="deep-card deep-load"><h4>Teste de carga</h4>${tiles.length ? `<div class="deep-tiles">${tiles.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>` : '<p class="muted">Sem leituras de sensores neste PC.</p>'}
      ${changes.length ? `<p class="muted">Desde a análise de ${escapeHtml(new Date(report.comparison.at).toLocaleDateString('pt-BR'))}: ${escapeHtml(changes.join(' · '))}</p>` : ''}</section>`;
  }

  function renderReport(report, { fromDisk = false } = {}) {
    if (!report || !Array.isArray(report.findings)) return;
    lastReport = report;
    Nexo.state.deep = report;
    const findings = report.findings;
    const count = (severity) => findings.filter((item) => item.severity === severity).length;
    const main = findings.filter((item) => item.severity === 'alta' || item.severity === 'media');
    const more = findings.filter((item) => item.severity === 'baixa' || item.severity === 'info');
    const ok = findings.filter((item) => item.severity === 'ok');
    const head = [count('alta') ? `${count('alta')} para resolver` : null, count('media') ? `${count('media')} que vale ajustar` : null, more.length ? `${more.length} ${more.length > 1 ? 'sugestões' : 'sugestão'}` : null].filter(Boolean);
    const comparison = report.comparison;
    const since = comparison ? [comparison.resolved?.length ? `${comparison.resolved.length} resolvido${comparison.resolved.length > 1 ? 's' : ''} desde a última análise` : null, comparison.appeared?.length ? `${comparison.appeared.length} novo${comparison.appeared.length > 1 ? 's' : ''}` : null].filter(Boolean).join(', ') : '';
    const when = new Date(report.at);
    reportBox.innerHTML = `<div class="deep-head">
        <div class="deep-score" data-tone="${toneOf(report.score)}"><strong>${report.score}</strong><span>de 100</span></div>
        <div class="deep-head-text"><h3>${main.length ? 'O que encontrei no seu PC' : 'Seu PC está em ordem'}</h3>
          <p>${escapeHtml(head.length ? `${head.join(', ')}${ok.length ? ` e ${ok.length} coisa${ok.length > 1 ? 's' : ''} já certa${ok.length > 1 ? 's' : ''}` : ''}.` : `Nada para resolver${ok.length ? `; ${ok.length} coisas conferidas e certas` : ''}.`)}</p>
          <small class="muted">${escapeHtml(`${fromDisk ? 'Última análise: ' : ''}${when.toLocaleDateString('pt-BR')} às ${when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${duration(report.durationMs)} de análise${report.onBattery ? ' · na bateria' : ''}${since ? ` · ${since}` : ''}`)}</small></div>
        <div class="deep-head-actions"><button class="btn sm primary" type="button" data-deep-again="1">Analisar de novo</button></div>
      </div>
      <div class="deep-grid">
        <div class="deep-col">
          <section class="deep-card deep-findings"><h4>O que fazer, do mais importante para o menos</h4>${main.length ? main.map(findingHtml).join('') : '<p class="deep-clean">Nada importante para resolver. 🎉</p>'}
            ${more.length ? `<details class="deep-more"${main.length ? '' : ' open'}><summary>${more.length} ${more.length > 1 ? 'sugestões e observações' : 'sugestão'}</summary>${more.map(findingHtml).join('')}</details>` : ''}
            ${comparison?.resolved?.length ? `<p class="deep-resolved">Resolvido desde a última vez: ${escapeHtml(comparison.resolved.join(' · '))}</p>` : ''}
          </section>
          ${behindHtml(report)}
        </div>
        <div class="deep-col">
          ${pcHtml(report)}
          ${loadHtml(report)}
          ${ok.length ? `<section class="deep-card deep-ok"><h4>Já está certo</h4><ul>${ok.map((item) => `<li>${escapeHtml(item.title)}</li>`).join('')}</ul></section>` : ''}
        </div>
      </div>`;
    show('report');
  }

  /* ---------------- Fluxo ---------------- */
  /** Depois de cancelar ou falhar: volta ao último relatório guardado, ou à apresentação. */
  function backToRest() {
    if (lastReport) renderReport(lastReport, { fromDisk: true });
    else show('intro');
  }

  async function start() {
    if (running) return;
    if (!bridge?.runDeepAnalysis) { showToast('A análise profunda está disponível no aplicativo desktop.'); return; }
    running = true;
    panel.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    factsList.innerHTML = '';
    factsList.dataset.key = '';
    renderProgress({ status: 'running', stageIndex: 0, nodes: {}, facts: [], action: 'começando…', elapsedMs: 0 });
    clearInterval(clock);
    clock = setInterval(tickClock, 1000);
    setAppStatus('Analisando a fundo');
    document.getElementById('run-diagnosis')?.setAttribute('disabled', '');
    try {
      const report = await bridge.runDeepAnalysis();
      if (report?.cancelled) {
        showToast('Análise cancelada.');
        backToRest();
        return;
      }
      renderReport(report);
      const bad = report.findings.filter((item) => item.severity === 'alta' || item.severity === 'media').length;
      recordActivity('Análise profunda', bad ? `${bad} ${bad > 1 ? 'pontos' : 'ponto'} para ajustar · nota ${report.score}` : `nada importante · nota ${report.score}`);
      showToast(bad ? `Análise profunda concluída: ${bad} ${bad > 1 ? 'pontos' : 'ponto'} para ajustar.` : 'Análise profunda concluída: nada importante para resolver.');
      Nexo.emit?.('deep-analysis', report);
    } catch (error) {
      showToast(error.message || 'Não consegui terminar a análise profunda.');
      backToRest();
    } finally {
      running = false;
      clearInterval(clock);
      setAppStatus('Monitoramento ativo');
      document.getElementById('run-diagnosis')?.removeAttribute('disabled');
    }
  }

  async function loadLast() {
    if (loadedLast || running) return;
    loadedLast = true;
    drawSky();
    try {
      const status = await bridge?.getDeepAnalysisStatus?.();
      if (status && status.status === 'running') { renderProgress(status); return; }
      const last = await bridge?.getLastDeepAnalysis?.();
      if (last) { renderReport(last, { fromDisk: true }); setText('deep-last-info', ''); return; }
    } catch { /* sem relatório guardado */ }
    show('intro');
  }

  Nexo.runDeepAnalysis = start;
  document.getElementById('deep-start')?.addEventListener('click', start);
  document.getElementById('deep-cancel')?.addEventListener('click', () => { bridge?.cancelDeepAnalysis?.(); setText('deep-action', 'cancelando…'); });
  reportBox.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.deepAgain) start();
    else if (target.dataset.deepSettings) bridge?.openWindowsSettings?.(target.dataset.deepSettings).catch((error) => showToast(error.message));
    else if (target.dataset.deepGoto) Nexo.go(target.dataset.deepGoto);
    else if (target.dataset.deepTaskmgr) bridge?.openTaskManager?.().catch((error) => showToast(error.message));
  });
  bridge?.onAnalysisProgress?.((progress) => { if (running || progress?.status === 'running') renderProgress(progress); });
  bridge?.onGpuWake?.((payload) => { try { gpuWake(payload?.ms); } catch { /* sem WebGL: o link fica o do repouso */ } });
  Nexo.on('view', (view) => { if (view === 'analysis') loadLast(); });
  if (Nexo.state.view === 'analysis') loadLast();
})();
