/* Interface: navegação, confirmação, paleta de comandos, efeitos e céu animado. */
(function () {
  const TITLES = { home: 'Início', analysis: 'Análise', sessions: 'Sessões', library: 'Biblioteca de jogos', optimize: 'Otimizar', lab: 'Otimização extrema (beta)', atlas: 'Atlas de opções', hardware: 'Hardware', maintenance: 'Manutenção', activity: 'Atividade', updates: 'Atualizações', settings: 'Ajustes' };

  /** Troca de tela (marca o item da barra lateral e avisa quem precisa redesenhar). */
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
    document.body.dataset.view = view;
    $('#stage')?.scrollTo({ top: 0 });
    Nexo.emit('view', view);
  };

  $$('.rail-item').forEach((button) => button.addEventListener('click', () => Nexo.go(button.dataset.view)));
  $$('[data-goto]').forEach((button) => button.addEventListener('click', () => Nexo.go(button.dataset.goto)));

  /* Só uma janela por vez: se outra abrir por cima (ex.: um jogo começou durante uma pergunta), a anterior é
     cancelada de verdade. Antes ela sumia da tela, mas a promessa nunca respondia e o Esc dela fechava a nova. */
  let closeActive = null;
  const takeOver = (close) => { const previous = closeActive; closeActive = close; previous?.(); };
  const release = (close) => { if (closeActive === close) closeActive = null; };

  /* ---------- Confirmação (substitui o window.confirm do sistema) ---------- */
  Nexo.confirm = function confirmDialog({ title, body = '', items = [], confirmLabel = 'Continuar', cancelLabel = 'Cancelar', tone = 'primary' }) {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      let settled = false;
      const cancel = () => finish(false, true);
      takeOver(cancel);
      const previousFocus = document.activeElement;
      const bodyHtml = body ? `<p>${escapeHtml(body)}</p>` : '';
      const itemHtml = (item) => `<li>${escapeHtml(item)}</li>`;
      const listHtml = items.length ? `<ul>${items.map(itemHtml).join('')}</ul>` : '';
      root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${escapeHtml(title)}</h3>${bodyHtml}
        ${listHtml}
        <div class="modal-actions"><button class="btn" data-answer="no" type="button">${escapeHtml(cancelLabel)}</button><button class="btn ${tone === 'danger' ? 'danger' : 'primary'}" data-answer="yes" type="button">${escapeHtml(confirmLabel)}</button></div></div></div>`;
      function finish(answer, replaced = false) {
        if (settled) return;
        settled = true;
        release(cancel);
        document.removeEventListener('keydown', onKey, true);
        if (!replaced) { root.innerHTML = ''; previousFocus?.focus?.(); }
        resolve(answer);
      }
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


  /* ---------- Diálogo rico: corpo atualizável, ações próprias, resultado por promessa ---------- */
  Nexo.dialog = function dialog({ title, html = '', actions = [], dismissible = true, wide = false }) {
    const root = document.getElementById('modal-root');
    const cancel = () => api.close('dismiss', true);
    takeOver(cancel);
    const previousFocus = document.activeElement;
    root.innerHTML = `<div class="modal-backdrop"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h3 id="dialog-title"></h3><div class="dialog-body"></div><div class="modal-actions"></div></div></div>`;
    const heading = $('#dialog-title', root);
    const body = $('.dialog-body', root);
    const bar = $('.modal-actions', root);
    heading.textContent = title;
    body.innerHTML = html;
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    let closed = false;
    const api = {
      done,
      setTitle: (value) => { heading.textContent = value; },
      setBody: (value) => { body.innerHTML = value; },
      setActions(list) {
        bar.replaceChildren(...list.map((action) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `btn${action.tone === 'primary' ? ' primary' : action.tone === 'danger' ? ' danger' : ''}`;
          button.textContent = action.label;
          button.disabled = Boolean(action.disabled);
          button.addEventListener('click', () => { action.onClick?.(); if (!action.keepOpen) api.close(action.id); });
          return button;
        }));
        bar.querySelector('.primary, .danger, .btn:last-child')?.focus?.();
      },
      close(result, replaced = false) {
        if (closed) return;
        closed = true;
        release(cancel);
        document.removeEventListener('keydown', onKey, true);
        if (!replaced) { root.innerHTML = ''; previousFocus?.focus?.(); }
        finish(result);
      }
    };
    const onKey = (event) => { if (event.key === 'Escape' && dismissible) { event.preventDefault(); api.close('dismiss'); } };
    document.addEventListener('keydown', onKey, true);
    if (dismissible) root.querySelector('.modal-backdrop').addEventListener('mousedown', (event) => { if (event.target.classList.contains('modal-backdrop')) api.close('dismiss'); });
    api.setActions(actions);
    return api;
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
  function openPalette() { palette.hidden = false; input.value = ''; selected = 0; renderPalette(); input.focus(); Nexo.emit('telemetry-ui', 'paleta'); }
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
    Nexo.emit?.('effects', lite ? 'lite' : 'full');
  };

  /* ---------- Velocidade das leituras ao vivo ---------- */
  const LIVE_RATE_KEY = 'nexo-live-rate';
  Nexo.liveRate = (() => { try { return localStorage.getItem(LIVE_RATE_KEY) || 'realtime'; } catch { return 'realtime'; } })();
  Nexo.setLiveRate = function setLiveRate(mode, { save = true } = {}) {
    Nexo.liveRate = ['realtime', 'balanced', 'eco'].includes(mode) ? mode : 'realtime';
    $$('[data-live-rate]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.liveRate === Nexo.liveRate)));
    if (save) { try { localStorage.setItem(LIVE_RATE_KEY, Nexo.liveRate); } catch { /* só nesta sessão */ } }
    Nexo.emit('live-rate', Nexo.liveRate);
  };
  Nexo.liveRateStored = () => { try { return localStorage.getItem(LIVE_RATE_KEY) !== null; } catch { return true; } };

  /* O céu (estrelas, vagalumes e meteoros) fica em src/sky.js. */

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
