/*
 * Cortex — ritmo leve e profundo. Decide quando o Cortex pode pensar e testar a toda (PC parado, sem jogo em primeiro
 * plano: 'profundo') e quando fica no modo reduzido ('leve').
 *
 * Começa leve. Vai a profundo só depois de `confirmChecks` checagens seguidas com ociosidade >= `enterIdleSec` e jogo
 * confirmado como ausente (`gameInForeground === false`; `null` = não deu para saber, conta como jogo). Volta a leve na
 * primeira checagem com ociosidade < `exitIdleSec` ou com jogo em primeiro plano; esse retorno só vale no profundo (no
 * leve, ociosidade baixa apenas zera o contador). Ociosidade inválida (NaN, negativa, ausente, não numérica) conta como
 * pessoa presente: leve e contador zerado.
 *
 * Puro: sem timers e sem chamadas ao sistema. Quem chama lê a ociosidade e o jogo e entrega em cada `check`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoRhythm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Texto de minutos, arredondando para baixo. */
  function parado(idleSec) {
    const min = Math.floor(idleSec / 60);
    return min < 1 ? 'parado há menos de 1 min' : `parado há ${min} min`;
  }

  function createRhythm({ enterIdleSec = 600, confirmChecks = 2, exitIdleSec = 5 } = {}) {
    let current = 'leve';
    let streak = 0; // checagens seguidas que já cumprem as condições de entrada

    function go(next, reason) {
      const changed = next !== current;
      current = next;
      return { state: current, changed, reason };
    }

    function check({ idleSec, gameInForeground } = {}) {
      const valid = typeof idleSec === 'number' && Number.isFinite(idleSec) && idleSec >= 0;
      if (!valid) {
        streak = 0;
        return go('leve', 'sem leitura de ociosidade, tratando como você presente');
      }
      if (gameInForeground === true) {
        streak = 0;
        return go('leve', 'jogo em primeiro plano');
      }
      if (current === 'profundo') {
        if (idleSec < exitIdleSec) {
          streak = 0;
          return go('leve', 'você voltou');
        }
        return go('profundo', `${parado(idleSec)}, sem jogo aberto`);
      }
      if (gameInForeground !== false) {
        streak = 0;
        return go('leve', 'não deu para saber se há jogo aberto');
      }
      if (idleSec < enterIdleSec) {
        streak = 0;
        return go('leve', idleSec < exitIdleSec ? 'você está usando o PC' : `${parado(idleSec)}, ainda pouco para o modo profundo`);
      }
      streak += 1;
      if (streak >= confirmChecks) return go('profundo', `${parado(idleSec)}, sem jogo aberto`);
      return go('leve', parado(idleSec));
    }

    return { check, state: () => current };
  }

  return { createRhythm };
});
