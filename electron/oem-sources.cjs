/*
 * Drivers do fabricante do PC/placa-mãe: a lista de fontes e o formato de cada catálogo oficial.
 *  - A lista (docs/drivers/fontes.json no GitHub, com cópia no app) só escolhe entre os tipos e domínios que o app já
 *    conhece (src/oem.js): uma lista adulterada não consegue apontar para outro site nem trocar assinantes.
 *  - Cada formato vira a mesma coisa: Package { id, source, title, category, version, driverVersion?, date, url,
 *    fileName, size?, md5?|sha256?, hardwareIds, kind, signers, bios? }.
 *  - Tudo o que vem da internet é dado não confiável: link só https e só do domínio do tipo; nome de arquivo limpo.
 */
'use strict';
const X = require('./xml-lite.cjs');
const Oem = require('../src/oem.js');

const REMOTE_LIST = 'https://raw.githubusercontent.com/Samuklvm/Project-Nexo/main/docs/drivers/fontes.json';
// Fonte que o app conhece → o único tipo que ela pode ter (ou 'site-only', para desligar o download dela).
const KNOWN = Object.freeze({ dell: 'dell-catalog', hp: 'hpia-ref', lenovo: 'lenovo-catalog', asus: 'asus-api', msi: 'site-only', gigabyte: 'site-only', asrock: 'site-only', acer: 'site-only' });
const URL_FIELD = Object.freeze({ 'dell-catalog': 'index', 'hpia-ref': 'base', 'lenovo-catalog': 'base', 'asus-api': 'url' });

function official(value, domains) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && domains.some((d) => host === d || host.endsWith(`.${d}`)) ? url.href : null;
  } catch { return null; }
}
const text = (value, max = 120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/** A lista de fontes validada (ou null se nada servir). */
function parseSourceList(raw) {
  let json = raw;
  if (typeof raw === 'string') { try { json = JSON.parse(raw); } catch { return null; } }
  if (!json || typeof json !== 'object' || !json.sources || typeof json.sources !== 'object' || Array.isArray(json.sources)) return null;
  const sources = {};
  for (const [id, entry] of Object.entries(json.sources)) {
    if (!Object.prototype.hasOwnProperty.call(KNOWN, id) || !entry || typeof entry !== 'object') continue;
    const type = String(entry.type || '');
    if (type === 'site-only') { sources[id] = { type }; continue; }
    if (type !== KNOWN[id]) continue;
    const field = URL_FIELD[type];
    const url = official(entry[field], Oem.DOMAINS[type]);
    if (url) sources[id] = { type, [field]: url };
  }
  const disabled = (Array.isArray(json.disabled) ? json.disabled : []).filter((id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(sources, id));
  const version = Number.isInteger(json.version) && json.version > 0 ? json.version : 1;
  return Object.keys(sources).length ? { version, sources, disabled } : null;
}

/* ---------------- Peças de montagem comuns ---------------- */
const KINDS = { exe: 'exe', msi: 'msi', zip: 'zip', cab: 'cab' };
/** Nome de arquivo seguro a partir do fim da URL (extensão em minúsculas, só letras, números, ponto, _ e -). */
function fileNameOf(url) {
  let base = '';
  try { base = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { base = ''; }
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (!KINDS[ext]) return null;
  const stem = base.slice(0, dot).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 100);
  return stem ? { fileName: `${stem}.${ext}`, kind: KINDS[ext] } : null;
}
const isoDay = (value) => {
  const v = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};
const driverVersionOf = (value) => (/^\d{1,9}(\.\d{1,9}){1,3}$/.test(String(value || '').trim()) ? String(value).trim() : null);
const hex4 = (value) => (/^[0-9A-Fa-f]{4}$/.test(String(value || '')) ? String(value).toUpperCase() : null);
const displayOf = (node) => text(X.textOf(X.kid(node, 'Name') || node, 'Display'), 120);

/* ---------------- Dell (Dell Command Update) ---------------- */
const DELL_BASE = 'https://downloads.dell.com/';
function dellUrl(pathValue) {
  const p = String(pathValue || '').trim();
  if (!p || p.startsWith('/') || p.includes(':') || p.includes('..') || p.includes('\\')) return null;
  return official(DELL_BASE + p.split('/').map((part) => encodeURIComponent(part)).join('/'), Oem.DOMAINS['dell-catalog']);
}

/** O link do catálogo do modelo (pelo SKU) dentro do índice do Dell Command Update. */
function parseDellIndex(xml, sku) {
  const want = String(sku || '').toUpperCase();
  const root = X.parseXml(xml);
  for (const group of X.walk(root, 'GroupManifest')) {
    if (!X.walk(group, 'Model').some((model) => String(model.attrs.systemID || '').toUpperCase() === want)) continue;
    return dellUrl(X.kid(group, 'ManifestInformation')?.attrs.path);
  }
  return null;
}

/** Os pacotes do catálogo de um modelo Dell (drivers e BIOS/firmware; apps e o resto ficam de fora). */
function parseDellCatalog(xml) {
  const root = X.parseXml(xml);
  const out = [];
  for (const sc of X.walk(root, 'SoftwareComponent')) {
    const type = String(X.kid(sc, 'ComponentType')?.attrs.value || '').toUpperCase();
    if (!['DRVR', 'BIOS', 'FRMW'].includes(type)) continue;
    const url = dellUrl(sc.attrs.path);
    const file = url && fileNameOf(url);
    const id = text(sc.attrs.packageID || sc.attrs.releaseID, 20).replace(/[^A-Za-z0-9]/g, '');
    if (!file || !id) continue;
    const hardwareIds = [];
    for (const device of X.walk(sc, 'Device')) {
      for (const pnp of X.kids(device, 'PnPInfo')) { const v = Oem.normalizeHwid(pnp.attrs.pnpString); if (v) hardwareIds.push(v); }
      for (const pci of X.kids(device, 'PCIInfo')) {
        const ven = hex4(pci.attrs.vendorID);
        const dev = hex4(pci.attrs.deviceID);
        if (!ven || !dev) continue;
        const subDev = hex4(pci.attrs.subDeviceID);
        const subVen = hex4(pci.attrs.subVendorID);
        hardwareIds.push(subDev && subVen && !(subDev === '0000' && subVen === '0000') ? `PCI\\VEN_${ven}&DEV_${dev}&SUBSYS_${subDev}${subVen}` : `PCI\\VEN_${ven}&DEV_${dev}`);
      }
    }
    const md5 = /^[0-9a-f]{32}$/i.test(String(sc.attrs.hashMD5 || '')) ? sc.attrs.hashMD5.toLowerCase() : null;
    const size = Number(sc.attrs.size);
    out.push({
      id: `dell-${id}`, source: 'dell', title: displayOf(sc) || file.fileName, category: text(X.textOf(X.kid(sc, 'Category') || sc, 'Display'), 40),
      version: text(sc.attrs.dellVersion, 20), driverVersion: driverVersionOf(sc.attrs.vendorVersion), date: isoDay(sc.attrs.dateTime || sc.attrs.releaseDate),
      url, fileName: file.fileName, kind: file.kind, ...(Number.isFinite(size) && size > 0 ? { size } : {}), ...(md5 ? { md5 } : {}),
      hardwareIds: [...new Set(hardwareIds)].slice(0, 40), signers: Oem.signersFor('dell'), ...(type === 'DRVR' ? {} : { bios: true })
    });
  }
  return out;
}

module.exports = { REMOTE_LIST, KNOWN, parseSourceList, official, fileNameOf, parseDellIndex, parseDellCatalog };
