/*
 * Diagnóstico do próprio app, por dia, para a telemetria (só sai com ela ligada): quantas vezes cada ação interna
 * (canal IPC) rodou, quantas falharam e quanto demoraram; processos do Nexo que caíram, janela que travou, erros por
 * origem. Só nomes fixos do código e números: nada do que a ação leu ou recebeu.
 * Fica em <dados do app>/diag.json, com os últimos 8 dias.
 *
 * Usa a API SÍNCRONA do fs (require('fs')), de propósito: o flush roda no before-quit, onde uma gravação assíncrona
 * não termina antes de o app fechar. Gravação atômica (arquivo temporário + rename) e leitura que valida cada campo:
 * um arquivo velho, cortado ou editado à mão é aproveitado no que estiver certo e nunca derruba uma ação do app.
 */
const KEEP_DAYS = 8;
const VERSION = 2;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Nome de canal vira chave aceita pelo servidor: "cloud:telemetry" → "cloud.telemetry". */
const keyOf = (name) => {
  const key = String(name).replaceAll(':', '.').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40);
  return /^[A-Za-z]/.test(key) ? key : `c${key}`.slice(0, 40);
};
const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 1e9) : null);

/** Aproveita só o que tem o formato certo; o resto é descartado sem erro. */
function sanitize(data) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? (data.v === VERSION && data.days && typeof data.days === 'object' ? data.days : data) : {};
  const days = {};
  for (const [day, bucket] of Object.entries(source)) {
    if (!DAY_RE.test(day) || !bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    const ipc = {};
    const events = {};
    if (bucket.ipc && typeof bucket.ipc === 'object' && !Array.isArray(bucket.ipc)) {
      for (const [key, row] of Object.entries(bucket.ipc)) {
        if (!KEY_RE.test(key) || !Array.isArray(row) || row.length !== 4) continue;
        const clean = row.map(count);
        if (clean.some((value) => value === null) || clean[1] > clean[0]) continue;
        ipc[key] = clean;
      }
    }
    if (bucket.events && typeof bucket.events === 'object' && !Array.isArray(bucket.events)) {
      for (const [key, value] of Object.entries(bucket.events)) { const n = count(value); if (KEY_RE.test(key) && n !== null) events[key] = n; }
    }
    days[day] = { ipc, events };
  }
  return Object.fromEntries(Object.keys(days).sort((a, b) => a.localeCompare(b)).slice(-KEEP_DAYS).map((key) => [key, days[key]]));
}

function createDiag({ fs, path, file, now = Date.now, onError = () => {} }) {
  if (!fs || typeof fs.readFileSync !== 'function' || typeof fs.writeFileSync !== 'function') throw new TypeError('createDiag precisa da API síncrona do fs (require("fs")).');
  let days = {};
  let loaded = false;
  let dirty = false;
  let failures = 0;
  function load() {
    if (loaded) return;
    loaded = true;
    try { days = sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (error) { days = {}; if (error?.code !== 'ENOENT') onError('ler', error); }
  }
  function bucket() {
    load();
    const day = dayOf(now());
    if (!days[day]) {
      days[day] = { ipc: {}, events: {} };
      days = Object.fromEntries(Object.keys(days).sort((a, b) => a.localeCompare(b)).slice(-KEEP_DAYS).map((key) => [key, days[key]]));
    }
    return days[day];
  }
  /* Nenhuma função pública lança: instrumentação nunca pode mudar o resultado de uma ação do app. */
  const safe = (fn) => (...args) => { try { return fn(...args); } catch (error) { failures += 1; onError('contar', error); return undefined; } };
  return {
    /** Uma chamada de um canal: duração em ms e se deu certo. */
    ipc: safe((channel, ms, ok) => {
      const b = bucket();
      const key = keyOf(channel);
      const row = b.ipc[key] || (b.ipc[key] = [0, 0, 0, 0]); // vezes, falhas, ms somados, ms do mais lento
      row[0] += 1;
      if (!ok) row[1] += 1;
      if (Number.isFinite(ms) && ms >= 0) { row[2] += Math.round(ms); row[3] = Math.max(row[3], Math.round(ms)); }
      dirty = true;
    }),
    /** Conta um acontecimento com nome fixo (ex.: "gpuCaiu", "janelaTravou", "erro.principal"). */
    count: safe((name, n = 1) => {
      const b = bucket();
      const key = keyOf(name);
      b.events[key] = (b.events[key] || 0) + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 1);
      dirty = true;
    }),
    /** Resumo de um dia no formato da telemetria: os 45 canais mais usados e todos os que falharam. */
    summary: safe((day) => {
      load();
      const b = days[day];
      if (!b) return null;
      const rows = Object.entries(b.ipc);
      const picked = new Map([...rows].sort((a, c) => c[1][0] - a[1][0]).slice(0, 45));
      for (const [key, row] of rows) if (row[1] && picked.size < 58) picked.set(key, row);
      const ipc = Object.fromEntries([...picked].map(([key, [n, errors, total, max]]) => [key, { n, e: errors, ms: n ? Math.round(total / n) : 0, max }]));
      const events = { ...b.events };
      if (failures) events['diag.falhas'] = (events['diag.falhas'] || 0) + failures;
      return { ipc, events, channels: rows.length };
    }),
    /** Grava em disco (atômico). Devolve true se gravou ou não havia nada para gravar. */
    flush() {
      if (!dirty) return true;
      const tmp = `${file}.tmp`;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify({ v: VERSION, days }), 'utf8');
        fs.renameSync(tmp, file);
        dirty = false;
        return true;
      } catch (error) {
        failures += 1;
        onError('gravar', error);
        try { fs.rmSync?.(tmp, { force: true }); } catch { /* o temporário some na próxima gravação boa */ }
        return false;
      }
    },
    _days: () => days
  };
}

module.exports = { createDiag, keyOf, sanitize };
