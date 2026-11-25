/*
 * Página do Cortex: regras puras (src/cortex/page.js) e a costura da tela (index.html, cortex.css, view-cortex.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Page = require('../src/cortex/page.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const DAY = 86400000;

test('grupos da lista: abertas (inclui esperando), aguardando você, concluídas e não resolvidas', () => {
  assert.equal(Page.group({ status: 'aberta' }), 'abertas');
  assert.equal(Page.group({ status: 'esperando' }), 'abertas');
  assert.equal(Page.group({ status: 'aguardando' }), 'aguardando');
  assert.equal(Page.group({ status: 'concluida', verdict: { status: 'apoiada' } }), 'concluidas');
  assert.equal(Page.group({ status: 'concluida', verdict: { status: 'correlacionada' } }), 'concluidas');
  assert.equal(Page.group({ status: 'concluida', verdict: { status: 'nao-resolvido' } }), 'nao-resolvidas');
  assert.equal(Page.group({}), 'abertas');
});

test('estado de cada hipótese: só o veredito afirma (derrubada só pela lista do veredito, como em beliefs.js)', () => {
  const h = (cause) => ({ key: `${cause}>clock_queda`, cause, symptom: 'clock_queda', prior: 0.3 });
  const done = { conclusao: { verdict: { status: 'apoiada', winner: 'temp_cpu>clock_queda', refuted: ['programa_pesado>clock_queda'] } }, crenca: { 'rotina>clock_queda': 0.02 } };
  assert.equal(Page.hypothesisState(h('temp_cpu'), done), 'apoiada');
  assert.equal(Page.hypothesisState(h('programa_pesado'), done), 'derrubada');
  assert.equal(Page.hypothesisState(h('rotina'), done), 'suspeita', 'crença baixa sem teste que contradiga não é derrubada');
  assert.equal(Page.hypothesisState(h('desconhecida'), done), 'suspeita');
  const corr = { conclusao: { verdict: { status: 'correlacionada', winner: 'temp_cpu>clock_queda', refuted: [] } } };
  assert.equal(Page.hypothesisState(h('temp_cpu'), corr), 'correlacionada');
  assert.equal(Page.hypothesisState(h('temp_cpu'), {}), 'suspeita');
  // Confiança: a da crença, senão a inicial; sempre entre 0 e 1.
  assert.equal(Page.belief(h('rotina'), done), 0.02);
  assert.equal(Page.belief(h('temp_cpu'), {}), 0.3);
  assert.equal(Page.belief({ key: 'x', prior: 7 }, {}), 1);
});

test('criatura de cada causa (diário de causas): ajustes, temperaturas e o que não tem criatura própria', () => {
  assert.equal(Page.creatureOf('temp_cpu'), 'temp_cpu');
  assert.equal(Page.creatureOf('temp'), 'temp_cpu');
  assert.equal(Page.creatureOf('ajuste:aspm'), 'ajuste');
  assert.equal(Page.creatureOf('page_faults'), 'mem');
  assert.equal(Page.creatureOf('clock_queda'), 'cpu');
  assert.equal(Page.creatureOf('rotina'), 'rotina');
  assert.equal(Page.creatureOf('qualquer-coisa'), 'desconhecida');
});

test('diário de causas: cada causa uma vez, com o melhor estado e em quantas investigações apareceu', () => {
  const a = { hipoteses: [{ key: 'temp_cpu>clock_queda', cause: 'temp_cpu' }, { key: 'programa_pesado>clock_queda', cause: 'programa_pesado' }],
    conclusao: { verdict: { status: 'apoiada', winner: 'temp_cpu>clock_queda', refuted: ['programa_pesado>clock_queda'] } } };
  const b = { hipoteses: [{ key: 'temp_cpu>cpu', cause: 'temp_cpu' }, { key: 'disk>travadas', cause: 'disk' }] };
  const list = Page.bestiary([a, b, null]);
  assert.deepEqual(list.map((e) => [e.cause, e.state, e.count]), [['temp_cpu', 'apoiada', 2], ['disk', 'suspeita', 1], ['programa_pesado', 'derrubada', 1]]);
  assert.equal(list[0].creature, 'temp_cpu');
});

test('instrumentos que faltaram: as necessidades de cada investigação, sem repetir', () => {
  const need = { goal: 'separar', between: ['mem>travadas', 'disk>travadas'], reason: 'nada separa as duas', missing: ['disk'], outside: false };
  const list = Page.instruments([{ inv: 2, symptom: 'travadas', necessidade: need }, { inv: 3, necessidade: { ...need } }, { inv: 4, necessidade: null }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].inv, 2);
  assert.deepEqual(list[0].missing, ['disk']);
});

test('frase de consentimento: só para "pedir" com teto acima de baixo que ainda não foi liberado', () => {
  const cur = { permission: 'observar', maxRisk: 'baixo', chosen: false };
  assert.equal(Page.needsPhrase(cur, { permission: 'pedir', maxRisk: 'baixo' }), false);
  assert.equal(Page.needsPhrase(cur, { permission: 'pedir', maxRisk: 'moderado' }), true);
  assert.equal(Page.needsPhrase(cur, { permission: 'pedir', maxRisk: 'alto' }), true);
  assert.equal(Page.needsPhrase(cur, { permission: 'sozinho', maxRisk: 'alto' }), false, 'sozinho é um clique, sempre teto baixo');
  const granted = { permission: 'pedir', maxRisk: 'alto', chosen: true };
  assert.equal(Page.needsPhrase(granted, { permission: 'pedir', maxRisk: 'moderado' }), false);
  assert.equal(Page.needsPhrase({ ...granted, maxRisk: 'moderado' }, { permission: 'pedir', maxRisk: 'alto' }), true);
});

test('primeira escolha: aparece só se ainda não escolheu; o padrão marcado segue o recomendado', () => {
  assert.deepEqual(Page.firstRun({ chosen: false, recommended: 'sozinho' }), { show: true, recommendedOn: true });
  assert.deepEqual(Page.firstRun({ chosen: false, recommended: 'observar' }), { show: true, recommendedOn: false });
  assert.equal(Page.firstRun({ chosen: true, recommended: 'sozinho' }).show, false);
  assert.equal(Page.firstRun(null).show, false);
});

test('pergunta, dias de memória e textos sem "provavelmente"', () => {
  const at = new Date(2026, 10, 24, 14, 12).getTime();
  assert.match(Page.question('cpu', at), /^Por que o processador ficou sobrecarregado em 24\/11, às 14:12\?$/);
  assert.match(Page.question('sinal_novo', at), /“sinal_novo”/);
  assert.equal(Page.memoryDays(null, at), 0);
  assert.equal(Page.memoryDays(at - 10 * 60000, at), 1, 'o primeiro dia já conta');
  assert.equal(Page.memoryDays(at - 9.2 * DAY, at), 10);
  for (const file of ['src/cortex/page.js', 'src/view-cortex.js']) {
    assert.doesNotMatch(read(file), /provavelmente|talvez seja|deve ser|com certeza/i, file);
  }
});

test('costura da tela: botão, página, cartão da Análise, estilo e scripts na ordem certa', () => {
  const html = read('index.html');
  assert.match(html, /<button class="rail-item[^"]*" type="button" data-view="cortex">/);
  assert.match(html, /<section class="view[^"]*" data-view-panel="cortex">/);
  const analysis = html.slice(html.indexOf('data-view-panel="analysis"'), html.indexOf('data-view-panel="sessions"'));
  assert.match(analysis, /id="cortex-teaser"[^>]*data-goto="cortex"|data-goto="cortex"[^>]*id="cortex-teaser"/);
  assert.match(html, /<link rel="stylesheet" href="cortex\.css" \/>/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const at = (s) => scripts.indexOf(s);
  for (const s of ['src/cortex/relations.js', 'src/cortex/narrate.js', 'src/cortex/page.js', 'src/view-cortex.js']) assert.ok(at(s) > 0, s);
  assert.ok(at('src/lab-space.js') < at('src/cortex/relations.js'));
  assert.ok(at('src/cortex/relations.js') < at('src/cortex/narrate.js'));
  assert.ok(at('src/cortex/page.js') < at('src/view-cortex.js'));
  assert.ok(at('src/ui-kit.js') < at('src/view-cortex.js'));
  assert.match(read('src/ui-kit.js'), /cortex: 'Cortex'/, 'Nexo.go conhece a página');
  assert.ok(JSON.parse(read('package.json')).build.files.includes('cortex.css'));
});

test('cortex.css: tudo escopado, sem loop de CSS e só imagens locais', () => {
  const css = read('cortex.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const scope = /^(\[data-view-panel="cortex"\]|\.cx-teaser|\.cx-first|body\[data-view="cortex"\]|body\.lite \[data-view-panel="cortex"\]|body\.lite \.cx-|:root|from|to|\d+%)/;
  // Regras de primeiro nível (fora de @media/@keyframes/@font-face).
  let depth = 0; let buf = '';
  const tops = [];
  for (const ch of css) {
    if (ch === '{') { if (depth === 0) tops.push(buf.trim()); depth += 1; buf = ''; } else if (ch === '}') { depth -= 1; buf = ''; } else if (depth === 0 || ch !== ';') buf += ch;
    if (ch === ';' && depth === 0) buf = '';
  }
  for (const sel of tops) {
    if (sel.startsWith('@')) continue;
    for (const part of sel.split(',')) assert.match(part.trim(), scope, `seletor fora do escopo: ${part.trim()}`);
  }
  assert.doesNotMatch(css, /animation:[^;}]*infinite/, 'nada em loop de CSS: o que se mexe anda no relógio único');
  for (const [, url] of css.matchAll(/url\("?([^")]+)"?\)/g)) assert.match(url, /^(assets\/arte\/cortex\/[a-z0-9_-]+\.webp|data:image\/svg\+xml)/, url);
});

test('view-cortex.js: só papéis do manifesto, nada de nome de jogo na tela e tudo da memória escapado', () => {
  const view = read('src/view-cortex.js');
  const manifest = JSON.parse(read('assets/arte/cortex/manifest.json'));
  const files = new Set(Object.values(manifest.papeis).map((e) => e.arquivo));
  for (const [, file] of view.matchAll(/'([a-z0-9_-]+\.webp)'/g)) assert.ok(files.has(file), `${file} não está no manifesto`);
  const css = read('cortex.css');
  for (const [, file] of css.matchAll(/assets\/arte\/cortex\/([a-z0-9_-]+\.webp)/g)) assert.ok(files.has(file), `cortex.css: ${file} não está no manifesto`);
  for (const text of [view, css, read('index.html')]) assert.doesNotMatch(text, /Hornet|Silksong|Hollow Knight|Team Cherry|Pharloom|Farmer Wisp|Bell Beast|Beastfly|Voltvyrm|Bloatroach|Cogwork|Clover Dancer|Shadow Creeper/);
  assert.match(view, /escapeHtml\(/);
  assert.doesNotMatch(view, / style="/, 'use data-css');
});

test('primeira escolha: só mostra agora com a janela visível, sem outra janela aberta, sem escolha feita e sem já estar aberta', () => {
  const s = { chosen: false, recommended: 'observar' };
  assert.equal(Page.canShowFirst({ hidden: true, modalOpen: false, settings: s, showing: false }), false, 'janela escondida (aberto na bandeja)');
  assert.equal(Page.canShowFirst({ hidden: false, modalOpen: true, settings: s, showing: false }), false, 'outra janela aberta');
  assert.equal(Page.canShowFirst({ hidden: false, modalOpen: false, settings: { ...s, chosen: true }, showing: false }), false, 'já escolheu');
  assert.equal(Page.canShowFirst({ hidden: false, modalOpen: false, settings: null, showing: false }), false, 'sem configuração');
  assert.equal(Page.canShowFirst({ hidden: false, modalOpen: false, settings: s, showing: true }), false, 'nunca duas ao mesmo tempo');
  assert.equal(Page.canShowFirst({ hidden: false, modalOpen: false, settings: s, showing: false }), true);
});

test('primeira escolha: a tela espera sem limite de tentativas (bandeja e janela de perfil demorada)', () => {
  const view = read('src/view-cortex.js');
  const block = view.slice(view.indexOf('Primeira escolha'), view.indexOf('setTimeout(() => firstRun()'));
  assert.match(block, /Page\.canShowFirst\(/);
  assert.doesNotMatch(block, /tries\s*</, 'sem teto de tentativas');
  assert.match(block, /visibilitychange/);
  assert.match(block, /MutationObserver/);
});

test('primeira escolha: fechar sem escolher não reabre na mesma abertura (só na próxima)', () => {
  const view = read('src/view-cortex.js');
  const block = view.slice(view.indexOf('Primeira escolha'), view.indexOf('setTimeout(() => firstRun()'));
  assert.match(block, /const close = \(\) => \{[^}]*firstDone = true/);
  assert.match(block, /showing: firstShowing \|\| firstDone/);
});
