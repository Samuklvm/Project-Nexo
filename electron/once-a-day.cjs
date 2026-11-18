/*
 * "No máximo um aviso por dia" que sobrevive a reiniciar o app (os vigias usam). Guarda { chave: 'AAAA-MM-DD' } num
 * arquivo pequeno; arquivo estragado ou ausente conta como "nada avisado ainda".
 */
'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');

function createOnceADay({ file, today = () => new Date().toISOString().slice(0, 10), fs = fsp } = {}) {
  let memo = null;
  async function load() {
    if (memo) return memo;
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      memo = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch { memo = {}; }
    return memo;
  }
  /** true na primeira vez da chave no dia (e marca); false nas outras. */
  async function take(key) {
    const k = String(key || '').slice(0, 40);
    if (!k) return false;
    const data = await load();
    const day = today();
    if (data[k] === day) return false;
    data[k] = day;
    for (const name of Object.keys(data)) if (data[name] !== day && Object.keys(data).length > 50) delete data[name];
    try { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data)); } catch { /* fica só na memória */ }
    return true;
  }
  return { take };
}

module.exports = { createOnceADay };
