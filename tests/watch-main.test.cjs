/* Vigias do processo principal (electron/watch-main.cjs). Spec: docs/superpowers/specs/2026-11-18-vigias-de-erro-design.md */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { memoryAlarm, pulseRefused } = require('../electron/watch-main.cjs');

const metric = (type, mb) => ({ type, memory: { workingSetSize: mb * 1024 } }); // o Electron dá em KB

test('memória alta: soma de todos os processos do Nexo acima de 1,5 GB, com as partes por tipo', () => {
  assert.equal(memoryAlarm([metric('Browser', 300), metric('Renderer', 700), metric('GPU', 400)]), null, '1,4 GB');
  assert.equal(memoryAlarm([metric('Browser', 500), metric('Renderer', 1000)]), null, '1,5 GB certinho');
  assert.deepEqual(memoryAlarm([metric('Browser', 300), metric('Renderer', 900), metric('Renderer', 250), metric('GPU', 400.4)]), { totalMB: 1850, partes: { Browser: 300, Renderer: 1150, GPU: 400 } });
  assert.equal(memoryAlarm(null), null);
  assert.equal(memoryAlarm([{ type: 'Utility' }]), null, 'sem número, nada');
});

test('contagem recusada: só 4xx (sem 429); sem rede, 5xx e sucesso não contam', () => {
  assert.equal(pulseRefused({ skipped: true, failed: true, status: 400 }), true);
  assert.equal(pulseRefused({ skipped: true, failed: true, status: 413 }), true);
  assert.equal(pulseRefused({ skipped: true, failed: true, status: 429 }), false);
  assert.equal(pulseRefused({ skipped: true, failed: true, status: 503 }), false);
  assert.equal(pulseRefused({ skipped: true, failed: true, status: null }), false, 'sem rede');
  assert.equal(pulseRefused({ sent: true }), false);
  assert.equal(pulseRefused(undefined), false);
});

test('main: avisos antigos ganham nome de vigia e os vigias novos estão ligados', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  for (const vigia of ['acao-lenta', 'processo-travado', 'janela-sem-resposta', 'memoria-alta', 'contagem-recusada']) assert.ok(main.includes(`vigia: '${vigia}'`), vigia);
  assert.match(main, /memoryAlarm\(app\.getAppMetrics\(\)\)/);
  assert.match(main, /pulseRefused\(/);
});
