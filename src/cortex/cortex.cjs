/*
 * Cortex — o ciclo no processo principal. Recebe o que a tela observa (minutos, lentidões, sessões, resultados do lab),
 * grava tudo na memória eterna, abre investigações e dá um passo de cada uma por tique; executa as ações que o motor
 * pede (lembrar, esperar, medir, intervir) com o laboratório como braço; muda de ritmo (leve/profundo) e corta o que
 * estiver rodando quando a pessoa volta.
 *
 * Sem Electron aqui: tudo o que é do sistema vem injetado (createCortex deps). O main.cjs só monta as dependências.
 *
 *   createCortex({ memory, labRun, labCancel, bench, quiet?, rhythm, idleSec, gameInForeground, onBattery, busy, now, emit, log })
 *     memory     resultado de createMemory ({ ok, memory } | { ok: false, error }) ou a própria memória
 *     labRun     (opts) => Promise<resultado do NexoLab.run>   (o main já põe o signal de cancelamento)
 *     labCancel  () => void                                     (marca o signal da execução do Cortex)
 *     bench      (modo) => Promise<number>  (pontuação: maior = melhor);  quiet () => Promise<{ ok }> (opcional)
 *     busy       () => boolean | Promise<boolean>  (lab da pessoa, análise profunda, teste com reinício, benchmark)
 *     emit       (canal, dados) => void   ('cortex:update' quando uma investigação ou o ritmo muda)
 *     log        ({ source: 'cortex', level, message, context: { etapa } }) => void
 *
 * Ritmo: no leve checa a cada 60 s e só consulta o primeiro plano com o PC parado há 10 min (depois de "tem jogo" ou
 * "não sei", espera 10 min para perguntar de novo, até a pessoa mexer); no profundo checa a
 * ociosidade a cada 5 s e o primeiro plano a cada 30 s. Leve: grava, abre/anexa, forja, lembra (consultas com limite) e
 * pensa, 1 passo por investigação. Profundo: também mede e intervém, minera correlações 1x/dia, faz a cópia de
 * segurança e a limpeza da câmera, e guarda referências dos testes (meta 'cortex.ref.<teste>', no máximo uma por tique
 * e só num tique sem outro passo andando, só de testes que nenhuma investigação aberta vai medir). Medir = 5 rodadas contra a referência; sem referência (ou com mais
 * de 30 dias) as rodadas viram a referência e o resultado é 'sem-referencia' (o motor grava 'invalido', sem prova, e
 * não conta como feito: o mesmo teste é refeito depois, já com a referência).
 * cancelActive(): o lab/benchmark/análise da pessoa corta o teste do Cortex. A fila de anomalias de eventos gravados
 * sobrevive a reiniciar (meta 'cortex.ultima-anomalia').
 * Configuração { permission, maxRisk, chosen } em memory.setMeta('cortex.config') e num registro 'ajuste' a cada escolha
 * da pessoa (setSettings vem sempre da tela: chosen = true). Antes da primeira escolha, o padrão segue a IA local
 * (meta 'ia-local.aceita', parte 3): aceita → 'sozinho' (teto baixo); senão → 'observar'. 'sozinho' é sempre teto baixo
 * e não pede a frase; a frase (NexoLab.CONSENT_PHRASE) só é exigida para 'pedir' com teto acima de baixo.
 * Orçamento: testes ativos concluídos no dia (hora local) em memory meta 'cortex.ativos', para reiniciar não zerar.
 * Toda exceção vai para log com source 'cortex' e o Cortex segue; memória que não abre → Cortex desligado (no-op).
 */
'use strict';
const Engine = require('./engine.js');
const Relations = require('./relations.js');
const Rhythm = require('./rhythm.js');
const Narrate = require('./narrate.js');
const Experiment = require('../experiment.js');
const Lab = require('../lab.js');

const MIN = 60000;
const DAY = 1440 * MIN;
const ENTER_IDLE_SEC = 600; // o mesmo limiar de entrada do ritmo (rhythm.js): abaixo disso nem olha o primeiro plano
const RHYTHM_MS = { leve: 60000, profundo: 5000 };
const TICK_MS = { leve: 60000, profundo: 15000 };
const FLUSH_MS = { leve: 60000, profundo: 5000 }; // leve: lotes maiores, disco o mínimo possível
const BENCH_ROUNDS = 5;
const REF_MAX_AGE = 30 * DAY; // referência mais velha que isso é refeita
const FG_DEEP_MS = 30000; // no profundo, o primeiro plano (PowerShell) só a cada 30 s; a ociosidade pega a volta antes
// No leve, depois de "tem jogo" ou "não sei", 10 min sem perguntar de novo: a ociosidade do Windows ignora o controle,
// e quem joga com ele parece parado o tempo todo (a consulta pesaria a cada minuto durante o jogo).
const FG_LEVE_BACKOFF_MS = 10 * MIN;
const QUEUE_KINDS = ['lentidao', 'sessao']; // eventos que viram anomalia (e são relidos depois de reiniciar)
const MINE_DAYS = 14;
const QUEUE_MAX = 50;
const LOG_QUIET_MS = 10 * MIN; // o mesmo erro da mesma etapa não enche o registro (o profundo checa a cada 5 s)
const PERMISSIONS = ['observar', 'pedir', 'sozinho'];
const RISKS = ['baixo', 'moderado', 'alto'];
const DEFAULT_CONFIG = { permission: 'observar', maxRisk: 'baixo', chosen: false, recommended: 'observar', iaLocal: false };
const riskRank = (r) => RISKS.indexOf(r);

// ---------- regras puras (exportadas para os testes) ----------

const EPISODE_SYMPTOM = { cpu: 'cpu', memory: 'mem', thermal: 'temp', throttle: 'clock_queda' };
/** Sintoma de uma lentidão fechada pelo brain.js (pelo `kind` do episódio). */
function symptomOfEpisode(episode) {
  return (episode && EPISODE_SYMPTOM[episode.kind]) || null;
}

/** Sintomas que um resumo de sessão abre: o gargalo do NexoBottleneck e as travadas. Limite de quadros e equilibrado não. */
function symptomsOfSession(summary) {
  if (!summary || typeof summary !== 'object') return [];
  const verdict = (summary.bottleneck && summary.bottleneck.verdict) ?? summary.verdict ?? null;
  const out = [];
  if (verdict === 'gpu-calor' || verdict === 'cpu-calor') out.push('temp');
  else if (typeof verdict === 'string' && verdict.startsWith('gpu')) out.push('gpu');
  else if (verdict === 'cpu-thread' || verdict === 'cpu-total') out.push('cpu');
  else if (verdict === 'memoria') out.push('mem');
  if ((Array.isArray(summary.findings) ? summary.findings : []).some((f) => f && f.id === 'fps-stutter')) out.push('travadas');
  return out;
}

/** Só o que é estável no retrato do sistema (o mesmo do canal system:snapshot): nada de uso, livre ou nome do PC. */
function machineOf(snapshot) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const text = (v) => (typeof v === 'string' ? v.slice(0, 120) : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const drives = (Array.isArray(s.drives) ? s.drives : []).slice(0, 16).map((d) => ({
    driveLetter: text(d && d.driveLetter), fileSystem: text(d && d.fileSystem), sizeBytes: num(d && d.sizeBytes), model: text(d && d.model)
  }));
  return { operatingSystem: text(s.operatingSystem), cpuModel: text(s.cpuModel), logicalCpuCount: num(s.logicalCpuCount), memoryTotalBytes: num(s.memoryTotalBytes), drives };
}

const LAB_OBSERVED = { melhorou: 'sobe', piorou: 'desce', 'sem-diferenca': 'igual', misto: 'igual' };
/** Resultado do NexoLab.run (um braço só) no vocabulário do motor. Cancelado = interrompido; guarda/erro/inconclusivo lançam. */
function labOutcome(result, knob) {
  if (!result || typeof result !== 'object') throw new Error('o laboratório não devolveu resultado');
  if (result.status === 'cancelled') return { observed: 'interrompido' };
  if (result.status !== 'completed') throw new Error(`o laboratório parou: ${result.reason || 'motivo desconhecido'}`);
  const arm = (Array.isArray(result.arms) ? result.arms : []).find((a) => a && a.knob === knob);
  if (!arm) throw new Error(`o laboratório não testou o ajuste ${knob}`);
  const observed = LAB_OBSERVED[arm.verdict];
  if (!observed) throw new Error(`medição ${arm.verdict || 'sem veredito'}: não vale como evidência`);
  const strong = (observed === 'sobe' || observed === 'desce') && arm.verdict !== 'misto'
    && ((result.combination && result.combination.verdict === arm.verdict) || Object.values(arm.results || {}).some((r) => r && r.verdict === arm.verdict && r.confidence && r.confidence !== 'baixa'));
  return { observed, significant: !!strong };
}

/** Eventos do mapa de um resultado do lab: em cada braço, cada teste medido apoia ou derruba a aresta ajuste → teste. */
function labMapEvents(result, at) {
  const out = [];
  for (const arm of (result && Array.isArray(result.arms) ? result.arms : []).slice(0, 64)) {
    if (!arm || typeof arm.knob !== 'string' || !Lab.knob(arm.knob)) continue;
    for (const [bench, r] of Object.entries(arm.results && typeof arm.results === 'object' ? arm.results : {})) {
      if (!Lab.BENCHES.includes(bench) || !r) continue;
      const sure = r.confidence && r.confidence !== 'baixa';
      const kind = (r.verdict === 'melhorou' || r.verdict === 'piorou') && sure ? 'experimento-a-favor' : r.verdict === 'sem-diferenca' && sure ? 'experimento-contra' : null;
      if (kind) out.push({ edgeId: `ajuste:${arm.knob}>bench:${bench}`, kind, at });
    }
  }
  return out;
}

// ---------- lembrar: consultas à memória ----------

const COLUMN = { cpu: 'cpu', mem: 'mem', disk: 'disk', gpu: 'gpu', temp: 'temp', temp_cpu: 'cpuTemp', clock_queda: 'clockRatio' };
const MIN_RISE = { cpu: 15, mem: 10, disk: 15, gpu: 15, temp: 8, cpuTemp: 8, clockRatio: 0.1 };
const EPISODES_MAX = 12;
const ROWS_MAX = 400;
const BASE_MIN = 60; // minutos de referência antes da janela de cada lentidão
const LEAD_MIN = 10; // quanto antes do sintoma ainda conta como "começou antes"
const WINDOW_MAX_MIN = 120; // janelas longas (curiosidade de 14 dias) olham só o fim
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const valueOf = (row, col) => (finite(row[col]) ? (col === 'clockRatio' ? 1 - row[col] : row[col]) : null);

function createCortex(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const sink = typeof deps.log === 'function' ? deps.log : () => {};
  const lastLog = new Map();
  function log(etapa, error, level = 'erro') {
    const message = String((error && error.message) || error || 'falha sem detalhe').slice(0, 400);
    const key = `${etapa}|${message}`;
    const t = now();
    if (lastLog.has(key) && t - lastLog.get(key) < LOG_QUIET_MS) return;
    lastLog.set(key, t);
    if (lastLog.size > 200) lastLog.clear();
    try { sink({ source: 'cortex', level, message, context: { etapa } }); } catch (_) { /* registro indisponível */ }
  }

  const opened = deps.memory;
  const memory = opened && opened.ok === true && opened.memory ? opened.memory : opened && opened.ok === undefined && typeof opened.record === 'function' ? opened : null;
  if (!memory) {
    log('abrir', (opened && opened.error) || 'memória ausente');
    return disabled((opened && opened.error) || 'memória ausente');
  }

  const rhythm = deps.rhythm || Rhythm.createRhythm();
  // Sem a dependência: o mais conservador (ocupado não, pessoa presente, jogo "não sei", sem lab nem benchmark).
  const busy = typeof deps.busy === 'function' ? deps.busy : () => false;
  const idleSec = typeof deps.idleSec === 'function' ? deps.idleSec : () => NaN;
  const gameInForeground = typeof deps.gameInForeground === 'function' ? deps.gameInForeground : async () => null;
  const bench = typeof deps.bench === 'function' ? deps.bench : async () => { throw new Error('sem benchmark'); };
  const labRun = typeof deps.labRun === 'function' ? deps.labRun : async () => { throw new Error('sem laboratório'); };
  const emit = (payload) => { try { if (typeof deps.emit === 'function') deps.emit('cortex:update', payload); } catch (e) { log('avisar', e); } };
  const call = async (etapa, fn, fallback) => { try { return await fn(); } catch (e) { log(etapa, e); return fallback; } };
  const safe = (etapa, fn, fallback) => { try { return fn(); } catch (e) { log(etapa, e); return fallback; } };

  // ---------- configuração e orçamento ----------

  /** A escolha guardada da pessoa (null = ainda não escolheu). */
  function readStored() {
    let c = null;
    try { c = JSON.parse(memory.getMeta('cortex.config') || 'null'); } catch (_) { c = null; }
    if (!c || !PERMISSIONS.includes(c.permission) || c.chosen === false) return null;
    return { permission: c.permission, maxRisk: c.permission === 'sozinho' ? 'baixo' : RISKS.includes(c.maxRisk) ? c.maxRisk : 'baixo', chosen: true };
  }
  let stored = safe('config', readStored, null);
  const iaLocal = () => safe('config', () => { const v = memory.getMeta('ia-local.aceita'); return !!v && v !== '0' && v !== 'false'; }, false);
  /** O que vale agora: a escolha da pessoa, ou o padrão recomendado (que muda se a IA local for aceita depois). */
  function config() {
    const ia = iaLocal();
    const recommended = ia ? 'sozinho' : 'observar';
    const base = stored || { permission: recommended, maxRisk: 'baixo', chosen: false };
    return { ...base, maxRisk: base.permission === 'sozinho' ? 'baixo' : base.maxRisk, recommended, iaLocal: ia };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(now()); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  function activeToday() {
    try {
      const v = JSON.parse(memory.getMeta('cortex.ativos') || 'null');
      return v && v.dia === today() && finite(v.n) ? v.n : 0;
    } catch (_) { return 0; }
  }
  function spendActive() {
    if (!memory.setMeta('cortex.ativos', JSON.stringify({ dia: today(), n: activeToday() + 1 }))) log('orcamento', 'não gravou o orçamento do dia');
  }

  // ---------- mapa de relações (semente + o que a memória já provou) ----------

  let live = null;
  let lastRelacao = 0;
  function loadMap() {
    const rows = memory.list('relacao', { limit: 100000 });
    const extra = rows.map((r) => r.data && r.data.edge).filter((e) => e && typeof e.id === 'string');
    live = Relations.createMap([...Relations.seedEdges(), ...extra], rows.map((r) => r.data));
    lastRelacao = rows.length ? rows[rows.length - 1].id : 0;
  }
  /** Aplica no mapa os registros 'relacao' novos (do motor e do Cortex). Aresta nova (correlação) refaz o mapa. */
  function syncMap() {
    const fresh = memory.list('relacao', { limit: 1000 }).filter((r) => r.id > lastRelacao);
    if (!fresh.length) return;
    if (fresh.some((r) => r.data && r.data.edge)) { loadMap(); return; }
    for (const r of fresh) live.apply(r.data);
    lastRelacao = fresh[fresh.length - 1].id;
  }
  safe('mapa', loadMap, null);
  if (!live) live = Relations.createMap(Relations.seedEdges(), []);
  const map = { state: (id) => live.state(id), causesOf: (s) => live.causesOf(s), apply: (e) => live.apply(e), edges: () => live.edges() };

  // ---------- ações ----------

  let active = null; // { type, interrupted } da ação pesada em andamento
  const deep = () => rhythm.state() === 'profundo';

  function anomalyOf(inv) {
    const row = memory.list('investigacao', { limit: 1000 }).find((r) => r.id === inv);
    return row && row.data ? row.data.anomaly : null;
  }

  /** Lentidões guardadas do mesmo sintoma (as mais recentes), mais a janela da anomalia atual. */
  function episodesFor(symptom, anomaly) {
    const t = now();
    const out = [];
    const win = anomaly && anomaly.window;
    if (win && finite(win.from) && finite(win.to)) out.push({ from: Math.max(win.from, win.to - WINDOW_MAX_MIN * MIN), to: win.to, current: true });
    const past = memory.events({ kind: 'lentidao', from: t - 30 * DAY, to: t, limit: 500 })
      .filter((e) => e.data && symptomOfEpisode(e.data) === symptom && finite(e.data.start) && finite(e.data.end))
      .map((e) => ({ from: Math.max(e.data.start, e.data.end - WINDOW_MAX_MIN * MIN), to: e.data.end, culprit: e.data.culprit || null }));
    for (const ep of past.reverse()) {
      if (out.length >= EPISODES_MAX) break;
      if (out.some((o) => Math.abs(o.to - ep.to) < 5 * MIN)) continue; // a própria lentidão atual
      out.push(ep);
    }
    return out;
  }

  /** Num episódio: o sinal apareceu? começou a subir antes do sintoma? (null = sem minutos para dizer) */
  function lookEpisode(signal, ep) {
    const rows = memory.minutes({ from: ep.from - (BASE_MIN + LEAD_MIN) * MIN, to: ep.to, limit: ROWS_MAX });
    const inside = rows.filter((r) => r.t >= ep.from - LEAD_MIN * MIN);
    if (signal === 'programa_pesado') {
      const marked = inside.filter((r) => r.culprit);
      if (!marked.length && !ep.culprit) return inside.length ? { present: false } : null;
      return { present: true, before: marked.length ? marked[0].t < ep.from : null };
    }
    const col = COLUMN[signal];
    const base = rows.filter((r) => r.t < ep.from - LEAD_MIN * MIN).map((r) => valueOf(r, col)).filter(finite);
    const ins = inside.filter((r) => finite(valueOf(r, col)));
    if (base.length < 5 || !ins.length) return null;
    const mean = base.reduce((s, v) => s + v, 0) / base.length;
    const sd = Math.sqrt(base.reduce((s, v) => s + (v - mean) ** 2, 0) / base.length);
    const limit = mean + Math.max(2 * sd, MIN_RISE[col]);
    const first = ins.find((r) => valueOf(r, col) >= limit);
    return first ? { present: true, before: first.t < ep.from } : { present: false };
  }

  /** "Rotina": as lentidões deste sintoma costumam cair neste horário? */
  function lookRoutine(eps) {
    const cur = eps.find((e) => e.current) || eps[0];
    const past = eps.filter((e) => e !== cur);
    if (!cur || past.length < 2) throw new Error('pouco histórico de lentidões para dizer se é rotina');
    const hour = (t) => new Date(t).getHours();
    const near = past.filter((e) => Math.min(Math.abs(hour(e.to) - hour(cur.to)), 24 - Math.abs(hour(e.to) - hour(cur.to))) <= 1).length;
    const frac = near / past.length;
    return { observed: frac >= 0.5 ? 'presente' : 'ausente', significant: past.length >= 3 && (frac >= 0.8 || frac <= 0.2) };
  }

  function remember(target, symptom, anomaly) {
    const eps = episodesFor(symptom, anomaly);
    if (target === 'rotina') return lookRoutine(eps);
    if (!COLUMN[target] && target !== 'programa_pesado') throw new Error(`não guardo "${target}" nos minutos`);
    const looks = eps.map((ep) => lookEpisode(target, ep)).filter(Boolean);
    if (!looks.length) throw new Error('sem minutos guardados em volta das lentidões para comparar');
    const seen = looks.filter((l) => l.present);
    const frac = seen.length / looks.length;
    if (frac >= 0.5) {
      const timed = seen.filter((l) => l.before !== null && l.before !== undefined);
      const before = timed.filter((l) => l.before).length;
      const observed = timed.length ? (before * 2 >= timed.length ? 'antes' : 'depois') : 'presente';
      return { observed, significant: looks.length >= 3 && frac >= 0.8 };
    }
    return { observed: 'ausente', significant: looks.length >= 3 && frac <= 0.2 };
  }

  const readRef = (mode) => { try { const r = JSON.parse(memory.getMeta(`cortex.ref.${mode}`) || 'null'); return r && Array.isArray(r.values) && finite(r.at) ? r : null; } catch (_) { return null; } };
  const freshRef = (ref) => !!ref && now() - ref.at <= REF_MAX_AGE;
  function writeRef(mode, values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const ref = { values, median: sorted[Math.floor(sorted.length / 2)], at: now() };
    if (!memory.setMeta(`cortex.ref.${mode}`, JSON.stringify(ref))) log('referencia', `a referência de ${mode} não gravou`);
  }
  /** Rodadas do teste; null se cortadas (a pessoa voltou, o lab/benchmark/análise dela começou, ou ficou ocupado). */
  async function rounds(mode) {
    const quiet = typeof deps.quiet === 'function' ? deps.quiet : async () => ({ ok: true });
    const calm = await quiet();
    if (calm && calm.ok === false) throw new Error('outro programa usou o processador durante a medição');
    const out = [];
    const cut = async () => active.interrupted || !deep() || !!(await busy());
    for (let i = 0; i < BENCH_ROUNDS; i++) {
      if (await cut()) return null;
      out.push(Number(await bench(mode)));
      if (await cut()) return null;
    }
    return out;
  }

  /**
   * Medir = 5 rodadas agora contra a referência guardada deste teste (NexoExperiment, mesma regra de ruído). Sem
   * referência, ou com mais de 30 dias: as rodadas viram a referência e o resultado não vale como evidência.
   */
  async function measure(target) {
    const mode = String(target).replace(/^bench:/, '');
    if (!Lab.BENCHES.includes(mode)) throw new Error(`teste desconhecido: ${mode}`);
    const ref = readRef(mode);
    const values = await rounds(mode);
    if (!values) return { observed: 'interrompido' };
    if (!freshRef(ref)) { writeRef(mode, values); return { observed: 'sem-referencia' }; }
    const r = Experiment.compare(ref.values, values);
    const observed = r.verdict === 'melhorou' ? 'sobe' : r.verdict === 'piorou' ? 'desce' : r.verdict === 'sem-diferenca' ? 'igual' : null;
    if (!observed) throw new Error(`medição ${r.verdict}`);
    const evidenceId = memory.record('trecho', { data: { bench: mode, referencia: ref.values, referenciaEm: ref.at, agora: values, verdict: r.verdict, deltaPct: r.deltaPct, noisePct: r.noisePct } });
    const out = { observed, significant: observed !== 'igual' && r.confidence !== 'baixa' };
    if (evidenceId > 0) out.evidenceId = evidenceId;
    return out;
  }

  /** Testes que algum caminho do mapa manda medir (causa → bench:), sem os ajustes. */
  const measurable = () => [...new Set(map.edges().filter((e) => String(e.to).startsWith('bench:') && !String(e.from).startsWith('ajuste:')).map((e) => e.to.slice(6)))]
    .filter((b) => Lab.BENCHES.includes(b));
  /** Testes que uma investigação aberta vai medir: a referência deles não é feita agora (sairia "contaminada"). */
  function benchesInUse() {
    const used = new Set();
    for (const r of memory.list('investigacao', { limit: 1000 })) {
      if (memory.latest('conclusao', { inv: r.id })) continue;
      for (const h of memory.list('hipotese', { inv: r.id, limit: 1000 })) for (const p of (h.data && h.data.predictions) || []) if (p.action === 'medir') used.add(String(p.target).slice(6));
    }
    return used;
  }
  /** No profundo, uma referência por tique: a que falta ou está velha, de um teste que nenhuma investigação aberta mede. */
  async function buildReference() {
    if (active || !deep() || await busy()) return;
    const used = benchesInUse();
    const day = today();
    const mode = measurable().find((b) => !used.has(b) && !freshRef(readRef(b)) && memory.getMeta(`cortex.ref-falhou.${b}`) !== day);
    if (!mode) return;
    active = { type: 'referencia', interrupted: false };
    try {
      const values = await rounds(mode);
      if (values) writeRef(mode, values);
    } catch (e) {
      memory.setMeta(`cortex.ref-falhou.${mode}`, day); // tenta de novo amanhã (ex.: teste que não existe no Linux)
      log('referencia', e, 'aviso');
    } finally { active = null; }
  }

  async function intervene(action) {
    const c = config();
    if (c.permission !== 'pedir' && c.permission !== 'sozinho') throw new Error('a permissão atual não deixa mexer em ajustes');
    const knob = String(action.target).replace(/^ajuste:/, '');
    const info = Lab.knob(knob);
    if (!info) throw new Error(`ajuste fora do espaço do laboratório: ${knob}`);
    const allowRisk = c.permission === 'sozinho' ? 'baixo' : c.maxRisk;
    if (RISKS.indexOf(info.risk) > RISKS.indexOf(allowRisk)) throw new Error('ajuste acima do risco liberado');
    if (deps.onBattery && deps.onBattery()) throw new Error('na bateria o Cortex não mexe em ajustes');
    // A permissão (sozinho com a frase, ou o pedido aprovado) é o consentimento: o lab confere a frase de novo.
    const result = await labRun({ onlyKnobs: [knob], maxArms: 1, combos: 0, autonomy: 'assistido', allowRisk,
      consent: { acknowledged: true, phrase: Lab.CONSENT_PHRASE }, requireRestorePoint: info.risk !== 'baixo' });
    safe('lab-mapa', () => {
      const arm = (result && Array.isArray(result.arms) ? result.arms : []).find((x) => x && x.knob === knob) || null;
      const slim = { origem: 'cortex', knob, status: result && result.status, verdict: arm ? arm.verdict : null, compositeDelta: arm ? arm.compositeDelta ?? null : null, restoreFailed: !!(result && result.restoreFailed) };
      memory.addEvent({ kind: 'lab', at: now(), data: slim });
      emit({ lab: slim }); // a tela registra no Diário de alterações
      noteLab(result);
    }, null);
    if (active.interrupted) return { observed: 'interrompido' };
    return labOutcome(result, knob);
  }

  /**
   * A ação que o motor pede. null só para esperar (o resultado chega com a próxima lentidão igual).
   * O motor manda tudo num objeto só ({ type, target, cost, risk, inv, symptom }); `info` é opcional (testes).
   */
  async function act(action, info = {}) {
    const a = action || {};
    const inv = info.inv ?? a.inv;
    const symptom = info.symptom ?? a.symptom;
    if (a.type === 'lembrar') return remember(a.target, symptom, info.anomaly || anomalyOf(inv));
    if (a.type === 'esperar') return null;
    if (a.type !== 'medir' && a.type !== 'intervir') throw new Error(`ação desconhecida: ${a.type}`);
    if (a.type === 'intervir' && config().permission === 'observar') throw new Error('só observar: o Cortex não mexe em ajustes');
    if (!deep()) return { observed: 'interrompido' }; // teste pesado só no profundo (Review Focus 4)
    if (active) throw new Error('já há um teste do Cortex rodando');
    active = { type: a.type, interrupted: false };
    try {
      const o = a.type === 'medir' ? await measure(a.target) : await intervene(a);
      if (o && o.observed !== 'interrompido') spendActive();
      return o;
    } catch (e) {
      if (!active.interrupted) spendActive(); // falhou mesmo assim: o PC trabalhou
      log(a.type, e, 'aviso'); // o motor registra 'falhou'; aqui fica o porquê
      throw e;
    } finally { active = null; }
  }

  // ---------- motor ----------

  const changed = new Set();
  const engine = Engine.createEngine({
    store: memory, map, act, now,
    ctx: () => ({ ...pick(config()), activeToday: activeToday(), deep: deep(), onBattery: !!(deps.onBattery && safe('bateria', deps.onBattery, false)) }),
    onThought: (_text, meta) => { if (meta && meta.inv != null) changed.add(meta.inv); }
  });

  // ---------- o que chega da tela ----------

  /*
   * Fila de anomalias à espera do próximo tique. As que vêm de eventos gravados (lentidão, sessão) sobrevivem a fechar o
   * app: o meta 'cortex.ultima-anomalia' = { id, at } marca o último evento tratado, e o start relê os depois dele.
   */
  const pending = [];
  const queued = new Set(); // ids de evento já na fila
  function enqueue(anomaly, eventId = null) {
    if (eventId != null) { if (queued.has(eventId)) return; queued.add(eventId); }
    pending.push({ anomaly, eventId });
    if (pending.length > QUEUE_MAX) { const old = pending.shift(); if (old.eventId != null) queued.delete(old.eventId); }
  }
  const readMark = () => { try { const m = JSON.parse(memory.getMeta('cortex.ultima-anomalia') || 'null'); return m && finite(m.id) ? m : { id: 0, at: 0 }; } catch (_) { return { id: 0, at: 0 }; } };
  function markDone(eventId, at) {
    const m = readMark();
    if (eventId <= m.id) return;
    if (!memory.setMeta('cortex.ultima-anomalia', JSON.stringify({ id: eventId, at: Math.max(m.at, at) }))) log('fila', 'a marca da fila não gravou');
  }

  /** Anomalias de um evento gravado (o mesmo texto que a tela mandou). */
  function anomaliesOf(kind, at, data, id) {
    if (kind === 'lentidao') {
      const symptom = symptomOfEpisode(data);
      if (!symptom) return [];
      const from = finite(data.start) ? data.start : at - 5 * MIN;
      const to = finite(data.end) ? data.end : at;
      const value = data.kind !== 'throttle' && finite(data.peak) ? data.peak : undefined;
      return [{ kind: 'lentidao', symptom, at: to, window: { from, to }, data: { value, culprit: typeof data.culprit === 'string' ? data.culprit.slice(0, 80) : null, eventId: id } }];
    }
    if (kind === 'sessao') {
      const summary = { verdict: data.verdict, findings: (data.findings || []).map((f) => ({ id: f })) };
      return symptomsOfSession(summary).map((symptom) => ({ kind: 'sessao', symptom, at: data.to, window: { from: data.from, to: data.to }, data: { session: data.id, verdict: data.verdict || null } }));
    }
    return [];
  }
  function queueEvent(id, kind, at, data) {
    if (!(id > 0)) return; // não gravou: não dá para marcar; abre só nesta sessão
    const list = anomaliesOf(kind, at, data, id);
    if (!list.length) { markDone(id, at); return; }
    list.forEach((an, i) => enqueue(an, i === list.length - 1 ? id : null));
  }
  /** Depois de reiniciar: relê os eventos gravados depois da marca e que ainda não abriram nada. */
  function reloadQueue() {
    const m = readMark();
    // Na ordem dos ids (a marca é o maior id tratado: fora de ordem, um evento mais antigo poderia ser pulado).
    const evs = QUEUE_KINDS.flatMap((kind) => memory.events({ kind, from: m.at, limit: 500 })).filter((e) => e.id > m.id && !queued.has(e.id)).sort((a, b) => a.id - b.id);
    for (const e of evs) queueEvent(e.id, e.kind, e.at, e.data || {});
  }

  function observeMinute(m) {
    safe('minuto', () => {
      if (!m || typeof m !== 'object') return;
      const row = { t: Number(m.t) };
      for (const k of ['cpu', 'mem', 'disk', 'gpu', 'temp', 'cpuTemp', 'clock', 'clockRatio']) row[k] = finite(m[k]) ? m[k] : null;
      row.culprit = typeof m.culprit === 'string' ? m.culprit.slice(0, 80) : null;
      memory.addMinute(row);
    }, null);
  }

  /** Eventos de relação: grava os do lab; resultado que contradiz uma relação apoiada reabre a conclusão dela. */
  function noteLab(result) {
    const evs = labMapEvents(result, now());
    for (const ev of evs) {
      if (ev.kind === 'experimento-contra' && map.state(ev.edgeId) === 'apoiada') reopen(ev.edgeId);
      if (!(memory.record('relacao', { data: ev }) > 0)) log('lab-mapa', 'relação do lab não gravou');
    }
    syncMap();
  }

  function reopen(edgeId) {
    for (const c of memory.list('conclusao', { limit: 1000 })) {
      const d = c.data || {};
      if (!d.verdict || d.verdict.status !== 'apoiada' || !(d.events || []).some((e) => e.edgeId === edgeId && e.kind === 'experimento-a-favor')) continue;
      const anomaly = anomalyOf(c.inv);
      if (anomaly) enqueue({ ...anomaly, at: now(), data: { ...(anomaly.data || {}), reaberta: { inv: c.inv, edgeId } } });
    }
  }

  const cleanKind = (k) => (typeof k === 'string' && /^[a-z][a-z-]{0,39}$/.test(k) ? k : null);
  function observeEvent(e) {
    safe('evento', () => {
      const kind = e && cleanKind(e.kind);
      if (!kind) return;
      const at = finite(Number(e.at)) ? Number(e.at) : now();
      let data = e.data && typeof e.data === 'object' ? e.data : {};
      if (JSON.stringify(data).length > 64 * 1024) data = { truncado: true };
      const id = memory.addEvent({ kind, at, data });
      if (id < 0) log('evento', 'evento não gravou');
      if (kind === 'lentidao') {
        if (id > 0) queueEvent(id, kind, at, data);
        else anomaliesOf(kind, at, data, null).forEach((an) => enqueue(an));
      } else if (kind === 'lab') noteLab(data); // um resultado do lab não abre investigação
    }, null);
  }

  function observeSession(s) {
    safe('sessao', () => {
      if (!s || typeof s !== 'object') return;
      const id = String(s.id || '').slice(0, 80);
      if (!id) return;
      const summary = s.summary && typeof s.summary === 'object' ? s.summary : {};
      if (Array.isArray(s.samples) && s.samples.length) memory.camera.put(id, s.samples.slice(0, 20000));
      const meta = summary.meta || {};
      const to = finite(meta.endedAt) ? meta.endedAt : now();
      const from = finite(meta.startedAt) ? meta.startedAt : to - 5 * MIN;
      const b = summary.bottleneck || {};
      const data = { id, from, to, name: typeof meta.name === 'string' ? meta.name.slice(0, 80) : null, verdict: b.verdict || summary.verdict || null,
        findings: (Array.isArray(summary.findings) ? summary.findings : []).map((f) => f && f.id).filter((x) => typeof x === 'string').slice(0, 20), fps: summary.fps && typeof summary.fps === 'object' ? { avg: summary.fps.avgFps ?? null, p1Low: summary.fps.p1LowFps ?? null } : null };
      const eventId = memory.addEvent({ kind: 'sessao', at: to, data });
      if (eventId > 0) queueEvent(eventId, 'sessao', to, data);
      else { log('sessao', 'resumo da sessão não gravou'); anomaliesOf('sessao', to, data, null).forEach((an) => enqueue(an)); }
    }, null);
  }

  function importLegacy(data) {
    return safe('importar', () => {
      const d = data && typeof data === 'object' ? data : {};
      return memory.importLegacy({ history: Array.isArray(d.history) ? d.history.slice(-20000) : [], brain: d.brain && typeof d.brain === 'object' ? d.brain : null });
    }, { imported: 0 });
  }

  // ---------- ritmo ----------

  let lastRhythm = { state: rhythm.state(), reason: 'começando no ritmo leve', at: now() };
  safe('ritmo', () => memory.setFlushMs(FLUSH_MS.leve), null);

  let lastGame = { value: null, at: -Infinity };
  let leveBackoffUntil = 0;
  async function checkRhythm() {
    try {
      const idle = Number(await idleSec());
      const validIdle = Number.isFinite(idle) && idle >= 0;
      // Com a pessoa usando o PC (leve e pouco parado) nem consulta o primeiro plano: o ritmo fica leve de todo jeito.
      let game = false;
      if (!deep() && !(validIdle && idle >= ENTER_IDLE_SEC)) leveBackoffUntil = 0; // a pessoa mexeu: zera a espera
      const parked = !deep() && validIdle && idle >= ENTER_IDLE_SEC;
      const ask = deep() ? now() - lastGame.at >= FG_DEEP_MS : parked && now() >= leveBackoffUntil;
      if (ask) {
        try { game = await gameInForeground(); } catch (e) { log('primeiro-plano', e, 'aviso'); game = null; }
        if (game !== true && game !== false) game = null;
        lastGame = { value: game, at: now() };
        if (!deep()) leveBackoffUntil = game === false ? 0 : now() + FG_LEVE_BACKOFF_MS;
      } else if (deep() || parked) game = lastGame.value; // entre consultas, vale a última
      const r = rhythm.check({ idleSec: validIdle ? idle : NaN, gameInForeground: game });
      lastRhythm = { state: r.state, reason: r.reason, at: now() };
      if (r.changed) onRhythmChange(r);
      return r;
    } catch (e) {
      log('ritmo', e);
      return { state: rhythm.state(), changed: false, reason: lastRhythm.reason };
    }
  }

  function onRhythmChange(r) {
    if (r.state === 'leve' && active) {
      active.interrupted = true;
      if (active.type === 'intervir') safe('cancelar', () => deps.labCancel && deps.labCancel(), null);
    }
    safe('ritmo', () => memory.setFlushMs(FLUSH_MS[r.state] || FLUSH_MS.leve), null);
    const step = { type: 'ritmo', state: r.state, reason: r.reason };
    if (!(memory.record('pensamento', { data: { step, text: Narrate.say(step) } }) > 0)) log('ritmo', 'pensamento do ritmo não gravou');
    emit({ rhythm: r.state, reason: r.reason });
    if (r.state === 'profundo' && running) later(() => tick(), 1000); // o trabalho pesado começa já, sem esperar o próximo tique
  }

  // ---------- tique ----------

  let ticking = false;
  const lastStatus = new Map();

  async function daily() {
    const day = today();
    if (memory.getMeta('cortex.correlacoes') !== day) {
      const t = now();
      const rows = memory.minutes({ from: t - MINE_DAYS * DAY, to: t, limit: MINE_DAYS * 1440 });
      const fresh = Relations.mineCorrelations(rows, map.edges());
      const open = new Set(memory.list('investigacao', { limit: 1000 }).filter((r) => !memory.latest('conclusao', { inv: r.id })).map((r) => r.data && r.data.symptom));
      for (const edge of fresh) {
        if (!(memory.record('relacao', { data: { edgeId: edge.id, kind: 'correlacao', at: t, edge } }) > 0)) { log('correlacoes', 'relação nova não gravou'); continue; }
        // Curiosidade: o padrão sem explicação vira pergunta (se já houver uma investigação do sintoma, ela usa o mapa novo).
        if (!open.has(edge.to)) enqueue({ kind: 'curiosidade', symptom: edge.to, at: t, window: { from: t - MINE_DAYS * DAY, to: t }, data: { edgeId: edge.id, lag: edge.lag, r: edge.weight } });
      }
      syncMap();
      memory.setMeta('cortex.correlacoes', day);
    }
    if (memory.getMeta('cortex.manutencao') !== day) {
      await memory.backupDaily();
      memory.camera.prune();
      memory.setMeta('cortex.manutencao', day);
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      if (await busy()) return;
      while (pending.length) {
        const { anomaly: an, eventId } = pending[0];
        const inv = await call('abrir', () => engine.open(an), -1);
        pending.shift();
        if (eventId != null) { queued.delete(eventId); markDone(eventId, an.at || now()); }
        if (inv > 0) changed.add(inv);
        else log('abrir', `investigação de ${an.symptom} não abriu`);
      }
      if (deep()) await call('profundo', daily, null);
      const ids = await call('retomar', () => engine.resume(), []);
      let worked = false; // algum passo andou: a referência espera um tique sem mais nada a fazer
      for (const inv of ids) {
        if (await busy()) break;
        const status = await call('passo', () => engine.step(inv), null);
        if (status && status !== lastStatus.get(inv) && status !== 'falha-gravacao') changed.add(inv);
        if (status === 'falha-gravacao') log('passo', `a memória não gravou um passo (investigação ${inv})`);
        if (status === 'continua') worked = true;
        if (status === 'concluida') lastStatus.delete(inv);
        else if (status) lastStatus.set(inv, status);
      }
      safe('mapa', syncMap, null);
      if (!worked) await call('referencia', buildReference, null);
    } catch (e) {
      log('tique', e);
    } finally {
      ticking = false;
      for (const inv of changed) emit({ inv });
      changed.clear();
    }
  }

  // ---------- leitura para a tela ----------

  function statusOf(inv) {
    const end = memory.latest('conclusao', { inv });
    if (end) return { status: 'concluida', verdict: end.data.verdict };
    const asks = memory.list('pedido', { inv, limit: 1000 });
    const answered = new Set(asks.filter((r) => r.ref != null).map((r) => r.ref));
    const ask = asks.filter((r) => r.ref == null && !answered.has(r.id)).pop();
    if (ask) return { status: 'aguardando', pedido: ask.data.action };
    const exps = memory.list('experimento', { inv, limit: 1000 });
    const resolved = new Set(exps.filter((r) => r.prev != null).map((r) => r.prev));
    if (exps.some((r) => r.data.status === 'esperando' && !resolved.has(r.id))) return { status: 'esperando' };
    return { status: 'aberta' };
  }

  function list({ limit = 50 } = {}) {
    return safe('listar', () => memory.list('investigacao', { limit: Math.max(1, Math.min(500, Number(limit) || 50)) }).reverse().map((r) => {
      const last = memory.latest('pensamento', { inv: r.id });
      return { inv: r.id, at: r.at, symptom: r.data.symptom, kind: (r.data.anomaly && r.data.anomaly.kind) || null, ...statusOf(r.id), pensamento: last ? last.data.text : null };
    }), []);
  }

  function get(inv) {
    return safe('ler', () => {
      const id = Number(inv);
      const head = memory.list('investigacao', { limit: 1000 }).find((r) => r.id === id);
      if (!head) return null;
      const rows = (kind) => memory.list(kind, { inv: id, limit: 500 });
      const crenca = memory.latest('crenca', { inv: id });
      const end = memory.latest('conclusao', { inv: id });
      const need = memory.latest('necessidade', { inv: id });
      return { inv: id, at: head.at, symptom: head.data.symptom, anomaly: head.data.anomaly, ...statusOf(id),
        hipoteses: rows('hipotese').map((r) => r.data), crenca: crenca ? crenca.data.beliefs : null, crencas: rows('crenca').map((r) => ({ at: r.at, beliefs: r.data.beliefs })),
        experimentos: rows('experimento').map((r) => ({ id: r.id, at: r.at, ...r.data })), provas: rows('prova').map((r) => ({ id: r.id, at: r.at, ref: r.ref, ...r.data })),
        pedidos: rows('pedido').map((r) => ({ id: r.id, at: r.at, ref: r.ref, ...r.data })), pensamentos: rows('pensamento').map((r) => ({ at: r.at, text: r.data.text, type: r.data.step && r.data.step.type })),
        necessidade: need ? need.data : null, conclusao: end ? end.data : null };
    }, null);
  }

  function stats() {
    return safe('estatisticas', () => {
      const invs = memory.list('investigacao', { limit: 1000 });
      let abertas = 0; let aguardando = 0; let concluidas = 0;
      for (const r of invs) {
        const s = statusOf(r.id).status;
        if (s === 'concluida') concluidas += 1; else if (s === 'aguardando') aguardando += 1; else abertas += 1;
      }
      return { ativo: true, ritmo: rhythm.state(), motivo: lastRhythm.reason, memoria: { bytes: memory.sizeBytes(), saude: memory.health() },
        investigacoes: { abertas, aguardando, concluidas }, ativosHoje: activeToday(), testando: active ? active.type : null, config: settings() };
    }, { ativo: true, ritmo: rhythm.state(), motivo: lastRhythm.reason, erro: 'não consegui ler a memória agora' });
  }

  const pick = (c) => ({ permission: c.permission, maxRisk: c.maxRisk });
  function settings() { const c = config(); return { permission: c.permission, maxRisk: c.maxRisk, chosen: c.chosen, recommended: c.recommended, iaLocal: c.iaLocal }; }

  /** Escolha da pessoa na tela. A frase só é pedida para subir o teto do "pedir" acima de baixo. */
  function setSettings(patch = {}) {
    return safe('config', () => {
      const p = patch && typeof patch === 'object' ? patch : {};
      const cur = config();
      const permission = PERMISSIONS.includes(p.permission) ? p.permission : cur.permission;
      const maxRisk = permission === 'sozinho' ? 'baixo' : RISKS.includes(p.maxRisk) ? p.maxRisk : cur.permission === 'sozinho' ? 'baixo' : cur.maxRisk;
      const already = cur.chosen && cur.permission === 'pedir' && riskRank(cur.maxRisk) >= riskRank(maxRisk);
      if (permission === 'pedir' && riskRank(maxRisk) > riskRank('baixo') && !already && String(p.consent || '').trim().toUpperCase() !== Lab.CONSENT_PHRASE) {
        return { ok: false, reason: `Para o Cortex pedir ajustes de risco ${maxRisk}, digite "${Lab.CONSENT_PHRASE}".`, settings: settings() };
      }
      const next = { permission, maxRisk, chosen: true };
      if (!(memory.record('ajuste', { data: { origem: 'cortex.config', config: next } }) > 0) || !memory.setMeta('cortex.config', JSON.stringify(next))) {
        log('config', 'a configuração não gravou');
        return { ok: false, reason: 'Não consegui gravar a escolha agora.', settings: settings() };
      }
      stored = next;
      emit({ settings: settings() });
      return { ok: true, settings: settings() };
    }, { ok: false, reason: 'Não consegui gravar a escolha agora.' });
  }

  function answer(inv, yes) {
    return safe('pedido', () => {
      const ok = yes ? engine.approve(Number(inv)) : engine.deny(Number(inv));
      if (ok) emit({ inv: Number(inv) });
      return ok;
    }, false);
  }

  // ---------- abertura e relógios ----------

  const timers = new Set();
  let running = false; // relógios ligados (start com timers)
  function later(fn, ms) {
    if (!running) return;
    const h = setTimeout(() => { timers.delete(h); fn(); }, ms);
    if (h && h.unref) h.unref();
    timers.add(h);
  }
  function loopRhythm() { later(async () => { await checkRhythm(); loopRhythm(); }, RHYTHM_MS[rhythm.state()] || RHYTHM_MS.leve); }
  function loopTick() { later(async () => { await tick(); loopTick(); }, TICK_MS[rhythm.state()] || TICK_MS.leve); }

  async function start({ snapshot, version, timers: withTimers = true } = {}) {
    safe('fila', reloadQueue, null);
    if (typeof snapshot === 'function') {
      await call('maquina', async () => { const s = await snapshot(); if (s) memory.addMachine(machineOf(s)); }, null);
    }
    if (typeof version === 'string' && version) {
      safe('versao', () => {
        const before = memory.getMeta('versao');
        if (before === version) return;
        memory.addEvent({ kind: 'atualizacao-nexo', at: now(), data: { de: before, para: version } });
        memory.setMeta('versao', version);
      }, null);
    }
    await call('retomar', () => engine.resume(), []);
    if (withTimers && !running) { running = true; loopRhythm(); loopTick(); }
  }

  /** O lab, o benchmark ou a análise profunda da pessoa vão começar: corta o teste do Cortex (não vira prova). */
  function cancelActive() {
    if (!active) return false;
    active.interrupted = true;
    if (active.type === 'intervir') safe('cancelar', () => deps.labCancel && deps.labCancel(), null);
    return true;
  }

  function stop() {
    running = false;
    for (const h of timers) clearTimeout(h);
    timers.clear();
    if (active) { active.interrupted = true; if (active.type === 'intervir') safe('cancelar', () => deps.labCancel && deps.labCancel(), null); }
  }

  return {
    ativo: true,
    observeMinute, observeEvent, observeSession, importLegacy, tick, checkRhythm, start, stop, cancelActive,
    settings, setSettings, approve: (inv) => answer(inv, true), deny: (inv) => answer(inv, false), list, get, stats,
    rhythm: () => ({ state: rhythm.state(), reason: lastRhythm.reason, at: lastRhythm.at, testando: active ? active.type : null }),
    /** Só para os testes: a ação que o motor recebe. */
    _act: act
  };
}

/** Cortex desligado (a memória não abriu): tudo responde, nada acontece. */
function disabled(reason) {
  const nothing = () => undefined;
  return {
    ativo: false,
    observeMinute: nothing, observeEvent: nothing, observeSession: nothing, importLegacy: () => ({ imported: 0 }),
    tick: async () => {}, checkRhythm: async () => ({ state: 'leve', changed: false, reason: 'Cortex desligado' }), start: async () => {}, stop: nothing, cancelActive: () => false,
    settings: () => ({ ...DEFAULT_CONFIG }), setSettings: () => ({ ok: false, reason: 'O Cortex está desligado: a memória dele não abriu.' }),
    approve: () => false, deny: () => false, list: () => [], get: () => null,
    stats: () => ({ ativo: false, motivo: String(reason || 'memória indisponível') }),
    rhythm: () => ({ state: 'leve', reason: 'Cortex desligado', at: null, testando: null }),
    _act: async () => null
  };
}

module.exports = { createCortex, symptomOfEpisode, symptomsOfSession, machineOf, labOutcome, labMapEvents };
