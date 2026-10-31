/* Interface: navegação, confirmação, paleta de comandos, efeitos e céu animado. */
(function () {
  const TITLES = { home: 'Início', analysis: 'Análise', optimize: 'Otimizar', hardware: 'Hardware', maintenance: 'Manutenção', activity: 'Atividade', updates: 'Atualizações', settings: 'Ajustes' };

  Nexo.go = function go(view) {
    if (!TITLES[view]) view = 'home';
    Nexo.state.view = view;
    $$('.rail-item').forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    $$('.view').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
    setText('page-title', TITLES[view]);
    $('#stage')?.scrollTo({ top: 0 });
    Nexo.emit('view', view);
  };

  $$('.rail-item').forEach((button) => button.addEventListener('click', () => Nexo.go(button.dataset.view)));
  $$('[data-goto]').forEach((button) => button.addEventListener('click', () => Nexo.go(button.dataset.goto)));

  /* ---------- Confirmação (substitui o window.confirm do sistema) ---------- */
  Nexo.confirm = function confirmDialog({ title, body = '', items = [], confirmLabel = 'Continuar', cancelLabel = 'Cancelar', tone = 'primary' }) {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      const previousFocus = document.activeElement;
      root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${escapeHtml(title)}</h3>${body ? `<p>${escapeHtml(body)}</p>` : ''}
        ${items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
        <div class="modal-actions"><button class="btn" data-answer="no" type="button">${escapeHtml(cancelLabel)}</button><button class="btn ${tone === 'danger' ? 'danger' : 'primary'}" data-answer="yes" type="button">${escapeHtml(confirmLabel)}</button></div></div></div>`;
      const finish = (answer) => {
        document.removeEventListener('keydown', onKey, true);
        root.innerHTML = '';
        previousFocus?.focus?.();
        resolve(answer);
      };
      const buttons = $$('button', root);
      const onKey = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        if (event.key === 'Tab') {
          const index = buttons.indexOf(document.activeElement);
          event.preventDefault();
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        }
      };
      document.addEventListener('keydown', onKey, true);
      root.querySelector('.modal-backdrop').addEventListener('mousedown', (event) => { if (event.target.classList.contains('modal-backdrop')) finish(false); });
      buttons.forEach((button) => button.addEventListener('click', () => finish(button.dataset.answer === 'yes')));
      buttons[1].focus();
    });
  };

  /* ---------- Paleta de comandos (Ctrl+K) ---------- */
  Nexo.commands = [];
  const palette = document.getElementById('palette');
  const input = document.getElementById('palette-input');
  const list = document.getElementById('palette-list');
  let shown = [];
  let selected = 0;

  function renderPalette() {
    const query = input.value.trim().toLocaleLowerCase('pt-BR');
    shown = Nexo.commands.filter((command) => !query || `${command.label} ${command.hint || ''}`.toLocaleLowerCase('pt-BR').includes(query));
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown.map((command, index) => `<li role="option" data-index="${index}" aria-selected="${index === selected}"><span>${escapeHtml(command.label)}</span><small>${escapeHtml(command.hint || '')}</small></li>`).join('')
      : '<li class="empty">Nada encontrado.</li>';
  }
  function openPalette() { palette.hidden = false; input.value = ''; selected = 0; renderPalette(); input.focus(); }
  function closePalette() { palette.hidden = true; }
  function runCommand(command) { closePalette(); command?.run(); }

  input?.addEventListener('input', () => { selected = 0; renderPalette(); });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { selected = Math.min(shown.length - 1, selected + 1); renderPalette(); event.preventDefault(); }
    if (event.key === 'ArrowUp') { selected = Math.max(0, selected - 1); renderPalette(); event.preventDefault(); }
    if (event.key === 'Enter') runCommand(shown[selected]);
    if (event.key === 'Escape') closePalette();
  });
  list?.addEventListener('click', (event) => { const row = event.target.closest('[data-index]'); if (row) runCommand(shown[Number(row.dataset.index)]); });
  palette?.addEventListener('mousedown', (event) => { if (event.target === palette) closePalette(); });
  document.getElementById('open-palette')?.addEventListener('click', openPalette);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); palette.hidden ? openPalette() : closePalette(); }
  });

  /* ---------- Efeitos visuais ---------- */
  Nexo.setEffects = function setEffects(mode) {
    const lite = mode === 'lite';
    document.body.classList.toggle('lite', lite);
    $$('[data-effects]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.effects === (lite ? 'lite' : 'full'))));
    try { localStorage.setItem(Nexo.keys.effects, lite ? 'lite' : 'full'); } catch { /* preferência só nesta sessão */ }
    Nexo.effectsLite = lite;
  };

  /* ---------- Céu: estrelas cadentes discretas ---------- */
  (function ambient() {
    const canvas = document.getElementById('ambient');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (!canvas || reduce.matches) return;
    const context = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let stars = [];
    let nextAt = 2500;
    let last = 0;
    const resize = () => { const ratio = devicePixelRatio || 1; width = canvas.width = innerWidth * ratio; height = canvas.height = innerHeight * ratio; };
    resize();
    addEventListener('resize', resize);
    (function frame(time) {
      requestAnimationFrame(frame);
      if (document.hidden || Nexo.effectsLite) { last = time; return; }
      const delta = Math.min(time - last, 80);
      last = time;
      context.clearRect(0, 0, width, height);
      if (time > nextAt) { stars.push({ x: width * (0.45 + Math.random() * 0.6), y: -30, progress: 0 }); nextAt = time + 5500 + Math.random() * 7000; }
      stars = stars.filter((star) => star.progress < 1);
      for (const star of stars) {
        star.progress += delta / 1500;
        const k = star.progress;
        const headX = star.x - k * width * 0.42;
        const headY = -30 + k * height * 0.78;
        const length = width * 0.11;
        const alpha = Math.sin(k * Math.PI) * 0.75;
        const gradient = context.createLinearGradient(headX, headY, headX + length * 0.55, headY - length * 0.83);
        gradient.addColorStop(0, `rgba(215, 242, 255, ${alpha})`);
        gradient.addColorStop(1, 'rgba(90, 150, 255, 0)');
        context.strokeStyle = gradient;
        context.lineWidth = Math.max(1.2, width / 1400);
        context.lineCap = 'round';
        context.beginPath(); context.moveTo(headX, headY); context.lineTo(headX + length * 0.55, headY - length * 0.83); context.stroke();
      }
    })(0);
  })();

  /* ---------- Controles da janela ---------- */
  $('#window-minimize')?.addEventListener('click', () => desktopBridge?.minimizeWindow?.());
  $('#window-maximize')?.addEventListener('click', () => desktopBridge?.toggleMaximizeWindow?.());
  $('#window-close')?.addEventListener('click', () => desktopBridge?.closeWindow?.());
  const renderWindowState = (state) => {
    const maximize = $('#window-maximize');
    if (!maximize) return;
    maximize.querySelector('use').setAttribute('href', state.maximized ? '#i-restore' : '#i-max');
    maximize.setAttribute('aria-label', state.maximized ? 'Restaurar' : 'Maximizar');
    maximize.title = state.maximized ? 'Restaurar' : 'Maximizar';
  };
  desktopBridge?.getWindowState?.().then(renderWindowState);
  desktopBridge?.onWindowState?.(renderWindowState);
})();
