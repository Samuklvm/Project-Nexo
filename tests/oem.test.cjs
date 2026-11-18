/*
 * Drivers dos fabricantes de PC: leitor de XML dos catálogos, identificação do PC e casamento pacote ↔ peça.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../electron/xml-lite.cjs');

test('xml: elementos, atributos, texto e entidades', () => {
  const root = X.parseXml('<a x="1" y=\'dois &amp; tr&#234;s\'><b>Ol&#225; &lt;mundo&gt; &quot;oi&quot; &apos;x&apos; &#x41;</b><b/><c k="v">  t  </c></a>');
  assert.equal(root.name, 'a');
  assert.deepEqual(root.attrs, { x: '1', y: 'dois & três' });
  assert.equal(X.kids(root, 'b').length, 2);
  assert.equal(X.textOf(root, 'b'), 'Olá <mundo> "oi" \'x\' A');
  assert.equal(X.kid(root, 'C').attrs.k, 'v', 'nome sem diferenciar maiúsculas');
  assert.equal(X.kid(root, 'c').text.trim(), 't');
  assert.equal(X.kid(root, 'nada'), null);
});

test('xml: CDATA, comentários e instruções', () => {
  const root = X.parseXml('\uFEFF<?xml version="1.0" encoding="utf-8"?>\n<!-- topo --><r><![CDATA[<cru> & solto]]><!-- dentro --><?pi algo?><s>1</s></r>');
  assert.equal(root.text, '<cru> & solto');
  assert.equal(X.textOf(root, 's'), '1');
});

test('xml: prefixo de namespace some do nome e walk acha descendentes', () => {
  const root = X.parseXml('<x:Manifest xmlns:x="u"><x:Group><x:Item id="1"/><x:Sub><x:Item id="2"/></x:Sub></x:Group></x:Manifest>');
  assert.equal(root.name, 'Manifest');
  assert.deepEqual(X.walk(root, 'item').map((n) => n.attrs.id), ['1', '2']);
});

test('xml: recusa DOCTYPE/ENTITY, tag sem fechar e fechamento trocado', () => {
  assert.throws(() => X.parseXml('<!DOCTYPE r [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><r>&x;</r>'), /DOCTYPE/);
  assert.throws(() => X.parseXml('<r><a></r>'), /fecha/);
  assert.throws(() => X.parseXml('<r><a>'), /fecha/);
  assert.throws(() => X.parseXml('<r>&naoexiste;</r>'), /entidade/);
  assert.throws(() => X.parseXml(''), /vazio/);
});

test('xml: limites de tamanho, profundidade e quantidade de nós', () => {
  assert.throws(() => X.parseXml(`<r>${'a'.repeat(200)}</r>`, { maxBytes: 100 }), /grande/);
  assert.throws(() => X.parseXml(`${'<a>'.repeat(70)}${'</a>'.repeat(70)}`), /fundo/);
  assert.throws(() => X.parseXml(`<r>${'<i/>'.repeat(50)}</r>`, { maxNodes: 20 }), /nós/);
  const big = X.parseXml(`<r>${'<i/>'.repeat(5000)}</r>`);
  assert.equal(big.children.length, 5000);
});
