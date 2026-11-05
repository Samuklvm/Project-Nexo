/* Conta Google (opcional) e preferências de segundo plano (bandeja, sessão automática, início com o Windows, capas). */
(function () {
  const bridge = desktopBridge;
  let account = null;

  function avatarHtml(url) { return url ? `<img src="${escapeHtml(url)}" alt="" />` : '<svg><use href="#i-user"/></svg>'; }

  function render() {
    const profile = account?.profile;
    document.getElementById('account-avatar').innerHTML = avatarHtml(account?.avatar);
    document.getElementById('account-avatar-lg').innerHTML = avatarHtml(account?.avatar);
    setText('account-chip-label', profile ? profile.name.split(' ')[0] : 'Entrar');
    document.getElementById('account-chip').classList.toggle('signed', Boolean(profile));
    setText('account-name', profile ? profile.name : 'Conta');
    setText('account-detail', profile ? `${profile.email} · conectado em ${new Date(profile.signedInAt).toLocaleDateString('pt-BR')}` : account?.configured ? 'Entre com a sua conta Google para ter o seu perfil no Nexo.' : 'O login com Google ainda não foi configurado nesta build.');
    const actions = document.getElementById('account-actions');
    actions.innerHTML = profile ? '<button class="btn sm" type="button" id="account-out">Sair da conta</button>'
      : account?.configured ? '<button class="btn primary" type="button" id="account-in">Entrar com o Google</button>'
      : '<button class="btn sm" type="button" id="account-import">Importar credenciais (desenvolvedor)</button>';
    setText('account-note', profile ? `Guardado só neste PC${account.encrypted ? ', cifrado pelo Windows' : ''}: nome, e-mail e foto. O Nexo não guarda senhas nem tokens do Google e não envia nada ao criador. Sincronização entre PCs ainda não existe.`
      : account?.configured ? 'Opcional. O login acontece no seu navegador; o Nexo guarda só nome, e-mail e foto neste PC (cifrados pelo Windows) e não guarda senhas nem tokens do Google.'
      : 'Para ativar: crie um cliente OAuth “App para computador” no Google Cloud e importe o JSON aqui, ou coloque-o em config/google-oauth.json na build (veja docs/LOGIN_GOOGLE.md).');
  }

  async function refresh() {
    if (!bridge?.getAccount) return;
    try { account = await bridge.getAccount(); } catch { account = null; }
    render();
  }

  async function signIn() {
    const button = document.getElementById('account-in');
    setButtonBusy(button, true, 'Abrindo o navegador…');
    showToast('Continue no navegador. O Nexo espera até 5 minutos.');
    try { account = await bridge.signIn(); render(); showToast(`Olá, ${account.profile.name.split(' ')[0]}!`); recordActivity('Conta Google conectada', account.profile.email); }
    catch (error) { showToast(error.message || 'O login não foi concluído.'); render(); }
  }

  document.getElementById('account-actions').addEventListener('click', async (event) => {
    if (event.target.closest('#account-in')) signIn();
    if (event.target.closest('#account-out')) {
      if (!await Nexo.confirm({ title: 'Sair da conta?', body: 'O nome, o e-mail e a foto guardados neste PC serão apagados. Nada mais muda.', confirmLabel: 'Sair' })) return;
      account = await bridge.signOut(); render(); showToast('Você saiu da conta.');
    }
    if (event.target.closest('#account-import')) { try { account = await bridge.importOAuthConfig(); render(); if (account.configured) showToast('Credenciais importadas. Agora é só entrar.'); } catch (error) { showToast(error.message); } }
  });
  document.getElementById('account-chip').addEventListener('click', () => { Nexo.go('settings'); document.getElementById('account-sheet').scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  /* ---------- Segundo plano ---------- */
  const TOGGLES = { 'set-tray': 'tray', 'set-auto': 'autoSession', 'set-login': 'openAtLogin', 'set-covers': 'onlineCovers' };
  function applySettings(settings) {
    for (const [id, key] of Object.entries(TOGGLES)) document.getElementById(id).checked = Boolean(settings[key]);
    document.getElementById('set-login').disabled = !settings.packaged;
  }
  for (const [id, key] of Object.entries(TOGGLES)) {
    document.getElementById(id).addEventListener('change', async (event) => {
      try { applySettings(await bridge.setSettings({ [key]: event.target.checked })); }
      catch (error) { event.target.checked = !event.target.checked; showToast(error.message || 'Não foi possível salvar.'); }
    });
  }
  bridge?.onSettingsChanged?.((settings) => applySettings({ ...settings, packaged: !document.getElementById('set-login').disabled }));
  Nexo.on('view', (view) => { if (view === 'settings') { refresh(); bridge?.getSettings?.().then(applySettings).catch(() => {}); } });
  refresh();
})();
