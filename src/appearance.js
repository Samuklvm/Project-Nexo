/*
 * Aparência: cor de destaque, tom do céu pela hora do dia e as opções do céu vivo (vagalumes, estrelas, meteoros).
 * Tudo fica neste PC (localStorage) e entra na sincronização junto das preferências.
 */
(function () {
  const ACCENT_KEY = 'nexo-accent';
  const HOUR_KEY = 'nexo-sky-hour';
  const ACCENTS = [
    { id: 'estrela', label: 'Estrela', a: '#5ad7ff', b: '#7f9bff' },
    { id: 'nebulosa', label: 'Nebulosa', a: '#b48cff', b: '#ff8ce8' },
    { id: 'meteoro', label: 'Meteoro', a: '#ff7ab8', b: '#ffb36b' },
    { id: 'aurora', label: 'Aurora', a: '#5cf2b5', b: '#5ad7ff' },
    { id: 'vagalume', label: 'Vagalume', a: '#e3ff7a', b: '#ffd36b' },
    { id: 'brasa', label: 'Brasa', a: '#ff8a5c', b: '#ff5c8a' },
    { id: 'lua', label: 'Lua', a: '#dfe7ff', b: '#9fb4ff' }
  ];
  const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* só nesta sessão */ } };

  Nexo.accents = ACCENTS;
  Nexo.setAccent = (id, { save = true } = {}) => {
    const accent = ACCENTS.find((item) => item.id === id) || ACCENTS[0];
    if (accent.id === 'estrela') delete document.body.dataset.accent; else document.body.dataset.accent = accent.id;
    if (save) write(ACCENT_KEY, accent.id);
    document.querySelectorAll('#accent-picker button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.accent === accent.id)));
    Nexo.accent = accent.id;
    Nexo.emit('accent', accent.id);
  };

  /** Hora do céu: anoitecer (18–20h), noite (20–1h), madrugada (1–5h), amanhecer (5–7h), dia (7–18h). */
  const skyHour = (date = new Date()) => { const h = date.getHours(); return h >= 18 && h < 20 ? 'anoitecer' : h >= 20 || h < 1 ? 'noite' : h < 5 ? 'madrugada' : h < 7 ? 'amanhecer' : 'dia'; };
  Nexo.skyHour = skyHour;
  const applyHour = () => { if (read(HOUR_KEY, 'on') === 'on') document.body.dataset.skyHour = skyHour(); else delete document.body.dataset.skyHour; };
  setInterval(applyHour, 5 * 60 * 1000).unref?.();

  function renderPicker() {
    const box = document.getElementById('accent-picker');
    if (!box) return;
    box.innerHTML = ACCENTS.map((item) => `<button type="button" data-accent="${item.id}" style="--a:${item.a};--b:${item.b}" title="${item.label}" aria-label="${item.label}" aria-pressed="${String((Nexo.accent || 'estrela') === item.id)}"></button>`).join('');
    box.addEventListener('click', (event) => { const button = event.target.closest('button[data-accent]'); if (button) { Nexo.setAccent(button.dataset.accent); showToast(`Destaque: ${button.title}.`); } });
  }

  function renderSky() {
    const box = document.getElementById('sky-settings');
    if (!box || !Nexo.sky) return;
    const prefs = Nexo.sky.prefs();
    const row = (key, title, text, checked) => `<label class="switch compact sky-row"><input type="checkbox" data-sky="${key}" ${checked ? 'checked' : ''} /><i></i><span><strong>${title}</strong><small>${text}</small></span></label>`;
    box.innerHTML = `<div class="setting-row"><div><strong>Céu vivo</strong><p class="muted">Tudo leve: no máximo 30 quadros por segundo, e para com o app fora de foco ou no modo Leve.</p></div>
      <div class="segmented sm" role="group" aria-label="Quantidade no céu">${['pouco', 'normal', 'muito'].map((d) => `<button type="button" data-density="${d}" aria-pressed="${String(prefs.density === d)}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
      <div class="sky-grid">
        ${row('fireflies', 'Vagalumes', 'Luzes que vagam perto das flores.', prefs.fireflies)}
        ${row('cursor', 'Vagalumes curiosos', 'Chegam perto do mouse.', prefs.cursor)}
        ${row('twinkle', 'Estrelas piscando', 'O céu respira devagar.', prefs.twinkle)}
        ${row('meteors', 'Estrelas cadentes', 'De vez em quando, uma cruza o céu.', prefs.meteors)}
        ${row('showers', 'Chuva de meteoros', 'Às vezes vêm várias de uma vez.', prefs.showers)}
        <label class="switch compact sky-row"><input type="checkbox" data-sky-hour-toggle ${read(HOUR_KEY, 'on') === 'on' ? 'checked' : ''} /><i></i><span><strong>Céu acompanha a hora</strong><small>Anoitecer, madrugada e amanhecer mudam o tom.</small></span></label>
      </div>
      <div class="btn-row"><button class="btn sm" type="button" data-sky-shower>Chuva de meteoros agora</button><span class="muted">Dica: clique duas vezes no céu vazio.</span></div>`;
  }
  document.addEventListener('change', (event) => {
    const input = event.target;
    if (input.matches?.('[data-sky]')) Nexo.sky.set({ [input.dataset.sky]: input.checked });
    if (input.matches?.('[data-sky-hour-toggle]')) { write(HOUR_KEY, input.checked ? 'on' : 'off'); applyHour(); }
  });
  document.addEventListener('click', (event) => {
    const density = event.target.closest?.('[data-density]');
    if (density) { Nexo.sky.set({ density: density.dataset.density }); density.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === density))); }
    if (event.target.closest?.('[data-sky-shower]')) { Nexo.sky.shower(); if (Nexo.effectsLite) showToast('O modo Leve está ligado: o céu fica parado.'); }
  });

  Nexo.setAccent(read(ACCENT_KEY, 'estrela'), { save: false });
  applyHour();
  renderPicker();
  renderSky();
})();
