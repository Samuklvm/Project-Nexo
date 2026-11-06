const test = require('node:test');
const assert = require('node:assert/strict');
const Notes = require('../src/release-notes.js');

const HTML = `<h1>Nexo Device Care 0.6.2</h1>
<p><a href="#português">Português</a> · <a href="#english">English</a></p>
<h2>Português</h2>
<p><strong>Sensores e FPS de volta.</strong></p>
<h3>Downloads</h3>
<ul><li><strong>Linux:</strong> <code>Nexo-0.6.2-x86_64.AppImage</code> (Pop!_OS)</li></ul>
<h3>Correções</h3>
<ul><li><strong>Biblioteca:</strong> conteúdo extra &amp; DLC fora; arquivo <code>x86_64</code> intacto.</li></ul>
<hr>
<h2>English</h2>
<h3>Fixes</h3>
<ul><li>Should not appear</li></ul>`;

test('notas da atualização: só português, sem Downloads, sem HTML e sem comer sublinhados', () => {
  const blocks = Notes.parse(HTML);
  assert.deepEqual(blocks.map((block) => block.type), ['text', 'heading', 'item']);
  assert.equal(blocks[1].text, 'Correções');
  assert.equal(blocks[2].text, 'Biblioteca: conteúdo extra & DLC fora; arquivo x86_64 intacto.');
  assert.ok(blocks.every((block) => !/[<>]/.test(block.text) && !/English|Should not/.test(block.text)));
});

test('notas em markdown e bandeiras que viram letras no Windows', () => {
  const blocks = Notes.parse('# Título\n\n🇧🇷 [Português](#p) · 🇺🇸 [English](#e)\n\n## 🇧🇷 Português\n\n### Novidades\n- **Novo:** `nexo_x`\n\n---\n\n## 🇺🇸 English\n- no');
  assert.deepEqual(blocks, [{ type: 'heading', text: 'Novidades' }, { type: 'item', text: 'Novo: nexo_x' }]);
  assert.deepEqual(Notes.parse(''), []);
  assert.deepEqual(Notes.parse([{ note: '- um item' }]), [{ type: 'item', text: 'um item' }]);
});
