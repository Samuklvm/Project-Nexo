/*
 * Diagnóstico do próprio app, por dia, para a telemetria (só sai com ela ligada): quantas vezes cada ação interna
 * (canal IPC) rodou, quantas falharam e quanto demoraram; processos do Nexo que caíram, janela que travou, erros por
 * origem. Só nomes fixos do código e números: nada do que a ação leu ou recebeu.
 * Fica em <dados do app>/diag.json, com os últimos 8 dias.
 */
const KEEP_DAYS = 8;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Nome de canal vira chave aceita pelo servidor: "cloud:telemetry" → "cloud.telemetry". */
const keyOf = (name) => {
  const key = String(name).replace(/:/g, '.').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40);
  return /^[A-Za-z]/.test(key) ? key : `c${key}`.slice(0, 40);
};

function createDiag({ fs, path, file, now = Date.now }) {
  let days = {};
  let loaded = false;
  let dirty = false;
  function load() {
    if (loaded) return;
    loaded = true;
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (data && typeof data === 'object' && !Array.isArray(data)) days = data; } catch { days = {}; }
  }
  function bucket() {
    load();
    const day = dayOf(now());
    if (!days[day]) {
      days[day] = { ipc: {}, events: {} };
      days = Object.fromEntries(Object.keys(days).sort().slice(-KEEP_DAYS).map((key) => [key, days[key]]));
    }
    return days[day];
  }
  return {
    /** Uma chamada de um canal: duração em ms e se deu certo. */
    ipc(channel, ms, ok) {
      const b = bucket();
      const key = keyOf(channel);
      const row = b.ipc[key] || (b.ipc[key] = [0, 0, 0, 0]); // vezes, falhas, ms somados, ms do mais lento
      row[0] += 1;
      if (!ok) row[1] += 1;
      if (Number.isFinite(ms)) { row[2] += Math.round(ms); row[3] = Math.max(row[3], Math.round(ms)); }
      dirty = true;
    },
    /** Conta um acontecimento com nome fixo (ex.: "gpuCaiu", "janelaTravou", "erro.principal"). */
    count(name, n = 1) {
      const b = bucket();
      const key = keyOf(name);
      b.events[key] = (b.events[key] || 0) + n;
      dirty = true;
    },
    /** Resumo de um dia no formato da telemetria: os 45 canais mais usados e todos os que falharam. */
    summary(day) {
      load();
      const b = days[day];
      if (!b) return null;
      const rows = Object.entries(b.ipc);
      const picked = new Map([...rows].sort((a, c) => c[1][0] - a[1][0]).slice(0, 45));
      for (const [key, row] of rows) if (row[1] && picked.size < 58) picked.set(key, row);
      const ipc = Object.fromEntries([...picked].map(([key, [n, errors, total, max]]) => [key, { n, e: errors, ms: n ? Math.round(total / n) : 0, max }]));
      return { ipc, events: { ...b.events }, channels: rows.length };
    },
    flush() {
      if (!dirty) return;
      dirty = false;
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(days), 'utf8'); } catch { dirty = true; }
    },
    _days: () => days
  };
}

module.exports = { createDiag, keyOf };
