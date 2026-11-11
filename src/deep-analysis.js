/*
 * Análise profunda: as regras. Recebe o perfil das peças (NexoHardware.identify), a saúde do sistema, a observação de
 * 30+ s do que roda por trás e o teste de carga, e devolve achados com evidência, confiança e o que fazer.
 *  - O próprio Nexo, o jogo aberto, os launchers (Steam, Epic…) e os anticheats NUNCA entram como culpados: "o jogo
 *    pesa" não é achado. O que interessa é o que atrapalha POR TRÁS dele.
 *  - O conselho depende do setup: uma B550 com Ryzen 5600G não recebe "placa de vídeo em PCIe 3.0" como defeito (é
 *    limite do processador); uma H410 não recebe "ligue o XMP" (a placa trava a memória).
 *  - Nunca sugere desligar proteção (antivírus, isolamento de núcleo, atualizações de segurança).
 * Funções puras; a coleta fica em electron/deep-scan.cjs e a orquestração em electron/deep-run.cjs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hardware-kb.js'));
  else root.NexoDeep = factory(root.NexoHardware);
})(typeof self !== 'undefined' ? self : this, function (Hardware) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const round = (value, digits = 0) => { const f = 10 ** digits; return Math.round(value * f) / f; };
  const comma = (value, digits = 0) => round(value, digits).toFixed(digits).replace('.', ',');
  const avg = (list) => { const values = list.filter(finite); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
  const max = (list) => { const values = list.filter(finite); return values.length ? Math.max(...values) : null; };
  const min = (list) => { const values = list.filter(finite); return values.length ? Math.min(...values) : null; };
  const MB = 1024 * 1024;
  const DAY = 24 * 3600 * 1000;
  const mbText = (bytes) => (bytes >= 1024 * MB ? `${comma(bytes / (1024 * MB), 1)} GB` : `${Math.round(bytes / MB)} MB`);
  const rateText = (bytes) => `${bytes >= 10 * MB ? Math.round(bytes / MB) : comma(bytes / MB, 1)} MB/s`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* ======================================================================================================
   * Etapas e nós da constelação
   * ==================================================================================================== */
  const NODES = [
    { id: 'cpu', label: 'Processador' }, { id: 'board', label: 'Placa-mãe' }, { id: 'memory', label: 'Memória' }, { id: 'gpu', label: 'Vídeo' },
    { id: 'disk', label: 'Disco' }, { id: 'network', label: 'Rede' }, { id: 'windows', label: 'Windows' }
  ];
  const STAGES = [
    { id: 'parts', label: 'Conhecendo as peças', nodes: ['board', 'cpu'], minMs: 7000 },
    { id: 'memory', label: 'Memória', nodes: ['memory'], minMs: 5000 },
    { id: 'video', label: 'Vídeo e tela', nodes: ['gpu'], minMs: 5000 },
    { id: 'disk', label: 'Disco', nodes: ['disk'], minMs: 4000 },
    { id: 'windows', label: 'Windows e rede', nodes: ['windows', 'network'], minMs: 5000 },
    { id: 'behind', label: 'O que roda por trás', nodes: [], minMs: 30000 },
    { id: 'load', label: 'Teste de carga', nodes: ['cpu', 'gpu'], minMs: 18000 }
  ];
  const MIN_TOTAL_MS = 60000;

  /* ======================================================================================================
   * Quem é quem: próprio Nexo, jogo, launcher, anticheat, sistema ou programa de fundo
   * ==================================================================================================== */
  const base = (name) => String(name || '').replace(/\.exe$/i, '').trim();
  const LAUNCHERS = /^(steam|steamwebhelper|steamservice|steamerrorreporter|gameoverlayui|epicgameslauncher|epicwebhelper|epiconlineservices\w*|eosoverlayrenderer-win\d+-shipping|riotclientservices|riotclientux|riotclientuxrender|riotclientcrashhandler|leagueclient|leagueclientux|leagueclientuxrender|battle\.net|battle\.net helper|blizzard battle\.net|eadesktop|eabackgroundservice|eaconnect_microsoft|eacefsubprocess|ealocalhostsvc|origin|originwebhelperservice|upc|ubisoftconnect|uplaywebcore|ubisoftgamelauncher|uplayservice|galaxyclient|galaxyclient helper|galaxycommunication|xboxpcapp|xboxpcappft|xboxapp|gamingservices|gamingservicesnet|robloxplayerlauncher|minecraftlauncher|rockstarservice|socialclubhelper|launcherpatcher|amazongamesui|amazon games ui|itch|heroic|lutris|playnite\.desktopapp|playnite\.fullscreenapp|hoyoplay|hyp|wegame|garena|crossfire|ggpo)$/i;
  const ANTICHEAT = /^(easyanticheat|easyanticheat_eos|easyanticheat_launcher|beservice|beservice_x64|bedaisy|vgc|vgtray|faceit|faceitclient|faceitservice|esportal|gameguard|gamemon|gamemon64|xigncode|xxd-0\.xem|ace-tray|sguard64|sguardsvc64|nprotect|ricochet\w*|atvi-randgrid_sr)$/i;
  const KNOWN_GAMES = /^(robloxplayerbeta|minecraft\.windows|valorant-win64-shipping|fortniteclient-win64-shipping|cs2|csgo|dota2|r5apex|r5apex_dx12|league of legends|gta5|gta5_enhanced|playgtav|rdr2|eldenring|overwatch|destiny2|cod|blackops6|blackopscoldwar|modernwarfare|bf2042|bf6|battlefield6|rocketleague|tslgame|deadbydaylight-win64-shipping|genshinimpact|zenlesszonezero|starrail|client-win64-shipping|marvel-win64-shipping|rainbowsix|rainbowsix_vulkan|fc2[4-9]|witcher3|cyberpunk2077|hogwartslegacy|palworld-win64-shipping|terraria|stardew valley|among us|brawlhalla|warframe\.x64|pathofexile\w*|escapefromtarkov|rustclient|arma3_x64|dayz_x64|discovery|helldivers2|bg3|bg3_dx11|osu!|deltaforce\w*|naraka\w*|thefinals|wow|wowclassic|diablo iv|hearthstone|sc2_x64|minecraft|javaw|ryujinx|rpcs3|pcsx2\w*|dolphin|cemu|retroarch|xenia\w*|ppssppwindows64|duckstation\w*|eden|citron|vita3k|shadps4)$/i;
  const SHIPPING = /-win(64|32)-shipping$/i;
  // Nome de gente para launchers e jogos conhecidos (processos do mesmo launcher viram um só: "Steam").
  const FRIENDLY = [
    [/^(steam|steamwebhelper|steamservice|steamerrorreporter|gameoverlayui)$/i, 'Steam'], [/^(epicgameslauncher|epicwebhelper|epiconlineservices\w*|eosoverlayrenderer-win\d+-shipping)$/i, 'Epic Games'],
    [/^riotclient\w*$/i, 'Riot Client'], [/^leagueclient\w*$/i, 'Cliente do League of Legends'], [/^(battle\.net|battle\.net helper|blizzard battle\.net|agent)$/i, 'Battle.net'],
    [/^(eadesktop|eabackgroundservice|eaconnect_microsoft|eacefsubprocess|ealocalhostsvc|origin|originwebhelperservice)$/i, 'EA app'], [/^(upc|ubisoftconnect|uplaywebcore|ubisoftgamelauncher|uplayservice)$/i, 'Ubisoft Connect'],
    [/^galaxy\w*/i, 'GOG Galaxy'], [/^(xboxpcapp|xboxpcappft|xboxapp|gamingservices|gamingservicesnet)$/i, 'Xbox'], [/^(rockstarservice|socialclubhelper|launcherpatcher)$/i, 'Rockstar Games Launcher'],
    [/^(easyanticheat\w*)$/i, 'Easy Anti-Cheat'], [/^(beservice\w*|bedaisy)$/i, 'BattlEye'], [/^(vgc|vgtray)$/i, 'Vanguard (anticheat)'], [/^faceit\w*$/i, 'FACEIT'],
    [/^robloxplayerbeta$/i, 'Roblox'], [/^valorant-win64-shipping$/i, 'VALORANT'], [/^fortniteclient-win64-shipping$/i, 'Fortnite'], [/^cs2$/i, 'Counter-Strike 2'], [/^csgo$/i, 'CS:GO'],
    [/^dota2$/i, 'Dota 2'], [/^r5apex(_dx12)?$/i, 'Apex Legends'], [/^league of legends$/i, 'League of Legends'], [/^(gta5|gta5_enhanced|playgtav)$/i, 'GTA V'], [/^rdr2$/i, 'Red Dead Redemption 2'],
    [/^minecraft\.windows$/i, 'Minecraft'], [/^eldenring$/i, 'Elden Ring'], [/^overwatch$/i, 'Overwatch 2'], [/^rocketleague$/i, 'Rocket League'], [/^tslgame$/i, 'PUBG'],
    [/^genshinimpact$/i, 'Genshin Impact'], [/^zenlesszonezero$/i, 'Zenless Zone Zero'], [/^starrail$/i, 'Honkai: Star Rail'], [/^marvel-win64-shipping$/i, 'Marvel Rivals'], [/^rainbowsix(_vulkan)?$/i, 'Rainbow Six Siege'],
    [/^cyberpunk2077$/i, 'Cyberpunk 2077'], [/^palworld-win64-shipping$/i, 'Palworld'], [/^deadbydaylight-win64-shipping$/i, 'Dead by Daylight'], [/^escapefromtarkov$/i, 'Escape from Tarkov'], [/^rustclient$/i, 'Rust'], [/^bg3(_dx11)?$/i, "Baldur's Gate 3"], [/^helldivers2$/i, 'Helldivers 2']
  ];
  const friendly = (name) => (FRIENDLY.find(([pattern]) => pattern.test(name)) || [null, name])[1];
  const SYSTEM = /^(idle|system|registry|memory compression|secure system|smss|csrss|wininit|winlogon|services|lsass|lsaiso|fontdrvhost|sihost|ctfmon|taskhostw|dllhost|conhost|runtimebroker|applicationframehost|textinputhost|startmenuexperiencehost|shellexperiencehost|shellhost|searchhost|searchapp|lockapp|dwm|explorer|audiodg|spoolsv|wudfhost|smartscreen|securityhealthservice|securityhealthsystray|systemsettings|backgroundtaskhost|useroobebroker|wmiprvse|wmiapsrv|unsecapp|dashost|ngciso|wlanext|igfxem|igfxcui|igfxhk|igfxtray|nvdisplay\.container|amdfendrsr|atiesrxx|atieclxx|rtkauduservice64|smss|vmmemcmzygote|aggregatorhost|crossdeviceresume|widgetservice|phoneexperiencehost|gamebarpresencewriter|msedgewebview2_host|mpdefendercoreservice_host)$/i;
  // Do sistema, mas que às vezes é o problema: só entram como culpados acima do próprio limite.
  const SYSTEM_WATCH = { dwm: { cpu: 10, gpu: 20, label: 'Compositor do Windows (dwm)', tip: 'O dwm desenha as janelas. Muito uso costuma vir de monitores com taxas diferentes, papel de parede animado ou efeitos de transparência.' },
    explorer: { cpu: 8, label: 'Explorador de Arquivos', tip: 'O Explorador alto e constante costuma ser extensão de menu de contexto ou pasta de rede travando.' },
    audiodg: { cpu: 3, label: 'Áudio do Windows (audiodg)', tip: 'Efeitos de som (equalizadores, "som espacial", melhorias do fabricante) rodam aqui. Desligar as melhorias do dispositivo de som resolve.' },
    wmiprvse: { cpu: 12, label: 'Serviço WMI (consultas ao sistema)', tip: 'Algum programa está consultando o sistema o tempo todo (muitas vezes RGB ou monitor de hardware). Uma parte pequena disso é a própria medição do Nexo, que consulta o sistema a cada 3 segundos durante a análise.' } };

  const K = (re, kind, label, tip, extra = {}) => ({ re, kind, label, tip, ...extra });
  const BACKGROUND = [
    K(/^(msmpeng|mpdefendercoreservice|nissrv|mssense|mpcmdrun|securityhealthhost)$/i, 'antivirus', 'Microsoft Defender', 'É a proteção do Windows, e o Nexo não mexe nela. Se a verificação coincide com o jogo, deixe o PC ligado e parado um tempo para ela terminar.', { protect: true }),
    K(/^(avp|avpui|avastsvc|avastui|avgsvc|avgui|bdservicehost|bdagent|vsserv|mcshield|mfemms|mfevtps|ekrn|egui|nortonsecurity|ns|nsbu|ccsvchst|sophoshealth|savservice|wrsa|psanhost|sentinelagent|csfalconservice|kavtray|360tray|zhudongfangyu)$/i, 'antivirus', 'Antivírus', 'O antivírus está verificando arquivos. Proteção não se desliga; vale ver se ele tem um "modo jogo" nas configurações.', { protect: true }),
    K(/^(tiworker|trustedinstaller|mousocoreworker|usoclient|wuauclt|musnotification|musnotifyicon|setuphost|windows10upgraderapp|sihclient|wuaucltcore|wusa)$/i, 'atualizacao', 'Windows Update', 'O Windows está baixando ou instalando atualizações. Deixe terminar e reinicie: o peso some depois e as correções de segurança entram.', { settings: 'windowsupdate' }),
    K(/^(searchindexer|searchprotocolhost|searchfilterhost)$/i, 'indexacao', 'Indexação da pesquisa do Windows', 'O Windows está catalogando arquivos para a busca. Costuma acalmar sozinho; num HD (disco mecânico) pesa mais.'),
    K(/^(compattelrunner|devicecensus|dismhost|wsqmcons|disksnapshot|defrag|cleanmgr|tieringengineservice|sdiagnhost|msiexec|wermgr|werfault|taskeng|sppsvc|fontcache)$/i, 'manutencao', 'Manutenção do Windows', 'Tarefa de manutenção ou diagnóstico do Windows. Ela roda quando o PC fica parado; se coincide com o jogo, deixar o PC ligado e parado um pouco resolve.'),
    K(/^(onedrive|onedrive\.sync\.service|dropbox|googledrivefs|icloudservices|iclouddrive|megasync|pcloud|nextcloud|synologydrive\w*|boxsync)$/i, 'nuvem', 'Sincronização na nuvem', 'Enviando ou baixando arquivos. Pausar a sincronização durante o jogo libera o disco e a internet.'),
    K(/^(chrome|msedge|firefox|opera|opera_gx|brave|vivaldi|arc|zen|librewolf|waterfox|yandex|thorium)$/i, 'navegador', 'Navegador', 'Abas abertas (vídeo, transmissão, páginas pesadas) disputam processador e placa de vídeo. Fechar as abas que não usa durante o jogo ajuda.'),
    K(/^msedgewebview2$/i, 'navegador', 'Componente web (WebView2)', 'Usado por Widgets, Teams, Copilot e outros apps. Fechar o app dono dele resolve.'),
    K(/^(discord|discordptb|discordcanary|vesktop)$/i, 'comunicacao', 'Discord', 'O overlay e a aceleração por hardware do Discord usam a placa de vídeo, e transmitir a tela pesa bastante. Dá para desligar a aceleração em Configurações > Avançado, no Discord.'),
    K(/^(teams|ms-teams|zoom|slack|skype|whatsapp|whatsapp\.root|telegram|signal)$/i, 'comunicacao', 'Chat ou chamada', 'Apps de chamada e chat ficam ativos em segundo plano; fechar os que não estiver usando libera memória.'),
    K(/^(nvidia share|nvsphelper64|nvoawrappercache|nvidia overlay|nvidia app|nvidia web helper|nvcontainer)$/i, 'gravacao', 'Overlay e gravação da NVIDIA', 'Com o "Replay instantâneo" ligado, a placa grava os últimos minutos o tempo todo. Se não usa, desligue no overlay da NVIDIA (Alt+Z).'),
    K(/^(radeonsoftware|amdrsserv|amdrssrcext|amdow|cncmd|amddvr)$/i, 'gravacao', 'AMD Software (gravação e overlay)', 'A gravação instantânea grava o tempo todo quando ligada. Confira em AMD Software > Gravação.'),
    K(/^(gamebar|gamebarftserver|broadcastdvr|xboxgamebarwidgets|bcastdvruserservice\w*)$/i, 'gravacao', 'Barra de Jogo do Xbox (capturas)', 'A gravação em segundo plano grava o tempo todo quando ligada. Confira em Configurações > Jogos > Capturas.', { settings: 'captures' }),
    K(/^(obs64|obs32|obs|streamlabs obs|streamlabs|xsplit\.core|xsplit|twitchstudio)$/i, 'gravacao', 'Programa de gravação ou transmissão', 'Gravar ou transmitir usa o codificador da placa ou o processador. Se não está transmitindo agora, feche.'),
    K(/^(overwolf|overwolfbrowser|overwolfhelper|overwolfhelper64|medal|medalencoder|outplayed|blitz|porofessor|mobalytics|insights capture)$/i, 'overlay', 'Overlay de jogos', 'Overlays de terceiros desenham por cima do jogo e alguns gravam lances o tempo todo. Desligar a gravação contínua ajuda.'),
    K(/^(rtss|rtsshooksloader64|msiafterburner|encoderserver)$/i, 'overlay', 'RivaTuner / Afterburner', 'Útil para limitar FPS e ver estatísticas; a gravação do Afterburner pesa. Mantenha só o que usa.'),
    K(/^(icue|corsair\.service|corsairgamingaudiocfgservice64|lightingservice|auraservice|aurawallpaperservice|armourycrate\w*|armourysocketserver|asusoptimization|asuscertservice|rogliveservice|nzxt cam|cam_helper|signalrgb\w*|razer synapse\w*|razercentralservice|rzsdkservice|razerappengine|lghub|lghub_agent|lghub_updater|lghub_system_tray|steelseriesgg|steelseriesengine|msi\.centralserver|msi_center|mysticlight\w*|ledkeeper2|gcc|rgbfusion\w*|openrgb|aac\w*hal\w*|aacambientlighting\w*|hyperxngenuity|ngenuity|wallpaperservice32|fancontrol|thermaltake\w*|tt rgb plus|coolermaster\w*|masterplus\w*)$/i, 'rgb', 'Software de RGB e periféricos', 'Programas de RGB e periféricos consultam a placa-mãe e os controladores o tempo todo; alguns causam engasgos (latência de DPC) em jogo. Salvar o perfil no próprio periférico e fechar o programa costuma resolver.'),
    K(/^(nahimicsvc32|nahimicsvc64|nahimicservice|nhnotifsys|nahimic3|a-volute\w*|wavessvc64|wavessyssvc64|maxxaudio\w*|dtsapo\w*|sonicstudio\w*|sonicradar\w*|dolbydax\w*)$/i, 'audio', 'Software de áudio do fabricante', 'Nahimic, Waves e afins aplicam efeitos de som em tempo real; o Nahimic tem histórico de engasgos em alguns jogos. Se não usa os efeitos, desative-os no app do fabricante.'),
    K(/^(wallpaper32|wallpaper64|webwallpaper32|livelywpf|lively|wallpaperengine|ui32)$/i, 'papel-de-parede', 'Papel de parede animado', 'Papel de parede animado usa a placa de vídeo. No Wallpaper Engine, "pausar quando outro app estiver em tela cheia" resolve.'),
    K(/^(vmmem|vmmemwsl|vmwp|vmcompute|com\.docker\.backend|docker desktop|com\.docker\.service|virtualboxvm|vboxsvc|vmware-vmx|vmware-authd|qemu-system-x86_64|wslservice)$/i, 'virtualizacao', 'Máquina virtual, WSL ou Docker', 'Uma máquina virtual (WSL, Docker ou outra) reserva memória e processador. Feche-a antes de jogar (no WSL: "wsl --shutdown").'),
    K(/^(lenovovantageservice|lenovo\.modern\.imcontroller|supportassist\w*|dellsupportassist\w*|hpsupportassistant|hptouchpointanalyticsclient|hpanalytics\w*|acerquickaccess|dragoncenter|msi_dragon_center|omen\w*|alienware\w*|samsungmagician|myasus|asussystemanalysis|asus_framework|asusswitch|acerservice)$/i, 'fabricante', 'Utilitário do fabricante', 'Utilitários do fabricante procuram atualizações e coletam diagnóstico em segundo plano. Os que só servem para isso dá para tirar da inicialização.', { goto: 'optimize' }),
    K(/^(killernetworkservice|killeranalyticsservice|killer\w*|rivet\w*|smartbytenetworkservice\w*|smartbyte\w*|cfosspeed\w*|exitlag|noping|wtfast)$/i, 'rede', 'Gerenciador de rede', 'Gerenciadores de rede (Killer, SmartByte, cFosSpeed) priorizam tráfego por conta própria e às vezes atrapalham mais do que ajudam. Se o ping varia, vale testar sem ele.'),
    K(/^(adobearm|adobeupdateservice|adobe desktop service|creative cloud|ccxprocess|cclibrary|coresync|googleupdate|microsoftedgeupdate|officeclicktorun|jusched|jucheck|ccleaner\w*|bravecrashhandler\w*|operaautoupdate|update|updater)$/i, 'atualizador', 'Atualizador de programa', 'Atualizadores automáticos baixam e instalam em segundo plano. Se aparecem sempre, dá para tirar da inicialização.', { goto: 'optimize' }),
    K(/^(utorrent|bittorrent|qbittorrent|transmission-qt|deluge|tixati|frostwire|vuze|idman|jdownloader\w*|motrix)$/i, 'download', 'Download ou torrent', 'Downloads e torrents ocupam o disco e a internet (e sobem o ping). Pausar durante o jogo resolve.'),
    K(/^(xmrig|nicehash\w*|nbminer|t-rex|lolminer|phoenixminer|gminer|teamredminer|ethminer|minerd|cpuminer\w*)$/i, 'mineracao', 'Mineração de criptomoeda', 'Um programa de mineração está usando o PC. Se você não instalou, passe o antivírus.'),
    K(/^(spotify|itunes|applemusic|deezer|tidal|vlc|mpc-hc64|potplayermini64|mpv)$/i, 'midia', 'Música ou vídeo', 'Tocar música pesa pouco; vídeo em alta resolução usa o decodificador da placa.'),
    K(/^(code|devenv|idea64|pycharm64|webstorm64|rider64|clion64|studio64|node|java|python|pythonw|dotnet|msbuild|cargo|rustc|gradle\w*)$/i, 'desenvolvimento', 'Ferramenta de desenvolvimento', 'Ferramentas de programação e compilação podem continuar trabalhando em segundo plano.')
  ];
  // Serviços dentro de svchost: o nome do serviço diz quem é (o processo sozinho não diz nada).
  const SERVICES = [
    [/^(wuauserv|usosvc|waasmedicsvc|bits|trustedinstaller)$/i, 'atualizacao', 'Windows Update', 'O Windows está baixando ou instalando atualizações. Deixe terminar e reinicie.'],
    [/^dosvc$/i, 'atualizacao', 'Otimização de Entrega', 'A Otimização de Entrega também ENVIA atualizações para outros PCs pela sua internet. Dá para limitar em Configurações > Windows Update > Opções avançadas > Otimização de Entrega.'],
    [/^sysmain$/i, 'manutencao', 'SysMain (pré-carregamento)', 'Pré-carrega programas na memória. Num HD pode ocupar o disco por um tempo depois de ligar o PC; num SSD costuma ser leve.'],
    [/^diagtrack$/i, 'manutencao', 'Telemetria do Windows', 'Coleta de diagnóstico do Windows. Normalmente leve; picos são curtos.'],
    [/^(wsearch)$/i, 'indexacao', 'Indexação da pesquisa do Windows', 'O Windows está catalogando arquivos para a busca.'],
    [/^(xblauthmanager|xboxnetapisvc|xblgamesave|gamingservices)$/i, 'launcher', 'Serviços do Xbox', null]
  ];

  /**
   * Papel de um processo. `info` = { pid, name, path, window }; `ctx` = { selfPids: Set, probePid, services: Map,
   * match(path) → jogo da biblioteca, gpu3d: % de 3D medido, classify(info) → { isGame } (detecção da sessão) }.
   */
  function classifyProcess(info, ctx = {}) {
    const name = base(info?.name);
    const lower = name.toLowerCase();
    const pid = Number(info?.pid) || 0;
    if ((ctx.selfPids && ctx.selfPids.has(pid)) || pid === ctx.probePid || /^nexo(\b|[ .-])/i.test(name) || /^presentmon/i.test(name)) return { role: 'self', label: 'Nexo (esta análise)' };
    if (ANTICHEAT.test(name)) return { role: 'anticheat', label: friendly(name) };
    if (LAUNCHERS.test(name) || (lower === 'agent' && /battle\.net/i.test(String(info?.path || '')))) return { role: 'launcher', label: friendly(name) };
    const libraryGame = info?.path && ctx.match ? ctx.match(info.path) : null;
    if (libraryGame && libraryGame.kind !== 'app') return { role: 'game', label: libraryGame.name || name };
    // Programas conhecidos (inclusive "apps" da Steam, como o Wallpaper Engine) não podem virar "o jogo" só por
    // estarem numa pasta de jogos.
    const knownBackground = BACKGROUND.find((entry) => entry.re.test(name));
    const steamApp = libraryGame?.kind === 'app';
    if (KNOWN_GAMES.test(name) || SHIPPING.test(name)) {
      if (lower === 'javaw' || lower === 'minecraft' || lower === 'discovery') { if ((ctx.gpu3d || 0) >= 10 && info?.window) return { role: 'game', label: lower === 'javaw' ? 'Minecraft (Java) ou outro jogo em Java' : friendly(name) }; }
      else return { role: 'game', label: friendly(name) };
    }
    if (ctx.classify && !knownBackground && !steamApp) {
      const verdict = ctx.classify({ name, path: info?.path || null, fullscreen: false });
      if (verdict?.isGame) return { role: 'game', label: name };
    }
    // Sem caminho (anticheat protege) mas com janela e usando a placa em 3D: é o jogo.
    if (!info?.path && info?.window && (ctx.gpu3d || 0) >= 25 && !SYSTEM.test(name) && !knownBackground) return { role: 'game', label: name, guessed: true };
    if (lower === 'svchost') {
      const names = (ctx.services && ctx.services.get(pid)) || [];
      for (const [re, kind, label, tip] of SERVICES) {
        if (names.some((service) => re.test(service))) return kind === 'launcher' ? { role: 'launcher', label } : { role: 'background', kind, label, tip, services: names.slice(0, 6) };
      }
      return { role: 'system', label: names.length ? `Serviço do Windows (${names.slice(0, 3).join(', ')})` : 'Serviço do Windows', services: names.slice(0, 6), svchost: true };
    }
    if (SYSTEM.test(name)) return { role: 'system', label: SYSTEM_WATCH[lower]?.label || name, watch: SYSTEM_WATCH[lower] || null };
    const known = knownBackground;
    if (known) return { role: 'background', kind: known.kind, label: known.label, tip: known.tip, protect: Boolean(known.protect), settings: known.settings || null, goto: known.goto || null, known: true };
    return { role: 'background', kind: 'desconhecido', label: name, tip: null, known: false };
  }

  /* ======================================================================================================
   * Observação: do que roda por trás
   * ==================================================================================================== */
  const PRESENCE_KINDS = new Set(['gravacao', 'rgb', 'audio', 'overlay', 'papel-de-parede', 'virtualizacao', 'mineracao', 'download']);

  /**
   * Junta as leituras (a primeira é aquecimento do contador e é descartada) por programa e classifica cada um.
   * `procs` = Map pid → { name, path, window }; `ticks` = leituras já saneadas.
   */
  function summarizeObservation({ ticks = [], procs = new Map(), services = new Map(), probePid = null, selfPids = new Set(), match = null, classify = null, cores = null, memoryTotalBytes = null } = {}) {
    const samples = ticks.filter((tick) => tick && tick.kind === 'tick' && tick.i !== 0);
    const n = samples.length;
    const byPid = new Map();
    const gpuByPid = new Map();
    for (const tick of samples) {
      for (const row of tick.procs || []) {
        const entry = byPid.get(row.pid) || { cpu: [], io: [], mem: 0, present: 0 };
        entry.cpu.push(row.cpu); entry.io.push(row.io); entry.mem = Math.max(entry.mem, row.mem || 0); entry.present += 1;
        byPid.set(row.pid, entry);
      }
      for (const row of tick.gpu || []) {
        const entry = gpuByPid.get(row.pid) || { util: [], d3: [], engines: new Map() };
        entry.util.push(row.util); entry.d3.push(finite(row.d3) ? row.d3 : 0);
        if (row.engine) entry.engines.set(row.engine, (entry.engines.get(row.engine) || 0) + row.util);
        gpuByPid.set(row.pid, entry);
      }
    }
    const programs = new Map();
    const pids = new Set([...byPid.keys(), ...gpuByPid.keys()]);
    for (const pid of pids) {
      const info = procs.get(pid) || { name: `PID ${pid}`, path: null, window: false };
      const cpuRows = byPid.get(pid);
      const gpuRows = gpuByPid.get(pid);
      const gpu3d = gpuRows ? max(gpuRows.d3) || 0 : 0;
      const role = classifyProcess({ ...info, pid }, { selfPids, probePid, services, match, classify, gpu3d });
      const key = role.svchost ? `svchost:${role.label}` : `${role.role}:${role.kind || ''}:${role.label}`.toLowerCase();
      const program = programs.get(key) || { key, name: base(info.name), label: role.label, role: role.role, kind: role.kind || null, tip: role.tip || null, protect: Boolean(role.protect), settings: role.settings || null, goto: role.goto || null, watch: role.watch || null, known: role.known !== false, guessed: Boolean(role.guessed), services: role.services || null, count: 0, cpuSeries: new Array(n).fill(0), ioSeries: new Array(n).fill(0), gpuSeries: new Array(n).fill(0), mem: 0, engine: null, present: 0 };
      program.count += 1;
      program.mem += cpuRows ? cpuRows.mem : 0;
      program.present = Math.max(program.present, cpuRows ? cpuRows.present : 0, gpuRows ? gpuRows.util.length : 0);
      programs.set(key, program);
    }
    // Séries alinhadas por leitura (somando os processos do mesmo programa, como o Gerenciador de Tarefas).
    samples.forEach((tick, index) => {
      const sumBy = new Map();
      for (const row of tick.procs || []) {
        const info = procs.get(row.pid) || { name: `PID ${row.pid}`, path: null, window: false };
        const gpu3d = gpuByPid.get(row.pid) ? max(gpuByPid.get(row.pid).d3) || 0 : 0;
        const role = classifyProcess({ ...info, pid: row.pid }, { selfPids, probePid, services, match, classify, gpu3d });
        const key = role.svchost ? `svchost:${role.label}` : `${role.role}:${role.kind || ''}:${role.label}`.toLowerCase();
        const acc = sumBy.get(key) || { cpu: 0, io: 0, gpu: 0 };
        acc.cpu += row.cpu; acc.io += row.io;
        sumBy.set(key, acc);
      }
      for (const row of tick.gpu || []) {
        const info = procs.get(row.pid) || { name: `PID ${row.pid}`, path: null, window: false };
        const role = classifyProcess({ ...info, pid: row.pid }, { selfPids, probePid, services, match, classify, gpu3d: max(gpuByPid.get(row.pid)?.d3 || []) || 0 });
        const key = role.svchost ? `svchost:${role.label}` : `${role.role}:${role.kind || ''}:${role.label}`.toLowerCase();
        const acc = sumBy.get(key) || { cpu: 0, io: 0, gpu: 0 };
        acc.gpu = Math.min(100, acc.gpu + row.util);
        sumBy.set(key, acc);
      }
      for (const [key, acc] of sumBy) {
        const program = programs.get(key);
        if (!program) continue;
        program.cpuSeries[index] = Math.min(100, acc.cpu);
        program.ioSeries[index] = acc.io;
        program.gpuSeries[index] = acc.gpu;
      }
    });
    for (const [pid, rows] of gpuByPid) {
      const info = procs.get(pid);
      if (!info) continue;
      const top = [...rows.engines.entries()].sort((a, b) => b[1] - a[1])[0];
      for (const program of programs.values()) if (program.name === base(info.name) && top) program.engine = top[0];
    }
    const list = [...programs.values()].map((program) => {
      const cpuAvg = n ? program.cpuSeries.reduce((a, b) => a + b, 0) / n : 0;
      const ioAvg = n ? program.ioSeries.reduce((a, b) => a + b, 0) / n : 0;
      const gpuAvg = n ? program.gpuSeries.reduce((a, b) => a + b, 0) / n : 0;
      const cpuPeak = Math.max(0, ...program.cpuSeries);
      const lastPeak = n >= 2 ? Math.max(program.cpuSeries[n - 1], program.cpuSeries[n - 2]) : 0;
      return { ...program, cpuAvg: round(cpuAvg, 1), cpuPeak: round(cpuPeak, 1), ioAvg: Math.round(ioAvg), ioPeak: Math.round(Math.max(0, ...program.ioSeries)), gpuAvg: round(gpuAvg, 1), gpuPeak: round(Math.max(0, ...program.gpuSeries), 1), memBytes: program.mem, spiky: cpuPeak >= 15 && cpuAvg < cpuPeak / 3, recentSpike: lastPeak >= 15 && lastPeak > cpuAvg * 3 };
    });
    for (const program of list) program.impact = impactOf(program, memoryTotalBytes);
    const totals = (pick) => samples.map(pick);
    const system = {
      cpuAvg: avg(totals((tick) => tick.cpu?.total)), cpuPeak: max(totals((tick) => tick.cpu?.total)),
      dpcAvg: avg(totals((tick) => tick.cpu?.dpc)), dpcPeak: max(totals((tick) => tick.cpu?.dpc)), irqAvg: avg(totals((tick) => tick.cpu?.irq)), irqPeak: max(totals((tick) => tick.cpu?.irq)),
      maxFreqAvg: avg(totals((tick) => tick.cpu?.maxFreq)), perfLimitPeak: max(totals((tick) => tick.cpu?.limit)),
      hardFaultsAvg: avg(totals((tick) => tick.mem?.hardFaults)), hardFaultsPeak: max(totals((tick) => tick.mem?.hardFaults)), availMBMin: min(totals((tick) => tick.mem?.availMB)),
      commitPct: max(samples.map((tick) => (tick.mem?.commit && tick.mem?.limit ? (tick.mem.commit / tick.mem.limit) * 100 : null))),
      diskBusyAvg: avg(totals((tick) => tick.disk?.busy)), diskBusyPeak: max(totals((tick) => tick.disk?.busy)), diskQueueAvg: avg(totals((tick) => tick.disk?.queue)),
      queueAvg: avg(totals((tick) => tick.sys?.queue)), psi: null
    };
    const seconds = samples.length >= 2 ? Math.round((samples[samples.length - 1].t - samples[0].t) / 1000) + 3 : samples.length * 3;
    const role = (name) => list.filter((program) => program.role === name).sort((a, b) => b.cpuAvg + b.gpuAvg - (a.cpuAvg + a.gpuAvg));
    const background = list.filter((program) => program.role === 'background' || (program.role === 'system' && program.watch && (program.cpuAvg >= program.watch.cpu || (program.watch.gpu && program.gpuAvg >= program.watch.gpu))))
      .filter((program) => program.impact !== 'nenhum').sort((a, b) => score(b) - score(a));
    const self = list.filter((program) => program.role === 'self').reduce((acc, program) => ({ cpuAvg: round(acc.cpuAvg + program.cpuAvg, 1), memBytes: acc.memBytes + program.memBytes }), { cpuAvg: 0, memBytes: 0 });
    // O processador "dos outros": o total menos o que a própria medição do Nexo usou.
    system.cpuOthersAvg = finite(system.cpuAvg) ? round(Math.max(0, system.cpuAvg - self.cpuAvg), 1) : null;
    return {
      seconds, samples: n, cores, system, games: role('game'), launchers: role('launcher'), anticheat: role('anticheat'), self,
      background: background.slice(0, 12).map(publicProgram), quietCount: list.filter((program) => program.role === 'background' && program.impact === 'nenhum').length
    };
  }
  const score = (program) => program.cpuAvg * 2 + program.cpuPeak * 0.3 + program.gpuAvg * 1.5 + program.ioAvg / MB + (program.impact === 'presenca' ? 1 : 0);
  function impactOf(program, memoryTotalBytes) {
    if (program.role === 'self' || program.role === 'game' || program.role === 'launcher' || program.role === 'anticheat') return 'nenhum';
    if (program.cpuAvg >= 8 || program.ioAvg >= 20 * MB || program.gpuAvg >= 15) return 'alto';
    if (program.cpuAvg >= 3 || program.cpuPeak >= 20 || program.ioAvg >= 4 * MB || program.gpuAvg >= 5) return 'medio';
    if (program.cpuAvg >= 1 || program.gpuAvg >= 2 || program.ioAvg >= MB) return 'baixo';
    const bigMemory = memoryTotalBytes ? program.memBytes >= Math.max(1.5 * 1024 * MB, memoryTotalBytes * 0.12) : program.memBytes >= 2 * 1024 * MB;
    if (bigMemory) return 'memoria';
    if (PRESENCE_KINDS.has(program.kind)) return 'presenca';
    return 'nenhum';
  }
  const publicProgram = (program) => ({
    name: program.name, label: program.label, role: program.role, kind: program.kind, tip: program.tip, protect: program.protect, settings: program.settings, goto: program.goto,
    known: program.known, count: program.count, cpuAvg: program.cpuAvg, cpuPeak: program.cpuPeak, ioAvg: program.ioAvg, gpuAvg: program.gpuAvg, gpuPeak: program.gpuPeak,
    memBytes: program.memBytes, engine: program.engine, impact: program.impact, spiky: program.spiky, services: program.services
  });

  /** Mais tempo quando um pico acabou de aparecer (para confirmar que não foi um instante) — no máximo 2 vezes. */
  function needsMoreTime(ticks, extensions = 0) {
    if (extensions >= 2) return null;
    const samples = ticks.filter((tick) => tick && tick.kind === 'tick' && tick.i !== 0);
    if (samples.length < 4) return null;
    const last = samples.slice(-2);
    const before = samples.slice(0, -2);
    const cpuBefore = avg(before.map((tick) => tick.cpu?.total)) || 0;
    const cpuNow = max(last.map((tick) => tick.cpu?.total)) || 0;
    if (cpuNow >= 30 && cpuNow > cpuBefore * 2) return 'o processador subiu agora; observando mais um pouco para ver quem foi';
    const dpcNow = max(last.map((tick) => tick.cpu?.dpc)) || 0;
    if (dpcNow >= 6 && dpcNow > (avg(before.map((tick) => tick.cpu?.dpc)) || 0) * 3) return 'apareceu um pico de interrupções (DPC); confirmando se ele se repete';
    const diskNow = max(last.map((tick) => tick.disk?.busy)) || 0;
    if (diskNow >= 85 && diskNow > (avg(before.map((tick) => tick.disk?.busy)) || 0) * 2) return 'o disco ficou ocupado agora; vendo quem está usando';
    return null;
  }

  /* ======================================================================================================
   * Teste de carga
   * ==================================================================================================== */
  const isLimitSensor = (name) => /warning|critical|limit|threshold|shutdown|t\s*j\s*max|distance/i.test(String(name || ''));
  function cpuSensors(snapshot) {
    const devices = (snapshot?.devices || []).filter((device) => device.type === 'Cpu');
    const sensors = devices.flatMap((device) => device.sensors || []);
    const temps = sensors.filter((sensor) => sensor.type === 'Temperature' && !isLimitSensor(sensor.name) && finite(sensor.value) && sensor.value > 5 && sensor.value < 125);
    const pkg = temps.find((sensor) => /package|tctl|tdie|core max|cpu$/i.test(sensor.name)) || null;
    const power = sensors.find((sensor) => sensor.type === 'Power' && /package/i.test(sensor.name) && finite(sensor.value));
    const clocks = sensors.filter((sensor) => sensor.type === 'Clock' && /core #?\d+|p-core|e-core/i.test(sensor.name) && finite(sensor.value) && sensor.value > 100);
    return { temp: pkg ? pkg.value : max(temps.map((sensor) => sensor.value)), powerW: power ? power.value : null, clockAvg: avg(clocks.map((sensor) => sensor.value)), clockMax: max(clocks.map((sensor) => sensor.value)) };
  }
  function gpuSensors(snapshot) {
    const devices = (snapshot?.devices || []).filter((device) => /^Gpu/.test(device.type));
    const sensors = devices.flatMap((device) => device.sensors || []);
    const temp = sensors.find((sensor) => sensor.type === 'Temperature' && /core|gpu$/i.test(sensor.name) && !isLimitSensor(sensor.name) && finite(sensor.value));
    return { temp: temp ? temp.value : null };
  }

  /**
   * Junta o que foi medido no teste: % de desempenho por núcleo (Windows), sensores, pontuação do teste e, na placa de
   * vídeo acordada, link PCIe e motivo do clock baixo (nvidia-smi).
   */
  function summarizeLoad({ ticks = [], phases = {}, sensors = [], bench = {}, nvidia = [], links = [], idleSensors = null, platform = 'win32', linuxFreq = [] } = {}) {
    const inPhase = (name) => { const phase = phases[name]; return phase ? ticks.filter((tick) => tick.t >= phase.start && tick.t <= phase.end) : []; };
    const multi = inPhase('multi');
    const single = inPhase('single');
    const eff = (tick, pick) => (finite(tick.mhz) && tick.mhz > 0 && finite(pick) ? (tick.mhz * pick) / 100 : null);
    const multiClock = multi.map((tick) => eff(tick, avg(tick.cores.filter((core) => (core.busy || 0) >= 50).map((core) => core.perf)) ?? tick.perf));
    const singleClock = single.map((tick) => eff(tick, max(tick.cores.map((core) => core.perf))));
    const third = Math.max(1, Math.floor(multiClock.length / 3));
    const start = avg(multiClock.slice(0, third));
    const end = avg(multiClock.slice(-third));
    const loadSensors = sensors.filter((entry) => entry.phase === 'multi' || entry.phase === 'single').map((entry) => cpuSensors(entry.snapshot));
    const gpuLoadSensors = sensors.filter((entry) => entry.phase === 'gpu').map((entry) => gpuSensors(entry.snapshot));
    const idle = idleSensors ? cpuSensors(idleSensors) : null;
    const nv = nvidia.find((row) => row && finite(row.pcieGen)) || nvidia[0] || null;
    let linuxClock = null;
    if (platform === 'linux' && linuxFreq.length) linuxClock = { multi: avg(linuxFreq.filter((row) => row.phase === 'multi').flatMap((row) => row.values.map((value) => value.mhz))), maxMhz: max(linuxFreq.flatMap((row) => row.values.map((value) => value.maxMhz))) };
    return {
      multiSeconds: phases.multi ? Math.round((phases.multi.end - phases.multi.start) / 1000) : null,
      bench: { single: finite(bench.single) ? round(bench.single, 1) : null, multi: finite(bench.multi) ? round(bench.multi, 1) : null, threads: bench.threads || null },
      clock: {
        allCoreMHz: finite(avg(multiClock)) ? Math.round(avg(multiClock)) : linuxClock?.multi ? Math.round(linuxClock.multi) : null,
        singleMHz: finite(avg(singleClock)) ? Math.round(avg(singleClock)) : null,
        startMHz: finite(start) ? Math.round(start) : null, endMHz: finite(end) ? Math.round(end) : null,
        dropPct: finite(start) && finite(end) && start > 0 ? round(Math.max(0, (1 - end / start) * 100), 1) : null,
        sensorAvgMHz: finite(avg(loadSensors.map((entry) => entry.clockAvg))) ? Math.round(avg(loadSensors.map((entry) => entry.clockAvg))) : null
      },
      limits: { maxFreqMin: min(multi.map((tick) => tick.maxFreq)), maxFreqAvg: avg(multi.map((tick) => tick.maxFreq)), perfLimitPeak: max(multi.map((tick) => tick.limit)), flags: max(multi.map((tick) => tick.flags)) },
      temps: { cpuIdle: idle?.temp ?? null, cpuPeak: max(loadSensors.map((entry) => entry.temp)), cpuPowerPeak: max(loadSensors.map((entry) => entry.powerW)), gpuPeak: max([...gpuLoadSensors.map((entry) => entry.temp), ...nvidia.map((row) => row?.temp)]) },
      gpu: nv ? { pcieGen: nv.pcieGen ?? null, pcieGenMax: nv.pcieGenMax ?? null, pcieGenHostMax: nv.pcieGenHostMax ?? null, pcieWidth: nv.pcieWidth ?? null, pcieWidthMax: nv.pcieWidthMax ?? null, clockMHz: nv.clock ?? null, clockMaxMHz: nv.clockMax ?? null, powerW: nv.power ?? null, powerLimitW: nv.powerLimit ?? null, limits: nv.limits || null, bar1MB: nv.bar1MB ?? null, vramMB: nv.vramMB ?? null } : null,
      links: links.filter((item) => item.link)
    };
  }

  /* ======================================================================================================
   * Achados
   * ==================================================================================================== */
  const SEVERITY_ORDER = { alta: 0, media: 1, baixa: 2, info: 3, ok: 4 };
  const F = (id, area, severity, title, detail, { evidence = [], confidence = 'alta', action = null, gain = null } = {}) => ({ id, area, severity, title, detail, evidence: evidence.filter(Boolean), confidence, action, gain });
  const POWER_SAVER = 'a1841308-3541-4fab-bc81-f71556f20b4a';
  const OVERLAY_EFFICIENCY = '961cc777-2547-4f9d-8174-7d86181b8a7a';
  const GPU_DRIVER_MODULES = /^(nvwgf2umx|nvwgf2um|nvoglv64|nvd3dumx|nvlddmkm|atiumd64|atidxx64|amdxx64|amdvlk64|atig6pxx|igd10iumd64|igd12umd64|igxelpicd64|igc64)\.dll$/i;
  const TDR_VENDOR = { nvlddmkm: 'NVIDIA', amdkmdag: 'AMD', atikmdag: 'AMD', atikmpag: 'AMD', igdkmd64: 'Intel', igdkmdn64: 'Intel', igdkmdnd64: 'Intel' };

  function virtualFindings(profile, add) {
    if (profile.virtual) add(F('maquina-virtual', 'processador', 'info', 'Rodando numa máquina virtual', 'As peças que o sistema mostra são virtuais (disco, vídeo e rede da máquina virtual). Conselhos sobre peças ficam de fora; o que roda por trás e o teste de carga continuam valendo.', { evidence: [[profile.system?.maker, profile.system?.model].filter(Boolean).join(' ') || 'hipervisor detectado'] }));
  }

  function memoryFindings(profile, health, add) {
    const memory = profile.memory || {};
    const chipset = profile.board?.chipset || null;
    const cpu = profile.cpu || {};
    const total = memory.totalBytes || health?.memory?.totalKB * 1024 || null;
    const gb = total ? total / 1024 ** 3 : null;
    const laptop = profile.kind === 'laptop' || profile.kind === 'handheld';
    if (gb !== null && gb < 7.5) add(F('mem-pouca', 'memoria', 'alta', `Pouca memória: ${Hardware.gbText(total)}`, 'Com menos de 8 GB, o Windows e um navegador já ocupam quase tudo; o jogo passa a disputar memória e o PC usa o disco como memória (bem mais lento).', { evidence: [`${Hardware.gbText(total)} no total`], action: { how: memory.freeSlots ? `Há ${plural(memory.freeSlots, 'slot livre', 'slots livres')}: um pente do mesmo tipo (${memory.type || 'DDR'}) resolve.` : 'Aumentar a memória é a melhoria de maior efeito aqui.' } }));
    else if (gb !== null && gb < 15) add(F('mem-8gb', 'memoria', 'media', `${Hardware.gbText(total)} de memória: o mínimo para jogos atuais`, 'Jogos lançados de 2023 para cá costumam pedir 16 GB. Com 8 GB, fechar o navegador e apps de chat antes de jogar faz diferença.', { evidence: [`${Hardware.gbText(total)} no total`], confidence: 'media', action: { how: memory.freeSlots ? `Há ${plural(memory.freeSlots, 'slot livre', 'slots livres')} para mais um pente.` : 'Ao trocar, prefira 2 pentes iguais (dual channel).' } }));
    if (memory.layout === 'single') {
      add(F('mem-canal-unico', 'memoria', 'media', 'Memória em canal único', `Com ${memory.modules.length === 1 ? 'um pente só' : 'esta configuração'}, a memória trabalha com metade da largura. Em jogos que dependem do processador a perda costuma ficar entre 10% e 20%; com vídeo integrado pode passar de 30%.`, {
        evidence: [Hardware.memoryLine(memory), memory.slots ? `${memory.slots} slots, ${plural(memory.freeSlots ?? 0, 'livre', 'livres')}` : null], gain: 'estimativa, varia por jogo',
        action: { how: memory.freeSlots ? 'Coloque um segundo pente IGUAL (mesmo modelo e capacidade). Em placas com 4 slots, o manual indica a dupla certa, quase sempre A2 e B2.' : laptop ? 'Neste notebook não há slot livre informado; se a memória for soldada, não dá para mudar.' : 'Troque por 2 pentes iguais com a mesma capacidade total.' }
      }));
    } else if (memory.layout === 'same-channel') {
      add(F('mem-mesmo-canal', 'memoria', 'alta', 'Os pentes parecem estar no mesmo canal', `Os slots informados (${memory.modules.map((module) => module.slot).filter(Boolean).join(', ')}) pertencem ao mesmo canal, então a memória pode estar rodando como canal único mesmo com ${memory.modules.length} pentes.`, {
        evidence: memory.modules.map((module) => `${module.slot || '?'}${module.bank ? ' (' + module.bank + ')' : ''}: ${Hardware.gbText(module.capacityBytes)}`), confidence: 'media',
        action: { how: 'Com o PC desligado e fora da tomada, mova um dos pentes para o outro canal. O manual da placa indica os slots certos para dois pentes (quase sempre A2 e B2).' }
      }));
    } else if (memory.layout === 'dual' || memory.layout === 'quad') add(F('mem-canais-ok', 'memoria', 'ok', memory.layout === 'quad' ? 'Memória em quatro canais' : 'Memória em dual channel', null));
    if (memory.layout === 'single-by-design') add(F('mem-canal-projeto', 'memoria', 'info', 'Memória em canal único por projeto', 'Este processador tem só um canal de memória; não é defeito nem configuração.', { evidence: [Hardware.cpuLine(cpu)] }));

    if (memory.configured && memory.rated && memory.belowRated) {
      const kit = memory.modules.find((module) => module.ratedSource === 'código do pente' && module.jedec === false);
      const locked = chipset && chipset.memOc === false;
      const profileName = cpu.vendor === 'AMD' ? (cpu.socket === 'AM5' ? 'EXPO (ou XMP)' : 'XMP (DOCP/A-XMP na BIOS de algumas placas)') : 'XMP';
      if (kit && !locked && !laptop) {
        add(F('mem-xmp', 'memoria', 'media', `Memória abaixo da velocidade da caixa: ${memory.configured} em vez de ${memory.rated}`, `${memory.modules.length > 1 ? 'Os pentes são vendidos' : 'O pente é vendido'} para ${memory.rated}${memory.cl ? ' CL' + memory.cl : ''}, mas está rodando no padrão de fábrica (${memory.configured}). Isso acontece quando o perfil ${profileName} não está ligado na BIOS.`, {
          evidence: [`${kit.part} → ${kit.rated} pelo código do pente`, `rodando a ${memory.configured}`, chipset ? `chipset ${chipset.id}: aceita perfil de memória` : null],
          gain: cpu.vendor === 'AMD' ? 'processadores Ryzen ganham mais que a média com memória mais rápida' : 'ganho típico de alguns % a mais de 10% em jogos que dependem do processador',
          action: { how: `Na BIOS, ligue o perfil ${profileName} e salve. Se o PC não ligar ou travar depois, volte a BIOS ao padrão (o perfil fica desligado de novo).${cpu.vendor === 'AMD' && cpu.socket === 'AM4' && memory.rated > 3600 ? ' Em Ryzen AM4, até 3600 com FCLK 1800 costuma ser o ponto ideal.' : ''}${cpu.socket === 'AM5' && memory.rated > 6400 ? ' Em AM5, 6000 a 6400 costuma ser o ponto ideal.' : ''}` }
        }));
      } else if (kit && locked) {
        add(F('mem-travada', 'memoria', 'info', `A placa trava a memória em ${memory.configured}`, `O pente aceita ${memory.rated}, mas o chipset ${chipset.id} não libera velocidade de memória acima da oficial do processador. Não é defeito: ligar XMP não muda nada aqui.`, { evidence: [`chipset ${chipset.vendor} ${chipset.id}`, chipset.note] }));
      } else if (!kit && memory.modules.some((module) => module.spd && module.configured && module.configured < module.spd - 50)) {
        add(F('mem-abaixo-padrao', 'memoria', 'baixa', `Memória abaixo até do padrão: ${memory.configured} de ${memory.rated}`, 'A memória roda abaixo da velocidade padrão dela. Costuma ser limite do processador ou da placa (comum em Intel até a 10ª geração com chipset H/B), mistura de pentes diferentes ou 4 pentes DDR5.', { evidence: [Hardware.memoryLine(memory), chipset?.note], confidence: 'media' }));
      }
    } else if (memory.configured && memory.rated && memory.xmpKnown && !memory.belowRated) add(F('mem-velocidade-ok', 'memoria', 'ok', `Memória na velocidade da caixa (${memory.configured})`, null));
    if (memory.mixed && memory.modules.length >= 2) add(F('mem-misturada', 'memoria', 'baixa', 'Pentes de memória diferentes', 'Com pentes diferentes, a placa usa a velocidade e as latências do mais lento, e o perfil XMP/EXPO às vezes não fica estável.', { evidence: memory.modules.map((module) => `${module.slot || '?'}: ${Hardware.gbText(module.capacityBytes)} ${module.part || ''}`.trim()), confidence: 'media' }));
    const pagefile = health?.pagefile;
    if (pagefile && !pagefile.automatic && !(pagefile.files || []).length && gb !== null && gb <= 32) add(F('mem-sem-paginacao', 'memoria', 'media', 'Arquivo de paginação desligado', 'Sem arquivo de paginação, quando a memória enche o jogo ou o Windows fecham programas de repente (ou dão erro de "memória insuficiente"), mesmo com memória sobrando para outras coisas.', { evidence: [`${Hardware.gbText(total)} de memória, sem paginação`], action: { how: 'Painel de Controle > Sistema > Configurações avançadas > Desempenho > Avançado > Memória virtual: marque "Gerenciar automaticamente".' } }));
  }

  function videoFindings(profile, facts, load, add) {
    const gpus = profile.gpus || [];
    const discrete = gpus.filter((gpu) => gpu.discrete);
    const desktop = profile.kind === 'desktop' || profile.kind === 'aio' || profile.kind === 'minipc' || profile.kind === null;
    for (const gpu of gpus.filter((item) => item.basicDriver)) add(F('gpu-sem-driver', 'video', 'alta', 'Placa de vídeo sem driver', 'O Windows está usando o "Adaptador de Vídeo Básico": sem aceleração de verdade, jogos rodam muito mal ou nem abrem.', { evidence: [gpu.name], action: { how: 'Instale o driver do site do fabricante da placa (NVIDIA, AMD ou Intel) ou pelo Windows Update.', settings: 'windowsupdate' } }));
    for (const display of profile.displays || []) {
      if (profile.os?.platform !== 'linux' && display.hz && display.maxHz && display.maxHz - display.hz >= 10) {
        add(F(`tela-hz-${display.name || display.adapter || 'monitor'}`, 'video', 'alta', `Monitor a ${display.hz} Hz, mas ele aceita ${display.maxHz} Hz`, `${display.name || 'O monitor'} está configurado abaixo da taxa máxima dele${display.width ? ' em ' + display.width + '×' + display.height : ''}. Você vê no máximo ${display.hz} quadros por segundo, por mais FPS que o jogo faça.`, {
          evidence: [Hardware.displayLine(display), display.output ? `ligado por ${display.output}` : null],
          action: { how: `Configurações > Sistema > Tela > Tela avançada > "Escolher uma taxa de atualização" e escolha ${display.maxHz} Hz.${display.output === 'HDMI' ? ' Se a opção não aparecer, o cabo HDMI pode ser antigo; DisplayPort costuma liberar a taxa máxima.' : ''}`, settings: 'display' }
        }));
      } else if (display.hz && display.maxHz && display.hz >= display.maxHz - 2 && display.hz >= 100) add(F(`tela-hz-ok-${display.name || 'monitor'}`, 'video', 'ok', `Monitor na taxa máxima (${display.hz} Hz)`, null));
      if (desktop && discrete.length && display.onIntegrated && !display.internal) {
        add(F('tela-placa-mae', 'video', 'alta', 'O monitor está ligado na placa-mãe', `${display.name || 'O monitor'} está na saída do vídeo integrado (${display.adapter}), não na ${discrete[0].name}. O jogo pode até usar a placa dedicada, mas cada quadro faz uma volta a mais e perde desempenho (ou roda todo no vídeo integrado).`, {
          evidence: [`monitor ligado em: ${display.adapter}`, `placa dedicada: ${discrete[0].name}`], action: { how: 'Passe o cabo do monitor para uma saída da placa de vídeo (as que ficam mais embaixo, na horizontal, atrás do gabinete).' }
        }));
      }
    }
    if ((profile.kind === 'laptop' || profile.kind === 'handheld') && discrete.length && gpus.some((gpu) => gpu.integrated)) add(F('gpu-hibrida', 'video', 'info', 'Notebook com duas placas de vídeo', `O Windows escolhe a placa por programa. Confira se os jogos usam a ${discrete[0].name}, e não o vídeo integrado.`, { evidence: gpus.map((gpu) => gpu.name), action: { how: 'Configurações > Sistema > Tela > Elementos gráficos: escolha o jogo e marque "Alto desempenho". Ligado na tomada, a placa dedicada rende bem mais.', settings: 'graphics' } }));
    for (const gpu of discrete) {
      const linkInfo = (load?.links || []).find((item) => item.name === gpu.name)?.link || gpu.link;
      const nv = gpu.vendor === 'NVIDIA' ? load?.gpu : null;
      // "Máximo" é o da PRÓPRIA placa (capacidade do dispositivo); o "max" do nvidia-smi já vem limitado pelo slot.
      const width = nv?.pcieWidth ?? linkInfo?.width ?? null;
      const maxWidth = linkInfo?.maxWidth ?? null;
      if (desktop && width && maxWidth && width < maxWidth) {
        add(F('gpu-linhas', 'video', 'alta', `Placa de vídeo usando x${width} de x${maxWidth}`, `A ${gpu.name} está com menos linhas PCIe do que suporta. Causas comuns: placa no segundo slot, cabo extensor (riser), placa mal encaixada ou linhas divididas com um SSD M.2 (algumas placas-mãe fazem isso).`, {
          evidence: [`link atual: x${width}`, `a placa suporta x${maxWidth}`], confidence: 'media', gain: maxWidth >= 16 && width >= 8 ? 'perda pequena em x8; maior em x4 ou menos' : null,
          action: { how: 'Com o PC desligado, confira se a placa está no primeiro slot longo (o mais perto do processador) e bem encaixada. Se usa riser, teste sem ele.' }
        }));
      }
      // O link PCIe só é julgado com a placa acordada (clock alto no nvidia-smi) e em PC de mesa: em notebook com duas
      // placas, o despertar por WebGL roda no vídeo integrado e a dedicada continua em repouso (PCIe 1.0).
      const awake = nv ? Number.isFinite(nv.clockMHz) && Number.isFinite(nv.clockMaxMHz) && nv.clockMHz >= nv.clockMaxMHz * 0.5 : false;
      const gen = desktop && awake ? nv.pcieGen ?? null : null;
      const maxGen = nv?.pcieGenMax ?? linkInfo?.maxGen ?? null;
      const platformGen = Math.min(...[profile.cpu?.pcie, pcieOfChipset(profile.board?.chipset), nv?.pcieGenHostMax].filter(finite));
      if (gen && maxGen && gen < maxGen) {
        if (finite(platformGen) && gen >= platformGen) {
          const whyPlatform = profile.cpu?.apuPcie3 ? `O ${Hardware.cpuTitle(profile.cpu, { vendor: false })} só tem PCIe 3.0, mesmo numa placa-mãe mais nova.` : 'É o máximo deste processador/placa-mãe.';
          const widthNote = maxWidth && maxWidth <= 8 ? `Como a placa usa só x${maxWidth}, a perda é maior que o normal (até uns 10% em alguns jogos).` : 'Para placas x16 a perda costuma ser pequena.';
          add(F('gpu-pcie-plataforma', 'video', maxWidth && maxWidth <= 8 ? 'media' : 'info', `Placa de vídeo em PCIe ${gen}.0 (ela aceita ${maxGen}.0)`, `${whyPlatform} ${widthNote}`, { evidence: [`link com a placa acordada: PCIe ${gen}.0`, `a placa aceita ${maxGen}.0`], confidence: 'alta' }));
        } else {
          add(F('gpu-pcie-baixo', 'video', 'media', `Placa de vídeo em PCIe ${gen}.0 com a placa acordada (ela aceita ${maxGen}.0)`, 'Com a placa trabalhando, o link deveria subir ao máximo que a placa-mãe aceita. Pode ser opção da BIOS (velocidade do slot fixada), riser antigo ou o slot errado.', { evidence: [`medido durante o teste de vídeo: PCIe ${gen}.0`], confidence: 'media', action: { how: 'Na BIOS, procure a velocidade do slot PCIe (PCIe Speed / PEG) e deixe em "Auto". Se usa riser, teste sem ele.' } }));
        }
      }
      if (gpu.driver?.ageDays !== null && gpu.driver?.ageDays > 270 && (gpu.vendor === 'NVIDIA' || gpu.vendor === 'AMD' || gpu.family?.startsWith('Arc'))) add(F(`gpu-driver-${gpu.vendor}`, 'video', 'baixa', `Driver de vídeo de ${Math.round(gpu.driver.ageDays / 30)} meses atrás`, 'Drivers novos trazem correções e ganhos para jogos recentes. Para jogos lançados depois do seu driver, a diferença pode ser grande.', { evidence: [`${gpu.name}: driver ${gpu.driver.version ? gpu.driver.version + ' ' : ''}de ${gpu.driver.date}`], action: { how: `Atualize pelo app do fabricante (${gpu.vendor === 'NVIDIA' ? 'NVIDIA App' : gpu.vendor === 'AMD' ? 'AMD Software' : 'Intel Graphics Software'}) ou pelo site dele.` } }));
      if (gpu.legacyDriver && gpu.vendor === 'NVIDIA') add(F('gpu-legado', 'video', 'info', `${gpu.family}: fim das atualizações de driver`, 'A NVIDIA anunciou que a série 580 de drivers é a última com suporte às placas GTX 900 e GTX 10 (Maxwell e Pascal). Jogos novos podem não receber otimizações para ela.', { evidence: [gpu.name], confidence: 'media' }));
      if (gpu.needsRebar) {
        const bar = nv?.bar1MB ?? null;
        add(F('gpu-rebar-arc', 'video', 'media', 'Placa Intel Arc: confirme o Resizable BAR', 'As placas Arc dependem do Resizable BAR; sem ele, perdem bastante desempenho (a própria Intel o exige).', { evidence: [gpu.name, bar ? `BAR: ${bar} MB` : null], confidence: 'media', action: { how: 'Na BIOS: ligue "Above 4G Decoding" e "Re-Size BAR Support" (e desligue o CSM, se estiver ligado).' } }));
      } else if (gpu.vendor === 'NVIDIA' && gpu.rebarCapable && nv?.bar1MB && nv.bar1MB <= 256 && gpu.vramBytes && gpu.vramBytes > 4 * 1024 ** 3 && rebarPlatform(profile.cpu)) {
        add(F('gpu-rebar', 'video', 'baixa', 'Resizable BAR desligado', 'Com o Resizable BAR, o processador enxerga a memória de vídeo inteira de uma vez. A NVIDIA só usa em jogos que ela liberou, onde o ganho fica entre 0% e 10%.', { evidence: [`janela de memória (BAR1): ${nv.bar1MB} MB`, `memória da placa: ${Hardware.gbText(gpu.vramBytes)}`], confidence: 'alta', action: { how: 'Na BIOS: ligue "Above 4G Decoding" e "Re-Size BAR Support" (o CSM precisa estar desligado e o Windows instalado em modo UEFI).' } }));
      } else if (gpu.vendor === 'NVIDIA' && nv?.bar1MB && gpu.vramBytes && nv.bar1MB * 1024 * 1024 >= gpu.vramBytes * 0.9) add(F('gpu-rebar-ok', 'video', 'ok', 'Resizable BAR ligado', null));
      if ((gpu.family === 'GeForce RTX 40' || gpu.family === 'GeForce RTX 50') && facts && facts.hags === 1) {
        add(F('gpu-hags', 'video', 'baixa', 'Agendamento de GPU acelerado por hardware desligado', `A geração de quadros do DLSS (RTX 40 e 50) só aparece nos jogos com esta opção ligada.`, { evidence: [gpu.name, 'opção desligada no Windows'], action: { how: 'Configurações > Sistema > Tela > Elementos gráficos > Alterar configurações padrão: ligue "Agendamento de GPU acelerado por hardware" e reinicie.', settings: 'graphics' } }));
      }
    }
    if (facts && facts.historical === 1) add(F('gravacao-fundo', 'video', 'baixa', 'Gravação em segundo plano ligada', 'A Barra de Jogo grava os últimos minutos de jogo o tempo todo, usando o codificador da placa e o disco.', { evidence: ['"Gravar o que aconteceu" ligado'], action: { how: 'Configurações > Jogos > Capturas: desligue "Gravar o que aconteceu" se não usa.', settings: 'captures' } }));
    if (facts && facts.gameMode === 0) add(F('modo-jogo', 'video', 'baixa', 'Modo de Jogo do Windows desligado', 'O Modo de Jogo segura atualizações e tarefas de fundo enquanto um jogo roda.', { evidence: ['Modo de Jogo desligado'], action: { how: 'Configurações > Jogos > Modo de Jogo: ligue.', settings: 'gamemode' } }));
  }
  const pcieOfChipset = (chipset) => { const m = String(chipset?.pcie || '').match(/PCIe\s+(\d)\.0/); return m ? Number(m[1]) : null; };
  const rebarPlatform = (cpu) => (cpu?.vendor === 'Intel' && (cpu.generation >= 10 || /Ultra/.test(cpu.family || ''))) || (cpu?.vendor === 'AMD' && ['zen2', 'zen3', 'zen3+', 'zen4', 'zen5'].includes(cpu.zen));

  function diskFindings(profile, health, drives, add) {
    const linux = profile.os?.platform === 'linux';
    const systemName = linux ? 'o sistema' : 'o Windows';
    for (const disk of profile.disks || []) {
      if (disk.system && disk.kind === 'hdd' && !profile.virtual) add(F('disco-hd-sistema', 'disco', 'alta', `${linux ? 'O sistema' : 'O Windows'} está num HD (disco mecânico)`, 'Um HD é dezenas de vezes mais lento que um SSD para abrir programas e carregar jogos; o PC parece travado ao ligar, ao atualizar e quando o antivírus verifica. É a troca de maior efeito num PC assim.', { evidence: [Hardware.diskLine(disk, systemName)], action: { how: `Um SSD (mesmo SATA) com ${systemName} instalado nele muda o PC inteiro. O HD pode continuar como disco de arquivos.` } }));
      if (disk.health && !/healthy|saud/i.test(disk.health) && disk.kind !== 'usb') add(F(`disco-saude-${disk.model}`, 'disco', 'alta', `${disk.model || 'Um disco'} com aviso de saúde`, 'O próprio disco está avisando que pode falhar. Faça cópia do que importa agora.', { evidence: [`estado informado: ${disk.health}`] }));
      if (finite(disk.wear) && disk.wear >= 50) add(F(`disco-desgaste-${disk.model}`, 'disco', disk.wear >= 80 ? 'alta' : 'baixa', `${disk.model || 'SSD'} com ${disk.wear}% de desgaste`, 'SSDs têm um limite de gravação. Perto do fim, ficam lentos ou param; antes disso, dá tempo de trocar com calma.', { evidence: [`desgaste informado pelo SSD: ${disk.wear}%`] }));
    }
    const nvmeDisks = (profile.disks || []).filter((disk) => disk.kind === 'nvme');
    for (const controller of profile.nvmeControllers || []) {
      const l = controller.link;
      if (!l) continue;
      if (l.width && l.maxWidth && l.width < l.maxWidth) add(F('nvme-linhas', 'disco', 'media', `SSD NVMe usando x${l.width} de x${l.maxWidth}`, 'O SSD está num slot com menos linhas do que ele usa; a velocidade máxima cai pela metade ou mais. Em algumas placas-mãe, os slots M.2 de baixo e os do chipset são mais lentos.', { evidence: [controller.name, nvmeDisks.length === 1 ? nvmeDisks[0].model : null], confidence: 'media', action: { how: 'O manual da placa diz qual slot M.2 é o mais rápido (normalmente o de cima, ligado ao processador).' } }));
      else if (l.gen && l.maxGen && l.gen < l.maxGen) add(F('nvme-pcie', 'disco', 'info', `SSD NVMe em PCIe ${l.gen}.0 (ele aceita ${l.maxGen}.0)`, `${profile.board?.chipset?.id === 'B550' ? 'Na B550, só o primeiro slot M.2 é PCIe 4.0; os outros são 3.0.' : 'O slot ou a placa-mãe é de uma geração anterior.'} Para jogos a diferença é pequena (carregamentos um pouco mais longos); cópias grandes sentem mais.`, { evidence: [controller.name, nvmeDisks.length === 1 ? nvmeDisks[0].model : null] }));
    }
    const events = health?.events || {};
    const diskErrors = (events.disk?.count || 0) + (events.storReset?.count || 0);
    if (diskErrors > 0) add(F('disco-erros', 'disco', diskErrors >= 3 ? 'alta' : 'media', `${plural(diskErrors, 'erro de disco', 'erros de disco')} nos últimos 30 dias`, 'O Windows registrou falhas de leitura/gravação ou o controlador do disco precisou ser reiniciado. Causas: cabo SATA solto, disco falhando, energia instável ou driver.', { evidence: [events.disk?.count ? `${events.disk.count} do disco (setor ruim, erro de página ou repetição)` : null, events.storReset?.count ? `${events.storReset.count} reinícios do controlador` : null, events.disk?.last || events.storReset?.last ? `último: ${shortDate(events.disk?.last || events.storReset?.last)}` : null], action: { how: 'Faça cópia do que importa. Em SSD/HD SATA, troque o cabo de dados; depois, veja a saúde do disco em Manutenção.', goto: 'maintenance' } }));
    if (events.ntfs?.count) add(F('disco-ntfs', 'disco', 'media', 'O sistema de arquivos tem erros', 'O Windows encontrou estrutura corrompida no disco. Pode sumir arquivo ou travar programa.', { evidence: [`${events.ntfs.count} aviso(s) do NTFS`], action: { how: 'Rode a verificação de disco (chkdsk) — a Manutenção do Nexo tem o reparo do sistema.', goto: 'maintenance' } }));
    const system = (drives || []).find((drive) => drive.system) || (drives || [])[0];
    if (system && finite(system.sizeBytes) && finite(system.freeBytes) && system.sizeBytes > 0) {
      const freePct = (system.freeBytes / system.sizeBytes) * 100;
      if (freePct < 10 || system.freeBytes < 15 * 1024 ** 3) add(F('disco-cheio', 'disco', freePct < 5 ? 'alta' : 'media', `Disco do sistema quase cheio: ${mbText(system.freeBytes)} livres`, 'Com pouco espaço, atualizações falham, o arquivo de paginação não cresce e SSDs ficam mais lentos para gravar.', { evidence: [`${comma(freePct, 0)}% livre em ${system.driveLetter ? system.driveLetter + ':' : 'disco do sistema'}`], action: { how: 'A Limpeza segura do Nexo libera temporários; jogos grandes podem ir para outro disco.', goto: 'optimize' } }));
    }
  }
  const shortDate = (iso) => { const at = Date.parse(String(iso || '')); return Number.isFinite(at) ? new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null; };

  /** Saúde no Linux: erros do kernel (quando o diário é legível), unidades com falha e reinício pendente. */
  function linuxFindings(health, add) {
    const events = health.events || {};
    if (health.rebootPending?.update) add(F('reinicio-pendente', 'windows', 'media', 'O sistema está esperando reiniciar', 'Uma atualização (do kernel ou de bibliotecas) só entra em uso depois de reiniciar.', { evidence: ['/var/run/reboot-required'], action: { how: 'Reinicie quando puder.' } }));
    if (!health.journalReadable) { add(F('diario-linux', 'windows', 'info', 'O diário do kernel não pôde ser lido', 'Sem ele, erros de hardware e de disco não aparecem aqui. Em muitas distribuições, entrar no grupo "systemd-journal" (ou "adm") libera a leitura.', {})); return; }
    if (events.mce) add(F('linux-mce', 'processador', 'alta', `${plural(events.mce, 'erro de hardware', 'erros de hardware')} do processador ou da memória (MCE)`, 'O kernel registrou erros de máquina: sinal de memória/processador instáveis (overclock, XMP, undervolt) ou peça falhando.', { evidence: [`${events.mce} linha(s) no diário de 30 dias`] }));
    if (events.pcieAer) add(F('linux-aer', 'video', 'media', `${plural(events.pcieAer, 'erro', 'erros')} no barramento PCIe (AER)`, 'A comunicação com a placa de vídeo ou um SSD NVMe teve erros. Costuma ser riser, slot com poeira ou economia de energia do PCIe.', { evidence: [`${events.pcieAer} linha(s) no diário`], confidence: 'media' }));
    if (events.gpuHang) add(F('linux-gpu', 'video', 'media', `O driver de vídeo travou ${plural(events.gpuHang, 'vez', 'vezes')}`, 'O kernel registrou travamento ou tempo esgotado no driver de vídeo. Atualizar o kernel/driver (Mesa ou NVIDIA) costuma resolver.', { evidence: [`${events.gpuHang} linha(s) no diário`] }));
    if (events.diskIo) add(F('linux-disco', 'disco', 'alta', `${plural(events.diskIo, 'erro de disco', 'erros de disco')} nos últimos 30 dias`, 'Falhas de leitura/gravação ou erros do sistema de arquivos. Faça cópia do que importa e confira a saúde do disco.', { evidence: [`${events.diskIo} linha(s) no diário`] }));
    if ((health.failedUnits || []).length) add(F('linux-unidades', 'windows', 'baixa', `${plural(health.failedUnits.length, 'serviço com falha', 'serviços com falha')}`, 'Serviços do sistema que não conseguiram iniciar.', { evidence: health.failedUnits.slice(0, 5) }));
    if (!events.mce && !events.pcieAer && !events.gpuHang && !events.diskIo) add(F('estavel', 'windows', 'ok', 'Nenhum erro de hardware, de disco ou travamento do driver de vídeo em 30 dias', null));
  }

  function windowsFindings(profile, health, facts, startup, now, add) {
    if (!health) return;
    if (health.platform === 'linux') { linuxFindings(health, add); return; }
    const events = health.events || {};
    const os = profile.os || {};
    if (os.windows10) add(F('win10', 'windows', 'media', 'Windows 10 sem atualizações de segurança', 'O suporte do Windows 10 acabou em outubro de 2025 (o ESU para uso doméstico foi até outubro de 2026). Drivers e jogos novos também vão deixando de suportar.', { evidence: [os.name || os.caption], action: { how: profile.cpu?.hybrid ? 'Este processador tem núcleos P e E: o Windows 11 também distribui melhor as tarefas entre eles.' : 'Confira se este PC aceita o Windows 11 em Configurações > Windows Update.', settings: 'windowsupdate' } }));
    if (health.rebootPending?.servicing || health.rebootPending?.update) add(F('reinicio-pendente', 'windows', 'media', 'O Windows está esperando reiniciar', 'Uma atualização já foi baixada e só termina depois de reiniciar; até lá, partes dela ficam rodando em segundo plano.', { evidence: [health.rebootPending.update ? 'Windows Update pediu reinício' : 'componentes do Windows pendentes'], action: { how: 'Reinicie quando puder (Reiniciar, não Desligar).' } }));
    const boot = Date.parse(health.lastBoot || '');
    const uptimeDays = Number.isFinite(boot) ? (now - boot) / DAY : null;
    if (uptimeDays !== null && uptimeDays >= 7) add(F('tempo-ligado', 'windows', 'baixa', `${Math.floor(uptimeDays)} dias sem reiniciar de verdade`, health.fastStartup ? 'Com a "Inicialização rápida" ligada, o Desligar não reinicia o Windows de verdade: ele hiberna o sistema. Memória fragmentada, drivers e vazamentos se acumulam desde o último Reiniciar.' : 'Vazamentos de memória e drivers se acumulam com o PC muito tempo ligado.', { evidence: [`último início completo: ${shortDate(health.lastBoot)}`, health.fastStartup ? 'inicialização rápida ligada' : null], action: { how: 'Use "Reiniciar" (não Desligar) de vez em quando.' } }));
    const bugchecks = events.bugcheck?.count || 0;
    const unexpected = Math.max(0, (events.unexpected?.count || 0) - bugchecks);
    if (bugchecks > 0) add(F('tela-azul', 'windows', 'alta', `${plural(bugchecks, 'tela azul', 'telas azuis')} nos últimos 30 dias`, 'O Windows travou com erro de sistema. As causas mais comuns são driver, memória instável (XMP/overclock), temperatura ou disco.', { evidence: [`última: ${shortDate(events.bugcheck.last)}`, (health.wheaIds || []).length ? 'há erros de hardware (WHEA) no mesmo período' : null], action: { how: 'Se ligou XMP/EXPO ou overclock recentemente, teste sem. Atualize o driver de vídeo e o chipset.' } }));
    if (unexpected >= 2) add(F('desligou-sozinho', 'windows', 'media', `Desligou sem aviso ${unexpected} vezes em 30 dias`, 'O PC apagou sem desligar direito (sem tela azul). Pode ser queda de energia, fonte no limite, superaquecimento, ou alguém segurando o botão de ligar.', { evidence: [`último: ${shortDate(events.unexpected.last)}`], confidence: 'media' }));
    const whea = health.wheaIds || [];
    const corrected = whea.filter((item) => item.id === 19 || item.id === 47).reduce((sum, item) => sum + item.count, 0);
    const fatal = whea.filter((item) => item.id === 18).reduce((sum, item) => sum + item.count, 0);
    if (fatal > 0) add(F('whea-fatal', 'processador', 'alta', `${plural(fatal, 'erro fatal de hardware', 'erros fatais de hardware')} (WHEA)`, 'O processador ou a memória erraram sem conseguir corrigir: é o que causa a tela azul WHEA_UNCORRECTABLE_ERROR. Causas comuns: overclock ou XMP/EXPO instável, undervolt, temperatura, fonte no limite ou peça falhando.', { evidence: [`evento 18: ${fatal}×`], action: { how: profile.cpu?.raptorRisk ? 'Atualize a BIOS (microcódigo 0x12B ou mais novo) e teste sem XMP e sem overclock.' : 'Volte a BIOS ao padrão (sem XMP/EXPO, overclock ou undervolt) e veja se os erros param; se continuarem, teste a memória.' } }));
    const pcie = whea.filter((item) => item.id === 17).reduce((sum, item) => sum + item.count, 0);
    if (corrected > 0) {
      const raptor = profile.cpu?.raptorRisk;
      add(F('whea', 'processador', 'alta', `${plural(corrected, 'erro de hardware corrigido', 'erros de hardware corrigidos')} (WHEA)`, raptor ? 'O processador ou a memória erraram e o hardware corrigiu sozinho. Em Intel de 13ª/14ª geração isso também é sinal de desgaste por tensão alta (o problema que a Intel corrigiu por atualização de BIOS).' : 'O processador ou a memória erraram e o hardware corrigiu sozinho. Não trava na hora, mas é o primeiro sinal de instabilidade: XMP/EXPO ou overclock no limite, tensão baixa (undervolt) ou peça falhando.', { evidence: whea.map((item) => `evento ${item.id}: ${item.count}×`), action: { how: raptor ? 'Atualize a BIOS (versão de setembro de 2024 em diante, microcódigo 0x12B ou mais novo) e teste sem XMP para ver se os erros param.' : 'Se usa XMP/EXPO, overclock ou undervolt, volte ao padrão e veja se os erros param.' } }));
    }
    if (pcie > 0) add(F('whea-pcie', 'video', 'media', `${plural(pcie, 'erro corrigido', 'erros corrigidos')} no barramento PCIe`, 'A comunicação com a placa de vídeo ou um SSD NVMe teve erros (corrigidos). Costuma ser riser, slot com poeira, placa mal encaixada ou economia de energia do PCIe.', { evidence: [`evento 17: ${pcie}×`], confidence: 'media' }));
    if (events.firmwareLimit?.count) add(F('firmware-limite', 'processador', 'media', `O firmware limitou o processador ${plural(events.firmwareLimit.count, 'vez', 'vezes')}`, 'O Windows registrou que a BIOS reduziu a velocidade do processador (por calor ou energia). Em notebook, costuma ser poeira na ventoinha, pasta térmica seca ou carregador fraco.', { evidence: [`evento 37 do processador: ${events.firmwareLimit.count}×`, `último: ${shortDate(events.firmwareLimit.last)}`] }));
    if (events.tdr?.count) {
      const drivers = (health.tdrDrivers || []).map((item) => `${TDR_VENDOR[item.driver.toLowerCase().replace(/\.sys$/, '')] || item.driver}: ${item.count}×`);
      add(F('driver-video-travou', 'video', events.tdr.count >= 3 ? 'alta' : 'media', `O driver de vídeo travou e voltou ${plural(events.tdr.count, 'vez', 'vezes')}`, 'A tela piscou ou ficou preta e voltou: o Windows reiniciou o driver de vídeo porque ele parou de responder. Causas: driver com problema, overclock da placa, temperatura ou fonte.', { evidence: [...drivers, `último: ${shortDate(events.tdr.last)}`], action: { how: 'Atualize (ou reinstale limpo) o driver de vídeo. Se a placa tem overclock, teste sem.' } }));
    }
    const gpuCrashes = (health.crashes || []).filter((crash) => crash.modules.some((module) => GPU_DRIVER_MODULES.test(module)));
    if (gpuCrashes.length) add(F('crash-driver-video', 'video', 'media', `${gpuCrashes.map((crash) => crash.app).slice(0, 2).join(' e ')} fechou sozinho no driver de vídeo`, 'O programa caiu dentro do driver de vídeo. Atualizar ou reinstalar o driver costuma resolver.', { evidence: gpuCrashes.map((crash) => `${crash.app}: ${crash.count}× (${crash.modules.join(', ')})`) }));
    const otherCrashes = (health.crashes || []).filter((crash) => !gpuCrashes.includes(crash) && crash.count >= 3);
    if (otherCrashes.length) add(F('crashes', 'windows', 'baixa', `Programas que fecharam sozinhos: ${otherCrashes.slice(0, 3).map((crash) => crash.app).join(', ')}`, 'Fechamentos repetidos do mesmo programa costumam ser do próprio programa (atualizar ou reinstalar resolve).', { evidence: otherCrashes.slice(0, 4).map((crash) => `${crash.app}: ${crash.count}× (${crash.modules.join(', ') || 'módulo desconhecido'})`), confidence: 'media' }));
    for (const device of (health.problemDevices || []).slice(0, 3)) add(F(`dispositivo-${device.name}`, 'windows', device.code === 28 ? 'media' : 'baixa', `${device.name}: ${device.code === 28 ? 'sem driver' : 'com problema'}`, device.code === 28 ? 'O Windows encontrou esta peça mas não tem o driver dela; ela não está funcionando.' : `O Gerenciador de Dispositivos marca esta peça com erro (código ${device.code}).`, { evidence: [`código ${device.code}`], action: { how: 'Instale o driver do fabricante da placa-mãe/notebook (ou pelo Windows Update).', settings: 'windowsupdate' } }));
    if (health.planGuid === POWER_SAVER) add(F('plano-economia', 'energia', 'media', 'Plano de energia em "Economia"', 'O plano de economia limita a velocidade do processador o tempo todo.', { evidence: ['plano ativo: Economia de energia'], action: { how: 'Troque para Equilibrado em Otimização.', goto: 'optimize' } }));
    if (health.overlayAc === OVERLAY_EFFICIENCY && (profile.kind === 'laptop' || profile.kind === 'handheld')) add(F('modo-energia', 'energia', 'baixa', 'Modo de energia em "Melhor eficiência" na tomada', 'Na tomada, o modo de eficiência segura o processador e a placa de vídeo.', { evidence: ['modo de energia (na tomada): melhor eficiência'], action: { how: 'Configurações > Sistema > Energia: escolha "Equilibrado" ou "Melhor desempenho".', settings: 'power' } }));
    if (Array.isArray(startup) && startup.length >= 15) add(F('inicializacao', 'windows', 'baixa', `${startup.length} programas abrem junto com o Windows`, 'Cada um disputa disco e processador na hora de ligar e muitos ficam rodando depois.', { evidence: startup.slice(0, 6).map((item) => item.name), action: { how: 'Em Otimização, veja a lista e tire os que não precisa.', goto: 'optimize' } }));
    if ((events.updateFail?.count || 0) >= 3) add(F('update-falhou', 'windows', 'baixa', `Atualizações do Windows falharam ${events.updateFail.count} vezes`, 'Atualização que falha volta a baixar e tentar de novo em segundo plano.', { evidence: [`última falha: ${shortDate(events.updateFail.last)}`], action: { how: 'Configurações > Windows Update; se continuar, o reparo do sistema em Manutenção ajuda.', goto: 'maintenance' } }));
    const cpu = profile.cpu || {};
    if (cpu.dualCcdX3d && !health.vcacheService) add(F('x3d-driver', 'processador', 'media', `${cpu.model}: falta o otimizador do 3D V-Cache`, 'Neste processador só metade dos núcleos tem o cache extra. O driver de chipset da AMD instala o serviço que manda o jogo para os núcleos certos; sem ele, o jogo pode cair nos núcleos sem cache.', { evidence: ['serviço "3D V-Cache Performance Optimizer" não encontrado'], action: { how: 'Instale o "AMD Chipset Software" do site da AMD, mantenha o Modo de Jogo ligado e a Barra de Jogo do Xbox instalada e atualizada.' } }));
    if (cpu.dualCcdX3d && health.gameBar === false) add(F('x3d-gamebar', 'processador', 'baixa', 'Barra de Jogo do Xbox não instalada', `No ${cpu.model}, o Windows usa a Barra de Jogo para saber quando há um jogo aberto e escolher os núcleos com cache.`, { evidence: ['pacote Microsoft.XboxGamingOverlay ausente'], action: { how: 'Instale a "Xbox Game Bar" pela Microsoft Store.' } }));
    if (cpu.vendor === 'AMD' && /^Ryzen/.test(cpu.family || '') && cpu.segment === 'desktop' && Array.isArray(health.software) && !health.software.some((name) => /AMD Chipset Software/i.test(name))) add(F('amd-chipset', 'processador', 'baixa', 'Driver de chipset da AMD não encontrado', 'O driver de chipset traz o gerenciamento de energia afinado para Ryzen (núcleos preferidos, estados de energia). Às vezes o Windows Update instala só uma parte.', { evidence: ['"AMD Chipset Software" não aparece nos programas instalados'], confidence: 'baixa', action: { how: 'Baixe o "AMD Chipset Software" no site da AMD (ou da fabricante da placa-mãe).' } }));
    const bios = profile.board?.bios || {};
    const biosDate = Date.parse(bios.date || '');
    if (cpu.raptorRisk && Number.isFinite(biosDate) && biosDate < Date.parse('2024-09-01')) add(F('raptor-bios', 'processador', 'alta', 'BIOS antiga para este Intel de 13ª/14ª geração', `A Intel corrigiu, por atualização de BIOS, a tensão alta que desgasta o ${Hardware.cpuTitle(cpu, { vendor: false })} com o tempo (causa de travamentos e erros que só aumentam). A sua BIOS é de ${shortDate(bios.date)}/${String(bios.date).slice(0, 4)}.`, { evidence: [`BIOS ${bios.version || ''} de ${bios.date}`.trim(), Hardware.cpuLine(cpu)], action: { how: 'Atualize a BIOS pelo site da fabricante da placa-mãe para uma versão de setembro de 2024 em diante (microcódigo 0x12B ou mais novo).' } }));
    else if (cpu.socket === 'AM5' && Number.isFinite(biosDate) && biosDate < Date.parse('2023-05-01')) add(F('am5-bios', 'processador', 'media', 'BIOS AM5 anterior à correção de tensão', `As primeiras BIOS da plataforma AM5 permitiam tensão alta demais no SoC (o caso dos Ryzen 7000X3D danificados). A sua é de ${bios.date}.`, { evidence: [`BIOS ${bios.version || ''} de ${bios.date}`.trim()], action: { how: 'Atualize a BIOS pelo site da fabricante da placa-mãe.' } }));
    else if (Number.isFinite(biosDate) && now - biosDate > 4 * 365 * DAY && profile.kind === 'desktop') add(F('bios-antiga', 'processador', 'info', `BIOS de ${String(bios.date).slice(0, 4)}`, 'Atualizações de BIOS trazem correções de estabilidade, compatibilidade de memória e de processadores novos. Atualize só se tiver um motivo (instabilidade ou peça nova): o processo exige cuidado.', { evidence: [`BIOS ${bios.version || ''} de ${bios.date}`.trim()], confidence: 'media' }));
    for (const adapter of profile.network || []) {
      if (adapter.kind === 'ethernet' && adapter.up && adapter.linkMbps && adapter.linkMbps <= 100 && adapter.gigabitCapable) add(F('rede-100', 'rede', 'media', `Cabo de rede a ${adapter.linkMbps} Mb/s (a placa aceita 1 Gb/s ou mais)`, 'O link caiu para 100 Mb/s: quase sempre é cabo danificado, cabo antigo de 4 fios ou porta do roteador. Internet acima de 100 Mb/s fica limitada.', { evidence: [`${adapter.description}: ${adapter.linkMbps} Mb/s`], action: { how: 'Troque o cabo (Cat5e ou melhor) ou teste outra porta do roteador.' } }));
      if (adapter.kind === 'wifi' && adapter.up && adapter.wifi) {
        if (finite(adapter.wifi.signal) && adapter.wifi.signal < 50) add(F('wifi-sinal', 'rede', 'baixa', `Sinal do Wi-Fi fraco (${adapter.wifi.signal}%)`, 'Sinal fraco aumenta o ping e as perdas de pacote, que no jogo viram "lag".', { evidence: [`${adapter.description}: ${adapter.wifi.signal}%`, adapter.wifi.band ? `${comma(adapter.wifi.band, adapter.wifi.band === 2.4 ? 1 : 0)} GHz` : null], action: { how: 'Aproxime o PC do roteador ou use cabo; um repetidor mesh também ajuda.' } }));
        if (adapter.wifi.band === 2.4 && /ac|ax|be/.test(adapter.wifi.standard || '')) add(F('wifi-24', 'rede', 'baixa', 'Wi-Fi na faixa de 2,4 GHz', 'Sua placa aceita 5 GHz, que tem menos interferência e mais velocidade a curta distância. Em 2,4 GHz o ping varia mais.', { evidence: [`${adapter.description}: ${adapter.wifi.standard}, 2,4 GHz`], confidence: 'media', action: { how: 'Se o roteador tem uma rede de 5 GHz (às vezes com "5G" no nome), conecte nela.' } }));
      }
    }
    if (profile.battery?.wear !== null && profile.battery?.wear >= 30) add(F('bateria', 'energia', 'info', `Bateria com ${profile.battery.wear}% de desgaste`, 'A bateria segura menos carga que quando era nova. Não afeta o desempenho na tomada.', { evidence: [`capacidade atual: ${comma(profile.battery.fullWh, 0)} de ${comma(profile.battery.designWh, 0)} Wh`] }));
    if (!bugchecks && !unexpected && !corrected && !events.tdr?.count && !((events.disk?.count || 0) + (events.storReset?.count || 0))) add(F('estavel', 'windows', 'ok', 'Nenhuma tela azul, travamento de driver ou erro de disco em 30 dias', null));
  }

  function backgroundFindings(observation, profile, add) {
    if (!observation) return;
    const system = observation.system || {};
    const totalBytes = profile.memory?.totalBytes || null;
    for (const program of (observation.background || []).filter((item) => item.impact === 'alto' || item.impact === 'medio').slice(0, 6)) {
      const peak = program.cpuPeak >= program.cpuAvg * 2 && program.cpuPeak >= 10 ? ` (picos de ${Math.round(program.cpuPeak)}%)` : '';
      const engine = program.engine ? ` (${program.engine})` : '';
      const parts = [program.cpuAvg >= 1 ? `processador ${comma(program.cpuAvg, 1)}% em média${peak}` : null, program.ioAvg >= MB ? `disco ${rateText(program.ioAvg)}` : null, program.gpuAvg >= 2 ? `placa de vídeo ${comma(program.gpuAvg, 1)}%${engine}` : null].filter(Boolean);
      const suffix = program.label.toLowerCase() === program.name.toLowerCase() ? '' : ` (${program.name})`;
      const label = program.kind === 'desconhecido' ? program.name : program.label + suffix;
      add(F(`fundo-${program.name}`, 'fundo', program.impact === 'alto' ? 'alta' : 'media', `${label} pesando por trás`, program.tip || (program.kind === 'desconhecido' ? `Um programa que eu não reconheço (${program.name}) ficou usando o PC durante a observação. Se você não sabe o que é, vale olhar no Gerenciador de Tarefas.` : null), {
        evidence: [parts.join(' · '), program.count > 1 ? `${program.count} processos` : null, program.services ? `serviços: ${program.services.join(', ')}` : null],
        confidence: program.spiky ? 'media' : 'alta', action: program.protect ? null : { how: program.kind === 'desconhecido' ? 'Abra o Gerenciador de Tarefas para ver o que é.' : null, settings: program.settings || null, goto: program.goto || null, taskManager: !program.settings && !program.goto }
      }));
    }
    for (const program of (observation.background || []).filter((item) => item.impact === 'presenca' || item.impact === 'memoria').slice(0, 4)) {
      const share = totalBytes ? ` (${Math.round((program.memBytes / totalBytes) * 100)}% da memória)` : '';
      add(F(`fundo-presenca-${program.name}`, 'fundo', 'baixa', program.impact === 'memoria' ? `${program.label} ocupando ${mbText(program.memBytes)} de memória` : `${program.label} aberto em segundo plano`, program.tip, { evidence: [program.impact === 'memoria' ? mbText(program.memBytes) + share : 'pouco uso agora, mas é o tipo de programa que pesa durante o jogo'], confidence: 'media', action: program.protect ? null : { settings: program.settings || null, goto: program.goto || null } }));
    }
    if (finite(system.dpcAvg) && (system.dpcAvg >= 2.5 || (system.dpcPeak || 0) >= 8)) add(F('dpc', 'fundo', system.dpcAvg >= 5 ? 'alta' : 'media', 'Drivers interrompendo o processador (latência de DPC)', 'Uma parte do tempo do processador vai para chamadas adiadas de drivers (DPC). Em excesso, causa engasgos, estalos no áudio e travadinhas mesmo com FPS alto. Os culpados mais comuns: rede/Wi-Fi, som, USB e software de RGB.', { evidence: [`DPC: ${comma(system.dpcAvg, 1)}% em média, picos de ${comma(system.dpcPeak || 0, 1)}%`, finite(system.irqAvg) ? `interrupções: ${comma(system.irqAvg, 1)}%` : null], confidence: 'media', action: { how: 'Atualize os drivers de rede, som e chipset. Para achar o driver exato, o LatencyMon (gratuito) mostra qual demora mais.' } }));
    const total = totalBytes ? totalBytes / MB : null;
    if (finite(system.hardFaultsAvg) && system.hardFaultsAvg >= 300 && finite(system.availMBMin) && (system.availMBMin < 1024 || (total && system.availMBMin < total * 0.1))) add(F('memoria-acabando', 'memoria', 'alta', 'A memória está acabando agora', 'O Windows está lendo do disco o que deveria estar na memória (falhas de página). Isso causa travadas de meio segundo ou mais.', { evidence: [`${Math.round(system.hardFaultsAvg)} leituras do disco por segundo para a memória`, `menor memória livre: ${Math.round(system.availMBMin)} MB`] }));
    if (finite(system.commitPct) && system.commitPct >= 90) add(F('memoria-virtual', 'memoria', 'media', `Memória virtual em ${Math.round(system.commitPct)}%`, 'Quase todo o espaço de memória (RAM + paginação) está reservado; o próximo programa grande pode falhar ao abrir.', { evidence: [`${Math.round(system.commitPct)}% do limite`] }));
    if (finite(system.diskBusyAvg) && system.diskBusyAvg >= 70) {
      const top = (observation.background || []).slice().sort((a, b) => b.ioAvg - a.ioAvg)[0];
      add(F('disco-ocupado', 'disco', 'media', `Disco ocupado ${Math.round(system.diskBusyAvg)}% do tempo`, 'Com o disco sempre ocupado, abrir qualquer coisa e carregar o jogo fica lento.', { evidence: [top && top.ioAvg >= MB ? `mais quem usa: ${top.label} (${rateText(top.ioAvg)})` : null, finite(system.diskQueueAvg) ? `fila média: ${comma(system.diskQueueAvg, 1)}` : null] }));
    }
    const others = finite(system.cpuOthersAvg) ? system.cpuOthersAvg : system.cpuAvg;
    if (finite(others) && others >= 25 && !(observation.games || []).length) add(F('pc-ocupado', 'fundo', 'media', `Processador em ${Math.round(others)}% sem nenhum jogo aberto`, 'Parado, um PC saudável fica abaixo de 10%. O que está pesando aparece na lista "por trás".', { evidence: [`média de ${Math.round(others)}% durante ${observation.seconds} s, sem contar a medição do Nexo`] }));
    if (!(observation.background || []).some((item) => item.impact === 'alto' || item.impact === 'medio') && !(finite(system.dpcAvg) && system.dpcAvg >= 2.5)) add(F('fundo-limpo', 'fundo', 'ok', 'Nada pesando por trás', null));
  }

  /** Limite de temperatura (TjMax): Intel 100 °C; Ryzen 95 °C, menos os de desktop Zen 2/3 com 8 núcleos ou mais (90 °C). */
  function tjMaxOf(cpu) {
    const c = cpu || {};
    if (c.vendor !== 'AMD') return 100;
    return c.segment === 'desktop' && ['zen2', 'zen3'].includes(c.zen) && !c.apuPcie3 && (c.cores || 0) >= 8 ? 90 : 95;
  }

  function loadFindings(load, profile, facts, onBattery, add) {
    if (!load) return;
    const cpu = profile.cpu || {};
    const laptop = profile.kind === 'laptop' || profile.kind === 'handheld';
    const tj = tjMaxOf(cpu);
    const peak = load.temps?.cpuPeak;
    const drop = load.clock?.dropPct;
    if (finite(peak)) {
      if (peak >= tj - 3 && finite(drop) && drop >= 8) add(F('cpu-freio-calor', 'processador', 'alta', `Processador freando por calor (${Math.round(peak)} °C)`, `Em ${load.multiSeconds || 12} segundos de carga, o processador chegou perto do limite (${tj} °C) e o clock caiu ${comma(drop, 0)}%. Em jogo, isso vira FPS caindo depois de alguns minutos.`, { evidence: [`${Math.round(peak)} °C no pico`, `clock: ${load.clock.startMHz} → ${load.clock.endMHz} MHz`], action: { how: laptop ? 'Limpe as saídas de ar e use o notebook numa superfície dura; se ele já tem alguns anos, trocar a pasta térmica resolve muito.' : 'Confira se o cooler está bem preso e girando, a pasta térmica e o fluxo de ar do gabinete.' } }));
      else if (peak >= tj - 3 && !(['zen4', 'zen5'].includes(cpu.zen) && cpu.segment === 'desktop')) add(F('cpu-quente', 'processador', 'media', `Processador chega a ${Math.round(peak)} °C em carga`, `Está perto do limite dele (${tj} °C). Por enquanto o clock segurou, mas em sessões longas pode frear.`, { evidence: [`${Math.round(peak)} °C no pico`, finite(load.temps.cpuIdle) ? `${Math.round(load.temps.cpuIdle)} °C parado` : null], confidence: 'media' }));
      else if (['zen4', 'zen5'].includes(cpu.zen) && cpu.segment === 'desktop' && peak >= 85) add(F('cpu-zen4-95', 'processador', 'info', `${Math.round(peak)} °C em carga: normal neste Ryzen`, `Os Ryzen 7000 e 9000 de desktop sobem até 95 °C de propósito para acelerar mais; isso não é defeito.`, { evidence: [`${Math.round(peak)} °C no pico`] }));
      else if (peak < tj - 15) add(F('cpu-temp-ok', 'processador', 'ok', `Temperatura do processador sob carga: ${Math.round(peak)} °C`, null));
    }
    const limits = load.limits || {};
    if (finite(limits.maxFreqAvg) && limits.maxFreqAvg < 97) add(F('cpu-limitado', 'processador', 'media', `Processador limitado a ${Math.round(limits.maxFreqAvg)}% da frequência máxima`, onBattery ? 'Na bateria, o Windows e o notebook seguram o processador para economizar. Para jogar, use na tomada.' : 'Durante o teste, o Windows ou a BIOS seguraram a velocidade máxima do processador (plano de energia com "estado máximo" abaixo de 100%, limite de energia ou calor).', { evidence: [`frequência máxima permitida: ${Math.round(limits.maxFreqAvg)}% em média`, finite(limits.perfLimitPeak) && limits.perfLimitPeak > 0 ? `limite de desempenho de até ${Math.round(limits.perfLimitPeak)}%` : null, onBattery ? 'na bateria durante a análise' : null], confidence: 'media', action: onBattery ? null : { how: 'Em Otimização, confira o plano de energia; o laboratório mede as opções escondidas dele.', goto: 'optimize' } }));
    else if (finite(limits.perfLimitPeak) && limits.perfLimitPeak >= 10) add(F('cpu-limite-desempenho', 'processador', 'baixa', `Limite de desempenho de até ${Math.round(limits.perfLimitPeak)}% durante a carga`, 'O processador avisou que estava sendo segurado por energia, calor ou firmware em parte do teste.', { evidence: [`limite de desempenho: até ${Math.round(limits.perfLimitPeak)}%`], confidence: 'media' }));
    const gpu = load.gpu;
    if (gpu?.limits?.thermal) add(F('gpu-calor', 'video', 'media', 'Placa de vídeo freando por calor', 'O driver informou que reduziu o clock da placa por temperatura.', { evidence: [finite(gpu.clockMHz) ? `clock: ${gpu.clockMHz} de ${gpu.clockMaxMHz} MHz` : null, finite(load.temps?.gpuPeak) ? `${Math.round(load.temps.gpuPeak)} °C` : null], action: { how: 'Limpe as ventoinhas da placa e melhore o fluxo de ar do gabinete.' } }));
    if (onBattery) add(F('na-bateria', 'energia', 'info', 'Análise feita na bateria', 'Os números de carga e clock ficam menores na bateria. Para comparar com as próximas análises, rode na tomada.', {}));
  }

  /** Compara com a análise anterior do mesmo PC: pontuação, temperatura, achados que sumiram e peças trocadas. */
  function compareRuns(current, previous) {
    if (!previous || !current) return null;
    const out = { at: previous.at, changes: [], resolved: [], appeared: [] };
    if (previous.fingerprint && current.fingerprint && previous.fingerprint !== current.fingerprint) {
      const diff = [];
      for (const key of ['cpu', 'board', 'memory', 'gpu', 'disk']) if ((previous.parts?.[key] || '') !== (current.parts?.[key] || '')) diff.push({ key, before: previous.parts?.[key] || null, after: current.parts?.[key] || null });
      out.hardware = diff;
    }
    // Na bateria um notebook rende menos de propósito: comparar desempenho só entre análises nas mesmas condições.
    const comparable = Boolean(current.onBattery) === Boolean(previous.onBattery);
    const pct = (a, b) => (comparable && finite(a) && finite(b) && b > 0 ? round(((a - b) / b) * 100, 1) : null);
    const multi = pct(current.scores?.multi, previous.scores?.multi);
    const single = pct(current.scores?.single, previous.scores?.single);
    if (multi !== null) out.changes.push({ key: 'multi', label: 'Processador (todos os núcleos)', pct: multi });
    if (single !== null) out.changes.push({ key: 'single', label: 'Processador (um núcleo)', pct: single });
    if (comparable && finite(current.temps?.cpuPeak) && finite(previous.temps?.cpuPeak)) out.changes.push({ key: 'temp', label: 'Temperatura do processador em carga', delta: Math.round(current.temps.cpuPeak - previous.temps.cpuPeak) });
    const before = new Set((previous.findings || []).filter((item) => item.severity !== 'ok' && item.severity !== 'info').map((item) => item.id));
    const now = new Set((current.findings || []).filter((item) => item.severity !== 'ok' && item.severity !== 'info').map((item) => item.id));
    out.resolved = (previous.findings || []).filter((item) => before.has(item.id) && !now.has(item.id)).map((item) => item.title).slice(0, 6);
    out.appeared = (current.findings || []).filter((item) => now.has(item.id) && !before.has(item.id)).map((item) => item.title).slice(0, 6);
    return out;
  }

  function comparisonFindings(comparison, add) {
    if (!comparison) return;
    const multi = comparison.changes.find((item) => item.key === 'multi');
    const temp = comparison.changes.find((item) => item.key === 'temp');
    if (!comparison.hardware?.length && multi && multi.pct <= -10) add(F('desempenho-caiu', 'processador', 'media', `Processador ${comma(-multi.pct, 0)}% mais lento que na análise de ${shortDate(comparison.at)}`, temp && temp.delta >= 5 ? `E ${temp.delta} °C mais quente: poeira no cooler ou pasta térmica envelhecendo são o mais comum.` : 'Pode ser algo novo rodando por trás, plano de energia diferente ou o PC esquentando mais.', { evidence: [`todos os núcleos: ${comma(multi.pct, 1)}%`, temp ? `temperatura em carga: ${temp.delta >= 0 ? '+' : ''}${temp.delta} °C` : null], confidence: 'media' }));
    if (comparison.hardware?.length) add(F('peca-nova', 'processador', 'info', 'Peça trocada desde a última análise', 'O Nexo atualizou o perfil deste PC.', { evidence: comparison.hardware.map((item) => `${item.before || '—'} → ${item.after || '—'}`) }));
  }

  /** Todos os achados, do mais grave para o mais leve; "ok" ficam no fim (são o que já está certo). */
  function buildFindings({ profile = {}, health = null, facts = null, observation = null, load = null, drives = [], startup = null, comparison = null, onBattery = false, now = Date.now() } = {}) {
    const list = [];
    const seen = new Set();
    const add = (finding) => {
      if (!finding || seen.has(finding.id)) { return; }
      seen.add(finding.id);
      list.push(finding);
    };
    virtualFindings(profile, add);
    memoryFindings(profile, health, add);
    if (!profile.virtual) videoFindings(profile, facts, load, add);
    diskFindings(profile, health, drives, add);
    windowsFindings(profile, health, facts, startup, now, add);
    backgroundFindings(observation, profile, add);
    loadFindings(load, profile, facts, onBattery, add);
    comparisonFindings(comparison, add);
    return list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }

  /* ======================================================================================================
   * Plano para este PC: o que fazer na BIOS, o que o laboratório testa NESTE setup e o que acompanhar
   * ==================================================================================================== */
  const LAB_KNOBS = {
    cpu: ['perfepp', 'boostmode', 'minstate', 'incpol', 'boostpol'], hybrid: ['perfepp1', 'minstate1', 'maxstate1', 'incpol1', 'decpol1', 'heteropolicy', 'schedpolicy', 'shortschedpolicy'], parking: ['mincores'],
    cooling: ['cooling'], amd: ['amdslider'], nvme: ['nvmeidle', 'nvmeidle2', 'nvmetol', 'nvmetol2', 'nvmenoppme'], sata: ['ahcilpm', 'ahciadaptive'], aspm: ['aspm'], wifi: ['wifipower']
  };
  function plan(profile, findings = []) {
    const steps = [];
    const P = (id, kind, title, why, extra = {}) => steps.push({ id, kind, title, why, ...extra });
    const cpu = profile.cpu || {};
    const memory = profile.memory || {};
    const chip = profile.board?.chipset || null;
    const laptop = profile.kind === 'laptop' || profile.kind === 'handheld';
    const windows = profile.os?.platform !== 'linux';
    const has = (id) => findings.some((item) => item.id === id);
    const cpuName = Hardware.cpuTitle(cpu, { vendor: false }) || 'este processador';
    if (!profile.virtual) {
      if (has('mem-xmp')) {
        const kit = memory.rated ? 'Os pentes são de ' + memory.rated : 'A memória é mais rápida do que está rodando';
        P('bios-xmp', 'bios', `Ligar o perfil ${cpu.socket === 'AM5' ? 'EXPO' : 'XMP'} da memória`, `${kit} e ${chip ? 'a ' + chip.id : 'a placa'} aceita.`);
      }
      const gpu = (profile.gpus || []).find((item) => item.discrete && item.rebarCapable);
      if (gpu && !laptop && (has('gpu-rebar') || has('gpu-rebar-arc') || !has('gpu-rebar-ok'))) P('bios-rebar', 'bios', 'Conferir o Resizable BAR', `A ${gpu.name} aceita${cpu.apuPcie3 ? '' : ' e a plataforma também'}; na BIOS ficam "Above 4G Decoding" e "Re-Size BAR".`, { done: has('gpu-rebar-ok') });
      const biosDate = Date.parse(profile.board?.bios?.date || '');
      if (cpu.raptorRisk) P('bios-microcode', 'bios', 'BIOS com microcódigo 0x12B ou mais novo', `Protege o ${cpuName} do desgaste de tensão.`, { done: Number.isFinite(biosDate) && biosDate >= Date.parse('2024-09-01') });
      if (cpu.socket === 'AM5' && has('am5-bios')) P('bios-am5', 'bios', 'Atualizar a BIOS AM5', 'As primeiras versões permitiam tensão alta demais no SoC.');
    }
    if (windows) {
      P('lab-cpu', 'laboratorio', 'Política de energia do processador', `EPP, turbo, piso e resposta a picos: o ponto ideal muda de processador para processador. O laboratório mede no ${cpuName}.`, { knobs: LAB_KNOBS.cpu });
      if (cpu.hybrid) P('lab-hybrid', 'laboratorio', 'Núcleos de eficiência', 'Como os núcleos E entram em ação muda engasgos em jogo; o laboratório testa a política deles separada.', { knobs: LAB_KNOBS.hybrid });
      if (cpu.dualCcdX3d || (cpu.cores || 0) >= 12) P('lab-parking', 'laboratorio', 'Estacionamento de núcleos', `${cpu.dualCcdX3d ? 'No X3D de dois blocos, o estacionamento decide onde o jogo roda.' : 'Com muitos núcleos, quantos ficam acordados muda a resposta.'}`, { knobs: LAB_KNOBS.parking });
      if (laptop) P('lab-cooling', 'laboratorio', 'Política de resfriamento', 'Em notebook, reduzir o clock antes de acelerar a ventoinha pode cortar desempenho cedo.', { knobs: LAB_KNOBS.cooling });
      if (laptop && cpu.vendor === 'AMD') P('lab-amd', 'laboratorio', 'Modo de energia da AMD', 'Notebooks Ryzen têm um seletor de energia próprio além do do Windows.', { knobs: LAB_KNOBS.amd });
      const disks = profile.disks || [];
      if (disks.some((disk) => disk.kind === 'nvme')) P('lab-nvme', 'laboratorio', 'Economia de energia do SSD NVMe', 'O cochilo do SSD economiza, mas o primeiro acesso depois dele demora; o laboratório mede esse atraso.', { knobs: LAB_KNOBS.nvme });
      if (disks.some((disk) => disk.kind === 'ssd')) P('lab-sata', 'laboratorio', 'Economia de energia do SSD SATA', 'Mesma ideia no SATA (gerenciamento de energia do link).', { knobs: LAB_KNOBS.sata });
      if ((profile.gpus || []).some((gpu) => gpu.discrete) || disks.some((disk) => disk.kind === 'nvme')) P('lab-aspm', 'laboratorio', 'Economia do PCI Express (ASPM)', 'Em alguns PCs o link acordando causa engasgos; em outros não muda nada. Só medindo.', { knobs: LAB_KNOBS.aspm });
      if ((profile.network || []).some((adapter) => adapter.kind === 'wifi' && adapter.up)) P('lab-wifi', 'laboratorio', 'Economia de energia do Wi-Fi', 'Cochilos do adaptador sobem o ping e a variação dele.', { knobs: LAB_KNOBS.wifi });
    }
    P('watch-session', 'acompanhar', 'Gravar uma sessão de jogo', 'Mostra o que limita o PC no jogo de verdade (processador, um núcleo, placa de vídeo, memória) e confirma se os ajustes renderam.', { goto: 'sessions' });
    P('watch-again', 'acompanhar', 'Repetir esta análise depois de cada mudança', 'O Nexo compara com esta e mostra o que melhorou, o que piorou e se o desempenho caiu com o tempo.');
    return steps;
  }

  /* ======================================================================================================
   * Retrato em palavras: quem é este PC, o que mais segura ele hoje e o que já está certo
   * ==================================================================================================== */
  const lowerFirst = (value) => (value ? value.charAt(0).toLowerCase() + value.slice(1) : value);
  const joinPt = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`);
  function narrative(profile = {}, findings = []) {
    const cpu = profile.cpu || {};
    const memory = profile.memory || {};
    const board = profile.board || {};
    const cpuName = Hardware.cpuTitle(cpu) || 'um processador';
    const arch = [cpu.architecture, cpu.x3d ? 'com 3D V-Cache' : null, cpu.hybrid ? 'com núcleos P e E' : null].filter(Boolean).join(' ');
    const boardName = board.chipset ? `numa placa ${board.chipset.id}${board.maker ? ' da ' + board.maker : ''}` : null;
    const layout = { single: 'em canal único', dual: 'em dual channel', quad: 'em quatro canais', 'same-channel': 'com os pentes no mesmo canal' }[memory.layout] || '';
    const mem = memory.totalBytes ? [Hardware.gbText(memory.totalBytes), 'de memória', memory.type, layout].filter(Boolean).join(' ') : null;
    const gpu = (profile.gpus || []).find((item) => item.discrete) || (profile.gpus || []).find((item) => item.integrated);
    const gpuName = gpu ? (gpu.integrated ? `o vídeo integrado (${gpu.name})` : `uma ${gpu.name}`) : null;
    const kind = profile.kindLabel ? profile.kindLabel.charAt(0).toUpperCase() + profile.kindLabel.slice(1) : 'Um PC';
    const parts = [mem, gpuName].filter(Boolean);
    const identity = `${kind} com ${cpuName}${arch ? ' (' + arch + ')' : ''}${boardName ? ' ' + boardName : ''}${parts.length ? ', ' + joinPt(parts) : ''}.`;
    const serious = findings.filter((item) => item.severity === 'alta' || item.severity === 'media');
    const more = serious.length > 2 ? ' (e mais ' + (serious.length - 2) + ')' : '';
    const verdict = serious.length ? `O que mais segura ele hoje: ${joinPt(serious.slice(0, 2).map((item) => lowerFirst(item.title)))}${more}.` : 'Nada importante segurando ele agora.';
    const ok = findings.filter((item) => item.severity === 'ok').slice(0, 3).map((item) => lowerFirst(item.title));
    return { identity, verdict, good: ok.length ? `Já está certo: ${joinPt(ok)}.` : null };
  }

  /* ======================================================================================================
   * Perfil guardado (o que o Nexo aprendeu deste PC) e nota geral
   * ==================================================================================================== */
  function fingerprintOf(profile) {
    const parts = {
      cpu: profile.cpu ? [profile.cpu.vendor, profile.cpu.family, profile.cpu.model].filter(Boolean).join(' ') || profile.cpu.name || null : null,
      board: [profile.board?.maker, profile.board?.product].filter(Boolean).join(' ') || null,
      memory: profile.memory?.totalBytes ? Hardware.gbText(profile.memory.totalBytes) + (profile.memory.type ? ' ' + profile.memory.type : '') : null,
      gpu: (profile.gpus || []).filter((gpu) => gpu.discrete || gpu.integrated).map((gpu) => gpu.name).join(' + ') || null,
      disk: (profile.disks || []).filter((disk) => disk.system).map((disk) => disk.model).join(' + ') || null
    };
    return { parts, fingerprint: [parts.cpu, parts.board, parts.gpu].join('|').toLowerCase() };
  }

  /** Resumo compacto de uma análise para o histórico (sem caminhos, sem nomes de usuário). */
  function runRecord({ at, durationMs, profile, load, findings, observation, onBattery = false }) {
    const { parts, fingerprint } = fingerprintOf(profile || {});
    return {
      at, durationMs, fingerprint, parts, onBattery: Boolean(onBattery),
      scores: { single: load?.bench?.single ?? null, multi: load?.bench?.multi ?? null },
      temps: { cpuPeak: load?.temps?.cpuPeak ?? null, gpuPeak: load?.temps?.gpuPeak ?? null },
      clock: { allCore: load?.clock?.allCoreMHz ?? null, single: load?.clock?.singleMHz ?? null },
      background: (observation?.background || []).filter((item) => item.impact === 'alto' || item.impact === 'medio').slice(0, 5).map((item) => item.label),
      findings: (findings || []).map((item) => ({ id: item.id, severity: item.severity, title: item.title }))
    };
  }

  /** Nota de 0 a 100 só para orientar: cada problema tira pontos conforme a gravidade e a confiança. */
  function healthScore(findings) {
    const weight = { alta: 14, media: 7, baixa: 3, info: 0, ok: 0 };
    const trust = { alta: 1, media: 0.75, baixa: 0.5 };
    const lost = (findings || []).reduce((sum, item) => sum + (weight[item.severity] || 0) * (trust[item.confidence] || 1), 0);
    return Math.max(5, Math.min(100, Math.round(100 - lost)));
  }

  return { NODES, STAGES, MIN_TOTAL_MS, plan, narrative, LAB_KNOBS, classifyProcess, summarizeObservation, needsMoreTime, summarizeLoad, cpuSensors, buildFindings, compareRuns, runRecord, fingerprintOf, healthScore, BACKGROUND, SEVERITY_ORDER, impactOf, tjMaxOf };
});
