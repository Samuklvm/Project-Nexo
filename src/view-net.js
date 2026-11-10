/*
 * Diagnóstico de rede (Manutenção): mede, mostra o que achou e aplica a correção que a pessoa escolher.
 * Toda correção que muda o sistema pede confirmação e vai para o Diário; as que têm volta são revertidas por lá.
 */
(function () {
  const bridge = window.desktopBridge;
  const box = document.getElementById('net-result');
  const run = document.getElementById('net-run');
  if (!box || !run) return;
  let last = null;

  const ICON = { ok: '✓', aviso: '!', problema: '✕' };
  const FIX_TEXT = {
    'dns-publico': (fix) => `Troca o DNS desta placa de rede pelo ${fix.provider === 'google' ? 'do Google (8.8.8.8)' : 'da Cloudflare (1.1.1.1)'}. Pede administrador. Dá para voltar pelo Diário.`,
    'preferir-ipv4': () => 'Faz o Windows tentar o IPv4 antes do IPv6 (ajuste documentado pela Microsoft). Pede administrador e vale depois de reiniciar. Dá para voltar pelo Diário.',
    'desligar-proxy': () => 'Desliga o proxy do seu usuário no Windows. Dá para voltar pelo Diário.',
    'desligar-autodetect': () => 'Desliga "Detectar configurações automaticamente" do proxy. Dá para voltar pelo Diário.',
    'abrir-proxy': () => 'Abre Configurações > Rede > Proxy do Windows.',
    'limpar-dns': () => 'Apaga as respostas de DNS guardadas no PC; os sites voltam a ser consultados na hora. Não muda nenhuma configuração.',
    'reparo-profundo': () => 'Último recurso: volta o Winsock e o TCP/IP ao padrão do Windows e limpa o cache de DNS. Pede administrador e reiniciar. Não tem volta automática: programas de VPN podem precisar ser reinstalados.'
  };

  function render(result) {
    last = result;
    if (!result) { box.innerHTML = '<p class="muted">Leva uns 15 segundos e não muda nada no PC.</p>'; return; }
    const main = result.fixes.filter((fix) => !fix.lastResort && result.checks.some((check) => check.fix === fix.id));
    const extra = result.fixes.filter((fix) => fix.lastResort || !result.checks.some((check) => check.fix === fix.id));
    const checkItem = (check) => `<li data-level="${check.level}"><span class="net-dot" aria-hidden="true">${ICON[check.level] || '•'}</span><div><b>${escapeHtml(check.title)}</b><p>${escapeHtml(check.detail)}</p></div></li>`;
    const mainFixes = main.length ? `<div class="net-fixes"><h4>Correções sugeridas</h4>${main.map((fix) => fixRow(fix, true)).join('')}</div>` : '';
    box.innerHTML = `<p class="net-summary ${result.problems ? 'bad' : result.warnings ? 'warn' : 'good'}">${escapeHtml(result.summary)} <small>Medido ${escapeHtml(new Date(result.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}.</small></p>
      <ul class="net-checks">${result.checks.map(checkItem).join('')}</ul>
      ${mainFixes}
      <details class="net-more"><summary>Outras ferramentas de rede</summary>${extra.map((fix) => fixRow(fix, false)).join('')}</details>`;
  }
  const fixRow = (fix, primary) => `<div class="net-fix${fix.lastResort ? ' danger' : ''}"><div><b>${escapeHtml(fix.label)}</b><p class="muted">${escapeHtml((FIX_TEXT[fix.id] || (() => ''))(fix))}</p></div>
    <button class="btn sm${primary ? ' primary' : fix.lastResort ? ' danger' : ''}" type="button" data-net-fix="${escapeHtml(fix.id)}">${fix.id === 'abrir-proxy' ? 'Abrir' : fix.lastResort ? 'Reparar' : 'Corrigir'}</button></div>`;

  async function diagnose() {
    if (!bridge?.diagnoseNetwork) { showToast('Disponível no aplicativo desktop.'); return; }
    setButtonBusy(run, true, 'Medindo a rede…');
    box.innerHTML = '<div class="net-wait"><span class="spinner" aria-hidden="true"></span><p>Medindo o DNS, o IPv6, o proxy e um site de verdade. Leva uns 15 segundos.</p></div>';
    try {
      render(await bridge.diagnoseNetwork());
      recordActivity('Diagnóstico de rede', last.summary);
    } catch (error) { box.innerHTML = `<p class="notes-line">${escapeHtml(error.message || 'Não deu para medir a rede agora.')}</p>`; }
    finally { setButtonBusy(run, false); }
  }

  const JOURNAL = {
    'dns-publico': { actionId: 'net-dns', title: (r) => `DNS trocado para ${r.after.label}`, risk: 'baixo' },
    'preferir-ipv4': { actionId: 'net-ipv4-prefer', title: () => 'Preferir IPv4 em vez de IPv6', risk: 'baixo' },
    'desligar-proxy': { actionId: 'net-proxy-off', title: () => 'Proxy do Windows desligado', risk: 'baixo' },
    'desligar-autodetect': { actionId: 'net-autodetect-off', title: () => 'Detecção automática de proxy desligada', risk: 'baixo' }
  };

  async function applyFix(id, button) {
    const fix = last?.fixes.find((item) => item.id === id);
    if (!fix) return;
    if (id !== 'abrir-proxy' && id !== 'limpar-dns') {
      const ok = await Nexo.confirm({ title: fix.label, body: (FIX_TEXT[id] || (() => ''))(fix), confirmLabel: fix.lastResort ? 'Reparar e reiniciar depois' : 'Corrigir', tone: fix.lastResort ? 'danger' : undefined });
      if (!ok) return;
    }
    setButtonBusy(button, true, 'Aplicando…');
    try {
      const result = await bridge.fixNetwork({ id, provider: fix.provider });
      if (result?.declined) { showToast('O Windows pediu permissão e ela não foi dada. Nada mudou.'); return; }
      if (!result?.ok) { showToast(result?.note || 'Não deu certo.'); return; }
      const entry = JOURNAL[id];
      if (entry) Nexo.journal.record({ actionId: entry.actionId, title: entry.title(result), risk: entry.risk, reversible: true, before: result.before, after: result.after, detail: `Pelo diagnóstico de rede.${result.restart ? ' Vale depois de reiniciar.' : ''}` });
      if (id === 'reparo-profundo') Nexo.journal.record({ actionId: 'net-reset', title: 'Reparo profundo da rede (Winsock e TCP/IP)', risk: 'moderado', reversible: false, detail: 'Vale depois de reiniciar o PC.' });
      if (entry || id === 'reparo-profundo') Nexo.emit('journal');
      recordActivity('Correção de rede', fix.label);
      showToast(result.restart ? `${fix.label}: feito. Reinicie o PC para valer.` : id === 'abrir-proxy' ? 'Abrindo as configurações de proxy.' : `${fix.label}: feito.${entry ? ' Dá para desfazer pelo Diário, em Atividade.' : ''}`);
      if (!result.restart && id !== 'abrir-proxy') setTimeout(diagnose, 600);
    } catch (error) { showToast(error.message || 'Não deu certo.'); }
    finally { setButtonBusy(button, false); }
  }

  /** Reversão pelo Diário (chamada por Nexo.revertJournal). */
  const REVERT = { 'net-dns': 'dns-voltar', 'net-ipv4-prefer': 'ipv4-voltar', 'net-proxy-off': 'proxy-voltar', 'net-autodetect-off': 'autodetect-voltar' };
  Nexo.revertNetwork = async function revertNetwork(entry) {
    const id = REVERT[entry.actionId];
    if (!id) return false;
    const result = await bridge.fixNetwork({ id, before: entry.before });
    if (result?.declined) { showToast('O Windows pediu permissão e ela não foi dada. Nada mudou.'); return false; }
    if (!result?.ok) throw new Error(result?.note || 'Não deu para reverter.');
    Nexo.journal.markReverted(entry.id, result.restart ? 'valor anterior de volta (vale depois de reiniciar)' : 'valor anterior de volta');
    showToast(`${entry.title}: desfeito.${result.restart ? ' Reinicie o PC para valer.' : ''}`);
    Nexo.emit('journal');
    return true;
  };

  run.addEventListener('click', diagnose);
  box.addEventListener('click', (event) => {
    const button = event.target.closest('[data-net-fix]');
    if (button) applyFix(button.dataset.netFix, button);
  });
  Nexo.diagnoseNetwork = () => { Nexo.go('maintenance'); setTimeout(() => { document.getElementById('net-doctor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); diagnose(); }, 250); };
  Nexo.netLast = () => last;
  render(null);
})();
