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
    buildSky(sky);
  }
  /** Desenha a constelação (poeira, linhas, peças) num SVG; serve para a análise ao vivo, a apresentação e o relatório. */
  function buildSky(target) {
    if (!target || target.dataset.ready) return;
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
    const comet = (i) => '<circle class="deep-comet" cx="' + (310 + 118 * Math.cos(i * 2.1)).toFixed(1) + '" cy="' + (148 + 62 * Math.sin(i * 2.1)).toFixed(1) + '" r="2.4" />';
    const comets = `<g class="deep-orbit" aria-hidden="true">${[0, 1, 2].map(comet).join('')}</g>`;
    target.innerHTML = `<g class="deep-dusts">${dust}</g><g class="deep-edges">${edges}</g>${comets}<g class="deep-stars">${stars}</g>`;
    target.dataset.ready = '1';
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

  /** Pinta estados numa constelação qualquer (estrelas e linhas). */
  function paintStates(target, nodes) {
    for (const star of target.querySelectorAll('.deep-star')) {
      const state = nodes[star.dataset.node] || 'pending';
      if (star.dataset.state !== state) star.dataset.state = state;
    }
    const lit = (id) => ['done', 'warn', 'seen', 'active'].includes(nodes[id]);
    const done = (id) => ['done', 'warn'].includes(nodes[id]);
    for (const edge of target.querySelectorAll('.deep-edge')) {
      let edgeState = 'pending';
      if (done(edge.dataset.a) && done(edge.dataset.b)) edgeState = 'done';
      else if (lit(edge.dataset.a) && lit(edge.dataset.b)) edgeState = 'seen';
      edge.dataset.state = edgeState;
    }
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
      let edgeState = 'pending';
      if (done(a) && done(b)) edgeState = 'done';
      else if (lit(a) && lit(b)) edgeState = 'seen';
      edge.dataset.state = edgeState;
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
    let action = progress.action || '…';
    if (progress.status === 'cancelled') action = 'Análise cancelada.';
    else if (progress.status === 'error') action = `Não consegui terminar: ${progress.error || 'erro desconhecido'}`;
    setText('deep-action', action);
    const facts = (progress.facts || []).slice(-5);
    const key = facts.map((item) => item.text).join('|');
    if (factsList.dataset.key !== key) {
      factsList.dataset.key = key;
      factsList.innerHTML = facts.map((item, i) => `<li data-level="${escapeHtml(item.level || 'info')}" data-node="${escapeHtml(item.node || 'none')}"${i === facts.length - 1 ? ' class="fresh"' : ''}>${escapeHtml(item.text)}</li>`).join('');
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
  const toneOf = (score) => {
    if (score >= 80) return 'good';
    return score >= 55 ? 'warn' : 'bad';
  };
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const AREA_ICON = { processador: 'i-chip', memoria: 'i-ram', video: 'i-gpu', disco: 'i-disk', windows: 'i-win', rede: 'i-net', energia: 'i-bolt', fundo: 'i-eye' };
  const AREA_NODE = { processador: 'cpu', memoria: 'memory', video: 'gpu', disco: 'disk', windows: 'windows', rede: 'network', energia: 'windows', fundo: 'windows' };
  const NODE_ICON = { cpu: 'i-chip', board: 'i-board', memory: 'i-ram', gpu: 'i-gpu', disk: 'i-disk', network: 'i-net', windows: 'i-win' };
  const icon = (id) => `<svg class="deep-ico" aria-hidden="true"><use href="#${id}"/></svg>`;
  const KIND_LABEL = { antivirus: 'proteção', atualizacao: 'atualização', indexacao: 'indexação', manutencao: 'manutenção', nuvem: 'nuvem', navegador: 'navegador', comunicacao: 'chat', gravacao: 'gravação', overlay: 'overlay', rgb: 'RGB', audio: 'áudio', 'papel-de-parede': 'papel de parede', virtualizacao: 'máquina virtual', fabricante: 'fabricante', rede: 'rede', atualizador: 'atualizador', download: 'download', mineracao: 'mineração', midia: 'mídia', desenvolvimento: 'programação', desconhecido: 'desconhecido' };
  /** Pedaço de HTML com texto escapado: el('p', 'muted', 'texto'). */
  const el = (name, cls, text) => `<${name}${cls ? ' class="' + cls + '"' : ''}>${escapeHtml(text)}</${name}>`;
  const list = (items, render) => items.map(render).join('');

  function actionButton(action) {
    if (!action) return '';
    if (action.settings && Nexo.platform !== 'linux') return `<button class="btn sm" type="button" data-deep-settings="${escapeHtml(action.settings)}">Abrir no Windows</button>`;
    if (action.goto) return `<button class="btn sm" type="button" data-deep-goto="${escapeHtml(action.goto)}">Abrir no Nexo</button>`;
    if (action.taskManager) return '<button class="btn sm" type="button" data-deep-taskmgr="1">Gerenciador de Tarefas</button>';
    return '';
  }

  function findingHtml(item) {
    const evidence = (item.evidence || []).filter(Boolean);
    const detail = item.detail ? el('p', '', item.detail) : '';
    const proof = evidence.length ? '<ul class="finding-evidence">' + list(evidence, (line) => el('li', '', line)) + '</ul>' : '';
    const how = item.action?.how ? '<p class="finding-how"><b>O que fazer:</b> ' + escapeHtml(item.action.how) + '</p>' : '';
    const trust = [CONFIDENCE[item.confidence], item.gain].filter(Boolean).join(' · ');
    return `<article class="finding" data-severity="${escapeHtml(item.severity)}" data-node="${AREA_NODE[item.area] || 'windows'}">
      <header>${icon(AREA_ICON[item.area] || 'i-spark')}${el('span', 'finding-tag', SEVERITY[item.severity] || item.severity)}${el('strong', '', item.title)}${el('span', 'finding-area', AREA[item.area] || '')}</header>
      ${detail}${proof}${how}
      <footer>${el('span', '', trust)}${actionButton(item.action)}</footer>
    </article>`;
  }

  /** Seu PC: cada peça identificada e, embaixo, o que ela significa (limites, recursos, caminho de upgrade). */
  function pcHtml(report) {
    const lines = report.lines || [];
    const profile = report.profile || {};
    let traits = {};
    try { traits = NexoHardware.traits(profile); } catch { traits = {}; }
    const rows = NODES.map((item) => {
      const mine = lines.filter((line) => line.node === item.id);
      if (item.id === 'windows' && profile.os?.name) mine.push({ text: [profile.os.name, profile.kindLabel].filter(Boolean).join(' · ') });
      const means = traits[item.id] || [];
      if (!mine.length && !means.length) return '';
      const meaning = means.length ? '<ul class="pc-means">' + list(means, (line) => el('li', '', line)) + '</ul>' : '';
      return `<li data-node="${item.id}"><span class="pc-node">${icon(NODE_ICON[item.id])}${escapeHtml(item.label)}</span><div>${list(mine, (line) => el('p', '', line.text))}${meaning}</div></li>`;
    }).join('');
    const cpu = profile.cpu || {};
    const unknown = cpu.known === false && cpu.name ? el('p', 'muted pc-know', `Não reconheci "${cpu.name}" pela nomenclatura; usei o que o sistema informa dele.`) : '';
    return `<section class="deep-card deep-pc"><h4>Seu PC, peça por peça</h4><ul class="pc-list">${rows || '<li><div><p>Não consegui ler as peças neste sistema.</p></div></li>'}</ul>${unknown}</section>`;
  }

  /** O que o laboratório já mediu de cada ajuste (memória local do laboratório). */
  function labStatus(knobs) {
    let evidence = {};
    try { evidence = readJSON('nexo-lab-v1', null)?.evidence || {}; } catch { evidence = {}; }
    const tested = Object.entries(evidence).filter(([key, value]) => knobs.some((knob) => key.startsWith(knob + '=')) && value?.n > 0);
    if (!tested.length) return { tested: 0, best: null };
    const best = Math.max(...tested.map(([, value]) => Number(value.mean) || 0));
    return { tested: tested.length, best };
  }

  /** Plano para este PC: na BIOS, no laboratório (o Nexo testa e mede) e o que acompanhar. */
  function planHtml(report) {
    const steps = NexoDeep.plan(report.profile || {}, report.findings || []);
    if (!steps.length) return '';
    const GROUPS = [['bios', 'Na BIOS (você faz uma vez)'], ['laboratorio', 'No laboratório (o Nexo testa e mede neste PC)'], ['acompanhar', 'Acompanhar']];
    const item = (step) => {
      let status = '';
      if (step.kind === 'laboratorio') {
        const lab = labStatus(step.knobs || []);
        const best = lab.best > 0 ? ', melhor +' + n(lab.best, 1) + '%' : '';
        status = lab.tested ? `<span class="pill" data-role="done">testado: ${plural(lab.tested, 'opção', 'opções')}${best}</span>` : '<span class="pill">a testar</span>';
      } else if (step.done) status = '<span class="pill" data-role="done">feito</span>';
      return `<li>${el('strong', '', step.title)}${status}${el('p', 'muted', step.why)}</li>`;
    };
    const groups = GROUPS.map(([kind, label]) => {
      const mine = steps.filter((step) => step.kind === kind);
      return mine.length ? `<div class="plan-group" data-kind="${kind}">${el('h5', '', label)}<ul class="plan-list">${list(mine, item)}</ul></div>` : '';
    }).join('');
    const labButton = steps.some((step) => step.kind === 'laboratorio') ? '<button class="btn sm" type="button" data-deep-goto="lab">Abrir o laboratório</button>' : '';
    return `<section class="deep-card deep-plan"><h4>Plano para este PC</h4>${el('p', 'muted', 'Montado a partir das peças: o que vale fazer, o que testar e o que acompanhar. Cada teste do laboratório fica guardado e o plano vai se ajustando.')}${groups}${labButton}</section>`;
  }

  function behindRow(item, top, weight) {
    const width = Math.max(4, Math.min(100, (weight(item) / top) * 100));
    const gpuFirst = item.gpuAvg > item.cpuAvg;
    const peak = item.cpuPeak >= item.cpuAvg * 2 && item.cpuPeak >= 8 ? ` (pico ${n(item.cpuPeak)}%)` : '';
    const main = gpuFirst ? `${n(item.gpuAvg, 1)}% vídeo` : `${n(item.cpuAvg, 1)}% CPU${peak}`;
    let second = null;
    if (gpuFirst && item.cpuAvg >= 0.5) second = `CPU ${n(item.cpuAvg, 1)}%`;
    else if (!gpuFirst && item.gpuAvg >= 1) second = `vídeo ${n(item.gpuAvg, 1)}%`;
    const extra = [item.ioAvg >= 1048576 ? `disco ${mb(item.ioAvg)}` : null, second, item.impact === 'memoria' ? `${n(item.memBytes / 1073741824, 1)} GB de memória` : null].filter(Boolean).join(' · ');
    const known = item.kind !== 'desconhecido';
    const sub = [known && item.label.toLowerCase() !== item.name.toLowerCase() ? item.name : null, extra].filter(Boolean).join(' · ');
    const kindText = KIND_LABEL[item.kind];
    const repeats = kindText && String(known ? item.label : item.name).toLowerCase().includes(kindText.toLowerCase());
    const kind = kindText && !repeats ? `<span class="kind-chip" data-kind="${escapeHtml(item.kind)}">${escapeHtml(kindText)}</span>` : '';
    return `<li data-impact="${escapeHtml(item.impact)}"><div class="row"><span class="row-name">${el('strong', '', known ? item.label : item.name)}${kind}</span>${el('span', '', main)}</div><div class="bar"><i data-css="width:${width.toFixed(1)}%"></i></div>${sub ? el('small', '', sub) : ''}</li>`;
  }

  function behindHtml(report) {
    const obs = report.observation;
    if (!obs) return '';
    const games = (obs.games || []).map((game) => `<span class="pill" data-role="game">${escapeHtml(game.label)} · o jogo</span>`);
    const launchers = (obs.launchers || []).slice(0, 4).map((item) => `<span class="pill" data-role="launcher">${escapeHtml(item.label)}</span>`);
    const weight = (item) => Math.max(item.cpuAvg, item.gpuAvg, item.ioAvg / 1048576 / 2);
    const top = Math.max(10, ...(obs.background || []).map(weight));
    const rows = (obs.background || []).filter((item) => item.impact !== 'nenhum').slice(0, 8).map((item) => behindRow(item, top, weight)).join('');
    const sys = obs.system || {};
    const stats = [Number.isFinite(sys.cpuAvg) ? `processador ${n(sys.cpuAvg)}% no total` : null, Number.isFinite(sys.dpcAvg) ? `DPC ${n(sys.dpcAvg, 1)}%` : null, Number.isFinite(sys.diskBusyAvg) ? `disco ocupado ${n(sys.diskBusyAvg)}%` : null,
      Number.isFinite(sys.availMBMin) ? `memória livre mín. ${n(sys.availMBMin / 1024, 1)} GB` : null, obs.self?.cpuAvg ? `o próprio Nexo usou ${n(obs.self.cpuAvg, 1)}% medindo (já descontado)` : null].filter(Boolean).join(' · ');
    const intro = `Observei por ${n(obs.seconds)} s (${plural(obs.samples, 'leitura', 'leituras')}). ${games.length ? 'O jogo, os launchers e o próprio Nexo ficam fora da conta.' : 'Nenhum jogo aberto: o que pesa agora pesa também quando você joga, se não fechar antes.'}`;
    const pills = games.length || launchers.length ? '<div class="pill-row">' + [...games, ...launchers].join('') + '</div>' : '';
    const body = rows ? '<ul class="ledger deep-ledger">' + rows + '</ul>' : '<p class="deep-clean">Nada pesando por trás. 👌</p>';
    return `<section class="deep-card deep-behind">${el('h4', '', games.length ? 'O que roda por trás do jogo' : 'O que roda por trás')}${el('p', 'muted', intro)}${pills}${body}${el('small', 'muted', stats)}</section>`;
  }

  function loadHtml(report) {
    const { load } = report;
    if (!load) return '';
    const linkText = (gen, width) => (gen ? `PCIe ${gen}.0${width ? ' x' + width : ''}` : null);
    const link = linkText(load.gpu?.pcieGen, load.gpu?.pcieWidth) || (load.links || []).map((item) => linkText(item.link?.gen, item.link?.width)).find(Boolean) || null;
    const tiles = [
      ['Todos os núcleos', load.clock?.allCoreMHz ? `${n(load.clock.allCoreMHz)} MHz` : null, 'cpu'],
      ['Um núcleo (turbo)', load.clock?.singleMHz ? `${n(load.clock.singleMHz)} MHz` : null, 'cpu'],
      ['Processador em carga', Number.isFinite(load.temps?.cpuPeak) ? `${n(load.temps.cpuPeak)} °C` : null, 'heat'],
      ['Placa de vídeo', Number.isFinite(load.temps?.gpuPeak) ? `${n(load.temps.gpuPeak)} °C` : null, 'gpu'],
      ['Link da placa de vídeo', link, 'network'],
      ['Pontuação', load.bench?.multi ? `${n(load.bench.multi, 0)} · ${n(load.bench.single, 0)} (1 núcleo)` : null, 'board']
    ].filter(([, value]) => value);
    const signed = (value, digits) => (value >= 0 ? '+' : '') + n(value, digits);
    const changes = (report.comparison?.changes || []).map((item) => (item.pct === undefined ? `${item.label}: ${signed(item.delta, 0)} °C` : `${item.label}: ${signed(item.pct, 1)}%`));
    const grid = tiles.length ? '<div class="deep-tiles">' + list(tiles, ([label, value, node]) => `<div data-node="${node}">` + el('span', '', label) + el('strong', '', value) + '</div>') + '</div>' : '<p class="muted">Sem leituras de sensores neste PC.</p>';
    const since = changes.length ? el('p', 'muted', `Desde a análise de ${new Date(report.comparison.at).toLocaleDateString('pt-BR')}: ${changes.join(' · ')}`) : '';
    return `<section class="deep-card deep-load"><h4>Teste de carga</h4>${grid}${since}</section>`;
  }

  /*
   * Sua rotina: o que o Nexo aprendeu com o tempo (cérebro local) cruzado com o que a análise viu agora. Um programa
   * pesando por trás que já causou lentidões antes ganha esse histórico como evidência (e sobe de "sugestão").
   */
  const nameKey = (value) => String(value || '').toLowerCase().replace(/\.exe$/, '');
  function routineOf(report) {
    const brain = Nexo.store?.brain;
    if (!brain) return null;
    const ledger = brain.ledger();
    const byName = new Map(ledger.map((entry) => [nameKey(entry.name), entry]));
    const now = new Map((report.observation?.background || []).map((item) => [nameKey(item.name), item]));
    const episodes = brain.recentEpisodes(14 * 24 * 3600e3);
    return { info: brain.learning(), ledger, byName, now, episodes };
  }

  function withRoutine(findings, routine) {
    if (!routine) return findings;
    return findings.map((item) => {
      const name = item.id.startsWith('fundo-') ? nameKey(item.id.replace(/^fundo-(presenca-)?/, '')) : null;
      const past = name ? routine.byName.get(name) : null;
      if (!past) return item;
      const note = `o Nexo já viu ele por trás de ${plural(past.events, 'lentidão', 'lentidões')} (${past.minutes} min no total)`;
      return { ...item, severity: item.severity === 'baixa' ? 'media' : item.severity, confidence: 'alta', evidence: [...(item.evidence || []), note] };
    });
  }

  function routineHtml(routine) {
    if (!routine) return '';
    const { info, ledger, now, episodes } = routine;
    const facts = [`${plural(info.days, 'dia', 'dias')} de convivência`, `${info.coverage}% da rotina semanal conhecida`, plural(episodes.length, 'lentidão nos últimos 14 dias', 'lentidões nos últimos 14 dias')];
    const rows = ledger.slice(0, 4).map((entry) => {
      const live = now.get(nameKey(entry.name));
      const stats = plural(entry.events, 'episódio', 'episódios') + ' · ' + entry.minutes + ' min';
      return `<li>${el('strong', '', entry.name)}${el('span', '', stats)}${live ? '<span class="pill" data-role="now">pesando agora</span>' : ''}</li>`;
    }).join('');
    const empty = info.days < 1 ? el('p', 'muted', 'O Nexo ainda está conhecendo a sua rotina; a cada dia ele aprende mais e cruza com as próximas análises.') : '';
    return `<section class="deep-card deep-routine"><h4>Sua rotina</h4>${el('p', 'muted', facts.join(' · '))}${rows ? '<ul class="routine-list">' + rows + '</ul>' : ''}${empty}</section>`;
  }

  /** Mini gráfico da nota nas últimas análises deste PC. */
  function scoreTrend(history) {
    const points = (history || []).filter((item) => Number.isFinite(item.score));
    if (points.length < 2) return '';
    const xs = points.map((_, i) => 4 + (i * 112) / (points.length - 1));
    const ys = points.map((item) => 30 - (item.score / 100) * 26);
    const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const label = `Nota nas últimas análises: ${points.map((item) => item.score).join(', ')}`;
    return `<svg class="deep-trend" viewBox="0 0 120 34" role="img" aria-label="${escapeHtml(label)}"><polyline points="${line}" /><circle cx="${xs[xs.length - 1].toFixed(1)}" cy="${ys[ys.length - 1].toFixed(1)}" r="2.6" /></svg>`;
  }

  function headline(main, more, ok, count) {
    const parts = [count('alta') ? `${count('alta')} para resolver` : null, count('media') ? `${count('media')} que vale ajustar` : null, more.length ? plural(more.length, 'sugestão', 'sugestões') : null].filter(Boolean);
    const right = ok.length ? ` e ${plural(ok.length, 'coisa já certa', 'coisas já certas')}` : '';
    if (parts.length) return `${parts.join(', ')}${right}.`;
    return ok.length ? `Nada para resolver; ${plural(ok.length, 'coisa conferida e certa', 'coisas conferidas e certas')}.` : 'Nada para resolver.';
  }

  function stamp(report, fromDisk) {
    const when = new Date(report.at);
    const comparison = report.comparison;
    const since = comparison ? [comparison.resolved?.length ? plural(comparison.resolved.length, 'resolvido', 'resolvidos') + ' desde a última análise' : null, comparison.appeared?.length ? plural(comparison.appeared.length, 'novo', 'novos') : null].filter(Boolean).join(', ') : '';
    const time = when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return [`${fromDisk ? 'Última análise: ' : ''}${when.toLocaleDateString('pt-BR')} às ${time}`, `${duration(report.durationMs)} de análise`, report.onBattery ? 'na bateria' : null, since || null].filter(Boolean).join(' · ');
  }

  function renderReport(report, { fromDisk = false } = {}) {
    if (!report || !Array.isArray(report.findings)) return;
    lastReport = report;
    Nexo.state.deep = report;
    const { comparison } = report;
    const routine = routineOf(report);
    const findings = withRoutine(report.findings, routine).sort((a, b) => NexoDeep.SEVERITY_ORDER[a.severity] - NexoDeep.SEVERITY_ORDER[b.severity]);
    const count = (severity) => findings.filter((item) => item.severity === severity).length;
    const main = findings.filter((item) => item.severity === 'alta' || item.severity === 'media');
    const more = findings.filter((item) => item.severity === 'baixa' || item.severity === 'info');
    const ok = findings.filter((item) => item.severity === 'ok');
    const mainHtml = main.length ? list(main, findingHtml) : '<p class="deep-clean">Nada importante para resolver. 🎉</p>';
    const moreHtml = more.length ? `<details class="deep-more"${main.length ? '' : ' open'}><summary>${plural(more.length, 'sugestão', 'sugestões e observações')}</summary>${list(more, findingHtml)}</details>` : '';
    const resolved = comparison?.resolved?.length ? el('p', 'deep-resolved', 'Resolvido desde a última vez: ' + comparison.resolved.join(' · ')) : '';
    const okHtml = ok.length ? '<section class="deep-card deep-ok"><h4>Já está certo</h4><ul>' + list(ok, (item) => el('li', '', item.title)) + '</ul></section>' : '';
    let story = { identity: '', verdict: '', good: null };
    try { story = NexoDeep.narrative(report.profile || {}, findings); } catch { /* relatório antigo sem perfil */ }
    const ring = 2 * Math.PI * 42;
    reportBox.innerHTML = `<div class="deep-head">
        <div class="deep-score-box"><div class="deep-score" data-tone="${toneOf(report.score)}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-bg" cx="50" cy="50" r="42" /><circle class="ring" cx="50" cy="50" r="42" stroke-dasharray="${ring.toFixed(1)}" stroke-dashoffset="${ring.toFixed(1)}" data-target="${(ring * (1 - report.score / 100)).toFixed(1)}" /></svg><strong>${report.score}</strong><span>de 100</span></div>${scoreTrend(report.history)}</div>
        <div class="deep-head-text"><span class="deep-kicker">Seu PC, entendido</span>${el('h3', '', story.identity || (main.length ? 'O que encontrei no seu PC' : 'Seu PC está em ordem'))}${el('p', 'deep-verdict', story.verdict)}${story.good ? el('p', 'deep-good', story.good) : ''}${el('small', 'muted', `${headline(main, more, ok, count)} · ${stamp(report, fromDisk)}`)}</div>
        <div class="deep-head-side"><svg class="deep-sky deep-mini" id="deep-report-sky" viewBox="0 0 640 280" role="img" aria-label="Constelação do seu PC: peças em amarelo têm algo para ajustar; toque numa para ver"></svg><button class="btn sm primary" type="button" data-deep-again="1">Analisar de novo</button></div>
      </div>
      <div class="deep-grid">
        <div class="deep-col">
          <section class="deep-card deep-findings"><h4>O que fazer, do mais importante para o menos</h4>${mainHtml}${moreHtml}${resolved}</section>
          ${behindHtml(report)}
          ${loadHtml(report)}
          ${routineHtml(routine)}
        </div>
        <div class="deep-col">${pcHtml(report)}${planHtml(report)}${okHtml}</div>
      </div>`;
    show('report');
    finishReport(findings);
  }

  /** Depois de montar: constelação final (clicável), anel da nota enchendo e cartões entrando em sequência. */
  function finishReport(findings) {
    const mini = document.getElementById('deep-report-sky');
    buildSky(mini);
    const nodes = Object.fromEntries(NODES.map((item) => [item.id, 'done']));
    for (const item of findings) if ((item.severity === 'alta' || item.severity === 'media') && AREA_NODE[item.area]) nodes[AREA_NODE[item.area]] = 'warn';
    paintStates(mini, nodes);
    reportBox.querySelectorAll('.deep-card').forEach((card, index) => card.style.setProperty('--i', String(index)));
    const ring = reportBox.querySelector('.deep-score .ring');
    const go = () => { if (ring) ring.style.strokeDashoffset = ring.dataset.target; };
    if (calm()) { go(); reportBox.classList.add('calm'); } else requestAnimationFrame(() => requestAnimationFrame(go));
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

  /** Constelação parada na apresentação: as peças "esperando" para serem conhecidas. */
  function paintIntro() {
    const intro = document.getElementById('deep-intro-sky');
    buildSky(intro);
    paintStates(intro, { cpu: 'seen', board: 'done', memory: 'seen', gpu: 'seen', disk: 'seen', network: 'seen', windows: 'seen' });
  }

  async function loadLast() {
    if (loadedLast || running) return;
    loadedLast = true;
    drawSky();
    paintIntro();
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
    const star = event.target.closest('.deep-star');
    if (star) {
      const row = reportBox.querySelector(`.pc-list > li[data-node="${star.dataset.node}"]`);
      if (row) { row.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' }); row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
      return;
    }
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
