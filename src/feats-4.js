/* Mais recursos: completam todas as telas com folga nos dois sistemas, mais os que só existem no Linux. */
(function () {
  const { add, helpers: H } = NexoFeatures;
  const HOUR = 3600e3;
  const DAY = 24 * HOUR;
  const facts = (c) => c.src('facts');
  const linux = 'linux';
  const startOfDay = (offset = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - offset * DAY; };
  const sizeOf = (key) => { try { return (localStorage.getItem(key) || '').length * 2; } catch { return 0; } };
  const evidence = (c) => Object.entries(c.lab.evidence || {});
  const versionsSeen = () => { try { const v = JSON.parse(localStorage.getItem('nexo-versions-seen') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

  add('home', [
    { id: 'semana-cpu', icon: 'chart', title: 'Processador dia a dia', compute: (c) => { const days = Array.from({ length: 7 }, (_, i) => H.avg(H.vals(c.hist.filter((s) => s.timestamp >= startOfDay(6 - i) && s.timestamp < startOfDay(5 - i)), 'cpu'))).filter(H.fin); if (days.length < 2) { return null; } return { value: H.nf(days[days.length - 1]), unit: '% hoje', detail: `média de cada um dos últimos ${days.length} dias`, spark: days }; } }
  ]);

  add('analysis', [
    { id: 'gpu-hora-pesada', icon: 'gpu', title: 'Hora em que a placa de vídeo mais trabalha', empty: 'Aprendendo', compute: (c) => { const g = c.brain?.habitGrid?.('gpu'); const cells = (g?.grid || []).flatMap((row, day) => row.map((v, hour) => ({ day, hour, v }))).filter((x) => H.fin(x.v)); if (cells.length < 6) { return null; } const [top] = cells.sort((a, b) => b.v - a.v); return { value: `${H.weekday(top.day)}, ${String(top.hour).padStart(2, '0')}h`, text: true, detail: `GPU média de ${H.nf(top.v)}%: provavelmente quando você joga` }; } }
  ]);

  add('hardware', [
    { id: 'nucleo-ocupado', icon: 'cpu', title: 'Núcleo mais ocupado', empty: 'Sem sensor', compute: (c) => { const l = c.sensors().filter((s) => s.deviceType === 'Cpu' && s.type === 'Load' && /core/i.test(s.name) && !/total|max/i.test(s.name) && H.fin(s.value)); if (!l.length) { return null; } const [top] = l.sort((a, b) => b.value - a.value); return { value: H.nf(top.value), unit: '%', detail: `${top.name} · ${l.length} núcleos com leitura`, tone: H.tone(top.value, 90, 99) }; } },
    { id: 'temps-lidas', icon: 'temp', title: 'Temperaturas lidas', empty: 'Sem sensor', compute: (c) => { const l = c.sensors().filter((s) => s.type === 'Temperature' && H.fin(s.value) && s.value > 5 && s.value < 125 && !/warning|critical|limit|threshold|shutdown|t\s*j\s*max/i.test(s.name)); if (!l.length) { return null; } const top = [...l].sort((a, b) => b.value - a.value); return { value: H.nf(l.length), detail: 'sensores de temperatura', list: top.slice(0, 3).map((s) => [`${s.device.split(' ').slice(-2).join(' ')} · ${s.name}`, `${H.nf(s.value)} °C`]) }; } },
    { id: 'memoria-virtual', icon: 'mem', title: 'Memória virtual em uso', empty: 'Sem sensor', compute: (c) => { const used = c.sensors().find((s) => s.deviceType === 'Memory' && s.type === 'Data' && /virtual memory used/i.test(s.name)); const free = c.sensors().find((s) => s.deviceType === 'Memory' && s.type === 'Data' && /virtual memory available/i.test(s.name)); if (!used) { return null; } return { value: H.bytes(used.value * 1024 ** 3), detail: free ? `${H.bytes(free.value * 1024 ** 3)} ainda disponíveis (memória + arquivo de paginação)` : 'memória + arquivo de paginação' }; } },
    { id: 'kernel', icon: 'leaf', title: 'Kernel do Linux', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => (facts(c)?.kernel ? { value: facts(c).kernel, text: true, detail: 'Kernels mais novos trazem drivers e agendador melhores.' } : null) },
    { id: 'sessao-grafica', icon: 'screen', title: 'Sessão gráfica', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => { const s = facts(c)?.session; if (!s) { return null; } return { value: s === 'wayland' ? 'Wayland' : s === 'x11' ? 'X11' : s, text: true, detail: s === 'wayland' ? 'O Nexo lê o programa em primeiro plano pelo XWayland.' : 'Leitura completa do programa em primeiro plano.' }; } },
    { id: 'governador-hw', icon: 'bolt', title: 'Governador de frequência', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => (facts(c)?.governor ? { value: facts(c).governor, text: true, detail: 'Política do kernel para subir e baixar o clock.' } : null) }
  ]);

  add('maintenance', [
    { id: 'historico-guardado', icon: 'history', title: 'Histórico guardado', compute: (c) => (c.hist.length ? { value: H.dur(c.hist.length * 60), text: true, detail: `${H.bytes(sizeOf(Nexo.keys.history))} na interface · apaga sozinho depois de 7 dias` } : null) },
    { id: 'sessoes-espaco', icon: 'game', title: 'Espaço das sessões', compute: (c) => ({ value: H.bytes(sizeOf(Nexo.keys.sessions)), detail: `${H.plural(c.sessions.length, 'relatório', 'relatórios')} com linha do tempo (até 10)` }) },
    { id: 'mais-cheia', icon: 'disk', title: 'Unidade mais cheia', compute: (c) => { const [d] = [...(c.snap?.drives || [])].sort((a, b) => b.usedPercent - a.usedPercent); return d ? { value: H.nf(d.usedPercent), unit: '%', detail: d.name, bar: d.usedPercent / 100, tone: H.tone(d.usedPercent, 85, 95) } : null; } },
    { id: 'proxima-limpeza', icon: 'calendar', title: 'Próxima limpeza automática', compute: () => { const on = readJSON(Nexo.keys.autoClean, false) === true; if (!on) { return { value: 'Desligada', detail: 'Ligue em Otimizar para limpar toda semana.' }; } const last = Number(localStorage.getItem(Nexo.keys.autoCleanLastRun)) || 0; const next = last + 7 * DAY; return { value: next <= Date.now() ? 'Na próxima abertura' : new Date(next).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }), text: true, detail: last ? `Última ${H.ago(last)}` : 'Ainda não rodou.' }; } },
    { id: 'ultimo-boot', icon: 'rocket', title: 'Último início do sistema', compute: (c) => { const up = c.snap?.uptimeSeconds; if (!H.fin(up)) { return null; } const at = Date.now() - up * 1000; return { value: new Date(at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }), text: true, detail: `às ${new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` }; } },
    { id: 'medir-limpeza', icon: 'broom', title: 'Medir o que dá para limpar', kind: 'acao', compute: () => { const t = Nexo.state.cleanupTotals; return t ? { value: H.bytes(t.bytes), detail: `${H.nf(t.fileCount)} arquivos seguros` } : { value: 'Medir', detail: 'Só mede: nada é apagado sem prévia.' }; }, action: { label: 'Medir', run: async () => { await Nexo.scanCleanup?.(); } } },
    { id: 'linux-kernel-m', icon: 'leaf', title: 'Kernel em uso', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => (facts(c)?.kernel ? { value: facts(c).kernel, text: true, detail: 'Depois de atualizar o kernel, reinicie para usar o novo.' } : null) }
  ]);

  const memFree = (c) => (c.snap?.memoryTotalBytes ? c.snap.memoryTotalBytes - c.snap.memoryUsedBytes : null);
  add('optimize', [
    { id: 'carga-agora', icon: 'cpu', title: 'Carga do processador agora', compute: (c) => { const v = H.vals(c.live, 'cpu'); if (!v.length) { return null; } return { value: H.nf(v[v.length - 1]), unit: '%', detail: 'Para comparar antes e depois de um ajuste.', spark: v.slice(-60), tone: H.tone(v[v.length - 1], 80, 95) }; } },
    { id: 'memoria-jogos', icon: 'mem', title: 'Memória livre para jogos', compute: (c) => { const free = memFree(c); if (!H.fin(free)) { return null; } const gb = free / 1024 ** 3; return { value: H.bytes(free), detail: gb < 6 ? 'Jogos atuais pedem 6–8 GB livres: feche o navegador antes de jogar.' : 'Folga boa para jogar.', tone: gb < 4 ? 'bad' : gb < 6 ? 'warn' : 'good' }; } },
    { id: 'espaco-atualizacoes', icon: 'disk', title: 'Espaço para atualizações', compute: (c) => { const d = c.snap?.primaryDrive; if (!d?.sizeBytes) { return null; } const gb = d.freeBytes / 1024 ** 3; return { value: H.bytes(d.freeBytes), detail: gb < 30 ? 'Atualizações grandes de jogos e do sistema pedem uns 30 GB.' : 'Cabe atualização grande.', tone: gb < 15 ? 'bad' : gb < 30 ? 'warn' : 'good' }; } },
    { id: 'gpu-livre', icon: 'gpu', title: 'Placa de vídeo agora', empty: 'Sem sensor', compute: (c) => { const v = H.vals(c.live, 'gpu'); if (!v.length) { return null; } const now = v[v.length - 1]; return { value: H.nf(now), unit: '%', detail: now < 15 ? 'Ociosa: nada pesando nela.' : 'Algo está usando a placa.', spark: v.slice(-60) }; } },
    { id: 'antes-depois', icon: 'target', title: 'Medir antes e depois', kind: 'acao', compute: () => ({ value: Nexo.sessions?.isRecording?.() ? 'Gravando' : 'Gravar', text: true, detail: 'Grave uma sessão antes e outra depois de otimizar e compare.' }), action: { label: (c) => (Nexo.sessions?.isRecording?.() ? 'Parar' : 'Começar'), run: async () => { if (Nexo.sessions.isRecording()) await Nexo.sessions.stop(); else await Nexo.sessions.start({}); } } },
    { id: 'linux-mangohud', icon: 'chart', title: 'MangoHud', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => { const f = facts(c); if (!f) { return null; } return { value: f.mangohud ? 'Instalado' : 'Não instalado', detail: f.mangohud ? 'Mede FPS nas sessões.' : 'Instale pelo gerenciador de pacotes para medir FPS.', tone: f.mangohud ? 'good' : 'warn' }; } },
    { id: 'linux-sessao', icon: 'screen', title: 'Wayland ou X11', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => { const s = facts(c)?.session; return s ? { value: s === 'wayland' ? 'Wayland' : s === 'x11' ? 'X11' : s, text: true, detail: 'Jogos antigos às vezes rodam melhor numa sessão X11.' } : null; } },
    { id: 'linux-ppd', icon: 'plug', title: 'Perfis de energia', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => { const f = facts(c); if (!f) { return null; } return { value: f.ppd ? (f.powerProfile || 'Disponível') : 'Indisponível', text: true, detail: f.ppd ? 'power-profiles-daemon presente: o Nexo troca o perfil.' : 'Instale o power-profiles-daemon para trocar o perfil.', tone: f.ppd ? 'good' : undefined }; } },
    { id: 'linux-kernel-o', icon: 'leaf', title: 'Versão do kernel', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => (facts(c)?.kernel ? { value: facts(c).kernel, text: true, detail: 'Atualizar o kernel costuma trazer ganhos para placas novas.' } : null) },
    { id: 'linux-opcao-fps', icon: 'copy', title: 'Opção de lançamento do MangoHud', os: linux, kind: 'ferramenta', needs: ['fps'], empty: 'Lendo…', compute: (c) => { const o = c.src('fps')?.launchOption; return o ? { value: 'Pronta', detail: 'Cole nas opções de lançamento do jogo na Steam.' } : null; }, action: { label: 'Copiar', run: async (c) => ((await H.copy(c.src('fps').launchOption)) ? 'Opção copiada.' : 'Não consegui copiar.') } }
  ]);

  const withFps = (c) => c.sessions.filter((s) => H.fin(s.report?.fps?.avgFps));
  add('sessions', [
    { id: 'fps-geral', icon: 'chart', title: 'FPS médio de todas as sessões', empty: 'Sem FPS', compute: (c) => { const v = withFps(c).map((s) => s.report.fps.avgFps); return v.length ? { value: H.nf(H.avg(v)), unit: 'FPS', detail: `em ${H.plural(v.length, 'sessão medida', 'sessões medidas')}` } : null; } },
    { id: 'com-fps', icon: 'eye', title: 'Sessões com FPS medido', compute: (c) => (c.sessions.length ? { value: `${withFps(c).length} de ${c.sessions.length}`, text: true, bar: withFps(c).length / c.sessions.length, detail: 'Medir FPS mostra quem limita os quadros.' } : null) },
    { id: 'quadros', icon: 'layers', title: 'Quadros analisados', empty: 'Sem FPS', compute: (c) => { const v = H.vals(withFps(c), (s) => s.report.fps.frames); return v.length ? { value: H.nf(H.sum(v)), detail: 'quadros com tempo medido um por um' } : null; } }
  ]);

  add('library', [
    { id: 'loja-espaco', icon: 'disk', title: 'Loja que mais ocupa espaço', needs: ['games'], compute: (c) => { const g = (c.src('games') || []).filter((x) => x.kind !== 'app' && x.installed !== false && x.sizeBytes > 0); if (!g.length) { return null; } const m = new Map(); for (const x of g) { m.set(x.sourceLabel || x.source, (m.get(x.sourceLabel || x.source) || 0) + x.sizeBytes); } const l = [...m.entries()].sort((a, b) => b[1] - a[1]); return { value: l[0][0], text: true, detail: H.bytes(l[0][1]), list: l.slice(1, 3).map(([k, v]) => [k, H.bytes(v)]) }; } }
  ]);

  add('atlas', [
    { id: 'acao-dia', icon: 'bolt', title: 'Algo que o Nexo faz por você', compute: () => { const l = NexoAtlas.forPlatform(Nexo.platform).filter((i) => i.status === 'acao'); if (!l.length) { return null; } const i = l[(Math.floor(Date.now() / DAY) + 1) % l.length]; return { value: i.titulo, text: true, detail: i.resumo }; }, action: { label: 'Abrir', run: () => { const l = NexoAtlas.forPlatform(Nexo.platform).filter((i) => i.status === 'acao'); Nexo.openAtlas?.(l[(Math.floor(Date.now() / DAY) + 1) % l.length]?.titulo); } } }
  ]);

  add('lab', [
    { id: 'medicoes', icon: 'chart', title: 'Medições guardadas', compute: (c) => ({ value: H.nf(H.sum(evidence(c).map(([, v]) => v?.n || 0))), detail: 'Cada ideia é medida mais de uma vez, contra o ruído.' }) },
    { id: 'ganho-medio', icon: 'trophy', title: 'Ganho médio das vencedoras', empty: 'Nenhuma ainda', compute: (c) => { const v = evidence(c).filter(([, e]) => e?.wins > e?.losses && H.fin(e.mean)).map(([, e]) => e.mean); return v.length ? { value: `${H.signed(H.avg(v), 1)}`, unit: '%', detail: `em ${H.plural(v.length, 'ideia', 'ideias')}`, tone: 'good' } : null; } },
    { id: 'modos', icon: 'gear', title: 'Autônomo ou assistido', compute: (c) => { const r = c.lab.runs || []; if (!r.length) { return null; } const a = r.filter((x) => x.autonomy === 'autonomo').length; return { value: `${a} autônomas`, text: true, detail: `${r.length - a} assistidas (você aprova cada passo)` }; } },
    { id: 'sem-diferenca', icon: 'wave', title: 'Rodadas sem diferença', compute: (c) => { const r = c.lab.runs || []; if (!r.length) { return null; } return { value: H.nf(r.filter((x) => x.verdict === 'sem-diferenca').length), detail: 'Também é resposta: no seu PC, aquilo não muda nada.' }; } },
    { id: 'nao-testadas', icon: 'star', title: 'Ideias ainda não testadas', needs: ['labStatus'], empty: 'Lendo…', compute: (c) => { const s = c.src('labStatus')?.space || []; if (!s.length) { return null; } const tested = new Set(evidence(c).filter(([k, v]) => !k.startsWith('combo:') && v?.n > 0).map(([k]) => k.split(':')[0])); const left = s.filter((k) => !tested.has(k.id)).length; return { value: H.nf(left), detail: `de ${s.length}: a próxima rodada começa por elas` }; } },
    { id: 'carga-lab', icon: 'cpu', title: 'Processador agora', compute: (c) => { const v = H.vals(c.live, 'cpu'); if (!v.length) { return null; } const now = v[v.length - 1]; return { value: H.nf(now), unit: '%', detail: now < 20 ? 'Quieto: medições confiáveis.' : 'Ocupado: as medições ficariam com ruído.', tone: now < 20 ? 'good' : 'warn', spark: v.slice(-60) }; } },
    { id: 'perfil-linux', icon: 'plug', title: 'Perfis de energia', os: linux, needs: ['facts'], empty: 'Lendo…', compute: (c) => { const f = facts(c); if (!f) { return null; } return { value: f.ppd ? 'Disponíveis' : 'Indisponíveis', detail: f.ppd ? 'O laboratório alterna entre eles e mede.' : 'Sem power-profiles-daemon, o laboratório testa menos coisas.', tone: f.ppd ? 'good' : 'warn' }; } }
  ]);

  add('activity', [
    { id: 'primeiro', icon: 'calendar', title: 'Registro mais antigo guardado', compute: (c) => { const [a] = [...c.activity].sort((x, y) => x.timestamp - y.timestamp); return a ? { value: H.when(a.timestamp), text: true, detail: a.title } : null; } },
    { id: 'ultima-reversao', icon: 'history', title: 'Última reversão', compute: (c) => { const [r] = c.journal.filter((e) => e.status === 'reverted' && e.revertedAt).sort((a, b) => b.revertedAt - a.revertedAt); return r ? { value: r.title, text: true, detail: H.ago(r.revertedAt) } : { value: 'Nenhuma', detail: 'Nada foi desfeito ainda.' }; } },
    { id: 'semana-alteracoes', icon: 'bolt', title: 'Alterações nesta semana', compute: (c) => { const l = c.journal.filter((e) => e.at >= Date.now() - 7 * DAY); return { value: H.nf(l.length), list: l.slice(0, 3).map((e) => [e.title, H.ago(e.at)]) }; } }
  ]);

  add('settings', [
    { id: 'ceu-quantidade', icon: 'star', title: 'Quantidade no céu', kind: 'ferramenta', compute: () => { const d = Nexo.sky?.prefs?.().density; return d ? { value: { pouco: 'Pouco', normal: 'Normal', muito: 'Muito' }[d], text: true, detail: 'Estrelas e vagalumes.' } : null; }, action: { label: 'Próxima', run: () => { const order = ['pouco', 'normal', 'muito']; const now = Nexo.sky.prefs().density; Nexo.sky.set({ density: order[(order.indexOf(now) + 1) % 3] }); } } }
  ]);

  const notes = () => window.NexoNovidades?.versions || [];
  add('updates', [
    { id: 'versao-anterior', icon: 'history', title: 'Versão anterior', compute: () => { const v = versionsSeen(); return v.length >= 2 ? { value: v[v.length - 2].version, text: true, detail: `usada até ${H.when(v[v.length - 1].at)}` } : null; }, empty: 'Primeira versão' },
    { id: 'novidades-total', icon: 'spark', title: 'Novidades acumuladas', compute: () => { const n = notes(); return n.length ? { value: H.nf(H.sum(n.map((v) => H.sum(v.sections.map((s) => s.items.length))))), detail: `itens nas notas de ${H.plural(n.length, 'versão', 'versões')}` } : null; } },
    { id: 'sistemas', icon: 'screen', title: 'Sistemas suportados', compute: () => ({ value: 'Windows e Linux', text: true, detail: 'Windows 10 e 11 de 64 bits · Linux x64 (AppImage e .deb)' }) }
  ]);
})();
