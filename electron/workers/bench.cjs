/* Trabalho de medição do laboratório (bench). Arquivo próprio: o processo principal não executa código a partir de texto (eval). */
'use strict';
const { parentPort, workerData } = require('worker_threads');
let x = 0x9e3779b9 | 0;
let iterations = 0;
const started = performance.now();
const end = started + workerData.ms;
while (performance.now() < end) {
  for (let i = 0; i < 100000; i += 1) {
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x ^= x >>> 12;
    x = Math.imul(x, 0x297a2d39);
    x ^= x >>> 15;
  }
  iterations += 100000;
}
parentPort.postMessage({ iterations, seconds: (performance.now() - started) / 1000, checksum: x >>> 0 });
