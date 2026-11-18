/*
 * Drivers com um clique: conferência de assinatura, tarefa de administrador que instala e o motor de download
 * (fila, retomada, só domínio oficial, hash e assinatura antes de liberar o arquivo).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Sig = require('../electron/driver-signature.cjs');

const DIR = 'C:\\Users\\a\\AppData\\Roaming\\Nexo\\driver-downloads';

test('assinatura: script cita o caminho com psQuote e confere organização exata', () => {
  const s = Sig.signatureScript("C:\\Users\\a'b\\driver-downloads\\x.exe", 'NVIDIA Corporation');
  assert.match(s, /Get-AuthenticodeSignature -LiteralPath 'C:\\Users\\a''b\\driver-downloads\\x\.exe'/);
  assert.match(s, /Status -eq 'Valid'/);
  assert.match(s, /'NVIDIA Corporation'/);
  assert.doesNotMatch(s, /Invoke-Expression|\biex\b/);
});

test('assinatura: parse só aceita Valid e o assinante esperado', () => {
  assert.deepEqual(Sig.parseSignature('{"status":"Valid","org":"NVIDIA Corporation"}', 'NVIDIA Corporation'), { valid: true, signer: 'NVIDIA Corporation', status: 'Valid' });
  assert.equal(Sig.parseSignature('{"status":"Valid","org":"NVIDIA Corp Fake"}', 'NVIDIA Corporation').valid, false);
  assert.equal(Sig.parseSignature('{"status":"HashMismatch","org":"NVIDIA Corporation"}', 'NVIDIA Corporation').valid, false);
  assert.equal(Sig.parseSignature('lixo', 'NVIDIA Corporation').valid, false);
  assert.equal(Sig.parseSignature('{"status":"Valid","org":"NVIDIA Corporation"}', 'Microsoft Corporation').valid, false);
});

test('assinatura: insideDir recusa fora da pasta, .. e extensão errada', () => {
  assert.equal(Sig.insideDir(`${DIR}\\nvidia-572.16.exe`, DIR), true);
  assert.equal(Sig.insideDir(`${DIR.toUpperCase()}\\x.msi`, DIR), true);
  assert.equal(Sig.insideDir(`${DIR}\\..\\evil.exe`, DIR), false);
  assert.equal(Sig.insideDir('C:\\Windows\\System32\\cmd.exe', DIR), false);
  assert.equal(Sig.insideDir(`${DIR}\\x.ps1`, DIR), false);
  assert.equal(Sig.insideDir('\\\\servidor\\share\\x.exe', DIR), false);
  assert.equal(Sig.insideDir(`${DIR}-irmao\\x.exe`, DIR), false);
  assert.equal(Sig.insideDir(`${DIR}\\sub\\x.exe`, DIR), false, 'só arquivo direto na pasta');
});

test('assinatura: lista de assinantes permitidos', () => {
  assert.equal(Sig.SIGNERS.nvidia, 'NVIDIA Corporation');
  assert.equal(Sig.SIGNERS.microsoft, 'Microsoft Corporation');
  assert.equal(Sig.allowedSigner('NVIDIA Corporation'), true);
  assert.equal(Sig.allowedSigner('Evil Corp'), false);
});

/* ---------------- Tarefa de administrador: driver-install ---------------- */
const E = require('../electron/elevate.cjs');
const fakeFs = () => ({ mkdir: async () => {}, readFile: async () => { throw new Error('sem resposta'); }, rm: async () => {} });

test('driver-install: recusa arquivo fora da pasta e assinante fora da lista', () => {
  const dir = 'C:\\N\\driver-downloads';
  assert.throws(() => E.driverInstallBody({ file: 'C:\\Windows\\x.exe', dir, signer: 'NVIDIA Corporation' }), /Arquivo não permitido/);
  assert.throws(() => E.driverInstallBody({ file: `${dir}\\x.exe`, dir, signer: 'Evil Corp' }), /Assinante não permitido/);
  assert.throws(() => E.TASKS['driver-install']({ file: `${dir}\\..\\x.exe`, dir, signer: 'NVIDIA Corporation' }), /Arquivo não permitido/);
});

test('driver-install: confere assinatura antes, ponto opcional e não instala se o ponto falhar', () => {
  const dir = 'C:\\N\\driver-downloads';
  const on = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: true, description: 'Nexo - antes de instalar o driver de vídeo' });
  assert.ok(on.indexOf('Get-AuthenticodeSignature') < on.indexOf('Process]::Start('));
  assert.ok(on.indexOf('Checkpoint-Computer') < on.indexOf('Process]::Start('));
  assert.match(on, /if \(-not \$r\.restore\.ok\)/);
  assert.match(on, /Set-Content -LiteralPath \$NexoOut/);
  const off = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: false });
  assert.doesNotMatch(off, /Checkpoint-Computer/);
  assert.ok(E.TASKS['driver-install']);
  const long = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: true, description: `x'${'a'.repeat(200)}` });
  assert.doesNotMatch(long, /a{70}/, 'descrição cortada em 64');
});

test('driver-install: roda uma CÓPIA conferida numa pasta só de administrador (sem janela para trocar o arquivo)', () => {
  const dir = 'C:\\N\\driver-downloads';
  const body = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signer: 'NVIDIA Corporation', restorePoint: true });
  assert.match(body, /SetAccessRuleProtection\(\$true, \$false\)/, 'sem herdar permissões da pasta Temp');
  assert.match(body, /S-1-5-18/);
  assert.match(body, /S-1-5-32-544/);
  assert.match(body, /\[System\.IO\.Directory\]::CreateDirectory\(\$work, \$acl\)/, 'a pasta já nasce protegida');
  assert.match(body, /Join-Path \$env:SystemRoot 'Temp'/);
  const point = body.indexOf('Checkpoint-Computer');
  const copy = body.indexOf('[System.IO.File]::Copy(');
  const verifyCopy = body.indexOf('Get-AuthenticodeSignature -LiteralPath $dst');
  const run = body.indexOf('[System.Diagnostics.Process]::Start(');
  assert.ok(copy > 0 && copy < verifyCopy && verifyCopy < point && point < run, 'copia → confere a cópia → ponto de restauração → roda a cópia (sem ponto à toa quando a cópia não confere)');
  assert.doesNotMatch(body, /Start-Process/, 'Start-Process espera a árvore toda e interpreta [ ] no caminho');
  assert.match(body, /\$p\.WaitForExit\(\)/);
  assert.match(body, /finally \{[^}]*Remove-Item -LiteralPath \$work -Recurse -Force/);
});

test('elevate: driver-install usa o tempo-limite longo; as outras o de sempre', async () => {
  const used = [];
  const elevate = E.createElevator({ runPowerShell: async (_s, t) => { used.push(t); return { code: 0 }; }, fs: fakeFs(), path: require('node:path').win32, dir: 'C:\\N\\elevate' });
  await elevate('driver-install', { file: 'C:\\N\\driver-downloads\\nv.exe', dir: 'C:\\N\\driver-downloads', signer: 'NVIDIA Corporation' });
  await elevate('net-flush', {});
  assert.deepEqual(used, [3 * 60 * 60 * 1000, 240000]);
});

/* ---------------- Motor de download e fila de instalação ---------------- */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const DL = require('../electron/driver-download.cjs');

const sha512 = (buf) => crypto.createHash('sha512').update(buf).digest('hex');
const NV = 'https://us.download.nvidia.com/Windows/621.14/x.exe';
const plan = (extra = {}) => ({ url: NV, domains: ['nvidia.com'], fileName: 'nvidia-621.14.exe', signer: 'NVIDIA Corporation', ...extra });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async (engine, id, phases = ['ready', 'error', 'canceled', 'installed']) => {
  for (let i = 0; i < 2500; i += 1) { const item = engine.list().find((x) => x.id === id); if (item && phases.includes(item.phase)) return item; await new Promise((resolve) => setTimeout(resolve, 2)); }
  throw new Error(`não terminou: ${JSON.stringify(engine.list().find((x) => x.id === id))}`);
};

/** Servidor falso: url → { status, headers, location, chunks, cut, gate }. Guarda cada pedido (url e cabeçalhos). */
function server(routes) {
  const calls = [];
  calls.aborts = 0;
  const request = async (url, { headers = {} } = {}) => {
    calls.push({ url, headers });
    const route = typeof routes[url] === 'function' ? routes[url]({ url, headers, calls }) : routes[url];
    if (!route) throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' });
    let aborted = false;
    return {
      status: route.status || 200, headers: route.headers || {}, location: route.location || null,
      abort: () => { aborted = true; calls.aborts += 1; },
      body: (async function* body() {
        for (const chunk of route.chunks || []) {
          if (route.gate) await route.gate();
          if (aborted) throw Object.assign(new Error('aborted'), { code: 'ABORTED' });
          yield chunk;
        }
        if (route.cut) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      })()
    };
  };
  return { request, calls };
}

function engineWith({ routes, signer = 'NVIDIA Corporation', fsApi = fs.promises, elevate = async () => ({ result: { ok: true, code: 0 } }), now = () => Date.now(), max } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-dl-'));
  const srv = server(routes);
  const events = [];
  const engine = DL.createDriverDownloads({
    request: srv.request, fs: fsApi, path, crypto, dir, now, max,
    runPowerShell: async () => ({ stdout: JSON.stringify({ status: 'Valid', org: signer }) }),
    elevate, emit: (channel, item) => events.push({ channel, ...item })
  });
  return { engine, dir, calls: srv.calls, events };
}

const BODY = Buffer.alloc(3000, 7);
const chunks = (buf, size = 1000) => { const out = []; for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size)); return out; };

test('download: baixa, confere e fica ready', async () => {
  const { engine, dir, events } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } } });
  engine.start('video-rtx', plan());
  const item = await settle(engine, 'video-rtx');
  assert.equal(item.phase, 'ready');
  assert.equal(item.signer, 'NVIDIA Corporation');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => !f.endsWith('.json')), ['nvidia-621.14.exe']);
  assert.equal(fs.readFileSync(path.join(dir, 'nvidia-621.14.exe')).length, 3000);
  assert.equal(engine.fileOf('video-rtx'), path.join(dir, 'nvidia-621.14.exe'));
  assert.ok(events.every((e) => e.channel === 'drivers:download'));
  assert.deepEqual([...new Set(events.map((e) => e.phase))], ['queued', 'downloading', 'verifying', 'ready']);
});

test('download: recusa cartão sem plano', () => {
  const { engine } = engineWith({ routes: {} });
  assert.throws(() => engine.start('video-intel', null), /não tem download direto/);
  assert.throws(() => engine.start('x', plan({ fileName: '..\\evil.exe' })), /Arquivo inválido/);
  assert.throws(() => engine.start('x', plan({ url: 'http://us.download.nvidia.com/x.exe' })), /fora do site oficial/);
});

test('download: fila com 6 pedidos, 4 baixando e 2 esperando com a posição', async () => {
  let open = null;
  const wait = new Promise((resolve) => { open = resolve; });
  const routes = {};
  for (let i = 0; i < 6; i += 1) routes[`https://us.download.nvidia.com/${i}.exe`] = { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')], gate: () => wait };
  const { engine } = engineWith({ routes });
  for (let i = 0; i < 6; i += 1) engine.start(`id${i}`, plan({ url: `https://us.download.nvidia.com/${i}.exe`, fileName: `f${i}.exe` }));
  await tick();
  const list = engine.list();
  assert.equal(list.filter((x) => x.phase === 'downloading').length, 4);
  assert.deepEqual(list.filter((x) => x.phase === 'queued').map((x) => [x.id, x.position]), [['id4', 1], ['id5', 2]]);
  open();
  for (let i = 0; i < 6; i += 1) assert.equal((await settle(engine, `id${i}`)).phase, 'ready');
});

test('download: redirecionamento para fora do domínio aborta; mais de 5 viram redirects', async () => {
  const a = engineWith({ routes: { [NV]: { status: 302, location: 'https://evil.example/x.exe' } } });
  a.engine.start('v', plan());
  assert.equal((await settle(a.engine, 'v')).error, 'domain');
  assert.equal(a.calls.some((c) => c.url.includes('evil')), false, 'nem chega a pedir o domínio de fora');
  const routes = { [NV]: { status: 302, location: 'https://us.download.nvidia.com/r1' } };
  for (let i = 1; i <= 6; i += 1) routes[`https://us.download.nvidia.com/r${i}`] = { status: 301, location: `/r${i + 1}` };
  const b = engineWith({ routes });
  b.engine.start('v', plan());
  assert.equal((await settle(b.engine, 'v')).error, 'redirects');
  const ok = engineWith({ routes: { [NV]: { status: 302, location: '/final.exe' }, 'https://us.download.nvidia.com/final.exe': { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } } });
  ok.engine.start('v', plan());
  assert.equal((await settle(ok.engine, 'v')).phase, 'ready', 'redirecionamento dentro do domínio oficial segue');
});

test('download: mais bytes que o Content-Length ou acima de 1,5 GB viram too-big', async () => {
  const a = engineWith({ routes: { [NV]: { headers: { 'content-length': '1000' }, chunks: chunks(BODY) } } });
  a.engine.start('v', plan());
  assert.equal((await settle(a.engine, 'v')).error, 'too-big');
  assert.deepEqual(fs.readdirSync(a.dir).filter((f) => f.endsWith('.part')), [], 'apaga o pedaço');
  const b = engineWith({ routes: { [NV]: { headers: { 'content-length': String(DL.MAX_BYTES + 1) }, chunks: [] } } });
  b.engine.start('v', plan());
  assert.equal((await settle(b.engine, 'v')).error, 'too-big');
  assert.equal(DL.MAX_BYTES, 1536 * 1024 * 1024);
});

test('download: continua com Range quando há Accept-Ranges e recomeça sem', async () => {
  let first = true;
  const routes = { [NV]: ({ headers }) => {
    if (first) { first = false; return { headers: { 'content-length': '3000', 'accept-ranges': 'bytes', etag: '"v1"' }, chunks: chunks(BODY).slice(0, 2), cut: true }; }
    assert.equal(headers.Range, 'bytes=2000-');
    assert.equal(headers['If-Range'], '"v1"', 'só continua se o arquivo do servidor ainda for o mesmo');
    return { status: 206, headers: { 'content-length': '1000', 'content-range': 'bytes 2000-2999/3000' }, chunks: [BODY.subarray(2000)] };
  } };
  const a = engineWith({ routes });
  a.engine.start('v', plan({ sha512: sha512(BODY) }));
  assert.equal((await settle(a.engine, 'v')).error, 'offline', 'a internet caiu: guarda o pedaço');
  assert.equal(fs.readdirSync(a.dir).filter((f) => f.endsWith('.part')).length, 1);
  a.engine.start('v', plan({ sha512: sha512(BODY) }));
  const done = await settle(a.engine, 'v');
  assert.equal(done.phase, 'ready', 'hash confere com o arquivo inteiro (pedaço antigo + resto)');
  assert.equal(fs.readFileSync(path.join(a.dir, 'nvidia-621.14.exe')).length, 3000);

  let again = true;
  const noRange = { [NV]: () => {
    if (again) { again = false; return { headers: { 'content-length': '3000' }, chunks: chunks(BODY).slice(0, 1), cut: true }; }
    return { status: 200, headers: { 'content-length': '3000' }, chunks: chunks(BODY) };
  } };
  const b = engineWith({ routes: noRange });
  b.engine.start('v', plan());
  await settle(b.engine, 'v');
  b.engine.start('v', plan());
  assert.equal((await settle(b.engine, 'v')).phase, 'ready');
  assert.equal(fs.readFileSync(path.join(b.dir, 'nvidia-621.14.exe')).length, 3000, 'servidor ignorou o Range: recomeçou do zero');
});

test('download: pedaço de outra versão não é retomado', async () => {
  const { engine, dir, calls } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } } });
  fs.writeFileSync(path.join(dir, 'nvidia-621.14.exe.velhaversao0.part'), Buffer.alloc(500));
  engine.start('v', plan());
  assert.equal((await settle(engine, 'v')).phase, 'ready');
  assert.equal(calls[0].headers.Range, undefined);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.part')), []);
});

test('download: hash errado e assinatura inválida apagam o arquivo', async () => {
  const a = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } } });
  a.engine.start('v', plan({ sha512: 'f'.repeat(128) }));
  assert.equal((await settle(a.engine, 'v')).error, 'hash');
  assert.deepEqual(fs.readdirSync(a.dir).filter((f) => f.endsWith('.exe') || f.endsWith('.part')), []);
  const b = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, signer: 'Outra Empresa' });
  b.engine.start('v', plan());
  assert.equal((await settle(b.engine, 'v')).error, 'signature');
  assert.deepEqual(fs.readdirSync(b.dir).filter((f) => f.endsWith('.exe') || f.endsWith('.part')), []);
});

test('download: ENOSPC vira erro disk e limpa', async () => {
  const full = { ...fs.promises, open: async (file, flags) => {
    const fh = await fs.promises.open(file, flags);
    let writes = 0;
    return { write: async (buf) => { writes += 1; if (writes > 1) throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); return fh.write(buf); }, read: (...a) => fh.read(...a), close: () => fh.close() };
  } };
  const { engine, dir } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, fsApi: full });
  engine.start('v', plan());
  assert.equal((await settle(engine, 'v')).error, 'disk');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.part')), []);
});

test('download: cancelar apaga o pedaço e libera a vaga', async () => {
  let open = null;
  const wait = new Promise((resolve) => { open = resolve; });
  const routes = { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY), gate: () => wait } };
  for (let i = 0; i < 4; i += 1) routes[`https://us.download.nvidia.com/${i}.exe`] = { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')], gate: () => wait };
  const { engine, dir } = engineWith({ routes });
  engine.start('v', plan());
  for (let i = 0; i < 4; i += 1) engine.start(`o${i}`, plan({ url: `https://us.download.nvidia.com/${i}.exe`, fileName: `o${i}.exe` }));
  await tick();
  assert.equal(engine.list().find((x) => x.id === 'o3').phase, 'queued');
  engine.cancel('v');
  open();
  assert.equal((await settle(engine, 'v')).phase, 'canceled');
  assert.equal((await settle(engine, 'o3')).phase, 'ready', 'a vaga liberada vai para o próximo da fila');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('nvidia')), []);
});

test('download: cancelar quem está na fila tira da fila', async () => {
  const wait = new Promise(() => {});
  const { engine } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')], gate: () => wait } }, max: 1 });
  engine.start('a', plan());
  engine.start('q', plan({ url: 'https://us.download.nvidia.com/q.exe', fileName: 'q.exe' }));
  assert.equal(engine.list().find((x) => x.id === 'q').phase, 'queued');
  engine.cancel('q');
  assert.equal(engine.list().find((x) => x.id === 'q').phase, 'canceled');
  engine.cancel('a');
});

test('download: o motor não depende da leitura depois de começar', async () => {
  const p = plan();
  const { engine } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } } });
  engine.start('v', p);
  p.url = 'https://evil.example/x.exe';
  p.signer = 'Evil';
  assert.equal((await settle(engine, 'v')).phase, 'ready');
  assert.deepEqual(engine.start('v', plan()).phase, 'ready', 'pedir de novo algo pronto não baixa de novo');
});

test('download: progresso limitado a 10 por segundo, mas a mudança de fase sempre sai', async () => {
  let t = 1000;
  const many = Array.from({ length: 50 }, () => Buffer.alloc(10, 1));
  const { engine, events } = engineWith({ routes: { [NV]: { headers: { 'content-length': '500' }, chunks: many } }, now: () => t });
  engine.start('v', plan());
  await settle(engine, 'v');
  const progress = events.filter((e) => e.phase === 'downloading');
  assert.ok(progress.length <= 2, `relógio parado: no máximo a entrada e 1 atualização (veio ${progress.length})`);
  assert.equal(events.at(-1).phase, 'ready');
  t += 0;
});

test('download: texto de velocidade e tempo restante', async () => {
  let t = 0;
  const gateTimes = [0, 500, 1000, 1500];
  let i = 0;
  const { engine, events } = engineWith({ routes: { [NV]: { headers: { 'content-length': '4000' }, chunks: chunks(Buffer.alloc(4000), 1000), gate: async () => { t = gateTimes[i++] ?? t; } } }, now: () => t });
  engine.start('v', plan());
  await settle(engine, 'v');
  const last = events.filter((e) => e.phase === 'downloading').at(-1);
  assert.ok(last.speed > 0);
  assert.equal(last.total, 4000);
});

test('instalar: uma de cada vez, recusa do administrador, reinício e ponto que falhou', async () => {
  const order = [];
  let release = null;
  const answers = [
    () => new Promise((resolve) => { release = () => resolve({ result: { ok: true, code: 0, restore: { ok: true, created: true, at: '2026-11-17T17:32:00Z' } } }); }),
    async () => ({ declined: true, code: 1223, result: null }),
    async () => ({ result: { ok: true, code: 3010 } }),
    async () => ({ result: { ok: false, code: null, restore: { ok: false, note: 'a Proteção do Sistema está desligada nesta unidade' }, note: 'ponto de restauração não criado' } })
  ];
  let n = 0;
  const elevate = async (task, args) => { order.push([task, args.restorePoint]); return answers[n++](); };
  const routes = {};
  for (let i = 0; i < 4; i += 1) routes[`https://us.download.nvidia.com/${i}.exe`] = { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')] };
  const { engine, dir } = engineWith({ routes, elevate });
  for (let i = 0; i < 4; i += 1) { engine.start(`i${i}`, plan({ url: `https://us.download.nvidia.com/${i}.exe`, fileName: `i${i}.exe` })); await settle(engine, `i${i}`); }
  const first = engine.install('i0', { restorePoint: true });
  const second = engine.install('i1', { restorePoint: false });
  await tick(); await tick();
  assert.equal(order.length, 1, 'o segundo espera o primeiro terminar');
  assert.equal(engine.list().find((x) => x.id === 'i1').phase, 'install-queued');
  release();
  const r0 = await first;
  assert.deepEqual([r0.ok, r0.restart, r0.restore.at], [true, false, '2026-11-17T17:32:00Z']);
  assert.equal(engine.list().find((x) => x.id === 'i0').phase, 'installed');
  const r1 = await second;
  assert.deepEqual([r1.ok, r1.declined], [false, true]);
  assert.match(r1.note, /recusou a permissão de administrador/);
  assert.equal(engine.list().find((x) => x.id === 'i1').phase, 'ready');
  const r2 = await engine.install('i2', { restorePoint: true });
  assert.deepEqual([r2.ok, r2.restart], [true, true]);
  const r3 = await engine.install('i3', { restorePoint: true });
  assert.equal(r3.ok, false);
  assert.equal(r3.restore.ok, false);
  assert.match(r3.note, /Proteção do Sistema/);
  assert.equal(engine.list().find((x) => x.id === 'i3').phase, 'ready');
  assert.deepEqual(order.map((o) => o[0]), ['driver-install', 'driver-install', 'driver-install', 'driver-install']);
  assert.deepEqual(order.map((o) => o[1]), [true, false, true, true]);
  assert.equal(order.length, 4);
  await assert.rejects(engine.install('nao-baixado', { restorePoint: true }), /ainda não foi baixado/);
  assert.ok(fs.existsSync(dir));
});

test('download: servidor que para de mandar dados sem fechar libera a vaga (tempo ocioso)', async () => {
  const forever = new Promise(() => {});
  let first = true;
  const routes = {
    [NV]: { headers: { 'content-length': '3000', 'accept-ranges': 'bytes', etag: '"v9"' }, chunks: chunks(BODY), gate: () => { if (first) { first = false; return undefined; } return forever; } },
    'https://us.download.nvidia.com/q.exe': { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')] }
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-dl-'));
  const srv = server(routes);
  const engine = DL.createDriverDownloads({ request: srv.request, fs: fs.promises, path, crypto, dir, max: 1, idleMs: 60,
    runPowerShell: async () => ({ stdout: JSON.stringify({ status: 'Valid', org: 'NVIDIA Corporation' }) }), elevate: async () => ({}), emit: () => {} });
  engine.start('v', plan());
  engine.start('q', plan({ url: 'https://us.download.nvidia.com/q.exe', fileName: 'q.exe' }));
  const stalled = await settle(engine, 'v');
  assert.equal(stalled.error, 'offline');
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('nvidia-') && f.endsWith('.part')).length, 1, 'guarda o pedaço para continuar');
  assert.equal((await settle(engine, 'q')).phase, 'ready', 'a vaga foi liberada');
  assert.equal(DL.IDLE_MS, 60000);
});

test('instalar: sem resposta no tempo-limite avisa que o instalador ainda pode estar aberto', async () => {
  const { engine } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')] } }, elevate: async () => ({ code: 1, result: null }) });
  engine.start('v', plan());
  await settle(engine, 'v');
  const r = await engine.install('v', { restorePoint: false });
  assert.equal(r.ok, false);
  assert.match(r.note, /ainda pode estar aberta/);
});

test('limpeza: apaga instalados há mais de 14 dias e pedaços há mais de 7', async () => {
  const DAY = 24 * 3600 * 1000;
  let t = Date.parse('2026-11-17T12:00:00Z');
  const { engine, dir } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')] } }, now: () => t });
  engine.start('v', plan());
  await settle(engine, 'v');
  await engine.install('v', { restorePoint: false });
  const old = path.join(dir, 'x.exe.abc123abc123.part');
  const fresh = path.join(dir, 'y.exe.abc123abc123.part');
  fs.writeFileSync(old, 'x'); fs.writeFileSync(fresh, 'y');
  fs.utimesSync(old, new Date(t - 8 * DAY), new Date(t - 8 * DAY));
  t += 15 * DAY;
  fs.utimesSync(fresh, new Date(t - 2 * DAY), new Date(t - 2 * DAY));
  await engine.cleanup();
  const left = fs.readdirSync(dir).filter((f) => !f.endsWith('.json'));
  assert.deepEqual(left, ['y.exe.abc123abc123.part']);
});

/* ---------------- Correções da revisão (cada uma com o cenário que quebrava) ---------------- */
const quiet = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-dl-'));
  const srv = server(extra.routes || {});
  const engine = DL.createDriverDownloads({ request: extra.request || srv.request, fs: extra.fs || fs.promises, path, crypto, dir, max: extra.max,
    runPowerShell: async () => ({ stdout: JSON.stringify({ status: 'Valid', org: 'NVIDIA Corporation' }) }), elevate: async () => ({}), emit: () => {} });
  return { engine, dir, calls: srv.calls };
};

test('revisão: pedaço sem identificação do arquivo (ETag/Last-Modified) não é emendado', async () => {
  let first = true;
  const { engine, calls } = quiet({ routes: { [NV]: () => {
    if (first) { first = false; return { headers: { 'content-length': '3000', 'accept-ranges': 'bytes' }, chunks: chunks(BODY).slice(0, 2), cut: true }; }
    return { headers: { 'content-length': '3000' }, chunks: chunks(BODY) };
  } } });
  engine.start('v', plan());
  await settle(engine, 'v');
  engine.start('v', plan());
  assert.equal((await settle(engine, 'v')).phase, 'ready');
  assert.equal(calls[1].headers.Range, undefined, 'sem ETag nem Last-Modified: recomeça do zero (o permalink da Microsoft muda de conteúdo)');
});

test('revisão: resposta é fechada quando o download falha (http, tamanho no cabeçalho, hash)', async () => {
  const a = quiet({ routes: { [NV]: { status: 500 } } });
  a.engine.start('v', plan());
  assert.equal((await settle(a.engine, 'v')).error, 'http');
  assert.ok(a.calls.aborts >= 1);
  const b = quiet({ routes: { [NV]: { headers: { 'content-length': String(DL.MAX_BYTES + 1) }, chunks: [Buffer.alloc(1)] } } });
  b.engine.start('v', plan());
  assert.equal((await settle(b.engine, 'v')).error, 'too-big');
  assert.ok(b.calls.aborts >= 1);
});

test('revisão: 416 ao continuar = o pedaço já estava completo; 206 de outro ponto recomeça sem Range', async () => {
  let first = true;
  const a = quiet({ routes: { [NV]: () => {
    if (first) { first = false; return { headers: { 'content-length': '3000', 'accept-ranges': 'bytes', etag: '"v1"' }, chunks: chunks(BODY), cut: true }; }
    return { status: 416, headers: { 'content-range': 'bytes */3000' } };
  } } });
  a.engine.start('v', plan({ sha512: sha512(BODY) }));
  assert.equal((await settle(a.engine, 'v')).error, 'offline');
  a.engine.start('v', plan({ sha512: sha512(BODY) }));
  assert.equal((await settle(a.engine, 'v')).phase, 'ready', 'o arquivo inteiro já estava no disco');
  assert.equal(fs.readFileSync(path.join(a.dir, 'nvidia-621.14.exe')).length, 3000);

  let n = 0;
  const b = quiet({ routes: { [NV]: ({ headers }) => {
    n += 1;
    if (n === 1) return { headers: { 'content-length': '3000', 'accept-ranges': 'bytes', etag: '"v1"' }, chunks: chunks(BODY).slice(0, 1), cut: true };
    if (n === 2) return { status: 206, headers: { 'content-length': '2000', 'content-range': 'bytes 500-2499/3000' }, chunks: [BODY.subarray(500, 2500)] };
    assert.equal(headers.Range, undefined);
    return { headers: { 'content-length': '3000' }, chunks: chunks(BODY) };
  } } });
  b.engine.start('v', plan());
  await settle(b.engine, 'v');
  b.engine.start('v', plan());
  assert.equal((await settle(b.engine, 'v')).phase, 'ready');
  assert.equal(fs.readFileSync(path.join(b.dir, 'nvidia-621.14.exe')).length, 3000);
  assert.equal(n, 3);
});

test('revisão: cancelar enquanto o site ainda não respondeu vira cancelado (não erro)', async () => {
  let answer = null;
  const pending = new Promise((resolve) => { answer = resolve; });
  const fake = async () => { await pending; return { status: 500, headers: {}, abort: () => {}, body: (async function* none() {})() }; };
  const { engine } = quiet({ request: fake });
  engine.start('v', plan());
  await tick();
  engine.cancel('v');
  answer();
  assert.equal((await settle(engine, 'v')).phase, 'canceled');
});

test('revisão: aspas tipográficas no caminho (pasta do usuário D’Angelo) são escapadas', () => {
  assert.equal(Sig.psQuote('C:\\Users\\D’Angelo\\x.exe'), "'C:\\Users\\D’’Angelo\\x.exe'");
  assert.equal(Sig.psQuote('a‘b‚c‛d'), "'a‘‘b‚‚c‛‛d'");
  assert.equal(E.psQuote('D’A'), "'D’’A'");
  assert.match(E.driverInstallBody({ file: 'C:\\Users\\D’A\\AppData\\Local\\Nexo\\driver-downloads\\nv.exe', dir: 'C:\\Users\\D’A\\AppData\\Local\\Nexo\\driver-downloads', signer: 'NVIDIA Corporation' }), /D’’A/);
});

test('revisão: organização do certificado lida linha a linha do nome formatado (não por regex no Subject)', () => {
  const s = Sig.signatureScript('C:\\N\\driver-downloads\\x.exe', 'NVIDIA Corporation');
  assert.match(s, /SubjectName\.Format\(\$true\)/);
  assert.match(s, /-split "`r\?`n"/);
  assert.doesNotMatch(s, /\$subject -match/);
});

test('revisão: pasta de downloads fica no AppData Local (não vai junto no perfil móvel)', () => {
  assert.equal(DL.downloadsDir({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'C:\\Users\\a\\AppData\\Roaming\\Nexo', path.win32), 'C:\\Users\\a\\AppData\\Local\\Nexo\\driver-downloads');
  assert.equal(DL.downloadsDir({}, 'C:\\Users\\a\\AppData\\Roaming\\Nexo', path.win32), 'C:\\Users\\a\\AppData\\Roaming\\Nexo\\driver-downloads');
  assert.equal(DL.downloadsDir({ LOCALAPPDATA: '\\\\srv\\perfis\\a' }, 'C:\\Users\\a\\AppData\\Roaming\\Nexo', path.win32), 'C:\\Users\\a\\AppData\\Roaming\\Nexo\\driver-downloads', 'pasta de rede nunca');
});

test('revisão: o mesmo arquivo em dois cartões (duas placas iguais) não é baixado duas vezes ao mesmo tempo', async () => {
  const wait = new Promise(() => {});
  const { engine } = quiet({ routes: { [NV]: { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')], gate: () => wait } } });
  engine.start('video-a', plan());
  assert.throws(() => engine.start('video-b', plan()), /já está sendo baixado/);
  engine.cancel('video-a');
});

test('revisão: falha de disco que não é falta de espaço não diz "Sem internet"', async () => {
  const denied = { ...fs.promises, mkdir: async () => { throw Object.assign(new Error('negado'), { code: 'EACCES' }); } };
  const { engine } = quiet({ routes: { [NV]: { headers: { 'content-length': '3' }, chunks: [Buffer.from('abc')] } }, fs: denied });
  engine.start('v', plan());
  assert.equal((await settle(engine, 'v')).error, 'file');
});

/* ---------------- Projeto 2: pacotes do fabricante (zip, cab, inf) e vários assinantes ---------------- */
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const DELL = 'https://dl.dell.com/FOLDER1/1/Realtek-Audio_R1VKP.EXE';
const ASUS = 'https://dlcdnets.asus.com/pub/ASUS/mb/Realtek_Audio.zip';

test('assinatura: lista de nomes (-ccontains) e os fabricantes de PC e de peça permitidos', () => {
  const s = Sig.signatureScript(`${DIR}\\x.exe`, ['Dell Inc', 'Dell Inc.', 'Dell Technologies']);
  assert.match(s, /@\('Dell Inc', 'Dell Inc\.', 'Dell Technologies'\) -ccontains \$sig\.org/);
  assert.equal(Sig.parseSignature('{"status":"Valid","org":"Dell Inc."}', ['Dell Inc', 'Dell Inc.']).valid, true);
  assert.equal(Sig.parseSignature('{"status":"Valid","org":"dell inc."}', ['Dell Inc.']).valid, false, 'igualdade exata');
  assert.equal(Sig.parseSignature('{"status":"Valid","org":"Evil"}', ['Dell Inc.', 'Evil']).valid, false, 'nome fora da lista do app nunca vale');
  for (const name of ['Dell Inc.', 'HP Inc.', 'Lenovo', 'ASUSTeK COMPUTER INC.', 'Realtek Semiconductor Corp.', 'Intel Corporation']) assert.equal(Sig.allowedSigner(name), true, name);
  assert.equal(Sig.insideDir(`${DIR}\\Realtek_Audio.zip`, DIR), true);
  assert.equal(Sig.insideDir(`${DIR}\\x.cab`, DIR), true);
  assert.equal(Sig.insideDir(`${DIR}\\x.inf`, DIR), false);
});

test('download: zip confere o SHA-256 do fabricante (certo passa, errado apaga) e não pede Authenticode do zip', async () => {
  const good = engineWith({ routes: { [ASUS]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, signer: 'ASUSTeK COMPUTER INC.' });
  const ps = [];
  const zipPlan = { url: ASUS, domains: ['asus.com'], fileName: 'Realtek_Audio.zip', kind: 'zip', signers: ['ASUSTeK COMPUTER INC.', 'Realtek Semiconductor Corp.'], sha256: sha256(BODY), source: 'asus' };
  good.engine.start('oem-asus-a1', zipPlan);
  const ok = await settle(good.engine, 'oem-asus-a1');
  assert.equal(ok.phase, 'ready');
  assert.deepEqual(ps, []);
  const bad = engineWith({ routes: { [ASUS]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } } });
  bad.engine.start('oem-asus-a1', { ...zipPlan, sha256: 'a'.repeat(64) });
  assert.equal((await settle(bad.engine, 'oem-asus-a1')).error, 'hash');
  assert.equal(fs.readdirSync(bad.dir).filter((f) => f.endsWith('.zip')).length, 0);
});

test('download: MD5 só vale na Dell; fora dela é ignorado', async () => {
  const route = { [DELL]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } };
  const exe = { url: DELL, domains: ['dell.com'], fileName: 'Realtek-Audio_R1VKP.exe', kind: 'exe', signers: ['Dell Inc', 'Dell Inc.'] };
  const hp = engineWith({ routes: route, signer: 'Dell Inc.' });
  hp.engine.start('a', { ...exe, md5: 'f'.repeat(32), source: 'hp' });
  assert.equal((await settle(hp.engine, 'a')).phase, 'ready');
  const dellBad = engineWith({ routes: route, signer: 'Dell Inc.' });
  dellBad.engine.start('a', { ...exe, md5: 'f'.repeat(32), source: 'dell' });
  assert.equal((await settle(dellBad.engine, 'a')).error, 'hash');
  const dellOk = engineWith({ routes: route, signer: 'Dell Inc.' });
  dellOk.engine.start('a', { ...exe, md5: md5(BODY), source: 'dell' });
  assert.equal((await settle(dellOk.engine, 'a')).phase, 'ready');
});

test('download: vários assinantes passam no start e quem assinou vale se estiver na lista', async () => {
  const { engine } = engineWith({ routes: { [DELL]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, signer: 'Realtek Semiconductor Corp.' });
  engine.start('b', { url: DELL, domains: ['dell.com'], fileName: 'Realtek-Audio_R1VKP.exe', signers: ['Dell Inc.', 'Realtek Semiconductor Corp.'] });
  const item = await settle(engine, 'b');
  assert.equal(item.phase, 'ready');
  assert.equal(item.signer, 'Realtek Semiconductor Corp.');
  assert.throws(() => engine.start('c', { url: DELL, domains: ['dell.com'], fileName: 'x.exe', signers: ['Dell Inc.', 'Evil Corp'] }), /Assinante não permitido/);
  assert.throws(() => engine.start('d', { url: DELL, domains: ['dell.com'], fileName: 'x.exe', signers: [] }), /Assinante não permitido/);
});

test('instalar: a tarefa recebe o SHA-256 do que foi baixado, o tipo e os assinantes', async () => {
  const seen = [];
  const { engine } = engineWith({ routes: { [ASUS]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, elevate: async (task, args) => { seen.push(args); return { result: { ok: true, code: 0 } }; } });
  engine.start('z', { url: ASUS, domains: ['asus.com'], fileName: 'Realtek_Audio.zip', kind: 'zip', signers: ['ASUSTeK COMPUTER INC.'], source: 'asus' });
  await settle(engine, 'z');
  await engine.install('z', { restorePoint: false });
  assert.equal(seen[0].sha256, sha256(BODY));
  assert.equal(seen[0].kind, 'zip');
  assert.deepEqual(seen[0].signers, ['ASUSTeK COMPUTER INC.']);
});

test('driver-install: pacote zip confere o hash da cópia, abre, procura o instalador e só usa pnputil com .cat assinado', () => {
  const dir = 'C:\\N\\driver-downloads';
  const args = { file: `${dir}\\Realtek_Audio.zip`, dir, kind: 'zip', signers: ['ASUSTeK COMPUTER INC.', 'Realtek Semiconductor Corp.'], sha256: 'ab'.repeat(32) };
  const body = E.driverInstallBody(args);
  const at = (s) => { const i = body.indexOf(s); assert.ok(i >= 0, `falta ${s}`); return i; };
  assert.ok(at('[System.IO.File]::Copy(') < at('Get-FileHash -LiteralPath $dst -Algorithm SHA256'));
  assert.ok(at('Get-FileHash -LiteralPath $dst') < at('Expand-Archive -LiteralPath $dst'));
  assert.ok(at('Expand-Archive') < at("'setup.exe'"));
  assert.ok(at("'AsusSetup.exe'") < at("'install.exe'"));
  assert.ok(at('Get-AuthenticodeSignature -LiteralPath $setup') < at('pnputil.exe'));
  assert.ok(at("-Filter '*.cat'") < at('pnputil.exe'));
  assert.match(body, /pnputil\.exe \/add-driver \(Join-Path \$root '\*\.inf'\) \/subdirs \/install/);
  assert.match(body, /@\(0, 3010, 259\) -contains \$r\.code/);
  assert.match(body, /o pacote não tem instalador nem driver/);
  assert.match(body, /'Microsoft Corporation'/, 'o .cat assinado pela Microsoft (WHQL) vale');
  const cab = E.driverInstallBody({ ...args, file: `${dir}\\x.cab`, kind: 'cab' });
  assert.match(cab, /& expand\.exe -F:\* \$dst \$x/);
  assert.doesNotMatch(cab, /Expand-Archive/);
  assert.throws(() => E.driverInstallBody({ ...args, sha256: null }), /hash/);
  assert.throws(() => E.driverInstallBody({ ...args, kind: 'zip', file: `${dir}\\x.exe` }), /tipo/);
  const exe = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signers: ['NVIDIA Corporation'], sha256: 'cd'.repeat(32) });
  assert.match(exe, /Get-FileHash -LiteralPath \$dst -Algorithm SHA256/);
  assert.doesNotMatch(exe, /Expand-Archive|pnputil/);
});


test('driver-install: instalador de dentro do pacote não vale assinado só pela Microsoft (o .cat vale)', () => {
  const dir = 'C:\\N\\driver-downloads';
  const body = E.driverInstallBody({ file: `${dir}\\a.zip`, dir, kind: 'zip', signers: ['ASUSTeK COMPUTER INC.', 'Microsoft Corporation'], sha256: 'ab'.repeat(32) });
  const setup = body.slice(body.indexOf('if ($setup) {'), body.indexOf('} else {', body.indexOf('if ($setup) {')));
  assert.match(setup, /'ASUSTeK COMPUTER INC\.'/);
  assert.doesNotMatch(setup, /Microsoft/);
  assert.match(body.slice(body.indexOf("-Filter '*.cat'")), /'Microsoft Corporation'/);
});

test('driver-install: ponto de restauração só depois de conferir o conteúdo; 259, cópia mudada e instalador de dentro viram sinais próprios', () => {
  const dir = 'C:\\N\\driver-downloads';
  const zip = E.driverInstallBody({ file: `${dir}\\a.zip`, dir, kind: 'zip', signers: ['ASUSTeK COMPUTER INC.'], sha256: 'ab'.repeat(32), restorePoint: true });
  const restoreAt = zip.indexOf('SystemRestore');
  assert.ok(restoreAt > zip.indexOf('Get-FileHash'), 'depois do hash');
  assert.ok(restoreAt > zip.indexOf('Get-AuthenticodeSignature -LiteralPath $setup'), 'depois de conferir o instalador de dentro');
  assert.ok(zip.lastIndexOf('SystemRestore') < zip.indexOf('pnputil.exe') || zip.split('SystemRestore').length > 2, 'antes do pnputil também');
  assert.match(zip, /\$r\.changed = \$true/);
  assert.match(zip, /\$r\.inner = \$true/);
  assert.match(zip, /if \(\$r\.code -eq 259\) \{ \$r\.nothing = \$true/);
  const exe = E.driverInstallBody({ file: `${dir}\\nv.exe`, dir, signers: ['NVIDIA Corporation'], sha256: 'cd'.repeat(32), restorePoint: true });
  assert.ok(exe.indexOf('SystemRestore') > exe.indexOf('Get-AuthenticodeSignature -LiteralPath $dst'), 'exe: depois de conferir a cópia');
});

test('instalar: cópia mudada apaga e pede para baixar de novo; instalador de dentro sem assinatura apaga; 259 explica', async () => {
  for (const [result, error, re] of [[{ ok: false, changed: true, note: 'x' }, 'changed', /mudou depois do download/], [{ ok: false, inner: true, signature: { valid: false }, note: 'x' }, 'inner', /instalador de dentro do pacote/]]) {
    const { engine, dir } = engineWith({ routes: { [ASUS]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, elevate: async () => ({ result }) });
    engine.start('z', { url: ASUS, domains: ['asus.com'], fileName: 'Realtek_Audio.zip', kind: 'zip', signers: ['ASUSTeK COMPUTER INC.'], source: 'asus' });
    await settle(engine, 'z');
    const out = await engine.install('z', { restorePoint: false });
    assert.equal(out.ok, false);
    assert.match(out.note, re);
    assert.equal(engine.list().find((i) => i.id === 'z').error, error);
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).length, 0, 'apagou');
  }
  const { engine } = engineWith({ routes: { [ASUS]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, elevate: async () => ({ result: { ok: true, nothing: true, code: 259 } }) });
  engine.start('n', { url: ASUS, domains: ['asus.com'], fileName: 'Realtek_Audio.zip', kind: 'zip', signers: ['ASUSTeK COMPUTER INC.'], source: 'asus' });
  await settle(engine, 'n');
  const out = await engine.install('n', { restorePoint: false });
  assert.equal(out.ok, false);
  assert.match(out.note, /já usa um driver igual ou mais novo/);
  assert.equal(engine.list().find((i) => i.id === 'n').phase, 'ready');
});

test('assinatura: os programas oficiais dos periféricos entram na lista do app', () => {
  for (const name of ['Logitech Inc', 'Logitech Inc.', 'Logitech', 'SteelSeries ApS']) assert.equal(Sig.allowedSigner(name), true, name);
  assert.equal(Sig.allowedSigner('Logitech Evil'), false);
});

test('driver-install: .cab do Catálogo da Microsoft (só Microsoft) instala pelo .inf, sem procurar instalador', () => {
  const dir = 'C:\\N\\driver-downloads';
  const body = E.driverInstallBody({ file: `${dir}\\catalogo-1b21-1242.cab`, dir, kind: 'cab', signers: ['Microsoft Corporation'], sha256: 'ab'.repeat(32) });
  assert.doesNotMatch(body, /'setup\.exe'/);
  assert.match(body, /pnputil\.exe \/add-driver/);
});

test('driver do Catálogo que o Windows não usou: diz que não serve nesta peça', async () => {
  const { engine } = engineWith({ routes: { [ASUS]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, elevate: async () => ({ result: { ok: true, nothing: true, code: 259 } }) });
  engine.start('c', { url: ASUS, domains: ['asus.com'], fileName: 'catalogo-abcd-1234.cab', kind: 'cab', signers: ['Microsoft Corporation'], source: 'catalog' });
  await settle(engine, 'c');
  const out = await engine.install('c', { restorePoint: false });
  assert.equal(out.ok, false);
  assert.match(out.note, /não serve nesta peça/);
});

/* ---------------- Instalação sem janela ---------------- */
const SDIR = 'C:\\N\\driver-downloads';
test('silencioso: só nome de perfil da tabela; parâmetro solto é recusado', () => {
  assert.throws(() => E.driverInstallBody({ file: `${SDIR}\\nv.exe`, dir: SDIR, signer: 'NVIDIA Corporation', silent: '-s; calc' }), /Modo silencioso desconhecido/);
  assert.throws(() => E.driverInstallBody({ file: `${SDIR}\\nv.exe`, dir: SDIR, signer: 'NVIDIA Corporation', silent: 'toString' }), /Modo silencioso desconhecido/);
  assert.throws(() => E.driverInstallBody({ file: `${SDIR}\\nv.exe`, dir: SDIR, signer: 'NVIDIA Corporation', silent: 'msi' }), /não confere/, 'perfil msi só para .msi');
});
test('silencioso: roda escondido com os parâmetros do perfil, espera com tempo-limite e encerra a árvore se travar', () => {
  const b = E.driverInstallBody({ file: `${SDIR}\\nv.exe`, dir: SDIR, signer: 'NVIDIA Corporation', silent: 'nvidia' });
  assert.match(b, /Display\.Driver HDAudio\.Driver PhysX -s -noreboot -noeula -nofinish -nosplash/);
  assert.match(b, /WindowStyle = 'Hidden'|CreateNoWindow = \$true/);
  assert.match(b, /'nvidia' \{ 3600000 \}/, 'NVIDIA: 60 min');
  assert.match(b, /WaitForExit\(\$waitMs\)/);
  assert.match(b, /taskkill\.exe.*\/T \/F/);
  assert.match(b, /\$r\.hung = \$true/);
  assert.match(b, /\$profile = 'nvidia'/);
  assert.match(b, /\$r\.profile = \$profile/);
  assert.ok(b.indexOf('Get-AuthenticodeSignature') < b.indexOf('Process]::Start('), 'assinatura antes de rodar');
});
test('silencioso: sem modo, abre a janela como antes', () => {
  const b = E.driverInstallBody({ file: `${SDIR}\\nv.exe`, dir: SDIR, signer: 'NVIDIA Corporation', silent: false });
  assert.doesNotMatch(b, /-noeula|WaitForExit\(\d/);
  assert.match(b, /UseShellExecute = \$true/);
});
test('silencioso: detect escolhe pelo conteúdo e, sem tipo conhecido, abre a janela (windowed)', () => {
  const b = E.driverInstallBody({ file: `${SDIR}\\gg.exe`, dir: SDIR, signer: 'SteelSeries ApS', silent: 'detect' });
  assert.match(b, /Nullsoft/);
  assert.match(b, /'nsis' \{ '\/S' \}/);
  assert.match(b, /\$r\.windowed = \$true/);
  assert.ok(b.indexOf("Contains('Nullsoft')") < b.indexOf('Process]::Start('));
});
test('silencioso: .msi vai pelo msiexec /i … /qn /norestart', () => {
  const b = E.driverInstallBody({ file: `${SDIR}\\x.msi`, dir: SDIR, signer: 'Microsoft Corporation', silent: 'detect' });
  assert.match(b, /msiexec\.exe/);
  assert.match(b, /'\/i "' \+ \$dst \+ '" '/);
  assert.match(b, /\/qn \/norestart/);
});
test('silencioso: pacote .zip roda o instalador de dentro pelo detect', () => {
  const b = E.driverInstallBody({ file: `${SDIR}\\asus.zip`, dir: SDIR, signers: ['ASUSTeK COMPUTER INC.'], kind: 'zip', sha256: 'a'.repeat(64), silent: 'detect' });
  assert.match(b, /Contains\('Inno Setup'\)/);
  assert.match(b, /\$r\.windowed = \$true/);
});

/* ---------------- Motor: sem janela, instala sozinho, página da AMD ---------------- */
test('motor: manda o perfil sem janela para o administrador; "com janela" manda false', async () => {
  const asked = [];
  const { engine } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, elevate: async (task, args) => { asked.push(args.silent); return { result: { ok: true, code: 0, profile: 'nvidia' } }; } });
  engine.start('video-rtx', plan({ silent: 'nvidia' }));
  await settle(engine, 'video-rtx');
  await engine.install('video-rtx', { restorePoint: false });
  await engine.install('video-rtx', { restorePoint: false, window: true });
  assert.deepEqual(asked, ['nvidia', false]);
  assert.throws(() => engine.start('x', plan({ silent: '-s; calc', fileName: 'outro.exe' })), /Modo silencioso desconhecido/);
});
test('motor: baixou com "instalar depois" → instala sozinho e avisa o resultado', async () => {
  const { engine, events } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, elevate: async () => ({ result: { ok: true, code: 0, profile: 'nvidia' } }) });
  engine.start('video-rtx', plan({ silent: 'nvidia' }), { auto: { restorePoint: true } });
  await settle(engine, 'video-rtx', ['installed', 'error']);
  for (let i = 0; i < 50 && !events.some((e) => e.channel === 'drivers:auto-installed'); i += 1) await tick();
  const done = events.find((e) => e.channel === 'drivers:auto-installed');
  assert.equal(done.id, 'video-rtx');
  assert.equal(done.result.ok, true);
});
test('motor: resultado pelo código do perfil (Dell 3 = já tinha, Dell 5 = não serve, burn 3010 = reiniciar)', async () => {
  const run = async (result) => {
    const { engine } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, elevate: async () => ({ result }) });
    engine.start('a', plan({ silent: 'detect' }));
    await settle(engine, 'a');
    return engine.install('a', { restorePoint: false });
  };
  const same = await run({ ok: false, code: 3, profile: 'dell' });
  assert.equal(same.ok, false); assert.equal(same.nothing, true); assert.match(same.note, /nada mudou/i);
  const no = await run({ ok: false, code: 5, profile: 'dell' });
  assert.equal(no.ok, false); assert.match(no.note, /não serve neste PC/);
  const reboot = await run({ ok: true, code: 3010, profile: 'burn' });
  assert.equal(reboot.ok, true); assert.equal(reboot.restart, true);
  const dellReboot = await run({ ok: false, code: 2, profile: 'dell' });
  assert.equal(dellReboot.ok, true); assert.equal(dellReboot.restart, true);
});
test('motor: travou sem janela → oferece "com janela"; tipo desconhecido → avisa que abriu a janela', async () => {
  const run = async (result) => {
    const { engine } = engineWith({ routes: { [NV]: { headers: { 'content-length': '3000' }, chunks: chunks(BODY) } }, elevate: async () => ({ result }) });
    engine.start('a', plan({ silent: 'detect' }));
    await settle(engine, 'a');
    return engine.install('a', { restorePoint: false });
  };
  const hung = await run({ ok: false, hung: true, profile: 'inno' });
  assert.equal(hung.ok, false); assert.equal(hung.hung, true); assert.match(hung.note, /com janela/);
  const win = await run({ ok: true, code: 0, windowed: true });
  assert.equal(win.ok, true); assert.equal(win.windowed, true);
});
test('motor: arquivo da página da AMD (site → baixando → confere → pronto → instala sozinho)', async () => {
  const asked = [];
  const { engine, dir, events } = engineWith({ routes: {}, signer: 'Advanced Micro Devices, Inc.', elevate: async (task, args) => { asked.push(args); return { result: { ok: true, code: 0, profile: 'amd' } }; } });
  const site = engine.external('video-amd', { signers: ['Advanced Micro Devices, Inc.'], silent: 'amd' }, { auto: { restorePoint: false } });
  assert.equal(site.phase, 'site');
  engine.progress('video-amd', 1000, 3000);
  assert.equal(engine.list().find((x) => x.id === 'video-amd').phase, 'downloading');
  const file = path.join(dir, 'amd-software-adrenalin-edition-25.11.1-win10-win11-nov-rdna.exe');
  fs.writeFileSync(file, BODY);
  await engine.arrived('video-amd', { file, url: 'https://drivers.amd.com/drivers/amd-software-adrenalin-edition-25.11.1-win10-win11-nov-rdna.exe' });
  await settle(engine, 'video-amd', ['installed', 'error']);
  assert.equal(asked[0].silent, 'amd');
  assert.equal(asked[0].sha256, crypto.createHash('sha256').update(BODY).digest('hex'));
  for (let i = 0; i < 50 && !events.some((e) => e.channel === 'drivers:auto-installed'); i += 1) await tick();
  assert.ok(events.some((e) => e.channel === 'drivers:auto-installed' && e.id === 'video-amd'));
});
test('motor: página da AMD — arquivo fora da pasta, nome estranho ou fechar no meio', async () => {
  const { engine, dir } = engineWith({ routes: {}, signer: 'Advanced Micro Devices, Inc.' });
  let closed = 0;
  engine.external('video-amd', { signers: ['Advanced Micro Devices, Inc.'], silent: 'amd' }, { cancel: () => { closed += 1; } });
  await assert.rejects(engine.arrived('video-amd', { file: 'C:\\Windows\\evil.exe', url: 'https://drivers.amd.com/x.exe' }), /fora da pasta|não permitido/i);
  assert.equal(engine.list().find((x) => x.id === 'video-amd').phase, 'error');
  engine.external('video-amd', { signers: ['Advanced Micro Devices, Inc.'], silent: 'amd' }, { cancel: () => { closed += 1; } });
  engine.cancel('video-amd');
  assert.equal(closed, 1);
  assert.equal(engine.list().find((x) => x.id === 'video-amd').phase, 'canceled');
  engine.external('video-amd', { signers: ['Advanced Micro Devices, Inc.'], silent: 'amd' });
  engine.failed('video-amd', 'canceled');
  assert.equal(engine.list().find((x) => x.id === 'video-amd').phase, 'canceled');
  assert.throws(() => engine.external('video-x', { signers: ['Evil Corp'], silent: 'amd' }), /Assinante não permitido/);
  void dir;
});
