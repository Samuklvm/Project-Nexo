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
  // Carta celeste do relatório: a mesma constelação, mais larga, com o nome de cada peça embaixo da estrela.
  const CHART = { cpu: [250, 86], memory: [640, 72], board: [480, 160], gpu: [815, 150], disk: [130, 190], windows: [345, 238], network: [680, 236] };
  const TOP = new Set(['cpu', 'memory']);
  /** No Linux a estrela do sistema se chama "Sistema", não "Windows". */
  const labelOf = (item, platform = Nexo.platform) => (item.id === 'windows' && platform === 'linux' ? 'Sistema' : item.label);
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
  /** Véu de nebulosa: um degradê radial de uma cor só, bem suave. */
  const veil = (id, color, opacity) => `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}" /><stop offset="1" stop-color="${color}" stop-opacity="0" /></radialGradient>`;
  /**
   * Luz de uma estrela: halo que se esvai (degradê na cor da própria estrela, definido aqui dentro para herdar a cor)
   * e dois raios finos, como numa foto do céu.
   */
  const starLight = (prefix, id, glow, spike) => `<radialGradient id="${prefix}-glow-${id}" class="deep-glowdef"><stop offset="0" class="g0" /><stop offset="0.28" class="g1" /><stop offset="1" class="g2" /></radialGradient>`
    + `<circle class="deep-glow" r="${glow}" fill="url(#${prefix}-glow-${id})" /><path class="deep-spikes" d="M${-spike} 0H${spike}M0 ${-spike}V${spike}" />`;
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
    // Nebulosa de cada peça: acende junto com a estrela (âmbar quando ela tem algo para ajustar).
    const prefix = target.id || 'sky';
    const defs = '<defs>' + veil(prefix + '-neb', '#9fb8ff', 0.2) + veil(prefix + '-neb-warn', '#ffc98a', 0.2) + '</defs>';
    const stars = NODES.map((item) => {
      const [x, y] = POS[item.id];
      return `<g class="deep-star" data-node="${item.id}" data-state="pending" transform="translate(${x} ${y})">
        <circle class="deep-neb" r="84" fill="url(#${prefix}-neb)" /><circle class="deep-neb deep-neb-warn" r="96" fill="url(#${prefix}-neb-warn)" />${starLight(prefix, item.id, 26, 15)}<circle class="deep-ring" r="15" /><circle class="deep-core" r="5.5" />
        <text class="deep-label" y="${TOP.has(item.id) ? -26 : 34}">${escapeHtml(labelOf(item))}</text><text class="deep-name" y="${TOP.has(item.id) ? -26 : 52}"></text></g>`;
    }).join('');
    const comet = (i) => '<circle class="deep-comet" cx="' + (310 + 118 * Math.cos(i * 2.1)).toFixed(1) + '" cy="' + (148 + 62 * Math.sin(i * 2.1)).toFixed(1) + '" r="2.4" />';
    const comets = `<g class="deep-orbit" aria-hidden="true">${[0, 1, 2].map(comet).join('')}</g>`;
    target.innerHTML = `${defs}<g class="deep-dusts">${dust}</g><g class="deep-edges">${edges}</g>${comets}<g class="deep-stars">${stars}</g>`;
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
      if (!running || runBox.hidden) { motion = null; if (dot) { dot.style.opacity = ''; } panel.querySelector('.deep-stages li[data-state="active"]')?.style.removeProperty('--pulse'); return false; }
      if (calm() || document.hidden || sky.dataset.stage === 'load') return true;
      const t = now / 1000;
      for (const star of sky.querySelectorAll('.deep-star[data-state="active"]')) {
        star.querySelector('.deep-glow')?.setAttribute('transform', `scale(${(1 + 0.12 * Math.sin(t * 3.2)).toFixed(3)})`);
        star.querySelector('.deep-ring')?.setAttribute('transform', `rotate(${Math.round((t * 60) % 360)})`);
      }
      if (sky.dataset.stage === 'behind') orbit()?.setAttribute('transform', `rotate(${Math.round((t * 40) % 360)} 310 148)`);
      if (dot) dot.style.opacity = (0.65 + 0.35 * Math.cos(t * 5.2)).toFixed(2);
      const step = panel.querySelector('.deep-stages li[data-state="active"]');
      if (step) step.style.setProperty('--pulse', (0.5 + 0.5 * Math.sin(t * 3.4)).toFixed(2));
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

  /** Escreve o nome curto de cada peça embaixo da estrela assim que ela é identificada ("Ryzen 7 5700X3D"). */
  function paintNames(target, names, nodes) {
    for (const star of target.querySelectorAll('.deep-star')) {
      const id = star.dataset.node;
      const name = (nodes?.[id] || 'pending') !== 'pending' && names?.[id] ? String(names[id]) : '';
      const text = star.querySelector('.deep-name');
      if (!text || text.textContent === name) continue;
      text.textContent = name;
      if (TOP.has(id)) star.querySelector('.deep-label')?.setAttribute('y', name ? '-44' : '-26');
      star.classList.toggle('named', Boolean(name));
    }
  }

  // Cada etapa tem a cor e o ícone da peça que ela examina; a de "por trás" é lilás e a de carga, cor de brasa.
  const STAGE_LOOK = { parts: ['cpu', 'i-chip'], memory: ['memory', 'i-ram'], video: ['gpu', 'i-gpu'], disk: ['disk', 'i-disk'], windows: ['network', 'i-win'], behind: ['board', 'i-eye'], load: ['heat', 'i-bolt'] };
  /** Nome da etapa na plataforma: no Linux a do sistema não se chama "Windows". */
  const stageName = (stage) => (stage?.id === 'windows' && Nexo.platform === 'linux' ? 'Sistema e rede' : stage?.label || '');
  function paintStages(index, status) {
    const box = document.getElementById('deep-stages');
    if (!box) return;
    if (box.dataset.ready !== Nexo.platform) {
      box.innerHTML = STAGES.map((stage) => {
        let [node, ico] = STAGE_LOOK[stage.id] || ['windows', 'i-spark'];
        // No Linux a etapa do sistema não é "Windows": ícone da rede no lugar do logotipo.
        if (stage.id === 'windows' && Nexo.platform === 'linux') { ico = 'i-net'; node = 'network'; }
        return `<li data-node="${node}" data-state="pending"><span class="stage-ico">${icon(ico)}</span>${el('span', 'stage-name', stageName(stage))}</li>`;
      }).join('');
      box.dataset.ready = Nexo.platform || 'win32';
    }
    [...box.children].forEach((li, i) => {
      let state = 'pending';
      if (status === 'done' || i < index) state = 'done';
      else if (i === index) state = status === 'running' ? 'active' : 'stopped';
      if (li.dataset.state !== state) li.dataset.state = state;
      if (state === 'active') li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
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
        if (state !== 'active') { star.querySelector('.deep-glow')?.removeAttribute('transform'); star.querySelector('.deep-ring')?.removeAttribute('transform'); }
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
    paintNames(sky, progress.names, progress.nodes);
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
    setText('deep-count', `Etapa ${index + 1} de ${STAGES.length}: ${stageName(stage)}`);
    paintStages(index, progress.status);
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
  const cardTitle = (ico, text) => `<h4>${icon(ico)}${escapeHtml(text)}</h4>`;

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
      <header><span class="finding-badge">${icon(AREA_ICON[item.area] || 'i-spark')}</span>${el('span', 'finding-tag', SEVERITY[item.severity] || item.severity)}${el('strong', '', item.title)}${el('span', 'finding-area', item.area === 'windows' && Nexo.platform === 'linux' ? 'Sistema' : AREA[item.area] || '')}</header>
      ${detail}${proof}${how}
      <footer>${el('span', '', trust)}${actionButton(item.action)}</footer>
    </article>`;
  }

  /**
   * Linha de uma peça em título + etiquetas: "AMD Ryzen 7 5700X3D · Zen 3, Ryzen 5000 · 8 núcleos" vira o título
   * "AMD Ryzen 7 5700X3D" e as etiquetas "Zen 3", "Ryzen 5000" e "8 núcleos".
   */
  function splitLine(text) {
    const value = String(text || '');
    const m = value.match(/^(.*?)(?: · | → |: )(.*)$/);
    let title = value;
    let rest = '';
    if (m) { title = m[1]; rest = m[2]; } else { const parts = value.split(', '); title = parts[0]; rest = parts.slice(1).join(', '); }
    const chips = rest.replace(/[()]/g, ', ').split(/ · |, /).map((part) => part.trim()).filter(Boolean).slice(0, 7);
    return { title, chips };
  }

  /** Seu PC: cada peça identificada (nome grande + etiquetas) e, embaixo, o que ela significa (limites, recursos, upgrade). */
  function pcHtml(report) {
    const lines = report.lines || [];
    const profile = report.profile || {};
    let traits = {};
    try { traits = NexoHardware.traits(profile); } catch { traits = {}; }
    const rows = NODES.map((item) => {
      const mine = lines.filter((line) => line.node === item.id).map((line) => line.text);
      if (item.id === 'windows' && profile.os?.name) mine.unshift([profile.os.name, profile.kindLabel].filter(Boolean).join(' · '));
      const means = traits[item.id] || [];
      if (!mine.length && !means.length) return '';
      const head = mine.length ? splitLine(mine[0]) : { title: labelOf(item, profile.os?.platform), chips: [] };
      const chips = head.chips.length ? '<div class="pc-chips">' + list(head.chips, (chip) => el('span', '', chip)) + '</div>' : '';
      const others = list(mine.slice(1), (line) => el('p', 'pc-more', line));
      const meaning = means.length ? '<ul class="pc-means">' + list(means, (line) => el('li', '', line)) + '</ul>' : '';
      return `<li data-node="${item.id}"><span class="pc-badge">${icon(NODE_ICON[item.id])}</span><div class="pc-body">${el('span', 'pc-type', labelOf(item, profile.os?.platform))}${el('strong', 'pc-title', head.title)}${chips}${others}${meaning}</div></li>`;
    }).join('');
    const cpu = profile.cpu || {};
    const unknown = cpu.known === false && cpu.name ? el('p', 'muted pc-know', `Não reconheci "${cpu.name}" pela nomenclatura; usei o que o sistema informa dele.`) : '';
    const body = rows ? '<ul class="pc-list">' + rows + '</ul>' : el('p', 'muted', 'Este relatório não guardou as peças. Rode a análise de novo para ver cada uma delas aqui.');
    return `<section class="deep-card deep-pc">${cardTitle('i-chip', 'Seu PC, peça por peça')}${body}${unknown}</section>`;
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

  /** Plano para este PC, como uma rota: primeiro a BIOS (uma vez), depois o laboratório (o Nexo testa), depois acompanhar. */
  function planHtml(report) {
    const steps = NexoDeep.plan(report.profile || {}, report.findings || []);
    if (!steps.length) return '';
    const GROUPS = [['bios', 'Na BIOS', 'você faz uma vez', 'i-board'], ['laboratorio', 'No laboratório', 'o Nexo testa e mede neste PC', 'i-flask'], ['acompanhar', 'Acompanhar', 'para ver se melhorou', 'i-eye']];
    const item = (step) => {
      let status = '';
      if (step.kind === 'laboratorio') {
        const lab = labStatus(step.knobs || []);
        const best = lab.best > 0 ? ', melhor +' + n(lab.best, 1) + '%' : '';
        status = lab.tested ? `<span class="pill" data-role="done">testado: ${plural(lab.tested, 'opção', 'opções')}${best}</span>` : '<span class="pill" data-role="todo">a testar</span>';
      } else if (step.done) status = '<span class="pill" data-role="done">feito</span>';
      return `<li${step.done ? ' data-done="1"' : ''}>${el('strong', '', step.title)}${status}${el('p', 'muted', step.why)}</li>`;
    };
    const groups = GROUPS.map(([kind, label, hint, ico]) => {
      const mine = steps.filter((step) => step.kind === kind);
      if (!mine.length) return '';
      return `<li class="plan-stop" data-kind="${kind}"><span class="plan-mark">${icon(ico)}</span><div><h5>${escapeHtml(label)} <span>${escapeHtml(hint)}</span></h5><ul class="plan-list">${list(mine, item)}</ul></div></li>`;
    }).join('');
    const labButton = steps.some((step) => step.kind === 'laboratorio') ? '<button class="btn sm" type="button" data-deep-goto="lab">Abrir o laboratório</button>' : '';
    return `<section class="deep-card deep-plan">${cardTitle('i-flask', 'Plano para este PC')}${el('p', 'muted', 'Montado a partir das peças. Cada teste do laboratório fica guardado e o plano vai se ajustando.')}<ol class="plan-route">${groups}</ol>${labButton}</section>`;
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
      Number.isFinite(sys.availMBMin) ? `memória livre mín. ${n(sys.availMBMin / 1024, 1)} GB` : null, obs.self?.cpuAvg ? `o próprio Nexo usou ${n(obs.self.cpuAvg, 1)}% medindo (fora da lista)` : null].filter(Boolean).join(' · ');
    const intro = `Observei por ${n(obs.seconds)} s (${plural(obs.samples, 'leitura', 'leituras')}). ${games.length ? 'O jogo, os launchers e o próprio Nexo ficam fora da conta.' : 'Nenhum jogo aberto: o que pesa agora pesa também quando você joga, se não fechar antes.'}`;
    const pills = games.length || launchers.length ? '<div class="pill-row">' + [...games, ...launchers].join('') + '</div>' : '';
    const body = rows ? '<ul class="ledger deep-ledger">' + rows + '</ul>' : '<p class="deep-clean">Nada pesando por trás. 👌</p>';
    return `<section class="deep-card deep-behind">${cardTitle('i-eye', games.length ? 'O que roda por trás do jogo' : 'O que roda por trás')}${el('p', 'muted', intro)}${pills}${body}${el('small', 'muted', stats)}</section>`;
  }

  /**
   * Termômetro de 30 °C até o limite da peça: verde com folga, amarelo perto, vermelho no limite. `limitText` diz o que é
   * o limite ("o limite do processador" ou "o ponto em que a maioria das placas começa a frear").
   */
  function meterHtml(label, value, limit, limitText = 'o limite') {
    if (!Number.isFinite(value)) return '';
    const low = 30;
    const pct = Math.max(0, Math.min(100, ((value - low) / (limit - low)) * 100));
    const room = limit - value;
    let zone = 'cool';
    if (room <= 5) zone = 'hot';
    else if (room <= 15) zone = 'warm';
    const where = limitText.includes('°C') ? limitText : limitText + ' (' + limit + ' °C)';
    const note = room > 0.5 ? `${Math.round(room)} °C de folga até ${where}` : `chegou ${/^os? /.test(where) ? 'a' + where : 'a ' + where}`;
    return `<div class="meter" data-zone="${zone}"><div class="meter-head">${el('span', '', label)}<strong>${n(value)} °C</strong></div><div class="meter-track"><i data-css="left:${pct.toFixed(1)}%"></i></div>${el('small', '', note)}</div>`;
  }

  /** As pistas do PCIe desenhadas: acesas as que estão em uso, apagadas as que a placa aceitaria. */
  function lanesHtml(gen, width, maxWidth, maxGen) {
    if (!width) return '';
    const total = Math.max(width, maxWidth || width);
    const lanes = Array.from({ length: Math.min(16, total) }, (_, i) => `<i${i < width ? ' class="on"' : ''}></i>`).join('');
    const now = gen ? `PCIe ${gen}.0 x${width}` : `x${width}`;
    const betterGen = maxGen && gen && maxGen > gen;
    const wider = maxWidth && maxWidth > width;
    let note = `${plural(width, 'pista', 'pistas')} em uso`;
    const accepts = [betterGen ? 'PCIe ' + maxGen + '.0' : '', wider ? 'x' + maxWidth : ''].filter(Boolean).join(' ');
    if (accepts) note = 'a placa aceita ' + accepts;
    return `<div class="lanes"><div class="meter-head">${el('span', '', 'Link da placa de vídeo')}<strong>${escapeHtml(now)}</strong></div><div class="lane-row" aria-hidden="true">${lanes}</div>${el('small', '', note)}</div>`;
  }

  function loadHtml(report) {
    const { load } = report;
    if (!load) return '';
    const cpu = report.profile?.cpu || {};
    const gpuInfo = load.gpu || {};
    const linkFromDevice = (load.links || []).map((item) => item.link).find((link) => link?.width);
    const gen = gpuInfo.pcieGen || linkFromDevice?.gen || null;
    const width = gpuInfo.pcieWidth || linkFromDevice?.width || null;
    const maxWidth = gpuInfo.pcieWidthMax || linkFromDevice?.maxWidth || null;
    const maxGen = gpuInfo.pcieGenMax || linkFromDevice?.maxGen || null;
    const clocks = [[load.clock?.allCoreMHz, 'todos os núcleos'], [load.clock?.singleMHz, 'um núcleo (turbo)']].filter(([value]) => Number.isFinite(value) && value > 0);
    const nums = clocks.length ? '<div class="load-nums">' + list(clocks, ([value, label]) => `<div><strong>${n(value)}</strong><span>MHz · ${escapeHtml(label)}</span></div>`) + '</div>' : '';
    const cpuMeter = meterHtml('Temperatura no pico', load.temps?.cpuPeak, NexoDeep.tjMaxOf ? NexoDeep.tjMaxOf(cpu) : 100, 'o limite');
    const cpuBlock = nums || cpuMeter ? `<div class="load-block" data-node="cpu">${el('span', 'load-cap', 'Processador em carga')}${nums}${cpuMeter}</div>` : '';
    const gpuMeter = meterHtml('Temperatura no pico', load.temps?.gpuPeak, 90, 'os 90 °C, onde a maioria das placas começa a frear');
    const lanes = lanesHtml(gen, width, maxWidth, maxGen);
    const gpuBlock = gpuMeter || lanes ? `<div class="load-block" data-node="gpu">${el('span', 'load-cap', 'Placa de vídeo acordada')}${gpuMeter}${lanes}</div>` : '';
    const single = load.bench?.single ? '<strong>' + n(load.bench.single, 0) + '</strong>' + el('small', '', 'um núcleo') : '';
    const bench = load.bench?.multi ? `<div class="load-bench" data-node="board">${el('span', '', 'Pontuação do Nexo')}<strong>${n(load.bench.multi, 0)}</strong>${el('small', '', 'todos os núcleos')}${single}</div>` : '';
    const signed = (value, digits) => (value >= 0 ? '+' : '') + n(value, digits);
    const changes = (report.comparison?.changes || []).map((item) => (item.pct === undefined ? `${item.label}: ${signed(item.delta, 0)} °C` : `${item.label}: ${signed(item.pct, 1)}%`));
    const body = cpuBlock || gpuBlock ? `<div class="load-grid">${cpuBlock}${gpuBlock}</div>${bench}` : `${bench}<p class="muted">Sem leituras de sensores neste PC.</p>`;
    const since = changes.length ? el('p', 'muted load-since', `Desde a análise de ${new Date(report.comparison.at).toLocaleDateString('pt-BR')}: ${changes.join('; ')}`) : '';
    return `<section class="deep-card deep-load">${cardTitle('i-bolt', 'Teste de carga')}${body}${since}</section>`;
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
    return `<section class="deep-card deep-routine">${cardTitle('i-clock', 'Sua rotina')}${el('p', 'muted', facts.join(' · '))}${rows ? '<ul class="routine-list">' + rows + '</ul>' : ''}${empty}</section>`;
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

  /**
   * Carta celeste do relatório: nebulosa na cor de cada peça (âmbar onde há o que ajustar), órbitas de fundo, poeira,
   * as ligações e cada estrela com o tipo e o nome da peça. O número na estrela é quantos pontos ela tem para ajustar.
   */
  function chartSvg(names, nodes, counts, platform) {
    let seed = 11;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const defs = veil('deep-chart-neb', '#9fb8ff', 0.16) + veil('deep-chart-neb-warn', '#ffc98a', 0.22) + veil('deep-chart-milky', '#c9d6ff', 0.09);
    const nebula = '<ellipse class="deep-milky" cx="500" cy="168" rx="560" ry="92" transform="rotate(-7 500 168)" fill="url(#deep-chart-milky)" />' + NODES.map((item) => {
      const [x, y] = CHART[item.id];
      const warn = nodes[item.id] === 'warn';
      return `<circle cx="${x}" cy="${y}" r="${warn ? 140 : 112}" fill="url(#deep-chart-neb${warn ? '-warn' : ''})" />`;
    }).join('');
    const dust = Array.from({ length: 120 }, () => `<circle class="deep-dust" cx="${Math.round(rand() * 1000)}" cy="${Math.round(rand() * 320)}" r="${(0.5 + rand() * 1.3).toFixed(2)}" />`).join('');
    const orbits = '<g class="deep-orbitlines" aria-hidden="true"><ellipse cx="480" cy="166" rx="430" ry="138" /><ellipse cx="480" cy="166" rx="280" ry="90" /><ellipse cx="480" cy="166" rx="132" ry="44" /></g>';
    const edges = EDGES.map(([a, b]) => `<line class="deep-edge" data-a="${a}" data-b="${b}" x1="${CHART[a][0]}" y1="${CHART[a][1]}" x2="${CHART[b][0]}" y2="${CHART[b][1]}" pathLength="1" />`).join('');
    const stars = NODES.map((item, index) => {
      const [x, y] = CHART[item.id];
      const top = TOP.has(item.id);
      const count = counts[item.id] || 0;
      const badge = count ? `<g class="deep-badge" transform="translate(25 -3)"><circle r="10.5" /><text y="4">${count}</text></g>` : '';
      const name = names[item.id] ? `<text class="deep-name" y="${top ? -30 : 60}">${escapeHtml(names[item.id])}</text>` : '';
      return `<g class="deep-star${name ? ' named' : ''}" data-node="${item.id}" data-state="${nodes[item.id] || 'done'}" data-order="${index}" transform="translate(${x} ${y})">
        <circle class="deep-hit" r="30" />${starLight('deep-chart', item.id, 36, 22)}<circle class="deep-ring" r="19" /><circle class="deep-core" r="6.5" />${badge}
        <text class="deep-label" y="${top ? (name ? -52 : -30) : 40}">${escapeHtml(labelOf(item, platform))}</text>${name}</g>`;
    }).join('');
    return `<defs>${defs}</defs><g class="deep-nebula" aria-hidden="true">${nebula}</g>${orbits}<g class="deep-dusts">${dust}</g><g class="deep-edges">${edges}</g><g class="deep-stars">${stars}</g>`;
  }

  /** Placar em fichas: quantos para resolver, para ajustar, sugestões e o que já está certo (cada ficha leva até a lista). */
  function tallyHtml(count, more, ok) {
    const chips = [
      ['alta', count('alta'), 'para resolver', 'findings'],
      ['media', count('media'), count('media') === 1 ? 'vale ajustar' : 'valem ajustar', 'findings'],
      ['baixa', more.length, more.length === 1 ? 'sugestão' : 'sugestões', 'more'],
      ['ok', ok.length, ok.length === 1 ? 'já certa' : 'já certas', 'ok']
    ].filter(([, value]) => value > 0);
    return chips.length ? '<div class="deep-tally">' + list(chips, ([sev, value, label, jump]) => `<button type="button" class="tally" data-sev="${sev}" data-jump="${jump}"><b>${value}</b>${escapeHtml(label)}</button>`) + '</div>' : '';
  }

  /** Nota de 0 a 100 sempre numérica: relatório antigo ou corrompido recalcula pelos achados. */
  function scoreOf(report) {
    const raw = typeof report?.score === 'number' && Number.isFinite(report.score) ? report.score : NexoDeep.healthScore(report?.findings || []);
    return Math.max(0, Math.min(100, Math.round(raw)));
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
    const resolved = comparison?.resolved?.length ? el('p', 'deep-resolved', 'Resolvido desde a última vez: ' + comparison.resolved.join('; ')) : '';
    const okHtml = ok.length ? `<section class="deep-card deep-ok">${cardTitle('i-check', 'Já está certo')}<ul>` + list(ok, (item) => el('li', '', item.title)) + '</ul></section>' : '';
    const score = scoreOf(report);
    let story = { identity: '', verdict: '', good: null };
    if (report.profile?.cpu) { try { story = NexoDeep.narrative(report.profile, findings); } catch { /* perfil incompleto */ } }
    let names = {};
    try { names = NexoHardware.shortNames(report.profile || {}); } catch { names = {}; }
    const nodes = Object.fromEntries(NODES.map((item) => [item.id, 'done']));
    const counts = {};
    for (const item of main) {
      const id = AREA_NODE[item.area];
      if (!id) continue;
      nodes[id] = 'warn';
      counts[id] = (counts[id] || 0) + 1;
    }
    const ring = 2 * Math.PI * 42;
    const ticks = Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2; const r1 = i % 5 ? 47 : 45.5; return `<line x1="${(50 + r1 * Math.cos(a)).toFixed(2)}" y1="${(50 + r1 * Math.sin(a)).toFixed(2)}" x2="${(50 + 49 * Math.cos(a)).toFixed(2)}" y2="${(50 + 49 * Math.sin(a)).toFixed(2)}" />`; }).join('');
    reportBox.innerHTML = `<div class="deep-hero">
        <div class="deep-hero-top">
          <div class="deep-score-box"><div class="deep-score" data-tone="${toneOf(score)}"><svg viewBox="0 0 100 100" aria-hidden="true"><g class="ring-ticks">${ticks}</g><circle class="ring-bg" cx="50" cy="50" r="42" /><circle class="ring" cx="50" cy="50" r="42" stroke-dasharray="${ring.toFixed(1)}" stroke-dashoffset="${ring.toFixed(1)}" data-target="${(ring * (1 - score / 100)).toFixed(1)}" /></svg><strong>${score}</strong><span>de 100</span></div>${scoreTrend(report.history)}</div>
          <div class="deep-head-text">${el('span', 'deep-kicker', fromDisk ? 'Seu PC, da última análise' : 'Seu PC, entendido')}${el('h3', '', story.identity || (main.length ? 'O que encontrei no seu PC' : 'Seu PC está em ordem'))}${story.verdict ? el('p', 'deep-verdict', story.verdict) : ''}${story.good ? el('p', 'deep-good', story.good) : ''}${tallyHtml(count, more, ok)}</div>
          <div class="deep-hero-actions"><button class="btn primary" type="button" data-deep-again="1">Analisar de novo</button>${el('small', 'muted', stamp(report, fromDisk))}</div>
        </div>
        <svg class="deep-sky deep-chart" id="deep-report-sky" viewBox="0 0 1000 320" role="group" aria-label="Carta celeste do seu PC: cada estrela é uma peça; as amarelas têm algo para ajustar. Toque numa para ver a peça.">${chartSvg(names, nodes, counts, report.platform || report.profile?.os?.platform)}</svg>
        <p class="deep-chart-hint">Cada estrela é uma peça do seu PC. As amarelas têm algo para ajustar; toque numa para ver os detalhes dela.</p>
      </div>
      <div class="deep-grid">
        <div class="deep-col">
          <section class="deep-card deep-findings">${cardTitle('i-spark', 'O que fazer, do mais importante para o menos')}${mainHtml}${moreHtml}${resolved}</section>
          ${behindHtml(report)}
          ${loadHtml(report)}
          ${routineHtml(routine)}
        </div>
        <div class="deep-col">${pcHtml(report)}${planHtml(report)}${okHtml}</div>
      </div>`;
    show('report');
    finishReport();
  }

  /** Depois de montar: estrelas acendendo uma a uma, anel da nota enchendo e cartões entrando em sequência. */
  function finishReport() {
    const chart = document.getElementById('deep-report-sky');
    for (const star of chart.querySelectorAll('.deep-star')) {
      star.setAttribute('tabindex', '0');
      star.setAttribute('role', 'button');
      const label = star.querySelector('.deep-label')?.textContent || 'peça';
      const name = star.querySelector('.deep-name')?.textContent;
      star.setAttribute('aria-label', 'Ver ' + (name ? label + ': ' + name : label) + ' em Seu PC');
      star.style.setProperty('--i', star.dataset.order || '0');
    }
    paintStates(chart, Object.fromEntries([...chart.querySelectorAll('.deep-star')].map((star) => [star.dataset.node, star.dataset.state])));
    reportBox.querySelectorAll('.deep-card').forEach((card, index) => card.style.setProperty('--i', String(index)));
    const ring = reportBox.querySelector('.deep-score .ring');
    const go = () => { if (ring) ring.style.strokeDashoffset = ring.dataset.target; };
    if (calm()) { go(); reportBox.classList.add('calm'); } else { reportBox.classList.remove('calm'); requestAnimationFrame(() => requestAnimationFrame(go)); }
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
      recordActivity('Análise profunda', bad ? `${bad} ${bad > 1 ? 'pontos' : 'ponto'} para ajustar · nota ${scoreOf(report)}` : `nada importante · nota ${scoreOf(report)}`);
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
    paintStates(intro, Object.fromEntries(NODES.map((item) => [item.id, 'done'])));
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
  reportBox.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest?.('.deep-star')) { event.preventDefault(); event.target.closest('.deep-star').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  reportBox.addEventListener('click', (event) => {
    const star = event.target.closest('.deep-star');
    if (star) {
      const row = reportBox.querySelector(`.pc-list > li[data-node="${star.dataset.node}"]`);
      if (row) { row.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' }); row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
      return;
    }
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.jump) {
      const where = { findings: '.deep-findings', more: '.deep-more', ok: '.deep-ok' }[target.dataset.jump];
      const box = where ? reportBox.querySelector(where) : null;
      if (box?.tagName === 'DETAILS') box.open = true;
      box?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
      return;
    }
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
