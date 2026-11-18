/*
 * Ajustes como um lugar só. Aqui ficam:
 *  - a lista dos ajustes que têm um padrão (o pontinho de "mudado", "Restaurar o padrão" por seção, o "Desfazer"
 *    depois de cada mudança, os Encantos de um toque, a cópia dos ajustes em arquivo e os atalhos na busca Ctrl+K);
 *  - o modo leve automático (na bateria e durante uma sessão de jogo), que liga o modo leve sem trocar a escolha da
 *    pessoa em "Efeitos visuais" e volta ao que ela escolheu quando a situação passa.
 * Privacidade, contas e perfil de uso ficam de fora de propósito: são escolhas que a pessoa faz uma a uma.
 */
(function () {
  const lsGet = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const lsSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* só nesta sessão */ } };
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ===================== Modo leve automático ===================== */
  const AUTO_KEY = 'nexo-auto-lite';
  const autoPrefs = (() => {
    try { const saved = JSON.parse(lsGet(AUTO_KEY, '{}')); return { battery: saved.battery === true, game: saved.game === true }; }
    catch { return { battery: false, game: false }; }
  })();
  let onBattery = false;
  let forced = null; // 'battery' | 'game' enquanto o modo leve automático está segurando
  let applying = false; // mudanças feitas por aqui (não contam como escolha da pessoa)
  const chosenEffects = () => (lsGet(Nexo.keys.effects) === 'lite' ? 'lite' : 'full');
  const REASONS = { battery: 'o notebook está na bateria', game: 'uma sessão de jogo está gravando' };

  function quietEffects(mode) { applying = true; try { Nexo.setEffects(mode, { save: false }); } finally { applying = false; } }

  function evaluateAuto() {
    const reason = autoPrefs.battery && onBattery ? 'battery' : autoPrefs.game && Nexo.recording?.() ? 'game' : null;
    if (reason && !forced && chosenEffects() === 'full') {
      forced = reason;
      quietEffects('lite');
      showToast(`Modo leve automático: ${REASONS[reason]}. Volta sozinho depois.`);
    } else if (reason && forced) forced = reason;
    else if (!reason && forced) { forced = null; quietEffects(chosenEffects()); }
    renderAutoNote();
  }
  function renderAutoNote() {
    const note = document.getElementById('effects-auto-note');
    if (note) { note.hidden = !forced; note.textContent = forced ? `Leve agora, automático: ${REASONS[forced]}.` : ''; }
    const battery = document.getElementById('auto-lite-battery');
    const game = document.getElementById('auto-lite-game');
    if (battery) battery.checked = autoPrefs.battery;
    if (game) game.checked = autoPrefs.game;
  }
  // A pessoa escolheu um efeito na mão enquanto o automático segurava: a escolha dela manda.
  Nexo.on('effects', () => { if (!applying && forced) { forced = null; renderAutoNote(); } });
  Nexo.on('session-state', evaluateAuto);
  navigator.getBattery?.().then((battery) => {
    const update = () => { onBattery = !battery.charging; evaluateAuto(); };
    battery.addEventListener('chargingchange', update);
    update();
  }).catch(() => { /* sem informação de bateria: nunca liga por ela */ });

  Nexo.autoLite = {
    get: () => ({ ...autoPrefs }),
    set(patch) {
      for (const key of ['battery', 'game']) if (typeof patch?.[key] === 'boolean') autoPrefs[key] = patch[key];
      lsSet(AUTO_KEY, JSON.stringify(autoPrefs));
      evaluateAuto();
      Nexo.emit('auto-lite', { ...autoPrefs });
    },
    active: () => forced
  };
  document.getElementById('auto-lite-battery')?.addEventListener('change', (event) => Nexo.autoLite.set({ battery: event.target.checked }));
  document.getElementById('auto-lite-game')?.addEventListener('change', (event) => Nexo.autoLite.set({ game: event.target.checked }));

  /* ===================== A lista dos ajustes ===================== */
  const box = (id) => document.getElementById(id);
  // Interruptores que já têm quem os salve (view-account.js): mexer pelo próprio interruptor mantém um caminho só.
  const viaSwitch = (id) => ({
    get: () => Boolean(box(id)?.checked),
    set: (value) => { const input = box(id); if (!input || input.disabled || input.checked === value) return; input.checked = value; input.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  const skyDefaults = () => ({ ...(Nexo.sky?.defaults?.() || { fireflies: true, twinkle: true, meteors: true, showers: true, cursor: true, density: 'normal' }), hour: 'on' });
  const DENSITY = { pouco: 'pouco', normal: 'normal', muito: 'muito' };
  const onOff = (value) => (value ? 'ligado' : 'desligado');

  const SETTINGS = [
    { id: 'wallpaper', sec: 'aparencia', label: 'Papel de parede', def: false, noBackup: true, noUndo: true,
      get: () => Boolean(document.documentElement.style.getPropertyValue('--wallpaper-image')),
      set: (value) => { if (!value) box('reset-wallpaper')?.click(); }, say: (value) => (value ? 'imagem sua' : 'o padrão') },
    { id: 'effects', sec: 'aparencia', label: 'Efeitos visuais', def: 'full', valid: (v) => v === 'full' || v === 'lite',
      get: chosenEffects, set: (v) => Nexo.setEffects(v), say: (v) => (v === 'lite' ? 'Leve' : 'Completo') },
    { id: 'accent', sec: 'aparencia', label: 'Cor de destaque', def: 'estrela', valid: (v) => Nexo.accents?.some((item) => item.id === v),
      get: () => Nexo.accent || 'estrela', set: (v) => Nexo.setAccent(v), say: (v) => Nexo.accents?.find((item) => item.id === v)?.label || v },
    { id: 'sky', sec: 'aparencia', label: 'Céu vivo', def: skyDefaults(),
      valid: (v) => v && typeof v === 'object' && ['fireflies', 'twinkle', 'meteors', 'showers', 'cursor'].every((key) => typeof v[key] === 'boolean') && Boolean(DENSITY[v.density]) && (v.hour === 'on' || v.hour === 'off'),
      get: () => ({ ...(Nexo.sky?.prefs?.() || {}), hour: lsGet('nexo-sky-hour', 'on') === 'off' ? 'off' : 'on' }),
      set: (v) => { const { hour, ...sky } = v; Nexo.sky?.set?.(sky); Nexo.setSkyHour?.(hour !== 'off'); },
      say: (v) => `quantidade ${v.density}` },
    { id: 'liveRate', sec: 'desempenho', label: 'Velocidade das leituras', def: 'realtime', valid: (v) => ['realtime', 'balanced', 'eco'].includes(v),
      get: () => Nexo.liveRate || 'realtime', set: (v) => Nexo.setLiveRate(v), say: (v) => ({ realtime: 'Tempo real', balanced: 'Equilibrada', eco: 'Econômica' })[v] },
    { id: 'autoLite', sec: 'desempenho', label: 'Modo leve automático', def: { battery: false, game: false },
      valid: (v) => v && typeof v === 'object' && typeof v.battery === 'boolean' && typeof v.game === 'boolean',
      get: () => Nexo.autoLite.get(), set: (v) => Nexo.autoLite.set(v),
      say: (v) => [v.battery && 'na bateria', v.game && 'nas sessões de jogo'].filter(Boolean).join(' e ') || 'desligado' },
    { id: 'tray', sec: 'segundo-plano', label: 'Ficar na bandeja ao fechar', def: false, valid: (v) => typeof v === 'boolean', ...viaSwitch('set-tray'), say: onOff },
    { id: 'autoSession', sec: 'segundo-plano', label: 'Gravar sessões de jogo sozinho', def: false, valid: (v) => typeof v === 'boolean', ...viaSwitch('set-auto'), say: onOff },
    { id: 'openAtLogin', sec: 'segundo-plano', label: 'Iniciar com o sistema', def: false, valid: (v) => typeof v === 'boolean', ...viaSwitch('set-login'), say: onOff },
    { id: 'onlineCovers', sec: 'segundo-plano', label: 'Buscar capas oficiais na internet', def: false, valid: (v) => typeof v === 'boolean', ...viaSwitch('set-covers'), say: onOff }
  ];
  const byId = Object.fromEntries(SETTINGS.map((item) => [item.id, item]));
  const SECTION_NAMES = { aparencia: 'Aparência', desempenho: 'Desempenho do Nexo', 'segundo-plano': 'Segundo plano' };

  /** Compara valores simples e objetos (sem depender da ordem das chaves). */
  const canon = (value) => (value && typeof value === 'object' ? JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]])) : JSON.stringify(value));
  const same = (a, b) => canon(a) === canon(b);
  const read = (item) => { try { return item.get(); } catch { return item.def; } };
  const snapshot = (ids = SETTINGS.map((item) => item.id)) => Object.fromEntries(ids.map((id) => [id, read(byId[id])]));

  /* ---------- Desfazer ---------- */
  let last = null; // começa a valer depois da abertura (a inicialização do app não vira "mudança")
  let quiet = 0;
  let pending = 0;
  /** Aplica vários ajustes de uma vez sem gerar um "Desfazer" para cada um. */
  function applyQuiet(values) {
    quiet += 1;
    try { for (const [id, value] of Object.entries(values)) { const item = byId[id]; if (item && !same(read(item), value)) { try { item.set(value); } catch { /* um ajuste ruim não impede os outros */ } } } }
    finally { quiet -= 1; }
    settle(true);
  }
  /** Depois de qualquer mudança: atualiza os pontinhos e, se foi a pessoa, oferece desfazer. */
  function settle(silent = false) {
    clearTimeout(pending);
    pending = setTimeout(() => {
      refreshMarks();
      if (!last) return;
      const now = snapshot();
      const changed = SETTINGS.filter((item) => !item.noUndo && !same(now[item.id], last[item.id]));
      const before = last;
      last = now;
      if (silent || quiet || !changed.length) return;
      const undo = { label: 'Desfazer', run: () => { applyQuiet(Object.fromEntries(changed.map((item) => [item.id, before[item.id]]))); showToast('Desfeito.'); } };
      const one = changed.length === 1 ? changed[0] : null;
      showToast(one ? `${one.label}: ${one.say(now[one.id])}.` : `${changed.length} ajustes mudaram.`, undo);
    }, 60);
  }
  setTimeout(() => { last = snapshot(); refreshMarks(); }, 1500);
  for (const event of ['accent', 'effects', 'live-rate', 'sky', 'auto-lite', 'wallpaper']) Nexo.on(event, () => settle(applying));
  document.addEventListener('change', (event) => {
    if (event.target.matches?.('#set-tray, #set-auto, #set-login, #set-covers, [data-sky-hour-toggle]')) settle();
  });
  desktopBridge?.onSettingsChanged?.(() => settle(true));

  /* ---------- Pontinho de "mudado" e Restaurar o padrão ---------- */
  function refreshMarks() {
    for (const item of SETTINGS) {
      const row = document.querySelector(`[data-setting="${item.id}"]`);
      const title = row?.querySelector('strong');
      if (!title) continue;
      const changed = !same(read(item), item.def);
      row.classList.toggle('is-changed', changed);
      title.classList.toggle('sanct-mark', changed);
      if (changed) title.title = `Diferente do padrão (${item.say(item.def)})`; else title.removeAttribute('title');
    }
    for (const button of document.querySelectorAll('[data-reset-sec]')) {
      const sec = button.dataset.resetSec;
      button.hidden = !SETTINGS.some((item) => item.sec === sec && !same(read(item), item.def));
    }
    renderCharms();
  }
  // O céu é redesenhado inteiro quando muda: o pontinho volta a ser marcado.
  const skyBox = box('sky-settings');
  if (skyBox) new MutationObserver(() => refreshMarks()).observe(skyBox, { childList: true });

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-reset-sec]');
    if (!button) return;
    const sec = button.dataset.resetSec;
    const items = SETTINGS.filter((item) => item.sec === sec && !same(read(item), item.def));
    if (!items.length) return;
    const before = snapshot(items.map((item) => item.id));
    applyQuiet(Object.fromEntries(items.map((item) => [item.id, item.def])));
    const undoable = items.filter((item) => !item.noUndo);
    showToast(`${SECTION_NAMES[sec] || 'A seção'} voltou ao padrão.`, undoable.length ? { label: 'Desfazer', run: () => { applyQuiet(Object.fromEntries(undoable.map((item) => [item.id, before[item.id]]))); showToast('Desfeito.'); } } : null);
    recordActivity('Ajustes', `${SECTION_NAMES[sec] || sec}: padrão restaurado`);
  });

  /* ===================== Encantos (presets de um toque) ===================== */
  const CHARMS = [
    { id: 'espetaculo', title: 'Espetáculo', text: 'Tudo aceso: vidro, céu cheio e leituras em tempo real.',
      art: '<circle cx="24" cy="24" r="7"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2"/>',
      values: () => ({ effects: 'full', liveRate: 'realtime', sky: { ...skyDefaults(), density: 'muito' } }) },
    { id: 'jogo', title: 'Modo jogo', text: 'O Nexo fica leve enquanto você joga e grava as sessões sozinho.',
      art: '<path d="M14 34 34 14M34 34 14 14"/><path d="M10 38l4-4M38 38l-4-4M8 32l8 8M40 32l-8 8"/><circle cx="24" cy="24" r="3"/>',
      values: () => ({ liveRate: 'balanced', autoSession: true, autoLite: { ...Nexo.autoLite.get(), game: true } }) },
    { id: 'bateria', title: 'Vela baixa', text: 'Para o notebook: modo leve, leituras econômicas e céu calmo.',
      art: '<path d="M20 20h8v20h-8z"/><path d="M24 8c3 4 3.5 7 0 10-3.5-3-3-6 0-10z"/><path d="M16 40h16"/>',
      values: () => ({ effects: 'lite', liveRate: 'eco', sky: { ...read(byId.sky), density: 'pouco' }, autoLite: { ...Nexo.autoLite.get(), battery: true } }) }
  ];
  const charmOn = (charm) => Object.entries(charm.values()).every(([id, value]) => same(read(byId[id]), value));
  function renderCharms() {
    const host = box('sanct-charms');
    if (!host) return;
    host.innerHTML = CHARMS.map((charm) => {
      const on = charmOn(charm);
      const list = Object.entries(charm.values()).map(([id, value]) => `<li>${escapeHtml(byId[id].label)}: <b>${escapeHtml(byId[id].say(value))}</b></li>`).join('');
      return `<article class="charm${on ? ' is-on' : ''}" data-charm="${charm.id}" data-keywords="encanto preset ${escapeHtml(charm.title)}">
        <svg class="charm-sigil" viewBox="0 0 48 48" aria-hidden="true"><circle class="charm-ring" cx="24" cy="24" r="22"/>${charm.art}</svg>
        <div><h4>${escapeHtml(charm.title)}</h4><p>${escapeHtml(charm.text)}</p><ul>${list}</ul></div>
        <button class="btn sm${on ? '' : ' primary'}" type="button" data-use-charm="${charm.id}" ${on ? 'disabled' : ''}>${on ? 'Em uso' : 'Usar'}</button>
      </article>`;
    }).join('');
  }
  function useCharm(id) {
    const charm = CHARMS.find((item) => item.id === id);
    if (!charm) return;
    const values = charm.values();
    const before = snapshot(Object.keys(values));
    applyQuiet(values);
    showToast(`Encanto “${charm.title}” lançado.`, { label: 'Desfazer', run: () => { applyQuiet(before); showToast('Desfeito.'); } });
    recordActivity('Ajustes', `encanto ${charm.title}`);
  }
  box('sanct-charms')?.addEventListener('click', (event) => { const button = event.target.closest('[data-use-charm]'); if (button) useCharm(button.dataset.useCharm); });

  /* ===================== Cópia dos ajustes em arquivo ===================== */
  box('settings-export')?.addEventListener('click', () => {
    const values = Object.fromEntries(SETTINGS.filter((item) => !item.noBackup).map((item) => [item.id, read(item)]));
    const file = { app: 'Nexo Device Care', tipo: 'ajustes', versao: 1, criadoEm: new Date().toISOString(), valores: values };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexo-ajustes-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Cópia dos ajustes salva.');
  });
  box('settings-import')?.addEventListener('click', () => box('settings-file')?.click());
  box('settings-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 64 * 1024) throw new Error('Esse arquivo é grande demais para ser uma cópia dos ajustes.');
      const data = JSON.parse(await file.text());
      if (data?.tipo !== 'ajustes' || typeof data.valores !== 'object' || !data.valores) throw new Error('Esse arquivo não é uma cópia dos ajustes do Nexo.');
      const accepted = {};
      for (const item of SETTINGS) {
        if (item.noBackup || !Object.hasOwn(data.valores, item.id)) continue;
        const value = data.valores[item.id];
        if (item.valid?.(value)) accepted[item.id] = value;
      }
      const ids = Object.keys(accepted);
      if (!ids.length) throw new Error('Nada nesse arquivo que este Nexo saiba usar.');
      const before = snapshot(ids);
      applyQuiet(accepted);
      showToast(`${ids.length} ajuste${ids.length > 1 ? 's' : ''} trazido${ids.length > 1 ? 's' : ''} do arquivo.`, { label: 'Desfazer', run: () => { applyQuiet(before); showToast('Desfeito.'); } });
      recordActivity('Ajustes', 'cópia dos ajustes trazida de um arquivo');
    } catch (error) { showToast(error instanceof SyntaxError ? 'Esse arquivo não é uma cópia dos ajustes do Nexo.' : error.message); }
  });

  /* ===================== Holofote e busca Ctrl+K ===================== */
  /** Leva até um ajuste e faz ele brilhar por um instante. */
  Nexo.spotlight = function spotlight(element) {
    if (!element) return;
    if (Nexo.state.view !== 'settings') Nexo.go('settings');
    requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: still() || Nexo.effectsLite ? 'auto' : 'smooth', block: 'center' });
      element.classList.remove('sanct-glow');
      void element.offsetWidth; // reinicia a transição se o mesmo ajuste for chamado duas vezes
      element.classList.add('sanct-glow');
      setTimeout(() => element.classList.remove('sanct-glow'), 2400);
    });
  };
  for (const item of SETTINGS) {
    Nexo.commands?.push({ label: `Ajuste: ${item.label}`, hint: 'Ajustes', run: () => Nexo.spotlight(document.querySelector(`[data-setting="${item.id}"]`)) });
  }
  for (const charm of CHARMS) Nexo.commands?.push({ label: `Encanto: ${charm.title}`, hint: 'Ajustes', run: () => useCharm(charm.id) });
  Nexo.commands?.push({ label: 'Salvar uma cópia dos ajustes', hint: 'Ajustes', run: () => box('settings-export')?.click() });

  Nexo.settingsHub = { list: () => SETTINGS.map(({ id, sec, label, def }) => ({ id, sec, label, def })), snapshot, same, useCharm, refresh: refreshMarks };
  Nexo.on('view', (view) => { if (view === 'settings') refreshMarks(); });
  renderAutoNote();
})();
