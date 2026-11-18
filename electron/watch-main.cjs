/*
 * Vigias do processo principal: decisões puras (testadas); o main.cjs liga e registra os avisos.
 * Spec: docs/superpowers/specs/2026-11-18-vigias-de-erro-design.md
 */
const MEMORY_LIMIT_MB = 1500;

/**
 * Memória de todos os processos do Nexo somada (app.getAppMetrics, workingSetSize em KB). Acima de 1,5 GB devolve o
 * total e as partes por tipo (Browser, Renderer, GPU…) em MB arredondados; senão, null.
 */
function memoryAlarm(metrics, limitMb = MEMORY_LIMIT_MB) {
  if (!Array.isArray(metrics)) return null;
  const partes = {};
  let total = 0;
  for (const item of metrics) {
    const kb = Number(item?.memory?.workingSetSize);
    if (!Number.isFinite(kb) || kb <= 0) continue;
    const type = String(item.type || 'outro').replace(/[^a-z]/gi, '').slice(0, 20) || 'outro';
    partes[type] = (partes[type] || 0) + kb / 1024;
    total += kb / 1024;
  }
  if (!(total > limitMb)) return null;
  return { totalMB: Math.round(total), partes: Object.fromEntries(Object.entries(partes).map(([type, mb]) => [type, Math.round(mb)])) };
}

/** O servidor recusou o sinal de vida (4xx, menos 429): algo errado no app ou no servidor, não falta de rede. */
function pulseRefused(result) {
  const status = Number(result?.status);
  return Boolean(result?.failed) && status >= 400 && status < 500 && status !== 429;
}

module.exports = { memoryAlarm, pulseRefused, MEMORY_LIMIT_MB };
