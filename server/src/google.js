/*
 * Confere o id_token do login do Google: assinatura RS256 com as chaves públicas do Google, emissor, público (o
 * cliente OAuth do Nexo), validade e e-mail verificado. Sem bibliotecas: só Web Crypto.
 */
import { fromB64url, fromUtf8, utf8 } from './crypto.js';

export const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SKEW_MS = 60 * 1000;
let cache = { keys: null, until: 0 };

export function resetGoogleKeys() { cache = { keys: null, until: 0 }; }

async function googleKeys(fetchImpl, now, force = false) {
  if (!force && cache.keys && cache.until > now) return cache.keys;
  const response = await fetchImpl(GOOGLE_CERTS, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Não consegui buscar as chaves do Google.');
  const body = await response.json();
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1]) || 3600;
  cache = { keys: Array.isArray(body.keys) ? body.keys : [], until: now + Math.min(maxAge, 6 * 3600) * 1000 };
  return cache.keys;
}

function decodePart(part) {
  return JSON.parse(fromUtf8(fromB64url(part)));
}

/**
 * Devolve { sub, email, name } ou lança um erro com `status`.
 * clientIds: os IDs de cliente OAuth aceitos (o do app para computador; vírgula separa vários).
 */
export async function verifyGoogleIdToken(idToken, { clientIds, fetchImpl = fetch, now = Date.now() }) {
  const { parts, header, payload } = parseToken(idToken);
  await checkSignature(parts, header, fetchImpl, now);
  return checkClaims(payload, clientIds, now);
}

const fail = (message) => Object.assign(new Error(message), { status: 401 });
// JSON.parse aceita null, número, texto e lista: tudo isso é token malformado (401), não erro interno (500).
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Separa e lê o cabeçalho e o conteúdo do token; qualquer formato estranho vira 401. */
function parseToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3 || idToken.length > 4096) throw fail('Login inválido.');
  let header;
  let payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw fail('Login inválido.');
  }
  if (!isObject(header) || !isObject(payload)) throw fail('Login inválido.');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 200) throw fail('Login inválido.');
  return { parts, header, payload };
}

/** Confere a assinatura RS256 com a chave pública do Google (busca as chaves de novo se a do token for nova). */
async function checkSignature(parts, header, fetchImpl, now) {
  let keys = await googleKeys(fetchImpl, now);
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    keys = await googleKeys(fetchImpl, now, true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw fail('Login com uma chave que o Google não reconhece.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
  if (!valid) throw fail('Assinatura do login não confere.');
}

/** Confere público (o cliente OAuth do Nexo), emissor, validade, identificador e e-mail verificado. */
function checkClaims(payload, clientIds, now) {
  const allowed = String(clientIds || '').split(',').map((id) => id.trim()).filter(Boolean);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!allowed.length || !audience.some((aud) => allowed.includes(aud))) throw fail('Este login não é do Nexo.');
  if (!ISSUERS.has(payload.iss)) throw fail('Login de um emissor desconhecido.');
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 + SKEW_MS < now) throw fail('O login expirou. Entre de novo.');
  if (Number.isFinite(payload.iat) && payload.iat * 1000 - 5 * SKEW_MS > now) throw fail('Login com data no futuro.');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw fail('Login sem identificador.');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw fail('O e-mail desta conta Google não está verificado.');
  const email = String(payload.email || '').toLowerCase().slice(0, 254);
  if (!/^[^\s@]{1,64}@[^\s@.]{1,63}(?:\.[^\s@.]{1,63}){1,8}$/.test(email)) throw fail('Login sem e-mail.');
  return { sub: payload.sub, email, name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : null };
}
