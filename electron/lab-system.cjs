/*
 * Adaptador real do laboratório para o Windows. O motor (src/lab.js) só enxerga esta interface.
 *
 * Ambiente de testes dentro do PC:
 *  - o plano de energia ATIVO é copiado (powercfg /duplicatescheme) para "Nexo Lab (temporário)"; o original nunca é editado;
 *  - os ajustes vão só para o clone, só na tomada (/setacvalueindex), e só valores validados pelo motor;
 *  - uma trava (lab-lock.json) + uma entrada RunOnce garantem a volta ao plano original mesmo se o PC travar no meio;
 *  - no fim: plano original ativo de novo, clone apagado, trava e RunOnce removidos.
 * Todos os comandos são fixos; powercfg só aceita os verbos da lista ALLOWED_POWERCFG.
 */
const Lab = require('../src/lab.js');

const LAB_PLAN_NAME = 'Nexo Lab (temporário)';
const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
const RUNONCE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce';
const RUNONCE_VALUE = 'NexoLabRecovery';
const ALLOWED_POWERCFG = new Set(['/aliases', '/getactivescheme', '/list', '/duplicatescheme', '/changename', '/setactive', '/setacvalueindex', '/qh', '/export', '/delete']);
const ERROR_PROVIDERS = ['Microsoft-Windows-WHEA-Logger', 'Microsoft-Windows-Kernel-Power', 'Microsoft-Windows-Kernel-Processor-Power', 'Display', 'nvlddmkm', 'amdkmdag', 'amdwddmg', 'igfx'];
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/* ---------- Leitura da saída do powercfg (independente do idioma do Windows) ---------- */
function parseAliases(text) {
  const map = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f-]{36})\s+(\S+)$/i);
    if (match) map[match[2].toUpperCase()] = match[1].toLowerCase();
  }
  return map;
}
function parseActive(text) { const match = String(text).match(GUID); return match ? match[0].toLowerCase() : null; }
function parseList(text) {
  return String(text).split(/\r?\n/).map((line) => {
    const guid = line.match(GUID);
    if (!guid) return null;
    const name = line.match(/\(([^)]*)\)/);
    return { guid: guid[0].toLowerCase(), name: name ? name[1].trim() : 'Plano', active: /\*\s*$/.test(line.trim()) };
  }).filter(Boolean);
}
const parseDuplicate = parseActive;
/** Na saída de /qh, os dois últimos 0x… são o índice na tomada (AC) e na bateria (DC). */
function parseIndexes(text) {
  const values = [...String(text).matchAll(/0x([0-9a-f]{8})/gi)].map((match) => parseInt(match[1], 16));
  if (values.length < 2) return null;
  return { ac: values[values.length - 2], dc: values[values.length - 1] };
}
function interpretRestorePoint(elevated) {
  if (!elevated) return { ok: false, created: false, note: 'sem resposta' };
  if (elevated.declined) return { ok: false, created: false, note: 'a permissão de administrador foi recusada' };
  const result = elevated.result;
  if (!result) return { ok: false, created: false, note: `o Windows não respondeu (código ${elevated.code})` };
  return { ok: Boolean(result.ok), created: Boolean(result.created), note: String(result.note || '').slice(0, 200), sequence: Number.isFinite(result.sequence) ? result.sequence : null, at: typeof result.at === 'string' ? result.at.slice(0, 40) : null };
}

function createLabSystem(deps) {
  const { run, runPowerShell, bench, readTemp, cpuLoad, onBattery, elevate, fs, path, dir, exePath, isPackaged, platform = process.platform, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = deps;
  const lockFile = path.join(dir, 'lab-lock.json');
  let session = null;

  async function powercfg(args) {
    if (!ALLOWED_POWERCFG.has(args[0])) throw new Error(`powercfg ${args[0]} não é permitido no laboratório.`);
    const result = await run('powercfg', args);
    if (result.code !== 0) throw new Error(`powercfg ${args[0]} falhou (código ${result.code}).`);
    return result.stdout;
  }
  const active = async () => parseActive(await powercfg(['/getactivescheme']));
  const plans = async () => parseList(await powercfg(['/list']));
  const readLock = async () => { try { return JSON.parse(await fs.readFile(lockFile, 'utf8')); } catch { return null; } };

  async function readKnobs(scheme) {
    const knobs = {};
    for (const knob of Lab.SPACE) {
      try {
        const indexes = parseIndexes(await powercfg(['/qh', scheme, knob.sub, knob.setting]));
        knobs[knob.id] = indexes ? { available: true, current: indexes.ac } : { available: false };
      } catch { knobs[knob.id] = { available: false }; }
    }
    return knobs;
  }

  const system = {
    now, sleep,
    async preflight() {
      if (platform !== 'win32') return { platform, knobs: {} };
      const scheme = await active();
      const [tempC, load, battery, pending] = await Promise.all([readTemp(), cpuLoad(), onBattery(), system.hasPendingLock()]);
      return { platform, activeGuid: scheme, tempC, cpuLoad: load, onBattery: battery, pending, knobs: await readKnobs(scheme) };
    },
    async createRestorePoint() {
      return interpretRestorePoint(await elevate('restore-point', { description: 'Nexo - antes do laboratório' }).catch((error) => ({ result: { ok: false, note: error.message } })));
    },
    async begin() {
      const originalGuid = await active();
      const list = await plans();
      const original = list.find((plan) => plan.guid === originalGuid);
      await fs.mkdir(dir, { recursive: true });
      await powercfg(['/export', path.join(dir, `plano-original-${originalGuid}.pow`), originalGuid]).catch(() => {});
      const labGuid = parseDuplicate(await powercfg(['/duplicatescheme', originalGuid]));
      if (!labGuid) throw new Error('Não consegui clonar o plano de energia.');
      session = { originalGuid, originalName: original?.name || 'Plano anterior', labGuid, startedAt: now() };
      await fs.writeFile(lockFile, JSON.stringify(session), 'utf8');
      await powercfg(['/changename', labGuid, LAB_PLAN_NAME, 'Plano temporário do laboratório do Nexo; é apagado ao terminar.']);
      if (isPackaged && exePath) await run('reg', ['add', RUNONCE_KEY, '/v', RUNONCE_VALUE, '/t', 'REG_SZ', '/d', `"${exePath}" --lab-recover`, '/f']);
      await powercfg(['/setactive', labGuid]);
      return { labGuid };
    },
    async readConfig() {
      if (!session) throw new Error('Ambiente de testes não iniciado.');
      const knobs = await readKnobs(session.labGuid);
      return Object.fromEntries(Object.entries(knobs).filter(([, knob]) => knob.available).map(([id, knob]) => [id, knob.current]));
    },
    async apply(changes) {
      if (!session) throw new Error('Ambiente de testes não iniciado.');
      for (const change of changes) {
        const knob = Lab.knob(change.id);
        if (!knob || knob.setting !== change.setting || knob.sub !== change.sub || !Number.isInteger(change.value)) throw new Error('Ajuste fora do espaço do laboratório.');
        await powercfg(['/setacvalueindex', session.labGuid, knob.sub, knob.setting, String(change.value)]);
      }
      await powercfg(['/setactive', session.labGuid]);
    },
    bench: async (mode) => (await bench(mode)).mopsPerSec,
    async sample() { const [tempC, battery, load] = await Promise.all([readTemp(), onBattery(), cpuLoad()]); return { tempC, onBattery: battery, cpuLoad: load }; },
    async errorEventsSince(since) {
      const providers = ERROR_PROVIDERS.map((name) => `'${name}'`).join(',');
      const script = `$s=[DateTimeOffset]::FromUnixTimeMilliseconds(${Math.floor(Number(since) || 0)}).LocalDateTime; $p=@(${providers}); $n=@(Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=$s} -ErrorAction SilentlyContinue | Where-Object { $p -contains $_.ProviderName }).Count; [Console]::Out.Write($n)`;
      const result = await runPowerShell(script, 15000);
      const count = parseInt(String(result.stdout).trim(), 10);
      return Number.isFinite(count) ? count : 0;
    },
    async restore() {
      const lock = session || await readLock();
      if (!lock) return { ok: true };
      const known = await plans();
      const target = known.some((plan) => plan.guid === lock.originalGuid) ? lock.originalGuid : BALANCED;
      await powercfg(['/setactive', target]);
      if (known.some((plan) => plan.guid === lock.labGuid)) await powercfg(['/delete', lock.labGuid]).catch(() => {});
      const ok = (await active()) === target;
      return { ok, target };
    },
    /** Modo assistido: a pessoa adota depois. Parte do plano ATIVO agora e aplica só os valores revisados que mudam. */
    async adoptCurrent(config) {
      if (session || await readLock()) throw new Error('Termine ou recupere o teste em andamento antes.');
      const originalGuid = await active();
      const current = await readKnobs(originalGuid);
      const changes = {};
      for (const [id, value] of Object.entries(config || {})) {
        if (!current[id]?.available || current[id].current === value) continue;
        Lab.validateStep(id, value, undefined);
        changes[id] = value;
      }
      if (!Object.keys(changes).length) throw new Error('O plano ativo já tem esses valores.');
      const original = (await plans()).find((plan) => plan.guid === originalGuid);
      return system.adopt(changes, { originalGuid, originalName: original?.name || 'Plano anterior' });
    },
    async adopt(config, base = null) {
      const lock = base || session || await readLock();
      if (!lock) throw new Error('Sem sessão do laboratório.');
      const guid = parseDuplicate(await powercfg(['/duplicatescheme', lock.originalGuid]));
      if (!guid) throw new Error('Não consegui criar o plano ajustado.');
      const name = `Nexo — Ajustado (${new Date(now()).toLocaleDateString('pt-BR')})`;
      await powercfg(['/changename', guid, name, 'Criado pelo laboratório do Nexo a partir do seu plano, com os ajustes confirmados por medição.']);
      for (const [id, value] of Object.entries(config)) {
        const knob = Lab.validateStep(id, value, value);
        await powercfg(['/setacvalueindex', guid, knob.sub, knob.setting, String(value)]);
      }
      await powercfg(['/setactive', guid]);
      return { guid, name, before: { guid: lock.originalGuid, name: lock.originalName || 'Plano anterior' }, config };
    },
    async finish() {
      session = null;
      await fs.rm(lockFile, { force: true });
      await run('reg', ['delete', RUNONCE_KEY, '/v', RUNONCE_VALUE, '/f']).catch(() => {});
    },
    async hasPendingLock() { return Boolean(await readLock()); },
    /** Chamado na abertura do Nexo (e pelo RunOnce com --lab-recover) quando a trava ficou para trás. */
    async recover() {
      const lock = await readLock();
      if (!lock) return { recovered: false };
      session = lock;
      const restored = await system.restore().catch(() => ({ ok: false }));
      if (restored.ok) await system.finish();
      return { recovered: restored.ok, startedAt: lock.startedAt, originalName: lock.originalName };
    }
  };
  return system;
}

module.exports = { createLabSystem, parseAliases, parseActive, parseList, parseDuplicate, parseIndexes, interpretRestorePoint, LAB_PLAN_NAME, BALANCED, RUNONCE_KEY, RUNONCE_VALUE, ALLOWED_POWERCFG, ERROR_PROVIDERS };
