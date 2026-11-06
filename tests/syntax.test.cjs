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
