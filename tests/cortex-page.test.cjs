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
  const sceneFiles = new Set(JSON.parse(read('assets/arte/cortex/cenario/cena.json')).camadas.map((l) => l.arquivo));
  for (const [, file] of view.matchAll(/'([a-z0-9_-]+\.webp)'/g)) assert.ok(files.has(file) || sceneFiles.has(file), `${file} não está no manifesto nem na cena`);
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

test('primeira escolha: a escolha é relida depois de carregar a arte, logo antes de mostrar', () => {
  const view = read('src/view-cortex.js');
  const body = view.slice(view.indexOf('async function firstRun()'), view.indexOf('function showFirst('));
  const art = body.indexOf('await ensureArt()');
  const show = body.indexOf('showFirst(');
  assert.ok(art > 0 && show > art, 'firstRun carrega a arte e depois mostra');
  const between = body.slice(art, show);
  assert.match(between, /cortexSettings\(\)/, 'relê a configuração depois da espera pela arte');
  assert.match(between, /Page\.canShowFirst\(\{[^}]*settings: fresh/, 'a última conferência usa a leitura nova');
  assert.match(body.slice(show), /^showFirst\(Page\.firstRun\(fresh\), fresh\)/, 'a janela abre com a leitura nova');
});

test('paralaxe: deslocamento proporcional à profundidade, com teto, e parado com menos movimento', () => {
  const frente = Page.parallax({ depth: 1, pointer: { x: 1, y: 1 }, scroll: 0, max: 30 });
  assert.equal(frente.x, -30, 'a frente vai para o lado contrário do mouse, no máximo 30 px');
  assert.ok(frente.y < 0 && frente.y >= -30);
  const fundo = Page.parallax({ depth: 0.1, pointer: { x: 1, y: 0 }, scroll: 0, max: 30 });
  assert.ok(Math.abs(fundo.x) < Math.abs(frente.x) / 5, 'o fundo quase não mexe');
  const longe = Page.parallax({ depth: 1, pointer: { x: 9, y: -9 }, scroll: 0, max: 30 });
  assert.equal(longe.x, -30, 'ponteiro fora da janela não passa do teto');
  assert.ok(longe.y <= 30);
  // A rolagem sobe as camadas mais perto mais depressa (mais que o mouse sozinho), com teto próprio.
  const rolou = Page.parallax({ depth: 1, pointer: { x: 0, y: 0 }, scroll: 4000, max: 30, scrollMax: 120 });
  assert.equal(rolou.y, -120);
  assert.ok(Page.parallax({ depth: 0.2, pointer: { x: 0, y: 0 }, scroll: 400, max: 30 }).y > rolou.y);
  assert.deepEqual(Page.parallax({ depth: 1, pointer: { x: 1, y: 1 }, scroll: 900, max: 30, reduced: true }), { x: 0, y: 0 });
  assert.deepEqual(Page.parallax({ depth: 0.5, pointer: null, scroll: 0, max: 30 }), { x: 0, y: 0 });
});

test('cenário: a tela usa as mesmas camadas da cena.json (o CSP não deixa ler o JSON na hora)', () => {
  const view = read('src/view-cortex.js');
  const cena = JSON.parse(read('assets/arte/cortex/cenario/cena.json'));
  const block = view.slice(view.indexOf('const SCENE = ['), view.indexOf('];', view.indexOf('const SCENE = [')));
  for (const layer of cena.camadas) {
    assert.match(block, new RegExp(`id: '${layer.id}', file: '${layer.arquivo.replace('.', '\\.')}', depth: ${layer.profundidade}\\b`), `camada ${layer.id}`);
  }
  assert.equal((block.match(/id: '/g) || []).length, cena.camadas.length);
});

test('vão do coração: pequeno o bastante para a permissão aparecer na primeira tela; o fio nunca sobe para o salão', () => {
  for (const vh of [700, 900, 1080, 1440]) {
    const l = Page.heartLayout(vh);
    assert.ok(l.gap >= 120 && l.gap <= 220, `${vh}: vão ${l.gap}`);
    assert.ok(l.globe > 0 && l.top + l.globe <= l.gap, `${vh}: o globo cabe no vão`);
    // O fio começa abaixo da borda do salão mesmo com o deslocamento máximo para cima (paralaxe do ponteiro).
    const up = Math.abs(Page.parallax({ depth: 0.32, pointer: { x: 0, y: 1 }, scroll: 0, max: 30 }).y);
    assert.ok(l.top + Math.round(l.globe * 0.12) - l.thread - up >= 0, `${vh}: o fio cruzaria o salão`);
    assert.ok(l.thread >= 16, `${vh}: o fio aparece`);
  }
  assert.ok(Page.heartLayout(900).gap <= 140, 'em 1440 × 900 o vão não empurra os cartões para fora da tela');
  // O CSS usa o mesmo tamanho de vão (funciona antes do script) e o fio é limitado ao vão (sem 2400 px).
  const css = read('cortex.css');
  assert.match(css, /\.cx-heart \{ position: relative; z-index: -1; display: block; height: clamp\(120px, 15vh, 220px\); \}/);
  assert.doesNotMatch(css, /\.cx-globe-silk \{[^}]*height: 2400px/);
  // A barra do topo fica acima do cenário fixo.
  assert.match(css, /body\[data-view="cortex"\] \.titlebar \{ position: relative; z-index: 2; \}/);
});

test('selo de estado: Ativo (verde) quando o Cortex está ativo; Desligado (vermelho) desligado, sem leitura ou com erro', () => {
  assert.deepEqual(Page.seal({ ativo: true }), { label: 'Ativo', tone: 'on' });
  assert.deepEqual(Page.seal({ ativo: false, motivo: 'memória' }), { label: 'Desligado', tone: 'off' });
  assert.deepEqual(Page.seal(null), { label: 'Desligado', tone: 'off' }, 'sem leitura não é "ativo"');
  assert.deepEqual(Page.seal({ ativo: true }, 'Não consegui ler o Cortex agora.'), { label: 'Desligado', tone: 'off' });
  // Cores no CSS: verde musgo luminoso (não neon) e seda; contraste do texto do selo ≥ 4,5:1 sobre o fundo do selo.
  const css = read('cortex.css');
  const color = (re) => { const m = css.match(re); assert.ok(m, String(re)); return m[1]; };
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bg = '#0d0b11'; // fundo do selo (tinta) sobre o salão
  const on = color(/\.cx-seal\.on \{[^}]*color: (#[0-9a-f]{6})/);
  const off = color(/\.cx-seal\.off \{[^}]*color: (#[0-9a-f]{6})/);
  assert.ok(ratio(on, bg) >= 4.5, `verde ${on}: ${ratio(on, bg).toFixed(2)}`);
  assert.ok(ratio(off, bg) >= 4.5, `vermelho ${off}: ${ratio(off, bg).toFixed(2)}`);
  assert.match(css, /\.cx-seal\.on::before \{[^}]*background: #5fbf8a/);
  assert.match(css, /\.cx-seal\.off::before \{[^}]*background: var\(--silk-hi\)/);
});
