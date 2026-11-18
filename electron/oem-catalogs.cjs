/*
 * Drivers do fabricante do PC (projeto 2): busca, confere e lê o catálogo oficial do modelo exato deste PC.
 *  - Quem é o PC sai de src/oem.js (identify); onde buscar sai da lista de fontes (GitHub, com cópia local de reserva).
 *  - Dell e HP mandam o catálogo em .cab: o arquivo só é aberto se a assinatura digital for do próprio fabricante
 *    (igualdade exata do O= do certificado) e só dentro da pasta de catálogos do Nexo.
 *  - Lenovo manda XML e a ASUS, JSON, sempre por HTTPS e só no domínio oficial (conferido também depois de redirecionar).
 *  - Tudo em cache por 6 h (falha: 30 min, para não insistir num site fora do ar). Erro nunca derruba a leitura local.
 */
'use strict';
const path = require('node:path');
const S = require('./oem-sources.cjs');
const Oem = require('../src/oem.js');
const { signatureCoreFor, psQuote } = require('./driver-signature.cjs');
const LOCAL_LIST = require('./drivers-fontes.json');

const TTL = 6 * 3600 * 1000;
const FAIL_TTL = 30 * 60 * 1000;
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_PACKAGES = 400;
const LENOVO_PARALLEL = 6;
const LIST_DOMAINS = ['raw.githubusercontent.com'];
const LIMIT_MS = 90 * 1000; // a busca inteira de um fabricante (a página não espera por ela)

const pathApi = (dir) => (/^[A-Za-z]:\\/.test(String(dir)) ? path.win32 : path.posix);
/** Caminho dentro da pasta de catálogos (nunca a própria pasta, nunca com "..", nunca \\servidor). */
function insideCatalogs(file, dir) {
  if (typeof file !== 'string' || typeof dir !== 'string' || !file || !dir) return false;
  if (file.includes('..') || file.startsWith('\\\\')) return false;
  const P = pathApi(dir);
  const rel = P.relative(P.resolve(dir), P.resolve(file));
  return Boolean(rel) && !rel.startsWith('..') && !P.isAbsolute(rel);
}
/** A linha do expand.exe que abre o .cab (os dois caminhos precisam estar dentro da pasta de catálogos). */
function expandCabScript(cab, outDir, catalogDir) {
  if (!insideCatalogs(cab, catalogDir) || !insideCatalogs(outDir, catalogDir)) throw new Error('Caminho fora da pasta de catálogos.');
  return `& expand.exe -F:* ${psQuote(cab)} ${psQuote(outDir)} | Out-Null`;
}
/** Confere a assinatura do .cab e, só se for de um dos nomes do fabricante, abre na pasta indicada. */
function catalogCabScript(cab, outDir, catalogDir, signers) {
  const { PS_HEAD } = require('./deep-scan.cjs');
  const names = signers.map(psQuote).join(', ');
  return `${PS_HEAD}${signatureCoreFor(psQuote(cab), signers[0])}
$code = -1
if (([string]$sig.status -eq 'Valid') -and (@(${names}) -ccontains $sig.org)) {
  New-Item -ItemType Directory -Force -Path ${psQuote(outDir)} | Out-Null
  ${expandCabScript(cab, outDir, catalogDir)}
  $code = $LASTEXITCODE
}
[Console]::Out.Write((ConvertTo-Json -InputObject @{ status = $sig.status; org = $sig.org; code = $code } -Compress))`;
}

/** Texto de um arquivo baixado: UTF-8 (com ou sem BOM) ou UTF-16 (o catálogo da Dell vem assim). */
function decodeText(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) { const c = Buffer.from(b.subarray(2)); c.swap16(); return c.toString('utf16le'); }
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  return b.toString('utf8');
}

class StageError extends Error {
  constructor(stage, code) { super(`${stage}:${code}`); this.stage = stage; this.code = code; }
}
const fail = (stage, code) => { throw new StageError(stage, code); };

function createOemCatalogs({ fetchBytes, runPowerShellCode, fs, catalogDir, now = () => Date.now(), limitMs = LIMIT_MS } = {}) {
  if (typeof fetchBytes !== 'function' || !fs || !catalogDir) return null;
  const dirOf = () => (typeof catalogDir === 'function' ? catalogDir() : catalogDir);
  let list = null; // { at, ttl, value }
  const cache = new Map(); // 'oem:key' → { at, ttl, value }
  const inflight = new Map(); // 'oem:key' → busca em andamento
  let seq = 0;

  // 404 no arquivo do modelo = o fabricante não publica lista para ele ('not-found'); o resto é falha da fonte.
  async function get(url, domains, stage, timeoutMs = 60000) {
    let buf;
    try { buf = await fetchBytes(url, { maxBytes: MAX_BYTES, domains, timeoutMs }); } catch (error) { fail(stage, error?.status === 404 ? 'not-found' : 'network'); }
    if (!buf || !buf.length) fail(stage, 'empty');
    if (buf.length > MAX_BYTES) fail(stage, 'too-big');
    return buf;
  }
  async function sources() {
    if (list && now() - list.at < list.ttl) return list.value;
    let value = null;
    try { value = S.parseSourceList(decodeText(await fetchBytes(S.REMOTE_LIST, { maxBytes: 256 * 1024, domains: LIST_DOMAINS, timeoutMs: 20000 }))); } catch { value = null; }
    const remote = Boolean(value);
    if (!value) value = S.parseSourceList(LOCAL_LIST);
    list = { at: now(), ttl: remote ? TTL : FAIL_TTL, value };
    return value;
  }
  /** Baixa o .cab, confere quem assinou, abre e devolve o texto do XML de dentro (os arquivos somem logo depois). */
  async function readCab(oem, url, stage) {
    const base = dirOf();
    const P = pathApi(base);
    const id = `${oem}-${now().toString(36)}-${++seq}`;
    const cab = P.join(base, `${id}.cab`);
    const out = P.join(base, id);
    const buf = await get(url, Oem.DOMAINS[S.KNOWN[oem]], stage);
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(cab, buf);
    try {
      let res = null;
      try {
        // O catálogo vale só assinado pelo PRÓPRIO fabricante do PC (nunca Microsoft nem fabricante de peça).
        const body = String((await runPowerShellCode(catalogCabScript(cab, out, base, [...Oem.SIGNERS[oem]]), 120000))?.stdout || '');
        res = JSON.parse(body.slice(Math.max(0, body.indexOf('{'))));
      } catch { fail(stage, 'expand'); }
      if (!(res?.status === 'Valid' && Oem.SIGNERS[oem].includes(res?.org))) fail('signature', 'unsigned');
      if (res.code !== 0) fail(stage, 'expand');
      const xml = (await fs.readdir(out).catch(() => [])).find((name) => /\.xml$/i.test(name));
      if (!xml) fail(stage, 'empty');
      const text = await fs.readFile(P.join(out, xml));
      if (text.length > MAX_BYTES) fail(stage, 'too-big');
      return decodeText(text);
    } finally {
      await fs.rm(cab, { force: true }).catch(() => {});
      await fs.rm(out, { recursive: true, force: true }).catch(() => {});
    }
  }
  const parsed = (stage, fn) => { try { return fn(); } catch { return fail(stage, 'invalid'); } };

  async function fetchPackages(id, source, who, runtimes) {
    const build = Number(runtimes?.os?.build) || 0;
    if (source.type === 'dell-catalog') {
      // O índice da Dell vale para todos os modelos: se sumir, é falha da fonte (não "modelo sem lista").
      const index = await readCab(id, source.index, 'index').catch((error) => (error?.code === 'not-found' ? fail('index', 'network') : Promise.reject(error)));
      const url = parsed('index', () => S.parseDellIndex(index, who.key));
      if (!url) fail('index', 'not-found');
      const catalog = await readCab(id, url, 'catalog');
      return parsed('catalog', () => S.parseDellCatalog(catalog));
    }
    if (source.type === 'hpia-ref') {
      let ref = null;
      for (const url of S.hpRefCandidates(source.base, who.key, { build })) {
        try { ref = await readCab(id, url, 'index'); break; } catch (error) { if (error?.code !== 'not-found') throw error; }
      }
      if (ref === null) fail('index', 'not-found');
      return parsed('catalog', () => S.parseHpRef(ref));
    }
    if (source.type === 'lenovo-catalog') {
      const url = S.lenovoCatalogUrl(source.base, who.key, build >= 22000);
      if (!url) fail('index', 'not-found');
      const raw = decodeText(await get(url, Oem.DOMAINS[source.type], 'index'));
      const entries = parsed('index', () => S.parseLenovoCatalog(raw));
      return lenovoPackages(entries);
    }
    if (source.type === 'asus-api') {
      const url = S.asusUrl(source.url, who.key);
      if (!url) fail('index', 'not-found');
      const raw = decodeText(await get(url, Oem.DOMAINS[source.type], 'index'));
      const json = parsed('index', () => JSON.parse(raw));
      return parsed('catalog', () => S.parseAsus(json));
    }
    return [];
  }
  async function lenovoPackages(entries) {
    const out = [];
    for (let i = 0; i < entries.length; i += LENOVO_PARALLEL) {
      const batch = await Promise.all(entries.slice(i, i + LENOVO_PARALLEL).map(async (entry) => {
        try { return S.parseLenovoPackage(decodeText(await get(entry.url, Oem.DOMAINS['lenovo-catalog'], 'package', 15000)), entry.url, entry.category); } catch { return null; }
      }));
      out.push(...batch.filter(Boolean));
    }
    return out;
  }

  /** A busca inteira de um fabricante: { packages, error?, noList?, disabled?, support? }. */
  async function resolve(who, runtimes) {
    const known = await sources();
    const source = known?.sources?.[who.oem];
    if (!source) return { packages: [] };
    if (known.disabled.includes(who.oem)) return { packages: [], disabled: true };
    if (source.type === 'site-only') {
      const support = S.supportUrlFor(who.oem, who.key, runtimes?.board?.mobile === true);
      return { packages: [], ...(support ? { support } : {}) };
    }
    try {
      return { packages: await fetchPackages(who.oem, source, who, runtimes) };
    } catch (error) {
      if (error instanceof StageError && error.code === 'not-found') return { packages: [], noList: true };
      return { packages: [], error: { source: who.oem, stage: error instanceof StageError ? error.stage : 'index', code: error instanceof StageError ? error.code : 'error' } };
    }
  }
  /** Começa a busca em segundo plano (uma por PC), com tempo máximo; o resultado vai para o cache. */
  function start(cacheKey, who, runtimes) {
    if (inflight.has(cacheKey)) return;
    let timer = null;
    const limit = new Promise((done) => {
      timer = setTimeout(() => done({ packages: [], error: { source: who.oem, stage: 'index', code: 'timeout' } }), limitMs);
    });
    const job = Promise.race([resolve(who, runtimes), limit])
      .catch(() => ({ packages: [], error: { source: who.oem, stage: 'index', code: 'error' } }))
      .then((value) => { clearTimeout(timer); cache.set(cacheKey, { at: now(), ttl: value.error ? FAIL_TTL : TTL, value }); })
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, job);
  }

  /**
   * latest.oem para este PC, na hora (null quando o fabricante não é identificado). Sem nada no cache, devolve
   * { pending: true } e a busca segue em segundo plano; com cache vencido, devolve o antigo e atualiza por trás.
   */
  function lookup({ runtimes, devices }) {
    const who = Oem.identify(runtimes?.board);
    if (!who) return null;
    const head = { oem: who.oem, label: who.label, key: who.key };
    const cacheKey = `${who.oem}:${who.key}`;
    const hit = cache.get(cacheKey);
    if (!hit || now() - hit.at >= hit.ttl) start(cacheKey, who, runtimes);
    if (!hit) return { ...head, at: now(), packages: [], pending: true };
    const { packages: all = [], error, noList, disabled, support } = hit.value;
    const bios = all.filter((p) => p.bios && p.version).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    const packages = Oem.matchPackages(devices, all).map((m) => m.pkg).slice(0, MAX_PACKAGES);
    return {
      ...head, at: hit.at, packages, ...(bios ? { bios: { version: bios.version, date: bios.date || null } } : {}),
      ...(error ? { error } : {}), ...(noList ? { noList: true } : {}), ...(disabled ? { disabled: true } : {}), ...(support ? { support } : {})
    };
  }
  /** Espera as buscas em andamento (testes e o fim da leitura). */
  const settled = () => Promise.all([...inflight.values()]).then(() => undefined);
  return { lookup, settled };
}

module.exports = { createOemCatalogs, expandCabScript, catalogCabScript, insideCatalogs, decodeText, MAX_BYTES };
