// Baixa o PresentMon da versão fixada em third-party/presentmon.lock.json e confere o SHA-256.
// Sem hash fixado, NÃO baixa nem embute nada (cadeia de suprimentos). Uso:
//   node scripts/fetch-presentmon.cjs               -> baixa para third-party/bin se (e só se) o hash estiver fixado e conferir
//   node scripts/fetch-presentmon.cjs --print-hash  -> baixa só para calcular e mostrar o SHA-256 (para você conferir e fixar)
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const LOCK = path.join(__dirname, '..', 'third-party', 'presentmon.lock.json');
const OUT = path.join(__dirname, '..', 'third-party', 'bin', 'PresentMon.exe');
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const normalize = (value) => String(value || '').trim().toLowerCase();

/** Decide o que fazer sem tocar na rede (função pura, testada). */
function plan(lock, argv = []) {
  const printOnly = argv.includes('--print-hash');
  if (!lock || !/^https:\/\/github\.com\/GameTechDev\/PresentMon\/releases\/download\//.test(lock.url || '')) return { action: 'error', reason: 'A URL do lock não aponta para as releases oficiais do PresentMon.' };
  if (printOnly) return { action: 'print-hash' };
  if (!/^[0-9a-f]{64}$/.test(normalize(lock.sha256))) return { action: 'skip', reason: 'Hash SHA-256 ainda não fixado em third-party/presentmon.lock.json. Nada foi baixado nem será embutido. Veja "howToPin" no arquivo.' };
  return { action: 'download' };
}

function verify(buffer, expected) { return sha256(buffer) === normalize(expected); }

function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'nexo-device-care-build' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) { response.resume(); resolve(download(new URL(response.headers.location, url).href, redirects - 1)); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode} ao baixar ${url}`)); return; }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  const decision = plan(lock, process.argv.slice(2));
  if (decision.action === 'error') { console.error(decision.reason); process.exit(1); }
  if (decision.action === 'skip') { console.log(`[presentmon] ${decision.reason}`); return; }
  const buffer = await download(lock.url);
  const actual = sha256(buffer);
  if (decision.action === 'print-hash') {
    console.log(`Arquivo: ${lock.asset}\nTamanho: ${buffer.length} bytes\nSHA-256: ${actual}\nCompare com o digest mostrado pelo GitHub na página da release v${lock.version} antes de fixar.`);
    return;
  }
  if (!verify(buffer, lock.sha256)) { console.error(`[presentmon] HASH DIFERENTE do fixado. Esperado ${normalize(lock.sha256)}, calculado ${actual}. Nada foi gravado.`); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buffer);
  console.log(`[presentmon] ${lock.asset} verificado (SHA-256 confere) e gravado em third-party/bin.`);
}

if (require.main === module) main().catch((error) => { console.error(`[presentmon] ${error.message}`); process.exit(1); });
module.exports = { plan, verify, sha256 };
