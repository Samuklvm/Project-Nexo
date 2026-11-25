/*
 * Arte da página do Cortex (assets/arte/cortex/): o que o scripts/arte-cortex.cjs gera e o que a tela usa.
 * Cópias pequenas de arte de terceiros (não cobertas pela GPL-3.0): manifesto papel → arquivo, teto de 3 MB, nada de
 * logos, títulos ou nomes de jogo, e o aviso de direitos ao lado. A página funciona sem nenhum desses arquivos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'assets', 'arte', 'cortex');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const manifest = () => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
// Logos, títulos/wordmarks e símbolos do jogo não entram (nem como origem).
const FORBIDDEN = /title(?!_fleur)|logo|hunter_symbol|wordmark/i;
// O que vai no app não diz de onde veio cada peça (nomes de personagem, de jogo ou de região, caminhos dos originais):
// isso fica só nos scripts (scripts/ não vai no instalador).
const ORIGIN_NAMES = /Hornet|Silksong|Hollow Knight|Team Cherry|Pharloom|Songclave|Whispering|Fleurs|Achievements|Architecture|\.png/i;

test('manifesto: cada papel aponta para um webp que existe, com quadros e fps quando é animado', () => {
  const m = manifest();
  const roles = Object.entries(m.papeis);
  assert.ok(roles.length >= 20, `papéis: ${roles.length}`);
  for (const [role, entry] of roles) {
    assert.match(role, /^[a-z0-9_-]+$/, role);
    assert.match(entry.arquivo, /^[a-z0-9_-]+\.webp$/, `${role}: ${entry.arquivo}`);
    const file = path.join(dir, entry.arquivo);
    assert.ok(fs.existsSync(file), `${role}: ${entry.arquivo} não existe`);
    const head = fs.readFileSync(file).subarray(0, 12);
    assert.equal(head.subarray(0, 4).toString('latin1'), 'RIFF', entry.arquivo);
    assert.equal(head.subarray(8, 12).toString('latin1'), 'WEBP', entry.arquivo);
    assert.ok(Number.isInteger(entry.largura) && Number.isInteger(entry.altura), `${role}: tamanho`);
    if (entry.quadros !== undefined) {
      assert.ok(Number.isInteger(entry.quadros) && entry.quadros >= 2, `${role}: quadros`);
      assert.ok(entry.fps > 0 && entry.fps <= 30, `${role}: fps (o relógio único vai a 30)`);
    }
    assert.equal(entry.origem, undefined, `${role}: a origem fica só no script`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'), ORIGIN_NAMES, 'manifest.json diz de onde veio a arte');
  // Papéis que a curadoria pede.
  for (const role of ['titulo-topo', 'titulo-base', 'divisor', 'divisor-fino', 'canto', 'moldura-topo', 'moldura-base', 'aviso', 'cursor',
    'pensando', 'ritmo-profundo', 'medalhao-aberta', 'medalhao-aguardando', 'medalhao-concluida',
    'bestiario-temp_cpu', 'bestiario-gpu', 'bestiario-disk', 'bestiario-mem', 'bestiario-programa_pesado', 'bestiario-cpu',
    'bestiario-ajuste', 'bestiario-rotina', 'bestiario-desconhecida',
    'poeira-luz', 'poeira-voo', 'nevoa', 'vagalume', 'cinza', 'pluma', 'mandala', 'faisca', 'clarao', 'anel', 'brilho']) {
    assert.ok(m.papeis[role], `falta o papel ${role}`);
  }
});

test('pasta da arte: só o que o manifesto lista (e a pasta do cenário), sem nomes proibidos, no máximo 12 MB', () => {
  const m = manifest();
  const listed = new Set(Object.values(m.papeis).map((e) => e.arquivo));
  const sizeOf = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((sum, n) => sum + sizeOf(path.join(p, n)), 0) : fs.statSync(p).size);
  for (const name of fs.readdirSync(dir)) {
    assert.doesNotMatch(name, FORBIDDEN, name);
    if (name === 'manifest.json' || name === '.gitkeep' || name === 'cenario') continue;
    assert.ok(listed.has(name), `${name} não está no manifesto`);
  }
  const total = sizeOf(dir);
  assert.ok(total <= 12 * 1024 * 1024, `assets/arte/cortex tem ${(total / 1048576).toFixed(2)} MB`);
  // Os originais (assets/artes/, no main) ficam fora do instalador, e nada do que o app carrega aponta para eles.
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('!assets/artes/**'), 'build.files precisa de "!assets/artes/**"');
  const texts = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((n) => texts(path.join(p, n))) : /\.(json|md|txt|css|js)$/.test(p) ? [p] : []);
  for (const file of texts(dir)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /assets\/artes/, `${path.relative(root, file)} aponta para assets/artes`);
});

test('cenário: cena.json (no app) só tem as camadas; a composição com as peças fica em scripts/cenario-cortex.json; no máximo 10 MB', () => {
  const sceneDir = path.join(dir, 'cenario');
  const cena = JSON.parse(fs.readFileSync(path.join(sceneDir, 'cena.json'), 'utf8'));
  const comp = JSON.parse(read('scripts/cenario-cortex.json'));
  assert.equal(cena.largura, 2400);
  assert.equal(cena.altura, 1350);
  assert.ok(cena.camadas.length >= 5, 'pelo menos 5 camadas');
  assert.doesNotMatch(fs.readFileSync(path.join(sceneDir, 'cena.json'), 'utf8'), ORIGIN_NAMES, 'cena.json diz de onde veio a arte');
  assert.deepEqual(cena.camadas.map((l) => [l.id, l.arquivo, l.profundidade]), comp.camadas.map((l) => [l.id, l.arquivo, l.profundidade]), 'cena.json e a composição do script descrevem as mesmas camadas');
  let last = -1;
  const files = new Set(['cena.json']);
  for (const layer of cena.camadas) {
    assert.match(layer.id, /^[a-z]+$/);
    assert.deepEqual(Object.keys(layer).filter((k) => !['id', 'arquivo', 'profundidade', 'recorte'].includes(k)), [], `${layer.id}: só id, arquivo, profundidade e recorte`);
    assert.ok(layer.profundidade >= 0 && layer.profundidade <= 1, `${layer.id}: profundidade`);
    assert.ok(layer.profundidade >= last, `${layer.id}: camadas em ordem, do fundo para a frente`);
    last = layer.profundidade;
    const file = path.join(sceneDir, layer.arquivo);
    assert.ok(fs.existsSync(file), `${layer.arquivo} não existe`);
    assert.equal(fs.readFileSync(file).subarray(8, 12).toString('latin1'), 'WEBP', layer.arquivo);
    files.add(layer.arquivo);
  }
  for (const layer of comp.camadas) {
    for (const piece of layer.pecas || []) {
      assert.match(piece.peca, /^[^/]+\/[^/]+\.png$/, `${layer.id}: peça ${piece.peca}`);
      assert.doesNotMatch(piece.peca, FORBIDDEN, piece.peca);
    }
  }
  for (const id of ['ceu', 'fundo', 'meio', 'perto', 'frente', 'globo', 'luzes']) assert.ok(cena.camadas.some((l) => l.id === id), `falta a camada ${id}`);
  let total = 0;
  for (const name of fs.readdirSync(sceneDir)) {
    assert.ok(files.has(name), `${name} não está na cena`);
    total += fs.statSync(path.join(sceneDir, name)).size;
  }
  assert.ok(total <= 10 * 1024 * 1024, `cenário com ${(total / 1048576).toFixed(2)} MB`);
});

test('aviso de direitos: LEIA-ME em português e inglês, fora da GPL-3.0, e a mesma entrada nos avisos de terceiros', () => {
  const readme = read('assets/arte/LEIA-ME.md');
  assert.match(readme, /\*\*PT\*\*/);
  assert.match(readme, /\*\*EN\*\*/);
  assert.match(readme, /\*\*não\*\* são distribuídas sob a licença GPL-3\.0/);
  assert.match(readme, /are \*\*not\*\* distributed under the project's GPL-3\.0 license/);
  assert.doesNotMatch(readme, /acordo|agreement|autoriza|permission granted/i, 'sem citar nenhum acordo');
  const notices = read('THIRD-PARTY-NOTICES.md');
  assert.match(notices, /`assets\/arte\/`/);
  assert.match(notices, /não\*\* são distribuídas sob a licença GPL-3\.0/);
  assert.match(read('NOTICE.md'), /assets\/arte\//);
  // A seção do Santuário fala só das peças dele, sem nome de jogo e sem citar acordo nenhum.
  const santuario = notices.slice(notices.indexOf('## Arte do Santuário'), notices.indexOf('\n## ', notices.indexOf('## Arte do Santuário') + 5));
  assert.match(santuario, /só para essas peças do Santuário/);
  assert.doesNotMatch(santuario, /Nada foi tirado|Hollow Knight|Silksong|Team Cherry|acordo|autoriza/i);
});

test('o script que gera a arte existe e não roda no build', () => {
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'arte-cortex.cjs')));
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'cenario-cortex.cjs')));
  const pkg = JSON.parse(read('package.json'));
  for (const [name, cmd] of Object.entries(pkg.scripts)) assert.doesNotMatch(cmd, /arte-cortex|cenario-cortex/, `script "${name}" não pode rodar a arte`);
  assert.ok(!pkg.build.files.some((f) => f.startsWith('scripts')), 'scripts/ fora do instalador');
  assert.ok(!pkg.build.files.some((f) => /^\*\*|^\*$/.test(f)), 'nenhum padrão que pegue scripts/ junto');
  assert.match(read('scripts/cenario-cortex.cjs'), /cenario-cortex\.json/, 'o script lê a composição de scripts/');
});
