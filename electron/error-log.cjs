/*
 * Registro de erros local. Fica só neste computador (<userData>/logs) até a pessoa decidir enviar.
 *
 *  - uma linha JSON por ocorrência; arquivo de até 512 KB, com uma cópia anterior (o total nunca passa de ~1 MB);
 *  - caminhos pessoais viram marcadores: C:\Users\<usuário>\…, ~/…; nada de senhas, tokens ou chaves (cortados);
 *  - o mesmo erro (mesma "assinatura": mensagem sem números + primeiras linhas do stack) é agrupado: a lista mostra
 *    um item com quantas vezes aconteceu, em vez de centenas de linhas iguais;
 *  - um erro em loop não enche o disco: depois de 20 gravações na mesma hora, só conta.
 */
const crypto = require('crypto');

const MAX_BYTES = 512 * 1024;
const MAX_MESSAGE = 600;
const MAX_STACK = 4000;
const MAX_CONTEXT = 1500;
const PER_HOUR = 20;
const SOURCES = { principal: 'Processo principal', interface: 'Interface', ipc: 'Ação do app', servico: 'Serviço', processo: 'Processo do app' };
const LEVELS = ['erro', 'aviso'];

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Esconde o que identifica a pessoa ou abre portas: pasta pessoal, nome de usuário, tokens e chaves. */
function makeRedactor({ home = '', user = '' } = {}) {
  const rules = [];
  // A pasta pessoal em qualquer grafia de barra (C:\Users\x, C:/Users/x).
  if (home && home.length > 3) rules.push([new RegExp(String(home).split(/[\\/]+/).filter(Boolean).map(escapeRegex).join('[\\\\/]+'), 'gi'), '~']);
  // Pasta de outro usuário: o nome pode ter espaços quando vem seguido de outra pasta.
  rules.push([/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"'`:*?<>|\r\n]+(?=[\\/])/gi, '$1<usuário>']);
  rules.push([/([A-Za-z]:[\\/]+Users[\\/]+)(?!<usuário>)[^\\/\s"'`:*?<>|]+/gi, '$1<usuário>']);
  rules.push([/(\/(?:home|Users)\/)[^/\s"'`]+/g, '$1<usuário>']);
  if (user && user.length > 2) rules.push([new RegExp(`\\b${escapeRegex(user)}\\b`, 'gi'), '<usuário>']);
  // Segredos que às vezes aparecem em URLs ou mensagens de bibliotecas.
  rules.push([/\b(access_token|refresh_token|id_token|token|key|apikey|api_key|secret|client_secret|password|senha)=([^&\s"']+)/gi, '$1=<oculto>']);
  rules.push([/([?&]code=)[^&\s"']+/gi, '$1<oculto>']);
  rules.push([/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer <oculto>']);
  rules.push([/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '<jwt oculto>']);
  rules.push([/\b[0-9A-F]{32}\b/g, '<chave oculta>']);
  return (value) => {
    let text = String(value ?? '');
    for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
    return text;
  };
}

/** Assinatura estável do erro: a mesma falha em outra hora, outro PC ou outra linha de log cai no mesmo grupo. */
function signatureOf({ source, message, stack }) {
  // Sem números, textos entre aspas e caminhos: o mesmo erro com outro arquivo continua sendo o mesmo erro.
  const normalized = String(message || '').replace(/(?:[A-Za-z]:|~|\.{1,2})?(?:[\\/][^\\/\s"'`]+)+[\\/]?/g, '<caminho>')
    .replace(/\d+(\.\d+)?/g, '#').replace(/'[^']*'|"[^"]*"/g, '…').slice(0, 200);
  const frames = String(stack || '').split('\n').slice(1).map((line) => line.trim()).filter((line) => line.startsWith('at '))
    .slice(0, 3).map((line) => line.replace(/:\d+:\d+\)?$/, '').replace(/\(.*[\\/]/, '(').replace(/^at\s+/, ''));
  return crypto.createHash('sha256').update(`${source}|${normalized}|${frames.join('|')}`).digest('hex').slice(0, 16);
}

function createErrorLog({ fs, path, dir, version = '0.0.0', platform = process.platform, home = '', user = '', now = Date.now }) {
  const file = path.join(dir, 'nexo-errors.log');
  const previous = path.join(dir, 'nexo-errors.1.log');
  const redact = makeRedactor({ home, user });
  const hourly = new Map();
  let chain = Promise.resolve();
  const listeners = new Set();

  function clean(input = {}) {
    const source = SOURCES[input.source] ? input.source : 'principal';
    const message = redact(String(input.message || 'Erro sem mensagem')).slice(0, MAX_MESSAGE);
    const stack = input.stack ? redact(String(input.stack)).slice(0, MAX_STACK) : '';
    let context = '';
    if (input.context !== undefined && input.context !== null) {
      try { context = redact(typeof input.context === 'string' ? input.context : JSON.stringify(input.context)).slice(0, MAX_CONTEXT); } catch { context = ''; }
    }
    const level = LEVELS.includes(input.level) ? input.level : 'erro';
    const entry = { at: now(), level, source, message, stack, context, version: String(version).slice(0, 20), platform };
    entry.signature = signatureOf(entry);
    return entry;
  }

  async function rotateIfNeeded() {
    try {
      const stat = await fs.stat(file);
      if (stat.size < MAX_BYTES) return;
      await fs.rm(previous, { force: true }).catch(() => {});
      await fs.rename(file, previous);
    } catch { /* ainda não existe */ }
  }

  /** Guarda uma ocorrência. Nunca lança: o registro de erros não pode ser a causa de um erro. */
  function record(input) {
    let entry;
    try { entry = clean(input); } catch { return null; }
    const hour = Math.floor(entry.at / 3600000);
    const key = `${entry.signature}|${hour}`;
    const count = (hourly.get(key) || 0) + 1;
    hourly.set(key, count);
    if (hourly.size > 2000) hourly.clear();
    for (const listener of listeners) { try { listener(entry); } catch { /* ignora */ } }
    if (count > PER_HOUR) return entry; // em loop: conta, mas não grava de novo
    chain = chain.then(async () => {
      await fs.mkdir(dir, { recursive: true });
      await rotateIfNeeded();
      await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
    }).catch(() => {});
    return entry;
  }

  async function readEntries() {
    await chain;
    const out = [];
    for (const target of [previous, file]) {
      let text = '';
      try { text = await fs.readFile(target, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { const entry = JSON.parse(line); if (entry && entry.signature && entry.message) out.push(entry); } catch { /* linha cortada */ }
      }
    }
    return out;
  }

  /** Agrupado por assinatura, o mais recente primeiro. */
  async function list({ limit = 100, since = 0 } = {}) {
    const groups = new Map();
    for (const entry of await readEntries()) {
      if (entry.at < since) continue;
      const group = groups.get(entry.signature);
      if (!group) groups.set(entry.signature, { ...entry, count: 1, firstAt: entry.at, lastAt: entry.at, versions: [entry.version] });
      else {
        group.count += 1;
        if (entry.at > group.lastAt) Object.assign(group, { lastAt: entry.at, message: entry.message, context: entry.context, version: entry.version, stack: entry.stack || group.stack });
        group.firstAt = Math.min(group.firstAt, entry.at);
        if (!group.versions.includes(entry.version)) group.versions.push(entry.version);
      }
    }
    const items = [...groups.values()].sort((a, b) => b.lastAt - a.lastAt);
    return { total: items.reduce((sum, item) => sum + item.count, 0), groups: items.slice(0, Math.max(1, Math.min(500, limit))), file, dir };
  }

  async function clear() {
    await chain;
    await fs.rm(file, { force: true }).catch(() => {});
    await fs.rm(previous, { force: true }).catch(() => {});
    hourly.clear();
    return { ok: true };
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

  return { record, list, clear, exportText, onRecord, redact, file, dir };
}

module.exports = { createErrorLog, makeRedactor, signatureOf, SOURCES, MAX_BYTES, PER_HOUR };
