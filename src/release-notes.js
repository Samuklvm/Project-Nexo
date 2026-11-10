/*
 * Notas de versão para a tela de Atualizações.
 * O GitHub entrega as notas em HTML (às vezes em Markdown). Aqui elas viram blocos simples de texto
 * (título, item, parágrafo), só da seção em português, sem o bloco de Downloads, sem bandeiras e sem HTML.
 * Nada daqui vira HTML na tela: a interface usa textContent.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoReleaseNotes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Itens longos são cortados no fim de uma palavra (nunca no meio), com reticências.
  const MAX_TEXT = 420;
  function clip(text, max = MAX_TEXT) {
    const value = String(text);
    if (value.length <= max) return value;
    const cut = value.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.(–—-]+$/, '')}…`;
  }
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#8211': '–', '#8212': '—', '#8230': '…' };
  const FLAGS = /[\u{1F1E6}-\u{1F1FF}]/gu;

  function decode(text) {
    return String(text)
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (match, dec) => (ENTITIES[`#${dec}`] ?? String.fromCodePoint(Number(dec))))
      .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
  }
  /** Tira tags até não sobrar nenhuma (um passe só deixaria `<scr<b>ipt>` virar `<script>`). */
  function stripTags(text) {
    let out = String(text);
    for (let previous = null; previous !== out;) { previous = out; out = out.replace(/<[^<>]*>/g, ''); }
    return out;
  }
  // Tira as tags antes e depois de decodificar: `&lt;b&gt;` vira texto `<b>`, que também sai.
  const clean = (text) => stripTags(decode(stripTags(text))).replace(FLAGS, '').replace(/\s+/g, ' ').trim();

  function fromHtml(html) {
    const blocks = [];
    const pattern = /<(h[1-6]|li|p)\b[^>]*>([\s\S]*?)<\/\1>|<hr\b[^>]*>/gi;
    for (const match of String(html).matchAll(pattern)) {
      if (!match[1]) { blocks.push({ type: 'rule' }); continue; }
      const tag = match[1].toLowerCase();
      // Itens que contêm uma lista aninhada: só o texto antes dela.
      const inner = tag === 'li' ? match[2].split(/<ul|<ol/i)[0] : match[2];
      const text = clean(inner);
      if (!text) continue;
      if (tag[0] === 'h') blocks.push({ type: 'heading', level: Number(tag[1]), text });
      else blocks.push({ type: tag === 'li' ? 'item' : 'text', text });
    }
    return blocks;
  }

  function fromMarkdown(markdown) {
    return String(markdown).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      if (/^(-{3,}|\*{3,})$/.test(line)) return { type: 'rule' };
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      const strip = (text) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/`([^`]+)`/g, '$1').replace(FLAGS, '').trim();
      if (heading) return { type: 'heading', level: heading[1].length, text: strip(heading[2]) };
      const item = line.match(/^[-*+]\s+(.*)$/);
      if (item) return { type: 'item', text: strip(item[1]) };
      return { type: 'text', text: strip(line.replace(/^>\s*/, '')) };
    }).filter((block) => block.type === 'rule' || block.text);
  }

  /** Converte as notas (texto, HTML ou lista do electron-updater) em blocos da seção em português. */
  function parse(notes, { limit = 16 } = {}) {
    const raw = Array.isArray(notes) ? notes.map((note) => (typeof note === 'string' ? note : note?.note || note?.text || '')).join('\n') : String(notes || '');
    if (!raw.trim()) return [];
    let blocks = /<\/?(h[1-6]|p|ul|li|div)\b/i.test(raw) ? fromHtml(raw) : fromMarkdown(raw);

    // Só a seção em português, quando as notas são bilíngues.
    const start = blocks.findIndex((block) => block.type === 'heading' && /portugu[eê]s/i.test(block.text));
    if (start >= 0) {
      const { level } = blocks[start];
      const rest = blocks.slice(start + 1);
      const end = rest.findIndex((block) => block.type === 'rule' || (block.type === 'heading' && block.level <= level));
      blocks = end >= 0 ? rest.slice(0, end) : rest;
    } else {
      const english = blocks.findIndex((block) => block.type === 'heading' && /^english$/i.test(block.text));
      if (english > 0) blocks = blocks.slice(0, english);
    }

    // Fora: título da release, linha com os links de idioma, separadores e a seção de Downloads.
    const out = [];
    let skipping = false;
    for (const block of blocks) {
      if (block.type === 'rule') continue;
      if (block.type === 'heading') {
        if (block.level === 1) continue;
        skipping = /^downloads?$/i.test(block.text);
        if (skipping) continue;
      } else if (skipping) continue;
      if (block.type === 'text' && /portugu[eê]s/i.test(block.text) && /english/i.test(block.text)) continue;
      out.push({ type: block.type === 'heading' ? 'heading' : block.type, text: clip(block.text, MAX_TEXT) });
    }
    // Não termina com um título sozinho.
    const limited = out.slice(0, limit);
    while (limited.length && limited[limited.length - 1].type === 'heading') limited.pop();
    return limited;
  }

  return { parse, clip };
});
