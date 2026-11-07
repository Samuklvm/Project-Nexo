/* Garante que todo script da interface e do processo principal ao menos compila (um erro de sintaxe derruba a tela inteira). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]).filter((src) => !/^https?:/.test(src));

test('index.html carrega scripts que existem', () => {
  assert.ok(scripts.length > 10);
  for (const src of scripts) assert.ok(fs.existsSync(path.join(root, src)), `${src} não existe`);
  const repeated = scripts.filter((src, index) => scripts.indexOf(src) !== index);
  assert.deepEqual(repeated, [], 'script carregado duas vezes');
});

test('módulos da interface vêm antes de quem usa', () => {
  const order = (name) => scripts.indexOf(`src/${name}`);
  assert.ok(order('lab-space.js') < order('lab.js'));
  assert.ok(order('reboot-test.js') < order('view-reboot.js'));
  assert.ok(order('view-reboot.js') < order('view-scan.js'), 'o Raio-X só mostra "Testar com reinício" se a tela do teste já existir');
});

test('todo script da interface compila', () => {
  for (const src of scripts) {
    const code = fs.readFileSync(path.join(root, src), 'utf8');
    assert.doesNotThrow(() => new vm.Script(code, { filename: src }), `${src} tem erro de sintaxe`);
  }
});

test('o processo principal e os módulos compilam', () => {
  const files = ['main.cjs', 'preload.cjs', ...fs.readdirSync(path.join(root, 'electron')).filter((name) => name.endsWith('.cjs')).map((name) => `electron/${name}`)];
  for (const file of files) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(`(function (exports, require, module, __filename, __dirname) {${code}\n})`, { filename: file }), `${file} tem erro de sintaxe`);
  }
});

test('saída do console do Windows: UTF-8 ou CP850, sem "�"', () => {
  const { decodeConsole } = require('../electron/console-text.cjs');
  assert.equal(decodeConsole(Buffer.from([0x4d, 0xa0, 0x78, 0x69, 0x6d, 0x6f])), 'Máximo');
  assert.equal(decodeConsole(Buffer.from('Econômico', 'utf8')), 'Econômico');
  assert.equal(decodeConsole(Buffer.from([0x87, 0xc6, 0x6f])), 'ção');
});

test('telemetria: todo título de atividade está na lista fixa de recursos (o resto vira "outro")', () => {
  const cloud = fs.readFileSync(path.join(root, 'src', 'telemetry.js'), 'utf8');
  const list = cloud.match(/const FEATURES = new Set\(\[([^\]]+)\]\)/);
  assert.ok(list, 'lista FEATURES em src/telemetry.js');
  const features = new Set([...list[1].matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]));
  const slug = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 39);
  const titles = new Set();
  for (const file of fs.readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
    for (const match of source.matchAll(/recordActivity\(\s*(?:[^,'"`]*\?\s*)?'([^']+)'(?:\s*:\s*'([^']+)')?/g)) { titles.add(match[1]); if (match[2]) titles.add(match[2]); }
    assert.ok(!/recordActivity\(\s*`/.test(source), `${file}: título de atividade com template (pode levar dado pessoal)`);
  }
  assert.ok(titles.size >= 15);
  for (const title of titles) assert.ok(features.has(slug(title)), `"${title}" falta em FEATURES`);
});

test('instalador: todo arquivo que o index.html carrega entra no pacote', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files;
  const covered = (file) => files.some((pattern) => pattern === file || (pattern.endsWith('/**/*') && file.startsWith(pattern.slice(0, -4))));
  const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((ref) => !/^(https?:|data:|#)/.test(ref));
  assert.ok(refs.length > 30);
  for (const ref of refs) assert.ok(covered(ref), `${ref} não está em build.files do package.json (ficaria fora do instalador)`);
});

test('animações: nada decorativo roda em loop de CSS (tudo anda no relógio único, a 30 quadros)', () => {
  // Animação de CSS infinita roda na taxa do monitor (até 144 Hz) e faz a placa de vídeo refazer o desfoque dos
  // painéis de vidro a cada quadro. Só ficam as que aparecem em estados curtos: carregando, gravando, sessão de risco,
  // janela de novidades e o céu de estado vazio.
  const allowed = new Set(['spin', 'shimmer', 'twinkle', 'recpulse', 'riskPulse', 'nvTwinkle', 'nvFloat']);
  for (const file of ['style.css', 'theme.css']) {
    const css = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of css.matchAll(/animation:\s*([A-Za-z-]+)[^;}]*\binfinite\b/g)) assert.ok(allowed.has(match[1]), `${file}: "${match[1]}" em loop infinito`);
  }
});
