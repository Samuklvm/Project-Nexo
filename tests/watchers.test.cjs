/*
 * Vigias da interface (src/watchers.js): coisas que funcionam, mas errado, viram AVISOS (nunca erros), uma vez por
 * abertura. Spec: docs/superpowers/specs/2026-11-18-vigias-de-erro-design.md
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/watchers.js');

const MIN = 60000;
const snap = (extra = {}) => ({ cpuUsage: 30, memoryPercent: 60, memoryTotalBytes: 16e9, primaryDrive: { usedPercent: 50 }, temperatureReadings: { acpiSensors: [{ celsius: 45 }], gpuSensors: [{ temperatureCelsius: 60, usagePercent: 20 }] }, ...extra });

test('leitura impossível: limites exatos (100 % e 125 °C valem; acima, não) e sem sensor não conta', () => {
  assert.deepEqual(W.checkReading(snap()), []);
  assert.deepEqual(W.checkReading(snap({ cpuUsage: 100, memoryPercent: 0 })), []);
  assert.deepEqual(W.checkReading(snap({ cpuUsage: 100.5 })), [{ campo: 'cpu', valor: 100.5 }]);
  assert.deepEqual(W.checkReading(snap({ memoryPercent: -1 })), [{ campo: 'memoria', valor: -1 }]);
  assert.deepEqual(W.checkReading(snap({ cpuUsage: Number.NaN })), [{ campo: 'cpu', valor: 'NaN' }]);
  assert.deepEqual(W.checkReading(snap({ primaryDrive: { usedPercent: 140 } })), [{ campo: 'disco', valor: 140 }]);
  assert.deepEqual(W.checkReading(snap({ primaryDrive: null, cpuUsage: null })), [], 'sem dado não é leitura impossível');
  assert.deepEqual(W.checkReading(snap({ temperatureReadings: { acpiSensors: [{ celsius: 125 }, { celsius: -10 }], gpuSensors: [] } })), []);
  assert.deepEqual(W.checkReading(snap({ temperatureReadings: { acpiSensors: [{ celsius: 126 }, { celsius: null }], gpuSensors: [{ temperatureCelsius: -11 }] } })), [{ campo: 'temperatura', valor: 126 }, { campo: 'temperatura-video', valor: -11 }]);
  assert.deepEqual(W.checkReading(snap({ temperatureReadings: { gpuSensors: [{ temperatureCelsius: 50, usagePercent: 255 }] } })), [{ campo: 'video', valor: 255 }]);
  assert.deepEqual(W.checkReading(snap({ memoryTotalBytes: 0 })), [{ campo: 'memoria-total', valor: 0 }]);
  assert.deepEqual(W.checkReading(null), []);
  assert.deepEqual(W.checkReading(snap({ cpuUsage: 33.333 })).length, 0);
  assert.deepEqual(W.checkReading(snap({ cpuUsage: 133.333 })), [{ campo: 'cpu', valor: 133.3 }], 'valor arredondado');
});

test('sensores sumiram: só depois de 5 min seguidos sem temperatura, e só se funcionavam nesta abertura', () => {
  const never = {};
  assert.equal(W.sensorsGone(never, false, 0), false);
  assert.equal(W.sensorsGone(never, false, 10 * MIN), false, 'PC sem sensor nunca dispara');
  const state = {};
  assert.equal(W.sensorsGone(state, true, 0), false);
  assert.equal(W.sensorsGone(state, false, 1 * MIN), false);
  assert.equal(W.sensorsGone(state, false, 5 * MIN), false, '4 min sem');
  assert.equal(W.sensorsGone(state, false, 6 * MIN), true, '5 min sem');
  assert.equal(W.sensorsGone(state, true, 7 * MIN), false, 'voltou');
  assert.equal(W.sensorsGone(state, false, 8 * MIN), false);
  assert.equal(W.sensorsGone(state, null, 12 * MIN), false, 'janela sem foco: não conta (o coletor pausa)');
  assert.equal(W.sensorsGone(state, false, 13 * MIN), false, 'recomeça a contar depois do foco');
});

test('abertura lenta: acima de 12 s', () => {
  assert.equal(W.slowStart(12000), false);
  assert.equal(W.slowStart(12100), true);
  assert.equal(W.slowStart(Number.NaN), false);
});

test('céu lento: abaixo de 12 quadros/s por 1 min, com foco, efeitos completos e na tela inicial', () => {
  const on = { fps: 8, focused: true, full: true, home: true };
  const state = {};
  assert.equal(W.skySlow(state, on, 0), false);
  assert.equal(W.skySlow(state, on, 50000), false);
  assert.equal(W.skySlow(state, on, 60000), true);
  const other = {};
  W.skySlow(other, on, 0);
  assert.equal(W.skySlow(other, { ...on, focused: false }, 30000), false);
  assert.equal(W.skySlow(other, on, 70000), false, 'sem foco zera a conta');
  assert.equal(W.skySlow({}, { ...on, fps: 12 }, 0), false);
  const lite = {};
  W.skySlow(lite, { ...on, full: false }, 0);
  assert.equal(W.skySlow(lite, { ...on, full: false }, 120000), false, 'modo leve não conta');
});

test('fonte falhando: 3 falhas seguidas ou mais de 20 s; um acerto zera', () => {
  const state = {};
  assert.equal(W.sourceTrouble(state, 'processes', false, 100), null);
  assert.equal(W.sourceTrouble(state, 'processes', false, 100), null);
  assert.equal(W.sourceTrouble(state, 'processes', true, 100), null, 'acertou: zera');
  assert.equal(W.sourceTrouble(state, 'processes', false, 100), null);
  assert.equal(W.sourceTrouble(state, 'processes', false, 100), null);
  assert.deepEqual(W.sourceTrouble(state, 'processes', false, 100), { motivo: 'falhando', vezes: 3 });
  assert.deepEqual(W.sourceTrouble({}, 'drives', true, 20001), { motivo: 'lenta', segundos: 20 });
  assert.equal(W.sourceTrouble({}, 'drives', true, 20000), null);
});

/** Instala os vigias num "navegador" de mentira e devolve o que eles mandaram. */
function installFake({ hasFocus = true } = {}) {
  const listeners = {};
  const sent = [];
  const intervals = [];
  let now = 1000;
  const Nexo = {
    state: { view: 'home' }, effectsLite: false,
    on: (name, fn) => { (listeners[name] ||= []).push(fn); },
    sky: { stats: () => ({ fps: 5 }) },
    isIdle: () => false
  };
  const env = {
    Nexo, bridge: { reportError: (payload) => sent.push(payload) },
    document: { hidden: false, hasFocus: () => hasFocus },
    performance: { now: () => now },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }
  };
  const api = W.install(env);
  return { api, sent, emit: (name, value) => (listeners[name] || []).forEach((fn) => fn(value)), tick: (ms) => { now += ms; }, intervals, Nexo };
}

test('note: manda AVISO com o nome do vigia, uma vez por chave por abertura', () => {
  const { api, sent } = installFake();
  api.note('leitura-impossivel', 'Leitura impossível: cpu', { campo: 'cpu', valor: 101 }, 'leitura:cpu');
  api.note('leitura-impossivel', 'Leitura impossível: cpu', { campo: 'cpu', valor: 140 }, 'leitura:cpu');
  api.note('leitura-impossivel', 'Leitura impossível: memoria', { campo: 'memoria', valor: -2 }, 'leitura:memoria');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].level, 'aviso');
  assert.equal(sent[0].context.vigia, 'leitura-impossivel');
  assert.equal(sent[0].context.tela, 'home');
});

test('ligado na leitura: uma leitura impossível repetida a cada 5 s vira um aviso só, e a primeira leitura lenta avisa', () => {
  const { sent, emit, tick } = installFake();
  tick(13000);
  for (let i = 0; i < 50; i += 1) { emit('snapshot', snap({ cpuUsage: 120 })); tick(5000); }
  const kinds = sent.map((item) => item.context.vigia).sort();
  assert.deepEqual(kinds, ['abertura-lenta', 'leitura-impossivel']);
  assert.equal(sent.find((item) => item.context.vigia === 'abertura-lenta').context.segundos, 14);
});

test('ligado nas fontes: três falhas seguidas da mesma fonte, um aviso com o nome fixo da fonte', () => {
  const { api, sent } = installFake();
  for (let i = 0; i < 6; i += 1) api.sourceResult('processes', false, 120, 'Falhou ao ler');
  assert.equal(sent.length, 1);
  assert.deepEqual({ vigia: sent[0].context.vigia, fonte: sent[0].context.fonte, motivo: sent[0].context.motivo }, { vigia: 'fonte-falhando', fonte: 'processes', motivo: 'falhando' });
});

test('céu lento pelo relógio de 10 s; sem foco, nada', () => {
  const focused = installFake();
  const sky = focused.intervals.find((item) => item.ms === 10000);
  assert.ok(sky, 'confere a cada 10 s');
  for (let i = 0; i < 8; i += 1) { sky.fn(); focused.tick(10000); }
  assert.equal(focused.sent.filter((item) => item.context.vigia === 'ceu-lento').length, 1);
  const away = installFake({ hasFocus: false });
  const sky2 = away.intervals.find((item) => item.ms === 10000);
  for (let i = 0; i < 8; i += 1) { sky2.fn(); away.tick(10000); }
  assert.equal(away.sent.length, 0);
});

test('nenhum vigia põe texto livre no contexto: só números e nomes fixos curtos', () => {
  const { api, sent, emit, tick } = installFake();
  tick(20000);
  emit('snapshot', snap({ cpuUsage: 120, temperatureReadings: { acpiSensors: [{ celsius: 300 }] } }));
  for (let i = 0; i < 3; i += 1) api.sourceResult('drives', false, 50, 'C:\\Users\\Samuel\\Desktop\\x falhou');
  for (const item of sent) {
    for (const [key, value] of Object.entries(item.context)) {
      if (key === 'erro') continue; // a mensagem da falha passa pela limpeza do registro (pasta e usuário saem)
      assert.ok(typeof value === 'number' || (typeof value === 'string' && /^[a-z0-9.-]{1,40}$/i.test(value)) || value === null, `${item.context.vigia}.${key} = ${value}`);
    }
  }
});

test('um vigia que quebra não derruba nada', () => {
  const { emit } = installFake();
  assert.doesNotThrow(() => emit('snapshot', { get cpuUsage() { throw new Error('boom'); } }));
});

test('ligações: index.html carrega os vigias depois do core.js; as fontes dos cartões avisam; os avisos antigos têm nome de vigia', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const html = read('index.html');
  assert.ok(html.indexOf('src="src/watchers.js"') > html.indexOf('src="src/core.js"'), 'depois do core.js (precisa do Nexo)');
  assert.ok(html.indexOf('src="src/watchers.js"') < html.indexOf('src="src/store.js"'), 'antes do store.js e do features.js');
  const features = read('src/features.js');
  assert.equal((features.match(/Nexo\.watchers\?\.sourceResult\(name, (true|false),/g) || []).length, 2, 'acerto e falha');
  const core = read('src/core.js');
  for (const vigia of ['arquivo-nao-carregou', 'console-aviso', 'tela-travada', 'memoria-da-tela']) assert.ok(core.includes(`vigia: '${vigia}'`), vigia);
});

test('textos públicos: os relatórios de erro agora levam os avisos dos vigias (PT e EN), e nada diz que eles ficam só no PC', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const pt = read('PRIVACIDADE.md');
  const en = read('PRIVACY.md');
  assert.doesNotMatch(pt, /não os avisos|Avisos \(o que não chega a ser erro\) ficam só no PC/);
  assert.doesNotMatch(en, /not warnings|Warnings \(things that are not errors\) stay on the PC/);
  assert.match(pt, /### Vigias de erro/);
  assert.match(en, /### Error watchers/);
  for (const vigia of ['leitura impossível', 'sensores', 'memória']) assert.ok(pt.toLowerCase().includes(vigia), `PT: ${vigia}`);
  assert.doesNotMatch(read('index.html'), /Os erros do registro abaixo \(não os avisos\)/);
  assert.match(read('index.html'), /Os erros e os avisos do registro abaixo/);
  const nsh = read('installer/installer.nsh');
  assert.match(nsh, /os erros e os avisos do registro do app/);
  assert.match(nsh, /the errors and warnings in the app log/);
  assert.match(read('installer-launcher/index.html'), /os erros, os avisos e os últimos passos do app/);
  assert.match(read('installer-launcher/renderer.js'), /the errors, warnings and the app's last steps/);
  assert.match(read('src/view-cloud.js'), /Os erros e os avisos do app vão para o criador corrigir/);
  assert.match(read('docs/SERVIDOR.md'), /nexo_vigias/);
});
