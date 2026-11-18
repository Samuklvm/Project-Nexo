/*
 * Página de Drivers: as regras (puras). Recebe o que o processo principal leu (drivers por dispositivo, componentes dos
 * jogos, placa/notebook e as versões mais recentes das fontes oficiais) e monta os grupos e os cartões da página:
 * nome, para que serve, versão instalada e a mais recente, o estado e o botão para o site oficial certo.
 *  - Nunca Windows Update: o botão sempre abre o site do fabricante (ou o permalink oficial da Microsoft).
 *  - Sem a versão mais recente (fabricante sem consulta pública, ou sem internet), o estado vem da idade do driver.
 *  - Pacote do fabricante do PC (Dell, HP, Lenovo, ASUS): cartão próprio no grupo da peça, com Baixar; a peça coberta
 *    aponta para ele. Vídeo fica sempre com NVIDIA/AMD/Intel; BIOS só vira aviso.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendors.js'), require('./oem.js'));
  else root.NexoDrivers = factory(root.NexoVendors, root.NexoOem);
})(typeof self !== 'undefined' ? self : this, function (Vendors, Oem) {
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const monthText = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(String(iso || '')); return m ? `${MONTHS[Number(m[2]) - 1]}/${m[1]}` : null; };
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
    dotnet: (channel) => `https://dotnet.microsoft.com/download/dotnet/${channel}`,
    // Arquivos oficiais para o download direto (Visual C++ pelo permalink da Microsoft; DirectX pelo instalador web).
    vc64File: 'https://aka.ms/vc14/vc_redist.x64.exe',
    vc86File: 'https://aka.ms/vc14/vc_redist.x86.exe',
    directxFile: 'https://download.microsoft.com/download/1/7/1/1718CCC4-6315-4D8E-9543-8E28A4E18C4C/dxwebsetup.exe'
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
    return { id: base.id, icon: base.icon, brand: base.brand || vendorOf(base.source)?.key || BRAND_OF[base.maker] || null, name: base.name, maker: base.maker || null, purpose: base.purpose, installed: base.installed || null, latest: base.latest || null, state: base.state, note: base.note || null, action: base.action || null, extra: base.extra || null, sourceName: base.source?.name || null, plain: base.plain === true, brandAlt: base.brandAlt || null };
  }
  // Drivers que vêm com o Windows têm a data fixa de 21/06/2006: mostrar "jun/2006" assustaria à toa.
  const installedOf = (item) => { const inbox = /^2006-06-21/.test(item.date || ''); return { version: item.version || null, date: inbox ? null : item.date || null, month: inbox ? null : monthText(item.date) }; };
  /*
   * Fabricante sem lista pública da versão mais recente: o app não sabe se há versão nova, então não chuta pela idade
   * (driver velho pode ser o último que existe). O cartão manda conferir e o botão abre a página certa.
   */
  const noLatest = () => ({ state: 'check', note: null });

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
        out.push(card({ ...base, ...noLatest(), action: { label: 'Site da NVIDIA', url: PAGES.nvidia } }));
      } else if (maker === 'AMD') {
        if (runtimes?.amd) base.installed = { ...base.installed, version: `Adrenalin ${runtimes.amd}` };
        const age = noLatest();
        out.push(card({ ...base, ...age, action: { label: 'Site da AMD', url: PAGES.amd }, note: age.note || 'A AMD não publica a versão mais recente para conferência automática; o site oficial detecta a placa.' }));
      } else if (maker === 'Intel') {
        // Vídeo integrado de notebook: muitas vezes só o driver do fabricante do notebook funciona bem.
        const age = noLatest();
        out.push(card({ ...base, ...age, action: mobile && support ? { label: `Suporte ${support.maker}`, url: support.url } : { label: 'Assistente da Intel', url: PAGES.intel }, note: age.note || (mobile ? 'Em notebook, prefira o driver de vídeo do site do fabricante do notebook.' : 'O assistente oficial da Intel detecta a versão certa.') }));
      } else {
        out.push(card({ ...base, ...noLatest(), action: support ? { label: `Suporte ${support.maker}`, url: support.url } : null }));
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
      return card({ ...base, ...noLatest(), action });
    });
  }
  function audioCards(devices, now, support) {
    return devices.filter((item) => item.cls === 'MEDIA' && !VIRTUAL_AUDIO.test(item.name) && /realtek|conexant|cirrus|idt|via|creative|sound blaster|high definition audio|áudio|audio|smart sound|sonido/i.test(item.name)).slice(0, 4).map((item) => {
      const maker = chipMaker(item);
      return card({ id: `audio-${item.name}`, icon: 'i-sound', source: item, name: item.name, maker, purpose: 'Som das caixas, fones e microfone.', installed: installedOf(item), ...noLatest(), action: vendorAction(maker, support) });
    });
  }
  function boardCards(devices, now, support) {
    const parts = devices.filter((item) => item.cls === 'SYSTEM' && /intel|amd|advanced micro/i.test(item.provider || '') && /management engine|serial io|smbus|gpio|psp|chipset|pci express root|i2c|dynamic tuning|gna|platform|pmf|ppm|uart/i.test(item.name));
    if (!parts.length) return [];
    const maker = chipMaker(parts[0]);
    const newest = [...parts].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    const action = maker === 'AMD' && support?.kind !== 'notebook' ? { label: 'Chipset no site da AMD', url: PAGES.amd } : vendorAction(maker, support);
    return [card({ id: 'placa-chipset', icon: 'i-board', source: newest, name: `Chipset ${maker || ''}`.trim(), maker, purpose: `${parts.length} ${parts.length === 1 ? 'componente' : 'componentes'} da placa (gerenciamento de energia, barramentos e sensores).`, installed: installedOf(newest), ...noLatest(), action, extra: parts.slice(0, 6).map((item) => item.name) })];
  }
  function diskCards(devices, now, support) {
    const list = devices.filter((item) => item.cls === 'SCSIADAPTER' || item.cls === 'HDC');
    const vendor = list.filter((item) => !/^microsoft/i.test(item.provider || '') && !/microsoft|storage spaces|virtual|iscsi/i.test(item.name));
    const out = vendor.slice(0, 3).map((item) => card({ id: `disco-${item.name}`, icon: 'i-disk', source: item, name: item.name, maker: chipMaker(item), purpose: /rst|vmd|raid|optane/i.test(item.name) ? 'Controla os discos pelo Intel RST/VMD ou RAID: sem ele o Windows nem vê o SSD.' : 'Controla os SSDs e HDs.', installed: installedOf(item), ...noLatest(), action: vendorAction(chipMaker(item), support) }));
    if (!out.length && list.length) out.push(card({ id: 'disco-windows', icon: 'i-disk', maker: 'Microsoft', name: 'Controladores de disco do Windows', purpose: 'Os SSDs NVMe e SATA usam o driver da Microsoft, que é o recomendado para a maioria deles.', installed: installedOf(list[0]), state: 'ok' }));
    return out;
  }
  function bluetoothCards(devices, now, support) {
    return devices.filter((item) => item.cls === 'BLUETOOTH' && !/enumerator|le generic|rfcomm|device \(|microsoft|avrcp|hands-free|a2dp/i.test(item.name) && /intel|realtek|qualcomm|mediatek|broadcom|bluetooth|wireless/i.test(item.name)).slice(0, 2).map((item) => {
      const maker = chipMaker(item);
      return card({ id: `bt-${item.name}`, icon: 'i-bt', source: item, name: item.name, maker, purpose: 'Controles, fones e mouses sem fio.', installed: installedOf(item), ...noLatest(), action: vendorAction(maker, support, maker === 'Intel' ? 'vendor' : 'support') });
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
      out.push(card({ id: `vc-${arch}`, icon: 'i-box', brand: 'vs', brandAlt: 'microsoft', name: `Visual C++ (${label})`, maker: 'Microsoft', purpose: `Quase todo jogo ${arch === 'x86' ? 'mais antigo ' : ''}precisa. Sem ele aparece erro de MSVCP140.dll ou VCRUNTIME140.dll.`, installed: v ? { version: v.replace(/^v/i, '') } : null, state, note: state === 'old' ? 'Versão antiga: a atual corrige falhas e é usada pelos jogos novos.' : null, action: { label: state === 'ok' ? 'Baixar da Microsoft' : 'Instalar da Microsoft', url } }));
    }
    const years = new Set((runtimes.uninstall || []).map((item) => (/Visual C\+\+ (\d{4})/i.exec(item.name) || [])[1]).filter(Boolean));
    const old = ['2005', '2008', '2010', '2012', '2013'];
    const have = old.filter((year) => years.has(year));
    // Os que faltam, um cartão cada, com o arquivo oficial da Microsoft (32 bits: é o que os jogos antigos usam).
    for (const year of old.filter((y) => !years.has(y))) {
      out.push(card({ id: `vc-${year}`, icon: 'i-box', brand: 'vs', brandAlt: 'microsoft', name: `Visual C++ ${year} (32 bits)`, maker: 'Microsoft', purpose: `Só instale se um jogo antigo pedir (erro de MSVCR${VC_DLL[year]}.dll ou MSVCP${VC_DLL[year]}.dll).`, state: 'check', action: { label: 'Página da Microsoft', url: PAGES.vcOld } }));
    }
    out.push(card({ id: 'vc-antigos', icon: 'i-box', brand: 'vs', brandAlt: 'microsoft', name: 'Visual C++ antigos (2005 a 2013)', maker: 'Microsoft', purpose: 'Jogos antigos ainda pedem estas versões. Instale só a que um jogo pedir.', installed: have.length ? { version: have.join(', ') } : null, state: have.length === old.length ? 'ok' : 'check', note: have.length < old.length ? `Faltam: ${old.filter((year) => !years.has(year)).join(', ')}.` : null, action: { label: 'Página da Microsoft', url: PAGES.vcOld } }));
    const dx = runtimes.dx || {};
    const dxOk = dx.d3dx9 && dx.xinput13;
    out.push(card({ id: 'directx9', icon: 'i-game', brand: 'directx', brandAlt: 'microsoft', name: 'DirectX 9 (componentes antigos)', maker: 'Microsoft', purpose: 'O Windows já traz o DirectX 12, mas jogos mais antigos (e alguns novos) pedem peças do DirectX 9, como d3dx9_43.dll e XInput 1.3.', installed: dxOk ? { version: 'instalado' } : null, state: dxOk ? 'ok' : 'missing', note: dxOk ? null : `Falta${!dx.d3dx9 && !dx.xinput13 ? 'm d3dx9_43.dll e xinput1_3.dll' : !dx.d3dx9 ? ' d3dx9_43.dll' : ' xinput1_3.dll'}.`, action: { label: dxOk ? 'Instalador da Microsoft' : 'Instalar da Microsoft', url: PAGES.directx } }));
    // .NET (para programas, launchers e mods): o mais alto de cada versão instalada contra o índice oficial.
    const byChannel = {};
    for (const v of runtimes.desktop || []) { const channel = v.split('.').slice(0, 2).join('.'); if (!byChannel[channel] || compare(v, byChannel[channel]) > 0) byChannel[channel] = v; }
    for (const [channel, v] of Object.entries(byChannel).sort((a, b) => compare(b[0], a[0])).slice(0, 3)) {
      const info = latest?.dotnet?.[channel];
      const newer = info && compare(info.latest, v) > 0;
      const eol = info?.phase === 'eol';
      out.push(card({ id: `dotnet-${channel}`, icon: 'i-box', brand: 'dotnet', brandAlt: 'microsoft', name: `.NET ${channel} Desktop Runtime`, maker: 'Microsoft', purpose: 'Programas, launchers e ferramentas de mods feitos em .NET usam.', installed: { version: v }, latest: info ? { version: info.latest } : null, state: newer ? 'update' : info ? 'ok' : 'check', note: eol ? `A Microsoft encerrou o suporte do .NET ${channel}${info.eol ? ` em ${monthText(info.eol)}` : ''}; o programa que pediu esta versão pode precisar de atualização.` : null, action: { label: newer ? 'Baixar da Microsoft' : 'Página da Microsoft', url: PAGES.dotnet(channel) } }));
    }
    if (runtimes.netfx) {
      const v = runtimes.netfx >= 533320 ? '4.8.1' : runtimes.netfx >= 528040 ? '4.8' : runtimes.netfx >= 461808 ? '4.7.2' : '4.7 ou anterior';
      out.push(card({ id: 'netfx', icon: 'i-box', brand: 'dotnet', brandAlt: 'microsoft', name: '.NET Framework', maker: 'Microsoft', purpose: 'Programas mais antigos para Windows (e alguns launchers) usam.', installed: { version: v }, state: runtimes.netfx >= 528040 ? 'ok' : 'old', action: { label: 'Página da Microsoft', url: PAGES.netfx } }));
    }
    const hasGpuDriver = devices.some((item) => item.cls === 'DISPLAY' && !VIRTUAL_GPU.test(item.name));
    out.push(card({ id: 'vulkan', icon: 'i-gpu', brand: 'vulkan', brandAlt: 'khronos', name: 'Vulkan', maker: 'Khronos', purpose: 'Usado por vários jogos e emuladores. Vem junto com o driver de vídeo.', installed: runtimes.vulkan ? { version: runtimes.vulkan } : null, state: runtimes.vulkan ? 'ok' : hasGpuDriver ? 'check' : 'missing', note: runtimes.vulkan ? null : 'Reinstalar o driver de vídeo do fabricante traz o Vulkan de volta.' }));
    if (devices.some((item) => item.cls === 'DISPLAY' && chipMaker(item) === 'NVIDIA')) {
      const physx = (runtimes.uninstall || []).find((item) => /physx/i.test(item.name));
      out.push(card({ id: 'physx', icon: 'i-spark', brand: 'physx', brandAlt: 'nvidia', name: 'PhysX', maker: 'NVIDIA', purpose: 'Física de alguns jogos (principalmente os mais antigos). Vem com o driver da NVIDIA.', installed: physx?.version ? { version: physx.version } : null, state: physx ? 'ok' : 'check', note: physx ? null : 'Não encontrado: instale o driver da NVIDIA com o PhysX marcado.', action: { label: 'Site da NVIDIA', url: PAGES.nvidia } }));
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
      out.push(card({ id: `outro-${item.name}-${item.version}`, icon, source: item, name: item.name, maker: vendor?.name || item.provider || null, purpose: `${purpose} ${by}`.trim(), installed: installedOf(item), ...noLatest(), action: page ? { label: vendor ? `Site da ${vendor.name}` : 'Site do fabricante', url: page } : null }));
      if (out.length >= 60) break;
    }
    if (Number.isInteger(generic) && generic > 0) out.push(card({ id: 'outros-windows', icon: 'i-win', brand: 'microsoft', plain: true, name: `${generic} ${generic === 1 ? 'dispositivo usa' : 'dispositivos usam'} o driver do próprio Windows`, purpose: 'Portas USB, monitor, teclado, mouse e outros que funcionam com o driver padrão da Microsoft. Não precisam de nada.', state: 'ok' }));
    return out;
  }

  /* ---------------- Pacotes do fabricante do PC ---------------- */
  const INBOX = /^microsoft\b/i;
  const OEM_TYPE = { dell: 'dell-catalog', hp: 'hpia-ref', lenovo: 'lenovo-catalog', asus: 'asus-api' };
  const OEM_NAME = { dell: 'Dell', hp: 'HP', lenovo: 'Lenovo', asus: 'ASUS', msi: 'MSI', gigabyte: 'GIGABYTE', asrock: 'ASRock', acer: 'Acer' };
  const GROUP_OF = { MEDIA: 'audio', NET: 'rede', BLUETOOTH: 'bluetooth', HDC: 'disco', SCSIADAPTER: 'disco', SYSTEM: 'placa' };
  const GROUP_ICON = { audio: 'i-sound', rede: 'i-net', bluetooth: 'i-bt', disco: 'i-disk', placa: 'i-board', semdriver: 'i-alert', outros: 'i-driver' };
  /** O maior entre os drivers instalados das peças (as que estão sem driver não têm versão). */
  function newestInstalled(devices) {
    let best = null;
    for (const item of devices) if (item.version && (!best || (Oem.compareVersions(item.version, best.version) ?? -1) > 0)) best = item;
    return best;
  }
  function oemPlan(oem, pkg, primary) {
    const type = OEM_TYPE[oem];
    const size = Number(pkg.size) > 0 ? sizeText(Number(pkg.size)) : null;
    const base = dl(pkg.url, type ? [...Oem.DOMAINS[type]] : [], pkg.fileName, null, { reinstall: !primary });
    if (!base || !/^(exe|msi|zip|cab)$/.test(String(pkg.kind || ''))) return null;
    const { signer, ...rest } = base;
    return { ...rest, signers: Oem.signersFor(oem), kind: pkg.kind, source: oem,
      ...(pkg.sha256 ? { sha256: pkg.sha256 } : {}), ...(oem === 'dell' && pkg.md5 ? { md5: pkg.md5 } : {}), ...(size ? { size } : {}),
      label: [primary ? 'Baixar' : 'Baixar mesmo assim', OEM_NAME[oem], size].filter(Boolean).join(' · ') };
  }
  /** { cards: { grupo: [cartão] }, covered: Map(nome da peça → id do cartão) }. */
  function oemCards(oem, devices, missing) {
    const out = { cards: {}, covered: new Map() };
    if (!Oem || !oem || !Array.isArray(oem.packages) || !oem.packages.length || !OEM_TYPE[oem.oem]) return out;
    const parts = [...devices, ...missing.map((item) => ({ ...item, cls: item.cls || 'MISSING', missing: true }))];
    for (const { pkg, devices: hits } of Oem.matchPackages(parts, oem.packages)) {
      // Driver básico do Windows (da Microsoft) tem numeração própria (10.0.x): não dá para comparar com o do
      // fabricante, e o do fabricante é justamente o que a peça precisa. Conta como peça sem driver do fabricante.
      const real = hits.filter((item) => !item.missing && !INBOX.test(String(item.provider || '')));
      const top = newestInstalled(real) || newestInstalled(hits);
      const allMissing = hits.every((item) => item.missing);
      const verdict = real.length ? Oem.compareToInstalled(newestInstalled(real)?.version, pkg) : 'newer';
      if (verdict === 'same' || verdict === 'older') continue;
      const state = verdict === 'newer' ? 'update' : 'oem';
      const group = allMissing ? 'semdriver' : GROUP_OF[String(hits[0].cls || '').toUpperCase()] || 'outros';
      const id = `oem-${pkg.id}`;
      const covers = [...new Set(hits.map((item) => item.name))];
      const who = OEM_NAME[oem.oem];
      const item = card({
        id, icon: GROUP_ICON[group], brand: oem.oem, name: pkg.title, maker: who, purpose: `Pacote oficial da ${who} feito para o ${oem.label}.`,
        installed: top ? installedOf(top) : null, latest: { version: pkg.driverVersion || pkg.version || null, date: pkg.date || null, month: monthText(pkg.date) },
        state, note: state === 'oem' ? `A ${who} numera este pacote de outro jeito, então não dá para comparar com o instalado${pkg.date ? `. Saiu em ${monthText(pkg.date)}` : ''}.` : null
      });
      item.kind = 'oem';
      item.covers = covers;
      item.download = oemPlan(oem.oem, pkg, state === 'update');
      (out.cards[group] = out.cards[group] || []).push(item);
      for (const name of covers) out.covered.set(name, id);
    }
    return out;
  }

  /* ---------------- Download direto (o arquivo oficial certo para este PC) ---------------- */
  const MS_DOMAINS = ['aka.ms', 'microsoft.com', 'visualstudio.microsoft.com'];
  // Visual C++ antigos (32 bits), dos links oficiais da Microsoft (Download Center).
  const VC_OLD = {
    2005: 'https://download.microsoft.com/download/8/B/4/8B42259F-5D70-43F4-AC2E-4B208FD8D66A/vcredist_x86.EXE',
    2008: 'https://download.microsoft.com/download/d/d/9/dd9a82d0-52ef-40db-8dab-795376989c03/vcredist_x86.exe',
    2010: 'https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe',
    2012: 'https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe',
    2013: 'https://download.microsoft.com/download/C/C/2/CC2DF5F8-4454-44B4-802D-5EA68D086676/vcredist_x86.exe'
  };
  const VC_DLL = { 2005: '80', 2008: '90', 2010: '100', 2012: '110', 2013: '120' };
  /*
   * Periféricos gamer: o programa oficial de cada marca (botões, DPI, iluminação e firmware). Eles se atualizam
   * sozinhos, então instalado = em dia. Baixar direto só onde o link oficial é fixo; os outros abrem o site.
   */
  const PERIPHERALS = [
    { key: 'logitech', vid: '046D', name: 'Logitech G HUB', maker: 'Logitech', app: /logitech g hub/i, page: 'https://www.logitechg.com/innovation/g-hub.html',
      file: { url: 'https://download01.logi.com/web/ftp/pub/techsupport/gaming/lghub_installer.exe', domains: ['download01.logi.com'], fileName: 'lghub_installer.exe', signers: ['Logitech Inc', 'Logitech Inc.', 'Logitech'] } },
    { key: 'steelseries', vid: '1038', name: 'SteelSeries GG', maker: 'SteelSeries', app: /steelseries gg/i, page: 'https://steelseries.com/gg',
      file: { url: 'https://steelseries.com/gg/downloads/gg/latest/windows', domains: ['steelseries.com', 'steelseriescdn.com'], fileName: 'SteelSeriesGG-Setup.exe', signers: ['SteelSeries ApS'] } },
    { key: 'razer', vid: '1532', name: 'Razer Synapse', maker: 'Razer', app: /razer synapse/i, page: 'https://www.razer.com/synapse-4' },
    { key: 'corsair', vid: '1B1C', name: 'CORSAIR iCUE', maker: 'Corsair', app: /\bicue\b/i, page: 'https://www.corsair.com/us/en/s/downloads' }
  ];
  const vidOf = (item) => {
    const ids = String(item?.ids || '');
    if (/^[0-9A-F]{4}:/.test(ids)) return ids.slice(0, 4);
    for (const h of Array.isArray(item?.hwids) ? item.hwids : []) { const m = /VID_([0-9A-F]{4})/i.exec(String(h)); if (m) return m[1].toUpperCase(); }
    return null;
  };
  function peripheralCards(devices, runtimes) {
    const vids = new Set(devices.map(vidOf).filter(Boolean));
    return PERIPHERALS.filter((p) => vids.has(p.vid)).map((p) => {
      const installed = (Array.isArray(runtimes?.uninstall) ? runtimes.uninstall : []).find((item) => p.app.test(String(item?.name || '')));
      return card({
        id: `perif-${p.key}`, icon: 'i-spark', brand: p.key, name: p.name, maker: p.maker,
        purpose: `O programa oficial da ${p.maker} para o seu periférico: botões, DPI, iluminação e as atualizações de firmware.`,
        installed: installed ? { version: installed.version || null } : null, state: installed ? 'ok' : 'check',
        note: installed ? `O ${p.name} se atualiza sozinho e atualiza o firmware do periférico.` : `Você tem um periférico ${p.maker} e o ${p.name} não está instalado.`,
        action: { label: `Site da ${p.maker}`, url: p.page }
      });
    });
  }
  // O assistente oficial da Intel: detecta e instala os drivers Intel certos para este PC.
  const INTEL_DSA = { url: 'https://dsadata.intel.com/installer', domains: ['dsadata.intel.com', 'downloadmirror.intel.com'], fileName: 'Intel-Driver-and-Support-Assistant-Installer.exe' };
  const hasApp = (runtimes, re) => (Array.isArray(runtimes?.uninstall) ? runtimes.uninstall : []).some((item) => re.test(String(item?.name || '')));
  const INTEL_CARD = /^(rede|bt|video|disco)-|^placa-chipset$/;
  const SIGNER = { nvidia: 'NVIDIA Corporation', microsoft: 'Microsoft Corporation' };
  /** Só https e só o domínio do fabricante (o que vem da internet não é confiável, mesmo já filtrado no processo principal). */
  function official(value, domains) {
    try {
      const url = new URL(String(value || ''));
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && domains.some((d) => host === d || host.endsWith(`.${d}`)) ? url.href : null;
    } catch { return null; }
  }
  const dl = (url, domains, fileName, signer, extra = {}) => {
    const safe = official(url, domains);
    if (!safe) return null;
    const size = extra.size || null;
    // Já em dia: dá para reinstalar, mas o botão fica discreto (não convida a baixar 1 GB à toa).
    const verb = extra.reinstall ? 'Reinstalar' : 'Baixar';
    return { url: safe, domains, fileName, signer, ...(extra.sha512 ? { sha512: extra.sha512 } : {}), ...(size ? { size } : {}), primary: !extra.reinstall, label: size ? `${verb} · ${size}` : verb };
  };
  function downloadOf(item, latest, runtimes) {
    if (item.id.startsWith('video-') && item.maker === 'NVIDIA' && (item.state === 'update' || item.state === 'ok')) {
      const line = nvidiaLine(item.name);
      if (line !== 'modern' && line !== 'legacy') return null;
      // Notebook: só o pacote de notebook. Sem ele, nada (o de desktop não serve).
      const top = runtimes?.board?.mobile === true ? latest?.nvidiaNotebook?.[line] : latest?.nvidia?.[line];
      if (!top?.download || !/^\d{3}\.\d{2}$/.test(String(top.version || ''))) return null;
      return dl(top.download, ['nvidia.com'], `nvidia-${top.version}.exe`, SIGNER.nvidia, { size: top.size, reinstall: item.state === 'ok' });
    }
    if ((item.id === 'vc-x64' || item.id === 'vc-x86') && (item.state === 'missing' || item.state === 'old')) {
      const arch = item.id.slice(3);
      return dl(arch === 'x64' ? PAGES.vc64File : PAGES.vc86File, MS_DOMAINS, `vc_redist.${arch}.exe`, SIGNER.microsoft);
    }
    const perif = /^perif-(\w+)$/.exec(item.id);
    if (perif) {
      const p = PERIPHERALS.find((x) => x.key === perif[1]);
      if (!p?.file || item.state === 'ok') return null;
      const base = dl(p.file.url, p.file.domains, p.file.fileName, null, { reinstall: true });
      if (!base) return null;
      const { signer, ...rest } = base;
      return { ...rest, signers: [...p.file.signers], label: `Baixar o ${p.name}` };
    }
    const vcOld = /^vc-(2005|2008|2010|2012|2013)$/.exec(item.id);
    if (vcOld) { const plan = dl(VC_OLD[vcOld[1]], ['download.microsoft.com'], `vcredist-${vcOld[1]}-x86.exe`, SIGNER.microsoft, { reinstall: true }); return plan && { ...plan, label: 'Baixar da Microsoft' }; }
    // Peça Intel sem pacote do fabricante do PC: o assistente oficial da Intel (vídeo de notebook fica com o fabricante).
    if (item.maker === 'Intel' && INTEL_CARD.test(item.id) && !(item.id.startsWith('video-') && runtimes?.board?.mobile === true) && !hasApp(runtimes, /Driver & Support Assistant/i)) {
      const known = item.state === 'generic' || item.state === 'missing';
      const plan = dl(INTEL_DSA.url, INTEL_DSA.domains, INTEL_DSA.fileName, 'Intel Corporation', { reinstall: !known });
      return plan && { ...plan, label: 'Baixar o assistente da Intel' };
    }
    if (item.id === 'directx9' && item.state === 'missing') return dl(PAGES.directxFile, MS_DOMAINS, 'dxwebsetup.exe', SIGNER.microsoft);
    const net = /^dotnet-(\d+\.\d+)$/.exec(item.id);
    if (net && item.state === 'update') {
      const file = latest?.dotnetFiles?.[net[1]];
      if (!file?.sha512 || !/^[0-9a-f]{128}$/i.test(file.sha512)) return null;
      return dl(file.url, ['microsoft.com', 'dot.net'], `windowsdesktop-runtime-${file.version}-win-x64.exe`, SIGNER.microsoft, { sha512: file.sha512 });
    }
    return null;
  }
  /* ---------------- Textos do download (barra e fases) ---------------- */
  const MB = 1024 * 1024;
  const decimal = (value) => value.toFixed(1).replace('.', ',');
  const sizeText = (bytes) => (bytes >= 1024 * MB ? `${decimal(bytes / (1024 * MB))} GB` : `${Math.round(bytes / MB)} MB`);
  /** "66% · 12,4 MB/s · faltam 19 s" (sem tamanho total: "450 MB · 12,4 MB/s"). */
  function progressText(item = {}) {
    const parts = [];
    if (item.total > 0) parts.push(`${Math.min(100, Math.floor((item.received / item.total) * 100))}%`);
    else parts.push(sizeText(item.received || 0));
    if (item.speed > 0) parts.push(item.speed >= MB ? `${decimal(item.speed / MB)} MB/s` : `${Math.max(1, Math.round(item.speed / 1024))} KB/s`);
    if (Number.isFinite(item.eta) && item.eta !== null) parts.push(item.eta > 90 ? `faltam ${Math.ceil(item.eta / 60)} min` : `faltam ${Math.max(1, Math.round(item.eta))} s`);
    return parts.join(' · ');
  }
  const ERRORS = {
    offline: 'Sem internet. Tente de novo.', domain: 'O link saiu do site oficial, então parei.', redirects: 'O site redirecionou demais, então parei.',
    'too-big': 'O arquivo veio maior que o esperado, então parei.', hash: 'O arquivo não bateu com o oficial, então apaguei por segurança.',
    signature: 'O arquivo não veio assinado pelo fabricante, então apaguei por segurança.', disk: 'Sem espaço no disco.', http: 'O site do fabricante não respondeu.',
    file: 'Não consegui gravar o arquivo no disco.', changed: 'O arquivo mudou depois do download, então apaguei. Baixe de novo.',
    inner: 'O instalador de dentro do pacote não veio assinado pelo fabricante, então apaguei por segurança.'
  };
  const signerName = (signer) => String(signer || 'fabricante').replace(/\s+(Corporation|Corp\.?|Inc\.?|Ltd\.?)$/i, '');
  function phaseText(item = {}) {
    switch (item.phase) {
      case 'queued': return item.position ? `Na fila (${item.position}º)` : 'Na fila';
      case 'downloading': return progressText(item);
      case 'verifying': return 'Conferindo a assinatura…';
      // Pacote .zip/.cab: confere o hash agora e a assinatura do instalador de dentro na hora de instalar.
      case 'ready': return item.signer ? `✓ Assinado pela ${signerName(item.signer)}` : '✓ Baixado e conferido';
      case 'install-queued': return 'Na fila para instalar';
      case 'installing': return 'Instalando… siga a janela do fabricante';
      case 'installed': return '✓ Instalado';
      case 'canceled': return 'Download cancelado.';
      case 'error': return ERRORS[item.error] || 'O download não terminou. Tente de novo.';
      default: return '';
    }
  }

  /** O cartão continua mostrando a área do download (barra, selo, avisos) mesmo depois de perder o download direto
   *  (ex.: Visual C++ instalado vira "Em dia" e não precisa mais baixar, mas o "reinicie o PC" tem que continuar lá). */
  function keepsZone(item, dl, hasNote) {
    return Boolean(item?.download) || Boolean(hasNote) || ['queued', 'downloading', 'verifying', 'ready', 'install-queued', 'installing', 'installed'].includes(dl?.phase);
  }
  /** Depois de instalar e conferir de novo: a versão mudou mesmo? (instalador cancelado também sai com código 0) */
  function installOutcome(stateAfter) {
    return ['update', 'missing', 'old', 'error'].includes(stateAfter) || !stateAfter ? 'unchanged' : 'updated';
  }

  /** O download de um cartão pelo id (o processo principal usa a própria leitura; o id vem da tela). */
  function downloadFor(model, id) {
    if (!model || typeof id !== 'string') return null;
    for (const group of model.groups || []) for (const item of group.items) if (item.id === id) return item.download || null;
    return null;
  }

  /*
   * BIOS nova? Cada fabricante escreve de um jeito (Dell "1.14.0", HP "T70 Ver. 01.15.00", Lenovo "N2IET98W (1.76)"):
   * compara o primeiro número com pontos de cada lado, só se tiverem o mesmo formato. Na dúvida, não avisa.
   */
  function biosNewer(installed, latest) {
    const pick = (value) => { const m = /\d+(?:\.\d+)+/.exec(String(value || '')); return m ? m[0].split('.').map(Number).join('.') : null; };
    const a = pick(installed);
    const b = pick(latest);
    if (!a || !b || !Oem) return false;
    return Oem.compareVersions(b, a) === 1;
  }
  /** O resumo do fabricante do PC para a tela (linha do topo e aviso de BIOS). */
  function oemInfo(oem, runtimes) {
    if (!oem || typeof oem !== 'object') return null;
    const installed = runtimes?.board?.bios || null;
    const bios = oem.bios?.version ? { version: oem.bios.version, date: oem.bios.date || null, installed, newer: biosNewer(installed, oem.bios.version) } : null;
    return { oem: oem.oem, label: oem.label || null, at: oem.at || null, error: oem.error || null, bios, disabled: oem.disabled === true, pending: oem.pending === true, noList: oem.noList === true, support: oem.support || null, packages: Array.isArray(oem.packages) ? oem.packages.length : 0 };
  }

  const clock = (at) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  /** A linha do topo sobre o fabricante do PC ('' quando o Nexo não identificou o fabricante). */
  function oemLine(oem, now = Date.now()) {
    if (!oem || !oem.oem) return '';
    const who = OEM_NAME[oem.oem] || 'fabricante';
    const head = `Seu PC: ${oem.label || who}`;
    if (oem.pending) return `${head} · lendo a lista oficial da ${who}…`;
    if (oem.noList) return `${head} · a ${who} não publica lista de drivers para este modelo; use a página de suporte`;
    if (oem.disabled) return `${head} · os pacotes da ${who} estão pausados por enquanto; o botão abre a página de suporte`;
    if (oem.error?.stage === 'signature') return `${head} · a lista da ${who} não passou na conferência da assinatura, então ignorei por segurança`;
    if (oem.error) return `${head} · fonte da ${who} fora do ar agora; tentando de novo mais tarde`;
    if (!OEM_TYPE[oem.oem]) return `${head} · a ${who} não tem lista pública de drivers; use a página de suporte do modelo`;
    const at = Number(oem.at);
    if (!Number.isFinite(at) || at <= 0) return head;
    const day = new Date(at).toDateString() === new Date(now).toDateString() ? '' : ` de ${new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
    return `${head} · lista oficial da ${who} conferida${day} às ${clock(at)}`;
  }
  /** "Atualiza: A, B e C" / "Atualiza: A, B, C e mais 2". */
  function coversText(names) {
    const list = Array.isArray(names) ? names.filter(Boolean) : [];
    if (!list.length) return '';
    if (list.length <= 3) return `Atualiza: ${list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`}`;
    return `Atualiza: ${list.slice(0, 3).join(', ')} e mais ${list.length - 3}`;
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
    items.outros = [...peripheralCards([...devices, ...(Array.isArray(data.others) ? data.others : []), ...(Array.isArray(data.genericDevices) ? data.genericDevices : [])], runtimes), ...otherCards([...leftovers, ...(Array.isArray(data.others) ? data.others : [])], data.generic, now, support)];
    for (const list of Object.values(items)) for (const item of list) item.download = downloadOf(item, latest, runtimes);
    // Assistente da Intel já instalado: o Nexo não oferece de novo, só diz onde atualizar.
    if (hasApp(runtimes, /Driver & Support Assistant/i)) {
      for (const list of Object.values(items)) for (const item of list) {
        if (item.maker === 'Intel' && INTEL_CARD.test(item.id) && item.state !== 'ok' && item.state !== 'update') item.note = `${item.note ? `${item.note} ` : ''}O assistente da Intel já está instalado: abra ele para atualizar este driver.`;
      }
    }
    // Pacotes do fabricante do PC: primeiro no grupo da peça; a peça coberta deixa o botão do site para o pacote.
    const oem = oemCards(latest.oem, [...devices, ...(Array.isArray(data.genericDevices) ? data.genericDevices : [])], Array.isArray(runtimes?.missing) ? runtimes.missing : []);
    for (const list of Object.values(items)) for (const item of list) {
      const by = item.sourceName && oem.covered.get(item.sourceName);
      if (by && !item.id.startsWith('video-')) { item.coveredBy = by; item.action = null; item.download = null; }
    }
    for (const [group, list] of Object.entries(oem.cards)) items[group] = [...list, ...(items[group] || [])];
    const groups = GROUPS.map((group) => ({ ...group, items: items[group.id] || [] })).filter((group) => group.items.length);
    const all = groups.flatMap((group) => group.items);
    // Cada peça conta uma vez: a que o pacote do fabricante cobre aparece pelo cartão do pacote.
    const count = (...states) => all.filter((item) => !item.coveredBy && states.includes(item.state)).length;
    const summary = { total: all.length, update: count('update'), missing: count('missing', 'problem'), old: count('old'), generic: count('generic'), ok: count('ok'), check: count('check', 'ended'), oem: count('oem') };
    return { groups, summary, support, oem: oemInfo(latest.oem, runtimes), online: Boolean(latest?.nvidia || latest?.dotnet || (latest?.oem && !latest.oem.error && !latest.oem.pending && !latest.oem.noList && Array.isArray(latest.oem.packages) && latest.oem.packages.length)), at: data.at || now };
  }
  /** A frase do topo da página. */
  function headline(summary) {
    const parts = [];
    if (summary.update) parts.push(`${summary.update} ${summary.update === 1 ? 'atualização disponível' : 'atualizações disponíveis'}`);
    if (summary.missing) parts.push(`${summary.missing} ${summary.missing === 1 ? 'item faltando' : 'itens faltando'}`);
    if (summary.old) parts.push(`${summary.old} ${summary.old === 1 ? 'driver desatualizado' : 'drivers desatualizados'}`);
    if (summary.generic) parts.push(`${summary.generic} com o driver básico do Windows`);
    if (!parts.length) return summary.total ? 'Tudo em dia' : 'Nenhum driver lido ainda';
    return parts.length === 1 ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : `${parts.slice(0, -1).join(', ').replace(/^./, (c) => c.toUpperCase())} e ${parts[parts.length - 1]}`;
  }
  const STATES = { update: 'Atualização disponível', ok: 'Em dia', missing: 'Falta', problem: 'Com erro', old: 'Desatualizado', generic: 'Driver genérico', check: 'Confira no site', ended: 'Sem versão nova', oem: 'Pacote do fabricante disponível' };
  /** As chaves de ícone que a página vai mostrar (para pedir só essas). */
  const brands = (model) => [...new Set([model?.support?.brand, ...(model?.groups || []).flatMap((group) => group.items.flatMap((item) => [item.brand, item.brandAlt]))].filter(Boolean))];
  return { build, biosNewer, oemLine, coversText, OEM_NAME, downloadFor, keepsZone, installOutcome, progressText, phaseText, headline, brands, vendorOf, compare, nvidiaVersion, nvidiaLine, supportPage, chipMaker, monthText, GROUPS, STATES, PAGES };
});
