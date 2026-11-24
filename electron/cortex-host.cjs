/*
 * Peças do Cortex que dependem do app (processo principal), separadas do main.cjs para dar para testar:
 *   createBusy               o que a pessoa está rodando e que impede o Cortex de pesar junto
 *   createGameInForeground   "tem jogo em primeiro plano?" — da sonda de sessão, se ela mandou amostra há pouco;
 *                            senão uma consulta única (PowerShell no Windows, xprop no Linux)
 */
'use strict';

const PROBE_FRESH_MS = 60000;

/** Ocupado = lab, otimização, benchmark, análise profunda ou teste com reinício da pessoa. Leitura que falha não trava. */
function createBusy({ labRunning, optRunning, benchActive, deepRunning, rebootActive }) {
  return async () => Boolean(labRunning() || optRunning() || benchActive() || deepRunning()
    || await Promise.resolve().then(rebootActive).catch(() => false));
}

/**
 * lastProbe() → { at, sample } da última amostra da sonda (at = quando chegou). Amostra de até 60 s vale no lugar da
 * consulta: a sonda já está olhando o primeiro plano a cada 4 s, sem custo a mais. Sem primeiro plano na amostra = null.
 */
function createGameInForeground({ now = Date.now, lastProbe, query }) {
  return async () => {
    const last = lastProbe();
    if (last && last.sample && Number.isFinite(last.at) && now() - last.at <= PROBE_FRESH_MS) {
      const fg = last.sample.fg;
      return fg ? fg.isGame === true : null;
    }
    return query();
  };
}

module.exports = { createBusy, createGameInForeground, PROBE_FRESH_MS };
