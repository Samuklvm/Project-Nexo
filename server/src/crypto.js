/*
 * Criptografia do servidor (Web Crypto, igual no Cloudflare e no Node):
 *  - tokens de sessão assinados com HMAC-SHA256 (SESSION_SECRET);
 *  - dados de sincronização com AES-256-GCM; a chave de cada conta sai de DATA_KEY por HKDF com o uid da conta,
 *    então o banco sozinho não abre nada e uma conta nunca abre a de outra.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function b64url(bytes) {
  let text = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) text += String.fromCharCode(view[i]);
  const b64 = btoa(text).replaceAll('+', '-').replaceAll('/', '_');
  let end = b64.length;
  while (end > 0 && b64[end - 1] === '=') end -= 1; // sem o preenchimento, sem regex no fim do texto
  return b64.slice(0, end);
}
export function fromB64url(text) {
  const normal = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
export const utf8 = (text) => encoder.encode(String(text));
export const fromUtf8 = (bytes) => decoder.decode(bytes);

export function randomId(bytes = 18) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Comparação em tempo constante (para assinaturas). */
export function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function secretBytes(secret, name) {
  const value = String(secret || '');
  if (value.length < 32) throw new Error(`${name} ausente ou curto demais no servidor.`);
  return utf8(value);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', secretBytes(secret, 'SESSION_SECRET'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Token compacto: base64url(payload JSON).base64url(HMAC). */
export async function signToken(payload, secret) {
  const body = b64url(utf8(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(body)));
  return `${body}.${b64url(signature)}`;
}

export async function verifyToken(token, secret, now = Date.now()) {
  const [body, signature, extra] = String(token || '').split('.');
  if (!body || !signature || extra !== undefined || body.length > 2000) return null;
  let expected;
  try { expected = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(body))); } catch { return null; }
  let given;
  try { given = fromB64url(signature); } catch { return null; }
  if (!sameBytes(expected, given)) return null;
  let payload;
  try { payload = JSON.parse(fromUtf8(fromB64url(body))); } catch { return null; }
  if (!payload || typeof payload !== 'object' || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
  return payload;
}

async function accountKey(dataKey, uid) {
  const master = await crypto.subtle.importKey('raw', secretBytes(dataKey, 'DATA_KEY'), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8(`nexo-sync:${uid}`), info: utf8('nexo-sync-v1') }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** "v1.<iv>.<cifra>"; o uid entra como dado autenticado (o texto de uma conta não abre em outra). */
export async function seal(value, { dataKey, uid }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(uid) }, await accountKey(dataKey, uid), utf8(JSON.stringify(value))));
  return `v1.${b64url(iv)}.${b64url(cipher)}`;
}

export async function open(sealed, { dataKey, uid }) {
  const [version, iv, cipher] = String(sealed || '').split('.');
  if (version !== 'v1' || !iv || !cipher) throw new Error('Formato de dados desconhecido.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv), additionalData: utf8(uid) }, await accountKey(dataKey, uid), fromB64url(cipher));
  return JSON.parse(fromUtf8(new Uint8Array(plain)));
}
