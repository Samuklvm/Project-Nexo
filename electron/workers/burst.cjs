/* Trabalho de medição do laboratório (burst). Arquivo próprio: o processo principal não executa código a partir de texto (eval). */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const pause = new Int32Array(new SharedArrayBuffer(4));
let x = 0x9e3779b9 | 0;
let iterations = 0;
let busy = 0;
const end = performance.now() + workerData.ms;
while (performance.now() < end) {
  Atomics.wait(pause, 0, 0, 70);
  const start = performance.now();
  while (performance.now() - start < 30) {
    for (let i = 0; i < 20000; i += 1) { x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d); x ^= x >>> 12; }
    iterations += 20000;
  }
  busy += performance.now() - start;
}
parentPort.postMessage({ iterations, seconds: busy / 1000, checksum: x >>> 0 });
