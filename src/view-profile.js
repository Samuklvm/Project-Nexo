/* Perfil de uso: Jogos, Trabalho e criação ou Uso geral. Escolha do usuário, trocável a qualquer momento. */
(function () {
  const saved = readJSON(Nexo.keys.profile, null);
  Nexo.profile = { id: NexoProfiles.isValid(saved) ? saved : null };
  Nexo.profileData = () => NexoProfiles.get(Nexo.profile.id || NexoProfiles.DEFAULT);

  const cardsHtml = (selected) => NexoProfiles.list().map((profile) => `<button class="pcard" type="button" role="radio" aria-checked="${profile.id === selected}" data-id="${profile.id}"><strong>${escapeHtml(profile.nome)}</strong><span>${escapeHtml(profile.resumo)}</span><small>${escapeHtml(profile.detalhe)}</small></button>`).join('');

  function render() {
    const data = Nexo.profileData();
    setText('hero-profile', `Perfil: ${data.nome}`);
    setText('sess-profile-chip', `Perfil: ${data.nome}`);
    setText('power-tip', data.dicas.energia);
    const cards = document.getElementById('profile-cards');
    if (cards) cards.innerHTML = cardsHtml(Nexo.profile.id || NexoProfiles.DEFAULT);
  }

  Nexo.setProfile = function setProfile(id) {
    if (!NexoProfiles.isValid(id)) return false;
    Nexo.profile.id = id;
    if (!writeJSON(Nexo.keys.profile, id)) showToast('Não foi possível guardar o perfil neste computador.');
    render();
    Nexo.emit('profile', id);
    Nexo.emit('learned'); // recalcula índice, observações e análise com os novos pesos
    return true;
  };

  /** Pergunta o perfil de uso (Jogos, Trabalho e criação ou Uso geral); na primeira vez, "geral" fica se a pessoa pular. */
  Nexo.chooseProfile = async function chooseProfile({ first = false } = {}) {
    let selected = Nexo.profile.id || NexoProfiles.DEFAULT;
    const dialog = Nexo.dialog({
      title: first ? 'Como você usa o seu PC?' : 'Perfil de uso', wide: true, dismissible: !first,
      html: `<p>${first ? 'Escolha o perfil que mais combina com você. Ele muda só a ênfase do Nexo e pode ser trocado em Ajustes.' : 'O perfil muda o peso de cada fator no Índice Nexo, a ordem das observações e o que as sessões destacam.'}</p><div class="pcards" id="dialog-cards">${cardsHtml(selected)}</div>`,
      actions: [{ id: 'later', label: first ? 'Usar o geral por enquanto' : 'Cancelar' }, { id: 'save', label: 'Usar este perfil', tone: 'primary' }]
    });
    document.getElementById('dialog-cards').addEventListener('click', (event) => {
      const card = event.target.closest('[data-id]');
      if (!card) return;
      selected = card.dataset.id;
      $$('#dialog-cards .pcard').forEach((element) => element.setAttribute('aria-checked', String(element === card)));
    });
    const answer = await dialog.done;
    if (answer === 'save') Nexo.setProfile(selected);
    else if (first && !Nexo.profile.id) Nexo.setProfile(NexoProfiles.DEFAULT);
  };

  document.getElementById('profile-cards')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-id]');
    if (card && Nexo.setProfile(card.dataset.id)) showToast(`Perfil: ${NexoProfiles.get(card.dataset.id).nome}.`);
  });
  document.getElementById('hero-profile')?.addEventListener('click', () => Nexo.chooseProfile());
  document.getElementById('sess-profile-chip')?.addEventListener('click', () => Nexo.chooseProfile());
  render();
  if (!Nexo.profile.id) setTimeout(() => Nexo.chooseProfile({ first: true }), 1400);
})();
