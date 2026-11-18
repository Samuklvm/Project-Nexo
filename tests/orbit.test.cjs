/*
 * Mapa do sistema (src/orbit.js). Erro real do painel (0.11.3, assinatura 45af60c6610a455b): "The major-axis radius
 * provided (-10.05) is negative" — o canvas ainda sem tamanho (tela escondida ou recém-trocada) dava raio negativo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

/** Carrega src/orbit.js num "navegador" mínimo, com o canvas do tamanho pedido. */
function loadOrbit({ width, height, lite = true }) {
  const listeners = {};
  const calls = [];
  const strict = (name) => (...args) => {
    calls.push(name);
    if (name === 'ellipse' && (args[2] < 0 || args[3] < 0)) throw new Error(`IndexSizeError: The major-axis radius provided (${args[2]}) is negative.`);
    if (name === 'arc' && args[2] < 0) throw new Error(`IndexSizeError: The radius provided (${args[2]}) is negative.`);
    if (name === 'createRadialGradient' && (args[2] < 0 || args[5] < 0)) throw new Error('IndexSizeError: negative radius');
    if (name === 'createRadialGradient') return { addColorStop() {} };
    return undefined;
  };
  const context2d = new Proxy({}, { get: (target, key) => (key in target ? target[key] : strict(String(key))), set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = { width: 0, height: 0, getContext: () => context2d, getBoundingClientRect: () => ({ width, height }) };
  const element = { innerHTML: '', querySelector: () => null, style: {} };
  const context = {
    console, Math, Number, String, Object, Array, Set, Map, Promise, Error,
    devicePixelRatio: 1,
    performance: { now: () => 1000 },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ getPropertyValue: () => '#5ad7ff' }),
    MutationObserver: class { observe() {} },
    addEventListener: () => {},
    document: {
      hidden: false, body: {},
      getElementById: (id) => (id === 'orbit-canvas' ? canvas : id === 'orbit-legend' ? element : null),
      querySelector: () => null,
      addEventListener: () => {}
    },
    Nexo: {
      state: { view: 'home', snapshot: { cpuUsage: 30, memoryPercent: 50, primaryDrive: { usedPercent: 40 } } },
      effectsLite: lite,
      charts: { palette: () => ({}) },
      clock: { add: () => {} },
      store: { live: () => [{ gpu: 20 }], hottest: () => 55 },
      isIdle: () => false,
      on: (name, fn) => { (listeners[name] ||= []).push(fn); }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src', 'orbit.js'), 'utf8'), context);
  const emit = (name, value) => (listeners[name] || []).forEach((fn) => fn(value));
  return { emit, calls };
}

test('mapa do sistema: canvas ainda sem tamanho não desenha raio negativo', () => {
  const { emit, calls } = loadOrbit({ width: 0, height: 0 });
  assert.doesNotThrow(() => emit('view', 'home'));
  assert.doesNotThrow(() => emit('snapshot'));
  assert.ok(!calls.includes('ellipse'), 'sem tamanho, não desenha as órbitas');
});

test('mapa do sistema: canvas estreito (menor que a margem) também não quebra', () => {
  const { emit } = loadOrbit({ width: 50, height: 30 });
  assert.doesNotThrow(() => emit('view', 'home'));
});

test('mapa do sistema: com tamanho de verdade, desenha as cinco órbitas', () => {
  const { emit, calls } = loadOrbit({ width: 480, height: 300 });
  emit('view', 'home');
  assert.equal(calls.filter((name) => name === 'ellipse').length, 5);
});
