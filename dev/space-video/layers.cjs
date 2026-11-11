/*
 * Gera as camadas do vídeo do fundo (céu, estrelas e aurora) com o mesmo desenho de src/space.js, no Chromium do
 * Playwright, para o render.py animar. Uso: node dev/space-video/layers.cjs <pasta de saída> [largura] [altura]
 * A largura/altura já incluem a sobra para a câmera andar (o vídeo final é recortado no centro).
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const Space = require('../../src/space.js');

async function main() {
  const out = path.resolve(process.argv[2] || 'space-layers');
  const W = Number(process.argv[3]) || 1968;
  const H = Number(process.argv[4]) || 1128;
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const jobs = [['sky', 1, false], ['aurora', 1, true], ['stars', 2, true]];
  for (const [layer, scale, transparent] of jobs) {
    const w = W * scale;
    const h = H * scale;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const markup = Space.svg('page', { prefix: 'video', layer }).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `);
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:${transparent ? 'transparent' : '#000'}}svg{display:block}</style></head><body>${markup}</body></html>`);
    const started = Date.now();
    await page.screenshot({ path: path.join(out, `${layer}.png`), omitBackground: transparent, timeout: 600000 });
    console.log(`${layer}: ${w}x${h} em ${Math.round((Date.now() - started) / 1000)} s`);
    await page.close();
  }
  await browser.close();
}
main().catch((error) => { console.error(error); process.exit(1); });
