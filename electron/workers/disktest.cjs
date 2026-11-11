/*
 * Teste do disco (verificação completa): grava de verdade numa pasta do próprio app e mede.
 *  - gravação contínua: 256 MB em blocos de 4 MB com dados aleatórios (SSD que comprime não "trapaceia"), e só para o
 *    relógio depois que o disco confirma (fsync);
 *  - gravações pequenas confirmadas: 4 KB em pontos espalhados de um arquivo de 64 MB, cada uma esperando o disco
 *    confirmar. A mediana mostra a resposta normal; o pior caso mostra as pausas (engasgos).
 * Os arquivos são apagados no fim, mesmo se der erro. Não lê nada que já existia no disco.
 */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = String(workerData?.dir || '');
const sizeMB = Math.max(32, Math.min(1024, Math.floor(Number(workerData?.sizeMB) || 256)));
const smallCount = Math.max(20, Math.min(1000, Math.floor(Number(workerData?.smallCount) || 300)));
const deadline = Date.now() + Math.max(5000, Math.min(120000, Number(workerData?.ms) || 40000));
const now = () => Number(process.hrtime.bigint()) / 1e6;

function run() {
  if (!dir || !path.isAbsolute(dir)) return { ok: false, reason: 'pasta inválida' };
  fs.mkdirSync(dir, { recursive: true });
  const big = path.join(dir, 'nexo-teste-disco.tmp');
  const small = path.join(dir, 'nexo-teste-disco-4k.tmp');
  const block = crypto.randomBytes(4 * 1024 * 1024);
  const result = { ok: true, sizeMB: 0, seqWriteMBs: null, latency: null };
  try {
    // 1) Gravação contínua.
    let fd = fs.openSync(big, 'w');
    const started = now();
    let written = 0;
    try {
      for (let i = 0; i < sizeMB / 4 && Date.now() < deadline; i += 1) {
        block.writeUInt32LE(i, 0); // cada bloco diferente do anterior
        fs.writeSync(fd, block, 0, block.length, null);
        written += block.length;
        if (i % 16 === 0) parentPort.postMessage({ kind: 'progress', phase: 'seq', mb: Math.round(written / 1048576) });
      }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    const seconds = Math.max(0.001, (now() - started) / 1000);
    result.sizeMB = Math.round(written / 1048576);
    result.seqWriteMBs = Math.round((written / 1048576 / seconds) * 10) / 10;
    // 2) Gravações pequenas, cada uma confirmada.
    fd = fs.openSync(small, 'w');
    const times = [];
    try {
      const page = crypto.randomBytes(4096);
      const span = (64 * 1024 * 1024) / 4096;
      fs.ftruncateSync(fd, 64 * 1024 * 1024);
      for (let i = 0; i < smallCount && Date.now() < deadline; i += 1) {
        const offset = Math.floor(Math.random() * span) * 4096;
        page.writeUInt32LE(i, 0);
        const t0 = now();
        fs.writeSync(fd, page, 0, 4096, offset);
        fs.fdatasyncSync(fd);
        times.push(now() - t0);
        if (i % 50 === 0) parentPort.postMessage({ kind: 'progress', phase: 'small', done: i });
      }
    } finally { fs.closeSync(fd); }
    if (times.length >= 10) {
      const sorted = [...times].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
      result.latency = { count: times.length, p50Ms: Math.round(at(0.5) * 100) / 100, p99Ms: Math.round(at(0.99) * 100) / 100, maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100 };
    }
  } catch (error) {
    result.ok = false;
    result.reason = String(error?.code || error?.message || error).slice(0, 80);
  } finally {
    for (const file of [big, small]) { try { fs.unlinkSync(file); } catch { /* já apagado */ } }
  }
  return result;
}

parentPort.postMessage({ kind: 'done', ...run() });
