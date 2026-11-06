const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createErrorLog, makeRedactor, signatureOf, MAX_BYTES, PER_HOUR } = require('../electron/error-log.cjs');

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'nexo-log-'));

test('esconde pasta pessoal, nome de usuário, tokens e chaves', () => {
  const redact = makeRedactor({ home: 'C:\\Users\\samue', user: 'samue' });
  assert.equal(redact('falhou em C:\\Users\\samue\\AppData\\x.json'), 'falhou em ~\\AppData\\x.json');
  assert.equal(redact('c:/users/samue/Desktop/a.txt'), '~/Desktop/a.txt');
  assert.equal(redact('D:\\Users\\Outra Pessoa\\a'), 'D:\\Users\\<usuário>\\a');
  assert.equal(redact('/home/joana/.config/nexo'), '/home/<usuário>/.config/nexo');
  assert.equal(redact('a conta samue entrou'), 'a conta <usuário> entrou');
  assert.equal(redact('https://api?key=ABC123&steamid=1'), 'https://api?key=<oculto>&steamid=1');
  assert.equal(redact('https://x/cb?state=s&code=4/abc'), 'https://x/cb?state=s&code=<oculto>');
  assert.equal(redact('saiu com code=1223'), 'saiu com code=1223', 'código de saída não é segredo');
  assert.equal(redact('Authorization: Bearer abcdefghijklmnop'), 'Authorization: Bearer <oculto>');
  assert.match(redact('id eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw.assinatura12'), /<jwt oculto>/);
  assert.match(redact('chave 0123456789ABCDEF0123456789ABCDEF'), /<chave oculta>/);
});

test('assinatura: o mesmo erro em linhas, números e pastas diferentes cai no mesmo grupo', () => {
  const a = signatureOf({ source: 'ipc', message: 'Falhou 12 vezes em "C:\\a"', stack: 'Error: x\n    at foo (C:\\a\\b.js:10:5)\n    at bar (C:\\a\\c.js:3:1)' });
  const b = signatureOf({ source: 'ipc', message: 'Falhou 99 vezes em "D:\\z"', stack: 'Error: x\n    at foo (D:\\z\\b.js:11:9)\n    at bar (D:\\z\\c.js:4:2)' });
  const c = signatureOf({ source: 'interface', message: 'Falhou 12 vezes em "C:\\a"', stack: 'Error: x\n    at foo (C:\\a\\b.js:10:5)' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('grava, agrupa, exporta e limpa', async () => {
  const dir = await tempDir();
  let clock = 1_000_000;
  const log = createErrorLog({ fs, path, dir, version: '0.8.2', home: 'C:\\Users\\samue', user: 'samue', now: () => clock });
  log.record({ source: 'interface', message: 'Cannot read x de C:\\Users\\samue\\a', stack: 'TypeError: x\n    at f (view.js:1:2)', context: { tela: 'home' } });
  clock += 1000;
  log.record({ source: 'interface', message: 'Cannot read x de C:\\Users\\samue\\b', stack: 'TypeError: x\n    at f (view.js:1:9)', context: { tela: 'lab' } });
  log.record({ source: 'ipc', level: 'aviso', message: 'Você recusou a permissão', context: { acao: 'scan:apply' } });
  log.record({ source: 'qualquer-coisa', level: 'xyz', message: null });
  const result = await log.list();
  assert.equal(result.total, 4);
  assert.equal(result.groups.length, 3);
  const ui = result.groups.find((group) => group.source === 'interface');
  assert.equal(ui.count, 2);
  assert.match(ui.message, /~\\b$/, 'a mensagem mais recente, já sem a pasta pessoal');
  assert.equal(ui.context, '{"tela":"lab"}');
  assert.deepEqual(ui.versions, ['0.8.2']);
  const odd = result.groups.find((group) => group.message === 'Erro sem mensagem');
  assert.equal(odd.source, 'principal');
  assert.equal(odd.level, 'erro');
  const text = await log.exportText();
  assert.match(text, /Nexo Device Care 0\.8\.2/);
  assert.doesNotMatch(text, /samue/);
  await log.clear();
  assert.equal((await log.list()).total, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('erro em loop não enche o disco; arquivo gira em 512 KB', async () => {
  const dir = await tempDir();
  let clock = 5_000_000;
  const log = createErrorLog({ fs, path, dir, now: () => clock });
  for (let i = 0; i < 200; i += 1) log.record({ message: 'sempre o mesmo', stack: 'Error\n    at loop (a.js:1:1)' });
  assert.equal((await log.list()).total, PER_HOUR, 'depois de 20 na mesma hora, só conta');
  clock += 3600000;
  log.record({ message: 'sempre o mesmo', stack: 'Error\n    at loop (a.js:1:1)' });
  assert.equal((await log.list()).total, PER_HOUR + 1, 'na hora seguinte volta a gravar');
  // Muitos erros diferentes: o arquivo gira e o total em disco fica limitado.
  for (let i = 0; i < 1500; i += 1) log.record({ message: `erro diferente ${'x'.repeat(i % 7)} ${String.fromCharCode(65 + (i % 26))}${i}`, stack: `Error\n    at f${i} (a.js:1:1)`, context: 'y'.repeat(400) });
  await log.list();
  const files = await fs.readdir(dir);
  let total = 0;
  for (const name of files) total += (await fs.stat(path.join(dir, name))).size;
  assert.ok(files.length <= 2, files.join(','));
  assert.ok(total <= MAX_BYTES * 2 + 8192, String(total));
  await fs.rm(dir, { recursive: true, force: true });
});

test('nunca lança, nem com o disco recusando', async () => {
  const broken = { mkdir: async () => { throw new Error('sem permissão'); }, appendFile: async () => { throw new Error('x'); }, stat: async () => { throw new Error('x'); }, readFile: async () => { throw new Error('x'); }, rm: async () => {}, rename: async () => {} };
  const log = createErrorLog({ fs: broken, path, dir: '/nao/existe' });
  assert.doesNotThrow(() => log.record({ message: 'oi', context: { circular: (() => { const o = {}; o.o = o; return o; })() } }));
  assert.deepEqual((await log.list()).groups, []);
});
