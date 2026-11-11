/*
 * Base de conhecimento de peças: o Nexo ENTENDE a peça, não só lê o nome. Em vez de uma lista de modelos (que nunca
 * está completa), decodifica a nomenclatura dos fabricantes: geração e arquitetura do processador, chipset da placa-mãe,
 * velocidade nominal da memória pelo código do pente, família da placa de vídeo. E cruza com o que o próprio sistema
 * informa (canais da memória, link PCIe real, modos do monitor). Peça que não reconheço continua analisada pelo que
 * o sistema mostra dela, com `known: false`.
 * Funções puras: a coleta fica em electron/deep-scan.cjs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoHardware = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 24 * 3600 * 1000;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const str = (value, max = 120) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const GB = 1024 ** 3;

  /** Tira as marcas registradas e o "CPU @ 3.60GHz" do nome, que só atrapalham a leitura. */
  function cleanName(value) {
    return str(value, 160).replace(/\((?:R|TM|tm|r)\)|®|™/g, '').replace(/\s+CPU\s+@.*$/i, '').replace(/\s+@\s*[\d.]+\s*GHz.*$/i, '')
      .replace(/\s+\d{1,2}-Core Processor$/i, '').replace(/\s+(?:Six|Eight|Quad|Twelve|Sixteen)-Core Processor$/i, '').replace(/\s+Processor$/i, '').replace(/\s{2,}/g, ' ').trim();
  }

  // Textos de preenchimento que fabricantes deixam no lugar do nome (não são nome de nada).
  const PLACEHOLDER = /^(to be filled by o\.?e\.?m\.?|default string|system manufacturer|system product name|system version|base board manufacturer|base board product name|not applicable|n\/a|none|o\.?e\.?m\.?|0+|x+|123456789|type1productconfigid|invalid)$/i;
  const MAKERS = [[/^asustek|^asus\b/i, 'ASUS'], [/^micro-star|^msi\b/i, 'MSI'], [/^gigabyte/i, 'Gigabyte'], [/^asrock/i, 'ASRock'], [/^biostar/i, 'Biostar'], [/^dell/i, 'Dell'], [/^hewlett|^hp\b|^hpe?\b/i, 'HP'], [/^lenovo/i, 'Lenovo'], [/^acer/i, 'Acer'], [/^samsung/i, 'Samsung'], [/^apple/i, 'Apple'], [/^microsoft/i, 'Microsoft'], [/^intel/i, 'Intel'], [/^positivo/i, 'Positivo'], [/^colorful/i, 'Colorful'], [/^evga/i, 'EVGA'], [/^nzxt/i, 'NZXT'], [/^razer/i, 'Razer'], [/^valve/i, 'Valve'], [/^huawei/i, 'Huawei'], [/^xiaomi|^timi/i, 'Xiaomi'], [/^lg electronics/i, 'LG'], [/^toshiba|^dynabook/i, 'Dynabook'], [/^machenike/i, 'Machenike'], [/^avell/i, 'Avell'], [/^vaio/i, 'VAIO']];
  /** Nome do fabricante legível ("ASUSTeK COMPUTER INC." → ASUS); texto de preenchimento vira null. */
  function maker(value) {
    const name = str(value, 60);
    if (!name || PLACEHOLDER.test(name)) return null;
    const known = MAKERS.find(([pattern]) => pattern.test(name));
    return known ? known[1] : name.replace(/\s+(Inc\.?|Co\.?,?\s*Ltd\.?|Corporation|Corp\.?|Technology|Ltd\.?|International|Co\.)$/i, '').trim();
  }
  const product = (value, max = 60) => { const name = str(value, max); return name && !PLACEHOLDER.test(name) ? name : null; };

  /** Idade em dias a partir de uma data ISO (AAAA-MM-DD); null se a data for inválida ou do futuro. */
  function ageDays(iso, now = Date.now()) {
    const at = Date.parse(String(iso || ''));
    if (!Number.isFinite(at) || at > now + DAY) return null;
    return Math.max(0, Math.floor((now - at) / DAY));
  }

  /* ======================================================================================================
   * Processador
   * ==================================================================================================== */
  const INTEL_GENS = {
    1: { arch: 'Nehalem / Westmere', year: 2008, socket: 'LGA1156', ddr: ['DDR3'], pcie: 2 },
    2: { arch: 'Sandy Bridge', year: 2011, socket: 'LGA1155', ddr: ['DDR3'], pcie: 2 },
    3: { arch: 'Ivy Bridge', year: 2012, socket: 'LGA1155', ddr: ['DDR3'], pcie: 3 },
    4: { arch: 'Haswell', year: 2013, socket: 'LGA1150', ddr: ['DDR3'], pcie: 3 },
    5: { arch: 'Broadwell', year: 2015, socket: 'LGA1150', ddr: ['DDR3'], pcie: 3 },
    6: { arch: 'Skylake', year: 2015, socket: 'LGA1151', ddr: ['DDR4', 'DDR3L'], pcie: 3 },
    7: { arch: 'Kaby Lake', year: 2017, socket: 'LGA1151', ddr: ['DDR4'], pcie: 3 },
    8: { arch: 'Coffee Lake', mobileArch: 'Kaby Lake R / Whiskey Lake', mobileHArch: 'Coffee Lake-H', year: 2017, socket: 'LGA1151 v2', ddr: ['DDR4'], pcie: 3 },
    9: { arch: 'Coffee Lake Refresh', year: 2018, socket: 'LGA1151 v2', ddr: ['DDR4'], pcie: 3 },
    10: { arch: 'Comet Lake', mobileArch: 'Comet Lake', mobileGArch: 'Ice Lake', year: 2020, socket: 'LGA1200', ddr: ['DDR4'], pcie: 3 },
    11: { arch: 'Rocket Lake', mobileArch: 'Tiger Lake', year: 2021, socket: 'LGA1200', ddr: ['DDR4'], pcie: 4 },
    12: { arch: 'Alder Lake', year: 2021, socket: 'LGA1700', ddr: ['DDR4', 'DDR5'], pcie: 5, mobilePcie: 4, hybrid: true },
    13: { arch: 'Raptor Lake', year: 2022, socket: 'LGA1700', ddr: ['DDR4', 'DDR5'], pcie: 5, mobilePcie: 4, hybrid: true },
    14: { arch: 'Raptor Lake Refresh', year: 2023, socket: 'LGA1700', ddr: ['DDR4', 'DDR5'], pcie: 5, mobilePcie: 4, hybrid: true }
  };
  const INTEL_MOBILE = /^(?:H|HK|HX|HQ|HS|U|Y|P|G\d|V|M|MQ|MX)$/;

  /** Sufixos da Intel → o que significam (K destravado, F sem vídeo integrado, H notebook potente…). */
  function intelSuffix(suffix) {
    const s = String(suffix || '').toUpperCase();
    return {
      unlocked: /^(K|KF|KS|X|XE|HK|HX)$/.test(s),
      igpu: s.includes('F') ? false : true,
      mobile: INTEL_MOBILE.test(s),
      lowPower: /^(T|U|Y|G\d|V)$/.test(s)
    };
  }

  function decodeIntel(name, cores, threads) {
    const out = { vendor: 'Intel' };
    let m = name.match(/Core\s+Ultra\s+([3579])\s+(\d)(\d{2})([A-Z]{0,2})\b/i);
    if (m) {
      const series = Number(m[2]);
      const suffix = m[4].toUpperCase();
      const desktop = /^(K|KF|F|T|)$/.test(suffix) && series >= 2;
      const lunar = suffix === 'V';
      Object.assign(out, {
        family: `Core Ultra ${m[1]}`, model: `${m[2]}${m[3]}${suffix}`, generation: null, generationLabel: `Core Ultra série ${series}`,
        architecture: series === 1 ? 'Meteor Lake' : lunar ? 'Lunar Lake' : 'Arrow Lake', segment: desktop ? 'desktop' : 'laptop',
        socket: desktop ? 'LGA1851' : null, memoryTypes: ['DDR5'], pcie: desktop ? 5 : 4, hybrid: true, unlocked: /K/.test(suffix) || suffix === 'HX',
        igpu: !suffix.includes('F'), year: series === 1 ? 2023 : 2024, known: true
      });
      if (lunar) out.notes = ['memória dentro do próprio processador (não dá para trocar nem aumentar)'];
      return out;
    }
    m = name.match(/\bCore\s+([357])\s+(\d)(\d{2})([A-Z]{0,2})\b/i);
    if (m) {
      Object.assign(out, { family: `Core ${m[1]}`, model: `${m[2]}${m[3]}${m[4].toUpperCase()}`, generationLabel: `Core série ${m[2]}`, architecture: 'Raptor Lake', segment: 'laptop', memoryTypes: ['DDR4', 'DDR5'], pcie: 4, hybrid: true, igpu: true, year: m[2] === '1' ? 2024 : 2025, known: true });
      return out;
    }
    m = name.match(/\b(?:Core\s+i3-)?N(\d{2,3})\b/);
    if (m && /\bN\d{2,3}\b/.test(name) && !/Celeron\s+N\d{4}|Pentium.*N\d{4}/i.test(name)) {
      Object.assign(out, { family: /i3/i.test(name) ? 'Core i3' : null, model: `N${m[1]}`, generationLabel: 'série N', architecture: 'Alder Lake-N', segment: 'laptop', memoryTypes: ['DDR4', 'DDR5', 'LPDDR5'], pcie: 3, hybrid: false, efficiencyOnly: true, igpu: true, year: 2023, known: true,
        notes: ['só núcleos de eficiência', 'memória em canal único por projeto do processador'] });
      return out;
    }
    m = name.match(/\bi([3579])-(\d{3,5})([A-Z]{0,2}\d?)\b/i);
    if (m) {
      const digits = m[2];
      const generation = digits.length === 3 ? 1 : digits.startsWith('1') && /^1[0-4]/.test(digits) ? Number(digits.slice(0, 2)) : Number(digits[0]);
      const info = INTEL_GENS[generation];
      const suffix = m[3].toUpperCase();
      const flags = intelSuffix(suffix);
      const mobile = flags.mobile;
      let architecture = info ? info.arch : null;
      if (info && mobile) architecture = (/^G\d$/.test(suffix) && info.mobileGArch) || (/^H/.test(suffix) && info.mobileHArch) || info.mobileArch || info.arch;
      const desktopI5NonK12 = generation === 12 && m[1] === '5' && !mobile && !/K/.test(suffix);
      let hybrid = info?.hybrid ? !(m[1] === '3' && !mobile) && !desktopI5NonK12 : false;
      // Topologia real vence a regra do nome: P com HT + E sem HT dá threads ≠ 2 × núcleos.
      if (info?.hybrid && finite(cores) && finite(threads) && cores > 0) hybrid = threads !== cores * 2 && threads > cores ? true : threads === cores * 2 ? false : hybrid;
      Object.assign(out, {
        family: `Core i${m[1]}`, model: `${digits}${suffix}`, generation, generationLabel: `${generation}ª geração`, architecture,
        segment: mobile ? 'laptop' : 'desktop', socket: mobile ? null : info?.socket || null, memoryTypes: info?.ddr || null,
        pcie: info ? (mobile && info.mobilePcie ? info.mobilePcie : info.pcie) : null, hybrid, unlocked: flags.unlocked,
        igpu: flags.igpu, year: info?.year || null, known: Boolean(info)
      });
      // 13ª/14ª geração de desktop com 65 W ou mais: instabilidade por desgaste de tensão (Vmin shift).
      if ((generation === 13 || generation === 14) && !mobile && suffix !== 'T' && (m[1] === '7' || m[1] === '9' || /K/.test(suffix))) out.raptorRisk = true;
      return out;
    }
    if (/Xeon/i.test(name)) Object.assign(out, { family: 'Xeon', model: (name.match(/Xeon\s+(.+)$/i) || [])[1] || null, segment: 'workstation', known: false });
    else if (/Pentium|Celeron|Atom/i.test(name)) Object.assign(out, { family: (name.match(/Pentium|Celeron|Atom/i) || [''])[0], model: (name.match(/(?:Pentium|Celeron|Atom)(?:\s+(?:Gold|Silver))?\s+([A-Z]?\d{3,5}[A-Z]?)/i) || [])[1] || null, segment: 'entrada', known: false });
    else if (/Core.?2/i.test(name)) Object.assign(out, { family: 'Core 2', generationLabel: 'anterior à 1ª geração', year: 2006, memoryTypes: ['DDR2', 'DDR3'], known: true });
    return out;
  }

  const AMD_ZEN = { zen: 'Zen', 'zen+': 'Zen+', zen2: 'Zen 2', zen3: 'Zen 3', 'zen3+': 'Zen 3+', zen4: 'Zen 4', zen5: 'Zen 5' };
  const AMD_YEAR = { zen: 2017, 'zen+': 2018, zen2: 2019, zen3: 2020, 'zen3+': 2022, zen4: 2022, zen5: 2024 };
  const DUAL_CCD_X3D = new Set(['7900X3D', '7950X3D', '9900X3D', '9950X3D']);
  // Ryzen de desktop derivados de APU (Renoir/Cezanne): mesmo numa B550, o slot da placa de vídeo roda em PCIe 3.0.
  const CEZANNE_PLAIN = new Set(['5500', '5700', '5100', '4500', '4100']);
  const AMD_MOBILE = /^(U|H|HS|HX|HX3D|H3D|HZ|E)$/;

  function decodeRyzen(tier, number, suffixRaw) {
    const suffix = String(suffixRaw || '').toUpperCase();
    const series = Number(number[0]);
    const mobile = AMD_MOBILE.test(suffix);
    const apu = /G/.test(suffix);
    let zen = null;
    let codename = null;
    if (mobile) {
      if (series >= 7) {
        const code = Number(number[2]);
        zen = { 1: 'zen+', 2: 'zen2', 3: number[3] === '5' ? 'zen3+' : 'zen3', 4: 'zen4', 5: 'zen5' }[code] || null;
      } else zen = { 2: 'zen', 3: 'zen+', 4: 'zen2', 5: Number(number[1]) % 2 === 1 ? 'zen2' : 'zen3', 6: 'zen3+' }[series] || null;
    } else if (apu || CEZANNE_PLAIN.has(number)) {
      zen = { 2: 'zen', 3: 'zen+', 4: 'zen2', 5: 'zen3', 8: 'zen4' }[series] || null;
      codename = { 2: 'Raven Ridge', 3: 'Picasso', 4: 'Renoir', 5: 'Cezanne', 8: 'Phoenix' }[series] || null;
    } else {
      zen = { 1: 'zen', 2: 'zen+', 3: 'zen2', 5: 'zen3', 7: 'zen4', 8: 'zen4', 9: 'zen5' }[series] || null;
      codename = { 1: 'Summit Ridge', 2: 'Pinnacle Ridge', 3: 'Matisse', 5: 'Vermeer', 7: 'Raphael', 8: 'Phoenix', 9: 'Granite Ridge' }[series] || null;
    }
    const am5 = !mobile && series >= 7;
    const model = `${number}${suffix}`;
    const x3d = /X3D/.test(suffix);
    const desktopApuPcie3 = !mobile && (series === 4 || (series === 5 && (apu || CEZANNE_PLAIN.has(number))) || (series === 3 && apu) || (series === 2 && apu));
    let pcie = null;
    if (!mobile) pcie = am5 ? (series === 8 ? 4 : 5) : desktopApuPcie3 || series <= 2 ? 3 : 4;
    let igpu = mobile || apu;
    if (!mobile && am5) igpu = !suffix.includes('F');
    return {
      vendor: 'AMD', family: `Ryzen ${tier}`, model, generation: series, generationLabel: `Ryzen ${series}000`,
      architecture: zen ? AMD_ZEN[zen] : null, codename, zen, segment: mobile ? 'laptop' : 'desktop',
      socket: mobile ? null : am5 ? 'AM5' : 'AM4', memoryTypes: mobile ? null : am5 ? ['DDR5'] : ['DDR4'], pcie,
      unlocked: !mobile && !x3d ? true : !mobile && x3d ? 'parcial' : suffix === 'HX', igpu, x3d, dualCcdX3d: DUAL_CCD_X3D.has(model),
      apuPcie3: desktopApuPcie3, year: zen ? AMD_YEAR[zen] : null, hybrid: false, known: Boolean(zen)
    };
  }

  function decodeAmd(name) {
    let m = name.match(/Ryzen\s+AI\s+(?:(Max\+?)\s+(?:PRO\s+)?|([579])\s+(?:PRO\s+)?(HX\s+)?)(\d{3})/i);
    if (m) return { vendor: 'AMD', family: m[1] ? 'Ryzen AI Max' : `Ryzen AI ${m[2]}`, model: `${m[3] ? 'HX ' : ''}${m[4]}`, generationLabel: 'Ryzen AI 300', architecture: 'Zen 5', zen: 'zen5', segment: 'laptop', igpu: true, hybrid: false, year: 2024, known: true, memoryTypes: ['DDR5', 'LPDDR5X'], pcie: 4 };
    m = name.match(/Ryzen\s+Z(\d)\s*(Extreme|Go)?/i);
    if (m) return { vendor: 'AMD', family: `Ryzen Z${m[1]}`, model: m[2] || null, generationLabel: 'portátil de jogos', architecture: m[1] === '1' ? 'Zen 4' : null, segment: 'handheld', igpu: true, hybrid: false, known: m[1] === '1', year: m[1] === '1' ? 2023 : 2025 };
    m = name.match(/Threadripper\s+(?:PRO\s+)?(\d{4})(WX|X)?/i);
    if (m) {
      const zen = { 1: 'zen', 2: 'zen+', 3: 'zen2', 5: 'zen3', 7: 'zen4', 9: 'zen5' }[m[1][0]] || null;
      return { vendor: 'AMD', family: 'Threadripper', model: `${m[1]}${(m[2] || '').toUpperCase()}`, generationLabel: `Threadripper ${m[1][0]}000`, architecture: zen ? AMD_ZEN[zen] : null, zen, segment: 'workstation', igpu: false, hybrid: false, unlocked: true, known: Boolean(zen), year: zen ? AMD_YEAR[zen] : null };
    }
    m = name.match(/Ryzen\s+([3579])\s+(?:PRO\s+)?(\d{4})([A-Z0-9]{0,4})\b/i);
    if (m) return decodeRyzen(m[1], m[2], m[3]);
    if (/\bFX\b|FX-\d{4}/i.test(name)) return { vendor: 'AMD', family: 'FX', model: (name.match(/FX-?(\d{4})/i) || [])[1] || null, architecture: 'Bulldozer / Piledriver', socket: 'AM3+', memoryTypes: ['DDR3'], pcie: 2, segment: 'desktop', igpu: false, year: 2012, known: true };
    if (/Athlon|\bA\d{1,2}-\d{4}|Sempron|Phenom/i.test(name)) return { vendor: 'AMD', family: (name.match(/Athlon|Sempron|Phenom|A\d{1,2}/i) || [''])[0], model: null, segment: 'entrada', known: false, igpu: /with Radeon|Vega/i.test(name) || null };
    return { vendor: 'AMD', known: false };
  }

  /**
   * Decodifica o processador a partir do nome que o sistema informa ("12th Gen Intel(R) Core(TM) i5-12400F",
   * "AMD Ryzen 7 5800X3D 8-Core Processor"…). Núcleos e threads reais completam o que o nome não diz.
   */
  function decodeCpu(cpu) {
    const raw = cpu && typeof cpu === 'object' ? cpu : {};
    const name = cleanName(raw.name);
    const cores = finite(raw.cores) && raw.cores > 0 ? raw.cores : null;
    const threads = finite(raw.threads) && raw.threads > 0 ? raw.threads : null;
    let decoded;
    if (/Intel|Core|Xeon|Pentium|Celeron|Atom/i.test(name) || /intel/i.test(raw.manufacturer || '')) decoded = decodeIntel(name, cores, threads);
    else if (/AMD|Ryzen|Athlon|Threadripper|EPYC/i.test(name) || /amd/i.test(raw.manufacturer || '')) decoded = decodeAmd(name);
    else if (/Apple|Snapdragon|Qualcomm|ARM|Cortex/i.test(name)) decoded = { vendor: /Apple/i.test(name) ? 'Apple' : 'Qualcomm', segment: 'laptop', known: false, arm: true };
    else decoded = { vendor: str(raw.manufacturer, 40) || null, known: false };
    return {
      name, cores, threads, baseMHz: finite(raw.baseMHz) && raw.baseMHz > 100 ? raw.baseMHz : null, l3KB: finite(raw.l3KB) && raw.l3KB > 0 ? raw.l3KB : null,
      family: null, model: null, generation: null, generationLabel: null, architecture: null, segment: null, socket: str(raw.socket, 30) || null,
      memoryTypes: null, pcie: null, unlocked: null, igpu: null, hybrid: null, x3d: false, dualCcdX3d: false, apuPcie3: false, year: null, notes: [],
      ...decoded, socketReported: str(raw.socket, 30) || null
    };
  }

  /* ======================================================================================================
   * Placa-mãe (chipset)
   * ==================================================================================================== */
  const C = (id, vendor, socket, ddr, pcie, cpuOc, memOc, cpus, note = null) => ({ id, vendor, socket, ddr, pcie, cpuOc, memOc, cpus, note });
  const CHIPSETS = [
    // AMD AM4
    C('A320', 'AMD', 'AM4', 'DDR4', 'PCIe 3.0', false, 'limitado', 'Ryzen 1000 a 3000 (alguns 5000 com BIOS nova)', 'placa de entrada: processadores de 8 núcleos ou mais podem perder clock em carga longa'),
    C('B350', 'AMD', 'AM4', 'DDR4', 'PCIe 3.0', true, true, 'Ryzen 1000 a 5000 (5000 com BIOS nova)'),
    C('X370', 'AMD', 'AM4', 'DDR4', 'PCIe 3.0', true, true, 'Ryzen 1000 a 5000 (5000 com BIOS nova)'),
    C('B450', 'AMD', 'AM4', 'DDR4', 'PCIe 3.0', true, true, 'Ryzen 1000 a 5000 (5000 com BIOS nova)'),
    C('X470', 'AMD', 'AM4', 'DDR4', 'PCIe 3.0', true, true, 'Ryzen 1000 a 5000 (5000 com BIOS nova)'),
    C('A520', 'AMD', 'AM4', 'DDR4', 'PCIe 3.0', false, true, 'Ryzen 3000 e 5000', 'sem overclock do processador; a memória aceita XMP/DOCP'),
    C('B550', 'AMD', 'AM4', 'DDR4', 'PCIe 4.0 no slot da placa de vídeo e no primeiro M.2; 3.0 nos demais', true, true, 'Ryzen 3000 (sem G), 4000G e 5000', 'com Ryzen 5000G/5500/5700 ou 4000G o slot da placa de vídeo cai para PCIe 3.0 (limite do processador)'),
    C('X570', 'AMD', 'AM4', 'DDR4', 'PCIe 4.0 em tudo', true, true, 'Ryzen 2000 a 5000'),
    // AMD AM5
    C('A620', 'AMD', 'AM5', 'DDR5', 'PCIe 4.0', false, true, 'Ryzen 7000, 8000G e 9000', 'sem overclock do processador; processadores de 105 W ou mais podem ser limitados pela placa'),
    C('B650', 'AMD', 'AM5', 'DDR5', 'PCIe 4.0 na placa de vídeo, 5.0 em pelo menos um M.2', true, true, 'Ryzen 7000, 8000G e 9000'),
    C('B650E', 'AMD', 'AM5', 'DDR5', 'PCIe 5.0 na placa de vídeo e no M.2', true, true, 'Ryzen 7000, 8000G e 9000'),
    C('X670', 'AMD', 'AM5', 'DDR5', 'PCIe 5.0 no M.2', true, true, 'Ryzen 7000, 8000G e 9000'),
    C('X670E', 'AMD', 'AM5', 'DDR5', 'PCIe 5.0 na placa de vídeo e no M.2', true, true, 'Ryzen 7000, 8000G e 9000'),
    C('B840', 'AMD', 'AM5', 'DDR5', null, false, true, 'Ryzen 7000, 8000G e 9000', 'chipset de entrada da série 800'),
    C('B850', 'AMD', 'AM5', 'DDR5', 'PCIe 5.0 no M.2', true, true, 'Ryzen 7000, 8000G e 9000'),
    C('X870', 'AMD', 'AM5', 'DDR5', 'PCIe 5.0 na placa de vídeo e no M.2', true, true, 'Ryzen 7000, 8000G e 9000'),
    C('X870E', 'AMD', 'AM5', 'DDR5', 'PCIe 5.0 na placa de vídeo e no M.2', true, true, 'Ryzen 7000, 8000G e 9000'),
    // AMD HEDT e antigos
    C('X399', 'AMD', 'TR4', 'DDR4 (4 canais)', 'PCIe 3.0', true, true, 'Threadripper 1000 e 2000'),
    C('TRX40', 'AMD', 'sTRX4', 'DDR4 (4 canais)', 'PCIe 4.0', true, true, 'Threadripper 3000'),
    C('TRX50', 'AMD', 'sTR5', 'DDR5 (4 canais)', 'PCIe 5.0', true, true, 'Threadripper 7000 e 9000'),
    C('WRX80', 'AMD', 'sWRX8', 'DDR4 (8 canais)', 'PCIe 4.0', true, true, 'Threadripper PRO 3000WX e 5000WX'),
    C('WRX90', 'AMD', 'sTR5', 'DDR5 (8 canais)', 'PCIe 5.0', true, true, 'Threadripper PRO 7000WX e 9000WX'),
    C('990FX', 'AMD', 'AM3+', 'DDR3', 'PCIe 2.0', true, true, 'FX e Phenom II'),
    C('970', 'AMD', 'AM3+', 'DDR3', 'PCIe 2.0', true, true, 'FX e Phenom II'),
    // Intel
    ...['H61', 'B65', 'H67', 'P67', 'Z68', 'Q67'].map((id) => C(id, 'Intel', 'LGA1155', 'DDR3', 'PCIe 2.0', id === 'P67' || id === 'Z68', id === 'P67' || id === 'Z68', '2ª e 3ª geração')),
    ...['B75', 'H77', 'Z75', 'Z77', 'Q77'].map((id) => C(id, 'Intel', 'LGA1155', 'DDR3', 'PCIe 3.0 com 3ª geração', id.startsWith('Z'), id.startsWith('Z'), '2ª e 3ª geração')),
    ...['H81', 'B85', 'H87', 'Z87', 'Q87'].map((id) => C(id, 'Intel', 'LGA1150', 'DDR3', 'PCIe 3.0', id === 'Z87', id === 'Z87', '4ª geração')),
    ...['H97', 'Z97'].map((id) => C(id, 'Intel', 'LGA1150', 'DDR3', 'PCIe 3.0', id === 'Z97', id === 'Z97', '4ª e 5ª geração')),
    C('X79', 'Intel', 'LGA2011', 'DDR3 (4 canais)', 'PCIe 3.0', true, true, 'Core i7 série X (Sandy/Ivy Bridge-E)'),
    C('X99', 'Intel', 'LGA2011-3', 'DDR4 (4 canais)', 'PCIe 3.0', true, true, 'Core i7 série X (Haswell/Broadwell-E)'),
    C('X299', 'Intel', 'LGA2066', 'DDR4 (4 canais)', 'PCIe 3.0', true, true, 'Core série X (Skylake-X em diante)'),
    ...['H110', 'B150', 'H170', 'Z170', 'Q170', 'B250', 'H270', 'Z270', 'Q270'].map((id) => C(id, 'Intel', 'LGA1151', 'DDR4', 'PCIe 3.0', id.startsWith('Z'), id.startsWith('Z'), '6ª e 7ª geração',
      id.startsWith('Z') ? null : 'a memória fica presa na velocidade oficial do processador (2133 ou 2400); XMP acima disso não pega')),
    ...['H310', 'B360', 'B365', 'H370', 'Q370', 'Z370', 'Z390'].map((id) => C(id, 'Intel', 'LGA1151 v2', 'DDR4', 'PCIe 3.0', id.startsWith('Z'), id.startsWith('Z'), '8ª e 9ª geração',
      id.startsWith('Z') ? (id === 'Z370' ? '9ª geração só com BIOS nova' : null) : 'a memória fica presa na velocidade oficial do processador (até 2666); XMP acima disso não pega')),
    ...['H410', 'B460', 'H470', 'Q470', 'Z490'].map((id) => C(id, 'Intel', 'LGA1200', 'DDR4', id === 'Z490' ? 'PCIe 3.0 (4.0 com 11ª geração)' : 'PCIe 3.0', id === 'Z490', id === 'Z490', id === 'Z490' || id === 'H470' ? '10ª e 11ª geração' : '10ª geração',
      id === 'Z490' ? null : 'a memória fica presa na velocidade oficial do processador (2666 no i3/i5, 2933 no i7/i9)')),
    ...['H510', 'B560', 'H570', 'Q570', 'Z590'].map((id) => C(id, 'Intel', 'LGA1200', 'DDR4', id === 'H510' ? 'PCIe 3.0' : 'PCIe 4.0 no slot da placa de vídeo com 11ª geração', id === 'Z590', id !== 'H510', '10ª e 11ª geração',
      id === 'H510' ? 'a memória fica presa na velocidade oficial do processador' : null)),
    ...['H610', 'B660', 'H670', 'Q670', 'Z690'].map((id) => C(id, 'Intel', 'LGA1700', 'DDR4 ou DDR5 (depende da placa)', 'PCIe 4.0/5.0 (depende da placa)', id === 'Z690', id !== 'H610' && id !== 'Q670', '12ª a 14ª geração (13ª e 14ª com BIOS nova)',
      id === 'H610' ? 'a memória fica presa na velocidade oficial do processador' : null)),
    ...['B760', 'H770', 'Z790'].map((id) => C(id, 'Intel', 'LGA1700', 'DDR4 ou DDR5 (depende da placa)', 'PCIe 4.0/5.0 (depende da placa)', id === 'Z790', true, '12ª a 14ª geração')),
    ...['H810', 'B860', 'Z890'].map((id) => C(id, 'Intel', 'LGA1851', 'DDR5', 'PCIe 5.0', id === 'Z890', id !== 'H810', 'Core Ultra série 2 (desktop)'))
  ];
  const CHIPSET_BY_ID = new Map(CHIPSETS.map((chipset) => [chipset.id, chipset]));
  // Ordem: o mais específico primeiro (X670E antes de X670, B650E antes de B650).
  const CHIPSET_TOKEN = /(?:^|[^A-Z0-9])(TRX40|TRX50|WRX80|WRX90|X399|990FX|[ABHQXZ]\d{3}E?|[HBZQPX]\d{2})(?=[^0-9]|$)/gi;

  /** Acha o chipset no nome da placa ("ROG STRIX B550-F GAMING", "B550M AORUS ELITE", "PRIME Z790-P WIFI"). */
  function decodeChipset(product, cpu = null) {
    const text = str(product, 80).toUpperCase();
    if (!text) return null;
    for (const match of text.matchAll(CHIPSET_TOKEN)) {
      const id = match[1];
      const chipset = CHIPSET_BY_ID.get(id) || CHIPSET_BY_ID.get(id.replace(/E$/, ''));
      if (!chipset) continue;
      // Proteção: um "B460" com processador AMD não é chipset (nome de produto coincidente).
      if (cpu?.vendor && chipset.vendor !== cpu.vendor) continue;
      return { ...chipset, matched: id };
    }
    return null;
  }

  /* ======================================================================================================
   * Memória
   * ==================================================================================================== */
  const MEM_TYPES = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 27: 'LPDDR', 28: 'LPDDR2', 29: 'LPDDR3', 30: 'LPDDR4', 34: 'DDR5', 35: 'LPDDR5' };
  const STANDARD_SPEEDS = [1333, 1600, 1866, 2133, 2400, 2666, 2933, 3000, 3200, 3333, 3466, 3600, 3733, 3866, 4000, 4133, 4266, 4400, 4600, 4800, 5200, 5600, 6000, 6200, 6400, 6600, 6800, 7000, 7200, 7600, 8000, 8200, 8400];
  const SPEED_FROM_TWO = { 16: 1600, 18: 1866, 21: 2133, 24: 2400, 26: 2666, 29: 2933, 30: 3000, 32: 3200, 33: 3333, 34: 3466, 36: 3600, 37: 3733, 38: 3866, 40: 4000, 42: 4266, 44: 4400, 46: 4600, 48: 4800, 52: 5200, 55: 5600, 56: 5600, 60: 6000, 62: 6200, 64: 6400, 66: 6600, 68: 6800, 72: 7200, 76: 7600, 80: 8000 };
  const SAMSUNG_CODES = { CPB: 2133, CRC: 2400, CTD: 2666, CVF: 2933, CWE: 3200 };
  const HYNIX_CODES = { TF: 2133, UH: 2400, VK: 2666, WM: 2933, XN: 3200 };

  /**
   * Velocidade nominal (a da caixa, com XMP/EXPO) pelo código do pente. `jedec: true` = pente sem perfil XMP/EXPO
   * (Samsung, SK Hynix, Micron de fábrica, Kingston ValueRAM, Crucial CT): o nominal é o que ele roda sem ajuste.
   */
  function ratedFromPart(partRaw) {
    const part = str(partRaw, 40).toUpperCase().replace(/\s+/g, '');
    if (!part || /^(0+|UNDEFINED|NOTAVAILABLE|PARTNUM\d*|MODULEPARTNUMBER\d*)$/.test(part)) return null;
    let m = part.match(/^F[345]-(\d{4})([CJU])(\d{2})/); // G.Skill
    if (m) return { speed: Number(m[1]), cl: Number(m[3]), brand: 'G.Skill', jedec: false };
    m = part.match(/^CM[A-Z]{1,5}\d+GX[345]M\d[A-Z](\d{4})C(\d{2})/); // Corsair
    if (m) return { speed: Number(m[1]), cl: Number(m[2]), brand: 'Corsair', jedec: false };
    m = part.match(/^KF([345])(\d{2})C(\d{2})/); // Kingston Fury
    if (m && SPEED_FROM_TWO[m[2]]) return { speed: m[1] === '5' && m[2] === '56' ? 5600 : SPEED_FROM_TWO[m[2]], cl: Number(m[3]), brand: 'Kingston Fury', jedec: false };
    m = part.match(/^HX[34](\d{2})C(\d{2})/); // HyperX
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'HyperX', jedec: false };
    m = part.match(/^KVR(\d{2})[A-Z](\d{2})/); // Kingston ValueRAM (sem XMP)
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'Kingston', jedec: true };
    m = part.match(/^BL(?:\d)?K?\d+G(\d{2})C(\d{2})/); // Crucial Ballistix
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'Crucial Ballistix', jedec: false };
    m = part.match(/^CP(?:\d?K)?\d+G(?:5)?(\d{2})C(\d{2})/); // Crucial Pro DDR5 (com XMP/EXPO)
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'Crucial Pro', jedec: false };
    m = part.match(/^C[TP](?:\dK)?\d+G4[A-Z]{2,5}(\d{3})/); // Crucial DDR4 de fábrica: 266 = 2666, 320 = 3200
    if (m) { const speed = { 213: 2133, 240: 2400, 266: 2666, 293: 2933, 320: 3200 }[m[1]]; if (speed) return { speed, cl: null, brand: 'Crucial', jedec: true }; }
    m = part.match(/^C[TP](?:\dK)?\d+G4[A-Z]{2,5}(\d{2})/);
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: null, brand: 'Crucial', jedec: true };
    m = part.match(/^CT(?:\dK)?\d+G(\d{2})C(\d{2})/); // Crucial DDR5 de fábrica: CT16G48C40U5 = 4800 CL40
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'Crucial', jedec: true };
    m = part.match(/^AX[45]U(\d{4})/); // ADATA/XPG: AX4U32008G16A = 3200
    if (m && STANDARD_SPEEDS.includes(Number(m[1]))) return { speed: Number(m[1]), cl: null, brand: 'ADATA', jedec: false };
    m = part.match(/^M[34]\d{2}[A-Z0-9]{6,9}-(C[A-Z]{2})/); // Samsung
    if (m && SAMSUNG_CODES[m[1]]) return { speed: SAMSUNG_CODES[m[1]], cl: null, brand: 'Samsung', jedec: true };
    m = part.match(/^HMA[A-Z0-9]{6,12}-([A-Z]{2})/); // SK Hynix DDR4
    if (m && HYNIX_CODES[m[1]]) return { speed: HYNIX_CODES[m[1]], cl: null, brand: 'SK Hynix', jedec: true };
    m = part.match(/^MTA[A-Z0-9]{6,14}-(\d)G(\d)/); // Micron
    if (m) { const speed = { '21': 2133, '24': 2400, '26': 2666, '29': 2933, '32': 3200 }[`${m[1]}${m[2]}`]; if (speed) return { speed, cl: null, brand: 'Micron', jedec: true }; }
    m = part.match(/^PV[A-Z]?[45]\d{2}G(\d{3})C(\d)/); // Patriot: PVS416G320C6K = 3200 CL16
    if (m) { const speed = { 266: 2666, 300: 3000, 320: 3200, 360: 3600, 400: 4000, 560: 5600, 600: 6000, 640: 6400 }[m[1]]; if (speed) return { speed, cl: Number(`1${m[2]}`), brand: 'Patriot', jedec: false }; }
    // Genérico: TeamGroup, ADATA/XPG, Lexar, Netac, Rise e outros põem a velocidade inteira no código.
    for (const speed of [...STANDARD_SPEEDS].reverse()) {
      if (new RegExp(`(?<!\\d)${speed}(?!\\d)`).test(part)) { const cl = part.match(new RegExp(`${speed}[A-Z]{0,2}C?L?(\\d{2})`)); return { speed, cl: cl ? Number(cl[1]) : null, brand: null, jedec: false, generic: true }; }
    }
    return null;
  }

  /** Canal do pente pelo nome do slot ("DIMM_A2", "ChannelB-DIMM0", "P0 CHANNEL A", "DDR4_B1"). */
  function channelOf(locator, bank) {
    const text = `${str(locator, 60)} ${str(bank, 60)}`.toUpperCase();
    let m = text.match(/CHANNEL\s*[-_]?\s*([A-H])\b/);
    if (m) return m[1];
    m = text.match(/CHANNEL\s*(\d)/);
    if (m) return String.fromCharCode(65 + Number(m[1]));
    m = text.match(/(?:DIMM|DDR\d)[\s_-]*([A-H])\s*[-_]?\d/);
    if (m) return m[1];
    m = text.match(/(?:^|\s)([A-H])\d(?:\s|$|_)/);
    if (m) return m[1];
    return null;
  }

  function decodeMemory(memory, cpu) {
    const raw = memory && typeof memory === 'object' ? memory : {};
    const modules = (Array.isArray(raw.modules) ? raw.modules : []).filter((module) => module && finite(module.capacity) && module.capacity > 0).slice(0, 16).map((module) => {
      const rated = ratedFromPart(module.part);
      const spd = finite(module.speed) && module.speed > 200 ? module.speed : null;
      const configured = finite(module.configured) && module.configured > 200 ? module.configured : null;
      return {
        slot: str(module.locator, 40) || null, bank: str(module.bank, 40) || null, channel: channelOf(module.locator, module.bank),
        capacityBytes: module.capacity, maker: str(module.manufacturer, 40) || rated?.brand || null, part: str(module.part, 40) || null,
        type: MEM_TYPES[module.type] || null, spd, configured, rated: rated?.speed || spd, ratedSource: rated?.speed ? 'código do pente' : spd ? 'informado pelo pente' : null,
        cl: rated?.cl || null, jedec: rated ? rated.jedec : null, formFactor: module.formFactor === 12 ? 'SODIMM' : module.formFactor === 8 ? 'DIMM' : null
      };
    });
    const totalBytes = modules.reduce((sum, module) => sum + module.capacityBytes, 0) || (finite(raw.totalBytes) ? raw.totalBytes : null);
    const type = modules.find((module) => module.type)?.type || null;
    const soldered = modules.length > 0 && modules.every((module) => !module.formFactor) && /^LP/.test(type || '');
    const channels = modules.length && modules.every((module) => module.channel) ? new Set(modules.map((module) => module.channel)).size : null;
    let layout = 'desconhecido';
    if (modules.length === 1 && !soldered) layout = 'single';
    else if (channels === 1 && modules.length >= 2) layout = 'same-channel';
    else if (channels !== null && channels >= 4) layout = 'quad';
    else if (channels === 2 || channels === 3) layout = 'dual';
    else if (soldered && modules.length >= 2) layout = 'dual';
    if (cpu?.efficiencyOnly && layout !== 'single') layout = 'single-by-design';
    const configured = Math.min(...modules.map((module) => module.configured).filter(finite)) || null;
    const rated = Math.min(...modules.map((module) => module.rated).filter(finite)) || null;
    const xmpKnown = modules.some((module) => module.jedec === false && module.ratedSource === 'código do pente');
    const mixed = new Set(modules.map((module) => `${module.part}|${module.capacityBytes}`)).size > 1;
    const slots = finite(raw.slots) && raw.slots > 0 && raw.slots <= 16 ? raw.slots : null;
    return {
      totalBytes, type, modules, soldered, layout, channels, slots, freeSlots: slots !== null ? Math.max(0, slots - modules.length) : null,
      configured: finite(configured) ? configured : null, rated: finite(rated) ? rated : null, cl: modules.find((module) => module.cl)?.cl || null,
      belowRated: finite(configured) && finite(rated) && configured < rated - 50, xmpKnown, mixed,
      maxBytes: finite(raw.maxBytes) && raw.maxBytes > 0 ? raw.maxBytes : null
    };
  }

  /* ======================================================================================================
   * Placa de vídeo
   * ==================================================================================================== */
  const NV_FAMILIES = [
    [/RTX\s*50\d{2}/i, { family: 'GeForce RTX 50', architecture: 'Blackwell', year: 2025, rebar: true, features: ['DLSS 4 com geração de vários quadros', 'Reflex', 'AV1'] }],
    [/RTX\s*40\d{2}/i, { family: 'GeForce RTX 40', architecture: 'Ada Lovelace', year: 2022, rebar: true, features: ['DLSS 3 com geração de quadros', 'Reflex', 'AV1'] }],
    [/RTX\s*30\d{2}/i, { family: 'GeForce RTX 30', architecture: 'Ampere', year: 2020, rebar: true, features: ['DLSS 2', 'Reflex'] }],
    [/RTX\s*20\d{2}/i, { family: 'GeForce RTX 20', architecture: 'Turing', year: 2018, rebar: false, features: ['DLSS 2', 'Reflex'] }],
    [/GTX\s*16\d{2}/i, { family: 'GeForce GTX 16', architecture: 'Turing (sem RTX)', year: 2019, rebar: false, features: ['Reflex'] }],
    [/GTX\s*10\d{2}|GT\s*10\d{2}/i, { family: 'GeForce GTX 10', architecture: 'Pascal', year: 2016, rebar: false, features: [], legacyDriver: true }],
    [/GTX\s*9\d{2}|GTX\s*750/i, { family: 'GeForce GTX 900', architecture: 'Maxwell', year: 2014, rebar: false, features: [], legacyDriver: true }],
    [/GTX\s*[67]\d{2}|GT\s*[67]\d{2}/i, { family: 'GeForce 600/700', architecture: 'Kepler', year: 2012, rebar: false, features: [], legacyDriver: true }],
    [/\bMX\s*\d{3}/i, { family: 'GeForce MX', architecture: null, year: 2018, rebar: false, features: [], entry: true }]
  ];
  const AMD_FAMILIES = [
    [/RX\s*9\d{3}/i, { family: 'Radeon RX 9000', architecture: 'RDNA 4', year: 2025, rebar: true, features: ['FSR 4', 'Anti-Lag 2', 'AV1'] }],
    [/RX\s*7\d{3}/i, { family: 'Radeon RX 7000', architecture: 'RDNA 3', year: 2022, rebar: true, features: ['FSR 3 com geração de quadros', 'Anti-Lag 2', 'AV1'] }],
    [/RX\s*6\d{3}/i, { family: 'Radeon RX 6000', architecture: 'RDNA 2', year: 2020, rebar: true, features: ['FSR 3', 'Smart Access Memory'] }],
    [/RX\s*5\d{3}/i, { family: 'Radeon RX 5000', architecture: 'RDNA', year: 2019, rebar: false, features: ['FSR'] }],
    [/Vega\s*(?:56|64)|Radeon\s+VII/i, { family: 'Radeon Vega', architecture: 'GCN 5', year: 2017, rebar: false, features: ['FSR'] }],
    [/RX\s*[45]\d{2}\b/i, { family: 'Radeon RX 400/500', architecture: 'Polaris', year: 2016, rebar: false, features: ['FSR'] }],
    [/R[579]\s*\d{3}/i, { family: 'Radeon R5/R7/R9', architecture: 'GCN', year: 2013, rebar: false, features: [], legacyDriver: true }]
  ];
  const INTEGRATED = /UHD Graphics|HD Graphics|Iris|Intel\(?R?\)?\s*Graphics|Arc(?:\(TM\))?\s+(?:\d{3}V\s+)?(?:GPU|Graphics)$|Radeon(?:\(TM\))?\s+Graphics|Radeon\s+Vega\s+\d+\s+Graphics|Radeon(?:\(TM\))?\s+\d{3}M|Radeon\s+\d{4}S|Vega\s+\d\b/i;

  function decodeGpu(gpu, now = Date.now()) {
    const raw = gpu && typeof gpu === 'object' ? gpu : {};
    const name = cleanName(raw.name);
    const vendorId = str(raw.vendorId, 4).toUpperCase();
    const vendor = vendorId === '10DE' || /NVIDIA|GeForce|Quadro/i.test(name) ? 'NVIDIA' : vendorId === '1002' || /AMD|Radeon/i.test(name) ? 'AMD' : vendorId === '8086' || /Intel/i.test(name) ? 'Intel' : vendorId === '1414' || /Basic Display|Microsoft/i.test(name) ? 'Microsoft' : null;
    let info = null;
    if (vendor === 'NVIDIA') info = NV_FAMILIES.find(([pattern]) => pattern.test(name))?.[1] || null;
    if (vendor === 'AMD') info = AMD_FAMILIES.find(([pattern]) => pattern.test(name))?.[1] || null;
    if (vendor === 'Intel' && /Arc.*\bB\d{3}/i.test(name)) info = { family: 'Arc série B', architecture: 'Battlemage', year: 2024, rebar: true, needsRebar: true, features: ['XeSS', 'AV1'] };
    else if (vendor === 'Intel' && /Arc.*\bA\d{3}/i.test(name)) info = { family: 'Arc série A', architecture: 'Alchemist', year: 2022, rebar: true, needsRebar: true, features: ['XeSS', 'AV1'] };
    const basicDriver = vendor === 'Microsoft' || /Basic Display|Básico|Basic Render/i.test(name);
    const integrated = !basicDriver && vendor !== 'NVIDIA' && (INTEGRATED.test(name) || (vendor === 'Intel' && !info));
    const tier = name.match(/(?:RTX|GTX|RX)\s*\d{3,4}\s*(Ti\s*SUPER|Ti|SUPER|XTX|XT|GRE)?/i);
    const driverAge = ageDays(raw.driverDate, now);
    return {
      name, vendor, vendorId: vendorId || null, deviceId: str(raw.deviceId, 4).toUpperCase() || null, integrated, discrete: !integrated && !basicDriver,
      mobile: /Laptop|Mobile|Max-Q|\bMX\s*\d/i.test(name) || /\d{3,4}M\b/.test(name) && !integrated, basicDriver,
      family: info?.family || null, architecture: info?.architecture || null, year: info?.year || null, features: info?.features || [],
      rebarCapable: info ? info.rebar : null, needsRebar: Boolean(info?.needsRebar), legacyDriver: Boolean(info?.legacyDriver), entry: Boolean(info?.entry),
      variant: tier?.[1] ? tier[1].replace(/\s+/g, ' ') : null,
      vramBytes: finite(raw.vramBytes) && raw.vramBytes > 64 * 1024 ** 2 ? raw.vramBytes : null,
      driver: { version: str(raw.driverVersion, 40) || null, date: str(raw.driverDate, 10) || null, ageDays: driverAge },
      link: decodeLink(raw.link), known: Boolean(info) || integrated
    };
  }

  /** Link PCIe: geração atual/máxima (1 = 2,5 GT/s … 5 = 32 GT/s) e linhas atuais/máximas. */
  function decodeLink(link) {
    if (!link || typeof link !== 'object') return null;
    const n = (value, max) => (finite(value) && value >= 1 && value <= max ? value : null);
    const out = { gen: n(link.curSpeed, 6), maxGen: n(link.maxSpeed, 6), width: n(link.curWidth, 32), maxWidth: n(link.maxWidth, 32) };
    return Object.values(out).some((value) => value !== null) ? out : null;
  }

  /* ======================================================================================================
   * Telas, discos, rede, sistema
   * ==================================================================================================== */
  function decodeDisplay(display, gpus) {
    const raw = display && typeof display === 'object' ? display : {};
    const adapter = cleanName(raw.adapter);
    const gpu = gpus.find((item) => item.name && adapter && item.name.toLowerCase() === adapter.toLowerCase()) || null;
    const n = (value, max) => (finite(value) && value > 0 && value <= max ? value : null);
    return {
      name: str(raw.name, 60) || null, adapter: adapter || null, onIntegrated: gpu ? gpu.integrated : INTEGRATED.test(adapter), internal: raw.internal === true,
      width: n(raw.width, 16000), height: n(raw.height, 16000), hz: n(raw.hz, 1000), maxHz: n(raw.maxHz, 1000), maxWidth: n(raw.maxWidth, 16000), maxHeight: n(raw.maxHeight, 16000),
      output: str(raw.output, 20) || null, primary: raw.primary === true
    };
  }

  function decodeDisk(disk) {
    const raw = disk && typeof disk === 'object' ? disk : {};
    const bus = str(raw.bus, 20).toUpperCase();
    const media = str(raw.media, 20).toUpperCase();
    const model = cleanName(raw.model);
    let kind = 'desconhecido';
    if (bus === 'USB') kind = 'usb';
    else if (bus === 'NVME' || /NVME/i.test(model)) kind = 'nvme';
    else if (media === 'SSD' || /\bSSD\b/i.test(model)) kind = 'ssd';
    else if (media === 'HDD' || (finite(raw.rpm) && raw.rpm > 0)) kind = 'hdd';
    const label = { nvme: 'SSD NVMe', ssd: 'SSD SATA', hdd: 'HD (disco mecânico)', usb: 'unidade USB', desconhecido: 'unidade' }[kind];
    const n = (value, max) => (finite(value) && value >= 0 && value <= max ? value : null);
    return {
      model: model || null, kind, label, bus: bus || null, sizeBytes: n(raw.size, 1e15), system: raw.system === true, health: str(raw.health, 20) || null,
      wear: n(raw.wear, 100), tempC: n(raw.tempC, 120), powerOnHours: n(raw.powerOnHours, 1e6), readErrors: n(raw.readErrors, 1e9), link: decodeLink(raw.link)
    };
  }

  function decodeNetwork(adapter) {
    const raw = adapter && typeof adapter === 'object' ? adapter : {};
    const description = str(raw.description, 90);
    const wifi = raw.kind === 'wifi' || /Wi-?Fi|Wireless|802\.11|WLAN/i.test(`${description} ${raw.media || ''}`);
    const linkMbps = finite(raw.linkMbps) && raw.linkMbps > 0 && raw.linkMbps <= 400000 ? raw.linkMbps : null;
    return {
      name: str(raw.name, 40) || null, description: description || null, kind: wifi ? 'wifi' : 'ethernet', up: raw.up !== false, linkMbps,
      gigabitCapable: !wifi && /gigabit|\bGbE\b|2\.5G|2500|5G\b|10G|1000|Ethernet Controller \(3\)|I2[12]\dV|I219|E3100|AQC|Killer/i.test(description),
      wifi: wifi && raw.wifi && typeof raw.wifi === 'object' ? {
        signal: finite(raw.wifi.signal) && raw.wifi.signal >= 0 && raw.wifi.signal <= 100 ? raw.wifi.signal : null,
        band: raw.wifi.band === 2.4 || raw.wifi.band === 5 || raw.wifi.band === 6 ? raw.wifi.band : null,
        standard: /^802\.11[a-z]{1,2}$/i.test(String(raw.wifi.standard || '')) ? String(raw.wifi.standard).toLowerCase() : null
      } : null
    };
  }

  const CHASSIS = { 3: 'desktop', 4: 'desktop', 5: 'desktop', 6: 'desktop', 7: 'desktop', 15: 'desktop', 16: 'desktop', 8: 'laptop', 9: 'laptop', 10: 'laptop', 14: 'laptop', 31: 'laptop', 32: 'laptop', 30: 'laptop', 11: 'handheld', 13: 'aio', 35: 'minipc', 36: 'minipc' };
  const KIND_LABEL = { desktop: 'PC de mesa', laptop: 'notebook', handheld: 'portátil de jogos', aio: 'tudo-em-um', minipc: 'mini PC' };
  const HANDHELDS = /Steam Deck|Jupiter|Galileo|ROG Ally|RC71L|RC72LA|Legion Go|83E1|Claw|MSI Claw|ONEXPLAYER|AYANEO|GPD Win/i;

  function decodeSystem(system, cpu, battery) {
    const raw = system && typeof system === 'object' ? system : {};
    const types = (Array.isArray(raw.chassis) ? raw.chassis : []).filter((value) => Number.isInteger(value));
    let kind = types.map((type) => CHASSIS[type]).find(Boolean) || null;
    if (HANDHELDS.test(`${raw.model || ''} ${raw.family || ''}`) || cpu?.segment === 'handheld') kind = 'handheld';
    if (!kind && raw.mobile === true) kind = 'laptop';
    if (!kind && cpu?.segment === 'laptop') kind = 'laptop';
    if (!kind && battery) kind = 'laptop';
    if (!kind && cpu?.segment === 'desktop') kind = 'desktop';
    return { kind, kindLabel: kind ? KIND_LABEL[kind] : null, maker: maker(raw.manufacturer), model: product(raw.model) };
  }

  const WINDOWS_BUILDS = [[26200, 'Windows 11 25H2'], [26100, 'Windows 11 24H2'], [22631, 'Windows 11 23H2'], [22621, 'Windows 11 22H2'], [22000, 'Windows 11 21H2'], [19045, 'Windows 10 22H2'], [19044, 'Windows 10 21H2'], [19041, 'Windows 10 2004'], [10240, 'Windows 10']];
  function decodeOs(os) {
    const raw = os && typeof os === 'object' ? os : {};
    const build = Number.isInteger(raw.build) ? raw.build : null;
    if (raw.platform === 'linux') return { name: str(raw.name, 60) || 'Linux', kernel: str(raw.kernel, 40) || null, build: null, windows10: false, platform: 'linux' };
    const label = build ? (WINDOWS_BUILDS.find(([min]) => build >= min) || [null, null])[1] : null;
    return { name: label || str(raw.caption, 60) || null, caption: str(raw.caption, 60) || null, build, windows10: Boolean(build && build < 22000), platform: 'win32' };
  }

  /* ======================================================================================================
   * Perfil completo
   * ==================================================================================================== */
  function identify(inventory, { now = Date.now() } = {}) {
    const inv = inventory && typeof inventory === 'object' ? inventory : {};
    const cpu = decodeCpu(inv.cpu);
    const battery = inv.battery && finite(inv.battery.designWh) && inv.battery.designWh > 0 ? {
      designWh: inv.battery.designWh, fullWh: finite(inv.battery.fullWh) ? inv.battery.fullWh : null,
      wear: finite(inv.battery.fullWh) && inv.battery.fullWh > 0 ? Math.max(0, Math.min(100, Math.round((1 - inv.battery.fullWh / inv.battery.designWh) * 100))) : null
    } : null;
    const system = decodeSystem(inv.system, cpu, battery);
    const boardRaw = inv.board && typeof inv.board === 'object' ? inv.board : {};
    const biosRaw = inv.bios && typeof inv.bios === 'object' ? inv.bios : {};
    const board = {
      maker: maker(boardRaw.manufacturer), product: product(boardRaw.product),
      chipset: decodeChipset(product(boardRaw.product), cpu) || decodeChipset(product(inv.system?.model), cpu),
      bios: { vendor: str(biosRaw.vendor, 40) || null, version: str(biosRaw.version, 40) || null, date: /^\d{4}-\d{2}-\d{2}$/.test(String(biosRaw.date || '')) ? biosRaw.date : null, ageDays: ageDays(biosRaw.date, now) }
    };
    const gpus = (Array.isArray(inv.gpus) ? inv.gpus : []).slice(0, 6).map((gpu) => decodeGpu(gpu, now)).filter((gpu) => gpu.name);
    const displays = (Array.isArray(inv.displays) ? inv.displays : []).slice(0, 8).map((display) => decodeDisplay(display, gpus));
    const disks = (Array.isArray(inv.disks) ? inv.disks : []).slice(0, 12).map(decodeDisk);
    const network = (Array.isArray(inv.network) ? inv.network : []).slice(0, 8).map(decodeNetwork);
    return {
      kind: system.kind, kindLabel: system.kindLabel, system: { maker: system.maker, model: system.model }, cpu, board,
      memory: decodeMemory(inv.memory, cpu), gpus, displays, disks, network, battery, os: decodeOs(inv.os),
      nvmeControllers: (Array.isArray(inv.nvme) ? inv.nvme : []).slice(0, 6).map((item) => ({ name: str(item?.name, 60) || null, link: decodeLink(item?.link) })).filter((item) => item.link)
    };
  }

  /* ======================================================================================================
   * Frases curtas para a constelação e para o cartão "Seu PC"
   * ==================================================================================================== */
  const gbText = (bytes) => {
    const value = bytes / GB;
    return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1).replace('.', ',')} GB`;
  };
  const LAYOUT_TEXT = { single: 'canal único', 'single-by-design': 'canal único (projeto do processador)', dual: 'dual channel', quad: 'quatro canais', 'same-channel': 'pentes no mesmo canal', desconhecido: null };

  function cpuLine(cpu) {
    const head = [cpu.vendor, cpu.family, cpu.model].filter(Boolean).join(' ') || cpu.name || 'Processador';
    const bits = [cpu.architecture, cpu.generationLabel && !String(cpu.architecture || '').includes(cpu.generationLabel) ? cpu.generationLabel : null].filter(Boolean);
    const cores = cpu.cores ? `${cpu.cores} núcleos${cpu.threads && cpu.threads !== cpu.cores ? ` / ${cpu.threads} threads` : ''}` : null;
    const extra = [cores, cpu.hybrid ? 'núcleos P e E' : null, cpu.x3d ? '3D V-Cache' : null, cpu.socket].filter(Boolean);
    return `${head}${bits.length ? ` · ${bits.join(', ')}` : ''}${extra.length ? ` · ${extra.join(', ')}` : ''}`;
  }

  function memoryLine(memory) {
    if (!memory.totalBytes) return null;
    const count = memory.modules.length;
    const sizes = count ? [...new Set(memory.modules.map((module) => gbText(module.capacityBytes)))] : [];
    const head = memory.soldered ? `${gbText(memory.totalBytes)} soldados na placa` : count ? `${count} ${count > 1 ? 'pentes' : 'pente'} de ${sizes.join(' + ')}` : gbText(memory.totalBytes);
    const speed = memory.configured ? `${memory.type ? `${memory.type}-` : ''}${memory.configured}` : memory.type;
    return [head, LAYOUT_TEXT[memory.layout], speed].filter(Boolean).join(', ');
  }

  function boardLine(board) {
    const name = [board.maker, board.product].filter(Boolean).join(' ');
    if (!name) return null;
    const chipset = board.chipset ? `chipset ${board.chipset.vendor} ${board.chipset.id} (${board.chipset.socket}, ${board.chipset.ddr})` : null;
    return chipset ? `${name} → ${chipset}` : name;
  }

  function gpuLine(gpu) {
    const kind = gpu.basicDriver ? 'sem driver de vídeo' : gpu.integrated ? 'vídeo integrado' : gpu.family ? `${gpu.family}, ${gpu.architecture}` : 'placa de vídeo';
    const vram = gpu.vramBytes && !gpu.integrated ? gbText(gpu.vramBytes) : null;
    return `${gpu.name} · ${[kind, vram].filter(Boolean).join(', ')}`;
  }

  function displayLine(display) {
    if (!display.width || !display.hz) return null;
    const max = display.maxHz && display.maxHz > display.hz ? ` (aceita até ${display.maxHz} Hz)` : '';
    return `${display.name || 'Monitor'}: ${display.width}×${display.height} a ${display.hz} Hz${max}`;
  }

  function diskLine(disk) {
    const size = disk.sizeBytes ? (disk.sizeBytes >= 1e12 ? `${(disk.sizeBytes / 1e12).toFixed(1).replace('.', ',').replace(',0', '')} TB` : `${Math.round(disk.sizeBytes / 1e9)} GB`) : null;
    return `${disk.model || disk.label}: ${[disk.label, size, disk.system ? 'com o Windows' : null].filter(Boolean).join(', ')}`;
  }

  /** Frases por nó da constelação: cpu, board, memory, gpu, display, disk, network. */
  function factLines(profile) {
    const p = profile || {};
    const lines = [];
    if (p.cpu) lines.push({ node: 'cpu', text: cpuLine(p.cpu) });
    const board = p.board ? boardLine(p.board) : null;
    if (board) lines.push({ node: 'board', text: board });
    const memory = p.memory ? memoryLine(p.memory) : null;
    if (memory) lines.push({ node: 'memory', text: memory });
    for (const gpu of p.gpus || []) lines.push({ node: 'gpu', text: gpuLine(gpu) });
    for (const display of p.displays || []) { const line = displayLine(display); if (line) lines.push({ node: 'gpu', text: line }); }
    for (const disk of p.disks || []) lines.push({ node: 'disk', text: diskLine(disk) });
    for (const adapter of (p.network || []).filter((item) => item.up)) lines.push({ node: 'network', text: `${adapter.description || adapter.name}${adapter.linkMbps ? ` · ${adapter.linkMbps >= 1000 ? `${(adapter.linkMbps / 1000).toLocaleString('pt-BR')} Gb/s` : `${adapter.linkMbps} Mb/s`}` : ''}` });
    return lines;
  }

  return { decodeCpu, decodeChipset, decodeMemory, decodeGpu, decodeDisplay, decodeDisk, decodeNetwork, decodeSystem, decodeOs, decodeLink, identify, factLines, ratedFromPart, channelOf, cleanName, ageDays, maker, CHIPSETS, MEM_TYPES, LAYOUT_TEXT, gbText, cpuLine, memoryLine, boardLine, gpuLine, displayLine, diskLine };
});
