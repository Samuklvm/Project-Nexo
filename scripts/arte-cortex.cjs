/*
 * Gera a arte da página do Cortex (assets/arte/cortex/) a partir dos originais de assets/artes/ (que ficam no main,
 * fora do instalador). Cópias pequenas em webp e um manifest.json papel → arquivo (+ quadros e fps das animações).
 * De onde veio cada papel (o arquivo original) fica só aqui, nas chamadas abaixo: o manifest.json vai no app e não diz.
 *
 *   node scripts/arte-cortex.cjs [pasta-dos-originais]
 *
 * A pasta padrão é assets/artes/. Num ramo sem ela, extraia do main antes:
 *   git archive origin/main "assets/artes/Fleurs-…" … | tar -x -C /tmp/arte && node scripts/arte-cortex.cjs /tmp/arte/assets/artes
 *
 * Precisa do ImageMagick 6 (convert) com suporte a webp. Não roda no build nem no app: só quando a curadoria muda.
 * Ornamentos brancos saem brancos com o alfa = alfa × brilho (o brilho escuro em volta some), para a tela tingir de
 * ouro com mask-image. Sequências de quadros viram uma tira horizontal (sprite sheet) com quadros do mesmo tamanho.
 * Nada de logos, títulos ou nomes do jogo: a curadoria está em .superpowers/sdd/2026-11-24-cortex-memoria-eterna/.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const src = path.resolve(process.argv[2] || path.join(root, 'assets', 'artes'));
const out = path.join(root, 'assets', 'arte', 'cortex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-arte-'));
const MAX_BYTES = 3 * 1024 * 1024;

/** Pasta de uma categoria do Drive: "<Categoria>-<data>/<Sub>/". */
function category(prefix, sub) {
  const name = fs.readdirSync(src).find((n) => n.startsWith(`${prefix}-`));
  if (!name) throw new Error(`não achei a pasta "${prefix}-…" em ${src}`);
  const dir = path.join(src, name, sub);
  if (!fs.existsSync(dir)) throw new Error(`não achei ${dir}`);
  return { dir, label: sub };
}
const FLEURS = () => category('Fleurs', 'Fleurs');
const MENU = () => category('Menu', 'Menu');
const JOURNAL = () => category("Hunter's Journal", 'Hunter_s Journal');
const FX = () => category('Particles & Effects', 'Particles & Effects');
const VAULTS = () => { const env = category('Architecture & Environment', 'Architecture & Environment'); return { dir: path.join(env.dir, 'Whispering Vaults'), label: 'Whispering Vaults' }; };

const im = (...args) => execFileSync('convert', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const size = (file) => execFileSync('identify', ['-format', '%w %h', file]).toString().trim().split(' ').map(Number);
const at = (cat, file) => {
  const full = path.join(cat.dir, file);
  if (!fs.existsSync(full)) throw new Error(`falta o original ${cat.label}/${file}`);
  return full;
};
const origin = (cat, file) => `${cat.label}/${file}`;
const LOSSLESS = ['-define', 'webp:lossless=true', '-define', 'webp:exact=false'];
const LOSSY = (q = 86) => ['-quality', String(q), '-define', 'webp:alpha-quality=92', '-define', 'webp:method=6'];

const manifest = { versao: 1, gerado_por: 'scripts/arte-cortex.cjs', papeis: {} };
/** Papel no manifesto. A origem só confere a curadoria aqui (nada de logo/título) e não vai para o manifesto. */
function put(role, file, { origem, ...entry }) {
  for (const o of [].concat(origem || [])) if (/title(?!_fleur)|logo|hunter_symbol|wordmark/i.test(o)) throw new Error(`${role}: origem proibida ${o}`);
  const [largura, altura] = size(path.join(out, file));
  manifest.papeis[role] = { arquivo: file, ...entry, largura, altura };
}

/** Ornamento branco: alfa = alfa × brilho (tira o brilho escuro), cor branca, sem perda. */
function ornament(role, cat, file, width) {
  const input = at(cat, file);
  const mask = path.join(tmp, `${role}-mask.png`);
  im(input, '-resize', `${width}x>`, '(', '-clone', '0', '-alpha', 'extract', ')', '(', '-clone', '0', '-alpha', 'off', '-colorspace', 'Gray', '-level', '0,88%', ')',
    '-delete', '0', '-compose', 'Multiply', '-composite', mask);
  const [w, h] = size(mask);
  im('-size', `${w}x${h}`, 'xc:white', mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', ...LOSSLESS, path.join(out, `${role}.webp`));
  put(role, `${role}.webp`, { origem: origin(cat, file), tingir: true });
}

/** Imagem colorida (criaturas, medalhões, partículas): reduz até caber em max × max. */
function picture(role, cat, file, max, extra = {}, quality = 86) {
  im(at(cat, file), '-resize', `${max}x${max}>`, ...LOSSY(quality), path.join(out, `${role}.webp`));
  put(role, `${role}.webp`, { origem: origin(cat, file), ...extra });
}

/** Textura ladrilhável: só reduz por um fator inteiro, para continuar emendando sem costura. */
function texture(role, cat, file, side, quality = 84) {
  im(at(cat, file), '-resize', `${side}x${side}!`, ...LOSSY(quality), path.join(out, `${role}.webp`));
  put(role, `${role}.webp`, { origem: origin(cat, file), ladrilho: true });
}

/** Sequência de quadros → tira horizontal com células iguais (centralizadas). */
function strip(role, cat, files, cell, fps, quality = 84) {
  const [cw, ch] = cell;
  const parts = files.map((file, i) => {
    const part = path.join(tmp, `${role}-${i}.png`);
    im(at(cat, file), '-resize', `${cw}x${ch}>`, '-background', 'none', '-gravity', 'center', '-extent', `${cw}x${ch}`, part);
    return part;
  });
  im(...parts, '+append', ...LOSSY(quality), path.join(out, `${role}.webp`));
  put(role, `${role}.webp`, { origem: files.map((f) => origin(cat, f)), quadros: files.length, fps, quadro: { largura: cw, altura: ch } });
}

/** Folha com variantes (células de tile × tile, da esquerda para a direita e de cima para baixo) → tira horizontal. */
function variants(role, cat, file, tile, count, extra = {}, quality = 86, shave = 0) {
  const tiles = path.join(tmp, `${role}-%d.png`);
  im(at(cat, file), '-crop', `${tile[0]}x${tile[1]}`, '+repage', tiles);
  const index = (n) => Number(n.match(/-(\d+)\.png$/)[1]);
  const parts = fs.readdirSync(tmp).filter((n) => n.startsWith(`${role}-`) && n.endsWith('.png')).sort((a, b) => index(a) - index(b)).slice(0, count).map((n) => path.join(tmp, n));
  // shave: corta a borda de cada célula (a vizinha de baixo vaza alguns pixels quando a folha não divide exato).
  const cells = shave ? parts.map((part) => { im(part, '-shave', `${shave}x${shave}`, part); return part; }) : parts;
  im(...cells, '+append', ...LOSSY(quality), path.join(out, `${role}.webp`));
  const [w, h] = size(cells[0]);
  put(role, `${role}.webp`, { origem: origin(cat, file), ...extra, quadro: { largura: w, altura: h } });
}

function main() {
  if (!fs.existsSync(src)) throw new Error(`pasta dos originais não existe: ${src}`);
  fs.mkdirSync(out, { recursive: true });
  for (const name of fs.readdirSync(out)) if (name.endsWith('.webp') || name === 'manifest.json') fs.rmSync(path.join(out, name));

  const fleurs = FLEURS();
  ornament('titulo-topo', fleurs, 'Hornet_Title_Fleur_top0011.png', 540);
  ornament('titulo-base', fleurs, 'Hornet_Title_Fleur_bot0011.png', 600);
  ornament('divisor', fleurs, 'divider.png', 345);
  ornament('divisor-fino', fleurs, 'completed_quests_spacer.png', 600);
  ornament('canto', fleurs, 'overscan_corner_fleur009.png', 160);
  ornament('moldura-topo', fleurs, 'Quest_Board_top_fleur0006.png', 560);
  ornament('moldura-base', fleurs, 'Quest_Board_bottom_fleur0006.png', 480);
  ornament('aviso', fleurs, 'Warning_Fleur0008.png', 560);

  const menu = MENU();
  ornament('cursor', menu, 'main_menu_pointer.png', 72);
  picture('pensando', menu, 'save_icon.png', 180);
  strip('ritmo-profundo', menu, Array.from({ length: 8 }, (_, i) => `loading_icon_new000${i}.png`), [102, 96], 12);
  picture('medalhao-aberta', menu, 'Select_Game_Crest_Spools__0000_hunter.png', 128);
  picture('medalhao-aguardando', menu, 'Select_Game_Crest_Spools__0006_architect.png', 128);
  picture('medalhao-concluida', menu, 'Select_Game_Crest_Spools__0009_witch.png', 128);

  const journal = JOURNAL();
  const BEASTS = {
    temp_cpu: 'Burning Bug - Farmer Wisp.png',
    gpu: 'Cogwork Hauler - Understore Automaton EX.png',
    disk: 'Bloatroach - Bloat Roach #4267166.png',
    mem: 'Voltvyrm - Zap Core Enemy #4267202.png',
    programa_pesado: 'Bell Beast - Bone Beast.png',
    cpu: 'Beastfly - Bone Flyer #4267155.png',
    ajuste: 'Cogwork Crawler - Song Automaton Goomba.png',
    rotina: 'Clover Dancers - Clover Dancer #4267109.png',
    desconhecida: 'Shadow Creeper - Abyss Crawler #4267287.png'
  };
  for (const [cause, file] of Object.entries(BEASTS)) picture(`bestiario-${cause}`, journal, file, 240, { causa: cause }, 84);

  const fx = FX();
  texture('poeira-luz', fx, 'dust_light_texture.png', 512, 88);
  texture('poeira-voo', fx, 'dust_light_texture_fly.png', 512, 88);
  texture('nevoa', fx, 'dust_mist_texture_fg.png', 512, 70);
  picture('vagalume', fx, 'coral_particle_glow.png', 64);
  picture('cinza', fx, 'ash_01.png', 32);
  variants('pluma', fx, 'down_particle.png', [38, 38], 3, { variantes: 3 });
  variants('mandala', fx, 'dream_particle_01.png', [123, 123], 3, { variantes: 3 }, 86, 3);
  strip('faisca', fx, Array.from({ length: 5 }, (_, i) => `burst_effect_small000${i}.png`), [73, 182], 15);
  strip('clarao', fx, Array.from({ length: 4 }, (_, i) => `death_flash_effects_white000${i}.png`), [220, 220], 8, 80);
  picture('anel', fx, 'burst_round_generic.png', 200);
  variants('brilho', fx, 'crystal_particle_tiny.png', [35, 35], 9, { quadros: 9, fps: 18 });

  // Eventos de ambiente do cenário (Task 11c): a mariposa que cruza, a onda de luz do sino ao longe e as folhas.
  variants('mariposa', fx, 'Cog_fly_particle.png', [148, 151], 5, { quadros: 5, fps: 14 });
  picture('onda-sino', fx, 'bell_hub_scream_roar_effect_0000_1.png', 320);
  variants('folha', VAULTS(), 'library_scroll_particle.png', [42, 42], 4, { variantes: 4 });

  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!fs.existsSync(path.join(out, '.gitkeep'))) fs.writeFileSync(path.join(out, '.gitkeep'), '');
  const total = fs.readdirSync(out).reduce((sum, name) => sum + fs.statSync(path.join(out, name)).size, 0);
  console.log(`${Object.keys(manifest.papeis).length} papéis, ${(total / 1024).toFixed(0)} KB em assets/arte/cortex/`);
  if (total > MAX_BYTES) throw new Error(`passou do teto de 3 MB (${(total / 1048576).toFixed(2)} MB)`);
}

try { main(); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
