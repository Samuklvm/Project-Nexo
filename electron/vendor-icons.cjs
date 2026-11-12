/*
 * Ícones oficiais dos fabricantes de drivers (página de Drivers). O Nexo não traz logo de marca nenhuma dentro dele:
 * o ícone vem do site oficial do próprio fabricante (o mesmo que o navegador mostra na aba), uma vez, e fica guardado
 * no PC por 30 dias. Sem internet ou se o site recusar, a página usa o ícone de linha do Nexo.
 *  - Só os domínios oficiais da lista de src/vendors.js (nada vem de texto do PC nem da interface) e só https.
 *  - Procura na página inicial os <link rel="icon"> (o maior e vetorial primeiro), depois apple-touch-icon e favicon.
 *  - O ícone pode estar num subdomínio do fabricante (CDN), nunca em outro domínio, nem depois de redirecionar.
 *  - Só imagem de verdade (assinatura do arquivo conferida; SVG só sem script), até 300 KB; vira data: URL (a página
 *    não faz conexão nenhuma).
 */
'use strict';
const path = require('path');
const fs = require('fs/promises');
const Vendors = require('../src/vendors.js');

const MAX_PAGE = 700 * 1024;
const MAX_ICON = 300 * 1024;
const DAY = 24 * 3600 * 1000;
const TTL = 30 * DAY;
const MISS_TTL = DAY;
const DATA_URL = /^data:image\/(png|x-icon|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Tipo pela assinatura dos bytes (não pelo cabeçalho do servidor). */
function sniff(buf) {
  const b = buf;
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  const head = b.toString('utf8', 0, Math.min(b.length, 600)).trimStart().toLowerCase();
  if ((head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) && !/<script|\bon[a-z]+\s*=|javascript:|<foreignobject/i.test(b.toString('utf8'))) return 'image/svg+xml';
  return null;
}
/** Os <link rel="...icon..."> da página inicial, do melhor para o pior (vetorial e grande primeiro). */
function iconLinks(html, base) {
  const out = [];
  for (const tag of String(html || '').match(/<link\b[^>]*>/gi) || []) {
    const rel = (/\brel\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    if (!/\bicon\b|apple-touch-icon/i.test(rel) || /mask-icon/i.test(rel)) continue;
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    if (!href) continue;
    let url;
    try { url = new URL(href.replace(/&amp;/g, '&'), base); } catch { continue; }
    const sizes = (/\bsizes\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    const px = Math.max(0, ...sizes.split(/\s+/).map((s) => Number.parseInt(s, 10) || 0));
    const svg = /\.svg(\?|$)/i.test(url.pathname) || /image\/svg/i.test(tag);
    const score = (svg ? 400 : 0) + (/apple-touch-icon/i.test(rel) ? 180 : 0) + Math.min(px, 512) - (/\.ico(\?|$)/i.test(url.pathname) ? 50 : 0);
    out.push({ url: url.href, score });
  }
  return out.sort((a, b) => b.score - a.score).map((item) => item.url);
}
/** https, sem usuário/porta, e no domínio oficial (ou num subdomínio dele). */
function allowed(href, domain) {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

/**
 * fetchRaw(url, maxBytes) → { url (final, depois de redirecionar), bytes: Buffer } ou lança.
 */
function createVendorIcons({ dir, fetchRaw, now = () => Date.now() }) {
  const memory = new Map();
  const pending = new Map();
  const file = (key) => path.join(dir, `${key}.json`);
  async function fromDisk(key) {
    try {
      const saved = JSON.parse(await fs.readFile(file(key), 'utf8'));
      // Ícone achado vale 30 dias; "não achei" (talvez sem internet na hora) só um dia.
      if (saved && now() - saved.at < (saved.data ? TTL : MISS_TTL) && (saved.data === null || DATA_URL.test(saved.data))) return saved;
    } catch { /* sem cache */ }
    return null;
  }
  async function fetchIn(url, max, domain) {
    const res = await fetchRaw(url, max);
    if (!res || !allowed(res.url || url, domain)) throw new Error('Fora do site oficial.');
    return Buffer.isBuffer(res.bytes) ? res.bytes : Buffer.from(res.bytes || []);
  }
  async function discover(vendor) {
    const domain = vendor.domain;
    const host = vendor.host || `www.${domain}`;
    const home = `https://${host}/`;
    const candidates = [];
    try { candidates.push(...iconLinks((await fetchIn(home, MAX_PAGE, domain)).toString('utf8'), home)); } catch { /* página inicial fora: tenta os padrões */ }
    candidates.push(`https://${host}/apple-touch-icon.png`, `https://${host}/favicon.ico`, `https://${domain}/apple-touch-icon.png`, `https://${domain}/favicon.ico`);
    for (const url of [...new Set(candidates)].filter((href) => allowed(href, domain)).slice(0, 7)) {
      try {
        const bytes = await fetchIn(url, MAX_ICON, domain);
        const type = sniff(bytes);
        if (type && bytes.length >= 100 && bytes.length <= MAX_ICON) return `data:${type};base64,${bytes.toString('base64')}`;
      } catch { /* próximo */ }
    }
    return null;
  }
  async function get(key) {
    const vendor = Vendors.BY_KEY[key];
    if (!vendor) return null;
    if (memory.has(key)) return memory.get(key);
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      const saved = await fromDisk(key);
      if (saved) { memory.set(key, saved.data); return saved.data; }
      const data = await discover(vendor);
      memory.set(key, data);
      try { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file(key), JSON.stringify({ at: now(), data })); } catch { /* sem cache em disco */ }
      return data;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  }
  /** Ícones de vários fabricantes de uma vez (até 6 buscas ao mesmo tempo); só os achados voltam. */
  async function icons(keys) {
    const list = [...new Set((Array.isArray(keys) ? keys : []).filter((key) => typeof key === 'string' && Vendors.BY_KEY[key]))].slice(0, 80);
    const out = {};
    let next = 0;
    const worker = async () => { while (next < list.length) { const key = list[next]; next += 1; const data = await get(key).catch(() => null); if (data) out[key] = data; } };
    await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
    return out;
  }
  return { icons, get };
}

module.exports = { createVendorIcons, sniff, iconLinks, allowed, MAX_PAGE, MAX_ICON };
