/*
 * Drivers com um clique: o motor de download e a fila de instalação.
 *  - O plano de cada download (URL, domínios, arquivo, assinante, hash) vem do processo principal, montado da própria
 *    leitura dele (src/drivers.js). A tela só manda o id do cartão.
 *  - Fila sem limite, no máximo 4 baixando ao mesmo tempo. Instalação uma de cada vez (dois instaladores juntos brigam).
 *  - Só HTTPS e só domínio oficial em CADA salto de redirecionamento (no máximo 5). Nunca passa de 1,5 GB nem do tamanho
 *    que o servidor anunciou.
 *  - Grava em <arquivo>.<id da URL>.part e só vira o arquivo final depois de conferir o hash (quando a fonte publica) e
 *    a assinatura digital do fabricante esperado. Falhou: apaga.
 *  - Internet caiu: guarda o pedaço e continua de onde parou (Range) na próxima vez, só se for o mesmo arquivo.
 */
'use strict';
const Sig = require('./driver-signature.cjs');

const MAX_BYTES = 1536 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const EMIT_EVERY = 100; // ms: no máximo 10 atualizações de progresso por segundo
const DAY = 24 * 3600 * 1000;
const KEEP_INSTALLED = 14 * DAY;
const KEEP_PART = 7 * DAY;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(exe|msi)$/;
const BUSY = new Set(['queued', 'downloading', 'verifying', 'install-queued', 'installing']);

class DownloadError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}

function official(value, domains) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && domains.some((d) => host === d || host.endsWith(`.${d}`)) ? url.href : null;
  } catch { return null; }
}

function createDriverDownloads({ request, fs, path, crypto, dir, runPowerShell, elevate, emit = () => {}, now = () => Date.now(), max = 4 }) {
  const items = new Map();
  const queue = [];
  let active = 0;
  let installChain = Promise.resolve();
  const INDEX = () => path.join(dir, 'installed.json');

  const snapshot = (item) => {
    const out = { id: item.id, phase: item.phase, received: item.received, total: item.total, speed: item.speed, eta: item.eta };
    if (item.phase === 'queued') out.position = queue.indexOf(item.id) + 1;
    if (item.error) out.error = item.error;
    if (item.signer) out.signer = item.signer;
    if (item.file && (item.phase === 'ready' || item.phase === 'installed' || item.phase === 'install-queued' || item.phase === 'installing')) out.file = item.file;
    return out;
  };
  const send = (item, force = true) => {
    const t = now();
    if (!force && t - item.lastEmit < EMIT_EVERY) return;
    item.lastEmit = t;
    emit('drivers:download', snapshot(item));
  };
  const setPhase = (item, phase, extra = {}) => { Object.assign(item, { phase, ...extra }); send(item); };
  const announceQueue = () => { for (const id of queue) send(items.get(id)); };

  function start(id, plan) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Cartão inválido.');
    if (!plan) throw new Error('Este driver não tem download direto.');
    const domains = Array.isArray(plan.domains) ? plan.domains.map(String) : [];
    if (!SAFE_NAME.test(String(plan.fileName || ''))) throw new Error('Arquivo inválido.');
    if (!official(plan.url, domains)) throw new Error('Link fora do site oficial.');
    if (!Sig.allowedSigner(plan.signer)) throw new Error('Assinante não permitido.');
    const current = items.get(id);
    if (current && (BUSY.has(current.phase) || current.phase === 'ready')) return snapshot(current);
    // Cópia: depois de começar, o motor não depende mais da leitura (nem de quem mandou o plano).
    const frozen = Object.freeze({ url: plan.url, domains: Object.freeze([...domains]), fileName: plan.fileName, signer: plan.signer, sha512: /^[0-9a-f]{128}$/i.test(String(plan.sha512 || '')) ? String(plan.sha512).toLowerCase() : null });
    const item = { id, plan: frozen, phase: 'queued', received: 0, total: null, speed: null, eta: null, error: null, signer: null, file: null, lastEmit: 0, cancel: null, samples: [] };
    items.set(id, item);
    queue.push(id);
    send(item);
    pump();
    return snapshot(item);
  }

  function pump() {
    let moved = false;
    while (active < max && queue.length) {
      const id = queue.shift();
      moved = true;
      run(items.get(id));
    }
    if (moved) announceQueue();
  }

  async function run(item) {
    active += 1;
    try {
      setPhase(item, 'downloading', { error: null });
      await download(item);
      setPhase(item, 'verifying');
      await verify(item);
      setPhase(item, 'ready');
    } catch (error) {
      const code = error instanceof DownloadError ? error.code : 'offline';
      if (code === 'canceled') setPhase(item, 'canceled', { speed: null, eta: null });
      else setPhase(item, 'error', { error: code, speed: null, eta: null });
    } finally {
      item.cancel = null;
      active -= 1;
      pump();
    }
  }

  const partOf = (plan) => path.join(dir, `${plan.fileName}.${crypto.createHash('sha256').update(plan.url).digest('hex').slice(0, 12)}.part`);
  const finalOf = (plan) => path.join(dir, plan.fileName);
  const rm = (file) => fs.rm(file, { force: true }).catch(() => {});

  async function size(file) { try { return (await fs.stat(file)).size; } catch { return 0; } }

  /** O hash do pedaço que já estava no disco (para conferir o arquivo inteiro quando continua de onde parou). */
  async function hashExisting(file, hash, bytes) {
    const fh = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(1024 * 1024);
      let done = 0;
      while (done < bytes) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, bytes - done), done);
        if (!bytesRead) break;
        hash.update(buf.subarray(0, bytesRead));
        done += bytesRead;
      }
    } finally { await fh.close(); }
  }

  async function open(url, offset, item) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!official(current, item.plan.domains)) throw new DownloadError('domain');
      const res = await request(current, { headers: offset ? { Range: `bytes=${offset}-` } : {} });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        res.abort?.();
        let next = null;
        try { next = new URL(String(res.location || ''), current).href; } catch { next = null; }
        if (!next || !official(next, item.plan.domains)) throw new DownloadError('domain');
        current = next;
        continue;
      }
      return res;
    }
    throw new DownloadError('redirects');
  }

  async function download(item) {
    const { plan } = item;
    await fs.mkdir(dir, { recursive: true });
    const part = partOf(plan);
    // Pedaço de outra versão (outra URL para o mesmo arquivo) não serve: apaga.
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (name.startsWith(`${plan.fileName}.`) && name.endsWith('.part') && path.join(dir, name) !== part) await rm(path.join(dir, name));
    }
    let offset = await size(part);
    const keep = { part: false };
    let fh = null;
    try {
      let res;
      try { res = await open(plan.url, offset, item); } catch (error) { if (error instanceof DownloadError) throw error; keep.part = true; throw new DownloadError('offline'); }
      item.cancel = () => res.abort?.();
      if (res.status === 200 && offset) offset = 0; // o servidor ignorou o Range: recomeça do zero
      else if (res.status === 206) {
        const range = /bytes (\d+)-/.exec(String(res.headers['content-range'] || ''));
        if (!range || Number(range[1]) !== offset) offset = 0;
      } else if (res.status !== 200) throw new DownloadError('http');
      const length = Number(res.headers['content-length']);
      const total = Number.isFinite(length) && length >= 0 ? offset + length : null;
      if (total !== null && total > MAX_BYTES) throw new DownloadError('too-big');
      const hash = plan.sha512 ? crypto.createHash('sha512') : null;
      if (hash && offset) await hashExisting(part, hash, offset);
      fh = await fs.open(part, offset ? 'a' : 'w');
      Object.assign(item, { received: offset, total, samples: [[now(), offset]] });
      try {
        for await (const chunk of res.body) {
          if (item.canceled) throw new DownloadError('canceled');
          item.received += chunk.length;
          if (item.received > MAX_BYTES || (total !== null && item.received > total)) throw new DownloadError('too-big');
          try { await fh.write(chunk); } catch (error) { throw new DownloadError('disk', String(error?.code || 'write')); }
          hash?.update(chunk);
          measure(item);
          send(item, false);
        }
      } catch (error) {
        if (item.canceled) throw new DownloadError('canceled');
        if (error instanceof DownloadError) throw error;
        keep.part = true; // a internet caiu: guarda o pedaço para continuar depois
        throw new DownloadError('offline');
      }
      if (item.canceled) throw new DownloadError('canceled');
      await fh.close();
      fh = null;
      if (total !== null && item.received !== total) { keep.part = true; throw new DownloadError('offline'); }
      if (hash && hash.digest('hex') !== plan.sha512) throw new DownloadError('hash');
      const final = finalOf(plan);
      await rm(final);
      await fs.rename(part, final);
      item.file = final;
    } catch (error) {
      if (fh) await fh.close().catch(() => {});
      if (!keep.part) await rm(part);
      throw error;
    }
  }

  function measure(item) {
    const t = now();
    item.samples.push([t, item.received]);
    while (item.samples.length > 2 && t - item.samples[0][0] > 2000) item.samples.shift();
    const [t0, r0] = item.samples[0];
    const seconds = (t - t0) / 1000;
    item.speed = seconds > 0 ? Math.round((item.received - r0) / seconds) : item.speed;
    item.eta = item.speed > 0 && item.total ? Math.max(0, Math.round((item.total - item.received) / item.speed)) : null;
  }

  async function verify(item) {
    let check = { valid: false };
    try { check = Sig.parseSignature((await runPowerShell(Sig.signatureScript(item.file, item.plan.signer), 60000))?.stdout, item.plan.signer); } catch { check = { valid: false }; }
    if (!check.valid) { await rm(item.file); item.file = null; throw new DownloadError('signature'); }
    item.signer = check.signer;
  }

  function cancel(id) {
    const item = items.get(id);
    if (!item) return null;
    const at = queue.indexOf(id);
    if (at >= 0) { queue.splice(at, 1); setPhase(item, 'canceled'); announceQueue(); return snapshot(item); }
    if (item.phase === 'downloading') { item.canceled = true; item.cancel?.(); }
    return snapshot(item);
  }

  async function readIndex() { try { const raw = JSON.parse(await fs.readFile(INDEX(), 'utf8')); return raw && typeof raw === 'object' ? raw : {}; } catch { return {}; } }
  async function writeIndex(index) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(INDEX(), JSON.stringify(index)); }

  function install(id, { restorePoint = true } = {}) {
    const item = items.get(id);
    if (!item || !item.file || (item.phase !== 'ready' && item.phase !== 'installed')) return Promise.reject(new Error('Este driver ainda não foi baixado.'));
    setPhase(item, 'install-queued');
    const job = installChain.then(() => runInstall(item, restorePoint === true));
    installChain = job.catch(() => {});
    return job;
  }

  async function runInstall(item, restorePoint) {
    setPhase(item, 'installing');
    let answer = null;
    try {
      answer = await elevate('driver-install', { file: item.file, dir, signer: item.plan.signer, restorePoint, description: 'Nexo - antes de instalar um driver' });
    } catch (error) {
      setPhase(item, 'ready');
      return { ok: false, restart: false, declined: false, restore: null, note: String(error?.message || 'Não consegui abrir o instalador.').slice(0, 200) };
    }
    const result = answer?.result;
    if (answer?.declined) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: true, restore: null, note: 'Você recusou a permissão de administrador.' }; }
    if (!result) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: false, restore: null, note: 'Não recebi a resposta da instalação.' }; }
    const restore = result.restore || null;
    if (result.signature && result.signature.valid === false) {
      await rm(item.file);
      item.file = null;
      setPhase(item, 'error', { error: 'signature' });
      return { ok: false, restart: false, declined: false, restore: null, note: 'O arquivo não estava mais assinado pelo fabricante, então apaguei por segurança.' };
    }
    if (restore && !restore.ok) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: false, restore, note: `O ponto de restauração não foi criado: ${String(restore.note || 'o Windows não criou').slice(0, 160)}.` }; }
    if (!result.ok) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: false, restore, note: String(result.note || 'O instalador fechou sem terminar.').slice(0, 200) }; }
    const index = await readIndex();
    index[path.basename(item.file)] = now();
    await writeIndex(index).catch(() => {});
    setPhase(item, 'installed');
    return { ok: true, restart: result.code === 3010, declined: false, restore, note: '' };
  }

  /** Apaga instaladores já usados há mais de 14 dias e pedaços parados há mais de 7. */
  async function cleanup() {
    const t = now();
    const index = await readIndex();
    for (const [name, at] of Object.entries(index)) {
      if (!SAFE_NAME.test(name) || !Number.isFinite(at) || t - at > KEEP_INSTALLED) {
        if (SAFE_NAME.test(name)) await rm(path.join(dir, name));
        delete index[name];
      }
    }
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (!name.endsWith('.part')) continue;
      try { if (t - (await fs.stat(path.join(dir, name))).mtimeMs > KEEP_PART) await rm(path.join(dir, name)); } catch { /* já foi */ }
    }
    await writeIndex(index).catch(() => {});
  }

  return {
    start, cancel, install, cleanup,
    list: () => [...items.values()].map(snapshot),
    fileOf: (id) => { const item = items.get(id); return item && item.file ? item.file : null; }
  };
}

module.exports = { createDriverDownloads, MAX_BYTES, MAX_REDIRECTS, official };
