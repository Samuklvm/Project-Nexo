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
export const TELEMETRY_KEYS = new Set(['hw', 'usage', 'features', 'lab', 'perf', 'settings']);

export const LIMITS = {
  body: 1_600_000,       // corpo de qualquer pedido
  snapshot: 1_000_000,   // dados de um PC (antes de criptografar)
  sections: 16,
  deviceName: 80,
  reportsPerPost: 50,
  message: 600,
  stack: 4000,
  context: 1500,
  telemetry: 8192
};

export const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
export const clampInt = (value, min, max, fallback = min) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback);

/** Segunda camada de proteção (o app já limpa antes de enviar): pastas pessoais, tokens e chaves. */
export function redact(value) {
  return String(value ?? '')
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"'`:*?<>|\r\n]+(?=[\\/])/gi, '$1<usuário>')
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)(?!<usuário>)[^\\/\s"'`:*?<>|]+/gi, '$1<usuário>')
    .replace(/(\/(?:home|Users)\/)[^/\s"'`]+/g, '$1<usuário>')
    .replace(/\b(access_token|refresh_token|id_token|token|key|apikey|api_key|secret|client_secret|password|senha)=([^&\s"']+)/gi, '$1=<oculto>')
    .replace(/([?&]code=)[^&\s"']+/gi, '$1<oculto>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer <oculto>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '<jwt oculto>')
    .replace(/\b[0-9A-F]{32}\b/g, '<chave oculta>');
}

/** Compara versões x.y.z (o sufixo -beta conta como anterior à versão final). */
export function compareVersions(a, b) {
  const parse = (value) => { const [main, pre] = String(value || '0.0.0').split('-'); return [...main.split('.').map((part) => Number(part) || 0), pre ? 0 : 1]; };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 4; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

export function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

/** Telemetria: só as chaves conhecidas, só números, textos curtos e listas pequenas. */
export function cleanTelemetry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const walk = (value, depth) => {
    if (depth > 4) return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return redact(value).slice(0, 80);
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => walk(item, depth + 1)).filter((item) => item !== undefined);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value).slice(0, 60)) {
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(key)) continue;
        const cleaned = walk(item, depth + 1);
        if (cleaned !== undefined) out[key] = cleaned;
      }
      return out;
    }
    return undefined;
  };
  const out = {};
  for (const [key, value] of Object.entries(data)) if (TELEMETRY_KEYS.has(key)) { const cleaned = walk(value, 1); if (cleaned !== undefined) out[key] = cleaned; }
  const json = JSON.stringify(out);
  return json.length <= LIMITS.telemetry ? out : null;
}
