/* Trabalho de medição do laboratório (timer). Arquivo próprio: o processo principal não executa código a partir de texto (eval). */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const pause = new Int32Array(new SharedArrayBuffer(4));
const over = [];
const end = performance.now() + workerData.ms;
while (performance.now() < end) {
  const start = performance.now();
  Atomics.wait(pause, 0, 0, 1);
  over.push(Math.max(0, performance.now() - start - 1));
}
over.sort((a, b) => a - b);
const mean = over.reduce((sum, value) => sum + value, 0) / Math.max(1, over.length);
parentPort.postMessage({ samples: over.length, meanMs: mean, p95: over[Math.min(over.length - 1, Math.floor(over.length * 0.95))] || 0 });
