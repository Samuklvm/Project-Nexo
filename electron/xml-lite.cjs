/*
 * Leitor de XML pequeno e seguro para os catálogos de drivers dos fabricantes (Dell, HP, Lenovo).
 *  - Sem dependência nova: varredura por índice, sem expressão regular com retrocesso.
 *  - Recusa <!DOCTYPE> (e com ele qualquer ENTITY): nada de entidade externa nem "bomba" de expansão.
 *  - Limites de tamanho, profundidade e quantidade de nós: catálogo malicioso ou quebrado não trava o app.
 *  - Nomes sem o prefixo de namespace (x:Item → Item); busca sem diferenciar maiúsculas.
 */
'use strict';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(raw) {
  if (!raw.includes('&')) return raw;
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const amp = raw.indexOf('&', i);
    if (amp < 0) { out += raw.slice(i); break; }
    out += raw.slice(i, amp);
    const semi = raw.indexOf(';', amp);
    if (semi < 0 || semi - amp > 12) throw new Error('XML: entidade inválida.');
    const name = raw.slice(amp + 1, semi);
    let ch = null;
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) ch = String.fromCodePoint(code);
    } else if (Object.prototype.hasOwnProperty.call(NAMED, name)) ch = NAMED[name];
    if (ch === null) throw new Error('XML: entidade desconhecida.');
    out += ch;
    i = semi + 1;
  }
  return out;
}

const localName = (name) => { const colon = name.indexOf(':'); return colon >= 0 ? name.slice(colon + 1) : name; };
const isSpace = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
const isNameEnd = (c) => isSpace(c) || c === '/' || c === '>' || c === '=';

function parseAttrs(body, node) {
  let i = 0;
  while (i < body.length) {
    while (i < body.length && isSpace(body[i])) i += 1;
    if (i >= body.length) break;
    let end = i;
    while (end < body.length && !isNameEnd(body[end])) end += 1;
    const name = localName(body.slice(i, end));
    i = end;
    while (i < body.length && isSpace(body[i])) i += 1;
    if (body[i] !== '=') { if (name) node.attrs[name] = ''; continue; }
    i += 1;
    while (i < body.length && isSpace(body[i])) i += 1;
    const quote = body[i];
    if (quote !== '"' && quote !== "'") throw new Error('XML: atributo sem aspas.');
    const close = body.indexOf(quote, i + 1);
    if (close < 0) throw new Error('XML: atributo sem fechar.');
    node.attrs[name] = decode(body.slice(i + 1, close));
    i = close + 1;
  }
}

/** Lê o XML e devolve o elemento raiz { name, attrs, children, text }. */
function parseXml(input, { maxBytes = 30 * 1024 * 1024, maxDepth = 64, maxNodes = 400000 } = {}) {
  let xml = String(input || '');
  if (xml.length > maxBytes) throw new Error('XML: arquivo grande demais.');
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  if (!xml.trim()) throw new Error('XML: vazio.');
  const stack = [];
  let root = null;
  let nodes = 0;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt < 0 ? xml.length : lt;
    if (textEnd > i && stack.length) stack[stack.length - 1].text += decode(xml.slice(i, textEnd));
    if (lt < 0) break;
    if (xml.startsWith('<!--', lt)) { const end = xml.indexOf('-->', lt + 4); if (end < 0) throw new Error('XML: comentário sem fechar.'); i = end + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new Error('XML: CDATA sem fechar.');
      if (stack.length) stack[stack.length - 1].text += xml.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) { const end = xml.indexOf('?>', lt + 2); if (end < 0) throw new Error('XML: instrução sem fechar.'); i = end + 2; continue; }
    if (xml.startsWith('<!', lt)) throw new Error('XML: DOCTYPE/ENTITY não são aceitos.');
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) throw new Error('XML: tag sem fechar.');
    const inner = xml.slice(lt + 1, gt);
    if (inner[0] === '/') {
      const name = localName(inner.slice(1).trim());
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error('XML: tag que fecha não confere.');
      i = gt + 1;
      continue;
    }
    const selfClose = inner.endsWith('/');
    const body = selfClose ? inner.slice(0, -1) : inner;
    let nameEnd = 0;
    while (nameEnd < body.length && !isNameEnd(body[nameEnd])) nameEnd += 1;
    const node = { name: localName(body.slice(0, nameEnd)), attrs: {}, children: [], text: '' };
    if (!node.name) throw new Error('XML: tag sem nome.');
    parseAttrs(body.slice(nameEnd), node);
    nodes += 1;
    if (nodes > maxNodes) throw new Error('XML: nós demais.');
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) throw new Error('XML: mais de uma raiz.');
    else root = node;
    if (!selfClose) {
      stack.push(node);
      if (stack.length > maxDepth) throw new Error('XML: aninhado fundo demais.');
    }
    i = gt + 1;
  }
  if (stack.length) throw new Error('XML: tag sem fecha.');
  if (!root) throw new Error('XML: vazio.');
  return root;
}

const same = (a, b) => a.toLowerCase() === String(b).toLowerCase();
const kids = (node, name) => (node?.children || []).filter((child) => same(child.name, name));
const kid = (node, name) => kids(node, name)[0] || null;
function walk(node, name, out = []) {
  for (const child of node?.children || []) {
    if (same(child.name, name)) out.push(child);
    walk(child, name, out);
  }
  return out;
}
const textOf = (node, name) => { const found = kid(node, name); return found ? found.text.trim() : ''; };

module.exports = { parseXml, kids, kid, walk, textOf };
