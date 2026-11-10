/* Trabalho de medição do laboratório (memory). Arquivo próprio: o processo principal não executa código a partir de texto (eval). */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const size = 8 * 1024 * 1024;
const next = new Uint32Array(size);
for (let i = 0; i < size; i += 1) next[i] = i;
let seed = 0x9e3779b9 >>> 0;
for (let i = size - 1; i > 0; i -= 1) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = seed % i; const t = next[i]; next[i] = next[j]; next[j] = t; }
let p = 0; let reads = 0;
const start = performance.now();
const end = start + workerData.ms;
while (performance.now() < end) { for (let k = 0; k < 100000; k += 1) { p = next[p]; } reads += 100000; }
parentPort.postMessage({ readsPerUs: reads / ((performance.now() - start) * 1000), p });
