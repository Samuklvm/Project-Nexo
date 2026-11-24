'use strict';
/*
 * PCs simulados do Cortex: máquinas inventadas cuja causa a gente conhece, para provar o motor de investigação.
 *
 * Cada máquina tem uma verdade escondida (que sinal aparece em cada lentidão, e quanto antes dela; quanto cada teste do
 * lab cai quando a causa está em ação; que ajuste mexe de verdade em qual teste) e responde às ações do Cortex com
 * honestidade: o resultado sai da verdade mais ruído sorteado. Nada aqui olha a hipótese que o Cortex está testando.
 *   lembrar  → olha as EPISODES lentidões guardadas; o sinal "aparece" num episódio quando força + ruído passa de 2
 *              desvios. Aparece na maioria → 'antes' ou 'depois' (pelo atraso, também com ruído); senão 'ausente'.
 *              Forte (significant) quando 80% ou mais dos episódios concordam.
 *   esperar  → a próxima repetição do sintoma: 'sobe' se passar de 2 desvios (forte acima de 3), senão 'igual' (fraco).
 *   medir    → REPS rodadas do teste agora contra REPS rodadas de referência desta máquina, julgadas por
 *              NexoExperiment.compare (efeito precisa vencer o ruído medido).
 *   intervir → A/B pareado e intercalado com o ajuste, julgado por NexoExperiment.comparePaired.
 * O ruído vem de um gerador com semente (mulberry32): a mesma máquina com a mesma semente responde sempre igual.
 */
const Experiment = require('../../../src/experiment.js');
const { KINDS } = require('../../../src/cortex/memory.cjs');

const MIN = 60000;
const DAY = 1440 * MIN;
const T0 = Date.UTC(2026, 10, 17); // segunda, 17/11/2026, 00:00 UTC
const DAYS = 3;
const EPISODES = 6;
const REPS = 5;
const SEEDS = [11, 23, 37, 41, 59];

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(text) {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/*
 * As máquinas. `signals`: força (z, em desvios do ruído) e atraso (lead, em minutos; > 0 = antes do sintoma) de cada
 * sinal que aparece nas lentidões; sinal fora da lista não aparece. `benches`: quanto cada teste cai (%) com a causa em
 * ação. `knobs`: o ajuste que mexe de verdade e em que teste. `noise`: desvio das rodadas do lab (%).
 * `minute`: como a causa aparece nos minutos guardados (para a busca de correlações).
 */
const MACHINES = [
  {
    // Um programa de renderização agendado pesa todo dia às 21h; o processador esquenta depois que ele começa.
    name: 'programa-noturno', truth: 'programa_pesado>cpu', symptom: 'cpu', value: 96, hour: 21, routine: true,
    signals: { programa_pesado: { z: 4, lead: 2 }, temp_cpu: { z: 2.6, lead: -4 } },
    repeat: 4, benches: { multi: -30, burst: -12, single: -6 }, knobs: {}, noise: 1.5,
    minute: (on, since) => (on ? { cpu: 70, cpuTemp: since > 4 ? 18 : 0, culprit: 'render-noturno.exe' } : {})
  },
  {
    // Pasta térmica seca: em jogo o processador passa de 95 °C e o clock cai alguns minutos depois.
    name: 'calor', truth: 'temp_cpu>clock_queda', symptom: 'clock_queda', value: 0.62, routine: false,
    signals: { temp_cpu: { z: 4, lead: 3 }, cpu: { z: 2.5, lead: 6 } },
    repeat: 3.5, benches: { single: -14, multi: -22, burst: -9 }, knobs: {}, noise: 1.5,
    minute: (on, since) => (on ? { cpu: 45, cpuTemp: 40, clockRatio: since > 3 ? -0.35 : 0 } : {})
  },
  {
    // Uma atualização do Windows baixou o "estado mínimo do processador": os núcleos dormem fundo e demoram a acordar.
    // Voltar o ajuste melhora o teste de latência de verdade (18%), bem acima do ruído.
    name: 'ajuste-latencia', truth: 'ajuste:minstate>bench:latency', symptom: 'bench:latency', value: 0.8, routine: false,
    signals: { 'ajuste:minstate': { z: 4, lead: 1440 } },
    repeat: 3, benches: { latency: -20, burst: -8, timer: -5 }, knobs: { minstate: { bench: 'latency', effectPct: 18 } }, noise: 1.5,
    minute: () => ({})
  },
  {
    // Disco 99% cheio: o sistema fica preso esperando o disco e os jogos travam logo em seguida.
    name: 'disco-cheio', truth: 'disk>travadas', symptom: 'travadas', value: 9, routine: false,
    signals: { disk: { z: 4.5, lead: 1 }, cpu: { z: 1.2, lead: -1 } },
    repeat: 4, benches: { disk: -40 }, knobs: {}, noise: 1.5,
    minute: (on) => (on ? { disk: 75 } : {})
  },
  {
    // Nada de errado: o "pico" de processador foi uma variação normal; todo sinal fica dentro do ruído.
    name: 'so-ruido', truth: null, symptom: 'cpu', value: 71, routine: false,
    signals: { programa_pesado: { z: 1, lead: 1 }, clock_queda: { z: 0.6, lead: 0 }, temp_cpu: { z: 0.8, lead: -1 } },
    repeat: 0.5, benches: {}, knobs: {}, noise: 2,
    minute: () => ({})
  },
  {
    // Travadas reais por uma causa que o Nexo não mede (interferência de um dispositivo USB): nenhum sinal, teste ou
    // ajuste que ele conhece muda. A explicação certa é "fora do que eu consigo medir".
    name: 'invisivel', truth: 'desconhecida>travadas', symptom: 'travadas', value: 7, routine: false,
    signals: {}, repeat: 4, benches: {}, knobs: {}, noise: 1.5,
    minute: () => ({})
  }
];

const BASE = { cpu: [18, 6], mem: [45, 4], disk: [8, 4], gpu: [12, 6], temp: [45, 3], cpuTemp: [50, 3] };
const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function build(def, seed) {
  const rand = prng(hash(def.name) ^ seed);
  const noise = () => gaussian(rand);

  // Episódios: todo dia na mesma hora (rotina) ou numa hora sorteada.
  const episodes = [];
  for (let d = 0; d < DAYS; d++) {
    const hour = def.routine ? def.hour : 9 + Math.floor(rand() * 13);
    episodes.push(T0 + d * DAY + hour * 60 * MIN + Math.round(noise() * 5) * MIN);
  }
  const last = episodes[episodes.length - 1];
  const anomaly = { kind: 'lentidao', symptom: def.symptom, at: last + 10 * MIN, window: { from: last - 5 * MIN, to: last + 10 * MIN }, data: { value: def.value } };

  let rows = null;
  function minutes() {
    if (rows) return rows;
    const r = prng(hash(`${def.name}:minutos`) ^ seed);
    const g = () => gaussian(r);
    rows = [];
    for (let t = T0; t < T0 + DAYS * DAY; t += MIN) {
      const ep = episodes.find((e) => t >= e && t < e + 45 * MIN);
      const extra = def.minute(!!ep, ep ? (t - ep) / MIN : 0);
      const m = { t };
      for (const [col, [mean, sd]] of Object.entries(BASE)) m[col] = clip(mean + sd * g() + (extra[col] || 0), 0, col.endsWith('emp') ? 110 : 100);
      m.clockRatio = clip(0.97 + 0.02 * g() + (extra.clockRatio || 0), 0.3, 1);
      m.clock = Math.round(4200 * m.clockRatio);
      m.culprit = extra.culprit || null;
      rows.push(m);
    }
    return rows;
  }

  function remember(signal) {
    const s = signal === 'rotina' ? { z: def.routine ? 4 : 0 } : def.signals[signal] || { z: 0 };
    let seen = 0;
    let before = 0;
    for (let i = 0; i < EPISODES; i++) {
      if (s.z + noise() <= 2) continue;
      seen++;
      if ((s.lead || 0) + noise() * 1.5 > 0) before++;
    }
    const frac = seen / EPISODES;
    if (frac >= 0.5) {
      const observed = s.lead === undefined ? 'presente' : before * 2 >= seen ? 'antes' : 'depois';
      return { observed, significant: frac >= 0.8 };
    }
    return { observed: 'ausente', significant: frac <= 0.2 };
  }

  function wait() {
    const z = def.repeat + noise();
    return z > 2 ? { observed: 'sobe', significant: z > 3 } : { observed: 'igual', significant: false };
  }

  const reps = (factor) => Array.from({ length: REPS }, () => 100 * factor * (1 + (def.noise / 100) * noise()));
  const judge = (r) => {
    const observed = r.verdict === 'melhorou' ? 'sobe' : r.verdict === 'piorou' ? 'desce' : 'igual';
    return { observed, significant: observed !== 'igual' && r.confidence !== 'baixa' };
  };

  function measure(target) {
    const effect = def.benches[String(target).replace(/^bench:/, '')] || 0;
    return judge(Experiment.compare(reps(1), reps(1 + effect / 100)));
  }

  function intervene(target) {
    const knob = def.knobs[String(target).replace(/^ajuste:/, '')];
    const effect = knob ? knob.effectPct : 0;
    const a = [];
    const b = [];
    for (let i = 0; i < REPS; i++) {
      const drift = 1 + 0.01 * noise(); // o processador aquece ao longo do teste: afeta os dois lados do par
      a.push(100 * drift * (1 + (def.noise / 100) * noise()));
      b.push(100 * drift * (1 + effect / 100) * (1 + (def.noise / 100) * noise()));
    }
    return judge(Experiment.comparePaired(a, b));
  }

  const calls = [];
  function act(action) {
    calls.push(`${action.type}:${action.target}`);
    const run = { lembrar: remember, esperar: wait, medir: measure, intervir: intervene }[action.type];
    const r = run ? run(action.target) : { observed: 'igual', significant: false };
    return { action: action.type, target: action.target, ...r };
  }

  return { name: def.name, truth: def.truth, seed, anomaly, minutes, act, calls };
}

/** As máquinas com uma semente de ruído (a mesma semente dá sempre as mesmas respostas). */
function makePCs(seed = SEEDS[0]) {
  return MACHINES.map((def) => build(def, seed));
}

/** Loja em memória com a forma de memory.record/latest/list. Só acrescenta; guarda o texto de cada registro gravado
 * para o teste conferir que nada foi mexido depois. */
function memoryStore({ now = () => T0 } = {}) {
  const rows = [];
  const copy = (r) => (r ? JSON.parse(JSON.stringify({ id: r.id, at: r.at, kind: r.kind, inv: r.inv, ref: r.ref, prev: r.prev, data: r.data })) : null);
  const match = (r, kind, inv, ref) => r.kind === kind && (inv == null || r.inv === inv) && (ref == null || r.ref === ref);
  return {
    rows,
    record(kind, { inv, ref, prev, data } = {}) {
      if (!KINDS.includes(kind)) throw new Error(`tipo de registro desconhecido: ${kind}`);
      const row = { id: rows.length + 1, at: now(), kind, inv: inv ?? null, ref: ref ?? null, prev: prev ?? null, data: data ?? {} };
      row.snapshot = JSON.stringify(row.data);
      rows.push(row);
      return row.id;
    },
    latest(kind, { inv, ref } = {}) {
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], kind, inv, ref)) return copy(rows[i]);
      return null;
    },
    list(kind, { inv, since, limit = 50 } = {}) {
      const all = rows.filter((r) => match(r, kind, inv, null) && (since == null || r.at >= since));
      return all.slice(-Math.max(1, Math.floor(limit))).map(copy);
    }
  };
}

module.exports = { PCS: makePCs(), makePCs, SEEDS, memoryStore, T0 };
