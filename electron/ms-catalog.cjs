/*
 * Drivers, parte 3: o Catálogo do Microsoft Update (catalog.update.microsoft.com) como ÚLTIMO recurso.
 *  - Só para peça SEM driver e SEM fabricante identificável (quem decide é a leitura; aqui só a busca).
 *  - Busca pelo código do dispositivo (VEN&DEV / VID&PID), escolhe o driver mais novo para Windows 10/11 (nunca
 *    firmware, nunca Windows Server) e pega o link do .cab nos servidores de download da Microsoft.
 *  - Não é o Windows Update: nada é instalado sozinho. O .cab vai para o Baixar e a instalação confere o .cat assinado.
 *  - Em segundo plano, com cache de 24 h por peça (falha: 1 h) e no máximo 6 peças por vez.
 */
'use strict';

const SEARCH = 'https://www.catalog.update.microsoft.com/Search.aspx?q=';
const DIALOG = 'https://www.catalog.update.microsoft.com/DownloadDialog.aspx';
const SITE_HOSTS = Object.freeze(['www.catalog.update.microsoft.com']);
const FILE_HOSTS = Object.freeze(['catalog.sf.dl.delivery.mp.microsoft.com', 'catalog.s.download.windowsupdate.com', 'download.windowsupdate.com']);
const TTL = 24 * 3600 * 1000;
const FAIL_TTL = 3600 * 1000;
const LIMIT_MS = 60 * 1000;
const MAX_DEVICES = 6;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Texto de um pedaço de HTML: sem tags, entidades decodificadas, espaços juntados. Uma passada só. */
function textOf(html) {
  let out = '';
  let inTag = false;
  for (let i = 0; i < html.length; i += 1) {
    const c = html[i];
    if (inTag) { if (c === '>') inTag = false; continue; }
    if (c === '<') { inTag = true; out += ' '; continue; }
    out += c;
  }
  out = out.replace(/&(#\d{1,6}|[a-z]{2,6});/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(Number(e.slice(1)) || 32) : ENTITIES[e.toLowerCase()] ?? m));
  return out.split(/\s+/).filter(Boolean).join(' ');
}
const usDate = (value) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value || '').trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};
/** As colunas de cada <td> de uma linha (texto). */
function cells(row) {
  const out = [];
  let at = 0;
  for (;;) {
    const open = row.indexOf('<td', at);
    if (open < 0) break;
    const start = row.indexOf('>', open);
    const close = row.indexOf('</td>', start);
    if (start < 0 || close < 0) break;
    out.push(textOf(row.slice(start + 1, close)));
    at = close + 5;
  }
  return out;
}
/** As linhas de resultado da busca: { id, title, products, classification, date, version, size }. */
function parseSearch(html) {
  const text = String(html || '').slice(0, 3 * 1024 * 1024);
  const out = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf('<tr', at);
    if (open < 0) break;
    const close = text.indexOf('</tr>', open);
    if (close < 0) break;
    const row = text.slice(open, close);
    at = close + 5;
    const head = row.slice(0, row.indexOf('>') + 1);
    const m = /id="([0-9a-f-]{36})_R\d+"/i.exec(head);
    if (!m || !GUID.test(m[1])) continue;
    const c = cells(row);
    if (c.length < 7) continue;
    out.push({ id: m[1].toLowerCase(), title: c[1].slice(0, 160), products: c[2].slice(0, 200), classification: c[3].slice(0, 60), date: usDate(c[4]), version: c[5].slice(0, 40), size: c[6].split(' ').slice(0, 2).join(' ') });
    if (out.length >= 100) break;
  }
  return out;
}
/** O driver mais novo para Windows 10/11 (classificação "Drivers", nunca firmware nem Windows Server). */
function pickRow(rows) {
  const ok = (Array.isArray(rows) ? rows : []).filter((r) => /^drivers\b/i.test(r.classification) && !/firmware/i.test(r.classification)
    && /windows (10|11)/i.test(r.products) && !/server/i.test(r.products) && r.date);
  ok.sort((a, b) => b.date.localeCompare(a.date));
  return ok[0] || null;
}
const official = (value, hosts) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname.toLowerCase()) ? url.href : null;
  } catch { return null; }
};
/** O link do .cab na resposta do diálogo de download. */
function parseDownload(text) {
  const s = String(text || '');
  const key = 'files[0].url';
  const k = s.indexOf(key);
  if (k < 0) return null;
  const q1 = s.indexOf("'", k);
  const q2 = q1 < 0 ? -1 : s.indexOf("'", q1 + 1);
  if (q2 < 0) return null;
  const url = official(s.slice(q1 + 1, q2), FILE_HOSTS);
  return url && /\.cab$/i.test(new URL(url).pathname) ? url : null;
}
/** O código do dispositivo para a busca: BUS\VEN_x&DEV_y (ou VID/PID), sem SUBSYS nem REV. */
function searchTerm(hwids) {
  for (const raw of Array.isArray(hwids) ? hwids : []) {
    const id = String(raw || '').toUpperCase();
    const slash = id.indexOf('\\');
    if (slash < 1) continue;
    const tokens = id.slice(slash + 1).split('&');
    const ven = tokens.find((t) => /^(VEN|VID)_[0-9A-Z]{4}$/.test(t));
    const dev = tokens.find((t) => /^(DEV|PID)_[0-9A-Z]{4}$/.test(t));
    if (ven && dev) return `${id.slice(0, slash)}\\${ven}&${dev}`;
  }
  return null;
}
function dialogBody(id) {
  if (!GUID.test(String(id || ''))) throw new Error('id do catálogo inválido.');
  return `updateIDs=${encodeURIComponent(JSON.stringify([{ size: 0, languages: '', uidInfo: id, updateID: id }]))}`;
}

function createMsCatalog({ fetchText, now = () => Date.now(), limitMs = LIMIT_MS } = {}) {
  const cache = new Map(); // termo → { at, ttl, value: info|null }
  const inflight = new Map();
  async function find(term) {
    const rows = parseSearch(await fetchText(`${SEARCH}${encodeURIComponent(term)}`, { hosts: SITE_HOSTS }));
    const best = pickRow(rows);
    if (!best) return null;
    const url = parseDownload(await fetchText(DIALOG, { method: 'POST', body: dialogBody(best.id), hosts: SITE_HOSTS }));
    return url ? { title: best.title, version: best.version, date: best.date, size: best.size, url } : null;
  }
  function start(term) {
    if (inflight.has(term)) return;
    let timer = null;
    const limit = new Promise((done) => { timer = setTimeout(() => done({ failed: true }), limitMs); });
    const job = Promise.race([find(term).then((info) => ({ info }), () => ({ failed: true })), limit])
      .then((r) => { clearTimeout(timer); cache.set(term, { at: now(), ttl: r.failed ? FAIL_TTL : TTL, value: r.failed ? null : r.info }); })
      .finally(() => inflight.delete(term));
    inflight.set(term, job);
  }
  /** { pending, items: { chave da peça: { title, version, date, size, url } } } para as peças pedidas. */
  function lookup(devices) {
    const items = {};
    let pending = false;
    for (const device of (Array.isArray(devices) ? devices : []).slice(0, MAX_DEVICES)) {
      const term = searchTerm(device?.hwids);
      if (!term || !device.key) continue;
      const hit = cache.get(term);
      if (!hit || now() - hit.at >= hit.ttl) start(term);
      if (!hit) { pending = true; continue; }
      if (hit.value) items[device.key] = hit.value;
    }
    return { pending, items };
  }
  const settled = () => Promise.all([...inflight.values()]).then(() => undefined);
  return { lookup, settled };
}

module.exports = { createMsCatalog, parseSearch, pickRow, parseDownload, searchTerm, dialogBody, FILE_HOSTS, SITE_HOSTS };
