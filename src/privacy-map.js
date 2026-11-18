/*
 * Mapa da privacidade (Ajustes > Privacidade e dados): uma lanterna no centro, "Este PC", e um fio para cada lugar
 * que pode receber algo dele. Fio aceso, com uma luzinha andando, é caminho aberto agora; fio apagado e tracejado,
 * fechado. Tudo lido do estado real dos interruptores e das contas, nada estimado. Clicar num destino leva ao ajuste.
 */
(function () {
  const host = document.getElementById('privacy-map');
  if (!host) return;
  const state = { cloud: null, account: null, connections: null };
  const checked = (id) => Boolean(document.getElementById(id)?.checked);

  const FLOWS = [
    { id: 'github', label: 'GitHub', on: () => true, fixed: true, what: () => 'Só a pergunta “tem versão nova?”. Sempre aberto.', target: () => document.querySelector('[data-link="repo"]')?.closest('.sheet') },
    { id: 'contagem', label: 'Contagem de uso', on: () => checked('cloud-count'), what: (on) => (on ? '“Este PC abriu hoje”, uma vez por dia, sem saber de quem é.' : 'Fechado: este PC não é contado.'), target: () => document.querySelector('[data-flow="contagem"]') },
    { id: 'erros', label: 'Relatórios de erro', on: () => checked('cloud-errors'), what: (on) => (!on ? 'Fechado: nenhum erro sai deste PC.' : checked('cloud-error-email') ? 'Erros do app, com o seu e-mail para o aviso da correção.' : 'Erros do app, sem nada pessoal.'), target: () => document.querySelector('[data-flow="erros"]') },
    { id: 'telemetria', label: 'Telemetria', on: () => checked('cloud-telemetry'), what: (on) => (on ? 'Um resumo anônimo por dia.' : 'Fechado: nenhum resumo sai.'), target: () => document.querySelector('[data-flow="telemetria"]') },
    { id: 'sync', label: 'Sincronização', on: () => Boolean(state.cloud?.connected), what: (on) => (on ? 'Uma cópia criptografada deste PC no servidor do Nexo.' : 'Fechado: nada é copiado.'), target: () => document.getElementById('cloud-sheet') },
    { id: 'google', label: 'Google', on: () => Boolean(state.account?.profile), what: (on) => (on ? 'Só no login: o Google confirma quem é você.' : 'Fechado: sem conta Google no Nexo.'), target: () => document.getElementById('account-sheet') },
    { id: 'steam', label: 'Steam', on: () => Boolean(state.connections?.steam?.signedIn || state.connections?.steam?.hasKey) || checked('set-covers'), what: (on) => (on ? 'Consultas de jogos, conquistas e capas oficiais.' : 'Fechado: só o que a Steam já guarda no PC.'), target: () => document.querySelector('.conn-card[data-brand="steam"]') },
    { id: 'discord', label: 'Discord', on: () => Boolean(state.connections?.discord?.enabled && state.connections?.discord?.configured), what: (on) => (on ? 'O jogo de agora, pelo Discord aberto no PC.' : 'Fechado: nada no seu perfil.'), target: () => document.querySelector('.conn-card[data-brand="discord"]') }
  ];

  /* Desenho: a lanterna no meio, os destinos numa elipse e fios que caem um pouco, como seda pendurada. */
  const W = 760, H = 300, CX = 380, CY = 150, RX = 300, RY = 112;
  const spots = FLOWS.map((flow, index) => {
    const angle = -Math.PI / 2 + (index + 0.5) * (2 * Math.PI / FLOWS.length);
    return { x: Math.round(CX + RX * Math.cos(angle)), y: Math.round(CY + RY * Math.sin(angle)) };
  });
  const threadPath = (spot) => {
    const mx = (CX + spot.x) / 2, my = (CY + spot.y) / 2 + 26; // o fio cede no meio
    return `M${CX} ${CY}Q${mx} ${my} ${spot.x} ${spot.y}`;
  };
  const LANTERN = '<g class="pm-lantern" transform="translate(354 96)"><path class="pm-iron" d="M26 0v8"/><circle class="pm-iron" cx="26" cy="11" r="3.4"/><path class="pm-iron-fill" d="M12 26 26 14l14 12z"/><path class="pm-iron-fill" d="M10 26h32v3.5H10z"/><path class="pm-glass" d="M14 29.5h24l-2 30H16z"/><path class="pm-iron" d="M21 30l-.8 29M31 30l.8 29M14.5 44h23"/><path class="pm-flame" d="M26 36c3.4 4.4 4.4 8 0 13.4-4.4-5.4-3.4-9 0-13.4z"/><path class="pm-iron-fill" d="M13 59.5h26l-4 5H17z"/><path class="pm-iron-fill" d="M22.5 64.5h7L26 72z"/></g>';

  host.innerHTML = `<svg class="pm-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Para onde os seus dados podem ir">
    <defs><radialGradient id="pm-halo"><stop offset="0" stop-color="#ffcf7a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient></defs>
    <circle cx="${CX}" cy="${CY - 6}" r="78" fill="url(#pm-halo)" class="pm-halo"/>
    ${FLOWS.map((flow, i) => `<path class="pm-thread" data-thread="${flow.id}" d="${threadPath(spots[i])}"/>`).join('')}
    ${FLOWS.map((flow) => `<circle class="pm-bead" data-bead="${flow.id}" r="3.2" cx="${CX}" cy="${CY}"/>`).join('')}
    ${LANTERN}
    <text class="pm-center" x="${CX}" y="${CY + 50}" text-anchor="middle">Este PC</text>
    ${FLOWS.map((flow, i) => {
      const { x, y } = spots[i];
      const below = y >= CY;
      return `<g class="pm-node" data-node="${flow.id}" transform="translate(${x} ${y})" tabindex="0" role="button">
        <circle class="pm-seal" r="11"/><circle class="pm-core" r="4.5"/>
        <text class="pm-label" y="${below ? 28 : -20}" text-anchor="middle">${escapeHtml(flow.label)}</text>
        <text class="pm-state" y="${below ? 42 : -34}" text-anchor="middle"></text>
      </g>`;
    }).join('')}
  </svg>
  <p class="pm-caption" id="pm-caption" aria-live="polite"></p>`;

  const svg = host.querySelector('svg');
  const caption = host.querySelector('#pm-caption');
  let focusFlow = null;

  function render() {
    let open = 0;
    for (const flow of FLOWS) {
      const on = flow.on();
      if (on) open += 1;
      svg.querySelector(`[data-thread="${flow.id}"]`).classList.toggle('on', on);
      svg.querySelector(`[data-bead="${flow.id}"]`).classList.toggle('on', on);
      const node = svg.querySelector(`[data-node="${flow.id}"]`);
      node.classList.toggle('on', on);
      node.querySelector('.pm-state').textContent = flow.fixed ? 'sempre' : on ? 'aberto' : 'fechado';
      node.setAttribute('aria-label', `${flow.label}: ${on ? 'aberto' : 'fechado'}. ${flow.what(on)}`);
    }
    const focus = FLOWS.find((flow) => flow.id === focusFlow);
    caption.innerHTML = focus
      ? `<b>${escapeHtml(focus.label)}</b> · ${escapeHtml(focus.what(focus.on()))}`
      : `<b>${open} de ${FLOWS.length}</b> caminhos abertos agora. Tudo o que o Nexo aprende fica aqui, na lanterna.`;
  }

  svg.addEventListener('pointerover', (event) => { const node = event.target.closest('[data-node]'); if (node && node.dataset.node !== focusFlow) { focusFlow = node.dataset.node; render(); } });
  svg.addEventListener('pointerleave', () => { focusFlow = null; render(); });
  svg.addEventListener('focusin', (event) => { const node = event.target.closest('[data-node]'); if (node) { focusFlow = node.dataset.node; render(); } });
  const open = (node) => { const flow = FLOWS.find((item) => item.id === node.dataset.node); Nexo.spotlight?.(flow?.target?.()); };
  svg.addEventListener('click', (event) => { const node = event.target.closest('[data-node]'); if (node) open(node); });
  svg.addEventListener('keydown', (event) => { const node = event.target.closest('[data-node]'); if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(node); } });

  Nexo.on('cloud-status', (value) => { state.cloud = value; render(); });
  Nexo.on('account', (value) => { state.account = value; render(); });
  Nexo.on('connections', (value) => { state.connections = value; render(); });
  document.addEventListener('change', (event) => { if (event.target.closest?.('.privacy-sheet, #set-covers, #conn-grid')) render(); });
  Nexo.on('view', (view) => { if (view === 'settings') { desktopBridge?.getConnections?.().then((value) => { state.connections = value; render(); }).catch(() => {}); render(); } });

  /* As luzinhas andam pelos fios abertos no relógio único (30 quadros), só com a tela aberta, em foco e à vista. */
  const lengths = new Map();
  let visible = false;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || Nexo.effectsLite;
  function step(now) {
    if (!visible || Nexo.state.view !== 'settings' || still() || document.hidden || Nexo.isIdle?.()) { running = false; return false; }
    FLOWS.forEach((flow, index) => {
      const bead = svg.querySelector(`[data-bead="${flow.id}"]`);
      if (!bead.classList.contains('on')) return;
      const path = svg.querySelector(`[data-thread="${flow.id}"]`);
      if (!lengths.has(flow.id)) lengths.set(flow.id, path.getTotalLength());
      const t = ((now / 2600) + index * 0.137) % 1;
      const point = path.getPointAtLength(lengths.get(flow.id) * t);
      bead.setAttribute('cx', point.x.toFixed(1));
      bead.setAttribute('cy', point.y.toFixed(1));
      bead.setAttribute('opacity', (Math.sin(t * Math.PI)).toFixed(2));
    });
    return true;
  }
  let running = false;
  const wake = () => { if (!running && visible && !still()) { running = true; Nexo.clock.add(step); } };
  new IntersectionObserver((entries) => { visible = entries.some((entry) => entry.isIntersecting); wake(); }).observe(host);
  Nexo.on('view', wake);
  Nexo.on('effects', wake);
  addEventListener('focus', wake);
  render();
})();
