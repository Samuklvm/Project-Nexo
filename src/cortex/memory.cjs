/*
 * Memória eterna do Cortex: um arquivo SQLite (memoria.db) onde nada do que importa é apagado nem reescrito.
 * Minutos, eventos, retratos da máquina e registros (hipóteses, crenças, provas...) só aceitam INSERT: gatilhos
 * recusam UPDATE e DELETE. Só a "câmera" (amostras de alta resolução, descartáveis) e o "meta" mudam.
 * Sem Electron aqui: quem chama injeta a pasta (`dir`) e o relógio (`now`).
 *
 * Arquivo estragado: tenta os backups do mais novo ao mais antigo, cada um copiado antes para memoria.db.restaurando e
 * conferido; só com uma cópia boa o estragado (com o -wal e o -shm) vira memoria.corrompido-<t>.db*, e a cópia toma o
 * lugar. Sem backup bom, nada é renomeado.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MIN = 60000;
const FUTURO_MAX = 5 * MIN; // minuto mais de 5 min à frente do relógio é relógio errado: não entra
const BACKUPS_MAX = 3;
const DESDE = Date.UTC(2020, 0, 1); // minuto antes disso é hora quebrada (null, '' e 0 viram a época 0): não entra
const CAMERA_MAX_BYTES = 50 * 1024 * 1024; // a câmera vai junto de cada cópia de segurança: pequena de propósito
const CAMERA_MAX_AGE_MS = 7 * 24 * 60 * MIN; // sessão inteira com mais de 7 dias sai da câmera (o trecho citado fica)
const KINDS = ['investigacao', 'hipotese', 'crenca', 'experimento', 'prova', 'conclusao', 'relacao', 'pensamento', 'necessidade', 'trecho', 'pedido', 'ajuste'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS minutos (t INTEGER PRIMARY KEY, cpu, mem, disk, gpu, temp, cpuTemp, clock, clockRatio, culprit, origem TEXT DEFAULT 'vivo');
CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT);
CREATE TABLE IF NOT EXISTS maquina (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registros (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, inv INTEGER, ref INTEGER, prev INTEGER, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS camera (session TEXT NOT NULL, t INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_registros ON registros (kind, inv, id);
CREATE INDEX IF NOT EXISTS idx_eventos ON eventos (at);
CREATE INDEX IF NOT EXISTS idx_camera ON camera (session, t);
`;

function trigger(tabela, op) {
  return `CREATE TRIGGER IF NOT EXISTS eterno_${op.toLowerCase()}_${tabela} BEFORE ${op} ON ${tabela} BEGIN SELECT RAISE(ABORT, 'memoria eterna'); END;`;
}
const TRIGGERS = ['minutos', 'eventos', 'maquina', 'registros'].flatMap((t) => [trigger(t, 'UPDATE'), trigger(t, 'DELETE')]).join('\n');

/** JSON com chaves em ordem fixa: dois retratos iguais dão o mesmo texto. */
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}

function dia(ms) { return new Date(ms).toISOString().slice(0, 10); }
function parse(txt) { try { return JSON.parse(txt); } catch { return null; } }
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);

function rowOf(r) {
  return r ? { id: r.id, at: r.at, kind: r.kind, inv: r.inv, ref: r.ref, prev: r.prev, data: parse(r.data) } : null;
}

/** Corrupção de verdade (SQLITE_CORRUPT=11, SQLITE_NOTADB=26). Trava, disco cheio ou permissão NÃO são corrupção. */
function ehCorrupcao(e) {
  if (!e) return false;
  if (e.corrompido || e.errcode === 11 || e.errcode === 26) return true;
  return /not a database|malformed|disk image is malformed|file is encrypted/i.test(String(e.message || ''));
}

function abrir(file, busyMs) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { timeout: busyMs });
  try {
    db.exec(`PRAGMA busy_timeout=${busyMs}`);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=NORMAL');
    db.exec(SCHEMA);
    db.exec(TRIGGERS);
    if (db.prepare('PRAGMA user_version').get().user_version < 1) db.exec('PRAGMA user_version = 1');
    const qc = db.prepare('PRAGMA quick_check').get();
    if (qc && Object.values(qc)[0] !== 'ok') { const err = new Error(`quick_check falhou: ${Object.values(qc)[0]}`); err.corrompido = true; throw err; }
  } catch (e) { try { db.close(); } catch { /* já estava ruim */ } throw e; }
  return db;
}

/** Algum backup abre e passa no quick_check? Copia para `alvo` e devolve true; senão apaga a cópia e devolve false. */
function copiaBoa(origem, alvo, busyMs) {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(alvo + ext, { force: true });
  try {
    fs.copyFileSync(origem, alvo);
    abrir(alvo, busyMs).close();
    for (const ext of ['-wal', '-shm']) fs.rmSync(alvo + ext, { force: true });
    return true;
  } catch {
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(alvo + ext, { force: true });
    return false;
  }
}

function createMemory({ dir, now = Date.now, flushMs = 4000, cameraMaxBytes = CAMERA_MAX_BYTES, cameraMaxAgeMs = CAMERA_MAX_AGE_MS, busyMs = 2000 } = {}) {
  if (!dir) return { ok: false, error: 'sem pasta' };
  const file = path.join(dir, 'memoria.db');
  const pastaBackup = path.join(dir, 'backups');
  let db;
  try {
    fs.mkdirSync(dir, { recursive: true });
    try { db = abrir(file, busyMs); } catch (e) {
      // só corrupção de verdade vai para a quarentena; trava/disco cheio/permissão devolvem erro e deixam o arquivo quieto
      if (!ehCorrupcao(e)) return { ok: false, error: `memória não abriu: ${e.message}` };
      // arquivo estragado: a cópia boa do backup mais novo vem primeiro; só então o estragado (e o -wal/-shm) sai de lado
      const backups = fs.existsSync(pastaBackup) ? fs.readdirSync(pastaBackup).filter((f) => /^memoria-.*\.db$/.test(f)).sort().reverse() : [];
      const restaurando = `${file}.restaurando`;
      if (!backups.some((b) => copiaBoa(path.join(pastaBackup, b), restaurando, busyMs))) return { ok: false, error: `memória ilegível: ${e.message}` };
      const guardado = path.join(dir, `memoria.corrompido-${now()}.db`);
      for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(file + ext)) fs.renameSync(file + ext, guardado + ext);
      fs.renameSync(restaurando, file);
      db = abrir(file, busyMs);
    }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

  let flushAtual = Math.max(1, Number(flushMs) || 4000);
  let timer = null;
  let fechado = false;
  let filaMinutos = [];
  let filaMaquina = [];
  // estado degradado: falhas de escrita (disco cheio, trava) não derrubam o app, ficam aqui para quem chama consultar
  const saude = { ok: true, lastError: null, lastErrorAt: null, failures: 0 };
  const FILA_MAX_MINUTOS = 20000; // ~2 semanas de minutos; passando disso descarta os mais antigos da fila
  const FILA_MAX_MAQUINA = 200;
  const falhou = (e) => { saude.ok = false; saude.failures += 1; saude.lastError = String((e && e.message) || e); saude.lastErrorAt = now(); };
  const deuCerto = () => { saude.ok = true; };
  /** Roda uma escrita sem lançar: devolve `fallback` se falhar e registra o erro na saúde. */
  function seguro(fn, fallback) {
    try { const r = fn(); deuCerto(); return r; } catch (e) { falhou(e); return fallback; }
  }
  /** Leitura que não lança; não "cura" a saúde (só uma escrita que funciona faz isso). */
  function leitura(fn, fallback) {
    try { return fn(); } catch (e) { falhou(e); return fallback; }
  }
  const ultimoRetrato = db.prepare('SELECT data FROM maquina ORDER BY id DESC LIMIT 1').get();
  let ultimoCanon = ultimoRetrato ? canonico(parse(ultimoRetrato.data)) : null;

  const sql = {
    minuto: db.prepare('INSERT OR IGNORE INTO minutos (t,cpu,mem,disk,gpu,temp,cpuTemp,clock,clockRatio,culprit,origem) VALUES (?,?,?,?,?,?,?,?,?,?,?)'),
    evento: db.prepare('INSERT INTO eventos (at,kind,data) VALUES (?,?,?)'),
    maquina: db.prepare('INSERT INTO maquina (at,data) VALUES (?,?)'),
    registro: db.prepare('INSERT INTO registros (at,kind,inv,ref,prev,data) VALUES (?,?,?,?,?,?)'),
    camera: db.prepare('INSERT INTO camera (session,t,data) VALUES (?,?,?)'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key=?'),
    setMeta: db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)'),
  };

  function transacao(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* sem transação aberta */ } throw e; }
  }

  function inserirMinuto(m, origem) {
    const r = sql.minuto.run(m.t, num(m.cpu), num(m.mem), num(m.disk), num(m.gpu), num(m.temp), num(m.cpuTemp), num(m.clock), num(m.clockRatio),
      m.culprit == null ? null : String(m.culprit), origem);
    return Number(r.changes);
  }

  /** Grava a fila numa transação. Nunca lança: se falhar, o lote volta para a frente da fila e o timer tenta de novo. */
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (fechado || (!filaMinutos.length && !filaMaquina.length)) return;
    const minutos = filaMinutos; const maquinas = filaMaquina;
    filaMinutos = []; filaMaquina = [];
    try {
      transacao(() => {
        for (const m of minutos) inserirMinuto(m, 'vivo');
        for (const s of maquinas) sql.maquina.run(s.at, s.json);
      });
      if (maquinas.length) ultimoCanon = maquinas[maquinas.length - 1].canon; // só vale depois do commit
      deuCerto();
    } catch (e) {
      filaMinutos = minutos.concat(filaMinutos).slice(-FILA_MAX_MINUTOS);
      filaMaquina = maquinas.concat(filaMaquina).slice(-FILA_MAX_MAQUINA);
      falhou(e);
      agendar();
    }
  }
  function agendar() {
    if (timer || fechado) return;
    timer = setTimeout(() => { timer = null; flush(); }, flushAtual);
    if (timer.unref) timer.unref();
  }

  /** Hora de minuto que vale: número de verdade, de 2020 para cá e no máximo 5 min à frente do relógio. */
  const horaBoa = (t) => t !== null && t !== undefined && t !== '' && Number.isFinite(Number(t)) && Number(t) >= DESDE && Number(t) <= now() + FUTURO_MAX;

  function addMinute(m) {
    if (!m || !horaBoa(m.t)) return;
    filaMinutos.push({ ...m, t: Math.floor(Number(m.t)) });
    if (filaMinutos.length > FILA_MAX_MINUTOS) filaMinutos.shift();
    agendar();
  }

  /** Devolve o id, ou -1 se a gravação falhou (veja health()). */
  function addEvent({ kind, at, data }) {
    return seguro(() => Number(sql.evento.run(Number.isFinite(Number(at)) ? Number(at) : now(), String(kind), JSON.stringify(data ?? {})).lastInsertRowid), -1);
  }

  function addMachine(snapshot) {
    const c = canonico(snapshot);
    const ref = filaMaquina.length ? filaMaquina[filaMaquina.length - 1].canon : ultimoCanon; // último enfileirado, ou o último gravado
    if (c === ref) return;
    filaMaquina.push({ at: now(), json: JSON.stringify(snapshot), canon: c });
    if (filaMaquina.length > FILA_MAX_MAQUINA) filaMaquina.shift();
    agendar();
  }

  /** Devolve o id, ou -1 se a gravação falhou (tipo desconhecido continua sendo erro de programação e lança). */
  function record(kind, { inv, ref, prev, data } = {}) {
    if (!KINDS.includes(kind)) throw new Error(`tipo de registro desconhecido: ${kind}`);
    return seguro(() => Number(sql.registro.run(now(), kind, inv ?? null, ref ?? null, prev ?? null, JSON.stringify(data ?? {})).lastInsertRowid), -1);
  }

  function latest(kind, { inv, ref } = {}) {
    const w = ['kind=?']; const p = [kind];
    if (inv != null) { w.push('inv=?'); p.push(inv); }
    if (ref != null) { w.push('ref=?'); p.push(ref); }
    return rowOf(db.prepare(`SELECT * FROM registros WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT 1`).get(...p));
  }

  /** Os `limit` mais recentes, em ordem cronológica (o mais antigo primeiro). */
  function list(kind, { inv, since, limit = 50 } = {}) {
    const w = ['kind=?']; const p = [kind];
    if (inv != null) { w.push('inv=?'); p.push(inv); }
    if (since != null) { w.push('at>=?'); p.push(since); }
    p.push(Math.max(1, Math.floor(limit)));
    return db.prepare(`SELECT * FROM registros WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...p).reverse().map(rowOf);
  }

  function minutes({ from, to, limit = 2000 } = {}) {
    flush();
    return leitura(() => db.prepare('SELECT * FROM minutos WHERE t>=? AND t<=? ORDER BY t LIMIT ?')
      .all(from ?? 0, to ?? Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(limit))).map((r) => ({ ...r })), []);
  }

  /** order 'asc' (padrão): os mais antigos primeiro; 'desc': os mais novos primeiro (o limite corta os antigos). */
  function events({ from, to, kind, limit = 200, order = 'asc' } = {}) {
    const w = ['at>=?', 'at<=?']; const p = [from ?? 0, to ?? Number.MAX_SAFE_INTEGER];
    if (kind) { w.push('kind=?'); p.push(kind); }
    p.push(Math.max(1, Math.floor(limit)));
    const dir = order === 'desc' ? 'DESC' : 'ASC';
    return db.prepare(`SELECT * FROM eventos WHERE ${w.join(' AND ')} ORDER BY at ${dir}, id ${dir} LIMIT ?`).all(...p).map((r) => ({ id: r.id, at: r.at, kind: r.kind, data: parse(r.data) }));
  }

  const camera = {
    put(sessionId, samples) {
      if (!Array.isArray(samples) || !samples.length) return;
      seguro(() => transacao(() => { for (const s of samples) sql.camera.run(String(sessionId), Number.isFinite(Number(s && s.t)) ? Number(s.t) : now(), JSON.stringify(s)); }), null);
    },
    /** Copia o trecho da câmera para a memória eterna (registro 'trecho'): a câmera pode ser podada, o trecho não. */
    cite(sessionId, from, to) {
      const samples = leitura(() => db.prepare('SELECT data FROM camera WHERE session=? AND t>=? AND t<=? ORDER BY t').all(String(sessionId), from, to).map((r) => parse(r.data)), null);
      if (!samples) return -1;
      return record('trecho', { data: { session: String(sessionId), from, to, samples } });
    },
    /**
     * Apaga sessões inteiras: as que terminaram há mais de 7 dias, e depois das mais antigas para as mais novas até a
     * câmera caber no teto (50 MB). O que uma investigação citou já foi copiado para um 'trecho' eterno.
     */
    prune() {
      const sessoes = leitura(() => db.prepare('SELECT session, MIN(t) ini, MAX(t) fim, SUM(LENGTH(data)) bytes FROM camera GROUP BY session ORDER BY ini').all(), []);
      let n = sessoes.reduce((sum, x) => sum + x.bytes, 0);
      const velha = now() - cameraMaxAgeMs;
      const sai = [];
      for (const x of sessoes) {
        if (x.fim < velha || n > cameraMaxBytes) { sai.push(x.session); n -= x.bytes; }
      }
      if (!sai.length) return;
      const del = db.prepare('DELETE FROM camera WHERE session=?');
      seguro(() => transacao(() => { for (const id of sai) del.run(id); }), null);
    },
  };

  /** Cópia consistente (API de backup do SQLite) uma vez por dia; guarda só as 3 últimas. */
  async function backupDaily() {
    flush();
    fs.mkdirSync(pastaBackup, { recursive: true });
    const destino = path.join(pastaBackup, `memoria-${dia(now())}.db`);
    if (fs.existsSync(destino)) return null;
    const tmp = `${destino}.parcial`;
    try {
      await require('node:sqlite').backup(db, tmp);
      fs.renameSync(tmp, destino);
    } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    seguro(() => sql.setMeta.run('backup_ultimo', String(now())), null);
    const todos = fs.readdirSync(pastaBackup).filter((f) => /^memoria-.*\.db$/.test(f)).sort();
    for (const velho of todos.slice(0, Math.max(0, todos.length - BACKUPS_MAX))) fs.rmSync(path.join(pastaBackup, velho), { force: true });
    return destino;
  }

  /** Quando foi a última cópia de segurança diária (ms), ou null. */
  function lastBackupAt() {
    const v = Number(leitura(() => (sql.getMeta.get('backup_ultimo') || {}).value, null));
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  /**
   * Cópia consistente da memória viva para `destino` (a pessoa escolhe). Grava num arquivo parcial e só então troca o
   * nome, então um erro no meio não deixa meia cópia nem estraga uma cópia antiga. Nunca escreve na própria memória.
   */
  async function backup(destino) {
    const alvo = path.resolve(String(destino || ''));
    if (!destino || path.resolve(file) === alvo || path.resolve(pastaBackup) === path.dirname(alvo) && /^memoria-.*\.db$/.test(path.basename(alvo))) throw new Error('esse é o arquivo da memória viva; escolha outro lugar');
    flush();
    const tmp = `${alvo}.parcial`;
    try {
      await require('node:sqlite').backup(db, tmp);
      fs.renameSync(tmp, alvo);
    } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    return alvo;
  }

  /** Traz o histórico do formato antigo (history.json / brain.json). Roda uma vez só: o resto vira 0. */
  function importLegacy({ history, brain } = {}) {
    flush();
    return seguro(() => {
    if (sql.getMeta.get('legado_importado')) return { ok: true, imported: 0 };
    let imported = 0;
    transacao(() => {
      for (const m of Array.isArray(history) ? history : []) {
        if (m && horaBoa(m.t)) imported += inserirMinuto({ ...m, t: Math.floor(Number(m.t)) }, 'importado');
      }
      // O cérebro antigo que não grava desfaz tudo: sem ele, a importação não pode ficar marcada como feita.
      if (brain && typeof brain === 'object' && !(record('ajuste', { data: { origem: 'legado', brain } }) > 0)) throw new Error('o cérebro antigo não gravou');
      sql.setMeta.run('legado_importado', String(now()));
    });
    return { ok: true, imported };
    }, { ok: false, imported: 0 });
  }

  function sizeBytes() {
    const g = (p) => db.prepare(`PRAGMA ${p}`).get()[p];
    return g('page_count') * g('page_size');
  }

  /** Uso total em disco: o arquivo vivo, o -wal, o -shm e as cópias de segurança. */
  function diskBytes() {
    const tam = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
    let n = tam(file) + tam(`${file}-wal`) + tam(`${file}-shm`);
    try { for (const f of fs.readdirSync(pastaBackup)) n += tam(path.join(pastaBackup, f)); } catch { /* sem cópias ainda */ }
    return n;
  }

  return {
    ok: true,
    memory: {
      addMinute, addEvent, addMachine, record, latest, list, minutes, events, camera, backupDaily, lastBackupAt, backup, file, importLegacy, sizeBytes, diskBytes, flush,
      setFlushMs(ms) { flushAtual = Math.max(1, Number(ms) || flushAtual); },
      getMeta(key) { const r = sql.getMeta.get(String(key)); return r ? r.value : null; },
      /** false se a gravação falhou (veja health()). */
      setMeta(key, value) { return seguro(() => { sql.setMeta.run(String(key), value == null ? null : String(value)); return true; }, false); },
      /** Estado de saúde: { ok, lastError, lastErrorAt, failures, queued }. ok=false enquanto a última escrita falhou. */
      health() { return { ...saude, queued: filaMinutos.length + filaMaquina.length }; },
      close() {
        if (fechado) return;
        try { flush(); } finally { fechado = true; if (timer) clearTimeout(timer); db.close(); }
      },
      _db: db,
    },
  };
}

module.exports = { createMemory, KINDS, CAMERA_MAX_BYTES, CAMERA_MAX_AGE_MS };
