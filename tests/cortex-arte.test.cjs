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
    for (const origin of [].concat(entry.origem)) assert.doesNotMatch(origin, FORBIDDEN, `${role}: origem proibida ${origin}`);
  }
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
  // Os originais ficam no main, fora deste ramo e do instalador.
  assert.ok(!fs.existsSync(path.join(root, 'assets', 'artes')), 'assets/artes/ não entra neste ramo');
});

test('cenário: cena.json descreve as camadas (profundidade, peças) e cada arquivo existe; no máximo 10 MB', () => {
  const sceneDir = path.join(dir, 'cenario');
  const cena = JSON.parse(fs.readFileSync(path.join(sceneDir, 'cena.json'), 'utf8'));
  assert.equal(cena.largura, 2400);
  assert.equal(cena.altura, 1350);
  assert.ok(cena.camadas.length >= 5, 'pelo menos 5 camadas');
  let last = -1;
  const files = new Set(['cena.json']);
  for (const layer of cena.camadas) {
    assert.match(layer.id, /^[a-z]+$/);
    assert.ok(layer.profundidade >= 0 && layer.profundidade <= 1, `${layer.id}: profundidade`);
    assert.ok(layer.profundidade >= last, `${layer.id}: camadas em ordem, do fundo para a frente`);
    last = layer.profundidade;
    const file = path.join(sceneDir, layer.arquivo);
    assert.ok(fs.existsSync(file), `${layer.arquivo} não existe`);
    assert.equal(fs.readFileSync(file).subarray(8, 12).toString('latin1'), 'WEBP', layer.arquivo);
    files.add(layer.arquivo);
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
});

test('o script que gera a arte existe e não roda no build', () => {
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'arte-cortex.cjs')));
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'cenario-cortex.cjs')));
  const pkg = JSON.parse(read('package.json'));
  for (const [name, cmd] of Object.entries(pkg.scripts)) assert.doesNotMatch(cmd, /arte-cortex|cenario-cortex/, `script "${name}" não pode rodar a arte`);
  assert.ok(!pkg.build.files.some((f) => f.startsWith('scripts')), 'scripts/ fora do instalador');
});
