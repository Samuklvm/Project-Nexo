/*
 * Nexo na nuvem, pela interface: sincronização entre PCs (com o login do Google), telemetria diária anônima e
 * relatórios de erro. Tudo desligado por padrão; a pessoa liga cada parte. Trazer dados de outro PC é sempre uma
 * escolha explícita: qual PC e quais partes.
 */
(function () {
  const bridge = desktopBridge;
  if (!bridge?.cloudStatus) return;
  const body = () => document.getElementById('cloud-sync-body');
  const POLICY = 'O Nexo tem um servidor que serve para a sincronização de contas, a coleta de erros e a telemetria, que é opcional e vem desativada por padrão. Para que o app possa melhorar cada vez mais, eu peço que você deixe a opção ligada. Ela gera a telemetria apenas uma vez por dia, então é inofensiva, e não puxa nada pessoal: só o que ajuda a entender como o app se comporta em outras máquinas, para podermos melhorar o Nexo.';
  const view = { status: null, account: null, devices: null, busy: false };
  const when = (at) => (at ? new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--');
  const size = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  /* ---------- O que viaja entre PCs ---------- */
  const lsGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const SECTIONS = {
    preferencias: {
      // A limpeza automática não viaja: ela apaga arquivos, então cada PC confirma a sua.
      label: 'Preferências', hint: 'efeitos visuais, cor de destaque, céu vivo, velocidade das leituras, bandeja, sessões automáticas e capas online',
      collect: () => ({ effects: lsGet(Nexo.keys.effects), liveRate: lsGet('nexo-live-rate'), accent: lsGet('nexo-accent'), skyHour: lsGet('nexo-sky-hour'), sky: Nexo.sky?.prefs?.() || null }),
      apply: (data) => {
        if (['lite', 'full'].includes(data?.effects)) Nexo.setEffects?.(data.effects);
        if (['realtime', 'balanced', 'eco'].includes(data?.liveRate)) Nexo.setLiveRate?.(data.liveRate);
        if (typeof data?.accent === 'string' && Nexo.accents?.some((item) => item.id === data.accent)) Nexo.setAccent?.(data.accent);
        if (['on', 'off'].includes(data?.skyHour)) Nexo.setSkyHour?.(data.skyHour === 'on');
        if (data?.sky && typeof data.sky === 'object') {
          const patch = {};
          for (const key of ['fireflies', 'twinkle', 'meteors', 'showers', 'cursor']) if (typeof data.sky[key] === 'boolean') patch[key] = data.sky[key];
          if (['pouco', 'normal', 'muito'].includes(data.sky.density)) patch.density = data.sky.density;
          if (Object.keys(patch).length) { Nexo.sky?.set?.(patch); Nexo.renderSkySettings?.(); }
        }
      }
    },
    perfil: {
      label: 'Perfil de uso', hint: 'Jogos, Trabalho ou Geral',
      collect: () => readJSON(Nexo.keys.profile, null),
      apply: (data) => { if (typeof data === 'string' && window.NexoProfiles?.isValid?.(data)) Nexo.setProfile?.(data); }
    },
    sessoes: {
      label: 'Sessões de jogo gravadas', hint: 'relatórios de FPS e gargalos (juntam com as deste PC)',
      collect: () => readJSON(Nexo.keys.sessions, []),
      apply: (data) => {
        if (!Array.isArray(data)) return;
        const mine = readJSON(Nexo.keys.sessions, []);
        const byId = new Map((Array.isArray(mine) ? mine : []).map((item) => [item.id, item]));
        for (const item of data) if (item && typeof item.id === 'string' && !byId.has(item.id)) byId.set(item.id, item);
        writeJSON(Nexo.keys.sessions, [...byId.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 10));
        Nexo.emit('learned');
      }
    },
    atividade: {
      label: 'Histórico de atividades', hint: 'o que o Nexo fez (juntam com as deste PC)',
      collect: () => readJSON(Nexo.keys.activity, []),
      apply: (data) => {
        if (!Array.isArray(data)) return;
        const mine = readJSON(Nexo.keys.activity, []);
        const seen = new Set();
        const merged = [...(Array.isArray(mine) ? mine : []), ...data].filter((item) => item && typeof item.title === 'string' && Number.isFinite(item.timestamp))
          .filter((item) => { const key = `${item.timestamp}|${item.title}`; if (seen.has(key)) return false; seen.add(key); return true; })
          .sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
        writeJSON(Nexo.keys.activity, merged);
        window.renderActivity?.(merged);
      }
    }
  };
  /** A cópia precisa caber em 1 MB no servidor: se passar, as sessões mais antigas ficam de fora (as daqui não mudam). */
  const LIMIT = 900 * 1024;
  function collectAll() {
    const out = Object.fromEntries(Object.entries(SECTIONS).map(([name, section]) => [name, section.collect()]));
    const bytes = () => new TextEncoder().encode(JSON.stringify(out)).length;
    if (Array.isArray(out.sessoes)) while (out.sessoes.length && bytes() > LIMIT) out.sessoes = out.sessoes.slice(0, -1);
    return out;
  }

  /*
   * ---------- Telemetria (src/telemetry.js monta o resumo) ----------
   * Cada dia fechado sai uma vez; o dia de HOJE sai como parcial (no máximo a cada 3 h, o processo principal controla),
   * para quem usa o app um dia só também aparecer. Roda ao abrir e a cada 30 min (o app pode ficar dias aberto na
   * bandeja). Falha não some mais em silêncio: vai para o registro de erros e para a linha de estado em Privacidade.
   */
  let sending = null;
  function sendTelemetry() {
    if (sending) return sending;
    sending = (async () => {
      const t = Nexo.telemetry;
      if (!t) return;
      if (!view.status) { try { view.status = await bridge.cloudStatus(); } catch { return; } }
      if (!view.status?.configured) return;
      for (const day of t.pending()) {
        // Desligada: o dia fica de fora de vez (o que foi juntado sem a sua permissão nunca sai depois).
        // Mais de 6 dias: o servidor já não aceita.
        if (!view.status?.telemetry || day < t.dayOf(Date.now() - 6 * 86400000)) { t.markSent(day); continue; }
        const data = t.summary(day);
        if (!data) { t.markSent(day); continue; }
        let result;
        try { result = await bridge.cloudTelemetry({ day, data }); } catch { return; } // registrado no processo principal
        if (result?.sent || result?.already || result?.old || result?.invalid) t.markSent(day);
        else break;
      }
      if (view.status?.telemetry) {
        const data = t.today?.();
        if (data) await bridge.cloudTelemetry({ day: t.dayOf(), data, partial: true }).catch(() => {});
      }
    })().finally(async () => {
      sending = null;
      try { view.status = await bridge.cloudStatus(); syncToggles(); renderPrivacyStatus(); } catch { /* fica o estado anterior */ }
    });
    return sending;
  }
  setInterval(() => { sendTelemetry(); }, 30 * 60000);

  /** Linha de estado embaixo dos interruptores: último envio e o último problema (para a pessoa e para nós). */
  function renderPrivacyStatus() {
    const s = view.status;
    let line = document.getElementById('cloud-share-status');
    const anchor = document.getElementById('cloud-email-row');
    if (!anchor) return;
    if (!line) { line = document.createElement('p'); line.id = 'cloud-share-status'; line.className = 'muted small cloud-share-status'; line.setAttribute('aria-live', 'polite'); anchor.after(line); }
    if (!s?.configured || (!s.telemetry && !s.errors)) { line.textContent = ''; return; }
    const parts = [];
    if (s.telemetry) parts.push(s.lastTelemetryAt ? `Telemetria enviada pela última vez em ${when(s.lastTelemetryAt)}.` : 'Telemetria ligada: o primeiro resumo sai em alguns minutos.');
    if (s.telemetryProblem) parts.push(`Último problema da telemetria: ${s.telemetryProblem.message}`);
    if (s.errors && s.errorsProblem) parts.push(`Último problema ao mandar erros: ${s.errorsProblem.message}`);
    if (s.saveProblem) parts.push(`Não consegui gravar as escolhas no disco (${s.saveProblem.code}).`);
    line.textContent = parts.join(' ');
  }
  async function pushNow({ quiet = true } = {}) {
    if (!view.status?.connected || !view.status?.sync) return;
    try {
      await bridge.cloudPush(collectAll());
      view.status = await bridge.cloudStatus();
      if (!quiet) showToast('Cópia deste PC enviada.');
      render();
    } catch (error) { if (!quiet) showToast(error.message || 'Não consegui enviar a cópia.'); }
  }

  /* ---------- Tela ---------- */
  function render() {
    const box = body();
    if (!box) return;
    const s = view.status;
    syncToggles();
    if (!s) { box.innerHTML = '<p class="muted">Carregando…</p>'; return; }
    if (!s.configured) { box.innerHTML = '<p class="muted">O servidor do Nexo ainda não está ligado nesta versão. Quando estiver, a sincronização aparece aqui.</p>'; return; }
    if (!view.account?.profile) { box.innerHTML = '<p class="muted">Entre com a sua conta Google (no topo desta página) para sincronizar entre PCs.</p>'; return; }
    if (!s.connected) {
      box.innerHTML = `<p>Conta: <strong>${escapeHtml(view.account.profile.email)}</strong></p>
        <p class="muted">Ao ligar, o Nexo confirma o seu login com o Google e passa a guardar uma cópia criptografada deste PC: ${escapeHtml(Object.values(SECTIONS).map((section) => section.label.toLowerCase()).join(', '))}. Nada de outro PC entra aqui sem você escolher.</p>
        <div class="btn-row"><button class="btn primary" type="button" data-cloud="connect">Ligar a sincronização</button></div>`;
      return;
    }
    const devices = view.devices?.devices || null;
    const others = devices ? devices.filter((device) => !device.current) : [];
    box.innerHTML = `<p>Sincronizando como <strong>${escapeHtml(s.email)}</strong>${s.lastSyncAt ? ` · cópia deste PC enviada em ${when(s.lastSyncAt)}` : ' · ainda sem cópia deste PC'}.</p>
      <div class="btn-row"><button class="btn sm" type="button" data-cloud="push">Enviar a cópia agora</button><button class="btn sm" type="button" data-cloud="devices">Trazer dados de outro PC</button>${s.admin ? '<button class="btn sm primary" type="button" data-cloud="admin">Abrir o painel do criador</button>' : ''}</div>
      ${devices ? (others.length ? `<ul class="cloud-devices">${others.map((device) => `<li><div><strong>${escapeHtml(device.name)}</strong><span class="muted">cópia de ${when(device.updatedAt)} · ${size(device.size)} · Nexo ${escapeHtml(device.appVersion || '?')}</span></div><div class="btn-row"><button class="btn sm primary" type="button" data-pull="${escapeHtml(device.deviceId)}">Trazer dados</button><button class="btn sm ghost" type="button" data-forget="${escapeHtml(device.deviceId)}">Apagar a cópia</button></div></li>`).join('')}</ul>` : '<p class="muted">Nenhum outro PC com cópia nesta conta. Ligue a sincronização no outro PC e ele aparece aqui.</p>') : ''}
      <div class="btn-row cloud-danger"><button class="btn sm ghost" type="button" data-cloud="disconnect">Desligar a sincronização</button><button class="btn sm ghost danger-text" type="button" data-cloud="delete">Apagar meus dados do servidor</button></div>`;
  }

  function syncToggles() {
    const s = view.status;
    const telemetry = document.getElementById('cloud-telemetry');
    const errors = document.getElementById('cloud-errors');
    const email = document.getElementById('cloud-error-email');
    const disabled = !s?.configured;
    if (telemetry) { telemetry.checked = Boolean(s?.telemetry); telemetry.disabled = disabled; }
    if (errors) { errors.checked = Boolean(s?.errors); errors.disabled = disabled; }
    // O e-mail vai com a sincronização ligada (confirmado pelo servidor) OU com a conta Google entrada no app.
    const hasEmail = Boolean(s?.connected || view.account?.profile?.email);
    if (email) { email.checked = Boolean(s?.errorEmail && hasEmail); email.disabled = disabled || !s?.errors || !hasEmail; }
    renderPrivacyStatus();
  }

  async function refresh() {
    try { [view.status, view.account] = await Promise.all([bridge.cloudStatus(), bridge.getAccount?.().catch(() => null)]); } catch { view.status = null; }
    // Um erro ao desenhar não pode impedir o resto (antes impedia o envio da telemetria e a pergunta inicial).
    try { render(); } catch (error) { desktopBridge?.reportError?.({ message: `Privacidade: ${error?.message || error}`, stack: error?.stack, context: { tela: 'settings' } }); }
  }

  async function choosePull(device) {
    const names = device.sections.filter((name) => SECTIONS[name]);
    if (!names.length) { showToast('Essa cópia não tem nada que este Nexo saiba trazer. Atualize o Nexo nos dois PCs.'); return; }
    let picked = [];
    const dialog = Nexo.dialog({
      title: `Trazer dados de ${device.name}?`,
      html: `<p class="muted">Escolha o que trazer. Preferências e perfil substituem os deste PC; sessões e atividades se juntam às daqui. Nada mais muda.</p><div class="cloud-pick">${names.map((name) => `<label class="switch"><input type="checkbox" data-section="${name}" checked /><i></i><span><strong>${escapeHtml(SECTIONS[name].label)}</strong><small>${escapeHtml(SECTIONS[name].hint)}</small></span></label>`).join('')}</div>`,
      actions: [{ id: 'cancel', label: 'Cancelar' }, { id: 'ok', label: 'Trazer o que marquei', tone: 'primary', onClick: () => { picked = [...document.querySelectorAll('.cloud-pick [data-section]')].filter((input) => input.checked).map((input) => input.dataset.section); } }]
    });
    if (await dialog.done !== 'ok' || !picked.length) return;
    try {
      const only = picked.includes('preferencias') ? [...picked, 'preferenciasapp'] : picked;
      const data = await bridge.cloudPull(device.deviceId, only);
      for (const name of picked) { try { SECTIONS[name].apply(data?.sections?.[name]); } catch { /* uma parte ruim não impede as outras */ } }
      recordActivity('Sincronização', `${picked.length} parte(s) trazida(s) de ${device.name}`);
      showToast(`Pronto: ${picked.map((name) => SECTIONS[name].label.toLowerCase()).join(', ')} de ${device.name}.`);
    } catch (error) { showToast(error.message || 'Não consegui trazer os dados.'); }
  }

  async function act(name) {
    if (view.busy) return;
    view.busy = true;
    try {
      if (name === 'connect') {
        const ok = await Nexo.confirm({ title: 'Ligar a sincronização?', body: 'O navegador abre para confirmar o seu login do Google. Depois, o Nexo guarda no servidor uma cópia criptografada deste PC (preferências, perfil, sessões de jogo e atividades). Você pode desligar e apagar tudo quando quiser.', confirmLabel: 'Ligar' });
        if (!ok) return;
        showToast('Confirme o login no navegador…');
        view.status = await bridge.cloudConnect();
        await pushNow({ quiet: true });
        showToast('Sincronização ligada.');
      }
      if (name === 'push') await pushNow({ quiet: false });
      if (name === 'devices') view.devices = await bridge.cloudDevices();
      if (name === 'admin') await bridge.cloudAdmin();
      if (name === 'disconnect') {
        if (!await Nexo.confirm({ title: 'Desligar a sincronização?', body: 'Este PC para de mandar cópias. As cópias que já estão no servidor continuam lá até você apagar.', confirmLabel: 'Desligar' })) return;
        view.status = await bridge.cloudDisconnect();
        view.devices = null;
      }
      if (name === 'delete') {
        if (!await Nexo.confirm({ title: 'Apagar os seus dados do servidor?', body: 'Apaga as cópias de TODOS os seus PCs e a sua conta no servidor do Nexo. Os relatórios de erro que você mandou ficam, mas sem o seu e-mail. Os dados deste PC não mudam.', confirmLabel: 'Apagar tudo', tone: 'danger' })) return;
        view.status = await bridge.cloudDeleteRemote();
        view.devices = null;
        showToast('Seus dados foram apagados do servidor.');
      }
    } catch (error) { showToast(error.message || 'Não deu certo.'); }
    finally { view.busy = false; await refresh(); }
  }

  body()?.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.cloud) act(button.dataset.cloud);
    const device = (view.devices?.devices || []).find((item) => item.deviceId === (button.dataset.pull || button.dataset.forget));
    if (button.dataset.pull && device) choosePull(device);
    if (button.dataset.forget && device) {
      if (!await Nexo.confirm({ title: `Apagar a cópia de ${device.name}?`, body: 'Só a cópia no servidor some. O outro PC volta a mandar uma nova se a sincronização dele estiver ligada.', confirmLabel: 'Apagar' })) return;
      try { await bridge.cloudForget(device.deviceId); view.devices = await bridge.cloudDevices(); render(); } catch (error) { showToast(error.message || 'Não consegui apagar.'); }
    }
  });

  async function setOption(patch, message) {
    try { view.status = await bridge.cloudSet({ ...patch, asked: true }); showToast(message); } catch (error) { showToast(error.message || 'Não consegui salvar.'); }
    render();
    if (patch.telemetry) sendTelemetry();
  }
  document.getElementById('cloud-telemetry')?.addEventListener('change', (event) => setOption({ telemetry: event.target.checked }, event.target.checked ? 'Obrigado! A telemetria vai uma vez por dia, sem nada pessoal.' : 'Telemetria desligada.'));
  document.getElementById('cloud-errors')?.addEventListener('change', (event) => setOption({ errors: event.target.checked }, event.target.checked ? 'Relatórios de erro ligados. Só os erros novos vão.' : 'Relatórios de erro desligados.'));
  document.getElementById('cloud-error-email')?.addEventListener('change', (event) => setOption({ errorEmail: event.target.checked }, event.target.checked ? 'O seu e-mail vai junto com os erros.' : 'Os erros vão sem o seu e-mail.'));

  /** Primeira vez: pergunta uma vez só, com tudo desligado como resposta padrão. */
  async function askOnce(tries = 0) {
    if (!view.status?.configured || view.status.asked) return;
    // Não passa por cima de outra janela (escolha do perfil, tour, confirmações): espera ela fechar.
    if (document.getElementById('modal-root')?.childElementCount || document.hidden) { if (tries < 40) setTimeout(() => askOnce(tries + 1), 15000); return; }
    const dialog = Nexo.dialog({ title: 'Ajudar a melhorar o Nexo?', html: `<p>${escapeHtml(POLICY)}</p><p class="muted">Ligar aqui liga as duas coisas: a telemetria (uma vez por dia, anônima) e os relatórios de erro (sem o seu nome de usuário nem as suas pastas). Dá para mudar cada uma quando quiser em Ajustes &gt; Privacidade e dados.</p>`,
      actions: [{ id: 'no', label: 'Agora não' }, { id: 'yes', label: 'Ligar telemetria e erros', tone: 'primary' }] });
    const choice = (await dialog.done) === 'yes';
    view.status = await bridge.cloudSet({ asked: true, telemetry: choice, errors: choice }).catch(() => view.status);
    render();
    if (choice) sendTelemetry();
  }

  Nexo.on('view', (name) => { if (name === 'settings') refresh(); });
  Nexo.on('account', (account) => { view.account = account; bridge.cloudStatus().then((status) => { view.status = status; render(); }).catch(() => render()); });
  Nexo.cloudPolicy = POLICY;
  refresh().finally(() => {
    setTimeout(askOnce, 20000);
    setTimeout(() => { sendTelemetry(); }, 60000);
    setTimeout(() => pushNow(), 90000);
  });
  // De hora em hora: o dia (em UTC) que acabou sai logo, mesmo com o Nexo aberto o tempo todo na bandeja.
  setInterval(sendTelemetry, 3600 * 1000);
  setInterval(() => pushNow(), 30 * 60 * 1000);
})();
