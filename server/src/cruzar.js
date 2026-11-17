/*
 * Cruzamentos livres da telemetria para o Claude (ferramenta nexo_cruzar), por um catálogo FECHADO de campos: nada
 * de SQL vindo de fora, e cada pedido cabe nos 10 ms de CPU do Worker. As faixas e os números do dia moram aqui e o
 * painel (app.js) usa os mesmos.
 */

/** Número de verdade (finito) ou null. */
export const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
/** Fração (0–1) em porcentagem, ou null. */
export const pct = (value) => (num(value) === null ? null : value * 100);
/** Faixa de um valor (em vez de ternários encadeados): a primeira cujo limite é maior que ele. */
export const band = (value, limits) => limits.find(([max]) => value < max)?.[1] ?? limits.at(-1)[1];
export const RAM_BANDS = [[8.5, 'até 8 GB'], [16.5, '9–16 GB'], [32.5, '17–32 GB'], [Infinity, 'mais de 32 GB']];
export const AGE_BANDS = [[1, 'menos de 1 dia'], [7, '1 a 6 dias'], [30, '1 a 4 semanas'], [90, '1 a 3 meses'], [Infinity, 'mais de 3 meses']];
export const SYSTEM_FLAGS = ['autostart', 'tray', 'autoSession', 'onlineCovers'];
export const SKY_FLAGS = ['fireflies', 'twinkle', 'meteors', 'showers', 'cursor', 'skyHour', 'wallpaper', 'autoClean', 'reducedMotion'];

/** Números do dia (mediana e p90 entre os resumos): rótulo do painel, nome para o Claude, valor de um resumo. */
export const DAY_METRICS = [
  ['Minutos com o Nexo em foco', 'minutos_foco', (data) => data.app?.focusMin],
  ['Minutos com o Nexo aberto', 'minutos_aberto', (data) => data.app?.openMin],
  ['Aberturas no dia', 'aberturas', (data) => data.app?.launches],
  ['Tempo de abertura (ms)', 'abertura_ms', (data) => data.app?.startMs],
  ['CPU do Nexo em foco (%)', 'cpu_foco', (data) => data.perf?.cpuFocus],
  ['CPU do Nexo em segundo plano (%)', 'cpu_fundo', (data) => data.perf?.cpuBack],
  ['Memória do Nexo em foco (MB)', 'memoria_foco_mb', (data) => data.perf?.memFocusMB],
  ['Pico de memória do Nexo (MB)', 'memoria_pico_mb', (data) => data.perf?.memMaxMB],
  ['Quadros do céu por segundo', 'fps_ceu', (data) => data.perf?.skyFps],
  ['Travadas da interface no dia', 'travadas', (data) => data.perf?.longTasks],
  ['Vídeo com o Nexo na frente, Completo (%)', 'gpu_completo', (data) => data.perf?.gpuCompleto],
  ['Vídeo com o Nexo na frente, Leve (%)', 'gpu_leve', (data) => data.perf?.gpuLeve],
  ['Vídeo com o Nexo em segundo plano (%)', 'gpu_fundo', (data) => data.perf?.gpuFundo],
  ['Processador do PC, média do dia (%)', 'cpu_pc', (data) => data.health?.cpu],
  ['Memória do PC, média do dia (%)', 'memoria_pc', (data) => data.health?.mem],
  ['Vídeo do PC, média do dia (%)', 'gpu_pc', (data) => data.health?.gpu],
  ['Maior temperatura do dia (°C)', 'temp_max', (data) => data.health?.tempMax],
  // O que limita os PCs: números da GPU e da CPU com carga e das sessões de jogo.
  ['GPU com carga: uso típico (%)', 'gpu_carga_uso', (data) => data.bottleneck?.gpu?.busyP50],
  ['GPU com carga: clock em % do máximo dela', 'gpu_carga_clock', (data) => pct(data.bottleneck?.gpu?.clockRatioP50)],
  ['GPU com carga: energia em % do limite', 'gpu_carga_energia', (data) => data.bottleneck?.gpu?.powerPctP50],
  ['GPU em 95%+ (% do tempo com carga)', 'gpu_saturada', (data) => pct(data.bottleneck?.gpu?.saturatedShare)],
  ['Memória de vídeo, pico do dia (%)', 'vram_pico', (data) => data.bottleneck?.gpu?.vramPctMax],
  ['Núcleo mais ocupado da CPU (p90, %)', 'nucleo_p90', (data) => data.bottleneck?.cpu?.maxCoreP90],
  ['Minutos com carga no dia', 'minutos_carga', (data) => data.bottleneck?.minutes],
  ['FPS médio nas sessões', 'fps_medio', (data) => data.bottleneck?.fps?.avg],
  ['1% baixo nas sessões (FPS)', 'fps_1_baixo', (data) => data.bottleneck?.fps?.p1Low]
];

const firstDisplay = (data) => (Array.isArray(data.hw?.displays) ? data.hw.displays[0] : null) || null;
/** A chave com o maior valor de um objeto de contagens (ex.: minutos por limitador). */
const topKey = (counts) => Object.entries(counts && typeof counts === 'object' ? counts : {}).filter(([, n]) => num(n) !== null).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const yesNo = (value) => (value === true ? 'sim' : 'não');

/** Dimensões: nome → { titulo, ler(row) }, em que row = { version, platform, data }. */
export const CAMPOS = {
  versao: { titulo: 'Versão do Nexo', ler: (row) => row.version },
  sistema: { titulo: 'Sistema (win32, linux)', ler: (row) => row.platform },
  idioma: { titulo: 'Idioma do sistema', ler: (row) => row.data.system?.locale },
  canal: { titulo: 'Como foi instalado (instalador, appimage, deb, dev)', ler: (row) => row.data.system?.channel },
  cpu_marca: { titulo: 'Marca do processador', ler: (row) => row.data.hw?.cpuVendor },
  cpu_modelo: { titulo: 'Modelo do processador', ler: (row) => row.data.hw?.cpuModel },
  gpu_marca: { titulo: 'Marca da placa de vídeo', ler: (row) => row.data.hw?.gpuVendor },
  ram_faixa: { titulo: 'Memória RAM (faixa)', ler: (row) => (num(row.data.hw?.ramGB) === null ? null : band(row.data.hw.ramGB, RAM_BANDS)) },
  threads: { titulo: 'Threads do processador', ler: (row) => row.data.hw?.cores },
  monitores: { titulo: 'Quantos monitores', ler: (row) => (Array.isArray(row.data.hw?.displays) ? row.data.hw.displays.length : null) },
  resolucao: { titulo: 'Resolução do monitor principal', ler: (row) => { const d = firstDisplay(row.data); return d && num(d.w) && num(d.h) ? `${d.w}×${d.h}` : null; } },
  hz: { titulo: 'Taxa de atualização do monitor principal', ler: (row) => { const d = firstDisplay(row.data); return d && num(d.hz) ? `${d.hz} Hz` : null; } },
  escala: { titulo: 'Escala do monitor principal', ler: (row) => { const d = firstDisplay(row.data); return d && num(d.scale) ? `${Math.round(d.scale * 100)}%` : null; } },
  efeitos: { titulo: 'Efeitos visuais (lite = Modo Leve, full = Completo)', ler: (row) => row.data.settings?.effects },
  cor: { titulo: 'Cor de destaque', ler: (row) => row.data.settings?.accent },
  perfil: { titulo: 'Perfil de uso', ler: (row) => row.data.settings?.profile },
  ritmo_leituras: { titulo: 'Velocidade das leituras', ler: (row) => row.data.settings?.liveRate },
  densidade_ceu: { titulo: 'Densidade do céu', ler: (row) => row.data.settings?.skyDensity },
  sensores: { titulo: 'Estado dos sensores', ler: (row) => row.data.sensors?.status },
  idade_instalacao: { titulo: 'Há quanto tempo o Nexo está instalado', ler: (row) => (num(row.data.app?.ageDays) === null ? null : band(row.data.app.ageDays, AGE_BANDS)) },
  limitador: { titulo: 'O que mais limitou o PC com carga', ler: (row) => topKey(row.data.bottleneck?.limiter) },
  limitador_sessoes: { titulo: 'O que mais limitou as sessões de jogo', ler: (row) => topKey(row.data.bottleneck?.sessionLimiter) },
  ...Object.fromEntries(SYSTEM_FLAGS.map((flag) => [`flag:${flag}`, { titulo: `Ajuste do app: ${flag} (sim/não)`, ler: (row) => yesNo(row.data.system?.[flag]) }])),
  ...Object.fromEntries(SKY_FLAGS.map((flag) => [`flag:${flag}`, { titulo: `Céu e aparência: ${flag} (sim/não)`, ler: (row) => yesNo(row.data.settings?.[flag]) }]))
};
/** Medidas: nome → { titulo, ler(data) } (os mesmos números do dia do painel). */
export const MEDIDAS = Object.fromEntries(DAY_METRICS.map(([titulo, nome, ler]) => [nome, { titulo, ler }]));

const MAX_ROWS = 50;
const MAX_COLS = 20;
const NONE = '(sem dado)';
const campo = (name) => {
  if (typeof name !== 'string' || !Object.hasOwn(CAMPOS, name)) throw new Error(`Campo desconhecido: ${String(name).slice(0, 40)}. Campos: ${Object.keys(CAMPOS).join(', ')}.`);
  return CAMPOS[name];
};
const valueOf = (field, row) => { const value = field.ler(row); return value === null || value === undefined || value === '' ? NONE : String(value); };
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Tabela cruzada. Sem medida: conta PCs (o resumo mais recente de cada instalação), por `linha` (e `coluna`). Com
 * medida: mediana e p90 da medida entre todos os resumos do período, por `linha`. `filtro`: { campo: valor }.
 * No máximo 50 linhas e 20 colunas; o que passar soma em `outros`.
 */
export function crossTab(rows, { linha, coluna, medida, filtro } = {}) {
  const rowField = campo(linha);
  const colField = coluna ? campo(coluna) : null;
  const measure = medida ? MEDIDAS[medida] : null;
  if (medida && (typeof medida !== 'string' || !Object.hasOwn(MEDIDAS, medida))) throw new Error(`Medida desconhecida: ${String(medida).slice(0, 40)}. Medidas: ${Object.keys(MEDIDAS).join(', ')}.`);
  const filters = Object.entries(filtro && typeof filtro === 'object' && !Array.isArray(filtro) ? filtro : {}).map(([name, value]) => [campo(name), String(value)]);
  const parsed = rows.map((row) => {
    let data = {};
    try { data = typeof row.data === 'string' ? JSON.parse(row.data) || {} : row.data || {}; } catch { data = {}; }
    return { ...row, data };
  }).filter((row) => filters.every(([field, value]) => valueOf(field, row) === value));

  if (measure) {
    const groups = new Map();
    for (const row of parsed) {
      const value = num(measure.ler(row.data));
      if (value === null) continue;
      const key = valueOf(rowField, row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(value);
    }
    const list = [...groups].map(([l, values]) => { const sorted = values.sort((a, b) => a - b); return { l, mediana: round1(percentile(sorted, 0.5)), p90: round1(percentile(sorted, 0.9)), n: sorted.length }; }).sort((a, b) => b.n - a.n);
    return { linha, medida, grupos: list.slice(0, MAX_ROWS), outros: list.slice(MAX_ROWS).reduce((sum, item) => sum + item.n, 0) };
  }

  const latest = new Map();
  for (const row of parsed) { const previous = latest.get(row.install_id); if (!previous || previous.day <= row.day) latest.set(row.install_id, row); }
  const pcs = [...latest.values()];
  if (!colField) {
    const counts = new Map();
    for (const row of pcs) { const key = valueOf(rowField, row); counts.set(key, (counts.get(key) || 0) + 1); }
    const list = [...counts].map(([l, n]) => ({ l, n })).sort((a, b) => b.n - a.n);
    return { linha, total: pcs.length, grupos: list.slice(0, MAX_ROWS), outros: list.slice(MAX_ROWS).reduce((sum, item) => sum + item.n, 0) };
  }
  const rowTotals = new Map();
  const colTotals = new Map();
  const cells = new Map();
  for (const row of pcs) {
    const l = valueOf(rowField, row);
    const c = valueOf(colField, row);
    rowTotals.set(l, (rowTotals.get(l) || 0) + 1);
    colTotals.set(c, (colTotals.get(c) || 0) + 1);
    const key = JSON.stringify([l, c]);
    cells.set(key, (cells.get(key) || 0) + 1);
  }
  const keepRows = new Set([...rowTotals].sort((a, b) => b[1] - a[1]).slice(0, MAX_ROWS).map(([l]) => l));
  const keepCols = new Set([...colTotals].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLS).map(([c]) => c));
  const celulas = [];
  let outros = 0;
  for (const [key, n] of cells) {
    const [l, c] = JSON.parse(key);
    if (keepRows.has(l) && keepCols.has(c)) celulas.push({ l, c, n }); else outros += n;
  }
  celulas.sort((a, b) => b.n - a.n);
  return { linha, coluna, total: pcs.length, celulas, outros };
}
