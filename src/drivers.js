/*
 * Página de Drivers: as regras (puras). Recebe o que o processo principal leu (drivers por dispositivo, componentes dos
 * jogos, placa/notebook e as versões mais recentes das fontes oficiais) e monta os grupos e os cartões da página:
 * nome, para que serve, versão instalada e a mais recente, o estado e o botão para o site oficial certo.
 *  - Nunca Windows Update: o botão sempre abre o site do fabricante (ou o permalink oficial da Microsoft).
 *  - Sem a versão mais recente (fabricante sem consulta pública, ou sem internet), o estado vem da idade do driver.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendors.js'));
  else root.NexoDrivers = factory(root.NexoVendors);
})(typeof self !== 'undefined' ? self : this, function (Vendors) {
  const DAY = 24 * 3600 * 1000;
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const monthText = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(String(iso || '')); return m ? `${MONTHS[Number(m[2]) - 1]}/${m[1]}` : null; };
  const ageDays = (iso, now) => { const at = Date.parse(String(iso || '')); return Number.isFinite(at) ? Math.max(0, Math.round((now - at) / DAY)) : null; };
  /** Compara versões com pontos ("566.14" < "621.14", "14.44.35211" > "14.38"). */
  function compare(a, b) {
    const pa = String(a || '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
    const pb = String(b || '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
    return 0;
  }
  /** Versão do Windows do driver NVIDIA (32.0.15.6614) → versão que a NVIDIA divulga (566.14). */
  function nvidiaVersion(win) {
    const parts = String(win || '').split('.');
    if (parts.length < 4) return null;
    const digits = `${parts[2]}${parts[3]}`.replace(/\D/g, '').slice(-5);
    return digits.length === 5 ? `${digits.slice(0, 3)}.${digits.slice(3)}` : null;
  }
  const nvidiaLine = (name) => {
    const n = String(name || '');
    if (!/nvidia|geforce|quadro|rtx|gtx|titan|tesla/i.test(n)) return null;
    if (/quadro|tesla|\bRTX\s?A\d{3,4}\b|\bRTX\s?\d{4}\s?Ada\b|\bRTX PRO\b|NVIDIA T\d{3,4}\b|NVIDIA A\d{2,3}\b/i.test(n)) return 'pro';
    if (/\bGT\s?6\d\d\b|\bGT\s?7[1-4]0\b|\bGTX\s?(6\d\d|7[6-9]0)\b|GTX TITAN( Black| Z)?$/i.test(n)) return 'ended';
    if (/\bGTX\s?(9\d\d|10[5-8]0)\b|\bGTX\s?(745|750)\b|TITAN Xp?\b|\bGT\s?1030\b|\bMX\s?[1-3]\d0\b/i.test(n)) return 'legacy';
    return 'modern';
  };

  /* ---------------- Sites oficiais ---------------- */
  const PAGES = {
    nvidia: 'https://www.nvidia.com/pt-br/drivers/',
    amd: 'https://www.amd.com/pt/support/download/drivers.html',
    intel: 'https://www.intel.com/content/www/br/pt/support/detect.html',
    realtek: 'https://www.realtek.com/Download/Overview',
    vc64: 'https://aka.ms/vc14/vc_redist.x64.exe',
    vc86: 'https://aka.ms/vc14/vc_redist.x86.exe',
    vcOld: 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist',
    directx: 'https://www.microsoft.com/download/details.aspx?id=35',
    netfx: 'https://dotnet.microsoft.com/download/dotnet-framework',
    dotnet: (channel) => `https://dotnet.microsoft.com/download/dotnet/${channel}`
  };
  /** Página de suporte do notebook ou da placa-mãe (drivers de chipset, áudio, rede e Bluetooth feitos para ela). */
  const SUPPORT = [
    [/asus|asustek|republic of gamers/i, 'ASUS', 'https://www.asus.com/br/support/download-center/'],
    [/micro-star|\bmsi\b/i, 'MSI', 'https://br.msi.com/support'],
    [/gigabyte|aorus/i, 'GIGABYTE', 'https://www.gigabyte.com/br/Support'],
    [/asrock/i, 'ASRock', 'https://www.asrock.com/support/index.asp'],
    [/biostar/i, 'BIOSTAR', 'https://www.biostar.com.tw/'],
    [/dell|alienware/i, 'Dell', 'https://www.dell.com/support/home/pt-br'],
    [/lenovo/i, 'Lenovo', 'https://pcsupport.lenovo.com/br/pt/'],
    [/hewlett|^hp\b|\bhp inc/i, 'HP', 'https://support.hp.com/br-pt/drivers'],
    [/acer|predator/i, 'Acer', 'https://www.acer.com/br-pt/support'],
    [/samsung/i, 'Samsung', 'https://www.samsung.com/br/support/'],
    [/positivo/i, 'Positivo', 'https://www.positivotecnologia.com.br/'],
    [/avell/i, 'Avell', 'https://avell.com.br/'],
    [/^lg\b|lg electronics/i, 'LG', 'https://www.lg.com/br/suporte/'],
    [/microsoft/i, 'Microsoft', 'https://support.microsoft.com/surface']
  ];
  const GENERIC_MAKER = /^(system manufacturer|to be filled by o\.?e\.?m\.?|default string|o\.?e\.?m\.?|not applicable|none|\s*)$/i;
  const clean = (value) => (GENERIC_MAKER.test(String(value || '')) ? '' : String(value || '').trim());
  function supportPage(board = {}) {
    const system = clean(board.systemMaker);
    const find = (name) => (name ? SUPPORT.find(([re]) => re.test(name)) : null);
    // PC de marca ou notebook: a página do modelo do computador. PC montado: a da placa-mãe.
    const oem = system && !SUPPORT.slice(0, 5).some(([re]) => re.test(system)) ? find(system) : null;
    if (board.mobile || oem) {
      const hit = find(system) || find(board.maker);
      if (hit) return { maker: hit[1], brand: BRAND_OF[hit[1]] || null, url: hit[2], model: clean(board.model) || clean(board.product) || null, kind: board.mobile ? 'notebook' : 'computador' };
    }
    const hit = find(board.maker) || find(system);
    return hit ? { maker: hit[1], brand: BRAND_OF[hit[1]] || null, url: hit[2], model: clean(board.product) || clean(board.model) || null, kind: 'placa-mãe' } : null;
  }
  /** Fabricante do chip pelo nome ou pelo código PCI/USB. */
  function chipMaker(item) {
    const text = `${item.name || ''} ${item.maker || ''} ${item.provider || ''}`;
    const ven = String(item.ids || '').split(':')[0];
    if (/nvidia/i.test(text) || ven === '10DE') return 'NVIDIA';
    if (/\bamd\b|advanced micro|radeon|ati /i.test(text) || ven === '1002' || ven === '1022') return 'AMD';
    if (/intel|killer/i.test(text) || ven === '8086' || ven === '8087') return 'Intel';
    if (/realtek/i.test(text) || ven === '10EC' || ven === '0BDA') return 'Realtek';
    if (/qualcomm|atheros/i.test(text) || ven === '168C' || ven === '17CB') return 'Qualcomm';
    if (/mediatek|ralink/i.test(text) || ven === '14C3' || ven === '0E8D') return 'MediaTek';
    if (/broadcom/i.test(text) || ven === '14E4') return 'Broadcom';
    if (/marvell|aquantia/i.test(text) || ven === '1D6A') return 'Marvell';
    return null;
  }

  /* ---------------- Grupos ---------------- */
  const GROUPS = [
    { id: 'video', title: 'Vídeo', icon: 'i-gpu', hint: 'O driver que mais mexe no FPS: cada versão traz ajustes para os jogos novos.' },
    { id: 'rede', title: 'Rede', icon: 'i-net', hint: 'Cabo e Wi-Fi. Driver velho aqui vira queda de conexão e ping oscilando.' },
    { id: 'audio', title: 'Áudio', icon: 'i-sound', hint: 'Driver de áudio antigo às vezes causa estalos e atraso no som.' },
    { id: 'placa', title: 'Placa-mãe e chipset', icon: 'i-board', hint: 'Como o processador conversa com o resto da placa, e a energia de cada parte.' },
    { id: 'disco', title: 'Armazenamento', icon: 'i-disk', hint: 'Os controladores dos SSDs e HDs.' },
    { id: 'bluetooth', title: 'Bluetooth', icon: 'i-bt', hint: 'Driver novo costuma melhorar o alcance e cortar menos o som dos fones.' },
    { id: 'semdriver', title: 'Sem driver ou com erro', icon: 'i-alert', hint: 'Dispositivos que o Windows não conseguiu ligar direito.' },
    { id: 'jogos', title: 'O que os jogos usam', icon: 'i-game', hint: 'Componentes da Microsoft e dos fabricantes que os jogos pedem para abrir.' },
    { id: 'outros', title: 'Todos os outros dispositivos', icon: 'i-driver', hint: 'Mouse, teclado, controles, câmeras, USB, impressoras e o resto: cada um com o driver de quem fez.' }
  ];
  const VIRTUAL_GPU = /basic display|basic render|remote|virtual|parsec|spacedesk|idd|meta virtual|citrix|vmware|hyper-v|duet|displaylink/i;
  const VIRTUAL_NET = /wan miniport|hyper-v|virtual|vpn|tap-|\btap\b|wintun|wireguard|bluetooth device|loopback|kernel debug|teredo|isatap|6to4|npcap|virtualbox|vmware|zerotier|tailscale|hamachi|radmin|openvpn|fortinet|anyconnect|wi-fi direct|microsoft/i;
  const PHYSICAL_NET = /realtek|intel|killer|rivet|mediatek|qualcomm|atheros|broadcom|marvell|aquantia|ralink|tp-link|asus|d-link|netgear|wi-?fi|ethernet|wireless|gbe|lan/i;
  const VIRTUAL_AUDIO = /virtual|nvidia high definition|nvidia virtual|amd high definition|display audio|steam streaming|voicemeeter|vb-audio|nahimic mirroring|sonic studio virtual|oculus|discord|broadcast/i;
  const isWifi = (name) => /wi-?fi|wireless|wlan|802\.11|\b(ax|be)\d{3}\b|\bac \d{4}\b|killer.*1[5-7]\d\d|centrino/i.test(name || '');

  /* ---------------- Cartões ---------------- */
  // Ícone oficial de cada fabricante: a chave que o processo principal usa para buscar no site oficial dele.
  const BRAND_OF = { NVIDIA: 'nvidia', AMD: 'amd', Intel: 'intel', Realtek: 'realtek', Qualcomm: 'qualcomm', MediaTek: 'mediatek', Broadcom: 'broadcom', Marvell: 'marvell', Microsoft: 'microsoft', Khronos: 'vulkan',
    ASUS: 'asus', MSI: 'msi', GIGABYTE: 'gigabyte', ASRock: 'asrock', BIOSTAR: 'biostar', Dell: 'dell', Lenovo: 'lenovo', HP: 'hp', Acer: 'acer', Samsung: 'samsung', Positivo: 'positivo', Avell: 'avell', LG: 'lg' };
  /** Quem fez o driver (o provedor do pacote): a chave do ícone oficial e o site do fabricante. */
  const vendorOf = (item) => (Vendors && item ? Vendors.vendorOf(item) : null);
  function card(base) {
    return { id: base.id, icon: base.icon, brand: base.brand || vendorOf(base.source)?.key || BRAND_OF[base.maker] || null, name: base.name, maker: base.maker || null, purpose: base.purpose, installed: base.installed || null, latest: base.latest || null, state: base.state, note: base.note || null, action: base.action || null, extra: base.extra || null, sourceName: base.source?.name || null, plain: base.plain === true };
  }
  // Drivers que vêm com o Windows têm a data fixa de 21/06/2006: mostrar "jun/2006" assustaria à toa.
  const installedOf = (item) => { const inbox = /^2006-06-21/.test(item.date || ''); return { version: item.version || null, date: inbox ? null : item.date || null, month: inbox ? null : monthText(item.date) }; };
  /** Estado pela idade, quando o fabricante não tem consulta pública da versão mais recente. */
  function byAge(item, now, oldDays) {
    const age = ageDays(item.date, now);
    if (age !== null && age > oldDays) return { state: 'old', note: `Instalado em ${monthText(item.date)}: provavelmente há versão mais nova.` };
    return { state: 'check', note: null };
  }

  function videoCards(devices, runtimes, latest, now, support) {
    const gpus = devices.filter((item) => item.cls === 'DISPLAY');
    const real = gpus.filter((item) => !VIRTUAL_GPU.test(item.name));
    const out = [];
    for (const item of real) {
      const maker = chipMaker(item);
      const mobile = runtimes?.board?.mobile === true;
      const integrated = /uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|arc graphics|\d{3}m graphics/i.test(item.name);
      const purpose = integrated && real.length > 1 ? 'O vídeo integrado do processador: usado na tela ligada na placa-mãe e, em notebook, quando a placa dedicada descansa.' : 'Desenha os jogos e a tela.';
      const base = { id: `video-${item.name}`, icon: 'i-gpu', name: item.name, maker, purpose, installed: installedOf(item), source: item };
      if (maker === 'NVIDIA') {
        const line = nvidiaLine(item.name);
        base.installed = { ...base.installed, version: nvidiaVersion(item.version) || item.version };
        const top = latest?.nvidia?.[line];
        if (line === 'ended') { out.push(card({ ...base, state: 'ended', note: 'A NVIDIA encerrou as atualizações desta geração de placa. O driver que você tem é o último.', action: { label: 'Site da NVIDIA', url: PAGES.nvidia } })); continue; }
        if (line === 'pro') { out.push(card({ ...base, state: 'check', note: 'Placa profissional: o driver é da linha RTX Enterprise, no site da NVIDIA.', action: { label: 'Site da NVIDIA', url: PAGES.nvidia } })); continue; }
        if (top) {
          const newer = base.installed.version && compare(top.version, base.installed.version) > 0;
          out.push(card({
            ...base, latest: { version: top.version, date: top.date, month: monthText(top.date), name: top.name }, state: newer ? 'update' : 'ok',
            note: newer ? `${top.name} de ${monthText(top.date) || 'agora'}${top.size ? `, ${top.size}` : ''}.` : null,
            // Notebook: o pacote é outro (mesmo número de versão), então abre a busca oficial em vez do pacote de desktop.
            action: { label: newer ? 'Baixar no site da NVIDIA' : 'Site da NVIDIA', url: !mobile && top.details ? top.details : PAGES.nvidia }
          }));
          continue;
        }
        out.push(card({ ...base, ...byAge(item, now, 120), action: { label: 'Site da NVIDIA', url: PAGES.nvidia } }));
      } else if (maker === 'AMD') {
        if (runtimes?.amd) base.installed = { ...base.installed, version: `Adrenalin ${runtimes.amd}` };
        const age = byAge(item, now, 150);
        out.push(card({ ...base, ...age, action: { label: 'Site da AMD', url: PAGES.amd }, note: age.note || 'A AMD não publica a versão mais recente para conferência automática; o site oficial detecta a placa.' }));
      } else if (maker === 'Intel') {
        // Vídeo integrado de notebook: muitas vezes só o driver do fabricante do notebook funciona bem.
        const age = byAge(item, now, 240);
        out.push(card({ ...base, ...age, action: mobile && support ? { label: `Suporte ${support.maker}`, url: support.url } : { label: 'Assistente da Intel', url: PAGES.intel }, note: age.note || (mobile ? 'Em notebook, prefira o driver de vídeo do site do fabricante do notebook.' : 'O assistente oficial da Intel detecta a versão certa.') }));
      } else {
        out.push(card({ ...base, ...byAge(item, now, 365), action: support ? { label: `Suporte ${support.maker}`, url: support.url } : null }));
      }
    }
    if (!real.length && gpus.length) out.push(card({ id: 'video-basico', icon: 'i-gpu', name: 'Vídeo sem driver', purpose: 'O Windows está usando o "Adaptador de Vídeo Básico": sem aceleração, jogo não roda direito.', state: 'missing', action: { label: 'Procurar o driver', url: PAGES.intel } }));
    return out;
  }

  function vendorAction(maker, support, prefer = 'support') {
    if (prefer === 'vendor' && maker === 'Intel') return { label: 'Assistente da Intel', url: PAGES.intel };
    if (support) return { label: `Suporte ${support.maker}`, url: support.url };
    if (maker === 'Intel') return { label: 'Assistente da Intel', url: PAGES.intel };
    if (maker === 'AMD') return { label: 'Site da AMD', url: PAGES.amd };
    if (maker === 'Realtek') return { label: 'Site da Realtek', url: PAGES.realtek };
    return null;
  }

  function netCards(devices, now, support) {
    return devices.filter((item) => item.cls === 'NET' && (!VIRTUAL_NET.test(item.name) || /intel|realtek|killer|qualcomm|mediatek|broadcom/i.test(item.name)) && PHYSICAL_NET.test(item.name)).map((item) => {
      const maker = chipMaker(item);
      const wifi = isWifi(item.name);
      const generic = /^microsoft/i.test(item.provider || '') && maker;
      const base = { id: `rede-${item.name}`, icon: wifi ? 'i-wifi' : 'i-lan', source: item, name: item.name, maker, purpose: wifi ? 'Conexão sem fio (Wi-Fi).' : 'Conexão por cabo.', installed: installedOf(item) };
      // Intel publica os drivers de Wi-Fi/Bluetooth/LAN genéricos (servem em qualquer PC); os outros, o fabricante do PC.
      const action = vendorAction(maker, support, maker === 'Intel' ? 'vendor' : 'support');
      if (generic) return card({ ...base, state: 'generic', note: 'O Windows instalou um driver básico. O do fabricante costuma corrigir quedas e oscilação de ping.', action });
      return card({ ...base, ...byAge(item, now, 3 * 365), action });
    });
  }
  function audioCards(devices, now, support) {
    return devices.filter((item) => item.cls === 'MEDIA' && !VIRTUAL_AUDIO.test(item.name) && /realtek|conexant|cirrus|idt|via|creative|sound blaster|high definition audio|áudio|audio|smart sound|sonido/i.test(item.name)).slice(0, 4).map((item) => {
      const maker = chipMaker(item);
      return card({ id: `audio-${item.name}`, icon: 'i-sound', source: item, name: item.name, maker, purpose: 'Som das caixas, fones e microfone.', installed: installedOf(item), ...byAge(item, now, 4 * 365), action: vendorAction(maker, support) });
    });
  }
  function boardCards(devices, now, support) {
    const parts = devices.filter((item) => item.cls === 'SYSTEM' && /intel|amd|advanced micro/i.test(item.provider || '') && /management engine|serial io|smbus|gpio|psp|chipset|pci express root|i2c|dynamic tuning|gna|platform|pmf|ppm|uart/i.test(item.name));
    if (!parts.length) return [];
    const maker = chipMaker(parts[0]);
    const newest = [...parts].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    const action = maker === 'AMD' && support?.kind !== 'notebook' ? { label: 'Chipset no site da AMD', url: PAGES.amd } : vendorAction(maker, support);
    return [card({ id: 'placa-chipset', icon: 'i-board', source: newest, name: `Chipset ${maker || ''}`.trim(), maker, purpose: `${parts.length} ${parts.length === 1 ? 'componente' : 'componentes'} da placa (gerenciamento de energia, barramentos e sensores).`, installed: installedOf(newest), ...byAge(newest, now, 4 * 365), action, extra: parts.slice(0, 6).map((item) => item.name) })];
  }
  function diskCards(devices, now, support) {
    const list = devices.filter((item) => item.cls === 'SCSIADAPTER' || item.cls === 'HDC');
    const vendor = list.filter((item) => !/^microsoft/i.test(item.provider || '') && !/microsoft|storage spaces|virtual|iscsi/i.test(item.name));
    const out = vendor.slice(0, 3).map((item) => card({ id: `disco-${item.name}`, icon: 'i-disk', source: item, name: item.name, maker: chipMaker(item), purpose: /rst|vmd|raid|optane/i.test(item.name) ? 'Controla os discos pelo Intel RST/VMD ou RAID: sem ele o Windows nem vê o SSD.' : 'Controla os SSDs e HDs.', installed: installedOf(item), ...byAge(item, now, 4 * 365), action: vendorAction(chipMaker(item), support) }));
    if (!out.length && list.length) out.push(card({ id: 'disco-windows', icon: 'i-disk', maker: 'Microsoft', name: 'Controladores de disco do Windows', purpose: 'Os SSDs NVMe e SATA usam o driver da Microsoft, que é o recomendado para a maioria deles.', installed: installedOf(list[0]), state: 'ok' }));
    return out;
  }
  function bluetoothCards(devices, now, support) {
    return devices.filter((item) => item.cls === 'BLUETOOTH' && !/enumerator|le generic|rfcomm|device \(|microsoft|avrcp|hands-free|a2dp/i.test(item.name) && /intel|realtek|qualcomm|mediatek|broadcom|bluetooth|wireless/i.test(item.name)).slice(0, 2).map((item) => {
      const maker = chipMaker(item);
      return card({ id: `bt-${item.name}`, icon: 'i-bt', source: item, name: item.name, maker, purpose: 'Controles, fones e mouses sem fio.', installed: installedOf(item), ...byAge(item, now, 3 * 365), action: vendorAction(maker, support, maker === 'Intel' ? 'vendor' : 'support') });
    });
  }
  const PNP_CODES = { 1: 'configuração errada', 3: 'driver corrompido', 10: 'não consegue iniciar', 12: 'sem recursos livres', 14: 'precisa reiniciar', 18: 'precisa reinstalar', 19: 'registro com problema', 21: 'sendo removido', 22: 'desativado', 24: 'não encontrado', 28: 'sem driver', 31: 'driver não carrega', 37: 'driver falhou', 39: 'driver corrompido ou ausente', 43: 'o dispositivo informou um problema', 45: 'desconectado', 52: 'driver sem assinatura válida' };
  function missingCards(runtimes, support) {
    return (runtimes?.missing || []).filter((item) => item.code !== 45 && item.code !== 22).slice(0, 8).map((item) => {
      const maker = chipMaker(item);
      const none = item.code === 28;
      return card({ id: `pnp-${item.name}-${item.ids || ''}`, icon: 'i-alert', source: { ids: item.ids, name: item.name }, name: item.name, maker, purpose: none ? 'O Windows não achou driver para este dispositivo.' : `O dispositivo está com erro: ${PNP_CODES[item.code] || `código ${item.code}`}.`, state: none ? 'missing' : 'problem', note: item.ids ? `Código do hardware: ${item.ids.replace(':', ' ')}` : null, action: vendorAction(maker, support) || (support ? { label: `Suporte ${support.maker}`, url: support.url } : null) });
    });
  }

  function runtimeCards(runtimes, latest, devices) {
    if (!runtimes) return [];
    const out = [];
    const vcState = (v) => (!v ? 'missing' : compare(v.replace(/^v/i, ''), '14.40') < 0 ? 'old' : 'ok');
    for (const [arch, label, url] of [['x64', '64 bits', PAGES.vc64], ['x86', '32 bits', PAGES.vc86]]) {
      const v = runtimes.vc?.[arch];
      const state = vcState(v);
      out.push(card({ id: `vc-${arch}`, icon: 'i-box', brand: 'vs', name: `Visual C++ (${label})`, maker: 'Microsoft', purpose: `Quase todo jogo ${arch === 'x86' ? 'mais antigo ' : ''}precisa. Sem ele aparece erro de MSVCP140.dll ou VCRUNTIME140.dll.`, installed: v ? { version: v.replace(/^v/i, '') } : null, state, note: state === 'old' ? 'Versão antiga: a atual corrige falhas e é usada pelos jogos novos.' : null, action: { label: state === 'ok' ? 'Baixar da Microsoft' : 'Instalar da Microsoft', url } }));
    }
    const years = new Set((runtimes.uninstall || []).map((item) => (/Visual C\+\+ (\d{4})/i.exec(item.name) || [])[1]).filter(Boolean));
    const old = ['2005', '2008', '2010', '2012', '2013'];
    const have = old.filter((year) => years.has(year));
    out.push(card({ id: 'vc-antigos', icon: 'i-box', brand: 'vs', name: 'Visual C++ antigos (2005 a 2013)', maker: 'Microsoft', purpose: 'Jogos antigos ainda pedem estas versões. Instale só a que um jogo pedir.', installed: have.length ? { version: have.join(', ') } : null, state: have.length === old.length ? 'ok' : 'check', note: have.length < old.length ? `Faltam: ${old.filter((year) => !years.has(year)).join(', ')}.` : null, action: { label: 'Página da Microsoft', url: PAGES.vcOld } }));
    const dx = runtimes.dx || {};
    const dxOk = dx.d3dx9 && dx.xinput13;
    out.push(card({ id: 'directx9', icon: 'i-game', name: 'DirectX 9 (componentes antigos)', maker: 'Microsoft', purpose: 'O Windows já traz o DirectX 12, mas jogos mais antigos (e alguns novos) pedem peças do DirectX 9, como d3dx9_43.dll e XInput 1.3.', installed: dxOk ? { version: 'instalado' } : null, state: dxOk ? 'ok' : 'missing', note: dxOk ? null : `Falta${!dx.d3dx9 && !dx.xinput13 ? 'm d3dx9_43.dll e xinput1_3.dll' : !dx.d3dx9 ? ' d3dx9_43.dll' : ' xinput1_3.dll'}.`, action: { label: dxOk ? 'Instalador da Microsoft' : 'Instalar da Microsoft', url: PAGES.directx } }));
    // .NET (para programas, launchers e mods): o mais alto de cada versão instalada contra o índice oficial.
    const byChannel = {};
    for (const v of runtimes.desktop || []) { const channel = v.split('.').slice(0, 2).join('.'); if (!byChannel[channel] || compare(v, byChannel[channel]) > 0) byChannel[channel] = v; }
    for (const [channel, v] of Object.entries(byChannel).sort((a, b) => compare(b[0], a[0])).slice(0, 3)) {
      const info = latest?.dotnet?.[channel];
      const newer = info && compare(info.latest, v) > 0;
      const eol = info?.phase === 'eol';
      out.push(card({ id: `dotnet-${channel}`, icon: 'i-box', brand: 'dotnet', name: `.NET ${channel} Desktop Runtime`, maker: 'Microsoft', purpose: 'Programas, launchers e ferramentas de mods feitos em .NET usam.', installed: { version: v }, latest: info ? { version: info.latest } : null, state: newer ? 'update' : info ? 'ok' : 'check', note: eol ? `A Microsoft encerrou o suporte do .NET ${channel}${info.eol ? ` em ${monthText(info.eol)}` : ''}; o programa que pediu esta versão pode precisar de atualização.` : null, action: { label: newer ? 'Baixar da Microsoft' : 'Página da Microsoft', url: PAGES.dotnet(channel) } }));
    }
    if (runtimes.netfx) {
      const v = runtimes.netfx >= 533320 ? '4.8.1' : runtimes.netfx >= 528040 ? '4.8' : runtimes.netfx >= 461808 ? '4.7.2' : '4.7 ou anterior';
      out.push(card({ id: 'netfx', icon: 'i-box', brand: 'dotnet', name: '.NET Framework', maker: 'Microsoft', purpose: 'Programas mais antigos para Windows (e alguns launchers) usam.', installed: { version: v }, state: runtimes.netfx >= 528040 ? 'ok' : 'old', action: { label: 'Página da Microsoft', url: PAGES.netfx } }));
    }
    const hasGpuDriver = devices.some((item) => item.cls === 'DISPLAY' && !VIRTUAL_GPU.test(item.name));
    out.push(card({ id: 'vulkan', icon: 'i-gpu', name: 'Vulkan', maker: 'Khronos', purpose: 'Usado por vários jogos e emuladores. Vem junto com o driver de vídeo.', installed: runtimes.vulkan ? { version: runtimes.vulkan } : null, state: runtimes.vulkan ? 'ok' : hasGpuDriver ? 'check' : 'missing', note: runtimes.vulkan ? null : 'Reinstalar o driver de vídeo do fabricante traz o Vulkan de volta.' }));
    if (devices.some((item) => item.cls === 'DISPLAY' && chipMaker(item) === 'NVIDIA')) {
      const physx = (runtimes.uninstall || []).find((item) => /physx/i.test(item.name));
      out.push(card({ id: 'physx', icon: 'i-spark', name: 'PhysX', maker: 'NVIDIA', purpose: 'Física de alguns jogos (principalmente os mais antigos). Vem com o driver da NVIDIA.', installed: physx?.version ? { version: physx.version } : null, state: physx ? 'ok' : 'check', note: physx ? null : 'Não encontrado: instale o driver da NVIDIA com o PhysX marcado.', action: { label: 'Site da NVIDIA', url: PAGES.nvidia } }));
    }
    return out;
  }

  /* ---------------- Todos os outros dispositivos ---------------- */
  const CLASS_INFO = {
    MOUSE: ['i-driver', 'Mouse ou touchpad.'], KEYBOARD: ['i-driver', 'Teclado.'], HIDCLASS: ['i-game', 'Dispositivo de entrada (controle, mesa digitalizadora, botões).'],
    USB: ['i-driver', 'Controlador ou dispositivo USB.'], CAMERA: ['i-eye', 'Câmera.'], IMAGE: ['i-eye', 'Câmera ou scanner.'], PRINTER: ['i-driver', 'Impressora.'],
    BIOMETRIC: ['i-user', 'Leitor de digital ou reconhecimento de rosto.'], SENSOR: ['i-spark', 'Sensores (luz, movimento, orientação da tela).'], MONITOR: ['i-win', 'Monitor (cores e taxas de atualização).'],
    SECURITYDEVICES: ['i-chip', 'Chip de segurança (TPM).'], SMARTCARDREADER: ['i-driver', 'Leitor de cartão.'], PORTS: ['i-driver', 'Porta serial (COM) ou adaptador.'],
    FIRMWARE: ['i-chip', 'Firmware de uma peça (atualiza pela ferramenta do fabricante).'], DISKDRIVE: ['i-disk', 'Disco.'], CDROM: ['i-disk', 'Leitor de CD/DVD.'],
    WPD: ['i-driver', 'Celular, câmera ou player conectado.'], AUDIOPROCESSINGOBJECT: ['i-sound', 'Efeitos de áudio (equalizador, som 3D).'], XNACOMPOSITE: ['i-game', 'Controle de videogame.'],
    XBOXCOMPOSITE: ['i-game', 'Controle de videogame.'], BATTERY: ['i-bolt', 'Bateria.'], NET: ['i-net', 'Rede (adaptador virtual, VPN ou sem fio).'],
    MEDIA: ['i-sound', 'Áudio, vídeo ou placa de captura.'], DISPLAY: ['i-gpu', 'Vídeo (tela virtual ou transmissão).'], SYSTEM: ['i-chip', 'Componente da placa.'],
    HDC: ['i-disk', 'Controlador de disco.'], SCSIADAPTER: ['i-disk', 'Controlador de disco.'], BLUETOOTH: ['i-bt', 'Bluetooth.']
  };
  function otherCards(others, generic, now, support) {
    const seen = new Set();
    const out = [];
    for (const item of others || []) {
      const key = `${String(item.name).toLowerCase()}|${item.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const vendor = vendorOf(item);
      const [icon, purpose] = CLASS_INFO[item.cls] || ['i-driver', 'Dispositivo do PC.'];
      const page = vendor?.drivers || (vendor && support?.maker === vendor.name ? support.url : null) || (vendor ? `https://${vendor.host || `www.${vendor.domain}`}/` : null);
      const by = vendor ? `Driver da ${vendor.name}.` : item.provider ? `Driver de ${item.provider}.` : '';
      out.push(card({ id: `outro-${item.name}-${item.version}`, icon, source: item, name: item.name, maker: vendor?.name || item.provider || null, purpose: `${purpose} ${by}`.trim(), installed: installedOf(item), ...byAge(item, now, 4 * 365), action: page ? { label: vendor ? `Site da ${vendor.name}` : 'Site do fabricante', url: page } : null }));
      if (out.length >= 60) break;
    }
    if (Number.isInteger(generic) && generic > 0) out.push(card({ id: 'outros-windows', icon: 'i-win', brand: 'microsoft', plain: true, name: `${generic} ${generic === 1 ? 'dispositivo usa' : 'dispositivos usam'} o driver do próprio Windows`, purpose: 'Portas USB, monitor, teclado, mouse e outros que funcionam com o driver padrão da Microsoft. Não precisam de nada.', state: 'ok' }));
    return out;
  }

  /** O modelo inteiro da página. */
  function build(data = {}, now = Date.now()) {
    const devices = Array.isArray(data.devices) ? data.devices : [];
    const runtimes = data.runtimes || null;
    const latest = data.latest || {};
    const support = supportPage(runtimes?.board || {});
    const items = {
      video: videoCards(devices, runtimes, latest, now, support), rede: netCards(devices, now, support), audio: audioCards(devices, now, support),
      placa: boardCards(devices, now, support), disco: diskCards(devices, now, support), bluetooth: bluetoothCards(devices, now, support),
      semdriver: missingCards(runtimes, support), jogos: runtimeCards(runtimes, latest, devices)
    };
    // "Todos os outros": o que sobrou das classes principais com driver de fabricante (placa de captura, adaptador de
    // VPN, tela virtual...) mais os dispositivos das outras classes.
    const used = new Set(Object.values(items).flat().flatMap((item) => [item.sourceName, ...(item.extra || [])]).filter(Boolean));
    const leftovers = devices.filter((item) => !/^microsoft/i.test(item.provider || '') && !used.has(item.name) && !/high definition audio|display audio|hdmi audio/i.test(item.name));
    items.outros = otherCards([...leftovers, ...(Array.isArray(data.others) ? data.others : [])], data.generic, now, support);
    const groups = GROUPS.map((group) => ({ ...group, items: items[group.id] || [] })).filter((group) => group.items.length);
    const all = groups.flatMap((group) => group.items);
    const count = (...states) => all.filter((item) => states.includes(item.state)).length;
    const summary = { total: all.length, update: count('update'), missing: count('missing', 'problem'), old: count('old', 'generic'), ok: count('ok'), check: count('check', 'ended') };
    return { groups, summary, support, online: Boolean(latest?.nvidia || latest?.dotnet), at: data.at || now };
  }
  /** A frase do topo da página. */
  function headline(summary) {
    const parts = [];
    if (summary.update) parts.push(`${summary.update} ${summary.update === 1 ? 'atualização disponível' : 'atualizações disponíveis'}`);
    if (summary.missing) parts.push(`${summary.missing} ${summary.missing === 1 ? 'item faltando' : 'itens faltando'}`);
    if (summary.old) parts.push(`${summary.old} ${summary.old === 1 ? 'driver antigo' : 'drivers antigos'}`);
    if (!parts.length) return summary.total ? 'Tudo em dia' : 'Nenhum driver lido ainda';
    return parts.length === 1 ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : `${parts.slice(0, -1).join(', ').replace(/^./, (c) => c.toUpperCase())} e ${parts[parts.length - 1]}`;
  }
  const STATES = { update: 'Atualização disponível', ok: 'Em dia', missing: 'Falta', problem: 'Com erro', old: 'Antigo', generic: 'Driver genérico', check: 'Confira no site', ended: 'Sem versão nova' };
  /** As chaves de ícone que a página vai mostrar (para pedir só essas). */
  const brands = (model) => [...new Set([model?.support?.brand, ...(model?.groups || []).flatMap((group) => group.items.map((item) => item.brand))].filter(Boolean))];
  return { build, headline, brands, vendorOf, compare, nvidiaVersion, nvidiaLine, supportPage, chipMaker, monthText, GROUPS, STATES, PAGES };
});
