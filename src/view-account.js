/* Conta Google (opcional) e preferências de segundo plano (bandeja, sessão automática, início com o Windows, capas). */
(function () {
  const bridge = desktopBridge;
  let account = null;
  let packaged = true; // até o processo principal responder, esconde as opções de desenvolvedor

  /* Botões das marcas (Google e Steam): o "carregando" troca só o texto e mantém a logo. */
  const GOOGLE_BUTTON = '<button class="gsi-btn" type="button" id="account-in"><span class="gsi-icon" aria-hidden="true"><svg><use href="#i-google"/></svg></span><span class="gsi-label" data-label>Fazer login com o Google</span></button>';
  const steamButton = (label = 'Entrar com a') => `<button class="steam-btn" type="button" data-conn="steam-in"><svg class="steam-logo" aria-hidden="true"><use href="#i-steam"/></svg><span class="steam-label" data-label><small>${label}</small><b>STEAM</b></span></button>`;
  function brandBusy(button, busy, label) {
    const slot = button?.querySelector('[data-label]');
    if (!slot) { setButtonBusy(button, busy, label); return; }
    if (busy) { slot.dataset.idle = slot.innerHTML; slot.textContent = label; } else if (slot.dataset.idle) slot.innerHTML = slot.dataset.idle;
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
  }
  Nexo.brandBusy = brandBusy;
  const PERKS = [['i-user', 'Seu nome e foto no Nexo'], ['i-refresh', 'Sincronização entre PCs, se você ligar'], ['i-check', 'Aviso quando um erro seu for corrigido']];

  function avatarHtml(url) { return url ? `<img src="${escapeHtml(url)}" alt="" />` : '<svg><use href="#i-user"/></svg>'; }

  /** Desenha o cartão da conta Google (entrar, sair, quem está conectado). */
  function render() {
    const profile = account?.profile;
    document.getElementById('account-avatar').innerHTML = avatarHtml(account?.avatar);
    document.getElementById('account-avatar-lg').innerHTML = avatarHtml(account?.avatar);
    setText('account-chip-label', profile ? profile.name.split(' ')[0] : 'Entrar');
    document.getElementById('account-chip').classList.toggle('signed', Boolean(profile));
    setText('account-name', profile ? profile.name : 'Conta');
    setText('account-kicker', profile ? 'Conectado com o Google' : 'Conta do Nexo');
    document.getElementById('account-sheet')?.classList.toggle('signed', Boolean(profile));
    const perks = document.getElementById('account-perks');
    if (perks) { perks.hidden = !profile && !account?.configured; perks.innerHTML = PERKS.map(([icon, text]) => `<li class="${profile ? 'got' : ''}"><svg aria-hidden="true"><use href="#${icon}"/></svg>${escapeHtml(text)}</li>`).join(''); }
    setText('account-detail', profile ? `${profile.email} · conectado em ${new Date(profile.signedInAt).toLocaleDateString('pt-BR')}` : account?.configured ? 'Entre com a sua conta Google para ter o seu perfil no Nexo.' : packaged ? 'Login com Google indisponível nesta instalação.' : 'O login com Google ainda não foi configurado nesta build.');
    const actions = document.getElementById('account-actions');
    actions.innerHTML = profile ? '<span class="gsi-chip"><svg aria-hidden="true"><use href="#i-google"/></svg>Google</span><button class="btn sm ghost" type="button" id="account-out">Sair da conta</button>'
      : account?.configured ? GOOGLE_BUTTON
      : packaged ? '' : '<button class="btn sm" type="button" id="account-import">Importar credenciais (desenvolvedor)</button>';
    setText('account-note', profile ? `Guardado só neste PC${account.encrypted ? ', cifrado pelo Windows' : ''}: nome, e-mail e foto. O Nexo não guarda senhas nem tokens do Google. A sincronização entre PCs, logo abaixo, é opcional e só liga se você pedir.`
      : account?.configured ? 'Opcional. O login acontece no seu navegador; o Nexo guarda só nome, e-mail e foto neste PC (cifrados pelo Windows) e não guarda senhas nem tokens do Google.'
      : packaged ? 'O login com Google não está disponível nesta instalação. Atualize o Nexo pela página de Atualizações.'
      : 'Para ativar: crie um cliente OAuth “App para computador” no Google Cloud e importe o JSON aqui, ou coloque-o em config/google-oauth.json na build (veja docs/LOGIN_GOOGLE.md).');
  }

  async function refresh() {
    if (!bridge?.getAccount) return;
    try { account = await bridge.getAccount(); } catch { account = null; }
    render();
    Nexo.emit('account', account);
  }

  async function signIn() {
    const button = document.getElementById('account-in');
    brandBusy(button, true, 'Abrindo o navegador…');
    showToast('Continue no navegador. O Nexo espera até 5 minutos.');
    try { account = await bridge.signIn(); render(); Nexo.emit('account', account); showToast(`Olá, ${account.profile.name.split(' ')[0]}!`); recordActivity('Conta Google conectada', account.profile.email); }
    catch (error) { showToast(error.message || 'O login não foi concluído.'); render(); }
  }

  document.getElementById('account-actions').addEventListener('click', async (event) => {
    if (event.target.closest('#account-in')) signIn();
    if (event.target.closest('#account-out')) {
      if (!await Nexo.confirm({ title: 'Sair da conta?', body: 'O nome, o e-mail e a foto guardados neste PC serão apagados e a sincronização deste PC é desligada (as cópias no servidor continuam lá até você apagar).', confirmLabel: 'Sair' })) return;
      account = await bridge.signOut(); render(); Nexo.emit('account', account); showToast('Você saiu da conta.');
    }
    if (event.target.closest('#account-import')) { try { account = await bridge.importOAuthConfig(); render(); if (account.configured) showToast('Credenciais importadas. Agora é só entrar.'); } catch (error) { showToast(error.message); } }
  });
  document.getElementById('account-chip').addEventListener('click', () => { Nexo.go('settings'); document.getElementById('account-sheet').scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  /* ---------- Segundo plano ---------- */
  const TOGGLES = { 'set-tray': 'tray', 'set-auto': 'autoSession', 'set-login': 'openAtLogin', 'set-covers': 'onlineCovers' };
  function applySettings(settings) {
    for (const [id, key] of Object.entries(TOGGLES)) document.getElementById(id).checked = Boolean(settings[key]);
    document.getElementById('set-login').disabled = !settings.packaged;
    // Importar credenciais e integrações é coisa de quem gera a build: some na versão instalada.
    if (packaged !== Boolean(settings.packaged)) { packaged = Boolean(settings.packaged); render(); }
    const importButton = document.getElementById('integrations-import');
    if (importButton) importButton.hidden = packaged;
  }
  for (const [id, key] of Object.entries(TOGGLES)) {
    document.getElementById(id).addEventListener('change', async (event) => {
      try { applySettings(await bridge.setSettings({ [key]: event.target.checked })); }
      catch (error) { event.target.checked = !event.target.checked; showToast(error.message || 'Não foi possível salvar.'); }
    });
  }
  bridge?.onSettingsChanged?.((settings) => applySettings({ ...settings, packaged }));
  Nexo.on('view', (view) => { if (view === 'settings') { refresh(); bridge?.getSettings?.().then(applySettings).catch(() => {}); } });

  /* ---------- Contas e conexões (Steam deste PC, Xbox, Discord) ---------- */
  let connections = null;
  const avatar = (url) => {
    const picture = url ? `<img src="${escapeHtml(url)}" alt="" />` : '<svg><use href="#i-user"/></svg>';
    return `<span class="avatar md">${picture}</span>`;
  };
  const MARKS = {
    steam: '<svg aria-hidden="true"><use href="#i-steam"/></svg>',
    xbox: '<svg aria-hidden="true"><use href="#i-game"/></svg>',
    discord: '<svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>'
  };
  const mark = (brand) => `<span class="conn-mark" data-mark="${brand}">${MARKS[brand]}</span>`;
  const brings = (list) => `<ul class="conn-brings">${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  const status = (on, label) => `<span class="conn-status${on ? ' on' : ''}"><i></i>${escapeHtml(label)}</span>`;
  /** Desenha os cartões de Steam, Xbox e Discord com o estado de cada conexão. */
  function renderConnections() {
    const c = connections;
    const grid = document.getElementById('conn-grid');
    if (!c) { grid.innerHTML = '<p class="muted">Disponível no aplicativo desktop.</p>'; return; }
    const { steam } = c;
    // "Entrar com a Steam": login oficial da Steam no navegador; jogos da conta e conquistas vêm pelo servidor do Nexo.
    const steamLogin = steam.loginAvailable !== false ? steamButton() : '';
    const keyBlock = `<details class="steam-key"${steam.hasKey ? ' open' : ''}><summary>Usar a minha própria chave da Steam Web API (opcional)</summary>
        <label class="field"><span>Só precisa dela se não quiser entrar com a Steam: ela traz os jogos da conta que não estão instalados.</span><div class="key-row"><input id="steam-key" type="password" placeholder="${steam.hasKey ? 'Chave salva (cifrada)' : '32 caracteres'}" autocomplete="off" spellcheck="false" /><button class="btn sm" type="button" data-conn="steam-key">${steam.hasKey ? 'Trocar' : 'Salvar'}</button></div></label>
        <div class="btn-row"><button class="link" type="button" data-conn="steam-keypage">Onde pego a minha chave?</button>${steam.hasKey ? '<button class="link" type="button" data-conn="steam-clearkey">Apagar chave</button>' : ''}</div></details>`;
    const hidden = steam.signedIn && steam.visible === false ? '<p class="notes-line warn">O seu perfil da Steam esconde os jogos. Para o Nexo ver a sua biblioteca e as conquistas, deixe “Detalhes de jogos” como Público. <button class="link" type="button" data-conn="steam-privacy">Abrir a privacidade da Steam</button></p>' : '';
    const ownedText = (steam.owned ?? null) !== null ? ` ${steam.owned} jogos na conta,` : '';
    const loginInvite = steamLogin ? `<p class="muted">Entre com a Steam para trazer também os jogos da conta que não estão instalados e as suas conquistas, sem precisar de chave.</p><div class="btn-row">${steamLogin}</div>` : '';
    const loginRow = steamLogin ? `<div class="btn-row">${steamLogin}</div>` : '';
    const pickUser = (user) => `<button type="button" data-steam="${escapeHtml(user.steamId)}">${avatar(user.avatar)}<span><b>${escapeHtml(user.personaName)}</b><small>${user.mostRecent ? 'conta atual' : 'outra conta'}</small></span></button>`;
    const localPick = steam.installed && steam.detected?.length ? `<p class="muted">Ou use uma conta que já entrou na Steam deste PC (só o que está neste PC):</p><div class="conn-pick">${steam.detected.map(pickUser).join('')}</div>` : '';
    const steamBody = steam.connected && steam.signedIn
      ? `<div class="conn-who">${avatar(steam.avatar)}<div><b>${escapeHtml(steam.personaName)}</b><small>Entrou com a Steam (login oficial, sem senha no Nexo).${ownedText} tempo de jogo e conquistas pelo servidor do Nexo.</small></div></div>${hidden}
        <div class="btn-row">${steamButton('Entrar de novo na')}<button class="btn sm ghost" type="button" data-conn="steam-off">Sair da Steam</button></div>`
      : steam.connected
        ? `<div class="conn-who">${avatar(steam.avatar)}<div><b>${escapeHtml(steam.personaName)}</b><small>Lida da Steam deste PC, sem senha. Traz tempo de jogo e última vez jogado.</small></div></div>
          ${loginInvite}
          ${keyBlock}<div class="btn-row"><button class="btn sm ghost" type="button" data-conn="steam-off">Desconectar</button></div>`
        : `<p class="muted">Entre com a sua conta: abre a página oficial da Steam no navegador e o Nexo recebe só o ID da conta, nunca a senha. Traz os jogos da conta, o tempo de jogo e as conquistas, mesmo sem a Steam instalada aqui.</p>
          ${loginRow}
          ${localPick}`;
    const { xbox } = c;
    const xboxBody = !xbox.configured ? '<p class="muted">O login com a conta Xbox chega numa próxima versão.</p>'
      : xbox.connected ? `<div class="conn-who">${avatar(xbox.avatar)}<div><b>${escapeHtml(xbox.gamertag)}</b><small>${xbox.titles} títulos no histórico · artes oficiais do Xbox nas capas</small></div></div><div class="btn-row"><button class="btn sm" type="button" data-conn="xbox-in">Atualizar</button><button class="btn sm ghost" type="button" data-conn="xbox-off">Desconectar</button></div>`
      : '<p class="muted">Gamertag, foto e o histórico de jogos com as artes oficiais de cada título. O login acontece no navegador; o Nexo não guarda tokens.</p><button class="btn primary sm" type="button" data-conn="xbox-in">Entrar com a conta Microsoft</button>';
    const d = c.discord;
    const discordBody = !d.configured ? '<p class="muted">O status no Discord não está disponível nesta versão.</p>'
      : `<label class="switch compact"><input type="checkbox" data-discord="enabled" ${d.enabled ? 'checked' : ''}/><i></i><span>Mostrar no meu perfil do Discord</span></label>
        <label class="switch compact"><input type="checkbox" data-discord="showGame" ${d.showGame ? 'checked' : ''} ${d.enabled ? '' : 'disabled'}/><i></i><span>O jogo que o Nexo está gravando</span></label>
        <label class="switch compact"><input type="checkbox" data-discord="showNexo" ${d.showNexo ? 'checked' : ''} ${d.enabled ? '' : 'disabled'}/><i></i><span>“Cuidando do PC com o Nexo” quando não houver jogo</span></label>
        <small class="muted">Fala com o Discord aberto no PC; seus amigos veem o status. Nada passa por servidor do Nexo.</small>`;
    grid.innerHTML = `
      <article class="conn-card" data-brand="steam"><header>${mark('steam')}<div><h4>Steam</h4>${brings(['Jogos da conta', 'Tempo de jogo', 'Conquistas'])}</div>${status(steam.connected, steam.connected ? 'conectada' : 'desconectada')}</header>${steamBody}</article>
      <article class="conn-card" data-brand="xbox"><header>${mark('xbox')}<div><h4>Xbox</h4>${brings(['Gamertag', 'Histórico', 'Artes oficiais'])}</div>${status(xbox.connected, xbox.connected ? 'conectada' : xbox.configured ? 'desconectada' : 'não configurada')}</header>${xboxBody}</article>
      <article class="conn-card" data-brand="discord"><header>${mark('discord')}<div><h4>Discord</h4>${brings(['Status no seu perfil'])}</div>${status(d.enabled && d.configured, d.enabled ? 'ligado' : d.configured ? 'desligado' : 'não configurado')}</header>${discordBody}</article>`;
  }
  async function refreshConnections() {
    if (!bridge?.getConnections) { renderConnections(); return; }
    try { connections = await bridge.getConnections(); } catch { connections = null; }
    renderConnections();
  }
  const changed = (value) => { connections = value; renderConnections(); Nexo.emit('connections', value); };
  document.getElementById('conn-grid').addEventListener('click', async (event) => {
    const pick = event.target.closest('[data-steam]');
    const action = event.target.closest('[data-conn]')?.dataset.conn;
    try {
      if (pick) { changed(await bridge.connectSteam(pick.dataset.steam)); showToast('Steam conectada.'); }
      if (action === 'steam-in') {
        const button = event.target.closest('button');
        brandBusy(button, true, 'Esperando a Steam…');
        showToast('Continue no navegador, na página da Steam. O Nexo espera até 5 minutos.');
        try {
          changed(await bridge.signInSteam());
          const s = connections.steam;
          const owned = (s.owned ?? null) !== null ? `, ${s.owned} jogos na conta` : '';
          showToast(s.visible === false ? `Steam conectada: ${s.personaName}. O perfil esconde os jogos; veja o aviso no cartão.` : `Steam conectada: ${s.personaName}${owned}.`);
        } finally { brandBusy(button, false); }
      }
      if (action === 'steam-privacy') bridge.openLink('steamprivacy');
      if (action === 'steam-off') changed(await bridge.disconnectSteam());
      if (action === 'steam-keypage') bridge.openLink('steamkey');
      if (action === 'steam-clearkey') changed(await bridge.setSteamKey(''));
      if (action === 'steam-key') {
        const input = document.getElementById('steam-key');
        const button = event.target.closest('button');
        setButtonBusy(button, true, 'Conferindo…');
        try { changed(await bridge.setSteamKey(input.value)); showToast(`Chave aceita: ${connections.steam.owned ?? 0} jogos na conta.`); }
        finally { setButtonBusy(button, false); }
      }
      if (action === 'xbox-in') { showToast('Continue no navegador. O Nexo espera até 5 minutos.'); changed(await bridge.signInXbox()); showToast(`Xbox conectado: ${connections.xbox.gamertag}.`); }
      if (action === 'xbox-off') changed(await bridge.signOutXbox());
    } catch (error) { showToast(error.message || 'Não foi possível concluir.'); if (/perfil|privad|público|lista/i.test(error.message || '')) bridge.openLink('steamprivacy'); }
  });
  document.getElementById('conn-grid').addEventListener('change', async (event) => {
    const key = event.target.dataset.discord;
    if (!key) return;
    try { changed(await bridge.setDiscord({ [key]: event.target.checked })); }
    catch (error) { event.target.checked = !event.target.checked; showToast(error.message || 'O Discord não respondeu.'); refreshConnections(); }
  });
  document.getElementById('integrations-import').addEventListener('click', async () => { try { changed(await bridge.importIntegrations()); } catch (error) { showToast(error.message); } });
  Nexo.openConnections = () => { Nexo.go('settings'); requestAnimationFrame(() => document.getElementById('connections-sheet').scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  Nexo.on('view', (view) => { if (view === 'settings') refreshConnections(); });
  refresh();
})();
