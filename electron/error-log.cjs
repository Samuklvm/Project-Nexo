/*
 * Registro de erros local. Fica só neste computador (<userData>/logs) até a pessoa decidir enviar.
 *
 *  - uma linha JSON por ocorrência; arquivo de até 512 KB, com uma cópia anterior (o total nunca passa de ~1 MB):
 *    se a rotação falhar, o registro para de gravar (e conta o que perdeu) em vez de crescer sem limite;
 *  - caminhos pessoais viram marcadores: C:\Users\<usuário>\…, ~/…; nada de senhas, tokens, chaves ou e-mails —
 *    em texto (nome=valor, "nome": "valor", cabeçalhos) e também por estrutura (campos com nome de segredo);
 *  - o mesmo erro (mesma "assinatura": mensagem sem números + primeiras linhas do stack) é agrupado: a lista mostra
 *    um item com quantas vezes aconteceu, em vez de centenas de linhas iguais;
 *  - um erro em loop não enche o disco: depois de 20 gravações na mesma hora, as próximas viram UMA linha com a
 *    contagem (repeat), gravada logo depois — a lista, a exportação e o envio contam todas as ocorrências;
 *  - cada linha tem um número de sequência que só cresce: o envio ao servidor anda por ele (nada fica para trás
 *    quando há mais de 50 erros diferentes, nem com o relógio do PC voltando no tempo);
 *  - gravar, limpar e ler passam pela MESMA fila: limpar apaga tudo o que foi registrado antes do pedido, e o que
 *    vier depois fica.
 */
const crypto = require('crypto');

const MAX_BYTES = 512 * 1024;
const MAX_MESSAGE = 600;
const MAX_STACK = 4000;
const MAX_CONTEXT = 1500;
const PER_HOUR = 20;
const REPEAT_FLUSH_MS = 15000;
const SOURCES = { principal: 'Processo principal', interface: 'Interface', ipc: 'Ação do app', servico: 'Serviço', processo: 'Processo do app' };
const LEVELS = ['erro', 'aviso'];
/** Nomes de campo cujo valor nunca entra no registro (contexto estruturado). */
const SECRET_KEY = /pass(word|wd)?|senha|secret|token|api[-_]?key|apikey|^key$|chave|authorization|cookie|session|sess(ao|ão)|credential|bearer|e-?mail|private/i;

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Esconde o que identifica a pessoa ou abre portas: pasta pessoal, nome de usuário, e-mails, tokens e chaves. */
function makeRedactor({ home = '', user = '' } = {}) {
  const rules = [];
  // A pasta pessoal em qualquer grafia de barra (C:\Users\x, C:/Users/x).
  if (home && home.length > 3) rules.push([new RegExp(String(home).split(/[\\/]+/).filter(Boolean).map(escapeRegex).join(String.raw`[\\/]+`), 'gi'), '~']);
  // Pasta de outro usuário: o nome pode ter espaços quando vem seguido de outra pasta.
  rules.push([/([a-z]:[\\/]+Users[\\/]+)[^\\/"'`:*?<>|\r\n]+(?=[\\/])/gi, '$1<usuário>']);
  rules.push([/([a-z]:[\\/]+Users[\\/]+)(?!<usuário>)[^\\/\s"'`:*?<>|]+/gi, '$1<usuário>']);
  rules.push([/(\/(?:home|Users)\/)[^/\s"'`]+/g, '$1<usuário>']);
  if (user && user.length > 2) rules.push([new RegExp(String.raw`\b${escapeRegex(user)}\b`, 'gi'), '<usuário>']);
  // Segredos em URL/texto (nome=valor) e em JSON ("nome": "valor" ou "nome": 123).
  const names = 'access_token|refresh_token|id_token|token|key|apikey|api_key|secret|client_secret|password|passwd|senha|authorization|cookie|session|sessionid|private_key';
  rules.push([new RegExp(String.raw`\b(${names})=([^&\s"']+)`, 'gi'), '$1=<oculto>']);
  rules.push([new RegExp(String.raw`(["'])(${names})\1(\s*:\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}\]\s]+)`, 'gi'), '$1$2$1$3"<oculto>"']);
  // Cabeçalhos HTTP com credencial (até o fim da linha).
  rules.push([/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)(\s*:\s*)(?:(Bearer|Basic|Digest|Token) )?[^\r\n]*/gi, (_m, name, sep, scheme) => `${name}${sep}${scheme ? `${scheme} ` : ''}<oculto>`]);
  rules.push([/([?&]code=)[^&\s"']+/gi, '$1<oculto>']);
  rules.push([/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer <oculto>']);
  rules.push([/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '<jwt oculto>']);
  rules.push([/\b[0-9A-F]{32}\b/g, '<chave oculta>']);
  // E-mails (o e-mail de quem aceitou mandar vai em campo próprio, nunca no texto do erro).
  rules.push([/\b[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}\b/g, '<e-mail>']);
  return (value) => {
    let text = String(value ?? '');
    for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
    return text;
  };
}

/** Contexto estruturado: campos com nome de segredo saem antes de virar texto; o resto passa pelo redator. */
function cleanContext(value, redact, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redact(value).slice(0, 400);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanContext(item, redact, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) out[redact(key).slice(0, 40)] = SECRET_KEY.test(key) ? '<oculto>' : cleanContext(item, redact, depth + 1);
    return out;
  }
  return String(value).slice(0, 80);
}

const isDigits = (text) => text.length > 0 && [...text].every((ch) => ch >= '0' && ch <= '9');
/**
 * Uma linha do stack sem linha:coluna e sem a pasta (só o arquivo): "at f (C:\\a\\b.js:10:5)" → "f (b.js".
 * Feito com indexOf/lastIndexOf (linear em qualquer texto) e com o mesmo resultado das versões anteriores, para as
 * assinaturas dos erros já registrados não mudarem.
 */
function frameKey(line) {
  let text = line;
  const closing = text.endsWith(')') ? 1 : 0;
  const last = text.lastIndexOf(':', text.length - closing - 1);
  const prev = last > 0 ? text.lastIndexOf(':', last - 1) : -1;
  if (prev >= 0 && isDigits(text.slice(last + 1, text.length - closing)) && isDigits(text.slice(prev + 1, last))) text = text.slice(0, prev);
  const open = text.indexOf('(');
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  if (open >= 0 && slash > open) text = `${text.slice(0, open + 1)}${text.slice(slash + 1)}`;
  return text.startsWith('at ') ? text.slice(3).trimStart() : text;
}

/** Assinatura estável do erro: a mesma falha em outra hora, outro PC ou outra linha de log cai no mesmo grupo. */
function signatureOf({ source, message, stack }) {
  // Sem números, textos entre aspas e caminhos: o mesmo erro com outro arquivo continua sendo o mesmo erro.
  const normalized = String(message || '').replace(/(?:[A-Za-z]:|~|\.{1,2})?(?:[\\/][^\\/\s"'`]+)+[\\/]?/g, '<caminho>')
    .replace(/\d+(\.\d+)?/g, '#').replace(/'[^']*'|"[^"]*"/g, '…').slice(0, 200);
  const frames = String(stack || '').split('\n').slice(1).map((line) => line.trim()).filter((line) => line.startsWith('at '))
    .slice(0, 3).map(frameKey);
  return crypto.createHash('sha256').update(`${source}|${normalized}|${frames.join('|')}`).digest('hex').slice(0, 16);
}

const occurrences = (entry) => (Number.isInteger(entry.repeat) && entry.repeat > 0 ? entry.repeat : 1);

function createErrorLog({ fs, path, dir, version = '0.0.0', platform = process.platform, home = '', user = '', now = Date.now, setTimer = setTimeout, onLoss = () => {} }) {
  const file = path.join(dir, 'nexo-errors.log');
  const previous = path.join(dir, 'nexo-errors.1.log');
  const redact = makeRedactor({ home, user });
  const hourly = new Map(); // assinatura|hora → { written, pending, last }
  let chain = Promise.resolve();
  let nextSeq = null;
  let repeatTimer = null;
  const stats = { lost: 0, rotateFailures: 0, writeFailures: 0 };
  const listeners = new Set();

  function clean(input = {}) {
    const source = SOURCES[input.source] ? input.source : 'principal';
    const message = redact(String(input.message || 'Erro sem mensagem')).slice(0, MAX_MESSAGE);
    const stack = input.stack ? redact(String(input.stack)).slice(0, MAX_STACK) : '';
    let context = '';
    if (input.context !== undefined && input.context !== null) {
      try { context = (typeof input.context === 'string' ? redact(input.context) : redact(JSON.stringify(cleanContext(input.context, redact)))).slice(0, MAX_CONTEXT); } catch { context = ''; }
    }
    const level = LEVELS.includes(input.level) ? input.level : 'erro';
    const entry = { at: now(), level, source, message, stack, context, version: String(version).slice(0, 20), platform };
    entry.signature = signatureOf(entry);
    return entry;
  }

  /** Maior sequência já gravada (lida uma vez, dentro da fila). Linhas antigas sem sequência contam como 0. */
  async function initSeq() {
    if (nextSeq !== null) return;
    let max = 0;
    for (const target of [previous, file]) {
      let text = '';
      try { text = await fs.readFile(target, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) { const match = /"seq":(\d{1,15})/.exec(line); if (match) max = Math.max(max, Number(match[1])); }
    }
    nextSeq = max + 1;
  }

  /** true = pode gravar. Se o arquivo está cheio e não deu para girar, NÃO grava (limite rígido). */
  async function rotateIfNeeded(bytes) {
    let size = 0;
    try { size = (await fs.stat(file)).size; } catch (error) { if (error?.code === 'ENOENT') { return true; } size = MAX_BYTES; }
    if (size + bytes <= MAX_BYTES) return true;
    try {
      await fs.rm(previous, { force: true });
      await fs.rename(file, previous);
      return true;
    } catch {
      stats.rotateFailures += 1;
      return false;
    }
  }

  async function write(entry) {
    await fs.mkdir(dir, { recursive: true });
    await initSeq();
    entry.seq = nextSeq++;
    const line = `${JSON.stringify(entry)}\n`;
    if (!await rotateIfNeeded(Buffer.byteLength(line))) { stats.lost += occurrences(entry); onLoss({ reason: 'rotacao', ...stats }); return; }
    await fs.appendFile(file, line, 'utf8');
  }
  const enqueue = (task) => {
    const run = chain.then(task);
    chain = run.catch((error) => { stats.writeFailures += 1; onLoss({ reason: error?.code || 'gravar', ...stats }); });
    return run;
  };

  /** Ocorrências acima do limite por hora viram uma linha só, com a contagem. */
  function flushRepeats() {
    repeatTimer = null;
    for (const slot of hourly.values()) {
      if (!slot.pending) continue;
      const entry = { ...slot.last, repeat: slot.pending };
      slot.pending = 0;
      enqueue(() => write(entry));
    }
  }

  /** Guarda uma ocorrência. Nunca lança: o registro de erros não pode ser a causa de um erro. */
  function record(input) {
    let entry;
    try { entry = clean(input); } catch { return null; }
    const hour = Math.floor(entry.at / 3600000);
    const key = `${entry.signature}|${hour}`;
    let slot = hourly.get(key);
    if (!slot) {
      if (hourly.size > 2000) { flushRepeats(); hourly.clear(); }
      slot = { written: 0, pending: 0, last: null };
      hourly.set(key, slot);
    }
    for (const listener of listeners) { try { listener(entry); } catch { /* ignora */ } }
    if (slot.written < PER_HOUR) {
      slot.written += 1;
      enqueue(() => write(entry));
    } else {
      // Em loop: não grava cada uma, mas a contagem vai para o disco logo depois (uma linha com repeat).
      slot.pending += 1;
      slot.last = entry;
      if (!repeatTimer) { repeatTimer = setTimer(flushRepeats, REPEAT_FLUSH_MS); repeatTimer?.unref?.(); }
    }
    return entry;
  }

  async function readEntries() {
    if (repeatTimer) { clearTimeout(repeatTimer); flushRepeats(); }
    await chain;
    const out = [];
    for (const target of [previous, file]) {
      let text = '';
      try { text = await fs.readFile(target, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (!entry || typeof entry.signature !== 'string' || !entry.message) continue;
          // Linhas gravadas por versões antigas passam de novo pelo redator atual (que pega mais coisas).
          entry.message = redact(entry.message);
          if (entry.stack) entry.stack = redact(entry.stack);
          if (entry.context) entry.context = redact(entry.context);
          out.push(entry);
        } catch { /* linha cortada */ }
      }
    }
    return out;
  }

  /** Agrupado por assinatura, o mais recente primeiro. */
  async function list({ limit = 100, since = 0 } = {}) {
    const groups = new Map();
    for (const entry of await readEntries()) {
      if (entry.at < since) continue;
      const n = occurrences(entry);
      const group = groups.get(entry.signature);
      if (!group) { const { repeat, seq, ...rest } = entry; groups.set(entry.signature, { ...rest, count: n, firstAt: entry.at, lastAt: entry.at, versions: [entry.version] }); }
      else {
        group.count += n;
        if (entry.at > group.lastAt) Object.assign(group, { lastAt: entry.at, message: entry.message, context: entry.context, version: entry.version, stack: entry.stack || group.stack });
        group.firstAt = Math.min(group.firstAt, entry.at);
        if (!group.versions.includes(entry.version)) group.versions.push(entry.version);
      }
    }
    const items = [...groups.values()].sort((a, b) => b.lastAt - a.lastAt);
    return { total: items.reduce((sum, item) => sum + item.count, 0), groups: items.slice(0, Math.max(1, Math.min(500, limit))), file, dir, lost: stats.lost };
  }

  /**
   * Para enviar ao servidor: o que veio depois do cursor `afterSeq` (e não antes de `notBefore`, o início da janela
   * de consentimento), em ordem de sequência, até `limit` grupos diferentes. `cursor` é a última sequência incluída
   * por inteiro: o próximo envio continua dali, então nenhum grupo fica para trás.
   * Linhas antigas, sem sequência, só entram se forem mais novas que `legacyAfter` (o cursor por data das versões antigas).
   */
  async function groupsSince({ afterSeq = 0, notBefore = 0, legacyAfter = null, levels = ['erro'], limit = 50 } = {}) {
    const entries = (await readEntries()).filter((entry) => levels.includes(entry.level) && entry.at >= notBefore
      && (Number.isInteger(entry.seq) ? entry.seq > afterSeq : legacyAfter !== null && entry.at > legacyAfter));
    entries.sort((a, b) => (a.seq || 0) - (b.seq || 0) || a.at - b.at);
    const groups = new Map();
    let cursor = afterSeq;
    let more = false;
    for (const entry of entries) {
      let group = groups.get(entry.signature);
      if (!group) {
        if (groups.size >= limit) { more = true; break; }
        group = { signature: entry.signature, source: entry.source, level: entry.level, message: entry.message, stack: entry.stack, context: entry.context, count: 0, firstAt: entry.at, lastAt: entry.at, version: entry.version };
        groups.set(entry.signature, group);
      }
      group.count += occurrences(entry);
      group.firstAt = Math.min(group.firstAt, entry.at);
      if (entry.at >= group.lastAt) Object.assign(group, { lastAt: entry.at, message: entry.message, context: entry.context, stack: entry.stack || group.stack, version: entry.version });
      if (entry.level === 'erro') group.level = 'erro';
      if (Number.isInteger(entry.seq)) cursor = Math.max(cursor, entry.seq);
    }
    return { groups: [...groups.values()], cursor, more };
  }

  /** Apaga os dois arquivos. Só "não existe" conta como sucesso; qualquer outra falha volta para a tela. */
  function clear() {
    if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
    for (const slot of hourly.values()) slot.pending = 0;
    return enqueue(async () => {
      const failed = [];
      for (const target of [file, previous]) {
        try { await fs.rm(target); } catch (error) { if (error?.code !== 'ENOENT') failed.push({ file: path.basename(target), code: String(error?.code || 'erro') }); }
      }
      hourly.clear();
      // A sequência continua (não volta a 1): um envio pendente nunca confunde linha nova com antiga.
      return failed.length ? { ok: false, failed } : { ok: true };
    });
  }

  /** Texto para copiar e colar num relato (já sem dados pessoais). */
  async function exportText() {
    const { groups, total } = await list({ limit: 200 });
    const lines = [`Nexo Device Care ${version} (${platform}) · ${total} ocorrência(s) em ${groups.length} erro(s) diferentes`, ''];
    for (const group of groups) {
      lines.push(`[${new Date(group.lastAt).toISOString()}] ${SOURCES[group.source] || group.source} · ${group.level} · ${group.count}× · versões ${group.versions.join(', ')} · #${group.signature}`);
      lines.push(group.message);
      if (group.context) lines.push(`contexto: ${group.context}`);
      if (group.stack) lines.push(group.stack.split('\n').slice(0, 8).join('\n'));
      lines.push('');
    }
    return lines.join('\n');
  }

  const onRecord = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  /** Espera a fila esvaziar (testes e fechamento do app). */
  async function idle() { if (repeatTimer) { clearTimeout(repeatTimer); flushRepeats(); } await chain; }

  return { record, list, groupsSince, clear, exportText, onRecord, redact, idle, stats: () => ({ ...stats }), file, dir };
}

module.exports = { createErrorLog, makeRedactor, cleanContext, signatureOf, SOURCES, MAX_BYTES, PER_HOUR };
