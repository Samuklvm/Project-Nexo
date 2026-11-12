/*
 * Fabricantes de drivers: quem fez cada driver (pelo nome do provedor, do fabricante, do dispositivo e pelo código PCI
 * ou USB) e o site oficial dele. Usado pela página de Drivers para o ícone oficial (que o processo principal busca no
 * próprio site do fabricante) e para o botão de download. Só domínios oficiais; fabricante fora da lista fica com o
 * ícone da categoria.
 *
 * Campos: [chave, nome, domínio oficial, expressão (provedor/fabricante/dispositivo), códigos PCI/USB, página de drivers]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoVendors = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const V = (key, name, domain, re, ids = [], drivers = null, host = null) => ({ key, name, domain, re, ids, drivers, host });
  const LIST = [
    // Processador, vídeo e chipset
    V('nvidia', 'NVIDIA', 'nvidia.com', /\bnvidia\b/i, ['10DE', '0955'], 'https://www.nvidia.com/pt-br/drivers/'),
    V('amd', 'AMD', 'amd.com', /\bamd\b|advanced micro devices|\bati technologies|\bradeon\b/i, ['1002', '1022'], 'https://www.amd.com/pt/support/download/drivers.html'),
    V('intel', 'Intel', 'intel.com', /\bintel\b|\bkiller\b|rivet networks/i, ['8086', '8087'], 'https://www.intel.com/content/www/br/pt/support/detect.html'),
    V('qualcomm', 'Qualcomm', 'qualcomm.com', /qualcomm|atheros/i, ['17CB', '168C', '05C6', '0CF3'], 'https://www.qualcomm.com/support'),
    V('mediatek', 'MediaTek', 'mediatek.com', /mediatek|ralink/i, ['14C3', '0E8D', '148F'], null),
    V('realtek', 'Realtek', 'realtek.com', /realtek/i, ['10EC', '0BDA'], 'https://www.realtek.com/Download/Overview'),
    V('broadcom', 'Broadcom', 'broadcom.com', /broadcom/i, ['14E4', '0A5C'], null),
    V('marvell', 'Marvell', 'marvell.com', /marvell|aquantia/i, ['11AB', '1B4B', '1D6A'], null),
    V('asmedia', 'ASMedia', 'asmedia.com.tw', /asmedia/i, ['1B21'], null),
    V('via', 'VIA', 'via.com.tw', /\bvia technologies\b|^via$/i, ['1106', '2109'], null),
    V('renesas', 'Renesas', 'renesas.com', /renesas|\bnec electronics\b/i, ['1912'], null),
    V('fresco', 'Fresco Logic', 'frescologic.com', /fresco logic/i, ['1B73'], null),
    V('ti', 'Texas Instruments', 'ti.com', /texas instruments/i, ['104C', '0451'], null),
    V('jmicron', 'JMicron', 'jmicron.com', /jmicron/i, ['197B', '152D'], null),
    V('ricoh', 'Ricoh', 'ricoh.com', /\bricoh\b/i, ['1180'], null),
    V('o2micro', 'O2Micro', 'o2micro.com', /o2micro/i, ['1217'], null),
    V('genesys', 'Genesys Logic', 'genesyslogic.com.tw', /genesys logic/i, ['05E3'], null),
    V('alcor', 'Alcor Micro', 'alcormicro.com', /alcor micro/i, ['058F'], null),
    V('silabs', 'Silicon Labs', 'silabs.com', /silicon lab/i, ['10C4'], 'https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers'),
    V('ftdi', 'FTDI', 'ftdichip.com', /\bftdi\b|future technology devices/i, ['0403'], 'https://ftdichip.com/drivers/'),
    V('prolific', 'Prolific', 'prolific.com.tw', /prolific/i, ['067B'], null),
    V('wch', 'WCH', 'wch-ic.com', /\bwch\b|wch\.cn|nanjing qinheng/i, ['1A86'], null),
    V('infineon', 'Infineon', 'infineon.com', /infineon|cypress semiconductor/i, ['04B4', '15D1'], null),
    V('nuvoton', 'Nuvoton', 'nuvoton.com', /nuvoton/i, ['0416'], null),
    V('ite', 'ITE', 'ite.com.tw', /\bite tech/i, ['048D'], null),
    V('microchip', 'Microchip', 'microchip.com', /microchip|\bsmsc\b/i, ['0424', '04D8'], null),
    V('asix', 'ASIX', 'asix.com.tw', /\basix\b/i, ['0B95'], null),
    V('synaptics', 'Synaptics', 'synaptics.com', /synaptics|conexant|displaylink/i, ['06CB', '14F1', '17E9'], null),
    V('elan', 'ELAN', 'emc.com.tw', /\belan\b|elan microelectronics/i, ['04F3'], null),
    V('goodix', 'Goodix', 'goodix.com', /goodix/i, ['27C6'], null),
    V('cirrus', 'Cirrus Logic', 'cirrus.com', /cirrus logic/i, ['1013'], null),
    V('idt', 'IDT', 'renesas.com', /\bidt\b|integrated device technology|tempo semiconductor/i, ['111D'], null),
    V('tobii', 'Tobii', 'tobii.com', /\btobii\b/i, ['2104'], null),
    // Armazenamento
    V('samsung', 'Samsung', 'samsung.com', /samsung/i, ['144D', '04E8'], 'https://semiconductor.samsung.com/consumer-storage/support/tools/'),
    V('wd', 'Western Digital', 'westerndigital.com', /western digital|\bwdc\b|sandisk/i, ['15B7', '1058', '0781'], null),
    V('kingston', 'Kingston', 'kingston.com', /kingston/i, ['2646', '0951'], null),
    V('crucial', 'Crucial', 'crucial.com', /crucial|micron/i, ['1344', '0634'], null),
    V('seagate', 'Seagate', 'seagate.com', /seagate/i, ['1BB1', '0BC2'], null),
    V('skhynix', 'SK hynix', 'skhynix.com', /hynix|solidigm/i, ['1C5C', '025E'], null),
    V('kioxia', 'KIOXIA', 'kioxia.com', /kioxia|toshiba/i, ['1E0F', '1179', '0930'], null),
    V('phison', 'Phison', 'phison.com', /phison/i, ['1987'], null),
    V('sm', 'Silicon Motion', 'siliconmotion.com', /silicon motion/i, ['126F'], null),
    V('adata', 'ADATA', 'adata.com', /adata|xpg/i, ['1CC1', '125F'], null),
    V('lexar', 'Lexar', 'lexar.com', /lexar/i, ['1D97'], null),
    V('teamgroup', 'TEAMGROUP', 'teamgroupinc.com', /team group|teamgroup/i, [], null),
    // Fabricantes de PC, notebook e placa-mãe
    V('microsoft', 'Microsoft', 'microsoft.com', /\bmicrosoft\b|xbox/i, ['1414', '045E'], null),
    V('asus', 'ASUS', 'asus.com', /\basus|asustek|republic of gamers/i, ['1043', '0B05'], 'https://www.asus.com/br/support/download-center/'),
    V('msi', 'MSI', 'msi.com', /micro-star|\bmsi\b/i, ['1462', '1770', '0DB0'], 'https://br.msi.com/support'),
    V('gigabyte', 'GIGABYTE', 'gigabyte.com', /gigabyte|aorus/i, ['1458'], 'https://www.gigabyte.com/br/Support'),
    V('asrock', 'ASRock', 'asrock.com', /asrock/i, ['1849'], 'https://www.asrock.com/support/index.asp'),
    V('biostar', 'BIOSTAR', 'biostar.com.tw', /biostar/i, ['1565'], null),
    V('dell', 'Dell', 'dell.com', /\bdell\b|alienware/i, ['1028', '413C'], 'https://www.dell.com/support/home/pt-br'),
    V('hp', 'HP', 'hp.com', /hewlett|\bhp inc\b|^hp$|\bhp\b(?= )/i, ['103C', '03F0'], 'https://support.hp.com/br-pt/drivers'),
    V('lenovo', 'Lenovo', 'lenovo.com', /lenovo/i, ['17AA', '17EF'], 'https://pcsupport.lenovo.com/br/pt/'),
    V('acer', 'Acer', 'acer.com', /\bacer\b|predator/i, ['1025', '0502'], 'https://www.acer.com/br-pt/support'),
    V('positivo', 'Positivo', 'positivotecnologia.com.br', /positivo/i, [], null),
    V('avell', 'Avell', 'avell.com.br', /avell/i, [], null),
    V('lg', 'LG', 'lg.com', /\blg electronics\b|^lg$/i, ['043E'], null),
    V('huawei', 'Huawei', 'huawei.com', /huawei|honor device/i, ['19E5', '12D1'], null),
    V('xiaomi', 'Xiaomi', 'mi.com', /xiaomi/i, ['2717'], null),
    V('apple', 'Apple', 'apple.com', /\bapple\b|boot camp/i, ['106B', '05AC'], null),
    V('google', 'Google', 'google.com', /\bgoogle\b|android/i, ['18D1'], null),
    V('sony', 'Sony', 'sony.com', /\bsony\b|playstation|dualsense|dualshock/i, ['054C'], null),
    V('nintendo', 'Nintendo', 'nintendo.com', /nintendo/i, ['057E'], null),
    V('valve', 'Valve', 'valvesoftware.com', /\bvalve\b|steam ?vr|steam controller|steam streaming/i, ['28DE'], null),
    V('meta', 'Meta', 'meta.com', /oculus|\bmeta\b(?! virtual)/i, ['2833'], null),
    V('htc', 'HTC', 'htc.com', /\bhtc\b|vive/i, ['0BB4'], null),
    V('vaio', 'VAIO', 'vaio.com', /\bvaio\b/i, [], null),
    V('razer', 'Razer', 'razer.com', /razer/i, ['1532'], null),
    V('corsair', 'Corsair', 'corsair.com', /corsair/i, ['1B1C'], null),
    V('logitech', 'Logitech', 'logitech.com', /logitech|\blogi\b|blue microphones/i, ['046D'], null),
    V('steelseries', 'SteelSeries', 'steelseries.com', /steelseries/i, ['1038'], null),
    V('hyperx', 'HyperX', 'hyperx.com', /hyperx/i, [], null),
    V('roccat', 'ROCCAT', 'turtlebeach.com', /roccat|turtle beach/i, ['1E7D', '10F5'], null),
    V('redragon', 'Redragon', 'redragon.com.br', /redragon/i, [], null),
    V('cooler', 'Cooler Master', 'coolermaster.com', /cooler master/i, ['2516'], null),
    V('nzxt', 'NZXT', 'nzxt.com', /\bnzxt\b/i, ['1E71'], null),
    V('thermaltake', 'Thermaltake', 'thermaltake.com', /thermaltake/i, ['264A'], null),
    V('wooting', 'Wooting', 'wooting.io', /wooting/i, ['31E3'], null),
    V('8bitdo', '8BitDo', '8bitdo.com', /8bitdo/i, ['2DC8'], null),
    V('thrustmaster', 'Thrustmaster', 'thrustmaster.com', /thrustmaster|guillemot/i, ['044F'], null),
    V('fanatec', 'Fanatec', 'fanatec.com', /fanatec|endor ag/i, ['0EB7'], null),
    V('moza', 'MOZA Racing', 'mozaracing.com', /moza/i, ['346E'], null),
    V('wacom', 'Wacom', 'wacom.com', /wacom/i, ['056A'], null),
    V('huion', 'Huion', 'huion.com', /huion/i, ['256C'], null),
    V('xppen', 'XP-PEN', 'xp-pen.com', /xp-pen|ugee/i, ['28BD'], null),
    // Áudio
    V('creative', 'Creative', 'creative.com', /creative|sound blaster/i, ['1102', '041E'], null),
    V('dolby', 'Dolby', 'dolby.com', /\bdolby\b/i, [], null),
    V('dts', 'DTS', 'dts.com', /\bdts\b|xperi/i, [], null),
    V('nahimic', 'Nahimic', 'nahimic.com', /nahimic|a-volute/i, [], null),
    V('waves', 'Waves', 'waves.com', /\bwaves\b|maxxaudio/i, [], null),
    V('focusrite', 'Focusrite', 'focusrite.com', /focusrite/i, ['1235'], null),
    V('behringer', 'Behringer', 'behringer.com', /behringer|music tribe/i, ['1397'], null),
    V('yamaha', 'Yamaha', 'yamaha.com', /yamaha|steinberg/i, ['0499'], null),
    V('roland', 'Roland', 'roland.com', /\broland\b|boss corporation/i, ['0582'], null),
    V('presonus', 'PreSonus', 'presonus.com', /presonus/i, ['194F'], null),
    V('rode', 'RØDE', 'rode.com', /\brode\b|røde/i, ['19F7'], null),
    V('shure', 'Shure', 'shure.com', /\bshure\b/i, ['14ED'], null),
    V('audiotechnica', 'Audio-Technica', 'audio-technica.com', /audio-technica/i, ['0909'], null),
    V('sennheiser', 'Sennheiser', 'sennheiser.com', /sennheiser|epos/i, ['1395'], null),
    V('jabra', 'Jabra', 'jabra.com', /jabra|gn audio|gn netcom/i, ['0B0E'], null),
    V('harman', 'JBL', 'jbl.com', /\bjbl\b|harman/i, ['0ECB'], null),
    V('bose', 'Bose', 'bose.com', /\bbose\b/i, ['05A7'], null),
    V('elgato', 'Elgato', 'elgato.com', /elgato|corsair gaming.*capture/i, ['0FD9'], null),
    V('avermedia', 'AVerMedia', 'avermedia.com', /avermedia/i, ['07CA'], null),
    V('magewell', 'Magewell', 'magewell.com', /magewell/i, ['2935'], null),
    V('blackmagic', 'Blackmagic Design', 'blackmagicdesign.com', /blackmagic/i, ['1EDB'], null),
    // Câmeras, impressoras e outros periféricos
    V('canon', 'Canon', 'canon.com', /\bcanon\b/i, ['04A9'], null),
    V('epson', 'Epson', 'epson.com', /epson|seiko epson/i, ['04B8'], null),
    V('brother', 'Brother', 'brother.com', /\bbrother\b/i, ['04F9'], null),
    V('kyocera', 'Kyocera', 'kyocera.com', /kyocera/i, ['0482'], null),
    V('xerox', 'Xerox', 'xerox.com', /xerox/i, ['0924'], null),
    V('lexmark', 'Lexmark', 'lexmark.com', /lexmark/i, ['043D'], null),
    V('zebra', 'Zebra', 'zebra.com', /\bzebra\b/i, ['0A5F'], null),
    V('garmin', 'Garmin', 'garmin.com', /garmin/i, ['091E'], null),
    V('gopro', 'GoPro', 'gopro.com', /gopro/i, ['2672'], null),
    V('insta360', 'Insta360', 'insta360.com', /insta360|arashi vision/i, ['2E1A'], null),
    V('obsbot', 'OBSBOT', 'obsbot.com', /obsbot|remo tech/i, [], null),
    V('dji', 'DJI', 'dji.com', /\bdji\b/i, ['2CA3'], null),
    V('fujifilm', 'FUJIFILM', 'fujifilm.com', /fujifilm/i, ['04CB'], null),
    V('nikon', 'Nikon', 'nikon.com', /\bnikon\b/i, ['04B0'], null),
    V('anker', 'Anker', 'anker.com', /anker/i, ['291A'], null),
    V('ugreen', 'UGREEN', 'ugreen.com', /ugreen/i, [], null),
    V('belkin', 'Belkin', 'belkin.com', /belkin/i, ['050D'], null),
    V('plugable', 'Plugable', 'plugable.com', /plugable/i, [], null),
    V('caldigit', 'CalDigit', 'caldigit.com', /caldigit/i, [], null),
    V('apc', 'APC', 'apc.com', /american power conversion|\bapc\b/i, ['051D'], null),
    V('eaton', 'Eaton', 'eaton.com', /\beaton\b/i, ['0463'], null),
    V('sms', 'SMS', 'sms.com.br', /\bsms tecnologia\b/i, [], null),
    // Rede (marcas de placa e adaptadores)
    V('tplink', 'TP-Link', 'tp-link.com', /tp-?link/i, ['2357'], 'https://www.tp-link.com/br/support/download/'),
    V('dlink', 'D-Link', 'dlink.com', /d-link/i, ['2001', '1186'], null),
    V('netgear', 'NETGEAR', 'netgear.com', /netgear/i, ['0846'], null),
    V('edimax', 'Edimax', 'edimax.com', /edimax/i, ['7392'], null),
    V('cisco', 'Cisco', 'cisco.com', /\bcisco\b|anyconnect|secure client/i, [], null),
    V('fortinet', 'Fortinet', 'fortinet.com', /fortinet|forticlient/i, [], null),
    V('paloalto', 'Palo Alto Networks', 'paloaltonetworks.com', /palo alto|globalprotect/i, [], null),
    V('wireguard', 'WireGuard', 'wireguard.com', /wireguard|wintun/i, [], null),
    V('openvpn', 'OpenVPN', 'openvpn.net', /openvpn|tap-windows/i, [], null),
    V('tailscale', 'Tailscale', 'tailscale.com', /tailscale/i, [], null),
    V('zerotier', 'ZeroTier', 'zerotier.com', /zerotier/i, [], null),
    V('npcap', 'Npcap', 'npcap.com', /npcap|nmap/i, [], null),
    V('radmin', 'Radmin VPN', 'radmin-vpn.com', /radmin|famatech/i, [], null),
    V('hamachi', 'LogMeIn Hamachi', 'vpn.net', /hamachi|logmein/i, [], null),
    V('nordvpn', 'NordVPN', 'nordvpn.com', /nordvpn|nordlynx/i, [], null),
    V('protonvpn', 'Proton VPN', 'protonvpn.com', /proton vpn|protonvpn|proton ag/i, [], null),
    V('expressvpn', 'ExpressVPN', 'expressvpn.com', /expressvpn/i, [], null),
    V('cloudflare', 'Cloudflare WARP', 'cloudflare.com', /cloudflare/i, [], null),
    // Virtualização e software com driver próprio
    V('vmware', 'VMware', 'vmware.com', /vmware/i, ['15AD', '0E0F'], null),
    V('virtualbox', 'VirtualBox', 'virtualbox.org', /virtualbox|oracle corporation/i, ['80EE'], null),
    V('parsec', 'Parsec', 'parsec.app', /parsec/i, [], null),
    V('vbaudio', 'VB-Audio', 'vb-audio.com', /vb-audio|voicemeeter/i, [], null),
    V('obs', 'OBS Studio', 'obsproject.com', /\bobs\b|obs virtual/i, [], null),
    V('discord', 'Discord', 'discord.com', /discord/i, [], null),
    V('eac', 'Easy Anti-Cheat', 'easy.ac', /easy ?anti-?cheat|epic games/i, [], null),
    V('battleye', 'BattlEye', 'battleye.com', /battleye/i, [], null),
    V('riot', 'Riot Vanguard', 'riotgames.com', /vanguard|riot games/i, [], null),
    V('faceit', 'FACEIT', 'faceit.com', /faceit/i, [], null),
    V('rockstar', 'Rockstar Games', 'rockstargames.com', /rockstar/i, [], null),
    V('vigem', 'ViGEm', 'vigem.org', /vigem|nefarius/i, [], null),
    V('ds4windows', 'DS4Windows', 'ds4-windows.com', /ds4windows/i, [], null),
    V('kaspersky', 'Kaspersky', 'kaspersky.com', /kaspersky/i, [], null),
    V('eset', 'ESET', 'eset.com', /\beset\b/i, [], null),
    V('avast', 'Avast', 'avast.com', /avast|avg technologies|gen digital/i, [], null),
    V('bitdefender', 'Bitdefender', 'bitdefender.com', /bitdefender/i, [], null),
    V('norton', 'Norton', 'norton.com', /norton|symantec/i, [], null),
    V('mcafee', 'McAfee', 'mcafee.com', /mcafee/i, [], null),
    V('malwarebytes', 'Malwarebytes', 'malwarebytes.com', /malwarebytes/i, [], null),
    V('sophos', 'Sophos', 'sophos.com', /sophos/i, [], null),
    V('trendmicro', 'Trend Micro', 'trendmicro.com', /trend ?micro/i, [], null),
    V('crowdstrike', 'CrowdStrike', 'crowdstrike.com', /crowdstrike/i, [], null),
    V('veracrypt', 'VeraCrypt', 'veracrypt.fr', /veracrypt|idrix/i, [], null),
    V('docker', 'Docker', 'docker.com', /\bdocker\b/i, [], null),
    V('khronos', 'Khronos', 'khronos.org', /khronos/i, [], null),
    // Componentes que os jogos usam: o ícone do produto, no site oficial dele (não entram na busca por nome).
    V('vulkan', 'Vulkan', 'vulkan.org', /^$/, [], null, 'www.vulkan.org'),
    V('dotnet', '.NET', 'microsoft.com', /^$/, [], null, 'dotnet.microsoft.com'),
    V('vs', 'Visual C++', 'microsoft.com', /^$/, [], null, 'visualstudio.microsoft.com')
  ];
  const BY_KEY = Object.fromEntries(LIST.map((item) => [item.key, item]));
  /** Quem fez o driver: o provedor do pacote manda; depois o fabricante, o código do hardware e o nome do dispositivo. */
  function vendorOf(item = {}) {
    const ids = String(item.ids || '').toUpperCase();
    const ven = ids.split(':')[0];
    for (const text of [item.provider, item.maker]) {
      const t = String(text || '').trim();
      if (!t || /^(\(.*\)|standard|padrão|generic|genérico|unknown|desconhecido)/i.test(t)) continue;
      const hit = LIST.find((vendor) => vendor.re.test(t));
      if (hit) return hit;
    }
    if (ids) {
      const exact = LIST.find((vendor) => vendor.ids.includes(ids));
      if (exact) return exact;
      const byVen = LIST.find((vendor) => vendor.ids.includes(ven));
      if (byVen) return byVen;
    }
    const name = String(item.name || '');
    return name ? LIST.find((vendor) => vendor.re.test(name)) || null : null;
  }
  return { LIST, BY_KEY, vendorOf };
});
