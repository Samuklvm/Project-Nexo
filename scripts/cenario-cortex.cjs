/*
 * Monta o cenário vivo da página do Cortex ("A Biblioteca da Memória") a partir das peças de ambiente dos originais
 * (assets/artes/, que ficam no main, fora do instalador). A composição está descrita em
 * assets/arte/cortex/cenario/cena.json (camada → fundo, brilhos, peças com posição, escala, espelho, tom, névoa,
 * desfoque); este script só obedece. Sai uma webp por camada (2400 × 1350), mais o globo e as luzes separados.
 *
 *   node scripts/cenario-cortex.cjs [pasta-dos-originais]
 *
 * A pasta padrão é assets/artes/. Num ramo sem ela, extraia do main antes (o caminho tem espaços: use aspas):
 *   git archive origin/main "assets/artes/Architecture & Environment-…/Architecture & Environment/Whispering Vaults" \
 *     "assets/artes/Menu-…" … | tar -x -C /tmp/arte && node scripts/cenario-cortex.cjs /tmp/arte/assets/artes
 *
 * Peças: "Região/arquivo.png" (de "Architecture & Environment/<Região>/") ou "Menu/arquivo.png" e
 * "Particles & Effects/arquivo.png" (das pastas de mesmo nome). Precisa do ImageMagick 6 (convert) com webp.
 * Determinístico: mesma cena e mesmos originais dão as mesmas camadas. Não roda no build nem no app.
 *
 * Campos de uma peça: peca, x (centro), y (topo; com "base": true, y é a base), escala, espelho, simetria (repete
 * espelhada do outro lado do centro), brilho e saturacao (% do -modulate), matiz (100 = igual), tinta [cor, %]
 * (puxa a cor para a da tinta), desfoque (px), opacidade (0–1), recorte [l, t, w, h] (antes de escalar).
 * Camada: fundo { gradiente [cima, baixo] } (camada opaca), brilhos [{ x, y, r, cor, forca, achatar }],
 * neblinas [{ y, altura, cor, forca }], pecas [...], pos { tinta [cor, %], desfoque, brilho }, qualidade.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const src = path.resolve(process.argv[2] || path.join(root, 'assets', 'artes'));
const out = path.join(root, 'assets', 'arte', 'cortex', 'cenario');
const cena = JSON.parse(fs.readFileSync(path.join(out, 'cena.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-cena-'));
const W = cena.largura;
const H = cena.altura;

const im = (...args) => execFileSync('convert', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const size = (file) => execFileSync('identify', ['-format', '%w %h', file]).toString().trim().split(' ').map(Number);
const CATEGORY = new Set(['Menu', 'Particles & Effects']);
const dirOf = (prefix, sub) => {
  const name = fs.readdirSync(src).find((n) => n.startsWith(`${prefix}-`));
  if (!name) throw new Error(`não achei a pasta "${prefix}-…" em ${src}`);
  return path.join(src, name, sub);
};
/** Caminho do original de uma peça ("Região/arquivo.png"). */
function original(piece) {
  const [region, file] = piece.split('/');
  const base = CATEGORY.has(region) ? dirOf(region, region) : path.join(dirOf('Architecture & Environment', 'Architecture & Environment'), region);
  const full = path.join(base, file);
  if (!fs.existsSync(full)) throw new Error(`falta a peça ${piece}`);
  return full;
}

let seq = 0;
/** Prepara uma peça (recorte, escala, espelho, tom, tinta, desfoque, opacidade) num png temporário. */
function prepare(p, mirrored) {
  const file = path.join(tmp, `p${(seq += 1)}.png`);
  const args = [original(p.peca)];
  if (p.recorte) args.push('-crop', `${p.recorte[2]}x${p.recorte[3]}+${p.recorte[0]}+${p.recorte[1]}`, '+repage');
  args.push('-filter', 'Lanczos', '-resize', `${((p.escala || 1) * 100).toFixed(2)}%`);
  if (Boolean(p.espelho) !== Boolean(mirrored)) args.push('-flop');
  if (p.brilho !== undefined || p.saturacao !== undefined || p.matiz !== undefined) args.push('-modulate', `${p.brilho ?? 100},${p.saturacao ?? 100},${p.matiz ?? 100}`);
  if (p.tinta) args.push('-fill', p.tinta[0], '-colorize', `${p.tinta[1]}%`);
  // Desfoque com borda transparente: sem a borda o desfoque cortaria reto na beira da peça.
  if (p.desfoque) args.push('-bordercolor', 'none', '-border', `${Math.ceil(p.desfoque * 3)}`, '-channel', 'RGBA', '-blur', `0x${p.desfoque}`, '+channel');
  if (p.opacidade !== undefined && p.opacidade < 1) args.push('-channel', 'A', '-evaluate', 'multiply', String(p.opacidade), '+channel');
  im(...args, file);
  const pad = p.desfoque ? Math.ceil(p.desfoque * 3) : 0;
  return { file, pad };
}

/** Brilho radial (luz de vela, janela, globo): cor com alfa caindo devagar do centro. */
function glow(g) {
  const r = Math.round(g.r);
  const flat = g.achatar || 1; // < 1 deixa a luz mais larga que alta
  const file = path.join(tmp, `g${(seq += 1)}.png`);
  const mask = path.join(tmp, `m${seq}.png`);
  im('-size', `${r * 2}x${r * 2}`, 'radial-gradient:white-black', '-evaluate', 'pow', '1.8', '-evaluate', 'multiply', String(g.forca), mask);
  im('-size', `${r * 2}x${r * 2}`, `xc:${g.cor}`, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', '-resize', `${r * 2}x${Math.round(r * 2 * flat)}!`, file);
  return { file, x: Math.round(g.x - r), y: Math.round(g.y - r * flat) };
}

/** Faixa de névoa: transparente → cor → transparente, na altura pedida. */
function fogBand(n) {
  const file = path.join(tmp, `n${(seq += 1)}.png`);
  const h = Math.round(n.altura);
  const mask = path.join(tmp, `nm${seq}.png`);
  im('-size', `1x${h}`, 'gradient:black-white', '(', '+clone', '-flip', ')', '-compose', 'Darken', '-composite', '-evaluate', 'multiply', String(2 * n.forca), '-resize', `${W}x${h}!`, mask);
  im('-size', `${W}x${h}`, `xc:${n.cor}`, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', file);
  return { file, y: Math.round(n.y - h / 2) };
}

function buildLayer(layer) {
  const canvas = path.join(tmp, `${layer.id}.png`);
  if (layer.fundo && layer.fundo.gradiente) im('-size', `${W}x${H}`, `gradient:${layer.fundo.gradiente[0]}-${layer.fundo.gradiente[1]}`, canvas);
  else im('-size', `${W}x${H}`, 'xc:none', canvas);
  const over = (file, x, y, compose = 'Over') => im(canvas, file, '-geometry', `${x >= 0 ? '+' : ''}${x}${y >= 0 ? '+' : ''}${y}`, '-compose', compose, '-composite', canvas);
  for (const g of layer.brilhos || []) { const glowed = glow(g); over(glowed.file, glowed.x, glowed.y, layer.fundo ? 'Screen' : 'Over'); }
  for (const p of layer.pecas || []) {
    for (const mirrored of p.simetria ? [false, true] : [false]) {
      const prepared = prepare(p, mirrored);
      const [w, h] = size(prepared.file);
      const cx = mirrored ? W - p.x : p.x;
      const x = Math.round(cx - w / 2);
      const y = Math.round(p.base ? p.y - h + prepared.pad : p.y - prepared.pad);
      over(prepared.file, x, y);
    }
  }
  for (const n of layer.neblinas || []) { const band = fogBand(n); over(band.file, 0, band.y); }
  const post = layer.pos || {};
  const args = [canvas];
  if (post.brilho !== undefined) args.push('-modulate', `${post.brilho},100,100`);
  if (post.tinta) args.push('-fill', post.tinta[0], '-colorize', `${post.tinta[1]}%`);
  if (post.desfoque) args.push('-channel', 'RGBA', '-blur', `0x${post.desfoque}`, '+channel');
  if (layer.recorte) args.push('-crop', `${layer.recorte[2]}x${layer.recorte[3]}+${layer.recorte[0]}+${layer.recorte[1]}`, '+repage');
  const quality = String(layer.qualidade || 90);
  args.push('-quality', quality, '-define', 'webp:alpha-quality=95', '-define', 'webp:method=6');
  if (layer.fundo) args.push('-alpha', 'off');
  im(...args, path.join(out, layer.arquivo));
}

function main() {
  if (!fs.existsSync(src)) throw new Error(`pasta dos originais não existe: ${src}`);
  const only = process.env.CAMADA ? new Set(process.env.CAMADA.split(',')) : null; // CAMADA=meio,globo para testar uma só
  const keep = new Set(['cena.json', ...cena.camadas.map((l) => l.arquivo)]);
  if (!only) for (const name of fs.readdirSync(out)) if (!keep.has(name)) fs.rmSync(path.join(out, name));
  for (const layer of cena.camadas) {
    if (only && !only.has(layer.id)) continue;
    const t = Date.now();
    buildLayer(layer);
    const bytes = fs.statSync(path.join(out, layer.arquivo)).size;
    console.log(`${layer.id.padEnd(7)} ${String(Math.round(bytes / 1024)).padStart(5)} KB  ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  const total = fs.readdirSync(out).reduce((sum, name) => sum + fs.statSync(path.join(out, name)).size, 0);
  console.log(`cenário: ${(total / 1048576).toFixed(2)} MB`);
  if (total > 10 * 1024 * 1024) throw new Error('passou do teto de 10 MB do cenário');
}

try { main(); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
