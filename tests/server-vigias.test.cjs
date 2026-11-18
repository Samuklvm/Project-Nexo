/* Vigias de erro no servidor: avisos juntados por vigia (painel e conector). Spec: docs/superpowers/specs/2026-11-18-vigias-de-erro-design.md */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/server-harness.cjs');

const DAY = 24 * 3600 * 1000;
const EMAIL_RE = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
let h;
test.before(async () => { h = await createHarness(); });

let sigN = 0;
const sig = () => (++sigN).toString(16).padStart(16, 'a');
/** Manda um relatório (erros e avisos) como o app manda. */
function send(call, installId, version, reports, extra = {}) {
  return call('POST', '/v1/errors', { body: { installId, version, platform: 'win32', reports: reports.map((r) => ({ source: 'interface', level: 'aviso', count: 1, firstAt: h.clock.now, lastAt: h.clock.now, ...r })), ...extra } });
}
const ctx = (vigia, extra = {}) => JSON.stringify({ tela: 'home', ...(vigia ? { vigia } : {}), ...extra });

async function seedVigias(call) {
  const leitura = sig();
  const fonte = sig();
  const antigo = sig();
  const erro = sig();
  const cortado = sig();
  await send(call, 'install-aaaaaaaa0001', '0.11.4', [{ signature: leitura, message: 'Leitura impossível do PC: cpu', context: ctx('leitura-impossivel', { campo: 'cpu', valor: 120 }), count: 4 }]);
  await send(call, 'install-aaaaaaaa0002', '0.11.4', [{ signature: leitura, message: 'Leitura impossível do PC: cpu', context: ctx('leitura-impossivel', { campo: 'cpu', valor: 130 }) }, { signature: fonte, message: 'Fonte de dados dos cartões falhando: processes', context: ctx('fonte-falhando', { fonte: 'processes' }) }]);
  await send(call, 'install-aaaaaaaa0003', '0.11.3', [{ signature: antigo, message: 'A tela travou por 2.5 s', context: ctx(null, { ms: 2500 }) }], { contactEmail: 'pessoa@exemplo.com', includeEmail: true });
  await send(call, 'install-aaaaaaaa0001', '0.11.4', [{ signature: erro, level: 'erro', message: 'Erro de verdade', context: ctx(null) }]);
  // Contexto cortado no limite (JSON inválido): o vigia ainda é achado no começo do texto.
  await send(call, 'install-aaaaaaaa0004', '0.11.4', [{ signature: cortado, message: 'O Nexo está usando muita memória', context: `${ctx('memoria-alta', { totalMB: 1800 }).slice(0, -1)},"trilha":["1s tela home","2s ipc` }]);
  return { leitura, fonte, antigo, erro, cortado };
}

test('vigias: avisos juntados por vigia, com PCs, ocorrências e versões; erros ficam de fora; sem vigia = outro', async () => {
  const env = h.setup();
  await seedVigias(env.call);
  const owner = await env.panelCookie();
  const res = await env.call('GET', '/painel/api/vigias?dias=7', { cookie: owner });
  assert.equal(res.status, 200);
  const by = Object.fromEntries(res.data.vigias.map((v) => [v.vigia, v]));
  assert.deepEqual(Object.keys(by).sort(), ['fonte-falhando', 'leitura-impossivel', 'memoria-alta', 'outro']);
  assert.equal(by['leitura-impossivel'].pcs, 2);
  assert.equal(by['leitura-impossivel'].ocorrencias, 5);
  assert.equal(by['leitura-impossivel'].grupos, 1);
  assert.equal(by['leitura-impossivel'].abertos, 1);
  assert.deepEqual(by['leitura-impossivel'].versoes, ['0.11.4']);
  assert.equal(by['leitura-impossivel'].exemplo, 'Leitura impossível do PC: cpu');
  assert.equal(by.outro.pcs, 1);
  assert.equal(res.data.vigias[0].vigia, 'leitura-impossivel', 'mais PCs primeiro');
  assert.equal(res.data.total.avisosAbertos, 4);
  assert.doesNotMatch(JSON.stringify(res.data), EMAIL_RE, 'sem e-mail');
});

test('vigias: só o período pedido; leitura pode ver; sem login, 401', async () => {
  const env = h.setup();
  await seedVigias(env.call);
  h.tick(10 * DAY);
  const owner = await env.panelCookie();
  await env.call('POST', '/painel/api/equipe', { cookie: owner, headers: { 'x-nexo-painel': '1' }, body: { email: 'leitor@exemplo.com', role: 'leitura' } });
  const reader = await env.panelCookie('leitor@exemplo.com');
  assert.deepEqual((await env.call('GET', '/painel/api/vigias?dias=7', { cookie: reader })).data.vigias, []);
  assert.equal((await env.call('GET', '/painel/api/vigias?dias=30', { cookie: reader })).data.vigias.length, 4);
  assert.equal((await env.call('GET', '/painel/api/vigias')).status, 401);
});

test('avisos não viram regressão nem tiram o "% sem erro" da versão', async () => {
  const env = h.setup();
  const pc = require('node:crypto').createHash('sha256').update('nexo-pc-v1|R1').digest('hex');
  await env.call('POST', '/v1/pulse', { body: { pc, version: '0.11.4', platform: 'win32' } });
  h.tick(60000);
  await seedVigias(env.call);
  const versoes = await env.call('GET', '/painel/api/versoes', { cookie: await env.panelCookie() });
  const nova = versoes.data.versoes.find((v) => v.version === '0.11.4');
  assert.deepEqual(nova.regressoes.map((r) => r.message), ['Erro de verdade'], 'só o erro, nenhum aviso');
});

test('painel: aba Erros tem o cartão Vigias', async () => {
  const env = h.setup();
  const page = await env.call('GET', '/painel', { cookie: await env.panelCookie(), raw: true });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="vigias"/);
});

test('"PCs com erro (7 dias)" conta só quem teve ERRO, não quem só mandou aviso', async () => {
  const env = h.setup();
  await seedVigias(env.call);
  const summary = await env.call('GET', '/painel/api/resumo', { cookie: await env.panelCookie() });
  assert.equal(summary.data.reportingInstalls7, 1, 'só install-aaaaaaaa0001 teve erro');
  assert.equal(summary.data.avisosAbertos, 4);
});
