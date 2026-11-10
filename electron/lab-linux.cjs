/*
 * Adaptador do laboratório para o Linux: testa os perfis do power-profiles-daemon (economia, equilibrado,
 * desempenho) — sem root, reversível e com trava para voltar ao perfil original se o app fechar no meio.
 * Não existe "ponto de restauração do sistema" no Linux; como o único estado alterado é o perfil, o Nexo guarda o
 * original e volta a ele. Erros graves: conta linhas de erro do kernel no journal desde o início (se o journal permitir).
 */
const Lab = require('../src/lab.js');

function createLinuxLabSystem({ linux, run, bench, readTemp, cpuLoad, onBattery, fs, path, dir, now = Date.now, sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) }) {
  const lockFile = path.join(dir, 'lab-lock.json');
  const order = linux.PROFILE_ORDER;
  let session = null;
  const readLock = async () => { try { return JSON.parse(await fs.readFile(lockFile, 'utf8')); } catch { return null; } };
  const activeProfile = async () => (await linux.powerProfiles()).find((profile) => profile.active)?.guid || null;

  const system = {
    now, sleep,
    async preflight() {
      const profiles = await linux.powerProfiles();
      const active = profiles.find((profile) => profile.active)?.guid;
      const [tempC, load, battery, pending] = await Promise.all([readTemp(), cpuLoad(), onBattery(), system.hasPendingLock()]);
      return { platform: 'linux', tempC, cpuLoad: load, onBattery: battery, pending, knobs: { ppd: profiles.length >= 2 && active ? { available: true, current: order.indexOf(active) } : { available: false } } };
    },
    createRestorePoint: async () => ({ ok: true, created: false, note: 'no Linux o laboratório só muda o perfil de energia; o Nexo guarda o perfil original e volta a ele (não há ponto de restauração do sistema)' }),
    async begin() {
      const original = await activeProfile();
      if (!original) throw new Error('O power-profiles-daemon não está respondendo.');
      session = { original, startedAt: now() };
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(lockFile, JSON.stringify(session), 'utf8');
    },
    async readConfig() { const active = await activeProfile(); return { ppd: order.indexOf(active) }; },
    async apply(changes) {
      for (const change of changes) {
        const knob = Lab.knob(change.id);
        if (!knob || knob.id !== 'ppd' || !order[change.value]) throw new Error('Ajuste fora do espaço do laboratório.');
        await linux.setPowerProfile(order[change.value]);
      }
    },
    bench: async (mode) => (await bench(mode)).mopsPerSec,
    async sample() { const [tempC, battery, load] = await Promise.all([readTemp(), onBattery(), cpuLoad()]); return { tempC, onBattery: battery, cpuLoad: load }; },
    async errorEventsSince(since) {
      const result = await run('journalctl', ['-k', '-p', '3', `--since=@${Math.floor(Number(since) / 1000)}`, '-q', '-o', 'cat', '--no-pager']);
      if (result.code !== 0) return 0;
      return String(result.stdout).split('\n').filter((line) => /mce|machine check|thermal|throttl|amdgpu|nvidia|nouveau|i915|xe |gpu hang|watchdog/i.test(line)).length;
    },
    async restore() {
      const lock = session || await readLock();
      if (!lock) return { ok: true };
      await linux.setPowerProfile(lock.original);
      return { ok: (await activeProfile()) === lock.original, target: lock.original };
    },
    async adopt(config) {
      const lock = session || await readLock();
      const target = order[config.ppd];
      if (!target) throw new Error('Perfil inválido.');
      await linux.setPowerProfile(target);
      return { guid: target, name: linux.PROFILES[target], before: { guid: lock?.original || 'balanced', name: linux.PROFILES[lock?.original] || 'Equilibrado' }, config };
    },
    async adoptCurrent(config) {
      const original = await activeProfile();
      const target = order[config?.ppd];
      if (!target || target === original) throw new Error('O perfil ativo já é esse.');
      await linux.setPowerProfile(target);
      return { guid: target, name: linux.PROFILES[target], before: { guid: original, name: linux.PROFILES[original] }, config: { ppd: config.ppd } };
    },
    async finish() { session = null; await fs.rm(lockFile, { force: true }); },
    async hasPendingLock() { return Boolean(await readLock()); },
    async recover() {
      const lock = await readLock();
      if (!lock) return { recovered: false };
      session = lock;
      const restored = await system.restore().catch(() => ({ ok: false }));
      if (restored.ok) await system.finish();
      return { recovered: restored.ok, startedAt: lock.startedAt, originalName: linux.PROFILES[lock.original] };
    }
  };
  return system;
}

module.exports = { createLinuxLabSystem };
