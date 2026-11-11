// Gera dev/preview.html a partir do index.html real, trocando só o que o navegador precisa.
// Uso: node dev/build-preview.cjs  e abra dev/preview.html (não entra no instalador).
const fs = require('fs');
const path = require('path');
let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '');
html = html.replace('href="style.css"', 'href="../style.css"');
html = html.replace('href="theme.css"', 'href="../theme.css"');
html = html.replace(/src="(src\/[^"]+|app\.js)"/g, 'src="../$1"');
html = html.replace('<script src="../src/core.js"></script>', '<script src="mock-bridge.js"></script>\n  <script src="../src/core.js"></script>');
// Raio-X na prévia: a leitura real interpretada pelo mesmo módulo do app, com valores de exemplo.
const Scan = require('../electron/system-scan.cjs');
const raw = { 'gamedvr#0': 1, 'gamedvr#1': 1, 'priosep#0': 2, 'mouseaccel#0': '1', 'mouseaccel#1': '6', 'mouseaccel#2': '10', 'menudelay#0': '400', 'hags#0': 2, __vbs: 2 };
// Serviços existentes (menos o Fax, para mostrar "não existe neste PC") e plano de energia com o valor padrão.
for (const tweak of Scan.TWEAKS) {
  if (tweak.requiresExisting && tweak.id !== 'svc-fax') raw[`${tweak.id}#0`] = tweak.entries[0].def;
  tweak.entries.forEach((entry, index) => { if (entry.kind === 'power') raw[`${tweak.id}#${index}`] = tweak.options.find((option) => option.kind === 'padrao').values[index]; });
}
const sample = Scan.interpret(raw);
// Só para a prévia de desenvolvimento: o exemplo é um arquivo local do repositório e o '<' já sai escapado (\u003c).
// nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
html = html.replace('<script src="mock-bridge.js"></script>', `<script>window.__scanPreview = ${JSON.stringify(sample).replace(/</g, '\\u003c')};</script>\n  <script src="mock-bridge.js"></script>`);
fs.writeFileSync(path.join(__dirname, 'preview.html'), html);
console.log('dev/preview.html atualizado');
