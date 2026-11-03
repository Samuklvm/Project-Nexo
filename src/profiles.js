/*
 * Perfis de uso: Jogos, Trabalho e criação, Uso geral.
 * Um perfil NÃO muda o que é verdade sobre o PC. Ele muda (1) o peso de cada fator no Índice Nexo,
 * (2) a ordem em que as observações aparecem (a confiança continua sendo só da evidência),
 * (3) a ordem dos achados nos relatórios de sessão e (4) as dicas exibidas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoProfiles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT = 'geral';

  const PROFILES = {
    jogos: {
      id: 'jogos', nome: 'Jogos',
      resumo: 'Estabilidade e desempenho em jogos.',
      detalhe: 'Dá mais peso a calor e queda de clock, e destaca gargalos de CPU e GPU nas sessões. Com o PresentMon, mede FPS e tempo de quadro.',
      pesos: { cpu: 1, memory: 1, disk: 0.8, thermal: 1.5, throttle: 2, slowdowns: 1, uptime: 0.7 },
      realce: { thermal: 10, throttle: 12, culprit: 6, memory: 4, cpu: 4, power: 6, habit: -4, uptime: -6 },
      achados: ['gpu-limited', 'cpu-thread-limited', 'thermal', 'fps-stutter', 'fps-low', 'background-load', 'gpu-other-process', 'memory-pressure', 'cpu-saturated'],
      dicas: { energia: 'Para jogos, o plano de desempenho costuma ser o mais testado. Use “Trocar e medir” para ver se ajuda neste PC.' }
    },
    trabalho: {
      id: 'trabalho', nome: 'Trabalho e criação',
      resumo: 'Fluidez no dia a dia, edição, programação e renderização.',
      detalhe: 'Dá mais peso a memória, disco e lentidões sustentadas, e destaca programas em segundo plano que atrapalham.',
      pesos: { cpu: 1.2, memory: 1.5, disk: 1.3, thermal: 1, throttle: 1.2, slowdowns: 1.3, uptime: 1.2 },
      realce: { memory: 10, disk: 8, cpu: 6, culprit: 8, uptime: 4, habit: 2, thermal: 0, throttle: 2 },
      achados: ['memory-pressure', 'cpu-saturated', 'background-load', 'thermal', 'cpu-thread-limited', 'gpu-limited', 'gpu-other-process', 'fps-stutter', 'fps-low'],
      dicas: { energia: 'Para trabalho pesado na tomada, o plano de desempenho pode ajudar; no notebook, o equilibrado costuma bastar.' }
    },
    geral: {
      id: 'geral', nome: 'Uso geral',
      resumo: 'Equilíbrio entre desempenho, consumo e manutenção.',
      detalhe: 'Pesos neutros: nenhum fator é favorecido. É um bom ponto de partida.',
      pesos: {}, realce: {},
      achados: ['memory-pressure', 'gpu-limited', 'cpu-thread-limited', 'cpu-saturated', 'thermal', 'background-load', 'gpu-other-process', 'fps-stutter', 'fps-low'],
      dicas: { energia: 'O plano equilibrado atende à maioria dos usos. Teste outros só se notar lentidão.' }
    }
  };

  const get = (id) => PROFILES[id] || PROFILES[DEFAULT];

  return {
    DEFAULT,
    list: () => Object.values(PROFILES),
    get,
    isValid: (id) => Object.prototype.hasOwnProperty.call(PROFILES, id),
    weights: (id) => ({ ...get(id).pesos }),
    boost: (id) => ({ ...get(id).realce }),
    /** Ordena achados de sessão pela prioridade do perfil (desconhecidos vão para o fim). */
    rankFindings(id, findings) {
      const order = get(id).achados;
      const rank = (finding) => { const index = order.indexOf(finding.id); return index < 0 ? order.length : index; };
      const severity = { bad: 0, warn: 1, info: 2 };
      return findings.slice().sort((a, b) => (severity[a.severity] - severity[b.severity]) || (rank(a) - rank(b)) || (b.confidence - a.confidence));
    }
  };
});
