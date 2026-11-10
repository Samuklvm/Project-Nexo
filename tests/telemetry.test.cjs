/*
 * Telemetria: o resumo do dia que a interface monta (src/telemetry.js), o diagnóstico do processo principal
 * (electron/diag.cjs) e o que o servidor aceita (server/src/validate.js). Confere que nada pessoal entra e que um
 * dia cheio cabe no limite do servidor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createDiag, keyOf } = require('../electron/diag.cjs');

const root = path.join(__dirname, '..');

/** Carrega src/telemetry.js num "navegador" mínimo e devolve o contexto. */
function loadTelemetry({ now = Date.UTC(2026, 10, 6, 15), stored = {} } = {}) {
  const store = new Map(Object.entries(stored));
  const listeners = {};
  let clock = now;
  const timers = [];
  const context = {
    console, JSON, Math, Number, String, Object, Array, Set, Map, Boolean, Promise, Error, Infinity,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } },
    performance: { now: () => clock },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { hidden: false, hasFocus: () => true, documentElement: { style: { getPropertyValue: () => '' } } },
    matchMedia: () => ({ matches: false }),
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    addEventListener: () => {},
    readJSON: (key, fallback) => { try { return store.has(key) ? JSON.parse(store.get(key)) : fallback; } catch { return fallback; } },
    recordActivity: () => {},
    desktopBridge: {},
    NexoFeatures: { forView: (view) => (view === 'home' ? [{ id: 'ultima-limpeza' }] : []), health: () => ({ sources: { power: [3, 1, 400] }, tiles: { 'home.ultima-limpeza': 1, 'home.mem-livre': 0 }, crashed: ['home.quebrado'] }) },
    Nexo: {
      state: { view: 'home' }, keys: { sessions: 'nexo-sessions', autoClean: 'nexo-auto-clean' }, effectsLite: false, liveRate: 'balanced', profile: { id: 'jogos' }, accent: 'aurora',
      on: (name, fn) => { (listeners[name] ||= []).push(fn); }, emit: (name, value) => (listeners[name] || []).forEach((fn) => fn(value)),
      store: { history: () => [], live: () => [{ gpu: 40 }], hottest: () => 60 }, sky: { prefs: () => ({ density: 'muito', fireflies: true }), stats: () => ({ fps: 30 }) },
      journal: { list: () => [] }, libraryStats: () => ({ installed: 3, account: 10, apps: 0, stores: { steam: 12, 'Minha Loja!': 1 } })
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src', 'telemetry.js'), 'utf8'), context);
  return { context, store, setNow: (ms) => { clock = ms; }, tick: () => timers.forEach((fn) => fn()), emit: context.Nexo.emit };
}

test('telemetria (interface): só dias fechados saem, cada um uma vez, com contagens do dia inteiro', () => {
  const day = Date.UTC(2026, 10, 6, 15);
  const t = loadTelemetry({ now: day });
  const T = t.context.Nexo.telemetry;
  t.emit('view', 'analysis'); t.emit('view', 'home'); t.emit('view', 'tela-inventada');
  t.emit('feat-use', { kind: 'acao', view: 'home', id: 'ultima-limpeza' });
  t.emit('feat-use', { kind: 'acao', view: 'home', id: 'nao-existe' });
  t.emit('feat-use', { kind: 'busca', view: 'home' });
  t.emit('telemetry-ui', 'paleta'); t.emit('telemetry-ui', 'coisa-qualquer');
  t.context.window.recordActivity('Análise inteligente', 'C:\\Users\\samue\\segredo');
  t.context.window.recordActivity('Título com dado pessoal', 'x');
  t.emit('snapshot');
  assert.deepEqual([...T.pending()], [], 'hoje ainda não fechou');
  // Mais tarde, no mesmo dia, ainda conta para ele.
  t.setNow(day + 5 * 3600e3);
  t.emit('view', 'analysis');
  t.setNow(day + 24 * 3600e3);
  assert.deepEqual([...T.pending()], ['2026-11-06']);
  const s = T.summary('2026-11-06');
  assert.deepEqual({ ...s.usage.views }, { analysis: 2, home: 1 });
  assert.deepEqual({ ...s.usage.actions }, { 'home.ultima-limpeza': 1 }, 'só ids que existem no registro');
  assert.deepEqual({ ...s.usage.ui }, { acao: 2, busca: 1, paleta: 1 });
  assert.deepEqual({ ...s.features }, { 'analise-inteligente': 1, outro: 1 });
  assert.equal(s.settings.accent, 'aurora');
  assert.equal(s.settings.effects, 'completo');
  assert.equal(s.perf.gpuCompleto, 40);
  const text = JSON.stringify(s);
  for (const bad of ['samue', 'segredo', 'pessoal', 'tela-inventada']) assert.ok(!text.includes(bad), bad);
  T.markSent('2026-11-06');
  assert.deepEqual([...T.pending()], []);
});

test('telemetria (interface): saúde dos recursos entra no dia, sem dado pessoal', () => {
  const t = loadTelemetry();
  t.tick(); // os relógios de 1 e 5 minutos rodam
  const T = t.context.Nexo.telemetry;
  const s = T.today();
  assert.deepEqual([...s.feats.empty], ['home.mem-livre']);
  assert.deepEqual([...s.feats.crashed], ['home.quebrado']);
  assert.deepEqual({ ...s.feats.sources.power }, { ok: 3, fail: 1, ms: 100 });
  assert.deepEqual({ ...s.feats.perView.home }, { seen: 2, empty: 1 });
  assert.equal(s.library.stores['Minha Loja!'], 1, 'a interface manda o que tem; o servidor limpa a chave');
});

test('diagnóstico: canais contados por dia, falhas e tempos, e o arquivo guarda 8 dias', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-diag-'));
  let clock = Date.UTC(2026, 10, 1, 12);
  const diag = createDiag({ fs, path, file: path.join(dir, 'diag.json'), now: () => clock });
  diag.ipc('system:snapshot', 120, true);
  diag.ipc('system:snapshot', 80, true);
  diag.ipc('cloud:telemetry', 300, false);
  diag.count('gpuCaiu');
  const s = diag.summary('2026-11-01');
  assert.deepEqual(s.ipc['system.snapshot'], { n: 2, e: 0, ms: 100, max: 120 });
  assert.deepEqual(s.ipc['cloud.telemetry'], { n: 1, e: 1, ms: 300, max: 300 });
  assert.equal(s.events.gpuCaiu, 1);
  assert.equal(keyOf('9x:y z'), 'c9x.y-z');
  for (let i = 0; i < 10; i++) { clock += 86400000; diag.count('x'); }
  diag.flush();
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'diag.json'), 'utf8'));
  assert.equal(stored.v, 2);
  assert.equal(Object.keys(stored.days).length, 8);
  // Muitos canais: os mais usados e todos os que falharam, sem passar do limite de chaves do servidor.
  for (let i = 0; i < 90; i++) diag.ipc(`canal:${i}`, 5, i % 7 !== 0);
  const big = diag.summary(new Date(clock).toISOString().slice(0, 10));
  assert.ok(Object.keys(big.ipc).length <= 58);
  assert.equal(big.channels, 90);
});

test('telemetria: um dia cheio (tudo no máximo) passa no servidor e cabe no limite', async () => {
  const { cleanTelemetry, LIMITS } = await import('../server/src/validate.js');
  const t = loadTelemetry();
  const s = JSON.parse(JSON.stringify(t.context.Nexo.telemetry.today()));
  const views = ['home', 'analysis', 'hardware', 'maintenance', 'optimize', 'sessions', 'library', 'atlas', 'lab', 'activity', 'settings', 'updates'];
  s.usage.views = Object.fromEntries(views.map((v) => [v, 999]));
  s.usage.viewTime = Object.fromEntries(views.map((v) => [v, 99999]));
  s.usage.actions = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`maintenance.recurso-com-nome-longo-${i}`, 99]));
  s.features = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`recurso-do-app-numero-${i}`, 9]));
  s.feats.empty = Array.from({ length: 40 }, (_, i) => `maintenance.cartao-com-nome-longo-${i}`);
  s.feats.sources = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`fonte${i}`, { ok: 999, fail: 9, ms: 1234 }]));
  s.feats.perView = Object.fromEntries(views.map((v) => [v, { seen: 34, empty: 20 }]));
  const hw = { cpuVendor: 'AMD', cpuModel: 'AMD Ryzen 7 5700G with Radeon Graphics', cores: 16, ramGB: 14, gpuVendor: 'AMD', gpuModels: ['AMD Radeon(TM) Graphics', 'NVIDIA GeForce RTX 4090 Laptop GPU'], osBuild: '10.0.26100', arch: 'x64',
    displays: Array.from({ length: 4 }, () => ({ w: 3840, h: 2160, scale: 1.5, hz: 144 })), drives: { count: 3, totalGB: 912, systemUsedPct: 36 } };
  const diag = { ipc: Object.fromEntries(Array.from({ length: 58 }, (_, i) => [`canal.com-nome-bem-comprido-${i}`, { n: 99999, e: 99, ms: 1234, max: 99999 }])), events: { telaFechou: 1, gpuCaiu: 2, janelaTravou: 3, 'erro.principal': 4 }, channels: 140 };
  const data = { ...s, hw, diag, sensors: { status: 'pronto', source: 'servico', count: 395, devices: 48, cpuTemp: true, gpuTemp: true, storageTemp: true }, system: { locale: 'pt-BR', electron: '45.2.3', channel: 'instalador', autostart: true, tray: true, autoSession: false, onlineCovers: true, uptimeH: 24 } };
  const size = JSON.stringify(data).length;
  const clean = cleanTelemetry(data);
  assert.ok(clean, `recusado com ${size} bytes (limite ${LIMITS.telemetry})`);
  assert.ok(size < LIMITS.telemetry * 0.8, `${size} bytes: perto demais do limite`);
  for (const key of ['usage', 'features', 'app', 'perf', 'health', 'settings', 'library', 'lab', 'feats', 'hw', 'diag', 'sensors', 'system']) if (data[key]) assert.ok(clean[key], `${key} ficou de fora no servidor`);
  assert.equal(clean.library.stores['Minha Loja!'], undefined, 'chave estranha cai no servidor');
});

test('A01: diagnóstico com o fs real persiste e volta depois de reabrir; fs/promises é recusado na hora', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-diag-'));
  const file = path.join(dir, 'sub', 'diag.json');
  const clock = Date.UTC(2026, 10, 10, 12);
  const first = createDiag({ fs, path, file, now: () => clock });
  first.ipc('lab:run', 50, true);
  first.count('janelaTravou');
  assert.equal(first.flush(), true);
  const reopened = createDiag({ fs, path, file, now: () => clock });
  reopened.count('janelaTravou');
  const summary = reopened.summary('2026-11-10');
  assert.equal(summary.events.janelaTravou, 2, 'o contador voltou do disco');
  assert.equal(summary.ipc['lab.run'].n, 1);
  assert.throws(() => createDiag({ fs: fs.promises, path, file }), /síncrona/, 'a composição errada (A01) falha alto em vez de perder tudo em silêncio');
});

test('A06/A15: arquivo do diagnóstico com formato errado não quebra nada; diagnóstico nunca lança', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-diag-'));
  const file = path.join(dir, 'diag.json');
  const clock = Date.UTC(2026, 10, 10, 12);
  for (const content of ['null', '[]', '"texto"', '{"2026-11-10": {}}', '{"2026-11-10": {"ipc": [], "events": null}}', '{"2026-11-10": {"ipc": {"a": [1]}, "events": {"x": "y"}}}', '{"v":2,"days":{"nao-e-dia":{"ipc":{}}}}', '{corte']) {
    fs.writeFileSync(file, content);
    const d = createDiag({ fs, path, file, now: () => clock });
    assert.doesNotThrow(() => { d.ipc('system:snapshot', 10, true); d.count('x'); }, content);
    assert.equal(d.summary('2026-11-10').ipc['system.snapshot'].n, 1, content);
  }
  // Disco cheio na gravação: flush devolve false e quem chamou segue.
  const errors = [];
  const full = createDiag({ fs: { ...fs, writeFileSync: () => { throw Object.assign(new Error('cheio'), { code: 'ENOSPC' }); } }, path, file, now: () => clock, onError: (kind) => errors.push(kind) });
  full.count('y');
  assert.equal(full.flush(), false);
  assert.ok(errors.includes('gravar'));
  assert.ok(errors.includes('ler'), 'o arquivo cortado também aparece');
  assert.equal(full.summary('2026-11-10').events['diag.falhas'], 1, 'a falha do próprio diagnóstico aparece na telemetria');
});
