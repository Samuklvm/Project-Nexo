/*
 * Teste de estabilidade da memória (verificação completa): ocupa uma parte da RAM livre em blocos de 16 MB, grava
 * padrões e confere cada palavra de volta, passada após passada, até o tempo acabar.
 *
 * Padrões (os clássicos dos testadores de memória):
 *  - endereço:       cada palavra guarda o próprio índice (pega endereços trocados e linhas que se misturam);
 *  - xadrez e inverso: 0xAAAAAAAA / 0x55555555 alternados (bits vizinhos em sentidos opostos);
 *  - aleatório:      sequência pseudoaleatória com semente nova a cada passada (pega erros que dependem do dado);
 *  - bits andando:   um bit 1 percorrendo a palavra (pega bits presos).
 * Blocos bem maiores que o cache do processador: a conferência lê da memória de verdade.
 *
 * Não substitui um teste de horas (MemTest86 ou o Diagnóstico de Memória do Windows), mas acha memória instável
 * (perfil XMP/EXPO no limite, pente com defeito) em minutos. Manda o progresso a cada bloco e o resultado no fim.
 */
'use strict';
const { parentPort, workerData } = require('worker_threads');

const WORDS = (16 * 1024 * 1024) / 4;
const totalMB = Math.max(64, Math.min(4096, Math.floor(Number(workerData?.totalMB) || 512)));
const deadline = Date.now() + Math.max(5000, Math.min(15 * 60 * 1000, Number(workerData?.ms) || 60000));
const PATTERNS = ['endereço', 'xadrez', 'xadrez inverso', 'aleatório', 'bits andando'];

const blocks = [];
for (let mb = 0; mb < totalMB; mb += 16) {
  try { blocks.push(new Uint32Array(WORDS)); } catch { break; } // sem memória para mais: testa o que conseguiu
}

const lcg = (seed) => { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x; }; };
function fill(block, pattern, blockIndex, pass) {
  const base = blockIndex * WORDS;
  if (pattern === 'endereço') for (let i = 0; i < WORDS; i += 1) block[i] = (base + i) ^ (pass * 0x9e3779b9);
  else if (pattern === 'xadrez') for (let i = 0; i < WORDS; i += 1) block[i] = i & 1 ? 0x55555555 : 0xaaaaaaaa;
  else if (pattern === 'xadrez inverso') for (let i = 0; i < WORDS; i += 1) block[i] = i & 1 ? 0xaaaaaaaa : 0x55555555;
  else if (pattern === 'aleatório') { const next = lcg(pass * 7919 + blockIndex * 104729 + 1); for (let i = 0; i < WORDS; i += 1) block[i] = next(); }
  else for (let i = 0; i < WORDS; i += 1) block[i] = (1 << ((i + pass) & 31)) >>> 0;
}
function expected(pattern, blockIndex, pass) {
  const base = blockIndex * WORDS;
  if (pattern === 'endereço') return (i) => ((base + i) ^ (pass * 0x9e3779b9)) >>> 0;
  if (pattern === 'xadrez') return (i) => (i & 1 ? 0x55555555 : 0xaaaaaaaa);
  if (pattern === 'xadrez inverso') return (i) => (i & 1 ? 0xaaaaaaaa : 0x55555555);
  if (pattern === 'aleatório') { const next = lcg(pass * 7919 + blockIndex * 104729 + 1); return () => next(); }
  return (i) => (1 << ((i + pass) & 31)) >>> 0;
}

if (!blocks.length) {
  // Sem memória livre para testar: avisa e sai (nada de girar em falso até o prazo).
  parentPort.postMessage({ kind: 'done', testedMB: 0, passes: 0, errors: 0, samples: [], bandwidthMBs: null, elapsedMs: 0 });
  process.exit(0);
}

let errors = 0;
let passes = 0;
let bytes = 0;
const samples = [];
const started = Date.now();
let lastPost = 0;
outer: for (let pass = 0; ; pass += 1) {
  const pattern = PATTERNS[pass % PATTERNS.length];
  for (let b = 0; b < blocks.length; b += 1) {
    if (Date.now() > deadline) break outer;
    fill(blocks[b], pattern, b, pass);
  }
  for (let b = 0; b < blocks.length; b += 1) {
    if (Date.now() > deadline) break outer;
    const block = blocks[b];
    const want = expected(pattern, b, pass);
    for (let i = 0; i < WORDS; i += 1) {
      const value = block[i] >>> 0;
      const good = want(i) >>> 0;
      if (value !== good) {
        errors += 1;
        if (samples.length < 8) samples.push({ pattern, block: b, word: i, expected: good.toString(16), got: value.toString(16), bits: ((value ^ good) >>> 0).toString(2).replace(/0/g, '').length });
      }
    }
    bytes += block.byteLength * 2;
    const now = Date.now();
    if (now - lastPost > 700) { lastPost = now; parentPort.postMessage({ kind: 'progress', pass: passes + 1, pattern, errors, testedMB: blocks.length * 16, elapsedMs: now - started }); }
  }
  passes += 1;
}
const elapsed = Math.max(1, Date.now() - started);
parentPort.postMessage({ kind: 'done', testedMB: blocks.length * 16, passes, errors, samples, bandwidthMBs: Math.round(bytes / 1048576 / (elapsed / 1000)), elapsedMs: elapsed });
