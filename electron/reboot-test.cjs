/*
 * Teste com reinício (Windows): executa o plano de src/reboot-test.js atravessando reinícios.
 *
 *  - o estado fica em <userData>/reboot-test/state.json (gravação atômica); sobrevive a queda de energia;
 *  - uma entrada RunOnce (HKCU) abre o Nexo com --reboot-test depois de cada reinício; se ela falhar, o Nexo
 *    continua quando for aberto de qualquer jeito (só não mede o tempo até a área de trabalho daquele boot);
 *  - trocar A↔B usa o Raio-X (catálogo fechado, validação e UAC dele). Nada novo é gravado fora do catálogo;
 *  - cancelar (ou abandonar um teste parado) sempre volta ao A, o valor de antes;
 *  - reiniciar sozinho só se a pessoa escolheu, com 60 s de aviso e "Não reiniciar" na tela (shutdown /a).
 */
const RT = require('../src/reboot-test.js');

const RUNONCE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce';
const RUNONCE_VALUE = 'NexoRebootTest';
const AUTO_RESTART_S = 60;
const HISTORY_LIMIT = 10;

/** Leitura sem permissão especial: quando o Explorer abriu (= entrada no Windows), processos e serviços rodando. */
const BOOT_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$out = @{}
$explorer = Get-Process -Name explorer -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1
if ($explorer) { $out.explorer = [long]([DateTimeOffset]$explorer.StartTime).ToUnixTimeMilliseconds() }
$out.processes = @(Get-Process).Count
$out.services = @(Get-Service | Where-Object { $_.Status -eq 'Running' }).Count
[Console]::Out.Write(($out | ConvertTo-Json -Compress))`;

function createRebootTest({ fs, path, dir, run, runPowerShell, apply, validate, bench, cpuLoad, memory, onBattery, uptime, exePath, isPackaged, platform = process.platform, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), emit = () => {} }) {
  const file = path.join(dir, 'state.json');
  const historyFile = path.join(dir, 'history.json');
  let busy = null;
  let signal = { cancelled: false };
  let restartAt = null;
  let lastRunOnce = null; // quando o RunOnce abriu o Nexo neste boot (mesmo se outra cópia já estava medindo)

  const bootAt = () => now() - uptime() * 1000;

  async function readJson(target, fallback) {
    try { return JSON.parse(await fs.readFile(target, 'utf8')); } catch { return fallback; }
  }
  async function writeJson(target, value) {
    await fs.mkdir(dir, { recursive: true });
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value), 'utf8');
    await fs.rename(temp, target);
  }
  const load = async () => RT.sanitizeState(await readJson(file, null));
  const save = (state) => writeJson(file, { ...state, updatedAt: now() });

  async function archive(state) {
    const history = (await readJson(historyFile, [])).filter((item) => item && item.id !== state.id);
    // No histórico ficam só os números de cada boot (as rodadas são descartadas para o arquivo não crescer).
    const slim = { ...state, boots: state.boots.map(({ rounds, ...boot }) => boot) };
    await writeJson(historyFile, [slim, ...history].slice(0, HISTORY_LIMIT));
  }

  async function arm() {
    if (!isPackaged || !exePath) return false;
    const outcome = await run('reg', ['add', RUNONCE_KEY, '/v', RUNONCE_VALUE, '/t', 'REG_SZ', '/d', `"${exePath}" --reboot-test`, '/f']);
    return outcome.code === 0;
  }
  const disarm = () => run('reg', ['delete', RUNONCE_KEY, '/v', RUNONCE_VALUE, '/f']).catch(() => ({ code: 1 }));

  async function restart(delay = 15) {
    // Só reinicia o PC por causa de um teste em andamento (nunca por um pedido solto da interface).
    const current = await load();
    if (!current || current.status !== 'running') throw new Error('Não há teste com reinício em andamento.');
    const seconds = Math.max(5, Math.min(600, Math.round(delay)));
    const outcome = await run('shutdown', ['/r', '/t', String(seconds), '/c', 'Nexo Device Care: teste com reinício. O PC vai reiniciar para medir de novo; salve o que estiver aberto.']);
    if (outcome.code !== 0) throw new Error('O Windows não aceitou o pedido de reinício.');
    restartAt = now() + seconds * 1000;
    return { ok: true, at: restartAt };
  }
  async function abortRestart() {
    restartAt = null;
    await run('shutdown', ['/a']).catch(() => ({ code: 1 }));
    return { ok: true };
  }

  /** Grava a configuração A ou B pelo Raio-X. Falha (inclusive UAC recusado) vira mensagem, nunca exceção solta. */
  async function switchTo(state, config) {
    try {
      const result = await apply(RT.changesFor(state, config));
      if (result?.failed?.length) {
        const names = state.changes.filter((change) => result.failed.includes(change.id)).map((change) => change.label);
        return { ok: false, note: `${result.declined ? 'Sem a permissão do Windows' : 'O Windows recusou'}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` e mais ${names.length - 3}` : ''}.` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, note: String(error?.message || 'Não consegui gravar os ajustes.').slice(0, 200) };
    }
  }

  async function waitQuiet(progress) {
    const started = now();
    const samples = [];
    while (now() - started < RT.LIMITS.quietMaxWaitMs) {
      if (signal.cancelled) throw new Error('cancelado');
      samples.push(Number(await cpuLoad()) || 0);
      if (samples.length > 5) samples.shift();
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      if (samples.length >= 5 && avg < RT.LIMITS.quietCpuPct) return { quiet: true, avg };
      progress(`Esperando o processador sossegar (${Math.round(avg)}%)`);
      await sleep(2000);
    }
    const avg = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
    return { quiet: avg < 40, avg };
  }

  /** Mede o boot atual: tempos de entrada, repouso e os testes de desempenho (mediana de algumas rodadas). */
  async function measureBoot({ viaRunOnce, launchedAt, state }) {
    const total = RT.BENCHES.length * RT.LIMITS.rounds + 3;
    let done = 0;
    const progress = (text) => emit('reboot:progress', { stage: 'medindo', text, pct: Math.round((done / total) * 100), step: state.step, steps: state.order.length, config: state.order[state.step] });
    const boot = bootAt();
    // 1. Espera os programas de inicialização terminarem.
    while (now() - boot < RT.LIMITS.settleAfterBootMs || now() - launchedAt < RT.LIMITS.settleAfterLaunchMs) {
      if (signal.cancelled) throw new Error('cancelado');
      const left = Math.max(RT.LIMITS.settleAfterBootMs - (now() - boot), RT.LIMITS.settleAfterLaunchMs - (now() - launchedAt));
      progress(`Esperando o Windows terminar de ligar (${Math.ceil(left / 1000)} s)`);
      await sleep(Math.min(5000, Math.max(250, left)));
    }
    const quiet = await waitQuiet(progress);
    done += 1;
    // 2. Tempos e contagens.
    let info = {};
    try { info = JSON.parse(String((await runPowerShell(BOOT_SCRIPT, 30000)).stdout || '{}').trim() || '{}'); } catch { info = {}; }
    const explorer = Number(info.explorer);
    const metrics = {};
    const runOnceAt = viaRunOnce ? launchedAt : lastRunOnce && lastRunOnce > boot ? lastRunOnce : null;
    if (Number.isFinite(explorer) && explorer > boot) {
      metrics.boot = (explorer - boot) / 1000;
      if (runOnceAt && runOnceAt > explorer) metrics.desktop = (runOnceAt - explorer) / 1000;
    }
    if (Number.isFinite(Number(info.processes))) metrics.processes = Number(info.processes);
    if (Number.isFinite(Number(info.services))) metrics.services = Number(info.services);
    const mem = memory();
    if (mem && mem.total > 0) metrics.memUsed = Math.round(((mem.total - mem.free) / 1024 ** 3) * 100) / 100;
    done += 1;
    // 3. Processador em repouso.
    progress('Medindo o processador em repouso');
    const idle = [];
    const idleEnd = now() + RT.LIMITS.idleSampleMs;
    while (now() < idleEnd) {
      if (signal.cancelled) throw new Error('cancelado');
      idle.push(Number(await cpuLoad()) || 0);
      await sleep(1000);
    }
    if (idle.length) metrics.idleCpu = Math.round((idle.reduce((a, b) => a + b, 0) / idle.length) * 10) / 10;
    done += 1;
    // 4. Testes de desempenho (mesma ordem em todo boot).
    const rounds = {};
    for (let round = 0; round < RT.LIMITS.rounds; round += 1) {
      for (const mode of RT.BENCHES) {
        if (signal.cancelled) throw new Error('cancelado');
        progress(`Teste ${RT.METRIC.get(mode).label.toLowerCase()} (rodada ${round + 1} de ${RT.LIMITS.rounds})`);
        try {
          const result = await bench(mode);
          const score = Number(result?.mopsPerSec);
          if (Number.isFinite(score) && score > 0) (rounds[mode] = rounds[mode] || []).push(score);
        } catch { /* um teste que falha só fica sem número neste boot */ }
        done += 1;
        await sleep(300);
      }
    }
    for (const [mode, list] of Object.entries(rounds)) metrics[mode] = RT.median(list);
    return { bootAt: boot, metrics, rounds, quiet: quiet.quiet, viaRunOnce: Boolean(runOnceAt), onBattery: Boolean(await onBattery().catch(() => false)) };
  }

  async function finish(state) {
    const result = RT.verdict(state);
    let kept = state.applied;
    let note = '';
    if (result.keep === 'B' && state.applied !== 'B') {
      const outcome = await switchTo(state, 'B');
      if (outcome.ok) kept = 'B'; else note = `O teste mostrou ganho, mas não consegui deixar os ajustes: ${outcome.note} Aplique pelo Raio-X.`;
    } else if (result.keep === 'A' && state.applied !== 'A') {
      const outcome = await switchTo(state, 'A');
      if (outcome.ok) kept = 'A'; else note = `Não consegui voltar ao original: ${outcome.note} Reverta pelo Diário.`;
    }
    if (!note && kept === 'B' && state.changes.some((change) => change.reboot !== 'nao')) note = 'Os ajustes ficaram aplicados. Reinicie mais uma vez para todos valerem.';
    const final = { ...state, status: 'done', phase: 'done', result, kept, applied: kept, note, finishedAt: now() };
    await save(final);
    await disarm();
    await archive(final);
    emit('reboot:progress', { stage: 'pronto', text: RT.OVERALL_TEXT[result.overall], pct: 100 });
    return final;
  }

  /**
   * Avança o teste o quanto der agora. Chamado ao abrir o Nexo (inclusive pelo RunOnce), pela interface ("continuar")
   * e depois de cada etapa. Para em: esperando reinício, esperando a pessoa (troca recusada) ou fim.
   */
  async function tick({ viaRunOnce = false, launchedAt = now() } = {}) {
    if (platform !== 'win32') return status();
    if (viaRunOnce) lastRunOnce = launchedAt;
    if (busy) return busy;
    signal = { cancelled: false };
    busy = (async () => {
      let state = await load();
      let acted = false;
      for (let guard = 0; guard < 12 && state && state.status === 'running'; guard += 1) {
        const action = RT.nextAction(state, { bootAt: bootAt(), now: now() });
        if (action.type === 'abandon') { state = await cancelState(state, action.reason); break; }
        if (action.type === 'finish') { state = await finish(state); break; }
        if (action.type === 'switch') {
          emit('reboot:progress', { stage: 'trocando', text: action.config === 'B' ? 'Aplicando os ajustes do teste' : 'Voltando aos valores de antes', pct: 0 });
          const outcome = await switchTo(state, action.config);
          if (!outcome.ok) { state = { ...state, note: `${outcome.note} O teste está pausado: tente de novo ou cancele (volta ao original).` }; await save(state); break; }
          state = RT.markSwitched(state, action.config, now());
          await save(state);
          acted = true;
          continue;
        }
        if (action.type === 'measure') {
          state = RT.markMeasuring(state, now());
          await save(state);
          try {
            const boot = await measureBoot({ viaRunOnce, launchedAt, state });
            state = RT.recordBoot(state, boot, now());
            await save(state);
            acted = true;
            viaRunOnce = false; // o próximo boot do mesmo tick não existe: só um por reinício
            continue;
          } catch (error) {
            if (signal.cancelled) break;
            state = { ...RT.markArmed(state, now()), note: `A medição falhou: ${String(error?.message || error).slice(0, 160)}. Reinicie para medir este boot de novo.` };
            await save(state);
            break;
          }
        }
        // wait-reboot: arma o RunOnce e, se a pessoa pediu, reinicia sozinho (com aviso de 60 s).
        await arm();
        if (acted && state.auto) await restart(AUTO_RESTART_S).catch(() => {});
        break;
      }
      return status(state);
    })();
    try { return await busy; } finally { busy = null; }
  }

  async function cancelState(state, reason) {
    signal.cancelled = true;
    let note = reason || '';
    let kept = 'A';
    if (state.applied === 'B') {
      const outcome = await switchTo(state, 'A');
      if (!outcome.ok) { kept = 'B'; note = `${note ? `${note} ` : ''}Não consegui voltar ao original (${outcome.note}); os ajustes ficaram e estão no Diário para reverter.`; }
    }
    const final = { ...state, status: 'cancelled', phase: 'done', kept, applied: kept, note, result: state.boots.length >= 2 ? RT.verdict(state) : null, finishedAt: now() };
    await save(final);
    await disarm();
    await abortRestart();
    await archive(final);
    return final;
  }

  async function start({ changes, protocol = 'completo', goal = 'jogos', auto = false } = {}) {
    if (platform !== 'win32') throw new Error('O teste com reinício existe só no Windows.');
    const current = await load();
    if (current && current.status === 'running') throw new Error('Já existe um teste com reinício em andamento.');
    const list = (Array.isArray(changes) ? changes : []).slice(0, RT.LIMITS.maxChanges);
    // Os dois lados passam pela validação do Raio-X: B só com opções do catálogo, A como reversão de valor válido.
    for (const change of list) { validate({ id: change.id, values: change.after }); validate({ id: change.id, values: change.before, revert: true }); }
    const state = RT.createPlan({ changes: list, protocol, goal, auto, now: now() });
    await save(state);
    const armed = await arm();
    return { ...(await status(state)), armed };
  }

  async function cancel() {
    const state = await load();
    if (!state || state.status !== 'running') return status(state);
    signal.cancelled = true;
    if (busy) await busy.catch(() => {});
    return status(await cancelState(await load() || state, ''));
  }

  async function ack(id) {
    const state = await load();
    if (state && state.id === id) await save({ ...state, journaled: true });
    return { ok: true };
  }

  async function status(known) {
    const state = known === undefined ? await load() : known;
    const history = (await readJson(historyFile, [])).filter((item) => item && typeof item === 'object').slice(0, HISTORY_LIMIT);
    const action = state ? RT.nextAction(state, { bootAt: bootAt(), now: now() }) : { type: 'idle' };
    return {
      supported: platform === 'win32', state, action: action.type, busy: Boolean(busy), restartAt: restartAt && restartAt > now() ? restartAt : null,
      permissions: state ? RT.permissionCount(state.order.slice(state.step ? state.step - 1 : 0), state.admin) : 0,
      preview: state && state.boots.length >= 2 ? RT.verdict(state) : null, history
    };
  }

  /** Há um teste rodando (o laboratório e o Raio-X esperam ele acabar para não misturar as medidas). */
  async function active() { const state = await load(); return Boolean(state && state.status === 'running'); }

  return { start, tick, cancel, ack, status, active, restart, abortRestart, bootAt, BOOT_SCRIPT };
}

module.exports = { createRebootTest, RUNONCE_KEY, RUNONCE_VALUE, BOOT_SCRIPT, AUTO_RESTART_S };
