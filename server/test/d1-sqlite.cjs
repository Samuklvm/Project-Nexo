/*
 * D1 de mentira em cima do SQLite embutido no Node (node:sqlite), com a mesma API que o Cloudflare oferece:
 * prepare().bind().first()/all()/run(), batch() numa transação e exec(). Serve só para os testes.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function createD1(migrationsDir = path.join(__dirname, '..', 'migrations')) {
  const db = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  const plain = (row) => (row ? { ...row } : null);
  const check = (values) => values.forEach((value, index) => {
    if (value === undefined) throw new Error(`D1_TYPE_ERROR: valor ${index + 1} é undefined`);
    if (typeof value === 'boolean' || (typeof value === 'object' && value !== null)) throw new Error(`D1_TYPE_ERROR: tipo não suportado no valor ${index + 1}`);
  });
  function statement(sql, values = []) {
    return {
      sql, values,
      bind: (...next) => { check(next); return statement(sql, next); },
      first: async (column) => { const row = plain(db.prepare(sql).get(...values)); return column ? row?.[column] ?? null : row; },
      all: async () => ({ results: db.prepare(sql).all(...values).map(plain), success: true, meta: {} }),
      run: async () => { const info = db.prepare(sql).run(...values); return { success: true, meta: { changes: Number(info.changes) } }; }
    };
  }
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    exec: async (sql) => { db.exec(sql); return { count: 1 }; },
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        const out = statements.map((item) => { const info = db.prepare(item.sql).run(...item.values); return { success: true, meta: { changes: Number(info.changes) } }; });
        db.exec('COMMIT');
        return out;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
}

module.exports = { createD1 };
