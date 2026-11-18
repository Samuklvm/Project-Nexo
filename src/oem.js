/*
 * Drivers do fabricante do PC/placa-mãe (regras puras, usadas no processo principal e na tela):
 *  - identifica o modelo exato do PC (Dell pelo SKU, HP pelo código da placa, Lenovo pelo tipo de máquina, placas e
 *    notebooks de marca pelo nome do produto);
 *  - guarda os domínios e os assinantes permitidos de cada fonte (fixos aqui: a lista remota só escolhe entre eles);
 *  - casa cada pacote do catálogo com as peças do PC pelo código de hardware (o mais específico ganha) e compara a
 *    versão do driver número a número. Formato diferente = "unknown" (nunca pela data: o pacote sai sempre depois do
 *    driver que leva).
 *  - Vídeo nunca usa pacote do fabricante do PC (fica NVIDIA/AMD/Intel, decisão do Samuel). BIOS/firmware nunca.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoOem = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DOMAINS = Object.freeze({
    // Servidores exatos (não qualquer subdomínio): a lista remota e os catálogos só apontam para estes.
    'dell-catalog': Object.freeze(['downloads.dell.com', 'dl.dell.com']),
    'hpia-ref': Object.freeze(['hpia.hpcloud.hp.com', 'ftp.hp.com']),
    'lenovo-catalog': Object.freeze(['download.lenovo.com']),
    'asus-api': Object.freeze(['rog.asus.com', 'www.asus.com', 'dlcdnets.asus.com'])
  });
  const SIGNERS = Object.freeze({
    dell: Object.freeze(['Dell Inc', 'Dell Inc.', 'Dell Technologies']),
    hp: Object.freeze(['HP Inc.', 'HP Inc', 'Hewlett-Packard Company']),
    lenovo: Object.freeze(['Lenovo', 'Lenovo (Beijing) Limited']),
    asus: Object.freeze(['ASUSTeK COMPUTER INC.', 'ASUSTeK Computer Inc.'])
  });
  // Os fabricantes das peças que vêm dentro dos pacotes do fabricante do PC.
  const PART_SIGNERS = Object.freeze(['Intel Corporation', 'Advanced Micro Devices, Inc.', 'Realtek Semiconductor Corp.', 'Qualcomm Technologies, Inc.',
    'MediaTek Inc.', 'Synaptics Incorporated', 'ELAN Microelectronics Corp.', 'Microsoft Windows Hardware Compatibility Publisher', 'Microsoft Corporation']);
  const signersFor = (oem) => (Object.prototype.hasOwnProperty.call(SIGNERS, oem) ? [...SIGNERS[oem], ...PART_SIGNERS] : []);

  /* ---------------- Identificação do PC ---------------- */
  const GENERIC = /^(system manufacturer|to be filled by o\.?e\.?m\.?|default string|o\.?e\.?m\.?|not applicable|none|system product name|system version|type1productconfigid|n\/a|)$/i;
  const clean = (value) => { const v = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80); return GENERIC.test(v) ? '' : v; };
  const BRANDS = [
    ['asus', /asus|asustek|republic of gamers/i, 'ASUS'],
    ['msi', /micro-star|\bmsi\b/i, 'MSI'],
    ['gigabyte', /gigabyte|aorus/i, 'GIGABYTE'],
    ['asrock', /asrock/i, 'ASRock'],
    ['acer', /\bacer\b|predator/i, 'Acer']
  ];
  const prefixed = (brand, name) => (name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`);

  function identify(board) {
    if (!board || typeof board !== 'object') return null;
    const sys = clean(board.systemMaker);
    const maker = clean(board.maker);
    const model = clean(board.model);
    const product = clean(board.product);
    if (/\b(dell|alienware)\b/i.test(sys)) {
      const sku = clean(board.sku).toUpperCase();
      if (!/^[0-9A-F]{4}$/.test(sku)) return null;
      return { oem: 'dell', key: sku, label: /alienware/i.test(model) ? model : prefixed('Dell', model || 'PC') };
    }
    if (/^(hp|hewlett[- ]packard)\b/i.test(sys)) {
      const code = product.toUpperCase();
      if (!/^[0-9A-F]{4}$/.test(code)) return null;
      return { oem: 'hp', key: code, label: prefixed('HP', model || code) };
    }
    if (/lenovo/i.test(sys)) {
      const type = model.slice(0, 4).toUpperCase();
      if (!/^[0-9A-Z]{4}$/.test(type)) return null;
      return { oem: 'lenovo', key: type, label: prefixed('Lenovo', clean(board.version) || model) };
    }
    for (const [oem, re, brand] of BRANDS) {
      if (!re.test(maker) && !re.test(sys)) continue;
      const key = (board.mobile === true ? model : product) || model || product;
      return key ? { oem, key, label: prefixed(brand, key) } : null;
    }
    return null;
  }

  /* ---------------- Códigos de hardware ---------------- */
  function normalizeHwid(id) {
    const v = String(id ?? '').trim().toUpperCase();
    return v && v.length <= 200 && /^[A-Z0-9_&\\.*-]+$/.test(v) ? v : null;
  }
  function splitHwid(id) {
    const slash = id.indexOf('\\');
    return slash < 0 ? { bus: '', tokens: id.split('&') } : { bus: id.slice(0, slash), tokens: id.slice(slash + 1).split('&') };
  }
  /** 3 = igual com SUBSYS; 2 = igual sem SUBSYS (com REV/FUNC) ou curinga no fim; 1 = só VEN&DEV; 0 = não casa. */
  function hwidRank(deviceId, packageId) {
    const dev = normalizeHwid(deviceId);
    const pkg = normalizeHwid(packageId);
    if (!dev || !pkg) return 0;
    const star = pkg.indexOf('*');
    // Curinga (Lenovo) só no fim e depois de um código de dispositivo completo: vale como VEN&DEV.
    if (star >= 0) {
      const prefix = pkg.slice(0, -1);
      const whole = splitHwid(prefix).tokens.some((token) => /^(DEV|PID)_[0-9A-F]{4}$/.test(token));
      return star === pkg.length - 1 && whole && dev.startsWith(prefix) ? 1 : 0;
    }
    const d = splitHwid(dev);
    const p = splitHwid(pkg);
    if (d.bus !== p.bus || !p.tokens.every((token) => d.tokens.includes(token))) return 0;
    if (p.tokens.some((token) => token.startsWith('SUBSYS_'))) return 3;
    return p.tokens.some((token) => !/^(VEN|DEV|VID|PID)_/.test(token)) ? 2 : 1;
  }

  /* ---------------- Versões ---------------- */
  function compareVersions(a, b) {
    const pa = String(a ?? '').split('.');
    const pb = String(b ?? '').split('.');
    if (pa.length !== pb.length || pa.length < 2 || ![...pa, ...pb].every((part) => /^\d{1,9}$/.test(part))) return null;
    for (let i = 0; i < pa.length; i += 1) { const diff = Number(pa[i]) - Number(pb[i]); if (diff) return diff > 0 ? 1 : -1; }
    return 0;
  }
  /** O pacote comparado com o driver instalado: 'newer' | 'same' | 'older' | 'unknown'. */
  function compareToInstalled(installed, pkg) {
    const cmp = compareVersions(pkg?.driverVersion, installed);
    if (cmp === null) return 'unknown';
    return cmp > 0 ? 'newer' : cmp === 0 ? 'same' : 'older';
  }

  /* ---------------- Casamento pacote ↔ peça ---------------- */
  /*
   * Pacotes sem códigos (ASUS): a CATEGORIA do pacote precisa ser a da classe do dispositivo (lista exata), o fabricante
   * da peça precisa estar no título, na rede Wi-Fi e cabo não se misturam, e no chipset/armazenamento o título precisa
   * falar da peça (Serial IO, Management Engine...). Na dúvida não casa: fica o botão do site.
   */
  const CATEGORY = { MEDIA: ['audio', 'sound'], NET: ['lan', 'wireless', 'wlan', 'wifi', 'wi-fi', 'network', 'networking'], BLUETOOTH: ['bluetooth'], SYSTEM: ['chipset'], HDC: ['sata', 'raid', 'storage', 'rst', 'nvme'], SCSIADAPTER: ['sata', 'raid', 'storage', 'rst', 'nvme'] };
  const WIRELESS = /wi-?fi|wireless|wlan|802\.11/i;
  const STOP = new Set(['driver', 'drivers', 'intel', 'amd', 'realtek', 'for', 'windows', 'and', 'the', 'with', 'version', 'x64', '64', 'bit', 'r', 'tm', 'utility', 'package', 'legacy', 'whql']);
  const words = (value) => String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
  function byCategory(device, pkg) {
    const cls = String(device.cls || '').toUpperCase();
    const allowed = CATEGORY[cls];
    const category = String(pkg.category || '').trim().toLowerCase();
    const title = String(pkg.title || '');
    const maker = String(device.maker || '').split(/[\s(]/)[0].toLowerCase();
    if (!allowed || !allowed.includes(category) || maker.length < 3 || !title.toLowerCase().includes(maker)) return 0;
    if (cls === 'NET') {
      const pkgWireless = ['wireless', 'wlan', 'wifi', 'wi-fi'].includes(category) || WIRELESS.test(title);
      if (pkgWireless !== WIRELESS.test(String(device.name || ''))) return 0;
    }
    if (cls === 'SYSTEM' || cls === 'HDC' || cls === 'SCSIADAPTER') {
      const name = new Set(words(device.name));
      if (!words(title).some((w) => w !== maker && name.has(w))) return 0;
    }
    return 1;
  }
  function rankFor(device, pkg) {
    const ids = Array.isArray(pkg.hardwareIds) ? pkg.hardwareIds : [];
    if (!ids.length) return byCategory(device, pkg);
    let best = 0;
    for (const d of device.hwids || []) for (const p of ids) best = Math.max(best, hwidRank(d, p));
    return best;
  }
  const dateOf = (pkg) => { const t = Date.parse(pkg?.date || ''); return Number.isFinite(t) ? t : 0; };
  const noIds = (pkg) => !Array.isArray(pkg.hardwareIds) || !pkg.hardwareIds.length;
  function better(a, b) {
    if (a.rank !== b.rank) return a.rank > b.rank;
    // Casados só por categoria podem ser produtos diferentes: aí vale a data, nunca a versão de um contra o outro.
    if (noIds(a.pkg) && noIds(b.pkg)) return dateOf(a.pkg) > dateOf(b.pkg);
    const cmp = compareVersions(a.pkg.driverVersion, b.pkg.driverVersion);
    if (cmp) return cmp > 0;
    return dateOf(a.pkg) > dateOf(b.pkg);
  }
  /** Para cada peça (menos vídeo), o melhor pacote; devolve [{ pkg, devices }] na ordem dos pacotes. */
  function matchPackages(devices, packages) {
    const list = (Array.isArray(packages) ? packages : []).filter((p) => p && !p.bios && !p.firmware);
    const chosen = new Map();
    for (const device of Array.isArray(devices) ? devices : []) {
      if (!device || String(device.cls || '').toUpperCase() === 'DISPLAY') continue;
      let best = null;
      for (const pkg of list) {
        const rank = rankFor(device, pkg);
        if (rank && (!best || better({ rank, pkg }, best))) best = { rank, pkg };
      }
      if (best) { if (!chosen.has(best.pkg)) chosen.set(best.pkg, []); chosen.get(best.pkg).push(device); }
    }
    return list.filter((pkg) => chosen.has(pkg)).map((pkg) => ({ pkg, devices: chosen.get(pkg) }));
  }

  return { DOMAINS, SIGNERS, PART_SIGNERS, signersFor, identify, normalizeHwid, hwidRank, compareVersions, compareToInstalled, matchPackages };
});
