/* Trabalho de medição do laboratório (disk). Arquivo próprio: o processo principal não executa código a partir de texto (eval). */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const SIZE = 4 * 1024 * 1024;
const fd = fs.openSync(workerData.file, fs.existsSync(workerData.file) ? 'r+' : 'w+');
try {
  if (fs.fstatSync(fd).size < SIZE) fs.ftruncateSync(fd, SIZE);
  const block = Buffer.alloc(4096, 7);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const gaps = [3, 30, 150];
  const times = [];
  const end = performance.now() + workerData.ms;
  let seed = 777;
  for (let i = 0; performance.now() < end; i += 1) {
    Atomics.wait(pause, 0, 0, gaps[i % gaps.length]);
    seed = (seed * 16807) % 2147483647;
    const offset = (seed % (SIZE / 4096)) * 4096;
    block.writeUInt32LE(i, 0);
    const start = performance.now();
    fs.writeSync(fd, block, 0, block.length, offset);
    fs.fsyncSync(fd);
    times.push((performance.now() - start) * 1000);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
  parentPort.postMessage({ samples: times.length, meanUs: mean, p50: times[Math.floor(times.length / 2)] || 0 });
} finally { fs.closeSync(fd); }
