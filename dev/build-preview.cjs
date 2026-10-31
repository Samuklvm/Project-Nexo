// Gera dev/preview.html a partir do index.html real, trocando só o que o navegador precisa.
// Uso: node dev/build-preview.cjs  e abra dev/preview.html (não entra no instalador).
const fs = require('fs');
const path = require('path');
let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '');
html = html.replace('href="style.css"', 'href="../style.css"');
html = html.replace(/src="(src\/[^"]+|app\.js)"/g, 'src="../$1"');
html = html.replace('<script src="../src/core.js"></script>', '<script src="mock-bridge.js"></script>\n  <script src="../src/core.js"></script>');
fs.writeFileSync(path.join(__dirname, 'preview.html'), html);
console.log('dev/preview.html atualizado');
