/*
 * Vigias que só podem avisar uma vez por dia: a lembrança sobrevive a reiniciar o app.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOnceADay } = require('../electron/once-a-day.cjs');

test('uma vez por dia por chave, guardado em disco', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-day-')), 'avisos.json');
  let day = '2026-11-18';
  const a = createOnceADay({ file, today: () => day });
  assert.equal(await a.take('dell'), true);
  assert.equal(await a.take('dell'), false);
  assert.equal(await a.take('hp'), true);
  const b = createOnceADay({ file, today: () => day });
  assert.equal(await b.take('dell'), false, 'reiniciar o app não zera');
  day = '2026-11-19';
  assert.equal(await b.take('dell'), true, 'outro dia avisa de novo');
  fs.writeFileSync(file, '{lixo');
  const c = createOnceADay({ file, today: () => day });
  assert.equal(await c.take('lenovo'), true, 'arquivo estragado não trava o vigia');
});
