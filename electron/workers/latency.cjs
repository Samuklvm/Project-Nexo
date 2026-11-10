/* Trabalho de medição do laboratório (latency). Arquivo próprio: o processo principal não executa código a partir de texto (eval). */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const flags = new Int32Array(workerData.buffer);
if (workerData.role === 'sleeper') {
  let seen = 0;
  for (;;) {
    Atomics.wait(flags, 0, seen);
    seen = Atomics.load(flags, 0);
    if (seen < 0) break;
    Atomics.store(flags, 1, seen);
  }
  parentPort.postMessage({ done: true });
} else {
  const latencies = [];
  const end = performance.now() + workerData.ms;
  let seed = 12345;
  for (let i = 1; performance.now() < end; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const gapEnd = performance.now() + 0.5 + (seed / 2147483647) * 2.5;
    while (performance.now() < gapEnd) { /* pausa: o outro núcleo tem tempo de dormir */ }
    const start = performance.now();
    Atomics.store(flags, 0, i);
    Atomics.notify(flags, 0);
    const limit = start + 50;
    while (Atomics.load(flags, 1) !== i && performance.now() < limit) { /* espera a resposta */ }
    latencies.push((performance.now() - start) * 1000);
  }
  Atomics.store(flags, 0, -1);
  Atomics.notify(flags, 0);
  latencies.sort((a, b) => a - b);
  const pick = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] || 0;
  parentPort.postMessage({ samples: latencies.length, p50: pick(0.5), p90: pick(0.9) });
}
