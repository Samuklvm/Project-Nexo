/*
 * "Otimizar este PC": depois da análise profunda, cruza o que ela entendeu (peças, eventos, o que pesou por trás,
 * o teste de carga) com o Raio-X, a lista do início, as placas de rede e o jogo escolhido, monta um plano feito para
 * esta máquina e executa sozinho, medindo antes e depois e desfazendo o que piorar.
 *
 * Métodos de cada passo:
 *  - aplicar:   higiene com efeito conhecido (gravação em segundo plano, launchers no início, P2P das atualizações…);
 *  - medir:     A/B pareado do laboratório (o plano de energia muda sem administrador e vale na hora, então dá para
 *               alternar e medir de verdade);
 *  - reiniciar: vale depois de reiniciar; o Nexo confere depois do reinício contra a medição de antes;
 *  - testar:    controversos que precisam de reinício vão para o teste com reinício (ABBA), com um botão;
 *  - manual:    só a pessoa pode fazer (BIOS, cabo, posição do roteador).
 *
 * Nada aqui desliga proteção do Windows, e programas de segurança, áudio e entrada nunca saem do início.
 * Funções puras: o processo principal lê o PC e executa as mudanças (electron/optimizer-system.cjs).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoOptimizer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const round1 = (value) => Math.round(value * 10) / 10;
  const median = (list) => {
    const values = list.filter(finite).sort((a, b) => a - b);
    if (!values.length) return null;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  };
  const RISK_RANK = { baixo: 1, moderado: 2, alto: 3 };
  const CONSENT_PHRASE = 'ENTENDO O RISCO';

  /** Seções do plano, na ordem em que aparecem (e a estrela da constelação que cada uma acende). */
  const CATEGORIES = [
    { id: 'jogo', label: 'O seu jogo', node: 'gpu', icon: 'i-game' },
    { id: 'rede', label: 'Ping e rede', node: 'network', icon: 'i-net' },
    { id: 'energia', label: 'Energia e processador', node: 'cpu', icon: 'i-bolt' },
    { id: 'inicio', label: 'Início com o Windows', node: 'windows', icon: 'i-play' },
    { id: 'windows', label: 'Windows mais leve', node: 'windows', icon: 'i-win' },
    { id: 'sistema', label: 'Disco e memória', node: 'disk', icon: 'i-disk' },
    { id: 'reinicio', label: 'Para medir com reinício', node: 'board', icon: 'i-refresh' },
    { id: 'manual', label: 'Só você pode fazer', node: 'board', icon: 'i-wrench' }
  ];
  const CATEGORY = new Map(CATEGORIES.map((item) => [item.id, item]));
  const METHOD_LABEL = { aplicar: 'aplica agora', medir: 'mede antes de manter', reiniciar: 'vale depois de reiniciar', testar: 'teste com reinício', manual: 'você faz' };
  const EVIDENCE_LABEL = { medido: 'efeito medido', varia: 'depende do PC', controverso: 'controverso', mito: 'quase mito' };

  /* ======================================================================================================
   * Início com o Windows: o que pode sair, o que é opcional e o que nunca sai
   * ==================================================================================================== */
  const S = (pattern, verdict, kind, label, why) => ({ pattern, verdict, kind, label, why });
  /* A ordem importa: o primeiro que bater decide. "manter" vem antes para um atualizador de antivírus nunca sair. */
  const STARTUP_KB = [
    S(/securityhealth|windows defender|windows security|msmpeng|\bavast|\bavg\b|avgui|kaspersky|\bavp(ui)?\b|norton|mcafee|\beset\b|egui|bitdefender|bdagent|malwarebytes|mbam|sophos|trend ?micro|webroot|f-secure|comodo|zonealarm|panda (dome|security)|360 ?total|quick ?heal|g ?data|avira/i, 'manter', 'seguranca', 'Segurança', 'Proteção do PC: o Nexo nunca tira do início.'),
    S(/vpn|wireguard|openvpn|tailscale|zerotier|warp\b|cloudflare ?warp|forticlient|globalprotect|anyconnect/i, 'manter', 'vpn', 'VPN', 'Conexão protegida; sem ela no início, a VPN pode não subir sozinha.'),
    S(/1password|bitwarden|keepass|lastpass|dashlane|nordpass|proton ?pass|enpass/i, 'manter', 'senhas', 'Gerenciador de senhas', 'Mantém o cofre de senhas à mão.'),
    S(/realtek|rtkaud|ravcpl|rtkngui|rthdvcpl|waves|maxxaudio|nahimic|dolby|\bdts\b|sonic ?studio|conexant|smartaudio|audio ?(manager|console|control)|sound ?blaster|creative|voicemeeter|equalizer ?apo|sonic ?radar|b&o|bang ?& ?olufsen|harman/i, 'manter', 'audio', 'Áudio', 'Sem ele, o som pode sair sem os ajustes da placa (equalizador, microfone, efeitos).'),
    S(/synaptics|syntp|\belan\b|etdctrl|etdmcu|touchpad|touch ?pad|precision ?touch|wacom|pen ?tablet|hotkey|hot ?key|\batk\b|fn ?key|quickset|keyboard ?(service|manager)|ime\b|ctfmon|lenovo ?(vantage|hotkeys)|myasus|hp ?(hotkey|quick)|dell ?(optimizer|quickset)|acer ?(quick|care)|msi ?(center|dragon)|armoury ?crate/i, 'manter', 'entrada', 'Teclado, touchpad e teclas do notebook', 'Teclas de função, touchpad e caneta dependem dele.'),
    S(/bluetooth|bttray|btserver|intel.*(wireless|connectivity)|killer ?(control|network|intelligence)/i, 'manter', 'conexao', 'Bluetooth e rede', 'Fones, controles e a própria rede dependem dele.'),
    S(/narrator|magnif|\bnvda\b|jaws|\bosk\b|zoomtext|dragon ?naturally/i, 'manter', 'acessibilidade', 'Acessibilidade', 'Recurso de acessibilidade: fica.'),

    /* Opcionais antes dos "desligar": o Discord, o Teams e o Slack abrem por um Update.exe e não são atualizadores. */
    S(/discord|vesktop|whatsapp|telegram|\bteams\b|msteams|skype|\bzoom\b|slack|signal|messenger|guilded|teamspeak|mumble/i, 'opcional', 'comunicacao', 'Chat e chamadas', 'Sem ele no início, você só recebe as mensagens depois de abrir o programa.'),
    S(/onedrive|google ?drive|googledrivefs|dropbox|icloud|mega ?sync|megasync|pcloud|box ?drive|sync ?client/i, 'opcional', 'nuvem', 'Nuvem e backup', 'Para de sincronizar até você abrir. O Nexo não desliga sozinho por causa dos seus arquivos.'),
    S(/g ?hub|lghub|logi(tech)?|razer|synapse|icue|corsair|steelseries|aura|mystic ?light|nzxt|\bcam\.exe|signalrgb|openrgb|hyperx|wooting|glorious|roccat|cooler ?master|fan ?control|argus ?monitor/i, 'opcional', 'perifericos', 'Periféricos e luzes', 'Sem ele aberto, perfis de mouse, teclado, luzes e curvas de ventoinha podem não ser aplicados.'),
    S(/geforce ?experience|nvidia ?(app|share|overlay|broadcast)|radeon ?software|amd ?software|adrenalin|amdrsserv|intel.*(graphics ?command|arc ?control)|igcc/i, 'opcional', 'video', 'Programa da placa de vídeo', 'O driver funciona sem ele; perde o overlay, a gravação instantânea e os avisos de atualização.'),
    S(/overwolf|medal|outplayed|\bobs\b|streamlabs|rtss|rivatuner|afterburner|blitz|porofessor|mobalytics|wallpaper ?engine|lively ?wallpaper|rainmeter/i, 'opcional', 'overlay', 'Overlay, gravação ou papel de parede', 'Desenha por cima dos jogos ou grava o tempo todo; abra só quando for usar.'),
    S(/docker|vmware|virtualbox|\bwsl\b|postman|jetbrains|toolbox|github ?desktop|ollama|lm ?studio/i, 'opcional', 'ferramentas', 'Ferramenta de trabalho', 'Ferramenta de desenvolvimento; abra quando for usar.'),

    S(/steam(?!vr)|epic ?games|epicgameslauncher|eadesktop|\bea ?app\b|\borigin\b|ubisoft|\bupc\b|uplay|battle\.net|blizzard|riot ?client|riotclient|gog ?galaxy|galaxyclient|rockstar|amazon ?games|xbox ?app|xboxpcapp|playnite|heroic|hoyoplay|minecraft ?launcher|garena|wegame|itch(\.io)?/i, 'desligar', 'launcher', 'Launcher de jogos', 'Abre sozinho quando você abre um jogo dele. No início do Windows, só ocupa memória e baixa atualizações por trás.'),
    S(/updat(e|er)|\bupd\b|jusched|adobearm|adobe ?gc|adobegcinvoker|acrotray|googleupdate|softwareupdate|apple ?software|ituneshelper|\bagent ?updater|crashpad ?handler/i, 'desligar', 'atualizador', 'Atualizador', 'Procura atualizações por conta própria; o programa continua se atualizando quando você abre ele.'),
    S(/msedge.*(no-startup-window|autolaunch)|microsoftedgeautolaunch|edge ?(auto ?launch|startup ?boost)|chrome.*no-startup-window|brave.*no-startup-window|opera.*(assistant|autoupdate|launcher)|browser ?assistant|operagx ?assistant/i, 'desligar', 'navegador', 'Navegador abrindo escondido', 'Deixa o navegador pré-carregado na memória antes de você precisar dele.'),
    S(/spotify|itunes|deezer|tidal|amazon ?music|youtube ?music/i, 'desligar', 'musica', 'Música', 'Abre em segundos quando você quiser ouvir; no início só ocupa memória.'),
    S(/cortana|copilot|ccleaner|wise ?care|iobit|advanced ?systemcare|driver ?booster|avast ?cleanup|razer ?cortex|game ?booster|smart ?game ?booster/i, 'desligar', 'utilitario', 'Utilitário de fundo', 'Fica rodando por trás sem ser necessário; vários "otimizadores" pesam mais do que ajudam.')
  ];
  /** Os opcionais que saem sozinhos quando pesaram de verdade durante a análise. */
  const AUTO_WHEN_HEAVY = new Set(['comunicacao', 'overlay', 'video', 'ferramentas']);

  const baseName = (value) => String(value || '').split(/[\\/]/).pop().replace(/\.(exe|lnk)$/i, '').toLowerCase();
  function classifyStartup(item) {
    const haystack = [item.name, item.exe, item.description, item.company].filter(Boolean).join(' ');
    for (const rule of STARTUP_KB) if (rule.pattern.test(haystack)) return { verdict: rule.verdict, kind: rule.kind, label: rule.label, why: rule.why };
    if (/microsoft/i.test(item.company || '') && /windows/i.test(item.description || '')) return { verdict: 'manter', kind: 'windows', label: 'Parte do Windows', why: 'Componente do próprio Windows.' };
    return { verdict: 'opcional', kind: 'desconhecido', label: 'Outro programa', why: 'O Nexo não conhece este programa; ele só sai se você marcar.' };
  }

  /** O que esse programa usou durante a observação da análise (para dizer "pesou X%"). */
  function costOf(item, observation) {
    const list = [...(observation?.background || []), ...(observation?.launchers || [])];
    const key = baseName(item.exe || item.name);
    if (!key) return null;
    const found = list.find((program) => baseName(program.name) === key || baseName(program.process) === key);
    if (!found) return null;
    return { cpu: finite(found.cpuAvg) ? found.cpuAvg : null, memMB: finite(found.memBytes) ? Math.round(found.memBytes / 1048576) : null, impact: found.impact || null };
  }
  const heavy = (cost) => Boolean(cost && (cost.impact === 'alto' || cost.impact === 'medio' || (finite(cost.cpu) && cost.cpu >= 2) || (finite(cost.memMB) && cost.memMB >= 500)));
  const costText = (cost) => {
    if (!cost) return '';
    const parts = [finite(cost.cpu) && cost.cpu >= 0.2 ? `${String(round1(cost.cpu)).replace('.', ',')}% do processador` : null, finite(cost.memMB) && cost.memMB >= 50 ? `${cost.memMB >= 1024 ? String(round1(cost.memMB / 1024)).replace('.', ',') + ' GB' : cost.memMB + ' MB'} de memória` : null].filter(Boolean);
    return parts.length ? `Durante a análise, usou ${parts.join(' e ')}.` : '';
  };

  /* ======================================================================================================
   * Plano
   * ==================================================================================================== */
  const option = (item, label) => item.options.find((entry) => entry.label === label) || null;
  const sameValues = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const recommended = (item) => item.options.find((entry) => entry.kind === 'recomendado') || null;

  /**
   * Regras do Raio-X que valem para o otimizador: qual opção, quando, em que seção e por quê (citando o PC).
   * `pick(item, ctx)` devolve a opção ou null. Itens "mito" nunca entram; controversos com reinício vão para o teste.
   */
  const SCAN_RULES = [
    { id: 'gamedvr', category: 'windows', pick: recommended, why: (ctx) => (ctx.has('gravacao-fundo') ? 'A análise viu a gravação em segundo plano ligada: ela usa o codificador da placa de vídeo e o disco o tempo todo, mesmo sem você pedir.' : 'O Windows grava os últimos minutos de jogo o tempo todo, mesmo sem você pedir.') },
    { id: 'gamemode', category: 'jogo', pick: (item) => (item.currentKind === 'alternativa' ? recommended(item) : null), why: () => 'O Modo de Jogo segura atualizações e tarefas de fundo enquanto um jogo roda; a análise viu ele desligado.' },
    { id: 'hags', category: 'jogo', pick: (item, ctx) => (ctx.has('gpu-hags') ? option(item, 'Ligado') : null), why: (ctx) => `A ${ctx.gpuName || 'sua placa de vídeo'} aceita a geração de quadros, que só aparece nos jogos com isto ligado.` },
    { id: 'stickykeys', category: 'jogo', pick: recommended, why: () => 'Apertar Shift cinco vezes no meio do jogo abre a janela das teclas de aderência e tira o jogo de foco. O recurso continua disponível nas configurações.' },
    { id: 'directx', category: 'jogo', pick: (item, ctx) => (ctx.win11 && ['Desligadas', 'Padrão do Windows'].includes(item.current) ? option(item, ctx.vrr ? 'Otimizações e taxa variável ligadas' : 'Só as otimizações') : null), why: (ctx) => `Jogos em janela e em tela cheia sem borda passam a usar o modo de apresentação moderno, com menos atraso de quadro${ctx.vrr ? ', e a taxa variável do seu monitor vale também neles' : ''}.` },
    { id: 'powerthrottling', category: 'energia', pick: (item, ctx) => (ctx.desktop ? option(item, 'Desligada') : null), why: () => 'Num desktop, segurar programas em segundo plano não economiza nada que importe e pode frear o que roda junto com o jogo (chat de voz, gravação).' },
    { id: 'deliveryopt', category: 'rede', pick: recommended, why: () => 'Sem isso, o Windows usa a sua internet para enviar atualizações a outros PCs. Upload ocupado é uma das causas mais comuns de ping alto.' },
    { id: 'edgebg', category: 'windows', pick: recommended, why: () => 'O Edge continua rodando escondido depois de fechado e pré-carrega ao ligar o PC.' },
    { id: 'chromebg', category: 'windows', pick: (item) => option(item, 'Fecha de verdade'), why: () => 'Fechar o Chrome passa a fechar de verdade (as extensões param de rodar por trás).' },
    { id: 'suggestions', category: 'windows', pick: recommended, why: () => 'Dicas, sugestões e apps que o Windows instala sozinho: tarefas de fundo e downloads que você não pediu.' },
    { id: 'consumerfeatures', category: 'windows', pick: recommended, why: () => 'Impede o Windows de instalar jogos e apps patrocinados no Iniciar.' },
    { id: 'feedback', category: 'windows', pick: recommended, why: () => 'O Windows para de abrir pedidos de avaliação.' },
    { id: 'websearch', category: 'windows', pick: recommended, why: () => 'A busca do Iniciar deixa de consultar a internet a cada letra digitada.' },
    { id: 'transparency', category: 'windows', pick: (item, ctx) => (ctx.igpuOnly ? option(item, 'Desligada') : null), why: (ctx) => `O efeito de vidro pesa no vídeo integrado (${ctx.gpuName || 'o seu'}), que divide a memória com o processador.` },
    { id: 'visualfx', category: 'windows', pick: (item, ctx) => (ctx.weak ? option(item, 'Melhor desempenho') : null), why: () => 'Neste PC mais modesto, as animações do Windows disputam o processador e o vídeo.' },
    { id: 'lastaccess', category: 'sistema', pick: recommended, why: () => 'Cada arquivo lido deixa de gerar uma gravação com a hora do acesso; jogos com milhares de arquivos agradecem.' },
    { id: 'hibernate', category: 'sistema', pick: (item, ctx) => (ctx.desktop && ctx.has('disco-cheio') ? option(item, 'Desligada') : null), why: (ctx) => `O disco do sistema está quase cheio e a hibernação reserva ${ctx.ramText || 'o tamanho da memória'} para ela; num desktop quase ninguém usa.` }
  ];
  /** Controversos que só valem depois de reiniciar: medir com o teste com reinício (ABBA), nunca aplicar no escuro. */
  const REBOOT_RULES = [
    { id: 'sysresp', label: 'Mínima (10%)' },
    { id: 'netthrottle', label: 'Sem limite' },
    { id: 'timerglobal', label: 'Para o sistema todo' },
    { id: 'tcpwait', label: '30 s' },
    { id: 'sysmain', label: 'Manual', when: (ctx) => ctx.systemSsd },
    { id: 'svchostsplit', label: 'Agrupar (até 16 GB)', when: (ctx) => ctx.ramGB >= 16 }
  ];

  function contextOf({ report, scan, game }) {
    const profile = report?.profile || {};
    const findings = report?.findings || [];
    const gpus = profile.gpus || [];
    const discrete = gpus.filter((gpu) => gpu.discrete);
    const laptop = profile.kind === 'laptop' || profile.kind === 'handheld';
    const ramGB = finite(profile.memory?.totalBytes) ? profile.memory.totalBytes / 1073741824 : null;
    const build = Number(profile.os?.build);
    const systemDisk = (profile.disks || []).find((disk) => disk.system) || null;
    return {
      profile, findings, laptop, desktop: !laptop && !profile.virtual, ramGB,
      ramText: finite(ramGB) ? `${Math.round(ramGB)} GB` : null,
      igpuOnly: !discrete.length && gpus.some((gpu) => gpu.integrated),
      hybridGpu: laptop && discrete.length > 0 && gpus.some((gpu) => gpu.integrated),
      gpuName: (discrete[0] || gpus[0])?.name || null,
      weak: (finite(profile.cpu?.cores) && profile.cpu.cores <= 4) || (finite(ramGB) && ramGB <= 8),
      win11: Number.isFinite(build) ? build >= 22000 : /11/.test(String(profile.os?.name || '')),
      vrr: (profile.displays || []).some((display) => display.vrr === true),
      systemSsd: systemDisk ? ['ssd', 'nvme'].includes(systemDisk.kind) : false,
      has: (id) => findings.some((item) => item.id === id),
      finding: (id) => findings.find((item) => item.id === id) || null,
      scanItems: new Map((scan?.items || []).filter((item) => item.available).map((item) => [item.id, item])),
      game
    };
  }

  /**
   * Monta o plano. Entradas (todas opcionais; o que faltar só deixa o plano menor):
   *  report    — relatório da análise profunda (perfil, achados, observação, plano do laboratório);
   *  scan      — leitura do Raio-X (interpret());
   *  startup   — itens do início: { source, name, exe, description, company, enabled };
   *  nics      — placas em uso: { guid, name, media: 'ethernet'|'wifi', props: [{ keyword, value, valid: [...] }] };
   *  game      — jogo escolhido: { name, exe (caminho), exeName };
   *  power     — { active: guid, overlayAc: guid };
   *  nicTweaks — catálogo da placa de rede (vem do processo principal);
   *  allowRisk — até onde o modo autônomo vai sozinho ('baixo' | 'moderado' | 'alto').
   */
  function buildPlan({ report = null, scan = null, startup = [], nics = [], game = null, power = null, nicTweaks = [], allowRisk = 'moderado', sensors = true } = {}) {
    const ctx = contextOf({ report, scan, game });
    const steps = [];
    const allowed = (risk) => (RISK_RANK[risk] || 3) <= (RISK_RANK[allowRisk] || 2);
    const add = (step) => {
      const selected = step.selected !== undefined ? step.selected : ['aplicar', 'reiniciar', 'medir'].includes(step.method) && allowed(step.risk || 'baixo') && step.evidence !== 'mito';
      steps.push({ admin: false, reboot: 'nao', evidence: 'varia', risk: 'baixo', ...step, selected: Boolean(selected) && step.method !== 'manual' });
    };

    /* ---------- O jogo ---------- */
    if (game?.exeName) {
      if (ctx.hybridGpu && game.exe) add({ id: 'jogo-gpu', category: 'jogo', kind: 'gpu-pref', method: 'aplicar', title: `${game.name}: sempre na placa de vídeo dedicada`, why: `Notebook com duas placas: o Windows às vezes abre o jogo na integrada. Fixa a ${ctx.gpuName || 'dedicada'} para o ${game.exeName}.`, evidence: 'medido', change: { kind: 'gpu-pref', exe: game.exe } });
      add({ id: 'jogo-prioridade', category: 'jogo', kind: 'priority', method: 'aplicar', admin: true, risk: 'moderado', evidence: 'varia', title: `${game.name}: prioridade alta no processador`, why: `O ${game.exeName} passa a abrir com prioridade alta, na frente do que roda por trás. Ajuda mais quando o processador está disputado.`, change: { kind: 'priority', exe: game.exeName } });
      add({ id: 'jogo-qos', category: 'rede', kind: 'qos', method: 'aplicar', admin: true, evidence: 'varia', title: `${game.name}: pacotes do jogo com prioridade`, why: `Marca o tráfego do ${game.exeName} como tempo real (DSCP 46). No Wi-Fi, o roteador manda esses pacotes na fila de voz; roteadores com QoS também passam ele na frente.`, change: { kind: 'qos', exe: game.exeName } });
    }

    /* ---------- Rede ---------- */
    for (const nic of nics) {
      for (const tweak of nicTweaks) {
        if (tweak.media !== nic.media) continue;
        const prop = (nic.props || []).find((item) => item.keyword === tweak.keyword);
        if (!prop || prop.value === null || prop.value === undefined) continue;
        const current = String(prop.value);
        if (current === tweak.target) continue;
        if (tweak.from && !tweak.from.includes(current)) continue;
        if (Array.isArray(prop.valid) && prop.valid.length && !prop.valid.map(String).includes(tweak.target)) continue;
        add({ id: `rede-${nic.guid.slice(1, 9)}-${tweak.keyword.replace(/\W/g, '').toLowerCase()}`, category: 'rede', kind: 'nic', method: 'aplicar', admin: true, risk: tweak.risk, evidence: tweak.evidence,
          title: `${nic.media === 'wifi' ? 'Wi-Fi' : 'Rede cabeada'}: ${tweak.label}`, why: `${tweak.why} Placa: ${nic.name}.`, from: prop.display || current, to: tweak.target === '0' ? 'Desligado' : 'Ligado',
          change: { kind: 'nic', guid: nic.guid, keyword: tweak.keyword } });
      }
    }
    const lan = ctx.finding('rede-100');
    if (lan) add({ id: 'manual-cabo', category: 'manual', kind: 'manual', method: 'manual', title: lan.title, why: 'Troque o cabo (Cat 5e ou melhor) ou a porta do roteador: a placa aceita mais, o link é que caiu.' });
    if (ctx.has('wifi-24')) add({ id: 'manual-5ghz', category: 'manual', kind: 'manual', method: 'manual', title: 'Conectar no Wi-Fi de 5 GHz', why: 'A sua placa aceita 5 GHz e está em 2,4 GHz. Se o roteador tiver as duas redes, conecte na de 5 GHz (ou separe os nomes nas configurações dele). Para jogar, cabo é sempre melhor.' });

    /* ---------- Energia ---------- */
    if (power?.active === POWER_SAVER) add({ id: 'energia-plano', category: 'energia', kind: 'power-plan', method: 'aplicar', title: 'Sair do plano "Economia de energia"', why: 'O plano de economia limita a velocidade do processador o tempo todo. Volta para o Equilibrado (o laboratório ajusta o resto em seguida).', evidence: 'medido', change: { kind: 'power-plan', guid: BALANCED } });
    if (ctx.laptop && power?.overlayAc === EFFICIENCY_MODE) add({ id: 'energia-modo', category: 'energia', kind: 'power-mode', method: 'aplicar', title: 'Modo de energia "Melhor desempenho" na tomada', why: 'Na tomada, o modo de eficiência segura o processador e a placa de vídeo mesmo quando você joga.', evidence: 'medido', change: { kind: 'power-mode', guid: BEST_PERFORMANCE } });
    const labSteps = (report?.plan || []).filter((step) => step.kind === 'laboratorio' && Array.isArray(step.knobs));
    const knobs = [...new Set(labSteps.flatMap((step) => step.knobs))];
    if (knobs.length) {
      add({ id: 'energia-laboratorio', category: 'energia', kind: 'lab', method: 'medir', risk: 'moderado', evidence: 'medido', selected: sensors && allowed('moderado'),
        title: `Laboratório: ${knobs.length} ajustes de energia medidos neste PC`, why: `${labSteps.map((step) => step.title).slice(0, 4).join(', ')}. Cada ajuste é ligado e desligado em pares intercalados e só fica o que ganhar de verdade, além do ruído.${sensors ? '' : ' Precisa da leitura de temperatura do processador (em Hardware > Sensores); sem ela, fica de fora.'}`,
        blocked: sensors ? null : 'sem-temperatura', change: { kind: 'lab', knobs } });
    }

    /* ---------- Início com o Windows ---------- */
    for (const item of startup) {
      if (!item.enabled) continue;
      const info = classifyStartup(item);
      if (info.verdict === 'manter') continue;
      const cost = costOf(item, report?.observation);
      const select = info.verdict === 'desligar' || (AUTO_WHEN_HEAVY.has(info.kind) && heavy(cost));
      const name = item.description && item.description.length <= 60 ? item.description : item.name;
      add({ id: `inicio-${slug(item.source + '-' + item.name)}`, category: 'inicio', kind: 'startup', method: 'aplicar', admin: Boolean(item.elevated), evidence: info.verdict === 'desligar' ? 'medido' : 'varia', group: info.kind,
        title: `Tirar do início: ${name}`, why: [info.why, costText(cost)].filter(Boolean).join(' '), tag: info.label, cost, selected: select,
        change: { kind: 'startup', source: item.source, name: item.name } });
    }
    const behind = (report?.observation?.background || []).filter((program) => (program.impact === 'alto' || program.impact === 'medio') && program.tip);
    for (const program of behind.slice(0, 4)) {
      add({ id: `manual-fundo-${slug(program.name)}`, category: 'manual', kind: 'manual', method: 'manual', title: `${program.label || program.name}: ajuste dentro do programa`, why: program.tip, goto: program.settings || null });
    }

    /* ---------- Raio-X ---------- */
    for (const rule of SCAN_RULES) {
      const item = ctx.scanItems.get(rule.id);
      if (!item) continue;
      const target = rule.pick(item, ctx);
      if (!target || sameValues(target.values, item.values) || item.evidence === 'mito') continue;
      add({ id: `raiox-${rule.id}`, category: rule.category, kind: 'scan', method: item.reboot === 'reiniciar' ? 'reiniciar' : 'aplicar', admin: item.admin, risk: item.risk, evidence: item.evidence, reboot: item.reboot,
        title: item.label, why: rule.why(ctx), from: item.current, to: target.label, change: { kind: 'scan', id: item.id, values: target.values } });
    }
    const rebootChanges = [];
    for (const rule of REBOOT_RULES) {
      const item = ctx.scanItems.get(rule.id);
      if (!item || (rule.when && !rule.when(ctx))) continue;
      const target = option(item, rule.label);
      if (!target || sameValues(target.values, item.values)) continue;
      rebootChanges.push({ id: item.id, label: item.label, beforeLabel: item.current, afterLabel: target.label, before: item.values, after: target.values, reboot: item.reboot, admin: item.admin });
    }
    if (rebootChanges.length) add({ id: 'reinicio-teste', category: 'reinicio', kind: 'reboot-test', method: 'testar', risk: 'moderado', evidence: 'controverso', selected: false,
      title: `${rebootChanges.length} ajustes controversos para medir com reinício`, why: `${rebootChanges.map((change) => change.label).join('; ')}. Cada um só vale depois de reiniciar e o efeito muda de PC para PC; o teste com reinício mede com e sem (ordem A, B, B, A) e só mantém o que ganhar.`,
      change: { kind: 'reboot-test', changes: rebootChanges } });

    /* ---------- Disco e memória ---------- */
    if (ctx.has('mem-sem-paginacao')) add({ id: 'sistema-paginacao', category: 'sistema', kind: 'pagefile', method: 'reiniciar', admin: true, reboot: 'reiniciar', evidence: 'medido', title: 'Religar o arquivo de paginação (tamanho automático)', why: 'Sem ele, quando a memória enche, o jogo ou o Windows fecham em vez de ficar só mais lentos. O Windows volta a cuidar do tamanho.', change: { kind: 'pagefile', auto: true } });
    const full = ctx.finding('disco-cheio');
    if (full) add({ id: 'manual-disco', category: 'manual', kind: 'manual', method: 'manual', title: full.title, why: 'Em Manutenção > Limpeza segura dá para liberar os temporários. Jogos que você não joga mais também ocupam muito; desinstalar pelo launcher libera de vez.', goto: 'maintenance' });

    /* ---------- O que só a pessoa faz ---------- */
    for (const step of (report?.plan || []).filter((item) => item.kind === 'bios' && !item.done)) add({ id: `manual-${step.id}`, category: 'manual', kind: 'manual', method: 'manual', title: `Na BIOS: ${step.title.charAt(0).toLowerCase()}${step.title.slice(1)}`, why: step.why });
    if (ctx.has('tela-placa-mae')) add({ id: 'manual-monitor', category: 'manual', kind: 'manual', method: 'manual', title: 'Ligar o monitor na placa de vídeo', why: ctx.finding('tela-placa-mae').detail || 'O cabo do monitor está na saída da placa-mãe; o jogo roda na placa de vídeo e a imagem faz um caminho mais longo.' });
    if (ctx.has('reinicio-pendente')) add({ id: 'manual-reiniciar', category: 'manual', kind: 'manual', method: 'manual', title: 'Reiniciar o PC', why: 'Uma atualização está esperando o reinício para terminar; até lá, partes dela ficam pela metade.' });

    const order = new Map(CATEGORIES.map((item, index) => [item.id, index]));
    steps.sort((a, b) => order.get(a.category) - order.get(b.category));
    return { steps, categories: CATEGORIES.filter((item) => steps.some((step) => step.category === item.id)), counts: countsOf(steps), game: game ? { name: game.name, exeName: game.exeName } : null };
  }
  const slug = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';
  const POWER_SAVER = 'a1841308-3541-4fab-bc81-f71556f20b4a';
  const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
  const EFFICIENCY_MODE = '961cc777-2547-4f9d-8174-7d86181b8a7a';
  const BEST_PERFORMANCE = 'ded574b5-45a0-4f42-8737-46345c09c238';

  function countsOf(steps) {
    const selected = steps.filter((step) => step.selected);
    return { total: steps.length, selected: selected.length, admin: selected.filter((step) => step.admin).length, reboot: selected.filter((step) => step.method === 'reiniciar').length, manual: steps.filter((step) => step.method === 'manual').length,
      risky: selected.some((step) => (RISK_RANK[step.risk] || 1) >= 2) };
  }

  /** Precisa da frase digitada? Sim quando há algo moderado ou alto marcado (inclusive o laboratório). */
  function needsPhrase(steps) {
    return steps.some((step) => step.selected && (RISK_RANK[step.risk] || 1) >= 2);
  }
  function assertConsent(steps, consent) {
    if (!consent || consent.acknowledged !== true) throw Object.assign(new Error('Confirme o aviso para começar.'), { code: 'consentimento' });
    if (needsPhrase(steps) && String(consent.phrase || '').trim().toUpperCase() !== CONSENT_PHRASE) throw Object.assign(new Error(`Há ajustes de risco moderado marcados: digite "${CONSENT_PHRASE}" para começar.`), { code: 'consentimento' });
  }

  /* ======================================================================================================
   * Medição antes e depois (sem alternar: o que precisa de administrador ou de reinício não dá para ligar e
   * desligar várias vezes). Ruído = maior meia amplitude dos dois lados; só conta o que passa dele com folga e
   * aparece na maioria das rodadas.
   * ==================================================================================================== */
  const METRICS = [
    { id: 'single', label: 'Um núcleo', unit: 'pts', better: 'up', min: 3, group: 'processador' },
    { id: 'multi', label: 'Todos os núcleos', unit: 'pts', better: 'up', min: 3, group: 'processador' },
    { id: 'burst', label: 'Resposta a rajadas', unit: 'pts', better: 'up', min: 4, group: 'processador' },
    { id: 'frames', label: 'Ritmo de quadros (simulação)', unit: 'pts', better: 'up', min: 4, group: 'processador' },
    { id: 'latency', label: 'Latência para acordar um núcleo', unit: 'pts', better: 'up', min: 5, group: 'processador' },
    { id: 'gatewayMs', label: 'Ping até o roteador', unit: 'ms', better: 'down', min: 10, floor: 0.6, group: 'rede' },
    { id: 'gatewayJitter', label: 'Variação do ping até o roteador', unit: 'ms', better: 'down', min: 15, floor: 0.4, group: 'rede' },
    { id: 'internetMs', label: 'Ping até a internet', unit: 'ms', better: 'down', min: 6, floor: 1.5, group: 'rede' },
    { id: 'internetJitter', label: 'Variação do ping até a internet', unit: 'ms', better: 'down', min: 15, floor: 0.8, group: 'rede' }
  ];
  const METRIC = new Map(METRICS.map((item) => [item.id, item]));

  function compareMetric(metric, before, after) {
    const b = before.filter(finite);
    const a = after.filter(finite);
    const mb = median(b);
    const ma = median(a);
    if (b.length < 2 || a.length < 2 || !finite(mb) || !finite(ma) || mb <= 0) return { verdict: 'inconclusivo', before: mb, after: ma, deltaPct: null, noisePct: null };
    const half = (list) => (Math.max(...list) - Math.min(...list)) / 2;
    const noisePct = (Math.max(half(b), half(a)) / mb) * 100;
    const raw = ((ma - mb) / mb) * 100;
    const gain = metric.better === 'up' ? raw : -raw;
    // Em ms baixos, 0,3 ms é "muito" em porcentagem e nada na prática: exige também uma diferença absoluta mínima.
    const absolute = Math.abs(ma - mb);
    const threshold = Math.max(metric.min, noisePct * 1.5);
    const majority = (sign) => {
      const hits = a.filter((value) => (metric.better === 'up' ? (value - mb) * sign > 0 : (mb - value) * sign > 0)).length;
      return hits / a.length >= 2 / 3;
    };
    let verdict = 'sem-diferenca';
    if (Math.abs(gain) > threshold && (!metric.floor || absolute >= metric.floor)) {
      if (gain > 0 && majority(1)) verdict = 'melhorou';
      else if (gain < 0 && majority(-1)) verdict = 'piorou';
    }
    return { verdict, before: round1(mb), after: round1(ma), deltaPct: round1(gain), noisePct: round1(noisePct) };
  }
  function compareAll(before, after) {
    const out = {};
    for (const metric of METRICS) {
      if (!before?.[metric.id]?.length || !after?.[metric.id]?.length) continue;
      out[metric.id] = compareMetric(metric, before[metric.id], after[metric.id]);
    }
    return out;
  }
  const groupOf = (id) => METRIC.get(id)?.group;

  /* ======================================================================================================
   * Execução
   * ==================================================================================================== */
  const BENCHES = ['single', 'multi', 'burst', 'frames', 'latency'];
  const DEFAULTS = { rounds: 3, labBudgetMin: 12, labArms: 8 };
  const IMMEDIATE = new Set(['nic', 'qos', 'power-plan', 'power-mode']);
  const REBOOT_NOTE = { reiniciar: 'vale depois de reiniciar', sessao: 'vale depois de sair e entrar de novo no Windows' };

  /**
   * `system` (processo principal ou simulado nos testes):
   *   preflight() → { platform, onBattery, tempC, cpuLoad, busy }
   *   bench(name) → número (maior = melhor);  ping() → { gatewayMs, gatewayJitter, internetMs, internetJitter }
   *   apply(changes, { restorePoint }) → { records: [{ id, stepId, ok, error, before, after }], restore, declined }
   *   revert(records) → { records: [{ id, ok }], declined }
   *   lab(options) → resultado do laboratório (NexoLab.run);  waitNetwork() → boolean;  sleep(ms);  now()
   * options: consent, allowRisk, goal, signal ({ cancelled }), emit(event), rounds, labBudgetMin
   */
  /**
   * Aplica um conjunto de passos de uma vez (uma permissão do Windows para tudo que precisa de administrador) e
   * registra o resultado de cada um. Usado pela otimização completa e pelo "Resolver agora" de cada achado.
   */
  async function applySteps(system, steps, result, { mark, say, restorePoint }) {
    const changes = steps.map((step) => ({ ...step.change, stepId: step.id }));
    const outcome = await system.apply(changes, { restorePoint });
    result.restore = outcome.restore || null;
    if (outcome.restore?.ok) say(outcome.restore.created ? 'Ponto de restauração do Windows criado.' : `Ponto de restauração: ${outcome.restore.note || 'usando um recente'}.`);
    else if (outcome.restore) say(`Sem ponto de restauração (${outcome.restore.note || 'o Windows não criou'}); cada mudança continua no Diário com o valor anterior.`);
    if (outcome.declined) say('Você recusou a permissão do Windows: os ajustes que precisam de administrador ficaram de fora.');
    for (const record of outcome.records || []) {
      const step = steps.find((item) => item.id === record.stepId);
      if (!step) continue;
      if (record.ok) {
        const reboot = step.method === 'reiniciar' ? 'reiniciar' : step.reboot || 'nao';
        result.records.push({ ...record, kind: step.kind, category: step.category, title: step.title, risk: step.risk, reboot, immediate: IMMEDIATE.has(step.kind) || (step.kind === 'scan' && reboot === 'nao') });
        mark(step, 'feito', REBOOT_NOTE[reboot] || '');
      } else mark(step, 'falhou', record.error || (outcome.declined && step.admin ? 'sem a permissão do Windows' : 'o Windows recusou'));
    }
    for (const step of steps) if (!result.steps[step.id]) mark(step, 'falhou', 'não chegou a ser aplicado');
    result.rebootPending = result.records.some((record) => record.reboot !== 'nao');
    return outcome;
  }

  /**
   * "Resolver agora" de um achado: aplica só os passos pedidos, sem a medição longa (são correções de efeito
   * conhecido). O laboratório (que precisa medir) fica de fora: esse vai pela otimização completa.
   */
  async function fix(system, plan, ids, options = {}) {
    const wanted = new Set((ids || []).map(String));
    const steps = (plan?.steps || []).filter((step) => wanted.has(step.id) && ['aplicar', 'reiniciar'].includes(step.method) && !step.blocked).map((step) => ({ ...step, selected: true }));
    const now = system.now || (() => Date.now());
    const result = { startedAt: now(), endedAt: null, status: 'running', reason: null, quick: true, comparison: {}, steps: {}, records: [], restore: null, undone: [], rebootPending: false, log: [] };
    const say = (message) => result.log.push({ t: now(), message });
    const mark = (step, status, note = '') => { result.steps[step.id] = { status, note }; };
    try {
      if (!steps.length) throw Object.assign(new Error('Esse ajuste não pode ser feito daqui.'), { code: 'vazio' });
      assertConsent(steps, options.consent);
      const pre = await system.preflight?.();
      if (pre && pre.platform && pre.platform !== 'win32') throw Object.assign(new Error('A correção automática funciona no Windows.'), { code: 'plataforma' });
      if (pre?.busy) throw Object.assign(new Error(pre.busy), { code: 'ocupado' });
      await applySteps(system, steps, result, { mark, say, restorePoint: steps.some((step) => (RISK_RANK[step.risk] || 1) >= 2) });
      if (result.records.some((record) => record.kind === 'nic')) await system.waitNetwork?.();
      result.status = result.records.length ? 'completed' : 'aborted';
      if (!result.records.length) result.reason = Object.values(result.steps)[0]?.note || 'Nada foi aplicado.';
    } catch (error) {
      result.status = 'aborted';
      result.reason = String(error?.message || error).slice(0, 240);
      result.code = error?.code || 'erro';
    }
    result.endedAt = now();
    return result;
  }

  /* eslint-disable no-await-in-loop -- Sequencial de propósito: cada medição precisa da máquina só para ela, e cada
     mudança é aplicada (e, se for o caso, desfeita) antes da próxima medição. */
  async function run(system, plan, options = {}) {
    const steps = (plan?.steps || []).filter((step) => step.selected && step.method !== 'manual' && step.method !== 'testar' && !step.blocked);
    const settings = { ...DEFAULTS, ...options };
    const emit = typeof options.emit === 'function' ? options.emit : () => {};
    const now = system.now || (() => Date.now());
    const signal = options.signal || {};
    const result = { startedAt: now(), endedAt: null, status: 'running', reason: null, before: null, after: null, comparison: {}, steps: {}, records: [], restore: null, lab: null, undone: [], rebootPending: false, log: [] };
    const say = (message) => { const entry = { t: now(), message }; result.log.push(entry); emit({ type: 'log', ...entry }); };
    const stage = (name, detail = '') => emit({ type: 'stage', stage: name, detail });
    const mark = (step, status, note = '') => { result.steps[step.id] = { status, note }; emit({ type: 'step', id: step.id, category: step.category, status, note }); };
    const cancelled = () => Boolean(signal.cancelled);
    const checkCancel = () => { if (cancelled()) throw Object.assign(new Error('Você cancelou a otimização.'), { code: 'cancelado' }); };
    let applied = false;

    const measure = async (side) => {
      const out = Object.fromEntries(METRICS.map((metric) => [metric.id, []]));
      for (let round = 0; round < settings.rounds; round += 1) {
        // Ordem alternada entre as rodadas: o calor de um teste não pesa sempre no mesmo.
        const order = round % 2 ? [...BENCHES].reverse() : BENCHES;
        for (const bench of order) {
          checkCancel();
          const score = await system.bench(bench).catch(() => null);
          if (finite(score)) out[bench].push(score);
        }
        const ping = await system.ping().catch(() => null);
        for (const key of ['gatewayMs', 'gatewayJitter', 'internetMs', 'internetJitter']) if (finite(ping?.[key])) out[key].push(ping[key]);
        emit({ type: 'measure', side, round: round + 1, rounds: settings.rounds });
      }
      return out;
    };

    try {
      stage('preparar', 'Conferindo se dá para medir direito');
      assertConsent(plan.steps || [], options.consent);
      const pre = await system.preflight();
      if (pre?.platform !== 'win32') throw Object.assign(new Error('A otimização automática funciona no Windows.'), { code: 'plataforma' });
      if (pre.busy) throw Object.assign(new Error(pre.busy), { code: 'ocupado' });
      if (pre.onBattery) throw Object.assign(new Error('Ligue o PC na tomada: na bateria, a medição não vale (e o Windows segura o desempenho).'), { code: 'bateria' });
      if (finite(pre.cpuLoad) && pre.cpuLoad >= 50) throw Object.assign(new Error(`O processador está ${Math.round(pre.cpuLoad)}% ocupado. Feche programas pesados para a medição ser justa.`), { code: 'ocupado' });
      if (!steps.length) throw Object.assign(new Error('Nada marcado para otimizar.'), { code: 'vazio' });
      say(`Plano com ${steps.length} ${steps.length === 1 ? 'passo' : 'passos'}${plan.game ? ` (jogo: ${plan.game.name})` : ''}.`);

      stage('antes', 'Medindo o PC como está');
      result.before = await measure('antes');
      say('Medição de antes pronta.');

      const direct = steps.filter((step) => step.kind !== 'lab');
      if (direct.length) {
        checkCancel();
        const admin = direct.some((step) => step.admin);
        stage('aplicar', admin ? 'Aplicando (o Windows vai pedir permissão uma vez)' : 'Aplicando');
        await applySteps(system, direct, result, { mark, say, restorePoint: true });
        applied = true;
        if (result.records.some((record) => record.kind === 'nic')) {
          stage('rede', 'Esperando a internet voltar (a placa de rede reiniciou)');
          const back = await system.waitNetwork();
          say(back ? 'Internet de volta.' : 'A internet demorou para voltar; a medição de rede pode ficar de fora.');
        }
      }

      const labStep = steps.find((step) => step.kind === 'lab');
      if (labStep) {
        checkCancel();
        stage('laboratorio', 'Laboratório: medindo os ajustes de energia em pares');
        mark(labStep, 'rodando');
        try {
          const lab = await system.lab({ consent: options.consent, allowRisk: options.allowRisk || 'moderado', goal: options.goal || 'jogos', knobs: labStep.change.knobs, budgetMin: settings.labBudgetMin, maxArms: settings.labArms, signal });
          result.lab = lab;
          if (lab?.status === 'cancelled') checkCancel();
          if (lab?.adopted) { mark(labStep, 'feito', `plano "${lab.adopted.name}" adotado (${lab.combination?.compositeDelta > 0 ? '+' : ''}${String(lab.combination?.compositeDelta ?? 0).replace('.', ',')}%)`); }
          else mark(labStep, lab?.status === 'completed' ? 'sem-ganho' : 'falhou', lab?.status === 'completed' ? 'nenhum ajuste ganhou além do ruído; o plano ficou como estava' : (lab?.reason || 'o laboratório parou'));
        } catch (error) {
          if (error?.code === 'cancelado') throw error;
          mark(labStep, 'falhou', String(error?.message || error).slice(0, 160));
        }
      }

      stage('depois', 'Medindo de novo, do mesmo jeito');
      result.after = await measure('depois');
      result.comparison = compareAll(result.before, result.after);

      /* Conferir: piorou além do ruído logo depois de mudanças que valem na hora? Confirma com mais uma medição e,
         se continuar pior, desfaz as suspeitas (rede para o que é de rede; o resto para o processador) e mede de novo. */
      const worse = Object.entries(result.comparison).filter(([, value]) => value.verdict === 'piorou').map(([id]) => id);
      const suspectsFor = (groups) => result.records.filter((record) => {
        if (!record.immediate || record.undone) return false;
        const network = ['nic', 'qos'].includes(record.kind);
        return (groups.has('rede') && network) || (groups.has('processador') && !network);
      });
      if (worse.length) {
        const groups = new Set(worse.map(groupOf));
        const suspects = suspectsFor(groups);
        if (suspects.length) {
          stage('conferir', 'Algo piorou: conferindo se não foi acaso');
          const again = await measure('confirmacao');
          const confirm = compareAll(result.before, again);
          const still = worse.filter((id) => confirm[id]?.verdict === 'piorou');
          if (still.length) {
            const culprits = suspectsFor(new Set(still.map(groupOf)));
            say(`Piorou de verdade: ${still.map((id) => METRIC.get(id).label.toLowerCase()).join(', ')}. Desfazendo ${culprits.length} ${culprits.length === 1 ? 'ajuste que vale na hora' : 'ajustes que valem na hora'}.`);
            const undo = await system.revert(culprits);
            for (const record of undo.records || []) {
              if (!record.ok) continue;
              const original = result.records.find((item) => item.id === record.id);
              if (original) { original.undone = true; result.undone.push(original.id); mark({ id: original.stepId, category: original.category }, 'desfeito', 'piorou na medição; voltou ao que era'); }
            }
            const final = await measure('depois-de-desfazer');
            result.after = final;
            result.comparison = compareAll(result.before, final);
          } else {
            say('Na segunda medição a diferença sumiu: era oscilação do PC, não o ajuste.');
            result.after = again;
            result.comparison = confirm;
          }
        }
      }
      result.status = 'completed';
    } catch (error) {
      result.status = error?.code === 'cancelado' ? 'cancelled' : 'aborted';
      result.reason = String(error?.message || error).slice(0, 240);
      result.code = error?.code || 'erro';
      say(result.reason);
    }
    if (applied && result.status === 'cancelled') say('O que já foi aplicado continua no Diário, com "Reverter".');
    result.endedAt = now();
    stage('fim', result.status);
    emit({ type: 'done' });
    return result;
  }
  /* eslint-enable no-await-in-loop */

  /** Resumo em palavras para o fim: quantos ajustes, o que melhorou e o que ficou para depois do reinício. */
  function summarize(result, plan) {
    const done = Object.values(result.steps || {}).filter((step) => step.status === 'feito').length;
    const undone = (result.undone || []).length;
    const failed = Object.values(result.steps || {}).filter((step) => step.status === 'falhou').length;
    const better = Object.entries(result.comparison || {}).filter(([, value]) => value.verdict === 'melhorou').map(([id]) => METRIC.get(id).label.toLowerCase());
    const worse = Object.entries(result.comparison || {}).filter(([, value]) => value.verdict === 'piorou').map(([id]) => METRIC.get(id).label.toLowerCase());
    const join = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`);
    const headline = result.status !== 'completed' ? (result.status === 'cancelled' ? 'Otimização cancelada' : 'A otimização parou') : done ? `${done} ${done === 1 ? 'ajuste aplicado' : 'ajustes aplicados'}` : 'Nada precisou mudar';
    const lines = [];
    if (better.length) lines.push(`Melhorou além do ruído: ${join(better)}.`);
    if (worse.length) lines.push(`Ainda pior que antes: ${join(worse)} (o Nexo não achou um ajuste culpado; pode ser o PC esquentando ou outro programa).`);
    if (!better.length && !worse.length && result.status === 'completed') lines.push('Nas medições que valem na hora, nada mudou além do ruído (é o esperado para limpeza do início e ajustes que valem depois de reiniciar).');
    if (undone) lines.push(`${undone} ${undone === 1 ? 'ajuste foi desfeito porque piorou' : 'ajustes foram desfeitos porque pioraram'}.`);
    if (failed) lines.push(`${failed} não ${failed === 1 ? 'pôde ser aplicado' : 'puderam ser aplicados'}.`);
    if (result.rebootPending) lines.push('Parte dos ajustes vale depois de reiniciar: o Nexo mede de novo quando você reiniciar.');
    const manual = (plan?.steps || []).filter((step) => step.method === 'manual').length;
    return { headline, lines, done, undone, failed, manual };
  }

  return { CATEGORIES, CATEGORY, METHOD_LABEL, EVIDENCE_LABEL, CONSENT_PHRASE, STARTUP_KB, METRICS, METRIC, BENCHES, classifyStartup, costOf, buildPlan, needsPhrase, assertConsent, compareMetric, compareAll, run, fix, summarize, countsOf, POWER_SAVER, BALANCED, EFFICIENCY_MODE, BEST_PERFORMANCE };
});
