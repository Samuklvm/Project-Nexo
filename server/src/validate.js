/* Validação de tudo o que chega ao servidor: formatos fechados, tamanhos máximos, e nada de dados pessoais nos erros. */

export const RE = {
  deviceId: /^[A-Za-z0-9_-]{8,64}$/,
  installId: /^[A-Za-z0-9_-]{16,64}$/,
  signature: /^[0-9a-f]{16}$/,
  section: /^[a-z][a-z0-9]{1,23}$/,
  version: /^\d{1,3}\.\d{1,3}\.\d{1,4}(-[0-9A-Za-z.-]{1,20})?$/,
  day: /^\d{4}-\d{2}-\d{2}$/
};
export const PLATFORMS = new Set(['win32', 'linux', 'darwin']);
export const SOURCES = new Set(['principal', 'interface', 'ipc', 'servico', 'processo']);
export const LEVELS = new Set(['erro', 'aviso']);
export const STATUSES = new Set(['aberto', 'corrigido', 'ignorado', 'reaberto']);
export const TELEMETRY_KEYS = new Set(['hw', 'usage', 'features', 'lab', 'perf', 'settings', 'app', 'health', 'library', 'sensors', 'system', 'diag', 'feats', 'bottleneck']);

export const LIMITS = {
  body: 1_600_000,       // corpo de qualquer pedido
  snapshot: 1_000_000,   // dados de um PC (antes de criptografar)
  sections: 16,
  deviceName: 80,
  reportsPerPost: 50,
  message: 600,
  stack: 4000,
  context: 1500,
  telemetry: 32768
};

export const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
export const clampInt = (value, min, max, fallback = min) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback);

/** Segunda camada de proteção (o app já limpa antes de enviar): pastas pessoais, e-mails, tokens e chaves. */
const SECRET_NAMES = 'access_token|refresh_token|id_token|token|key|apikey|api_key|secret|client_secret|password|passwd|senha|authorization|cookie|session|sessionid|private_key';
const SECRET_PAIR = new RegExp(String.raw`\b(${SECRET_NAMES})=([^&\s"']+)`, 'gi');
const SECRET_JSON = new RegExp(String.raw`(["'])(${SECRET_NAMES})\1(\s*:\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}\]\s]+)`, 'gi');
export function redact(value) {
  return String(value ?? '')
    // Pasta de usuário do Windows: com o nome seguido de outra pasta (pode ter espaço) ou no fim do texto.
    .replace(/([a-z]:[\\/]+Users[\\/]+)[^\\/"'`:*?<>|\r\n]+(?=[\\/])/gi, '$1<usuário>')
    .replace(/([a-z]:[\\/]+Users[\\/]+)(?!<usuário>)[^\\/\s"'`:*?<>|]+/gi, '$1<usuário>')
    .replace(/(\/(?:home|Users)\/)[^/\s"'`]+/g, '$1<usuário>')
    .replace(SECRET_PAIR, '$1=<oculto>')
    .replace(SECRET_JSON, '$1$2$1$3"<oculto>"')
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)(\s*:\s*)(?:(Bearer|Basic|Digest|Token) )?[^\r\n]*/gi, (_m, name, sep, scheme) => {
      const prefix = scheme ? `${scheme} ` : '';
      return `${name}${sep}${prefix}<oculto>`;
    })
    .replace(/([?&]code=)[^&\s"']+/gi, '$1<oculto>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer <oculto>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '<jwt oculto>')
    .replace(/\b[0-9A-F]{32}\b/g, '<chave oculta>')
    .replace(/\b[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}\b/g, '<e-mail>');
}

/**
 * Compara versões no formato x.y.z[-pré][+build] (SemVer 2.0): núcleo numérico; pré-versão vem antes da final;
 * identificadores da pré-versão comparados um a um (números como números e antes de texto: beta.2 < beta.10 < rc.1).
 * Metadados de build (+...) não contam.
 */
export function compareVersions(a, b) {
  const parse = (value) => {
    const [body] = String(value || '0.0.0').split('+');
    const dash = body.indexOf('-');
    const core = (dash < 0 ? body : body.slice(0, dash)).split('.').map((part) => Number.parseInt(part, 10) || 0);
    const pre = dash < 0 ? [] : body.slice(dash + 1).split('.').filter(Boolean);
    return { core: [core[0] || 0, core[1] || 0, core[2] || 0], pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? 0 : 1) - (y.pre.length ? 0 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    if (i >= x.pre.length) return -1;
    if (i >= y.pre.length) return 1;
    const p = x.pre[i];
    const q = y.pre[i];
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d) return d;
      continue;
    }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Data civil de verdade (AAAA-MM-DD): recusa mês 13, dia 00, 31 de abril, 29/02 fora de ano bissexto. */
export function isCalendarDay(value) {
  if (typeof value !== 'string' || !RE.day.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

/*
 * Telemetria com ESQUEMA FECHADO por categoria: cada campo tem nome e tipo previstos; o que não está aqui é descartado
 * (antes bastava a categoria de topo ser conhecida, e campos como "email" dentro dela passavam).
 * Tipos: 'n' número finito (arredondado a 3 casas e conferido de novo depois da conta), 'b' booleano, 's' texto curto,
 * ['s'] / [esquema] lista curta, { $map: esquema } mapa com chaves de nome fixo do app (slug) e valores do esquema.
 */
const NUM = 'n';
const BOOL = 'b';
const STR = 's';
const MAP_NUM = { $map: NUM };
const SCHEMA = {
  hw: { cpuVendor: STR, cpuModel: STR, cores: NUM, ramGB: NUM, gpuVendor: STR, gpuModels: [STR], gpuVramGB: NUM, osBuild: STR, arch: STR,
    displays: [{ w: NUM, h: NUM, scale: NUM, hz: NUM }], drives: { count: NUM, totalGB: NUM, systemUsedPct: NUM, ssd: NUM, hdd: NUM } },
  usage: { views: MAP_NUM, viewTime: MAP_NUM, ui: MAP_NUM, actions: MAP_NUM },
  features: MAP_NUM,
  app: { launches: NUM, focusMin: NUM, openMin: NUM, startMs: NUM, ageDays: NUM, versionsSeen: NUM, previous: STR },
  feats: { seen: NUM, perView: { $map: { seen: NUM, empty: NUM } }, empty: [STR], crashed: [STR], sources: { $map: { ok: NUM, fail: NUM, ms: NUM } } },
  perf: { cpuFocus: NUM, cpuBack: NUM, memFocusMB: NUM, memMaxMB: NUM, skyFps: NUM, longTasks: NUM, longTaskMs: NUM, gpuCompleto: NUM, gpuLeve: NUM, gpuFundo: NUM },
  health: { minutes: NUM, cpu: NUM, cpuMax: NUM, mem: NUM, memMax: NUM, gpu: NUM, disk: NUM, tempMax: NUM, tempAvg: NUM },
  settings: { effects: STR, liveRate: STR, profile: STR, accent: STR, skyDensity: STR, fireflies: BOOL, twinkle: BOOL, meteors: BOOL, showers: BOOL, cursor: BOOL,
    skyHour: BOOL, wallpaper: BOOL, autoClean: BOOL, reducedMotion: BOOL, pins: NUM },
  library: { installed: NUM, account: NUM, apps: NUM, stores: MAP_NUM },
  lab: { sessions: { saved: NUM, today: NUM, withFps: NUM }, journal: { active: NUM, today: MAP_NUM }, runs: NUM, aborted: MAP_NUM },
  sensors: { status: STR, source: STR, count: NUM, devices: NUM, cpuTemp: BOOL, gpuTemp: BOOL, storageTemp: BOOL },
  system: { locale: STR, electron: STR, channel: STR, autostart: BOOL, tray: BOOL, autoSession: BOOL, onlineCovers: BOOL, uptimeH: NUM },
  diag: { ipc: { $map: { n: NUM, e: NUM, ms: NUM, max: NUM } }, events: MAP_NUM, channels: NUM },
  // O que limitou o PC no dia (minutos com carga) e nas sessões de jogo: classes fixas e números.
  bottleneck: { minutes: NUM, limiter: MAP_NUM, sessions: NUM, sessionLimiter: MAP_NUM,
    gpu: { busyP50: NUM, busyP90: NUM, clockRatioP50: NUM, powerPctP50: NUM, hotShare: NUM, vramPctMax: NUM, engine3dP50: NUM, frameBoundShare: NUM, saturatedShare: NUM },
    cpu: { maxCoreP90: NUM, totalP50: NUM, clockRatioP50: NUM, hotShare: NUM },
    fps: { avg: NUM, p1Low: NUM, refreshHz: NUM, cappedShare: NUM } }
};
/** Chave de mapa: nome fixo do app (tela, recurso, canal, loja). Nada que pareça dado pessoal. */
const MAP_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
const PERSONAL_KEY = /e-?mail|passw|senha|token|secret|segredo|usuario|username|hostname|cookie|session|\bip\b/i;
const MAX_ABS = 1e9;

function cleanBy(schema, value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (schema === NUM) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_ABS) return undefined;
    const rounded = Math.round(value * 1000) / 1000;
    return Number.isFinite(rounded) ? rounded : undefined;
  }
  if (schema === BOOL) return typeof value === 'boolean' ? value : undefined;
  if (schema === STR) return typeof value === 'string' ? redact(value).slice(0, 80) : undefined;
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) return undefined;
    return value.slice(0, 40).map((item) => cleanBy(schema[0], item, depth + 1)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  if (schema.$map) {
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      if (!MAP_KEY.test(key) || PERSONAL_KEY.test(key)) continue;
      const cleaned = cleanBy(schema.$map, item, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  for (const [key, inner] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key)) continue;
    const cleaned = cleanBy(inner, value[key], depth + 1);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

/** Telemetria: só as categorias e os campos do esquema, com tamanho máximo. */
export function cleanTelemetry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out = {};
  for (const [key, schema] of Object.entries(SCHEMA)) {
    if (!Object.hasOwn(data, key)) continue;
    const cleaned = cleanBy(schema, data[key]);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  const json = JSON.stringify(out);
  return json.length <= LIMITS.telemetry ? out : null;
}

export const TELEMETRY_SCHEMA = SCHEMA;
