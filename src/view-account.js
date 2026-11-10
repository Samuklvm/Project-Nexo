/* Conta Google (opcional) e preferências de segundo plano (bandeja, sessão automática, início com o Windows, capas). */
(function () {
  const bridge = desktopBridge;
  let account = null;
  let packaged = true; // até o processo principal responder, esconde as opções de desenvolvedor

  function avatarHtml(url) { return url ? `<img src="${escapeHtml(url)}" alt="" />` : '<svg><use href="#i-user"/></svg>'; }

  function render() {
    const profile = account?.profile;
    document.getElementById('account-avatar').innerHTML = avatarHtml(account?.avatar);
    document.getElementById('account-avatar-lg').innerHTML = avatarHtml(account?.avatar);
    setText('account-chip-label', profile ? profile.name.split(' ')[0] : 'Entrar');
    document.getElementById('account-chip').classList.toggle('signed', Boolean(profile));
    setText('account-name', profile ? profile.name : 'Conta');
    setText('account-detail', profile ? `${profile.email} · conectado em ${new Date(profile.signedInAt).toLocaleDateString('pt-BR')}` : account?.configured ? 'Entre com a sua conta Google para ter o seu perfil no Nexo.' : packaged ? 'Login com Google indisponível nesta instalação.' : 'O login com Google ainda não foi configurado nesta build.');
    const actions = document.getElementById('account-actions');
    actions.innerHTML = profile ? '<button class="btn sm" type="button" id="account-out">Sair da conta</button>'
      : account?.configured ? '<button class="btn primary" type="button" id="account-in">Entrar com o Google</button>'
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
    setButtonBusy(button, true, 'Abrindo o navegador…');
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
  const avatar = (url) => `<span class="avatar md">${url ? `<img src="${escapeHtml(url)}" alt="" />` : '<svg><use href="#i-user"/></svg>'}</span>`;
  const status = (on, label) => `<span class="conn-status${on ? ' on' : ''}"><i></i>${escapeHtml(label)}</span>`;
  function renderConnections() {
    const c = connections;
    const grid = document.getElementById('conn-grid');
    if (!c) { grid.innerHTML = '<p class="muted">Disponível no aplicativo desktop.</p>'; return; }
    const { steam } = c;
    // "Entrar com a Steam": login oficial da Steam no navegador; jogos da conta e conquistas vêm pelo servidor do Nexo.
    const steamLogin = steam.loginAvailable !== false ? `<button class="btn primary sm steam-in" type="button" data-conn="steam-in"><svg><use href="#i-game"/></svg>Entrar com a Steam</button>` : '';
    const keyBlock = `<details class="steam-key"${steam.hasKey ? ' open' : ''}><summary>Usar a minha própria chave da Steam Web API (opcional)</summary>
        <label class="field"><span>Só precisa dela se não quiser entrar com a Steam: ela traz os jogos da conta que não estão instalados.</span><div class="key-row"><input id="steam-key" type="password" placeholder="${steam.hasKey ? 'Chave salva (cifrada)' : '32 caracteres'}" autocomplete="off" spellcheck="false" /><button class="btn sm" type="button" data-conn="steam-key">${steam.hasKey ? 'Trocar' : 'Salvar'}</button></div></label>
        <div class="btn-row"><button class="link" type="button" data-conn="steam-keypage">Onde pego a minha chave?</button>${steam.hasKey ? '<button class="link" type="button" data-conn="steam-clearkey">Apagar chave</button>' : ''}</div></details>`;
    const hidden = steam.signedIn && steam.visible === false ? '<p class="notes-line warn">O seu perfil da Steam esconde os jogos. Para o Nexo ver a sua biblioteca e as conquistas, deixe “Detalhes de jogos” como Público. <button class="link" type="button" data-conn="steam-privacy">Abrir a privacidade da Steam</button></p>' : '';
    const steamBody = steam.connected && steam.signedIn
      ? `<div class="conn-who">${avatar(steam.avatar)}<div><b>${escapeHtml(steam.personaName)}</b><small>Entrou com a Steam (login oficial, sem senha no Nexo).${(steam.owned ?? null) !== null ? ` ${steam.owned} jogos na conta,` : ''} tempo de jogo e conquistas pelo servidor do Nexo.</small></div></div>${hidden}
        <div class="btn-row"><button class="btn sm" type="button" data-conn="steam-in">Entrar de novo</button><button class="btn sm ghost" type="button" data-conn="steam-off">Sair da Steam</button></div>`
      : steam.connected
        ? `<div class="conn-who">${avatar(steam.avatar)}<div><b>${escapeHtml(steam.personaName)}</b><small>Lida da Steam deste PC, sem senha. Traz tempo de jogo e última vez jogado.</small></div></div>
          ${steamLogin ? `<p class="muted">Entre com a Steam para trazer também os jogos da conta que não estão instalados e as suas conquistas, sem precisar de chave.</p><div class="btn-row">${steamLogin}</div>` : ''}
          ${keyBlock}<div class="btn-row"><button class="btn sm ghost" type="button" data-conn="steam-off">Desconectar</button></div>`
        : `<p class="muted">Entre com a sua conta: abre a página oficial da Steam no navegador e o Nexo recebe só o ID da conta, nunca a senha. Traz os jogos da conta, o tempo de jogo e as conquistas, mesmo sem a Steam instalada aqui.</p>
          ${steamLogin ? `<div class="btn-row">${steamLogin}</div>` : ''}
          ${steam.installed && steam.detected.length ? `<p class="muted">Ou use uma conta que já entrou na Steam deste PC (só o que está neste PC):</p><div class="conn-pick">${steam.detected.map((user) => `<button type="button" data-steam="${escapeHtml(user.steamId)}">${avatar(user.avatar)}<span><b>${escapeHtml(user.personaName)}</b><small>${user.mostRecent ? 'conta atual' : 'outra conta'}</small></span></button>`).join('')}</div>` : ''}`;
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
      <article class="conn-card" data-brand="steam"><header><h4>Steam</h4>${status(steam.connected, steam.connected ? 'conectada' : 'desconectada')}</header>${steamBody}</article>
      <article class="conn-card" data-brand="xbox"><header><h4>Xbox</h4>${status(xbox.connected, xbox.connected ? 'conectada' : xbox.configured ? 'desconectada' : 'não configurada')}</header>${xboxBody}</article>
      <article class="conn-card" data-brand="discord"><header><h4>Discord</h4>${status(d.enabled && d.configured, d.enabled ? 'ligado' : d.configured ? 'desligado' : 'não configurado')}</header>${discordBody}</article>`;
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
        setButtonBusy(button, true, 'Esperando a Steam…');
        showToast('Continue no navegador, na página da Steam. O Nexo espera até 5 minutos.');
        try {
          changed(await bridge.signInSteam());
          const s = connections.steam;
          showToast(s.visible === false ? `Steam conectada: ${s.personaName}. O perfil esconde os jogos; veja o aviso no cartão.` : `Steam conectada: ${s.personaName}${(s.owned ?? null) !== null ? `, ${s.owned} jogos na conta` : ''}.`);
        } finally { setButtonBusy(button, false); }
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
