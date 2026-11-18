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
const IDLE_MS = 60000; // sem nenhum pedaço em 60 s: a conexão travou (libera a vaga e guarda o pedaço)
const EMIT_EVERY = 100; // ms: no máximo 10 atualizações de progresso por segundo
const DAY = 24 * 3600 * 1000;
const KEEP_INSTALLED = 14 * DAY;
const KEEP_PART = 7 * DAY;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(exe|msi|zip|cab)$/;
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

/** O hash mais forte que a fonte mandou (MD5 só vale no catálogo da Dell, que só traz ele). */
function hashOf(plan) {
  const hex = (value, len) => (new RegExp(`^[0-9a-f]{${len}}$`, 'i').test(String(value || '')) ? String(value).toLowerCase() : null);
  if (hex(plan.sha512, 128)) return Object.freeze({ alg: 'sha512', hex: hex(plan.sha512, 128) });
  if (hex(plan.sha256, 64)) return Object.freeze({ alg: 'sha256', hex: hex(plan.sha256, 64) });
  if (plan.source === 'dell' && hex(plan.md5, 32)) return Object.freeze({ alg: 'md5', hex: hex(plan.md5, 32) });
  return null;
}
const ARCHIVES = new Set(['zip', 'cab']);

function createDriverDownloads({ request, fs, path, crypto, dir, runPowerShell, elevate, emit = () => {}, now = () => Date.now(), max = 4, idleMs = IDLE_MS }) {
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
    if (item.phase === 'installing') out.quiet = item.quiet === true;
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

  const Silent = require('./silent-install.cjs');
  const silentOf = (plan) => {
    if (plan.silent === undefined || plan.silent === null || plan.silent === false) return null;
    if (!Silent.isName(plan.silent)) throw new Error('Modo silencioso desconhecido.');
    return plan.silent;
  };
  /** Depois de pronto: instala sozinho quando o pedido veio do "Baixar e instalar", e avisa a tela do resultado. */
  function autoInstall(item) {
    if (!item.auto) return;
    const opts = item.auto;
    item.auto = null;
    install(item.id, opts).then((result) => emit('drivers:auto-installed', { id: item.id, result }), (error) => emit('drivers:auto-installed', { id: item.id, result: { ok: false, note: String(error?.message || 'Não consegui instalar.').slice(0, 200) } }));
  }

  function start(id, plan, { auto = null } = {}) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Cartão inválido.');
    if (!plan) throw new Error('Este driver não tem download direto.');
    const domains = Array.isArray(plan.domains) ? plan.domains.map(String) : [];
    if (!SAFE_NAME.test(String(plan.fileName || ''))) throw new Error('Arquivo inválido.');
    if (!official(plan.url, domains)) throw new Error('Link fora do site oficial.');
    const signers = Array.isArray(plan.signers) ? plan.signers : [plan.signer];
    if (!Sig.allowedSigner(signers)) throw new Error('Assinante não permitido.');
    const ext = String(plan.fileName).split('.').pop().toLowerCase();
    const kind = plan.kind === undefined ? ext : plan.kind;
    if (kind !== ext) throw new Error('O tipo do arquivo não confere.');
    const current = items.get(id);
    if (current && (BUSY.has(current.phase) || current.phase === 'ready')) return snapshot(current);
    for (const other of items.values()) {
      if (other.id !== id && other.plan.fileName === plan.fileName && (other.phase === 'queued' || other.phase === 'downloading' || other.phase === 'verifying')) throw new Error('Esse mesmo arquivo já está sendo baixado em outro cartão.');
    }
    // Cópia: depois de começar, o motor não depende mais da leitura (nem de quem mandou o plano).
    const frozen = Object.freeze({ url: plan.url, domains: Object.freeze([...domains]), fileName: plan.fileName, signers: Object.freeze([...signers]), kind, hash: hashOf(plan), silent: silentOf(plan) });
    const item = { id, plan: frozen, phase: 'queued', received: 0, total: null, speed: null, eta: null, error: null, signer: null, file: null, sha256: null, lastEmit: 0, cancel: null, samples: [], auto: auto ? { restorePoint: auto.restorePoint === true, window: auto.window === true } : null };
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
      void run(items.get(id)); // run trata os próprios erros (try/catch)
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
      autoInstall(item);
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

  /**
   * O hash que a fonte mandou (quando mandou) e sempre o SHA-256 do que chegou: a tarefa de administrador confere a cópia
   * contra ele, então trocar o arquivo na pasta entre o download e a instalação não adianta.
   */
  function digests(plan) {
    const own = crypto.createHash('sha256');
    const theirs = plan.hash ? crypto.createHash(plan.hash.alg) : null;
    return {
      update(chunk) { own.update(chunk); theirs?.update(chunk); },
      check(item) {
        if (theirs && theirs.digest('hex') !== plan.hash.hex) throw new DownloadError('hash');
        item.sha256 = own.digest('hex');
      }
    };
  }
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

  const canceled = () => new DownloadError('canceled');
  /** Erro local de arquivo: sem espaço vira 'disk'; o resto (permissão, arquivo em uso) vira 'file'. Nunca "Sem internet". */
  const fileError = (error) => (error instanceof DownloadError ? error : new DownloadError(error?.code === 'ENOSPC' || error?.code === 'EDQUOT' ? 'disk' : 'file', String(error?.code || 'fs')));
  const metaOf = (part) => `${part}.json`;
  async function readMeta(part) { try { const raw = JSON.parse(await fs.readFile(metaOf(part), 'utf8')); return typeof raw?.validator === 'string' && raw.validator.length <= 200 ? raw.validator : null; } catch { return null; } }

  /** Pede a URL seguindo no máximo 5 redirecionamentos, todos no domínio oficial. Cancelar enquanto espera também vale. */
  async function open(url, headers, item) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!official(current, item.plan.domains)) throw new DownloadError('domain');
      let res;
      try { res = await request(current, { headers }); } catch { if (item.canceled) throw canceled(); throw new DownloadError('offline'); }
      if (item.canceled) { res.abort?.(); throw canceled(); }
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
    try { await fs.mkdir(dir, { recursive: true }); } catch (error) { throw fileError(error); }
    const part = partOf(plan);
    // Pedaço de outra versão (outra URL para o mesmo arquivo) não serve: apaga.
    for (const name of await fs.readdir(dir).catch(() => [])) {
      const full = path.join(dir, name);
      if (name.startsWith(`${plan.fileName}.`) && (name.endsWith('.part') || name.endsWith('.part.json')) && full !== part && full !== metaOf(part)) await rm(full);
    }
    // Só continua de onde parou se souber que o arquivo do servidor é o mesmo (ETag/Last-Modified + If-Range): o link
    // fixo da Microsoft (aka.ms/vc14) troca de conteúdo a cada versão nova, e emendar dois arquivos não pode.
    let offset = await size(part);
    const validator = offset ? await readMeta(part) : null;
    if (offset && !validator) { await rm(part); offset = 0; }
    const keep = { part: false };
    let fh = null;
    let res = null;
    try {
      res = await open(plan.url, offset ? { Range: `bytes=${offset}-`, 'If-Range': validator } : {}, item);
      item.cancel = () => res.abort?.();
      if (res.status === 416 && offset) {
        // O pedaço já tinha tudo (o app fechou entre a última gravação e o nome final): confere como está.
        res.abort?.();
        Object.assign(item, { received: offset, total: offset });
        const hashes = digests(plan);
        await hashExisting(part, hashes, offset);
        hashes.check(item);
        await finish(item, part);
        return;
      }
      if (res.status === 206) {
        const range = /bytes (\d+)-/.exec(String(res.headers['content-range'] || ''));
        if (!range || Number(range[1]) !== offset) {
          // Veio outro pedaço que o pedido: recomeça do zero, sem Range.
          res.abort?.();
          offset = 0;
          res = await open(plan.url, {}, item);
          item.cancel = () => res.abort?.();
          if (res.status !== 200) throw new DownloadError('http');
        }
      } else if (res.status === 200) {
        offset = 0; // começo do zero (ou o servidor ignorou o Range / o arquivo mudou)
      } else throw new DownloadError('http');
      const length = Number(res.headers['content-length']);
      const total = Number.isFinite(length) && length >= 0 && res.headers['content-length'] !== undefined ? offset + length : null;
      if (total !== null && total > MAX_BYTES) throw new DownloadError('too-big');
      const hash = digests(plan);
      try {
        if (offset) await hashExisting(part, hash, offset);
        fh = await fs.open(part, offset ? 'a' : 'w');
        const tag = String(res.headers.etag || res.headers['last-modified'] || '').slice(0, 200);
        if (!offset) { if (tag) await fs.writeFile(metaOf(part), JSON.stringify({ validator: tag })); else await rm(metaOf(part)); }
      } catch (error) { throw fileError(error); }
      Object.assign(item, { received: offset, total, samples: [[now(), offset]] });
      try {
        for await (const chunk of idle(res.body, idleMs, () => res.abort?.())) {
          if (item.canceled) throw canceled();
          item.received += chunk.length;
          if (item.received > MAX_BYTES || (total !== null && item.received > total)) throw new DownloadError('too-big');
          try { await fh.write(chunk); } catch (error) { throw fileError(error); }
          hash.update(chunk);
          measure(item);
          send(item, false);
        }
      } catch (error) {
        if (item.canceled) throw canceled();
        if (error instanceof DownloadError && error.code !== 'offline') throw error;
        keep.part = true; // a internet caiu ou travou: guarda o pedaço para continuar depois
        throw new DownloadError('offline');
      }
      if (item.canceled) throw canceled();
      try { await fh.close(); } catch (error) { throw fileError(error); }
      fh = null;
      if (total !== null && item.received !== total) { keep.part = true; throw new DownloadError('offline'); }
      hash.check(item);
      await finish(item, part);
    } catch (error) {
      res?.abort?.();
      if (fh) await fh.close().catch(() => {});
      // Sem a identificação do arquivo não dá para continuar depois: não adianta guardar o pedaço.
      const canResume = keep.part && (await fs.readFile(metaOf(part), 'utf8').then(() => true, () => false));
      if (!canResume) { await rm(part); await rm(metaOf(part)); }
      throw error;
    }
  }

  async function finish(item, part) {
    const final = finalOf(item.plan);
    try {
      await rm(final);
      await fs.rename(part, final);
    } catch (error) { throw fileError(error); }
    await rm(metaOf(part));
    item.file = final;
  }

  /** Repassa os pedaços, mas desiste (e fecha a resposta) se nenhum chegar em `ms`. */
  async function* idle(body, ms, abort) {
    const it = body[Symbol.asyncIterator]();
    for (;;) {
      let timer = null;
      const stall = new Promise((_, reject) => { timer = setTimeout(() => { abort(); reject(new DownloadError('offline')); }, ms); });
      let next;
      try { next = await Promise.race([it.next(), stall]); } finally { clearTimeout(timer); }
      if (next.done) return;
      yield next.value;
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
    // Pacote .zip/.cab não tem assinatura própria: vale o hash, e o instalador (ou o .cat) de dentro é conferido na
    // tarefa de administrador, antes de rodar.
    if (ARCHIVES.has(item.plan.kind)) return;
    let check = { valid: false };
    try { check = Sig.parseSignature((await runPowerShell(Sig.signatureScript(item.file, item.plan.signers), 60000))?.stdout, item.plan.signers); } catch { check = { valid: false }; }
    if (!check.valid) { await rm(item.file); item.file = null; throw new DownloadError('signature'); }
    item.signer = check.signer;
  }

  function cancel(id) {
    const item = items.get(id);
    if (!item) return null;
    const at = queue.indexOf(id);
    if (at >= 0) { queue.splice(at, 1); setPhase(item, 'canceled'); announceQueue(); return snapshot(item); }
    if (item.external && (item.phase === 'site' || item.phase === 'downloading')) {
      const close = item.cancel;
      item.cancel = null;
      try { close?.(); } catch { /* janela já fechou */ }
      setPhase(item, 'canceled', { speed: null, eta: null });
      return snapshot(item);
    }
    if (item.phase === 'downloading') { item.canceled = true; item.cancel?.(); }
    return snapshot(item);
  }

  /*
   * Download feito pela página da AMD (o servidor dela só libera o que começa no amd.com): o processo principal abre a
   * página, o Electron baixa, e o motor recebe o arquivo pronto. Daí para a frente é igual: assinatura, hash, instalar.
   */
  function external(id, plan, { auto = null, cancel: close = null } = {}) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Cartão inválido.');
    const signers = Array.isArray(plan?.signers) ? plan.signers : [];
    if (!Sig.allowedSigner(signers)) throw new Error('Assinante não permitido.');
    const current = items.get(id);
    if (current && (BUSY.has(current.phase) || current.phase === 'site')) return snapshot(current);
    const frozen = Object.freeze({ url: null, domains: Object.freeze(['drivers.amd.com']), fileName: null, signers: Object.freeze([...signers]), kind: 'exe', hash: null, silent: silentOf(plan || {}) });
    const item = { id, external: true, plan: frozen, phase: 'site', received: 0, total: null, speed: null, eta: null, error: null, signer: null, file: null, sha256: null, lastEmit: 0, cancel: close, samples: [], auto: auto ? { restorePoint: auto.restorePoint === true, window: auto.window === true } : null };
    items.set(id, item);
    send(item);
    return snapshot(item);
  }
  function progress(id, received, total) {
    const item = items.get(id);
    if (!item?.external || (item.phase !== 'site' && item.phase !== 'downloading')) return;
    item.received = Math.max(0, Number(received) || 0);
    item.total = Number(total) > 0 ? Number(total) : null;
    if (item.phase !== 'downloading') { item.samples = []; setPhase(item, 'downloading'); }
    measure(item);
    send(item, false);
  }
  async function arrived(id, { file, url, profile } = {}) {
    const item = items.get(id);
    if (!item?.external) throw new Error('Esse download não foi pedido.');
    const name = path.basename(String(file || ''));
    const inside = path.resolve(path.dirname(String(file || ''))) === path.resolve(dir);
    if (!inside || !SAFE_NAME.test(name) || !name.toLowerCase().endsWith('.exe')) {
      setPhase(item, 'error', { error: 'signature', speed: null, eta: null });
      throw new Error('Arquivo fora da pasta de downloads (não permitido).');
    }
    const silent = profile === undefined ? item.plan.silent : (profile === null ? null : (Silent.isName(profile) ? profile : item.plan.silent));
    item.plan = Object.freeze({ ...item.plan, url: String(url || ''), fileName: name, silent });
    item.file = file;
    item.cancel = null;
    try {
      setPhase(item, 'verifying', { speed: null, eta: null });
      const own = crypto.createHash('sha256');
      own.update(await fs.readFile(file));
      item.sha256 = own.digest('hex');
      await verify(item);
      setPhase(item, 'ready');
      autoInstall(item);
    } catch (error) {
      setPhase(item, 'error', { error: error instanceof DownloadError ? error.code : 'file', speed: null, eta: null });
    }
    return snapshot(item);
  }
  function failed(id, code) {
    const item = items.get(id);
    if (!item?.external || (item.phase !== 'site' && item.phase !== 'downloading')) return;
    item.cancel = null;
    if (code === 'canceled') setPhase(item, 'canceled', { speed: null, eta: null });
    else setPhase(item, 'error', { error: ['offline', 'notfound', 'site'].includes(code) ? code : 'offline', speed: null, eta: null });
  }

  async function readIndex() { try { const raw = JSON.parse(await fs.readFile(INDEX(), 'utf8')); return raw && typeof raw === 'object' ? raw : {}; } catch { return {}; } }
  async function writeIndex(index) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(INDEX(), JSON.stringify(index)); }

  function install(id, { restorePoint = true, window = false } = {}) {
    const item = items.get(id);
    if (!item || !item.file || (item.phase !== 'ready' && item.phase !== 'installed')) return Promise.reject(new Error('Este driver ainda não foi baixado.'));
    setPhase(item, 'install-queued');
    const job = installChain.then(() => runInstall(item, restorePoint === true, window === true));
    installChain = job.catch(() => {});
    return job;
  }

  async function runInstall(item, restorePoint, window) {
    item.quiet = !window && Boolean(item.plan.silent);
    setPhase(item, 'installing');
    let answer = null;
    try {
      answer = await elevate('driver-install', { file: item.file, dir, signers: [...item.plan.signers], kind: item.plan.kind, sha256: item.sha256, restorePoint, silent: window ? false : (item.plan.silent || false), description: 'Nexo - antes de instalar um driver' });
    } catch (error) {
      setPhase(item, 'ready');
      return { ok: false, restart: false, declined: false, restore: null, note: String(error?.message || 'Não consegui abrir o instalador.').slice(0, 200) };
    }
    const result = answer?.result;
    if (answer?.declined) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: true, restore: null, note: 'Você recusou a permissão de administrador.' }; }
    if (!result) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: false, restore: null, note: 'A instalação ainda pode estar aberta. Termine na janela do fabricante e clique em Conferir de novo.' }; }
    const restore = result.restore || null;
    // A cópia não bate com o que foi baixado, ou o instalador/driver de dentro do pacote não está assinado: apaga e
    // deixa o cartão pronto para baixar de novo.
    if (result.changed === true || result.inner === true) {
      await rm(item.file);
      item.file = null;
      const error = result.changed === true ? 'changed' : 'inner';
      setPhase(item, 'error', { error });
      return { ok: false, restart: false, declined: false, restore: null, note: error === 'changed' ? 'O arquivo mudou depois do download, então apaguei. Baixe de novo.' : 'O instalador de dentro do pacote não veio assinado pelo fabricante, então apaguei por segurança.' };
    }
    if (result.signature && result.signature.valid === false) {
      await rm(item.file);
      item.file = null;
      setPhase(item, 'error', { error: 'signature' });
      return { ok: false, restart: false, declined: false, restore: null, note: 'O arquivo não estava mais assinado pelo fabricante, então apaguei por segurança.' };
    }
    if (restore && !restore.ok) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: false, restore, note: `O ponto de restauração não foi criado: ${String(restore.note || 'o Windows não criou').slice(0, 160)}.` }; }
    // Sem janela: o instalador ficou esperando algo na tela (encerrado) → dá para tentar com a janela.
    if (result.hung === true) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: false, restore, hung: true, note: 'O instalador ficou parado sem janela (queria perguntar algo), então encerrei. Use "Instalar com janela".' }; }
    // O código de saída quer dizer coisas diferentes em cada instalador: vale a tabela do perfil.
    if (result.profile && Silent.isName(result.profile) && result.profile !== 'detect') {
      const o = Silent.outcome(result.profile, result.code);
      if (o.nothing) result.nothing = true;
      else if (o.notApplicable) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: false, restore, notApplicable: true, note: 'Esse pacote não serve neste PC (o instalador do fabricante recusou). Nada mudou.' }; }
      else { result.ok = o.ok; if (o.restart) result.code = 3010; }
    }
    // pnputil 259: nenhuma peça precisou do driver (o Windows já usa um igual ou mais novo). Não é "Instalado".
    if (result.nothing === true) {
      setPhase(item, 'ready');
      if (result.profile) return { ok: false, restart: false, declined: false, restore, nothing: true, note: 'Já estava instalado (o instalador não mudou nada). Nada mudou.' };
      // Pacote só da Microsoft (Catálogo): achado pelo código da peça, mas o Windows não usou em nenhuma.
      const catalog = item.plan.signers.every((s) => /^Microsoft /.test(s));
      return { ok: false, restart: false, declined: false, restore, nothing: true, note: catalog ? 'Esse driver do Catálogo da Microsoft não serve nesta peça (o Windows não usou em nenhuma). Nada mudou.' : 'O Windows já usa um driver igual ou mais novo para essas peças; nada mudou.' };
    }
    if (!result.ok) { setPhase(item, 'ready'); return { ok: false, restart: false, declined: false, restore, note: String(result.note || 'O instalador fechou sem terminar.').slice(0, 200) }; }
    const index = await readIndex();
    index[path.basename(item.file)] = now();
    await writeIndex(index).catch(() => {});
    setPhase(item, 'installed');
    return { ok: true, restart: result.code === 3010, declined: false, restore, note: result.windowed ? 'Esse instalador não tem modo sem janela conhecido, então ele abriu a janela do fabricante.' : '', ...(result.windowed ? { windowed: true } : {}) };
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
    start, cancel, install, cleanup, external, progress, arrived, failed,
    list: () => [...items.values()].map(snapshot),
    fileOf: (id) => { const item = items.get(id); return item && item.file ? item.file : null; }
  };
}

/** A pasta dos instaladores: AppData Local (arquivo de 1 GB não deve ir junto no perfil móvel); nunca pasta de rede. */
function downloadsDir(env, userData, p = require('node:path').win32) {
  const local = String(env?.LOCALAPPDATA || '');
  return /^[A-Za-z]:\\/.test(local) ? p.join(local, 'Nexo', 'driver-downloads') : p.join(userData, 'driver-downloads');
}

module.exports = { createDriverDownloads, downloadsDir, IDLE_MS, MAX_BYTES, MAX_REDIRECTS, official };
