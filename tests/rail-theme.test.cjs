/*
 * Barra lateral que se mistura com cada página: o mapa página → tema (src/rail-theme.js) cobre toda página do Nexo.go
 * e cai no padrão (o visual de sempre) para o resto; o CSS só define os temas que existem, com a versão do modo Leve.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Rail = require('../src/rail-theme.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const titles = () => {
  const m = read('src/ui-kit.js').match(/const TITLES = \{([^}]+)\}/);
  return [...m[1].matchAll(/(\w+):\s*'/g)].map((x) => x[1]);
};

test('mapa página → tema: cobre todas as páginas do TITLES e o resto cai no padrão', () => {
  const views = titles();
  assert.ok(views.length >= 13, `páginas: ${views.length}`);
  for (const view of views) {
    assert.ok(Object.hasOwn(Rail.BY_VIEW, view), `${view} sem tema no mapa`);
    assert.ok(Rail.THEMES.includes(Rail.themeFor(view)), `${view}: tema desconhecido`);
  }
  for (const view of Object.keys(Rail.BY_VIEW)) assert.ok(views.includes(view), `${view} não é página do app`);
  assert.equal(Rail.themeFor('pagina-que-nao-existe'), 'padrao');
  assert.equal(Rail.themeFor(undefined), 'padrao');
  assert.equal(Rail.themeFor('constructor'), 'padrao', 'só chaves próprias');
  assert.equal(Rail.themeFor('cortex'), 'cortex');
  assert.equal(Rail.themeFor('settings'), 'santuario');
  assert.equal(Rail.themeFor('home'), 'padrao');
});

test('CSS dos temas: cada tema (menos o padrão) tem regra normal e do modo Leve; o padrão não é tocado; troca suave', () => {
  const css = read('theme.css');
  for (const theme of Rail.THEMES) {
    const sel = `body[data-rail-theme="${theme}"]`;
    if (theme === 'padrao') { assert.ok(!css.includes(sel), 'o padrão é o visual de sempre, sem regra própria'); continue; }
    assert.match(css, new RegExp(`body\\[data-rail-theme="${theme}"\\] \\.rail \\{[^}]*--rail-c1:`), `${theme}: cores da barra`);
    assert.match(css, new RegExp(`body\\.lite\\[data-rail-theme="${theme}"\\] \\.rail \\{`), `${theme}: versão do modo Leve`);
  }
  // As cores da barra são propriedades registradas: o degradê muda devagar (≈300 ms) ao trocar de página.
  for (const prop of ['--rail-c1', '--rail-c2', '--rail-edge']) assert.match(css, new RegExp(`@property ${prop} \\{ syntax: '<color>'`), prop);
  assert.match(read('style.css'), /\.rail \{[^}]*transition:[^}]*--rail-c1 0\.3s/);
  assert.match(read('src/ui-kit.js'), /document\.body\.dataset\.railTheme = /);
  const html = read('index.html');
  assert.ok(html.indexOf('src/rail-theme.js') > 0 && html.indexOf('src/rail-theme.js') < html.indexOf('src/ui-kit.js'), 'o mapa carrega antes do ui-kit');
});
