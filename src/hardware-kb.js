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

  /** Core i7/i9 da plataforma entusiasta (X79, X99, X299): soquete grande e memória em 4 canais. */
  function intelHedt(model) {
    const list = [
      [/^(3820|3930K|3960X|3970X)$/, 'Sandy Bridge-E', 'LGA2011', ['DDR3'], 2011],
      [/^(4820K|4930K|4960X)$/, 'Ivy Bridge-E', 'LGA2011', ['DDR3'], 2013],
      [/^(5820K|5930K|5960X)$/, 'Haswell-E', 'LGA2011-3', ['DDR4'], 2014],
      [/^(6800K|6850K|6900K|6950X)$/, 'Broadwell-E', 'LGA2011-3', ['DDR4'], 2016],
      [/^(7640X|7740X)$/, 'Kaby Lake-X', 'LGA2066', ['DDR4'], 2017],
      [/^7\d{3}XE?$/, 'Skylake-X', 'LGA2066', ['DDR4'], 2017],
      [/^9\d{3}XE?$/, 'Skylake-X', 'LGA2066', ['DDR4'], 2018],
      [/^10\d{3}XE?$/, 'Cascade Lake-X', 'LGA2066', ['DDR4'], 2019]
    ];
    const hit = list.find(([pattern]) => pattern.test(model));
    return hit ? { arch: hit[1], socket: hit[2], ddr: hit[3], year: hit[4] } : null;
  }

  /** Xeon: os de estação de trabalho e os E5 v1–v4 das placas X79/X99 (muito comuns montados com placa chinesa). */
  function decodeXeon(name) {
    const base = { family: 'Xeon', segment: 'workstation', igpu: false };
    let m = name.match(/\bE5-(\d{4})[A-Z]?(?:\s*(?:L|W))?\s*(?:v(\d))?/i);
    if (m) {
      const v = Number(m[2] || 1);
      const gen = { 1: ['Sandy Bridge-EP', 'LGA2011', ['DDR3'], 2012], 2: ['Ivy Bridge-EP', 'LGA2011', ['DDR3'], 2013], 3: ['Haswell-EP', 'LGA2011-3', ['DDR4'], 2014], 4: ['Broadwell-EP', 'LGA2011-3', ['DDR4'], 2016] }[v];
      if (gen) return { ...base, model: `E5-${m[1]}${m[2] ? ' v' + m[2] : ''}`, generationLabel: `E5 v${v}`, architecture: gen[0], socket: gen[1], memoryTypes: gen[2], memoryChannels: 4, pcie: 3, year: gen[3], known: true, xeonE5: true, notes: ['memória em 4 canais: use um pente em cada canal'] };
    }
    m = name.match(/\bE3-(\d{4})[A-Z]?\s*(?:v(\d))?/i);
    if (m) {
      const v = Number(m[2] || 1);
      const gen = { 1: ['Sandy Bridge', 'LGA1155', ['DDR3'], 2011], 2: ['Ivy Bridge', 'LGA1155', ['DDR3'], 2012], 3: ['Haswell', 'LGA1150', ['DDR3'], 2013], 4: ['Broadwell', 'LGA1150', ['DDR3'], 2015], 5: ['Skylake', 'LGA1151', ['DDR4'], 2015], 6: ['Kaby Lake', 'LGA1151', ['DDR4'], 2017] }[v];
      if (gen) return { ...base, model: `E3-${m[1]}${m[2] ? ' v' + m[2] : ''}`, generationLabel: `E3 v${v}`, architecture: gen[0], socket: gen[1], memoryTypes: gen[2], year: gen[3], known: true, igpu: /5$/.test(m[1]) ? true : null };
    }
    m = name.match(/\b(E|W)-(\d)(\d)(\d{2})([A-Z]{0,2})\b/i);
    if (m) {
      const line = `${m[1].toUpperCase()}-${m[2]}${m[3]}`;
      const table = {
        'E-21': ['Coffee Lake', 'LGA1151 v2', 2018], 'E-22': ['Coffee Lake', 'LGA1151 v2', 2019], 'E-23': ['Rocket Lake', 'LGA1200', 2021], 'E-24': ['Raptor Lake', 'LGA1700', 2023],
        'W-12': ['Comet Lake', 'LGA1200', 2020], 'W-13': ['Rocket Lake', 'LGA1200', 2021], 'W-21': ['Skylake-W', 'LGA2066', 2017], 'W-22': ['Cascade Lake-W', 'LGA2066', 2019],
        'W-24': ['Sapphire Rapids', 'LGA4677', 2023], 'W-25': ['Sapphire Rapids', 'LGA4677', 2024], 'W-32': ['Cascade Lake-W', 'LGA3647', 2019], 'W-34': ['Sapphire Rapids', 'LGA4677', 2023], 'W-35': ['Sapphire Rapids', 'LGA4677', 2024]
      };
      const gen = table[line];
      if (gen) return { ...base, model: `${m[1].toUpperCase()}-${m[2]}${m[3]}${m[4]}${m[5].toUpperCase()}`, generationLabel: line.startsWith('E') ? 'Xeon E' : 'Xeon W', architecture: gen[0], socket: gen[1], memoryTypes: ['DDR4'], year: gen[2], known: true };
    }
    m = name.match(/\b(Platinum|Gold|Silver|Bronze)\s+(\d)(\d)(\d{2})([A-Z]{0,2})\b/i);
    if (m) {
      const gen = { 1: ['Skylake-SP', 2017], 2: ['Cascade Lake-SP', 2019], 3: ['Ice Lake-SP', 2021], 4: ['Sapphire Rapids', 2023], 5: ['Emerald Rapids', 2023] }[m[3]];
      return { ...base, segment: 'servidor', model: `${m[1]} ${m[2]}${m[3]}${m[4]}${m[5].toUpperCase()}`, generationLabel: 'Xeon Scalable', architecture: gen ? gen[0] : null, year: gen ? gen[1] : null, known: Boolean(gen) };
    }
    return { ...base, model: (name.match(/Xeon(?:\(R\))?\s+(?:CPU\s+)?(.+?)(?:\s+(?:CPU|@).*)?$/i) || [])[1] || null, known: false };
  }

  /** Pentium e Celeron: os de desktop (série G) pela numeração e os de baixo consumo (J, N) pela família. */
  function decodeIntelEntry(name) {
    const line = (name.match(/Pentium|Celeron/i) || ['Pentium'])[0];
    const tier = (name.match(/(?:Pentium|Celeron)(?:\(R\))?\s+(Gold|Silver)/i) || [])[1] || '';
    const family = [line[0].toUpperCase() + line.slice(1).toLowerCase(), tier].filter(Boolean).join(' ');
    const m = name.match(/\b([GJN])\s?(\d{4})([A-Z]{0,2})\b/i) || name.match(/\b()(\d{4})([UY])\b/i) || name.match(/(?:Pentium|Celeron|Gold|Silver)(?:\(R\))?\s+()(\d{4})\b()/i);
    const base = { family, model: null, segment: 'entrada', igpu: true, known: false };
    if (!m) return base;
    const letter = m[1].toUpperCase();
    const n = Number(m[2]);
    const model = `${letter}${m[2]}${(m[3] || '').toUpperCase()}`;
    const make = (architecture, extra) => ({ ...base, model, architecture, known: true, ...extra });
    if (letter === 'G') {
      if (n >= 6900) return make('Alder Lake', { segment: 'desktop', socket: 'LGA1700', memoryTypes: ['DDR4', 'DDR5'], year: 2022 });
      if (n >= 5900) return make('Comet Lake', { segment: 'desktop', socket: 'LGA1200', memoryTypes: ['DDR4'], year: 2020 });
      if (n >= 4900) return make('Coffee Lake', { segment: 'desktop', socket: 'LGA1151 v2', memoryTypes: ['DDR4'], year: 2018 });
      if (n >= 4400) return make('Skylake / Kaby Lake', { segment: 'desktop', socket: 'LGA1151', memoryTypes: ['DDR4', 'DDR3L'], year: 2016 });
      if (n >= 3200) return make('Haswell', { segment: 'desktop', socket: 'LGA1150', memoryTypes: ['DDR3'], year: 2014 });
      if (n >= 2000) return make('Sandy / Ivy Bridge', { segment: 'desktop', socket: 'LGA1155', memoryTypes: ['DDR3'], year: 2012 });
      return { ...base, model };
    }
    const lowPower = (architecture, year, memoryTypes) => make(architecture, { segment: letter === 'J' ? 'minipc' : 'laptop', year, memoryTypes, notes: ['processador de baixo consumo soldado na placa'] });
    if (letter === 'J' || letter === 'N') {
      if (n >= 6000 && letter === 'J') return lowPower('Elkhart Lake', 2021, ['DDR4']);
      if ((n >= 4500 && n < 5000) || (n >= 5100 && n < 5200) || (n >= 6000 && n < 7000)) return lowPower('Jasper Lake', 2021, ['DDR4', 'LPDDR4X']);
      if ((n >= 4000 && n < 4200) || (n >= 5000 && n < 5100)) return lowPower('Gemini Lake', 2017, ['DDR4', 'LPDDR4']);
      if (n >= 3300 && n < 3500) return lowPower('Apollo Lake', 2016, ['DDR3L', 'LPDDR4']);
      if (n >= 3000 && n < 3300) return lowPower('Braswell', 2015, ['DDR3L']);
      if (n >= 1800 && n < 3000) return lowPower('Bay Trail', 2013, ['DDR3L']);
      return { ...base, model };
    }
    // Pentium Gold 7505/8505, Celeron 7305 (notebook) e Pentium 4415U.
    if (n >= 8500 && n < 8600) return make('Alder Lake', { segment: 'laptop', year: 2022 });
    if (n >= 7300 && n < 7600) return make('Tiger Lake', { segment: 'laptop', year: 2020 });
    if (n >= 4400 && n < 4500) return make('Kaby Lake', { segment: 'laptop', year: 2017 });
    return { ...base, model };
  }

  function decodeIntel(name, cores, threads) {
    const out = { vendor: 'Intel' };
    let m = name.match(/Core\s+Ultra\s+X?([3579])\s+(\d)(\d{2})([A-Z]{0,2})\b/i);
    if (m) {
      const series = Number(m[2]);
      const suffix = m[4].toUpperCase();
      // Série 3 (Panther Lake) é de notebook; desktop só na série 2 (Arrow Lake-S, LGA1851).
      const desktop = /^(K|KF|F|T|)$/.test(suffix) && series === 2;
      const lunar = suffix === 'V';
      Object.assign(out, {
        family: `Core Ultra ${m[1]}`, model: `${m[2]}${m[3]}${suffix}`, generation: null, generationLabel: `Core Ultra série ${series}`,
        architecture: ({ 1: 'Meteor Lake', 2: lunar ? 'Lunar Lake' : 'Arrow Lake', 3: 'Panther Lake' })[series] || null, segment: desktop ? 'desktop' : 'laptop',
        socket: desktop ? 'LGA1851' : null, memoryTypes: ['DDR5'], pcie: desktop ? 5 : 4, hybrid: true, unlocked: /K/.test(suffix) || suffix === 'HX',
        igpu: !suffix.includes('F'), year: ({ 1: 2023, 2: 2024, 3: 2026 })[series] || null, known: series <= 3
      });
      if (lunar) out.notes = ['memória dentro do próprio processador (não dá para trocar nem aumentar)'];
      return out;
    }
    m = name.match(/\bCore\s+([357])\s+(\d)(\d{2})([A-Z]{0,2})\b/i);
    if (m) {
      const suffix = m[4].toUpperCase();
      // Sem sufixo ou com F (Core 5 120F): desktop LGA1700 só com núcleos P; U/H: notebook híbrido.
      const desktop = suffix === '' || suffix === 'F';
      const hybrid = finite(cores) && finite(threads) ? threads !== cores * 2 : !desktop;
      Object.assign(out, { family: `Core ${m[1]}`, model: `${m[2]}${m[3]}${suffix}`, generationLabel: `Core série ${m[2]}`, architecture: 'Raptor Lake', segment: desktop ? 'desktop' : 'laptop', socket: desktop ? 'LGA1700' : null, memoryTypes: ['DDR4', 'DDR5'], pcie: desktop ? 5 : 4, hybrid, igpu: suffix !== 'F', year: m[2] === '1' ? 2024 : 2025, known: true });
      return out;
    }
    m = name.match(/\b(?:Core\s+i3-)?N(\d{2,3})\b/);
    if (m && /\bN\d{2,3}\b/.test(name) && !/Celeron\s+N\d{4}|Pentium.*N\d{4}/i.test(name)) {
      Object.assign(out, { family: /i3/i.test(name) ? 'Core i3' : null, model: `N${m[1]}`, generationLabel: 'série N', architecture: 'Alder Lake-N', segment: 'laptop', memoryTypes: ['DDR4', 'DDR5', 'LPDDR5'], pcie: 3, hybrid: false, efficiencyOnly: true, igpu: true, year: 2023, known: true,
        notes: ['só núcleos de eficiência', 'memória em canal único por projeto do processador'] });
      return out;
    }
    m = name.match(/\bi([3579])-(\d{3,5})([A-Z]{0,2}\d?)\b/i);
    const hedt = m ? intelHedt(`${m[2]}${m[3].toUpperCase()}`) : null;
    if (m && hedt) {
      Object.assign(out, { family: `Core i${m[1]}`, model: `${m[2]}${m[3].toUpperCase()}`, generationLabel: 'série X (plataforma entusiasta)', architecture: hedt.arch, segment: 'desktop', hedt: true, socket: hedt.socket,
        memoryTypes: hedt.ddr, memoryChannels: 4, pcie: 3, hybrid: false, unlocked: true, igpu: false, year: hedt.year, known: true, notes: ['memória em 4 canais: use um pente em cada canal (4 ou 8 pentes)'] });
      return out;
    }
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
    if (/Xeon/i.test(name)) return Object.assign(out, decodeXeon(name));
    if (/Pentium|Celeron/i.test(name)) return Object.assign(out, decodeIntelEntry(name));
    m = name.match(/\bCore\s*(?:\(TM\))?\s*m([357])?-?\s*(\d)(Y\d{2}|\d{3}Y)\b/i);
    if (m) {
      const generation = Number(m[2]);
      const info = INTEL_GENS[generation];
      return Object.assign(out, { family: m[1] ? `Core m${m[1]}` : 'Core M', model: `${m[2]}${m[3].toUpperCase()}`, generation, generationLabel: `${generation}ª geração`, architecture: info ? info.mobileArch || info.arch : null, segment: 'laptop', igpu: true, year: info?.year || null, known: Boolean(info), notes: ['processador de baixíssimo consumo (sem ventoinha em muitos modelos)'] });
    }
    m = name.match(/Atom.*?\b(x[357]-)?([CZEN]\d{4})\b/i);
    if (/Atom/i.test(name)) {
      const model = m ? `${m[1] || ''}${m[2]}`.toUpperCase().replace(/^X/, 'x') : null;
      let architecture = null;
      if (m && /^Z8/i.test(m[2])) architecture = 'Cherry Trail';
      else if (m && /^Z3/i.test(m[2])) architecture = 'Bay Trail';
      return Object.assign(out, { family: 'Atom', model, architecture, segment: 'entrada', igpu: true, year: architecture === 'Cherry Trail' ? 2015 : architecture ? 2013 : null, known: Boolean(architecture) });
    }
    if (/Core.?2/i.test(name)) {
      const kind = (name.match(/Core.?2\s*(Quad|Duo|Extreme|Solo)/i) || [])[1];
      Object.assign(out, { family: kind ? `Core 2 ${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()}` : 'Core 2', model: (name.match(/\b([QEXTPLSU]X?\d{4})\b/) || [])[1] || null, generationLabel: 'anterior à 1ª geração', year: 2006, memoryTypes: ['DDR2', 'DDR3'], known: true });
    }
    return out;
  }

  const AMD_ZEN = { zen: 'Zen', 'zen+': 'Zen+', zen2: 'Zen 2', zen3: 'Zen 3', 'zen3+': 'Zen 3+', zen4: 'Zen 4', zen5: 'Zen 5' };
  const AMD_YEAR = { zen: 2017, 'zen+': 2018, zen2: 2019, zen3: 2020, 'zen3+': 2022, zen4: 2022, zen5: 2024 };
  const DUAL_CCD_X3D = new Set(['7900X3D', '7950X3D', '9900X3D', '9950X3D']);
  // Ryzen de desktop derivados de APU (Renoir/Cezanne): mesmo numa B550, o slot da placa de vídeo roda em PCIe 3.0.
  const CEZANNE_PLAIN = new Set(['5500', '5700', '5100', '4500', '4100']);
  const AMD_MOBILE = /^(U|H|HS|HX|HX3D|H3D|HZ|E)$/;

  /** Ryzen de desktop são destravados; os X3D até o Zen 4 não (os 9000X3D sim); de notebook, só os HX. */
  function unlockedOf(mobile, x3d, zen, suffix) {
    if (mobile) return suffix === 'HX';
    return !x3d || zen === 'zen5';
  }

  function decodeRyzen(tier, number, suffixRaw) {
    const suffix = String(suffixRaw || '').toUpperCase();
    const series = Number(number[0]);
    const mobile = AMD_MOBILE.test(suffix);
    const apu = /G/.test(suffix);
    // 5500/5700 sem sufixo são Cezanne (derivados de APU); 5500X3D/5700X3D/5700X são Vermeer.
    const cezannePlain = !suffix && CEZANNE_PLAIN.has(number);
    let zen = null;
    let codename = null;
    if (mobile) {
      if (series >= 7) {
        const code = Number(number[2]);
        zen = { 1: 'zen+', 2: 'zen2', 3: number[3] === '5' ? 'zen3+' : 'zen3', 4: 'zen4', 5: 'zen5' }[code] || null;
      } else zen = { 2: 'zen', 3: 'zen+', 4: 'zen2', 5: Number(number[1]) % 2 === 1 ? 'zen2' : 'zen3', 6: 'zen3+' }[series] || null;
    } else if (apu || cezannePlain) {
      zen = { 2: 'zen', 3: 'zen+', 4: 'zen2', 5: 'zen3', 8: 'zen4' }[series] || null;
      codename = { 2: 'Raven Ridge', 3: 'Picasso', 4: 'Renoir', 5: 'Cezanne', 8: 'Phoenix' }[series] || null;
    } else {
      zen = { 1: 'zen', 2: 'zen+', 3: 'zen2', 5: 'zen3', 7: 'zen4', 8: 'zen4', 9: 'zen5' }[series] || null;
      codename = { 1: 'Summit Ridge', 2: 'Pinnacle Ridge', 3: 'Matisse', 5: 'Vermeer', 7: 'Raphael', 8: 'Phoenix', 9: 'Granite Ridge' }[series] || null;
    }
    const am5 = !mobile && series >= 7;
    const model = `${number}${suffix}`;
    const x3d = /X3D/.test(suffix);
    const desktopApuPcie3 = !mobile && (series === 4 || (series === 5 && (apu || cezannePlain)) || (series === 3 && apu) || (series === 2 && apu));
    let pcie = null;
    if (!mobile) pcie = am5 ? (series === 8 ? 4 : 5) : desktopApuPcie3 || series <= 2 ? 3 : 4;
    let igpu = mobile || apu;
    if (!mobile && am5) igpu = !suffix.includes('F');
    return {
      vendor: 'AMD', family: `Ryzen ${tier}`, model, generation: series, generationLabel: `Ryzen ${series}000`,
      architecture: zen ? AMD_ZEN[zen] : null, codename, zen, segment: mobile ? 'laptop' : 'desktop',
      socket: mobile ? null : am5 ? 'AM5' : 'AM4', memoryTypes: mobile ? null : am5 ? ['DDR5'] : ['DDR4'], pcie,
      unlocked: unlockedOf(mobile, x3d, zen, suffix), igpu, x3d, dualCcdX3d: DUAL_CCD_X3D.has(model),
      apuPcie3: desktopApuPcie3, year: zen ? AMD_YEAR[zen] : null, hybrid: false, known: Boolean(zen)
    };
  }

  function decodeAmd(name) {
    let m = name.match(/Ryzen\s+AI\s+(?:(Max\+?)\s+(?:PRO\s+)?|([579])\s+(?:PRO\s+)?(HX\s+)?)(\d{3})/i);
    if (m) return { vendor: 'AMD', family: m[1] ? `Ryzen AI ${m[1].replace(/max/i, 'Max')}` : `Ryzen AI ${m[2]}`, model: `${m[3] ? 'HX ' : ''}${m[4]}`, generationLabel: 'Ryzen AI 300', architecture: 'Zen 5', zen: 'zen5', segment: 'laptop', igpu: true, hybrid: false, year: 2024, known: true, memoryTypes: ['DDR5', 'LPDDR5X'], pcie: 4 };
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
    m = name.match(/Custom APU\s+(0405|0932)/i);
    if (m) return { vendor: 'AMD', family: 'Custom APU', model: m[1], generationLabel: m[1] === '0932' ? 'Steam Deck OLED' : 'Steam Deck', architecture: 'Zen 2', zen: 'zen2', segment: 'handheld', igpu: true, hybrid: false, memoryTypes: ['LPDDR5'], year: m[1] === '0932' ? 2023 : 2022, known: true, notes: ['memória soldada na placa'] };
    m = name.match(/Athlon\s+(?:(Silver|Gold|PRO)\s+)?(\d{3,4})(GE|G|U|C|E)?\b/i);
    if (m) {
      const n = Number(m[2]);
      const suffix = (m[3] || '').toUpperCase();
      const model = `${m[1] ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' ' : ''}${m[2]}${suffix}`;
      if (/^G/.test(suffix)) return { vendor: 'AMD', family: 'Athlon', model, generationLabel: 'Athlon com vídeo Vega', architecture: n >= 3000 ? 'Zen+' : 'Zen', zen: n >= 3000 ? 'zen+' : 'zen', segment: 'desktop', socket: 'AM4', memoryTypes: ['DDR4'], pcie: 3, igpu: true, hybrid: false, year: n >= 3000 ? 2019 : 2018, known: true };
      if (n >= 7000) return { vendor: 'AMD', family: 'Athlon', model, architecture: 'Zen 2', zen: 'zen2', segment: 'laptop', igpu: true, hybrid: false, memoryTypes: ['LPDDR5'], year: 2022, known: true };
      if (n >= 3000) return { vendor: 'AMD', family: 'Athlon', model, architecture: 'Zen', zen: 'zen', segment: 'laptop', igpu: true, hybrid: false, memoryTypes: ['DDR4'], year: 2020, known: true };
      return { vendor: 'AMD', family: 'Athlon', model, segment: 'entrada', known: false };
    }
    m = name.match(/\bA(4|6|8|9|10|12)-(\d)(\d{3})([A-Z]?)/i);
    if (m) {
      const series = Number(m[2]);
      const suffix = m[4].toUpperCase();
      const number = Number(`${m[2]}${m[3]}`);
      const gen = { 3: ['Llano', 'FM1', ['DDR3'], 2011], 5: ['Trinity', 'FM2', ['DDR3'], 2012], 6: ['Richland', 'FM2', ['DDR3'], 2013], 7: ['Kaveri / Godavari', 'FM2+', ['DDR3'], 2014], 9: ['Bristol Ridge', 'AM4', ['DDR4'], 2016] }[series];
      const desktop = suffix === 'K' || (series === 9 && number >= 9500 && number < 9900) || (series === 7 && [7600, 7650, 7670, 7700, 7800, 7850, 7860, 7870, 7890].includes(number));
      return { vendor: 'AMD', family: `A${m[1]}`, model: `${m[2]}${m[3]}${suffix}`, generationLabel: 'APU série A', architecture: gen ? gen[0] : null, segment: desktop ? 'desktop' : 'entrada', socket: desktop && gen ? gen[1] : null, memoryTypes: gen ? gen[2] : null, igpu: true, hybrid: false, year: gen ? gen[3] : null, known: Boolean(gen) };
    }
    m = name.match(/(Phenom|Athlon)\(?(?:tm)?\)?\s+II\s+(X\d\s+\d{3,4}T?)/i);
    if (m) return { vendor: 'AMD', family: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} II`, model: m[2], architecture: 'K10', segment: 'desktop', socket: 'AM3', memoryTypes: ['DDR2', 'DDR3'], igpu: false, year: 2009, known: true };
    if (/Athlon|Sempron|Phenom/i.test(name)) return { vendor: 'AMD', family: (name.match(/Athlon|Sempron|Phenom/i) || [''])[0], model: null, segment: 'entrada', known: false, igpu: /with Radeon|Vega/i.test(name) || null };
    m = name.match(/EPYC\s+(?:Embedded\s+)?([0-9A-Z]{4,5}[A-Z]?)/i);
    if (m) {
      // O último dígito do número diz a geração (7xx1 Naples … 9xx5 Turin); vale também para os modelos de nuvem (9V45).
      const zen = { 1: 'zen', 2: 'zen2', 3: 'zen3', 4: 'zen4', 5: 'zen5' }[(m[1].match(/(\d)[A-Z]?$/) || [])[1]] || null;
      return { vendor: 'AMD', family: 'EPYC', model: m[1].toUpperCase(), generationLabel: 'servidor', architecture: zen ? AMD_ZEN[zen] : null, zen, segment: 'servidor', igpu: false, hybrid: false, known: Boolean(zen), year: zen ? AMD_YEAR[zen] : null };
    }
    // Desconhecido: guarda o nome limpo ("AMD Foo 123") para não mostrar só "AMD".
    const rest = name.replace(/\bAMD\b|\bProcessor\b|\b\d+-Core\b|with Radeon.*$|w\/ Radeon.*$|\(tm\)|\(r\)/gi, ' ').replace(/\s+/g, ' ').trim();
    return { vendor: 'AMD', family: rest || null, known: false };
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
    // AMD primeiro: "64-Cores" e "Compute Cores" no nome de um AMD não podem cair na regra da Intel.
    if (/AMD|Ryzen|Athlon|Threadripper|EPYC|Radeon/i.test(name) || /amd/i.test(raw.manufacturer || '')) decoded = decodeAmd(name);
    else if (/Intel|\bCore\b(?!s)|Xeon|Pentium|Celeron|Atom/i.test(name) || /intel/i.test(raw.manufacturer || '')) decoded = decodeIntel(name, cores, threads);
    else if (/Apple|Snapdragon|Qualcomm|ARM|Cortex/i.test(name)) {
      const snap = name.replace(/\((R|TM)\)/gi, '').match(/Snapdragon\s*(X\d?\s+(?:Elite|Plus)|X\b|8cx\s+Gen\s*\d|7c\+?\s+Gen\s*\d|8c|7c)/i);
      const model = (name.match(/\b(X\d[EP]\d{2}\d*)\b/) || [])[1] || null;
      decoded = { vendor: /Apple/i.test(name) ? 'Apple' : 'Qualcomm', family: snap ? `Snapdragon ${snap[1].replace(/\s+/g, ' ')}` : null, model, architecture: /Oryon|X\d?\s+(Elite|Plus)/i.test(name) ? 'Oryon' : null, segment: 'laptop', known: Boolean(snap), arm: true, igpu: true };
    }
    else decoded = { vendor: str(raw.manufacturer, 40) || null, known: false };
    // Soquete informado pelo sistema só vale se parecer soquete ("None", "CPU 1", "U3E1" ficam de fora).
    const reported = /^(FC)?LGA\s?\d{3,4}|^AM[2-5]\+?$|^sTRX?\d|^sWRX\d|^TR4$|^SP[3-6]$|^FM[12]\+?$/i.test(str(raw.socket, 30)) ? str(raw.socket, 30) : null;
    return {
      name, cores, threads, baseMHz: finite(raw.baseMHz) && raw.baseMHz > 100 ? raw.baseMHz : null, l3KB: finite(raw.l3KB) && raw.l3KB > 0 ? raw.l3KB : null,
      family: null, model: null, generation: null, generationLabel: null, architecture: null, segment: null, socket: reported,
      memoryTypes: null, pcie: null, unlocked: null, igpu: null, hybrid: null, x3d: false, dualCcdX3d: false, apuPcie3: false, year: null, notes: [],
      ...decoded, socket: decoded.socket || reported, socketReported: str(raw.socket, 30) || null
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
    C('990X', 'AMD', 'AM3+', 'DDR3', 'PCIe 2.0', true, true, 'FX e Phenom II'),
    C('760G', 'AMD', 'AM3+', 'DDR3', 'PCIe 2.0', false, true, 'FX, Phenom II e Athlon II', 'placa de entrada: FX de 8 núcleos podem esquentar os reguladores e perder clock'),
    C('880G', 'AMD', 'AM3+', 'DDR3', 'PCIe 2.0', true, true, 'FX, Phenom II e Athlon II'),
    // Intel
    ...['H61', 'B65', 'H67', 'P67', 'Z68', 'Q67'].map((id) => C(id, 'Intel', 'LGA1155', 'DDR3', 'PCIe 2.0', id === 'P67' || id === 'Z68', id === 'P67' || id === 'Z68', '2ª e 3ª geração')),
    ...['B75', 'H77', 'Z75', 'Z77', 'Q77'].map((id) => C(id, 'Intel', 'LGA1155', 'DDR3', 'PCIe 3.0 com 3ª geração', id.startsWith('Z'), id.startsWith('Z'), '2ª e 3ª geração')),
    ...['H81', 'B85', 'H87', 'Z87', 'Q87'].map((id) => C(id, 'Intel', 'LGA1150', 'DDR3', 'PCIe 3.0', id === 'Z87', id === 'Z87', '4ª geração')),
    ...['H97', 'Z97'].map((id) => C(id, 'Intel', 'LGA1150', 'DDR3', 'PCIe 3.0', id === 'Z97', id === 'Z97', '4ª e 5ª geração')),
    C('X79', 'Intel', 'LGA2011', 'DDR3 (4 canais)', 'PCIe 3.0', true, true, 'Core i7 série X (Sandy/Ivy Bridge-E) e Xeon E5 v1/v2'),
    C('X99', 'Intel', 'LGA2011-3', 'DDR4 (4 canais)', 'PCIe 3.0', true, true, 'Core i7 série X (Haswell/Broadwell-E) e Xeon E5 v3/v4'),
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
  // Nomes em que o chipset vem colado a um prefixo do fabricante: ASUS P8H61/P8Z77/P9X79, Pcware IPMH310G,
  // Afox IH81, ASRock/Gigabyte AB350/AX370 e as AM3+ M5A97/M5A78L/78LMT.
  const CHIPSET_ALIASES = [[/^M5A97|^GA-970|\b970A?-/, '970'], [/^M5A78L|78LMT|^GA-78L/, '760G'], [/^M5A88|^GA-880G/, '880G'], [/^M5A99X|990X[AT]?-/, '990X']];
  function decodeChipset(product, cpu = null) {
    const raw = str(product, 80).toUpperCase();
    if (!raw) return null;
    const alias = CHIPSET_ALIASES.find(([pattern]) => pattern.test(raw));
    if (alias && (!cpu?.vendor || cpu.vendor === 'AMD')) return { ...CHIPSET_BY_ID.get(alias[1]), matched: alias[1] };
    const text = raw.replace(/^(?:P\d{1,2}|IPM|IPX|IP|I)(?=[HBZQX]\d{2})/, '').replace(/(^|[^A-Z0-9])A(?=(B350|X370|B450|X470)\b)/, '$1');
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
    let m = part.match(/^F[345]-(\d{4})([CJU])(\d{2}|\d(?=\D))/); // G.Skill: F4-3200C16, F5-6000J3038 (CL30), F3-1600C9D (CL9)
    if (m) return { speed: Number(m[1]), cl: Number(m[3]), brand: 'G.Skill', jedec: false };
    m = part.match(/^CM[A-Z]{1,5}\d+GX[345]M\d[A-Z](\d{4})C(\d{2})/); // Corsair
    if (m) return { speed: Number(m[1]), cl: Number(m[2]), brand: 'Corsair', jedec: false };
    m = part.match(/^KF([345])(\d{2})C(\d{2})/); // Kingston Fury
    if (m && SPEED_FROM_TWO[m[2]]) return { speed: m[1] === '5' && m[2] === '56' ? 5600 : SPEED_FROM_TWO[m[2]], cl: Number(m[3]), brand: 'Kingston Fury', jedec: false };
    m = part.match(/^KHX(\d{4})C(\d{1,2})(?!\d)/); // HyperX antigo: KHX2666C16, KHX1600C10D3
    if (m) return { speed: Number(m[1]), cl: Number(m[2]), brand: 'Kingston HyperX', jedec: false };
    m = part.match(/^HX[34](\d{2})C(\d{2})/); // HyperX
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'HyperX', jedec: false };
    m = part.match(/^KVR(\d{2})[A-Z](\d{2})/); // Kingston ValueRAM (sem XMP)
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'Kingston', jedec: true };
    m = part.match(/^BL(?:\d)?K?\d+G(\d{2})C(\d{2})/); // Crucial Ballistix
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'Crucial Ballistix', jedec: false };
    m = part.match(/^BLS?(?:\d?K)?\d+G4D(\d{2,3})/); // Ballistix Sport: BLS8G4D30AESBK = 3000, BLS8G4D240FSB = 2400
    if (m) { const speed = m[1].length === 3 ? { 213: 2133, 240: 2400, 266: 2666, 300: 3000, 320: 3200 }[m[1]] : SPEED_FROM_TWO[m[1]]; if (speed) return { speed, cl: null, brand: 'Crucial Ballistix', jedec: false }; }
    m = part.match(/^CP(?:\d?K)?\d+G(?:5)?(\d{2})C(\d{2})/); // Crucial Pro DDR5 (com XMP/EXPO)
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'Crucial Pro', jedec: false };
    m = part.match(/^C[TP](?:\dK)?\d+G4[A-Z]{2,5}(\d{3})/); // Crucial DDR4 de fábrica: 266 = 2666, 320 = 3200
    if (m) { const speed = { 213: 2133, 240: 2400, 266: 2666, 293: 2933, 320: 3200 }[m[1]]; if (speed) return { speed, cl: null, brand: 'Crucial', jedec: true }; }
    m = part.match(/^C[TP](?:\dK)?\d+G4[A-Z]{2,5}(\d{2})/);
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: null, brand: 'Crucial', jedec: true };
    m = part.match(/^CT(?:\dK)?\d+G(\d{2})C(\d{2})/); // Crucial DDR5 de fábrica: CT16G48C40U5 = 4800 CL40
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: Number(m[2]), brand: 'Crucial', jedec: true };
    m = part.match(/^A([XD])([45])[US](\d{4})(?:C(\d{2})|\d{1,2}G(\d{2}))?/); // ADATA/XPG: AX4U32008G16A = 3200 CL16; AD4U32008G22 = 3200 CL22 (sem XMP)
    if (m && STANDARD_SPEEDS.includes(Number(m[3]))) return { speed: Number(m[3]), cl: Number(m[4] || m[5]) || null, brand: m[1] === 'X' ? 'ADATA XPG' : 'ADATA', jedec: m[1] === 'D' };
    m = part.match(/^GR(\d{4})D[345]\d{2}L(\d{2})/) || part.match(/^IR-?X?(\d{4})D[345]\d{2}L(\d{2})/); // Goodram e IRDM: GR3200D464L22S = 3200 CL22
    if (m && STANDARD_SPEEDS.includes(Number(m[1]))) return { speed: Number(m[1]), cl: Number(m[2]), brand: /^GR/.test(part) ? 'Goodram' : 'Goodram IRDM', jedec: /^GR/.test(part) };
    m = part.match(/^PSD[345]\d{1,2}G(\d{4})/); // Patriot Signature (sem XMP): PSD48G266681 = 2666
    if (m && STANDARD_SPEEDS.includes(Number(m[1]))) return { speed: Number(m[1]), cl: null, brand: 'Patriot', jedec: true };
    m = part.match(/^ACR(\d{2})D[345]/); // Apacer: ACR26D4S9S8ME = 2666
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: null, brand: 'Apacer', jedec: true };
    m = part.match(/^NT[A-Z]*D[345]P(\d{2})/); // Netac: NTBSD4P32SP = 3200
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: null, brand: 'Netac', jedec: true };
    m = part.match(/^MTC[A-Z0-9]{4,14}?S1[A-Z]{2}(\d{2})/); // Micron DDR5: MTC8C1084S1SC48BA1 = 4800
    if (m && SPEED_FROM_TWO[m[1]]) return { speed: SPEED_FROM_TWO[m[1]], cl: null, brand: 'Micron', jedec: true };
    m = part.match(/^M[34]\d{2}R[A-Z0-9]{5,9}-C(QK|WM|SB)/); // Samsung DDR5: -CQK = 4800, -CWM = 5600
    if (m) return { speed: { QK: 4800, WM: 5600, SB: 6400 }[m[1]], cl: null, brand: 'Samsung', jedec: true };
    m = part.match(/^M[34]\d{2}[A-Z0-9]{6,9}-(C[A-Z]{2})/); // Samsung
    if (m && SAMSUNG_CODES[m[1]]) return { speed: SAMSUNG_CODES[m[1]], cl: null, brand: 'Samsung', jedec: true };
    m = part.match(/^HMA[A-Z0-9]{6,12}-([A-Z]{2})/); // SK Hynix DDR4
    if (m && HYNIX_CODES[m[1]]) return { speed: HYNIX_CODES[m[1]], cl: null, brand: 'SK Hynix', jedec: true };
    m = part.match(/^(?:MTA)?\d?ATF[A-Z0-9]{4,12}-(\d)G(\d)/) || part.match(/^MTA[A-Z0-9]{6,14}-(\d)G(\d)/); // Micron (com ou sem o prefixo MTA)
    if (m) { const speed = { '21': 2133, '24': 2400, '26': 2666, '29': 2933, '32': 3200 }[`${m[1]}${m[2]}`]; if (speed) return { speed, cl: null, brand: 'Micron', jedec: true }; }
    m = part.match(/^PV[A-Z]?[45]\d{2}G(\d{3})C(\d)/); // Patriot: PVS416G320C6K = 3200 CL16
    if (m) { const speed = { 266: 2666, 300: 3000, 320: 3200, 360: 3600, 400: 4000, 560: 5600, 600: 6000, 640: 6400 }[m[1]]; if (speed) return { speed, cl: Number(`1${m[2]}`), brand: 'Patriot', jedec: false }; }
    // Genérico: TeamGroup, Lexar, Ramaxel, Rise e outros põem a velocidade inteira no código. A latência só conta com a
    // letra na frente (3200HC16, 3200C22, 3200CL16): "3200D464" não é CL46.
    const brand = [[/^(TLZ|TF\d|FF\d|TED|TDP|TTZ|TCD|CTCED|FLB|FLR|TPD|TLRD|TXBD)/, 'TeamGroup'], [/^LD[345]/, 'Lexar'], [/^RM[SA]/, 'Ramaxel'], [/^(99U5|9905|9965)/, 'Kingston']].find(([pattern]) => pattern.test(part))?.[1] || null;
    for (const speed of [...STANDARD_SPEEDS].reverse()) {
      if (new RegExp(`(?<!\\d)${speed}(?!\\d)`).test(part)) { const cl = part.match(new RegExp(`${speed}(?:HC|CL|C)(\\d{2})`)); return { speed, cl: cl ? Number(cl[1]) : null, brand, jedec: cl ? false : null, generic: true }; }
    }
    return null;
  }

  /** Canal do pente pelo nome do slot ("DIMM_A2", "ChannelB-DIMM0", "P0 CHANNEL A", "DDR4_B1"). */
  function channelOf(locator, bank) {
    const text = `${str(locator, 60)} ${str(bank, 60)}`.toUpperCase();
    // DDR5 na Intel 12ª+: "Controller0-ChannelA" e "Controller1-ChannelA" são canais diferentes.
    const controller = text.match(/CONTROLLER\s*(\d)/);
    const prefix = controller ? `C${controller[1]}` : '';
    let m = text.match(/CHANNEL\s*[-_]?\s*([A-H])\b/);
    if (m) return prefix + m[1];
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
    [/R[579]\s*\d{3}/i, { family: 'Radeon R5/R7/R9', architecture: 'GCN', year: 2013, rebar: false, features: [], legacyDriver: true }],
    [/HD\s*[78]\d{3}/i, { family: 'Radeon HD 7000/8000', architecture: 'GCN 1', year: 2012, rebar: false, features: [], legacyDriver: true }],
    [/HD\s*[56]\d{3}/i, { family: 'Radeon HD 5000/6000', architecture: 'TeraScale', year: 2010, rebar: false, features: [], legacyDriver: true }],
    [/Pro\s+W7\d{3}/i, { family: 'Radeon Pro W7000 (estação de trabalho)', architecture: 'RDNA 3', year: 2023, rebar: true, features: ['AV1'], workstation: true }],
    [/Pro\s+W6\d{3}/i, { family: 'Radeon Pro W6000 (estação de trabalho)', architecture: 'RDNA 2', year: 2021, rebar: true, features: [], workstation: true }],
    [/Pro\s+W5\d{3}/i, { family: 'Radeon Pro W5000 (estação de trabalho)', architecture: 'RDNA', year: 2019, rebar: false, features: [], workstation: true }],
    [/Pro\s+WX\s*\d{4}/i, { family: 'Radeon Pro WX (estação de trabalho)', architecture: 'Polaris', year: 2016, rebar: false, features: [], workstation: true }]
  ];
  // Placas de estação de trabalho da NVIDIA (vêm antes das GeForce: "RTX 4000 Ada" não é uma RTX 40 de jogo).
  const NV_PRO = [
    [/RTX\s+\d{4}\s+Ada/i, { family: 'NVIDIA RTX Ada (estação de trabalho)', architecture: 'Ada Lovelace', year: 2023, rebar: true, features: ['DLSS 3', 'AV1'], workstation: true }],
    [/RTX\s+A\d{3,4}/i, { family: 'NVIDIA RTX série A (estação de trabalho)', architecture: 'Ampere', year: 2021, rebar: null, features: ['DLSS 2'], workstation: true }],
    [/Quadro\s+RTX|Quadro\s+T\d|\bT(400|600|1000|1200|2000)\b|TITAN\s+RTX/i, { family: 'Quadro / NVIDIA T (Turing)', architecture: 'Turing', year: 2018, rebar: false, features: [], workstation: true }],
    [/Quadro\s+P\d|TITAN\s+Xp?\b/i, { family: 'Quadro / TITAN (Pascal)', architecture: 'Pascal', year: 2016, rebar: false, features: [], workstation: true, legacyDriver: true }],
    [/Quadro\s+(K|M)\d/i, { family: 'Quadro (Kepler/Maxwell)', architecture: 'Kepler / Maxwell', year: 2013, rebar: false, features: [], workstation: true, legacyDriver: true }],
    [/TITAN\s+V\b/i, { family: 'TITAN V', architecture: 'Volta', year: 2017, rebar: false, features: [], workstation: true }]
  ];
  // Vídeo integrado da AMD pela família (o nome diz a geração).
  const AMD_IGPU = [
    [/Radeon\s+(8060S|8050S|8040S|890M|880M|860M|840M|820M)/i, { family: 'Radeon integrada (RDNA 3.5)', architecture: 'RDNA 3.5', year: 2024, features: ['FSR 3', 'AV1'] }],
    [/Radeon\s+(780M|760M|740M)/i, { family: 'Radeon integrada (RDNA 3)', architecture: 'RDNA 3', year: 2023, features: ['FSR 3', 'AV1'] }],
    [/Radeon\s+(680M|660M|610M)|Custom GPU 0(405|932)/i, { family: 'Radeon integrada (RDNA 2)', architecture: 'RDNA 2', year: 2022, features: ['FSR'] }],
    [/Vega\s*\d+/i, { family: 'Radeon Vega integrada', architecture: 'GCN 5 (Vega)', year: 2018, features: ['FSR'] }]
  ];
  const INTEGRATED = /Custom GPU 0(405|932)|Adreno|UHD Graphics|HD Graphics|Iris|Intel\(?R?\)?\s*Graphics|Radeon(?:\(TM\))?\s+RX\s+Vega\s+\d+\s+Graphics|Radeon(?:\(TM\))?\s+R[2-7]\s+Graphics|Arc(?:\(TM\))?\s+(?:\d{3}V\s+)?(?:GPU|Graphics)$|Radeon(?:\(TM\))?\s+Graphics|Radeon\s+Vega\s+\d+\s+Graphics|Radeon(?:\(TM\))?\s+\d{3}M|Radeon\s+\d{4}S|Vega\s+\d\b/i;

  function decodeGpu(gpu, now = Date.now()) {
    const raw = gpu && typeof gpu === 'object' ? gpu : {};
    const name = cleanName(raw.name);
    const vendorId = str(raw.vendorId, 4).toUpperCase();
    const vendor = vendorId === '10DE' || /NVIDIA|GeForce|Quadro/i.test(name) ? 'NVIDIA' : vendorId === '1002' || /AMD|Radeon/i.test(name) ? 'AMD' : vendorId === '8086' || /Intel/i.test(name) ? 'Intel' : vendorId === '1414' || /Basic Display|Microsoft/i.test(name) ? 'Microsoft' : vendorId === '5143' || vendorId === 'QCOM' || /Qualcomm|Adreno/i.test(name) ? 'Qualcomm' : null;
    let info = null;
    if (vendor === 'NVIDIA') info = (NV_PRO.find(([pattern]) => pattern.test(name)) || NV_FAMILIES.find(([pattern]) => pattern.test(name)))?.[1] || null;
    if (vendor === 'AMD' && !INTEGRATED.test(name)) info = AMD_FAMILIES.find(([pattern]) => pattern.test(name))?.[1] || null;
    if (vendor === 'AMD' && INTEGRATED.test(name)) info = AMD_IGPU.find(([pattern]) => pattern.test(name))?.[1] || null;
    if (vendor === 'Intel' && !/Arc.*\b[AB]\d{3}/i.test(name)) {
      if (/\b1[234]0V\b/i.test(name)) info = { family: 'Arc integrada (Xe2)', architecture: 'Xe2', year: 2024, features: ['XeSS', 'AV1'] };
      else if (/Arc/i.test(name) || /^Intel(\(R\))?\s*Graphics$/i.test(name)) info = { family: 'Arc integrada', architecture: 'Xe-LPG', year: 2023, features: ['XeSS', 'AV1'] };
      else if (/Iris.*Xe|UHD Graphics\s*7\d{2}|UHD Graphics$/i.test(name)) info = { family: /Iris/i.test(name) ? 'Iris Xe' : 'UHD (Xe)', architecture: 'Xe-LP', year: 2020, features: ['AV1 (só reprodução)'] };
    }
    if (vendor === 'Intel' && /Arc.*\bB\d{3}/i.test(name)) info = { family: 'Arc série B', architecture: 'Battlemage', year: 2024, rebar: true, needsRebar: true, features: ['XeSS', 'AV1'] };
    else if (vendor === 'Intel' && /Arc.*\bA\d{3}/i.test(name)) info = { family: 'Arc série A', architecture: 'Alchemist', year: 2022, rebar: true, needsRebar: true, features: ['XeSS', 'AV1'] };
    // Adaptador de máquina virtual (Hyper-V, VMware, VirtualBox…) não é "sem driver": é o vídeo da VM.
    const virtual = /Hyper-V|VMware|VirtualBox|QXL|Virtio|Parallels|Red Hat|Citrix|Remote Display|Indirect Display|Virtual ?Display|Virtual ?Monitor|Virtual Adapter|Parsec|spacedesk|Mirage|Sunshine|Idd(Sample|Driver)|Oray|ToDesk|AnyDesk|TeamViewer|RustDesk|NoMachine|Duet Display|Splashtop|DisplayLink|usbmmidd|Amyuni|Mirror Driver/i.test(name);
    const basicDriver = !virtual && (/Basic Display|Básico|Basic Render/i.test(name) || (vendor === 'Microsoft' && !/Remote|Indirect/i.test(name)));
    const integrated = !basicDriver && !virtual && vendor !== 'NVIDIA' && (INTEGRATED.test(name) || (vendor === 'Intel' && (!info || /integrada|Iris|UHD/.test(info.family))));
    const tier = name.match(/(?:RTX|GTX|RX)\s*\d{3,4}\s*(Ti\s*SUPER|Ti|SUPER|XTX|XT|GRE)?/i);
    const driverAge = ageDays(raw.driverDate, now);
    return {
      name, vendor, vendorId: vendorId || null, deviceId: str(raw.deviceId, 4).toUpperCase() || null, integrated, virtual, discrete: !integrated && !basicDriver && !virtual,
      mobile: /Laptop|Mobile|Max-Q|\bMX\s*\d/i.test(name) || /\d{3,4}M\b/.test(name) && !integrated, basicDriver,
      family: info?.family || null, architecture: info?.architecture || null, year: info?.year || null, features: info?.features || [], workstation: Boolean(info?.workstation),
      rebarCapable: info && !integrated ? info.rebar ?? null : null, needsRebar: Boolean(info?.needsRebar), legacyDriver: Boolean(info?.legacyDriver), entry: Boolean(info?.entry),
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

  const SSD_MODEL = /\b(SA400|A400|SUV500|KC600|SKC\d|SHFS|SV300|SEDC|MZ-?[0-9A-Z]{4}|MX500|BX500|CT\d+(MX|BX)\d|WDS\d|SDSSD|SU\d{3}|SX\d{3,4}|PNY CS\d|CS900|CS1311|TS\d+G(SSD|MTS)|GOODRAM|IRDM|WD (Green|Blue) SA|Crucial_CT|Patriot (Burst|P2\d0)|KINGSTON SV|Netac|Rise Mode|Lexar NS\d|HIKVISION|XrayDisk|Colorful SL)/i;
  const HDD_MODEL = /^(ST\d{3,5}(DM|LM|VX|NM|NE|AS|LX|DX)|WDC WD\d|WD\d{2,}[A-Z]{2}|TOSHIBA (DT|MQ|HDW|MG|MD)|HGST|Hitachi H|SAMSUNG (HD|HM|SP)\d|ST\d{3,4}[A-Z]{2}\d)/i;
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
    // Sem tipo informado (MediaType "Unspecified", comum em controladoras RAID/AHCI antigas): o modelo entrega.
    else if (SSD_MODEL.test(model)) kind = 'ssd';
    else if (HDD_MODEL.test(model)) kind = 'hdd';
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
      gigabitCapable: !wifi && !/Fast Ethernet|\bFE\b/i.test(description) && /gigabit|\bGbE\b|2\.5G|2500|5G\b|10G|1000|Ethernet Controller \(3\)|\bI2[0-9]{2}-?(V|LM|AT|IT)\b|E3100|AQC|AQtion|Killer|NetXtreme|AR81[3-7]1\b|AX88179/i.test(description),
      wifi: wifi && raw.wifi && typeof raw.wifi === 'object' ? {
        signal: finite(raw.wifi.signal) && raw.wifi.signal >= 0 && raw.wifi.signal <= 100 ? raw.wifi.signal : null,
        band: raw.wifi.band === 2.4 || raw.wifi.band === 5 || raw.wifi.band === 6 ? raw.wifi.band : null,
        standard: /^802\.11[a-z]{1,2}$/i.test(String(raw.wifi.standard || '')) ? String(raw.wifi.standard).toLowerCase() : null
      } : null
    };
  }

  const CHASSIS = { 3: 'desktop', 4: 'desktop', 5: 'desktop', 6: 'desktop', 7: 'desktop', 15: 'desktop', 16: 'desktop', 8: 'laptop', 9: 'laptop', 10: 'laptop', 14: 'laptop', 31: 'laptop', 32: 'laptop', 30: 'laptop', 11: 'handheld', 13: 'aio', 35: 'minipc', 36: 'minipc' };
  const KIND_LABEL = { desktop: 'PC de mesa', laptop: 'notebook', handheld: 'portátil de jogos', aio: 'tudo-em-um', minipc: 'mini PC', virtual: 'máquina virtual' };
  // Máquina virtual: as "peças" são virtuais (disco que parece mecânico, vídeo da VM); vários conselhos não valem.
  const VIRTUAL_SYSTEM = /Virtual Machine|VMware|VirtualBox|QEMU|KVM|Bochs|Parallels|Xen|HVM domU|Standard PC \(|Google Compute|Amazon EC2|BHYVE|Cloud Hypervisor|Firecracker/i;
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
    const virtual = raw.hypervisor === true || VIRTUAL_SYSTEM.test(`${raw.manufacturer || ''} ${raw.model || ''} ${raw.family || ''}`);
    if (virtual) kind = 'virtual';
    return { kind, kindLabel: kind ? KIND_LABEL[kind] : null, maker: maker(raw.manufacturer), model: product(raw.model), virtual };
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
    let battery = inv.battery && finite(inv.battery.designWh) && inv.battery.designWh > 0 ? {
      designWh: inv.battery.designWh, fullWh: finite(inv.battery.fullWh) ? inv.battery.fullWh : null,
      wear: finite(inv.battery.fullWh) && inv.battery.fullWh > 0 ? Math.max(0, Math.min(100, Math.round((1 - inv.battery.fullWh / inv.battery.designWh) * 100))) : null
    } : null;
    if (!battery && inv.battery && finite(inv.battery.wear)) battery = { designWh: null, fullWh: null, wear: Math.max(0, Math.min(100, Math.round(inv.battery.wear))) };
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
    const disks = (Array.isArray(inv.disks) ? inv.disks : []).slice(0, 12).map(decodeDisk).filter((disk) => !disk.sizeBytes || disk.sizeBytes >= 1e9)
      .map((disk) => (system.virtual && !disk.model ? { ...disk, kind: 'virtual', label: 'disco virtual' } : disk));
    const network = (Array.isArray(inv.network) ? inv.network : []).slice(0, 8).map(decodeNetwork);
    return {
      kind: system.kind, kindLabel: system.kindLabel, virtual: system.virtual, system: { maker: system.maker, model: system.model }, cpu, board,
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

  /** Nome como vem na caixa: "Intel Core i7-13650HX", "AMD Ryzen 7 5800X3D". */
  function cpuTitle(cpu, { vendor = true } = {}) {
    if (!cpu) return null;
    const model = /^(Core [im]\d|A\d{1,2})$/.test(cpu.family || '') && cpu.model ? `${cpu.family}-${cpu.model}` : [cpu.family, cpu.model].filter(Boolean).join(' ');
    return [vendor ? cpu.vendor : null, model].filter(Boolean).join(' ') || cpu.name || null;
  }

  function cpuLine(cpu) {
    const head = cpuTitle(cpu) || 'Processador';
    const bits = [cpu.architecture, cpu.generationLabel && !String(cpu.architecture || '').includes(cpu.generationLabel) ? cpu.generationLabel : null].filter(Boolean);
    const threads = cpu.threads && cpu.threads !== cpu.cores ? ` / ${cpu.threads} threads` : '';
    const cores = cpu.cores ? `${cpu.cores} núcleos${threads}` : null;
    const extra = [cores, cpu.hybrid ? 'núcleos P e E' : null, cpu.x3d ? '3D V-Cache' : null, cpu.socket].filter(Boolean);
    return [head, bits.join(', '), extra.join(', ')].filter(Boolean).join(' · ');
  }

  function memoryLine(memory) {
    if (!memory.totalBytes) return null;
    const count = memory.modules.length;
    const sizes = count ? [...new Set(memory.modules.map((module) => gbText(module.capacityBytes)))] : [];
    const head = memory.soldered ? `${gbText(memory.totalBytes)} soldados na placa` : count ? `${count} ${count > 1 ? 'pentes' : 'pente'} de ${sizes.join(' + ')}` : gbText(memory.totalBytes);
    const speed = memory.configured ? (memory.type ? memory.type + '-' : '') + memory.configured : memory.type;
    return [head, LAYOUT_TEXT[memory.layout], speed].filter(Boolean).join(', ');
  }

  function boardLine(board) {
    const name = [board.maker, board.product].filter(Boolean).join(' ');
    if (!name) return null;
    const chipset = board.chipset ? `chipset ${board.chipset.vendor} ${board.chipset.id} (${board.chipset.socket}, ${board.chipset.ddr})` : null;
    return chipset ? `${name} → ${chipset}` : name;
  }

  function gpuLine(gpu) {
    let kind = 'placa de vídeo';
    if (gpu.basicDriver) kind = 'sem driver de vídeo';
    else if (gpu.virtual) kind = 'vídeo de máquina virtual';
    else if (gpu.integrated) kind = 'vídeo integrado';
    else if (gpu.family) kind = `${gpu.family}, ${gpu.architecture}`;
    const vram = gpu.vramBytes && !gpu.integrated ? gbText(gpu.vramBytes) : null;
    return `${gpu.name} · ${[kind, vram].filter(Boolean).join(', ')}`;
  }

  function displayLine(display) {
    if (!display.width || !display.hz) return null;
    const max = display.maxHz && display.maxHz > display.hz ? ` (aceita até ${display.maxHz} Hz)` : '';
    return `${display.name || 'Monitor'}: ${display.width}×${display.height} a ${display.hz} Hz${max}`;
  }

  function diskLine(disk, system = 'o Windows') {
    let size = null;
    if (disk.sizeBytes >= 1e12) size = `${(disk.sizeBytes / 1e12).toFixed(1).replace('.', ',').replace(',0', '')} TB`;
    else if (disk.sizeBytes) size = `${Math.round(disk.sizeBytes / 1e9)} GB`;
    const details = [disk.label, size, disk.system ? `com ${system}` : null];
    return disk.model ? `${disk.model}: ${details.filter(Boolean).join(', ')}` : details.filter(Boolean).join(', ');
  }

  /**
   * Nome curtinho de cada peça, escrito embaixo da estrela na constelação: "Ryzen 7 5700X3D", "ASUS B550",
   * "2×8 GB DDR4", "RTX 4060 Ti", "SSD NVMe 1 TB", "Wi-Fi 6", "Windows 11 24H2". Peça desconhecida fica sem nome.
   */
  function shortNames(profile) {
    const p = profile && typeof profile === 'object' ? profile : {};
    const cut = (text, max = 24) => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
    };
    const names = {};
    const cpu = p.cpu || {};
    let cpuName = cpu.family ? cpuTitle(cpu, { vendor: false }) : cleanName(cpu.name).replace(/\b(Processor|CPU)\b.*$/i, '').replace(/@.*$/, '');
    if (/^Steam Deck/.test(cpu.generationLabel || '')) cpuName = 'APU do Steam Deck';
    else if (cpu.arm && cpu.family) cpuName = cpu.family;
    if (cpuName) names.cpu = cut(cpuName.replace(/\bCPU\s+/i, ''));
    const board = p.board || {};
    if (/valve/i.test(`${board.maker || ''} ${p.system?.maker || ''}`)) names.board = 'Steam Deck';
    else if (board.chipset?.id) names.board = cut([board.maker, board.chipset.id].filter(Boolean).join(' '));
    else if (p.kind === 'laptop' && p.system?.model) names.board = cut(p.system.model);
    else if (board.product) names.board = cut([board.maker, board.product].filter(Boolean).join(' '));
    else if (p.virtual) names.board = 'máquina virtual';
    const memory = p.memory || {};
    if (memory.totalBytes) {
      const sizes = [...new Set((memory.modules || []).map((module) => module.capacityBytes))];
      const count = (memory.modules || []).length;
      const head = count > 1 && sizes.length === 1 && !memory.soldered ? `${count}×${gbText(sizes[0])}` : gbText(memory.totalBytes);
      names.memory = cut([head, memory.type].filter(Boolean).join(' '));
    }
    const gpus = p.gpus || [];
    const gpu = gpus.find((item) => item.discrete) || gpus.find((item) => item.integrated) || gpus[0];
    if (gpu?.name) {
      let name = gpu.name.replace(/\((R|TM)\)/gi, '').replace(/\s*\(\d+\s*GB\)/i, '').replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+(?=RTX|GTX|GT|MX)/i, '')
        .replace(/^(AMD\s+)?Radeon\s+(?=RX|Pro|R\d|Vega|HD)/i, '').replace(/^AMD\s+(?=Radeon\s+VII)/i, '').replace(/^AMD\s+(?=Radeon\s+\d)/i, '').replace(/^(Intel|Qualcomm)\s+/i, '')
        .replace(/\s+(Laptop GPU|GPU|Graphics|Series|Ada Generation)$/i, '').replace(/\s+Graphics\b/i, '').replace(/\s+/g, ' ').trim();
      if (gpu.integrated && /^(AMD\s+)?Radeon$/i.test(name)) name = 'Radeon integrada';
      else if (gpu.integrated && /^(Arc|Graphics|)$/i.test(name)) name = gpu.vendor === 'Intel' ? 'vídeo Intel integrado' : 'vídeo integrado';
      if (/Custom GPU 0(405|932)/i.test(gpu.name)) name = 'vídeo do Steam Deck';
      if (/RTX\s+\d{4}\s+Ada/i.test(gpu.name)) name = `${name} Ada`;
      if (gpu.virtual) name = /Hyper-V/i.test(gpu.name) ? 'vídeo Hyper-V' : 'vídeo virtual';
      if (gpu.basicDriver) name = 'sem driver';
      names.gpu = cut(name);
    }
    const disks = p.disks || [];
    const disk = disks.find((item) => item.system) || disks[0];
    if (disk) {
      let size = '';
      if (disk.sizeBytes >= 1e12) size = `${(disk.sizeBytes / 1e12).toFixed(1).replace('.', ',').replace(',0', '')} TB`;
      else if (disk.sizeBytes) size = `${Math.round(disk.sizeBytes / 1e9)} GB`;
      const label = { nvme: 'SSD NVMe', ssd: 'SSD', hdd: 'HD', usb: 'USB', virtual: 'disco virtual' }[disk.kind] || 'disco';
      const more = disks.length > 1 ? ` +${disks.length - 1}` : '';
      names.disk = cut(`${label} ${size}`.trim() + more);
    }
    const adapters = (p.network || []).filter((item) => item.up);
    const net = adapters.find((item) => item.kind === 'ethernet' && item.linkMbps) || adapters.find((item) => item.kind === 'wifi') || adapters[0];
    if (net) {
      const WIFI = { be: 'Wi-Fi 7', ax: 'Wi-Fi 6', ac: 'Wi-Fi 5', n: 'Wi-Fi 4' };
      const speed = (mbps) => (mbps >= 1000 ? `${String(Math.round(mbps / 100) / 10).replace('.', ',')} Gb/s` : `${mbps} Mb/s`);
      if (net.kind === 'wifi') names.network = WIFI[(net.wifi?.standard || '').replace('802.11', '')] || 'Wi-Fi';
      else names.network = net.linkMbps ? `cabo ${speed(net.linkMbps)}` : 'cabo';
    }
    if (p.os?.name) names.windows = cut(p.os.name.replace(/^Microsoft\s+/i, ''));
    return names;
  }

  /* ======================================================================================================
   * O que cada peça significa (o "entender o setup"): limites, recursos e o caminho de upgrade
   * ==================================================================================================== */
  const UPGRADE = {
    AM4: 'fim de linha da plataforma: o mais rápido para jogos nela é o Ryzen 7 5800X3D/5700X3D (com BIOS atual)',
    AM5: 'plataforma com caminho de upgrade (Ryzen 7000, 8000G e 9000, e a AMD prometeu suporte por mais gerações)',
    LGA1700: 'aceita até a 14ª geração da Intel (Core i9-14900K); a geração seguinte usa outro soquete',
    LGA1200: 'aceita até a 11ª geração da Intel; trocar o processador além disso exige placa-mãe nova',
    'LGA1151 v2': 'aceita até a 9ª geração da Intel', LGA1151: 'aceita até a 7ª geração da Intel', LGA1150: 'aceita até a 4ª/5ª geração da Intel',
    LGA1851: 'Core Ultra série 2 (desktop)'
  };
  function traits(profile) {
    const p = profile || {};
    const out = { cpu: [], board: [], memory: [], gpu: [], disk: [], network: [], windows: [] };
    const cpu = p.cpu || {};
    if (cpu.hybrid) out.cpu.push('núcleos P (desempenho) e E (eficiência): o agendador do Windows 11 decide em qual núcleo cada tarefa roda');
    if (cpu.efficiencyOnly) out.cpu.push('só núcleos de eficiência: bom para tarefas leves, limitado em jogos pesados');
    if (cpu.x3d && cpu.dualCcdX3d) out.cpu.push('cache 3D em só metade dos núcleos: o jogo precisa ir para os núcleos com cache (driver de chipset + Barra de Jogo)');
    else if (cpu.x3d) out.cpu.push(cpu.zen === 'zen5' ? 'cache 3D: ganha muito em jogos que dependem do processador (nesta geração o overclock é liberado)' : 'cache 3D: ganha muito em jogos que dependem do processador; o overclock de multiplicador é travado');
    if (cpu.unlocked === true && !cpu.x3d) out.cpu.push('multiplicador destravado (aceita overclock com a placa-mãe certa)');
    if (cpu.igpu === false) out.cpu.push('sem vídeo integrado: o PC depende da placa de vídeo para ter imagem');
    if (cpu.apuPcie3) out.cpu.push('PCIe 3.0 no slot da placa de vídeo (limite deste processador, mesmo em placa-mãe mais nova)');
    if (['zen4', 'zen5'].includes(cpu.zen) && cpu.segment === 'desktop') out.cpu.push('sobe até 95 °C sob carga por projeto (isso é normal neste Ryzen)');
    if (cpu.raptorRisk) out.cpu.push('13ª/14ª geração de alto consumo: BIOS com microcódigo 0x12B ou mais novo protege contra o desgaste de tensão');
    if (cpu.memoryTypes?.length) out.cpu.push(`memória suportada: ${cpu.memoryTypes.join(' ou ')}`);
    const socket = cpu.socket || p.board?.chipset?.socket;
    if (UPGRADE[socket] && p.kind !== 'laptop') out.cpu.push(`soquete ${socket}: ${UPGRADE[socket]}`);
    const chip = p.board?.chipset;
    if (chip) {
      out.board.push(`processadores: ${chip.cpus}`);
      out.board.push([chip.ddr, chip.pcie].filter(Boolean).join('; '));
      out.board.push(`${chip.cpuOc ? 'aceita overclock do processador' : 'sem overclock do processador'}; ${chip.memOc === false ? 'memória presa na velocidade oficial' : 'aceita perfil de memória (XMP/EXPO)'}`);
      // A nota da B550 (PCIe 3.0 com Ryzen derivado de APU) só importa quando o processador é um desses.
      if (chip.note && !(chip.id === 'B550' && !cpu.apuPcie3)) out.board.push(chip.note);
    }
    if (p.board?.bios?.date) out.board.push(`BIOS ${p.board.bios.version || ''} de ${p.board.bios.date}`.replace('  ', ' '));
    const memory = p.memory || {};
    for (const module of memory.modules || []) {
      const rated = module.rated && module.configured && module.rated !== module.configured ? `vendido para ${module.rated}${module.cl ? ' CL' + module.cl : ''}, rodando a ${module.configured}` : module.configured ? `rodando a ${module.configured}` : null;
      out.memory.push([module.slot, [module.maker, module.part].filter(Boolean).join(' '), gbText(module.capacityBytes), rated].filter(Boolean).join(' · '));
    }
    if (memory.slots) {
      const free = memory.freeSlots === null ? '' : `, ${memory.freeSlots} ${memory.freeSlots === 1 ? 'livre' : 'livres'}`;
      const most = memory.maxBytes ? '; aceita até ' + gbText(memory.maxBytes) : '';
      out.memory.push(`${memory.slots} slots${free}${most}`);
    }
    for (const gpu of (p.gpus || []).filter((item) => item.discrete)) {
      if (gpu.features?.length) out.gpu.push(`${gpu.name}: ${gpu.features.join(', ')}`);
      if (gpu.rebarCapable) out.gpu.push('aceita Resizable BAR (a placa-mãe precisa estar com ele ligado na BIOS)');
      if (gpu.link?.maxWidth) out.gpu.push(`a placa usa até PCIe ${gpu.link.maxGen || '?'}.0 x${gpu.link.maxWidth}`);
      if (gpu.driver?.date) out.gpu.push(`driver ${gpu.driver.version || ''} de ${gpu.driver.date}`.replace('  ', ' '));
    }
    for (const display of p.displays || []) if (display.output) out.gpu.push(`${display.name || 'monitor'}: ligado por ${display.output}${display.onIntegrated ? ' no vídeo integrado' : ''}`);
    for (const disk of p.disks || []) {
      const bits = [disk.link?.maxGen ? `PCIe ${disk.link.gen || '?'}.0 x${disk.link.width || '?'} (aceita ${disk.link.maxGen}.0 x${disk.link.maxWidth || '?'})` : null, disk.health && !/healthy/i.test(disk.health) ? `estado: ${disk.health}` : null, Number.isFinite(disk.wear) ? `desgaste ${disk.wear}%` : null, Number.isFinite(disk.powerOnHours) ? `${Math.round(disk.powerOnHours / 24)} dias ligado` : null].filter(Boolean);
      if (bits.length) out.disk.push(`${disk.model || disk.label}: ${bits.join(' · ')}`);
    }
    for (const controller of p.nvmeControllers || []) if (controller.link?.maxGen) out.disk.push(`${controller.name}: PCIe ${controller.link.gen || '?'}.0 x${controller.link.width || '?'} (aceita ${controller.link.maxGen}.0 x${controller.link.maxWidth || '?'})`);
    for (const adapter of (p.network || []).filter((item) => item.up && item.wifi)) out.network.push(`Wi-Fi ${adapter.wifi.standard || ''} em ${adapter.wifi.band === 2.4 ? '2,4' : adapter.wifi.band || '?'} GHz, sinal ${adapter.wifi.signal ?? '?'}%`.replace('  ', ' '));
    if (p.battery?.designWh) out.windows.push(`bateria: ${Math.round(p.battery.fullWh || 0)} de ${Math.round(p.battery.designWh)} Wh (${p.battery.wear ?? '?'}% de desgaste)`);
    else if (Number.isFinite(p.battery?.wear)) out.windows.push(`bateria com ${p.battery.wear}% de desgaste`);
    return out;
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
    const systemName = p.os?.platform === 'linux' ? 'o sistema' : 'o Windows';
    for (const disk of p.disks || []) lines.push({ node: 'disk', text: diskLine(disk, systemName) });
    for (const adapter of (p.network || []).filter((item) => item.up)) {
      const speed = adapter.linkMbps >= 1000 ? `${(adapter.linkMbps / 1000).toLocaleString('pt-BR')} Gb/s` : `${adapter.linkMbps} Mb/s`;
      lines.push({ node: 'network', text: [adapter.description || adapter.name, adapter.linkMbps ? speed : null].filter(Boolean).join(' · ') });
    }
    return lines;
  }

  return { decodeCpu, decodeChipset, decodeMemory, decodeGpu, decodeDisplay, decodeDisk, decodeNetwork, decodeSystem, decodeOs, decodeLink, identify, factLines, traits, cpuTitle, UPGRADE, ratedFromPart, channelOf, cleanName, ageDays, maker, CHIPSETS, MEM_TYPES, LAYOUT_TEXT, gbText, cpuLine, memoryLine, boardLine, gpuLine, displayLine, diskLine, shortNames };
});
