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
    // Servidor exato: subdomínio de um servidor oficial não vale (um subdomínio esquecido não vira fonte de driver).
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && domains.includes(host) ? url.href : null;
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
    // Só pacote que serve para Windows de 64 bits (x64): os de 32 bits e de ARM ficam de fora.
    const arches = X.walk(sc, 'OperatingSystem').map((os) => String(os.attrs.osArch || '').toLowerCase()).filter(Boolean);
    if (arches.length && !arches.includes('x64')) continue;
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
      hardwareIds: [...new Set(hardwareIds)].slice(0, 40), signers: Oem.signersFor('dell'), ...(type === 'BIOS' ? { bios: true } : type === 'FRMW' ? { firmware: true } : {})
    });
  }
  return out;
}

/* ---------------- HP (HP Image Assistant: linhas empresariais) ---------------- */
const HP_RELEASES = { 11: [[26200, '25H2'], [26100, '24H2'], [22631, '23H2'], [22621, '22H2'], [22000, '21H2']], 10: [[19045, '22H2'], [19044, '21H2'], [19043, '21H1'], [0, '2009']] };
/** <base><código>/<código>_64_<10|11>.0.<versão>.cab, com a versão do Windows deste PC (ou a mais próxima abaixo). */
function hpRefUrl(base, platform, { build } = {}) {
  const code = String(platform || '').toUpperCase();
  if (!/^[0-9A-F]{4}$/.test(code)) return null;
  const b = Number(build) || 0;
  const os = b >= 22000 ? 11 : 10;
  const release = (HP_RELEASES[os].find(([min]) => b >= min) || HP_RELEASES[os][HP_RELEASES[os].length - 1])[1];
  return official(`${base}${code}/${code}_64_${os}.0.${release}.cab`, Oem.DOMAINS['hpia-ref']);
}
/** O release do Windows deste PC e os dois de baixo (a HP às vezes ainda não publicou o mais novo). */
function hpRefCandidates(base, platform, { build } = {}) {
  const code = String(platform || '').toUpperCase();
  if (!/^[0-9A-F]{4}$/.test(code)) return [];
  const b = Number(build) || 0;
  const os = b >= 22000 ? 11 : 10;
  const list = HP_RELEASES[os];
  const start = Math.max(0, list.findIndex(([min]) => b >= min));
  return list.slice(start, start + 3).map(([, rel]) => official(`${base}${code}/${code}_64_${os}.0.${rel}.cab`, Oem.DOMAINS['hpia-ref'])).filter(Boolean);
}
const sha256Of = (value) => (/^[0-9a-f]{64}$/i.test(String(value || '').trim()) ? String(value).trim().toLowerCase() : null);
/** Os SoftPaqs de driver e de BIOS/firmware do arquivo de referência (software e o resto ficam de fora). */
function parseHpRef(xml) {
  const root = X.parseXml(xml);
  const out = [];
  for (const ui of X.walk(root, 'UpdateInfo')) {
    const category = X.textOf(ui, 'Category');
    const driver = /^driver/i.test(category);
    const bios = /^bios/i.test(category);
    const firmware = /^firmware/i.test(category);
    if (!driver && !bios && !firmware) continue;
    const raw = X.textOf(ui, 'Url');
    const url = official(/^https:\/\//i.test(raw) ? raw : `https://${raw}`, Oem.DOMAINS['hpia-ref']);
    const file = url && fileNameOf(url);
    const id = X.textOf(ui, 'Id').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
    if (!file || !id) continue;
    const version = text(X.textOf(ui, 'Version'), 40);
    const size = Number(X.textOf(ui, 'Size'));
    const sha256 = sha256Of(X.textOf(ui, 'SHA256'));
    const dash = category.indexOf('-');
    out.push({
      id: `hp-${id}`, source: 'hp', title: text(X.textOf(ui, 'Name'), 120) || file.fileName, category: text(dash >= 0 ? category.slice(dash + 1) : category, 40),
      version, driverVersion: driverVersionOf(version.split(' ')[0]), date: isoDay(X.textOf(ui, 'DateReleased')), url, fileName: file.fileName, kind: file.kind,
      ...(Number.isFinite(size) && size > 0 ? { size } : {}), ...(sha256 ? { sha256 } : {}),
      hardwareIds: [...new Set(X.walk(ui, 'DeviceId').map((d) => Oem.normalizeHwid(d.text)).filter(Boolean))].slice(0, 40),
      signers: Oem.signersFor('hp'), ...(bios ? { bios: true } : firmware ? { firmware: true } : {})
    });
  }
  return out;
}

/* ---------------- Lenovo (Lenovo System Update) ---------------- */
function lenovoCatalogUrl(base, type, win11) {
  const t = String(type || '').toUpperCase();
  return /^[0-9A-Z]{4}$/.test(t) ? official(`${base}${t}_${win11 ? 'Win11' : 'Win10'}.xml`, Oem.DOMAINS['lenovo-catalog']) : null;
}
/** Os descritores de pacote do catálogo do tipo de máquina (no máximo 120). */
function parseLenovoCatalog(xml) {
  const root = X.parseXml(xml);
  const out = [];
  for (const pkg of X.walk(root, 'package')) {
    const url = official(X.textOf(pkg, 'location'), Oem.DOMAINS['lenovo-catalog']);
    if (url && /\.xml$/i.test(new URL(url).pathname)) out.push({ url, category: text(X.textOf(pkg, 'category'), 40) });
    if (out.length >= 120) break;
  }
  return out;
}
/** Um descritor de pacote da Lenovo (o instalador fica na mesma pasta do descritor). */
function parseLenovoPackage(xml, descriptorUrl, category = '') {
  const where = official(descriptorUrl, Oem.DOMAINS['lenovo-catalog']);
  if (!where) return null;
  const root = X.parseXml(xml);
  const type = String(X.kid(root, 'PackageType')?.attrs.type || '');
  if (type === '1') return null; // aplicativo, não driver
  const fileNode = X.kid(X.kid(X.kid(root, 'Files'), 'Installer'), 'File');
  const name = X.textOf(fileNode, 'Name');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name)) return null;
  const url = official(new URL(name, where).href, Oem.DOMAINS['lenovo-catalog']);
  const file = url && fileNameOf(url);
  const id = String(root.attrs.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  if (!file || !id) return null;
  const driverVer = X.walk(root, '_Driver').map((d) => driverVersionOf(X.textOf(d, 'Version').replace(/[\^~]+$/, ''))).find(Boolean);
  // Códigos da regra de detecção, menos os que estão dentro de <Not> (esses dizem onde o pacote NÃO serve).
  const found = [];
  const collect = (node) => { for (const child of node.children || []) { if (/^not$/i.test(child.name)) continue; if (/^(_pnpid|hardwareid)$/i.test(child.name)) found.push(child); collect(child); } };
  collect(root);
  const ids = found.map((n) => Oem.normalizeHwid(n.text)).filter(Boolean);
  const size = Number(X.textOf(fileNode, 'Size'));
  const sha256 = sha256Of(X.textOf(fileNode, 'CRC'));
  // Tipo 3 = BIOS; tipo 4 = firmware (Thunderbolt, SSD, dock...): firmware nunca vira o aviso de BIOS.
  const bios = type === '3' || /bios|uefi/i.test(category);
  const firmware = !bios && (type === '4' || /firmware/i.test(category));
  return {
    id: `lenovo-${id}`, source: 'lenovo', title: text((X.walk(root, 'Desc')[0] || {}).text, 120) || file.fileName, category: text(category, 40),
    version: text(root.attrs.version, 40), driverVersion: driverVer || driverVersionOf(root.attrs.version), date: isoDay(X.textOf(root, 'ReleaseDate')),
    url, fileName: file.fileName, kind: file.kind, ...(Number.isFinite(size) && size > 0 ? { size } : {}), ...(sha256 ? { sha256 } : {}),
    hardwareIds: [...new Set(ids)].slice(0, 40), signers: Oem.signersFor('lenovo'), ...(bios ? { bios: true } : firmware ? { firmware: true } : {})
  };
}

/* ---------------- ASUS / ROG ---------------- */
function asusUrl(base, model) {
  const m = text(model, 80);
  if (!m) return null;
  return official(`${base}?${new URLSearchParams({ website: 'global', model: m, cpu: m, osid: '52' })}`, Oem.DOMAINS['asus-api']);
}
/** Os drivers da consulta da ASUS (BIOS/firmware fora; códigos de hardware quando a ASUS manda). */
function parseAsus(json) {
  const out = [];
  for (const group of Array.isArray(json?.Result?.Obj) ? json.Result.Obj : []) {
    const category = text(group?.Name, 40);
    if (!category || /bios|firmware|manual|utilit/i.test(category)) continue;
    for (const f of Array.isArray(group?.Files) ? group.Files : []) {
      const url = official(f?.DownloadUrl?.Global, Oem.DOMAINS['asus-api']);
      const file = url && fileNameOf(url);
      const id = String(f?.Id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
      if (!file || !id) continue;
      const version = text(f?.Version, 40);
      const sha256 = sha256Of(f?.SHA256 || f?.Sha256);
      const ids = (Array.isArray(f?.HardwareInfoList) ? f.HardwareInfoList : []).map((h) => Oem.normalizeHwid(h?.hardwareid || h?.HardwareId)).filter(Boolean);
      out.push({
        id: `asus-${id}`, source: 'asus', title: text(f?.Title, 120) || file.fileName, category, version, driverVersion: driverVersionOf(version.replace(/^v/i, '')),
        date: isoDay(String(f?.ReleaseDate || '').replace(/\//g, '-')), url, fileName: file.fileName, kind: file.kind, ...(sha256 ? { sha256 } : {}),
        hardwareIds: [...new Set(ids)].slice(0, 40), signers: Oem.signersFor('asus')
      });
    }
  }
  return out;
}

/* ---------------- Outras marcas: a página de suporte do modelo exato ---------------- */
function supportUrlFor(id, key, mobile = false) {
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9 ()+._-]{2,80}$/.test(k)) return null;
  if (id === 'msi' && !mobile) {
    // "MAG B550 TOMAHAWK (MS-7C91)" → "MAG-B550-TOMAHAWK" (sem regex com retrocesso: o SonarCloud acusa).
    const cut = k.toUpperCase().indexOf('(MS-');
    const parts = (cut >= 0 ? k.slice(0, cut) : k).split(/[^A-Za-z0-9]/).filter(Boolean);
    const slug = parts.join('-');
    return slug ? `https://www.msi.com/Motherboard/${slug}/support` : null;
  }
  return null;
}

module.exports = { REMOTE_LIST, KNOWN, parseSourceList, official, fileNameOf, parseDellIndex, parseDellCatalog, hpRefUrl, hpRefCandidates, parseHpRef, lenovoCatalogUrl, parseLenovoCatalog, parseLenovoPackage, asusUrl, parseAsus, supportUrlFor };
