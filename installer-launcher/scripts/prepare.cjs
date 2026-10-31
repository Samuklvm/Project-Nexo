// Copia o Setup gerado pelo app principal (../release) para ./payload/Nexo-Setup.exe
const fs = require('fs'), path = require('path');
const rel = path.join(__dirname, '..', '..', 'release');
const files = fs.existsSync(rel) ? fs.readdirSync(rel).filter(n => /^Nexo-Setup-.*\.exe$/.test(n)) : [];
if (!files.length) {
  console.error('Nexo-Setup-*.exe não encontrado em ' + rel + '. Rode "npm run dist" na raiz do projeto antes.');
  process.exit(1);
}
files.sort((a, b) => fs.statSync(path.join(rel, b)).mtimeMs - fs.statSync(path.join(rel, a)).mtimeMs);
const out = path.join(__dirname, '..', 'payload');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(rel, files[0]), path.join(out, 'Nexo-Setup.exe'));
console.log('payload:', files[0]);
