/*
 * Tema da barra lateral por página: a barra se mistura com a página aberta em vez de ficar sempre azul-noite.
 * O ui-kit.js põe o tema em <body data-rail-theme="…"> a cada troca de página; o theme.css tem as cores de cada tema
 * (o "padrao" é o visual de sempre, sem regra própria). Toda página do app está no mapa; página desconhecida = padrão.
 *   padrao     a noite azul com o neon da cor de destaque (Início, Análise, Sessões, Jogos, Drivers, Atlas…)
 *   santuario  tinta quente e luz de vela (Ajustes, o Santuário)
 *   cortex     tinta translúcida sobre a biblioteca, filete e item ativo em ouro (Cortex)
 *   risco      a noite com a seda vermelha do aviso de risco (Otimização extrema)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoRailTheme = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const THEMES = ['padrao', 'santuario', 'cortex', 'risco'];
  const BY_VIEW = {
    home: 'padrao', analysis: 'padrao', cortex: 'cortex', sessions: 'padrao', library: 'padrao', drivers: 'padrao',
    lab: 'risco', atlas: 'padrao', hardware: 'padrao', maintenance: 'padrao', activity: 'padrao', updates: 'padrao',
    settings: 'santuario'
  };
  /** Tema da barra para uma página (chave própria do mapa; o resto é o padrão). */
  function themeFor(view) {
    return typeof view === 'string' && Object.hasOwn(BY_VIEW, view) ? BY_VIEW[view] : 'padrao';
  }
  return { THEMES, BY_VIEW, themeFor };
});
