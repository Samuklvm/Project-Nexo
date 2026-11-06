// Gera dev/preview.html a partir do index.html real, trocando só o que o navegador precisa.
// Uso: node dev/build-preview.cjs  e abra dev/preview.html (não entra no instalador).
const fs = require('fs');
const path = require('path');
let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '');
html = html.replace('href="style.css"', 'href="../style.css"');
html = html.replace(/src="(src\/[^"]+|app\.js)"/g, 'src="../$1"');
html = html.replace('<script src="../src/core.js"></script>', '<script src="mock-bridge.js"></script>\n  <script src="../src/core.js"></script>');
// Raio-X na prévia: a leitura real interpretada pelo mesmo módulo do app, com valores de exemplo.
const Scan = require('../electron/system-scan.cjs');
const sample = Scan.interpret({ 'gamedvr#0': 1, 'gamedvr#1': 1, 'priosep#0': 2, 'mouseaccel#0': '1', 'mouseaccel#1': '6', 'mouseaccel#2': '10', 'menudelay#0': '400', 'hags#0': 2, __vbs: 2 });
html = html.replace('<script src="mock-bridge.js"></script>', `<script>window.__scanPreview = ${JSON.stringify(sample).replace(/</g, '\\u003c')};</script>\n  <script src="mock-bridge.js"></script>`);
fs.writeFileSync(path.join(__dirname, 'preview.html'), html);
console.log('dev/preview.html atualizado');
