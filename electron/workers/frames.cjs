/* Trabalho de medição do laboratório (frames). Arquivo próprio: o processo principal não executa código a partir de texto (eval). */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const pause = new Int32Array(new SharedArrayBuffer(4));
let x = 0x2545f491 | 0;
const spin = (n) => { for (let i = 0; i < n; i += 1) { x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d); x ^= x >>> 12; } };
if (workerData.calibrate) {
  const start = performance.now(); let n = 0;
  while (performance.now() - start < 250) { spin(20000); n += 20000; }
  parentPort.postMessage({ perMs: n / (performance.now() - start) });
} else {
  const frames = [];
  const end = performance.now() + workerData.ms;
  let deadline = performance.now();
  while (performance.now() < end) {
    deadline += 1000 / 60;
    const start = performance.now();
    spin(workerData.work);
    frames.push(performance.now() - start);
    const left = deadline - performance.now();
    if (left > 0) Atomics.wait(pause, 0, 0, left); else deadline = performance.now();
  }
  frames.sort((a, b) => a - b);
  parentPort.postMessage({ frames: frames.length, p50: frames[Math.floor(frames.length / 2)] || 0, p95: frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))] || 0, checksum: x >>> 0 });
}
